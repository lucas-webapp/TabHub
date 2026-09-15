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

// LA PARTIE PURE EST DANS `model/rythme.js` — grille, conversion en figures, partition d'aperçu —
// parce que l'import MIDI s'en sert aussi (voir là-bas). Elle est REEXPORTÉE ici pour que l'interface
// n'ait qu'une adresse à connaître : `main.js` fait `import * as Rythme from './ui/rythme.js'` et
// trouve tout, le dessin comme le calcul.
export * from '../model/rythme.js';

import { mettreEnPage } from '../engine/layout.js';
import { flecheOutilsSvg, ajusterFleches } from './toolbar.js';
import { rendreSvg } from '../render/svg.js';
import { partitionApercu, aplatirCellules, SUBDIVISIONS, VIDE, ATTAQUE, TENUE, changerSubdivision,
         basculerCellule, etirerCellule } from '../model/rythme.js';

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

    // DEUX FLÈCHES DE DÉFILEMENT, et c'est le `touch-action: none` des cellules qui les impose : un
    // doigt posé sur une case y pose une note, il ne peut donc pas faire glisser la grille. Sur un
    // téléphone, une mesure de 4/4 en doubles-croches (seize cases de 26px) est plus large que
    // l'écran : sans ces flèches, ses dernières cases étaient tout simplement inatteignables.
    //
    // LES MÊMES FLÈCHES QUE LA BARRE D'OUTILS, jusqu'à la fonction qui décide de les montrer
    // (ajusterFleches, importée de ui/toolbar.js) : elle porte un correctif qu'on ne veut surtout pas
    // réécrire ici — une flèche `sticky` est EN FLUX, donc ses 26px comptent dans `scrollWidth`, et
    // le test naïf « ça déborde » se mesurait lui-même (voir là-bas, le fil qui se tient par ses
    // propres 7px). Deux copies de ce raisonnement finiraient par ne plus dire la même chose.
    const PAS = 120;   // un peu moins d'un temps en doubles-croches : on ne saute pas une mesure entière
    const fleche = (sens) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `fleche-outils fleche-outils-${sens}`;
        b.innerHTML = flecheOutilsSvg(sens);
        b.title = sens === 'gauche' ? 'Défiler la grille vers la gauche' : 'Défiler la grille vers la droite';
        b.setAttribute('aria-label', b.title);
        b.addEventListener('click', () => hote.scrollBy({ left: sens === 'gauche' ? -PAS : PAS, behavior: 'smooth' }));
        return b;
    };
    const flecheGauche = fleche('gauche');
    const flecheDroite = fleche('droite');
    // LES MESURES DANS UN ENFANT : l'hôte devient une rangée (les deux flèches et ce bloc), le bloc
    // garde l'empilement vertical des mesures. Sans cet enfant, les flèches se rangeraient au-dessus
    // et en dessous des mesures au lieu de les encadrer.
    const pile = document.createElement('div');
    pile.className = 'mesures-rythme';
    hote.innerHTML = '';
    hote.append(flecheGauche, pile, flecheDroite);
    const rafraichirFleches = () => ajusterFleches(hote, flecheGauche, flecheDroite);
    hote.addEventListener('scroll', rafraichirFleches, { passive: true });
    // REMESURER QUAND LA TAILLE CHANGE, et pas seulement au défilement. La grille est CONSTRUITE
    // pendant que la fenêtre est encore masquée : toutes ses largeurs valent alors zéro, « rien ne
    // déborde », et les flèches restaient éteintes devant une grille qui débordait pourtant dès
    // l'ouverture (mesuré : 184px hors écran sur un téléphone de 390px, aucune flèche). Un
    // observateur de taille couvre l'ouverture, la rotation de l'écran et le redimensionnement de la
    // fenêtre d'un seul mécanisme — plutôt qu'un appel à ne pas oublier chez l'appelant.
    // Pas de boucle à craindre : montrer une flèche change le `scrollWidth` du défilé, jamais la
    // boîte de l'hôte, seule chose que cet observateur regarde.
    if (typeof ResizeObserver === 'function') new ResizeObserver(rafraichirFleches).observe(hote);
    // Molette verticale -> défilement horizontal, comme dans la barre d'outils : une molette
    // ordinaire ne connaît que le vertical, et la grille n'a rien à défiler verticalement.
    hote.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        hote.scrollLeft += e.deltaY;
        e.preventDefault();
    }, { passive: false });

    const indexPlat = (iTemps, iCell) => {
        let n = 0;
        for (let t = 0; t < iTemps; t++) n += etat.temps[t].cellules.length;
        return n + iCell;
    };

    const rafraichir = () => {
        for (const bouton of pile.querySelectorAll('[data-cell]')) {
            const t = Number(bouton.dataset.temps), c = Number(bouton.dataset.cell);
            const e = etat.temps[t]?.cellules[c];
            bouton.classList.toggle('attaque', e === ATTAQUE);
            bouton.classList.toggle('tenue', e === TENUE);
            bouton.setAttribute('aria-pressed', String(e !== VIDE));
        }
        for (const entete of pile.querySelectorAll('[data-sub]')) {
            const t = Number(entete.dataset.sub);
            entete.textContent = String(etat.temps[t]?.sub ?? 4);
        }
    };

    const construire = () => {
        pile.innerHTML = '';
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
            pile.appendChild(ligne);
        }
        rafraichir();
        // Après reconstruction, la largeur a changé (une subdivision qui passe de 2 à 4 double les
        // cases d'un temps) : les flèches se remesurent, sinon elles resteraient éteintes devant une
        // grille qui vient de déborder.
        rafraichirFleches();
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
