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
import { construireBarreOutils } from './ui/toolbar.js';
import { icone } from './ui/icons.js';
import { mettreEnPage } from './engine/layout.js';
import { rendreSvg, PALETTE } from './render/svg.js';
import { Lecteur } from './audio/player.js';
import { enregistrerPartition, lireFichierPartition } from './io/json.js';
import { exporterPdf } from './io/pdf.js';
import { INSTRUMENTS, ACCORDAGES, libelleAccordage } from './model/instruments.js';
import { aplatir, hauteurDeNote, nbCordes, capaciteMesure, positionDansMesure } from './model/score.js';
import { ecrireHauteur, SYMBOLE_ALTERATION, LETTRE_VERS_FRANCAIS } from './model/theory.js';

const CLE_BROUILLON = 'tabhub.brouillon';
const CLE_ZOOM = 'tabhub.zoom';
const CLE_MESURES_LIGNE = 'tabhub.mesuresParLigne';
const CLE_REGLETTE = 'tabhub.reglette';
const CLE_POSITION_OUTILS = 'tabhub.positionOutils';

class TabHubApp {
    constructor() {
        this.editeur = new Editeur();
        this.lecteur = new Lecteur();
        this.page = null;
        this.interligne = parseFloat(localStorage.getItem(CLE_ZOOM)) || 9;
        // 0 = « Auto » (glouton). Une préférence d'AFFICHAGE, pas de contenu musical : elle
        // reste locale au navigateur et ne voyage jamais dans le .json — rouvrir le même
        // morceau sur un autre poste doit retomber sur l'agencement automatique.
        this.mesuresParLigne = parseInt(localStorage.getItem(CLE_MESURES_LIGNE), 10) || 0;
        // Visible par défaut (aide à l'édition) ; retenue elle aussi comme une préférence d'affichage.
        const brutReglette = localStorage.getItem(CLE_REGLETTE);
        this.regletteVisible = brutReglette === null ? true : brutReglette === '1';
        this.positionOutils = localStorage.getItem(CLE_POSITION_OUTILS) === 'gauche' ? 'gauche' : 'haut';
        document.body.classList.toggle('outils-gauche', this.positionOutils === 'gauche');
        this._minuterieMessage = null;
        this._minuterieBrouillon = null;
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
            zoom: document.getElementById('champ-zoom'),
            mesuresLigne: document.getElementById('champ-mesures-ligne'),
            reglette: document.getElementById('champ-reglette'),
            position: document.getElementById('info-position'),
            selection: document.getElementById('info-selection'),
            entreeFichier: document.getElementById('entree-fichier'),
        };

        this.restaurerBrouillon();
        this.poserIcones();
        this.rafraichirOutils = construireBarreOutils(this.el.barreOutils, this.editeur, {
            rendreLeFocus: () => this.el.zone.focus(),
        });
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
            aUneSelection: () => this.selectionNotes.size > 0,
            effacerSelection: () => this.effacerSelection(),
        });

        this.editeur.surChangement((raison) => this.surChangementEditeur(raison));
        this.lecteur.surPosition(() => this.dessiner());

        this.el.zone.focus();
        this.dessiner();
    }

    // ==========================================================================================
    // Rendu
    // ==========================================================================================

    dessiner() {
        const largeur = Math.max(560, this.el.zone.clientWidth - 48);
        try {
            this.page = mettreEnPage(this.editeur.partition, {
                S: this.interligne,
                largeurPage: largeur,
                yDepart: 6,
                mesuresParLigne: this.mesuresParLigne || null,
                reglette: this.regletteVisible,
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

        const calques = [...this.marquesLecture(), ...this.marquesCurseur(), ...this.marquesSelection()];
        this.el.feuille.style.width = `${this.page.largeur}px`;
        this.el.feuille.style.height = `${this.page.hauteur}px`;
        this.el.feuille.innerHTML = rendreSvg(this.page, {
            calquesDessous: calques,
            systemesVisibles: this.systemesVisibles(),
        });
        this._bandeDessinee = this.bandeVisible();

        this.rafraichirOutils();
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
        const bas = a.yTab + a.hauteurTab + 1.2 * S;
        const yCorde = a.yTab + this.editeur.curseur.corde * ST;
        const demi = ST * 0.62;
        const marques = [
            { t: 'rect', x: a.xDebut, y, w: a.xFin - a.xDebut, h: bas - y, couleur: 'var(--curseur-halo)' },
            { t: 'rect', x: a.x - demi, y: yCorde - ST * 0.56, w: demi * 2, h: ST * 1.12, couleur: 'var(--curseur-halo)' },
            { t: 'rect', x: a.x - demi, y: yCorde + ST * 0.5, w: demi * 2, h: Math.max(1.6, S * 0.22), couleur: 'var(--curseur)' },
        ];
        this.marqueSurReglette(marques, a.x, a.yPortee, 'var(--curseur)', 0.6);
        return marques;
    }

    /**
     * Reflète un repère (curseur ou tête de lecture) sur la réglette temporelle, à la MÊME abscisse
     * que sur la partition — la réglette et la partition partagent l'axe des x, donc « où en est-on »
     * s'y répond d'un seul coup d'œil, sans devoir recaler soi-même les deux. N'ajoute rien si la
     * réglette est masquée (`yReglette` absent du système).
     */
    marqueSurReglette(sortie, x, yPortee, couleur, largeurRel) {
        const sys = this.page?.ancrages.systemes.find(s => s.yPortee === yPortee);
        if (!sys || sys.yReglette == null) return;
        const w = Math.max(1.5, this.page.geo.S * largeurRel);
        sortie.push({ t: 'rect', x: x - w / 2, y: sys.yReglette, w, h: sys.hauteurReglette, couleur });
    }

    /**
     * Trait de lecture : une ligne verticale discrète, PAS un bandeau surlignant la note — elle
     * parcourt TOUTE la hauteur du système (portée, tablature, et la réglette quand elle est
     * affichée, puisque les trois partagent le même axe des x), plutôt qu'un repère cantonné à
     * l'évènement en cours ou, pire, isolé sur la seule réglette. Sa position s'INTERPOLE à
     * l'intérieur de l'évènement en cours plutôt que de sauter de note en note : sur une ronde à
     * 60 BPM, un trait qui saute resterait figé quatre secondes puis bondirait — on ne saurait plus
     * ce qui est en train de sonner.
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
        const sys = this.page.ancrages.systemes.find(s => s.yPortee === a.yPortee);
        const haut = a.yPortee - 1.2 * S;
        const bas = (sys && sys.yReglette != null) ? sys.yReglette + sys.hauteurReglette : a.yTab + a.hauteurTab + 1.2 * S;
        this.faireDefilerVers(a, haut, bas);

        const largeurTrait = Math.max(1.2, S * 0.15);
        return [
            { t: 'rect', x: x - S * 1.6, y: haut, w: S * 1.0, h: bas - haut, couleur: 'rgba(0, 200, 83, 0.07)' },
            { t: 'rect', x: x - S * 0.6, y: haut, w: S * 0.6, h: bas - haut, couleur: 'rgba(0, 200, 83, 0.16)' },
            { t: 'rect', x: x - largeurTrait / 2, y: haut, w: largeurTrait, h: bas - haut, couleur: 'var(--curseur)' },
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
            if (midi != null) {
                const e = ecrireHauteur(midi, 0);
                texte += ` · case ${note.frette} · ${LETTRE_VERS_FRANCAIS[e.lettre]}${SYMBOLE_ALTERATION[String(e.alteration)]}${e.octave}`;
            }
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
                // veut réentendre la mesure 14, pas les treize précédentes à chaque essai.
                const depuis = this.positionDuCurseurEnNoires();
                await this.lecteur.jouer(this.editeur.partition, depuis);
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
        let t = 0;
        for (let m = 0; m < c.mesure; m++) t += capaciteMesure(this.editeur.partition, m);
        return t + positionDansMesure(this.editeur.partition.mesures[c.mesure], c.evenement, c.voix);
    }

    rafraichirTransport() {
        const btn = document.getElementById('btn-jouer');
        const enLecture = this.lecteur.etat === 'lecture';
        btn.innerHTML = icone(enLecture ? 'pause' : 'lecture');
        btn.title = enLecture ? 'Pause (Espace)' : 'Lecture (Espace)';
        btn.setAttribute('aria-label', btn.title);
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
        const paires = {
            'btn-annuler': 'annuler', 'btn-retablir': 'retablir', 'btn-nouveau': 'nouveau',
            'btn-ouvrir': 'ouvrir', 'btn-exporter': 'exporter', 'btn-enregistrer': 'enregistrer', 'btn-pdf': 'pdf',
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
        surClic('btn-nouveau', () => this.nouveau());
        surClic('btn-ouvrir', () => this.ouvrir());
        surClic('btn-exporter', () => this.exporterJson());
        surClic('btn-enregistrer', () => this.enregistrer());
        surClic('btn-pdf', () => this.exporterPdf());
        surClic('btn-reglages', () => { this.remplirReglages(); this.ouvrirFenetre('fenetre-reglages'); });
        surClic('btn-aide', () => { this.remplirAide(); this.ouvrirFenetre('fenetre-aide'); });
        surClic('btn-jouer', () => this.lectureAlternee());
        surClic('btn-stop', () => this.arreter());

        this.el.entreeFichier.addEventListener('change', (e) => {
            const f = e.target.files?.[0];
            if (f) this.chargerFichier(f);
            e.target.value = '';   // réinitialisé pour que rouvrir LE MÊME fichier redéclenche l'évènement
        });

        this.el.titre.addEventListener('input', () => this.editeur.definirMeta('titre', this.el.titre.value));
        this.el.tempo.addEventListener('change', () => this.editeur.definirTempo(parseInt(this.el.tempo.value, 10)));
        this.el.tempo.addEventListener('input', () => this.lecteur.definirTempo(parseInt(this.el.tempo.value, 10) || 120));

        this.el.zoom.value = this.interligne;
        this.el.zoom.addEventListener('input', () => {
            this.interligne = parseFloat(this.el.zoom.value);
            localStorage.setItem(CLE_ZOOM, String(this.interligne));
            this.dessiner();
        });

        this.el.mesuresLigne.value = String(this.mesuresParLigne);
        this.el.mesuresLigne.addEventListener('change', () => {
            this.mesuresParLigne = parseInt(this.el.mesuresLigne.value, 10) || 0;
            localStorage.setItem(CLE_MESURES_LIGNE, String(this.mesuresParLigne));
            this.dessiner();
        });

        this.el.reglette.checked = this.regletteVisible;
        this.el.reglette.addEventListener('change', () => {
            this.regletteVisible = this.el.reglette.checked;
            localStorage.setItem(CLE_REGLETTE, this.regletteVisible ? '1' : '0');
            this.dessiner();
        });

        // Clic dans la partition : place le curseur. Glisser : dessine un rectangle de sélection
        // multiple. Voir demarrerGeste — les deux commencent pareil, ne se distinguent qu'au premier
        // mouvement franc.
        this.el.feuille.addEventListener('pointerdown', (e) => this.demarrerGeste(e));
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
    clicPartition(evenement) {
        if (!this.page) return;
        // Un clic simple (sans glisser) abandonne la sélection multiple en cours — la convention
        // universelle : cliquer À CÔTÉ désélectionne. Le clic continue ensuite comme avant.
        if (this.selectionNotes.size) { this.selectionNotes.clear(); this.dessiner(); }
        const svg = this.el.feuille.querySelector('svg');
        if (!svg) return;
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
        if (!systeme) { this.el.zone.focus(); return; }

        const candidats = this.page.ancrages.evenements.filter(a => a.yPortee === systeme.yPortee);
        if (!candidats.length) return;
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
        this.editeur.placerCurseur(cible.mesure, cible.evenement, corde, cible.voix);
        this.el.zone.focus();
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
        const depart = { x: e.clientX, y: e.clientY };
        let actif = false;
        const SEUIL = 4;

        const surMouvement = (ev) => {
            if (!actif && Math.hypot(ev.clientX - depart.x, ev.clientY - depart.y) < SEUIL) return;
            if (!actif) { actif = true; this.demarrerLasso(depart); }
            this.etendreLasso(ev);
        };
        const surRelache = (ev) => {
            window.removeEventListener('pointermove', surMouvement);
            window.removeEventListener('pointerup', surRelache);
            if (actif) this.terminerLasso(ev);
            else this.clicPartition(e);   // pas de mouvement franc : un clic ordinaire
        };
        window.addEventListener('pointermove', surMouvement);
        window.addEventListener('pointerup', surRelache);
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
            .map(a => `<option value="${a.id}"${a.id === piste.accordage.id ? ' selected' : ''}>${a.nom} — ${libelleAccordage(a.cordes)}</option>`).join('')
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
            const e = ecrireHauteur(midi, 0);
            const nom = `${LETTRE_VERS_FRANCAIS[e.lettre]}${SYMBOLE_ALTERATION[String(e.alteration)]}${e.octave}`;
            return `<label class="corde-reglage">
                <span>Corde ${cordes.length - i}</span>
                <select class="champ" data-corde="${i}">
                    ${Array.from({ length: 49 }, (_, k) => midi - 24 + k)
                        .filter(m => m >= 12 && m <= 96)
                        .map(m => { const w = ecrireHauteur(m, 0);
                            const l = `${LETTRE_VERS_FRANCAIS[w.lettre]}${SYMBOLE_ALTERATION[String(w.alteration)]}${w.octave}`;
                            return `<option value="${m}"${m === midi ? ' selected' : ''}>${l}</option>`; }).join('')}
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
