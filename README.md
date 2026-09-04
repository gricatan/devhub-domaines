# DevHub Domaines

Obtenir un nom de domaine gratuit, le faire pointer où tu veux, et rendre
joignable depuis Internet un service qui tourne sur ta machine — sans ouvrir un
port sur ta box, sans IP fixe, et sans comprendre le DNS.

Un assistant, une question par écran.

```
① Domaine → ② Compte → ③ Nom → ④ Destination → ⑤ Vérification → ⑥ Terminé
```

Ce n'est pas un tableau de bord de plus : l'application **fait** le travail par
API. Elle ne te demande un geste que là où aucune API n'existe, et elle le dit.

---

## Ce dont tu as besoin

| | |
|---|---|
| **Windows** | 10 ou 11. Voir [Autres systèmes](#autres-systèmes) plus bas. |
| **Node.js** | 18 ou plus récent — [nodejs.org](https://nodejs.org) |
| **Un compte Cloudflare** | gratuit, [dash.cloudflare.com](https://dash.cloudflare.com) |

Tu n'as **pas** besoin d'acheter un domaine, ni d'un serveur, ni d'une IP fixe.

L'application travaille sur **ton** compte Cloudflare. Rien ne transite par le
compte de quelqu'un d'autre.

---

## Installation

```bash
git clone https://github.com/<compte>/devhub-domaines.git
cd devhub-domaines/app
npm install
npm start
```

`npm install` télécharge Electron (~100 Mo) : compte une minute ou deux la
première fois.

---

## Connecter ton compte Cloudflare

L'application a besoin d'un **jeton d'API**. C'est une clé que tu crées
toi-même, que tu peux révoquer quand tu veux, et qui ne donne accès qu'à ce que
tu coches.

1. Va sur **[dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)**
2. **Créer un jeton** → **Créer un jeton personnalisé**
3. Coche ces autorisations :

   | Groupe | Autorisation | Niveau |
   |---|---|---|
   | Compte | Cloudflare Tunnel | Modifier |
   | Compte | Paramètres du compte | Lire |
   | Zone | Zone | Modifier |
   | Zone | DNS | Modifier |

4. Dans **Ressources de zone**, choisis **Toutes les zones** du compte.
   C'est nécessaire pour que l'application puisse **créer** une nouvelle zone :
   un jeton limité à une zone existante ne le permet pas.
5. Crée le jeton, copie-le.
6. Dans l'application, étape **Compte**, colle-le et clique **Utiliser**.

Le jeton part directement dans le **coffre chiffré de Windows** (DPAPI). Il
n'est écrit dans aucun fichier en clair, et l'interface ne le relit jamais.

> **Pourquoi « Paramètres du compte : Lire » ?** Uniquement pour retrouver ton
> identifiant de compte quand tu n'as encore aucune zone. Dès qu'une zone
> existe, elle porte l'information et cette autorisation ne sert plus.

---

## Choisir un nom de domaine

Deux voies, selon ce que tu as déjà.

### Tu possèdes déjà un domaine

Ajoute-le à Cloudflare depuis l'application, puis va indiquer chez ton
registrar les deux serveurs de noms qu'elle t'affiche. L'écran **Vérification**
interroge ensuite les serveurs pour de vrai et te dit si la délégation est
active.

### Tu n'en as pas : `.eu.org`, gratuit et à vie

[eu.org](https://nic.eu.org) donne gratuitement des sous-domaines de la forme
`tonnom.fr.eu.org` — 54 domaines parents disponibles, listés dans
l'application.

**Ce qu'il faut savoir avant de s'engager :**

- eu.org **n'a aucune API**. La demande passe par leur formulaire, et un
  bénévole la relit à la main. Compte de **quelques jours à plusieurs
  semaines**.
- Ils exigent que la zone **réponde déjà** avant d'accepter la demande.
  L'application crée donc la zone Cloudflare **d'abord**, puis remplit le
  formulaire — dans cet ordre, sinon la demande est rejetée.
- Une fenêtre s'ouvre sur leur site, remise aux couleurs de l'application, avec
  le nom de domaine et les serveurs de noms **déjà remplis**. Tu relis, et
  **c'est toi qui envoies**.

**Sur ton mot de passe eu.org.** Tant que la page affichée est une page de
connexion, l'application n'y injecte **que du CSS**. `insertCSS` peut styler et
masquer ; il ne peut pas lire la valeur d'un champ. Ce n'est pas une promesse de
bonne conduite, c'est une propriété de l'outil employé. Le JavaScript n'entre en
jeu que sur le formulaire de demande, où il n'y a aucun mot de passe.

L'écran d'accueil va ensuite vérifier tout seul, **sans rien afficher**, si ta
demande figure bien chez eux — et te le dit.

---

## Rendre un service joignable (le tunnel)

C'est ce que l'application apporte vraiment.

Tu indiques ce qui tourne chez toi — `http://localhost:3000`, un serveur
Minecraft, n'importe quoi — et elle monte un **tunnel Cloudflare** :

- création du tunnel par API, sans `cloudflared tunnel login` ni `cert.pem` ;
- enregistrement DNS posé automatiquement ;
- `cloudflared` téléchargé, **vérifié**, puis lancé.

Ta machine ouvre une connexion **sortante** vers Cloudflare. Aucun port entrant,
rien à toucher sur la box, et ton IP réelle n'est pas exposée.

Tu n'es obligé d'ouvrir aucun site web : un nom de domaine seul, ou pointé vers
une IP, est une fin parfaitement légitime.

---

## Tout retirer

Le bouton **Retirer** sur chaque domaine démonte ce qui a été monté :
arrêt de `cloudflared`, suppression du tunnel, effacement de son jeton dans le
coffre, suppression de la zone et de ses enregistrements. Chaque étape est
rapportée séparément — une suppression à moitié faite doit se voir.

L'application ne supprime **que les tunnels qu'elle a créés** (nommés
`devhub-<zone>`). Un tunnel que tu as monté à la main ne lui appartient pas.

Pour eu.org, elle ouvre leur espace et te dit quoi y chercher : là non plus il
n'y a pas d'API, et elle ne clique pas à ta place.

---

## Sécurité

- **Les secrets vivent dans `safeStorage`** (DPAPI sous Windows) : la clé dérive
  de ta session Windows, un fichier recopié ailleurs ne donne rien.
- **L'interface ne reçoit jamais un secret.** Elle connaît les noms des clés,
  leur origine et leur longueur. Rien d'autre ne traverse le pont.
- **Le journal masque** toute valeur sensible.
- **`.env.local` n'est lu qu'en développement**, garanti par `app.isPackaged` :
  une application packagée ne cherche même pas le fichier.
- **`cloudflared` est vérifié avant d'être exécuté** : taille annoncée par
  l'API GitHub officielle, entête `MZ`, et **signature Authenticode valide
  émise par Cloudflare, Inc.** Un seul échec et le fichier est supprimé sans
  avoir été lancé.
- **Le tunnel s'arrête avec l'application.** Rien ne continue dans ton dos.

---

## Limites connues

**Autres systèmes.** L'application est aujourd'hui **Windows seulement** : le
téléchargement de `cloudflared` vise les binaires Windows, et la vérification de
signature passe par PowerShell. Le reste du code n'a rien de spécifique — un
portage macOS/Linux demande d'adapter `src/services/cloudflared.js`. Les
contributions sont bienvenues.

**Le délai eu.org est irréductible.** Il dépend de bénévoles. Aucune
optimisation ne le raccourcira.

**Vérification eu.org : un seul compte à la fois.** L'application lit la liste
du compte eu.org auquel tu es connecté. Un domaine demandé sous un autre
identifiant n'y figure pas — elle le dit plutôt que de conclure à tort.

**Pas encore éprouvé :** un tunnel servant du trafic réel sur la durée. Le cycle
API (création, configuration, suppression) est validé ; un service derrière et
un domaine délégué, pas encore.

---

## Développement

L'architecture, les choix techniques et les pistes écartées avec leurs raisons
sont dans **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

Pour éviter de ressaisir ton jeton à chaque lancement, copie
`.env.local.exemple` en `.env.local` à la racine du dépôt. Ce fichier est
ignoré par git et n'est lu qu'en développement.

```bash
cd app
npm start
```

Les erreurs de l'interface remontent dans le journal de l'application : pas
besoin d'ouvrir les devtools pour comprendre un écran muet.
