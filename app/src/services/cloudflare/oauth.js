// Le flux OAuth Authorization Code + PKCE de Cloudflare.
//
// Valide en conditions reelles le 3 septembre 2026 : Cloudflare accepte une
// redirection vers localhost, et delivre un jeton sans client secret.
//
// Le navigateur habituel de l'utilisateur est utilise, jamais une fenetre
// embarquee : c'est plus sur (il voit la vraie barre d'adresse et son
// gestionnaire de mots de passe fonctionne) et c'est ce que Cloudflare attend.

const http = require("node:http");
const crypto = require("node:crypto");
const { shell } = require("electron");

const AUTORISATION = "https://dash.cloudflare.com/oauth2/auth";
const JETON = "https://dash.cloudflare.com/oauth2/token";

// Le port est fixe : la redirection declaree sur le client OAuth doit
// correspondre au caractere pres.
const PORT = 8976;
const REDIRECTION = `http://localhost:${PORT}/callback`;

const DELAI_MS = 3 * 60 * 1000;

function base64url(tampon) {
    return tampon.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function page(titre, texte) {
    return (
        `<!doctype html><meta charset="utf-8"><title>${titre}</title>` +
        `<body style="font:15px system-ui;background:#14131b;color:#eae8f2;padding:56px;margin:0">` +
        `<h1 style="font-size:20px;margin:0 0 8px">${titre}</h1>` +
        `<p style="color:#a5a2b8;margin:0">${texte}</p></body>`
    );
}

// Lance le flux complet. Resout avec le jeton, ou rejette avec un message
// utilisable tel quel dans l'interface.
function autoriser({ clientId, scopes, journal }) {
    return new Promise((resoudre, rejeter) => {
        const codeVerifier = base64url(crypto.randomBytes(64));
        const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
        const etat = base64url(crypto.randomBytes(16));

        const url =
            AUTORISATION +
            "?" +
            new URLSearchParams({
                client_id: clientId,
                response_type: "code",
                redirect_uri: REDIRECTION,
                scope: scopes,
                state: etat,
                code_challenge: codeChallenge,
                code_challenge_method: "S256"
            }).toString();

        let termine = false;
        const serveur = http.createServer();

        const finir = (erreur, valeur) => {
            if (termine) return;
            termine = true;
            clearTimeout(minuterie);
            serveur.close();
            erreur ? rejeter(erreur) : resoudre(valeur);
        };

        const minuterie = setTimeout(
            () => finir(new Error("Aucune reponse apres trois minutes. Autorisation abandonnee.")),
            DELAI_MS
        );

        serveur.on("request", async (requete, reponse) => {
            const recu = new URL(requete.url, `http://localhost:${PORT}`);
            if (recu.pathname !== "/callback") {
                reponse.writeHead(404).end("rien ici");
                return;
            }

            const repondre = (titre, texte, code = 200) => {
                reponse.writeHead(code, { "Content-Type": "text/html; charset=utf-8" });
                reponse.end(page(titre, texte));
            };

            const erreur = recu.searchParams.get("error");
            if (erreur) {
                const description = recu.searchParams.get("error_description") || "";
                repondre("Autorisation refusee", `${erreur} ${description}`);
                finir(new Error(`${erreur} ${description}`.trim()));
                return;
            }

            if (recu.searchParams.get("state") !== etat) {
                repondre("Reponse invalide", "Elle ne correspond pas a la demande envoyee.", 400);
                finir(new Error("La reponse ne correspond pas a la demande (state invalide)."));
                return;
            }

            repondre("C'est bon", "Tu peux fermer cet onglet et revenir a l'application.");

            try {
                const echange = await fetch(JETON, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                        grant_type: "authorization_code",
                        code: recu.searchParams.get("code"),
                        redirect_uri: REDIRECTION,
                        client_id: clientId, // pas de secret : c'est tout l'interet de PKCE
                        code_verifier: codeVerifier
                    }).toString()
                });

                const corps = await echange.json().catch(() => ({}));
                if (!corps.access_token) {
                    const detail = corps.error_description || corps.error || `HTTP ${echange.status}`;
                    finir(new Error(`Echange du code refuse : ${detail}`));
                    return;
                }

                finir(null, {
                    jeton: corps.access_token,
                    rafraichissement: corps.refresh_token ?? null,
                    expireDans: corps.expires_in ?? null,
                    scopes: corps.scope ?? scopes
                });
            } catch (e) {
                finir(new Error(`Echange du code impossible : ${e.message}`));
            }
        });

        serveur.on("error", (e) => {
            finir(
                e.code === "EADDRINUSE"
                    ? new Error(`Le port ${PORT} est deja utilise. Ferme l'autre programme et reessaie.`)
                    : e
            );
        });

        serveur.listen(PORT, "127.0.0.1", () => {
            journal?.action("Ouverture du navigateur pour autoriser l'acces a Cloudflare.");
            shell.openExternal(url);
        });
    });
}

module.exports = { autoriser, REDIRECTION, PORT };
