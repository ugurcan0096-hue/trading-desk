"""Build the CrazyGames upload as ONE file: index.html with all game code inside.

CrazyGames does not accept zip archives, and uploading folders from a phone is awkward,
so everything (i18n, platform adapter, game) is inlined. The CrazyGames SDK stays external.
No service worker, manifest, icons or install prompt (the portal hosts the game).
Usage: python3 build-crazygames.py OUTPUT_DIR   -> OUTPUT_DIR/crazygames/index.html
"""
import os, re, sys

here = os.path.dirname(os.path.abspath(__file__))
out_dir = os.path.join(sys.argv[1] if len(sys.argv) > 1 else here, "crazygames")
os.makedirs(out_dir, exist_ok=True)
html = open(os.path.join(here, "index.html"), encoding="utf-8").read()

def inline(name):
    code = open(os.path.join(here, name), encoding="utf-8").read()
    assert "</script" not in code.lower(), name
    return "<script>\n" + code + "\n</script>"

# drop PWA bits
html = html.replace('  <link rel="manifest" href="manifest.json">\n', "", 1)
html = re.sub(r'  <link rel="(icon|apple-touch-icon)"[^>]*>\n', "", html)
start = html.index('  <script>\n    if ("serviceWorker" in navigator')
end = html.index("</script>", start) + len("</script>\n")
html = html[:start] + html[end:]

# inline the game scripts, SDK first
sdk = '<script>window.__FORCE_DEFAULT_EN = true;</script>\n  <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>\n  '
for name in ["i18n.js", "platform.js", "game.js"]:
    m = re.search(r'<script src="' + re.escape(name) + r'\?v=\d+"></script>', html)
    assert m, name
    html = html[:m.start()] + (sdk if name == "i18n.js" else "") + inline(name) + html[m.end():]

assert "serviceWorker" not in html and "manifest.json" not in html and 'src="game.js' not in html
path = os.path.join(out_dir, "index.html")
open(path, "w", encoding="utf-8").write(html)
print(path, len(html.encode("utf-8")), "bytes")
