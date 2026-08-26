// Glyphes musicaux — contours officiels de Bravura, la police de référence SMuFL.
//
// D'OÙ VIENNENT CES DESSINS. Bravura est la police musicale de référence du standard SMuFL, dessinée
// par Steinberg et publiée sous licence SIL Open Font License 1.1 — donc librement utilisable, y
// compris dans un produit distribué. Ses contours sont extraits en chemins vectoriels par
// outils/generer-glyphes.py, qui produit src/engine/glyphes-bravura.js. La licence intégrale est dans
// vendor/OFL-Bravura.txt.
//
// POURQUOI DES CONTOURS EXTRAITS PLUTÔT QUE LA POLICE. Trois raisons, détaillées dans l'outil :
// jsPDF ne sait embarquer que du TrueType (Bravura est une OpenType/CFF), une police se charge de
// façon asynchrone et fait sauter la partition à l'arrivée, et 889 ko de police partiraient dans
// chaque PDF pour 53 signes. Extraits, les mêmes dessins pèsent 53 ko, s'affichent dès la première
// image, et arrivent dans le format que les deux moteurs de rendu lisent déjà.
//
// CE QUI RESTE DESSINÉ ICI. Une police ne fournit que les SIGNES. Tout ce qui s'étire ou se calcule —
// lignes de portée, hampes, ligatures, barres de mesure, liaisons — relève de la mise en page et se
// trace géométriquement. D'où la table EPAISSEURS en fin de fichier : ce sont les proportions de la
// gravure musicale, celles que Bravura elle-même respecte.
//
// SYSTÈME DE COORDONNÉES : interlignes, y vers le bas. L'origine de chaque glyphe est son ANCRAGE
// MUSICAL au sens SMuFL — le centre de la spirale pour une clé de sol (à poser sur la ligne de sol),
// le centre de la tête pour une note, le bout de la hampe pour un crochet.

import { GLYPHES_BRAVURA } from './glyphes-bravura.js';

/**
 * REPRÉSENTATION UNIFORME D'UN GLYPHE : une liste de TRAITS.
 *   { d, epaisseur: null }  → contour rempli — c'est le cas de tous les glyphes de Bravura
 *   { d, epaisseur: 0.3 }   → ligne tracée, bouts arrondis — réservé aux tracés calculés
 * Les deux moteurs de rendu n'ont donc qu'une seule forme à savoir consommer.
 */
export const rempli = (...d) => d.map(x => ({ d: x, epaisseur: null }));
export const trace = (d, epaisseur) => ({ d, epaisseur });

/** Un glyphe Bravura, prêt à poser. */
function bravura(nom) {
    const g = GLYPHES_BRAVURA[nom];
    if (!g) throw new Error(`Glyphe absent de l'extraction Bravura : ${nom}`);
    const traits = rempli(g.d);
    // La boîte englobante voyage AVEC le glyphe. C'est ce qui permet au moteur de mise en page de
    // MESURER au lieu de deviner : la largeur à réserver devant une altération, l'avance après une
    // clé. Une table de largeurs écrite à la main dériverait du dessin réel dès la première retouche
    // — et c'est exactement ce qui s'était produit avec les glyphes dessinés à la main.
    traits.boite = { gauche: g.boite[0], haut: g.boite[1], droite: g.boite[2], bas: g.boite[3] };
    traits.largeur = g.boite[2] - g.boite[0];
    traits.hauteur = g.boite[3] - g.boite[1];
    // Le NOM du glyphe voyage avec lui. Le moteur SVG s'en sert comme identité pour ne décrire
    // chaque dessin qu'UNE fois dans un <defs>, et le référencer ensuite par <use> — voir render/svg.js.
    traits.nom = nom;
    return traits;
}

/** Largeur d'un glyphe en interlignes — raccourci de lecture pour la mise en page. */
export const largeurDe = (glyphe) => glyphe.largeur ?? 1;
export const boiteDe = (glyphe) => glyphe.boite ?? { gauche: 0, haut: 0, droite: 1, bas: 0 };

// ---------------------------------------------------------------------------------------------
// Têtes de note. Ancrage : le CENTRE de la tête, à poser sur sa ligne ou son interligne.
// ---------------------------------------------------------------------------------------------

export const TETE_RONDE = bravura('teteRonde');
export const TETE_BLANCHE = bravura('teteBlanche');
export const TETE_NOIRE = bravura('teteNoire');
export const TETE_CROIX = bravura('teteCroix');
export const POINT = bravura('point');

/** Tête correspondant à une figure. Au-delà de la noire, toutes les figures partagent sa tête. */
export function teteDe(valeur) {
    return valeur === 1 ? TETE_RONDE : valeur === 2 ? TETE_BLANCHE : TETE_NOIRE;
}

/**
 * Demi-largeur de la tête = décalage horizontal de la hampe.
 *
 * Mesuré sur le glyphe plutôt que fixé à 0,62 comme dans une version antérieure : la ronde est
 * nettement plus large que la noire, et une hampe posée à distance constante flotterait à côté d'une
 * blanche tout en mordant sur une noire.
 */
export const demiTete = (valeur) => largeurDe(teteDe(valeur)) / 2;

// ---------------------------------------------------------------------------------------------
// Clés. Ancrage : (0, 0) sur la LIGNE que la clé désigne, au bord GAUCHE du dessin.
// ---------------------------------------------------------------------------------------------

// Les variantes « 8vb » portent leur petit 8 dans le glyphe même — guitare et basse sonnent une
// octave sous ce qui est écrit, et Bravura dessine ce 8 à sa place exacte, mieux qu'un chiffre posé
// à la main sous la clé.
export const CLE_SOL = bravura('cleSol');
export const CLE_SOL_8VB = bravura('cleSol8vb');
export const CLE_FA = bravura('cleFa');
export const CLE_FA_8VB = bravura('cleFa8vb');

/** Clés de tablature — le « TAB » vertical officiel, à la place de trois lettres empilées. */
export const CLE_TAB_6 = bravura('cleTab6');
export const CLE_TAB_4 = bravura('cleTab4');
export const cleTabPour = (nbCordes) => (nbCordes <= 4 ? CLE_TAB_4 : CLE_TAB_6);

// ---------------------------------------------------------------------------------------------
// Altérations. Ancrage : bord GAUCHE, centré verticalement sur la note visée.
// ---------------------------------------------------------------------------------------------

export const DIESE = bravura('alterationDiese');
export const BEMOL = bravura('alterationBemol');
export const BECARRE = bravura('alterationBecarre');
export const DOUBLE_DIESE = bravura('alterationDoubleDiese');
export const DOUBLE_BEMOL = bravura('alterationDoubleBemol');

export const ALTERATIONS = { '-2': DOUBLE_BEMOL, '-1': BEMOL, '0': BECARRE, '1': DIESE, '2': DOUBLE_DIESE };

// ---------------------------------------------------------------------------------------------
// Silences.
// ---------------------------------------------------------------------------------------------

export const SILENCES = {
    1: bravura('silenceRonde'),
    2: bravura('silenceBlanche'),
    4: bravura('silenceNoire'),
    8: bravura('silenceCroche'),
    16: bravura('silenceDouble'),
    32: bravura('silenceTriple'),
};

/**
 * Ligne de portée sur laquelle poser un silence, comptée depuis la ligne du HAUT, en interlignes.
 *
 * La pause et la demi-pause sont deux rectangles identiques : SEULE cette position les distingue.
 * La pause est SUSPENDUE sous la 4e ligne (une ligne au-dessus du milieu), la demi-pause est POSÉE
 * sur la ligne médiane. Tous les autres silences se centrent sur cette ligne médiane. Confondre les
 * deux premières produit une partition qui se lit juste à un temps près — l'erreur la plus coûteuse
 * qu'un silence puisse porter.
 */
export const LIGNE_SILENCE = { 1: 1, 2: 2, 4: 2, 8: 2, 16: 2, 32: 2 };

// ---------------------------------------------------------------------------------------------
// Crochets de hampe. Ancrage : l'EXTRÉMITÉ de la hampe.
// ---------------------------------------------------------------------------------------------

const CROCHETS_HAUT = { 1: bravura('crochetCrocheHaut'), 2: bravura('crochetDoubleHaut'), 3: bravura('crochetTripleHaut') };
const CROCHETS_BAS = { 1: bravura('crochetCrocheBas'), 2: bravura('crochetDoubleBas'), 3: bravura('crochetTripleBas') };

/**
 * Crochet d'une hampe. `sens` vaut -1 pour une hampe montante, +1 pour une descendante.
 *
 * Bravura fournit DEUX dessins distincts, et ce n'est pas une redondance : un crochet descendant
 * n'est pas le miroir vertical d'un crochet montant — il est plus large (1,22 contre 1,06 interligne)
 * et sa courbure diffère. Une version antérieure retournait le même dessin ; le résultat penchait du
 * mauvais côté sur toutes les hampes descendantes.
 */
export function crochet(n, sens = -1) {
    const table = sens < 0 ? CROCHETS_HAUT : CROCHETS_BAS;
    return table[Math.max(1, Math.min(3, n))];
}

// ---------------------------------------------------------------------------------------------
// Chiffres : signatures rythmiques et n-olets. Ancrage : centre horizontal.
// ---------------------------------------------------------------------------------------------

// Chiffres de signature rythmique : centrés verticalement sur leur ligne, hauteur exactement deux
// interlignes — le dessin est fait pour ça, contrairement à des chiffres de police de texte, dont la
// taille devait être devinée et retouchée à chaque changement d'échelle.
export const CHIFFRES = Array.from({ length: 10 }, (_, i) => bravura(`chiffre${i}`));
/** Chiffres de n-olet : plus petits et penchés, posés sur une ligne de base (bas du glyphe). */
export const CHIFFRES_NOLET = Array.from({ length: 10 }, (_, i) => bravura(`chiffreNolet${i}`));

/** Suite de chiffres d'un même jeu, avec leur largeur totale — pour centrer « 12 » comme « 4 ». */
export function chiffresDe(nombre, jeu = CHIFFRES) {
    const glyphes = String(nombre).split('').map(c => jeu[Number(c)]).filter(Boolean);
    return { glyphes, largeur: glyphes.reduce((t, g) => t + largeurDe(g), 0) };
}

// ---------------------------------------------------------------------------------------------
// Articulations et divers
// ---------------------------------------------------------------------------------------------

export const ACCENT_DESSUS = bravura('accentDessus');
export const ACCENT_DESSOUS = bravura('accentDessous');
export const STACCATO = bravura('staccatoDessus');
/** Figure de noire de l'indication de tempo (« ♩ = 150 »), tête et hampe d'un seul tenant. */
export const NOIRE_TEMPO = bravura('noireTempo');

// ---------------------------------------------------------------------------------------------
// Épaisseurs de trait, en interlignes — ce que la police ne fournit pas.
// Ce sont les proportions de la gravure musicale, celles que Bravura respecte dans ses propres
// dessins ; les regrouper ici évite qu'elles se dispersent en littéraux dans la mise en page.
// ---------------------------------------------------------------------------------------------
export const EPAISSEURS = {
    ligneePortee: 0.13,
    ligneSupplementaire: 0.16,
    hampe: 0.12,
    ligature: 0.5,
    barreMesure: 0.16,
    barreEpaisse: 0.5,
    liaison: 0.1,
};
