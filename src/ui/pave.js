// Pavé de saisie TACTILE — écrire une tablature au doigt, sans jamais convoquer le clavier du système.
//
// LE PROBLÈME QU'IL RÉSOUT. Toute la saisie de TabHub repose sur le CLAVIER : un chiffre tapé EST une
// case de tablature (voir edit/keyboard.js, règle n°2). Sur un téléphone, ce geste central n'existe
// tout simplement pas — et la parade évidente, poser un champ de saisie pour faire surgir le clavier
// du système, est la pire de toutes : ce clavier mange la moitié de l'écran, recouvre précisément la
// portée qu'on est en train d'écrire, fait sauter la page à chaque ouverture/fermeture, et impose de
// viser des touches minuscules pensées pour du texte, pas pour de la musique.
//
// LA PARADE : L'APPLI FOURNIT SON PROPRE CLAVIER, réduit à ce qu'écrire une tablature demande — les
// dix chiffres de case, quatre flèches, effacer, insérer. Il ne disparaît ni ne réapparaît sous les
// doigts. C'est aussi ce qui garantit que le clavier du système ne surgit JAMAIS pendant l'écriture :
// la zone de partition est un <div> focusable (tabindex), jamais un <input> — un navigateur n'ouvre
// son clavier que pour un vrai champ de texte.
//
// DEUX PIÈCES DISTINCTES, DEPUIS le retour utilisateur « il faut sortir les flèches du pavé
// numérique » : `construirePave` pose les chiffres + Effacer/Insérer dans leur rangée fixe au bas de
// l'écran (comme avant), tandis que `construireDpadFlottant` pose la croix de déplacement à PART,
// flottant par-dessus la partition (voir style.css .dpad-flottant) — semi-translucide plutôt
// qu'opaque, pour ne jamais cacher tout à fait ce qu'il y a dessous. Les deux se cachent ensemble,
// pilotés par la MÊME classe `body.avec-pave` (voir main.js#appliquerPave) : aucun des deux ne doit
// apparaître sans l'autre.
//
// RIEN N'EST RÉINVENTÉ ICI. Les chiffres passent par `saisirChiffre` (donc les cases à deux chiffres
// marchent au doigt exactement comme au clavier, voir DELAI_DEUXIEME_CHIFFRE), et tout le reste est
// pris dans la MÊME table d'actions que le clavier et la barre d'outils (edit/raccourcis.js) : le
// pavé ne peut pas proposer autre chose que ce que fait déjà l'application.

import { ACTIONS } from '../edit/raccourcis.js';

/** Triangle plein d'une direction donnée — dessiné plutôt qu'écrit, pour garder le trait des autres
 *  icônes de l'application (une flèche de police varie d'un appareil à l'autre).
 *  RETOUR UTILISATEUR : « modifier les flèches par des triangles stylés » — l'ancien chevron
 *  (hampe + coude, voir git blame) portait un long trait horizontal qui pesait inutilement dans le
 *  bouton ; un triangle PLEIN va directement à l'essentiel d'une flèche de direction. Les coins
 *  restent ARRONDIS (stroke posé par-dessus le remplissage, `stroke-linejoin: round`) plutôt que
 *  vifs — plus « stylé » qu'un triangle aux angles francs, et cohérent avec les coins arrondis du
 *  reste de l'interface (boutons, cartes). Trait de 2px, comme toutes les icônes de l'appli (voir
 *  ui/icons.js) : seule la forme change, pas l'épaisseur de contour habituelle. */
function flecheSvg(direction) {
    const rotations = { gauche: 180, droite: 0, haut: -90, bas: 90 };
    return `<svg class="icone" viewBox="0 0 24 24" aria-hidden="true">
        <path transform="rotate(${rotations[direction]} 12 12)" d="M7 5 L18 12 L7 19 Z"
              fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    </svg>`;
}

/** Fabrique partagée par `construirePave` ET `construireDpadFlottant` : un bouton qui rejoue une
 *  action de la table (jamais une commande recopiée à la main), relaie une éventuelle erreur et rend
 *  le focus — le même enchaînement que la barre d'outils (voir ui/toolbar.js), pour un seul
 *  comportement à tenir juste plutôt que deux copies qui pourraient diverger. */
function fabriqueBouton(editeur, actions) {
    const bouton = (parent, classe, contenu, titre, faire) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = classe;
        b.innerHTML = contenu;
        b.title = titre;
        b.setAttribute('aria-label', titre);
        b.addEventListener('click', () => {
            faire();
            // Voir Editeur.derniereErreur : l'éditeur ne touche jamais au DOM, c'est l'appelant qui
            // affiche. Identique au clavier et à la barre d'outils.
            if (editeur.derniereErreur) { actions.signalerErreur?.(editeur.derniereErreur); editeur.derniereErreur = null; }
            actions.rendreLeFocus?.();
        });
        parent.appendChild(b);
        return b;
    };
    const boutonAction = (parent, id, contenu, classe = 'btn-pave') => {
        const action = ACTIONS.find(a => a.id === id);
        if (!action) return null;   // filet : une action renommée ne doit pas casser le pavé entier
        return bouton(parent, classe, contenu, action.libelle, () => action.faire(editeur));
    };
    return { bouton, boutonAction };
}

/**
 * @param {HTMLElement} hote      le conteneur du pavé (vidé puis rempli)
 * @param {Editeur} editeur
 * @param {object} actions        crochets partagés avec la barre d'outils : signalerErreur, rendreLeFocus
 * @returns {function} rafraîchisseur, à appeler quand l'état de l'éditeur change
 */
export function construirePave(hote, editeur, actions = {}) {
    hote.innerHTML = '';
    const aRafraichir = [];
    const { bouton, boutonAction } = fabriqueBouton(editeur, actions);

    const rangee = (classe) => {
        const el = document.createElement('div');
        el.className = 'rangee-pave ' + classe;
        hote.appendChild(el);
        return el;
    };

    // --- Rangée 1 : LES CASES, le geste central ---------------------------------------------------
    // Dix chiffres, dans l'ordre : c'est exactement ce que fait la main sur un clavier physique, et
    // taper « 1 » puis « 2 » rapidement donne toujours la case 12 (voir Editeur.saisirChiffre).
    const cases = rangee('rangee-cases');
    for (let n = 0; n <= 9; n++) {
        bouton(cases, 'btn-pave btn-case', String(n), `Case ${n} (deux chiffres à la suite pour 10-24)`,
            () => editeur.saisirChiffre(n));
    }

    // --- Rangée 2 : CORRIGER (se déplacer vit maintenant à part, voir construireDpadFlottant) ------
    const gestes = rangee('rangee-gestes');

    boutonAction(gestes, 'supprimer', 'Effacer', 'btn-pave btn-pave-large');
    boutonAction(gestes, 'inserer', 'Insérer', 'btn-pave btn-pave-large');

    // La position courante, en toutes lettres : sur téléphone, la barre d'état du bas (#info-position)
    // n'a plus la place de s'afficher, et savoir SUR QUELLE CORDE on écrit est indispensable — c'est
    // ce que les flèches haut/bas (désormais flottantes, voir plus bas) viennent de changer, sans
    // quoi elles agiraient à l'aveugle.
    const etat = document.createElement('span');
    etat.className = 'etat-pave';
    gestes.appendChild(etat);
    aRafraichir.push(() => {
        const c = editeur.curseur;
        // « Corde 1 » est la plus AIGUË pour un guitariste — l'index 0 du modèle. MÊME convention que
        // la barre d'état (voir main.js, numeroCorde), pour ne pas compter à l'envers d'un endroit
        // à l'autre de la même application.
        let texte = `M${c.mesure + 1} · corde ${c.corde + 1}`;
        // LA CASE VENANT D'ÊTRE POSÉE, EN TOUTES LETTRES — sans ça, taper « 1 » puis « 2 » pour
        // atteindre la case 12 (voir Editeur.saisirChiffre) ne se voit NULLE PART au doigt : le
        // `title` qui l'explique sur chaque bouton ne s'affiche qu'au survol, un geste qui n'existe
        // pas au doigt (retour utilisateur : « je ne peux pas aller au-dessus de 9 »). Ce repère se
        // met à jour après CHAQUE chiffre tapé (voir main.js#dessiner, qui rafraîchit le pavé à
        // chaque saisie) : on voit donc littéralement « case 1 » devenir « case 12 » au second tap,
        // la preuve que ça a marché plutôt qu'un plafond supposé à 9.
        const evenement = editeur.partition.mesures[c.mesure]?.voix[c.voix]?.evenements[c.evenement];
        const note = evenement?.notes.find(n => n.corde === c.corde);
        if (note) texte += ` · case ${note.frette}`;
        etat.textContent = texte;
    });

    const rafraichir = () => { for (const fn of aRafraichir) fn(); };
    rafraichir();
    return rafraichir;
}

/**
 * La croix de déplacement (haut/gauche/droite/bas), flottant par-dessus la partition plutôt que
 * couchée dans le pavé numérique (retour utilisateur : « il faut sortir les flèches du pavé
 * numérique avec les chiffres [...] décaler les flèches au-dessus, avec un fond semi-translucide »).
 * Rendait `.pave-tactile` bien plus haut qu'une simple rangée de chiffres — direz autant de partition
 * visible perdue en permanence, même quand on ne fait que lire. Ici, la croix ne coûte plus RIEN à la
 * mise en page (elle ne réserve aucune rangée de la grille, voir style.css .dpad-flottant : position
 * absolute par-dessus .zone-partition) et ne cache la portée dessous qu'à demi, jamais tout à fait.
 *
 * Même croix, mêmes actions — SEUL l'endroit où elle vit change, pas ce qu'elle fait (voir
 * .dpad-flottant dans style.css pour sa taille et son fond, resserrés depuis, et flecheSvg ci-dessus
 * pour la forme de ses flèches, elle aussi retouchée depuis).
 *
 * @param {HTMLElement} hote      le conteneur (vidé puis rempli), voir #dpad-flottant dans index.html
 * @param {Editeur} editeur
 * @param {object} actions        mêmes crochets que construirePave (signalerErreur, rendreLeFocus)
 */
export function construireDpadFlottant(hote, editeur, actions = {}) {
    hote.innerHTML = '';
    const { boutonAction } = fabriqueBouton(editeur, actions);

    // Croix façon manette de jeu (retour utilisateur : « que ça ressemble à une navigation sur
    // console [...] les flèches dans un sens logique ») — HAUT au-dessus, BAS en dessous, GAUCHE et
    // DROITE de part et d'autre, plutôt que les quatre alignées côte à côte dans un ordre qu'aucune
    // manette ne connaît. Une grille CSS 3×3 (voir .dpad-pave) : seules les quatre cases cardinales
    // portent un bouton, placé par grid-column/grid-row — les coins et le centre restent vides sans
    // qu'il faille le moindre élément de remplissage pour ça.
    boutonAction(hote, 'haut', flecheSvg('haut'), 'btn-pave dpad-haut');
    boutonAction(hote, 'gauche', flecheSvg('gauche'), 'btn-pave dpad-gauche');
    boutonAction(hote, 'droite', flecheSvg('droite'), 'btn-pave dpad-droite');
    boutonAction(hote, 'bas', flecheSvg('bas'), 'btn-pave dpad-bas');
}
