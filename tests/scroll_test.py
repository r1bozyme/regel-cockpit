import base64, json, sys
from playwright.sync_api import sync_playwright

APP = "file:///home/claude/finance-cockpit/app/index.html"

rules = {
    "stand": "2026-11-01", "etf": ["W", "EM"], "kryptoIsin": [],
    "nio": {"isin": "NIO", "upsideUsd": 6.32,
            "stufe0": {"triggerUsd": 4.38, "z0Datum": "2026-12-15", "stueck": 3708, "status": "terminiert"},
            "stufen": [{"eur": 7, "name": "Stufe 1"}, {"eur": 10, "name": "Stufe 2"}, {"eur": 15, "name": "Stufe 3"}],
            "schaetzung2030Usd": {"bear": 1.5, "base": 3.5, "bull": 11}, "kill": ["K1", "K3"]},
    "baba": {"isin": "BABA", "stufen": [{"eur": 125, "name": "T1"}, {"eur": 160, "name": "T2"}, {"eur": 200, "name": "T3"}]},
    "grab": {"isin": "GRAB"}, "chinaAdrMax": 0.3,
    "liquiditaet": {"pufferMin": 12000, "regel": "Regel"},
    "zielpfad": {"rendite": 0.07, "startDatum": "2026-08-20", "startWert": 150000, "sparrate": 1540},
    "sollSparrate": {"Oktober 2026": 1540, "November 2026": 1540},
    "termine": [{"name": "Z0", "datum": "2026-12-15"}, {"name": "Z1", "datum": "2028-03-31"}],
}
snap = {"stand": "2026-11-17T18:00:00Z", "fxUsdJeEur": 1.15,
        "positionen": [{"id": "W", "wertEur": 100000, "kursEur": 100, "stueck": 1000},
                       {"id": "EM", "wertEur": 20000, "kursEur": 30, "stueck": 600},
                       {"id": "NIO", "wertEur": 50000, "kursEur": 4.5, "stueck": 15000},
                       {"id": "BABA", "wertEur": 15000, "kursEur": 110, "stueck": 140},
                       {"id": "GRAB", "wertEur": 5000, "kursEur": 4, "stueck": 1200}],
        "sparplan": [{"monat": m, "ueberschuss": 1800, "sparquote": 30, "investiert": 1500, "netto": 5000}
                     for m in ["Juli 2026", "August 2026", "September 2026", "Oktober 2026"]]}
weekly = {"nio": [{"datum": "2026-11-07", "closeUsd": 5.1}, {"datum": "2026-11-14", "closeUsd": 5.2}]}
state = {"puffer": {"wert": 14000, "geaendert": "2026-11-10"}}
FILES = {"rules.json": rules, "snapshot.json": snap, "weekly.json": weekly, "state.json": state}

def route(r):
    url = r.request.url
    if "api.github.com" in url:
        name = url.rsplit("/", 1)[-1]
        body = {"content": base64.b64encode(json.dumps(FILES[name]).encode()).decode(), "sha": "x"}
        return r.fulfill(status=200, content_type="application/json", body=json.dumps(body))
    if url.startswith("file://"):
        return r.continue_()
    return r.abort()

fails = 0
def check(name, cond, info):
    global fails
    print(("OK   " if cond else "FAIL ") + name + "  " + info)
    if not cond: fails += 1

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    ctx.add_init_script("localStorage.setItem('fc-sync', JSON.stringify({owner:'o',repo:'r',token:'t'}));")
    ctx.route("**/*", route)
    pg = ctx.new_page()
    pg.goto(APP); pg.wait_for_function("document.querySelector('#p-rules .body').innerHTML.length>0")
    pg.wait_for_timeout(300)

    def st():
        return pg.evaluate("""()=>{const h=document.querySelector('.wrap>header').getBoundingClientRect(),
          n=document.querySelector('.jump').getBoundingClientRect();
          return {y:scrollY,hb:Math.round(h.bottom),nt:Math.round(n.top),cur:document.querySelector('.jump a.on').textContent,
                  hgt:document.documentElement.scrollHeight,mh:document.body.style.minHeight}}""")
    def tab(label): pg.click(f".jump a:text-is('{label}')"); pg.wait_for_timeout(250)
    def go(label, y):
        tab(label); pg.evaluate(f"window.scrollTo({{top:{y},behavior:'instant'}})"); pg.wait_for_timeout(150)
    def hidden(s): return s["hb"] <= 0 and s["nt"] == 0
    def top(s): return s["y"] == 0

    lens = {}
    for l in ["Status", "Vermögen", "Liquidität & Sparen", "Positionen", "Termine"]:
        go(l, 0); lens[l] = st()["hgt"]
    print("Seitenhöhen:", lens)

    # Kopfmaße
    hh = pg.evaluate("document.querySelector('.wrap>header').getBoundingClientRect().height")
    print("Kopfhöhe (Nicht-Status):", hh)

    go("Vermögen", 0); tab("Liquidität & Sparen"); s = st(); check("lang→lang, Kopf sichtbar → ganz oben", top(s), str(s))
    go("Vermögen", 600); tab("Liquidität & Sparen"); s = st(); check("lang→lang, Kopf weg → bleibt weg", hidden(s), str(s))
    go("Liquidität & Sparen", 0); tab("Termine"); s = st(); check("lang→kurz, Kopf sichtbar → ganz oben", top(s) and s["mh"] == "", str(s))
    go("Liquidität & Sparen", 900); tab("Termine"); s = st(); check("lang→kurz, Kopf weg → bleibt weg", hidden(s), str(s))
    tab("Status"); s = st(); check("kurz(weg)→kurz Status → bleibt weg", hidden(s), str(s))
    tab("Positionen"); s = st(); check("kurz(weg)→lang → bleibt weg", hidden(s), str(s))
    pg.evaluate("window.scrollTo({top:0,behavior:'instant'})"); tab("Termine"); s = st()
    check("Kopf wieder sichtbar → ganz oben, min-height entfernt", top(s) and s["mh"] == "", str(s))

    # Faustregel halbe Kopfhöhe (Termine ist kurz → per min-height scrollbar machen)
    go("Positionen", 0)
    hdr = pg.evaluate("(()=>{const r=document.querySelector('.wrap>header').getBoundingClientRect();return {t:r.top+scrollY,h:r.height}})()")
    go("Positionen", int(hdr["t"] + hdr["h"] / 2) - 3); tab("Vermögen"); s = st(); check("knapp unter halb draußen → ganz oben", top(s), str(s))
    go("Positionen", int(hdr["t"] + hdr["h"] / 2) + 3); tab("Vermögen"); s = st(); check("knapp über halb draußen → bleibt weg", hidden(s), str(s))

    # Wischen (Touch) lang→lang
    def swipe(dx):
        pg.evaluate("""(dx)=>{const m=document.getElementById('main'),el=document.querySelector('.group:not([hidden]) .ghead');
          const T=(x)=>new Touch({identifier:1,target:el,clientX:x,clientY:300});
          const f=(type,x)=>el.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'?[]:[T(x)],changedTouches:[T(x)]}));
          f('touchstart',300);for(let i=1;i<=6;i++)f('touchmove',300+dx*i/6);f('touchend',300+dx)}""", dx)
        pg.wait_for_timeout(500)
    go("Vermögen", 700); swipe(-250); s = st(); check("Wischen lang→lang, Kopf weg → bleibt weg", hidden(s) and s["cur"].startswith("Liquid"), str(s))
    go("Vermögen", 0); swipe(-250); s = st(); check("Wischen, Kopf sichtbar → ganz oben", top(s) and s["cur"].startswith("Liquid"), str(s))
    go("Positionen", 800); swipe(-250); s = st(); check("Wischen lang→kurz (Termine), Kopf weg → bleibt weg", hidden(s) and s["cur"] == "Termine", str(s))

    # Status-Kachel → Panel in anderem Reiter (Unteransicht)
    go("Status", 0); pg.click("#status a.chip[href='#p-puffer']"); pg.wait_for_timeout(250); s = st()
    pr = pg.evaluate("Math.round(document.getElementById('p-puffer').getBoundingClientRect().top)")
    check("Kachel, Kopf sichtbar → wie bisher zum Panel", s["cur"].startswith("Liquid"), f"{s} panelTop={pr}")
    go("Status", 300); pg.click("#status a.chip[href='#p-alloc']"); pg.wait_for_timeout(250); s = st()
    pr = pg.evaluate("Math.round(document.getElementById('p-alloc').getBoundingClientRect().top)")
    check("Kachel, Kopf weg → Kopf bleibt weg, Panel sichtbar", s["hb"] <= 0 and 0 <= pr < 844, f"{s} panelTop={pr}")
    pg.screenshot(path="/home/claude/tests/kachel_weg.png")
    go("Positionen", 800); tab("Termine"); pg.screenshot(path="/home/claude/tests/termine_weg.png")

    # Zurück: Cockpit hat keine History-Einträge
    hl = pg.evaluate("history.length")
    print("history.length nach allen Wechseln:", hl)
    b.close()
print("FEHLER:", fails); sys.exit(1 if fails else 0)
