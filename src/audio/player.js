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

// SON RÉEL (Sampler) + DOUBLURE SYNTHÉTISÉE — comme HarmoHub (voir son INSTRUMENT_BANKS.piano), plutôt
// que le synthé nu d'une version antérieure : une onde triangulaire brute, seule, sonne clairement
// synthétique, quand un vrai piano échantillonné (Salamander, la même bibliothèque publique que
// HarmoHub) donne un retour de saisie bien plus agréable à l'oreille sur des heures de travail.
//
// LA DOUBLURE N'EST PAS UN À-CÔTÉ : elle est ce qui joue tant que les 17 fichiers n'ont pas fini de
// charger, et surtout ce qui joue TOUJOURS si le réseau est absent ou trop lent (répétition hors
// ligne, connexion faible) — sans elle, l'appli resterait silencieuse par défaut sur ce genre de
// réseau : le transport avancerait, le curseur suivrait, et chaque note serait abandonnée en silence,
// sans le moindre message. Avec elle, le son est moins beau tant que l'échantillonneur n'a pas pris le
// relais, mais il EXISTE — et il reprend tout seul dès que les fichiers arrivent, sans rien à faire.
const PIANO_URLS = {
    C2: 'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3', A2: 'A2.mp3',
    C3: 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3', A3: 'A3.mp3',
    C4: 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3', A4: 'A4.mp3',
    C5: 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3', A5: 'A5.mp3',
    C6: 'C6.mp3',
};
const PIANO_BASE_URL = 'https://tonejs.github.io/audio/salamander/';
// L'échantillonneur (échantillons réels, déjà enregistrés à un niveau raisonnable) ne se recale pas —
// comme dans HarmoHub, dont le Piano garde un trim à 0 dB. La doublure synthétisée, elle, GARDE le
// recalage `TRIM_DB` déjà en place ci-dessus : c'est le même synthé qu'avant ce changement, au même
// niveau déjà éprouvé, pas une valeur importée d'ailleurs pour une enveloppe qui n'est pas la sienne.
const SAMPLER_TRIM_DB = 0;

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

        // La DOUBLURE synthétisée d'abord — c'est elle qui joue tant que l'échantillonneur n'a pas
        // fini de charger, voir plus haut. Onde triangulaire filtrée passe-bas, enveloppe percussive à
        // longue extinction : ça n'imite pas un piano, mais ça donne une hauteur nette et une attaque
        // franche pendant l'attente, jamais un silence complet.
        const filtreDoublure = new Tone.Filter({ type: 'lowpass', frequency: 3600, Q: 0.5 });
        const volumeDoublure = new Tone.Volume(TRIM_DB);
        const doublure = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.006, decay: 0.42, sustain: 0.14, release: 1.1 },
        });
        doublure.maxPolyphony = 16;
        doublure.chain(filtreDoublure, volumeDoublure, Tone.Destination);

        // Puis le vrai PIANO échantillonné — la même bibliothèque publique (Salamander) que HarmoHub,
        // hébergée par le projet Tone.js lui-même. Un échec de téléchargement (hors ligne, réseau trop
        // lent, hôte bloqué) ne doit surtout pas remonter en exception non gérée : c'est un cas ATTENDU,
        // la doublure ci-dessus s'en charge déjà.
        const volumeSampler = new Tone.Volume(SAMPLER_TRIM_DB);
        const sampler = new Tone.Sampler({
            urls: PIANO_URLS,
            baseUrl: PIANO_BASE_URL,
            release: 1,
            onerror: () => {},
        });
        sampler.chain(volumeSampler, Tone.Destination);

        // Une interface UNIQUE, qui choisit elle-même qui joue : tout le reste du fichier (programmer,
        // apercu) continue d'appeler `this.synthe.triggerAttackRelease(...)` sans rien savoir de ce qui
        // sonne derrière — l'échantillonneur dès qu'il est prêt, la doublure sinon, et le relais se fait
        // tout seul dès que les fichiers arrivent, sans rien à reprogrammer.
        this.synthe = {
            get charge() { return sampler.loaded; },
            triggerAttackRelease(...args) {
                (sampler.loaded ? sampler : doublure).triggerAttackRelease(...args);
                return this;
            },
            releaseAll() {
                // `releaseAll` de Sampler peut lever tant qu'aucun échantillon n'a encore joué —
                // jamais un prétexte pour laisser la doublure, elle, sonner indéfiniment.
                try { sampler.releaseAll(); } catch (e) { /* rien à relâcher pour l'instant */ }
                doublure.releaseAll();
                return this;
            },
        };
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

        // « L'évènement suivant/précédent » se cherche DANS LA MÊME VOIX, jamais à l'index voisin
        // du tableau à plat : `aplatir` groupe ses entrées par mesure PUIS par voix, donc le voisin
        // immédiat du DERNIER évènement de la voix 0 d'une mesure est le PREMIER évènement de la
        // voix 1 de cette même mesure — pas la suite logique de la mélodie. Une liaison de
        // prolongation ou la nuance d'un hammer-on cherchée par simple ±1 s'accrocherait alors à la
        // mauvaise voix dès qu'une mesure en porte deux. Filtrer par voix conserve l'ordre
        // chronologique (mesures visitées dans l'ordre, voix dans l'ordre à chaque mesure), donc
        // relier chaque entrée à sa suivante/précédente DANS CETTE LISTE FILTRÉE donne la bonne suite.
        const parVoix = new Map();
        for (const entree of plat) {
            if (!parVoix.has(entree.voix)) parVoix.set(entree.voix, []);
            parVoix.get(entree.voix).push(entree);
        }
        const suivantMemeVoix = new Map();
        const precedentMemeVoix = new Map();
        for (const liste of parVoix.values()) {
            for (let k = 0; k < liste.length; k++) {
                if (k + 1 < liste.length) suivantMemeVoix.set(liste[k], liste[k + 1]);
                if (k > 0) precedentMemeVoix.set(liste[k], liste[k - 1]);
            }
        }

        plat.forEach((entree) => {
            const evenement = entree.ref;
            if (evenement.silence || !evenement.notes.length) return;

            for (const note of evenement.notes) {
                const cle = `${entree.mesure}:${entree.voix}:${entree.evenement}:${note.corde}`;
                if (consommees.has(cle)) continue;

                const midi = hauteurDeNote(partition, note);
                if (midi == null) continue;

                // Prolonge tant que la chaîne de liaisons continue sur la même corde, DANS LA MÊME VOIX.
                let duree = entree.duree;
                let courante = note, suivante = suivantMemeVoix.get(entree);
                while (courante.lien === 'tie' && suivante) {
                    const noteSuivante = suivante.ref.notes.find(n => n.corde === note.corde);
                    if (!noteSuivante) break;
                    consommees.add(`${suivante.mesure}:${suivante.voix}:${suivante.evenement}:${note.corde}`);
                    duree += suivante.duree;
                    courante = noteSuivante;
                    suivante = suivantMemeVoix.get(suivante);
                }

                // NUANCE D'UN HAMMER-ON : c'est la note d'ARRIVÉE qui sonne plus doucement, pas celle
                // de départ. Le champ `lien` décrit ce qui va vers la SUIVANTE ; le lire sur la note
                // courante — comme le faisait une première version — atténuait donc exactement la
                // mauvaise des deux : celle qu'on vient d'attaquer à la main droite, à pleine force.
                const entreePrecedente = precedentMemeVoix.get(entree);
                const precedente = entreePrecedente ? entreePrecedente.ref.notes.find(n => n.corde === note.corde) : null;
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
