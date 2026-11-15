/**
 * Tests automatiques d'ArnaKO — lancer avec : npm test   (ou : node --test tests/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const ArnaKO = require("../js/detecteur.js");
const C = require("./corpus.js");

const ids = (message) => ArnaKO.analyser(message).signaux.map((s) => s.id);
const niveau = (message) => ArnaKO.analyser(message).niveau.id;

test("API : forme du résultat", () => {
  const r = ArnaKO.analyser("Frais de dossier : 5 000 FCFA par Flooz");
  assert.equal(typeof r.score, "number");
  assert.ok(["ok", "prudence", "suspect"].includes(r.niveau.id));
  assert.ok(Array.isArray(r.signaux));
  for (const s of r.signaux) {
    assert.ok(s.id && s.libelle && s.explication && s.categorie);
    assert.ok(s.extraits.length > 0);
  }
  assert.ok(ArnaKO.REGLES.length >= 40);
  assert.equal(ArnaKO.NIVEAUX.length, 3);
});

test("Message vide ou bizarre : pas de plantage", () => {
  for (const m of ["", " ", null, undefined, 42, "​​", "💰💰💰"]) {
    const r = ArnaKO.analyser(m);
    assert.ok(r.score >= 0);
  }
  assert.equal(niveau(""), "ok");
});

test("Niveaux : 0-1 rien d'alarmant, 2-3 prudence, 4+ très suspect", () => {
  assert.equal(ArnaKO.niveauPour(0).id, "ok");
  assert.equal(ArnaKO.niveauPour(1).id, "ok");
  assert.equal(ArnaKO.niveauPour(2).id, "prudence");
  assert.equal(ArnaKO.niveauPour(3).id, "prudence");
  assert.equal(ArnaKO.niveauPour(4).id, "suspect");
  assert.equal(ArnaKO.niveauPour(15).id, "suspect");
});

test("Les 5 signaux du défi Codeurs Pro", () => {
  assert.ok(ids("Merci de régler les frais de dossier.").includes("frais"));
  assert.ok(ids("Installez l'application pour commencer.").includes("appli"));
  assert.ok(ids("Recrutement URGENT").includes("urgence"));
  assert.ok(ids("Infos : bit.ly/abc123").includes("lien_court"));
  assert.ok(ids("Télétravail, gagnez 300 € par jour").includes("teletravail_gros"));
});

test("Anti-camouflage : accents, majuscules, polices spéciales, leet, lettres espacées, invisibles", () => {
  assert.ok(ids("FRAIS DE DOSSIER").includes("frais"));
  assert.ok(ids("𝐅𝐫𝐚𝐢𝐬 𝐝𝐞 𝐝𝐨𝐬𝐬𝐢𝐞𝐫").includes("frais"));
  assert.ok(ids("Fr@is d'inscript1on : 5000f").includes("frais"));
  assert.ok(ids("Fra​is de dossi​er").includes("frais"));
  assert.ok(ids("Contact T.e.l.e.g.r.a.m : @job").includes("telegram"));
  assert.ok(ids("Écris sur W h a t s A p p : +228 90 00 00 00").includes("whatsapp"));
});

test("Négations et avertissements : pas de fausse alerte", () => {
  assert.ok(!ids("Aucun frais de dossier n'est demandé.").includes("frais"));
  assert.ok(!ids("Ne partagez jamais votre code reçu par SMS.").includes("code_secret"));
  assert.ok(!ids("We will never ask you for bank details or verification codes.").includes("code_secret"));
  assert.ok(!ids("Attention aux fausses offres qui demandent des frais de dossier !").includes("frais"));
  assert.ok(!ids("Frais de déplacement remboursés.").includes("frais"));
});

test("Régression : « nous » et « notre » ne sont pas des négations", () => {
  assert.ok(ids("Installez notre application maintenant.").includes("appli"));
  assert.ok(ids("Encaissez le chèque et nous reverser la différence par transfert.").includes("mule"));
});

test("Salaires : période, devises, montants annuels", () => {
  const m = ArnaKO._interne.montants;
  assert.deepEqual(m("300 € par jour").map((x) => [x.valeur, x.devise, x.type]), [[300, "eur", "jour"]]);
  assert.deepEqual(m("salaire 600k/mois").map((x) => [x.valeur, x.devise]), [[600000, "fcfa"]]);
  assert.deepEqual(m("$5,000 per week").map((x) => [x.valeur, x.type]), [[5000, "semaine"]]);
  assert.equal(m("45 000 € par an")[0].type, "an");
  assert.equal(m("15 000 F par jour")[0].devise, "fcfa");
  // Un vrai salaire annuel en télétravail n'est pas un « gros salaire suspect »
  assert.ok(!ids("Remote Python Developer. Salary: $70,000–$90,000 per year.").includes("teletravail_gros"));
});

test("Codes secrets : la demande compte, pas le simple mot « code »", () => {
  assert.ok(ids("Merci de nous transmettre le code reçu par SMS.").includes("code_secret"));
  assert.ok(ids("Please send me the 6-digit verification code you received.").includes("code_secret"));
  assert.ok(!ids("Indiquez le code de l'offre dans l'objet du mail.").includes("code_secret"));
  assert.ok(!ids("Envoyez un lien vers votre code source GitHub.").includes("code_secret"));
});

test("Indices faibles plafonnés : Gmail + WhatsApp + urgent ≠ rouge", () => {
  const r = ArnaKO.analyser("URGENT : boutique recrute vendeuse. CV par WhatsApp au 90 00 00 00 ou boutique@gmail.com");
  assert.notEqual(r.niveau.id, "suspect");
});

test("Extraits : le texte d'origine (avec accents) est cité exactement", () => {
  const msg = "Bonjour ! Réglez les FRAIS DE DOSSIER via T-Money.";
  const r = ArnaKO.analyser(msg);
  for (const s of r.signaux) {
    for (const e of s.extraits) assert.equal(msg.slice(e.debut, e.fin), e.texte);
  }
  const frais = r.signaux.find((s) => s.id === "frais");
  assert.ok(frais.extraits.some((e) => e.texte.includes("FRAIS DE DOSSIER")));
});

test("Performance : 20 000 caractères analysés en moins d'une seconde", () => {
  const morceaux = [
    "a ".repeat(10000),
    "!".repeat(20000),
    "frais de dossier ".repeat(1200),
    "1 2 3 4 5 6 7 8 9 0 ".repeat(1000),
    "w h a t s a p p ".repeat(1200),
    "envoyez votre code ".repeat(1000),
  ];
  for (const m of morceaux) {
    const t0 = Date.now();
    ArnaKO.analyser(m);
    assert.ok(Date.now() - t0 < 1000, `trop lent sur : ${m.slice(0, 30)}…`);
  }
  assert.equal(ArnaKO.analyser("x".repeat(30000)).tronque, true);
});

test("Banc d'essai : garde-fous de qualité (aucune régression)", () => {
  const lots = [
    [C.arnaques, C.legitimes], [C.arnaquesLot2, C.legitimesLot2],
    [C.arnaquesValidation, C.legitimesValidation], [C.arnaquesTest, C.legitimesTest],
    [C.arnaquesFinal, C.legitimesFinal],
  ];
  let a = 0, signalees = 0, suspectes = 0, l = 0, faussesAlertes = 0;
  for (const [arnaques, legitimes] of lots) {
    for (const m of arnaques) {
      const n = niveau(m.texte);
      a++;
      if (n !== "ok") signalees++;
      if (n === "suspect") suspectes++;
    }
    for (const m of legitimes) {
      l++;
      if (niveau(m.texte) === "suspect") faussesAlertes++;
    }
  }
  assert.ok(signalees / a >= 0.97, `arnaques signalées : ${signalees}/${a}`);
  assert.ok(suspectes / a >= 0.9, `arnaques « très suspect » : ${suspectes}/${a}`);
  assert.ok(faussesAlertes <= 2, `fausses alertes rouges : ${faussesAlertes}/${l}`);
});
