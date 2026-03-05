"""Middleware to patch app.js responses. Self-contained, no api_server.py changes needed.
Import via Procfile: uvicorn server:app"""
import pathlib, logging, re
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

logger = logging.getLogger("uvicorn.error")

# Load and patch app.js at import time
_PATCHED = None
_appjs = pathlib.Path(__file__).parent / "static" / "app.js"
if _appjs.exists():
    _c = _appjs.read_text(encoding="utf-8")
    _old = '<div class="template-card-icon">${t.icon}</div>'
    _new = '<div class="template-card-icon"><i data-lucide="${t.icon}" style="width:24px;height:24px"></i></div>'
    if _old in _c:
        _c = _c.replace(_old, _new)
    _PATCHED = _c
    logger.info(f"appjs_patches: loaded ({len(_c)} bytes)")


class AppJSPatchMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if _PATCHED and request.url.path == "/static/app.js":
            return Response(content=_PATCHED, media_type="application/javascript",
                          headers={"Cache-Control": "public, max-age=3600"})
        response = await call_next(request)
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

app.add_middleware(AppJSPatchMiddleware)
