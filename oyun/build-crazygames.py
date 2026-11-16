"""Build the CrazyGames upload: yorunge-crazygames.zip

Same game, plus the CrazyGames SDK; no service worker, manifest or install prompt
(portals host the files themselves). Usage: python3 build-crazygames.py OUTPUT_DIR
"""
import os, sys, zipfile

here = os.path.dirname(os.path.abspath(__file__))
out_dir = sys.argv[1] if len(sys.argv) > 1 else here
html = open(os.path.join(here, "index.html"), encoding="utf-8").read()

sdk = '<script>window.__FORCE_DEFAULT_EN = true;</script>\n  <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>\n  '
assert '<script src="i18n.js' in html
html = html.replace('<script src="i18n.js', sdk + '<script src="i18n.js', 1)
html = html.replace('  <link rel="manifest" href="manifest.json">\n', '', 1)
start = html.index('  <script>\n    if ("serviceWorker" in navigator')
end = html.index('</script>', start) + len('</script>\n')
html = html[:start] + html[end:]
assert "serviceWorker" not in html and "manifest.json" not in html

path = os.path.join(out_dir, "orbit-dash-crazygames.zip")
with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("index.html", html)
    for f in ["game.js", "platform.js", "i18n.js"]:
        z.write(os.path.join(here, f), f)
    for f in sorted(os.listdir(os.path.join(here, "icons"))):
        z.write(os.path.join(here, "icons", f), "icons/" + f)
print(path)
