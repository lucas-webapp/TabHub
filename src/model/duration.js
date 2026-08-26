// Durées rythmiques : figure de note, points, division irrégulière (triolets).
//
// UNITÉ INTERNE : LA NOIRE. Toute durée se ramène à un nombre de noires (« quarter notes »), en
// nombre flottant. C'est l'unité qu'attend Tone.js pour programmer un évènement, celle dans laquelle
// une signature rythmique s'exprime naturellement (4/4 = 4 noires), et la seule qui reste juste quand
// on mélange triolets et notes pointées dans la même mesure. Compter en doubles-croches entières —
// tentant, et ce que fait le séquenceur de HarmoHub — casse dès le premier triolet de croches, qui
// vaut 1/3 de noire : un nombre qui n'a pas de représentation exacte en doubles-croches.

/** Figures disponibles, de la ronde à la triple-croche. `valeur` est le dénominateur usuel. */
export const FIGURES = [
    { valeur: 1, nom: 'Ronde', crochets: 0, symbole: '𝅝' },
    { valeur: 2, nom: 'Blanche', crochets: 0, symbole: '𝅗𝅥' },
    { valeur: 4, nom: 'Noire', crochets: 0, symbole: '♩' },
    { valeur: 8, nom: 'Croche', crochets: 1, symbole: '♪' },
    { valeur: 16, nom: 'Double-croche', crochets: 2, symbole: '𝅘𝅥𝅯' },
    { valeur: 32, nom: 'Triple-croche', crochets: 3, symbole: '𝅘𝅥𝅰' },
];

export const VALEURS_FIGURES = FIGURES.map(f => f.valeur);

/** Nombre de crochets (ou de ligatures) d'une figure : 0 pour la noire et au-delà, 1 par division. */
export function crochetsDe(valeur) {
    const f = FIGURES.find(f => f.valeur === valeur);
    return f ? f.crochets : 0;
}

/**
 * Durée en noires d'une figure, points et division irrégulière compris.
 *
 * Les points suivent la progression géométrique classique : chaque point ajoute la MOITIÉ de ce que
 * vaut le précédent (1 point = ×1,5 ; 2 points = ×1,75). Écrit comme une somme plutôt qu'en dur, pour
 * que 3 points — rares mais légaux — tombent juste sans cas particulier.
 *
 * Le n-olet est décrit par `{ dans, valent }` : « `dans` notes dans le temps de `valent` ». Un triolet
 * est donc `{ dans: 3, valent: 2 }` — trois croches dans le temps de deux — et chaque note vaut 2/3.
 * Cette forme couvre aussi le quintolet {5,4} ou le duolet {2,3} sans code supplémentaire.
 */
export function dureeEnNoires(duree) {
    const { valeur = 4, points = 0, nolet = null } = duree || {};
    let n = 4 / valeur;
    let ajout = n;
    for (let i = 0; i < points; i++) { ajout /= 2; n += ajout; }
    if (nolet && nolet.dans > 0 && nolet.valent > 0) n *= nolet.valent / nolet.dans;
    return n;
}

/** Durée en noires d'une mesure entière selon sa signature rythmique. 6/8 = 3 noires. */
export function noiresParMesure(signature) {
    const { battements = 4, unite = 4 } = signature || {};
    return battements * (4 / unite);
}

/**
 * Regroupement des ligatures : à quelle « unité de temps » (en noires) les croches se ligaturent.
 *
 * C'est la règle qui donne à une partition son rythme visuel. En 3/8, l'image de référence ligature
 * les trois croches d'une mesure ENSEMBLE (un seul groupe de 3), pas par paires — parce qu'en mesure
 * composée l'unité de temps est la noire pointée, pas la croche. Sans cette distinction, une mesure
 * à 6/8 s'afficherait en trois paires au lieu de deux groupes de trois, et se lirait comme du 3/4.
 */
export function uniteDeGroupement(signature) {
    const { battements = 4, unite = 4 } = signature || {};
    // Mesure composée : dénominateur 8 ou 16 avec un numérateur multiple de 3 (6/8, 9/8, 12/8, 3/8).
    if (unite >= 8 && battements % 3 === 0) return 3 * (4 / unite);
    // Mesure simple : on groupe à la noire (4/4, 3/4), sauf en x/8 non composé (5/8, 7/8) où l'unité
    // reste la croche faute de découpage évident.
    if (unite >= 8) return 4 / unite;
    return 1;
}

/** Libellé court pour l'interface et les infobulles. */
export function nomDeDuree(duree) {
    const f = FIGURES.find(f => f.valeur === (duree?.valeur ?? 4));
    let nom = f ? f.nom : '?';
    const points = duree?.points || 0;
    if (points === 1) nom += ' pointée';
    else if (points > 1) nom += ` ${points} points`;
    if (duree?.nolet) nom += duree.nolet.dans === 3 && duree.nolet.valent === 2 ? ' (triolet)' : ` (${duree.nolet.dans}:${duree.nolet.valent})`;
    return nom;
}
