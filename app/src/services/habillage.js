// Habiller les pages d'eu.org aux couleurs de l'application.
//
// Leur interface est un Django de 2005 : elle fonctionne, mais elle intimide.
// On la reprend visuellement pour que la connexion et le formulaire ressemblent
// au reste de l'application.
//
// LA DISTINCTION QUI COMPTE, et qui rend la promesse verifiable :
//
//   insertCSS          ne peut que styler et masquer. Il ne peut PAS lire la
//                      valeur d'un champ. Un mot de passe tape lui est
//                      inaccessible par construction.
//   executeJavaScript  peut tout lire.
//
// D'ou la regle appliquee dans euorg-formulaire.js : sur les pages de connexion,
// **uniquement du CSS**. Le JavaScript n'entre en jeu que sur le formulaire de
// demande, ou il n'y a aucun mot de passe.
//
// L'utilisateur obtient donc la refonte visuelle partout, et l'application reste
// incapable de lire ses identifiants - pas par discipline, par construction.

const STYLE = `
  :root {
    --dh-fond:#15141c; --dh-carte:#1e1d28; --dh-creux:#272631; --dh-trait:#332f40;
    --dh-texte:#efedf6; --dh-doux:#a9a6bd; --dh-faible:#726f88; --dh-accent:#4fb3a5;
  }

  html, body {
    background: var(--dh-fond) !important;
    color: var(--dh-texte) !important;
    font-family: "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif !important;
    font-size: 15px !important;
    line-height: 1.6 !important;
  }

  /* La navigation d'origine n'aide pas ici : on la reduit sans la supprimer. */
  nav.main { opacity: .35 !important; font-size: 12px !important; padding: 8px 0 !important; }
  nav.main:hover { opacity: 1 !important; }

  a { color: var(--dh-accent) !important; text-underline-offset: 2px; }

  h1, h2, h3, legend {
    color: var(--dh-texte) !important;
    font-weight: 600 !important;
    letter-spacing: -.015em;
  }

  /* Le formulaire devient une carte, comme dans l'application. */
  form, form.form, fieldset {
    background: var(--dh-carte) !important;
    border: 1px solid var(--dh-trait) !important;
    border-radius: 11px !important;
    padding: 24px 26px !important;
    max-width: 640px;
    margin: 22px auto !important;
    box-shadow: none !important;
  }

  label {
    display: block !important;
    color: var(--dh-doux) !important;
    font-size: 13px !important;
    margin-bottom: 6px !important;
    font-weight: 400 !important;
  }

  input[type=text], input[type=password], input[type=email],
  input[type=tel], input:not([type]), select, textarea {
    background: var(--dh-creux) !important;
    border: 1px solid var(--dh-trait) !important;
    border-radius: 8px !important;
    color: var(--dh-texte) !important;
    padding: 11px 13px !important;
    font: inherit !important;
    font-size: 15px !important;
    width: 100% !important;
    max-width: 460px;
    margin-bottom: 14px !important;
  }
  input:focus, select:focus, textarea:focus {
    outline: 2px solid var(--dh-accent) !important;
    outline-offset: 1px;
    border-color: transparent !important;
  }

  input[type=submit], button, input.action {
    background: var(--dh-accent) !important;
    color: #0c1a18 !important;
    border: 0 !important;
    border-radius: 9px !important;
    padding: 12px 24px !important;
    font: inherit !important;
    font-size: 15px !important;
    font-weight: 600 !important;
    cursor: pointer !important;
    width: auto !important;
    margin-top: 6px !important;
  }
  input[type=submit]:hover, button:hover, input.action:hover { filter: brightness(1.09); }

  input[type=checkbox], input[type=radio] {
    width: 16px !important; height: 16px !important;
    accent-color: var(--dh-accent);
    margin-right: 8px !important;
  }

  table { border-collapse: collapse !important; width: 100% !important; }
  td, th { border-color: var(--dh-trait) !important; padding: 8px 10px !important; color: var(--dh-doux) !important; }

  .loginhelp, small, .help, .helptext {
    color: var(--dh-faible) !important;
    font-size: 12.5px !important;
  }

  .errorlist, .error, .errors {
    color: #e2686d !important;
    background: #2c1719 !important;
    border: 1px solid #5c2c30 !important;
    border-radius: 8px !important;
    padding: 10px 14px !important;
    list-style: none !important;
  }

  hr { border-color: var(--dh-trait) !important; }
  img[src*="logo"] { filter: brightness(1.4) contrast(.9); }

  /* Marques posees par l'application sur les champs qu'elle a remplis. */
  .dh-rempli {
    outline: 2px solid var(--dh-accent) !important;
    background: #1c2926 !important;
  }
  .dh-vide-masque { display: none !important; }
`;

// Masque les champs restes vides, et le bloc qui les entoure quand il ne
// contient plus rien d'utile. Un champ masque est toujours soumis (vide), ce qui
// est exactement ce qu'on veut pour les serveurs surnumeraires et les IP.
//
// Ne s'execute QUE sur le formulaire de demande, jamais sur une page d'identite.
const CODE_MASQUER_VIDES = `
    (() => {
        const champs = [...document.querySelectorAll('input[type=text], input:not([type])')];
        let masques = 0;

        for (const e of champs) {
            if (e.value || e.type === 'hidden' || e.type === 'submit') continue;
            // On remonte au bloc qui porte le champ et son libelle, pour ne pas
            // laisser une etiquette orpheline.
            const bloc = e.closest('div, p, tr, li') || e;
            const autresRemplis = [...bloc.querySelectorAll('input')]
                .some(x => x !== e && x.value && x.type !== 'hidden');
            if (autresRemplis) continue;
            bloc.classList.add('dh-vide-masque');
            bloc.dataset.dhMasque = '1';
            masques++;
        }
        return masques;
    })()`;

const CODE_TOUT_AFFICHER = `
    (() => {
        const caches = [...document.querySelectorAll('[data-dh-masque="1"]')];
        for (const e of caches) { e.classList.remove('dh-vide-masque'); delete e.dataset.dhMasque; }
        return caches.length;
    })()`;

module.exports = { STYLE, CODE_MASQUER_VIDES, CODE_TOUT_AFFICHER };
