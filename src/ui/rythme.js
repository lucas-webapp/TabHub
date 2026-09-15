// L'AIDE RYTHMIQUE — un séquenceur qui ne sert qu'à répondre « comment ça s'écrit ? ».
//
// POURQUOI ELLE EXISTE. Retour utilisateur : « des fois j'ai des difficultés à écrire la partition à
// cause du rythme ». La saisie de TabHub demande de NOMMER une durée avant d'écrire une note — noire ?
// croche pointée ? — et c'est un acte de vocabulaire, pas de musique. Ici on place des barres, et la
// vraie écriture s'affiche à côté, avec ses figures, ses silences et ses ligatures.
//
// CE QU'ELLE N'EST PAS, et c'est ce qui la rend sûre : ce n'est PAS une seconde surface d'édition.
// Elle ne connaît ni hauteurs, ni effets, ni voix multiples. Elle produit une suite de DURÉES, que
// l'insertion pose dans la partition en cases à remplir (voir model/score.js `Évènement#aRemplir`).
// Une grille qui prétendrait tout éditer aurait obligé à reproduire chaque geste de l'application —
// et un demi-outil qu'il faut quitter pour finir le travail est pire que pas d'outil.
//
// LA VRAIE ÉCRITURE EST GRATUITE, littéralement : le rythme est converti en une partition JETABLE,
// passée dans le moteur de gravure habituel (engine/layout.js) avec `avecTab: false`. Pas une ligne
// de dessin ici. Les triolets y arrivent avec leur chiffre, les croches pointées avec leur ligature
// et les silences avec le bon glyphe, parce que c'est le même moteur que la partition.
//
// LA GRILLE. Une mesure se divise en TEMPS (voir uniteDeGroupement), chaque temps en 2, 3 ou 4
// CELLULES — jamais plus (pas de triples-croches, décidé avec l'utilisateur). La subdivision se
// choisit temps par temps, en cliquant son en-tête : c'est le cas courant d'un morceau binaire avec
// un seul temps en triolet, et c'est justement celui qu'on n'arrive pas à écrire à la main.

import { mettreEnPage } from '../engine/layout.js';
import { rendreSvg } from '../render/svg.js';
import { creerPartition, creerMesure, creerEvenement, creerNote, figuresPour, capaciteMesure } from '../model/score.js';
import { uniteDeGroupement, dureeEnNoires } from '../model/duration.js';

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

/** Toutes les cellules à plat, chacune sachant d'où elle vient et ce qu'elle vaut en noires. */
function aplatirCellules(etat) {
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

/**
 * Dessine l'aperçu dans `hote` : la vraie écriture du rythme, portée seule.
 * @returns {object} la page mise en page, pour que l'appelant puisse en lire la hauteur.
 */
export function dessinerApercu(hote, etat, instrumentId, ternaire, largeur) {
    const p = partitionApercu(etat, instrumentId, ternaire);
    const page = mettreEnPage(p, {
        S: 10,
        largeurPage: Math.max(320, largeur),
        // PORTÉE SEULE : une tablature n'aurait rien à dire ici, toutes ses notes étant à la même
        // case — elle afficherait « 0 — 0 — 0 » sous la portée, du bruit pur (voir layout.js#avecTab).
        avecTab: false,
        yDepart: 4,
        mesuresParLigne: 0,
        // Pas de fond teinté sur une mesure incomplète : dans l'aide, une mesure à moitié remplie est
        // l'état NORMAL du travail en cours, pas une erreur à signaler.
        avertirErreurs: false,
    });
    // Le fond « papier » est GARDÉ (option par défaut) : dans une fenêtre sombre, un panneau clair
    // portant de l'encre noire se lit comme une partition — c'est l'effet cherché, l'aperçu doit
    // ressembler à ce qu'on obtiendra.
    hote.innerHTML = rendreSvg(page);
    return page;
}

// ---------------------------------------------------------------------------------------------
// LA GRILLE À L'ÉCRAN
//
// Elle vit ici plutôt que dans main.js parce que `ui/` a le droit de toucher au DOM (voir le README,
// « une dépendance ne remonte jamais ») et que main.js n'a pas à grossir d'une seconde grille.
// ---------------------------------------------------------------------------------------------

/**
 * Construit la grille et branche les gestes. Rend une fonction de rafraîchissement, pour que
 * l'appelant redessine après avoir changé l'état sans reconstruire tout le DOM.
 *
 * DEUX GESTES SEULEMENT, et le second est celui qui compte :
 *   • un CLIC pose ou retire une attaque ;
 *   • un GLISSER depuis une cellule étire la note sur celles qu'il traverse — c'est ainsi qu'on dit
 *     « cette note dure trois cases » sans jamais nommer une figure. C'est le geste que cette fenêtre
 *     existe pour offrir.
 *
 * Le clic sur l'EN-TÊTE d'un temps fait défiler sa subdivision (2 → 3 → 4 → 2). Un temps en trois est
 * un triolet : c'est le cas qu'on n'écrit pas à la main, et il est à un clic.
 */
export function construireGrille(hote, etat, { surChangement } = {}) {
    let geste = null;   // { iTemps, iCell, indexPlat } pendant un glisser

    const indexPlat = (iTemps, iCell) => {
        let n = 0;
        for (let t = 0; t < iTemps; t++) n += etat.temps[t].cellules.length;
        return n + iCell;
    };

    const rafraichir = () => {
        for (const bouton of hote.querySelectorAll('[data-cell]')) {
            const t = Number(bouton.dataset.temps), c = Number(bouton.dataset.cell);
            const e = etat.temps[t]?.cellules[c];
            bouton.classList.toggle('attaque', e === ATTAQUE);
            bouton.classList.toggle('tenue', e === TENUE);
            bouton.setAttribute('aria-pressed', String(e !== VIDE));
        }
        for (const entete of hote.querySelectorAll('[data-sub]')) {
            const t = Number(entete.dataset.sub);
            entete.textContent = String(etat.temps[t]?.sub ?? 4);
        }
    };

    const construire = () => {
        hote.innerHTML = '';
        for (let m = 0; m < etat.nMesures; m++) {
            const ligne = document.createElement('div');
            ligne.className = 'mesure-rythme';
            const num = document.createElement('span');
            num.className = 'numero-mesure-rythme';
            num.textContent = String(m + 1);
            ligne.appendChild(num);
            etat.temps.forEach((t, iTemps) => {
                if (t.mesure !== m) return;
                const bloc = document.createElement('div');
                bloc.className = 'temps-rythme';
                const entete = document.createElement('button');
                entete.type = 'button';
                entete.className = 'entete-temps';
                entete.dataset.sub = String(iTemps);
                entete.title = 'Subdivision de ce temps : 2 (croches), 3 (triolet) ou 4 (doubles-croches) — cliquez pour changer';
                entete.setAttribute('aria-label', entete.title);
                entete.addEventListener('click', () => {
                    const suivant = SUBDIVISIONS[(SUBDIVISIONS.indexOf(t.sub) + 1) % SUBDIVISIONS.length];
                    changerSubdivision(etat, iTemps, suivant);
                    construire();
                    surChangement?.();
                });
                bloc.appendChild(entete);
                const rangee = document.createElement('div');
                rangee.className = 'cellules-temps';
                t.cellules.forEach((_, iCell) => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'cellule-rythme';
                    b.dataset.temps = String(iTemps);
                    b.dataset.cell = String(iCell);
                    b.setAttribute('aria-label', `Mesure ${m + 1}, temps ${iTemps % etat.tempsParMesure + 1}, case ${iCell + 1}`);
                    rangee.appendChild(b);
                });
                bloc.appendChild(rangee);
                ligne.appendChild(bloc);
            });
            hote.appendChild(ligne);
        }
        rafraichir();
    };

    // UN SEUL BRANCHEMENT, PAR DÉLÉGATION sur l'hôte : la grille se reconstruit à chaque changement
    // de subdivision, et rebrancher chaque cellule à chaque fois finirait par en oublier une.
    hote.addEventListener('pointerdown', (ev) => {
        const b = ev.target.closest('[data-cell]');
        if (!b) return;
        ev.preventDefault();
        const iTemps = Number(b.dataset.temps), iCell = Number(b.dataset.cell);
        geste = { iTemps, iCell, depart: indexPlat(iTemps, iCell), etire: false };
        b.setPointerCapture?.(ev.pointerId);
    });
    hote.addEventListener('pointermove', (ev) => {
        if (!geste) return;
        // `elementFromPoint` plutôt que `ev.target` : avec la capture du pointeur, la cible reste la
        // cellule de DÉPART pendant tout le glisser — on ne saurait jamais qu'on en a traversé d'autres.
        const sous = document.elementFromPoint(ev.clientX, ev.clientY);
        const b = sous?.closest?.('[data-cell]');
        if (!b || !hote.contains(b)) return;
        const jusqua = indexPlat(Number(b.dataset.temps), Number(b.dataset.cell));
        if (jusqua <= geste.depart) return;
        geste.etire = true;
        etirerCellule(etat, geste.iTemps, geste.iCell, jusqua - geste.depart + 1);
        rafraichir();
        surChangement?.();
    });
    const finir = () => {
        if (!geste) return;
        // Un glisser qui n'a traversé aucune autre cellule EST un clic : c'est le même geste au doigt,
        // où l'on bouge toujours de deux ou trois pixels sans le vouloir.
        if (!geste.etire) { basculerCellule(etat, geste.iTemps, geste.iCell); rafraichir(); surChangement?.(); }
        geste = null;
    };
    hote.addEventListener('pointerup', finir);
    hote.addEventListener('pointercancel', finir);

    construire();
    return { rafraichir, reconstruire: construire };
}
