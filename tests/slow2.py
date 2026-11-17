src=open('loader_test.py').read().split('fails = 0')[0].replace('time.sleep(8)','time.sleep(MODE.get("delay",8))')
exec(src)
from playwright.sync_api import sync_playwright
fails=0
def check(n,c,i=""):
    global fails; print(("OK   " if c else "FAIL ")+n+("  → "+str(i) if i else "")); fails+=0 if c else 1
def edit(rel, fn):
    p = os.path.join(ROOT, rel); s = open(p, encoding="utf-8").read(); open(p, "w", encoding="utf-8").write(fn(s))
with sync_playwright() as p:
    shutil.rmtree("/tmp/fc-slow", ignore_errors=True)
    ctx=p.chromium.launch_persistent_context("/tmp/fc-slow",executable_path="/usr/bin/google-chrome",viewport={"width":390,"height":844})
    def start(wait=6000):
        pg=ctx.new_page(); pg.goto(URL,wait_until="commit"); pg.wait_for_timeout(wait)
        r=pg.evaluate("({ver:window.__ver||'alt',markup:!!document.getElementById('neu-markup')})"); pg.close(); return r
    start(1500)
    # A) nur Modul geändert, Netz dauerhaft langsam (3 s je Antwort)
    edit("app/cockpit.js", lambda s: s+'\nwindow.__ver="B";\n')
    MODE["hang"]=True; MODE["delay"]=3
    r=[start()["ver"] for _ in range(3)]
    check("A Langsames Netz, nur Modul neu: ab dem 2. Start die neue Fassung", r==["alt","B","B"], r)
    # B) Modul + index.html geändert, Netz langsam: neuer Code darf nicht mit altem Markup laufen
    edit("app/cockpit.js", lambda s: s+'\nwindow.__ver="C";\n')
    edit("app/index.html", lambda s: s.replace('content="2026-11-17 22:00"','content="TEST-C"').replace('<p class="foot" id="app-version"></p>','<p class="foot" id="app-version"></p><p id="neu-markup"></p>'))
    r=[start() for _ in range(3)]
    passt=all((x["ver"]=="B" and not x["markup"]) or (x["ver"]=="C" and x["markup"]) for x in r)
    check("B Langsames Netz, Modul + index.html neu: Markup und Modul nie gemischt", passt, r)
    check("B … spätestens beim 3. langsamen Start ist die neue Fassung komplett da", r[-1]=={"ver":"C","markup":True}, r)
    MODE["hang"]=False
    x=start(2500)
    check("B Danach normales Netz: neues Markup und neues Modul zusammen", x["ver"]=="C" and x["markup"], x)
    ctx.close()
srv.shutdown()
print("FEHLER:",fails)
