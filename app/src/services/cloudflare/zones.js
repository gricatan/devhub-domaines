// Zones et enregistrements DNS chez Cloudflare.
//
// Toutes ces fonctions recoivent un jeton porteur, sans savoir d'ou il vient.

const api = require("./api");
const journal = require("../../coeur/journal");

async function creer(jeton, nom, compteId) {
    journal.action(`Creation de la zone ${nom}...`);

    const r = await api.appel("/zones", jeton, {
        method: "POST",
        body: JSON.stringify({ name: nom, account: { id: compteId }, type: "full" })
    });

    if (!r.success) {
        const message = api.messageErreur(r);
        journal.erreur(`Creation de ${nom} refusee : ${message}`);
        return { ok: false, message };
    }

    const zone = {
        id: r.result.id,
        nom: r.result.name,
        statut: r.result.status,
        serveursDeNoms: r.result.name_servers || []
    };

    journal.succes(`Zone ${nom} creee.`, { serveursDeNoms: zone.serveursDeNoms });
    return { ok: true, zone };
}

async function supprimer(jeton, zoneId, nom) {
    journal.action(`Suppression de la zone ${nom || zoneId}...`);
    const r = await api.appel(`/zones/${zoneId}`, jeton, { method: "DELETE" });

    if (!r.success) {
        const message = api.messageErreur(r);
        journal.erreur(`Suppression refusee : ${message}`);
        return { ok: false, message };
    }

    journal.succes(`Zone ${nom || zoneId} supprimee.`);
    return { ok: true };
}

async function enregistrements(jeton, zoneId) {
    const r = await api.appel(`/zones/${zoneId}/dns_records?per_page=100`, jeton);
    if (!r.success) return { ok: false, message: api.messageErreur(r) };

    return {
        ok: true,
        liste: (r.result || []).map((e) => ({
            id: e.id,
            type: e.type,
            nom: e.name,
            contenu: e.content,
            proxie: Boolean(e.proxied),
            ttl: e.ttl
        }))
    };
}

// proxie = le trafic passe par Cloudflare (HTTPS gratuit, IP d'origine masquee).
// Ne vaut que pour HTTP et HTTPS : pour du SSH, un serveur de jeu ou tout autre
// protocole, il faut laisser passer en direct.
const TYPES_PROXIABLES = new Set(["A", "AAAA", "CNAME"]);

async function ajouterEnregistrement(jeton, zoneId, champ) {
    const type = String(champ.type || "A").toUpperCase();
    const proxie = Boolean(champ.proxie) && TYPES_PROXIABLES.has(type);

    journal.action(`Ajout d'un enregistrement ${type} ${champ.nom}...`);

    const r = await api.appel(`/zones/${zoneId}/dns_records`, jeton, {
        method: "POST",
        body: JSON.stringify({
            type,
            name: champ.nom || "@",
            content: champ.contenu,
            ttl: 1, // 1 = automatique
            proxied: proxie,
            comment: "DevHub Domaines"
        })
    });

    if (!r.success) {
        const message = api.messageErreur(r);
        journal.erreur(`Enregistrement refuse : ${message}`);
        return { ok: false, message };
    }

    journal.succes(`${type} ${r.result.name} -> ${r.result.content}${proxie ? " (proxie)" : ""}`);
    return { ok: true, enregistrement: { id: r.result.id, type, nom: r.result.name, contenu: r.result.content } };
}

async function supprimerEnregistrement(jeton, zoneId, id) {
    const r = await api.appel(`/zones/${zoneId}/dns_records/${id}`, jeton, { method: "DELETE" });
    if (!r.success) return { ok: false, message: api.messageErreur(r) };
    journal.action("Enregistrement supprime.");
    return { ok: true };
}

module.exports = {
    creer,
    supprimer,
    enregistrements,
    ajouterEnregistrement,
    supprimerEnregistrement,
    TYPES_PROXIABLES
};
