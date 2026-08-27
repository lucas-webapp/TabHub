// Export et import MIDI (.mid) — le format d'échange que tout séquenceur, DAW ou logiciel de
// notation sait lire, alors que TabHub n'en avait jusqu'ici aucun.
//
// LE MODÈLE RAISONNE DÉJÀ EN HAUTEURS MIDI (voir model/theory.js, hauteurDeNote) : la partie
// difficile — faire correspondre corde/case à une hauteur réelle — est déjà résolue par le reste de
// l'application, pour l'audio et la transposition. Ce module n'a donc qu'à ÉCRIRE cette
// correspondance dans le format standard (l'export), ou à retrouver une position de manche pour une
// hauteur donnée (l'import) — la même règle de repli que transposerMorceau, voir
// meilleurePositionPour plus bas.
//
// FORMAT 0 (une seule piste) : TabHub ne connaît qu'un instrument par fichier — inutile d'écrire
// plusieurs pistes que rien, ici, ne distingue.

import { aplatir, hauteurDeNote, positionDebutMesure, creerPartition, creerMesure, creerEvenement, creerNote, figuresPour, normaliser } from '../model/score.js';
import { noiresParMesure } from '../model/duration.js';
import { INSTRUMENTS, hauteurDeCase, accordageParDefaut } from '../model/instruments.js';
import { nomDeFichierSur, telecharger } from './json.js';

/** Résolution du fichier écrit — indépendante du PPQ de Tone.Transport (voir audio/player.js),
 *  qui ne concerne que la LECTURE en mémoire. 480 est la valeur la plus répandue dans l'écosystème
 *  MIDI (DAW, séquenceurs) : un fichier TabHub s'y fond sans paraître d'origine exotique. */
const PPQ = 480;

// ---------------------------------------------------------------------------------------------
// Écriture bas niveau — quantité de longueur variable (VLQ), méta-évènements, entiers big-endian.
// ---------------------------------------------------------------------------------------------

/** Quantité de longueur variable — le codage des temps-delta et des longueurs de méta-évènement. */
function ecrireVLQ(valeur) {
    let v = Math.max(0, Math.round(valeur));
    const octets = [v & 0x7f];
    v >>= 7;
    while (v > 0) { octets.unshift((v & 0x7f) | 0x80); v >>= 7; }
    return octets;
}

function u32(v) { return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]; }
function u16(v) { return [(v >>> 8) & 0xff, v & 0xff]; }

/** Un bloc (« chunk ») MIDI : un type sur 4 caractères, puis sa longueur, puis son contenu. */
function chunk(type, octets) {
    return [...type].map(c => c.charCodeAt(0)).concat(u32(octets.length), octets);
}

// ---------------------------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------------------------

/**
 * Construit les octets d'un fichier .mid depuis la partition — pure, sans DOM, pour rester
 * éprouvable directement (voir tests/midi_test.js).
 *
 * LES LIAISONS DE PROLONGATION FUSIONNENT, comme à la lecture (voir audio/player.js#programmer) :
 * une note liée à la suivante devient une seule note MIDI plus longue, jamais deux notes qui se
 * chevaucheraient sur le même canal — un DAW qui rouvre le fichier verrait alors une fausse
 * répétition là où la partition dit explicitement qu'il n'y en a pas.
 *
 * LE CHANGEMENT DE SIGNATURE VOYAGE AUSSI, au bon instant (positionDebutMesure de la mesure qui le
 * porte) — un fichier MIDI qui resterait figé sur la toute première signature mentirait sur tout
 * changement de mesure ultérieur.
 */
export function genererMidi(partition) {
    const plat = aplatir(partition);
    const parVoix = new Map();
    for (const entree of plat) {
        if (!parVoix.has(entree.voix)) parVoix.set(entree.voix, []);
        parVoix.get(entree.voix).push(entree);
    }
    const suivantMemeVoix = new Map();
    for (const liste of parVoix.values()) {
        for (let k = 0; k + 1 < liste.length; k++) suivantMemeVoix.set(liste[k], liste[k + 1]);
    }

    // --- Évènements de note, en tics ABSOLUS (triés puis convertis en delta plus bas) ------------
    const evenements = [];   // { tic, estDebut, canal: 0, hauteur, vitesse }
    const consommees = new Set();
    for (const entree of plat) {
        const evt = entree.ref;
        if (evt.silence || !evt.notes.length) continue;
        for (const note of evt.notes) {
            const cle = `${entree.mesure}:${entree.voix}:${entree.evenement}:${note.corde}`;
            if (consommees.has(cle)) continue;
            const midi = hauteurDeNote(partition, note);
            if (midi == null) continue;   // hors manche : rien à écrire de faux

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

            // Palm mute/staccato écourtent la note SONNANTE sans changer sa place — comme à la
            // lecture. La vitesse (« velocity ») restitue accent/note fantôme, les deux nuances que
            // la notation distingue explicitement ; le reste part sur une valeur moyenne neutre.
            let sonnante = duree;
            if (evt.palmMute) sonnante = Math.min(sonnante, duree * 0.34);
            if (evt.staccato) sonnante = Math.min(sonnante, duree * 0.5);
            let vitesse = evt.accent ? 116 : 88;
            if (note.ghost) vitesse = 32;

            const debutTic = Math.round(entree.debut * PPQ);
            const finTic = Math.max(debutTic + 1, Math.round((entree.debut + sonnante) * PPQ));
            evenements.push({ tic: debutTic, estDebut: true, hauteur: midi, vitesse });
            evenements.push({ tic: finTic, estDebut: false, hauteur: midi, vitesse: 0 });
        }
    }

    // --- Changements de signature, au tic de la mesure qui les porte -----------------------------
    const signatures = [];
    partition.mesures.forEach((m, i) => {
        if (m.signature) signatures.push({ tic: Math.round(positionDebutMesure(partition, i) * PPQ), signature: m.signature });
    });
    if (!signatures.length) signatures.push({ tic: 0, signature: { battements: 4, unite: 4 } });

    // --- Assemblage : delta-tics, méta-évènements, note on/off -----------------------------------
    const brut = [];   // { tic, octets }
    brut.push({ tic: 0, octets: metaTexte(0x03, partition.meta.titre || 'Sans titre') });   // nom de piste
    brut.push({ tic: 0, octets: metaTempo(partition.meta.tempo || 120) });
    for (const s of signatures) brut.push({ tic: s.tic, octets: metaSignature(s.signature) });
    for (const e of evenements) {
        brut.push({ tic: e.tic, octets: [e.estDebut ? 0x90 : 0x80, e.hauteur & 0x7f, e.vitesse & 0x7f] });
    }
    // Tri STABLE par tic : à égalité, méta-évènements avant note off avant note on — un « off » qui
    // partagerait le tic d'un « on » de la MÊME hauteur (une note qui enchaîne pile sur elle-même)
    // doit se lire avant, sans quoi le on serait aussitôt éteint par le off qui le suit dans l'octet.
    const rang = (o) => (o.length === 3 ? (o[0] === 0x80 ? 1 : 2) : 0);
    brut.sort((a, b) => a.tic - b.tic || rang(a.octets) - rang(b.octets));

    const pistes = [];
    let dernierTic = 0;
    for (const { tic, octets } of brut) {
        pistes.push(...ecrireVLQ(tic - dernierTic), ...octets);
        dernierTic = tic;
    }
    pistes.push(0x00, 0xff, 0x2f, 0x00);   // fin de piste

    const entete = chunk('MThd', [...u16(0), ...u16(1), ...u16(PPQ)]);
    const piste = chunk('MTrk', pistes);
    return new Uint8Array([...entete, ...piste]);
}

function metaTexte(type, texte) {
    const octets = [...String(texte).slice(0, 255)].map(c => c.charCodeAt(0) & 0x7f);
    return [0xff, type, ...ecrireVLQ(octets.length), ...octets];
}

function metaTempo(bpm) {
    const microsecondesParNoire = Math.round(60000000 / Math.max(1, bpm));
    return [0xff, 0x51, 0x03, (microsecondesParNoire >> 16) & 0xff, (microsecondesParNoire >> 8) & 0xff, microsecondesParNoire & 0xff];
}

/** Chiffrage rythmique -> méta-évènement standard (numérateur, log2(dénominateur), tics/clic, 32e/noire). */
function metaSignature(signature) {
    const denomLog2 = Math.round(Math.log2(signature.unite));
    return [0xff, 0x58, 0x04, signature.battements & 0xff, denomLog2 & 0xff, 24, 8];
}

/** Exporte et déclenche le téléchargement — le pendant de enregistrerPartition (io/json.js). */
export function exporterMidi(partition) {
    const octets = genererMidi(partition);
    const nom = nomDeFichierSur(partition.meta.titre, '.mid');
    telecharger(octets, nom, 'audio/midi');
    return nom;
}

// ---------------------------------------------------------------------------------------------
// IMPORT
// ---------------------------------------------------------------------------------------------

function lireU32(v, i) { return ((v[i] << 24) | (v[i + 1] << 16) | (v[i + 2] << 8) | v[i + 3]) >>> 0; }
function lireU16(v, i) { return (v[i] << 8) | v[i + 1]; }

function lireVLQ(v, i) {
    let valeur = 0, o = i;
    for (;;) {
        const o1 = v[o++];
        valeur = (valeur << 7) | (o1 & 0x7f);
        if (!(o1 & 0x80)) break;
    }
    return [valeur, o];
}

/**
 * Lit les octets bruts d'un .mid en {division, tempo, signatures, notes} — pure, sans DOM (voir
 * tests/midi_test.js). TOUTES LES PISTES SONT FONDUES ENSEMBLE : TabHub ne connaît qu'un instrument
 * par fichier, un fichier multipiste s'y ramène donc à une seule ligne mélodique/harmonique, comme
 * si toutes ses voix avaient été jouées par le même instrument.
 */
export function analyserMidi(bytes) {
    const v = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const texte = (debut, n) => String.fromCharCode(...v.slice(debut, debut + n));
    if (v.length < 14 || texte(0, 4) !== 'MThd') {
        throw new Error('Fichier illisible : ce n\'est pas un fichier MIDI (en-tête « MThd » absente).');
    }
    const division = lireU16(v, 12);
    if (division & 0x8000) {
        throw new Error('Ce fichier MIDI code le temps en images par seconde (SMPTE) — TabHub ne sait lire que la division en tics par noire, de loin la plus répandue.');
    }
    const ntrks = lireU16(v, 10);

    let i = 14;
    const notesBrutes = [];
    const signatures = [];
    let microsecondesParNoire = 500000;   // 120 BPM par défaut, si le fichier n'en dit rien
    let nomPiste = null;   // premier nom de piste (méta 0x03) rencontré — devient le titre importé

    for (let piste = 0; piste < ntrks && i < v.length; piste++) {
        if (texte(i, 4) !== 'MTrk') throw new Error('Fichier MIDI mal formé : un bloc de piste (« MTrk ») était attendu.');
        const longueur = lireU32(v, i + 4);
        const fin = i + 8 + longueur;
        let p = i + 8, tic = 0, statutCourant = null;
        const notesEnCours = new Map();   // hauteur -> tic de départ, une seule occurrence active à la fois

        while (p < fin) {
            const [delta, apresDelta] = lireVLQ(v, p);
            p = apresDelta;
            tic += delta;

            let statut = v[p];
            if (statut < 0x80) statut = statutCourant;         // « running status » : pas d'octet ici
            else { p++; statutCourant = statut; }

            if (statut === 0xff) {                              // méta-évènement
                const type = v[p++];
                const [longueurMeta, apresMeta] = lireVLQ(v, p);
                if (type === 0x51 && longueurMeta === 3) microsecondesParNoire = (v[apresMeta] << 16) | (v[apresMeta + 1] << 8) | v[apresMeta + 2];
                else if (type === 0x58 && longueurMeta >= 2) signatures.push({ tic, battements: v[apresMeta], unite: 2 ** v[apresMeta + 1] });
                else if ((type === 0x03 || type === 0x01) && !nomPiste && longueurMeta > 0) nomPiste = texte(apresMeta, longueurMeta).trim();
                p = apresMeta + longueurMeta;
            } else if (statut === 0xf0 || statut === 0xf7) {    // sysex : ignoré, mais sa longueur doit être franchie
                const [longueurSysex, apresSysex] = lireVLQ(v, p);
                p = apresSysex + longueurSysex;
            } else if (statut != null) {
                const type = statut & 0xf0;
                const d1 = v[p++];
                // Program change (0xC0) et aftertouch de canal (0xD0) n'ont qu'UN SEUL octet de donnée.
                const d2 = (type !== 0xc0 && type !== 0xd0) ? v[p++] : 0;
                if (type === 0x90 && d2 > 0) {
                    notesEnCours.set(d1, tic);
                } else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
                    const debutTic = notesEnCours.get(d1);
                    if (debutTic != null && tic > debutTic) notesBrutes.push({ pitch: d1, debutTic, finTic: tic });
                    notesEnCours.delete(d1);
                }
            } else {
                break;   // aucun statut connu, rien de plus à lire proprement sur cette piste
            }
        }
        i = fin;
    }

    return {
        division,
        tempo: Math.round(60000000 / Math.max(1, microsecondesParNoire)),
        titre: nomPiste,
        signatures: (signatures.length ? signatures : [{ tic: 0, battements: 4, unite: 4 }])
            .sort((a, b) => a.tic - b.tic)
            .map(s => ({ noires: s.tic / division, battements: s.battements, unite: s.unite })),
        notes: notesBrutes.map(n => ({ pitch: n.pitch, debutNoires: n.debutTic / division, finNoires: n.finTic / division })),
    };
}

/** Grille de quantification d'un import — un fichier MIDI (surtout joué en direct) ne tombe
 *  quasiment jamais pile sur une figure standard. Une double-croche (0,25 noire) est un compromis :
 *  assez fine pour ne pas aplatir un passage rapide, assez large pour ne pas fragmenter un simple
 *  léger flottement de timing en une bouillie de micro-figures. */
const GRILLE_NOIRES = 0.25;
const snap = (noires) => Math.round(noires / GRILLE_NOIRES) * GRILLE_NOIRES;

/**
 * Position de manche pour une hauteur MIDI donnée — la case la plus BASSE parmi les cordes qui
 * l'atteignent encore (celles déjà prises par le même accord sont écartées), MÊME repli que
 * transposerMorceau (edit/commands.js) face à une hauteur qui ne tombe sur aucune case en place :
 * ici, sans case de départ à ajuster, on cherche directement la meilleure. `null` si aucune corde
 * n'atteint cette hauteur dans le manche : la note est alors abandonnée plutôt que placée n'importe
 * où (voir importerMidi, qui compte ces abandons pour le message de fin d'import).
 */
function meilleurePositionPour(pitch, accordage, capo, casesMax, cordesUtilisees) {
    let meilleure = null;
    for (let c = 0; c < accordage.cordes.length; c++) {
        if (cordesUtilisees.has(c)) continue;
        const f = pitch - accordage.cordes[c] - capo;
        if (f < 0 || f > casesMax) continue;
        if (!meilleure || f < meilleure.frette) meilleure = { corde: c, frette: f };
    }
    return meilleure;
}

/**
 * Construit une partition TabHub depuis le résultat d'analyserMidi — la traversée mesure par
 * mesure qui remplace le flot continu du fichier par des figures standard, quantifiées sur
 * GRILLE_NOIRES, réparties dans les mesures de l'instrument visé.
 *
 * UNE NOTE QUI DÉBORDE D'UNE MESURE SE POURSUIT, LIÉE, DANS LA SUIVANTE — jamais tronquée : c'est le
 * même mécanisme qui fait qu'une ronde tenue par-dessus une barre de mesure s'entend correctement à
 * la lecture (voir audio/player.js#programmer, qui fusionne déjà les liaisons), même si le tracé de
 * l'arc, lui, ne franchit pas la barre (limite connue, voir README).
 */
export function construirePartitionDepuisMidi(analyse, instrumentId = 'guitare', accordage = null, capo = 0) {
    const fiche = INSTRUMENTS[instrumentId] ? instrumentId : 'guitare';
    const accord = accordage || accordageParDefaut(fiche);
    const casesMax = INSTRUMENTS[fiche].casesMax;
    const EPS = 1e-9;

    // --- Regroupement en « colonnes » (accords) : même départ quantifié = une seule attaque --------
    const parDebut = new Map();
    for (const n of analyse.notes) {
        const debut = snap(n.debutNoires);
        const fin = Math.max(debut + GRILLE_NOIRES, snap(n.finNoires));
        if (!parDebut.has(debut)) parDebut.set(debut, { debut, fin, pitches: [] });
        const groupe = parDebut.get(debut);
        groupe.fin = Math.max(groupe.fin, fin);
        groupe.pitches.push(n.pitch);
    }
    const groupes = [...parDebut.values()].sort((a, b) => a.debut - b.debut);
    // Une voix, dans ce modèle, est une suite d'ATTAQUES — jamais deux notes indépendantes qui
    // se chevauchent sans partager leur départ (une vraie polyphonie à plusieurs voix demanderait
    // de SÉPARER les voix du fichier source, un problème autrement plus dur que cet import ne
    // cherche à résoudre). Un accord qui déborde encore sur le départ du suivant est donc raccourci
    // ici : mieux qu'une incohérence de curseur qui déciderait ensuite n'importe quoi.
    for (let k = 0; k < groupes.length - 1; k++) groupes[k].fin = Math.min(groupes[k].fin, groupes[k + 1].debut);

    const signatureA = (positionNoires) => {
        let courante = analyse.signatures[0];
        for (const s of analyse.signatures) { if (s.noires <= positionNoires + EPS) courante = s; else break; }
        return courante;
    };

    const mesures = [];
    let positionMesure = 0;
    let groupeIdx = 0;
    let continuation = null;   // { pitches, reste } : une attaque déjà commencée qui déborde encore
    let signaturePrecedente = null;
    let abandonnees = 0;

    // Tant qu'il reste un groupe à placer OU une continuation à écouler, une mesure de plus.
    while (groupeIdx < groupes.length || continuation) {
        const sig = signatureA(positionMesure);
        const capacite = noiresParMesure(sig);
        const finMesure = positionMesure + capacite;
        const evenements = [];
        let curseur = positionMesure;

        const poserFigures = (duree, notes, encoreApres) => {
            const figs = figuresPour(duree);
            figs.forEach((f, k) => {
                const copies = notes.map(n => creerNote(n.corde, n.frette));
                if (k < figs.length - 1 || encoreApres) copies.forEach(n => { n.lien = 'tie'; });
                evenements.push(creerEvenement(f, copies, {}));
            });
        };
        const poserSilence = (duree) => {
            for (const f of figuresPour(duree)) evenements.push(creerEvenement(f, [], { silence: true }));
        };

        if (continuation) {
            const dureeIci = Math.min(continuation.reste, capacite);
            poserFigures(dureeIci, continuation.notes, dureeIci < continuation.reste - EPS);
            curseur += dureeIci;
            continuation.reste -= dureeIci;
            if (continuation.reste <= EPS) continuation = null;
        }

        while (groupeIdx < groupes.length && groupes[groupeIdx].debut < finMesure - EPS) {
            const g = groupes[groupeIdx];
            if (g.debut > curseur + EPS) { poserSilence(g.debut - curseur); curseur = g.debut; }

            const cordesUtilisees = new Set();
            const notesAssignees = [];
            for (const pitch of g.pitches) {
                const pos = meilleurePositionPour(pitch, accord, capo, casesMax, cordesUtilisees);
                if (!pos) { abandonnees++; continue; }
                cordesUtilisees.add(pos.corde);
                notesAssignees.push(pos);
            }
            const dureeGroupe = Math.max(GRILLE_NOIRES, g.fin - g.debut);
            const dureeIci = Math.min(dureeGroupe, finMesure - g.debut);
            if (notesAssignees.length) poserFigures(dureeIci, notesAssignees, dureeIci < dureeGroupe - EPS);
            else poserSilence(dureeIci);   // toutes les hauteurs de cet accord étaient hors du manche
            curseur = g.debut + dureeIci;
            if (dureeIci < dureeGroupe - EPS && notesAssignees.length) continuation = { notes: notesAssignees, reste: dureeGroupe - dureeIci };
            groupeIdx++;
        }

        if (curseur < finMesure - EPS) poserSilence(finMesure - curseur);

        const mesure = creerMesure({ voix: [{ evenements }] });
        if (!signaturePrecedente || sig.battements !== signaturePrecedente.battements || sig.unite !== signaturePrecedente.unite) {
            mesure.signature = { battements: sig.battements, unite: sig.unite };
            signaturePrecedente = sig;
        }
        mesures.push(mesure);
        positionMesure = finMesure;
    }

    const partition = creerPartition(fiche);
    partition.piste.accordage = accord;
    partition.piste.capo = capo;
    partition.meta.tempo = Math.max(20, Math.min(400, analyse.tempo || 120));
    if (analyse.titre) partition.meta.titre = analyse.titre.slice(0, 200);
    partition.mesures = mesures.length ? mesures : partition.mesures;
    if (partition.mesures[0]) {
        if (!partition.mesures[0].signature) partition.mesures[0].signature = { battements: 4, unite: 4 };
        if (partition.mesures[0].armure === null) partition.mesures[0].armure = 0;
        partition.mesures[0].mode = 'majeur';
    }
    return { partition: normaliser(partition), abandonnees };
}

/**
 * Lit un fichier .mid choisi par l'utilisateur et renvoie {partition, abandonnees} — le nombre de
 * notes qu'aucune corde de l'instrument/accordage visé n'atteignait, pour que l'appelant en informe
 * l'utilisateur (voir main.js) plutôt que de les faire disparaître en silence.
 */
export async function lireFichierMidi(fichier, instrumentId, accordage, capo) {
    if (!fichier) throw new Error('Aucun fichier sélectionné.');
    if (fichier.size > 5 * 1024 * 1024) throw new Error('Fichier trop volumineux pour un fichier MIDI (plus de 5 Mo).');
    const octets = new Uint8Array(await fichier.arrayBuffer());
    const analyse = analyserMidi(octets);
    return construirePartitionDepuisMidi(analyse, instrumentId, accordage, capo);
}
