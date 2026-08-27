// Construction de la palette d'outils, à partir de la table des actions.
//
// Aucun bouton n'est écrit dans index.html : ils dérivent tous de edit/raccourcis.js. C'est ce qui
// tient la promesse des « contrôles hybrides » — la palette ne peut pas proposer autre chose que ce
// que fait le clavier, ni annoncer un raccourci périmé, puisqu'elle lit la même ligne de la même table.
//
// CE QU'UN BOUTON MONTRE : jamais une lettre en gras. Chaque action porte un `apercu` qui dit COMMENT
// la représenter — soit le glyphe RÉEL de Bravura qui apparaîtra sur la partition (point, silence,
// accent, chiffre de triolet : voir glypheIconSvg), soit une petite icône de geste (voir ui/icons.js),
// soit un court texte présenté à son poids naturel. C'est ce qui distingue ce jeu de boutons d'un
// simple rang de lettres : chacun montre exactement, ou presque, ce qu'il pose sur la page.

import { ACTIONS, toucheDe } from '../edit/raccourcis.js';
import * as G from '../engine/glyphs.js';
import { icone } from './icons.js';
import { armureEffective, modeEffectif } from '../model/score.js';

const TITRES_GROUPES = { duree: 'Durée', effet: 'Effets', mesure: 'Mesure', voix: 'Voix' };

// UNE ENCRE CLAIRE, SUR LE FOND SOMBRE DU BOUTON — PAS UN PETIT RECTANGLE « PAPIER ». Une version
// précédente reproduisait l'encre noire et le papier clair de la partition à même le bouton, pour
// corriger un problème d'épaisseur de trait ; le remède est allé trop loin dans l'autre sens : des
// vignettes claires posées sur une barre d'outils sombre lisent comme des pavés blancs, en rupture
// avec le reste de la barre. Le trait reste net (l'épaisseur minimale ci-dessous n'a pas bougé), mais
// l'encre est maintenant CLAIRE (la même teinte que le reste des icônes de la barre, `--text-main`)
// directement sur le fond sombre du bouton, sans rectangle intermédiaire.
const ENCRE_APERCU = 'var(--text-main)';

/**
 * Vignette d'une figure de note, dessinée avec les MÊMES glyphes que la partition.
 * Un bouton « croche » qui montre une croche se passe de libellé, et surtout il montre exactement ce
 * qui apparaîtra sur la portée — pas une icône approchante.
 */
function figureSvg(valeur) {
    const S = 5.6;
    const cx = 7.6, cy = 15.4;
    const traits = valeur === 1 ? G.TETE_RONDE : valeur === 2 ? G.TETE_BLANCHE : G.TETE_NOIRE;
    let corps = traits.map(t => `<path d="${t.d}" transform="translate(${cx} ${cy}) scale(${S})" fill="${ENCRE_APERCU}"/>`).join('');
    if (valeur >= 2) {
        const xh = cx + 0.62 * S;
        // ÉPAISSEUR MINIMALE : à l'échelle de la portée, `EPAISSEURS.hampe * S` donne un trait net,
        // mais à celle d'un bouton de 15 px (S = 5,4 au lieu de 8-16), le même calcul tombe sous 1 px
        // — un trait que l'antialiasing efface presque. Une hampe de bouton reste lisible ; le RATIO
        // avec la partition n'a pas à être tenu à ce point.
        const epaisseurHampe = Math.max(G.EPAISSEURS.hampe * S, 1.3);
        corps += `<line x1="${xh}" y1="${cy}" x2="${xh}" y2="3.4" stroke="${ENCRE_APERCU}" stroke-width="${epaisseurHampe}"/>`;
    }
    const n = valeur === 8 ? 1 : valeur === 16 ? 2 : valeur === 32 ? 3 : 0;
    if (n) {
        corps += G.crochet(n).map(t => `<path d="${t.d}" transform="translate(${cx + 0.62 * S} 3.4) scale(${S})" fill="${ENCRE_APERCU}"/>`).join('');
    }
    return `<svg class="figure" viewBox="0 0 17 22" aria-hidden="true">${corps}</svg>`;
}

/**
 * Vignette d'un glyphe QUELCONQUE de Bravura (point, silence, accent, chiffre de n-olet…), centrée
 * et mise à l'échelle d'après sa BOÎTE RÉELLE plutôt qu'un facteur fixe — un point rythmique (0,4
 * interligne) et un soupir (presque 3 interlignes de haut) n'ont pas la même taille naturelle, et un
 * seul facteur pour les deux aurait fait de l'un un point invisible et de l'autre un bloc débordant.
 */
function glypheIconSvg(traits) {
    const b = G.boiteDe(traits);
    const largeur = Math.max(b.droite - b.gauche, 0.15);
    const hauteur = Math.max(b.bas - b.haut, 0.15);
    const cible = 13;   // un peu de marge entre le glyphe et le bord de la puce papier
    const echelle = cible / Math.max(largeur, hauteur);
    const cx = 12 - ((b.gauche + b.droite) / 2) * echelle;
    const cy = 12 - ((b.haut + b.bas) / 2) * echelle;
    const corps = traits.map(t => t.epaisseur == null
        ? `<path d="${t.d}" transform="translate(${cx} ${cy}) scale(${echelle})" fill="${ENCRE_APERCU}"/>`
        : `<path d="${t.d}" transform="translate(${cx} ${cy}) scale(${echelle})" fill="none" stroke="${ENCRE_APERCU}" stroke-width="${Math.max(t.epaisseur * echelle, 1.3)}"/>`
    ).join('');
    return `<svg class="icone" viewBox="0 0 24 24" aria-hidden="true">${corps}</svg>`;
}

/** Construit l'aperçu d'un bouton d'après son descripteur `apercu` (voir edit/raccourcis.js). */
function rendreApercu(action) {
    if (action.figure) return figureSvg(action.figure);
    const a = action.apercu;
    if (!a) return `<span>${action.texte || action.libelle}</span>`;
    switch (a.type) {
        case 'icone': return icone(a.nom);
        case 'glyphe': return glypheIconSvg(G[a.nom]);
        case 'glypheNolet': return glypheIconSvg(G.CHIFFRES_NOLET[a.chiffre]);
        case 'silence': return glypheIconSvg(G.SILENCES[a.valeur] || G.SILENCES[4]);
        // Palm mute s'affiche comme il apparaîtra sur la partition — italique, à son poids naturel —
        // plutôt qu'en texte gras générique : c'est un aperçu fidèle, pas un simple libellé de bouton.
        case 'texteLeger': return `<span class="apercu-texte-leger">${a.texte}</span>`;
        case 'voix': return '<span data-role="voix">Voix</span>';   // rempli dynamiquement, voir aRafraichir
        default: return `<span>${action.texte || action.libelle}</span>`;
    }
}

/**
 * Remplit la barre d'outils et renvoie une fonction de RAFRAÎCHISSEMENT.
 *
 * L'état actif d'un bouton (la croche en cours, le palm mute posé) dépend d'où est le curseur : il ne
 * peut donc pas être figé à la construction. Le rafraîchisseur relit `action.actif(editeur)` à chaque
 * changement — un seul chemin de vérité, celui de l'éditeur, jamais une copie tenue à part. La
 * VISIBILITÉ d'un bouton peut, elle aussi, dépendre du curseur (« + Voix » n'a de sens que tant qu'il
 * n'y en a pas déjà deux) : `action.palette` accepte alors une fonction plutôt qu'un booléen figé.
 */
export function construireBarreOutils(hote, editeur, actionsFichier = {}) {
    hote.innerHTML = '';
    const aRafraichir = [];

    const groupe = (titre) => {
        const el = document.createElement('div');
        el.className = 'groupe-outils';
        if (titre) el.innerHTML = `<span class="etiquette-groupe">${titre}</span>`;
        hote.appendChild(el);
        return el;
    };

    const boutonAction = (parent, action) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn-outil';
        b.dataset.action = action.id;
        const touche = toucheDe(action);
        b.title = action.libelle + (touche ? ` (${touche})` : '');
        b.setAttribute('aria-label', b.title);
        b.innerHTML = rendreApercu(action);
        b.addEventListener('click', () => {
            action.faire(editeur);
            // Une commande refusée (ex. « pas assez de place dans la mesure ») laisse un message
            // dans l'éditeur plutôt que d'agir sur le DOM elle-même — voir Editeur.derniereErreur.
            if (editeur.derniereErreur) { actionsFichier.signalerErreur?.(editeur.derniereErreur); editeur.derniereErreur = null; }
            actionsFichier.rendreLeFocus?.();
        });
        parent.appendChild(b);
        if (action.actif) aRafraichir.push(() => b.classList.toggle('actif', !!action.actif(editeur)));
        // Visibilité dynamique : un bouton dont la pertinence dépend de l'état courant (nombre de
        // voix, par exemple) se cache plutôt que de rester affiché sans effet.
        if (typeof action.palette === 'function') {
            aRafraichir.push(() => { b.hidden = !action.palette(editeur); });
        }
        // « Voix suivante » montre sa DESTINATION plutôt qu'une icône figée : le bouton dit où l'on va,
        // ce qu'aucun pictogramme fixe ne saurait exprimer pour un aller-retour entre deux états.
        if (action.apercu?.type === 'voix') {
            aRafraichir.push(() => {
                const n = editeur.nbVoixMesure();
                if (n <= 1) return;
                const suivante = (editeur.curseur.voix + 1) % n;
                b.querySelector('[data-role="voix"]').textContent = `→ Voix ${suivante + 1}`;
                b.title = `Basculer vers la voix ${suivante + 1} (${suivante === 0 ? 'mélodie' : 'accompagnement'}) — Tab`;
            });
        }
        return b;
    };

    for (const cle of ['duree', 'effet', 'mesure', 'voix']) {
        const g = groupe(TITRES_GROUPES[cle]);
        for (const a of ACTIONS.filter(x => x.groupe === cle && x.palette !== false)) boutonAction(g, a);
    }

    // --- Signature rythmique et armure : des listes plutôt que des boutons ------------------------
    // Ce ne sont pas des bascules mais des CHOIX parmi beaucoup de valeurs ; quinze boutons d'armure
    // rempliraient la barre pour un réglage qu'on touche deux fois par morceau.
    const gMesure = groupe('Écriture');

    const selSignature = document.createElement('select');
    selSignature.className = 'champ';
    selSignature.title = 'Signature rythmique de la mesure courante';
    selSignature.setAttribute('aria-label', 'Signature rythmique');
    for (const [b, u] of [[2,4],[3,4],[4,4],[5,4],[6,4],[3,8],[6,8],[7,8],[9,8],[12,8],[2,2]]) {
        const o = document.createElement('option');
        o.value = `${b}/${u}`; o.textContent = `${b}/${u}`;
        selSignature.appendChild(o);
    }
    selSignature.addEventListener('change', () => {
        const [b, u] = selSignature.value.split('/').map(Number);
        editeur.definirSignature(b, u);
        actionsFichier.rendreLeFocus?.();
    });
    gMesure.appendChild(selSignature);

    // LA TONALITÉ, et non plus « l'armure ». Une version antérieure listait les quinze ARMURES, chacune
    // libellée par sa paire de relatives (« Do M / La m ») : le choix décrivait fidèlement les
    // altérations à la clé, mais ne permettait pas de dire si le morceau était en do majeur ou en la
    // mineur — impossible de trancher (retour utilisateur). Les trente TONALITÉS sont donc listées une
    // à une, en notation internationale (voir theory.js, TONALITES) : choisir « Am » choisit pour de bon.
    const selTonalite = document.createElement('select');
    selTonalite.className = 'champ';
    selTonalite.title = 'Tonalité de la mesure courante (armure + mode)';
    selTonalite.setAttribute('aria-label', 'Tonalité');
    gMesure.appendChild(selTonalite);
    // Peuplée depuis la table du modèle, pour ne pas réécrire trente libellés ici. La valeur encode
    // le COUPLE armure/mode (« -3|mineur ») : les deux sont indissociables, voir definirTonalite.
    import('../model/theory.js').then(({ TONALITES }) => {
        for (const t of TONALITES) {
            const o = document.createElement('option');
            o.value = `${t.armure}|${t.mode}`;
            o.textContent = t.nom;
            selTonalite.appendChild(o);
        }
        rafraichir();
    });
    selTonalite.addEventListener('change', () => {
        const [armure, mode] = selTonalite.value.split('|');
        editeur.definirTonalite(parseInt(armure, 10), mode);
        actionsFichier.rendreLeFocus?.();
    });

    // TRANSPOSER LE MORCEAU ENTIER, demi-ton par demi-ton. Deux boutons plutôt qu'un champ : on
    // transpose en tâtonnant à l'oreille (« encore un demi-ton »), pas en calculant un nombre à
    // l'avance. Chaque appui déplace TOUT — portée, tablature et tonalité — voir transposerMorceau.
    const transposer = (delta, libelle, titre) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn-outil btn-transposer';
        b.dataset.action = 'transposer' + (delta > 0 ? 'Haut' : 'Bas');
        b.textContent = libelle;
        b.title = titre;
        b.setAttribute('aria-label', titre);
        b.addEventListener('click', () => {
            const bilan = editeur.transposerMorceau(delta);
            // Un bilan honnête, y compris quand tout s'est bien passé : une transposition qui déplace
            // des notes sur d'autres cordes change le doigté, et le taire serait une surprise.
            if (editeur.derniereErreur) { actionsFichier.signalerErreur?.(editeur.derniereErreur); editeur.derniereErreur = null; }
            else if (bilan.deplacees) actionsFichier.signalerErreur?.(`Transposé — ${bilan.deplacees} note(s) déplacée(s) sur une autre corde.`);
            actionsFichier.rendreLeFocus?.();
        });
        gMesure.appendChild(b);
    };
    transposer(-1, '♭', 'Transposer tout le morceau d\'un demi-ton vers le BAS');
    transposer(1, '♯', 'Transposer tout le morceau d\'un demi-ton vers le HAUT');

    aRafraichir.push(() => {
        const sig = editeur.mesureCourante().signature
            || (() => { let i = editeur.curseur.mesure; while (i >= 0 && !editeur.partition.mesures[i].signature) i--; return editeur.partition.mesures[Math.max(0, i)].signature; })();
        if (sig) selSignature.value = `${sig.battements}/${sig.unite}`;
        // L'armure ET le mode EN VIGUEUR ici — hérités de la dernière mesure qui les a fixés, chacun
        // par sa propre remontée (voir armureEffective/modeEffectif) : une mesure peut fort bien tenir
        // son armure d'un endroit et son mode d'un autre, si le morceau n'a changé que l'un des deux.
        selTonalite.value = `${armureEffective(editeur.partition, editeur.curseur.mesure)}|${modeEffectif(editeur.partition, editeur.curseur.mesure)}`;
    });

    const rafraichir = () => { for (const fn of aRafraichir) fn(); };
    rafraichir();
    return rafraichir;
}
