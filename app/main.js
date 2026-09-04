// DevHub Domaines - processus principal.
//
// Jalon 01 : le socle. Une fenetre, la navigation entre ecrans, le journal
// visible, et le coffre a secrets. Rien de metier encore : ce qui est ici doit
// juste etre solide, parce que tout le reste s'y appuiera.

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");

const secrets = require("./src/coeur/secrets");
const journal = require("./src/coeur/journal");
const cloudflare = require("./src/services/cloudflare/auth");
const api = require("./src/services/cloudflare/api");
const zones = require("./src/services/cloudflare/zones");
const verifDns = require("./src/services/dns");
const euorg = require("./src/services/euorg");
const euorgFormulaire = require("./src/services/euorg-formulaire");
const tunnel = require("./src/services/cloudflare/tunnel");
const cloudflared = require("./src/services/cloudflared");

// La racine du projet, ou vit .env.local en developpement.
const RACINE_PROJET = path.join(__dirname, "..");

let fenetre = null;

function creerFenetre() {
    fenetre = new BrowserWindow({
        width: 1180,
        height: 780,
        minWidth: 900,
        minHeight: 600,
        title: "DevHub Domaines",
        backgroundColor: "#14131b",
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    // Une erreur dans l'interface est invisible sans devtools : on la fait
    // remonter au journal, sinon un ecran muet reste inexplicable.
    // Deux signatures coexistent selon la version d'Electron : l'ancienne passe
    // des arguments positionnels avec un niveau numerique, la nouvelle un seul
    // objet avec un niveau textuel. On accepte les deux.
    fenetre.webContents.on("console-message", (...args) => {
        const e = args[0] || {};
        const ancien = args.length > 1;
        const niveau = ancien ? args[1] : e.level;
        const message = ancien ? args[2] : e.message;
        const ligne = ancien ? args[3] : e.lineNumber;
        const source = ancien ? args[4] : e.sourceId;

        const grave = typeof niveau === "number"
            ? niveau >= 2                                  // 2 = warning, 3 = error
            : niveau === "warning" || niveau === "error";
        if (!grave) return;

        const ou = source ? `${String(source).split("/").pop()}:${ligne}` : "interface";
        journal.erreur(`Interface (${ou}) : ${message}`);
    });

    fenetre.once("ready-to-show", () => fenetre.show());
    fenetre.loadFile(path.join(__dirname, "ui", "index.html"));

    // Le journal du processus principal remonte a l'interface en direct.
    journal.abonner((ligne) => {
        if (fenetre && !fenetre.isDestroyed()) {
            fenetre.webContents.send("journal", ligne);
        }
    });
}

// --- Ce que l'interface a le droit de demander -------------------------------
ipcMain.handle("etat-initial", () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    secrets: secrets.etat(),
    journal: journal.tout(),
    cloudflare: cloudflare.etat()
}));

// --- Domaine : zones, enregistrements, verifications --------------------------
function exigerJeton() {
    const jeton = cloudflare.bearer();
    if (!jeton) throw new Error("Connecte-toi d'abord a Cloudflare.");
    return jeton;
}

ipcMain.handle("dns:libre", async (_e, nom) => {
    journal.action(`Verification de la disponibilite de ${nom}...`);
    const r = await verifDns.estLibre(nom);

    // Le DNS public ne voit pas une zone creee mais pas encore deleguee : sans
    // ce croisement, l'application dirait "libre" a propos d'un domaine que
    // l'utilisateur a deja chez lui. C'est le cas de tout domaine en attente.
    const jeton = cloudflare.bearer();
    if (jeton) {
        const z = await api.zones(jeton);
        const sienne = z.ok && z.liste.find((x) => x.nom.toLowerCase() === nom.toLowerCase());
        if (sienne) {
            journal.info(`${nom} est deja une de tes zones (${sienne.statut}).`);
            return {
                libre: false,
                dejaAToi: true,
                raison: `deja present sur ton compte Cloudflare, statut ${sienne.statut}`
            };
        }
    }

    journal.info(`${nom} : ${r.libre === true ? "libre" : r.libre === false ? "deja pris" : "indetermine"}`, {
        raison: r.raison
    });
    return r;
});

ipcMain.handle("zone:creer", async (_e, nom) => {
    try {
        const jeton = exigerJeton();
        const compte = await api.resoudreCompte(jeton);
        if (!compte.ok) return { ok: false, message: compte.message };
        return await zones.creer(jeton, nom, compte.compte.id);
    } catch (e) {
        return { ok: false, message: e.message };
    }
});

ipcMain.handle("zone:supprimer", async (_e, { id, nom }) => {
    try {
        return await zones.supprimer(exigerJeton(), id, nom);
    } catch (e) {
        return { ok: false, message: e.message };
    }
});

ipcMain.handle("zone:enregistrements", async (_e, zoneId) => {
    try {
        return await zones.enregistrements(exigerJeton(), zoneId);
    } catch (e) {
        return { ok: false, message: e.message };
    }
});

ipcMain.handle("zone:ajouter", async (_e, { zoneId, champ }) => {
    try {
        return await zones.ajouterEnregistrement(exigerJeton(), zoneId, champ);
    } catch (e) {
        return { ok: false, message: e.message };
    }
});

ipcMain.handle("zone:retirer", async (_e, { zoneId, id }) => {
    try {
        return await zones.supprimerEnregistrement(exigerJeton(), zoneId, id);
    } catch (e) {
        return { ok: false, message: e.message };
    }
});

ipcMain.handle("dns:verifier", async (_e, { nom, serveurs }) => {
    journal.action(`Interrogation des serveurs de noms de ${nom}...`);
    const rapport = await verifDns.verifierZone(nom, serveurs);
    const delegation = await verifDns.delegationActive(nom, serveurs);

    journal[rapport.conforme ? "succes" : "avertissement"](
        `${nom} : ${rapport.reussis}/${rapport.total} controles reussis` +
            (rapport.coherent ? "" : ", series divergentes"),
        { deleguee: delegation.deleguee }
    );

    return { rapport, delegation };
});

// --- Cloudflare ---------------------------------------------------------------
ipcMain.handle("cf:etat", () => cloudflare.etat());
ipcMain.handle("cf:oauth", () => cloudflare.connecterParOAuth());
ipcMain.handle("cf:jeton", (_e, valeur) => cloudflare.connecterParJeton(valeur));
ipcMain.handle("cf:deconnecter", () => cloudflare.deconnecter());
ipcMain.handle("cf:resume", () => cloudflare.resume());

// --- eu.org -------------------------------------------------------------------
ipcMain.handle("euorg:parents", () => euorg.parents());

ipcMain.handle("euorg:verifier", (_e, domaine) => euorgFormulaire.verifierDemande(domaine));

ipcMain.handle("euorg:formulaire", async (_e, { domaine, serveurs }) => {
    try {
        const r = await euorgFormulaire.ouvrir(domaine, serveurs);
        journal.succes(`eu.org : demande declaree envoyee pour ${domaine}.`);
        return { ok: true, ...r };
    } catch (e) {
        if (e.message === "__annule__") return { ok: false, annule: true };
        journal.avertissement(`eu.org : ${e.message}`);
        return { ok: false, message: e.message };
    }
});

const CLE_TUNNEL = (zone) => `tunnel.${zone}`;

// --- Vue d'accueil : reprendre plutot que tout recommencer -------------------
// L'application etait un assistant de creation ; il lui manquait de savoir
// rouvrir. Pour chaque domaine deja present, on dit son etat reel : delegue ou
// non, tunnel connu ou non. C'est ce qu'on veut voir en revenant trois jours
// plus tard.
ipcMain.handle("vue:accueil", async () => {
    const etatCf = cloudflare.etat();
    if (!etatCf.connecte) return { connecte: false, etatCf, domaines: [] };

    const jeton = cloudflare.bearer();
    const z = await api.zones(jeton);
    if (!z.ok) return { connecte: true, etatCf, domaines: [], message: z.message };

    const domaines = [];
    for (const zone of z.liste) {
        const d = await verifDns.delegationActive(zone.nom, zone.serveursDeNoms || []);
        domaines.push({
            id: zone.id,
            nom: zone.nom,
            statut: zone.statut,
            serveursDeNoms: zone.serveursDeNoms,
            deleguee: d.deleguee,
            // Un jeton de tunnel au coffre signifie qu'un tunnel a deja ete monte
            // pour ce domaine : on pourra le relancer sans rien recreer.
            tunnelConnu: secrets.possede(CLE_TUNNEL(zone.nom))
        });
    }

    return {
        connecte: true,
        etatCf,
        domaines,
        tunnelEnMarche: cloudflared.enMarche()
    };
});

// Relancer un tunnel deja monte : le jeton est au coffre, rien a recreer.
// --- Tout retirer pour un domaine --------------------------------------------
//
// L'empreinte d'un domaine est eparpillee : une zone Cloudflare, un tunnel au
// niveau du compte, un jeton dans le coffre, un processus cloudflared en cours,
// et - pour un .eu.org - une inscription chez eux.
//
// On defait tout ce qui est a notre portee, dans l'ordre, et on rend compte de
// chaque etape separement : une suppression a moitie faite doit se voir.
//
// Regle de prudence : on ne supprime QUE les tunnels que l'application a crees,
// reconnaissables a leur nom "devhub-<zone>". Un tunnel monte a la main par
// l'utilisateur ne nous appartient pas.
ipcMain.handle("domaine:demanteler", async (_e, { zoneId, zoneNom }) => {
    const etapes = [];
    const note = (quoi, ok, message) => etapes.push({ quoi, ok, message: message || null });

    try {
        const jeton = exigerJeton();

        if (cloudflared.enMarche()) {
            cloudflared.arreter();
            note("Tunnel local arrete", true);
        }

        const compte = await api.resoudreCompte(jeton);
        if (!compte.ok) {
            note("Compte Cloudflare", false, compte.message);
        } else {
            const l = await tunnel.lister(jeton, compte.compte.id);
            if (!l.ok) {
                note("Liste des tunnels", false, l.message);
            } else {
                const notres = l.liste.filter((t) => t.nom === `devhub-${zoneNom}`);
                if (!notres.length) note("Aucun tunnel cree par l'application", true);
                for (const t of notres) {
                    const r = await tunnel.supprimer(jeton, compte.compte.id, t.id);
                    note(`Tunnel "${t.nom}"`, r.ok, r.message);
                }
            }
        }

        if (secrets.possede(CLE_TUNNEL(zoneNom))) {
            secrets.oublier(CLE_TUNNEL(zoneNom));
            note("Jeton de tunnel efface du coffre", true);
        }

        // La zone emporte ses enregistrements DNS avec elle.
        const z = await zones.supprimer(jeton, zoneId, zoneNom);
        note(`Zone ${zoneNom} chez Cloudflare`, z.ok, z.message);

        const ok = etapes.every((e) => e.ok);
        journal[ok ? "succes" : "avertissement"](
            `Demantelement de ${zoneNom} : ${etapes.filter((e) => e.ok).length}/${etapes.length} etape(s) reussie(s).`
        );
        return { ok, etapes, euorg: zoneNom.endsWith(".eu.org") };
    } catch (e) {
        journal.erreur(`Demantelement de ${zoneNom} : ${e.message}`);
        return { ok: false, etapes, message: e.message };
    }
});

ipcMain.handle("euorg:espace", async (_e, domaine) => {
    try {
        return await euorgFormulaire.ouvrirEspace(domaine);
    } catch (e) {
        return { ok: false, message: e.message };
    }
});

ipcMain.handle("tunnel:relancer", async (_e, zoneNom) => {
    const jeton = secrets.lire(CLE_TUNNEL(zoneNom));
    if (!jeton) return { ok: false, message: "Aucun tunnel enregistré pour ce domaine." };

    if (!cloudflared.estInstalle()) {
        const inst = await cloudflared.installer((p) => {
            if (fenetre && !fenetre.isDestroyed()) fenetre.webContents.send("tunnel:progression", p);
        });
        if (!inst.ok) return inst;
    }
    return cloudflared.demarrer(jeton);
});

// --- Tunnel : rendre un service local accessible sans ouvrir de port ----------

ipcMain.handle("tunnel:etat", async () => ({
    installe: cloudflared.estInstalle(),
    enMarche: cloudflared.enMarche()
}));

ipcMain.handle("tunnel:installer", async () => {
    const r = await cloudflared.installer((pourcent) => {
        if (fenetre && !fenetre.isDestroyed()) fenetre.webContents.send("tunnel:progression", pourcent);
    });
    return r;
});

// Tout le parcours d'un coup : creer, configurer, router, lancer.
ipcMain.handle("tunnel:monter", async (_e, { zoneId, zoneNom, hote, service }) => {
    try {
        const jeton = exigerJeton();
        const compte = await api.resoudreCompte(jeton);
        if (!compte.ok) return { ok: false, message: compte.message };

        const inst = await cloudflared.installer((p) => {
            if (fenetre && !fenetre.isDestroyed()) fenetre.webContents.send("tunnel:progression", p);
        });
        if (!inst.ok) return inst;

        const c = await tunnel.creer(jeton, compte.compte.id, `devhub-${zoneNom}`);
        if (!c.ok) return c;

        const conf = await tunnel.configurer(jeton, compte.compte.id, c.tunnel.id, [
            { hote, service }
        ]);
        if (!conf.ok) return conf;

        const route = await tunnel.router(jeton, zoneId, hote, c.tunnel.cible);
        if (!route.ok) return route;

        // Le jeton de connexion est un secret : il va au coffre, jamais a l'interface.
        secrets.ecrire(CLE_TUNNEL(zoneNom), c.tunnel.jetonConnexion);

        const lance = cloudflared.demarrer(c.tunnel.jetonConnexion);
        if (!lance.ok) return lance;

        return { ok: true, tunnelId: c.tunnel.id, hote, service };
    } catch (e) {
        journal.erreur(`Tunnel : ${e.message}`);
        return { ok: false, message: e.message };
    }
});

ipcMain.handle("tunnel:sante", async (_e, { tunnelId }) => {
    try {
        const jeton = exigerJeton();
        const compte = await api.resoudreCompte(jeton);
        if (!compte.ok) return { ok: false, message: compte.message };
        const e = await tunnel.etat(jeton, compte.compte.id, tunnelId);
        return { ...e, enMarche: cloudflared.enMarche() };
    } catch (e) {
        return { ok: false, message: e.message };
    }
});

ipcMain.handle("tunnel:arreter", () => cloudflared.arreter());

// Ouvrir un lien dans le navigateur de l'utilisateur. La liste blanche evite
// que l'interface puisse faire ouvrir n'importe quoi.
const LIENS_AUTORISES = [
    "https://nic.eu.org/",
    "https://nic.eu.org/arf/fr/domain/create/",
    "https://dash.cloudflare.com/profile/api-tokens"
];

ipcMain.handle("ouvrir-lien", (_e, url) => {
    if (!LIENS_AUTORISES.includes(url)) {
        journal.avertissement(`Ouverture refusee pour une adresse non prevue : ${url}`);
        return { ok: false };
    }
    journal.action(`Ouverture de ${url}`);
    shell.openExternal(url);
    return { ok: true };
});

ipcMain.handle("secrets:etat", () => secrets.etat());

ipcMain.handle("secrets:ecrire", (_e, { cle, valeur }) => {
    if (!cle || typeof valeur !== "string" || !valeur.trim()) {
        return { ok: false, message: "Il faut une cle et une valeur." };
    }
    try {
        const r = secrets.ecrire(cle, valeur.trim());
        if (r.persiste) {
            journal.succes(`Secret enregistre dans le coffre : ${cle}`, { valeur: journal.masquer(valeur) });
        } else {
            journal.avertissement(`${cle} vient de .env.local : la valeur n'est pas ecrite dans le coffre.`);
        }
        return { ok: true, ...r, etat: secrets.etat() };
    } catch (e) {
        journal.erreur(`Enregistrement impossible : ${e.message}`);
        return { ok: false, message: e.message };
    }
});

ipcMain.handle("secrets:oublier", (_e, cle) => {
    try {
        secrets.oublier(cle);
        journal.action(`Secret oublie : ${cle}`);
        return { ok: true, etat: secrets.etat() };
    } catch (e) {
        journal.erreur(`Suppression impossible : ${e.message}`);
        return { ok: false, message: e.message };
    }
});

// --- Demarrage ----------------------------------------------------------------
// Une seule instance : deux copies partageraient le meme coffre et le meme
// dossier de donnees, ce qui abime le cache et pourrait corrompre les secrets.
// Un second lancement rend simplement la main a la fenetre deja ouverte.
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (fenetre) {
            if (fenetre.isMinimized()) fenetre.restore();
            fenetre.focus();
        }
    });
}

app.whenReady().then(() => {
    const info = secrets.initialiser(RACINE_PROJET);

    journal.info(`DevHub Domaines demarre en mode ${info.mode}.`);

    if (!info.chiffrement) {
        journal.erreur(
            "Le chiffrement du systeme n'est pas disponible : aucun secret ne pourra etre enregistre."
        );
    } else {
        journal.info("Coffre chiffre disponible (DPAPI via safeStorage).");
    }

    if (info.depuisEnvLocal.length) {
        journal.avertissement(
            `Mode developpement : ${info.depuisEnvLocal.length} valeur(s) lue(s) dans .env.local`,
            { cles: info.depuisEnvLocal }
        );
    } else if (info.mode === "production") {
        journal.info("Mode production : aucun fichier en clair n'est lu.");
    }

    creerFenetre();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) creerFenetre();
    });
});

app.on("window-all-closed", () => {
    // Ne pas laisser un processus tourner derriere le dos de l'utilisateur.
    cloudflared.arreter();
    app.quit();
});
