// Lecteur audio — synthèse Tone.js et tête de lecture.
//
// PRINCIPE : la partition est programmée D'AVANCE, entièrement, sur l'horloge de Tone.js, puis la
// position de lecture est LUE sur cette même horloge à chaque image d'animation. L'alternative
// (déclencher les notes depuis un setInterval JavaScript) dérive audiblement au bout de quelques
// mesures : le fil principal est interrompu par le rendu, la récupération mémoire, un clic de
// l'utilisateur — alors que l'horloge audio, elle, ne s'arrête jamais.
//
// C'est ce qui garantit aussi que LE TRAIT SUIT CE QU'ON ENTEND : le trait ne s'anime pas sur une
// minuterie parallèle, il lit la position réelle du transport audio. Les deux ne peuvent pas diverger.

import { midiVersNomTone } from '../model/theory.js';
import { aplatir, hauteurDeNote, dureeTotale } from '../model/score.js';
import { dureeEnNoires } from '../model/duration.js';

/** Réduction du volume par rapport au 0 dB de Tone.js : une polyphonie à six voix sature vite. */
const TRIM_DB = -9;

export class Lecteur {
    constructor() {
        this.pret = false;
        this.synthe = null;
        this.etat = 'arret';          // 'arret' | 'lecture' | 'pause'
        this.position = 0;            // en noires depuis le début du morceau
        this.duree = 0;
        this.auditeurs = new Set();
        this._boucleAnim = null;
        this._evenements = [];
    }

    surPosition(fn) { this.auditeurs.add(fn); return () => this.auditeurs.delete(fn); }
    _prevenir() { for (const fn of this.auditeurs) fn(this.position, this.etat); }

    /**
     * Prépare le contexte audio. DOIT être appelé depuis un geste de l'utilisateur : tout navigateur
     * refuse de démarrer un contexte audio autrement, et l'appel silencieux échoue sans erreur — le
     * bouton « lecture » paraît alors simplement cassé.
     */
    async demarrer() {
        if (this.pret) return;
        const Tone = globalThis.Tone;
        if (!Tone) throw new Error('Tone.js absent : vérifiez vendor/tone.min.js dans index.html.');
        await Tone.start();
        // Marge d'anticipation réduite comme dans HarmoHub : les 100 ms par défaut se perçoivent comme
        // un temps mort au lancement, et 20 ms suffisent amplement pour des notes programmées.
        Tone.context.lookAhead = 0.02;

        // Un synthé simple pour la V1, comme demandé : une onde triangulaire filtrée passe-bas,
        // enveloppe percussive à longue extinction. Ça n'imite pas une guitare — mais ça donne une
        // hauteur nette et une attaque franche, ce qu'on demande à un retour de saisie. Un échantillon
        // de guitare serait plus juste et pèserait plusieurs mégaoctets à vendorer.
        const filtre = new Tone.Filter({ type: 'lowpass', frequency: 3600, Q: 0.5 });
        const volume = new Tone.Volume(TRIM_DB);
        this.synthe = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.006, decay: 0.42, sustain: 0.14, release: 1.1 },
        });
        this.synthe.maxPolyphony = 16;
        this.synthe.chain(filtre, volume, Tone.Destination);
        this.pret = true;
    }

    /**
     * Programme la partition entière sur le transport.
     *
     * LES LIAISONS DE PROLONGATION SONT FUSIONNÉES ICI : une note liée à la suivante ne se rejoue pas,
     * elle prolonge la première. Programmer les deux séparément produirait une réattaque parfaitement
     * audible à l'endroit exact où la notation dit qu'il ne doit pas y en avoir. Hammer-on et pull-off
     * sont, eux, bien REJOUÉS — plus doucement : ce sont des attaques, simplement pas à la main droite.
     */
    programmer(partition) {
        const Tone = globalThis.Tone;
        Tone.Transport.cancel();
        Tone.Transport.bpm.value = partition.meta.tempo || 120;

        const plat = aplatir(partition);
        this.duree = dureeTotale(partition);
        const consommees = new Set();
        this._evenements = [];

        plat.forEach((entree, i) => {
            const evenement = entree.ref;
            if (evenement.silence || !evenement.notes.length) return;

            for (const note of evenement.notes) {
                const cle = `${i}:${note.corde}`;
                if (consommees.has(cle)) continue;

                const midi = hauteurDeNote(partition, note);
                if (midi == null) continue;

                // Prolonge tant que la chaîne de liaisons continue sur la même corde.
                let duree = entree.duree;
                let j = i, courante = note;
                while (courante.lien === 'tie' && j + 1 < plat.length) {
                    const suivante = plat[j + 1].ref.notes.find(n => n.corde === note.corde);
                    if (!suivante) break;
                    j += 1;
                    consommees.add(`${j}:${note.corde}`);
                    duree += plat[j].duree;
                    courante = suivante;
                }

                // NUANCE D'UN HAMMER-ON : c'est la note d'ARRIVÉE qui sonne plus doucement, pas celle
                // de départ. Le champ `lien` décrit ce qui va vers la SUIVANTE ; le lire sur la note
                // courante — comme le faisait une première version — atténuait donc exactement la
                // mauvaise des deux : celle qu'on vient d'attaquer à la main droite, à pleine force.
                const precedente = i > 0 ? plat[i - 1].ref.notes.find(n => n.corde === note.corde) : null;
                const obtenueSansAttaque = precedente && ['hammer', 'pull', 'slide'].includes(precedente.lien);
                let velocite = evenement.accent ? 1 : 0.78;
                if (obtenueSansAttaque) velocite *= 0.62;
                if (note.ghost) velocite *= 0.35;
                // Palm mute et staccato écourtent la note sans en changer la place : c'est bien ce que
                // font ces deux gestes sur l'instrument.
                let sonnante = duree;
                if (evenement.palmMute) sonnante = Math.min(sonnante, duree * 0.34);
                if (evenement.staccato) sonnante = Math.min(sonnante, duree * 0.5);

                this._evenements.push({
                    debut: entree.debut,
                    duree: Math.max(0.05, sonnante),
                    note: midiVersNomTone(midi),
                    velocite: Math.max(0.05, Math.min(1, velocite)),
                });
            }
        });

        // PROGRAMMATION EN TICKS, PAS EN SECONDES. Le transport de Tone.js compte en tics musicaux
        // (PPQ par noire) ; une position en tics ne dépend donc PAS du tempo. Programmer en secondes,
        // comme le faisait une première version, fige le tempo au moment du calcul : tirer le curseur
        // de BPM pendant la lecture accélérait bien l'horloge, mais les notes restaient scellées à
        // leurs anciennes secondes et se désynchronisaient aussitôt. En tics, changer le tempo réétire
        // tout — la partition et ce qu'on entend — sans qu'il y ait rien à reprogrammer.
        const PPQ = Tone.Transport.PPQ;
        for (const e of this._evenements) {
            const ticksDuree = Math.max(1, Math.round(e.duree * PPQ));
            Tone.Transport.schedule((temps) => {
                // La DURÉE, elle, doit bien être en secondes au moment du déclenchement : on la
                // convertit ici, donc au tempo courant, et non à celui d'il y a une minute.
                this.synthe.triggerAttackRelease(e.note, Tone.Ticks(ticksDuree).toSeconds(), temps, e.velocite);
            }, `${Math.round(e.debut * PPQ)}i`);
        }

        // Arrêt net à la fin du morceau plutôt qu'un transport qui tourne dans le vide.
        Tone.Transport.schedule(() => { this.arreter(); }, `${Math.round((this.duree + 0.05) * PPQ)}i`);
    }

    async jouer(partition, depuis = null) {
        await this.demarrer();
        const Tone = globalThis.Tone;
        if (this.etat === 'lecture') return;
        if (this.etat === 'arret' || depuis !== null) {
            this.programmer(partition);
            Tone.Transport.ticks = Math.round((depuis ?? 0) * Tone.Transport.PPQ);
        }
        Tone.Transport.start();
        this.etat = 'lecture';
        this._suivre();
        this._prevenir();
    }

    pause() {
        const Tone = globalThis.Tone;
        if (this.etat !== 'lecture') return;
        Tone.Transport.pause();
        this.synthe?.releaseAll?.();
        this.etat = 'pause';
        this._arreterSuivi();
        this._prevenir();
    }

    arreter() {
        const Tone = globalThis.Tone;
        if (Tone) { Tone.Transport.stop(); Tone.Transport.ticks = 0; }
        this.synthe?.releaseAll?.();
        this.etat = 'arret';
        this.position = 0;
        this._arreterSuivi();
        this._prevenir();
    }

    /** Ajustement du tempo EN COURS de lecture : Tone.js réétire l'horloge, rien à reprogrammer. */
    definirTempo(bpm) {
        const Tone = globalThis.Tone;
        if (Tone) Tone.Transport.bpm.value = Math.max(20, Math.min(400, bpm));
    }

    /**
     * Suivi de la tête de lecture, sur requestAnimationFrame plutôt que sur une minuterie : la position
     * est ainsi relue une fois par IMAGE affichée, jamais plus (inutile) ni moins (saccadé).
     */
    _suivre() {
        const Tone = globalThis.Tone;
        this._arreterSuivi();
        const tic = () => {
            if (this.etat !== 'lecture') return;
            // Position lue en TICS puis convertie en noires : exacte quel que soit le tempo, et
            // insensible à un changement de tempo en cours de route.
            this.position = Tone.Transport.ticks / Tone.Transport.PPQ;
            this._prevenir();
            this._boucleAnim = requestAnimationFrame(tic);
        };
        this._boucleAnim = requestAnimationFrame(tic);
    }

    _arreterSuivi() {
        if (this._boucleAnim) cancelAnimationFrame(this._boucleAnim);
        this._boucleAnim = null;
    }

    /** Note isolée, pour le retour sonore à la saisie. Silencieux tant que l'audio n'est pas armé. */
    apercu(midi, velocite = 0.7) {
        if (!this.pret || !this.synthe) return;
        this.synthe.triggerAttackRelease(midiVersNomTone(midi), 0.35, undefined, velocite);
    }
}
