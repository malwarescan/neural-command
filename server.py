"""Middleware to patch app.js responses. Self-contained, no api_server.py changes needed.
Import via Procfile: uvicorn server:app"""
import pathlib, logging
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

logger = logging.getLogger("uvicorn.error")

# Load and patch at import time
_PATCHED = None
_appjs = pathlib.Path(__file__).parent / "static" / "app.js"
if _appjs.exists():
    _c = _appjs.read_text(encoding="utf-8")
    _old = '<div class="template-card-icon">${t.icon}</div>'
    _new = '<div class="template-card-icon"><i data-lucide="${t.icon}" style="width:24px;height:24px"></i></div>'
    if _old in _c:
        _c = _c.replace(_old, _new)
    _wo = '      </div>`;\n\n    el.querySelectorAll(\'.template-card\').forEach(card => {'
    _wn = '      </div>`;\n\n    lucide.createIcons();\n\n    el.querySelectorAll(\'.template-card\').forEach(card => {'
    if _wo in _c:
        _c = _c.replace(_wo, _wn, 1)
    _PATCHED = _c
    logger.info(f"appjs_patches: loaded ({len(_c)} bytes)")


class AppJSPatchMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if _PATCHED and request.url.path == "/static/app.js":
            return Response(content=_PATCHED, media_type="application/javascript",
                          headers={"Cache-Control": "public, max-age=3600"})
        return await call_next(request)


# Import the real app and add middleware
from api_server import app
app.add_middleware(AppJSPatchMiddleware)
