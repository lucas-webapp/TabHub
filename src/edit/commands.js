// L'ÉDITEUR : l'état modifiable de l'application (partition + curseur + historique) et toutes les
// opérations qui le changent.
//
// RÈGLE DU MODULE : rien de ce qui est ici ne touche au DOM, et rien n'appelle le rendu. Une commande
// modifie le modèle, déplace le curseur, et c'est tout. L'interface s'abonne (`surChangement`) et
// redessine quand elle est prévenue.
//
// Ce cloisonnement n'est pas de la théorie : il rend chaque commande éprouvable sans navigateur (voir
// les bancs d'essai), et il garantit que l'ANNULATION est complète. Une commande qui écrirait au
// passage dans un attribut du DOM laisserait, après un Ctrl+Z, un écran désaccordé du modèle — le
// genre de désynchronisation qu'on ne diagnostique qu'à la dixième reproduction.
//
// HISTORIQUE PAR INSTANTANÉS. Chaque commande enregistre une copie complète de la partition avant de
// la modifier. C'est plus coûteux en mémoire qu'un journal d'opérations inversibles, et c'est un choix
// délibéré : à l'échelle d'un riff (quelques dizaines de mesures, quelques kilo-octets), le coût est
// négligeable, alors qu'un journal d'inverses demande d'écrire — et de tenir juste — une opération
// inverse pour CHACUNE des vingt commandes ci-dessous. La première inverse fausse produit une
// corruption silencieuse du document, découverte trois annulations plus tard.

import {
    creerPartition, creerMesure, creerEvenement, creerNote, creerVoix, cloner, normaliser,
    signatureEffective, armureEffective, nbCordes, dureeEcrite, capaciteMesure, REPERES,
    decouperEnEvenements, figuresSilencePour, MAX_VOIX, aplatir,
} from '../model/score.js';
import { dureeEnNoires, noiresParMesure, VALEURS_FIGURES } from '../model/duration.js';
import { INSTRUMENTS, accordageParDefaut, accordagePredefini, identifierAccordage, hauteurDeCase } from '../model/instruments.js';
import { silencesAlignes } from '../model/rythme.js';

/** Position d'un évènement DANS SA VOIX, en noires depuis la barre de mesure. Le pendant de
 *  score.js#positionDansMesure pour les endroits qui n'ont sous la main qu'une VOIX — parfois
 *  une copie de travail (voir insererEvenement), jamais la mesure entière. */
function positionDe(voix, index) {
    let t = 0;
    const evts = voix?.evenements || [];
    for (let i = 0; i < index && i < evts.length; i++) t += dureeEnNoires(evts[i].duree);
    return t;
}

const MAX_HISTORIQUE = 150;
/** Fenêtre pendant laquelle un second chiffre complète le premier (« 1 » puis « 2 » → case 12). */
export const DELAI_DEUXIEME_CHIFFRE = 950;

export class Editeur {
    constructor(partition = null) {
        this.partition = partition || creerPartition('guitare');
        this.curseur = { mesure: 0, voix: 0, evenement: 0, corde: 0 };
        this.passe = [];
        this.futur = [];
        this.auditeurs = new Set();
        // Durée « collante » : la figure choisie reste active pour les notes suivantes. Sans elle, il
        // faudrait redire « croche » à chaque note d'un trait de croches — de loin le geste le plus
        // répété de la saisie.
        this.dureeCourante = { valeur: 8, points: 0, nolet: null };
        this._dernierChiffre = null;   // { temps, mesure, evenement, corde, valeur }
        // Message de la DERNIÈRE commande refusée (ex. appliquerDuree faute de place) — l'éditeur ne
        // touche jamais au DOM, donc jamais de toast d'ici ; l'appelant (main.js) lit ce champ juste
        // après avoir invoqué une commande et l'affiche si besoin.
        this.derniereErreur = null;
        // LA DETTE LAISSÉE PAR LE DERNIER ALLONGEMENT — { mesure, voix, evenement, dette } ou `null`.
        // Même mécanique que `derniereErreur`, et pour la même raison : l'éditeur ne touche pas au
        // DOM. La différence est de nature — ce n'est pas un échec, c'est un état du document que
        // l'interface doit ANNONCER, avec les deux façons de le régler (voir absorberDette et
        // corrigerDebordement). Il tombe au geste suivant : il décrit le dernier geste, pas la mesure.
        this.derniereDette = null;
        // COMBIEN DE LIAISONS LE DERNIER GESTE A RENDUES ORPHELINES, et donc retirées (voir
        // _nettoyerLiens). Même mécanique et même raison que les deux champs ci-dessus : ce n'est ni
        // un échec ni une décision, c'est une CONSÉQUENCE du geste, et elle doit se dire.
        this.derniersLiensRetires = 0;
        // CE QUE LE DERNIER GESTE A COÛTÉ, en une phrase — ou `null`.
        //
        // Le troisième et dernier des canaux « l'éditeur ne touche pas au DOM », et le plus large :
        // `derniereErreur` dit qu'un geste a été refusé, `derniereDette` qu'un état attend une
        // décision, celui-ci qu'un geste a RÉUSSI mais qu'il a emporté quelque chose au passage.
        // Il sert aux commandes dont le NOM ne dit pas tout ce qu'elles font — passer de la guitare
        // à la basse efface les notes des deux cordes qui disparaissent, retirer la seconde voix
        // emporte ce qu'elle portait. Un geste explicitement destructeur (« supprimer la mesure »,
        // « effacer la note ») n'a rien à déclarer : son nom l'a déjà fait.
        this.dernierBilan = null;
        // PRESSE-PAPIER D'UNE MESURE (voir copierMesure/collerMesure). Volontairement porté par
        // l'éditeur et non par l'interface : c'est un fragment de DOCUMENT, et il doit survivre à un
        // `nouveau()` comme à un changement d'instrument — copier une mesure de guitare pour la
        // reporter dans une basse est un geste légitime, que collerMesure sait rendre sûr.
        this.presseMesure = null;
    }

    // -- Abonnement ------------------------------------------------------------------------------
    surChangement(fn) { this.auditeurs.add(fn); return () => this.auditeurs.delete(fn); }
    /**
     * Prévient les abonnés — ET TIENT L'INVARIANT DES LIAISONS au passage.
     *
     * POURQUOI ICI PLUTÔT QUE DANS CHAQUE COMMANDE. « Aucune liaison ne pointe vers le vide » est un
     * invariant du DOCUMENT, pas une étape d'un geste particulier. Une douzaine de commandes peuvent
     * le rompre — raccourcir, effacer, supprimer, absorber, déverser, insérer, coller, remplacer une
     * mesure — et il suffit d'en oublier une, aujourd'hui ou dans six mois, pour que le défaut revienne
     * par cette porte-là. `prevenir` est l'entonnoir par lequel TOUTE mutation s'annonce : un seul
     * endroit à tenir juste plutôt que douze.
     *
     * APRÈS `memoriser`, TOUJOURS. Chaque commande mémorise avant de modifier et n'appelle ceci
     * qu'une fois finie : le nettoyage tombe donc à l'intérieur du même point d'annulation que le
     * geste qui l'a rendu nécessaire — un seul Ctrl+Z ramène la note ET sa liaison.
     *
     * PAS SUR 'annulation' NI 'retablissement' : restaurer un instantané doit le rendre TEL QUEL. Le
     * nettoyer à la volée ferait diverger l'état restauré de l'instantané empilé, et un aller-retour
     * annuler/rétablir cesserait de retomber sur ses pieds. Pas sur 'curseur' ni 'lecture' non plus :
     * rien n'y change, et un balayage complet à chaque déplacement de curseur se paierait pour rien.
     */
    prevenir(raison = 'edition') {
        if (raison === 'edition' || raison === 'saisie' || raison === 'document') {
            const n = this._nettoyerLiens();
            if (n) this.derniersLiensRetires = n;
        }
        for (const fn of this.auditeurs) fn(raison);
    }

    /**
     * RETIRE LES LIAISONS DEVENUES ORPHELINES — celles dont la note d'arrivée n'existe plus.
     *
     * UNE LIAISON RELIE DEUX NOTES VOISINES SUR LA MÊME CORDE, et n'a aucun sens autrement : une
     * prolongation qui ne prolonge rien, un hammer-on qui ne mène nulle part. Le modèle la décrit par
     * un champ sur la note de DÉPART (`note.lien`, voir model/score.js) — une forme compacte, qui a
     * le défaut de survivre à la disparition de l'arrivée.
     *
     * LE VRAI DANGER N'EST PAS LA LIAISON ORPHELINE, C'EST SA RÉSURRECTION. Tant qu'elle pointe vers
     * un silence, ni le son ni la gravure n'en font rien : le lecteur s'arrête faute de note à
     * prolonger (voir audio/player.js), le traceur ne trouve pas de seconde note à relier (voir
     * engine/layout.js#poserLiaisons). Elle dort. Mais le jour où l'on écrit une case dans ce silence
     * — le geste le plus naturel du monde —, elle se réveille et relie deux notes qui n'ont jamais eu
     * à l'être. Mesuré : raccourcir la première de deux noires liées, puis remplir le silence apparu,
     * donnait une case 5 LIÉE à une case 9 — deux hauteurs différentes réunies par une liaison de
     * PROLONGATION, sans que personne l'ait demandé ni que rien ne le dise.
     *
     * LA CHAÎNE TRAVERSE LES BARRES DE MESURE, comme chez le lecteur audio (voir
     * audio/player.js#suivantMemeVoix) : une liaison posée sur la dernière note d'une mesure vers la
     * première de la suivante est parfaitement légitime, c'est même ainsi qu'on écrit une note tenue
     * par-dessus la barre. On passe donc par `aplatir`, la même vue à plat que le lecteur — une
     * seconde façon de chaîner les évènements finirait par ne plus dire la même chose que la première.
     *
     * CE QU'IL NE FAIT PAS, et c'est délibéré : il ne vérifie pas que la note d'arrivée est LA MÊME
     * qu'au moment où la liaison a été posée. Effacer une note entre deux autres fait glisser la
     * cible d'un cran, et la liaison suit — comme chez MuseScore et Guitar Pro, où une liaison est un
     * rapport entre une note et sa voisine, pas un lien vers un objet nommé. Le retenir demanderait
     * de stocker l'identité de la cible ; le bénéfice ne paie pas le modèle.
     *
     * @returns {number} combien de liaisons ont été retirées.
     */
    _nettoyerLiens() {
        const parVoix = new Map();
        for (const e of aplatir(this.partition)) {
            if (!parVoix.has(e.voix)) parVoix.set(e.voix, []);
            parVoix.get(e.voix).push(e);
        }
        let retires = 0;
        for (const liste of parVoix.values()) {
            for (let k = 0; k < liste.length; k++) {
                const ev = liste[k].ref;
                if (ev.silence || !ev.notes.length) continue;
                const suivant = liste[k + 1]?.ref;
                for (const note of ev.notes) {
                    if (!note.lien) continue;
                    const cible = suivant && !suivant.silence
                        && suivant.notes.some(nn => nn.corde === note.corde);
                    if (!cible) { note.lien = null; retires++; }
                }
            }
        }
        return retires;
    }

    // -- Historique ------------------------------------------------------------------------------
    /**
     * L'ANNEXE : un état qui voyage dans l'historique SANS appartenir au document.
     *
     * POURQUOI DEUX CROCHETS PLUTÔT QU'UN CHAMP. Retour utilisateur : « le bouton undo/redo doit
     * aussi concerner la mise en place de la barre de lecture ». Or la bande de boucle appartient au
     * LECTEUR, pas au document — elle n'est pas enregistrée dans le fichier, et cet éditeur n'a
     * aucune raison de savoir ce qu'est une boucle de lecture. Deux fonctions posées de l'extérieur
     * (voir main.js#brancherAnnexeHistorique) suffisent : l'une dit « voici mon état courant »,
     * l'autre « repose celui-ci ». L'éditeur ne transporte qu'un objet opaque, qu'il ne lit jamais.
     *
     * Le jour où une autre préférence de session devra suivre l'annulation, elle passera par le même
     * canal — sans rouvrir cette classe.
     */
    lireAnnexe = () => null;
    ecrireAnnexe = () => {};

    /**
     * Enregistre l'état AVANT modification. `fusion` permet à une suite de gestes de même nature
     * (taper les deux chiffres d'une case, tirer le tempo) de ne compter que pour une annulation :
     * sans ça, défaire « case 12 » demanderait deux Ctrl+Z, dont le premier laisserait « case 1 ».
     */
    memoriser(fusion = null) {
        const dernier = this.passe[this.passe.length - 1];
        if (fusion && dernier && dernier.fusion === fusion && Date.now() - dernier.temps < 1200) {
            dernier.temps = Date.now();
            return;
        }
        this._empiler(this.passe, { fusion, annexe: this.lireAnnexe() });
        this.futur.length = 0;
        this.partition.meta.modifieLe = new Date().toISOString();
    }

    /**
     * Enregistre une étape dont le DOCUMENT NE CHANGE PAS — seule l'annexe. C'est le cas de la bande
     * de boucle : la poser ne touche pas une note.
     *
     * `modifieLe` N'EST DÉLIBÉRÉMENT PAS TOUCHÉ, et c'est le point délicat. Poser une boucle ne
     * modifie pas le morceau : le marquer comme modifié ferait réclamer un enregistrement à la
     * fermeture (voir main.js, le garde-fou qui s'appuie sur `peutAnnuler`) pour quelque chose qui
     * n'est même pas enregistré dans le fichier. L'étape existe donc pour l'annulation, et pour elle
     * seule.
     *
     * @param {*} avant l'annexe TELLE QU'ELLE ÉTAIT avant le geste — fournie par l'appelant, qui
     *   l'a photographiée au début. On ne peut pas la relire ici : au moment où l'on enregistre
     *   l'étape, le changement est déjà fait.
     */
    memoriserAnnexe(avant) {
        this._empiler(this.passe, { annexe: avant, documentIntact: true });
        this.futur.length = 0;
    }

    /** Empile une entrée d'historique — un seul endroit qui sait de quoi une entrée est faite. */
    _empiler(pile, extra = {}) {
        pile.push({
            etat: cloner(this.partition),
            curseur: { ...this.curseur },
            temps: Date.now(),
            ...extra,
        });
        if (pile.length > MAX_HISTORIQUE) pile.shift();
    }

    peutAnnuler() { return this.passe.length > 0; }
    peutRetablir() { return this.futur.length > 0; }

    /** Le nombre d'étapes qui ont VRAIMENT touché au document — ce sur quoi s'appuient les
     *  garde-fous « travail non enregistré », qui ne doivent pas s'alarmer d'une bande de boucle. */
    etapesDocument() { return this.passe.filter(e => !e.documentIntact).length; }

    annuler() {
        if (!this.passe.length) return false;
        const entree = this.passe.pop();
        this._empiler(this.futur, { annexe: this.lireAnnexe(), documentIntact: entree.documentIntact });
        this.partition = entree.etat;
        this.curseur = entree.curseur;
        this.ecrireAnnexe(entree.annexe);
        this.corrigerCurseur();
        this.prevenir('annulation');
        return true;
    }

    retablir() {
        if (!this.futur.length) return false;
        const entree = this.futur.pop();
        this._empiler(this.passe, { annexe: this.lireAnnexe(), documentIntact: entree.documentIntact });
        this.partition = entree.etat;
        this.curseur = entree.curseur;
        this.ecrireAnnexe(entree.annexe);
        this.corrigerCurseur();
        this.prevenir('retablissement');
        return true;
    }

    // -- Curseur ---------------------------------------------------------------------------------

    /** Ramène le curseur dans les bornes après toute opération qui a pu raccourcir la partition
     *  ou faire disparaître la voix visée (suppression de la 2e voix, par exemple). */
    corrigerCurseur() {
        const c = this.curseur;
        c.mesure = Math.max(0, Math.min(c.mesure, this.partition.mesures.length - 1));
        const mesure = this.partition.mesures[c.mesure];
        c.voix = Math.max(0, Math.min(c.voix, mesure.voix.length - 1));
        c.evenement = Math.max(0, Math.min(c.evenement, mesure.voix[c.voix].evenements.length - 1));
        c.corde = Math.max(0, Math.min(c.corde, nbCordes(this.partition) - 1));
    }

    mesureCourante() { return this.partition.mesures[this.curseur.mesure]; }
    voixCourante() { return this.mesureCourante().voix[this.curseur.voix]; }
    evenementCourant() { return this.voixCourante().evenements[this.curseur.evenement]; }
    noteCourante() {
        return this.evenementCourant().notes.find(n => n.corde === this.curseur.corde) || null;
    }

    /** Nombre de voix de la mesure `index` (celle du curseur par défaut). 1 la plupart du temps. */
    nbVoixMesure(index = this.curseur.mesure) {
        return this.partition.mesures[index].voix.length;
    }

    /** Déplace le curseur d'une corde. Ne franchit PAS les bords : une TAB n'a pas de corde 7. */
    deplacerCorde(delta) {
        const n = nbCordes(this.partition);
        const suivant = this.curseur.corde + delta;
        if (suivant < 0 || suivant >= n) return false;
        this.curseur.corde = suivant;
        this._dernierChiffre = null;
        this.prevenir('curseur');
        return true;
    }

    /**
     * Déplace le curseur d'un évènement, en franchissant les barres de mesure.
     *
     * LE GESTE CENTRAL DE LA SAISIE, et celui qui décide de la fluidité de l'application : on tape une
     * case, on appuie sur →, on tape la suivante. Pour que ça marche, aller à droite depuis le DERNIER
     * évènement d'une mesure doit PROLONGER cette mesure tant qu'elle n'est pas pleine — et non sauter
     * à la suivante. Une première version sautait : écrire quatre croches dans une mesure à 4/4
     * dispersait les quatre notes sur quatre mesures différentes, ce qui rendait la saisie au clavier
     * inutilisable, précisément là où elle devait être la plus rapide.
     *
     * La mesure se remplit donc d'elle-même, à la durée courante, jusqu'à ce que la figure suivante
     * n'y tienne plus — alors seulement on passe à la mesure d'après. Insérer volontairement un
     * évènement de trop reste possible, mais par un geste explicite (Entrée).
     */
    deplacerEvenement(delta) {
        // La voix visée par une mesure DIFFÉRENTE de la courante peut ne pas y exister (la voix 2
        // ne couvre pas forcément tout le morceau) : on retombe alors sur la dernière voix
        // disponible de cette mesure-là — dans l'immense majorité des cas la voix 0, toujours
        // présente. C'est ce petit repli qui permet à un simple « → » de continuer naturellement
        // sur la mélodie quand on sort d'une mesure à deux voix vers une mesure qui n'en a qu'une.
        const iVoixPreferee = this.curseur.voix;
        const voixDe = (indexMesure) => {
            const m = this.partition.mesures[indexMesure];
            return m.voix[Math.min(iVoixPreferee, m.voix.length - 1)];
        };

        if (delta > 0) {
            const voix = this.voixCourante();
            const dernier = this.curseur.evenement === voix.evenements.length - 1;
            if (dernier) {
                const reste = capaciteMesure(this.partition, this.curseur.mesure) - dureeEcrite(this.mesureCourante(), this.curseur.voix);
                const dureeNouvel = dureeEnNoires(this.dureeCourante);
                if (reste >= dureeNouvel - 1e-9) {
                    this.memoriser('prolonger');
                    voix.evenements.push(creerEvenement({ ...this.dureeCourante }, [], { silence: true }));
                    // Le RESTE de la mesure, au-delà de cette seule case neuve, doit rester représenté
                    // par du VRAI silence plutôt qu'implicitement absent — sans quoi la voix retombe
                    // sous sa capacité dès qu'on n'enchaîne pas jusqu'au bout (avancer une fois, puis
                    // s'arrêter là — cas le plus courant de tous). C'est cette dette silencieuse qui
                    // rendait ensuite un silence de fin trop court pour être allongé, symptôme du
                    // retour utilisateur (« l'application m'empêche de modifier la durée d'un
                    // silence ») — et qui, accumulée mesure après mesure, ne laissait plus d'autre
                    // recours que supprimer et tout refaire.
                    const restant = reste - dureeNouvel;
                    if (restant > 1e-9) voix.evenements.push(
                        ...this._silences(voix, positionDe(voix, voix.evenements.length), restant));
                    this.curseur.evenement += 1;
                    this._dernierChiffre = null;
                    this.prevenir('curseur');
                    return true;
                }
            }
        }

        let { mesure, evenement } = this.curseur;
        evenement += delta;
        while (evenement < 0) {
            if (mesure === 0) { evenement = 0; break; }
            mesure -= 1;
            evenement += voixDe(mesure).evenements.length;
        }
        while (evenement >= voixDe(mesure).evenements.length) {
            if (mesure === this.partition.mesures.length - 1) {
                if (delta <= 0) { evenement = voixDe(mesure).evenements.length - 1; break; }
                this.memoriser('avancer');
                this.partition.mesures.push(creerMesure());
            }
            evenement -= voixDe(mesure).evenements.length;
            mesure += 1;
        }
        this.curseur.mesure = mesure;
        this.curseur.voix = Math.min(iVoixPreferee, this.partition.mesures[mesure].voix.length - 1);
        this.curseur.evenement = evenement;
        this._dernierChiffre = null;
        this.prevenir('curseur');
        return true;
    }

    /** Saut de mesure entière — Origine/Fin et navigation rapide. */
    allerAMesure(index, evenement = 0) {
        this.curseur.mesure = Math.max(0, Math.min(index, this.partition.mesures.length - 1));
        const m = this.mesureCourante();
        this.curseur.voix = Math.min(this.curseur.voix, m.voix.length - 1);
        const evs = m.voix[this.curseur.voix].evenements;
        this.curseur.evenement = evenement < 0 ? evs.length - 1 : Math.min(evenement, evs.length - 1);
        this._dernierChiffre = null;
        this.prevenir('curseur');
    }

    placerCurseur(mesure, evenement, corde, voix) {
        this.curseur = { mesure, voix: voix ?? this.curseur.voix, evenement, corde: corde ?? this.curseur.corde };
        this.corrigerCurseur();
        this._dernierChiffre = null;
        this.prevenir('curseur');
    }

    // -- Voix ------------------------------------------------------------------------------------
    //
    // Deux voix au maximum en V1 (voir model/score.js) : la mélodie (voix 0, toujours présente) et
    // une voix d'accompagnement — basse tenue, par exemple — qui partage la même mesure sans
    // partager son rythme. Ajouter/retirer une voix est une opération PAR MESURE, pas sur le
    // morceau entier : on se place où la seconde voix doit commencer, et seule cette mesure change.
    // Un morceau qui en a besoin partout s'obtient en la répétant mesure après mesure — plus prévisible
    // qu'un geste global qui ajouterait une voix vide à des dizaines de mesures qui n'en voulaient pas.

    /** Ajoute une 2e voix à la mesure courante, et s'y place aussitôt pour la remplir. */
    ajouterVoix() {
        const m = this.mesureCourante();
        if (m.voix.length >= MAX_VOIX) return false;
        this.memoriser();
        m.voix.push(creerVoix(capaciteMesure(this.partition, this.curseur.mesure)));
        this.curseur.voix = m.voix.length - 1;
        this.curseur.evenement = 0;
        this._dernierChiffre = null;
        this.prevenir('edition');
        return true;
    }

    /** Retire la voix d'accompagnement de la mesure courante. La voix 0 (mélodie) ne se retire jamais. */
    supprimerVoix() {
        const m = this.mesureCourante();
        if (m.voix.length <= 1) return false;
        this.memoriser();
        const [partie] = m.voix.splice(m.voix.length - 1, 1);
        // CE QU'ELLE EMPORTAIT SE DIT. « Retirer la seconde voix » ne prévient pas, par son seul
        // nom, qu'il y avait peut-être une basse tenue écrite dedans — et une fois la palette
        // redessinée, plus rien à l'écran ne rappelle qu'elle a existé.
        const perdues = partie.evenements.reduce((t, e) => t + e.notes.length, 0);
        this.dernierBilan = perdues
            ? `Seconde voix retirée — ${perdues} note${perdues > 1 ? 's' : ''} avec elle. Ctrl+Z les ramène.`
            : null;
        this.corrigerCurseur();
        this._dernierChiffre = null;
        this.prevenir('edition');
        return true;
    }

    /**
     * DEUX VOIX SUR CETTE MESURE, ou une seule — le geste unique qui remplace « + Voix »/« − Voix ».
     *
     * POURQUOI UN SEUL BOUTON. Les deux boutons ont été retirés de la palette guitare/basse sur un
     * retour sans appel : « je ne comprends pas les boutons voix+/voix-, à quoi cela sert-il ? ».
     * Ils avaient deux défauts. Ils étaient DEUX pour deux états d'une même question, ce qui oblige
     * à deviner lequel s'applique ; et « voix » ne dit rien de l'usage — or l'usage, à la guitare,
     * a un nom que tout guitariste connaît : une basse tenue sous la mélodie, l'écriture de *Jeux
     * interdits* et de tout le répertoire en fingerstyle. Un interrupteur nommé « 2 voix », dont
     * l'infobulle donne cet exemple, répond à la question que l'ancien posait.
     *
     * LE MOTEUR SAVAIT DÉJÀ LES GRAVER : hampes opposées, silences décalés, ligatures et liaisons
     * par voix, évitement de collision (voir engine/layout.js, la boucle `m.ref.voix.forEach`). Il
     * n'y manquait que cette porte.
     *
     * PAR MESURE, comme les deux commandes qu'il enveloppe : on se place là où la seconde voix doit
     * commencer, et seule cette mesure change. Un morceau qui en a besoin partout s'obtient avec
     * `deuxVoixPartout`, un geste explicite — plutôt qu'en faisant de ce bouton-ci un geste global
     * dont on ne saurait plus s'il vise une mesure ou cent.
     */
    basculerDeuxVoix() {
        return this.nbVoixMesure() > 1 ? this.supprimerVoix() : this.ajouterVoix();
    }

    /**
     * LA SECONDE VOIX SUR TOUT LE MORCEAU, ou nulle part.
     *
     * Une pièce écrite à deux voix l'est du début à la fin : la demander mesure par mesure sur
     * trente-deux mesures est une corvée qui ferait renoncer. C'est donc un geste à part, ET
     * EXPLICITE — c'est bien pour cela qu'il ne se confond pas avec l'interrupteur par mesure.
     *
     * UN SEUL `memoriser` POUR TOUT : l'annulation ramène le morceau entier d'un coup, et non
     * mesure par mesure. Une centaine d'entrées d'historique pour un seul geste rendrait Ctrl+Z
     * inutilisable là où on en a le plus besoin.
     */
    deuxVoixPartout(actif) {
        // ON COMPTE AVANT DE MÉMORISER : un geste qui ne change rien ne doit pas laisser d'entrée
        // dans l'historique, sinon Ctrl+Z « ne fait rien » une fois de plus à chaque clic inutile.
        const aFaire = this.partition.mesures.filter(m =>
            actif ? m.voix.length < MAX_VOIX : m.voix.length > 1);
        if (!aFaire.length) return 0;
        this.memoriser();
        let touchees = 0;
        this.partition.mesures.forEach((m, iMesure) => {
            if (actif && m.voix.length < MAX_VOIX) {
                m.voix.push(creerVoix(capaciteMesure(this.partition, iMesure)));
                touchees++;
            } else if (!actif && m.voix.length > 1) {
                m.voix.length = 1;
                touchees++;
            }
        });
        this.corrigerCurseur();
        this._dernierChiffre = null;
        this.prevenir('edition');
        return touchees;
    }

    /** Bascule la saisie sur la voix suivante de la mesure courante (Tab). Sans effet à une seule voix. */
    basculerVoix() {
        const n = this.nbVoixMesure();
        if (n <= 1) return false;
        this.curseur.voix = (this.curseur.voix + 1) % n;
        this.curseur.evenement = 0;   // la voix visée a son propre rythme, on en repart du début
        this._dernierChiffre = null;
        this.prevenir('curseur');
        return true;
    }

    // -- Saisie des notes -------------------------------------------------------------------------

    /**
     * PROLONGE une note liée insérée par l'aide rythmique : la même case, sur tous les évènements de
     * la chaîne, avec la liaison qui les relie.
     *
     * POURQUOI `lienSuivant` ET NON LA LIAISON ELLE-MÊME. Une liaison vit sur la NOTE (`note.lien`),
     * et une case à remplir n'a justement pas encore de note — l'aide pose des évènements vides.
     * L'intention est donc portée par l'évènement, et consommée ici (voir
     * model/rythme.js#evenementsParMesure, qui l'écrit).
     *
     * LA CHAÎNE PEUT TRAVERSER UNE BARRE : on avance d'évènement en évènement, et de mesure en
     * mesure quand la voix courante est épuisée, tant que le maillon précédent annonce une suite.
     */
    _prolongerLiaison(depart, corde, frette) {
        const iVoix = this.curseur.voix;
        let iM = this.curseur.mesure, iE = this.curseur.evenement;
        let courant = depart;
        let garde = 0;
        while (courant.lienSuivant && garde++ < 64) {
            const note = courant.notes.find(n => n.corde === corde);
            if (note) note.lien = 'tie';
            // Le maillon suivant : l'évènement d'après dans cette voix, ou le premier de la mesure
            // suivante quand on vient d'écrire le dernier.
            const voix = this.partition.mesures[iM]?.voix[iVoix];
            if (!voix) break;
            if (iE + 1 < voix.evenements.length) { iE++; } else { iM++; iE = 0; }
            const suivant = this.partition.mesures[iM]?.voix[iVoix]?.evenements[iE];
            if (!suivant) break;
            suivant.silence = false;
            suivant.aRemplir = false;
            const dejaLa = suivant.notes.find(n => n.corde === corde);
            if (dejaLa) dejaLa.frette = frette;
            else suivant.notes.push(creerNote(corde, frette));
            courant = suivant;
        }
    }

    /**
     * Saisie d'un chiffre de case.
     *
     * LE CAS À DEUX CHIFFRES. Une guitare va jusqu'à la case 24 : taper « 1 » puis « 2 » doit donner
     * la case 12, pas deux fois la case 1 ni la case 1 puis un déplacement. La règle appliquée est
     * celle des éditeurs de tablature établis : un second chiffre tapé RAPIDEMENT, sur la MÊME corde
     * du MÊME évènement, complète le premier — s'il forme une case atteignable. « 2 » puis « 7 »
     * donnerait 27, hors du manche : on garde alors 7, ce que l'utilisateur voulait forcément dire.
     */
    saisirChiffre(chiffre) {
        // Au PIANO, un chiffre ne désigne ni corde ni case (voir model/instruments.js#hauteurDeCase) —
        // le poser créerait une note SANS hauteur réelle. Le geste piano est saisirHauteur, posé par
        // un clic direct sur la portée (voir main.js#cibleDepuisClicPiano) : un message vaut mieux
        // qu'un silence qui laisserait deviner pourquoi rien ne s'écrit.
        if (this.partition.piste.instrument === 'piano') {
            this.derniereErreur = 'Au piano, clique directement sur la portée pour poser une note.';
            return null;
        }
        const c = this.curseur;
        const casesMax = INSTRUMENTS[this.partition.piste.instrument]?.casesMax ?? 24;
        const precedent = this._dernierChiffre;
        const maintenant = Date.now();

        let frette = chiffre;
        let fusion = 'saisie-' + c.mesure + '-' + c.evenement + '-' + c.corde;
        const enchaine = precedent
            && maintenant - precedent.temps < DELAI_DEUXIEME_CHIFFRE
            && precedent.mesure === c.mesure && precedent.evenement === c.evenement && precedent.corde === c.corde;
        if (enchaine) {
            const combine = precedent.valeur * 10 + chiffre;
            if (combine <= casesMax) frette = combine;
        }

        this.memoriser(fusion);
        const evenement = this.evenementCourant();
        evenement.silence = false;
        const existante = evenement.notes.find(n => n.corde === c.corde);
        // REDÉFINIR une case efface la marque « hors du manche » posée par une transposition (voir
        // transposerMorceau) : c'est précisément le geste par lequel on répare une de ces notes, et
        // elle doit cesser d'être signalée dès qu'on lui a donné une case jouable.
        // ET LE CARACTÈRE FANTÔME AVEC, pour une raison plus directe encore : la tablature grave « x »
        // À LA PLACE du chiffre (voir engine/layout.js), si bien qu'une case tapée sur une note
        // fantôme s'écrivait dans le modèle sans RIEN changer à l'écran — le chiffre était là, et
        // invisible. Donner une case, c'est donner une hauteur déterminée : l'exact contraire d'un
        // fantôme (voir model/score.js, EFFETS.ghost, « hauteur indéterminée »).
        if (existante) { existante.frette = frette; delete existante.horsManche; delete existante.hauteurVoulue; delete existante.ghost; }
        else evenement.notes.push(creerNote(c.corde, frette));
        // RYTHME IMPOSÉ : LA DURÉE COLLANTE NE S'APPLIQUE PAS (voir model/score.js,
        // `Évènement#aRemplir`, et ui/rythme.js). L'aide rythmique a posé ce rythme exprès ; le
        // remplir doit lui donner des hauteurs, pas le réécrire.
        //
        // SANS CETTE LIGNE, L'AIDE NE SERVIRAIT À RIEN, et c'est mesuré : un « croche pointée +
        // double + triolet de croches + noire » inséré puis rempli case par case ressortait en SIX
        // CROCHES PLATES, la mesure à un temps de moins. On croyait remplir, on écrasait.
        //
        // LE MARQUEUR TOMBE ICI, au premier chiffre : il décrivait une attente, elle est satisfaite.
        // C'est aussi ce qui éteint la surbrillance de cette case (voir main.js#marquesARemplir) —
        // une seule vérité pour les deux, donc jamais l'une sans l'autre.
        const rythmeImpose = !!evenement.aRemplir;
        if (rythmeImpose) evenement.aRemplir = false;
        // UNE NOTE LIÉE SE REMPLIT D'UN SEUL CHIFFRE, et c'est la contrepartie du droit qu'a
        // l'aide rythmique de faire franchir la barre à une note (voir model/rythme.js). Une note
        // tenue par-dessus une barre s'écrit en DEUX figures liées, donc en deux évènements — mais
        // c'est UNE note, et la réclamer deux fois à l'utilisateur serait à la fois pénible et
        // faux : deux chiffres tapés séparément donnent deux notes réattaquées, pas une tenue.
        // On propage donc la case à toute la chaîne, en posant la liaison au passage.
        if (rythmeImpose && evenement.lienSuivant) this._prolongerLiaison(evenement, c.corde, frette);
        // La durée collante s'applique à un évènement encore VIERGE seulement : retaper une case sur
        // un accord déjà écrit ne doit pas en changer le rythme.
        if (evenement.notes.length === 1 && !enchaine && !rythmeImpose) {
            // REDIMENSIONNE à la durée courante plutôt que d'écraser le champ tel quel : un silence
            // vierge n'a AUCUNE raison de faire déjà la bonne taille (une mesure neuve, par exemple,
            // n'est qu'UN silence couvrant toute la mesure — bien plus grand qu'une croche). Écraser
            // directement `duree` cassait alors l'invariant « une voix somme toujours exactement sa
            // mesure » dès la toute première case tapée, sans qu'aucun `memoriser`/`_essaierNouvelleDuree`
            // n'ait eu la main pour redistribuer la différence : la mesure se retrouvait sous sa
            // capacité sans que rien ne le signale, jusqu'à ce qu'un ALLONGEMENT plus tard tombe sur
            // un silence de fin trop court pour absorber quoi que ce soit — exactement le symptôme du
            // retour utilisateur (« l'application m'empêche de modifier la durée d'un silence »).
            // `_essaierNouvelleDuree` sait rendre ce redimensionnement sûr dans les deux sens, et il
            // ne peut plus échouer (voir son docblock : il décale plutôt que de refuser).
            //
            // C'EST CE QUI A RENDU LA PALETTE HONNÊTE, et le défaut qu'elle avait était le pire de
            // tous parce qu'il ne disait rien. Palette sur « blanche », une case tapée sur un silence
            // de croche dans une mesure pleine : l'agrandissement échouait, l'échec était avalé par
            // la ligne suivante, et il s'écrivait une CROCHE. Mesuré : 1,5 temps d'écart entre ce que
            // montrait le bouton actif et ce qui apparaissait sur la partition, sans le moindre
            // message. On croyait avoir écrit une blanche. Désormais la blanche s'écrit vraiment, et
            // si la mesure n'avait pas la place, elle le DIT (voir main.js#surChangementEditeur).
            this._essaierNouvelleDuree({ ...this.dureeCourante }, { dejaMemorise: true });
            this.derniereErreur = null;
        }
        this._dernierChiffre = { temps: maintenant, mesure: c.mesure, evenement: c.evenement, corde: c.corde, valeur: frette };
        this.prevenir('saisie');
        return frette;
    }

    /**
     * Pose ou retire une hauteur MIDI à l'évènement courant — le geste PIANO (voir
     * main.js#cibleDepuisClicPiano), où il n'y a ni corde ni case : cliquer directement sur la
     * portée pose la hauteur voulue, ou la RETIRE si elle y est déjà (bascule, comme rejouer la
     * même touche pour l'éteindre). Toutes les notes d'un accord piano portent `corde: 0` (voir
     * model/instruments.js#hauteurDeCase) : la hauteur elle-même, portée par `frette`, identifie
     * donc la note plutôt que la corde — à la différence de saisirChiffre (une case PAR corde), un
     * accord se construit ici en cliquant plusieurs hauteurs DIFFÉRENTES au même instant.
     */
    saisirHauteur(midi) {
        // Fusion PAR HAUTEUR (comme saisirChiffre fusionne par CORDE) : un accord de trois notes
        // cliquées coup sur coup pousse trois points d'annulation distincts, un par hauteur — Ctrl+Z
        // retire alors la DERNIÈRE note posée, pas l'accord entier d'un coup.
        this.memoriser('saisieHauteur-' + this.curseur.mesure + '-' + this.curseur.evenement + '-' + midi);
        const evenement = this.evenementCourant();
        const existante = evenement.notes.find(n => n.frette === midi);
        if (existante) {
            evenement.notes = evenement.notes.filter(n => n !== existante);
            if (!evenement.notes.length) evenement.silence = true;
        } else {
            evenement.silence = false;
            evenement.notes.push(creerNote(0, midi));
            // La durée collante ne s'applique qu'à un évènement encore VIERGE (voir saisirChiffre) :
            // ajouter une seconde hauteur à un accord déjà écrit ne doit pas en changer le rythme.
            // REDIMENSIONNE en sûreté plutôt que d'écraser `duree` — même raison qu'à saisirChiffre :
            // un silence vierge n'a aucune raison de déjà faire la bonne taille (une mesure neuve
            // n'est qu'UN SEUL silence couvrant toute la mesure), et écraser directement cassait
            // l'invariant de capacité dès la première hauteur cliquée, sans jamais redistribuer la
            // différence.
            if (evenement.notes.length === 1) {
                this._essaierNouvelleDuree({ ...this.dureeCourante }, { dejaMemorise: true });
                this.derniereErreur = null;
            }
        }
        this._dernierChiffre = null;
        this.prevenir('saisie');
        return midi;
    }

    /** Efface la note sous le curseur ; l'évènement redevient un silence s'il ne reste rien. */
    effacerNote() {
        const evenement = this.evenementCourant();
        const avant = evenement.notes.length;
        if (!avant) return false;
        this.memoriser();
        evenement.notes = evenement.notes.filter(n => n.corde !== this.curseur.corde);
        if (!evenement.notes.length) evenement.silence = true;
        // LE TEMPS LIBÉRÉ REJOINT LES SILENCES VOISINS, à chaque effacement (voir
        // _fusionnerSilences). La condition qui vivait ici — ne reconsolider que si PLUS AUCUN
        // évènement de la voix ne portait de note — était le défaut lui-même : une seule note
        // restée quelque part dans la mesure figeait tout le chapelet de petites figures hérité du
        // rythme effacé (retour utilisateur : « il reste des demi-soupirs ou quarts de soupirs qui
        // m'empêchent d'écrire dans la mesure »).
        this._fusionnerSilences();
        // La voix ENTIÈREMENT vide revient en plus à sa décomposition de naissance, curseur au
        // début : _fusionnerSilences y donnerait déjà une figure unique, mais pas forcément la même
        // (une mesure de 3/8 naît en un silence de trois croches, que la règle d'alignement
        // écrirait autrement), et le curseur n'a aucune raison de rester au milieu d'une mesure
        // qu'on vient de vider.
        const voix = this.voixCourante();
        if (voix.evenements.every(e => e.silence || !e.notes.length)) {
            voix.evenements = creerVoix(capaciteMesure(this.partition, this.curseur.mesure)).evenements;
            this.curseur.evenement = 0;
        }
        this._dernierChiffre = null;
        this.prevenir('edition');
        return evenement.notes.length !== avant;
    }

    /** Retour arrière : efface la note, ou recule si la case était déjà vide. */
    effacerOuReculer() {
        if (this.evenementCourant().notes.some(n => n.corde === this.curseur.corde)) return this.effacerNote();
        this.deplacerEvenement(-1);
        return this.effacerNote();
    }

    /**
     * Efface un ENSEMBLE de notes en une seule action d'annulation — le geste de la sélection
     * multiple au lasso (glisser un rectangle sur la partition, voir main.js). `refs` : une liste de
     * { mesure, voix, evenement, corde }.
     *
     * REGROUPE PAR VOIX avant de reconsolider : une voix touchée par PLUSIEURS des notes effacées ne
     * doit être remise à la décomposition standard qu'UNE fois, une fois qu'on sait qu'elle est
     * entièrement vide — la reconsolider note par note, comme le ferait un appel répété à
     * `effacerNote()`, écraserait le travail du passage précédent à chaque itération.
     */
    effacerNotes(refs) {
        if (!refs || !refs.length) return false;
        this.memoriser();
        const voixTouchees = new Map();   // "mesure:voix" → la voix elle-même
        for (const r of refs) {
            const mesure = this.partition.mesures[r.mesure];
            const voix = mesure?.voix[r.voix];
            const evenement = voix?.evenements[r.evenement];
            if (!evenement) continue;
            evenement.notes = evenement.notes.filter(n => n.corde !== r.corde);
            if (!evenement.notes.length) evenement.silence = true;
            voixTouchees.set(`${r.mesure}:${r.voix}`, { voix, mesure: r.mesure });
        }
        for (const { voix, mesure } of voixTouchees.values()) {
            // Le temps libéré rejoint les silences voisins, voix par voix (voir _fusionnerSilencesDe)
            // — sans quoi un lasso passé sur un passage entier le laissait criblé de petites figures,
            // le même défaut que sur un effacement note à note.
            this._fusionnerSilencesDe(voix);
            if (voix.evenements.every(e => e.silence || !e.notes.length)) {
                voix.evenements = creerVoix(capaciteMesure(this.partition, mesure)).evenements;
            }
        }
        this._dernierChiffre = null;
        this.corrigerCurseur();
        this.prevenir('edition');
        return true;
    }

    /**
     * LES SILENCES POUR `duree` NOIRES À PARTIR DE `debut` dans une voix de cette mesure — écrits sur
     * la grille que la mesure impose RÉELLEMENT (voir model/rythme.js#silencesAlignes).
     *
     * REMPLACE `decouperEnEvenements` PARTOUT OÙ LA POSITION EST CONNUE, c'est-à-dire partout ici :
     * l'éditeur sait toujours où il rend du temps, et c'est justement ce qu'il ne disait pas.
     *
     * CE QUE ÇA CORRIGE, et c'était mesurable sur le geste le plus banal du répertoire. Trois croches
     * en triolet dans un 4/4 laissaient la mesure à 3,875 noires : le temps restant passait par
     * `figuresPour`, qui ne cherche que des figures binaires, et aucune suite d'entre elles ne somme
     * un tiers de temps. Le reliquat — un vingt-quatrième de temps — était abandonné EN SILENCE à
     * chaque fois. Douze croches en triolet, un temps de swing ordinaire, faisaient déborder la mesure
     * de presque un temps entier, avec au passage une note sur douze qui perdait son triolet.
     *
     * LE REPLI sur l'ancien découpage ne sert que si la conversion ne tombe pas juste au millionième
     * (`silencesAlignes` rend alors `null` plutôt qu'un à-peu-près). On ne remplace donc jamais un
     * défaut connu par un défaut neuf : au pire on garde l'ancien, et le banc `rythme_juste` vérifie
     * que ce repli ne sert dans AUCUN des cas qui motivent cette méthode.
     */
    _silences(voix, debut, duree, iMesure = this.curseur.mesure) {
        if (!(duree > 1e-9)) return [];
        const sig = signatureEffective(this.partition, iMesure);
        return silencesAlignes(sig, voix?.evenements || [], debut, duree) || decouperEnEvenements(duree);
    }

    // -- Rythme -----------------------------------------------------------------------------------

    /**
     * Donne une NOUVELLE description de durée à l'évènement courant — le geste commun à
     * appliquerDuree, basculerPoint et basculerTriolet, les trois façons de changer combien de temps
     * un évènement occupe.
     *
     * CE GESTE NE SE REFUSE PLUS JAMAIS, et c'est le changement de fond de cette version.
     *
     * CE QU'IL FAISAIT AVANT, et ce que ça coûtait. Un allongement devait trouver sa place dans les
     * silences suivant IMMÉDIATEMENT l'évènement ; faute de quoi tout le changement était refusé.
     * Mesuré sur une mesure de 4/4 portant huit croches — la chose la plus banale qu'on puisse
     * écrire — 32 changements de durée sur 40 étaient refusés, soit 80 %. Sur une mesure À MOITIÉ
     * VIDE (quatre croches puis deux noires de silence), encore 65 % : le silence était là, mais pas
     * CONTIGU, et le balayage s'arrêtait à la première note rencontrée. Effacer d'abord la note
     * fautive ne débloquait rien non plus. La seule issue restait de supprimer la mesure entière et
     * de la refaire — retour utilisateur mot pour mot.
     *
     * Et le refus ne protégeait même pas ce qu'il prétendait protéger : écrire un simple triolet
     * laissait la mesure fausse sans qu'aucun refus ne se déclenche (voir `_silences`).
     *
     * CE QU'IL FAIT MAINTENANT — DEUX SOURCES DE PLACE, DANS CET ORDRE.
     *   1. LES SILENCES QUI SUIVENT sont mangés. C'est gratuit : un silence n'est pas de la musique,
     *      c'est du temps vide, et personne ne le pleure.
     *   2. LE RESTE DÉCALE. Ce qui suit garde son contenu et glisse vers la droite ; la mesure
     *      devient plus longue que sa capacité et porte une DETTE, visible (voir engine/layout.js,
     *      qui grave « +½ ♩ » sur la mesure) et payable en un geste.
     *
     * POURQUOI DÉCALER PLUTÔT QU'ABSORBER. Les deux modèles existent chez les logiciels établis, et
     * ils répondent à deux intentions différentes. MuseScore ABSORBE par défaut — la note qui
     * s'allonge mange celles qui suivent — et c'est la plainte qui revient le plus sur ses forums,
     * parce qu'on perd du travail sans l'avoir demandé. Guitar Pro DÉCALE et laisse la mesure
     * devenir fausse, en la signalant ; c'est justement ce que sa documentation présente comme un
     * avantage. Entre les deux, le choix est simple : DÉCALER NE PERD RIEN, absorber détruit. Le
     * geste par défaut est donc celui qui se rattrape, et l'absorption reste offerte — explicitement,
     * à qui la veut (voir `absorberDette`, Alt+A).
     *
     * CE N'EST PAS LA CASCADE QUI AVAIT ÉTÉ ANNULÉE (retour direct : « repasse au modèle plus simple,
     * colle à ce qui est réalisé sur les logiciels pros »). Cette cascade CRÉAIT une mesure toute
     * seule et restructurait le morceau. Ici, rien ne bouge hors de la mesure : la dette y reste,
     * visible, jusqu'à ce qu'on choisisse de l'absorber (Alt+A) ou de la déverser (Alt+R). Aucun
     * logiciel de gravure ne restructure le morceau sans qu'on le lui demande, et celui-ci non plus.
     *
     * `derniereDette` porte de quoi proposer le règlement au bon endroit (voir main.js) : la mesure,
     * la voix, l'évènement qui a grandi, et de combien la mesure déborde.
     *
     * Si l'évènement RACCOURCIT, le temps libéré redevient un silence juste après : dans ce sens-là
     * il n'y a jamais de dette, donc rien à signaler.
     *
     * N'appelle PAS prevenir() : à l'appelant de le faire, une fois qu'il a fini de poser ses propres
     * champs (dureeCourante, par exemple), pour ne prévenir qu'une seule fois par geste.
     *
     * `dejaMemorise` : sert à saisirChiffre/saisirHauteur, qui ont déjà ouvert leur propre point
     * d'annulation avant d'appeler ceci — sans ce drapeau, l'appel imbriqué en ouvrirait un SECOND,
     * et défaire « une case tapée » aurait demandé deux Ctrl+Z au lieu d'un.
     *
     * @returns {boolean} toujours vrai — conservé parce que trois appelants le lisent, et qu'une
     *   signature qui ne peut plus échouer se remarque mieux ainsi qu'en la changeant partout.
     */
    /**
     * FUSIONNE LES SUITES DE SILENCES DE LA VOIX COURANTE — et c'est ce qui manquait.
     *
     * LE DÉFAUT, tel que l'utilisateur l'a vécu : « lorsque je définis une note et que je la
     * supprime, il reste des demi-soupirs ou quarts de soupirs qui m'empêchent d'écrire dans la
     * mesure (message d'erreur : manque de place dans la mesure). Je dois pouvoir supprimer ces
     * silences, ou ils doivent s'adapter automatiquement. » Capture à l'appui : une mesure criblée de
     * demi-soupirs autour d'une seule note.
     *
     * LA CAUSE. `effacerNote` reconsolidait bien la voix — mais SEULEMENT quand elle était devenue
     * entièrement vide (`voix.evenements.every(estSilence)`). Une seule note restée quelque part
     * dans la mesure suffisait donc à figer tout le chapelet de petites figures hérité du rythme
     * qu'on venait d'effacer. Et ce chapelet n'est pas qu'inélégant : écrire une blanche depuis un
     * silence du milieu exige que les silences SUIVANTS totalisent la place — ce qu'ils font — mais
     * les silences qui PRÉCÈDENT, eux, restaient hors de portée, et l'espace libre se retrouvait
     * coupé en deux par le curseur.
     *
     * LE MODÈLE DES ÉDITEURS. Dans MuseScore comme dans Guitar Pro, un silence n'est jamais une
     * FIGURE qu'on aurait posée : c'est du temps vide, réécrit automatiquement avec le moins de
     * figures possible à chaque changement. Effacer une note y rend son temps au silence voisin ;
     * deux silences contigus n'existent pas s'ils peuvent n'en faire qu'un. C'est exactement ce que
     * fait cette méthode, appliquée après CHAQUE geste qui peut laisser du temps vide.
     *
     * LES FIGURES SONT CHOISIES SELON LA POSITION, pas seulement selon la durée (voir
     * model/score.js#figuresSilencePour) : trois temps à partir du deuxième temps d'un 4/4 donnent
     * une noire puis une blanche, jamais une blanche pointée qui enjamberait la moitié de la mesure.
     *
     * LE CURSEUR SE RÉANCRE PAR LE TEMPS, pas par l'indice. Fusionner change le nombre
     * d'évènements : garder `curseur.evenement` tel quel ferait sauter le curseur ailleurs dans la
     * mesure, parfois hors bornes. On note donc l'instant qu'il désignait AVANT, et on retrouve
     * APRÈS l'évènement qui contient cet instant — ce qui, du point de vue de qui écrit, ne bouge
     * pas : le curseur reste là où il était dans le temps.
     *
     * @returns {boolean} vrai si la voix a changé.
     */
    _fusionnerSilences() {
        const voix = this.voixCourante();
        if (!voix) return false;

        // L'instant visé par le curseur, avant toute modification.
        let instantCurseur = 0;
        for (let i = 0; i < this.curseur.evenement && i < voix.evenements.length; i++) {
            instantCurseur += dureeEnNoires(voix.evenements[i].duree);
        }

        if (!this._fusionnerSilencesDe(voix)) return false;

        // Réancrage : le premier évènement qui commence à l'instant visé, ou celui qui le contient.
        let t = 0, cible = 0;
        for (let k = 0; k < voix.evenements.length; k++) {
            const fin = t + dureeEnNoires(voix.evenements[k].duree);
            if (instantCurseur < fin - 1e-9) { cible = k; break; }
            t = fin;
            cible = k;
        }
        this.curseur.evenement = Math.min(cible, voix.evenements.length - 1);
        return true;
    }

    /**
     * La réécriture elle-même, sur N'IMPORTE QUELLE voix — sans toucher au curseur.
     *
     * Séparée de `_fusionnerSilences` pour `effacerNotes`, qui efface d'un coup des notes réparties
     * sur PLUSIEURS mesures (le lasso) : le curseur n'y désigne qu'une de ces voix, et réancrer
     * n'aurait de sens que pour celle-là. Chaque voix touchée passe donc par ici, et le curseur est
     * remis en bornes une seule fois, à la fin, par `corrigerCurseur`.
     */
    _fusionnerSilencesDe(voix) {
        if (!voix) return false;
        const estSilence = (e) => e.silence || !e.notes.length;
        const sortie = [];
        let i = 0, pos = 0, change = false;
        while (i < voix.evenements.length) {
            if (!estSilence(voix.evenements[i])) {
                sortie.push(voix.evenements[i]);
                pos += dureeEnNoires(voix.evenements[i].duree);
                i++;
                continue;
            }
            let j = i, total = 0;
            while (j < voix.evenements.length && estSilence(voix.evenements[j])) {
                total += dureeEnNoires(voix.evenements[j].duree);
                j++;
            }
            const figures = figuresSilencePour(total, pos);
            // Un passage inalignable (une durée qu'aucune suite de figures ne couvre exactement, ce
            // que `definirSignature` peut laisser derrière lui) : on garde l'existant plutôt que de
            // perdre du temps de mesure. Mieux vaut un chapelet qu'une mesure qui ne totalise plus.
            const couvre = figures.reduce((t, f) => t + dureeEnNoires(f), 0);
            if (figures.length && Math.abs(couvre - total) < 1e-9) {
                // ON COMPARE LES SUITES DE FIGURES, pas seulement leur NOMBRE. Première rédaction :
                // `figures.length < j - i`, c'est-à-dire « n'écrire que si ça réduit ». Elle laissait
                // donc passer les figures MAL PLACÉES, qui sont pourtant la moitié du problème :
                // rétrécir une note rendait le temps libéré via decouperEnEvenements, aveugle à la
                // position, et un soupir pointé posé à deux temps et demi d'un 4/4 — qui enjambe le
                // quatrième temps — y restait tel quel faute de « réduire » quoi que ce soit. La
                // réécriture est parfois plus longue d'une figure ; elle est toujours juste.
                const memes = figures.length === j - i && figures.every((f, k) =>
                    f.valeur === voix.evenements[i + k].duree.valeur
                    && !!f.points === !!voix.evenements[i + k].duree.points
                    && !voix.evenements[i + k].duree.nolet);
                if (!memes) change = true;
                for (const f of figures) sortie.push(creerEvenement(f, [], { silence: true }));
            } else {
                for (let k = i; k < j; k++) sortie.push(voix.evenements[k]);
            }
            pos += total;
            i = j;
        }
        if (!change) return false;
        voix.evenements = sortie;
        return true;
    }

    _essaierNouvelleDuree(nouvelleDuree, { dejaMemorise = false } = {}) {
        this.derniereErreur = null;
        this.derniereDette = null;
        const voix = this.voixCourante();
        const iEvt = this.curseur.evenement;
        const evenement = voix.evenements[iEvt];
        const ancienne = dureeEnNoires(evenement.duree);
        const nouvelle = dureeEnNoires(nouvelleDuree);
        const delta = nouvelle - ancienne;
        const estSilence = (e) => e.silence || !e.notes.length;

        if (!dejaMemorise) this.memoriser();
        evenement.duree = nouvelleDuree;

        if (delta > 1e-9) {
            // TOUT LE SILENCE QUI SUIT EST PRIS, OÙ QU'IL SOIT DANS LA MESURE — le plus proche
            // d'abord, en traversant les notes sans y toucher.
            //
            // TRAVERSER LES NOTES EST LE POINT, et c'est ce qui a manqué le plus longtemps. Une
            // version antérieure s'arrêtait au premier évènement non silencieux : sur une mesure à
            // MOITIÉ VIDE — quatre croches puis deux noires de silence —, allonger la première note
            // était refusé, alors que la mesure avait deux temps de libre. Ils étaient simplement
            // hors de portée du balayage. Mesuré : 6 refus sur 20 dans ce seul cas de figure.
            //
            // Les prendre ne coûte RIEN : un silence est du temps vide, pas de la musique. Les notes
            // traversées ne sont ni mangées ni réordonnées, elles glissent simplement vers la droite
            // de ce que la note agrandie leur prend — et la mesure retombe pile sur sa capacité, sans
            // dette du tout, dès qu'il y avait assez de vide quelque part.
            let besoin = delta;
            const evts = voix.evenements;
            let i = iEvt + 1;
            while (besoin > 1e-9 && i < evts.length) {
                if (!estSilence(evts[i])) { i++; continue; }
                const d = dureeEnNoires(evts[i].duree);
                if (d <= besoin + 1e-9) { evts.splice(i, 1); besoin -= d; continue; }
                // Silence entamé à moitié : le reliquat garde sa place et se réécrit sur la grille.
                const pos = positionDe(voix, i);
                evts.splice(i, 1, ...this._silences(voix, pos, d - besoin));
                besoin = 0;
            }
            // Ce qui n'a pas pu être payé en silence est la DETTE : la mesure est plus longue que sa
            // capacité, elle le dit (voir engine/layout.js), et deux gestes la règlent.
            const dette = this.ecartMesure(this.curseur.mesure, this.curseur.voix);
            this.derniereDette = dette > 1e-9
                ? { mesure: this.curseur.mesure, voix: this.curseur.voix, evenement: iEvt, dette }
                : null;
        } else if (delta < -1e-9) {
            let libere = -delta, k = iEvt + 1;
            while (k < voix.evenements.length && estSilence(voix.evenements[k])) {
                libere += dureeEnNoires(voix.evenements[k].duree);
                k++;
            }
            voix.evenements.splice(iEvt + 1, k - (iEvt + 1),
                ...this._silences(voix, positionDe(voix, iEvt + 1), libere));
        }
        // PAS DE FUSION DES SILENCES ICI, et c'est un choix que j'ai dû corriger.
        //
        // Je l'y avais mise, pour que le temps rendu par un rétrécissement soit réécrit selon sa
        // position (voir model/score.js#figuresSilencePour) plutôt que par `decouperEnEvenements`,
        // aveugle à la place qu'il occupe. Cohérent sur le papier ; en pratique, elle CASSAIT le
        // geste central de la saisie rythmique. Choisir « blanche » sur un silence redimensionne ce
        // silence — c'est ainsi qu'on réserve la place avant de taper la case — et la fusion, juste
        // après, réécrivait aussitôt ce silence redimensionné en sa forme canonique : à l'écran,
        // cliquer « blanche » sur un silence ne faisait plus rien du tout.
        //
        // Un silence explicitement dimensionné doit tenir. La fusion ne s'applique donc qu'aux
        // gestes qui LIBÈRENT du temps sans en désigner la forme — effacer une note, en faire un
        // silence, passer le lasso — là où l'utilisateur n'a rien choisi et où le chapelet de
        // petites figures est un pur résidu. C'est aussi exactement le défaut qu'il a signalé.
        // Reste donc, tel quel, le silence pointé que decouperEnEvenements peut poser à contretemps
        // après un rétrécissement : une imperfection de gravure, sans effet sur ce qu'on peut écrire.
        return true;
    }

    /** Change la durée de l'évènement courant, et la retient pour les suivants. */
    appliquerDuree(valeur) {
        if (!VALEURS_FIGURES.includes(valeur)) return false;
        const nouvelleDuree = { ...this.evenementCourant().duree, valeur };
        if (!this._essaierNouvelleDuree(nouvelleDuree)) return false;
        this.dureeCourante = { ...this.dureeCourante, valeur };
        this.prevenir('edition');
        return true;
    }

    basculerPoint() {
        const points = this.evenementCourant().duree.points ? 0 : 1;
        const nouvelleDuree = { ...this.evenementCourant().duree, points };
        if (!this._essaierNouvelleDuree(nouvelleDuree)) return false;
        this.dureeCourante.points = points;
        this.prevenir('edition');
        return true;
    }

    /** Triolet : trois notes dans le temps de deux. Rebasculer revient à la division binaire. */
    basculerTriolet() {
        const nolet = this.evenementCourant().duree.nolet ? null : { dans: 3, valent: 2 };
        const nouvelleDuree = { ...this.evenementCourant().duree, nolet };
        if (!this._essaierNouvelleDuree(nouvelleDuree)) return false;
        this.dureeCourante.nolet = nolet ? { ...nolet } : null;
        this.prevenir('edition');
        return true;
    }

    /** Transforme l'évènement courant en silence (ou le repeuple s'il l'était déjà). */
    basculerSilence() {
        this.memoriser();
        const e = this.evenementCourant();
        if (e.silence || !e.notes.length) { e.silence = false; }
        else {
            e.notes = []; e.silence = true;
            // Devenu silence, cet évènement rejoint ses voisins silencieux (voir _fusionnerSilences) :
            // transformer une noire en soupir au milieu de trois autres soupirs doit donner une
            // blanche de silence, pas quatre soupirs de suite.
            this._fusionnerSilences();
        }
        this.prevenir('edition');
    }

    // -- Structure ---------------------------------------------------------------------------------

    /**
     * REPREND `montant` noires DE SILENCE dans `voix`, à partir de l'index `depuis` — en commençant
     * par le silence le PLUS PROCHE. Renvoie `true` si tout a pu être repris (la voix est alors
     * modifiée), `false` si le silence disponible n'y suffisait pas (RIEN n'est modifié : la
     * vérification se fait entièrement AVANT la moindre écriture, comme dans _essaierNouvelleDuree,
     * pour pouvoir refuser proprement plutôt que d'avoir à défaire un travail à moitié fait).
     *
     * POURQUOI CETTE OPÉRATION EXISTE. Une voix totalise TOUJOURS exactement sa mesure (voir
     * l'invariant rappelé dans insererEvenement) : notes et silences remplissent la capacité, sans
     * jamais un trou. « Faire de la place » n'a donc qu'un seul sens possible ici — reprendre du
     * SILENCE quelque part après le point visé. C'est déjà, mot pour mot, ce que fait l'allongement
     * d'une note (voir _essaierNouvelleDuree, qui mange les silences suivants) ; l'insertion s'était
     * seulement retrouvée sans l'équivalent.
     *
     * LE PLUS PROCHE D'ABORD, et les notes rencontrées en chemin ne sont jamais consommées, seulement
     * DÉCALÉES par l'insertion qui suivra : c'est ce qui dérange le moins la musique déjà écrite —
     * tout ce qui se trouve APRÈS le silence repris ne bouge pas d'un pouce. Rien ne déborde jamais
     * sur la mesure voisine : le décalage s'arrête à la barre de mesure, la capacité étant préservée
     * exactement (on rend ce qu'on a pris en trop, découpé en figures propres).
     */
    _reprendreSilenceApres(voix, depuis, montant) {
        const EPS = 1e-9;
        const estSilence = (e) => e.silence || !e.notes.length;
        if (montant <= EPS) return true;

        // 1. Vérifier SANS RIEN MODIFIER que le compte y est.
        let dispo = 0;
        for (let i = depuis; i < voix.evenements.length && dispo < montant - EPS; i++) {
            if (estSilence(voix.evenements[i])) dispo += dureeEnNoires(voix.evenements[i].duree);
        }
        if (dispo < montant - EPS) return false;

        // 2. Reprendre, du plus proche au plus lointain. Un silence entamé à moitié est remplacé par
        //    le reliquat, redécoupé en figures standard (jamais une durée « bâtarde » impossible à
        //    graver — voir decouperEnEvenements).
        let reste = montant;
        for (let i = depuis; i < voix.evenements.length && reste > EPS; i++) {
            const e = voix.evenements[i];
            if (!estSilence(e)) continue;
            const d = dureeEnNoires(e.duree);
            if (d <= reste + EPS) {
                voix.evenements.splice(i, 1);
                reste -= d;
                i--;
            } else {
                voix.evenements.splice(i, 1,
                    ...this._silences(voix, positionDe(voix, i) + reste, d - reste));
                reste = 0;
            }
        }
        return true;
    }

    /**
     * Insère un évènement APRÈS le courant et s'y place — le geste normal pour écrire à la suite.
     *
     * NE DÉBORDE JAMAIS LA MESURE — REVENU à ce refus après un détour par la répartition automatique
     * (retour direct : « repasse au modèle plus simple, colle à ce qui est réalisé sur les logiciels
     * pros » — aucun d'eux n'insère une mesure neuve tout seul dans le dos de qui écrit).
     *
     * LA PLACE SE PREND DANS LE SILENCE QUI SUIT (retour utilisateur : « j'ai du mal à l'utiliser,
     * j'ai très souvent le message espace insuffisant dans la mesure. Regarder comment font les
     * applications professionnelles similaires et faire pareil »). Le test d'avant — « ce qui est
     * déjà écrit plus la nouvelle figure dépasse-t-il la capacité ? » — ne pouvait JAMAIS être faux :
     * `dureeEcrite` additionne TOUS les évènements, silences compris, et une voix totalise toujours
     * EXACTEMENT sa mesure (l'invariant du modèle, voir plus bas). Autrement dit une mesure est
     * toujours « pleine », et insérer au milieu était refusé cent fois sur cent — le bouton ne
     * pouvait pas marcher, quelle que soit la partition.
     *
     * Le modèle des logiciels pros (Guitar Pro, MuseScore, TuxGuitar) est justement celui-ci : la
     * mesure est une grille de temps toujours pleine, écrire REMPLACE un silence (c'est déjà ce que
     * fait saisirChiffre ici), et insérer PREND SA PLACE dans le silence qui suit, en repoussant ce
     * qu'il y a entre les deux. C'est aussi, mot pour mot, ce que TabHub fait déjà pour l'allongement
     * d'une note (voir _essaierNouvelleDuree) : seule l'insertion n'avait pas son équivalent. Voir
     * _reprendreSilenceApres, qui porte cette reprise pour les deux insertions.
     *
     * TROIS CAS, dans cet ordre. (1) Il reste du silence après le point d'insertion : on le reprend,
     * la mesure garde sa capacité au temps près, rien ne déborde sur la voisine. (2) Plus aucun
     * silence à reprendre, et on est en BOUT DE VOIX (le geste normal pour continuer d'écrire) : une
     * mesure TOUTE NEUVE s'insère juste après la courante — jamais la mesure suivante existante, même
     * si elle a de la place : elle pourrait déjà contenir autre chose, et la remplir par surprise
     * déplacerait de la musique déjà écrite sans le dire. La nouvelle mesure reçoit la capacité
     * EFFECTIVE de cet endroit du morceau (jamais le 4 temps par défaut de `creerMesure`, qui suppose
     * du 4/4 et fausserait tout de suite une insertion en 3/4 ou 6/8), et prend le même nombre de
     * voix que la mesure courante — les voix qu'on ne remplit pas restent un silence unique couvrant
     * toute la mesure, l'état normal d'une voix qu'on n'a pas encore touchée. (3) Plus aucun silence
     * et on est au MILIEU de la voix : la suite est pleine de notes, il n'y a rien à reprendre sans
     * chasser de la musique hors de la mesure — on refuse proprement (le refus strict voulu, voir
     * plus haut), et `derniereErreur` porte le pourquoi ainsi qu'Alt+R (⇥ Corriger), qui décale
     * l'excédent quand ce décalage est VRAIMENT voulu.
     */
    insererEvenement() {
        this.derniereErreur = null;
        const voix = this.voixCourante();
        const capacite = capaciteMesure(this.partition, this.curseur.mesure);
        const dureeNouvel = dureeEnNoires(this.dureeCourante);
        if (dureeNouvel > capacite + 1e-9) {
            this.derniereErreur = 'Cette durée dépasse à elle seule la capacité d\'une mesure entière.';
            return false;
        }
        // DEUX SOURCES DE PLACE, dans cet ordre. (1) Le vide DÉJÀ disponible : une voix SOUS-remplie
        // (elle ne somme pas encore sa mesure — un état transitoire que corrigerDebordement répare,
        // voir _diagnostiquerDebordement) a du temps libre qui n'est matérialisé par aucun silence ;
        // il ne coûte rien de s'en servir. (2) Le silence qui SUIT, repris seulement pour ce qui
        // manque encore au-delà de ce vide.
        const libre = Math.max(0, capacite - dureeEcrite(this.mesureCourante(), this.curseur.voix));
        const aReprendre = dureeNouvel - libre;
        // Essai À BLANC sur une copie : `_reprendreSilenceApres` ne modifie rien quand il échoue,
        // mais il modifie bien la voix quand il réussit — or il faut avoir ouvert le point
        // d'annulation (memoriser) AVANT toute écriture. On mesure donc d'abord sur une copie, puis
        // on refait le vrai geste une fois memoriser() appelé.
        const copie = { evenements: voix.evenements.map(e => e) };
        const placeTrouvee = aReprendre <= 1e-9
            || this._reprendreSilenceApres(copie, this.curseur.evenement + 1, aReprendre);
        let mesureFraiche = false;
        if (placeTrouvee) {
            this.memoriser();
            if (aReprendre > 1e-9) this._reprendreSilenceApres(voix, this.curseur.evenement + 1, aReprendre);
        } else {
            const enBoutDeVoix = this.curseur.evenement === voix.evenements.length - 1;
            if (!enBoutDeVoix) {
                this.derniereErreur = 'Pas assez de place dans la mesure pour insérer cette figure ici. '
                    + 'Alt+R (⇥ Corriger) décale l\'excédent dans une nouvelle mesure.';
                return false;
            }
            this.memoriser();
            const nVoix = this.mesureCourante().voix.length;
            const iVoix = this.curseur.voix;
            const nouvelle = creerMesure({ voix: Array.from({ length: nVoix }, (_, i) =>
                ({ evenements: i === iVoix ? [] : decouperEnEvenements(capacite) })) });
            this.partition.mesures.splice(this.curseur.mesure + 1, 0, nouvelle);
            this.curseur.mesure += 1;
            this.curseur.evenement = -1;   // la nouvelle case s'insère juste APRÈS — voir plus bas
            mesureFraiche = true;
        }
        const voixCible = this.voixCourante();
        voixCible.evenements.splice(this.curseur.evenement + 1, 0, creerEvenement({ ...this.dureeCourante }, [], { silence: true }));
        this.curseur.evenement += 1;
        // Une voix fraîchement créée est vide avant cette ligne (voir plus haut) : compléter par un
        // silence jusqu'à la capacité, pour que l'invariant (une voix somme toujours EXACTEMENT sa
        // mesure) tienne dès la création plutôt que de dépendre d'une prochaine édition pour se vérifier.
        if (mesureFraiche) {
            const manque = capacite - dureeNouvel;
            if (manque > 1e-9) voixCible.evenements.push(
                ...this._silences(voixCible, dureeNouvel, manque, this.curseur.mesure));
        }
        this._dernierChiffre = null;
        this.prevenir('edition');
        return true;
    }

    /**
     * Insère un évènement JUSTE AVANT le courant — le miroir d'`insererEvenement`, pour le clic droit
     * « insérer une note à gauche ». Le curseur reste sur l'évènement VISÉ au départ (celui qui glisse
     * d'un cran vers la droite pour laisser la place), pas sur la case neuve : contrairement à Entrée,
     * ce geste n'est pas fait pour continuer à écrire à la suite.
     *
     * Mêmes garanties de capacité qu'`insererEvenement`, et MÊME reprise du silence qui suit (voir
     * _reprendreSilenceApres et la docblock du miroir : le test d'avant, hérité du même calcul, ne
     * pouvait jamais être faux non plus). La place se cherche à partir de l'évènement COURANT inclus
     * — celui devant lequel on insère : c'est lui, et tout ce qui le suit, qui glisse vers la droite.
     * Sans le repli « avancer d'une mesure » de son miroir — insérer AVANT la première case d'une
     * mesure déjà pleine demanderait de reculer d'une mesure entière, un geste bien plus surprenant
     * qu'un simple refus.
     */
    insererAvant() {
        this.derniereErreur = null;
        const capacite = capaciteMesure(this.partition, this.curseur.mesure);
        const dureeNouvel = dureeEnNoires(this.dureeCourante);
        if (dureeNouvel > capacite + 1e-9) {
            this.derniereErreur = 'Cette durée dépasse à elle seule la capacité d\'une mesure entière.';
            return false;
        }
        const voix = this.voixCourante();
        // Mêmes deux sources de place qu'au miroir (vide déjà disponible, puis silence qui suit).
        const libre = Math.max(0, capacite - dureeEcrite(this.mesureCourante(), this.curseur.voix));
        const aReprendre = dureeNouvel - libre;
        // Essai à blanc d'abord, pour la même raison qu'au miroir : memoriser() doit précéder toute
        // écriture, et on ne sait qu'après coup si la place existe.
        const copie = { evenements: voix.evenements.map(e => e) };
        if (aReprendre > 1e-9 && !this._reprendreSilenceApres(copie, this.curseur.evenement, aReprendre)) {
            this.derniereErreur = 'Pas assez de place dans la mesure pour insérer cette figure ici. '
                + 'Alt+R (⇥ Corriger) décale l\'excédent dans une nouvelle mesure.';
            return false;
        }
        this.memoriser();
        if (aReprendre > 1e-9) this._reprendreSilenceApres(voix, this.curseur.evenement, aReprendre);
        voix.evenements.splice(this.curseur.evenement, 0, creerEvenement({ ...this.dureeCourante }, [], { silence: true }));
        // Le curseur suit l'évènement VISÉ, qui vient de glisser d'un cran — SAUF quand cet évènement
        // était lui-même le silence que la reprise a consommé EN ENTIER, et que rien ne le suivait :
        // avancer laisserait alors le curseur APRÈS le dernier évènement de la voix, et la frappe
        // suivante planterait sèchement (saisirChiffre écrit dans `evenements[curseur.evenement]`,
        // donc dans `undefined`). On se borne au dernier index existant, qui est précisément la case
        // neuve — celle qui occupe très exactement la place du silence visé.
        this.curseur.evenement = Math.min(this.curseur.evenement + 1, voix.evenements.length - 1);
        this._dernierChiffre = null;
        this.prevenir('edition');
        return true;
    }

    /**
     * DIAGNOSTIC pur (aucune mutation) : ce qu'il faudrait GARDER dans la mesure `index`, voix par
     * voix, pour retomber exactement sur sa capacité, et ce qui DÉBORDERAIT (ou MANQUERAIT). Sert
     * exclusivement à `corrigerDebordement` (commande AUTONOME, Alt+R / « ⇥ Corriger ») — l'édition
     * EN DIRECT (`insererEvenement`, `insererAvant`, `_essaierNouvelleDuree`) refuse désormais tout
     * ce qui déborderait plutôt que de le confier à ce mécanisme (voir leurs commentaires respectifs) :
     * seule une mesure devenue invalide par un AUTRE chemin (fichier importé, par exemple) a encore
     * besoin d'être réparée après coup.
     *
     * Un SILENCE qui déborde est RACCOURCI pour ne garder que ce qui tient encore dans la mesure —
     * seul le vrai surplus part vers une mesure neuve ; une NOTE, elle, ne se découpe jamais, elle
     * bascule TOUJOURS entière (voir `_appliquerRepartition`). Sans ce découpage, un silence qui ne
     * tenait plus tout entier basculait EN BLOC, et la mesure d'origine retombait sous sa capacité —
     * exactement l'invariant que ce mécanisme existe pour garantir (trouvé en vérifiant l'étirement
     * de durée à la souris sur une mesure notes + silence de fin).
     */
    _diagnostiquerDebordement(index) {
        const m = this.partition.mesures[index];
        const capacite = capaciteMesure(this.partition, index);
        const parVoix = m.voix.map(voix => {
            let total = 0;
            const gardes = [];
            const enTrop = [];
            for (const e of voix.evenements) {
                const d = dureeEnNoires(e.duree);
                if (total + d <= capacite + 1e-9) { gardes.push(e); total += d; continue; }
                // Ça déborde ICI. S'il reste de la place et que c'est un SILENCE, on le RACCOURCIT
                // pour qu'il occupe exactement ce qui reste (des morceaux de figures standard, voir
                // `decouperEnEvenements`) ; seul le surplus réel part dans `enTrop`. Une note, elle,
                // ne se prête pas à ça : elle part TOUJOURS entière, comme avant ce correctif.
                const disponible = capacite - total;
                const estSilence = e.silence || !e.notes.length;
                if (estSilence && disponible > 1e-9) {
                    gardes.push(...this._silences({ evenements: gardes }, total, disponible, index));
                    // Le surplus ouvrira une mesure NEUVE : il y commencera à la position 0.
                    enTrop.push(...this._silences({ evenements: [] }, 0, d - disponible, index));
                } else {
                    enTrop.push(e);
                }
                total = capacite;   // la mesure est désormais pleine : plus rien après n'y tient
            }
            // `total` s'arrête à `capacite` dès qu'une voix déborde (voir plus haut) : `manque` ne
            // peut donc jamais être positif EN MÊME TEMPS que `enTrop` pour une même voix — un
            // silence de fin trop COURT (voix qui ne remplit pas sa mesure, jamais produit par une
            // édition en direct, mais possible dans un fichier ouvert d'avant ce garde-fou, ou d'avant
            // le correctif du découpage des silences ci-dessus) est un défaut SÉPARÉ, à l'opposé du
            // débordement, que `corrigerDebordement` doit pouvoir réparer lui aussi.
            const manque = Math.max(0, capacite - total);
            return { gardes, enTrop, manque, totalEnTrop: enTrop.reduce((t, e) => t + dureeEnNoires(e.duree), 0) };
        });
        return {
            index, m, capacite, parVoix,
            deborde: parVoix.some(v => v.enTrop.length),
            sousRempli: parVoix.some(v => v.manque > 1e-9),
            impossible: parVoix.some(v => v.enTrop.some(e => dureeEnNoires(e.duree) > capacite + 1e-9)),
        };
    }

    /**
     * Applique un diagnostic qui déborde (voir `_diagnostiquerDebordement`) : déplace l'excédent de
     * chaque voix, TEL QUEL et DANS L'ORDRE, vers une ou plusieurs mesures NEUVES insérées juste
     * après — jamais dans une mesure suivante déjà écrite, qu'il ne faut pas déranger. Le nombre de
     * mesures neuves est le MAXIMUM requis entre les voix ; une voix qui déborde moins que les autres
     * complète le reliquat par du silence, pour retomber elle aussi exactement sur la capacité dans
     * ces mesures neuves. PURE mutation — ni memoriser, ni prevenir, ni curseur : l'appelant en décide.
     */
    _appliquerRepartition({ index, m, capacite, parVoix }) {
        // Une voix SOUS-remplie (voir `_diagnostiquerDebordement`) se complète sur PLACE, par un
        // silence de fin — jamais besoin d'une mesure neuve pour ça, il lui restait justement de la
        // place. Sans ce comblement, une voix qui n'avait rien en trop (`enTrop` vide) ne recevait
        // jamais son silence manquant : le diagnostic le voyait, mais rien ne l'appliquait.
        m.voix.forEach((voix, i) => {
            const gardes = parVoix[i].gardes.slice();
            if (parVoix[i].manque > 1e-9) {
                gardes.push(...this._silences({ evenements: gardes }, capacite - parVoix[i].manque,
                                              parVoix[i].manque, index));
            }
            voix.evenements = gardes;
        });

        // Aucune mesure neuve si rien ne déborde VRAIMENT (un simple comblement de manque, par
        // exemple) : `Math.max(1, ...)` sans cette garde en créait une, vide, à chaque fois.
        const totalEnTrop = parVoix.reduce((t, v) => t + v.totalEnTrop, 0);
        if (totalEnTrop <= 1e-9) return;

        const nMesuresSupp = Math.max(1, ...parVoix.map(v => Math.ceil((v.totalEnTrop - 1e-9) / capacite)));
        const nouvelles = Array.from({ length: nMesuresSupp }, () => creerMesure({
            voix: m.voix.map(() => ({ evenements: [] })),
        }));
        parVoix.forEach((info, iVoix) => {
            const reste = info.enTrop.slice();
            nouvelles.forEach(nm => {
                let total = 0;
                const evs = nm.voix[iVoix].evenements;
                while (reste.length && total + dureeEnNoires(reste[0].duree) <= capacite + 1e-9) {
                    const e = reste.shift();
                    evs.push(e);
                    total += dureeEnNoires(e.duree);
                }
                const manque = capacite - total;
                if (manque > 1e-9) evs.push(...this._silences({ evenements: evs }, total, manque, index));
            });
        });
        this.partition.mesures.splice(index + 1, 0, ...nouvelles);
    }

    /**
     * RÉPARE une mesure DÉJÀ invalide (une voix ne totalise pas exactement sa capacité, trop OU pas
     * assez) — commande AUTONOME (Alt+R), pour une mesure devenue invalide par un autre chemin qu'une
     * édition en direct (un fichier ouvert d'avant ce garde-fou, ou d'avant le correctif du découpage
     * des silences en débordement, par exemple) : rien ne la corrige toute seule, une mesure invalide
     * ne dit jamais d'elle-même où l'excédent devrait aller, ni de combien la compléter. Voir
     * `_diagnostiquerDebordement`/`_appliquerRepartition` pour le mécanisme, partagé avec l'édition
     * en direct.
     */
    /**
     * ABSORBE LE DÉBORDEMENT D'UNE VOIX : ce qui suit l'évènement `depuis` cède la place, jusqu'à ce
     * que la voix retombe exactement sur la capacité de sa mesure.
     *
     * C'EST L'UNE DES DEUX FAÇONS DE PAYER UNE DETTE, et la destructrice des deux — d'où le fait
     * qu'elle ne se déclenche JAMAIS toute seule. L'allongement d'une note décale par défaut, sans
     * rien perdre (voir `_essaierNouvelleDuree`) ; cette commande-ci est le geste de qui dit « non,
     * cette note prend la place de la suivante ». C'est le comportement PAR DÉFAUT de MuseScore, et
     * la plainte la plus constante de ses utilisateurs : on y perd du travail sans l'avoir demandé.
     * Ici on le demande — Alt+A, ou le bouton qui n'apparaît QUE sur une mesure qui déborde.
     *
     * DEPUIS LE CURSEUR, PAS DEPUIS LE DÉBUT. La dette vient presque toujours d'un allongement qu'on
     * vient de faire, et le curseur est resté dessus : reprendre la place juste après lui, c'est
     * reprendre exactement celle que la note agrandie occupe désormais. Tout ce qui précède ne bouge
     * pas d'un pouce, et tout ce qui suit la zone reprise retrouve sa position d'origine — c'est
     * précisément ce qui distingue l'absorption du décalage.
     *
     * DES ÉVÈNEMENTS ENTIERS, ET LE SURPLUS REDEVIENT DU SILENCE. On ne raccourcit jamais une note à
     * moitié : une durée « bâtarde » ne s'écrit avec aucune figure, et l'éditeur se retrouverait à
     * graver ce qu'il ne sait pas nommer. On retire donc des évènements COMPLETS jusqu'à couvrir la
     * dette, et ce qu'on a repris EN TROP est rendu sous forme de silence, à sa place et sur la
     * grille de la mesure (voir `_silences`). Une note disparaît ou reste : jamais un entre-deux.
     *
     * REFUSE — et c'est le seul refus qui reste sur ce chemin — quand il n'y a pas assez de matière
     * après le curseur. Le message renvoie alors vers l'autre règlement, qui lui fonctionne toujours.
     */
    absorberDette(iMesure = this.curseur.mesure, iVoix = this.curseur.voix, depuis = this.curseur.evenement) {
        this.derniereErreur = null;
        const mesure = this.partition.mesures[iMesure];
        const voix = mesure?.voix[iVoix];
        if (!voix) return false;
        const dette = dureeEcrite(mesure, iVoix) - capaciteMesure(this.partition, iMesure);
        if (dette <= 1e-9) {
            this.derniereErreur = 'Cette mesure ne déborde pas : il n\'y a rien à absorber.';
            return false;
        }
        const debut = Math.min(Math.max(0, depuis + 1), voix.evenements.length);
        let pris = 0;
        let k = debut;
        while (pris < dette - 1e-9 && k < voix.evenements.length) {
            pris += dureeEnNoires(voix.evenements[k].duree);
            k++;
        }
        if (pris < dette - 1e-9) {
            this.derniereErreur = 'Pas assez de matière après le curseur pour absorber ce débordement. '
                + 'Alt+R (⇥ Corriger) le déverse dans une mesure neuve.';
            return false;
        }
        this.memoriser();
        const position = positionDe(voix, debut);
        // La grille se déduit de ce qui RESTERA, pas de ce qu'on retire : les frontières des
        // évènements supprimés n'ont plus à être honorées, et les compter donnerait une grille plus
        // fine que nécessaire, donc plus de figures de silence qu'il n'en faut.
        const restants = [...voix.evenements.slice(0, debut), ...voix.evenements.slice(k)];
        const rendu = this._silences({ evenements: restants }, position, pris - dette, iMesure);
        voix.evenements.splice(debut, k - debut, ...rendu);
        this.derniereDette = null;
        this._dernierChiffre = null;
        this.corrigerCurseur();
        this.prevenir('edition');
        return true;
    }

    corrigerDebordement(index = this.curseur.mesure) {
        this.derniereErreur = null;
        const diag = this._diagnostiquerDebordement(index);
        if (!diag.deborde && !diag.sousRempli) return false;   // déjà valide, rien à faire
        if (diag.impossible) {
            this.derniereErreur = 'Une figure de cette mesure dépasse à elle seule la capacité d\'une mesure entière — impossible à répartir automatiquement.';
            return false;
        }
        this.memoriser();
        this._appliquerRepartition(diag);
        this.corrigerCurseur();
        this.prevenir('edition');
        return true;
    }

    /**
     * Supprime l'évènement courant et DÉCALE tout ce qui le suit vers la gauche — à la différence de
     * `effacerNote`/Suppr, qui vide la case EN PLACE (elle reste un silence, rien ne bouge derrière).
     *
     * Un silence complète la fin de la mesure pour la durée tout juste libérée : la case supprimée
     * ne doit jamais laisser la mesure sous sa capacité (voir le principe du rythme strict — une
     * voix somme toujours EXACTEMENT sa mesure, ni plus ni moins). Sans ce complément, décaler à
     * gauche aurait simplement réduit le total de la voix, rendant la mesure invalide d'un coup —
     * le même genre de défaut, en miroir, que celui corrigé sur `insererEvenement`.
     */
    supprimerEvenement() {
        const voix = this.voixCourante();
        if (voix.evenements.length <= 1) return this.basculerSilence();
        this.memoriser();
        const [enleve] = voix.evenements.splice(this.curseur.evenement, 1);
        voix.evenements.push(...this._silences(
            voix, positionDe(voix, voix.evenements.length), dureeEnNoires(enleve.duree)));
        this.curseur.evenement = Math.min(this.curseur.evenement, voix.evenements.length - 1);
        this._dernierChiffre = null;
        this.prevenir('edition');
    }

    ajouterMesure(apres = true) {
        this.memoriser();
        const at = apres ? this.curseur.mesure + 1 : this.curseur.mesure;
        this.partition.mesures.splice(at, 0, creerMesure());
        this.curseur.mesure = at;
        this.curseur.evenement = 0;
        this.prevenir('edition');
    }

    /**
     * REMPLACE `evenementsParMesure.length` mesures À PARTIR DE `depart` par les rythmes donnés —
     * l'insertion de l'aide rythmique (voir ui/rythme.js et main.js#insererRythme).
     *
     * REMPLACER ET NON INSÉRER, et c'est un choix. On DÉSIGNE une place — la fenêtre l'écrit avant
     * qu'on clique (« remplacera les mesures 3 à 5 ») — et c'est cette place qu'on veut voir porter
     * le rythme dessiné. Insérer repousserait au contraire tout ce qui suit : sur un morceau de
     * trente mesures, poser un rythme à la quatrième en décalerait vingt-six, dont on n'a rien
     * demandé. (Repères, annotations et bande de boucle SUIVRAIENT, eux : les premiers sont portés
     * par la mesure elle-même, la seconde est ancrée à ses `id` — voir Lecteur.reancrerBoucle. Ce
     * n'est donc pas ce qui décide ici.)
     *
     * LE MORCEAU S'ALLONGE SI BESOIN : viser les deux dernières mesures d'un morceau qui n'en a plus
     * qu'une doit marcher — on ajoute alors ce qui manque, plutôt que de refuser ou de tronquer le
     * rythme dessiné.
     *
     * LA SIGNATURE N'EST POSÉE QUE SI ELLE CHANGE, comme partout ailleurs dans ce modèle (un champ
     * non nul signifie « cette mesure CHANGE la signature ») : la réécrire sur chaque mesure
     * insérée ferait apparaître un chiffrage de mesure en plein milieu du morceau.
     *
     * UN SEUL PAS D'ANNULATION pour toute l'insertion : `memoriser` une fois, avant la boucle. Quatre
     * mesures posées d'un geste doivent se défaire d'un seul Ctrl+Z.
     *
     * @param {number} depart index de la première mesure visée.
     * @param {Array<Array<object>>} evenementsParMesure un tableau d'évènements par mesure.
     * @param {{battements:number, unite:number}} signature celle du morceau à cet endroit.
     * @returns {boolean} faux et `derniereErreur` renseignée si rien n'a pu être fait.
     */
    remplacerMesuresPar(depart, evenementsParMesure, signature) {
        this.derniereErreur = null;
        if (!Array.isArray(evenementsParMesure) || !evenementsParMesure.length) {
            this.derniereErreur = 'Aucun rythme à insérer.';
            return false;
        }
        const at = Math.max(0, Math.min(this.partition.mesures.length, depart));
        this.memoriser();
        evenementsParMesure.forEach((evenements, k) => {
            const index = at + k;
            const ancienne = this.partition.mesures[index];
            const neuve = creerMesure({ voix: [{ evenements }] });
            // CE QUI APPARTIENT À LA MESURE, PAS AU RYTHME, est conservé : annotation de section,
            // saut de ligne, barres de reprise, repère. L'aide rythmique ne parle que de durées ;
            // écraser une annotation « Refrain » au passage serait une perte silencieuse.
            if (ancienne) {
                neuve.annotation = ancienne.annotation;
                neuve.sautAvant = ancienne.sautAvant;
                neuve.repriseDebut = ancienne.repriseDebut;
                neuve.repriseFin = ancienne.repriseFin;
                neuve.barre = ancienne.barre;
                neuve.repere = ancienne.repere;
                neuve.signature = ancienne.signature;
                neuve.armure = ancienne.armure;
                neuve.mode = ancienne.mode;
            } else if (k === 0 && signature) {
                // Mesure ajoutée au-delà de la fin : elle hérite du morceau, donc rien à poser — sauf
                // si le morceau était vide, cas où la signature doit bien s'écrire quelque part.
                if (!this.partition.mesures.length) neuve.signature = { ...signature };
            }
            if (index < this.partition.mesures.length) this.partition.mesures[index] = neuve;
            else this.partition.mesures.push(neuve);
        });
        this.curseur.mesure = at;
        this.curseur.voix = 0;
        this.curseur.evenement = 0;
        this.corrigerCurseur();
        this.prevenir('edition');
        return true;
    }

    /**
     * LA PROCHAINE CASE À REMPLIR — le parcours d'un rythme inséré (voir `Évènement#aRemplir`).
     *
     * Sans elle, remplir quatre mesures demanderait de viser chaque case à la souris. On cherche à
     * partir de la position courante, puis on reprend au début : arrivé au bout, le geste ramène au
     * premier trou resté vide, ce qui est exactement ce qu'on veut en fin de passage.
     *
     * @returns {boolean} vrai si le curseur a bougé ; faux s'il ne reste plus rien à remplir.
     */
    allerCaseSuivanteARemplir() {
        const plat = [];
        this.partition.mesures.forEach((m, iM) => m.voix.forEach((v, iV) => v.evenements.forEach((e, iE) => {
            if (e.aRemplir) plat.push({ mesure: iM, voix: iV, evenement: iE });
        })));
        if (!plat.length) return false;
        const c = this.curseur;
        const apres = plat.find(p => p.mesure > c.mesure
            || (p.mesure === c.mesure && (p.voix > c.voix || (p.voix === c.voix && p.evenement > c.evenement))));
        const cible = apres || plat[0];
        this.placerCurseur(cible.mesure, cible.evenement, c.corde, cible.voix);
        return true;
    }

    /**
     * Ajoute une SUITE de mesures toutes faites À LA FIN du morceau — l'import MIDI « à la suite »
     * (voir main.js#chargerFichierMidi), qui n'écrase rien de ce qui existe déjà, contrairement à
     * remplacer(). Contrairement à ajouterMesure ci-dessus (une mesure vide, insérée au curseur),
     * celles-ci arrivent déjà remplies, chacune sa propre signature/armure explicite dès la première
     * (voir construirePartitionDepuisMidi) — c'est elle qui reçoit `annotation`, pour marquer d'un
     * coup d'œil sur la partition où commence cette nouvelle partie.
     */
    ajouterMesures(mesures, annotation) {
        if (!mesures.length) return;
        this.memoriser();
        if (annotation) mesures[0].annotation = annotation.slice(0, 40);
        this.curseur.mesure = this.partition.mesures.length;
        this.partition.mesures.push(...mesures);
        this.curseur.voix = 0;
        this.curseur.evenement = 0;
        this.corrigerCurseur();
        this.prevenir('edition');
    }

    /**
     * COPIE la mesure courante dans un presse-papier interne (retour utilisateur : « permets-moi de
     * copier/coller une mesure complète avec clic droit, et de l'insérer là où je le souhaite »).
     *
     * Ne modifie RIEN — donc aucun point d'annulation : copier n'est pas une édition, et polluer
     * l'historique d'un geste qui ne change pas le document ferait qu'un Ctrl+Z après une copie
     * semblerait « ne rien faire ».
     *
     * ON MÉMORISE AUSSI LA SIGNATURE EN VIGUEUR, pas seulement les notes : c'est elle qui donne un
     * sens à leur somme. Coller une mesure de 4 temps dans un passage en 3/4 sans cette précaution
     * produirait une mesure qui déborde silencieusement — voir collerMesure, qui s'en sert.
     */
    copierMesure() {
        this.presseMesure = {
            mesure: cloner(this.mesureCourante()),
            signature: { ...signatureEffective(this.partition, this.curseur.mesure) },
            cordes: nbCordes(this.partition),
        };
        return true;
    }

    /** Y a-t-il quelque chose à coller ? Sert au menu contextuel, qui masque l'entrée si non. */
    peutCollerMesure() { return !!this.presseMesure; }

    /**
     * COLLE la mesure copiée, avant ou après celle du curseur — jamais par-dessus : « insérer là où je
     * le souhaite » veut dire ajouter, pas écraser ce qui s'y trouve.
     *
     * DEUX PIÈGES, traités plutôt que laissés au hasard.
     *
     * 1. LES CORDES. Une mesure de guitare collée dans une basse porterait des notes sur des cordes
     *    qui n'existent pas — invisibles à l'écran (aucune ligne pour les recevoir) mais bien dans le
     *    document, et audibles. Elles sont donc écartées, et leur nombre remonté à l'appelant pour
     *    qu'il le DISE, comme le fait déjà l'import MIDI de ses notes hors du manche.
     *
     * 2. LA SIGNATURE. Une mesure de 4 temps collée dans un passage en 3/4 doit garder SA signature,
     *    sinon sa somme ne correspond plus à sa capacité. Mais la poser telle quelle la propagerait à
     *    TOUTE LA SUITE du morceau (voir signatureEffective, qui remonte à la dernière mesure qui en
     *    fixe une) : on rend donc explicitement à la mesure SUIVANTE la signature qui régnait là
     *    avant le collage. Le changement reste local, exactement là où on a collé.
     */
    collerMesure(apres = true) {
        if (!this.presseMesure) { this.derniereErreur = 'Aucune mesure copiée.'; return null; }
        const cordesCibles = nbCordes(this.partition);
        const copie = cloner(this.presseMesure.mesure);
        let abandonnees = 0;
        for (const voix of copie.voix) {
            for (const e of voix.evenements) {
                const avant = e.notes.length;
                e.notes = e.notes.filter(n => n.corde < cordesCibles);
                abandonnees += avant - e.notes.length;
                if (!e.notes.length) e.silence = true;
            }
        }

        this.memoriser();
        const at = apres ? this.curseur.mesure + 1 : this.curseur.mesure;
        const signatureAvant = { ...signatureEffective(this.partition, Math.min(at, this.partition.mesures.length - 1)) };
        const sigCopie = this.presseMesure.signature;
        const memeSignature = sigCopie.battements === signatureAvant.battements && sigCopie.unite === signatureAvant.unite;
        copie.signature = memeSignature ? null : { ...sigCopie };
        this.partition.mesures.splice(at, 0, copie);
        // Rendre à la suite la signature qu'elle avait : sans ça, le 4/4 de la mesure collée
        // deviendrait celui de tout ce qui la suit.
        if (!memeSignature) {
            const suivante = this.partition.mesures[at + 1];
            if (suivante && !suivante.signature) suivante.signature = signatureAvant;
        }
        this.curseur.mesure = at;
        this.curseur.evenement = 0;
        this.corrigerCurseur();
        this.prevenir('edition');
        return { abandonnees };
    }

    supprimerMesure() {
        if (this.partition.mesures.length <= 1) return false;
        this.memoriser();
        this.partition.mesures.splice(this.curseur.mesure, 1);
        // La toute première mesure porte signature et armure de départ : si on l'efface, la suivante
        // en hérite explicitement, sans quoi la partition perdrait son 3/8 et repartirait en 4/4.
        if (this.curseur.mesure === 0) {
            const nouvelle = this.partition.mesures[0];
            if (!nouvelle.signature) nouvelle.signature = { battements: 4, unite: 4 };
            if (nouvelle.armure === null || nouvelle.armure === undefined) nouvelle.armure = 0;
        }
        this.corrigerCurseur();
        this.prevenir('edition');
        return true;
    }

    /**
     * RETOUR À LA LIGNE avant la mesure courante — posé ou retiré (retour utilisateur : « permets-moi
     * de faire un retour à la ligne pour la portée, à l'aide d'un clic droit par exemple. Par exemple,
     * si je veux uniquement créer une fiche d'exercices avec plusieurs petits morceaux de 2 mesures,
     * je dois pouvoir faire un retour à la ligne. Je pourrai ainsi indiquer des sections [...]
     * au-dessus de chaque portée de 2 mesures. »)
     *
     * C'est de la MISE EN PAGE et non de la musique, mais le drapeau vit dans le DOCUMENT (voir
     * Mesure#sautAvant) : une fiche d'exercices dont les systèmes se recolleraient à la réouverture
     * du fichier n'aurait aucun intérêt.
     *
     * REFUSÉ SUR LA PREMIÈRE MESURE : elle ouvre déjà le premier système, un saut n'y produirait
     * strictement rien — et un réglage qui s'allume sans rien changer est pire qu'un refus expliqué.
     */
    /**
     * REPÈRE DE NAVIGATION sur la mesure courante — posé, remplacé, ou RETIRÉ si c'est déjà le même.
     *
     * La bascule sur place plutôt qu'un simple « poser » : les six repères partagent un seul
     * emplacement par mesure (voir Mesure#repere), si bien que le bouton d'un repère déjà en place
     * n'aurait sinon plus aucun effet — ni pose ni retrait. Retaper le même l'enlève, comme pour
     * n'importe quel effet de la palette.
     */
    definirRepere(id) {
        if (id !== null && !REPERES[id]) { this.derniereErreur = 'Repère inconnu.'; return false; }
        this.memoriser();
        const m = this.mesureCourante();
        m.repere = (m.repere === id) ? null : id;
        this.prevenir('edition');
        return true;
    }

    /** BARRE DE FIN de la mesure courante : 'double', 'finale', ou retour au trait simple. Même
     *  bascule sur place, pour la même raison que definirRepere. */
    definirBarre(type) {
        if (type !== null && !['double', 'finale'].includes(type)) { this.derniereErreur = 'Barre inconnue.'; return false; }
        this.memoriser();
        const m = this.mesureCourante();
        m.barre = (m.barre === type) ? null : type;
        this.prevenir('edition');
        return true;
    }

    basculerSautDeLigne() {
        if (this.curseur.mesure === 0) {
            this.derniereErreur = 'La première mesure commence déjà une ligne.';
            return false;
        }
        this.memoriser();
        const m = this.mesureCourante();
        m.sautAvant = !m.sautAvant;
        this.prevenir('edition');
        return true;
    }

    /**
     * Fixe la SIGNATURE de la mesure courante — et redimensionne ses voix VIDES à la nouvelle
     * capacité.
     *
     * POURQUOI LES VOIX VIDES, ET ELLES SEULES. Une voix qui ne porte que du silence n'a rien à
     * protéger : son contenu n'est pas de la musique, c'est la mesure de son propre vide. La laisser
     * garder les quatre noires d'un 4/4 dans une mesure passée en 2/4 en ferait une mesure fausse —
     * signalée en rouge, plus longue à la lecture que ce que sa signature annonce (voir
     * score.js#longueurMesure) — pour rien du tout. C'est aussi ce qu'attend qui pose sa métrique
     * AVANT d'écrire, le cas le plus courant de tous.
     *
     * UNE VOIX QUI PORTE DES NOTES N'EST PAS TOUCHÉE, et c'est le pendant exact du même raisonnement :
     * là, il y a quelque chose à perdre. La mesure devient alors trop pleine (ou incomplète), le
     * rectangle d'avertissement le dit, « ⇥ Corriger » (Alt+R) répartit à la demande — et, depuis que
     * la lecture suit la durée écrite, ce qui est écrit continue de sonner en entier plutôt que
     * d'empiéter d'un temps sur la mesure suivante.
     */
    definirSignature(battements, unite) {
        this.memoriser();
        const m = this.mesureCourante();
        m.signature = { battements, unite };
        const capacite = capaciteMesure(this.partition, this.curseur.mesure);
        for (const voix of m.voix) {
            if (!voix.evenements.every(e => e.silence || !e.notes.length)) continue;
            voix.evenements = creerVoix(capacite).evenements;
        }
        this.corrigerCurseur();
        this.prevenir('edition');
    }

    /**
     * Fixe la TONALITÉ de la mesure courante : armure ET mode, indissociables.
     *
     * Les deux se posent ENSEMBLE et jamais l'un sans l'autre — une mesure qui changerait d'armure en
     * gardant le mode de la précédente (ou l'inverse) désignerait une tonalité que personne n'a
     * choisie. C'est aussi pourquoi `definirArmure` n'existe plus seul : il laissait le mode derrière
     * lui, hérité d'on ne sait où.
     */
    /**
     * TRANSPOSE LE MORCEAU ENTIER de `demiTons` demi-tons — portée, tablature et tonalité ensemble.
     *
     * SUR QUELLE CORDE ? La même, d'abord : décaler la case de N sur la corde d'origine décale la
     * hauteur de N tout en PRÉSERVANT LE DOIGTÉ, ce qui est exactement ce qu'un guitariste attend
     * d'une transposition — la position de main reste la même, plus haut ou plus bas sur le manche.
     *
     * QUAND ÇA SORT DU MANCHE, on cherche une AUTRE corde capable de donner la même hauteur dans ses
     * cases jouables, en évitant celles que l'accord occupe déjà (deux notes sur une même corde sont
     * physiquement injouables — le modèle l'interdit d'ailleurs, voir normaliser). Le doigté change
     * alors, mais la musique est juste et reste jouable, ce qui vaut mieux qu'une note perdue.
     *
     * QUAND AUCUNE CORDE NE PEUT LA JOUER — transposer vers le grave au-delà de la corde la plus
     * basse, typiquement — la note est marquée `horsManche` et gardée à la case la plus proche du
     * manche. Elle s'affiche alors en couleur (voir engine/layout.js) plutôt que de disparaître en
     * silence : le morceau reste transposé, et c'est à l'utilisateur de décider quoi mettre là. Poser
     * une case dessus efface la marque (voir saisirChiffre).
     *
     * @returns {{transposees, deplacees, horsManche}} de quoi rendre compte honnêtement du résultat.
     */
    transposerMorceau(demiTons) {
        this.derniereErreur = null;
        if (!demiTons) return { transposees: 0, deplacees: 0, horsManche: 0 };
        const accordage = this.partition.piste.accordage;
        const casesMax = INSTRUMENTS[this.partition.piste.instrument]?.casesMax ?? 24;
        const capo = this.partition.piste.capo || 0;
        const cordes = accordage.cordes;

        this.memoriser();
        let transposees = 0, deplacees = 0, horsManche = 0;

        // PIANO : ni case ni corde de repli à chercher — `frette` porte directement la hauteur MIDI
        // (voir model/instruments.js#hauteurDeCase), et un clavier n'a pas de bord où buter comme un
        // manche. Décaler chaque hauteur suffit ; jamais de « horsManche » à ce demi-ton près.
        if (!cordes.length) {
            for (const mesure of this.partition.mesures) {
                for (const voix of mesure.voix) {
                    for (const evenement of voix.evenements) {
                        for (const note of evenement.notes) {
                            transposees++;
                            note.frette += demiTons;
                        }
                    }
                }
            }
        } else {
            for (const mesure of this.partition.mesures) {
                for (const voix of mesure.voix) {
                    for (const evenement of voix.evenements) {
                        // Les cordes DÉJÀ prises dans cet accord, pour ne jamais en réutiliser une —
                        // relevées avant de toucher quoi que ce soit, sinon une note déplacée
                        // fausserait le relevé des suivantes.
                        const prises = new Set(evenement.notes.map(n => n.corde));
                        for (const note of evenement.notes) {
                            transposees++;
                            // LA HAUTEUR DONT ON PART est celle que la note VOULAIT sonner, quand une
                            // transposition précédente l'a laissée hors du manche : sa case a alors
                            // été rabattue au bord du manche, ce qui perd la hauteur réelle. Repartir
                            // de la case rabattue rendrait la transposition IRRÉVERSIBLE — monter de
                            // 5 puis redescendre de 5 ne rendait pas le morceau de départ, les notes
                            // rabattues revenant à une hauteur qui n'avait jamais été la leur.
                            // `hauteurVoulue` garde donc l'intention, et c'est elle qui se transpose.
                            const depart = note.hauteurVoulue ?? hauteurDeCase(accordage, note.corde, note.frette, capo);
                            const cible = depart + demiTons;
                            const surPlace = cible - cordes[note.corde] - capo;
                            if (surPlace >= 0 && surPlace <= casesMax) {
                                note.frette = surPlace;
                                delete note.horsManche;
                                delete note.hauteurVoulue;
                                continue;
                            }
                            // Corde de repli : celle qui joue la hauteur visée en restant sur le
                            // manche, la plus proche possible de la corde d'origine pour déranger le
                            // moins le doigté.
                            let meilleure = null;
                            for (let c = 0; c < cordes.length; c++) {
                                if (c === note.corde || prises.has(c)) continue;
                                const f = cible - cordes[c] - capo;
                                if (f < 0 || f > casesMax) continue;
                                if (!meilleure || Math.abs(c - note.corde) < Math.abs(meilleure.corde - note.corde)) {
                                    meilleure = { corde: c, frette: f };
                                }
                            }
                            if (meilleure) {
                                prises.delete(note.corde);
                                prises.add(meilleure.corde);
                                note.corde = meilleure.corde;
                                note.frette = meilleure.frette;
                                delete note.horsManche;
                                delete note.hauteurVoulue;
                                deplacees++;
                            } else {
                                note.frette = Math.max(0, Math.min(casesMax, surPlace));
                                note.horsManche = true;
                                note.hauteurVoulue = cible;   // l'intention, pour que le retour soit exact
                                horsManche++;
                            }
                        }
                    }
                }
            }
        }

        // LA TONALITÉ SUIT, sans quoi la partition afficherait les altérations de l'ancienne — et
        // toutes les notes s'orthographieraient dans une armure qui n'est plus la sienne. Le cycle des
        // quintes fait qu'un demi-ton vaut SEPT quintes : d'où le `7 * demiTons`, ramené dans
        // [-5, 6] pour toujours retenir l'écriture la moins chargée en altérations (do♯ majeur et ses
        // sept dièses cèdent ainsi la place à ré♭ majeur et ses cinq bémols).
        // Le MODE, lui, ne bouge pas : transposer un morceau mineur donne un morceau mineur.
        for (const mesure of this.partition.mesures) {
            if (mesure.armure === null || mesure.armure === undefined) continue;
            mesure.armure = ((mesure.armure + 7 * demiTons + 5) % 12 + 12) % 12 - 5;
        }
        if (horsManche) {
            this.derniereErreur = `${horsManche} note(s) hors du manche après transposition — affichées en couleur, à redéfinir.`;
        }
        this.prevenir('edition');
        return { transposees, deplacees, horsManche };
    }

    definirTonalite(armure, mode) {
        this.memoriser();
        const m = this.mesureCourante();
        m.armure = armure;
        m.mode = mode === 'mineur' ? 'mineur' : 'majeur';
        this.prevenir('edition');
    }

    basculerReprise(bord) {
        this.memoriser();
        const m = this.mesureCourante();
        if (bord === 'debut') m.repriseDebut = !m.repriseDebut;
        else m.repriseFin = !m.repriseFin;
        this.prevenir('edition');
    }

    /**
     * Étiquette de section (« Couplet 1 », « Refrain », « Pont »…) au-dessus de la mesure courante —
     * vide (ou rien que des espaces) la retire. À la différence d'une durée, jamais de refus faute de
     * place : l'espace qu'une annotation réclame est réservé par la mise en page elle-même (voir
     * engine/layout.js, HAUTEUR_ANNOTATION), jamais prélevé sur la mesure — elle se pose ou disparaît,
     * un point, c'est tout.
     */
    definirAnnotation(texte) {
        this.memoriser();
        const m = this.mesureCourante();
        m.annotation = String(texte ?? '').trim().slice(0, 40) || null;
        this.prevenir('edition');
    }

    /**
     * Nom d'accord (« A7 », « E7 »…) au-dessus de l'ÉVÈNEMENT courant — vide (ou rien que des
     * espaces) le retire. Sur l'évènement, pas la mesure (voir Évènement#accord) : un accord change
     * souvent plusieurs fois dans la même mesure, contrairement à l'annotation de section. Même
     * franchise que definirAnnotation : jamais de refus faute de place, l'espace réservé par la mise
     * en page (voir engine/layout.js, HAUTEUR_ACCORDS) ne dépend d'aucun contenu.
     */
    definirAccord(texte) {
        this.memoriser();
        const e = this.evenementCourant();
        e.accord = String(texte ?? '').trim().slice(0, 12) || null;
        this.prevenir('edition');
    }

    // -- Effets --------------------------------------------------------------------------------------

    /** Effets portés par l'évènement entier (palm mute, accent, staccato). */
    basculerEffetEvenement(nom) {
        this.memoriser();
        const e = this.evenementCourant();
        e[nom] = !e[nom];
        this.prevenir('edition');
    }

    /**
     * Liaison vers la note SUIVANTE de la même corde. Un seul champ pour les cinq états : rejouer le
     * même effet l'enlève, en choisir un autre remplace — jamais de combinaison impossible.
     */
    /**
     * Pose ou retire une liaison sur la note courante — vers la note SUIVANTE de la même corde.
     *
     * REFUSE QUAND IL N'Y A PAS DE NOTE D'ARRIVÉE, et le dit. Sans ce garde-fou, l'invariant tenu par
     * `_nettoyerLiens` retirerait la liaison dans la foulée du `prevenir` ci-dessous : le bouton
     * semblerait ne rien faire du tout, ce qui est la pire des réponses — on le presse trois fois en
     * cherchant ce qui cloche. Mieux vaut dire pourquoi.
     */
    basculerLien(lien) {
        this.derniereErreur = null;
        const note = this.noteCourante();
        if (!note) return false;
        if (note.lien !== lien && !this._cibleDeLiaison(note)) {
            this.derniereErreur = 'Une liaison relie cette note à la SUIVANTE sur la même corde — '
                + 'il n\'y en a pas encore. Écris-la d\'abord.';
            return false;
        }
        this.memoriser();
        note.lien = note.lien === lien ? null : lien;
        this.prevenir('edition');
        return true;
    }

    /** La note vers laquelle une liaison partant de `note` irait — `null` s'il n'y en a aucune.
     *  Même chaînage que `_nettoyerLiens`, dont c'est la question posée à l'endroit. */
    _cibleDeLiaison(note) {
        const c = this.curseur;
        const liste = aplatir(this.partition).filter(e => e.voix === c.voix);
        const k = liste.findIndex(e => e.mesure === c.mesure && e.evenement === c.evenement);
        const suivant = k >= 0 ? liste[k + 1]?.ref : null;
        if (!suivant || suivant.silence) return null;
        return suivant.notes.find(nn => nn.corde === note.corde) || null;
    }

    basculerGhost() {
        const note = this.noteCourante();
        if (!note) return false;
        this.memoriser();
        note.ghost = !note.ghost;
        this.prevenir('edition');
        return true;
    }

    /**
     * POSE une note fantôme — ou retire celle qui est déjà là. Le geste du bouton « ✕ » du pavé
     * tactile, de la touche X et du bouton de la palette.
     *
     * POURQUOI CE N'EST PAS `basculerGhost`. Retour utilisateur : « peux-tu insérer les ghost notes
     * directement dans le pavé tactile d'ajout de notes ? Je vais souvent l'utiliser, ça n'est pas
     * juste un effet ». Et c'est exact, jusque dans le rendu : une note fantôme s'écrit « x » À LA
     * PLACE du chiffre de case (voir engine/layout.js, `note.ghost ? 'x' : String(note.frette)`) —
     * ce n'est pas une décoration ajoutée à une case, c'est ce qu'on écrit AU LIEU d'une case. Le
     * X est donc la onzième touche du pavé, pas un effet de plus.
     *
     * `basculerGhost` ne savait que BASCULER : sur une case vide — le cas de très loin le plus
     * fréquent quand on écrit au fil de l'eau — elle ne faisait rien, sans même un message. D'où
     * cette commande, qui ÉCRIT quand il n'y a rien, et bascule quand il y a déjà quelque chose.
     *
     * L'écriture passe par `saisirChiffre(0)` plutôt que de poser la note à la main : c'est lui qui
     * sait refuser au piano (où il n'y a ni corde ni case), dimensionner l'évènement à la durée
     * courante sans casser l'invariant de la mesure, et ouvrir le point d'annulation. La case 0 n'est
     * qu'un support : elle disparaît sous le « x » au rendu, la hauteur d'une note fantôme étant
     * indéterminée par définition (voir model/score.js, EFFETS.ghost).
     */
    poserGhost() {
        const note = this.noteCourante();
        if (note) return this.basculerGhost();
        // Rien ici : on l'écrit. `saisirChiffre` renvoie null quand il a refusé (piano) — il a alors
        // déjà posé `derniereErreur`, rien à ajouter.
        if (this.saisirChiffre(0) === null) return false;
        const posee = this.noteCourante();
        if (!posee) return false;
        posee.ghost = true;
        // Le « 0 » qui vient de servir de support ne doit PAS pouvoir s'enchaîner avec le chiffre
        // suivant (voir DELAI_DEUXIEME_CHIFFRE) : taper « ✕ » puis « 5 » veut dire une fantôme puis
        // la case 5, jamais la case 5 obtenue par « 05 ».
        this._dernierChiffre = null;
        this.prevenir('edition');
        return true;
    }

    /**
     * Fait CIRCULER l'amplitude du bend de la note courante : aucun → ½ ton → ton entier → 1 ton ½,
     * puis retour à aucun. Les trois amplitudes qu'un guitariste écrit réellement, dans l'ordre où il
     * les rencontre — et toutes atteignables depuis la même touche, sans champ ni menu à ouvrir.
     */
    bendSuivant() {
        const note = this.noteCourante();
        if (!note) return false;
        const AMPLITUDES = [0, 1, 2, 3];
        const actuel = note.bend?.demiTons ?? 0;
        const i = AMPLITUDES.indexOf(actuel);
        return this.definirBend(AMPLITUDES[(i === -1 ? 0 : i + 1) % AMPLITUDES.length]);
    }

    definirBend(demiTons) {
        const note = this.noteCourante();
        if (!note) return false;
        this.memoriser();
        note.bend = demiTons ? { demiTons } : null;
        this.prevenir('edition');
        return true;
    }

    // -- Transposition ------------------------------------------------------------------------------

    /** Monte ou descend la note courante d'une case — le geste d'ajustement le plus fréquent. */
    transposerNote(delta) {
        const note = this.noteCourante();
        if (!note) return false;
        const casesMax = INSTRUMENTS[this.partition.piste.instrument]?.casesMax ?? 24;
        const suivant = note.frette + delta;
        if (suivant < 0 || suivant > casesMax) return false;
        this.memoriser('transposer');
        note.frette = suivant;
        // Une case posée à la main est jouable par construction (bornée ci-dessus) : la note cesse
        // d'être hors manche, et l'intention mémorisée n'a plus lieu d'être.
        delete note.horsManche;
        delete note.hauteurVoulue;
        this.prevenir('edition');
        return true;
    }

    // -- Piste ----------------------------------------------------------------------------------------

    /**
     * Change d'instrument. Les notes existantes sont RAMENÉES dans les bornes du nouvel instrument :
     * passer d'une guitare à une basse 4 cordes supprime les cordes 5 et 6, qui n'existent plus. On
     * perd de la musique, mais c'est explicite et annulable — l'alternative (garder des notes sur des
     * cordes absentes) donnerait un fichier que plus rien ne saurait afficher.
     */
    /**
     * Change d'instrument — et retire les notes posées sur des cordes que le nouvel instrument n'a
     * pas, en DISANT combien.
     *
     * Passer d'une guitare à une basse à quatre cordes fait disparaître tout ce qui était écrit sur
     * les cordes 5 et 6 : c'est inévitable, elles n'existent plus. Ce qui ne l'est pas, c'est de le
     * faire sans un mot depuis une liste déroulante de réglages, où l'on ne s'attend pas à perdre de
     * la musique. Mesuré sur un accord de six notes : quatre survivaient, deux disparaissaient, et
     * rien nulle part ne le signalait. `collerMesure` compte déjà ses notes abandonnées pour la même
     * raison (voir son `abandonnees`) — c'est la règle de la maison, appliquée ici aussi.
     */
    definirInstrument(instrumentId) {
        if (!INSTRUMENTS[instrumentId]) return false;
        this.memoriser();
        this.partition.piste.instrument = instrumentId;
        this.partition.piste.accordage = accordageParDefaut(instrumentId);
        const max = this.partition.piste.accordage.cordes.length - 1;
        let perdues = 0;
        for (const m of this.partition.mesures) {
            for (const voix of m.voix) {
                for (const e of voix.evenements) {
                    const avant = e.notes.length;
                    e.notes = e.notes.filter(n => n.corde <= max);
                    perdues += avant - e.notes.length;
                    if (!e.notes.length) e.silence = true;
                }
            }
        }
        this.dernierBilan = perdues
            ? `${perdues} note${perdues > 1 ? 's' : ''} retirée${perdues > 1 ? 's' : ''} : `
              + `${INSTRUMENTS[instrumentId].nom} n'a pas ces cordes. Ctrl+Z les ramène.`
            : null;
        this.corrigerCurseur();
        this.prevenir('instrument');
        return true;
    }

    definirAccordage(accordageId) {
        const a = accordagePredefini(this.partition.piste.instrument, accordageId);
        if (!a) return false;
        this.memoriser();
        this.partition.piste.accordage = a;
        this.prevenir('instrument');
        return true;
    }

    /** Accordage personnalisé, corde par corde. Retombe sur un prédéfini s'il en reconstitue un. */
    definirCorde(corde, midi) {
        this.memoriser('accordage');
        const cordes = this.partition.piste.accordage.cordes.slice();
        cordes[corde] = Math.max(0, Math.min(127, midi));
        const connu = identifierAccordage(this.partition.piste.instrument, cordes);
        this.partition.piste.accordage = connu || { id: 'personnalise', nom: 'Personnalisé', cordes };
        this.prevenir('instrument');
        return true;
    }

    definirCapo(cases) {
        this.memoriser('capo');
        this.partition.piste.capo = Math.max(0, Math.min(12, cases));
        this.prevenir('instrument');
    }

    definirMeta(champ, valeur) {
        this.memoriser('meta-' + champ);
        this.partition.meta[champ] = valeur;
        this.prevenir('meta');
    }

    /**
     * Allume ou éteint la LECTURE TERNAIRE du morceau (voir model/score.js, `meta.ternaire`).
     *
     * CE QUE ÇA NE CHANGE PAS : ce qui est écrit. Les croches restent des croches sur la partition —
     * c'est tout l'intérêt de la convention. Ce qui change, c'est ce qu'on ENTEND (voir
     * audio/player.js) et ce qu'on EXPORTE (voir io/midi.js), plus l'indication gravée en tête
     * (voir engine/layout.js).
     *
     * `memoriser` comme toute autre édition : c'est une propriété du document, pas une préférence
     * d'affichage, et Ctrl+Z doit pouvoir la défaire.
     */
    basculerTernaire() {
        this.memoriser('ternaire');
        this.partition.meta.ternaire = !this.partition.meta.ternaire;
        this.prevenir('meta');
    }

    definirTempo(bpm) {
        this.memoriser('tempo');
        this.partition.meta.tempo = Math.max(20, Math.min(400, Math.round(bpm)));
        this.prevenir('tempo');
    }

    // -- Documents --------------------------------------------------------------------------------------

    /** Remplace tout le document. L'historique est vidé : annuler une OUVERTURE n'a pas de sens. */
    remplacer(partition) {
        this.partition = normaliser(partition);
        this.curseur = { mesure: 0, voix: 0, evenement: 0, corde: 0 };
        this.passe.length = 0;
        this.futur.length = 0;
        this._dernierChiffre = null;
        this.prevenir('document');
    }

    nouveau(instrumentId = 'guitare') {
        this.remplacer(creerPartition(instrumentId));
    }

    // -- Diagnostic --------------------------------------------------------------------------------------

    /** Écart entre ce qui est écrit dans une VOIX de la mesure et sa capacité, en noires. Sert à l'indicateur. */
    ecartMesure(index = this.curseur.mesure, iVoix = this.curseur.voix) {
        return dureeEcrite(this.partition.mesures[index], iVoix) - capaciteMesure(this.partition, index);
    }
}
