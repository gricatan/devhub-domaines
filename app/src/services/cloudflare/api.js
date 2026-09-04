// Appels a l'API Cloudflare.
//
// Ce module ne sait pas d'ou vient le jeton : il le recoit. C'est ce qui permet
// aux deux chemins d'identification (OAuth ou jeton d'API) de partager
// exactement le meme code metier.

const BASE = "https://api.cloudflare.com/client/v4";

async function appel(chemin, jeton, options = {}) {
    const reponse = await fetch(BASE + chemin, {
        ...options,
        headers: {
            Authorization: `Bearer ${jeton}`,
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    let corps;
    try {
        corps = await reponse.json();
    } catch {
        corps = { success: false, errors: [{ message: `reponse illisible (HTTP ${reponse.status})` }] };
    }

    return { http: reponse.status, ...corps };
}

function messageErreur(r) {
    if (r?.errors?.length) {
        return r.errors.map((e) => [e.code, e.message].filter(Boolean).join(" ")).join(" | ");
    }
    return `HTTP ${r?.http ?? "?"}`;
}

// Verifie qu'un jeton est utilisable. Fonctionne pour un jeton d'API ; pour un
// jeton OAuth, cet appel n'est pas disponible, on retombe sur la lecture des
// zones, qui prouve la meme chose.
async function verifier(jeton) {
    const r = await appel("/user/tokens/verify", jeton);
    if (r.success) return { ok: true, statut: r.result?.status ?? "actif" };

    const zones = await appel("/zones?per_page=1", jeton);
    if (zones.success) return { ok: true, statut: "actif (verifie par lecture des zones)" };

    return { ok: false, message: messageErreur(r) };
}

async function comptes(jeton) {
    const r = await appel("/accounts", jeton);
    return r.success
        ? { ok: true, liste: (r.result || []).map((c) => ({ id: c.id, nom: c.name })) }
        : { ok: false, message: messageErreur(r) };
}

async function zones(jeton) {
    const r = await appel("/zones?per_page=50", jeton);
    return r.success
        ? {
              ok: true,
              liste: (r.result || []).map((z) => ({
                  id: z.id,
                  nom: z.name,
                  statut: z.status,
                  serveursDeNoms: z.name_servers || [],
                  // Chaque zone porte son compte : c'est notre meilleure source
                  // d'identifiant, et elle ne coute aucune permission.
                  compte: z.account ? { id: z.account.id, nom: z.account.name } : null
              }))
          }
        : { ok: false, message: messageErreur(r) };
}

// Trouver l'identifiant de compte, indispensable pour creer une zone.
//
// Un acces limite aux zones ne voit rien dans /accounts. Plutot que d'exiger une
// permission de plus a tout le monde, on regarde d'abord les zones existantes,
// qui portent deja l'information. /accounts ne sert que si l'utilisateur n'a
// aucune zone - le cas d'un compte tout neuf.
async function resoudreCompte(jeton) {
    const z = await zones(jeton);
    if (z.ok) {
        const avecCompte = z.liste.find((x) => x.compte?.id);
        if (avecCompte) {
            return { ok: true, compte: avecCompte.compte, origine: "zone existante" };
        }
    }

    const c = await comptes(jeton);
    if (c.ok && c.liste.length) {
        return { ok: true, compte: c.liste[0], origine: "liste des comptes" };
    }

    return {
        ok: false,
        message:
            "Impossible de determiner le compte : aucune zone existante, et la liste des comptes n'est pas accessible."
    };
}

module.exports = { appel, verifier, comptes, zones, resoudreCompte, messageErreur };
