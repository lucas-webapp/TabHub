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
import { aplatir, hauteurDeNote, dureeTotale, signatureEffective, capaciteMesure, longueurMesure, positionDebutMesure,
         parcoursDeLecture, aDesReprises,
         grilleTernaire, sonneDepuisEcrit, ecritDepuisSonne } from '../model/score.js';
import { dureeEnNoires, uniteDeGroupement, noiresParMesure } from '../model/duration.js';

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
/**
 * Le numéro MIDI d'un nom de note à l'anglaise (« C4 », « D#2 ») — juste ce qu'il faut pour lire les
 * clés de PIANO_URLS. Écrit ici plutôt qu'emprunté à Tone.Frequency : cette table se calcule au
 * CHARGEMENT DU MODULE, quand `globalThis.Tone` peut ne pas être encore posé (voir index.html).
 */
function midiDuNom(nom) {
    const BASES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const m = /^([A-G])(#|b)?(-?\d+)$/.exec(nom);
    return m ? (Number(m[3]) + 1) * 12 + BASES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) : null;
}
/** Les échantillons de piano par hauteur croissante — pour trouver le plus proche d'une note. */
const ECHANTILLONS = Object.keys(PIANO_URLS)
    .map(nom => ({ nom, midi: midiDuNom(nom) }))
    .sort((x, y) => x.midi - y.midi);
/** L'échantillon dont la hauteur est la plus proche : c'est LUI qu'on fait glisser, et moins on le
 *  transpose, moins son timbre se déforme (un demi-ton de transposition ne s'entend pas). */
function echantillonLePlusProche(midi) {
    return ECHANTILLONS.reduce((meilleur, e) =>
        Math.abs(e.midi - midi) < Math.abs(meilleur.midi - midi) ? e : meilleur, ECHANTILLONS[0]);
}
// L'échantillonneur (échantillons réels, déjà enregistrés à un niveau raisonnable) ne se recale pas —
// comme dans HarmoHub, dont le Piano garde un trim à 0 dB. La doublure synthétisée, elle, GARDE le
// recalage `TRIM_DB` déjà en place ci-dessus : c'est le même synthé qu'avant ce changement, au même
// niveau déjà éprouvé, pas une valeur importée d'ailleurs pour une enveloppe qui n'est pas la sienne.
const SAMPLER_TRIM_DB = 0;
/**
 * LE RECALAGE DE LA VOIX SYNTHÉTISÉE DE REPLI. Elle jouait au départ TOUS les bends et slides, et ce
 * qui suit raconte pourquoi son niveau a dû changer ; depuis, la voix glissante échantillonnée (voir
 * TRIM_GLISSANDO_DB) a pris ce rôle dès que le piano est chargé, et ce recalage ne concerne plus que
 * le cas hors ligne. Il reste juste pour ce cas-là, et l'histoire vaut d'être gardée : elle dit
 * pourquoi une valeur ne se recopie pas d'une voix à l'autre par simple voisinage.
 *
 * LA VOIX DE BEND ET DE SLIDE NE SE RECALE PRESQUE PAS — et c'était le défaut signalé (« le son des
 * slides ne fonctionne pas : son inaudible, testé sur plusieurs configurations »).
 *
 * Elle portait `TRIM_DB` (-9 dB) par simple voisinage avec la doublure, dont elle reprend la recette
 * d'oscillateur. Mais ce -9 dB existe pour une raison précise, écrite plus haut : « une polyphonie à
 * six voix sature vite ». Or CETTE voix est MONOPHONIQUE — une seule note à la fois, jamais six — et
 * elle ne joue pas À LA PLACE de l'échantillonneur mais À CÔTÉ de lui. Résultat une fois les
 * échantillons chargés (le cas de l'utilisateur) : un piano réel à 0 dB, et le slide, seul, 9 dB en
 * dessous — un tiers de l'amplitude, avec en plus le timbre le plus maigre des deux. Inaudible au
 * milieu du morceau, exactement comme décrit.
 *
 * MAIS LE NIVEAU N'ÉTAIT PAS LE PRINCIPAL. Mesuré : le recalage ne déplace que la CRÊTE, c'est-à-dire
 * l'attaque — or ce qu'on n'entendait pas, c'est le GLISSEMENT, qui se produit vers la fin de la note
 * (voir _jouerSlide, PART_GLISSEE). Avec l'ancienne enveloppe (sustain 0,14), la hauteur glissait
 * pendant que le son s'était déjà éteint à 14 % : il ne restait à entendre que l'attaque, sur la note
 * de DÉPART. Le correctif tient donc aux deux : une enveloppe qui PORTE (voir plus bas) et un
 * recalage rapproché.
 *
 * -6 dB, entre les -9 de la doublure et le 0 de l'échantillonneur : un slide est un GESTE
 * expressif, un rien en avant lui va — pas au point de dominer le morceau.
 */
const TRIM_BEND_DB = -6;
/**
 * LA VOIX GLISSANTE ÉCHANTILLONNÉE NE SE RECALE PAS — 0 dB, comme l'échantillonneur.
 *
 * Et c'est le même raisonnement que SAMPLER_TRIM_DB, pas une valeur choisie à l'oreille : cette voix
 * joue LE MÊME échantillon de piano que l'échantillonneur, une note à la fois, à côté de lui. Lui
 * donner un recalage différent ferait entendre une note glissée plus forte ou plus faible que la même
 * note NON glissée — un saut de niveau au milieu d'une phrase, là où l'on veut n'entendre qu'un
 * mouvement de hauteur. TRIM_BEND_DB (-6) ci-dessus reste pour la voix SYNTHÉTISÉE de repli, dont le
 * timbre est plus maigre et qui a effectivement besoin de ce rien en avant.
 */
const TRIM_GLISSANDO_DB = 0;
/** Fondu de sortie et queue laissée à l'échantillon : sans le fondu, couper un piano en pleine
 *  résonance fait un clic net ; sans la queue, la note s'arrête plus sèchement que ses voisines
 *  jouées par l'échantillonneur (qui, lui, a `release: 1`). */
const FONDU_GLISSANDO = 0.12, QUEUE_GLISSANDO = 0.35;

export class Lecteur {
    constructor() {
        this.pret = false;
        this.synthe = null;
        // Les échantillons de piano et les glissandos en cours — posés par `demarrer()`. Déclarés ICI
        // pour que les gardes de _jouerGlissando et _taireGlissandos aient une réponse AVANT tout
        // démarrage : un aperçu joué au premier clic passe par là sans qu'`demarrer` ait rendu la main.
        this._buffersPiano = null;
        this._glissandos = null;
        this._sortieGlissando = null;
        this.etat = 'arret';          // 'arret' | 'lecture' | 'pause'
        this.position = 0;            // en noires depuis le début du morceau
        this.duree = 0;
        this.auditeurs = new Set();
        this._boucleAnim = null;
        this._evenements = [];
        // Grille des temps pour la lecture ternaire, posée par `programmer` (voir là-bas) et lue par
        // la tête de lecture à chaque image. `null` = morceau binaire, et les conversions sont alors
        // l'identité : c'est l'état de départ, celui d'une partition qu'on n'a pas encore programmée.
        this._grilleTernaire = null;
        // LE PARCOURS DE LECTURE DÉPLIÉ — `null` quand il n'y a rien à déplier (aucune reprise, ou
        // une boucle en cours), et TOUT se comporte alors exactement comme avant. Sinon : la liste
        // des passages, chacun avec sa place sur la ligne du temps JOUÉE et la place ÉCRITE qui lui
        // correspond. Voir programmer et _suivre.
        this._parcours = null;
        // Métronome pendant la lecture — voir HarmoHub (METRONOME_KEY/METRONOME_SUBDIVISION_KEY) :
        // désactivé par défaut dans les deux cas, une préférence explicite, pas un bruit permanent
        // qu'il faudrait couper à chaque lancement. La persistance (localStorage) est du ressort de
        // main.js, comme le tempo ou le zoom — ce module ne connaît que l'état courant.
        this.metronomeActif = false;
        this.metronomeSubdivision = false;
        // DÉCOMPTE AVANT LECTURE (retour utilisateur : « ok pour un décompte d'une mesure »). UNE
        // MESURE, pas un nombre à choisir : c'est le décompte de tous les studios et de tous les
        // professeurs, et deux réglages (activer / combien) pour un geste aussi simple auraient coûté
        // plus à comprendre qu'ils n'apportent.
        //
        // INDÉPENDANT DE `metronomeActif`, et c'est le point : le décompte sert à ARRIVER en place
        // sur la première note, le métronome à RESTER en place ensuite. On veut couramment le premier
        // sans le second — un décompte puis le silence de la musique seule.
        this.decompteActif = false;
        // Boucle de lecture (barre orange glissée sous la TAB, voir main.js#marquesBoucle/
        // gesteBoucle*) : {debut, fin}, en INDEX DE MESURE, fin comprise — ou null, aucune boucle.
        // Un état de SESSION, comme metronomeActif juste au-dessus, jamais écrit dans le .json ni
        // dans localStorage : HarmoHub (dont ce geste est repris) ne le fait pas non plus — une
        // boucle qui survivrait en silence à un rechargement rouvrirait l'appli en train de rejouer
        // indéfiniment quatre mesures sans que rien ne l'explique.
        this.boucleLecture = null;
        // LES ANCRES DE LA BOUCLE : les `id` des deux mesures qu'elle borne (voir model/score.js,
        // creerMesure — chaque mesure en porte un, stable, que `cloner` préserve). `boucleLecture`
        // ci-dessus garde les NUMÉROS, parce que c'est ce dont le dessin et l'horloge ont besoin ;
        // mais un numéro n'est qu'une position dans un tableau, et insérer une mesure avant la
        // boucle le rend faux en silence. Les ancres, elles, désignent les mesures ELLES-MÊMES —
        // voir reancrerBoucle, le seul endroit qui remet les numéros d'accord avec elles.
        this._ancresBoucle = null;
        // Volumes (0-100), comme HarmoHub : un pourcentage se règle au jugé, un dB se calcule. 100 =
        // plein volume (0 dB), 80 par défaut pour le métronome — un repère qu'on entend, jamais celui
        // qu'on écoute. Les DEUX s'appliquent MÊME AVANT `demarrer()` (l'utilisateur peut ouvrir les
        // Réglages avant tout premier clic sur Lecture) : les accesseurs ci-dessous n'écrivent sur
        // Tone.Destination/this.metronome que s'ils existent déjà, et demarrer() rejoue les deux
        // valeurs mémorisées une fois le contexte audio prêt, pour ne jamais perdre un réglage posé
        // trop tôt. Persistance (localStorage) du ressort de main.js, comme le reste de ce bloc.
        this.volumeGeneral = 100;
        this.volumeMetronome = 80;
        // VITESSE DE TRAVAIL — de 25 à 100 % du tempo écrit. Ralentir pour déchiffrer un passage est
        // le geste le plus banal du travail instrumental, et c'est le SEUL moyen de le faire sans
        // toucher au tempo du morceau : baisser le champ Tempo de 120 à 60 pour s'entraîner réécrit
        // la partition, part dans le .json, dans le PDF et dans le MIDI, et se retrouve à l'ouverture
        // suivante comme si le morceau était lent. D'où DEUX nombres distincts et non un seul :
        //
        //   tempoEcrit — ce que dit la partition, ce qui s'exporte, ce que le champ Tempo affiche ;
        //   vitesse    — ce que joue le lecteur maintenant, qui ne sort jamais de cette session.
        //
        // Ce que l'horloge reçoit est leur PRODUIT (voir _appliquerTempo, seul endroit qui écrive sur
        // Tone.Transport.bpm). Tout le reste suit gratuitement : la tête de lecture lit des TICS
        // convertis en noires (voir _suivre), donc elle reste juste à toute vitesse ; et le décompte
        // se calcule en secondes au tempo courant (voir _programmerDecompte), donc il ralentit avec
        // la musique — un décompte se compte à la vitesse de ce qui suit.
        //
        // PAS PERSISTÉ, volontairement, et pour la raison exacte qui vaut pour la boucle ci-dessus :
        // une vitesse de 50 % qui survivrait en silence à un rechargement rouvrirait l'application en
        // train de jouer lentement sans que rien ne l'explique. On repart donc toujours à 100 %.
        this.vitesse = 1;
        this.tempoEcrit = 120;
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
        //
        // LES ÉCHANTILLONS SONT CHARGÉS À PART, PUIS L'ÉCHANTILLONNEUR EST BÂTI DESSUS — et non
        // téléchargés par l'échantillonneur lui-même comme avant. La raison n'est pas l'économie : la
        // VOIX GLISSANTE (plus bas) a besoin des buffers EUX-MÊMES pour jouer un échantillon dont elle
        // fait varier la vitesse de lecture, et `Tone.Sampler` garde les siens privés. Deux
        // chargements des mêmes 17 fichiers seraient deux vérités à faire coïncider — l'un pouvant
        // réussir quand l'autre échoue, le piano jouant alors des notes ordinaires mais pas les
        // glissées, ou l'inverse. Un seul chargement, deux lecteurs.
        const volumeSampler = new Tone.Volume(SAMPLER_TRIM_DB).connect(Tone.Destination);
        // `let` et non `const` : l'échantillonneur ne peut naître qu'une fois les buffers arrivés
        // (mesuré : construit sur un buffer encore vide, il reste `loaded: false` pour toujours). La
        // façade ci-dessous interroge donc `sampler?.loaded` à CHAQUE note — ce qu'elle faisait déjà,
        // puisque le relais doublure -> piano se faisait déjà en cours de route.
        let sampler = null;
        const buffersPiano = new Tone.ToneAudioBuffers({
            urls: PIANO_URLS,
            baseUrl: PIANO_BASE_URL,
            // Un échec de téléchargement est un cas ATTENDU, pas une anomalie : hors ligne, réseau
            // lent, hôte bloqué. `onload` ne se déclenche alors pas du tout (mesuré), `loaded` reste
            // faux, et la doublure synthétisée continue de jouer — exactement comme avant.
            onerror: () => {},
            onload: () => {
                const charges = {};
                for (const { nom } of ECHANTILLONS) charges[nom] = buffersPiano.get(nom);
                sampler = new Tone.Sampler({ urls: charges, release: 1 });
                sampler.connect(volumeSampler);
            },
        });
        this._buffersPiano = buffersPiano;

        // Une interface UNIQUE, qui choisit elle-même qui joue : tout le reste du fichier (programmer,
        // apercu) continue d'appeler `this.synthe.triggerAttackRelease(...)` sans rien savoir de ce qui
        // sonne derrière — l'échantillonneur dès qu'il est prêt, la doublure sinon, et le relais se fait
        // tout seul dès que les fichiers arrivent, sans rien à reprogrammer.
        this.synthe = {
            get charge() { return !!sampler?.loaded; },
            triggerAttackRelease(...args) {
                (sampler?.loaded ? sampler : doublure).triggerAttackRelease(...args);
                return this;
            },
            releaseAll() {
                // `releaseAll` de Sampler peut lever tant qu'aucun échantillon n'a encore joué —
                // jamais un prétexte pour laisser la doublure, elle, sonner indéfiniment.
                try { sampler?.releaseAll(); } catch (e) { /* rien à relâcher pour l'instant */ }
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
        // CE N'EST PLUS QUE LE REPLI. Cette voix jouait TOUTES les notes bendées et glissées, et son
        // timbre d'onde était le défaut signalé (« un son analogique grave au lieu d'un son de
        // piano »). Depuis, la voix glissante échantillonnée ci-dessous joue le vrai piano ; ce synthé
        // ne sert plus que lorsque les échantillons ne sont pas là — hors ligne, réseau lent, ou le
        // temps qu'ils arrivent. Il reste indispensable à ce titre : sans lui, un bend serait muet sur
        // ce genre de réseau.
        //
        // Monophonique parce qu'un bend simultané sur deux cordes est rare, et qu'une voix unique
        // évite d'allouer/détruire un synthé à chaque note bendée.
        // Filtre plus ouvert que celui de la doublure (3600 Hz) : ce qu'on cherche à ENTENDRE ici est
        // le mouvement de hauteur, et couper les harmoniques hautes le rend précisément plus sourd.
        const filtreBend = new Tone.Filter({ type: 'lowpass', frequency: 5200, Q: 0.5 });
        const volumeBend = new Tone.Volume(TRIM_BEND_DB);
        // ENVELOPPE QUI PORTE, contrairement à celle de la doublure (decay 0,42 / sustain 0,14) : une
        // note de doublure n'a qu'à donner une hauteur nette à l'attaque, alors qu'un slide doit
        // s'entendre BOUGER — et son glissement se produit vers la fin de la note (voir _jouerSlide,
        // PART_GLISSEE). Avec 14 % de sustain, la hauteur glissait pendant que le son s'était déjà
        // éteint : il ne restait à entendre que l'attaque, sur la note de DÉPART. D'où une extinction
        // plus lente et un palier tenu bien plus haut.
        this.voixBend = new Tone.Synth({
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.005, decay: 0.9, sustain: 0.42, release: 0.9 },
        });
        this.voixBend.chain(filtreBend, volumeBend, Tone.Destination);

        // LA VOIX GLISSANTE ÉCHANTILLONNÉE — le VRAI timbre de piano, qui glisse.
        //
        // LE DÉFAUT (retour utilisateur, deux fois : « le son du slide fait toujours un son analogique
        // grave au lieu d'un son de piano. Peux-tu corriger correctement stp ? »). La correction
        // précédente n'avait traité que le NIVEAU et l'ENVELOPPE : la note glissée s'entendait enfin,
        // mais c'était toujours une onde triangulaire filtrée à 5200 Hz — donc un son de synthé grave
        // au milieu d'un piano échantillonné. Le commentaire de la voix de bend ci-dessus le disait
        // d'ailleurs sans détour, comme un prix à payer : « une note bendée n'a pas le timbre du piano
        // échantillonné ». Ce prix n'avait pas à être payé.
        //
        // CE QUI L'AVAIT FAIT CROIRE IMPOSSIBLE, ET POURQUOI C'ÉTAIT FAUX. Le raisonnement tenait :
        // ni `Tone.Sampler` ni `Tone.PolySynth` n'offrent de prise sur la hauteur d'une voix déjà
        // attaquée (`detune` absent des deux — revérifié). Mais il concluait trop vite « donc pas de
        // piano qui glisse ». Ce qu'il oubliait, c'est qu'un échantillonneur n'est rien d'autre qu'un
        // lecteur de buffer dont on règle la VITESSE DE LECTURE — et cette vitesse, sur un
        // `Tone.ToneBufferSource`, est un paramètre RAMPABLE (vérifié : `playbackRate` accepte
        // `setValueAtTime` et `exponentialRampToValueAtTime`). On joue donc soi-même l'échantillon le
        // plus proche et on fait glisser sa vitesse : un piano qui glisse pour de bon.
        //
        // MESURÉ, pas supposé : un buffer de fondamentale connue, `playbackRate` rampé de 1 à 2^(2/12),
        // et l'analyseur lit 264 Hz -> 296 Hz (attendu 294) à niveau constant (0,378 -> 0,376).
        //
        // CE QUE ÇA COÛTE, EN TOUTE FRANCHISE : faire varier la vitesse de lecture déplace AUSSI le
        // tempo de l'échantillon (c'est le glissando « à la bande »). Sur les intervalles d'un slide
        // ou d'un bend — un demi-ton à trois tons — l'écart de vitesse va de 6 % à 19 % : inaudible
        // comme accélération, et c'est exactement ainsi que tout échantillonneur transpose déjà.
        //
        // PAS DE FILTRE ICI, contrairement à la voix synthétisée : les 5200 Hz existaient pour
        // rattraper une onde pauvre. Un vrai piano n'a rien à rattraper, et le filtrer le rendrait
        // précisément plus sourd — le défaut signalé.
        this._sortieGlissando = new Tone.Volume(TRIM_GLISSANDO_DB).connect(Tone.Destination);
        // LES SOURCES EN COURS, pour pouvoir les taire. Un `ToneBufferSource` n'est pas une voix
        // persistante à relâcher mais un objet JETABLE, créé par note : sans ce registre, appuyer sur
        // Stop laisserait le glissando finir tout seul dans le silence (le défaut exact que le filet
        // `triggerRelease` de la voix de bend corrige déjà pour elle).
        this._glissandos = new Set();

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
    /**
     * CONSTRUIT LE PARCOURS DÉPLIÉ — la suite des passages, chacun placé sur la ligne du temps JOUÉE.
     *
     * `null` DANS DEUX CAS, et tout se comporte alors exactement comme avant :
     *   — le morceau n'a aucune reprise (l'immense majorité) : il n'y a rien à déplier ;
     *   — une BOUCLE est posée. On travaille alors un passage, et on veut l'entendre TEL QU'IL EST
     *     ÉCRIT, pas la forme entière du morceau. C'est aussi ce qui évite d'avoir à traduire les
     *     bornes de la boucle sur une ligne du temps qui n'est plus celle de la partition — deux
     *     systèmes de coordonnées à tenir d'accord, pour un cas que personne n'a demandé.
     *
     * CHAQUE PASSAGE PORTE SA CONVERSION. `sonneDebut` est la place SONNÉE (ternaire compris) du
     * début de la mesure dans la partition écrite ; `offset` est sa place sur la ligne jouée. Un
     * instant joué se retraduit donc en instant écrit par une soustraction et une addition — voir
     * _ecritDepuisJoue. Sans reprise, les deux coïncident et la conversion est l'identité.
     */
    _construireParcours(partition) {
        if (!aDesReprises(partition) || this.boucleLecture) return null;
        const ordre = parcoursDeLecture(partition);
        // Un parcours qui ne fait que lister les mesures dans l'ordre n'a rien à déplier non plus :
        // une reprise « jouée une seule fois » (nbFois ramené à 1) ne doit pas coûter une conversion.
        if (ordre.length === partition.mesures.length && ordre.every((m, i) => m === i)) return null;
        const passages = [];
        let offset = 0;
        for (const mesure of ordre) {
            const debutEcrit = positionDebutMesure(partition, mesure);
            const sonneDebut = sonneDepuisEcrit(this._grilleTernaire, debutEcrit);
            const sonneFin = sonneDepuisEcrit(this._grilleTernaire, debutEcrit + longueurMesure(partition, mesure));
            const longueur = Math.max(0, sonneFin - sonneDebut);
            passages.push({ mesure, debutEcrit, sonneDebut, longueur, offset });
            offset += longueur;
        }
        return { passages, duree: offset };
    }

    /**
     * Un instant de la ligne du temps JOUÉE, retraduit en instant SONNÉ de la partition écrite.
     *
     * C'est ce qui permet à la tête de lecture de rester une seule marque sur une seule note, quand
     * cette note est jouée trois fois : l'écran n'a jamais à connaître le dépliage.
     */
    _sonneDepuisJoue(joue) {
        if (!this._parcours) return joue;
        const { passages } = this._parcours;
        // Recherche linéaire : un parcours dépasse rarement quelques centaines de passages, et cette
        // fonction est appelée une fois par image — pas une fois par note.
        for (const p of passages) {
            if (joue < p.offset + p.longueur - 1e-9) return p.sonneDebut + (joue - p.offset);
        }
        const dernier = passages[passages.length - 1];
        return dernier ? dernier.sonneDebut + dernier.longueur : joue;
    }

    /**
     * L'aller de `_sonneDepuisJoue` : un instant SONNÉ de la partition écrite, placé sur la ligne du
     * temps JOUÉE — au PREMIER passage qui le couvre.
     *
     * « Le premier » et non « le dernier » : lancer la lecture à la mesure 3 veut dire la première
     * fois qu'on y arrive, jamais sa reprise. C'est aussi ce qu'on attend en cliquant sur une note
     * pour l'entendre dans son contexte.
     */
    _joueDepuisSonne(sonne) {
        if (!this._parcours) return sonne;
        for (const p of this._parcours.passages) {
            if (sonne < p.sonneDebut + p.longueur - 1e-9) return p.offset + Math.max(0, sonne - p.sonneDebut);
        }
        return this._parcours.duree;
    }

    programmer(partition) {
        const Tone = globalThis.Tone;
        Tone.Transport.cancel();
        // PAR `definirTempo` ET NON PAR `Tone.Transport.bpm` : reprogrammer ne doit pas effacer la
        // vitesse de travail. C'est par ici que passe chaque lancement de lecture, donc une
        // affectation directe la remettait silencieusement à 100 % à la première note.
        this.definirTempo(partition.meta.tempo || 120);

        const plat = aplatir(partition);
        this.duree = dureeTotale(partition);
        // LA GRILLE TERNAIRE (voir model/score.js#grilleTernaire) : `null` sur un morceau binaire, et
        // les deux conversions ci-dessous deviennent alors l'identité. Reconstruite à CHAQUE
        // programmation, jamais retenue : cocher « ternaire » ou changer une signature passe par
        // `reprogrammerSiEnCours`, donc par ici — une grille mise en cache se serait tue.
        // Elle survit à la programmation parce que la TÊTE DE LECTURE en a besoin à chaque image
        // (voir _suivre), bien après que programmer() a rendu la main.
        this._grilleTernaire = grilleTernaire(partition);
        // LE PARCOURS APRÈS LA GRILLE : il s'appuie dessus pour mesurer chaque passage en temps
        // SONNÉ (voir _construireParcours). L'ordre compte.
        this._parcours = this._construireParcours(partition);
        // La durée du transport est celle de ce qu'on VA JOUER, reprises comprises — sans quoi
        // l'arrêt de fin tomberait au milieu du deuxième passage.
        if (this._parcours) this.duree = this._parcours.duree;
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

                // UN SLIDE EST UN SEUL SON DONT LA HAUTEUR GLISSE — pas deux notes plaquées côte à
                // côte (retour utilisateur : « ajouter l'effet slide, pas uniquement le hammer-on.
                // J'écoute un slide rapide d'un ton sur une double croche et c'est pas assez fluide »).
                // Et pour cause : `slide` ne servait jusqu'ici qu'à BAISSER LA VÉLOCITÉ de la note
                // d'arrivée (voir obtenueSansAttaque, juste en dessous) — exactement comme un
                // hammer-on. On entendait donc bien deux hauteurs distinctes, attaque en moins.
                //
                // Le doigt, lui, ne quitte pas la corde : il la fait sonner une fois et se déplace.
                // On absorbe donc la ou les notes d'arrivée comme le fait `tie` juste au-dessus —
                // durées cumulées, notes marquées consommées, plus aucune attaque pour elles — en
                // retenant au passage l'instant et la hauteur de chaque palier. Une CHAÎNE de slides
                // (5 → 7 → 9) donne ainsi un glissando à plusieurs paliers, d'un seul tenant.
                const etapes = [];
                while (courante.lien === 'slide' && suivante) {
                    const noteSuivante = suivante.ref.notes.find(n => n.corde === note.corde);
                    if (!noteSuivante) break;
                    const midiSuivant = hauteurDeNote(partition, noteSuivante);
                    if (midiSuivant == null) break;
                    consommees.add(`${suivante.mesure}:${suivante.voix}:${suivante.evenement}:${note.corde}`);
                    // `arriveeA` : l'instant, compté depuis le début du son, où cette hauteur doit être
                    // atteinte — c'est-à-dire l'attaque qu'aurait eue la note absorbée. Le glissando
                    // arrive donc PILE sur le temps, comme joué.
                    etapes.push({ midi: midiSuivant, arriveeA: duree });
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
                    // LA MESURE D'ORIGINE, pour retrouver les passages où cette note se joue (voir le
                    // dépliage des reprises, plus bas). Une note LIÉE par-dessus une barre garde la
                    // mesure de son ATTAQUE : c'est là qu'elle sonne, sa prolongation suit.
                    mesure: entree.mesure,
                    duree: Math.max(0.05, sonnante),
                    note: midiVersNomTone(midi),
                    velocite: Math.max(0.05, Math.min(1, velocite)),
                    // Le BEND voyage jusqu'à la programmation en DEMI-TONS, pas en nom de note : c'est
                    // d'une hauteur qui GLISSE qu'il s'agit, et une rampe se calcule en fréquence (voir
                    // la voix de bend, plus bas). `null` quand la note n'est pas bendée — le cas courant.
                    bend: note.bend ? { midi, demiTons: note.bend.demiTons } : null,
                    // Les paliers d'un slide, dans le même esprit que `bend` : une hauteur qui BOUGE ne
                    // se décrit pas par un nom de note. `null` quand la note ne glisse pas — le cas
                    // courant. Un bend l'emporte sur un slide quand une note porte les deux (voir la
                    // programmation plus bas) : c'est le geste le plus spécifique des deux, et les
                    // combiner demanderait une rampe à deux dimensions que personne n'a demandée.
                    glisse: etapes.length ? { midi, etapes } : null,
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
        // LES PLACES OÙ CHAQUE MESURE SE JOUE. Sans reprise, `null` : chaque évènement est programmé
        // une fois, à sa place écrite, exactement comme avant. Avec reprises, une mesure jouée trois
        // fois donne trois décalages — et la MÊME note est programmée trois fois, sans qu'aucun
        // évènement ne soit dupliqué dans le document.
        const decalagesParMesure = new Map();
        if (this._parcours) {
            for (const p of this._parcours.passages) {
                if (!decalagesParMesure.has(p.mesure)) decalagesParMesure.set(p.mesure, []);
                decalagesParMesure.get(p.mesure).push(p.offset - p.sonneDebut);
            }
        }
        for (const e of this._evenements) {
            // LECTURE TERNAIRE : le temps ÉCRIT n'est plus le temps SONNÉ. On transforme la POSITION
            // de début ET celle de fin, jamais la durée seule — une croche ne vaut pas une durée fixe
            // en ternaire : deux tiers de temps si elle tombe sur le temps, un tiers si elle tombe
            // entre deux. C'est sa place qui décide, d'où ce calcul par différence. Rigoureusement le
            // même calcul qu'à l'export MIDI (io/midi.js), sur la même grille : ce que l'utilisateur
            // entend ici et ce que joue son DAW doivent être le même rythme.
            const debutSonne = sonneDepuisEcrit(this._grilleTernaire, e.debut);
            const finSonnee = sonneDepuisEcrit(this._grilleTernaire, e.debut + e.duree);
            const ticksDuree = Math.max(1, Math.round((finSonnee - debutSonne) * PPQ));
            // UN DÉCALAGE PAR PASSAGE. `[0]` sans reprise : une seule programmation, à la place
            // écrite — le comportement d'avant, à l'identique. Une mesure jouée trois fois en donne
            // trois, et la même note part trois fois.
            const decalages = this._parcours ? (decalagesParMesure.get(e.mesure) || []) : [0];
            for (const decalage of decalages) {
                Tone.Transport.schedule((temps) => {
                    // La DURÉE, elle, doit bien être en secondes au moment du déclenchement : on la
                    // convertit ici, donc au tempo courant, et non à celui d'il y a une minute.
                    const secondes = Tone.Ticks(ticksDuree).toSeconds();
                    if (e.bend) this._jouerBend(e, secondes, temps);
                    else if (e.glisse) this._jouerSlide(e, ticksDuree, temps);
                    else this.synthe.triggerAttackRelease(e.note, secondes, temps, e.velocite);
                }, `${Math.round((debutSonne + decalage) * PPQ)}i`);
            }
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
     * Reprogramme SI ET SEULEMENT SI la décision de déplier les reprises vient de basculer.
     *
     * Appelé par les deux gestes qui peuvent la faire basculer (poser une boucle, la retirer). Sans
     * reprise dans le morceau, la décision est « non » des deux côtés et il ne se passe rien.
     */
    _reprogrammerSiDepliageChange(partition, deplierAvant) {
        if (this.etat === 'arret') return;
        const deplierApres = !!(aDesReprises(partition) && !this.boucleLecture);
        if (deplierApres === deplierAvant) return;
        this.reprogrammerSiEnCours(partition);
    }

    /**
     * Définit (ou étend/déplace) la boucle de lecture sur [mesureDebut, mesureFin] (fin comprise).
     * Appelable À TOUT MOMENT, lecture en cours ou non — glisser la barre PENDANT que ça joue doit
     * faire sentir le nouveau bornage tout de suite, pas seulement au prochain démarrage : on ne
     * passe donc pas par programmer() ici (qui annulerait puis reprogrammerait TOUTES les notes,
     * un à-coup audible), seul le point de bouclage de l'horloge bouge.
     */
    definirBoucle(partition, mesureDebut, mesureFin, fines = {}) {
        // POSER OU RETIRER UNE BOUCLE CHANGE LA DÉCISION DE DÉPLIAGE (voir _construireParcours : on
        // ne déplie pas sous une boucle). Quand cette décision bascule ET que la lecture tourne, il
        // faut reprogrammer pour de bon — sinon l'horloge boucle sur une ligne du temps qui n'est
        // plus celle des notes programmées. Sur un morceau SANS reprise, rien ne bascule jamais et
        // ce chemin ne coûte rien : c'est le cas de l'immense majorité des gestes de boucle, et
        // c'est pour eux que `definirBoucle` évite de reprogrammer (un à-coup audible).
        const deplierAvant = !!this._parcours;
        const r = this.boucleLecture;
        // LES BORNES FINES, en noires DEPUIS LE DÉBUT DE LEUR MESURE D'ANCRAGE (voir bornesBoucle).
        // `debutDansMesure` vaut 0 et `finDansMesure` vaut `null` par défaut : c'est exactement
        // « toute la mesure », donc le comportement d'avant les bornes fines — un appel à trois
        // arguments, un brouillon enregistré avant elles, un banc écrit avant elles, continuent tous
        // de dire ce qu'ils ont toujours dit.
        const debutDansMesure = fines.debutDansMesure ?? 0;
        const finDansMesure = fines.finDansMesure ?? null;
        // Rien de changé -> rien à refaire (glisser la barre déclenche ceci à chaque évènement de
        // pointeur ; sans ce garde-fou, la MÊME plage réécrirait Transport.loopStart/loopEnd à
        // chaque micro-mouvement du doigt, pour un résultat identique).
        if (r && r.debut === mesureDebut && r.fin === mesureFin
            && r.debutDansMesure === debutDansMesure && r.finDansMesure === finDansMesure) return;
        this.boucleLecture = { debut: mesureDebut, fin: mesureFin, debutDansMesure, finDansMesure };
        this._ancresBoucle = {
            debut: partition?.mesures?.[mesureDebut]?.id ?? null,
            fin: partition?.mesures?.[mesureFin]?.id ?? null,
        };
        const Tone = globalThis.Tone;
        if (Tone?.Transport) this._appliquerBoucle(partition, Tone.Transport.PPQ);
        this._reprogrammerSiDepliageChange(partition, deplierAvant);
    }

    /**
     * LES DEUX INSTANTS QUE BORNE LA BOUCLE, en noires depuis le début du morceau — la seule lecture
     * autorisée de `boucleLecture` pour qui veut des POSITIONS plutôt que des numéros de mesure.
     *
     * POURQUOI DEUX CHAMPS PLUTÔT QU'UNE POSITION TOUTE FAITE. La boucle doit survivre à l'édition,
     * et elle y survit en s'ancrant aux `id` des mesures qu'elle borne (voir reancrerBoucle) — une
     * position absolue, elle, ne veut plus rien dire dès qu'on insère une mesure avant. On garde donc
     * le NUMÉRO de mesure comme ancre, et le décalage fin est relatif À ELLE : insérer une mesure
     * ailleurs déplace l'ancre sans toucher au décalage, et la boucle retombe exactement sur le même
     * passage. C'est la même raison qui avait fait choisir l'ancrage par `id`, poussée d'un cran.
     *
     * `finDansMesure` À `null` VEUT DIRE « LA FIN DE CETTE MESURE », et pas une valeur figée à la
     * définition : changer la signature d'une mesure bornée par une boucle entière doit l'allonger
     * avec elle, pas laisser la borne au milieu de rien.
     */
    bornesBoucle(partition) {
        const b = this.boucleLecture;
        if (!b) return null;
        const debut = positionDebutMesure(partition, b.debut) + (b.debutDansMesure || 0);
        const fin = positionDebutMesure(partition, b.fin)
            + (b.finDansMesure ?? longueurMesure(partition, b.fin));
        return { debut, fin: Math.max(fin, debut) };
    }

    /**
     * REMET LES NUMÉROS DE LA BOUCLE D'ACCORD AVEC LES MESURES QU'ELLE BORNE.
     *
     * LE DÉFAUT (signalé de longue date) : la bande orange se repérait par NUMÉRO de mesure.
     * Insérer une mesure avant elle laissait donc la bande sur les mêmes numéros pendant que la
     * musique glissait dessous — on rebouclait sur un autre passage que celui qu'on avait encadré,
     * sans un mot.
     *
     * POURQUOI RÉSOUDRE PLUTÔT QUE DÉCALER. Décaler la boucle à chaque commande qui touche au
     * tableau des mesures demanderait de les recenser toutes (ajouter, coller, supprimer, remplacer,
     * importer à la suite…) ET de porter la boucle dans l'historique, pour qu'une annulation la
     * ramène avec le reste. Six endroits à ne jamais oublier, dont un qu'on oublierait. Ici il n'y
     * en a qu'un : la boucle est DÉRIVÉE des mesures, comme le reste de l'affichage. Toute
     * modification du document, présente ou future, repasse par ce seul calcul — c'est la règle que
     * ce projet applique partout : deux vérités finissent toujours par diverger.
     *
     * LES ANCRES SURVIVENT À L'ANNULATION parce que l'historique CLONE la partition (voir
     * commands.js#memoriser, `cloner`) : un `id` est une donnée du document comme une autre, il
     * traverse la copie profonde. Une réouverture de fichier, elle, refait des mesures neuves (voir
     * normaliser) — mais un document qu'on vient d'ouvrir n'a pas de boucle non plus, la question ne
     * se pose pas.
     *
     * MESURE ANCRE SUPPRIMÉE : si les DEUX ont disparu, la boucle n'a plus rien à border et s'en va.
     * Si une seule survit, la boucle se resserre sur elle — jamais une bande qui réapparaît ailleurs
     * que là où on l'avait posée.
     *
     * @returns {boolean} vrai si les numéros ou l'existence de la boucle ont changé — à l'appelant
     *   de redessiner (voir main.js#surChangementEditeur).
     */
    reancrerBoucle(partition) {
        if (!this.boucleLecture || !this._ancresBoucle) return false;
        // ANCRE JAMAIS POSÉE (une boucle définie sur un numéro hors du morceau — que l'interface ne
        // produit pas, mais qu'un appel direct pourrait) : on ne ré-ancre pas ce qu'on n'a pas su
        // ancrer. Les numéros restent tels quels, plutôt qu'une boucle qui s'évanouirait au premier
        // redessin faute d'un `id` à retrouver.
        if (!this._ancresBoucle.debut || !this._ancresBoucle.fin) return false;
        const parId = new Map();
        (partition?.mesures || []).forEach((m, i) => { if (m?.id) parId.set(m.id, i); });
        const iDebut = parId.has(this._ancresBoucle.debut) ? parId.get(this._ancresBoucle.debut) : null;
        const iFin = parId.has(this._ancresBoucle.fin) ? parId.get(this._ancresBoucle.fin) : null;

        if (iDebut === null && iFin === null) { this.retirerBoucle(); return true; }
        // Une seule ancre retrouvée : la boucle se resserre sur elle. Et si l'édition a croisé les
        // deux (une mesure déplacée d'un bord à l'autre), on remet les bornes dans l'ordre plutôt
        // que de laisser une plage négative, que ni le dessin ni l'horloge ne sauraient lire.
        const a = iDebut ?? iFin, b = iFin ?? iDebut;
        const debut = Math.min(a, b), fin = Math.max(a, b);
        const bouge = this.boucleLecture.debut !== debut || this.boucleLecture.fin !== fin;
        // LES BORNES FINES SUIVENT LEUR ANCRE, puisqu'elles sont comptées DEPUIS elle (voir
        // bornesBoucle) : insérer une mesure ailleurs déplace le numéro, jamais le décalage.
        //
        // SAUF QUAND UNE ANCRE A DISPARU. La boucle se resserre alors sur la mesure restante, et les
        // décalages de l'autre bord ne désignent plus rien — on rend à ce bord-là sa position
        // naturelle plutôt que d'y laisser un décalage calculé pour une mesure supprimée, qui poserait
        // la borne au petit bonheur dans la mesure survivante. Et si les deux bords se sont croisés,
        // ils échangent leurs décalages avec leurs rôles.
        let { debutDansMesure = 0, finDansMesure = null } = this.boucleLecture;
        if (iDebut === null) debutDansMesure = 0;
        if (iFin === null) finDansMesure = null;
        if (iDebut !== null && iFin !== null && iDebut > iFin) {
            const capaciteAncienDebut = capaciteMesure(partition, debut);
            [debutDansMesure, finDansMesure] = [finDansMesure ?? 0, debutDansMesure || capaciteAncienDebut];
        }
        this.boucleLecture = { debut, fin, debutDansMesure, finDansMesure };
        // LES BORNES DE L'HORLOGE SONT REPOSÉES DANS TOUS LES CAS, même quand les numéros n'ont pas
        // bougé : elles sont calculées en tics depuis les CAPACITÉS des mesures qui précèdent (voir
        // _appliquerBoucle), qu'un changement de signature suffit à déplacer sans toucher à un seul
        // numéro. Le calcul est une addition sur un tableau — le refaire coûte moins cher que de se
        // demander, à chaque édition, si celle-ci pouvait l'invalider.
        const Tone = globalThis.Tone;
        if (Tone?.Transport) this._appliquerBoucle(partition, Tone.Transport.PPQ);
        return bouge;
    }

    /**
     * REPROGRAMME LA LECTURE EN COURS, sans l'interrompre — pour que ce qu'on entend suive ce qu'on
     * écrit.
     *
     * LE DÉFAUT (retour utilisateur : « lorsque je modifie une mesure, la lecture audio n'est pas
     * toujours à jour et garde les informations précédentes. Elle doit s'adapter en temps réel aux
     * modifications, même lorsque la lecture en boucle n'est pas arrêtée »). `programmer` n'était
     * appelé qu'au DÉMARRAGE (voir `jouer`, sous `etat === 'arret'`) : toute la partition était
     * traduite en évènements d'horloge une fois pour toutes, et une note ajoutée ensuite n'existait
     * simplement pas pour l'audio. En boucle, le décalage devenait flagrant — on retravaille un
     * passage en l'entendant tourner, on corrige une note, et le tour suivant rejoue l'ancienne.
     *
     * POURQUOI ON PEUT LE FAIRE SANS ARRÊTER. `programmer` annule puis replace TOUS les évènements
     * à des positions ABSOLUES en tics (`${'${n}'}i`), sans jamais toucher à l'horloge elle-même : le
     * transport continue de courir, et les évènements replacés avant sa position actuelle ne se
     * redéclenchent pas — il les a déjà dépassés. Les notes en train de sonner ne sont pas coupées
     * non plus : leur relâchement vit sur l'horloge AUDIO (triggerAttackRelease l'a déjà programmé),
     * pas sur le transport que `cancel` vide.
     *
     * ET LA BOUCLE EST REPOSÉE. `Transport.cancel()` ne touche pas à loopStart/loopEnd, mais ces
     * bornes sont calculées en tics depuis des NUMÉROS de mesure : ajouter ou retirer une mesure
     * avant la boucle déplace ce qu'elle doit encadrer, et laisser les anciens tics en place ferait
     * boucler à côté. On les recalcule donc sur la partition telle qu'elle est maintenant.
     *
     * Sans effet à l'arrêt : il n'y a alors rien à rattraper, et `jouer` programmera au démarrage.
     */
    reprogrammerSiEnCours(partition) {
        const Tone = globalThis.Tone;
        if (!Tone?.Transport || this.etat === 'arret') return false;
        this.programmer(partition);
        if (this.boucleLecture) this._appliquerBoucle(partition, Tone.Transport.PPQ);
        return true;
    }

    /** Retire la boucle : la lecture continue tout droit au lieu de rebrousser chemin. */
    /**
     * PHOTOGRAPHIE DE LA BOUCLE — bornes ET ancres, en un objet que l'on peut ranger ailleurs.
     *
     * DEUX CLIENTS, ET C'EST TOUT L'INTÉRÊT : le passage d'un onglet à l'autre (chaque morceau garde
     * sa boucle) et l'historique d'annulation (retour utilisateur : « le bouton undo/redo doit aussi
     * concerner la mise en place de la barre de lecture »). Les deux lisaient jusqu'ici
     * `boucleLecture` et `_ancresBoucle` À LA MAIN, le second champ étant PRIVÉ : deux endroits
     * dehors savaient donc quels champs composent une boucle, et un troisième aurait fini par en
     * oublier un — celui des ancres, précisément, sans lequel la boucle ne suit plus ses mesures.
     */
    instantaneBoucle() {
        if (!this.boucleLecture) return null;
        return {
            boucle: { ...this.boucleLecture },
            ancres: this._ancresBoucle ? { ...this._ancresBoucle } : null,
        };
    }

    /**
     * REPOSE UNE BOUCLE PHOTOGRAPHIÉE — `null` la retire.
     *
     * On passe par `reancrerBoucle` plutôt que d'écrire les numéros tels quels : entre la photo et
     * sa restitution, le morceau a pu changer (c'est le cas même d'une annulation, qui restaure
     * justement un autre état du document). Les ancres sont la vérité, les numéros s'en déduisent —
     * le même principe qu'à chaque édition, et donc le même code.
     */
    restaurerBoucle(partition, instantane) {
        if (!instantane || !instantane.boucle) { this.retirerBoucle(); return; }
        this.boucleLecture = { ...instantane.boucle };
        this._ancresBoucle = instantane.ancres ? { ...instantane.ancres } : null;
        this.reancrerBoucle(partition);
        // Sans ancres (une boucle posée par appel direct, que l'interface ne produit pas),
        // `reancrerBoucle` rend la main sans rien reposer : on applique alors les bornes nous-mêmes.
        if (!this._ancresBoucle) {
            const Tone = globalThis.Tone;
            if (Tone?.Transport) this._appliquerBoucle(partition, Tone.Transport.PPQ);
        }
    }

    /**
     * @param {object} [partition] la partition courante — SEULEMENT pour pouvoir redéplier les
     *   reprises si la lecture tourne (voir _reprogrammerSiDepliageChange). Omise, on retire la
     *   boucle sans reprogrammer : c'est ce que font les appels de fermeture de document, où la
     *   partition d'après n'est pas celle d'avant.
     */
    retirerBoucle(partition = null) {
        const deplierAvant = !!this._parcours;
        this.boucleLecture = null;
        this._ancresBoucle = null;
        const Tone = globalThis.Tone;
        if (Tone?.Transport) Tone.Transport.loop = false;
        if (partition) this._reprogrammerSiDepliageChange(partition, deplierAvant);
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
        const bornes = this.bornesBoucle(partition);
        if (!bornes) return;
        const ticksDebut = Math.max(0, Math.round(bornes.debut * PPQ) - EPSILON);
        const ticksFin = Math.max(ticksDebut + 1, Math.round(bornes.fin * PPQ) - EPSILON);
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
        // LE MÉTRONOME SUIT LE PARCOURS, comme les notes : sans cela il s'arrêterait de cliquer dès
        // la première reprise, et c'est précisément quand on rejoue un passage qu'on s'appuie dessus.
        // Sans reprise, `passagesDe` rend la place écrite et unique de chaque mesure — le
        // comportement d'avant, à l'identique.
        const passagesDe = (i) => {
            if (!this._parcours) return [sonneDepuisEcrit(this._grilleTernaire, positionDebutMesure(partition, i))];
            return this._parcours.passages.filter(p => p.mesure === i).map(p => p.offset);
        };
        let debutMesure = 0;
        partition.mesures.forEach((mesure, i) => {
            const capacite = capaciteMesure(partition, i);
            const unite = uniteDeGroupement(signatureEffective(partition, i));
            const nTemps = Math.max(1, Math.round(capacite / unite));
            // Une seule subdivision (donc AUCUNE, en pratique) quand le temps est déjà la plus petite
            // unité qu'on sache reconnaître (x/8 non composé, voir uniteDeGroupement) : rien de plus
            // fin à cliquer entre deux temps qui sont déjà des croches.
            const parTemps = this.metronomeSubdivision ? Math.max(1, Math.round(unite / 0.5)) : 1;
            // La place SONNÉE du début de cette mesure dans la partition écrite : c'est d'elle que
            // se comptent les clics, et d'elle qu'on se décale pour chaque passage.
            const sonneMesure = sonneDepuisEcrit(this._grilleTernaire, debutMesure);
            for (const depart of passagesDe(i)) {
                for (let t = 0; t < nTemps; t++) {
                    for (let s = 0; s < parTemps; s++) {
                        const instant = debutMesure + t * unite + s * (unite / parTemps);
                        // PAS D'ACCENT DANS UNE LEVÉE : elle ne contient aucun premier temps. Son
                        // unique clic est le dernier temps d'une mesure qui n'a pas été écrite, et
                        // l'accentuer ferait entendre un « un » là où il n'y en a pas — exactement
                        // le contresens qu'une levée est faite d'éviter. Le premier accent tombe sur
                        // la mesure d'après, à sa vraie place.
                        const accent = t === 0 && s === 0 && !(mesure.levee > 0);
                        const sub = s > 0;
                        // LE MÉTRONOME SWINGUE AVEC LA MUSIQUE, sinon son clic de contretemps
                        // taperait au milieu du temps quand la musique joue aux deux tiers — deux
                        // pulsations concurrentes, et le repère devient un piège. Les clics de TEMPS,
                        // eux, ne bougent pas : une borne de temps est un point fixe de la
                        // transformation.
                        const sonne = sonneDepuisEcrit(this._grilleTernaire, instant);
                        const ticks = Math.round((depart + (sonne - sonneMesure)) * PPQ);
                        Tone.Transport.schedule((temps) => {
                            try { this._clicMetronome(accent, temps, sub); } catch (e) { /* ignoré, comme une note manquée */ }
                        }, `${ticks}i`);
                    }
                }
            }
            // LES CLICS VIENNENT DE LA SIGNATURE, L'AVANCE DE CE QUI EST ÉCRIT. Une mesure trop
            // pleine garde ses quatre clics de 4/4 — c'est sa métrique, elle n'a pas changé — mais
            // la mesure SUIVANTE commence plus tard, là où la musique commence vraiment. Compter
            // l'avance en capacité ferait dériver le métronome de tout le débordement.
            debutMesure += longueurMesure(partition, i);
        });
    }

    /** L'index de la mesure qui contient `position` (en noires depuis le début du morceau). */
    _mesureALaPosition(partition, position) {
        let debut = 0;
        for (let i = 0; i < partition.mesures.length; i++) {
            const longueur = longueurMesure(partition, i);
            if (position < debut + longueur - 1e-6) return i;
            debut += longueur;
        }
        return Math.max(0, partition.mesures.length - 1);
    }

    /**
     * Programme UNE MESURE de clics avant le départ, et rend l'instant (horloge audio) où la musique
     * doit commencer. `null` si le décompte n'a pas lieu — à l'appelant de démarrer sans attendre.
     *
     * SUR L'HORLOGE AUDIO, PAS SUR LE TRANSPORT, et c'est tout le choix de conception. Décaler la
     * musique d'une mesure sur le transport aurait voulu dire décaler TOUT ce qui y est programmé —
     * les notes, le métronome, le point d'arrêt final, les bornes de boucle — et retrancher ce
     * décalage partout où une position de transport se relit (la tête de lecture, `positionDebutMesure`,
     * `reprogrammerSiEnCours`). Un décalage qu'une seule de ces lectures oublierait désynchroniserait
     * l'affichage du son. Le décompte n'appartient pas au morceau : il n'a donc aucune raison
     * d'exister dans son échelle de temps. Programmé sur l'horloge audio, la carte des tics reste
     * INTOUCHÉE — aucune des mécaniques ci-dessus n'a rien à réapprendre.
     *
     * LA MESURE DU DÉPART, pas la première du morceau : on lance couramment depuis le curseur ou
     * depuis une boucle (voir main.js#positionDeDepartLecture), et un décompte à 4 temps devant une
     * mesure à 3 temps mettrait justement à contretemps ce qu'il est censé mettre en place.
     *
     * PAS DE DÉCOMPTE MUET : sans métronome construit (contexte audio pas encore prêt), on rend
     * `null` plutôt que de faire attendre une mesure entière en silence — une attente sans raison
     * apparente se lit comme un blocage.
     */
    _programmerDecompte(partition, position) {
        const Tone = globalThis.Tone;
        if (!this.metronome || !Tone?.Transport) return null;
        const i = this._mesureALaPosition(partition, position);
        const sig = signatureEffective(partition, i);
        const unite = uniteDeGroupement(sig);
        // DEVANT UNE LEVÉE, ON COMPTE LA MESURE PLEINE, pas la levée. Un décompte sert à installer
        // la pulsation avant d'entrer ; devant une levée d'une noire il ne durerait qu'un clic, et
        // on entrerait sans savoir où est le premier temps — c'est-à-dire sans rien de ce qu'on lui
        // demande. `capaciteMesure` rend ici la longueur courte de la levée : on passe donc
        // délibérément par la signature.
        const longueur = partition.mesures[i]?.levee > 0 ? noiresParMesure(sig) : capaciteMesure(partition, i);
        const nTemps = Math.max(1, Math.round(longueur / unite));
        // EN SECONDES AU TEMPO COURANT : un décompte se compte à la vitesse de ce qui suit. Les tics
        // ne servent à rien ici — on ne programme pas sur le transport, justement (voir ci-dessus).
        const parTemps = Tone.Ticks(Math.round(unite * Tone.Transport.PPQ)).toSeconds();
        // Une petite avance : un son posé exactement à `now()` arrive parfois déjà en retard, et le
        // premier clic du décompte est celui qu'il ne faut surtout pas manquer.
        const depart = Tone.now() + 0.08;
        for (let t = 0; t < nTemps; t++) {
            try { this._clicMetronome(t === 0, depart + t * parTemps, false); } catch (e) { /* ignoré, comme une note manquée */ }
        }
        return depart + nTemps * parTemps;
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
        const ATTENTE = 0.18, MONTEE = 0.42;   // en fraction de la durée sonnante
        // Un seul palier : on tient la hauteur écrite, puis on pousse jusqu'à la hauteur visée.
        this._jouerGlissando(e.bend.midi, [{
            depuis: secondes * ATTENTE,
            a: secondes * (ATTENTE + MONTEE),
            midi: e.bend.midi + e.bend.demiTons,
        }], secondes, temps, e.velocite, e.note);
    }

    /**
     * Joue un SLIDE : une seule attaque, puis la hauteur glisse de palier en palier.
     *
     * LA FORME DU GESTE. Sur l'instrument, on tient la note, puis le doigt part vers sa destination
     * et y arrive SUR LE TEMPS de la note suivante. On garde donc chaque hauteur jusqu'aux derniers
     * instants de sa propre durée, et on glisse sur cette fin — jamais une rampe qui commencerait dès
     * l'attaque, laquelle s'entendrait comme un dérapage plutôt que comme un déplacement voulu.
     *
     * LA PART GLISSÉE : 45 % de la durée du palier qu'on quitte, PLAFONNÉE (PLAFOND_GLISSE). Les deux
     * bornes comptent. Sans la proportion, un slide sur une double-croche (0,125 s à 120 bpm — très
     * exactement le cas signalé) se verrait allouer la même durée de glissement qu'une ronde, soit
     * plus que la note entière : la hauteur n'aurait pas fini de bouger que la note serait terminée,
     * et on n'entendrait qu'un flou. Sans le plafond, à l'inverse, un slide sur une ronde étalerait
     * son glissement sur près d'une seconde — un hurlement de sirène, pas un slide de guitare.
     *
     * `exponentialRampToValueAtTime`, pour la raison exacte donnée à _jouerBend : la hauteur perçue
     * suit le logarithme de la fréquence, donc une rampe linéaire en hertz s'entend comme une montée
     * qui ralentit sur la fin.
     */
    _jouerSlide(e, ticksDuree, temps) {
        const Tone = globalThis.Tone;
        const PART_GLISSEE = 0.45, PLAFOND_GLISSE = 0.16;   // fraction du palier quitté ; secondes
        const secondes = Tone.Ticks(ticksDuree).toSeconds();
        // Les paliers sont datés en NOIRES depuis le début du son (voir programmer) : on les convertit
        // ici, donc au tempo courant — jamais à celui figé au moment du calcul.
        const enSecondes = (noires) => Tone.Ticks(Math.round(noires * Tone.Transport.PPQ)).toSeconds();

        const paliers = [];
        let debutPalier = 0;
        for (const etape of e.glisse.etapes) {
            const arrivee = enSecondes(etape.arriveeA);
            const glissement = Math.min((arrivee - enSecondes(debutPalier)) * PART_GLISSEE, PLAFOND_GLISSE);
            // Tenir la hauteur jusqu'au départ du doigt, puis glisser pour arriver pile sur le temps.
            paliers.push({ depuis: Math.max(0, arrivee - glissement), a: arrivee, midi: etape.midi });
            debutPalier = etape.arriveeA;
        }
        this._jouerGlissando(e.glisse.midi, paliers, secondes, temps, e.velocite, e.note);
    }

    /**
     * JOUE UNE HAUTEUR QUI BOUGE — le mécanisme commun au bend et au slide.
     *
     * UNE SEULE DESCRIPTION DE LA COURBE, EN MIDI, lue par DEUX voix possibles : l'échantillon de
     * piano dont on fait glisser la vitesse de lecture (voir demarrer, this._sortieGlissando), et le
     * synthé de repli quand les échantillons ne sont pas là. C'est tout l'intérêt de ce passage par
     * une liste de paliers plutôt que deux méthodes qui programmeraient chacune leur rampe : deux
     * chemins qui décrivent le même geste finissent par ne plus décrire le même geste — l'un gagnant
     * une correction de forme que l'autre n'a pas, et le repli devenant un son que personne n'écoute
     * plus jamais en le croyant identique.
     *
     * `exponentialRampToValueAtTime` dans les deux cas, et pour la même raison : la hauteur perçue
     * suit le logarithme de la fréquence, donc une rampe linéaire s'entend comme un mouvement qui
     * ralentit sur la fin. L'exponentielle donne un glissement régulier À L'OREILLE — ce que fait un
     * doigt sur une corde.
     *
     * @param {number} midiDepart    la hauteur attaquée.
     * @param {Array<{depuis: number, a: number, midi: number}>} paliers  instants EN SECONDES depuis
     *        l'attaque : `depuis` = la hauteur commence à bouger, `a` = elle arrive.
     * @param {number} secondes      durée sonnante.
     * @param {number} temps         instant d'attaque, sur l'horloge audio.
     * @param {number} velocite
     * @param {string} note          le nom de la note, pour le tout dernier filet.
     */
    _jouerGlissando(midiDepart, paliers, secondes, temps, velocite, note) {
        if (this._buffersPiano?.loaded) {
            this._glissandoEchantillonne(midiDepart, paliers, secondes, temps, velocite);
            return;
        }
        if (this.voixBend) {
            this._glissandoSynthetise(midiDepart, paliers, secondes, temps, velocite);
            return;
        }
        // Dernier filet : jamais de note muette. Une note plaquée vaut mieux qu'un silence.
        this.synthe?.triggerAttackRelease(note, secondes, temps, velocite);
    }

    /**
     * LE VRAI PIANO QUI GLISSE : on joue soi-même l'échantillon le plus proche et on fait glisser sa
     * VITESSE DE LECTURE. `playbackRate` est un paramètre rampable (vérifié), là où ni Tone.Sampler ni
     * Tone.PolySynth n'offrent de prise sur la hauteur d'une voix déjà attaquée.
     *
     * LE TAUX EST RELATIF À L'ÉCHANTILLON, pas à la note : 2^((midi - midiÉchantillon)/12). C'est
     * exactement ce que fait un échantillonneur pour toutes ses notes — jouer l'échantillon de do à
     * 1,06 pour obtenir un do dièse. Ici on ne fait que continuer de bouger ce taux pendant la note.
     */
    _glissandoEchantillonne(midiDepart, paliers, secondes, temps, velocite) {
        const Tone = globalThis.Tone;
        const ech = echantillonLePlusProche(midiDepart);
        const taux = (midi) => Math.pow(2, (midi - ech.midi) / 12);

        // UN OBJET PAR NOTE, et c'est la nature d'un lecteur de buffer : il ne se réattaque pas, il se
        // crée et se jette. La vélocité passe donc par un gain à soi (un `ToneBufferSource` n'en tient
        // pas compte, contrairement à `Sampler.triggerAttackRelease`).
        const gain = new Tone.Gain(velocite).connect(this._sortieGlissando);
        const source = new Tone.ToneBufferSource({
            url: this._buffersPiano.get(ech.nom),
            fadeOut: FONDU_GLISSANDO,
            curve: 'exponential',
        }).connect(gain);

        source.playbackRate.setValueAtTime(taux(midiDepart), temps);
        let midiTenu = midiDepart;   // la hauteur EN VIGUEUR à ce point du parcours
        for (const p of paliers) {
            // `midiTenu` et NON `playbackRate.value` : ce dernier rendrait la valeur au moment où l'on
            // PROGRAMME, pas celle qui régnera à cet instant-là du futur. Une rampe partirait alors
            // d'ailleurs que là où le son se trouve — un saut audible en plein glissando.
            source.playbackRate.setValueAtTime(taux(midiTenu), temps + p.depuis);
            source.playbackRate.exponentialRampToValueAtTime(taux(p.midi), temps + p.a);
            midiTenu = p.midi;
        }
        // On se range dans le registre AVANT de démarrer : un Stop qui tomberait entre les deux
        // trouverait sinon une source qui joue et qu'il ne connaît pas.
        const jetable = { source, gain };
        this._glissandos.add(jetable);
        source.onended = () => {
            this._glissandos.delete(jetable);
            try { source.dispose(); gain.dispose(); } catch (e) { /* déjà jeté par _taireGlissandos */ }
        };
        source.start(temps);
        // La queue laisse l'échantillon résonner comme le ferait l'échantillonneur (`release: 1`),
        // et le fondu évite le clic d'un piano coupé net en pleine résonance.
        source.stop(temps + secondes + QUEUE_GLISSANDO);
    }

    /** LE REPLI, quand les échantillons ne sont pas là (hors ligne, réseau lent) : la même courbe,
     *  jouée par le synthé monophonique. Timbre plus maigre, mais un glissement qui s'entend — et
     *  c'est le seul cas où l'utilisateur retrouve le son qu'il a signalé comme « analogique ». */
    _glissandoSynthetise(midiDepart, paliers, secondes, temps, velocite) {
        const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
        const depart = freq(midiDepart);
        this.voixBend.frequency.cancelScheduledValues(temps);
        this.voixBend.frequency.setValueAtTime(depart, temps);
        let midiTenu = midiDepart;
        for (const p of paliers) {
            this.voixBend.frequency.setValueAtTime(freq(midiTenu), temps + p.depuis);
            this.voixBend.frequency.exponentialRampToValueAtTime(freq(p.midi), temps + p.a);
            midiTenu = p.midi;
        }
        // `triggerAttackRelease` d'un Tone.Synth REPOSE sa propre fréquence à la note demandée : on lui
        // passe donc la hauteur de DÉPART, et les rampes programmées ci-dessus prennent le relais.
        this.voixBend.triggerAttackRelease(depart, secondes, temps, velocite);
    }

    /** Coupe tous les glissandos en cours. Appelé par pause() et arreter() : un lecteur de buffer
     *  n'est pas une voix qu'on relâche, il faut l'arrêter nommément (voir this._glissandos). */
    _taireGlissandos() {
        if (!this._glissandos) return;
        for (const { source, gain } of [...this._glissandos]) {
            try { source.stop(); } catch (e) { /* pas encore démarrée : sans objet */ }
            try { source.dispose(); gain.dispose(); } catch (e) { /* déjà jetée */ }
        }
        this._glissandos.clear();
    }

    async jouer(partition, depuis = null) {
        await this.demarrer();
        const Tone = globalThis.Tone;
        if (this.etat === 'lecture') return;
        // LE DÉCOMPTE SUR UN VRAI DÉPART, JAMAIS SUR UNE REPRISE. Reprendre après une pause, c'est
        // repartir au milieu d'une phrase : compter quatre temps devant la seconde moitié d'une
        // mesure tromperait l'oreille au lieu de la guider. La condition est exactement celle qui
        // décide de reprogrammer le transport ci-dessous — un départ, par définition.
        const vraiDepart = this.etat === 'arret' || depuis !== null;
        if (vraiDepart) {
            this.programmer(partition);
            // `depuis` est une position ÉCRITE (un début de mesure, voir main.js) : l'horloge, elle,
            // compte le temps sonné. La conversion est l'identité sur une borne de mesure — mais
            // c'est elle qui fait qu'un départ posé AILLEURS (au milieu d'un temps) tombe au bon
            // endroit du son, plutôt qu'un tiers de temps trop tôt.
            // …puis, s'il y a des reprises dépliées, du temps sonné au temps JOUÉ : on part au
            // PREMIER passage qui couvre cet endroit (voir _joueDepuisSonne). Partir « à la mesure 3 »
            // veut dire la première fois qu'on y arrive, jamais la reprise.
            const sonne = sonneDepuisEcrit(this._grilleTernaire, depuis ?? 0);
            Tone.Transport.ticks = Math.round(this._joueDepuisSonne(sonne) * Tone.Transport.PPQ);
        }
        // `start(quand)` diffère le départ du transport à cet instant de l'horloge audio, sans rien
        // changer à ce qui y est programmé : pendant le décompte, les tics restent à leur place et la
        // tête de lecture attend au point de départ, exactement comme il faut.
        const quand = vraiDepart && this.decompteActif ? this._programmerDecompte(partition, depuis ?? 0) : null;
        Tone.Transport.start(quand ?? undefined);
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
        this._taireGlissandos();
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
        this._taireGlissandos();
        this.etat = 'arret';
        this.position = 0;
        this._arreterSuivi();
        this._prevenir();
    }

    /** Ajustement du tempo EN COURS de lecture : Tone.js réétire l'horloge, rien à reprogrammer.
     *  Vaut aussi pour la vitesse de travail — c'est la même horloge, le même étirement. */
    definirTempo(bpm) {
        this.tempoEcrit = Math.max(20, Math.min(400, Number(bpm) || 120));
        this._appliquerTempo();
    }

    /**
     * Vitesse de travail, en fraction du tempo écrit (0,25 à 1). Voir le constructeur pour le
     * pourquoi des deux nombres.
     *
     * LES BORNES : 25 % parce qu'au quart d'un tempo lent (60 bpm → 15) les notes cessent de former
     * une phrase, et 100 % parce que ce réglage existe pour RALENTIR — jouer plus vite que l'écrit
     * se fait en écrivant le bon tempo. Rien n'interdirait d'aller au-delà (une seule constante),
     * mais un maximum à 100 % garde au bouton une lecture immédiate : il ne peut que ralentir.
     */
    definirVitesse(fraction) {
        const v = Number(fraction);
        this.vitesse = Math.max(0.25, Math.min(1, Number.isFinite(v) ? v : 1));
        this._appliquerTempo();
        return this.vitesse;
    }

    /** LE SEUL endroit qui écrive sur l'horloge : tempo écrit × vitesse de travail. Tout chemin qui
     *  poserait `Tone.Transport.bpm` directement effacerait la vitesse sans le dire — c'est
     *  exactement ce que faisait `programmer`, et ce que ce point de passage unique empêche. */
    _appliquerTempo() {
        const Tone = globalThis.Tone;
        if (Tone?.Transport) Tone.Transport.bpm.value = this.tempoEcrit * this.vitesse;
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
            //
            // PUIS RAMENÉE AU TEMPS ÉCRIT : l'horloge compte le temps SONNÉ, la partition affiche le
            // temps ÉCRIT, et sur un morceau swingué les deux ne coïncident plus qu'aux bornes de
            // temps. Sans cette réciproque, la tête de lecture avancerait en retard d'un tiers de
            // temps sur chaque contretemps — visible à l'œil nu, et pire que pas de ternaire du tout.
            // DEUX CONVERSIONS, dans cet ordre. Le transport compte sur la ligne du temps JOUÉE
            // (reprises dépliées) ; on revient d'abord à la ligne SONNÉE de la partition écrite, puis
            // de celle-ci au temps ÉCRIT (le ternaire). Sans reprise, la première est l'identité et
            // rien ne change. C'est ce qui permet à la tête de lecture de rester UNE marque sur UNE
            // note, quand cette note est jouée trois fois : l'écran ignore tout du dépliage.
            const joue = Tone.Transport.ticks / Tone.Transport.PPQ;
            this.position = ecritDepuisSonne(this._grilleTernaire, this._sonneDepuisJoue(joue));
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
