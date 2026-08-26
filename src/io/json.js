// Sauvegarde et ouverture de fichiers .json.
//
// LE FICHIER EST LE MODÈLE, tel quel. Pas de format d'échange intermédiaire, pas de conversion : ce
// qu'on écrit est la structure décrite dans model/score.js, indentée pour rester lisible et
// modifiable à la main. Un utilisateur qui ouvre son .json dans un éditeur de texte doit reconnaître
// sa partition — c'est ce qui rend le format durable, et ce qui permet de diagnostiquer un fichier
// abîmé sans outil.

import { normaliser } from '../model/score.js';

/** Nom de fichier sûr : les caractères interdits par les systèmes de fichiers sont remplacés. */
export function nomDeFichierSur(nom, extension) {
    const base = String(nom || 'tablature').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 90) || 'tablature';
    return `${base}${extension}`;
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
    const nom = nomDeFichierSur(partition.meta.titre, '.json');
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
