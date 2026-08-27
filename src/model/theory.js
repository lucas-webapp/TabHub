// Théorie musicale : conversions hauteur ↔ nom de note, armures, orthographe des altérations.
//
// Tout ce module travaille en NUMÉRO MIDI (60 = do central) comme unité de hauteur unique. C'est la
// seule représentation qui soit à la fois exacte, comparable et directement jouable par Tone.js —
// contrairement à un nom de note, qui est déjà une INTERPRÉTATION (fa# et sol♭ sont la même touche).
// Cette distinction est le cœur du module : la tablature donne une hauteur (corde + case → MIDI),
// la portée solfège doit en déduire une ÉCRITURE, et cette écriture dépend de l'armure.

export const NOMS_LETTRES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

// Nom français de chaque lettre, pour l'interface (l'utilisateur lit « Ré », pas « D »).
export const LETTRE_VERS_FRANCAIS = { C: 'Do', D: 'Ré', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };

// Classe de hauteur (0-11) de chaque lettre SANS altération. Sert de pivot à toutes les conversions :
// une note écrite = une lettre + une altération, et sa hauteur s'en déduit par addition.
export const LETTRE_VERS_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Ordre d'apparition des altérations à l'armure — invariable depuis le XVIIe siècle, et c'est
// exactement ce qui permet de décrire une armure par un SEUL entier (voir alterationsDeLArmure) :
// +3 = les 3 premiers dièses (fa, do, sol), -2 = les 2 premiers bémols (si, mi).
export const ORDRE_DIESES = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
export const ORDRE_BEMOLS = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

// Symboles d'affichage. Les caractères Unicode dédiés (♯ ♭ ♮) plutôt que # et b : ces derniers sont
// des approximations typographiques qui jurent dans une partition (le « b » minuscule surtout, qui se
// lit comme une lettre). Le moteur de rendu dessine de toute façon ses propres glyphes vectoriels ;
// ces symboles-là servent aux libellés de l'interface et aux noms d'accordage.
export const SYMBOLE_ALTERATION = { '-2': '𝄫', '-1': '♭', '0': '', '1': '♯', '2': '𝄪' };

/** Nombre de dièses (>0) ou de bémols (<0) : -7..+7. 0 = do majeur / la mineur. */
export function alterationsDeLArmure(armure) {
    const table = {};
    if (armure > 0) for (let i = 0; i < Math.min(armure, 7); i++) table[ORDRE_DIESES[i]] = 1;
    else if (armure < 0) for (let i = 0; i < Math.min(-armure, 7); i++) table[ORDRE_BEMOLS[i]] = -1;
    return table;
}

// Noms d'armure pour l'interface, indexés de -7 à +7. La tonalité mineure relative est donnée en
// second : une armure ne dit pas à elle seule si le morceau est majeur ou mineur, et un guitariste
// qui écrit un riff en la mineur cherche « La m », pas « Do M ».
export const NOMS_ARMURES = [
    { armure: -7, majeur: 'Do♭ M', mineur: 'La♭ m' },
    { armure: -6, majeur: 'Sol♭ M', mineur: 'Mi♭ m' },
    { armure: -5, majeur: 'Ré♭ M', mineur: 'Si♭ m' },
    { armure: -4, majeur: 'La♭ M', mineur: 'Fa m' },
    { armure: -3, majeur: 'Mi♭ M', mineur: 'Do m' },
    { armure: -2, majeur: 'Si♭ M', mineur: 'Sol m' },
    { armure: -1, majeur: 'Fa M', mineur: 'Ré m' },
    { armure: 0, majeur: 'Do M', mineur: 'La m' },
    { armure: 1, majeur: 'Sol M', mineur: 'Mi m' },
    { armure: 2, majeur: 'Ré M', mineur: 'Si m' },
    { armure: 3, majeur: 'La M', mineur: 'Fa♯ m' },
    { armure: 4, majeur: 'Mi M', mineur: 'Do♯ m' },
    { armure: 5, majeur: 'Si M', mineur: 'Sol♯ m' },
    { armure: 6, majeur: 'Fa♯ M', mineur: 'Ré♯ m' },
    { armure: 7, majeur: 'Do♯ M', mineur: 'La♯ m' },
];

/**
 * LES TRENTE TONALITÉS, en notation INTERNATIONALE — quinze armures × deux modes.
 *
 * POURQUOI CETTE TABLE EXISTE. `NOMS_ARMURES` ci-dessus nomme une armure par sa PAIRE de relatives
 * (« Do M / La m »), ce qui décrit fidèlement l'armure — les deux partagent exactement les mêmes
 * altérations — mais ne permet pas de dire LAQUELLE des deux est la tonalité du morceau. On ne
 * pouvait donc pas trancher : un morceau en la mineur s'annonçait « Do M / La m », comme un morceau
 * en do majeur (retour utilisateur : « je dois obligatoirement trancher pour définir la tonalité »).
 * Ici chaque tonalité est une entrée à part entière, et choisir, c'est choisir pour de bon.
 *
 * CE QUE LE MODE CHANGE, ET CE QU'IL NE CHANGE PAS. Il ne change RIEN aux altérations dessinées à la
 * clé : do majeur et la mineur ont la même armure, c'est la définition même de relatives. Il porte
 * le NOM du morceau (« Am » et non « CM »), et il sert à la transposition, qui doit savoir de quelle
 * tonique elle part pour nommer celle où elle arrive.
 *
 * NOTATION INTERNATIONALE (C, D, E… plutôt que Do, Ré, Mi), comme demandé : « CM » pour do majeur,
 * « Cm » pour do mineur. Les altérations gardent leurs signes typographiques (♭ et ♯) plutôt que
 * « b » et « # », pour rester lisibles à côté du M/m qui les suit immédiatement.
 */
const TONIQUES_MAJEURES = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
const TONIQUES_MINEURES = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'];

export const TONALITES = [
    ...TONIQUES_MAJEURES.map((tonique, i) => ({ armure: i - 7, mode: 'majeur', tonique, nom: tonique + 'M' })),
    ...TONIQUES_MINEURES.map((tonique, i) => ({ armure: i - 7, mode: 'mineur', tonique, nom: tonique + 'm' })),
].sort((a, b) => a.armure - b.armure || (a.mode === 'majeur' ? -1 : 1));

/** La tonalité (armure + mode) désignée par ce couple, ou do majeur à défaut — jamais `undefined`,
 *  pour qu'un appelant n'ait pas à se garder d'un fichier importé au mode absent ou fantaisiste. */
export function tonaliteDe(armure, mode) {
    return TONALITES.find(t => t.armure === armure && t.mode === mode)
        || TONALITES.find(t => t.armure === armure && t.mode === 'majeur')
        || TONALITES.find(t => t.armure === 0 && t.mode === 'majeur');
}

/**
 * Écriture d'une hauteur MIDI dans une armure donnée.
 *
 * LE PROBLÈME. Une touche de piano (une classe de hauteur) a plusieurs noms possibles : la case 6 de
 * la corde de mi grave sonne un la♯ ou un si♭ selon le contexte. Choisir au hasard produit des
 * partitions illisibles — un si♭ écrit « la♯ » au milieu d'un morceau en fa majeur oblige le lecteur
 * à retraduire mentalement à chaque note.
 *
 * LA RÈGLE APPLIQUÉE, en deux temps :
 *   1. Si la hauteur appartient à la gamme de l'armure, on prend CETTE écriture-là, et l'altération
 *      est déjà portée par l'armure — donc rien à dessiner devant la note (`accidentelle: 0`).
 *   2. Sinon la note est chromatique : il faut une altération accidentelle explicite, et on choisit
 *      son sens d'après l'armure (dièse dans une armure à dièses, bémol dans une armure à bémols).
 *      Un fa♯ dans un morceau en si♭ majeur s'écrirait « sol♭ » : c'est bien ce qu'on veut, on reste
 *      dans la logique de lecture de la tonalité plutôt que d'y injecter une famille étrangère.
 *
 * @returns {{lettre, alteration, octave, accidentelle, pas}} `alteration` est l'altération TOTALE de
 *   la note (-2..+2), `accidentelle` seulement celle qu'il faut DESSINER (0 quand l'armure la porte
 *   déjà), et `pas` la position diatonique absolue — l'unique donnée dont le moteur de rendu a besoin
 *   pour placer la note sur une ligne ou un interligne (voir engine/layout.js).
 */
export function ecrireHauteur(midi, armure = 0) {
    const pc = ((midi % 12) + 12) % 12;
    const alterationsArmure = alterationsDeLArmure(armure);

    // Candidates : toute lettre dont l'altération nécessaire reste dans -2..+2. Une même hauteur en
    // produit deux ou trois (ré♯ / mi♭ / fa𝄫), qu'on départage ensuite par un score.
    const candidates = [];
    for (const lettre of NOMS_LETTRES) {
        let alteration = pc - LETTRE_VERS_PC[lettre];
        // Ramène l'écart dans -6..+5 : sans ça, si (pc 11) vu depuis do (pc 0) donnerait +11 au lieu
        // de -1, et la seule écriture correcte serait rejetée.
        if (alteration > 5) alteration -= 12;
        if (alteration < -6) alteration += 12;
        if (Math.abs(alteration) > 2) continue;

        const alterationArmure = alterationsArmure[lettre] || 0;
        const dansLArmure = alteration === alterationArmure;

        let score = 0;
        if (dansLArmure) score += 100;                       // 1. la gamme d'abord, toujours
        if (alteration === 0) score += 10;                    // note naturelle : la plus simple à lire
        if (Math.abs(alteration) === 1) score += 5;
        if (Math.abs(alteration) === 2) score -= 50;          // double altération : dernier recours
        // 2. sens de l'altération accordé à l'armure. Armure neutre (do majeur) : dièses par défaut,
        // convention des éditions courantes pour les notes de passage ascendantes.
        if (!dansLArmure && alteration !== 0) {
            const sensArmure = armure < 0 ? -1 : 1;
            if (Math.sign(alteration) === sensArmure) score += 3;
        }
        candidates.push({ lettre, alteration, score, dansLArmure });
    }

    candidates.sort((a, b) => b.score - a.score);
    const choisie = candidates[0];

    // L'octave se déduit de la hauteur RÉELLE moins ce que vaut l'écriture choisie : si♯3 et do4 sont
    // la même touche, mais la première s'écrit sur la ligne du si, une octave plus bas. Calculer
    // l'octave depuis le MIDI seul se tromperait précisément dans ces cas-là.
    const octave = Math.round((midi - LETTRE_VERS_PC[choisie.lettre] - choisie.alteration) / 12) - 1;

    return {
        lettre: choisie.lettre,
        alteration: choisie.alteration,
        octave,
        accidentelle: choisie.dansLArmure ? 0 : choisie.alteration,
        pas: NOMS_LETTRES.indexOf(choisie.lettre) + 7 * octave,
    };
}

/**
 * INVERSE d'ecrireHauteur : la hauteur MIDI que porte une POSITION diatonique donnée (un « pas »,
 * voir ecrireHauteur) dans une armure donnée — ce dont a besoin un clic direct sur une portée
 * (voir engine/layout.js#pasDeLaPosition, main.js#cibleDepuisClicPiano) pour retrouver la hauteur
 * MIDI voulue à partir de la LIGNE OU L'INTERLIGNE visé, plutôt qu'un numéro de case qui n'existe
 * pas au piano. La lettre de la position porte l'altération de l'armure si elle y figure (une
 * portée en fa majeur affiche un si♭ à l'endroit même où do majeur montrerait un si), sinon la note
 * naturelle — jamais une altération accidentelle : celle-ci se pose par un geste EXPLICITE à part
 * (hors V1), pas en cliquant simplement sur la ligne voisine.
 */
export function hauteurDepuisPas(pas, armure = 0) {
    const lettre = NOMS_LETTRES[((pas % 7) + 7) % 7];
    const octave = Math.floor(pas / 7);
    const alteration = alterationsDeLArmure(armure)[lettre] || 0;
    return LETTRE_VERS_PC[lettre] + alteration + (octave + 1) * 12;
}

/** Nom court affichable, ex. « La♯3 ». */
export function nomDeHauteur(midi, armure = 0, francais = false) {
    const e = ecrireHauteur(midi, armure);
    const base = francais ? LETTRE_VERS_FRANCAIS[e.lettre] : e.lettre;
    return base + SYMBOLE_ALTERATION[String(e.alteration)] + e.octave;
}

/** Fréquence en Hz — La3 (MIDI 69) = 440 Hz. Utilisé par le moteur audio. */
export function midiVersFrequence(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Nom anglo-saxon sans altération Unicode, seul format que Tone.js accepte en entrée (« A#3 »). */
export function midiVersNomTone(midi) {
    const NOMS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const pc = ((midi % 12) + 12) % 12;
    return NOMS[pc] + (Math.floor(midi / 12) - 1);
}

/** Analyse « E2 », « A#3 », « Bb1 » → numéro MIDI. Sert aux accordages personnalisés saisis à la main. */
export function nomVersMidi(texte) {
    const m = String(texte).trim().match(/^([A-Ga-g])([#♯b♭]{0,2})(-?\d+)$/);
    if (!m) return null;
    const lettre = m[1].toUpperCase();
    let alteration = 0;
    for (const c of m[2]) alteration += (c === '#' || c === '♯') ? 1 : -1;
    return LETTRE_VERS_PC[lettre] + alteration + 12 * (parseInt(m[3], 10) + 1);
}
