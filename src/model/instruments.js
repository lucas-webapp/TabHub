// Instruments et accordages.
//
// CONVENTION D'INDEXATION DES CORDES — une seule, tenue partout dans l'appli :
//     `cordes[0]` est la corde du HAUT de la tablature, donc la plus AIGUË.
// C'est l'ordre dans lequel une tablature se lit et se dessine (ligne 0 en haut), donc l'index d'une
// note EST son numéro de ligne, sans table de conversion ni inversion à retenir. Le prix à payer est
// que la liste se lit « à l'envers » de la façon dont un guitariste énonce son accordage (« E A D G
// B E », du grave à l'aigu) : `libelleAccordage` s'en charge pour l'interface, et c'est le seul
// endroit de l'appli où l'ordre s'inverse.

import { nomVersMidi, ecrireHauteur, SYMBOLE_ALTERATION } from './theory.js';

/**
 * Les trois instruments de la V1.
 *
 * `clef` note que guitare et basse sont des instruments TRANSPOSITEURS : ils sonnent une octave plus
 * bas que ce qui est écrit. La partition se lit donc en clé de sol (guitare) ou de fa (basse) avec un
 * « 8 » sous la clé, tandis que les hauteurs MIDI stockées et jouées sont les hauteurs RÉELLES. Ne pas
 * séparer les deux mènerait soit à une portée illisible perchée sous une pile de lignes
 * supplémentaires, soit à un playback une octave trop haut.
 */
export const INSTRUMENTS = {
    guitare: {
        id: 'guitare',
        nom: 'Guitare',
        nbCordes: 6,
        clef: 'sol8vb',
        casesMax: 24,
        accordageDefaut: 'standard',
    },
    basse4: {
        id: 'basse4',
        nom: 'Basse 4 cordes',
        nbCordes: 4,
        clef: 'fa8vb',
        casesMax: 24,
        accordageDefaut: 'standard',
    },
    basse5: {
        id: 'basse5',
        nom: 'Basse 5 cordes',
        nbCordes: 5,
        clef: 'fa8vb',
        casesMax: 24,
        accordageDefaut: 'standard',
    },
    // PREMIER JALON DU CHANTIER PIANO — la mise en page (portée à deux clés, sans tablature) : la
    // saisie directement sur la portée viendra ensuite. `clef: 'grandPortee'` est un marqueur
    // reconnu par engine/layout.js (mettreEnPagePiano), PAS une clé de CLEFS : le piano n'a ni corde
    // ni case, donc ni accordage ni capodastre au sens des trois instruments ci-dessus — `nbCordes`
    // et `casesMax` restent à 0 pour que le reste du modèle (qui suppose leur présence) continue de
    // fonctionner sans jamais y trouver quoi que ce soit à placer.
    piano: {
        id: 'piano',
        nom: 'Piano',
        nbCordes: 0,
        clef: 'grandPortee',
        casesMax: 0,
        accordageDefaut: 'aucun',
    },
};

/**
 * Accordages prédéfinis, par instrument. Rappel : du plus AIGU au plus grave (voir en-tête).
 *
 * « Demi-ton plus bas » n'est pas un accordage alternatif au sens de Drop D — c'est le même accordage
 * transposé en bloc. Il est écrit en dur plutôt que calculé par -1 sur le standard, pour que la liste
 * reste une donnée inspectable (et que l'utilisateur puisse la lire dans le JSON exporté) plutôt
 * qu'un résultat de calcul invisible.
 */
export const ACCORDAGES = {
    guitare: [
        { id: 'standard', nom: 'Standard', cordes: [64, 59, 55, 50, 45, 40] },
        { id: 'dropD', nom: 'Drop D', cordes: [64, 59, 55, 50, 45, 38] },
        { id: 'demiTon', nom: 'Eb Standard', cordes: [63, 58, 54, 49, 44, 39] },
        { id: 'tonEntier', nom: 'D Standard', cordes: [62, 57, 53, 48, 43, 38] },
        { id: 'dropC', nom: 'Drop C', cordes: [62, 57, 53, 48, 43, 36] },
        { id: 'openG', nom: 'Open G', cordes: [62, 59, 55, 50, 43, 38] },
        { id: 'dadgad', nom: 'DADGAD', cordes: [62, 57, 55, 50, 45, 38] },
    ],
    basse4: [
        { id: 'standard', nom: 'Standard', cordes: [43, 38, 33, 28] },
        { id: 'dropD', nom: 'Drop D', cordes: [43, 38, 33, 26] },
        { id: 'demiTon', nom: 'Eb Standard', cordes: [42, 37, 32, 27] },
        { id: 'tonEntier', nom: 'D Standard', cordes: [41, 36, 31, 26] },
    ],
    basse5: [
        { id: 'standard', nom: 'Standard', cordes: [43, 38, 33, 28, 23] },
        { id: 'aigu', nom: 'High C', cordes: [48, 43, 38, 33, 28] },
        { id: 'dropA', nom: 'Drop A', cordes: [43, 38, 33, 28, 21] },
        { id: 'demiTon', nom: 'Bb Standard', cordes: [42, 37, 32, 27, 22] },
    ],
    // Un seul « accordage », sans cordes : accordageParDefaut(instrumentId) réclame au moins une
    // entrée pour toute la famille des instruments, sans quoi elle retomberait sur guitare.
    piano: [
        { id: 'aucun', nom: 'Piano', cordes: [] },
    ],
};

/** Accordage prêt à l'emploi, cloné (jamais la référence : l'appelant peut le modifier corde à corde). */
export function accordageParDefaut(instrumentId) {
    const liste = ACCORDAGES[instrumentId] || ACCORDAGES.guitare;
    const def = liste.find(a => a.id === (INSTRUMENTS[instrumentId]?.accordageDefaut || 'standard')) || liste[0];
    return { id: def.id, nom: def.nom, cordes: def.cordes.slice() };
}

/** Retrouve un accordage prédéfini par son identifiant, ou null si c'est un accordage personnalisé. */
export function accordagePredefini(instrumentId, accordageId) {
    const trouve = (ACCORDAGES[instrumentId] || []).find(a => a.id === accordageId);
    return trouve ? { id: trouve.id, nom: trouve.nom, cordes: trouve.cordes.slice() } : null;
}

/**
 * Libellé « E A D G B E » — du GRAVE à l'AIGU, l'ordre dans lequel un instrumentiste énonce son
 * accordage et le seul qui lui parle. Sans octave : c'est un repère de doigté, pas une hauteur.
 *
 * En lettres anglo-saxonnes (E, A, D…), pas en noms français (Mi, La, Ré…) : plus simple à lire,
 * et c'est la notation que la quasi-totalité des ressources (tablatures, forums, accordages
 * affichés par les instruments eux-mêmes) emploient déjà — voir aussi la grille corde par corde
 * dans main.js#remplirReglages, qui suit la même règle.
 */
export function libelleAccordage(cordes) {
    return cordes.slice().reverse().map(midi => {
        const e = ecrireHauteur(midi, 0);
        return e.lettre + SYMBOLE_ALTERATION[String(e.alteration)];
    }).join(' ');
}

/**
 * Hauteur réelle d'une case sur une corde. Le capodastre décale tout le manche d'autant de cases.
 *
 * PIANO (accordage SANS cordes, voir ACCORDAGES.piano) : il n'y a ni corde ni case à proprement
 * parler, mais réutiliser les deux mêmes champs plutôt qu'en ajouter de nouveaux évite de refaire
 * courir un troisième champ dans tout ce qui touche déjà une note (modèle, undo, JSON, MIDI…) — voir
 * edit/commands.js#saisirHauteur. `frette` porte alors DIRECTEMENT la hauteur MIDI absolue, et
 * `corde` reste sans effet sur la hauteur (toujours 0, voir saisirHauteur).
 */
export function hauteurDeCase(accordage, corde, frette, capo = 0) {
    if (!accordage.cordes.length) return frette + capo;
    const base = accordage.cordes[corde];
    if (base == null) return null;
    return base + frette + capo;
}

/**
 * Détecte si un accordage correspond encore à un prédéfini — utilisé après une édition corde à corde
 * pour éviter d'afficher « Personnalisé » à quelqu'un qui vient de reconstituer un Drop D à la main.
 */
export function identifierAccordage(instrumentId, cordes) {
    for (const a of ACCORDAGES[instrumentId] || []) {
        if (a.cordes.length === cordes.length && a.cordes.every((v, i) => v === cordes[i])) return a;
    }
    return null;
}

export { nomVersMidi };
