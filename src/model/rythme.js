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
import { uniteDeGroupement, dureeEnNoires } from './duration.js';
import { tonaliteDe, LETTRE_VERS_PC } from './theory.js';
import { hauteurDeCase } from './instruments.js';

/**
 * LES DEUX SUBDIVISIONS PROPOSÉES — et il n'y en a que deux parce qu'il n'y a qu'une question
 * musicale : ce temps se divise-t-il en MOITIÉS ou en TIERS ? 4 (doubles-croches) pour le binaire,
 * 3 (croches de triolet) pour le ternaire.
 *
 * POURQUOI « 2 » A DISPARU. Il y était, et il ne servait à rien : une grille en deux est un
 * sous-ensemble strict d'une grille en quatre, et les deux produisent une écriture RIGOUREUSEMENT
 * identique (vérifié — deux croches sur une grille en 2 et sur une grille en 4 rendent les mêmes
 * figures, octet pour octet). Ce n'était donc pas un choix musical mais une finesse de clic déguisée
 * en choix musical, et c'est une bonne part de ce qui rendait le réglage illisible — retour
 * utilisateur : « théoriquement parlant, j'ai l'impression que cet outil est incohérent ».
 *
 * L'ordre de `PREFERENCE_SUB` plus bas est différent et garde le 2 : il ne décrit pas un choix
 * offert, mais la subdivision qu'un import MIDI DÉDUIT de ce qu'il entend, où « le plus simple qui
 * explique aussi bien » est la bonne réponse.
 */
export const SUBDIVISIONS = [4, 3];

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
    const temps = [];
    for (let m = 0; m < nMesures; m++) {
        for (let t = 0; t < parMesure; t++) temps.push({ mesure: m, sub: 4, cellules: Array(4).fill(VIDE) });
    }
    return { nMesures, signature, unite, tempsParMesure: parMesure, temps };
}

/** Change la subdivision d'un temps, en conservant ce qui peut l'être : les cellules repartent
 *  vides. Redistribuer un rythme d'une grille à l'autre donnerait un résultat que personne n'a
 *  demandé — mieux vaut un temps propre à re-remplir qu'un rythme deviné de travers. */
export function changerSubdivision(etat, iTemps, sub) {
    const t = etat.temps[iTemps];
    if (!t || !SUBDIVISIONS.includes(sub) || t.sub === sub) return etat;
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
    if (!SUBDIVISIONS.includes(sub)) return etat;
    for (const t of etat.temps) { t.sub = sub; t.cellules = Array(sub).fill(VIDE); }
    return etat;
}

/** Un clic sur une cellule : vide → attaque, attaque → vide. Une cellule `tenue` redevient une
 *  attaque (on coupe la note en deux à cet endroit), ce qui est le geste qu'on attend en cliquant au
 *  milieu d'une note tenue. */
export function basculerCellule(etat, iTemps, iCell) {
    const t = etat.temps[iTemps];
    if (!t) return etat;
    const avant = t.cellules[iCell];
    t.cellules[iCell] = avant === ATTAQUE ? VIDE : ATTAQUE;
    return etat;
}

/** Étire une note depuis `iCell` du temps `iTemps` sur `n` cellules consécutives (le glisser).
 *  Les cellules suivantes deviennent `tenue` — la note dure, sans qu'on nomme sa figure. */
export function etirerCellule(etat, iTemps, iCell, nCellules) {
    const plat = aplatirCellules(etat);
    const depart = plat.findIndex(c => c.iTemps === iTemps && c.iCell === iCell);
    if (depart < 0) return etat;
    etat.temps[iTemps].cellules[iCell] = ATTAQUE;
    for (let k = 1; k < Math.max(1, nCellules); k++) {
        const c = plat[depart + k];
        if (!c) break;
        etat.temps[c.iTemps].cellules[c.iCell] = TENUE;
    }
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
// ce qui est la bonne forme pour convertir en figures. La grille, elle, voit une mesure comme une
// RANGÉE de colonnes numérotées de 0 à n-1 : c'est ainsi qu'un geste s'exprime (« de la colonne 3 à
// la colonne 6 »), et la traduction ne doit pas vivre dans l'interface, qui n'a pas à connaître le
// découpage interne.
//
// UNE COURSE est une note et sa tenue : une ATTAQUE suivie de ses TENUE. C'est l'objet que
// l'utilisateur manipule — il étire une NOTE, il ne peint pas des cases une par une.
// ---------------------------------------------------------------------------------------------

/** Les cellules d'UNE mesure, à plat et dans l'ordre : la vue en colonnes. */
export function colonnesDeMesure(etat, mesure) {
    return aplatirCellules(etat).filter(c => c.mesure === mesure);
}

/** Écrit l'état d'une colonne, en passant par le rangement réel (temps, cellule). */
function ecrireColonne(etat, cols, i, valeur) {
    const c = cols[i];
    if (c) etat.temps[c.iTemps].cellules[c.iCell] = valeur;
}

/**
 * LA COURSE QUI COUVRE la colonne `i`, ou `null` si cette colonne est vide.
 *
 * On remonte jusqu'à l'attaque : c'est ce qui fait qu'un geste pris au MILIEU d'une note tenue
 * manipule la note ENTIÈRE, et non la cellule sous le doigt. Une tenue orpheline (sans attaque
 * devant elle, ce qu'aucun geste ne produit mais qu'un fichier malformé pourrait contenir) ne rend
 * rien plutôt que de faire croire à une note.
 */
export function courseA(etat, mesure, i) {
    const cols = colonnesDeMesure(etat, mesure);
    if (!cols[i] || cols[i].etat === VIDE) return null;
    let debut = i;
    while (debut > 0 && cols[debut].etat === TENUE) debut--;
    if (cols[debut].etat !== ATTAQUE) return null;
    let fin = debut;
    while (fin + 1 < cols.length && cols[fin + 1].etat === TENUE) fin++;
    return { debut, fin };
}

/** Toutes les courses d'une mesure, dans l'ordre — la liste que la grille dessine en pilules. */
export function coursesDeMesure(etat, mesure) {
    const cols = colonnesDeMesure(etat, mesure);
    const sortie = [];
    let i = 0;
    while (i < cols.length) {
        if (cols[i].etat !== ATTAQUE) { i++; continue; }
        let fin = i;
        while (fin + 1 < cols.length && cols[fin + 1].etat === TENUE) fin++;
        sortie.push({ debut: i, fin });
        i = fin + 1;
    }
    return sortie;
}

/**
 * POSE une course de `debut` à `fin` (colonnes incluses), en écrasant ce qu'elle recouvre.
 *
 * ÉCRASER PLUTÔT QUE REFUSER, et c'est un choix : étirer une note par-dessus sa voisine absorbe la
 * voisine. Refuser le geste obligerait à effacer d'abord, pour un résultat que l'utilisateur voit
 * de toute façon venir — la pilule grandit sous son doigt.
 *
 * LES TENUES ORPHELINES SONT NETTOYÉES. Absorber la voisine lui prend son attaque ; les tenues
 * qu'elle laissait derrière `fin` n'appartiendraient plus à rien, et se liraient comme un
 * prolongement fantôme de la nouvelle note. On les vide.
 */
export function poserCourse(etat, mesure, debut, fin) {
    const cols = colonnesDeMesure(etat, mesure);
    const a = Math.max(0, Math.min(cols.length - 1, Math.min(debut, fin)));
    const b = Math.max(0, Math.min(cols.length - 1, Math.max(debut, fin)));
    ecrireColonne(etat, cols, a, ATTAQUE);
    for (let i = a + 1; i <= b; i++) ecrireColonne(etat, cols, i, TENUE);
    for (let i = b + 1; i < cols.length && cols[i].etat === TENUE; i++) ecrireColonne(etat, cols, i, VIDE);
    return etat;
}

/** EFFACE la course qui couvre la colonne `i` — le geste « supprimer cette note ». */
export function effacerCourse(etat, mesure, i) {
    const course = courseA(etat, mesure, i);
    if (!course) return etat;
    const cols = colonnesDeMesure(etat, mesure);
    for (let k = course.debut; k <= course.fin; k++) ecrireColonne(etat, cols, k, VIDE);
    return etat;
}

/**
 * DÉPLACE une course de `delta` colonnes, sans la déformer ni la faire sortir de sa mesure.
 *
 * Le glissement est BORNÉ plutôt que refusé quand il pousse contre un bord : une note traînée trop
 * loin se colle au bord et y reste, au lieu de disparaître ou d'ignorer le geste. C'est ce que fait
 * tout séquenceur, et c'est ce qui permet de viser le dernier temps sans précision.
 */
export function deplacerCourse(etat, mesure, i, delta) {
    const course = courseA(etat, mesure, i);
    if (!course) return etat;
    const n = colonnesDeMesure(etat, mesure).length;
    const longueur = course.fin - course.debut;
    const d = Math.max(-course.debut, Math.min(n - 1 - course.fin, delta));
    if (d === 0) return etat;
    effacerCourse(etat, mesure, course.debut);
    poserCourse(etat, mesure, course.debut + d, course.fin + d);
    return etat;
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
 *   2. ELLE TIENT DANS UN SEUL TEMPS. Si ce temps est ternaire et qu'elle ne le couvre pas, c'est le
 *      seul cas où le modèle a besoin de `nolet` : un tiers de temps n'est pas une somme de figures
 *      binaires (mesuré — `figuresPour(2/3)` ne rend que 0,625 sur 0,667 demandé, puis renonce).
 *      Sinon, le découpeur aligné.
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

    // 2. Un seul temps.
    const dernier = cellules[cellules.length - 1];
    if (cellules.every(c => c.iTemps === cellules[0].iTemps)) {
        if (cellules[0].sub === 3) {
            // Une cellule = croche de triolet ; deux = noire de triolet. La valeur double quand la
            // durée double, exactement comme entre une croche et une noire.
            return [{ valeur: cellules.length === 1 ? 8 : 4, points: 0, nolet: { ...T3 } }];
        }
        return decouper();
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
    const parMesure = [];
    for (let m = 0; m < etat.nMesures; m++) {
        const cellules = plat.filter(c => c.mesure === m);
        const evenements = [];
        let i = 0;
        while (i < cellules.length) {
            const depart = cellules[i];
            if (depart.etat === VIDE) {
                let n = 1;
                while (i + n < cellules.length && cellules[i + n].etat === VIDE) n++;
                for (const f of figuresDeCourse(cellules.slice(i, i + n), etat.unite, true)) {
                    evenements.push(creerEvenement(f, [], { silence: true }));
                }
                i += n;
            } else {
                // Une attaque, prolongée par toutes les `tenue` qui suivent.
                let n = 1;
                while (i + n < cellules.length && cellules[i + n].etat === TENUE) n++;
                const figs = figuresDeCourse(cellules.slice(i, i + n), etat.unite);
                figs.forEach((f, k) => {
                    // Plusieurs figures pour une seule note : elles sont LIÉES, sauf la dernière.
                    const notes = avecNotes ? [creerNote(corde, frette, k < figs.length - 1 ? { lien: 'tie' } : {})] : [];
                    evenements.push(creerEvenement(f, notes, {
                        silence: !avecNotes, ...(aRemplir ? { aRemplir: true } : {}),
                    }));
                });
                i += n;
            }
        }
        parMesure.push(evenements);
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
 * L'ORDRE DE PRÉFÉRENCE quand deux subdivisions expliquent le temps aussi bien : 2, puis 4, puis 3.
 *
 * Ce n'est PAS l'ordre de `SUBDIVISIONS` (qui décrit un cycle de clics), et la différence compte.
 * Deux croches se lisent aussi bien sur une grille en deux que sur une grille en quatre : autant
 * prendre la plus simple. Et le TRIOLET vient en dernier parce qu'une erreur y coûte le plus cher —
 * un triolet inventé là où le musicien a joué deux doubles un peu tard défigure la partition, alors
 * qu'une double inventée à la place d'un triolet reste une approximation lisible.
 */
const PREFERENCE_SUB = [2, 4, 3];

/**
 * Le triolet doit expliquer le temps DEUX FOIS MIEUX que la meilleure lecture binaire pour être
 * retenu. Sans cette marge, le moindre retard de jeu sur une double-croche basculerait le temps en
 * triolet — et un morceau entier se retrouverait constellé de « 3 » qui n'y sont pas.
 */
const MARGE_TRIOLET = 0.5;

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
 * @returns {number} 2, 3 ou 4.
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
    const meilleureBinaire = Math.min(erreurs.get(2), erreurs.get(4));
    // Le triolet, seulement s'il explique VRAIMENT mieux (voir MARGE_TRIOLET).
    if (erreurs.get(3) < meilleureBinaire * MARGE_TRIOLET - 1e-12) return 3;
    // Sinon la plus simple des deux binaires qui tombe aussi juste que l'autre.
    return erreurs.get(2) <= erreurs.get(4) + 1e-9 ? 2 : 4;
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
