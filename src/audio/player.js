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
import { aplatir, hauteurDeNote, dureeTotale, signatureEffective, capaciteMesure, positionDebutMesure } from '../model/score.js';
import { dureeEnNoires, uniteDeGroupement } from '../model/duration.js';

/** Réduction du volume par rapport au 0 dB de Tone.js : une polyphonie à six voix sature vite. */
const TRIM_DB = -9;

/**
 * Pourcentage (0-100, plus intuitif qu'un dB) -> décibels, comme HarmoHub : un plancher à -40 dB
 * pour que « presque muet » reste audible sans à-coup plutôt que de couper d'un coup, silence vrai
 * uniquement à 0.
 */
function pourcentVersDb(pourcent) {
    return pourcent <= 0 ? -Infinity : -40 + (pourcent / 100) * 40;
}

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
        // Métronome pendant la lecture — voir HarmoHub (METRONOME_KEY/METRONOME_SUBDIVISION_KEY) :
        // désactivé par défaut dans les deux cas, une préférence explicite, pas un bruit permanent
        // qu'il faudrait couper à chaque lancement. La persistance (localStorage) est du ressort de
        // main.js, comme le tempo ou le zoom — ce module ne connaît que l'état courant.
        this.metronomeActif = false;
        this.metronomeSubdivision = false;
        // Boucle de lecture (barre orange glissée sous la TAB, voir main.js#marquesBoucle/
        // gesteBoucle*) : {debut, fin}, en INDEX DE MESURE, fin comprise — ou null, aucune boucle.
        // Un état de SESSION, comme metronomeActif juste au-dessus, jamais écrit dans le .json ni
        // dans localStorage : HarmoHub (dont ce geste est repris) ne le fait pas non plus — une
        // boucle qui survivrait en silence à un rechargement rouvrirait l'appli en train de rejouer
        // indéfiniment quatre mesures sans que rien ne l'explique.
        this.boucleLecture = null;
        // Volumes (0-100), comme HarmoHub : un pourcentage se règle au jugé, un dB se calcule. 100 =
        // plein volume (0 dB), 80 par défaut pour le métronome — un repère qu'on entend, jamais celui
        // qu'on écoute. Les DEUX s'appliquent MÊME AVANT `demarrer()` (l'utilisateur peut ouvrir les
        // Réglages avant tout premier clic sur Lecture) : les accesseurs ci-dessous n'écrivent sur
        // Tone.Destination/this.metronome que s'ils existent déjà, et demarrer() rejoue les deux
        // valeurs mémorisées une fois le contexte audio prêt, pour ne jamais perdre un réglage posé
        // trop tôt. Persistance (localStorage) du ressort de main.js, comme le reste de ce bloc.
        this.volumeGeneral = 100;
        this.volumeMetronome = 80;
    }

    surPosition(fn) { this.auditeurs.add(fn); return () => this.auditeurs.delete(fn); }
    _prevenir() { for (const fn of this.auditeurs) fn(this.position, this.etat); }

    /**
     * Volume général (0-100) : agit sur `Tone.Destination`, donc sur TOUT ce qui sonne — notes ET
     * métronome — sans changer leur équilibre relatif l'un par rapport à l'autre (voir
     * `volumeMetronome`, qui lui n'agit que sur le second).
     */
    definirVolumeGeneral(pourcent) {
        this.volumeGeneral = pourcent;
        const Tone = globalThis.Tone;
        if (Tone?.Destination) Tone.Destination.volume.value = pourcentVersDb(pourcent);
    }

    /** Volume du métronome seul (0-100) — relatif au volume général ci-dessus, jamais au-dessus. */
    definirVolumeMetronome(pourcent) {
        this.volumeMetronome = pourcent;
        if (this.metronome) this.metronome.volume.value = pourcentVersDb(pourcent);
    }

    /**
     * REMET L'AUDIO EN MARCHE À CHAQUE GESTE, sur téléphone — la parade au silence total d'iOS.
     *
     * Safari iOS n'autorise la mise en marche d'un contexte audio que DANS la pile d'appel d'un vrai
     * geste utilisateur, et il SUSPEND ce contexte dès qu'on quitte l'application, qu'un appel arrive
     * ou que l'écran se verrouille — ce qui arrive sans cesse sur un téléphone. Sans ce rattrapage,
     * l'application redevenait définitivement muette au retour : le transport avançait, le trait
     * suivait, et pas un son ne sortait jusqu'au rechargement de la page.
     *
     * Branché sur TOUT geste, où qu'il tombe (pas seulement sur Lecture) : le tout premier geste de
     * la session est souvent un tap qui ne joue rien — poser le curseur, ouvrir un menu — et c'est
     * pourtant CELUI-LÀ qu'iOS compte. On ne se débranche jamais et on ne retient jamais « c'est
     * fait » : la vérification coûte une comparaison de chaîne, et se répare toute seule à chaque
     * suspension suivante. Repris tel quel de HarmoHub, où le même défaut avait été vécu et corrigé.
     */
    brancherReveilAudio() {
        const reveiller = () => {
            try {
                const Tone = globalThis.Tone;
                if (Tone && Tone.getContext().rawContext.state !== 'running') Tone.start().catch(() => {});
            } catch (e) { /* contexte pas encore créé : le prochain geste réessaiera */ }
        };
        document.addEventListener('pointerdown', reveiller, { passive: true });
        document.addEventListener('touchend', reveiller, { passive: true });
        // Retour dans l'application après l'avoir quittée : on tente sans attendre un geste. iOS peut
        // refuser hors geste utilisateur — le prochain toucher s'en chargera alors — mais quand ça
        // passe, la lecture remarche sans que l'utilisateur ait rien à comprendre.
        document.addEventListener('visibilitychange', () => { if (!document.hidden) reveiller(); });
    }

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
        // LA VOIX DE BEND — monophonique, et à part. Un bend est le SEUL effet dont la hauteur bouge
        // PENDANT que la note sonne, et ni Tone.Sampler ni Tone.PolySynth n'offrent la moindre prise
        // sur la hauteur d'une voix déjà attaquée (vérifié sur la version vendue : `detune` absent de
        // l'un comme de l'autre, aucun signal rampable). Seul `Tone.Synth`, monophonique, expose une
        // `frequency` que l'on peut faire glisser — c'est donc lui, et lui seul, qui joue les notes
        // bendées, avec une vraie rampe de hauteur.
        //
        // CE QUE ÇA COÛTE, EN TOUTE FRANCHISE : une note bendée n'a pas le timbre du piano
        // échantillonné, mais celui de cette onde (la même recette que la doublure ci-dessus, pour
        // détonner le moins possible). C'est le prix d'un bend RÉELLEMENT entendu comme un
        // glissement de hauteur, plutôt que d'une note plaquée qui ne bouge pas — ce qui était
        // exactement le défaut signalé (« à la lecture je n'entends rien »).
        //
        // Monophonique parce qu'un bend simultané sur deux cordes est rare, et qu'une voix unique
        // évite d'allouer/détruire un synthé à chaque note bendée.
        const filtreBend = new Tone.Filter({ type: 'lowpass', frequency: 3600, Q: 0.5 });
        const volumeBend = new Tone.Volume(TRIM_DB);
        this.voixBend = new Tone.Synth({
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.006, decay: 0.42, sustain: 0.14, release: 1.1 },
        });
        this.voixBend.chain(filtreBend, volumeBend, Tone.Destination);

        // LE MÉTRONOME — repris de HarmoHub (METRONOME_SOUNDS.click) : un triangle bref, sans
        // sustain, qui s'éteint avant même la double-croche la plus rapide de la partition. Une voix
        // à part, comme le bend : elle doit pouvoir sonner MÊME quand le morceau lui-même est
        // silencieux à cet instant (un contretemps, une mesure de silence).
        this.metronome = new Tone.Synth({
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
        }).toDestination();

        // Rejoue les DEUX volumes déjà mémorisés (valeur par défaut, ou déjà réglés par
        // l'utilisateur avant ce tout premier `demarrer()`, voir definirVolumeGeneral/Metronome et
        // leur commentaire dans le constructeur) : Tone.Destination existe dès l'import, mais
        // `this.metronome` vient tout juste d'être créé ci-dessus — sans ce rattrapage, un réglage
        // posé avant la toute première lecture serait mémorisé sans jamais s'entendre.
        this.definirVolumeGeneral(this.volumeGeneral);
        this.definirVolumeMetronome(this.volumeMetronome);

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
                    // Le BEND voyage jusqu'à la programmation en DEMI-TONS, pas en nom de note : c'est
                    // d'une hauteur qui GLISSE qu'il s'agit, et une rampe se calcule en fréquence (voir
                    // la voix de bend, plus bas). `null` quand la note n'est pas bendée — le cas courant.
                    bend: note.bend ? { midi, demiTons: note.bend.demiTons } : null,
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
                const secondes = Tone.Ticks(ticksDuree).toSeconds();
                if (e.bend) this._jouerBend(e, secondes, temps);
                else this.synthe.triggerAttackRelease(e.note, secondes, temps, e.velocite);
            }, `${Math.round(e.debut * PPQ)}i`);
        }

        if (this.metronomeActif) this._programmerMetronome(partition, PPQ);

        // Arrêt net à la fin du morceau plutôt qu'un transport qui tourne dans le vide — sans effet
        // si une boucle est active (voir _appliquerBoucle juste en dessous) : les tics du transport
        // ne traversent alors plus jamais cette position, ce point d'arrêt reste programmé mais
        // inatteignable, exactement comme prévu.
        Tone.Transport.schedule(() => { this.arreter(); }, `${Math.round((this.duree + 0.05) * PPQ)}i`);

        this._appliquerBoucle(partition, PPQ);
    }

    /**
     * Définit (ou étend/déplace) la boucle de lecture sur [mesureDebut, mesureFin] (fin comprise).
     * Appelable À TOUT MOMENT, lecture en cours ou non — glisser la barre PENDANT que ça joue doit
     * faire sentir le nouveau bornage tout de suite, pas seulement au prochain démarrage : on ne
     * passe donc pas par programmer() ici (qui annulerait puis reprogrammerait TOUTES les notes,
     * un à-coup audible), seul le point de bouclage de l'horloge bouge.
     */
    definirBoucle(partition, mesureDebut, mesureFin) {
        const r = this.boucleLecture;
        // Rien de changé -> rien à refaire (glisser la barre déclenche ceci à chaque évènement de
        // pointeur ; sans ce garde-fou, la MÊME plage réécrirait Transport.loopStart/loopEnd à
        // chaque micro-mouvement du doigt, pour un résultat identique).
        if (r && r.debut === mesureDebut && r.fin === mesureFin) return;
        this.boucleLecture = { debut: mesureDebut, fin: mesureFin };
        const Tone = globalThis.Tone;
        if (Tone?.Transport) this._appliquerBoucle(partition, Tone.Transport.PPQ);
    }

    /** Retire la boucle : la lecture continue tout droit au lieu de rebrousser chemin. */
    retirerBoucle() {
        this.boucleLecture = null;
        const Tone = globalThis.Tone;
        if (Tone?.Transport) Tone.Transport.loop = false;
    }

    /**
     * Pose les deux bornes natives de l'horloge audio (Tone.Transport.loop/loopStart/loopEnd)
     * d'après `this.boucleLecture`, en TICS — jamais en secondes, pour rester cohérent avec le reste
     * de la programmation (voir programmer : une position en tics ne dépend pas du tempo, un
     * changement de BPM pendant une boucle ne la fait donc ni dériver ni changer de longueur).
     *
     * EPSILON D'UN TIC SUR LES DEUX BORNES : Tone.Transport, vérifié empiriquement, ne redéclenche
     * jamais un évènement programmé PILE sur `loopStart` — la note posée tout au début de la mesure
     * de départ se tairait donc à chaque tour SAUF le premier. Reculer `loopStart` d'un tic la fait
     * retomber franchement AVANT cette note, qui redevient un évènement normal que le transport
     * traverse en tournant. `loopEnd` recule du MÊME tic (pas seulement loopStart) : la boucle garde
     * ainsi exactement sa longueur réelle plutôt que de s'allonger d'un tic à chaque définition.
     */
    _appliquerBoucle(partition, PPQ) {
        const Tone = globalThis.Tone;
        if (!Tone?.Transport || !this.boucleLecture) return;
        const EPSILON = 1;
        const { debut, fin } = this.boucleLecture;
        const ticksDebut = Math.max(0, Math.round(positionDebutMesure(partition, debut) * PPQ) - EPSILON);
        const ticksFin = Math.max(ticksDebut + 1, Math.round(positionDebutMesure(partition, fin + 1) * PPQ) - EPSILON);
        Tone.Transport.loopStart = `${ticksDebut}i`;
        Tone.Transport.loopEnd = `${ticksFin}i`;
        Tone.Transport.loop = true;
    }

    /**
     * Programme les clics du métronome, mesure par mesure — TOUJOURS ACCORDÉ À LA SIGNATURE EN
     * VIGUEUR, jamais un simple « un clic toutes les X secondes » : `uniteDeGroupement` (voir
     * duration.js, la même fonction qui décide où ligaturer une portée) donne la durée d'UN TEMPS en
     * noires — 1 en mesure simple (4/4, 3/4 : le temps est la noire), 1,5 en mesure composée (6/8,
     * 9/8 : le temps est la noire pointée). C'est CETTE durée qui fait qu'un 6/8 clique par DEUX temps
     * ternaires plutôt que par six clics égaux, qui le feraient entendre comme un 3/4 — la même
     * distinction, en son, que celle qui fait qu'une portée en 6/8 se ligature par trois croches, pas
     * par paires.
     *
     * LA SUBDIVISION (option « croche ») ajoute un clic plus discret entre deux temps, à raison d'une
     * croche (0,5 noire) : ça donne DEUX clics par temps simple (binaire) et TROIS par temps composé
     * (ternaire), sans qu'il y ait de réglage binaire/ternaire à faire soi-même — la signature le
     * décide déjà.
     */
    _programmerMetronome(partition, PPQ) {
        const Tone = globalThis.Tone;
        let debutMesure = 0;
        partition.mesures.forEach((mesure, i) => {
            const capacite = capaciteMesure(partition, i);
            const unite = uniteDeGroupement(signatureEffective(partition, i));
            const nTemps = Math.max(1, Math.round(capacite / unite));
            // Une seule subdivision (donc AUCUNE, en pratique) quand le temps est déjà la plus petite
            // unité qu'on sache reconnaître (x/8 non composé, voir uniteDeGroupement) : rien de plus
            // fin à cliquer entre deux temps qui sont déjà des croches.
            const parTemps = this.metronomeSubdivision ? Math.max(1, Math.round(unite / 0.5)) : 1;
            for (let t = 0; t < nTemps; t++) {
                for (let s = 0; s < parTemps; s++) {
                    const instant = debutMesure + t * unite + s * (unite / parTemps);
                    const accent = t === 0 && s === 0;
                    const sub = s > 0;
                    const ticks = Math.round(instant * PPQ);
                    Tone.Transport.schedule((temps) => {
                        try { this._clicMetronome(accent, temps, sub); } catch (e) { /* ignoré, comme une note manquée */ }
                    }, `${ticks}i`);
                }
            }
            debutMesure += capacite;
        });
    }

    /** Un seul point d'entrée pour faire cliquer le métronome — hauteur ACCENTUÉE sur le premier
     *  temps de chaque mesure, DISCRÈTE sur une subdivision, NORMALE sinon (repris de HarmoHub). */
    _clicMetronome(accent, temps, sub) {
        this.metronome.triggerAttackRelease(sub ? 1250 : (accent ? 1500 : 1000), 0.03, temps, sub ? 0.5 : 1);
    }

    /**
     * Joue une note BENDÉE : attaque à la hauteur écrite, puis GLISSE jusqu'à la hauteur visée.
     *
     * LA FORME DU GESTE compte autant que la hauteur d'arrivée. Un bend de guitare n'est pas un saut :
     * la corde est attaquée en place, le doigt pousse ensuite, et la hauteur monte progressivement.
     * On garde donc la hauteur de départ un court instant (ATTENTE), puis on ramène en un temps
     * proportionnel à la note (MONTEE) — jamais une durée fixe, sinon un bend sur une ronde
     * s'expédierait aussi vite que sur une double-croche.
     *
     * `exponentialRampToValueAtTime` et non une rampe linéaire : la hauteur perçue suit le logarithme
     * de la fréquence, donc une rampe linéaire en Hz s'entend comme une montée qui ralentit à la fin.
     * L'exponentielle donne une montée régulière À L'OREILLE, ce que fait un doigt sur une corde.
     */
    _jouerBend(e, secondes, temps) {
        const Tone = globalThis.Tone;
        if (!this.voixBend) return;   // filet : jamais de note muette si la voix manque
        const ATTENTE = 0.18, MONTEE = 0.42;   // en fraction de la durée sonnante
        const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
        const depart = freq(e.bend.midi);
        const arrivee = freq(e.bend.midi + e.bend.demiTons);

        this.voixBend.frequency.cancelScheduledValues(temps);
        this.voixBend.frequency.setValueAtTime(depart, temps);
        this.voixBend.frequency.setValueAtTime(depart, temps + secondes * ATTENTE);
        this.voixBend.frequency.exponentialRampToValueAtTime(arrivee, temps + secondes * (ATTENTE + MONTEE));
        // `triggerAttackRelease` d'un Tone.Synth REPOSE sa propre fréquence à la note demandée : on lui
        // passe donc la hauteur de DÉPART, et la rampe programmée juste au-dessus prend le relais.
        this.voixBend.triggerAttackRelease(depart, secondes, temps, e.velocite);
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
        // La voix de bend est un Tone.Synth monophonique, à part du synthé principal (voir demarrer) :
        // son `releaseAll` n'existe pas, et sans ce relâchement explicite une note bendée continuait
        // de sonner après un arrêt ou une pause, seule au milieu du silence. Le métronome, MÊME sans
        // sustain (voir demarrer), reste un Tone.Synth du même genre : le même filet de sécurité.
        try { this.voixBend?.triggerRelease?.(); } catch (e) { /* rien en cours : sans objet */ }
        try { this.metronome?.triggerRelease?.(); } catch (e) { /* rien en cours : sans objet */ }
        this.etat = 'pause';
        this._arreterSuivi();
        this._prevenir();
    }

    arreter() {
        const Tone = globalThis.Tone;
        if (Tone) { Tone.Transport.stop(); Tone.Transport.ticks = 0; }
        this.synthe?.releaseAll?.();
        // La voix de bend est un Tone.Synth monophonique, à part du synthé principal (voir demarrer) :
        // son `releaseAll` n'existe pas, et sans ce relâchement explicite une note bendée continuait
        // de sonner après un arrêt ou une pause, seule au milieu du silence. Le métronome, MÊME sans
        // sustain (voir demarrer), reste un Tone.Synth du même genre : le même filet de sécurité.
        try { this.voixBend?.triggerRelease?.(); } catch (e) { /* rien en cours : sans objet */ }
        try { this.metronome?.triggerRelease?.(); } catch (e) { /* rien en cours : sans objet */ }
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
