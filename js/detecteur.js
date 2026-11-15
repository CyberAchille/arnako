/*!
 * ArnaKO — moteur de détection des fausses offres d'emploi
 * Licence MIT. Tout se passe dans le navigateur : aucun message n'est envoyé.
 *
 * Principe : chaque signal d'alerte vaut des points. Le score donne un niveau :
 *   0-1 → Rien d'alarmant · 2-3 → Prudence · 4 et plus → Très suspect
 * Les indices faibles (1 point) sont plafonnés à 2 points au total, pour qu'une
 * vraie offre écrite simplement (Gmail, WhatsApp, « urgent ») ne sorte pas en rouge.
 *
 * Utilisable dans le navigateur (window.ArnaKO) et dans Node (require).
 */
(function (racine, fabrique) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = fabrique();
  else racine.ArnaKO = fabrique();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "1.0.0";
  const PLAFOND_FAIBLES = 2;
  const LONGUEUR_MAX = 20000;

  const NIVEAUX = [
    {
      id: "ok", min: 0, libelle: "Rien d'alarmant",
      resume: "Aucun signal d'arnaque important dans ce message. Reste quand même vigilant : vérifie toujours l'entreprise avant de t'engager.",
    },
    {
      id: "prudence", min: 2, libelle: "Prudence",
      resume: "Quelques signaux d'alerte. Vérifie l'entreprise avant d'aller plus loin, et ne paie rien.",
    },
    {
      id: "suspect", min: 4, libelle: "Très suspect",
      resume: "Ce message ressemble fort aux arnaques connues. Ne paie rien, n'envoie aucun code ni document, et coupe le contact.",
    },
  ];

  const CATEGORIES = [
    { id: "argent", libelle: "Argent demandé", conseil: "Ne paie rien, sous aucun prétexte : frais, caution, kit, formation, visa ou « recharge »." },
    { id: "secrets", libelle: "Codes et données sensibles", conseil: "Ne donne aucun code reçu par SMS, aucun mot de passe, aucune info de carte bancaire, et pas tes papiers d'identité à un inconnu." },
    { id: "contact", libelle: "Contacts, liens et applis", conseil: "N'installe rien et n'ouvre pas les liens. Cherche toi-même le site officiel de l'entreprise." },
    { id: "promesses", libelle: "Promesses trop belles", conseil: "Compare avec les salaires habituels : quand c'est trop beau, c'est presque toujours faux." },
    { id: "pression", libelle: "Pression et secret", conseil: "Prends ton temps : une vraie offre ne disparaît pas en quelques heures." },
    { id: "schemas", libelle: "Arnaques connues", conseil: "Ce message suit un scénario d'arnaque bien connu : coupe le contact." },
    { id: "forme", libelle: "Forme du message", conseil: "" },
  ];

  // ===========================================================================
  // 1. Normalisation : on fabrique deux « vues » du message, en gardant pour
  //    chaque caractère sa position dans le texte d'origine (pour surligner).
  // ===========================================================================

  const INVISIBLES = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]/;
  const MARQUES = /\p{M}/gu;
  const ESPACE = /\s/;
  const SAUT = /[\n\r\u2028\u2029]/;
  const REMPLACEMENTS = {
    "œ": "oe", "æ": "ae", "ß": "ss", "ø": "o", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ı": "i",
    "’": "'", "‘": "'", "‛": "'", "ʼ": "'", "´": "'", "`": "'", "′": "'", "ʹ": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"', "«": '"', "»": '"', "″": '"',
    "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-", "⁃": "-",
  };

  /** Vue « plate » : minuscules, sans accents, polices fantaisie ramenées
   *  aux lettres normales (𝐔𝐑𝐆𝐄𝐍𝐓 → urgent), caractères invisibles retirés,
   *  espaces regroupés. */
  function vuePlate(message) {
    let texte = "";
    const deb = [];
    const fin = [];
    let i = 0;
    for (const cp of message) {
      const L = cp.length;
      let s;
      if (INVISIBLES.test(cp)) s = "";
      else if (ESPACE.test(cp)) s = SAUT.test(cp) ? "\n" : " ";
      else {
        s = "";
        for (const c of cp.normalize("NFKD").replace(MARQUES, "").toLowerCase()) {
          s += REMPLACEMENTS[c] !== undefined ? REMPLACEMENTS[c] : c;
        }
      }
      for (let k = 0; k < s.length; k++) {
        const c = s[k];
        const precedent = texte[texte.length - 1];
        if (c === " " || c === "\n") {
          if (precedent === undefined) continue;
          if (precedent === " " || precedent === "\n") {
            if (c === "\n") texte = texte.slice(0, -1) + "\n";
            continue;
          }
        }
        texte += c;
        deb.push(i);
        fin.push(i + L);
      }
      i += L;
    }
    return { texte, deb, fin };
  }

  const LEET = { "@": "a", "4": "a", "0": "o", "1": "i", "3": "e", "$": "s", "5": "s", "7": "t", "®": "r", "©": "c" };
  const LETTRE = /[a-z]/;
  const LETTRES_ESPACEES = /(^|[^a-z0-9])([a-z](?:[ .\-_*·•][a-z]){4,})(?![a-z0-9])/g;

  /** Vue « compacte » : déjoue les camouflages (fr@is → frais,
   *  W h a t s A p p → whatsapp, t.e.l.e.g.r.a.m → telegram). */
  function vueCompacte(plate) {
    const src = plate.texte;
    const car = src.split("");
    for (let k = 1; k < car.length - 1; k++) {
      const r = LEET[car[k]];
      if (r && LETTRE.test(src[k - 1]) && LETTRE.test(src[k + 1])) car[k] = r;
    }
    const t = car.join("");
    const garder = new Array(t.length).fill(true);
    for (const m of t.matchAll(LETTRES_ESPACEES)) {
      const debut = m.index + m[1].length;
      for (let k = 1; k < m[2].length; k += 2) garder[debut + k] = false;
    }
    let texte = "";
    const deb = [];
    const fin = [];
    for (let k = 0; k < t.length; k++) {
      if (!garder[k]) continue;
      texte += t[k];
      deb.push(plate.deb[k]);
      fin.push(plate.fin[k]);
    }
    return { texte, deb, fin };
  }

  // ===========================================================================
  // 2. Recherche avec gestion de la négation : « aucun frais de dossier n'est
  //    demandé » ou « ne partagez jamais votre code » ne doivent pas compter.
  // ===========================================================================

  const R = (...morceaux) => new RegExp(morceaux.join("|"), "g");
  const FIN_PHRASE = /[.!?\n]/;

  const AVERTISSEMENT = new RegExp([
    String.raw`\b(?:ne|n')\s?(?:vous |te |leur |nous |lui )?(?:demand|exig|factur|reclam)\w* (?:jamais|aucun|rien|pas)`,
    String.raw`\bjamais (?:de |d')?(?:frais|argent|paiement|code|mot de passe)`,
    String.raw`\b(?:never|will never|won't|will not|do not|don't|does not|doesn't|we never|shall never) (?:ask|request|require|charge|demand)`,
    String.raw`\bne (?:jamais )?(?:payez|paie|paye|envoyez|envoie|donnez|donne|partagez|partage|communiquez|communique|cliquez|clique|installez|installe|transmettez|transmets)\b`,
    String.raw`\bnever (?:pay|send|share|give|click|install|transfer|disclose)`,
    String.raw`\b(?:attention (?:aux|au|a la|a ces)|mefiez|mefie|beware of|fausses? offres?|faux recruteurs?|fake (?:job|offer|recruit)\w*|scam alert)`,
    String.raw`\b(?:n'est|ne sont|ne seront|ne sera) (?:jamais |pas |)(?:demande|exige|requis|facture)`,
    String.raw`\baucun(?:e|s)? (?:frais|paiement|argent|somme|versement|code)\b`,
    String.raw`\bfree of charge\b`,
  ].join("|"));
  const NEGATION_AVANT = /\b(?:aucun(?:e|s)?|pas de|pas d'|sans|ni|no|zero|not|without|free of)\b\s*(?:\w+\s)?$/;

  // Une « phrase » s'arrête à la ponctuation forte, et au plus à 300 caractères
  // de part et d'autre (évite les lenteurs sur un long texte sans ponctuation).
  const PORTEE_PHRASE = 300;
  function bornesPhrase(texte, a, b) {
    let p = a;
    const pMin = Math.max(0, a - PORTEE_PHRASE);
    while (p > pMin && !FIN_PHRASE.test(texte[p - 1])) p--;
    let q = b;
    const qMax = Math.min(texte.length, b + PORTEE_PHRASE);
    while (q < qMax && !FIN_PHRASE.test(texte[q])) q++;
    return [p, q];
  }

  function estNie(texte, a, b) {
    const [p, q] = bornesPhrase(texte, a, b);
    if (AVERTISSEMENT.test(texte.slice(p, q))) return true;
    return NEGATION_AVANT.test(texte.slice(Math.max(p, a - 25), a));
  }

  function plage(vue, a, b) {
    while (a < b && vue.texte[a] === " ") a++;
    while (b > a && vue.texte[b - 1] === " ") b--;
    if (b <= a) return null;
    return { debut: vue.deb[a], fin: vue.fin[b - 1] };
  }

  /** Cherche un motif dans les deux vues et renvoie des plages du texte d'origine.
   *  `exclure` : si la phrase contient ce motif, la trouvaille est ignorée. */
  function chercher(ctx, regex, avecNegation, exclure, exiger) {
    const res = [];
    for (const vue of ctx.vues) {
      for (const m of vue.texte.matchAll(regex)) {
        if (!m[0]) continue;
        const a = m.index;
        const b = m.index + m[0].length;
        if (avecNegation && estNie(vue.texte, a, b)) continue;
        if (exclure || exiger) {
          const [p, q] = bornesPhrase(vue.texte, a, b);
          const phrase = vue.texte.slice(p, q);
          if (exclure && exclure.test(phrase)) continue;
          if (exiger && !exiger.test(phrase)) continue;
        }
        const p = plage(vue, a, b);
        if (p) res.push(p);
      }
    }
    return res;
  }

  function present(ctx, regex, avecNegation) {
    return chercher(ctx, regex, avecNegation).length > 0;
  }

  // ===========================================================================
  // 3. Montants et salaires (« 300 € par jour », « 600k/mois », « $5,000 per week »)
  // ===========================================================================

  const DEVISES = String.raw`(fcfa|f ?cfa|francs? ?cfa|francs?|frs?|cfa|xof|xaf|f|€|euros?|eur|\$|usd|us ?dollars?|dollars?|£|gbp|pounds?|cad|aud|inr|₹|rs\.?|rupees?|ngn|₦|naira|ghs|cedis?|kes|ksh|mad|dhs?|php|₱|idr|rp)`;
  const MULT = String.raw`(k|mille|milles|mil|millions?|m)`;
  const NOMBRE = String.raw`(\d{1,3}(?:[ .,]\d{3})+|\d+)(?:[.,](\d{1,2}))?`;
  const PERIODE = String.raw`(?:\s?(?:\/|par|per|chaque|each|every|a|an|le|la|the|pour|for)?\s?(?:une |un |one |1 )?(heures?|h|hours?|hrs?|jours?|j|days?|daily|journees?|journaliers?|quotidiens?|soirees?|nuits?|nights?|evenings?|shifts?|semaines?|sem|weeks?|weekly|hebdo\w*|quinzaines?|mois|months?|monthly|mensuel\w*|ans?|annees?|years?|yearly|annuel\w*|yr|likes?|taches?|tasks?|avis|reviews?|videos?|abonnements?|subscriptions?|clics?|clicks?|commandes?|orders?|publications?|posts?|missions?))?(?![a-z])`;

  const MONTANT_SUFFIXE = new RegExp(NOMBRE + String.raw`\s?` + MULT + String.raw`?\s?` + DEVISES + String.raw`(?![a-z])` + PERIODE, "g");
  const MONTANT_PREFIXE = new RegExp(String.raw`(\$|€|£|₹|₦|usd|us\$|rs\.?|inr|ngn|gbp)\s?` + NOMBRE + String.raw`\s?(k)?(?![a-z])` + PERIODE, "g");
  const MONTANT_SANS_DEVISE = new RegExp(String.raw`\b(?:salaire|salary|remuneration|paye|gagne\w*|earn\w*|revenus?|income|pay)\b[^.!?\n\d]{0,20}` + NOMBRE + String.raw`\s?(k|mille|millions?)(?![a-z])` + PERIODE, "g");

  const VALEUR_MULT = { k: 1e3, mille: 1e3, milles: 1e3, mil: 1e3, million: 1e6, millions: 1e6, m: 1e6 };

  function lireNombre(entier, decimales) {
    return parseFloat(entier.replace(/[ .,]/g, "") + (decimales ? "." + decimales : ""));
  }

  function codeDevise(d) {
    if (!d) return null;
    if (/^(?:€|euros?|eur)$/.test(d)) return "eur";
    if (/^(?:\$|usd|us\$|us ?dollars?|dollars?)$/.test(d)) return "usd";
    if (/^(?:£|gbp|pounds?)$/.test(d)) return "gbp";
    if (/^(?:cad)$/.test(d)) return "cad";
    if (/^(?:aud)$/.test(d)) return "aud";
    if (/^(?:inr|₹|rs\.?|rupees?)$/.test(d)) return "inr";
    if (/^(?:ngn|₦|naira)$/.test(d)) return "ngn";
    if (/^(?:ghs|cedis?)$/.test(d)) return "ghs";
    if (/^(?:kes|ksh)$/.test(d)) return "kes";
    if (/^(?:mad|dhs?)$/.test(d)) return "mad";
    if (/^(?:php|₱)$/.test(d)) return "php";
    if (/^(?:idr|rp)$/.test(d)) return "idr";
    return "fcfa";
  }

  // Valeur approximative en euros (seulement pour juger si un salaire est « gros »).
  const EN_EUROS = { eur: 1, usd: 0.92, gbp: 1.17, cad: 0.67, aud: 0.6, inr: 0.011, ngn: 0.0006, ghs: 0.06, kes: 0.007, mad: 0.09, php: 0.016, idr: 0.000058 };

  function lirePeriode(p) {
    if (!p) return { facteur: 1, type: "aucune" };
    if (/^(?:h|heures?|hours?|hrs?)$/.test(p)) return { facteur: 80, type: "heure" };
    if (/^(?:j|jours?|days?|daily|journees?|journaliers?|quotidiens?|soirees?|nuits?|nights?|evenings?|shifts?)$/.test(p)) return { facteur: 22, type: "jour" };
    if (/^(?:sem|semaines?|weeks?|weekly|hebdo)/.test(p)) return { facteur: 4.33, type: "semaine" };
    if (/^quinzaines?$/.test(p)) return { facteur: 2.17, type: "quinzaine" };
    if (/^(?:likes?|taches?|tasks?|avis|reviews?|videos?|abonnements?|subscriptions?|clics?|clicks?|commandes?|orders?|publications?|posts?|missions?)$/.test(p)) return { facteur: 0, type: "unite" };
    if (/^(?:mois|months?|monthly|mensuel)/.test(p)) return { facteur: 1, type: "mois" };
    return { facteur: 1 / 12, type: "an" };
  }

  function montants(ctx) {
    if (ctx._montants) return ctx._montants;
    const vue = ctx.vues[0];
    const liste = [];
    const ajouter = (m, valeur, devise, periode) => {
      const p = lirePeriode(periode);
      let type = p.type;
      let mensuel = valeur * p.facteur;
      // Un gros montant sans période en € ou $ est presque toujours annuel (« 45 000 € »).
      if (type === "aucune" && devise !== "fcfa" && valeur * EN_EUROS[devise] >= 15000) { type = "an"; mensuel = valeur / 12; }
      const pl = plage(vue, m.index, m.index + m[0].length);
      if (!pl) return;
      if (liste.some((x) => x.debut < pl.fin && pl.debut < x.fin)) return;
      liste.push({ valeur, devise, type, mensuel, debut: pl.debut, fin: pl.fin, a: m.index, b: m.index + m[0].length });
    };
    for (const m of vue.texte.matchAll(MONTANT_SUFFIXE)) {
      const [, entier, dec, mult, devise, periode] = m;
      ajouter(m, lireNombre(entier, dec) * (mult ? VALEUR_MULT[mult] : 1), codeDevise(devise), periode);
    }
    for (const m of vue.texte.matchAll(MONTANT_PREFIXE)) {
      const [, devise, entier, dec, mult, periode] = m;
      ajouter(m, lireNombre(entier, dec) * (mult ? 1e3 : 1), codeDevise(devise), periode);
    }
    for (const m of vue.texte.matchAll(MONTANT_SANS_DEVISE)) {
      const [, entier, dec, mult, periode] = m;
      const valeur = lireNombre(entier, dec) * VALEUR_MULT[mult];
      ajouter(m, valeur, valeur >= 50000 ? "fcfa" : "usd", periode);
    }
    ctx._montants = liste;
    return liste;
  }

  // Salaire mensuel (ou équivalent) jugé élevé / extrême. Les salaires annuels
  // sont ignorés : les arnaques annoncent des gains à l'heure, au jour ou à la semaine.
  const SEUIL_GROS = { eur: 4000, usd: 4000, fcfa: 400000 };
  const SEUIL_EXTREME = { eur: 15000, usd: 15000, fcfa: 3000000 };

  const SALAIRE_VANTE = R(
    String.raw`\b(?:salaire|remuneration) (?:tres )?(?:eleve|exceptionnel|enorme|tres attractif|hors norme)`,
    String.raw`\b(?:gains|revenus) illimites\b`,
    String.raw`\b(?:tres |super )?bien (?:paye|payee|remunere|remuneree)\b`,
    String.raw`\b(?:gains?|revenus?|salaire) (?:\w+ )?garantis?\b`, String.raw`\bsalaire (?:est )?(?:tres )?interessant\b`,
    String.raw`\b(?:highly paid|well paid|high salary|huge (?:salary|income)|unlimited (?:income|earnings))\b`
  );

  function depasse(x, seuils) {
    if (x.devise === "fcfa") return x.mensuel >= seuils.fcfa;
    return x.mensuel * EN_EUROS[x.devise] >= seuils.eur;
  }

  function grosSalaires(ctx, seuils) {
    return montants(ctx)
      .filter((x) => x.type !== "an" && x.type !== "unite" && depasse(x, seuils))
      .map((x) => ({ debut: x.debut, fin: x.fin }));
  }

  // Un montant sans période (donc pas un salaire) dans une phrase qui réclame un paiement.
  const DEMANDE_PAIEMENT = /\b(?:frais|payer|payez|paye[rz]? (?:les|la|le|des|un|une|l')|regler|reglez|reglement|verser|versez|versement|envoyer|envoyez|envoie[rz]?|deposer|deposez|depot|transferer|transferez|cotiser|cotisez|cotisation|contribution|participation|caution|acompte|droits? d|prix|cout|coute|coutant|tarif|achat|achete[rz]?|acheter|inscriptions?|adhesion|enregistrement|contre paiement|payante?s?|payables?|non remboursables?|non-refundable|demande\w*|reclame\w*|exige\w*|moyennant|contre la somme|in exchange for|doit|doivent|devez|dois|must|have to|need to|il (?:te|vous|me|nous)? ?faut|you need|besoin de|pour (?:ouvrir|activer|debloquer|reserver|valider|confirmer) (?:ton|votre|ta|vos|tes|son|sa) (?:compte|place|inscription|dossier|candidature|poste)|to (?:open|activate|unlock|reserve|secure|confirm) (?:your|the) (?:account|spot|place|position)|stock (?:de depart|initial)|pour (?:les|le|la|tes|vos|ton|votre|ta) (?:papiers|visa|dossier|documents|badge|formation|inscription|transport|billet|voyage|assurance)|il faut payer|vous devez payer|tu dois payer|must pay|need to pay|to pay|pay us|pay the|pay a|pay an|payment of|fees?|deposit|charges?|cost|price|buy|purchase|send)\b/;
  const IMPERATIF_PAIEMENT = /\b(?:frais|payante?|non remboursable|payer|payez|regler|reglez|verser|versez|envoyer|envoyez|deposer|deposez|transferer|transferez|cotisation|caution|inscription|acompte|il faut payer|vous devez payer|tu dois payer|must pay|need to pay|fees?|deposit)\b/;
  const MOTS_SALAIRE = /\b(?:salaire|salary|remuneration|indemnite|prime|bonus|commission|wage|paye a|paye en|fin du mois|end of (?:the )?month)\b/;
  const APRES_GRATUIT = /^[^.!?\n]{0,30}\b(?:offerte?s?|gratuite?s?|pris(?:e|es)? en charge|fournie?s?|a la charge de l'(?:entreprise|employeur)|offered|free|provided|covered|paid by)/;
  const CONTEXTE_OFFICIEL = /\b(?:tresor public|quittance|timbre fiscal|contre recu|recu officiel)\b/;

  function montantsReclames(ctx) {
    const vue = ctx.vues[0];
    const res = [];
    for (const x of montants(ctx)) {
      if (x.type !== "aucune") continue;
      const [p, q] = bornesPhrase(vue.texte, x.a, x.b);
      const phrase = vue.texte.slice(p, q);
      if (!DEMANDE_PAIEMENT.test(phrase)) continue;
      if (MOTS_SALAIRE.test(phrase) && !IMPERATIF_PAIEMENT.test(phrase)) continue;
      if (CONTEXTE_OFFICIEL.test(phrase) || AVERTISSEMENT.test(phrase)) continue;
      if (APRES_GRATUIT.test(vue.texte.slice(x.b))) continue;
      res.push({ debut: x.debut, fin: x.fin });
    }
    return res;
  }

  // ===========================================================================
  // 4. Vocabulaire partagé par plusieurs règles
  // ===========================================================================

  const CANAUX = String.raw`(?:flooz|t-?money|tmoney|mixx(?: by yas)?|moov money|mobile money|momo|mtn momo|orange money|wave|free money|airtel money|m-?pesa|wari|western union|westernunion|moneygram|money gram|ria|world ?remit|taptap send|sendwave|lemfi)`;
  const VERBES_PAYER = String.raw`(?:pay(?!s\b|sa|san)\w*|paie\w*|(?:envo|depo)(?!\w* (?:votre |ton |son |le |les |des |vos |nous |moi )?(?:cv|dossiers?|candidatures?|lettres?|demandes?|formulaires?))\w*|transf\w*|verse[rz]?|versez|versement|regle[rz]?|reglez|reglement|send\w*|achet\w*|buy\w*|purchas\w*|recharg\w*|top ?up|cotis\w*|wire)`;
  const MONTANT_TXT = String.raw`(?:(?:\$|€|£|₹|₦)\s?\d[\d.,]{0,14}|\d[\d .,]{0,14}\s?(?:k|mille|millions?)?\s?(?:fcfa|f ?cfa|f|cfa|frs?|francs?|€|euros?|\$|usd|dollars?|£|gbp|inr|₹|rs|ngn|₦|naira|ghs|cedis?|usdt)(?![a-z]))`;
  const TELETRAVAIL = R(String.raw`\b(?:teletravail|tele-travail|travail a domicile|a domicile|a distance|en ligne|full remote|remote|home office|work(?:ing)? from home|from home|wfh|online jobs?|work(?:ing)? online|jobs? en ligne|emplois? en ligne|travail en ligne|sur internet|on the internet|par internet)\b`, String.raw`\bdepuis (?:chez (?:vous|toi|soi)|votre domicile|ton domicile|la maison|votre maison|ta maison)\b`);
  const SANS_EXPERIENCE = R(
    String.raw`\bsans (?:aucune? )?(?:experience|diplome|qualification|competence)s?\b`,
    String.raw`\baucune? (?:experience|diplome|qualification|competence)s? (?:requise?s?|necessaires?|exigee?s?|demandee?s?)\b`,
    String.raw`\bpas (?:besoin )?(?:d'|de )(?:experience|diplome)\b`,
    String.raw`\bno (?:prior )?(?:experience|degree|qualifications?|skills?)\b`,
    String.raw`\bwithout (?:any )?experience\b`,
    String.raw`\bexperience (?:non requise|pas necessaire|not required|not needed)\b`,
    String.raw`\b(?:0|zero) (?:diplomes?|experiences?|degrees?)\b`
  );
  const CONTACT_GRATUIT = R(
    String.raw`\b(?:whatsapp|whats ?app|watsap+|wathsap+|whatsap|wtsp|telegram|wa\.me|t\.me)\b`,
    String.raw`[\w.+-]{1,64}@(?:gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|proton|protonmail|gmx|yandex|mail|zoho|rocketmail)\.`
  );
  const GRANDES_MARQUES = String.raw`(?:onu|nations unies|united nations|unicef|unesco|oms|pnud|undp|unhcr|hcr|fao|croix[- ]rouge|red cross|ambassade|embassy|banque mondiale|world bank|usaid|union europeenne|union africaine|cedeao|ecowas|amazon|google|microsoft|meta|tiktok|coca[- ]cola|nestle|unilever|totalenergies|total|orange|mtn|moov|togocom|ecobank|oragroup|dhl|booking(?:\.com)?|airbnb|netflix|apple|samsung|shopify|nike|adidas|pepsi|heineken|shell|maersk|air france|emirates|qatar airways|asky)`;

  // ===========================================================================
  // 5. Les règles
  // ===========================================================================

  const REGLES = [
    // ---------------------------------------------------------------- Argent
    {
      id: "frais", categorie: "argent", points: 4,
      libelle: "Frais à payer pour être embauché",
      explication: "Un vrai employeur ne fait jamais payer un candidat : ni dossier, ni inscription, ni formation, ni badge, ni visa.",
      exclure: CONTEXTE_OFFICIEL,
      detecter: montantsReclames,
      motifs: [
        R(String.raw`\bfrais (?:de |d'|du |des )?(?:dossiers?|inscriptions?|candidatures?|formations?|traitements?|visas?|assurances?|badges?|kits?|materiels?|tenues?|uniformes?|enregistrements?|validations?|activations?|ouvertures?|adhesions?|souscriptions?|visites? medicales?|medicaux|tests?|examens?|integrations?|mises? en relation|placements?|recrutements?|cartes?|logistiques?|administratifs?|service|d'agence|reservation|participation|demarrage|securite|constitution)\b`),
        R(String.raw`\b(?:payer|payez|regler|reglez|verser|versez|envoyer|envoyez|envoie|transferer|transferez|deposer|deposez|cotiser|cotisez)\b(?: (?:d'abord|seulement|uniquement|immediatement|rapidement|vite|nous|moi))?(?: (?:la somme de|un montant de|le montant de|les|la|le|l'|un|une|vos|votre|ta|tes|ton|des|d'|de))? ?(?:montant|somme|frais|caution|cotisation|droits?|acompte|contribution|participation|avance|` + MONTANT_TXT + ")"),
        R(String.raw`\bcaution (?:de \d|remboursable|obligatoire|a verser|a payer)`, String.raw`\b(?:verser|versez|payer|payez|deposer|deposez|une) (?:une )?caution\b`),
        R(String.raw`\bdroits? d'(?:inscription|entree|adhesion)\b`, String.raw`\bparticipation aux frais\b`),
        R(String.raw`\b(?:achat|achete[rz]?|acheter|acquerir|acquisition)(?: obligatoire)?(?: (?:de|d'|du|des|le|la|les|un|une|votre|ton|ta|vos|tes|notre|nos))? ?(?:kits?|packs?|starter|materiels?|tenues?|uniformes?|badges?|formations?|produits? de demarrage)\b`),
        R(MONTANT_TXT + String.raw`[^.!?\n]{0,20}\b(?:a payer|a verser|a regler|a envoyer|to pay|to be paid)\b`),
        R(String.raw`\b(?:registration|processing|application|training|onboarding|activation|visa|admin(?:istrative)?|placement|recruitment|security|equipment|starter|enrollment|enrolment|membership|certification|medical|background check|uniform|kit) (?:fees?|deposits?|charges?)\b`),
        R(String.raw`\b(?:pay|send|transfer|deposit|wire)\b(?: (?:a|an|the|your|us|me|this|small|refundable|one-time|one time|only|just)){0,3} (?:fees?|deposits?)\b`),
        R(String.raw`\b(?:you (?:must |need to |have to |will need to |should )?|to |please |kindly |must |need to |first )(?:pay|send|transfer|deposit|wire)\b(?: (?:a|an|the|us|me|only|just|first)){0,2} (?:\$ ?\d|\d[\d,.]{0,14}\s?(?:\$|usd|dollars?|€|euros?|usdt))`),
        R(String.raw`\b(?:refundable deposit|upfront (?:fee|payment|cost))\b`),
        R(String.raw`\b(?:tu dois|vous devez|il faut|il te faut|il vous faut|you (?:must|need to|have to)|you'll need to|you will need to)\b (?:juste |seulement |simplement |d'abord |just |only |first )?(?:payer|regler|verser|envoyer|avancer|pay|send|cover)\b (?:le |la |les |l'|ton |ta |tes |votre |vos |un |une |des |the |your |a |an |for )?(?:billets?|transport|voyage|visas?|papiers|dossiers?|formations?|assurances?|badges?|kits?|inscriptions?|frais|tickets?|flights?|fees?|documents?|permits?|training|insurance|registration)\b`),
        R(String.raw`\b(?:formation|test|examen|stage|inscription|candidature|dossier|training|test|exam)s? (?:obligatoires? )?payante?s?\b`),
        R(String.raw`\b(?:doit|doivent|devez|dois|must|have to|need to|il faut)\b (?:d'abord |first )?(?:acheter|prendre|payer|buy|purchase|take)\b (?:son |sa |ses |votre |ton |ta |vos |tes |un |une |le |la |les |your |a |an |the )?(?:lot|stock|kit|pack|materiel|carte sim|uniforme|tenue|badge|produits?|starter|equipment|supplies)\b`, String.raw`\bstock (?:de depart|initial)\b`)
      ],
    },
    {
      id: "paiement_canal", categorie: "argent", points: 3,
      libelle: "Paiement par mobile money ou transfert d'argent",
      explication: "Payer par Flooz, T-Money, Wave ou Western Union à un inconnu, c'est de l'argent quasi impossible à récupérer.",
      detecter(ctx) {
        const CONTEXTE = /\d|\b(?:payez|paye[rz]?|payer|envoyez|envoie[rz]?|envoyer|versez|verser|reglez|regler|deposez|deposer|transferez|transferer|frais|cotisation|caution|inscription|abonnement|uniquement|seulement|pay|send|deposit|transfer|fees?|only)\b/;
        return chercher(ctx, R(String.raw`\b` + VERBES_PAYER + String.raw`\b[^.!?\n]{0,60}?\b` + CANAUX + String.raw`\b`, String.raw`\b` + CANAUX + String.raw`\b[^.!?\n]{0,40}?\b` + VERBES_PAYER + String.raw`\b`), true, null, CONTEXTE)
          .concat(chercher(ctx, R(String.raw`\b(?:par|via|through|by|using|avec)\s` + CANAUX + String.raw`\b`, String.raw`\bnumero ` + CANAUX + String.raw`\b`, String.raw`\b` + CANAUX + String.raw` (?:au|number|numero)\b`), true));
      },
    },
    {
      id: "cartes_cadeaux", categorie: "argent", points: 4,
      libelle: "Paiement en cartes cadeaux ou coupons",
      explication: "Aucune entreprise ne paie ni ne se fait payer en cartes cadeaux (Google Play, iTunes…) ou en coupons (Transcash, PCS) : c'est la monnaie préférée des escrocs.",
      motifs: [
        R(String.raw`\b(?:achat\w*|achete\w*|acheter|buy\w*|purchas\w*|send|envo\w*|pay\w*|paie\w*|via|par|codes?)\b[^.!?\n]{0,40}?\b(?:cartes? cadeaux?|gift ?cards?|(?:google play|itunes|steam|amazon|apple|e-?gift) (?:gift )?(?:cards?|cartes?|codes?)|cartes? (?:google play|itunes|steam|amazon|apple|prepayees?)|transcash|neosurf|paysafecard|pcs mastercard|coupons? pcs)\b`),
        R(String.raw`\b(?:transcash|neosurf|paysafecard)\b`)
      ],
    },
    {
      id: "recharge", categorie: "argent", points: 4,
      libelle: "Dépôt ou « recharge » pour débloquer des gains",
      explication: "Piège de l'« arnaque aux tâches » : on te laisse gagner un peu, puis on bloque tes gains tant que tu ne recharges pas ton compte. Cet argent est perdu.",
      motifs: [
        R(String.raw`\b(?:recharge[rz]?|rechargez|recharger)\b (?:d'abord )?(?:votre |ton |son |le |du |de |d')?(?:compte|solde|portefeuille|wallet)\b`),
        R(String.raw`\b(?:retirer|debloquer|recuperer|withdraw|unlock|release|claim)\b (?:vos |tes |les |your |the )?(?:gains|commissions?|salaires?|benefices|fonds|earnings|profits?|funds|balance|money|solde)\b`),
        R(String.raw`\b(?:depot|deposit|top[- ]?up|recharge) (?:minimum|initial|de depart|obligatoire|required)\b`, String.raw`\b(?:minimum|initial|first) (?:deposit|top[- ]?up)\b`),
        R(String.raw`\b(?:niveau|level|grade|rang) vip\b`, String.raw`\bvip (?:level|niveau|\d)\b`, String.raw`\b(?:solde negatif|negative balance|taches? combinees?|combined tasks?|combo tasks?|lucky orders?|commandes? combinees?)\b`)
      ],
    },
    {
      id: "investissement", categorie: "argent", points: 3,
      libelle: "Investissement ou crypto à la clé",
      explication: "Gains garantis, capital doublé, dépôt en crypto : ce sont les promesses typiques des faux investissements.",
      motifs: [
        R(String.raw`\b(?:usdt|tether|bitcoins?|btc|eth|ethereum|crypto(?:-?monnaies?|s)?|binance|bybit|okx|trust ?wallet|metamask)\b[^.!?\n]{0,50}?\b(?:invest\w*|depo\w*|envo\w*|send|pay\w*|achet\w*|buy|recharg\w*|gagn\w*|earn\w*|rendement|profit\w*|double\w*)\b`),
        R(String.raw`\b(?:invest\w*|depo\w*|envo\w*|send|pay\w*|achet\w*|buy|recharg\w*|gagn\w*|earn\w*)\b[^.!?\n]{0,50}?\b(?:usdt|tether|bitcoins?|btc|ethereum|crypto(?:-?monnaies?|s)?|binance|trust ?wallet)\b`),
        R(String.raw`\b(?:double[rz]?|doublez|tripler|triplez|multiplie[rz]?|double|triple|multiply) (?:votre |ton |vos |tes |your |son |le |la |l'|the )?(?:argent|capital|mise|investissement|somme|gains|money|investment|income)\b`),
        R(String.raw`\b(?:rendements?|benefices?|profits?|retours? sur investissement|returns?|roi|interets?) (?:garantis?|assures?|fixes?|quotidiens?|journaliers?|guaranteed|daily|assured)\b`),
        R(String.raw`\b(?:rendement|benefice|profit|interet|return|roi) (?:de |of )?\d+ ?% (?:par|chaque|per|a|every) (?:jour|semaine|mois|day|week|month)\b`),
        R(String.raw`\b(?:placez|placer|place|investissez|investir|investis|misez|miser|mise|cotisez|invest|put in|stake)\b[^.!?\n]{0,30}` + MONTANT_TXT + String.raw`[^.!?\n]{0,40}\b(?:recevez|recevoir|recois|gagnez|gagner|touchez|toucher|obtenez|receive|get|earn|make)\b[^.!?\n]{0,20}` + MONTANT_TXT),
        R(String.raw`\binvestissement (?:de depart|initial|minimum)\b`, String.raw`\binvestissez\b`, String.raw`\binvest (?:\$|€)?\d`, String.raw`\b(?:options binaires|binary options|robot de trading|trading bot|signaux de trading|trading signals)\b`)
      ],
    },
    {
      id: "cheque", categorie: "argent", points: 4,
      libelle: "Chèque à encaisser puis argent à renvoyer",
      explication: "Arnaque au faux chèque : il sera rejeté quelques jours plus tard, mais l'argent que tu auras renvoyé est perdu.",
      motifs: [
        R(String.raw`\bencaisse[rz]? (?:le |ce |un |votre |des |les |vos |nos )?cheques?\b`, String.raw`\bcheque (?:de banque )?a (?:deposer|encaisser)\b`, String.raw`\b(?:cash|deposit) (?:the|a|this) (?:check|cheque)\b`, String.raw`\b(?:send|we will send|we'll send) you a (?:check|cheque)\b`, String.raw`\bvous (?:allez |)recev\w* un cheque\b`, String.raw`\b(?:je|nous|on) (?:vous |te |t')?(?:enverr\w*|envoie\w*|envoy\w*|ferai parvenir|ferons parvenir|poste\w*) (?:un |le |votre |ton )?cheque\b`, String.raw`\bcheque (?:d'avance|en avance|anticipe)\b`, String.raw`\badvance (?:check|cheque)\b`)
      ],
    },
    {
      id: "mule", categorie: "argent", points: 4,
      libelle: "Recevoir ou faire transiter de l'argent",
      explication: "Faire passer de l'argent par ton compte fait de toi une « mule » : c'est souvent de l'argent volé, et c'est toi que la police retrouvera.",
      motifs: [
        R(String.raw`\b(?:recevoir|receptionner|recevrez|receive|receiving)\b (?:des |de l'|les |the |a |an |un |une )?(?:fonds|paiements?|virements?|transferts?|argent|payments?|funds|money|transfers?|salaires|salaries|wages)\b[^.!?\n]{0,40}\b(?:sur|dans|on|into|to|in) (?:votre|ton|your|his|her|their|son|sa) (?:compte|account)`),
        R(String.raw`\b(?:redistribu\w*|reverse[rz]?|reverser)\b[^.!?\n]{0,40}\b(?:via|par|through|by)\b`),
        R(String.raw`\b(?:recevoir|receive|receptionner)\b (?:des |de |the )?(?:paiements?|payments?|fonds|funds|virements?|transferts?)\b[^.!?\n]{0,60}\b(?:convertir|convert|transferer|transfer|renvoyer|forward|envoyer|send|reverser)\b`),
        R(String.raw`\b(?:send|renvoye[rz]?|renvoyer|transfer|forward|wire)\b (?:it|them|the money|l'argent|les fonds|le tout|the funds)? ?back\b`, String.raw`\bsend (?:it|them|the money|the funds) back\b`, String.raw`\brenvoyer l'argent\b`, String.raw`\b(?:depot|transfert|versement|envoi|deposit|transfer) (?:du|of the) (?:reste|surplus|solde|restant|remainder|rest|balance)\b`),
        R(String.raw`\b(?:nous allons|on va|we will|we'll|i will|je vais)\b[^.!?\n]{0,15}\b(?:vous|te|you)\b[^.!?\n]{0,5}\b(?:envoyer|send|transferer|virer|deposer)\b[^.!?\n]{0,60}\b(?:sur (?:votre|ton) compte|to your account|into your account)`),
        R(String.raw`\b(?:ouvrir|ouvrez|ouvre|creer|creez|cree|open|create)\b (?:des |un |une |plusieurs |several |an? |new )?(?:comptes?|accounts?|lignes?|puces?|cartes? sim)\b[^.!?\n]{0,60}\b(?:avec (?:vos|tes|votre|ta) (?:papiers|pieces|identite|cni|nom)|a (?:votre|ton) nom|in your name|with your (?:id|documents|name))`, String.raw`\b(?:transmettre|donner|partager|nous transmettre|give us|share)\b (?:les |the )?(?:acces|access|logins?|identifiants)\b`),
        R(String.raw`\bil (?:faut|suffit) (?:juste |seulement |simplement )?(?:d')?(?:avoir )?un compte (?:mobile money|flooz|t-?money|momo|bancaire|wave)\b`, String.raw`\b(?:compte|account) (?:mobile money|flooz|t-?money|momo|bancaire|bank) actif\b`, String.raw`\bactive (?:bank|mobile money) account\b`),
        R(String.raw`\b(?:recevoir|receive) (?:des |de l')?(?:virements|paiements|fonds|payments|funds) sur (?:votre|ton) compte\b`),
        R(String.raw`\b(?:renvoye\w*|envoye[rz]?|envoyez|reverse\w*|transfere\w*|send back|send|forward|wire) (?:le reste|la difference|le surplus|le solde|le restant|the rest|the remainder|the balance|the difference)\b`),
        R(String.raw`\bagent (?:financier|de paiement|de transfert|de transactions)\b`, String.raw`\b(?:payment|financial|transfer|money) (?:processing )?(?:agent|manager|representative)\b`, String.raw`\bgestionnaire de (?:transactions|fonds|paiements)\b`),
        R(String.raw`\b(?:preter|pretez|louer|louez|utiliser|use) (?:votre|ton|your) (?:compte|account)(?: bancaire| mobile money| flooz| t-?money| bank)?\b`)
      ],
    },
    {
      id: "colis", categorie: "schemas", points: 4,
      libelle: "Recevoir des colis chez toi pour les réexpédier",
      explication: "Recevoir puis réexpédier des colis pour un inconnu sert souvent à écouler des marchandises volées : tu deviens complice sans le savoir.",
      motifs: [
        R(String.raw`\b(?:recevoir|recevrez|recevras|recois|recevez|receptionner|receive)\b (?:des |les |de |the )?(?:colis|packages?|parcels?|paquets)\b[^.!?\n]{0,30}\b(?:chez (?:vous|toi)|a (?:votre|ton) domicile|at (?:your )?home|a (?:votre|ton) adresse|at your address)`),
        R(String.raw`\b(?:reexpedi\w*|reship\w*|repackag\w*|re-?expedi\w*|relabel\w*)\b`, String.raw`\b(?:changes?|changez|changer|remplace[rz]?|change|replace)\b (?:les |the )?(?:etiquettes|labels|adresses|shipping labels)\b`, String.raw`\b(?:agent de reexpedition|package (?:handler|forwarder|inspector)|parcel forwarding)\b`)
      ],
    },

    // ------------------------------------------------- Codes et données
    {
      id: "code_secret", categorie: "secrets", points: 5,
      libelle: "Code reçu par SMS ou mot de passe demandé",
      explication: "Un code reçu par SMS ou un mot de passe sert à prendre le contrôle de ton WhatsApp, de ton mobile money ou de ta banque. Personne n'en a besoin pour recruter.",
      detecter(ctx) {
        // On cherche, dans une même phrase, un « secret » et une demande de le transmettre.
        const OBJET = /\b(?:codes?|otp|pin|mots? de passe|passwords?|passcodes?|identifiants|credentials|logins?)\b/g;
        const SECRET_PAR_NATURE = /^(?:otp|pin|mots? de passe|passwords?|passcodes?|identifiants|credentials|logins?)$/;
        const DEMANDE = /\b(?:envoyant|transmettant|communiquant|partageant|donnant|sending|sharing|giving|forwarding|envoyez|envoie|envoyer|transmettez|transmets|transmettre|donnez|donne|donner|communiquez|communique|communiquer|partagez|partage|partager|dictez|dicte|dicter|indiquez|indique|indiquer|fournissez|fournis|fournir|renvoyez|renvoie|renvoyer|repondez|reponds|send|share|give|tell|forward|provide|text|reply)\b(?! (?:you|vous|te|t'))|\betre (?:communique|transmis|envoye|partage|donne)\b|\b(?:me|nous) (?:le|la|les) (?:transmettre|envoyer|communiquer|donner|dicter|partager)\b/;
        const QUALIF = /\b(?:verification|confirmation|validation|securite|activation|acces|connexion|whatsapp|telegram|sms|texto|otp|secret|pin|recu|recevrez|recevras|recevoir|received|receive|chiffres|digit|affiche|cvv|cvc|carte|card|cadeau|gift|recharge)/;
        const EXCLU = /^s? (?:de l'offre|du poste|postal|source|promo|de reference|ref|de conduite|du travail|github|de la route|qr)/;
        const res = [];
        for (const vue of ctx.vues) {
          for (const m of vue.texte.matchAll(OBJET)) {
            const a = m.index;
            const b = a + m[0].length;
            const [p, q] = bornesPhrase(vue.texte, a, b);
            const phrase = vue.texte.slice(p, q);
            if (!DEMANDE.test(phrase)) continue;
            if (!SECRET_PAR_NATURE.test(m[0]) && !QUALIF.test(phrase)) continue;
            if (EXCLU.test(vue.texte.slice(b, b + 25))) continue;
            if (estNie(vue.texte, a, b)) continue;
            // Surligner de la demande jusqu'au « secret » (s'ils sont proches).
            const d = DEMANDE.exec(phrase);
            let x = a, y = b;
            if (d) {
              const da = p + d.index, db = da + d[0].length;
              if (Math.max(b, db) - Math.min(a, da) <= 140) { x = Math.min(a, da); y = Math.max(b, db); }
            }
            const pl = plage(vue, x, y);
            if (pl) res.push(pl);
          }
        }
        res.push(...chercher(ctx, R(String.raw`\bcode (?:secret|pin) (?:de |du |de votre |de ton |of your )?(?:compte|flooz|t-?money|momo|mobile money|carte|account|card)\b`), true));
        return res;
      },
    },
    {
      id: "carte_bancaire", categorie: "secrets", points: 4,
      libelle: "Informations de carte bancaire demandées",
      explication: "Le numéro de carte, la date d'expiration et le code CVV suffisent pour vider ta carte. Un employeur n'en a jamais besoin.",
      motifs: [
        R(String.raw`\b(?:numeros?|n°|code|date d'expiration|date d'expi\w*|cryptogramme)\b[^.!?\n]{0,25}\b(?:carte (?:bancaire|de credit|visa|mastercard|de paiement)|cartes? bancaires?|(?:credit|debit) cards?)\b`),
        R(String.raw`\b(?:cvv2?|cvc|cryptogramme visuel|card number|card details|expiry date)\b`, String.raw`\bnumeros? de (?:votre |ta |ton )?carte\b(?! (?:grise|d'identite|nationale|de sejour|d'electeur|professionnelle|sim|d'etudiant))`)
      ],
    },
    {
      id: "coordonnees_bancaires", categorie: "secrets", points: 1,
      libelle: "Coordonnées bancaires évoquées (RIB, IBAN…)",
      explication: "Tes coordonnées bancaires ne se donnent qu'après la signature d'un vrai contrat, jamais dès le premier échange.",
      motifs: [
        R(String.raw`\b(?:rib|iban|swift)\b`, String.raw`\b(?:coordonnees|informations|details|infos|references) bancaires\b`, String.raw`\bnumero de compte(?: bancaire)?\b`, String.raw`\b(?:bank (?:details|account (?:number|details)|login)|account number|routing number|sort code)\b`, String.raw`\b(?:ssn|social security number|numero de securite sociale)\b`)
      ],
    },
    {
      id: "banque_demandee", categorie: "secrets", points: 3,
      libelle: "Coordonnées bancaires demandées à distance",
      explication: "On te réclame tes coordonnées bancaires par message, avant tout contrat signé : elles peuvent servir à faire passer de l'argent sale par ton compte ou à te prélever.",
      exclure: /\b(?:a l'embauche|lors de (?:la )?signature|apres (?:la )?signature|a la signature|pour la signature|at onboarding|after signing|passe[rz]?|presentez|a nos bureaux|au siege|sur place|in person)\b/,
      motifs: [
        R(String.raw`\b(?:envoie[sz]?|envoyer|envoyez|donne[sz]?|donner|communique[rz]?|communiquez|transmet\w*|fourni\w*|remplir|remplissez|indique[rz]?|il me faut|il nous faut|j'ai besoin de|nous avons besoin de|send|give|provide|share|fill|need)\b[^.!?\n]{0,40}\b(?:coordonnees bancaires|informations bancaires|infos bancaires|details bancaires|rib|iban|numero de compte|bank (?:details|account details|account number|information)|account number)\b`)
      ],
    },
    {
      id: "piece_identite", categorie: "secrets", points: 1,
      libelle: "Copie de pièce d'identité demandée",
      explication: "Une copie de ta pièce d'identité peut servir à usurper ton identité. Ne l'envoie qu'à une entreprise que tu as vérifiée.",
      motifs: [
        R(String.raw`\b(?:copies?|copy|photocopies?|scanned copy|photos?|scans?|images?|captures?|pictures?) (?:recto[- ]verso |legalisees? )?(?:de |d'|de la |du |de votre |de ta |of (?:your )?|of the )?(?:votre |ta |your )?(?:pieces? d'identite|cartes? d'identite|cartes? nationales? d'identite|cni|passeports?|passports?|permis de conduire|id cards?|identity cards?|driver'?s licen[cs]es?|national id|id)\b`),
        R(String.raw`\b(?:pieces? d'identite|cartes? d'identite|cni|passeports?|passports?|id cards?) (?:recto[- ]verso|front and back)\b`)
      ],
    },
    {
      id: "selfie", categorie: "secrets", points: 3,
      libelle: "Selfie avec ta pièce d'identité",
      explication: "Un selfie avec ta pièce d'identité permet d'ouvrir des comptes (banque, mobile money, crypto) à ton nom.",
      motifs: [
        R(String.raw`\bselfies? (?:avec|tenant|en tenant|with|holding)\b`, String.raw`\b(?:photo|video) (?:de vous |de toi |of you )?(?:tenant|holding) (?:votre|ta|your)\b`, String.raw`\b(?:verification faciale|verification du visage|face verification|facial verification)\b`)
      ],
    },

    // ------------------------------------------------ Contacts, liens, applis
    {
      id: "appli", categorie: "contact", points: 3,
      libelle: "Appli ou fichier à installer",
      explication: "Une appli inconnue (surtout un fichier .apk hors Play Store) peut espionner ton téléphone ou voler tes comptes.",
      exclure: /\b(?:play ?store|app ?store|google play|apple store|galaxy store)\b/,
      motifs: [
        R(String.raw`\b(?:install\w*|telecharg\w*|download\w*)\b(?:[ -](?:moi|nous|vous|toi|le|maintenant|vite|d'abord|now|first|immediately|immediatement|gratuitement|aussi|also|simplement|just))*[ -]?(?:l'|la |le |cette |notre |nos |une |un |ton |votre |the |our |this |an |a |cet )(?:[\w'-]+ ){0,2}?(?:appli\w*|app|apps|apk|logiciel|software|programme)\b`),
        R(String.raw`\b(?:install\w*|telecharg\w*|download\w*)\b (?:[\w'-]+ ){0,2}?(?:whatsapp|telegram|signal|imo|wechat|viber)\b`),
        R(String.raw`\.apk\b`, String.raw`\bapk\b`)
      ],
    },
    {
      id: "acces_distance", categorie: "contact", points: 4,
      libelle: "Logiciel de prise de contrôle à distance",
      explication: "AnyDesk, TeamViewer et compagnie donnent le contrôle total de ton appareil à quelqu'un d'autre. Aucun entretien d'embauche n'en a besoin.",
      motifs: [
        R(String.raw`\b(?:anydesk|any desk|teamviewer|team viewer|rustdesk|ultraviewer|ultra viewer|quicksupport|quick support|supremo|aeroadmin|ammyy|splashtop|zoho assist|logmein|chrome remote desktop)\b`)
      ],
    },
    {
      id: "lien_court", categorie: "contact", points: 2,
      libelle: "Lien raccourci",
      explication: "Un lien raccourci cache sa vraie destination : impossible de savoir où il mène avant de cliquer.",
      motifs: [
        R(String.raw`\b(?:bit\.ly|bitly\.com|tinyurl\.com|t\.co|goo\.gl|cutt\.ly|is\.gd|v\.gd|ow\.ly|rb\.gy|shorturl\.at|tiny\.cc|t\.ly|s\.id|rebrand\.ly|buff\.ly|shorte\.st|adf\.ly|bl\.ink|lnkd\.in|qrco\.de|short\.io|x\.co|tr\.im|clck\.ru|surl\.li|urlz\.fr|kutt\.it|dub\.sh|shorturl\.asia|cutt\.us|u\.to|tinu\.be|gg\.gg)\/[\w\-\/?=&.%]*[\w\/]`)
      ],
    },
    {
      id: "lien_suspect", categorie: "contact", points: 2,
      libelle: "Lien vers une adresse douteuse",
      explication: "Ce lien mène vers une adresse inhabituelle (adresse IP, extension très utilisée par les escrocs, caractères trompeurs…). N'y saisis rien.",
      motifs: [
        R(String.raw`\bhttps?:\/\/\d{1,3}(?:\.\d{1,3}){3}\S*`, String.raw`\bhttps?:\/\/[^\s\/]*@\S+`, String.raw`\bxn--[\w-]+\.\w+\S*`),
        R(String.raw`(?:\bhttps?:\/\/|\bwww\.)[^\s\/]{1,200}\.(?:xyz|top|click|icu|buzz|tk|ml|ga|cf|gq|work|loan|win|bid|rest|cyou|monster|sbs|cfd|lol|quest|vip|club|online|site|fun|space|pw|shop|zip|mov|bond|cam|cc|su)(?=[\/:\s?#]|$)\S*`, String.raw`\b[\w-]{1,63}\.(?:xyz|top|click|icu|buzz|tk|ml|ga|cf|gq|cyou|monster|sbs|cfd|vip|online|site|shop)\/\S*`)
      ],
    },
    {
      id: "telegram", categorie: "contact", points: 2,
      libelle: "Contact par Telegram ou groupe d'invitation",
      explication: "Telegram et les liens d'invitation de groupes sont le terrain de jeu des « arnaques aux tâches » : les faux recruteurs y restent anonymes.",
      motifs: [
        R(String.raw`\b(?:t|telegram)\.me\/[\w+]+`, String.raw`\bchat\.whatsapp\.com\/\w*`, String.raw`\btelegram\b`, String.raw`\b(?:wechat|viber)\b`)
      ],
    },
    {
      id: "whatsapp", categorie: "contact", points: 1,
      libelle: "Contact par WhatsApp",
      explication: "Une vraie entreprise a en général un site, une adresse e-mail à son nom et un numéro fixe. Un contact seulement par WhatsApp est fréquent chez les escrocs.",
      motifs: [
        R(String.raw`\b(?:whatsapp|whats ?app|watsap+|wathsap+|whatsap|wtsp)\b(?=[^.!?\n]{0,15}(?:\+|\d|:))`, String.raw`\bwa\.me\/\d*`, String.raw`\bapi\.whatsapp\.com\b`),
        R(String.raw`\b(?:ecri\w*|contacte\w*|ajoute\w*|joins|joindre|text|add|dm|inbox|reach|ping|reponds|repondez|reply|appel\w*|message[rz]?)\b[^.!?\n]{0,30}\b(?:whatsapp|whats ?app|watsap+|wtsp|whatsap)\b`)
      ],
    },
    {
      id: "email_gratuit", categorie: "contact", points: 1,
      libelle: "Adresse e-mail gratuite (Gmail, Yahoo…)",
      explication: "Une entreprise établie utilise souvent une adresse à son nom (@entreprise.tg) plutôt qu'une adresse Gmail ou Yahoo.",
      negation: false,
      motifs: [
        R(String.raw`[\w.+-]{1,64}@(?:gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|proton|protonmail|gmx|yandex|mail|zoho|rocketmail)\.[a-z.]{2,6}`)
      ],
    },
    {
      id: "marque_contact", categorie: "contact", points: 2,
      libelle: "Grande organisation, mais contact par messagerie ou Gmail",
      explication: "Une grande entreprise ou organisation qui recrute via WhatsApp, Telegram ou Gmail : c'est très souvent une usurpation de son nom.",
      detecter(ctx) {
        const marque = chercher(ctx, R(
          String.raw`\b(?:chez|de la part de|from|at|with|avec|pour le compte de|au nom de|service recrutement de|recrutement de|rh de|hr (?:team|department) (?:of|at))\s(?:l'|la |le )?` + GRANDES_MARQUES + String.raw`\b`,
          String.raw`\b(?:l'|la |le )?` + GRANDES_MARQUES + String.raw` (?:recrute\w*|recruitment|recruiting|is hiring|hiring|hr|rh|careers?)\b`
        ), true);
        const chef = chercher(ctx, R(String.raw`\b(?:drh|dg|pdg|directeur|directrice|ceo|director|hr manager|responsable rh|chef du personnel)\b[^.!?\n]{0,30}\b(?:sur|on|via|par) (?:whatsapp|telegram)\b`), true);
        if (chef.length) return chef;
        if (!marque.length) return [];
        const contact = chercher(ctx, CONTACT_GRATUIT, false);
        return contact.length ? [marque[0], contact[0]] : [];
      },
    },

    // -------------------------------------------------- Promesses trop belles
    {
      id: "teletravail_gros", categorie: "promesses", points: 2,
      libelle: "Travail à domicile + gros salaire",
      explication: "Un salaire élevé pour un travail à domicile peu décrit : classique des fausses offres.",
      detecter(ctx) {
        const t = chercher(ctx, TELETRAVAIL, true);
        if (!t.length) return [];
        if (/\b(?:test technique|entretiens?|interviews?|technical test|cdi|cdd|annees? d'experience|ans d'experience|years? of experience)\b/.test(ctx.vues[0].texte) && !/\b(?:sans|no|without|pas d')\s?(?:\w+ )?(?:entretien|interview)/.test(ctx.vues[0].texte)) return [];
        const s = grosSalaires(ctx, SEUIL_GROS).concat(chercher(ctx, SALAIRE_VANTE, true));
        return s.length ? [t[0], s[0]] : [];
      },
    },
    {
      id: "sans_experience_gros", categorie: "promesses", points: 2,
      libelle: "Beaucoup d'argent sans expérience",
      explication: "Un gros salaire sans expérience ni diplôme : trop beau pour être vrai.",
      negation: false,
      detecter(ctx) {
        const e = chercher(ctx, SANS_EXPERIENCE, false);
        if (!e.length) return [];
        const s = grosSalaires(ctx, SEUIL_GROS).concat(chercher(ctx, SALAIRE_VANTE, true));
        return s.length ? [e[0], s[0]] : [];
      },
    },
    {
      id: "salaire_extreme", categorie: "promesses", points: 2,
      libelle: "Montant anormalement élevé",
      explication: "Ce montant (ramené au mois) est très au-dessus des salaires habituels.",
      detecter: (ctx) => grosSalaires(ctx, SEUIL_EXTREME),
    },
    {
      id: "gains_promis", categorie: "promesses", points: 2,
      libelle: "Argent facile promis",
      explication: "Une vraie offre décrit le poste et les missions ; une arnaque met en avant l'argent facile.",
      motifs: [
        R(String.raw`\bgagne\w* (?:jusqu'a |entre |plus de |facilement |chaque jour |par jour |au moins |rapidement |)` + MONTANT_TXT),
        R(String.raw`\bgains? ?: ?` + MONTANT_TXT, String.raw`\b(?:je me fais|je gagne|on gagne|tu peux gagner|vous pouvez gagner|tu peux te faire|you can (?:earn|make)|i (?:make|earn)|people (?:make|earn))\b[^.!?\n]{0,20}` + MONTANT_TXT),
        R(String.raw`\b(?:salaire|remuneration|revenus?|gains?)(?: \w+)? garantis?\b`, String.raw`\bguaranteed (?:salary|income|pay|earnings|daily (?:pay|income))\b`),
        R(String.raw`\b(?:earn|make|making|earning)\w* (?:up to |between |over |from |at least |around |about |)(?:(?:\$|€|usd ?|us\$)\s?\d|\d[\d,.]{0,14}\s?(?:k\s?)?(?:\$|usd|dollars?|€|euros?|fcfa))`),
        R(String.raw`\b(?:argent facile|gains? (?:rapides?|faciles?|illimites?|garantis?|quotidiens?|journaliers?|instantanes?)|revenus? (?:passifs?|illimites?|garantis?|faciles?|quotidiens?)|devenez riches?|devenir riches?|independance financiere|easy money|quick money|fast money|passive income|unlimited (?:income|earnings)|financial freedom|get rich|make money (?:online|from home|fast|easily)|earn money (?:online|from home|fast|easily|daily)|gagnez de l'argent|gagner de l'argent (?:facilement|rapidement|depuis|sans|en ligne|chez))\b`),
        R(String.raw`\b(?:travail|job|boulot|emploi|taches?|missions?|work) (?:en ligne |a domicile |online |from home |simples? |faciles? |easy )?(?:et |and |, )?(?:tres |super |bien |well |highly )(?:payes?|payees?|remuneres?|remunerees?|paid)\b`, String.raw`\b(?:travail|job|boulot|taches?|missions?|work) (?:simples?|faciles?|easy)(?: et| and|,)? (?:payes?|payees?|remuneres?|remunerees?|paid)\b`),
        R(String.raw`\b` + MONTANT_TXT + String.raw`[^.!?\n]{0,30}\b(?:a vie|for life|chaque (?:semaine|jour|mois) a vie)\b`)
      ],
    },
    {
      id: "paiement_journalier", categorie: "promesses", points: 1,
      libelle: "Paiement chaque jour ou retrait instantané",
      explication: "Paiement quotidien, retrait instantané : promesse typique des plateformes d'arnaque en ligne.",
      motifs: [
        R(String.raw`\b(?:paye|payee|payes|payees|remunere\w*|paid)\b (?:chaque jour|tous les jours|quotidiennement|a la journee|daily|every day|each day|same day|par jour)\b`),
        R(String.raw`\b(?:paiement|retrait|versement|payout|withdrawal|payment)s? (?:journaliers?|quotidiens?|immediats?|instantanes?|chaque jour|daily|instant|immediate|same[- ]day)\b`),
        R(String.raw`\b(?:salaire|remuneration) (?:journalier|quotidien|daily)\b`, String.raw`\bsalaire (?:verse |paye )?chaque jour\b`, String.raw`\bdaily (?:pay|payment|payout|salary|withdrawals?)\b`, String.raw`\b(?:retrait|withdraw)\w* (?:a tout moment|anytime|instantly)\b`)
      ],
    },
    {
      id: "taches", categorie: "schemas", points: 4,
      libelle: "Payé pour liker, noter ou s'abonner",
      explication: "C'est l'« arnaque aux tâches » : les premiers gains sont réels, puis on te demande de payer pour continuer ou pour retirer ton argent.",
      detecter(ctx) {
        const ACTION = String.raw`(?:liker|like[rz]?|likes|liking|aime[rz]?|aimer|follow\w*|suivre|abonne[rz]?|abonnez|s'abonner|subscrib\w*|regarde[rz]?|regarder|watch\w*|visionne\w*|clique[rz]?|click\w*|booste[rz]?|boost\w*)`;
        const OBJET = String.raw`(?:videos?|pubs?|publicites?|publications?|posts?|pages?|chaines?|channels?|comptes? (?:tiktok|instagram|youtube)|annonces?|ads?|tiktok|youtube|instagram|facebook|liens?|links?)`;
        const ACTION_AVIS = String.raw`(?:note[rz]?|noter|evaluer|evalue[rz]?|rat(?:e|es|ing|ings)|review\w*|optimise[rz]?|optimiz\w*|complet\w*|soumet\w*|submit\w*|tester|testez|test)`;
        const COMMERCE = String.raw`(?:produits?|products?|hotels?|applications?|apps?|restaurants?|films?|movies?|commandes?|orders?|amazon|google maps|trip ?advisor|booking|businesses|commerces|boutiques|shops?|merchants?|taches|tasks)`;
        const AVIS = String.raw`\b(?:publier|publiez|poster|postez|laisser|laissez|donner|donnez|ecrire|ecrivez|rediger|redigez|mettre|mettez|give|giving|leave|leaving|write|writing|post|posting)\b (?:[\w'-]+ ){0,3}?(?:avis|reviews?|ratings?|notes?|etoiles|stars|5[- ]?star\w*|5[- ]?etoiles|commentaires positifs)\b`;
        const PAYE = R(MONTANT_TXT, String.raw`(?:\$|€)\s?\d`, String.raw`\b(?:par|per) (?:like|tache|task|video|avis|review|abonnement|subscription|clic|click|follow|publication|commande|order|post)\b`, String.raw`\b(?:commissions?|paye\w*|payment|paid|remunere\w*|gagne\w*|earn\w*|salaire|salary)\b`);
        const actions = chercher(ctx, R(String.raw`\b` + ACTION + String.raw`\b (?:[\w'-]+ ){0,3}?` + OBJET + String.raw`\b`, String.raw`\b` + ACTION_AVIS + String.raw`\b (?:[\w'-]+ ){0,3}?` + COMMERCE + String.raw`\b`, AVIS), true);
        const directs = chercher(ctx, R(
          String.raw`\b(?:par|per) (?:like|tache|task|video (?:regardee|vue)|avis|review|abonnement|subscription|clic|click|follow)\b`,
          String.raw`\b(?:taches?|tasks?|missions?) (?:simples?|faciles?|quotidiennes?|journalieres?|en ligne|easy|simple|daily|online)(?: et| and|,)? (?:bien |tres bien |well |highly )?(?:remunerees?|payees?|paid)\b`,
          String.raw`\b(?:task|taches?) (?:center|centre|hall|platform|plateforme)\b`,
          String.raw`\b(?:order|commande) (?:grabbing|tasks?)\b`,
          String.raw`\b(?:hotel|product|produit) (?:reviews?|ratings?|avis)\b[^.!?\n]{0,30}(?:\$|€|\d)`,
          String.raw`\b\d+ ?(?:avis|likes?|reviews?|taches?|tasks?|videos?|abonnements?) ?(?:=|:|->|→) ?\d`,
          String.raw`\b(?:after|apres) (?:each|every|chaque) (?:task|tache|mission|avis|review|order|commande)\b`,
          String.raw`\b(?:chaque|each|every|1|un|une|one) (?:like|avis|review|tache|task|video|abonnement|clic|click|follow|subscription)s? (?:=|earns?|pays?|rapporte|vaut|gives?|paye|donne)\b`,
          String.raw`\b(?:plateforme|site|appli\w*|app|application|platform)s? (?:qui|that|which) (?:paie|paye|pays|remunere)\b`,
          String.raw`\b(?:paye\w*|remunere\w*|paid|get paid) (?:\w+ )?(?:pour|to) (?:regarder|liker|aimer|noter|evaluer|tester|watch|like|rate|review|follow|test|s'abonner)\b`,
          String.raw`\b(?:pays?|paie|paye|payons) (?:people|des gens|les gens|des personnes|you|vous|te|toi) (?:to|pour) (?:test|watch|like|rate|review|follow|tester|regarder|liker|aimer|noter|evaluer|s'abonner|cliquer|click)\b`
        ), true);
        if (directs.length) return directs.concat(actions);
        if (actions.length && present(ctx, PAYE, false)) return actions;
        return [];
      },
    },
    {
      id: "travail_facile", categorie: "promesses", points: 1,
      libelle: "Travail présenté comme très simple",
      explication: "Un travail « très simple », sur téléphone, quelques minutes par jour : appât fréquent.",
      motifs: [
        R(String.raw`\b(?:travail|job|boulot|emploi|taches?|missions?|work|tasks?) (?:tres |super |ultra )?(?:simples?|faciles?|easy)\b`, String.raw`\b(?:simple|easy) (?:jobs?|work|tasks?)\b`),
        R(String.raw`\b(?:il suffit d'(?:un|une|avoir)|juste besoin d'un|seulement (?:besoin )?d'un|tout ce qu'il (?:vous|te) faut(?: c'est)?|all you need is|you only need|only need) (?:\w+ )?(?:smartphone|telephone|portable|phone|connexion|internet)\b`),
        R(String.raw`\b(?:depuis|sur|avec|from|on) (?:votre|ton|ta|your) (?:telephone|smartphone|portable|phone)\b`, String.raw`(?:^|[.!?\n] ?)(?:juste|seulement|just|only) (?:un |a |ton |your )?(?:telephone|smartphone|portable|phone)\b`),
        R(String.raw`\b(?:[12]|une|deux) ?(?:h|heures?|hours?)\b (?:de travail )?(?:par|a|per|chaque|each) ?(?:jour|day)\b`, String.raw`\b\d{1,2} ?(?:min|minutes) (?:par|a|per|chaque|each) ?(?:jour|day)\b`)
      ],
    },
    {
      id: "sans_entretien", categorie: "promesses", points: 2,
      libelle: "Embauche garantie ou sans entretien",
      explication: "Une vraie embauche passe par un entretien. « Embauche garantie » ou « sans entretien » est un signal d'alarme.",
      negation: false,
      motifs: [
        R(String.raw`\b(?:sans|aucun|no|without)\b ?(?:\w+ )?(?:entretiens?|interviews?)\b`, String.raw`\bpas d'(?:\w+ )?(?:entretiens?|interviews?)\b`, String.raw`\b(?:sans|without (?:an? )?)(?:concours|test|examen|exam|selection)\b`),
        R(String.raw`\b(?:embauche|recrutement|emploi|poste|job|travail|hiring|employment|position)s? (?:directe? |immediate? |)?(?:garanti|garantie|assure|assuree|guaranteed|100 ?%)\b`, String.raw`\b(?:garanti|guaranteed) (?:job|employment|hiring|embauche|emploi|poste)\b`, String.raw`\bhired (?:immediately|instantly|today|on the spot)\b`),
        R(String.raw`\b(?:tout le monde|everyone|anyone|n'importe qui) (?:est |is |peut |can )(?:accepte|accepted|postuler|apply|eligible|join)\b`)
      ],
    },
    {
      id: "contact_spontane", categorie: "promesses", points: 1,
      libelle: "Contact spontané : « on a trouvé ton CV / ton numéro »",
      explication: "On te contacte sans que tu aies postulé ? Vérifie bien qui est derrière, surtout si on te demande ensuite quelque chose.",
      motifs: [
        R(String.raw`\b(?:trouve|vu|recupere|found|came across|saw|got|obtained|picked)\b (?:\w+ )?(?:votre|ton|your) (?:cv|profil|profile|resume|numero|number|contact|coordonnees)\b`),
        R(String.raw`\b(?:votre|ton|your) (?:profil|profile|cv|resume|contact) (?:a ete|nous a ete|was|has been) (?:\w+ )?(?:selectionne\w*|recommande\w*|choisi\w*|selected|recommended|shortlisted|chosen|picked)\b`)
      ],
    },
    {
      id: "numero_tire", categorie: "schemas", points: 2,
      libelle: "« Ton numéro a été sélectionné »",
      explication: "Personne ne recrute en « tirant au sort » des numéros de téléphone : c'est l'accroche des loteries et des arnaques aux tâches.",
      motifs: [R(String.raw`\b(?:votre|ton|your) (?:numero|number|phone number|mobile number|numero de telephone|numero whatsapp) (?:de telephone )?(?:a ete|nous a ete|was|has been|est) (?:\w+ )?(?:selectionne\w*|tire\w*|retenu\w*|choisi\w*|gagnant\w*|selected|chosen|picked|drawn|randomly selected)\b`)],
    },
    {
      id: "felicitations", categorie: "pression", points: 1,
      libelle: "« Félicitations, vous êtes sélectionné »",
      explication: "Les félicitations ou une « sélection » surprise précèdent souvent une demande d'argent ou de documents.",
      motifs: [
        R(String.raw`\b(?:vous avez|tu as|you have|you've|you) (?:ete|been) (?:\w+ )?(?:selectionne\w*|retenu\w*|choisi\w*|preselectionne\w*|selected|chosen|shortlisted|hired)\b`),
        R(String.raw`\bfelicitations?\b[^.!?\n]{0,50}\b(?:recrutement|embauche|poste|selection|retenu\w*|selectionne\w*|recrute\w*)`, String.raw`\bcongratulations?\b[^.!?\n]{0,50}\b(?:hired|selected|position|job|offer|recruited)`)
      ],
    },
    {
      id: "etranger", categorie: "schemas", points: 2,
      libelle: "Emploi à l'étranger avec visa ou billet promis",
      explication: "Les fausses offres à l'étranger promettent visa et billet d'avion, puis réclament des « frais de visa » ou de dossier.",
      motifs: [
        R(String.raw`\b(?:visas?|billets? d'avion|permis de travail|work permits?|titre de sejour|flight tickets?|air tickets?)\b[^.!?\n]{0,40}\b(?:offerts?|pris en charge|gratuits?|payes?|fournis?|garantis?|inclus|free|paid|provided|sponsored|covered|assures?)\b`),
        R(String.raw`\bvisa sponsorship\b`, String.raw`\bsponsoris\w* (?:le |votre |ton |your )?visa\b`, String.raw`\b(?:loterie|lottery) (?:visa|dv|americaine|green card)\b`),
        R(String.raw`\b(?:emplois?|travail|travailler|jobs?|recrutement|work|ouvriers?|workers?)\b[^.!?\n]{0,40}\b(?:au canada|en france|en europe|aux usa|aux etats-unis|en allemagne|en belgique|a dubai|aux emirats|au qatar|en arabie saoudite|au koweit|en pologne|en russie|in canada|in dubai|in qatar|in europe|in the usa|in usa|in poland|abroad|a l'etranger|pour le canada|pour l'europe)\b[^.!?\n]{0,80}\b(?:visa|billet|permis|frais|papiers|documents)\b`, String.raw`\b(?:en|au|aux|a|in|to) (?:allemagne|canada|france|europe|belgique|pologne|russie|dubai|qatar|koweit|arabie saoudite|usa|etats-unis|germany|poland|uk|royaume-uni|turquie|turkey|liban|lebanon|oman)\b[^.!?\n]{0,150}\b(?:papiers|visa|billet|permis de travail)\b[^.!?\n]{0,40}(?:\d|payer|frais|demande)`)
      ],
    },

    // ------------------------------------------------------ Pression et secret
    {
      id: "urgence", categorie: "pression", points: 1,
      libelle: "Urgence",
      explication: "L'urgence sert à t'empêcher de réfléchir et de vérifier.",
      motifs: [
        R(String.raw`\burgen(?:t|te|ts|tes|ce|ces|tissime|tly)\b`, String.raw`\b(?:immediatement|immediately|asap|sans tarder|au plus vite|des maintenant|right now|right away)\b`, String.raw`\bvite ?!`)
      ],
    },
    {
      id: "delai_court", categorie: "pression", points: 1,
      libelle: "Délai très court ou places limitées",
      explication: "Un délai de quelques heures ou des « places limitées » te poussent à agir sans vérifier.",
      motifs: [
        R(String.raw`\b(?:dans|sous|avant|d'ici|within|in the next|next) (?:les |the )?(?:2|3|6|12|24|48) ?(?:h|heures?|hours?|hrs?)\b`, String.raw`\bavant (?:ce soir|minuit|demain|la fin de (?:la )?journee)\b`, String.raw`\b(?:aujourd'hui (?:seulement|uniquement)|dernier delai|derniere chance|last chance|today only|offre valable aujourd'hui)\b`),
        R(String.raw`\b(?:places?|postes?|slots?|seats?|spots?) (?:tres )?(?:limitee?s?|restante?s?|left|remaining|limited)\b`, String.raw`\b(?:limited|few) (?:places?|slots?|seats?|spots?)\b`, String.raw`\bplus que \d+ (?:places?|postes?)\b`, String.raw`\bonly \d+ (?:slots?|places?|spots?|seats?)\b`, String.raw`\b(?:premiers? arrives|premiers? inscrits|first come)\b`)
      ],
    },
    {
      id: "secret", categorie: "pression", points: 2,
      libelle: "On te demande de garder le secret",
      explication: "Un employeur honnête ne demande jamais de garder une offre secrète : le but est de t'empêcher de demander conseil.",
      negation: false,
      motifs: [
        R(String.raw`\bne (?:le |en )?(?:dites|dis|parlez|parle)\b[^.!?\n]{0,30}\b(?:a personne|rien)\b`, String.raw`\bn'en parle[sz]? a personne\b`, String.raw`\bgarde[rz]? (?:le |ca |cela |cette offre |l'offre )?(?:secret|confidentiel|pour (?:vous|toi))\b`),
        R(String.raw`\b(?:keep (?:it |this )?(?:secret|confidential|between us))\b`, String.raw`\b(?:don'?t|do not) (?:tell|share (?:this )?with) anyone\b`, String.raw`\breste entre nous\b`)
      ],
    },
    {
      id: "menace", categorie: "pression", points: 1,
      libelle: "Menace ou chantage",
      explication: "Menacer d'annuler, de bloquer ou d'appeler la police est une technique de pression.",
      motifs: [
        R(String.raw`\b(?:sinon|faute de quoi|passe ce delai|otherwise|or else|failing which|failure to)\b[^.!?\n]{0,60}\b(?:annule\w*|perd\w*|supprim\w*|bloqu\w*|exclu\w*|poursuites?|police|lose|lost|cancel\w*|block\w*|terminat\w*|legal action|forfeit\w*)\b`),
        R(String.raw`\b(?:votre|ton|ta|your) (?:compte|candidature|place|poste|account|application|position|offre|offer) (?:sera|va etre|will be|would be) (?:\w+ )?(?:annulee?|bloquee?|supprimee?|perdue?|attribuee?|donnee?|cancell?ed|blocked|suspended|closed|deleted|given|forfeited)\b`)
      ],
    },
    {
      id: "repondre_oui", categorie: "pression", points: 1,
      libelle: "« Répondez OUI »",
      explication: "Répondre « OUI » confirme que ton numéro est actif et intéressé : tu seras relancé.",
      motifs: [
        R(String.raw`\b(?:repond(?:ez|s)|reply|tape[sz]?|type|ecri(?:s|vez)|envoie[sz]?|send|text)\b (?:simplement |juste |just )?"? ?'?(?:oui|yes|ok|interesse|interested|go|info|infos|start|job|emploi|ready|pret|je veux|moi|dispo|disponible)\b`)
      ],
    },

    // ------------------------------------------------------- Arnaques connues
    {
      id: "exploitation", categorie: "schemas", points: 3,
      libelle: "« Jeunes filles » pour voyages, soirées ou hommes d'affaires",
      explication: "Ces annonces peuvent cacher des réseaux de prostitution ou de traite. Ne pars jamais sans vérifier, et parles-en à un proche.",
      motifs: [
        R(String.raw`\b(?:jeunes? (?:filles?|femmes?|dames?)|filles? de \d+|young (?:girls?|women|ladies))\b[^.!?\n]{0,80}\b(?:hommes? d'affaires|businessm[ae]n|clients? (?:vip|fortunes?|aises)|accompagner (?:des |les )?(?:hommes|clients|messieurs)|escort\w*|voyages? d'affaires|voyages? avec|soirees? privees?|companions?|massages?|hotesses? vip|travel with)\b`),
        R(String.raw`\b(?:escort\w*|accompagnatrices?|companion (?:job|girl)s?|sugar (?:daddy|baby|mummy))\b`),
        R(String.raw`\b(?:mannequins?|models?|modeles?|hotesses?|danseuses?|filles?|girls?)\b[^.!?\n]{0,60}\b(?:de|from|entre|aged?|ages?) ?1[0-7] ?(?:a|to|et|and|-) ?\d{2}\b`)
      ],
    },
    {
      id: "physique", categorie: "schemas", points: 1,
      libelle: "Critères physiques (« jolie », « sexy »…)",
      explication: "Un poste ordinaire qui exige d'être « jolie » ou « sexy » est un signal d'alerte, surtout avec une demande de photos.",
      motifs: [R(String.raw`\b(?:doit etre|doivent etre|must be|soit) (?:\w+ )?(?:jolie|belle|sexy|charmante|pretty|beautiful|attractive|hot)\b`, String.raw`\b(?:jolies?|belles?|sexy) (?:filles?|femmes?|demoiselles?|hotesses?|secretaires?|girls?|ladies)\b`)],
    },
    {
      id: "discretion", categorie: "pression", points: 2,
      libelle: "« Discrétion exigée »",
      explication: "Exiger la discrétion dès le premier message vise à t'isoler de ceux qui pourraient te protéger.",
      negation: false,
      motifs: [R(String.raw`\bdiscretion (?:exigee|assuree|absolue|requise|totale|obligatoire|de rigueur)\b`, String.raw`\bdiscretion (?:is )?(?:required|guaranteed|a must)\b`)],
    },
    {
      id: "pyramide", categorie: "schemas", points: 3,
      libelle: "Parrainage, filleuls : système pyramidal",
      explication: "Gagner de l'argent en recrutant d'autres personnes, c'est le principe de la pyramide : seuls les premiers gagnent, les autres perdent leur mise.",
      motifs: [
        R(String.raw`\b(?:filleuls?|parrainage|parraine[rz]?|downlines?|upline|marketing de reseau|network marketing|multi-?level marketing|mlm|systeme (?:binaire|matriciel)|bonus de niveau|level bonus|lien de parrainage|code de parrainage|referral (?:link|code|commission))\b`),
        R(String.raw`\bplus (?:tu|vous) (?:recrutes?|recrutez|parraines?|parrainez|invites?|invitez|ramenes?|ramenez)\b[^.!?\n]{0,10}\bplus (?:tu|vous) (?:gagnes?|gagnez|touches?|touchez)\b`, String.raw`\bthe more (?:people )?you (?:recruit|refer|invite|bring)\b`),
        R(String.raw`\b(?:chaque|each|every|pour chaque|for each|for every) (?:personne|ami|filleul|person|friend|member|membre|recrue)\b[^.!?\n]{0,30}\b(?:amenes|ramenes|amenez|ramenez|recrutes|recrutez|parraines|parrainez|invites|invitez|bring|refer|recruit|introduce|invite)\b`),
        R(String.raw`\b(?:recrute[rz]?|invite[rz]?|ramene[rz]?|parraine[rz]?|recruit|invite|bring|refer)\b (?:\d+|deux|trois|quatre|cinq|dix|des|vos|tes|other|more)? ?(?:autres? )?(?:personnes|amis|proches|filleuls|people|friends|members|membres)\b[^.!?\n]{0,40}\b(?:bonus|commission|gagne\w*|touche\w*|earn\w*|\d)`)
      ],
    },
    {
      id: "client_mystere", categorie: "schemas", points: 2,
      libelle: "« Client mystère »",
      explication: "Le faux « client mystère » te fait recevoir puis renvoyer de l'argent : arnaque classique.",
      motifs: [R(String.raw`\b(?:client mystere|acheteur mystere|mystery shop(?:per|ping))\b`)],
    },
    {
      id: "loterie", categorie: "schemas", points: 3,
      libelle: "Gain, loterie ou héritage",
      explication: "Gain inattendu, loterie, héritage : on te fait miroiter une somme pour te réclamer des frais ensuite.",
      motifs: [
        R(String.raw`\b(?:vous avez|tu as|you have|you've) (?:\w+ )?(?:gagne|remporte|won)\b`, String.raw`\b(?:loterie|lottery|tirage au sort|jackpot|heritage|inheritance|lucky winner|heureux gagnant|gros lot)\b`, String.raw`\bbeneficiaire (?:d'un|d'une|du) (?:fonds|somme|don|heritage|transfert)\b`)
      ],
    },
    {
      id: "compte_bloque", categorie: "schemas", points: 2,
      libelle: "« Compte suspendu, vérifiez vos informations »",
      explication: "Technique d'hameçonnage (phishing) : on t'affole pour te faire saisir tes identifiants sur un faux site.",
      motifs: [
        R(String.raw`\b(?:votre|ton|your) (?:compte|account|carte|card|candidature|profil|profile) (?:a ete|est|has been|is|sera|will be) (?:\w+ )?(?:bloque\w*|suspendu\w*|desactive\w*|restreint\w*|ferme\w*|expire\w*|locked|suspended|blocked|disabled|limited|compromised|restricted|expired)\b`),
        R(String.raw`\b(?:en vous connectant|en te connectant|connectez-vous|connecte-toi|log ?in|sign ?in|cliquez|clique|click)\b (?:ici|here|sur ce lien|on this link|sur le lien)\b[^.!?\n]{0,60}\b(?:https?:\/\/|www\.)`, String.raw`\b(?:reactive[rz]?|reactivez|reactivate)\b`),
        R(String.raw`\b(?:verifie[rz]?|confirme[rz]?|mettre a jour|met(?:s|tez) a jour|verify|confirm|update|reactivate|reactive[rz]?) (?:votre|ton|your) (?:compte|identite|account|identity|informations?|coordonnees|account details|details|login)\b`),
        R(String.raw`\b(?:connecte[rz]?-vous|connecte-toi|connectez-vous|log ?in|sign ?in|identifiez-vous|identifie-toi)\b (?:avec|with|using|via|sur|to) (?:votre|ton|your) (?:compte|account|identifiants|adresse|email|e-mail|gmail|google|facebook|whatsapp|outlook|microsoft)`, String.raw`\b(?:doit|doivent|must) (?:etre|be) (?:revalide\w*|re-?valide\w*|reverifie\w*|re-?verified|revalidated)\b`)
      ],
    },
    {
      id: "se_justifie", categorie: "schemas", points: 2,
      libelle: "Le message jure que ce n'est pas une arnaque",
      explication: "Une vraie entreprise n'a pas besoin de jurer qu'elle n'est pas une arnaque ni que c'est « 100 % légal ».",
      negation: false,
      motifs: [
        R(String.raw`\b(?:ce n'est pas|c'est pas|ceci n'est pas|cela n'est pas|pas) (?:une |de l'|d')?(?:arnaque|escroquerie|fraude|fake)\b`, String.raw`\b(?:not|no|this is not|this isn't|it's not|it is not|isn't) (?:a )?(?:scam|fraud|fake)\b`),
        R(String.raw`\b(?:100 ?%|totalement|completement|vraiment) (?:legal|legale|legit|reel|reelle|serieux|serieuse|fiable|real|genuine|safe|securise)\b`, String.raw`\bsans (?:aucun )?risques?\b`, String.raw`\b(?:risk[- ]free|no risk)\b`, String.raw`\b(?:offre|travail|job|emploi|site|plateforme) (?:en ligne )?(?:serieux|serieuse|fiable|legit)\b`)
      ],
    },

    {
      id: "portefeuille_crypto", categorie: "secrets", points: 4,
      libelle: "Connexion de ton portefeuille crypto demandée",
      explication: "Connecter ton portefeuille (Trust Wallet, MetaMask…) ou donner ta phrase de récupération permet de le vider en quelques secondes.",
      motifs: [
        R(String.raw`\b(?:connect\w*|connecte[rz]?|lier|liez|link|relier|reliez|synchronis\w*|import\w*)\b (?:votre |ton |your |a |the )?(?:crypto |web3 |digital |numerique )?(?:trust ?wallet|metamask|wallet|portefeuille(?: crypto)?)\b`, String.raw`\b(?:approve|approuve[rz]?|signe[rz]?|sign) (?:the |la |cette |this )?(?:transaction|smart contract)\b`, String.raw`\b(?:seed phrase|recovery phrase|secret phrase|phrase secrete|phrase de recuperation|private key|cle privee)\b`)
      ],
    },
    {
      id: "achats_avances", categorie: "argent", points: 3,
      libelle: "Avancer ton argent pour des achats « remboursés »",
      explication: "On te fait acheter avec ton argent ou ta carte en promettant un remboursement plus commission : le remboursement n'arrive jamais.",
      motifs: [
        R(String.raw`\b(?:buy|purchase|acheter|achetez|achete[rz]?|faire des achats|payer|payez|regler|reglez)\b[^.!?\n]{0,40}\b(?:with your own|avec (?:votre|ton|ta|vos|tes) (?:propres? )?(?:argent|carte|fonds|compte|economies|propre|propres)|de (?:votre|ta) poche|out of (?:your )?pocket|with your (?:own )?(?:card|money|funds))\b`),
        R(String.raw`\b(?:rembourse\w*|reimburs\w*|refund\w*)\b[^.!?\n]{0,30}(?:\b(?:commission|bonus|prime)\b|\+ ?\d|\d+ ?%)`)
      ],
    },
    {
      id: "photos_privees", categorie: "secrets", points: 2,
      libelle: "Photos de toi demandées en privé",
      explication: "Des photos (en pied, en tenue…) envoyées en privé à un inconnu peuvent servir au chantage ou à des réseaux d'exploitation.",
      detecter(ctx) {
        const forte = chercher(ctx, R(String.raw`\bphotos? (?:en pied|en tenue|en maillot|sexy|du corps|de (?:tout )?ton corps|de (?:tout )?votre corps)\b`, String.raw`\bfull body (?:photo|picture|pic)s?\b`, String.raw`\b(?:sexy|bikini) (?:photos?|pictures?|pics?)\b`), false);
        const photos = chercher(ctx, R(String.raw`\b(?:avec|joindre|joins|joignez|envoie[sz]?|envoyer|envoyez|send|with|attach)\b[ -](?:[\w'-]+ ){0,2}?(?:photos|pictures|pics|selfies)\b`), false);
        const prive = present(ctx, R(String.raw`\b(?:en prive|en mp|inbox|message prive|private message|dm|whatsapp|telegram)\b`), false);
        return forte.concat(prive ? photos : []);
      },
    },
    {
      id: "contact_prive", categorie: "contact", points: 1,
      libelle: "« Écris-moi en privé / en inbox »",
      explication: "Une vraie offre donne une adresse, un site ou un numéro professionnel. « Viens en privé » sert à t'isoler.",
      motifs: [
        R(String.raw`\b(?:en prive|en mp|en inbox|inbox(?: moi| me)?|ecri\w* (?:moi |nous )?en (?:prive|inbox|mp)|dm (?:me|us|moi)|message prive|private message|uniquement en prive|je t'explique (?:tout )?en prive)\b`)
      ],
    },
    {
      id: "email_imitation", categorie: "contact", points: 2,
      libelle: "Adresse Gmail/Yahoo qui se fait passer pour un service RH",
      explication: "« recrutement.entreprise@gmail.com » : n'importe qui peut créer cette adresse. Un vrai service RH écrit depuis l'adresse de l'entreprise.",
      negation: false,
      motifs: [
        R(String.raw`[\w.+-]{0,40}(?:recrut|recruit|carriere|career|emploi|jobs?|hiring|direction|officiel|official|support|staff|corp|sarl|ltd|international|global|(?:^|[._-])(?:hr|rh|drh)(?=[._-]|@))[\w.+-]{0,40}@(?:gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|proton|protonmail|gmx|yandex|mail|zoho|rocketmail)\.[a-z.]{2,6}`)
      ],
    },
    {
      id: "identite_et_banque", categorie: "secrets", points: 2,
      libelle: "Pièce d'identité ET coordonnées bancaires à envoyer",
      explication: "Ta pièce d'identité et tes coordonnées bancaires ensemble, c'est le kit complet pour usurper ton identité. Ne les envoie jamais à distance à un employeur non vérifié.",
      negation: false,
      detecter(ctx) {
        const SUR_PLACE = /\b(?:passe[rz]?|passez|presente[rz]?|presentez|deposer|deposez|a nos bureaux|au siege|dans nos locaux|sur place|in person|at our office)\b/;
        if (SUR_PLACE.test(ctx.vues[0].texte)) return [];
        const id = chercher(ctx, R(String.raw`\b(?:pieces? d'identite|cartes? d'identite|cni|passeports?|passports?|id cards?|identity cards?|driver'?s licen[cs]e)\b`), true);
        const banque = chercher(ctx, R(String.raw`\b(?:rib|iban)\b`, String.raw`\b(?:coordonnees|informations|details|infos) bancaires\b`, String.raw`\bnumero de compte\b`, String.raw`\bbank (?:details|account(?: details| number)?)\b`, String.raw`\baccount number\b`), true);
        return id.length && banque.length ? [id[0], banque[0]] : [];
      },
    },

    // ------------------------------------------------------- Forme du message
    {
      id: "criard", categorie: "forme", points: 1,
      libelle: "MAJUSCULES et « !!! » à répétition",
      explication: "Majuscules partout et points d'exclamation à la chaîne : style fréquent des messages d'arnaque.",
      negation: false,
      detecter(ctx) {
        const res = chercher(ctx, R(String.raw`!{3,}`, String.raw`[!?]{4,}`), false);
        const lettres = ctx.message.match(/\p{L}/gu) || [];
        const majuscules = ctx.message.match(/\p{Lu}/gu) || [];
        if (lettres.length >= 20 && majuscules.length / lettres.length >= 0.6) {
          const m = /\p{Lu}{4,}(?:[\s'-]+\p{Lu}{2,})*/u.exec(ctx.message);
          if (m) res.push({ debut: m.index, fin: m.index + m[0].length });
        }
        return res;
      },
    },
    {
      id: "emojis_argent", categorie: "forme", points: 1,
      libelle: "Émojis d'argent (💰💸🤑…)",
      explication: "Les émojis d'argent servent d'appât. Rien de grave seul, mais à noter.",
      negation: false,
      detecter(ctx) {
        const res = [];
        for (const m of ctx.message.matchAll(/[\u{1F4B0}\u{1F4B5}\u{1F4B6}\u{1F4B7}\u{1F4B8}\u{1F4B4}\u{1F4B2}\u{1F911}\u{1F4B3}\u{1F48E}\u{1F3E6}]/gu)) {
          res.push({ debut: m.index, fin: m.index + m[0].length });
        }
        return res;
      },
    },
  ];

  // ===========================================================================
  // 6. Analyse
  // ===========================================================================

  function niveauPour(score) {
    let niveau = NIVEAUX[0];
    for (const n of NIVEAUX) if (score >= n.min) niveau = n;
    return niveau;
  }

  function fusionner(plages) {
    const triees = plages.slice().sort((a, b) => a.debut - b.debut || b.fin - a.fin);
    const res = [];
    for (const p of triees) {
      const der = res[res.length - 1];
      if (der && p.debut < der.fin) der.fin = Math.max(der.fin, p.fin);
      else res.push({ debut: p.debut, fin: p.fin });
    }
    return res;
  }

  /**
   * Analyse un message.
   * @param {string} message
   * @returns {{score:number, scoreBrut:number, plafonne:boolean, niveau:object,
   *            signaux:Array, tronque:boolean}}
   */
  function analyser(message) {
    message = String(message == null ? "" : message);
    const tronque = message.length > LONGUEUR_MAX;
    if (tronque) message = message.slice(0, LONGUEUR_MAX);

    const plate = vuePlate(message);
    const ctx = { message, vues: [plate, vueCompacte(plate)] };

    const signaux = [];
    for (const regle of REGLES) {
      const avecNegation = regle.negation !== false;
      let plages = [];
      if (regle.motifs) for (const motif of regle.motifs) plages.push(...chercher(ctx, motif, avecNegation, regle.exclure));
      if (regle.detecter) plages.push(...regle.detecter(ctx));
      if (!plages.length) continue;
      const extraits = fusionner(plages).slice(0, 4).map((p) => ({
        debut: p.debut, fin: p.fin, texte: message.slice(p.debut, p.fin),
      }));
      signaux.push({
        id: regle.id, categorie: regle.categorie, libelle: regle.libelle,
        points: regle.points, explication: regle.explication, extraits,
      });
    }

    const forts = signaux.filter((s) => s.points > 1).reduce((t, s) => t + s.points, 0);
    const faibles = signaux.filter((s) => s.points <= 1).reduce((t, s) => t + s.points, 0);
    const score = forts + Math.min(faibles, PLAFOND_FAIBLES);
    signaux.sort((a, b) => b.points - a.points);

    return {
      score,
      scoreBrut: forts + faibles,
      plafonne: faibles > PLAFOND_FAIBLES,
      niveau: niveauPour(score),
      signaux,
      tronque,
    };
  }

  /** Liste publique des règles (pour la page « signaux surveillés »). */
  const LISTE_REGLES = REGLES.map((r) => ({
    id: r.id, categorie: r.categorie, libelle: r.libelle, points: r.points, explication: r.explication,
  }));

  return {
    VERSION, NIVEAUX, CATEGORIES, PLAFOND_FAIBLES, LONGUEUR_MAX,
    REGLES: LISTE_REGLES,
    analyser, niveauPour,
    _interne: { vuePlate, vueCompacte, montants: (m) => montants({ message: m, vues: [vuePlate(m)] }) },
  };
});
