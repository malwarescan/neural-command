import base64, zlib

_COMPRESSED = "eNrsvel620iSKPrfT5GldhfJNklRmy1LZftQ...SBw=="

def get_app_js():
    return zlib.decompress(base64.b64decode(_COMPRESSED)).decode("utf-8")
