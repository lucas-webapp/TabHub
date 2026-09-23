// TABLE UNIQUE DES ACTIONS : clavier et palette y puisent tous les deux.
//
// POURQUOI UNE SEULE TABLE. La consigne était d'avoir des contrôles hybrides — saisie ultra-rapide au
// clavier ET palette cliquable. Le piège classique est d'écrire deux fois la même liste : le clavier
// dans un `switch` d'évènements, la palette dans du HTML. Les deux divergent au premier ajout, et
// l'infobulle d'un bouton finit par annoncer un raccourci qui ne fait plus rien.
//
// Ici chaque action est déclarée UNE fois, avec sa touche, son libellé et ce qu'elle fait. Le clavier
// indexe la table par touche ; la palette la parcourt pour fabriquer ses boutons et leurs infobulles.
// Ajouter une action, c'est ajouter une ligne — elle apparaît des deux côtés, forcément d'accord.

import { VALEURS_FIGURES } from '../model/duration.js';
import { REPERES } from '../model/score.js';

/**
 * Décrit une combinaison de touches sous forme canonique : « ctrl+shift+arrowleft ».
 * Normaliser des deux côtés (déclaration et évènement) évite les comparaisons approximatives qui
 * marchent sur un clavier et pas sur un autre.
 */
export function signatureTouche(e) {
    const parties = [];
    if (e.ctrlKey || e.metaKey) parties.push('ctrl');
    if (e.altKey) parties.push('alt');
    if (e.shiftKey) parties.push('shift');
    let k = e.key;
    if (k === ' ') k = 'space';
    parties.push(String(k).toLowerCase());
    return parties.join('+');
}

/** Libellé affichable d'une combinaison, pour les infobulles et l'aide-mémoire. */
export function libelleTouche(sig) {
    const jolis = {
        arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓',
        space: 'Espace', escape: 'Échap', enter: 'Entrée', backspace: '⌫', delete: 'Suppr',
        home: 'Origine', end: 'Fin', ctrl: 'Ctrl', alt: 'Alt', shift: 'Maj',
    };
    return sig.split('+').map(p => jolis[p] || (p.length === 1 ? p.toUpperCase() : p)).join('+');
}

const D = (valeur) => ({ valeur, points: 0, nolet: null });

/**
 * Les actions. `groupe` sert à la palette (un cadre par groupe), `palette: false` réserve l'action au
 * clavier — la navigation n'a pas besoin de boutons, elle en aurait vingt.
 */
export const ACTIONS = [
    // --- Navigation (clavier seulement) ---------------------------------------------------------
    { id: 'gauche', touches: ['arrowleft'], libelle: 'Évènement précédent', palette: false, faire: ed => ed.deplacerEvenement(-1) },
    { id: 'droite', touches: ['arrowright'], libelle: 'Évènement suivant', palette: false, faire: ed => ed.deplacerEvenement(1) },
    { id: 'haut', touches: ['arrowup'], libelle: 'Corde plus aiguë', palette: false, faire: ed => ed.deplacerCorde(-1) },
    { id: 'bas', touches: ['arrowdown'], libelle: 'Corde plus grave', palette: false, faire: ed => ed.deplacerCorde(1) },
    { id: 'mesurePrec', touches: ['ctrl+arrowleft'], libelle: 'Mesure précédente', palette: false, faire: ed => ed.allerAMesure(ed.curseur.mesure - 1) },
    { id: 'mesureSuiv', touches: ['ctrl+arrowright'], libelle: 'Mesure suivante', palette: false, faire: ed => ed.allerAMesure(ed.curseur.mesure + 1) },
    { id: 'debutMesure', touches: ['home'], libelle: 'Début de la mesure', palette: false, faire: ed => ed.allerAMesure(ed.curseur.mesure, 0) },
    { id: 'finMesure', touches: ['end'], libelle: 'Fin de la mesure', palette: false, faire: ed => ed.allerAMesure(ed.curseur.mesure, -1) },
    { id: 'debut', touches: ['ctrl+home'], libelle: 'Début du morceau', palette: false, faire: ed => ed.allerAMesure(0, 0) },
    { id: 'fin', touches: ['ctrl+end'], libelle: 'Fin du morceau', palette: false, faire: ed => ed.allerAMesure(ed.partition.mesures.length - 1, -1) },

    // --- Saisie (clavier seulement : les chiffres SONT la saisie) --------------------------------
    { id: 'effacer', touches: ['backspace'], libelle: 'Effacer la note', palette: false, faire: ed => ed.effacerOuReculer() },
    { id: 'supprimer', touches: ['delete'], libelle: 'Effacer la note', palette: false, faire: ed => ed.effacerNote() },
    { id: 'inserer', touches: ['enter', 'insert'], libelle: 'Insérer un évènement', palette: false, faire: ed => ed.insererEvenement() },
    // LA PROCHAINE CASE À REMPLIR d'un rythme inséré (voir commands.js#allerCaseSuivanteARemplir et
    // ui/rythme.js). Tabulation : la touche du « champ suivant » dans tous les formulaires, et c'est
    // exactement ce qu'on fait — parcourir des cases en attente d'une valeur. Sans elle, remplir
    // quatre mesures voudrait dire viser chaque case à la souris.
    { id: 'caseARemplir', touches: ['tab'], libelle: 'Aller à la prochaine case à remplir', palette: false,
      faire: ed => ed.allerCaseSuivanteARemplir() },
    { id: 'supprEvenement', touches: ['ctrl+delete'], libelle: 'Supprimer et décaler ce qui suit (garde la mesure à sa capacité)', palette: false, faire: ed => ed.supprimerEvenement() },
    { id: 'transposeHaut', touches: ['ctrl+arrowup'], libelle: 'Case +1', palette: false, faire: ed => ed.transposerNote(1) },
    { id: 'transposeBas', touches: ['ctrl+arrowdown'], libelle: 'Case −1', palette: false, faire: ed => ed.transposerNote(-1) },

    // --- Durées (palette : groupe « Durée ») -----------------------------------------------------
    ...VALEURS_FIGURES.map((valeur, i) => ({
        id: 'duree' + valeur,
        touches: i === 0 ? [] : [],
        libelle: ['Ronde', 'Blanche', 'Noire', 'Croche', 'Double-croche', 'Triple-croche'][i],
        groupe: 'duree', figure: valeur,
        actif: ed => ed.dureeCourante.valeur === valeur,
        faire: ed => ed.appliquerDuree(valeur),
    })),
    { id: 'plusLong', touches: ['+', '='], libelle: 'Durée plus longue', palette: false, faire: ed => changerFigure(ed, -1) },
    { id: 'plusCourt', touches: ['-'], libelle: 'Durée plus courte', palette: false, faire: ed => changerFigure(ed, 1) },
    // `apercu` décrit comment la PALETTE représente l'action — jamais une lettre en gras, toujours
    // soit le glyphe RÉEL de Bravura qui apparaîtra sur la partition (point, silence, accent, note
    // fantôme, chiffre de triolet — voir ui/toolbar.js), soit une petite icône de geste dessinée pour
    // l'occasion (hammer-on, pull-off, slide, liaison, bend, reprises — voir ui/icons.js). Ce module
    // ne connaît lui-même ni glyphs.js ni icons.js : il ne fait que NOMMER la présentation, le rendu
    // reste entièrement du ressort de la couche ui/.
    { id: 'point', touches: ['.'], libelle: 'Note pointée', groupe: 'duree', apercu: { type: 'glyphe', nom: 'POINT' },
      actif: ed => !!ed.evenementCourant().duree.points, faire: ed => ed.basculerPoint() },
    { id: 'triolet', touches: ['alt+3'], libelle: 'Triolet', groupe: 'duree', apercu: { type: 'glypheNolet', chiffre: 3 },
      actif: ed => !!ed.evenementCourant().duree.nolet, faire: ed => ed.basculerTriolet() },
    { id: 'silence', touches: ['r'], libelle: 'Silence', groupe: 'duree', apercu: { type: 'silence', valeur: 4 },
      actif: ed => ed.evenementCourant().silence, faire: ed => ed.basculerSilence() },
    // L'AIDE RYTHMIQUE, DANS LE CADRE « DURÉE » et pas ailleurs (retour utilisateur : « je ne vois pas
    // le bouton de séquenceur pour indiquer le rythme, peux-tu me dire où il est ? » — il n'existait
    // QUE dans le menu contextuel du clic droit, donc nulle part sur téléphone, et introuvable
    // ailleurs). Sa place est ici : ce cadre répond à la question « quelle durée ? », et l'aide est
    // exactement ce qu'on ouvre quand on ne sait pas y répondre. Juste après le silence, avant
    // « Effets » — le dernier recours des figures, avant qu'on passe aux nuances de jeu.
    //
    // ELLE OUVRE UNE FENÊTRE, donc elle passe par les crochets de l'interface (`ui`) comme
    // l'annotation et le nom d'accord plus bas : la table des actions ne connaît pas le DOM.
    //
    // ICÔNE **ET** MOT. Un premier essai n'avait que l'icône (quatre cases, une sur deux allumée) :
    // repérable, mais pas devinable — or c'est précisément « je ne le trouve pas » qu'on corrige ici,
    // et ce projet a déjà dû revenir deux fois sur des pictogrammes qu'il fallait apprendre. Le mot
    // tranche, le dessin fait la cible. « Effets », juste à côté, est déjà un bouton-mot : ce n'est
    // pas une exception dans ce cadre.
    { id: 'aideRythme', touches: [], libelle: 'Aide rythmique — poser un rythme dans une grille, sur 1 à 4 mesures',
      groupe: 'duree', apercu: { type: 'iconeEtTexte', nom: 'grilleRythme', texte: 'Rythme' },
      faire: (ed, ui) => { ui?.ouvrirAideRythme?.(ed.curseur.mesure); } },

    // --- Effets (palette : groupe « Effets ») ----------------------------------------------------
    { id: 'hammer', touches: ['h'], libelle: 'Hammer-on', groupe: 'effet', apercu: { type: 'icone', nom: 'hammerOn' },
      actif: ed => ed.noteCourante()?.lien === 'hammer', faire: ed => ed.basculerLien('hammer') },
    { id: 'pull', touches: ['p'], libelle: 'Pull-off', groupe: 'effet', apercu: { type: 'icone', nom: 'pullOff' },
      actif: ed => ed.noteCourante()?.lien === 'pull', faire: ed => ed.basculerLien('pull') },
    { id: 'slide', touches: ['s'], libelle: 'Slide (glissé)', groupe: 'effet', apercu: { type: 'icone', nom: 'slide' },
      actif: ed => ed.noteCourante()?.lien === 'slide', faire: ed => ed.basculerLien('slide') },
    { id: 'tie', touches: ['t'], libelle: 'Liaison de prolongation', groupe: 'effet', apercu: { type: 'icone', nom: 'tie' },
      actif: ed => ed.noteCourante()?.lien === 'tie', faire: ed => ed.basculerLien('tie') },
    // Le bend CIRCULE entre ses amplitudes au lieu de basculer entre « rien » et « full » : une
    // version antérieure imposait le ton entier, sans aucun moyen d'obtenir un demi-ton ni un ton et
    // demi — l'amplitude était donc « difficile à définir » (retour utilisateur), pour ne pas dire
    // impossible. Quatre appuis successifs parcourent tout : ½ → full → 1½ → plus de bend.
    { id: 'bend', touches: ['b'], libelle: 'Bend (½ → full → 1½ → aucun)', groupe: 'effet', apercu: { type: 'icone', nom: 'bend' },
      actif: ed => !!ed.noteCourante()?.bend, faire: ed => ed.bendSuivant() },
    { id: 'palmMute', touches: ['m'], libelle: 'Palm mute', groupe: 'effet', apercu: { type: 'texteLeger', texte: 'P.M.' },
      actif: ed => ed.evenementCourant().palmMute, faire: ed => ed.basculerEffetEvenement('palmMute') },
    { id: 'ghost', touches: ['x'], libelle: 'Note fantôme', groupe: 'effet', apercu: { type: 'glyphe', nom: 'TETE_CROIX' },
      actif: ed => !!ed.noteCourante()?.ghost, faire: ed => ed.poserGhost() },
    { id: 'accent', touches: ['a'], libelle: 'Accent', groupe: 'effet', apercu: { type: 'glyphe', nom: 'ACCENT_DESSUS' },
      actif: ed => ed.evenementCourant().accent, faire: ed => ed.basculerEffetEvenement('accent') },
    { id: 'staccato', touches: ['alt+s'], libelle: 'Staccato', groupe: 'effet', apercu: { type: 'glyphe', nom: 'STACCATO' },
      actif: ed => ed.evenementCourant().staccato, faire: ed => ed.basculerEffetEvenement('staccato') },

    // --- Mesure (palette : groupe « Mesure ») ----------------------------------------------------
    // Icônes plutôt que du texte (« + Mesure », « − Mesure », « ⇥ Corriger » à l'origine) — retour
    // utilisateur, capture à l'appui : un bouton texte pèse bien plus large qu'un bouton icône à
    // taille de cible tactile égale, exactement ce qui empêchait la barre d'outils de tenir sur
    // téléphone. `plus`/`moins` : deux icônes déjà dessinées, jamais encore utilisées avant ce
    // correctif (voir ui/icons.js). `corriger` : nouvelle icône, voir ui/icons.js pour le dessin.
    // LE RYTHME SE RÉPÈTE, EN TABLATURE PLUS QU'AILLEURS : un accompagnement, un riff, une basse en
    // croches gardent la même figure sur des dizaines de mesures et ne changent que les notes. Le
    // redire mesure après mesure — choisir la figure, la reposer, la repointer — est du travail pur,
    // et c'est celui qu'on fait le plus souvent en recopiant une partition. Alt+D le reprend d'un
    // coup, sans toucher aux hauteurs déjà écrites.
    { id: 'memeRythme', touches: ['alt+d'],
      libelle: 'Reprendre le rythme de la mesure précédente (les hauteurs déjà écrites restent)',
      groupe: 'mesure', apercu: { type: 'icone', nom: 'memeRythme' },
      palette: ed => ed.curseur.mesure > 0, faire: ed => ed.reprendreRythmePrecedent() },
    { id: 'ajouterMesure', touches: ['alt+m'], libelle: 'Ajouter une mesure', groupe: 'mesure', apercu: { type: 'icone', nom: 'plus' }, faire: ed => ed.ajouterMesure() },
    { id: 'supprimerMesure', touches: ['alt+backspace'], libelle: 'Supprimer la mesure', groupe: 'mesure', apercu: { type: 'icone', nom: 'moins' }, faire: ed => ed.supprimerMesure() },
    // N'apparaît que si la mesure courante est réellement invalide (voir Editeur.ecartMesure) — un
    // bouton toujours visible, sur une mesure déjà juste, n'aurait rien à faire et ne ferait
    // qu'ajouter du bruit à la palette. `Math.abs` : ecartMesure peut aussi bien dire un EXCÉDENT
    // (positif) qu'un MANQUE (négatif, voir corrigerDebordement) — les deux sens comptent.
    { id: 'corrigerDebordement', touches: ['alt+r'], libelle: 'Déverser : l\'excédent part dans une mesure neuve, le manque est comblé par un silence', groupe: 'mesure', apercu: { type: 'icone', nom: 'corriger' },
      palette: ed => Math.abs(ed.ecartMesure()) > 1e-9, faire: ed => ed.corrigerDebordement() },
    // LES DEUX FAÇONS DE PAYER UNE DETTE, côte à côte et visibles EXACTEMENT quand elles servent.
    // « Absorber » ne s'offre que sur un DÉBORDEMENT (écart positif) : sur une mesure incomplète il
    // n'y a rien à reprendre, et un bouton qui ne peut qu'échouer n'a pas à être là. C'est aussi ce
    // qui rend le message d'allongement honnête — il ne nomme plus un remède dont le bouton serait
    // absent de l'écran au moment où on le lit.
    { id: 'absorberDette', touches: ['alt+a'], libelle: 'Absorber : ce qui suit le curseur cède la place, jusqu\'à ce que la mesure retombe juste', groupe: 'mesure', apercu: { type: 'icone', nom: 'absorber' },
      palette: ed => ed.ecartMesure() > 1e-9, faire: ed => ed.absorberDette() },
    // --- REPÈRES : un groupe à part, replié derrière UN bouton (voir style.css, data-groupe="repere")
    // Retour utilisateur : « il faudrait ajouter la possibilité de noter des Coda, Da Capo, etc…
    // comme pour les vraies portées, qui me permettent d'écrire un morceau entier. Ces notations
    // spéciales doivent être insérées dans un seul bouton avec un popover. Placer dedans également
    // des logos de fin de mesure, des fins de mesure avec répétition "://" et autres outils
    // similaires. On devrait encore gagner un peu de place dans la barre d'outils. »
    //
    // LES DEUX REPRISES DÉMÉNAGENT ICI : elles étaient dans le groupe « Mesure », à côté d'ajouter/
    // supprimer une mesure — des gestes de STRUCTURE, alors qu'une reprise est une instruction de
    // JEU, de la même famille exactement que D.C. et Fine. Deux boutons de moins dans la barre, et
    // une famille qui se tient enfin.
    { id: 'repriseDebut', touches: [], libelle: 'Reprise ouvrante', groupe: 'repere', apercu: { type: 'icone', nom: 'repriseDebut' },
      actif: ed => ed.mesureCourante().repriseDebut, faire: ed => ed.basculerReprise('debut') },
    { id: 'repriseFin', touches: [], libelle: 'Reprise fermante', groupe: 'repere', apercu: { type: 'icone', nom: 'repriseFin' },
      actif: ed => ed.mesureCourante().repriseFin, faire: ed => ed.basculerReprise('fin') },
    { id: 'barreDouble', touches: [], libelle: 'Double barre (fin de section)', groupe: 'repere', apercu: { type: 'icone', nom: 'barreDouble' },
      actif: ed => ed.mesureCourante().barre === 'double', faire: ed => ed.definirBarre('double') },
    { id: 'barreFinale', touches: [], libelle: 'Barre finale (fin du morceau)', groupe: 'repere', apercu: { type: 'icone', nom: 'barreFinale' },
      actif: ed => ed.mesureCourante().barre === 'finale', faire: ed => ed.definirBarre('finale') },

    // RYTHME TERNAIRE (retour utilisateur : « est-ce qu'on peut implémenter dans la portée un système
    // classique, qui permet de dire "croche=triolet", et ainsi écrire de façon ternaire ? Les portées
    // classiques le font »). C'est la convention du jazz et de la variété : on écrit des croches
    // DROITES et l'on prévient, en tête, qu'elles se lisent longue-brève. L'alternative — un triolet
    // sur chaque temps — est illisible sur un morceau entier.
    //
    // DANS LE GROUPE « REPÈRES », avec tout ce qui MARQUE la portée (reprises, double barre, Segno,
    // Coda) : comme elles, cette indication se pose une fois et se lit en tête de partition. Elle vit
    // dans `meta` et non dans une mesure — c'est une convention de lecture du morceau (voir
    // model/score.js, `meta.ternaire`).
    // LE TERNAIRE N'EST PAS UN REPÈRE, et il a quitté leur popover (retour utilisateur : « il faut
    // sortir le bouton ternaire du bouton "Repère", et le placer à un endroit plus stratégique »).
    //
    // POURQUOI « ÉCRITURE ». Un repère se pose SUR UNE MESURE et dit où aller ; le ternaire se pose
    // sur LE MORCEAU et dit comment le lire — au même titre que la signature rythmique et la
    // tonalité, ses deux voisins dans ce cadre. C'est aussi, et ce n'est pas un hasard, l'endroit où
    // l'indication se GRAVE sur la page : à côté du tempo et de la tonalité (voir
    // engine/layout.js#poserIndicationTernaire). Le bouton se trouve donc là où se lit son effet.
    //
    // Et il était mal placé pour une seconde raison : replié dans un popover, il fallait l'ouvrir
    // pour savoir si le morceau était swingué — une information qui vaut pour tout le morceau et
    // qu'on veut voir sans cliquer.
    { id: 'ternaire', touches: [], libelle: 'Rythme ternaire — les croches se jouent longue-brève (swing)',
      // `texteGras` et non l'italique léger du palm mute : celui-là imite un signe ITALIQUE de
      // partition, alors que « Ternaire » n'est pas une marque gravée mais l'état d'un réglage. En
      // italique grisé, au milieu de « 4/4 » et « CM » bien nets, le bouton se lisait comme
      // DÉSACTIVÉ. Gras dans les deux états — gris éteint, vert allumé — il dit ce qu'il est.
      groupe: 'ecriture', apercu: { type: 'texteGras', texte: 'Ternaire' },
      actif: ed => !!ed.partition.meta.ternaire, faire: ed => ed.basculerTernaire() },
    // Les six repères de navigation, dérivés de la MÊME table que le modèle et le moteur de rendu
    // (voir model/score.js, REPERES) : un repère ajouté là apparaît ici sans qu'on y touche, et ne
    // peut pas s'y décrire autrement. Segno et Coda se montrent par leur SIGNE (le même tracé que
    // sur la partition, voir ui/icons.js) ; les quatre instructions, par leur abrégé en italique —
    // exactement ce qui se lira sur la portée.
    ...Object.values(REPERES).map(r => ({
        id: 'repere-' + r.id,
        touches: [],
        libelle: r.nom,
        groupe: 'repere',
        apercu: r.symbole ? { type: 'icone', nom: r.symbole } : { type: 'texteLeger', texte: r.texte },
        actif: ed => ed.mesureCourante().repere === r.id,
        faire: ed => ed.definirRepere(r.id),
    })),
    // Étiquette de section au-dessus de la mesure courante (« Couplet 1 », « Refrain », « Pont »…).
    //
    // DEUX ACTIONS DE CETTE TABLE DEMANDENT UNE VALEUR, celle-ci et le nom d'accord juste en dessous
    // — les seules. Elles restent déclarées ICI, avec les autres, plutôt qu'à part dans l'interface :
    // la palette continue de dériver du même tableau, sans dérogation.
    //
    // ELLES NE SAVENT PLUS COMMENT DEMANDER, et c'est le changement. Elles appelaient
    // `window.prompt` directement : une dépendance à l'interface dans une table qui n'en a aucune
    // autre, et surtout une boîte NATIVE au milieu d'une application dessinée (retour utilisateur :
    // « les pop-ups ne sont pas stylées »). Le second argument `ui` apporte désormais un crochet
    // `demanderTexte` — la table dit ce qu'elle veut savoir, l'interface décide comment le demander
    // (voir ui/dialogue.js#saisir, et main.js qui fournit le crochet).
    //
    // ET ELLES RENVOIENT UNE PROMESSE. Une fenêtre maison ne bloque pas le fil d'exécution comme
    // `prompt` le faisait : `faire` peut donc rendre un thenable, que les trois répartiteurs
    // (edit/keyboard.js, ui/toolbar.js, ui/pave.js) savent attendre avant de rafraîchir. Les autres
    // actions restent strictement synchrones — c'est ce qui permet à un banc d'essai de cliquer puis
    // de vérifier sans attendre.
    { id: 'annotation', touches: [], libelle: 'Annotation de section (couplet, refrain, pont…)', groupe: 'mesure', apercu: { type: 'icone', nom: 'annotation' },
      actif: ed => !!ed.mesureCourante().annotation,
      faire: (ed, ui) => {
          const actuelle = ed.mesureCourante().annotation || '';
          return Promise.resolve(ui?.demanderTexte?.({
              titre: 'Annotation de section',
              texte: 'Elle s\'affiche au-dessus de cette mesure. Laisser vide pour la retirer.',
              etiquette: 'Texte',
              valeur: actuelle,
              placeholder: 'Couplet 1, Refrain, Pont…',
          })).then(saisie => { if (saisie !== null && saisie !== undefined) ed.definirAnnotation(saisie); });
      } },
    // Nom d'accord au-dessus de l'évènement courant (« A7 », « E7 »…) — retour utilisateur (capture
    // d'une tablature trouvée en ligne à l'appui) : le modèle qu'on cherche à suivre en porte à
    // chaque changement d'accord, souvent plusieurs fois par mesure. Même geste que l'annotation
    // ci-dessus (une saisie sur la valeur déjà en place), mais sur l'ÉVÈNEMENT plutôt que la mesure —
    // voir Editeur.definirAccord.
    { id: 'accord', touches: [], libelle: 'Nom d\'accord au-dessus de cette note (A7, E7…)', groupe: 'mesure', apercu: { type: 'texteGras', texte: 'Am' },
      actif: ed => !!ed.evenementCourant().accord,
      faire: (ed, ui) => {
          const actuelle = ed.evenementCourant().accord || '';
          return Promise.resolve(ui?.demanderTexte?.({
              titre: 'Nom d\'accord',
              texte: 'Il s\'affiche au-dessus de cette note. Laisser vide pour le retirer.',
              etiquette: 'Accord',
              valeur: actuelle,
              placeholder: 'Am, E7, Cmaj7…',
          })).then(saisie => { if (saisie !== null && saisie !== undefined) ed.definirAccord(saisie); });
      } },

    // --- Voix — voir edit/commands.js ------------------------------------------------------------
    // « + Voix »/« − Voix » ont disparu ici, et c'était justifié : deux boutons pour deux états d'une
    // même question, avec un nom qui ne disait pas l'usage (« je ne comprends pas les boutons
    // voix+/voix-, à quoi cela sert-il ? »). Ils sont remplacés par UN interrupteur qui NOMME l'usage.
    //
    // « 2 VOIX » PLUTÔT QUE « VOIX », parce que le mot « voix » est du vocabulaire de logiciel, pas
    // de musicien. Ce qu'un guitariste cherche, c'est d'écrire une basse tenue SOUS une mélodie —
    // l'écriture de *Jeux interdits* et de tout le fingerstyle. L'infobulle le dit en ces termes.
    // Le moteur savait déjà les graver (hampes opposées, silences décalés, ligatures par voix : voir
    // engine/layout.js) ; il ne manquait que cette porte.
    //
    // DANS LE CADRE « ÉCRITURE », à côté de « Ternaire » : ce sont deux réglages de la MANIÈRE
    // d'écrire, pas deux outils de pose. Et dans le MÊME cadre que `basculerVoix`, pour qu'il n'y
    // ait pas une étiquette « Voix » orpheline dans la barre quand il n'y a qu'une voix.
    // PAS SUR UN ÉCRAN ÉTROIT, et c'est un correctif mesuré : ces deux boutons ajoutent 111px à la
    // rangée du haut, qui passait alors de 358 à 469px de contenu pour 390px de place — elle
    // débordait sur tous les téléphones. La capacité ne disparaît pas pour autant : l'appui long
    // ouvre le menu contextuel, qui porte « Deux voix sur cette mesure » et son pendant global (voir
    // main.js#ouvrirMenuContextuel). C'est l'échange que l'application fait déjà pour le retour à la
    // ligne et le copier/coller de mesure — les gestes rares vont au menu, la barre reste lisible.
    { id: 'deuxVoix', touches: ['alt+v'],
      libelle: 'Deux voix sur cette mesure — une basse tenue sous la mélodie, par exemple',
      groupe: 'ecriture', apercu: { type: 'texteGras', texte: '2 voix' },
      palette: () => !ecranEtroit(),
      actif: ed => ed.nbVoixMesure() > 1, faire: ed => ed.basculerDeuxVoix() },
    // `basculerVoix` (Tab) se cache lui-même tant qu'il n'y a qu'une voix (son `palette`) : sans
    // deuxième voix, il ne coûte rien ; avec, c'est LUI qui dit dans quelle voix on écrit, ce que
    // rien d'autre ne disait.
    { id: 'basculerVoix', touches: ['tab'], libelle: 'Voix suivante', groupe: 'ecriture', apercu: { type: 'voix' },
      palette: ed => ed.nbVoixMesure() > 1 && !ecranEtroit(), actif: () => false, faire: ed => ed.basculerVoix() },
];

/**
 * ÉCRAN ÉTROIT — par la MÊME media query que la feuille de style (`max-width: 720px`) et que
 * main.js#ecranEtroit, pour que les trois basculent au même instant. Une constante recopiée
 * dériverait le jour où l'une changerait ; `matchMedia` interroge la CSS elle-même.
 */
function ecranEtroit() {
    return globalThis.matchMedia?.('(max-width: 720px)').matches ?? false;
}

/** Passe à la figure voisine (plus longue ou plus brève) dans l'échelle des durées. */
function changerFigure(ed, pas) {
    const i = VALEURS_FIGURES.indexOf(ed.evenementCourant().duree.valeur);
    const j = Math.max(0, Math.min(VALEURS_FIGURES.length - 1, (i < 0 ? 2 : i) + pas));
    return ed.appliquerDuree(VALEURS_FIGURES[j]);
}

/** Index touche → action, construit une fois. Les actions sans touche n'y figurent pas. */
export const PAR_TOUCHE = (() => {
    const index = new Map();
    for (const a of ACTIONS) for (const t of a.touches || []) if (!index.has(t)) index.set(t, a);
    return index;
})();

/** Première touche déclarée d'une action, pour l'afficher en infobulle. */
export function toucheDe(action) {
    return action.touches && action.touches.length ? libelleTouche(action.touches[0]) : null;
}
