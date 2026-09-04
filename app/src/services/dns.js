// Verifications DNS faites par l'application elle-meme.
//
// L'application ne se contente pas de croire Cloudflare sur parole : elle
// interroge reellement les serveurs de noms. C'est ce qui permet de dire a
// l'utilisateur "ta zone repond" plutot que "la creation a renvoye 200", et
// c'est exactement le controle qu'exige eu.org avant d'accepter une demande.

const dns = require("node:dns");
const { Resolver } = require("node:dns/promises");

const DELAI = 4000;
const ESSAIS = 1;

function resolveur(serveurs) {
    const r = new Resolver({ timeout: DELAI, tries: ESSAIS });
    if (serveurs?.length) r.setServers(serveurs);
    return r;
}

// Un resolveur public sert de reference neutre pour savoir ce que voit le reste
// du monde, independamment de la configuration de la machine.
const PUBLICS = ["1.1.1.1", "8.8.8.8"];

// --- Le nom est-il deja pris ? ------------------------------------------------
// NXDOMAIN veut dire que rien n'existe : le nom est probablement libre. Toute
// autre reponse signifie qu'il est deja utilise quelque part.
async function estLibre(nom) {
    const r = resolveur(PUBLICS);
    try {
        const adresses = await r.resolve4(nom);
        return { libre: false, raison: `pointe deja vers ${adresses.join(", ")}` };
    } catch (e) {
        if (e.code === "ENOTFOUND" || e.code === "ENODATA") {
            // ENODATA : le nom existe mais n'a pas d'adresse. On verifie les NS.
            try {
                const ns = await r.resolveNs(nom);
                return { libre: false, raison: `delegue a ${ns.join(", ")}` };
            } catch {
                return { libre: true, raison: "aucune trace dans le DNS public" };
            }
        }
        return { libre: null, raison: `verification impossible (${e.code || e.message})` };
    }
}

// --- Cette machine sait-elle parler IPv6 ? -----------------------------------
// Question decisive pour la suite : sans connectivite IPv6, toutes les
// interrogations sur ces adresses echouent, et un rapport naif conclurait que
// les serveurs de noms sont defaillants alors qu'ils repondent parfaitement au
// reste du monde. On teste donc la machine avant d'accuser les serveurs.
const ERREURS_RESEAU = new Set(["ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "ETIMEOUT", "ECONNRESET"]);

let ipv6Connu = null;

async function ipv6Disponible() {
    if (ipv6Connu !== null) return ipv6Connu;
    const r = resolveur(["[2606:4700:4700::1111]:53"]); // Cloudflare, en IPv6
    try {
        await r.resolve4("one.one.one.one");
        ipv6Connu = true;
    } catch (e) {
        ipv6Connu = !ERREURS_RESEAU.has(e.code);
    }
    return ipv6Connu;
}

// --- Les adresses d'un serveur de noms ----------------------------------------
async function adressesDe(hote) {
    const r = resolveur(PUBLICS);
    const [v4, v6] = await Promise.all([
        r.resolve4(hote).catch(() => []),
        r.resolve6(hote).catch(() => [])
    ]);
    return [...v4, ...v6];
}

// --- La zone repond-elle vraiment ? -------------------------------------------
// On interroge chaque serveur de noms sur chacune de ses adresses, en IPv4 et en
// IPv6, pour SOA puis NS. Un serveur qui ne repond que sur une famille d'adresses
// est un probleme qu'on veut voir tout de suite.
async function verifierZone(nom, serveursDeNoms) {
    const debut = Date.now();
    const v6 = await ipv6Disponible();
    const controles = [];

    for (const hote of serveursDeNoms) {
        const adresses = await adressesDe(hote);

        if (!adresses.length) {
            controles.push({
                serveur: hote, adresse: null, testable: true,
                soa: false, ns: false, erreur: "aucune adresse"
            });
            continue;
        }

        for (const adresse of adresses) {
            const estV6 = adresse.includes(":");
            const controle = {
                serveur: hote,
                adresse,
                famille: estV6 ? "IPv6" : "IPv4",
                testable: estV6 ? v6 : true
            };

            // Interroger une adresse IPv6 sans route IPv6 ne prouverait rien.
            if (!controle.testable) {
                controle.soa = null;
                controle.ns = null;
                controle.erreur = "pas de connectivite IPv6 sur cette machine";
                controles.push(controle);
                continue;
            }

            const r = resolveur([estV6 ? `[${adresse}]:53` : adresse]);

            try {
                const soa = await r.resolveSoa(nom);
                controle.soa = true;
                controle.serie = soa.serial;
            } catch (e) {
                controle.soa = false;
                controle.erreur = e.code || e.message;
            }

            try {
                const ns = await r.resolveNs(nom);
                controle.ns = ns.length > 0;
            } catch {
                controle.ns = false;
            }

            controles.push(controle);
        }
    }

    // La conformite ne se juge que sur ce qui a pu etre teste.
    const testables = controles.filter((c) => c.testable);
    const reussis = testables.filter((c) => c.soa && c.ns).length;
    const ignores = controles.length - testables.length;
    const series = new Set(testables.filter((c) => c.soa).map((c) => c.serie));

    return {
        nom,
        controles,
        total: testables.length,
        reussis,
        ignores,
        ipv6Disponible: v6,
        // Une serie identique partout prouve que les serveurs sont d'accord entre
        // eux. Deux series differentes signalent une propagation en cours.
        coherent: series.size <= 1,
        series: [...series],
        conforme: testables.length > 0 && reussis === testables.length && series.size <= 1,
        dureeMs: Date.now() - debut
    };
}

// --- La delegation est-elle effective ? ---------------------------------------
// Repondre chez Cloudflare ne suffit pas : encore faut-il que le domaine parent
// pointe vers ces serveurs. C'est la derniere etape, celle qui echappe a
// l'application (registrar, ou validation manuelle pour eu.org).
async function delegationActive(nom, serveursAttendus) {
    const r = resolveur(PUBLICS);
    try {
        const ns = (await r.resolveNs(nom)).map((x) => x.toLowerCase());
        const attendus = serveursAttendus.map((x) => x.toLowerCase());
        const manquants = attendus.filter((x) => !ns.includes(x));
        return { deleguee: manquants.length === 0, observes: ns, manquants };
    } catch (e) {
        return { deleguee: false, observes: [], manquants: serveursAttendus, erreur: e.code || e.message };
    }
}

module.exports = { estLibre, verifierZone, delegationActive, adressesDe, ipv6Disponible };
