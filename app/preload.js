// Le pont entre l'interface et le processus principal.
//
// L'interface n'a acces qu'a ces quelques fonctions : ni fs, ni require, ni
// acces direct aux secrets. Et aucune de ces fonctions ne renvoie la valeur
// d'un secret - seulement le fait qu'il existe.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("app", {
    etatInitial: () => ipcRenderer.invoke("etat-initial"),

    secrets: {
        etat: () => ipcRenderer.invoke("secrets:etat"),
        ecrire: (cle, valeur) => ipcRenderer.invoke("secrets:ecrire", { cle, valeur }),
        oublier: (cle) => ipcRenderer.invoke("secrets:oublier", cle)
    },

    cloudflare: {
        etat: () => ipcRenderer.invoke("cf:etat"),
        connecterOAuth: () => ipcRenderer.invoke("cf:oauth"),
        connecterJeton: (valeur) => ipcRenderer.invoke("cf:jeton", valeur),
        deconnecter: () => ipcRenderer.invoke("cf:deconnecter"),
        resume: () => ipcRenderer.invoke("cf:resume")
    },

    domaine: {
        estLibre: (nom) => ipcRenderer.invoke("dns:libre", nom),
        creerZone: (nom) => ipcRenderer.invoke("zone:creer", nom),
        supprimerZone: (id, nom) => ipcRenderer.invoke("zone:supprimer", { id, nom }),
        enregistrements: (zoneId) => ipcRenderer.invoke("zone:enregistrements", zoneId),
        ajouter: (zoneId, champ) => ipcRenderer.invoke("zone:ajouter", { zoneId, champ }),
        retirer: (zoneId, id) => ipcRenderer.invoke("zone:retirer", { zoneId, id }),
        verifier: (nom, serveurs) => ipcRenderer.invoke("dns:verifier", { nom, serveurs })
    },

    euorg: {
        parents: () => ipcRenderer.invoke("euorg:parents"),
        formulaire: (domaine, serveurs) => ipcRenderer.invoke("euorg:formulaire", { domaine, serveurs }),
        verifier: (domaine) => ipcRenderer.invoke("euorg:verifier", domaine),
        espace: (domaine) => ipcRenderer.invoke("euorg:espace", domaine)
    },




    accueil: () => ipcRenderer.invoke("vue:accueil"),

    demanteler: (zoneId, zoneNom) => ipcRenderer.invoke("domaine:demanteler", { zoneId, zoneNom }),

    tunnel: {
        etat: () => ipcRenderer.invoke("tunnel:etat"),
        relancer: (zoneNom) => ipcRenderer.invoke("tunnel:relancer", zoneNom),
        monter: (zoneId, zoneNom, hote, service) =>
            ipcRenderer.invoke("tunnel:monter", { zoneId, zoneNom, hote, service }),
        sante: (tunnelId) => ipcRenderer.invoke("tunnel:sante", { tunnelId }),
        arreter: () => ipcRenderer.invoke("tunnel:arreter"),
        surProgression: (rappel) => ipcRenderer.on("tunnel:progression", (_e, p) => rappel(p))
    },

    ouvrirLien: (url) => ipcRenderer.invoke("ouvrir-lien", url),

    surJournal: (rappel) => {
        ipcRenderer.on("journal", (_e, ligne) => rappel(ligne));
    }
});
