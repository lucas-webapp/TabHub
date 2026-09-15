// Dialogues de l'application — à la place des boîtes natives du navigateur.
//
// POURQUOI. Retour utilisateur : « amélioration du visuel des pop-ups : comme sur HarmoHub.
// Aujourd'hui elles ne sont pas stylées. » Trois boîtes natives subsistaient : `window.prompt` pour
// l'annotation de section et pour le nom d'accord, `confirm()` pour « Abandonner la tablature en
// cours ? ». Ce ne sont pas des fenêtres mal habillées, ce sont les fenêtres DU NAVIGATEUR : police
// système, boutons « OK/Annuler » intraduisibles, position imposée en haut de l'écran, et un aspect
// qui change d'un navigateur à l'autre. Au milieu d'une application sombre et dessinée, elles
// signalent « ceci ne fait pas partie du logiciel ».
//
// ET PAS SEULEMENT UNE QUESTION D'ASPECT. Une boîte native ne peut porter QUE deux boutons, aux
// libellés figés. Le garde-fou que réclame le même retour — « demander la sauvegarde ou confirmer la
// fermeture » — a besoin de TROIS choix distincts (exporter puis continuer, continuer sans exporter,
// annuler), ce qu'aucun `confirm()` ne sait dire. C'est ce qui rend ce module nécessaire, pas
// seulement agréable.
//
// UN SEUL BALISAGE POUR TOUT. `#fenetre-dialogue` vit dans index.html et sert à la fois aux
// questions et aux saisies : les deux ont le même châssis (voile + fenêtre + tête + corps + pied),
// déjà celui des Réglages et de l'aperçu PDF. Rien de neuf à styler, donc rien qui puisse divorcer
// du reste au premier changement de palette.
//
// TOUT EST ASYNCHRONE, et c'est le prix à payer : `confirm()` et `prompt()` BLOQUENT le fil
// d'exécution, une fenêtre maison ne peut pas. Les appelants attendent donc une promesse — voir
// edit/raccourcis.js, dont deux actions renvoient désormais celle-ci, et les trois répartiteurs
// (clavier, palette, pavé) qui savent attendre un `faire()` thenable.

/** Clé interne du bouton d'annulation d'une saisie — jamais une valeur que l'appelant puisse voir.
 *  Un caractère nul en tête : aucune saisie humaine ne peut la produire par accident. */
const ANNULE = '\u0000annuler';

/** L'élément, retrouvé à chaque appel : le module ne garde aucune référence au DOM. */
function elements() {
    const voile = document.getElementById('fenetre-dialogue');
    if (!voile) return null;
    return {
        voile,
        titre: voile.querySelector('.dialogue-titre'),
        texte: voile.querySelector('.dialogue-texte'),
        champ: voile.querySelector('.dialogue-champ'),
        etiquette: voile.querySelector('.dialogue-etiquette'),
        ligneChamp: voile.querySelector('.dialogue-ligne-champ'),
        actions: voile.querySelector('.dialogue-actions'),
    };
}

/**
 * Le mécanisme commun : affiche, attend un choix, referme. Rend la valeur du bouton cliqué, ou
 * `null` par l'une des trois portes de sortie — Échap, clic sur le fond, bouton d'annulation.
 *
 * TROIS PORTES ET NON UNE, parce qu'une fenêtre dont on ne sait pas comment sortir est pire qu'une
 * boîte native : celle-ci a au moins toujours son « Annuler ». Échap est la sortie du clavier, le
 * clic sur le fond celle de la souris, et le bouton nommé celle qu'on voit.
 *
 * LE FOCUS EST POSÉ, et rendu. Sans `focus()`, Échap n'arriverait nulle part (le clavier resterait
 * sur la partition, où Échap arrête la lecture) et un lecteur d'écran continuerait d'annoncer la
 * partition derrière. Au retour, le focus repart d'où il venait : on rouvre la fenêtre avec le
 * clavier là où on l'avait laissé.
 */
function ouvrir({ titre, texte, champ, etiquette, boutons, defaut }) {
    const el = elements();
    if (!el) return Promise.resolve(null);

    el.titre.textContent = titre;
    el.texte.textContent = texte || '';
    el.texte.hidden = !texte;
    el.ligneChamp.hidden = !champ;
    if (champ) {
        el.etiquette.textContent = etiquette || '';
        el.champ.value = defaut ?? '';
        el.champ.placeholder = champ.placeholder || '';
    }

    el.actions.innerHTML = '';
    const avantFocus = document.activeElement;

    return new Promise((resolve) => {
        let repondu = false;
        const finir = (valeur) => {
            if (repondu) return;
            repondu = true;
            document.removeEventListener('keydown', surTouche, true);
            el.voile.hidden = true;
            // Le focus rendu à qui l'avait : voir le docblock.
            if (avantFocus && typeof avantFocus.focus === 'function') { try { avantFocus.focus(); } catch (e) { /* élément parti */ } }
            resolve(valeur);
        };

        for (const b of boutons) {
            const bouton = document.createElement('button');
            bouton.type = 'button';
            bouton.className = b.style === 'danger' ? 'btn-danger' : b.style === 'plein' ? 'btn-plein' : 'btn-neutre';
            bouton.textContent = b.libelle;
            bouton.dataset.choix = b.cle;
            bouton.addEventListener('click', () => finir(champ && b.valide ? el.champ.value : b.cle));
            el.actions.appendChild(bouton);
        }

        // EN CAPTURE, POUR NE PAS ÊTRE LE SECOND À RÉPONDRE. L'application écoute déjà `keydown` sur
        // `document` (voir edit/keyboard.js) et y lit Échap comme « arrêter la lecture », les chiffres
        // comme des cases de tablature.
        //
        // CE N'EST PAS ÇA QUI EMPÊCHE LES CHIFFRES DE FUIR, et il faut le dire : `brancherClavier`
        // rend déjà la main dès que l'évènement vient d'un champ de saisie (voir `dansUnChamp`),
        // donc taper « A7 » n'écrirait pas de case 7 même sans cette capture — vérifié en la
        // neutralisant. Ce qu'elle évite vraiment, c'est la DOUBLE réponse à une même touche : sans
        // elle, Échap dans le champ déclenche aussi la branche « rendre la main au document » de
        // keyboard.js, qui retire le focus au champ et le renvoie à la partition — en même temps que
        // ce dialogue-ci referme et rend le focus à qui l'avait. Deux modules qui agissent sur la
        // même frappe finissent par se contredire. Et c'est le seul filet qui tienne si la garde de
        // keyboard.js changeait un jour : ce dialogue ne doit pas dépendre d'un détail interne d'un
        // autre module pour que ses chiffres restent les siens.
        const surTouche = (e) => {
            if (el.voile.hidden) return;
            e.stopPropagation();
            if (e.key === 'Escape') { e.preventDefault(); finir(null); }
            else if (e.key === 'Enter' && champ) { e.preventDefault(); finir(el.champ.value); }
        };
        document.addEventListener('keydown', surTouche, true);

        el.voile.addEventListener('pointerdown', function surFond(ev) {
            if (ev.target !== el.voile) return;
            el.voile.removeEventListener('pointerdown', surFond);
            finir(null);
        });

        el.voile.hidden = false;
        // Le champ d'abord s'il y en a un (on vient écrire), sinon le premier bouton (on vient
        // choisir) : dans les deux cas, le clavier tombe sur ce qu'on est venu faire.
        if (champ) { el.champ.focus(); el.champ.select(); }
        else el.actions.firstElementChild?.focus();
    });
}

/**
 * Une QUESTION à plusieurs réponses. `boutons` : `[{ cle, libelle, style }]` — `style` valant
 * `'plein'` (l'action mise en avant), `'danger'` (celle qui détruit) ou rien (neutre).
 * @returns {Promise<string|null>} la `cle` du bouton cliqué, `null` si annulé.
 */
export function demander({ titre, texte, boutons }) {
    return ouvrir({ titre, texte, boutons });
}

/**
 * Une SAISIE de texte libre — le remplaçant de `window.prompt`.
 * @returns {Promise<string|null>} le texte saisi (éventuellement vide, ce qui a un sens : vider une
 *   annotation la retire), `null` si annulé. La distinction vide/annulé est exactement celle de
 *   `prompt`, et les appelants s'appuient dessus.
 */
export function saisir({ titre, texte, etiquette, valeur = '', placeholder = '', libelleOk = 'Valider' }) {
    return ouvrir({
        titre, texte, etiquette, defaut: valeur,
        champ: { placeholder },
        boutons: [
            { cle: ANNULE, libelle: 'Annuler' },
            { cle: '__ok', libelle: libelleOk, style: 'plein', valide: true },
        ],
    // `ANNULE` ramené à `null`, comme les deux autres portes de sortie (Échap, clic sur le fond) :
    // sans cette traduction, le bouton « Annuler » rendrait la CHAÎNE « __annuler », qu'un appelant
    // prenant `!== null` pour « l'utilisateur a validé » écrirait telle quelle dans la partition.
    }).then(r => (r === ANNULE ? null : r));
}

