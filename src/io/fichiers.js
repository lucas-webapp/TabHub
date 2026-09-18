// NOMMAGE ET RANGEMENT DES FICHIERS — la même règle que HarmoHub, portée ici.
//
// D'OÙ ÇA VIENT. HarmoHub a refondu toute sa gestion des fichiers (neuf lots, voir sa branche de
// travail), et le module qui la porte annonce dès sa première ligne qu'il est « commun à HarmoHub, à
// Paroles et, plus tard, à TabHub » : le nom de l'application y est un PARAMÈTRE, pas une constante
// écrite en dur. Ce fichier est ce « plus tard ». La règle est reprise telle quelle, pas réinventée —
// c'est tout l'intérêt, puisque les deux applications seront servies depuis la même origine et que
// leurs fichiers finiront dans le même dossier de téléchargement.
//
// DEUX ÉTAGES, ET LE BAS PORTE LE HAUT.
//
//   ÉTAGE DU BAS, PARTOUT — le NOMMAGE. Même déversés en vrac dans Téléchargements, des fichiers
//   bien nommés se regroupent et se trient tout seuls. C'est la seule partie qui tienne sur
//   n'importe quel système.
//   ÉTAGE DU HAUT, LÀ OÙ C'EST POSSIBLE — le RANGEMENT dans un dossier désigné (File System Access,
//   voir plus bas). Il se pose PAR-DESSUS et ne remplace jamais le premier : si le dossier est
//   débranché, la permission retirée ou l'API absente, l'export repart en téléchargement. Un export
//   qui ne produit rien serait bien pire qu'un export mal rangé.
//
// LA FORME : « TabHub - Morceau - Type - Date Heure.ext »
//
//     TabHub - Blackbird - Beatles - Morceau - 2026-09-18 1432.json
//     TabHub - Blackbird - Beatles - Partition - 2026-09-18 1432.pdf
//     TabHub - Blackbird - Beatles - MIDI - 2026-09-18 1432.mid
//
// L'ordre n'est pas arbitraire, et c'est celui de HarmoHub. L'APPLI en tête pour que les deux ne se
// mélangent jamais dans un même dossier. Le MORCEAU ensuite, parce que c'est par morceau qu'on se
// perd — toutes ses pièces se retrouvent côte à côte dans n'importe quel explorateur trié par nom.
// Le TYPE après, la DATE en dernier : les versions d'un même document s'empilent alors dans l'ordre
// chronologique.
//
// L'HEURE N'EST PAS DÉCORATIVE. Avec la seule date, deux exports le même jour donnent « (1) », « (2) »
// ajoutés par le navigateur — précisément ce qui fait perdre le fil des versions. Les deux-points
// étant interdits sous Windows, l'heure s'écrit « 1432 » et non « 14:32 ».
//
// CE QUE CE MODULE REMPLACE. `nomDeFichierSur` et `nomDuMorceau` vivaient dans io/json.js et
// assemblaient « Titre - Artiste.ext ». Ils sont VENUS ICI, inchangés, et io/json.js les réexporte
// pour ne casser aucun chemin d'import. Le déménagement n'est pas cosmétique : `fichiers.js` a besoin
// d'eux, et json.js aurait eu besoin de `nomPour` — deux modules qui s'importent en tête l'un l'autre
// laissent l'un des deux à moitié construit au premier appel. Le nommage vit donc entièrement ici, et
// json.js redevient ce qu'il dit être : lire et écrire un .json.

const NOM_APPLI = 'TabHub';

/**
 * Nom de fichier sûr.
 *
 * DEUX PROBLÈMES, PAS UN. Les caractères interdits par les systèmes de fichiers (\ / : * ? " < > |)
 * étaient déjà remplacés. Le second a été trouvé en éprouvant l'aperçu PDF sur « Étude en la
 * mineur » : le fichier arrivait nommé « download ». Mesuré caractère par caractère — « Etude » passe,
 * « Étude » non, « Café » non, « aéb » non : c'est TOUT caractère non-ASCII qui fait retomber le
 * navigateur sur son nom par défaut quand on le pose dans l'attribut `download` d'un lien. Un défaut
 * PRÉEXISTANT, et sur les trois exports à la fois (.json, .pdf, .mid), qu'aucun banc n'avait vu parce
 * que leurs titres témoins étaient sans accent — alors qu'une application francophone de partitions
 * en rencontre à longueur de temps (Étude, Prélude, Gymnopédie, Bourrée…).
 *
 * D'où le repli en ASCII : « Étude » donne « Etude », pas « download ». C'est une perte cosmétique
 * assumée, et le compromis penche franchement du bon côté — un accent en moins reste un nom qu'on
 * reconnaît, « download.pdf » n'en est pas un. Au passage, c'est aussi ce qui rend le fichier
 * transportable entre systèmes, où l'accent se dénormalise (macOS écrit « e » + accent combinant là
 * où Linux écrit « é » : deux octets différents pour un même nom à l'œil).
 *
 * COMMENT. `normalize('NFD')` sépare chaque lettre accentuée en lettre + marque combinante, et
 * `\p{M}` retire les marques — ce qui traite d'un coup tous les accents latins, cédille comprise,
 * sans table à tenir. Les ligatures (œ, æ) ne se décomposent pas : elles sont épelées avant. Ce qui
 * reste hors ASCII imprimable (cyrillique, japonais…) disparaît, et le repli « tablature » rattrape
 * le cas où il ne resterait plus rien.
 */
export function nomDeFichierSur(nom, extension) {
    const base = String(nom || 'tablature')
        .replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/æ/g, 'ae').replace(/Æ/g, 'AE')
        .normalize('NFD').replace(/\p{M}+/gu, '')
        .replace(/[^\x20-\x7E]+/g, '')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .trim().slice(0, 90).trim() || 'tablature';
    return `${base}${extension}`;
}

/**
 * NOM LISIBLE DU MORCEAU pour un fichier téléchargé : « Titre - Artiste » (retour utilisateur :
 * « lorsque je télécharge le JSON, je veux avoir le nom de l'artiste également. Nom du fichier =
 * Titre - Nom artiste.json », puis « tu peux effectivement modifier les noms de TOUS les fichiers
 * exportés avec Titre - Artiste »). Un dossier de relevés où tout s'appelle « Sans titre.json » ou
 * « Blackbird.json » sans savoir de qui ne se trie pas.
 *
 * LE SEUL ENDROIT QUI DÉCIDE D'UN NOM DE FICHIER, pour les quatre exports — .json ici, .pdf (voir
 * io/pdf.js), .mid et le .mid par section (voir io/midi.js). Il vit dans json.js et non dans un
 * module à part parce que c'est déjà là que vit `nomDeFichierSur`, son inséparable : l'un assemble,
 * l'autre assainit. Trois interpolations à la main les avaient fait diverger une première fois — le
 * JSON portait l'artiste, le PDF et le MIDI le titre seul.
 *
 * LES DEUX MOITIÉS SONT FACULTATIVES, et c'est tout l'intérêt de passer par ici plutôt que
 * d'interpoler à la main : un morceau sans artiste ne doit pas produire « Blackbird - .json » (un
 * tiret orphelin, et un nom qui a l'air tronqué), et un artiste sans titre vaut mieux que rien du
 * tout. On assemble donc ce qui existe, et `nomDeFichierSur` retombe sur « tablature » si les deux
 * manquent.
 */
export function nomDuMorceau(meta = {}) {
    return [meta.titre, meta.artiste].map(x => String(x || '').trim()).filter(Boolean).join(' - ');
}


/**
 * Types de document, tels qu'ils paraissent dans le nom. Une table plutôt que des chaînes semées
 * dans le code : c'est ce segment qui range les versions d'un même document ensemble, et une faute
 * de frappe y crée un second document sans que rien ne le dise.
 */
export const TYPES = {
    morceau: 'Morceau',       // le .json — le modèle tel quel, ce qu'on rouvre dans TabHub
    partition: 'Partition',   // le .pdf gravé
    midi: 'MIDI',
    musicxml: 'MusicXML',
};

/**
 * Assainissement du nom.
 *
 * DEUX RÈGLES SE SUPERPOSENT ICI, ET AUCUNE NE PEUT PARTIR.
 *
 * CELLE DE HARMOHUB, portée : caractères interdits par Windows remplacés, caractères de CONTRÔLE
 * retirés, espaces multiples réduits, longueur bornée, et surtout les POINTS ET ESPACES EN FIN DE NOM
 * supprimés — Windows les efface silencieusement à la création, si bien qu'un fichier ne porte pas le
 * nom qu'on croit lui avoir donné. macOS et Linux sont plus permissifs, mais un fichier doit pouvoir
 * voyager d'une machine à l'autre : on s'aligne sur le plus strict des trois.
 *
 * CELLE DE TABHUB, conservée : le repli en ASCII. HarmoHub ne l'a pas, et ce n'est pas un oubli de ma
 * part de le garder — il vient d'une mesure faite ici, caractère par caractère : un nom non-ASCII posé
 * dans l'attribut `download` d'un lien fait retomber le navigateur sur son nom par défaut, et le
 * fichier arrive appelé « download ». « Etude » passe, « Étude » non, « Café » non. Dans une
 * application francophone de partitions (Étude, Prélude, Gymnopédie, Bourrée…) le cas est
 * quotidien. « Étude » donne donc « Etude » : une perte cosmétique assumée, un nom qu'on reconnaît
 * encore, au lieu de « download.pdf » qui n'en est pas un. C'est `nomDeFichierSur` (voir json.js)
 * qui porte ce repli, et ce module l'appelle plutôt que de le recopier.
 */
export function nettoyerSegment(nom, longueurMax = 60) {
    // `nomDeFichierSur` fait le repli ASCII et remplace les caractères interdits ; on lui passe une
    // extension vide et on reprend la main pour ce qu'il ne fait pas.
    let propre = nomDeFichierSur(nom, '')
        .replace(/[\x00-\x1f\x7f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (propre.length > longueurMax) propre = propre.slice(0, longueurMax).trim();
    propre = propre.replace(/[. ]+$/, '');
    // UN SEUL REPLI, et c'est celui de TabHub : « tablature ». HarmoHub dit « Sans titre ». Garder
    // les deux aurait donné deux réponses à la même question selon le chemin pris — `nomDeFichierSur`
    // pose déjà le sien juste au-dessus, et un `|| 'Sans titre'` ici n'aurait jamais été atteint
    // qu'en apparence. Trouvé au banc, qui lisait « tablature » là où la ligne annonçait autre chose.
    return propre;
}

/**
 * « 2026-09-18 1432 » — se trie correctement par ordre alphabétique, ce que ne permet aucun format
 * local (18/09/2026 se classerait avant 03/12/2025).
 */
export function horodatage(date = new Date()) {
    const deux = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())} `
        + `${deux(date.getHours())}${deux(date.getMinutes())}`;
}

/**
 * Le nom complet, horodaté — celui des fichiers TÉLÉCHARGÉS. `morceau` absent = document qui ne
 * concerne pas un morceau précis, et le segment saute plutôt que d'afficher un vide.
 */
export function nomExport({ morceau, type, extension, date, appli } = {}) {
    const bouts = [appli || NOM_APPLI];
    if (morceau) bouts.push(nettoyerSegment(morceau));
    if (type) bouts.push(nettoyerSegment(type, 20));
    bouts.push(horodatage(date instanceof Date ? date : new Date()));
    return `${bouts.join(' - ')}.${String(extension || 'dat').replace(/^\./, '')}`;
}

/**
 * Le nom STABLE d'un document — « TabHub - Blackbird - Beatles - Morceau.json ». Sans horodatage :
 * c'est le même nom, toujours, pour un morceau donné. Il sert au RANGEMENT dans un dossier (voir le
 * lot suivant), où l'ancien fichier est poussé dans `_versions/` au lieu d'être laissé à côté du
 * nouveau. Le téléchargement, lui, garde l'horodatage : dans Téléchargements il n'y a ni rotation ni
 * dossier de versions, et deux fichiers de même nom y deviennent « (1) », « (2) ».
 */
export function nomCanonique({ morceau, type, extension, appli } = {}) {
    const bouts = [appli || NOM_APPLI];
    if (morceau) bouts.push(nettoyerSegment(morceau));
    if (type) bouts.push(nettoyerSegment(type, 20));
    return `${bouts.join(' - ')}.${String(extension || 'dat').replace(/^\./, '')}`;
}

/** Le nom du morceau tel qu'il paraît dans un nom de fichier — « Titre - Artiste ». */
export function morceauDe(partition) {
    return nomDuMorceau(partition?.meta || {});
}

/**
 * Raccourci des cinq routes d'export : le nom horodaté d'un document de CETTE partition.
 * Un seul appel par route, au lieu d'une interpolation par route.
 */
export function nomPour(partition, cle, extension, extra = null) {
    // LE SEGMENT DU MORCEAU EXISTE TOUJOURS ICI, même sans titre ni artiste : `nomExport` le saute
    // quand il est vide (c'est la règle de HarmoHub, juste pour la bibliothèque, qui n'appartient à
    // aucun morceau), mais un morceau sans titre EST un morceau — le sauter donnerait « TabHub -
    // Morceau - date.json », où plus rien ne dit qu'il s'agit d'une tablature en cours. Le repli
    // « tablature » de TabHub reprend donc sa place.
    const morceau = [morceauDe(partition) || 'tablature', extra].filter(Boolean).join(' - ');
    return nomExport({ morceau, type: TYPES[cle] || cle, extension });
}

/**
 * Retrouve le nom du morceau À PARTIR DU NOM DE FICHIER — « TabHub - Blackbird - Beatles - Morceau.json »
 * donne « Blackbird - Beatles ». C'est le nom de FICHIER qui détermine quels fichiers vont ensemble
 * sur le disque, pas ce que contient le .json : un fichier renommé à la main, ou dont le titre interne
 * a divergé, doit quand même se regrouper avec ses PDF et ses MIDI, qui n'ont aucun contenu
 * interrogeable.
 *
 * LE DERNIER SEGMENT EST LE TYPE, tout ce qui précède est le nom — et c'est ce qui permet à un nom de
 * morceau de contenir lui-même « - », ce qui est le cas courant ici puisque TabHub nomme ses morceaux
 * « Titre - Artiste ».
 */
export function morceauDepuisNomFichier(nomFichier, appli) {
    const tete = `${appli || NOM_APPLI} - `;
    if (!String(nomFichier).startsWith(tete)) return null;
    let reste = String(nomFichier).slice(tete.length).replace(/\.[^.]+$/, '');
    // L'horodatage final, s'il y en a un : « … - Morceau - 2026-09-18 1432 ».
    reste = reste.replace(/ - \d{4}-\d{2}-\d{2} \d{4,6}$/, '');
    const i = reste.lastIndexOf(' - ');
    return (i > 0 ? reste.slice(0, i) : reste) || null;
}

/** Le préfixe commun à tous les fichiers d'un morceau. */
export function prefixeMorceau(nom, appli) {
    return `${appli || NOM_APPLI} - ${nettoyerSegment(nom)} - `;
}

/**
 * Ce fichier appartient-il à CE morceau ? Le piège n'est pas théorique : les fichiers d'« Étude » et
 * ceux d'« Étude - live » commencent par la même chaîne. Un fichier qui appartient AUSSI à un autre
 * morceau, plus spécifique, n'est jamais retenu pour celui-ci.
 */
export function estFichierDuMorceau(nomFichier, prefixe, prefixesAutres = []) {
    if (!String(nomFichier).startsWith(prefixe)) return false;
    return !prefixesAutres.some(p => p.length > prefixe.length && String(nomFichier).startsWith(p));
}

// =====================================================================================
// COUCHE RANGEMENT — écrire dans un dossier choisi plutôt que dans Téléchargements.
// =====================================================================================
//
// LE BESOIN, tel qu'il a été exprimé côté HarmoHub : « les exports se font directement dans les
// téléchargements, puis je dois les ranger correctement moi-même. Je me perds rapidement dans les
// versions. » Le nommage ci-dessus règle le « je m'y perds » ; il reste le « je dois les ranger
// moi-même ».
//
// CE QUI EST POSSIBLE, ET CE QUI NE L'EST PAS. Aucun site web ne peut écrire où il veut sur un
// disque — ce serait une faille béante. La seule porte est File System Access : l'utilisateur DÉSIGNE
// un dossier une fois, et le navigateur nous y laisse écrire. Cette porte n'existe que sur Chrome et
// Edge en version bureau : ni Safari (Mac ET iPhone), ni Firefox, ni Chrome Android ne l'ont.
// D'où les deux étages, et le second ne remplace JAMAIS le premier : si quoi que ce soit échoue —
// dossier débranché, permission refusée, clé USB retirée — on RETOMBE sur le téléchargement au lieu
// de perdre le fichier. Un export qui ne produit rien serait bien pire qu'un export mal rangé.
//
// LA RACINE EST LE DOSSIER DE L'APPLI, pas un parent : « deux dossiers frères plutôt, je ne vais pas
// les utiliser pour les mêmes musiques ». TabHub et HarmoHub gardent donc chacun leur propre racine,
// d'où la clé par nom d'appli.
//
// L'ARBORESCENCE EST À PLAT PAR TYPE. Quatre dossiers, et c'est la première adaptation à TabHub : là
// où HarmoHub en a huit (Bibliotheque, Morceaux, PDF/Accords, PDF/Paroles, MIDI, Audio, Texte),
// TabHub n'a ni bibliothèque de morceaux, ni paroles, ni export audio. Créer les dossiers d'un
// classement qu'on ne remplira jamais serait exactement ce que HarmoHub a fini par retirer chez lui
// (« PDF/Structure était créé et ne se remplirait jamais. Retiré. ») : un dossier vide est une
// invitation à y chercher quelque chose qui n'y sera pas.
//
// LE LIEN ENTRE LES PIÈCES D'UN MÊME MORCEAU est porté par le NOM, pas par l'emplacement — et le nom
// voyage partout, y compris sur les téléphones qui n'ont pas cette couche.
export const DOSSIERS = {
    morceaux: ['Morceaux'],       // les .json — ce qu'on rouvre dans TabHub
    pdf: ['PDF'],                 // la partition gravée
    midi: ['MIDI'],
    musicxml: ['MusicXML'],       // l'échange vers MuseScore, Finale, Sibelius
};

/** Chemin affichable. Le navigateur ne donne JAMAIS le chemin absolu du dossier choisi (seulement
 *  son nom) : inutile d'essayer d'afficher « C:\… » — on montre ce qu'on connaît. */
export function cheminDossier(cle) {
    return (DOSSIERS[cle] || [String(cle)]).join('/');
}

export function rangementDisponible() {
    return typeof globalThis !== 'undefined' && typeof globalThis.showDirectoryPicker === 'function';
}

// ---------- Mémoire de la racine ----------
// Une poignée de dossier n'est pas du texte : localStorage ne peut pas la garder. IndexedDB, si —
// c'est le seul magasin du navigateur qui sache sérialiser un FileSystemHandle. Sans cela il faudrait
// redésigner le dossier à chaque session, ce qui viderait la fonctionnalité de son sens.
// ATTENTION : la poignée survit, mais PAS la permission. Chrome la redemande à chaque session, et
// seulement pendant un geste de l'utilisateur (voir preparerRangement).
//
// LES MÊMES NOMS DE BASE QUE HARMOHUB, et c'est voulu : les deux applications seront servies depuis
// la même origine, donc depuis la même IndexedDB. Une base par appli marcherait aussi (les clés sont
// déjà séparées par appli), mais le jour où TabHub sera servi à côté de HarmoHub et chargera LE
// module commun, un nom différent ferait silencieusement oublier le dossier déjà désigné.
const BDD = 'harmohub_fichiers';
const BDD_STORE = 'racines';
const CLE_NOM_RACINE = 'harmohub_dossier_rangement';

function ouvrirBdd() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB indisponible'));
        const req = indexedDB.open(BDD, 1);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(BDD_STORE)) req.result.createObjectStore(BDD_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function transaction(mode, action) {
    return ouvrirBdd().then((bdd) => new Promise((resolve, reject) => {
        const tx = bdd.transaction(BDD_STORE, mode);
        const req = action(tx.objectStore(BDD_STORE));
        tx.oncomplete = () => { bdd.close(); resolve(req && req.result); };
        tx.onerror = () => { bdd.close(); reject(tx.error); };
    }));
}

const cleRacine = (appli) => `racine:${appli || NOM_APPLI}`;

/**
 * Le NOM du dossier est doublé dans localStorage. Pas par redondance : lire IndexedDB demande un
 * `await`, or un panneau de réglages se construit d'un trait, sans attente. Sans ce doublon, il ne
 * pourrait pas dire quel dossier est configuré au moment où il s'affiche. Le nom seul ne donne aucun
 * accès — la poignée, elle, reste dans IndexedDB.
 */
export function nomRacineAffiche(appli) {
    try { return localStorage.getItem(`${CLE_NOM_RACINE}:${appli || NOM_APPLI}`) || ''; } catch (e) { return ''; }
}
function retenirNomRacine(nom, appli) {
    try {
        const cle = `${CLE_NOM_RACINE}:${appli || NOM_APPLI}`;
        if (nom) localStorage.setItem(cle, nom); else localStorage.removeItem(cle);
    } catch (e) { /* mode privé saturé : le rangement marche quand même, seul l'affichage du nom se tait */ }
}

async function lireRacineMemorisee(appli) {
    try { return (await transaction('readonly', (s) => s.get(cleRacine(appli)))) || null; }
    catch (e) { console.error('Lecture du dossier mémorisé impossible :', e); return null; }
}

export async function oublierRacine(appli) {
    retenirNomRacine('', appli);
    try { await transaction('readwrite', (s) => s.delete(cleRacine(appli))); return true; }
    catch (e) { console.error('Oubli du dossier impossible :', e); return false; }
}

/** `demander` n'est vrai que dans un geste de l'utilisateur : hors geste, Chrome REFUSE la demande au
 *  lieu de l'afficher, et on aurait brûlé notre unique occasion de la poser. */
async function permissionEcriture(handle, demander) {
    if (!handle) return false;
    if (typeof handle.queryPermission !== 'function') return true;   // OPFS, ou doublure de banc
    const options = { mode: 'readwrite' };
    try {
        if ((await handle.queryPermission(options)) === 'granted') return true;
        if (!demander || typeof handle.requestPermission !== 'function') return false;
        return (await handle.requestPermission(options)) === 'granted';
    } catch (e) { console.error('Vérification de la permission impossible :', e); return false; }
}

/**
 * La racine utilisable, ou `null`. À APPELER EN PREMIER dans chaque export, tant que le clic est
 * encore « chaud » : le rendu d'un PDF de partition passe plusieurs secondes dans jsPDF et Bravura,
 * après quoi le navigateur considère le geste expiré et n'affiche plus aucune demande de permission.
 * On retomberait alors en silence dans Téléchargements alors qu'un dossier est configuré.
 */
export async function preparerRangement({ demander = true, appli } = {}) {
    if (!rangementDisponible()) return null;
    const racine = await lireRacineMemorisee(appli);
    if (!racine) return null;
    if (!(await permissionEcriture(racine, demander))) return null;
    return racine;
}

/** Ouvre le sélecteur de dossier. DOIT être appelé directement depuis un gestionnaire de clic : tout
 *  `await` placé avant consomme le geste et le navigateur rejette l'ouverture. */
export async function choisirDossier(appli) {
    if (!rangementDisponible()) return null;
    let racine;
    try {
        racine = await globalThis.showDirectoryPicker({ id: `racine-${appli || NOM_APPLI}`, mode: 'readwrite', startIn: 'documents' });
    } catch (e) {
        if (e && e.name === 'AbortError') return null;   // sélecteur fermé : ce n'est pas une panne
        console.error('Choix du dossier impossible :', e);
        return null;
    }
    if (!(await permissionEcriture(racine, true))) return null;
    // L'ARBORESCENCE EST CRÉÉE TOUT DE SUITE, au lieu d'attendre le premier export de chaque type. Un
    // dossier vide n'inspire pas confiance : voir les quatre sous-dossiers apparaître dit ce que
    // l'appli va faire, et laisse y déposer des fichiers à la main dès maintenant.
    try { for (const cle of Object.keys(DOSSIERS)) await sousDossier(racine, cle, true); }
    catch (e) { console.error('Création de l\'arborescence incomplète :', e); }
    try { await transaction('readwrite', (s) => s.put(racine, cleRacine(appli))); }
    catch (e) { console.error('Mémorisation du dossier impossible :', e); }
    retenirNomRacine(racine.name || '', appli);
    return racine;
}

async function sousDossier(racine, cle, creer) {
    let courant = racine;
    for (const nom of (DOSSIERS[cle] || [String(cle)])) {
        courant = await courant.getDirectoryHandle(nom, { create: !!creer });
    }
    return courant;
}

async function ecrireDansRacine(racine, cle, nomFichier, blob) {
    const dossier = await sousDossier(racine, cle, true);
    const fichier = await dossier.getFileHandle(nomFichier, { create: true });
    const flux = await fichier.createWritable();
    try { await flux.write(blob); } finally { await flux.close(); }
    return fichier;
}

/**
 * Les fichiers réellement présents dans un sous-dossier, du plus récent au plus ancien. Lit le
 * DISQUE, et rien d'autre : c'est lui qui fait foi, puisque l'utilisateur peut déplacer ou effacer un
 * fichier à la main sans que l'appli en sache rien. HarmoHub a d'abord écrit un `_index.json` à
 * chaque export pour tenir cette comptabilité, puis l'a retiré — RIEN NE LE LISAIT, et une
 * comptabilité parallèle qui peut diverger de la réalité est un passif : le jour où elle ment, elle
 * ment avec assurance.
 */
export async function listerDossier(cle, { appli } = {}) {
    const racine = await preparerRangement({ demander: false, appli });
    if (!racine) return [];
    try {
        const dossier = await sousDossier(racine, cle, false);
        const noms = [];
        for await (const [nom, handle] of dossier.entries()) {
            if (handle.kind === 'file') noms.push(nom);
        }
        // Les noms portent « aaaa-mm-jj hhmm » : le tri alphabétique décroissant EST le tri
        // chronologique inverse. Pas besoin de lire les dates du système.
        return noms.sort().reverse();
    } catch (e) { return []; }
}

/**
 * LE POINT DE PASSAGE UNIQUE de tout export. Range dans le dossier si possible, retombe sur le
 * téléchargement sinon, et rend de quoi dire à l'utilisateur OÙ le fichier a atterri.
 *
 * `racine` peut être fournie par l'appelant qui l'a déjà préparée pendant le geste (voir
 * preparerRangement) ; `undefined` = on s'en charge, `null` explicite = « j'ai déjà regardé, il n'y
 * a pas de dossier », et on ne redemande pas.
 */
export async function enregistrerFichier(contenu, { morceau, type, extension, dossier, nom, date, appli, racine, typeMime } = {}) {
    const blob = contenu instanceof Blob ? contenu : new Blob([contenu], { type: typeMime || 'application/octet-stream' });
    const nomFichier = nom || nomExport({ morceau, type, extension, date, appli });
    const cle = dossier || 'morceaux';
    let cible = racine;
    if (cible === undefined) cible = await preparerRangement({ demander: true, appli });
    if (cible) {
        try {
            await ecrireDansRacine(cible, cle, nomFichier, blob);
            return { range: true, nom: nomFichier, dossier: cheminDossier(cle),
                     chemin: `${cheminDossier(cle)}/${nomFichier}`, racine: cible.name || '' };
        } catch (e) {
            // Dossier débranché, disque plein, permission retirée en cours de route : on ne perd pas
            // le fichier pour autant.
            console.error('Rangement impossible, repli sur le téléchargement :', e);
        }
    }
    telechargerBlob(blob, nomFichier);
    return { range: false, nom: nomFichier, dossier: null, chemin: null, racine: '' };
}

/** Le téléchargement classique — le repli, et l'unique chemin sur Safari, Firefox et les téléphones. */
function telechargerBlob(blob, nomFichier) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomFichier;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Le message à afficher après un export. UN SEUL ENDROIT, parce qu'une destination annoncée à tort
 * est exactement ce qui fait perdre un fichier : « Exporté → Téléchargements » écrit en dur dans
 * chaque route deviendrait faux dès qu'un dossier est configuré.
 */
export function messageEnregistrement(resultat, quoi) {
    if (!resultat) return quoi;
    return resultat.range
        ? `${quoi} → ${resultat.racine ? resultat.racine + '/' : ''}${resultat.dossier}`
        : `${quoi} → dossier Téléchargements`;
}

// =====================================================================================
// GARDE-FOUS — lire le disque avant de l'écraser.
// =====================================================================================
//
// LE DÉFAUT QU'ILS RÉPARENT, et il faut le nommer précisément parce qu'il ne ressemble pas à un
// défaut. Jusqu'ici rien n'écrasait jamais rien : chaque export porte son horodatage, donc chaque
// export crée un fichier de plus. C'est une sûreté PAR ACCUMULATION — et le prix en est que rien
// n'est jamais REMPLACÉ. Dix exports d'« Étude » donnent dix fichiers sans qu'aucun soit LE fichier
// d'Étude. C'est exactement le « je me perds rapidement dans les versions » qui a lancé tout ce
// chantier côté HarmoHub.
//
// D'OÙ DEUX NOMS POUR UN MÊME DOCUMENT :
//   - dans le DOSSIER choisi, le nom CANONIQUE, stable : « TabHub - Étude - Dyens - Morceau.json ».
//     Toujours le même, donc toujours à la même place, et l'ancien contenu part dans `_versions/`.
//   - en TÉLÉCHARGEMENT, le nom horodaté : dans Téléchargements il n'y a ni rotation ni dossier de
//     versions, et deux fichiers de même nom y deviennent « (1) », « (2) ».
//
// ET LE GARDE-FOU PROPREMENT DIT : avant d'écrire, on LIT le fichier en place. S'il est plus récent
// que la version ouverte ici, ou s'il appartient à un autre morceau portant le même nom, on n'écrit
// RIEN et on rend de quoi poser la question à l'utilisateur.
const DOSSIER_VERSIONS = '_versions';
const VERSIONS_GARDEES = 10;

/**
 * LES ARCHIVES SE DATENT À LA SECONDE, pas à la minute comme les noms d'export.
 *
 * Défaut trouvé par le banc de HarmoHub, et il vaut la peine d'être gardé écrit : à la minute,
 * quatre enregistrements rapprochés ne laissaient qu'UNE archive — les quatre portaient le même nom
 * et s'écrasaient l'une l'autre. Le filet de sécurité se vidait tout seul, en silence, exactement
 * dans le cas où l'on en a le plus besoin : des essais successifs en quelques minutes. Deux Ctrl+S
 * d'affilée suffisaient.
 */
function horodatageVersion(date = new Date()) {
    const deux = (n) => String(n).padStart(2, '0');
    return `${horodatage(date)}${deux(date.getSeconds())}`;
}

const separeNom = (nomFichier) => {
    const i = nomFichier.lastIndexOf('.');
    return i > 0 ? { base: nomFichier.slice(0, i), ext: nomFichier.slice(i) } : { base: nomFichier, ext: '' };
};

/** Le fichier en place, recopié dans `_versions/` sous SA date de dernière écriture — pas sous
 *  maintenant. Une archive doit dire quand elle a été faite, sinon les dix portent toutes l'heure du
 *  jour où l'on a archivé et ne servent plus à se repérer. */
async function archiverVersion(racine, cle, nomFichier) {
    let dossier, existant;
    try {
        dossier = await sousDossier(racine, cle, false);
        existant = await dossier.getFileHandle(nomFichier, { create: false });
    } catch (e) { return null; }   // rien à archiver : premier enregistrement
    const fichier = await existant.getFile();
    const { base, ext } = separeNom(nomFichier);
    const archives = await dossier.getDirectoryHandle(DOSSIER_VERSIONS, { create: true });
    const nomArchive = `${base} - ${horodatageVersion(new Date(fichier.lastModified))}${ext}`;
    const cible = await archives.getFileHandle(nomArchive, { create: true });
    const flux = await cible.createWritable();
    try { await flux.write(await fichier.arrayBuffer()); } finally { await flux.close(); }
    return nomArchive;
}

/** Ne garde que les `nbGardees` archives les plus récentes d'un document. */
async function purgerVersions(racine, cle, nomFichier, nbGardees = VERSIONS_GARDEES) {
    const { base } = separeNom(nomFichier);
    let archives;
    try {
        const dossier = await sousDossier(racine, cle, false);
        archives = await dossier.getDirectoryHandle(DOSSIER_VERSIONS, { create: false });
    } catch (e) { return 0; }
    const noms = [];
    for await (const [nom, h] of archives.entries()) {
        if (h.kind === 'file' && nom.startsWith(base + ' - ')) noms.push(nom);
    }
    // Le nom porte « aaaa-mm-jj hhmmss » : le tri alphabétique EST le tri chronologique.
    noms.sort().reverse();
    let retires = 0;
    for (const nom of noms.slice(nbGardees)) {
        try { await archives.removeEntry(nom); retires++; } catch (e) { /* déjà parti */ }
    }
    return retires;
}

/** Les archives d'un document, la plus récente d'abord. */
export async function listerVersions(racine, cle, nomFichier) {
    const { base } = separeNom(nomFichier);
    try {
        const dossier = await sousDossier(racine, cle, false);
        const archives = await dossier.getDirectoryHandle(DOSSIER_VERSIONS, { create: false });
        const noms = [];
        for await (const [nom, h] of archives.entries()) {
            if (h.kind === 'file' && nom.startsWith(base + ' - ')) noms.push(nom);
        }
        return noms.sort().reverse();
    } catch (e) { return []; }
}

/**
 * L'état du fichier en place pour CE morceau. Quatre réponses, et la quatrième est celle qui compte :
 *
 *   absent    — rien sur le disque, on écrit sans rien demander ;
 *   aJour     — le même document, et le disque n'est pas plus récent : on écrit ;
 *   enAvance  — le MÊME document, mais le fichier est PLUS RÉCENT que ce qui est ouvert ici. Deux
 *               onglets, deux machines, ou simplement une version qu'on a oubliée : écraser
 *               perdrait un travail qu'on n'a jamais vu ;
 *   autre     — un AUTRE document au même nom. Deux morceaux différents peuvent porter le même titre
 *               et le même artiste ; c'est leur date de CRÉATION qui les distingue, et elle voyage
 *               dans le fichier depuis le premier jour (`meta.creeLe`).
 */
export async function etatFichierSurDisque(racine, partition, cle = 'morceaux') {
    const nomFichier = nomCanonique({ morceau: morceauDe(partition) || 'tablature',
                                      type: TYPES.morceau, extension: 'json' });
    if (!racine) return { etat: 'absent', nomFichier };
    let fichier;
    try {
        const dossier = await sousDossier(racine, cle, false);
        fichier = await (await dossier.getFileHandle(nomFichier, { create: false })).getFile();
    } catch (e) { return { etat: 'absent', nomFichier }; }
    let disque = null;
    try { disque = JSON.parse(await fichier.text()); } catch (e) { /* illisible : traité comme un autre document */ }
    const metaDisque = disque?.meta || {};
    const meta = partition?.meta || {};
    if (!disque || (metaDisque.creeLe && meta.creeLe && metaDisque.creeLe !== meta.creeLe)) {
        return { etat: 'autre', nomFichier, disque: metaDisque, quand: fichier.lastModified };
    }
    const surDisque = Date.parse(metaDisque.modifieLe || '') || fichier.lastModified;
    const ici = Date.parse(meta.modifieLe || '') || 0;
    // UNE SECONDE DE TOLÉRANCE : `modifieLe` est posé à l'écriture et le système de fichiers arrondit
    // sa propre date. Sans cette marge, un fichier qu'on vient d'écrire se déclare « plus récent que
    // lui-même » au tout premier enregistrement suivant.
    if (surDisque > ici + 1000) return { etat: 'enAvance', nomFichier, disque: metaDisque, quand: surDisque };
    return { etat: 'aJour', nomFichier, disque: metaDisque, quand: surDisque };
}

/**
 * Écrit le morceau dans le dossier, garde-fou compris. Rend `{conflit}` SANS RIEN ÉCRIRE quand le
 * fichier en place demande une décision — c'est l'appelant qui pose la question, parce que lui seul
 * sait poser une fenêtre.
 */
export async function ecrireMorceau(partition, { racine, forcer = false, cle = 'morceaux' } = {}) {
    if (!racine) return { range: false, ignore: true };
    const etat = await etatFichierSurDisque(racine, partition, cle);
    if (!forcer && (etat.etat === 'enAvance' || etat.etat === 'autre')) {
        return { range: false, conflit: etat.etat, etat };
    }
    const contenu = JSON.stringify({ ...partition, meta: { ...partition.meta, modifieLe: new Date().toISOString() } }, null, 2);
    // L'ANCIEN EST MIS DE CÔTÉ AVANT D'ÉCRIRE LE NOUVEAU : si l'écriture échoue à mi-chemin, la copie
    // d'archive existe déjà et rien n'est perdu. L'ordre inverse laisserait une fenêtre où ni l'ancien
    // ni le nouveau ne seraient complets.
    let archive = null;
    try { archive = await archiverVersion(racine, cle, etat.nomFichier); }
    catch (e) { console.error('Version précédente non archivée :', e); }
    await ecrireDansRacine(racine, cle, etat.nomFichier, new Blob([contenu], { type: 'application/json' }));
    try { await purgerVersions(racine, cle, etat.nomFichier); }
    catch (e) { console.error('Purge des versions impossible :', e); }
    return { range: true, nom: etat.nomFichier, dossier: cheminDossier(cle),
             chemin: `${cheminDossier(cle)}/${etat.nomFichier}`, racine: racine.name || '', archive };
}

/** Relit le morceau tel qu'il est sur le disque — pour « recharger depuis le disque ». */
export async function lireMorceauSurDisque(racine, nomFichier, cle = 'morceaux') {
    const dossier = await sousDossier(racine, cle, false);
    const fichier = await (await dossier.getFileHandle(nomFichier, { create: false })).getFile();
    return JSON.parse(await fichier.text());
}
