// Le binaire cloudflared : le telecharger, le verifier, le faire tourner.
//
// On installe un programme qui tournera en permanence chez l'utilisateur : il
// faut donc etre sur de ce qu'on execute. Cloudflare ne publie pas de fichier de
// sommes de controle avec ses versions, mais il SIGNE ses binaires. On verifie
// donc la signature Authenticode, ce qui vaut mieux qu'une somme : elle prouve
// l'editeur, pas seulement l'integrite du telechargement.
//
// Trois controles avant d'executer quoi que ce soit :
//   1. la taille correspond a celle annoncee par l'API GitHub officielle
//   2. le fichier commence par la signature d'un executable Windows (MZ)
//   3. la signature Authenticode est valide ET emise par Cloudflare
//
// Si l'un echoue, le fichier est supprime et rien n'est lance.

const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");

const journal = require("../coeur/journal");

const DEPOT = "https://api.github.com/repos/cloudflare/cloudflared/releases/latest";
const ACTIF = process.arch === "ia32" ? "cloudflared-windows-386.exe" : "cloudflared-windows-amd64.exe";

let processus = null;

function dossier() {
    const d = path.join(app.getPath("userData"), "outils");
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return d;
}

function chemin() {
    return path.join(dossier(), "cloudflared.exe");
}

function estInstalle() {
    return fs.existsSync(chemin());
}

// --- Verifications ------------------------------------------------------------
function commenceParMZ(fichier) {
    const tampon = Buffer.alloc(2);
    const fd = fs.openSync(fichier, "r");
    try {
        fs.readSync(fd, tampon, 0, 2, 0);
    } finally {
        fs.closeSync(fd);
    }
    return tampon.toString("latin1") === "MZ";
}

// Get-AuthenticodeSignature est fourni par Windows : pas de dependance a ajouter.
function verifierSignature(fichier) {
    return new Promise((resoudre) => {
        execFile(
            "powershell.exe",
            [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                `$s = Get-AuthenticodeSignature -LiteralPath '${fichier.replace(/'/g, "''")}';` +
                    `Write-Output ($s.Status.ToString() + '|' + $s.SignerCertificate.Subject)`
            ],
            { timeout: 30000, windowsHide: true },
            (erreur, sortie) => {
                if (erreur) return resoudre({ ok: false, raison: "vérification impossible" });
                const [statut, sujet = ""] = String(sortie).trim().split("|");
                const deCloudflare = /cloudflare/i.test(sujet);
                resoudre({
                    ok: statut === "Valid" && deCloudflare,
                    statut,
                    signataire: sujet.trim() || "inconnu",
                    raison:
                        statut !== "Valid"
                            ? `signature ${statut}`
                            : !deCloudflare
                              ? `signée par ${sujet}, pas par Cloudflare`
                              : null
                });
            }
        );
    });
}

// --- Installation -------------------------------------------------------------
async function installer(surProgression) {
    if (estInstalle()) {
        return { ok: true, deja: true, chemin: chemin() };
    }

    journal.action("Recherche de la derniere version de cloudflared...");
    const rel = await fetch(DEPOT, { headers: { Accept: "application/vnd.github+json" } });
    if (!rel.ok) return { ok: false, message: "Impossible de joindre les versions officielles." };

    const infos = await rel.json();
    const asset = (infos.assets || []).find((a) => a.name === ACTIF);
    if (!asset) return { ok: false, message: `Aucun binaire ${ACTIF} dans la version ${infos.tag_name}.` };

    journal.info(`Telechargement de cloudflared ${infos.tag_name} (${Math.round(asset.size / 1048576)} Mo)...`);

    const reponse = await fetch(asset.browser_download_url);
    if (!reponse.ok) return { ok: false, message: `Téléchargement refusé (${reponse.status}).` };

    const provisoire = chemin() + ".part";
    const flux = fs.createWriteStream(provisoire);
    let recu = 0;

    for await (const morceau of reponse.body) {
        flux.write(Buffer.from(morceau));
        recu += morceau.length;
        surProgression?.(Math.round((recu / asset.size) * 100));
    }
    await new Promise((r) => flux.end(r));

    // 1. la taille
    if (recu !== asset.size) {
        fs.unlinkSync(provisoire);
        return { ok: false, message: `Téléchargement incomplet (${recu} au lieu de ${asset.size} octets).` };
    }

    // 2. un vrai executable Windows
    if (!commenceParMZ(provisoire)) {
        fs.unlinkSync(provisoire);
        return { ok: false, message: "Le fichier téléchargé n'est pas un exécutable Windows." };
    }

    // 3. la signature de l'editeur
    const sig = await verifierSignature(provisoire);
    if (!sig.ok) {
        fs.unlinkSync(provisoire);
        journal.erreur(`cloudflared refuse : ${sig.raison}`);
        return { ok: false, message: `Signature refusée : ${sig.raison}. Rien n'a été installé.` };
    }

    fs.renameSync(provisoire, chemin());
    journal.succes(`cloudflared ${infos.tag_name} installe et signature verifiee.`, {
        signataire: sig.signataire.slice(0, 80)
    });

    return { ok: true, chemin: chemin(), version: infos.tag_name, signataire: sig.signataire };
}

// --- Execution ----------------------------------------------------------------
function enMarche() {
    return Boolean(processus && !processus.killed);
}

// Le jeton est un secret : il est passe en argument au processus enfant et
// n'apparait jamais dans le journal.
function demarrer(jetonConnexion) {
    if (enMarche()) return { ok: true, deja: true };
    if (!estInstalle()) return { ok: false, message: "cloudflared n'est pas installé." };

    processus = spawn(chemin(), ["tunnel", "--no-autoupdate", "run", "--token", jetonConnexion], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
    });

    const lire = (donnees) => {
        for (const ligne of String(donnees).split(/\r?\n/)) {
            const nette = ligne.trim();
            if (!nette) continue;
            // cloudflared ecrit tout sur la sortie d'erreur, y compris ses
            // messages normaux : on ne classe donc pas par flux mais par contenu.
            if (/ERR|error|failed/i.test(nette)) journal.erreur(`cloudflared : ${nette.slice(0, 200)}`);
            else if (/Registered tunnel connection|Connection .* registered/i.test(nette)) {
                journal.succes("Tunnel connecté à Cloudflare.");
            }
        }
    };

    processus.stdout.on("data", lire);
    processus.stderr.on("data", lire);

    processus.on("exit", (code) => {
        journal[code === 0 ? "info" : "avertissement"](`cloudflared s'est arrete (code ${code}).`);
        processus = null;
    });

    journal.action("cloudflared demarre.");
    return { ok: true };
}

function arreter() {
    if (!enMarche()) return { ok: true, deja: true };
    processus.kill();
    processus = null;
    journal.action("cloudflared arrete.");
    return { ok: true };
}

module.exports = { installer, estInstalle, chemin, demarrer, arreter, enMarche, verifierSignature };
