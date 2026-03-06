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


def _build_rules_payload(raw_rules: Any, data_scope: Optional[dict] = None) -> dict:
    """Store rules in a backward-compatible object structure."""
    scope = _normalize_data_scope(data_scope)
    text_rules = _extract_rule_text_rules(raw_rules)

    # Preserve existing scope if caller didn't explicitly provide one.
    if not scope:
        scope = _extract_data_scope(raw_rules)

    return {"text_rules": text_rules, "data_scope": scope}


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
        return agents or []
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
        "rules": _build_rules_payload(body.rules, body.data_scope),
        "total_runs": 0,
        "total_tokens_used": 0,
        "created_at": now,
        "updated_at": now,
    }

    try:
        result = await sb_post("/rest/v1/agents", agent_data)
        if isinstance(result, list):
            return result[0]
        return result
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
        return rows[0]
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

    if body.rules is not None or body.data_scope is not None:
        if body.rules is None:
            rules_payload = {
                "text_rules": _extract_rule_text_rules(existing_agent.get("rules")),
                "data_scope": _normalize_data_scope(body.data_scope),
            }
        elif body.data_scope is None:
            rules_payload = {
                "text_rules": _extract_rule_text_rules(body.rules),
                "data_scope": _extract_data_scope(existing_agent.get("rules")),
            }
        else:
            rules_payload = _build_rules_payload(body.rules, body.data_scope)
        update_data["rules"] = rules_payload

    try:
        result = await sb_patch(
            "/rest/v1/agents",
            params={"id": f"eq.{agent_id}", "user_id": f"eq.{user_id}"},
            data=update_data,
        )
        return result[0] if isinstance(result, list) and result else {"message": "Updated"}
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
            except Exception as e:
                logger.warning(f"get_agent_scope_options: github fetch failed: {e}")

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
            except Exception as e:
                logger.warning(f"get_agent_scope_options: gsc fetch failed: {e}")

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
            except Exception as e:
                logger.warning(f"get_agent_scope_options: bing fetch failed: {e}")

    return {
        "github_repos": github_repos,
        "gsc_sites": gsc_sites,
        "bing_sites": bing_sites,
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
    return TEMPLATES


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

        return {
            "total_agents": len(agents),
            "active_agents": active_count,
            "active_runs": running_count,
            "api_calls_this_month": profile.get("api_calls_this_month", 0),
            "api_calls_limit": profile.get("api_calls_limit", 100),
            "current_plan": profile.get("plan", "free"),
            "recent_runs": recent_runs or [],
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
async def command_center_overview(user: dict = Depends(get_current_user)):
    """Aggregate overview for the command center — pulls from connected services."""
    user_id = user["id"]
    try:
        # Get all connections for this user
        connections = await sb_get(
            "/rest/v1/connections",
            params={"user_id": f"eq.{user_id}"},
        )
        connected_services = {c["service"]: c for c in (connections or []) if c.get("is_active")}

        # Get agent stats
        agents = await sb_get(
            "/rest/v1/agents",
            params={"user_id": f"eq.{user_id}", "select": "id,name,status,template_id,total_runs,total_tokens_used,last_run_at,created_at"},
        )

        # Get recent runs for activity
        recent_runs = await sb_get(
            "/rest/v1/agent_runs",
            params={
                "user_id": f"eq.{user_id}",
                "order": "started_at.desc",
                "limit": "20",
            },
        )

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
async def command_center_seo(user: dict = Depends(get_current_user)):
    """Fetch SEO metrics from connected Google Search Console."""
    user_id = user["id"]
    try:
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
                return {"connected": True, "sites": [], "message": "No sites found in GSC"}

            # Query last 28 days for the first site
            site_url = sites[0].get("siteUrl", "")
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
async def command_center_agents_activity(user: dict = Depends(get_current_user)):
    """Aggregate all agent interactions/activity for the command center."""
    user_id = user["id"]
    try:
        agents = await sb_get(
            "/rest/v1/agents",
            params={"user_id": f"eq.{user_id}", "select": "id,name,status,template_id,total_runs,total_tokens_used,last_run_at,model"},
        )

        # Get last 50 runs across all agents
        runs = await sb_get(
            "/rest/v1/agent_runs",
            params={
                "user_id": f"eq.{user_id}",
                "order": "started_at.desc",
                "limit": "50",
            },
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
