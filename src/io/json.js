// Sauvegarde et ouverture de fichiers .json.
//
// LE FICHIER EST LE MODÈLE, tel quel. Pas de format d'échange intermédiaire, pas de conversion : ce
// qu'on écrit est la structure décrite dans model/score.js, indentée pour rester lisible et
// modifiable à la main. Un utilisateur qui ouvre son .json dans un éditeur de texte doit reconnaître
// sa partition — c'est ce qui rend le format durable, et ce qui permet de diagnostiquer un fichier
// abîmé sans outil.

import { normaliser } from '../model/score.js';

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
 * Déclenche le téléchargement d'un contenu. Un lien `download` synthétique plutôt qu'une nouvelle
 * fenêtre : le navigateur enchaîne directement sur « Enregistrer sous », sans onglet intermédiaire
 * ni fenêtre surgissante à autoriser.
 */
export function telecharger(contenu, nomFichier, typeMime) {
    const blob = contenu instanceof Blob ? contenu : new Blob([contenu], { type: typeMime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomFichier;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Libéré au tour suivant : révoquer immédiatement annulerait le téléchargement sur certains
    // navigateurs, qui n'ont pas encore lu l'URL au moment où `click()` rend la main.
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Exporte la partition dans un .json téléchargé. Renvoie le nom du fichier écrit. */
export function enregistrerPartition(partition) {
    const nom = nomDeFichierSur(nomDuMorceau(partition.meta), '.json');
    const contenu = JSON.stringify({ ...partition, meta: { ...partition.meta, modifieLe: new Date().toISOString() } }, null, 2);
    telecharger(contenu, nom, 'application/json');
    return nom;
}

/**
 * Lit un fichier choisi par l'utilisateur.
 *
 * Le contenu passe par `normaliser`, qui borne chaque champ : un .json est une entrée non fiable, et
 * une corde 12 sur une guitare à six cordes ferait planter le rendu à la première ligne cherchée.
 * Les erreurs remontent avec un message en clair — « ce n'est pas un fichier TabHub » vaut mieux
 * qu'une exception dans la console.
 */
export async function lireFichierPartition(fichier) {
    if (!fichier) throw new Error('Aucun fichier sélectionné.');
    if (fichier.size > 12 * 1024 * 1024) throw new Error('Fichier trop volumineux pour une tablature (plus de 12 Mo).');
    const texte = await fichier.text();
    let brut;
    try {
        brut = JSON.parse(texte);
    } catch (err) {
        throw new Error('Fichier illisible : ce n\'est pas du JSON valide.');
    }
    return normaliser(brut);
}
