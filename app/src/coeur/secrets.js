// Le coffre a secrets.
//
// EN PRODUCTION, UNE SEULE SOURCE : le coffre chiffre. On s'appuie sur
// safeStorage d'Electron, qui utilise DPAPI sous Windows : la cle est derivee
// de la session Windows de l'utilisateur. Un autre compte sur la meme machine,
// ou le fichier recopie ailleurs, ne dechiffre rien.
//
// .env.local n'existe QUE pendant le developpement, et la difference n'est pas
// une affaire de discipline : elle est verrouillee par app.isPackaged. Dans une
// application packagee, le fichier n'est meme pas cherche. Aucun fichier en
// clair ne peut donc servir de porte d'entree chez un utilisateur, meme si
// quelqu'un en depose un a cote de l'executable.
//
// Rien n'est jamais ecrit en clair sur le disque par ce module.

const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const NOM_FICHIER = "secrets.enc";

let cache = null; // { cle: valeur }
let sourcesEnvLocal = new Set(); // cles venues de .env.local, a ne pas persister

function cheminCoffre() {
    return path.join(app.getPath("userData"), NOM_FICHIER);
}

// --- .env.local : developpement uniquement ----------------------------------
// Le garde-fou est ici, en une ligne, et pas dans une consigne d'usage.
function chargerEnvLocal(racine) {
    const valeurs = {};
    if (app.isPackaged) return valeurs; // application livree : on ne lit aucun fichier en clair

    const fichier = path.join(racine, ".env.local");
    if (!fs.existsSync(fichier)) return valeurs;

    for (const ligne of fs.readFileSync(fichier, "utf8").split(/\r?\n/)) {
        const nette = ligne.trim();
        if (!nette || nette.startsWith("#")) continue;
        const coupe = nette.indexOf("=");
        if (coupe === -1) continue;

        const cle = nette.slice(0, coupe).trim();
        let valeur = nette.slice(coupe + 1).trim();
        if (/^".*"$/.test(valeur) || /^'.*'$/.test(valeur)) valeur = valeur.slice(1, -1);
        if (cle && valeur) valeurs[cle] = valeur;
    }
    return valeurs;
}

// --- Le coffre chiffre --------------------------------------------------------
function chiffrementDisponible() {
    try {
        return safeStorage.isEncryptionAvailable();
    } catch {
        return false;
    }
}

function lireCoffre() {
    const fichier = cheminCoffre();
    if (!fs.existsSync(fichier)) return {};
    if (!chiffrementDisponible()) return {};

    try {
        const chiffre = fs.readFileSync(fichier);
        return JSON.parse(safeStorage.decryptString(chiffre));
    } catch {
        // Coffre illisible : machine differente, session changee, fichier abime.
        // On repart d'un coffre vide plutot que d'empecher l'application de
        // demarrer ; l'utilisateur se reconnectera.
        return {};
    }
}

function ecrireCoffre(valeurs) {
    if (!chiffrementDisponible()) {
        throw new Error("Le chiffrement du systeme n'est pas disponible : rien n'a ete enregistre.");
    }
    const chiffre = safeStorage.encryptString(JSON.stringify(valeurs));
    fs.writeFileSync(cheminCoffre(), chiffre);
}

// --- Interface ----------------------------------------------------------------
function initialiser(racineProjet) {
    const duFichier = chargerEnvLocal(racineProjet);
    sourcesEnvLocal = new Set(Object.keys(duFichier));

    // Le coffre d'abord, .env.local par-dessus : en developpement, le fichier
    // fait autorite, ce qui evite de se demander lequel des deux s'applique.
    cache = { ...lireCoffre(), ...duFichier };

    return {
        mode: app.isPackaged ? "production" : "developpement",
        chiffrement: chiffrementDisponible(),
        depuisEnvLocal: [...sourcesEnvLocal],
        coffre: cheminCoffre()
    };
}

function lire(cle) {
    return cache?.[cle] ?? null;
}

function possede(cle) {
    return Boolean(cache?.[cle]);
}

function ecrire(cle, valeur) {
    cache[cle] = valeur;
    if (sourcesEnvLocal.has(cle)) return { persiste: false, raison: "valeur fournie par .env.local" };

    const aEcrire = {};
    for (const [k, v] of Object.entries(cache)) {
        if (!sourcesEnvLocal.has(k)) aEcrire[k] = v;
    }
    ecrireCoffre(aEcrire);
    return { persiste: true };
}

function oublier(cle) {
    delete cache[cle];
    const aEcrire = {};
    for (const [k, v] of Object.entries(cache)) {
        if (!sourcesEnvLocal.has(k)) aEcrire[k] = v;
    }
    ecrireCoffre(aEcrire);
}

// Ne renvoie jamais les valeurs : l'interface n'a besoin que de savoir
// quelles cles existent et d'ou elles viennent.
function etat() {
    return Object.keys(cache ?? {}).map((cle) => ({
        cle,
        origine: sourcesEnvLocal.has(cle) ? "env.local" : "coffre",
        longueur: String(cache[cle]).length
    }));
}

module.exports = { initialiser, lire, possede, ecrire, oublier, etat, chiffrementDisponible };
