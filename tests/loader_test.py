"""Loader-Test: Server wie GitHub Pages (Cache-Control max-age=600, ETag, 304)."""
import re, hashlib, os, shutil, sys, threading, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

SRC = "/home/claude/finance-cockpit"
ROOT = "/home/claude/srv"
shutil.rmtree(ROOT, ignore_errors=True)
shutil.copytree(SRC, ROOT, ignore=shutil.ignore_patterns(".git"))
LOG, MODE = [], {"hang": False}

class H(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def __init__(s, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(s, *a): pass
    def do_GET(s):
        if MODE.get("dbg"): print("   REQ", s.path, s.headers.get("If-None-Match"), s.headers.get("Cache-Control"), s.headers.get("Pragma"))
        if MODE["hang"]:
            time.sleep(8)
        path = s.path.split("?")[0]
        lp = s.path if "vc=" in s.path else path
        fp = s.translate_path(path)
        if os.path.isdir(fp): fp = os.path.join(fp, "index.html")
        if not os.path.exists(fp):
            s.send_response(404); s.end_headers(); return
        data = open(fp, "rb").read()
        etag = '"' + hashlib.md5(data).hexdigest() + '"'
        if s.headers.get("If-None-Match") == etag:
            LOG.append((lp, 304)); s.send_response(304); s.send_header("ETag", etag)
            s.send_header("Cache-Control", "max-age=600"); s.end_headers(); return
        LOG.append((lp, 200)); s.send_response(200)
        ctype = "text/html" if fp.endswith(".html") else "application/javascript" if fp.endswith(".js") else "application/octet-stream"
        s.send_header("Content-Type", ctype + "; charset=utf-8"); s.send_header("ETag", etag)
        s.send_header("Cache-Control", "max-age=600"); s.send_header("Content-Length", str(len(data))); s.end_headers()
        s.wfile.write(data)

srv = ThreadingHTTPServer(("127.0.0.1", 8765), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://127.0.0.1:8765/app/"

fails = 0
def check(name, cond, info=""):
    global fails
    print(("OK   " if cond else "FAIL ") + name + ("  " + str(info) if info else ""))
    if not cond: fails += 1

def edit(rel, fn):
    p = os.path.join(ROOT, rel); s = open(p, encoding="utf-8").read(); open(p, "w", encoding="utf-8").write(fn(s))

with sync_playwright() as p:
    shutil.rmtree("/tmp/fc-profil", ignore_errors=True)
    ctx = p.chromium.launch_persistent_context("/tmp/fc-profil", executable_path="/usr/bin/google-chrome",
                          args=["--host-resolver-rules=MAP fonts.googleapis.com 127.0.0.1:9, MAP fonts.gstatic.com 127.0.0.1:9"],
                          viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    b = ctx

    def start(label, timeout=15000, open_s=0):
        """Ein App-Start: neue Seite, warten bis cockpit.js gelaufen ist."""
        LOG.clear(); pg = ctx.new_page(); navs = []
        pg.on("domcontentloaded", lambda _: navs.append(1))   # echte Ladevorgänge; replaceState/pushState zählen nicht
        t0 = time.time(); pg.goto(URL, wait_until="commit")
        pg.wait_for_function("(document.getElementById('fresh')||{}).textContent==='Nicht verbunden'", timeout=timeout)
        dt = time.time() - t0
        info = pg.evaluate("({ver:window.__ver||null, markup:!!document.getElementById('neu-markup'), build:document.querySelector('meta[name=app-build]').content, scripts:[...document.scripts].map(s=>s.src?s.src.split('/').pop():(s.text.match(/sourceURL=\\S*\\/([^\\/\\s]+)\\s*$/)||[])[1]).filter(Boolean)})")
        info.update(dt=round(dt, 2), navs=len(navs), log=list(LOG))
        print(f"  [{label}] {info}")
        if open_s: pg.wait_for_timeout(open_s * 1000)
        pg.close(); return info

    a = start("Erststart")
    check("Erststart: Module in Reihenfolge geladen", a["scripts"] == ["scrub.js", "cockpit.js"])
    check("Erststart: kein Neuladen", a["navs"] == 1)

    # Zweiter Start ohne Änderung: alles 304, keine Vollübertragung
    c = start("Start ohne Änderung")
    check("Ohne Änderung: Module nur per 304 abgeglichen", all(code == 304 for path, code in c["log"] if "vc=" not in path) and len(c["log"]) > 0, [x for x in c["log"] if x[1] != 304 and "vc=" not in x[0]])

    # 1) Geändertes Modul innerhalb der 10 min Cache-Zeit
    edit("app/cockpit.js", lambda s: s + '\nwindow.__ver="B";\n')
    d = start("cockpit.js geändert")
    check("Geändertes Modul: neue Fassung wird ausgeführt", d["ver"] == "B")
    check("Geändertes Modul: kein Neuladen nötig", d["navs"] == 1)
    check("Geändertes Modul: nur cockpit.js neu übertragen", ("/app/cockpit.js", 200) in d["log"] and ("/app/scrub.js", 304) in d["log"])

    # Kontrolle: ohne Loader (einfacher Abruf aus dem Cache) wäre es die alte Fassung
    edit("app/scrub.js", lambda s: s + "\n/*C*/\n")
    pg = ctx.new_page(); pg.goto("http://127.0.0.1:8765/app/", wait_until="commit")
    stale = pg.evaluate("fetch('/app/scrub.js').then(r=>r.text()).then(t=>!t.includes('/*C*/'))"); pg.close()
    check("Kontrolle: normaler Cache-Abruf liefert noch die alte Fassung (Problem ist echt)", stale)

    # 2) index.html geändert (Markup + Build): einmal neu laden, dann neues Markup
    edit("app/index.html", lambda s: re.sub(r'<meta name="app-build" content="[^"]+">', '<meta name="app-build" content="TEST-2">', s)
         .replace('<p class="foot" id="app-version"></p>', '<p class="foot" id="app-version"></p><p id="neu-markup"></p>'))
    e = start("index.html geändert")
    check("index.html geändert: einmal neu geladen, neues Markup da", e["navs"] == 2 and e["markup"] and e["build"] == "TEST-2")
    f = start("Folgestart")
    check("Folgestart: kein weiteres Neuladen", f["navs"] == 1 and f["markup"])

    # 3) Netz hängt (keine Antwort): Start aus dem Cache nach ~2,5 s
    MODE["hang"] = True
    g = start("Netz hängt", open_s=7)
    check("Netz hängt: App startet nach ca. 2,5 s", 2.3 <= g["dt"] <= 4.0, f"{g['dt']} s")
    MODE["hang"] = False
    time.sleep(1)

    # 4) Offline (Verbindung weg): Fetch scheitert sofort, Start aus dem Cache
    ctx.set_offline(True)
    try:
        h = start("offline")
        check("Offline: App startet aus dem Cache", h["scripts"] == ["scrub.js", "cockpit.js"], f"{h['dt']} s")
    except Exception as ex:
        check("Offline: App startet aus dem Cache", False, str(ex)[:200])
    ctx.set_offline(False)
    b.close()
srv.shutdown()
print("FEHLER:", fails); sys.exit(1 if fails else 0)
