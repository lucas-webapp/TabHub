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

// PLUS DE `nomDeDuree` ICI (audit) : personne ne l'appelait. Les libellés de figures que voit
// l'utilisateur (« Ronde », « Blanche »…) sont posés par edit/raccourcis.js, là où chaque durée a
// déjà son bouton et sa touche.

// ---------------------------------------------------------------------------------------------
// LECTURE TERNAIRE (« swing ») — voir model/score.js, `meta.ternaire` et `grilleTernaire`
//
// LA CONVENTION. Une partition de jazz ou de variété écrit des croches DROITES et prévient en tête
// que deux croches se lisent longue-brève : la première prend les deux tiers du temps, la seconde le
// tiers restant. C'est ce que demandait l'utilisateur (« un système classique, qui permet de dire
// croche=triolet, et ainsi écrire de façon ternaire ? Les portées classiques le font »). L'autre voie
// — un triolet gravé sur chaque temps — est illisible sur un morceau entier, et fausse le comptage à
// la moindre correction.
//
// CE QUE ÇA IMPLIQUE, ET C'EST LE POINT DÉLICAT : le temps ÉCRIT cesse d'égaler le temps SONNÉ. Tout
// ce qui convertit l'un en l'autre doit passer par ici — l'audio (audio/player.js) et l'export MIDI
// (io/midi.js) — et tout ce qui fait le chemin INVERSE, c'est-à-dire situer sur la partition un
// instant entendu (la tête de lecture), doit passer par la fonction réciproque.
//
// CES DEUX FONCTIONS NE CONNAISSENT QU'UN TEMPS ET SA DURÉE : « où sont les temps dans ce morceau »
// est une autre question, qui a besoin des mesures sous les yeux, et c'est score.js#grilleTernaire
// qui y répond. La séparation est volontaire — l'arithmétique d'un côté, la partition de l'autre.
//
// UNE APPLICATION LINÉAIRE PAR MORCEAUX, continue et strictement croissante : c'est ce qui garantit
// que la réciproque existe et qu'aucune note ne peut se retrouver derrière celle qui la précède.
// ---------------------------------------------------------------------------------------------

/** La part du temps qu'occupe la PREMIÈRE des deux croches écrites. Deux tiers : le swing « triolet »,
 *  celui que note « ♪♪ = ♪ ♪ » et que joue la quasi-totalité du répertoire. */
const PART_LONGUE = 2 / 3;

/**
 * Position SONNÉE d'une position ÉCRITE, comptée depuis le début du TEMPS où elle se trouve.
 * @param {number} noires position écrite, en noires.
 * @param {number} unite durée d'un temps en noires (voir uniteDeGroupement). Zéro ou absente : la
 *   position revient inchangée — c'est ainsi qu'une mesure qui ne swingue pas traverse la conversion
 *   sans qu'aucun appelant ait de cas particulier à écrire (voir score.js#grilleTernaire).
 */
export function positionTernaire(noires, unite) {
    if (!(unite > 0) || !Number.isFinite(noires)) return noires;
    const temps = Math.floor(noires / unite + 1e-9);
    const dans = noires - temps * unite;             // 0 .. unite
    const demi = unite / 2;
    const r = dans / demi;                            // 0 .. 2, en demi-temps écrits
    // Première moitié écrite -> elle s'étire jusqu'à PART_LONGUE du temps ; seconde moitié -> le reste.
    const etire = r <= 1
        ? r * (PART_LONGUE * 2)
        : (PART_LONGUE * 2) + (r - 1) * ((1 - PART_LONGUE) * 2);
    return temps * unite + etire * demi;
}

/**
 * La RÉCIPROQUE : position écrite d'une position sonnée. C'est elle qui permet à la tête de lecture
 * de rester sur la bonne colonne quand le morceau est joué ternaire — sans elle, l'image dériverait
 * du son d'un sixième de temps à chaque contretemps, ce qui est pire que pas de ternaire du tout.
 */
export function positionDepuisTernaire(sonne, unite) {
    if (!(unite > 0) || !Number.isFinite(sonne)) return sonne;
    const temps = Math.floor(sonne / unite + 1e-9);
    const dans = sonne - temps * unite;
    const demi = unite / 2;
    const r = dans / demi;                            // 0 .. 2, en demi-temps SONNÉS
    const seuil = PART_LONGUE * 2;                    // où tombe la seconde croche écrite
    const ecrit = r <= seuil
        ? r / (PART_LONGUE * 2)
        : 1 + (r - seuil) / ((1 - PART_LONGUE) * 2);
    return temps * unite + ecrit * demi;
}
