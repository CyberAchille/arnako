/*!
 * ArnaKO — interface. Tout le texte de l'utilisateur est inséré avec
 * textContent (jamais innerHTML) : aucun risque d'injection de code.
 */
(function () {
  "use strict";

  const ArnaKO = window.ArnaKO;
  const $ = (sel) => document.querySelector(sel);

  const EXEMPLES = [
    {
      titre: "arnaque aux tâches",
      texte: "Bonjour 😊 Je suis Emma, recruteuse chez DigitalPro. On recrute à temps partiel : il suffit d'aimer des vidéos YouTube, 2 000 FCFA par like, jusqu'à 60 000 FCFA par jour. Intéressé(e) ? Réponds OUI et je t'ajoute sur Telegram.",
    },
    {
      titre: "faux recrutement avec frais",
      texte: "URGENT !!! Recrutement d'agents commerciaux, salaire 250 000 F. Vous êtes retenu(e). Pour finaliser, payez les frais de dossier de 7 500 FCFA par Flooz au 96 XX XX XX avant ce soir.",
    },
    {
      titre: "vol de compte par code SMS",
      texte: "Bonjour, ici le service recrutement. Vous allez recevoir un code à 6 chiffres par SMS, merci de nous le transmettre pour valider votre candidature.",
    },
    {
      titre: "vraie offre d'emploi",
      texte: "Le cabinet Excellence Conseil recrute un comptable confirmé (5 ans d'expérience). Dossier : CV, lettre de motivation, copie des diplômes. Dépôt au siège à Tokoin avant le 15 décembre, ou par e-mail à recrutement@excellence-conseil.tg.",
    },
  ];

  const CONSEILS_GENERAUX = {
    ok: [
      "Vérifie quand même l'entreprise : site officiel, adresse réelle, numéro fixe.",
      "Si on te demande de l'argent plus tard dans l'échange, arrête tout : on ne paie jamais pour un emploi.",
    ],
    prudence: [
      "Cherche le nom de l'entreprise suivi du mot « arnaque » sur internet.",
      "Contacte l'entreprise par un numéro ou une adresse que tu trouves toi-même, pas ceux du message.",
      "Demande l'avis d'un proche avant de répondre.",
    ],
    suspect: [
      "Ne réponds plus. Bloque et signale le contact dans WhatsApp, Telegram ou Facebook.",
      "Préviens tes proches : ce message circule sûrement aussi chez eux.",
    ],
  };

  const el = (tag, props, ...enfants) => {
    const n = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else if (k.startsWith("data-") || k.startsWith("aria-") || k === "role" || k === "id" || k === "href" || k === "type") n.setAttribute(k, v);
        else n[k] = v;
      }
    }
    for (const e of enfants.flat()) if (e != null && e !== false) n.append(e);
    return n;
  };

  const poids = (points) => (points >= 3 ? "fort" : points === 2 ? "moyen" : "faible");
  const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

  // ----------------------------------------------------------- Rendu du verdict
  function blocVerdict(r, anime) {
    const n = r.niveau;
    const cases = el("div", { class: "jauge-cases", "aria-hidden": "true" });
    for (let i = 1; i <= 10; i++) cases.append(el("span", { class: "jauge-case" + (i <= r.score ? " pleine" : "") }));
    const tampon = el("p", { class: "tampon" + (anime ? " coup" : ""), text: n.libelle });

    return el("div", { class: "verdict", "data-niveau": n.id },
      el("h2", { class: "visuellement-cache", text: `Verdict : ${n.libelle}` }),
      el("div", { class: "verdict-tete" },
        tampon,
        el("p", { class: "score" },
          el("strong", { text: pluriel(r.score, "point") }),
          "seuil « Très suspect » : 4"
        )
      ),
      el("div", { class: "jauge" },
        cases,
        el("div", { class: "jauge-reperes", "aria-hidden": "true" },
          el("span", { text: "0-1" }), el("span", { text: "2-3" }), el("span", { text: "4 et plus" })
        )
      ),
      el("p", { class: "resume-verdict", text: n.resume })
    );
  }

  function blocSignaux(r) {
    const bloc = el("div", { class: "bloc" }, el("h2", { text: "Pourquoi ce verdict" }));
    if (!r.signaux.length) {
      bloc.append(el("p", { class: "aucun-signal", text: "Aucun des signaux d'alerte connus n'apparaît dans ce message." }));
      return bloc;
    }
    const max = (id) => Math.max(0, ...r.signaux.filter((s) => s.categorie === id).map((s) => s.points));
    const categories = ArnaKO.CATEGORIES.slice().sort((a, b) => max(b.id) - max(a.id));
    for (const cat of categories) {
      const liste = r.signaux.filter((s) => s.categorie === cat.id);
      if (!liste.length) continue;
      bloc.append(el("h3", { class: "categorie-titre", text: cat.libelle }));
      const ul = el("ul", { class: "signaux" });
      for (const s of liste) {
        const extraits = s.extraits.slice(0, 2).map((e) => el("q", { text: e.texte.length > 90 ? e.texte.slice(0, 87) + "…" : e.texte }));
        const ligneExtraits = el("p", { class: "signal-extrait" }, "Repéré : ");
        extraits.forEach((q, i) => { if (i) ligneExtraits.append(", "); ligneExtraits.append(q); });
        ul.append(el("li", { class: "signal" },
          el("span", { class: "points", "data-poids": poids(s.points), text: `+${s.points}` }),
          el("div", null,
            el("p", { class: "signal-libelle", text: s.libelle }),
            el("p", { class: "signal-explication", text: s.explication }),
            ligneExtraits
          )
        ));
      }
      bloc.append(ul);
    }
    if (r.plafonne) {
      bloc.append(el("p", { class: "note-plafond", text: `Les indices faibles (+1) comptent au maximum pour ${ArnaKO.PLAFOND_FAIBLES} points : le score brut serait de ${r.scoreBrut}.` }));
    }
    return bloc;
  }

  function blocMessage(message, r) {
    // Une plage par passage repéré, avec le poids du signal le plus grave.
    const plages = [];
    for (const s of r.signaux) for (const e of s.extraits) plages.push({ debut: e.debut, fin: e.fin, points: s.points });
    plages.sort((a, b) => a.debut - b.debut || b.points - a.points);
    const fusion = [];
    for (const p of plages) {
      const der = fusion[fusion.length - 1];
      if (der && p.debut < der.fin) { der.fin = Math.max(der.fin, p.fin); der.points = Math.max(der.points, p.points); }
      else fusion.push({ ...p });
    }
    const bulle = el("div", { class: "bulle", tabIndex: 0, "aria-label": "Message analysé, passages repérés surlignés" });
    let pos = 0;
    for (const p of fusion) {
      if (p.debut > pos) bulle.append(document.createTextNode(message.slice(pos, p.debut)));
      bulle.append(el("mark", { class: "g-" + poids(p.points), text: message.slice(p.debut, p.fin) }));
      pos = p.fin;
    }
    if (pos < message.length) bulle.append(document.createTextNode(message.slice(pos)));

    const bloc = el("div", { class: "bloc" }, el("h2", { text: fusion.length ? "Les passages repérés" : "Le message analysé" }), bulle);
    if (fusion.length) {
      bloc.append(el("p", { class: "legende" },
        el("span", null, el("mark", { class: "g-fort", text: "grave" })),
        el("span", null, el("mark", { class: "g-moyen", text: "sérieux" })),
        el("span", null, el("mark", { class: "g-faible", text: "indice faible" }))
      ));
    }
    return bloc;
  }

  function blocConseils(r) {
    const conseils = [];
    if (r.niveau.id === "ok") conseils.push(...CONSEILS_GENERAUX.ok);
    else {
      if (r.niveau.id === "suspect") conseils.push(CONSEILS_GENERAUX.suspect[0]);
      for (const cat of ArnaKO.CATEGORIES) {
        if (cat.conseil && r.signaux.some((s) => s.categorie === cat.id)) conseils.push(cat.conseil);
      }
      conseils.push(...(r.niveau.id === "suspect" ? CONSEILS_GENERAUX.suspect.slice(1) : CONSEILS_GENERAUX.prudence));
    }
    const ul = el("ul", { class: "conseils" }, conseils.map((c) => el("li", { text: c })));
    const lien = el("p", null, "Tu as déjà payé ou donné un code ? ", el("a", { href: "#deja-paye", text: "Voici quoi faire tout de suite." }));
    return el("div", { class: "bloc" }, el("h2", { text: "Que faire maintenant" }), ul, lien);
  }

  function texteResume(r) {
    const lignes = [`ArnaKO : ${r.niveau.libelle} (${pluriel(r.score, "point")})`];
    for (const s of r.signaux) lignes.push(`- ${s.libelle} (+${s.points})`);
    if (!r.signaux.length) lignes.push("- Aucun signal d'alerte connu.");
    lignes.push("", "Vérifie toi aussi une offre d'emploi : " + location.href.split("#")[0]);
    return lignes.join("\n");
  }

  function blocPartage(r) {
    const statut = el("span", { class: "statut-copie", role: "status" });
    const bouton = el("button", { class: "bouton", type: "button", text: "Copier le résultat" });
    bouton.addEventListener("click", async () => {
      const ok = await copier(texteResume(r));
      statut.textContent = ok ? "Résultat copié. Tu peux le coller dans WhatsApp pour prévenir un proche." : "La copie a échoué. Sélectionne le texte et copie-le à la main.";
      statut.style.color = ok ? "" : "var(--rouge)";
    });
    return el("div", { class: "partage" }, bouton, statut);
  }

  async function copier(texte) {
    try {
      await navigator.clipboard.writeText(texte);
      return true;
    } catch (e) {
      try {
        const t = el("textarea", { value: texte });
        t.setAttribute("readonly", "");
        t.className = "visuellement-cache";
        document.body.append(t);
        t.select();
        const ok = document.execCommand("copy");
        t.remove();
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }

  // --------------------------------------------------------------- Analyse
  const zone = $("#message");
  const aide = $("#aide");
  const resultat = $("#resultat");
  let indexExemple = 0;

  function afficher(message, options) {
    const r = ArnaKO.analyser(message);
    const morceaux = [];
    if (options && options.bandeau) morceaux.push(el("p", { class: "bandeau-exemple", text: options.bandeau }));
    morceaux.push(blocVerdict(r, !(options && options.calme)), blocSignaux(r), blocMessage(message.slice(0, ArnaKO.LONGUEUR_MAX), r), blocConseils(r), blocPartage(r));
    resultat.replaceChildren(...morceaux);
    if (r.tronque) aide.textContent = `Message très long : seuls les ${ArnaKO.LONGUEUR_MAX.toLocaleString("fr-FR")} premiers caractères ont été analysés.`;
    return r;
  }

  function lancer() {
    const message = zone.value.trim();
    aide.classList.remove("erreur");
    if (!message) {
      aide.textContent = "Colle d'abord un message dans la zone ci-dessus.";
      aide.classList.add("erreur");
      zone.focus();
      return;
    }
    aide.textContent = "Analyse terminée. Le verdict est affiché.";
    afficher(message);
    if (window.matchMedia("(max-width: 959px)").matches) {
      resultat.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }
  }

  $("#formulaire").addEventListener("submit", (e) => { e.preventDefault(); lancer(); });

  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); lancer(); }
  });

  // Analyse automatique juste après un collage.
  zone.addEventListener("paste", () => setTimeout(lancer, 0));

  $("#coller").addEventListener("click", async () => {
    try {
      const texte = await navigator.clipboard.readText();
      if (!texte) throw new Error("vide");
      zone.value = texte;
      lancer();
    } catch (e) {
      zone.focus();
      aide.classList.remove("erreur");
      aide.textContent = "Ton navigateur bloque le bouton Coller. Fais un appui long dans la zone puis « Coller » (ou Ctrl + V).";
    }
  });

  $("#exemple").addEventListener("click", () => {
    const ex = EXEMPLES[indexExemple % EXEMPLES.length];
    indexExemple++;
    zone.value = ex.texte;
    aide.classList.remove("erreur");
    aide.textContent = `Exemple ${((indexExemple - 1) % EXEMPLES.length) + 1} sur ${EXEMPLES.length} : ${ex.titre}. Clique encore pour le suivant.`;
    afficher(ex.texte);
  });

  $("#effacer").addEventListener("click", () => {
    zone.value = "";
    aide.classList.remove("erreur");
    aide.textContent = "Zone vidée. Colle un nouveau message.";
    zone.focus();
  });

  // ------------------------------------------------- Liste des signaux surveillés
  function listeRegles() {
    const conteneur = $("#liste-regles");
    $("#nb-regles").textContent = ArnaKO.REGLES.length;
    for (const cat of ArnaKO.CATEGORIES) {
      const regles = ArnaKO.REGLES.filter((r) => r.categorie === cat.id).sort((a, b) => b.points - a.points);
      if (!regles.length) continue;
      conteneur.append(el("details", null,
        el("summary", { text: `${cat.libelle} (${pluriel(regles.length, "signal").replace("signals", "signaux")})` }),
        el("ul", null, regles.map((r) => el("li", { title: r.explication },
          el("span", { class: "points", "data-poids": poids(r.points), text: `+${r.points}` }),
          el("span", { text: r.libelle })
        )))
      ));
    }
  }

  // ----------------------------------------------------------- Démarrage
  listeRegles();
  afficher(EXEMPLES[0].texte, {
    calme: true,
    bandeau: "Exemple : voici ce qu'ArnaKO dit d'une arnaque très répandue. Colle ton propre message pour l'analyser.",
  });
})();
