"""Genera public/index.html (PWA independiente) a partir de src/app.html."""
import pathlib
root = pathlib.Path(__file__).parent
app = (root / "src/app.html").read_text()
head = """<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#2f45e0"><link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="icon.svg">
<meta name="apple-mobile-web-app-capable" content="yes">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>
"""
tail = """
<script>if(!window.claude&&"serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});</script>
</body></html>
"""
(root / "public/index.html").write_text(head + app + tail)
print("public/index.html generado")
