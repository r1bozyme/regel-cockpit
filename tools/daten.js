/* daten.js – gemeinsame Helfer für die Skripte in tools/ (18.11.2026).
   Lädt die JSON-Dateien aus einem lokalen Klon von finance-data und formatiert Zahlen wie die App.
   Pfad: --daten PFAD, sonst Umgebungsvariable FC_DATEN, sonst ../finance-data neben diesem Repo.
   Datum für Was-wäre-wenn: --heute JJJJ-MM-TT. */
"use strict";
const fs = require("fs"), path = require("path");
const L = require("../app/logik.js");

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : def;
}
function datenPfad() {
  return arg("daten", process.env.FC_DATEN || path.join(__dirname, "..", "..", "finance-data"));
}
function lade() {
  const p = datenPfad(), out = {};
  for (const f of ["rules", "snapshot", "weekly", "state"]) {
    const file = path.join(p, f + ".json");
    if (!fs.existsSync(file)) { console.error("Fehlt: " + file + " (Pfad mit --daten angeben)"); process.exit(2); }
    out[f] = JSON.parse(fs.readFileSync(file, "utf8"));
  }
  return out;
}
function heute() {
  const h = arg("heute");
  return h ? new Date(h + "T12:00:00") : new Date();
}
function eur(v, d) {
  d = d || 0;
  return v == null || isNaN(v) ? "–" : v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }) + " €";
}
function usd(v) { return "$" + v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pct(v, d) { d = d == null ? 1 : d; return (v * 100).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }) + " %"; }
function dDE(x) { return (x instanceof Date ? x : new Date(x + "T12:00:00")).toLocaleDateString("de-DE"); }
function monat(dt) { return dt.toLocaleDateString("de-DE", { month: "short", year: "numeric" }); }

module.exports = { L, arg, lade, heute, eur, usd, pct, dDE, monat, datenPfad };
