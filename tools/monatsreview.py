#!/usr/bin/env python3
"""monatsreview.py – DKB-CSV-Auswertung für den Finanz-Monatsreview (18.11.2026).

Setzt die Methodik „bereinigter Privatkonsum“ fest um, statt sie in jedem Chat neu herzuleiten.
Die Händlerregeln stehen nur in finance-data/merchants.json, die Logik nur hier.

Aufruf (aus regel-cockpit):
  python3 -I tools/monatsreview.py --monat 2026-11 --giro giro.csv --visa visa.csv --gem gem.csv \
      [--daten ../finance-data] [--reisetage ../training-log-data/backup.json] \
      [--puffer-vormonat 9498.58] [--gem-vormonat 400.19] [--nachfragen-ab 250] [--json]

Ablauf:
  1. CSVs lesen (DKB-Format, Semikolon; Spalten werden über die Kopfzeile erkannt).
  2. Jede Buchung mit merchants.json klassifizieren: erste passende Regel gewinnt, Muster =
     Teilstring (Kleinschreibung) aus Zahlungspflichtige*r + Empfänger*in + Verwendungszweck + IBAN.
     Regeln mit nurReisetag gelten nur an Reisetagen (± toleranzTage), sonst „sonst“.
     Ohne Regel: Konsum.
     Bei Abbuchungen zählt Zahlungspflichtige*r (der Kontoinhaber) nicht mit. Auf dem
     Gemeinschaftskonto wird Konsum ohne eigene Gemeinsam-Regel zu Alltag (konsum-gemeinsam).
     Urlaub erkennt das Skript nur über Regeln mit urlaub-gemeinsam.
  3. Girokonto: Visa-Sammelbuchung raus, dafür Visa-Einzelumsätze mit Belegdatum im Monat.
  4. Privatkonsum = Giro (konsum + abo) + Visa (konsum + abo) + Ordergebühren
     + 50 % Gemeinschaftskonto (Alltag + Urlaub + Fix).
  5. Puffer = Endstand Vormonat + Summe der Giro-Buchungen im Monat (nicht die CSV-Kopfzeile).

Was das Skript NICHT entscheidet (landet unter „Rückfragen“):
  Regel „nachfragen“, große Buchungen ohne Regel, mögliche 1:1-Rückzahlungen aufs
  Gemeinschaftskonto, Sondermonat ja/nein, Einzelaktien-Käufe (Spalte F aus Parqet).
Exit-Code 0, auch wenn es Rückfragen gibt; 2 bei fehlenden Eingaben.
"""
import argparse, csv, datetime as dt, io, json, os, re, sys

p = argparse.ArgumentParser(description="DKB-CSV-Auswertung für den Monatsreview")
p.add_argument("--monat", required=True, help="JJJJ-MM")
p.add_argument("--giro", required=True)
p.add_argument("--visa")
p.add_argument("--gem")
p.add_argument("--daten", default=os.environ.get("FC_DATEN", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "finance-data")))
p.add_argument("--reisetage", help="backup.json aus training-log-data")
p.add_argument("--puffer-vormonat", type=float)
p.add_argument("--gem-vormonat", type=float)
p.add_argument("--nachfragen-ab", type=float, default=250.0, help="Buchungen ohne Regel ab diesem Betrag nachfragen")
p.add_argument("--json", action="store_true")
a = p.parse_args()

jahr, mon = map(int, a.monat.split("-"))
start = dt.date(jahr, mon, 1)
ende = (dt.date(jahr + (mon == 12), mon % 12 + 1, 1) - dt.timedelta(days=1))
vorende = start - dt.timedelta(days=1)

def lade_json(name):
    f = os.path.join(a.daten, name)
    if not os.path.exists(f):
        sys.exit(f"Fehlt: {f} (Pfad mit --daten angeben)")
    return json.load(open(f, encoding="utf-8"))

M = lade_json("merchants.json")
state = lade_json("state.json") if os.path.exists(os.path.join(a.daten, "state.json")) else {}
P = M.get("parameter", {})
gebuehr = float(P.get("ordergebuehrSparplan", 0))

# ── Reisetage ──
reise = set()
if a.reisetage:
    keys = json.load(open(a.reisetage, encoding="utf-8")).get("keys", {})
    def val(k):
        v = keys.get(k)
        return json.loads(v) if isinstance(v, str) else v
    for x in val("tl-d") or []:
        if isinstance(x, dict) and x.get("trip") and x.get("date"):
            reise.add(x["date"])
    rs = val("tl-rs")
    if isinstance(rs, dict) and rs.get("von"):
        d0 = dt.date.fromisoformat(rs["von"]); d1 = dt.date.fromisoformat(rs.get("bis") or rs["von"])
        while d0 <= d1:
            reise.add(d0.isoformat()); d0 += dt.timedelta(days=1)
tol = int(M.get("reisetage", {}).get("toleranzTage", 1))
def reisetag(d):
    return d and any((d + dt.timedelta(days=k)).isoformat() in reise for k in range(-tol, tol + 1))

# ── CSV ──
def datum(s):
    s = s.strip()
    for f in ("%d.%m.%Y", "%d.%m.%y", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(s, f).date()
        except ValueError:
            pass
    return None

def betrag(s):
    s = s.replace("€", "").replace("\xa0", "").strip()
    if not s:
        return None
    return float(s.replace(".", "").replace(",", "."))

SPALTEN = {
    "datum": ("buchungsdatum", "belegdatum", "buchungstag"),
    "zahler": ("zahlungspflichtige",),
    "empf": ("zahlungsempf", "empfänger"),
    "zweck": ("verwendungszweck", "beschreibung"),
    "iban": ("iban",),
    "betrag": ("betrag",),
}

def lies(pfad, art):
    raw = open(pfad, "rb").read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    rows = list(csv.reader(io.StringIO(text), delimiter=";"))
    kopf = next((i for i, r in enumerate(rows) if any("betrag" in c.lower() for c in r) and len(r) >= 4), None)
    if kopf is None:
        sys.exit(f"{art}: keine Kopfzeile mit „Betrag“ gefunden ({pfad})")
    h = [c.lower() for c in rows[kopf]]
    idx = {}
    for k, cands in SPALTEN.items():
        for j, c in enumerate(h):
            if k not in idx and any(c.startswith(x) or x in c for x in cands):
                if k == "betrag" and "fremd" in c:
                    continue
                idx[k] = j
    for k in ("datum", "betrag"):
        if k not in idx:
            sys.exit(f"{art}: Spalte {k} nicht erkannt ({rows[kopf]})")
    out = []
    for r in rows[kopf + 1:]:
        if len(r) <= idx["betrag"] or not r[idx["betrag"]].strip():
            continue
        g = lambda k: r[idx[k]].strip() if k in idx and idx[k] < len(r) else ""
        out.append({"konto": art, "datum": datum(g("datum")), "zahler": g("zahler"), "empf": g("empf"),
                    "zweck": g("zweck"), "iban": g("iban"), "betrag": betrag(g("betrag"))})
    return out

def belegdatum(b):
    m = re.search(r"vom (\d\d)\.(\d\d)\.(\d{4})", b["zweck"])
    return dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else b["datum"]

GEM = {"konsum": "konsum-gemeinsam", "abo": "konsum-gemeinsam"}

def klassifiziere(b):
    # Bei Abbuchungen ist Zahlungspflichtige*r der Kontoinhaber selbst. Er zählt nicht mit, sonst träfe
    # auf dem Gemeinschaftskonto jede Ausgabe die Transfer-Regel für den Kontonamen.
    teile = ([b["zahler"]] if b["betrag"] > 0 else []) + [b["empf"], b["zweck"], b["iban"]]
    e = " ".join(teile).lower()
    beh, regel, grund = "konsum", None, "ohne Regel"
    for r in M["regeln"]:
        if r["muster"] in e:
            regel = r
            if r.get("nurReisetag"):
                beh, grund = (r["behandlung"], "Reisetag") if reisetag(belegdatum(b)) else (r.get("sonst", "konsum"), "kein Reisetag")
            else:
                beh, grund = r["behandlung"], ""
            break
    # Gemeinschaftskonto: Konsum ohne eigene Gemeinsam-Regel zählt als Alltag (50 %)
    if b["konto"] == "gem":
        beh = GEM.get(beh, beh)
    return beh, regel, grund

im_monat = lambda d: d is not None and start <= d <= ende
buch = []
for art, pfad in (("giro", a.giro), ("visa", a.visa), ("gem", a.gem)):
    if not pfad:
        continue
    for b in lies(pfad, art):
        if not im_monat(b["datum"]):
            continue
        b["beh"], b["regel"], b["grund"] = klassifiziere(b)
        buch.append(b)

def summe(konto, *beh):
    return round(sum(b["betrag"] for b in buch if b["konto"] == konto and b["beh"] in beh), 2)

giro = [b for b in buch if b["konto"] == "giro"]
etf_buch = [b for b in giro if b["beh"] == "etf"]
etf_brutto = -summe("giro", "etf")
etf_gebuehr = round(len(etf_buch) * gebuehr, 2)
etf_anlage = round(etf_brutto - etf_gebuehr, 2)

konsum_giro = -summe("giro", "konsum", "abo")
konsum_visa = -summe("visa", "konsum", "abo") if a.visa else None
gem_alltag = -summe("gem", "konsum-gemeinsam") if a.gem else None
gem_urlaub = -summe("gem", "urlaub-gemeinsam") if a.gem else None
gem_fix = -summe("gem", "fix-gemeinsam") if a.gem else None
gem_einr = -summe("gem", "einrichtung", "einmal") if a.gem else None
gem_anteil = round(0.5 * ((gem_alltag or 0) + (gem_urlaub or 0) + (gem_fix or 0)), 2)
konsum = round(konsum_giro + (konsum_visa or 0) + etf_gebuehr + gem_anteil, 2)

netto = summe("giro", "einkommen")
erstattung = summe("giro", "sanofi-erstattung")
tagesgeld = -summe("giro", "tagesgeld")
einmal = [b for b in buch if b["beh"] in ("einrichtung", "einmal") and b["konto"] != "gem"]

# Puffer: Endstand Vormonat + Monatsbuchungen
def vormonat(feld, cli):
    if cli is not None:
        return cli, "Eingabe"
    s = state.get(feld) or {}
    if s.get("geaendert") == vorende.isoformat() and isinstance(s.get("wert"), (int, float)):
        return s["wert"], f"state.json ({feld}, {vorende.strftime('%d.%m.%Y')})"
    return None, None
pv, pv_q = vormonat("puffer", a.puffer_vormonat)
puffer = round(pv + sum(b["betrag"] for b in giro), 2) if pv is not None else None
gv, gv_q = vormonat("gemeinschaftskonto", a.gem_vormonat)
gem_stand = round(gv + sum(b["betrag"] for b in buch if b["konto"] == "gem"), 2) if (gv is not None and a.gem) else None

# Rückfragen
fragen = []
for b in buch:
    if b["beh"] == "nachfragen":
        fragen.append(("Regel „nachfragen“", b))
    elif b["regel"] is None and abs(b["betrag"]) >= a.nachfragen_ab:
        fragen.append((f"ohne Regel ≥ {a.nachfragen_ab:.0f} €", b))
if a.gem:
    gem_ausgaben = {round(-b["betrag"], 2) for b in buch if b["konto"] == "gem" and b["betrag"] < 0}
    for b in giro:
        if b["beh"] == "transfer" and b["betrag"] < 0 and round(-b["betrag"], 2) in gem_ausgaben:
            fragen.append(("mögliche 1:1-Rückzahlung aufs Gemeinschaftskonto (zählt 100 % statt 50 %)", b))
if not a.visa:
    fragen.append(("Visa-CSV fehlt – Konsum ohne Kartenumsätze", None))
if pv is None:
    fragen.append((f"Puffer-Endstand {vorende.strftime('%d.%m.%Y')} unbekannt – mit --puffer-vormonat angeben", None))

ergebnis = {
    "monat": a.monat,
    "tracker": {"B_netto": netto, "D_reisekostenErstattung": erstattung, "E_etf": etf_anlage, "F_einzelaktien": "aus Parqet (Käufe im Monat)",
                "G_tagesgeld": tagesgeld, "I_privatkonsum": konsum},
    "konsum": {"giro": konsum_giro, "visa": konsum_visa, "ordergebuehren": etf_gebuehr, "gemeinschaftskonto50": gem_anteil},
    "sparrate": round((netto - konsum) / netto * 100, 1) if netto else None,
    "angelegtQuote": round((etf_anlage + tagesgeld) / netto * 100, 1) if netto else None,
    "puffer": {"wert": puffer, "vormonat": pv, "quelle": pv_q},
    "gemeinschaftskonto": None if not a.gem else {"stand": gem_stand, "vormonat": gv, "alltag": gem_alltag, "urlaub": gem_urlaub,
                                                    "fix": gem_fix, "einrichtung": gem_einr},
    "einmalUndEinrichtung": [{"datum": b["datum"].isoformat(), "konto": b["konto"], "empf": b["empf"] or b["zweck"][:40], "betrag": b["betrag"], "art": b["beh"]} for b in einmal],
    "rueckfragen": [{"grund": g, **({"konto": b["konto"], "datum": b["datum"].isoformat(), "text": (b["empf"] or b["zahler"] or b["zweck"])[:50], "betrag": b["betrag"]} if b else {})} for g, b in fragen],
    "buchungen": len(buch),
}

if a.json:
    print(json.dumps(ergebnis, ensure_ascii=False, indent=1))
    sys.exit(0)

def eur(v):
    return "–" if v is None else f"{v:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")
def pz(v):
    return "–" if v is None else f"{v:.1f} %".replace(".", ",")
T = ergebnis["tracker"]
z = [f"Monatsreview {a.monat} · {len(buch)} Buchungen", "",
     "Tracker, Blatt „Sparplan“",
     f"  B Netto                {eur(T['B_netto'])}",
     f"  D Reisekosten-Erst.    {eur(T['D_reisekostenErstattung'])}",
     f"  E ETF (ohne Gebühr)    {eur(T['E_etf'])}   ({len(etf_buch)} Ausführungen, Abbuchung {eur(etf_brutto)})",
     f"  F Einzelaktien/Krypto  aus Parqet",
     f"  G Tagesgeld            {eur(T['G_tagesgeld'])}",
     f"  I Privatkonsum         {eur(T['I_privatkonsum'])}",
     "",
     "Privatkonsum",
     f"  Girokonto              {eur(konsum_giro)}",
     f"  Visa                   {eur(konsum_visa)}",
     f"  Ordergebühren          {eur(etf_gebuehr)}",
     f"  50 % Gemeinschaftskto  {eur(gem_anteil)}",
     "",
     f"Sparrate                 {pz(ergebnis['sparrate'])}" if netto else "Sparrate                 – (kein Nettogehalt erkannt)",
     f"Angelegt (E + G)         {pz(ergebnis['angelegtQuote'])} · Einzelaktien aus Parqet noch addieren" if netto else None,
     f"Puffer {ende.strftime('%d.%m.%Y')}        {eur(puffer)}" + (f"  (Vormonat {eur(pv)} aus {pv_q})" if pv is not None else ""),
     ]
if a.gem:
    G = ergebnis["gemeinschaftskonto"]
    z += ["", "Gemeinschaftskonto (gesamt, nicht halbiert)",
          f"  Stand {ende.strftime('%d.%m.%Y')}       {eur(G['stand'])}",
          f"  Alltag / Urlaub / Fix  {eur(G['alltag'])} / {eur(G['urlaub'])} / {eur(G['fix'])}",
          f"  Einrichtung/Einmal     {eur(G['einrichtung'])}"]
if einmal:
    z += ["", "Einmaleffekte und Einrichtung (Blatt „Umzug 15.09.“)"] + [f"  {x['datum']}  {x['empf'][:34]:34} {eur(x['betrag'])}" for x in ergebnis["einmalUndEinrichtung"]]
if fragen:
    z += ["", f"Rückfragen ({len(fragen)})"] + [f"  - {g}" + (f": {b['datum'].strftime('%d.%m.')} {(b['empf'] or b['zahler'] or b['zweck'])[:34]} {eur(b['betrag'])} [{b['konto']}]" if b else "") for g, b in fragen]
print("\n".join(x for x in z if x is not None))
