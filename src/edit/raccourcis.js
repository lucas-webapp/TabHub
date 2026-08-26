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
    // `apercu` décrit comment la PALETTE représente l'action — jamais une lettre en gras, toujours
    // soit le glyphe RÉEL de Bravura qui apparaîtra sur la partition (point, silence, accent, note
    // fantôme, chiffre de triolet — voir ui/toolbar.js), soit une petite icône de geste dessinée pour
    // l'occasion (hammer-on, pull-off, slide, liaison, bend, reprises — voir ui/icons.js). Ce module
    // ne connaît lui-même ni glyphs.js ni icons.js : il ne fait que NOMMER la présentation, le rendu
    // reste entièrement du ressort de la couche ui/.
    { id: 'point', touches: ['.'], libelle: 'Note pointée', groupe: 'duree', apercu: { type: 'glyphe', nom: 'POINT' },
      actif: ed => !!ed.evenementCourant().duree.points, faire: ed => ed.basculerPoint() },
    { id: 'triolet', touches: ['alt+3'], libelle: 'Triolet', groupe: 'duree', apercu: { type: 'glypheNolet', chiffre: 3 },
      actif: ed => !!ed.evenementCourant().duree.nolet, faire: ed => ed.basculerTriolet() },
    { id: 'silence', touches: ['r'], libelle: 'Silence', groupe: 'duree', apercu: { type: 'silence', valeur: 4 },
      actif: ed => ed.evenementCourant().silence, faire: ed => ed.basculerSilence() },

    // --- Effets (palette : groupe « Effets ») ----------------------------------------------------
    { id: 'hammer', touches: ['h'], libelle: 'Hammer-on', groupe: 'effet', apercu: { type: 'icone', nom: 'hammerOn' },
      actif: ed => ed.noteCourante()?.lien === 'hammer', faire: ed => ed.basculerLien('hammer') },
    { id: 'pull', touches: ['p'], libelle: 'Pull-off', groupe: 'effet', apercu: { type: 'icone', nom: 'pullOff' },
      actif: ed => ed.noteCourante()?.lien === 'pull', faire: ed => ed.basculerLien('pull') },
    { id: 'slide', touches: ['s'], libelle: 'Slide (glissé)', groupe: 'effet', apercu: { type: 'icone', nom: 'slide' },
      actif: ed => ed.noteCourante()?.lien === 'slide', faire: ed => ed.basculerLien('slide') },
    { id: 'tie', touches: ['t'], libelle: 'Liaison de prolongation', groupe: 'effet', apercu: { type: 'icone', nom: 'tie' },
      actif: ed => ed.noteCourante()?.lien === 'tie', faire: ed => ed.basculerLien('tie') },
    { id: 'bend', touches: ['b'], libelle: 'Bend', groupe: 'effet', apercu: { type: 'icone', nom: 'bend' },
      actif: ed => !!ed.noteCourante()?.bend, faire: ed => ed.definirBend(ed.noteCourante()?.bend ? 0 : 2) },
    { id: 'palmMute', touches: ['m'], libelle: 'Palm mute', groupe: 'effet', apercu: { type: 'texteLeger', texte: 'P.M.' },
      actif: ed => ed.evenementCourant().palmMute, faire: ed => ed.basculerEffetEvenement('palmMute') },
    { id: 'ghost', touches: ['x'], libelle: 'Note fantôme', groupe: 'effet', apercu: { type: 'glyphe', nom: 'TETE_CROIX' },
      actif: ed => !!ed.noteCourante()?.ghost, faire: ed => ed.basculerGhost() },
    { id: 'accent', touches: ['a'], libelle: 'Accent', groupe: 'effet', apercu: { type: 'glyphe', nom: 'ACCENT_DESSUS' },
      actif: ed => ed.evenementCourant().accent, faire: ed => ed.basculerEffetEvenement('accent') },
    { id: 'staccato', touches: ['alt+s'], libelle: 'Staccato', groupe: 'effet', apercu: { type: 'glyphe', nom: 'STACCATO' },
      actif: ed => ed.evenementCourant().staccato, faire: ed => ed.basculerEffetEvenement('staccato') },

    // --- Mesure (palette : groupe « Mesure ») ----------------------------------------------------
    { id: 'ajouterMesure', touches: ['alt+m'], libelle: 'Ajouter une mesure', groupe: 'mesure', texte: '+ Mesure', faire: ed => ed.ajouterMesure() },
    { id: 'supprimerMesure', touches: ['alt+backspace'], libelle: 'Supprimer la mesure', groupe: 'mesure', texte: '− Mesure', faire: ed => ed.supprimerMesure() },
    // N'apparaît que si la mesure courante déborde réellement (voir Editeur.ecartMesure) — un bouton
    // toujours visible, sur une mesure déjà juste, n'aurait rien à faire et ne ferait qu'ajouter du
    // bruit à la palette.
    { id: 'corrigerDebordement', touches: ['alt+r'], libelle: 'Répartir le débordement dans une nouvelle mesure', groupe: 'mesure', texte: '⇥ Répartir',
      palette: ed => ed.ecartMesure() > 1e-9, faire: ed => ed.corrigerDebordement() },
    { id: 'repriseDebut', touches: [], libelle: 'Reprise ouvrante', groupe: 'mesure', apercu: { type: 'icone', nom: 'repriseDebut' },
      actif: ed => ed.mesureCourante().repriseDebut, faire: ed => ed.basculerReprise('debut') },
    { id: 'repriseFin', touches: [], libelle: 'Reprise fermante', groupe: 'mesure', apercu: { type: 'icone', nom: 'repriseFin' },
      actif: ed => ed.mesureCourante().repriseFin, faire: ed => ed.basculerReprise('fin') },

    // --- Voix (palette : groupe « Voix ») — voir edit/commands.js -------------------------------
    { id: 'ajouterVoix', touches: ['alt+v'], libelle: 'Ajouter une 2e voix (basse tenue) à cette mesure', groupe: 'voix', texte: '+ Voix',
      palette: ed => ed.nbVoixMesure() < 2, faire: ed => ed.ajouterVoix() },
    { id: 'supprimerVoix', touches: ['alt+shift+v'], libelle: 'Retirer la 2e voix de cette mesure', groupe: 'voix', texte: '− Voix',
      palette: ed => ed.nbVoixMesure() > 1, faire: ed => ed.supprimerVoix() },
    { id: 'basculerVoix', touches: ['tab'], libelle: 'Voix suivante', groupe: 'voix', apercu: { type: 'voix' },
      palette: ed => ed.nbVoixMesure() > 1, actif: () => false, faire: ed => ed.basculerVoix() },
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
