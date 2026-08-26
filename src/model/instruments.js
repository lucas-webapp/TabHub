// Instruments et accordages.
//
// CONVENTION D'INDEXATION DES CORDES — une seule, tenue partout dans l'appli :
//     `cordes[0]` est la corde du HAUT de la tablature, donc la plus AIGUË.
// C'est l'ordre dans lequel une tablature se lit et se dessine (ligne 0 en haut), donc l'index d'une
// note EST son numéro de ligne, sans table de conversion ni inversion à retenir. Le prix à payer est
// que la liste se lit « à l'envers » de la façon dont un guitariste énonce son accordage (« mi la ré
// sol si mi », du grave à l'aigu) : `libelleAccordage` s'en charge pour l'interface, et c'est le seul
// endroit de l'appli où l'ordre s'inverse.

import { nomVersMidi, ecrireHauteur, SYMBOLE_ALTERATION, LETTRE_VERS_FRANCAIS } from './theory.js';

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
        { id: 'standard', nom: 'Standard (Mi)', cordes: [64, 59, 55, 50, 45, 40] },
        { id: 'dropD', nom: 'Drop D', cordes: [64, 59, 55, 50, 45, 38] },
        { id: 'demiTon', nom: 'Demi-ton plus bas (Mi♭)', cordes: [63, 58, 54, 49, 44, 39] },
        { id: 'tonEntier', nom: 'Un ton plus bas (Ré)', cordes: [62, 57, 53, 48, 43, 38] },
        { id: 'dropC', nom: 'Drop C', cordes: [62, 57, 53, 48, 43, 36] },
        { id: 'openG', nom: 'Open G', cordes: [62, 59, 55, 50, 43, 38] },
        { id: 'dadgad', nom: 'DADGAD', cordes: [62, 57, 55, 50, 45, 38] },
    ],
    basse4: [
        { id: 'standard', nom: 'Standard (Mi)', cordes: [43, 38, 33, 28] },
        { id: 'dropD', nom: 'Drop D', cordes: [43, 38, 33, 26] },
        { id: 'demiTon', nom: 'Demi-ton plus bas (Mi♭)', cordes: [42, 37, 32, 27] },
        { id: 'tonEntier', nom: 'Un ton plus bas (Ré)', cordes: [41, 36, 31, 26] },
    ],
    basse5: [
        { id: 'standard', nom: 'Standard (Si grave)', cordes: [43, 38, 33, 28, 23] },
        { id: 'aigu', nom: 'Do aigu (Mi–Do)', cordes: [48, 43, 38, 33, 28] },
        { id: 'dropA', nom: 'Drop A', cordes: [43, 38, 33, 28, 21] },
        { id: 'demiTon', nom: 'Demi-ton plus bas (Mi♭)', cordes: [42, 37, 32, 27, 22] },
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
 * Libellé « Mi La Ré Sol Si Mi » — du GRAVE à l'AIGU, l'ordre dans lequel un instrumentiste énonce
 * son accordage et le seul qui lui parle. Sans octave : c'est un repère de doigté, pas une hauteur.
 */
export function libelleAccordage(cordes, francais = true) {
    return cordes.slice().reverse().map(midi => {
        const e = ecrireHauteur(midi, 0);
        const base = francais ? LETTRE_VERS_FRANCAIS[e.lettre] : e.lettre;
        return base + SYMBOLE_ALTERATION[String(e.alteration)];
    }).join(' ');
}

/** Hauteur réelle d'une case sur une corde. Le capodastre décale tout le manche d'autant de cases. */
export function hauteurDeCase(accordage, corde, frette, capo = 0) {
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
