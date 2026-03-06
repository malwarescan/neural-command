"""
Agent Tool System — Real API integrations for Croutons Agents.
Gives agents the ability to interact with connected services (GitHub, GSC, GA, etc.)
via OpenAI function calling.
"""

import json
import base64
import logging
import httpx

logger = logging.getLogger("agent_tools")

# ─────────────────────────────────────────────
# TOOL DEFINITIONS (OpenAI function-calling format)
# ─────────────────────────────────────────────

GITHUB_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "github_list_repos",
            "description": "List repositories accessible to the authenticated GitHub user. Returns repo names, descriptions, languages, and URLs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["all", "owner", "member"],
                        "description": "Filter repos by type. Default: all",
                    },
                    "sort": {
                        "type": "string",
                        "enum": ["created", "updated", "pushed", "full_name"],
                        "description": "Sort field. Default: updated",
                    },
                    "per_page": {
                        "type": "integer",
                        "description": "Results per page (max 100). Default: 30",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "github_get_repo",
            "description": "Get detailed information about a specific GitHub repository including stats, languages, default branch, etc.",
            "parameters": {
                "type": "object",
                "properties": {
                    "owner": {"type": "string", "description": "Repository owner (username or org)"},
                    "repo": {"type": "string", "description": "Repository name"},
                },
                "required": ["owner", "repo"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "github_list_files",
            "description": "List files and directories in a repository path. Use to browse repo structure.",
            "parameters": {
                "type": "object",
                "properties": {
                    "owner": {"type": "string", "description": "Repository owner"},
                    "repo": {"type": "string", "description": "Repository name"},
                    "path": {"type": "string", "description": "Directory path (empty string for root). Default: ''"},
                    "ref": {"type": "string", "description": "Branch or commit SHA. Default: repo default branch"},
                },
                "required": ["owner", "repo"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "github_read_file",
            "description": "Read the contents of a file from a GitHub repository. Returns the decoded text content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "owner": {"type": "string", "description": "Repository owner"},
                    "repo": {"type": "string", "description": "Repository name"},
                    "path": {"type": "string", "description": "File path within the repository"},
                    "ref": {"type": "string", "description": "Branch or commit SHA. Default: repo default branch"},
                },
                "required": ["owner", "repo", "path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "github_update_file",
            "description": "Create or update a file in a GitHub repository. Automatically handles the commit SHA for updates.",
            "parameters": {
                "type": "object",
                "properties": {
                    "owner": {"type": "string", "description": "Repository owner"},
                    "repo": {"type": "string", "description": "Repository name"},
                    "path": {"type": "string", "description": "File path within the repository"},
                    "content": {"type": "string", "description": "The new file content (plain text, will be base64-encoded automatically)"},
                    "message": {"type": "string", "description": "Commit message describing the change"},
                    "branch": {"type": "string", "description": "Target branch. Default: repo default branch"},
                },
                "required": ["owner", "repo", "path", "content", "message"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "github_list_issues",
            "description": "List issues for a repository. Can filter by state, labels, assignee.",
            "parameters": {
                "type": "object",
                "properties": {
                    "owner": {"type": "string", "description": "Repository owner"},
                    "repo": {"type": "string", "description": "Repository name"},
                    "state": {"type": "string", "enum": ["open", "closed", "all"], "description": "Filter by state. Default: open"},
                    "labels": {"type": "string", "description": "Comma-separated list of label names to filter by"},
                    "per_page": {"type": "integer", "description": "Results per page (max 100). Default: 30"},
                },
                "required": ["owner", "repo"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "github_create_issue",
            "description": "Create a new issue in a GitHub repository.",
            "parameters": {
                "type": "object",
                "properties": {
                    "owner": {"type": "string", "description": "Repository owner"},
                    "repo": {"type": "string", "description": "Repository name"},
                    "title": {"type": "string", "description": "Issue title"},
                    "body": {"type": "string", "description": "Issue body (markdown supported)"},
                    "labels": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Labels to apply",
                    },
                },
                "required": ["owner", "repo", "title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "github_list_pull_requests",
            "description": "List pull requests for a repository.",
            "parameters": {
                "type": "object",
                "properties": {
                    "owner": {"type": "string", "description": "Repository owner"},
                    "repo": {"type": "string", "description": "Repository name"},
                    "state": {"type": "string", "enum": ["open", "closed", "all"], "description": "Filter by state. Default: open"},
                    "per_page": {"type": "integer", "description": "Results per page (max 100). Default: 30"},
                },
                "required": ["owner", "repo"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "github_list_commits",
            "description": "List recent commits on a repository branch.",
            "parameters": {
                "type": "object",
                "properties": {
                    "owner": {"type": "string", "description": "Repository owner"},
                    "repo": {"type": "string", "description": "Repository name"},
                    "sha": {"type": "string", "description": "Branch name or commit SHA. Default: repo default branch"},
                    "per_page": {"type": "integer", "description": "Results per page (max 100). Default: 20"},
                },
                "required": ["owner", "repo"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "github_search_code",
            "description": "Search for code across a repository. Returns matching file paths and code snippets.",
            "parameters": {
                "type": "object",
                "properties": {
                    "owner": {"type": "string", "description": "Repository owner"},
                    "repo": {"type": "string", "description": "Repository name"},
                    "query": {"type": "string", "description": "Search query (code keyword or phrase to find)"},
                },
                "required": ["owner", "repo", "query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "github_create_branch",
            "description": "Create a new branch from an existing branch. Use this before making code/content updates so changes can go into a pull request.",
            "parameters": {
                "type": "object",
                "properties": {
                    "owner": {"type": "string", "description": "Repository owner"},
                    "repo": {"type": "string", "description": "Repository name"},
                    "new_branch": {"type": "string", "description": "New branch name to create (e.g. seo/update-landing-page-copy)"},
                    "from_branch": {"type": "string", "description": "Source branch to branch from. Default: repository default branch"},
                },
                "required": ["owner", "repo", "new_branch"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "github_create_pull_request",
            "description": "Create a pull request for review after updating files on a feature branch.",
            "parameters": {
                "type": "object",
                "properties": {
                    "owner": {"type": "string", "description": "Repository owner"},
                    "repo": {"type": "string", "description": "Repository name"},
                    "title": {"type": "string", "description": "Pull request title"},
                    "head": {"type": "string", "description": "Head branch name containing changes"},
                    "base": {"type": "string", "description": "Base branch to merge into. Default: repository default branch"},
                    "body": {"type": "string", "description": "Pull request body / summary in markdown"},
                    "draft": {"type": "boolean", "description": "Create as draft PR. Default: false"},
                },
                "required": ["owner", "repo", "title", "head"],
            },
        },
    },
]

GOOGLE_SEARCH_CONSOLE_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "gsc_list_sites",
            "description": "List all sites (properties) registered in Google Search Console.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "gsc_query_analytics",
            "description": "Query Google Search Console search analytics data. Returns clicks, impressions, CTR, and position data for queries and pages.",
            "parameters": {
                "type": "object",
                "properties": {
                    "site_url": {"type": "string", "description": "Site URL (e.g., 'https://example.com/' or 'sc-domain:example.com')"},
                    "start_date": {"type": "string", "description": "Start date in YYYY-MM-DD format"},
                    "end_date": {"type": "string", "description": "End date in YYYY-MM-DD format"},
                    "dimensions": {
                        "type": "array",
                        "items": {"type": "string", "enum": ["query", "page", "country", "device", "date"]},
                        "description": "Dimensions to group by. Default: ['query']",
                    },
                    "row_limit": {"type": "integer", "description": "Max rows to return (max 25000). Default: 100"},
                    "query_filter": {"type": "string", "description": "Optional: filter to queries containing this string"},
                    "page_filter": {"type": "string", "description": "Optional: filter to pages containing this URL"},
                },
                "required": ["site_url", "start_date", "end_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "gsc_list_sitemaps",
            "description": "List all sitemaps submitted for a site in Google Search Console.",
            "parameters": {
                "type": "object",
                "properties": {
                    "site_url": {"type": "string", "description": "Site URL"},
                },
                "required": ["site_url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "gsc_inspect_url",
            "description": "Inspect a URL's index status in Google Search Console. Shows if URL is indexed, crawled, mobile-friendly, etc.",
            "parameters": {
                "type": "object",
                "properties": {
                    "site_url": {"type": "string", "description": "Site URL (property)"},
                    "inspection_url": {"type": "string", "description": "The full URL to inspect"},
                },
                "required": ["site_url", "inspection_url"],
            },
        },
    },
]

GOOGLE_ANALYTICS_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "ga_list_properties",
            "description": "List all Google Analytics 4 properties accessible to the user.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ga_run_report",
            "description": "Run a Google Analytics 4 report. Returns metrics like sessions, users, pageviews grouped by dimensions like page, source, country, etc.",
            "parameters": {
                "type": "object",
                "properties": {
                    "property_id": {"type": "string", "description": "GA4 property ID (numeric, e.g., '123456789')"},
                    "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD or relative like '30daysAgo', '7daysAgo', 'yesterday')"},
                    "end_date": {"type": "string", "description": "End date (YYYY-MM-DD or 'today', 'yesterday')"},
                    "metrics": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Metrics to retrieve (e.g., 'sessions', 'totalUsers', 'screenPageViews', 'bounceRate', 'averageSessionDuration', 'conversions')",
                    },
                    "dimensions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Dimensions to group by (e.g., 'pagePath', 'sessionSource', 'country', 'deviceCategory', 'date')",
                    },
                    "row_limit": {"type": "integer", "description": "Max rows. Default: 100"},
                    "dimension_filter": {"type": "string", "description": "Optional dimension filter expression"},
                },
                "required": ["property_id", "start_date", "end_date", "metrics"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ga_realtime_report",
            "description": "Get real-time analytics data from Google Analytics 4. Shows active users and current activity.",
            "parameters": {
                "type": "object",
                "properties": {
                    "property_id": {"type": "string", "description": "GA4 property ID"},
                    "metrics": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Realtime metrics (e.g., 'activeUsers', 'screenPageViews', 'conversions')",
                    },
                    "dimensions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Realtime dimensions (e.g., 'unifiedScreenName', 'country', 'deviceCategory')",
                    },
                },
                "required": ["property_id", "metrics"],
            },
        },
    },
]

GOOGLE_GEMINI_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "google_gemini_list_models",
            "description": "List available Google Gemini models for the connected API key.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "google_gemini_generate_content",
            "description": "Generate text content using Google Gemini. Useful for social copy, campaign ideas, and draft content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "The prompt/instruction text to send to Gemini"},
                    "model": {
                        "type": "string",
                        "description": "Gemini model name (e.g. gemini-flash-latest). Default: gemini-flash-latest",
                    },
                    "temperature": {"type": "number", "description": "Sampling temperature (0.0-2.0). Optional"},
                    "max_output_tokens": {"type": "integer", "description": "Maximum output tokens. Optional"},
                },
                "required": ["prompt"],
            },
        },
    },
]

TWITTER_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "twitter_get_me",
            "description": "Get the authenticated X (Twitter) account profile.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "twitter_post_tweet",
            "description": "Publish a tweet from the connected account.",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Tweet text content"},
                    "reply_to_tweet_id": {"type": "string", "description": "Optional tweet ID to post this as a reply"},
                },
                "required": ["text"],
            },
        },
    },
]

TIKTOK_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "tiktok_get_profile",
            "description": "Get the connected TikTok account profile details.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "tiktok_init_video_post",
            "description": "Start a TikTok video post from a hosted video URL. Returns publish_id for status checks.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Caption/title for the TikTok post"},
                    "video_url": {"type": "string", "description": "Publicly accessible HTTPS URL of the video file"},
                    "privacy_level": {
                        "type": "string",
                        "enum": ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
                        "description": "Post privacy. Default: SELF_ONLY",
                    },
                    "disable_duet": {"type": "boolean", "description": "Disable duets. Default: false"},
                    "disable_comment": {"type": "boolean", "description": "Disable comments. Default: false"},
                    "disable_stitch": {"type": "boolean", "description": "Disable stitch. Default: false"},
                    "video_cover_timestamp_ms": {"type": "integer", "description": "Optional cover frame time in ms"},
                },
                "required": ["title", "video_url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "tiktok_get_publish_status",
            "description": "Check status for a TikTok publish job by publish_id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "publish_id": {"type": "string", "description": "Publish ID returned by tiktok_init_video_post"},
                },
                "required": ["publish_id"],
            },
        },
    },
]

# Map service names to their tool definitions
SERVICE_TOOLS = {
    "github": GITHUB_TOOLS,
    "google_search_console": GOOGLE_SEARCH_CONSOLE_TOOLS,
    "google_analytics": GOOGLE_ANALYTICS_TOOLS,
    "google_gemini": GOOGLE_GEMINI_TOOLS,
    "twitter": TWITTER_TOOLS,
    "tiktok": TIKTOK_TOOLS,
}


# ─────────────────────────────────────────────
# TOOL EXECUTION FUNCTIONS
# ─────────────────────────────────────────────

GH_API = "https://api.github.com"
GH_HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


async def _gh_request(method: str, url: str, token: str, json_data=None, params=None) -> dict:
    """Make an authenticated GitHub API request."""
    headers = {**GH_HEADERS, "Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.request(method, url, headers=headers, json=json_data, params=params)
        if r.status_code >= 400:
            return {"error": f"GitHub API returned {r.status_code}: {r.text[:500]}"}
        if r.status_code == 204:
            return {"status": "success"}
        return r.json()


async def exec_github_list_repos(token: str, args: dict) -> str:
    params = {}
    if args.get("type"):
        params["type"] = args["type"]
    if args.get("sort"):
        params["sort"] = args["sort"]
    params["per_page"] = min(args.get("per_page", 30), 100)
    
    result = await _gh_request("GET", f"{GH_API}/user/repos", token, params=params)
    if isinstance(result, list):
        repos = []
        for r in result:
            repos.append({
                "full_name": r.get("full_name"),
                "description": r.get("description"),
                "language": r.get("language"),
                "private": r.get("private"),
                "default_branch": r.get("default_branch"),
                "html_url": r.get("html_url"),
                "updated_at": r.get("updated_at"),
                "stargazers_count": r.get("stargazers_count"),
            })
        return json.dumps(repos, indent=2)
    return json.dumps(result, indent=2)


async def exec_github_get_repo(token: str, args: dict) -> str:
    owner, repo = args["owner"], args["repo"]
    result = await _gh_request("GET", f"{GH_API}/repos/{owner}/{repo}", token)
    if "error" not in result:
        return json.dumps({
            "full_name": result.get("full_name"),
            "description": result.get("description"),
            "language": result.get("language"),
            "private": result.get("private"),
            "default_branch": result.get("default_branch"),
            "html_url": result.get("html_url"),
            "created_at": result.get("created_at"),
            "updated_at": result.get("updated_at"),
            "pushed_at": result.get("pushed_at"),
            "stargazers_count": result.get("stargazers_count"),
            "forks_count": result.get("forks_count"),
            "open_issues_count": result.get("open_issues_count"),
            "topics": result.get("topics"),
            "size": result.get("size"),
        }, indent=2)
    return json.dumps(result, indent=2)


async def exec_github_list_files(token: str, args: dict) -> str:
    owner, repo = args["owner"], args["repo"]
    path = args.get("path", "")
    url = f"{GH_API}/repos/{owner}/{repo}/contents/{path}"
    params = {}
    if args.get("ref"):
        params["ref"] = args["ref"]
    
    result = await _gh_request("GET", url, token, params=params)
    if isinstance(result, list):
        files = []
        for f in result:
            files.append({
                "name": f.get("name"),
                "path": f.get("path"),
                "type": f.get("type"),  # "file" or "dir"
                "size": f.get("size"),
            })
        return json.dumps(files, indent=2)
    return json.dumps(result, indent=2)


async def exec_github_read_file(token: str, args: dict) -> str:
    owner, repo, path = args["owner"], args["repo"], args["path"]
    url = f"{GH_API}/repos/{owner}/{repo}/contents/{path}"
    params = {}
    if args.get("ref"):
        params["ref"] = args["ref"]
    
    result = await _gh_request("GET", url, token, params=params)
    if isinstance(result, dict) and result.get("content"):
        try:
            content = base64.b64decode(result["content"]).decode("utf-8")
            # Truncate very large files to avoid token blowout
            if len(content) > 30000:
                content = content[:30000] + f"\n\n... [TRUNCATED — file is {len(content)} chars total. Showing first 30,000 chars.]"
            return json.dumps({
                "path": result.get("path"),
                "size": result.get("size"),
                "sha": result.get("sha"),
                "content": content,
            }, indent=2)
        except Exception as e:
            return json.dumps({"error": f"Failed to decode file content: {e}"})
    return json.dumps(result, indent=2)


async def exec_github_update_file(token: str, args: dict) -> str:
    owner, repo, path = args["owner"], args["repo"], args["path"]
    content_b64 = base64.b64encode(args["content"].encode("utf-8")).decode("utf-8")
    
    # First, try to get the existing file's SHA (needed for updates)
    url = f"{GH_API}/repos/{owner}/{repo}/contents/{path}"
    params = {}
    if args.get("branch"):
        params["ref"] = args["branch"]
    
    existing = await _gh_request("GET", url, token, params=params)
    
    body = {
        "message": args["message"],
        "content": content_b64,
    }
    if isinstance(existing, dict) and existing.get("sha"):
        body["sha"] = existing["sha"]  # Update existing file
    if args.get("branch"):
        body["branch"] = args["branch"]
    
    result = await _gh_request("PUT", url, token, json_data=body)
    if isinstance(result, dict) and result.get("commit"):
        return json.dumps({
            "status": "success",
            "commit_sha": result["commit"].get("sha"),
            "commit_message": result["commit"].get("message"),
            "html_url": result.get("content", {}).get("html_url"),
        }, indent=2)
    return json.dumps(result, indent=2)


async def exec_github_list_issues(token: str, args: dict) -> str:
    owner, repo = args["owner"], args["repo"]
    params = {"per_page": min(args.get("per_page", 30), 100)}
    if args.get("state"):
        params["state"] = args["state"]
    if args.get("labels"):
        params["labels"] = args["labels"]
    
    result = await _gh_request("GET", f"{GH_API}/repos/{owner}/{repo}/issues", token, params=params)
    if isinstance(result, list):
        issues = []
        for i in result:
            issues.append({
                "number": i.get("number"),
                "title": i.get("title"),
                "state": i.get("state"),
                "labels": [l.get("name") for l in (i.get("labels") or [])],
                "assignees": [a.get("login") for a in (i.get("assignees") or [])],
                "created_at": i.get("created_at"),
                "updated_at": i.get("updated_at"),
                "html_url": i.get("html_url"),
                "body": (i.get("body") or "")[:500],
            })
        return json.dumps(issues, indent=2)
    return json.dumps(result, indent=2)


async def exec_github_create_issue(token: str, args: dict) -> str:
    owner, repo = args["owner"], args["repo"]
    body = {"title": args["title"]}
    if args.get("body"):
        body["body"] = args["body"]
    if args.get("labels"):
        body["labels"] = args["labels"]
    
    result = await _gh_request("POST", f"{GH_API}/repos/{owner}/{repo}/issues", token, json_data=body)
    if isinstance(result, dict) and result.get("number"):
        return json.dumps({
            "number": result.get("number"),
            "title": result.get("title"),
            "html_url": result.get("html_url"),
            "state": result.get("state"),
        }, indent=2)
    return json.dumps(result, indent=2)


async def exec_github_list_pull_requests(token: str, args: dict) -> str:
    owner, repo = args["owner"], args["repo"]
    params = {"per_page": min(args.get("per_page", 30), 100)}
    if args.get("state"):
        params["state"] = args["state"]
    
    result = await _gh_request("GET", f"{GH_API}/repos/{owner}/{repo}/pulls", token, params=params)
    if isinstance(result, list):
        prs = []
        for p in result:
            prs.append({
                "number": p.get("number"),
                "title": p.get("title"),
                "state": p.get("state"),
                "head_branch": p.get("head", {}).get("ref"),
                "base_branch": p.get("base", {}).get("ref"),
                "user": p.get("user", {}).get("login"),
                "created_at": p.get("created_at"),
                "html_url": p.get("html_url"),
            })
        return json.dumps(prs, indent=2)
    return json.dumps(result, indent=2)


async def exec_github_list_commits(token: str, args: dict) -> str:
    owner, repo = args["owner"], args["repo"]
    params = {"per_page": min(args.get("per_page", 20), 100)}
    if args.get("sha"):
        params["sha"] = args["sha"]
    
    result = await _gh_request("GET", f"{GH_API}/repos/{owner}/{repo}/commits", token, params=params)
    if isinstance(result, list):
        commits = []
        for c in result:
            commits.append({
                "sha": c.get("sha", "")[:7],
                "message": (c.get("commit", {}).get("message") or "")[:200],
                "author": c.get("commit", {}).get("author", {}).get("name"),
                "date": c.get("commit", {}).get("author", {}).get("date"),
                "html_url": c.get("html_url"),
            })
        return json.dumps(commits, indent=2)
    return json.dumps(result, indent=2)


async def exec_github_search_code(token: str, args: dict) -> str:
    owner, repo = args["owner"], args["repo"]
    query = f"{args['query']} repo:{owner}/{repo}"
    params = {"q": query, "per_page": 20}
    
    result = await _gh_request("GET", f"{GH_API}/search/code", token, params=params)
    if isinstance(result, dict) and "items" in result:
        items = []
        for item in result["items"][:20]:
            items.append({
                "path": item.get("path"),
                "name": item.get("name"),
                "html_url": item.get("html_url"),
            })
        return json.dumps({"total_count": result.get("total_count"), "items": items}, indent=2)
    return json.dumps(result, indent=2)


async def exec_github_create_branch(token: str, args: dict) -> str:
    owner, repo = args["owner"], args["repo"]
    new_branch = args["new_branch"].strip().replace("refs/heads/", "")
    if not new_branch:
        return json.dumps({"error": "new_branch is required"})

    from_branch = (args.get("from_branch") or "").strip().replace("refs/heads/", "")
    if not from_branch:
        repo_info = await _gh_request("GET", f"{GH_API}/repos/{owner}/{repo}", token)
        if isinstance(repo_info, dict) and repo_info.get("default_branch"):
            from_branch = repo_info["default_branch"]
        else:
            return json.dumps({"error": "Could not determine default branch"})

    base_ref = await _gh_request("GET", f"{GH_API}/repos/{owner}/{repo}/git/ref/heads/{from_branch}", token)
    if not isinstance(base_ref, dict) or not base_ref.get("object", {}).get("sha"):
        return json.dumps({"error": f"Could not read source branch '{from_branch}'"})

    base_sha = base_ref["object"]["sha"]
    create_body = {"ref": f"refs/heads/{new_branch}", "sha": base_sha}
    created = await _gh_request("POST", f"{GH_API}/repos/{owner}/{repo}/git/refs", token, json_data=create_body)

    if isinstance(created, dict) and created.get("ref"):
        return json.dumps(
            {
                "status": "success",
                "new_branch": new_branch,
                "from_branch": from_branch,
                "base_sha": base_sha,
                "ref": created.get("ref"),
                "url": created.get("url"),
            },
            indent=2,
        )
    return json.dumps(created, indent=2)


async def exec_github_create_pull_request(token: str, args: dict) -> str:
    owner, repo = args["owner"], args["repo"]

    base = (args.get("base") or "").strip()
    if not base:
        repo_info = await _gh_request("GET", f"{GH_API}/repos/{owner}/{repo}", token)
        if isinstance(repo_info, dict) and repo_info.get("default_branch"):
            base = repo_info["default_branch"]
        else:
            return json.dumps({"error": "Could not determine base branch"})

    body = {
        "title": args["title"],
        "head": args["head"],
        "base": base,
        "draft": bool(args.get("draft", False)),
    }
    if args.get("body"):
        body["body"] = args["body"]

    result = await _gh_request("POST", f"{GH_API}/repos/{owner}/{repo}/pulls", token, json_data=body)
    if isinstance(result, dict) and result.get("number"):
        return json.dumps(
            {
                "status": "success",
                "number": result.get("number"),
                "title": result.get("title"),
                "state": result.get("state"),
                "html_url": result.get("html_url"),
                "head": result.get("head", {}).get("ref"),
                "base": result.get("base", {}).get("ref"),
            },
            indent=2,
        )
    return json.dumps(result, indent=2)


# ─── Google Search Console execution ───

async def _gsc_request(method: str, url: str, token: str, json_data=None, params=None) -> dict:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.request(method, url, headers=headers, json=json_data, params=params)
        if r.status_code >= 400:
            return {"error": f"Google API returned {r.status_code}: {r.text[:500]}"}
        return r.json()


async def exec_gsc_list_sites(token: str, args: dict) -> str:
    result = await _gsc_request("GET", "https://www.googleapis.com/webmasters/v3/sites", token)
    if "siteEntry" in result:
        sites = [{"siteUrl": s.get("siteUrl"), "permissionLevel": s.get("permissionLevel")} for s in result["siteEntry"]]
        return json.dumps(sites, indent=2)
    return json.dumps(result, indent=2)


async def exec_gsc_query_analytics(token: str, args: dict) -> str:
    site_url = args["site_url"]
    body = {
        "startDate": args["start_date"],
        "endDate": args["end_date"],
        "dimensions": args.get("dimensions", ["query"]),
        "rowLimit": min(args.get("row_limit", 100), 25000),
    }
    # Dimension filters
    filters = []
    if args.get("query_filter"):
        filters.append({"dimension": "query", "operator": "contains", "expression": args["query_filter"]})
    if args.get("page_filter"):
        filters.append({"dimension": "page", "operator": "contains", "expression": args["page_filter"]})
    if filters:
        body["dimensionFilterGroups"] = [{"filters": filters}]
    
    url = f"https://www.googleapis.com/webmasters/v3/sites/{site_url}/searchAnalytics/query"
    result = await _gsc_request("POST", url, token, json_data=body)
    if "rows" in result:
        rows = []
        dims = args.get("dimensions", ["query"])
        for row in result["rows"]:
            entry = {}
            keys = row.get("keys", [])
            for i, d in enumerate(dims):
                entry[d] = keys[i] if i < len(keys) else ""
            entry["clicks"] = row.get("clicks")
            entry["impressions"] = row.get("impressions")
            entry["ctr"] = round(row.get("ctr", 0) * 100, 2)
            entry["position"] = round(row.get("position", 0), 1)
            rows.append(entry)
        return json.dumps({"total_rows": len(rows), "rows": rows}, indent=2)
    return json.dumps(result, indent=2)


async def exec_gsc_list_sitemaps(token: str, args: dict) -> str:
    site_url = args["site_url"]
    url = f"https://www.googleapis.com/webmasters/v3/sites/{site_url}/sitemaps"
    result = await _gsc_request("GET", url, token)
    if "sitemap" in result:
        sitemaps = []
        for s in result["sitemap"]:
            sitemaps.append({
                "path": s.get("path"),
                "lastSubmitted": s.get("lastSubmitted"),
                "isPending": s.get("isPending"),
                "isSitemapsIndex": s.get("isSitemapsIndex"),
                "warnings": s.get("warnings"),
                "errors": s.get("errors"),
            })
        return json.dumps(sitemaps, indent=2)
    return json.dumps(result, indent=2)


async def exec_gsc_inspect_url(token: str, args: dict) -> str:
    body = {
        "inspectionUrl": args["inspection_url"],
        "siteUrl": args["site_url"],
    }
    url = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"
    result = await _gsc_request("POST", url, token, json_data=body)
    if "inspectionResult" in result:
        ir = result["inspectionResult"]
        return json.dumps({
            "indexStatusResult": ir.get("indexStatusResult"),
            "mobileUsabilityResult": ir.get("mobileUsabilityResult"),
            "richResultsResult": ir.get("richResultsResult"),
        }, indent=2)
    return json.dumps(result, indent=2)


# ─── Google Analytics 4 execution ───

async def exec_ga_list_properties(token: str, args: dict) -> str:
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
            headers=headers,
        )
        if r.status_code >= 400:
            return json.dumps({"error": f"GA Admin API returned {r.status_code}: {r.text[:500]}"})
        data = r.json()
    
    props = []
    for acct in data.get("accountSummaries", []):
        for p in acct.get("propertySummaries", []):
            props.append({
                "property": p.get("property"),
                "displayName": p.get("displayName"),
                "account": acct.get("displayName"),
            })
    return json.dumps(props, indent=2)


async def exec_ga_run_report(token: str, args: dict) -> str:
    prop_id = args["property_id"]
    body = {
        "dateRanges": [{"startDate": args["start_date"], "endDate": args["end_date"]}],
        "metrics": [{"name": m} for m in args["metrics"]],
        "limit": str(min(args.get("row_limit", 100), 10000)),
    }
    if args.get("dimensions"):
        body["dimensions"] = [{"name": d} for d in args["dimensions"]]
    
    url = f"https://analyticsdata.googleapis.com/v1beta/properties/{prop_id}:runReport"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, headers=headers, json=body)
        if r.status_code >= 400:
            return json.dumps({"error": f"GA Data API returned {r.status_code}: {r.text[:500]}"})
        data = r.json()
    
    dim_headers = [h.get("name") for h in data.get("dimensionHeaders", [])]
    met_headers = [h.get("name") for h in data.get("metricHeaders", [])]
    rows = []
    for row in data.get("rows", []):
        entry = {}
        for i, dv in enumerate(row.get("dimensionValues", [])):
            entry[dim_headers[i]] = dv.get("value")
        for i, mv in enumerate(row.get("metricValues", [])):
            entry[met_headers[i]] = mv.get("value")
        rows.append(entry)
    
    return json.dumps({
        "row_count": data.get("rowCount"),
        "dimensions": dim_headers,
        "metrics": met_headers,
        "rows": rows,
    }, indent=2)


async def exec_ga_realtime_report(token: str, args: dict) -> str:
    prop_id = args["property_id"]
    body = {
        "metrics": [{"name": m} for m in args["metrics"]],
    }
    if args.get("dimensions"):
        body["dimensions"] = [{"name": d} for d in args["dimensions"]]
    
    url = f"https://analyticsdata.googleapis.com/v1beta/properties/{prop_id}:runRealtimeReport"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, headers=headers, json=body)
        if r.status_code >= 400:
            return json.dumps({"error": f"GA Realtime API returned {r.status_code}: {r.text[:500]}"})
        data = r.json()
    
    dim_headers = [h.get("name") for h in data.get("dimensionHeaders", [])]
    met_headers = [h.get("name") for h in data.get("metricHeaders", [])]
    rows = []
    for row in data.get("rows", []):
        entry = {}
        for i, dv in enumerate(row.get("dimensionValues", [])):
            entry[dim_headers[i]] = dv.get("value")
        for i, mv in enumerate(row.get("metricValues", [])):
            entry[met_headers[i]] = mv.get("value")
        rows.append(entry)
    
    return json.dumps({"rows": rows}, indent=2)


# ─── Google Gemini execution ───

async def _gemini_request(method: str, path: str, api_key: str, json_data=None, params=None) -> dict:
    query = {"key": api_key}
    if params:
        query.update(params)
    url = f"https://generativelanguage.googleapis.com{path}"
    headers = {"Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=45) as client:
        r = await client.request(method, url, headers=headers, json=json_data, params=query)
        if r.status_code >= 400:
            return {"error": f"Gemini API returned {r.status_code}: {r.text[:500]}"}
        return r.json()


async def exec_google_gemini_list_models(api_key: str, args: dict) -> str:
    result = await _gemini_request("GET", "/v1beta/models", api_key)
    if isinstance(result, dict) and "models" in result:
        models = []
        for m in result.get("models", []):
            methods = m.get("supportedGenerationMethods") or []
            if "generateContent" in methods:
                models.append(
                    {
                        "name": m.get("name", "").replace("models/", ""),
                        "display_name": m.get("displayName"),
                        "description": m.get("description"),
                        "input_token_limit": m.get("inputTokenLimit"),
                        "output_token_limit": m.get("outputTokenLimit"),
                    }
                )
        return json.dumps(models, indent=2)
    return json.dumps(result, indent=2)


async def exec_google_gemini_generate_content(api_key: str, args: dict) -> str:
    prompt = (args.get("prompt") or "").strip()
    if not prompt:
        return json.dumps({"error": "prompt is required"})

    model = (args.get("model") or "gemini-flash-latest").strip()
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
    }
    generation_config = {}
    if args.get("temperature") is not None:
        generation_config["temperature"] = float(args["temperature"])
    if args.get("max_output_tokens") is not None:
        generation_config["maxOutputTokens"] = int(args["max_output_tokens"])
    if generation_config:
        body["generationConfig"] = generation_config

    result = await _gemini_request("POST", f"/v1beta/models/{model}:generateContent", api_key, json_data=body)
    if isinstance(result, dict):
        candidates = result.get("candidates") or []
        if candidates:
            parts = (((candidates[0] or {}).get("content") or {}).get("parts") or [])
            text_chunks = [p.get("text", "") for p in parts if isinstance(p, dict) and p.get("text")]
            text = "\n".join(text_chunks).strip()
            return json.dumps(
                {
                    "model": model,
                    "text": text,
                    "finish_reason": candidates[0].get("finishReason"),
                    "usage_metadata": result.get("usageMetadata"),
                },
                indent=2,
            )
    return json.dumps(result, indent=2)


# ─── Twitter (X) execution ───

async def _twitter_request(method: str, path: str, token: str, json_data=None, params=None) -> dict:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    url = f"https://api.twitter.com{path}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.request(method, url, headers=headers, json=json_data, params=params)
        if r.status_code >= 400:
            return {"error": f"Twitter API returned {r.status_code}: {r.text[:500]}"}
        if r.status_code == 204:
            return {"status": "success"}
        return r.json()


async def exec_twitter_get_me(token: str, args: dict) -> str:
    result = await _twitter_request("GET", "/2/users/me", token, params={"user.fields": "id,name,username,verified,public_metrics"})
    if isinstance(result, dict) and "data" in result:
        return json.dumps(result["data"], indent=2)
    return json.dumps(result, indent=2)


async def exec_twitter_post_tweet(token: str, args: dict) -> str:
    text = (args.get("text") or "").strip()
    if not text:
        return json.dumps({"error": "text is required"})

    body = {"text": text}
    reply_to = (args.get("reply_to_tweet_id") or "").strip()
    if reply_to:
        body["reply"] = {"in_reply_to_tweet_id": reply_to}

    result = await _twitter_request("POST", "/2/tweets", token, json_data=body)
    if isinstance(result, dict) and result.get("data", {}).get("id"):
        return json.dumps(
            {
                "status": "success",
                "tweet_id": result["data"].get("id"),
                "text": result["data"].get("text"),
            },
            indent=2,
        )
    return json.dumps(result, indent=2)


# ─── TikTok execution ───

async def _tiktok_request(method: str, path: str, token: str, json_data=None, params=None) -> dict:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=UTF-8"}
    url = f"https://open.tiktokapis.com{path}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.request(method, url, headers=headers, json=json_data, params=params)
        if r.status_code >= 400:
            return {"error": f"TikTok API returned {r.status_code}: {r.text[:500]}"}
        if r.status_code == 204:
            return {"status": "success"}
        return r.json()


async def exec_tiktok_get_profile(token: str, args: dict) -> str:
    params = {
        "fields": "open_id,union_id,avatar_url,display_name,bio_description,profile_deep_link,follower_count,following_count,likes_count,video_count",
    }
    result = await _tiktok_request("GET", "/v2/user/info/", token, params=params)
    if isinstance(result, dict) and result.get("data", {}).get("user"):
        return json.dumps(result["data"]["user"], indent=2)
    return json.dumps(result, indent=2)


async def exec_tiktok_init_video_post(token: str, args: dict) -> str:
    title = (args.get("title") or "").strip()
    video_url = (args.get("video_url") or "").strip()
    if not title or not video_url:
        return json.dumps({"error": "title and video_url are required"})

    body = {
        "post_info": {
            "title": title[:150],
            "privacy_level": args.get("privacy_level", "SELF_ONLY"),
            "disable_duet": bool(args.get("disable_duet", False)),
            "disable_comment": bool(args.get("disable_comment", False)),
            "disable_stitch": bool(args.get("disable_stitch", False)),
        },
        "source_info": {
            "source": "PULL_FROM_URL",
            "video_url": video_url,
        },
    }
    if args.get("video_cover_timestamp_ms") is not None:
        body["post_info"]["video_cover_timestamp_ms"] = int(args["video_cover_timestamp_ms"])

    result = await _tiktok_request("POST", "/v2/post/publish/video/init/", token, json_data=body)
    if isinstance(result, dict) and result.get("data", {}).get("publish_id"):
        return json.dumps(
            {
                "status": "success",
                "publish_id": result["data"]["publish_id"],
                "raw": result,
            },
            indent=2,
        )
    return json.dumps(result, indent=2)


async def exec_tiktok_get_publish_status(token: str, args: dict) -> str:
    publish_id = (args.get("publish_id") or "").strip()
    if not publish_id:
        return json.dumps({"error": "publish_id is required"})

    body = {"publish_id": publish_id}
    result = await _tiktok_request("POST", "/v2/post/publish/status/fetch/", token, json_data=body)
    return json.dumps(result, indent=2)


# ─────────────────────────────────────────────
# TOOL DISPATCH
# ─────────────────────────────────────────────

TOOL_EXECUTORS = {
    # GitHub
    "github_list_repos": ("github", exec_github_list_repos),
    "github_get_repo": ("github", exec_github_get_repo),
    "github_list_files": ("github", exec_github_list_files),
    "github_read_file": ("github", exec_github_read_file),
    "github_update_file": ("github", exec_github_update_file),
    "github_list_issues": ("github", exec_github_list_issues),
    "github_create_issue": ("github", exec_github_create_issue),
    "github_list_pull_requests": ("github", exec_github_list_pull_requests),
    "github_list_commits": ("github", exec_github_list_commits),
    "github_search_code": ("github", exec_github_search_code),
    "github_create_branch": ("github", exec_github_create_branch),
    "github_create_pull_request": ("github", exec_github_create_pull_request),
    # Google Search Console
    "gsc_list_sites": ("google_search_console", exec_gsc_list_sites),
    "gsc_query_analytics": ("google_search_console", exec_gsc_query_analytics),
    "gsc_list_sitemaps": ("google_search_console", exec_gsc_list_sitemaps),
    "gsc_inspect_url": ("google_search_console", exec_gsc_inspect_url),
    # Google Analytics
    "ga_list_properties": ("google_analytics", exec_ga_list_properties),
    "ga_run_report": ("google_analytics", exec_ga_run_report),
    "ga_realtime_report": ("google_analytics", exec_ga_realtime_report),
    # Google Gemini
    "google_gemini_list_models": ("google_gemini", exec_google_gemini_list_models),
    "google_gemini_generate_content": ("google_gemini", exec_google_gemini_generate_content),
    # Twitter
    "twitter_get_me": ("twitter", exec_twitter_get_me),
    "twitter_post_tweet": ("twitter", exec_twitter_post_tweet),
    # TikTok
    "tiktok_get_profile": ("tiktok", exec_tiktok_get_profile),
    "tiktok_init_video_post": ("tiktok", exec_tiktok_init_video_post),
    "tiktok_get_publish_status": ("tiktok", exec_tiktok_get_publish_status),
}


def get_tools_for_connections(active_services: list[str]) -> list[dict]:
    """Given a list of active service names, return all tool definitions for those services."""
    tools = []
    for svc in active_services:
        if svc in SERVICE_TOOLS:
            tools.extend(SERVICE_TOOLS[svc])
    return tools


async def execute_tool(tool_name: str, args: dict, tokens: dict[str, str]) -> str:
    """
    Execute a tool call. 
    Args:
        tool_name: The function name from the LLM's tool_call
        args: The parsed arguments dict
        tokens: Dict mapping service name -> access_token
    Returns:
        The tool result as a string
    """
    if tool_name not in TOOL_EXECUTORS:
        return json.dumps({"error": f"Unknown tool: {tool_name}"})
    
    service, executor = TOOL_EXECUTORS[tool_name]
    token = tokens.get(service)
    if not token:
        return json.dumps({"error": f"No {service} connection found. Please connect {service} in the Connections page first."})
    
    try:
        return await executor(token, args)
    except Exception as e:
        logger.error(f"Tool execution error for {tool_name}: {e}")
        return json.dumps({"error": f"Tool execution failed: {str(e)}"})


def build_tools_system_prompt_addon(active_services: list[str]) -> str:
    """Build additional system prompt text describing the agent's connected services and capabilities."""
    if not active_services:
        return ""
    
    service_descriptions = {
        "github": "GitHub (list repos, browse files, read/write code, create branches, open PRs, manage issues, search code, view commits)",
        "google_search_console": "Google Search Console (list sites, query search analytics with clicks/impressions/CTR/position data, list sitemaps, inspect URL index status)",
        "google_analytics": "Google Analytics 4 (list properties, run reports with metrics like sessions/users/pageviews by dimensions like page/source/country, real-time data)",
        "google_gemini": "Google Gemini (generate text/content and list available Gemini models)",
        "twitter": "X/Twitter (read account info and publish tweets)",
        "tiktok": "TikTok (read profile and publish videos from hosted URLs)",
    }
    
    connected = [service_descriptions.get(s, s) for s in active_services if s in service_descriptions]
    if not connected:
        return ""
    
    return (
        "\n\n--- CONNECTED SERVICES ---\n"
        "You have REAL access to the following services through function calling. "
        "Use these tools to fulfill user requests. Do not say you cannot access external services.\n"
        + "\n".join(f"- {c}" for c in connected)
        + "\n\nExecution policy:\n"
        "- For website/code changes: create a new branch, update files on that branch, then open a pull request.\n"
        "- For growth tasks: analyze data first (GSC/GA), then execute targeted updates and/or social posts.\n"
        "- Prefer concrete actions over generic advice when tools are available.\n"
        "\nWhen the user asks you to read data, check analytics, update code, or publish content, "
        "USE THE TOOLS. Call the appropriate function. Do not tell the user you cannot do it.\n"
        "--- END CONNECTED SERVICES ---\n"
    )
