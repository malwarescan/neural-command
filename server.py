"""Middleware to patch app.js, index.html, and serve Lucide locally.
Self-contained, no api_server.py changes needed.
Import via Procfile: uvicorn server:app"""
import pathlib, logging, re
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

logger = logging.getLogger("uvicorn.error")

_BASE = pathlib.Path(__file__).parent

# ── Safe Lucide wrapper: retries every 100ms for 5s if lucide not loaded yet ──
_SAFE_CREATE = (
    '(function(){'
    'if(typeof lucide!=="undefined"&&lucide.createIcons){lucide.createIcons()}'
    'else{var _t=setInterval(function(){'
    'if(typeof lucide!=="undefined"&&lucide.createIcons){clearInterval(_t);lucide.createIcons()}'
    '},100);setTimeout(function(){clearInterval(_t)},5000)}'
    '})()'
)

# ── Load Lucide from local file if available ──
_LUCIDE_JS = None
_lucide_path = _BASE / "static" / "lucide.min.js"
if _lucide_path.exists():
    _LUCIDE_JS = _lucide_path.read_bytes()
    logger.info(f"lucide: loaded local copy ({len(_LUCIDE_JS)} bytes)")
else:
    # Download at startup if not present
    try:
        import urllib.request
        url = "https://cdn.jsdelivr.net/npm/lucide@0.460.0/dist/umd/lucide.min.js"
        req = urllib.request.Request(url, headers={"User-Agent": "CroutonsAgents/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            _LUCIDE_JS = resp.read()
        _lucide_path.write_bytes(_LUCIDE_JS)
        logger.info(f"lucide: downloaded and cached ({len(_LUCIDE_JS)} bytes)")
    except Exception as e:
        logger.warning(f"lucide: could not download: {e}")

# ── Patch app.js at import time ──
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

    _PATCHED_JS = _c
    logger.info(f"appjs_patches: total {_patches} patches applied ({len(_c)} bytes)")

# ── Patch index.html at import time ──
_PATCHED_HTML = None
_indexhtml = _BASE / "static" / "index.html"
if _indexhtml.exists():
    _h = _indexhtml.read_text(encoding="utf-8")

    # Replace CDN Lucide with local copy served by middleware
    _h = _h.replace(
        '<script src="https://unpkg.com/lucide@latest"></script>',
        '<script src="/static/lucide.min.js"></script>',
    )

    _PATCHED_HTML = _h
    logger.info("html_patches: switched Lucide to local serving")


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


# Import the real app and patch template data
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
