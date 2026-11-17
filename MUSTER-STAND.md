# Abgleich mit MUSTER.md aus training-log

Die Fitness-App (r1bozyme/training-log) ist dem Cockpit oft einen Schritt
voraus und schreibt übertragbare Lösungen nach `MUSTER.md`. Diese Datei hält
fest, welcher Stand davon ausgewertet ist und was mit jedem Muster passiert ist.

**Zuletzt ausgewertet:** training-log Commit `09c8f3c` (MUSTER.md vom 17.11.2026)

Neue oder geänderte Einträge finden:
`git log --oneline 09c8f3c..origin/main -- MUSTER.md` bzw. `git diff 09c8f3c origin/main -- MUSTER.md`

## Status je Muster

| Muster | Status im Cockpit |
|---|---|
| Sofort-Updates beim Start | übernommen 17.11. (3a43038), mit Verbesserungen, siehe unten |
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

## Rückmeldungen an training-log (dort noch offen)

Aus dieser Sitzung kann nicht nach training-log geschrieben werden. Diese
Verbesserungen sollten dort in Loader und MUSTER.md zurückfließen:

1. **Rückfall hängt an der Cache-Sperre:** Hängt das Netz, wartet ein
   `<script src>` in Chrome auf den laufenden `no-cache`-Abgleich derselben
   Datei. Der 2,5-s-Rückfall greift dann erst nach dem Netz-Timeout. Abbrechen
   per AbortController hilft nicht, Chrome verwirft dabei den Cache-Eintrag.
   Lösung im Cockpit: den abgeglichenen Text selbst ausführen
   (`script.text` + `//# sourceURL=`) und eine Kopie in localStorage halten;
   der Rückfall nutzt die Kopie.
2. **Alter Loader kennt neues Modul nicht:** Im Cockpit über eine
   Build-Kennung `<meta name="app-build">` gelöst. Weicht die frisch geholte
   index.html ab, wird einmal neu geladen (sessionStorage-Flag). Damit sind
   neues Markup und neue Module sofort da, ohne Nachlade-Workarounds.
3. **Testserver:** ETag-Abgleich funktioniert in Chrome nur mit HTTP/1.1-
   Antworten; Pythons `SimpleHTTPRequestHandler` braucht dafür
   `protocol_version = "HTTP/1.1"`. Inkognito-Kontexte von Playwright cachen
   nicht, für Cache-Tests ein persistentes Profil nehmen.
4. **409/422 beim Speichern:** frischen Stand holen und nur die eigene
   Änderung darauf setzen statt blind mit neuer sha zu wiederholen, falls
   auch dort andere Prozesse in dieselbe Datei schreiben.
