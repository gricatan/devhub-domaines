// Le formulaire de demande eu.org, pre-rempli.
//
// eu.org n'a pas d'API : leur interface est un vieux Django, et leur charte
// n'interdit ni les scripts ni l'automatisation (verifie le 2026-09-04 : ni
// robots.txt ni policy.html n'en parlent ; leurs interdictions portent sur
// l'usage du domaine - spam, phishing, link-spam).
//
// Ce que fait ce module : ouvrir leur site dans une fenetre de l'application et
// **remplir les champs techniques** - nom de domaine et serveurs de noms - qui
// sont precisement ceux qu'on rate.
//
// Ce qu'il ne fait pas, et ne fera pas :
//   - toucher au mot de passe. L'utilisateur se connecte lui-meme ; tant que la
//     page est celle de connexion, aucun code n'est injecte.
//   - soumettre le formulaire. On prepare, l'utilisateur relit et valide. Leur
//     traitement est manuel et benevole : c'est un humain qui lira la demande,
//     autant qu'un humain l'ait envoyee.

const { BaseWindow, WebContentsView, session } = require("electron");
const journal = require("../coeur/journal");
const habillage = require("./habillage");

const SITE = "https://nic.eu.org/arf/fr/";
const HOTE = "nic.eu.org";
const LARGEUR_GUIDE = 340;

// Les pages ou l'on n'injecte rien, quoi qu'il arrive.
const CHEMINS_IDENTITE = ["/login", "/password", "/reset"];

function surFormulaire(url) {
    try {
        const u = new URL(url);
        if (u.hostname !== HOTE) return false;
        return !CHEMINS_IDENTITE.some((c) => u.pathname.includes(c));
    } catch {
        return false;
    }
}

function pageGuide(domaine, serveurs) {
    const ns = serveurs.map((n) => `<code style="color:#4fb3a5">${n}</code>`).join("<br>");
    return (
        "data:text/html;charset=utf-8," +
        encodeURIComponent(`
<meta charset="utf-8">
<body style="margin:0;padding:22px;background:#15141c;color:#efedf6;
             font:14px/1.6 'Segoe UI',system-ui,sans-serif">
  <h1 style="font-size:16px;margin:0 0 4px">Demande eu.org</h1>
  <p style="margin:0 0 16px;font-family:Consolas,monospace;color:#4fb3a5">${domaine}</p>
  <ol style="padding-left:18px;margin:0;color:#a9a6bd">
    <li style="margin-bottom:12px"><b style="color:#efedf6">Connecte-toi</b> avec ton identifiant eu.org.
      <span style="color:#726f88">L'application ne lit rien de cette page.</span></li>
    <li style="margin-bottom:12px">Ouvre le formulaire de <b style="color:#efedf6">demande de domaine</b>.
      L'application remplira le nom et les serveurs de noms pour toi.</li>
    <li style="margin-bottom:12px">Vérifie, coche <b style="color:#efedf6">Privé</b>, et
      <b style="color:#efedf6">laisse les champs IP vides</b>.</li>
    <li>C'est toi qui envoies. Puis tu peux fermer cette fenêtre.</li>
  </ol>
  <p style="margin-top:16px;padding:11px 13px;border-radius:8px;background:#272631;font-size:12.5px;color:#a9a6bd">
    Serveurs à déclarer :<br>${ns}</p>
  <p id="etat" style="margin-top:14px;padding:11px 13px;border-radius:8px;
     background:#272631;color:#a9a6bd;font-size:13px">…</p>
  <button id="fini" style="margin-top:14px;width:100%;background:#4fb3a5;border:0;
     border-radius:8px;color:#0c1a18;padding:11px;font:inherit;font-size:14px;font-weight:600;
     cursor:pointer">J'ai envoyé ma demande</button>
  <button id="tout" style="margin-top:9px;width:100%;background:none;border:1px solid #332f40;
     border-radius:8px;color:#a9a6bd;padding:9px;font:inherit;font-size:12.5px;cursor:pointer">
    Afficher tous les champs</button>
  <button id="annuler" style="margin-top:9px;width:100%;background:none;border:1px solid #332f40;
     border-radius:8px;color:#a9a6bd;padding:10px;font:inherit;font-size:13.5px;cursor:pointer">
    ← Fermer</button>
  <script>
    document.getElementById("annuler").addEventListener("click", () => document.body.dataset.annule = "1");
    document.getElementById("fini").addEventListener("click", () => document.body.dataset.fini = "1");
    document.getElementById("tout").addEventListener("click", () => document.body.dataset.tout = "1");
  <\/script>
</body>`)
    );
}

// Le remplissage se repere sur les libelles affiches, pas sur des noms de champs
// devines : leur formulaire est ancien et ses attributs peuvent changer, mais les
// libelles visibles, eux, sont stables.
function codeRemplissage(domaine, serveurs) {
    return `
    (() => {
        const poser = (champ, valeur) => {
            if (!champ || champ.value) return false;
            champ.value = valeur;
            champ.dispatchEvent(new Event('input', { bubbles: true }));
            champ.dispatchEvent(new Event('change', { bubbles: true }));
            champ.style.outline = '2px solid #4fb3a5';
            return true;
        };

        const champs = [...document.querySelectorAll('input[type=text], input:not([type])')]
            .filter(e => e.offsetParent !== null);
        if (!champs.length) return { trouve: false };

        // Le libelle d'un champ : son <label>, ou le texte qui le precede.
        const libelle = (e) => {
            const l = e.labels && e.labels[0];
            if (l) return l.textContent.trim();
            const p = e.previousElementSibling;
            return p ? p.textContent.trim() : (e.name || '') + (e.id || '');
        };

        let poses = 0;

        // 1. le nom de domaine complet
        const cible = champs.find(e => /domaine|domain/i.test(libelle(e)) && !/IP/i.test(libelle(e)));
        if (poser(cible, ${JSON.stringify(domaine)})) poses++;

        // 2. les serveurs de noms : Nom1, Nom2... surtout pas les champs IP
        const serveurs = ${JSON.stringify(serveurs)};
        const champsNom = champs.filter(e => /^nom\\s*\\d|^name\\s*\\d/i.test(libelle(e)));
        for (let i = 0; i < serveurs.length && i < champsNom.length; i++) {
            if (poser(champsNom[i], serveurs[i])) poses++;
        }

        const champsIp = champs.filter(e => /^ip\\s*\\d/i.test(libelle(e)));
        for (const e of champsIp) {
            if (!e.value) e.style.outline = '2px dashed #726f88';  // rappel visuel : rester vide
        }

        if (cible) cible.scrollIntoView({ block: 'center' });
        return { trouve: true, poses, champsNom: champsNom.length, champsIp: champsIp.length };
    })()`;
}

function ouvrir(domaine, serveurs) {
    return new Promise((resoudre, rejeter) => {
        const fenetre = new BaseWindow({ width: 1300, height: 860, title: `eu.org — ${domaine}` });

        const guide = new WebContentsView();
        guide.webContents.loadURL(pageGuide(domaine, serveurs));

        const partition = session.fromPartition("persist:euorg");
        const site = new WebContentsView({ webPreferences: { session: partition } });

        fenetre.contentView.addChildView(guide);
        fenetre.contentView.addChildView(site);

        const disposer = () => {
            const { width, height } = fenetre.getContentBounds();
            guide.setBounds({ x: 0, y: 0, width: LARGEUR_GUIDE, height });
            site.setBounds({ x: LARGEUR_GUIDE, y: 0, width: Math.max(0, width - LARGEUR_GUIDE), height });
        };
        disposer();
        fenetre.on("resize", disposer);

        let termine = false;
        let dejaRempli = false;

        const finir = (erreur, valeur) => {
            if (termine) return;
            termine = true;
            clearInterval(minuterie);
            if (!fenetre.isDestroyed()) fenetre.destroy();
            erreur ? rejeter(erreur) : resoudre(valeur);
        };

        const direEtat = (texte, bon) => {
            guide.webContents
                .executeJavaScript(
                    `(() => { const e = document.getElementById("etat");
                      if (e) { e.textContent = ${JSON.stringify(texte)};
                      e.style.background = ${bon ? '"#14291f"' : '"#272631"'};
                      e.style.color = ${bon ? '"#54c48f"' : '"#a9a6bd"'}; } })()`
                )
                .catch(() => {});
        };

        // Le style est pose sur CHAQUE page, connexion comprise. insertCSS ne
        // peut pas lire un champ : la refonte visuelle ne coute aucune garantie.
        site.webContents.on("dom-ready", () => {
            if (site.webContents.getURL().includes("nic.eu.org")) {
                site.webContents.insertCSS(habillage.STYLE).catch(() => {});
            }
        });

        const minuterie = setInterval(async () => {
            if (termine) return;

            const d = await guide.webContents
                .executeJavaScript(
                    '({ annule: document.body.dataset.annule === "1", fini: document.body.dataset.fini === "1", tout: document.body.dataset.tout === "1" })'
                )
                .catch(() => ({}));

            if (d.annule) return finir(new Error("__annule__"));
            if (d.fini) return finir(null, { envoyee: true });

            // Filet : si le masquage a cache quelque chose d'utile, on rend tout.
            if (d.tout) {
                guide.webContents.executeJavaScript('document.body.dataset.tout = ""').catch(() => {});
                if (surFormulaire(site.webContents.getURL())) {
                    const n = await site.webContents
                        .executeJavaScript(habillage.CODE_TOUT_AFFICHER)
                        .catch(() => 0);
                    direEtat(`${n} champ(s) réaffiché(s).`, false);
                }
            }
            if (site.webContents.isDestroyed()) return;

            if (!surFormulaire(site.webContents.getURL())) {
                direEtat("Page de connexion — l'application n'y touche pas.", false);
                dejaRempli = false;
                return;
            }

            if (dejaRempli) return;

            const r = await site.webContents
                .executeJavaScript(codeRemplissage(domaine, serveurs))
                .catch(() => null);

            if (!r || !r.trouve) {
                direEtat("Ouvre le formulaire de demande de domaine.", false);
                return;
            }

            if (r.poses > 0) {
                dejaRempli = true;
                journal.action(`eu.org : ${r.poses} champ(s) pre-rempli(s) pour ${domaine}.`);

                // Les champs restes vides ne servent a rien ici : serveurs
                // surnumeraires et adresses IP, qui doivent justement rester
                // vides. Les masquer evite de les remplir par erreur.
                const masques = await site.webContents
                    .executeJavaScript(habillage.CODE_MASQUER_VIDES)
                    .catch(() => 0);

                direEtat(
                    `${r.poses} champ(s) rempli(s), ${masques} champ(s) vide(s) masqué(s). Vérifie, coche Privé, puis envoie.`,
                    true
                );
            } else {
                direEtat("Les champs semblent déjà remplis. Vérifie avant d'envoyer.", false);
            }
        }, 1500);

        fenetre.on("closed", () => finir(new Error("__annule__")));

        site.webContents.loadURL(SITE);
        journal.action(`eu.org : fenetre ouverte pour ${domaine}`);
    });
}

// --- Retirer un domaine de chez eu.org ---------------------------------------
//
// Il n'y a aucune API, et je n'ai pas observe leur procedure de suppression :
// je n'ecris donc pas de code qui pretendrait la connaitre. On ouvre leur
// espace, habille aux couleurs de l'application, et on dit quoi y chercher.
// L'utilisateur agit ; l'application n'injecte rien d'autre que du style.
function ouvrirEspace(domaine) {
    return new Promise((resoudre) => {
        const fenetre = new BaseWindow({ width: 1300, height: 860, title: `eu.org — ${domaine}` });

        const guide = new WebContentsView();
        guide.webContents.loadURL(pageRetrait(domaine));

        const partition = session.fromPartition("persist:euorg");
        const site = new WebContentsView({ webPreferences: { session: partition } });

        fenetre.contentView.addChildView(guide);
        fenetre.contentView.addChildView(site);

        const disposer = () => {
            const { width, height } = fenetre.getContentBounds();
            guide.setBounds({ x: 0, y: 0, width: LARGEUR_GUIDE, height });
            site.setBounds({ x: LARGEUR_GUIDE, y: 0, width: Math.max(0, width - LARGEUR_GUIDE), height });
        };
        disposer();
        fenetre.on("resize", disposer);

        let termine = false;
        const finir = (valeur) => {
            if (termine) return;
            termine = true;
            clearInterval(minuterie);
            if (!fenetre.isDestroyed()) fenetre.destroy();
            resoudre(valeur);
        };

        // Style partout, connexion comprise : insertCSS ne peut pas lire un champ.
        site.webContents.on("dom-ready", () => {
            if (site.webContents.getURL().includes(HOTE)) {
                site.webContents.insertCSS(habillage.STYLE).catch(() => {});
            }
        });

        const minuterie = setInterval(async () => {
            if (termine) return;
            const d = await guide.webContents
                .executeJavaScript('({ fini: document.body.dataset.fini === "1" })')
                .catch(() => ({}));
            if (d.fini) finir({ ok: true, fait: true });
        }, 1200);

        fenetre.on("closed", () => finir({ ok: true, fait: false }));

        site.webContents.loadURL(SITE);
        journal.action(`eu.org : espace ouvert pour retirer ${domaine}`);
    });
}

function pageRetrait(domaine) {
    return (
        "data:text/html;charset=utf-8," +
        encodeURIComponent(`
<meta charset="utf-8">
<body style="margin:0;padding:22px;background:#15141c;color:#efedf6;
             font:14px/1.6 'Segoe UI',system-ui,sans-serif">
  <h1 style="font-size:16px;margin:0 0 4px">Retirer de chez eu.org</h1>
  <p style="margin:0 0 16px;font-family:Consolas,monospace;color:#4fb3a5">${domaine}</p>
  <ol style="padding-left:18px;margin:0;color:#a9a6bd">
    <li style="margin-bottom:12px"><b style="color:#efedf6">Connecte-toi</b> si la page te le demande.
      <span style="color:#726f88">L'application ne lit rien de cette page.</span></li>
    <li style="margin-bottom:12px">Ouvre la <b style="color:#efedf6">liste de tes domaines et demandes</b>.</li>
    <li style="margin-bottom:12px">Cherche <b style="color:#efedf6">${domaine}</b> et utilise leur option
      de suppression ou d'abandon.</li>
    <li>Referme quand c'est fait.</li>
  </ol>
  <p style="margin-top:16px;padding:11px 13px;border-radius:8px;background:#272631;
     font-size:12.5px;color:#a9a6bd">
    eu.org n'a pas d'API : cette partie se fait chez eux, à la main.
    L'application ne clique à ta place nulle part ici.</p>
  <button id="fini" style="margin-top:14px;width:100%;background:none;border:1px solid #332f40;
     border-radius:8px;color:#a9a6bd;padding:10px;font:inherit;font-size:13.5px;cursor:pointer">
    ← Fermer</button>
  <script>
    document.getElementById("fini").addEventListener("click", () => document.body.dataset.fini = "1");
  <\/script>
</body>`)
    );
}

// --- La demande est-elle deja deposee ? --------------------------------------
//
// eu.org n'expose ni API ni whois joignable (port 43 en timeout). La seule
// source est leur interface, qui liste les domaines et les demandes en cours.
//
// La session de la fenetre eu.org est persistante : apres une premiere
// connexion, on peut donc charger la page SANS RIEN AFFICHER, lire, et fermer.
// L'utilisateur n'est derange que si la session a expire.
//
// La page lue n'est pas une page d'identite : l'injection y est permise, comme
// pour le formulaire.
function verifierDemande(domaine) {
    return new Promise((resoudre) => {
        const partition = session.fromPartition("persist:euorg");
        const vue = new WebContentsView({ webPreferences: { session: partition } });

        let fini = false;
        const rendre = (r) => {
            if (fini) return;
            fini = true;
            clearTimeout(minuterie);
            try {
                vue.webContents.destroy();
            } catch {
                // la vue peut deja etre partie : sans consequence
            }
            resoudre(r);
        };

        const minuterie = setTimeout(() => {
            journal.avertissement(`eu.org : pas de reponse en 15 s, ${domaine} non verifie.`);
            rendre({ ok: false, message: "eu.org n'a pas répondu à temps." });
        }, 15000);

        vue.webContents.on("did-finish-load", async () => {
            const url = vue.webContents.getURL();

            // Redirige vers la connexion : la session a expire.
            if (!surFormulaire(url)) {
                journal.info(`eu.org : session expiree, verification de ${domaine} impossible.`);
                return rendre({ ok: true, connexionRequise: true });
            }

            const vu = await vue.webContents
                .executeJavaScript(`
                    (() => {
                        const txt = document.body ? document.body.innerText : "";
                        const cible = ${JSON.stringify(domaine.toLowerCase())};
                        const bas = txt.toLowerCase();
                        const i = bas.indexOf(cible);
                        // Le handle du compte connecte (forme "AB1234-FREE").
                        // Il compte : plusieurs comptes eu.org peuvent coexister,
                        // et un domaine demande sous l'un est invisible sous l'autre.
                        // [0-9] plutot que \d : ce code passe par un template literal,
                        // ou \d serait reduit a un simple "d".
                        const h = txt.match(/[A-Z]{2}[0-9]+-[A-Z]+/);
                        return {
                            handle: h ? h[0] : null,
                            present: i !== -1,
                            // Le voisinage du nom porte souvent son statut.
                            extrait: i === -1 ? null : txt.slice(Math.max(0, i - 90), i + 160).trim()
                        };
                    })()
                `)
                .catch(() => null);

            if (!vu) {
                journal.avertissement(`eu.org : page illisible, ${domaine} non verifie.`);
                return rendre({ ok: false, message: "Page illisible." });
            }

            journal.info(
                `eu.org : ${domaine} ${vu.present ? "figure" : "ne figure pas"} dans ton espace.`
            );

            // Un "ne figure pas" peut simplement vouloir dire qu'on lit la
            // mauvaise page : leur accueil est un menu, pas une liste. On note
            // donc ou mene cette page, pour que l'echec soit diagnosticable.
            if (!vu.present) {
                journal.info(`eu.org : ${domaine} absent de la liste du compte ${vu.handle || "?"}.`);
            }
            rendre({ ok: true, deposee: vu.present, handle: vu.handle, extrait: vu.extrait });
        });

        vue.webContents.on("did-fail-load", (_e, code, description) => {
            if (code === -3) return;
            journal.avertissement(`eu.org : chargement impossible (${description}).`);
            rendre({ ok: false, message: `Chargement impossible (${description}).` });
        });

        journal.action(`eu.org : verification silencieuse de ${domaine}...`);
        vue.webContents.loadURL(SITE);
    });
}

module.exports = { ouvrir, ouvrirEspace, verifierDemande };
