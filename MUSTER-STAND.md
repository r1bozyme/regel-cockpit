# Abgleich mit MUSTER.md aus training-log

Die Fitness-App (r1bozyme/training-log) ist dem Cockpit oft einen Schritt
voraus und schreibt übertragbare Lösungen nach `MUSTER.md`. Diese Datei hält
fest, welcher Stand davon ausgewertet ist und was mit jedem Muster passiert ist.

**Zuletzt ausgewertet:** training-log Commit `1cd06bf` (MUSTER.md vom 18.11.2026)

Neue oder geänderte Einträge finden:
`git log --oneline 1cd06bf..origin/main -- MUSTER.md` bzw. `git diff 1cd06bf origin/main -- MUSTER.md`

## Status je Muster

| Muster | Status im Cockpit |
|---|---|
| Sofort-Updates beim Start | übernommen 17.11. (3a43038). training-log erkennt neue Fassungen inzwischen automatisch (force-cache gegen no-cache) statt über `app-build`: nicht nötig, der Smoke-Test prüft seit 18.11., dass `app-build` hochgezählt wird |
| Testen von Cache-Verhalten | vorhanden (stammt aus dem Cockpit, `tests/loader_test.py`) |
| Smoke-Test vor jedem Push | übernommen 18.11. (`tests/smoke.py`), erweitert um app-build, `logik.js` in Node und die Skripte in `tools/` |
| CLAUDE.md nur mit Code-Regeln | übernommen 18.11. |
| Kein Service Worker | gegeben, nie einer vorhanden |
| Installierbare PWA (id, start_url, maskable) | vorhanden; Icons randlos, Motiv in Safe Zone (geprüft 17.11.) |
| Ansichtswechsel als Ereignis | nicht nötig: nur `showTab`, kaum Zuhörer |
| Weggescrollter Kopf bleibt weg | übernommen 17.11. (4ca5915) |
| Bereiche unten, Chips oben, schwebender Knopf | nicht nötig: 5 Reiter oben reichen |
| Wischen zwischen Unteransichten | vorhanden (stammt aus dem Cockpit) |
| Android-Zurück | übernommen 17.11. (67e1217) |
| Sprung zu einer Karte / `?go=` | teilweise: Sprungziele über `#p-…`; `?go=` nicht nötig |
| Backup ins private Repo | nicht nötig: Daten liegen ohnehin im Repo |
| – PUT bei 409/422 wiederholen | übernommen 17.11. (67e1217), mit frischem Stand statt blindem Retry |
| – raw lesen ab 1 MB | nicht nötig, solange die JSON-Dateien klein bleiben |
| – `cache: "no-store"` bei GitHub | vorhanden |
| Abgleich beim Start | nicht nötig |
| Diagnose & dauerhafter Speicher | übernommen 17.11. (67e1217) |
| Rückgängig statt Rückfrage | nicht nötig: im Cockpit wird nichts gelöscht |
| Datum in Ortszeit | übernommen 17.11. (67e1217) |
| Eigene Dialoge statt confirm/alert | nicht nötig: keine Dialoge im Einsatz |
| Bis an den Bildschirmrand | vorhanden |
| Graphen per Gedrückthalten | vorhanden (scrub.js) |
| Kontext-Chip im Kopf | nicht nötig |

## Rückmeldungen an training-log

Die vier Rückmeldungen vom 17.11. (Rückfall per `script.text`, neue index.html
erkennen, HTTP/1.1-Testserver, 409 mit frischem Stand) sind in training-log
umgesetzt und in MUSTER.md eingearbeitet (df012eb, geprüft 18.11.). Neu:

1. **Logik als eigenes Modul für App und Skripte:** Im Cockpit liegt die
   Rechenlogik seit 18.11. in `app/logik.js` (ohne DOM, im Browser und in
   Node). Die Skripte in `tools/` und der Smoke-Test nutzen dieselben
   Funktionen, so rechnet ein Chat-Skript nie anders als die App. Könnte für
   training-log passen (z. B. Zielberechnung aus tracker.js für die Auswertung
   in training-log-data).
2. **Smoke-Test prüft `app-build`:** Ist `app/index.html` gegenüber
   `origin/main` geändert, die Kennung aber gleich, schlägt der Test fehl. In
   training-log entfällt das (automatische Erkennung).
