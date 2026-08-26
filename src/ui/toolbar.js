// Construction de la palette d'outils, à partir de la table des actions.
//
// Aucun bouton n'est écrit dans index.html : ils dérivent tous de edit/raccourcis.js. C'est ce qui
// tient la promesse des « contrôles hybrides » — la palette ne peut pas proposer autre chose que ce
// que fait le clavier, ni annoncer un raccourci périmé, puisqu'elle lit la même ligne de la même table.

import { ACTIONS, toucheDe } from '../edit/raccourcis.js';
import * as G from '../engine/glyphs.js';

const TITRES_GROUPES = { duree: 'Durée', effet: 'Effets', mesure: 'Mesure' };

/**
 * Vignette d'une figure de note, dessinée avec les MÊMES glyphes que la partition.
 * Un bouton « croche » qui montre une croche se passe de libellé, et surtout il montre exactement ce
 * qui apparaîtra sur la portée — pas une icône approchante.
 */
function figureSvg(valeur) {
    const S = 5.4;
    const cx = 7, cy = 16;
    const traits = valeur === 1 ? G.TETE_RONDE : valeur === 2 ? G.TETE_BLANCHE : G.TETE_NOIRE;
    let corps = traits.map(t => `<path d="${t.d}" transform="translate(${cx} ${cy}) scale(${S})" fill="currentColor"/>`).join('');
    if (valeur >= 2) {
        const xh = cx + 0.62 * S;
        corps += `<line x1="${xh}" y1="${cy}" x2="${xh}" y2="3" stroke="currentColor" stroke-width="${G.EPAISSEURS.hampe * S}"/>`;
    }
    const n = valeur === 8 ? 1 : valeur === 16 ? 2 : valeur === 32 ? 3 : 0;
    if (n) {
        corps += G.crochet(n).map(t => `<path d="${t.d}" transform="translate(${cx + 0.62 * S} 3) scale(${S})" fill="currentColor"/>`).join('');
    }
    return `<svg class="figure" viewBox="0 0 15 22" aria-hidden="true">${corps}</svg>`;
}

/**
 * Remplit la barre d'outils et renvoie une fonction de RAFRAÎCHISSEMENT.
 *
 * L'état actif d'un bouton (la croche en cours, le palm mute posé) dépend d'où est le curseur : il ne
 * peut donc pas être figé à la construction. Le rafraîchisseur relit `action.actif(editeur)` à chaque
 * changement — un seul chemin de vérité, celui de l'éditeur, jamais une copie tenue à part.
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
        b.innerHTML = action.figure ? figureSvg(action.figure) : `<span>${action.texte || action.libelle}</span>`;
        b.addEventListener('click', () => {
            action.faire(editeur);
            actionsFichier.rendreLeFocus?.();
        });
        parent.appendChild(b);
        if (action.actif) aRafraichir.push(() => b.classList.toggle('actif', !!action.actif(editeur)));
        return b;
    };

    for (const cle of ['duree', 'effet', 'mesure']) {
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
