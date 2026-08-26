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
    signatureEffective, armureEffective, nbCordes, dureeEcrite, capaciteMesure, decouperEnEvenements, MAX_VOIX,
} from '../model/score.js';
import { dureeEnNoires, noiresParMesure, VALEURS_FIGURES } from '../model/duration.js';
import { INSTRUMENTS, accordageParDefaut, accordagePredefini, identifierAccordage } from '../model/instruments.js';

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
        if (existante) existante.frette = frette;
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
     * LE RYTHME DE LA MESURE RESTE STRICT — JAMAIS DE DÉPASSEMENT, MÊME TEMPORAIRE. Si l'évènement
     * s'allonge, le temps gagné DOIT venir des silences qui suivent immédiatement dans la même voix ;
     * s'il n'y en a pas assez avant la fin de la voix ou avant la prochaine note, le changement est
     * REFUSÉ TOUT ENTIER — aucune mutation, aucun memoriser() — plutôt qu'appliqué à moitié : une
     * mesure à 4/4 ne doit jamais pouvoir en porter 5, ne serait-ce qu'un instant. `derniereErreur`
     * porte alors le pourquoi (voir main.js, qui l'affiche). Une version antérieure appliquait le
     * changement quand même et se contentait de signaler après coup la mesure devenue fausse ; le
     * résultat — une mesure qui s'étire hors de toute proportion, bien visible à l'écran — s'est
     * révélé pire que le refus. Si l'évènement raccourcit, le temps libéré redevient un silence juste
     * après (fusionné à celui qui s'y trouve déjà) : dans ce sens-là, il n'y a jamais de risque de
     * déborder, donc jamais lieu de refuser.
     *
     * N'appelle PAS prevenir() : à l'appelant de le faire, une fois qu'il a fini de poser ses propres
     * champs (dureeCourante, par exemple), pour ne prévenir qu'une seule fois par geste.
     */
    _essaierNouvelleDuree(nouvelleDuree) {
        this.derniereErreur = null;
        const voix = this.voixCourante();
        const iEvt = this.curseur.evenement;
        const evenement = voix.evenements[iEvt];
        const ancienne = dureeEnNoires(evenement.duree);
        const nouvelle = dureeEnNoires(nouvelleDuree);
        const delta = nouvelle - ancienne;
        const estSilence = (e) => e.silence || !e.notes.length;

        // On calcule D'ABORD, SANS RIEN MODIFIER, si un allongement peut être entièrement absorbé —
        // c'est ce qui permet de REFUSER proprement plutôt que de devoir défaire un changement à
        // moitié fait.
        let j = iEvt + 1;
        if (delta > 1e-9) {
            let reste = delta;
            while (reste > 1e-9 && j < voix.evenements.length && estSilence(voix.evenements[j])) {
                reste -= dureeEnNoires(voix.evenements[j].duree);
                j++;
            }
            if (reste > 1e-9) {
                this.derniereErreur = 'Pas assez de place dans la mesure pour cette durée.';
                return false;
            }
        }

        this.memoriser();
        evenement.duree = nouvelleDuree;

        if (delta > 1e-9) {
            // `j` s'est déjà arrêté ci-dessus au bon endroit (la vérification l'a calculé) : ce que
            // les silences de iEvt+1 à j totalisent, moins ce qu'il fallait, est à rendre.
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
     * NE DÉBORDE PLUS JAMAIS LA MESURE — une version antérieure insérait sans condition, ce qui
     * pouvait faire grimper une mesure à 4/4 bien au-delà de 4 temps si on continuait d'appuyer sur
     * Entrée (exactement le défaut signalé : une mesure à 13 temps qui ne se corrigeait jamais
     * d'elle-même). Le même principe que `_essaierNouvelleDuree` s'applique désormais ici : si le
     * nouvel évènement ne rentre pas, on ne le glisse PAS de force dans la mesure courante.
     *
     * DEUX CAS : en bout de voix (le geste normal pour continuer d'écrire), une mesure TOUTE NEUVE
     * s'insère juste après la courante — jamais la mesure suivante existante, même si elle a de la
     * place : elle pourrait déjà contenir autre chose, et la remplir par surprise déplacerait de la
     * musique déjà écrite sans le dire. La nouvelle mesure reçoit la capacité EFFECTIVE de cet endroit
     * du morceau (jamais le 4 temps par défaut de `creerMesure`, qui suppose du 4/4 et fausserait tout
     * de suite une insertion en 3/4 ou 6/8), et prend le même nombre de voix que la mesure courante —
     * les voix qu'on ne remplit pas restent un silence unique couvrant toute la mesure, l'état normal
     * d'une voix qu'on n'a pas encore touchée. Au milieu d'une voix (on intercale une nouvelle case
     * entre deux existantes), avancer d'une mesure n'aurait aucun sens — on refuse proprement.
     */
    insererEvenement() {
        this.derniereErreur = null;
        const voix = this.voixCourante();
        const capacite = capaciteMesure(this.partition, this.curseur.mesure);
        const dejaEcrit = dureeEcrite(this.mesureCourante(), this.curseur.voix);
        const dureeNouvel = dureeEnNoires(this.dureeCourante);
        if (dureeNouvel > capacite + 1e-9) {
            this.derniereErreur = 'Cette durée dépasse à elle seule la capacité d\'une mesure entière.';
            return false;
        }
        let mesureFraiche = false;
        if (dejaEcrit + dureeNouvel > capacite + 1e-9) {
            const enBoutDeVoix = this.curseur.evenement === voix.evenements.length - 1;
            if (!enBoutDeVoix) {
                this.derniereErreur = 'Pas assez de place dans la mesure pour insérer cette figure ici.';
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
        } else {
            this.memoriser();
        }
        const voixCible = this.voixCourante();
        voixCible.evenements.splice(this.curseur.evenement + 1, 0, creerEvenement({ ...this.dureeCourante }, [], { silence: true }));
        this.curseur.evenement += 1;
        // Une voix fraîchement créée est vide avant cette ligne (voir plus haut) : compléter par un
        // silence jusqu'à la capacité, pour que l'invariant (une voix somme toujours EXACTEMENT sa
        // mesure) tienne dès la création plutôt que de dépendre d'une prochaine édition pour se vérifier.
        if (mesureFraiche) {
            const manque = capacite - dureeNouvel;
            if (manque > 1e-9) voixCible.evenements.push(...decouperEnEvenements(manque));
        }
        this._dernierChiffre = null;
        this.prevenir('edition');
        return true;
    }

    /**
     * RÉPARE une mesure DÉJÀ trop pleine (déborde sa capacité) en déplaçant l'excédent, tel quel,
     * dans une ou plusieurs mesures NEUVES insérées juste après — sans perdre une seule note.
     *
     * POURQUOI CETTE COMMANDE EXISTE. Le déroulement en direct (`insererEvenement`, `appliquerDuree`…)
     * refuse désormais tout ce qui déborderait — voir leurs commentaires respectifs — mais une mesure
     * qui a débordé PAR UN AUTRE CHEMIN (un fichier ouvert d'avant ce garde-fou, par exemple) reste
     * invalide indéfiniment : rien ne la corrige toute seule, une mesure qui déborde ne dit jamais
     * d'elle-même où l'excédent devrait aller (nouvelle mesure ? changement de chiffrage ? fusion avec
     * la suivante ?). Cette commande incarne la réponse la plus sûre et la plus prévisible : couper au
     * bord de la capacité et continuer juste après, comme si la musique avait été écrite sur plusieurs
     * mesures depuis le début.
     *
     * CHAQUE VOIX EST TRAITÉE SÉPARÉMENT, mais le nombre de mesures neuves nécessaires est le MÊME
     * pour toutes (le maximum entre elles) : une voix qui a moins besoin d'être répartie complète
     * simplement le reliquat par du silence, pour rester à la capacité exacte dans les mesures neuves
     * comme partout ailleurs.
     */
    corrigerDebordement(index = this.curseur.mesure) {
        this.derniereErreur = null;
        const m = this.partition.mesures[index];
        const capacite = capaciteMesure(this.partition, index);
        const parVoix = m.voix.map(voix => {
            let total = 0;
            const gardes = [];
            const enTrop = [];
            for (const e of voix.evenements) {
                const d = dureeEnNoires(e.duree);
                (total + d <= capacite + 1e-9 ? gardes : enTrop).push(e);
                if (total + d <= capacite + 1e-9) total += d;
            }
            return { gardes, enTrop, totalEnTrop: enTrop.reduce((t, e) => t + dureeEnNoires(e.duree), 0) };
        });
        if (!parVoix.some(v => v.enTrop.length)) return false;   // déjà valide, rien à faire
        if (parVoix.some(v => v.enTrop.some(e => dureeEnNoires(e.duree) > capacite + 1e-9))) {
            this.derniereErreur = 'Une figure de cette mesure dépasse à elle seule la capacité d\'une mesure entière — impossible à répartir automatiquement.';
            return false;
        }

        this.memoriser();
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
        this.corrigerCurseur();
        this.prevenir('edition');
        return true;
    }

    supprimerEvenement() {
        const voix = this.voixCourante();
        if (voix.evenements.length <= 1) return this.basculerSilence();
        this.memoriser();
        voix.evenements.splice(this.curseur.evenement, 1);
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

    definirArmure(armure) {
        this.memoriser();
        this.mesureCourante().armure = armure;
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
