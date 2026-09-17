// L'AIDE RYTHMIQUE — un séquenceur qui ne sert qu'à répondre « comment ça s'écrit ? ».
//
// POURQUOI ELLE EXISTE. Retour utilisateur : « des fois j'ai des difficultés à écrire la partition à
// cause du rythme ». La saisie de TabHub demande de NOMMER une durée avant d'écrire une note — noire ?
// croche pointée ? — et c'est un acte de vocabulaire, pas de musique. Ici on pose des notes sur une
// grille, et la vraie écriture s'affiche à côté, avec ses figures, ses silences et ses ligatures.
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
// LA GRILLE, TELLE QU'ELLE EST MAINTENANT — et chaque trait répond à un reproche précis :
//
//   • UNE GRILLE CONTINUE, plus une suite de boîtes. Chaque temps était encadré pour porter un
//     en-tête cliquable ; il en résultait quatre compartiments par mesure (« ne pas autant
//     compartimenter chaque temps »). Le temps se lit désormais à un simple trait plus marqué, et
//     à son NUMÉRO écrit dessous.
//   • UNE NOTE TENUE EST UNE PILULE : une seule forme arrondie posée PAR-DESSUS les cases, avec un
//     repère d'attaque à son début. C'était une file de carrés accolés, chacun avec ses coins
//     (« l'étirement des notes fait une forme bizarre »). Les cases restent dessous et gardent les
//     clics : la pilule n'est que du dessin (`pointer-events: none` en CSS).
//   • LA SUBDIVISION EST GLOBALE, binaire ou ternaire, et se règle en un mot plutôt qu'en cliquant
//     un « 4 » énigmatique au-dessus de chaque temps. Les deux choix offerts DÉPENDENT de la
//     signature (voir model/rythme.js#subdivisionsPour) : en 6/8 le temps est déjà ternaire.
//   • DEUX MESURES PAR RANGÉE, les suivantes en dessous.
//
// LA PARTIE PURE EST DANS `model/rythme.js` — grille, courses, conversion en figures, partition
// d'aperçu — parce que l'import MIDI s'en sert aussi (voir là-bas). Elle est REEXPORTÉE ici pour que
// l'interface n'ait qu'une adresse à connaître : `main.js` fait
// `import * as Rythme from './ui/rythme.js'` et trouve tout, le dessin comme le calcul.
export * from '../model/rythme.js';

import { mettreEnPage } from '../engine/layout.js';
import { rendreSvg } from '../render/svg.js';
import { partitionApercu, colonnesDeMesure, coursesDeMesure, courseA, poserCourse,
         effacerCourse, deplacerCourse, colonneAuTemps, indexDe } from '../model/rythme.js';

/**
 * Dessine l'aperçu dans `hote` : la vraie écriture du rythme, portée seule.
 * @param {object|string} source le MORCEAU (pour son instrument, son accordage et sa tonique), ou un
 *   identifiant d'instrument — voir model/rythme.js#partitionApercu.
 * @returns {object} la page mise en page, pour que l'appelant puisse en lire la hauteur.
 */
export function dessinerApercu(hote, etat, source, ternaire, largeur) {
    const p = partitionApercu(etat, source, ternaire);
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

/** Deux mesures par rangée, les suivantes en dessous — demande explicite de l'utilisateur :
 *  « 2 mesures doivent s'enchainer horizontalement. Si j'en ai plus, les mettre effectivement
 *  en-dessous ». Deux, et pas trois : au-delà, seize cases par mesure ne laissent plus de quoi
 *  viser une double-croche au doigt. */
export const MESURES_PAR_RANGEE = 2;

/** Au-delà de ce déplacement, un geste n'est plus un clic. Assez pour absorber le tremblement d'un
 *  doigt, assez peu pour qu'un vrai glissement soit reconnu tout de suite.
 *
 *  IL VALAIT 6, ET C'ÉTAIT TROP : un étirement raté de quelques pixels retombait dans le cas du
 *  clic, et un clic sur une note l'EFFACE. Mesuré — prendre le bord droit d'une note et bouger de
 *  4px la faisait disparaître. Trois pixels absorbent encore le tremblement du doigt, et la garde
 *  qui suit (`finir`) achève de fermer le piège : sous le seuil, un geste parti d'une POIGNÉE ne
 *  fait plus rien du tout au lieu de supprimer. */
const SEUIL_GESTE = 3;

/** LA POIGNÉE D'ÉTIREMENT, en pixels, aux deux bouts de la NOTE — un quart de sa largeur, borné.
 *
 *  POURQUOI PAS « LA CASE DU BOUT », qui était la règle d'avant. Une case fait 62,8px sur un écran
 *  d'ordinateur : la poignée d'une note de quatre cases valait donc un QUART de la note, et une note
 *  de DEUX cases n'était faite que de poignées — donc impossible à déplacer. Une poignée doit être
 *  une petite zone au bord de l'objet, pas une fraction de l'objet. Mêmes valeurs que HarmoHub, qui
 *  a résolu exactement ce problème (voir SEQ_ZONE_HANDLE_* là-bas). */
const POIGNEE_RATIO = 0.25;
const POIGNEE_MIN = 6;
const POIGNEE_MAX = 18;
/** Sous cette largeur de corps, la note n'a pas de quoi loger trois zones : on n'en garde que deux,
 *  et le CORPS passe devant — condamner une note étroite à ne jamais se déplacer serait pire. */
const CORPS_MIN = 8;

/**
 * Construit la grille et branche les gestes. Rend un objet de commande, pour que l'appelant
 * redessine ou déplace la tête de lecture sans reconstruire tout le DOM.
 *
 * LES GESTES, et ils tiennent en une phrase : on clique une case vide pour poser une note, on
 * clique une note pour l'enlever, on tire ses bords pour l'allonger ou la raccourcir, on tire son
 * corps pour la déplacer dans le temps. Demande de l'utilisateur : « me permettre d'étirer les
 * notes, de les supprimer plus facilement ». Repris du séquenceur de HarmoHub (onSeqPointerDown /
 * beginSeqResize / beginSeqHDrag), mais SANS sa sélection multiple, son changement de voix ni sa
 * duplication : ici une grille n'a qu'une seule ligne, et « une version simplifiée » était la
 * consigne.
 *
 * @param {HTMLElement} hote l'élément qui accueille la grille.
 * @param {object} etat voir model/rythme.js#etatInitial.
 * @param {{surChangement?:Function}} options `surChangement` est appelé après chaque modification.
 */
export function construireGrille(hote, etat, { surChangement } = {}) {
    let geste = null;

    const pile = document.createElement('div');
    pile.className = 'rangees-rythme';
    hote.innerHTML = '';
    hote.appendChild(pile);

    /** La case sous un point, avec sa mesure, sa colonne locale et son index GLOBAL dans la grille
     *  — `null` ailleurs. C'est l'index global qui sert aux gestes, pour qu'une note puisse franchir
     *  la barre (voir model/rythme.js, la couche des courses). */
    const caseAuPoint = (x, y) => {
        const el = document.elementFromPoint(x, y);
        const b = el?.closest?.('[data-colonne]');
        if (!b || !hote.contains(b)) return null;
        const mesure = Number(b.dataset.mesure), colonne = Number(b.dataset.colonne);
        return { mesure, colonne, i: indexDe(etat, mesure, colonne), el: b };
    };

    // -----------------------------------------------------------------------------------------
    // CONSTRUCTION
    // -----------------------------------------------------------------------------------------
    const construireMesure = (m) => {
        const cols = colonnesDeMesure(etat, m);
        const bloc = document.createElement('div');
        bloc.className = 'mesure-seq';
        bloc.dataset.mesure = String(m);
        // Une seule variable pilote toute la géométrie : les cases, la réglette des temps et la
        // pilule partagent le MÊME découpage en colonnes, donc ne peuvent pas se désaligner.
        bloc.style.setProperty('--cases', String(cols.length));

        const num = document.createElement('span');
        num.className = 'num-mesure-seq';
        num.textContent = String(m + 1);
        bloc.appendChild(num);

        const piste = document.createElement('div');
        piste.className = 'piste-seq';

        // LES CASES — le fond, et c'est LUI qui reçoit les clics : la pilule posée par-dessus est
        // transparente aux pointeurs, sans quoi cliquer une note ne toucherait aucune case.
        cols.forEach((c, i) => {
            const b = document.createElement('div');
            b.className = 'case-seq' + (c.iCell === 0 ? ' debut-temps' : '');
            b.dataset.mesure = String(m);
            b.dataset.colonne = String(i);
            b.style.gridColumn = String(i + 1);
            b.setAttribute('role', 'button');
            // UN SEUL TABINDEX À LA FOIS (« roving tabindex », le motif ARIA des grilles). Toutes
            // les cases à 0 obligeraient à passer soixante-quatre fois sur Tab pour sortir de la
            // grille ; toutes à -1, c'est ce qu'il y avait, et l'ARIA mentait alors : `role=button`
            // et `aria-pressed` annonçaient un bouton qu'aucune touche n'atteignait (mesuré —
            // tabIndex valait -1, et Entrée ne faisait rien). Une case est donc dans l'ordre de
            // tabulation, les flèches déplacent le focus, et c'est cette case-là qui le porte.
            b.tabIndex = -1;
            b.setAttribute('aria-label',
                `Mesure ${m + 1}, temps ${Math.floor(i / c.sub) + 1}, case ${c.iCell + 1}`);
            piste.appendChild(b);
        });

        // LA TÊTE DE LECTURE — une colonne entière, masquée tant que rien ne joue. Une colonne
        // plutôt qu'un trait : sur une case déjà colorée, un trait se perd (même raison que
        // .seq-playhead dans HarmoHub).
        const tete = document.createElement('div');
        tete.className = 'tete-seq';
        tete.hidden = true;
        piste.appendChild(tete);
        bloc.appendChild(piste);

        // LES NUMÉROS DE TEMPS, SOUS les cases — demande de l'utilisateur, et ils remplacent
        // l'en-tête cliquable qui compartimentait la grille. Chaque numéro s'étend sur les cases
        // de SON temps, donc se centre naturellement dessus quelle que soit la subdivision.
        const reglette = document.createElement('div');
        reglette.className = 'temps-seq';
        let i = 0, noTemps = 1;
        while (i < cols.length) {
            const sub = cols[i].sub;
            const t = document.createElement('span');
            t.className = 'num-temps';
            t.style.gridColumn = `${i + 1} / span ${sub}`;
            t.textContent = String(noTemps);
            reglette.appendChild(t);
            i += sub;
            noTemps++;
        }
        bloc.appendChild(reglette);
        return bloc;
    };

    const construire = () => {
        pile.innerHTML = '';
        for (let m = 0; m < etat.nMesures; m += MESURES_PAR_RANGEE) {
            const rangee = document.createElement('div');
            rangee.className = 'rangee-rythme';
            for (let k = 0; k < MESURES_PAR_RANGEE && m + k < etat.nMesures; k++) {
                rangee.appendChild(construireMesure(m + k));
            }
            pile.appendChild(rangee);
        }
        rafraichir();
        // La grille vient d'être refaite : le focus baladeur repart de la première case, faute de
        // quoi aucune case ne serait dans l'ordre de tabulation (elles naissent toutes à -1).
        poserFocus(Math.min(focusIndex, casesDuDom().length - 1), false);
    };

    // -----------------------------------------------------------------------------------------
    // RAFRAÎCHISSEMENT — les pilules seules sont refaites ; les cases, jamais.
    //
    // Reconstruire les cases à chaque mouvement de pointeur perdrait la capture en cours et ferait
    // clignoter la grille. Les pilules, elles, sont du pur dessin : les jeter et les redessiner est
    // exactement ce qu'il faut.
    // -----------------------------------------------------------------------------------------
    const rafraichir = () => {
        for (const bloc of pile.querySelectorAll('.mesure-seq')) {
            const m = Number(bloc.dataset.mesure);
            const piste = bloc.querySelector('.piste-seq');
            const courses = coursesDeMesure(etat, m);

            for (const vieille of piste.querySelectorAll('.note-seq')) vieille.remove();
            for (const { debut, fin, attaque, continue: suite } of courses) {
                // « Tenue » dès que la note dure plus d'une case — et un morceau de continuation
                // l'est toujours, puisque la note a commencé avant cette mesure.
                const longue = fin > debut || !attaque || suite;
                const note = document.createElement('div');
                // `sans-debut` / `sans-fin` : le côté coupé par la barre garde un angle DROIT, ce qui
                // se lit comme « ça continue » plutôt que comme deux notes distinctes (voir style.css).
                note.className = 'note-seq' + (longue ? ' tenue' : '')
                    + (attaque ? '' : ' sans-debut') + (suite ? ' sans-fin' : '');
                note.style.gridColumn = `${debut + 1} / span ${fin - debut + 1}`;
                note.dataset.debut = String(debut);
                note.dataset.fin = String(fin);
                // Un bout COUPÉ PAR LA BARRE n'est pas une poignée : la note continue de l'autre
                // côté, il n'y a rien à y étirer (voir zoneDansLaNote).
                note.dataset.attaque = attaque ? '1' : '';
                note.dataset.suite = suite ? '1' : '';
                // `--span` : le nombre de cases couvertes. Le CSS s'en sert pour graduer la pilule,
                // une marque par case, afin que sa durée se COMPTE à travers son remplissage
                // translucide (voir style.css, .note-seq).
                note.style.setProperty('--span', String(fin - debut + 1));
                // REPÈRE D'ATTAQUE : une fine bande plus claire au tout début de la pilule, pour
                // distinguer d'un coup d'œil où la note est PINCÉE de sa partie tenue. Inutile sur
                // une note d'une seule case — il n'y a rien à y distinguer — et FAUX sur un morceau
                // de continuation, où rien n'est pincé.
                if (longue && attaque) {
                    const a = document.createElement('span');
                    a.className = 'attaque-seq';
                    note.appendChild(a);
                }
                piste.appendChild(note);
            }

            // Les cases portent l'état pour le CSS (le curseur d'étirement sur les bords) et pour
            // les lecteurs d'écran.
            for (const b of piste.querySelectorAll('[data-colonne]')) {
                const i = Number(b.dataset.colonne);
                const c = courses.find(x => i >= x.debut && i <= x.fin);
                b.classList.toggle('occupee', !!c);
                // Les poignées d'étirement ne sont posées que sur les VRAIS bouts de la note : un
                // morceau coupé par la barre n'a pas de bord à cet endroit-là, la note continue.
                b.classList.toggle('bord-gauche', !!c && c.attaque && (c.fin > c.debut || c.continue) && i === c.debut);
                b.classList.toggle('bord-droit', !!c && !c.continue && i === c.fin);
                b.setAttribute('aria-pressed', String(!!c));
            }
        }
        // LES PILULES VIENNENT D'ÊTRE REFAITES : le survol se repose dessus, sinon l'éclaircissement
        // et le liseré disparaîtraient à chaque redessin — pendant un étirement, par exemple — alors
        // que le pointeur n'a pas bougé d'un pixel. C'est le même piège que dans HarmoHub, qui
        // rappelle `applySeqHoverHighlight` à la fin de chaque rendu pour la même raison.
        majSurvol();
    };

    // -----------------------------------------------------------------------------------------
    // LA TÊTE DE LECTURE
    // -----------------------------------------------------------------------------------------
    /** Allume la colonne où tombe `position` (en noires depuis le début de la grille), ou éteint
     *  tout si `position` vaut `null`. */
    const poserTete = (position) => {
        const cible = position == null ? null : colonneAuTemps(etat, position);
        for (const bloc of pile.querySelectorAll('.mesure-seq')) {
            const m = Number(bloc.dataset.mesure);
            const tete = bloc.querySelector('.tete-seq');
            if (!tete) continue;
            if (!cible || cible.mesure !== m) { tete.hidden = true; continue; }
            tete.hidden = false;
            tete.style.gridColumn = String(cible.colonne + 1);
        }
    };

    // -----------------------------------------------------------------------------------------
    // OÙ EST LE POINTEUR DANS LA NOTE — les trois zones
    // -----------------------------------------------------------------------------------------

    /** La pilule sous l'abscisse `x` dans cette piste, ou `null`. */
    const piluleAuPoint = (piste, x) => [...piste.querySelectorAll('.note-seq')]
        .find(n => { const r = n.getBoundingClientRect(); return x >= r.left - 1 && x <= r.right + 1; }) || null;

    /**
     * 'debut' | 'fin' | 'corps' — la zone de la note sous l'abscisse `x`.
     *
     * Un bout coupé par la barre de mesure n'est PAS une poignée : la note continue de l'autre côté,
     * et l'étirer par là n'aurait pas de sens. On le rabat donc sur le corps.
     */
    const zoneDansLaNote = (pilule, x) => {
        const r = pilule.getBoundingClientRect();
        const poignee = Math.min(POIGNEE_MAX, Math.max(POIGNEE_MIN, r.width * POIGNEE_RATIO));
        const debutReel = pilule.dataset.attaque === '1';
        const finReelle = pilule.dataset.suite !== '1';
        let zone;
        if (r.width - 2 * poignee < CORPS_MIN) {
            // Trop étroite pour trois zones : le dernier tiers étire, le reste déplace.
            zone = x > r.left + r.width * 0.6 ? 'fin' : 'corps';
        } else if (x < r.left + poignee) zone = 'debut';
        else if (x > r.right - poignee) zone = 'fin';
        else zone = 'corps';
        if (zone === 'debut' && !debutReel) return 'corps';
        if (zone === 'fin' && !finReelle) return 'corps';
        return zone;
    };

    // -----------------------------------------------------------------------------------------
    // LE SURVOL — ce qui rend les gestes DÉCOUVRABLES
    //
    // Le seul signal qu'une note s'étire était le curseur `ew-resize`, posé sur les cases du bout.
    // Il faut donc avoir survolé pile la bonne case pour l'apprendre, et il n'existe pas au doigt.
    // Trois repères le remplacent : la note survolée s'éclaircit (on sait sur LAQUELLE on agit), un
    // liseré clair marque le bord qu'on va tirer (on sait LEQUEL), et le curseur suit la ZONE et non
    // la case (on sait QUEL geste partira d'ici). Repris de HarmoHub, qui avait déjà ces trois-là.
    // -----------------------------------------------------------------------------------------
    let survol = null;   // { x, y } la dernière position connue du pointeur, pour reposer le survol

    const majSurvol = () => {
        for (const n of pile.querySelectorAll('.note-seq')) {
            n.classList.remove('survolee', 'poignee-debut', 'poignee-fin');
        }
        for (const p of pile.querySelectorAll('.piste-seq')) {
            p.classList.remove('curseur-etirer', 'curseur-deplacer');
        }
        if (!survol || geste) return;
        const c = caseAuPoint(survol.x, survol.y);
        if (!c) return;
        const piste = c.el.parentElement;
        const pilule = piluleAuPoint(piste, survol.x);
        if (!pilule) return;
        const zone = zoneDansLaNote(pilule, survol.x);
        pilule.classList.add('survolee');
        if (zone === 'debut') { pilule.classList.add('poignee-debut'); piste.classList.add('curseur-etirer'); }
        else if (zone === 'fin') { pilule.classList.add('poignee-fin'); piste.classList.add('curseur-etirer'); }
        else piste.classList.add('curseur-deplacer');
    };

    hote.addEventListener('pointermove', (ev) => {
        if (geste) return;
        survol = { x: ev.clientX, y: ev.clientY };
        majSurvol();
    });
    hote.addEventListener('pointerleave', () => { survol = null; majSurvol(); });

    // -----------------------------------------------------------------------------------------
    // LE CLAVIER
    //
    // POURQUOI IL EXISTE. Les cases portaient déjà `role="button"`, `aria-label` et `aria-pressed` —
    // toute la promesse d'un bouton — sans qu'aucune touche ne puisse les atteindre. Une promesse
    // d'accessibilité non tenue est pire que pas de promesse : un lecteur d'écran annonce un
    // contrôle, et il ne répond pas.
    //
    // LES TOUCHES, et elles reprennent exactement les quatre gestes de la souris :
    //   ← →            déplacent le focus d'une case, barres de mesure comprises ;
    //   ↑ ↓            sautent d'une mesure, à la même place dedans ;
    //   Espace/Entrée  posent ou enlèvent — le CLIC ;
    //   Maj + ← →      allongent ou raccourcissent la note — l'ÉTIREMENT par le bord droit ;
    //   Suppr          efface la note sous le focus.
    // -----------------------------------------------------------------------------------------
    let focusIndex = 0;

    const casesDuDom = () => [...hote.querySelectorAll('[data-colonne]')];

    /** Porte le focus (et le seul tabindex de la grille) sur la case d'index global `i`. */
    const poserFocus = (i, donnerLeFocus = true) => {
        const cases = casesDuDom();
        if (!cases.length) return;
        focusIndex = Math.max(0, Math.min(cases.length - 1, i));
        cases.forEach((b, k) => { b.tabIndex = k === focusIndex ? 0 : -1; });
        if (donnerLeFocus) cases[focusIndex].focus();
    };

    hote.addEventListener('keydown', (ev) => {
        const cases = casesDuDom();
        if (!cases.length) return;
        const i = cases.indexOf(ev.target.closest?.('[data-colonne]'));
        if (i < 0) return;
        const parMesure = colonnesDeMesure(etat, 0).length || 1;
        const course = courseA(etat, i);
        let traite = true;
        switch (ev.key) {
            case 'ArrowRight':
                if (ev.shiftKey) {
                    // Allonger : la note sous le focus, ou une note neuve d'une case si le focus est
                    // sur du vide — c'est le même geste qu'un glissé vers la droite.
                    if (course) poserCourse(etat, course.debut, Math.min(cases.length - 1, course.fin + 1));
                    else poserCourse(etat, i, i);
                } else poserFocus(i + 1);
                break;
            case 'ArrowLeft':
                if (ev.shiftKey) {
                    // Raccourcir, jamais jusqu'à rien : une note d'une case reste une case, on
                    // l'enlève avec Suppr. Sinon un Maj+← de trop la ferait disparaître sans le dire.
                    if (course && course.fin > course.debut) poserCourse(etat, course.debut, course.fin - 1);
                } else poserFocus(i - 1);
                break;
            case 'ArrowDown': poserFocus(i + parMesure); break;
            case 'ArrowUp': poserFocus(i - parMesure); break;
            case 'Home': poserFocus(i - (i % parMesure)); break;
            case 'End': poserFocus(i - (i % parMesure) + parMesure - 1); break;
            case ' ': case 'Enter':
                if (course) effacerCourse(etat, course.debut); else poserCourse(etat, i, i);
                break;
            case 'Delete': case 'Backspace':
                if (course) effacerCourse(etat, course.debut); else traite = false;
                break;
            default: traite = false;
        }
        if (!traite) return;
        ev.preventDefault();
        rafraichir();
        surChangement?.();
    });

    // -----------------------------------------------------------------------------------------
    // LES GESTES — un seul branchement, par délégation sur l'hôte
    //
    // La grille se reconstruit quand la subdivision ou le nombre de mesures change ; rebrancher
    // chaque case à chaque fois finirait par en oublier une.
    // -----------------------------------------------------------------------------------------
    hote.addEventListener('pointerdown', (ev) => {
        if (ev.button === 2) return;            // le clic droit a son propre traitement, plus bas
        const c = caseAuPoint(ev.clientX, ev.clientY);
        if (!c) return;
        ev.preventDefault();
        const course = courseA(etat, c.i);
        // DEUX RÈGLES ONT PRÉCÉDÉ CELLE-CI, et toutes deux venaient de la même erreur : croire que la
        // zone de préhension est une CASE.
        //
        //   1. La case du bout étirait, les cases du milieu déplaçaient. À 62,8px la case sur un
        //      écran d'ordinateur, la poignée d'une note de quatre cases valait donc un quart de la
        //      note — et une note de DEUX cases n'était faite que de poignées, donc indéplaçable.
        //   2. Pour la note d'UNE case, qui n'avait alors ni corps ni deux bords distincts, un mode
        //      spécial décidait du bord au premier mouvement (« bordSelonLeSens »). Il réparait un
        //      symptôme de la règle 1 et n'a plus de raison d'être.
        //
        // La zone se lit maintenant en PIXELS dans la note : une petite poignée à chaque bout, tout
        // le reste est corps (voir zoneDansLaNote). Une note d'une case s'étire ET se déplace, et
        // l'ancien mode spécial a disparu avec le problème qu'il compensait.
        // QUEL GESTE ? Sur une case vide, on peint. Sur une note, la ZONE sous le pointeur décide :
        // une poignée au bord étire, le corps déplace (voir zoneDansLaNote).
        let mode = 'peindre';
        let zone = null;
        if (course) {
            const pilule = piluleAuPoint(c.el.parentElement, ev.clientX);
            zone = pilule ? zoneDansLaNote(pilule, ev.clientX) : 'corps';
            mode = zone === 'debut' ? 'bordGauche' : zone === 'fin' ? 'bordDroit' : 'deplacer';
        }
        geste = { mode, zone, course, i: c.i, x0: ev.clientX, y0: ev.clientY, bouge: false };
        // Le focus suit le pointeur : reprendre au clavier après un clic repart de là où on a
        // cliqué, et non du début de la grille.
        poserFocus(c.i, false);
        // La capture garde le geste sur cette case même si le doigt sort de la grille. Elle jette
        // quand le pointeur n'est plus actif (il a déjà été relâché, ou l'évènement est synthétique
        // comme dans un banc d'essai) : l'échec est sans conséquence — `geste` est déjà posé et
        // `caseAuPoint` retrouve la case traversée sans elle — mais une exception ici tuerait le
        // reste du gestionnaire.
        try { c.el.setPointerCapture?.(ev.pointerId); } catch (e) { /* pointeur déjà relâché */ }
    });

    hote.addEventListener('pointermove', (ev) => {
        if (!geste) return;
        if (!geste.bouge) {
            if (Math.hypot(ev.clientX - geste.x0, ev.clientY - geste.y0) < SEUIL_GESTE) return;
            geste.bouge = true;
        }
        // `elementFromPoint` plutôt que `ev.target` : avec la capture du pointeur, la cible reste la
        // case de DÉPART pendant tout le glissement — on ne saurait jamais qu'on en a traversé
        // d'autres.
        const c = caseAuPoint(ev.clientX, ev.clientY);
        // LA BARRE DE MESURE NE BLOQUE PLUS RIEN. Une version antérieure ignorait tout geste qui
        // sortait de la mesure de départ, si bien qu'une note LIÉE par-dessus la barre — une
        // écriture ordinaire, et souvent la seule juste — était indessinable (mesuré : un glissé de
        // la colonne 14 vers la colonne 2 de la mesure suivante s'arrêtait à « 15 / span 2 »). Les
        // courses vivent maintenant sur la grille entière, et c'est la conversion qui lie à la barre.
        if (!c || c.i < 0) return;

        if (geste.mode === 'peindre') {
            poserCourse(etat, geste.i, c.i);
        } else if (geste.mode === 'bordDroit') {
            poserCourse(etat, geste.course.debut, Math.max(geste.course.debut, c.i));
        } else if (geste.mode === 'bordGauche') {
            effacerCourse(etat, geste.course.debut);
            poserCourse(etat, Math.min(c.i, geste.course.fin), geste.course.fin);
        } else {
            deplacerCourse(etat, geste.course.debut, c.i - geste.i);
            // La course a bougé : le geste la suit, sinon le mouvement suivant repartirait de
            // l'ancien emplacement et la note ferait des bonds.
            const bougee = courseA(etat, c.i);
            if (bougee) { geste.course = bougee; geste.i = c.i; }
        }
        rafraichir();
        surChangement?.();
    });

    const finir = () => {
        if (!geste) return;
        const g = geste;
        geste = null;
        // UN GESTE QUI N'A PAS BOUGÉ EST UN CLIC : on pose sur une case vide, on enlève sur une
        // note. C'est le même geste au doigt, où l'on remue toujours de deux ou trois pixels sans
        // le vouloir — d'où le seuil plutôt qu'une égalité stricte.
        if (g.bouge) { majSurvol(); return; }
        // MAIS UN GESTE PARTI D'UNE POIGNÉE N'EST JAMAIS UN CLIC, même s'il n'a pas bougé assez.
        // Viser une poignée, c'est vouloir étirer ; effacer la note parce que le doigt n'a pas
        // parcouru trois pixels est le piège exact qui rendait l'étirement « impossible » (mesuré :
        // bord droit + 4px de mouvement, et la note disparaissait). Un étirement raté ne fait donc
        // RIEN, et on recommence. Pour effacer, on clique le CORPS de la note, ou on fait un clic
        // droit — deux chemins qui restent à un seul geste.
        if (g.zone === 'debut' || g.zone === 'fin') return;
        if (g.mode === 'peindre') poserCourse(etat, g.i, g.i);
        else effacerCourse(etat, g.i);
        rafraichir();
        surChangement?.();
    };
    hote.addEventListener('pointerup', finir);
    // `pointercancel` N'EST PAS UN CLIC : c'est ce qu'émet un navigateur quand il confisque le geste
    // (un défilement qui démarre), souvent AVANT le seuil de mouvement — donc avec `bouge` encore
    // faux. Le traiter comme un relâchement poserait une note que personne n'a demandée. C'est
    // exactement le défaut qu'avait la bande de boucle (voir main.js, tâche « pointercancel »).
    hote.addEventListener('pointercancel', () => { geste = null; });

    // LE CLIC DROIT EFFACE, sur ordinateur : un second chemin pour supprimer, celui qu'on essaie
    // spontanément. Sur une case vide il ne fait rien — plutôt que d'ouvrir le menu du navigateur
    // au milieu d'une grille.
    hote.addEventListener('contextmenu', (ev) => {
        const c = caseAuPoint(ev.clientX, ev.clientY);
        if (!c) return;
        ev.preventDefault();
        if (!courseA(etat, c.i)) return;
        effacerCourse(etat, c.i);
        rafraichir();
        surChangement?.();
    });

    construire();
    return { rafraichir, reconstruire: construire, poserTete };
}
