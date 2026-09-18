// Export MusicXML — le format d'échange entre éditeurs de partition.
//
// POURQUOI CE FORMAT PLUTÔT QU'UN AUTRE. TabHub savait déjà sortir trois choses : un `.json` (le
// sien, complet mais que lui seul relit), un PDF (une image, qu'on ne peut plus éditer) et un `.mid`
// (les hauteurs et les durées, mais rien de l'ÉCRITURE — ni corde, ni case, ni liaison, ni hammer-on,
// ni nom d'accord). MusicXML est le seul format que MuseScore, Finale, Sibelius, Dorico et Guitar Pro
// lisent tous, et le seul qui transporte la TABLATURE : la corde et la case de chaque note y sont des
// éléments de première classe (`<string>`, `<fret>`), pas une astuce.
//
// VERSION 3.1, ET NON LA 4.0. La 4.0 n'apporte rien dont cet export ait besoin, et 3.1 est la
// version que TOUT lecteur en service accepte — y compris les Finale et Sibelius d'il y a quelques
// années, qui sont précisément ceux d'un professeur ou d'un arrangeur à qui l'on envoie un fichier.
// Le choix se paie zéro et couvre plus large.
//
// CE QUI PART, ET C'EST LE POINT : la partition ÉCRITE, pas ce qu'on entend. Deux portées liées
// (notation + tablature), les figures avec leurs points et leurs n-olets, les liaisons de
// prolongation MÊME par-dessus une barre de mesure, les hammer-on / pull-off / slides / bends, les
// deux voix, les silences, l'armure et son mode, les signatures (y compris un changement en cours de
// morceau), le tempo, les reprises et leur nombre de fois, les barres doubles et finales, les repères
// de navigation (Segno, Coda, D.C., D.S., al Coda, Fine), les noms d'accords en vraies harmonies, les
// annotations de section, les nuances, l'accent, le staccato, le palm mute, les notes fantômes,
// l'accordage corde par corde, et le capodastre — fondu dans l'accordage déclaré plutôt qu'écrit en
// `<capo>`, pour une raison mesurée que poserAccordage détaille (un fichier qui se contredisait d'une
// portée à l'autre), avec l'indication reportée en texte.
//
// CE QUI NE PART PAS, dit franchement :
//   • LE SWING n'a pas d'élément standard en MusicXML 3.1 — MuseScore le range dans son propre
//     format. Il sort donc en TEXTE au-dessus de la première mesure (« Swing ♫ = ♩♪ »), lisible par
//     un humain, ignoré par la machine. Les notes, elles, partent DROITES : c'est l'écriture juste,
//     et c'est ce que la convention veut dire.
//   • LA VITESSE DE TRAVAIL, évidemment : elle n'est pas dans la partition (voir audio/player.js).
//   • LA MISE EN PAGE n'est pas imposée, sauf les retours à la ligne demandés explicitement
//     (`mesure.sautAvant` -> `<print new-system="yes"/>`). Le nombre de mesures par ligne de TabHub
//     est un réglage d'écran, pas une propriété du morceau : l'imposer au lecteur serait lui dicter
//     une gravure qu'il sait faire mieux, sur son format de papier.
//
// PUR, ET C'EST VOULU : ce module fabrique une CHAÎNE et ne touche à rien. `exporterMusicXML` en bas
// est le seul à connaître le navigateur. Tout le reste s'éprouve sans navigateur (voir
// tests/musicxml_test.js), y compris la validation de l'arbre XML.

import { dureeEnNoires } from '../model/duration.js';
import {
    signatureEffective, armureEffective, modeEffectif, capaciteMesure, dureeEcrite,
    hauteurDeNote, nbCordes, decouperEnEvenements,
} from '../model/score.js';
import { ecrireHauteur } from '../model/theory.js';
import { memoireAlterations } from '../engine/layout.js';
import { INSTRUMENTS } from '../model/instruments.js';
import { nomPour, enregistrerFichier } from './fichiers.js';

// DIVISIONS PAR NOIRE. 480, comme le PPQ de l'export MIDI, et pour la même raison : toute durée que
// TabHub sait écrire doit y tomber sur un ENTIER, puisque MusicXML n'accepte pas autre chose. La
// triple-croche vaut 60, son triolet 20, un quintolet de doubles 24. Un nombre plus petit (24, que
// beaucoup d'exports utilisent) suffirait aux figures simples et casserait au premier quintolet.
const DIVISIONS = 480;

/** Figure MusicXML d'une valeur de figure TabHub. */
const TYPES = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd' };

/** Nuance TabHub -> élément de `<dynamics>`. Les huit de NUANCES sont toutes des éléments valides. */
const DYNAMIQUES = new Set(['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff']);

/** Échappement XML. Les cinq caractères, sans exception : un titre contient « & » plus souvent qu'on
 *  ne le croit, et un fichier mal échappé n'est pas « un peu faux », il est illisible. */
function esc(texte) {
    return String(texte ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Accumulateur de lignes indentées. Un tableau de chaînes plutôt qu'une concaténation : sur un
 * morceau de deux cents mesures à deux portées, la seconde recopie la chaîne entière à chaque ajout.
 */
function creerFlux() {
    const lignes = [];
    let profondeur = 0;
    return {
        ligne(texte) { lignes.push('  '.repeat(profondeur) + texte); },
        ouvrir(balise, attrs = '') { this.ligne(`<${balise}${attrs}>`); profondeur += 1; },
        fermer(balise) { profondeur -= 1; this.ligne(`</${balise}>`); },
        seule(balise, contenu, attrs = '') {
            if (contenu === '' || contenu == null) this.ligne(`<${balise}${attrs}/>`);
            else this.ligne(`<${balise}${attrs}>${contenu}</${balise}>`);
        },
        rendu() { return lignes.join('\n') + '\n'; },
    };
}

// ─────────────────────────────── L'EN-TÊTE ───────────────────────────────

/**
 * Clé et transposition d'écriture selon l'instrument.
 *
 * LA GUITARE S'ÉCRIT UNE OCTAVE AU-DESSUS DE CE QU'ELLE SONNE — c'est la convention de toute
 * partition de guitare, et `<clef-octave-change>-1</clef-octave-change>` est la manière de le dire.
 * Sans elle, un lecteur placerait les notes à leur hauteur RÉELLE : une partie de guitare
 * entièrement sous la portée, illisible. La basse fait de même en clé de fa.
 */
function clefsDe(instrumentId) {
    const clef = INSTRUMENTS[instrumentId]?.clef || 'sol8vb';
    if (clef === 'fa8vb') return [{ numero: 1, signe: 'F', ligne: 4, octave: -1 }];
    if (clef === 'grandPortee') return [{ numero: 1, signe: 'G', ligne: 2 }, { numero: 2, signe: 'F', ligne: 4 }];
    return [{ numero: 1, signe: 'G', ligne: 2, octave: -1 }];
}

/** Le piano n'a pas de tablature ; les trois autres en ont une, sur une seconde portée. */
function aUneTablature(partition) {
    return (INSTRUMENTS[partition.piste.instrument]?.clef || '') !== 'grandPortee' && nbCordes(partition) > 0;
}

/** `<staff-tuning>` corde par corde, de la 1 (la plus aiguë) à la dernière — l'ordre de MusicXML est
 *  celui de TabHub (`accordage.cordes[0]` est la corde du haut, la plus aiguë). Rien à retourner. */
function poserAccordage(flux, partition) {
    const cordes = partition.piste.accordage.cordes;
    const capo = partition.piste.capo || 0;
    flux.ouvrir('staff-details', ' number="2"');
    flux.seule('staff-lines', String(cordes.length));
    // LE CAPODASTRE EST FONDU DANS L'ACCORDAGE, et `<capo>` n'est PAS écrit. Ce n'est pas la lecture
    // naïve du format — il a bien un élément `<capo>`, dont la spécification dit qu'il « décale
    // l'accordage des cordes d'autant de demi-tons ». C'est une décision prise sur une MESURE.
    //
    // CE QUI A ÉTÉ MESURÉ. Le morceau d'essai (capodastre à la case 2) a été relu par Verovio, un
    // moteur de gravure indépendant, puis rendu en MIDI et comparé note à note à la partition
    // d'origine : 14 notes justes et 14 exactement DEUX DEMI-TONS plus bas. Les justes venaient de
    // la portée de notation, où la hauteur est écrite en clair ; les fausses de la portée de
    // tablature, où le lecteur recalcule corde + case + accordage — sans appliquer le `<capo>`.
    //
    // POURQUOI C'EST GRAVE, ET PAS UN SIMPLE DÉFAUT DE LECTEUR. Le fichier se CONTREDISAIT lui-même :
    // ses deux portées, censées porter la même musique, ne décrivaient plus la même hauteur. Un
    // lecteur qui honore `<capo>` s'en sortait, un autre non — et rien dans le fichier ne permettait
    // de trancher. En fondant le capodastre dans l'accordage déclaré, corde + case + accordage donne
    // la hauteur sonnante CHEZ TOUT LE MONDE, et il n'y a plus de `<capo>` pour la compter deux fois.
    //
    // CE QU'ON PERD, ET COMMENT ON LE RATTRAPE : le lecteur ne sait plus qu'un capodastre est posé —
    // or pour un guitariste, une case 0 avec capodastre n'est pas le sillet. L'indication part donc
    // en TEXTE au-dessus de la première mesure (« Capodastre case 2 », voir genererMusicXML). Un
    // humain la lit, et la hauteur reste juste pour la machine : c'est le bon partage.
    cordes.forEach((midi, i) => {
        const h = ecrireHauteur(midi + capo, 0);
        flux.ouvrir('staff-tuning', ` line="${cordes.length - i}"`);
        flux.seule('tuning-step', h.lettre);
        if (h.alteration) flux.seule('tuning-alter', String(h.alteration));
        flux.seule('tuning-octave', String(h.octave));
        flux.fermer('staff-tuning');
    });
    flux.fermer('staff-details');
}

// ─────────────────────────────── LES ACCORDS ───────────────────────────────

/**
 * « A7 », « Cm », « F#maj7 » -> une vraie `<harmony>`.
 *
 * POURQUOI ANALYSER PLUTÔT QUE RECOPIER EN TEXTE. Un nom d'accord posé en `<words>` s'affiche, et
 * c'est tout : il ne se transpose pas, ne se joue pas, ne s'aligne pas sur la grille harmonique. En
 * `<harmony>`, MuseScore le transpose avec le morceau et peut le réaliser. Ce sont vingt lignes pour
 * la différence entre une étiquette et une information.
 *
 * CE QU'ON NE SAIT PAS LIRE N'EST PAS PERDU : `kind` vaut alors `other` et garde le texte d'origine
 * dans son attribut `text`, ce que le format prévoit exactement pour ce cas. Aucun nom d'accord ne
 * disparaît, même exotique.
 */
const SUFFIXES = [
    ['maj7', 'major-seventh'], ['maj9', 'major-ninth'], ['m7b5', 'half-diminished'],
    ['m11', 'minor-eleventh'], ['m9', 'minor-ninth'], ['m7', 'minor-seventh'], ['m6', 'minor-sixth'],
    ['mmaj7', 'major-minor'], ['dim7', 'diminished-seventh'], ['dim', 'diminished'],
    ['aug', 'augmented'], ['sus4', 'suspended-fourth'], ['sus2', 'suspended-second'],
    ['sus', 'suspended-fourth'], ['add9', 'major'], ['13', 'dominant-thirteenth'],
    ['11', 'dominant-eleventh'], ['9', 'dominant-ninth'], ['7', 'dominant'],
    ['6', 'major-sixth'], ['5', 'power'], ['m', 'minor'], ['', 'major'],
];

export function analyserAccord(texte) {
    const brut = String(texte || '').trim();
    const m = /^([A-Ga-g])([#b♯♭]?)(.*)$/.exec(brut);
    if (!m) return null;
    const lettre = m[1].toUpperCase();
    const alter = (m[2] === '#' || m[2] === '♯') ? 1 : ((m[2] === 'b' || m[2] === '♭') ? -1 : 0);
    // La basse d'un accord slash (« G/B ») se lit à part ; le reste du suffixe décide du `kind`.
    const [suffixe, basse] = m[3].split('/');
    const trouve = SUFFIXES.find(([s]) => s === suffixe.trim());
    const kind = trouve ? trouve[1] : 'other';
    const sortie = { lettre, alter, kind, texte: brut };
    if (!trouve) sortie.kindTexte = suffixe.trim();
    if (basse) {
        const b = /^([A-Ga-g])([#b♯♭]?)/.exec(basse.trim());
        if (b) sortie.basse = { lettre: b[1].toUpperCase(), alter: (b[2] === '#' || b[2] === '♯') ? 1 : ((b[2] === 'b' || b[2] === '♭') ? -1 : 0) };
    }
    return sortie;
}

function poserHarmonie(flux, texte) {
    const a = analyserAccord(texte);
    if (!a) return;
    flux.ouvrir('harmony', ' print-frame="no"');
    flux.ouvrir('root');
    flux.seule('root-step', a.lettre);
    if (a.alter) flux.seule('root-alter', String(a.alter));
    flux.fermer('root');
    flux.seule('kind', a.kind, a.kindTexte ? ` text="${esc(a.kindTexte)}"` : '');
    if (a.basse) {
        flux.ouvrir('bass');
        flux.seule('bass-step', a.basse.lettre);
        if (a.basse.alter) flux.seule('bass-alter', String(a.basse.alter));
        flux.fermer('bass');
    }
    flux.fermer('harmony');
}

// ─────────────────────────────── LES DIRECTIONS ───────────────────────────────

function poserMots(flux, texte, placement = 'above', gras = false) {
    flux.ouvrir('direction', ` placement="${placement}"`);
    flux.ouvrir('direction-type');
    flux.seule('words', esc(texte), gras ? ' font-weight="bold"' : '');
    flux.fermer('direction-type');
    flux.fermer('direction');
}

function poserTempo(flux, bpm) {
    flux.ouvrir('direction', ' placement="above"');
    flux.ouvrir('direction-type');
    flux.ouvrir('metronome');
    flux.seule('beat-unit', 'quarter');
    flux.seule('per-minute', String(bpm));
    flux.fermer('metronome');
    flux.fermer('direction-type');
    // `<sound>` EN PLUS du métronome gravé : l'un se lit, l'autre se joue. Un lecteur qui n'aurait
    // que l'indication visuelle rejouerait le morceau à son tempo par défaut.
    flux.seule('sound', '', ` tempo="${bpm}"`);
    flux.fermer('direction');
}

/** Les six repères de navigation de TabHub, chacun avec ce que le format prévoit pour lui. */
function poserRepere(flux, repere) {
    const parTexte = { daCapo: ['D.C.', ' dacapo="yes"'], dalSegno: ['D.S.', ' dalsegno="segno"'],
                       alCoda: ['al Coda', ' tocoda="coda"'], fine: ['Fine', ' fine="yes"'] };
    if (repere === 'segno' || repere === 'coda') {
        flux.ouvrir('direction', ' placement="above"');
        flux.ouvrir('direction-type');
        flux.seule(repere, '');
        flux.fermer('direction-type');
        flux.seule('sound', '', repere === 'segno' ? ' segno="segno"' : ' coda="coda"');
        flux.fermer('direction');
        return;
    }
    const t = parTexte[repere];
    if (!t) return;
    flux.ouvrir('direction', ' placement="above"');
    flux.ouvrir('direction-type');
    flux.seule('words', t[0], ' font-weight="bold"');
    flux.fermer('direction-type');
    flux.seule('sound', '', t[1]);
    flux.fermer('direction');
}

// ─────────────────────────────── LES NOTES ───────────────────────────────

/**
 * Chaîne des évènements d'une voix, par mesure, avec de quoi répondre à trois questions qu'une note
 * seule ne peut pas trancher :
 *   • cette note PROLONGE-t-elle la précédente (fin de liaison) — il faut regarder derrière ;
 *   • ce n-olet COMMENCE-t-il ou FINIT-il ici — il faut regarder des deux côtés ;
 *   • l'effet de liaison (hammer, pull, slide) a-t-il une note d'arrivée — sinon on n'ouvre rien.
 * Les liaisons TRAVERSENT les barres de mesure (voir engine/layout.js#reporterLiaison) : la chaîne
 * est donc construite sur la VOIX ENTIÈRE du morceau, jamais mesure par mesure.
 */
function chainerVoix(partition, iVoix) {
    const suite = [];
    partition.mesures.forEach((mesure, iMesure) => {
        const evenements = mesure.voix[iVoix]?.evenements || [];
        evenements.forEach((ref, iEvenement) => suite.push({ iMesure, iEvenement, ref }));
    });
    return suite;
}

/** Le lien porté par la note de MÊME CORDE de l'évènement précédent, s'il y en a un. */
function lienEntrant(suite, index, corde) {
    const precedent = suite[index - 1];
    if (!precedent) return null;
    const note = precedent.ref.notes?.find(n => n.corde === corde);
    return note?.lien || null;
}

/** La note de MÊME CORDE de l'évènement suivant existe-t-elle ? Un hammer-on sans arrivée ne
 *  s'ouvre pas : un `<slur type="start">` jamais refermé casse la lecture chez certains éditeurs. */
function aUneArrivee(suite, index, corde) {
    const suivant = suite[index + 1];
    if (!suivant || suivant.ref.silence) return false;
    return !!suivant.ref.notes?.find(n => n.corde === corde);
}

function memeNolet(a, b) {
    if (!a || !b) return false;
    return a.dans === b.dans && a.valent === b.valent;
}

/**
 * Une note (ou un silence) complète. `contexte` porte tout ce qui ne se lit pas sur l'évènement
 * lui-même : la voix MusicXML, la portée, la chaîne pour regarder devant et derrière.
 */
function poserNote(flux, partition, evt, note, ctx) {
    const { iVoix, voixXml, portee, suite, index, premiere, armure, avecCordeCase, avecJeu } = ctx;
    const duree = Math.round(dureeEnNoires(evt.duree) * DIVISIONS);
    const silence = evt.silence || !evt.notes?.length;

    flux.ouvrir('note');
    if (!premiere && !silence) flux.seule('chord', '');
    const ecrit = silence ? null : ecrireHauteur(hauteurDeNote(partition, note) ?? 60, armure);
    if (silence) {
        flux.seule('rest', '');
    } else {
        const h = ecrit;
        flux.ouvrir('pitch');
        flux.seule('step', h.lettre);
        if (h.alteration) flux.seule('alter', String(h.alteration));
        flux.seule('octave', String(h.octave));
        flux.fermer('pitch');
    }
    flux.seule('duration', String(duree));

    // LES LIAISONS DE PROLONGATION : `<tie>` (ce qui SONNE) et `<tied>` (ce qui SE DESSINE) sont deux
    // éléments distincts du format, et il faut les DEUX — le premier pour qu'un lecteur ne réattaque
    // pas la note, le second pour qu'il trace l'arc. Beaucoup d'exports n'écrivent que le second, et
    // le fichier se rejoue alors en notes répétées.
    const entrant = silence ? null : lienEntrant(suite, index, note.corde);
    if (!silence && entrant === 'tie') flux.seule('tie', '', ' type="stop"');
    if (!silence && note.lien === 'tie' && aUneArrivee(suite, index, note.corde)) flux.seule('tie', '', ' type="start"');

    flux.seule('voice', String(voixXml));
    const type = TYPES[evt.duree.valeur];
    if (type) flux.seule('type', type);
    for (let d = 0; d < (evt.duree.points || 0); d++) flux.seule('dot', '');
    // ALTÉRATION ACCIDENTELLE : `<accidental>` est le SIGNE DESSINÉ, pas la hauteur (celle-ci est
    // déjà dans `<alter>`). Et c'est la MÊME mémoire de mesure que la gravure à l'écran
    // (engine/layout.js#memoireAlterations) qui décide : une altération vaut jusqu'à la barre pour
    // toutes les notes de même nom et même octave. Sans elle, un riff chromatique répétant la même
    // note porterait un dièse devant chacune de ses occurrences — et, plus grave, un si naturel en
    // fa majeur n'aurait AUCUN bécarre, puisque son altération vaut zéro.
    //
    // SUR LA PORTÉE DE NOTATION SEULEMENT : une tablature n'affiche pas d'altération, et consommer
    // la mémoire deux fois (une par portée) la fausserait pour la portée suivante.
    if (!silence && ctx.memoire) {
        const signes = { '-2': 'flat-flat', '-1': 'flat', '0': 'natural', '1': 'sharp', '2': 'sharp-sharp' };
        const aDessiner = ctx.memoire.besoin(ecrit);
        if (aDessiner != null && signes[String(aDessiner)]) flux.seule('accidental', signes[String(aDessiner)]);
    }
    if (evt.duree.nolet) {
        flux.ouvrir('time-modification');
        flux.seule('actual-notes', String(evt.duree.nolet.dans));
        flux.seule('normal-notes', String(evt.duree.nolet.valent));
        flux.fermer('time-modification');
    }
    // LE SENS DE HAMPE VIENT DE LA VOIX, et seulement quand il y en a deux : c'est ainsi que TabHub
    // les grave (voir engine/layout.js, `sensImpose`) et ce qui les rend lisibles. À une seule voix
    // on ne dit rien — le lecteur décide mieux que nous, en fonction de la hauteur.
    if (!silence && ctx.nbVoix > 1) flux.seule('stem', iVoix === 0 ? 'up' : 'down');
    // NOTE FANTÔME : une tête entre parenthèses, exactement ce que TabHub dessine.
    if (!silence && note.ghost) flux.seule('notehead', 'normal', ' parentheses="yes"');
    if (ctx.nbPortees > 1) flux.seule('staff', String(portee));

    // --- Notations : tout ce qui se pose SUR la note ---
    const nolet = evt.duree.nolet;
    const noletAvant = suite[index - 1]?.ref?.duree?.nolet;
    const noletApres = suite[index + 1]?.ref?.duree?.nolet;
    const debutNolet = nolet && !memeNolet(nolet, noletAvant);
    const finNolet = nolet && !memeNolet(nolet, noletApres);
    const lien = silence ? null : note.lien;
    const arrivee = !silence && aUneArrivee(suite, index, note.corde);
    // DEUX FAMILLES DE `<technical>`, CHACUNE SUR SA PORTÉE — et ce partage vient d'une MESURE, pas
    // d'un principe. Verovio, un moteur de gravure indépendant qui lit MusicXML, refuse d'attacher
    // une articulation à un groupe de tablature : « Adding 'artic' to a 'tabGrp' », cinq fois sur un
    // morceau d'essai qui en portait cinq. Il JETTE donc le hammer-on, le pull-off et le bend posés
    // sur la portée de tablature — le fichier reste valide au schéma, mais le « H », le « P » et la
    // flèche de bend n'arrivent nulle part.
    //
    // Sur la portée de NOTATION la même information s'attache sans broncher, et elle y est à sa
    // place : le « H » est le NOM de l'arc de liaison qu'on trace déjà là, les deux se lisent
    // ensemble. La corde et la case, elles, restent sur la tablature — c'est elle qui les dessine,
    // et elles n'ont aucun sens ailleurs.
    const aJeu = avecJeu && !silence && (
        (['hammer', 'pull'].includes(lien) && arrivee) || ['hammer', 'pull'].includes(entrant) || !!note.bend?.demiTons);
    const aTechnique = !silence && (avecCordeCase || aJeu);
    const aQuelqueChose = (premiere && (debutNolet || finNolet))
        || (!silence && (entrant === 'tie' || (lien === 'tie' && arrivee)))
        || (!silence && ['hammer', 'pull', 'slide'].includes(lien) && arrivee)
        || (!silence && ['hammer', 'pull', 'slide'].includes(entrant))
        || (premiere && portee === 1 && (evt.accent || evt.staccato))
        || aTechnique;
    if (aQuelqueChose) {
        flux.ouvrir('notations');
        if (!silence && entrant === 'tie') flux.seule('tied', '', ' type="stop"');
        if (!silence && lien === 'tie' && arrivee) flux.seule('tied', '', ' type="start"');
        // HAMMER-ON, PULL-OFF ET SLIDE SONT DES LIAISONS, en plus d'être des techniques : c'est l'arc
        // qui dit « une seule attaque pour deux notes ». Le numéro 1 suffit — ces liaisons ne
        // s'imbriquent jamais chez TabHub, un lien par note et par corde.
        if (!silence && ['hammer', 'pull'].includes(entrant)) flux.seule('slur', '', ' type="stop" number="1"');
        if (!silence && ['hammer', 'pull'].includes(lien) && arrivee) flux.seule('slur', '', ' type="start" number="1"');
        if (premiere && (debutNolet || finNolet)) {
            if (debutNolet) flux.seule('tuplet', '', ' type="start" bracket="yes"');
            if (finNolet) flux.seule('tuplet', '', ' type="stop"');
        }
        // ACCENT ET STACCATO SUR LA PORTÉE DE NOTATION SEULEMENT, comme le nom d'accord, le « P.M. »
        // et la nuance : ce sont des SIGNES, et un signe écrit une fois par portée s'affiche deux
        // fois. Le n-olet, lui, reste sur les deux — son `<time-modification>` définit la DURÉE, pas
        // un ornement, et une tablature qui montrerait trois croches dans le temps de deux sans son
        // « 3 » serait fausse à la lecture.
        if (premiere && portee === 1 && (evt.accent || evt.staccato)) {
            flux.ouvrir('articulations');
            if (evt.accent) flux.seule('accent', '');
            if (evt.staccato) flux.seule('staccato', '');
            flux.fermer('articulations');
        }
        if (aTechnique) {
            flux.ouvrir('technical');
            if (aJeu) {
                if (['hammer', 'pull'].includes(entrant)) {
                    flux.seule(entrant === 'hammer' ? 'hammer-on' : 'pull-off', '', ' type="stop" number="1"');
                }
                if (['hammer', 'pull'].includes(lien) && arrivee) {
                    flux.seule(lien === 'hammer' ? 'hammer-on' : 'pull-off', lien === 'hammer' ? 'H' : 'P', ' type="start" number="1"');
                }
                if (note.bend?.demiTons) {
                    flux.ouvrir('bend');
                    flux.seule('bend-alter', String(note.bend.demiTons));
                    flux.fermer('bend');
                }
            }
            if (avecCordeCase) {
                flux.seule('string', String(note.corde + 1));
                flux.seule('fret', String(note.frette));
            }
            flux.fermer('technical');
        }
        // LE SLIDE EST UN `<glissando>`, pas un `<slide>` : les deux existent dans le format et se
        // ressemblent, mais `<slide>` sert au portamento continu (une glissade de trombone) tandis
        // que `<glissando>` est le glissé qui passe par les hauteurs intermédiaires — un slide de
        // guitare, précisément, et c'est ce que TabHub grave avec son « sl. » et son trait oblique.
        if (!silence && entrant === 'slide') flux.seule('glissando', '', ' type="stop" number="1" line-type="solid"');
        if (!silence && lien === 'slide' && arrivee) flux.seule('glissando', 'sl.', ' type="start" number="1" line-type="solid"');
        flux.fermer('notations');
    }
    flux.fermer('note');
}

/** Un silence d'appoint, quand une voix est plus courte que sa mesure (mesure en cours d'écriture). */
function poserComplement(flux, partition, noires, ctx) {
    for (const e of decouperEnEvenements(noires, [], true)) {
        poserNote(flux, partition, e, null, { ...ctx, premiere: true, suite: [], index: 0 });
    }
}

// ─────────────────────────────── LA MESURE ───────────────────────────────

function poserMesure(flux, partition, iMesure, chaines, etatPrecedent) {
    const mesure = partition.mesures[iMesure];
    const signature = signatureEffective(partition, iMesure);
    const armure = armureEffective(partition, iMesure);
    const mode = modeEffectif(partition, iMesure);
    const capacite = capaciteMesure(partition, iMesure);
    const nbVoix = mesure.voix.length;
    const clefs = clefsDe(partition.piste.instrument);
    const tab = aUneTablature(partition);
    const nbPortees = tab ? 2 : clefs.length;

    flux.ouvrir('measure', ` number="${iMesure + 1}"`);

    if (mesure.sautAvant && iMesure > 0) flux.seule('print', '', ' new-system="yes"');

    // --- Attributs : seulement ce qui CHANGE, comme une vraie gravure ---------------------------
    const changeSignature = !etatPrecedent || etatPrecedent.battements !== signature.battements || etatPrecedent.unite !== signature.unite;
    const changeArmure = !etatPrecedent || etatPrecedent.armure !== armure || etatPrecedent.mode !== mode;
    if (!etatPrecedent || changeSignature || changeArmure) {
        flux.ouvrir('attributes');
        // ORDRE IMPOSÉ PAR LE FORMAT : divisions, key, time, staves, clef, staff-details. Une
        // permutation, même « plus lisible », rend le fichier invalide.
        if (!etatPrecedent) flux.seule('divisions', String(DIVISIONS));
        if (changeArmure) {
            flux.ouvrir('key');
            flux.seule('fifths', String(armure));
            flux.seule('mode', mode === 'mineur' ? 'minor' : 'major');
            flux.fermer('key');
        }
        if (changeSignature) {
            flux.ouvrir('time');
            flux.seule('beats', String(signature.battements));
            flux.seule('beat-type', String(signature.unite));
            flux.fermer('time');
        }
        if (!etatPrecedent) {
            if (nbPortees > 1) flux.seule('staves', String(nbPortees));
            for (const c of clefs) {
                flux.ouvrir('clef', nbPortees > 1 ? ` number="${c.numero}"` : '');
                flux.seule('sign', c.signe);
                flux.seule('line', String(c.ligne));
                if (c.octave) flux.seule('clef-octave-change', String(c.octave));
                flux.fermer('clef');
            }
            if (tab) {
                // LA PORTÉE DE TABLATURE : une clé « TAB » et autant de lignes que de cordes. C'est
                // ce qui fait arriver la tablature TELLE QUELLE chez le destinataire, au lieu d'une
                // portée seule qu'il devrait reconvertir.
                flux.ouvrir('clef', ' number="2"');
                flux.seule('sign', 'TAB');
                flux.seule('line', '5');
                flux.fermer('clef');
            }
            if (tab) poserAccordage(flux, partition);
        }
        flux.fermer('attributes');
    }

    if (mesure.repriseDebut) {
        flux.ouvrir('barline', ' location="left"');
        flux.seule('bar-style', 'heavy-light');
        flux.seule('repeat', '', ' direction="forward"');
        flux.fermer('barline');
    }

    // --- Directions, une seule fois par mesure (sur la première portée) -------------------------
    if (iMesure === 0) poserTempo(flux, partition.meta.tempo || 120);
    if (iMesure === 0 && partition.meta.ternaire) poserMots(flux, 'Swing  ♫ = ♩♪', 'above', true);
    // LE CAPODASTRE EN TEXTE, parce qu'il n'est plus un élément du fichier — voir poserAccordage, qui
    // explique pourquoi il est fondu dans l'accordage. Une case 0 avec capodastre n'est pas le
    // sillet : le guitariste doit le savoir, même si la machine n'en a plus besoin.
    if (iMesure === 0 && tab && partition.piste.capo) {
        poserMots(flux, `Capodastre case ${partition.piste.capo}`, 'above', true);
    }
    if (mesure.annotation) poserMots(flux, mesure.annotation, 'above', true);
    if (mesure.repere) poserRepere(flux, mesure.repere);

    // --- Les voix, puis leur double en tablature ------------------------------------------------
    // CHAQUE FLUX EST RAMENÉ À ZÉRO par un `<backup>` avant le suivant : c'est ainsi que MusicXML
    // superpose deux voix ou deux portées, en RECULANT le curseur d'écriture. Le total de chaque flux
    // doit valoir la même chose, sans quoi le lecteur décale tout ce qui suit — d'où le complément de
    // silence pour une voix plus courte que sa mesure (une mesure en cours d'écriture).
    const flux2 = [];
    for (let portee = 1; portee <= (tab ? 2 : 1); portee++) {
        for (let iVoix = 0; iVoix < nbVoix; iVoix++) {
            flux2.push({ portee, iVoix });
        }
    }
    const clefsPiano = !tab && clefs.length > 1;
    if (clefsPiano) {
        // PIANO : les deux voix sont les deux MAINS, chacune sur sa portée — pas deux voix superposées
        // sur la même. Aucun doublage, donc : la main droite sur la clé de sol, la gauche sur la fa.
        flux2.length = 0;
        for (let iVoix = 0; iVoix < nbVoix; iVoix++) flux2.push({ portee: Math.min(iVoix + 1, 2), iVoix });
    }

    // UNE mémoire d'altérations PAR MESURE, partagée par ses voix dans l'ordre où on les écrit —
    // exactement comme la gravure à l'écran (voir engine/layout.js, « partagée : une altération vaut
    // pour la MESURE entière, toutes voix confondues »).
    const memoire = memoireAlterations(armure);
    let premierFlux = true;
    let ecritDansLeFlux = 0;
    for (const { portee, iVoix } of flux2) {
        const evenements = mesure.voix[iVoix]?.evenements || [];
        const ecrite = dureeEcrite(mesure, iVoix);
        // LE RECUL DÉFAIT LE FLUX PRÉCÉDENT, jamais le courant — c'est la durée qu'on VIENT d'écrire
        // qu'il faut annuler pour revenir au début de la mesure. Se tromper de flux décale toute la
        // suite du morceau chez le lecteur, silencieusement : les deux voix d'une mesure à 4/4 se
        // retrouvent bout à bout sur huit temps.
        if (!premierFlux && ecritDansLeFlux > 0) {
            flux.ouvrir('backup');
            flux.seule('duration', String(ecritDansLeFlux));
            flux.fermer('backup');
        }
        premierFlux = false;
        ecritDansLeFlux = Math.round(Math.max(ecrite, capacite) * DIVISIONS);
        // VOIX 1-4 SUR LA PREMIÈRE PORTÉE, 5-8 SUR LA SECONDE : c'est la convention que suivent
        // MuseScore et Guitar Pro, et deux portées qui partageraient les mêmes numéros de voix
        // fusionneraient à la lecture.
        const voixXml = (portee - 1) * 4 + iVoix + 1;
        const chaine = chaines[iVoix];
        // LA CORDE ET LA CASE VONT SUR LA PORTÉE DE TABLATURE, et là seulement : c'est elle qui les
        // DESSINE. Posées aussi sur la portée de notation, elles y feraient afficher un doigté
        // parasite chez les lecteurs qui les honorent partout.
        const ctx = { iVoix, voixXml, portee, nbVoix, nbPortees, armure,
                      // Voir `aJeu` dans poserNote : la corde et la case vont à la TABLATURE, le
                      // hammer-on / pull-off / bend à la NOTATION, et c'est une mesure qui l'a décidé.
                      avecCordeCase: tab && portee === 2,
                      avecJeu: portee === 1,
                      memoire: portee === 1 ? memoire : null,
                      suite: chaine.suite };
        evenements.forEach((evt, iEvenement) => {
            const index = chaine.index.get(`${iMesure}:${iEvenement}`);
            // SUR LA PORTÉE DE NOTATION SEULEMENT : un nom d'accord, un « P.M. » ou une nuance
            // écrits DEUX fois (une par portée) s'affichent deux fois chez le lecteur, l'un
            // par-dessus l'autre.
            if (evt.accord && portee === 1) poserHarmonie(flux, evt.accord);
            if (evt.palmMute && portee === 1) poserMots(flux, 'P.M.', 'above');
            if (evt.nuance && DYNAMIQUES.has(evt.nuance) && portee === 1) {
                flux.ouvrir('direction', ' placement="below"');
                flux.ouvrir('direction-type');
                flux.ouvrir('dynamics');
                flux.seule(evt.nuance, '');
                flux.fermer('dynamics');
                flux.fermer('direction-type');
                flux.fermer('direction');
            }
            if (evt.silence || !evt.notes?.length) {
                poserNote(flux, partition, evt, null, { ...ctx, premiere: true, index });
            } else {
                evt.notes.forEach((note, iNote) => {
                    poserNote(flux, partition, evt, note, { ...ctx, premiere: iNote === 0, index });
                });
            }
        });
        if (capacite - ecrite > 1e-6) poserComplement(flux, partition, capacite - ecrite, ctx);
    }

    // --- Barre de fin ---------------------------------------------------------------------------
    const style = mesure.repriseFin ? 'light-heavy'
        : (mesure.barre === 'finale' ? 'light-heavy' : (mesure.barre === 'double' ? 'light-light' : null));
    if (style) {
        flux.ouvrir('barline', ' location="right"');
        flux.seule('bar-style', style);
        if (mesure.repriseFin) flux.seule('repeat', '', ` direction="backward" times="${Math.max(2, mesure.nbFois || 2)}"`);
        flux.fermer('barline');
    }

    flux.fermer('measure');
    return { battements: signature.battements, unite: signature.unite, armure, mode };
}

// ─────────────────────────────── L'ENTRÉE ───────────────────────────────

/**
 * La partition entière en MusicXML 3.1 `score-partwise`. Pure : rend une chaîne.
 */
export function genererMusicXML(partition) {
    const flux = creerFlux();
    const meta = partition.meta || {};
    const nomInstrument = INSTRUMENTS[partition.piste.instrument]?.nom || 'Guitare';

    flux.ligne('<?xml version="1.0" encoding="UTF-8"?>');
    flux.ligne('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
    flux.ouvrir('score-partwise', ' version="3.1"');

    flux.ouvrir('work');
    flux.seule('work-title', esc(meta.titre || 'Sans titre'));
    flux.fermer('work');
    flux.ouvrir('identification');
    if (meta.artiste) flux.seule('creator', esc(meta.artiste), ' type="composer"');
    flux.ouvrir('encoding');
    flux.seule('software', 'TabHub');
    // La DATE d'encodage, au format que le schéma impose (yyyy-mm-dd) — jamais un horodatage complet.
    flux.seule('encoding-date', new Date().toISOString().slice(0, 10));
    flux.seule('supports', '', ' element="accidental" type="yes"');
    flux.seule('supports', '', ' element="print" attribute="new-system" type="yes" value="yes"');
    flux.fermer('encoding');
    flux.fermer('identification');

    flux.ouvrir('part-list');
    flux.ouvrir('score-part', ' id="P1"');
    flux.seule('part-name', esc(nomInstrument));
    flux.ouvrir('score-instrument', ' id="P1-I1"');
    flux.seule('instrument-name', esc(nomInstrument));
    flux.fermer('score-instrument');
    flux.fermer('score-part');
    flux.fermer('part-list');

    flux.ouvrir('part', ' id="P1"');
    // Les chaînes par voix, construites UNE fois pour tout le morceau : c'est ce qui permet à une
    // liaison de franchir une barre de mesure (voir chainerVoix).
    const maxVoix = partition.mesures.reduce((n, m) => Math.max(n, m.voix.length), 1);
    const chaines = [];
    for (let iVoix = 0; iVoix < maxVoix; iVoix++) {
        const suite = chainerVoix(partition, iVoix);
        const index = new Map();
        suite.forEach((e, i) => index.set(`${e.iMesure}:${e.iEvenement}`, i));
        chaines.push({ suite, index });
    }
    let etat = null;
    partition.mesures.forEach((m, i) => { etat = poserMesure(flux, partition, i, chaines, etat); });
    flux.fermer('part');

    flux.fermer('score-partwise');
    return flux.rendu();
}

/** Le téléchargement — le seul endroit de ce module qui connaisse le navigateur. */
export async function exporterMusicXML(partition, racine) {
    const xml = genererMusicXML(partition);
    const nom = nomPour(partition, 'musicxml', 'musicxml');
    return enregistrerFichier(xml, { nom, dossier: 'musicxml', racine,
                                     typeMime: 'application/vnd.recordare.musicxml+xml' });
}
