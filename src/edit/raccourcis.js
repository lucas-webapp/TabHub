// TABLE UNIQUE DES ACTIONS : clavier et palette y puisent tous les deux.
//
// POURQUOI UNE SEULE TABLE. La consigne était d'avoir des contrôles hybrides — saisie ultra-rapide au
// clavier ET palette cliquable. Le piège classique est d'écrire deux fois la même liste : le clavier
// dans un `switch` d'évènements, la palette dans du HTML. Les deux divergent au premier ajout, et
// l'infobulle d'un bouton finit par annoncer un raccourci qui ne fait plus rien.
//
// Ici chaque action est déclarée UNE fois, avec sa touche, son libellé et ce qu'elle fait. Le clavier
// indexe la table par touche ; la palette la parcourt pour fabriquer ses boutons et leurs infobulles.
// Ajouter une action, c'est ajouter une ligne — elle apparaît des deux côtés, forcément d'accord.

import { VALEURS_FIGURES } from '../model/duration.js';

/**
 * Décrit une combinaison de touches sous forme canonique : « ctrl+shift+arrowleft ».
 * Normaliser des deux côtés (déclaration et évènement) évite les comparaisons approximatives qui
 * marchent sur un clavier et pas sur un autre.
 */
export function signatureTouche(e) {
    const parties = [];
    if (e.ctrlKey || e.metaKey) parties.push('ctrl');
    if (e.altKey) parties.push('alt');
    if (e.shiftKey) parties.push('shift');
    let k = e.key;
    if (k === ' ') k = 'space';
    parties.push(String(k).toLowerCase());
    return parties.join('+');
}

/** Libellé affichable d'une combinaison, pour les infobulles et l'aide-mémoire. */
export function libelleTouche(sig) {
    const jolis = {
        arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓',
        space: 'Espace', escape: 'Échap', enter: 'Entrée', backspace: '⌫', delete: 'Suppr',
        home: 'Origine', end: 'Fin', ctrl: 'Ctrl', alt: 'Alt', shift: 'Maj',
    };
    return sig.split('+').map(p => jolis[p] || (p.length === 1 ? p.toUpperCase() : p)).join('+');
}

const D = (valeur) => ({ valeur, points: 0, nolet: null });

/**
 * Les actions. `groupe` sert à la palette (un cadre par groupe), `palette: false` réserve l'action au
 * clavier — la navigation n'a pas besoin de boutons, elle en aurait vingt.
 */
export const ACTIONS = [
    // --- Navigation (clavier seulement) ---------------------------------------------------------
    { id: 'gauche', touches: ['arrowleft'], libelle: 'Évènement précédent', palette: false, faire: ed => ed.deplacerEvenement(-1) },
    { id: 'droite', touches: ['arrowright'], libelle: 'Évènement suivant', palette: false, faire: ed => ed.deplacerEvenement(1) },
    { id: 'haut', touches: ['arrowup'], libelle: 'Corde plus aiguë', palette: false, faire: ed => ed.deplacerCorde(-1) },
    { id: 'bas', touches: ['arrowdown'], libelle: 'Corde plus grave', palette: false, faire: ed => ed.deplacerCorde(1) },
    { id: 'mesurePrec', touches: ['ctrl+arrowleft'], libelle: 'Mesure précédente', palette: false, faire: ed => ed.allerAMesure(ed.curseur.mesure - 1) },
    { id: 'mesureSuiv', touches: ['ctrl+arrowright'], libelle: 'Mesure suivante', palette: false, faire: ed => ed.allerAMesure(ed.curseur.mesure + 1) },
    { id: 'debutMesure', touches: ['home'], libelle: 'Début de la mesure', palette: false, faire: ed => ed.allerAMesure(ed.curseur.mesure, 0) },
    { id: 'finMesure', touches: ['end'], libelle: 'Fin de la mesure', palette: false, faire: ed => ed.allerAMesure(ed.curseur.mesure, -1) },
    { id: 'debut', touches: ['ctrl+home'], libelle: 'Début du morceau', palette: false, faire: ed => ed.allerAMesure(0, 0) },
    { id: 'fin', touches: ['ctrl+end'], libelle: 'Fin du morceau', palette: false, faire: ed => ed.allerAMesure(ed.partition.mesures.length - 1, -1) },

    // --- Saisie (clavier seulement : les chiffres SONT la saisie) --------------------------------
    { id: 'effacer', touches: ['backspace'], libelle: 'Effacer la note', palette: false, faire: ed => ed.effacerOuReculer() },
    { id: 'supprimer', touches: ['delete'], libelle: 'Effacer la note', palette: false, faire: ed => ed.effacerNote() },
    { id: 'inserer', touches: ['enter', 'insert'], libelle: 'Insérer un évènement', palette: false, faire: ed => ed.insererEvenement() },
    { id: 'supprEvenement', touches: ['ctrl+delete'], libelle: 'Supprimer l\'évènement', palette: false, faire: ed => ed.supprimerEvenement() },
    { id: 'transposeHaut', touches: ['ctrl+arrowup'], libelle: 'Case +1', palette: false, faire: ed => ed.transposerNote(1) },
    { id: 'transposeBas', touches: ['ctrl+arrowdown'], libelle: 'Case −1', palette: false, faire: ed => ed.transposerNote(-1) },

    // --- Durées (palette : groupe « Durée ») -----------------------------------------------------
    ...VALEURS_FIGURES.map((valeur, i) => ({
        id: 'duree' + valeur,
        touches: i === 0 ? [] : [],
        libelle: ['Ronde', 'Blanche', 'Noire', 'Croche', 'Double-croche', 'Triple-croche'][i],
        groupe: 'duree', figure: valeur,
        actif: ed => ed.dureeCourante.valeur === valeur,
        faire: ed => ed.appliquerDuree(valeur),
    })),
    { id: 'plusLong', touches: ['+', '='], libelle: 'Durée plus longue', palette: false, faire: ed => changerFigure(ed, -1) },
    { id: 'plusCourt', touches: ['-'], libelle: 'Durée plus courte', palette: false, faire: ed => changerFigure(ed, 1) },
    { id: 'point', touches: ['.'], libelle: 'Note pointée', groupe: 'duree', texte: '•',
      actif: ed => !!ed.evenementCourant().duree.points, faire: ed => ed.basculerPoint() },
    { id: 'triolet', touches: ['alt+3'], libelle: 'Triolet', groupe: 'duree', texte: '3',
      actif: ed => !!ed.evenementCourant().duree.nolet, faire: ed => ed.basculerTriolet() },
    { id: 'silence', touches: ['r'], libelle: 'Silence', groupe: 'duree', texte: '𝄽',
      actif: ed => ed.evenementCourant().silence, faire: ed => ed.basculerSilence() },

    // --- Effets (palette : groupe « Effets ») ----------------------------------------------------
    { id: 'hammer', touches: ['h'], libelle: 'Hammer-on', groupe: 'effet', texte: 'H',
      actif: ed => ed.noteCourante()?.lien === 'hammer', faire: ed => ed.basculerLien('hammer') },
    { id: 'pull', touches: ['p'], libelle: 'Pull-off', groupe: 'effet', texte: 'P',
      actif: ed => ed.noteCourante()?.lien === 'pull', faire: ed => ed.basculerLien('pull') },
    { id: 'slide', touches: ['s'], libelle: 'Slide (glissé)', groupe: 'effet', texte: '/',
      actif: ed => ed.noteCourante()?.lien === 'slide', faire: ed => ed.basculerLien('slide') },
    { id: 'tie', touches: ['t'], libelle: 'Liaison de prolongation', groupe: 'effet', texte: '⌒',
      actif: ed => ed.noteCourante()?.lien === 'tie', faire: ed => ed.basculerLien('tie') },
    { id: 'bend', touches: ['b'], libelle: 'Bend', groupe: 'effet', texte: '↗',
      actif: ed => !!ed.noteCourante()?.bend, faire: ed => ed.definirBend(ed.noteCourante()?.bend ? 0 : 2) },
    { id: 'palmMute', touches: ['m'], libelle: 'Palm mute', groupe: 'effet', texte: 'P.M.',
      actif: ed => ed.evenementCourant().palmMute, faire: ed => ed.basculerEffetEvenement('palmMute') },
    { id: 'ghost', touches: ['x'], libelle: 'Note fantôme', groupe: 'effet', texte: '✕',
      actif: ed => !!ed.noteCourante()?.ghost, faire: ed => ed.basculerGhost() },
    { id: 'accent', touches: ['a'], libelle: 'Accent', groupe: 'effet', texte: '>',
      actif: ed => ed.evenementCourant().accent, faire: ed => ed.basculerEffetEvenement('accent') },

    // --- Mesure (palette : groupe « Mesure ») ----------------------------------------------------
    { id: 'ajouterMesure', touches: ['alt+m'], libelle: 'Ajouter une mesure', groupe: 'mesure', texte: '+ Mesure', faire: ed => ed.ajouterMesure() },
    { id: 'supprimerMesure', touches: ['alt+backspace'], libelle: 'Supprimer la mesure', groupe: 'mesure', texte: '− Mesure', faire: ed => ed.supprimerMesure() },
    { id: 'repriseDebut', touches: [], libelle: 'Reprise ouvrante ‖:', groupe: 'mesure', texte: '‖:',
      actif: ed => ed.mesureCourante().repriseDebut, faire: ed => ed.basculerReprise('debut') },
    { id: 'repriseFin', touches: [], libelle: 'Reprise fermante :‖', groupe: 'mesure', texte: ':‖',
      actif: ed => ed.mesureCourante().repriseFin, faire: ed => ed.basculerReprise('fin') },
];

/** Passe à la figure voisine (plus longue ou plus brève) dans l'échelle des durées. */
function changerFigure(ed, pas) {
    const i = VALEURS_FIGURES.indexOf(ed.evenementCourant().duree.valeur);
    const j = Math.max(0, Math.min(VALEURS_FIGURES.length - 1, (i < 0 ? 2 : i) + pas));
    return ed.appliquerDuree(VALEURS_FIGURES[j]);
}

/** Index touche → action, construit une fois. Les actions sans touche n'y figurent pas. */
export const PAR_TOUCHE = (() => {
    const index = new Map();
    for (const a of ACTIONS) for (const t of a.touches || []) if (!index.has(t)) index.set(t, a);
    return index;
})();

/** Première touche déclarée d'une action, pour l'afficher en infobulle. */
export function toucheDe(action) {
    return action.touches && action.touches.length ? libelleTouche(action.touches[0]) : null;
}
