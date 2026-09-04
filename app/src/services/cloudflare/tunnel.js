// Le tunnel Cloudflare, entierement par API.
//
// Un tunnel rend un service qui tourne sur la machine accessible depuis
// Internet, SANS ouvrir le moindre port : cloudflared etablit une connexion
// sortante vers Cloudflare, qui lui renvoie le trafic. Rien a configurer sur la
// box, rien a changer dans un pare-feu.
//
// On ne passe pas par `cloudflared tunnel login`, qui ouvre un navigateur et
// depose un cert.pem : l'API renvoie directement un jeton de connexion, et
// `cloudflared tunnel run --token` suffit. Tout reste donc automatisable.
//
// Trois choses a poser, dans cet ordre :
//   1. le tunnel (API)              -> on recupere son identifiant et son jeton
//   2. sa configuration (API)       -> quel nom d'hote vers quel service local
//   3. un CNAME vers <id>.cfargotunnel.com (API DNS, obligatoirement proxifie)
//
// Ce CNAME n'est resolu que pour les enregistrements du meme compte Cloudflare :
// c'est voulu, et c'est pourquoi un tunnel exige un domaine delegue a Cloudflare.

const api = require("./api");
const journal = require("../../coeur/journal");

// --- Creation -----------------------------------------------------------------
async function creer(jeton, compteId, nom) {
    journal.action(`Creation du tunnel "${nom}"...`);

    const r = await api.appel(`/accounts/${compteId}/cfd_tunnel`, jeton, {
        method: "POST",
        // config_src "cloudflare" : la configuration vit chez Cloudflare et se
        // pilote par API, plutot que dans un fichier local a maintenir.
        body: JSON.stringify({ name: nom, config_src: "cloudflare" })
    });

    if (!r.success) {
        const message = api.messageErreur(r);
        journal.erreur(`Creation du tunnel refusee : ${message}`);
        return { ok: false, message };
    }

    journal.succes(`Tunnel "${nom}" cree.`, { id: r.result.id });
    return {
        ok: true,
        tunnel: {
            id: r.result.id,
            nom: r.result.name,
            jetonConnexion: r.result.token, // secret : ne jamais journaliser
            cible: `${r.result.id}.cfargotunnel.com`
        }
    };
}

async function lister(jeton, compteId) {
    const r = await api.appel(`/accounts/${compteId}/cfd_tunnel?is_deleted=false`, jeton);
    if (!r.success) return { ok: false, message: api.messageErreur(r) };
    return {
        ok: true,
        liste: (r.result || []).map((t) => ({
            id: t.id,
            nom: t.name,
            statut: t.status,
            cible: `${t.id}.cfargotunnel.com`
        }))
    };
}

async function supprimer(jeton, compteId, tunnelId) {
    const r = await api.appel(`/accounts/${compteId}/cfd_tunnel/${tunnelId}`, jeton, { method: "DELETE" });
    if (!r.success) return { ok: false, message: api.messageErreur(r) };
    journal.action("Tunnel supprime.");
    return { ok: true };
}

// --- Configuration ------------------------------------------------------------
// L'ingress dit : "ce nom d'hote va vers ce service local". La derniere regle
// est obligatoire et sert de filet : tout le reste renvoie une erreur 404.
async function configurer(jeton, compteId, tunnelId, regles) {
    const ingress = regles.map((r) => ({
        hostname: r.hote,
        service: r.service,
        ...(r.chemin ? { path: r.chemin } : {})
    }));
    ingress.push({ service: "http_status:404" });

    journal.action(`Configuration du tunnel : ${regles.map((r) => `${r.hote} -> ${r.service}`).join(", ")}`);

    const r = await api.appel(`/accounts/${compteId}/cfd_tunnel/${tunnelId}/configurations`, jeton, {
        method: "PUT",
        body: JSON.stringify({ config: { ingress } })
    });

    if (!r.success) {
        const message = api.messageErreur(r);
        journal.erreur(`Configuration refusee : ${message}`);
        return { ok: false, message };
    }
    journal.succes("Tunnel configure.");
    return { ok: true };
}

// --- Routage DNS --------------------------------------------------------------
// Le CNAME doit etre proxifie : sans cela, Cloudflare ne route pas le trafic
// dans le tunnel et le visiteur reçoit une erreur.
async function router(jeton, zoneId, sousDomaine, cible) {
    const existants = await api.appel(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(sousDomaine)}`, jeton);
    const deja = existants.success ? existants.result || [] : [];

    // Un A ou un CNAME deja present sur ce nom empecherait le routage : on le
    // remplace, en le disant clairement dans le journal.
    for (const e of deja) {
        journal.avertissement(`Remplacement de l'enregistrement ${e.type} existant sur ${sousDomaine}.`);
        await api.appel(`/zones/${zoneId}/dns_records/${e.id}`, jeton, { method: "DELETE" });
    }

    const r = await api.appel(`/zones/${zoneId}/dns_records`, jeton, {
        method: "POST",
        body: JSON.stringify({
            type: "CNAME",
            name: sousDomaine,
            content: cible,
            ttl: 1,
            proxied: true, // indispensable : un CNAME non proxifie ne route rien
            comment: "DevHub Domaines - tunnel"
        })
    });

    if (!r.success) {
        const message = api.messageErreur(r);
        journal.erreur(`Routage DNS refuse : ${message}`);
        return { ok: false, message };
    }
    journal.succes(`${sousDomaine} routé vers le tunnel.`);
    return { ok: true, id: r.result.id };
}

// --- Etat ---------------------------------------------------------------------
async function etat(jeton, compteId, tunnelId) {
    const r = await api.appel(`/accounts/${compteId}/cfd_tunnel/${tunnelId}`, jeton);
    if (!r.success) return { ok: false, message: api.messageErreur(r) };
    return {
        ok: true,
        statut: r.result.status, // healthy, degraded, down, inactive
        connexions: (r.result.connections || []).length,
        actifDepuis: r.result.conns_active_at
    };
}

module.exports = { creer, lister, supprimer, configurer, router, etat };
