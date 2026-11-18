# Regel-Cockpit

Persönliches Dashboard, das ein Portfolio gegen ein festes Regelwerk prüft (Verkaufsleitern, Konzentrationsgrenzen, Liquiditätsregel, Sparrate, Zielpfad).

Der Code enthält keine Daten. Die App liest sie zur Laufzeit aus einem privaten Repo über einen Fine-grained Token, der nur im `localStorage` des jeweiligen Geräts liegt (Key `fc-sync`). Erwartete Dateien im Daten-Repo: `rules.json`, `snapshot.json`, `weekly.json`, `state.json`.

## Aufbau

| Teil | Inhalt |
|---|---|
| `app/index.html` | Markup, Styles, Fehlerprotokoll, Modul-Loader |
| `app/logik.js` | Regel- und Rechenlogik, im Browser und in Node lauffähig |
| `app/cockpit.js` | Laden, Darstellung, Speichern, Navigation |
| `app/scrub.js` | Graphen per Gedrückthalten |
| `tools/` | Skripte mit derselben Logik: `regeln.js`, `zielpfad.js`, `nio.js`, `monatsreview.py` |
| `tests/` | `smoke.py` vor jedem Push, Spezialtests siehe `tests/README.md` |

## Skripte

Sie lesen einen lokalen Klon des Daten-Repos (`--daten PFAD`, Standard `../finance-data`):

```
node tools/regeln.js                    # alle Regelzahlen lesbar
node tools/zielpfad.js [--rate 1800]    # Zielpfad und Szenarien
node tools/nio.js [--kurs-usd 3.10]     # Z0, Upside, Wochen, Stufen; Exit 1 = Aktion
python3 -I tools/monatsreview.py --monat 2026-11 --giro g.csv --visa v.csv --gem m.csv
```

## Updates nach einem Push

`app/index.html` enthält am Ende einen Modul-Loader (Liste `MODS`). Er gleicht jedes Modul beim Start mit `cache:"no-cache"` ab, damit trotz der 10-Minuten-Cachezeit von GitHub Pages sofort die neue Fassung läuft. Neue Module in `MODS` eintragen und bei **jeder** Änderung an `index.html` die Kennung `<meta name="app-build">` hochzählen: Daran erkennt der Loader eine neue Fassung von `index.html` und lädt einmal neu. Die Kennung wird auch unten in der App als „App-Stand“ angezeigt.
