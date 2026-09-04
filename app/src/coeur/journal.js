// Le journal.
//
// L'application fait des choses sur le compte de quelqu'un d'autre : creer une
// zone, poser des enregistrements, ouvrir un tunnel. L'utilisateur doit pouvoir
// lire ce qui a ete fait, sans avoir a nous croire sur parole. Le journal est
// donc visible dans l'interface, pas cache dans un fichier de debogage.
//
// Regle : aucune valeur de secret n'entre ici. Les fonctions qui manipulent des
// jetons passent par masquer().

const lignes = [];
const abonnes = new Set();

const NIVEAUX = new Set(["info", "action", "succes", "avertissement", "erreur"]);

function masquer(valeur) {
    const texte = String(valeur ?? "");
    if (texte.length <= 8) return "********";
    return `${texte.slice(0, 4)}...${texte.slice(-2)} (${texte.length} caracteres)`;
}

function ecrire(niveau, message, details = null) {
    const ligne = {
        t: new Date().toISOString(),
        niveau: NIVEAUX.has(niveau) ? niveau : "info",
        message: String(message),
        details
    };
    lignes.push(ligne);
    if (lignes.length > 500) lignes.shift();

    console.log(`[${ligne.niveau}] ${ligne.message}${details ? " :: " + JSON.stringify(details) : ""}`);
    for (const abonne of abonnes) {
        try {
            abonne(ligne);
        } catch {
            // un abonne mort ne doit pas interrompre le journal
        }
    }
    return ligne;
}

const info = (m, d) => ecrire("info", m, d);
const action = (m, d) => ecrire("action", m, d);
const succes = (m, d) => ecrire("succes", m, d);
const avertissement = (m, d) => ecrire("avertissement", m, d);
const erreur = (m, d) => ecrire("erreur", m, d);

function abonner(fn) {
    abonnes.add(fn);
    return () => abonnes.delete(fn);
}

function tout() {
    return [...lignes];
}

module.exports = { info, action, succes, avertissement, erreur, abonner, tout, masquer };
