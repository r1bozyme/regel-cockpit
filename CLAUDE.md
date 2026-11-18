# Regel-Cockpit – Regeln für Claude

PWA, die das Portfolio gegen das Regelwerk prüft, gehostet auf GitHub Pages
(r1bozyme.github.io/regel-cockpit/, leitet auf `/app/` weiter). Ein Nutzer
(Thomas), ein Gerät: installierte App auf einem Android-Handy (über Chrome
Beta). Kein Build, kein Framework, kein Service Worker, ES5-nahes JavaScript.

Diese Datei enthält nur Regeln für den Code. Regeln des Portfolios, Zahlen und
Entscheidungen stehen nicht hier (siehe „Quellen“). Das Repo ist öffentlich:
**keine Daten ins Repo**, auch nicht in Tests oder Commit-Nachrichten.

## Aufbau

- `app/index.html`: Markup, Styles, Fehlerprotokoll (`fc-err`) und am Ende der
  Modul-Loader. Nur gezielt patchen, nie komplett neu schreiben.
- Die Liste `MODS` im Loader legt die Ladereihenfolge fest:
  `scrub.js`, `logik.js`, `cockpit.js`. Ein neues Modul kommt **immer** in
  `MODS`, sonst lädt es nicht.
- Bei **jeder** Änderung an `app/index.html` die Kennung
  `<meta name="app-build">` hochzählen. Daran erkennt der Loader eine neue
  Fassung und lädt einmal neu (README). Der Smoke-Test prüft das.
- `app/logik.js`: die gesamte Regel- und Rechenlogik (Zielpfad, Z0 und
  Upside, Leiterstufen, fehlende Wochenschlüsse, Liquidität, Nachkauf-Sperre).
  Reine Funktionen ohne DOM, laufen im Browser (`window.fcLogik`) und in Node.
  Neue Logik gehört hierher, nicht in `cockpit.js` und nicht in ein Skript.
- `app/cockpit.js`: Laden aus finance-data, Darstellung, Puffer speichern,
  Navigation, Diagnose. Ruft für jede Rechnung `logik.js` auf.
- `app/scrub.js`: Graphen per Gedrückthalten abtasten.
- `tools/`: feste Skripte statt Herleitung im Chat. Sie lesen einen lokalen
  Klon von finance-data (`--daten PFAD`, Standard `../finance-data`).
  - `regeln.js`: alle Regelzahlen aus rules.json, lesbar
  - `zielpfad.js`: Vermögen, Abweichung, Szenarien, Was-wäre-wenn
  - `nio.js`: Z0, Upside, fehlende Wochen, erreichte Stufen (Exit 1 = Aktion)
  - `monatsreview.py`: DKB-CSVs → Tracker-Werte, Puffer, Gemeinschaftskonto,
    Rückfragen (Methodik im Kopfkommentar)
  - `daten.js`: Laden und Formatieren für die JS-Skripte
- `tests/`: `smoke.py` (Pflicht vor jedem Push) und ältere Spezialtests,
  siehe `tests/README.md`. `tests/fixtures/` enthält nur erfundene Daten.
- Kopfkommentar jeder Datei: Zweck, Datum, Zusammenspiel. Bei Änderungen
  mitpflegen.

## Storage (harte Regeln)

- Die Herkunft r1bozyme.github.io teilt sich das Cockpit mit training-log.
  Hier nur Keys mit `fc-`, nie `tl-…` schreiben oder löschen. Das reine Präfix
  `"tl-"` zum Messen der Belegung (Diagnose) ist erlaubt.
- Niemals „Websitedaten löschen“ oder `localStorage.clear()` empfehlen oder
  einbauen: Das löscht beide Apps, inklusive Cockpit-Token und der
  Trainingsdaten auf dem Gerät.
- `fc-sync` (Fine-grained Token für finance-data) bleibt nur auf dem Gerät.
  Nie ins Repo, in Logs, ins Fehlerprotokoll oder in eine Antwort.
- Modul-Kopien liegen unter `fc-mod:*` in localStorage. Das geht, solange die
  Module klein sind. Das 5-MB-Kontingent gilt für beide Apps zusammen.
  Werden die Module groß, auf den Cache Storage umstellen (MUSTER.md).

## Fachregeln im Code

- Regelzahlen (Schwellen, Stückzahlen, Termine, Sparraten) **nie im Code**.
  Sie kommen aus `rules.json`. Fehlt ein Feld, lieber nichts anzeigen als einen
  eingebauten Ersatzwert. Bekannte Ausnahme: der Umschalter 500k / 1 Mio. im
  Zielpfad.
- Kalendertage in Ortszeit (Europe/Berlin): `calDays`, `isoLokal` bzw.
  `heuteISO`, nie `new Date().toISOString()` (UTC kippt nachts).
- Freitext vor `innerHTML` maskieren (`esc`).
- Schreiben nach finance-data nur in `state.json` (Puffer). Bei 409/422 den
  frischen Stand holen und nur die eigene Änderung darauf setzen, weil auch der
  Monatsreview in die Datei schreibt.
- Z0 entfällt nur bei einem **Wochen**schluss über der Upside-Schwelle vor dem
  Termin. Diese Auslegung steht an einer Stelle: `z0Lage` in `logik.js`.

## Arbeitsablauf

1. Auf einem Branch arbeiten, nicht direkt auf main. In finance-data gilt das
   für Regeländerungen (`rules.json`, `regelwerk.md`). Laufende Daten
   (Snapshot, Wochenschluss, Puffer, bestätigte Werte aus dem Monatsreview)
   gehen weiter direkt auf main.
2. Ersetzungen gezielt: vorher sicherstellen, dass der alte Text genau einmal
   vorkommt (`assert s.count(old) == 1`).
3. Vor jedem Push: `python3 tests/smoke.py --echt /home/claude/finance-data`
   (Syntax, MODS, app-build, Storage, Logik, Skripte, Headless-Start mit
   Test- und echten Daten). Muss „BESTANDEN“ melden. Bei Änderungen an Laden
   und Updates zusätzlich die Cache-Tests (`tests/README.md`).
4. Thomas gibt sein Go, erst dann geht der Branch auf main.
5. Nach dem Push: Raw-Datei zum Commit abrufen und byte-genau vergleichen.
   GitHub Pages braucht bis zu 1–2 Minuten, der Loader holt neue Fassungen
   beim nächsten Start selbst.
6. Pro Push nur eine fachliche Änderung. Mehrere Wünsche als getrennte Commits.
7. Commit-Nachrichten auf Deutsch, Datei bzw. Modul vorn (z. B. `logik.js: …`).
8. Regeländerung: zuerst `rules.json` und `regelwerk.md` in finance-data
   (eigener Commit mit Begründung). Die App ändert sich nur, wenn sich die
   Regel**logik** ändert, nicht bei neuen Zahlen.

## MUSTER.md und MUSTER-STAND.md

Die Fitness-App r1bozyme/training-log ist oft einen Schritt weiter und schreibt
übertragbare Lösungen nach `MUSTER.md`. Das Rad nicht neu erfinden:

- **Regelmäßiger Abgleich im Finanz-Monatsreview** (Skill
  `finanz-monatsreview`, Abschnitt 7): prüfen, ob sich `MUSTER.md` seit dem in
  `MUSTER-STAND.md` vermerkten Commit geändert hat, jedes neue Muster
  einordnen (übernehmen / vorhanden / nicht nötig) und `MUSTER-STAND.md`
  aktualisieren. Umgesetzt wird nur auf Wunsch.
- **Bei Arbeit am Cockpit:** Berührt die Aufgabe ein dort beschriebenes Thema
  (Laden/Updates, Navigation, Speichern, Diagnose, Tests, Oberfläche), vorher
  in `MUSTER.md` nachlesen und sinngemäß übertragen, nicht blind kopieren.
- Wird hier ein Muster übernommen oder entsteht eine Verbesserung, die
  training-log helfen würde: im selben Commit in `MUSTER-STAND.md` eintragen
  (Status-Tabelle bzw. „Rückmeldungen an training-log“).

## Quellen (hier nicht doppelt pflegen)

- Regelzahlen: `finance-data/rules.json` (einzige Stelle).
  Bedeutung, Begründung, Historie: `finance-data/regelwerk.md`.
- Händlerregeln für den Monatsreview: `finance-data/merchants.json`.
- Ist-Werte: Finanz-Tracker (Google Sheet) und Parqet; `snapshot.json`,
  `weekly.json` und `state.json` sind Abzüge davon.
- Entscheidungen, laufende Analysen, Gesprächskontext: Projekt
  „Finanzanalyse & Portfolio-Strategie“ in Claude.
- Antworten und Commit-Nachrichten auf Deutsch.
