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

import { creerPartition, creerMesure, creerEvenement, creerNote, figuresPour } from './score.js';
import { uniteDeGroupement, dureeEnNoires } from './duration.js';

/**
 * Subdivisions proposées, DANS L'ORDRE OÙ LE CLIC LES FAIT DÉFILER — et cet ordre n'est pas
 * numérique exprès. On part de 4 (l'état par défaut, les doubles-croches) et le PREMIER clic donne
 * TROIS : le triolet est la raison d'être de cette fenêtre, il doit être à un clic, pas à deux.
 * Rangées 2-3-4, un temps par défaut aurait demandé deux clics pour devenir un triolet.
 */
export const SUBDIVISIONS = [4, 3, 2];

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
    etat.temps.forEach((t, iTemps) => {
        t.cellules.forEach((etatCell, iCell) => {
            plat.push({ iTemps, iCell, mesure: t.mesure, sub: t.sub, etat: etatCell, duree: etat.unite / t.sub });
        });
    });
    return plat;
}

/**
 * LA CONVERSION — une suite de cellules devient une suite de FIGURES standard.
 *
 * TROIS RÈGLES, dans cet ordre, et chacune existe pour un cas que la précédente ne sait pas traiter :
 *
 *   1. UNE COURSE ENTIÈREMENT DANS UN TEMPS EN TROIS donne UNE figure de triolet. Une cellule = une
 *      croche de triolet, deux = une noire de triolet. C'est le seul cas où le modèle a besoin de
 *      `nolet`, et le seul que `figuresPour` ne sait pas exprimer : un tiers de temps n'est pas une
 *      somme de figures binaires (mesuré — `figuresPour(2/3)` ne rend que 0,625 sur 0,667 demandé,
 *      puis renonce).
 *   2. SINON, `figuresPour` si sa somme retombe EXACTEMENT sur la durée. Elle couvre tout le binaire,
 *      pointées comprises, et lie les figures entre elles quand il en faut plusieurs.
 *   3. SINON, on COUPE au temps et on recommence. C'est le cas d'une note qui enjambe un temps en
 *      trois et un temps en deux : sa durée n'est exprimable par aucune figure, mais chacun de ses
 *      morceaux l'est. Les morceaux sont LIÉS — c'est ce qu'écrit une vraie partition.
 */
function figuresDeCourse(cellules) {
    if (!cellules.length) return [];
    const total = cellules.reduce((s, c) => s + c.duree, 0);

    // Règle 1 : un seul temps, subdivisé en trois, sans le couvrir entièrement.
    const memeTemps = cellules.every(c => c.iTemps === cellules[0].iTemps);
    if (memeTemps && cellules[0].sub === 3 && cellules.length < 3) {
        // Une cellule = croche de triolet ; deux = noire de triolet. La valeur double quand la durée
        // double, exactement comme entre une croche et une noire.
        const valeur = cellules.length === 1 ? 8 : 4;
        return [{ valeur, points: 0, nolet: { ...T3 } }];
    }

    // Règle 2 : les figures standard, si elles tombent juste.
    const figs = figuresPour(total);
    const somme = figs.reduce((s, f) => s + dureeEnNoires(f), 0);
    if (figs.length && Math.abs(somme - total) < 1e-6) return figs.map(f => ({ ...f, nolet: null }));

    // Règle 3 : couper au temps.
    const sortie = [];
    let debut = 0;
    while (debut < cellules.length) {
        let fin = debut + 1;
        while (fin < cellules.length && cellules[fin].iTemps === cellules[debut].iTemps) fin++;
        sortie.push(...figuresDeCourse(cellules.slice(debut, fin)));
        debut = fin;
    }
    return sortie;
}

/** Les figures d'un SILENCE de cette durée : mêmes règles, mais un silence ne se lie jamais. */
function figuresDeSilence(cellules) {
    return figuresDeCourse(cellules);
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
    const { corde = 2, aRemplir = false, avecNotes = true } = options;
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
                for (const f of figuresDeSilence(cellules.slice(i, i + n))) {
                    evenements.push(creerEvenement(f, [], { silence: true }));
                }
                i += n;
            } else {
                // Une attaque, prolongée par toutes les `tenue` qui suivent.
                let n = 1;
                while (i + n < cellules.length && cellules[i + n].etat === TENUE) n++;
                const figs = figuresDeCourse(cellules.slice(i, i + n));
                figs.forEach((f, k) => {
                    // Plusieurs figures pour une seule note : elles sont LIÉES, sauf la dernière.
                    const notes = avecNotes ? [creerNote(corde, 0, k < figs.length - 1 ? { lien: 'tie' } : {})] : [];
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
 * LA PARTITION JETABLE de l'aperçu — celle qu'on donne au moteur de gravure et au lecteur.
 *
 * TOUTES LES NOTES SUR LA MÊME HAUTEUR, et c'est voulu : l'aide ne parle que de rythme. Une position
 * fixe ne se LIT pas comme une hauteur, ce qui est précisément l'effet cherché — et c'est une
 * constante au lieu d'une table par clé.
 */
export function partitionApercu(etat, instrumentId, ternaire = false) {
    const p = creerPartition(instrumentId);
    p.meta.titre = '';
    p.meta.ternaire = !!ternaire;
    const parMesure = evenementsParMesure(etat, { avecNotes: true });
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
        for (let t = 0; t < n; t++) temps.push({ debut: m.debut + t * duree, duree, mesure: i, sub: 2 });
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
export function figuresSurGrille(temps, debut, fin) {
    if (!(fin > debut + EPS)) return [];
    const cellules = [];
    let x = debut;
    let garde = 0;
    while (x < fin - EPS && garde++ < 4096) {
        const iTemps = tempsA(temps, x);
        const t = temps[iTemps];
        const cellule = t.duree / t.sub;
        const iCell = Math.max(0, Math.min(t.sub - 1, Math.round((x - t.debut) / cellule)));
        cellules.push({ iTemps, iCell, mesure: t.mesure, sub: t.sub, etat: ATTAQUE, duree: cellule });
        x += cellule;
    }
    return figuresDeCourse(cellules);
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
