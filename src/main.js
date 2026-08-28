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
import { construireBarreOutils, flecheOutilsSvg } from './ui/toolbar.js';
import { construirePave } from './ui/pave.js';
import { icone } from './ui/icons.js';
import { mettreEnPage, pasDeLaPosition, CLEFS } from './engine/layout.js';
import { rendreSvg, PALETTE } from './render/svg.js';
import { Lecteur } from './audio/player.js';
import { enregistrerPartition, lireFichierPartition } from './io/json.js';
import { exporterPdf } from './io/pdf.js';
import { exporterMidi, exporterMidiParPartie, analyserFichierMidi, analyserZonesManche, construirePartitionDepuisMidi } from './io/midi.js';
import { INSTRUMENTS, ACCORDAGES, libelleAccordage } from './model/instruments.js';
import { aplatir, hauteurDeNote, nbCordes, positionDansMesure, positionDebutMesure, sectionsDe, armureEffective } from './model/score.js';
import { nomDeHauteur, hauteurDepuisPas } from './model/theory.js';
import { VALEURS_FIGURES } from './model/duration.js';

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
/** Bas de la zone de SAISIE de la boucle (mouse: BAS_BANDE_BOUCLE, doigt: BAS_BANDE_BOUCLE_TACTILE) —
 *  seule cette borne varie ; le HAUT et le trait VISUEL restent identiques sur les deux appareils. */
function basBandeBoucle() { return appareilTactile() ? BAS_BANDE_BOUCLE_TACTILE : BAS_BANDE_BOUCLE; }

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
const CLE_METRONOME = 'tabhub.metronome';
const CLE_METRONOME_SUBDIVISION = 'tabhub.metronomeSubdivision';
const CLE_VOLUME_GENERAL = 'tabhub.volumeGeneral';
const CLE_VOLUME_METRONOME = 'tabhub.volumeMetronome';

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

class TabHubApp {
    constructor() {
        this.editeur = new Editeur();
        this.lecteur = new Lecteur();
        // Voir Lecteur.brancherReveilAudio : sur téléphone, iOS suspend l'audio dès qu'on quitte
        // l'application. Sans ce rattrapage, TabHub redevient définitivement muet au retour.
        this.lecteur.brancherReveilAudio();
        this.page = null;
        // Le curseur de zoom a disparu (retour utilisateur : redondant avec le nombre de
        // mesures par ligne, mis en avant juste après — voir construireBoutonsMesuresLigne) :
        // l'interligne de la portée reste réglé une fois pour toutes, à une valeur qui a fait ses
        // preuves comme défaut du curseur disparu.
        this.interligne = 9;
        // 0 = « Auto » (glouton). Une préférence d'AFFICHAGE, pas de contenu musical : elle
        // reste locale au navigateur et ne voyage jamais dans le .json — rouvrir le même
        // morceau sur un autre poste doit retomber sur l'agencement automatique.
        this.mesuresParLigne = parseInt(localStorage.getItem(CLE_MESURES_LIGNE), 10) || 0;
        // Désactivé par défaut dans les deux cas (voir Lecteur, constructeur) : une préférence
        // explicite, portée par le lecteur lui-même puisque c'est lui qui programme les clics.
        this.lecteur.metronomeActif = localStorage.getItem(CLE_METRONOME) === '1';
        this.lecteur.metronomeSubdivision = localStorage.getItem(CLE_METRONOME_SUBDIVISION) === '1';
        this.positionOutils = localStorage.getItem(CLE_POSITION_OUTILS) === 'gauche' ? 'gauche' : 'haut';
        document.body.classList.toggle('outils-gauche', this.positionOutils === 'gauche');
        // Pavé tactile : présent au doigt, absent à la souris — SANS réglage à comprendre sur
        // ordinateur (retour utilisateur : « je ne comprends pas ces paramètres »), et un simple
        // interrupteur pour l'éteindre sur un appareil tactile qui n'en veut pas. L'ancienne valeur
        // « jamais » (trois branches : auto/toujours/jamais) se relit comme « éteint » ; toute autre
        // valeur, y compris absente, comme « allumé » — ce qu'était déjà « auto » dans l'immense
        // majorité des cas.
        this.paveActif = localStorage.getItem(CLE_PAVE) !== 'jamais' && localStorage.getItem(CLE_PAVE) !== '0';
        // Volumes : appliqués au lecteur dès la construction (voir Lecteur, qui les rejoue lui-même
        // au premier `demarrer()`, avant même que Réglages n'ait été ouvert une seule fois).
        const volGeneral = parseInt(localStorage.getItem(CLE_VOLUME_GENERAL), 10);
        const volMetronome = parseInt(localStorage.getItem(CLE_VOLUME_METRONOME), 10);
        this.lecteur.definirVolumeGeneral(Number.isFinite(volGeneral) ? volGeneral : this.lecteur.volumeGeneral);
        this.lecteur.definirVolumeMetronome(Number.isFinite(volMetronome) ? volMetronome : this.lecteur.volumeMetronome);
        this._minuterieMessage = null;
        this._minuterieBrouillon = null;
        this._tapTempoInstants = [];   // voir tapTempo() — horodatages des derniers clics sur TAP
        // Sélection multiple (glisser un rectangle sur la partition) : un ensemble de clés
        // "mesure:voix:evenement:corde" — le MÊME format que celui déjà utilisé par le lecteur audio
        // pour identifier une note sans ambiguïté (voir audio/player.js). État d'INTERFACE, jamais
        // touché par memoriser()/annuler() : sélectionner ne modifie pas la partition.
        this.selectionNotes = new Set();
        this._lasso = null;

        this.el = {
            feuille: document.getElementById('feuille'),
            zone: document.getElementById('zone-partition'),
            barreOutils: document.getElementById('barre-outils'),
            message: document.getElementById('message'),
            titre: document.getElementById('champ-titre'),
            tempo: document.getElementById('champ-tempo'),
            groupeMesuresLigne: document.getElementById('groupe-mesures-ligne'),
            btnMesuresLigneBascule: document.getElementById('btn-mesures-ligne-bascule'),
            metronome: document.getElementById('btn-metronome'),
            metronomeSubdivision: document.getElementById('btn-metronome-subdivision'),
            position: document.getElementById('info-position'),
            selection: document.getElementById('info-selection'),
            entreeFichier: document.getElementById('entree-fichier'),
            entreeFichierMidi: document.getElementById('entree-fichier-midi'),
            menuContextuel: document.getElementById('menu-contextuel'),
            btnFichiers: document.getElementById('btn-fichiers'),
            popoverFichiers: document.getElementById('popover-fichiers'),
            pave: document.getElementById('pave-tactile'),
        };

        this.restaurerBrouillon();
        this.poserIcones();
        const crochetsUi = {
            rendreLeFocus: () => this.el.zone.focus(),
            signalerErreur: (texte) => this.message(texte),
        };
        this.rafraichirOutils = construireBarreOutils(this.el.barreOutils, this.editeur, crochetsUi);
        // Le pavé tactile partage EXACTEMENT les mêmes crochets que la barre d'outils : les deux
        // exécutent les mêmes actions et doivent donc signaler les mêmes refus et rendre le focus au
        // même endroit — jamais deux comportements à tenir juste en parallèle.
        this.rafraichirPave = construirePave(this.el.pave, this.editeur, crochetsUi);
        this.appliquerPave(this.paveActif);
        this.brancherInterface();
        brancherClavier(this.editeur, {
            lectureAlternee: () => this.lectureAlternee(),
            arreter: () => this.arreter(),
            enregistrer: () => this.enregistrer(),
            exporterJson: () => this.exporterJson(),
            ouvrir: () => this.ouvrir(),
            exporterPdf: () => this.exporterPdf(),
            aide: () => this.ouvrirFenetre('fenetre-aide'),
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

        const calques = [...this.marquesLecture(), ...this.marquesCurseur(), ...this.marquesSelection(), ...this.marquesBoucle()];
        this.el.feuille.style.width = `${this.page.largeur}px`;
        this.el.feuille.style.height = `${this.page.hauteur}px`;
        this.el.feuille.innerHTML = rendreSvg(this.page, {
            calquesDessous: calques,
            systemesVisibles: this.systemesVisibles(),
        });
        this._bandeDessinee = this.bandeVisible();

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
        const entree = plat.find(e => t >= e.debut - 1e-9 && t < e.debut + e.duree - 1e-9) || null;
        if (!entree) return [];
        const a = this.page.ancrages.evenements.find(x => x.mesure === entree.mesure && x.voix === entree.voix && x.evenement === entree.evenement);
        if (!a) return [];
        const avance = entree.duree > 0 ? Math.max(0, Math.min(1, (t - entree.debut) / entree.duree)) : 0;
        const x = a.xDebut + (a.xFin - a.xDebut) * avance;
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
        // Un morceau NEUF ne doit jamais hériter de la boucle du précédent — c'est un état de
        // SESSION (voir Lecteur.boucleLecture), jamais sauvé, mais justement pour ça : rien à
        // l'écran ne montrerait qu'un morceau tout juste ouvert continue de rejouer quatre mesures
        // de l'ancien en boucle (même précaution que HarmoHub, dont ce geste est repris).
        if (raison === 'document') this.lecteur.retirerBoucle();
        this.dessiner();
        // Le curseur reste à l'écran. Nécessaire depuis que seuls les systèmes visibles sont
        // dessinés : un curseur poussé hors de la bande dessinée s'afficherait sur du vide, sans
        // portée derrière lui. C'est aussi ce qu'on attend en écrivant — la page suit la saisie.
        if (raison !== 'lecture') this.suivreLeCurseur();
        this.rafraichirBoutonsHistorique();
        if (raison === 'document' || raison === 'instrument') this.remplirReglages();
        if (raison === 'document' || raison === 'meta') this.el.titre.value = this.editeur.partition.meta.titre;
        if (raison === 'document' || raison === 'tempo') {
            this.el.tempo.value = this.editeur.partition.meta.tempo;
            this.lecteur.definirTempo(this.editeur.partition.meta.tempo);
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
        this.el.metronomeSubdivision.classList.toggle('actif', sub);
        this.el.metronomeSubdivision.setAttribute('aria-pressed', String(sub));
        this.el.metronomeSubdivision.querySelector('svg').innerHTML = sub
            ? '<ellipse cx="6" cy="18" rx="3" ry="2.3" fill="currentColor"/><ellipse cx="17" cy="19" rx="3" ry="2.3" fill="currentColor"/><path d="M9 18V6l8 2v11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
            : '<ellipse cx="9" cy="18" rx="4" ry="3" fill="currentColor"/><path d="M13 18V4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>';
    }

    /**
     * TAP TEMPO — comme HarmoHub : cliquer plusieurs fois au rythme voulu règle le tempo sans avoir
     * à connaître ni taper une valeur précise (retour utilisateur : le simple champ numérique
     * « n'est pas très clair »).
     *
     * Repart de zéro si plus de 2 s s'écoulent entre deux clics (une nouvelle estimation, pas la
     * continuation d'un tempo très lent) ; ne garde que les 8 derniers pour rester réactif à un
     * changement de rythme en cours de route plutôt que de figer une moyenne sur toute la séance. Un
     * seul clic ne donne encore aucun écart à mesurer : il ne fait qu'amorcer la séquence.
     */
    tapTempo() {
        const maintenant = performance.now();
        const instants = this._tapTempoInstants;
        if (instants.length > 0 && maintenant - instants[instants.length - 1] > 2000) instants.length = 0;
        instants.push(maintenant);
        if (instants.length > 8) instants.shift();
        if (instants.length < 2) return;

        const ecarts = [];
        for (let i = 1; i < instants.length; i++) ecarts.push(instants[i] - instants[i - 1]);
        const moyenneMs = ecarts.reduce((a, b) => a + b, 0) / ecarts.length;
        // Bornes du champ numérique lui-même (voir index.html#champ-tempo) : un tap frénétique ou
        // hésitant ne doit jamais produire une valeur que ce même champ refuserait.
        const bpm = Math.min(400, Math.max(20, Math.round(60000 / moyenneMs)));
        this.editeur.definirTempo(bpm);
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
    construireBoutonsMesuresLigne() {
        const hote = this.el.groupeMesuresLigne;
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

        // Ce que dit la barre du bas sur la position : la corde et, si une note y est posée, la
        // hauteur qu'elle sonne. C'est le seul endroit où la note se lit en clair — la tablature dit
        // « case 7 », pas « si ».
        // Les instrumentistes numérotent les cordes DEPUIS L'AIGUË : la plus fine est la corde 1.
        // C'est exactement l'ordre interne (cordes[0] = la plus aiguë), donc index + 1 — et non
        // « nombre de cordes − index », qui annonçait « corde 6 » pour le mi aigu.
        const numeroCorde = c.corde + 1;
        const note = this.editeur.noteCourante();
        // La voix ne s'affiche QUE quand la mesure en a deux — sur la mesure du commun des cas
        // (une seule voix), le mentionner serait du bruit sans rien apprendre à personne.
        let texte = this.editeur.nbVoixMesure() > 1
            ? `Voix ${c.voix + 1} (${c.voix === 0 ? 'mélodie' : 'accompagnement'}) · Corde ${numeroCorde}`
            : `Corde ${numeroCorde}`;
        if (note) {
            const midi = hauteurDeNote(this.editeur.partition, note);
            if (midi != null) texte += ` · case ${note.frette} · ${nomDeHauteur(midi)}`;
        }
        const ecart = this.editeur.ecartMesure();
        if (Math.abs(ecart) > 1e-9) {
            texte += ecart < 0 ? ` · mesure incomplète (${arrondi(-ecart)} ♩ manquante(s))` : ` · mesure trop pleine (+${arrondi(ecart)} ♩)`;
        }
        this.el.selection.textContent = texte;
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
     * D'où repartir quand on relance depuis l'arrêt : le curseur, comme toujours — SAUF si une
     * boucle de lecture est active et que le curseur est resté EN DEHORS d'elle, auquel cas la
     * lecture partirait d'un endroit que la boucle ne traverse peut-être jamais une fois lancée
     * (elle ne revient au début de la boucle qu'à la PROCHAINE fois qu'elle atteint sa fin — voir
     * Lecteur._appliquerBoucle). Repartir directement du début de la boucle est le seul choix qui ne
     * surprenne pas : on entend tout de suite ce qu'on a défini, jamais un passage qui n'a rien à
     * voir avec elle en attendant que le transport y arrive par hasard.
     */
    positionDeDepartLecture() {
        const boucle = this.lecteur.boucleLecture;
        const c = this.editeur.curseur;
        if (boucle && (c.mesure < boucle.debut || c.mesure > boucle.fin)) {
            return positionDebutMesure(this.editeur.partition, boucle.debut);
        }
        return this.positionDuCurseurEnNoires();
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
        const rafraichirFleches = () => {
            flecheGauche.classList.toggle('invisible', hote.scrollLeft <= 1);
            flecheDroite.classList.toggle('invisible', hote.scrollLeft + hote.clientWidth >= hote.scrollWidth - 1);
        };
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
        try {
            localStorage.setItem(CLE_BROUILLON, JSON.stringify(this.editeur.partition));
            this.message('Enregistré');
        } catch (err) {
            this.message('Échec de l\'enregistrement local : ' + err.message);
        }
    }

    /** Exporter : un fichier .json portable, téléchargé — l'ancien sens d'« Enregistrer ». */
    exporterJson() {
        try {
            const nom = enregistrerPartition(this.editeur.partition);
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
            this.arreter();
            this.editeur.remplacer(partition);
            this.message(`Importé : ${partition.meta.titre}`);
        } catch (err) {
            this.message(err.message || 'Impossible d\'ouvrir ce fichier');
        }
    }

    exporterPdf() {
        try {
            this.message('Génération du PDF…', 20000);
            const { nomFichier, nbPages } = exporterPdf(this.editeur.partition);
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

            const { partition, abandonnees } = construirePartitionDepuisMidi(analyse, piste.instrument, piste.accordage, piste.capo, zone);
            const choix = await this.choisirDans('fenetre-choix-import-midi');
            if (choix == null) return;   // annulé

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

    nouveau() {
        if (this.editeur.peutAnnuler() && !confirm('Abandonner la tablature en cours ?')) return;
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
        this._minuterieBrouillon = setTimeout(() => {
            try { localStorage.setItem(CLE_BROUILLON, JSON.stringify(this.editeur.partition)); }
            catch (err) { /* quota plein ou stockage refusé : le brouillon est un confort, pas une garantie */ }
        }, 700);
    }

    restaurerBrouillon() {
        try {
            const brut = localStorage.getItem(CLE_BROUILLON);
            if (!brut) return;
            // Passe par `normaliser` (via `remplacer`), PAS une simple assignation : un brouillon
            // écrit par une version antérieure du format (l'ancien tableau plat `evenements`, par
            // exemple) planterait sinon `mettreEnPage` au premier accès à `mesure.voix`, en silence —
            // écran noir au démarrage, rien dans la console qui pointe vers la vraie cause.
            this.editeur.remplacer(JSON.parse(brut));
        } catch (err) { /* brouillon illisible : on repart d'une partition neuve, sans rien dire */ }
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
        };
        this.el.popoverFichiers.addEventListener('click', (e) => {
            const b = e.target.closest('[data-action]');
            if (!b) return;
            this.fermerPopoverFichiers();
            actionsFichiers[b.dataset.action]?.();
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

        this.el.titre.addEventListener('input', () => this.editeur.definirMeta('titre', this.el.titre.value));
        this.el.tempo.addEventListener('change', () => this.editeur.definirTempo(parseInt(this.el.tempo.value, 10)));
        this.el.tempo.addEventListener('input', () => this.lecteur.definirTempo(parseInt(this.el.tempo.value, 10) || 120));
        surClic('btn-tap-tempo', () => this.tapTempo());

        surClic('btn-mesures-ligne-bascule', () => this.basculerGroupeMesuresLigne());
        this.construireBoutonsMesuresLigne();
        this.rafraichirFlechesTransport = this.brancherFlechesTransport();

        // Métronome : ne touche à rien de la lecture EN COURS (voir Lecteur.jouer, qui ne
        // reprogramme le transport qu'au prochain départ depuis l'arrêt) — comme tout autre
        // réglage, il prend effet à la PROCHAINE lecture, jamais en la faisant bégayer en direct.
        surClic('btn-metronome', () => {
            this.lecteur.metronomeActif = !this.lecteur.metronomeActif;
            localStorage.setItem(CLE_METRONOME, this.lecteur.metronomeActif ? '1' : '0');
            this.rafraichirMetronome();
        });
        surClic('btn-metronome-subdivision', () => {
            this.lecteur.metronomeSubdivision = !this.lecteur.metronomeSubdivision;
            localStorage.setItem(CLE_METRONOME_SUBDIVISION, this.lecteur.metronomeSubdivision ? '1' : '0');
            this.rafraichirMetronome();
        });
        this.rafraichirMetronome();

        // Clic dans la partition : place le curseur. Glisser : dessine un rectangle de sélection
        // multiple. Voir demarrerGeste — les deux commencent pareil, ne se distinguent qu'au premier
        // mouvement franc.
        this.el.feuille.addEventListener('pointerdown', (e) => this.demarrerGeste(e));
        this.el.feuille.addEventListener('contextmenu', (e) => this.ouvrirMenuContextuel(e));
        this.el.zone.addEventListener('pointerdown', () => this.el.zone.focus());
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

        // Une remise en page suit tout changement de largeur : le découpage en systèmes en dépend
        // directement, et une fenêtre réduite doit rendre des systèmes plus courts, pas une barre de
        // défilement horizontale.
        let minuterie = null;
        window.addEventListener('resize', () => {
            clearTimeout(minuterie);
            minuterie = setTimeout(() => this.dessiner(), 120);
        });

        this.el.titre.value = this.editeur.partition.meta.titre;
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

    fermerPopoverFichiers() {
        this.el.popoverFichiers.hidden = true;
        this.el.btnFichiers.setAttribute('aria-expanded', 'false');
        this._detacherPopoverFichiers?.();
        this._detacherPopoverFichiers = null;
    }

    /**
     * « Mesures par ligne » (barre de transport) : sur téléphone, six boutons toujours visibles
     * pesaient trop dans une rangée déjà chargée — Lecture/Stop, Tempo, TAP, Métronome (retour
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
            const h = (basBandeBoucle() - HAUT_BANDE_BOUCLE) * S;   // zone de SAISIE — grandit au doigt
            marques.push({ t: 'rect', x: sys.xDebut, y, w: sys.xFin - sys.xDebut, h,
                couleur: 'rgba(255, 152, 0, 0)', classe: 'bande-boucle' });

            if (!boucle) continue;
            const touche = this.page.ancrages.mesures.filter(a =>
                a.systeme === sys.index && a.index >= boucle.debut && a.index <= boucle.fin);
            if (!touche.length) continue;
            const x1 = Math.min(...touche.map(a => a.x));
            const x2 = Math.max(...touche.map(a => a.xFin));
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
            marques.push({ t: 'rect', x: xAff1, y: yAff, w: Math.max(0, xAff2 - xAff1), h: hAff, couleur: 'var(--lecture-halo)' });

            // POIGNÉES (voir LARGEUR_POIGNEE_BOUCLE) — seulement sur le VRAI bord GLOBAL de la
            // boucle (`touche` inclut l'ancrage de boucle.debut/fin lui-même), jamais sur un simple
            // retour à la ligne d'une boucle qui court sur plusieurs systèmes : ce bord-LÀ n'a rien à
            // étirer, il n'existe que parce que la portée a tourné (même distinction que HarmoHub,
            // voir buildLoopRangeBars). Centrées sur le VRAI bord de mesure (x1/x2, pas xAff1/xAff2)
            // — le même x que poigneeBoucleAuPoint : la poignée se voit EXACTEMENT là où elle se
            // saisit, quitte à déborder un peu du halo désormais en retrait. Couleur PLEINE
            // (`--lecture`, celle du curseur de lecture) plutôt que le halo translucide du reste de
            // la bande : un repère franc, pas une nuance de plus dans le dégradé.
            const largeurPx = LARGEUR_POIGNEE_BOUCLE * S;
            if (touche.some(a => a.index === boucle.debut)) {
                marques.push({ t: 'rect', x: x1 - largeurPx / 2, y: yAff, w: largeurPx, h: hAff, couleur: 'var(--lecture)' });
            }
            if (touche.some(a => a.index === boucle.fin)) {
                marques.push({ t: 'rect', x: x2 - largeurPx / 2, y: yAff, w: largeurPx, h: hAff, couleur: 'var(--lecture)' });
            }
        }
        return marques;
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
            y >= s.yBas + HAUT_BANDE_BOUCLE * S && y <= s.yBas + basBandeBoucle() * S);
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
            y >= s.yBas + HAUT_BANDE_BOUCLE * S && y <= s.yBas + basBandeBoucle() * S);
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
     * GLISSER LA BANDE DE BOUCLE : définit une zone [mesureAncre, mesure courante] à rejouer en
     * boucle. Un tap/clic SANS glisser retire la boucle en place, s'il y en avait une — sans ça,
     * aucun moyen tactile d'en annuler une (à la souris, Échap ne fait pas ce lien).
     *
     * APPLIQUÉE AU RELÂCHEMENT SEULEMENT, PAS EN CONTINU — comme l'étirement de durée (voir
     * demarrerEtirement/terminerEtirement), mais pour une raison PLUS STRICTE encore ici : appeler
     * dessiner() PENDANT un glisser TACTILE détruit l'élément SVG qui porte la capture implicite du
     * doigt (innerHTML remplacé sous lui), et le navigateur cesse alors purement et simplement de
     * livrer la suite du geste — plus aucun pointermove/pointerup, la boucle reste figée sur sa toute
     * première position (vérifié directement : un seul mouvement passait avant que tout s'arrête).
     * Un simple message tient lieu de retour pendant qu'on glisse ; le document (et l'écran) ne
     * bougent qu'une fois, à la fin.
     */
    demarrerGesteBoucle(e, mesureAncre) {
        e.preventDefault();
        const depart = { x: e.clientX, y: e.clientY };
        const SEUIL = 6;
        let bouge = false;
        let lo = mesureAncre, hi = mesureAncre;

        const surMouvement = (ev) => {
            if (!bouge && Math.hypot(ev.clientX - depart.x, ev.clientY - depart.y) < SEUIL) return;
            bouge = true;
            const courante = this.mesureLaPlusProche(ev.clientX, ev.clientY) ?? mesureAncre;
            lo = Math.min(mesureAncre, courante);
            hi = Math.max(mesureAncre, courante);
            this.message(lo === hi ? `Boucle : mesure ${lo + 1}` : `Boucle : mesures ${lo + 1} à ${hi + 1}`, 4000);
        };
        const surRelache = () => {
            window.removeEventListener('pointermove', surMouvement);
            window.removeEventListener('pointerup', surRelache);
            window.removeEventListener('pointercancel', surRelache);
            if (bouge) { this.lecteur.definirBoucle(this.editeur.partition, lo, hi); this.dessiner(); }
            else if (this.lecteur.boucleLecture) { this.lecteur.retirerBoucle(); this.dessiner(); }
            this.el.zone.focus();
        };
        window.addEventListener('pointermove', surMouvement);
        window.addEventListener('pointerup', surRelache);
        window.addEventListener('pointercancel', surRelache);
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
     * l'annuler ». Même stratégie « appliquée au relâchement seulement » que demarrerGesteBoucle,
     * pour la même raison précise (voir sa docblock) : dessiner() en plein glisser tactile couperait
     * la capture du doigt en plein geste.
     */
    demarrerGesteBoucleBord(e, bord) {
        e.preventDefault();
        const boucle = this.lecteur.boucleLecture;
        const fixe = bord === 'debut' ? boucle.fin : boucle.debut;
        let lo = boucle.debut, hi = boucle.fin;

        const surMouvement = (ev) => {
            const courante = this.mesureLaPlusProche(ev.clientX, ev.clientY);
            if (courante == null) return;
            if (bord === 'debut') { lo = Math.min(courante, fixe); hi = fixe; }
            else { hi = Math.max(courante, fixe); lo = fixe; }
            this.message(lo === hi ? `Boucle : mesure ${lo + 1}` : `Boucle : mesures ${lo + 1} à ${hi + 1}`, 4000);
        };
        const surRelache = () => {
            window.removeEventListener('pointermove', surMouvement);
            window.removeEventListener('pointerup', surRelache);
            window.removeEventListener('pointercancel', surRelache);
            this.lecteur.definirBoucle(this.editeur.partition, lo, hi);
            this.dessiner();
            this.el.zone.focus();
        };
        window.addEventListener('pointermove', surMouvement);
        window.addEventListener('pointerup', surRelache);
        window.addEventListener('pointercancel', surRelache);
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
     * Affiche ou replie le pavé de saisie tactile (voir ui/pave.js). TOUJOURS absent sur un appareil
     * non tactile (aucun réglage ne peut l'y faire apparaître : la souris fait déjà tout) ; sur un
     * appareil tactile, visible sauf si `actif` est éteint dans les Réglages (voir remplirReglages,
     * le seul endroit où ce réglage est même montré).
     *
     * Le pavé prend de la hauteur à la partition (il occupe sa propre rangée de la grille, il ne la
     * recouvre pas) : il faut donc remettre en page APRÈS que le navigateur a appliqué la nouvelle
     * grille, sinon le découpage en systèmes se calcule sur la hauteur d'avant — d'où le passage par
     * requestAnimationFrame, exactement comme pour la barre d'outils juste au-dessus.
     */
    appliquerPave(actif) {
        this.paveActif = !!actif;
        localStorage.setItem(CLE_PAVE, this.paveActif ? '1' : '0');
        const visible = this.paveActif && appareilTactile();
        this.el.pave.hidden = !visible;
        document.body.classList.toggle('avec-pave', visible);
        requestAnimationFrame(() => this.dessiner());
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
        selAccordage.innerHTML = liste
            .map(a => `<option value="${a.id}"${a.id === piste.accordage.id ? ' selected' : ''}>${a.nom}${a.cordes.length ? ' — ' + libelleAccordage(a.cordes) : ''}</option>`).join('')
            + (connu ? '' : `<option value="personnalise" selected>Personnalisé — ${libelleAccordage(piste.accordage.cordes)}</option>`);
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

        const sousTitre = document.getElementById('champ-sous-titre');
        const artiste = document.getElementById('champ-artiste');
        sousTitre.value = this.editeur.partition.meta.sousTitre || '';
        artiste.value = this.editeur.partition.meta.artiste || '';
        sousTitre.oninput = () => this.editeur.definirMeta('sousTitre', sousTitre.value);
        artiste.oninput = () => this.editeur.definirMeta('artiste', artiste.value);

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

        // Fichiers : TabHub n'a qu'un seul brouillon (voir CLE_BROUILLON, planifierBrouillon) —
        // jamais un gestionnaire multi-fichiers façon HarmoHub, hors de propos pour une appli sans
        // bibliothèque de morceaux. Ce que ce petit bloc ajoute réellement : un moyen de vérifier
        // qu'un brouillon existe, et de l'effacer sans avoir à créer un nouveau morceau pour ça.
        const etatBrouillon = document.getElementById('etat-brouillon');
        const btnViderBrouillon = document.getElementById('btn-vider-brouillon');
        const aUnBrouillon = !!localStorage.getItem(CLE_BROUILLON);
        etatBrouillon.textContent = aUnBrouillon
            ? 'Un brouillon de ce morceau est enregistré automatiquement dans ce navigateur.'
            : 'Aucun brouillon enregistré ici pour l\'instant.';
        btnViderBrouillon.disabled = !aUnBrouillon;
        btnViderBrouillon.onclick = () => {
            if (!confirm('Effacer le brouillon enregistré dans ce navigateur ?')) return;
            localStorage.removeItem(CLE_BROUILLON);
            etatBrouillon.textContent = 'Aucun brouillon enregistré ici pour l\'instant.';
            btnViderBrouillon.disabled = true;
            this.message('Brouillon local effacé');
        };
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
