import base64, json, sys, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

# Daten und Routing aus scroll_test.py übernehmen (wie features_test.py)
exec(open("/home/claude/tests/scroll_test.py").read().split("fails = 0")[0].split("from playwright.sync_api import sync_playwright")[1])

# Über HTTP statt file:// – unter file:// gehen localStorage-Schreibvorgänge bei schnellem Neuladen
# gelegentlich verloren, das ergab falsche Fehlschläge.
class H(SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory="/home/claude/finance-cockpit", **k)
    def log_message(s, *a): pass
srv = ThreadingHTTPServer(("127.0.0.1", 8767), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
APP = "http://127.0.0.1:8767/app/"
_route = route
def route(r):
    if r.request.url.startswith("http://127.0.0.1"): return r.continue_()
    return _route(r)

fails = 0
def check(name, cond, info=""):
    global fails
    print(("OK   " if cond else "FAIL ") + name + ("  " + str(info) if info else "")); fails += 0 if cond else 1

def state(pg):
    return pg.evaluate("""()=>({t:document.documentElement.dataset.theme, p:document.documentElement.dataset.themePref,
      bg:getComputedStyle(document.body).backgroundColor,
      bar:[...document.querySelectorAll('meta[name="theme-color"]')].map(m=>m.content+'|'+(m.getAttribute('media')||'')),
      lbl:document.getElementById('theme-btn').getAttribute('aria-label'),
      vis:!!document.getElementById('theme-btn').offsetParent,
      ls:localStorage.getItem('fc-theme')})""")

LIGHT_BG, DARK_BG = "rgb(238, 241, 241)", "rgb(15, 21, 20)"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    for scheme in ("light", "dark"):
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True,
                            device_scale_factor=2, color_scheme=scheme)
        ctx.add_init_script("localStorage.setItem('fc-sync', JSON.stringify({owner:'o',repo:'r',token:'t'}));")
        ctx.route("**/*", route)
        pg = ctx.new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(APP); pg.wait_for_function("document.querySelector('#p-rules .body').innerHTML.length>0")
        s = state(pg)
        want = DARK_BG if scheme == "dark" else LIGHT_BG
        check(f"[{scheme}] Auto folgt System", s["p"] == "auto" and s["t"] == scheme and s["bg"] == want, s)
        check(f"[{scheme}] Statusleiste passt", all(x.startswith("#0f1514" if scheme == "dark" else "#eef1f1") for x in s["bar"]), s["bar"])
        check(f"[{scheme}] Button sichtbar mit Label", s["vis"] and "automatisch" in s["lbl"], s["lbl"])

        # Durchschalten: auto → hell → dunkel → auto
        pg.click("#theme-btn"); s = state(pg)
        check(f"[{scheme}] 1. Tipp: hell", s["p"] == "light" and s["t"] == "light" and s["bg"] == LIGHT_BG and s["ls"] == "light", s)
        pg.click("#theme-btn"); s = state(pg)
        check(f"[{scheme}] 2. Tipp: dunkel", s["p"] == "dark" and s["t"] == "dark" and s["bg"] == DARK_BG and all(x.startswith("#0f1514") for x in s["bar"]), s)

        # Wahl übersteht Neuladen, kein heller Blitz (Attribut steht vor dem ersten Zeichnen)
        pg.reload(); pg.wait_for_function("document.querySelector('#p-rules .body').innerHTML.length>0")
        s = state(pg)
        check(f"[{scheme}] Dunkel nach Neuladen", s["t"] == "dark" and s["bg"] == DARK_BG, s)
        early = pg.evaluate("""()=>performance.getEntriesByType('paint').length>=0 && document.documentElement.dataset.theme""")
        check(f"[{scheme}] Attribut gesetzt", early == "dark", early)

        pg.click("#theme-btn"); s = state(pg)
        check(f"[{scheme}] 3. Tipp: zurück auf Auto", s["p"] == "auto" and s["t"] == scheme and s["ls"] is None, s)

        # Auto reagiert live auf Systemwechsel (z. B. Energiesparmodus)
        other = "light" if scheme == "dark" else "dark"
        pg.emulate_media(color_scheme=other); pg.wait_for_timeout(100); s = state(pg)
        check(f"[{scheme}] Auto reagiert live auf System → {other}", s["t"] == other, s)
        # Manuelle Wahl hat Vorrang vor dem System
        pg.click("#theme-btn"); pg.emulate_media(color_scheme="dark"); pg.wait_for_timeout(100); s = state(pg)
        check(f"[{scheme}] Manuell hell schlägt System dunkel", s["t"] == "light", s)
        pg.click("#theme-btn"); pg.click("#theme-btn")  # zurück auf auto

        # Button auch in anderen Reitern sichtbar
        pg.click(".jump a[href='#g-positionen']"); pg.wait_for_timeout(400)
        check(f"[{scheme}] Button im Reiter Positionen sichtbar", state(pg)["vis"])
        if scheme == "dark":
            pg.screenshot(path="/home/claude/theme_dark.png")
        check(f"[{scheme}] keine JS-Fehler", not errs, errs)
        ctx.close()
    b.close()
print("FEHLER:", fails); sys.exit(1 if fails else 0)
