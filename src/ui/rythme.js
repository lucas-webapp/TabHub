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
//     un « 4 » énigmatique au-dessus de chaque temps (voir model/rythme.js#SUBDIVISIONS, qui
//     raconte pourquoi le « 2 » a disparu).
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
         effacerCourse, deplacerCourse, colonneAuTemps } from '../model/rythme.js';

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
 *  doigt, assez peu pour qu'un vrai glissement soit reconnu tout de suite. */
const SEUIL_GESTE = 6;

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

    /** La case sous un point, avec sa mesure et sa colonne — `null` ailleurs. */
    const caseAuPoint = (x, y) => {
        const el = document.elementFromPoint(x, y);
        const b = el?.closest?.('[data-colonne]');
        if (!b || !hote.contains(b)) return null;
        return { mesure: Number(b.dataset.mesure), colonne: Number(b.dataset.colonne), el: b };
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
            for (const { debut, fin } of courses) {
                const longue = fin > debut;
                const note = document.createElement('div');
                note.className = 'note-seq' + (longue ? ' tenue' : '');
                note.style.gridColumn = `${debut + 1} / span ${fin - debut + 1}`;
                note.dataset.debut = String(debut);
                note.dataset.fin = String(fin);
                // REPÈRE D'ATTAQUE : une fine bande plus claire au tout début de la pilule, pour
                // distinguer d'un coup d'œil où la note est PINCÉE de sa partie tenue. Inutile sur
                // une note d'une seule case — il n'y a rien à y distinguer.
                if (longue) {
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
                b.classList.toggle('bord-gauche', !!c && c.fin > c.debut && i === c.debut);
                b.classList.toggle('bord-droit', !!c && i === c.fin);
                b.setAttribute('aria-pressed', String(!!c));
            }
        }
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
        const course = courseA(etat, c.mesure, c.colonne);
        // QUEL GESTE ? Sur une case vide, on peint. Sur une note, le BORD étire et le CORPS déplace.
        //
        // LE CAS DE LA NOTE D'UNE SEULE CASE, qui n'a ni corps ni deux bords distincts. Une première
        // version lui donnait d'office son « bord droit », au motif que l'allonger est le geste qu'on
        // vient chercher — mais glisser une telle note vers la GAUCHE l'allongeait alors vers la
        // droite, ce qui se lit comme un défaut (mesuré en la déplaçant de deux cases : elle
        // s'étirait au lieu de bouger). Elle prend donc son bord DANS LE SENS DU GESTE, décidé au
        // premier vrai mouvement : on la tire à droite, elle grandit à droite ; on la tire à gauche,
        // elle grandit à gauche. Aucune surprise dans les deux cas.
        //
        // CE QU'ON NE PEUT PAS FAIRE, et c'est assumé : DÉPLACER une note d'une seule case, faute de
        // corps à saisir. Un clic l'enlève et un clic la repose ailleurs — deux clics, contre un
        // glissement qui aurait fatalement été ambigu avec l'étirement.
        let mode = 'peindre';
        if (course) {
            const seule = course.fin === course.debut;
            if (seule) mode = 'bordSelonLeSens';
            else if (c.colonne === course.debut) mode = 'bordGauche';
            else if (c.colonne === course.fin) mode = 'bordDroit';
            else mode = 'deplacer';
        }
        geste = { mode, course, mesure: c.mesure, colonne: c.colonne,
                  x0: ev.clientX, y0: ev.clientY, bouge: false };
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
            // Le sens ne se décide qu'ICI, au premier vrai mouvement : au `pointerdown` il n'existe
            // pas encore. Une fois choisi il ne change plus, sinon la note rebondirait d'un bord à
            // l'autre en revenant sur ses pas.
            if (geste.mode === 'bordSelonLeSens') {
                geste.mode = ev.clientX < geste.x0 ? 'bordGauche' : 'bordDroit';
            }
        }
        // `elementFromPoint` plutôt que `ev.target` : avec la capture du pointeur, la cible reste la
        // case de DÉPART pendant tout le glissement — on ne saurait jamais qu'on en a traversé
        // d'autres.
        const c = caseAuPoint(ev.clientX, ev.clientY);
        // ON RESTE DANS SA MESURE. Une note appartient à une mesure : la laisser glisser dans la
        // suivante demanderait de décider ce qu'elle devient à cheval sur la barre, et toute réponse
        // serait une surprise. Un geste qui sort est ignoré, la note reste où elle est.
        if (!c || c.mesure !== geste.mesure) return;

        if (geste.mode === 'peindre') {
            poserCourse(etat, geste.mesure, geste.colonne, c.colonne);
        } else if (geste.mode === 'bordDroit') {
            poserCourse(etat, geste.mesure, geste.course.debut, Math.max(geste.course.debut, c.colonne));
        } else if (geste.mode === 'bordGauche') {
            effacerCourse(etat, geste.mesure, geste.course.debut);
            poserCourse(etat, geste.mesure, Math.min(c.colonne, geste.course.fin), geste.course.fin);
        } else {
            deplacerCourse(etat, geste.mesure, geste.course.debut, c.colonne - geste.colonne);
            // La course a bougé : le geste la suit, sinon le mouvement suivant repartirait de
            // l'ancien emplacement et la note ferait des bonds.
            const bougee = courseA(etat, geste.mesure, c.colonne);
            if (bougee) { geste.course = bougee; geste.colonne = c.colonne; }
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
        if (g.bouge) return;
        if (g.mode === 'peindre') poserCourse(etat, g.mesure, g.colonne, g.colonne);
        else effacerCourse(etat, g.mesure, g.colonne);
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
        if (!courseA(etat, c.mesure, c.colonne)) return;
        effacerCourse(etat, c.mesure, c.colonne);
        rafraichir();
        surChangement?.();
    });

    construire();
    return { rafraichir, reconstruire: construire, poserTete };
}
