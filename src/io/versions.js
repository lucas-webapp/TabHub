// L'HISTORIQUE DES VERSIONS — une pile datée des états précédents du morceau, dans le navigateur.
//
// POURQUOI. Retour utilisateur, en réponse à la proposition d'un historique : « c'est un peu le
// bazar dans HarmoHub avec les versions entre parenthèses. Je propose de pouvoir les afficher ou non.
// Au moment d'un import, me demander si je veux écraser la version précédente. »
//
// CE QUE FAIT HARMOHUB, ET CE QU'ON EN RETIENT. Là-bas, réimporter une sauvegarde qui contient un
// morceau déjà présent propose d'en garder une COPIE, nommée « Titre (import du 14/09/2025) » — voir
// script.js#importLibraryFile. La copie atterrit dans la bibliothèque, au milieu des morceaux, et
// deux ou trois imports plus tard on ne sait plus lequel est le bon. Le défaut n'est pas de garder
// des versions : c'est de les MÊLER au travail en cours. D'où les trois règles de ce module :
//   1. les versions vivent À PART, dans leur propre liste — jamais dans le nom du morceau ;
//   2. leur nombre est BORNÉ (MAX_VERSIONS), donc l'accumulation a une fin, sans rien à nettoyer ;
//   3. l'historique s'éteint, et s'éteindre VIDE réellement le stockage — un interrupteur qui
//      continuerait d'écrire en cachette mentirait sur ce qu'il fait.
//
// CE N'EST PAS LE BROUILLON, et les deux ne se remplacent pas. Le brouillon (voir
// main.js#_ecrireBrouillon) est UN état, réécrit sans cesse, qui protège d'un rechargement
// accidentel. Une version est un état DÉLIBÉRÉ — un enregistrement, ou le morceau qu'on s'apprête à
// remplacer — qu'on garde pour pouvoir y revenir. L'un protège de l'accident, l'autre du regret.
//
// LE STOCKAGE EST UN CONFORT, PAS UNE GARANTIE, exactement comme le brouillon : quota plein, mode
// privé, stockage refusé — tout échoue en silence et rend `false`. Une tablature perdue serait
// grave ; un historique qu'on n'a pas pu écrire ne doit jamais interrompre la frappe pour l'annoncer.

const CLE_VERSIONS = 'tabhub.versions';

/** Combien d'états on garde. DIX, et le chiffre a une raison : au-delà, la liste demande à être
 *  lue plutôt que parcourue d'un coup d'œil — c'est le reproche même fait à HarmoHub. Et dix états
 *  d'un morceau de quelques dizaines de kilo-octets restent très loin du quota d'un navigateur. */
export const MAX_VERSIONS = 10;

/**
 * Les versions enregistrées, LA PLUS RÉCENTE D'ABORD.
 *
 * Tolérante à tout : une clé absente, un JSON abîmé, un tableau contenant autre chose que des
 * versions — tout cela rend une liste vide plutôt que de lever. C'est la même règle qu'à l'ouverture
 * d'un .json (voir model/score.js#normaliser) : une donnée relue est une donnée suspecte.
 */
export function lireVersions() {
    let brut;
    try { brut = JSON.parse(localStorage.getItem(CLE_VERSIONS) || '[]'); }
    catch (e) { return []; }
    if (!Array.isArray(brut)) return [];
    return brut
        .filter(v => v && typeof v === 'object' && v.partition && typeof v.partition === 'object')
        .map(v => ({
            id: String(v.id || ''),
            date: typeof v.date === 'string' ? v.date : '',
            titre: typeof v.titre === 'string' ? v.titre : '',
            artiste: typeof v.artiste === 'string' ? v.artiste : '',
            mesures: Number.isFinite(v.mesures) ? v.mesures : 0,
            notes: Number.isFinite(v.notes) ? v.notes : 0,
            partition: v.partition,
        }))
        .slice(0, MAX_VERSIONS);
}

/** Écrit la liste, en rognant si le quota refuse. Rend `true` si quelque chose a bien été écrit.
 *
 *  ROGNER PLUTÔT QUE RENONCER : un quota plein est le cas NORMAL d'un historique borné qui vit à
 *  côté d'un brouillon (les deux partagent les 5 Mo du site). Perdre la version la plus ancienne
 *  pour garder la plus récente est le bon compromis — l'inverse de ce que ferait un simple échec. */
function ecrire(liste) {
    let candidate = liste.slice(0, MAX_VERSIONS);
    while (candidate.length > 0) {
        try {
            localStorage.setItem(CLE_VERSIONS, JSON.stringify(candidate));
            return true;
        } catch (e) {
            candidate = candidate.slice(0, candidate.length - 1);
        }
    }
    try { localStorage.removeItem(CLE_VERSIONS); } catch (e) { /* stockage refusé : rien à faire */ }
    return false;
}

/**
 * COMBIEN DE NOTES le morceau contient. Sert à deux choses, d'où un seul parcours :
 *
 *   1. REFUSER D'ARCHIVER UN MORCEAU VIDE (zéro note). Une version est posée avant chaque
 *      remplacement — y compris le premier « Nouveau » d'une session, alors qu'il n'y a encore rien
 *      à garder. Sans ce refus, l'historique s'ouvrirait sur deux lignes « Sans titre » vides :
 *      exactement le désordre qu'on cherche à éviter, une liste où il faut deviner lesquelles
 *      comptent. Le TITRE ne sauve pas un morceau vide — un titre tapé puis abandonné n'est pas du
 *      travail ; ce qui compte, c'est qu'une note ait été écrite.
 *   2. DISTINGUER DEUX VERSIONS DU MÊME MORCEAU dans la liste. Mesuré à l'essai : deux versions
 *      prises à une minute d'écart affichaient « Sans titre · 4 mesures » toutes les deux — donc
 *      impossibles à départager, alors qu'elles n'avaient pas le même contenu. Le nombre de mesures
 *      bouge rarement pendant qu'on travaille ; le nombre de notes, à chaque geste. C'est lui qui
 *      permet de choisir.
 */
function compterNotes(partition) {
    let total = 0;
    for (const m of (Array.isArray(partition.mesures) ? partition.mesures : [])) {
        for (const v of (Array.isArray(m?.voix) ? m.voix : [])) {
            for (const e of (Array.isArray(v?.evenements) ? v.evenements : [])) {
                if (Array.isArray(e?.notes)) total += e.notes.length;
            }
        }
    }
    return total;
}

/** Une signature du CONTENU d'un morceau, méta comprise. Sert à ne pas empiler deux versions
 *  identiques : Ctrl+S est un réflexe, et trois enregistrements de suite sans rien changer entre
 *  deux ne sont pas trois versions — c'est une seule, archivée trois fois. */
function empreinte(partition) {
    try { return JSON.stringify(partition); } catch (e) { return String(Math.random()); }
}

/**
 * Met le morceau de côté comme nouvelle version.
 *
 * @param {object} partition l'état à garder.
 * @param {{ecraserDerniere?: boolean}} options `ecraserDerniere` remplace la version la plus récente
 *   au lieu d'en ajouter une — c'est la réponse à « au moment d'un import, me demander si je veux
 *   écraser la version précédente », et la seule façon d'importer plusieurs fois de suite sans faire
 *   grossir la liste.
 * @returns {boolean} vrai si la version a bien été rangée. `false` aussi quand il n'y avait RIEN à
 *   ranger (contenu identique à la version la plus récente) : l'appelant n'a pas à distinguer, dans
 *   les deux cas la liste n'a pas changé.
 */
export function archiver(partition, { ecraserDerniere = false } = {}) {
    if (!partition || typeof partition !== 'object') return false;
    const notes = compterNotes(partition);
    if (notes === 0) return false;
    const liste = lireVersions();
    const marque = empreinte(partition);
    if (!ecraserDerniere && liste.length > 0 && empreinte(liste[0].partition) === marque) return false;
    const meta = partition.meta || {};
    const entree = {
        id: 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        date: new Date().toISOString(),
        titre: typeof meta.titre === 'string' ? meta.titre : '',
        artiste: typeof meta.artiste === 'string' ? meta.artiste : '',
        mesures: Array.isArray(partition.mesures) ? partition.mesures.length : 0,
        notes,
        // UNE COPIE PROFONDE, et pas la référence : sans elle, la version suivrait les modifications
        // du morceau qu'elle est censée figer — un historique qui change avec le présent n'en est pas
        // un. Le passage par JSON est ici sans perte, le modèle étant déjà exactement ce qu'on écrit
        // dans un .json (voir model/score.js).
        partition: JSON.parse(marque),
    };
    return ecrire(ecraserDerniere ? [entree, ...liste.slice(1)] : [entree, ...liste]);
}

/** Retire une version. Rend vrai si elle existait et que la liste a pu être réécrite. */
export function supprimerVersion(id) {
    const liste = lireVersions();
    const restant = liste.filter(v => v.id !== id);
    if (restant.length === liste.length) return false;
    if (restant.length === 0) return viderVersions();
    return ecrire(restant);
}

/** Efface tout l'historique. Appelé quand on l'éteint : voir la règle 3 du docblock. */
export function viderVersions() {
    try { localStorage.removeItem(CLE_VERSIONS); return true; }
    catch (e) { return false; }
}

/** « il y a 3 min », « hier à 14:05 »… Le libellé d'une version se lit de loin : une date ISO ou un
 *  horodatage complet demanderait de calculer pour savoir si c'est récent. */
export function daterVersion(iso, maintenant = new Date()) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'date inconnue';
    const minutes = Math.floor((maintenant - d) / 60000);
    if (minutes < 1) return 'à l\'instant';
    if (minutes < 60) return `il y a ${minutes} min`;
    const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const jour = new Date(d); jour.setHours(0, 0, 0, 0);
    const aujourdhui = new Date(maintenant); aujourdhui.setHours(0, 0, 0, 0);
    const joursEcoules = Math.round((aujourdhui - jour) / 86400000);
    if (joursEcoules === 0) return `aujourd'hui à ${heure}`;
    if (joursEcoules === 1) return `hier à ${heure}`;
    return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })} à ${heure}`;
}
