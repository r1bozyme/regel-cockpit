# Regel-Cockpit – Hinweise für Claude

## MUSTER.md aus training-log

Die Fitness-App r1bozyme/training-log ist oft einen Schritt weiter und schreibt
übertragbare Lösungen nach `MUSTER.md`. Das Rad nicht neu erfinden:

- **Regelmäßiger Abgleich: im Finanz-Monatsreview** (Skill `finanz-monatsreview`,
  Abschnitt 7). Dort wird geprüft, ob sich `MUSTER.md` seit dem in
  `MUSTER-STAND.md` vermerkten Commit geändert hat; das Ergebnis landet in
  `MUSTER-STAND.md`. Umgesetzt wird nur auf Wunsch.
- **Bei Arbeit am Cockpit:** Berührt die Aufgabe ein dort beschriebenes Thema
  (Laden/Updates, Navigation, Speichern, Diagnose, Oberfläche), vorher in
  `MUSTER.md` nachlesen und sinngemäß übertragen, nicht blind kopieren.

## Technik in Kürze

- Kein Build, kein Service Worker. `app/index.html` (Markup, Styles,
  Fehlerprotokoll, Modul-Loader) lädt `scrub.js` und `cockpit.js`.
- Bei **jeder** Änderung an `app/index.html` die Kennung
  `<meta name="app-build">` hochzählen (siehe README).
- Neue Module in `MODS` im Loader eintragen.
- Tests: Playwright auf Handybreite (390 × 844). Für Cache-/Loader-Tests einen
  Server mit HTTP/1.1, ETag und `max-age=600` und ein persistentes Profil nehmen
  (siehe `MUSTER-STAND.md`, Rückmeldung 3).
- Antworten und Commit-Nachrichten auf Deutsch.
