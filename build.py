"""Ensambla la app: src/app.html + src/*.js -> build/oficina.html (artifact) y public/index.html (PWA)."""
import pathlib
root = pathlib.Path(__file__).parent
src = root / "src"
page = (src / "app.html").read_text()
page = page.replace("/*__DATA__*/", "/*__DATA__*/\n/*__EXPERT__*/\n/*__STACK__*/\n/*__CANON__*/\n/*__TALLER__*/")
for name, ph in (("data.js", "/*__DATA__*/"), ("expert.js", "/*__EXPERT__*/"), ("stack.js", "/*__STACK__*/"), ("canon.js", "/*__CANON__*/"), ("taller.js", "/*__TALLER__*/"), ("office.js", "/*__OFFICE__*/"), ("app.js", "/*__APP__*/"), ("work.js", "/*__WORK__*/"), ("projects.js", "/*__PROJECTS__*/")):
    page = page.replace(ph, (src / name).read_text())
(root / "build").mkdir(exist_ok=True)
(root / "build/oficina.html").write_text(page)
head = """<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#f6f5f1"><link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="icon.svg">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>
"""
tail = """
<script>if(!window.claude&&"serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});</script>
</body></html>
"""
(root / "public/index.html").write_text(head + page + tail)
print("build/oficina.html y public/index.html generados")
