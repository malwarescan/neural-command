#!/usr/bin/env python3
"""
Neural Command — Production API Server
FastAPI backend connecting to Supabase, OpenAI, and Stripe.
"""

import hashlib
import logging
import os
import secrets
import time
import urllib.parse
from contextlib import asynccontextmanager
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
import json as json_module
import openai
import stripe
from fastapi import FastAPI, HTTPException, Request, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr

from agent_tools import (
    get_tools_for_connections,
    execute_tool,
    build_tools_system_prompt_addon,
)

# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_PUBLISHABLE_KEY = os.getenv("STRIPE_PUBLISHABLE_KEY", "")

# OAuth Provider Credentials
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
MICROSOFT_CLIENT_ID = os.getenv("MICROSOFT_CLIENT_ID", "")
MICROSOFT_CLIENT_SECRET = os.getenv("MICROSOFT_CLIENT_SECRET", "")
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "")
TWITTER_CLIENT_ID = os.getenv("TWITTER_CLIENT_ID", "")
TWITTER_CLIENT_SECRET = os.getenv("TWITTER_CLIENT_SECRET", "")
META_APP_ID = os.getenv("META_APP_ID", "")
META_APP_SECRET = os.getenv("META_APP_SECRET", "")
TIKTOK_CLIENT_KEY = os.getenv("TIKTOK_CLIENT_KEY", "")
TIKTOK_CLIENT_SECRET = os.getenv("TIKTOK_CLIENT_SECRET", "")
APP_BASE_URL = os.getenv("APP_BASE_URL", "https://agents.croutons.ai")

# ─────────────────────────────────────────────
# OAuth Service Definitions
# ─────────────────────────────────────────────

OAUTH_SERVICES = {
    "google_search_console": {
        "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "scopes": ["https://www.googleapis.com/auth/webmasters.readonly"],
        "client_id_var": "GOOGLE_CLIENT_ID",
        "client_secret_var": "GOOGLE_CLIENT_SECRET",
    },
    "google_analytics": {
        "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "scopes": ["https://www.googleapis.com/auth/analytics.readonly"],
        "client_id_var": "GOOGLE_CLIENT_ID",
        "client_secret_var": "GOOGLE_CLIENT_SECRET",
    },
    "bing_webmaster": {
        "auth_url": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "token_url": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "scopes": ["https://api.bing.com/webmaster/.default", "offline_access"],
        "client_id_var": "MICROSOFT_CLIENT_ID",
        "client_secret_var": "MICROSOFT_CLIENT_SECRET",
    },
    "microsoft_clarity": {
        "auth_url": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "token_url": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "scopes": ["https://graph.microsoft.com/User.Read", "offline_access"],
        "client_id_var": "MICROSOFT_CLIENT_ID",
        "client_secret_var": "MICROSOFT_CLIENT_SECRET",
    },
    "github": {
        "auth_url": "https://github.com/login/oauth/authorize",
        "token_url": "https://github.com/login/oauth/access_token",
        "scopes": ["repo", "workflow"],
        "client_id_var": "GITHUB_CLIENT_ID",
        "client_secret_var": "GITHUB_CLIENT_SECRET",
    },
    "twitter": {
        "auth_url": "https://twitter.com/i/oauth2/authorize",
        "token_url": "https://api.twitter.com/2/oauth2/token",
        "scopes": ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"],
        "client_id_var": "TWITTER_CLIENT_ID",
        "client_secret_var": "TWITTER_CLIENT_SECRET",
        "pkce": True,
    },
    "facebook": {
        "auth_url": "https://www.facebook.com/v19.0/dialog/oauth",
        "token_url": "https://graph.facebook.com/v19.0/oauth/access_token",
        "scopes": ["pages_manage_posts", "pages_read_engagement", "pages_show_list"],
        "client_id_var": "META_APP_ID",
        "client_secret_var": "META_APP_SECRET",
    },
    "instagram": {
        "auth_url": "https://www.facebook.com/v19.0/dialog/oauth",
        "token_url": "https://graph.facebook.com/v19.0/oauth/access_token",
        "scopes": ["instagram_basic", "instagram_content_publish", "pages_show_list"],
        "client_id_var": "META_APP_ID",
        "client_secret_var": "META_APP_SECRET",
    },
    "tiktok": {
        "auth_url": "https://www.tiktok.com/v2/auth/authorize",
        "token_url": "https://open.tiktokapis.com/v2/oauth/token/",
        "scopes": ["user.info.basic", "video.publish", "video.upload"],
        "client_id_var": "TIKTOK_CLIENT_KEY",
        "client_secret_var": "TIKTOK_CLIENT_SECRET",
    },
}

# Temporary OAuth state storage (in production, use Redis)
_oauth_states: dict[str, dict] = {}

# ─────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger("neural-command")

# ─────────────────────────────────────────────
# SDK Clients
# ─────────────────────────────────────────────
openai_client = openai.AsyncOpenAI(api_key=OPENAI_API_KEY)
stripe.api_key = STRIPE_SECRET_KEY

# Global Stripe price IDs (resolved at startup)
STRIPE_PRICES: dict[str, str] = {}

# ─────────────────────────────────────────────
# Helpers — Supabase HTTP
# ─────────────────────────────────────────────

def sb_headers_anon() -> dict:
    return {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "Content-Type": "application/json",
    }


def sb_headers_service() -> dict:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def sb_headers_user(token: str) -> dict:
    return {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


async def sb_get(path: str, params: dict = None, token: str = None) -> Any:
    """GET Supabase REST. Uses service role unless user token provided."""
    headers = sb_headers_user(token) if token else sb_headers_service()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{SUPABASE_URL}{path}", headers=headers, params=params)
        r.raise_for_status()
        return r.json()


async def sb_post(path: str, data: dict, token: str = None) -> Any:
    headers = sb_headers_user(token) if token else sb_headers_service()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(f"{SUPABASE_URL}{path}", headers=headers, json=data)
        r.raise_for_status()
        return r.json()


async def sb_patch(path: str, params: dict, data: dict, token: str = None) -> Any:
    headers = sb_headers_user(token) if token else sb_headers_service()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.patch(
            f"{SUPABASE_URL}{path}", headers=headers, params=params, json=data
        )
        r.raise_for_status()
        return r.json()


async def sb_delete(path: str, params: dict, token: str = None) -> Any:
    headers = sb_headers_user(token) if token else sb_headers_service()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.delete(
            f"{SUPABASE_URL}{path}", headers=headers, params=params
        )
        r.raise_for_status()
        return r.json()


# ─────────────────────────────────────────────
# Auth Middleware Helper
# ─────────────────────────────────────────────

async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    """Verify JWT by calling Supabase /auth/v1/user. Returns user dict."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.split(" ", 1)[1]
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {token}",
            },
        )
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        user = r.json()
        user["_token"] = token
        return user


# ─────────────────────────────────────────────
# Cost Calculation
# ─────────────────────────────────────────────

MODEL_COSTS = {
    "gpt-4o":         {"input": 2.50,  "output": 10.00},
    "gpt-4o-mini":    {"input": 0.15,  "output": 0.60},
    "gpt-3.5-turbo":  {"input": 0.50,  "output": 1.50},
}


def calculate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> tuple[float, float]:
    """Returns (cost_usd, price_usd). price is 2x cost."""
    rates = MODEL_COSTS.get(model, MODEL_COSTS["gpt-4o-mini"])
    cost = (prompt_tokens / 1_000_000) * rates["input"] + (completion_tokens / 1_000_000) * rates["output"]
    price = cost * 2
    return round(cost, 8), round(price, 8)


# ─────────────────────────────────────────────
# Templates
# ─────────────────────────────────────────────

TEMPLATES = [
    {
        "id": "seo",
        "name": "SEO Analyst",
        "icon": "search",
        "description": "Audits websites, tracks rankings, and recommends SEO optimizations",
        "tags": ["seo", "marketing", "analytics"],
        "default_goals": ["Analyze on-page SEO", "Identify keyword opportunities", "Monitor backlinks"],
        "default_system_prompt": (
            "You are an expert SEO analyst with deep knowledge of search engine optimization, "
            "technical SEO, content strategy, and keyword research. You audit websites, track "
            "rankings, identify optimization opportunities, and provide actionable recommendations "
            "to improve organic search visibility. Always provide specific, data-driven advice."
        ),
    },
    {
        "id": "social",
        "name": "Social Media Strategist",
        "icon": "share-2",
        "description": "Monitors engagement, suggests content, and analyzes social trends",
        "tags": ["social", "marketing", "content"],
        "default_goals": ["Monitor brand mentions", "Suggest viral content ideas", "Analyze engagement"],
        "default_system_prompt": (
            "You are a seasoned social media strategist specializing in audience growth, "
            "content virality, and community engagement across platforms (Instagram, X/Twitter, "
            "LinkedIn, TikTok, Facebook). You analyze trends, suggest content ideas, schedule "
            "posts strategically, and measure ROI. You know each platform's algorithm deeply."
        ),
    },
    {
        "id": "sales",
        "name": "Sales Assistant",
        "icon": "briefcase",
        "description": "Qualifies leads, drafts outreach emails, and tracks pipeline",
        "tags": ["sales", "crm", "outreach"],
        "default_goals": ["Qualify inbound leads", "Draft personalized outreach", "Track deal stage"],
        "default_system_prompt": (
            "You are an elite sales assistant with expertise in B2B sales, lead qualification, "
            "CRM management, and persuasive communication. You help qualify prospects using "
            "BANT/MEDDIC frameworks, draft compelling outreach emails, create follow-up sequences, "
            "and analyze pipeline health. You understand buyer psychology and objection handling."
        ),
    },
    {
        "id": "support",
        "name": "Customer Support Agent",
        "icon": "headphones",
        "description": "Triages support tickets and suggests resolutions",
        "tags": ["support", "customer success", "help desk"],
        "default_goals": ["Triage incoming tickets", "Suggest resolutions", "Escalate critical issues"],
        "default_system_prompt": (
            "You are a skilled customer support specialist focused on delivering exceptional "
            "customer experiences. You triage tickets by priority and category, suggest accurate "
            "resolutions based on knowledge base articles, identify trends in support requests, "
            "and know when to escalate. You communicate with empathy and clarity."
        ),
    },
    {
        "id": "content",
        "name": "Content Strategist",
        "icon": "pen-tool",
        "description": "Generates content ideas, drafts articles, and manages editorial calendar",
        "tags": ["content", "writing", "editorial"],
        "default_goals": ["Generate content ideas", "Draft long-form articles", "Manage content calendar"],
        "default_system_prompt": (
            "You are a professional content strategist and writer with expertise in creating "
            "engaging, SEO-optimized content across formats (blog posts, whitepapers, case studies, "
            "newsletters, social copy). You develop content strategies aligned with business goals, "
            "manage editorial calendars, and ensure consistent brand voice and messaging."
        ),
    },
    {
        "id": "analytics",
        "name": "Data Analyst",
        "icon": "bar-chart-3",
        "description": "Tracks metrics, generates reports, and identifies anomalies",
        "tags": ["analytics", "data", "reporting"],
        "default_goals": ["Track KPIs", "Generate weekly reports", "Detect metric anomalies"],
        "default_system_prompt": (
            "You are a data analyst specializing in business intelligence, metric tracking, "
            "and performance reporting. You analyze datasets, identify trends and anomalies, "
            "create clear data visualizations descriptions, and translate numbers into actionable "
            "business insights. You are proficient with SQL, Python, and BI tools."
        ),
    },
    {
        "id": "custom",
        "name": "Custom Agent",
        "icon": "settings",
        "description": "Fully customizable agent with your own system prompt and goals",
        "tags": ["custom", "flexible"],
        "default_goals": ["Define your own goals"],
        "default_system_prompt": "You are a helpful AI assistant. Your instructions will be customized by the user.",
    },
    {
        "id": "ai_retrieval",
        "name": "AI Search Optimizer",
        "icon": "<i data-lucide=\"brain-circuit\" style=\"width:32px;height:32px\"></i>",
        "description": "Optimizes content for AI search engines using Croutonization, fan-out coverage, and retrieval surface engineering",
        "tags": ["seo", "aeo", "geo", "ai-search", "croutons"],
        "default_goals": [
            "Croutonize content for AI retrieval",
            "Maximize fan-out coverage",
            "Build retrieval surfaces",
            "Track citation probability",
        ],
        "default_system_prompt": (
            "ROLE: AI Retrieval Optimization Operator\n"
            "PLATFORM: Croutons Agents by Croutons.ai\n"
            "MISSION: Produce AI-visible knowledge assets and distribute them across all retrieval surfaces to maximize citation probability in ChatGPT, Perplexity, Claude, Gemini, and Copilot.\n"
            "\n"
            "## CORE DOCTRINE: CROUTONIZATION\n"
            "Croutonization converts raw content into atomic, machine-parseable knowledge units called croutons. Each crouton contains:\n"
            "- FACT: exactly one verifiable claim (no compound claims)\n"
            "- CONTEXT: the minimum context needed to interpret the fact independently\n"
            "- APPLICATION: how to use the fact operationally\n"
            "- SOURCE: the source URL with source_type and confidence\n"
            "Crouton schema: {crouton_id, entity_primary, entities[], fact, context, application, source_url, source_type, tags[], confidence}\n"
            "\n"
            "## CROUTON WRITING RULES (ALL MANDATORY)\n"
            "1. One claim per fact - no compound claims. Split 'X does A and Y does B' into two croutons.\n"
            "2. No pronouns without antecedents - every entity reference uses the canonical entity name.\n"
            "3. All numbers and dates must be specific - replace 'many' with a number, 'recently' with a date.\n"
            "4. Consistent entity naming - use the same canonical name every single time.\n"
            "5. Self-contained test - the crouton must make complete sense when extracted from all surrounding context.\n"
            "\n"
            "## FAN-OUT ENGINE MODEL\n"
            "AI search systems expand a single user prompt into 1-3 (standard) or 10-30+ (deep search) parallel queries. Each query targets a different aspect, synonym cluster, or entity variant. Results are merged via Reciprocal Rank Fusion (RRF). Your content must appear in multiple query stream results to score highly in RRF merges.\n"
            "Fan-out workflow:\n"
            "- Step 0 (Sonic Prediction): Determine which queries will trigger web retrieval vs training data\n"
            "- Step 1 (Prompt Mining): Collect 100+ query variants from autocomplete, PAA, AI chatbots\n"
            "- Step 2 (Fan-Out Expansion): Distill into a cluster of 30-50 distinct query forms\n"
            "- Step 3 (Croutonization): Convert content into atomic croutons mapped to each query\n"
            "- Step 4 (Page Assembly): Build page using Hero Answer > TLDR > Croutons > FAQ > Entities > Machine Layer\n"
            "- Step 5 (Title/Meta): Primary Question | Secondary Context | Brand; 140-155 char meta, answer-first\n"
            "- Step 6 (Schema): WebPage + BreadcrumbList + Organization + Article + FAQPage + HowTo; dateModified required\n"
            "- Step 7 (NDJSON): Export all croutons as NDJSON stream\n"
            "- Step 8 (Surface Distribution): Deploy to 5+ retrieval surfaces\n"
            "- Step 9 (Measurement): Track FanOutCoverage, InferenceCostScore, RetrievalAdvantage\n"
            "- Step 10 (Maintenance): Update cadence plan; 7/30/365-day freshness windows\n"
            "\n"
            "## 5 RETRIEVAL SIGNALS\n"
            "1. FanOutCoverage = covered_queries / total_queries (target >0.75)\n"
            "2. InferenceCostScore: sum of six 0-5 sub-scores (atomicity, context, structure, ambiguity, entity clarity, freshness); lower is better\n"
            "3. EntityAuthority: degree of external knowledge graph representation (Wikipedia, Wikidata, Crunchbase, sameAs links)\n"
            "4. RetrievalSurfaceCount: number of distinct retrieval surfaces (web page, FAQPage schema, NDJSON, JSON-LD graph, HowTo/Product/News schema)\n"
            "5. Recency Eligibility: dateModified within the relevant freshness window (7/30/365 days)\n"
            "\n"
            "## RETRIEVAL PROBABILITY FORMULA\n"
            "retrieval_probability = FanOutCoverage x RetrievalAdvantage x EntityAuthority x RetrievalSurfaceCount\n"
            "RetrievalAdvantage = 1 / (1 + InferenceCostScore)\n"
            "All factors are multiplicative. A score of 0 on any single factor produces a composite score of 0.\n"
            "\n"
            "## CONTENT ARCHITECTURE (MANDATORY ORDER)\n"
            "Hero Answer (40-60 words, direct answer) > TLDR (3-5 bullets) > Crouton Blocks (atomic fact sections) > Explanation Layer > Operator Playbook (numbered steps, triggers HowTo schema) > Measurement > FAQ (5-10 Q&A from fan-out cluster) > Entities (canonical names + sameAs) > References > Machine Layer Output (NDJSON stream + JSON-LD @graph)\n"
            "\n"
            "## TITLE AND META RULES\n"
            "Title format: Primary Question | Secondary Context | Brand\n"
            "Meta format: 140-155 chars, answer-first clause, include secondary synonym, include brand name\n"
            "Meta descriptions are used directly by ChatGPT and Perplexity for content previewing.\n"
            "\n"
            "## ENTERPRISE SCHEMA STACK (ALL REQUIRED)\n"
            "WebPage (or subtype), BreadcrumbList, Organization (with sameAs to Wikipedia/Wikidata/Crunchbase), Article/TechArticle (with dateModified), FAQPage (5-10 Q&A), HowTo (for process pages)\n"
            "All schema nodes: stable @id URLs, dateModified on every page, sameAs links on Organization\n"
            "\n"
            "## PROVIDERS ECOSYSTEM\n"
            "ChatGPT: uses SerpAPI (scrapes Google) for web, SearchAPI.io for Shopping (Mercury pipeline), Labrador/Bright for images\n"
            "Copilot: uses Bing web index directly (separate indexing required via Bing Webmaster Tools)\n"
            "Perplexity: uses Bing as primary web provider\n"
            "Recency filters: 7 days (breaking), 30 days (news), 365 days (established topics)\n"
            "\n"
            "## QUALITY GATES (NON-NEGOTIABLE)\n"
            "1. Atomicity check: each fact contains exactly one claim\n"
            "2. Retrieval cost check: InferenceCostScore below 10\n"
            "3. Entity consistency check: canonical entity names used throughout\n"
            "4. Freshness check: dateModified set to current date\n"
            "5. Surface multiplication check: minimum five retrieval surfaces implemented\n"
            "\n"
            "## NON-NEGOTIABLE OUTPUT STANDARD\n"
            "Every optimization output MUST include all nine deliverables:\n"
            "1. Knowledge page in full content architecture format\n"
            "2. Crouton set (minimum 10 croutons in NDJSON schema)\n"
            "3. FAQ set (minimum 5 question-answer pairs)\n"
            "4. Schema graph (JSON-LD @graph with all required types)\n"
            "5. NDJSON stream (all croutons as valid NDJSON)\n"
            "6. Entity map (all entities with canonical names and sameAs links)\n"
            "7. Surface distribution plan (which surfaces, implementation steps)\n"
            "8. Measurement plan (FanOutCoverage, InferenceCostScore, RetrievalAdvantage targets)\n"
            "9. Update cadence plan (7/30/365-day tier assignment and update schedule)\n"
            "\n"
            "## CITATION vs INFLUENCE\n"
            "Explicit citations [1][2][3]: inline citations in AI responses, generate referral traffic. Target these.\n"
            "Implicit grounding (ref_type: academia): used for knowledge grounding but never shown to users. Wikipedia, arXiv qualify here.\n"
            "Commercial content earns explicit citations; academic format earns only implicit grounding.\n"
            "\n"
            "## SHOPPING / MERCURY PIPELINE\n"
            "ChatGPT shopping uses Mercury pipeline via SearchAPI.io from Google Shopping. Requirements: Product schema with price, availability, brand, sku, image; accurate Google Merchant Center feed; prices matching between page and feed; AggregateRating schema when reviews exist.\n"
            "\n"
            "## MAPS / LOCAL READINESS\n"
            "Requirements: verified Google Business Profile with complete NAP (name, address, phone); LocalBusiness schema with @id, name, address, telephone, openingHours, geo; citations on Yelp, TripAdvisor, Apple Maps Connect; consistent NAP across all directories.\n"
            "\n"
            "## ENTITY ANCHORING\n"
            "Define canonical entity names. Use them identically in: title, meta, H1, first paragraph, schema, and all crouton facts. Add sameAs links in Organization schema to Wikipedia, Wikidata, Crunchbase. Build external entity presence: Wikipedia page, Wikidata entry, Crunchbase profile, LinkedIn company page.\n"
            "\n"
            "## TECHNICAL REQUIREMENTS\n"
            "AI crawlers (ChatGPT, Claude, Gemini) do NOT execute JavaScript. Add noscript tags with full static HTML. Use SSR or SSG for key pages. Copilot executes JS with ~53ms timeout; Grok with 1-2s timeout. Always include both Google and Bing indexing."
        ),
    },
]

# Search Ops-first template catalog for UI/wizard positioning.
SEARCH_OPS_TEMPLATES = [
    {
        "id": "seo",
        "name": "SEO Watcher Agent",
        "icon": "search",
        "description": "Monitors GSC and Bing signals, detects ranking opportunities, and proposes SEO upgrades.",
        "tags": ["seo", "observe", "diagnose"],
        "default_goals": [
            "Monitor ranking and impression changes",
            "Detect pages that need refresh",
            "Surface high-intent query clusters",
        ],
    },
    {
        "id": "ai_retrieval",
        "name": "Citation Hunter Agent",
        "icon": "brain-circuit",
        "description": "Finds citation gaps, AI overview weaknesses, and missing entities/format coverage.",
        "tags": ["aeo", "geo", "citation-gap"],
        "default_goals": [
            "Track citation probability by topic",
            "Detect missing entities and questions",
            "Recommend listicle/FAQ/comparison actions",
        ],
    },
    {
        "id": "analytics",
        "name": "Competitor Surveillance Agent",
        "icon": "swords",
        "description": "Watches competitor launches, structure patterns, and citation wins to trigger counter-moves.",
        "tags": ["competitor", "signals", "intel"],
        "default_goals": [
            "Detect competitor content launches",
            "Track competitor citation wins",
            "Recommend counter-content plans",
        ],
    },
    {
        "id": "content",
        "name": "Content Expansion Agent",
        "icon": "pen-tool",
        "description": "Turns signal clusters into publishable listicles, FAQ blocks, and support assets.",
        "tags": ["content", "execute", "distribution"],
        "default_goals": [
            "Generate listicles and comparison pages",
            "Build FAQ support clusters",
            "Create distribution-ready support copy",
        ],
    },
    {
        "id": "schema_optimizer",
        "name": "Schema Optimizer Agent",
        "icon": "braces",
        "description": "Finds structured data and retrieval markup gaps and prepares schema patches.",
        "tags": ["schema", "technical-seo", "retrieval"],
        "default_goals": [
            "Find FAQ/schema gaps on priority pages",
            "Recommend entity-rich JSON-LD upgrades",
            "Track schema coverage completeness",
        ],
    },
    {
        "id": "distribution_operator",
        "name": "Distribution Agent",
        "icon": "share-2",
        "description": "Generates and distributes support content after publication or opportunity triggers.",
        "tags": ["distribution", "social", "execute"],
        "default_goals": [
            "Create post-publication social packs",
            "Generate thread-style distribution assets",
            "Track engagement from distributed actions",
        ],
    },
    {
        "id": "recovery_operator",
        "name": "Recovery Agent",
        "icon": "refresh-ccw",
        "description": "Recovers declining pages with targeted refresh, FAQ/schema, and internal linking actions.",
        "tags": ["recovery", "rankings", "refresh"],
        "default_goals": [
            "Detect declining pages",
            "Plan recovery refresh actions",
            "Measure post-refresh ranking lift",
        ],
    },
    {
        "id": "full_search_operator",
        "name": "Full Search Operator",
        "icon": "radar",
        "description": "Runs the full Observe -> Diagnose -> Plan -> Execute -> Measure loop across channels.",
        "tags": ["full-stack", "search-ops-os", "autonomous"],
        "default_goals": [
            "Detect opportunities across sources",
            "Execute site and distribution actions",
            "Measure visibility outcomes continuously",
        ],
    },
    {
        "id": "custom_search_operator",
        "name": "Custom Search Operator",
        "icon": "settings",
        "description": "Build a custom operator with your own watch scopes, guardrails, and success metrics.",
        "tags": ["custom", "operator"],
        "default_goals": ["Define a custom search operations strategy"],
    },
]

TEMPLATE_PROMPTS = {t["id"]: t["default_system_prompt"] for t in TEMPLATES}

# ─────────────────────────────────────────────
# Core AI Doctrine — injected into every agent system prompt
# ─────────────────────────────────────────────

CORE_AI_DOCTRINE = """
--- CORE AI SEARCH DOCTRINE (Croutons Agents) ---
You operate on the Croutons Agents platform by Croutons.ai. Every response you produce must
follow the AI Search Bible doctrine for maximum AI retrieval visibility.

CROUTONIZATION: Decompose information into atomic units — one claim per crouton, no pronouns
without explicit antecedents, specific numbers and dates, consistent entity names, self-contained facts.

FAN-OUT MODEL: AI search systems generate 1-30+ parallel queries from a single user prompt.
Content must answer all query variants in a topic cluster, not just the primary query. Target
FanOutCoverage > 0.75 (covered queries / total cluster size).

5 RETRIEVAL SIGNALS:
1. FanOutCoverage = covered_queries / total_queries
2. InferenceCostScore (six 0-5 sub-scores: atomicity, context, structure, ambiguity, entity clarity, freshness; lower is better)
3. EntityAuthority (Wikipedia, Wikidata, Crunchbase, sameAs representation)
4. RetrievalSurfaceCount (web page + FAQPage + NDJSON + JSON-LD + HowTo/Product/News schema)
5. Recency Eligibility (dateModified within 7/30/365-day freshness window)

CROUTON FORMAT: {fact: [single claim], context: [interpretive context], application: [operational use], source: [URL]}

CONTENT ARCHITECTURE: Hero Answer (40-60w) > TLDR > Crouton Blocks > Explanation > Operator Playbook > Measurement > FAQ > Entities > References > Machine Layer (NDJSON + JSON-LD)

NON-NEGOTIABLE OUTPUTS: Every optimization task must produce: knowledge page, crouton set (min 10),
FAQ set (min 5), schema graph, NDJSON stream, entity map, surface distribution plan, measurement plan, update cadence plan.
--- END DOCTRINE ---
"""


# ─────────────────────────────────────────────
# Startup — Stripe Product/Price Setup
# ─────────────────────────────────────────────

async def setup_stripe_products():
    """Ensure Pro and Enterprise Stripe products/prices exist."""
    global STRIPE_PRICES
    try:
        # Look for existing products
        products = stripe.Product.list(limit=100)
        existing = {p.name: p for p in products.data if p.active}

        pro_product = existing.get("Neural Command Pro")
        enterprise_product = existing.get("Neural Command Enterprise")

        if not pro_product:
            pro_product = stripe.Product.create(
                name="Neural Command Pro",
                description="Neural Command Pro — 500 API calls/month, 10 agents",
            )
            logger.info("Created Stripe product: Neural Command Pro")

        if not enterprise_product:
            enterprise_product = stripe.Product.create(
                name="Neural Command Enterprise",
                description="Neural Command Enterprise — Unlimited API calls, unlimited agents",
            )
            logger.info("Created Stripe product: Neural Command Enterprise")

        # Find existing prices for each product
        def get_or_create_price(product_id: str, amount: int, nickname: str) -> str:
            prices = stripe.Price.list(product=product_id, active=True, limit=10)
            for p in prices.data:
                if p.unit_amount == amount and p.recurring and p.recurring.interval == "month":
                    return p.id
            price = stripe.Price.create(
                product=product_id,
                unit_amount=amount,
                currency="usd",
                recurring={"interval": "month"},
                nickname=nickname,
            )
            logger.info(f"Created Stripe price {nickname}: {price.id}")
            return price.id

        STRIPE_PRICES["pro"] = get_or_create_price(pro_product.id, 2900, "Pro Monthly")
        STRIPE_PRICES["enterprise"] = get_or_create_price(enterprise_product.id, 9900, "Enterprise Monthly")
        logger.info(f"Stripe prices ready: {STRIPE_PRICES}")

    except Exception as e:
        logger.error(f"Stripe setup error: {e}")


# ─────────────────────────────────────────────
# App Lifespan
# ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Neural Command API starting up…")
    await setup_stripe_products()
    logger.info("Startup complete. Server ready.")
    yield
    logger.info("Neural Command API shutting down.")


# ─────────────────────────────────────────────
# FastAPI App
# ─────────────────────────────────────────────

app = FastAPI(
    title="Neural Command API",
    version="1.0.0",
    description="Production backend for the Neural Command AI agent SaaS platform",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────
# Pydantic Models
# ─────────────────────────────────────────────

class SignupRequest(BaseModel):
    email: str
    password: str
    display_name: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


class ProfileUpdateRequest(BaseModel):
    display_name: Optional[str] = None


class AgentCreateRequest(BaseModel):
    name: str
    description: Optional[str] = ""
    template_id: Optional[str] = "custom"
    model: Optional[str] = "gpt-4o-mini"
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 1024
    system_prompt: Optional[str] = None
    goals: Optional[list] = []
    schedule: Optional[str] = None
    rules: Optional[Any] = []
    data_scope: Optional[dict] = None
    automation_mode: Optional[str] = None
    approval_rules: Optional[dict] = None
    execution_permissions: Optional[dict] = None
    allowed_targets: Optional[dict] = None
    lifecycle_state: Optional[str] = None
    success_metrics: Optional[list] = None


class AgentUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    system_prompt: Optional[str] = None
    goals: Optional[list] = None
    schedule: Optional[str] = None
    rules: Optional[Any] = None
    data_scope: Optional[dict] = None
    automation_mode: Optional[str] = None
    approval_rules: Optional[dict] = None
    execution_permissions: Optional[dict] = None
    allowed_targets: Optional[dict] = None
    lifecycle_state: Optional[str] = None
    success_metrics: Optional[list] = None


def _normalize_data_scope(data_scope: Any) -> dict:
    """Normalize selected data scope for an agent."""
    if not isinstance(data_scope, dict):
        return {}

    cleaned = {}
    github_repo = (data_scope.get("github_repo") or "").strip()
    gsc_site = (data_scope.get("gsc_site") or "").strip()
    bing_site = (data_scope.get("bing_site") or "").strip()

    if github_repo:
        cleaned["github_repo"] = github_repo
    if gsc_site:
        cleaned["gsc_site"] = gsc_site
    if bing_site:
        cleaned["bing_site"] = bing_site
    return cleaned


def _extract_rule_text_rules(raw_rules: Any) -> list[str]:
    """Return text rule list from legacy/new rules payloads."""
    if isinstance(raw_rules, list):
        return [str(r).strip() for r in raw_rules if str(r).strip()]
    if isinstance(raw_rules, dict):
        text_rules = raw_rules.get("text_rules")
        if isinstance(text_rules, list):
            return [str(r).strip() for r in text_rules if str(r).strip()]
    return []


def _extract_data_scope(raw_rules: Any) -> dict:
    """Return data scope from rules payload."""
    if isinstance(raw_rules, dict):
        return _normalize_data_scope(raw_rules.get("data_scope"))
    return {}


def _normalize_operator_settings(raw_settings: Any) -> dict:
    """Normalize operator guardrails and automation config."""
    if not isinstance(raw_settings, dict):
        return {}
    automation_mode = (raw_settings.get("automation_mode") or "").strip()
    lifecycle_state = (raw_settings.get("lifecycle_state") or "").strip()
    approval_rules = raw_settings.get("approval_rules") if isinstance(raw_settings.get("approval_rules"), dict) else {}
    execution_permissions = raw_settings.get("execution_permissions") if isinstance(raw_settings.get("execution_permissions"), dict) else {}
    allowed_targets = raw_settings.get("allowed_targets") if isinstance(raw_settings.get("allowed_targets"), dict) else {}
    success_metrics = raw_settings.get("success_metrics") if isinstance(raw_settings.get("success_metrics"), list) else []

    cleaned = {
        "automation_mode": automation_mode or "approval_publish_distribution",
        "approval_rules": approval_rules,
        "execution_permissions": execution_permissions,
        "allowed_targets": allowed_targets,
        "lifecycle_state": lifecycle_state or "Watching",
        "success_metrics": [str(x).strip() for x in success_metrics if str(x).strip()],
    }
    return cleaned


def _extract_operator_settings(raw_rules: Any) -> dict:
    if isinstance(raw_rules, dict):
        return _normalize_operator_settings(raw_rules.get("operator_settings"))
    return _normalize_operator_settings({})


def _build_rules_payload(
    raw_rules: Any,
    data_scope: Optional[dict] = None,
    operator_settings: Optional[dict] = None,
) -> dict:
    """Store rules in a backward-compatible object structure."""
    scope = _normalize_data_scope(data_scope)
    text_rules = _extract_rule_text_rules(raw_rules)
    settings = _normalize_operator_settings(operator_settings)

    # Preserve existing scope if caller didn't explicitly provide one.
    if not scope:
        scope = _extract_data_scope(raw_rules)
    if not settings:
        settings = _extract_operator_settings(raw_rules)

    return {"text_rules": text_rules, "data_scope": scope, "operator_settings": settings}


def _build_scope_prompt_addon(scope: dict) -> str:
    if not scope:
        return ""
    parts = []
    if scope.get("github_repo"):
        parts.append(f"- GitHub repo: {scope['github_repo']}")
    if scope.get("gsc_site"):
        parts.append(f"- Google Search Console property: {scope['gsc_site']}")
    if scope.get("bing_site"):
        parts.append(f"- Bing Webmaster property: {scope['bing_site']}")
    if not parts:
        return ""
    return (
        "\n\n--- AGENT DATA SCOPE ---\n"
        "You are scoped to these selected assets. Prefer these targets for analysis and actions:\n"
        + "\n".join(parts)
        + "\nDo not switch to other repos/properties unless the user explicitly asks.\n"
        "--- END AGENT DATA SCOPE ---\n"
    )


def _apply_scope_to_tool_args(tool_name: str, tool_args: dict, scope: dict) -> dict:
    """Inject selected scope defaults into tool calls."""
    args = dict(tool_args or {})

    github_repo = (scope.get("github_repo") or "").strip()
    if github_repo and tool_name.startswith("github_") and "/" in github_repo:
        owner, repo = github_repo.split("/", 1)
        args["owner"] = owner
        args["repo"] = repo

    gsc_site = (scope.get("gsc_site") or "").strip()
    if gsc_site and tool_name.startswith("gsc_"):
        args["site_url"] = gsc_site

    return args


async def _resolve_command_center_scope(
    user_id: str,
    scope_mode: str = "site",
    agent_id: Optional[str] = None,
    github_repo: Optional[str] = None,
    gsc_site: Optional[str] = None,
    bing_site: Optional[str] = None,
) -> dict:
    """Resolve command-center scope from agent/site selection."""
    mode = (scope_mode or "site").strip().lower()
    resolved = {
        "mode": mode if mode in ("agent", "site") else "site",
        "agent_id": None,
        "agent_name": None,
        "github_repo": (github_repo or "").strip(),
        "gsc_site": (gsc_site or "").strip(),
        "bing_site": (bing_site or "").strip(),
    }

    if resolved["mode"] == "agent" and agent_id:
        rows = await sb_get(
            "/rest/v1/agents",
            params={"id": f"eq.{agent_id}", "user_id": f"eq.{user_id}", "limit": "1"},
        )
        if rows:
            agent = rows[0]
            resolved["agent_id"] = agent.get("id")
            resolved["agent_name"] = agent.get("name")
            agent_scope = _extract_data_scope(agent.get("rules"))
            if not resolved["github_repo"]:
                resolved["github_repo"] = agent_scope.get("github_repo", "")
            if not resolved["gsc_site"]:
                resolved["gsc_site"] = agent_scope.get("gsc_site", "")
            if not resolved["bing_site"]:
                resolved["bing_site"] = agent_scope.get("bing_site", "")

    return resolved


def _decorate_agent_operator_fields(agent: dict) -> dict:
    """Expose operator guardrail fields at top-level for frontend convenience."""
    if not isinstance(agent, dict):
        return agent
    decorated = dict(agent)
    settings = _extract_operator_settings(agent.get("rules"))
    decorated["automation_mode"] = settings.get("automation_mode")
    decorated["approval_rules"] = settings.get("approval_rules", {})
    decorated["execution_permissions"] = settings.get("execution_permissions", {})
    decorated["allowed_targets"] = settings.get("allowed_targets", {})
    decorated["lifecycle_state"] = settings.get("lifecycle_state", "Watching")
    decorated["success_metrics"] = settings.get("success_metrics", [])
    return decorated


class AgentRunRequest(BaseModel):
    input_data: dict  # must contain "message" key


class AgentChatRequest(BaseModel):
    message: str


class ConnectionRequest(BaseModel):
    service: str
    credentials: dict


class CheckoutRequest(BaseModel):
    plan: str  # "pro" or "enterprise"
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


class WaitlistRequest(BaseModel):
    email: str


# ─────────────────────────────────────────────
# AUTH ENDPOINTS
# ─────────────────────────────────────────────

@app.post("/api/auth/signup")
async def auth_signup(body: SignupRequest):
    """Register a new user via Supabase Auth."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"{SUPABASE_URL}/auth/v1/signup",
                headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                json={
                    "email": body.email,
                    "password": body.password,
                    "data": {"display_name": body.display_name or body.email.split("@")[0]},
                },
            )
            if r.status_code not in (200, 201):
                detail = r.json().get("msg") or r.json().get("error_description") or "Signup failed"
                raise HTTPException(status_code=r.status_code, detail=detail)
            data = r.json()

        # If email confirmation is disabled, session is returned immediately
        return {
            "user": data.get("user"),
            "session": data.get("session"),
            "message": "Signup successful. Check your email to confirm your account." if not data.get("session") else "Signup successful.",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Signup error: {e}")
        raise HTTPException(status_code=500, detail="Signup failed")


@app.post("/api/auth/login")
async def auth_login(body: LoginRequest):
    """Login via Supabase Auth password grant."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                json={"email": body.email, "password": body.password},
            )
            if r.status_code != 200:
                detail = r.json().get("error_description") or r.json().get("msg") or "Login failed"
                raise HTTPException(status_code=401, detail=detail)
            return r.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error: {e}")
        raise HTTPException(status_code=500, detail="Login failed")


@app.post("/api/auth/logout")
async def auth_logout(user: dict = Depends(get_current_user)):
    """Logout current session."""
    token = user["_token"]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"{SUPABASE_URL}/auth/v1/logout",
                headers={
                    "apikey": SUPABASE_ANON_KEY,
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
            )
        return {"message": "Logged out successfully"}
    except Exception as e:
        logger.error(f"Logout error: {e}")
        return {"message": "Logged out"}


@app.get("/api/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    """Return the current user's profile."""
    user_id = user["id"]
    try:
        rows = await sb_get(
            "/rest/v1/profiles",
            params={"id": f"eq.{user_id}", "limit": "1"},
        )
        if rows:
            return rows[0]
        return {"id": user_id, "email": user.get("email")}
    except Exception as e:
        logger.error(f"auth/me error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch profile")


# ─────────────────────────────────────────────
# PROFILE ENDPOINTS
# ─────────────────────────────────────────────

@app.get("/api/profile")
async def get_profile(user: dict = Depends(get_current_user)):
    user_id = user["id"]
    try:
        rows = await sb_get(
            "/rest/v1/profiles",
            params={"id": f"eq.{user_id}", "limit": "1"},
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Profile not found")
        return rows[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_profile error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch profile")


@app.patch("/api/profile")
async def update_profile(body: ProfileUpdateRequest, user: dict = Depends(get_current_user)):
    user_id = user["id"]
    update_data: dict = {}
    if body.display_name is not None:
        update_data["display_name"] = body.display_name
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    try:
        rows = await sb_patch(
            "/rest/v1/profiles",
            params={"id": f"eq.{user_id}"},
            data=update_data,
        )
        return rows[0] if rows else {"message": "Updated"}
    except Exception as e:
        logger.error(f"update_profile error: {e}")
        raise HTTPException(status_code=500, detail="Failed to update profile")


# ─────────────────────────────────────────────
# AGENTS CRUD
# ─────────────────────────────────────────────

@app.get("/api/agents")
async def list_agents(user: dict = Depends(get_current_user)):
    user_id = user["id"]
    try:
        agents = await sb_get(
            "/rest/v1/agents",
            params={"user_id": f"eq.{user_id}", "order": "created_at.desc"},
        )
        return [_decorate_agent_operator_fields(a) for a in (agents or [])]
    except Exception as e:
        logger.error(f"list_agents error: {e}")
        raise HTTPException(status_code=500, detail="Failed to list agents")


@app.post("/api/agents", status_code=201)
async def create_agent(body: AgentCreateRequest, user: dict = Depends(get_current_user)):
    user_id = user["id"]

    # Check plan limits
    try:
        profile_rows = await sb_get(
            "/rest/v1/profiles",
            params={"id": f"eq.{user_id}", "limit": "1"},
        )
        profile = profile_rows[0] if profile_rows else {}
        agents_limit = profile.get("agents_limit", 3)

        agents_count_rows = await sb_get(
            "/rest/v1/agents",
            params={"user_id": f"eq.{user_id}", "select": "id"},
        )
        current_count = len(agents_count_rows or [])

        if current_count >= agents_limit:
            raise HTTPException(
                status_code=403,
                detail=f"Agent limit reached ({agents_limit}). Upgrade your plan to create more agents.",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_agent limit check error: {e}")

    # Resolve system prompt
    system_prompt = body.system_prompt
    if not system_prompt:
        system_prompt = TEMPLATE_PROMPTS.get(body.template_id or "custom", TEMPLATE_PROMPTS["custom"])

    # Prepend core doctrine to all agent system prompts
    system_prompt = CORE_AI_DOCTRINE + "\n" + system_prompt

    now = datetime.now(timezone.utc).isoformat()
    operator_settings = _normalize_operator_settings({
        "automation_mode": body.automation_mode or "approval_publish_distribution",
        "approval_rules": body.approval_rules or {
            "require_for_all_actions": False,
            "require_for_publish": True,
            "require_for_distribution": True,
            "block_money_pages_without_approval": True,
            "max_executions_per_day": 8,
        },
        "execution_permissions": body.execution_permissions or {
            "draft_content": True,
            "patch_existing_pages": True,
            "create_new_pages": False,
            "apply_schema_only": True,
            "publish_content": False,
            "distribute_social": False,
            "submit_indexing": True,
        },
        "allowed_targets": body.allowed_targets or {
            "site_sections": [],
            "distribution_channels": [],
            "competitor_domains": [],
        },
        "lifecycle_state": body.lifecycle_state or "Watching",
        "success_metrics": body.success_metrics or [],
    })
    agent_data = {
        "user_id": user_id,
        "name": body.name,
        "description": body.description or "",
        "template_id": body.template_id or "custom",
        "status": "active",
        "model": body.model or "gpt-4o-mini",
        "temperature": body.temperature if body.temperature is not None else 0.7,
        "max_tokens": body.max_tokens or 1024,
        "system_prompt": system_prompt,
        "goals": body.goals or [],
        "schedule": body.schedule,
        "rules": _build_rules_payload(body.rules, body.data_scope, operator_settings),
        "total_runs": 0,
        "total_tokens_used": 0,
        "created_at": now,
        "updated_at": now,
    }

    try:
        result = await sb_post("/rest/v1/agents", agent_data)
        created = result[0] if isinstance(result, list) else result
        return _decorate_agent_operator_fields(created)
    except Exception as e:
        logger.error(f"create_agent error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create agent")


@app.get("/api/agents/{agent_id}")
async def get_agent(agent_id: str, user: dict = Depends(get_current_user)):
    user_id = user["id"]
    try:
        rows = await sb_get(
            "/rest/v1/agents",
            params={"id": f"eq.{agent_id}", "user_id": f"eq.{user_id}", "limit": "1"},
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Agent not found")
        agent = _decorate_agent_operator_fields(rows[0])

        # Lightweight cost/audit summary for trust and guardrails UX.
        runs = await sb_get(
            "/rest/v1/agent_runs",
            params={
                "agent_id": f"eq.{agent_id}",
                "user_id": f"eq.{user_id}",
                "order": "started_at.desc",
                "limit": "100",
            },
        )
        runs = runs or []
        total_cost = sum((r.get("cost_usd") or 0) for r in runs)
        total_tokens = sum((r.get("total_tokens") or 0) for r in runs)
        failed_runs = sum(1 for r in runs if (r.get("status") or "") == "failed")
        run_count = len(runs)
        agent["cost_summary"] = {
            "total_cost_last_runs": round(total_cost, 6),
            "total_tokens_last_runs": int(total_tokens),
            "run_count": run_count,
        }
        agent["audit_summary"] = {
            "failure_rate": round((failed_runs / run_count) * 100, 2) if run_count else 0,
            "failed_runs": failed_runs,
            "latest_run_status": runs[0].get("status") if runs else None,
            "latest_run_at": runs[0].get("started_at") if runs else None,
        }
        return agent
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_agent error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch agent")


@app.patch("/api/agents/{agent_id}")
async def update_agent(agent_id: str, body: AgentUpdateRequest, user: dict = Depends(get_current_user)):
    user_id = user["id"]

    # Verify ownership
    try:
        rows = await sb_get(
            "/rest/v1/agents",
            params={"id": f"eq.{agent_id}", "user_id": f"eq.{user_id}", "limit": "1"},
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Agent not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"update_agent ownership check error: {e}")
        raise HTTPException(status_code=500, detail="Failed to verify agent ownership")

    existing_agent = rows[0]
    update_data: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for field in ["name", "description", "status", "model", "temperature", "max_tokens",
                  "system_prompt", "goals", "schedule"]:
        val = getattr(body, field, None)
        if val is not None:
            update_data[field] = val

    if (
        body.rules is not None
        or body.data_scope is not None
        or body.automation_mode is not None
        or body.approval_rules is not None
        or body.execution_permissions is not None
        or body.allowed_targets is not None
        or body.lifecycle_state is not None
        or body.success_metrics is not None
    ):
        existing_settings = _extract_operator_settings(existing_agent.get("rules"))
        merged_settings = {
            "automation_mode": body.automation_mode if body.automation_mode is not None else existing_settings.get("automation_mode"),
            "approval_rules": body.approval_rules if body.approval_rules is not None else existing_settings.get("approval_rules"),
            "execution_permissions": body.execution_permissions if body.execution_permissions is not None else existing_settings.get("execution_permissions"),
            "allowed_targets": body.allowed_targets if body.allowed_targets is not None else existing_settings.get("allowed_targets"),
            "lifecycle_state": body.lifecycle_state if body.lifecycle_state is not None else existing_settings.get("lifecycle_state"),
            "success_metrics": body.success_metrics if body.success_metrics is not None else existing_settings.get("success_metrics"),
        }
        if body.rules is None and body.data_scope is None:
            rules_payload = _build_rules_payload(existing_agent.get("rules"), None, merged_settings)
        elif body.rules is None:
            rules_payload = _build_rules_payload(existing_agent.get("rules"), body.data_scope, merged_settings)
        elif body.data_scope is None:
            rules_payload = _build_rules_payload(body.rules, _extract_data_scope(existing_agent.get("rules")), merged_settings)
        else:
            rules_payload = _build_rules_payload(body.rules, body.data_scope, merged_settings)
        update_data["rules"] = rules_payload

    try:
        result = await sb_patch(
            "/rest/v1/agents",
            params={"id": f"eq.{agent_id}", "user_id": f"eq.{user_id}"},
            data=update_data,
        )
        if isinstance(result, list) and result:
            return _decorate_agent_operator_fields(result[0])
        return {"message": "Updated"}
    except Exception as e:
        logger.error(f"update_agent error: {e}")
        raise HTTPException(status_code=500, detail="Failed to update agent")


@app.delete("/api/agents/{agent_id}")
async def delete_agent(agent_id: str, user: dict = Depends(get_current_user)):
    user_id = user["id"]

    # Verify ownership
    try:
        rows = await sb_get(
            "/rest/v1/agents",
            params={"id": f"eq.{agent_id}", "user_id": f"eq.{user_id}", "limit": "1"},
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Agent not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to verify ownership")

    try:
        await sb_delete(
            "/rest/v1/agents",
            params={"id": f"eq.{agent_id}", "user_id": f"eq.{user_id}"},
        )
        return {"message": "Agent deleted successfully"}
    except Exception as e:
        logger.error(f"delete_agent error: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete agent")


@app.get("/api/agent-scope/options")
async def get_agent_scope_options(user: dict = Depends(get_current_user)):
    """Return selectable data scope options for agent configuration."""
    user_id = user["id"]

    github_repos: list[str] = []
    gsc_sites: list[str] = []
    bing_sites: list[str] = []
    diagnostics = {
        "github": {"connected": False, "status": "not_connected", "detail": "No active connection"},
        "google_search_console": {"connected": False, "status": "not_connected", "detail": "No active connection"},
        "bing_webmaster": {"connected": False, "status": "not_connected", "detail": "No active connection"},
    }

    try:
        conn_rows = await sb_get(
            "/rest/v1/connections",
            params={"user_id": f"eq.{user_id}", "is_active": "eq.true"},
        )
    except Exception as e:
        logger.error(f"get_agent_scope_options: failed to load connections: {e}")
        conn_rows = []

    tokens: dict[str, str] = {}
    credentials_by_service: dict[str, dict] = {}
    for conn in (conn_rows or []):
        svc_name = conn.get("service", "")
        creds = conn.get("credentials", {}) or {}
        if svc_name:
            credentials_by_service[svc_name] = creds
        token = creds.get("access_token") or creds.get("api_key") or ""
        if svc_name and token:
            tokens[svc_name] = token
            if svc_name in diagnostics:
                diagnostics[svc_name] = {"connected": True, "status": "connected", "detail": "Connected"}

    async with httpx.AsyncClient(timeout=20) as client:
        gh_token = tokens.get("github")
        if gh_token:
            try:
                r = await client.get(
                    "https://api.github.com/user/repos",
                    params={"type": "all", "sort": "updated", "per_page": 100},
                    headers={
                        "Authorization": f"Bearer {gh_token}",
                        "Accept": "application/vnd.github+json",
                        "X-GitHub-Api-Version": "2022-11-28",
                    },
                )
                if r.status_code == 200:
                    github_repos = sorted(
                        [repo.get("full_name", "") for repo in (r.json() or []) if repo.get("full_name")]
                    )
                    diagnostics["github"] = {
                        "connected": True,
                        "status": "ok",
                        "detail": f"Loaded {len(github_repos)} repositories",
                    }
                else:
                    diagnostics["github"] = {
                        "connected": True,
                        "status": "api_error",
                        "detail": f"GitHub API returned {r.status_code}",
                    }
            except Exception as e:
                logger.warning(f"get_agent_scope_options: github fetch failed: {e}")
                diagnostics["github"] = {
                    "connected": True,
                    "status": "error",
                    "detail": f"GitHub lookup failed: {str(e)[:120]}",
                }

        gsc_token = tokens.get("google_search_console")
        if gsc_token:
            try:
                r = await client.get(
                    "https://www.googleapis.com/webmasters/v3/sites",
                    headers={"Authorization": f"Bearer {gsc_token}"},
                )
                if r.status_code == 200:
                    gsc_sites = sorted(
                        [site.get("siteUrl", "") for site in (r.json().get("siteEntry") or []) if site.get("siteUrl")]
                    )
                    diagnostics["google_search_console"] = {
                        "connected": True,
                        "status": "ok",
                        "detail": f"Loaded {len(gsc_sites)} properties",
                    }
                else:
                    diagnostics["google_search_console"] = {
                        "connected": True,
                        "status": "api_error",
                        "detail": f"GSC API returned {r.status_code}",
                    }
            except Exception as e:
                logger.warning(f"get_agent_scope_options: gsc fetch failed: {e}")
                diagnostics["google_search_console"] = {
                    "connected": True,
                    "status": "error",
                    "detail": f"GSC lookup failed: {str(e)[:120]}",
                }

        bing_token = tokens.get("bing_webmaster")
        if bing_token:
            try:
                r = await client.get(
                    "https://ssl.bing.com/webmaster/api.svc/json/GetUserSites",
                    headers={"Authorization": f"Bearer {bing_token}"},
                )
                # Backward compatibility: legacy Bing API-key connections
                # used api_key credentials, not OAuth bearer tokens.
                if r.status_code in (401, 403):
                    bing_creds = credentials_by_service.get("bing_webmaster", {}) or {}
                    bing_api_key = (bing_creds.get("api_key") or "").strip()
                    if bing_api_key:
                        r = await client.get(
                            "https://ssl.bing.com/webmaster/api.svc/json/GetUserSites",
                            params={"apikey": bing_api_key},
                        )
                if r.status_code == 200:
                    payload = r.json() or {}
                    candidate_sites = []
                    if isinstance(payload.get("d"), dict):
                        d = payload.get("d") or {}
                        candidate_sites.extend(d.get("Results") or [])
                        candidate_sites.extend(d.get("results") or [])
                    if isinstance(payload.get("d"), list):
                        candidate_sites.extend(payload.get("d") or [])
                    if isinstance(payload.get("sites"), list):
                        candidate_sites.extend(payload.get("sites") or [])
                    if isinstance(payload.get("Sites"), list):
                        candidate_sites.extend(payload.get("Sites") or [])
                    if isinstance(payload.get("results"), list):
                        candidate_sites.extend(payload.get("results") or [])
                    if isinstance(payload.get("Result"), list):
                        candidate_sites.extend(payload.get("Result") or [])
                    for entry in candidate_sites:
                        if isinstance(entry, str) and entry:
                            bing_sites.append(entry)
                        elif isinstance(entry, dict):
                            site_url = entry.get("Url") or entry.get("url") or entry.get("siteUrl")
                            if site_url:
                                bing_sites.append(site_url)
                    bing_sites = sorted(list(set(bing_sites)))
                    diagnostics["bing_webmaster"] = {
                        "connected": True,
                        "status": "ok",
                        "detail": f"Loaded {len(bing_sites)} properties",
                    }
                else:
                    diagnostics["bing_webmaster"] = {
                        "connected": True,
                        "status": "api_error",
                        "detail": f"Bing API returned {r.status_code}",
                    }
            except Exception as e:
                logger.warning(f"get_agent_scope_options: bing fetch failed: {e}")
                diagnostics["bing_webmaster"] = {
                    "connected": True,
                    "status": "error",
                    "detail": f"Bing lookup failed: {str(e)[:120]}",
                }

    return {
        "github_repos": github_repos,
        "gsc_sites": gsc_sites,
        "bing_sites": bing_sites,
        "diagnostics": diagnostics,
    }


# ─────────────────────────────────────────────
# AGENT EXECUTION
# ─────────────────────────────────────────────

@app.post("/api/agents/{agent_id}/run")
async def run_agent(agent_id: str, body: AgentRunRequest, user: dict = Depends(get_current_user)):
    user_id = user["id"]
    started_at = datetime.now(timezone.utc)
    t0 = time.monotonic()

    # 1. Load agent config
    try:
        agent_rows = await sb_get(
            "/rest/v1/agents",
            params={"id": f"eq.{agent_id}", "user_id": f"eq.{user_id}", "limit": "1"},
        )
        if not agent_rows:
            raise HTTPException(status_code=404, detail="Agent not found")
        agent = agent_rows[0]
        data_scope = _extract_data_scope(agent.get("rules"))
        operator_settings = _extract_operator_settings(agent.get("rules"))
        scope_mode = "site" if data_scope else "agent"
        agent = agent_rows[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"run_agent load error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load agent config")

    # 2. Check API call limit
    try:
        profile_rows = await sb_get(
            "/rest/v1/profiles",
            params={"id": f"eq.{user_id}", "limit": "1"},
        )
        profile = profile_rows[0] if profile_rows else {}
        calls_this_month = profile.get("api_calls_this_month", 0) or 0
        calls_limit = profile.get("api_calls_limit", 100) or 100
        if calls_this_month >= calls_limit:
            raise HTTPException(
                status_code=429,
                detail=f"API call limit reached ({calls_limit}/month). Upgrade your plan for more calls.",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"run_agent limit check error: {e}")

    # 3. Build system prompt
    template_id = agent.get("template_id", "custom")
    if template_id == "custom" and agent.get("system_prompt"):
        system_prompt = agent["system_prompt"]
    else:
        system_prompt = TEMPLATE_PROMPTS.get(template_id, TEMPLATE_PROMPTS["custom"])
        if agent.get("system_prompt") and template_id == "custom":
            system_prompt = agent["system_prompt"]

    # Prepend core doctrine to all agent system prompts
    system_prompt = CORE_AI_DOCTRINE + "\n" + system_prompt

    # Append goals to system prompt if present
    goals = agent.get("goals") or []
    if goals:
        system_prompt += f"\n\nYour current goals:\n" + "\n".join(f"- {g}" for g in goals)

    text_rules = _extract_rule_text_rules(agent.get("rules"))
    if text_rules:
        system_prompt += "\n\nYour operating rules:\n" + "\n".join(f"- {r}" for r in text_rules)

    data_scope = _extract_data_scope(agent.get("rules"))
    scope_addon = _build_scope_prompt_addon(data_scope)
    if scope_addon:
        system_prompt += scope_addon

    # 4. Call OpenAI

    if not user_message:
        raise HTTPException(status_code=400, detail="input_data.message is required")

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]

    run_id = None
    try:
        # Insert a "running" run record first
        now_iso = started_at.isoformat()
        run_insert = await sb_post("/rest/v1/agent_runs", {
            "agent_id": agent_id,
            "user_id": user_id,
            "status": "running",
            "input_data": body.input_data,
            "model": model,
            "started_at": now_iso,
        })
        if isinstance(run_insert, list) and run_insert:
            run_id = run_insert[0]["id"]
        elif isinstance(run_insert, dict):
            run_id = run_insert.get("id")
    except Exception as e:
        logger.warning(f"run_agent: failed to insert run record: {e}")

    # Actual OpenAI call
    try:
        completion = await openai_client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
    except openai.RateLimitError:
        if run_id:
            await _fail_run(run_id, "OpenAI rate limit exceeded")
        raise HTTPException(status_code=429, detail="OpenAI rate limit exceeded. Try again shortly.")
    except openai.AuthenticationError:
        if run_id:
            await _fail_run(run_id, "OpenAI authentication error")
        raise HTTPException(status_code=500, detail="OpenAI configuration error")
    except Exception as e:
        logger.error(f"OpenAI call error: {e}")
        if run_id:
            await _fail_run(run_id, str(e))
        raise HTTPException(status_code=500, detail="AI execution failed")

    # Parse response
    duration_ms = int((time.monotonic() - t0) * 1000)
    response_text = completion.choices[0].message.content
    prompt_tokens = completion.usage.prompt_tokens
    completion_tokens = completion.usage.completion_tokens
    total_tokens = completion.usage.total_tokens
    cost_usd, price_usd = calculate_cost(model, prompt_tokens, completion_tokens)
    completed_at = datetime.now(timezone.utc).isoformat()

    output_data = {
        "response": response_text,
        "model": model,
        "finish_reason": completion.choices[0].finish_reason,
    }

    # 5–8. Update DB records concurrently
    try:
        # Update agent_run to completed
        if run_id:
            await sb_patch(
                "/rest/v1/agent_runs",
                params={"id": f"eq.{run_id}"},
                data={
                    "status": "completed",
                    "output_data": output_data,
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": total_tokens,
                    "cost_usd": cost_usd,
                    "error_message": None,
                    "completed_at": completed_at,
                    "duration_ms": duration_ms,
                },
            )

        # Insert usage record
        await sb_post("/rest/v1/usage_records", {
            "user_id": user_id,
            "agent_id": agent_id,
            "run_id": run_id,
            "tokens_used": total_tokens,
            "cost_usd": cost_usd,
            "price_usd": price_usd,
            "model": model,
            "created_at": completed_at,
        })

        # Increment profile counters
        new_calls = (profile.get("api_calls_this_month") or 0) + 1
        await sb_patch(
            "/rest/v1/profiles",
            params={"id": f"eq.{user_id}"},
            data={"api_calls_this_month": new_calls, "updated_at": completed_at},
        )

        # Update agent stats
        new_total_runs = (agent.get("total_runs") or 0) + 1
        new_total_tokens = (agent.get("total_tokens_used") or 0) + total_tokens
        await sb_patch(
            "/rest/v1/agents",
            params={"id": f"eq.{agent_id}"},
            data={
                "last_run_at": completed_at,
                "total_runs": new_total_runs,
                "total_tokens_used": new_total_tokens,
                "status": "active",
                "updated_at": completed_at,
            },
        )
    except Exception as e:
        logger.error(f"run_agent DB update error: {e}")
        # Don't fail the response — the AI already ran

    return {
        "run_id": run_id,
        "status": "completed",
        "output": output_data,
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "cost_usd": cost_usd,
            "price_usd": price_usd,
        },
        "duration_ms": duration_ms,
    }


async def _fail_run(run_id: str, error_msg: str):
    """Mark a run as failed in the DB."""
    try:
        await sb_patch(
            "/rest/v1/agent_runs",
            params={"id": f"eq.{run_id}"},
            data={
                "status": "failed",
                "error_message": error_msg,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            },
        )
    except Exception as e:
        logger.error(f"_fail_run error: {e}")


@app.get("/api/agents/{agent_id}/runs")
async def get_agent_runs(agent_id: str, user: dict = Depends(get_current_user)):
    user_id = user["id"]
    try:
        # Verify ownership
        agent_rows = await sb_get(
            "/rest/v1/agents",
            params={"id": f"eq.{agent_id}", "user_id": f"eq.{user_id}", "limit": "1"},
        )
        if not agent_rows:
            raise HTTPException(status_code=404, detail="Agent not found")

        runs = await sb_get(
            "/rest/v1/agent_runs",
            params={
                "agent_id": f"eq.{agent_id}",
                "user_id": f"eq.{user_id}",
                "order": "started_at.desc",
                "limit": "50",
            },
        )
        return runs or []
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_agent_runs error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch runs")


# ─────────────────────────────────────────────
# AGENT CHAT (conversational, with history)
# ─────────────────────────────────────────────

@app.post("/api/agents/{agent_id}/chat")
async def chat_agent(agent_id: str, body: AgentChatRequest, user: dict = Depends(get_current_user)):
    """Conversational chat endpoint with tool-calling support.
    
    Agents can use connected services (GitHub, GSC, GA, etc.) via OpenAI function calling.
    The tool-call loop runs up to 10 iterations to prevent runaway execution.
    """
    user_id = user["id"]
    started_at = datetime.now(timezone.utc)
    t0 = time.monotonic()

    # 1. Load agent config
    try:
        agent_rows = await sb_get(
            "/rest/v1/agents",
            params={"id": f"eq.{agent_id}", "user_id": f"eq.{user_id}", "limit": "1"},
        )
        if not agent_rows:
            raise HTTPException(status_code=404, detail="Agent not found")
        agent = agent_rows[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"chat_agent load error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load agent config")

    # 2. Check API call limit
    profile = {}
    try:
        profile_rows = await sb_get(
            "/rest/v1/profiles",
            params={"id": f"eq.{user_id}", "limit": "1"},
        )
        profile = profile_rows[0] if profile_rows else {}
        calls_this_month = profile.get("api_calls_this_month", 0) or 0
        calls_limit = profile.get("api_calls_limit", 100) or 100
        if calls_this_month >= calls_limit:
            raise HTTPException(
                status_code=429,
                detail=f"API call limit reached ({calls_limit}/month). Upgrade your plan for more calls.",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"chat_agent limit check error: {e}")

    # 3. Load user's active connections and their tokens
    active_services = []
    service_tokens = {}  # service_name -> access_token
    try:
        conn_rows = await sb_get(
            "/rest/v1/connections",
            params={"user_id": f"eq.{user_id}", "is_active": "eq.true"},
        )
        for conn in (conn_rows or []):
            svc_name = conn.get("service", "")
            creds = conn.get("credentials", {}) or {}
            token = creds.get("access_token") or creds.get("api_key") or ""
            if svc_name and token:
                active_services.append(svc_name)
                service_tokens[svc_name] = token
    except Exception as e:
        logger.warning(f"chat_agent: could not load connections: {e}")

    # 4. Build system prompt
    template_id = agent.get("template_id", "custom")
    if template_id == "custom" and agent.get("system_prompt"):
        system_prompt = agent["system_prompt"]
    else:
        system_prompt = TEMPLATE_PROMPTS.get(template_id, TEMPLATE_PROMPTS.get("custom", ""))
        if agent.get("system_prompt") and template_id == "custom":
            system_prompt = agent["system_prompt"]

    # Prepend core doctrine to all agent system prompts
    system_prompt = CORE_AI_DOCTRINE + "\n" + system_prompt

    goals = agent.get("goals") or []
    if goals:
        system_prompt += f"\n\nYour current goals:\n" + "\n".join(f"- {g}" for g in goals)

    text_rules = _extract_rule_text_rules(agent.get("rules"))
    if text_rules:
        system_prompt += "\n\nYour operating rules:\n" + "\n".join(f"- {r}" for r in text_rules)

    data_scope = _extract_data_scope(agent.get("rules"))
    scope_addon = _build_scope_prompt_addon(data_scope)
    if scope_addon:
        system_prompt += scope_addon

    # Add connected services info to system prompt
    tools_addon = build_tools_system_prompt_addon(active_services)
    if tools_addon:
        system_prompt += tools_addon

    # 5. Load last 10 runs from agent_runs for conversation context
    history_messages = []
    try:
        history_rows = await sb_get(
            "/rest/v1/agent_runs",
            params={
                "agent_id": f"eq.{agent_id}",
                "user_id": f"eq.{user_id}",
                "status": "eq.completed",
                "order": "started_at.desc",
                "limit": "10",
            },
        )
        # Reverse to get chronological order (oldest first)
        for row in reversed(history_rows or []):
            user_msg = (row.get("input_data") or {}).get("message", "")
            assistant_msg = (row.get("output_data") or {}).get("response", "")
            if user_msg:
                history_messages.append({"role": "user", "content": user_msg})
            if assistant_msg:
                history_messages.append({"role": "assistant", "content": assistant_msg})
    except Exception as e:
        logger.warning(f"chat_agent: could not load message history: {e}")

    # 6. Build full messages list: system + history + new user message
    model = agent.get("model", "gpt-4o-mini")
    temperature = agent.get("temperature", 0.7)
    max_tokens = agent.get("max_tokens", 1024)
    user_message = body.message.strip()

    if not user_message:
        raise HTTPException(status_code=400, detail="message is required")

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(history_messages)
    messages.append({"role": "user", "content": user_message})

    # 7. Build tools list from active connections
    tools = get_tools_for_connections(active_services)

    # 8. Insert run record
    run_id = None
    now_iso = started_at.isoformat()
    try:
        run_insert = await sb_post("/rest/v1/agent_runs", {
            "agent_id": agent_id,
            "user_id": user_id,
            "status": "running",
            "input_data": {"message": user_message},
            "model": model,
            "started_at": now_iso,
        })
        if isinstance(run_insert, list) and run_insert:
            run_id = run_insert[0]["id"]
        elif isinstance(run_insert, dict):
            run_id = run_insert.get("id")
    except Exception as e:
        logger.warning(f"chat_agent: failed to insert run record: {e}")

    # 9. Call OpenAI with tool-calling loop
    total_prompt_tokens = 0
    total_completion_tokens = 0
    tool_calls_made = []
    MAX_TOOL_ITERATIONS = 10

    try:
        for iteration in range(MAX_TOOL_ITERATIONS):
            # Build the API call kwargs
            api_kwargs = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            if tools:
                api_kwargs["tools"] = tools
                api_kwargs["tool_choice"] = "auto"

            completion = await openai_client.chat.completions.create(**api_kwargs)

            # Track token usage across iterations
            total_prompt_tokens += completion.usage.prompt_tokens
            total_completion_tokens += completion.usage.completion_tokens

            choice = completion.choices[0]
            assistant_message = choice.message

            # If no tool calls, we have the final response
            if not assistant_message.tool_calls:
                response_text = assistant_message.content or ""
                break

            # Process tool calls
            # Append the assistant message with tool_calls to the conversation
            messages.append(assistant_message.model_dump())

            for tc in assistant_message.tool_calls:
                fn_name = tc.function.name
                try:
                    fn_args = json_module.loads(tc.function.arguments)
                except Exception:
                    fn_args = {}

                logger.info(f"Agent tool call: {fn_name}({json_module.dumps(fn_args)[:200]})")
                tool_calls_made.append({"tool": fn_name, "args_preview": json_module.dumps(fn_args)[:200]})

                # Execute the tool
                scoped_args = _apply_scope_to_tool_args(fn_name, fn_args, data_scope)
                tool_result = await execute_tool(fn_name, scoped_args, service_tokens)

                # Append tool result to conversation
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": tool_result,
                })

            # Continue the loop — OpenAI will process tool results and either
            # call more tools or produce a final response
        else:
            # Hit max iterations — get whatever response we can
            response_text = assistant_message.content or "I've reached the maximum number of operations for this request. Here's what I found so far."

    except openai.RateLimitError:
        if run_id:
            await _fail_run(run_id, "OpenAI rate limit exceeded")
        raise HTTPException(status_code=429, detail="OpenAI rate limit exceeded. Try again shortly.")
    except openai.AuthenticationError:
        if run_id:
            await _fail_run(run_id, "OpenAI authentication error")
        raise HTTPException(status_code=500, detail="OpenAI configuration error")
    except Exception as e:
        logger.error(f"chat_agent OpenAI call error: {e}")
        if run_id:
            await _fail_run(run_id, str(e))
        raise HTTPException(status_code=500, detail="AI execution failed")

    # 10. Finalize metrics
    duration_ms = int((time.monotonic() - t0) * 1000)
    prompt_tokens = total_prompt_tokens
    completion_tokens = total_completion_tokens
    total_tokens = prompt_tokens + completion_tokens
    cost_usd, price_usd = calculate_cost(model, prompt_tokens, completion_tokens)
    completed_at = datetime.now(timezone.utc).isoformat()

    # 11. Update DB records (run, usage, profile counters, agent stats)
    try:
        if run_id:
            output_data = {
                "response": response_text,
                "model": model,
                "finish_reason": "stop",
            }
            if tool_calls_made:
                output_data["tool_calls"] = tool_calls_made
            await sb_patch(
                "/rest/v1/agent_runs",
                params={"id": f"eq.{run_id}"},
                data={
                    "status": "completed",
                    "output_data": output_data,
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": total_tokens,
                    "cost_usd": cost_usd,
                    "error_message": None,
                    "completed_at": completed_at,
                    "duration_ms": duration_ms,
                },
            )

        await sb_post("/rest/v1/usage_records", {
            "user_id": user_id,
            "agent_id": agent_id,
            "run_id": run_id,
            "tokens_used": total_tokens,
            "cost_usd": cost_usd,
            "price_usd": price_usd,
            "model": model,
            "created_at": completed_at,
        })

        new_calls = (profile.get("api_calls_this_month") or 0) + 1
        await sb_patch(
            "/rest/v1/profiles",
            params={"id": f"eq.{user_id}"},
            data={"api_calls_this_month": new_calls, "updated_at": completed_at},
        )

        new_total_runs = (agent.get("total_runs") or 0) + 1
        new_total_tokens = (agent.get("total_tokens_used") or 0) + total_tokens
        await sb_patch(
            "/rest/v1/agents",
            params={"id": f"eq.{agent_id}"},
            data={
                "last_run_at": completed_at,
                "total_runs": new_total_runs,
                "total_tokens_used": new_total_tokens,
                "status": "active",
                "updated_at": completed_at,
            },
        )
    except Exception as e:
        logger.error(f"chat_agent DB update error: {e}")
        # Don't fail the response — the AI already ran

    result = {
        "message": response_text,
        "run_id": run_id,
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "cost_usd": cost_usd,
            "price_usd": price_usd,
        },
        "duration_ms": duration_ms,
    }
    if tool_calls_made:
        result["tools_used"] = [tc["tool"] for tc in tool_calls_made]
    return result


@app.get("/api/agents/{agent_id}/messages")
async def get_agent_messages(agent_id: str, user: dict = Depends(get_current_user)):
    """Returns the chat history for an agent (last 50 messages)."""
    user_id = user["id"]
    try:
        # Verify ownership
        agent_rows = await sb_get(
            "/rest/v1/agents",
            params={"id": f"eq.{agent_id}", "user_id": f"eq.{user_id}", "limit": "1"},
        )
        if not agent_rows:
            raise HTTPException(status_code=404, detail="Agent not found")

        runs = await sb_get(
            "/rest/v1/agent_runs",
            params={
                "agent_id": f"eq.{agent_id}",
                "user_id": f"eq.{user_id}",
                "order": "started_at.asc",
                "limit": "50",
            },
        )
        # Convert runs to message format
        messages = []
        for run in (runs or []):
            user_msg = (run.get("input_data") or {}).get("message", "")
            assistant_msg = (run.get("output_data") or {}).get("response", "")
            if user_msg:
                messages.append({
                    "role": "user",
                    "content": user_msg,
                    "created_at": run.get("started_at"),
                    "run_id": run.get("id"),
                })
            if assistant_msg:
                messages.append({
                    "role": "assistant",
                    "content": assistant_msg,
                    "created_at": run.get("completed_at") or run.get("started_at"),
                    "run_id": run.get("id"),
                    "tokens": run.get("total_tokens"),
                    "cost_usd": run.get("cost_usd"),
                    "status": run.get("status"),
                })
            if run.get("status") == "failed" and run.get("error_message"):
                messages.append({
                    "role": "error",
                    "content": run.get("error_message"),
                    "created_at": run.get("completed_at") or run.get("started_at"),
                    "run_id": run.get("id"),
                })
        return messages
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_agent_messages error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch messages")


@app.delete("/api/agents/{agent_id}/messages")
async def delete_agent_messages(agent_id: str, user: dict = Depends(get_current_user)):
    """Clears chat history for an agent."""
    user_id = user["id"]
    try:
        # Verify ownership
        agent_rows = await sb_get(
            "/rest/v1/agents",
            params={"id": f"eq.{agent_id}", "user_id": f"eq.{user_id}", "limit": "1"},
        )
        if not agent_rows:
            raise HTTPException(status_code=404, detail="Agent not found")

        await sb_delete(
            "/rest/v1/agent_runs",
            params={"agent_id": f"eq.{agent_id}", "user_id": f"eq.{user_id}"},
        )
        # Reset agent stats
        await sb_patch(
            "/rest/v1/agents",
            params={"id": f"eq.{agent_id}"},
            data={"total_runs": 0, "total_tokens_used": 0},
        )
        return {"message": "Chat history cleared successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"delete_agent_messages error: {e}")
        raise HTTPException(status_code=500, detail="Failed to clear chat history")


@app.get("/api/agents/{agent_id}/activity")
async def get_agent_activity(agent_id: str, user: dict = Depends(get_current_user)):
    """Returns an activity log for an agent combining runs and other events."""
    user_id = user["id"]
    try:
        # Verify ownership
        agent_rows = await sb_get(
            "/rest/v1/agents",
            params={"id": f"eq.{agent_id}", "user_id": f"eq.{user_id}", "limit": "1"},
        )
        if not agent_rows:
            raise HTTPException(status_code=404, detail="Agent not found")

        runs = await sb_get(
            "/rest/v1/agent_runs",
            params={
                "agent_id": f"eq.{agent_id}",
                "user_id": f"eq.{user_id}",
                "order": "started_at.desc",
                "limit": "50",
            },
        )

        activity_items = []
        for run in (runs or []):
            status = run.get("status", "unknown")
            total_tokens = run.get("total_tokens") or 0
            cost_usd = run.get("cost_usd") or 0
            started_at = run.get("started_at")
            completed_at = run.get("completed_at")
            duration_ms = run.get("duration_ms")

            if status == "completed":
                description = f"Run completed — {total_tokens} tokens used (${cost_usd:.6f})"
            elif status == "failed":
                error_msg = run.get("error_message") or "unknown error"
                description = f"Run failed — {error_msg}"
            elif status == "running":
                description = "Run in progress"
            else:
                description = f"Run {status}"

            activity_items.append({
                "type": "run",
                "description": description,
                "timestamp": completed_at or started_at,
                "metadata": {
                    "agent_id": agent_id,
                    "agent_name": agent.get("name"),
                    "lifecycle_stage": "Execute" if status in ("running", "completed", "failed") else "Plan",
                    "scope_mode": scope_mode,
                    "automation_mode": operator_settings.get("automation_mode", "approval_publish_distribution"),
                    "triggering_signal_ids": (run.get("input_data") or {}).get("signal_ids", []),
                    "linked_opportunity_id": (run.get("input_data") or {}).get("opportunity_id"),
                    "linked_plan_id": (run.get("input_data") or {}).get("plan_id"),
                    "approval_actor": (run.get("input_data") or {}).get("approved_by"),
                    "actions_executed": (run.get("output_data") or {}).get("actions_executed", []),
                    "affected_resources": (run.get("output_data") or {}).get("affected_urls", []),
                    "linked_outcome_ids": (run.get("output_data") or {}).get("outcome_ids", []),
                    "run_id": run.get("id"),
                    "status": status,
                    "model": run.get("model"),
                    "prompt_tokens": run.get("prompt_tokens"),
                    "completion_tokens": run.get("completion_tokens"),
                    "total_tokens": total_tokens,
                    "cost_usd": cost_usd,
                    "duration_ms": duration_ms,
                    "started_at": started_at,
                    "completed_at": completed_at,
                },
            })

        return activity_items
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_agent_activity error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch activity")


# ─────────────────────────────────────────────
# TEMPLATES
# ─────────────────────────────────────────────

@app.get("/api/templates")
async def list_templates():
    return SEARCH_OPS_TEMPLATES


# ─────────────────────────────────────────────
# CONNECTIONS
# ─────────────────────────────────────────────

@app.get("/api/connections")
async def list_connections(user: dict = Depends(get_current_user)):
    user_id = user["id"]
    try:
        rows = await sb_get(
            "/rest/v1/connections",
            params={"user_id": f"eq.{user_id}", "order": "created_at.desc"},
        )
        # Mask credentials before returning
        connections = []
        for row in (rows or []):
            row_copy = dict(row)
            if row_copy.get("credentials"):
                row_copy["credentials"] = {"masked": True}
            connections.append(row_copy)
        return connections
    except Exception as e:
        logger.error(f"list_connections error: {e}")
        raise HTTPException(status_code=500, detail="Failed to list connections")


@app.post("/api/connections", status_code=201)
async def create_connection(body: ConnectionRequest, user: dict = Depends(get_current_user)):
    user_id = user["id"]
    now = datetime.now(timezone.utc).isoformat()
    try:
        # Upsert — update if exists, else insert
        existing = await sb_get(
            "/rest/v1/connections",
            params={"user_id": f"eq.{user_id}", "service": f"eq.{body.service}", "limit": "1"},
        )
        if existing:
            result = await sb_patch(
                "/rest/v1/connections",
                params={"user_id": f"eq.{user_id}", "service": f"eq.{body.service}"},
                data={
                    "credentials": body.credentials,
                    "is_active": True,
                    "last_tested_at": now,
                    "updated_at": now,
                },
            )
        else:
            result = await sb_post("/rest/v1/connections", {
                "user_id": user_id,
                "service": body.service,
                "credentials": body.credentials,
                "is_active": True,
                "last_tested_at": now,
                "created_at": now,
                "updated_at": now,
            })
        return {"message": "Connection saved", "service": body.service}
    except Exception as e:
        logger.error(f"create_connection error: {e}")
        raise HTTPException(status_code=500, detail="Failed to save connection")


@app.delete("/api/connections/{service}")
async def delete_connection(service: str, user: dict = Depends(get_current_user)):
    user_id = user["id"]
    try:
        await sb_delete(
            "/rest/v1/connections",
            params={"user_id": f"eq.{user_id}", "service": f"eq.{service}"},
        )
        return {"message": f"Connection '{service}' removed"}
    except Exception as e:
        logger.error(f"delete_connection error: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete connection")


# ─────────────────────────────────────────────
# OAUTH ROUTES
# ─────────────────────────────────────────────

@app.get("/api/oauth/start/{service}")
async def oauth_start(service: str, user: dict = Depends(get_current_user)):
    """Begin OAuth flow: generate state and return authorization URL."""
    if service not in OAUTH_SERVICES:
        raise HTTPException(status_code=400, detail=f"Unknown service '{service}'")

    svc = OAUTH_SERVICES[service]
    user_id = user["id"]

    # Generate CSRF state token
    state = secrets.token_urlsafe(32)
    state_data: dict = {
        "user_id": user_id,
        "service": service,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    # PKCE for Twitter
    if svc.get("pkce"):
        code_verifier = secrets.token_urlsafe(64)
        code_challenge = (
            hashlib.sha256(code_verifier.encode()).digest()
        )
        import base64
        code_challenge_b64 = (
            base64.urlsafe_b64encode(code_challenge).rstrip(b"=").decode()
        )
        state_data["code_verifier"] = code_verifier

    _oauth_states[state] = state_data

    client_id = globals().get(svc["client_id_var"], os.getenv(svc["client_id_var"], ""))
    redirect_uri = APP_BASE_URL + "/api/oauth/callback"
    scope = " ".join(svc["scopes"])

    params: dict = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": scope,
        "state": state,
    }

    # Google-specific extras
    if svc["client_id_var"] == "GOOGLE_CLIENT_ID":
        params["access_type"] = "offline"
        params["prompt"] = "consent"

    # Twitter PKCE extras
    if svc.get("pkce"):
        params["code_challenge"] = code_challenge_b64
        params["code_challenge_method"] = "S256"

    auth_url = svc["auth_url"] + "?" + urllib.parse.urlencode(params)
    logger.info(f"OAuth start for service={service} user={user_id}")
    return {"auth_url": auth_url, "state": state}


@app.get("/api/oauth/callback")
async def oauth_callback(code: str = None, state: str = None, error: str = None):
    """Handle OAuth provider redirect. Exchanges code for tokens and stores them."""
    if error:
        logger.warning(f"OAuth callback error from provider: {error}")
        html = f"""<html><body><script>
  if (window.opener) {{
    try {{ window.opener.postMessage({{type: 'oauth_error', error: '{error}'}}, '*'); }} catch(e) {{}}
  }}
  window.close();
  setTimeout(function() {{
    document.body.innerHTML = '<div style="font-family:sans-serif;text-align:center;padding:60px 20px;"><h2>Connection Failed</h2><p>Error: {error}</p><p>You can close this window and try again.</p></div>';
  }}, 500);
</script></body></html>"""
        return HTMLResponse(content=html)

    if not code or not state:
        html = """<html><body><script>
  window.close();
  setTimeout(function() {
    document.body.innerHTML = '<div style="font-family:sans-serif;text-align:center;padding:60px 20px;"><h2>Connection Failed</h2><p>Missing authorization code. Please try again.</p></div>';
  }, 500);
</script></body></html>"""
        return HTMLResponse(content=html)

    state_data = _oauth_states.get(state)
    if not state_data:
        html = """<html><body><script>
  window.close();
  setTimeout(function() {
    document.body.innerHTML = '<div style="font-family:sans-serif;text-align:center;padding:60px 20px;"><h2>Connection Failed</h2><p>Session expired. Please close this window and try connecting again.</p></div>';
  }, 500);
</script></body></html>"""
        return HTMLResponse(content=html)

    service = state_data["service"]
    user_id = state_data["user_id"]
    svc = OAUTH_SERVICES[service]

    client_id = globals().get(svc["client_id_var"], os.getenv(svc["client_id_var"], ""))
    client_secret = globals().get(svc["client_secret_var"], os.getenv(svc["client_secret_var"], ""))
    redirect_uri = APP_BASE_URL + "/api/oauth/callback"

    token_payload: dict = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "client_secret": client_secret,
    }

    # Twitter PKCE: include code_verifier
    if svc.get("pkce") and state_data.get("code_verifier"):
        token_payload["code_verifier"] = state_data["code_verifier"]

    try:
        headers: dict = {"Content-Type": "application/x-www-form-urlencoded"}
        if service == "github":
            headers["Accept"] = "application/json"

        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                svc["token_url"],
                data=token_payload,
                headers=headers,
            )
            if r.status_code not in (200, 201):
                logger.error(f"OAuth token exchange failed for {service}: {r.status_code} {r.text}")
                raise HTTPException(status_code=502, detail="Token exchange failed")
            token_data = r.json()

        credentials = {
            "access_token": token_data.get("access_token"),
            "refresh_token": token_data.get("refresh_token"),
            "expires_in": token_data.get("expires_in"),
            "token_type": token_data.get("token_type"),
            "scope": token_data.get("scope"),
        }

        now = datetime.now(timezone.utc).isoformat()

        # Upsert connection using manual GET → PATCH/POST pattern
        existing = await sb_get(
            "/rest/v1/connections",
            params={"user_id": f"eq.{user_id}", "service": f"eq.{service}", "limit": "1"},
        )
        if existing:
            await sb_patch(
                "/rest/v1/connections",
                params={"user_id": f"eq.{user_id}", "service": f"eq.{service}"},
                data={
                    "credentials": credentials,
                    "is_active": True,
                    "last_tested_at": now,
                    "updated_at": now,
                },
            )
        else:
            await sb_post("/rest/v1/connections", {
                "user_id": user_id,
                "service": service,
                "credentials": credentials,
                "is_active": True,
                "last_tested_at": now,
                "created_at": now,
                "updated_at": now,
            })

        # Clean up state
        _oauth_states.pop(state, None)
        logger.info(f"OAuth callback complete for service={service} user={user_id}")

    except HTTPException as he:
        _oauth_states.pop(state, None)
        error_msg = he.detail
        logger.error(f"oauth_callback HTTPException for {service}: {error_msg}")
        html = f"""<html><body><script>
  if (window.opener) {{
    try {{ window.opener.postMessage({{type: 'oauth_error', error: '{error_msg}'}}, '*'); }} catch(e) {{}}
  }}
  window.close();
  setTimeout(function() {{
    document.body.innerHTML = '<div style="font-family:sans-serif;text-align:center;padding:60px 20px;"><h2>Connection Failed</h2><p>{error_msg}</p><p>You can close this window and try again.</p></div>';
  }}, 500);
</script></body></html>"""
        return HTMLResponse(content=html)
    except Exception as e:
        _oauth_states.pop(state, None)
        logger.error(f"oauth_callback error for {service}: {e}")
        error_msg = str(e).replace("'", "\\'")
        html = f"""<html><body><script>
  if (window.opener) {{
    try {{ window.opener.postMessage({{type: 'oauth_error', error: 'Connection failed'}}, '*'); }} catch(e) {{}}
  }}
  window.close();
  setTimeout(function() {{
    document.body.innerHTML = '<div style="font-family:sans-serif;text-align:center;padding:60px 20px;"><h2>Connection Failed</h2><p>Something went wrong. Please try again.</p></div>';
  }}, 500);
</script></body></html>"""
        return HTMLResponse(content=html)

    html = f"""<html><body><script>
  // Signal the parent window via multiple methods
  try {{
    localStorage.setItem('oauth_complete', JSON.stringify({{service: '{service}', ts: Date.now()}}));
  }} catch(e) {{}}
  if (window.opener) {{
    try {{
      window.opener.postMessage({{type: 'oauth_complete', service: '{service}'}}, '*');
    }} catch(e) {{}}
  }}
  // Always try to close the popup
  window.close();
  // Fallback if window.close() doesn't work (e.g., not opened by script)
  setTimeout(function() {{
    document.body.innerHTML = '<div style="font-family:sans-serif;text-align:center;padding:60px 20px;"><h2>Connected!</h2><p>{service} has been connected successfully.</p><p>You can close this window.</p></div>';
  }}, 500);
</script></body></html>"""
    return HTMLResponse(content=html)


@app.post("/api/oauth/refresh/{service}")
async def oauth_refresh(service: str, user: dict = Depends(get_current_user)):
    """Use stored refresh_token to obtain a new access_token."""
    if service not in OAUTH_SERVICES:
        raise HTTPException(status_code=400, detail=f"Unknown service '{service}'")

    user_id = user["id"]
    svc = OAUTH_SERVICES[service]

    try:
        rows = await sb_get(
            "/rest/v1/connections",
            params={"user_id": f"eq.{user_id}", "service": f"eq.{service}", "limit": "1"},
        )
        if not rows:
            raise HTTPException(status_code=404, detail=f"No connection found for service '{service}'")

        creds = rows[0].get("credentials", {})
        refresh_token = creds.get("refresh_token")
        if not refresh_token:
            raise HTTPException(status_code=400, detail="No refresh token available for this connection")

        client_id = globals().get(svc["client_id_var"], os.getenv(svc["client_id_var"], ""))
        client_secret = globals().get(svc["client_secret_var"], os.getenv(svc["client_secret_var"], ""))

        token_payload = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
        }

        headers: dict = {"Content-Type": "application/x-www-form-urlencoded"}
        if service == "github":
            headers["Accept"] = "application/json"

        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(svc["token_url"], data=token_payload, headers=headers)
            if r.status_code not in (200, 201):
                logger.error(f"OAuth refresh failed for {service}: {r.status_code} {r.text}")
                raise HTTPException(status_code=502, detail="Token refresh failed")
            token_data = r.json()

        now = datetime.now(timezone.utc).isoformat()
        updated_creds = {
            **creds,
            "access_token": token_data.get("access_token", creds.get("access_token")),
            "expires_in": token_data.get("expires_in", creds.get("expires_in")),
        }
        if token_data.get("refresh_token"):
            updated_creds["refresh_token"] = token_data["refresh_token"]

        await sb_patch(
            "/rest/v1/connections",
            params={"user_id": f"eq.{user_id}", "service": f"eq.{service}"},
            data={"credentials": updated_creds, "updated_at": now},
        )

        logger.info(f"OAuth token refreshed for service={service} user={user_id}")
        return {"status": "refreshed"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"oauth_refresh error for {service}: {e}")
        raise HTTPException(status_code=500, detail="Token refresh failed")


# ─────────────────────────────────────────────
# API KEY CONNECTIONS
# ─────────────────────────────────────────────

class ApiKeyConnectionRequest(BaseModel):
    service: str
    api_key: Optional[str] = None
    api_token: Optional[str] = None
    extra_fields: Optional[dict] = None


@app.post("/api/connections/apikey", status_code=201)
async def create_apikey_connection(body: ApiKeyConnectionRequest, user: dict = Depends(get_current_user)):
    """Store an API-key-based connection (Cloudflare, OpenAI, Gemini, etc.)."""
    user_id = user["id"]
    now = datetime.now(timezone.utc).isoformat()

    credentials: dict = {}
    if body.api_key:
        credentials["api_key"] = body.api_key
    if body.api_token:
        credentials["api_token"] = body.api_token
    if body.extra_fields:
        credentials.update(body.extra_fields)

    try:
        # Use same manual GET → PATCH/POST pattern as create_connection
        existing = await sb_get(
            "/rest/v1/connections",
            params={"user_id": f"eq.{user_id}", "service": f"eq.{body.service}", "limit": "1"},
        )
        if existing:
            await sb_patch(
                "/rest/v1/connections",
                params={"user_id": f"eq.{user_id}", "service": f"eq.{body.service}"},
                data={
                    "credentials": credentials,
                    "is_active": True,
                    "last_tested_at": now,
                    "updated_at": now,
                },
            )
        else:
            await sb_post("/rest/v1/connections", {
                "user_id": user_id,
                "service": body.service,
                "credentials": credentials,
                "is_active": True,
                "last_tested_at": now,
                "created_at": now,
                "updated_at": now,
            })

        logger.info(f"API key connection saved for service={body.service} user={user_id}")
        return {"status": "connected", "service": body.service}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_apikey_connection error: {e}")
        raise HTTPException(status_code=500, detail="Failed to save connection")


# ─────────────────────────────────────────────
# CONNECTION TEST
# ─────────────────────────────────────────────

@app.get("/api/connections/{service}/test")
async def test_connection(service: str, user: dict = Depends(get_current_user)):
    """Verify a stored connection by making a lightweight API call."""
    user_id = user["id"]

    try:
        rows = await sb_get(
            "/rest/v1/connections",
            params={"user_id": f"eq.{user_id}", "service": f"eq.{service}", "limit": "1"},
        )
        if not rows:
            raise HTTPException(status_code=404, detail=f"No connection found for service '{service}'")

        creds = rows[0].get("credentials", {})
        access_token = creds.get("access_token") or creds.get("api_key")

        details: dict = {}
        tested = False

        async with httpx.AsyncClient(timeout=15) as client:
            if service == "google_search_console":
                r = await client.get(
                    "https://www.googleapis.com/webmasters/v3/sites",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                tested = True
                if r.status_code == 200:
                    details = r.json()
                else:
                    raise HTTPException(status_code=400, detail=f"Google Search Console returned {r.status_code}")

            elif service == "google_analytics":
                r = await client.get(
                    "https://analyticsdata.googleapis.com/v1beta/properties",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                tested = True
                if r.status_code == 200:
                    details = r.json()
                else:
                    raise HTTPException(status_code=400, detail=f"Google Analytics returned {r.status_code}")

            elif service == "google_gemini":
                r = await client.get(
                    "https://generativelanguage.googleapis.com/v1beta/models",
                    params={"key": access_token},
                )
                tested = True
                if r.status_code == 200:
                    models = (r.json() or {}).get("models", [])
                    details = {
                        "model_count": len(models),
                        "sample_models": [m.get("name", "").replace("models/", "") for m in models[:5]],
                    }
                else:
                    raise HTTPException(status_code=400, detail=f"Google Gemini returned {r.status_code}")

            elif service == "github":
                r = await client.get(
                    "https://api.github.com/user",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Accept": "application/vnd.github+json",
                    },
                )
                tested = True
                if r.status_code == 200:
                    data = r.json()
                    details = {"login": data.get("login"), "name": data.get("name")}
                else:
                    raise HTTPException(status_code=400, detail=f"GitHub returned {r.status_code}")

            elif service == "twitter":
                r = await client.get(
                    "https://api.twitter.com/2/users/me",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                tested = True
                if r.status_code == 200:
                    details = r.json().get("data", {})
                else:
                    raise HTTPException(status_code=400, detail=f"Twitter returned {r.status_code}")

            elif service == "tiktok":
                r = await client.get(
                    "https://open.tiktokapis.com/v2/user/info/",
                    params={"fields": "open_id,display_name,username"},
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                tested = True
                if r.status_code == 200:
                    details = (r.json().get("data") or {}).get("user", {})
                else:
                    raise HTTPException(status_code=400, detail=f"TikTok returned {r.status_code}")

            elif service == "cloudflare":
                r = await client.get(
                    "https://api.cloudflare.com/client/v4/user/tokens/verify",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                tested = True
                if r.status_code == 200:
                    details = r.json().get("result", {})
                else:
                    raise HTTPException(status_code=400, detail=f"Cloudflare returned {r.status_code}")

        # Update last_tested_at
        now = datetime.now(timezone.utc).isoformat()
        await sb_patch(
            "/rest/v1/connections",
            params={"user_id": f"eq.{user_id}", "service": f"eq.{service}"},
            data={"last_tested_at": now, "updated_at": now},
        )

        logger.info(f"Connection test for service={service} user={user_id} tested={tested}")
        return {"status": "ok", "tested": tested, "details": details}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"test_connection error for {service}: {e}")
        raise HTTPException(status_code=500, detail="Connection test failed")


# ─────────────────────────────────────────────
# DASHBOARD STATS
# ─────────────────────────────────────────────

def _build_search_ops_demo(scope: Optional[dict] = None) -> dict:
    """Return rich Search Ops OS demo data for product-level UX surfaces."""
    now_iso = datetime.now(timezone.utc).isoformat()
    scope = scope or {"mode": "site"}

    signals = [
        {
            "id": "sig_001",
            "type": "impression_spike",
            "source": "google_search_console",
            "title": "Impression spike on privacy-intent cluster",
            "description": "Queries around private domain purchases rose 23% over 48h.",
            "severity": "high",
            "confidence": 0.91,
            "topic": "buy domains anonymously",
            "target_page": "https://croutons.ai/domain-privacy",
            "target_keyword_cluster": "domain privacy + anonymous purchase",
            "competitor_domain": None,
            "detected_at": now_iso,
            "status": "new",
            "metadata": {"next_step": "Create comparison/listicle support to capture rising demand"},
            "detecting_agent": "Citation Hunter Agent",
            "lifecycle_stage": "Observe",
            "site_scope_source": scope.get("gsc_site") or "sc-domain:croutons.ai",
            "evidence": [
                "GSC impressions: +23% over 48h for privacy-intent cluster",
                "CTR stable while position improved from 10.4 to 8.8",
            ],
            "why_flagged": [
                "Demand expansion with insufficient matching format coverage",
                "Opportunity window aligns with competitor publishing cadence",
            ],
            "linked_opportunity_ids": ["opp_001"],
        },
        {
            "id": "sig_002",
            "type": "competitor_publish",
            "source": "competitor_crawler",
            "title": "Competitor published new listicle",
            "description": "namesilo.com launched a 2026 domain privacy listicle with FAQ schema.",
            "severity": "high",
            "confidence": 0.88,
            "topic": "domain privacy providers",
            "target_page": None,
            "target_keyword_cluster": "best domain privacy providers",
            "competitor_domain": "namesilo.com",
            "detected_at": now_iso,
            "status": "new",
            "metadata": {"next_step": "Counter with comparison-driven listicle and FAQ coverage"},
            "detecting_agent": "Competitor Surveillance Agent",
            "lifecycle_stage": "Observe",
            "site_scope_source": "competitor_crawler:namesilo.com",
            "evidence": [
                "New URL detected in /blog/domain-privacy/ with FAQ schema",
                "Page format classified as listicle + comparison block",
            ],
            "why_flagged": [
                "Competitor entered high-intent topic before our fresh coverage",
                "Format currently outperforming plain explainers in citations",
            ],
            "linked_opportunity_ids": ["opp_001"],
        },
        {
            "id": "sig_003",
            "type": "schema_gap",
            "source": "site_crawler",
            "title": "Money page missing FAQ schema",
            "description": "High-intent service page lacks FAQPage + entity-rich Organization links.",
            "severity": "medium",
            "confidence": 0.84,
            "topic": "domain transfer security",
            "target_page": "https://croutons.ai/domain-transfer",
            "target_keyword_cluster": "secure domain transfer",
            "competitor_domain": None,
            "detected_at": now_iso,
            "status": "triaged",
            "metadata": {"next_step": "Patch schema + add 6 FAQs mapped to rising queries"},
            "detecting_agent": "Schema Optimizer Agent",
            "lifecycle_stage": "Observe",
            "site_scope_source": "crawler:https://croutons.ai/domain-transfer",
            "evidence": [
                "FAQPage schema not present on money page",
                "Entity sameAs links incomplete for Organization node",
            ],
            "why_flagged": [
                "Insufficient structured retrieval support for high-intent questions",
                "Competitors include FAQ + HowTo schema on equivalent pages",
            ],
            "linked_opportunity_ids": ["opp_002"],
        },
        {
            "id": "sig_004",
            "type": "ranking_drop",
            "source": "bing_webmaster",
            "title": "Primary page dropped from rank 5 to 9",
            "description": "Bing indicates ranking decline on comparison query family.",
            "severity": "high",
            "confidence": 0.79,
            "topic": "domain registrar comparison",
            "target_page": "https://croutons.ai/compare-registrars",
            "target_keyword_cluster": "domain registrar comparison",
            "competitor_domain": "namecheap.com",
            "detected_at": now_iso,
            "status": "new",
            "metadata": {"next_step": "Refresh page with comparison matrix and internal links"},
            "detecting_agent": "SEO Watcher Agent",
            "lifecycle_stage": "Observe",
            "site_scope_source": scope.get("bing_site") or "https://croutons.ai/",
            "evidence": [
                "Bing avg rank moved from 5.1 to 9.0 in 7 days",
                "Competing pages added newer comparison tables",
            ],
            "why_flagged": [
                "Freshness and format lag against competitor comparison content",
                "Internal link support to this page declined relative to peers",
            ],
            "linked_opportunity_ids": ["opp_003"],
        },
    ]

    opportunities = [
        {
            "id": "opp_001",
            "signal_ids": ["sig_001", "sig_002"],
            "type": "citation_gap",
            "title": "Launch competitor-counter privacy listicle",
            "description": "Current coverage misses listicle format favored by AI answers and citations.",
            "expected_impact": "Improve citation share for privacy-intent prompts in 7-10 days.",
            "citation_probability": 0.78,
            "urgency": 0.9,
            "confidence": 0.86,
            "recommended_format": "listicle + FAQ block + schema patch",
            "recommended_target": "https://croutons.ai/blog/buy-domains-anonymously",
            "recommended_actions": ["create_listicle", "add_schema", "create_social_thread"],
            "status": "open",
            "created_at": now_iso,
            "rationale": "Competitor format + rising query demand + low current citation density on our side.",
            "source_evidence": [
                "Signal sig_001: impression spike",
                "Signal sig_002: competitor listicle publish",
            ],
            "linked_plan_ids": ["plan_001"],
            "missing_entities": ["WHOIS privacy lock", "ICANN privacy tiers"],
            "missing_questions": ["How to buy anonymously?", "Which registrar includes privacy by default?"],
        },
        {
            "id": "opp_002",
            "signal_ids": ["sig_003"],
            "type": "schema_gap",
            "title": "Patch retrieval schema on transfer page",
            "description": "Missing FAQ/entity schema lowers retrieval clarity and AI grounding quality.",
            "expected_impact": "Raise retrieval confidence and win long-tail question citations.",
            "citation_probability": 0.64,
            "urgency": 0.72,
            "confidence": 0.83,
            "recommended_format": "schema enhancement + FAQ cluster",
            "recommended_target": "https://croutons.ai/domain-transfer",
            "recommended_actions": ["add_schema", "create_faq_cluster", "submit_indexing_request"],
            "status": "open",
            "created_at": now_iso,
            "rationale": "High-intent transfer page is under-structured compared with top competitor coverage.",
            "source_evidence": ["Signal sig_003: schema gap detection"],
            "linked_plan_ids": [],
            "missing_entities": ["EPP auth code", "transfer lock period"],
            "missing_questions": ["How long transfer takes?", "How to avoid downtime?"],
        },
        {
            "id": "opp_003",
            "signal_ids": ["sig_004"],
            "type": "content_refresh",
            "title": "Refresh underperforming comparison page",
            "description": "Ranking decline indicates stale comparisons and weak internal linking depth.",
            "expected_impact": "Recover top-5 position and improve click-through potential.",
            "citation_probability": 0.57,
            "urgency": 0.81,
            "confidence": 0.77,
            "recommended_format": "comparison refresh + internal linking upgrade",
            "recommended_target": "https://croutons.ai/compare-registrars",
            "recommended_actions": ["update_existing_page", "add_internal_links", "refresh_markdown_mirror"],
            "status": "planned",
            "created_at": now_iso,
            "rationale": "Ranking loss correlates with stale comparison blocks and weaker internal linking.",
            "source_evidence": ["Signal sig_004: ranking drop in Bing"],
            "linked_plan_ids": ["plan_002"],
            "missing_entities": ["pricing tiers", "privacy defaults"],
            "missing_questions": ["Best registrar for privacy pricing?"],
        },
    ]

    citation_gaps = [
        {
            "id": "gap_001",
            "gap_id": "gap_001",
            "gap_type": "listicle_gap",
            "source_type": "ai_overview",
            "source_url": "https://www.google.com/search?q=best+domain+privacy+providers",
            "source_entity": "AI Overview",
            "competitor_url": "https://www.namesilo.com/blog/domain-privacy/best-domain-privacy-registrars",
            "target_topic": "buy domains anonymously",
            "target_keyword_cluster": "anonymous domain purchase",
            "content_format_recommended": "listicle",
            "supporting_schema_recommended": ["FAQPage", "Article", "BreadcrumbList"],
            "missing_entities": ["WHOIS privacy lock", "proxy registration", "ICANN privacy tiers"],
            "missing_questions": [
                "How do I buy domains anonymously in 2026?",
                "Which registrars include privacy by default?",
            ],
            "citation_probability_score": 0.81,
            "urgency_score": 0.92,
            "confidence_score": 0.88,
            "expected_outcome": "Higher citation eligibility for privacy-intent AI answers.",
            "proposed_actions": ["create_listicle", "add_schema", "create_social_thread"],
            "created_at": now_iso,
            "status": "open",
            "opportunity_id": "opp_001",
            "linked_plan_ids": ["plan_001"],
            "human_explanation": "Competitor listicle with FAQ/schema is being surfaced while our equivalent topic lacks listicle structure and entity coverage, reducing citation probability.",
        },
        {
            "id": "gap_002",
            "gap_id": "gap_002",
            "gap_type": "faq_gap",
            "source_type": "site_audit",
            "source_url": "https://croutons.ai/domain-transfer",
            "source_entity": "Croutons transfer page",
            "competitor_url": "https://www.namecheap.com/domains/transfer/",
            "target_topic": "secure domain transfer",
            "target_keyword_cluster": "domain transfer security FAQs",
            "content_format_recommended": "faq_cluster",
            "supporting_schema_recommended": ["FAQPage", "HowTo"],
            "missing_entities": ["transfer lock period", "EPP auth code"],
            "missing_questions": [
                "How long does secure transfer take?",
                "Can I transfer domains without downtime?",
            ],
            "citation_probability_score": 0.66,
            "urgency_score": 0.74,
            "confidence_score": 0.82,
            "expected_outcome": "Increase answer completeness and ranking resilience.",
            "proposed_actions": ["create_faq_cluster", "add_schema", "submit_indexing_request"],
            "created_at": now_iso,
            "status": "open",
            "opportunity_id": "opp_002",
            "linked_plan_ids": [],
            "human_explanation": "Transfer page lacks machine-readable FAQ and entity support while competitor includes both, reducing retrieval readiness for question-style prompts.",
        },
    ]

    plans = [
        {
            "id": "plan_001",
            "opportunity_id": "opp_001",
            "agent_id": "demo_operator_01",
            "agent_name": "Citation Hunter Agent",
            "name": "Close Citation Gap for 'buy domains anonymously'",
            "description": "Create format parity and retrieval enhancements against top-cited competitor content.",
            "steps": [
                {"step_type": "generate_article", "provider": "openai", "target": "/blog/buy-domains-anonymously", "approval_required": False, "estimated_output": "listicle draft"},
                {"step_type": "add_faq_schema", "provider": "schema_optimizer", "target": "/blog/buy-domains-anonymously", "approval_required": False, "estimated_output": "FAQPage JSON-LD"},
                {"step_type": "generate_image_asset", "provider": "google_gemini", "target": "support image", "approval_required": False, "estimated_output": "1 featured image"},
                {"step_type": "publish_page", "provider": "github", "target": "malwarescan/neural-command", "approval_required": True, "estimated_output": "published page update"},
                {"step_type": "publish_social_thread", "provider": "twitter", "target": "@croutons", "approval_required": True, "estimated_output": "thread + link post"},
                {"step_type": "submit_indexing", "provider": "google_search_console", "target": "updated URL", "approval_required": False, "estimated_output": "indexing request"},
            ],
            "trigger_signal_ids": ["sig_001", "sig_002"],
            "linked_gap_ids": ["gap_001"],
            "why_this_plan_exists": "Signals show rising demand + competitor listicle advantage; gap requires format and schema parity plus distribution support.",
            "estimated_impact": "High",
            "estimated_cost": 0.1842,
            "estimated_tokens": 48600,
            "expected_outputs": ["new article", "FAQ schema", "support image", "social thread", "indexing request"],
            "approval_state": "needs_approval",
            "status": "ready",
            "created_at": now_iso,
        },
        {
            "id": "plan_002",
            "opportunity_id": "opp_003",
            "agent_id": "demo_operator_02",
            "agent_name": "Recovery Agent",
            "name": "Recover comparison page ranking loss",
            "description": "Refresh stale sections and improve internal linking graph.",
            "steps": [
                {"step_type": "update_existing_page", "provider": "github", "target": "/compare-registrars", "approval_required": False, "estimated_output": "updated comparison matrix"},
                {"step_type": "create_faq_cluster", "provider": "openai", "target": "/compare-registrars", "approval_required": False, "estimated_output": "faq block"},
                {"step_type": "add_schema", "provider": "schema_optimizer", "target": "/compare-registrars", "approval_required": False, "estimated_output": "Organization + FAQ JSON-LD"},
                {"step_type": "refresh_markdown_mirror", "provider": "croutons_layer", "target": "mirror payload", "approval_required": False, "estimated_output": "updated markdown mirror"},
                {"step_type": "measure_delta", "provider": "gsc+bwt", "target": "rankings 7-day", "approval_required": False, "estimated_output": "delta report"},
            ],
            "trigger_signal_ids": ["sig_004"],
            "linked_gap_ids": [],
            "why_this_plan_exists": "Page rank drop plus stale comparison sections indicate a recovery refresh is needed.",
            "estimated_impact": "Medium",
            "estimated_cost": 0.0975,
            "estimated_tokens": 26400,
            "expected_outputs": ["refreshed comparison block", "FAQ cluster", "schema patch", "updated markdown mirror"],
            "approval_state": "approved",
            "status": "running",
            "created_at": now_iso,
        },
    ]

    executions = [
        {
            "id": "exe_001",
            "plan_id": "plan_002",
            "agent_id": "demo_operator_02",
            "agent_name": "Recovery Agent",
            "status": "running",
            "started_at": now_iso,
            "completed_at": None,
            "scope_mode": scope.get("mode", "site"),
            "lifecycle_stage_at_start": "Execute",
            "approval_snapshot": {"automation_mode": "semi_auto_rules", "approved_by": "system-policy"},
            "step_logs": [
                {"timestamp": now_iso, "action_type": "update_existing_page", "provider": "github", "target": "/compare-registrars", "status": "completed", "result": "comparison block refreshed"},
                {"timestamp": now_iso, "action_type": "add_schema", "provider": "schema_optimizer", "target": "/compare-registrars", "status": "running", "result": "generating FAQ JSON-LD"},
            ],
            "output_assets": ["comparison-table-v3.md"],
            "affected_urls": ["https://croutons.ai/compare-registrars"],
            "distribution_targets": [],
            "cost": 0.0821,
            "tokens": 23120,
            "linked_outcome_ids": [],
            "triggering_signal_ids": ["sig_004"],
            "linked_opportunity_id": "opp_003",
        },
        {
            "id": "exe_002",
            "plan_id": "plan_001",
            "agent_id": "demo_operator_01",
            "agent_name": "Citation Hunter Agent",
            "status": "completed",
            "started_at": now_iso,
            "completed_at": now_iso,
            "scope_mode": scope.get("mode", "site"),
            "lifecycle_stage_at_start": "Execute",
            "approval_snapshot": {"automation_mode": "approval_publish_distribution", "approved_by": "operator@croutons.ai"},
            "step_logs": [
                {"timestamp": now_iso, "action_type": "publish_page", "provider": "github", "target": "malwarescan/neural-command", "status": "completed", "result": "page update merged"},
                {"timestamp": now_iso, "action_type": "submit_indexing", "provider": "google_search_console", "target": "updated URL", "status": "completed", "result": "indexing submitted"},
            ],
            "output_assets": ["faq-block-v2.jsonld"],
            "affected_urls": ["https://croutons.ai/domain-privacy"],
            "distribution_targets": ["twitter"],
            "cost": 0.0512,
            "tokens": 14210,
            "linked_outcome_ids": ["out_001"],
            "triggering_signal_ids": ["sig_001", "sig_002"],
            "linked_opportunity_id": "opp_001",
        },
        {
            "id": "exe_003",
            "plan_id": "plan_001",
            "agent_id": "demo_operator_03",
            "agent_name": "Distribution Agent",
            "status": "completed",
            "started_at": now_iso,
            "completed_at": now_iso,
            "scope_mode": scope.get("mode", "site"),
            "lifecycle_stage_at_start": "Execute",
            "approval_snapshot": {"automation_mode": "approval_publish_distribution", "approved_by": "operator@croutons.ai"},
            "step_logs": [
                {"timestamp": now_iso, "action_type": "generate_social_thread", "provider": "openai", "target": "twitter", "status": "completed", "result": "6-post thread generated"},
                {"timestamp": now_iso, "action_type": "publish_social_thread", "provider": "twitter", "target": "@croutons", "status": "completed", "result": "thread published"},
            ],
            "output_assets": ["x-thread-privacy-pack.md", "privacy-support-image.png"],
            "affected_urls": ["https://croutons.ai/blog/private-domain-registration-guide"],
            "distribution_targets": ["twitter", "tiktok"],
            "cost": 0.0644,
            "tokens": 17892,
            "linked_outcome_ids": ["out_002"],
            "triggering_signal_ids": ["sig_001", "sig_002"],
            "linked_opportunity_id": "opp_001",
        },
    ]

    outcomes = [
        {
            "id": "out_001",
            "execution_id": "exe_002",
            "type": "ranking_and_impression_lift",
            "baseline_metrics": {"impressions_7d": 11800, "avg_position": 8.9, "citations_7d": 4},
            "current_metrics": {"impressions_7d": 13924, "avg_position": 6.7, "citations_7d": 7},
            "delta_metrics": {"impressions_pct": 18.0, "avg_position_change": 2.2, "citations_delta": 3},
            "citations_detected": 7,
            "ranking_change": 2.2,
            "impression_change": 2124,
            "traffic_change": 312,
            "engagement_change": 8.4,
            "measured_at": now_iso,
            "confidence": 0.87,
            "time_window": "7d",
            "evidence_sources": ["google_search_console", "bing_webmaster", "citation_monitor"],
            "narrative_summary": "One week after execution, the refreshed page improved impressions and average rank while citation detections increased on tracked prompts.",
        },
        {
            "id": "out_002",
            "execution_id": "exe_003",
            "type": "distribution_uplift",
            "baseline_metrics": {"ai_mentions_rate": 0.12, "social_clicks": 141},
            "current_metrics": {"ai_mentions_rate": 0.19, "social_clicks": 262},
            "delta_metrics": {"ai_mentions_rate_delta": 0.07, "social_clicks_delta": 121},
            "citations_detected": 3,
            "ranking_change": 0.6,
            "impression_change": 947,
            "traffic_change": 186,
            "engagement_change": 14.2,
            "measured_at": now_iso,
            "confidence": 0.81,
            "time_window": "7d",
            "evidence_sources": ["google_search_console", "social_analytics", "citation_monitor"],
            "narrative_summary": "Post-publication distribution increased social discovery and improved AI mention rate for the target topic cluster.",
        },
    ]

    competitors = [
        {
            "id": "comp_001",
            "domain": "namesilo.com",
            "label": "NameSilo",
            "tracked_topics": ["domain privacy", "WHOIS masking"],
            "last_seen": now_iso,
            "recent_changes": [
                "Published new 2026 privacy listicle",
                "Added FAQ schema to comparison pages",
            ],
            "format_patterns": ["listicle", "comparison", "faq_cluster"],
            "schema_patterns": ["FAQPage", "Article", "BreadcrumbList"],
            "freshness_velocity": "high",
            "where_they_beat_us": ["privacy listicle coverage", "faq depth"],
            "counter_opportunities": ["opp_001"],
            "opportunity_links": ["opp_001"],
        },
        {
            "id": "comp_002",
            "domain": "namecheap.com",
            "label": "Namecheap",
            "tracked_topics": ["domain transfer", "registrar comparison"],
            "last_seen": now_iso,
            "recent_changes": [
                "Expanded transfer FAQ blocks",
                "Added entity-rich schema on key landing pages",
            ],
            "format_patterns": ["how-to", "comparison", "faq_cluster"],
            "schema_patterns": ["HowTo", "FAQPage", "Organization"],
            "freshness_velocity": "medium",
            "where_they_beat_us": ["transfer FAQ completeness"],
            "counter_opportunities": ["opp_003"],
            "opportunity_links": ["opp_003"],
        },
        {
            "id": "comp_003",
            "domain": "godaddy.com",
            "label": "GoDaddy",
            "tracked_topics": ["domain pricing", "bundle comparisons"],
            "last_seen": now_iso,
            "recent_changes": ["Launched new comparison content hub"],
            "format_patterns": ["comparison_hub", "glossary"],
            "schema_patterns": ["Article", "ItemList"],
            "freshness_velocity": "medium",
            "where_they_beat_us": ["topic breadth"],
            "counter_opportunities": [],
            "opportunity_links": [],
        },
    ]

    lifecycle_counts = {
        "observe": len(signals),
        "diagnose": len(opportunities),
        "plan": len(plans),
        "execute": sum(1 for e in executions if e["status"] in ("running", "queued")),
        "measure": len(outcomes),
    }

    kpis = {
        "active_agents": 3,
        "signals_detected_today": len(signals),
        "opportunities_open": sum(1 for o in opportunities if o["status"] == "open"),
        "plans_ready": sum(1 for p in plans if p["status"] in {"ready", "approved", "pending_approval", "queued"}),
        "executions_today": len(executions),
        "citations_earned": sum(o.get("citations_detected", 0) for o in outcomes),
        "ranking_wins": 4,
        "content_published": 3,
        "distribution_actions": sum(len(e.get("distribution_targets", [])) for e in executions),
        "estimated_visibility_lift": 17.6,
    }

    audit_trail = []
    for exe in executions:
        audit_trail.append({
            "execution_id": exe.get("id"),
            "agent_id": exe.get("agent_id"),
            "agent_name": exe.get("agent_name"),
            "lifecycle_stage": exe.get("lifecycle_stage_at_start", "Execute"),
            "scope_mode": exe.get("scope_mode", scope.get("mode", "site")),
            "triggering_signal_ids": exe.get("triggering_signal_ids", []),
            "linked_opportunity_id": exe.get("linked_opportunity_id"),
            "linked_plan_id": exe.get("plan_id"),
            "approval_actor": (exe.get("approval_snapshot") or {}).get("approved_by"),
            "automation_mode": (exe.get("approval_snapshot") or {}).get("automation_mode"),
            "model_provider": ", ".join(sorted({str((l.get("provider") or "")).strip() for l in (exe.get("step_logs") or []) if l.get("provider")})),
            "affected_resources": exe.get("affected_urls", []),
            "linked_outcome_ids": exe.get("linked_outcome_ids", []),
            "status": exe.get("status"),
            "started_at": exe.get("started_at"),
        })

    return {
        "scope": scope,
        "headline": "Autonomous AI Search Operators for SEO, AEO, GEO, citation growth, and website execution.",
        "lifecycle_counts": lifecycle_counts,
        "kpis": kpis,
        "signals": signals,
        "opportunities": opportunities,
        "citation_gaps": citation_gaps,
        "plans": plans,
        "executions": executions,
        "outcomes": outcomes,
        "competitors": competitors,
        "audit_trail": audit_trail,
    }


SEARCH_OPS_RUNTIME: dict[str, dict] = {}

SCENARIO_PACKS: list[dict] = [
    {
        "scenario_id": "citation_gap_recovery",
        "name": "Citation Gap Recovery",
        "description": "Competitor listicle triggers gap detection, governed execution, and citation lift.",
        "category": "citation",
        "seed_key": "cg-2026-01",
        "expected_duration": "8-12 min",
        "recommended_audience": "sales",
        "default_scope": {"mode": "site"},
        "tags": ["citation", "approval", "schema", "distribution"],
        "narrative_summary": "Croutons detects a citation gap, builds a plan, pauses for approval, executes, and starts measuring outcomes.",
        "recommended_walkthrough_order": ["signals", "opportunities", "plans", "approvals", "executions", "outcomes"],
        "stages": [
            {"stage_id": "cg_1", "sequence": 1, "title": "Gap Detected", "description": "Competitor listicle detection appears as a signal and citation gap.", "trigger_type": "system", "speaker_notes": "Show evidence and rationale surfaces first."},
            {"stage_id": "cg_2", "sequence": 2, "title": "Plan Generated", "description": "Signal converts to opportunity and plan in pending approval.", "trigger_type": "operator", "speaker_notes": "Demonstrate governed autonomy before execution."},
            {"stage_id": "cg_3", "sequence": 3, "title": "Approval Gate", "description": "Publish/distribution remains blocked until approval.", "trigger_type": "approval", "speaker_notes": "Highlight risk-aware controls."},
            {"stage_id": "cg_4", "sequence": 4, "title": "Execution + Artifacts", "description": "Execution runs and emits article/FAQ/schema/thread artifacts.", "trigger_type": "runtime", "speaker_notes": "Inspect Outputs/Artifacts section."},
            {"stage_id": "cg_5", "sequence": 5, "title": "Outcome Measuring", "description": "Outcome enters measuring then observed.", "trigger_type": "measurement", "speaker_notes": "Close with business impact narrative."},
        ],
    },
    {
        "scenario_id": "search_spike_response",
        "name": "Search Spike Response",
        "description": "Impression spike triggers rapid refresh and indexing workflow.",
        "category": "search",
        "seed_key": "ss-2026-01",
        "expected_duration": "5-8 min",
        "recommended_audience": "onboarding",
        "default_scope": {"mode": "site"},
        "tags": ["gsc", "refresh", "indexing"],
        "narrative_summary": "Croutons detects rising demand and rapidly refreshes content for capture.",
        "recommended_walkthrough_order": ["signals", "plans", "executions", "outcomes"],
        "stages": [
            {"stage_id": "ss_1", "sequence": 1, "title": "Spike Detected", "description": "GSC spike signal appears.", "trigger_type": "system", "speaker_notes": "Show trend snapshot and why flagged."},
            {"stage_id": "ss_2", "sequence": 2, "title": "Rapid Plan", "description": "Refresh plan queued quickly.", "trigger_type": "operator", "speaker_notes": "Emphasize fast response."},
            {"stage_id": "ss_3", "sequence": 3, "title": "Execution", "description": "Refresh + indexing request steps complete.", "trigger_type": "runtime", "speaker_notes": "Inspect timeline and outputs."},
            {"stage_id": "ss_4", "sequence": 4, "title": "Outcome Movement", "description": "Early ranking/impression movement appears.", "trigger_type": "measurement", "speaker_notes": "Show deterministic delta progression."},
        ],
    },
    {
        "scenario_id": "schema_upgrade_retrieval",
        "name": "Schema Upgrade for AI Retrieval",
        "description": "Schema gap on key page requires money-page approval, then improves retrieval readiness.",
        "category": "schema",
        "seed_key": "sr-2026-01",
        "expected_duration": "6-10 min",
        "recommended_audience": "technical",
        "default_scope": {"mode": "site"},
        "tags": ["schema", "approval", "retrieval"],
        "narrative_summary": "Croutons patches structured data under guardrails and improves AI retrieval readiness.",
        "recommended_walkthrough_order": ["citation_gaps", "plans", "approvals", "executions", "outcomes"],
        "stages": [
            {"stage_id": "sr_1", "sequence": 1, "title": "Schema Gap Identified", "description": "Gap surfaced with missing entities/questions.", "trigger_type": "system", "speaker_notes": "Inspect machine + human explanation."},
            {"stage_id": "sr_2", "sequence": 2, "title": "Patch Plan Created", "description": "Schema patch plan enters pending approval.", "trigger_type": "operator", "speaker_notes": "Show approval_type precision."},
            {"stage_id": "sr_3", "sequence": 3, "title": "Approval + Execute", "description": "Money-page approval unlocks execution.", "trigger_type": "approval", "speaker_notes": "This is governed autonomy in action."},
            {"stage_id": "sr_4", "sequence": 4, "title": "Retrieval Lift", "description": "Entity coverage and retrieval readiness improve.", "trigger_type": "measurement", "speaker_notes": "Use outcomes evidence panel."},
        ],
    },
    {
        "scenario_id": "competitor_counter_move",
        "name": "Competitor Counter-Move",
        "description": "Competitor launch triggers responsive content and distribution with approval resume.",
        "category": "competitive",
        "seed_key": "ccm-2026-01",
        "expected_duration": "7-11 min",
        "recommended_audience": "sales",
        "default_scope": {"mode": "site"},
        "tags": ["competitor", "counter-content", "distribution"],
        "narrative_summary": "Croutons responds to competitor activity with governed counter-content execution.",
        "recommended_walkthrough_order": ["competitors", "opportunities", "plans", "approvals", "executions"],
        "stages": [
            {"stage_id": "ccm_1", "sequence": 1, "title": "Competitor Launch Detected", "description": "New competitor page appears.", "trigger_type": "system", "speaker_notes": "Anchor on competitor delta cards."},
            {"stage_id": "ccm_2", "sequence": 2, "title": "Counter Plan", "description": "Counter opportunity and plan generated.", "trigger_type": "operator", "speaker_notes": "Show chain continuity."},
            {"stage_id": "ccm_3", "sequence": 3, "title": "Distribution Approval Block", "description": "Execution waits for distribution approval.", "trigger_type": "approval", "speaker_notes": "Demonstrate approval queue precision."},
            {"stage_id": "ccm_4", "sequence": 4, "title": "Resume + Publish", "description": "Approval resumes execution and outputs appear in order.", "trigger_type": "runtime", "speaker_notes": "Inspect artifacts and audit trail."},
        ],
    },
    {
        "scenario_id": "failed_distribution_recovery",
        "name": "Failed Distribution Then Recovery",
        "description": "Partial success with social failure followed by deterministic retry recovery.",
        "category": "recovery",
        "seed_key": "fdr-2026-01",
        "expected_duration": "6-9 min",
        "recommended_audience": "technical",
        "default_scope": {"mode": "site"},
        "tags": ["failure", "retry", "audit"],
        "narrative_summary": "Croutons recovers from distribution failure while preserving successful publish outputs.",
        "recommended_walkthrough_order": ["executions", "errors", "retry", "artifacts", "outcomes"],
        "stages": [
            {"stage_id": "fdr_1", "sequence": 1, "title": "Partial Success", "description": "Publish succeeds but social step fails.", "trigger_type": "runtime", "speaker_notes": "Show failed step and category."},
            {"stage_id": "fdr_2", "sequence": 2, "title": "Retry Triggered", "description": "Operator retries failed step.", "trigger_type": "operator", "speaker_notes": "Demonstrate recoverable failure path."},
            {"stage_id": "fdr_3", "sequence": 3, "title": "Recovery Complete", "description": "Retry succeeds and audit logs both attempts.", "trigger_type": "runtime", "speaker_notes": "Highlight trust and traceability."},
        ],
    },
    {
        "scenario_id": "multi_agent_workload",
        "name": "Multi-Agent Workload Demo",
        "description": "Demonstrates overloaded/normal/underutilized operators and queue pressure shifts.",
        "category": "fleet",
        "seed_key": "maw-2026-01",
        "expected_duration": "8-12 min",
        "recommended_audience": "executive",
        "default_scope": {"mode": "site"},
        "tags": ["fleet", "throughput", "queue-pressure"],
        "narrative_summary": "Croutons shows fleet-level workload orchestration and governance at scale.",
        "recommended_walkthrough_order": ["live-ops", "agent-ops", "agent-detail"],
        "stages": [
            {"stage_id": "maw_1", "sequence": 1, "title": "Queue Pressure Rises", "description": "Backlog and approvals increase.", "trigger_type": "system", "speaker_notes": "Use Live Ops and Agent Ops together."},
            {"stage_id": "maw_2", "sequence": 2, "title": "Load Imbalance", "description": "One agent overloaded, one normal, one underutilized.", "trigger_type": "runtime", "speaker_notes": "Highlight workload indicators."},
            {"stage_id": "maw_3", "sequence": 3, "title": "Controlled Recovery", "description": "Approvals clear and throughput normalizes.", "trigger_type": "operator", "speaker_notes": "Close with governance value."},
        ],
    },
]

WALKTHROUGH_LIBRARY: list[dict] = [
    {
        "walkthrough_id": "wt_exec_citation_publish",
        "scenario_id": "citation_gap_recovery",
        "name": "Executive: Citation Gap to Controlled Publish",
        "description": "Guided executive walkthrough from signal detection to governed publish and measuring outcome.",
        "audience_type": "executive",
        "mode": "recorded",
        "estimated_duration": "6-9 min",
        "objectives": ["Show governed autonomy", "Show artifact outputs", "Show measurable outcomes"],
        "recording_friendly": True,
        "steps": [
            {"step_id": "w1", "sequence": 1, "title": "Open Signals", "description": "Inspect the triggering signal.", "ui_target": "cc-tab-signals", "target_type": "tab", "target_selector": "[data-tab=signals]", "action_type": "navigate_tab", "expected_user_action": "Open Signals tab", "expected_system_state": {"scenario_stage_at_least": 0}, "validation_rule": "tab_active:signals", "can_auto_advance": True, "auto_advance_delay_ms": 900, "speaker_note": "Croutons continuously observes search and citation shifts.", "business_value_note": "Early detection prevents missed visibility windows", "operator_note": "Inspect evidence before planning", "completion_condition": {"type": "tab_active", "tab": "signals"}},
            {"step_id": "w2", "sequence": 2, "title": "Inspect Signal Evidence", "description": "Open signal detail to view rationale.", "ui_target": "signal-inspect-btn", "target_type": "object_action", "target_selector": ".cc-activity-item .btn", "action_type": "open_inspect", "object_ref": {"kind": "signal", "id": "sig_001"}, "expected_user_action": "Open signal drawer", "expected_system_state": {"scenario_stage_at_least": 1}, "validation_rule": "inspect_open:signal", "can_auto_advance": True, "auto_advance_delay_ms": 1100, "speaker_note": "Evidence explains why this signal was flagged.", "business_value_note": "Trustworthy recommendation basis", "operator_note": "Verify before converting", "completion_condition": {"type": "inspect_open", "kind": "signal"}},
            {"step_id": "w3", "sequence": 3, "title": "Open Plans", "description": "Move to the generated plan and approval state.", "ui_target": "cc-tab-plans", "target_type": "tab", "target_selector": "[data-tab=plans]", "action_type": "navigate_tab", "expected_user_action": "Open Plans tab", "expected_system_state": {"scenario_stage_at_least": 2}, "validation_rule": "tab_active:plans", "can_auto_advance": True, "auto_advance_delay_ms": 900, "speaker_note": "The system proposes concrete multi-step execution.", "business_value_note": "Faster execution planning under controls", "operator_note": "Review before approval", "optional_branching": [{"branch_id": "w3_gov", "label": "Show governance depth", "description": "Dive into approval and guardrail controls", "target_step_id": "w4", "branch_type": "governance_approval", "audience_fit": "executive_demo", "business_value_note": "Risk-managed autonomy", "speaker_note": "Pause on approvals to show control.", "return_to_mainline": True}, {"branch_id": "w3_skip_outcome", "label": "Skip to business outcome", "description": "Jump directly to measuring impact", "target_step_id": "w6", "branch_type": "skip_ahead", "audience_fit": "business_impact", "business_value_note": "Immediate value signal", "speaker_note": "Use when stakeholder asks for impact first.", "return_to_mainline": False}], "completion_condition": {"type": "tab_active", "tab": "plans"}},
            {"step_id": "w4", "sequence": 4, "title": "Approval Moment", "description": "Show approval gate before publish/distribution.", "ui_target": "approval-queue", "target_type": "panel", "target_selector": ".cc-table", "action_type": "advance_stage", "expected_user_action": "Review approval item", "expected_system_state": {"scenario_stage_at_least": 3}, "validation_rule": "approval_pending", "can_auto_advance": False, "auto_advance_delay_ms": 0, "speaker_note": "Automation pauses at risk boundaries.", "business_value_note": "Governance without sacrificing speed", "operator_note": "Approve when ready", "completion_condition": {"type": "approval_pending"}},
            {"step_id": "w5", "sequence": 5, "title": "Watch Execution", "description": "Switch to Live Ops and inspect running execution.", "ui_target": "cc-tab-live-ops", "target_type": "tab", "target_selector": "[data-tab=live-ops]", "action_type": "navigate_tab", "expected_user_action": "Open Live Ops", "expected_system_state": {"scenario_stage_at_least": 4}, "validation_rule": "tab_active:live-ops", "can_auto_advance": True, "auto_advance_delay_ms": 900, "speaker_note": "Runtime orchestration shows step-level progress.", "business_value_note": "Operational transparency", "operator_note": "Track progress and blockers", "completion_condition": {"type": "tab_active", "tab": "live-ops"}},
            {"step_id": "w6", "sequence": 6, "title": "Outputs and Outcome", "description": "Inspect execution artifacts and measuring outcome.", "ui_target": "execution-inspect-btn", "target_type": "object_action", "target_selector": ".live-inspect", "action_type": "open_inspect", "object_ref": {"kind": "execution"}, "expected_user_action": "Open execution detail", "expected_system_state": {"outcome_stage": "measuring"}, "validation_rule": "outcome_stage:measuring", "can_auto_advance": False, "auto_advance_delay_ms": 0, "speaker_note": "Artifacts prove what the system produced.", "business_value_note": "Clear line from action to measurable impact", "operator_note": "Validate outputs and monitor outcome", "completion_condition": {"type": "outcome_stage", "value": "measuring"}},
        ],
    },
    {
        "walkthrough_id": "wt_sales_counter_move",
        "scenario_id": "competitor_counter_move",
        "name": "Sales: Competitor Counter-Move",
        "description": "Highlights differentiation: competitor detection, governed response, and approval resume.",
        "audience_type": "sales",
        "mode": "recorded",
        "estimated_duration": "6-8 min",
        "objectives": ["Show differentiation", "Show governance and recovery", "Show outputs"],
        "recording_friendly": True,
        "steps": [
            {"step_id": "s1", "sequence": 1, "title": "Competitor Surface", "description": "Open competitor intelligence.", "ui_target": "cc-tab-competitors", "target_type": "tab", "target_selector": "[data-tab=competitors]", "action_type": "navigate_tab", "expected_system_state": {"scenario_stage_at_least": 1}, "can_auto_advance": True, "auto_advance_delay_ms": 800, "speaker_note": "Croutons sees competitor changes quickly.", "business_value_note": "Protects share-of-search", "operator_note": "Prioritize competitive deltas", "completion_condition": {"type": "tab_active", "tab": "competitors"}},
            {"step_id": "s2", "sequence": 2, "title": "Counter Plan", "description": "Show generated counter plan.", "ui_target": "cc-tab-plans", "target_type": "tab", "target_selector": "[data-tab=plans]", "action_type": "navigate_tab", "expected_system_state": {"scenario_stage_at_least": 2}, "can_auto_advance": True, "auto_advance_delay_ms": 900, "speaker_note": "Counter-opportunity becomes executable plan.", "business_value_note": "Faster response than manual teams", "operator_note": "Check guardrails before run", "optional_branching": [{"branch_id": "s2_artifacts", "label": "Show artifact value", "description": "Jump to generated outputs preview", "target_step_id": "s3", "branch_type": "artifact_review", "audience_fit": "sales_demo", "business_value_note": "Proof of produced assets", "speaker_note": "Artifacts make value concrete.", "return_to_mainline": True}, {"branch_id": "s2_evidence", "label": "Show competitor evidence", "description": "Revisit competitor signal and rationale", "target_step_id": "s1", "branch_type": "technical_depth", "audience_fit": "technical_qa", "business_value_note": "Evidence-backed recommendations", "speaker_note": "Useful when challenged on why.", "return_to_mainline": True}], "completion_condition": {"type": "tab_active", "tab": "plans"}},
            {"step_id": "s3", "sequence": 3, "title": "Approval + Resume", "description": "Demonstrate blocked distribution and approval resume.", "ui_target": "approval-queue", "target_type": "panel", "target_selector": ".cc-table", "action_type": "await_manual", "expected_system_state": {"approval_pending": True}, "can_auto_advance": False, "auto_advance_delay_ms": 0, "speaker_note": "Distribution pauses until human approval.", "business_value_note": "High trust governed autonomy", "operator_note": "Approve to continue", "completion_condition": {"type": "approval_pending"}},
        ],
    },
    {
        "walkthrough_id": "wt_onboarding_lifecycle",
        "scenario_id": "search_spike_response",
        "name": "Onboarding: Search Ops Lifecycle",
        "description": "Teaches Signal -> Opportunity -> Plan -> Execution -> Outcome flow.",
        "audience_type": "onboarding",
        "mode": "self_guided",
        "estimated_duration": "8-12 min",
        "objectives": ["Understand lifecycle", "Learn inspect surfaces", "Learn approvals and outcomes"],
        "recording_friendly": False,
        "steps": [
            {"step_id": "o1", "sequence": 1, "title": "Signals", "description": "Start with Observe layer.", "ui_target": "cc-tab-signals", "target_type": "tab", "target_selector": "[data-tab=signals]", "action_type": "navigate_tab", "can_auto_advance": False, "speaker_note": "Signals are evidence-backed events.", "business_value_note": "Spot opportunities early", "operator_note": "Inspect evidence first", "completion_condition": {"type": "tab_active", "tab": "signals"}},
            {"step_id": "o2", "sequence": 2, "title": "Opportunities", "description": "Move into Diagnose layer.", "ui_target": "cc-tab-opportunities", "target_type": "tab", "target_selector": "[data-tab=opportunities]", "action_type": "navigate_tab", "can_auto_advance": False, "speaker_note": "Opportunities explain why action should exist.", "business_value_note": "Prioritized growth backlog", "operator_note": "Check rationale and expected impact", "completion_condition": {"type": "tab_active", "tab": "opportunities"}},
            {"step_id": "o3", "sequence": 3, "title": "Plans", "description": "Review structured execution steps.", "ui_target": "cc-tab-plans", "target_type": "tab", "target_selector": "[data-tab=plans]", "action_type": "navigate_tab", "can_auto_advance": False, "speaker_note": "Plans transform intelligence into action.", "business_value_note": "Execution-ready playbooks", "operator_note": "Review approvals per step", "completion_condition": {"type": "tab_active", "tab": "plans"}},
            {"step_id": "o4", "sequence": 4, "title": "Executions + Outcomes", "description": "Observe runtime and measurement.", "ui_target": "cc-tab-executions", "target_type": "tab", "target_selector": "[data-tab=executions]", "action_type": "navigate_tab", "can_auto_advance": False, "speaker_note": "Runtime + outcomes close the loop.", "business_value_note": "Measurable business impact", "operator_note": "Track progress and deltas", "completion_condition": {"type": "tab_active", "tab": "executions"}},
        ],
    },
    {
        "walkthrough_id": "wt_technical_runtime_audit",
        "scenario_id": "failed_distribution_recovery",
        "name": "Technical: Runtime Orchestration and Auditability",
        "description": "Demonstrates dependencies, failure categories, retries, and audit chain.",
        "audience_type": "technical",
        "mode": "guided",
        "estimated_duration": "7-10 min",
        "objectives": ["Inspect step dependencies", "Show recoverable failures", "Show audit metadata"],
        "recording_friendly": True,
        "steps": [
            {"step_id": "t1", "sequence": 1, "title": "Live Ops Failure", "description": "Show failed step in runtime.", "ui_target": "cc-tab-live-ops", "target_type": "tab", "target_selector": "[data-tab=live-ops]", "action_type": "navigate_tab", "can_auto_advance": True, "auto_advance_delay_ms": 800, "speaker_note": "Failure is explicit and categorized.", "business_value_note": "Transparent failure handling reduces risk", "operator_note": "Inspect and recover", "completion_condition": {"type": "tab_active", "tab": "live-ops"}},
            {"step_id": "t2", "sequence": 2, "title": "Retry and Recover", "description": "Retry failed step and continue execution.", "ui_target": "live-action-retry", "target_type": "action", "target_selector": ".live-action[data-action='retry_step']", "action_type": "await_manual", "can_auto_advance": False, "speaker_note": "Retry recovers without losing successful outputs.", "business_value_note": "Operational resilience", "operator_note": "Use retry controls", "optional_branching": [{"branch_id": "t2_audit", "label": "Inspect audit detail", "description": "Go directly to audit evidence trail", "target_step_id": "t3", "branch_type": "technical_depth", "audience_fit": "technical_qa", "business_value_note": "Traceability proof", "speaker_note": "Audit confirms each transition.", "return_to_mainline": False}, {"branch_id": "t2_return_main", "label": "Return to mainline", "description": "Continue standard recovery flow", "target_step_id": "t3", "branch_type": "return_to_mainline", "audience_fit": "all", "business_value_note": "Keep narrative concise", "speaker_note": "Continue main technical story.", "return_to_mainline": False}], "completion_condition": {"type": "execution_recovered"}},
            {"step_id": "t3", "sequence": 3, "title": "Audit Trail", "description": "Review audit entries for both attempts.", "ui_target": "cc-tab-agent-ops", "target_type": "tab", "target_selector": "[data-tab=agent-ops]", "action_type": "navigate_tab", "can_auto_advance": False, "speaker_note": "Audit chain proves accountability.", "business_value_note": "Enterprise trust and governance", "operator_note": "Validate traceability", "completion_condition": {"type": "tab_active", "tab": "agent-ops"}},
        ],
    },
    {
        "walkthrough_id": "wt_fleet_queue_pressure",
        "scenario_id": "multi_agent_workload",
        "name": "Fleet Demo: Multi-Agent Workload and Queue Pressure",
        "description": "Shows workload imbalance, queue pressure, and throughput normalization.",
        "audience_type": "executive",
        "mode": "guided",
        "estimated_duration": "6-9 min",
        "objectives": ["Show fleet-level management", "Show queue pressure", "Show governance at scale"],
        "recording_friendly": True,
        "steps": [
            {"step_id": "f1", "sequence": 1, "title": "Live Queue Pressure", "description": "Observe queue backlog and blocked runs.", "ui_target": "cc-tab-live-ops", "target_type": "tab", "target_selector": "[data-tab=live-ops]", "action_type": "navigate_tab", "can_auto_advance": True, "auto_advance_delay_ms": 900, "speaker_note": "Fleet behavior is observable in real time.", "business_value_note": "Manage throughput predictably", "operator_note": "Watch backlog and blockers", "completion_condition": {"type": "tab_active", "tab": "live-ops"}},
            {"step_id": "f2", "sequence": 2, "title": "Agent Load Compare", "description": "Open Agent Ops to compare overloaded vs underutilized operators.", "ui_target": "cc-tab-agent-ops", "target_type": "tab", "target_selector": "[data-tab=agent-ops]", "action_type": "navigate_tab", "can_auto_advance": False, "speaker_note": "Workload indicators guide staffing and guardrails.", "business_value_note": "Scalable operator governance", "operator_note": "Compare throughput and load", "completion_condition": {"type": "tab_active", "tab": "agent-ops"}},
        ],
    },
]

DEMO_PACKS: list[dict] = [
    {
        "demo_pack_id": "pack_exec_controlled_publish",
        "name": "Executive Controlled Publish Demo",
        "description": "Outcome-focused story from citation gap to governed execution and measuring outcome.",
        "scenario_id": "citation_gap_recovery",
        "walkthrough_id": "wt_exec_citation_publish",
        "seed_key": "exec-pack-seed-01",
        "audience_mode": "executive_demo",
        "scheduler_mode": "deterministic_demo",
        "presentation_mode": True,
        "recording_mode": False,
        "autoplay": False,
        "start_page": "command-center",
        "start_tab": "overview",
        "start_target": "scenario-story-panel",
        "notes_visibility": True,
        "annotations_visibility": True,
        "estimated_duration": "7 min",
        "tags": ["Executive", "Presentation Mode", "Branching Paths"],
        "recommended_for": ["executive", "investor", "board"],
        "what_it_proves": "Governed autonomy that produces measurable search visibility impact.",
        "branch_profile": "business_impact",
    },
    {
        "demo_pack_id": "pack_sales_differentiation",
        "name": "Sales Differentiation Demo",
        "description": "Competitor detection to governed counter-execution with clear differentiation.",
        "scenario_id": "competitor_counter_move",
        "walkthrough_id": "wt_sales_counter_move",
        "seed_key": "sales-pack-seed-01",
        "audience_mode": "sales_demo",
        "scheduler_mode": "deterministic_demo",
        "presentation_mode": True,
        "recording_mode": True,
        "autoplay": True,
        "start_page": "command-center",
        "start_tab": "competitors",
        "start_target": "competitor-card",
        "notes_visibility": True,
        "annotations_visibility": True,
        "estimated_duration": "8 min",
        "tags": ["Sales", "Recording Ready", "Branching Paths"],
        "recommended_for": ["prospect", "buyer", "partnership"],
        "what_it_proves": "Croutons is a governable operations system, not a generic AI assistant.",
        "branch_profile": "sales",
    },
    {
        "demo_pack_id": "pack_onboarding_foundations",
        "name": "Onboarding Foundations Demo",
        "description": "Teaches lifecycle, inspectability, approvals, execution, and outcomes.",
        "scenario_id": "search_spike_response",
        "walkthrough_id": "wt_onboarding_lifecycle",
        "seed_key": "onboarding-pack-seed-01",
        "audience_mode": "onboarding",
        "scheduler_mode": "manual_stepthrough",
        "presentation_mode": False,
        "recording_mode": False,
        "autoplay": False,
        "start_page": "command-center",
        "start_tab": "signals",
        "start_target": "signal-list",
        "notes_visibility": True,
        "annotations_visibility": True,
        "estimated_duration": "10 min",
        "tags": ["Onboarding", "Self Guided"],
        "recommended_for": ["new_operator", "internal_teammate"],
        "what_it_proves": "Operators can reliably move through the Search Ops lifecycle.",
        "branch_profile": "onboarding_simplified",
    },
    {
        "demo_pack_id": "pack_technical_validation",
        "name": "Technical Validation Demo",
        "description": "Runtime dependencies, failures, retries, and auditability for technical reviewers.",
        "scenario_id": "failed_distribution_recovery",
        "walkthrough_id": "wt_technical_runtime_audit",
        "seed_key": "tech-pack-seed-01",
        "audience_mode": "technical_qa",
        "scheduler_mode": "deterministic_demo",
        "presentation_mode": False,
        "recording_mode": True,
        "autoplay": False,
        "start_page": "command-center",
        "start_tab": "live-ops",
        "start_target": "live-runs-table",
        "notes_visibility": True,
        "annotations_visibility": True,
        "estimated_duration": "9 min",
        "tags": ["Technical", "Recording Ready", "Failure Recovery"],
        "recommended_for": ["engineering", "technical_buyer", "ops"],
        "what_it_proves": "Deterministic orchestration and audit trail maturity under failure conditions.",
        "branch_profile": "technical_depth",
    },
    {
        "demo_pack_id": "pack_fleet_governance",
        "name": "Fleet Governance Demo",
        "description": "Multi-agent workload, queue pressure, approvals, and throughput management.",
        "scenario_id": "multi_agent_workload",
        "walkthrough_id": "wt_fleet_queue_pressure",
        "seed_key": "fleet-pack-seed-01",
        "audience_mode": "executive_demo",
        "scheduler_mode": "deterministic_demo",
        "presentation_mode": True,
        "recording_mode": False,
        "autoplay": False,
        "start_page": "command-center",
        "start_tab": "live-ops",
        "start_target": "ops-throughput",
        "notes_visibility": True,
        "annotations_visibility": True,
        "estimated_duration": "8 min",
        "tags": ["Fleet", "Governance", "Scalability"],
        "recommended_for": ["enterprise_buyer", "operations_lead"],
        "what_it_proves": "Governed scale across multiple autonomous operators.",
        "branch_profile": "fleet_management",
    },
]

ALLOWED_TRANSITIONS = {
    "signal": {
        "new": {"reviewed", "converted", "dismissed", "snoozed", "merged"},
        "reviewed": {"converted", "dismissed", "snoozed", "merged"},
        "snoozed": {"reviewed", "dismissed"},
        "converted": {"reviewed"},
        "dismissed": {"reviewed"},
        "merged": {"reviewed"},
    },
    "opportunity": {
        "open": {"assigned", "planning", "in_review", "dismissed", "snoozed", "approved"},
        "assigned": {"planning", "in_review", "approved", "dismissed", "snoozed"},
        "planning": {"in_review", "approved", "dismissed"},
        "in_review": {"approved", "dismissed", "snoozed"},
        "approved": {"executed", "archived", "dismissed"},
        "executed": {"archived"},
        "snoozed": {"open", "assigned"},
        "dismissed": {"open"},
    },
    "citation_gap": {
        "open": {"planned", "assigned", "dismissed", "snoozed", "resolved"},
        "planned": {"assigned", "resolved", "dismissed"},
        "assigned": {"planned", "resolved", "dismissed"},
        "snoozed": {"open", "assigned"},
        "dismissed": {"open"},
    },
    "plan": {
        "draft": {"pending_approval", "queued", "cancelled"},
        "pending_approval": {"approved", "rejected", "cancelled"},
        "approved": {"queued", "running", "paused", "cancelled"},
        "queued": {"running", "cancelled"},
        "running": {"completed", "failed", "paused", "cancelled", "needs_review"},
        "paused": {"running", "cancelled"},
        "failed": {"queued", "running", "cancelled"},
        "rejected": {"draft"},
        "cancelled": {"draft"},
    },
    "execution": {
        "queued": {"running", "cancelled"},
        "running": {"paused", "completed", "failed", "cancelled", "needs_review"},
        "paused": {"running", "cancelled"},
        "failed": {"queued", "running", "cancelled"},
        "needs_review": {"running", "cancelled", "completed"},
    },
    "outcome": {
        "measuring": {"observed", "inconclusive"},
        "observed": {"validated", "inconclusive", "archived"},
        "validated": {"archived"},
        "inconclusive": {"observed", "archived"},
    },
}


def _runtime_state(user_id: str, scope: Optional[dict] = None) -> dict:
    state = SEARCH_OPS_RUNTIME.get(user_id)
    if not state:
        state = _build_search_ops_demo(scope=scope or {"mode": "site"})
        state.setdefault("artifacts", [])
        state.setdefault("approval_items", [])
        # Normalize initial statuses for transition discipline.
        for s in state.get("signals", []):
            s["status"] = s.get("status") or "new"
        for o in state.get("opportunities", []):
            if o.get("status") == "planned":
                o["status"] = "planning"
            elif o.get("status") not in {"open", "assigned", "planning", "in_review", "approved", "executed", "dismissed", "snoozed", "archived"}:
                o["status"] = "open"
        for g in state.get("citation_gaps", []):
            if g.get("status") not in {"open", "planned", "assigned", "dismissed", "snoozed", "resolved"}:
                g["status"] = "open"
        for p in state.get("plans", []):
            if p.get("status") == "ready":
                p["status"] = "pending_approval"
            elif p.get("status") not in {"draft", "pending_approval", "approved", "queued", "running", "paused", "completed", "failed", "rejected", "cancelled"}:
                p["status"] = "draft"
            if p.get("approval_state") == "needs_approval":
                p["approval_state"] = "pending_approval"
        for e in state.get("executions", []):
            if e.get("status") not in {"queued", "running", "paused", "completed", "failed", "cancelled", "needs_review"}:
                e["status"] = "queued"
            e.setdefault("execution_id", e.get("id"))
            e.setdefault("parent_plan_id", e.get("plan_id"))
            e.setdefault("priority", "normal")
            e.setdefault("queued_at", e.get("started_at"))
            e.setdefault("estimated_duration", 420)
            e.setdefault("duration", None)
            e.setdefault("concurrency_group", e.get("agent_id") or "default")
            e.setdefault("blocking_reason", None)
            e.setdefault("warnings", [])
            e.setdefault("errors", [])
            e.setdefault("review_flags", [])
            e.setdefault("dependent_execution_ids", [])
            e.setdefault("spawned_execution_ids", [])
            e.setdefault("artifact_ids", [])
            e.setdefault("outputs", [])
            e.setdefault("outcome_ids", e.get("linked_outcome_ids", []))
            if not isinstance(e.get("steps"), list) or not e.get("steps"):
                e["steps"] = [
                    {
                        "step_id": f"{e.get('id')}_step_01",
                        "sequence": 1,
                        "label": "Generate content update",
                        "step_type": "generate_article",
                        "status": "completed" if e.get("status") == "completed" else "queued",
                        "provider": "openai",
                        "target_type": "page",
                        "target_identifier": "content target",
                        "depends_on_step_ids": [],
                        "approval_required": False,
                        "review_required": False,
                        "retryable": True,
                        "attempts": 1 if e.get("status") == "completed" else 0,
                        "max_attempts": 3,
                        "estimated_output_type": "generated_article_draft",
                        "output_artifact_ids": [],
                        "started_at": e.get("started_at"),
                        "completed_at": e.get("completed_at"),
                        "result_summary": "Seeded from demo execution",
                        "error_summary": "",
                    },
                    {
                        "step_id": f"{e.get('id')}_step_02",
                        "sequence": 2,
                        "label": "Publish page update",
                        "step_type": "publish_page",
                        "status": "completed" if e.get("status") == "completed" else "waiting_dependency",
                        "provider": "github",
                        "target_type": "repo",
                        "target_identifier": "website repo",
                        "depends_on_step_ids": [f"{e.get('id')}_step_01"],
                        "approval_required": True,
                        "review_required": False,
                        "retryable": True,
                        "attempts": 1 if e.get("status") == "completed" else 0,
                        "max_attempts": 3,
                        "estimated_output_type": "page_patch",
                        "output_artifact_ids": [],
                        "started_at": e.get("started_at"),
                        "completed_at": e.get("completed_at"),
                        "result_summary": "",
                        "error_summary": "",
                    },
                ]
            e.setdefault("current_step_index", sum(1 for s in e.get("steps", []) if s.get("status") == "completed"))
            e.setdefault("total_steps", len(e.get("steps", [])))
            if e.get("status") == "completed" and not e.get("outputs"):
                for i, step in enumerate(e.get("steps", [])[:2]):
                    art = _create_artifact(state, e, step, f"seed {i+1}", f"Seed artifact from {step.get('label')}", "page_patch" if i == 0 else "schema_patch")
                    art["publish_status"] = "published"
                    art["review_status"] = "approved"
        for o in state.get("outcomes", []):
            o["status"] = o.get("status") or "observed"
            o.setdefault("outcome_stage", "observed")
        state.setdefault("demo_runtime", {
            "scheduler_mode": "deterministic_demo",
            "seed_key": "default-seed",
            "tick": 0,
            "autoplay": False,
            "presentation_mode": False,
            "recording_mode": False,
            "current_scenario_id": None,
            "scenario_stage_index": 0,
            "scenario_status": "idle",
            "scenario_run_id": None,
            "speaker_notes_visible": True,
            "annotations_visible": True,
            "audience_mode": "technical",
            "speed_multiplier": 1,
            "playback_log": [],
            "walkthrough_active": False,
            "walkthrough_id": None,
            "walkthrough_step_index": 0,
            "walkthrough_status": "idle",
            "walkthrough_mode": "self_guided",
            "walkthrough_completed_steps": [],
            "walkthrough_completion_state": {},
            "current_branch_id": None,
            "branch_stack": [],
            "visited_step_ids": [],
            "branch_history": [],
            "return_step_id": None,
            "branch_mode": "mainline",
            "walkthrough_path_signature": "mainline",
            "active_demo_pack_id": None,
        })
        SEARCH_OPS_RUNTIME[user_id] = state

    if scope:
        state["scope"] = scope
    return state


def _scenario_pack(scenario_id: str) -> Optional[dict]:
    return next((s for s in SCENARIO_PACKS if s.get("scenario_id") == scenario_id), None)


def _scenario_stage(state: dict) -> Optional[dict]:
    demo = state.get("demo_runtime") or {}
    sid = demo.get("current_scenario_id")
    pack = _scenario_pack(sid) if sid else None
    if not pack:
        return None
    idx = int(demo.get("scenario_stage_index") or 0)
    stages = pack.get("stages") or []
    if idx < 0 or idx >= len(stages):
        return None
    return stages[idx]


def _log_playback(state: dict, event: str, details: Optional[dict] = None):
    demo = state.setdefault("demo_runtime", {})
    log = demo.setdefault("playback_log", [])
    log.insert(0, {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "details": details or {},
        "tick": demo.get("tick", 0),
        "scenario_id": demo.get("current_scenario_id"),
        "stage_index": demo.get("scenario_stage_index", 0),
    })


def _set_execution_step_failure(execution: dict, step_type: str, category: str):
    for step in execution.get("steps", []):
        if step.get("step_type") == step_type and step.get("status") in {"queued", "waiting_dependency", "awaiting_approval", "running"}:
            step["inject_failure_category"] = category
            return True
    return False


def _apply_scenario_stage_effects(state: dict, user: dict):
    demo = state.get("demo_runtime") or {}
    sid = demo.get("current_scenario_id")
    stage = _scenario_stage(state)
    if not sid or not stage:
        return
    idx = int(demo.get("scenario_stage_index") or 0)
    plans = state.get("plans", [])
    executions = state.get("executions", [])
    outcomes = state.get("outcomes", [])

    if sid == "citation_gap_recovery":
        if idx == 1:
            sig = _find_by_id(state.get("signals", []), "sig_001", key="id")
            if sig:
                _apply_signal_action(state, sig, "create_opportunity", {}, user)
        elif idx == 2:
            opp = next((o for o in state.get("opportunities", []) if "sig_001" in (o.get("signal_ids") or [])), None)
            if opp and not (opp.get("linked_plan_ids") or []):
                _apply_opportunity_action(state, opp, "create_plan", {}, user)
        elif idx == 3:
            p = plans[0] if plans else None
            if p and p.get("status") in {"pending_approval", "approved"}:
                _apply_plan_action(state, p, "approve_and_run", {}, user)
        elif idx == 4:
            exe = executions[0] if executions else None
            if exe and exe.get("blocking_reason") == "approval_blocked":
                _apply_execution_action(state, exe, "approve_blocked", {"reason": "scenario progression"}, user)

    if sid == "search_spike_response":
        if idx == 1:
            sig = _find_by_id(state.get("signals", []), "sig_002", key="id")
            if sig:
                _apply_signal_action(state, sig, "convert_plan", {}, user)
        elif idx == 2:
            p = plans[0] if plans else None
            if p and p.get("status") in {"pending_approval", "approved"}:
                _apply_plan_action(state, p, "approve_and_run", {}, user)

    if sid == "schema_upgrade_retrieval":
        if idx == 1:
            gap = state.get("citation_gaps", [None])[0]
            if gap:
                _apply_gap_action(state, gap, "create_plan", {}, user)
        elif idx == 2:
            p = plans[0] if plans else None
            if p and p.get("status") in {"pending_approval", "approved"}:
                _apply_plan_action(state, p, "approve_and_run", {}, user)

    if sid == "competitor_counter_move":
        if idx == 1:
            comp = state.get("competitors", [None])[0]
            if comp:
                opp_id = _next_id("opp", state.get("opportunities", []), key="id")
                state.setdefault("opportunities", []).insert(0, {
                    "id": opp_id,
                    "signal_ids": [],
                    "type": "counter_competitor",
                    "title": f"Counter {comp.get('domain')}",
                    "description": "Counter-opportunity spawned from scenario competitor stage.",
                    "expected_impact": "Close competitor format/entity gap.",
                    "citation_probability": 0.66,
                    "urgency": 0.72,
                    "confidence": 0.78,
                    "recommended_format": "counter_content",
                    "recommended_target": "priority page",
                    "recommended_actions": ["create_counter_content_plan"],
                    "status": "open",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "rationale": "Scenario generated counter-opportunity.",
                    "source_evidence": [comp.get("domain")],
                    "linked_plan_ids": [],
                })
        elif idx == 2:
            opp = state.get("opportunities", [None])[0]
            if opp:
                _apply_opportunity_action(state, opp, "create_plan", {}, user)
        elif idx == 3:
            p = plans[0] if plans else None
            if p and p.get("status") in {"pending_approval", "approved"}:
                _apply_plan_action(state, p, "approve_and_run", {}, user)

    if sid == "failed_distribution_recovery":
        if idx == 1:
            p = plans[0] if plans else None
            if p and p.get("status") in {"pending_approval", "approved"}:
                _apply_plan_action(state, p, "approve_and_run", {}, user)
            exe = executions[0] if executions else None
            if exe:
                _set_execution_step_failure(exe, "execute", "social_publish_failed")
        elif idx == 2:
            exe = executions[0] if executions else None
            if exe and exe.get("status") == "failed":
                _apply_execution_action(state, exe, "retry_step", {}, user)

    if sid == "multi_agent_workload":
        for idx_a, agent in enumerate(state.get("agents", [])):
            if idx_a == 0:
                agent.setdefault("workload_summary", {})["workload_indicator"] = "overloaded"
            elif idx_a == 1:
                agent.setdefault("workload_summary", {})["workload_indicator"] = "normal_load"
            else:
                agent.setdefault("workload_summary", {})["workload_indicator"] = "underutilized"

    if sid and outcomes:
        for out in outcomes[:2]:
            if idx <= 1:
                out["status"] = "measuring"
                out["outcome_stage"] = "measuring"
            elif idx == 2:
                out["status"] = "observed"
                out["outcome_stage"] = "early_signal"
            elif idx == 3:
                out["status"] = "observed"
                out["outcome_stage"] = "observed"
            else:
                out["status"] = "validated"
                out["outcome_stage"] = "validated"


def _configure_scenario(state: dict, scenario_id: str, seed_key: Optional[str], mode: str = "deterministic_demo"):
    pack = _scenario_pack(scenario_id)
    if not pack:
        raise HTTPException(status_code=404, detail="Scenario not found")
    demo = state.setdefault("demo_runtime", {})
    demo["current_scenario_id"] = scenario_id
    demo["seed_key"] = seed_key or pack.get("seed_key") or "default-seed"
    demo["scheduler_mode"] = mode
    demo["scenario_stage_index"] = 0
    demo["scenario_status"] = "running"
    demo["scenario_run_id"] = f"scenario_run_{scenario_id}_{int(time.time())}"
    demo["tick"] = 0
    demo["autoplay"] = False
    demo["playback_log"] = []
    _log_playback(state, "scenario_loaded", {"scenario_id": scenario_id, "seed_key": demo["seed_key"], "mode": mode})


def _scenario_status_payload(state: dict) -> dict:
    demo = state.get("demo_runtime") or {}
    sid = demo.get("current_scenario_id")
    pack = _scenario_pack(sid) if sid else None
    stage = _scenario_stage(state)
    return {
        "mode": demo.get("scheduler_mode"),
        "autoplay": demo.get("autoplay", False),
        "presentation_mode": demo.get("presentation_mode", False),
        "scenario": pack,
        "current_stage": stage,
        "current_stage_index": demo.get("scenario_stage_index", 0),
        "scenario_status": demo.get("scenario_status", "idle"),
        "seed_key": demo.get("seed_key"),
        "scenario_run_id": demo.get("scenario_run_id"),
        "speaker_notes_visible": demo.get("speaker_notes_visible", True),
        "annotations_visible": demo.get("annotations_visible", True),
        "audience_mode": demo.get("audience_mode", "technical"),
        "speed_multiplier": demo.get("speed_multiplier", 1),
        "playback_log": (demo.get("playback_log") or [])[:30],
        "walkthrough": _walkthrough_status_payload(state),
    }


def _seeded_metric(state: dict, key: str, minimum: int, maximum: int) -> int:
    demo = state.get("demo_runtime") or {}
    seed = f"{demo.get('seed_key','default')}::{key}"
    digest = hashlib.md5(seed.encode("utf-8")).hexdigest()[:8]
    n = int(digest, 16)
    if maximum <= minimum:
        return minimum
    return minimum + (n % (maximum - minimum + 1))


def _walkthrough_catalog(state: dict) -> list[dict]:
    custom = state.get("custom_walkthroughs", [])
    return WALKTHROUGH_LIBRARY + (custom if isinstance(custom, list) else [])


def _walkthrough_pack(state: dict, walkthrough_id: str) -> Optional[dict]:
    return next((w for w in _walkthrough_catalog(state) if w.get("walkthrough_id") == walkthrough_id), None)


def _walkthrough_step(state: dict) -> Optional[dict]:
    demo = state.get("demo_runtime") or {}
    wid = demo.get("walkthrough_id")
    pack = _walkthrough_pack(state, wid) if wid else None
    if not pack:
        return None
    idx = int(demo.get("walkthrough_step_index") or 0)
    steps = pack.get("steps") or []
    if idx < 0 or idx >= len(steps):
        return None
    return steps[idx]


def _validate_walkthrough_step(state: dict, step: dict) -> tuple[bool, str]:
    if not step:
        return False, "No active step"
    cond = step.get("completion_condition") or {}
    ctype = cond.get("type")
    demo = state.get("demo_runtime") or {}
    if ctype == "scenario_stage_at_least":
        current = int(demo.get("scenario_stage_index") or 0)
        target = int(cond.get("value") or cond.get("stage") or 0)
        return current >= target, f"Current stage {current}, expected >= {target}"
    if ctype == "approval_pending":
        return len(state.get("approval_queue", [])) > 0, "Approval queue should have pending items"
    if ctype == "outcome_stage":
        target = str(cond.get("value") or "")
        ok = any(str(o.get("outcome_stage") or o.get("status")) == target for o in state.get("outcomes", []))
        return ok, f"Expected at least one outcome in {target}"
    if ctype == "execution_recovered":
        ok = any(e.get("status") in {"running", "completed"} and not e.get("errors") for e in state.get("executions", []))
        return ok, "Expected recovered execution state"
    return True, "UI-driven step (validated client-side)"


def _walkthrough_status_payload(state: dict) -> dict:
    demo = state.get("demo_runtime") or {}
    wid = demo.get("walkthrough_id")
    pack = _walkthrough_pack(state, wid) if wid else None
    step = _walkthrough_step(state)
    return {
        "walkthrough_active": bool(demo.get("walkthrough_active")),
        "walkthrough_status": demo.get("walkthrough_status", "idle"),
        "walkthrough_id": wid,
        "walkthrough": pack,
        "current_step": step,
        "current_step_index": int(demo.get("walkthrough_step_index") or 0),
        "completed_steps": demo.get("walkthrough_completed_steps", []),
        "completion_state": demo.get("walkthrough_completion_state", {}),
        "mode": demo.get("walkthrough_mode", "self_guided"),
        "recording_mode": bool(demo.get("recording_mode")),
        "current_branch_id": demo.get("current_branch_id"),
        "branch_stack": demo.get("branch_stack", []),
        "visited_step_ids": demo.get("visited_step_ids", []),
        "branch_history": demo.get("branch_history", []),
        "return_step_id": demo.get("return_step_id"),
        "branch_mode": demo.get("branch_mode", "mainline"),
        "walkthrough_path_signature": demo.get("walkthrough_path_signature", "mainline"),
        "active_demo_pack_id": demo.get("active_demo_pack_id"),
    }


def _demo_pack(pack_id: str) -> Optional[dict]:
    return next((p for p in DEMO_PACKS if p.get("demo_pack_id") == pack_id), None)


def _auto_branch_for_recording(state: dict, step: dict) -> Optional[dict]:
    if not step:
        return None
    branches = step.get("optional_branching") or []
    if not branches:
        return None
    demo = state.get("demo_runtime") or {}
    pack = _demo_pack(demo.get("active_demo_pack_id")) if demo.get("active_demo_pack_id") else None
    profile = (pack or {}).get("branch_profile") or demo.get("audience_mode") or ""
    def score(b: dict) -> int:
        s = 0
        btype = str(b.get("branch_type") or "")
        fit = str(b.get("audience_fit") or "")
        if profile and profile in btype:
            s += 3
        if profile and profile in fit:
            s += 3
        if demo.get("audience_mode") and str(demo.get("audience_mode")) in fit:
            s += 2
        if btype in {"business_impact", "technical_depth", "onboarding_simplified", "runtime_failure_recovery", "governance_approval", "artifact_review", "fleet_management"}:
            s += 1
        return s
    ranked = sorted(branches, key=score, reverse=True)
    return ranked[0] if ranked else None


def _next_id(prefix: str, items: list[dict], key: str = "id") -> str:
    n = 1
    seen = {str(i.get(key, "")) for i in items}
    while f"{prefix}_{n:03d}" in seen:
        n += 1
    return f"{prefix}_{n:03d}"


def _find_by_id(items: list[dict], item_id: str, key: str = "id") -> Optional[dict]:
    for x in items:
        if str(x.get(key)) == str(item_id):
            return x
    return None


def _transition_or_raise(kind: str, obj: dict, to_state: str):
    current = (obj.get("status") or "").strip()
    if current == to_state:
        return
    allowed = ALLOWED_TRANSITIONS.get(kind, {}).get(current, set())
    if to_state not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid transition for {kind}: {current} -> {to_state}")
    obj["status"] = to_state


def _append_audit(state: dict, user: dict, event_type: str, object_type: str, object_id: str, old_state: Optional[str], new_state: Optional[str], linked: Optional[dict] = None, notes: str = "", snapshot: Optional[dict] = None):
    state.setdefault("audit_trail", [])
    state["audit_trail"].insert(0, {
        "id": f"audit_{int(time.time()*1000)}",
        "actor": user.get("email") or user.get("id"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "object_type": object_type,
        "object_id": object_id,
        "action_type": event_type,
        "old_state": old_state,
        "new_state": new_state,
        "linked_ids": linked or {},
        "notes": notes,
        "automation_snapshot": snapshot or {},
    })


def _recompute_queues(state: dict):
    plans = state.get("plans", [])
    executions = state.get("executions", [])
    signals = state.get("signals", [])
    opportunities = state.get("opportunities", [])
    outcomes = state.get("outcomes", [])
    approval_items = state.setdefault("approval_items", [])
    plan_approvals = [
        {
            "approval_id": f"appr_plan_{p.get('id')}",
            "object_type": "plan",
            "object_id": p.get("id"),
            "approval_type": "publish_approval",
            "target_resource": p.get("name"),
            "agent_id": p.get("agent_id"),
            "status": "pending",
            "requested_at": p.get("created_at"),
            "decided_at": None,
            "decided_by": None,
            "reason": "Plan requires approval before execution",
            "risk_context": "guardrail_publish_distribution",
            "originating_plan_id": p.get("id"),
            "originating_opportunity_id": p.get("opportunity_id"),
        }
        for p in plans if p.get("status") in {"pending_approval", "needs_review"} or p.get("approval_state") in {"pending_approval", "needs_approval"}
    ]
    indexed_pending = {(a.get("object_type"), a.get("object_id"), a.get("approval_type")) for a in approval_items if a.get("status") == "pending"}
    for item in plan_approvals:
        key = (item.get("object_type"), item.get("object_id"), item.get("approval_type"))
        if key not in indexed_pending:
            approval_items.insert(0, item)
    state["approval_queue"] = [
        {
            "approval_id": a.get("approval_id"),
            "object_type": a.get("object_type"),
            "object_id": a.get("object_id"),
            "parent_execution_id": a.get("parent_execution_id"),
            "title": a.get("target_resource") or a.get("object_id"),
            "triggering_reason": a.get("reason"),
            "agent_id": a.get("agent_id"),
            "approval_requirement_type": a.get("approval_type"),
            "urgency": "high" if "money_page" in str(a.get("approval_type")) or "homepage" in str(a.get("approval_type")) else "medium",
            "expected_impact": "runtime continuity",
            "target_resource": a.get("target_resource"),
            "risk_context": a.get("risk_context"),
        }
        for a in approval_items if a.get("status") == "pending"
    ]
    state["queue_counts"] = {
        "new_signals": sum(1 for s in signals if s.get("status") == "new"),
        "open_opportunities": sum(1 for o in opportunities if o.get("status") in {"open", "assigned", "planning"}),
        "needs_approval": len(state["approval_queue"]),
        "ready_to_run": sum(1 for p in plans if p.get("status") in {"approved", "queued"}),
        "running": sum(1 for e in executions if e.get("status") == "running"),
        "blocked": sum(1 for e in executions if e.get("blocking_reason")),
        "measuring_outcomes": sum(1 for o in outcomes if o.get("status") in {"measuring", "observed"}),
        "dismissed_or_snoozed": sum(1 for s in signals if s.get("status") in {"dismissed", "snoozed"}) + sum(1 for o in opportunities if o.get("status") in {"dismissed", "snoozed"}),
        "failed_or_review": sum(1 for e in executions if e.get("status") in {"failed", "needs_review"}),
        "draft_plans": sum(1 for p in plans if p.get("status") == "draft"),
        "completed_recently": sum(1 for e in executions if e.get("status") == "completed"),
        "failed": sum(1 for e in executions if e.get("status") == "failed"),
    }
    state["queue_segments"] = {
        "new_signals": [s.get("id") for s in signals if s.get("status") == "new"][:25],
        "open_opportunities": [o.get("id") for o in opportunities if o.get("status") in {"open", "assigned", "planning"}][:25],
        "draft_plans": [p.get("id") for p in plans if p.get("status") == "draft"][:25],
        "awaiting_approval": [i.get("object_id") for i in state.get("approval_queue", [])][:25],
        "ready_to_run": [p.get("id") for p in plans if p.get("status") in {"approved", "queued"}][:25],
        "running": [e.get("id") for e in executions if e.get("status") == "running"][:25],
        "blocked": [e.get("id") for e in executions if e.get("blocking_reason")][:25],
        "needs_review": [e.get("id") for e in executions if e.get("status") == "needs_review"][:25],
        "completed_recently": [e.get("id") for e in executions if e.get("status") == "completed"][:25],
        "failed": [e.get("id") for e in executions if e.get("status") == "failed"][:25],
    }
    avg_completion = 0.0
    durations = []
    for e in executions:
        if e.get("started_at") and e.get("completed_at"):
            try:
                st = datetime.fromisoformat(str(e["started_at"]).replace("Z", "+00:00"))
                ct = datetime.fromisoformat(str(e["completed_at"]).replace("Z", "+00:00"))
                durations.append(max(0.0, (ct - st).total_seconds()))
            except Exception:
                pass
    if durations:
        avg_completion = sum(durations) / len(durations)
    state["live_ops"] = {
        "running_executions": [e for e in executions if e.get("status") == "running"][:12],
        "blocked_executions": [e for e in executions if e.get("blocking_reason")] [:12],
        "awaiting_approval": state.get("approval_queue", [])[:20],
        "failed_needs_review": [e for e in executions if e.get("status") in {"failed", "needs_review"}][:20],
        "recently_completed": [e for e in executions if e.get("status") == "completed"][:20],
        "agents_currently_active": len({e.get("agent_id") for e in executions if e.get("status") in {"queued", "running"}} - {None, ""}),
        "queue_backlog": sum(1 for e in executions if e.get("status") in {"queued", "running"}) + len(state.get("approval_queue", [])),
        "avg_completion_seconds": round(avg_completion, 2),
        "daily_execution_load": len(executions),
        "token_burn": sum(int(e.get("tokens") or 0) for e in executions),
        "cost_burn": round(sum(float(e.get("cost") or 0) for e in executions), 6),
    }
    agent_index: dict[str, dict] = {}
    for p in plans:
        aid = p.get("agent_id")
        if not aid:
            continue
        rec = agent_index.setdefault(aid, {"id": aid, "name": p.get("agent_name") or aid, "status": "active", "assignments": {"plans": 0, "signals": 0, "opportunities": 0, "gaps": 0}, "runs": {"running": 0, "blocked": 0, "failed": 0, "completed": 0}, "throughput_summary": {}, "workload_summary": {}, "concurrency_limits": {"max_concurrent_executions": 3}, "queue_limits": {"max_queued_work": 12, "max_daily_publish_actions": 8, "max_daily_distribution_actions": 10}})
        rec["assignments"]["plans"] += 1
    for s in signals:
        aid = s.get("assigned_agent_id")
        if not aid:
            continue
        rec = agent_index.setdefault(aid, {"id": aid, "name": s.get("assigned_agent_name") or aid, "status": "active", "assignments": {"plans": 0, "signals": 0, "opportunities": 0, "gaps": 0}, "runs": {"running": 0, "blocked": 0, "failed": 0, "completed": 0}, "throughput_summary": {}, "workload_summary": {}, "concurrency_limits": {"max_concurrent_executions": 3}, "queue_limits": {"max_queued_work": 12, "max_daily_publish_actions": 8, "max_daily_distribution_actions": 10}})
        rec["assignments"]["signals"] += 1
    for o in opportunities:
        aid = o.get("assigned_agent_id")
        if not aid:
            continue
        rec = agent_index.setdefault(aid, {"id": aid, "name": o.get("assigned_agent_name") or aid, "status": "active", "assignments": {"plans": 0, "signals": 0, "opportunities": 0, "gaps": 0}, "runs": {"running": 0, "blocked": 0, "failed": 0, "completed": 0}, "throughput_summary": {}, "workload_summary": {}, "concurrency_limits": {"max_concurrent_executions": 3}, "queue_limits": {"max_queued_work": 12, "max_daily_publish_actions": 8, "max_daily_distribution_actions": 10}})
        rec["assignments"]["opportunities"] += 1
    for g in state.get("citation_gaps", []):
        aid = g.get("assigned_agent_id")
        if not aid:
            continue
        rec = agent_index.setdefault(aid, {"id": aid, "name": g.get("assigned_agent_name") or aid, "status": "active", "assignments": {"plans": 0, "signals": 0, "opportunities": 0, "gaps": 0}, "runs": {"running": 0, "blocked": 0, "failed": 0, "completed": 0}, "throughput_summary": {}, "workload_summary": {}, "concurrency_limits": {"max_concurrent_executions": 3}, "queue_limits": {"max_queued_work": 12, "max_daily_publish_actions": 8, "max_daily_distribution_actions": 10}})
        rec["assignments"]["gaps"] += 1
    for e in executions:
        aid = e.get("agent_id")
        if not aid:
            continue
        rec = agent_index.setdefault(aid, {"id": aid, "name": e.get("agent_name") or aid, "status": "active", "assignments": {"plans": 0, "signals": 0, "opportunities": 0, "gaps": 0}, "runs": {"running": 0, "blocked": 0, "failed": 0, "completed": 0}, "throughput_summary": {}, "workload_summary": {}, "concurrency_limits": {"max_concurrent_executions": 3}, "queue_limits": {"max_queued_work": 12, "max_daily_publish_actions": 8, "max_daily_distribution_actions": 10}})
        status = e.get("status")
        if status == "running":
            rec["runs"]["running"] += 1
        if e.get("blocking_reason"):
            rec["runs"]["blocked"] += 1
        if status in {"failed", "needs_review"}:
            rec["runs"]["failed"] += 1
        if status == "completed":
            rec["runs"]["completed"] += 1
    for aid, rec in agent_index.items():
        total_load = rec["assignments"]["plans"] + rec["assignments"]["signals"] + rec["assignments"]["opportunities"] + rec["assignments"]["gaps"] + rec["runs"]["running"] + rec["runs"]["blocked"]
        load_label = "underutilized" if total_load <= 2 else ("normal_load" if total_load <= 6 else ("high_load" if total_load <= 10 else "overloaded"))
        completed_runs = max(1, rec["runs"]["completed"] + rec["runs"]["failed"])
        rec["throughput_summary"] = {
            "throughput_24h": rec["runs"]["completed"] + rec["runs"]["running"],
            "throughput_7d": rec["runs"]["completed"] * 3 + rec["runs"]["running"],
            "success_rate": round((rec["runs"]["completed"] / completed_runs) * 100, 2),
            "approval_dependency_rate": round((rec["runs"]["blocked"] / max(1, rec["runs"]["running"] + rec["runs"]["blocked"])) * 100, 2),
            "avg_time_to_execution_seconds": 32 + (rec["runs"]["blocked"] * 14),
            "avg_time_to_completion_seconds": 260 + (rec["runs"]["failed"] * 50),
            "token_usage": sum(int(e.get("tokens") or 0) for e in executions if e.get("agent_id") == aid),
            "cost_usage": round(sum(float(e.get("cost") or 0) for e in executions if e.get("agent_id") == aid), 6),
        }
        rec["workload_summary"] = {
            "active_assignments": rec["assignments"],
            "queued_plans": sum(1 for p in plans if p.get("agent_id") == aid and p.get("status") in {"draft", "pending_approval", "approved", "queued"}),
            "running_executions": rec["runs"]["running"],
            "blocked_executions": rec["runs"]["blocked"],
            "failed_executions": rec["runs"]["failed"],
            "workload_indicator": load_label,
        }
    state["agents"] = list(agent_index.values())


class SearchOpsActionRequest(BaseModel):
    action: str
    payload: Optional[dict] = None


class SearchOpsBatchActionRequest(BaseModel):
    action: str
    object_ids: list[str]
    payload: Optional[dict] = None


class DemoScenarioLoadRequest(BaseModel):
    scenario_id: str
    seed_key: Optional[str] = None
    mode: Optional[str] = "deterministic_demo"


class DemoAutoplayRequest(BaseModel):
    enabled: bool = True
    speed_multiplier: Optional[int] = 1


class DemoSettingsRequest(BaseModel):
    presentation_mode: Optional[bool] = None
    speaker_notes_visible: Optional[bool] = None
    annotations_visible: Optional[bool] = None
    audience_mode: Optional[str] = None
    scheduler_mode: Optional[str] = None
    recording_mode: Optional[bool] = None


class WalkthroughLoadRequest(BaseModel):
    walkthrough_id: str
    mode: Optional[str] = None
    audience_type: Optional[str] = None
    auto_start: Optional[bool] = True


class WalkthroughImportRequest(BaseModel):
    walkthrough: dict


class DemoPackLoadRequest(BaseModel):
    demo_pack_id: str
    seed_key: Optional[str] = None
    autoplay: Optional[bool] = None


class WalkthroughBranchRequest(BaseModel):
    branch_id: str


@app.get("/api/search-ops/intelligence")
async def get_search_ops_intelligence(
    scope_mode: str = "site",
    agent_id: Optional[str] = None,
    github_repo: Optional[str] = None,
    gsc_site: Optional[str] = None,
    bing_site: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    user_id = user["id"]
    scope = await _resolve_command_center_scope(
        user_id=user_id,
        scope_mode=scope_mode,
        agent_id=agent_id,
        github_repo=github_repo,
        gsc_site=gsc_site,
        bing_site=bing_site,
    )
    state = _runtime_state(user_id=user_id, scope=scope)
    _simulate_runtime_progress(state, user)
    _recompute_queues(state)
    state["demo_status"] = _scenario_status_payload(state)
    state["scenario_story"] = {
        "current_stage": _scenario_stage(state),
        "suggested_next_click_path": ((_scenario_pack((state.get("demo_runtime") or {}).get("current_scenario_id")) or {}).get("recommended_walkthrough_order") or []),
        "recent_outputs": state.get("artifacts", [])[:8],
    }
    return state


def _create_plan_from_opportunity(state: dict, opportunity: dict, actor_user: dict, assigned_agent_id: Optional[str] = None) -> dict:
    plan_id = _next_id("plan", state.get("plans", []), key="id")
    agent_id = assigned_agent_id or opportunity.get("assigned_agent_id") or "demo_operator_01"
    plan = {
        "id": plan_id,
        "opportunity_id": opportunity.get("id"),
        "agent_id": agent_id,
        "agent_name": opportunity.get("assigned_agent_name") or "Assigned Operator",
        "name": f"Plan for {opportunity.get('title','opportunity')}",
        "description": opportunity.get("description", ""),
        "steps": [
            {"step_type": "analyze", "provider": "openai", "target": opportunity.get("recommended_target") or "topic cluster", "approval_required": False, "estimated_output": "plan rationale"},
            {"step_type": "execute", "provider": "github", "target": opportunity.get("recommended_target") or "website", "approval_required": True, "estimated_output": "content/schema update"},
            {"step_type": "measure", "provider": "gsc+bwt", "target": "7d window", "approval_required": False, "estimated_output": "delta metrics"},
        ],
        "trigger_signal_ids": opportunity.get("signal_ids", []),
        "linked_gap_ids": opportunity.get("linked_gap_ids", []),
        "why_this_plan_exists": opportunity.get("rationale") or opportunity.get("description") or "",
        "estimated_impact": "High" if (opportunity.get("urgency") or 0) >= 0.8 else "Medium",
        "estimated_cost": 0.0935,
        "estimated_tokens": 21000,
        "expected_outputs": ["updated page", "schema patch", "measurement report"],
        "approval_state": "pending_approval",
        "status": "pending_approval",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    state.setdefault("plans", []).insert(0, plan)
    opportunity.setdefault("linked_plan_ids", [])
    if plan_id not in opportunity["linked_plan_ids"]:
        opportunity["linked_plan_ids"].append(plan_id)
    return plan


def _create_execution_from_plan(state: dict, plan: dict, user: dict) -> dict:
    exe_id = _next_id("exe", state.get("executions", []), key="id")
    now = datetime.now(timezone.utc).isoformat()
    steps = []
    raw_steps = plan.get("steps", [])
    prev_id = None
    for idx, s in enumerate(raw_steps):
        step_type = s.get("step_type") if isinstance(s, dict) else "step"
        label = s.get("target") if isinstance(s, dict) else str(s)
        provider = s.get("provider") if isinstance(s, dict) else "system"
        needs_approval = bool((s or {}).get("approval_required")) if isinstance(s, dict) else False
        step_id = f"{exe_id}_step_{idx+1:02d}"
        steps.append({
            "step_id": step_id,
            "sequence": idx + 1,
            "label": f"{step_type}: {label}",
            "step_type": step_type,
            "status": "queued" if idx == 0 else "waiting_dependency",
            "provider": provider,
            "target_type": "resource",
            "target_identifier": label,
            "depends_on_step_ids": [prev_id] if prev_id else [],
            "approval_required": needs_approval,
            "review_required": False,
            "retryable": True,
            "attempts": 0,
            "max_attempts": 3,
            "estimated_output_type": (s.get("estimated_output") if isinstance(s, dict) else "artifact"),
            "output_artifact_ids": [],
            "started_at": None,
            "completed_at": None,
            "result_summary": "",
            "error_summary": "",
        })
        prev_id = step_id

    execution = {
        "id": exe_id,
        "execution_id": exe_id,
        "plan_id": plan.get("id"),
        "parent_plan_id": plan.get("id"),
        "agent_id": plan.get("agent_id"),
        "agent_name": plan.get("agent_name"),
        "status": "queued",
        "priority": "high" if (plan.get("estimated_impact") or "").lower() == "high" else "normal",
        "started_at": now,
        "completed_at": None,
        "queued_at": now,
        "estimated_duration": 420,
        "duration": None,
        "scope_mode": (state.get("scope") or {}).get("mode", "site"),
        "concurrency_group": plan.get("agent_id") or "default",
        "lifecycle_stage_at_start": "Execute",
        "blocking_reason": None,
        "current_step_index": 0,
        "total_steps": len(steps),
        "approval_snapshot": {
            "automation_mode": "approval_publish_distribution",
            "approved_by": user.get("email") or user.get("id"),
            "guardrails": {"publish_requires_approval": True, "distribution_requires_approval": True},
        },
        "step_logs": [
            {"timestamp": now, "action_type": "queued", "provider": "system", "target": plan.get("id"), "status": "queued", "result": "execution created"},
        ],
        "steps": steps,
        "warnings": [],
        "errors": [],
        "review_flags": [],
        "output_assets": [],
        "outputs": [],
        "artifact_ids": [],
        "affected_urls": [],
        "distribution_targets": [],
        "cost": 0.0,
        "tokens": 0,
        "linked_outcome_ids": [],
        "outcome_ids": [],
        "dependent_execution_ids": [],
        "dependent_executions": [],
        "spawned_execution_ids": [],
        "spawned_executions": [],
        "triggering_signal_ids": plan.get("trigger_signal_ids", []),
        "linked_opportunity_id": plan.get("opportunity_id"),
    }
    state.setdefault("executions", []).insert(0, execution)
    return execution


def _create_artifact(state: dict, execution: dict, step: dict, suffix: str, content: str, artifact_type: str) -> dict:
    artifacts = state.setdefault("artifacts", [])
    artifact_id = _next_id("art", artifacts, key="artifact_id")
    art = {
        "artifact_id": artifact_id,
        "type": artifact_type,
        "title": f"{artifact_type.replace('_', ' ')} {suffix}",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "linked_execution_id": execution.get("id"),
        "linked_step_id": step.get("step_id"),
        "preview_text": content[:280],
        "preview_json": {"summary": content[:80], "step": step.get("label")},
        "target_url": None,
        "target_resource": step.get("target_identifier"),
        "provider": step.get("provider"),
        "publish_status": "draft",
        "review_status": "pending" if step.get("approval_required") else "ready",
    }
    artifacts.insert(0, art)
    execution.setdefault("artifact_ids", []).append(artifact_id)
    execution.setdefault("outputs", []).append(art)
    step.setdefault("output_artifact_ids", []).append(artifact_id)
    return art


def _advance_execution_runtime(state: dict, execution: dict, user: dict):
    if execution.get("status") not in {"queued", "running"}:
        return
    now = datetime.now(timezone.utc).isoformat()
    steps = execution.get("steps", [])
    if not steps:
        return

    # Move queued -> running on first tick.
    if execution.get("status") == "queued":
        execution["status"] = "running"
        execution.setdefault("step_logs", []).append({
            "timestamp": now,
            "action_type": "runtime_start",
            "provider": "system",
            "target": execution.get("plan_id"),
            "status": "running",
            "result": "execution started",
        })

    # Locate next actionable step.
    current = None
    for s in steps:
        if s.get("status") in {"queued", "waiting_dependency", "awaiting_approval", "running", "failed"}:
            current = s
            break
    if not current:
        return

    # Dependency gating
    deps = current.get("depends_on_step_ids", [])
    if deps:
        dep_objs = [next((x for x in steps if x.get("step_id") == d), None) for d in deps]
        if any((d and d.get("status") != "completed") for d in dep_objs):
            current["status"] = "waiting_dependency"
            execution["blocking_reason"] = "dependency_blocked"
            execution.setdefault("review_flags", [])
            if "blocked_by_dependency" not in execution["review_flags"]:
                execution["review_flags"].append("blocked_by_dependency")
            return

    # Approval gating
    if current.get("approval_required") and current.get("status") in {"queued", "waiting_dependency", "awaiting_approval"}:
        current["status"] = "awaiting_approval"
        execution["blocking_reason"] = "approval_blocked"
        state.setdefault("approval_items", [])
        approval_id = _next_id("appr", state["approval_items"], key="approval_id")
        existing = next((a for a in state["approval_items"] if a.get("object_type") == "execution_step" and a.get("object_id") == current.get("step_id") and a.get("status") == "pending"), None)
        if not existing:
            approval_type = "distribution_approval" if "social" in str(current.get("step_type")) else "publish_approval"
            state["approval_items"].insert(0, {
                "approval_id": approval_id,
                "object_type": "execution_step",
                "object_id": current.get("step_id"),
                "parent_execution_id": execution.get("id"),
                "approval_type": approval_type,
                "target_resource": current.get("target_identifier"),
                "agent_id": execution.get("agent_id"),
                "status": "pending",
                "requested_at": now,
                "decided_at": None,
                "decided_by": None,
                "reason": "step marked approval_required",
                "risk_context": "guardrail_requires_human_confirmation",
                "originating_plan_id": execution.get("plan_id"),
                "originating_opportunity_id": execution.get("linked_opportunity_id"),
            })
        return

    execution["blocking_reason"] = None

    # Execute one step per tick.
    if current.get("status") in {"queued", "waiting_dependency", "running"}:
        current["status"] = "running"
        current["started_at"] = current.get("started_at") or now
        current["attempts"] = int(current.get("attempts") or 0) + 1

        injected_failure = current.get("inject_failure_category")
        if injected_failure:
            current["status"] = "failed"
            category = str(injected_failure)
            current["error_summary"] = f"{category}: step failed on attempt {current.get('attempts')}"
            current["inject_failure_category"] = None
            execution["status"] = "failed"
            execution.setdefault("errors", []).append({"step_id": current.get("step_id"), "category": category, "summary": current.get("error_summary"), "timestamp": now})
            execution.setdefault("step_logs", []).append({
                "timestamp": now,
                "action_type": current.get("step_type"),
                "provider": current.get("provider"),
                "target": current.get("target_identifier"),
                "status": "failed",
                "result": current.get("error_summary"),
            })
            _append_audit(state, user, "execution_step_failed", "execution", execution.get("id"), "running", "failed", {"step_id": current.get("step_id")}, current.get("error_summary"))
            return

        current["status"] = "completed"
        current["completed_at"] = now
        current["result_summary"] = "step completed successfully"
        artifact_type = {
            "analyze": "citation_diff_report",
            "execute": "page_patch",
            "measure": "indexing_request_record",
            "generate_article": "generated_article_draft",
            "publish_page": "page_patch",
            "generate_social_thread": "social_thread",
        }.get(str(current.get("step_type")), "refreshed_croutons_payload")
        art = _create_artifact(state, execution, current, f"for {execution.get('id')}", f"{current.get('label')} completed", artifact_type)
        execution.setdefault("output_assets", []).append(art.get("artifact_id"))
        execution.setdefault("step_logs", []).append({
            "timestamp": now,
            "action_type": current.get("step_type"),
            "provider": current.get("provider"),
            "target": current.get("target_identifier"),
            "status": "completed",
            "result": current.get("result_summary"),
        })
        token_delta = _seeded_metric(state, f"{execution.get('id')}::{current.get('step_id')}::tokens", 800, 2600)
        cost_delta = _seeded_metric(state, f"{execution.get('id')}::{current.get('step_id')}::cost_micros", 4000, 28000) / 1_000_000.0
        execution["tokens"] = int(execution.get("tokens") or 0) + token_delta
        execution["cost"] = round(float(execution.get("cost") or 0.0) + cost_delta, 6)
        execution["current_step_index"] = int(current.get("sequence") or 0)

    completed = sum(1 for s in steps if s.get("status") == "completed")
    total = max(1, len(steps))
    if completed == total and execution.get("status") in {"running", "queued"}:
        old_status = execution.get("status")
        execution["status"] = "completed_with_warnings" if execution.get("warnings") else "completed"
        execution["completed_at"] = now
        try:
            _transition_or_raise("execution", execution, "completed")
        except HTTPException:
            execution["status"] = "completed"
        out_id = _next_id("out", state.get("outcomes", []), key="id")
        outcome = {
            "id": out_id,
            "type": "visibility_lift",
            "execution_id": execution.get("id"),
            "measured_at": now,
            "confidence": 0.74,
            "time_window": "7d",
            "baseline_metrics": {"impressions_7d": 2100, "avg_position": 11, "citations_7d": 1},
            "current_metrics": {"impressions_7d": 2480, "avg_position": 8, "citations_7d": 2},
            "delta_metrics": {"impressions_pct": 18.1, "avg_position_change": 3, "citations_delta": 1},
            "status": "measuring",
            "evidence_sources": ["gsc", "citation-monitor", "crawler"],
            "narrative_summary": "Execution completed and measurement has started for downstream visibility impact.",
        }
        state.setdefault("outcomes", []).insert(0, outcome)
        execution.setdefault("linked_outcome_ids", []).append(out_id)
        execution.setdefault("outcome_ids", []).append(out_id)
        _append_audit(state, user, "execution_completed", "execution", execution.get("id"), old_status, "completed", {"outcome_id": out_id}, "")


def _simulate_runtime_progress(state: dict, user: dict, force: bool = False, ticks: int = 1):
    demo = state.setdefault("demo_runtime", {})
    mode = demo.get("scheduler_mode") or "deterministic_demo"
    autoplay = bool(demo.get("autoplay"))
    if not force:
        if mode == "manual_stepthrough":
            return
        if mode == "deterministic_demo" and not autoplay:
            return
    run_ticks = max(1, int(ticks or 1))
    if autoplay and not force:
        run_ticks = max(1, int(demo.get("speed_multiplier") or 1))

    for _ in range(run_ticks):
        demo["tick"] = int(demo.get("tick") or 0) + 1
        _log_playback(state, "tick_advanced", {"tick": demo["tick"], "mode": mode})
        # Process one execution per tick for stable deterministic playback.
        for exe in state.get("executions", []):
            if exe.get("status") in {"queued", "running"}:
                _advance_execution_runtime(state, exe, user)
                break


def _apply_signal_action(state: dict, signal: dict, action: str, payload: dict, user: dict):
    old = signal.get("status")
    if action == "create_opportunity":
        opp_id = _next_id("opp", state.get("opportunities", []), key="id")
        opp = {
            "id": opp_id,
            "signal_ids": [signal.get("id")],
            "type": signal.get("type") or "signal_opportunity",
            "title": f"Opportunity: {signal.get('title','Signal')}",
            "description": signal.get("description") or "",
            "expected_impact": "Capture detected visibility opportunity.",
            "citation_probability": round(float(signal.get("confidence") or 0.6), 2),
            "urgency": 0.75 if signal.get("severity") == "high" else 0.55,
            "confidence": signal.get("confidence") or 0.7,
            "recommended_format": "update_existing_page",
            "recommended_target": signal.get("target_page"),
            "recommended_actions": ["update_existing_page"],
            "status": "open",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "rationale": "Converted directly from inspected signal evidence.",
            "source_evidence": signal.get("evidence", []),
            "linked_plan_ids": [],
            "missing_entities": [],
            "missing_questions": [],
        }
        state.setdefault("opportunities", []).insert(0, opp)
        signal.setdefault("linked_opportunity_ids", [])
        signal["linked_opportunity_ids"].append(opp_id)
        _transition_or_raise("signal", signal, "converted")
        _append_audit(state, user, "signal_converted_to_opportunity", "signal", signal.get("id"), old, signal.get("status"), {"opportunity_id": opp_id}, "Created opportunity from signal")
        return {"opportunity_id": opp_id}
    if action == "assign":
        signal["assigned_agent_id"] = payload.get("agent_id")
        signal["assigned_agent_name"] = payload.get("agent_name")
        if signal.get("status") == "new":
            _transition_or_raise("signal", signal, "reviewed")
        _append_audit(state, user, "signal_assigned", "signal", signal.get("id"), old, signal.get("status"), {"agent_id": payload.get("agent_id")}, payload.get("reason", ""))
        return {}
    if action in {"dismiss", "mark_noise"}:
        _transition_or_raise("signal", signal, "dismissed")
        signal["dismiss_reason"] = payload.get("reason") or ("noise" if action == "mark_noise" else "dismissed")
        _append_audit(state, user, "signal_dismissed", "signal", signal.get("id"), old, signal.get("status"), {}, signal.get("dismiss_reason", ""))
        return {}
    if action == "snooze":
        _transition_or_raise("signal", signal, "snoozed")
        signal["snooze_until"] = payload.get("until")
        _append_audit(state, user, "signal_snoozed", "signal", signal.get("id"), old, signal.get("status"), {}, payload.get("until", ""))
        return {}
    if action == "merge_opportunity":
        target_id = payload.get("opportunity_id")
        target = _find_by_id(state.get("opportunities", []), target_id, key="id")
        if not target:
            raise HTTPException(status_code=404, detail="Target opportunity not found")
        signal.setdefault("linked_opportunity_ids", [])
        if target_id not in signal["linked_opportunity_ids"]:
            signal["linked_opportunity_ids"].append(target_id)
        _transition_or_raise("signal", signal, "merged")
        _append_audit(state, user, "signal_merged_into_opportunity", "signal", signal.get("id"), old, signal.get("status"), {"opportunity_id": target_id}, "")
        return {"opportunity_id": target_id}
    if action == "convert_plan":
        result = _apply_signal_action(state, signal, "create_opportunity", payload, user)
        opp = _find_by_id(state.get("opportunities", []), result.get("opportunity_id"), key="id")
        plan = _create_plan_from_opportunity(state, opp, user)
        _append_audit(state, user, "signal_converted_to_plan", "signal", signal.get("id"), signal.get("status"), signal.get("status"), {"opportunity_id": opp.get("id"), "plan_id": plan.get("id")}, "")
        return {"opportunity_id": opp.get("id"), "plan_id": plan.get("id")}
    raise HTTPException(status_code=400, detail=f"Unsupported signal action: {action}")


def _apply_opportunity_action(state: dict, opportunity: dict, action: str, payload: dict, user: dict):
    old = opportunity.get("status")
    if action == "create_plan":
        plan = _create_plan_from_opportunity(state, opportunity, user, payload.get("agent_id"))
        _transition_or_raise("opportunity", opportunity, "planning")
        _append_audit(state, user, "opportunity_plan_created", "opportunity", opportunity.get("id"), old, opportunity.get("status"), {"plan_id": plan.get("id")}, "")
        return {"plan_id": plan.get("id")}
    if action == "assign":
        opportunity["assigned_agent_id"] = payload.get("agent_id")
        opportunity["assigned_agent_name"] = payload.get("agent_name")
        _transition_or_raise("opportunity", opportunity, "assigned")
        _append_audit(state, user, "opportunity_assigned", "opportunity", opportunity.get("id"), old, opportunity.get("status"), {"agent_id": payload.get("agent_id")}, "")
        return {}
    if action in {"dismiss", "snooze"}:
        _transition_or_raise("opportunity", opportunity, "dismissed" if action == "dismiss" else "snoozed")
        _append_audit(state, user, f"opportunity_{action}", "opportunity", opportunity.get("id"), old, opportunity.get("status"), {}, payload.get("reason", ""))
        return {}
    if action == "send_review":
        _transition_or_raise("opportunity", opportunity, "in_review")
        _append_audit(state, user, "opportunity_in_review", "opportunity", opportunity.get("id"), old, opportunity.get("status"), {}, "")
        return {}
    if action == "merge":
        target_id = payload.get("opportunity_id")
        target = _find_by_id(state.get("opportunities", []), target_id, key="id")
        if not target:
            raise HTTPException(status_code=404, detail="Target opportunity not found")
        target.setdefault("signal_ids", [])
        for sid in opportunity.get("signal_ids", []):
            if sid not in target["signal_ids"]:
                target["signal_ids"].append(sid)
        _transition_or_raise("opportunity", opportunity, "dismissed")
        _append_audit(state, user, "opportunity_merged", "opportunity", opportunity.get("id"), old, opportunity.get("status"), {"merged_into": target_id}, "")
        return {"merged_into": target_id}
    if action == "auto_handle":
        _transition_or_raise("opportunity", opportunity, "approved")
        _append_audit(state, user, "opportunity_auto_handled", "opportunity", opportunity.get("id"), old, opportunity.get("status"), {}, "")
        return {}
    if action == "escalate_priority":
        opportunity["urgency"] = min(1.0, float(opportunity.get("urgency") or 0.5) + 0.15)
        _append_audit(state, user, "opportunity_priority_escalated", "opportunity", opportunity.get("id"), old, old, {}, "")
        return {}
    raise HTTPException(status_code=400, detail=f"Unsupported opportunity action: {action}")


def _apply_gap_action(state: dict, gap: dict, action: str, payload: dict, user: dict):
    old = gap.get("status")
    if action == "create_plan":
        opp = _find_by_id(state.get("opportunities", []), gap.get("opportunity_id"), key="id")
        if not opp:
            opp = {"id": _next_id("opp", state.get("opportunities", []), key="id"), "signal_ids": [], "title": f"Opportunity from {gap.get('gap_id')}", "description": gap.get("human_explanation", ""), "recommended_target": gap.get("target_topic"), "recommended_actions": gap.get("proposed_actions", []), "status": "open", "created_at": datetime.now(timezone.utc).isoformat(), "rationale": gap.get("human_explanation", ""), "source_evidence": [gap.get("source_url")], "linked_plan_ids": []}
            state.setdefault("opportunities", []).insert(0, opp)
            gap["opportunity_id"] = opp["id"]
        plan = _create_plan_from_opportunity(state, opp, user, payload.get("agent_id"))
        gap.setdefault("linked_plan_ids", []).append(plan.get("id"))
        _transition_or_raise("citation_gap", gap, "planned")
        _append_audit(state, user, "gap_plan_created", "citation_gap", gap.get("gap_id"), old, gap.get("status"), {"plan_id": plan.get("id")}, "")
        return {"plan_id": plan.get("id")}
    if action == "merge_plan":
        plan_id = payload.get("plan_id")
        plan = _find_by_id(state.get("plans", []), plan_id, key="id")
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")
        gap.setdefault("linked_plan_ids", [])
        if plan_id not in gap["linked_plan_ids"]:
            gap["linked_plan_ids"].append(plan_id)
        _transition_or_raise("citation_gap", gap, "planned")
        _append_audit(state, user, "gap_merged_into_plan", "citation_gap", gap.get("gap_id"), old, gap.get("status"), {"plan_id": plan_id}, "")
        return {"plan_id": plan_id}
    if action in {"assign", "dismiss", "snooze"}:
        if action == "assign":
            gap["assigned_agent_id"] = payload.get("agent_id")
            gap["assigned_agent_name"] = payload.get("agent_name")
            _transition_or_raise("citation_gap", gap, "assigned")
        elif action == "dismiss":
            _transition_or_raise("citation_gap", gap, "dismissed")
        else:
            _transition_or_raise("citation_gap", gap, "snoozed")
        _append_audit(state, user, f"gap_{action}", "citation_gap", gap.get("gap_id"), old, gap.get("status"), {}, "")
        return {}
    raise HTTPException(status_code=400, detail=f"Unsupported gap action: {action}")


def _apply_plan_action(state: dict, plan: dict, action: str, payload: dict, user: dict):
    old = plan.get("status")
    if action == "approve":
        _transition_or_raise("plan", plan, "approved")
        plan["approval_state"] = "approved"
        _append_audit(state, user, "plan_approved", "plan", plan.get("id"), old, plan.get("status"), {}, "")
        return {}
    if action == "approve_and_run":
        if plan.get("status") == "pending_approval":
            _transition_or_raise("plan", plan, "approved")
        if plan.get("status") == "approved":
            _transition_or_raise("plan", plan, "queued")
        exe = _create_execution_from_plan(state, plan, user)
        exe_old = exe.get("status")
        _transition_or_raise("execution", exe, "running")
        exe.setdefault("step_logs", []).append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "action_type": "runtime_start",
            "provider": "system",
            "target": plan.get("id"),
            "status": "running",
            "result": "execution started",
        })
        if plan.get("status") == "queued":
            _transition_or_raise("plan", plan, "running")
        plan["approval_state"] = "approved"
        _append_audit(state, user, "plan_approved_and_run", "plan", plan.get("id"), old, plan.get("status"), {"execution_id": exe.get("id")}, "")
        _append_audit(state, user, "execution_started", "execution", exe.get("id"), exe_old, exe.get("status"), {"plan_id": plan.get("id")}, "")
        return {"execution_id": exe.get("id")}
    if action == "reject":
        _transition_or_raise("plan", plan, "rejected")
        plan["approval_state"] = "rejected"
        _append_audit(state, user, "plan_rejected", "plan", plan.get("id"), old, plan.get("status"), {}, payload.get("reason", ""))
        return {}
    if action in {"pause", "resume", "cancel"}:
        target = {"pause": "paused", "resume": "running", "cancel": "cancelled"}[action]
        _transition_or_raise("plan", plan, target)
        _append_audit(state, user, f"plan_{action}", "plan", plan.get("id"), old, plan.get("status"), {}, "")
        return {}
    if action == "duplicate":
        dup = dict(plan)
        dup["id"] = _next_id("plan", state.get("plans", []), key="id")
        dup["status"] = "draft"
        dup["approval_state"] = "pending_approval"
        dup["created_at"] = datetime.now(timezone.utc).isoformat()
        state.setdefault("plans", []).insert(0, dup)
        _append_audit(state, user, "plan_duplicated", "plan", plan.get("id"), old, old, {"duplicate_id": dup.get("id")}, "")
        return {"duplicate_id": dup.get("id")}
    if action == "assign":
        plan["agent_id"] = payload.get("agent_id")
        plan["agent_name"] = payload.get("agent_name")
        _append_audit(state, user, "plan_assigned", "plan", plan.get("id"), old, old, {"agent_id": payload.get("agent_id")}, "")
        return {}
    if action == "schedule":
        plan["scheduled_for"] = payload.get("scheduled_for")
        _append_audit(state, user, "plan_scheduled", "plan", plan.get("id"), old, old, {"scheduled_for": payload.get("scheduled_for")}, "")
        return {}
    if action == "update":
        for k in ["name", "description", "steps"]:
            if k in payload:
                plan[k] = payload[k]
        _append_audit(state, user, "plan_updated", "plan", plan.get("id"), old, old, {}, "")
        return {}
    raise HTTPException(status_code=400, detail=f"Unsupported plan action: {action}")


def _apply_execution_action(state: dict, execution: dict, action: str, payload: dict, user: dict):
    old = execution.get("status")
    if action in {"pause", "resume", "cancel"}:
        target = {"pause": "paused", "resume": "running", "cancel": "cancelled"}[action]
        _transition_or_raise("execution", execution, target)
        _append_audit(state, user, f"execution_{action}", "execution", execution.get("id"), old, execution.get("status"), {}, "")
        return {}
    if action == "retry_step":
        step_key = payload.get("step")
        steps = execution.get("steps", [])
        failed = next((s for s in steps if s.get("step_id") == step_key), None) if step_key else None
        if not failed:
            failed = next((s for s in steps if s.get("status") == "failed"), None)
        if not failed:
            raise HTTPException(status_code=400, detail="No failed step available to retry")
        if int(failed.get("attempts") or 0) >= int(failed.get("max_attempts") or 3):
            raise HTTPException(status_code=400, detail="Step exceeded max attempts")
        failed["status"] = "queued"
        failed["error_summary"] = ""
        execution["blocking_reason"] = None
        execution.setdefault("errors", [])
        execution["errors"] = [e for e in execution["errors"] if e.get("step_id") != failed.get("step_id")]
        if execution.get("status") in {"failed", "needs_review"}:
            _transition_or_raise("execution", execution, "running")
        execution.setdefault("step_logs", []).append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "action_type": "retry_step",
            "provider": "system",
            "target": failed.get("step_id"),
            "status": "running",
            "result": "retry initiated",
        })
        _append_audit(state, user, "execution_retry_step", "execution", execution.get("id"), old, execution.get("status"), {"step": failed.get("step_id")}, "")
        return {"step_id": failed.get("step_id")}
    if action == "rerun":
        plan = _find_by_id(state.get("plans", []), execution.get("plan_id"), key="id")
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found for rerun")
        exe = _create_execution_from_plan(state, plan, user)
        _transition_or_raise("execution", exe, "running")
        _append_audit(state, user, "execution_rerun", "execution", execution.get("id"), old, old, {"new_execution_id": exe.get("id")}, "")
        return {"new_execution_id": exe.get("id")}
    if action == "branch_to_plan":
        plan = _find_by_id(state.get("plans", []), execution.get("plan_id"), key="id")
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")
        dup = dict(plan)
        dup["id"] = _next_id("plan", state.get("plans", []), key="id")
        dup["status"] = "draft"
        dup["approval_state"] = "pending_approval"
        dup["created_at"] = datetime.now(timezone.utc).isoformat()
        state.setdefault("plans", []).insert(0, dup)
        _append_audit(state, user, "execution_branched_to_plan", "execution", execution.get("id"), old, old, {"new_plan_id": dup.get("id")}, "")
        return {"new_plan_id": dup.get("id")}
    if action == "mark_review":
        _transition_or_raise("execution", execution, "needs_review")
        _append_audit(state, user, "execution_marked_review", "execution", execution.get("id"), old, execution.get("status"), {}, "")
        return {}
    if action == "approve_blocked":
        if execution.get("blocking_reason") != "approval_blocked":
            raise HTTPException(status_code=400, detail="Execution is not blocked by approval")
        steps = execution.get("steps", [])
        pending_step = next((s for s in steps if s.get("status") == "awaiting_approval"), None)
        if not pending_step:
            raise HTTPException(status_code=400, detail="No awaiting approval step found")
        pending_step["approval_required"] = False
        pending_step["status"] = "queued"
        execution["blocking_reason"] = None
        for item in state.get("approval_items", []):
            if item.get("object_type") == "execution_step" and item.get("object_id") == pending_step.get("step_id") and item.get("status") == "pending":
                item["status"] = "approved"
                item["decided_at"] = datetime.now(timezone.utc).isoformat()
                item["decided_by"] = user.get("email") or user.get("id")
                item["reason"] = payload.get("reason") or "approved from execution controls"
        if execution.get("status") in {"queued", "failed", "needs_review"}:
            execution["status"] = "running"
        _append_audit(state, user, "execution_blocking_approval_granted", "execution", execution.get("id"), old, execution.get("status"), {"step_id": pending_step.get("step_id")}, payload.get("reason", ""))
        return {"step_id": pending_step.get("step_id")}
    raise HTTPException(status_code=400, detail=f"Unsupported execution action: {action}")


def _apply_outcome_action(state: dict, outcome: dict, action: str, payload: dict, user: dict):
    old = outcome.get("status")
    if action == "validate":
        _transition_or_raise("outcome", outcome, "validated")
        _append_audit(state, user, "outcome_validated", "outcome", outcome.get("id"), old, outcome.get("status"), {}, "")
        return {}
    if action == "archive":
        target = "archived" if outcome.get("status") != "archived" else "archived"
        if old != "archived":
            _transition_or_raise("outcome", outcome, target)
        _append_audit(state, user, "outcome_archived", "outcome", outcome.get("id"), old, outcome.get("status"), {}, "")
        return {}
    if action == "mark_inconclusive":
        _transition_or_raise("outcome", outcome, "inconclusive")
        _append_audit(state, user, "outcome_inconclusive", "outcome", outcome.get("id"), old, outcome.get("status"), {}, "")
        return {}
    if action == "create_followup_opportunity":
        opp_id = _next_id("opp", state.get("opportunities", []), key="id")
        opp = {
            "id": opp_id,
            "signal_ids": [],
            "type": "followup_optimization",
            "title": f"Follow-up from outcome {outcome.get('id')}",
            "description": "Generated from outcome follow-up action.",
            "expected_impact": "Iterative optimization based on measured deltas.",
            "citation_probability": 0.6,
            "urgency": 0.6,
            "confidence": 0.7,
            "recommended_format": "optimization_cycle",
            "recommended_target": payload.get("target") or "existing URLs",
            "recommended_actions": ["create_plan"],
            "status": "open",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "rationale": outcome.get("narrative_summary", ""),
            "source_evidence": outcome.get("evidence_sources", []),
            "linked_plan_ids": [],
        }
        state.setdefault("opportunities", []).insert(0, opp)
        _append_audit(state, user, "outcome_followup_opportunity_created", "outcome", outcome.get("id"), old, old, {"opportunity_id": opp_id}, "")
        return {"opportunity_id": opp_id}
    raise HTTPException(status_code=400, detail=f"Unsupported outcome action: {action}")


def _apply_agent_action(state: dict, agent_obj: dict, action: str, payload: dict, user: dict):
    old = agent_obj.get("status")
    if action in {"pause", "resume"}:
        agent_obj["status"] = "paused" if action == "pause" else "active"
        _append_audit(state, user, f"agent_{action}", "agent", agent_obj.get("id"), old, agent_obj.get("status"), {}, "")
        return {}
    if action == "change_automation_mode":
        agent_obj["automation_mode"] = payload.get("automation_mode") or agent_obj.get("automation_mode")
        _append_audit(state, user, "agent_automation_mode_changed", "agent", agent_obj.get("id"), old, old, {}, payload.get("automation_mode", ""))
        return {}
    if action == "update_guardrails":
        agent_obj["approval_rules"] = payload.get("approval_rules") or agent_obj.get("approval_rules", {})
        agent_obj["execution_permissions"] = payload.get("execution_permissions") or agent_obj.get("execution_permissions", {})
        _append_audit(state, user, "agent_guardrails_updated", "agent", agent_obj.get("id"), old, old, {}, "")
        return {}
    if action == "reassign_scope":
        agent_obj["scope_mode"] = payload.get("scope_mode") or agent_obj.get("scope_mode")
        _append_audit(state, user, "agent_scope_reassigned", "agent", agent_obj.get("id"), old, old, {}, "")
        return {}
    if action == "manual_scan":
        sig_id = _next_id("sig", state.get("signals", []), key="id")
        state.setdefault("signals", []).insert(0, {
            "id": sig_id,
            "type": "manual_scan_signal",
            "source": "manual_scan",
            "title": f"Manual scan detected new opportunity area",
            "description": f"Manual scan executed by {user.get('email') or user.get('id')}",
            "severity": "medium",
            "confidence": 0.72,
            "topic": "manual scan topic",
            "target_page": None,
            "target_keyword_cluster": "manual cluster",
            "competitor_domain": None,
            "detected_at": datetime.now(timezone.utc).isoformat(),
            "status": "new",
            "evidence": ["Operator triggered manual scan"],
            "why_flagged": ["New cluster surfaced after manual run"],
            "linked_opportunity_ids": [],
            "detecting_agent": agent_obj.get("name"),
            "lifecycle_stage": "Observe",
            "site_scope_source": (state.get("scope") or {}).get("gsc_site") or "manual",
        })
        _append_audit(state, user, "agent_manual_scan", "agent", agent_obj.get("id"), old, old, {"signal_id": sig_id}, "")
        return {"signal_id": sig_id}
    raise HTTPException(status_code=400, detail=f"Unsupported agent action: {action}")


def _mutate_search_ops_object(state: dict, object_type: str, object_id: str, action: str, payload: dict, user: dict) -> dict:
    payload = payload or {}
    result: dict = {}
    if object_type == "signals":
        obj = _find_by_id(state.get("signals", []), object_id, key="id")
        if not obj:
            raise HTTPException(status_code=404, detail="Signal not found")
        result = _apply_signal_action(state, obj, action, payload, user)
    elif object_type == "opportunities":
        obj = _find_by_id(state.get("opportunities", []), object_id, key="id")
        if not obj:
            raise HTTPException(status_code=404, detail="Opportunity not found")
        result = _apply_opportunity_action(state, obj, action, payload, user)
    elif object_type == "citation-gaps":
        obj = _find_by_id(state.get("citation_gaps", []), object_id, key="gap_id")
        if not obj:
            obj = _find_by_id(state.get("citation_gaps", []), object_id, key="id")
        if not obj:
            raise HTTPException(status_code=404, detail="Citation gap not found")
        result = _apply_gap_action(state, obj, action, payload, user)
    elif object_type == "plans":
        obj = _find_by_id(state.get("plans", []), object_id, key="id")
        if not obj:
            raise HTTPException(status_code=404, detail="Plan not found")
        result = _apply_plan_action(state, obj, action, payload, user)
    elif object_type == "executions":
        obj = _find_by_id(state.get("executions", []), object_id, key="id")
        if not obj:
            raise HTTPException(status_code=404, detail="Execution not found")
        result = _apply_execution_action(state, obj, action, payload, user)
    elif object_type == "outcomes":
        obj = _find_by_id(state.get("outcomes", []), object_id, key="id")
        if not obj:
            raise HTTPException(status_code=404, detail="Outcome not found")
        result = _apply_outcome_action(state, obj, action, payload, user)
    elif object_type == "agents":
        obj = _find_by_id(state.get("agents", []), object_id, key="id")
        if not obj:
            # Build ephemeral agent object if not present in demo intel.
            obj = {"id": object_id, "name": payload.get("agent_name") or object_id, "status": "active"}
            state.setdefault("agents", []).append(obj)
        result = _apply_agent_action(state, obj, action, payload, user)
    elif object_type == "competitors":
        obj = _find_by_id(state.get("competitors", []), object_id, key="id")
        if not obj:
            raise HTTPException(status_code=404, detail="Competitor not found")
        old = obj.get("status")
        if action == "track_topics":
            obj.setdefault("tracked_topics", [])
            for topic in payload.get("topics", []):
                if topic not in obj["tracked_topics"]:
                    obj["tracked_topics"].append(topic)
        elif action == "spawn_counter_opportunity":
            opp_id = _next_id("opp", state.get("opportunities", []), key="id")
            state.setdefault("opportunities", []).insert(0, {
                "id": opp_id,
                "signal_ids": [],
                "type": "counter_competitor",
                "title": f"Counter {obj.get('domain')}",
                "description": "Counter-opportunity spawned from competitor view.",
                "expected_impact": "Close competitor format/entity gap.",
                "citation_probability": 0.64,
                "urgency": 0.68,
                "confidence": 0.74,
                "recommended_format": "counter_content",
                "recommended_target": payload.get("target") or "priority page",
                "recommended_actions": ["create_counter_content_plan"],
                "status": "open",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "rationale": "Spawned from competitor action.",
                "source_evidence": [obj.get("domain")],
                "linked_plan_ids": [],
            })
            result = {"opportunity_id": opp_id}
        elif action == "assign_monitoring":
            obj["assigned_agent_id"] = payload.get("agent_id")
            obj["assigned_agent_name"] = payload.get("agent_name")
        elif action == "increase_priority":
            obj["watch_priority"] = "high"
        elif action == "mute":
            obj["watch_priority"] = "muted"
            obj["status"] = "deprioritized"
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported competitor action: {action}")
        _append_audit(state, user, f"competitor_{action}", "competitor", obj.get("id"), old, obj.get("status"), result, "")
    elif object_type == "approvals":
        obj = _find_by_id(state.get("approval_items", []), object_id, key="approval_id")
        if not obj:
            raise HTTPException(status_code=404, detail="Approval item not found")
        old = obj.get("status")
        if action == "approve":
            obj["status"] = "approved"
            obj["decided_at"] = datetime.now(timezone.utc).isoformat()
            obj["decided_by"] = user.get("email") or user.get("id")
            obj["reason"] = payload.get("reason") or obj.get("reason")
            if obj.get("object_type") == "plan":
                plan = _find_by_id(state.get("plans", []), obj.get("object_id"), key="id")
                if plan and plan.get("status") == "pending_approval":
                    try:
                        _transition_or_raise("plan", plan, "approved")
                    except HTTPException:
                        plan["status"] = "approved"
                    plan["approval_state"] = "approved"
            if obj.get("object_type") == "execution_step":
                exe = _find_by_id(state.get("executions", []), obj.get("parent_execution_id"), key="id")
                if exe:
                    _apply_execution_action(state, exe, "approve_blocked", {"reason": payload.get("reason", "")}, user)
        elif action == "reject":
            obj["status"] = "rejected"
            obj["decided_at"] = datetime.now(timezone.utc).isoformat()
            obj["decided_by"] = user.get("email") or user.get("id")
            obj["reason"] = payload.get("reason") or "rejected"
        elif action == "approve_with_edits":
            obj["status"] = "approved_with_edits"
            obj["decided_at"] = datetime.now(timezone.utc).isoformat()
            obj["decided_by"] = user.get("email") or user.get("id")
            obj["reason"] = payload.get("reason") or "approved with edits"
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported approval action: {action}")
        _append_audit(state, user, f"approval_{action}", "approval", obj.get("approval_id"), old, obj.get("status"), {"approval_type": obj.get("approval_type"), "object_id": obj.get("object_id")}, obj.get("reason", ""))
    elif object_type == "artifacts":
        obj = _find_by_id(state.get("artifacts", []), object_id, key="artifact_id")
        if not obj:
            raise HTTPException(status_code=404, detail="Artifact not found")
        old = obj.get("review_status")
        if action == "approve_artifact":
            obj["review_status"] = "approved"
            obj["publish_status"] = "ready_to_publish"
        elif action == "reject_artifact":
            obj["review_status"] = "rejected"
            obj["publish_status"] = "draft"
        elif action == "mark_ready_publish":
            obj["publish_status"] = "ready_to_publish"
            if obj.get("review_status") == "pending":
                obj["review_status"] = "approved"
        elif action == "archive_artifact":
            obj["publish_status"] = "archived"
            obj["review_status"] = obj.get("review_status") or "approved"
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported artifact action: {action}")
        _append_audit(state, user, f"artifact_{action}", "artifact", obj.get("artifact_id"), old, obj.get("review_status"), {"execution_id": obj.get("linked_execution_id"), "step_id": obj.get("linked_step_id")}, payload.get("reason", ""))
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported object type: {object_type}")
    _simulate_runtime_progress(state, user)
    _recompute_queues(state)
    return {"result": result, "intelligence": state}


@app.post("/api/search-ops/{object_type}/{object_id}/action")
async def mutate_search_ops_object(
    object_type: str,
    object_id: str,
    data: SearchOpsActionRequest,
    user=Depends(get_current_user),
):
    state = _runtime_state(user_id=user["id"])
    return _mutate_search_ops_object(state, object_type, object_id, data.action, data.payload or {}, user)


@app.post("/api/search-ops/{object_type}/batch-action")
async def batch_mutate_search_ops_objects(
    object_type: str,
    data: SearchOpsBatchActionRequest,
    user=Depends(get_current_user),
):
    state = _runtime_state(user_id=user["id"])
    results: list[dict] = []
    for oid in (data.object_ids or []):
        try:
            changed = _mutate_search_ops_object(state, object_type, oid, data.action, data.payload or {}, user)
            results.append({"object_id": oid, "ok": True, "result": changed.get("result")})
        except HTTPException as e:
            results.append({"object_id": oid, "ok": False, "error": e.detail})
    _simulate_runtime_progress(state, user)
    _recompute_queues(state)
    return {"results": results, "intelligence": state}


@app.get("/api/demo/scenarios")
async def list_demo_scenarios(user=Depends(get_current_user)):
    return {
        "scenarios": [
            {
                "scenario_id": s.get("scenario_id"),
                "name": s.get("name"),
                "description": s.get("description"),
                "category": s.get("category"),
                "seed_key": s.get("seed_key"),
                "tags": s.get("tags", []),
                "expected_duration": s.get("expected_duration"),
                "recommended_audience": s.get("recommended_audience"),
            }
            for s in SCENARIO_PACKS
        ]
    }


@app.post("/api/demo/scenario/load")
async def load_demo_scenario(body: DemoScenarioLoadRequest, user=Depends(get_current_user)):
    scope = {"mode": "site"}
    SEARCH_OPS_RUNTIME[user["id"]] = _build_search_ops_demo(scope=scope)
    state = _runtime_state(user["id"], scope=scope)
    _configure_scenario(state, body.scenario_id, body.seed_key, mode=body.mode or "deterministic_demo")
    _apply_scenario_stage_effects(state, {"id": "demo.system", "email": "demo@croutons.ai"})
    _recompute_queues(state)
    return {"status": _scenario_status_payload(state), "intelligence": state}


@app.post("/api/demo/scenario/reset")
async def reset_demo_scenario(user=Depends(get_current_user)):
    state = _runtime_state(user["id"], scope={"mode": "site"})
    sid = (state.get("demo_runtime") or {}).get("current_scenario_id")
    if not sid:
        raise HTTPException(status_code=400, detail="No scenario loaded")
    seed_key = (state.get("demo_runtime") or {}).get("seed_key")
    SEARCH_OPS_RUNTIME[user["id"]] = _build_search_ops_demo(scope={"mode": "site"})
    state = _runtime_state(user["id"], scope={"mode": "site"})
    _configure_scenario(state, sid, seed_key, mode=(state.get("demo_runtime") or {}).get("scheduler_mode", "deterministic_demo"))
    _apply_scenario_stage_effects(state, {"id": "demo.system", "email": "demo@croutons.ai"})
    _recompute_queues(state)
    return {"status": _scenario_status_payload(state), "intelligence": state}


@app.post("/api/demo/scenario/advance-tick")
async def advance_demo_tick(user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    _simulate_runtime_progress(state, {"id": "demo.system", "email": "demo@croutons.ai"}, force=True, ticks=1)
    _recompute_queues(state)
    return {"status": _scenario_status_payload(state), "intelligence": state}


@app.post("/api/demo/scenario/advance-stage")
async def advance_demo_stage(user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    demo = state.setdefault("demo_runtime", {})
    sid = demo.get("current_scenario_id")
    pack = _scenario_pack(sid) if sid else None
    if not pack:
        raise HTTPException(status_code=400, detail="No scenario loaded")
    max_idx = max(0, len(pack.get("stages", [])) - 1)
    demo["scenario_stage_index"] = min(max_idx, int(demo.get("scenario_stage_index") or 0) + 1)
    _log_playback(state, "stage_advanced", {"stage_index": demo["scenario_stage_index"]})
    _apply_scenario_stage_effects(state, {"id": "demo.system", "email": "demo@croutons.ai"})
    _simulate_runtime_progress(state, {"id": "demo.system", "email": "demo@croutons.ai"}, force=True, ticks=1)
    _recompute_queues(state)
    return {"status": _scenario_status_payload(state), "intelligence": state}


@app.post("/api/demo/scenario/autoplay")
async def set_demo_autoplay(body: DemoAutoplayRequest, user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    demo = state.setdefault("demo_runtime", {})
    demo["autoplay"] = bool(body.enabled)
    demo["speed_multiplier"] = max(1, min(8, int(body.speed_multiplier or 1)))
    _log_playback(state, "autoplay_changed", {"enabled": demo["autoplay"], "speed_multiplier": demo["speed_multiplier"]})
    _recompute_queues(state)
    return {"status": _scenario_status_payload(state)}


@app.post("/api/demo/scenario/stop")
async def stop_demo_autoplay(user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    demo = state.setdefault("demo_runtime", {})
    demo["autoplay"] = False
    _log_playback(state, "autoplay_stopped", {})
    return {"status": _scenario_status_payload(state)}


@app.get("/api/demo/scenario/status")
async def demo_scenario_status(user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    _recompute_queues(state)
    return {
        "status": _scenario_status_payload(state),
        "story": {
            "current_stage": _scenario_stage(state),
            "queue_counts": state.get("queue_counts", {}),
            "approvals": state.get("approval_queue", [])[:10],
            "recent_outputs": state.get("artifacts", [])[:10],
            "suggested_next_click_path": ((_scenario_pack((state.get("demo_runtime") or {}).get("current_scenario_id")) or {}).get("recommended_walkthrough_order") or []),
        },
        "analytics": state.get("demo_analytics", {}),
    }


@app.get("/api/demo/walkthroughs")
async def list_walkthroughs(user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    walkthroughs = _walkthrough_catalog(state)
    return {
        "walkthroughs": [
            {
                "walkthrough_id": w.get("walkthrough_id"),
                "scenario_id": w.get("scenario_id"),
                "name": w.get("name"),
                "description": w.get("description"),
                "audience_type": w.get("audience_type"),
                "mode": w.get("mode"),
                "estimated_duration": w.get("estimated_duration"),
                "objectives": w.get("objectives", []),
                "total_steps": len(w.get("steps") or []),
                "recording_friendly": bool(w.get("recording_friendly")),
            }
            for w in walkthroughs
        ]
    }


@app.post("/api/demo/walkthrough/load")
async def load_walkthrough(body: WalkthroughLoadRequest, user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    pack = _walkthrough_pack(state, body.walkthrough_id)
    if not pack:
        raise HTTPException(status_code=404, detail="Walkthrough not found")
    demo = state.setdefault("demo_runtime", {})
    demo["walkthrough_id"] = body.walkthrough_id
    demo["walkthrough_mode"] = body.mode or pack.get("mode") or "self_guided"
    demo["audience_mode"] = body.audience_type or pack.get("audience_type") or demo.get("audience_mode", "technical")
    demo["walkthrough_step_index"] = 0
    demo["walkthrough_completed_steps"] = []
    demo["walkthrough_completion_state"] = {}
    demo["current_branch_id"] = None
    demo["branch_stack"] = []
    demo["visited_step_ids"] = []
    demo["branch_history"] = []
    demo["return_step_id"] = None
    demo["branch_mode"] = "mainline"
    demo["walkthrough_path_signature"] = "mainline"
    demo["walkthrough_active"] = bool(body.auto_start)
    demo["walkthrough_status"] = "running" if body.auto_start else "loaded"
    _log_playback(state, "walkthrough_loaded", {"walkthrough_id": body.walkthrough_id, "mode": demo["walkthrough_mode"]})
    # Align scenario when walkthrough is linked to one.
    scenario_id = pack.get("scenario_id")
    if scenario_id and demo.get("current_scenario_id") != scenario_id:
        _configure_scenario(state, scenario_id, demo.get("seed_key"), mode=demo.get("scheduler_mode", "deterministic_demo"))
        _apply_scenario_stage_effects(state, {"id": "demo.system", "email": "demo@croutons.ai"})
    _recompute_queues(state)
    return {"status": _walkthrough_status_payload(state), "scenario_status": _scenario_status_payload(state), "intelligence": state}


@app.post("/api/demo/walkthrough/start")
async def start_walkthrough(user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    demo = state.setdefault("demo_runtime", {})
    if not demo.get("walkthrough_id"):
        raise HTTPException(status_code=400, detail="No walkthrough loaded")
    demo["walkthrough_active"] = True
    demo["walkthrough_status"] = "running"
    _log_playback(state, "walkthrough_started", {"walkthrough_id": demo.get("walkthrough_id")})
    return {"status": _walkthrough_status_payload(state)}


@app.post("/api/demo/walkthrough/next")
async def walkthrough_next(user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    demo = state.setdefault("demo_runtime", {})
    step = _walkthrough_step(state)
    if not step:
        raise HTTPException(status_code=400, detail="No active walkthrough step")
    if demo.get("recording_mode") and str(demo.get("walkthrough_mode","")).lower() == "recorded" and (step.get("optional_branching") or []):
        auto_branch = _auto_branch_for_recording(state, step)
        if auto_branch:
            # inline branch routing before validation/advance
            pack = _walkthrough_pack(state, demo.get("walkthrough_id"))
            steps = (pack or {}).get("steps") or []
            target_id = auto_branch.get("target_step_id")
            target_idx = next((i for i, s in enumerate(steps) if s.get("step_id") == target_id), None)
            if target_idx is not None:
                demo.setdefault("branch_stack", []).append({
                    "branch_id": auto_branch.get("branch_id"),
                    "from_step_id": step.get("step_id"),
                    "return_step_id": step.get("step_id") if auto_branch.get("return_to_mainline") else None,
                })
                demo["current_branch_id"] = auto_branch.get("branch_id")
                demo["branch_mode"] = auto_branch.get("branch_type") or "branch"
                demo["walkthrough_path_signature"] = f"{demo.get('walkthrough_path_signature','mainline')}>{auto_branch.get('branch_id')}"
                demo.setdefault("branch_history", []).append({
                    "branch_id": auto_branch.get("branch_id"),
                    "selected_at": datetime.now(timezone.utc).isoformat(),
                    "label": auto_branch.get("label"),
                    "branch_type": auto_branch.get("branch_type"),
                    "target_step_id": target_id,
                    "auto_selected": True,
                })
                state.setdefault("demo_analytics", {})
                state["demo_analytics"]["branch_counts"] = state["demo_analytics"].get("branch_counts", {})
                state["demo_analytics"]["branch_counts"][auto_branch.get("branch_id")] = int(state["demo_analytics"]["branch_counts"].get(auto_branch.get("branch_id"), 0)) + 1
                demo["walkthrough_step_index"] = target_idx
                _log_playback(state, "walkthrough_branch_auto_selected", {"branch_id": auto_branch.get("branch_id"), "target_step_id": target_id})
                step = _walkthrough_step(state) or step
    ok, reason = _validate_walkthrough_step(state, step)
    if not ok:
        return {"status": _walkthrough_status_payload(state), "validation": {"ok": False, "message": reason, "hint": "Complete required action or use recorded mode auto-fix."}}
    completed = demo.setdefault("walkthrough_completed_steps", [])
    if step.get("step_id") not in completed:
        completed.append(step.get("step_id"))
    visited = demo.setdefault("visited_step_ids", [])
    if step.get("step_id") and step.get("step_id") not in visited:
        visited.append(step.get("step_id"))
    demo["walkthrough_completion_state"][step.get("step_id")] = {"completed_at": datetime.now(timezone.utc).isoformat(), "reason": reason}
    state.setdefault("demo_analytics", {})
    state["demo_analytics"]["step_completion_counts"] = state["demo_analytics"].get("step_completion_counts", {})
    state["demo_analytics"]["step_completion_counts"][step.get("step_id")] = int(state["demo_analytics"]["step_completion_counts"].get(step.get("step_id"), 0)) + 1
    pack = _walkthrough_pack(state, demo.get("walkthrough_id"))
    max_idx = max(0, len((pack or {}).get("steps", [])) - 1)
    demo["walkthrough_step_index"] = min(max_idx, int(demo.get("walkthrough_step_index") or 0) + 1)
    _log_playback(state, "walkthrough_next", {"step_id": step.get("step_id"), "new_index": demo.get("walkthrough_step_index")})
    if demo.get("walkthrough_mode") == "recorded":
        _simulate_runtime_progress(state, {"id": "demo.system", "email": "demo@croutons.ai"}, force=True, ticks=1)
    _recompute_queues(state)
    return {"status": _walkthrough_status_payload(state), "scenario_status": _scenario_status_payload(state), "intelligence": state}


@app.post("/api/demo/walkthrough/back")
async def walkthrough_back(user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    demo = state.setdefault("demo_runtime", {})
    demo["walkthrough_step_index"] = max(0, int(demo.get("walkthrough_step_index") or 0) - 1)
    _log_playback(state, "walkthrough_back", {"new_index": demo.get("walkthrough_step_index")})
    return {"status": _walkthrough_status_payload(state)}


@app.post("/api/demo/walkthrough/pause")
async def walkthrough_pause(user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    demo = state.setdefault("demo_runtime", {})
    demo["walkthrough_status"] = "paused"
    demo["walkthrough_active"] = False
    state.setdefault("demo_analytics", {})
    state["demo_analytics"]["pause_count"] = int(state["demo_analytics"].get("pause_count", 0)) + 1
    _log_playback(state, "walkthrough_paused", {})
    return {"status": _walkthrough_status_payload(state)}


@app.post("/api/demo/walkthrough/resume")
async def walkthrough_resume(user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    demo = state.setdefault("demo_runtime", {})
    if not demo.get("walkthrough_id"):
        raise HTTPException(status_code=400, detail="No walkthrough loaded")
    demo["walkthrough_status"] = "running"
    demo["walkthrough_active"] = True
    _log_playback(state, "walkthrough_resumed", {})
    return {"status": _walkthrough_status_payload(state)}


@app.post("/api/demo/walkthrough/end")
async def walkthrough_end(user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    demo = state.setdefault("demo_runtime", {})
    demo["walkthrough_status"] = "ended"
    demo["walkthrough_active"] = False
    state.setdefault("demo_analytics", {})
    state["demo_analytics"]["walkthrough_end_count"] = int(state["demo_analytics"].get("walkthrough_end_count", 0)) + 1
    _log_playback(state, "walkthrough_ended", {"walkthrough_id": demo.get("walkthrough_id")})
    return {"status": _walkthrough_status_payload(state)}


@app.post("/api/demo/walkthrough/reset")
async def walkthrough_reset(user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    demo = state.setdefault("demo_runtime", {})
    if not demo.get("walkthrough_id"):
        raise HTTPException(status_code=400, detail="No walkthrough loaded")
    demo["walkthrough_step_index"] = 0
    demo["walkthrough_completed_steps"] = []
    demo["walkthrough_completion_state"] = {}
    demo["walkthrough_status"] = "running"
    demo["walkthrough_active"] = True
    _log_playback(state, "walkthrough_reset", {"walkthrough_id": demo.get("walkthrough_id")})
    return {"status": _walkthrough_status_payload(state)}


@app.get("/api/demo/walkthrough/status")
async def walkthrough_status(user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    return {"status": _walkthrough_status_payload(state)}


@app.post("/api/demo/walkthrough/branch")
async def walkthrough_branch(body: WalkthroughBranchRequest, user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    demo = state.setdefault("demo_runtime", {})
    step = _walkthrough_step(state)
    if not step:
        raise HTTPException(status_code=400, detail="No active walkthrough step")
    branches = step.get("optional_branching") or []
    branch = next((b for b in branches if b.get("branch_id") == body.branch_id), None)
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found on current step")
    pack = _walkthrough_pack(state, demo.get("walkthrough_id"))
    steps = (pack or {}).get("steps") or []
    target_id = branch.get("target_step_id")
    target_idx = next((i for i, s in enumerate(steps) if s.get("step_id") == target_id), None)
    if target_idx is None:
        raise HTTPException(status_code=400, detail="Branch target step not found")
    demo.setdefault("branch_stack", []).append({
        "branch_id": branch.get("branch_id"),
        "from_step_id": step.get("step_id"),
        "return_step_id": step.get("step_id") if branch.get("return_to_mainline") else None,
    })
    demo["current_branch_id"] = branch.get("branch_id")
    demo["return_step_id"] = step.get("step_id") if branch.get("return_to_mainline") else demo.get("return_step_id")
    demo["branch_mode"] = branch.get("branch_type") or "branch"
    demo["walkthrough_step_index"] = target_idx
    demo["walkthrough_path_signature"] = f"{demo.get('walkthrough_path_signature','mainline')}>{branch.get('branch_id')}"
    demo.setdefault("branch_history", []).append({
        "branch_id": branch.get("branch_id"),
        "selected_at": datetime.now(timezone.utc).isoformat(),
        "label": branch.get("label"),
        "branch_type": branch.get("branch_type"),
        "target_step_id": target_id,
    })
    state.setdefault("demo_analytics", {})
    state["demo_analytics"]["branch_counts"] = state["demo_analytics"].get("branch_counts", {})
    state["demo_analytics"]["branch_counts"][branch.get("branch_id")] = int(state["demo_analytics"]["branch_counts"].get(branch.get("branch_id"), 0)) + 1
    _log_playback(state, "walkthrough_branch_selected", {"branch_id": branch.get("branch_id"), "target_step_id": target_id})
    _recompute_queues(state)
    return {"status": _walkthrough_status_payload(state), "scenario_status": _scenario_status_payload(state)}


@app.post("/api/demo/walkthrough/return-mainline")
async def walkthrough_return_mainline(user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    demo = state.setdefault("demo_runtime", {})
    pack = _walkthrough_pack(state, demo.get("walkthrough_id"))
    steps = (pack or {}).get("steps") or []
    return_step = demo.get("return_step_id")
    if return_step:
        idx = next((i for i, s in enumerate(steps) if s.get("step_id") == return_step), None)
        if idx is not None:
            demo["walkthrough_step_index"] = idx
    if demo.get("branch_stack"):
        demo["branch_stack"].pop()
    demo["current_branch_id"] = demo["branch_stack"][-1]["branch_id"] if demo.get("branch_stack") else None
    demo["branch_mode"] = "mainline"
    demo["return_step_id"] = None
    _log_playback(state, "walkthrough_returned_mainline", {"step_index": demo.get("walkthrough_step_index")})
    return {"status": _walkthrough_status_payload(state)}


@app.get("/api/demo/walkthrough/path-status")
async def walkthrough_path_status(user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    demo = state.get("demo_runtime") or {}
    return {
        "path_status": {
            "current_branch_id": demo.get("current_branch_id"),
            "branch_stack": demo.get("branch_stack", []),
            "branch_history": demo.get("branch_history", []),
            "return_step_id": demo.get("return_step_id"),
            "branch_mode": demo.get("branch_mode", "mainline"),
            "walkthrough_path_signature": demo.get("walkthrough_path_signature", "mainline"),
            "visited_step_ids": demo.get("visited_step_ids", []),
        }
    }


@app.get("/api/demo/demo-packs")
async def list_demo_packs(user=Depends(get_current_user)):
    return {"demo_packs": DEMO_PACKS}


@app.post("/api/demo/demo-pack/load")
async def load_demo_pack(body: DemoPackLoadRequest, user=Depends(get_current_user)):
    pack = _demo_pack(body.demo_pack_id)
    if not pack:
        raise HTTPException(status_code=404, detail="Demo pack not found")
    SEARCH_OPS_RUNTIME[user["id"]] = _build_search_ops_demo(scope={"mode": "site"})
    state = _runtime_state(user["id"], scope={"mode": "site"})
    seed_key = body.seed_key or pack.get("seed_key")
    _configure_scenario(state, pack.get("scenario_id"), seed_key, mode=pack.get("scheduler_mode") or "deterministic_demo")
    _apply_scenario_stage_effects(state, {"id": "demo.system", "email": "demo@croutons.ai"})
    demo = state.setdefault("demo_runtime", {})
    demo["presentation_mode"] = bool(pack.get("presentation_mode"))
    demo["recording_mode"] = bool(pack.get("recording_mode"))
    demo["audience_mode"] = pack.get("audience_mode") or demo.get("audience_mode")
    demo["annotations_visible"] = bool(pack.get("annotations_visibility", True))
    demo["speaker_notes_visible"] = bool(pack.get("notes_visibility", True))
    demo["autoplay"] = bool(pack.get("autoplay") if body.autoplay is None else body.autoplay)
    demo["active_demo_pack_id"] = pack.get("demo_pack_id")
    # Load linked walkthrough in loaded state.
    wt = _walkthrough_pack(state, pack.get("walkthrough_id"))
    if wt:
        demo["walkthrough_id"] = wt.get("walkthrough_id")
        demo["walkthrough_mode"] = wt.get("mode") or "self_guided"
        demo["walkthrough_step_index"] = 0
        demo["walkthrough_completed_steps"] = []
        demo["walkthrough_completion_state"] = {}
        demo["walkthrough_active"] = False
        demo["walkthrough_status"] = "loaded"
        demo["current_branch_id"] = None
        demo["branch_stack"] = []
        demo["visited_step_ids"] = []
        demo["branch_history"] = []
        demo["return_step_id"] = None
        demo["branch_mode"] = "mainline"
        demo["walkthrough_path_signature"] = "mainline"
    # light usage signals
    state.setdefault("demo_analytics", {})
    state["demo_analytics"]["pack_launch_counts"] = state["demo_analytics"].get("pack_launch_counts", {})
    state["demo_analytics"]["pack_launch_counts"][pack.get("demo_pack_id")] = int(state["demo_analytics"]["pack_launch_counts"].get(pack.get("demo_pack_id"), 0)) + 1
    _log_playback(state, "demo_pack_loaded", {"demo_pack_id": pack.get("demo_pack_id"), "scenario_id": pack.get("scenario_id"), "walkthrough_id": pack.get("walkthrough_id")})
    _recompute_queues(state)
    return {"status": _scenario_status_payload(state), "walkthrough_status": _walkthrough_status_payload(state), "demo_pack": pack, "intelligence": state}


@app.post("/api/demo/demo-pack/start")
async def start_demo_pack(body: DemoPackLoadRequest, user=Depends(get_current_user)):
    data = await load_demo_pack(body, user)
    state = _runtime_state(user["id"])
    demo = state.setdefault("demo_runtime", {})
    demo["walkthrough_active"] = True
    demo["walkthrough_status"] = "running"
    if demo.get("autoplay"):
        _simulate_runtime_progress(state, {"id": "demo.system", "email": "demo@croutons.ai"}, force=True, ticks=1)
    _log_playback(state, "demo_pack_started", {"demo_pack_id": demo.get("active_demo_pack_id")})
    _recompute_queues(state)
    return {"status": _scenario_status_payload(state), "walkthrough_status": _walkthrough_status_payload(state), "demo_pack": data.get("demo_pack"), "intelligence": state}


@app.post("/api/demo/demo-pack/end")
async def end_demo_pack(user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    demo = state.setdefault("demo_runtime", {})
    pack_id = demo.get("active_demo_pack_id")
    demo["walkthrough_active"] = False
    demo["walkthrough_status"] = "ended"
    demo["autoplay"] = False
    _log_playback(state, "demo_pack_ended", {"demo_pack_id": pack_id})
    state.setdefault("demo_analytics", {})
    state["demo_analytics"]["pack_end_counts"] = state["demo_analytics"].get("pack_end_counts", {})
    if pack_id:
        state["demo_analytics"]["pack_end_counts"][pack_id] = int(state["demo_analytics"]["pack_end_counts"].get(pack_id, 0)) + 1
    return {"status": _scenario_status_payload(state), "walkthrough_status": _walkthrough_status_payload(state)}


@app.get("/api/demo/demo-pack/status")
async def demo_pack_status(user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    demo = state.get("demo_runtime") or {}
    pack = _demo_pack(demo.get("active_demo_pack_id")) if demo.get("active_demo_pack_id") else None
    return {
        "active_demo_pack": pack,
        "status": _scenario_status_payload(state),
        "walkthrough_status": _walkthrough_status_payload(state),
    }


@app.get("/api/demo/walkthrough/export")
async def export_walkthroughs(user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "library": _walkthrough_catalog(state),
    }


@app.post("/api/demo/walkthrough/import")
async def import_walkthrough(body: WalkthroughImportRequest, user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    wt = body.walkthrough or {}
    if not wt.get("walkthrough_id"):
        raise HTTPException(status_code=400, detail="walkthrough_id required")
    wt["version"] = wt.get("version") or "1.0.0"
    wt["last_updated"] = datetime.now(timezone.utc).isoformat()
    wt["origin"] = wt.get("origin") or "imported"
    wt["archived"] = bool(wt.get("archived", False))
    state.setdefault("custom_walkthroughs", [])
    # Replace existing custom walkthrough with same id.
    state["custom_walkthroughs"] = [x for x in state["custom_walkthroughs"] if x.get("walkthrough_id") != wt.get("walkthrough_id")]
    state["custom_walkthroughs"].append(wt)
    _log_playback(state, "walkthrough_imported", {"walkthrough_id": wt.get("walkthrough_id")})
    return {"message": "Walkthrough imported", "walkthrough_id": wt.get("walkthrough_id")}


@app.post("/api/demo/scenario/settings")
async def update_demo_settings(body: DemoSettingsRequest, user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    demo = state.setdefault("demo_runtime", {})
    if body.presentation_mode is not None:
        demo["presentation_mode"] = bool(body.presentation_mode)
    if body.speaker_notes_visible is not None:
        demo["speaker_notes_visible"] = bool(body.speaker_notes_visible)
    if body.annotations_visible is not None:
        demo["annotations_visible"] = bool(body.annotations_visible)
    if body.audience_mode is not None:
        demo["audience_mode"] = body.audience_mode
    if body.scheduler_mode is not None:
        demo["scheduler_mode"] = body.scheduler_mode
    if body.recording_mode is not None:
        demo["recording_mode"] = bool(body.recording_mode)
    _log_playback(state, "demo_settings_updated", {"presentation_mode": demo.get("presentation_mode"), "audience_mode": demo.get("audience_mode"), "scheduler_mode": demo.get("scheduler_mode"), "recording_mode": demo.get("recording_mode")})
    return {"status": _scenario_status_payload(state)}


@app.post("/api/demo/state/reset-all")
async def reset_all_demo_state(user=Depends(get_current_user)):
    SEARCH_OPS_RUNTIME[user["id"]] = _build_search_ops_demo(scope={"mode": "site"})
    state = _runtime_state(user["id"], scope={"mode": "site"})
    _recompute_queues(state)
    return {"message": "Demo runtime reset", "status": _scenario_status_payload(state)}


@app.get("/api/demo/state/export")
async def export_demo_state(user=Depends(get_current_user)):
    state = _runtime_state(user["id"])
    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "demo_runtime": state.get("demo_runtime", {}),
        "queue_counts": state.get("queue_counts", {}),
        "live_ops": state.get("live_ops", {}),
        "artifacts": state.get("artifacts", []),
        "approvals": state.get("approval_items", []),
        "executions": state.get("executions", []),
        "outcomes": state.get("outcomes", []),
        "demo_analytics": state.get("demo_analytics", {}),
    }


@app.get("/api/dashboard")
async def get_dashboard(user: dict = Depends(get_current_user)):
    user_id = user["id"]
    try:
        agents = await sb_get(
            "/rest/v1/agents",
            params={"user_id": f"eq.{user_id}", "select": "id,status"},
        )
        profile_rows = await sb_get(
            "/rest/v1/profiles",
            params={"id": f"eq.{user_id}", "limit": "1"},
        )
        recent_runs = await sb_get(
            "/rest/v1/agent_runs",
            params={
                "user_id": f"eq.{user_id}",
                "order": "started_at.desc",
                "limit": "5",
            },
        )

        profile = profile_rows[0] if profile_rows else {}
        agents = agents or []
        active_count = sum(1 for a in agents if a.get("status") == "active")
        running_count = sum(1 for r in (recent_runs or []) if r.get("status") == "running")
        ops_demo = _build_search_ops_demo()

        return {
            "total_agents": len(agents),
            "active_agents": active_count,
            "active_runs": running_count,
            "api_calls_this_month": profile.get("api_calls_this_month", 0),
            "api_calls_limit": profile.get("api_calls_limit", 100),
            "current_plan": profile.get("plan", "free"),
            "recent_runs": recent_runs or [],
            "search_ops": {
                "headline": ops_demo.get("headline"),
                "lifecycle_counts": ops_demo.get("lifecycle_counts", {}),
                "kpis": ops_demo.get("kpis", {}),
                "signals": ops_demo.get("signals", []),
                "citation_gaps": ops_demo.get("citation_gaps", []),
                "executions": ops_demo.get("executions", []),
                "outcomes": ops_demo.get("outcomes", []),
            },
        }
    except Exception as e:
        logger.error(f"dashboard error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch dashboard data")


# ─────────────────────────────────────────────
# USAGE & BILLING
# ─────────────────────────────────────────────

@app.get("/api/usage")
async def get_usage(user: dict = Depends(get_current_user)):
    user_id = user["id"]
    # Current month filter
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    try:
        records = await sb_get(
            "/rest/v1/usage_records",
            params={
                "user_id": f"eq.{user_id}",
                "created_at": f"gte.{month_start}",
                "order": "created_at.desc",
                "limit": "500",
            },
        )
        records = records or []
        total_tokens = sum(r.get("tokens_used", 0) for r in records)
        total_cost = sum(r.get("cost_usd", 0) for r in records)
        total_price = sum(r.get("price_usd", 0) for r in records)

        return {
            "period": {"start": month_start, "end": now.isoformat()},
            "records": records,
            "summary": {
                "total_calls": len(records),
                "total_tokens": total_tokens,
                "total_cost_usd": round(total_cost, 6),
                "total_price_usd": round(total_price, 6),
            },
        }
    except Exception as e:
        logger.error(f"get_usage error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch usage")


@app.post("/api/billing/create-checkout")
async def create_checkout(body: CheckoutRequest, user: dict = Depends(get_current_user)):
    user_id = user["id"]
    plan = body.plan.lower()
    if plan not in STRIPE_PRICES:
        raise HTTPException(status_code=400, detail=f"Invalid plan '{plan}'. Choose 'pro' or 'enterprise'.")

    price_id = STRIPE_PRICES[plan]

    try:
        # Get or create Stripe customer
        profile_rows = await sb_get(
            "/rest/v1/profiles",
            params={"id": f"eq.{user_id}", "limit": "1"},
        )
        profile = profile_rows[0] if profile_rows else {}
        stripe_customer_id = profile.get("stripe_customer_id")

        if not stripe_customer_id:
            customer = stripe.Customer.create(
                email=user.get("email", ""),
                metadata={"supabase_user_id": user_id},
            )
            stripe_customer_id = customer.id
            # Save back to profile
            await sb_patch(
                "/rest/v1/profiles",
                params={"id": f"eq.{user_id}"},
                data={"stripe_customer_id": stripe_customer_id, "updated_at": datetime.now(timezone.utc).isoformat()},
            )

        base_url = os.getenv("APP_URL", "").rstrip("/")
        success_url = body.success_url or f"{base_url}/#/dashboard?upgraded=true"
        cancel_url = body.cancel_url or f"{base_url}/#/pricing"

        session = stripe.checkout.Session.create(
            customer=stripe_customer_id,
            payment_method_types=["card"],
            line_items=[{"price": price_id, "quantity": 1}],
            mode="subscription",
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={"supabase_user_id": user_id, "plan": plan},
        )

        return {
            "checkout_url": session.url,
            "session_id": session.id,
        }
    except stripe.StripeError as e:
        logger.error(f"Stripe checkout error: {e}")
        raise HTTPException(status_code=500, detail=f"Stripe error: {e.user_message}")
    except Exception as e:
        logger.error(f"create_checkout error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create checkout session")


@app.post("/api/billing/webhook")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events."""
    body = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    # In production, verify the webhook signature
    # For now, parse the event directly
    try:
        event = stripe.Event.construct_from(
            {"type": "checkout.session.completed", **{}},
            stripe.api_key,
        )
        # Actually parse the raw body
        import json as _json
        event_data = _json.loads(body)
        event_type = event_data.get("type")
    except Exception as e:
        logger.error(f"Webhook parse error: {e}")
        return JSONResponse({"error": "Invalid payload"}, status_code=400)

    if event_type == "checkout.session.completed":
        session_obj = event_data.get("data", {}).get("object", {})
        supabase_user_id = session_obj.get("metadata", {}).get("supabase_user_id")
        plan = session_obj.get("metadata", {}).get("plan", "pro")
        subscription_id = session_obj.get("subscription")

        if supabase_user_id:
            plan_limits = {
                "pro": {"api_calls_limit": 500, "agents_limit": 10},
                "enterprise": {"api_calls_limit": 999999, "agents_limit": 999},
            }
            limits = plan_limits.get(plan, plan_limits["pro"])
            try:
                await sb_patch(
                    "/rest/v1/profiles",
                    params={"id": f"eq.{supabase_user_id}"},
                    data={
                        "plan": plan,
                        "stripe_subscription_id": subscription_id,
                        "api_calls_limit": limits["api_calls_limit"],
                        "agents_limit": limits["agents_limit"],
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
                logger.info(f"Upgraded user {supabase_user_id} to {plan}")
            except Exception as e:
                logger.error(f"Webhook profile update error: {e}")

    elif event_type == "customer.subscription.deleted":
        # Downgrade to free
        subscription_id = event_data.get("data", {}).get("object", {}).get("id")
        if subscription_id:
            try:
                await sb_patch(
                    "/rest/v1/profiles",
                    params={"stripe_subscription_id": f"eq.{subscription_id}"},
                    data={
                        "plan": "free",
                        "stripe_subscription_id": None,
                        "api_calls_limit": 100,
                        "agents_limit": 3,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
            except Exception as e:
                logger.error(f"Webhook subscription cancel error: {e}")

    return {"received": True}


@app.get("/api/billing/portal")
async def billing_portal(user: dict = Depends(get_current_user)):
    user_id = user["id"]
    try:
        profile_rows = await sb_get(
            "/rest/v1/profiles",
            params={"id": f"eq.{user_id}", "limit": "1"},
        )
        profile = profile_rows[0] if profile_rows else {}
        stripe_customer_id = profile.get("stripe_customer_id")

        if not stripe_customer_id:
            raise HTTPException(status_code=400, detail="No billing account found. Please subscribe first.")

        portal = stripe.billing_portal.Session.create(
            customer=stripe_customer_id,
            return_url=os.getenv("APP_URL", "").rstrip("/") + "/#/dashboard",
        )
        return {"portal_url": portal.url}
    except HTTPException:
        raise
    except stripe.StripeError as e:
        logger.error(f"Stripe portal error: {e}")
        raise HTTPException(status_code=500, detail=f"Stripe error: {e.user_message}")
    except Exception as e:
        logger.error(f"billing_portal error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create billing portal session")


# ─────────────────────────────────────────────
# WAITLIST
# ─────────────────────────────────────────────

@app.post("/api/waitlist", status_code=201)
async def join_waitlist(body: WaitlistRequest):
    """Add email to waitlist — no auth required."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{SUPABASE_URL}/rest/v1/waitlist",
                headers={
                    **sb_headers_service(),
                    "Prefer": "return=minimal,resolution=ignore-duplicates",
                    "on_conflict": "email",
                },
                json={"email": body.email, "created_at": datetime.now(timezone.utc).isoformat()},
            )
            if r.status_code in (200, 201, 204):
                return {"message": "You've been added to the waitlist!"}
            # 409 conflict = already on waitlist
            if r.status_code == 409:
                return {"message": "You're already on the waitlist."}
            raise HTTPException(status_code=500, detail="Failed to join waitlist")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"waitlist error: {e}")
        raise HTTPException(status_code=500, detail="Failed to join waitlist")


# ─────────────────────────────────────────────
# COMMAND CENTER — Agentic SEO/AEO/GEO Dashboard
# ─────────────────────────────────────────────

@app.get("/api/command-center/overview")
async def command_center_overview(
    scope_mode: str = "site",
    agent_id: Optional[str] = None,
    github_repo: Optional[str] = None,
    gsc_site: Optional[str] = None,
    bing_site: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Aggregate overview for the command center — pulls from connected services."""
    user_id = user["id"]
    try:
        scope = await _resolve_command_center_scope(
            user_id=user_id,
            scope_mode=scope_mode,
            agent_id=agent_id,
            github_repo=github_repo,
            gsc_site=gsc_site,
            bing_site=bing_site,
        )

        # Get all connections for this user
        connections = await sb_get(
            "/rest/v1/connections",
            params={"user_id": f"eq.{user_id}"},
        )
        connected_services = {c["service"]: c for c in (connections or []) if c.get("is_active")}

        # Get agent stats (optionally narrowed to one selected agent)
        agent_params = {"user_id": f"eq.{user_id}", "select": "id,name,status,template_id,total_runs,total_tokens_used,last_run_at,created_at"}
        if scope["mode"] == "agent" and scope.get("agent_id"):
            agent_params["id"] = f"eq.{scope['agent_id']}"
        agents = await sb_get("/rest/v1/agents", params=agent_params)

        # Get recent runs for activity (optionally narrowed to one selected agent)
        run_params = {"user_id": f"eq.{user_id}", "order": "started_at.desc", "limit": "20"}
        if scope["mode"] == "agent" and scope.get("agent_id"):
            run_params["agent_id"] = f"eq.{scope['agent_id']}"
        recent_runs = await sb_get("/rest/v1/agent_runs", params=run_params)

        # Calculate agent stats
        total_agents = len(agents or [])
        active_agents = sum(1 for a in (agents or []) if a.get("status") == "active")
        total_runs = sum(a.get("total_runs", 0) or 0 for a in (agents or []))
        total_tokens = sum(a.get("total_tokens_used", 0) or 0 for a in (agents or []))

        # Aggregate run costs
        total_cost = 0
        for run in (recent_runs or []):
            total_cost += run.get("cost_usd", 0) or 0

        return {
            "scope": scope,
            "connected_services": list(connected_services.keys()),
            "service_count": len(connected_services),
            "agents": {
                "total": total_agents,
                "active": active_agents,
                "total_runs": total_runs,
                "total_tokens": total_tokens,
            },
            "recent_runs": [
                {
                    "id": r.get("id"),
                    "agent_id": r.get("agent_id"),
                    "status": r.get("status"),
                    "model": r.get("model"),
                    "total_tokens": r.get("total_tokens"),
                    "cost_usd": r.get("cost_usd"),
                    "duration_ms": r.get("duration_ms"),
                    "started_at": r.get("started_at"),
                    "completed_at": r.get("completed_at"),
                    "input_preview": ((r.get("input_data") or {}).get("message", ""))[:100],
                }
                for r in (recent_runs or [])
            ],
            "cost_total_usd": round(total_cost, 6),
        }
    except Exception as e:
        logger.error(f"command_center_overview error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch command center data")


@app.get("/api/command-center/seo")
async def command_center_seo(
    scope_mode: str = "site",
    agent_id: Optional[str] = None,
    github_repo: Optional[str] = None,
    gsc_site: Optional[str] = None,
    bing_site: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Fetch SEO metrics from connected Google Search Console."""
    user_id = user["id"]
    try:
        scope = await _resolve_command_center_scope(
            user_id=user_id,
            scope_mode=scope_mode,
            agent_id=agent_id,
            github_repo=github_repo,
            gsc_site=gsc_site,
            bing_site=bing_site,
        )

        # Check GSC connection
        rows = await sb_get(
            "/rest/v1/connections",
            params={"user_id": f"eq.{user_id}", "service": "eq.google_search_console", "limit": "1"},
        )
        if not rows:
            return {"connected": False, "message": "Google Search Console not connected"}

        creds = rows[0].get("credentials", {})
        access_token = creds.get("access_token")
        if not access_token:
            return {"connected": False, "message": "No access token available"}

        # Get list of sites
        async with httpx.AsyncClient(timeout=15) as client:
            sites_r = await client.get(
                "https://www.googleapis.com/webmasters/v3/sites",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if sites_r.status_code == 401:
                return {"connected": True, "expired": True, "message": "Token expired — reconnect Google Search Console"}
            if sites_r.status_code != 200:
                return {"connected": True, "error": True, "message": f"GSC returned {sites_r.status_code}"}

            sites_data = sites_r.json()
            sites = sites_data.get("siteEntry", [])

            if not sites:
                return {"connected": True, "sites": [], "message": "No sites found in GSC", "scope": scope}

            # Query last 28 days for scoped site if provided, otherwise first site.
            available_sites = [s.get("siteUrl", "") for s in sites if s.get("siteUrl")]
            scoped_site = (scope.get("gsc_site") or "").strip()
            site_url = scoped_site if scoped_site and scoped_site in available_sites else (available_sites[0] if available_sites else "")
            if not site_url:
                return {"connected": True, "sites": [], "message": "No accessible sites found in GSC", "scope": scope}
            now = datetime.now(timezone.utc)
            end_date = (now - timedelta(days=1)).strftime("%Y-%m-%d")
            start_date = (now - timedelta(days=28)).strftime("%Y-%m-%d")

            search_r = await client.post(
                f"https://www.googleapis.com/webmasters/v3/sites/{urllib.parse.quote(site_url, safe='')}/searchAnalytics/query",
                headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
                json={
                    "startDate": start_date,
                    "endDate": end_date,
                    "dimensions": ["date"],
                    "rowLimit": 28,
                },
            )

            daily_data = []
            totals = {"clicks": 0, "impressions": 0, "ctr": 0, "position": 0}
            if search_r.status_code == 200:
                rows_data = search_r.json().get("rows", [])
                for row in rows_data:
                    daily_data.append({
                        "date": row["keys"][0],
                        "clicks": row.get("clicks", 0),
                        "impressions": row.get("impressions", 0),
                        "ctr": round(row.get("ctr", 0) * 100, 2),
                        "position": round(row.get("position", 0), 1),
                    })
                    totals["clicks"] += row.get("clicks", 0)
                    totals["impressions"] += row.get("impressions", 0)
                if rows_data:
                    totals["ctr"] = round((totals["clicks"] / max(totals["impressions"], 1)) * 100, 2)
                    totals["position"] = round(sum(r.get("position", 0) for r in rows_data) / len(rows_data), 1)

            # Also query top pages
            pages_r = await client.post(
                f"https://www.googleapis.com/webmasters/v3/sites/{urllib.parse.quote(site_url, safe='')}/searchAnalytics/query",
                headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
                json={
                    "startDate": start_date,
                    "endDate": end_date,
                    "dimensions": ["page"],
                    "rowLimit": 10,
                    "orderBy": [{"fieldName": "clicks", "sortOrder": "DESCENDING"}],
                },
            )
            top_pages = []
            if pages_r.status_code == 200:
                for row in pages_r.json().get("rows", []):
                    top_pages.append({
                        "page": row["keys"][0],
                        "clicks": row.get("clicks", 0),
                        "impressions": row.get("impressions", 0),
                        "ctr": round(row.get("ctr", 0) * 100, 2),
                        "position": round(row.get("position", 0), 1),
                    })

            # Top queries
            queries_r = await client.post(
                f"https://www.googleapis.com/webmasters/v3/sites/{urllib.parse.quote(site_url, safe='')}/searchAnalytics/query",
                headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
                json={
                    "startDate": start_date,
                    "endDate": end_date,
                    "dimensions": ["query"],
                    "rowLimit": 15,
                    "orderBy": [{"fieldName": "clicks", "sortOrder": "DESCENDING"}],
                },
            )
            top_queries = []
            if queries_r.status_code == 200:
                for row in queries_r.json().get("rows", []):
                    top_queries.append({
                        "query": row["keys"][0],
                        "clicks": row.get("clicks", 0),
                        "impressions": row.get("impressions", 0),
                        "ctr": round(row.get("ctr", 0) * 100, 2),
                        "position": round(row.get("position", 0), 1),
                    })

        return {
            "scope": scope,
            "connected": True,
            "site_url": site_url,
            "period": {"start": start_date, "end": end_date},
            "totals": totals,
            "daily": daily_data,
            "top_pages": top_pages,
            "top_queries": top_queries,
        }
    except Exception as e:
        logger.error(f"command_center_seo error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch SEO data")


@app.get("/api/command-center/analytics")
async def command_center_analytics(user: dict = Depends(get_current_user)):
    """Fetch traffic analytics from Google Analytics including LLM referral detection."""
    user_id = user["id"]
    try:
        rows = await sb_get(
            "/rest/v1/connections",
            params={"user_id": f"eq.{user_id}", "service": "eq.google_analytics", "limit": "1"},
        )
        if not rows:
            return {"connected": False, "message": "Google Analytics not connected"}

        creds = rows[0].get("credentials", {})
        access_token = creds.get("access_token")
        if not access_token:
            return {"connected": False, "message": "No access token available"}

        # Note: GA4 requires property ID. We'll return connection status
        # and instructions for setup since we'd need the property ID stored.
        return {
            "connected": True,
            "message": "Google Analytics connected. Configure property ID in settings to enable LLM traffic tracking.",
            "llm_referral_patterns": [
                "chatgpt.com",
                "chat.openai.com",
                "perplexity.ai",
                "claude.ai",
                "gemini.google.com",
                "copilot.microsoft.com",
                "you.com",
                "phind.com",
            ],
            "setup_instructions": "Create a GA4 segment filtering source containing any of the LLM referral patterns above to track AI-driven conversions.",
        }
    except Exception as e:
        logger.error(f"command_center_analytics error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch analytics data")


@app.get("/api/command-center/agents-activity")
async def command_center_agents_activity(
    scope_mode: str = "site",
    agent_id: Optional[str] = None,
    github_repo: Optional[str] = None,
    gsc_site: Optional[str] = None,
    bing_site: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Aggregate all agent interactions/activity for the command center."""
    user_id = user["id"]
    try:
        scope = await _resolve_command_center_scope(
            user_id=user_id,
            scope_mode=scope_mode,
            agent_id=agent_id,
            github_repo=github_repo,
            gsc_site=gsc_site,
            bing_site=bing_site,
        )
        scoped_agent_id = scope.get("agent_id") if scope.get("mode") == "agent" else None

        agent_params = {"user_id": f"eq.{user_id}", "select": "id,name,status,template_id,total_runs,total_tokens_used,last_run_at,model"}
        if scoped_agent_id:
            agent_params["id"] = f"eq.{scoped_agent_id}"
        agents = await sb_get(
            "/rest/v1/agents",
            params=agent_params,
        )

        # Get last 50 runs across all agents
        run_params = {"user_id": f"eq.{user_id}", "order": "started_at.desc", "limit": "50"}
        if scoped_agent_id:
            run_params["agent_id"] = f"eq.{scoped_agent_id}"
        runs = await sb_get(
            "/rest/v1/agent_runs",
            params=run_params,
        )

        # Build agent name map
        agent_map = {a["id"]: a.get("name", "Unknown") for a in (agents or [])}

        # Group by agent
        agent_stats = {}
        for a in (agents or []):
            agent_stats[a["id"]] = {
                "name": a.get("name"),
                "status": a.get("status"),
                "template_id": a.get("template_id"),
                "model": a.get("model"),
                "total_runs": a.get("total_runs", 0) or 0,
                "total_tokens": a.get("total_tokens_used", 0) or 0,
                "last_run_at": a.get("last_run_at"),
            }

        # Build activity timeline
        timeline = []
        for run in (runs or []):
            agent_name = agent_map.get(run.get("agent_id"), "Unknown")
            status = run.get("status", "unknown")
            tokens = run.get("total_tokens", 0) or 0
            cost = run.get("cost_usd", 0) or 0
            input_preview = ((run.get("input_data") or {}).get("message", ""))[:120]
            output_preview = ((run.get("output_data") or {}).get("response", ""))[:120]

            timeline.append({
                "run_id": run.get("id"),
                "agent_id": run.get("agent_id"),
                "agent_name": agent_name,
                "status": status,
                "model": run.get("model"),
                "tokens": tokens,
                "cost_usd": cost,
                "duration_ms": run.get("duration_ms"),
                "input_preview": input_preview,
                "output_preview": output_preview,
                "started_at": run.get("started_at"),
                "completed_at": run.get("completed_at"),
            })

        # Daily aggregation for chart (last 14 days)
        daily_runs = defaultdict(lambda: {"runs": 0, "tokens": 0, "cost": 0})
        for run in (runs or []):
            date_str = (run.get("started_at") or "")[:10]
            if date_str:
                daily_runs[date_str]["runs"] += 1
                daily_runs[date_str]["tokens"] += run.get("total_tokens", 0) or 0
                daily_runs[date_str]["cost"] += run.get("cost_usd", 0) or 0

        daily_chart = sorted([
            {"date": k, **v} for k, v in daily_runs.items()
        ], key=lambda x: x["date"])

        return {
            "scope": scope,
            "agents": agent_stats,
            "timeline": timeline,
            "daily_chart": daily_chart,
        }
    except Exception as e:
        logger.error(f"command_center_agents_activity error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch agent activity data")


# ─────────────────────────────────────────────
# AI SEARCH BIBLE — SKILL PACK ENDPOINTS
# ─────────────────────────────────────────────

import json as _json_module


class CroutonizeRequest(BaseModel):
    text: str
    entity: str
    topic: str


class FanOutRequest(BaseModel):
    topic: str
    seed_prompts: Optional[list] = []
    entity: str
    verticals: Optional[list] = ["web", "shopping", "maps", "news", "images"]


class RetrievalSurfacesRequest(BaseModel):
    croutons: list
    entity: str
    domain: str


class InferenceCostRequest(BaseModel):
    url: Optional[str] = None
    content: Optional[str] = None


@app.post("/api/croutonize")
async def croutonize(body: CroutonizeRequest, user: dict = Depends(get_current_user)):
    """Convert raw text into atomic croutons following the Croutonization spec."""
    system = (
        "You are an AI Search Optimization expert on the Croutons Agents platform. "
        "Your task is to convert raw content into atomic, machine-parseable knowledge units called croutons. "
        "Each crouton must follow this exact JSON schema:\n"
        "{\"crouton_id\": \"string\", \"entity_primary\": \"string\", \"entities\": [\"string\"], "
        "\"fact\": \"string\", \"context\": \"string\", \"application\": \"string\", "
        "\"source_url\": \"string\", \"source_type\": \"research\", \"tags\": [\"string\"], \"confidence\": \"verified\"}\n"
        "Rules: (1) one claim per fact, (2) no pronouns without antecedents, (3) specific numbers and dates, "
        "(4) consistent entity naming using the provided entity name, (5) self-contained test. "
        "Return valid JSON with a \"croutons\" array containing at least 10 crouton objects."
    )
    prompt = (
        f"Entity: {body.entity}\nTopic: {body.topic}\n\nContent to croutonize:\n{body.text[:6000]}\n\n"
        "Generate a minimum of 10 croutons. Assign crouton_id values as c-001, c-002, etc. "
        "Return only valid JSON."
    )
    try:
        completion = await openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=3000,
            response_format={"type": "json_object"},
        )
        raw = completion.choices[0].message.content
        data = _json_module.loads(raw)
        croutons = data.get("croutons", [])

        # Build NDJSON string
        ndjson_lines = [_json_module.dumps(c) for c in croutons]
        ndjson_str = "\n".join(ndjson_lines)

        # Estimate inference cost score
        total_ics = 0
        if croutons:
            avg_fact_len = sum(len(c.get("fact", "")) for c in croutons) / len(croutons)
            ics_atomicity = max(0, 5 - min(5, avg_fact_len / 100))
            ics_entity = 1 if any(body.entity.lower() not in c.get("fact", "").lower() for c in croutons) else 0
            ics_freshness = 0
            total_ics = round(ics_atomicity + ics_entity + ics_freshness, 2)
        retrieval_advantage = round(1 / (1 + total_ics), 4) if total_ics >= 0 else 1.0

        prompt_tokens = completion.usage.prompt_tokens
        completion_tokens = completion.usage.completion_tokens
        cost_usd, _ = calculate_cost("gpt-4o-mini", prompt_tokens, completion_tokens)

        return {
            "croutons": croutons,
            "ndjson": ndjson_str,
            "inference_cost_score": total_ics,
            "retrieval_advantage": retrieval_advantage,
            "crouton_count": len(croutons),
            "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens, "cost_usd": cost_usd},
        }
    except Exception as e:
        logger.error(f"croutonize error: {e}")
        raise HTTPException(status_code=500, detail=f"Croutonization failed: {str(e)}")


@app.post("/api/fanout-intelligence")
async def fanout_intelligence(body: FanOutRequest, user: dict = Depends(get_current_user)):
    """Generate fan-out query cluster, coverage estimates, and gap analysis."""
    verticals_str = ", ".join(body.verticals or ["web", "shopping", "maps", "news", "images"])
    seed_str = "\n".join(f"- {p}" for p in (body.seed_prompts or [])[:10]) if body.seed_prompts else "None provided."

    system = (
        "You are an AI Search fan-out analysis expert on the Croutons Agents platform. "
        "Your task is to generate a comprehensive fan-out query cluster and coverage analysis. "
        "Return valid JSON with this structure: "
        "{\"prompt_cluster\": [list of 30-50 distinct query strings], "
        "\"fanout_queries\": [{\"query\": \"string\", \"vertical\": \"web|shopping|maps|news|images\", "
        "\"recency_tag\": \"7d|30d|365d|none\", \"retrieval_probability\": float 0-1}], "
        "\"coverage_estimate\": {\"web\": float, \"shopping\": float, \"maps\": float, \"news\": float, \"images\": float, \"overall\": float}, "
        "\"gap_analysis\": {\"uncovered_topics\": [\"string\"], \"priority_gaps\": [\"string\"], \"recommended_content\": [\"string\"]}, "
        "\"recommended_croutons\": [{\"topic\": \"string\", \"fact_hint\": \"string\", \"priority\": \"high|medium|low\"}]}"
    )
    prompt = (
        f"Entity/Brand: {body.entity}\n"
        f"Topic: {body.topic}\n"
        f"Verticals to analyze: {verticals_str}\n"
        f"Seed prompts:\n{seed_str}\n\n"
        "Generate a comprehensive fan-out analysis with 30-50 prompt cluster queries covering all relevant "
        "query variants, synonyms, and entity combinations. Include 10-30 fan-out queries per vertical where applicable. "
        "Estimate coverage scores as percentages (0.0-1.0). Identify specific gaps and recommend content to fill them. "
        "Return only valid JSON."
    )
    try:
        completion = await openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            temperature=0.4,
            max_tokens=4000,
            response_format={"type": "json_object"},
        )
        raw = completion.choices[0].message.content
        data = _json_module.loads(raw)
        prompt_tokens = completion.usage.prompt_tokens
        completion_tokens = completion.usage.completion_tokens
        cost_usd, _ = calculate_cost("gpt-4o-mini", prompt_tokens, completion_tokens)
        data["usage"] = {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens, "cost_usd": cost_usd}
        return data
    except Exception as e:
        logger.error(f"fanout_intelligence error: {e}")
        raise HTTPException(status_code=500, detail=f"Fan-out analysis failed: {str(e)}")


@app.post("/api/retrieval-surfaces")
async def retrieval_surfaces(body: RetrievalSurfacesRequest, user: dict = Depends(get_current_user)):
    """Generate a retrieval surface distribution plan from a crouton set."""
    croutons_preview = _json_module.dumps(body.croutons[:5], indent=2) if body.croutons else "[]"
    system = (
        "You are a retrieval surface engineering expert on the Croutons Agents platform. "
        "Generate a complete surface distribution plan. Return valid JSON with this structure: "
        "{\"surfaces\": [{\"name\": \"string\", \"type\": \"string\", \"priority\": \"high|medium|low\", "
        "\"implementation\": \"string\", \"estimated_coverage_gain\": float}], "
        "\"distribution_plan\": {\"phase_1\": [\"string\"], \"phase_2\": [\"string\"], \"phase_3\": [\"string\"]}, "
        "\"ndjson_stream\": \"string (NDJSON lines joined by newline)\", "
        "\"jsonld_graph\": {\"@context\": \"https://schema.org\", \"@graph\": []}, "
        "\"entity_map\": {\"entities\": [{\"canonical_name\": \"string\", \"sameAs\": [\"string\"], \"type\": \"string\"}]}}"
    )
    prompt = (
        f"Entity: {body.entity}\nDomain: {body.domain}\n"
        f"Crouton set preview (first 5):\n{croutons_preview}\n"
        f"Total croutons: {len(body.croutons)}\n\n"
        "Generate a full retrieval surface distribution plan including all required schema types (WebPage, "
        "Organization with sameAs, FAQPage, HowTo, Article), NDJSON stream, JSON-LD @graph, and entity map "
        "with sameAs links. Return only valid JSON."
    )
    try:
        completion = await openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=3000,
            response_format={"type": "json_object"},
        )
        raw = completion.choices[0].message.content
        data = _json_module.loads(raw)
        prompt_tokens = completion.usage.prompt_tokens
        completion_tokens = completion.usage.completion_tokens
        cost_usd, _ = calculate_cost("gpt-4o-mini", prompt_tokens, completion_tokens)
        data["usage"] = {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens, "cost_usd": cost_usd}
        return data
    except Exception as e:
        logger.error(f"retrieval_surfaces error: {e}")
        raise HTTPException(status_code=500, detail=f"Retrieval surface generation failed: {str(e)}")


@app.post("/api/inference-cost-score")
async def inference_cost_score(body: InferenceCostRequest, user: dict = Depends(get_current_user)):
    """Score content on all six inference cost dimensions."""
    if not body.content and not body.url:
        raise HTTPException(status_code=400, detail="Either 'url' or 'content' is required")

    content_to_score = body.content or ""

    # Fetch URL content if provided
    if body.url and not content_to_score:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(body.url, headers={"User-Agent": "CroutonsAgents/1.0"})
                if r.status_code == 200:
                    # Strip basic HTML tags
                    import re as _re
                    content_to_score = _re.sub(r"<[^>]+>", " ", r.text)[:5000]
                else:
                    raise HTTPException(status_code=400, detail=f"Failed to fetch URL: HTTP {r.status_code}")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to fetch URL: {str(e)}")

    system = (
        "You are an inference cost scoring expert on the Croutons Agents platform. "
        "Score the provided content on six dimensions (0-5 each, lower is better for AI retrieval): "
        "1. atomicity (0=perfectly atomic single claims, 5=many compound claims), "
        "2. context_completeness (0=fully self-contained, 5=requires extensive external context), "
        "3. structure (0=perfectly structured, 5=completely unstructured prose), "
        "4. ambiguity (0=zero ambiguity, 5=highly ambiguous references), "
        "5. entity_clarity (0=all entities fully named, 5=heavy pronoun/reference use), "
        "6. freshness_signaling (0=explicit dates throughout, 5=no date signals). "
        "Return valid JSON with this structure: "
        "{\"scores\": {\"atomicity\": int, \"context_completeness\": int, \"structure\": int, "
        "\"ambiguity\": int, \"entity_clarity\": int, \"freshness_signaling\": int}, "
        "\"total_score\": int, \"retrieval_advantage\": float, "
        "\"recommendations\": [{\"dimension\": \"string\", \"issue\": \"string\", \"fix\": \"string\"}], "
        "\"summary\": \"string\"}"
    )
    prompt = (
        f"Content to score (URL: {body.url or 'direct input'}):\n\n{content_to_score[:4000]}\n\n"
        "Score each dimension 0-5 where 0 is optimal for AI retrieval and 5 is worst. "
        "Provide specific, actionable recommendations for each dimension with a score above 1. "
        "Return only valid JSON."
    )
    try:
        completion = await openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=2000,
            response_format={"type": "json_object"},
        )
        raw = completion.choices[0].message.content
        data = _json_module.loads(raw)

        # Ensure retrieval_advantage is computed
        total = data.get("total_score", sum(data.get("scores", {}).values()))
        data["total_score"] = total
        data["retrieval_advantage"] = round(1 / (1 + total), 4)

        prompt_tokens = completion.usage.prompt_tokens
        completion_tokens = completion.usage.completion_tokens
        cost_usd, _ = calculate_cost("gpt-4o-mini", prompt_tokens, completion_tokens)
        data["usage"] = {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens, "cost_usd": cost_usd}
        return data
    except Exception as e:
        logger.error(f"inference_cost_score error: {e}")
        raise HTTPException(status_code=500, detail=f"Scoring failed: {str(e)}")


@app.get("/api/skill-packs")
async def list_skill_packs(user: dict = Depends(get_current_user)):
    """Return available skill packs."""
    return {
        "skill_packs": [
            {
                "id": "ai-search-bible",
                "name": "AI Search Bible",
                "version": "1.0.0",
                "description": "Complete AI search optimization doctrine including Croutonization, fan-out engine model, retrieval surface engineering, and measurement framework.",
                "author": "Croutons.ai",
                "tags": ["seo", "aeo", "geo", "ai-search", "croutons", "retrieval"],
                "endpoints": ["/api/croutonize", "/api/fanout-intelligence", "/api/retrieval-surfaces", "/api/inference-cost-score"],
                "knowledge_base_url": "/static/knowledge/ai-search-bible.ndjson",
                "template_id": "ai_retrieval",
                "status": "active",
            }
        ]
    }


@app.get("/api/skill-packs/ai-search-bible")
async def get_ai_search_bible(user: dict = Depends(get_current_user)):
    """Return the full AI Search Bible skill pack metadata and activation config."""
    template = next((t for t in TEMPLATES if t["id"] == "ai_retrieval"), None)
    return {
        "id": "ai-search-bible",
        "name": "AI Search Bible",
        "version": "1.0.0",
        "description": "Complete AI search optimization doctrine for the Croutons Agents platform.",
        "author": "Croutons.ai",
        "tags": ["seo", "aeo", "geo", "ai-search", "croutons", "retrieval"],
        "endpoints": [
            {"path": "/api/croutonize", "method": "POST", "description": "Convert raw text into atomic croutons"},
            {"path": "/api/fanout-intelligence", "method": "POST", "description": "Generate fan-out query cluster and coverage analysis"},
            {"path": "/api/retrieval-surfaces", "method": "POST", "description": "Generate retrieval surface distribution plan"},
            {"path": "/api/inference-cost-score", "method": "POST", "description": "Score content on six inference cost dimensions"},
        ],
        "knowledge_base_url": "/static/knowledge/ai-search-bible.ndjson",
        "template_id": "ai_retrieval",
        "template": template,
        "activation_config": {
            "inject_doctrine": True,
            "core_doctrine_prepend": True,
            "required_outputs": [
                "knowledge_page", "crouton_set", "faq_set", "schema_graph",
                "ndjson_stream", "entity_map", "surface_distribution_plan",
                "measurement_plan", "update_cadence_plan",
            ],
            "quality_gates": [
                "atomicity_check", "retrieval_cost_check", "entity_consistency_check",
                "freshness_check", "surface_multiplication_check",
            ],
            "kpis": ["FanOutCoverage", "InferenceCostScore", "RetrievalAdvantage", "EntityAuthority", "RetrievalSurfaceCount"],
        },
        "status": "active",
    }


# ─────────────────────────────────────────────
# HEALTH CHECK
# ─────────────────────────────────────────────

@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "service": "Neural Command API",
        "version": "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "stripe_prices": STRIPE_PRICES,
    }

@app.get("/api/config")
async def get_config():
    """Return public config (safe to expose to frontend)."""
    return {
        "supabase_url": SUPABASE_URL,
        "supabase_anon_key": SUPABASE_ANON_KEY,
        "stripe_publishable_key": STRIPE_PUBLISHABLE_KEY,
    }


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────

# ─────────────────────────────────────────────
# Serve Static Frontend
# ─────────────────────────────────────────────

import pathlib

# ── Serve app.js with runtime patches ──
_APP_JS_CONTENT = None
try:
    from app_js_blob import get_app_js as _get_app_js_blob
    _APP_JS_CONTENT = _get_app_js_blob()
    logger.info(f"Loaded app.js from blob: {len(_APP_JS_CONTENT)} bytes")
except Exception as _e:
    logger.warning(f"app_js_blob not available, falling back to static file: {_e}")
    static_path = pathlib.Path(__file__).parent / "static" / "app.js"
    if static_path.exists():
        _APP_JS_CONTENT = static_path.read_text(encoding="utf-8")
        logger.info(f"Loaded app.js from static file: {len(_APP_JS_CONTENT)} bytes")

# Apply runtime patches
try:
    from appjs_patches import apply_patches
    if _APP_JS_CONTENT:
        _APP_JS_CONTENT = apply_patches(_APP_JS_CONTENT)
except Exception as _pe:
    logger.warning(f"Could not apply app.js patches: {_pe}")


@app.get("/static/app.js")
async def serve_app_js():
    """Serve the full app.js (from blob or static file, with runtime patches)."""
    if _APP_JS_CONTENT:
        return HTMLResponse(content=_APP_JS_CONTENT, media_type="application/javascript",
                           headers={"Cache-Control": "public, max-age=3600"})
    raise HTTPException(status_code=404, detail="app.js not found")


STATIC_DIR = pathlib.Path(__file__).parent / "static"
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.get("/")
    async def serve_index():
        return FileResponse(str(STATIC_DIR / "index.html"))

    # Catch-all for SPA — serve index.html for non-API routes
    @app.get("/{path:path}")
    async def serve_spa(path: str):
        file_path = STATIC_DIR / path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(STATIC_DIR / "index.html"))


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
