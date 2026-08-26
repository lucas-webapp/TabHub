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

const TITRES_GROUPES = { duree: 'Durée', effet: 'Effets', mesure: 'Mesure', voix: 'Voix' };

// L'ENCRE ET LE PAPIER DE LA PARTITION, PAS UN GRIS SUR FOND SOMBRE. Deux corrections précédentes
// (couleur atténuée, puis épaisseur de trait minimale) n'ont pas suffi : le vrai problème n'était
// pas la finesse du trait mais la TEINTE — une figure de note se lit en noir sur clair depuis que la
// notation existe, et demande un vrai effort de déchiffrage dès qu'elle devient grise sur fond
// sombre, aussi net soit le trait. Ces vignettes portent donc leur propre petit rectangle « papier »
// (même teinte que la feuille de partition), avec l'encre à sa couleur réelle dessus — le bouton
// reste sombre autour, mais la vignette elle-même redevient un vrai bout de partition, lisible d'un
// coup d'œil exactement comme sur la page.
const ENCRE_APERCU = '#1B1A17';
const PAPIER_APERCU = '#FDFBF7';

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
    return `<svg class="figure" viewBox="0 0 17 22" aria-hidden="true">
        <rect x="0.5" y="0.5" width="16" height="21" rx="3" fill="${PAPIER_APERCU}"/>${corps}
    </svg>`;
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
    return `<svg class="icone" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="4" fill="${PAPIER_APERCU}"/>${corps}
    </svg>`;
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

    const selArmure = document.createElement('select');
    selArmure.className = 'champ';
    selArmure.title = 'Armure de la mesure courante';
    selArmure.setAttribute('aria-label', 'Armure');
    gMesure.appendChild(selArmure);
    // Peuplée depuis la table des armures du modèle, pour ne pas réécrire quinze libellés ici.
    import('../model/theory.js').then(({ NOMS_ARMURES }) => {
        for (const a of NOMS_ARMURES) {
            const o = document.createElement('option');
            o.value = String(a.armure);
            o.textContent = `${a.majeur} / ${a.mineur}`;
            selArmure.appendChild(o);
        }
        rafraichir();
    });
    selArmure.addEventListener('change', () => {
        editeur.definirArmure(parseInt(selArmure.value, 10));
        actionsFichier.rendreLeFocus?.();
    });

    aRafraichir.push(() => {
        const sig = editeur.mesureCourante().signature
            || (() => { let i = editeur.curseur.mesure; while (i >= 0 && !editeur.partition.mesures[i].signature) i--; return editeur.partition.mesures[Math.max(0, i)].signature; })();
        if (sig) selSignature.value = `${sig.battements}/${sig.unite}`;
        let i = editeur.curseur.mesure;
        while (i >= 0 && (editeur.partition.mesures[i].armure === null || editeur.partition.mesures[i].armure === undefined)) i--;
        selArmure.value = String(i >= 0 ? editeur.partition.mesures[i].armure : 0);
    });

    const rafraichir = () => { for (const fn of aRafraichir) fn(); };
    rafraichir();
    return rafraichir;
}
