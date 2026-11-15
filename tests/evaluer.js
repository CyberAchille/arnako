#!/usr/bin/env node
/**
 * Mesure ArnaKO sur le banc d'essai (tests/corpus.js).
 *   node tests/evaluer.js          → chiffres par lot + messages mal classés
 *   node tests/evaluer.js --tout   → détail de chaque message
 */
const ArnaKO = require("../js/detecteur.js");
const C = require("./corpus.js");

const LOTS = [
  ["Lot 1 (mise au point)", C.arnaques, C.legitimes],
  ["Lot 2 (mise au point)", C.arnaquesLot2, C.legitimesLot2],
  ["Lot 3 (validation)", C.arnaquesValidation, C.legitimesValidation],
  ["Lot 4 (test)", C.arnaquesTest, C.legitimesTest],
  ["Lot 5 (test final)", C.arnaquesFinal, C.legitimesFinal],
];

const tout = process.argv.includes("--tout");
const pct = (n, total) => `${((100 * n) / total).toFixed(1).padStart(5)} %`;
const ligne = (m, r) =>
  `    ${m.id.padEnd(7)} score ${String(r.score).padStart(2)}  ${r.niveau.libelle.padEnd(16)} ${r.signaux.map((s) => `${s.id}(${s.points})`).join(" ")}\n            ${m.texte.slice(0, 110)}`;

function classer(liste) {
  const res = { ok: [], prudence: [], suspect: [] };
  for (const m of liste) {
    const r = ArnaKO.analyser(m.texte);
    res[r.niveau.id].push({ m, r });
  }
  return res;
}

console.log(`\nArnaKO ${ArnaKO.VERSION} — ${ArnaKO.REGLES.length} règles\n`);
console.log("                          ARNAQUES                              VRAIES OFFRES");
console.log("                          signalées     dont « très suspect »    sans alerte   « très suspect » (fausse alerte)");

const total = { a: 0, aSignal: 0, aSuspect: 0, l: 0, lOk: 0, lSuspect: 0 };
const details = [];
for (const [nom, arnaques, legitimes] of LOTS) {
  const A = classer(arnaques);
  const L = classer(legitimes);
  const signalees = A.suspect.length + A.prudence.length;
  console.log(
    `  ${nom.padEnd(23)} ${String(signalees).padStart(3)}/${String(arnaques.length).padEnd(3)} ${pct(signalees, arnaques.length)}   ` +
    `${String(A.suspect.length).padStart(3)} ${pct(A.suspect.length, arnaques.length)}          ` +
    `${String(L.ok.length).padStart(3)}/${String(legitimes.length).padEnd(3)} ${pct(L.ok.length, legitimes.length)}   ${L.suspect.length}`
  );
  total.a += arnaques.length; total.aSignal += signalees; total.aSuspect += A.suspect.length;
  total.l += legitimes.length; total.lOk += L.ok.length; total.lSuspect += L.suspect.length;
  details.push([nom, A, L]);
}
console.log(
  `  ${"Total".padEnd(23)} ${String(total.aSignal).padStart(3)}/${String(total.a).padEnd(3)} ${pct(total.aSignal, total.a)}   ` +
  `${String(total.aSuspect).padStart(3)} ${pct(total.aSuspect, total.a)}          ` +
  `${String(total.lOk).padStart(3)}/${String(total.l).padEnd(3)} ${pct(total.lOk, total.l)}   ${total.lSuspect}`
);

for (const [nom, A, L] of details) {
  const aMontrer = tout
    ? [...A.suspect, ...A.prudence, ...A.ok]
    : [...A.prudence, ...A.ok];
  const lMontrer = tout ? [...L.ok, ...L.prudence, ...L.suspect] : [...L.prudence, ...L.suspect];
  if (!aMontrer.length && !lMontrer.length) continue;
  console.log(`\n  ${nom}`);
  if (aMontrer.length) {
    console.log(tout ? "   Arnaques :" : "   Arnaques pas classées « Très suspect » :");
    for (const x of aMontrer) console.log(ligne(x.m, x.r));
  }
  if (lMontrer.length) {
    console.log(tout ? "   Vraies offres :" : "   Vraies offres avec une alerte :");
    for (const x of lMontrer) console.log(ligne(x.m, x.r));
  }
}
console.log("");

module.exports = { total };
