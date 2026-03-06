import base64, zlib

from api_server_blob_p1 import PART as P1
from api_server_blob_p2 import PART as P2

def get_content():
    return zlib.decompress(base64.b64decode(P1 + P2)).decode("utf-8")
