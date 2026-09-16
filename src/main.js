// TabHub — assemblage de l'application.
//
// Ce module est le SEUL à toucher au DOM et à connaître tous les autres. Chaque brique en dessous
// (modèle, moteur de gravure, éditeur, lecteur, entrées-sorties) ignore l'existence des autres et
// s'éprouve isolément ; c'est ici, et ici seulement, qu'elles sont câblées ensemble.
//
// LA BOUCLE DE L'APPLICATION tient en une phrase : l'éditeur prévient qu'il a changé, on remet en
// page ENTIÈREMENT, et on redessine ce qui est à l'écran. Jamais de mise à jour chirurgicale d'un
// nœud SVG : recalculer toute la mise en page rend structurellement impossible la classe de bugs la
// plus pénible de ce genre d'éditeur — un écran qui ne correspond plus au modèle.
//
// CE QUE ÇA COÛTE, MESURÉ. Sur une partition de 150 mesures (17 000 primitives), la mise en page
// complète prend 14 ms : elle n'est pas le problème et n'a pas à être ménagée. Confier les 17 000
// éléments au navigateur, en revanche, coûtait 243 ms — à chaque frappe. D'où les deux mesures
// ci-dessous, qui ne touchent ni au modèle ni à la mise en page :
//   • une BIBLIOTHÈQUE de glyphes (voir render/svg.js) : chaque dessin décrit une fois, référencé
//     ensuite — le SVG passe de 4,4 Mo à 1,8 Mo ;
//   • le DESSIN DES SEULS SYSTÈMES VISIBLES (voir bandeVisible) : le nombre de nœuds cesse de
//     dépendre de la longueur du morceau. Une partition de 150 mesures se redessine alors aussi vite
//     qu'une de dix, et c'est la seule des trois approches qui tienne quand le morceau s'allonge.

import { Editeur } from './edit/commands.js';
import { brancherClavier } from './edit/keyboard.js';
import { ACTIONS, toucheDe } from './edit/raccourcis.js';
import { construireBarreOutils, flecheOutilsSvg, ajusterFleches } from './ui/toolbar.js';
import { rendreOnglets, titreOnglet } from './ui/onglets.js';
import { construirePave, construireDpadFlottant } from './ui/pave.js';
import { demander, saisir } from './ui/dialogue.js';
import * as Rythme from './ui/rythme.js';
import { icone } from './ui/icons.js';
import { mettreEnPage, pasDeLaPosition, CLEFS } from './engine/layout.js';
import { rendreSvg, PALETTE } from './render/svg.js';
import { Lecteur } from './audio/player.js';
import { enregistrerPartition, lireFichierPartition } from './io/json.js';
import { lireVersions, archiver, supprimerVersion, viderVersions, daterVersion, MAX_VERSIONS } from './io/versions.js';
import { exporterPdf, preparerPdf, FORMATS, JEUX_MARGES, BORNES_PDF, PALETTE_PDF } from './io/pdf.js';
import { exporterMidi, exporterMidiParPartie, analyserFichierMidi, analyserZonesManche, construirePartitionDepuisMidi, detecterRythme } from './io/midi.js';
import { INSTRUMENTS, ACCORDAGES, libelleAccordage } from './model/instruments.js';
import { aplatir, hauteurDeNote, nbCordes, positionDansMesure, positionDebutMesure, capaciteMesure, sectionsDe, armureEffective, signatureEffective, creerPartition } from './model/score.js';
import { nomDeHauteur, hauteurDepuisPas } from './model/theory.js';
import { VALEURS_FIGURES, uniteDeGroupement } from './model/duration.js';

/** Les figures dans l'ordre de VALEURS_FIGURES — pour dire à l'écran ce qu'un étirement vise. */
const NOMS_FIGURES = ['ronde', 'blanche', 'noire', 'croche', 'double-croche', 'triple-croche'];

// Bande de boucle de lecture, sous la TAB de chaque système — en S, partagées par le rendu
// (marquesBoucle) et le geste (mesureDansBandeBoucle) pour que les deux s'accordent toujours sur le
// même endroit à l'écran. Loge entièrement dans geo.margeBas (3.4 S, voir engine/layout.js) : elle
// n'a donc besoin d'AUCUNE réservation d'espace supplémentaire, à la différence de l'annotation de
// section, qui elle grandit la page — cette bande n'a jamais existé que sur l'écran (jamais posée
// dans la liste d'affichage partagée avec le PDF).
const HAUT_BANDE_BOUCLE = 0.5;
const BAS_BANDE_BOUCLE = 1.9;
// AU DOIGT (pointer: coarse), LA ZONE DE SAISIE DEVIENT BIEN PLUS HAUTE (retour utilisateur : « je
// ne peux pas placer la bande orange ou l'étirer comme je veux avec le doigt »). Une souris vise au
// pixel près ; la bande d'origine (1.4 S de haut, guère plus de 12 px à l'interligne par défaut)
// restait bien EN DESSOUS du minimum tactile déjà appliqué PARTOUT AILLEURS dans cette appli
// (.btn-outil/.btn-transport, 40-44 px, voir style.css @media pointer:coarse) — jamais relevé ici
// jusque-là. Seul le BAS grandit (le haut reste juste sous la TAB) : jusqu'à PRESQUE toute la marge
// déjà réservée pour cette bande (geo.margeBas, 3.4 S), jamais au-delà, sans quoi il faudrait
// réserver PLUS d'espace de page rien que pour le tactile — un changement bien plus large que ce
// simple correctif, qui ferait varier la PAGINATION selon l'appareil. Voir marquesBoucle : le TRAIT
// VISUEL, lui, garde la MÊME épaisseur qu'à la souris, centré dans cette zone de prise agrandie
// plutôt qu'étiré avec elle — ni plus large ni plus haut à l'œil, seulement bien plus facile à
// toucher tout autour.
const BAS_BANDE_BOUCLE_TACTILE = 3.3;
/**
 * CIBLE DE 44 px AU DOIGT, ET MESURÉE CETTE FOIS. Le correctif précédent (BAS_BANDE_BOUCLE_TACTILE)
 * visait déjà « le minimum tactile appliqué partout ailleurs » — mais sans le vérifier : mesuré
 * après coup, il donnait 26 px de haut, pas 44. D'où le retour « j'ai du mal à atteindre les
 * poignées », parfaitement fondé.
 *
 * DEUX RAISONS À CET ÉCART, et la seconde est la plus instructive :
 *   • le commentaire d'origine croyait `geo.margeBas` (3,4 S) infranchissable. Mesuré, le vrai
 *     plafond est le SYSTÈME SUIVANT, à 6,6 S — et ce creux est réellement vide : zéro primitive s'y
 *     dessine, vérifié même avec un nom d'accord ET une annotation de section sur le système suivant
 *     (tous deux se gravent dans la boîte de LEUR système, sous son `y`). Il y avait donc deux fois
 *     plus de place que ce qu'on s'autorisait ;
 *   • la hauteur était exprimée en S, donc en fraction de la taille de portée. Or UN DOIGT NE
 *     RÉTRÉCIT PAS QUAND ON DÉZOOME : la même constante donnait 44 px à S=9 et 29 px à S=6. Une
 *     cible tactile se mesure en pixels d'écran, pas en unités de gravure.
 * D'où une hauteur exprimée en PIXELS, convertie en S à l'usage, et bornée par le creux disponible.
 *
 * @param {number} S taille de portée, pour convertir les 44 px en unités de gravure.
 */
const CIBLE_TACTILE_PX = 44;
/** Part du creux entre deux systèmes qu'on s'autorise : jamais tout, pour qu'un doigt visant le
 *  système SUIVANT ne tombe pas dans la bande du précédent. */
const PART_DU_CREUX = 0.8;
function basBandeBoucle(S = 9, creuxEnS = Infinity) {
    if (!appareilTactile()) return BAS_BANDE_BOUCLE;
    const voulu = HAUT_BANDE_BOUCLE + CIBLE_TACTILE_PX / Math.max(1, S);
    const plafond = HAUT_BANDE_BOUCLE + Math.max(0, creuxEnS - HAUT_BANDE_BOUCLE) * PART_DU_CREUX;
    return Math.max(BAS_BANDE_BOUCLE_TACTILE, Math.min(voulu, plafond));
}

// MARGE D'AFFICHAGE — le trait plein de la boucle collait pile aux bords de mesure et de piste,
// sans le moindre ajour ni sur les côtés ni en haut/bas (retour utilisateur : « trop proche du
// bord »), voir marquesBoucle. Retranchée du TRAIT VISUEL (halo + poignées) seulement — jamais de
// la zone INVISIBLE de saisie (y/h/x1/x2 « bruts »), qui reste, elle, pile sur les bords de mesure :
// plus généreuse que ce qu'elle montre, jamais plus chiche (même principe que PRISE_POIGNEE_BOUCLE
// juste plus bas).
const MARGE_BOUCLE_LATERALE = 0.35;   // × S
const MARGE_BOUCLE_VERTICALE = 0.2;   // × S — À LA SOURIS ; voir basBandeBoucle pour le doigt, où le
                                       // trait visuel reste centré sur la même épaisseur qu'ici.
// POIGNÉES de la boucle (retour utilisateur, HarmoHub cité en modèle : « il faut ajouter des
// poignées ») — un repère à chaque VRAI bord de la zone, pour étirer un seul côté sans retracer
// toute la zone. Hauteur alignée sur la marge d'affichage ci-dessus (voir marquesBoucle) — donc
// TOUJOURS strictement DANS ce que `.bande-boucle` couvre déjà (touch-action: none, voir style.css),
// jamais au-delà : un doigt posé pile sur une poignée ne doit jamais retomber sur un élément voisin
// qui, lui, laisse le navigateur faire défiler la page — exactement le geste qu'on cherche à saisir
// ici. La zone de PRISE (voir poigneeBoucleAuPoint), elle, déborde largement le trait visuel, comme
// HarmoHub élargit pareillement la sienne (« souvent trop étroite au doigt ») — mais seulement en
// LARGEUR, jamais en hauteur, pour la même raison de touch-action. AU DOIGT, cette prise s'élargit
// encore (même raison que basBandeBoucle ci-dessus) : rien ne la contraint comme le fait geo.margeBas
// pour la hauteur, elle peut donc grandir bien plus largement.
const LARGEUR_POIGNEE_BOUCLE = 0.6;   // × S — largeur du repère visuel
const PRISE_POIGNEE_BOUCLE = 1.1;     // × S — demi-largeur de la zone de saisie, à la souris
const PRISE_POIGNEE_BOUCLE_TACTILE = 2.4;   // × S — au doigt
function prisePoigneeBoucle() { return (appareilTactile() ? PRISE_POIGNEE_BOUCLE_TACTILE : PRISE_POIGNEE_BOUCLE); }

const CLE_BROUILLON = 'tabhub.brouillon';
const CLE_MESURES_LIGNE = 'tabhub.mesuresParLigne';
const CLE_POSITION_OUTILS = 'tabhub.positionOutils';
const CLE_PAVE = 'tabhub.pave';
const CLE_TAB_SEULE = 'tabhub.tabSeule';
const CLE_METRONOME = 'tabhub.metronome';
const CLE_METRONOME_SUBDIVISION = 'tabhub.metronomeSubdivision';
const CLE_VOLUME_GENERAL = 'tabhub.volumeGeneral';
const CLE_VOLUME_METRONOME = 'tabhub.volumeMetronome';
const CLE_PDF = 'tabhub.pdf';   // les réglages de mise en page du PDF, voir ouvrirApercuPdf
const CLE_ZOOM = 'tabhub.zoom';   // interligne de la portée À L'ÉCRAN, voir changerZoom
const CLE_DECOMPTE = 'tabhub.decompte';   // une mesure de clics avant la lecture, voir Lecteur#_programmerDecompte
const CLE_VERSIONS_ACTIVES = 'tabhub.versionsActives';   // l'historique existe-t-il ? voir io/versions.js

// BORNES DU ZOOM À L'ÉCRAN, en pixels d'interligne — l'unité dont TOUTE la gravure découle (voir
// engine/layout.js#GEO_DEFAUT : changer `S` change l'échelle entière sans toucher à une autre valeur).
//
// POURQUOI UN PAS DE 1px ET NON UN POURCENTAGE. Le pas doit se VOIR sans faire sauter la mise en
// page : de 9 à 10, la partition grandit de 11 % — assez pour que le clic serve à quelque chose, pas
// au point de rejeter la moitié des mesures à la ligne suivante. Et un entier de pixels tombe juste
// sur la grille de l'écran, là où 9,4px rendrait les lignes de portée floues.
//
// LES DEUX BOUTS SONT MESURÉS, pas devinés. À 5px, les deux chiffres d'une case (« 12 ») se touchent
// dans la tablature ; à 16px, quatre mesures ne tiennent plus sur la largeur d'un ordinateur, ce que
// « mesures par ligne » fait déjà mieux. En dehors, la loupe se désactive plutôt que de continuer à
// cliquer sans rien changer.
/** Deux photos de boucle décrivent-elles la MÊME bande ? Comparaison champ par champ plutôt que
 *  par sérialisation : un jour où l'une des deux serait construite dans un autre ordre de clés, un
 *  `JSON.stringify` les déclarerait différentes sans qu'aucune borne ait bougé. */
function memesBornesBoucle(a, b) {
    if (!a || !b) return !a && !b;
    const x = a.boucle, y = b.boucle;
    return x.debut === y.debut && x.fin === y.fin
        && (x.debutDansMesure || 0) === (y.debutDansMesure || 0)
        && (x.finDansMesure ?? null) === (y.finDansMesure ?? null);
}

const ZOOM_MIN = 6;
const ZOOM_MAX = 15;
const ZOOM_DEFAUT = 9;

/**
 * Vrai si l'appareil désigne AU DOIGT plutôt qu'à la souris — la seule question qui compte pour
 * décider de l'interface tactile, bien avant la taille de l'écran : une tablette de 11 pouces n'est
 * pas « petite » mais se pilote au doigt, un portable de 13 pouces est l'inverse.
 *
 * `pointer: coarse` est l'interrogation NORMALISÉE de cette question (le pointeur principal est-il
 * grossier ?), et non un reniflage de la chaîne d'agent utilisateur — laquelle ment, change à chaque
 * version de navigateur, et ne dit rien d'un ordinateur à écran tactile.
 */
function appareilTactile() {
    return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

/**
 * ÉCRAN ÉTROIT — la même question qu'`appareilTactile`, mais posée à la LARGEUR, et volontairement
 * par la même media query que la feuille de style (`max-width: 720px`, voir style.css) : les deux
 * doivent basculer AU MÊME instant, sans quoi la partition se centrerait pendant que la barre
 * d'outils est encore en deux rangées, ou l'inverse. Une constante recopiée ici dériverait le jour
 * où l'une des deux changerait ; `matchMedia` interroge la CSS elle-même.
 */
function ecranEtroit() {
    return window.matchMedia?.('(max-width: 720px)').matches ?? false;
}

class TabHubApp {
    constructor() {
        this.editeur = new Editeur();
        this.lecteur = new Lecteur();
        // Voir Lecteur.brancherReveilAudio : sur téléphone, iOS suspend l'audio dès qu'on quitte
        // l'application. Sans ce rattrapage, TabHub redevient définitivement muet au retour.
        this.lecteur.brancherReveilAudio();
        this.page = null;
        // LE ZOOM DE LA PARTITION À L'ÉCRAN (retour utilisateur : « ajouter un zoom de la partition à
        // l'écran. À placer à l'endroit idéal avec des boutons loupes + et -, pas dans les
        // paramètres »). Un curseur de zoom avait existé ici, puis disparu comme REDONDANT avec le
        // nombre de mesures par ligne ; ce retour le rétablit, et la redondance n'était qu'à moitié
        // vraie. Les deux commandes ne font pas la même chose :
        //   • « mesures par ligne » serre la musique HORIZONTALEMENT — même hauteur de portée, mêmes
        //     chiffres, seulement plus de mesures côte à côte ;
        //   • la loupe change l'ÉCHELLE ENTIÈRE — donc la hauteur de chaque système, le nombre de
        //     lignes visibles d'un coup d'œil, et la taille des chiffres de tablature.
        // L'aperçu PDF l'a démontré sur le papier (2,1 → 1,6 mm d'interligne fait passer un morceau
        // de deux pages à une, là où aucun autre réglage n'y parvient) ; c'est le même levier ici.
        // DEUX BOUTONS ET NON UN CURSEUR, cette fois : un curseur demande de viser, deux loupes se
        // martèlent sans regarder — et c'est ce qu'on fait d'un zoom.
        this.interligne = this._zoomRelu();
        // 0 = « Auto » (glouton). Une préférence d'AFFICHAGE, pas de contenu musical : elle
        // reste locale au navigateur et ne voyage jamais dans le .json — rouvrir le même
        // morceau sur un autre poste doit retomber sur l'agencement automatique.
        this.mesuresParLigne = parseInt(localStorage.getItem(CLE_MESURES_LIGNE), 10) || 0;
        // Désactivé par défaut dans les deux cas (voir Lecteur, constructeur) : une préférence
        // explicite, portée par le lecteur lui-même puisque c'est lui qui programme les clics.
        this.lecteur.metronomeActif = localStorage.getItem(CLE_METRONOME) === '1';
        this.lecteur.metronomeSubdivision = localStorage.getItem(CLE_METRONOME_SUBDIVISION) === '1';
        // Le décompte se retient comme le métronome : c'est une commande qu'on actionne au moment de
        // jouer, mais qui n'a aucune raison d'être oubliée entre deux sessions de travail.
        this.lecteur.decompteActif = localStorage.getItem(CLE_DECOMPTE) === '1';
        // L'HISTORIQUE DES VERSIONS : ALLUMÉ par défaut, à la différence du métronome et du décompte.
        // Ce n'est pas un bruit qu'on subit mais un filet qui ne se remarque que le jour où il sert —
        // et l'utilisateur l'a demandé, donc rien à découvrir pour en bénéficier. Le `!== '0'` (et
        // non `=== '1'`) le dit : c'est l'EXTINCTION qui doit être explicite.
        this.versionsActives = localStorage.getItem(CLE_VERSIONS_ACTIVES) !== '0';
        this.positionOutils = localStorage.getItem(CLE_POSITION_OUTILS) === 'gauche' ? 'gauche' : 'haut';
        document.body.classList.toggle('outils-gauche', this.positionOutils === 'gauche');
        // Pavé tactile : présent au doigt, absent à la souris — SANS réglage à comprendre sur
        // ordinateur (retour utilisateur : « je ne comprends pas ces paramètres »), et un simple
        // interrupteur pour l'éteindre sur un appareil tactile qui n'en veut pas. L'ancienne valeur
        // « jamais » (trois branches : auto/toujours/jamais) se relit comme « éteint » ; toute autre
        // valeur, y compris absente, comme « allumé » — ce qu'était déjà « auto » dans l'immense
        // majorité des cas.
        this.paveActif = localStorage.getItem(CLE_PAVE) !== 'jamais' && localStorage.getItem(CLE_PAVE) !== '0';
        // TAB SEULE (retour utilisateur : « visualiser uniquement la portée de tablature, sans la
        // partition ») : une préférence d'AFFICHAGE comme les autres ci-dessus — locale au
        // navigateur, jamais dans le .json (voir engine/layout.js#mettreEnPage, option `avecPortee`).
        // Sans effet au piano (mettreEnPagePiano ne lit jamais cette option), et le réglage lui-même
        // reste masqué là (voir remplirReglages) plutôt que d'exposer un interrupteur qui ne ferait
        // jamais rien — même principe que le pavé tactile juste au-dessus.
        this.tabSeule = localStorage.getItem(CLE_TAB_SEULE) === '1';
        // Volumes : appliqués au lecteur dès la construction (voir Lecteur, qui les rejoue lui-même
        // au premier `demarrer()`, avant même que Réglages n'ait été ouvert une seule fois).
        const volGeneral = parseInt(localStorage.getItem(CLE_VOLUME_GENERAL), 10);
        const volMetronome = parseInt(localStorage.getItem(CLE_VOLUME_METRONOME), 10);
        this.lecteur.definirVolumeGeneral(Number.isFinite(volGeneral) ? volGeneral : this.lecteur.volumeGeneral);
        this.lecteur.definirVolumeMetronome(Number.isFinite(volMetronome) ? volMetronome : this.lecteur.volumeMetronome);
        this._minuterieMessage = null;
        this._minuterieBrouillon = null;
        // Sélection multiple (glisser un rectangle sur la partition) : un ensemble de clés
        // "mesure:voix:evenement:corde" — le MÊME format que celui déjà utilisé par le lecteur audio
        // pour identifier une note sans ambiguïté (voir audio/player.js). État d'INTERFACE, jamais
        // touché par memoriser()/annuler() : sélectionner ne modifie pas la partition.
        this.selectionNotes = new Set();
        this._lasso = null;
        /**
         * LE TRAVAIL EN COURS A-T-IL ÉTÉ MIS À L'ABRI DANS UN FICHIER ? (voir peutEcraserLeMorceau).
         *
         * Vrai après un export .json, faux dès la modification suivante. Vrai AU DÉMARRAGE, et c'est
         * délibéré : la partition qu'on retrouve à l'ouverture vient du brouillon, on n'y a encore
         * rien fait, et demander « exporter d'abord ? » avant le premier geste avertirait d'un risque
         * qui n'existe pas. `peutAnnuler()` seul ne suffirait pas à le dire — l'historique est vide au
         * démarrage, mais il le redevient aussi après un Annuler jusqu'au bout.
         */
        this.travailExporte = true;

        this.el = {
            feuille: document.getElementById('feuille'),
            zone: document.getElementById('zone-partition'),
            barreOutils: document.getElementById('barre-outils'),
            barreOnglets: document.getElementById('barre-onglets'),
            message: document.getElementById('message'),
            panneauEnTete: document.getElementById('panneau-en-tete'),
            // Tempo et Métronome, DE RETOUR ICI avec les autres : ils avaient dû migrer plus bas dans
            // le constructeur le temps où ui/toolbar.js les fabriquait (ils n'existaient pas encore
            // dans le DOM à ce point-là). Ils vivent de nouveau en HTML statique, dans le bloc de
            // lecture (voir #bloc-lecture dans index.html) — donc plus d'assignation différée.
            tempo: document.getElementById('champ-tempo'),
            metronome: document.getElementById('btn-metronome'),
            decompte: document.getElementById('btn-decompte'),
            metronomeSubdivision: document.getElementById('champ-metronome-subdivision'),   // dans Réglages > Son, voir index.html
            blocLecture: document.getElementById('bloc-lecture'),
            groupeMesuresLigne: document.getElementById('groupe-mesures-ligne'),
            // L'HÔTE DES CHIFFRES, distinct du groupe ci-dessus : celui-là est le contenant que le
            // popover déplace sur téléphone, celui-ci le seul élément que construireBoutonsMesuresLigne
            // a le droit de vider (les loupes sont ses voisines, pas ses filles — voir index.html).
            boutonsMesuresLigneHote: document.getElementById('groupe-mesures-ligne-boutons'),
            btnMesuresLigneBascule: document.getElementById('btn-mesures-ligne-bascule'),
            btnZoomMoins: document.getElementById('btn-zoom-moins'),
            btnZoomPlus: document.getElementById('btn-zoom-plus'),
            position: document.getElementById('info-position'),
            selection: document.getElementById('info-selection'),
            entreeFichier: document.getElementById('entree-fichier'),
            entreeFichierMidi: document.getElementById('entree-fichier-midi'),
            menuContextuel: document.getElementById('menu-contextuel'),
            btnFichiers: document.getElementById('btn-fichiers'),
            popoverFichiers: document.getElementById('popover-fichiers'),
            pave: document.getElementById('pave-tactile'),
            dpadFlottant: document.getElementById('dpad-flottant'),
        };

        // LES ONGLETS — un morceau par onglet (voir ui/onglets.js pour le pourquoi).
        //
        // UN SEUL ÉDITEUR, ET C'EST TOUT L'ENJEU. `this.editeur` porte TOUJOURS l'onglet actif :
        // sa partition, son curseur, son historique. Les onglets INACTIFS gardent le leur ici, dans
        // `etat`. L'onglet actif, lui, a `etat: null` — la vérité est dans l'éditeur, et la garder à
        // deux endroits serait exactement le genre de duplication qui finit par diverger (le projet
        // s'en est déjà défait deux fois : tables d'effets, champs de titre). `_recolterOngletActif`
        // et `_installerOnglet` sont donc les DEUX SEULS endroits qui déplacent cet état.
        //
        // Un seul éditeur permet aussi de ne RIEN rebrancher en changeant d'onglet : la barre
        // d'outils, le clavier et le pavé tactile tiennent tous une référence à cet objet-là,
        // établie une fois pour toutes au démarrage.
        this.onglets = [{ etat: null }];
        this.ongletActif = 0;

        this.restaurerBrouillon();
        this.poserIcones();
        const crochetsUi = {
            rendreLeFocus: () => this.el.zone.focus(),
            signalerErreur: (texte) => this.message(texte),
            // COMMENT DEMANDER UNE VALEUR, fourni par l'interface à la table des actions (voir
            // edit/raccourcis.js, les deux actions « annotation de section » et « nom d'accord »).
            // Elles appelaient `window.prompt` elles-mêmes : la seule dépendance à l'interface dans
            // une table qui n'en a aucune autre, et une boîte native au milieu d'une application
            // dessinée. La table dit maintenant ce qu'elle veut savoir, l'interface décide comment
            // le demander — ici la fenêtre maison (voir ui/dialogue.js#saisir).
            demanderTexte: (options) => saisir(options),
            // OUVRIR L'AIDE RYTHMIQUE, du même esprit que `demanderTexte` juste au-dessus : la table
            // des actions dit ce qu'elle veut (« ouvre l'aide, à partir de cette mesure »),
            // l'interface décide comment. Voir edit/raccourcis.js, action `aideRythme`.
            ouvrirAideRythme: (mesure) => this.ouvrirAideRythme(mesure),
        };
        this.rafraichirOutils = construireBarreOutils(this.el.barreOutils, this.editeur, crochetsUi);
        // Le pavé tactile partage EXACTEMENT les mêmes crochets que la barre d'outils : les deux
        // exécutent les mêmes actions et doivent donc signaler les mêmes refus et rendre le focus au
        // même endroit — jamais deux comportements à tenir juste en parallèle.
        this.rafraichirPave = construirePave(this.el.pave, this.editeur, crochetsUi);
        // La croix de déplacement flotte À PART (retour utilisateur), voir ui/pave.js — mais reste
        // pilotée par LE MÊME interrupteur qu'appliquerPave ci-dessous (body.avec-pave, voir
        // style.css) : les deux se montrent et se cachent TOUJOURS ensemble.
        construireDpadFlottant(this.el.dpadFlottant, this.editeur, crochetsUi);
        this.appliquerPave(this.paveActif);
        this.brancherInterface();
        // La barre d'onglets une première fois : `surChangementEditeur` la redessine ensuite à chaque
        // changement de document, mais rien n'en a encore déclenché à ce stade du démarrage.
        this.rafraichirOnglets();
        brancherClavier(this.editeur, {
            lectureAlternee: () => this.lectureAlternee(),
            arreter: () => this.arreter(),
            enregistrer: () => this.enregistrer(),
            exporterJson: () => this.exporterJson(),
            ouvrir: () => this.ouvrir(),
            exporterPdf: () => this.exporterPdf(),
            aide: () => this.ouvrirFenetre('fenetre-aide'),
            // ONGLETS AU CLAVIER (voir edit/keyboard.js). `allerOnglet` ignore un numéro qui ne
            // correspond à rien : Alt+7 sur trois onglets ne doit RIEN faire, pas sauter au dernier —
            // une touche qui agit « au plus proche » se trompe en silence.
            allerOnglet: (i) => this.activerOnglet(i),
            // Le VOISIN, sans faire le tour : arrivé au bout, on y reste. Un cycle ferait sauter d'un
            // bord à l'autre de la barre, et l'on perdrait le fil de ce qu'on comparait.
            ongletVoisin: (pas) => this.activerOnglet(Math.max(0, Math.min(this.onglets.length - 1, this.ongletActif + pas))),
            focusPartition: () => this.el.zone.focus(),
            signalerErreur: (texte) => this.message(texte),
            aUneSelection: () => this.selectionNotes.size > 0,
            effacerSelection: () => this.effacerSelection(),
        });

        this.editeur.surChangement((raison) => this.surChangementEditeur(raison));
        // Le lecteur peut s'arrêter TOUT SEUL (fin du morceau atteinte, voir player.js#programmer,
        // le schedule de fermeture) sans passer par main.js#arreter/lectureAlternee — les seuls
        // endroits qui rafraîchissaient jusqu'ici l'icône du bouton. Sans ce rafraîchissement ICI,
        // à CHAQUE notification de position, le bouton restait sur « pause » (triangle barré) après
        // une lecture qui s'était terminée d'elle-même, comme si elle continuait encore.
        this.lecteur.surPosition(() => { this.rafraichirTransport(); this.dessiner(); });

        this.el.zone.focus();
        this.dessiner();
    }

    // ==========================================================================================
    // Rendu
    // ==========================================================================================

    dessiner() {
        // Le plancher de largeur existe pour qu'une fenêtre d'ordinateur momentanément rétrécie ne
        // produise pas une mise en page absurde. Il valait 560 px — plus que l'écran d'un téléphone
        // (390 px de large en général) : la partition s'y trouvait donc systématiquement mise en page
        // PLUS LARGE que l'écran, débordant des deux côtés. Un plancher bas suffit à écarter
        // l'absurde (une mesure par ligne y reste parfaitement lisible), et laisse la partition
        // s'adapter réellement à l'écran dès qu'il est plus étroit que ça.
        const largeur = Math.max(280, this.el.zone.clientWidth - 48);
        try {
            this.page = mettreEnPage(this.editeur.partition, {
                S: this.interligne,
                largeurPage: largeur,
                yDepart: 6,
                mesuresParLigne: this.mesuresParLigne || null,
                // Sans effet au piano (mettreEnPagePiano ne lit jamais cette option, voir son propre
                // aiguillage en tête de mettreEnPage) : rien à conditionner ici sur l'instrument.
                avecPortee: !this.tabSeule,
                // CENTRER LE BLOC DE MUSIQUE dans la page (retour utilisateur : « la portée doit être
                // centrée horizontalement (attention, sur téléphone elle doit rester à gauche) »).
                // Voir engine/layout.js#decalageDeCentrage. Sur écran étroit, la musique est de toute
                // façon presque toujours PLUS LARGE que la page (le décalage vaudrait zéro) — mais le
                // « presque » compte : à faible zoom, un téléphone peut afficher une page plus large
                // que sa musique, et le centrage s'y déclencherait sans qu'on l'ait voulu.
                centrer: !ecranEtroit(),
                // En-tête modifiable au clic : un titre VIDE y laisse un fantôme « Titre » sur lequel
                // cliquer (voir poserEnTete), sans quoi l'effacer supprimerait le seul endroit d'où le
                // retaper. Écran seulement — le PDF n'a pas de champ à remplir.
                enTeteEditable: true,
            });
        } catch (err) {
            // Un écran noir SANS EXPLICATION est le pire des échecs — c'est exactement ce que
            // provoquait un brouillon d'un format antérieur avant la correction de
            // restaurerBrouillon(). Filet de sécurité générique : on le dit, on ne laisse pas
            // deviner.
            console.error('Erreur de mise en page :', err);
            this.message('Erreur d\'affichage — voir la console (F12) pour le détail.', 5000);
            return;
        }

        const calques = [...this.marquesLecture(), ...this.marquesARemplir(), ...this.marquesCurseur(), ...this.marquesSelection(), ...this.marquesBoucle()];
        this.el.feuille.style.width = `${this.page.largeur}px`;
        this.el.feuille.style.height = `${this.page.hauteur}px`;
        this.el.feuille.innerHTML = rendreSvg(this.page, {
            calquesDessous: calques,
            systemesVisibles: this.systemesVisibles(),
        });
        this._bandeDessinee = this.bandeVisible();
        // L'APERÇU DE BOUCLE SURVIT AU REDESSIN, tant que le geste dure : voir poserApercuBoucle. Le
        // défilement automatique peut provoquer un `dessiner()` en plein geste, et l'aperçu est
        // justement ce qu'on est en train de regarder.
        if (this._gesteBoucle && this._apercuCourant) {
            this.poserApercuBoucle(this._apercuCourant.rects, this._apercuCourant.genre);
        }

        this.rafraichirOutils();
        this.rafraichirPave();
        this.rafraichirInfos();
    }

    /**
     * Bande de la feuille actuellement à l'écran, en coordonnées de la partition.
     *
     * La marge déborde d'un écran de chaque côté : on dessine donc toujours un peu plus que le
     * visible, pour qu'un défilement rapide ne découvre pas de blanc le temps du redessin suivant.
     */
    bandeVisible() {
        const zone = this.el.zone;
        const rz = zone.getBoundingClientRect();
        const rf = this.el.feuille.getBoundingClientRect();
        const haut = rz.top - rf.top;
        const marge = zone.clientHeight;
        return { haut: haut - marge, bas: haut + zone.clientHeight + marge };
    }

    /** Les systèmes qui coupent la bande visible — ceux-là seuls seront confiés au navigateur. */
    systemesVisibles() {
        if (!this.page) return null;
        const b = this.bandeVisible();
        return this.page.ancrages.systemes.filter(s => s.y + s.hauteur >= b.haut && s.y <= b.bas);
    }

    /**
     * Redessine au défilement, mais SEULEMENT si la bande a assez bougé pour approcher le bord de
     * ce qui est déjà dessiné. Redessiner à chaque évènement de défilement rendrait le gain nul.
     */
    surDefilement() {
        if (!this._bandeDessinee) return this.dessiner();
        const b = this.bandeVisible();
        const d = this._bandeDessinee;
        const marge = this.el.zone.clientHeight * 0.5;
        if (b.haut < d.haut + marge || b.bas > d.bas - marge) this.dessiner();
    }

    /** Ancrage de l'évènement sous le curseur, tel que la mise en page vient de le poser. */
    ancrageCurseur() {
        const c = this.editeur.curseur;
        return this.page?.ancrages.evenements.find(a => a.mesure === c.mesure && a.voix === c.voix && a.evenement === c.evenement) || null;
    }

    /**
     * SURBRILLANCE DES CASES À CHOISIR — les évènements qu'une insertion de rythme a laissés en
     * attente d'une hauteur (voir model/score.js, `Évènement#aRemplir`, et ui/rythme.js).
     *
     * UN CALQUE, PAS DE LA GRAVURE, et c'est le point : ces bandes sont une aide à l'ÉDITION, comme
     * le curseur, la sélection et la bande de boucle qui l'entourent dans `calques`. Les poser dans
     * engine/layout.js les aurait fait sortir sur le PDF — la couleur translucide n'y serait de toute
     * façon pas portable (c'est déjà la raison de l'option `avertirErreurs: false` à l'export), et
     * surtout une partition imprimée n'a aucune raison de montrer un chantier.
     *
     * TOUTE LA HAUTEUR DE LA TAB, et non une corde en particulier : l'évènement n'a pas encore de
     * note, donc aucune corde à désigner. La bande dit « ici, sur ce temps, choisis une case » —
     * c'est exactement l'information disponible, ni plus ni moins.
     */
    marquesARemplir() {
        if (!this.page) return [];
        const S = this.page.geo.S;
        const marques = [];
        for (const a of this.page.ancrages.evenements) {
            if (!a.ref?.aRemplir) continue;
            // Sans TAB (mode « TAB seule » inversé, ou piano), la bande couvre la portée : il n'y a
            // pas de tablature où poser la case, mais l'attente reste vraie et doit se voir.
            const y = a.yTab != null ? a.yTab - 0.3 * S : a.yPortee - 0.3 * S;
            const bas = a.yBas + 0.3 * S;
            marques.push({ t: 'rect', x: a.xDebut, y, w: a.xFin - a.xDebut, h: Math.max(2, bas - y), couleur: 'var(--a-remplir)' });
        }
        return marques;
    }

    /**
     * Marques du curseur d'édition : un bandeau vertical (« où dans le temps ») et un trait franc sur
     * la corde visée (« sur quelle corde »). Deux informations distinctes, donc deux marques : un seul
     * repère obligerait à deviner l'une des deux.
     */
    marquesCurseur() {
        const a = this.ancrageCurseur();
        if (!a) return [];
        const S = this.page.geo.S, ST = this.page.geo.ST;
        const y = a.yPortee - 1.2 * S;
        const bas = a.yBas + 1.2 * S;
        const marques = [
            { t: 'rect', x: a.xDebut, y, w: a.xFin - a.xDebut, h: bas - y, couleur: 'var(--curseur-halo)' },
        ];
        // Le trait « sur quelle corde » n'a de sens que sur une TABLATURE — un piano (a.yTab absent,
        // voir engine/layout.js#poserMesurePiano) montre déjà SA note à sa hauteur réelle sur la
        // portée : le bandeau du dessus suffit à dire « ici, dans le temps », rien de plus à ajouter.
        if (a.yTab != null) {
            const yCorde = a.yTab + this.editeur.curseur.corde * ST;
            const demi = ST * 0.62;
            marques.push(
                { t: 'rect', x: a.x - demi, y: yCorde - ST * 0.56, w: demi * 2, h: ST * 1.12, couleur: 'var(--curseur-halo)' },
                { t: 'rect', x: a.x - demi, y: yCorde + ST * 0.5, w: demi * 2, h: Math.max(1.6, S * 0.22), couleur: 'var(--curseur)' },
            );
        }
        return marques;
    }

    /**
     * Trait de lecture : une ligne verticale discrète, PAS un bandeau surlignant la note — elle
     * parcourt TOUTE la hauteur du système (portée et tablature, qui partagent le même axe des x),
     * plutôt qu'un repère cantonné à l'évènement en cours. Sa position s'INTERPOLE à l'intérieur de
     * l'évènement en cours plutôt que de sauter de note en note : sur une ronde à 60 BPM, un trait
     * qui saute resterait figé quatre secondes puis bondirait — on ne saurait plus ce qui est en
     * train de sonner.
     *
     * LA TRAÎNÉE se pose derrière le trait, du côté d'où il VIENT — donc vers la GAUCHE, puisque la
     * musique n'avance que dans un sens — en deux bandes de plus en plus opaques à l'approche du
     * trait. Sans dégradé natif dans ce moteur de primitives, c'est l'approximation la plus simple
     * qui reste fidèle à l'idée : un fondu, pas un bloc plat.
     */
    marquesLecture() {
        if (this.lecteur.etat === 'arret' || !this.page) return [];
        const plat = aplatir(this.editeur.partition);
        const t = this.lecteur.position;
        // À plusieurs voix sonnant au même instant, on ancre le trait sur la voix 0 (la mélodie,
        // celle qu'on suit le plus naturellement à l'oreille) : `aplatir` liste toujours les
        // évènements d'une mesure voix par voix, dans l'ordre, donc le premier qui correspond au
        // temps courant est déjà celui de la voix la plus basse en index.
        const lieu = this.lieuDeLaPosition(t, plat);
        if (!lieu) return [];
        const { x, ancrage: a } = lieu;
        const S = this.page.geo.S;
        const haut = a.yPortee - 1.2 * S;
        const bas = a.yBas + 1.2 * S;
        this.faireDefilerVers(a, haut, bas);

        const largeurTrait = Math.max(1.2, S * 0.15);
        // AMBRE, jamais le vert du curseur d'édition : les deux repères coexistent à l'écran (on
        // peut éditer une mesure pendant que la lecture tourne plus loin) et doivent rester
        // reconnaissables au premier coup d'œil l'un de l'autre — voir la variable --lecture, restée
        // inutilisée ici jusqu'à ce correctif (le trait de lecture se dessinait avec les mêmes
        // teintes que le curseur, donc invisible EN TANT QUE tel : rien ne le distinguait).
        return [
            { t: 'rect', x: x - S * 1.6, y: haut, w: S * 1.0, h: bas - haut, couleur: 'rgba(255, 152, 0, 0.07)' },
            { t: 'rect', x: x - S * 0.6, y: haut, w: S * 0.6, h: bas - haut, couleur: 'rgba(255, 152, 0, 0.16)' },
            { t: 'rect', x: x - largeurTrait / 2, y: haut, w: largeurTrait, h: bas - haut, couleur: 'var(--lecture)' },
        ];
    }

    /**
     * OÙ TOMBE UN INSTANT SUR LA PAGE — la conversion « position en noires -> abscisse », et son
     * ancrage. Rendue PARTAGÉE (tête de lecture ET bornes de la bande de boucle) plutôt que
     * recopiée : une bande dont le bord ne tomberait pas exactement là où la tête de lecture passe
     * dirait deux vérités sur le même instant, et c'est le genre d'écart qu'on ne remarque qu'en
     * bouclant sur un passage pour découvrir qu'il ne commence pas où on l'avait dessiné.
     *
     * PAS UNE RÈGLE DE TROIS DANS LA MESURE, et c'est la raison d'être de cette fonction. On
     * pourrait croire l'abscisse proportionnelle au temps : c'est vrai tant que les durées sont
     * ÉGALES (mesuré : quatre noires tombent exactement tous les 45px d'une zone de notes de 180px),
     * et FAUX dès qu'elles sont mélangées — une blanche suivie de deux croches et d'une noire écarte
     * la gravure de l'espacement proportionnel jusqu'à 25px sur ces mêmes 180. On lit donc les
     * ÉVÈNEMENTS RÉELLEMENT GRAVÉS : on trouve la colonne qui contient l'instant, et on interpole
     * entre ses deux bords.
     *
     * @param {number} position  en noires depuis le début du morceau.
     * @param {Array} [plat]     `aplatir(partition)` déjà calculé, si l'appelant l'a sous la main.
     * @returns {{x: number, ancrage: object}|null}
     */
    lieuDeLaPosition(position, plat = null) {
        if (!this.page) return null;
        const liste = plat || aplatir(this.editeur.partition);
        const EPS = 1e-9;
        const ancrageDe = (e) => this.page.ancrages.evenements.find(
            x => x.mesure === e.mesure && x.voix === e.voix && x.evenement === e.evenement);

        const systemeDe = (a) => this.page.ancrages.mesures.find(m => m.index === a.mesure)?.systeme ?? 0;
        const dans = liste.find(e => position >= e.debut - EPS && position < e.debut + e.duree - EPS);
        if (dans) {
            const a = ancrageDe(dans);
            if (!a) return null;
            const avance = dans.duree > 0 ? Math.max(0, Math.min(1, (position - dans.debut) / dans.duree)) : 0;
            return { x: a.xDebut + (a.xFin - a.xDebut) * avance, ancrage: a, systeme: systemeDe(a) };
        }
        // AUCUNE COLONNE NE CONTIENT L'INSTANT : c'est le cas de la FIN d'une boucle, qui tombe
        // pile sur la barre de mesure — un instant qu'aucun évènement ne couvre, puisqu'il marque
        // la fin du dernier. On se rabat sur le bord DROIT de la dernière colonne qui le précède,
        // c'est-à-dire l'endroit exact où cette mesure se termine.
        let avant = null;
        for (const e of liste) {
            if (e.debut + e.duree <= position + EPS && (!avant || e.debut + e.duree > avant.debut + avant.duree)) avant = e;
        }
        if (!avant) return null;
        const a = ancrageDe(avant);
        return a ? { x: a.xFin, ancrage: a, systeme: systemeDe(a) } : null;
    }

    /**
     * L'INVERSE : quel instant du morceau se trouve sous cette abscisse, dans cette mesure. Même
     * lecture des colonnes gravées que `lieuDeLaPosition`, dans l'autre sens — c'est ce qui rend le
     * geste et le dessin réciproques, donc une bande qui se repose là où on l'a lâchée.
     *
     * @returns {number} position en noires depuis le début du morceau, bornée à la mesure visée.
     */
    positionDeLAbscisse(iMesure, x) {
        const partition = this.editeur.partition;
        const debutMesure = positionDebutMesure(partition, iMesure);
        const capacite = capaciteMesure(partition, iMesure);
        if (!this.page) return debutMesure;
        // VOIX 0 SEULE, comme la tête de lecture : à plusieurs voix, les colonnes se superposent et
        // « l'instant sous ce pixel » n'aurait pas de réponse unique. La mélodie tranche.
        // Les durées viennent d'`aplatir`, jamais recalculées ici : une seconde façon de mesurer la
        // durée d'un évènement finirait par ne plus donner le même résultat que la première.
        const plat = aplatir(partition).filter(e => e.mesure === iMesure && e.voix === 0);
        const avec = plat.map(e => ({
            e,
            a: this.page.ancrages.evenements.find(z => z.mesure === iMesure && z.voix === e.voix && z.evenement === e.evenement),
        })).filter(z => z.a);
        if (!avec.length) return debutMesure;

        if (x <= avec[0].a.xDebut) return debutMesure;
        for (const { e, a } of avec) {
            if (x < a.xFin) {
                const part = a.xFin > a.xDebut ? Math.max(0, Math.min(1, (x - a.xDebut) / (a.xFin - a.xDebut))) : 0;
                return e.debut + part * e.duree;
            }
        }
        return debutMesure + capacite;
    }

    /** Amène le système du curseur dans la bande visible, s'il n'y est plus. */
    suivreLeCurseur() {
        const a = this.ancrageCurseur();
        if (!a || !this.page) return;
        const systeme = this.page.ancrages.systemes.find(s => s.yPortee === a.yPortee);
        if (!systeme) return;
        const zone = this.el.zone;
        const rf = this.el.feuille.getBoundingClientRect();
        const rz = zone.getBoundingClientRect();
        const hautEcran = rz.top - rf.top;
        const basEcran = hautEcran + zone.clientHeight;
        const marge = this.page.geo.S * 3;
        if (systeme.y < hautEcran + marge || systeme.y + systeme.hauteur > basEcran - marge) {
            zone.scrollTop += systeme.y - hautEcran - zone.clientHeight * 0.3;
        }
    }

    /** Garde la zone en cours de lecture visible, sans la recentrer à chaque image (ça donnerait le mal de mer). */
    faireDefilerVers(ancrage, haut, bas) {
        const zone = this.el.zone;
        const hautEcran = zone.scrollTop;
        const basEcran = hautEcran + zone.clientHeight;
        const marge = 60;
        if (bas + marge > basEcran || haut - marge < hautEcran) {
            zone.scrollTo({ top: Math.max(0, haut - zone.clientHeight * 0.32), behavior: 'smooth' });
        }
    }

    // ==========================================================================================
    // Réactions aux changements
    // ==========================================================================================

    surChangementEditeur(raison) {
        // LA BANDE DE BOUCLE SUIT SES MESURES, pas leurs numéros (voir Lecteur.reancrerBoucle).
        // AVANT `dessiner`, et sur TOUTES les raisons : la bande est dessinée à partir des numéros,
        // et une insertion, une suppression, un collage ou une annulation vient peut-être de les
        // décaler. Un seul appel ici couvre tout ce qui touche au tableau des mesures, aujourd'hui
        // comme demain — c'est la raison d'être de l'ancrage.
        //
        // ET C'EST LUI QUI RETIRE LA BOUCLE D'UN MORCEAU QU'ON QUITTE. Il y avait ici, avant
        // l'ancrage, un `retirerBoucle()` sur la raison 'document' : un morceau neuf ne doit pas
        // hériter de la boucle du précédent. Cette règle est devenue à la fois REDONDANTE et FAUSSE.
        //   - Redondante : un morceau neuf a des mesures neuves, donc des `id` que les ancres ne
        //     retrouvent pas — `reancrerBoucle` s'en défait de lui-même.
        //   - Fausse : un CHANGEMENT D'ONGLET émet la même raison 'document', et la boucle de
        //     l'onglet qu'on rouvre borne des mesures qui existent bel et bien. La règle l'effaçait
        //     (mesuré : la bande ne revenait pas avec son onglet), alors que les ancres suffisaient
        //     à décider. Une condition de moins, et la bonne réponse dans les deux cas.
        if (raison !== 'curseur' && raison !== 'lecture') this.lecteur.reancrerBoucle(this.editeur.partition);
        // L'INTITULÉ D'UN ONGLET EST LE TITRE DU MORCEAU : il change donc quand le document change
        // (ouverture, nouvel onglet) et quand on retitre (raison 'meta'). Redessiner la barre est
        // une poignée de boutons — moins cher qu'un mécanisme de mise à jour fine, et sans la classe
        // de bogues où l'affichage et l'état cessent de dire la même chose.
        if (raison === 'document' || raison === 'meta') this.rafraichirOnglets();
        this.dessiner();
        // Le curseur reste à l'écran. Nécessaire depuis que seuls les systèmes visibles sont
        // dessinés : un curseur poussé hors de la bande dessinée s'afficherait sur du vide, sans
        // portée derrière lui. C'est aussi ce qu'on attend en écrivant — la page suit la saisie.
        if (raison !== 'lecture') this.suivreLeCurseur();
        this.rafraichirBoutonsHistorique();
        if (raison === 'document' || raison === 'instrument') this.remplirReglages();
        // Le titre s'affiche désormais SUR la partition (voir engine/layout.js#poserEnTete), que
        // `dessiner()` vient de redessiner juste au-dessus : il n'y a plus de champ à resynchroniser
        // dans la barre du haut. Le panneau d'édition, lui, se remplit à son ouverture.
        if ((raison === 'document' || raison === 'meta') && !this.el.panneauEnTete.hidden) this.remplirEditeurEnTete();
        if (raison === 'document' || raison === 'tempo') {
            this.el.tempo.value = this.editeur.partition.meta.tempo;
            this.lecteur.definirTempo(this.editeur.partition.meta.tempo);
        }
        // CE QU'ON ENTEND SUIT CE QU'ON ÉCRIT (retour utilisateur : « lorsque je modifie une mesure,
        // la lecture audio n'est pas toujours à jour et garde les informations précédentes. Elle doit
        // s'adapter en temps réel aux modifications, même lorsque la lecture en boucle n'est pas
        // arrêtée »). La partition n'était traduite en évènements d'horloge qu'au DÉMARRAGE de la
        // lecture : tout ce qu'on écrivait ensuite n'existait pas pour l'audio, et en boucle on
        // entendait indéfiniment l'état d'avant la correction.
        //
        // Sur TOUTES les raisons qui touchent la musique, l'annulation et le rétablissement compris
        // — c'est là que le décalage s'entend le plus (on annule parce qu'on n'aimait pas ce qu'on a
        // entendu). Deux exclusions : 'curseur', qui ne change rien à ce qui sonne, et 'lecture',
        // émise par le lecteur lui-même, qui se reprogrammerait en boucle.
        if (raison !== 'curseur' && raison !== 'lecture') {
            this.lecteur.reprogrammerSiEnCours(this.editeur.partition);
        }
        // Retour sonore à la saisie : entendre la note qu'on vient de poser évite l'essentiel des
        // erreurs de corde, invisibles à l'œil sur une tablature. Jamais pendant la lecture, où il
        // doublerait ce qu'on entend déjà.
        if (raison === 'saisie' && this.lecteur.etat !== 'lecture') {
            const note = this.editeur.noteCourante();
            if (note) {
                const midi = hauteurDeNote(this.editeur.partition, note);
                if (midi != null) this.lecteur.apercu(midi);
            }
        }
        this.planifierBrouillon();
        // TOUTE MODIFICATION DU DOCUMENT REND L'EXPORT PÉRIMÉ (voir travailExporte et
        // peutEcraserLeMorceau). Pas 'curseur' ni 'lecture', qui ne changent rien au contenu : sans
        // cette exclusion, un simple déplacement de curseur ferait réapparaître l'avertissement sur
        // un morceau qu'on vient d'exporter, et un avertissement qui se déclenche pour rien s'apprend
        // à cliquer sans lire.
        if (raison !== 'curseur' && raison !== 'lecture') this.travailExporte = false;
    }

    rafraichirBoutonsHistorique() {
        document.getElementById('btn-annuler').disabled = !this.editeur.peutAnnuler();
        document.getElementById('btn-retablir').disabled = !this.editeur.peutRetablir();
    }

    /**
     * État visuel des deux boutons du métronome — repris de HarmoHub, jusqu'à l'icône du second qui
     * CHANGE avec son état (noire seule = clic sur le temps seulement, deux croches reliées = clic de
     * subdivision en plus) plutôt que de rester fixe : l'œil voit directement ce qui va se jouer,
     * sans avoir à se souvenir d'un état invisible derrière un bouton toujours identique.
     */
    rafraichirMetronome() {
        const actif = this.lecteur.metronomeActif;
        const sub = this.lecteur.metronomeSubdivision;
        this.el.metronome.classList.toggle('actif', actif);
        this.el.metronome.setAttribute('aria-pressed', String(actif));
        // La subdivision est devenue un INTERRUPTEUR dans Réglages > Son (voir index.html) : plus de
        // classe `actif` ni de dessin à échanger — `aria-checked` suffit, et .interrupteur[aria-checked]
        // porte déjà tout l'aspect (voir style.css). Les deux jeux de glyphes qui disaient « une
        // noire » ou « deux croches » n'avaient de raison d'être que tant qu'une icône devait
        // annoncer elle-même son propre état.
        this.el.metronomeSubdivision.setAttribute('aria-checked', String(sub));
        // Le décompte, dans la même fonction : les trois commandes partagent le son du métronome, et
        // un seul rafraîchissement évite qu'un état s'affiche alors que l'autre ne l'est pas encore.
        const dec = this.lecteur.decompteActif;
        this.el.decompte?.classList.toggle('actif', dec);
        this.el.decompte?.setAttribute('aria-pressed', String(dec));
    }

    /**
     * Le nombre de mesures par ligne, EN BOUTONS plutôt qu'en menu déroulant — mis en avant à la
     * demande (retour utilisateur : « c'est un bouton utile », après avoir signalé qu'on ne voit
     * qu'une seule mesure à l'horizontale sur téléphone : c'est justement ce réglage, resté sur
     * « Auto », qui décidait de n'en montrer qu'une seule à l'écran). Un menu déroulant cache ses
     * valeurs tant qu'on ne l'ouvre pas ; un rang de boutons les montre toutes d'un coup d'œil, et se
     * choisit d'un seul geste — la même logique que la palette d'outils au-dessus.
     *
     * Construit UNE FOIS (comme la barre d'outils, voir ui/toolbar.js) ; seule la classe « actif »
     * bouge ensuite, voir rafraichirInfos ci-dessous, appelé à chaque redessin.
     */
    /** L'interligne retenu du navigateur, BORNÉ à la relecture : une valeur héritée d'une version
     *  antérieure (ou tapée à la main dans localStorage) ne doit pas pouvoir rendre la partition
     *  illisible ou invisible. Même principe qu'à l'ouverture d'un .json — tout champ relu est borné.
     *  @returns {number} px d'interligne, dans [ZOOM_MIN, ZOOM_MAX] */
    _zoomRelu() {
        const brut = parseInt(localStorage.getItem(CLE_ZOOM), 10);
        if (!Number.isFinite(brut)) return ZOOM_DEFAUT;
        return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, brut));
    }

    /**
     * Un cran de loupe. `delta` vaut +1 ou −1 : c'est la commande, pas une valeur à viser.
     *
     * RIEN NE SE PASSE AUX BUTOIRS, et le bouton le dit avant d'être cliqué (voir rafraichirZoom, qui
     * le désactive) : un bouton qui reste vif mais n'agit plus se lit comme une panne.
     */
    changerZoom(delta) {
        const avant = this.interligne;
        this.interligne = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, avant + delta));
        if (this.interligne === avant) return;
        localStorage.setItem(CLE_ZOOM, String(this.interligne));
        this.rafraichirZoom();
        this.dessiner();
    }

    /**
     * LA BANDE FANTÔME AU SURVOL — pour qu'on sache que la boucle existe AVANT de l'avoir découverte.
     *
     * LE DÉFAUT (retour utilisateur) : « avant que je la définisse, les utilisateurs ne sauront pas
     * forcément qu'il est possible de placer une barre de lecture ». C'était exact : la piste de
     * saisie est INVISIBLE tant qu'aucune boucle n'existe (voir marquesBoucle — une couleur d'alpha
     * nul, là seulement pour recevoir le geste). Rien, absolument rien, ne disait qu'on pouvait
     * cliquer sous la tablature. Une fonction qu'on ne peut trouver qu'en glissant par hasard au bon
     * endroit n'existe pas vraiment.
     *
     * LE FANTÔME EST UNE MESURE ENTIÈRE, parce que c'est ce que le CLIC pose (voir
     * demarrerGesteBoucle, le cas du tap immobile) : ce qu'on montre est exactement ce qu'on obtient.
     * Lui donner une autre taille que le résultat du clic serait une promesse fausse.
     *
     * À LA SOURIS SEULEMENT, et ce n'est pas un oubli : un doigt n'a pas de survol. Sur téléphone
     * l'évènement n'arriverait qu'AVEC le contact, c'est-à-dire au moment où le geste commence — le
     * fantôme clignoterait une fraction de seconde sous le doigt pour ne rien apprendre à personne.
     * La découvrabilité au doigt est un autre problème, qui ne se résout pas par un survol.
     *
     * SEULEMENT QUAND IL N'Y A PAS ENCORE DE BOUCLE. Une fois la bande posée, c'est ELLE
     * l'affordance : elle se voit, elle a des poignées. Continuer à proposer un fantôme par-dessus
     * brouillerait la lecture, et surtout entrerait en conflit avec le tap qui RETIRE la boucle en
     * place (le seul moyen tactile d'en annuler une) — on montrerait « clique pour poser » là où
     * cliquer retire.
     */
    brancherSurvolBoucle() {
        const zone = this.el.zone;
        if (!zone) return;
        let derniereMesure = null;
        const effacer = () => {
            if (derniereMesure === null) return;
            derniereMesure = null;
            this.poserApercuBoucle([]);
        };
        // LA SURBRILLANCE DES POIGNÉES, et le curseur qui va avec.
        //
        // LE DÉFAUT (retour utilisateur) : « j'ai du mal à atteindre les poignées […] en plus du
        // curseur qui change, il faut mettre en surbrillance les 2 petites poignées à l'intérieur de
        // la barre orange, lorsque je les survole. » Et le curseur MENTAIT déjà : `.bande-boucle`
        // portait `cursor: ew-resize` sur TOUTE la bande, y compris là où glisser REDÉFINIT la boucle
        // au lieu d'en étirer un bord. Il annonçait donc partout un geste qui n'existait qu'aux deux
        // extrémités — ce qui explique en partie qu'on cherche les poignées sans les trouver : rien
        // ne changeait quand on arrivait dessus.
        let derniereSurbrillance = null;
        const surbriller = (bord) => {
            if (bord === derniereSurbrillance) return;
            derniereSurbrillance = bord;
            const svg = this.el.feuille.querySelector('svg');
            if (!svg) return;
            for (const el of svg.querySelectorAll('.poignee-boucle')) {
                const sienne = bord && el.classList.contains(`poignee-${bord}`);
                el.classList.toggle('poignee-survolee', !!sienne);
            }
            // LE CURSEUR NE PROMET QUE CE QUI EXISTE : `ew-resize` sur une poignée (on va étirer ce
            // bord), la main ailleurs sur la bande (on va poser, retirer ou redéfinir).
            this.el.feuille.classList.toggle('sur-poignee-boucle', !!bord);
        };
        this._surbrillerPoignee = surbriller;

        zone.addEventListener('pointermove', (e) => {
            if (e.pointerType !== 'mouse' || this._gesteBoucle) { surbriller(null); return effacer(); }
            // UNE BOUCLE EN PLACE : plus de fantôme (voir la docblock), mais les poignées s'allument.
            if (this.lecteur.boucleLecture) {
                effacer();
                surbriller(this.poigneeBoucleAuPoint(e.clientX, e.clientY));
                return;
            }
            surbriller(null);
            const iMesure = this.mesureDansBandeBoucle(e.clientX, e.clientY);
            if (iMesure == null) return effacer();
            if (iMesure === derniereMesure) return;
            derniereMesure = iMesure;
            const a = this.page?.ancrages.mesures.find(m => m.index === iMesure);
            if (!a) return effacer();
            this.poserApercuBoucle(this.rectsBoucle(a.systeme, a.x, a.systeme, a.xFin), 'fantome');
        });
        zone.addEventListener('pointerleave', () => { surbriller(null); effacer(); });
        // Le fantôme s'efface DÈS que le geste commence : à partir de là c'est l'aperçu qui parle,
        // et deux bandes translucides superposées ne diraient plus rien de clair.
        zone.addEventListener('pointerdown', effacer);
    }

    /**
     * PINCER OU MOLETTE-CTRL SUR LA PARTITION : on agrandit LA PARTITION, pas la page.
     *
     * LE DÉFAUT (retour utilisateur : « lorsque je zoome avec les doigts ou sur mon ordinateur, peux-tu
     * modifier le zoom de la partition uniquement ? Actuellement toute la page zoome et dézoome »).
     * Rien n'interceptait le geste : le navigateur appliquait donc son propre zoom, qui grossit TOUT —
     * barres d'outils, boutons, transport — et fait déborder l'interface pendant qu'on cherchait
     * seulement à mieux voir les notes. Or l'application a déjà son zoom À ELLE (l'interligne de la
     * portée, voir changerZoom), qui remet la musique en page proprement au lieu de l'étirer.
     *
     * LES DEUX GESTES ARRIVENT PAR LE MÊME ÉVÈNEMENT, ce qui n'est pas évident : un pincement sur
     * pavé tactile est rendu par le navigateur comme un `wheel` avec `ctrlKey` — exactement comme
     * Ctrl+molette à la souris. Un seul écouteur couvre donc le portable et l'ordinateur de bureau.
     * Le pincement à DEUX DOIGTS sur écran tactile, lui, n'émet pas de `wheel` : il faut suivre les
     * deux pointeurs, plus bas.
     *
     * UNIQUEMENT SUR LA ZONE DE PARTITION, et c'est la limite qui rend la chose acceptable : le zoom
     * du navigateur reste entier partout ailleurs (barres, fenêtres, réglages). On ne confisque le
     * geste que là où l'application a une meilleure réponse à donner.
     */
    brancherZoomGeste() {
        const zone = this.el.zone;
        if (!zone) return;

        // --- Pavé tactile et Ctrl+molette ---------------------------------------------------------
        // `passive: false` est OBLIGATOIRE pour que `preventDefault` porte : sans lui, le navigateur
        // considère l'écouteur comme un simple observateur et applique son zoom quand même.
        //
        // UN SEUIL CUMULÉ plutôt qu'un cran par évènement : un pincement de pavé tactile émet des
        // dizaines de `wheel` de quelques unités chacun, et un cran par évènement traverserait toute
        // l'échelle de zoom en un geste. On accumule et on ne franchit un cran qu'au seuil.
        let accumule = 0;
        const SEUIL_MOLETTE = 42;
        zone.addEventListener('wheel', (e) => {
            if (!e.ctrlKey) return;   // molette ordinaire : c'est du défilement, on n'y touche pas
            e.preventDefault();
            accumule += e.deltaY;
            while (Math.abs(accumule) >= SEUIL_MOLETTE) {
                // deltaY NÉGATIF = pincement qui s'ouvre / molette vers le haut = AGRANDIR.
                this.changerZoom(accumule < 0 ? 1 : -1);
                accumule -= Math.sign(accumule) * SEUIL_MOLETTE;
            }
        }, { passive: false });

        // --- Pincement à deux doigts --------------------------------------------------------------
        // On suit les pointeurs nous-mêmes : `gesturestart`/`gesturechange` n'existent que chez
        // Safari, et deux chemins pour un même geste finiraient par ne plus se comporter pareil.
        //
        // TANT QU'IL N'Y A QU'UN DOIGT, ON NE TOUCHE À RIEN : un seul doigt fait défiler la partition
        // (voir .zone-partition, `touch-action: pan-x pan-y`) et pose le curseur. Le zoom ne commence
        // qu'au SECOND doigt — et c'est seulement à ce moment-là qu'on reprend la main sur le geste.
        const doigts = new Map();
        let ecartDepart = 0;
        let interligneDepart = 0;
        const ecart = () => {
            const [a, b] = [...doigts.values()];
            return Math.hypot(a.x - b.x, a.y - b.y);
        };
        zone.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'touch') return;
            doigts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (doigts.size === 2) { ecartDepart = ecart(); interligneDepart = this.interligne; }
        });
        zone.addEventListener('pointermove', (e) => {
            if (!doigts.has(e.pointerId)) return;
            doigts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (doigts.size !== 2 || !ecartDepart) return;
            e.preventDefault();
            // L'INTERLIGNE SUIT LE RAPPORT DES ÉCARTS, à partir de celui du DÉBUT du geste : écarter
            // les doigts de moitié agrandit de moitié. Calculer par rapport au cran précédent ferait
            // dériver le zoom au fil d'un long pincement, et refermer les doigts ne rendrait pas la
            // taille de départ.
            const vise = Math.round(interligneDepart * (ecart() / ecartDepart));
            const delta = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, vise)) - this.interligne;
            if (delta) this.changerZoom(delta);
        }, { passive: false });
        const lacher = (e) => {
            doigts.delete(e.pointerId);
            if (doigts.size < 2) ecartDepart = 0;
        };
        zone.addEventListener('pointerup', lacher);
        zone.addEventListener('pointercancel', lacher);
    }

    /** Désactive la loupe arrivée au bout de sa course, et dit dans l'infobulle où l'on en est —
     *  sans occuper la place d'un affichage chiffré, que la barre du bas n'a pas à donner. */
    rafraichirZoom() {
        const crans = ZOOM_MAX - ZOOM_MIN;
        const cran = this.interligne - ZOOM_MIN;
        for (const [bouton, borne, libelle] of [
            [this.el.btnZoomMoins, ZOOM_MIN, 'Réduire la partition'],
            [this.el.btnZoomPlus, ZOOM_MAX, 'Agrandir la partition'],
        ]) {
            if (!bouton) continue;
            bouton.disabled = this.interligne === borne;
            bouton.title = `${libelle} (${cran + 1} / ${crans + 1})`;
            bouton.setAttribute('aria-label', bouton.title);
        }
    }

    construireBoutonsMesuresLigne() {
        const hote = this.el.boutonsMesuresLigneHote;
        hote.innerHTML = '';
        const valeurs = [0, 2, 3, 4, 6, 8];   // 0 = Auto, comme l'ancien <select>
        this.boutonsMesuresLigne = valeurs.map((valeur) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn-mesures-ligne';
            b.textContent = valeur === 0 ? 'Auto' : String(valeur);
            b.title = valeur === 0
                ? 'Mesures par ligne : automatique (autant que la largeur le permet)'
                : `${valeur} mesures par ligne, quelle que soit la largeur de l'écran (défiler pour voir la suite)`;
            b.setAttribute('aria-label', b.title);
            b.addEventListener('click', () => {
                this.mesuresParLigne = valeur;
                localStorage.setItem(CLE_MESURES_LIGNE, String(this.mesuresParLigne));
                this.rafraichirBoutonsMesuresLigne();
                // Un choix fait referme le popover derrière lui (téléphone) — sans effet sur grand
                // écran, où le groupe n'est jamais ouvert (voir basculerGroupeMesuresLigne). Même
                // geste que le popover Effets après avoir choisi un effet.
                this.fermerGroupeMesuresLigne();
                this.dessiner();
                this.el.zone.focus();
            });
            hote.appendChild(b);
            return { valeur, el: b };
        });
        this.rafraichirBoutonsMesuresLigne();
    }

    rafraichirBoutonsMesuresLigne() {
        for (const { valeur, el } of this.boutonsMesuresLigne) el.classList.toggle('actif', valeur === this.mesuresParLigne);
        // Le bouton replié (téléphone, voir basculerGroupeMesuresLigne) montre lui-même la valeur
        // active — jamais un simple libellé figé « Mesures » — pour que l'état reste lisible sans
        // ouvrir le popover, exactement ce que .actif fait déjà pour le bouton « Effets ».
        const bascule = this.el.btnMesuresLigneBascule;
        if (!bascule) return;
        bascule.textContent = this.mesuresParLigne === 0 ? 'Auto' : String(this.mesuresParLigne);
        bascule.title = this.mesuresParLigne === 0
            ? 'Mesures par ligne : automatique — touchez pour changer'
            : `Mesures par ligne : ${this.mesuresParLigne} — touchez pour changer`;
        bascule.setAttribute('aria-label', bascule.title);
    }

    rafraichirInfos() {
        const c = this.editeur.curseur;
        const total = this.editeur.partition.mesures.length;
        this.el.position.innerHTML = `Mesure <strong>${c.mesure + 1}</strong> / <strong>${total}</strong>`;

        // CE QUE DIT ENCORE LA BARRE DU BAS : la hauteur réellement sonnée par la note sous le
        // curseur, et l'état de la mesure. C'est le seul endroit où la note se lit en clair — la
        // tablature dit « case 7 », pas « si ».
        //
        // PLUS « CORDE N » (retour utilisateur : « supprimer l'indication qui me dit sur quelle corde
        // je suis positionné »). Le curseur la montre déjà, d'un soulignement franc sur la corde
        // visée — la relire en mots dans un coin de l'écran n'apprenait rien que l'œil n'ait sous les
        // yeux, et occupait une place que l'étiquette « Affichage » sert mieux. Le repère chiffré
        // reste sur le PAVÉ TACTILE (voir ui/pave.js, .etat-pave), où il a une autre raison d'être :
        // au doigt, les flèches haut/bas agiraient sinon à l'aveugle.
        const note = this.editeur.noteCourante();
        // La voix ne s'affiche QUE quand la mesure en a deux — sur la mesure du commun des cas
        // (une seule voix), le mentionner serait du bruit sans rien apprendre à personne.
        const bouts = [];
        if (this.editeur.nbVoixMesure() > 1) bouts.push(`Voix ${c.voix + 1} (${c.voix === 0 ? 'mélodie' : 'accompagnement'})`);
        if (note) {
            const midi = hauteurDeNote(this.editeur.partition, note);
            if (midi != null) bouts.push(`case ${note.frette} · ${nomDeHauteur(midi)}`);
        }
        const ecart = this.editeur.ecartMesure();
        if (Math.abs(ecart) > 1e-9) {
            bouts.push(ecart < 0 ? `mesure incomplète (${arrondi(-ecart)} ♩ manquante(s))` : `mesure trop pleine (+${arrondi(ecart)} ♩)`);
        }
        this.el.selection.textContent = bouts.join(' · ');
    }

    // ==========================================================================================
    // Transport
    // ==========================================================================================

    async lectureAlternee() {
        try {
            if (this.lecteur.etat === 'lecture') { this.lecteur.pause(); }
            else if (this.lecteur.etat === 'pause') { await this.lecteur.jouer(this.editeur.partition); }
            else {
                // Lancer DEPUIS LE CURSEUR plutôt que du début : quand on retouche la mesure 14, on
                // veut réentendre la mesure 14, pas les treize précédentes à chaque essai — SAUF si
                // une boucle est active et que le curseur est resté en dehors : la lecture partirait
                // sinon d'un endroit que la boucle ne traverse peut-être jamais (voir
                // positionDeDepartLecture).
                await this.lecteur.jouer(this.editeur.partition, this.positionDeDepartLecture());
            }
        } catch (err) {
            this.message(err.message || 'Impossible de démarrer l\'audio');
        }
        this.rafraichirTransport();
        this.dessiner();
    }

    arreter() {
        this.lecteur.arreter();
        this.rafraichirTransport();
        this.dessiner();
    }

    /**
     * Position du curseur en noires depuis le début du morceau — pour lancer la lecture depuis là.
     * Le temps GLOBAL avance mesure par mesure d'après la CAPACITÉ déclarée (comme `aplatir`), pas
     * d'après la voix particulière où se trouve le curseur : sinon reprendre la lecture depuis la
     * voix 2 d'une mesure encore incomplète décalerait tout ce qui suit.
     */
    positionDuCurseurEnNoires() {
        const c = this.editeur.curseur;
        return positionDebutMesure(this.editeur.partition, c.mesure)
            + positionDansMesure(this.editeur.partition.mesures[c.mesure], c.evenement, c.voix);
    }

    /**
     * D'où repartir quand on relance depuis l'arrêt : TOUJOURS le tout début du morceau — SAUF si
     * une boucle de lecture est active, auquel cas on repart directement du début de LA BOUCLE, où
     * que soit le curseur (retour utilisateur : « la lecture devrait se lancer toujours depuis le
     * début, sauf si j'ai mis en place une barre orange »).
     *
     * Une version antérieure repartait du CURSEUR par défaut (pour réentendre la mesure qu'on venait
     * de retoucher sans tout réécouter depuis le début à chaque essai), le début de la boucle ne
     * servant que de filet quand le curseur restait en dehors d'elle. L'usage réel s'est révélé
     * l'inverse : la lecture COMPLÈTE est ce qu'on attend par défaut, la boucle étant déjà l'outil
     * dédié à « rejouer UN passage précis » — le curseur n'a donc plus à jouer ce rôle en double,
     * de façon moins prévisible (sa position dépendait de la dernière case éditée ou cliquée).
     */
    positionDeDepartLecture() {
        // `bornesBoucle` et non le début de la mesure d'ancrage : une boucle peut commencer EN COURS
        // de mesure depuis qu'elle se cale au temps (voir player.js#bornesBoucle). Repartir du début
        // de la mesure ferait entendre, au tout premier tour, un fragment que la boucle exclut —
        // puis plus jamais, ce qui est la pire façon de se tromper : inaudible à la relecture.
        const bornes = this.lecteur.bornesBoucle?.(this.editeur.partition);
        if (bornes) return bornes.debut;
        return 0;
    }

    rafraichirTransport() {
        const btn = document.getElementById('btn-jouer');
        const enLecture = this.lecteur.etat === 'lecture';
        btn.innerHTML = icone(enLecture ? 'pause' : 'lecture');
        btn.title = enLecture ? 'Pause (Espace)' : 'Lecture (Espace)';
        btn.setAttribute('aria-label', btn.title);
        this.rafraichirFlechesTransport?.();
    }

    /**
     * Flèches de défilement de la barre de transport — même remède que la barre d'outils (voir
     * ui/toolbar.js#flecheOutilsSvg, exporté pour ça) : `overflow-x: auto` (voir .transport dans
     * style.css) rendait déjà Métronome ATTEIGNABLE sur un téléphone étroit, mais rien ne le
     * montrait — mesuré : 180px de débordement à 390px, les DEUX boutons Métronome entièrement
     * hors champ, sans la moindre flèche pour le suggérer (contrairement à la barre d'outils, qui
     * avait déjà reçu ce traitement). Posées UNE FOIS ici plutôt que reconstruites à chaque
     * rafraîchissement — .transport ne gagne ni ne perd de boutons en cours de route, à la
     * différence de la barre d'outils (groupe Effets qui s'ouvre/referme).
     */
    brancherFlechesTransport() {
        const hote = document.querySelector('.transport');
        const PAS_DEFILEMENT = 160;
        const fleche = (sens) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `fleche-outils fleche-outils-${sens}`;
            b.innerHTML = flecheOutilsSvg(sens);
            b.title = sens === 'gauche' ? 'Défiler la barre de transport vers la gauche' : 'Défiler la barre de transport vers la droite';
            b.setAttribute('aria-label', b.title);
            b.addEventListener('click', () => hote.scrollBy({ left: sens === 'gauche' ? -PAS_DEFILEMENT : PAS_DEFILEMENT, behavior: 'smooth' }));
            return b;
        };
        const flecheGauche = fleche('gauche');
        const flecheDroite = fleche('droite');
        hote.insertBefore(flecheGauche, hote.firstChild);
        hote.appendChild(flecheDroite);
        // Même règle que la barre d'outils, au même endroit qu'elle (voir toolbar.js#ajusterFleches) :
        // les flèches étant en flux, mesurer le débordement sans les déduire revient à se mesurer
        // soi-même — et laisse une flèche allumée sur rien après un élargissement de la fenêtre.
        const rafraichirFleches = () => ajusterFleches(hote, flecheGauche, flecheDroite);
        rafraichirFleches();
        hote.addEventListener('scroll', rafraichirFleches, { passive: true });
        return rafraichirFleches;
    }

    // ==========================================================================================
    // Fichiers
    // ==========================================================================================

    /**
     * Enregistrer, au sens de HarmoHub : une persistance LOCALE explicite (le brouillon dans le
     * navigateur), distincte d'Exporter (un fichier .json portable, voir `exporterJson`). Le
     * brouillon s'écrit déjà tout seul, en continu (voir `planifierBrouillon`) — cette version
     * explicite n'écrit rien de plus, elle écrit MAINTENANT, sans attendre le débit habituel, et le
     * confirme par un message : le geste de HarmoHub, transposé à une appli sans serveur.
     */
    enregistrer() {
        clearTimeout(this._minuterieBrouillon);
        const err = this._ecrireBrouillon();
        // AVANT le message, et seulement si le brouillon a réussi : annoncer « Enregistré » alors que
        // rien n'a pu s'écrire serait le pire des deux mondes. Une version qui échoue, elle, reste
        // muette — c'est un confort (voir io/versions.js), le brouillon est la vraie sauvegarde.
        if (!err) this._archiverVersion();
        this.message(err ? 'Échec de l\'enregistrement local : ' + err.message : 'Enregistré');
    }

    // ==========================================================================================
    // Aide rythmique (voir ui/rythme.js)
    // ==========================================================================================

    /**
     * Ouvre l'aide rythmique, réglée pour insérer À PARTIR de `mesureDepart`.
     *
     * L'ENDROIT EST DÉJÀ CHOISI quand on arrive ici : la fenêtre s'ouvre depuis le menu contextuel,
     * donc d'un clic droit ou d'un appui long sur la mesure visée (retour utilisateur : « je dois
     * pouvoir choisir où l'insérer [...] le placer à la souris ou au doigt »). Rien à régler dans la
     * fenêtre pour cela — elle rappelle seulement où elle va écrire.
     *
     * LA SIGNATURE VIENT DU MORCEAU, jamais de la fenêtre : un rythme dessiné dans une autre mesure
     * que celle qui l'accueillera ne voudrait rien dire.
     */
    ouvrirAideRythme(mesureDepart = this.editeur.curseur.mesure) {
        const partition = this.editeur.partition;
        this._rythme = {
            depart: Math.max(0, Math.min(partition.mesures.length - 1, mesureDepart)),
            signature: { ...signatureEffective(partition, mesureDepart) },
            nMesures: 1,
            sub: 4,
            boucle: false,
        };
        this._rythme.etat = Rythme.etatInitial(1, this._rythme.signature);
        this.construireCommandesRythme();
        this.rebatirGrilleRythme();
        this.ouvrirFenetre('fenetre-rythme');
    }

    /** Les trois commandes de la ligne du haut, reconstruites ensemble : elles se contraignent l'une
     *  l'autre (la longueur borne le départ, et réciproquement), donc les tenir à jour séparément
     *  finirait par en laisser une en arrière. */
    construireCommandesRythme() {
        this.construireDepartRythme();
        this.construireBoutonsNbMesuresRythme();
        this.construireSubdivisionRythme();
    }

    /**
     * LA MESURE DE DÉPART, en pas-à-pas.
     *
     * POURQUOI ELLE SE CHOISIT ICI. L'endroit venait du geste qui ouvrait la fenêtre — un clic droit
     * sur la mesure visée — et ne se changeait plus ensuite. Retour utilisateur : « je dois pouvoir
     * choisir la ou les mesures dans lesquelles ces rythmes interviennent, AVANT de placer les notes
     * dedans ». Le clic droit reste le raccourci qui pré-remplit ; la fenêtre laisse corriger.
     *
     * UN PAS-À-PAS ET NON UNE RANGÉE DE BOUTONS, contrairement à la longueur : un morceau peut avoir
     * cent mesures, et cent boutons ne tiennent pas dans une fenêtre.
     */
    construireDepartRythme() {
        const hote = document.getElementById('rythme-depart');
        if (!hote || !this._rythme) return;
        const total = this.editeur.partition.mesures.length;
        // LE DÉPART EST BORNÉ PAR LA LONGUEUR : un rythme de trois mesures ne peut pas commencer à
        // l'avant-dernière, il n'y aurait pas de place pour l'accueillir.
        const max = Math.max(0, total - this._rythme.nMesures);
        this._rythme.depart = Math.max(0, Math.min(max, this._rythme.depart));
        hote.innerHTML = '';
        const pas = (sens, libelle, titre) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn-mesures-ligne';
            b.textContent = libelle;
            b.title = titre;
            b.setAttribute('aria-label', titre);
            b.disabled = sens < 0 ? this._rythme.depart <= 0 : this._rythme.depart >= max;
            b.addEventListener('click', () => {
                this._rythme.depart = Math.max(0, Math.min(max, this._rythme.depart + sens));
                // LA SIGNATURE SUIT LA MESURE VISÉE : un rythme dessiné en 4/4 puis déposé dans une
                // mesure en 3/4 ne voudrait rien dire. Elle change donc la grille, qui repart neuve.
                const sig = signatureEffective(this.editeur.partition, this._rythme.depart);
                if (sig.battements !== this._rythme.signature.battements
                    || sig.unite !== this._rythme.signature.unite) {
                    this._rythme.signature = { ...sig };
                    this._rythme.etat = Rythme.etatInitial(this._rythme.nMesures, this._rythme.signature);
                    Rythme.changerSubdivisionGlobale(this._rythme.etat, this._rythme.sub);
                    this.construireCommandesRythme();
                    this.rebatirGrilleRythme();
                    return;
                }
                this.construireDepartRythme();
                this.rafraichirApercuRythme();
            });
            return b;
        };
        const valeur = document.createElement('span');
        valeur.className = 'valeur-pas';
        valeur.setAttribute('aria-live', 'polite');
        valeur.textContent = String(this._rythme.depart + 1);
        hote.append(pas(-1, '◀', 'Mesure précédente'), valeur, pas(1, '▶', 'Mesure suivante'));
    }

    /** Les boutons « 1 2 3 4 » du nombre de mesures. Quatre au plus, comme demandé : au-delà, la
     *  grille ne tient plus à l'écran et l'aide cesse d'aider. */
    construireBoutonsNbMesuresRythme() {
        const hote = document.getElementById('rythme-nb-mesures');
        if (!hote || !this._rythme) return;
        const total = this.editeur.partition.mesures.length;
        hote.innerHTML = '';
        for (let n = 1; n <= 4; n++) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn-mesures-ligne' + (n === this._rythme.nMesures ? ' actif' : '');
            b.textContent = String(n);
            b.title = `${n} mesure${n > 1 ? 's' : ''} de rythme`;
            b.setAttribute('aria-label', b.title);
            // Une longueur qui ne tient pas dans ce qui reste du morceau est ÉTEINTE plutôt que
            // silencieusement ramenée : on voit pourquoi on ne peut pas la choisir.
            b.disabled = n > total;
            b.addEventListener('click', () => {
                if (n === this._rythme.nMesures) return;
                // ON REPART D'UNE GRILLE NEUVE : étendre une grille existante demanderait de décider
                // ce que deviennent les temps déjà remplis, et toute réponse serait une surprise.
                this._rythme.nMesures = n;
                this._rythme.depart = Math.max(0, Math.min(total - n, this._rythme.depart));
                this._rythme.etat = Rythme.etatInitial(n, this._rythme.signature);
                Rythme.changerSubdivisionGlobale(this._rythme.etat, this._rythme.sub);
                this.construireCommandesRythme();
                this.rebatirGrilleRythme();
            });
            hote.appendChild(b);
        }
    }

    /**
     * BINAIRE OU TERNAIRE, pour toute la grille.
     *
     * DEUX BOUTONS, PAS TROIS, et c'est le fond de l'affaire. Le réglage était par temps, à faire
     * défiler en cliquant un « 4 » posé au-dessus de chaque temps — illisible (retour utilisateur :
     * « je n'ai pas besoin du "4" noté juste au-dessus des barres », et « j'ai l'impression que cet
     * outil est incohérent »). Il proposait 4, 3 et 2 ; or une grille en 2 produit une écriture
     * RIGOUREUSEMENT identique à une grille en 4 — ce n'était pas un choix musical (voir
     * model/rythme.js#SUBDIVISIONS). Reste la seule vraie question : moitiés ou tiers.
     */
    construireSubdivisionRythme() {
        const hote = document.getElementById('rythme-subdivision');
        if (!hote || !this._rythme) return;
        const LIBELLES = {
            4: { texte: 'Binaire', titre: 'Chaque temps en quatre doubles-croches' },
            3: { texte: 'Ternaire', titre: 'Chaque temps en trois croches de triolet' },
        };
        hote.innerHTML = '';
        for (const sub of Rythme.SUBDIVISIONS) {
            const actif = sub === this._rythme.sub;
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn-mesures-ligne' + (actif ? ' actif' : '');
            b.textContent = LIBELLES[sub].texte;
            b.title = LIBELLES[sub].titre;
            b.setAttribute('role', 'radio');
            b.setAttribute('aria-checked', String(actif));
            b.dataset.sub = String(sub);
            b.addEventListener('click', () => {
                if (sub === this._rythme.sub) return;
                this._rythme.sub = sub;
                Rythme.changerSubdivisionGlobale(this._rythme.etat, sub);
                this.construireSubdivisionRythme();
                this.rebatirGrilleRythme();
            });
            hote.appendChild(b);
        }
    }

    /** Rebâtit la grille et l'aperçu — après tout changement de STRUCTURE (nombre de mesures,
     *  subdivision, signature). Un simple changement de contenu passe par `rafraichirApercuRythme`,
     *  qui ne touche pas au DOM des cases. */
    rebatirGrilleRythme() {
        if (!this._rythme) return;
        this._rythme.grille = Rythme.construireGrille(
            document.getElementById('grille-rythme'), this._rythme.etat,
            { surChangement: () => this.rafraichirApercuRythme() });
        this.rafraichirApercuRythme();
    }

    /** Redessine l'écriture proposée, rappelle où l'insertion ira, et — si la boucle tourne —
     *  reprogramme le son sans l'interrompre. */
    rafraichirApercuRythme() {
        if (!this._rythme) return;
        const hote = document.getElementById('apercu-rythme');
        const largeur = Math.max(320, (hote?.clientWidth || 640) - 12);
        // LA PARTITION ENTIÈRE et non son seul instrument : l'aperçu y prend l'accordage, le capo et
        // la TONIQUE du morceau (voir model/rythme.js#partitionApercu et #caseDeLaTonique).
        this._rythme.page = Rythme.dessinerApercu(
            hote, this._rythme.etat, this.editeur.partition,
            this.editeur.partition.meta.ternaire, largeur);
        const cible = document.getElementById('rythme-cible');
        if (cible) {
            const d = this._rythme.depart + 1;
            const f = this._rythme.depart + this._rythme.nMesures;
            cible.textContent = d === f ? `remplacera la mesure ${d}` : `remplacera les mesures ${d} à ${f}`;
        }
        const inserer = document.getElementById('btn-rythme-inserer');
        // Un rythme vide n'a rien à insérer : le bouton le dit avant d'être cliqué, plutôt que de
        // poser quatre mesures de silence à qui a cliqué sans le vouloir.
        if (inserer) inserer.disabled = Rythme.estVide(this._rythme.etat);
        this.reprogrammerBoucleRythme();
    }

    // ------------------------------------------------------------------------------------------
    // LA BOUCLE DU SÉQUENCEUR — « une lecture en boucle qui suit exactement les modifications
    // en direct » (retour utilisateur).
    //
    // TOUT EST DÉJÀ LÀ, et c'est pourquoi ce bloc est court : le lecteur sait reprogrammer un
    // transport EN COURS sans le couper (`reprogrammerSiEnCours`, écrit pour que tirer le curseur de
    // tempo ou déplacer une note pendant la lecture ne fasse pas de trou), et il sait boucler sur un
    // intervalle de mesures (`definirBoucle`). La partition d'aperçu EST une partition : le lecteur
    // en prend une, sans rien de spécial.
    // ------------------------------------------------------------------------------------------

    /** La partition jetable que la boucle fait sonner — la MÊME que celle de l'aperçu, donc ce qu'on
     *  entend est exactement ce qu'on lit. */
    partitionRythme() {
        return Rythme.partitionApercu(
            this._rythme.etat, this.editeur.partition, this.editeur.partition.meta.ternaire);
    }

    /** Démarre ou arrête la boucle. */
    async basculerBoucleRythme() {
        if (!this._rythme) return;
        if (this._rythme.boucle) { this.arreterBoucleRythme(); return; }
        try {
            // L'AUDIO EST PRÉPARÉ AVANT QU'ON TOUCHE AU TRANSPORT, et cet ordre n'est pas
            // cosmétique : c'est ce qui rend le premier clic sonore.
            //
            // LE DÉFAUT, mesuré, et il est ANTÉRIEUR à cette fenêtre — l'ancien bouton « Écouter »
            // faisait `arreter()` puis `jouer()` et était donc muet au premier clic de la session.
            // `jouer()` commence par `await demarrer()`, la mise en place audio, qui ne se fait
            // qu'UNE fois. Quand cette mise en place a lieu APRÈS un arrêt du transport, le
            // `Transport.start()` qui la suit ne prend pas : les tics restent à zéro et
            // `Transport.state` reste « stopped », sans qu'aucun `stop()` ni `pause()` de plus
            // n'ait lieu (vérifié en piégeant les deux, ainsi que `Lecteur.arreter`). Les quatre
            // combinaisons mesurées le disent sans ambiguïté : `arreter()` + `Transport.start()`
            // brut fonctionne, `Transport.stop()` + `jouer()` échoue, et `demarrer()` + `arreter()`
            // + `jouer()` fonctionne. C'est donc bien la mise en place, pas l'arrêt, qui perd le
            // départ — d'où cette ligne, et non une attente arbitraire.
            await this.lecteur.demarrer();
            const p = this.partitionRythme();
            this.lecteur.arreter();
            this._rythme.boucle = true;
            this.majBoutonBoucleRythme();
            // LA TÊTE DE LECTURE SUIT LE TRANSPORT, pas une horloge à nous : `surPosition` est
            // notifié par le lecteur lui-même, donc la colonne allumée ne peut pas dériver de ce
            // qu'on entend. Le désabonnement est gardé pour la fermeture de la fenêtre.
            this._rythme.detacherTete = this.lecteur.surPosition((position, etat) => {
                if (!this._rythme) return;
                this._rythme.grille?.poserTete(etat === 'lecture' ? position : null);
            });
            await this.lecteur.jouer(p, 0);
            this.lecteur.definirBoucle(p, 0, Math.max(0, p.mesures.length - 1));
        } catch (err) {
            this.arreterBoucleRythme();
            this.message(err.message || 'Impossible de démarrer l\'audio');
        }
    }

    /** Arrête la boucle et éteint la tête de lecture. */
    arreterBoucleRythme() {
        if (!this._rythme) return;
        this._rythme.boucle = false;
        this._rythme.detacherTete?.();
        this._rythme.detacherTete = null;
        this.lecteur.arreter();
        // LA BOUCLE DU SÉQUENCEUR N'EST PAS CELLE DE LA PARTITION : on la retire en partant, sinon
        // la prochaine lecture du morceau tournerait en rond sur ses deux premières mesures.
        this.lecteur.definirBoucle(this.editeur.partition, null, null);
        this._rythme.grille?.poserTete(null);
        this.majBoutonBoucleRythme();
    }

    /** Le bouton dit ce qu'il fera au prochain clic, et son état est lisible par un lecteur d'écran. */
    majBoutonBoucleRythme() {
        const b = document.getElementById('btn-rythme-boucle');
        if (!b || !this._rythme) return;
        b.textContent = this._rythme.boucle ? 'Arrêter' : 'Boucler';
        b.classList.toggle('actif', this._rythme.boucle);
        b.setAttribute('aria-pressed', String(this._rythme.boucle));
    }

    /** Pousse le rythme courant dans le transport EN COURS — appelé après chaque modification.
     *  C'est cette ligne qui fait que la boucle « suit les modifications en direct ». */
    reprogrammerBoucleRythme() {
        if (!this._rythme?.boucle) return;
        const p = this.partitionRythme();
        this.lecteur.definirBoucle(p, 0, Math.max(0, p.mesures.length - 1));
        this.lecteur.reprogrammerSiEnCours(p);
    }

    /** Insère le rythme dessiné dans la partition, en cases à remplir. */
    insererRythme() {
        if (!this._rythme || Rythme.estVide(this._rythme.etat)) return;
        const parMesure = Rythme.evenementsParMesure(this._rythme.etat, { aRemplir: true, avecNotes: false });
        const ok = this.editeur.remplacerMesuresPar(this._rythme.depart, parMesure, this._rythme.signature);
        if (!ok) {
            this.message(this.editeur.derniereErreur || 'Insertion impossible');
            this.editeur.derniereErreur = null;
            return;
        }
        this.lecteur.arreter();
        this.fermerFenetres();
        const n = parMesure.length;
        this.message(`Rythme inséré sur ${n} mesure${n > 1 ? 's' : ''} — choisissez les cases en surbrillance`, 5000);
    }

    /**
     * Ouvre la fenêtre des versions, liste remplie à l'ouverture — pas maintenue en direct : elle ne
     * change qu'au moment où on la regarde, et une liste reconstruite à l'ouverture ne peut pas
     * afficher un état périmé.
     */
    ouvrirVersions() {
        this.remplirListeVersions();
        this.ouvrirFenetre('fenetre-versions');
    }

    /**
     * La liste des versions. UNE LIGNE = un état, avec sa date en clair, son titre et sa taille ; et
     * DEUX gestes seulement — revenir dessus, ou la jeter.
     *
     * LA DATE EN LANGAGE ORDINAIRE (« hier à 14:05 », voir io/versions.js#daterVersion) : c'est le
     * seul repère utile pour choisir une version, et un horodatage ISO obligerait à calculer.
     *
     * LA LISTE VIDE A SON PROPRE TEXTE plutôt qu'un cadre blanc : une fenêtre qui ne dit rien laisse
     * croire à une panne, alors que « aucune version pour l'instant » est un état normal — c'est
     * même l'état de départ.
     */
    remplirListeVersions() {
        const hote = document.getElementById('liste-versions');
        if (!hote) return;
        hote.innerHTML = '';
        if (!this.versionsActives) {
            hote.innerHTML = '<p class="liste-vide">L\'historique des versions est éteint. '
                + 'Réglages &gt; Fichiers permet de le rallumer.</p>';
            return;
        }
        const versions = lireVersions();
        if (versions.length === 0) {
            hote.innerHTML = '<p class="liste-vide">Aucune version pour l\'instant. '
                + 'La première sera posée au prochain enregistrement.</p>';
            return;
        }
        versions.forEach((v, i) => {
            const ligne = document.createElement('div');
            ligne.className = 'ligne-version';
            ligne.setAttribute('role', 'listitem');
            ligne.dataset.version = v.id;

            const texte = document.createElement('div');
            texte.className = 'version-texte';
            const quand = document.createElement('span');
            quand.className = 'version-date';
            // « (actuelle) » sur la plus récente : sans ce repère, la première ligne se confond avec
            // le morceau ouvert, et on restaure ce qu'on a déjà sous les yeux.
            quand.textContent = daterVersion(v.date) + (i === 0 ? ' — la plus récente' : '');
            const quoi = document.createElement('span');
            quoi.className = 'version-detail';
            const titre = v.titre || 'Sans titre';
            quoi.textContent = `${titre}${v.artiste ? ' — ' + v.artiste : ''} · ${v.mesures} mesure${v.mesures > 1 ? 's' : ''}`
                + ` · ${v.notes} note${v.notes > 1 ? 's' : ''}`;
            texte.append(quand, quoi);

            const revenir = document.createElement('button');
            revenir.type = 'button';
            revenir.className = 'btn-neutre';
            revenir.textContent = 'Revenir à cet état';
            revenir.addEventListener('click', () => this.restaurerVersion(v.id));

            const jeter = document.createElement('button');
            jeter.type = 'button';
            jeter.className = 'btn-icone';
            jeter.title = 'Supprimer cette version';
            jeter.setAttribute('aria-label', jeter.title);
            jeter.innerHTML = icone('poubelle');
            jeter.addEventListener('click', () => this.supprimerUneVersion(v.id));

            ligne.append(texte, revenir, jeter);
            hote.appendChild(ligne);
        });
    }

    /**
     * Revient à une version. C'EST UN REMPLACEMENT COMME UN AUTRE : le garde-fou s'applique donc (le
     * morceau ouvert peut ne pas être exporté), et l'état qu'on quitte est lui-même archivé — sans
     * quoi « revenir en arrière » serait un aller simple, et se tromper de ligne coûterait le travail
     * en cours. Pas de question d'écrasement ici : ce n'est pas un import (voir
     * _archiverAvantRemplacement).
     *
     * LE PASSAGE PAR `remplacer` (donc par `normaliser`) et non une assignation : une version écrite
     * par une release antérieure peut manquer un champ ajouté depuis. C'est la même règle qu'à
     * l'ouverture d'un .json ou d'un brouillon.
     */
    async restaurerVersion(id) {
        const v = lireVersions().find(x => x.id === id);
        if (!v) { this.message('Cette version n\'existe plus'); this.remplirListeVersions(); return; }
        if (!(await this.peutEcraserLeMorceau('Revenir à une version précédente'))) return;
        this.arreter();
        this.editeur.remplacer(v.partition);
        this.fermerFenetres();
        this.message(`Revenu à la version de ${daterVersion(v.date)}`);
    }

    /** Jette une version, après confirmation : c'est le seul geste irréversible de cette fenêtre. */
    async supprimerUneVersion(id) {
        const v = lireVersions().find(x => x.id === id);
        if (!v) { this.remplirListeVersions(); return; }
        const choix = await demander({
            titre: 'Supprimer cette version',
            texte: `La version de ${daterVersion(v.date)}${v.titre ? ` (« ${v.titre} »)` : ''} sera `
                 + 'définitivement effacée de ce navigateur. Le morceau ouvert n\'est pas touché.',
            boutons: [
                { cle: 'annuler', libelle: 'Annuler' },
                { cle: 'supprimer', libelle: 'Supprimer', style: 'danger' },
            ],
        });
        if (choix !== 'supprimer') return;
        supprimerVersion(id);
        this.rafraichirEtatVersions();
        this.remplirListeVersions();
    }

    /**
     * Allume ou éteint l'historique. ÉTEINDRE EFFACE VRAIMENT (voir io/versions.js) — d'où la
     * confirmation, obligatoire dès qu'il y a quelque chose à perdre : c'est le seul réglage du
     * panneau qui détruit des données.
     * @returns {Promise<boolean>} l'état retenu à la sortie, pour que l'appelant recale l'interrupteur.
     */
    async basculerVersions(vers) {
        if (!vers && lireVersions().length > 0) {
            const n = lireVersions().length;
            const choix = await demander({
                titre: 'Éteindre l\'historique des versions',
                texte: `${n} version${n > 1 ? 's' : ''} enregistrée${n > 1 ? 's' : ''} `
                     + `${n > 1 ? 'seront' : 'sera'} effacée${n > 1 ? 's' : ''} de ce navigateur, et `
                     + 'TabHub cessera d\'en garder. Le morceau ouvert n\'est pas touché.',
                boutons: [
                    { cle: 'annuler', libelle: 'Annuler' },
                    { cle: 'eteindre', libelle: 'Éteindre et effacer', style: 'danger' },
                ],
            });
            if (choix !== 'eteindre') return true;
            viderVersions();
        }
        this.versionsActives = !!vers;
        localStorage.setItem(CLE_VERSIONS_ACTIVES, this.versionsActives ? '1' : '0');
        this.rafraichirEtatVersions();
        return this.versionsActives;
    }

    /** L'entrée du menu Fichiers et la ligne d'état des Réglages, recalées ensemble : deux endroits
     *  qui parlent du même historique ne doivent jamais en dire deux choses différentes. */
    rafraichirEtatVersions() {
        const entree = this.el.popoverFichiers?.querySelector('[data-action="versions"]');
        if (entree) entree.hidden = !this.versionsActives;
        const etat = document.getElementById('etat-versions');
        if (!etat) return;
        if (!this.versionsActives) { etat.textContent = 'éteint'; return; }
        const n = lireVersions().length;
        etat.textContent = n === 0 ? 'aucune version' : `${n} / ${MAX_VERSIONS}`;
    }

    /**
     * MET LE MORCEAU EN COURS DE CÔTÉ — l'unique porte d'entrée de l'historique.
     *
     * DEUX MOMENTS L'APPELLENT, et ce sont les deux seuls qui méritent une version :
     *   • un ENREGISTREMENT explicite (Ctrl+S / le bouton vert) — l'utilisateur dit « cet état
     *     compte » ;
     *   • juste avant un REMPLACEMENT (Nouveau, Ouvrir, import MIDI en remplacement, ou la
     *     restauration d'une autre version) — l'état qui va disparaître est justement celui qu'on
     *     regretterait.
     * PAS À CHAQUE FRAPPE : c'est le rôle du brouillon, qui s'écrit tout seul en continu (voir
     * _ecrireBrouillon). Dix versions pour dix frappes ne diraient rien de l'histoire du morceau.
     *
     * `archiver` refuse de lui-même une version identique à la plus récente : trois Ctrl+S d'affilée
     * sans rien changer entre deux ne font pas trois versions.
     *
     * @param {{ecraserDerniere?: boolean}} options voir io/versions.js#archiver.
     */
    _archiverVersion(options = {}) {
        if (!this.versionsActives) return false;
        const range = archiver(this.editeur.partition, options);
        if (range) this.rafraichirEtatVersions();
        return range;
    }

    /**
     * L'ÉCRITURE DU BROUILLON, EN UN SEUL ENDROIT — appelée par `enregistrer` (maintenant, à la
     * demande) comme par `planifierBrouillon` (en différé, tout seul). Les deux l'écrivaient chacune
     * de son côté ; depuis que Réglages > Fichiers en affiche l'heure, elles doivent aussi la NOTER
     * chacune, et deux copies d'un même geste finissent toujours par n'en noter qu'une.
     * @returns {Error|null} l'erreur, s'il y en a une — `enregistrer` la dit, `planifierBrouillon`
     *   l'avale : un brouillon différé qui échoue n'a pas à interrompre la frappe pour l'annoncer.
     */
    _ecrireBrouillon() {
        try {
            // TOUS LES ONGLETS DANS LE BROUILLON, pas seulement celui qu'on regarde : rouvrir
            // l'application avec un seul des trois morceaux sur lesquels on travaillait serait une
            // perte silencieuse, et c'est exactement ce que le brouillon existe pour éviter.
            // L'onglet ACTIF est lu dans l'éditeur (la vérité y est), les autres dans leur état
            // rangé — la même règle que titresOnglets.
            //
            // L'historique d'annulation n'y va PAS, comme il n'y allait pas avant : un Ctrl+Z qui
            // traverserait un rechargement de navigateur n'a jamais été promis, et les piles pèsent
            // une copie complète de la partition chacune.
            localStorage.setItem(CLE_BROUILLON, JSON.stringify({
                v: 2,
                actif: this.ongletActif,
                onglets: this.onglets.map((o, i) => (i === this.ongletActif ? this.editeur.partition : o.etat?.partition)).filter(Boolean),
            }));
            this._brouillonEcritLe = new Date();
            this.rafraichirEtatBrouillon();
            return null;
        } catch (err) {
            // Quota plein ou stockage refusé : le brouillon est un confort, pas une garantie. L'état
            // affiché le dit alors franchement, plutôt que de laisser une heure périmée faire croire
            // à une sauvegarde qui n'a pas eu lieu.
            this._brouillonEnEchec = true;
            this.rafraichirEtatBrouillon();
            return err;
        }
    }

    /**
     * La ligne « Enregistrement automatique » de Réglages > Fichiers (voir index.html).
     *
     * UNE INDICATION, PAS UNE COMMANDE. Le brouillon n'a jamais eu d'interrupteur, et c'était juste :
     * un réglage qui ne sert qu'à empêcher l'appli de sauvegarder pour vous coûte plus d'attention
     * qu'il n'en fait gagner. Mais l'absence de réglage laissait la question sans réponse — « mon
     * travail est-il gardé quelque part ? » — et un panneau de réglages est l'endroit où on va la
     * poser. L'heure y répond sans rien demander.
     */
    rafraichirEtatBrouillon() {
        const el = document.getElementById('etat-brouillon');
        if (!el) return;
        if (this._brouillonEnEchec) { el.textContent = 'indisponible'; el.classList.add('valeur-etat-alerte'); return; }
        el.classList.remove('valeur-etat-alerte');
        if (!this._brouillonEcritLe) { el.textContent = 'activé'; return; }
        // L'heure, pas un « il y a 3 minutes » : un compte relatif se périme dès qu'on le lit, et il
        // faudrait une minuterie pour le tenir à jour pendant que le panneau reste ouvert.
        el.textContent = 'activé — ' + this._brouillonEcritLe.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }

    /** Exporter : un fichier .json portable, téléchargé — l'ancien sens d'« Enregistrer ». */
    exporterJson() {
        try {
            const nom = enregistrerPartition(this.editeur.partition);
            // LE SEUL EXPORT QUI COMPTE COMME UNE MISE À L'ABRI, et il faut être précis là-dessus :
            // le .json est le modèle tel quel, donc le seul fichier que TabHub sait ROUVRIR. Un PDF
            // et un .mid sont des sorties — le premier ne se réimporte pas du tout, le second perd
            // les doigtés, les effets et la tablature. Les compter ici donnerait une fausse
            // assurance : « c'est exporté » alors que le travail n'est pas récupérable.
            this.travailExporte = true;
            this.message(`Exporté → ${nom}`);
        } catch (err) {
            this.message('Échec de l\'export : ' + err.message);
        }
    }

    /** Importer : ouvrir un fichier .json depuis le disque — l'ancien « Ouvrir ». */
    ouvrir() { this.el.entreeFichier.click(); }

    async chargerFichier(fichier) {
        try {
            const partition = await lireFichierPartition(fichier);
            // MÊME GARDE-FOU QUE « NOUVEAU », et pour la même raison : ouvrir un fichier REMPLACE le
            // morceau en cours et écrase le brouillon du navigateur. Ce geste-là n'avertissait de
            // rien du tout, alors que « Nouveau » posait au moins un confirm() — deux gestes aussi
            // destructeurs l'un que l'autre, deux traitements différents. Voir peutEcraserLeMorceau.
            // APRÈS la lecture du fichier : inutile de poser la question si le fichier est illisible.
            if (!(await this.peutEcraserLeMorceau('Ouvrir un fichier', { demanderVersion: true }))) return;
            this.arreter();
            this.editeur.remplacer(partition);
            this.message(`Importé : ${partition.meta.titre}`);
        } catch (err) {
            this.message(err.message || 'Impossible d\'ouvrir ce fichier');
        }
    }

    /**
     * « Exporter PDF » N'EXPORTE PLUS DIRECTEMENT : il ouvre l'aperçu (retour utilisateur : « me
     * montrer la mise en page avant d'enregistrer le PDF »). L'enregistrement se fait depuis la
     * fenêtre, au bouton « Enregistrer le PDF » — voir ouvrirApercuPdf et enregistrerPdf.
     * Le raccourci Ctrl+P passe par ici aussi : un aperçu que le clavier contournerait serait un
     * aperçu qu'on oublie d'avoir.
     */
    exporterPdf() { this.ouvrirApercuPdf(); }

    /** Les réglages de mise en page en vigueur, complétés par les valeurs d'origine. */
    _optionsPdf() {
        return {
            format: 'a4', marges: 'normales', mesuresParLigne: 0,
            interligne: BORNES_PDF.interligne.defaut,
            ecartSystemes: BORNES_PDF.ecartSystemes.defaut,
            echelleEnTete: BORNES_PDF.echelleEnTete.defaut,
            ...(this._pdf || {}),
            // TAB seule (voir appliquerTabSeule) : le PDF suit le même réglage que l'écran — sans
            // effet au piano, comme sur l'écran (mettreEnPagePiano ne lit jamais cette option). Ce
            // n'est PAS un réglage de cette fenêtre : c'en serait un second accès, et l'aperçu le
            // montre déjà tel qu'il est.
            avecPortee: !this.tabSeule,
        };
    }

    /**
     * L'APERÇU AVANT EXPORT. Voir #fenetre-pdf dans index.html, qui porte le pourquoi.
     *
     * Les réglages sont RELUS du stockage à chaque ouverture plutôt que gardés en mémoire vive :
     * une fenêtre de mise en page dont les choix s'oublient au rechargement ferait refaire six
     * réglages à chaque session, pour un morceau qui n'a pas changé de longueur entre-temps.
     */
    ouvrirApercuPdf() {
        try { this._pdf = JSON.parse(localStorage.getItem(CLE_PDF)) || {}; }
        catch (err) { this._pdf = {}; }
        this._pdfPage = 0;

        const sel = (id) => document.getElementById(id);
        const o = this._optionsPdf();

        sel('pdf-format').innerHTML = Object.entries(FORMATS)
            .map(([id, f]) => `<option value="${id}"${id === o.format ? ' selected' : ''}>${f.nom}</option>`).join('');
        sel('pdf-marges').innerHTML = Object.entries(JEUX_MARGES)
            .map(([id, m]) => `<option value="${id}"${id === o.marges ? ' selected' : ''}>${m.nom}</option>`).join('');
        // « Auto » vaut 0 et non `null` dans la liste : la valeur d'un <option> est toujours une
        // chaîne, et `parseInt('') `donnerait NaN. preparerPdf retraduit 0 en `null` (mode glouton).
        sel('pdf-mesures-ligne').innerHTML = ['<option value="0">Auto</option>']
            .concat([1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option value="${n}">${n}</option>`)).join('');
        sel('pdf-mesures-ligne').value = String(o.mesuresParLigne || 0);

        for (const [id, cle] of [['pdf-interligne', 'interligne'], ['pdf-ecart', 'ecartSystemes'], ['pdf-titres', 'echelleEnTete']]) {
            const b = BORNES_PDF[cle], r = sel(id);
            r.min = b.min; r.max = b.max; r.step = b.pas; r.value = o[cle];
        }

        const lire = () => {
            this._pdf = {
                format: sel('pdf-format').value,
                marges: sel('pdf-marges').value,
                mesuresParLigne: parseInt(sel('pdf-mesures-ligne').value, 10) || 0,
                interligne: parseFloat(sel('pdf-interligne').value),
                ecartSystemes: parseFloat(sel('pdf-ecart').value),
                echelleEnTete: parseFloat(sel('pdf-titres').value),
            };
            localStorage.setItem(CLE_PDF, JSON.stringify(this._pdf));
            this.dessinerApercuPdf();
        };
        for (const id of ['pdf-format', 'pdf-marges', 'pdf-mesures-ligne']) sel(id).onchange = lire;
        // `input` et non `change` sur les curseurs : l'aperçu suit le doigt, c'est tout l'intérêt
        // d'un curseur ici — on cherche la valeur qui fait tomber une page, on ne la connaît pas
        // d'avance. Le redessin est un rendu SVG d'UNE page, pas du morceau entier.
        for (const id of ['pdf-interligne', 'pdf-ecart', 'pdf-titres']) sel(id).oninput = lire;

        sel('pdf-reinit').onclick = () => {
            localStorage.removeItem(CLE_PDF);
            this.ouvrirApercuPdf();   // se rouvre sur les valeurs d'origine, fenêtre déjà affichée
        };
        sel('pdf-page-prec').onclick = () => { this._pdfPage--; this.dessinerApercuPdf(); };
        sel('pdf-page-suiv').onclick = () => { this._pdfPage++; this.dessinerApercuPdf(); };
        sel('pdf-enregistrer').onclick = () => this.enregistrerPdf();

        this.dessinerApercuPdf();
        this.ouvrirFenetre('fenetre-pdf');
    }

    /**
     * Dessine LA page courante de l'aperçu, et met à jour le bilan.
     *
     * Le `page` passé au rendu est celui de preparerPdf, mais avec les dimensions de la FEUILLE et
     * non celles du contenu : la liste d'affichage vit dans un repère sans bord de page (elle
     * s'étend sur toute la hauteur du morceau), et c'est la pagination qui découpe. Le décalage
     * remonte la tranche voulue en haut de la feuille — exactement le calcul de construirePdf, à la
     * même ligne près.
     */
    dessinerApercuPdf() {
        const cible = document.getElementById('pdf-feuille');
        if (!cible) return;
        const o = this._optionsPdf();
        let prep;
        try {
            prep = preparerPdf(this.editeur.partition, o);
        } catch (err) {
            console.error(err);
            cible.innerHTML = '';
            document.getElementById('pdf-bilan').textContent = 'Aperçu indisponible';
            return;
        }
        const { page, feuilles, format, marges, hauteurEnTete } = prep;
        const n = Math.max(1, feuilles.length);
        this._pdfPage = Math.min(Math.max(0, this._pdfPage), n - 1);
        const feuille = feuilles[this._pdfPage];

        if (feuille) {
            cible.innerHTML = rendreSvg({ ...page, largeur: format.largeur, hauteur: format.hauteur }, {
                systemesVisibles: feuille.systemes,
                decalage: { dx: marges.gauche, dy: marges.haut + (this._pdfPage === 0 ? hauteurEnTete : 0) - feuille.y0 },
                // La palette du PDF, pas celle de l'écran : papier blanc, encre noire. C'est un
                // aperçu d'IMPRESSION — le papier crème de l'écran y mentirait sur le résultat.
                palette: PALETTE_PDF,
            });
        } else {
            cible.innerHTML = '';
        }
        document.getElementById('pdf-compteur').textContent = `Page ${this._pdfPage + 1} / ${n}`;
        document.getElementById('pdf-page-prec').disabled = this._pdfPage === 0;
        document.getElementById('pdf-page-suiv').disabled = this._pdfPage >= n - 1;
        document.getElementById('pdf-valeur-interligne').textContent = o.interligne.toFixed(2) + ' mm';
        document.getElementById('pdf-valeur-ecart').textContent = o.ecartSystemes.toFixed(1);
        document.getElementById('pdf-valeur-titres').textContent = Math.round(o.echelleEnTete * 100) + ' %';
        const mesures = this.editeur.partition.mesures.length;
        document.getElementById('pdf-bilan').textContent =
            `${n} page${n > 1 ? 's' : ''} · ${mesures} mesure${mesures > 1 ? 's' : ''} · ${page.ancrages.systemes.length} portée${page.ancrages.systemes.length > 1 ? 's' : ''}`;
    }

    /** Enregistre le PDF avec les réglages de l'aperçu, puis referme la fenêtre. */
    enregistrerPdf() {
        try {
            this.message('Génération du PDF…', 20000);
            const { nomFichier, nbPages } = exporterPdf(this.editeur.partition, this._optionsPdf());
            this.fermerFenetres();
            this.message(`PDF téléchargé → ${nomFichier} (${nbPages} page${nbPages > 1 ? 's' : ''})`);
        } catch (err) {
            console.error(err);
            this.message('Échec de l\'export PDF : ' + err.message);
        }
    }

    /**
     * Affiche une fenêtre de CHOIX (voile+fenetre déjà dans index.html, boutons `[data-choix]`) et
     * résout à la valeur du bouton cliqué, ou `null` si fermée autrement (croix, clic sur le fond) —
     * un seul mécanisme pour les deux choix MIDI (export : un seul fichier/par partie ; import :
     * nouveau morceau/à la suite) plutôt que de le dupliquer. La fermeture GÉNÉRIQUE (voir
     * brancherInterface, fermerFenetres) reste câblée à côté et referme bien la fenêtre dans tous les
     * cas — mais elle ne sait rien de cette promesse, d'où les écouteurs posés ici en plus, qui la
     * résolvent à `null` par les mêmes deux portes (croix, fond).
     */
    choisirDans(idFenetre) {
        const fenetre = document.getElementById(idFenetre);
        fenetre.hidden = false;
        return new Promise((resolve) => {
            let repondu = false;
            const finir = (valeur) => {
                if (repondu) return;
                repondu = true;
                fenetre.hidden = true;
                resolve(valeur);
            };
            for (const b of fenetre.querySelectorAll('[data-choix]')) b.onclick = () => finir(b.dataset.choix);
            for (const b of fenetre.querySelectorAll('[data-fermer]')) b.addEventListener('click', () => finir(null), { once: true });
            fenetre.addEventListener('pointerdown', function surFond(e) {
                if (e.target !== fenetre) return;
                fenetre.removeEventListener('pointerdown', surFond);
                finir(null);
            });
        });
    }

    /**
     * DEMANDE LE RYTHME DU FICHIER À IMPORTER, et le mode d'import du même geste.
     *
     * UNE SEULE FENÊTRE POUR LES DEUX QUESTIONS (« remplace ou à la suite ? » et « binaire ou
     * ternaire ? ») : ce sont deux décisions sur le MÊME import, et les empiler en deux étapes
     * ferait un assistant là où il n'y a qu'un fichier à ouvrir. Le rythme se règle dans le corps de
     * la fenêtre, le mode reste au pied — c'est lui qui la referme.
     *
     * POURQUOI DEMANDER PLUTÔT QUE DEVINER. Un .mid ne porte AUCUNE notion de swing, seulement des
     * positions : des croches aux deux tiers du temps se lisent aussi bien en triolets écrits qu'en
     * croches droites jouées swing. Deux partitions pour la même musique, et seul le musicien sait
     * laquelle il veut lire — c'est ce que l'utilisateur proposait de nous dire. La détection
     * (io/midi.js#detecterRythme) ne fait que PRÉ-COCHER, et dit sur quoi elle s'appuie.
     *
     * @returns {Promise<boolean|null>} `true` si ternaire, `false` si binaire, `null` si annulé.
     *   Le mode d'import ('nouveau' | 'suite') est déposé dans `this._choixImportMidi`.
     */
    async demanderRythmeImport(analyse) {
        const detection = detecterRythme(analyse);
        let ternaire = detection.ternaire;
        const boutons = [...document.querySelectorAll('#segments-rythme-import [data-rythme]')];
        const note = document.getElementById('note-rythme-import');
        const peindre = () => {
            for (const b of boutons) {
                const choisi = (b.dataset.rythme === 'ternaire') === ternaire;
                b.classList.toggle('actif', choisi);
                b.setAttribute('aria-checked', String(choisi));
            }
        };
        // CE QUE LA DÉTECTION A VU, écrit en clair : c'est ce qui permet de la contredire en
        // connaissance de cause. Un « on a détecté du swing » sans chiffres ne se discute pas.
        note.textContent = detection.swing || detection.triolet
            ? (detection.ternaire
                ? `Swing détecté sur ${detection.swing} temps : les croches seront écrites droites, avec l'indication ternaire.`
                : `${detection.triolet ? `${detection.triolet} temps en triolets écrits. ` : ''}Le rythme du fichier sera écrit tel quel.`)
            : '';
        peindre();
        for (const b of boutons) {
            b.onclick = () => { ternaire = b.dataset.rythme === 'ternaire'; peindre(); };
        }
        const choix = await this.choisirDans('fenetre-choix-import-midi');
        this._choixImportMidi = choix;
        return choix == null ? null : ternaire;
    }

    /**
     * Popule puis affiche la fenêtre de choix de ZONE DE MANCHE à l'import MIDI (voir
     * io/midi.js#analyserZonesManche) : un bouton par zone PERTINENTE POUR CE FICHIER — jamais
     * une liste générique, une zone qu'aucune note du fichier n'atteint n'étant pas proposée —
     * plus l'échappatoire « Manche entier » toujours disponible en pied de fenêtre. Un
     * avertissement s'affiche en plus si des notes du fichier sont hors de portée de
     * l'instrument, quelle que soit la zone choisie (tropGraves/tropAigues) : rien à voir avec CE
     * choix, mais le bon moment pour le dire, avant que l'utilisateur ne décide d'une zone.
     * Renvoie, via choisirDans, `"{debut}-{fin}"`, `"tout"`, ou `null` si annulé.
     */
    choisirZoneManche(infosZones) {
        const conteneur = document.getElementById('liste-zones-manche');
        conteneur.innerHTML = '';
        for (const z of infosZones.zones) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn-neutre';
            b.dataset.choix = `${z.debut}-${z.fin}`;
            const debutTxt = z.debut === 0 ? 'Sillet' : `Case ${z.debut}`;
            b.textContent = `${debutTxt} → case ${z.fin} (${z.reachable}/${infosZones.totalNotes} note${infosZones.totalNotes > 1 ? 's' : ''})`;
            conteneur.appendChild(b);
        }
        const avertissement = document.getElementById('avertissement-zone-manche');
        const bits = [];
        if (infosZones.tropGraves) bits.push(`${infosZones.tropGraves} note${infosZones.tropGraves > 1 ? 's' : ''} trop grave${infosZones.tropGraves > 1 ? 's' : ''}`);
        if (infosZones.tropAigues) bits.push(`${infosZones.tropAigues} note${infosZones.tropAigues > 1 ? 's' : ''} trop aiguë${infosZones.tropAigues > 1 ? 's' : ''}`);
        const total = infosZones.tropGraves + infosZones.tropAigues;
        avertissement.hidden = bits.length === 0;
        avertissement.textContent = bits.length ? `⚠ ${bits.join(', ')} pour cet instrument : abandonnée${total > 1 ? 's' : ''} quelle que soit la zone choisie.` : '';
        return this.choisirDans('fenetre-zone-manche');
    }

    /**
     * Exporter en .mid — le format qu'un séquenceur, un DAW ou un logiciel de notation sait lire.
     * Un seul fichier directement s'il n'y a qu'une seule SECTION (voir model/score.js#sectionsDe) ;
     * sinon demande d'abord si on préfère un fichier PAR section (chacune sa propre timeline à 0),
     * comme HarmoHub — un standard .mid ne permettant pas de vraies coupures gérables indépendamment
     * DANS un seul fichier (seulement des repères, voir genererMidi), donc pas d'autre choix que
     * plusieurs fichiers pour qui doit gérer chaque partie séparément sans la redécouper à la main.
     */
    async exporterMidiFichier() {
        try {
            const sections = sectionsDe(this.editeur.partition);
            let parPartie = false;
            if (sections.length > 1) {
                const choix = await this.choisirDans('fenetre-choix-export-midi');
                if (choix == null) return;   // annulé
                parPartie = choix === 'partie';
            }
            if (parPartie) {
                const n = exporterMidiParPartie(this.editeur.partition);
                this.message(`${n} fichiers MIDI téléchargés`);
            } else {
                const nom = exporterMidi(this.editeur.partition);
                this.message(`Exporté → ${nom}`);
            }
        } catch (err) {
            console.error(err);
            this.message('Échec de l\'export MIDI : ' + err.message);
        }
    }

    /** Importer un .mid — dans l'instrument/accordage/capodastre ACTUELS : un fichier MIDI ne dit
     *  rien de la lutherie, ce sont les réglages déjà en place qui décident où poser les notes. */
    ouvrirMidi() { this.el.entreeFichierMidi.click(); }

    /**
     * Un fichier MIDI peut REMPLACER le morceau en cours (comme avant), ou s'y AJOUTER À LA SUITE,
     * comme une nouvelle partie annotée — sans toucher à ce qui existe déjà (retour utilisateur,
     * inspiré de HarmoHub qui, lui, décide seul selon que le morceau est vide ou non : ici, on
     * demande, dans les deux cas, lequel des deux est voulu).
     *
     * Sur guitare/basse (jamais piano, qui n'a pas de manche), une étape PRÉALABLE demande la ZONE
     * DE JEU voulue sur le manche — sillet-case 5, case 5-10, etc, voir
     * io/midi.js#analyserZonesManche/choisirZoneManche — pour une tablature jouable d'une seule
     * position plutôt que la case la plus basse n'importe où, qui peut faire sauter d'un bout à
     * l'autre du manche à chaque note. Sautée quand une seule zone (ou aucune) touche les notes du
     * fichier : rien à choisir dans ce cas, la contrainte ne changerait rien au résultat. Les notes
     * hors de portée de l'INSTRUMENT TOUT ENTIER (quelle que soit la zone) sont signalées à part.
     */
    async chargerFichierMidi(fichier) {
        try {
            const piste = this.editeur.partition.piste;
            const analyse = await analyserFichierMidi(fichier);

            let zone = null;
            let infosZones = null;
            if (piste.instrument !== 'piano') {
                infosZones = analyserZonesManche(analyse, piste.instrument, piste.accordage, piste.capo);
                if (infosZones.zones.length > 1) {
                    const choixZone = await this.choisirZoneManche(infosZones);
                    if (choixZone == null) return;   // annulé
                    if (choixZone !== 'tout') {
                        const [debut, fin] = choixZone.split('-').map(Number);
                        zone = { debut, fin };
                    }
                }
            }

            // LE RYTHME SE DEMANDE AVANT DE CONSTRUIRE, parce qu'il change tout ce qui suit : en
            // ternaire, les positions du fichier sont ramenées à l'écriture droite avant d'être
            // quantifiées (voir io/midi.js). La réponse est PRÉ-COCHÉE par détection — un .mid ne
            // porte aucune notion de swing, seul le musicien tranche, mais deviner juste la plupart
            // du temps épargne un clic à chaque import.
            const ternaire = await this.demanderRythmeImport(analyse);
            if (ternaire == null) return;   // annulé
            const { partition, abandonnees } = construirePartitionDepuisMidi(
                analyse, piste.instrument, piste.accordage, piste.capo, zone, ternaire);
            const choix = this._choixImportMidi;

            // Détail de CAUSE pour les notes abandonnées : hors de portée de l'instrument (aucune
            // zone n'y aurait rien changé) plutôt qu'exclues par la zone choisie — deux raisons très
            // différentes, la seconde attendue quand on restreint volontairement le manche.
            const detailHorsPortee = (() => {
                if (!infosZones) return '';
                const bits = [];
                if (infosZones.tropGraves) bits.push(`${infosZones.tropGraves} trop grave${infosZones.tropGraves > 1 ? 's' : ''}`);
                if (infosZones.tropAigues) bits.push(`${infosZones.tropAigues} trop aiguë${infosZones.tropAigues > 1 ? 's' : ''}`);
                return bits.length ? ` (${bits.join(', ')} pour l'instrument)` : '';
            })();

            // Seul le REMPLACEMENT écrase le morceau ; « à la suite » l'agrandit et ne perd rien,
            // donc rien à demander dans ce cas — un garde-fou qui se déclenche quand il n'y a rien à
            // perdre s'apprend à cliquer sans lire.
            if (choix !== 'suite' && !(await this.peutEcraserLeMorceau('Importer un fichier MIDI', { demanderVersion: true }))) return;
            this.arreter();
            if (choix === 'suite') {
                const tempoActuel = this.editeur.partition.meta.tempo;
                const titre = fichier.name.replace(/\.midi?$/i, '').trim().slice(0, 40) || 'Import';
                this.editeur.ajouterMesures(partition.mesures, titre);
                const parties = ['Ajouté à la suite du morceau'];
                if (abandonnees) parties.push(`${abandonnees} note${abandonnees > 1 ? 's' : ''} hors du manche abandonnée${abandonnees > 1 ? 's' : ''}${detailHorsPortee}`);
                // Le morceau en cours garde SON tempo (jamais celui, différent, d'un fichier qui vient
                // s'ajouter) — mais le dire vaut mieux qu'un silence qui laisserait deviner pourquoi la
                // nouvelle partie ne « sonne » pas à la vitesse attendue.
                if (Math.round(partition.meta.tempo) !== Math.round(tempoActuel)) {
                    parties.push(`fichier à ${Math.round(partition.meta.tempo)} BPM, morceau conservé à ${Math.round(tempoActuel)} BPM`);
                }
                this.message(parties.join(' · '), parties.length > 1 ? 6000 : undefined);
            } else {
                this.editeur.remplacer(partition);
                this.message(abandonnees
                    ? `Importé (${abandonnees} note${abandonnees > 1 ? 's' : ''} hors du manche abandonnée${abandonnees > 1 ? 's' : ''}${detailHorsPortee})`
                    : `Importé : ${partition.meta.titre}`, abandonnees ? 6000 : undefined);
            }
        } catch (err) {
            // Un fichier illisible est une entrée UTILISATEUR malvenue, pas un bug applicatif — comme
            // chargerFichier (.json) juste au-dessus, aucun console.error : le message suffit.
            this.message(err.message || 'Impossible d\'ouvrir ce fichier MIDI');
        }
    }

    /**
     * LE GARDE-FOU, EN UN SEUL ENDROIT — devant chaque geste qui ÉCRASE le morceau en cours.
     *
     * TROIS GESTES LE FONT, et aucun n'avertissait de la même façon : « Nouveau » posait un
     * `confirm()` natif, « Ouvrir » un .json et « Importer » un .mid en remplacement ne posaient rien
     * du tout. Retour utilisateur : « mise en place de pop-ups à la fermeture pour demander la
     * sauvegarde ou pour confirmer la fermeture ».
     *
     * CE QUI PEUT VRAIMENT SE PERDRE, et c'est ce qui décide du texte affiché. Le brouillon s'écrit
     * tout seul dans le navigateur (voir planifierBrouillon) : un rechargement accidentel ne coûte
     * rien, et c'est déjà le cas. Mais il n'y a qu'UN brouillon, écrasé par le morceau suivant — donc
     * le seul enregistrement qui SURVIVE à « Nouveau », à un changement de navigateur ou à un vidage
     * des données du site, c'est le fichier .json exporté. La question posée est donc « exporter
     * d'abord ? », pas « enregistrer ? » : l'enregistrement, lui, a déjà eu lieu.
     *
     * TROIS CHOIX, ce qu'aucun `confirm()` ne sait dire (deux boutons, libellés figés) — c'est
     * l'autre raison d'avoir un dialogue maison, au-delà de son aspect.
     *
     * @returns {Promise<boolean>} vrai si l'appelant peut continuer.
     */
    async peutEcraserLeMorceau(intitule, { demanderVersion = false } = {}) {
        // Rien à perdre : aucune modification depuis le dernier export (ou depuis l'ouverture).
        // ON ARCHIVE QUAND MÊME au passage : « rien à perdre » veut dire « le fichier existe »,
        // pas « ce morceau n'intéresse plus personne » — et retrouver un état dans la liste des
        // versions coûte moins qu'aller rechercher le .json dans un dossier de téléchargements.
        // `etapesDocument()` ET NON `peutAnnuler()` : depuis que la bande de boucle est annulable,
        // l'historique peut contenir des étapes qui n'ont touché à AUCUNE note (voir
        // Editeur.memoriserAnnexe). Poser une barre orange ne doit pas faire réclamer un
        // enregistrement — elle n'est même pas enregistrée dans le fichier.
        if (this.editeur.etapesDocument() === 0 || this.travailExporte) {
            return this._archiverAvantRemplacement(demanderVersion);
        }
        const choix = await demander({
            titre: intitule,
            // LE FORMAT EST DIT DANS LE TEXTE, pas dans le libellé du bouton : « Exporter en JSON
            // puis continuer » faisait passer les trois boutons à la ligne (mesuré), et le .json est
            // de toute façon le seul export qui ROUVRE le morceau — la phrase est le bon endroit
            // pour l'expliquer, le bouton celui pour agir.
            texte: 'La tablature en cours n\'a pas été exportée. Le brouillon du navigateur sera '
                 + 'remplacé par le nouveau morceau : sans un fichier .json, ce travail sera perdu.',
            boutons: [
                { cle: 'annuler', libelle: 'Annuler' },
                { cle: 'sans', libelle: 'Continuer sans exporter', style: 'danger' },
                { cle: 'exporter', libelle: 'Exporter puis continuer', style: 'plein' },
            ],
        });
        if (choix === 'exporter') { this.exporterJson(); return this._archiverAvantRemplacement(demanderVersion); }
        if (choix !== 'sans') return false;
        return this._archiverAvantRemplacement(demanderVersion);
    }

    /**
     * Range le morceau en cours dans l'historique juste avant qu'il soit remplacé, en posant au
     * besoin LA question de l'utilisateur : « au moment d'un import, me demander si je veux écraser
     * la version précédente. »
     *
     * POURQUOI LA QUESTION N'EST POSÉE QU'AUX IMPORTS (`demanderVersion`), et pas devant « Nouvelle
     * tablature » ni devant la restauration d'une version : c'est littéralement ce qui a été demandé,
     * et la friction doit rester proportionnée. Importer plusieurs fois de suite le même fichier
     * retouché ailleurs est le cas où la liste gonfle pour rien — c'est là que le choix sert.
     *
     * ET SEULEMENT S'IL Y A DÉJÀ QUELQUE CHOSE À ÉCRASER : sans version enregistrée, la question
     * n'aurait pas de réponse utile. Une question dont une seule réponse a du sens n'est pas une
     * question, c'est une étape de plus.
     *
     * @returns {Promise<boolean>} faux seulement si l'utilisateur annule ICI — l'appelant renonce
     *   alors au remplacement, comme s'il avait annulé le garde-fou précédent.
     */
    async _archiverAvantRemplacement(demanderVersion) {
        if (!this.versionsActives) return true;
        const versions = lireVersions();
        if (!demanderVersion || versions.length === 0) { this._archiverVersion(); return true; }
        const choix = await demander({
            titre: 'Historique des versions',
            texte: `Le morceau en cours va être mis de côté. La version la plus récente de `
                 + `l'historique date de ${daterVersion(versions[0].date)}`
                 + `${versions[0].titre ? ` (« ${versions[0].titre} »)` : ''}.`,
            boutons: [
                { cle: 'annuler', libelle: 'Annuler' },
                { cle: 'ecraser', libelle: 'Écraser la précédente' },
                { cle: 'garder', libelle: 'Garder les deux', style: 'plein' },
            ],
        });
        if (choix === 'annuler' || choix === null) return false;
        this._archiverVersion({ ecraserDerniere: choix === 'ecraser' });
        return true;
    }

    async nouveau() {
        if (!(await this.peutEcraserLeMorceau('Nouvelle tablature'))) return;
        this.arreter();
        this.editeur.nouveau(this.editeur.partition.piste.instrument);
        this.message('Nouvelle tablature');
    }

    // ==========================================================================================
    // Brouillon local
    // ==========================================================================================

    /**
     * Sauvegarde automatique dans le navigateur. Ce n'est PAS un système de fichiers : un seul
     * brouillon, écrasé à chaque changement, qui existe pour qu'un rechargement accidentel ne coûte
     * pas une heure de travail. L'enregistrement durable reste le .json, explicite et exportable.
     */
    planifierBrouillon() {
        clearTimeout(this._minuterieBrouillon);
        this._minuterieBrouillon = setTimeout(() => this._ecrireBrouillon(), 700);
    }

    restaurerBrouillon() {
        try {
            const brut = localStorage.getItem(CLE_BROUILLON);
            if (!brut) return;
            // Passe par `normaliser` (via `remplacer`), PAS une simple assignation : un brouillon
            // écrit par une version antérieure du format (l'ancien tableau plat `evenements`, par
            // exemple) planterait sinon `mettreEnPage` au premier accès à `mesure.voix`, en silence —
            // écran noir au démarrage, rien dans la console qui pointe vers la vraie cause.
            const lu = JSON.parse(brut);
            // DEUX FORMATS À LIRE. Un brouillon d'avant les onglets est une PARTITION nue (elle a des
            // `mesures`) ; depuis, c'est `{ v: 2, actif, onglets: [...] }`. On reconnaît l'ancien par
            // sa forme plutôt que par un numéro de version qu'il ne porte pas — et un utilisateur qui
            // met l'application à jour retrouve son travail au lieu d'un morceau vide.
            const partitions = Array.isArray(lu?.onglets) && lu.onglets.length ? lu.onglets : [lu];
            this.onglets = partitions.map(() => ({ etat: null }));
            this.ongletActif = Math.max(0, Math.min(partitions.length - 1, Number(lu?.actif) || 0));
            // Chaque onglet passe par `normaliser` (via `remplacer`), PAS une simple assignation :
            // voir la note ci-dessus — c'est ce qui protège de l'écran noir sur un format antérieur.
            partitions.forEach((p, i) => {
                if (i === this.ongletActif) return;
                this.editeur.remplacer(p);
                this.onglets[i].etat = {
                    partition: this.editeur.partition,
                    curseur: { mesure: 0, voix: 0, evenement: 0, corde: 0 },
                    passe: [], futur: [], boucle: null,
                };
            });
            this.editeur.remplacer(partitions[this.ongletActif]);
        } catch (err) {
            // Brouillon illisible : on repart d'une partition neuve, sans rien dire — mais l'état des
            // onglets doit redevenir cohérent, sans quoi la barre montrerait des onglets qui ne
            // portent rien.
            this.onglets = [{ etat: null }];
            this.ongletActif = 0;
        }
    }

    // ==========================================================================================
    // Onglets — plusieurs morceaux ouverts à la fois (voir ui/onglets.js)
    // ==========================================================================================

    /**
     * Range l'état de l'éditeur dans l'onglet actif, avant de passer à un autre.
     *
     * TOUT CE QUI APPARTIENT AU DOCUMENT, et rien d'autre : la partition, le curseur, les deux piles
     * d'annulation, et la boucle de lecture (qui désigne des mesures de CE morceau — voir
     * Lecteur.reancrerBoucle). Restent délibérément COMMUNS à tous les onglets :
     *   - la DURÉE COURANTE de la palette : c'est un réglage de main, pas une propriété du morceau ;
     *     avoir à rechoisir « croche » en changeant d'onglet serait une friction sans raison.
     *   - le PRESSE-PAPIER de mesure : c'est précisément ce qui rend les onglets utiles pour
     *     « comparer des versions » — copier une mesure ici, la coller là. Le vider au changement
     *     d'onglet supprimerait le seul geste qui traverse les deux.
     */
    _recolterOngletActif() {
        const o = this.onglets[this.ongletActif];
        if (!o) return;
        o.etat = {
            partition: this.editeur.partition,
            curseur: { ...this.editeur.curseur },
            passe: this.editeur.passe.slice(),
            futur: this.editeur.futur.slice(),
            boucle: this.lecteur.instantaneBoucle(),
        };
    }

    /**
     * Installe l'onglet `i` dans l'éditeur, et le déclare actif. Son état stocké est REMIS À NULL :
     * la vérité repart dans l'éditeur, et il n'y a jamais deux copies vivantes du même document.
     *
     * `prevenir('document')` en fin de course fait tout le reste — redessin, réglages, boucle
     * ré-ancrée, brouillon — par le chemin que prend déjà l'ouverture d'un fichier. Rien de
     * particulier à un changement d'onglet, donc rien de plus à maintenir.
     */
    _installerOnglet(i) {
        const o = this.onglets[i];
        if (!o) return;
        this.ongletActif = i;
        if (o.etat) {
            this.editeur.partition = o.etat.partition;
            this.editeur.curseur = { ...o.etat.curseur };
            this.editeur.passe = o.etat.passe;
            this.editeur.futur = o.etat.futur;
            this.editeur._dernierChiffre = null;
            this.lecteur.restaurerBoucle(o.etat.partition, o.etat.boucle);
        }
        o.etat = null;
        this.editeur.corrigerCurseur();
        this.editeur.prevenir('document');
    }

    /** Les intitulés, dans l'ordre : celui de l'éditeur pour l'onglet actif, celui de l'état rangé
     *  pour les autres. Un seul endroit qui sait où chercher, pour les deux cas. */
    titresOnglets() {
        return this.onglets.map((o, i) => titreOnglet(i === this.ongletActif ? this.editeur.partition : o.etat?.partition));
    }

    rafraichirOnglets() {
        if (!this.el.barreOnglets) return;
        rendreOnglets(this.el.barreOnglets, { titres: this.titresOnglets(), actif: this.ongletActif }, {
            surActiver: (i) => this.activerOnglet(i),
            surFermer: (i) => this.fermerOnglet(i),
            surNouveau: () => this.nouvelOnglet(),
        });
    }

    /**
     * Change d'onglet. LA LECTURE S'ARRÊTE : le transport est programmé depuis le morceau qu'on
     * quitte (voir Lecteur.programmer), et le laisser courir ferait entendre l'ancien pendant qu'on
     * regarde le nouveau. Un arrêt franc vaut mieux qu'une reprogrammation muette à un endroit qui
     * n'a aucun sens dans l'autre morceau.
     */
    activerOnglet(i) {
        if (i === this.ongletActif || !this.onglets[i]) return;
        this.arreter();
        this._recolterOngletActif();
        this._installerOnglet(i);
    }

    /** Un onglet de plus, sur un morceau neuf, et on s'y place — comme un « Nouveau » qui ne
     *  remplacerait rien. C'est pourquoi il ne passe PAS par le garde-fou d'écrasement : il n'écrase
     *  précisément rien (voir peutEcraserLeMorceau, qui protège le contraire). */
    nouvelOnglet() {
        this.arreter();
        this._recolterOngletActif();
        this.onglets.push({ etat: null });
        this.editeur.remplacer(creerPartition(this.editeur.partition.piste.instrument));
        this.ongletActif = this.onglets.length - 1;
        // `remplacer` a déjà prévenu, mais AVANT que `ongletActif` ne bouge : la barre montrerait
        // encore l'ancien onglet comme actif. On redessine donc une fois de plus, ici.
        this.lecteur.retirerBoucle();
        this.rafraichirOnglets();
        this.dessiner();
        this.planifierBrouillon();
    }

    /**
     * Ferme un onglet — avec le MÊME garde-fou que tout ce qui fait disparaître un morceau (voir
     * peutEcraserLeMorceau) : fermer, c'est écraser, simplement d'un autre geste.
     *
     * JAMAIS LE DERNIER : il y a toujours un morceau ouvert, comme il y a toujours au moins une
     * mesure (voir supprimerMesure). La croix ne s'affiche d'ailleurs pas dans ce cas.
     */
    async fermerOnglet(i) {
        if (this.onglets.length <= 1 || !this.onglets[i]) return;
        this.arreter();
        // ON S'Y PLACE D'ABORD, et ce n'est pas un détail de mise en œuvre.
        //
        // `peutEcraserLeMorceau` inspecte le morceau ACTIF (son historique d'annulation, voir
        // `peutAnnuler`) et c'est lui qu'il archive dans les versions. Appelé sur un onglet d'à côté,
        // il aurait donc posé sa question à propos du mauvais document, et archivé le mauvais aussi.
        // Basculer dessus rend le garde-fou juste par construction — et montre à l'utilisateur ce
        // qu'il est sur le point de perdre, ce qui est précisément ce qu'on attend d'un avertissement.
        //
        // Si le garde-fou refuse, on reste donc sur cet onglet-là : on regarde celui qu'on a voulu
        // fermer, ce qui est cohérent avec le geste qu'on vient d'interrompre.
        if (i !== this.ongletActif) this.activerOnglet(i);
        const titre = this.titresOnglets()[i];
        if (!(await this.peutEcraserLeMorceau(`Fermer l'onglet « ${titre} »`))) return;
        // Le voisin de GAUCHE, ou celui de droite s'il n'y en a pas à gauche — jamais un saut à
        // l'autre bout de la barre.
        this.onglets.splice(i, 1);
        this._installerOnglet(Math.max(0, i - 1));
        this.planifierBrouillon();
    }

    // ==========================================================================================
    // Interface
    // ==========================================================================================

    poserIcones() {
        // Nouveau/Ouvrir/Exporter (json)/PDF/Import-Export MIDI n'ont plus d'icône À EUX depuis leur
        // regroupement dans le popover Fichiers (voir #btn-fichiers, un simple libellé texte) —
        // retirés d'ici plutôt que laissés en entrées mortes.
        const paires = {
            'btn-annuler': 'annuler', 'btn-retablir': 'retablir', 'btn-enregistrer': 'enregistrer',
            'btn-reglages': 'reglages', 'btn-aide': 'aide', 'btn-stop': 'stop',
        };
        for (const [id, nom] of Object.entries(paires)) {
            const el = document.getElementById(id);
            if (el) el.innerHTML = icone(nom);
        }
        for (const b of document.querySelectorAll('[data-fermer]')) {
            if (b.classList.contains('btn-icone')) b.innerHTML = icone('fermer');
        }
        this.rafraichirTransport();
    }

    brancherInterface() {
        const surClic = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
        surClic('btn-annuler', () => this.editeur.annuler());
        surClic('btn-retablir', () => this.editeur.retablir());
        surClic('btn-enregistrer', () => this.enregistrer());
        surClic('btn-fichiers', () => this.basculerPopoverFichiers());
        // Popover Fichiers : un seul câblage par délégation plutôt que six `surClic` séparés — les
        // boutons sont fixes (voir index.html), leur `data-action` suffit à les distinguer.
        const actionsFichiers = {
            nouveau: () => this.nouveau(), ouvrir: () => this.ouvrir(), 'exporter-json': () => this.exporterJson(),
            pdf: () => this.exporterPdf(), 'midi-ouvrir': () => this.ouvrirMidi(), 'midi-exporter': () => this.exporterMidiFichier(),
            versions: () => this.ouvrirVersions(),
        };
        this.el.popoverFichiers.addEventListener('click', (e) => {
            const b = e.target.closest('[data-action]');
            if (!b) return;
            this.fermerPopoverFichiers();
            actionsFichiers[b.dataset.action]?.();
        });
        // L'aide rythmique : ses trois boutons de pied. La fenêtre s'ouvre, elle, depuis le menu
        // contextuel — c'est le geste qui choisit AUSSI l'endroit d'insertion (voir ouvrirAideRythme).
        surClic('btn-rythme-boucle', () => this.basculerBoucleRythme());
        surClic('btn-rythme-inserer', () => this.insererRythme());
        surClic('btn-rythme-effacer', () => {
            if (!this._rythme) return;
            this._rythme.etat = Rythme.etatInitial(this._rythme.nMesures, this._rythme.signature);
            this._rythme.grille = Rythme.construireGrille(
                document.getElementById('grille-rythme'), this._rythme.etat,
                { surChangement: () => this.rafraichirApercuRythme() });
            this.rafraichirApercuRythme();
        });
        surClic('btn-reglages', () => { this.remplirReglages(); this.ouvrirFenetre('fenetre-reglages'); });
        surClic('btn-aide', () => { this.remplirAide(); this.ouvrirFenetre('fenetre-aide'); });
        surClic('btn-jouer', () => this.lectureAlternee());
        surClic('btn-stop', () => this.arreter());

        this.el.entreeFichier.addEventListener('change', (e) => {
            const f = e.target.files?.[0];
            if (f) this.chargerFichier(f);
            e.target.value = '';   // réinitialisé pour que rouvrir LE MÊME fichier redéclenche l'évènement
        });
        this.el.entreeFichierMidi.addEventListener('change', (e) => {
            const f = e.target.files?.[0];
            if (f) this.chargerFichierMidi(f);
            e.target.value = '';
        });

        // ÉDITION DE L'EN-TÊTE : un clic sur le titre, le sous-titre ou l'artiste gravés ouvre le
        // panneau des trois champs (voir ouvrirEditeurEnTete). Par DÉLÉGATION sur la feuille : le SVG
        // est réécrit en entier à chaque rendu (voir dessiner), aucun écouteur posé sur un <text>
        // précis ne survivrait à la frappe suivante.
        this.el.feuille.addEventListener('click', (e) => {
            const cible = e.target.closest?.('.en-tete-champ');
            if (!cible) return;
            e.stopPropagation();
            const vise = cible.classList.contains('en-tete-sous-titre') ? 'sousTitre'
                : cible.classList.contains('en-tete-artiste') ? 'artiste' : 'titre';
            this.ouvrirEditeurEnTete(cible, vise);
        });
        for (const champ of this.el.panneauEnTete.querySelectorAll('[data-meta]')) {
            champ.addEventListener('input', () => this.editeur.definirMeta(champ.dataset.meta, champ.value));
            // Entrée referme : le geste attendu quand on a fini de nommer son morceau. Échap aussi —
            // rien à annuler, l'écriture est déjà faite au fil de la frappe (comme dans les Réglages),
            // c'est seulement une façon de refermer sans viser la partition à la souris.
            champ.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); this.fermerEditeurEnTete(); }
            });
        }
        this.el.tempo.addEventListener('change', () => this.editeur.definirTempo(parseInt(this.el.tempo.value, 10)));
        this.el.tempo.addEventListener('input', () => this.lecteur.definirTempo(parseInt(this.el.tempo.value, 10) || 120));

        surClic('btn-mesures-ligne-bascule', () => this.basculerGroupeMesuresLigne());
        this.construireBoutonsMesuresLigne();
        // Le zoom : deux crans, et un rafraîchissement d'entrée de jeu pour que la loupe déjà au
        // butoir (préférence retenue à ZOOM_MIN/ZOOM_MAX) arrive désactivée, sans attendre un clic.
        // Le popover reste OUVERT après un cran, à la différence d'un choix de mesures par ligne :
        // on zoome par essais successifs, et le refermer obligerait à le rouvrir à chaque cran.
        surClic('btn-zoom-moins', () => this.changerZoom(-1));
        surClic('btn-zoom-plus', () => this.changerZoom(+1));
        this.rafraichirZoom();
        this.rafraichirFlechesTransport = this.brancherFlechesTransport();

        // Métronome : ne touche à rien de la lecture EN COURS (voir Lecteur.jouer, qui ne
        // reprogramme le transport qu'au prochain départ depuis l'arrêt) — comme tout autre
        // réglage, il prend effet à la PROCHAINE lecture, jamais en la faisant bégayer en direct.
        surClic('btn-metronome', () => {
            this.lecteur.metronomeActif = !this.lecteur.metronomeActif;
            localStorage.setItem(CLE_METRONOME, this.lecteur.metronomeActif ? '1' : '0');
            this.rafraichirMetronome();
        });
        // Le décompte : PAS d'effet sur une lecture en cours, comme le métronome juste au-dessus — il
        // ne se joue qu'au départ, et rien ne se passerait à le basculer en plein morceau.
        surClic('btn-decompte', () => {
            this.lecteur.decompteActif = !this.lecteur.decompteActif;
            localStorage.setItem(CLE_DECOMPTE, this.lecteur.decompteActif ? '1' : '0');
            this.rafraichirMetronome();
        });
        surClic('champ-metronome-subdivision', () => {
            this.lecteur.metronomeSubdivision = !this.lecteur.metronomeSubdivision;
            localStorage.setItem(CLE_METRONOME_SUBDIVISION, this.lecteur.metronomeSubdivision ? '1' : '0');
            this.rafraichirMetronome();
        });
        this.rafraichirMetronome();
        // L'entrée « Versions précédentes… » n'existe dans le menu Fichiers que si l'historique est
        // allumé : posée ici, au câblage, plutôt qu'à chaque ouverture du popover — la préférence ne
        // change qu'à l'interrupteur des Réglages, qui rappelle cette même fonction.
        this.rafraichirEtatVersions();

        // Clic dans la partition : place le curseur. Glisser : dessine un rectangle de sélection
        // multiple. Voir demarrerGeste — les deux commencent pareil, ne se distinguent qu'au premier
        // mouvement franc.
        this.el.feuille.addEventListener('pointerdown', (e) => this.demarrerGeste(e));
        this.el.feuille.addEventListener('contextmenu', (e) => this.ouvrirMenuContextuel(e));
        this.el.zone.addEventListener('pointerdown', () => this.el.zone.focus());
        this.brancherZoomGeste();
        this.brancherSurvolBoucle();
        this.brancherPriseBoucleTactile();
        this.brancherAnnexeHistorique();
        let attenteDefilement = false;
        this.el.zone.addEventListener('scroll', () => {
            if (attenteDefilement) return;
            attenteDefilement = true;
            requestAnimationFrame(() => { attenteDefilement = false; this.surDefilement(); });
        }, { passive: true });

        for (const b of document.querySelectorAll('[data-fermer]')) {
            b.addEventListener('click', () => this.fermerFenetres());
        }
        for (const v of document.querySelectorAll('.voile')) {
            v.addEventListener('pointerdown', (e) => { if (e.target === v) this.fermerFenetres(); });
        }

        /**
         * AVERTISSEMENT À LA FERMETURE RÉELLE DE L'ONGLET (retour utilisateur : « des pop-ups à la
         * fermeture pour demander la sauvegarde ou pour confirmer la fermeture »).
         *
         * CELLE-CI RESTE LA BOÎTE DU NAVIGATEUR, et ce n'est pas un oubli : aucun navigateur moderne
         * n'autorise ni message personnalisé ni bouton maison sur `beforeunload` — ils affichent tous
         * leur propre texte, précisément pour qu'une page ne puisse pas retenir quelqu'un par une
         * fenêtre trompeuse. Poser `returnValue` déclenche bien la demande de confirmation ; c'est
         * tout ce qu'une page peut faire, et HarmoHub note exactement la même limite. Les fenêtres
         * MAISON, elles, gardent les gestes internes, où l'on peut offrir de vrais choix (voir
         * peutEcraserLeMorceau, trois boutons nommés).
         *
         * ET SEULEMENT S'IL Y A QUELQUE CHOSE À PERDRE. Le brouillon se réécrit tout seul : recharger
         * la page rouvre le morceau tel quel. Ce qui ne survit pas, c'est un changement de navigateur
         * ou un vidage des données du site — donc la question ne se pose que si le travail n'a jamais
         * été exporté en fichier. Un avertissement systématique à chaque fermeture s'apprendrait à
         * cliquer sans lire, et ne protégerait plus rien le jour où il compte.
         */
        window.addEventListener('beforeunload', (e) => {
            // Même raison qu'à peutEcraserLeMorceau : une bande de boucle posée n'est pas du
            // travail à sauver, et ne doit donc pas retenir la fermeture de l'onglet.
            if (this.travailExporte || this.editeur.etapesDocument() === 0) return;
            e.preventDefault();
            e.returnValue = '';
        });

        // Une remise en page suit tout changement de largeur : le découpage en systèmes en dépend
        // directement, et une fenêtre réduite doit rendre des systèmes plus courts, pas une barre de
        // défilement horizontale.
        let minuterie = null;
        window.addEventListener('resize', () => {
            clearTimeout(minuterie);
            minuterie = setTimeout(() => {
                this.dessiner();
                // LES FLÈCHES DE LA BARRE DE TRANSPORT AUSSI (voir brancherFlechesTransport). Elles ne
                // se rafraîchissaient QUE sur un évènement `scroll` : élargir la fenêtre jusqu'à ce que
                // la barre ne déborde plus laissait donc allumée une flèche « défiler à droite » qui
                // n'avait plus rien à faire défiler — un bouton inerte qu'on peut cliquer sans effet.
                // Défaut PRÉEXISTANT, resté invisible parce qu'un défilement finissait toujours par
                // survenir et corriger l'affichage au passage ; découvert en réduisant à zéro la
                // largeur des flèches masquées (voir style.css), qui a supprimé ce défilement fortuit.
                this.rafraichirFlechesTransport?.();
            }, 120);
        });

        this.el.tempo.value = this.editeur.partition.meta.tempo;
        this.rafraichirBoutonsHistorique();
    }

    /**
     * Positionne le curseur d'après un clic.
     *
     * On cherche l'évènement dont la PLAGE horizontale contient le clic, dans le système dont la
     * plage verticale le contient — et non la note la plus proche. Un clic dans le blanc entre deux
     * notes a alors un sens évident (« ici »), là où le plus proche voisin ferait sauter le curseur
     * d'un côté ou de l'autre selon un pixel.
     */
    /**
     * Traduit un point d'écran en {mesure, evenement, corde, voix} — la cible que désignerait un
     * clic à cet endroit, ou `null` hors de toute portée. Partagée par le clic gauche (place le
     * curseur, voir clicPartition) et le clic droit (ouvre le menu contextuel, voir
     * ouvrirMenuContextuel) : les deux gestes doivent désigner exactement la même chose au même
     * endroit, sans dupliquer ce calcul deux fois.
     */
    cibleDepuisClic(evenement) {
        if (!this.page) return null;
        const svg = this.el.feuille.querySelector('svg');
        if (!svg) return null;
        const boite = svg.getBoundingClientRect();
        const x = (evenement.clientX - boite.left) * (this.page.largeur / boite.width);
        const y = (evenement.clientY - boite.top) * (this.page.hauteur / boite.height);

        // Un clic DANS un système le désigne ; un clic au-dessus du premier ou sous le dernier ne
        // désigne rien et ne doit RIEN faire. Une première version rabattait ces clics sur le système
        // le plus proche : cliquer dans le blanc sous la partition — le geste le plus banal pour
        // simplement rendre le focus à la page — expédiait le curseur à la dernière mesure, sur la
        // corde la plus grave, sans que rien ne l'explique à l'écran.
        const systemes = this.page.ancrages.systemes;
        const marge = this.page.geo.S * 1.5;
        const systeme = systemes.find(s => y >= s.y - marge && y <= s.y + s.hauteur + marge);
        if (!systeme) return null;

        const candidats = this.page.ancrages.evenements.filter(a => a.yPortee === systeme.yPortee);
        if (!candidats.length) return null;
        // Deux voix peuvent toutes deux couvrir l'abscisse cliquée (elles commencent ensemble). On
        // préfère alors rester sur la voix DÉJÀ active plutôt que de deviner d'après la position — un
        // clic qui resterait sur la même voix qu'avant est le comportement le moins surprenant.
        const memeX = candidats.filter(a => x >= a.xDebut && x < a.xFin);
        const cible = (memeX.find(a => a.voix === this.editeur.curseur.voix) || memeX[0])
            || (x < candidats[0].xDebut ? candidats[0] : candidats[candidats.length - 1]);

        // La corde se déduit de la hauteur du clic dans la tablature ; un clic sur la portée solfège
        // garde la corde courante, puisqu'une portée n'en désigne aucune.
        let corde = this.editeur.curseur.corde;
        const ST = this.page.geo.ST;
        if (y > cible.yTab - ST) {
            corde = Math.round((y - cible.yTab) / ST);
            corde = Math.max(0, Math.min(nbCordes(this.editeur.partition) - 1, corde));
        }
        return { mesure: cible.mesure, evenement: cible.evenement, corde, voix: cible.voix };
    }

    /**
     * Pendant de cibleDepuisClic, pour le PIANO — pas de corde à retrouver, mais une HAUTEUR
     * (voir engine/layout.js#pasDeLaPosition, theory.js#hauteurDepuisPas). La portée touchée (sol ou
     * fa) dit la VOIX visée (main droite/gauche) : c'est elle, pas la mesure, qui distingue les deux
     * mains — la frontière naturelle étant à mi-chemin dans l'espace ENTRE les deux portées.
     *
     * Une mesure existe TOUJOURS pour les deux portées (voir poserMesurePiano, qui dessine un
     * silence de mesure entière en fa tant que rien n'y est écrit) : `evenement` retombe alors sur 0
     * — c'est ce qui permet d'écrire une PREMIÈRE note à la main gauche d'une mesure qui n'avait
     * encore que la mélodie, `clicPartition` ajoutant la voix manquante au moment de l'écrire.
     */
    cibleDepuisClicPiano(evenement) {
        if (!this.page) return null;
        const svg = this.el.feuille.querySelector('svg');
        if (!svg) return null;
        const boite = svg.getBoundingClientRect();
        const x = (evenement.clientX - boite.left) * (this.page.largeur / boite.width);
        const y = (evenement.clientY - boite.top) * (this.page.hauteur / boite.height);

        const systemes = this.page.ancrages.systemes;
        const S = this.page.geo.S;
        const marge = S * 1.5;
        const systeme = systemes.find(s => y >= s.y - marge && y <= s.y + s.hauteur + marge);
        if (!systeme) return null;

        const milieu = (systeme.yPortee + 4 * S + systeme.yPorteeFa) / 2;
        const voix = y < milieu ? 0 : 1;
        const clef = voix === 0 ? CLEFS.sol : CLEFS.fa;
        const yPorteeVisee = voix === 0 ? systeme.yPortee : systeme.yPorteeFa;

        const mesuresIci = this.page.ancrages.mesures.filter(a => a.systeme === systeme.index);
        if (!mesuresIci.length) return null;
        const mesureAncre = mesuresIci.find(a => x >= a.x && x < a.xFin)
            || (x < mesuresIci[0].x ? mesuresIci[0] : mesuresIci[mesuresIci.length - 1]);

        // L'évènement visé, parmi ceux DÉJÀ posés pour CETTE voix à CETTE mesure — même principe que
        // cibleDepuisClic (« ici », pas « le plus proche »). Aucun (voix pas encore ajoutée à gauche) :
        // 0, la voix neuve n'aura de toute façon qu'un seul évènement à sa naissance.
        const candidats = this.page.ancrages.evenements.filter(a => a.mesure === mesureAncre.index && a.voix === voix);
        const memeX = candidats.filter(a => x >= a.xDebut && x < a.xFin);
        const cibleEvt = memeX[0] || (candidats.length ? (x < candidats[0].xDebut ? candidats[0] : candidats[candidats.length - 1]) : null);

        const pas = pasDeLaPosition(y, yPorteeVisee, S, clef);
        const armure = armureEffective(this.editeur.partition, mesureAncre.index);
        const pitch = hauteurDepuisPas(pas, armure);

        return { mesure: mesureAncre.index, evenement: cibleEvt ? cibleEvt.evenement : 0, corde: 0, voix, pitch };
    }

    clicPartition(evenement) {
        // Un clic simple (sans glisser) abandonne la sélection multiple en cours — la convention
        // universelle : cliquer À CÔTÉ désélectionne. Le clic continue ensuite comme avant.
        if (this.selectionNotes.size) { this.selectionNotes.clear(); this.dessiner(); }
        const auPiano = this.editeur.partition.piste.instrument === 'piano';
        const cible = auPiano ? this.cibleDepuisClicPiano(evenement) : this.cibleDepuisClic(evenement);
        if (!cible) { this.el.zone.focus(); return; }
        // Au piano, la voix visée peut ne pas encore exister (mesure jamais jouée à cette main) —
        // on l'ajoute ICI, avant de placer le curseur dessus, plutôt que de forcer l'utilisateur à
        // un geste séparé (« + Voix », retiré de la palette guitare/basse — voir edit/raccourcis.js)
        // pour un geste aussi ordinaire qu'écrire à la main gauche.
        if (auPiano && cible.voix >= this.editeur.nbVoixMesure(cible.mesure)) {
            this.editeur.placerCurseur(cible.mesure, 0, 0, 0);
            this.editeur.ajouterVoix();
        }
        this.editeur.placerCurseur(cible.mesure, cible.evenement, cible.corde, cible.voix);
        if (auPiano) {
            this.editeur.saisirHauteur(cible.pitch);
            if (this.editeur.derniereErreur) { this.message(this.editeur.derniereErreur); this.editeur.derniereErreur = null; }
        }
        this.el.zone.focus();
    }

    // ==========================================================================================
    // Menu contextuel — clic droit sur une note
    // ==========================================================================================

    /**
     * Positionne un panneau flottant (menu contextuel, popover Fichiers…) près d'un point d'ancrage,
     * sans jamais déborder de la fenêtre — un panneau qui commencerait hors écran (clic près d'un
     * bord, bouton collé au bord droit) serait aussi inutilisable qu'absent. `ancre` est soit un
     * POINT `{x, y}` (le clic droit qui a ouvert le menu contextuel), soit un ÉLÉMENT (le bouton
     * Fichiers : le panneau se pose alors juste EN DESSOUS de lui, pas à son coin).
     */
    _positionnerPanneau(panneau, ancre) {
        const r = panneau.getBoundingClientRect();
        let point;
        if (ancre instanceof Element) {
            const ra = ancre.getBoundingClientRect();
            // Par défaut, le panneau se pose SOUS l'ancre — mais un bouton collé au bas de l'écran
            // (le bouton replié « Mesures par ligne », tout en bas de la barre de transport) ne
            // laisse parfois pas assez de place en dessous : le bornage plus bas repousserait alors
            // le panneau VERS LE HAUT tout en le laissant CHEVAUCHER l'ancre elle-même — illisible,
            // et impossible à retoucher pour refermer d'un second tap (trouvé en testant ce nouveau
            // bouton, jamais heurté par Fichiers, qui vit en haut de l'écran avec toute la place
            // voulue en dessous). Se poser AU-DESSUS dans ce cas — le repli standard de tout menu
            // proche d'un bord — règle les deux à la fois, sans rien changer pour une ancre qui a
            // sa place en dessous.
            const manqueEnDessous = ra.bottom + 4 + r.height > window.innerHeight - 8;
            const yAuDessus = ra.top - r.height - 4;
            point = { x: ra.left, y: (manqueEnDessous && yAuDessus >= 4) ? yAuDessus : ra.bottom + 4 };
        } else {
            point = ancre;
        }
        panneau.style.left = Math.max(4, Math.min(point.x, window.innerWidth - r.width - 8)) + 'px';
        panneau.style.top = Math.max(4, Math.min(point.y, window.innerHeight - r.height - 8)) + 'px';
    }

    /**
     * Ferme `panneau` au clic ailleurs ou à Échap ; renvoie le détacheur à appeler quand il se
     * referme par un autre chemin (choisir une action, par exemple) — le même mécanisme pour le menu
     * contextuel et le popover Fichiers. Les écouteurs se posent APRÈS ce tour d'évènement : le
     * geste qui vient d'ouvrir le panneau (clic droit, clic sur le bouton) ne doit pas aussitôt le
     * refermer. `exclure`, s'il est donné, ignore les clics sur cet élément (le bouton qui ouvre le
     * panneau lui-même) : sans quoi le rappuyer dessus le rouvrirait sitôt refermé au lieu de basculer.
     */
    _fermerAuClicAilleurs(panneau, fermer, exclure = null) {
        const surAilleurs = (e) => { if (!panneau.contains(e.target) && e.target !== exclure) fermer(); };
        const surEchap = (e) => { if (e.key === 'Escape') fermer(); };
        setTimeout(() => {
            document.addEventListener('pointerdown', surAilleurs);
            document.addEventListener('keydown', surEchap);
        }, 0);
        return () => {
            document.removeEventListener('pointerdown', surAilleurs);
            document.removeEventListener('keydown', surEchap);
        };
    }

    /**
     * Clic droit sur une case : petit menu d'actions RAPIDES centrées dessus (supprimer, supprimer
     * et décaler, insérer à gauche/à droite, puis — ajouté sur retour utilisateur — ajouter une
     * mesure avant/après et supprimer la mesure), sans repasser par le clavier. Réutilise EXACTEMENT
     * le même ciblage que le clic gauche (cibleDepuisClic) — clic gauche et clic droit doivent
     * désigner la même case au même endroit.
     */
    ouvrirMenuContextuel(evenement) {
        evenement.preventDefault();   // jamais le menu natif du navigateur sur la partition
        if (this.selectionNotes.size) { this.selectionNotes.clear(); this.dessiner(); }
        const auPiano = this.editeur.partition.piste.instrument === 'piano';
        const cible = auPiano ? this.cibleDepuisClicPiano(evenement) : this.cibleDepuisClic(evenement);
        this.fermerMenuContextuel();
        if (!cible) return;
        this.editeur.placerCurseur(cible.mesure, cible.evenement, cible.corde, cible.voix);
        this.el.zone.focus();

        // Chaque action ferme le menu, exécute la commande, puis se comporte comme un raccourci
        // clavier normal : une erreur refusée (Editeur.derniereErreur) devient un message, sinon on
        // redessine — le même relais qu'utilisent déjà la barre d'outils et le clavier.
        const action = (executer) => () => {
            this.fermerMenuContextuel();
            executer();
            if (this.editeur.derniereErreur) { this.message(this.editeur.derniereErreur); this.editeur.derniereErreur = null; }
            else this.dessiner();
        };
        const items = [
            { texte: 'Supprimer', faire: action(() => this.editeur.effacerNote()) },
            { texte: 'Supprimer et décaler la suite', faire: action(() => this.editeur.supprimerEvenement()) },
            null,
            { texte: 'Insérer une note à gauche', faire: action(() => this.editeur.insererAvant()) },
            { texte: 'Insérer une note à droite', faire: action(() => this.editeur.insererEvenement()) },
            null,
            // AJOUTÉ (retour utilisateur) : la mesure elle-même se gérait jusqu'ici SEULEMENT depuis
            // la palette (« + Mesure »/« − Mesure », groupe Mesure) — jamais depuis l'endroit même où
            // on vient de cliquer, alors que « ajouter une mesure ICI » est une pensée qui naît sur la
            // note qu'on regarde, pas dans une barre d'outils à part.
            { texte: 'Ajouter une mesure avant', faire: action(() => this.editeur.ajouterMesure(false)) },
            { texte: 'Ajouter une mesure après', faire: action(() => this.editeur.ajouterMesure(true)) },
            { texte: 'Supprimer cette mesure', faire: action(() => this.editeur.supprimerMesure()) },
            null,
            // RETOUR À LA LIGNE (retour utilisateur : « permets-moi de faire un retour à la ligne
            // pour la portée, à l'aide d'un clic droit par exemple »). Ici et non dans la palette :
            // le même retour demandait aussi de GAGNER de la place dans la barre d'outils, et ce
            // geste se pense sur la mesure qu'on regarde. Le libellé dit l'état courant, pour que
            // l'entrée soit lisible sans avoir à deviner si le saut est déjà posé.
            { texte: this.editeur.mesureCourante().sautAvant
                ? 'Ne plus commencer une ligne ici'
                : 'Commencer une nouvelle ligne ici',
              faire: action(() => this.editeur.basculerSautDeLigne()) },
            null,
            // COPIER/COLLER UNE MESURE ENTIÈRE (retour utilisateur : « permets-moi de copier/coller une
            // mesure complète avec clic droit, et de l'insérer là où je le souhaite »). Copier ne
            // modifie rien, donc pas de `action()` ici : ce relais redessine et lit derniereErreur,
            // deux choses sans objet pour un geste qui ne touche pas au document. Un message confirme
            // à la place — sans quoi le clic n'aurait AUCUN retour visible, et on ne saurait pas si la
            // copie a pris.
            // AIDE RYTHMIQUE (retour utilisateur : « je dois pouvoir choisir où l'insérer [...] le
            // placer à la souris ou au doigt »). ICI, et c'est tout l'intérêt : le menu contextuel
            // s'ouvre déjà d'un clic droit ou d'un appui long SUR la mesure visée — l'endroit
            // d'insertion est donc choisi par le geste même qui ouvre la fenêtre, sans rien à régler.
            { texte: 'Aide rythmique à partir d\'ici…', faire: () => {
                this.fermerMenuContextuel();
                this.ouvrirAideRythme(this.editeur.curseur.mesure);
            } },
            null,
            { texte: 'Copier cette mesure', faire: () => {
                this.fermerMenuContextuel();
                this.editeur.copierMesure();
                this.message(`Mesure ${this.editeur.curseur.mesure + 1} copiée`);
            } },
            // Les deux collages n'apparaissent que s'il y a quelque chose à coller : une entrée grise
            // en permanence apprendrait seulement qu'on ne peut pas s'en servir.
            ...(this.editeur.peutCollerMesure() ? [
                { texte: 'Coller la mesure avant', faire: this._collerMesure(false) },
                { texte: 'Coller la mesure après', faire: this._collerMesure(true) },
            ] : []),
        ];

        const menu = this.el.menuContextuel;
        menu.innerHTML = '';
        for (const item of items) {
            if (!item) { const hr = document.createElement('hr'); hr.className = 'separateur'; menu.appendChild(hr); continue; }
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = item.texte;
            b.addEventListener('click', item.faire);
            menu.appendChild(b);
        }
        menu.hidden = false;
        this._positionnerPanneau(menu, { x: evenement.clientX, y: evenement.clientY });
        this._detacherMenuContextuel = this._fermerAuClicAilleurs(menu, () => this.fermerMenuContextuel());
    }

    fermerMenuContextuel() {
        this.el.menuContextuel.hidden = true;
        this._detacherMenuContextuel?.();
        this._detacherMenuContextuel = null;
    }

    /**
     * Bouton « Fichiers » (barre du haut) : les actions de fichier — jusqu'ici six icônes séparées,
     * peu claires prises isolément (retour utilisateur : « on ne comprend pas assez ») — réunies
     * dans un seul panneau à libellés en toutes lettres. Même mécanique que le menu contextuel
     * juste au-dessus (_positionnerPanneau/_fermerAuClicAilleurs), posé sous le bouton plutôt qu'au
     * point de clic ; ses boutons sont peuplés UNE FOIS dans index.html, câblés dans
     * brancherInterface — leurs actions ne dépendent jamais de ce qui a été cliqué, rien à
     * reconstruire à chaque ouverture, à la différence du menu contextuel.
     */
    basculerPopoverFichiers() {
        if (!this.el.popoverFichiers.hidden) { this.fermerPopoverFichiers(); return; }
        const popover = this.el.popoverFichiers;
        popover.hidden = false;
        this.el.btnFichiers.setAttribute('aria-expanded', 'true');
        this._positionnerPanneau(popover, this.el.btnFichiers);
        this._detacherPopoverFichiers = this._fermerAuClicAilleurs(popover, () => this.fermerPopoverFichiers(), this.el.btnFichiers);
    }

    /**
     * Ouvre le panneau des trois champs de l'en-tête, ancré sur la ligne touchée.
     *
     * Retour utilisateur : « on risque de se perdre pour savoir comment changer le titre. Permets-moi
     * de modifier titre / sous-titre / artiste au niveau du titre au-dessus de la portée directement,
     * pas dans la barre d'outils. » Le titre se modifie donc LÀ OÙ IL SE LIT.
     *
     * LES TROIS CHAMPS ENSEMBLE, pas seulement celui qu'on vient de toucher : un sous-titre ou un
     * artiste VIDE n'a rien de gravé sur quoi cliquer (le bloc de titre se resserre sur ce qui existe,
     * voir poserEnTete), et les atteindre demanderait sinon de deviner qu'ils existent. Le champ de la
     * ligne touchée reçoit le focus — cliquer le sous-titre ouvre bien sur le sous-titre.
     */
    ouvrirEditeurEnTete(ancre, champVise = 'titre') {
        const p = this.el.panneauEnTete;
        if (!p.hidden) { this.fermerEditeurEnTete(); return; }
        this.remplirEditeurEnTete();
        p.hidden = false;
        this._positionnerPanneau(p, ancre);
        // `ancre` n'est PAS passée en exception au clic-ailleurs (contrairement à un bouton-bascule) :
        // ce <text> disparaît au premier rendu suivant, remplacé par un autre — une exception sur un
        // nœud détaché ne protégerait plus rien, et le titre n'est de toute façon pas une bascule.
        this._detacherPanneauEnTete = this._fermerAuClicAilleurs(p, () => this.fermerEditeurEnTete());
        p.querySelector(`[data-meta="${champVise}"]`)?.focus();
    }

    /** Recharge les trois champs depuis le morceau — à l'ouverture, et si le document change sous eux. */
    remplirEditeurEnTete() {
        for (const champ of this.el.panneauEnTete.querySelectorAll('[data-meta]')) {
            const valeur = this.editeur.partition.meta[champ.dataset.meta] || '';
            // Jamais pendant qu'on y tape : réécrire la valeur d'un champ qui a le focus replacerait
            // le curseur de saisie à la fin à chaque lettre — la frappe deviendrait inutilisable.
            if (document.activeElement !== champ) champ.value = valeur;
        }
    }

    fermerEditeurEnTete() {
        this.el.panneauEnTete.hidden = true;
        this._detacherPanneauEnTete?.();
        this._detacherPanneauEnTete = null;
        this.el.zone.focus();
    }

    fermerPopoverFichiers() {
        this.el.popoverFichiers.hidden = true;
        this.el.btnFichiers.setAttribute('aria-expanded', 'false');
        this._detacherPopoverFichiers?.();
        this._detacherPopoverFichiers = null;
    }

    /**
     * « Mesures par ligne » (barre de transport) : sur téléphone, six boutons toujours visibles
     * pesaient trop dans une rangée déjà chargée — Lecture/Stop, Tempo, Métronome (retour
     * utilisateur : « la barre de transport est trop tassée »). Troisième popover à réutiliser
     * _positionnerPanneau/_fermerAuClicAilleurs (après le menu contextuel et Fichiers, juste plus
     * haut) : même mécanique déjà éprouvée deux fois, rien à réinventer.
     *
     * Visibilité par CLASSE CSS (`.ouvert`) plutôt que l'attribut `hidden` qu'utilise le popover
     * Fichiers : `hidden` s'appliquerait à TOUTES les tailles d'écran, alors que ce groupe doit
     * rester EN LIGNE, sans le moindre popover, dès qu'il y a la place (voir .groupe-mesures-ligne
     * dans style.css) — exactement le choix déjà fait pour le popover « Effets » de la barre
     * d'outils (voir ui/toolbar.js#basculerGroupeEffets), pour la même raison, mais gardé ICI
     * puisque c'est ce module-ci qui construit déjà ce groupe (construireBoutonsMesuresLigne),
     * comme Effets reste dans toolbar.js qui construit le sien.
     *
     * Le contenu du popover ouvert reste EXACTEMENT les six mêmes boutons qu'en ligne sur grand
     * écran : jamais un menu déroulant caché derrière ce bouton (voir le commentaire de conception
     * dans index.html) — seul leur CONTENEUR change de place et de présentation.
     */
    basculerGroupeMesuresLigne() {
        const g = this.el.groupeMesuresLigne;
        if (g.classList.contains('ouvert')) { this.fermerGroupeMesuresLigne(); return; }
        g.classList.add('ouvert');
        this.el.btnMesuresLigneBascule.setAttribute('aria-expanded', 'true');
        // Mesuré APRÈS l'ouverture (`.ouvert` pose `position: fixed` en CSS) : un élément encore
        // `display: none` n'a ni largeur ni hauteur à lire — même remarque que basculerGroupeEffets.
        this._positionnerPanneau(g, this.el.btnMesuresLigneBascule);
        this._detacherGroupeMesuresLigne = this._fermerAuClicAilleurs(g, () => this.fermerGroupeMesuresLigne(), this.el.btnMesuresLigneBascule);
    }

    fermerGroupeMesuresLigne() {
        this.el.groupeMesuresLigne.classList.remove('ouvert');
        this.el.btnMesuresLigneBascule?.setAttribute('aria-expanded', 'false');
        this._detacherGroupeMesuresLigne?.();
        this._detacherGroupeMesuresLigne = null;
    }

    // ==========================================================================================
    // Sélection multiple — glisser un rectangle sur la partition
    // ==========================================================================================

    /**
     * Point de départ commun au CLIC (place le curseur) et au GLISSER (sélection multiple) : les
     * deux commencent de la même façon, et ne se distinguent qu'au premier mouvement franc — sous un
     * seuil de quelques pixels, c'est un clic, sans quoi la main la plus stable ne cliquerait jamais
     * exactement au même pixel deux fois de suite. Au-delà, plus aucun doute : c'est un lasso.
     */
    demarrerGeste(e) {
        if (e.button !== 0) return;   // le lasso ne répond qu'au bouton principal

        // LA BANDE DE BOUCLE, SOUS LA TAB, AVANT TOUTE AUTRE LECTURE DU GESTE — souris ET doigt à la
        // fois (voir demarrerGesteBoucle) : un geste qui commence là ne doit jamais être confondu
        // avec un lasso, un étirement de durée, ou un défilement tactile de la partition. UNE
        // POIGNÉE (voir poigneeBoucleAuPoint) est testée EN PREMIER, avant la bande générique : sa
        // zone de prise déborde volontairement la sienne (voir sa docblock), et saisir précisément
        // un bord doit toujours l'emporter sur « redéfinir toute la zone depuis ce point ».
        const bordPoignee = this.poigneeBoucleAuPoint(e.clientX, e.clientY);
        if (bordPoignee) { this.demarrerGesteBoucleBord(e, bordPoignee); return; }
        const mesureAncre = this.mesureDansBandeBoucle(e.clientX, e.clientY);
        if (mesureAncre != null) { this.demarrerGesteBoucle(e, mesureAncre); return; }

        // AU DOIGT, GLISSER VEUT DIRE DÉFILER — jamais lassoter. Sur un téléphone, faire glisser la
        // partition est le SEUL moyen d'atteindre le reste du morceau ; armer le lasso sur ce geste
        // rendait la partition impossible à parcourir (et dessinait un rectangle de sélection à
        // chaque tentative). Le tap simple, lui, garde tout son sens : il place le curseur, comme un
        // clic. Le lasso reste donc un geste de SOURIS, disponible sur les appareils hybrides qui
        // rapportent les deux pointeurs. Voir aussi `touch-action: pan-x pan-y` dans style.css, qui
        // rend le défilement au navigateur sur ces mêmes appareils.
        if (e.pointerType === 'touch' || e.pointerType === 'pen') {
            this.demarrerGesteTactile(e);
            return;
        }

        const depart = { x: e.clientX, y: e.clientY };
        let mode = null;   // null tant qu'on ne sait pas : 'lasso' | 'duree'
        const SEUIL = 4;
        // ÉTIRER UNE NOTE, OU LASSOTER ? La DIRECTION du geste tranche, et elle seule. Étirer une
        // note pour la faire durer plus longtemps est un mouvement HORIZONTAL par nature — c'est
        // l'axe du temps sur une partition ; encadrer plusieurs notes est un mouvement quelconque,
        // presque toujours en diagonale. Un geste qui part franchement de côté, DEPUIS UNE NOTE,
        // est donc un étirement ; tout le reste reste le lasso d'avant. Aucun modificateur à
        // connaître, et les deux gestes ne se marchent pas dessus.
        // (Retour utilisateur : « la longueur de la note à tenir, on ne comprend pas trop comment
        // faire, je pense qu'il faut pouvoir étirer à la souris ».)
        const surNote = this.noteSousLePointeur(e);

        const surMouvement = (ev) => {
            const dx = ev.clientX - depart.x, dy = ev.clientY - depart.y;
            if (!mode) {
                if (Math.hypot(dx, dy) < SEUIL) return;
                if (surNote && Math.abs(dx) > Math.abs(dy)) { mode = 'duree'; this.demarrerEtirement(surNote); }
                else { mode = 'lasso'; this.demarrerLasso(depart); }
            }
            if (mode === 'duree') this.etendreEtirement(dx);
            else this.etendreLasso(ev);
        };
        const surRelache = (ev) => {
            window.removeEventListener('pointermove', surMouvement);
            window.removeEventListener('pointerup', surRelache);
            if (mode === 'duree') this.terminerEtirement();
            else if (mode === 'lasso') this.terminerLasso(ev);
            else this.clicPartition(e);   // pas de mouvement franc : un clic ordinaire
        };
        window.addEventListener('pointermove', surMouvement);
        window.addEventListener('pointerup', surRelache);
    }

    /**
     * L'évènement SONNANT sous le pointeur, ou `null` (silence, espace vide, hors partition). Sert à
     * décider si un glisser peut être un étirement de durée : on n'étire pas le vide.
     */
    noteSousLePointeur(e) {
        const cible = this.cibleDepuisClic(e);
        if (!cible) return null;
        const evenement = this.editeur.partition.mesures[cible.mesure]?.voix[cible.voix]?.evenements[cible.evenement];
        if (!evenement || evenement.silence || !evenement.notes.length) return null;
        return cible;
    }

    /**
     * ÉTIREMENT D'UNE DURÉE À LA SOURIS — le geste demandé pour régler « la longueur de la note à
     * tenir » sans passer par la palette.
     *
     * APPLIQUÉ AU RELÂCHEMENT, PAS EN CONTINU. Changer une durée peut faire déborder la mesure et
     * déclencher une répartition sur des mesures neuves (voir Editeur._essaierNouvelleDuree) : le
     * faire à chaque pixel remettrait la partition en page des dizaines de fois par geste, et
     * laisserait autant d'entrées d'annulation. On montre donc la figure VISÉE pendant le glisser, et
     * on ne touche au document qu'une fois, à la fin — un seul Ctrl+Z pour tout défaire.
     */
    demarrerEtirement(cible) {
        this.editeur.placerCurseur(cible.mesure, cible.evenement, cible.corde, cible.voix);
        const valeur = this.editeur.evenementCourant().duree.valeur;
        this._etirement = { indexDepart: VALEURS_FIGURES.indexOf(valeur), valeurVisee: valeur };
    }

    etendreEtirement(dx) {
        if (!this._etirement) return;
        // Un cran par PAS_ETIREMENT pixels : assez large pour qu'un tremblement ne change rien, assez
        // court pour parcourir toute l'échelle des figures sans traverser l'écran.
        const PAS_ETIREMENT = 34;
        const crans = Math.round(dx / PAS_ETIREMENT);
        // Vers la DROITE = plus LONG. Les valeurs vont de la ronde (1) à la triple-croche (32) : plus
        // la valeur est grande, plus la figure est brève — l'index décroît donc quand on allonge.
        const i = Math.max(0, Math.min(VALEURS_FIGURES.length - 1, this._etirement.indexDepart - crans));
        const valeur = VALEURS_FIGURES[i];
        if (valeur === this._etirement.valeurVisee) return;
        this._etirement.valeurVisee = valeur;
        this.message(`Durée : ${NOMS_FIGURES[i]}`, 1200);
    }

    terminerEtirement() {
        const etirement = this._etirement;
        this._etirement = null;
        if (!etirement) return;
        if (etirement.valeurVisee === VALEURS_FIGURES[etirement.indexDepart]) return;   // rien n'a changé
        this.editeur.appliquerDuree(etirement.valeurVisee);
        if (this.editeur.derniereErreur) { this.message(this.editeur.derniereErreur); this.editeur.derniereErreur = null; }
    }

    /**
     * LE GESTE TACTILE SUR LA PARTITION, ses trois issues possibles :
     *   • TAP franc (doigt levé sans avoir bougé) → place le curseur, comme un clic ;
     *   • APPUI MAINTENU (550 ms sans bouger) → ouvre le menu contextuel, l'équivalent tactile du
     *     clic droit — sans lui, supprimer/insérer sont purement inatteignables au doigt, un
     *     téléphone n'ayant pas de second bouton ;
     *   • GLISSER → on ne fait RIEN, et c'est le but : le navigateur fait défiler la partition (voir
     *     `touch-action: pan-x pan-y` dans style.css), seul moyen d'atteindre le reste du morceau.
     *
     * Le tap est traité ICI plutôt que laissé au `click` de synthèse du navigateur : ce dernier
     * arrive après un délai variable, et surtout il arriverait AUSSI après un appui long, rouvrant
     * aussitôt le curseur sur la note dont on vient d'ouvrir le menu.
     *
     * Les réglages (550 ms, 10 px) sont ceux, éprouvés, de HarmoHub, plutôt que deux nouveaux nombres
     * inventés : même geste, même famille d'applications, même impression sous le doigt. La tolérance
     * compte autant que le délai — un doigt posé n'est jamais parfaitement immobile, sans elle l'appui
     * long ne se déclencherait presque jamais ; trop grande, elle volerait le défilement.
     */
    demarrerGesteTactile(e) {
        const DELAI = 550, TOLERANCE = 10;
        const depart = { x: e.clientX, y: e.clientY };
        let minuterie = null;
        let resolu = false;   // le menu s'est ouvert, ou le doigt a franchement glissé : plus de tap

        const detacher = () => {
            if (minuterie) { clearTimeout(minuterie); minuterie = null; }
            window.removeEventListener('pointermove', surMouvement);
            window.removeEventListener('pointerup', surRelache);
            window.removeEventListener('pointercancel', surAnnulation);
        };
        const surMouvement = (ev) => {
            if (resolu) return;
            // Un défilement franc annule l'appui long ET le tap : on voulait parcourir la partition,
            // pas y écrire.
            if (Math.hypot(ev.clientX - depart.x, ev.clientY - depart.y) > TOLERANCE) {
                resolu = true;
                detacher();
            }
        };
        const surRelache = () => {
            detacher();
            if (!resolu) this.clicPartition(e);   // doigt levé sans avoir bougé : un tap
        };
        const surAnnulation = () => { resolu = true; detacher(); };

        minuterie = setTimeout(() => {
            minuterie = null;
            resolu = true;
            detacher();
            this.ouvrirMenuContextuel(e);
        }, DELAI);

        window.addEventListener('pointermove', surMouvement, { passive: true });
        window.addEventListener('pointerup', surRelache);
        window.addEventListener('pointercancel', surAnnulation);
    }

    /** Crée l'overlay du rectangle : un simple <div>, pas une primitive de la liste d'affichage —
     * un geste d'interface transitoire n'a rien à faire dans ce que partagent l'écran et le PDF. */
    demarrerLasso(depart) {
        const el = document.createElement('div');
        el.className = 'lasso-selection';
        this.el.zone.appendChild(el);
        this._lasso = { el, depart };
        this.positionnerLasso(depart);
    }

    positionnerLasso(point) {
        const { el, depart } = this._lasso;
        const rz = this.el.zone.getBoundingClientRect();
        const x1 = Math.min(depart.x, point.x) - rz.left + this.el.zone.scrollLeft;
        const y1 = Math.min(depart.y, point.y) - rz.top + this.el.zone.scrollTop;
        el.style.left = `${x1}px`;
        el.style.top = `${y1}px`;
        el.style.width = `${Math.abs(point.x - depart.x)}px`;
        el.style.height = `${Math.abs(point.y - depart.y)}px`;
    }

    etendreLasso(ev) {
        if (this._lasso) this.positionnerLasso({ x: ev.clientX, y: ev.clientY });
    }

    /**
     * Relâche du lasso : le rectangle passe en coordonnées DE PAGE (la même conversion que
     * clicPartition, pour que sélection et clic désignent toujours le même endroit), et toute note
     * dont l'ancrage tombe dedans — sur la tablature, où se fait la saisie — entre dans la sélection.
     */
    terminerLasso(ev) {
        const { depart } = this._lasso;
        this._lasso.el.remove();
        this._lasso = null;
        const svg = this.el.feuille.querySelector('svg');
        if (!svg || !this.page) return;

        const boite = svg.getBoundingClientRect();
        const versPage = (clientX, clientY) => ({
            x: (clientX - boite.left) * (this.page.largeur / boite.width),
            y: (clientY - boite.top) * (this.page.hauteur / boite.height),
        });
        const a = versPage(depart.x, depart.y), b = versPage(ev.clientX, ev.clientY);
        const xMin = Math.min(a.x, b.x), xMax = Math.max(a.x, b.x);
        const yMin = Math.min(a.y, b.y), yMax = Math.max(a.y, b.y);

        const ST = this.page.geo.ST;
        const nouvelle = new Set();
        for (const evt of this.page.ancrages.evenements) {
            for (const note of evt.ref.notes) {
                const y = evt.yTab + note.corde * ST;
                if (evt.x >= xMin && evt.x <= xMax && y >= yMin && y <= yMax) {
                    nouvelle.add(`${evt.mesure}:${evt.voix}:${evt.evenement}:${note.corde}`);
                }
            }
        }
        this.selectionNotes = nouvelle;
        this.el.zone.focus();
        this.dessiner();
    }

    /** Surlignage des notes sélectionnées, une case à la fois, sur la tablature. */
    marquesSelection() {
        if (!this.selectionNotes.size || !this.page) return [];
        const ST = this.page.geo.ST;
        const marques = [];
        for (const evt of this.page.ancrages.evenements) {
            for (const note of evt.ref.notes) {
                if (!this.selectionNotes.has(`${evt.mesure}:${evt.voix}:${evt.evenement}:${note.corde}`)) continue;
                const y = evt.yTab + note.corde * ST;
                marques.push({ t: 'rect', x: evt.x - ST * 0.62, y: y - ST * 0.56, w: ST * 1.24, h: ST * 1.12, couleur: 'var(--selection-halo)' });
            }
        }
        return marques;
    }

    /**
     * Bande de boucle de lecture : une piste fine sous la TAB de chaque système visible, où glisser
     * (souris ou doigt, voir demarrerGesteBoucle) une zone de mesures à rejouer en boucle — le même
     * principe que HarmoHub (loopRange), déplacé sous la grille plutôt que sur les numéros de
     * mesure : exactement l'espace qu'occupait la réglette avant son retrait, resté vide depuis.
     *
     * TOUJOURS UNE PISTE PAR SYSTÈME, même sans aucune boucle active, INVISIBLE (couleur alpha nul) :
     * c'est elle qui reçoit le geste de départ (voir mesureDansBandeBoucle) et qui porte
     * `touch-action: none` (voir style.css, .bande-boucle) — sans elle, un geste au doigt à cet
     * endroit ferait défiler la partition au lieu de dessiner une zone, exactement ce que ce module
     * évite déjà pour tout le reste de la partition (voir demarrerGesteTactile). La zone elle-même,
     * quand il y en a une, se dessine PAR-DESSUS cette piste (couleur bien visible cette fois) —
     * l'ordre ne change rien ici, la piste étant invisible.
     */
    marquesBoucle() {
        if (!this.page) return [];
        const S = this.page.geo.S;
        const systemes = this.systemesVisibles() || this.page.ancrages.systemes;
        const boucle = this.lecteur.boucleLecture;
        const marques = [];
        for (const sys of systemes) {
            const y = sys.yBas + HAUT_BANDE_BOUCLE * S;
            const h = (this.basBandeDuSysteme(sys) - HAUT_BANDE_BOUCLE) * S;   // zone de SAISIE — grandit au doigt
            marques.push({ t: 'rect', x: sys.xDebut, y, w: sys.xFin - sys.xDebut, h,
                couleur: 'rgba(255, 152, 0, 0)', classe: 'bande-boucle' });

            // PENDANT UN GESTE, LA BANDE POSÉE S'EFFACE et laisse l'aperçu seul (voir
            // poserApercuBoucle) : sans cela on verrait DEUX bandes, l'ancienne figée sous la
            // nouvelle qui suit le doigt — et on ne saurait plus laquelle on est en train de définir.
            if (!boucle || this._gesteBoucle) continue;
            const touche = this.page.ancrages.mesures.filter(a =>
                a.systeme === sys.index && a.index >= boucle.debut && a.index <= boucle.fin);
            if (!touche.length) continue;
            // LES BORNES FINES DÉCIDENT DES DEUX BOUTS (voir player.js#bornesBoucle) : une boucle
            // peut commencer ou finir EN COURS de mesure depuis qu'elle se cale au temps. Sur les
            // systèmes du MILIEU d'une longue boucle, en revanche, il n'y a pas de bout à placer —
            // la bande y couvre toute la largeur, et c'est `touche` qui le dit.
            const bornes = this.lecteur.bornesBoucle(this.editeur.partition);
            const portDebut = touche.some(a => a.index === boucle.debut)
                ? this.lieuDeLaPosition(bornes.debut) : null;
            const portFin = touche.some(a => a.index === boucle.fin)
                ? this.lieuDeLaPosition(bornes.fin) : null;
            const x1 = portDebut ? portDebut.x : Math.min(...touche.map(a => a.x));
            const x2 = portFin ? portFin.x : Math.max(...touche.map(a => a.xFin));
            // Marge d'affichage (voir MARGE_BOUCLE_LATERALE/VERTICALE) : x1/x2/y/h restent les
            // valeurs BRUTES (zone de saisie, celle ci-dessus) ; xAff*/yAff/hAff sont celles, en
            // retrait, qu'on montre réellement — halo ET poignées ci-dessous. L'ÉPAISSEUR visuelle
            // (hVisuel) reste TOUJOURS celle qu'aurait la bande à la SOURIS, CENTRÉE dans la zone de
            // saisie ci-dessus — laquelle, elle, grandit au doigt (voir basBandeBoucle) : l'œil ne
            // voit donc jamais cette différence, seule la PRISE tout autour s'élargit.
            const margeCote = MARGE_BOUCLE_LATERALE * S;
            const xAff1 = x1 + margeCote, xAff2 = x2 - margeCote;
            const hAff = Math.max(0, (BAS_BANDE_BOUCLE - HAUT_BANDE_BOUCLE - 2 * MARGE_BOUCLE_VERTICALE) * S);
            const yAff = y + (h - hAff) / 2;
            // `classe: 'bande-boucle'` ICI AUSSI (retour utilisateur : « je n'arrive pas à définir
            // la barre [...] mon téléphone veut faire bouger l'écran lorsque j'essaye de la placer
            // ou de l'étirer ») : ce halo et les deux poignées ci-dessous se dessinent PAR-DESSUS la
            // piste invisible (voir le docblock de la fonction) — au DOIGT, une fois une boucle déjà
            // posée, c'est donc EUX que le doigt touche en premier, jamais la piste dessous. Sans
            // leur propre `touch-action: none` (porté par cette classe, voir style.css), ce
            // sont des rectangles ORDINAIRES aux yeux du navigateur, qui reprend alors la main pour
            // faire défiler la page — exactement le défaut que la piste invisible seule ne suffisait
            // plus à éviter dès qu'une boucle existait déjà.
            marques.push({ t: 'rect', x: xAff1, y: yAff, w: Math.max(0, xAff2 - xAff1), h: hAff, couleur: 'var(--lecture-halo)', classe: 'bande-boucle' });

            // POIGNÉES (voir LARGEUR_POIGNEE_BOUCLE) — seulement sur le VRAI bord GLOBAL de la
            // boucle (`touche` inclut l'ancrage de boucle.debut/fin lui-même), jamais sur un simple
            // retour à la ligne d'une boucle qui court sur plusieurs systèmes : ce bord-LÀ n'a rien à
            // étirer, il n'existe que parce que la portée a tourné (même distinction que HarmoHub,
            // voir buildLoopRangeBars). Centrées sur le VRAI bord de mesure (x1/x2, pas xAff1/xAff2)
            // — le même x que poigneeBoucleAuPoint : la poignée se voit EXACTEMENT là où elle se
            // saisit, quitte à déborder un peu du halo désormais en retrait. Couleur PLEINE
            // (`--lecture`, celle du curseur de lecture) plutôt que le halo translucide du reste de
            // la bande : un repère franc, pas une nuance de plus dans le dégradé.
            // `classe: 'bande-boucle'` ICI AUSSI, même raison que le halo juste au-dessus : la
            // poignée est ce que le doigt vise PRÉCISÉMENT pour étirer (retour utilisateur), donc le
            // premier rectangle qu'il touche — sans son propre touch-action:none, c'est justement
            // LÀ que le navigateur reprenait la main pour faire défiler.
            // `poignee-boucle` EN PLUS de `bande-boucle` : la première sert à les RETROUVER pour la
            // surbrillance au survol (retour utilisateur : « en plus du curseur qui change, il faut
            // mettre en surbrillance les 2 petites poignées »), la seconde porte le touch-action.
            const largeurPx = LARGEUR_POIGNEE_BOUCLE * S;
            if (touche.some(a => a.index === boucle.debut)) {
                marques.push({ t: 'rect', x: x1 - largeurPx / 2, y: yAff, w: largeurPx, h: hAff, couleur: 'var(--lecture)', classe: 'bande-boucle poignee-boucle poignee-debut' });
            }
            if (touche.some(a => a.index === boucle.fin)) {
                marques.push({ t: 'rect', x: x2 - largeurPx / 2, y: yAff, w: largeurPx, h: hAff, couleur: 'var(--lecture)', classe: 'bande-boucle poignee-boucle poignee-fin' });
            }
        }
        return marques;
    }

    /**
     * CALE UN INSTANT SUR LE TEMPS LE PLUS PROCHE — ce à quoi la bande de boucle se repose quand on
     * la lâche.
     *
     * LE TEMPS, NI LA MESURE NI LA CROCHE, et c'est une décision prise avec l'utilisateur (« penses-tu
     * que c'est une bonne idée de placer la barre à la croche près ? ») :
     *   • UNE BORNE DE BOUCLE S'ENTEND. Au rebouclage, le point de reprise est un évènement
     *     rythmique ; s'il tombe une croche à côté de la phrase, on entend un faux pas à chaque tour,
     *     alors que c'est justement la pulsation qu'on cherche à installer en bouclant. Sur les huit
     *     croches d'une mesure, une ou deux sont des frontières musicales — affiner ne multiplie donc
     *     pas les bonnes réponses, mais les mauvaises.
     *   • LE TEMPS EST TOUJOURS UNE POSITION MUSICALE, dans toutes les signatures. La demi-mesure ne
     *     l'est pas : en 3/4 elle tombe au milieu du temps 2, frontière de rien.
     *   • LA CIBLE TIENT SOUS LE DOIGT. Mesuré à l'écran : au zoom par défaut une mesure fait 204px,
     *     donc 51px le temps et 26px la croche — quand le repère tactile que le projet s'impose
     *     partout ailleurs est de 44px (voir --h-bouton). La croche demanderait de viser plus fin que
     *     le geste ne sait l'exprimer.
     * Et `uniteDeGroupement` est déjà la fonction qui décide de la ligature et des clics du métronome :
     * on réutilise la notion de temps du projet plutôt que d'en inventer une seconde.
     */
    callerAuTemps(position) {
        const partition = this.editeur.partition;
        const i = this.mesureDeLaPosition(position);
        const debut = positionDebutMesure(partition, i);
        const capacite = capaciteMesure(partition, i);
        const temps = uniteDeGroupement(signatureEffective(partition, i)) || 1;
        const cale = debut + Math.round((position - debut) / temps) * temps;
        // BORNÉ À LA MESURE : arrondir le dernier temps vers le haut donnerait une position au-delà
        // de la barre, c'est-à-dire déjà dans la mesure suivante — la bande y gagnerait un bout de
        // mesure que le doigt n'a jamais survolé.
        return Math.max(debut, Math.min(debut + capacite, cale));
    }

    /**
     * L'INSTANT SOUS UN POINT D'ÉCRAN, avec le système et l'abscisse qui vont avec — ce que le geste
     * de boucle suit pendant qu'on glisse.
     *
     * L'ABSCISSE RENDUE EST CELLE DU POINTEUR, pas celle de l'instant recalculé : la bande doit coller
     * au doigt, pas à la note la plus proche. `position`, lui, est l'instant que cette abscisse
     * désigne — c'est LUI qu'on calera au temps au relâchement.
     *
     * @param {number} [mesureImposee] mesure à utiliser plutôt que celle sous le point — pour le
     *   tout premier appel d'un geste, où l'appelant a déjà fait le tri (bande, poignée…).
     */
    instantSousLePoint(clientX, clientY, mesureImposee = null) {
        if (!this.page) return null;
        const svg = this.el.feuille.querySelector('svg');
        if (!svg) return null;
        const boite = svg.getBoundingClientRect();
        const x = (clientX - boite.left) * (this.page.largeur / boite.width);
        const y = (clientY - boite.top) * (this.page.hauteur / boite.height);
        // LE SYSTÈME LE PLUS PROCHE EN Y, jamais une bande stricte : une fois le geste engagé, un
        // tremblement vertical ne doit pas l'interrompre (même raison qu'à mesureLaPlusProche).
        let systeme = null, ecart = Infinity;
        for (const sys of this.page.ancrages.systemes) {
            const e = Math.abs(y - sys.yBas);
            if (e < ecart) { ecart = e; systeme = sys; }
        }
        if (!systeme) return null;
        const iMesure = mesureImposee ?? this._mesureDuSysteme(systeme, x);
        if (iMesure == null) return null;
        // L'ABSCISSE EST BORNÉE AU SYSTÈME : glisser au-delà du dernier bord ne doit pas dessiner une
        // bande qui déborde dans la marge.
        const xBorne = Math.max(systeme.xDebut, Math.min(systeme.xFin, x));
        return { systeme: systeme.index, x: xBorne, position: this.positionDeLAbscisse(iMesure, xBorne), mesure: iMesure };
    }

    /**
     * Pose la boucle entre deux INSTANTS déjà calés (voir callerAuTemps), en les traduisant dans le
     * modèle « mesure d'ancrage + décalage » du lecteur (voir player.js#bornesBoucle).
     *
     * UNE MESURE MINIMUM, jamais une boucle de longueur nulle : lâcher le doigt sans avoir vraiment
     * glissé donnerait sinon une boucle qui ne contient rien, sur laquelle le transport tournerait à
     * vide. Le cas se produit dès qu'on relâche entre deux temps très proches.
     */
    poserBoucleEntre(positionDebut, positionFin, { redessiner = true } = {}) {
        const partition = this.editeur.partition;
        if (positionFin - positionDebut < 1e-9) return this.poserBoucleSurMesure(this.mesureDeLaPosition(positionDebut));
        const iDebut = this.mesureDeLaPosition(positionDebut);
        // LA FIN S'ANCRE À LA MESURE QU'ELLE TERMINE, pas à celle qui suit : une fin tombant pile sur
        // une barre appartient à la mesure d'AVANT (c'est sa dernière frontière), sans quoi la boucle
        // s'ancrerait à une mesure qu'elle ne couvre pas — et se déplacerait avec elle à l'édition.
        let iFin = this.mesureDeLaPosition(positionFin);
        if (positionFin <= positionDebutMesure(partition, iFin) + 1e-9 && iFin > iDebut) iFin -= 1;
        this.lecteur.definirBoucle(partition, iDebut, iFin, {
            debutDansMesure: positionDebut - positionDebutMesure(partition, iDebut),
            finDansMesure: positionFin - positionDebutMesure(partition, iFin),
        });
        if (redessiner) this.dessiner();
    }

    /**
     * BRANCHE LA BANDE DE BOUCLE SUR L'HISTORIQUE D'ANNULATION (retour utilisateur : « le bouton
     * undo/redo doit aussi concerner la mise en place de la barre de lecture »).
     *
     * CE QUI A DÛ ÊTRE REVU. Une décision antérieure gardait délibérément la boucle HORS de
     * l'historique, et pour une raison qui tenait : l'ancrage par `id` avait justement été choisi
     * pour n'avoir PAS à la porter dans l'historique (« six endroits à ne jamais oublier, dont un
     * qu'on oublierait »). Cette raison-là reste valable et n'est pas défaite : l'historique ne
     * DÉCALE toujours rien, il restitue une photo, et les numéros continuent de se déduire des
     * ancres à chaque édition. Ce qui change, c'est qu'une photo voyage maintenant avec chaque
     * étape — sans que l'éditeur sache de quoi elle est faite (voir Editeur, l'annexe).
     *
     * DEUX EFFETS, dont le second est gratuit :
     *   • annuler la POSE d'une boucle la retire, et rétablir la remet ;
     *   • annuler une édition de NOTES remet aussi la boucle telle qu'elle était à ce moment — ce
     *     qui est la seule réponse cohérente, puisque l'état du document remonte avec elle.
     */
    brancherAnnexeHistorique() {
        this.editeur.lireAnnexe = () => this.lecteur.instantaneBoucle();
        this.editeur.ecrireAnnexe = (v) => this.lecteur.restaurerBoucle(this.editeur.partition, v);
    }

    /**
     * OUVRE UNE ÉTAPE D'ANNULATION POUR LA BANDE, et rend la fonction qui la CLÔT.
     *
     * UNE ÉTAPE PAR GESTE, jamais une par temps franchi. Pendant un glisser, la boucle est reposée
     * dans le lecteur à chaque changement de plage calée (pour que ça s'entende tout de suite, voir
     * demarrerGesteBoucle) : enregistrer une étape à chacun de ces moments remplirait la pile de
     * dizaines d'états intermédiaires, et défaire un seul geste demanderait autant de Ctrl+Z. On
     * photographie donc l'état AVANT, et on n'enregistre qu'une fois, à la fin.
     *
     * RIEN N'EST ENREGISTRÉ SI RIEN N'A CHANGÉ : un appui qui n'aboutit pas, un geste annulé sans
     * effet, ne doivent pas coûter un Ctrl+Z pour rien.
     */
    etapeBoucle() {
        const avant = this.lecteur.instantaneBoucle();
        return () => {
            const apres = this.lecteur.instantaneBoucle();
            if (memesBornesBoucle(avant, apres)) return;
            this.editeur.memoriserAnnexe(avant);
            this.rafraichirInfos();
        };
    }

    /** Cale deux instants bruts au temps le plus proche, puis pose la boucle entre eux — le chemin
     *  commun des deux gestes (définir, étirer), pour qu'ils ne calent jamais différemment. */
    poserBornesCalees(positionA, positionB, options = {}) {
        const a = this.callerAuTemps(positionA);
        const b = this.callerAuTemps(positionB);
        this.poserBoucleEntre(Math.min(a, b), Math.max(a, b), options);
    }

    /** Pose la boucle sur UNE mesure entière — le clic simple, et le repli de poserBoucleEntre. */
    poserBoucleSurMesure(iMesure) {
        this.lecteur.definirBoucle(this.editeur.partition, iMesure, iMesure);
        this.dessiner();
    }

    /**
     * LE BAS DE LA BANDE DE SAISIE D'UN SYSTÈME — une seule fonction, lue par le DESSIN de la piste
     * invisible et par la DÉTECTION du geste, pour qu'ils ne puissent pas répondre différemment.
     *
     * Le creux jusqu'au système suivant est mesuré à chaque fois plutôt que supposé : il vaut 6,6 S
     * au zoom par défaut mais se resserre en bas de course, et c'est précisément là que la version
     * précédente rendait la cible inatteignable (mesuré : 30×32 px au zoom minimum).
     */
    basBandeDuSysteme(sys) {
        const S = this.page.geo.S;
        const liste = this.page.ancrages.systemes;
        const i = liste.findIndex(s => s.index === sys.index);
        const suivant = i >= 0 && i + 1 < liste.length ? liste[i + 1] : null;
        const creuxEnS = suivant ? (suivant.y - sys.yBas) / S : Infinity;
        return basBandeBoucle(S, creuxEnS);
    }

    /** La mesure qui contient cet instant — la DERNIÈRE quand l'instant tombe pile sur la barre de
     *  fin du morceau, qu'aucune mesure ne contient au sens strict. */
    mesureDeLaPosition(position) {
        const partition = this.editeur.partition;
        for (let k = 0; k < partition.mesures.length; k++) {
            if (position < positionDebutMesure(partition, k) + capaciteMesure(partition, k) - 1e-9) return k;
        }
        return Math.max(0, partition.mesures.length - 1);
    }

    /**
     * LES RECTANGLES D'UNE BANDE allant d'un bout à l'autre, système par système — la géométrie
     * PARTAGÉE par la bande posée, l'aperçu tracé pendant le geste et le fantôme de survol.
     *
     * UNE SEULE GÉOMÉTRIE POUR TROIS ÉTATS, et c'est tout l'intérêt : l'aperçu qu'on voit en glissant
     * doit être la MÊME forme que la bande qui se posera au relâchement. Deux calculs finiraient par
     * ne plus tomber d'accord, et le geste montrerait alors une chose pour en poser une autre — le
     * défaut exact qu'on corrige ici, aggravé.
     *
     * @param {number} sysA index du système du premier bout, `xA` son abscisse ; idem `sysB`/`xB`.
     */
    rectsBoucle(sysA, xA, sysB, xB) {
        if (!this.page) return [];
        const S = this.page.geo.S;
        const [dSys, dX, fSys, fX] = sysA <= sysB ? [sysA, xA, sysB, xB] : [sysB, xB, sysA, xA];
        const rects = [];
        for (const sys of this.page.ancrages.systemes) {
            if (sys.index < dSys || sys.index > fSys) continue;
            // Sur le PREMIER système la bande part du bout ; sur le DERNIER elle s'y arrête ; entre
            // les deux elle court d'un bord à l'autre — une boucle qui enjambe un retour à la ligne
            // n'a pas de bout à y placer.
            let x1 = sys.index === dSys ? dX : sys.xDebut;
            let x2 = sys.index === fSys ? fX : sys.xFin;
            if (dSys === fSys) { x1 = Math.min(dX, fX); x2 = Math.max(dX, fX); }
            const y = sys.yBas + HAUT_BANDE_BOUCLE * S;
            const h = (this.basBandeDuSysteme(sys) - HAUT_BANDE_BOUCLE) * S;
            const hAff = Math.max(0, (BAS_BANDE_BOUCLE - HAUT_BANDE_BOUCLE - 2 * MARGE_BOUCLE_VERTICALE) * S);
            rects.push({ systeme: sys.index, x: Math.min(x1, x2), w: Math.abs(x2 - x1),
                y: y + (h - hAff) / 2, h: hAff, xBrut1: x1, xBrut2: x2 });
        }
        return rects;
    }

    /**
     * FAIT DÉFILER LA PARTITION QUAND LE DOIGT APPROCHE DU BORD, le temps d'un geste de boucle.
     *
     * LE DÉFAUT (retour utilisateur, téléphone) : « je n'arrive pas à l'étirer sur la droite :
     * lorsque mon doigt glisse sur la droite pendant que j'étire la barre, la partition doit se
     * décaler automatiquement et progressivement pour que je puisse englober plusieurs mesures ». La
     * boucle était donc bornée à ce qui tenait à l'écran — sur un téléphone, mesuré, UNE MESURE PAR
     * SYSTÈME : il était littéralement impossible d'en boucler deux.
     *
     * POURQUOI LE NAVIGATEUR NE LE FAIT PAS TOUT SEUL : parce qu'on le lui interdit, et à raison.
     * `_bloquerDefilementPendantGeste` refuse le défilement natif pendant tout le geste, sans quoi le
     * doigt ferait glisser la page au lieu de tracer la bande (c'est un retour utilisateur antérieur,
     * capture à l'appui). Ayant confisqué le défilement, c'est à nous de le rendre — mais gouverné
     * par le geste, pas par le doigt.
     *
     * ET LE DÉFILEMENT EST SURTOUT VERTICAL, ce qui n'est pas évident quand on lit « glisse sur la
     * droite ». Mesuré sur un écran de 390px : la partition NE déborde PAS horizontalement (elle est
     * mise en page à la largeur de l'écran) mais déborde en hauteur, 2023px pour 456 visibles, avec
     * une seule mesure par système. Englober plusieurs mesures, au doigt, veut donc dire DESCENDRE —
     * on glisse vers la droite, on arrive au bout de la ligne, et c'est la suite qui doit monter à
     * notre rencontre. Les deux axes sont traités, mais c'est le vertical qui débloque le cas réel.
     *
     * PROGRESSIVEMENT, comme demandé : la vitesse croît avec le dépassement, de zéro au bord de la
     * zone de confort jusqu'à VITESSE_MAX collé au bord. Une vitesse constante donnerait un départ
     * brutal et impossible à doser.
     *
     * @param {Function} rappel appelé après chaque pas de défilement, avec le dernier point du
     *   pointeur — c'est lui qui redessine l'aperçu. INDISPENSABLE : le doigt ne bouge pas pendant
     *   que la page défile, mais la MUSIQUE bouge sous lui, donc la bande doit s'allonger quand même.
     */
    defilementAuBord(rappel) {
        const zone = this.el.zone;
        const MARGE = 64;          // px depuis le bord où le défilement s'amorce
        // LENTEMENT, et c'est une demande explicite (« la partition doit défiler lentement pour que
        // je puisse continuer à étirer »). La première version montait à 24 px par image, soit
        // ~1270 px/s mesurés : sur un téléphone où une mesure fait 200 à 400 px, cela traversait
        // trois à six mesures par seconde — impossible à doser, on dépassait sa cible avant de
        // pouvoir lever le doigt. À 9 px par image on parcourt ~540 px/s, soit une à deux mesures
        // par seconde : on voit passer les barres de mesure et on s'arrête où l'on veut.
        const VITESSE_MAX = 9;
        let dernier = null, anim = null;
        const depassement = (p, min, max) => (p < min + MARGE ? p - (min + MARGE)
            : (p > max - MARGE ? p - (max - MARGE) : 0));
        // RAMPE AU CARRÉ plutôt que linéaire : sur la plus grande partie de la marge le défilement
        // reste très lent, et n'atteint sa pleine vitesse qu'au ras du bord. C'est ce qui rend le
        // réglage possible au doigt — avec une rampe linéaire, la moitié de la marge donnait déjà la
        // moitié de la vitesse maximale, trop rapide pour viser.
        const vitesse = (d) => {
            if (d === 0) return 0;
            const part = Math.min(1, Math.abs(d) / MARGE);
            return Math.sign(d) * Math.max(0.5, part * part * VITESSE_MAX);
        };
        const pas = () => {
            anim = null;
            if (!dernier) return;
            const r = zone.getBoundingClientRect();
            const vx = vitesse(depassement(dernier.x, r.left, r.right));
            const vy = vitesse(depassement(dernier.y, r.top, r.bottom));
            if (vx || vy) {
                const avantX = zone.scrollLeft, avantY = zone.scrollTop;
                zone.scrollLeft += vx;
                zone.scrollTop += vy;
                // RIEN N'A BOUGÉ -> RIEN À REDESSINER : arrivé en butée, on continue de tourner sans
                // travail inutile, plutôt que de recalculer la bande soixante fois par seconde pour
                // le même résultat.
                if (zone.scrollLeft !== avantX || zone.scrollTop !== avantY) rappel(dernier);
            }
            planifier();
        };
        const planifier = () => { if (anim === null && dernier) anim = requestAnimationFrame(pas); };
        return {
            suivre: (ev) => { dernier = { x: ev.clientX, y: ev.clientY }; planifier(); },
            arreter: () => {
                dernier = null;
                if (anim !== null) cancelAnimationFrame(anim);
                anim = null;
            },
        };
    }

    /**
     * TRACE L'APERÇU DE LA BANDE DIRECTEMENT DANS LE SVG VIVANT — sans repasser par `dessiner()`.
     *
     * POURQUOI PAS `dessiner()` (le défaut signalé : « je ne la vois pas apparaître sous mon doigt »).
     * L'ancienne version appelait bien `dessiner()` pendant le geste, mais seulement au FRANCHISSEMENT
     * D'UNE MESURE : la bande sautait donc de mesure en mesure au lieu de suivre le doigt, et entre
     * deux sauts rien ne bougeait. Suivre le pixel par `dessiner()` serait pire : c'est une remise en
     * page COMPLÈTE du morceau (mise en page, gravure, sérialisation SVG) à chaque évènement de
     * pointeur — du travail jeté soixante fois par seconde.
     *
     * ON ÉCRIT DONC QUELQUES `<rect>` À LA MAIN dans le SVG déjà en place. Les unités du SVG sont
     * celles des ancrages (voir render/svg.js : `viewBox` part de `page.largeur`, et `ech` n'est
     * qu'un arrondi), donc aucune conversion. Le prochain `dessiner()` reconstruit l'`innerHTML` et
     * efface cet aperçu de lui-même — c'est exactement ce qu'on veut au relâchement, où la VRAIE
     * bande prend sa place.
     *
     * @param {Array} rects  sortie de `rectsBoucle`, ou `[]` pour effacer.
     * @param {string} genre 'apercu' (le geste en cours) ou 'fantome' (le survol).
     */
    poserApercuBoucle(rects, genre = 'apercu') {
        const svg = this.el.feuille.querySelector('svg');
        if (!svg) return;
        // ON RETIENT L'APERÇU COURANT, et c'est le défilement automatique qui l'exige : il fait
        // défiler la zone, ce qui déclenche `surDefilement`, qui peut appeler `dessiner()` — lequel
        // reconstruit l'`innerHTML` du SVG et emporte l'aperçu avec. Sans cette mémoire, la bande
        // clignoterait ou disparaîtrait au moment précis où elle doit s'allonger.
        this._apercuCourant = rects.length ? { rects, genre } : null;
        let g = svg.querySelector('#apercu-boucle');
        if (!rects.length) { if (g) g.remove(); return; }
        if (!g) {
            g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('id', 'apercu-boucle');
            // `pointer-events: none` : l'aperçu se dessine SOUS le doigt, il ne doit jamais lui voler
            // l'évènement suivant — sans quoi le geste s'interromprait dès le premier rectangle posé.
            g.setAttribute('pointer-events', 'none');
            svg.appendChild(g);
        }
        g.setAttribute('class', genre === 'fantome' ? 'fantome-boucle' : 'apercu-boucle');

        // LES DEUX BOUTS PLEINS, comme la bande posée (voir marquesBoucle, LARGEUR_POIGNEE_BOUCLE) —
        // et ce n'est pas une coquetterie. Mesuré en capture : le halo SEUL est bien trop pâle pour
        // se remarquer sous le doigt, et la bande posée ne doit sa lisibilité qu'à ses deux poignées
        // pleines. Un aperçu sans elles reste exactement aussi difficile à voir que ce dont
        // l'utilisateur se plaignait. Les deux bouts font en plus la promesse juste : ce qu'on
        // dessine ressemble à ce qu'on obtiendra.
        // PAS DE BOUTS AU FANTÔME, en revanche : lui ne dit pas « voici la bande » mais « on peut en
        // poser une ici », et son cadre en tirets tient déjà ce discours-là.
        const S = this.page ? this.page.geo.S : 10;
        const bouts = [];
        if (genre !== 'fantome' && rects.length) {
            const l = LARGEUR_POIGNEE_BOUCLE * S;
            const premier = rects[0], dernier = rects[rects.length - 1];
            bouts.push({ x: premier.x - l / 2, y: premier.y, w: l, h: premier.h, plein: true });
            bouts.push({ x: dernier.x + dernier.w - l / 2, y: dernier.y, w: l, h: dernier.h, plein: true });
        }
        const tous = [...rects, ...bouts];
        const voulu = tous.length;
        while (g.childNodes.length > voulu) g.removeChild(g.lastChild);
        while (g.childNodes.length < voulu) {
            g.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'rect'));
        }
        tous.forEach((r, i) => {
            const el = g.childNodes[i];
            el.setAttribute('x', r.x); el.setAttribute('y', r.y);
            el.setAttribute('width', Math.max(0, r.w)); el.setAttribute('height', r.h);
            el.setAttribute('class', r.plein ? 'bout-apercu' : '');
        });
    }

    /**
     * Mesure visée par un point d'écran DANS LA BANDE DE BOUCLE (voir marquesBoucle) — ou `null` hors
     * de cette bande. Même conversion écran -> SVG que cibleDepuisClic ; une bande à part, pour ne
     * jamais confondre ce geste avec celui qui place le curseur.
     */
    mesureDansBandeBoucle(clientX, clientY) {
        if (!this.page) return null;
        const svg = this.el.feuille.querySelector('svg');
        if (!svg) return null;
        const boite = svg.getBoundingClientRect();
        const x = (clientX - boite.left) * (this.page.largeur / boite.width);
        const y = (clientY - boite.top) * (this.page.hauteur / boite.height);
        const S = this.page.geo.S;
        const systeme = this.page.ancrages.systemes.find(s =>
            y >= s.yBas + HAUT_BANDE_BOUCLE * S && y <= s.yBas + this.basBandeDuSysteme(s) * S);
        if (!systeme) return null;
        return this._mesureDuSysteme(systeme, x);
    }

    /**
     * Poignée de boucle (voir marquesBoucle) sous le point d'écran donné — 'debut', 'fin', ou `null`
     * hors de toute poignée. Zone de PRISE bien plus large que le trait visuel (PRISE_POIGNEE_BOUCLE,
     * environ le double de LARGEUR_POIGNEE_BOUCLE) : un doigt vise rarement le pixel exact, et
     * HarmoHub élargit pareillement sa propre zone de préhension au-delà de ce qu'elle montre.
     * MÊME PLAGE VERTICALE que mesureDansBandeBoucle, volontairement : jamais un pixel au-delà de ce
     * que `.bande-boucle` (touch-action: none) couvre déjà, voir la remarque de LARGEUR_POIGNEE_BOUCLE.
     * Testée AVANT mesureDansBandeBoucle par l'appelant (demarrerGeste) : une poignée gagne toujours
     * sur le geste générique « redéfinir depuis ce point » quand les deux zones se recouvrent.
     */
    poigneeBoucleAuPoint(clientX, clientY) {
        const boucle = this.lecteur.boucleLecture;
        if (!boucle || !this.page) return null;
        const svg = this.el.feuille.querySelector('svg');
        if (!svg) return null;
        const boite = svg.getBoundingClientRect();
        const x = (clientX - boite.left) * (this.page.largeur / boite.width);
        const y = (clientY - boite.top) * (this.page.hauteur / boite.height);
        const S = this.page.geo.S;
        const systeme = this.page.ancrages.systemes.find(s =>
            y >= s.yBas + HAUT_BANDE_BOUCLE * S && y <= s.yBas + this.basBandeDuSysteme(s) * S);
        if (!systeme) return null;
        const touche = this.page.ancrages.mesures.filter(a =>
            a.systeme === systeme.index && a.index >= boucle.debut && a.index <= boucle.fin);
        if (!touche.length) return null;
        const prise = prisePoigneeBoucle() * S;
        if (touche.some(a => a.index === boucle.debut)) {
            const x1 = Math.min(...touche.map(a => a.x));
            if (Math.abs(x - x1) <= prise) return 'debut';
        }
        if (touche.some(a => a.index === boucle.fin)) {
            const x2 = Math.max(...touche.map(a => a.xFin));
            if (Math.abs(x - x2) <= prise) return 'fin';
        }
        return null;
    }

    /**
     * Système le plus proche d'un point, en Y — pour la SUITE d'un glisser de boucle déjà commencé
     * (voir demarrerGesteBoucle) : une fois le geste engagé, un tremblement vertical ne doit jamais
     * l'interrompre, à la différence du point de départ (mesureDansBandeBoucle), qui lui reste précis
     * pour ne jamais confisquer un clic destiné à autre chose.
     */
    mesureLaPlusProche(clientX, clientY) {
        if (!this.page) return null;
        const svg = this.el.feuille.querySelector('svg');
        if (!svg) return null;
        const boite = svg.getBoundingClientRect();
        const x = (clientX - boite.left) * (this.page.largeur / boite.width);
        const y = (clientY - boite.top) * (this.page.hauteur / boite.height);
        const systemes = this.page.ancrages.systemes;
        let systeme = null, ecart = Infinity;
        for (const s of systemes) {
            const e = Math.abs(y - s.yBas);
            if (e < ecart) { ecart = e; systeme = s; }
        }
        if (!systeme) return null;
        return this._mesureDuSysteme(systeme, x);
    }

    /** Mesure d'un système donné la plus proche de l'abscisse `x` — partagé par les deux méthodes ci-dessus. */
    _mesureDuSysteme(systeme, x) {
        const mesures = this.page.ancrages.mesures.filter(a => a.systeme === systeme.index);
        if (!mesures.length) return null;
        const dans = mesures.find(a => x >= a.x && x < a.xFin);
        return (dans || (x < mesures[0].x ? mesures[0] : mesures[mesures.length - 1])).index;
    }

    /**
     * EMPÊCHE LE NAVIGATEUR DE S'EMPARER DU GESTE POUR FAIRE DÉFILER, le temps d'un glisser de boucle
     * — et rend la fonction qui débranche tout, à appeler au relâchement.
     *
     * POURQUOI `touch-action: none` NE SUFFIT PAS (retour utilisateur, capture à l'appui : « lorsque
     * je place la boucle orange de gauche à droite, l'écran se décale encore au lieu de comprendre
     * qu'il faut uniquement placer la barre orange »). Deux raisons se cumulent, et AUCUNE des deux ne
     * se voit sur un banc Chromium :
     *   • `touch-action` posé sur un <rect> SVG (voir .bande-boucle dans style.css) n'est pas honoré
     *     par WebKit — c'est le moteur de l'iPhone d'où vient ce retour. La déclaration reste juste et
     *     utile ailleurs, elle ne peut simplement pas porter seule ;
     *   • `preventDefault()` sur un `pointerdown` (ce que faisaient les deux gestes ci-dessous) ne
     *     prévient PAS le défilement : la spécification Pointer Events le dit noir sur blanc, seuls
     *     `touch-action` ou un `touchmove` NON PASSIF peuvent l'annuler.
     * D'où ce filet, indépendant du moteur : un `touchmove` non passif qui refuse le geste par
     * défaut. Il doit être branché AVANT le tout premier `touchmove` — sur iOS, un défilement déjà
     * commencé ne se rattrape plus — d'où l'appel dès le `pointerdown` (le doigt est posé, il n'a pas
     * encore bougé). Le TAP, lui, n'émet aucun `touchmove` : ce filet ne le voit jamais passer.
     */
    _bloquerDefilementPendantGeste() {
        const bloquer = (ev) => ev.preventDefault();
        window.addEventListener('touchmove', bloquer, { passive: false });
        return () => window.removeEventListener('touchmove', bloquer);
    }

    /**
     * RÉCLAME LA SÉQUENCE DE TOUCHER DÈS `touchstart`, quand le doigt se pose DANS LA BANDE.
     *
     * LE DÉFAUT, SIGNALÉ TROIS FOIS ET TOUJOURS PAS RÉGLÉ : « je ne peux pas l'étirer car c'est
     * l'écran avec la portée qui bouge et qui réagit aux mouvements de mon doigt […] j'appuie et je
     * glisse pour étirer la barre, et le logiciel comprend que j'ajoute une barre, puis que je
     * scrolle horizontalement sur la portée ». Cette description dit exactement ce qui se passe, et
     * dans le bon ordre — c'est elle qui a permis de trouver la cause.
     *
     * POURQUOI LES DEUX FILETS PRÉCÉDENTS NE SUFFISENT PAS. Il y en avait déjà deux :
     *   • `touch-action: none` sur les `<rect>` de la bande — non honoré par WebKit sur du SVG,
     *     c'était déjà écrit ici ;
     *   • un `touchmove` non passif posé depuis `pointerdown` (_bloquerDefilementPendantGeste).
     * Le second arrive TROP TARD, et c'est le point qui manquait : `pointerdown` est émis APRÈS
     * `touchstart`, et un navigateur mobile décide de défiler DÈS `touchstart` dès que `touch-action`
     * le lui permet. Le défilement part alors sur le thread de composition, où un `preventDefault`
     * ultérieur ne l'atteint plus. Le seul instant où l'on peut réclamer une séquence de toucher
     * entière, c'est `touchstart` lui-même.
     *
     * ET C'EST EXACTEMENT CE QUE DEMANDE L'UTILISATEUR : « lorsque je suis dans la zone de la bande,
     * seule la barre orangée doit pouvoir réagir avec un étirement ». D'où la condition — on ne
     * réclame le toucher QUE dans la bande ou sur une poignée. Partout ailleurs sur la partition, un
     * doigt continue de faire défiler normalement : un `preventDefault` inconditionnel ici
     * paralyserait la lecture du morceau au doigt, ce qui serait bien pire.
     *
     * UN SEUL DOIGT : deux doigts sont un pincement de zoom (voir brancherZoomGeste), qui a ses
     * propres écouteurs et ne doit pas se voir confisquer son geste par la bande.
     */
    brancherPriseBoucleTactile() {
        const feuille = this.el.feuille;
        if (!feuille) return;
        feuille.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            const t = e.touches[0];
            const dansLaBande = this.poigneeBoucleAuPoint(t.clientX, t.clientY)
                || this.mesureDansBandeBoucle(t.clientX, t.clientY) != null;
            if (dansLaBande) e.preventDefault();
        }, { passive: false });
    }

    /**
     * CAPTURE LE POINTEUR SUR UN ÉLÉMENT STABLE pour toute la durée d'un geste — et rend de quoi la
     * relâcher.
     *
     * POURQUOI. Sans elle, un geste qui commence sur le SVG de la partition en dépend : le
     * navigateur pose une capture IMPLICITE sur l'élément touché, et `dessiner()` remplace tout le
     * contenu de la feuille (`innerHTML`) — l'élément capturé disparaît donc sous le doigt, et le
     * navigateur cesse purement et simplement de livrer la suite du geste. Plus aucun pointermove ni
     * pointerup : la boucle restait figée sur sa toute première position (vérifié — un seul mouvement
     * passait avant que tout s'arrête). C'est ce qui interdisait de redessiner PENDANT le glisser, et
     * donc ce qui faisait attendre le relâchement pour voir la barre orange (retour utilisateur : « la
     * barre de lecture orange doit se dessiner pendant que je suis en train de la définir »).
     *
     * `#zone-partition` est l'hôte : c'est le plus proche ancêtre que `dessiner()` ne touche JAMAIS
     * (il n'écrit que dans `.feuille`, son enfant). La capture y survit donc à autant de redessins
     * qu'on veut. Sans effet sur le défilement, déjà neutralisé pendant le geste (voir
     * _bloquerDefilementPendantGeste).
     */
    _capturerPointeur(e) {
        const hote = this.el.zone;
        try { hote.setPointerCapture(e.pointerId); } catch (err) { return () => {}; }
        return () => { try { hote.releasePointerCapture(e.pointerId); } catch (err) { /* déjà relâché */ } };
    }

    /**
     * GLISSER LA BANDE DE BOUCLE : définit une zone [mesureAncre, mesure courante] à rejouer en
     * boucle. Un tap/clic SANS glisser retire la boucle en place, s'il y en avait une — sans ça,
     * aucun moyen tactile d'en annuler une (à la souris, Échap ne fait pas ce lien).
     *
     * DESSINÉE EN DIRECT, pendant qu'on glisse (retour utilisateur : « la barre de lecture orange doit
     * se dessiner pendant que je suis en train de la définir. Pour le moment, elle apparaît lorsque
     * j'ai arrêté de cliquer »). Une version antérieure attendait le relâchement, pour une raison
     * réelle : `dessiner()` remplace le SVG sous le doigt et coupait la capture implicite du pointeur
     * en plein geste. La réponse n'est pas de redessiner moins, c'est de capturer le pointeur sur un
     * élément que le rendu ne touche pas — voir _capturerPointeur.
     *
     * REDESSINÉE SEULEMENT QUAND LA PLAGE CHANGE, c'est-à-dire au franchissement d'une mesure : une
     * boucle se borne en MESURES, pas en pixels, et remettre toute la page en page à chaque pixel
     * parcouru serait du travail jeté. Et plus aucune légende (« Boucle : mesures 1 à 3 ») : la barre
     * orange elle-même le dit désormais, à l'instant où on la trace.
     */
    demarrerGesteBoucle(e, mesureAncre) {
        e.preventDefault();   // sélection de texte et souris de synthèse — PAS le défilement, voir ci-dessous
        const debloquer = this._bloquerDefilementPendantGeste();
        const relacherCapture = this._capturerPointeur(e);
        const depart = { x: e.clientX, y: e.clientY };
        const SEUIL = 6;
        let bouge = false;
        let derniere = null;

        // L'ANCRE EST UN INSTANT, PAS UNE MESURE : c'est le point exact où le doigt s'est posé, et
        // c'est de LUI que part la bande. Poser l'ancre au début de la mesure ferait sauter la bande
        // au premier pixel parcouru.
        const ancre = this.instantSousLePoint(e.clientX, e.clientY, mesureAncre);
        // Une seule étape d'annulation pour tout le geste — voir etapeBoucle.
        const cloreEtape = this.etapeBoucle();

        /**
         * LE MÊME TRAVAIL POUR LE POINTEUR ET POUR LE DÉFILEMENT AUTOMATIQUE — un seul corps, appelé
         * par les deux. Un doigt immobile au bord d'un écran doit continuer d'allonger la bande
         * pendant que la page monte à sa rencontre, donc le défilement rappelle ceci à chaque pas.
         *
         * `surMouvement` RECOPIAIT CES QUATRE LIGNES, et c'est une neutralisation de banc qui l'a
         * révélé : la vérification « un geste = une étape » restait verte alors qu'on avait
         * délibérément cassé le regroupement — parce que le sabotage avait atterri dans la copie que
         * le geste à la souris ne traverse jamais. Deux exemplaires du même travail, dont un seul
         * éprouvé : exactement ce que ce projet évite partout ailleurs.
         *
         * L'ŒIL SUIT LE PIXEL, L'OREILLE SUIT LE TEMPS, et c'est délibérément deux finesses pour
         * deux sens. L'aperçu se retrace aux coordonnées exactes du pointeur (quelques attributs
         * réécrits, pas une remise en page) ; la boucle, elle, n'est reposée dans le lecteur qu'au
         * changement de plage CALÉE, parce que glisser la bande pendant que ça joue doit s'entendre
         * tout de suite — mais que le pixel n'aurait aucun sens à l'oreille (le transport sauterait
         * soixante fois par seconde). Aucun `dessiner()` ici : la bande posée est masquée le temps du
         * geste (voir `_gesteBoucle` dans marquesBoucle), l'aperçu est seul à l'écran.
         */
        const rafraichir = (point) => {
            const ici = this.instantSousLePoint(point.x, point.y);
            if (!ici) return;
            derniere = ici;
            this.poserApercuBoucle(this.rectsBoucle(ancre.systeme, ancre.x, ici.systeme, ici.x));
            this.poserBornesCalees(ancre.position, ici.position, { redessiner: false });
        };
        const defilement = this.defilementAuBord(rafraichir);

        const surMouvement = (ev) => {
            if (!bouge && Math.hypot(ev.clientX - depart.x, ev.clientY - depart.y) < SEUIL) return;
            if (!bouge) { bouge = true; this._gesteBoucle = true; this.dessiner(); }
            defilement.suivre(ev);
            rafraichir({ x: ev.clientX, y: ev.clientY });
        };
        // RANGEMENT COMMUN aux trois façons de finir : doigt levé, geste annulé, ou pointeur perdu.
        const detacher = () => {
            relacherCapture();
            debloquer();
            window.removeEventListener('pointermove', surMouvement);
            window.removeEventListener('pointerup', surRelache);
            window.removeEventListener('pointercancel', surAnnulation);
            defilement.arreter();
            this.poserApercuBoucle([]);
            this._gesteBoucle = false;
        };
        const surRelache = () => {
            detacher();
            if (bouge && derniere) {
                this.poserBornesCalees(ancre.position, derniere.position);
            } else if (!bouge) {
                // TAP IMMOBILE. Deux gestes distincts selon qu'une boucle existe déjà :
                //   • aucune boucle -> on en POSE une sur la mesure visée (retour utilisateur : « si
                //     je clique, elle sera mise en place sur la mesure considérée ») ;
                //   • une boucle en place -> on la RETIRE, seul moyen tactile d'en annuler une (à la
                //     souris, Échap ne fait pas ce lien).
                if (this.lecteur.boucleLecture) this.lecteur.retirerBoucle();
                else this.poserBoucleSurMesure(mesureAncre);
                this.dessiner();
            }
            cloreEtape();
            this.el.zone.focus();
        };
        /**
         * UN POINTEUR ANNULÉ N'EST PAS UN APPUI, et c'est le défaut exact que l'utilisateur
         * décrivait : « j'appuie et je glisse pour étirer la barre, et le logiciel comprend que
         * j'ajoute une barre, puis que je scrolle horizontalement ».
         *
         * `pointercancel` est précisément ce que le navigateur émet quand il s'emparre du geste pour
         * défiler — et il l'émet souvent AVANT que le seuil de 6px soit franchi, donc avec
         * `bouge` encore faux. L'ancienne version branchait le MÊME `surRelache` sur `pointerup` et
         * sur `pointercancel` : l'annulation tombait donc dans la branche « tap immobile » et posait
         * une boucle d'une mesure que personne n'avait demandée, juste avant que l'écran se mette à
         * glisser. Les deux moitiés de la phrase de l'utilisateur, dans l'ordre.
         *
         * Un geste avorté ne laisse donc AUCUNE trace nouvelle. S'il avait déjà bougé, en revanche,
         * on garde la plage déjà posée pendant le glisser : c'est ce que l'utilisateur voyait à
         * l'écran, et la lui retirer serait une seconde surprise.
         * (demarrerGesteTactile faisait déjà cette distinction, avec son `surAnnulation` à part —
         * elle manquait ici, et nulle part ailleurs.)
         */
        // MÊME SUR ANNULATION on clôt l'étape : le glisser avait déjà posé la plage qu'on voit à
        // l'écran (voir la docblock ci-dessus), et ce qui est visible doit être annulable. Si rien
        // n'a bougé, `cloreEtape` n'enregistre rien.
        const surAnnulation = () => { detacher(); cloreEtape(); this.el.zone.focus(); };
        window.addEventListener('pointermove', surMouvement);
        window.addEventListener('pointerup', surRelache);
        window.addEventListener('pointercancel', surAnnulation);
    }

    /**
     * GLISSER UNE POIGNÉE (voir marquesBoucle/poigneeBoucleAuPoint) : étire ou rétrécit la boucle par
     * UN SEUL bord, l'autre restant FIXE — sans avoir à retracer toute la zone pour corriger une
     * seule extrémité (retour utilisateur, HarmoHub cité en modèle : « il faut ajouter des
     * poignées »). Bloquée au bord FIXE, jamais au-delà : glisser la poignée gauche plus loin que le
     * bord droit inverserait silencieusement leurs rôles plutôt que de simplement buter — même choix
     * que HarmoHub (voir onLoopRangeMove, mode edge-left/edge-right). Un tap immobile sur une
     * poignée ne supprime PAS la boucle (à la différence d'un tap sur le corps de la bande, voir
     * demarrerGesteBoucle) : saisir précisément un bord n'est jamais le geste de « je veux
     * l'annuler ». Dessinée EN DIRECT comme son aînée, et pour les mêmes raisons exactement (voir sa
     * docblock et _capturerPointeur) : étirer un bord doit se voir pendant qu'on l'étire.
     */
    demarrerGesteBoucleBord(e, bord) {
        e.preventDefault();   // même remarque qu'à demarrerGesteBoucle : ne couvre PAS le défilement
        const debloquer = this._bloquerDefilementPendantGeste();
        const relacherCapture = this._capturerPointeur(e);
        let derniere = null;
        const cloreEtape = this.etapeBoucle();
        // LE BORD QUI NE BOUGE PAS, retenu comme un INSTANT une fois pour toutes : c'est lui qui
        // ancre la bande pendant tout le geste. Le relire à chaque mouvement le ferait dériver, la
        // boucle étant justement en train d'être redéfinie sous nos pieds.
        const bornes = this.lecteur.bornesBoucle(this.editeur.partition);
        const positionFixe = bord === 'debut' ? bornes.fin : bornes.debut;
        const lieuFixe = this.lieuDeLaPosition(positionFixe);
        this._gesteBoucle = true;
        this.dessiner();

        // BUTÉE AU BORD FIXE, jamais d'inversion : tirer la poignée gauche au-delà de la droite
        // échangerait silencieusement leurs rôles plutôt que de simplement buter — même choix que
        // HarmoHub (voir onLoopRangeMove), et déjà celui de la version d'avant ce correctif.
        const buter = (position) => (bord === 'debut'
            ? Math.min(position, positionFixe) : Math.max(position, positionFixe));

        // Le même travail pour le pointeur et pour le défilement automatique — voir
        // demarrerGesteBoucle, qui explique pourquoi un doigt IMMOBILE au bord doit continuer
        // d'allonger la bande.
        const rafraichir = (point) => {
            const ici = this.instantSousLePoint(point.x, point.y);
            if (!ici || !lieuFixe) return;
            // L'œil suit le pixel, l'oreille le temps — exactement le même partage qu'à
            // demarrerGesteBoucle, et pour les mêmes raisons (voir sa docblock).
            const xBute = bord === 'debut'
                ? Math.min(ici.x, ici.systeme < lieuFixe.systeme ? Infinity : lieuFixe.x)
                : Math.max(ici.x, ici.systeme > lieuFixe.systeme ? -Infinity : lieuFixe.x);
            this.poserApercuBoucle(this.rectsBoucle(lieuFixe.systeme, lieuFixe.x, ici.systeme, xBute));
            this.poserBornesCalees(positionFixe, buter(ici.position), { redessiner: false });
            derniere = ici;
        };
        const defilement = this.defilementAuBord(rafraichir);

        const surMouvement = (ev) => {
            defilement.suivre(ev);
            rafraichir({ x: ev.clientX, y: ev.clientY });
        };
        const detacher = () => {
            relacherCapture();
            debloquer();
            window.removeEventListener('pointermove', surMouvement);
            window.removeEventListener('pointerup', surRelache);
            window.removeEventListener('pointercancel', surAnnulation);
            defilement.arreter();
            this.poserApercuBoucle([]);
            this._gesteBoucle = false;
        };
        const surRelache = () => {
            detacher();
            if (derniere) this.poserBornesCalees(positionFixe, buter(derniere.position));
            else this.dessiner();
            cloreEtape();
            this.el.zone.focus();
        };
        // Même distinction qu'à demarrerGesteBoucle, et pour la même raison exactement (voir sa
        // docblock) : un geste que le navigateur annule ne doit rien décider à notre place.
        const surAnnulation = () => { detacher(); this.dessiner(); cloreEtape(); this.el.zone.focus(); };
        window.addEventListener('pointermove', surMouvement);
        window.addEventListener('pointerup', surRelache);
        window.addEventListener('pointercancel', surAnnulation);
    }

    /**
     * Relais du collage d'une mesure — il ne se contente pas de redessiner, il REND COMPTE.
     *
     * Coller une mesure de guitare dans une basse écarte les notes posées sur des cordes qui
     * n'existent pas (voir Editeur.collerMesure) : les taire laisserait croire à une copie fidèle,
     * alors qu'il en manque. Le nombre exact est donc annoncé, comme le fait déjà l'import MIDI pour
     * ses notes hors du manche.
     */
    _collerMesure(apres) {
        return () => {
            this.fermerMenuContextuel();
            const bilan = this.editeur.collerMesure(apres);
            if (this.editeur.derniereErreur) { this.message(this.editeur.derniereErreur); this.editeur.derniereErreur = null; return; }
            this.dessiner();
            if (bilan?.abandonnees) {
                this.message(`Mesure collée — ${bilan.abandonnees} note(s) écartée(s), hors des cordes de cet instrument.`, 6000);
            }
        };
    }

    /** Efface toutes les notes sélectionnées en UNE seule action d'annulation (voir Editeur.effacerNotes). */
    effacerSelection() {
        if (!this.selectionNotes.size) return;
        const refs = [...this.selectionNotes].map(cle => {
            const [mesure, voix, evenement, corde] = cle.split(':').map(Number);
            return { mesure, voix, evenement, corde };
        });
        this.selectionNotes.clear();
        this.editeur.effacerNotes(refs);
    }

    ouvrirFenetre(id) { document.getElementById(id).hidden = false; }
    fermerFenetres() {
        // LA BOUCLE DU SÉQUENCEUR S'ARRÊTE AVEC SA FENÊTRE. Sans ça, fermer l'aide rythmique laissait
        // tourner un rythme jetable en boucle, avec sa tête de lecture abonnée au transport pour
        // toujours — et la boucle du séquenceur serait restée posée sur la partition du morceau.
        if (this._rythme?.boucle) this.arreterBoucleRythme();
        this._rythme?.detacherTete?.();
        for (const v of document.querySelectorAll('.voile')) v.hidden = true;
        this.el.zone.focus();
    }

    /**
     * Bascule la barre d'outils entre haut (par défaut) et gauche — préférence d'affichage, comme le
     * zoom ou la réglette. `zone-partition` change de largeur disponible en même temps que la grille
     * CSS se redessine ; on remet donc la partition en page à la frame suivante (le temps que le
     * navigateur applique le nouveau `grid-template-columns` et que `clientWidth` reflète la largeur
     * RÉELLE, pas celle d'avant le changement).
     */
    positionnerOutils(valeur) {
        this.positionOutils = valeur === 'gauche' ? 'gauche' : 'haut';
        localStorage.setItem(CLE_POSITION_OUTILS, this.positionOutils);
        document.body.classList.toggle('outils-gauche', this.positionOutils === 'gauche');
        requestAnimationFrame(() => this.dessiner());
    }

    /**
     * Affiche ou replie le pavé de saisie tactile (voir ui/pave.js) — CHIFFRES + Effacer/Insérer ET
     * la croix de déplacement flottante, ENSEMBLE : `body.avec-pave` (voir style.css .dpad-flottant)
     * est le seul interrupteur des deux, jamais l'un sans l'autre. TOUJOURS absent sur un appareil
     * non tactile (aucun réglage ne peut l'y faire apparaître : la souris fait déjà tout) ; sur un
     * appareil tactile, visible sauf si `actif` est éteint dans les Réglages (voir remplirReglages,
     * le seul endroit où ce réglage est même montré).
     *
     * Le pavé (chiffres) prend de la hauteur à la partition (il occupe sa propre rangée de la grille,
     * il ne la recouvre pas) : il faut donc remettre en page APRÈS que le navigateur a appliqué la
     * nouvelle grille, sinon le découpage en systèmes se calcule sur la hauteur d'avant — d'où le
     * passage par requestAnimationFrame, exactement comme pour la barre d'outils juste au-dessus. La
     * croix, elle, flotte PAR-DESSUS (retour utilisateur) : sa propre apparition/disparition ne
     * change rien à la hauteur disponible, mais elle suit ce même passage puisqu'il ne coûte rien de
     * plus à partager.
     */
    appliquerPave(actif) {
        this.paveActif = !!actif;
        localStorage.setItem(CLE_PAVE, this.paveActif ? '1' : '0');
        const visible = this.paveActif && appareilTactile();
        this.el.pave.hidden = !visible;
        document.body.classList.toggle('avec-pave', visible);
        requestAnimationFrame(() => this.dessiner());
    }

    /** TAB seule (voir dessiner, engine/layout.js#mettreEnPage option `avecPortee`). */
    appliquerTabSeule(actif) {
        this.tabSeule = !!actif;
        localStorage.setItem(CLE_TAB_SEULE, this.tabSeule ? '1' : '0');
        this.dessiner();
    }

    /** Peuple la fenêtre « Instrument et accordage » depuis l'état courant. */
    remplirReglages() {
        const piste = this.editeur.partition.piste;
        const selInstrument = document.getElementById('champ-instrument');
        const selAccordage = document.getElementById('champ-accordage');
        const selCapo = document.getElementById('champ-capo');
        const grille = document.getElementById('grille-cordes');
        if (!selInstrument) return;

        selInstrument.innerHTML = Object.values(INSTRUMENTS)
            .map(i => `<option value="${i.id}"${i.id === piste.instrument ? ' selected' : ''}>${i.nom}</option>`).join('');
        selInstrument.onchange = () => this.editeur.definirInstrument(selInstrument.value);

        const liste = ACCORDAGES[piste.instrument] || [];
        const connu = liste.some(a => a.id === piste.accordage.id);
        // LES NOTES SEULES, sans le nom de l'accordage (retour utilisateur : « les indications
        // d'accordage : standard, drop D etc… je le sais en lisant les notes »). Et c'est vrai : « Drop
        // D — D A D G » disait deux fois la même chose à qui lit la seconde moitié, en occupant la
        // largeur d'un menu déroulant sur un écran de téléphone. Le nom ne subsiste que là où il n'y a
        // AUCUNE note à lire — le piano, dont l'accordage est une liste de cordes vide : sans lui,
        // l'option n'aurait plus de libellé du tout.
        selAccordage.innerHTML = liste
            .map(a => `<option value="${a.id}"${a.id === piste.accordage.id ? ' selected' : ''}>${a.cordes.length ? libelleAccordage(a.cordes) : a.nom}</option>`).join('')
            + (connu ? '' : `<option value="personnalise" selected>${libelleAccordage(piste.accordage.cordes)}</option>`);
        selAccordage.onchange = () => { if (selAccordage.value !== 'personnalise') this.editeur.definirAccordage(selAccordage.value); };

        selCapo.innerHTML = Array.from({ length: 13 }, (_, n) =>
            `<option value="${n}"${n === (piste.capo || 0) ? ' selected' : ''}>${n === 0 ? 'Aucun' : `Case ${n}`}</option>`).join('');
        selCapo.onchange = () => this.editeur.definirCapo(parseInt(selCapo.value, 10));

        // Du grave à l'aigu : l'ordre dans lequel un instrumentiste énonce son accordage, donc
        // l'inverse de l'ordre interne (voir model/instruments.js).
        const cordes = piste.accordage.cordes;
        grille.innerHTML = cordes.map((midi, i) => i).reverse().map((i) => {
            const midi = cordes[i];
            return `<label class="corde-reglage">
                <span>Corde ${cordes.length - i}</span>
                <select class="champ" data-corde="${i}">
                    ${Array.from({ length: 49 }, (_, k) => midi - 24 + k)
                        .filter(m => m >= 12 && m <= 96)
                        .map(m => `<option value="${m}"${m === midi ? ' selected' : ''}>${nomDeHauteur(m)}</option>`).join('')}
                </select>
            </label>`;
        }).join('');
        for (const sel of grille.querySelectorAll('select[data-corde]')) {
            sel.onchange = () => this.editeur.definirCorde(parseInt(sel.dataset.corde, 10), parseInt(sel.value, 10));
        }

        // TITRE, SOUS-TITRE, ARTISTE NE SONT PLUS ICI : voir index.html, là où se trouvait la
        // rubrique « Morceau ». Ils se modifient sur la partition, au panneau d'en-tête
        // (ouvrirEditeurEnTete) — un seul chemin, donc plus de valeur à tenir synchronisée en deux
        // endroits.

        // Préférence d'AFFICHAGE, pas de contenu musical (voir `positionnerOutils`) : ne dépend pas
        // de la partition, mais se remet à jour ici comme le reste du panneau, par simplicité.
        const selPosition = document.getElementById('champ-position-outils');
        selPosition.value = this.positionOutils;
        selPosition.onchange = () => this.positionnerOutils(selPosition.value);

        // Le réglage lui-même n'a de sens QUE sur un appareil tactile (voir appliquerPave) : sur
        // ordinateur, la ligne entière reste masquée plutôt que d'exposer un interrupteur qui ne
        // ferait jamais rien.
        const lignePave = document.getElementById('ligne-pave');
        const btnPave = document.getElementById('champ-pave');
        lignePave.hidden = !appareilTactile();
        if (!lignePave.hidden) {
            btnPave.setAttribute('aria-checked', String(this.paveActif));
            btnPave.onclick = () => {
                this.appliquerPave(!this.paveActif);
                btnPave.setAttribute('aria-checked', String(this.paveActif));
            };
        }

        // TAB SEULE : n'a de sens que pour un instrument qui A une tablature (voir appliquerTabSeule) —
        // masqué au piano, même logique que le pavé tactile juste au-dessus.
        // L'INTERRUPTEUR DE L'HISTORIQUE. Recalé à chaque ouverture des Réglages (comme les autres) :
        // l'état peut avoir changé depuis, une confirmation refusée ayant pu le laisser où il était.
        const btnVersions = document.getElementById('champ-versions');
        if (btnVersions) {
            btnVersions.setAttribute('aria-checked', String(this.versionsActives));
            btnVersions.onclick = async () => {
                // ON REPART DE L'ÉTAT RENDU, pas de celui qu'on visait : éteindre peut être ANNULÉ
                // dans la confirmation, et l'interrupteur doit alors revenir où il était plutôt que
                // de montrer un état qui n'a pas eu lieu.
                const retenu = await this.basculerVersions(!this.versionsActives);
                btnVersions.setAttribute('aria-checked', String(retenu));
            };
        }
        this.rafraichirEtatVersions();

        // ACCORDAGE ET OPTIONS AVANCÉES : SANS OBJET AU PIANO. Un clavier n'a ni corde à accorder,
        // ni case où poser un capodastre — et la grille corde par corde, dans le repli, n'a rien à
        // montrer. Le même traitement que « TAB seule » et le pavé tactile juste en dessous : on
        // masque plutôt que d'exposer des commandes qui ne feraient jamais rien. (Trouvé à l'audit :
        // ces deux-là étaient restées visibles, alors que les deux autres se masquaient déjà.)
        const clavier = piste.instrument === 'piano';
        const ligneAccordage = document.getElementById('ligne-accordage');
        const repliAvance = document.getElementById('repli-instrument-avance');
        if (ligneAccordage) ligneAccordage.hidden = clavier;
        if (repliAvance) repliAvance.hidden = clavier;

        const ligneTabSeule = document.getElementById('ligne-tab-seule');
        const btnTabSeule = document.getElementById('champ-tab-seule');
        ligneTabSeule.hidden = clavier;   // `clavier`, calculé juste au-dessus : une seule expression de l'idée
        if (!ligneTabSeule.hidden) {
            btnTabSeule.setAttribute('aria-checked', String(this.tabSeule));
            btnTabSeule.onclick = () => {
                this.appliquerTabSeule(!this.tabSeule);
                btnTabSeule.setAttribute('aria-checked', String(this.tabSeule));
            };
        }

        const curseurVolGeneral = document.getElementById('champ-volume-general');
        const valeurVolGeneral = document.getElementById('valeur-volume-general');
        curseurVolGeneral.value = this.lecteur.volumeGeneral;
        valeurVolGeneral.textContent = this.lecteur.volumeGeneral;
        curseurVolGeneral.oninput = () => {
            const p = parseInt(curseurVolGeneral.value, 10);
            this.lecteur.definirVolumeGeneral(p);
            valeurVolGeneral.textContent = p;
            localStorage.setItem(CLE_VOLUME_GENERAL, String(p));
        };

        const curseurVolMetronome = document.getElementById('champ-volume-metronome');
        const valeurVolMetronome = document.getElementById('valeur-volume-metronome');
        curseurVolMetronome.value = this.lecteur.volumeMetronome;
        valeurVolMetronome.textContent = this.lecteur.volumeMetronome;
        curseurVolMetronome.oninput = () => {
            const p = parseInt(curseurVolMetronome.value, 10);
            this.lecteur.definirVolumeMetronome(p);
            valeurVolMetronome.textContent = p;
            localStorage.setItem(CLE_VOLUME_METRONOME, String(p));
        };

        // Le clic sur les croches, VENU DE LA BARRE DU BAS (voir index.html, Réglages > Son) : un
        // réglage de comportement du métronome, pas une commande de lecture. L'écouteur du clic vit
        // avec les autres dans brancherInterface (il y était déjà, sous son ancien id) ; ici on ne
        // fait que refléter l'état à l'ouverture du panneau, comme pour le pavé et TAB seule.
        this.rafraichirMetronome();

        // BROUILLON LOCAL : une INDICATION, jamais un interrupteur. La rubrique « Brouillon local »
        // qu'il a eue autrefois — statut + « Vider le brouillon local » — a bien été retirée, et pour
        // une bonne raison : un réglage dont le seul pouvoir est de défaire ce que l'appli fait pour
        // vous se paie en attention à chaque ouverture du panneau. Ce qui revient ici n'est pas ce
        // réglage mais sa MOITIÉ INFORMATIVE, dans le groupe Fichiers : l'absence de tout message
        // laissait sans réponse « mon travail est-il gardé quelque part ? », et un panneau de réglages
        // est l'endroit où l'on va la poser. Repartir de zéro reste à un clic : Fichiers → Nouveau.
        this.rafraichirEtatBrouillon();
    }

    /** L'aide-mémoire se GÉNÈRE depuis la table des actions : elle ne peut pas mentir sur les touches. */
    remplirAide() {
        const table = document.getElementById('table-raccourcis');
        const lignes = [
            ['<kbd>0</kbd> … <kbd>9</kbd>', 'Poser une case (deux chiffres rapides = case 10 à 24)'],
            ['<kbd>Espace</kbd>', 'Lecture / pause, depuis le curseur'],
            ['<kbd>Échap</kbd>', 'Arrêter la lecture'],
            ['<kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd>', 'Annuler / rétablir'],
            ['<kbd>Ctrl</kbd>+<kbd>S</kbd>', 'Enregistrer en .json'],
            ['<kbd>Ctrl</kbd>+<kbd>O</kbd>', 'Ouvrir un .json'],
            ['<kbd>Ctrl</kbd>+<kbd>P</kbd>', 'Exporter en PDF'],
            // ONGLETS — listés ici et non dans la table des actions : celle-ci ne connaît que
            // l'ÉDITION (voir edit/raccourcis.js), et changer de morceau n'en est pas.
            ['<kbd>Alt</kbd>+<kbd>1</kbd> … <kbd>9</kbd>', 'Aller au Nième onglet (ordinateur)'],
            ['<kbd>Alt</kbd>+<kbd>←</kbd> / <kbd>→</kbd>', 'Onglet précédent / suivant'],
            ...ACTIONS.filter(a => a.touches?.length).map(a => [
                a.touches.map(t => `<kbd>${escapeHtml(toucheDeSig(t))}</kbd>`).join(' ou '),
                a.libelle,
            ]),
            // Les gestes TACTILES : ils n'ont pas de touche, donc rien dans la table des actions ne
            // les décrit — et un appui long ne se devine pas. Listés à la suite plutôt que dans une
            // fenêtre à part : sur un appareil hybride (portable à écran tactile), les deux jeux de
            // gestes coexistent, et les séparer obligerait à choisir lequel montrer.
            ['<kbd>♭</kbd> / <kbd>♯</kbd> (barre d\'outils)', 'Transposer TOUT le morceau d\'un demi-ton'],
            // Étirer À LA SOURIS (voir demarrerEtirement) : un glisser n'a pas de touche non plus,
            // pour la même raison que les gestes tactiles ci-dessous — listé ici, pas deviné.
            ['<kbd>Glisser ↔</kbd> (souris, sur une note)', 'Étirer sa durée — droite = plus long, gauche = plus court'],
            ['<kbd>Tap</kbd>', 'Tactile : placer le curseur sur une note'],
            ['<kbd>Appui long</kbd>', 'Tactile : ouvrir le menu d\'une note (équivaut au clic droit)'],
            ['<kbd>Glisser</kbd>', 'Tactile : faire défiler la partition'],
            // LE ZOOM PAR GESTE (voir brancherZoomGeste) : il confisque un geste que le navigateur
            // faisait déjà — il faut donc dire qu'il ne fait plus la même chose, et quoi à la place.
            ['<kbd>Ctrl</kbd>+<kbd>molette</kbd> (sur la partition)', 'Zoomer la PARTITION seule — la page, elle, ne bouge pas'],
            ['<kbd>Pincer</kbd> (sur la partition)', 'Tactile ou pavé tactile : même zoom, à deux doigts'],
        ];
        table.innerHTML = lignes.map(([t, l]) => `<tr><td>${t}</td><td>${escapeHtml(l)}</td></tr>`).join('');
    }

    /** Message éphémère en bas de l'écran — même mécanique que le « toast » de HarmoHub. */
    message(texte, duree = 2600) {
        const el = this.el.message;
        el.textContent = texte;
        el.classList.add('visible');
        clearTimeout(this._minuterieMessage);
        this._minuterieMessage = setTimeout(() => el.classList.remove('visible'), duree);
    }
}

function toucheDeSig(sig) {
    const jolis = {
        arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓',
        space: 'Espace', escape: 'Échap', enter: 'Entrée', backspace: '⌫', delete: 'Suppr',
        home: 'Origine', end: 'Fin', insert: 'Inser', ctrl: 'Ctrl', alt: 'Alt', shift: 'Maj',
    };
    return sig.split('+').map(p => jolis[p] || (p.length === 1 ? p.toUpperCase() : p)).join('+');
}

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const arrondi = (n) => Math.round(n * 100) / 100;

window.app = new TabHubApp();
