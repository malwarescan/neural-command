import base64, zlib

from agent_tools_blob_p1 import PART as P1

def get_content():
    return zlib.decompress(base64.b64decode(P1)).decode("utf-8")
