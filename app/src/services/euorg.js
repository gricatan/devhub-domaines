// La liste des domaines parents ouverts chez eu.org.
//
// Elle est publiee sur leur site et evolue : on la recupere plutot que de la
// figer dans le code. Une liste de secours embarquee permet a l'application de
// fonctionner hors ligne ou si leur site change de forme.

const journal = require("../coeur/journal");

const SOURCE = "https://nic.eu.org/opendomains.html";

// Pour que l'utilisateur choisisse dans sa langue plutot que dans des codes.
const LIBELLES = {
    "eu.org": "Directement sous eu.org — déconseillé, souvent refusé",
    "asso.eu.org": "Associations",
    "edu.eu.org": "Enseignement",
    "int.eu.org": "International",
    "net.eu.org": "Réseaux",
    "org.eu.org": "Organisations",
    "al.eu.org": "Albanie", "at.eu.org": "Autriche", "au.eu.org": "Australie",
    "be.eu.org": "Belgique", "bg.eu.org": "Bulgarie", "ca.eu.org": "Canada",
    "cd.eu.org": "Congo", "ch.eu.org": "Suisse", "cn.eu.org": "Chine",
    "cy.eu.org": "Chypre", "cz.eu.org": "Tchéquie", "de.eu.org": "Allemagne",
    "dk.eu.org": "Danemark", "ee.eu.org": "Estonie", "es.eu.org": "Espagne",
    "fi.eu.org": "Finlande", "fr.eu.org": "France", "gr.eu.org": "Grèce",
    "hr.eu.org": "Croatie", "hu.eu.org": "Hongrie", "ie.eu.org": "Irlande",
    "il.eu.org": "Israël", "in.eu.org": "Inde", "is.eu.org": "Islande",
    "it.eu.org": "Italie", "jp.eu.org": "Japon", "kr.eu.org": "Corée du Sud",
    "lt.eu.org": "Lituanie", "lu.eu.org": "Luxembourg", "lv.eu.org": "Lettonie",
    "me.eu.org": "Monténégro", "mk.eu.org": "Macédoine du Nord", "mt.eu.org": "Malte",
    "my.eu.org": "Malaisie", "ng.eu.org": "Nigéria", "nl.eu.org": "Pays-Bas",
    "no.eu.org": "Norvège", "nz.eu.org": "Nouvelle-Zélande", "pl.eu.org": "Pologne",
    "pt.eu.org": "Portugal", "ro.eu.org": "Roumanie", "ru.eu.org": "Russie",
    "se.eu.org": "Suède", "si.eu.org": "Slovénie", "sk.eu.org": "Slovaquie",
    "tr.eu.org": "Turquie", "uk.eu.org": "Royaume-Uni", "us.eu.org": "États-Unis"
};

const SECOURS = [
    "fr.eu.org", "be.eu.org", "ch.eu.org", "ca.eu.org", "asso.eu.org",
    "edu.eu.org", "int.eu.org", "net.eu.org", "org.eu.org", "eu.org"
];

let cache = null;

function habiller(nom) {
    return {
        valeur: nom,
        libelle: LIBELLES[nom] ? `${nom} — ${LIBELLES[nom]}` : nom,
        deconseille: nom === "eu.org"
    };
}

// Le tri place la France en tete, puis les autres pays, puis les categories, et
// laisse eu.org tout en bas : c'est l'ordre dans lequel un francophone choisit,
// et le dernier est celui qu'on veut le moins voir choisi.
function ordonner(noms) {
    const rang = (n) => (n === "fr.eu.org" ? 0 : n === "eu.org" ? 3 : LIBELLES[n] ? 1 : 2);
    return [...new Set(noms)].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b));
}

async function parents() {
    if (cache) return cache;

    try {
        const reponse = await fetch(SOURCE, { signal: AbortSignal.timeout(8000) });
        const html = await reponse.text();

        const trouves = [...html.matchAll(/\b([a-z0-9-]+\.eu\.org)\b/gi)].map((m) => m[1].toLowerCase());
        if (trouves.length < 10) throw new Error("liste inattendue");

        // eu.org lui-meme n'apparait pas dans la page : on l'ajoute a la main,
        // puisqu'il reste possible, quoique deconseille.
        cache = ordonner([...trouves, "eu.org"]).map(habiller);
        journal.info(`Liste eu.org recuperee : ${cache.length} domaines parents.`);
        return cache;
    } catch (e) {
        journal.avertissement(`Liste eu.org indisponible (${e.message}), utilisation de la liste de secours.`);
        return ordonner(SECOURS).map(habiller);
    }
}

module.exports = { parents };
