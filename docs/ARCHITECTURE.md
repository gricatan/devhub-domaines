# Architecture et choix techniques

Ce document explique **pourquoi** l'application est faite ainsi, et ce qui a été
essayé puis écarté. L'installation et l'usage sont dans le [README](../README.md).

## Ce qui est automatisé, et ce qui ne peut pas l'être

| Étape | Comment | Geste humain |
|---|---|---|
| Connexion Cloudflare | jeton d'API, ou OAuth PKCE si un client est configuré | un copier-coller |
| Zone et enregistrements | API Cloudflare | aucun |
| Tunnel | API Cloudflare + `cloudflared --token` | aucun |
| Vérification DNS | requêtes directes aux serveurs de noms | aucun |
| Vérification d'une demande `.eu.org` | lecture silencieuse de leur interface | aucun |
| Demande `.eu.org` | *rien* — validation humaine bénévole | tout |

Le seul délai irréductible est la relecture d'une demande eu.org par un
bénévole. Tout le reste est immédiat.

## Pourquoi ces choix

**Cloudflare et rien d'autre comme moteur DNS.** C'est le seul qui donne le
tunnel, et le tunnel est ce que l'application apporte vraiment : un service qui
tourne sur la machine devient joignable depuis Internet, sans toucher à la box.

**eu.org comme registre gratuit.** Après examen, c'est le seul qui accepte des
enregistrements `NS` — donc le seul qu'on puisse déléguer à Cloudflare — sans
condition disqualifiante.

Les pistes écartées, avec la raison mesurée :

| Piste | Pourquoi non |
|---|---|
| **DuckDNS** | `A`/`AAAA`/`TXT` uniquement, pas de `NS`. Et `cfargotunnel.com` ne route que pour des enregistrements du même compte Cloudflare : le tunnel est donc impossible. |
| **is-a.dev** | Exige un site de développement logiciel **déjà en ligne**, avec déclarations sur l'honneur dans leur formulaire de demande. Exclut le simple nom de domaine, et exclut le gaming. |
| **DigitalPlat** | Clé par utilisateur, un domaine par compte, aucun point d'entrée pour les `NS`, et une protection anti-robot sur l'inscription. |
| **deSEC** | Excellent, mais héberge lui-même la zone : plus de délégation possible vers Cloudflare, donc plus de tunnel. Captcha à l'inscription. |
| **Freenom, Open Domains** | Morts ou archivés. |

**Le tunnel sans `cloudflared tunnel login`.** L'API renvoie directement un
jeton de connexion : ni navigateur à ouvrir, ni `cert.pem` à gérer.
`config_src: "cloudflare"` garde la configuration côté Cloudflare, pilotable par
API, plutôt que dans un fichier local à maintenir.

## La séparation qui tient tout

`insertCSS` peut styler et masquer une page. Il **ne peut pas** lire la valeur
d'un champ. `executeJavaScript`, lui, peut tout lire.

D'où la règle appliquée dans `euorg-formulaire.js` : sur une page de connexion,
**uniquement du CSS**. Le JavaScript n'entre en jeu que sur le formulaire de
demande, où il n'y a aucun mot de passe.

L'utilisateur obtient la refonte visuelle partout, et l'application reste
incapable de lire ses identifiants — pas par discipline, par construction.

## Les modules

| Fichier | Rôle |
|---|---|
| `main.js` | processus principal, IPC, instance unique |
| `preload.js` | le pont — l'interface n'a que ce qui y est exposé |
| `src/coeur/secrets.js` | coffre chiffré, garde-fou `app.isPackaged` |
| `src/coeur/journal.js` | journal, avec masquage des valeurs sensibles |
| `src/services/cloudflare/auth.js` | OAuth PKCE **ou** jeton d'API, même interface |
| `src/services/cloudflare/oauth.js` | flux PKCE, redirection sur localhost |
| `src/services/cloudflare/api.js` | appels, résolution du compte |
| `src/services/cloudflare/zones.js` | zones et enregistrements |
| `src/services/cloudflare/tunnel.js` | tunnels par API |
| `src/services/cloudflared.js` | binaire : téléchargement, vérification, exécution |
| `src/services/euorg.js` | liste des 54 domaines parents |
| `src/services/euorg-formulaire.js` | fenêtre guidée, pré-remplissage, vérification |
| `src/services/habillage.js` | CSS appliqué aux pages eu.org |
| `src/services/dns.js` | vérifications DNS réelles |
| `ui/index.html` | l'assistant |

## Détails qui ont coûté cher à trouver

**La résolution du compte Cloudflare.** Un jeton restreint aux zones renvoie une
liste de comptes **vide**, ce qui bloque la création de zone. `resoudreCompte()`
lit donc d'abord le compte porté par une zone existante — gratuit, sans
autorisation supplémentaire — et ne retombe sur `/accounts` qu'en dernier
recours.

**L'IPv6 absent fausse la vérification DNS.** Sur une machine sans route IPv6,
toutes les requêtes AAAA échouent en `ECONNREFUSED` et le domaine paraît non
conforme. `ipv6Disponible()` teste la pile avant, et les vérifications non
testables sont **exclues du verdict** au lieu d'être comptées comme des échecs.

**Le CNAME du tunnel doit être `proxied: true`.** Sans cela, `cfargotunnel.com`
ne route rien.

**Les escapes traversent trois couches.** Le code injecté dans une page passe par
un *template literal* JavaScript, où `\d` est réduit à `d`. Dans une expression
régulière injectée, préférer `[0-9]` : la classe explicite ne dépend d'aucun
niveau d'échappement.

**eu.org n'a ni API ni whois joignable** (port 43 en timeout). La seule source
est leur interface. `/arf/fr/` est à la fois le menu et la liste des domaines ;
le handle du compte connecté (forme `AB1234-FREE`) s'y lit, et il compte :
plusieurs comptes eu.org peuvent coexister, et un domaine demandé sous l'un est
invisible sous l'autre.
