// L'identification a Cloudflare, derriere une interface unique.
//
// Deux chemins, un seul resultat : un jeton porteur. Le code metier appelle
// bearer() et ignore completement lequel des deux a servi.
//
//   OAuth  - un clic dans le navigateur, rien a copier. Expire au bout d'une
//            heure, ce qui suffit largement a configurer un domaine.
//   Jeton  - l'utilisateur cree un jeton d'API dans son tableau de bord et le
//            colle. Ne perime pas, marche meme si le client OAuth n'est pas
//            encore publie.
//
// En developpement, un CF_API_TOKEN present dans .env.local est utilise
// directement : c'est le troisieme chemin, invisible en production.

const secrets = require("../../coeur/secrets");
const journal = require("../../coeur/journal");
const api = require("./api");
const oauth = require("./oauth");

const CLES = {
    jetonApi: "cloudflare.jeton_api",
    oauthJeton: "cloudflare.oauth_jeton",
    oauthEcheance: "cloudflare.oauth_echeance",
    oauthScopes: "cloudflare.oauth_scopes",
    clientId: "CF_OAUTH_CLIENT_ID"
};

// Une fois le client OAuth publie, son identifiant sera ecrit ici. Avec PKCE il
// n'y a aucun secret a proteger : il peut vivre en clair dans le code livre.
const CLIENT_ID_PUBLIE = null;

// account-settings.read ne sert qu'a un cas : l'utilisateur n'a encore aucune
// zone, donc rien d'ou tirer son identifiant de compte. Des qu'une zone existe,
// elle porte l'information et ce scope ne sert plus a rien.
const SCOPES =
    "zone.read zone.write dns.read dns.write argotunnel.read argotunnel.write account-settings.read";

function clientId() {
    return CLIENT_ID_PUBLIE || secrets.lire(CLES.clientId);
}

function oauthExpire() {
    const echeance = Number(secrets.lire(CLES.oauthEcheance) || 0);
    return !echeance || Date.now() >= echeance;
}

// L'ordre compte : un jeton OAuth frais d'abord, puis le jeton d'API.
function source() {
    if (secrets.possede(CLES.oauthJeton) && !oauthExpire()) {
        return { type: "oauth", jeton: secrets.lire(CLES.oauthJeton) };
    }
    if (secrets.possede(CLES.jetonApi)) {
        return { type: "jeton", jeton: secrets.lire(CLES.jetonApi) };
    }
    if (secrets.possede("CF_API_TOKEN")) {
        return { type: "env", jeton: secrets.lire("CF_API_TOKEN") };
    }
    return null;
}

function bearer() {
    return source()?.jeton ?? null;
}

const LIBELLES = {
    oauth: "connexion Cloudflare (OAuth)",
    jeton: "jeton d'API",
    env: ".env.local (developpement)"
};

function etat() {
    const s = source();
    const echeance = Number(secrets.lire(CLES.oauthEcheance) || 0);

    return {
        connecte: Boolean(s),
        type: s?.type ?? null,
        libelle: s ? LIBELLES[s.type] : null,
        oauthPossible: Boolean(clientId()),
        oauthExpire: secrets.possede(CLES.oauthJeton) ? oauthExpire() : null,
        expireLe: echeance ? new Date(echeance).toISOString() : null,
        scopes: secrets.lire(CLES.oauthScopes)
    };
}

// --- Se connecter -------------------------------------------------------------
async function connecterParOAuth() {
    const id = clientId();
    if (!id) {
        return {
            ok: false,
            message:
                "Aucun identifiant de client OAuth. En developpement, ajoute CF_OAUTH_CLIENT_ID dans .env.local."
        };
    }

    try {
        const r = await oauth.autoriser({ clientId: id, scopes: SCOPES, journal });

        secrets.ecrire(CLES.oauthJeton, r.jeton);
        secrets.ecrire(CLES.oauthScopes, r.scopes || SCOPES);
        if (r.expireDans) {
            secrets.ecrire(CLES.oauthEcheance, String(Date.now() + r.expireDans * 1000));
        }

        journal.succes("Connecte a Cloudflare.", {
            scopes: r.scopes,
            expireDans: r.expireDans ? `${r.expireDans} s` : "inconnu"
        });

        return { ok: true, etat: etat() };
    } catch (e) {
        journal.erreur(`Connexion a Cloudflare impossible : ${e.message}`);
        return { ok: false, message: e.message };
    }
}

async function connecterParJeton(valeur) {
    const jeton = String(valeur || "").trim();
    if (!jeton) return { ok: false, message: "Le jeton est vide." };

    journal.action("Verification du jeton d'API.");
    const v = await api.verifier(jeton);
    if (!v.ok) {
        journal.erreur(`Jeton refuse par Cloudflare : ${v.message}`);
        return { ok: false, message: `Cloudflare refuse ce jeton : ${v.message}` };
    }

    secrets.ecrire(CLES.jetonApi, jeton);
    journal.succes(`Jeton d'API enregistre (${v.statut}).`, { jeton: journal.masquer(jeton) });
    return { ok: true, etat: etat() };
}

function deconnecter() {
    for (const cle of [CLES.oauthJeton, CLES.oauthEcheance, CLES.oauthScopes, CLES.jetonApi]) {
        if (secrets.possede(cle)) secrets.oublier(cle);
    }
    journal.action("Deconnecte de Cloudflare.");
    return etat();
}

// --- Ce que l'identification permet de voir -----------------------------------
async function resume() {
    const jeton = bearer();
    if (!jeton) return { ok: false, message: "Pas encore connecte a Cloudflare." };

    const [compte, z] = await Promise.all([api.resoudreCompte(jeton), api.zones(jeton)]);

    return {
        ok: true,
        source: etat(),
        compte: compte.ok ? compte.compte : null,
        compteOrigine: compte.ok ? compte.origine : null,
        compteMessage: compte.ok ? null : compte.message,
        zones: z.ok ? z.liste : [],
        message: z.ok ? null : z.message
    };
}

module.exports = { etat, bearer, connecterParOAuth, connecterParJeton, deconnecter, resume, SCOPES };
