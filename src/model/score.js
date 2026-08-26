// Modèle de données d'une partition TabHub — et le format du fichier .json exporté.
//
// HIÉRARCHIE : partition > mesures > évènements > notes.
//
//   • Un ÉVÈNEMENT est une tranche verticale de temps : une durée, et les notes qui sonnent ensemble
//     à cet instant (une seule pour un riff, plusieurs pour un accord plaqué). C'est l'unité que le
//     curseur d'édition parcourt, celle que la lecture programme, et celle que le moteur de rendu
//     aligne entre la portée et la tablature. Le mot « temps » a été écarté : il désigne déjà le
//     battement de la mesure (le 3 de 3/8), et confondre les deux se paierait dans tout le code.
//   • Une NOTE est toujours décrite par CORDE + CASE, jamais par une hauteur. La hauteur en est
//     déduite via l'accordage (voir instruments.hauteurDeCase). C'est le sens de circulation de
//     l'appli entière : la tablature est la source, la portée solfège en est le reflet. Stocker les
//     deux inviterait à les laisser diverger.
//
// HÉRITAGE DES ATTRIBUTS DE MESURE. `signature` et `armure` valent `null` dans une mesure qui ne les
// change pas — la mesure reprend alors ce qui précède. Une partition en 4/4 ne répète donc pas
// quarante fois « 4/4 », et le moteur de rendu sait, par ce seul `null`, qu'il ne doit PAS redessiner
// la signature au début de cette mesure. Les deux besoins sont servis par la même donnée.

import { dureeEnNoires, noiresParMesure } from './duration.js';
import { INSTRUMENTS, accordageParDefaut, hauteurDeCase } from './instruments.js';

export const FORMAT = 'tabhub-partition';
export const VERSION_FORMAT = 1;

/**
 * Liaisons entre une note et la suivante SUR LA MÊME CORDE. Un seul champ (`note.lien`) plutôt qu'un
 * booléen par effet : ces cinq états sont exclusifs par nature — on ne peut pas glisser ET marteler
 * vers la même note — et un champ unique rend cette exclusivité impossible à violer, là où cinq
 * booléens autoriseraient des combinaisons absurdes qu'il faudrait ensuite arbitrer à l'affichage.
 */
export const LIENS = {
    tie: { id: 'tie', nom: 'Liaison de prolongation', abrege: '⌒', aide: 'La note suivante prolonge celle-ci sans être rejouée' },
    hammer: { id: 'hammer', nom: 'Hammer-on', abrege: 'H', aide: 'Note suivante obtenue en frappant la corde du doigt' },
    pull: { id: 'pull', nom: 'Pull-off', abrege: 'P', aide: 'Note suivante obtenue en tirant le doigt de la corde' },
    slide: { id: 'slide', nom: 'Slide (glissé)', abrege: '/', aide: 'Glissé du doigt jusqu\'à la note suivante' },
};

/** Effets portés par la note elle-même, indépendants de ce qui suit. */
export const EFFETS_NOTE = {
    bend: { id: 'bend', nom: 'Bend', aide: 'Tirer la corde pour monter la hauteur' },
    ghost: { id: 'ghost', nom: 'Note fantôme', aide: 'Note étouffée, hauteur indéterminée' },
};

/** Effets portés par l'évènement entier — ils s'appliquent à toutes les cordes qui sonnent ensemble. */
export const EFFETS_EVENEMENT = {
    palmMute: { id: 'palmMute', nom: 'Palm mute', abrege: 'P.M.', aide: 'Étouffé de la paume près du chevalet' },
    accent: { id: 'accent', nom: 'Accent', abrege: '>', aide: 'Note attaquée plus fort' },
    staccato: { id: 'staccato', nom: 'Staccato', abrege: '·', aide: 'Note écourtée, détachée' },
};

export const NUANCES = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];

let compteurId = 0;
/** Identifiants stables, indispensables au rendu incrémental et à la comparaison undo/redo. */
function nouvelId(prefixe) {
    compteurId += 1;
    return `${prefixe}${compteurId.toString(36)}`;
}

/** Note vierge sur une corde/case donnée. */
export function creerNote(corde, frette, extra = {}) {
    return {
        id: nouvelId('n'),
        corde,
        frette,
        lien: null,
        bend: null,       // { demiTons: 1 } — 1 = un ton entier au sens guitare (full bend)
        ghost: false,
        ...extra,
    };
}

/** Évènement vierge. Sans notes et sans `silence`, il est considéré comme un silence à l'affichage. */
export function creerEvenement(duree = { valeur: 4, points: 0, nolet: null }, notes = [], extra = {}) {
    return {
        id: nouvelId('e'),
        duree: { valeur: duree.valeur ?? 4, points: duree.points ?? 0, nolet: duree.nolet ?? null },
        silence: false,
        notes,
        palmMute: false,
        accent: false,
        staccato: false,
        nuance: null,
        ...extra,
    };
}

/** Mesure vierge : un seul silence, pour qu'elle ait toujours une position de curseur atteignable. */
export function creerMesure(extra = {}) {
    return {
        id: nouvelId('m'),
        signature: null,
        armure: null,
        repriseDebut: false,
        repriseFin: false,
        nbFois: 2,
        evenements: [creerEvenement({ valeur: 4 }, [], { silence: true })],
        ...extra,
    };
}

/**
 * Partition neuve. Les valeurs par défaut sont celles d'un riff de guitare qu'on commence à saisir :
 * 4/4, do majeur, 120 BPM, quatre mesures vides — assez pour que la page ne paraisse pas vide au
 * premier chargement, assez peu pour qu'elle tienne sur un système.
 */
export function creerPartition(instrumentId = 'guitare') {
    const instrument = INSTRUMENTS[instrumentId] ? instrumentId : 'guitare';
    const maintenant = new Date().toISOString();
    const premiere = creerMesure({ signature: { battements: 4, unite: 4 }, armure: 0 });
    return {
        format: FORMAT,
        version: VERSION_FORMAT,
        meta: {
            titre: 'Sans titre',
            sousTitre: '',
            artiste: '',
            tempo: 120,
            creeLe: maintenant,
            modifieLe: maintenant,
        },
        piste: {
            instrument,
            accordage: accordageParDefaut(instrument),
            capo: 0,
        },
        mesures: [premiere, creerMesure(), creerMesure(), creerMesure()],
    };
}

// ---------------------------------------------------------------------------------------------
// Lecture : résolution de l'héritage et calculs dérivés
// ---------------------------------------------------------------------------------------------

/** Signature EFFECTIVE de la mesure `index` : la sienne, ou la dernière déclarée avant elle. */
export function signatureEffective(partition, index) {
    for (let i = Math.min(index, partition.mesures.length - 1); i >= 0; i--) {
        const s = partition.mesures[i].signature;
        if (s) return s;
    }
    return { battements: 4, unite: 4 };
}

/** Armure EFFECTIVE de la mesure `index`. Même logique que la signature. */
export function armureEffective(partition, index) {
    for (let i = Math.min(index, partition.mesures.length - 1); i >= 0; i--) {
        const a = partition.mesures[i].armure;
        if (a !== null && a !== undefined) return a;
    }
    return 0;
}

/** Somme des durées écrites dans la mesure, en noires. Peut différer de la capacité (mesure incomplète). */
export function dureeEcrite(mesure) {
    return mesure.evenements.reduce((total, e) => total + dureeEnNoires(e.duree), 0);
}

/** Capacité de la mesure d'après sa signature effective, en noires. */
export function capaciteMesure(partition, index) {
    return noiresParMesure(signatureEffective(partition, index));
}

/**
 * État de remplissage d'une mesure. Sert à l'affichage discret d'un repère (mesure incomplète ou
 * débordante) plutôt qu'à un refus de saisie : on n'interrompt pas quelqu'un en train d'écrire parce
 * que sa mesure n'est pas encore complète — elle ne l'est, par construction, jamais avant la fin.
 */
export function etatMesure(partition, index) {
    const ecrite = dureeEcrite(partition.mesures[index]);
    const capacite = capaciteMesure(partition, index);
    const ecart = ecrite - capacite;
    if (Math.abs(ecart) < 1e-9) return 'complete';
    return ecart < 0 ? 'incomplete' : 'debordante';
}

/** Position de départ d'un évènement dans sa mesure, en noires depuis le début de celle-ci. */
export function positionDansMesure(mesure, indexEvenement) {
    let t = 0;
    for (let i = 0; i < indexEvenement && i < mesure.evenements.length; i++) t += dureeEnNoires(mesure.evenements[i].duree);
    return t;
}

/** Hauteur MIDI réelle d'une note, accordage et capodastre compris. `null` si la corde n'existe pas. */
export function hauteurDeNote(partition, note) {
    return hauteurDeCase(partition.piste.accordage, note.corde, note.frette, partition.piste.capo || 0);
}

/** Nombre de cordes de la piste — l'accordage fait foi, pas la fiche instrument (accordage personnalisé). */
export function nbCordes(partition) {
    return partition.piste.accordage.cordes.length;
}

/**
 * Aplatit la partition en une suite d'évènements datés, en noires depuis le début du morceau.
 * Une seule traversée sert à la fois au moteur audio (quand programmer chaque note) et au moteur de
 * rendu (où poser la tête de lecture) : les deux lisent la MÊME liste, donc le trait suivi à l'écran
 * ne peut pas dériver de ce qu'on entend.
 *
 * Les reprises ne sont volontairement PAS dépliées ici : elles relèvent du parcours de lecture, pas
 * de la partition écrite. Les déplier créerait des évènements en double sans identité propre, que le
 * rendu ne saurait plus rattacher à une position à l'écran.
 */
export function aplatir(partition) {
    const sortie = [];
    let t = 0;
    partition.mesures.forEach((mesure, iMesure) => {
        mesure.evenements.forEach((evenement, iEvenement) => {
            const duree = dureeEnNoires(evenement.duree);
            sortie.push({ mesure: iMesure, evenement: iEvenement, debut: t, duree, ref: evenement });
            t += duree;
        });
    });
    return sortie;
}

/** Durée totale du morceau écrit, en noires. */
export function dureeTotale(partition) {
    return partition.mesures.reduce((total, m) => total + dureeEcrite(m), 0);
}

// ---------------------------------------------------------------------------------------------
// Import : normalisation d'un JSON venu de l'extérieur
// ---------------------------------------------------------------------------------------------

const borne = (v, min, max, defaut) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : defaut;
};

/**
 * Remet d'aplomb une partition venue d'un fichier .json.
 *
 * Un fichier ouvert par l'utilisateur est une entrée NON FIABLE, au même titre qu'une saisie : il a pu
 * être écrit par une version antérieure, modifié à la main, ou tronqué. Chaque champ est donc borné
 * plutôt que cru sur parole — une corde 12 sur une guitare à 6 cordes ferait planter le rendu à la
 * première ligne cherchée, et une durée `valeur: 0` bloquerait la lecture dans une boucle infinie de
 * durée nulle. On répare et on ouvre quand même : perdre un effet exotique vaut mieux que refuser
 * d'ouvrir le morceau de quelqu'un.
 */
export function normaliser(brut) {
    if (!brut || typeof brut !== 'object') throw new Error('Fichier illisible : ce n\'est pas un objet JSON.');
    if (brut.format && brut.format !== FORMAT) throw new Error(`Format inconnu : « ${brut.format} ».`);

    const instrument = INSTRUMENTS[brut.piste?.instrument] ? brut.piste.instrument : 'guitare';
    const fiche = INSTRUMENTS[instrument];

    let cordes = Array.isArray(brut.piste?.accordage?.cordes) ? brut.piste.accordage.cordes.map(v => borne(v, 0, 127, 40)) : null;
    if (!cordes || cordes.length < 3 || cordes.length > 8) cordes = accordageParDefaut(instrument).cordes;

    const partition = {
        format: FORMAT,
        version: VERSION_FORMAT,
        meta: {
            titre: String(brut.meta?.titre ?? 'Sans titre').slice(0, 200),
            sousTitre: String(brut.meta?.sousTitre ?? '').slice(0, 200),
            artiste: String(brut.meta?.artiste ?? '').slice(0, 200),
            tempo: borne(brut.meta?.tempo, 20, 400, 120),
            creeLe: typeof brut.meta?.creeLe === 'string' ? brut.meta.creeLe : new Date().toISOString(),
            modifieLe: new Date().toISOString(),
        },
        piste: {
            instrument,
            accordage: {
                id: String(brut.piste?.accordage?.id ?? 'personnalise').slice(0, 40),
                nom: String(brut.piste?.accordage?.nom ?? 'Personnalisé').slice(0, 80),
                cordes,
            },
            capo: borne(brut.piste?.capo, 0, 12, 0),
        },
        mesures: [],
    };

    const mesuresBrutes = Array.isArray(brut.mesures) && brut.mesures.length ? brut.mesures : [creerMesure()];
    for (const mb of mesuresBrutes) {
        const mesure = creerMesure({ evenements: [] });
        if (mb?.signature) {
            mesure.signature = {
                battements: borne(mb.signature.battements, 1, 32, 4),
                unite: [1, 2, 4, 8, 16, 32].includes(Number(mb.signature.unite)) ? Number(mb.signature.unite) : 4,
            };
        }
        if (mb?.armure !== null && mb?.armure !== undefined) mesure.armure = borne(mb.armure, -7, 7, 0);
        mesure.repriseDebut = !!mb?.repriseDebut;
        mesure.repriseFin = !!mb?.repriseFin;
        mesure.nbFois = borne(mb?.nbFois, 2, 99, 2);

        for (const eb of Array.isArray(mb?.evenements) ? mb.evenements : []) {
            const duree = {
                valeur: [1, 2, 4, 8, 16, 32].includes(Number(eb?.duree?.valeur)) ? Number(eb.duree.valeur) : 4,
                points: borne(eb?.duree?.points, 0, 3, 0),
                nolet: eb?.duree?.nolet && eb.duree.nolet.dans > 0
                    ? { dans: borne(eb.duree.nolet.dans, 2, 16, 3), valent: borne(eb.duree.nolet.valent, 1, 16, 2) }
                    : null,
            };
            const notes = [];
            for (const nb of Array.isArray(eb?.notes) ? eb.notes : []) {
                const corde = borne(nb?.corde, 0, cordes.length - 1, null);
                if (corde === null) continue;
                // Doublon sur la même corde : physiquement impossible, et le rendu poserait deux
                // chiffres l'un sur l'autre. Le premier gagne.
                if (notes.some(n => n.corde === corde)) continue;
                notes.push(creerNote(corde, borne(nb?.frette, 0, fiche.casesMax, 0), {
                    lien: LIENS[nb?.lien] ? nb.lien : null,
                    bend: nb?.bend && Number.isFinite(Number(nb.bend.demiTons))
                        ? { demiTons: Math.min(6, Math.max(0.5, Number(nb.bend.demiTons))) } : null,
                    ghost: !!nb?.ghost,
                }));
            }
            mesure.evenements.push(creerEvenement(duree, notes, {
                silence: !!eb?.silence || notes.length === 0,
                palmMute: !!eb?.palmMute,
                accent: !!eb?.accent,
                staccato: !!eb?.staccato,
                nuance: NUANCES.includes(eb?.nuance) ? eb.nuance : null,
            }));
        }
        if (!mesure.evenements.length) mesure.evenements.push(creerEvenement({ valeur: 4 }, [], { silence: true }));
        partition.mesures.push(mesure);
    }

    // Toute partition doit porter une signature et une armure de départ : le rendu du premier système
    // les dessine sans condition, et un `null` ici deviendrait un trou dans l'en-tête de portée.
    if (!partition.mesures[0].signature) partition.mesures[0].signature = { battements: 4, unite: 4 };
    if (partition.mesures[0].armure === null) partition.mesures[0].armure = 0;

    return partition;
}

/** Copie profonde — base de l'historique undo/redo. */
export function cloner(partition) {
    return typeof structuredClone === 'function' ? structuredClone(partition) : JSON.parse(JSON.stringify(partition));
}
