// Modèle de données d'une partition TabHub — et le format du fichier .json exporté.
//
// HIÉRARCHIE : partition > mesures > voix > évènements > notes.
//
//   • Une VOIX est une ligne rythmique INDÉPENDANTE à l'intérieur d'une mesure : sa propre suite
//     d'évènements, sa propre durée écrite, sans rapport avec celle des autres voix de la même
//     mesure sinon qu'elles commencent toutes au même instant et doivent, une fois complètes,
//     remplir la même capacité. C'est ce qui permet d'écrire une basse tenue (une voix, une seule
//     blanche pointée) sous une mélodie qui bouge (une autre voix, quatre croches) DANS LA MÊME
//     MESURE — chose impossible avec une seule suite d'évènements, qui ne peut représenter qu'un
//     seul rythme à la fois. La voix 0 est la voix PRINCIPALE (mélodie), hampes vers le haut quand
//     il y en a une seconde ; la voix 1 est la voix SECONDAIRE (accompagnement/basse), hampes vers
//     le bas. Deux voix suffisent à la V1 — c'est le cas déclaré par l'utilisateur (mélodie +
//     basse tenue), et la plupart des partitions de guitare n'en emploient jamais plus.
//   • Un ÉVÈNEMENT est une tranche verticale de temps DANS UNE VOIX : une durée, et les notes qui
//     sonnent ensemble à cet instant (une seule pour un riff, plusieurs pour un accord plaqué).
//     C'est l'unité que le curseur d'édition parcourt, celle que la lecture programme, et celle que
//     le moteur de rendu aligne entre la portée et la tablature. Le mot « temps » a été écarté : il
//     désigne déjà le battement de la mesure (le 3 de 3/8), et confondre les deux se paierait dans
//     tout le code.
//   • Une NOTE est toujours décrite par CORDE + CASE, jamais par une hauteur. La hauteur en est
//     déduite via l'accordage (voir instruments.hauteurDeCase). C'est le sens de circulation de
//     l'appli entière : la tablature est la source, la portée solfège en est le reflet. Stocker les
//     deux inviterait à les laisser diverger.
//
// HÉRITAGE DES ATTRIBUTS DE MESURE. `signature` et `armure` valent `null` dans une mesure qui ne les
// change pas — la mesure reprend alors ce qui précède. Une partition en 4/4 ne répète donc pas
// quarante fois « 4/4 », et le moteur de rendu sait, par ce seul `null`, qu'il ne doit PAS redessiner
// la signature au début de cette mesure. Les deux besoins sont servis par la même donnée. Signature,
// armure et barres de reprise restent des propriétés de la MESURE, partagées par toutes ses voix —
// deux voix de la même mesure ne peuvent pas être en 3/4 et 6/8 à la fois, ce serait deux mesures.

import { dureeEnNoires, noiresParMesure } from './duration.js';
import { INSTRUMENTS, accordageParDefaut, hauteurDeCase } from './instruments.js';

export const FORMAT = 'tabhub-partition';
export const VERSION_FORMAT = 2;   // 2 : introduction des voix (mesure.voix[] remplace mesure.evenements)

/** Nombre maximal de voix par mesure en V1 — mélodie + basse tenue. Voir l'en-tête du fichier. */
export const MAX_VOIX = 2;

/**
 * Liaisons entre une note et la suivante SUR LA MÊME CORDE, DANS LA MÊME VOIX. Un seul champ
 * (`note.lien`) plutôt qu'un booléen par effet : ces cinq états sont exclusifs par nature — on ne
 * peut pas glisser ET marteler vers la même note — et un champ unique rend cette exclusivité
 * impossible à violer, là où cinq booléens autoriseraient des combinaisons absurdes qu'il faudrait
 * ensuite arbitrer à l'affichage.
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
        bend: null,       // { demiTons } EN DEMI-TONS : 1 = ½ ton, 2 = « full » (un ton), 3 = 1½ ton
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

/**
 * Découpe une durée (en noires) en une suite d'évènements de figures STANDARD, du plus long
 * possible au plus court, points compris. C'est la règle qu'une gravure applique pour écrire un
 * silence qui ne correspond à aucune figure unique (5 noires, par exemple) : on ne dessine jamais un
 * silence « impossible », on en enchaîne plusieurs qui somment juste. Sert à ensemencer une voix
 * neuve à la bonne longueur (voir creerVoix) plutôt que de la faire naître en une seule noire, fausse
 * dans toute mesure qui n'est pas en 4/4.
 */
export function decouperEnEvenements(noires, notes = [], silence = true) {
    const EPS = 1e-9;
    const sortie = [];
    let reste = noires;
    while (reste > EPS) {
        let posee = false;
        for (const valeur of [1, 2, 4, 8, 16, 32]) {
            for (const points of [1, 0]) {   // pointée d'abord : couvre plus large en un seul évènement
                const d = dureeEnNoires({ valeur, points });
                if (d <= reste + EPS) {
                    sortie.push(creerEvenement({ valeur, points }, silence ? [] : notes, { silence }));
                    reste -= d;
                    posee = true;
                    break;
                }
            }
            if (posee) break;
        }
        if (!posee) break;   // reste plus court qu'une triple-croche : on n'ira pas plus loin
    }
    return sortie.length ? sortie : [creerEvenement({ valeur: 4 }, [], { silence: true })];
}

/**
 * Voix neuve, dimensionnée pour occuper toute la capacité de la mesure qui l'accueille — jamais une
 * seule noire par défaut, qui laisserait une mesure en 3/8 ou 6/8 « incomplète » dès sa création.
 */
export function creerVoix(capaciteNoires = 4) {
    return { evenements: decouperEnEvenements(capaciteNoires) };
}

/** Mesure vierge : une seule voix, un seul silence — de quoi avoir toujours une position de curseur. */
export function creerMesure(extra = {}) {
    return {
        id: nouvelId('m'),
        signature: null,
        armure: null,
        // Le MODE ('majeur' | 'mineur') voyage AVEC l'armure, et hérite comme elle (voir modeEffectif) :
        // il est ce qui distingue deux relatives, que l'armure seule ne sait pas départager (do majeur
        // et la mineur portent exactement les mêmes altérations). Voir theory.js, TONALITES.
        mode: null,
        repriseDebut: false,
        repriseFin: false,
        nbFois: 2,
        // Étiquette de section (« Couplet 1 », « Refrain », « Pont »…) affichée au-dessus de CETTE
        // mesure précise — jamais héritée par les suivantes, à la différence de la signature ou de
        // l'armure : une section commence à un endroit exact, elle ne se prolonge pas en silence
        // tant qu'une autre ne la referme pas. `null` : rien à afficher (voir engine/layout.js, qui
        // ne réserve de place au-dessus d'un système que si l'une de ses mesures en porte une).
        annotation: null,
        voix: [creerVoix(4)],
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
    const premiere = creerMesure({ signature: { battements: 4, unite: 4 }, armure: 0, mode: 'majeur' });
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

/**
 * Le MODE en vigueur à cette mesure, hérité de la dernière mesure qui l'a fixé — exactement la même
 * règle qu'`armureEffective` juste au-dessus, dont il est le jumeau : les deux ensemble forment la
 * TONALITÉ (voir theory.js, TONALITES). « majeur » à défaut, comme l'armure vaut 0 à défaut.
 */
export function modeEffectif(partition, index) {
    for (let i = Math.min(index, partition.mesures.length - 1); i >= 0; i--) {
        const m = partition.mesures[i].mode;
        if (m === 'majeur' || m === 'mineur') return m;
    }
    return 'majeur';
}

/** Nombre de voix effectivement présentes dans une mesure — 1 la plupart du temps, 2 au maximum. */
export function nbVoixMesure(mesure) {
    return mesure.voix.length;
}

/** Somme des durées écrites dans une VOIX de la mesure, en noires. Peut différer de la capacité
 *  (mesure incomplète) — chaque voix a la sienne, indépendamment des autres. */
export function dureeEcrite(mesure, iVoix = 0) {
    const voix = mesure.voix[iVoix];
    if (!voix) return 0;
    return voix.evenements.reduce((total, e) => total + dureeEnNoires(e.duree), 0);
}

/** Capacité de la mesure d'après sa signature effective, en noires — commune à toutes ses voix. */
export function capaciteMesure(partition, index) {
    return noiresParMesure(signatureEffective(partition, index));
}

/**
 * État de remplissage d'une VOIX de la mesure. Sert à l'affichage discret d'un repère (mesure
 * incomplète ou débordante) plutôt qu'à un refus de saisie : on n'interrompt pas quelqu'un en train
 * d'écrire parce que sa mesure n'est pas encore complète — elle ne l'est, par construction, jamais
 * avant la fin.
 */
export function etatMesure(partition, index, iVoix = 0) {
    const ecrite = dureeEcrite(partition.mesures[index], iVoix);
    const capacite = capaciteMesure(partition, index);
    const ecart = ecrite - capacite;
    if (Math.abs(ecart) < 1e-9) return 'complete';
    return ecart < 0 ? 'incomplete' : 'debordante';
}

/** Position de départ d'un évènement DANS SA VOIX, en noires depuis le début de la mesure. */
export function positionDansMesure(mesure, indexEvenement, iVoix = 0) {
    const evenements = mesure.voix[iVoix]?.evenements || [];
    let t = 0;
    for (let i = 0; i < indexEvenement && i < evenements.length; i++) t += dureeEnNoires(evenements[i].duree);
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
 * Aplatit la partition en une suite d'évènements datés, TOUTES VOIX CONFONDUES, en noires depuis le
 * début du morceau. Une seule traversée sert à la fois au moteur audio (quand programmer chaque
 * note) et au moteur de rendu (où poser la tête de lecture) : les deux lisent la MÊME liste, donc le
 * trait suivi à l'écran ne peut pas dériver de ce qu'on entend.
 *
 * LE TEMPS GLOBAL avance mesure par mesure d'après la CAPACITÉ déclarée (signature rythmique), pas
 * d'après ce qu'une voix particulière a écrit : une mesure en cours d'édition, où la voix 1 est
 * encore incomplète, ne doit pas pour autant décaler tout ce qui suit. Toutes les voix d'une même
 * mesure partagent donc la même origine temporelle `tMesure` — c'est précisément ce qui les fait
 * sonner ENSEMBLE.
 *
 * Les reprises ne sont volontairement PAS dépliées ici : elles relèvent du parcours de lecture, pas
 * de la partition écrite. Les déplier créerait des évènements en double sans identité propre, que le
 * rendu ne saurait plus rattacher à une position à l'écran.
 */
export function aplatir(partition) {
    const sortie = [];
    let tMesure = 0;
    partition.mesures.forEach((mesure, iMesure) => {
        mesure.voix.forEach((voix, iVoix) => {
            let t = tMesure;
            voix.evenements.forEach((evenement, iEvenement) => {
                const duree = dureeEnNoires(evenement.duree);
                sortie.push({ mesure: iMesure, voix: iVoix, evenement: iEvenement, debut: t, duree, ref: evenement });
                t += duree;
            });
        });
        tMesure += capaciteMesure(partition, iMesure);
    });
    return sortie;
}

/** Durée totale du morceau, en noires — la somme des CAPACITÉS déclarées, pas d'une voix en particulier. */
export function dureeTotale(partition) {
    return partition.mesures.reduce((total, _m, i) => total + capaciteMesure(partition, i), 0);
}

// ---------------------------------------------------------------------------------------------
// Import : normalisation d'un JSON venu de l'extérieur
// ---------------------------------------------------------------------------------------------

const borne = (v, min, max, defaut) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : defaut;
};

/** Un évènement brut → un évènement normalisé, notes bornées à l'instrument et à l'accordage donnés. */
function normaliserEvenement(eb, cordes, fiche) {
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
        // Doublon sur la même corde : physiquement impossible, et le rendu poserait deux chiffres
        // l'un sur l'autre. Le premier gagne.
        if (notes.some(n => n.corde === corde)) continue;
        notes.push(creerNote(corde, borne(nb?.frette, 0, fiche.casesMax, 0), {
            lien: LIENS[nb?.lien] ? nb.lien : null,
            bend: nb?.bend && Number.isFinite(Number(nb.bend.demiTons))
                ? { demiTons: Math.min(6, Math.max(0.5, Number(nb.bend.demiTons))) } : null,
            ghost: !!nb?.ghost,
            // `horsManche` / `hauteurVoulue` : posés par une transposition qui n'a trouvé aucune corde
            // capable de jouer la note (voir Editeur.transposerMorceau). Ils doivent SURVIVRE à un
            // aller-retour par le .json — cette liste est blanche, tout ce qui n'y figure pas est
            // silencieusement perdu : sans ces deux lignes, rouvrir un morceau effaçait les marques
            // rouges et laissait des notes rabattues au bord du manche sans plus rien pour le dire,
            // ni de quoi retrouver la hauteur voulue.
            ...(nb?.horsManche ? { horsManche: true } : {}),
            ...(Number.isFinite(Number(nb?.hauteurVoulue)) ? { hauteurVoulue: Number(nb.hauteurVoulue) } : {}),
        }));
    }
    return creerEvenement(duree, notes, {
        silence: !!eb?.silence || notes.length === 0,
        palmMute: !!eb?.palmMute,
        accent: !!eb?.accent,
        staccato: !!eb?.staccato,
        nuance: NUANCES.includes(eb?.nuance) ? eb.nuance : null,
    });
}

/**
 * Remet d'aplomb une partition venue d'un fichier .json.
 *
 * Un fichier ouvert par l'utilisateur est une entrée NON FIABLE, au même titre qu'une saisie : il a pu
 * être écrit par une version antérieure, modifié à la main, ou tronqué. Chaque champ est donc borné
 * plutôt que cru sur parole — une corde 12 sur une guitare à 6 cordes ferait planter le rendu à la
 * première ligne cherchée, et une durée `valeur: 0` bloquerait la lecture dans une boucle infinie de
 * durée nulle. On répare et on ouvre quand même : perdre un effet exotique vaut mieux que refuser
 * d'ouvrir le morceau de quelqu'un.
 *
 * DEUX FORMES DE MESURE SONT ACCEPTÉES EN ENTRÉE : `mesure.voix` (le format courant, un tableau
 * d'une ou deux voix) et `mesure.evenements` À PLAT — celui des fichiers écrits avant l'introduction
 * des voix (version 1 du format, y compris ceux déjà exportés pendant le développement de cette V1).
 * Les deux convergent ici vers la MÊME représentation interne ; aucune autre partie de l'application
 * n'a jamais besoin de savoir qu'un fichier « à plat » a existé.
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
        const mesure = creerMesure({ voix: [] });
        if (mb?.signature) {
            mesure.signature = {
                battements: borne(mb.signature.battements, 1, 32, 4),
                unite: [1, 2, 4, 8, 16, 32].includes(Number(mb.signature.unite)) ? Number(mb.signature.unite) : 4,
            };
        }
        if (mb?.armure !== null && mb?.armure !== undefined) mesure.armure = borne(mb.armure, -7, 7, 0);
        // Un fichier ANTÉRIEUR au mode n'en porte pas : la mesure qui fixe une armure sans mode est
        // réputée MAJEURE, l'interprétation d'usage d'une armure seule — et celle que l'application
        // affichait déjà, faute de mieux, avant que le mode existe.
        if (mb?.mode === 'majeur' || mb?.mode === 'mineur') mesure.mode = mb.mode;
        else if (mesure.armure !== null && mesure.armure !== undefined) mesure.mode = 'majeur';
        mesure.repriseDebut = !!mb?.repriseDebut;
        mesure.repriseFin = !!mb?.repriseFin;
        mesure.nbFois = borne(mb?.nbFois, 2, 99, 2);
        // Bornée en longueur : contrairement au titre (affiché une fois, dans l'en-tête), une
        // annotation se pose au-dessus d'UNE mesure qui peut être étroite — une chaîne sans limite
        // déborderait allègrement sur les mesures voisines (le rendu ne fait aucun retour à la ligne).
        if (typeof mb?.annotation === 'string' && mb.annotation.trim()) mesure.annotation = mb.annotation.trim().slice(0, 40);

        // Format courant (mesure.voix) si présent ; sinon un fichier antérieur aux voix, dont
        // l'unique liste d'évènements à plat devient la voix 0.
        const voixBrutes = Array.isArray(mb?.voix) && mb.voix.length
            ? mb.voix.slice(0, MAX_VOIX)
            : [{ evenements: mb?.evenements }];

        for (const vb of voixBrutes) {
            const evenements = (Array.isArray(vb?.evenements) ? vb.evenements : []).map(eb => normaliserEvenement(eb, cordes, fiche));
            if (!evenements.length) evenements.push(creerEvenement({ valeur: 4 }, [], { silence: true }));
            mesure.voix.push({ evenements });
        }
        if (!mesure.voix.length) mesure.voix.push(creerVoix(4));
        partition.mesures.push(mesure);
    }

    // Toute partition doit porter une signature et une armure de départ : le rendu du premier système
    // les dessine sans condition, et un `null` ici deviendrait un trou dans l'en-tête de portée.
    if (!partition.mesures[0].signature) partition.mesures[0].signature = { battements: 4, unite: 4 };
    if (partition.mesures[0].armure === null) partition.mesures[0].armure = 0;
    if (partition.mesures[0].mode !== 'majeur' && partition.mesures[0].mode !== 'mineur') partition.mesures[0].mode = 'majeur';

    return partition;
}

/** Copie profonde — base de l'historique undo/redo. */
export function cloner(partition) {
    return typeof structuredClone === 'function' ? structuredClone(partition) : JSON.parse(JSON.stringify(partition));
}
