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
