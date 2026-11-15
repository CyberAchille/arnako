/*!
 * ArnaKO — interface. Le texte de l'utilisateur est toujours inséré avec
 * textContent (jamais innerHTML) : aucun risque d'injection de code.
 */
(function () {
  "use strict";

  const ArnaKO = window.ArnaKO;
  const $ = (sel) => document.querySelector(sel);
  const SVG = "http://www.w3.org/2000/svg";

  const EXEMPLES = [
    "Bonjour 😊 Je suis Emma, recruteuse chez DigitalPro. On recrute à temps partiel : il suffit d'aimer des vidéos YouTube, 2 000 FCFA par like, jusqu'à 60 000 FCFA par jour. Intéressé(e) ? Réponds OUI et je t'ajoute sur Telegram.",
    "URGENT !!! Recrutement d'agents commerciaux, salaire 250 000 F. Vous êtes retenu(e). Pour finaliser, payez les frais de dossier de 7 500 FCFA par Flooz au 96 XX XX XX avant ce soir.",
    "Bonjour, ici le service recrutement. Vous allez recevoir un code à 6 chiffres par SMS, merci de nous le transmettre pour valider votre candidature.",
    "Le cabinet Excellence Conseil recrute un comptable confirmé (5 ans d'expérience). Dossier : CV, lettre de motivation, copie des diplômes. Dépôt au siège à Tokoin avant le 15 décembre, ou par e-mail à recrutement@excellence-conseil.tg.",
  ];

  const CONSEILS = {
    ok: ["Vérifie quand même l'entreprise : site officiel, adresse, numéro fixe.", "Si on te demande de l'argent plus tard, arrête tout."],
    prudence: ["Vérifie l'entreprise par toi-même, pas avec les contacts du message.", "Demande l'avis d'un proche avant de répondre."],
    suspect: ["Bloque et signale le contact, puis préviens tes proches."],
  };

  // Petites icônes (traits), dessinées en SVG
  const ICONES = {
    ok: "M5 12.5l4.5 4.5L19 7.5",
    prudence: "M12 8v5M12 16.5v.01M10.3 3.9L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
    suspect: "M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6l8-3zM9.5 9.5l5 5M14.5 9.5l-5 5",
    chevron: "M6 9l6 6 6-6",
    coche: "M5 12.5l4.5 4.5L19 7.5",
    copier: "M9 9h10v11H9zM5 15V4h11",
    retour: "M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4",
    fleche: "M9 6l6 6-6 6",
  };

  function icone(nom) {
    const s = document.createElementNS(SVG, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("focusable", "false");
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", ICONES[nom]);
    s.append(p);
    if (nom === "chevron") s.classList.add("chevron");
    return s;
  }

  const el = (tag, props, ...enfants) => {
    const n = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else if (/^(data-|aria-)|^(role|id|type|href|title)$/.test(k)) n.setAttribute(k, v);
        else n[k] = v;
      }
    }
    for (const e of enfants.flat()) if (e != null && e !== false) n.append(e);
    return n;
  };

  const poids = (points) => (points >= 3 ? "fort" : points === 2 ? "moyen" : "faible");
  const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

  // ------------------------------------------------------------- Résultat
  function anneau(score) {
    const r = 31;
    const tour = 2 * Math.PI * r;
    const part = Math.min(score, 10) / 10;
    const s = document.createElementNS(SVG, "svg");
    s.setAttribute("viewBox", "0 0 76 76");
    s.setAttribute("aria-hidden", "true");
    for (const [cls, dash] of [["anneau-fond", null], ["anneau-plein", part]]) {
      const c = document.createElementNS(SVG, "circle");
      c.setAttribute("cx", "38"); c.setAttribute("cy", "38"); c.setAttribute("r", String(r));
      c.setAttribute("class", cls);
      if (dash !== null) {
        c.setAttribute("stroke-dasharray", `${(tour * dash).toFixed(1)} ${tour.toFixed(1)}`);
        if (dash === 0) c.setAttribute("stroke-opacity", "0");
      }
      s.append(c);
    }
    return el("div", { class: "anneau" }, s,
      el("p", { class: "anneau-valeur" }, String(score), el("small", { text: "sur 10" })));
  }

  function enTete(r) {
    const n = r.niveau;
    const nb = r.signaux.length;
    return el("div", { class: "verdict" },
      el("div", { class: "verdict-icone" }, icone(n.id)),
      el("div", { class: "verdict-texte" },
        el("h2", { class: "verdict-titre", text: n.libelle }),
        el("p", { class: "verdict-resume", text: n.resume })
      ),
      el("div", { class: "verdict-score", role: "img", "aria-label": `Score : ${r.score} sur 10, ${pluriel(nb, "signal détecté", "signaux détectés")}` }, anneau(r.score))
    );
  }

  function listeSignaux(r) {
    if (!r.signaux.length) {
      return el("div", null,
        el("h3", { class: "section-titre", text: "Signaux détectés" }),
        el("p", { class: "vide", text: "Aucun des 55 signaux d'arnaque connus n'apparaît dans ce message." }));
    }
    const liste = el("div", { class: "signaux" });
    for (const s of r.signaux) {
      const extrait = s.extraits[0].texte;
      liste.append(el("details", { class: "signal" },
        el("summary", null,
          el("span", { class: "points", "data-poids": poids(s.points), text: `+${s.points}` }),
          el("span", null,
            el("span", { class: "signal-libelle", text: s.libelle }),
            el("span", { class: "signal-extrait", text: `« ${extrait} »` })),
          icone("chevron")),
        el("p", { class: "signal-explication", text: s.explication })
      ));
    }
    return el("div", null,
      el("h3", { class: "section-titre", text: pluriel(r.signaux.length, "signal détecté", "signaux détectés") }),
      liste);
  }

  function messageSurligne(message, r) {
    const plages = [];
    for (const s of r.signaux) for (const e of s.extraits) plages.push({ debut: e.debut, fin: e.fin, points: s.points });
    if (!plages.length) return null;
    plages.sort((a, b) => a.debut - b.debut || b.points - a.points);
    const fusion = [];
    for (const p of plages) {
      const der = fusion[fusion.length - 1];
      if (der && p.debut < der.fin) { der.fin = Math.max(der.fin, p.fin); der.points = Math.max(der.points, p.points); }
      else fusion.push({ ...p });
    }
    const bulle = el("div", { class: "bulle", tabIndex: 0 });
    let pos = 0;
    for (const p of fusion) {
      if (p.debut > pos) bulle.append(document.createTextNode(message.slice(pos, p.debut)));
      bulle.append(el("mark", { class: "g-" + poids(p.points), text: message.slice(p.debut, p.fin) }));
      pos = p.fin;
    }
    if (pos < message.length) bulle.append(document.createTextNode(message.slice(pos)));
    return el("details", { class: "message-surligne" },
      el("summary", null, "Voir les passages repérés dans le message", icone("chevron")), bulle);
  }

  function conseils(r) {
    const id = r.niveau.id;
    const liste = id === "suspect" ? ["Ne paie rien et ne réponds plus."] : [];
    if (id !== "ok") {
      // Les conseils propres aux signaux trouvés, du plus grave au moins grave.
      const vus = new Set(["schemas", "forme"]);
      for (const s of r.signaux) {
        const cat = ArnaKO.CATEGORIES.find((c) => c.id === s.categorie);
        if (cat && cat.conseil && !vus.has(cat.id)) { vus.add(cat.id); liste.push(cat.conseil); }
        if (liste.length === 3) break;
      }
    }
    liste.push(...CONSEILS[id]);
    return el("div", null,
      el("h3", { class: "section-titre", text: "Que faire" }),
      el("ul", { class: "conseils" }, liste.slice(0, 4).map((c) => el("li", null, icone("coche"), el("span", { text: c })))));
  }

  function resume(r) {
    const lignes = [`ArnaKO : ${r.niveau.libelle} (${r.score} sur 10)`];
    for (const s of r.signaux) lignes.push(`- ${s.libelle}`);
    lignes.push("", "Vérifie une offre d'emploi sur " + location.href.split("#")[0]);
    return lignes.join("\n");
  }

  async function copier(texte) {
    try { await navigator.clipboard.writeText(texte); return true; } catch (e) { /* repli ci-dessous */ }
    try {
      const t = el("textarea", { value: texte, className: "visuellement-cache" });
      document.body.append(t); t.select();
      const ok = document.execCommand("copy");
      t.remove();
      return ok;
    } catch (e) { return false; }
  }

  function actions(r) {
    const statut = el("span", { class: "statut", role: "status" });
    const bCopier = el("button", { class: "bouton", type: "button" }, icone("copier"), "Copier le résultat");
    bCopier.addEventListener("click", async () => {
      const ok = await copier(resume(r));
      statut.textContent = ok ? "Copié" : "Copie impossible";
      statut.style.color = ok ? "" : "var(--rouge)";
    });
    const bNouveau = el("button", { class: "bouton", type: "button" }, icone("retour"), "Nouvelle analyse");
    bNouveau.addEventListener("click", reinitialiser);
    return el("div", { class: "actions" }, bCopier, bNouveau, statut);
  }

  // --------------------------------------------------------------- Analyse
  const zone = $("#message");
  const aide = $("#aide");
  const resultat = $("#resultat");
  const reperes = $("#reperes");
  const effacer = $("#effacer");
  let indexExemple = 0;

  function afficher(message) {
    const r = ArnaKO.analyser(message);
    const corps = el("div", { class: "corps" }, listeSignaux(r), messageSurligne(message.slice(0, ArnaKO.LONGUEUR_MAX), r), conseils(r));
    if (r.niveau.id !== "ok") {
      const urgence = el("button", { class: "urgence-lien", type: "button" }, "Tu as déjà payé ou donné un code ? Voici quoi faire", icone("fleche"));
      urgence.addEventListener("click", () => ouvrir("dlg-urgence"));
      corps.append(urgence);
    }
    corps.append(actions(r));
    resultat.dataset.niveau = r.niveau.id;
    resultat.replaceChildren(enTete(r), corps);
    resultat.hidden = false;
    reperes.hidden = true;
    resultat.classList.remove("apparait");
    void resultat.offsetWidth;
    resultat.classList.add("apparait");
    aide.textContent = r.tronque ? `Message très long : seuls les ${ArnaKO.LONGUEUR_MAX.toLocaleString("fr-FR")} premiers caractères ont été analysés.` : "";
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
    afficher(message);
    const doux = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultat.scrollIntoView({ behavior: doux ? "smooth" : "auto", block: "start" });
    resultat.focus({ preventScroll: true });
  }

  function reinitialiser() {
    zone.value = "";
    resultat.hidden = true;
    resultat.replaceChildren();
    reperes.hidden = false;
    aide.textContent = "";
    aide.classList.remove("erreur");
    majEffacer();
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    zone.focus({ preventScroll: true });
  }

  const majEffacer = () => { effacer.hidden = !zone.value; };

  $("#formulaire").addEventListener("submit", (e) => { e.preventDefault(); lancer(); });
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); lancer(); }
  });
  zone.addEventListener("input", majEffacer);
  zone.addEventListener("paste", () => setTimeout(() => { majEffacer(); lancer(); }, 0));

  $("#coller").addEventListener("click", async () => {
    try {
      const texte = await navigator.clipboard.readText();
      if (!texte) throw new Error("vide");
      zone.value = texte;
      majEffacer();
      lancer();
    } catch (e) {
      zone.focus();
      aide.classList.remove("erreur");
      aide.textContent = "Ton navigateur bloque ce bouton : fais un appui long dans la zone, puis « Coller ».";
    }
  });

  $("#exemple").addEventListener("click", () => {
    zone.value = EXEMPLES[indexExemple % EXEMPLES.length];
    indexExemple++;
    majEffacer();
    lancer();
  });

  effacer.addEventListener("click", reinitialiser);

  // -------------------------------------------------------------- Fenêtres
  function ouvrir(id) {
    const d = document.getElementById(id);
    if (typeof d.showModal === "function") d.showModal();
    else d.setAttribute("open", "");
  }
  document.querySelectorAll("[data-ouvrir]").forEach((b) => b.addEventListener("click", () => ouvrir(b.dataset.ouvrir)));
  document.querySelectorAll("dialog").forEach((d) => {
    d.querySelector("[data-fermer]").addEventListener("click", () => d.close());
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  });

  function listeRegles() {
    const c = $("#liste-regles");
    $("#nb-regles").textContent = ArnaKO.REGLES.length;
    $("#nb-regles-2").textContent = ArnaKO.REGLES.length;
    for (const cat of ArnaKO.CATEGORIES) {
      const regles = ArnaKO.REGLES.filter((r) => r.categorie === cat.id).sort((a, b) => b.points - a.points);
      if (!regles.length) continue;
      c.append(el("h3", { text: cat.libelle }),
        el("ul", null, regles.map((r) => el("li", { title: r.explication },
          el("span", { class: "points", "data-poids": poids(r.points), text: `+${r.points}` }),
          el("span", { text: r.libelle })))));
    }
  }

  // ---------------------------------------- Motif guilloché du bandeau
  function guilloche() {
    const canvas = $("#guilloche");
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const etroit = w < 700;
    const cx = etroit ? w * 0.5 : w * 0.86;
    const cy = etroit ? h * 0.08 : h * 0.3;
    const R = Math.max(w, h) * (etroit ? 0.62 : 0.42);
    ctx.lineWidth = 0.8;
    // Anneaux ondulés décalés : le principe du guilloché des billets.
    for (const [lobes, phase, couleur] of [[28, 0, "rgba(150, 175, 255, 0.24)"], [42, Math.PI, "rgba(150, 175, 255, 0.14)"]]) {
      ctx.strokeStyle = couleur;
      for (let i = 0; i < 26; i++) {
        const base = R * (0.25 + i * 0.03);
        const amp = R * 0.035;
        ctx.beginPath();
        for (let k = 0; k <= 720; k++) {
          const t = (k / 720) * Math.PI * 2;
          const rr = base + amp * Math.sin(lobes * t + phase + i * 0.42);
          const x = cx + rr * Math.cos(t);
          const y = cy + rr * Math.sin(t);
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  }
  let minuterie = null;
  window.addEventListener("resize", () => { clearTimeout(minuterie); minuterie = setTimeout(guilloche, 150); });

  // ------------------------------------------------------------ Démarrage
  listeRegles();
  guilloche();
  majEffacer();
})();
