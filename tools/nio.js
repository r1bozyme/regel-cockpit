#!/usr/bin/env node
/* nio.js – NIO-Trigger mit derselben Logik wie die App (logik.js), 18.11.2026.
   Z0-Status, Upside-Trigger (Wochenschluss), fehlende Wochenschlüsse, erreichte Leiterstufen.
   Aufruf: node tools/nio.js [--daten PFAD] [--heute JJJJ-MM-TT] [--kurs-usd 3.10] [--json]
   --kurs-usd prüft die Leiter mit einem anderen Kurs (z. B. dem frischen Wochenschluss).
   Exit-Code: 0 = nichts zu tun, 1 = Aktion nötig (Z0 fällig, Stufe erreicht, Wochenschluss fehlt). */
"use strict";
const { L, arg, lade, heute, eur, usd, dDE } = require("./daten.js");
const D = lade(), jetzt = heute(), N = D.rules.nio;
const d = L.derive(D.rules, D.snapshot), pos = d && d.nio, fx = d ? d.fx : 1;
const kursEur = arg("kurs-usd") ? +arg("kurs-usd") / fx : pos ? pos.kursEur : null;
const z = L.z0Lage(D.rules, D.weekly, jetzt), fw = L.fehlendeWochen(D.weekly, jetzt);
const stufen = kursEur != null ? L.erreichteStufen(N.stufen, kursEur) : [];
const w = (D.weekly.nio || []), last = w[w.length - 1];

let status;
if (!z.z0) status = "kein Z0-Termin in rules.json";
else if (z.hit) status = "entfällt (Wochenschluss " + dDE(z.hit.datum) + " " + usd(z.hit.closeUsd) + " über " + usd(z.up) + ")";
else if (z.tage <= 0) status = "FÄLLIG: " + N.stufe0.stueck.toLocaleString("de-DE") + " Stück verkaufen, kursunabhängig";
else status = "terminiert " + dDE(z.z0) + ", noch " + z.tage + " Tage";

const aktion = [];
if (z.z0 && !z.hit && z.tage <= 0) aktion.push("Z0 fällig");
stufen.forEach((s) => aktion.push(s.name + " erreicht: " + s.stueck.toLocaleString("de-DE") + " Stück verkaufen, falls noch nicht geschehen"));
if (fw.length) aktion.push("Wochenschluss fehlt: " + fw.map(dDE).join(", "));

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ z0: z.z0, tage: z.tage, upsideUsd: z.up, upsideTreffer: z.hit, letzterSchluss: last || null,
    kursEur, kursUsd: kursEur != null ? kursEur * fx : null, erreichteStufen: stufen, fehlendeWochen: fw.map(L.isoLokal), aktion }, null, 1));
} else {
  console.log([
    "NIO · gerechnet für " + dDE(jetzt),
    "Z0              " + status,
    "Letzter Schluss " + (last ? dDE(last.datum) + " " + usd(last.closeUsd) + (z.z0 && !z.hit ? " · bis Upside +" + ((z.up / last.closeUsd - 1) * 100).toFixed(1).replace(".", ",") + " %" : "") : "–"),
    "Kurs            " + (kursEur != null ? eur(kursEur, 2) + " / " + usd(kursEur * fx) + (arg("kurs-usd") ? " (vorgegeben)" : " (Snapshot)") : "–"),
    "Leiter          " + N.stufen.map((s) => s.name + " " + eur(s.eur) + (kursEur >= s.eur ? " ✓" : "")).join(" · "),
    "",
    aktion.length ? "AKTION:\n- " + aktion.join("\n- ") : "Keine Aktion nötig.",
  ].join("\n"));
}
process.exit(aktion.length ? 1 : 0);
