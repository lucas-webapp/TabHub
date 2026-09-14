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

const TITRES_GROUPES = { duree: 'Durée', effet: 'Effets', mesure: 'Mesure', repere: 'Repères', voix: 'Voix' };

/** Chevron d'une flèche de défilement — dessiné, pas une police (voir la même logique dans
 *  ui/pave.js pour les flèches de DÉPLACEMENT du curseur, un besoin distinct qui n'a pas à
 *  partager ce petit bout de SVG). Exporté : main.js le reprend tel quel pour la barre de
 *  transport, qui défile pour la même raison que celle-ci — même sens, même dessin. */
export function flecheOutilsSvg(sens) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M${sens === 'gauche' ? '15 6 L9 12 L15 18' : '9 6 L15 12 L9 18'}"
        fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

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
        // Nom d'accord : même principe, à l'inverse — un ESSAI d'icône dessinée (têtes de note
        // empilées) restait illisible à la taille d'un bouton (voir le correctif qui l'a remplacé),
        // alors qu'un exemple de nom, posé GRAS comme il le sera sur la partition, se lit d'un coup
        // d'œil et montre exactement ce que fait le bouton.
        case 'texteGras': return `<span class="apercu-texte-gras">${a.texte}</span>`;
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
/**
 * DEUX FLÈCHES DE DÉFILEMENT, MISES À JOUR SANS SE MORDRE LA QUEUE.
 *
 * Les flèches sont `position: sticky` (voir .fleche-outils dans style.css) : collées au bord VISIBLE
 * du conteneur, mais EN FLUX — chacune de visible ajoute donc ses 26px à `scrollWidth`. Le test naïf
 * « scrollWidth > clientWidth » se mesure alors lui-même, et cela crée un état PIÈGE, observé en
 * élargissant la fenêtre de 900px à 1320px :
 *
 *   1. à 900px, on défile jusqu'au bout : les deux flèches sont visibles, scrollWidth = 1301 + 52 ;
 *   2. la fenêtre passe à 1320px — les 1301px de boutons tiennent désormais entièrement ;
 *   3. mais la flèche gauche, elle, reste visible : ses 26px portent scrollWidth à 1327 pour 1320px
 *      de place, donc « ça déborde de 7px », donc on garde une flèche gauche, donc ça déborde…
 *
 * Un fil qui se tient par ses propres 7px : mesuré immobile une seconde après le redimensionnement,
 * flèche gauche allumée sur RIEN (un chargement direct à 1320px, lui, mesure 1320/1320 et tient).
 *
 * D'où la mesure du débordement RÉEL, flèches déduites (`offsetWidth` valant 0 pour une flèche
 * effacée, la soustraction est juste dans les quatre combinaisons) : s'il n'y a rien à atteindre, on
 * ramène le défilé à zéro et on éteint les deux flèches d'un coup, au lieu de laisser chaque flèche
 * juger de son côté à partir d'une largeur qu'elle gonfle elle-même.
 *
 * Partagé entre la barre d'OUTILS et la barre de TRANSPORT (voir main.js#brancherFlechesTransport) :
 * mêmes flèches, même bogue: c'est la deuxième fois qu'un défaut de ces flèches doit être corrigé en
 * deux endroits, alors cette fois il n'y a plus qu'un endroit.
 */
export function ajusterFleches(conteneur, flecheGauche, flecheDroite) {
    const largeurFleches = flecheGauche.offsetWidth + flecheDroite.offsetWidth;
    if (conteneur.scrollWidth - largeurFleches - conteneur.clientWidth <= 1) {
        if (conteneur.scrollLeft > 0) conteneur.scrollLeft = 0;
        flecheGauche.classList.add('invisible');
        flecheDroite.classList.add('invisible');
        return;
    }
    // Sinon chaque flèche ne se montre que s'il reste vraiment quelque chose à atteindre de son côté.
    // Une marge d'un pixel : les navigateurs arrondissent scrollLeft/scrollWidth différemment, une
    // égalité stricte clignoterait sur certains.
    flecheGauche.classList.toggle('invisible', conteneur.scrollLeft <= 1);
    flecheDroite.classList.toggle('invisible', conteneur.scrollLeft + conteneur.clientWidth >= conteneur.scrollWidth - 1);
}

export function construireBarreOutils(hote, editeur, actionsFichier = {}) {
    hote.innerHTML = '';
    const aRafraichir = [];

    // FLÈCHES DE DÉFILEMENT — la barre déborde largement à droite dès que les groupes Effets/Mesure/
    // Écriture s'ajoutent à Durée (retour utilisateur : « les boutons de la barre d'outils dépassent
    // à droite de l'écran »). `overflow-x: auto` (voir style.css) permet DÉJÀ techniquement d'y
    // accéder, mais rien ne le montre : pas de barre de défilement visible dans la plupart des
    // navigateurs, et à la souris (pas au doigt) rien n'indique qu'on peut glisser cette rangée-là en
    // particulier. Deux boutons COLLÉS aux bords (`position: sticky`, voir style.css) le disent sans
    // ambiguïté, et fonctionnent aussi bien à la souris qu'au doigt — contrairement au glisser, qui
    // reste un geste de souris sur cette barre (voir main.js#demarrerGeste pour la même distinction
    // sur la partition). Cachées d'elles-mêmes quand il n'y a rien à atteindre de ce côté.
    //
    // DEUX RANGÉES INDÉPENDANTES SUR TÉLÉPHONE (retour utilisateur : « la barre d'outils du haut est
    // beaucoup trop large [...] il va falloir faire 2 lignes [...] tu peux conserver un menu qui se
    // déroule horizontalement, c'est juste qu'avant il y avait trop de scroll car trop de boutons »).
    // `creerRangee` fabrique un conteneur qui défile pour SON PROPRE compte — chacun avec sa PAIRE de
    // flèches, jamais une seule paire partagée entre deux lignes (`position: sticky` ne sait coller
    // qu'au bord d'UNE ligne à la fois ; une paire par ligne évite l'ambiguïté plutôt que de la
    // contourner). `flecheDefilement` prend désormais le CONTENEUR en paramètre — plus seulement
    // `hote` en dur — pour être réutilisable ainsi.
    //
    // Sur grand écran, `.rangee-outils`/`.rangee-outils-contenu` s'effacent (`display: contents`, voir
    // style.css) : leurs enfants (groupes + flèches) rejoignent alors `hote` à plat, EXACTEMENT la
    // structure d'avant ce correctif — une seule ligne, défilée par la paire « maîtresse » ci-dessous
    // (les flèches propres à chaque rangée s'effacent alors à leur tour, voir style.css). Rien de
    // deviné au chargement : les deux dispositions existent TOUJOURS dans le DOM, seule la mise en
    // page choisit laquelle compte.
    const PAS_DEFILEMENT = 220;
    const flecheDefilement = (conteneur, sens) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `fleche-outils fleche-outils-${sens}`;
        b.innerHTML = flecheOutilsSvg(sens);
        b.title = sens === 'gauche' ? 'Défiler la barre d\'outils vers la gauche' : 'Défiler la barre d\'outils vers la droite';
        b.setAttribute('aria-label', b.title);
        b.addEventListener('click', () => conteneur.scrollBy({ left: sens === 'gauche' ? -PAS_DEFILEMENT : PAS_DEFILEMENT, behavior: 'smooth' }));
        return b;
    };
    const brancherFleches = (conteneur, flecheGauche, flecheDroite) => {
        const rafraichirFleches = () => ajusterFleches(conteneur, flecheGauche, flecheDroite);
        aRafraichir.push(rafraichirFleches);
        conteneur.addEventListener('scroll', rafraichirFleches, { passive: true });
        // MOLETTE VERTICALE -> DÉFILEMENT HORIZONTAL, ici aussi (voir plus bas pour la raison) : une
        // molette ordinaire ne connaît que le vertical, et rien d'autre que ces flèches ne suggère
        // qu'on peut glisser cette rangée précise à la souris.
        conteneur.addEventListener('wheel', (e) => {
            if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
            conteneur.scrollLeft += e.deltaY;
            e.preventDefault();
        }, { passive: false });
    };

    // La paire « maîtresse » : défile `hote` lui-même — c'est elle qui compte sur grand écran, une
    // fois les deux rangées effacées par `display: contents` (voir plus haut).
    const flecheGaucheMaitresse = flecheDefilement(hote, 'gauche');
    flecheGaucheMaitresse.classList.add('fleche-outils-maitresse');
    hote.appendChild(flecheGaucheMaitresse);

    const creerRangee = (classe) => {
        const rangee = document.createElement('div');
        rangee.className = 'rangee-outils ' + classe;
        hote.appendChild(rangee);
        const contenu = document.createElement('div');
        contenu.className = 'rangee-outils-contenu';
        const flecheGauche = flecheDefilement(contenu, 'gauche');
        const flecheDroite = flecheDefilement(contenu, 'droite');
        rangee.appendChild(flecheGauche);
        rangee.appendChild(contenu);
        rangee.appendChild(flecheDroite);
        brancherFleches(contenu, flecheGauche, flecheDroite);
        return contenu;
    };
    // Construite EN PREMIER dans le DOM bien qu'elle porte la rangée « 2 » sur téléphone (Durée,
    // Effets, Mesure) : c'est la mise en page qui la fait passer en second sur téléphone (voir
    // .rangee-outils-reste dans style.css), pas l'ordre de construction — rien à réordonner ici.
    const rangeeReste = creerRangee('rangee-outils-reste');
    // La rangée « Écriture » (Tonalité, Signature, ♭/♯, Tempo, Métronome) — construite plus bas,
    // une fois son contenu défini (voir gMesure).
    let rangeeEcriture;

    // Le titre du groupe ne s'AFFICHE plus (retour utilisateur : « au lieu d'indiquer chaque section
    // de la barre d'outil, ce qui prend de la place, entourer séparément chaque section avec un trait
    // plus visible » — voir .groupe-outils dans style.css, où le cadre a pris le relais). Il reste
    // produit, pour deux raisons qui n'ont rien à voir avec la place prise à l'écran :
    //   - `role="group"` + `aria-label` : un lecteur d'écran annonce encore « Durée, groupe » avant
    //     d'énumérer les boutons. Un cadre CSS ne s'entend pas ; retirer le titre SANS le remplacer
    //     aurait supprimé l'information pour qui ne voit pas la barre.
    //   - le <span>, masqué mais présent, porte l'intitulé pour les bancs d'essai et reste le seul
    //     endroit où le mot est écrit une fois pour toutes.
    const groupe = (titre, cle, hoteGroupe) => {
        const el = document.createElement('div');
        el.className = 'groupe-outils';
        if (cle) el.dataset.groupe = cle;   // sélecteur CSS/JS stable — voir le popover « Effets » plus bas
        if (titre) {
            el.innerHTML = `<span class="etiquette-groupe">${titre}</span>`;
            el.setAttribute('role', 'group');
            el.setAttribute('aria-label', titre);
        }
        hoteGroupe.appendChild(el);
        return el;
    };

    /**
     * Bouton « Effets » + POPOVER, sur téléphone seulement (voir style.css, @media max-width: 720px) —
     * neuf boutons de geste (hammer-on, pull-off, slide…) touchés une fois de temps en temps pesaient
     * aussi lourd dans la barre que les figures de durée, touchées à chaque note (retour utilisateur :
     * « trop de boutons » sur téléphone). Sur grand écran, la media query ne s'applique pas : le
     * groupe reste affiché en ligne exactement comme avant, ce bouton restant invisible et inerte.
     *
     * MÊME MÉCANISME que le menu contextuel (voir main.js#ouvrirMenuContextuel) : `position: fixed`
     * posé et mesuré au clic (jamais en CSS pur, qui ne sait pas où se trouve LE bouton qui vient d'être
     * touché), fermeture au clic ailleurs ou à Échap — mais gardé ICI, dans le module qui construit déjà
     * ce groupe, plutôt que dupliqué dans main.js qui n'a pas à connaître le détail de la palette.
     */
    let detacherFermetureEffets = null;
    const fermerGroupeEffets = (g, bascule) => {
        g.classList.remove('ouvert');
        bascule.setAttribute('aria-expanded', 'false');
        detacherFermetureEffets?.();
        detacherFermetureEffets = null;
    };
    const basculerGroupeEffets = (bascule, g) => {
        if (g.classList.contains('ouvert')) { fermerGroupeEffets(g, bascule); return; }
        g.classList.add('ouvert');
        bascule.setAttribute('aria-expanded', 'true');
        // Mesuré APRÈS l'ouverture (`.ouvert` pose `position: fixed` en CSS) : un élément encore
        // `display: none` n'a ni largeur ni hauteur à lire.
        const rBouton = bascule.getBoundingClientRect();
        const rGroupe = g.getBoundingClientRect();
        g.style.left = Math.max(4, Math.min(rBouton.left, window.innerWidth - rGroupe.width - 8)) + 'px';
        g.style.top = Math.max(4, Math.min(rBouton.bottom + 4, window.innerHeight - rGroupe.height - 8)) + 'px';
        const surAilleurs = (e) => { if (!g.contains(e.target) && e.target !== bascule) fermerGroupeEffets(g, bascule); };
        const surEchap = (e) => { if (e.key === 'Escape') fermerGroupeEffets(g, bascule); };
        setTimeout(() => {
            document.addEventListener('pointerdown', surAilleurs);
            document.addEventListener('keydown', surEchap);
        }, 0);
        detacherFermetureEffets = () => {
            document.removeEventListener('pointerdown', surAilleurs);
            document.removeEventListener('keydown', surEchap);
        };
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

    // Le groupe « Voix » n'a plus qu'une seule action (basculerVoix, Tab) depuis le retrait de
    // « + Voix »/« − Voix » de la palette (guitare/basse : voir edit/raccourcis.js) — et cette action
    // se cache elle-même tant qu'il n'y a qu'une voix (son `palette`), ce qui est TOUJOURS le cas ici
    // désormais. Un groupe qui ne montrerait jamais rien laisserait une étiquette « Voix » orpheline
    // dans la barre : on ne le construit donc plus du tout. `basculerVoix` reste utilisable au
    // clavier (Tab) pour un fichier déjà à deux voix, simplement sans bouton dans la palette.
    // DEUX GROUPES SE REPLIENT derrière un bouton : « Effets » (neuf gestes) et « Repères » (dix
    // marques de navigation et de barre). Même mécanique pour les deux — d'où ce petit tableau plutôt
    // qu'un `if (cle === 'effet')` doublé le jour où le second est arrivé : deux copies d'un popover
    // finissent toujours par diverger sur un détail (la fermeture après choix, le résumé d'état…).
    // `hote` : DANS QUEL CADRE le bouton replié va vivre (retour utilisateur : « le bouton "Effets"
    // doit être inclus dans l'encadrement d'ajout de notes. Pour le moment il est à part. De la même
    // façon, le bouton "Repères" doit être inclus dans l'encadrement des modifications de la portée
    // et armure »).
    //
    // Les deux boutons vivaient ENTRE les cadres, seuls au milieu — ce qui les faisait lire comme
    // deux outils sans famille, alors que chacun en a une : un effet se pose sur la note qu'on
    // écrit, un repère se pose sur la portée qu'on organise. Depuis que les cadres ont remplacé les
    // titres de section, cette position « entre deux » a cessé d'être neutre : elle dit
    // « n'appartient à rien ».
    //
    // Le POPOVER, lui, ne change pas de place : il est mesuré au clic depuis le bouton (voir
    // basculerGroupeEffets) et se pose en `position: fixed`, donc il s'ouvre là où le bouton se
    // trouve, quel que soit le cadre qui l'héberge.
    const GROUPES_REPLIES = {
        effet: { classe: 'btn-effets-bascule', libelle: 'Effets', hote: 'duree',
                 titre: 'Effets (hammer-on, pull-off, slide, liaison, bend, palm mute, note fantôme, accent, staccato)' },
        repere: { classe: 'btn-reperes-bascule', libelle: 'Repères', hote: 'ecriture',
                  titre: 'Repères et barres (reprises, double barre, barre finale, Segno, Coda, D.C., D.S., al Coda, Fine)' },
    };
    // Les cadres retenus au passage, pour y déposer les boutons repliés une fois tous construits :
    // « Écriture » n'existe que plus bas (il lui faut d'abord son contenu), donc le dépôt ne peut pas
    // se faire dans la boucle.
    const cadres = {};
    const basculesAPlacer = [];
    for (const cle of ['duree', 'effet', 'mesure', 'repere']) {
        const g = groupe(TITRES_GROUPES[cle], cle, rangeeReste);
        cadres[cle] = g;
        const replie = GROUPES_REPLIES[cle];
        if (replie) {
            const bascule = document.createElement('button');
            bascule.type = 'button';
            bascule.className = `btn-outil btn-groupe-replie ${replie.classe}`;
            bascule.textContent = replie.libelle;
            bascule.title = replie.titre;
            bascule.setAttribute('aria-label', bascule.title);
            bascule.setAttribute('aria-haspopup', 'true');
            bascule.setAttribute('aria-expanded', 'false');
            bascule.addEventListener('click', () => basculerGroupeEffets(bascule, g));
            basculesAPlacer.push({ bascule, hote: replie.hote, g });
            // Un choix referme le popover derrière lui — sur un téléphone, revenir le fermer à la main
            // après CHAQUE note serait vite lassant. Écouteur unique sur le groupe (délégation) : il se
            // déclenche après celui, propre à chaque bouton, posé par boutonAction (capture plus
            // profonde d'abord), donc toujours APRÈS que l'action a été exécutée.
            g.addEventListener('click', (e) => { if (e.target.closest('button')) fermerGroupeEffets(g, bascule); });
            for (const a of ACTIONS.filter(x => x.groupe === cle && x.palette !== false)) boutonAction(g, a);
            // Le bouton résume l'état de son groupe replié : un effet déjà posé sur la note courante,
            // une reprise déjà en place sur la mesure, se voient sans avoir à ouvrir le popover pour
            // aller vérifier. Poussé APRÈS la boucle de boutons ci-dessus dans aRafraichir (même passe,
            // donc déjà à jour) — voir boutonAction, qui bascule `.actif` sur chacun d'eux.
            aRafraichir.push(() => { bascule.classList.toggle('actif', !!g.querySelector('.btn-outil.actif')); });
            continue;
        }
        for (const a of ACTIONS.filter(x => x.groupe === cle && x.palette !== false)) boutonAction(g, a);
    }

    // --- Signature rythmique et armure : des listes plutôt que des boutons ------------------------
    // Ce ne sont pas des bascules mais des CHOIX parmi beaucoup de valeurs ; quinze boutons d'armure
    // rempliraient la barre pour un réglage qu'on touche deux fois par morceau.
    // Sa PROPRE rangée (voir creerRangee plus haut) : Tonalité/Signature/Tempo/Métronome d'un côté,
    // Durée/Effets/Mesure de l'autre (retour utilisateur : « la barre d'outils du haut est beaucoup
    // trop large sur téléphone [...] il va falloir faire 2 lignes »).
    rangeeEcriture = creerRangee('rangee-outils-ecriture');
    const gMesure = groupe('Écriture', 'ecriture', rangeeEcriture);
    cadres.ecriture = gMesure;

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

    // --- Tempo et Métronome : remontés depuis la barre de transport (retour utilisateur) -----------
    // TEMPO ET MÉTRONOME NE VIVENT PLUS ICI. Ils y avaient été remontés depuis la barre de transport
    // pour voisiner avec Signature rythmique et Tonalité — les quatre décrivant ensemble « comment ce
    // morceau se joue ». Le classement se défend, mais il séparait ce qu'on touche EN JOUANT de ce
    // qu'on touche EN ÉCRIVANT, et le tempo comme le métronome se règlent en jouant : ils rejoignent
    // Lecture/Stop dans le bloc de lecture (retour utilisateur : « peux-tu me créer un bloc de
    // lecture indépendant qui permet d'intégrer les boutons de lecture / stop, et de gestion du
    // tempo et du métronome ? Pour le moment c'est séparé »). Voir #bloc-lecture dans index.html.
    //
    // Leur balisage repart donc en HTML STATIQUE, d'où il venait : il était fabriqué ici par un
    // <template>, un détour qui n'existait que pour les déplacer sans toucher à main.js (qui les
    // retrouve par leurs id). Plus de déplacement, plus de gabarit.
    // Ce groupe y gagne 160px — mesurés — dans la seule barre de l'application qui manque de place.

    aRafraichir.push(() => {
        const sig = editeur.mesureCourante().signature
            || (() => { let i = editeur.curseur.mesure; while (i >= 0 && !editeur.partition.mesures[i].signature) i--; return editeur.partition.mesures[Math.max(0, i)].signature; })();
        if (sig) selSignature.value = `${sig.battements}/${sig.unite}`;
        // L'armure ET le mode EN VIGUEUR ici — hérités de la dernière mesure qui les a fixés, chacun
        // par sa propre remontée (voir armureEffective/modeEffectif) : une mesure peut fort bien tenir
        // son armure d'un endroit et son mode d'un autre, si le morceau n'a changé que l'un des deux.
        selTonalite.value = `${armureEffective(editeur.partition, editeur.curseur.mesure)}|${modeEffectif(editeur.partition, editeur.curseur.mesure)}`;
    });

    // LES DEUX BOUTONS REPLIÉS REJOIGNENT LEUR CADRE, maintenant que tous existent (voir
    // GROUPES_REPLIES, qui porte le pourquoi). En DERNIER dans leur cadre : « Effets » se lit après
    // les figures de durée, « Repères » après la signature et l'armure — dans les deux cas, le
    // détail après l'essentiel. Le cadre d'accueil est délibérément un AUTRE que le groupe replié
    // lui-même : le bouton vit chez « Durée », le popover qu'il ouvre reste le groupe « effet ».
    for (const { bascule, hote } of basculesAPlacer) {
        (cadres[hote] || rangeeReste).appendChild(bascule);
    }

    // La flèche droite maîtresse ferme la marche, tout à la fin de `hote` — exactement où vivait
    // l'unique paire de flèches avant ce correctif. Chaque flèche ne se montre que s'il reste
    // RÉELLEMENT quelque chose à atteindre de son côté — une flèche « gauche » visible alors qu'on
    // est déjà tout à gauche mentirait sur ce qu'elle fait. Une marge d'un pixel (voir
    // brancherFleches) : les navigateurs arrondissent scrollLeft/scrollWidth différemment, une
    // égalité stricte clignoterait sur certains.
    const flecheDroiteMaitresse = flecheDefilement(hote, 'droite');
    flecheDroiteMaitresse.classList.add('fleche-outils-maitresse');
    hote.appendChild(flecheDroiteMaitresse);
    brancherFleches(hote, flecheGaucheMaitresse, flecheDroiteMaitresse);

    /**
     * UN RAFRAÎCHISSEUR QUI LÈVE N'EMPORTE PAS LES AUTRES.
     *
     * Chaque bouton d'état lit le modèle à sa façon (voir edit/raccourcis.js, les callbacks `actif`) :
     * `ed.evenementCourant().duree.points`, par exemple. `evenementCourant()` rend `undefined` si le
     * curseur pointe hors de sa voix — et une seule lecture sur `undefined` faisait tomber TOUTE la
     * passe, donc toute la barre d'outils : plus un bouton à jour, aucune explication à l'écran, une
     * application qui a l'air gelée.
     *
     * Vu deux fois aujourd'hui, par deux causes différentes (un curseur laissé hors bornes par
     * insererAvant, puis un curseur déplacé à la main depuis un banc d'essai). Les deux causes sont
     * corrigées ; ce filet-ci traite la CONSÉQUENCE, qui était disproportionnée. Signalé en console
     * plutôt qu'avalé : un bouton dont l'état ne suit plus reste un défaut à corriger, simplement
     * pas un défaut qui doit emporter la barre entière avec lui.
     */
    const rafraichir = () => {
        for (const fn of aRafraichir) {
            try { fn(); } catch (err) { console.error('Rafraîchissement d\'un bouton de la palette :', err); }
        }
    };
    rafraichir();
    return rafraichir;
}
