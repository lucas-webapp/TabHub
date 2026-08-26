// Branchement du clavier sur l'éditeur.
//
// TROIS RÈGLES, dans cet ordre :
//   1. Si la frappe vise un champ de saisie (titre, tempo), on ne fait RIEN. Sans cette garde, taper
//      « 120 » dans le tempo poserait aussi trois notes dans la partition — le genre de bug qu'on ne
//      soupçonne qu'après l'avoir vu.
//   2. Un CHIFFRE seul est une case de tablature. C'est le geste central de l'application, et il
//      passe donc avant toute autre interprétation.
//   3. Le reste est cherché dans la table des actions.

import { PAR_TOUCHE, signatureTouche } from './raccourcis.js';

const CHAMPS_DE_SAISIE = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Vrai si l'évènement part d'un champ où l'utilisateur est en train d'écrire du texte. */
function dansUnChamp(cible) {
    return !!cible && (CHAMPS_DE_SAISIE.has(cible.tagName) || cible.isContentEditable);
}

/**
 * @param {Editeur} editeur
 * @param {object} actions  crochets pour ce que l'éditeur ne gère pas : lecture, fichiers, aide.
 * @returns {function} détacheur
 */
export function brancherClavier(editeur, actions = {}) {
    const surTouche = (e) => {
        if (dansUnChamp(e.target)) {
            // Échap rend la main au document depuis n'importe quel champ : la seule exception, parce
            // qu'un utilisateur bloqué dans un champ n'a sinon plus de sortie au clavier.
            if (e.key === 'Escape') { e.target.blur(); actions.focusPartition?.(); }
            return;
        }
        const sig = signatureTouche(e);

        // 1. Transport et fichiers — hors de la table des actions, qui ne connaît que l'édition.
        if (sig === 'space') { e.preventDefault(); actions.lectureAlternee?.(); return; }
        if (sig === 'escape') { e.preventDefault(); actions.arreter?.(); return; }
        if (sig === 'ctrl+z') { e.preventDefault(); editeur.annuler(); return; }
        if (sig === 'ctrl+y' || sig === 'ctrl+shift+z') { e.preventDefault(); editeur.retablir(); return; }
        if (sig === 'ctrl+s') { e.preventDefault(); actions.enregistrer?.(); return; }
        if (sig === 'ctrl+shift+s') { e.preventDefault(); actions.exporterJson?.(); return; }
        if (sig === 'ctrl+o') { e.preventDefault(); actions.ouvrir?.(); return; }
        if (sig === 'ctrl+p') { e.preventDefault(); actions.exporterPdf?.(); return; }
        if (sig === '?' || sig === 'shift+?') { e.preventDefault(); actions.aide?.(); return; }

        // 1b. Une sélection multiple active (glisser un rectangle sur la partition, voir main.js)
        //     absorbe Suppr/Retour arrière : effacer TOUT ce qui est sélectionné, pas seulement la
        //     case sous le curseur. Sans ce court-circuit, ces mêmes touches tomberaient dans la
        //     table des actions (étape 3) et n'effaceraient que la case courante — la sélection
        //     resterait affichée mais mensongère, comme si elle n'avait jamais servi à rien.
        if ((sig === 'delete' || sig === 'backspace') && actions.aUneSelection?.()) {
            e.preventDefault();
            actions.effacerSelection?.();
            return;
        }

        // 2. Un chiffre seul = une case. Jamais avec Ctrl/Alt, qui appartiennent au navigateur ou aux
        //    raccourcis composés (Alt+3 = triolet).
        if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            editeur.saisirChiffre(parseInt(e.key, 10));
            return;
        }

        // 3. Table des actions.
        const action = PAR_TOUCHE.get(sig);
        if (action) {
            e.preventDefault();
            action.faire(editeur);
        }
    };

    document.addEventListener('keydown', surTouche);
    return () => document.removeEventListener('keydown', surTouche);
}
