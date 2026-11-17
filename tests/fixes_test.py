import base64, json, sys, threading, copy
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
DD="/home/claude/finance-data/"
REAL={n:json.load(open(DD+n)) for n in ["rules.json","snapshot.json","weekly.json","state.json"]}
class H(SimpleHTTPRequestHandler):
    def __init__(s,*a,**k): super().__init__(*a,directory="/home/claude/finance-cockpit",**k)
    def log_message(s,*a): pass
srv=ThreadingHTTPServer(("127.0.0.1",8771),H); threading.Thread(target=srv.serve_forever,daemon=True).start()
URL="http://127.0.0.1:8771/app/"
fails=0
def check(name,cond,info=""):
    global fails
    print(("OK   " if cond else "FAIL ")+name+("  → "+str(info)[:400] if info else "")); fails+=0 if cond else 1
JS="""()=>({chips:[...document.querySelectorAll('#status .chip')].map(c=>c.innerText.replace(/\\n+/g,' | ')),
  nio:(document.querySelector('#p-nio dl.kv')||{}).innerText||'', baba:(document.querySelector('#p-baba dl.kv')||{}).innerText||'',
  week:document.querySelector('#p-week .body').innerText.replace(/\\n+/g,' | '),
  termine:[...document.querySelectorAll('#p-rules tbody tr')].map(r=>r.innerText.replace(/\\s+/g,' ')),
  ziel:(document.querySelector('#p-ziel .body')||{}).innerText||'',
  fresh:document.getElementById('fresh').textContent})"""
def run(p,clock,mut=None):
    F=copy.deepcopy(REAL)
    if mut: mut(F)
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome")
    ctx=b.new_context(viewport={"width":390,"height":844},timezone_id="Europe/Berlin",locale="de-DE")
    ctx.add_init_script("localStorage.setItem('fc-sync', JSON.stringify({owner:'o',repo:'r',token:'t'}))")
    def route(r):
        u=r.request.url
        if "api.github.com" in u:
            n=u.rsplit("/",1)[-1]
            return r.fulfill(status=200,content_type="application/json",body=json.dumps({"content":base64.b64encode(json.dumps(F[n]).encode()).decode(),"sha":"x"}))
        if u.startswith("http://127.0.0.1"): return r.continue_()
        return r.abort()
    ctx.route("**/*",route); pg=ctx.new_page(); errs=[]
    pg.on("pageerror",lambda e:errs.append(str(e)[:160]))
    pg.clock.install(time=clock); pg.goto(URL); pg.wait_for_timeout(1500)
    o=pg.evaluate(JS); o["errs"]=errs; b.close(); return o
def pos(F,name): return [x for x in F["snapshot.json"]["positionen"] if x["name"]==name][0]
def setkurs(name,k):
    def m(F): x=pos(F,name); x["kursEur"]=k; x["wertEur"]=k*x["stueck"]
    return m
def both(*ms):
    def m(F):
        for f in ms: f(F)
    return m
z0chip=lambda o:[c for c in o["chips"] if c.startswith("NIO Z0")][0]
NOW="2026-11-17T20:00:00+01:00"
with sync_playwright() as p:
    # 1 – NIO fehlt
    o=run(p,NOW,lambda F:F["snapshot.json"].update(positionen=[x for x in F["snapshot.json"]["positionen"] if x["name"]!="NIO"]))
    check("1 Ohne NIO-Position: kein Absturz, alle Kacheln da",not o["errs"] and len(o["chips"])==4 and any(c.startswith("LIQUIDIT") for c in o["chips"]),o["errs"] or o["chips"])
    check("1 … Z0-Kachel zeigt fehlende Position",z0chip(o).startswith("NIO Z0 | – |") and "Keine NIO-Position" in z0chip(o),z0chip(o))
    # 2 – Stufen
    o=run(p,NOW,both(setkurs("NIO",7.5),setkurs("BABA",130)))
    nl=[c for c in o["chips"] if c.startswith("NIO-LEITER")]; bl=[c for c in o["chips"] if c.startswith("BABA-LEITER")]
    check("2 NIO 7,50 €: Kachel „Stufe 1 erreicht“ mit 4.000 Stück und Bestand",nl and "Stufe 1 erreicht" in nl[0] and "4.000 Stück" in nl[0] and "15.000" in nl[0],nl)
    check("2 BABA 130 €: Kachel „T1 erreicht“, Panel „Bis T1 erreicht“",bl and "T1 erreicht" in bl[0] and "70 Stück" in bl[0] and "erreicht" in o["baba"],(bl,o["baba"]))
    o=run(p,NOW,setkurs("NIO",16))
    nl=[c for c in o["chips"] if c.startswith("NIO-LEITER")]
    check("2 NIO 16 €: Stufe 3 erreicht, alle drei Stufen, Hinweis Vollausstieg",nl and "Stufe 3 erreicht" in nl[0] and "Stufe 1" in nl[0] and "Stufe 2" in nl[0] and "Vollausstieg" in nl[0],nl)
    o=run(p,NOW)
    check("2 Heutige Kurse: keine Leiter-Kachel",not [c for c in o["chips"] if "LEITER" in c],o["chips"])
    # 4 – fehlende Wochenschlüsse (06.11. herausgenommen, wie vor dem Nachtrag am 17.11.)
    o=run(p,NOW,lambda F:F["weekly.json"].update(nio=[x for x in F["weekly.json"]["nio"] if x["datum"]!="2026-11-06"]))
    check("4 Fehlender Schluss 6.11. in Kachel und Wochenkarte","Wochenschluss fehlt: 6.11.2026" in z0chip(o) and "Wochenschluss fehlt: 6.11.2026" in o["week"],(z0chip(o),o["week"][:200]))
    def add(*items):
        def m(F): F["weekly.json"]["nio"]=sorted(F["weekly.json"]["nio"]+[{"datum":d,"closeUsd":c} for d,c in items],key=lambda x:x["datum"])
        return m
    o=run(p,NOW,add(("2026-11-06",3.0)))
    check("4 Vollständig: keine Warnung","fehlt" not in z0chip(o) and "fehlt" not in o["week"],z0chip(o))
    o=run(p,"2026-11-21T09:00:00+01:00",add(("2026-11-06",3.0)))
    check("4 Sa 21.11. 9:00: Woche bis 20.11. noch nicht als fehlend gemeldet","fehlt" not in z0chip(o),z0chip(o))
    o=run(p,"2026-11-21T11:00:00+01:00",add(("2026-11-06",3.0)))
    check("4 Sa 21.11. 11:00: 20.11. fehlt → gemeldet","Wochenschluss fehlt: 20.11.2026" in z0chip(o),z0chip(o))
    o=run(p,"2027-04-05T11:00:00+02:00",add(*[(d,3.0) for d in ["2026-11-06","2026-11-20","2026-11-27","2026-12-04","2026-12-11","2026-12-18","2026-12-24","2026-12-31","2027-01-08","2027-01-15","2027-01-22","2027-01-29","2027-02-05","2027-02-12","2027-02-19","2027-02-26","2027-03-05","2027-03-12","2027-03-19","2027-03-26","2027-04-01"]]))
    check("4 Feiertagswochen mit Donnerstags-Eintrag (24.12., 31.12., 1.4. Karfreitag) gelten als vorhanden","fehlt" not in z0chip(o),z0chip(o))
    # 5 – Upside vor/nach Termin, eine Bewertung für Kachel und Karte
    o=run(p,"2027-04-12T10:00:00+02:00",add(("2026-11-06",3.0),("2027-04-09",6.5)))
    check("5 Upside erst nach Z0: Kachel „fällig“ und Karte „ist fällig … zählt nicht mehr“","fällig" in z0chip(o) and "Z0 entfällt" not in o["week"] and "zählt nicht mehr" in o["week"],(z0chip(o),o["week"][-200:]))
    o=run(p,"2027-04-12T10:00:00+02:00",add(("2026-11-06",3.0),("2027-03-26",6.5)))
    check("5 Upside vor Z0: Kachel und Karte einig „entfällt“","entfällt" in z0chip(o) and "vor dem Termin: Z0 entfällt" in o["week"],(z0chip(o),o["week"][-150:]))
    o=run(p,"2026-12-01T10:00:00+01:00",add(("2026-11-06",3.0),("2026-10-30",7.0)))
    check("5 Upside vor Festlegung von Z0 (30.10.) zählt nicht","terminiert" in z0chip(o),z0chip(o))
    # 6 – Tageszählung
    for t,exp in [("2027-03-30T08:00:00+02:00","morgen"),("2027-03-30T23:30:00+02:00","morgen")]:
        o=run(p,t); check(f"6 {t[:16]}: Z0 „{exp}“",exp in z0chip(o) and "terminiert" in z0chip(o),z0chip(o))
    o=run(p,"2027-03-31T08:00:00+02:00")
    check("6 Am Stichtag 8:00: „Z0 heute fällig“ (vorher „noch 1 Tag“)","fällig" in z0chip(o) and "heute" in z0chip(o),z0chip(o))
    check("6 … NIO-Panel „31.3.2027 · heute“","31.3.2027 · heute" in o["nio"],o["nio"])
    o=run(p,"2027-03-01T13:00:00+01:00"); check("6 Termin am Tag selbst: „heute“ statt „-0“",o["termine"][0].endswith("heute"),o["termine"][0])
    o=run(p,"2027-03-02T08:00:00+01:00"); check("6 Termin am Folgetag: „vorbei“",o["termine"][0].endswith("vorbei"),o["termine"][0])
    o=run(p,"2026-11-17T23:30:00+01:00"); check("6 Termine abends gleich wie morgens (134 Tage bis Z0)","134" in o["termine"][1],o["termine"][1])
    # 7 – BABA-Nachkauf
    o=run(p,NOW); check("7 Puffer 9.499 €: Nachkauf „gesperrt: Liquiditätsregel aktiv“","gesperrt: Liquiditätsregel aktiv" in o["baba"],o["baba"])
    o=run(p,NOW,lambda F:F["state.json"]["puffer"].update(wert=15000)); check("7 Puffer 15.000 €: TOR 3 grün","TOR 3 grün" in o["baba"],o["baba"])
    o=run(p,NOW,both(lambda F:F["state.json"]["puffer"].update(wert=8000),setkurs("NIO",6)))
    check("7 Beides: „Liquiditätsregel aktiv, TOR 3 rot“","Liquiditätsregel aktiv, TOR 3 rot" in o["baba"],o["baba"])
    # Echte Daten heute ohne Fehler
    o=run(p,NOW); check("Echte Daten heute: keine Fehler, Z0 terminiert, 134 Tage",not o["errs"] and "terminiert" in z0chip(o) and "noch 134 Tage" in z0chip(o),z0chip(o))
    # Entscheidungen 3, 8, 9 (17.11.) – ohne Tagesgeld, damit die Werte vom Datenstand unabhängig sind
    o=run(p,NOW,lambda F:F["snapshot.json"].pop("tagesgeldEur",None))
    check("3 Z0-Kachel nennt Wochenschluss als Bedingung","Entfällt nur bei Wochenschluss über $6,32 vor dem Termin" in z0chip(o),z0chip(o))
    check("8 Basisfall heute mit Soll-Sparraten (Sep 0, Okt/Nov 1.200): 231.517 €","231.517" in o["ziel"] and "-22.847" in o["ziel"].replace("−","-"),o["ziel"][:120])
    check("9 So weiter wie bisher mit Ø angelegt Aug–Okt: 1.268 €/Mt","1.268" in o["ziel"] and "Ø angelegten Betrag" in o["ziel"],"")
    def noinv(F):
        for r in F["snapshot.json"]["sparplan"]: r.pop("investiert",None)
    o=run(p,NOW,noinv); check("9 Ohne „investiert“: Rückfall auf Ø-Überschuss (1.852 €)","1.852" in o["ziel"] and "Ø-Überschuss" in o["ziel"] and not o["errs"],o["errs"])
    o=run(p,NOW,lambda F:F["rules.json"].pop("sollSparrate")); check("8 Ohne sollSparrate: kein Absturz",not o["errs"] and "Basisfall heute" in o["ziel"],o["errs"])
    # Tagesgeld (17.11.)
    o=run(p,NOW,lambda F:F["snapshot.json"].update(tagesgeldEur=500.0))
    check("Tagesgeld zählt zum Vermögen: 208.671 + 500 = 209.171 €","209.171" in o["ziel"] and "500 €" in o["ziel"],o["ziel"][:200])
    o=run(p,NOW,lambda F:F["snapshot.json"].pop("tagesgeldEur",None))
    check("Ohne Tagesgeld im Snapshot: wie bisher 208.671 €, kein Fehler","208.671" in o["ziel"] and not o["errs"],o["errs"])
srv.shutdown()
print("FEHLER:",fails); sys.exit(1 if fails else 0)
