#!/usr/bin/env python3
"""Smoke-Test für das Regel-Cockpit (18.11.2026, nach MUSTER.md aus training-log).

Prüft vor jedem Push auf main, ob die App überhaupt noch startet und die Logik rechnet:
  1. Syntax: node --check für app/*.js und tools/*.js
  2. Loader: jede Datei in app/*.js steht in MODS (app/index.html) und umgekehrt,
     logik.js lädt vor cockpit.js. Ist app/index.html gegenüber origin/main geändert,
     muss auch <meta name="app-build"> geändert sein.
  3. Storage statisch: keine Keys tl-… (gehören training-log; das reine Präfix "tl-"
     zum Messen der Belegung ist erlaubt), kein localStorage.clear()
  4. Logik in Node: logik.js lässt sich laden und rechnet mit den Testdaten
  5. Skripte: tools/*.js mit den Testdaten, tools/monatsreview.py mit tests/fixtures
     (erfundene CSVs) gegen von Hand nachgerechnete Werte
  6. Headless-Start (Chrome, Handy-Viewport 390 × 844): GitHub-Abrufe werden mit Testdaten
     beantwortet, alle anderen externen Anfragen blockiert. Keine ungefangenen Fehler, alle
     Reiter lassen sich öffnen und haben Inhalt, alle localStorage-Keys beginnen mit fc-,
     ein vorher gesetzter tl-Key bleibt unangetastet, Fehlerprotokoll fc-err bleibt leer.

Die Testdaten sind erfunden und stehen hier im Skript (das Repo ist öffentlich).
Mit --echt PFAD (lokaler Klon von finance-data) startet Schritt 6 zusätzlich mit den echten Daten.

Aufruf aus dem Repo-Wurzelordner:  python3 tests/smoke.py [--echt /home/claude/finance-data]
Voraussetzung: node, Google Chrome unter /usr/bin/google-chrome oder Playwright-Chromium.
Exit-Code 0 = bestanden, 1 = Fehler.
"""
import base64, datetime as dt, functools, http.server, json, os, re, subprocess, sys, threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app")
fails = []

def fail(msg):
    fails.append(msg)
    print("  ✗ " + msg)

def ok(msg):
    print("  ✓ " + msg)

echt = None
if "--echt" in sys.argv:
    echt = sys.argv[sys.argv.index("--echt") + 1]

def files(d, ext):
    p = os.path.join(ROOT, d)
    return sorted(f for f in os.listdir(p) if f.endswith(ext)) if os.path.isdir(p) else []

# 1. Syntax
print("1. Syntax")
js = [("app", f) for f in files("app", ".js")] + [("tools", f) for f in files("tools", ".js")]
bad = 0
for d, f in js:
    r = subprocess.run(["node", "--check", os.path.join(ROOT, d, f)], capture_output=True, text=True)
    if r.returncode:
        bad += 1
        fail(f"{d}/{f}: " + (r.stderr.strip().splitlines() or ["?"])[-1])
for f in files("tools", ".py") + files("tests", ".py"):
    d = "tools" if os.path.exists(os.path.join(ROOT, "tools", f)) else "tests"
    r = subprocess.run([sys.executable, "-m", "py_compile", os.path.join(ROOT, d, f)], capture_output=True, text=True)
    if r.returncode:
        bad += 1
        fail(f"{d}/{f}: " + (r.stderr.strip().splitlines() or ["?"])[-1])
if not bad:
    ok(f"{len(js)} JS-Dateien und die Python-Skripte fehlerfrei")

# 2. Loader
print("2. Loader (MODS in app/index.html)")
n0 = len(fails)
html = open(os.path.join(APP, "index.html"), encoding="utf-8").read()
m = re.search(r"var MODS=\[([^\]]*)\]", html)
appjs = files("app", ".js")
if not m:
    fail("MODS-Liste in app/index.html nicht gefunden")
else:
    mods = re.findall(r'"([^"]+)"', m.group(1))
    for f in mods:
        if f not in appjs:
            fail(f"MODS nennt {f}, Datei fehlt")
    for f in appjs:
        if f not in mods:
            fail(f"app/{f} liegt im Repo, steht aber nicht in MODS")
    if len(set(mods)) != len(mods):
        fail("MODS enthält Doppelte")
    if "logik.js" in mods and "cockpit.js" in mods and mods.index("logik.js") > mods.index("cockpit.js"):
        fail("Reihenfolge: logik.js muss vor cockpit.js laden")
build = re.search(r'<meta name="app-build" content="([^"]+)">', html)
if not build:
    fail("<meta name=\"app-build\"> fehlt")
else:
    r = subprocess.run(["git", "-C", ROOT, "show", "origin/main:app/index.html"], capture_output=True, text=True)
    if r.returncode == 0 and r.stdout != html:
        alt = re.search(r'<meta name="app-build" content="([^"]+)">', r.stdout)
        if alt and alt.group(1) == build.group(1):
            fail(f"app/index.html geändert, app-build aber nicht hochgezählt ({build.group(1)})")
if len(fails) == n0:
    ok(f"{len(mods)} Module, Liste vollständig, app-build {build.group(1)}")

# 3. Storage statisch
print("3. Storage (statisch)")
hits, clear = [], []
for f in appjs + ["index.html"]:
    for n, line in enumerate(open(os.path.join(APP, f), encoding="utf-8"), 1):
        if re.search(r"""["'`]tl-[\w-]+["'`]""", line):
            hits.append(f"{f}:{n}")
        if re.search(r"localStorage\.clear\s*\(|Clear-Site-Data", line):
            clear.append(f"{f}:{n}")
if hits:
    fail("tl-Keys gefunden (gehören training-log): " + ", ".join(hits))
if clear:
    fail("localStorage.clear()/Clear-Site-Data gefunden (löscht auch training-log): " + ", ".join(clear))
if not hits and not clear:
    ok("keine tl-Keys, kein clear()")

# Testdaten (erfunden). Wochenschlüsse und Snapshot-Stand relativ zu heute, damit nichts veraltet.
heute = dt.date.today()
fr = heute - dt.timedelta(days=(heute.weekday() - 4) % 7 or 7)
monate = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"]
def mon(k):
    y, mm = heute.year, heute.month - 1 + k
    y += mm // 12
    return f"{monate[mm % 12]} {y}"
TEST = {
    "rules.json": {
        "stand": heute.isoformat(), "quelle": "smoke.py (erfunden)",
        "sparplan": {"monat": 1000, "aufteilung": {"A": 800, "B": 200}},
        "liquiditaet": {"pufferMin": 10000, "regel": "Testregel"},
        "chinaAdrMax": 0.3,
        "nio": {"isin": "X-NIO", "stufe0": {"triggerUsd": 4, "stueck": 100, "regel": "Test", "status": "Test",
                "z0Datum": (heute + dt.timedelta(days=120)).isoformat(), "z0Festgelegt": (heute - dt.timedelta(days=30)).isoformat()},
                "upsideUsd": 6, "stufen": [{"name": "Stufe 1", "eur": 7, "stueck": 100}, {"name": "Stufe 2", "eur": 10, "stueck": 100, "hinweis": "Vollausstieg"}],
                "schaetzung2030Usd": {"bear": 1, "base": 3, "bull": 9}, "kill": ["K1 Test", "K3 Test"]},
        "baba": {"isin": "X-BABA", "stufen": [{"name": "T1", "eur": 120, "stueck": 10}]},
        "grab": {"isin": "X-GRAB"},
        "etf": ["X-ETF"], "kryptoIsin": [],
        "zielpfad": {"startDatum": (heute - dt.timedelta(days=90)).isoformat(), "startWert": 100000, "sparrate": 1000, "rendite": 0.07, "ziel": 500000, "zielDatum": "Test"},
        "sollSparrate": {mon(-2): 800, mon(-1): 800, mon(0): 1000},
        "termine": [{"name": "Testtermin", "datum": (heute + dt.timedelta(days=10)).isoformat(), "art": "pruefung"}],
    },
    "snapshot.json": {
        "stand": dt.datetime.now().astimezone().isoformat(timespec="seconds"), "fxUsdJeEur": 1.1, "tagesgeldEur": 100,
        "positionen": [
            {"name": "ETF", "id": "X-ETF", "typ": "security", "stueck": 100, "kursEur": 100, "wertEur": 10000},
            {"name": "NIO", "id": "X-NIO", "typ": "security", "stueck": 1000, "kursEur": 3, "wertEur": 3000},
            {"name": "BABA", "id": "X-BABA", "typ": "security", "stueck": 10, "kursEur": 80, "wertEur": 800},
            {"name": "GRAB", "id": "X-GRAB", "typ": "security", "stueck": 100, "kursEur": 3, "wertEur": 300},
            {"name": "Krypto", "id": "X-K", "typ": "crypto", "stueck": 1, "kursEur": 500, "wertEur": 500}],
        "sparplan": [{"monat": mon(k), "netto": 4000, "konsum": 3000, "ueberschuss": 1000, "sparquote": 25.0, "investiert": 900} for k in (-3, -2, -1)]
                    + [{"monat": mon(0), "netto": None, "konsum": None, "ueberschuss": None, "sparquote": None, "investiert": 1000}],
    },
    "weekly.json": {"hinweis": "Test", "nio": [{"datum": (fr - dt.timedelta(weeks=k)).isoformat(), "closeUsd": 3 + k / 10} for k in range(7, -1, -1)]},
    "state.json": {"puffer": {"wert": 8000, "geaendert": heute.isoformat(), "quelle": "Test"},
                   "gemeinschaftskonto": {"wert": 100, "geaendert": heute.isoformat(), "quelle": "Test", "einzahlungJePerson": 1000,
                                          "fixMonat": 1500, "urlaubBudgetJahr": 0,
                                          "monate": [{"monat": mon(-1), "alltag": 400, "urlaub": 0, "einrichtung": 0}]}},
}

# 4. Logik in Node
print("4. Logik (logik.js in Node)")
if not os.path.exists(os.path.join(APP, "logik.js")):
    fail("app/logik.js fehlt")
else:
    code = """
const L=require(process.argv[1]),T=JSON.parse(require('fs').readFileSync(0,'utf8'));
const R=T['rules.json'],S=T['snapshot.json'],W=T['weekly.json'],ST=T['state.json'];
const z=L.zielpfad(R,S,ST);const z0=L.z0Lage(R,W);
const out={verm:z.vermoegen,abw:z.abweichung,basis:z.basis.date.toISOString(),z0tage:z0.tage,hit:z0.hit,
  fehl:L.fehlendeWochen(W).length,liq:L.liquiditaetAktiv(R,ST),sperren:L.nachkaufSperren(R,z.d,ST)};
console.log(JSON.stringify(out));"""
    r = subprocess.run(["node", "-e", code, os.path.join(APP, "logik.js")], input=json.dumps(TEST), capture_output=True, text=True)
    if r.returncode:
        fail("logik.js in Node: " + (r.stderr.strip().splitlines() or ["?"])[-1])
    else:
        o = json.loads(r.stdout)
        exp_verm = 10000 + 3000 + 800 + 300 + 500 + 8000 + 100
        problems = []
        if abs(o["verm"] - exp_verm) > 0.01: problems.append(f"Vermögen {o['verm']} statt {exp_verm}")
        if o["z0tage"] != 120: problems.append(f"Z0 in {o['z0tage']} statt 120 Tagen")
        if o["hit"] is not None: problems.append("Upside-Treffer, obwohl alle Schlüsse unter der Schwelle liegen")
        if o["fehl"] != 0: problems.append(f"{o['fehl']} fehlende Wochen statt 0")
        if o["liq"] is not True: problems.append("Liquiditätsregel nicht aktiv trotz Puffer unter Schwelle")
        if "Liquiditätsregel aktiv" not in o["sperren"]: problems.append("Nachkauf nicht gesperrt")
        for p in problems: fail(p)
        if not problems:
            ok(f"Zielpfad, Z0, Wochen, Liquidität und Nachkauf rechnen (Basisfall-Ziel {o['basis'][:7]})")

# 5. Skripte in tools/ (mit den Testdaten bzw. tests/fixtures)
print("5. Skripte (tools/)")
import tempfile
n0 = len(fails)
with tempfile.TemporaryDirectory() as tmp:
    for f, v in TEST.items():
        json.dump(v, open(os.path.join(tmp, f), "w", encoding="utf-8"))
    for f in files("tools", ".js"):
        if f == "daten.js":
            continue
        r = subprocess.run(["node", os.path.join(ROOT, "tools", f), "--daten", tmp], capture_output=True, text=True)
        if r.returncode not in (0, 1) or r.stderr.strip():
            fail(f"tools/{f}: Exit {r.returncode} " + (r.stderr.strip().splitlines() or [""])[-1])
    r = subprocess.run(["node", os.path.join(ROOT, "tools", "nio.js"), "--daten", tmp, "--json"], capture_output=True, text=True)
    if r.returncode == 0:
        o = json.loads(r.stdout)
        if o["tage"] != 120 or o["aktion"]:
            fail(f"tools/nio.js: {o['tage']} Tage, Aktion {o['aktion']}")
    r = subprocess.run(["node", os.path.join(ROOT, "tools", "nio.js"), "--daten", tmp, "--kurs-usd", "8"], capture_output=True, text=True)
    if r.returncode != 1 or "Stufe 1 erreicht" not in r.stdout:
        fail("tools/nio.js meldet Stufe 1 bei $8 nicht")
FX = os.path.join(ROOT, "tests", "fixtures")
r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "tools", "monatsreview.py"), "--monat", "2026-11", "--json",
                    "--giro", os.path.join(FX, "giro.csv"), "--visa", os.path.join(FX, "visa.csv"), "--gem", os.path.join(FX, "gem.csv"),
                    "--daten", FX, "--reisetage", os.path.join(FX, "backup.json")], capture_output=True, text=True)
if r.returncode:
    fail("tools/monatsreview.py: " + (r.stderr.strip().splitlines() or ["?"])[-1])
else:
    o = json.loads(r.stdout)
    soll = {"B_netto": 4000, "D_reisekostenErstattung": 300, "E_etf": 1000, "G_tagesgeld": 500, "I_privatkonsum": 1237.95}
    for k, v in soll.items():
        if abs(o["tracker"][k] - v) > 0.005:
            fail(f"monatsreview {k}: {o['tracker'][k]} statt {v}")
    if abs(o["puffer"]["wert"] - 5845.65) > 0.005:
        fail(f"monatsreview Puffer: {o['puffer']['wert']} statt 5845.65")
    g = sorted(x["grund"][:12] for x in o["rueckfragen"])
    g = set(g)
    if g != {"mögliche 1:1", "ohne Regel ≥", "Regel „nachf"}:
        fail(f"monatsreview Rückfragen: {g}")
if len(fails) == n0:
    ok("regeln/zielpfad/nio laufen; monatsreview rechnet die Testbuchungen richtig (Konsum, Puffer, Reisetage, Rückfragen)")

# 6. Headless-Start
print("6. Headless-Start")
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    fail("playwright fehlt – Headless-Teil übersprungen")
    sync_playwright = None

def lauf(p, base, daten, name):
    errors = []
    kw = {"executable_path": "/usr/bin/google-chrome"} if os.path.exists("/usr/bin/google-chrome") else {}
    b = p.chromium.launch(**kw)
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                        locale="de-DE", timezone_id="Europe/Berlin")
    ctx.add_init_script("""if(!sessionStorage.getItem('smoke')){sessionStorage.setItem('smoke','1');
      localStorage.setItem('fc-sync',JSON.stringify({owner:'o',repo:'r',token:'t'}));
      localStorage.setItem('tl-smoke','unberuehrt')}""")
    def route(r):
        u = r.request.url
        if u.startswith(base):
            return r.continue_()
        if "api.github.com" in u and r.request.method == "GET":
            f = u.split("?")[0].rsplit("/", 1)[-1]
            if f in daten:
                body = {"content": base64.b64encode(json.dumps(daten[f]).encode()).decode(), "sha": "smoke"}
                return r.fulfill(status=200, content_type="application/json", body=json.dumps(body))
        return r.abort()
    ctx.route("**/*", route)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append("Laufzeit: " + str(e)))
    page.on("console", lambda m: errors.append("Konsole: " + m.text)
            if m.type == "error" and "ERR_FAILED" not in m.text and "Failed to fetch" not in m.text
            and "Failed to load resource" not in m.text else None)
    page.goto(base + "app/")
    try:
        page.wait_for_function("() => document.querySelectorAll('#status .chip').length > 0", timeout=15000)
    except Exception:
        errors.append("Status-Kacheln erscheinen nicht")
    page.wait_for_timeout(800)
    tabs = page.evaluate("() => [...document.querySelectorAll('.jump a')].map(a => a.getAttribute('href').slice(1))")
    leer = []
    for t in tabs:
        try:
            page.click(f".jump a[href='#{t}']")
            page.wait_for_timeout(250)
            if page.evaluate("id => document.getElementById(id).hidden", t):
                errors.append(f"Reiter {t} bleibt verborgen")
            leer += page.evaluate("""id => [...document.querySelectorAll('#'+id+' .body')]
                .filter(b => !b.innerText.trim()).map(b => b.parentElement.id || '?')""", t)
        except Exception as e:
            errors.append(f"Reiter {t}: {e}")
    if leer:
        errors.append("Leere Karten: " + ", ".join(leer))
    keys = page.evaluate("() => Array.from({length: localStorage.length}, (_, i) => localStorage.key(i))")
    tl = page.evaluate("() => localStorage.getItem('tl-smoke')")
    fcerr = page.evaluate("() => localStorage.getItem('fc-err')")
    b.close()
    for e in errors:
        fail(f"[{name}] {e}")
    if not errors:
        ok(f"[{name}] Start ohne Fehler, {len(tabs)} Reiter geöffnet, keine leeren Karten")
    fremd = [k for k in keys if not k.startswith("fc-") and k != "tl-smoke"]
    if fremd:
        fail(f"[{name}] localStorage-Keys ohne fc-: " + ", ".join(fremd))
    elif tl != "unberuehrt":
        fail(f"[{name}] fremder Key tl-smoke wurde verändert oder gelöscht")
    else:
        ok(f"[{name}] {len(keys) - 1} eigene Keys, alle fc-; fremder tl-Key unberührt")
    if fcerr and json.loads(fcerr):
        for e in json.loads(fcerr):
            fail(f"[{name}] fc-err: " + json.dumps(e, ensure_ascii=False)[:200])
    else:
        ok(f"[{name}] fc-err leer")

if sync_playwright:
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}/"
    with sync_playwright() as p:
        lauf(p, base, TEST, "Testdaten")
        if echt:
            daten = {}
            for f in TEST:
                try:
                    daten[f] = json.load(open(os.path.join(echt, f), encoding="utf-8"))
                except Exception as e:
                    fail(f"[echte Daten] {f}: {e}")
            if len(daten) == len(TEST):
                lauf(p, base, daten, "echte Daten")
    srv.shutdown()

print()
print("BESTANDEN" if not fails else f"FEHLGESCHLAGEN ({len(fails)})")
sys.exit(1 if fails else 0)
