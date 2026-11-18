#!/usr/bin/env node
/* regeln.js – lesbare Übersicht aller Regelzahlen aus rules.json (18.11.2026).
   rules.json ist die einzige Stelle für diese Zahlen; regelwerk.md erklärt sie nur.
   Aufruf: node tools/regeln.js [--daten PFAD] */
"use strict";
const { lade, eur, usd, pct, dDE } = require("./daten.js");
const { rules: R } = lade();
const z = R.zielpfad, N = R.nio, B = R.baba;
const out = [];
const h = (t) => out.push("", "── " + t + " " + "─".repeat(Math.max(0, 60 - t.length)));

out.push("Regelwerk-Zahlen (rules.json, Stand " + dDE(R.stand) + ")");
h("Sparplan & Liquidität");
out.push("ETF-Sparplan " + eur(R.sparplan.monat) + "/Mt: " + Object.entries(R.sparplan.aufteilung).map(([k, v]) => k + " " + eur(v)).join(" · "));
out.push("Liquiditätsregel: Puffer-Schwelle " + eur(R.liquiditaet.pufferMin) + ". " + R.liquiditaet.regel);
out.push("China-ADR (NIO + BABA) höchstens " + pct(R.chinaAdrMax, 0));
h("Zielpfad");
out.push("Start " + dDE(z.startDatum) + " mit " + eur(z.startWert, 2) + ", Plan-Sparrate " + eur(z.sparrate) + "/Mt, " + pct(z.rendite, 0) + " p. a.");
out.push("Ziel " + eur(z.ziel) + " bis " + z.zielDatum);
out.push("Soll-Sparraten: " + Object.entries(R.sollSparrate || {}).map(([k, v]) => k + " " + eur(v)).join(" · ") + ", danach " + eur(z.sparrate));
h("NIO");
out.push("Z0: " + N.stufe0.stueck.toLocaleString("de-DE") + " Stück am " + dDE(N.stufe0.z0Datum) + " (festgelegt " + dDE(N.stufe0.z0Festgelegt) + ")");
out.push("Upside-Trigger: Wochenschluss über " + usd(N.upsideUsd) + " vor dem Z0-Termin → Z0 entfällt");
N.stufen.forEach((s) => out.push(s.name + ": " + s.stueck.toLocaleString("de-DE") + " Stück bei " + eur(s.eur) + (s.hinweis ? " (" + s.hinweis + ")" : "")));
out.push("Kill: " + N.kill.join(" · "));
out.push("Schätzung Ende 2030: Bear " + usd(N.schaetzung2030Usd.bear) + " · Base " + usd(N.schaetzung2030Usd.base) + " · Bull " + usd(N.schaetzung2030Usd.bull));
out.push("Alte Stufe 0 (nur Historie): zwei Wochenschlüsse unter " + usd(N.stufe0.triggerUsd));
h("BABA");
B.stufen.forEach((s) => out.push(s.name + ": " + s.stueck + " Stück bei " + eur(s.eur)));
if (B.fcfTrigger) out.push("FCF-Trigger: " + B.fcfTrigger.quartaleOhneVerbesserung + " Quartale ohne Verbesserung ggü. " + B.fcfTrigger.referenz + " (" + B.fcfTrigger.referenzFcfRmbMrd.toLocaleString("de-DE") + " Mrd. RMB) → " + B.fcfTrigger.stueck + " Stück verkaufen");
if (B.nachkaufTore) out.push("Nachkauf nur wenn alle grün: " + B.nachkaufTore.join(" · "));
h("GRAB");
out.push(R.grab.zukauf || "–");
h("Termine");
R.termine.slice().sort((a, b) => a.datum.localeCompare(b.datum)).forEach((t) => out.push(dDE(t.datum).padStart(10) + "  " + t.name));
console.log(out.join("\n"));
