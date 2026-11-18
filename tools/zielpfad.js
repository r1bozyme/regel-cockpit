#!/usr/bin/env node
/* zielpfad.js – Zielpfad mit derselben Logik wie die App (logik.js), 18.11.2026.
   Aufruf: node tools/zielpfad.js [--daten PFAD] [--ziel 1000000] [--rate 1800] [--rendite 0.05] [--heute JJJJ-MM-TT]
   --rate und --rendite rechnen ein zusätzliches Was-wäre-wenn-Szenario ab heutigem Vermögen. */
"use strict";
const { L, arg, lade, heute, eur, pct, monat, dDE } = require("./daten.js");
const D = lade(), jetzt = heute();
const ziel = arg("ziel") ? +arg("ziel") : null;
const Z = L.zielpfad(D.rules, D.snapshot, D.state, ziel, jetzt);
if (!Z) { console.error("Kein Snapshot"); process.exit(2); }
const delta = (sim) => { const m = L.monthsBetween(Z.basis.date, sim.date); return m === 0 ? "wie Basisfall" : (m > 0 ? "+" + m + " Mon. später" : -m + " Mon. früher"); };
const zeilen = [
  "Zielpfad " + eur(Z.z.ziel) + " · Snapshot " + new Date(D.snapshot.stand).toLocaleString("de-DE") + " · gerechnet für " + dDE(jetzt),
  "",
  "Vermögen            " + eur(Z.vermoegen) + "  (" + pct(Z.anteil) + ")",
  "  Depot / Giro / TG " + eur(Z.d.total) + " / " + eur(Z.puffer || 0) + " / " + eur(Z.tagesgeld),
  "Basisfall heute     " + eur(Z.basisHeute) + "  (Soll-Sparraten je Monat)",
  "Abweichung          " + (Z.abweichung >= 0 ? "+" : "") + eur(Z.abweichung),
  "",
  "Szenario                              erreicht   ggü. Basis",
  "Basisfall (" + eur(Z.z.sparrate) + "/Mt ab Start)".padEnd(26 - eur(Z.z.sparrate).length) + monat(Z.basis.date).padEnd(11) + "noch " + L.monthsBetween(jetzt, Z.basis.date) + " Mon.",
  "Heutiger Stand, Plan-Sparrate         " + monat(Z.kurs.date).padEnd(11) + delta(Z.kurs),
];
if (Z.trend) zeilen.push(("So weiter (" + eur(Z.ist.rate) + "/Mt, Ø " + Z.ist.label + ")").padEnd(38) + monat(Z.trend.date).padEnd(11) + delta(Z.trend));
if (arg("rate") || arg("rendite")) {
  const rate = arg("rate") ? +arg("rate") : Z.z.sparrate, ren = arg("rendite") ? +arg("rendite") : Z.z.rendite;
  const sim = L.simulate(Z.vermoegen, rate, Z.kurs.start, Z.z.ziel, ren);
  zeilen.push(("Was wäre wenn (" + eur(rate) + "/Mt, " + pct(ren, 0) + ")").padEnd(38) + monat(sim.date).padEnd(11) + delta(sim));
}
zeilen.push("", "Alle Szenarien mit Monatszins = Jahresrendite / 12 auf das gesamte Vermögen; " + pct(Z.d.spec, 0) + " stecken in Einzelwerten und Krypto.");
console.log(zeilen.join("\n"));
