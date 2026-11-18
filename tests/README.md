# Tests (Playwright, Python)

## Vor jedem Push: `smoke.py`

Läuft aus dem Repo-Wurzelordner ohne Vorbereitung:

```
python3 tests/smoke.py --echt /home/claude/finance-data
```

Prüft Syntax, `MODS`, das Hochzählen von `app-build`, fremde Storage-Keys,
`logik.js` in Node, die Skripte in `tools/` (monatsreview.py gegen von Hand
nachgerechnete Testbuchungen in `fixtures/`) und den Headless-Start aller
Reiter mit erfundenen Testdaten. Mit `--echt` zusätzlich mit den echten Daten.
Ergebnis „BESTANDEN“ oder Exit-Code 1.

`fixtures/` enthält nur erfundene Buchungen und Regeln (das Repo ist öffentlich).

## Spezialtests

Erwarten Chrome unter `/usr/bin/google-chrome`, das Cockpit unter
`/home/claude/finance-cockpit` und die Hilfsdateien hier unter `/home/claude/tests`
(Skripte vorher dorthin kopieren; `features_test.py` und `slow2.py` laden Teile
von `scroll_test.py` bzw. `loader_test.py`).

| Datei | Prüft |
|---|---|
| `scroll_test.py` | Weggescrollter Kopf bleibt bei Reiterwechsel, Wischen und Kacheln weg |
| `loader_test.py` | Sofort-Updates: 304-Abgleich, geändertes Modul, neue index.html → einmal neu laden, hängendes Netz (~2,5 s), offline |
| `slow2.py` | Dauerhaft langsames Netz: neue Fassung kommt trotzdem an, Markup und Modul nie gemischt |
| `features_test.py` | Datum in Ortszeit, Speichern bei Konflikt (409), Android-Zurück, Diagnose |
| `fixes_test.py` | Review 17.11. (einige Sollwerte sind auf den Snapshot vom 17.11. festgeschrieben und schlagen mit neueren Daten fehl; die Logik deckt jetzt `smoke.py` ab): fehlende NIO-Position, Leiterstufen, fehlende Wochenschlüsse, Z0 vor/nach Termin, Tageszählung, BABA-Nachkauf. **Liest die echten Daten aus einem lokalen Klon von `finance-data` (`/home/claude/finance-data`), enthält selbst keine.** |

Cache-Tests brauchen einen Server mit HTTP/1.1 (Chrome nutzt ETags sonst nicht)
und ein persistentes Browser-Profil (Inkognito-Kontexte cachen nicht).
