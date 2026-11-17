# Regel-Cockpit

Persönliches Dashboard, das ein Portfolio gegen ein festes Regelwerk prüft (Verkaufsleitern, Konzentrationsgrenzen, Liquiditätsregel, Sparrate, Zielpfad).

Der Code enthält keine Daten. Die App liest sie zur Laufzeit aus einem privaten Repo über einen Fine-grained Token, der nur im `localStorage` des jeweiligen Geräts liegt (Key `fc-sync`). Erwartete Dateien im Daten-Repo: `rules.json`, `snapshot.json`, `weekly.json`, `state.json`.

## Updates nach einem Push

`app/index.html` enthält am Ende einen Modul-Loader (Liste `MODS`). Er gleicht jedes Modul beim Start mit `cache:"no-cache"` ab, damit trotz der 10-Minuten-Cachezeit von GitHub Pages sofort die neue Fassung läuft. Neue Module in `MODS` eintragen und bei **jeder** Änderung an `index.html` die Kennung `<meta name="app-build">` hochzählen: Daran erkennt der Loader eine neue Fassung von `index.html` und lädt einmal neu. Die Kennung wird auch unten in der App als „App-Stand“ angezeigt.
