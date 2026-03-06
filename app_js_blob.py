import base64, zlib

from app_js_blob_p1 import PART as P1
from app_js_blob_p2 import PART as P2
from app_js_blob_p3 import PART as P3

def get_content():
    return zlib.decompress(base64.b64decode(P1 + P2 + P3)).decode("utf-8")
