# Regel-Cockpit – Hinweise für Claude

## Vor jeder Arbeit am Cockpit: MUSTER.md aus training-log abgleichen

Die Fitness-App r1bozyme/training-log ist oft einen Schritt weiter und schreibt
übertragbare Lösungen nach `MUSTER.md`. Das Rad nicht neu erfinden:

1. training-log klonen bzw. holen und prüfen, ob sich `MUSTER.md` seit dem in
   `MUSTER-STAND.md` vermerkten Commit geändert hat.
2. Neue oder geänderte Muster kurz bewerten (übernehmen / nicht nötig / schon
   vorhanden) und dem Nutzer nennen. Umsetzen nur auf Wunsch.
3. Nach dem Auswerten `MUSTER-STAND.md` aktualisieren (Commit-Stand, Tabelle).
4. Wenn die aktuelle Aufgabe ein Muster berührt: dort nachlesen, sinngemäß
   übertragen, nicht blind kopieren.

## Technik in Kürze

- Kein Build, kein Service Worker. `app/index.html` (Markup, Styles,
  Fehlerprotokoll, Modul-Loader) lädt `scrub.js` und `cockpit.js`.
- Bei **jeder** Änderung an `app/index.html` die Kennung
  `<meta name="app-build">` hochzählen (siehe README).
- Neue Module in `MODS` im Loader eintragen.
- Antworten und Commit-Nachrichten auf Deutsch.
