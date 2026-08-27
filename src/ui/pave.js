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
// dix chiffres de case, quatre flèches, effacer, insérer. Il tient en deux rangées au bas de l'écran,
// ne recouvre jamais la partition (il occupe sa propre rangée de la grille, voir style.css), et ne
// disparaît ni ne réapparaît sous les doigts. C'est aussi ce qui garantit que le clavier du système
// ne surgit JAMAIS pendant l'écriture : la zone de partition est un <div> focusable (tabindex), jamais
// un <input> — un navigateur n'ouvre son clavier que pour un vrai champ de texte.
//
// RIEN N'EST RÉINVENTÉ ICI. Les chiffres passent par `saisirChiffre` (donc les cases à deux chiffres
// marchent au doigt exactement comme au clavier, voir DELAI_DEUXIEME_CHIFFRE), et tout le reste est
// pris dans la MÊME table d'actions que le clavier et la barre d'outils (edit/raccourcis.js) : le
// pavé ne peut pas proposer autre chose que ce que fait déjà l'application.

import { ACTIONS } from '../edit/raccourcis.js';

/** Chevron/flèche d'une direction donnée — dessiné plutôt qu'écrit, pour garder le trait des autres
 *  icônes de l'application (une flèche de police varie d'un appareil à l'autre). */
function flecheSvg(direction) {
    const rotations = { gauche: 180, droite: 0, haut: -90, bas: 90 };
    return `<svg class="icone" viewBox="0 0 24 24" aria-hidden="true">
        <g transform="rotate(${rotations[direction]} 12 12)">
            <path d="M4 12 h13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M12 6 l6 6 l-6 6" fill="none" stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round"/>
        </g>
    </svg>`;
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

    const rangee = (classe) => {
        const el = document.createElement('div');
        el.className = 'rangee-pave ' + classe;
        hote.appendChild(el);
        return el;
    };

    /** Tout bouton du pavé finit ici : exécute, relaie une éventuelle erreur, rend le focus. Le même
     *  enchaînement que la barre d'outils (voir ui/toolbar.js) — un seul comportement à tenir juste. */
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

    /** Un bouton qui rejoue une action de la table — jamais une commande recopiée à la main ici. */
    const boutonAction = (parent, id, contenu, classe = 'btn-pave') => {
        const action = ACTIONS.find(a => a.id === id);
        if (!action) return null;   // filet : une action renommée ne doit pas casser le pavé entier
        return bouton(parent, classe, contenu, action.libelle, () => action.faire(editeur));
    };

    // --- Rangée 1 : LES CASES, le geste central ---------------------------------------------------
    // Dix chiffres, dans l'ordre : c'est exactement ce que fait la main sur un clavier physique, et
    // taper « 1 » puis « 2 » rapidement donne toujours la case 12 (voir Editeur.saisirChiffre).
    const cases = rangee('rangee-cases');
    for (let n = 0; n <= 9; n++) {
        bouton(cases, 'btn-pave btn-case', String(n), `Case ${n} (deux chiffres à la suite pour 10-24)`,
            () => editeur.saisirChiffre(n));
    }

    // --- Rangée 2 : SE DÉPLACER ET CORRIGER --------------------------------------------------------
    const gestes = rangee('rangee-gestes');
    boutonAction(gestes, 'gauche', flecheSvg('gauche'));
    boutonAction(gestes, 'haut', flecheSvg('haut'));
    boutonAction(gestes, 'bas', flecheSvg('bas'));
    boutonAction(gestes, 'droite', flecheSvg('droite'));

    // Un séparateur : à gauche on se déplace, à droite on modifie. Deux familles de gestes que le
    // pouce ne doit pas confondre en visant vite.
    const sep = document.createElement('span');
    sep.className = 'separateur-pave';
    gestes.appendChild(sep);

    boutonAction(gestes, 'supprimer', 'Effacer', 'btn-pave btn-pave-large');
    boutonAction(gestes, 'inserer', 'Insérer', 'btn-pave btn-pave-large');

    // La position courante, en toutes lettres : sur téléphone, la barre d'état du bas (#info-position)
    // n'a plus la place de s'afficher, et savoir SUR QUELLE CORDE on écrit est indispensable — c'est
    // ce que les flèches haut/bas viennent de changer, sans quoi elles agiraient à l'aveugle.
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
