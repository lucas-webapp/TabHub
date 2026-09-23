// Moteur de mise en page : partition (modèle) → LISTE D'AFFICHAGE (primitives géométriques).
//
// L'IDÉE CENTRALE : CE MODULE NE DESSINE RIEN. Il produit une liste de primitives neutres — lignes,
// chemins, textes, polygones — exprimées en coordonnées de page. Deux moteurs de rendu la consomment
// ensuite : le SVG pour l'écran (render/svg.js) et jsPDF pour l'export (render/pdf.js).
//
// C'est ce qui garantit que LE PDF EST EXACTEMENT CE QU'ON VOIT. L'approche courante — rastériser
// l'écran avec html2canvas, comme le fait HarmoHub pour sa grille d'accords — convenait à une grille
// d'accords faite de blocs et de texte ; elle donnerait ici une partition floue et un fichier lourd,
// alors qu'une partition est par nature du trait fin. En passant par une liste d'affichage, le PDF
// sort en VECTORIEL, net à n'importe quel zoom, et sans qu'aucune règle de mise en page n'ait à être
// écrite deux fois — la seule façon fiable d'éviter que les deux sorties divergent avec le temps.
//
// La liste s'accompagne d'ANCRAGES : où se trouve chaque évènement et chaque mesure à l'écran. Ils
// servent au curseur d'édition, au clic pour se positionner, et à la tête de lecture. Ce sont les
// mêmes données que celles qui ont servi à poser les notes, donc le curseur ne peut pas se décaler
// de ce qui est dessiné.

import * as G from './glyphs.js';
import { dureeEnNoires, crochetsDe, uniteDeGroupement, noiresParMesure } from '../model/duration.js';
import {
    signatureEffective, armureEffective, modeEffectif, positionDansMesure, hauteurDeNote, nbCordes, REPERES,
} from '../model/score.js';
import { ecrireHauteur, hauteurDepuisPas, alterationsDeLArmure, NOMS_LETTRES, tonaliteDe } from '../model/theory.js';
import { INSTRUMENTS } from '../model/instruments.js';

// ---------------------------------------------------------------------------------------------
// Géométrie de référence, en interlignes de portée (`S`). Tout le reste en découle : changer `S`
// change l'échelle de la partition entière sans toucher à une seule autre valeur.
// ---------------------------------------------------------------------------------------------

export const GEO_DEFAUT = {
    S: 8,                       // interligne de la portée solfège, en px
    ratioTab: 1.42,             // interligne de la TAB, en multiples de S — plus large : il doit
                                // loger deux chiffres sans qu'ils touchent la ligne voisine
    ecartPorteeTab: 4.6,        // du bas de la portée au haut de la TAB, en S
    margeHaut: 4.2,             // au-dessus de la portée : numéros de mesure, lignes supplémentaires
    margeBas: 3.4,              // sous la TAB : P.M., doigtés
    ecartSystemes: 3.2,         // entre deux systèmes, en S
    margeGauche: 34,            // px — accolade + « TAB » vertical y logent
    margeDroite: 22,
    largeurPage: 1100,
    tailleChiffreTab: 1.42,     // hauteur du chiffre de frette, en S
    mesuresParLigne: null,      // null/"Auto" = glouton ; sinon N mesures par ligne (borné à la
                                // baisse si besoin — voir decouperEnSystemesParCompte)
    avertirErreurs: true,      // fond teinté sur une mesure dont une voix ne totalise pas la
                                // bonne durée — mis à false pour l'export PDF (couleur translucide,
                                // non portable vers jsPDF)
    // ÉCHELLE DU BLOC DE TITRE (titre, sous-titre, artiste), en facteur — 1 = les proportions de
    // gravure d'origine. Réglable pour l'export PDF (retour utilisateur : « me permettre d'ajuster
    // [...] la taille des titres »), où un titre long peut voler une ligne de musique à la première
    // page, et où l'inverse — un titre trop discret sur une fiche d'exercices — se voit aussi.
    // UN FACTEUR, PAS DES TAILLES : les trois lignes gardent ainsi leurs rapports entre elles (le
    // titre reste presque deux fois le nom de l'artiste), et les interlignes du bloc suivent la
    // même échelle — sans quoi agrandir le titre l'aurait fait mordre sur le sous-titre.
    echelleEnTete: 1,
};

/**
 * Descripteurs de clé. `pasRef` est la position diatonique absolue de la note portée par la ligne de
 * référence de la clé — sol4 pour la clé de sol, fa3 pour la clé de fa. Tout le placement vertical
 * d'une note en découle par une simple soustraction, sans table de correspondance.
 *
 * `transposition` traduit le fait que guitare et basse SONNENT une octave sous ce qui est écrit :
 * on écrit la hauteur MIDI + 12, on joue la hauteur MIDI. Séparer les deux est indispensable — sans
 * ça, une partition de basse se retrouverait sous six lignes supplémentaires.
 */
export const CLEFS = {
    sol: { glyphe: G.CLE_SOL, ligne: 3, pasRef: 32, transposition: 0 },
    sol8vb: { glyphe: G.CLE_SOL_8VB, ligne: 3, pasRef: 32, transposition: 12 },
    fa: { glyphe: G.CLE_FA, ligne: 1, pasRef: 24, transposition: 0 },
    fa8vb: { glyphe: G.CLE_FA_8VB, ligne: 1, pasRef: 24, transposition: 12 },
};

// Positions diatoniques des altérations à l'armure, en clé de sol. La clé de fa reprend le MÊME
// dessin deux octaves plus bas (−14 pas) : c'est exactement la règle de gravure, et l'écrire ainsi
// évite une seconde table qui pourrait diverger de la première.
const ARMURE_DIESES_SOL = [38, 35, 39, 36, 33, 37, 34];
const ARMURE_BEMOLS_SOL = [34, 37, 33, 36, 32, 35, 31];

function positionsArmure(armure, clef) {
    const decalage = clef.pasRef === 24 ? -14 : 0;
    const base = armure > 0 ? ARMURE_DIESES_SOL : ARMURE_BEMOLS_SOL;
    return base.slice(0, Math.abs(armure)).map(p => p + decalage);
}

// ---------------------------------------------------------------------------------------------
// Fabriques de primitives. Une seule forme par type, produite ici et nulle part ailleurs.
// ---------------------------------------------------------------------------------------------

const ligne = (x1, y1, x2, y2, ep, couleur = 'encre') => ({ t: 'ligne', x1, y1, x2, y2, ep, couleur });
const rect = (x, y, w, h, couleur = 'encre') => ({ t: 'rect', x, y, w, h, couleur });

/**
 * L'écart le plus GRAND EN VALEUR ABSOLUE entre ce qu'une voix de la mesure écrit et la capacité —
 * positif si la mesure déborde, négatif s'il lui manque du temps, 0 si tout tombe juste.
 */
function ecartLePlusGrand(mesure, capacite) {
    let pire = 0;
    for (const v of mesure.voix) {
        const e = v.evenements.reduce((t, ev) => t + dureeEnNoires(ev.duree), 0) - capacite;
        if (Math.abs(e) > Math.abs(pire)) pire = e;
    }
    return Math.abs(pire) > 1e-6 ? pire : 0;
}

/**
 * L'ÉTIQUETTE D'UNE MESURE ENDETTÉE — « +½ ♩ », « −1 ♩ », « +⅔ ♩ ».
 *
 * EN FRACTIONS PLUTÔT QU'EN DÉCIMALES, parce qu'un musicien compte en fractions de temps et jamais
 * en 0,666. Les huit fractions couvertes sont exactement celles que les figures de TabHub savent
 * produire (moitiés, quarts, huitièmes, tiers) ; au-delà, deux décimales valent mieux qu'une
 * fraction inventée.
 *
 * LE SIGNE EST LE VRAI MESSAGE : « + » dit qu'il y a trop, donc qu'Absorber (Alt+A) et Déverser
 * (Alt+R) s'appliquent tous deux ; « − » dit qu'il manque, et seul Déverser sait combler. Le symbole
 * ♩ rappelle l'unité — des NOIRES, pas des temps, qui n'est pas la même chose en 6/8.
 */
function libelleEcart(ecart) {
    const signe = ecart > 0 ? '+' : '−';
    const a = Math.abs(ecart);
    const entier = Math.floor(a + 1e-9);
    const reste = a - entier;
    const FRACTIONS = [[0.5, '½'], [0.25, '¼'], [0.75, '¾'], [1 / 3, '⅓'], [2 / 3, '⅔'],
                       [0.125, '⅛'], [0.375, '⅜'], [0.625, '⅝'], [0.875, '⅞']];
    const frac = reste > 1e-9 ? FRACTIONS.find(([v]) => Math.abs(v - reste) < 1e-6)?.[1] : '';
    if (reste > 1e-9 && !frac) return `${signe}${a.toFixed(2)} ♩`;
    const corps = `${entier || (frac ? '' : '0')}${frac}`;
    return `${signe}${corps} ♩`;
}
const poly = (pts, couleur = 'encre') => ({ t: 'poly', pts, couleur });
const texte = (x, y, s, o = {}) => ({
    t: 'texte', x, y, s,
    taille: o.taille ?? 10, police: o.police ?? 'serif', poids: o.poids ?? 'normal',
    italique: !!o.italique, ancre: o.ancre ?? 'milieu', couleur: o.couleur ?? 'encre',
    // `classe`, optionnelle : le seul moyen pour l'interface de retrouver un texte PRÉCIS dans le
    // SVG rendu (voir main.js, l'édition de l'en-tête au clic). Le PDF l'ignore : une classe CSS
    // n'a aucun sens dans un document imprimé (voir render/pdf.js).
    ...(o.classe ? { classe: o.classe } : {}),
});
/**
 * Pose un glyphe (liste de traits) à l'échelle voulue. L'échelle est TOUJOURS l'interligne courant.
 * `nom` identifie le dessin : c'est lui qui permet au moteur SVG de ne l'écrire qu'une fois.
 */
const glyphe = (traits, x, y, echelle, couleur = 'encre') => ({ t: 'glyphe', traits, nom: traits.nom, x, y, echelle, couleur });
const courbe = (d, ep, couleur = 'encre') => ({ t: 'courbe', d, ep, couleur });

/**
 * Arc de liaison entre deux points. `sens` = -1 pour un arc bombé vers le haut, +1 vers le bas :
 * une liaison se place toujours du côté opposé aux hampes, sans quoi elle les coupe.
 */
function arcLiaison(x1, y1, x2, y2, sens, hauteur) {
    const dx = x2 - x1;
    const fleche = sens * Math.max(hauteur, Math.min(dx * 0.22, hauteur * 2.2));
    const cx1 = x1 + dx * 0.25, cx2 = x1 + dx * 0.75;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} C ${cx1.toFixed(2)} ${(y1 + fleche).toFixed(2)} ${cx2.toFixed(2)} ${(y2 + fleche).toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

// ---------------------------------------------------------------------------------------------
// Mesurage : combien de place demande chaque évènement, chaque mesure.
// ---------------------------------------------------------------------------------------------

/**
 * Largeur demandée par une COLONNE — un instant de temps partagé par toutes les voix de la mesure.
 *
 * Deux exigences se disputent la place, et l'espacement retenu est le MAXIMUM des deux :
 *   • PROPORTIONNELLE, LINÉAIREMENT, À L'ÉCART jusqu'au prochain instant (`gapNoires`) — et non à la
 *     durée propre d'un évènement. C'est ce qui donne la bonne largeur à une VOIX À DEUX RYTHMES :
 *     une basse tenue (blanche pointée) posée sous une mélodie de croches n'impose PAS trois croches
 *     de large à sa propre colonne — elle n'a besoin que de la place qu'y réclame ce qui s'y joue
 *     vraiment, à savoir la croche voisine. Une seule voix est le cas particulier où « le prochain
 *     instant » est toujours la fin de son propre évènement.
 *
 *     LINÉAIRE, PAS COMPRESSÉ PAR UNE PUISSANCE — une version antérieure compressait par ~0,62 (une
 *     gravure classique, qui resserre les passages denses sans les priver de toute respiration), mais
 *     ÉCART ÉGAL NE DONNAIT ALORS PAS LARGEUR ÉGALE : deux temps de la même mesure, l'un dense (une
 *     rafale de doubles-croches) et l'autre clairsemé, se retrouvaient à des largeurs différentes une
 *     fois recalées sur la largeur fixe de la mesure (voir LARGEUR_PAR_NOIRE) — la réglette, qui pose
 *     ses graduations sur ces mêmes colonnes, en héritait des espacements irréguliers d'un temps à
 *     l'autre, en contradiction directe avec l'exigence : un temps est un temps, sa durée en noires
 *     ne varie jamais, sa largeur affichée ne doit donc pas varier non plus selon ce qui s'y joue. Le
 *     linéaire garantit qu'un ÉCART ÉGAL donne une LARGEUR ÉGALE — donc une grille de temps parfaitement
 *     régulière — tant que le plancher ci-dessous ne s'en mêle pas.
 *   • UN PLANCHER matériel : la place qu'occupent réellement les altérations et les chiffres à deux
 *     chiffres de la tablature, pour CHAQUE voix présente à cet instant. Sans lui, « 12 » déborderait
 *     sur la note suivante. Il ne joue que sur un passage EXTRÊMEMENT dense (au-delà de la double-croche
 *     courante) : la régularité en pâtit alors localement, un compromis assumé plutôt que de laisser
 *     des chiffres se chevaucher.
 */
function largeurColonne(gapNoires, evenementsIci, S) {
    const d = Math.max(gapNoires, 1 / 64);
    const proportionnelle = 3.9 * S * d;

    let plancher = 3.2 * S;
    for (const { ref } of evenementsIci) {
        if (ref.notes.some(n => n.frette >= 10)) plancher = Math.max(plancher, 3.9 * S);
        if (ref.duree.points > 0) plancher = Math.max(plancher, 3.7 * S);
    }
    return Math.max(proportionnelle, plancher);
}

/**
 * Répartit la largeur FIXE d'une mesure (`largeurNotes`) ENTRE SES TEMPS, à parts ÉGALES —
 * plutôt qu'entre ses colonnes au seul prorata de leur poids matériel (voir `largeurColonne`), ce
 * qui donnait des temps de largeurs différentes selon la densité de ce qui s'y joue — en
 * contradiction directe avec ce qu'est un temps : une durée qui NE VARIE JAMAIS, sa largeur
 * affichée ne doit donc pas varier non plus selon ce qui s'y joue.
 *
 * CHAQUE TEMPS REÇOIT EXACTEMENT largeurNotes/nTemps, INCONDITIONNELLEMENT — qu'il contienne une
 * rafale de doubles-croches ou une seule ronde. À L'INTÉRIEUR d'un temps, les colonnes qui s'y
 * trouvent gardent leurs poids RELATIFS (une case à deux chiffres réclame plus de champ qu'une case
 * simple), rescalés pour tenir exactement dans CE budget LOCAL — jamais dans le budget de la mesure
 * entière : un temps dense peut ainsi devenir plus serré que son plancher matériel idéal (des chiffres
 * un peu à l'étroit, un compromis assumé), mais IL N'EMPIÈTE JAMAIS SUR SES VOISINS pour autant.
 *
 * UNE NOTE QUI CHEVAUCHE PLUSIEURS TEMPS (une blanche, par exemple) n'a qu'une seule colonne, posée
 * au temps où elle attaque ; les temps suivants qu'elle traverse SANS qu'aucune autre voix n'y
 * attaque n'ont eux-mêmes aucune colonne à poser — leur part du budget est alors simplement
 * ADDITIONNÉE à celui du dernier temps qui, lui, porte une colonne (voir `iPortant` ci-dessous), pour
 * que la somme globale sur la mesure reste exacte malgré ces temps « vides ».
 */
function repartirParTemps(colonnes, capacite, unite, largeurNotes) {
    const nTemps = Math.max(1, Math.round(capacite / unite));
    const largeurParTemps = largeurNotes / nTemps;
    const groupes = Array.from({ length: nTemps }, () => []);
    for (const c of colonnes) {
        const iTemps = Math.min(nTemps - 1, Math.max(0, Math.floor((c.debut + 1e-9) / unite)));
        groupes[iTemps].push(c);
    }
    const budgets = new Array(nTemps).fill(largeurParTemps);
    let iPortant = -1;
    for (let i = 0; i < nTemps; i++) {
        if (groupes[i].length) { iPortant = i; }
        else if (iPortant !== -1) { budgets[iPortant] += budgets[i]; budgets[i] = 0; }
        // Un temps vide EN TOUT DÉBUT de mesure (iPortant encore -1) ne devrait jamais se produire —
        // calculerColonnes garantit toujours une colonne à l'origine — mais si ça arrivait quand
        // même (données malformées), son budget reste simplement de côté plutôt que de faire planter
        // la mise en page : un défaut visuel mineur, jamais une exception.
    }
    for (let i = 0; i < nTemps; i++) {
        if (!groupes[i].length) continue;
        const brut = groupes[i].reduce((t, c) => t + c.largeur, 0);
        const ratio = brut > 1e-9 ? budgets[i] / brut : 1;
        groupes[i].forEach(c => { c.largeur *= ratio; });
    }
}

/**
 * Largeur (à l'échelle S=1) allouée par NOIRE de capacité rythmique — INDÉPENDANTE du contenu réel
 * de la mesure. Deux mesures de même signature (donc même capacité) reçoivent ainsi TOUJOURS
 * exactement la même largeur, qu'elles contiennent une ronde ou une rafale de doubles-croches ; une
 * mesure à 3/4 réserve les 3/4 de la largeur d'une mesure à 4/4 — jamais une proportion qui
 * dépendrait de ce qui s'y trouve. Voir l'étape 1 de `mettreEnPage` : le contenu s'ajuste DANS ce
 * budget fixe (plus dense, il s'y resserre ; plus clairsemé, il s'y étale) au lieu que le budget
 * s'ajuste au contenu — c'est l'inverse qui donnait des mesures de largeurs incohérentes d'une
 * mesure à l'autre pour un même chiffrage, une mesure de croches régulières écrasant une mesure
 * voisine réduite à un silence.
 */
const LARGEUR_PAR_NOIRE = 5;

/**
 * Bande RÉSERVÉE au-dessus d'un système pour une annotation de section (« Couplet 1 », « Refrain »,
 * « Pont »…, voir Editeur.definirAnnotation), en S. Ajoutée à `geo.margeHaut` — jamais à la place de
 * cette marge, qui garde son rôle propre (numéro de mesure, lignes supplémentaires) — et SEULEMENT
 * pour les systèmes qui en ont réellement besoin (voir mettreEnPage) : une partition qui n'utilise
 * jamais cette fonctionnalité ne paie donc rien pour elle, système après système.
 */
const HAUTEUR_ANNOTATION = 2.4;

/**
 * Bande RÉSERVÉE au-dessus d'un système pour les noms d'accords (« A7 », « E7 »…, voir
 * Editeur.definirAccord et Évènement#accord), en S. Même principe que HAUTEUR_ANNOTATION — ajoutée
 * SOUS elle si les deux coexistent (l'annotation de section reste le repère le plus large qu'on
 * cherche d'abord), et seulement pour les systèmes qui en ont réellement besoin. Plus PETITE que
 * HAUTEUR_ANNOTATION : un nom d'accord (« A7 ») est plus court et plus léger qu'un titre de section,
 * il n'a pas besoin d'autant de champ.
 */
const HAUTEUR_ACCORDS = 1.8;

/**
 * Hauteur de la bande des REPÈRES DE NAVIGATION (Segno, Coda, D.C., D.S., al Coda, Fine), en S.
 * Même principe qu'HAUTEUR_ANNOTATION et HAUTEUR_ACCORDS : réservée SEULEMENT si l'un des systèmes
 * en porte un — une partition sans renvoi ne doit voir aucune de ses lignes s'écarter pour rien.
 *
 * LA PLUS BASSE DES TROIS BANDES, juste au-dessus de la portée. C'est l'ordre de la gravure : le
 * titre de section coiffe le tout, les noms d'accords viennent ensuite, et les renvois se posent au
 * plus près de la musique qu'ils commandent. Sans cette bande, un Segno se dessinait PAR-DESSUS les
 * numéros de mesure — deux signes superposés, aucun des deux lisible.
 */
const HAUTEUR_REPERE = 2.6;

/**
 * Découpe une mesure en COLONNES : les instants de temps où AU MOINS UNE voix attaque une note ou un
 * silence, triés, avec la largeur que chacun réclame (voir largeurColonne). Une seule voix produit
 * exactement la même suite de colonnes que ses propres évènements ; deux voix produisent l'UNION de
 * leurs attaques respectives — c'est cette union qui aligne visuellement la mélodie et la basse
 * tenue sur les mêmes abscisses, sans quoi les deux portées de voix dériveraient l'une de l'autre dès
 * la première note où leurs rythmes diffèrent.
 */
function calculerColonnes(mesure, capaciteNoires, S) {
    const arrondi = (n) => Math.round(n * 1e6) / 1e6;
    const parTemps = new Map();   // temps (noires depuis le début de la mesure) → évènements qui y attaquent
    mesure.voix.forEach((voix, iVoix) => {
        let t = 0;
        for (const ref of voix.evenements) {
            const cle = arrondi(t);
            if (!parTemps.has(cle)) parTemps.set(cle, []);
            parTemps.get(cle).push({ voix: iVoix, ref });
            t += dureeEnNoires(ref.duree);
        }
    });
    const temps = [...parTemps.keys()].sort((a, b) => a - b);
    if (!temps.length || temps[0] > 1e-9) temps.unshift(0);   // filet : toujours une colonne à l'origine

    return temps.map((debut, i) => {
        const prochain = i + 1 < temps.length ? temps[i + 1] : Math.max(arrondi(capaciteNoires), debut);
        const gap = Math.max(prochain - debut, 1 / 128);
        const evenementsIci = parTemps.get(debut) || [];
        return { debut, gap, evenements: evenementsIci, largeur: largeurColonne(gap, evenementsIci, S) };
    });
}

/**
 * Largeur de l'en-tête d'une mesure : clé, armure, signature — seulement ce qui doit y figurer.
 *
 * Chaque largeur est MESURÉE sur la boîte englobante du glyphe réel, jamais devinée. Une version
 * antérieure portait une table de largeurs écrite à la main ; elle a cessé d'être juste dès que les
 * dessins ont changé, et les altérations d'armure se chevauchaient.
 */
function largeurEnTete(besoins, armure, signature, clef, S, ST, cordes) {
    let w = 0;
    if (besoins.clef) w += (G.largeurDe(clef.glyphe) + 0.9) * S;
    if (besoins.cleTab) w += largeurCleTab(ST, cordes) + 0.9 * S;
    if (besoins.armure && armure !== 0) {
        w += Math.abs(armure) * (G.largeurDe(armure > 0 ? G.DIESE : G.BEMOL) + 0.08) * S + 0.5 * S;
    }
    if (besoins.signature) {
        w += (Math.max(G.chiffresDe(signature.battements).largeur, G.chiffresDe(signature.unite).largeur) + 0.9) * S;
    }
    if (besoins.repriseDebut) w += 1.8 * S;
    // RESPIRATION APRÈS L'EN-TÊTE. Une altération accidentelle se dessine À GAUCHE de sa tête de note,
    // hors de la largeur allouée à l'évènement : sans cette marge, le dièse de la première note d'une
    // mesure venait se poser sur le chiffre de la signature rythmique. La marge est comptée ici, dans
    // la largeur, et non ajoutée au moment de dessiner — sinon la barre de mesure, calculée depuis
    // cette largeur, tomberait au mauvais endroit.
    if (w > 0) w += 1.5 * S;
    return w;
}

/**
 * Espace nécessaire entre la portée et la tablature quand une SECONDE voix existe.
 *
 * Une voix secondaire reçoit systématiquement une hampe vers le BAS (voir poserEvenement,
 * `sensImpose`) — la convention de gravure pour deux voix sur une même portée. Si elle porte des
 * notes graves (une basse tenue, exactement le cas visé par cette fonctionnalité), leur hampe
 * s'étire vers le bas depuis un point déjà SOUS la portée — alors qu'une voix UNIQUE, elle, aurait
 * reçu la règle automatique et une hampe vers le HAUT sur ces mêmes notes graves, qui ne se serait
 * jamais approchée de la tablature. L'écart par défaut est calibré pour ce cas courant (une seule
 * voix) ; sans cette fonction, la hampe d'une basse tenue traverserait purement et simplement la TAB.
 *
 * On mesure la partition ENTIÈRE pour ne grandir l'écart que de ce qu'il faut : une partition sans
 * seconde voix, ou dont la seconde reste dans le registre aigu, garde l'écart compact par défaut.
 */
function ecartPorteeTabRequis(partition, clef, S, ecartDefaut) {
    let pasMin = clef.pasRef;
    let trouve = false;
    for (const mesure of partition.mesures) {
        if (mesure.voix.length < 2) continue;
        for (const voix of mesure.voix.slice(1)) {
            for (const e of voix.evenements) {
                for (const note of e.notes) {
                    const midi = hauteurDeNote(partition, note);
                    if (midi == null) continue;
                    const pas = ecrireHauteur(midi + clef.transposition, 0).pas;
                    if (pas < pasMin) pasMin = pas;
                    trouve = true;
                }
            }
        }
    }
    if (!trouve) return ecartDefaut;
    // Position (en « pas ») de la 5e ligne, la plus basse de la portée — celle sous laquelle
    // commencent les lignes supplémentaires. `clef.ligne` compte les lignes depuis le HAUT (0..4).
    const pasLigneBas = clef.pasRef - (4 - clef.ligne) * 2;
    const debordement = Math.max(0, (pasLigneBas - pasMin) * 0.5);   // en interlignes, sous la 5e ligne
    // Marge : le débordement sous la portée, PLUS la longueur d'une hampe, PLUS une respiration —
    // LONGUEUR_HAMPE est définie plus bas dans ce fichier mais déjà initialisée au moment où cette
    // fonction est réellement appelée (elle ne l'est jamais avant la fin du chargement du module).
    return Math.max(ecartDefaut, debordement + LONGUEUR_HAMPE + 1.4);
}

/**
 * Pendant de ecartPorteeTabRequis pour le mode « TAB seule » (voir HAUTEUR_ZONE_HAMPE_TAB) : la
 * marge SOUS la TAB ne grandit que si une seconde voix existe réellement (une voix seule ne pousse
 * jamais de hampe en dessous). Pas besoin d'y mesurer un registre comme le fait la fonction
 * ci-dessus : sans portée, toutes les hampes d'une même voix ont la MÊME longueur nominale, quelle
 * que soit la hauteur jouée — la marge nécessaire est donc un simple FORFAIT, jamais un calcul sur
 * le contenu.
 */
function margeBasRequise(partition, margeBasDefaut) {
    const aSeconde = partition.mesures.some(m => m.voix.length > 1
        && m.voix[1].evenements.some(e => !e.silence && e.notes.length));
    if (!aSeconde) return margeBasDefaut;
    return Math.max(margeBasDefaut, ECART_ZONE_HAMPE_TAB + LONGUEUR_HAMPE + 1.4);
}

// ---------------------------------------------------------------------------------------------
// Altérations accidentelles : mémoire à l'échelle de la mesure
// ---------------------------------------------------------------------------------------------

/**
 * Une altération accidentelle vaut jusqu'à la fin de la MESURE, pour toutes les notes de même nom et
 * même octave. C'est une règle de notation vieille de trois siècles, et l'ignorer produit des
 * partitions bruyantes : un riff chromatique répétant la même note afficherait un dièse devant
 * chacune de ses occurrences. Cet objet retient, mesure par mesure, ce qui a déjà été annoncé.
 */
// EXPORTÉE, et pour une seule raison : l'export MusicXML doit écrire LES MÊMES altérations que
// celles qu'on voit à l'écran (voir io/musicxml.js). Recopier la règle là-bas aurait donné deux
// vérités pour une notation vieille de trois siècles, et elles auraient fini par diverger.
export function memoireAlterations(armure) {
    const parArmure = alterationsDeLArmure(armure);
    // L'armure voyage AVEC la mémoire : l'orthographe d'une note (fa♯ ou sol♭) et la décision de
    // dessiner ou non l'altération sont deux facettes de la même règle, et les séparer en deux
    // paramètres invitait à en oublier un — ce qui donnait des partitions orthographiées en do majeur
    // quelle que soit l'armure réelle.
    const annoncees = new Map();   // pas → altération en vigueur
    return {
        armure,
        /** Faut-il dessiner une altération devant cette note ? Met la mémoire à jour au passage. */
        besoin(ecriture) {
            const enVigueur = annoncees.has(ecriture.pas)
                ? annoncees.get(ecriture.pas)
                : (parArmure[ecriture.lettre] || 0);
            if (ecriture.alteration === enVigueur) return null;
            annoncees.set(ecriture.pas, ecriture.alteration);
            return ecriture.alteration;
        },
    };
}

// ---------------------------------------------------------------------------------------------
// Découpage en systèmes : deux stratégies, une mesure commune
// ---------------------------------------------------------------------------------------------

/**
 * Ce qu'il faut redessiner en tête d'une mesure : la clé et l'armure à chaque nouveau système, la
 * signature seulement à la toute première mesure du morceau ou quand elle change réellement
 * (`m.changeSignature`) — la convention de gravure usuelle, qui ne répète pas un chiffrage resté
 * inchangé à chaque nouvelle ligne.
 */
/**
 * `avecPortee` (mode « TAB seule », voir mettreEnPage) supprime CLÉ et ARMURE — l'une comme l'autre
 * n'existent que pour dire comment LIRE des positions sur une portée qui, ici, ne se dessine pas.
 * La SIGNATURE rythmique reste montrée dans les deux modes : combien de temps compte une mesure ne
 * dépend pas de la présence d'une portée, une tablature seule en a tout autant besoin.
 */
function besoinsDe(m, premiereDuSysteme, avecPortee = true) {
    return {
        clef: avecPortee && premiereDuSysteme,
        // Sans portée, la clé de TAB (déjà dessinée par système, voir poserCleTab) partage
        // désormais la même ligne que la signature (voir plus bas, poserMesure) : sa largeur doit
        // être réservée en tête de mesure exactement comme l'était celle de la clé de notation —
        // sans quoi la signature viendrait s'y superposer (retour utilisateur, capture à l'appui).
        cleTab: !avecPortee && premiereDuSysteme,
        armure: avecPortee && (premiereDuSysteme || m.changeArmure),
        signature: m.index === 0 || m.changeSignature,
        repriseDebut: m.ref.repriseDebut,
    };
}

/** Calcule et mémorise l'en-tête et la largeur totale d'une mesure pour les besoins donnés. */
function mesurerMesure(m, besoins, clef, S, ST, cordes) {
    m.besoins = besoins;
    m.enTete = largeurEnTete(besoins, m.armure, m.signature, clef, S, ST, cordes);
    m.largeurTotale = m.enTete + m.largeurNotes + 1.4 * S;   // marge avant la barre de mesure
    return m.largeurTotale;
}

/**
 * Découpage AUTOMATIQUE (« Auto ») : glouton, on remplit chaque ligne tant que ça rentre. Une
 * mesure seule qui déborde reste seule sur sa ligne plutôt que d'être coupée — une mesure coupée en
 * deux n'a aucun sens musical.
 */
// `mesurer(m, premiereDuSysteme)` encapsule le mesurage propre à l'instrument (besoinsDe +
// mesurerMesure, avec la clé qui va avec) : cette fonction ne connaît QUE le découpage en lignes,
// jamais ce qui distingue une portée de guitare/basse (avec TAB) d'une portée de piano (sans TAB,
// deux clés) — voir mettreEnPage et mettreEnPagePiano, qui lui passent chacun leur propre mesurage.
function decouperEnSystemesGloutons(mesures, largeurUtile, mesurer) {
    const systemes = [];
    let courant = null;
    for (const m of mesures) {
        const premiereDuSysteme = !courant || courant.mesures.length === 0;
        const largeurTotale = mesurer(m, premiereDuSysteme);
        // RETOUR À LA LIGNE DEMANDÉ (voir Mesure#sautAvant) : il l'emporte sur le remplissage, même
        // s'il reste de la place sur la ligne. C'est tout l'objet du réglage — voir Editeur.basculerSautDeLigne.
        const saut = !!m.ref.sautAvant && courant && courant.mesures.length > 0;
        if (!courant) {
            courant = { mesures: [], largeur: 0 };
        } else if (saut || (courant.largeur + largeurTotale > largeurUtile && courant.mesures.length > 0)) {
            systemes.push(courant);
            courant = { mesures: [], largeur: 0 };
            // Nouveau système : la clé et l'armure s'y redessinent, donc la mesure est remesurée.
            mesurer(m, true);
        }
        courant.mesures.push(m); courant.largeur += m.largeurTotale;
    }
    if (courant && courant.mesures.length) systemes.push(courant);
    return systemes;
}

/**
 * Découpage à COMPTE FIXE : `n` mesures par ligne, comme le demande un musicien qui veut une lecture
 * régulière d'un bout à l'autre de la partition — plutôt que le remplissage au plus large que fait
 * le mode automatique.
 *
 * Chaque mesure a désormais une largeur FIXE, dictée par sa seule capacité rythmique (voir
 * LARGEUR_PAR_NOIRE) — il n'y a donc plus de « compression illisible » possible : `n` mesures
 * tiennent ou ne tiennent pas, un point c'est tout. LE COMPTE N'EST RÉDUIT QUE SI `n` MESURES
 * DÉBORDERAIENT LITTÉRALEMENT LA LIGNE (une mesure à 7/8 est déjà, largeur fixe oblige, plus large
 * qu'une mesure à 2/4 — demander 6 mesures par ligne sur un passage aux mesures très capacitives se
 * voit donc ramené de lui-même à 4 ou 3 pour CE passage-là, et revient à 6 dès que le chiffrage
 * s'allège) : on retire alors la DERNIÈRE mesure de la ligne (elle glisse sur la suivante) et on
 * réessaie, jusqu'à n'en garder plus qu'une si littéralement une seule mesure ne tient déjà pas —
 * dans ce cas, elle reste seule, exactement comme le ferait le mode automatique.
 */
function decouperEnSystemesParCompte(mesures, n, mesurer) {
    // `n` est un CHOIX EXPLICITE (voir groupe-mesures-ligne) — contrairement au mode « Auto », qui
    // vise justement à toujours tenir dans la largeur, ce chiffre-ci dit combien de mesures l'œil
    // doit voir par ligne, quitte à ce que la ligne déborde et se parcoure au défilement horizontal
    // (retour utilisateur : « je veux pouvoir scroller horizontalement... en définissant le nombre de
    // mesures visibles par ligne »). Une version antérieure RÉDUISAIT ce chiffre jusqu'à ce que ça
    // tienne dans `largeurUtile` — un choix explicite qui se faisait discrètement écraser dès l'écran
    // trop étroit pour lui, exactement le cas d'un téléphone, là où ce réglage sert le plus. La page
    // grandit maintenant pour accueillir tout système trop large plutôt que d'en rogner le contenu
    // (voir mettreEnPage, plus bas, et `.zone-partition { overflow: auto }`) : rien n'empêche plus de
    // tenir cette promesse au pied de la lettre.
    const systemes = [];
    let i = 0;
    while (i < mesures.length) {
        let tranche = mesures.slice(i, Math.min(i + n, mesures.length));
        // UN RETOUR À LA LIGNE DEMANDÉ COUPE LA TRANCHE (voir Mesure#sautAvant). Honoré ICI AUSSI, et
        // pas seulement dans le mode automatique : sans quoi une fiche d'exercices bâtie sur des
        // systèmes de deux mesures (retour utilisateur : « si je veux uniquement créer une fiche
        // d'exercices avec plusieurs petits morceaux de 2 mesures ») se recollerait dès qu'on
        // choisirait « 4 » dans le réglage Affichage — le réglage global écrasant en silence une
        // intention posée mesure par mesure. Jamais sur la PREMIÈRE de la tranche : un saut y est déjà
        // honoré, c'est précisément là que la tranche commence.
        const coupe = tranche.findIndex((m, k) => k > 0 && m.ref.sautAvant);
        if (coupe > 0) tranche = tranche.slice(0, coupe);
        tranche.forEach((m, k) => mesurer(m, k === 0));
        systemes.push({ mesures: tranche, largeur: tranche.reduce((t, m) => t + m.largeurTotale, 0) });
        i += tranche.length;
    }
    return systemes;
}

// ---------------------------------------------------------------------------------------------
// Mise en page principale
// ---------------------------------------------------------------------------------------------

/**
 * @param {object} partition
 * @param {object} options  { S, largeurPage, avecEnTete, mesuresParLigne, couleurs… }
 * @returns {{largeur, hauteur, primitives, ancrages}}
 */
export function mettreEnPage(partition, options = {}) {
    const geo = { ...GEO_DEFAUT, ...options };
    // GRAND-PORTÉE (piano) : un instrument à clavier n'a ni corde ni case, sa portée n'a rien de
    // commun avec la TAB — voir mettreEnPagePiano, un chemin volontairement à part plutôt qu'un
    // maillage de conditions dans les 800 lignes qui suivent, pensées pour guitare/basse depuis le
    // début. `nMesuresParLigne` s'y calcule de la même façon (voir plus bas) : les deux chemins
    // partagent decouperEnSystemesGloutons/ParCompte, seul le MESURAGE (une portée, deux clés,
    // jamais de TAB) diffère.
    if (INSTRUMENTS[partition.piste.instrument]?.clef === 'grandPortee') return mettreEnPagePiano(partition, geo);
    const S = geo.S;
    const ST = S * geo.ratioTab;                        // interligne de la tablature
    const clef = CLEFS[INSTRUMENTS[partition.piste.instrument]?.clef || 'sol8vb'];
    // MODE « TAB SEULE » (retour utilisateur, voir HAUTEUR_ZONE_HAMPE_TAB) : `false` seulement sur
    // demande explicite — absent (undefined), l'option retombe sur le comportement historique.
    //
    // ET SON MIROIR, « PORTÉE SEULE » (`avecTab: false`), pour l'aide rythmique (voir ui/rythme.js) :
    // elle montre la VRAIE écriture d'un rythme, or une tablature n'y dirait rien — toutes ses notes
    // étant à la même hauteur, elle afficherait « 5 — 5 — 5 » sous la portée, du bruit pur.
    //
    // LES DEUX À LA FOIS NE DESSINERAIENT RIEN : `avecPortee` est donc forcé quand la TAB s'absente.
    // Mieux vaut une portée qu'on n'a pas demandée qu'une page blanche.
    //
    // CORDES = 0, ET C'EST LA MÉCANIQUE DÉJÀ ÉPROUVÉE : c'est exactement ce que vaut `ctx.cordes` au
    // piano (voir poserMesurePiano), et tout le tracé de tablature est déjà gardé par `cordes > 0`
    // (chiffres de case, masque de ligne, bends). Passer par ce chemin plutôt que par un nouveau
    // drapeau enfilé dans dix fonctions évite d'en oublier une.
    const avecTab = geo.avecTab !== false;
    const avecPortee = avecTab ? geo.avecPortee !== false : true;
    const cordes = avecTab ? nbCordes(partition) : 0;
    // Voir ecartPorteeTabRequis : agrandi seulement si une seconde voix descend assez bas pour que
    // sa hampe (systématiquement vers le bas) risquerait de traverser la tablature. Sans portée,
    // c'est un simple forfait (voir ECART_ZONE_HAMPE_TAB) : aucun registre à mesurer, toutes les
    // hampes y ont la même longueur nominale quelle que soit la hauteur jouée.
    // Sans TAB, aucun écart à ménager entre deux portées dont une seule existe.
    const ecartPorteeTab = !avecTab ? 0
        : avecPortee ? ecartPorteeTabRequis(partition, clef, S, geo.ecartPorteeTab) : ECART_ZONE_HAMPE_TAB;
    // Idem sous la TAB (voir margeBasRequise) : n'agrandit que si une seconde voix existe VRAIMENT.
    const margeBas = avecPortee ? geo.margeBas : margeBasRequise(partition, geo.margeBas);

    const hauteurPortee = avecPortee ? 4 * S : HAUTEUR_ZONE_HAMPE_TAB * S;
    const hauteurTab = avecTab ? (cordes - 1) * ST : 0;
    const hauteurSysteme = geo.margeHaut * S + hauteurPortee + ecartPorteeTab * S + hauteurTab + margeBas * S;
    const largeurUtile = geo.largeurPage - geo.margeGauche - geo.margeDroite;

    // --- 1. Mesurer chaque mesure isolément -----------------------------------------------------
    // Le mesurage se fait par COLONNES (voir calculerColonnes) — l'union des attaques de toutes les
    // voix de la mesure. Une mesure à une seule voix retombe exactement sur son propre découpage
    // d'évènements ; c'est le cas général qui compte pour deux voix ou davantage.
    const mesures = partition.mesures.map((mesure, i) => {
        const sig = signatureEffective(partition, i);
        const arm = armureEffective(partition, i);
        const capacite = noiresParMesure(sig);
        const colonnes = calculerColonnes(mesure, capacite, S);
        // Largeur FIXÉE par la capacité, jamais par le contenu réel (voir LARGEUR_PAR_NOIRE), et
        // répartie À PARTS ÉGALES entre les TEMPS de la mesure — jamais au prorata de la densité de
        // chacun (voir repartirParTemps) : sans quoi un temps dense (une rafale de doubles-croches)
        // se retrouvait plus large qu'un temps voisin clairsemé, et la réglette — qui pose ses
        // graduations sur ces mêmes colonnes — héritait de cet espacement irrégulier entre ses
        // graduations de temps. Les colonnes gardent leurs poids relatifs SEULEMENT entre elles, à
        // l'intérieur d'un même temps (une case à deux chiffres réclame plus de champ qu'une simple).
        const largeurNotes = capacite * LARGEUR_PAR_NOIRE * S;
        repartirParTemps(colonnes, capacite, uniteDeGroupement(sig), largeurNotes);
        return {
            index: i, ref: mesure, signature: sig, armure: arm, capacite, colonnes,
            largeurNotes,
            // Une signature ou une armure ne se redessine que si la mesure la CHANGE (champ non nul) —
            // c'est précisément l'information que porte le `null` du modèle.
            changeSignature: !!mesure.signature,
            changeArmure: mesure.armure !== null && mesure.armure !== undefined,
            // Une voix dont le total des durées ne tombe pas EXACTEMENT sur la capacité de la
            // mesure (trop ou pas assez) est signalée à la pose (voir poserMesure) plutôt que
            // laissée à se désaccorder en silence — c'est ce que produit, par exemple, un
            // changement de durée qui déborde sur ce qui suit (voir Editeur.appliquerDuree).
            invalide: mesure.voix.some(v => Math.abs(
                v.evenements.reduce((t, e) => t + dureeEnNoires(e.duree), 0) - capacite) > 1e-6),
            // DE COMBIEN, et dans quel sens — le fond teinté dit qu'il y a un problème, ce chiffre
            // dit lequel. On garde l'écart le plus GRAND EN VALEUR ABSOLUE parmi les voix : c'est
            // celui qui décide de la longueur réelle de la mesure (voir score.js#longueurMesure), et
            // afficher deux chiffres pour deux voix demanderait de dire laquelle est laquelle, ce
            // qu'une seule étiquette ne peut pas faire sans devenir illisible.
            ecart: ecartLePlusGrand(mesure, capacite),
        };
    });

    // --- 2. Découper en systèmes ----------------------------------------------------------------
    // Deux stratégies, choisies par `geo.mesuresParLigne` (voir plus haut, juste avant cette
    // fonction, pour le détail des deux algorithmes) :
    //   • absent/« Auto » (null) : GLOUTON — chaque ligne se remplit tant que ça rentre.
    //   • un nombre N : COMPTE FIXE — exactement N mesures par ligne, sauf à devenir illisible, une
    //     mesure à la fois, pour rester lisible quel que soit le chiffrage rythmique en cours.
    const nMesuresParLigne = geo.mesuresParLigne ? Math.max(1, Math.round(geo.mesuresParLigne)) : null;
    const mesurer = (m, premiere) => mesurerMesure(m, besoinsDe(m, premiere, avecPortee), clef, S, ST, cordes);
    const systemes = nMesuresParLigne
        ? decouperEnSystemesParCompte(mesures, nMesuresParLigne, mesurer)
        : decouperEnSystemesGloutons(mesures, largeurUtile, mesurer);

    // --- 3. (plus de justification) -------------------------------------------------------------
    // Une version antérieure étirait chaque système pour occuper toute la largeur utile, comme sur
    // une partition gravée classique — mais la partie qui absorbait cet étirement était le contenu
    // NOTES de la mesure, dont la largeur naturelle dépendait déjà du contenu (voir calculerColonnes).
    // Deux mesures de MÊME signature mais de densités différentes recevaient ainsi, une fois
    // étirées, des largeurs encore différentes selon ce qui restait sur leur ligne — exactement le
    // défaut signalé : la largeur d'une mesure ne doit dépendre QUE de sa signature (voir l'étape 1,
    // LARGEUR_PAR_NOIRE), jamais de son contenu ni de ses voisines de ligne. Chaque système garde
    // donc un facteur à 1 : une ligne qui n'atteint pas `largeurUtile` laisse simplement du blanc à
    // droite plutôt que d'étirer les notes pour le combler.
    systemes.forEach(sys => { sys.facteur = 1; });

    // --- 4. Poser ------------------------------------------------------------------------------
    const primitives = [];
    const ancrages = { evenements: [], mesures: [], systemes: [] };
    // Une entrée par voix : la liaison qu'une mesure laisse ouverte, que la suivante refermera
    // (voir reporterLiaison).
    const liaisons = new Map();
    // LES MESURES QUI COMMENCENT UN SYSTÈME, connues AVANT la pose : c'est ce qui permet de savoir,
    // en posant une mesure, si un saut de ligne la sépare de la suivante — donc s'il faut tracer un
    // demi-arc de départ tout de suite, dans la tranche de primitives de CE système.
    const debutsDeSysteme = new Set(systemes.map(sys => sys.mesures[0]?.index).filter(i => i != null));
    let y = geo.yDepart ?? 0;
    // Le décalage s'applique AUSSI à l'en-tête : l'indication de tempo se pose depuis la marge
    // gauche (voir poserEnTete) et doit rester alignée sur le début des portées, pas sur le bord de
    // la page. Le titre, lui, est déjà centré sur la page — et le bloc l'étant désormais aussi, les
    // deux centres coïncident.
    const decalage = decalageDeCentrage(systemes, geo, S);
    const geoDecalee = decalage ? { ...geo, margeGauche: geo.margeGauche + decalage } : geo;
    if (geo.avecEnTete !== false) y = poserEnTete(primitives, partition, geoDecalee, y);

    // Chaque système note la PLAGE de primitives qu'il a produite. Comme ils se posent l'un après
    // l'autre, deux index suffisent — et la pagination du PDF découpe alors la liste au bon endroit
    // sans avoir à deviner à quel système appartient telle ligne d'après son ordonnée.
    const debutCorps = primitives.length;
    systemes.forEach((sys, iSys) => {
        const debutPrimitives = primitives.length;
        // Bande d'annotation : réservée pour CE système SEULEMENT si l'une de ses mesures en porte
        // une (voir HAUTEUR_ANNOTATION) — jamais pour tous les systèmes, une partition qui n'annote
        // rien ne doit voir aucune de ses lignes s'écarter.
        const aUneAnnotation = sys.mesures.some(m => (m.ref.annotation || '').trim());
        const extraAnnotation = aUneAnnotation ? HAUTEUR_ANNOTATION * S : 0;
        // Bande des noms d'accords (« A7 », « E7 »… voir Évènement#accord) : même principe, réservée
        // seulement si l'un des évènements de CE système en porte un — SOUS l'annotation de section
        // si les deux coexistent, celle-ci restant le repère le plus large qu'on cherche d'abord en
        // parcourant la page (voir edit/raccourcis.js#accord).
        const aUnAccord = sys.mesures.some(m => m.ref.voix.some(v => v.evenements.some(e => (e.accord || '').trim())));
        const extraAccords = aUnAccord ? HAUTEUR_ACCORDS * S : 0;
        // Bande des repères de navigation : voir HAUTEUR_REPERE.
        const aUnRepere = sys.mesures.some(m => !!m.ref.repere);
        const extraRepere = aUnRepere ? HAUTEUR_REPERE * S : 0;
        const yAccords = y + extraAnnotation + 1.5 * S;
        const yAnnotation = y + 1.6 * S;
        const yPortee = y + geo.margeHaut * S + extraAnnotation + extraAccords + extraRepere;
        const yRepere = yPortee - geo.margeHaut * S - 0.2 * S;
        const yTab = yPortee + hauteurPortee + ecartPorteeTab * S;
        const xDebut = geo.margeGauche + decalage;
        // Largeur RÉELLE de ce système : la somme des largeurs FIXES de ses propres mesures (voir
        // l'étape 1, LARGEUR_PAR_NOIRE) — jamais la largeur nominale de la page. La justification par
        // étirement a disparu (étape 3, facteur toujours 1) : une ligne qui n'épuise pas la largeur
        // utile doit voir ses lignes de portée/TAB, son accolade et sa réglette s'arrêter où s'arrête
        // RÉELLEMENT sa dernière mesure. Les laisser courir jusqu'au bord nominal de la page (comme
        // avant, quand les mesures étaient de toute façon étirées jusque-là) dessinerait un blanc qui
        // ressemble à s'y méprendre à une mesure vide en trop.
        const xFin = xDebut + sys.mesures.reduce((t, m) => t + m.enTete + m.largeurNotes + 1.4 * S, 0);

        poserLignesSysteme(primitives, xDebut, xFin, yPortee, yTab, S, ST, cordes, avecPortee);
        // L'accolade dit « lisez ces deux portées ensemble » — sans portée de notation, il n'y a
        // plus qu'UNE portée (la TAB), rien à relier.
        // L'accolade relie DEUX portées : il en faut donc deux. Et la clé de TAB n'a pas de TAB à
        // coiffer quand celle-ci s'absente — sans ce garde-fou, son glyphe serait étiré sur une
        // hauteur nulle.
        if (avecPortee && avecTab) poserAccolade(primitives, xDebut, yPortee, yTab + hauteurTab, S);
        if (avecTab) poserCleTab(primitives, xDebut, yTab, ST, cordes);

        let x = xDebut;
        sys.mesures.forEach((m, iDansSys) => {
            // `sys.facteur` vaut toujours 1 (voir l'étape 3) : la largeur des notes est déjà fixée à
            // l'étape 1, indépendamment du contenu. On garde ce passage par `sys.facteur` — plutôt
            // qu'un `1` écrit en dur ici — pour qu'un seul endroit (l'étape 3) décide de la valeur.
            const facteurEffectif = sys.facteur;
            const largeurMesure = m.enTete + (m.largeurNotes + 1.4 * S) * facteurEffectif;
            const finMesure = x + largeurMesure;
            x = poserMesure(primitives, ancrages, partition, m, {
                x, largeurMesure, facteur: facteurEffectif, finMesure,
                yPortee, yTab, yAnnotation, yAccords, yRepere, S, ST, cordes, clef, geo, iSys, avecPortee,
                premiereDuSysteme: iDansSys === 0,
                liaisons, coupeApres: debutsDeSysteme.has(m.index + 1),
                xDebutSysteme: xDebut, xFinSysteme: xFin,
            });
        });

        ancrages.systemes.push({
            index: iSys, y, hauteur: hauteurSysteme + extraAnnotation + extraAccords + extraRepere, yPortee, yTab, xDebut, xFin, hauteurTab,
            // `yBas` : bas de la grille de notation, générique entre les deux mises en page (voir son
            // pendant côté piano dans mettreEnPagePiano) — pour que la bande de boucle et le reste du
            // code d'interaction n'aient jamais à savoir s'il existe une TAB sous la portée.
            yBas: yTab + hauteurTab,
            debutPrimitives, finPrimitives: primitives.length,
            premiereMesure: sys.mesures[0].index, derniereMesure: sys.mesures[sys.mesures.length - 1].index,
        });
        y += hauteurSysteme + extraAnnotation + extraAccords + extraRepere + geo.ecartSystemes * S;
    });

    // LA PAGE NE RÉTRÉCIT JAMAIS SON CONTENU POUR TENIR DANS largeurPage — un système qui ne peut
    // matériellement pas accueillir sa mesure la plus large sans dépasser (zoom élevé sur un écran
    // étroit, ou une seule mesure trop dense pour la largeur demandée) reste à sa largeur RÉELLE
    // (voir plus haut, xFin de chaque système), jamais compressé : la largeur fixe des mesures
    // (LARGEUR_PAR_NOIRE) est un invariant, pas une simple préférence qu'on écraserait ici en douce.
    // Sans ce `Math.max`, `largeur` valait TOUJOURS `geo.largeurPage`, même quand le contenu réel
    // allait plus loin — le SVG (voir render/svg.js, qui pose `width`/`viewBox` sur cette même
    // valeur) rognait alors silencieusement tout ce qui dépassait, INVISIBLE et INACCESSIBLE : rien
    // à voir, et donc rien à faire défiler pour l'atteindre — pas un geste de défilement bloqué, un
    // contenu qui n'existait tout simplement plus à l'écran (trouvé en vérifiant un signalement
    // « impossible de défiler horizontalement au téléphone »).
    const largeurContenu = Math.max(0, ...ancrages.systemes.map(s => s.xFin)) + geo.margeDroite;

    return {
        largeur: Math.max(geo.largeurPage, largeurContenu),
        hauteur: Math.max(y - geo.ecartSystemes * S, hauteurSysteme),
        primitives, ancrages,
        enTete: { debut: 0, fin: debutCorps },
        geo: { ...geo, S, ST, cordes, hauteurPortee, hauteurTab, hauteurSysteme, clef },
    };
}

// ---------------------------------------------------------------------------------------------
// PIANO — grand-portée (clé de sol + clé de fa), sans tablature.
//
// PREMIER JALON DU CHANTIER : la mise en page seule. Aucune note ne s'affiche encore (la saisie
// directement sur la portée viendra ensuite) — chaque mesure, toujours entièrement vide à ce stade,
// se dessine avec un simple silence de mesure entière sur chacune des deux portées, comme le fait
// toute partition gravée pour une mesure qui ne joue rien. Partage delibérément le MOINS de code
// possible avec mettreEnPage (seuls les découpages en systèmes, qui ignorent le contenu d'une
// portée, et les fabriques de primitives) : un maillage de conditions dans une fonction pensée pour
// guitare/basse depuis le début aurait fini par rendre LES DEUX plus difficiles à lire.
// ---------------------------------------------------------------------------------------------

function mettreEnPagePiano(partition, geo) {
    const S = geo.S;
    const clefSol = CLEFS.sol, clefFa = CLEFS.fa;
    const hauteurPortee = 4 * S;
    // Entre les deux portées : assez pour que la clé de fa, son armure et son chiffrage (chacune sa
    // PROPRE portée les affiche, jamais partagés — la convention de gravure d'un grand-portée) s'y
    // tiennent sans jamais toucher la portée de sol au-dessus.
    const ecartPortees = 7 * S;
    const hauteurSysteme = geo.margeHaut * S + hauteurPortee + ecartPortees + hauteurPortee + geo.margeBas * S;
    const largeurUtile = geo.largeurPage - geo.margeGauche - geo.margeDroite;

    // --- 1. Mesurer : la largeur d'une mesure ne dépend QUE de sa capacité (LARGEUR_PAR_NOIRE,
    // exactement la même règle que guitare/basse), JAMAIS de son contenu — voir repartirParTemps.
    // Les COLONNES, elles, en dépendent bien (calculerColonnes, la même fonction que guitare/basse,
    // déjà générique : elle ne lit que `mesure.voix`, jamais ce qui distingue un manche d'un clavier) —
    // c'est elles qui donnent à chaque évènement sa vraie place quand deux mains n'attaquent pas au
    // même instant. L'en-tête (clé/armure/chiffrage) se calcule pour LES DEUX clés, et c'est la plus
    // large des deux qui compte : les deux portées doivent démarrer leurs notes au MÊME x, sans quoi
    // la promesse même d'un grand-portée (lire les deux mains ensemble) serait rompue au premier
    // changement d'armure. -----------------------------------------------------------------------
    const mesures = partition.mesures.map((mesure, i) => {
        const sig = signatureEffective(partition, i);
        const arm = armureEffective(partition, i);
        const capacite = noiresParMesure(sig);
        const colonnes = calculerColonnes(mesure, capacite, S);
        const largeurNotes = capacite * LARGEUR_PAR_NOIRE * S;
        repartirParTemps(colonnes, capacite, uniteDeGroupement(sig), largeurNotes);
        return {
            index: i, ref: mesure, signature: sig, armure: arm, capacite, colonnes,
            largeurNotes,
            changeSignature: !!mesure.signature,
            changeArmure: mesure.armure !== null && mesure.armure !== undefined,
            // Même signal d'alerte que guitare/basse (voir poserMesure) : une voix dont le total ne
            // tombe PAS exactement sur la capacité de la mesure, à traiter avant que la portée
            // n'affiche silencieusement un rythme qui ne correspond plus à ce qui est réellement écrit.
            invalide: mesure.voix.some(v => Math.abs(
                v.evenements.reduce((t, e) => t + dureeEnNoires(e.duree), 0) - capacite) > 1e-6),
            ecart: ecartLePlusGrand(mesure, capacite),
        };
    });

    const besoinsDePiano = (m, premiereDuSysteme) => ({
        clef: premiereDuSysteme,
        armure: premiereDuSysteme || m.changeArmure,
        signature: m.index === 0 || m.changeSignature,
        repriseDebut: m.ref.repriseDebut,
    });
    const mesurerPiano = (m, besoins) => {
        m.besoins = besoins;
        m.enTete = Math.max(
            largeurEnTete(besoins, m.armure, m.signature, clefSol, S),
            largeurEnTete(besoins, m.armure, m.signature, clefFa, S),
        );
        m.largeurTotale = m.enTete + m.largeurNotes + 1.4 * S;
        return m.largeurTotale;
    };

    // --- 2. Découpage en systèmes : les MÊMES fonctions que guitare/basse (voir plus haut) — elles
    // ne lisent que largeurTotale/besoins, jamais ce qui distingue une TAB d'une seconde portée. ---
    const nMesuresParLigne = geo.mesuresParLigne ? Math.max(1, Math.round(geo.mesuresParLigne)) : null;
    const mesurer = (m, premiere) => mesurerPiano(m, besoinsDePiano(m, premiere));
    const systemes = nMesuresParLigne
        ? decouperEnSystemesParCompte(mesures, nMesuresParLigne, mesurer)
        : decouperEnSystemesGloutons(mesures, largeurUtile, mesurer);

    // --- 3. Poser --------------------------------------------------------------------------------
    const primitives = [];
    const ancrages = { evenements: [], mesures: [], systemes: [] };
    // Une entrée par voix : la liaison qu'une mesure laisse ouverte, que la suivante refermera
    // (voir reporterLiaison).
    const liaisons = new Map();
    // LES MESURES QUI COMMENCENT UN SYSTÈME, connues AVANT la pose : c'est ce qui permet de savoir,
    // en posant une mesure, si un saut de ligne la sépare de la suivante — donc s'il faut tracer un
    // demi-arc de départ tout de suite, dans la tranche de primitives de CE système.
    const debutsDeSysteme = new Set(systemes.map(sys => sys.mesures[0]?.index).filter(i => i != null));
    let y = geo.yDepart ?? 0;
    const decalage = decalageDeCentrage(systemes, geo, S);   // voir decalageDeCentrage
    const geoDecalee = decalage ? { ...geo, margeGauche: geo.margeGauche + decalage } : geo;
    if (geo.avecEnTete !== false) y = poserEnTete(primitives, partition, geoDecalee, y);
    const debutCorps = primitives.length;

    systemes.forEach((sys, iSys) => {
        const debutPrimitives = primitives.length;
        const yPortee = y + geo.margeHaut * S;          // portée de SOL — même nom que guitare/basse,
        const yPorteeFa = yPortee + hauteurPortee + ecartPortees;   // pour que les ancrages restent lisibles pareil
        const xDebut = geo.margeGauche + decalage;
        const xFin = xDebut + sys.mesures.reduce((t, m) => t + m.enTete + m.largeurNotes + 1.4 * S, 0);

        for (let i = 0; i < 5; i++) {
            primitives.push(ligne(xDebut, yPortee + i * S, xFin, yPortee + i * S, G.EPAISSEURS.ligneePortee * S));
            primitives.push(ligne(xDebut, yPorteeFa + i * S, xFin, yPorteeFa + i * S, G.EPAISSEURS.ligneePortee * S));
        }
        poserAccolade(primitives, xDebut, yPortee, yPorteeFa + 4 * S, S);

        let x = xDebut;
        sys.mesures.forEach((m, iDansSys) => {
            const largeurMesure = m.enTete + m.largeurNotes + 1.4 * S;
            const finMesure = x + largeurMesure;
            x = poserMesurePiano(primitives, ancrages, partition, m, {
                x, finMesure, yPortee, yPorteeFa, S, iSys, premiereDuSysteme: iDansSys === 0, geo, facteur: 1,
                liaisons, coupeApres: debutsDeSysteme.has(m.index + 1),
                xDebutSysteme: xDebut, xFinSysteme: xFin,
            });
        });

        ancrages.systemes.push({
            index: iSys, y, hauteur: hauteurSysteme, yPortee, yPorteeFa, xDebut, xFin,
            // Pendant de guitare/basse (voir l'autre ancrages.systemes.push) : bas de la portée de fa,
            // pas de TAB à cette échelle.
            yBas: yPorteeFa + hauteurPortee,
            debutPrimitives, finPrimitives: primitives.length,
            premiereMesure: sys.mesures[0].index, derniereMesure: sys.mesures[sys.mesures.length - 1].index,
        });
        y += hauteurSysteme + geo.ecartSystemes * S;
    });

    // Même invariant que guitare/basse (voir mettreEnPage) : la page grandit pour accueillir un
    // système trop large plutôt que d'en rogner le contenu.
    const largeurContenu = Math.max(0, ...ancrages.systemes.map(s => s.xFin)) + geo.margeDroite;

    return {
        largeur: Math.max(geo.largeurPage, largeurContenu),
        hauteur: Math.max(y - geo.ecartSystemes * S, hauteurSysteme),
        primitives, ancrages,
        enTete: { debut: 0, fin: debutCorps },
        geo: { ...geo, S, hauteurPortee, hauteurSysteme, ecartPortees, grandPortee: true },
    };
}

/** Une mesure de piano : clé(s), armure, chiffrage — sur les DEUX portées —, un silence de mesure
 *  entière sur chacune (aucune note n'existe encore à ce stade du chantier), et la barre de fin,
 *  qui doit traverser les DEUX portées d'un seul trait — la convention de gravure d'un grand-portée,
 *  à la différence de guitare/basse où portée et TAB restent deux systèmes verticalement distincts. */
function poserMesurePiano(out, ancrages, partition, m, ctx) {
    const { yPortee, yPorteeFa, S, geo, facteur } = ctx;
    const xDebutMesure = ctx.x;

    // Même signal qu'en guitare/basse (voir poserMesure) : une voix dont le total ne tombe pas
    // EXACTEMENT sur la capacité de la mesure, teintée en fond plutôt que laissée à se désaccorder
    // en silence — sur TOUTE la largeur du grand-portée, portée de fa comprise.
    if (m.invalide && geo?.avertirErreurs !== false) {
        out.push(rect(xDebutMesure, yPortee, ctx.finMesure - xDebutMesure, (yPorteeFa + 4 * S) - yPortee, 'avertissement'));
    }

    const poserEnTeteStaff = (x0, yP, clef) => {
        let x = x0;
        if (m.besoins.clef) {
            out.push(glyphe(clef.glyphe, x + 0.45 * S, yP + clef.ligne * S, S));
            x += (G.largeurDe(clef.glyphe) + 0.9) * S;
        }
        if (m.besoins.armure && m.armure !== 0) {
            const alt = m.armure > 0 ? G.DIESE : G.BEMOL;
            const avance = (G.largeurDe(alt) + 0.08) * S;
            positionsArmure(m.armure, clef).forEach(pas => {
                out.push(glyphe(alt, x, yDeLaPosition(pas, yP, S, clef), S));
                x += avance;
            });
            x += 0.5 * S;
        }
        if (m.besoins.signature) {
            const haut = G.chiffresDe(m.signature.battements);
            const bas = G.chiffresDe(m.signature.unite);
            const largeur = Math.max(haut.largeur, bas.largeur);
            const poserSuite = (suite, y) => {
                let cx = x + 0.45 * S + ((largeur - suite.largeur) / 2) * S;
                for (const g of suite.glyphes) {
                    cx += (G.largeurDe(g) / 2) * S;
                    out.push(glyphe(g, cx, y, S));
                    cx += (G.largeurDe(g) / 2) * S;
                }
            };
            poserSuite(haut, yP + 1 * S);
            poserSuite(bas, yP + 3 * S);
            x += (largeur + 0.9) * S;
        }
    };
    // Barre de reprise ouvrante — comme la barre de fin plus bas, un seul trait/une seule paire de
    // points qui traverse les DEUX portées (jamais deux barres de reprise indépendantes) : décale le
    // point de départ des DEUX en-têtes d'autant, exactement l'espace réservé par largeurEnTete.
    let xApresReprise = xDebutMesure;
    if (m.ref.repriseDebut) {
        const yBasGrandPortee = yPorteeFa + 4 * S;
        out.push(rect(xDebutMesure, yPortee, G.EPAISSEURS.barreEpaisse * S, yBasGrandPortee - yPortee));
        const xf = xDebutMesure + G.EPAISSEURS.barreEpaisse * S + 0.32 * S;
        out.push(ligne(xf, yPortee, xf, yBasGrandPortee, G.EPAISSEURS.barreMesure * S));
        const xp = xf + 0.55 * S;
        out.push(glyphe(G.POINT, xp, yPortee + 1.5 * S, S));
        out.push(glyphe(G.POINT, xp, yPortee + 2.5 * S, S));
        out.push(glyphe(G.POINT, xp, yPorteeFa + 1.5 * S, S));
        out.push(glyphe(G.POINT, xp, yPorteeFa + 2.5 * S, S));
        xApresReprise = xp + 0.9 * S;
    }
    poserEnTeteStaff(xApresReprise, yPortee, CLEFS.sol);
    poserEnTeteStaff(xApresReprise, yPorteeFa, CLEFS.fa);

    // Numéro de mesure, au-dessus de la portée de sol — la même place que guitare/basse.
    out.push(texte(xDebutMesure + m.enTete + 0.2 * S, yPortee - 1.6 * S, String(m.index + 1), {
        taille: S * 1.05, police: 'sans-serif', poids: '600', ancre: 'debut', couleur: 'discret',
    }));

    // Et de combien elle déborde, à l'autre bout — voir poserMesure, qui raconte pourquoi le chiffre
    // vaut mieux qu'un simple signe et pourquoi il est ancré à droite.
    if (m.ecart && geo?.avertirErreurs !== false) {
        out.push(texte(ctx.finMesure - 0.3 * S, yPortee - 1.6 * S, libelleEcart(m.ecart), {
            taille: S * 1.05, police: 'sans-serif', poids: '700', ancre: 'fin', couleur: 'dette',
        }));
    }

    // --- Les notes : VOIX 0 sur la portée de sol (main droite), VOIX 1 sur celle de fa (main
    // gauche) — deux voix déjà du modèle (voir edit/commands.js#ajouterVoix, jusqu'ici mélodie +
    // basse tenue sur une seule portée guitare/basse), ici réparties chacune sur SA PROPRE portée :
    // la convention même de la musique pianistique, et ELLE ÉVITE d'avoir à décider quelle hauteur
    // « appartient » à quelle main d'après sa seule valeur — la partition le dit déjà. Une mesure
    // sans voix 1 (le cas courant tant qu'on n'a rien joué à la main gauche) montre un silence de
    // mesure entière sur la portée de fa, comme une voix normalement remplie mais vide.
    // Même moteur, mêmes TROIS PASSES que poserMesure (têtes puis hampes/ligatures puis liaisons) —
    // voir son commentaire pour la justification de l'ordre. `cordes: 0` y désactive la tablature
    // (voir poserEvenement) : seule la portée compte au piano.
    const xNotes = xDebutMesure + m.enTete;
    const xColonnes = [];
    { let xx = xNotes; for (const c of m.colonnes) { xColonnes.push(xx); xx += c.largeur * facteur; } }
    const xFinMesureNotes = xColonnes.length ? xColonnes[xColonnes.length - 1] + m.colonnes[m.colonnes.length - 1].largeur * facteur : xNotes;
    const colonneA = (t) => {
        const cible = Math.round(t * 1e6) / 1e6;
        const i = m.colonnes.findIndex(c => c.debut >= cible - 1e-6);
        return i < 0 ? m.colonnes.length : i;
    };

    const memoire = memoireAlterations(m.armure);   // partagée par les deux mains, comme la mesure entière
    const notesParPasEtColonne = new Map();
    const STAVES = [{ yPortee: yPortee, clef: CLEFS.sol }, { yPortee: yPorteeFa, clef: CLEFS.fa }];
    const nbVoix = m.ref.voix.length;

    m.ref.voix.forEach((voixRef, iVoix) => {
        const staff = STAVES[iVoix] || STAVES[1];   // filet : jamais plus de deux voix (MAX_VOIX)
        const poses = [];
        let t = 0;
        voixRef.evenements.forEach((ref, iEvenement) => {
            const duree = dureeEnNoires(ref.duree);
            const iCol = colonneA(t);
            const xDebutEvt = xColonnes[iCol];
            const largeurPremiereColonne = m.colonnes[iCol].largeur * facteur;
            const xNote = xDebutEvt + largeurPremiereColonne * 0.42;
            const iColFin = colonneA(t + duree);
            const xFinEvt = iColFin < xColonnes.length ? xColonnes[iColFin] : xFinMesureNotes;

            const pose = poserEvenement(out, partition, ref, {
                x: xNote, xDebut: xDebutEvt, largeur: largeurPremiereColonne,
                yPortee: staff.yPortee, yTab: undefined, S, ST: undefined, cordes: 0, clef: staff.clef,
                memoire, geo, sensImpose: null, decalageSilence: 0, notesParPasEtColonne, cleColonne: `${iVoix}:${iCol}`,
            });
            poses.push(pose);
            ancrages.evenements.push({
                mesure: m.index, voix: iVoix, evenement: iEvenement, ref,
                x: xNote, xDebut: xDebutEvt, xFin: xFinEvt, yPortee: staff.yPortee, yPorteeFa,
                // Pendant de guitare/basse (voir l'autre ancrages.evenements.push) : bas de la grille
                // de notation — ici le bas de la portée de FA, quelle que soit la main (voix) visée,
                // pour que le bandeau du curseur (main.js#marquesCurseur) couvre le grand-portée
                // ENTIER plutôt que de s'arrêter au milieu, entre les deux mains.
                yBas: yPorteeFa + 4 * S,
            });
            t += duree;
        });

        const groupes = grouperLigatures(poses, m.signature);
        poserHampes(out, poses, groupes, S);
        poserArticulations(out, poses, S);
        poserNolets(out, poses, groupes, S, staff.yPortee, m.signature);
        poserLiaisons(out, poses, S, undefined);
        // Voir son pendant guitare/basse. `ST` absent : un grand-portée n'a pas de tablature.
        reporterLiaison(out, ctx, iVoix, m.index, poses, S, undefined, !!ctx.coupeApres);
    });

    // Voix 1 absente (mesure jamais jouée à la main gauche) : la portée de fa garde son silence de
    // mesure entière, comme une voix qui existerait mais n'aurait rien à y dire.
    if (nbVoix < 2) {
        const g = G.SILENCES[1];
        const demi = (G.largeurDe(g) / 2) * S;
        const centre = xNotes + m.largeurNotes / 2;
        out.push(glyphe(g, centre - demi, yPorteeFa + (G.LIGNE_SILENCE[1] ?? 1) * S, S));
    }

    // Barre de fin de mesure — un seul trait continu du haut de la portée de sol au bas de celle de
    // fa (jamais deux traits séparés comme portée/TAB) : sur un grand-portée, c'est la MÊME barre.
    const xBarre = ctx.finMesure;
    if (m.ref.repriseFin) {
        const xp = xBarre - 1.5 * S;
        out.push(glyphe(G.POINT, xp, yPortee + 1.5 * S, S));
        out.push(glyphe(G.POINT, xp, yPortee + 2.5 * S, S));
        out.push(glyphe(G.POINT, xp, yPorteeFa + 1.5 * S, S));
        out.push(glyphe(G.POINT, xp, yPorteeFa + 2.5 * S, S));
        const xf = xBarre - 0.75 * S;
        out.push(ligne(xf, yPortee, xf, yPorteeFa + 4 * S, G.EPAISSEURS.barreMesure * S));
        out.push(rect(xBarre - G.EPAISSEURS.barreEpaisse * S - 0.1 * S, yPortee, G.EPAISSEURS.barreEpaisse * S, (yPorteeFa + 4 * S) - yPortee));
    } else if (m.ref.barre === 'finale') {
        const xf = xBarre - G.EPAISSEURS.barreEpaisse * S - 0.6 * S;
        out.push(ligne(xf, yPortee, xf, yPorteeFa + 4 * S, G.EPAISSEURS.barreMesure * S));
        out.push(rect(xBarre - G.EPAISSEURS.barreEpaisse * S, yPortee, G.EPAISSEURS.barreEpaisse * S, (yPorteeFa + 4 * S) - yPortee));
    } else if (m.ref.barre === 'double') {
        const xf = xBarre - 0.55 * S;
        out.push(ligne(xf, yPortee, xf, yPorteeFa + 4 * S, G.EPAISSEURS.barreMesure * S));
        out.push(ligne(xBarre, yPortee, xBarre, yPorteeFa + 4 * S, G.EPAISSEURS.barreMesure * S));
    } else {
        out.push(ligne(xBarre, yPortee, xBarre, yPorteeFa + 4 * S, G.EPAISSEURS.barreMesure * S));
    }

    poserRepere(out, m.ref, xDebutMesure, xBarre, yPortee, S);   // voir poserRepere

    ancrages.mesures.push({
        index: m.index, x: xDebutMesure, xFin: xBarre, xNotes, yPortee, yPorteeFa, systeme: ctx.iSys,
        capacite: m.capacite, largeurNotes: m.largeurNotes,
    });
    return xBarre;
}

// ---------------------------------------------------------------------------------------------
// En-tête du morceau
// ---------------------------------------------------------------------------------------------

/**
 * SEGNO (𝄋) et CODA (𝄌), tracés à la main.
 *
 * POURQUOI TRACÉS et non écrits. Ces deux signes n'existent ni dans Times New Roman ni dans
 * Helvetica — les deux seules familles que la partition s'autorise, parce que ce sont celles que
 * jsPDF sait composer (voir render/svg.js, qui commente ce choix) : les demander en caractères
 * Unicode sortirait un carré vide à l'impression, là où tout le reste est juste. Ils ne figurent pas
 * davantage dans le jeu de glyphes de l'application (voir engine/glyphs.js), qui couvre la notation
 * de hauteur et de durée, jamais les renvois. Deux tracés, donc — écran et PDF identiques, comme
 * tout le reste de cette feuille.
 *
 * L'échelle est TOUJOURS l'interligne (`S`), comme pour n'importe quelle primitive d'ici : changer S
 * change la partition entière sans toucher à une seule coordonnée.
 */
function tracerSegno(out, x, y, S) {
    // Un S oblique barré, flanqué de deux points — la forme consacrée.
    // LE S EN DEUX LOBES, chacun une cubique dont les poignées partent DU MÊME CÔTÉ que le lobe :
    // c'est ce qui fait le contre-courbe. Une première version plaçait ces poignées de part et
    // d'autre, et les deux moitiés se repliaient l'une sur l'autre — à la taille d'une portée, le
    // résultat ne se lisait pas comme un S mais comme une tache (vérifié à la loupe).
    const a = S * 0.42;
    const ep = G.EPAISSEURS.barreMesure * S * 1.1;
    out.push(courbe(`M ${x + a} ${y - 2 * a} `
        + `C ${x - a} ${y - 2.6 * a} ${x - a} ${y - 0.4 * a} ${x} ${y} `
        + `C ${x + a} ${y + 0.4 * a} ${x + a} ${y + 2.6 * a} ${x - a} ${y + 2 * a}`, ep));
    // La diagonale traverse le S de bas gauche à haut droite, et déborde des deux lobes.
    out.push(courbe(`M ${x - 1.5 * a} ${y + 2.4 * a} L ${x + 1.5 * a} ${y - 2.4 * a}`, ep));
    // Les deux points : le MÊME glyphe que les points de reprise (G.POINT), à une échelle réduite —
    // plutôt qu'une primitive « cercle » que le moteur n'a pas, et qu'il faudrait faire porter aux
    // deux renderers (écran ET PDF) pour deux points.
    // Les deux points, chacun dans le quadrant libre laissé par la diagonale (haut-gauche et
    // bas-droite) : le MÊME glyphe que les points de reprise (G.POINT), à une échelle réduite —
    // plutôt qu'une primitive « cercle » que le moteur n'a pas, et qu'il faudrait faire porter aux
    // deux renderers (écran ET PDF) pour deux points.
    out.push(glyphe(G.POINT, x - 1.35 * a, y - 1.1 * a, S * 0.55));
    out.push(glyphe(G.POINT, x + 1.35 * a, y + 1.1 * a, S * 0.55));
}

function tracerCoda(out, x, y, S) {
    // Un cercle traversé d'une croix, débordant de part et d'autre — le signe de la coda.
    const r = S * 0.78;
    const ep = G.EPAISSEURS.barreMesure * S * 1.3;
    const c = r * 0.72;
    // Le cercle en DEUX ARCS (`courbe` est un tracé au trait, jamais rempli) : un seul arc de 360°
    // est dégénéré en SVG — début et fin confondus, le navigateur ne dessine alors rien du tout.
    out.push(courbe(`M ${x - c} ${y} A ${c} ${c} 0 0 1 ${x + c} ${y} A ${c} ${c} 0 0 1 ${x - c} ${y}`, ep));
    out.push(courbe(`M ${x - r * 1.15} ${y} L ${x + r * 1.15} ${y}`, ep));
    out.push(courbe(`M ${x} ${y - r * 1.15} L ${x} ${y + r * 1.15}`, ep));
}

/**
 * Pose le repère de navigation d'une mesure, s'il en porte un — signe tracé ou instruction écrite,
 * selon la famille (voir model/score.js, REPERES).
 *
 * À GAUCHE DE LA MESURE et au-dessus de la portée : c'est là qu'un musicien cherche un renvoi, parce
 * que c'est là qu'il arrive en lisant. Les instructions sont en ITALIQUE, comme toute indication de
 * jeu sur une partition gravée — et en retrait à droite (`al Coda` se lit après la barre qu'il
 * concerne), tandis qu'un signe se pose franchement sur le début de la mesure.
 */
function poserRepere(out, mesure, x, xFin, y, S) {
    const def = REPERES[mesure.repere];
    if (!def) return;
    // Les deux SIGNES sont dessinés à 1,25 S : à l'échelle de la portée, ils doivent se reconnaître
    // d'un coup d'œil comme une cible de renvoi, pas se deviner. Mesuré à 0,9 S d'abord — illisible.
    if (def.symbole === 'segno') { tracerSegno(out, x + S * 1.3, y, S * 1.25); return; }
    if (def.symbole === 'coda') { tracerCoda(out, x + S * 1.3, y, S * 1.25); return; }
    // Les INSTRUCTIONS se calent à DROITE de la mesure : « D.C. » ou « Fine » se lisent après ce qui
    // les précède, jamais avant — c'est l'ordre dans lequel on joue.
    out.push(texte(xFin - S * 0.4, y + S * 0.55, def.texte, {
        taille: S * 1.75, police: 'serif', poids: '700', italique: true, ancre: 'fin',
    }));
}

/**
 * DÉCALAGE HORIZONTAL qui centre le bloc de musique dans la page.
 *
 * Retour utilisateur : « la portée doit être centrée horizontalement (attention, sur téléphone elle
 * doit rester à gauche) ». La largeur des mesures est FIXÉE par leur signature (voir LARGEUR_PAR_NOIRE)
 * et la justification par étirement n'existe plus (voir l'étape 3) : une page plus large que sa
 * musique laissait donc tout le blanc à DROITE, la portée collée à la marge gauche — ce que montrait
 * la capture, avec la moitié droite du papier vide.
 *
 * UN SEUL décalage pour tous les systèmes, calculé sur le PLUS LARGE d'entre eux, et jamais un
 * centrage ligne par ligne : dans une partition gravée, toutes les portées d'une page partagent la
 * même marge gauche. Les centrer chacune sur sa propre largeur ferait zigzaguer leurs débuts d'un
 * système à l'autre, et le regard perdrait le repère vertical qui lui sert à descendre la page.
 *
 * Ne se déclenche que sur demande (`geo.centrer`) : sur téléphone la portée reste à gauche, et le
 * PDF garde sa marge gauche de document imprimé.
 */
function decalageDeCentrage(systemes, geo, S) {
    if (!geo.centrer) return 0;
    const largeurBloc = Math.max(0, ...systemes.map(sys =>
        sys.mesures.reduce((t, m) => t + m.enTete + m.largeurNotes + 1.4 * S, 0)));
    // Centré sur la PAGE, et non dans la largeur utile (page moins les deux marges) : les marges
    // gauche et droite sont inégales (34 contre 22 — l'accolade et le « TAB » vertical logent à
    // gauche, voir GEO_DEFAUT), si bien qu'un centrage dans la largeur utile décalait l'encre de 6px
    // du vrai centre. Six pixels invisibles en soi, mais le TITRE se pose exactement sur
    // `largeurPage / 2` (voir poserEnTete) : il ne se serait plus trouvé à l'aplomb du milieu de sa
    // propre portée, et c'est ce genre de désalignement qu'on voit sans savoir le nommer.
    // `xDebut` valant `margeGauche + decalage`, on retire la marge pour viser le centre exact ; le
    // plancher à zéro rend sa marge gauche normale à une musique plus large que sa page.
    return Math.max(0, (geo.largeurPage - largeurBloc) / 2 - geo.margeGauche);
}

/**
 * Titre, sous-titre, artiste centrés, puis l'indication de tempo à gauche.
 *
 * Les trois lignes de titre sont facultatives et le bloc se resserre quand elles manquent : une
 * partition sans artiste ne doit pas garder un blanc à sa place. Renvoie l'ordonnée où le premier
 * système peut commencer.
 */
function poserEnTete(out, partition, geo, y) {
    const S = geo.S;
    const centre = geo.largeurPage / 2;
    const meta = partition.meta || {};
    // `E` : l'échelle du bloc de titre (voir GEO_DEFAUT#echelleEnTete). Elle multiplie les tailles
    // ET les avances verticales du bloc, jamais la musique qui suit — le tempo, la tonalité et les
    // portées gardent leurs proportions de gravure quoi qu'on fasse du titre.
    const E = geo.echelleEnTete ?? 1;
    let yy = y + S * 2.6 * E;

    // LES TROIS LIGNES SE MODIFIENT D'UN CLIC, là où elles s'affichent (retour utilisateur : « on
    // risque de se perdre pour savoir comment changer le titre [...] permets-moi de modifier titre /
    // sous-titre / artiste au niveau du titre au-dessus de la portée directement »). La `classe` est
    // tout ce que le moteur fournit : elle donne à l'interface une prise sur le texte rendu (voir
    // main.js#ouvrirEditeurEnTete), et le moteur n'en sait pas plus — il ne connaît ni clic ni DOM.
    if (meta.titre) {
        out.push(texte(centre, yy + S * 2.1 * E, meta.titre, { taille: S * 3.1 * E, police: 'serif', poids: '700', classe: 'en-tete-champ en-tete-titre' }));
        yy += S * 3.6 * E;
    } else if (geo.enTeteEditable) {
        // TITRE VIDE : un fantôme cliquable, à l'écran SEULEMENT. Sans lui, effacer son titre
        // supprimerait du même coup le seul endroit où le retaper — un cul-de-sac dont on ne sort
        // plus que par les Réglages, ce qui est exactement le détour que ce clic vient supprimer.
        // Absent du PDF (`enTeteEditable` n'y est pas posé) : un document imprimé n'a pas de champ
        // à remplir, et le bloc de titre y retrouve sa hauteur exacte, resserrée sur ce qui existe.
        out.push(texte(centre, yy + S * 2.1 * E, 'Titre', { taille: S * 3.1 * E, police: 'serif', poids: '700', couleur: 'discret', classe: 'en-tete-champ en-tete-titre en-tete-vide' }));
        yy += S * 3.6 * E;
    }
    if (meta.sousTitre) {
        out.push(texte(centre, yy + S * 1.1 * E, meta.sousTitre, { taille: S * 1.6 * E, police: 'serif', poids: '500', classe: 'en-tete-champ en-tete-sous-titre' }));
        yy += S * 2.1 * E;
    }
    if (meta.artiste) {
        out.push(texte(centre, yy + S * 1.15 * E, meta.artiste, { taille: S * 1.75 * E, police: 'serif', poids: '700', classe: 'en-tete-champ en-tete-artiste' }));
        yy += S * 2.3 * E;
    }

    // Indication de tempo : la FIGURE de note plutôt que le mot « noire ». C'est la notation
    // universelle, lisible sans traduction, et elle dit du même coup quelle figure vaut le battement.
    if (meta.tempo) {
        // La figure du tempo est un glyphe à part entière de Bravura (tête ET hampe d'un seul tenant),
        // et non une tête à laquelle on ajouterait un trait : ses proportions sont celles d'une note
        // d'indication métronomique, plus ramassée qu'une note de portée.
        // ATTENTION À L'ÉCHELLE : l'argument d'un glyphe est une TAILLE D'INTERLIGNE, pas un facteur.
        const ech = S * 0.95;
        const xt = geo.margeGauche + S * 0.7;
        const yt = yy + S * 2.4;
        out.push(glyphe(G.NOIRE_TEMPO, xt, yt, ech));
        const apresFigure = xt + (G.largeurDe(G.NOIRE_TEMPO) * ech) + S * 0.4;
        const battement = `= ${Math.round(meta.tempo)}`;
        out.push(texte(apresFigure, yt + S * 0.3, battement, {
            taille: S * 1.7, police: 'serif', poids: '700', ancre: 'debut',
        }));
        // Où la ligne d'indications peut continuer. La largeur du texte est APPROCHÉE (0,52 em par
        // caractère en Times gras) : le moteur ne mesure pas de texte — il n'a ni canvas ni DOM, et
        // c'est ce qui lui permet de servir l'écran ET le PDF sans les départager. Une approximation
        // généreuse suffit : elle ne sert qu'à espacer des mentions, pas à aligner quoi que ce soit.
        let xSuite = apresFigure + battement.length * S * 1.7 * 0.52;
        // LA TONALITÉ, à côté du tempo (retour utilisateur : « j'aimerais voir la tonalité du morceau
        // à côté de l'indication de tempo au-dessus de la portée »). Elle est DÉJÀ sur la portée, en
        // altérations à la clé — mais une armure ne dit pas si le morceau est en do majeur ou en la
        // mineur : les deux portent exactement les mêmes altérations, aucune. C'est précisément la
        // distinction que le nom apporte, et la raison pour laquelle TabHub liste des TONALITÉS
        // plutôt que des armures dans sa barre d'outils (voir ui/toolbar.js, selTonalite).
        //
        // Celle de la PREMIÈRE mesure : c'est la tonalité du morceau. Un changement en cours de route
        // se lit à son armure, là où il se produit — l'annoncer en tête serait faux pour tout ce qui
        // précède. `partition` est passée entière ici (et non la seule `meta`) : armure et mode
        // s'héritent de mesure en mesure, seules armureEffective/modeEffectif savent les résoudre.
        if (partition.mesures?.length) {
            const t = tonaliteDe(armureEffective(partition, 0), modeEffectif(partition, 0));
            // `nomLong` (« C majeur ») et non `nom` (« CM ») : voir TONALITES dans model/theory.js.
            const xTonalite = xSuite + S * 1.1;
            out.push(texte(xTonalite, yt + S * 0.3, t.nomLong, {
                taille: S * 1.7, police: 'serif', poids: '500', ancre: 'debut',
            }));
            xSuite = xTonalite + t.nomLong.length * S * 1.7 * 0.52;
        }
        // LE TERNAIRE SE DÉCLARE LÀ, au bout de la ligne des indications : tempo, tonalité, puis
        // la façon de lire les croches. Les trois disent comment jouer ce qui suit, et se lisent
        // d'un seul balayage — un signe posé ailleurs demanderait de le chercher.
        if (meta.ternaire) poserIndicationTernaire(out, xSuite + S * 1.4, yt - S * 0.15, S);
        yy += S * 3.2;
    } else if (meta.ternaire) {
        // SANS TEMPO, l'indication tient sa ligne seule : le ternaire ne dépend pas d'un battement
        // chiffré, et une partition sans tempo se lit tout aussi ternaire.
        poserIndicationTernaire(out, geo.margeGauche + S * 0.7, yy + S * 2.25, S);
        yy += S * 3.2;
    }
    return yy + S * 0.4;
}

/**
 * Indication de RYTHME TERNAIRE : deux croches ligaturées « = » un triolet noire + croche.
 *
 * C'est la convention universelle du jazz, du blues et de la plupart des musiques populaires : on
 * ÉCRIT des croches droites — bien plus lisibles, et c'est tout l'intérêt — et cette indication dit
 * une fois pour toutes qu'elles se JOUENT longue-brève, deux tiers du temps puis un tiers. Sans
 * elle, il faudrait porter un triolet sur chaque temps : la partition devient illisible, et le
 * moindre remaniement oblige à recompter toutes les divisions à la main.
 *
 * Elle est GRAVÉE — têtes, hampes, ligature, crochet et chiffre de n-olet, les mêmes signes que la
 * musique en dessous — et non écrite en caractères Unicode. Trois raisons, dans cet ordre :
 *   1. le signe n'existe pas en un caractère : ni « deux croches ligaturées », ni « triolet » ;
 *   2. aucune police de texte ne dessine de ligature ni de crochet de n-olet ;
 *   3. le PDF reçoit exactement le même tracé que l'écran, sans police à embarquer — c'est la raison
 *      d'être de l'extraction des contours (voir outils/generer-glyphes.py).
 *
 * L'ÉCHELLE est celle d'une mention secondaire de gravure imprimée : un peu plus de la moitié de
 * l'interligne de la portée. Le repère `yBase` est le CENTRE des têtes de note, comme l'origine du
 * glyphe de tête (voir glyphs.js) — la hampe sort du flanc de la tête, à mi-hauteur, et tout le
 * reste du signe se mesure depuis là. Renvoie la largeur occupée, pour que l'appelant sache où
 * continuer sa ligne d'indications.
 */
function poserIndicationTernaire(out, x, yBase, S) {
    const ech = S * 0.58;
    const demi = G.largeurDe(G.TETE_NOIRE) / 2;              // demi-largeur d'une tête, en interlignes
    const epHampe = G.EPAISSEURS.hampe * ech;
    const xHampe = (xc) => xc + (demi - G.EPAISSEURS.hampe / 2) * ech;   // hampe montante : flanc droit
    const HAMPE = 3.0;                                        // longueur de hampe, en interlignes
    const yBout = yBase - HAMPE * ech;
    // Les deux paires n'ont pas le même écartement : celle de droite doit loger le crochet de n-olet
    // ET son chiffre entre ses deux hampes, là où celle de gauche n'a qu'une ligature à porter.
    const ECART_PAIRE = 1.75, ECART_NOLET = 2.7;

    const tete = (xc) => out.push(glyphe(G.TETE_NOIRE, xc, yBase, ech));
    const hampe = (xc) => {
        const xh = xHampe(xc);
        out.push(ligne(xh, yBase, xh, yBout, epHampe));
        return xh;
    };

    // --- Membre de gauche : deux croches ligaturées ------------------------------------------------
    const g1 = x + demi * ech;
    const g2 = g1 + ECART_PAIRE * ech;
    tete(g1); tete(g2);
    const xg1 = hampe(g1), xg2 = hampe(g2);
    // La ligature descend depuis le bout des hampes, comme dans poserHampes (hampe montante : le
    // rectangle s'épaissit vers le BAS, jamais au-delà du bout de la hampe).
    const epLigature = G.EPAISSEURS.ligature * ech;
    out.push(poly([[xg1, yBout], [xg2, yBout], [xg2, yBout + epLigature], [xg1, yBout + epLigature]]));

    // --- Le signe « égale » ------------------------------------------------------------------------
    // Le seul caractère de texte du signe, et le seul qui puisse l'être : « = » se dessine
    // identiquement dans toutes les polices à empattements, contrairement aux figures de note.
    const xEgal = g2 + (demi + 1.15) * ech;
    out.push(texte(xEgal, yBase + 0.52 * ech, '=', {
        taille: ech * 2.3, police: 'serif', poids: '700', ancre: 'milieu',
    }));

    // --- Membre de droite : triolet noire + croche -------------------------------------------------
    const d1 = xEgal + (1.15 + demi) * ech;
    const d2 = d1 + ECART_NOLET * ech;
    tete(d1); tete(d2);
    const xd1 = hampe(d1), xd2 = hampe(d2);
    // Le crochet de croche s'ancre par le HAUT de son dessin, au bout de la hampe (voir poserHampes) :
    // c'est l'ancrage SMuFL, et il fait tomber la courbe du bon côté sans calcul.
    out.push(glyphe(G.crochet(1, -1), xd2 - (G.EPAISSEURS.hampe / 2) * ech, yBout, ech));

    // Le crochet de n-olet ET son chiffre : ici le groupe n'est PAS ligaturé (une noire n'a pas de
    // ligature), donc le crochet est indispensable — c'est lui seul qui dit sur quoi porte le « 3 ».
    // Mêmes proportions que poserNolets, à l'échelle de l'indication.
    const yNolet = yBout - 0.95 * ech;
    const trois = G.CHIFFRES_NOLET[3];
    out.push(glyphe(trois, (xd1 + xd2) / 2, yNolet, ech));
    const patte = 0.55 * ech, marge = 0.78 * ech, epTrait = G.EPAISSEURS.liaison * ech;
    const milieu = (xd1 + xd2) / 2;
    out.push(ligne(xd1, yNolet + patte, xd1, yNolet, epTrait));
    out.push(ligne(xd1, yNolet, milieu - marge, yNolet, epTrait));
    out.push(ligne(milieu + marge, yNolet, xd2, yNolet, epTrait));
    out.push(ligne(xd2, yNolet, xd2, yNolet + patte, epTrait));

    return (d2 + demi * ech) - x;
}

// ---------------------------------------------------------------------------------------------
// Éléments de système
// ---------------------------------------------------------------------------------------------

function poserLignesSysteme(out, x1, x2, yPortee, yTab, S, ST, cordes, avecPortee = true) {
    if (avecPortee) for (let i = 0; i < 5; i++) out.push(ligne(x1, yPortee + i * S, x2, yPortee + i * S, G.EPAISSEURS.ligneePortee * S));
    for (let i = 0; i < cordes; i++) out.push(ligne(x1, yTab + i * ST, x2, yTab + i * ST, G.EPAISSEURS.ligneePortee * S));
}

/** Accolade droite reliant portée et tablature : elle dit qu'on lit les deux ENSEMBLE. */
function poserAccolade(out, x, yHaut, yBas, S) {
    const e = 0.42 * S, d = 0.55 * S;
    out.push(rect(x - d - e, yHaut, e, yBas - yHaut));
    out.push(rect(x - d - e, yHaut, d + e, 0.36 * S));
    out.push(rect(x - d - e, yBas - 0.36 * S, d + e, 0.36 * S));
    out.push(ligne(x, yHaut, x, yBas, G.EPAISSEURS.barreMesure * S));
}

/**
 * Clé de tablature — le glyphe SMuFL officiel, à la place de trois lettres empilées.
 *
 * Bravura en dessine un « TAB » vertical conçu pour ENJAMBER la portée de tablature, avec les
 * proportions et l'inclinaison des éditions gravées. Trois caractères d'une police de labeur posés
 * l'un sur l'autre, comme dans une version antérieure, se lisaient comme un mot écrit à la verticale,
 * pas comme une clé.
 */
/** Échelle et largeur RÉELLES (glyphe étiré à la hauteur de la TAB) — voir poserCleTab et
 * largeurEnTete, qui doivent s'accorder sur le MÊME calcul plutôt que le deviner chacune à part. */
function echelleCleTab(ST, cordes) {
    const hauteur = (cordes - 1) * ST;
    const g = G.cleTabPour(cordes);
    return hauteur / (G.boiteDe(g).bas - G.boiteDe(g).haut);
}
function largeurCleTab(ST, cordes) {
    return G.largeurDe(G.cleTabPour(cordes)) * echelleCleTab(ST, cordes);
}

function poserCleTab(out, x, yTab, ST, cordes) {
    const hauteur = (cordes - 1) * ST;
    const g = G.cleTabPour(cordes);
    // Le glyphe est dessiné pour une portée standard : on l'étire à la hauteur RÉELLE de la
    // tablature, qui dépend du nombre de cordes et de l'espacement choisi. Exactement à cette
    // hauteur, sans marge : la clé de tablature ENJAMBE la portée, elle n'en déborde pas.
    out.push(glyphe(g, x + 0.5 * ST, yTab + hauteur / 2, echelleCleTab(ST, cordes)));
}

// ---------------------------------------------------------------------------------------------
// Une mesure
// ---------------------------------------------------------------------------------------------

function poserMesure(out, ancrages, partition, m, ctx) {
    const { yPortee, yTab, yAnnotation, yAccords, yRepere, S, ST, cordes, clef, geo, facteur, avecPortee = true } = ctx;
    const hauteurTab = (cordes - 1) * ST;
    let x = ctx.x;
    const xDebutMesure = x;

    // Une voix qui ne totalise pas la capacité de la mesure (trop ou pas assez, voir l'étape 1) est
    // signalée par un fond teinté couvrant portée ET tablature — visible au premier coup d'œil,
    // SOUS la notation (posé en premier) pour ne rien masquer. Absent du PDF (voir GEO_DEFAUT).
    // `yPortee`/`yTab` couvrent déjà toute la zone réservée quel que soit le mode (voir mettreEnPage) :
    // rien à adapter ici pour le mode TAB seule.
    if (m.invalide && geo.avertirErreurs !== false) {
        out.push(rect(xDebutMesure, yPortee, ctx.finMesure - xDebutMesure, (yTab + hauteurTab) - yPortee, 'avertissement'));
    }

    // Barre de reprise ouvrante — épaisse puis fine, puis les deux points. Le TRACÉ SUR LA PORTÉE
    // n'a de sens que si elle existe (avecPortee) ; celui sur la TAB reste, lui, toujours dessiné.
    if (m.ref.repriseDebut) {
        if (avecPortee) out.push(rect(x, yPortee, G.EPAISSEURS.barreEpaisse * S, 4 * S));
        out.push(rect(x, yTab, G.EPAISSEURS.barreEpaisse * S, hauteurTab));
        const xf = x + G.EPAISSEURS.barreEpaisse * S + 0.32 * S;
        if (avecPortee) {
            out.push(ligne(xf, yPortee, xf, yPortee + 4 * S, G.EPAISSEURS.barreMesure * S));
            out.push(glyphe(G.POINT, xf + 0.55 * S, yPortee + 1.5 * S, S));
            out.push(glyphe(G.POINT, xf + 0.55 * S, yPortee + 2.5 * S, S));
        }
        out.push(ligne(xf, yTab, xf, yTab + hauteurTab, G.EPAISSEURS.barreMesure * S));
        const xp = xf + 0.55 * S;
        x = xp + 0.9 * S;
    }

    // Clé. L'ancrage SMuFL place l'origine au bord GAUCHE, sur la ligne que la clé désigne — le
    // centre de la spirale pour une clé de sol. Les variantes « 8vb » portent leur petit 8 dans le
    // glyphe même : guitare et basse sonnent une octave plus bas, et Bravura dessine ce 8 à sa place
    // exacte, mieux qu'un chiffre posé à la main sous la clé.
    if (m.besoins.clef) {
        out.push(glyphe(clef.glyphe, x + 0.45 * S, yPortee + clef.ligne * S, S));
        x += (G.largeurDe(clef.glyphe) + 0.9) * S;
    }
    // Sans portée : RIEN à dessiner ici (la clé de TAB se dessine une fois par système, voir
    // poserCleTab plus haut) — seulement laisser filer `x` de la même largeur que largeurEnTete en
    // a réservée, pour que la signature ci-dessous ne vienne pas s'y superposer.
    if (m.besoins.cleTab) x += largeurCleTab(ST, cordes) + 0.9 * S;

    // Armure
    if (m.besoins.armure && m.armure !== 0) {
        const alt = m.armure > 0 ? G.DIESE : G.BEMOL;
        const avance = (G.largeurDe(alt) + 0.08) * S;
        positionsArmure(m.armure, clef).forEach(pas => {
            out.push(glyphe(alt, x, yDeLaPosition(pas, yPortee, S, clef), S));
            x += avance;
        });
        x += 0.5 * S;
    }

    // Signature rythmique, en chiffres de Bravura plutôt qu'en texte gras d'une police de labeur.
    // Ces chiffres-là sont dessinés pour la musique : hauteur exactement deux interlignes, centrés
    // verticalement sur leur ligne. Avec du texte, la taille devait être devinée et retouchée à
    // chaque changement d'échelle — et « 12 » ne s'alignait pas sur « 8 ».
    if (m.besoins.signature) {
        const haut = G.chiffresDe(m.signature.battements);
        const bas = G.chiffresDe(m.signature.unite);
        const largeur = Math.max(haut.largeur, bas.largeur);
        const poserSuite = (suite, y) => {
            let cx = x + 0.45 * S + ((largeur - suite.largeur) / 2) * S;
            for (const g of suite.glyphes) {
                cx += (G.largeurDe(g) / 2) * S;
                out.push(glyphe(g, cx, y, S));
                cx += (G.largeurDe(g) / 2) * S;
            }
        };
        if (avecPortee) {
            poserSuite(haut, yPortee + 1 * S);   // centré entre la ligne du haut et la médiane
            poserSuite(bas, yPortee + 3 * S);    // centré entre la médiane et la ligne du bas
        } else {
            // TAB seule (retour utilisateur : « on voit encore la signature rythmique [...] à
            // placer sur la ligne de TAB ») : la portée a disparu, la signature reste pourtant
            // ancrée à SA hauteur — flottante dans l'espace qu'elle occupait encore. Recentrée ici
            // sur la TAB elle-même, même convention que poserCleTab (proportionnelle à sa hauteur
            // réelle, donc juste aussi pour 4 cordes que pour 6) : chiffre du haut au quart
            // supérieur, chiffre du bas au quart inférieur — la même disposition « à cheval sur le
            // milieu » que sur une portée, juste rapportée à la TAB.
            poserSuite(haut, yTab + hauteurTab * 0.25);
            poserSuite(bas, yTab + hauteurTab * 0.75);
        }
        x += (largeur + 0.9) * S;
    }
    if (m.enTete > 0) x += 1.5 * S;   // la respiration comptée par largeurEnTete

    // Numéro de mesure, au-dessus de la portée, à l'aplomb du début de la mesure.
    out.push(texte(x + 0.2 * S, yPortee - 1.6 * S, String(m.index + 1), {
        taille: S * 1.05, police: 'sans-serif', poids: '600', ancre: 'debut', couleur: 'discret',
    }));

    // DE COMBIEN LA MESURE DÉBORDE (ou de combien il lui manque), à l'autre bout de la même ligne.
    //
    // Le fond teinté dit qu'il y a un problème ; ce chiffre dit LEQUEL, et c'est ce qui manquait.
    // Sans lui, une mesure signalée n'apprend rien d'autre que « quelque chose ne va pas », et il
    // faut aller poser le curseur dedans pour lire l'écart dans la barre de sélection. MuseScore
    // grave un « + » ou un « − » au même endroit, sans le chiffre ; on donne le chiffre, parce que
    // c'est lui qui dit s'il faut absorber une croche ou trois temps.
    //
    // À DROITE, ancré sur la fin de la mesure : le numéro de mesure et l'annotation de section sont
    // tous deux ancrés à GAUCHE, et rien ne garantit leur largeur. Deux étiquettes qui se
    // rapprochent l'une de l'autre depuis des bords opposés ne se chevauchent que dans une mesure
    // assez étroite pour être déjà illisible.
    //
    // ABSENT DU PDF, comme le fond teinté (voir GEO_DEFAUT.avertirErreurs) : une partition imprimée
    // ne porte pas les avertissements de son éditeur.
    if (m.ecart && geo.avertirErreurs !== false) {
        out.push(texte(ctx.finMesure - 0.3 * S, yPortee - 1.6 * S, libelleEcart(m.ecart), {
            taille: S * 1.05, police: 'sans-serif', poids: '700', ancre: 'fin', couleur: 'dette',
        }));
    }

    // Annotation de section (« Couplet 1 », « Refrain »…) — encre pleine et nettement plus grande
    // que le numéro de mesure juste en dessous : c'est elle qu'on doit repérer d'un coup d'œil en
    // parcourant la partition, le numéro de mesure ne sert qu'une fois qu'on a déjà localisé l'endroit.
    // `yAnnotation` n'est calculé par mettreEnPage QUE pour un système qui a réservé la bande
    // correspondante — jamais posé sur un système qui n'a aucune mesure annotée.
    if (m.ref.annotation) {
        out.push(texte(x + 0.2 * S, yAnnotation, m.ref.annotation, {
            taille: S * 1.5, police: 'sans-serif', poids: '700', ancre: 'debut', couleur: 'encre',
        }));
    }

    // --- Les COLONNES : une abscisse par instant, PARTAGÉE par toutes les voix -------------------
    // C'est ce qui aligne verticalement une mélodie et une basse tenue qui n'ont pas le même rythme :
    // les deux lisent leur position dans la MÊME suite d'abscisses (voir calculerColonnes), plutôt
    // que d'avancer chacune à son compte — ce qui les ferait dériver l'une de l'autre dès leur
    // premier désaccord rythmique.
    const xColonnes = [];
    { let xx = x; for (const c of m.colonnes) { xColonnes.push(xx); xx += c.largeur * facteur; } }
    const xFinMesureNotes = xColonnes.length ? xColonnes[xColonnes.length - 1] + m.colonnes[m.colonnes.length - 1].largeur * facteur : x;

    /** Index de colonne dont le `debut` correspond au temps `t` (en noires depuis le début de la mesure). */
    // Sentinelle : `m.colonnes.length` (une case AU-DELÀ de la dernière) veut dire « la fin de la
    // mesure », pas « recale-toi sur la dernière colonne existante ». La distinction compte pour la
    // note qui se termine exactement à la fin de la mesure (le cas normal du DERNIER évènement d'une
    // voix) : une première version renvoyait `length - 1`, qui pointe vers la colonne où cette même
    // note COMMENCE — son xFin se retrouvait alors AVANT son xDebut.
    const colonneA = (t) => {
        const cible = Math.round(t * 1e6) / 1e6;
        const i = m.colonnes.findIndex(c => c.debut >= cible - 1e-6);
        return i < 0 ? m.colonnes.length : i;
    };

    // --- Les évènements de CHAQUE VOIX, EN TROIS PASSES -------------------------------------------
    // L'ordre compte, et une première version l'avait manqué : elle dessinait la hampe de chaque note
    // au moment de poser sa tête, PUIS décidait des ligatures — qui imposent au groupe entier un sens
    // commun. Les notes dont le sens changeait se retrouvaient avec DEUX hampes, l'une vers le haut
    // héritée de la première passe, l'autre vers le bas rejoignant la ligature. Le sens d'une hampe
    // n'est pas une propriété de la note : c'est une décision du GROUPE, et elle doit donc être prise
    // avant qu'aucune hampe ne soit tracée.
    //   1. les têtes, altérations, lignes supplémentaires, et toute la tablature ;
    //   2. les groupes de ligature et le sens de hampe commun à chacun ;
    //   3. les hampes, crochets, ligatures et n-olets.
    // Chaque voix mène ces trois passes INDÉPENDAMMENT (ses propres ligatures, ses propres liaisons) —
    // seule l'abscisse de chaque instant leur est commune.
    const nbVoix = m.ref.voix.length;
    const memoire = memoireAlterations(m.armure);   // partagée : une altération vaut pour la MESURE entière, toutes voix confondues
    const notesParPasEtColonne = new Map();          // "iCol:pas" → notes déjà posées là, pour l'évitement de collision

    m.ref.voix.forEach((voixRef, iVoix) => {
        // Sens de hampe imposé : voix 0 vers le haut, voix 1 vers le bas — la convention de gravure
        // pour deux voix sur une même portée. Une seule voix garde la règle AUTOMATIQUE (fondée sur
        // la hauteur), qui reste la bonne règle dans ce cas — imposer un sens fixe à une voix seule
        // produirait des hampes vers le bas sur des mélodies aiguës.
        const sensImpose = nbVoix > 1 ? (iVoix === 0 ? -1 : 1) : null;
        // Les silences de deux voix simultanées se chevauchent s'ils restent tous deux centrés sur la
        // portée : la voix 0 se pousse légèrement au-dessus de la ligne médiane, la voix 1 en dessous.
        const decalageSilence = nbVoix > 1 ? (iVoix === 0 ? -1 : 1) : 0;

        const poses = [];
        let t = 0;
        voixRef.evenements.forEach((ref, iEvenement) => {
            const duree = dureeEnNoires(ref.duree);
            const iCol = colonneA(t);
            const xDebutEvt = xColonnes[iCol];
            const largeurPremiereColonne = m.colonnes[iCol].largeur * facteur;
            const xNote = xDebutEvt + largeurPremiereColonne * 0.42;
            // xFin s'étend jusqu'à la colonne où cette voix attaque SA note suivante — pas seulement
            // jusqu'à la colonne suivante en général. Une blanche tenue sous des croches réserve ainsi
            // à l'écran (curseur, clic, tête de lecture) tout le temps qu'elle occupe réellement,
            // même si elle n'a, elle, besoin que de la largeur de sa première colonne pour sa tête.
            const iColFin = colonneA(t + duree);
            const xFinEvt = iColFin < xColonnes.length ? xColonnes[iColFin] : xFinMesureNotes;

            const pose = poserEvenement(out, partition, ref, {
                x: xNote, xDebut: xDebutEvt, largeur: largeurPremiereColonne, yPortee, yTab, yAccords, S, ST, cordes, clef, memoire, geo,
                sensImpose, decalageSilence, notesParPasEtColonne, cleColonne: iCol, avecPortee,
            });
            poses.push(pose);
            ancrages.evenements.push({
                mesure: m.index, voix: iVoix, evenement: iEvenement, ref,
                x: xNote, xDebut: xDebutEvt, xFin: xFinEvt, yPortee, hauteurTab,
                // `yTab` ABSENT quand il n'y a pas de tablature (`avecTab: false`, voir mettreEnPage) —
                // exactement comme le fait le piano (voir poserMesurePiano, `yTab: undefined`). C'est
                // ce champ que main.js#marquesCurseur interroge pour décider de tracer le trait « sur
                // quelle corde » : le laisser renseigné dessinerait ce trait dans le vide, sous une
                // portée qui n'a pas de corde. `cordes` vaut 0 dans ce cas précis, et seulement
                // celui-là — on s'appuie sur le signal qui existe déjà plutôt que d'en ajouter un.
                ...(cordes > 0 ? { yTab } : {}),
                // Générique entre les deux mises en page (voir son pendant piano dans
                // poserMesurePiano) : bas de la grille de notation, que main.js peut lire pour le
                // curseur/la tête de lecture SANS savoir s'il existe une TAB sous cette portée.
                yBas: yTab + hauteurTab,
            });
            t += duree;
        });

        const groupes = grouperLigatures(poses, m.signature);
        poserHampes(out, poses, groupes, S);
        poserArticulations(out, poses, S);
        poserNolets(out, poses, groupes, S, yPortee, m.signature);
        poserLiaisons(out, poses, S, ST);
        // LA LIAISON QUI FRANCHIT LA BARRE — refermée ici si la mesure précédente en a laissé une,
        // reportée à la suivante si celle-ci en laisse une (voir reporterLiaison).
        reporterLiaison(out, ctx, iVoix, m.index, poses, S, ST, !!ctx.coupeApres);
    });

    // Barre de fin de mesure — SUR LA PORTÉE seulement si elle existe (avecPortee) ; sur la TAB,
    // toujours.
    const xBarre = ctx.finMesure;
    if (m.ref.repriseFin) {
        if (avecPortee) {
            const xp = xBarre - 1.5 * S;
            out.push(glyphe(G.POINT, xp, yPortee + 1.5 * S, S));
            out.push(glyphe(G.POINT, xp, yPortee + 2.5 * S, S));
        }
        const xf = xBarre - 0.75 * S;
        if (avecPortee) out.push(ligne(xf, yPortee, xf, yPortee + 4 * S, G.EPAISSEURS.barreMesure * S));
        out.push(ligne(xf, yTab, xf, yTab + hauteurTab, G.EPAISSEURS.barreMesure * S));
        if (avecPortee) out.push(rect(xBarre - G.EPAISSEURS.barreEpaisse * S - 0.1 * S, yPortee, G.EPAISSEURS.barreEpaisse * S, 4 * S));
        out.push(rect(xBarre - G.EPAISSEURS.barreEpaisse * S - 0.1 * S, yTab, G.EPAISSEURS.barreEpaisse * S, hauteurTab));
    } else if (m.ref.barre === 'finale') {
        // BARRE FINALE : un trait fin doublé d'un trait épais — la fin du morceau.
        const xf = xBarre - G.EPAISSEURS.barreEpaisse * S - 0.6 * S;
        if (avecPortee) {
            out.push(ligne(xf, yPortee, xf, yPortee + 4 * S, G.EPAISSEURS.barreMesure * S));
            out.push(rect(xBarre - G.EPAISSEURS.barreEpaisse * S, yPortee, G.EPAISSEURS.barreEpaisse * S, 4 * S));
        }
        out.push(ligne(xf, yTab, xf, yTab + hauteurTab, G.EPAISSEURS.barreMesure * S));
        out.push(rect(xBarre - G.EPAISSEURS.barreEpaisse * S, yTab, G.EPAISSEURS.barreEpaisse * S, hauteurTab));
    } else if (m.ref.barre === 'double') {
        // DOUBLE BARRE : deux traits fins — une fin de SECTION, pas du morceau.
        const xf = xBarre - 0.55 * S;
        if (avecPortee) {
            out.push(ligne(xf, yPortee, xf, yPortee + 4 * S, G.EPAISSEURS.barreMesure * S));
            out.push(ligne(xBarre, yPortee, xBarre, yPortee + 4 * S, G.EPAISSEURS.barreMesure * S));
        }
        out.push(ligne(xf, yTab, xf, yTab + hauteurTab, G.EPAISSEURS.barreMesure * S));
        out.push(ligne(xBarre, yTab, xBarre, yTab + hauteurTab, G.EPAISSEURS.barreMesure * S));
    } else {
        if (avecPortee) out.push(ligne(xBarre, yPortee, xBarre, yPortee + 4 * S, G.EPAISSEURS.barreMesure * S));
        out.push(ligne(xBarre, yTab, xBarre, yTab + hauteurTab, G.EPAISSEURS.barreMesure * S));
    }

    // REPÈRE DE NAVIGATION (Segno, Coda, D.C., D.S., al Coda, Fine) — voir poserRepere. Posé APRÈS
    // les barres pour qu'il se dessine par-dessus si les deux se croisaient, jamais dessous.
    poserRepere(out, m.ref, xDebutMesure, xBarre, yRepere ?? (yPortee - HAUTEUR_REPERE * S), S);

    ancrages.mesures.push({
        index: m.index, x: xDebutMesure, xFin: xBarre, yPortee, yTab, hauteurTab, systeme: ctx.iSys,
        // `capacite`/`largeurNotes` : exposés pour que qui lit l'ancrage (bancs d'essai, futures
        // fonctionnalités comme la boucle de lecture) puisse vérifier la largeur FIXE par signature
        // sans redupliquer le calcul de l'étape 1 de mettreEnPage.
        capacite: m.capacite, largeurNotes: m.largeurNotes,
    });
    return xBarre;
}

/** Ordonnée d'une position diatonique sur la portée. Une position = un demi-interligne. */
function yDeLaPosition(pas, yPortee, S, clef) {
    return yPortee + clef.ligne * S - (pas - clef.pasRef) * (S / 2);
}

/**
 * INVERSE de yDeLaPosition — la position diatonique la plus proche d'une ordonnée d'écran, ARRONDIE
 * à la ligne ou à l'interligne le plus proche. C'est elle qui traduit un CLIC direct sur la portée
 * (voir main.js#cibleDepuisClicPiano) en une position exploitable par theory.js#hauteurDepuisPas —
 * exportée pour ça, seule fonction de ce module dont l'édition (hors moteur de mise en page) a besoin.
 */
export function pasDeLaPosition(y, yPortee, S, clef) {
    return clef.pasRef + Math.round((yPortee + clef.ligne * S - y) / (S / 2));
}

// ---------------------------------------------------------------------------------------------
// Un évènement : les chiffres de la tablature, et leur reflet sur la portée
// ---------------------------------------------------------------------------------------------

function poserEvenement(out, partition, evenement, ctx) {
    const { x, yPortee, yTab, yAccords, S, ST, cordes, clef, memoire, geo, sensImpose = null, decalageSilence = 0, avecPortee = true } = ctx;
    const crochets = crochetsDe(evenement.duree.valeur);
    const estSilence = evenement.silence || evenement.notes.length === 0;

    const pose = {
        ref: evenement, x, crochets, estSilence,
        notes: [], yHampe: null, sensHampe: 1, yTeteExtreme: null,
    };

    // Nom d'accord (« A7 », « E7 »…, voir Évènement#accord) : posé à l'aplomb de CET évènement
    // précis, qu'il soit silencieux ou non (un accord peut très bien continuer de sonner sous un
    // silence de la voix qu'on écrit) — donc AVANT tout retour anticipé plus bas, silence ou TAB
    // seule. `yAccords` n'existe (voir mettreEnPage) que pour un système dont au moins un évènement
    // en porte un ; `ctx.yAccords` reste sinon `undefined` (voir poserMesurePiano, qui ne le passe
    // pas — les noms d'accords, comme l'annotation de section, n'existent pour l'instant que côté
    // guitare/basse) et ce bloc ne s'exécute alors jamais.
    if (evenement.accord && yAccords != null) {
        out.push(texte(x, yAccords, evenement.accord, {
            taille: S * 1.2, police: 'sans-serif', poids: '700', ancre: 'debut', couleur: 'encre',
        }));
    }

    // ANCRE DES HAMPES EN MODE « TAB SEULE » (voir HAUTEUR_ZONE_HAMPE_TAB/ECART_ZONE_HAMPE_TAB) :
    // sans portée, aucune tête de note n'a de hauteur réelle à rejoindre — chaque hampe part donc
    // d'un point fixe, juste au-dessus OU en dessous de la TAB. LEQUEL exactement suit la MÊME règle
    // que sur la portée (retour utilisateur : « les hampes doivent pouvoir descendre [...] comme pour
    // une vraie partition », pas un sens unique et fixe pour toute la voix) : c'est la CORDE la plus
    // éloignée du milieu du manche qui décide — une corde AIGUË (index bas, près du haut du manche)
    // pousse la hampe vers le BAS, une corde GRAVE vers le HAUT, exactement le même principe que
    // ecartHaut/ecartBas plus bas pour la hauteur réelle, appliqué à la seule chose qui varie ici : la
    // position de corde. `sensImpose` garde priorité (deux voix : mélodie toujours en haut, basse
    // toujours en bas, quelle que soit la corde — même raison qu'en notation). Les SILENCES, qui ne
    // jouent aucune corde, gardent le sens par défaut de la voix : rien à faire varier pour eux, comme
    // sur la portée (ecartHaut/ecartBas, plus bas, ne portent déjà que sur des notes SONNANTES).
    let sensTab = sensImpose ?? -1;
    if (!estSilence && evenement.notes.length && cordes > 0) {
        const pasMedianTab = -(cordes - 1) / 2;
        const positionsTab = evenement.notes.map(n => -n.corde);
        const ecartHautTab = Math.max(...positionsTab) - pasMedianTab;
        const ecartBasTab = pasMedianTab - Math.min(...positionsTab);
        sensTab = sensImpose ?? (ecartHautTab >= ecartBasTab ? 1 : -1);
    }
    const yAncreTab = sensTab < 0 ? yTab - ECART_ZONE_HAMPE_TAB * S : yTab + (cordes - 1) * ST + ECART_ZONE_HAMPE_TAB * S;

    if (estSilence) {
        // La pause et la demi-pause sont le MÊME rectangle : seule leur position les distingue — la
        // première suspendue sous la 4e ligne, la seconde posée sur la médiane. Les confondre décale
        // la lecture d'un temps entier, l'erreur la plus coûteuse qu'un silence puisse porter. Cette
        // distinction n'a de sens que sur une portée à 5 lignes : sans elle (TAB seule), toutes les
        // durées de silence se posent au MÊME repère — l'ancre des hampes, celle de la voix — comme
        // n'importe quelle autre pause dans ce mode.
        const g = G.SILENCES[evenement.duree.valeur] || G.SILENCES[4];
        const yLigne = avecPortee
            ? yPortee + (G.LIGNE_SILENCE[evenement.duree.valeur] ?? 2) * S + decalageSilence * S
            : yAncreTab + decalageSilence * S;
        const demi = (G.largeurDe(g) / 2) * S;
        out.push(glyphe(g, x - demi, yLigne, S));
        for (let i = 0; i < (evenement.duree.points || 0); i++) {
            const yPoint = avecPortee ? yPortee + 1.5 * S + decalageSilence * S : yLigne;
            out.push(glyphe(G.POINT, x + demi + (0.5 + i * 0.42) * S, yPoint, S));
        }
        return pose;
    }

    // --- Tablature : le chiffre de case, posé SUR sa ligne, qu'il interrompt -----------------------
    // Absente au PIANO (`ctx.cordes` vaut alors 0, voir poserMesurePiano) : ni corde ni case n'y ont
    // de sens, seule la portée (ci-dessous) porte la note. `pose.notes` garde quand même une entrée
    // par note quoi qu'il arrive — c'est elle que la section Portée complète ensuite (`.yPortee = …`).
    const tailleChiffre = geo.tailleChiffreTab * S;
    for (const note of evenement.notes) {
        if (ctx.cordes > 0) {
            const yLigne = yTab + note.corde * ST;
            const libelle = note.ghost ? 'x' : String(note.frette);
            // Le masque : la ligne de corde s'arrête de part et d'autre du chiffre. C'est ce qui rend
            // une tablature lisible — un « 0 » barré d'un trait horizontal se lit comme un « ø ».
            const demiLargeur = tailleChiffre * (0.32 + 0.19 * libelle.length);
            out.push(rect(x - demiLargeur, yLigne - tailleChiffre * 0.5, demiLargeur * 2, tailleChiffre, 'papier'));
            out.push(texte(x, yLigne + tailleChiffre * 0.35, libelle, {
                taille: tailleChiffre, police: 'sans-serif', poids: '600', ancre: 'milieu',
                // `horsManche` : posé par une transposition qui n'a trouvé AUCUNE corde capable de
                // jouer la hauteur voulue (voir Editeur.transposerMorceau). La note reste écrite et
                // éditable, mais en rouge — c'est le seul signe qui dise « celle-ci est à reprendre ».
                couleur: note.horsManche ? 'horsManche' : undefined,
            }));
            if (note.bend) {
                // Les trois amplitudes qu'un guitariste écrit, dans la notation qu'il lit : ½, full,
                // 1½ (voir Editeur.bendSuivant, qui les fait circuler). Une version antérieure n'en
                // distinguait que deux (« full » dès deux demi-tons), donc un bend d'un ton et demi
                // s'affichait comme un ton entier — deux gestes différents sous une même étiquette.
                //
                // La flèche montante (et non le seul texte) : c'est la convention de gravure réelle
                // d'un bend — cf. la capture de référence fournie par l'utilisateur, où l'amplitude
                // surmonte une pointe de flèche plutôt que de flotter seule. Un seul segment « C »,
                // comme arcLiaison ci-dessus : jsPDF#analyserChemin ne sait lire que M/L/C/Z — un
                // « Q » y ressortirait silencieusement vide, et le PDF ne serait plus ce qu'on voit.
                const LIBELLES_BEND = { 1: '½', 2: 'full', 3: '1½' };
                const xA = x + demiLargeur + 0.2 * S, yA = yLigne - tailleChiffre * 0.1;
                const xB = xA + 0.5 * S, yB = yLigne - tailleChiffre * 1.9;
                out.push(courbe(
                    `M ${xA.toFixed(2)} ${yA.toFixed(2)} C ${(xA + 0.1 * S).toFixed(2)} ${(yA + (yB - yA) * 0.4).toFixed(2)} ${(xB - 0.05 * S).toFixed(2)} ${(yA + (yB - yA) * 0.85).toFixed(2)} ${xB.toFixed(2)} ${yB.toFixed(2)}`,
                    G.EPAISSEURS.liaison * S, 'discret',
                ));
                const demiPointe = 0.22 * S, hautPointe = 0.4 * S;
                out.push(poly([[xB, yB], [xB - demiPointe, yB + hautPointe], [xB + demiPointe, yB + hautPointe]], 'discret'));
                out.push(texte(xB, yB - 0.3 * S, LIBELLES_BEND[note.bend.demiTons] || 'full', {
                    taille: S * 0.95, police: 'sans-serif', poids: '600', ancre: 'milieu', couleur: 'discret',
                }));
            }
            pose.notes.push({ note, yTab: ligneTab(note, yTab, ST), demiLargeurTab: demiLargeur });
        } else {
            pose.notes.push({ note });
        }
    }

    // --- MODE « TAB SEULE » : la hampe rejoint l'ancre commune (voir plus haut), jamais une tête de
    // note qui n'existe pas ici — sortie avant la section Portée, qui n'a plus rien à faire. `yHaut`
    // ET `yBas` valent tous deux `yAncreTab` : poserHampes (déjà générique) en déduit une hampe de la
    // longueur nominale exacte, sans le moindre changement de son côté (voir boutDeHampe/xDeHampe).
    // `demiTete` est OMIS à dessein : le repli de xDeHampe (`p.demiTete ?? 0.59`) donne déjà le petit
    // décalage voulu, celui qu'aurait une tête de note ordinaire.
    if (!avecPortee) {
        pose.sensHampe = sensTab;
        pose.yHaut = yAncreTab;
        pose.yBas = yAncreTab;
        return pose;
    }

    // --- Portée : les mêmes notes, converties en hauteurs puis en positions ----------------------
    const ecritures = [];
    for (const note of evenement.notes) {
        const midi = hauteurDeNote(partition, note);
        if (midi == null) continue;
        const e = ecrireHauteur(midi + clef.transposition, memoire.armure);
        ecritures.push({ note, midi, ecriture: e, y: yDeLaPosition(e.pas, yPortee, S, clef) });
    }
    if (!ecritures.length) return pose;

    ecritures.sort((a, b) => a.ecriture.pas - b.ecriture.pas);
    // SENS DE HAMPE : c'est la note la plus ÉLOIGNÉE de la ligne médiane qui décide, pas la moyenne
    // des hauteurs. La règle de gravure vise à garder la hampe dans la portée : sur un accord large,
    // la moyenne se laisse tirer par les notes du milieu et sort la hampe du mauvais côté, alors que
    // l'extrême, elle, dit exactement de quel côté il y a de la place. Égalité → hampe vers le bas.
    const pasMedian = clef.pasRef + (clef.ligne - 2) * 2;
    const ecartHaut = ecritures[ecritures.length - 1].ecriture.pas - pasMedian;
    const ecartBas = pasMedian - ecritures[0].ecriture.pas;
    // `sensImpose` prime sur la règle automatique : à deux voix sur la même portée, le sens dépend
    // de la VOIX (mélodie en haut, basse en bas), pas de la hauteur — sans quoi une basse tenue très
    // grave et une mélodie très aiguë pourraient toutes deux se voir attribuer des hampes vers le
    // haut, qui se chevaucheraient au lieu de rester chacune de son côté.
    pose.sensHampe = sensImpose ?? (ecartHaut >= ecartBas ? 1 : -1);
    pose.pasMedian = pasMedian;

    const teteGlyphe = G.teteDe(evenement.duree.valeur);
    // Demi-largeur de la tête : c'est elle qui donne l'écart de la hampe, la place du point et
    // l'accroche des liaisons. MESURÉE sur le glyphe, car une ronde est nettement plus large qu'une
    // noire (1,69 contre 1,18 interligne) — un écart constant flotterait à côté de l'une tout en
    // mordant sur l'autre.
    const demiTete = G.demiTete(evenement.duree.valeur);
    pose.demiTete = demiTete;

    let yMin = Infinity, yMax = -Infinity;
    for (const e of ecritures) {
        // Lignes supplémentaires : au-dessus et en dessous de la portée, de demi-interligne en
        // demi-interligne, seulement sur les LIGNES (positions paires depuis la référence).
        poserLignesSupplementaires(out, x, e.y, yPortee, S, demiTete);

        const alt = memoire.besoin(e.ecriture);
        if (alt !== null) {
            const ga = G.ALTERATIONS[String(alt)];
            out.push(glyphe(ga, x - (G.largeurDe(ga) + demiTete + 0.2) * S, e.y, S));
        }

        // ÉVITEMENT DE COLLISION ENTRE VOIX : si une autre voix a DÉJÀ posé une tête à ce même
        // instant (même colonne) et cette même hauteur (même position diatonique), les deux têtes se
        // superposeraient exactement. On décale celle-ci d'une largeur de tête vers la droite — la
        // convention de gravure pour deux voix à l'unisson — plutôt que de laisser un unique rond
        // noir là où deux notes distinctes devraient se lire. Ne traite que l'UNISSON exact ; deux
        // hauteurs voisines (tierce, seconde) different assez à l'œil pour rester superposables sans
        // ambiguïté, et c'est là que s'arrête cette règle en V1.
        let xTete = x;
        if (ctx.notesParPasEtColonne) {
            const cle = `${ctx.cleColonne}:${e.ecriture.pas}`;
            if (ctx.notesParPasEtColonne.has(cle)) xTete = x + demiTete * 2.1 * S;
            else ctx.notesParPasEtColonne.set(cle, true);
        }

        out.push(glyphe(e.note.ghost ? G.TETE_CROIX : teteGlyphe, xTete, e.y, S));
        if (evenement.duree.points) {
            // Un point posé sur une LIGNE se décale d'un demi-interligne vers le haut : sinon il
            // disparaît dans le trait.
            const surLigne = Math.round((e.y - yPortee) / (S / 2)) % 2 === 0;
            for (let i = 0; i < evenement.duree.points; i++) {
                out.push(glyphe(G.POINT, xTete + (demiTete + 0.42 + i * 0.42) * S, e.y - (surLigne ? S / 2 : 0), S));
            }
        }
        yMin = Math.min(yMin, e.y); yMax = Math.max(yMax, e.y);
        pose.notes.find(n => n.note === e.note).yPortee = e.y;
    }

    pose.yHaut = yMin; pose.yBas = yMax;
    pose.teteGlyphe = teteGlyphe;
    return pose;
}

function ligneTab(note, yTab, ST) {
    return yTab + note.corde * ST;
}

function poserLignesSupplementaires(out, x, y, yPortee, S, demiTete = 0.59) {
    const ep = G.EPAISSEURS.ligneSupplementaire * S;
    // La ligne dépasse la tête d'un quart d'interligne de chaque côté — proportion de gravure. Une
    // largeur fixe, comme dans une version antérieure, était trop courte pour une ronde (nettement
    // plus large qu'une noire) et la ligne disparaissait sous la tête.
    const larg = (demiTete + 0.26) * S;
    if (y < yPortee - 0.1) {
        for (let yy = yPortee - S; yy >= y - 0.1; yy -= S) out.push(ligne(x - larg, yy, x + larg, yy, ep));
    } else if (y > yPortee + 4 * S + 0.1) {
        for (let yy = yPortee + 5 * S; yy <= y + 0.1; yy += S) out.push(ligne(x - larg, yy, x + larg, yy, ep));
    }
}

// ---------------------------------------------------------------------------------------------
// Hampes, crochets, ligatures et n-olets — la passe qui suit les têtes de note
// ---------------------------------------------------------------------------------------------

const LONGUEUR_HAMPE = 3.4;   // en interlignes, longueur nominale d'une hampe

// MODE « TAB SEULE » (retour utilisateur : « visualiser uniquement la portée de tablature, sans la
// partition [...] le rythme doit être visible sur la portée de la tablature directement ») — voir
// mettreEnPage#avecPortee, poserEvenement. Sans portée, une hampe n'a plus de hauteur RÉELLE à
// rejoindre (aucune tête de note n'existe) : toutes celles d'une même voix partent du MÊME point fixe,
// juste au-dessus (voix 0/seule) ou en dessous (voix 1, deux voix) de la TAB, comme le fait Guitar Pro
// en vue TAB seule. `HAUTEUR_ZONE_HAMPE_TAB` doit loger une hampe pleine longueur PLUS son crochet,
// un point, un chiffre de n-olet — moins que les 4 S d'une portée à 5 lignes, sans quoi le gain de
// hauteur qui motive ce mode n'existerait pas, mais pas la longueur de la hampe SEULE non plus.
const HAUTEUR_ZONE_HAMPE_TAB = 5.6;   // × S, au-dessus (ou en dessous) de la TAB
const ECART_ZONE_HAMPE_TAB = 0.4;     // × S, entre cette zone et la TAB elle-même — juste un peu d'air

/**
 * Répartit les évènements en groupes de ligature.
 *
 * Le découpage suit l'UNITÉ DE TEMPS de la mesure (voir duration.uniteDeGroupement) : c'est ce qui
 * fait qu'une mesure à 6/8 se lit en deux groupes de trois croches et non en trois paires — donc
 * qu'elle ne se confond pas avec du 3/4. Une ligature n'est pas une décoration : c'est ce qui donne
 * la pulsation à voir, sans avoir à compter.
 *
 * Un silence ou une note d'au moins une noire ferme le groupe en cours : on ne ligature pas
 * par-dessus un silence.
 */
export function grouperLigatures(poses, signature) {
    const unite = uniteDeGroupement(signature);
    const groupes = [];
    let courant = [];
    let t = 0;
    for (const p of poses) {
        const d = dureeEnNoires(p.ref.duree);
        const numeroTemps = Math.floor(t / unite + 1e-9);
        const ligaturable = p.crochets > 0 && !p.estSilence;
        if (!ligaturable || (courant.length && courant[0].temps !== numeroTemps)) {
            if (courant.length > 1) groupes.push(courant.map(x => x.p));
            courant = [];
        }
        if (ligaturable) courant.push({ p, temps: numeroTemps });
        t += d;
    }
    if (courant.length > 1) groupes.push(courant.map(x => x.p));
    return groupes;
}

/** Ordonnée du bout d'une hampe isolée, du côté `sens`. */
function boutDeHampe(p, sens, S) {
    return sens < 0 ? p.yHaut - LONGUEUR_HAMPE * S : p.yBas + LONGUEUR_HAMPE * S;
}

/**
 * Abscisse de la hampe : au bord DROIT de la tête pour une hampe montante, au bord GAUCHE pour une
 * descendante — la règle de gravure, qui fait que la hampe prolonge la tête au lieu de la traverser.
 * L'écart est mesuré sur le glyphe, moins la demi-épaisseur du trait pour que la hampe affleure.
 */
function xDeHampe(p, sens, S) {
    const d = (p.demiTete ?? 0.59) - G.EPAISSEURS.hampe / 2;
    return p.x + (sens < 0 ? d : -d) * S;
}

/**
 * Trace toutes les hampes : celles des notes isolées (avec leur crochet), puis celles des groupes
 * ligaturés (qui rejoignent une ligne de ligature commune).
 */
function poserHampes(out, poses, groupes, S) {
    const enGroupe = new Set(groupes.flat());

    // --- Notes isolées ---------------------------------------------------------------------------
    for (const p of poses) {
        if (p.estSilence || enGroupe.has(p) || p.ref.duree.valeur < 2) continue;
        const sens = p.sensHampe;
        const xh = xDeHampe(p, sens, S);
        const attache = sens < 0 ? p.yBas : p.yHaut;
        const bout = boutDeHampe(p, sens, S);
        out.push(ligne(xh, attache, xh, bout, G.EPAISSEURS.hampe * S));
        p.xHampe = xh; p.yHampe = bout;
        if (p.crochets > 0) {
            // Bravura fournit DEUX dessins, un par sens de hampe — ce ne sont pas des miroirs l'un de
            // l'autre : le crochet descendant est plus large et sa courbure diffère. Une version
            // antérieure retournait le dessin montant, et toutes les hampes descendantes penchaient
            // du mauvais côté.
            out.push(glyphe(G.crochet(p.crochets, sens), xh - (G.EPAISSEURS.hampe / 2) * S, bout, S));
        }
    }

    // --- Groupes ligaturés -------------------------------------------------------------------------
    for (const g of groupes) {
        // Sens commun au groupe : une ligature ne peut pas pointer des deux côtés. On additionne les
        // ÉCARTS à la ligne médiane plutôt que de compter les voix, pour qu'une note très aiguë pèse
        // dans la décision à proportion de ce qu'elle dépasse.
        const poids = g.reduce((t, p) => t + (p.sensHampe > 0 ? 1 : -1) * (1 + Math.abs(p.yBas - p.yHaut) / (4 * S)), 0);
        const sens = poids >= 0 ? 1 : -1;
        for (const p of g) p.sensHampe = sens;

        const xh = (p) => xDeHampe(p, sens, S);
        const premier = g[0], dernier = g[g.length - 1];
        const yIdeal = (p) => boutDeHampe(p, sens, S);

        // Ligne de ligature : une droite passant au-delà de TOUTES les hampes idéales du groupe, dont
        // la pente suit la courbe mélodique mais reste bornée — une ligature trop pentue se lit mal et
        // rend les hampes intérieures difformes.
        const largeur = xh(dernier) - xh(premier);
        const penteBrute = largeur ? (yIdeal(dernier) - yIdeal(premier)) / largeur : 0;
        const pente = Math.max(-0.26, Math.min(0.26, penteBrute));
        const yEn = (xx, origine) => origine + pente * (xx - xh(premier));
        // On cale l'origine pour qu'aucune hampe ne soit plus courte que le minimum acceptable.
        let origine = yIdeal(premier);
        for (const p of g) {
            const y = yEn(xh(p), origine);
            const manque = sens < 0 ? y - yIdeal(p) : yIdeal(p) - y;
            if (manque > 0) origine += sens < 0 ? -manque : manque;
        }

        for (const p of g) {
            const x = xh(p);
            const yb = yEn(x, origine);
            out.push(ligne(x, sens < 0 ? p.yBas : p.yHaut, x, yb, G.EPAISSEURS.hampe * S));
            p.xHampe = x; p.yHampe = yb;
        }

        const ep = G.EPAISSEURS.ligature * S;
        // Niveau 1 = la ligature principale, continue sur tout le groupe. Niveaux 2 et 3 = les
        // ligatures secondaires (doubles, triples croches), tracées seulement sur les PLAGES de notes
        // assez brèves — une double isolée au milieu de croches reçoit un moignon, orienté vers
        // l'intérieur du groupe comme le veut la gravure.
        for (let niveau = 1; niveau <= 3; niveau++) {
            const decalage = (niveau - 1) * (ep + 0.26 * S) * (sens < 0 ? 1 : -1);
            let debut = null;
            for (let i = 0; i <= g.length; i++) {
                const assez = i < g.length && g[i].crochets >= niveau;
                if (assez && debut === null) debut = i;
                if (!assez && debut !== null) {
                    const a = g[debut], b = g[i - 1];
                    let xa = a.xHampe, xb = b.xHampe;
                    if (debut === i - 1) {
                        const versDroite = debut === 0;
                        xa = a.xHampe + (versDroite ? 0 : -1.05 * S);
                        xb = a.xHampe + (versDroite ? 1.05 * S : 0);
                    }
                    const ya = yEn(xa, origine) + decalage, yb = yEn(xb, origine) + decalage;
                    const h = sens < 0 ? ep : -ep;
                    out.push(poly([[xa, ya], [xb, yb], [xb, yb + h], [xa, ya + h]]));
                    debut = null;
                }
            }
        }
    }
}

/**
 * Accents et staccatos, du côté OPPOSÉ à la hampe.
 *
 * C'est la règle de gravure : une articulation posée du côté de la hampe la croiserait. Le glyphe est
 * aligné par sa BOÎTE plutôt que par son origine — accent et staccato n'ancrent pas au même endroit,
 * et raisonner sur la boîte donne le même écart visible pour les deux, quel que soit leur dessin.
 */
function poserArticulations(out, poses, S) {
    const ECART = 0.75;
    for (const p of poses) {
        if (p.estSilence || (!p.ref.accent && !p.ref.staccato)) continue;
        const dessus = p.sensHampe > 0;      // hampe vers le bas → articulation au-dessus
        let decalage = 0;
        for (const g of [p.ref.accent ? (dessus ? G.ACCENT_DESSUS : G.ACCENT_DESSOUS) : null,
                         p.ref.staccato ? G.STACCATO : null].filter(Boolean)) {
            const b = G.boiteDe(g);
            const y = dessus
                ? p.yHaut - (ECART + decalage) * S - b.bas * S
                : p.yBas + (ECART + decalage) * S - b.haut * S;
            out.push(glyphe(g, p.x, y, S));
            decalage += (b.bas - b.haut) + 0.35;
        }
    }
}

/**
 * Crochet et chiffre des divisions irrégulières (« 3 » d'un triolet).
 *
 * Sans ce chiffre, trois croches en triolet sont IMPOSSIBLES à distinguer de trois croches
 * ordinaires : le dessin des notes est identique, seule la durée change. C'est le seul cas de la
 * notation où l'information rythmique ne tient pas dans la forme des notes.
 *
 * UNE COURSE DE N-OLETS NE DOIT JAMAIS ENJAMBER DEUX TEMPS, et il a fallu deux correctifs pour y
 * arriver :
 *
 *   1. D'abord l'appartenance à un groupe de ligature (`groupes`, les MÊMES que poserHampes, jamais
 *      recalculés ici). Trouvé en reproduisant un rythme en triolets répété tout du long : plusieurs
 *      temps consécutifs de triolets, qui partagent tous le MÊME descripteur `{dans, valent}`,
 *      étaient fusionnés en une seule course par la seule comparaison de descripteur.
 *   2. Puis LE NUMÉRO DE TEMPS, parce que le premier correctif ne couvrait pas le cas où les notes
 *      ne sont pas ligaturées DU TOUT. Mesuré : quatre temps portant chacun une croche de triolet
 *      suivie de silences donnaient encore UN seul « 3 » étiré sur toute la mesure. La raison est
 *      discrète — une note isolée par des silences n'appartient à aucun groupe, donc `groupeDe.get`
 *      rend `undefined` DES DEUX CÔTÉS, et `undefined !== undefined` est faux : la comparaison ne
 *      refermait jamais rien. Le temps, lui, est toujours connu.
 *
 *   3. Puis, troisième correctif, LA POSITION EXACTE plutôt que le numéro de temps — parce que le
 *      deuxième avait introduit sa propre régression. Mesuré : un triolet de NOIRES (trois noires
 *      dans le temps de deux) dure exactement deux temps, donc sa deuxième note enjambe la
 *      frontière et sa troisième tombe dans le temps suivant ; comparer les numéros de temps
 *      coupait ce triolet unique en deux courses et gravait DEUX « 3 ». Le critère juste n'est pas
 *      « le temps a changé » mais « ON PEUT REFERMER ICI » : une course ne se referme que si la
 *      pose suivante COMMENCE pile sur un temps. Quand la frontière tombe au MILIEU d'une figure,
 *      il n'y a aucun endroit où couper, et la course continue.
 *
 * Cette formulation absorbe la précédente : une pose qui commence pile sur un temps change
 * forcément de temps (les positions croissent), donc le numéro de temps n'a plus rien à dire de
 * plus. Elle règle du même coup deux cas que le numéro de temps traitait à l'envers — un triolet
 * posé à contretemps (croche puis triolet de croches : 0,5 / 0,8333 / 1,1667) reste UNE course,
 * et deux triolets de noires consécutifs en font bien DEUX, leur jointure tombant pile sur le
 * temps 2.
 *
 * CE QU'ELLE NE COUVRE PAS, et c'est assumé : un DUOLET en mesure composée (deux noires dans le
 * temps de trois, en 6/8) a sa seconde note pile sur le deuxième temps, et se verrait donc coupé
 * en deux « 2 ». Aucun chemin de l'application n'en fabrique — l'éditeur ne pose que des triolets
 * (voir edit/commands.js#basculerTriolet) et l'import rythmique n'émet que `T3` — seul un fichier
 * JSON étranger pourrait en porter un. Le cas inverse (fusionner deux triolets de noires en un
 * seul « 3 ») est lui atteignable au clavier, et c'est celui qu'on protège.
 *
 * Les deux gardes sont conservées : la position règle le cas général, le groupe de ligature sépare
 * encore deux courses distinctes qui tomberaient dans le même temps.
 */
function poserNolets(out, poses, groupes, S, yPortee, signature) {
    const groupeDe = new Map();
    groupes.forEach((g, ig) => { for (const p of g) groupeDe.set(p, ig); });
    // Le temps de chaque pose, compté comme le fait grouperLigatures : en cumulant les durées
    // écrites depuis le début de la mesure. Même notion de « temps » que les ligatures, le
    // métronome et la grille du séquenceur (voir duration.js#uniteDeGroupement).
    const unite = uniteDeGroupement(signature);
    const debutDe = new Map();
    let tCourant = 0;
    for (const p of poses) {
        debutDe.set(p, tCourant);
        tCourant += dureeEnNoires(p.ref.duree);
    }
    /** Cette pose commence-t-elle PILE sur un temps ? C'est là, et là seulement, qu'on peut couper. */
    const surUnTemps = (p) => {
        const x = debutDe.get(p) / unite;
        return Math.abs(x - Math.round(x)) < 1e-6;
    };

    let i = 0;
    while (i < poses.length) {
        const nolet = poses[i].ref.duree.nolet;
        if (!nolet) { i++; continue; }
        let j = i;
        while (j + 1 < poses.length) {
            const suivant = poses[j + 1].ref.duree.nolet;
            if (!suivant || suivant.dans !== nolet.dans || suivant.valent !== nolet.valent) break;
            if (surUnTemps(poses[j + 1])) break;
            if (groupeDe.get(poses[j]) !== groupeDe.get(poses[j + 1])) break;
            j++;
        }
        const groupe = poses.slice(i, j + 1);
        // UN SILENCE PEUT PORTER LE MÊME N-OLET QU'UNE NOTE VOISINE — la durée collante le lui donne
        // par construction (voir Editeur.deplacerEvenement, la prolongation : le silence qu'elle crée
        // copie {...dureeCourante}, triolet compris, s'il était actif). Un silence n'a ni hampe ni
        // tête (`poserEvenement` ne pose jamais `yHaut`/`yBas`/`yHampe` pour lui) : le laisser dans le
        // calcul du Math.min/max ci-dessous injecte un `undefined` et produit un NaN, qui plaçait le
        // chiffre hors de tout repère (et, sur certains moteurs SVG, faisait échouer l'attribut
        // `transform` du glyphe entier). On aligne donc le chiffre sur les seules poses SONNANTES du
        // groupe ; s'il n'y en a aucune (un n-olet entièrement fait de silences), un repère fixe
        // au-dessus de la portée sert de repli plutôt que de laisser NaN se propager.
        const sonnants = groupe.filter(p => !p.estSilence);
        const sens = (sonnants[0] ?? groupe[0]).sensHampe;
        const y = sonnants.length === 0
            ? yPortee - 2 * S
            : sens < 0
                ? Math.min(...sonnants.map(p => p.yHampe ?? p.yHaut)) - 0.95 * S
                : Math.max(...sonnants.map(p => p.yHampe ?? p.yBas)) + 1.5 * S;
        const xa = groupe[0].x, xb = groupe[groupe.length - 1].x;
        // Chiffres de n-olet de Bravura : penchés et plus étroits que ceux d'une signature, comme le
        // veut la gravure. Leur ligne de base est en bas du glyphe, d'où le décalage quand ils se
        // posent SOUS la ligature.
        const suite = G.chiffresDe(nolet.dans, G.CHIFFRES_NOLET);
        let cx = (xa + xb) / 2 - (suite.largeur / 2) * S;
        const yChiffre = y + (sens < 0 ? 0 : 1.35 * S);
        for (const gl of suite.glyphes) {
            cx += (G.largeurDe(gl) / 2) * S;
            out.push(glyphe(gl, cx, yChiffre, S));
            cx += (G.largeurDe(gl) / 2) * S;
        }
        // Le crochet n'est tracé que si le groupe n'est pas déjà tenu par une ligature : celle-ci
        // délimite déjà le n-olet à l'œil, un crochet par-dessus ferait redondance.
        const ligature = groupe.every(p => p.crochets > 0) && groupe.length > 1;
        if (!ligature && groupe.length > 1) {
            const patte = sens < 0 ? 0.55 * S : -0.55 * S;
            const marge = 1.1 * S;
            out.push(ligne(xa, y + patte, xa, y, G.EPAISSEURS.liaison * S));
            out.push(ligne(xa, y, (xa + xb) / 2 - marge, y, G.EPAISSEURS.liaison * S));
            out.push(ligne((xa + xb) / 2 + marge, y, xb, y, G.EPAISSEURS.liaison * S));
            out.push(ligne(xb, y, xb, y + patte, G.EPAISSEURS.liaison * S));
        }
        i = j + 1;
    }
}

// ---------------------------------------------------------------------------------------------
// Liaisons, hammer-on / pull-off / slides, palm mute
// ---------------------------------------------------------------------------------------------

/**
 * `ST` (interligne de tablature) absent : c'est un appel PIANO (voir poserMesurePiano), qui n'a ni
 * tablature ni palm mute (une technique de main droite sur cordes, sans équivalent au clavier) —
 * seul l'arc de liaison sur la PORTÉE (déjà générique, indépendant de ST) reste tracé.
 */
/**
 * UNE liaison entre deux poses — l'arc de tenue, le trait de slide, la lettre du hammer/pull.
 *
 * EXTRAITE DE `poserLiaisons` pour être appelée DEUX FOIS : depuis la boucle d'une mesure, et depuis
 * le report qui relie une mesure à la suivante (voir reporterLiaison). Une liaison qui
 * franchit une barre est une écriture ordinaire — souvent la seule juste — et elle n'était pas
 * tracée : `poserLiaisons` travaille sur les poses d'UNE mesure et s'arrête à `length - 1`. Mesuré :
 * une liaison interne rendait 2 primitives de courbe, une liaison par-dessus la barre en rendait 0.
 * Le son était juste depuis toujours (le lecteur lit `note.lien`), seul le SIGNE manquait.
 *
 * Rien de son contenu n'a changé en devenant une fonction : les coordonnées sont celles des deux
 * poses, qui vivent déjà dans le même repère de page d'un bout à l'autre d'un système.
 */
function poserUneLiaison(out, a, na, b, nb, S, ST) {
    // UN SLIDE NE S'ÉCRIT PAS COMME UNE LIAISON (retour utilisateur : « le slide n'a pas
    // marché sur ma partition, entre le 6 et 8 de la troisième corde »). Il ne s'agissait pas
    // du son — le glissando s'entendait déjà (voir audio/player.js#_jouerSlide) — mais du
    // SIGNE : la table d'étiquettes rendait une chaîne VIDE pour `slide`, et l'arc tracé était
    // exactement celui d'une liaison de tenue. À l'écran, un slide était donc un tie muet :
    // rien ne distinguait « glisse du 6 au 8 » de « tiens la même note ». D'où, ici, deux
    // écritures séparées plutôt qu'une seule paramétrée par une lettre.
    const glisse = na.note.lien === 'slide';
    // Le sens, lu sur la HAUTEUR et non sur la frette seule : deux notes de même corde se
    // comparent bien par leur frette, mais `hauteurVoulue` (note hors manche, voir
    // model/score.js) peut la contredire, et sur la portée seule il n'y a pas de frette.
    const monte = (na.yPortee != null && nb.yPortee != null)
        ? nb.yPortee < na.yPortee
        : (nb.note.frette ?? 0) > (na.note.frette ?? 0);

    // LA CONDITION PORTE SUR `yTab`, ET NON SUR `ST` — corrigé après un banc rouge. `ST`
    // (l'interligne de tablature) est TOUJOURS défini sur le chemin guitare/basse, même quand
    // il n'y a pas de tablature à dessiner (`avecTab: false`, voir mettreEnPage) ; il ne dit
    // donc rien de l'existence d'une TAB. Ce qui la dit, c'est l'ordonnée des notes dessus :
    // sans tablature, `poserEvenement` range ses notes SANS `yTab` (voir le garde
    // `ctx.cordes > 0`), et le calcul sortait « M NaN NaN C NaN… » — un chemin SVG invalide,
    // que le navigateur refusait en console. Le piano passait, lui, parce que son appelant met
    // `ST` à `undefined` ; l'aide rythmique, non.
    if (na.yTab != null && nb.yTab != null && ST != null) {
        const x1 = a.x + na.demiLargeurTab, x2 = b.x - nb.demiLargeurTab;
        if (glisse) {
            // LE TRAIT OBLIQUE, entre les deux chiffres, montant ou descendant selon le sens
            // — le signe qu'emploient les vraies tablatures. Les deux chiffres étant sur la
            // MÊME ligne de corde, ils partagent leur ordonnée : c'est l'obliquité seule qui
            // porte le sens, d'où une amplitude toujours visible.
            //
            // Sur une double-croche, l'écart entre deux chiffres se réduit à quelques pixels :
            // une amplitude fixe y ferait un trait quasi VERTICAL, illisible et trompeur (il
            // ressemblerait à une barre de mesure). L'amplitude se plafonne donc à la moitié
            // de l'écart disponible — la pente reste sous 45°, le trait reste un trait.
            const marge = 0.16 * S;
            const xa = x1 + marge, xb = x2 - marge;
            if (xb > xa) {
                const amp = Math.min(0.30 * ST, (xb - xa) * 0.5);
                const y1 = na.yTab + (monte ? amp : -amp);
                const y2 = nb.yTab + (monte ? -amp : amp);
                out.push(ligne(xa, y1, xb, y2, G.EPAISSEURS.glisse * S));
            }
            // ET L'ARC, ET « sl. » AU-DESSUS — la notation que l'utilisateur a apportée en
            // image (« peux-tu modifier sa notation comme sur l'image ? C'est plus clair »),
            // et celle des éditions imprimées : « 8⁄10 » sous un arc, « sl. » en italique
            // au-dessus de l'arc.
            //
            // CELA REVIENT SUR UN CHOIX ANTÉRIEUR, et c'est assumé : l'arc avait été RETIRÉ
            // parce qu'il rendait un slide indiscernable d'une liaison de tenue — le trait
            // oblique était alors le seul signe. Mais le trait oblique EXISTE maintenant, et
            // c'est lui qui porte la distinction ; l'arc ne fait plus que grouper les deux
            // chiffres, et « sl. » nomme le geste sans laisser place au doute. Les trois
            // ensemble, il n'y a plus d'ambiguïté possible — c'est bien plus lisible qu'un
            // trait oblique seul, que rien n'annonce.
            // L'ARC ENJAMBE LES DEUX CHIFFRES, il ne se glisse pas entre eux : il part du
            // bord GAUCHE du premier et arrive au bord DROIT du second (x1/x2, eux, sont les
            // bords INTÉRIEURS, ceux que le trait oblique relie). Un premier essai les
            // utilisait, et l'arc se réduisait à une petite bosse coincée entre « 8 » et
            // « 10 » — il ne groupait visiblement rien, ce qui est tout son rôle.
            const xArcA = a.x - na.demiLargeurTab, xArcB = b.x + nb.demiLargeurTab;
            const yArc = na.yTab - ST * 0.8;
            out.push(courbe(arcLiaison(xArcA, yArc, xArcB, nb.yTab - ST * 0.8, -1, 0.42 * S),
                G.EPAISSEURS.liaison * S));
            out.push(texte((xArcA + xArcB) / 2, yArc - ST * 0.95, 'sl.', {
                taille: S * 1.05, police: 'serif', poids: '600', italique: true,
            }));
        } else {
            // Sur la tablature : l'arc relie les deux chiffres, en passant SOUS eux.
            const yT = na.yTab + ST * 0.42;
            out.push(courbe(arcLiaison(x1, yT, x2, nb.yTab + ST * 0.42, 1, 0.34 * S), G.EPAISSEURS.liaison * S));
            const etiquette = { hammer: 'H', pull: 'P', tie: '' }[na.note.lien];
            if (etiquette) {
                out.push(texte((x1 + x2) / 2, na.yTab - ST * 0.42, etiquette, {
                    taille: S * 1.1, police: 'serif', poids: '700', italique: true,
                }));
            }
        }
    }
    if (na.yPortee != null && nb.yPortee != null) {
        const dA = (a.demiTete ?? 0.59) * S, dB = (b.demiTete ?? 0.59) * S;
        if (glisse) {
            // Sur la portée, le glissando joint les deux TÊTES en ligne droite — et les joint
            // vraiment, d'une tête à l'autre, là où l'arc de liaison contourne par-dessus ou
            // par-dessous. Les deux notes différant de hauteur, la droite est naturellement
            // oblique : rien à forcer. Un léger retrait à chaque bout pour ne pas entamer les
            // têtes elles-mêmes.
            const dx = (b.x - dB) - (a.x + dA), dy = nb.yPortee - na.yPortee;
            const long = Math.hypot(dx, dy) || 1;
            const retrait = Math.min(0.28 * S, long * 0.22);
            const ux = dx / long, uy = dy / long;
            out.push(ligne(
                a.x + dA + ux * retrait, na.yPortee + uy * retrait,
                b.x - dB - ux * retrait, nb.yPortee - uy * retrait,
                G.EPAISSEURS.glisse * S));
            // L'ARC ET « sl. » AU-DESSUS, comme sur la tablature (voir là-haut le pourquoi).
            // TOUJOURS AU-DESSUS des têtes, et non du côté opposé aux hampes comme le fait un
            // arc de liaison : « sl. » est une indication de JEU, qui se lit au-dessus de la
            // portée avec les autres (P.M., les articulations) — pas un signe de liaison dont
            // la place dépend de la direction des hampes. C'est aussi ce que montre l'image.
            // AU-DESSUS DE TOUT CE QUI DÉPASSE, hampes comprises : quand elles montent, un
            // arc posé sur les seules têtes leur passerait au travers. `yHampe` (posé par la
            // passe des hampes, qui précède celle-ci) donne le bout réel de chacune ; on
            // prend le point le plus haut des deux notes, tête ou hampe selon le sens.
            const sommetDe = (p, n) => (p.sensHampe < 0 && p.yHampe != null
                ? Math.min(p.yHampe, n.yPortee) : n.yPortee);
            const hautArc = Math.min(sommetDe(a, na), sommetDe(b, nb)) - 0.7 * S;
            // Et l'arc enjambe les deux TÊTES, comme sur la tablature il enjambe les deux
            // chiffres : un arc pincé entre elles ne grouperait rien.
            out.push(courbe(arcLiaison(a.x - dA, hautArc, b.x + dB, hautArc, -1, 0.42 * S),
                G.EPAISSEURS.liaison * S));
            out.push(texte((a.x + b.x) / 2, hautArc - 1.05 * S, 'sl.', {
                taille: S * 1.05, police: 'serif', poids: '600', italique: true,
            }));
        } else {
            // Sur la portée : l'arc se place du côté opposé aux hampes.
            const sens = a.sensHampe < 0 ? 1 : -1;
            out.push(courbe(arcLiaison(a.x + dA, na.yPortee + sens * 0.55 * S, b.x - dB, nb.yPortee + sens * 0.55 * S, sens, 0.38 * S), G.EPAISSEURS.liaison * S));
        }
    }
}

/**
 * LES LIAISONS QUI FRANCHISSENT UNE BARRE DE MESURE.
 *
 * LE TROU. `poserLiaisons` travaille sur les poses d'UNE mesure : la seconde note d'une liaison qui
 * franchit la barre n'existe pas encore quand la première est posée. Mesuré, le signe manquait
 * complètement — 0 primitive de courbe là où une liaison interne en rend 2 — alors que le son était
 * juste depuis toujours. Le séquenceur rythmique sait désormais écrire ce cas couramment, ce qui
 * rendait le trou visible tous les jours.
 *
 * POURQUOI CE N'EST PAS UNE PASSE FINALE, et c'est le piège qui a coûté une première version. Une
 * passe posée APRÈS tous les systèmes émettait bien ses arcs — je les ai comptés dans le tableau de
 * primitives — mais AUCUN n'arrivait à l'écran. Les deux rendus, SVG et PDF, ne dessinent pas le
 * tableau entier : ils le DÉCOUPENT par système (`ancrages.systemes[].debutPrimitives/
 * finPrimitives`, voir render/svg.js et io/pdf.js), pour ne peindre que les lignes visibles et pour
 * paginer. Tout ce qui est ajouté après la dernière tranche n'appartient à aucune, et disparaît.
 * Chaque primitive doit donc naître DANS la tranche de son système.
 *
 * D'OÙ CE REPORT DE MESURE À MESURE. Une voix qui finit sa mesure sur une note liée laisse son
 * dernier geste « en attente » (`ctx.liaisons`, une entrée par voix) ; la mesure suivante le trouve
 * et referme l'arc — les deux poses étant alors connues, et dans le même système.
 *
 * ET LE SAUT DE LIGNE. Un arc unique traverserait la page de part en part, ce qu'aucune édition ne
 * fait : la convention est DEUX DEMI-ARCS, l'un qui s'échappe à droite après la première note,
 * l'autre qui arrive par la gauche avant la seconde. Le départ doit être tracé pendant la mesure qui
 * PART (sa tranche se referme avec son système), l'arrivée pendant celle qui ARRIVE. On sait lequel
 * des deux cas s'applique parce que le découpage en systèmes est décidé AVANT la pose (voir
 * `debutsDeSysteme`).
 */

/** La longueur d'un demi-arc de liaison coupé par un saut de ligne, en interlignes. */
const DEMI_LIAISON = 2.6;

/**
 * Un demi-arc. `vers` valant +1 il s'échappe à droite de `x`, -1 il arrive par la gauche ; `borne`
 * est le bord du système, qu'il ne franchit pas — sinon l'arc partirait dans la marge, ou
 * par-dessus la clé. Rend l'abscisse de son milieu (où poser une étiquette), ou `null` s'il n'y
 * avait pas la place : mieux vaut rien qu'un moignon de deux pixels.
 */
function demiArc(out, x, y, sens, vers, borne, S) {
    const xBout = vers > 0 ? Math.min(x + DEMI_LIAISON * S, borne) : Math.max(x - DEMI_LIAISON * S, borne);
    if (Math.abs(xBout - x) < 0.6 * S) return null;
    const x1 = Math.min(x, xBout), x2 = Math.max(x, xBout);
    // Le demi-arc s'aplatit vers son bout LIBRE : on tire l'ordonnée de ce bout vers la ligne, ce
    // qui donne la moitié d'arc des éditions plutôt qu'une bosse symétrique qui se lirait comme une
    // liaison complète miniature.
    const yLibre = y + sens * 0.34 * S;
    out.push(courbe(arcLiaison(x1, vers > 0 ? y : yLibre, x2, vers > 0 ? yLibre : y, sens, 0.38 * S),
        G.EPAISSEURS.liaison * S));
    return (x1 + x2) / 2;
}

/**
 * CHAQUE SURFACE PORTE SES PROPRES ÉTIQUETTES, comme à l'intérieur d'une mesure (voir
 * poserUneLiaison) : « H »/« P » sont une notation de TABLATURE et ne s'écrivent pas sur la portée,
 * « sl. » est une indication de jeu et s'écrit sur les deux. Et elles ne s'écrivent QU'AU DÉPART :
 * c'est là que le geste commence, et les répéter en début de ligne les ferait lire comme un second
 * hammer-on.
 */
function etiquettesDe(lien) {
    return { portee: lien === 'slide' ? 'sl.' : '',
             tab: { hammer: 'H', pull: 'P', slide: 'sl.', tie: '' }[lien] ?? '' };
}

/** Le demi-arc de DÉPART, tracé dans la mesure qui part — avec son étiquette. */
function poserDemiLiaisonDepart(out, a, na, S, ST, xFinSysteme) {
    const { portee, tab } = etiquettesDe(na.note.lien);
    if (na.yPortee != null) {
        const dA = (a.demiTete ?? 0.59) * S;
        const sens = a.sensHampe < 0 ? 1 : -1;
        const cx = demiArc(out, a.x + dA, na.yPortee + sens * 0.55 * S, sens, 1, xFinSysteme, S);
        if (portee && cx != null) {
            out.push(texte(cx, na.yPortee + sens * 1.6 * S, portee,
                { taille: S * 1.05, police: 'serif', poids: '600', italique: true }));
        }
    }
    if (na.yTab != null && ST != null) {
        const cx = demiArc(out, a.x + na.demiLargeurTab, na.yTab + ST * 0.42, 1, 1, xFinSysteme, S);
        if (tab && cx != null) {
            out.push(texte(cx, na.yTab - ST * 0.42, tab,
                { taille: S * 1.1, police: 'serif', poids: '700', italique: true }));
        }
    }
}

/** Le demi-arc d'ARRIVÉE, tracé dans la mesure qui arrive — muet, l'étiquette est au départ. */
function poserDemiLiaisonArrivee(out, d, nb, S, ST, xDebutSysteme) {
    if (nb.yPortee != null) {
        const dB = (d.demiTete ?? 0.59) * S;
        const sens = d.sensHampe < 0 ? 1 : -1;
        demiArc(out, d.x - dB, nb.yPortee + sens * 0.55 * S, sens, -1, xDebutSysteme, S);
    }
    if (nb.yTab != null && ST != null) {
        demiArc(out, d.x - nb.demiLargeurTab, nb.yTab + ST * 0.42, 1, -1, xDebutSysteme, S);
    }
}

/**
 * LE REPORT, appelé par chaque voix de chaque mesure une fois ses propres liaisons posées.
 *
 * Il fait les deux moitiés du travail : refermer ce que la mesure précédente a laissé en attente,
 * puis laisser en attente ce que celle-ci laisse ouvert. `coupe` dit qu'un saut de ligne sépare
 * cette mesure de la suivante — l'information vient du découpage en systèmes, décidé avant la pose.
 */
function reporterLiaison(out, ctx, iVoix, iMesure, poses, S, ST, coupe) {
    const attentes = ctx.liaisons;
    if (!attentes) return;
    const attente = attentes.get(iVoix);
    attentes.delete(iVoix);
    // 1. Refermer.
    if (attente && attente.mesure === iMesure - 1 && poses.length) {
        const d = poses[0];
        const nb = d.notes.find(n => n.note.corde === attente.na.note.corde);
        if (nb) {
            if (attente.iSys === ctx.iSys) poserUneLiaison(out, attente.pose, attente.na, d, nb, S, ST);
            else poserDemiLiaisonArrivee(out, d, nb, S, ST, ctx.xDebutSysteme ?? -Infinity);
        }
    }
    // 2. Laisser en attente — ou, si la ligne se coupe ici, tracer tout de suite le départ.
    const derniere = poses[poses.length - 1];
    const na = derniere?.notes?.find(n => n.note.lien);
    if (!na) return;
    if (coupe) poserDemiLiaisonDepart(out, derniere, na, S, ST, ctx.xFinSysteme ?? Infinity);
    attentes.set(iVoix, { mesure: iMesure, iSys: ctx.iSys, pose: derniere, na });
}

function poserLiaisons(out, poses, S, ST) {
    for (let i = 0; i < poses.length - 1; i++) {
        const a = poses[i], b = poses[i + 1];
        for (const na of a.notes) {
            if (!na.note.lien) continue;
            const nb = b.notes.find(n => n.note.corde === na.note.corde);
            if (!nb) continue;
            poserUneLiaison(out, a, na, b, nb, S, ST);
        }
    }

    if (ST == null) return;

    // Palm mute : « P.M. » suivi d'un trait pointillé au-dessus de la tablature, sur toute la plage
    // d'évènements consécutifs qui le portent — un P.M. par note serait illisible.
    let debut = null;
    for (let i = 0; i <= poses.length; i++) {
        const actif = i < poses.length && poses[i].ref.palmMute;
        if (actif && debut === null) debut = i;
        if (!actif && debut !== null) {
            const a = poses[debut], b = poses[i - 1];
            const yPM = Math.min(...poses.slice(debut, i).map(p => p.notes.length ? Math.min(...p.notes.map(n => n.yTab)) : Infinity)) - ST * 0.85;
            out.push(texte(a.x - 0.4 * S, yPM, 'P.M.', { taille: S * 1.05, police: 'serif', italique: true, poids: '600', ancre: 'debut' }));
            if (b.x > a.x + 2 * S) out.push({ ...ligne(a.x + 2.4 * S, yPM - S * 0.3, b.x + 0.6 * S, yPM - S * 0.3, G.EPAISSEURS.liaison * S), pointille: [2.2, 2.2] });
            debut = null;
        }
    }
}
