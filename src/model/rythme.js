// LE RYTHME, EN GRILLE — la partie PURE de l'aide rythmique : aucun DOM, aucun dessin.
//
// POURQUOI ELLE VIT DANS `model/` ET NON DANS `ui/`. Elle a DEUX clients, et le second est arrivé
// après :
//   1. L'AIDE RYTHMIQUE (voir ui/rythme.js), où l'utilisateur pose lui-même les barres et choisit la
//      subdivision de chaque temps.
//   2. L'IMPORT MIDI (voir io/midi.js), qui fait exactement le même travail sans personne pour
//      cliquer : il DÉDUIT la subdivision de chaque temps des attaques du fichier, puis convertit.
// Un import qui refabriquerait sa propre conversion finirait par écrire les triolets autrement que
// l'aide — et `io/` n'a pas à dépendre de `ui/` pour l'éviter.
//
// LA GRILLE. Une mesure se divise en TEMPS (voir uniteDeGroupement), chaque temps en 2, 3 ou 4
// CELLULES — jamais plus (pas de triples-croches, décidé avec l'utilisateur). Une cellule est
// `vide`, `attaque`, ou `tenue` : c'est ainsi qu'une note dure plus d'une cellule sans qu'on ait à
// nommer sa figure, et c'est tout le point de l'exercice.

import { creerPartition, creerMesure, creerEvenement, creerNote, figuresPour,
         figuresSilencePour, armureEffective, modeEffectif } from './score.js';
import { uniteDeGroupement, dureeEnNoires, noiresParMesure } from './duration.js';
import { tonaliteDe, LETTRE_VERS_PC } from './theory.js';
import { hauteurDeCase } from './instruments.js';

/**
 * LES DEUX DIVISIONS PROPOSÉES — et il n'y en a que deux parce qu'il n'y a qu'une question
 * musicale : ce temps se divise-t-il en MOITIÉS ou en TIERS ?
 *
 * MAIS LE TEMPS N'EST PAS TOUJOURS UNE NOIRE, et une version antérieure l'oubliait : elle offrait
 * 4 ou 3 partout. Mesuré, le résultat était faux dans deux familles de mesures sur trois —
 *
 *   • EN 6/8 (et 9/8, 12/8), le temps est une noire POINTÉE, déjà ternaire par nature. Le diviser
 *     en quatre donne des cellules de 0,375 noire, et la conversion écrivait alors
 *     « double pointée + TRIPLE-croche + croche » — des triples-croches, là où la grille n'en
 *     promettait pas. Le diviser en trois donne la bonne cellule (une croche), mais
 *     l'ancienne conversion la marquait d'un chiffre de TRIOLET, alors que trois croches dans un
 *     temps de 6/8 est justement sa division ordinaire. Les deux choix étaient donc mauvais.
 *   • EN 5/8 ET 7/8 (x/8 non composé), le temps est une CROCHE. Le diviser en quatre donne des
 *     cellules de 0,125 noire : rien que des triples-croches, sur toute la mesure — ce qui est
 *     désormais un choix OFFERT plutôt qu'un accident, mais jamais celui par défaut.
 *
 * LA TRIPLE-CROCHE EST LA TROISIÈME DIVISION DE CHAQUE FAMILLE, jamais la première : elle sert les
 * traits rapides (gammes, trilles écrits, gimmicks de shred) et n'a rien à faire dans le rythme
 * courant. L'ordre de chaque liste va donc du plus employé au plus rare, et c'est le premier élément
 * que prend une grille neuve.
 *
 * D'où un choix qui suit la signature. Le libellé des boutons suit avec (voir `libelleDivision`) :
 * « binaire / ternaire » n'a de sens que là où le temps est simple.
 *
 * L'ordre de `PREFERENCE_SUB` plus bas est différent et garde le 2 : il ne décrit pas un choix
 * offert, mais la subdivision qu'un import MIDI DÉDUIT de ce qu'il entend, où « le plus simple qui
 * explique aussi bien » est la bonne réponse.
 *
 * POURQUOI « 2 » N'EST PAS OFFERT EN MESURE SIMPLE. Il y était, et il ne servait à rien : une grille
 * en deux est un sous-ensemble strict d'une grille en quatre, et les deux produisent une écriture
 * RIGOUREUSEMENT identique (vérifié — deux croches sur une grille en 2 et sur une grille en 4
 * rendent les mêmes figures, octet pour octet). Ce n'était donc pas un choix musical mais une
 * finesse de clic déguisée en choix musical.
 */
export function subdivisionsPour(signature) {
    const { battements = 4, unite = 4 } = signature || {};
    // Mesure composée : le temps est pointé, sa division naturelle est en trois.
    if (unite >= 8 && battements % 3 === 0) return [3, 6, 12];
    // Mesure simple à la noire (4/4, 3/4, 2/4, 2/2…).
    if (unite <= 4) return [4, 3, 8];
    // x/8 non composé : le temps est une croche.
    return [2, 3, 4];
}

/**
 * LE LIBELLÉ D'UN BOUTON DE DIVISION, et son infobulle — la figure qu'une cellule vaudra.
 *
 * « Binaire / Ternaire » ne veut rien dire là où le temps est DÉJÀ ternaire : en 6/8, les deux
 * choix sont « la croche » et « la double-croche », et c'est ce qu'on écrit sur les boutons. Le
 * libellé vient donc de la famille de mesure, et l'infobulle nomme toujours la cellule.
 */
export function libelleDivision(signature, sub) {
    const unite = uniteDeGroupement(signature);
    const cellule = unite / sub;
    const NOMS = [[1, 'noire'], [0.75, 'croche pointée'], [0.5, 'croche'], [0.375, 'double pointée'],
                  [0.25, 'double-croche'], [0.125, 'triple-croche']];
    const nom = NOMS.find(([d]) => Math.abs(d - cellule) < 1e-6)?.[1];
    const figure = nom ? `une ${nom}` : 'un tiers de temps (n-olet)';
    // LE BOUTON PORTE LE NOM DE LA FIGURE, pas un caractère de mesure — et c'est ce qui remplace un
    // ancien « Binaire / Ternaire » qui ne tenait qu'à deux boutons. Depuis que la TRIPLE-CROCHE est
    // offerte, chaque famille de mesure en propose trois : nommer la cellule est la seule règle qui
    // reste vraie quel que soit leur nombre, et elle dit en outre quelque chose d'utile — « Doubles »
    // apprend ce qu'on va poser, « Binaire » ne l'apprenait pas. « Ternaire » ne subsiste que pour la
    // cellule qui n'EST pas une figure : le tiers de temps, qui s'écrit en n-olet.
    const COURTS = [[1, 'Noires'], [0.75, 'Croches p.'], [0.5, 'Croches'],
                    [0.375, 'Doubles p.'], [0.25, 'Doubles'], [0.125, 'Triples']];
    const texte = COURTS.find(([d]) => Math.abs(d - cellule) < 1e-6)?.[1] ?? 'Ternaire';
    return { texte, titre: `Chaque temps en ${sub} — une cellule vaut ${figure}` };
}

/** Le triolet, une fois pour toutes : trois figures pour la valeur de deux. */
const T3 = { dans: 3, valent: 2 };
const EPS = 1e-9;

/** Les trois états d'une cellule. `tenue` prolonge l'attaque qui précède — c'est ainsi qu'une note
 *  dure plus d'une cellule sans qu'on ait à nommer sa figure. */
export const VIDE = 'vide';
export const ATTAQUE = 'attaque';
export const TENUE = 'tenue';

/**
 * L'état initial : `nMesures` mesures, chaque temps subdivisé en 4, toutes cellules vides.
 * @param {{battements:number, unite:number}} signature reprise du morceau — l'aide ne la choisit pas.
 */
export function etatInitial(nMesures, signature) {
    const unite = uniteDeGroupement(signature);
    const capacite = (signature.battements || 4) * (4 / (signature.unite || 4));
    const parMesure = Math.max(1, Math.round(capacite / unite));
    // LA DIVISION DE DÉPART VIENT DE LA SIGNATURE, jamais d'un 4 en dur : en 6/8 un temps découpé
    // en quatre vaut des cellules de 0,375 noire, que rien ne sait écrire (voir subdivisionsPour).
    const sub = subdivisionsPour(signature)[0];
    const temps = [];
    for (let m = 0; m < nMesures; m++) {
        for (let t = 0; t < parMesure; t++) temps.push({ mesure: m, sub, cellules: Array(sub).fill(VIDE) });
    }
    return { nMesures, signature, unite, tempsParMesure: parMesure, temps };
}

/** Change la subdivision d'un temps, en conservant ce qui peut l'être : les cellules repartent
 *  vides. Redistribuer un rythme d'une grille à l'autre donnerait un résultat que personne n'a
 *  demandé — mieux vaut un temps propre à re-remplir qu'un rythme deviné de travers. */
export function changerSubdivision(etat, iTemps, sub) {
    const t = etat.temps[iTemps];
    if (!t || !subdivisionsPour(etat.signature).includes(sub) || t.sub === sub) return etat;
    t.sub = sub;
    t.cellules = Array(sub).fill(VIDE);
    return etat;
}

/**
 * LA SUBDIVISION DE TOUTE LA GRILLE — binaire (4) ou ternaire (3).
 *
 * GLOBALE ET NON PAR TEMPS, sur demande explicite de l'utilisateur. Le réglage était par temps, à
 * faire défiler en cliquant un chiffre posé au-dessus de chaque temps : personne ne devinait ce que
 * ce chiffre voulait dire, et la grille se retrouvait compartimentée en boîtes pour porter ces
 * en-têtes. Un morceau se joue binaire ou ternaire ; c'est cette question-là qu'on pose maintenant,
 * une fois, pour toute la grille.
 *
 * LES CELLULES REPARTENT VIDES quand la subdivision change. Redistribuer un rythme d'une grille en
 * quatre vers une grille en trois donnerait un résultat que personne n'a demandé — mieux vaut une
 * grille propre à re-remplir qu'un rythme deviné de travers.
 */
export function changerSubdivisionGlobale(etat, sub) {
    if (!subdivisionsPour(etat.signature).includes(sub)) return etat;
    for (const t of etat.temps) { t.sub = sub; t.cellules = Array(sub).fill(VIDE); }
    return etat;
}

/** Toutes les cellules à plat, chacune sachant d'où elle vient et ce qu'elle vaut en noires.
 *  Exportée pour la grille cliquable (voir ui/rythme.js), qui doit savoir quelle cellule un
 *  glisser a traversée. */
export function aplatirCellules(etat) {
    const plat = [];
    // `debut` — la position de la cellule DANS SA MESURE, en noires. C'est la donnée qui manquait :
    // sans elle la conversion choisissait ses figures d'après la seule durée, et écrivait un soupir
    // pointé à cheval sur deux temps (voir figuresDeCourse). Le rang du temps dans sa mesure suffit
    // à la calculer, et se compte ici une fois pour toutes.
    const rangs = new Map();
    etat.temps.forEach((t, iTemps) => {
        const rang = rangs.get(t.mesure) ?? 0;
        rangs.set(t.mesure, rang + 1);
        const debutTemps = rang * etat.unite;
        const duree = etat.unite / t.sub;
        t.cellules.forEach((etatCell, iCell) => {
            plat.push({ iTemps, iCell, mesure: t.mesure, sub: t.sub, etat: etatCell, duree,
                        debut: debutTemps + iCell * duree });
        });
    });
    return plat;
}

// ---------------------------------------------------------------------------------------------
// LES COURSES, EN COLONNES — ce dont la grille à l'écran a besoin
//
// POURQUOI CETTE COUCHE EXISTE. Le modèle range ses cellules par TEMPS (`etat.temps[i].cellules[j]`),
// ce qui est la bonne forme pour convertir en figures. La grille, elle, voit la fenêtre comme une
// RANGÉE de colonnes numérotées : c'est ainsi qu'un geste s'exprime (« de la colonne 3 à la
// colonne 6 »), et la traduction ne doit pas vivre dans l'interface, qui n'a pas à connaître le
// découpage interne.
//
// UNE COURSE est une note et sa tenue : une ATTAQUE suivie de ses TENUE. C'est l'objet que
// l'utilisateur manipule — il étire une NOTE, il ne peint pas des cases une par une.
//
// LES INDEX SONT GLOBAUX À LA GRILLE, pas locaux à une mesure, et ce choix est le cœur d'un
// correctif. Une première version raisonnait mesure par mesure : une course ne pouvait donc pas
// franchir une barre, et un glissé de la mesure 1 vers la mesure 2 s'arrêtait net à la barre
// (mesuré : de la colonne 14 vers la colonne 2 de la suivante, on obtenait « 15 / span 2 »). Or une
// note LIÉE par-dessus la barre est une écriture ordinaire, et souvent la seule juste. Les courses
// vivent donc sur la grille entière ; c'est le DESSIN (`coursesDeMesure`) et la CONVERSION
// (`evenementsParMesure`) qui les recoupent à la barre, chacun à sa façon — un morceau de pilule
// par mesure d'un côté, des figures LIÉES de l'autre.
// ---------------------------------------------------------------------------------------------

/** Les cellules d'UNE mesure, à plat et dans l'ordre : la vue en colonnes. */
export function colonnesDeMesure(etat, mesure) {
    return aplatirCellules(etat).filter(c => c.mesure === mesure);
}

/** L'index GLOBAL de la colonne `colonne` de la mesure `mesure`, ou -1 si elle n'existe pas. */
export function indexDe(etat, mesure, colonne) {
    const plat = aplatirCellules(etat);
    let rang = 0;
    for (let i = 0; i < plat.length; i++) {
        if (plat[i].mesure !== mesure) continue;
        if (rang === colonne) return i;
        rang++;
    }
    return -1;
}

/** L'inverse : la mesure et la colonne locale d'un index global, ou `null`. */
export function repereDe(etat, i) {
    const plat = aplatirCellules(etat);
    if (!plat[i]) return null;
    const mesure = plat[i].mesure;
    let colonne = 0;
    for (let k = 0; k < i; k++) if (plat[k].mesure === mesure) colonne++;
    return { mesure, colonne };
}

/** Écrit l'état d'une colonne GLOBALE, en passant par le rangement réel (temps, cellule). */
function ecrireColonne(etat, plat, i, valeur) {
    const c = plat[i];
    if (c) etat.temps[c.iTemps].cellules[c.iCell] = valeur;
}

/**
 * LA COURSE QUI COUVRE la colonne globale `i`, ou `null` si cette colonne est vide.
 *
 * On remonte jusqu'à l'attaque : c'est ce qui fait qu'un geste pris au MILIEU d'une note tenue
 * manipule la note ENTIÈRE, et non la cellule sous le doigt — y compris quand cette attaque est
 * dans la mesure précédente. Une tenue orpheline (sans attaque devant elle, ce qu'aucun geste ne
 * produit mais qu'un fichier malformé pourrait contenir) ne rend rien plutôt que de faire croire à
 * une note.
 */
export function courseA(etat, i) {
    const plat = aplatirCellules(etat);
    if (!plat[i] || plat[i].etat === VIDE) return null;
    let debut = i;
    while (debut > 0 && plat[debut].etat === TENUE) debut--;
    if (plat[debut].etat !== ATTAQUE) return null;
    let fin = debut;
    while (fin + 1 < plat.length && plat[fin + 1].etat === TENUE) fin++;
    return { debut, fin };
}

/** Toutes les courses de la grille, en index GLOBAUX et dans l'ordre. */
export function courses(etat) {
    const plat = aplatirCellules(etat);
    const sortie = [];
    let i = 0;
    while (i < plat.length) {
        if (plat[i].etat !== ATTAQUE) { i++; continue; }
        let fin = i;
        while (fin + 1 < plat.length && plat[fin + 1].etat === TENUE) fin++;
        sortie.push({ debut: i, fin });
        i = fin + 1;
    }
    return sortie;
}

/**
 * LES MORCEAUX DE COURSE À DESSINER DANS UNE MESURE — en colonnes LOCALES, recoupés à la barre.
 *
 * Une course qui franchit la barre donne DEUX morceaux, un par mesure, et c'est ainsi que tout
 * séquenceur la montre : la pilule s'arrête au bord de sa mesure et reprend au début de la suivante.
 * Chaque morceau dit ce qu'il est —
 *   `attaque`  : l'attaque de la note est DANS cette mesure (le morceau porte donc le repère
 *                d'attaque ; un morceau de continuation n'en porte pas, il n'y a rien à y pincer) ;
 *   `continue` : la note se prolonge APRÈS cette mesure (le morceau est coupé à droite).
 */
export function coursesDeMesure(etat, mesure) {
    const plat = aplatirCellules(etat);
    const indices = [];
    plat.forEach((c, i) => { if (c.mesure === mesure) indices.push(i); });
    if (!indices.length) return [];
    const premier = indices[0], dernier = indices[indices.length - 1];
    return courses(etat)
        .filter(c => c.fin >= premier && c.debut <= dernier)
        .map(c => ({
            debut: Math.max(c.debut, premier) - premier,
            fin: Math.min(c.fin, dernier) - premier,
            attaque: c.debut >= premier,
            continue: c.fin > dernier,
        }));
}

/**
 * POSE une course de `debut` à `fin` (colonnes GLOBALES incluses), en écrasant ce qu'elle recouvre.
 *
 * ÉCRASER PLUTÔT QUE REFUSER, et c'est un choix : étirer une note par-dessus sa voisine absorbe la
 * voisine. Refuser le geste obligerait à effacer d'abord, pour un résultat que l'utilisateur voit
 * de toute façon venir — la pilule grandit sous son doigt.
 *
 * LES TENUES ORPHELINES SONT NETTOYÉES. Absorber la voisine lui prend son attaque ; les tenues
 * qu'elle laissait derrière `fin` n'appartiendraient plus à rien, et se liraient comme un
 * prolongement fantôme de la nouvelle note. On les vide.
 */
export function poserCourse(etat, debut, fin) {
    const plat = aplatirCellules(etat);
    const a = Math.max(0, Math.min(plat.length - 1, Math.min(debut, fin)));
    const b = Math.max(0, Math.min(plat.length - 1, Math.max(debut, fin)));
    ecrireColonne(etat, plat, a, ATTAQUE);
    for (let i = a + 1; i <= b; i++) ecrireColonne(etat, plat, i, TENUE);
    for (let i = b + 1; i < plat.length && plat[i].etat === TENUE; i++) ecrireColonne(etat, plat, i, VIDE);
    return etat;
}

/** EFFACE la course qui couvre la colonne globale `i` — le geste « supprimer cette note ». */
export function effacerCourse(etat, i) {
    const course = courseA(etat, i);
    if (!course) return etat;
    const plat = aplatirCellules(etat);
    for (let k = course.debut; k <= course.fin; k++) ecrireColonne(etat, plat, k, VIDE);
    return etat;
}

/**
 * DÉPLACE une course de `delta` colonnes, sans la déformer ni la faire sortir de LA GRILLE.
 *
 * Le glissement est BORNÉ plutôt que refusé quand il pousse contre un bord : une note traînée trop
 * loin se colle au bord et y reste, au lieu de disparaître ou d'ignorer le geste. C'est ce que fait
 * tout séquenceur, et c'est ce qui permet de viser le dernier temps sans précision. La borne est
 * celle de la GRILLE et non de la mesure, depuis qu'une note peut franchir la barre.
 */
export function deplacerCourse(etat, i, delta) {
    const course = courseA(etat, i);
    if (!course) return etat;
    const n = aplatirCellules(etat).length;
    const d = Math.max(-course.debut, Math.min(n - 1 - course.fin, delta));
    if (d === 0) return etat;
    effacerCourse(etat, course.debut);
    poserCourse(etat, course.debut + d, course.fin + d);
    return etat;
}

/**
 * LES MOTIFS TOUT PRÊTS — un clic pose un rythme entier sur toute la grille.
 *
 * POURQUOI ILS EXISTENT. C'est la réponse la plus directe à la phrase qui a fait naître cette
 * fenêtre : « des fois j'ai des difficultés à écrire la partition à cause du rythme ». Poser case
 * par case suppose qu'on sait déjà ce qu'on veut ; partir d'un motif connu et le retoucher suppose
 * seulement qu'on le RECONNAÎT. C'est la différence entre écrire et choisir.
 *
 * ILS SONT DÉFINIS PAR DIVISION, et pas calculés : une même chaîne de cases ne vaut pas la même
 * figure selon la mesure. `x---` sur un temps divisé en quatre vaut une noire en 4/4 ; sur un temps
 * de 6/8 divisé en trois, `x--` vaut une noire POINTÉE. Nommer les motifs juste demande donc de
 * connaître la famille de mesure, exactement comme les libellés de division (voir libelleDivision).
 * Trois familles, deux divisions chacune : six petites tables, lisibles d'un coup d'œil.
 *
 * `cases` : une chaîne d'un caractère par cellule d'UN temps — `x` attaque, `-` tenue, `.` vide.
 * Le motif est répété sur tous les temps de la grille.
 */
const MOTIFS = {
    'simple:4': [
        { texte: 'Noires', cases: 'x---' },
        { texte: 'Croches', cases: 'x-x-' },
        { texte: 'Doubles', cases: 'xxxx' },
        { texte: 'Pointé–bref', cases: 'x--x' },
        { texte: 'Galop', cases: 'x-xx' },
    ],
    'simple:3': [
        { texte: 'Noires', cases: 'x--' },
        { texte: 'Triolets', cases: 'xxx' },
        { texte: 'Swing', cases: 'x-x' },
    ],
    'composee:3': [
        { texte: 'Noires pointées', cases: 'x--' },
        { texte: 'Croches', cases: 'xxx' },
        { texte: 'Noire + croche', cases: 'x-x' },
    ],
    'composee:6': [
        { texte: 'Noires pointées', cases: 'x-----' },
        { texte: 'Croches', cases: 'x-x-x-' },
        { texte: 'Doubles', cases: 'xxxxxx' },
        { texte: 'Noire + croche', cases: 'x---x-' },
    ],
    'irreguliere:2': [
        { texte: 'Croches', cases: 'x-' },
        { texte: 'Doubles', cases: 'xx' },
    ],
    'irreguliere:3': [
        { texte: 'Croches', cases: 'x--' },
        { texte: 'Triolets', cases: 'xxx' },
    ],
};

/** La famille de mesure — celle qui décide des divisions offertes comme des motifs. */
function familleDe(signature) {
    const { battements = 4, unite = 4 } = signature || {};
    if (unite >= 8 && battements % 3 === 0) return 'composee';
    return unite <= 4 ? 'simple' : 'irreguliere';
}

/** Les motifs proposés pour cette signature et cette division — jamais vide en usage normal. */
export function motifsPour(signature, sub) {
    return MOTIFS[`${familleDe(signature)}:${sub}`] || [];
}

/**
 * POSE un motif sur TOUS les temps de la grille, en remplaçant ce qui s'y trouvait.
 *
 * Remplacer et non compléter : un motif est un point de DÉPART, et le mélanger à ce qui traîne
 * donnerait un rythme que personne n'a choisi. « Tout effacer » et un second motif sont à un clic,
 * ce qui rend le geste sans regret.
 */
export function appliquerMotif(etat, cases) {
    const sub = etat.temps[0]?.sub;
    if (!cases || cases.length !== sub) return etat;
    const suite = [...cases].map(ch => (ch === 'x' ? ATTAQUE : ch === '-' ? TENUE : VIDE));
    for (const t of etat.temps) t.cellules = [...suite];
    return etat;
}

/**
 * LA GRILLE QUI CORRESPOND AU RYTHME DÉJÀ ÉCRIT dans `nMesures` mesures de la partition.
 *
 * POURQUOI. L'aide s'ouvrait toujours VIERGE : elle servait à créer un rythme, jamais à en corriger
 * un. Or « ce passage ne tombe pas juste, je voudrais décaler la troisième note » est au moins aussi
 * fréquent que « je pars de rien » — et c'était le seul geste que l'outil ne savait pas rendre.
 * Elle s'ouvre maintenant sur ce qui est écrit, et l'on repart de là.
 *
 * LA DIVISION EST DÉDUITE, pas demandée : on essaie chaque division offerte par la signature (voir
 * subdivisionsPour) et on garde LA PREMIÈRE qui sait exprimer exactement toutes les positions. Un
 * passage en doubles-croches tombe donc en binaire, un passage en triolets en ternaire, sans que
 * personne ait à le dire. Si aucune ne tombe juste — un rythme écrit à la main que la grille ne peut
 * pas représenter — on prend la première et on cale au plus proche : mieux vaut un point de départ
 * approché qu'une grille vide qui fait croire qu'il n'y avait rien.
 *
 * UNE SEULE VOIX, la première : l'aide ne produit qu'une suite de durées et n'a jamais su faire
 * autrement (voir l'en-tête de ui/rythme.js). Lire deux voix pour n'en rendre qu'une mentirait.
 *
 * @returns {object} une grille, vide si les mesures visées le sont.
 */
export function etatDepuisPartition(partition, depart, nMesures, signature) {
    const essai = (sub, tolerant) => {
        const etat = etatInitial(nMesures, signature);
        changerSubdivisionGlobale(etat, sub);
        const plat = aplatirCellules(etat);
        const parMesure = etat.tempsParMesure * etat.unite;
        const absolu = (c) => c.mesure * parMesure + c.debut;
        const debuts = plat.map(absolu);
        const finGrille = nMesures * parMesure;
        /** L'index de la case qui COMMENCE à `x` — ou la plus proche si on tolère l'à-peu-près. */
        const caseA = (x) => {
            let meilleur = -1, ecart = Infinity;
            debuts.forEach((d, i) => { const e = Math.abs(d - x); if (e < ecart - 1e-9) { ecart = e; meilleur = i; } });
            if (ecart > 1e-6 && !tolerant) return -1;
            return meilleur;
        };
        /** La case où s'arrête une note. UNE NOTE PEUT FINIR AU BOUT DE LA GRILLE, et il n'y a alors
         *  aucune case qui commence là : on rend l'index d'APRÈS la dernière, pour que `b - 1`
         *  désigne bien la dernière case. Sans ce cas, la note la plus tardive de la grille perdait
         *  sa dernière case à chaque relecture (mesuré : une course 24-31 relue 24-30). */
        const caseFin = (x) => (Math.abs(x - finGrille) < 1e-6 ? debuts.length : caseA(x));

        // `ouverte` VIT HORS DE LA BOUCLE DES MESURES : une liaison franchit justement la barre,
        // et la remettre à zéro à chaque mesure relisait une note tenue comme deux notes
        // réattaquées (mesuré : une course 14-18 relue en 14-15 puis 16-18).
        let ouverte = -1;
        for (let k = 0; k < nMesures; k++) {
            const mesure = partition.mesures?.[depart + k];
            const evenements = mesure?.voix?.[0]?.evenements || [];
            let position = k * parMesure;
            for (const ev of evenements) {
                const duree = dureeEnNoires(ev.duree);
                // UNE CASE À REMPLIR EST UN RYTHME, pas un silence : c'est justement ce que
                // l'insertion vient de poser, et rouvrir l'aide dessus doit montrer ce rythme-là
                // plutôt qu'une grille vide (sans quoi l'outil ne saurait pas relire son propre
                // travail tant qu'on n'a pas tapé les hauteurs).
                if ((!ev.silence && ev.notes?.length) || ev.aRemplir) {
                    const a = ouverte >= 0 ? ouverte : caseA(position);
                    const b = caseFin(position + duree);
                    if (a < 0 || b < 0) return null;
                    // `b` est la case qui COMMENCE à la fin de la note : elle couvre jusqu'à b-1.
                    poserCourse(etat, a, Math.max(a, b - 1));
                    // UNE LIAISON NE RÉATTAQUE PAS. Sans ce report, une note tenue par-dessus une
                    // barre — ce que l'aide sait maintenant écrire — se relirait en DEUX notes, et
                    // l'aller-retour partition → grille → partition la casserait en deux.
                    ouverte = (ev.lienSuivant || ev.notes.some(n => n.lien === 'tie')) ? a : -1;
                } else {
                    ouverte = -1;
                }
                position += duree;
            }
        }
        return etat;
    };

    for (const sub of subdivisionsPour(signature)) {
        const etat = essai(sub, false);
        if (etat) return etat;
    }
    return essai(subdivisionsPour(signature)[0], true);
}

/**
 * REBÂTIT LA GRILLE — autre longueur, autre division — EN GARDANT LE RYTHME DÉJÀ POSÉ.
 *
 * LE DÉFAUT QUE ÇA CORRIGE, mesuré : changer de division effaçait tout (trois pilules, puis zéro),
 * et passer de une à deux mesures aussi (deux pilules, puis zéro). Vouloir AJOUTER une mesure
 * faisait donc perdre la première, et rien ne prévenait — il n'y a pas d'annulation dans cette
 * fenêtre. Le motif « les cellules repartent vides, un rythme deviné de travers serait pire » se
 * défendait tant que le réglage était par temps ; il ne se défend plus pour un réglage GLOBAL, qu'on
 * touche justement en cours de travail.
 *
 * COMMENT ON GARDE. Une course n'est pas une suite de cases mais un INSTANT et une DURÉE : on la
 * mémorise en noires depuis le début de la grille, on rebâtit, puis on la recale sur la case la plus
 * proche. C'est une REQUANTIFICATION, pas une promesse d'identité — passer d'une grille en quatre à
 * une grille en trois ne peut pas conserver une double-croche, elle n'existe pas là-bas. Ce qui est
 * garanti, c'est qu'aucune note ne disparaît et que l'ordre est respecté ; l'utilisateur rectifie
 * ensuite d'un glissé, ce qui est infiniment moins coûteux que de tout refaire.
 *
 * CE QUI SORT DE LA GRILLE EST PERDU, et c'est le seul cas : raccourcir de quatre mesures à deux
 * jette ce qui vivait dans les mesures 3 et 4. Il n'y a pas d'autre réponse — on ne peut pas garder
 * ce qui n'a plus de place.
 *
 * @param {object} etat la grille actuelle (jamais modifiée).
 * @param {{nMesures?:number, sub?:number}} cible ce qui change.
 * @returns {object} une grille NEUVE.
 */
export function regrillerEtat(etat, { nMesures = etat.nMesures, sub, signature = etat.signature } = {}) {
    const plat = aplatirCellules(etat);
    const parMesure = etat.tempsParMesure * etat.unite;
    const absolu = (c) => c.mesure * parMesure + c.debut;
    // 1. Les courses, en instants absolus : la forme qui survit au changement de grille.
    const gardees = courses(etat).map(({ debut, fin }) => ({
        debut: absolu(plat[debut]),
        fin: absolu(plat[fin]) + plat[fin].duree,
    }));

    // 2. La grille neuve.
    const neuf = etatInitial(nMesures, signature);
    if (sub) changerSubdivisionGlobale(neuf, sub);
    if (!gardees.length) return neuf;

    // 3. Le recalage. `plusProche` rend l'index de la case dont le DÉBUT est le plus près d'un
    //    instant donné — pas celle qui le contient : une attaque aux deux tiers d'un temps est plus
    //    fidèlement rendue par la case qui commence aux trois quarts que par celle qui commence à la
    //    moitié, et c'est bien une attaque qu'on replace.
    const platN = aplatirCellules(neuf);
    // LA NOUVELLE MESURE PEUT ÊTRE PLUS COURTE (un 4/4 devenu 3/4) : les instants se lisent alors sur
    // SA capacité, et ce qui dépassait tombe — il n'y a plus de place pour l'accueillir.
    const parMesureN = neuf.tempsParMesure * neuf.unite;
    const debuts = platN.map(c => c.mesure * parMesureN + c.debut);
    const finGrille = nMesures * parMesureN;
    const plusProche = (x) => {
        let meilleur = 0, ecart = Infinity;
        debuts.forEach((d, i) => { const e = Math.abs(d - x); if (e < ecart - 1e-9) { ecart = e; meilleur = i; } });
        return meilleur;
    };
    for (const c of gardees) {
        if (c.debut >= finGrille - EPS) continue;        // la course ne rentre plus
        const a = plusProche(c.debut);
        // La fin est recalée sur la case qui COMMENCE là où la note s'arrête : la note couvre donc
        // les cases jusqu'à celle d'avant. Au minimum une case, sinon la note disparaîtrait.
        const b = Math.max(a, plusProche(Math.min(c.fin, finGrille)) - 1);
        poserCourse(neuf, a, b);
    }
    return neuf;
}

/**
 * LA COLONNE OÙ TOMBE une position donnée en noires DEPUIS LE DÉBUT DE LA GRILLE — ce dont la tête
 * de lecture a besoin pour allumer la bonne case. Rend `null` hors de la grille.
 */
export function colonneAuTemps(etat, noiresDepuisLeDebut) {
    const parMesure = etat.tempsParMesure * etat.unite;
    const mesure = Math.floor(noiresDepuisLeDebut / parMesure);
    if (mesure < 0 || mesure >= etat.nMesures) return null;
    const dans = noiresDepuisLeDebut - mesure * parMesure;
    const cols = colonnesDeMesure(etat, mesure);
    for (let i = cols.length - 1; i >= 0; i--) {
        if (dans >= cols[i].debut - 1e-9) return { mesure, colonne: i };
    }
    return { mesure, colonne: 0 };
}

/**
 * LA CONVERSION — une suite de cellules devient une suite de FIGURES standard.
 *
 * LA RÈGLE, EN UN MOT : une figure n'a pas le droit de déborder d'un temps sans couvrir le suivant.
 * C'est ce qui fait qu'un lecteur voit encore où tombent les temps, et c'est la règle que suivent
 * MuseScore, Guitar Pro et les éditions imprimées.
 *
 * LE DÉFAUT QU'ELLE CORRIGE, mesuré sur un motif de l'utilisateur. Cette fonction ne regardait que
 * la DURÉE d'une course, jamais sa POSITION : elle demandait à `figuresPour` la plus longue suite de
 * figures qui somme juste, du plus long au plus court. Trois symptômes, tous visibles sur la même
 * mesure de 4/4 :
 *   • un silence d'un seizième puis d'une croche sortait en UN soupir pointé, à cheval sur la barre
 *     du temps 1 et du temps 2 ;
 *   • un silence de cinq seizièmes depuis le dernier seizième du temps 3 sortait en « soupir puis
 *     quart-de-soupir » — les bonnes figures, dans le mauvais ordre, le soupir enjambant le temps 4 ;
 *   • une demi-pause pouvait commencer sur la deuxième double-croche d'un temps.
 * Le correctif ne consiste pas à deviner mieux : il consiste à DONNER la position à la conversion
 * (voir `aplatirCellules`, champ `debut`) et à s'en servir. Pour un silence, la règle d'alignement
 * est déléguée à `figuresSilencePour`, qui la connaît.
 *
 * ET LA RÈGLE N'EST PAS LA MÊME POUR UNE NOTE. Une version de cette feuille l'y a appliquée aussi,
 * et c'était une régression : la syncope la plus banale du répertoire — `croche noire croche noire`,
 * où chaque noire enjambe une barre de temps — en ressortait coupée en croches LIÉES, là où toute
 * édition imprimée écrit une noire. Un silence enjambé cache la métrique et ne dit rien d'autre ;
 * une note enjambée EST la syncope. La position ne sert donc, pour ce qui sonne, qu'à décider OÙ
 * couper quand il faut couper — jamais à interdire une figure qui tombe juste. Voir
 * score.js#figuresSilencePour, qui raconte la mesure de ce défaut.
 *
 * QUATRE CAS, dans cet ordre :
 *
 *   1. LA COURSE COUVRE DES TEMPS ENTIERS (elle part d'un temps et retombe sur un temps). Aucun
 *      nolet n'est nécessaire, même sur des temps ternaires : trois croches de triolet tenues font
 *      une noire, six font une blanche. Le découpeur aligné fait le reste.
 *   2. ELLE TIENT DANS UN SEUL TEMPS. Les figures ordinaires d'abord ; un `nolet` SEULEMENT si
 *      aucune suite de figures ne tombe juste (mesuré — `figuresPour(2/3)` ne rend que 0,625 sur
 *      0,667 demandé, puis renonce). Le critère est la DURÉE, jamais « la grille est en trois » :
 *      une croche dans un temps de 6/8 vaut un tiers de temps et n'est pas un triolet pour autant,
 *      puisque le temps composé se divise en trois par nature. Voir `figureDeNolet`.
 *   3. ELLE SONNE ET UNE SUITE DE FIGURES EXACTE EXISTE. C'est la syncope : on l'écrit telle quelle,
 *      sans regarder où elle commence. Une note tenue de la deuxième croche du temps 1 à la
 *      deuxième croche du temps 2 est UNE noire. Ce cas ne s'applique jamais à un silence.
 *   4. ELLE ENJAMBE PLUSIEURS TEMPS SANS LES COUVRIR. On la coupe en trois : le morceau de tête qui
 *      finit le premier temps, le BLOC de temps entiers, et le morceau de queue. Le bloc central est
 *      traité d'un coup, et c'est ce qui compte : le couper temps par temps rendrait deux soupirs là
 *      où une demi-pause suffit. Les morceaux sont LIÉS quand ils sonnent — c'est ce qu'écrit une
 *      vraie partition.
 *
 * Les frontières de temps se lisent sur `iCell === 0` plutôt que sur une comparaison de flottants :
 * les cellules pavent leur temps exactement, donc la première cellule d'un temps EST la frontière.
 */
/**
 * LA FIGURE ÉCRITE D'UN N-OLET qui doit sonner `total` noires — ou `null` s'il n'y en a pas.
 *
 * LE RAISONNEMENT, et c'est ce qui remplace un ancien « une cellule = croche, deux = noire » qui ne
 * valait qu'en 4/4 sur une grille en trois. Un n-olet `{dans, valent}` fait tenir `dans` figures
 * dans le temps de `valent` : une figure écrite y sonne donc `valent/dans` de sa durée ordinaire.
 * À l'inverse, pour sonner `total`, il faut ÉCRIRE la figure qui vaut `total × dans/valent` — un
 * tiers de temps s'écrit croche en triolet, parce qu'une croche vaut la moitié du temps.
 *
 * Rendre `null` plutôt qu'un à-peu-près quand aucune figure ne tombe juste : l'appelant retombe
 * alors sur le découpage ordinaire, qui écrira au moins une durée honnête.
 */
function figureDeNolet(total, nolet) {
    const plaine = total * (nolet.dans / nolet.valent);
    const figs = figuresPour(plaine);
    if (figs.length !== 1 || Math.abs(dureeEnNoires(figs[0]) - plaine) > 1e-6) return null;
    return { valeur: figs[0].valeur, points: figs[0].points, nolet: { ...nolet } };
}

function figuresDeCourse(cellules, unite, silence = false) {
    if (!cellules.length) return [];
    const EPS = 1e-9;
    const debut = cellules[0].debut;
    const total = cellules.reduce((s, c) => s + c.duree, 0);
    const surTemps = (x) => Math.abs(x / unite - Math.round(x / unite)) < 1e-6;
    const decouper = () => (silence ? figuresSilencePour(total, debut) : figuresPour(total))
        .map(f => ({ ...f, nolet: null }));

    // 1. Des temps entiers : pas de nolet à écrire, même en ternaire.
    if (surTemps(debut) && surTemps(debut + total)) return decouper();

    // 2. Un seul temps. Les figures ordinaires d'abord ; un n-olet SEULEMENT si aucune ne tombe
    //    juste — et c'est la règle générale qui remplace un ancien « si la grille est en trois ».
    const dernier = cellules[cellules.length - 1];
    if (cellules.every(c => c.iTemps === cellules[0].iTemps)) {
        const figs = decouper();
        const somme = figs.reduce((t, f) => t + dureeEnNoires(f), 0);
        if (figs.length && Math.abs(somme - total) < 1e-6) return figs;
        const nolet = figureDeNolet(total, T3);
        if (nolet) return [nolet];
        return figs;
    }

    // 3. Ce qui SONNE et tombe juste s'écrit tel quel : c'est la syncope, et elle ne se lie pas.
    if (!silence) {
        const figs = figuresPour(total);
        const somme = figs.reduce((t, f) => t + dureeEnNoires(f), 0);
        if (figs.length && Math.abs(somme - total) < 1e-6) return figs.map(f => ({ ...f, nolet: null }));
    }

    // 4. À cheval sur plusieurs temps : tête, bloc de temps entiers, queue.
    const frontieres = [];
    cellules.forEach((c, k) => { if (c.iCell === 0) frontieres.push(k); });
    // Une course qui enjambe des temps en contient forcément au moins une (la première cellule d'un
    // temps) ; ce garde-fou n'existe que pour ne pas risquer une récursion sans fin si cette
    // invariante venait à être cassée par un appelant.
    if (!frontieres.length) return decouper();

    const sortie = [];
    const iBloc = frontieres[0];
    if (iBloc > 0) sortie.push(...figuresDeCourse(cellules.slice(0, iBloc), unite, silence));

    // Le bloc s'arrête à la dernière cellule qui CLÔT son temps.
    let kBloc = cellules.length;
    if (dernier.iCell !== dernier.sub - 1) kBloc = frontieres[frontieres.length - 1];
    if (kBloc > iBloc) sortie.push(...figuresDeCourse(cellules.slice(iBloc, kBloc), unite, silence));
    if (kBloc < cellules.length) sortie.push(...figuresDeCourse(cellules.slice(kBloc), unite, silence));
    return sortie;
}

/**
 * LE RYTHME EN ÉVÈNEMENTS, mesure par mesure — ce que l'insertion posera dans la partition.
 *
 * @param {object} etat voir etatInitial.
 * @param {{corde?:number, aRemplir?:boolean}} options `aRemplir` marque les évènements comme
 *   « en attente d'une case » (voir model/score.js) ; `corde` sert à l'aperçu, où il faut bien une
 *   note pour qu'une tête se dessine — la partition jetable n'est pas destinée à être jouée sur un
 *   manche, seulement lue.
 * @returns {Array<Array<object>>} un tableau d'évènements par mesure.
 */
export function evenementsParMesure(etat, options = {}) {
    const { corde = 2, frette = 0, aRemplir = false, avecNotes = true } = options;
    const plat = aplatirCellules(etat);
    const parMesure = Array.from({ length: etat.nMesures }, () => []);

    /** Une figure posée dans sa mesure. `lie` : elle se prolonge dans la figure suivante. */
    const poser = (mesure, figure, lie) => {
        const notes = avecNotes ? [creerNote(corde, frette, lie ? { lien: 'tie' } : {})] : [];
        parMesure[mesure].push(creerEvenement(figure, notes, {
            silence: !avecNotes,
            // `lienSuivant` PORTE LA LIAISON QUAND IL N'Y A PAS DE NOTE POUR LA PORTER. Une
            // insertion pose des cases à remplir (`avecNotes: false`), donc des évènements SANS
            // note — et une liaison vit sur la note, pas sur l'évènement. Sans ce champ, une note
            // liée insérée puis remplie ressortait en DEUX notes distinctes au lieu d'une tenue
            // (voir edit/commands.js#saisirChiffre, qui le lit pour remplir tout le groupe d'un
            // seul chiffre).
            ...(lie ? { lienSuivant: true } : {}),
            ...(aRemplir ? { aRemplir: true } : {}),
        }));
    };

    let i = 0;
    while (i < plat.length) {
        const depart = plat[i];
        if (depart.etat === VIDE) {
            // UN SILENCE NE FRANCHIT JAMAIS LA BARRE : on l'arrête à la mesure, là où une note a
            // désormais le droit de continuer. Un silence sert à montrer la métrique ; l'étendre
            // par-dessus une barre la cacherait, et la barre est la métrique la plus forte de toutes.
            let n = 1;
            while (i + n < plat.length && plat[i + n].etat === VIDE && plat[i + n].mesure === depart.mesure) n++;
            for (const f of figuresDeCourse(plat.slice(i, i + n), etat.unite, true)) {
                parMesure[depart.mesure].push(creerEvenement(f, [], { silence: true }));
            }
            i += n;
        } else {
            // Une attaque, prolongée par toutes les `tenue` qui suivent — barres comprises.
            let n = 1;
            while (i + n < plat.length && plat[i + n].etat === TENUE) n++;
            const course = plat.slice(i, i + n);
            // DÉCOUPÉE PAR MESURE : aucune figure ne peut être à cheval sur une barre, donc une
            // course qui la franchit devient une figure par mesure, et elles sont LIÉES. Les
            // positions que `figuresDeCourse` lit (`debut`) sont relatives à LA MESURE, ce qui
            // n'aurait aucun sens sur une tranche à cheval.
            const tranches = [];
            for (let k = 0; k < course.length;) {
                let j = k + 1;
                while (j < course.length && course[j].mesure === course[k].mesure) j++;
                tranches.push(course.slice(k, j));
                k = j;
            }
            tranches.forEach((tranche, it) => {
                const figs = figuresDeCourse(tranche, etat.unite);
                const derniere = it === tranches.length - 1;
                figs.forEach((f, k) => {
                    // Plusieurs figures pour une seule note : elles sont LIÉES, sauf la toute dernière
                    // de la toute dernière tranche.
                    poser(tranche[0].mesure, f, !(derniere && k === figs.length - 1));
                });
            });
            i += n;
        }
    }
    return parMesure;
}

/**
 * OÙ TROUVER LA TONIQUE DU MORCEAU SUR LE MANCHE — la case que l'aperçu fera sonner.
 *
 * POURQUOI PAS UNE HAUTEUR FIXE. L'aperçu posait toutes ses notes sur la corde 2 case 0, une hauteur
 * arbitraire : le rythme se lisait bien, mais s'ÉCOUTAIT à côté du morceau. Retour utilisateur :
 * « je propose que la note retenue dans le séquenceur soit la tonique de la tonalité choisie pour le
 * morceau, ça sera plus logique ». Sur la tonique, la boucle du séquenceur sonne comme une pédale du
 * morceau, et le rythme s'entend DANS sa tonalité.
 *
 * COMMENT ON CHOISIT LA CASE. On cherche la tonique dans l'octave la plus CONFORTABLE du manche —
 * cases 0 à 4, là où se joue une position ouverte — et, à défaut, n'importe où jusqu'à la case 12.
 * Entre plusieurs candidates on prend la plus GRAVE : une pédale se joue en bas, et une tonique
 * aiguë sur la chanterelle sonnerait comme une mélodie.
 *
 * L'ACCORDAGE EST CELUI DU MORCEAU, capo compris : c'est ce qui fait que la note tombe vraiment sur
 * la tonique, et non sur ce qu'elle serait en accordage standard.
 *
 * @returns {{corde:number, frette:number}} jamais `null` : à défaut de tonique trouvable (accordage
 *   vide, instrument sans manche), la corde du milieu à vide — l'ancien comportement, qui a le mérite
 *   de toujours produire une tête de note à lire.
 */
export function caseDeLaTonique(partition, iMesure = 0) {
    const accordage = partition?.piste?.accordage;
    const cordes = accordage?.cordes || [];
    const secours = { corde: Math.min(2, Math.max(0, cordes.length - 1)), frette: 0 };
    if (!cordes.length) return secours;

    const tonalite = tonaliteDe(armureEffective(partition, iMesure), modeEffectif(partition, iMesure));
    // La tonique est écrite en notation internationale avec ses signes typographiques (« E♭ »,
    // « F♯ ») : on la ramène à une CLASSE DE HAUTEUR, seule chose qui compte pour trouver une case.
    const m = String(tonalite.tonique).match(/^([A-G])([♯♭#b]?)$/);
    if (!m) return secours;
    const pc = (LETTRE_VERS_PC[m[1]] + (m[2] === '♯' || m[2] === '#' ? 1 : m[2] === '♭' || m[2] === 'b' ? -1 : 0) + 12) % 12;

    const capo = partition?.piste?.capo || 0;
    const candidates = [];
    for (let corde = 0; corde < cordes.length; corde++) {
        for (let frette = 0; frette <= 12; frette++) {
            const midi = hauteurDeCase(accordage, corde, frette, capo);
            if (midi == null) continue;
            if (((midi % 12) + 12) % 12 === pc) candidates.push({ corde, frette, midi });
        }
    }
    if (!candidates.length) return secours;
    // Position ouverte d'abord (cases 0 à 4), puis la plus grave.
    const ouvertes = candidates.filter(c => c.frette <= 4);
    const lot = ouvertes.length ? ouvertes : candidates;
    lot.sort((a, b) => a.midi - b.midi);
    return { corde: lot[0].corde, frette: lot[0].frette };
}

/**
 * LA PARTITION JETABLE de l'aperçu — celle qu'on donne au moteur de gravure et au lecteur.
 *
 * TOUTES LES NOTES SUR LA MÊME HAUTEUR, et c'est voulu : l'aide ne parle que de rythme. Une position
 * fixe ne se LIT pas comme une hauteur, ce qui est précisément l'effet cherché — et c'est une
 * constante au lieu d'une table par clé.
 */
export function partitionApercu(etat, source, ternaire = false) {
    // `source` accepte le MORCEAU (ce que fait l'application) ou un simple identifiant d'instrument
    // (ce dont un banc a besoin pour éprouver la conversion sans fabriquer un morceau entier).
    const morceau = (source && typeof source === 'object' && source.piste) ? source : null;
    const instrumentId = morceau ? morceau.piste.instrument : source;
    const p = creerPartition(instrumentId);
    p.meta.titre = '';
    p.meta.ternaire = !!ternaire;
    // L'ACCORDAGE DU MORCEAU, CAPO COMPRIS. Sans lui, la case choisie plus bas sonnerait la hauteur
    // qu'elle aurait en accordage standard : sur un morceau en Drop D, l'aperçu s'entendrait un ton
    // au-dessus de ce qu'il va vraiment jouer.
    if (morceau) p.piste = { ...morceau.piste, accordage: { ...morceau.piste.accordage } };
    // LA TONIQUE DU MORCEAU plutôt qu'une hauteur arbitraire : la boucle du séquenceur sonne alors
    // comme une pédale de la tonalité, et le rythme s'écoute DANS le morceau (voir caseDeLaTonique).
    const { corde, frette } = morceau ? caseDeLaTonique(morceau) : { corde: 2, frette: 0 };
    const parMesure = evenementsParMesure(etat, { avecNotes: true, corde, frette });
    p.mesures = parMesure.map((evenements, i) => {
        const m = creerMesure({ voix: [{ evenements }] });
        if (i === 0) m.signature = { ...etat.signature };
        return m;
    });
    return p;
}

/** Le rythme est-il entièrement vide ? Une aide qui proposerait d'insérer quatre mesures de silence
 *  ferait perdre du temps à qui a cliqué sans le vouloir. */
export function estVide(etat) {
    return etat.temps.every(t => t.cellules.every(c => c === VIDE));
}

/** Chaque mesure somme-t-elle EXACTEMENT sa capacité ? Un garde-fou de développement : la grille est
 *  construite pour que ce soit toujours vrai (les cellules d'un temps couvrent le temps), mais une
 *  règle de conversion fautive se verrait ici avant d'atteindre la partition. */
export function mesuresJustes(etat) {
    const attendu = etat.tempsParMesure * etat.unite;
    return evenementsParMesure(etat, { avecNotes: true }).map(
        evs => Math.abs(evs.reduce((s, e) => s + dureeEnNoires(e.duree), 0) - attendu) < 1e-6);
}

// ---------------------------------------------------------------------------------------------
// DÉDUIRE LA GRILLE PLUTÔT QUE LA CLIQUER — ce dont l'import MIDI a besoin (voir io/midi.js)
//
// Dans l'aide rythmique, c'est l'utilisateur qui dit « ce temps est un triolet ». À l'import,
// personne ne le dit : il faut le LIRE dans les attaques du fichier. Le reste — la conversion en
// figures — est rigoureusement le même code, et c'est tout l'intérêt de l'avoir mis ici.
// ---------------------------------------------------------------------------------------------

/**
 * L'ORDRE DE PRÉFÉRENCE quand deux subdivisions expliquent le temps aussi bien : 2, 4, 8, puis 3.
 *
 * Ce n'est PAS la liste de `subdivisionsPour` (les choix OFFERTS), et la différence compte.
 * Deux croches se lisent aussi bien sur une grille en deux que sur une grille en quatre : autant
 * prendre la plus simple. Et le TRIOLET vient en dernier parce qu'une erreur y coûte le plus cher —
 * un triolet inventé là où le musicien a joué deux doubles un peu tard défigure la partition, alors
 * qu'une double inventée à la place d'un triolet reste une approximation lisible.
 */
const PREFERENCE_SUB = [2, 4, 8, 3];

/**
 * Le triolet doit expliquer le temps DEUX FOIS MIEUX que la meilleure lecture binaire pour être
 * retenu. Sans cette marge, le moindre retard de jeu sur une double-croche basculerait le temps en
 * triolet — et un morceau entier se retrouverait constellé de « 3 » qui n'y sont pas.
 */
const MARGE_TRIOLET = 0.5;

/**
 * La TRIPLE-CROCHE (grille en huit) doit, elle aussi, expliquer le temps DEUX FOIS mieux que la
 * meilleure grille plus grossière.
 *
 * LA RAISON EST ARITHMÉTIQUE, pas musicale : une grille plus fine explique TOUJOURS au moins aussi
 * bien, par construction — ses cellules contiennent celles de la grille plus grossière. Retenir la
 * grille en huit dès qu'elle fait « un peu mieux » reviendrait donc à la retenir presque toujours,
 * et un morceau joué à la main ressortirait constellé de triples-croches. La marge fait la
 * différence entre « ce musicien a joué des triples-croches » et « ce musicien a joué des doubles
 * un peu inégalement ».
 */
const MARGE_FINESSE = 0.5;

/**
 * La subdivision (2, 3 ou 4) qui explique le mieux ces attaques dans un temps de `duree` noires
 * commençant à `debut`.
 *
 * L'ERREUR MESURÉE est la somme des écarts entre chaque attaque et la cellule la plus proche,
 * ramenée en fraction de temps : c'est ce qu'on « perd » en écrivant le temps sur cette grille.
 * Une grille qui tombe juste donne zéro, et c'est le cas courant d'un fichier produit par un
 * séquenceur — la question ne devient intéressante que sur du jeu réel.
 *
 * @param {number[]} attaques positions absolues, en noires, des attaques tombant dans ce temps.
 * @returns {number} 2, 3, 4 ou 8.
 */
export function subdivisionPour(attaques, debut, duree) {
    if (!(duree > 0) || !attaques.length) return 2;
    const erreurDe = (sub) => {
        const cellule = duree / sub;
        return attaques.reduce((total, x) => {
            const phase = x - debut;
            return total + Math.abs(phase - Math.round(phase / cellule) * cellule) / duree;
        }, 0) / attaques.length;
    };
    const erreurs = new Map(PREFERENCE_SUB.map(sub => [sub, erreurDe(sub)]));
    // La plus simple des deux grilles binaires ordinaires qui tombe aussi juste que l'autre.
    let binaire = erreurs.get(2) <= erreurs.get(4) + 1e-9 ? 2 : 4;
    // La grille en HUIT ne se retient que si elle explique deux fois mieux (voir MARGE_FINESSE) —
    // sans cette marge, elle gagnerait presque toujours, par simple arithmétique.
    if (erreurs.get(8) < erreurs.get(binaire) * MARGE_FINESSE - 1e-12) binaire = 8;
    // Le triolet, seulement s'il explique VRAIMENT mieux que la meilleure binaire retenue.
    if (erreurs.get(3) < erreurs.get(binaire) * MARGE_TRIOLET - 1e-12) return 3;
    return binaire;
}

/**
 * LES SUBDIVISIONS QU'UNE GRILLE PEUT PRENDRE, de la plus grossière à la plus fine.
 *
 * Elles couvrent les trois familles qu'une tablature écrit vraiment : les puissances de deux (2, 4,
 * 8, 16 — jusqu'à la TRIPLE-CROCHE, qui vaut le huitième d'une noire), les tiers (3, 6, 12 — le
 * triolet de croches, de doubles, de triples), et le 1 pour un temps qu'aucune frontière ne coupe.
 * L'ordre compte : `grilleDeMesure` prend la PREMIÈRE qui convient, donc toujours la plus grossière,
 * celle qui laisse à la conversion le plus de liberté pour écrire une figure longue.
 */
const SUBS_GRILLE = [1, 2, 3, 4, 6, 8, 12, 16];

/**
 * LA GRILLE D'UNE MESURE, DÉDUITE DE CE QU'ELLE PORTE DÉJÀ — et c'est tout le principe.
 *
 * LE PROBLÈME QU'ELLE RÉSOUT, et il était mesurable. Écrire trois croches en triolet dans un 4/4
 * laissait la mesure à 3,875 noires au lieu de 4 : le temps restant était rendu par
 * `score.js#figuresPour`, qui ne cherche que des figures BINAIRES, et il n'en existe aucune suite
 * qui somme un tiers de temps (mesuré : `figuresPour(2/3)` ne rend que 0,625). La boucle abandonnait
 * le reliquat en silence, un vingt-quatrième de temps à chaque fois. Douze croches en triolet — un
 * temps de swing ordinaire — faisaient déborder la mesure de presque un temps entier.
 *
 * LA CAUSE N'EST PAS LE DÉCOUPEUR, C'EST SON AVEUGLEMENT. Une durée ne se laisse écrire qu'en
 * fonction de la grille sur laquelle elle tombe : un tiers de temps est une croche de TRIOLET, pas
 * une approximation de croche. Il faut donc DONNER la grille à la conversion, et cette grille ne
 * peut pas être décrétée d'avance — elle dépend de ce que la mesure contient déjà.
 *
 * LA RÈGLE, temps par temps : la plus GROSSIÈRE subdivision sur laquelle tombent toutes les
 * frontières présentes dans ce temps. Un temps qui ne porte que des doubles-croches est en 4 ; un
 * temps qui porte un triolet est en 3 ; un temps qui porte une triple-croche est en 8 ; un temps
 * vide est en 1. Chaque temps a la sienne — un 4/4 peut parfaitement porter un triolet sur le temps
 * 2 et des triples-croches sur le temps 4, et c'est exactement ce que fait une tablature de blues.
 *
 * `positionsEnPlus` : les frontières qui n'existent pas encore mais qu'on s'apprête à créer (le
 * début et la fin du silence qu'on va écrire). Sans elles, la grille ignorerait précisément la
 * position qui motive l'appel.
 *
 * LA MESURE PEUT ÊTRE PLUS LONGUE QUE SA CAPACITÉ, et la grille la couvre quand même : une mesure
 * momentanément fausse (signature changée après coup, fichier importé) doit pouvoir rendre ses
 * silences comme les autres, plutôt que de voir sa fin tomber hors grille.
 *
 * @param {{battements:number, unite:number}} signature
 * @param {Array<{duree:object}>} evenements ce que la voix porte déjà
 * @param {number[]} positionsEnPlus frontières à honorer en plus, en noires depuis la barre
 * @returns {Array<{debut:number, debutDansMesure:number, duree:number, mesure:number, sub:number}>}
 */
export function grilleDeMesure(signature, evenements = [], positionsEnPlus = []) {
    const unite = uniteDeGroupement(signature) || 1;
    const bornes = [];
    let t = 0;
    for (const e of evenements) { bornes.push(t); t += dureeEnNoires(e.duree); }
    bornes.push(t);
    for (const p of positionsEnPlus) if (Number.isFinite(p)) bornes.push(p);

    const longueur = Math.max(noiresParMesure(signature), ...bornes);
    const nTemps = Math.max(1, Math.ceil(longueur / unite - 1e-9));

    const temps = [];
    for (let i = 0; i < nTemps; i++) {
        const debut = i * unite;
        // Les frontières STRICTEMENT à l'intérieur du temps : ses deux bords tombent sur n'importe
        // quelle subdivision, ils ne contraignent donc rien.
        const dedans = bornes.filter(p => p > debut + 1e-9 && p < debut + unite - 1e-9);
        const sub = SUBS_GRILLE.find(s => dedans.every(p => {
            const k = (p - debut) / (unite / s);
            return Math.abs(k - Math.round(k)) < 1e-6;
        })) ?? SUBS_GRILLE[SUBS_GRILLE.length - 1];
        temps.push({ debut, debutDansMesure: debut, duree: unite, mesure: 0, sub });
    }
    return temps;
}

/**
 * LES ÉVÈNEMENTS DE SILENCE pour `duree` noires à partir de `debut` dans une mesure — écrits sur la
 * grille que cette mesure impose réellement (voir grilleDeMesure), donc justes en triolet comme en
 * triple-croche, et alignés sur les temps comme le ferait un copiste.
 *
 * C'est le remplaçant de `score.js#decouperEnEvenements` PARTOUT OÙ LA POSITION EST CONNUE — et
 * elle l'est presque toujours dans l'éditeur, qui sait exactement où il rend du temps.
 *
 * REND `null` PLUTÔT QU'UN À-PEU-PRÈS quand la conversion ne tombe pas juste au millionième. Un
 * silence qui ne somme pas ce qu'on lui a demandé est précisément le défaut que cette fonction
 * existe pour supprimer : mieux vaut que l'appelant retombe sur l'ancien découpage, dont on connaît
 * les limites, que d'introduire une erreur silencieuse d'un genre nouveau. Le banc `rythme_juste`
 * vérifie que ce repli ne sert jamais dans les cas qui motivent cette fonction.
 */
export function silencesAlignes(signature, evenements, debut, duree) {
    if (!(duree > EPS)) return [];
    const temps = grilleDeMesure(signature, evenements, [debut, debut + duree]);
    const juste = (figs) => figs && figs.length
        && Math.abs(figs.reduce((s, f) => s + dureeEnNoires(f), 0) - duree) < 1e-6;

    // D'ABORD la conversion de l'aide rythmique, qui sait regrouper des temps ENTIERS en une seule
    // figure longue (trois temps rendus donnent « noire + blanche », pas trois soupirs).
    let figs = figuresSurGrille(temps, debut, debut + duree, true);
    // SINON, cellule par cellule sur la grille déduite. Ce repli existe pour les cas que la
    // conversion ne sait pas nommer d'une seule figure — mesuré sur les 5/6 de temps qui suivent un
    // triolet de DOUBLES, qu'elle rendait vides. Il écrit toujours quelque chose de juste, parfois
    // avec une figure de plus que le strict nécessaire ; une figure de trop se lit, un temps
    // manquant s'entend.
    if (!juste(figs)) figs = _silencesParCellules(temps, debut, debut + duree);
    if (!juste(figs)) return null;
    return figs.map(f => creerEvenement(
        { valeur: f.valeur, points: f.points || 0, nolet: f.nolet ? { ...f.nolet } : null },
        [], { silence: true }));
}

/**
 * LA FIGURE UNIQUE qui vaut exactement `total` noires, ou `null` — ordinaire d'abord, en n-olet
 * ensuite.
 *
 * JAMAIS DE POINT, dans les deux cas : un silence pointé n'a sa place qu'à l'intérieur d'un temps
 * composé, où il complète le temps ; ailleurs il enjambe et brouille la métrique (c'est la règle que
 * `score.js#figuresSilencePour` applique déjà, et qui vaut ici pour la même raison). Le refuser
 * n'empêche rien : l'appelant essaie simplement une course plus courte, et écrit deux figures
 * alignées là où une pointée aurait été à cheval.
 */
function _figureSilenceDe(total) {
    const figs = figuresPour(total);
    if (figs.length === 1 && !figs[0].points && Math.abs(dureeEnNoires(figs[0]) - total) < 1e-9) {
        return { valeur: figs[0].valeur, points: 0, nolet: null };
    }
    const n = figureDeNolet(total, T3);
    return n && !n.points ? n : null;
}

/**
 * LES SILENCES D'UNE COURSE, CELLULE PAR CELLULE sur la grille déduite — le repli de
 * `silencesAlignes`.
 *
 * LA RÈGLE, à chaque pas : la plus LONGUE course de cellules entières qui (1) ne sorte pas du temps
 * courant, (2) s'écrive d'une seule figure sans point, et (3) commence sur une position multiple de
 * sa propre durée DEPUIS LE DÉBUT DU TEMPS. Les trois conditions ensemble sont la règle de gravure
 * ordinaire, simplement appliquée à une grille qui peut être en trois ou en huit plutôt qu'en deux.
 *
 * On ne franchit jamais une frontière de temps : c'est ce qui garantit qu'un silence ne masque pas
 * la pulsation, et ça évite d'avoir à raisonner sur deux subdivisions différentes dans la même
 * figure — deux temps voisins peuvent parfaitement être l'un en trois et l'autre en huit.
 */
function _silencesParCellules(temps, debut, fin) {
    if (!temps.length) return null;
    const sortie = [];
    let x = debut;
    let garde = 0;
    while (x < fin - EPS && garde++ < 4096) {
        const t = temps[tempsA(temps, x)];
        const cellule = t.duree / t.sub;
        const finTemps = Math.min(fin, t.debut + t.duree);
        const maxCell = Math.round((finTemps - x) / cellule);
        let posee = null;
        for (let n = maxCell; n >= 1; n--) {
            const total = n * cellule;
            const k = (x - t.debut) / total;
            if (Math.abs(k - Math.round(k)) > 1e-6) continue;   // départ non aligné sur cette durée
            const f = _figureSilenceDe(total);
            if (f) { posee = f; x += total; break; }
        }
        if (!posee) return null;
        sortie.push(posee);
    }
    return sortie;
}

/**
 * Construit la grille des TEMPS d'un morceau à partir de ses mesures — une entrée par temps, avec sa
 * position, sa durée et la subdivision qu'on lui donnera.
 *
 * `unite: duree` de chaque temps vient de `uniteDeGroupement` (la noire en 4/4, la noire pointée en
 * 6/8) : la même unité que les ligatures, le métronome et la lecture ternaire. La grille est ainsi
 * la MÊME notion de « temps » partout dans l'application.
 *
 * @param {Array<{debut:number, capacite:number, signature:object}>} mesures
 * @returns {Array<{debut:number, duree:number, mesure:number, sub:number}>}
 */
export function grilleDesTemps(mesures) {
    const temps = [];
    mesures.forEach((m, i) => {
        const duree = uniteDeGroupement(m.signature);
        const n = Math.max(1, Math.round(m.capacite / duree));
        // `debutDansMesure` en plus de `debut` (absolu dans le morceau) : c'est la position
        // RELATIVE À LA MESURE que réclament les découpeurs alignés (voir figuresSurGrille et
        // score.js#figuresSilencePour) — la règle de gravure se compte depuis la barre de mesure,
        // pas depuis le début du morceau.
        for (let t = 0; t < n; t++) {
            temps.push({ debut: m.debut + t * duree, debutDansMesure: t * duree, duree, mesure: i, sub: 2 });
        }
    });
    return temps;
}

/** L'index du temps qui contient `position` — le dernier si la position dépasse le morceau. */
function tempsA(temps, position) {
    for (let i = 0; i < temps.length; i++) if (position < temps[i].debut + temps[i].duree - EPS) return i;
    return Math.max(0, temps.length - 1);
}

/**
 * CALE une position sur la grille : le bord de cellule le plus proche, dans le temps où elle tombe.
 *
 * C'est ici que se joue la qualité du rythme importé. L'ancienne version calait tout sur une grille
 * PLATE de double-croches, la même du début à la fin : un triolet de croches (des tiers de temps) y
 * tombait sur 0, 1/4 et 3/4 — double, croche, double. Faux, et faux d'une manière qui ne se corrige
 * pas à la main sans tout réécrire. Une grille dont chaque temps porte SA subdivision place le même
 * triolet exactement.
 */
export function callerSurGrille(temps, position) {
    if (!temps.length) return position;
    const t = temps[tempsA(temps, position)];
    const cellule = t.duree / t.sub;
    const phase = Math.round((position - t.debut) / cellule) * cellule;
    return t.debut + phase;
}

/**
 * Les FIGURES d'une note (ou d'un silence) qui court de `debut` à `fin` sur cette grille — par la
 * MÊME conversion que l'aide rythmique (voir figuresDeCourse), nolets compris.
 *
 * Les deux bornes sont supposées DÉJÀ calées (voir callerSurGrille) : cette fonction ne devine rien,
 * elle traduit. Une durée nulle ou négative ne rend rien — à l'appelant de ne pas poser d'évènement.
 */
export function figuresSurGrille(temps, debut, fin, silence = false) {
    if (!(fin > debut + EPS)) return [];
    const cellules = [];
    let x = debut;
    let garde = 0;
    while (x < fin - EPS && garde++ < 4096) {
        const iTemps = tempsA(temps, x);
        const t = temps[iTemps];
        const cellule = t.duree / t.sub;
        const iCell = Math.max(0, Math.min(t.sub - 1, Math.round((x - t.debut) / cellule)));
        // `debut` — la position DANS LA MESURE, ce que la conversion exige pour aligner ses figures
        // sur les temps. Sans elle, l'import écrivait les mêmes silences à cheval que l'aide
        // rythmique : même conversion, donc même défaut (voir figuresDeCourse).
        cellules.push({ iTemps, iCell, mesure: t.mesure, sub: t.sub, etat: ATTAQUE, duree: cellule,
                        debut: (t.debutDansMesure ?? 0) + iCell * cellule });
        x += cellule;
    }
    const unite = temps[tempsA(temps, debut)]?.duree || 1;
    return figuresDeCourse(cellules, unite, silence);
}

/** Tolérance de phase pour reconnaître un tiers de temps : un vingtième de temps de part et
 *  d'autre. Assez large pour du jeu humain, assez étroite pour ne pas confondre 1/3 et 1/4
 *  (écartés de 1/12 ≈ 0,083 — plus du triple). */
const TOLERANCE_PHASE = 0.05;

/** Le bord de cellule qui suit STRICTEMENT `position` — pour ne jamais poser d'évènement de durée
 *  nulle quand une note très brève s'est calée sur son propre départ. */
export function bordSuivant(temps, position) {
    if (!temps.length) return position;
    const t = temps[tempsA(temps, position)];
    const cellule = t.duree / t.sub;
    return t.debut + (Math.floor((position - t.debut) / cellule + EPS) + 1) * cellule;
}

/**
 * LE MORCEAU A-T-IL L'AIR SWINGUÉ ? Une réponse PROPOSÉE, jamais imposée : elle ne sert qu'à
 * pré-cocher la question posée à l'import (voir main.js#chargerFichierMidi). Se tromper coûte donc
 * un clic, pas une partition — et c'est ce qui autorise une heuristique plutôt qu'une certitude.
 *
 * CE QU'ON COMPTE, temps par temps, parmi ceux qui portent au moins une attaque HORS du temps :
 *   - SWING    : une attaque aux deux tiers du temps, et AUCUNE au premier tiers. C'est la signature
 *                exacte de la paire longue-brève : on joue le temps, puis le dernier tiers.
 *   - TRIOLET  : des attaques aux DEUX tiers. Trois notes égales par temps — un vrai triolet écrit,
 *                pas du swing, et il faut surtout ne pas le « dé-swinguer » : ses trois notes
 *                deviendraient double, double, croche, ce qui est faux.
 *   - BINAIRE  : tout le reste (la croche à la moitié, les doubles aux quarts).
 * Le morceau est déclaré ternaire quand le swing DOMINE, et qu'il y en a assez pour que ce ne soit
 * pas un accident : deux temps swingués sur un morceau de quarante ne disent rien.
 *
 * @param {Array<{debut:number, duree:number}>} temps la grille des temps.
 * @param {number[]} attaques positions absolues des attaques, en noires.
 * @returns {{ternaire:boolean, swing:number, binaire:number, triolet:number}}
 */
export function detecterSwing(temps, attaques) {
    const parTemps = new Map();
    for (const x of attaques) {
        const i = tempsA(temps, x);
        const t = temps[i];
        const phase = (x - t.debut) / t.duree;
        if (phase < TOLERANCE_PHASE || phase > 1 - TOLERANCE_PHASE) continue;   // sur le temps : muet
        if (!parTemps.has(i)) parTemps.set(i, []);
        parTemps.get(i).push(phase);
    }
    let swing = 0, binaire = 0, triolet = 0;
    for (const phases of parTemps.values()) {
        const pres = (cible) => phases.some(p => Math.abs(p - cible) <= TOLERANCE_PHASE);
        const tiers = pres(1 / 3), deuxTiers = pres(2 / 3);
        if (deuxTiers && !tiers) swing++;
        else if (deuxTiers && tiers) triolet++;
        else binaire++;
    }
    return { ternaire: swing >= 2 && swing > binaire && swing >= triolet, swing, binaire, triolet };
}

/**
 * Donne à CHAQUE temps de la grille la subdivision que ses attaques réclament — la version
 * automatique du clic sur l'en-tête d'un temps dans l'aide rythmique. Modifie la grille en place.
 *
 * Un temps sans aucune attaque garde la subdivision la plus simple : rien à y écrire, et une grille
 * en quatre sur un temps vide n'apporterait qu'un silence découpé plus finement que nécessaire.
 */
export function deduireSubdivisions(temps, attaques) {
    const parTemps = new Map();
    for (const x of attaques) {
        const i = tempsA(temps, x);
        if (!parTemps.has(i)) parTemps.set(i, []);
        parTemps.get(i).push(x);
    }
    temps.forEach((t, i) => { t.sub = subdivisionPour(parTemps.get(i) || [], t.debut, t.duree); });
    return temps;
}
