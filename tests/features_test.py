import base64, json, sys, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

exec(open("/home/claude/tests/scroll_test.py").read().split("def route(r):")[0].split("APP =")[1].split("\n", 1)[1])  # rules/snap/... laden

class H(SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory="/home/claude/finance-cockpit", **k)
    def log_message(s, *a): pass
srv = ThreadingHTTPServer(("127.0.0.1", 8766), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://127.0.0.1:8766/app/"

PUTS, CONF = [], {"n": 0}
REMOTE = {"state": {"puffer": {"wert": 14000, "geaendert": "2026-11-10"}}, "sha": "s1"}

def route(r):
    url, req = r.request.url, r.request
    if "api.github.com" in url:
        name = url.rsplit("/", 1)[-1]
        if req.method == "PUT":
            body = json.loads(req.post_data); body["decoded"] = json.loads(base64.b64decode(body["content"]))
            PUTS.append(body)
            if CONF["n"] > 0:
                CONF["n"] -= 1
                # Zwischenzeitlich hat jemand anderes state.json geändert
                REMOTE["state"] = dict(REMOTE["state"], gemeinschaftskonto={"wert": 999}); REMOTE["sha"] = "s2"
                return r.fulfill(status=409, body="{}")
            REMOTE["state"] = body["decoded"]; REMOTE["sha"] = "s3"
            return r.fulfill(status=200, content_type="application/json", body=json.dumps({"content": {"sha": "s3"}}))
        data = REMOTE["state"] if name == "state.json" else FILES[name]
        sha = REMOTE["sha"] if name == "state.json" else "x"
        return r.fulfill(status=200, content_type="application/json",
                         body=json.dumps({"content": base64.b64encode(json.dumps(data).encode()).decode(), "sha": sha}))
    if url.startswith("http://127.0.0.1"): return r.continue_()
    return r.abort()

fails = 0
def check(name, cond, info=""):
    global fails
    print(("OK   " if cond else "FAIL ") + name + ("  " + str(info) if info else "")); fails += 0 if cond else 1

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin="http://127.0.0.1:8766")
    ctx.add_init_script("if(!sessionStorage.getItem('init')){sessionStorage.setItem('init','1');localStorage.setItem('fc-sync', JSON.stringify({owner:'o',repo:'r',token:'t'}));localStorage.setItem('fc-tab','g-status')}")
    ctx.route("**/*", route)

    def open_app(pg, tab=None, clock=None):
        pg.goto("about:blank")
        if tab: pg.evaluate(f"0")  # nichts
        if clock: pg.clock.install(time=clock)
        pg.goto(URL); pg.wait_for_function("document.querySelector('#p-rules .body') && document.querySelector('#p-rules .body').innerHTML.length>0")
        pg.wait_for_timeout(300)
    def cur(pg): return pg.evaluate("document.querySelector('.jump a.on').textContent")
    def tab(pg, l): pg.click(f".jump a:text-is('{l}')"); pg.wait_for_timeout(200)
    def back(pg):
        pg.go_back(wait_until="commit", timeout=3000); pg.wait_for_timeout(250)

    # ── 1. Datum in Ortszeit ──
    cctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    cctx.add_init_script("localStorage.setItem('fc-sync', JSON.stringify({owner:'o',repo:'r',token:'t'}))"); cctx.route("**/*", route)
    pg = cctx.new_page(); open_app(pg, clock="2026-11-18T00:30:00+01:00")
    tab(pg, "Liquidität & Sparen"); pg.fill("#puffer", "15000"); pg.click("#puffer-save"); pg.wait_for_timeout(500)
    d = PUTS[-1]["decoded"]["puffer"]["geaendert"]
    check("Datum: 00:30 Uhr am 18.11. wird als 18.11. gespeichert (UTC wäre 17.11.)", d == "2026-11-18", d)
    pg.close(); cctx.close()

    # ── 4. Konflikt beim Speichern ──
    PUTS.clear(); pg = ctx.new_page(); open_app(pg)
    tab(pg, "Liquidität & Sparen"); CONF["n"] = 1
    pg.fill("#puffer", "16000"); pg.click("#puffer-save"); pg.wait_for_timeout(700)
    msg = pg.text_content("#puffer-msg"); last = PUTS[-1]
    check("Konflikt: einmal automatisch wiederholt", len(PUTS) == 2 and msg == "Gespeichert", f"{len(PUTS)} PUTs, '{msg}'")
    check("Konflikt: zweiter Versuch mit frischer sha", last.get("sha") == "s2", last.get("sha"))
    check("Konflikt: fremde Änderung bleibt erhalten, Puffer neu", last["decoded"].get("gemeinschaftskonto") == {"wert": 999} and last["decoded"]["puffer"]["wert"] == 16000)
    PUTS.clear(); CONF["n"] = 2
    pg.fill("#puffer", "17000"); pg.click("#puffer-save"); pg.wait_for_timeout(700)
    msg = pg.text_content("#puffer-msg")
    check("Doppelter Konflikt: nach 2 Versuchen Meldung statt Schleife", len(PUTS) == 2 and "geändert" in msg, f"{len(PUTS)} PUTs, '{msg}'")
    CONF["n"] = 0; pg.close()

    # ── 2. Android-Zurück ──
    pg = ctx.new_page(); open_app(pg)
    tab(pg, "Vermögen"); tab(pg, "Liquidität & Sparen"); tab(pg, "Positionen")
    seq = []
    for _ in range(3): back(pg); seq.append(cur(pg))
    check("Zurück: Positionen → Liquidität → Vermögen → Status", seq == ["Liquidität & Sparen", "Vermögen", "Status"], seq)
    back(pg); check("Zurück auf Status verlässt die App", pg.url == "about:blank", pg.url)
    pg.close()

    pg = ctx.new_page(); open_app(pg)
    tab(pg, "Vermögen"); tab(pg, "Liquidität & Sparen"); tab(pg, "Vermögen"); back(pg)
    check("Kein Endlos-Stapel: Status→Verm→Liq→Verm, Zurück → Status", cur(pg) == "Status", cur(pg))
    # Kachel (Status → Panel in anderem Reiter)
    pg.click("#status a.chip[href='#p-alloc']"); pg.wait_for_timeout(250); back(pg)
    check("Status-Kachel: Zurück führt zu Status", cur(pg) == "Status", cur(pg))
    pg.close()

    # Wischen
    pg = ctx.new_page(); open_app(pg); tab(pg, "Vermögen")
    pg.evaluate("""()=>{const el=document.querySelector('.group:not([hidden]) .ghead');
      const T=(x)=>new Touch({identifier:1,target:el,clientX:x,clientY:300});
      const f=(type,x)=>el.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'?[]:[T(x)],changedTouches:[T(x)]}));
      f('touchstart',300);for(let i=1;i<=6;i++)f('touchmove',300-250*i/6);f('touchend',50)}"""); pg.wait_for_timeout(500)
    a = cur(pg); back(pg)
    check("Wischen erzeugt Eintrag: Liquidität, Zurück → Vermögen", a.startswith("Liquid") and cur(pg) == "Vermögen", f"{a} → {cur(pg)}")
    # Kopf bleibt bei Zurück weg
    tab(pg, "Positionen"); pg.evaluate("window.scrollTo({top:500,behavior:'instant'})"); pg.wait_for_timeout(100); back(pg)
    s = pg.evaluate("({hb:Math.round(document.querySelector('.wrap>header').getBoundingClientRect().bottom),nt:Math.round(document.querySelector('.jump').getBoundingClientRect().top)})")
    check("Zurück mit weggescrolltem Kopf: Kopf bleibt weg", cur(pg) == "Vermögen" and s["hb"] <= 0 and s["nt"] == 0, s)
    pg.close()

    # Gemerkter Reiter beim Start, erster Eintrag erst bei Berührung
    pg = ctx.new_page(); pg.goto("about:blank"); pg.goto(URL); pg.wait_for_timeout(600)
    pg.evaluate("localStorage.setItem('fc-tab','g-positionen')"); pg.goto("about:blank"); pg.goto(URL); pg.wait_for_timeout(600)
    hl0 = pg.evaluate("history.length"); start = cur(pg)
    pg.click(".wrap h1"); pg.wait_for_timeout(200); hl1 = pg.evaluate("history.length")
    back(pg)
    check("Start in gemerktem Reiter: Eintrag erst bei Berührung, Zurück → Status", start == "Positionen" and hl1 == hl0 + 1 and cur(pg) == "Status", f"{start}, history {hl0}→{hl1}, dann {cur(pg)}")
    pg.evaluate("localStorage.setItem('fc-tab','g-status')"); pg.close()

    # Verbindung-Formular als Ebene (Knopf nur im Status-Reiter)
    pg = ctx.new_page(); open_app(pg); tab(pg, "Vermögen"); tab(pg, "Status"); pg.click("#cfg-btn"); pg.wait_for_timeout(200)
    vis = pg.is_visible("#setup"); back(pg)
    check("Verbindung offen: Zurück schließt nur das Formular", vis and not pg.is_visible("#setup") and cur(pg) == "Status" and pg.url.startswith(URL), cur(pg))
    back(pg); check("… nächstes Zurück verlässt die App", pg.url == "about:blank", pg.url)
    pg.close()
    pg = ctx.new_page(); open_app(pg); pg.click("#cfg-btn"); pg.wait_for_timeout(150); pg.click("#cfg-cancel"); pg.wait_for_timeout(250)
    tab(pg, "Termine"); back(pg)
    check("Formular per Abbrechen geschlossen: kein verwaister Eintrag (Termine → Zurück → Status)", cur(pg) == "Status" and not pg.is_visible("#setup") and pg.url.startswith(URL), cur(pg))
    back(pg); check("… dann verlässt Zurück die App", pg.url == "about:blank", pg.url)
    pg.close()

    # ── 3. Diagnose ──
    pg = ctx.new_page(); open_app(pg); pg.evaluate("localStorage.removeItem('fc-err')"); pg.reload(); pg.wait_for_timeout(800)
    s0 = pg.text_content("#diag summary")
    pg.evaluate("setTimeout(()=>{throw new Error('Testfehler')},0); Promise.reject(new Error('Testablehnung')); var s=document.createElement('script'); s.src='fehlt.js'; document.body.appendChild(s);")
    pg.wait_for_timeout(500); s1 = pg.text_content("#diag summary")
    check("Diagnose: Fehler erfasst (Exception, Promise, fehlende Datei)", s0 == "Diagnose · Fehler: keine" and s1 == "Diagnose · Fehler: 3", f"{s0} → {s1}")
    pg.click("#diag summary"); pg.click("#diag button[data-diag=copy]"); pg.wait_for_timeout(200)
    clip = pg.evaluate("navigator.clipboard.readText()")
    check("Diagnose: Kopieren", "Testfehler" in clip and "fehlt.js" in clip and "Testablehnung" in clip, clip.replace("\n", " | "))
    stor = pg.text_content("#diag dl")
    check("Diagnose: Speicherstatus und Belegung angezeigt", "Speicher" in stor and "Cockpit" in stor, stor)
    pg.screenshot(path="/home/claude/tests/diag.png", full_page=True)
    pg.click("#diag button[data-diag=clear]"); pg.wait_for_timeout(150)
    check("Diagnose: Leeren", pg.text_content("#diag summary") == "Diagnose · Fehler: keine")
    # Fehler im Modul selbst (vom Loader ausgeführt) mit Dateiname
    pg.evaluate("var s=document.createElement('script');s.text='null.x\\n//# sourceURL='+location.origin+'/app/testmodul.js';document.body.appendChild(s)")
    pg.wait_for_timeout(200); e = pg.evaluate("fcDiag.read().pop()")
    check("Diagnose: Fehler aus vom Loader ausgeführtem Modul mit Dateiname", e["s"].startswith("testmodul.js:"), e)
    errs = []; pg.on("pageerror", lambda x: errs.append(str(x)))
    pg.close()
    b.close()
srv.shutdown()
print("FEHLER:", fails); sys.exit(1 if fails else 0)
