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
    signatureEffective, armureEffective, nbCordes, dureeEcrite, capaciteMesure,
    decouperEnEvenements, MAX_VOIX,
} from '../model/score.js';
import { dureeEnNoires, noiresParMesure, VALEURS_FIGURES } from '../model/duration.js';
import { INSTRUMENTS, accordageParDefaut, accordagePredefini, identifierAccordage, hauteurDeCase } from '../model/instruments.js';

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
    }

    // -- Abonnement ------------------------------------------------------------------------------
    surChangement(fn) { this.auditeurs.add(fn); return () => this.auditeurs.delete(fn); }
    prevenir(raison = 'edition') { for (const fn of this.auditeurs) fn(raison); }

    // -- Historique ------------------------------------------------------------------------------
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
        this.passe.push({ etat: cloner(this.partition), curseur: { ...this.curseur }, fusion, temps: Date.now() });
        if (this.passe.length > MAX_HISTORIQUE) this.passe.shift();
        this.futur.length = 0;
        this.partition.meta.modifieLe = new Date().toISOString();
    }

    peutAnnuler() { return this.passe.length > 0; }
    peutRetablir() { return this.futur.length > 0; }

    annuler() {
        if (!this.passe.length) return false;
        const entree = this.passe.pop();
        this.futur.push({ etat: cloner(this.partition), curseur: { ...this.curseur } });
        this.partition = entree.etat;
        this.curseur = entree.curseur;
        this.corrigerCurseur();
        this.prevenir('annulation');
        return true;
    }

    retablir() {
        if (!this.futur.length) return false;
        const entree = this.futur.pop();
        this.passe.push({ etat: cloner(this.partition), curseur: { ...this.curseur }, temps: Date.now() });
        this.partition = entree.etat;
        this.curseur = entree.curseur;
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
                if (reste >= dureeEnNoires(this.dureeCourante) - 1e-9) {
                    this.memoriser('prolonger');
                    voix.evenements.push(creerEvenement({ ...this.dureeCourante }, [], { silence: true }));
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
        m.voix.pop();
        this.corrigerCurseur();
        this._dernierChiffre = null;
        this.prevenir('edition');
        return true;
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
     * Saisie d'un chiffre de case.
     *
     * LE CAS À DEUX CHIFFRES. Une guitare va jusqu'à la case 24 : taper « 1 » puis « 2 » doit donner
     * la case 12, pas deux fois la case 1 ni la case 1 puis un déplacement. La règle appliquée est
     * celle des éditeurs de tablature établis : un second chiffre tapé RAPIDEMENT, sur la MÊME corde
     * du MÊME évènement, complète le premier — s'il forme une case atteignable. « 2 » puis « 7 »
     * donnerait 27, hors du manche : on garde alors 7, ce que l'utilisateur voulait forcément dire.
     */
    saisirChiffre(chiffre) {
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
        if (existante) { existante.frette = frette; delete existante.horsManche; delete existante.hauteurVoulue; }
        else evenement.notes.push(creerNote(c.corde, frette));
        // La durée collante s'applique à un évènement encore VIERGE seulement : retaper une case sur
        // un accord déjà écrit ne doit pas en changer le rythme.
        if (evenement.notes.length === 1 && !enchaine) {
            evenement.duree = { ...this.dureeCourante };
        }
        this._dernierChiffre = { temps: maintenant, mesure: c.mesure, evenement: c.evenement, corde: c.corde, valeur: frette };
        this.prevenir('saisie');
        return frette;
    }

    /** Efface la note sous le curseur ; l'évènement redevient un silence s'il ne reste rien. */
    effacerNote() {
        const evenement = this.evenementCourant();
        const avant = evenement.notes.length;
        if (!avant) return false;
        this.memoriser();
        evenement.notes = evenement.notes.filter(n => n.corde !== this.curseur.corde);
        if (!evenement.notes.length) evenement.silence = true;
        // Une mesure vidée note après note garderait sinon le chapelet de petits silences hérités du
        // rythme qui s'y jouait — un soupir, un demi-soupir, encore un soupir... On la reconsolide en
        // la décomposition standard (la même qu'à la naissance d'une voix neuve) dès que PLUS AUCUN
        // évènement de la voix ne porte de note : le curseur revient à son unique/premier silence.
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
            if (voix.evenements.every(e => e.silence || !e.notes.length)) {
                voix.evenements = creerVoix(capaciteMesure(this.partition, mesure)).evenements;
            }
        }
        this._dernierChiffre = null;
        this.corrigerCurseur();
        this.prevenir('edition');
        return true;
    }

    // -- Rythme -----------------------------------------------------------------------------------

    /**
     * Essaie de donner une NOUVELLE description de durée à l'évènement courant — le geste commun à
     * appliquerDuree, basculerPoint et basculerTriolet, les trois façons de changer combien de temps
     * un évènement occupe.
     *
     * UNE MESURE NE RESTE JAMAIS VISIBLEMENT DÉBORDÉE — mais un allongement N'EST PLUS REFUSÉ pour
     * autant faute de place : une version antérieure refusait tout net, ce qui bloquait l'édition en
     * plein geste (retour direct : « je dois toujours pouvoir modifier comme je veux, toute la suite
     * doit se décaler »). Le temps gagné vient D'ABORD des silences qui suivent immédiatement dans la
     * même voix, comme avant ; s'ils ne suffisent pas, l'excédent est aussitôt réparti dans une ou
     * plusieurs mesures NEUVES juste après (voir `_absorberEtLocaliser`, le même mécanisme
     * qu'`insererEvenement`) — jamais un dépassement qui resterait affiché tel quel. Le curseur suit
     * l'évènement modifié, où qu'il ait fini. Si l'évènement raccourcit, le temps libéré redevient un
     * silence juste après (fusionné à celui qui s'y trouve déjà) : dans ce sens-là, il n'y a jamais de
     * débordement possible. Seul cas qui reste un refus pur et simple : une durée qui, à elle seule,
     * dépasse la capacité d'une mesure entière — aucune répartition ne peut jamais l'y faire tenir.
     *
     * N'appelle PAS prevenir() : à l'appelant de le faire, une fois qu'il a fini de poser ses propres
     * champs (dureeCourante, par exemple), pour ne prévenir qu'une seule fois par geste.
     */
    _essaierNouvelleDuree(nouvelleDuree) {
        this.derniereErreur = null;
        const iMesureDepart = this.curseur.mesure;
        const iVoix = this.curseur.voix;
        const voix = this.voixCourante();
        const iEvt = this.curseur.evenement;
        const evenement = voix.evenements[iEvt];
        const ancienne = dureeEnNoires(evenement.duree);
        const nouvelle = dureeEnNoires(nouvelleDuree);
        const delta = nouvelle - ancienne;
        const estSilence = (e) => e.silence || !e.notes.length;

        const capacite = capaciteMesure(this.partition, iMesureDepart);
        if (nouvelle > capacite + 1e-9) {
            this.derniereErreur = 'Cette durée dépasse à elle seule la capacité d\'une mesure entière.';
            return false;
        }

        this.memoriser();
        evenement.duree = nouvelleDuree;

        if (delta > 1e-9) {
            // Consomme le silence CONTIGU qui suit immédiatement (jusqu'à la prochaine vraie note, ou
            // la fin de la voix), au plus `delta` — jamais au-delà : une vraie note qui suit ne doit
            // jamais être avalée par cet allongement. S'il n'y en avait pas assez, la voix déborde
            // maintenant sa capacité ; `_absorberEtLocaliser` ci-dessous s'en charge, dans le MÊME
            // geste (un seul memoriser(), au-dessus, pour tout ce bloc).
            let reste = delta, j = iEvt + 1;
            while (reste > 1e-9 && j < voix.evenements.length && estSilence(voix.evenements[j])) {
                reste -= dureeEnNoires(voix.evenements[j].duree);
                j++;
            }
            const consomme = voix.evenements.slice(iEvt + 1, j).reduce((t, e) => t + dureeEnNoires(e.duree), 0);
            const aRendre = consomme - delta;
            voix.evenements.splice(iEvt + 1, j - (iEvt + 1),
                ...(aRendre > 1e-9 ? decouperEnEvenements(aRendre) : []));
        } else if (delta < -1e-9) {
            let libere = -delta, k = iEvt + 1;
            while (k < voix.evenements.length && estSilence(voix.evenements[k])) {
                libere += dureeEnNoires(voix.evenements[k].duree);
                k++;
            }
            voix.evenements.splice(iEvt + 1, k - (iEvt + 1), ...decouperEnEvenements(libere));
        }

        const { loc, resolu } = this._absorberEtLocaliser(iMesureDepart, iVoix, evenement);
        if (loc) { this.curseur.mesure = loc.mesure; this.curseur.evenement = loc.evenement; }
        else this.corrigerCurseur();
        if (!resolu) {
            this.derniereErreur = 'Cette mesure déborde et ne peut pas être répartie automatiquement '
                + '(une autre figure y dépasse déjà, à elle seule, une mesure entière).';
        }
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
        else { e.notes = []; e.silence = true; }
        this.prevenir('edition');
    }

    // -- Structure ---------------------------------------------------------------------------------

    /**
     * Insère un évènement APRÈS le courant et s'y place — le geste normal pour écrire à la suite.
     *
     * NE LAISSE JAMAIS UNE MESURE VISIBLEMENT DÉBORDER — mais ne REFUSE plus non plus l'insertion pour
     * autant : une version antérieure refusait tout net faute de place, ce qui bloquait l'écriture en
     * plein geste (retour direct : « je dois toujours pouvoir modifier comme je veux, toute la suite
     * doit se décaler »). L'évènement s'insère donc TOUJOURS à l'endroit demandé, et si la mesure
     * déborde du coup, l'excédent est aussitôt réparti dans une ou plusieurs mesures NEUVES juste
     * après (voir `_absorberEtLocaliser`) — jamais dans une mesure suivante déjà écrite, qu'il ne faut
     * pas déranger. Le curseur suit l'évènement qu'on vient d'insérer, où qu'il ait fini : dans la
     * mesure courante si tout tenait, dans une mesure neuve sinon. Un seul cas reste un refus pur et
     * simple : une durée qui, à elle seule, dépasse la capacité d'une mesure entière — aucune
     * répartition ne peut jamais l'y faire tenir.
     */
    insererEvenement() {
        this.derniereErreur = null;
        const capacite = capaciteMesure(this.partition, this.curseur.mesure);
        const dureeNouvel = dureeEnNoires(this.dureeCourante);
        if (dureeNouvel > capacite + 1e-9) {
            this.derniereErreur = 'Cette durée dépasse à elle seule la capacité d\'une mesure entière.';
            return false;
        }
        this.memoriser();
        const iMesureDepart = this.curseur.mesure;
        const iVoix = this.curseur.voix;
        const nouvel = creerEvenement({ ...this.dureeCourante }, [], { silence: true });
        this.voixCourante().evenements.splice(this.curseur.evenement + 1, 0, nouvel);
        // `resolu` est ici TOUJOURS vrai : `dureeNouvel` tient seule dans une mesure (vérifié
        // au-dessus), donc CET ajout ne peut jamais être la figure « impossible » d'une répartition.
        const { loc } = this._absorberEtLocaliser(iMesureDepart, iVoix, nouvel);
        if (loc) { this.curseur.mesure = loc.mesure; this.curseur.evenement = loc.evenement; }
        else this.corrigerCurseur();
        this._dernierChiffre = null;
        this.prevenir('edition');
        return true;
    }

    /**
     * Insère un évènement JUSTE AVANT le courant — le miroir d'`insererEvenement`, pour le clic droit
     * « insérer une note à gauche ». Le curseur suit l'évènement VISÉ au départ (celui qui glisse pour
     * laisser la place), pas la case neuve : contrairement à Entrée, ce geste n'est pas fait pour
     * continuer à écrire à la suite.
     *
     * Mêmes garanties qu'`insererEvenement` : n'insère jamais dans le vide, mais ne refuse plus non
     * plus faute de place — la mesure est répartie dans la foulée si l'ajout la fait déborder (voir
     * `_absorberEtLocaliser`), et l'évènement visé — qui a pu, lui, basculer dans une mesure neuve si
     * la répartition l'y a poussé — reste celui que le curseur suit.
     */
    insererAvant() {
        this.derniereErreur = null;
        const capacite = capaciteMesure(this.partition, this.curseur.mesure);
        const dureeNouvel = dureeEnNoires(this.dureeCourante);
        if (dureeNouvel > capacite + 1e-9) {
            this.derniereErreur = 'Cette durée dépasse à elle seule la capacité d\'une mesure entière.';
            return false;
        }
        this.memoriser();
        const iMesureDepart = this.curseur.mesure;
        const iVoix = this.curseur.voix;
        const cible = this.evenementCourant();   // celui qu'on vise — le curseur doit continuer à le suivre
        this.voixCourante().evenements.splice(this.curseur.evenement, 0, creerEvenement({ ...this.dureeCourante }, [], { silence: true }));
        const { loc } = this._absorberEtLocaliser(iMesureDepart, iVoix, cible);
        if (loc) { this.curseur.mesure = loc.mesure; this.curseur.evenement = loc.evenement; }
        else this.corrigerCurseur();
        this._dernierChiffre = null;
        this.prevenir('edition');
        return true;
    }

    /**
     * DIAGNOSTIC pur (aucune mutation) : ce qu'il faudrait GARDER dans la mesure `index`, voix par
     * voix, pour retomber exactement sur sa capacité, et ce qui DÉBORDERAIT. Partagé par
     * `corrigerDebordement` (commande autonome, Alt+R) et par tout ce qui édite EN DIRECT
     * (`insererEvenement`, `insererAvant`, `_essaierNouvelleDuree`) : ces derniers n'ont plus à
     * refuser une modification faute de place — ils l'appliquent, puis en confient l'éventuel
     * débordement à ce même mécanisme, dans leur propre geste (voir `_absorberEtLocaliser`).
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
                    gardes.push(...decouperEnEvenements(disponible));
                    enTrop.push(...decouperEnEvenements(d - disponible));
                } else {
                    enTrop.push(e);
                }
                total = capacite;   // la mesure est désormais pleine : plus rien après n'y tient
            }
            return { gardes, enTrop, totalEnTrop: enTrop.reduce((t, e) => t + dureeEnNoires(e.duree), 0) };
        });
        return {
            index, m, capacite, parVoix,
            deborde: parVoix.some(v => v.enTrop.length),
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
        m.voix.forEach((voix, i) => { voix.evenements = parVoix[i].gardes; });
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
                if (manque > 1e-9) evs.push(...decouperEnEvenements(manque));
            });
        });
        this.partition.mesures.splice(index + 1, 0, ...nouvelles);
    }

    /** Retrouve où un évènement précis (comparé par RÉFÉRENCE) a fini, dans une voix donnée, à partir
     *  d'un index de mesure — après une répartition, un évènement peut s'être déplacé dans une des
     *  mesures neuves. `null` s'il reste introuvable : n'arrive normalement que si `ref` était
     *  LUI-MÊME un silence qu'il a fallu raccourcir pour absorber le débordement (voir
     *  `_diagnostiquerDebordement`) — ce silence-là a alors été remplacé par des morceaux neufs,
     *  aucune référence ancienne n'y survit. Rien n'est pour autant perdu (la durée totale reste
     *  exacte), seulement l'identité de CET évènement précis ; l'appelant retombe alors sur
     *  `corrigerCurseur()`. */
    _localiserEvenement(ref, iVoix, depuisIndex) {
        for (let i = depuisIndex; i < this.partition.mesures.length; i++) {
            const voix = this.partition.mesures[i].voix[iVoix];
            if (!voix) continue;
            const j = voix.evenements.indexOf(ref);
            if (j !== -1) return { mesure: i, evenement: j };
        }
        return null;
    }

    /**
     * Absorbe un éventuel débordement de la mesure `iMesure` (voir `_diagnostiquerDebordement`) puis
     * relocalise `ref` — l'évènement que l'appelant vient de modifier ou d'insérer, qui a pu se
     * retrouver déplacé dans une mesure neuve si la répartition l'a fait basculer au-delà de la
     * capacité. Ne memorise ni ne prévient : l'appelant l'a déjà fait pour SON geste, avant d'appeler
     * ceci — la répartition en fait partie, pas une action séparée à annuler à part.
     *
     * @returns {{loc: {mesure, evenement}|null, resolu: boolean}} `loc` est la position où `ref` se
     *   trouve désormais (quasiment toujours non-nul : rien n'est jamais perdu, seulement déplacé).
     *   `resolu` est FAUX quand le débordement est IMPOSSIBLE à absorber (une figure, à elle seule,
     *   dépasse une mesure entière) — dans ce cas rien n'a été réparti, `ref` reste où l'appelant
     *   l'avait mis, et la mesure reste invalide : à l'appelant de le signaler (voir
     *   insererEvenement/insererAvant, qui n'arrivent normalement jamais dans ce cas puisqu'ils
     *   vérifient déjà que LEUR propre ajout tient seul dans une mesure, mais une AUTRE figure déjà
     *   présente pourrait, elle, être en cause).
     */
    _absorberEtLocaliser(iMesure, iVoix, ref) {
        const diag = this._diagnostiquerDebordement(iMesure);
        const resolu = !diag.deborde || !diag.impossible;
        if (diag.deborde && resolu) this._appliquerRepartition(diag);
        return { loc: this._localiserEvenement(ref, iVoix, iMesure), resolu };
    }

    /**
     * RÉPARE une mesure DÉJÀ trop pleine (déborde sa capacité) — commande AUTONOME (Alt+R), pour une
     * mesure devenue invalide par un autre chemin qu'une édition en direct (un fichier ouvert d'avant
     * ce garde-fou, par exemple) : rien ne la corrige toute seule, une mesure qui déborde ne dit
     * jamais d'elle-même où l'excédent devrait aller. Voir `_diagnostiquerDebordement`/
     * `_appliquerRepartition` pour le mécanisme, partagé avec l'édition en direct.
     */
    corrigerDebordement(index = this.curseur.mesure) {
        this.derniereErreur = null;
        const diag = this._diagnostiquerDebordement(index);
        if (!diag.deborde) return false;   // déjà valide, rien à faire
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
        voix.evenements.push(...decouperEnEvenements(dureeEnNoires(enleve.duree)));
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

    definirSignature(battements, unite) {
        this.memoriser();
        this.mesureCourante().signature = { battements, unite };
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

        for (const mesure of this.partition.mesures) {
            for (const voix of mesure.voix) {
                for (const evenement of voix.evenements) {
                    // Les cordes DÉJÀ prises dans cet accord, pour ne jamais en réutiliser une —
                    // relevées avant de toucher quoi que ce soit, sinon une note déplacée fausserait
                    // le relevé des suivantes.
                    const prises = new Set(evenement.notes.map(n => n.corde));
                    for (const note of evenement.notes) {
                        transposees++;
                        // LA HAUTEUR DONT ON PART est celle que la note VOULAIT sonner, quand une
                        // transposition précédente l'a laissée hors du manche : sa case a alors été
                        // rabattue au bord du manche, ce qui perd la hauteur réelle. Repartir de la
                        // case rabattue rendrait la transposition IRRÉVERSIBLE — monter de 5 puis
                        // redescendre de 5 ne rendait pas le morceau de départ, les notes rabattues
                        // revenant à une hauteur qui n'avait jamais été la leur. `hauteurVoulue`
                        // garde donc l'intention, et c'est elle qui se transpose.
                        const depart = note.hauteurVoulue ?? hauteurDeCase(accordage, note.corde, note.frette, capo);
                        const cible = depart + demiTons;
                        const surPlace = cible - cordes[note.corde] - capo;
                        if (surPlace >= 0 && surPlace <= casesMax) {
                            note.frette = surPlace;
                            delete note.horsManche;
                            delete note.hauteurVoulue;
                            continue;
                        }
                        // Corde de repli : celle qui joue la hauteur visée en restant sur le manche,
                        // la plus proche possible de la corde d'origine pour déranger le moins le doigté.
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
    basculerLien(lien) {
        const note = this.noteCourante();
        if (!note) return false;
        this.memoriser();
        note.lien = note.lien === lien ? null : lien;
        this.prevenir('edition');
        return true;
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
    definirInstrument(instrumentId) {
        if (!INSTRUMENTS[instrumentId]) return false;
        this.memoriser();
        this.partition.piste.instrument = instrumentId;
        this.partition.piste.accordage = accordageParDefaut(instrumentId);
        const max = this.partition.piste.accordage.cordes.length - 1;
        for (const m of this.partition.mesures) {
            for (const voix of m.voix) {
                for (const e of voix.evenements) {
                    e.notes = e.notes.filter(n => n.corde <= max);
                    if (!e.notes.length) e.silence = true;
                }
            }
        }
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
