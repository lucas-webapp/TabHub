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

import { dureeEnNoires, noiresParMesure, uniteDeGroupement, positionTernaire, positionDepuisTernaire } from './duration.js';
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

// PLUS DE TABLES `EFFETS_NOTE` / `EFFETS_EVENEMENT` ICI (audit) : personne ne les importait, et
// leur contenu vivait déjà en double. Les LIBELLÉS sont dans edit/raccourcis.js (« Palm mute »,
// « Note fantôme »… avec leur touche et leur aperçu de palette), les ABRÉGÉS gravés dans
// engine/layout.js (le « P.M. » suivi de son pointillé). Deux vérités pour un même vocabulaire
// finissent toujours par diverger ; celle qui reste est celle que le code lit vraiment.

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
        // Nom d'accord (« A7 », « E7 »…) affiché au-dessus de la portée à l'aplomb de CET évènement
        // précis — à la différence de l'annotation de section (voir Mesure#annotation), un accord
        // change souvent PLUSIEURS fois dans la même mesure, il ne peut donc pas s'accrocher à elle.
        // `null` : rien à afficher (voir engine/layout.js, qui ne réserve de bande au-dessus d'un
        // système que si l'un de ses évènements en porte un).
        accord: null,
        // RYTHME IMPOSÉ, EN ATTENTE D'UNE CASE (voir ui/rythme.js). Posé par l'aide rythmique sur les
        // évènements qu'elle insère : leur DURÉE fait loi, il ne manque plus que la hauteur.
        //
        // À QUOI IL SERT, ET C'EST DEUX CHOSES À LA FOIS — la raison pour laquelle ce champ existe
        // plutôt qu'une règle globale :
        //   1. `saisirChiffre` ne redimensionne PAS un évènement marqué. Sans cela, la « durée
        //      collante » de la palette écrase le rythme qu'on vient d'insérer : mesuré, un
        //      « croche pointée + double + triolet » se retrouvait en six croches plates dès qu'on
        //      donnait une case à chaque évènement (voir commands.js#saisirChiffre).
        //   2. La tablature met ces cases EN SURBRILLANCE (voir engine/layout.js) : on voit ce qui
        //      reste à choisir, et la marque s'éteint case par case.
        // Le marqueur tombe au premier chiffre tapé — il décrit une attente, pas une propriété du
        // rythme, et n'a donc aucune raison de survivre à sa satisfaction.
        aRemplir: false,
        // `lienSuivant` — UNE LIAISON QUI N'A PAS ENCORE DE NOTE POUR LA PORTER.
        //
        // Une liaison vit normalement sur la note (`note.lien`). Mais une case à remplir n'a pas
        // encore de note, et l'aide rythmique sait désormais faire franchir une barre à une note :
        // elle l'écrit alors en deux figures LIÉES, donc deux évènements vides. L'intention doit
        // survivre jusqu'au chiffre qu'on tapera, sans quoi une note tenue par-dessus la barre
        // ressortirait en deux notes réattaquées. Posé par model/rythme.js#evenementsParMesure,
        // consommé par edit/commands.js#_prolongerLiaison, et il tombe avec la case remplie.
        lienSuivant: false,
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
    const figures = figuresPour(noires);
    const sortie = figures.map(({ valeur, points }) => creerEvenement({ valeur, points }, silence ? [] : notes, { silence }));
    return sortie.length ? sortie : [creerEvenement({ valeur: 4 }, [], { silence: true })];
}

/**
 * Décompose une durée en noires en la plus longue suite de figures STANDARD qui la couvre (pointée
 * d'abord — voir decouperEnEvenements). Extrait à part pour être réutilisé par l'import MIDI
 * (io/midi.js) : lui a besoin de VRAIES notes, chacune sa propre copie et liées par une prolongation
 * d'une figure à l'autre — decouperEnEvenements, pensé pour un silence (qu'on ne relie jamais), donne
 * la même liste de figures à toutes les copies d'un même tableau `notes`, un partage sans risque
 * seulement parce qu'un silence n'a justement aucune note à partager.
 */
export function figuresPour(noires) {
    const EPS = 1e-9;
    const sortie = [];
    let reste = noires;
    while (reste > EPS) {
        let posee = false;
        for (const valeur of [1, 2, 4, 8, 16, 32]) {
            for (const points of [1, 0]) {   // pointée d'abord : couvre plus large en un seul évènement
                const d = dureeEnNoires({ valeur, points });
                if (d <= reste + EPS) {
                    sortie.push({ valeur, points });
                    reste -= d;
                    posee = true;
                    break;
                }
            }
            if (posee) break;
        }
        if (!posee) break;   // reste plus court qu'une triple-croche : on n'ira pas plus loin
    }
    return sortie;
}

/**
 * LES FIGURES DE SILENCE POUR UN PASSAGE, À SA PLACE DANS LA MESURE.
 *
 * LE PROBLÈME QUE `figuresPour` NE RÉSOUT PAS. Elle donne la plus longue suite de figures qui couvre
 * une durée, sans savoir OÙ cette durée commence — ce qui est exactement ce qu'il faut pour remplir
 * une mesure depuis son début, et faux dès qu'on part d'ailleurs. Trois temps à partir du deuxième
 * temps d'un 4/4 y donnent une blanche pointée : une figure qui enjambe la moitié de la mesure, ce
 * qu'aucune édition n'écrit. Un lecteur ne voit alors plus où tombent les temps.
 *
 * LA RÈGLE DE GRAVURE, celle que suivent MuseScore, Guitar Pro et les éditions imprimées : un
 * silence ne commence QUE sur une position multiple de sa propre durée. Une blanche de silence
 * tombe sur le temps 1 ou le temps 3 d'un 4/4, jamais sur le 2 ; une noire sur n'importe quel temps ;
 * une croche sur n'importe quelle croche. On prend donc, à chaque pas, la plus longue figure qui
 * tienne dans ce qui reste ET dont la position soit alignée — ce qui produit, pour trois temps depuis
 * le deuxième, une noire puis une blanche. C'est ce qu'écrirait un copiste.
 *
 * PAS DE SILENCE POINTÉ ICI, à la différence de `figuresPour`. Un silence pointé ne s'emploie qu'à
 * l'intérieur d'un temps composé (le 6/8, le 9/8), où il complète le temps ; ailleurs il enjambe et
 * brouille la lecture. Les exclure coûte parfois une figure de plus, jamais une figure fautive — et
 * la mesure composée reste couverte, puisqu'un temps de 6/8 vaut trois croches que l'alignement
 * regroupe correctement.
 *
 * ET POURQUOI IL N'Y A PAS DE `figuresNotePour` EN FACE. Une version de cette feuille en portait
 * une, qui appliquait aux notes la même discipline d'alignement en la relâchant un peu (une figure
 * admise si elle tenait dans un temps, ou si elle couvrait des temps entiers). C'était faux, et
 * l'import MIDI l'a démontré : une note tenue de la deuxième croche du temps 1 à la deuxième croche
 * du temps 2 — la syncope la plus banale du répertoire, `croche noire croche noire` — en ressortait
 * coupée en DEUX croches liées, là où toute édition imprimée écrit UNE noire. Mesuré : deux notes
 * écrites, TROIS têtes relues ; trois notes, QUATRE têtes.
 *
 * La règle des silences n'a pas d'équivalent pour les notes parce que les deux signes ne disent pas
 * la même chose. Un silence sert à MONTRER la métrique : l'enjamber la cache, il n'y a rien d'autre
 * à lire. Une note, elle, porte la musique par-dessus la métrique — l'enjamber EST la syncope, et
 * c'est le sens de la phrase. Ce qui reste vrai pour les deux, c'est qu'une durée qu'aucune figure
 * n'exprime doit être coupée AUX TEMPS plutôt que n'importe où ; cette partie-là vit dans
 * model/rythme.js#figuresDeCourse, qui ne coupe une note que faute de figure exacte.
 *
 * @param {number} noires   durée du passage à couvrir
 * @param {number} depuis   sa position dans la mesure, en noires depuis le début
 */
export function figuresSilencePour(noires, depuis = 0) {
    const EPS = 1e-9;
    const sortie = [];
    let reste = noires, pos = depuis;
    while (reste > EPS) {
        let posee = false;
        for (const valeur of [1, 2, 4, 8, 16, 32]) {
            const d = dureeEnNoires({ valeur, points: 0 });
            if (d > reste + EPS) continue;
            // Alignement : `pos` doit être un multiple entier de `d`. C'est toute la règle.
            if (Math.abs(pos / d - Math.round(pos / d)) > 1e-6) continue;
            sortie.push({ valeur, points: 0 });
            reste -= d; pos += d; posee = true;
            break;
        }
        if (!posee) break;   // reste plus court qu'une triple-croche, ou position inalignable
    }
    return sortie;
}

/**
 * Voix neuve, dimensionnée pour occuper toute la capacité de la mesure qui l'accueille — jamais une
 * seule noire par défaut, qui laisserait une mesure en 3/8 ou 6/8 « incomplète » dès sa création.
 */
export function creerVoix(capaciteNoires = 4) {
    return { evenements: decouperEnEvenements(capaciteNoires) };
}

/** Mesure vierge : une seule voix, un seul silence — de quoi avoir toujours une position de curseur. */
/**
 * REPÈRES DE NAVIGATION — ce qui permet d'écrire un morceau ENTIER sans le recopier trois fois :
 * « reprends au début », « reprends au signe », « termine ici ».
 *
 * DEUX FAMILLES, et c'est ce qui décide de leur dessin (voir engine/layout.js). Segno et Coda sont
 * des SIGNES : une cible qu'un renvoi désigne, tracée telle quelle depuis des siècles. Les autres
 * sont des INSTRUCTIONS, écrites en abrégé et en italique comme toute indication de jeu. `symbole`
 * porte le tracé pour les deux premiers, `texte` le libellé pour les autres — jamais les deux.
 */
export const REPERES = {
    segno:    { id: 'segno',    nom: 'Segno (le signe)',       symbole: 'segno' },
    coda:     { id: 'coda',     nom: 'Coda',                   symbole: 'coda' },
    daCapo:   { id: 'daCapo',   nom: 'Da Capo (au début)',     texte: 'D.C.' },
    dalSegno: { id: 'dalSegno', nom: 'Dal Segno (au signe)',   texte: 'D.S.' },
    alCoda:   { id: 'alCoda',   nom: 'al Coda (vers la coda)', texte: 'al Coda' },
    fine:     { id: 'fine',     nom: 'Fine (fin du morceau)',  texte: 'Fine' },
};

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
        // COMBIEN DE FOIS la section bornée par cette reprise fermante se joue EN TOUT (2 par défaut :
        // une fois, puis une reprise). Lu par parcoursDeLecture, et par lui seul — c'est une
        // instruction de PARCOURS, pas une propriété de la musique écrite.
        nbFois: 2,
        // LEVÉE (anacrouse) : la DURÉE en noires de cette mesure volontairement courte, ou `null`
        // pour une mesure ordinaire. Une levée n'est pas une mesure fausse : c'est la mise en train
        // avant le premier temps fort, et elle vaut ce qu'elle vaut. C'est donc une CAPACITÉ, posée
        // sur la mesure, qui l'emporte sur celle de la signature (voir capaciteMesure).
        levee: null,
        // MAISON DE 1re / 2e FOIS (volta) : la liste des passages où CETTE mesure se joue, ou `null`
        // si elle se joue à tous. `[1]` = « 1re fois », `[2]` = « 2e fois », `[1, 3]` = « 1re et 3e ».
        // Portée par la mesure et non par la reprise, parce que c'est bien la mesure qu'on saute :
        // une maison couvre souvent plusieurs mesures, chacune marquée du même numéro.
        volta: null,
        // RETOUR À LA LIGNE FORCÉ AVANT cette mesure (retour utilisateur : « permets-moi de faire un
        // retour à la ligne pour la portée [...] si je veux uniquement créer une fiche d'exercices
        // avec plusieurs petits morceaux de 2 mesures »). De la MISE EN PAGE, pas de la musique — mais
        // porté par le document plutôt que par l'interface : une fiche d'exercices dont les systèmes
        // se recolleraient à la réouverture du fichier n'aurait aucun intérêt. Honoré par les DEUX
        // découpages (voir engine/layout.js).
        sautAvant: false,
        // REPÈRE DE NAVIGATION posé au-dessus de cette mesure (retour utilisateur : « il faudrait
        // ajouter la possibilité de noter des Coda, Da Capo, etc… comme pour les vraies portées, qui
        // me permettent d'écrire un morceau entier »). Un seul par mesure : sur une partition gravée,
        // deux instructions de renvoi au même endroit ne se lisent pas — et l'une des deux serait de
        // toute façon inatteignable. Voir REPERES plus haut pour les valeurs, et engine/layout.js
        // pour leur dessin (Segno et Coda tracés, les autres en texte).
        repere: null,
        // BARRE DE FIN de cette mesure : `null` (trait simple), 'double' (fin de section) ou
        // 'finale' (fin du morceau). La reprise fermante reste à part (repriseFin) : c'est une barre
        // ET une instruction de jeu, alors que ces deux-ci ne font que ponctuer.
        barre: null,
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
            // LECTURE TERNAIRE (« swing ») — la convention classique des partitions : on écrit des
            // croches DROITES et l'on prévient, en tête, qu'elles se lisent longue-brève. L'autre
            // voie serait un triolet sur chaque temps, illisible sur un morceau entier.
            //
            // CE CHAMP NE CHANGE PAS CE QU'ON ÉCRIT, seulement ce qu'on ENTEND et ce qu'on exporte
            // (voir audio/player.js et io/midi.js) — plus l'indication gravée près du tempo (voir
            // engine/layout.js). C'est pourquoi il vit dans `meta` et non dans une mesure : c'est
            // une convention de lecture du morceau, pas un contenu musical.
            //
            // À DISTINGUER DU VRAI TRIOLET (`duree.nolet`), qui reste disponible et exact : celui-ci
            // dit « ces trois notes valent deux », là où `ternaire` dit « toutes les paires de
            // croches se lisent ainsi ». Un triolet dans un morceau binaire, c'est le premier ; un
            // morceau de jazz entier, c'est le second.
            ternaire: false,
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
    // LA LEVÉE L'EMPORTE SUR LA SIGNATURE. Une anacrouse d'un temps en 4/4 ne vaut pas quatre temps
    // — elle vaut un, et elle est JUSTE. Tout ce qui juge une mesure passe par ici (le fond rouge,
    // le chiffre de dette, l'insertion, la grille d'écriture, le métronome), et tout se met donc
    // d'accord d'un seul coup plutôt qu'en ajoutant un cas particulier à chacun.
    const levee = partition?.mesures?.[index]?.levee;
    if (levee > 0) return levee;
    return noiresParMesure(signatureEffective(partition, index));
}

/**
 * LE NUMÉRO AFFICHÉ d'une mesure — 1 pour la première mesure COMPLÈTE, et rien pour une levée.
 *
 * C'est la convention de la gravure, et elle n'est pas cosmétique : « mesure 12 » doit désigner la
 * même mesure pour le musicien qui lit la partition et pour celui qui la lui a envoyée. Compter la
 * levée décalerait tout d'un cran par rapport à n'importe quelle édition imprimée du même morceau.
 *
 * @returns {number|null} le numéro, ou `null` si cette mesure n'en porte pas (la levée).
 */
export function numeroDeMesure(partition, index) {
    if (partition?.mesures?.[index]?.levee > 0) return null;
    let n = 0;
    for (let i = 0; i <= index && i < (partition?.mesures?.length || 0); i++) {
        if (!(partition.mesures[i].levee > 0)) n++;
    }
    return n;
}

/**
 * L'INVERSE : le rang dans le tableau de la mesure qui porte ce NUMÉRO gravé.
 *
 * Il faut les deux sens, et il faut qu'ils viennent d'ici tous les deux. « Aller à la mesure 12 »
 * doit ouvrir la mesure sur laquelle le moteur a écrit « 12 », sans quoi un morceau à levée
 * enverrait systématiquement une mesure trop loin — et la partition imprimée qu'on recopie, qui dit
 * « reprendre mesure 12 », ne voudrait plus rien dire ici. Un second comptage écrit ailleurs
 * finirait par diverger du premier ; celui-ci relit `numeroDeMesure`.
 *
 * Rend `null` pour un numéro qui n'existe pas : mieux vaut ne rien faire que sauter au plus proche.
 */
export function indexDeNumero(partition, numero) {
    const mesures = partition?.mesures || [];
    for (let i = 0; i < mesures.length; i++) {
        if (numeroDeMesure(partition, i) === numero) return i;
    }
    return null;
}

/** Combien de mesures NUMÉROTÉES compte le morceau — la levée n'en fait pas partie. */
export function nbMesuresNumerotees(partition) {
    const mesures = partition?.mesures || [];
    let n = 0;
    for (const m of mesures) if (!(m.levee > 0)) n++;
    return n;
}

/**
 * LA PLACE QUE LA MESURE PREND SUR L'AXE DU TEMPS, en noires — sa capacité, ou ce qu'elle porte
 * vraiment quand c'est davantage.
 *
 * POURQUOI ELLE N'EST PAS TOUJOURS LA CAPACITÉ, et c'était un bogue audible. Une mesure peut se
 * retrouver plus longue que sa signature sans qu'aucune édition ne l'ait voulu : il suffit de
 * changer la signature d'un 4/4 déjà écrit pour du 3/4, et les quatre noires restent en place.
 * `aplatir` posait alors les évènements à leur durée ÉCRITE tout en avançant de mesure en mesure
 * d'une CAPACITÉ — deux comptes différents pour le même axe. Mesuré : la dernière note de la mesure
 * courait de 3,00 à 4,00 pendant que la première de la suivante démarrait à 3,00. Un temps entier
 * où deux notes sonnaient ensemble, sans que rien ne l'explique.
 *
 * LA RÈGLE EST DONC : CE QUI EST ÉCRIT EST CE QUI SONNE. Une mesure trop pleine dure plus longtemps,
 * une mesure incomplète garde sa capacité — le silence manquant se fait entendre comme un silence,
 * jamais comme un empiètement sur la mesure suivante. C'est le comportement de Guitar Pro, qui
 * signale la mesure fausse en rouge mais la joue telle qu'elle est écrite.
 *
 * LE MAXIMUM ENTRE LES VOIX, parce que deux voix d'une même mesure peuvent ne pas totaliser pareil
 * en cours d'écriture : c'est la plus longue qui décide où tombe la barre, sans quoi elle
 * déborderait sur la mesure d'après.
 */
export function longueurMesure(partition, index) {
    const capacite = capaciteMesure(partition, index);
    const mesure = partition.mesures[index];
    if (!mesure) return capacite;
    let plusLongue = 0;
    for (let v = 0; v < mesure.voix.length; v++) plusLongue = Math.max(plusLongue, dureeEcrite(mesure, v));
    return Math.max(capacite, plusLongue);
}

/**
 * Position en noires du DÉBUT de la mesure `index` — la somme des LONGUEURS de toutes celles qui la
 * précèdent (voir longueurMesure : la capacité, sauf pour une mesure trop pleine, qui prend la place
 * qu'elle occupe vraiment). Un repère de temps partagé par tout ce qui doit situer une mesure entière sur l'axe
 * global : lancer la lecture depuis le curseur (main.js#positionDuCurseurEnNoires), borner une boucle
 * de lecture (audio/player.js#Lecteur.definirBoucle). `index === partition.mesures.length` est un
 * appel volontairement valide : il donne la FIN du morceau (le début de la mesure « après la
 * dernière »), sans borne à retirer chez l'appelant.
 */
export function positionDebutMesure(partition, index) {
    let t = 0;
    for (let m = 0; m < index; m++) t += longueurMesure(partition, m);
    return t;
}

/**
 * Découpe le morceau en SECTIONS d'après les annotations posées sur les mesures (« Couplet 1 »,
 * « Refrain »… — voir `mesure.annotation`, engine/layout.js) : chaque mesure annotée OUVRE une
 * section qui court jusqu'à la prochaine annotation (ou la fin du morceau). Les mesures avant la
 * toute première annotation forment leur propre section, `titre: ''` — jamais absorbées dans la
 * suivante, pour ne rien perdre d'un export par section (voir io/midi.js) : une intro sans étiquette
 * reste une section à part entière, simplement sans titre.
 *
 * Un morceau SANS AUCUNE annotation donne une seule section couvrant tout : c'est le signal, pour
 * qui appelle cette fonction, qu'un découpage par section n'aurait aucun sens ici (voir
 * exporterMidiFichier, qui ne propose le choix qu'à partir de deux).
 *
 * `{ titre, debut, fin }` — `debut`/`fin` sont des index de mesure INCLUSIFS, comme le reste du
 * modèle (voir `index` de positionDebutMesure).
 */
export function sectionsDe(partition) {
    const mesures = partition.mesures;
    if (!mesures.length) return [{ titre: '', debut: 0, fin: -1 }];
    const sections = [];
    let debut = 0;
    let titre = (mesures[0].annotation || '').trim();
    for (let i = 1; i < mesures.length; i++) {
        const a = (mesures[i].annotation || '').trim();
        if (a) {
            sections.push({ titre, debut, fin: i - 1 });
            debut = i;
            titre = a;
        }
    }
    sections.push({ titre, debut, fin: mesures.length - 1 });
    return sections;
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

/** Garde-fou du parcours de lecture : un morceau ne se joue pas indéfiniment, même mal écrit. */
const MESURES_JOUEES_MAX = 4000;

/**
 * LE PARCOURS DE LECTURE — la suite des mesures réellement TRAVERSÉES, reprises dépliées.
 *
 * CE QU'IL CORRIGE. Les barres de reprise étaient DESSINÉES mais jamais JOUÉES : zéro occurrence de
 * « reprise » dans audio/player.js. On écrivait ‖: :‖ et la lecture passait tout droit. Or c'est
 * précisément en comparant à l'oreille qu'on vérifie une recopie — et on comparait un morceau qui
 * n'avait pas la forme de l'original.
 *
 * SÉPARÉ D'`aplatir`, ET C'EST LE POINT D'ARCHITECTURE. `aplatir` décrit la partition ÉCRITE : un
 * évènement, une place. Y déplier les reprises créerait des évènements en double sans identité
 * propre, que le rendu ne saurait plus rattacher à une position à l'écran (c'est la note qu'on
 * trouve en tête d'`aplatir`, et elle tient toujours). Le parcours, lui, ne parle que de MESURES,
 * et il ne duplique rien : il répète un INDEX. Le lecteur programme donc la même note plusieurs
 * fois, et la tête de lecture retraduit sa position en position écrite — une seule note à l'écran,
 * jouée deux fois (voir Lecteur.programmer et _suivre).
 *
 * LES RÈGLES, celles de la gravure :
 *   — `:‖` renvoie au dernier `‖:` rencontré, ou au début du morceau s'il n'y en a pas ;
 *   — `nbFois` dit combien de fois la section se joue EN TOUT (2 par défaut) ;
 *   — une mesure qui porte une MAISON (`volta: [1]`) n'est jouée qu'aux passages qu'elle liste.
 *
 * LE COMPTEUR DE PASSAGE NE SE REMET À 1 QU'EN ARRIVANT PAR L'AVANT sur un `‖:`. Y revenir par un
 * saut ne rouvre pas une nouvelle section — c'est le même passage qui continue, un tour plus loin,
 * et c'est ce qui permet à la maison de 2e fois de savoir qu'on en est au deuxième tour.
 *
 * @returns {number[]} les index de mesure, dans l'ordre où on les joue
 */
export function parcoursDeLecture(partition) {
    const mesures = partition?.mesures || [];
    const sortie = [];
    let i = 0;
    let debutSection = 0;
    let passe = 1;
    let parSaut = false;
    const tours = new Map();          // index du `:‖` -> tours déjà pris
    while (i >= 0 && i < mesures.length && sortie.length < MESURES_JOUEES_MAX) {
        const m = mesures[i];
        if (m.repriseDebut && !parSaut) { debutSection = i; passe = 1; }
        parSaut = false;
        // LA MAISON FILTRE AVANT TOUT LE RESTE : une mesure qu'on saute ne compte pas ses reprises
        // non plus. C'est ce qui fait qu'un `:‖` posé DANS la maison de 1re fois ne renvoie pas une
        // deuxième fois au deuxième tour — on ne passe simplement plus dessus.
        if (m.volta?.length && !m.volta.includes(passe)) { i++; continue; }
        sortie.push(i);
        if (m.repriseFin) {
            const faits = (tours.get(i) || 0) + 1;
            tours.set(i, faits);
            if (faits < Math.max(2, m.nbFois || 2)) {
                i = debutSection;
                passe = faits + 1;
                parSaut = true;
                continue;
            }
        }
        i++;
    }
    return sortie;
}

/** Le morceau contient-il au moins une instruction de reprise ? Sert à ne rien changer quand il n'y
 *  en a pas : le parcours vaut alors exactement 0, 1, 2… et tout se comporte comme avant. */
export function aDesReprises(partition) {
    return (partition?.mesures || []).some(m => m.repriseFin || m.volta?.length);
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
        tMesure += longueurMesure(partition, iMesure);
    });
    return sortie;
}

/** Durée totale du morceau, en noires — la somme des LONGUEURS des mesures (voir longueurMesure),
 *  pas d'une voix en particulier : une mesure trop pleine allonge le morceau d'autant, faute de quoi
 *  la lecture s'arrêterait avant sa dernière note. */
export function dureeTotale(partition) {
    return partition.mesures.reduce((total, _m, i) => total + longueurMesure(partition, i), 0);
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
        // Liste blanche, comme le reste de cette fonction : sans cette ligne, un nom d'accord
        // survivrait à la session en cours mais disparaîtrait silencieusement à la réouverture du
        // fichier — exactement le piège que le commentaire au-dessus (horsManche/hauteurVoulue) décrit.
        accord: typeof eb?.accord === 'string' ? eb.accord.trim().slice(0, 12) || null : null,
        // Même piège que les deux blocs ci-dessus : sans cette ligne, un rythme inséré puis
        // enregistré rouvrirait SANS sa surbrillance ni sa protection de durée — on croirait le
        // remplir et on l'écraserait.
        aRemplir: !!eb?.aRemplir,
        // Même raison : un rythme inséré, enregistré puis rouvert avant d'être rempli doit garder
        // ses liaisons en attente, sinon la note à cheval sur la barre se casse en deux à la
        // réouverture.
        lienSuivant: !!eb?.lienSuivant,
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
            // Absent d'un fichier antérieur = BINAIRE, l'interprétation d'usage d'une partition qui
            // ne dit rien : `!!undefined` donne bien `false`, aucune migration à écrire.
            ternaire: !!brut.meta?.ternaire,
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
        // La volta arrive d'un fichier : on ne garde que des entiers ≥ 1, et `null` plutôt qu'un
        // tableau vide — « aucune maison » et « une maison qui ne couvre aucun passage » ne sont pas
        // la même chose, et la seconde n'a pas de sens.
        const volta = Array.isArray(mb?.volta)
            ? [...new Set(mb.volta.map(v => Math.round(Number(v))).filter(v => Number.isFinite(v) && v >= 1))].sort((a, b) => a - b)
            : null;
        mesure.volta = volta && volta.length ? volta : null;
        mesure.sautAvant = !!mb?.sautAvant;
        // Bornés à ce que le moteur sait dessiner : un fichier importé (ou écrit à la main) ne doit
        // pas pouvoir demander un repère inconnu, qui ne s'afficherait nulle part tout en restant
        // dans le document — la même règle que partout ailleurs dans `normaliser`.
        mesure.repere = REPERES[mb?.repere] ? mb.repere : null;
        mesure.barre = ['double', 'finale'].includes(mb?.barre) ? mb.barre : null;
        mesure.nbFois = borne(mb?.nbFois, 2, 99, 2);
        // Une levée lue d'un fichier : une durée strictement positive, ou rien. Zéro et négatif ne
        // décrivent aucune mesure jouable.
        const levee = Number(mb?.levee);
        mesure.levee = Number.isFinite(levee) && levee > 0 ? levee : null;
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

// ---------------------------------------------------------------------------------------------
// GRILLE TERNAIRE — où sont les temps, quand `meta.ternaire` est posé
//
// La transformation elle-même vit dans model/duration.js (positionTernaire et sa réciproque) : c'est
// de l'arithmétique sur un temps. Ce qui vit ICI, c'est la question « où commencent les temps, et
// combien vaut un temps » — elle ne se répond qu'avec les mesures sous les yeux.
//
// DEUX CONSOMMATEURS, UNE SEULE GRILLE : la lecture audio (audio/player.js) et l'export MIDI
// (io/midi.js). C'est délibéré — l'utilisateur va comparer ce qu'il entend dans TabHub à ce que joue
// son DAW, et deux grilles calculées séparément finiraient par diverger sur un détail (une mesure
// composée, un changement de signature) qu'aucun des deux côtés ne surveille.
// ---------------------------------------------------------------------------------------------

/**
 * La grille des temps pour la lecture ternaire, une entrée par mesure — ou `null` si le morceau est
 * binaire, ce qui fait disparaître tout le mécanisme sans un calcul de plus.
 *
 * `unite: 0` MARQUE UNE MESURE QUI NE SWINGUE PAS, et `positionTernaire` rend alors la position
 * inchangée (elle exige `unite > 0`) : aucun cas particulier à écrire chez les appelants. Ne swingue
 * que la mesure dont le TEMPS SE DIVISE EN DEUX à l'écrit, c'est-à-dire `uniteDeGroupement === 1` —
 * la noire des mesures simples (4/4, 3/4, 2/2). Les deux autres familles en sont exclues, et pour la
 * même raison de fond : la convention « croche = triolet » suppose qu'on écrit DEUX croches par
 * temps, et qu'on les joue trois.
 *   - MESURE COMPOSÉE (6/8, 9/8, 12/8) : le temps y vaut une noire pointée et s'écrit DÉJÀ en trois
 *     croches. Elle est ternaire par son chiffrage, pas par convention — swinguer par-dessus
 *     découperait un temps à trois en deux moitiés inégales, ce qui n'a aucun sens musical.
 *   - MESURE EN x/8 NON COMPOSÉE (5/8, 7/8) : le temps y EST la croche (voir uniteDeGroupement), donc
 *     la division en deux porterait sur les doubles. Personne n'écrit « croche = triolet » pour dire
 *     ça, et la notation ne le dit pas non plus.
 * Une mesure de ces familles se joue donc droite, au milieu d'un morceau swingué — exactement ce que
 * ferait un musicien devant la même partition.
 */
export function grilleTernaire(partition) {
    if (!partition?.meta?.ternaire || !partition.mesures?.length) return null;
    const grille = [];
    let debut = 0;
    for (let i = 0; i < partition.mesures.length; i++) {
        const longueur = longueurMesure(partition, i);
        const unite = uniteDeGroupement(signatureEffective(partition, i));
        grille.push({ debut, fin: debut + longueur, unite: unite === 1 ? unite : 0 });
        debut += longueur;
    }
    return grille;
}

/**
 * La case de grille qui contient `position` — la dernière au-delà de la fin du morceau (une note
 * tenue par-dessus la double barre garde la grille de sa mesure, plutôt que de retomber à zéro).
 *
 * LES BORNES DE MESURE SONT DES POINTS FIXES de la transformation (voir positionTernaire : une
 * position à un nombre entier de temps du début de sa mesure ne bouge pas), donc une même position
 * tombe dans la MÊME case qu'on la lise écrite ou sonnée. C'est ce qui permet aux deux sens de
 * partager cette recherche, et aux bornes de boucle, au point d'arrêt final et au découpage en
 * mesures de rester valides sans être convertis.
 */
function caseTernaire(grille, position) {
    for (let i = 0; i < grille.length; i++) if (position < grille[i].fin - 1e-9) return grille[i];
    return grille[grille.length - 1];
}

/** Position SONNÉE d'une position écrite. `grille` nulle (morceau binaire) : rien ne change. */
export function sonneDepuisEcrit(grille, position) {
    if (!grille || !Number.isFinite(position)) return position;
    const c = caseTernaire(grille, position);
    return c.debut + positionTernaire(position - c.debut, c.unite);
}

/**
 * La réciproque : position ÉCRITE d'une position sonnée. C'est elle qui garde la tête de lecture sur
 * la bonne colonne pendant un morceau swingué — sans elle, l'image dériverait du son, ce qui est
 * pire que pas de ternaire du tout.
 */
export function ecritDepuisSonne(grille, position) {
    if (!grille || !Number.isFinite(position)) return position;
    const c = caseTernaire(grille, position);
    return c.debut + positionDepuisTernaire(position - c.debut, c.unite);
}

/** Copie profonde — base de l'historique undo/redo. */
export function cloner(partition) {
    return typeof structuredClone === 'function' ? structuredClone(partition) : JSON.parse(JSON.stringify(partition));
}
