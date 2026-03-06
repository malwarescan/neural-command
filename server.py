"""Startup shim: reconstitute large files from compressed blobs, then run middleware.
Entry point via Procfile: uvicorn server:app
"""
import os, pathlib, logging, re, sys

logger = logging.getLogger("uvicorn.error")
_BASE = pathlib.Path(__file__).parent

# Load local .env for development before importing api_server.py config.
try:
    from dotenv import load_dotenv

    dotenv_path = _BASE / ".env"
    if dotenv_path.exists():
        load_dotenv(dotenv_path=dotenv_path, override=False)
        logger.info("env: loaded .env from project root")
except Exception as e:
    logger.warning(f"env: could not load .env: {e}")

# ─────────────────────────────────────────────
# STEP 0: Reconstitute large files from blobs
# ─────────────────────────────────────────────

def _write_if_newer(blob_module: str, target_path: pathlib.Path, label: str):
    """Load content from a blob module and write to disk if needed.

    Local edits are preserved when target file is newer than blob module file.
    """
    try:
        mod = __import__(blob_module)
        blob_path = pathlib.Path(getattr(mod, "__file__", ""))
        blob_mtime = blob_path.stat().st_mtime if blob_path.exists() else 0
        target_mtime = target_path.stat().st_mtime if target_path.exists() else 0
        if target_path.exists() and target_mtime > blob_mtime:
            logger.info(f"reconstitute: kept local {label} (newer than blob)")
            return

        content = mod.get_content()
        target_path.write_text(content, encoding="utf-8")
        logger.info(f"reconstitute: wrote {label} ({len(content)} bytes)")
    except Exception as e:
        logger.warning(f"reconstitute: could not write {label}: {e}")

# Reconstitution is now opt-in only.
# Default behavior uses repository source files directly so production
# reflects committed app/api changes instead of stale blob snapshots.
_ENABLE_BLOB_RECONSTITUTE = os.getenv("ENABLE_BLOB_RECONSTITUTE", "").strip().lower() in {"1", "true", "yes"}
if _ENABLE_BLOB_RECONSTITUTE:
    _write_if_newer("agent_tools_blob", _BASE / "agent_tools.py", "agent_tools.py")
    _write_if_newer("api_server_blob", _BASE / "api_server.py", "api_server.py")
    _write_if_newer("app_js_blob", _BASE / "static" / "app.js", "static/app.js")
else:
    logger.info("reconstitute: skipped blob restore (ENABLE_BLOB_RECONSTITUTE not enabled)")

# Force Python to re-discover reconstituted modules
if "agent_tools" in sys.modules:
    del sys.modules["agent_tools"]
if "api_server" in sys.modules:
    del sys.modules["api_server"]

# ─────────────────────────────────────────────
# STEP 1: Download and cache Lucide locally
# ─────────────────────────────────────────────

_LUCIDE_JS = None
_lucide_path = _BASE / "static" / "lucide.min.js"
if _lucide_path.exists():
    _LUCIDE_JS = _lucide_path.read_bytes()
    logger.info(f"lucide: loaded local copy ({len(_LUCIDE_JS)} bytes)")
else:
    try:
        import urllib.request
        url = "https://cdn.jsdelivr.net/npm/lucide@0.460.0/dist/umd/lucide.min.js"
        req = urllib.request.Request(url, headers={"User-Agent": "CroutonsAgents/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            _LUCIDE_JS = resp.read()
        _lucide_path.parent.mkdir(parents=True, exist_ok=True)
        _lucide_path.write_bytes(_LUCIDE_JS)
        logger.info(f"lucide: downloaded and cached ({len(_LUCIDE_JS)} bytes)")
    except Exception as e:
        logger.warning(f"lucide: could not download: {e}")

# ─────────────────────────────────────────────
# STEP 2: Patch app.js at import time
# ─────────────────────────────────────────────

_SAFE_CREATE = (
    '(function(){'
    'if(typeof lucide!=="undefined"&&lucide.createIcons){lucide.createIcons()}'
    'else{var _t=setInterval(function(){'
    'if(typeof lucide!=="undefined"&&lucide.createIcons){clearInterval(_t);lucide.createIcons()}'
    '},100);setTimeout(function(){clearInterval(_t)},5000)}'
    '})()'
)

_PATCHED_JS = None
_appjs = _BASE / "static" / "app.js"
if _appjs.exists():
    _c = _appjs.read_text(encoding="utf-8")
    _patches = 0

    # Patch 1: Wrap raw ${t.icon} in Lucide <i> tags for template cards
    _old_icon = '<div class="template-card-icon">${t.icon}</div>'
    _new_icon = '<div class="template-card-icon"><i data-lucide="${t.icon}" style="width:24px;height:24px"></i></div>'
    if _old_icon in _c:
        n = _c.count(_old_icon)
        _c = _c.replace(_old_icon, _new_icon)
        _patches += n
        logger.info(f"appjs_patches: wrapped {n} template-card-icon tags")

    # Patch 2a: Replace bare lucide.createIcons(); with safe version
    _bare = "lucide.createIcons();"
    if _bare in _c:
        n = _c.count(_bare)
        _c = _c.replace(_bare, _SAFE_CREATE + ";")
        _patches += n
        logger.info(f"appjs_patches: made {n} bare createIcons() calls safe")

    # Patch 2b: Replace lucide.createIcons({...}) with safe version
    _param_pattern = r'lucide\.createIcons\(\{([^}]+)\}\)'
    n = len(re.findall(_param_pattern, _c))
    if n:
        _c = re.sub(
            _param_pattern,
            r'(function(){if(typeof lucide!=="undefined"&&lucide.createIcons){lucide.createIcons({\1})}})() ',
            _c,
        )
        _patches += n
        logger.info(f"appjs_patches: made {n} parameterized createIcons() calls safe")

    # Patch 2c: Replace requestAnimationFrame(() => lucide.createIcons()) with safe version
    _raf_pattern = r'requestAnimationFrame\(\(\)\s*=>\s*lucide\.createIcons\(\)\)'
    n = len(re.findall(_raf_pattern, _c))
    if n:
        _c = re.sub(_raf_pattern, f'requestAnimationFrame(function(){{{_SAFE_CREATE}}})', _c)
        _patches += n
        logger.info(f"appjs_patches: made {n} rAF createIcons() calls safe")

    # Patch 3: avoid blank page if Supabase CDN fails to load
    _supabase_init = "supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);"
    _supabase_safe = (
        "if (!window.supabase || !window.supabase.createClient) {"
        "document.getElementById('app').innerHTML = "
        "'<div style=\"padding:2rem;text-align:center;\">"
        "<h2>Frontend dependency failed to load</h2>"
        "<p>Supabase SDK is unavailable. Check your network/CDN access and reload.</p>"
        "</div>';"
        "return;"
        "}"
        "supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);"
    )
    if _supabase_init in _c:
        _c = _c.replace(_supabase_init, _supabase_safe)
        _patches += 1
        logger.info("appjs_patches: added Supabase SDK guard")

    # Patch 4: show clear config error when /api/config is missing Supabase values
    _cfg_assign = (
        "SUPABASE_URL = cfg.supabase_url;\n"
        "      SUPABASE_ANON_KEY = cfg.supabase_anon_key;\n"
        "      STRIPE_PK = cfg.stripe_publishable_key || '';"
    )
    _cfg_safe = (
        "SUPABASE_URL = (cfg.supabase_url || '').trim();\n"
        "      SUPABASE_ANON_KEY = (cfg.supabase_anon_key || '').trim();\n"
        "      STRIPE_PK = cfg.stripe_publishable_key || '';\n"
        "      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {\n"
        "        document.getElementById('app').innerHTML = "
        "'<div style=\"padding:2rem;text-align:center;\">"
        "<h2>Missing local configuration</h2>"
        "<p>Set SUPABASE_URL and SUPABASE_ANON_KEY, then restart the server.</p>"
        "</div>';\n"
        "        return;\n"
        "      }"
    )
    if _cfg_assign in _c:
        _c = _c.replace(_cfg_assign, _cfg_safe)
        _patches += 1
        logger.info("appjs_patches: added config guard for Supabase values")

    _PATCHED_JS = _c
    logger.info(f"appjs_patches: total {_patches} patches applied ({len(_c)} bytes)")

# ─────────────────────────────────────────────
# STEP 3: Patch index.html at import time
# ─────────────────────────────────────────────

_PATCHED_HTML = None
_indexhtml = _BASE / "static" / "index.html"
if _indexhtml.exists():
    _h = _indexhtml.read_text(encoding="utf-8")
    # Only swap to local Lucide if we actually have bytes to serve.
    # If local download failed, keep CDN URL so the frontend can still boot.
    if _LUCIDE_JS:
        _h = _h.replace(
            '<script src="https://unpkg.com/lucide@latest"></script>',
            '<script src="/static/lucide.min.js"></script>',
        )
    _PATCHED_HTML = _h
    logger.info(
        "html_patches: %s",
        "switched Lucide to local serving" if _LUCIDE_JS else "kept Lucide CDN fallback",
    )

# ─────────────────────────────────────────────
# STEP 4: Import app and add middleware
# ─────────────────────────────────────────────

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response


class PatchMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        # Serve local Lucide
        if _LUCIDE_JS and path == "/static/lucide.min.js":
            return Response(
                content=_LUCIDE_JS,
                media_type="application/javascript",
                headers={"Cache-Control": "public, max-age=86400"},
            )
        # Intercept app.js
        if _PATCHED_JS and path == "/static/app.js":
            return Response(
                content=_PATCHED_JS,
                media_type="application/javascript",
                headers={"Cache-Control": "no-cache, must-revalidate"},
            )
        # Intercept index.html (root or explicit)
        if _PATCHED_HTML and path in ("/", "/index.html"):
            return Response(
                content=_PATCHED_HTML,
                media_type="text/html",
                headers={"Cache-Control": "no-cache, must-revalidate"},
            )
        response = await call_next(request)
        # Also intercept SPA catch-all responses that serve index.html
        if _PATCHED_HTML and not path.startswith("/api/") and not path.startswith("/static/"):
            ct = response.headers.get("content-type", "")
            if "text/html" in ct:
                return Response(
                    content=_PATCHED_HTML,
                    media_type="text/html",
                    headers={"Cache-Control": "no-cache, must-revalidate"},
                )
        return response


from api_server import app

# Fix AI Search Optimizer icon: strip HTML tags, keep just the icon name
try:
    import api_server
    for t_list_name in dir(api_server):
        obj = getattr(api_server, t_list_name)
        if isinstance(obj, list):
            for item in obj:
                if isinstance(item, dict) and item.get("name") == "AI Search Optimizer":
                    icon_val = item.get("icon", "")
                    match = re.search(r'data-lucide="([^"]+)"', icon_val)
                    if match:
                        item["icon"] = match.group(1)
                        logger.info(f"Fixed AI Search Optimizer icon to: {item['icon']}")
except Exception as e:
    logger.warning(f"Could not fix template icons: {e}")

app.add_middleware(PatchMiddleware)
