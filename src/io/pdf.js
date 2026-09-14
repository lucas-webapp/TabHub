// Export PDF : de la partition au fichier téléchargé, en un clic.
//
// SANS `window.print()`, ET C'EST LE POINT. La boîte d'impression du navigateur, avec
// « Enregistrer en PDF » comme destination, dépend d'un pilote PDF système qui peut manquer ou être
// mal réglé, impose deux clics de plus, et repagine selon les réglages de l'imprimante — pas selon
// les nôtres. Ici jsPDF écrit le fichier et le navigateur l'enregistre : le résultat est identique
// d'une machine à l'autre, et le geste est un « Enregistrer sous », rien d'autre.

import { mettreEnPage } from '../engine/layout.js';
import { dessinerPrimitives, PALETTE_PDF } from '../render/pdf.js';
import { nomDeFichierSur, nomDuMorceau } from './json.js';

/**
 * Formats de page, en millimètres. La mise en page est calculée DIRECTEMENT dans cette unité — un
 * interligne de 2,1 mm, la taille des éditions pédagogiques — donc rien n'est mis à l'échelle ensuite.
 * Redimensionner après coup ferait varier l'épaisseur des traits fins avec le format de page.
 */
export const FORMATS = {
    a4: { nom: 'A4', largeur: 210, hauteur: 297, format: 'a4' },
    lettre: { nom: 'Lettre', largeur: 215.9, hauteur: 279.4, format: 'letter' },
};

// `MARGES` a disparu : la constante unique est devenue JEUX_MARGES, dont « normales » reprend ses
// valeurs exactes (voir juste en dessous). Personne d'autre ne l'importait.
const INTERLIGNE_MM = 2.1;

/**
 * TROIS JEUX DE MARGES, nommés plutôt que chiffrés (retour utilisateur : « me permettre d'ajuster
 * [...] l'espacement entre les portées (pour optimiser le nombre de pages si besoin), la taille des
 * titres, et d'autres paramètres que tu trouves intéressants »).
 *
 * POURQUOI TROIS CHOIX ET NON QUATRE CURSEURS. Régler quatre marges indépendamment, c'est quatre
 * décisions pour un seul but — « fais-moi tenir ça sur moins de pages » — et trois chances de
 * produire une page bancale (une marge basse plus petite que la haute se voit immédiatement). Les
 * trois jeux restent typographiquement cohérents : le bas garde toujours un millimètre de plus que
 * le haut, la place du numéro de page.
 * « Normales » vaut exactement les marges d'origine : le réglage par défaut ne change rien à ce
 * qu'exportaient les versions antérieures.
 */
export const JEUX_MARGES = {
    serrees:  { nom: 'Serrées',  gauche: 9,  droite: 9,  haut: 10, bas: 11 },
    normales: { nom: 'Normales', gauche: 14, droite: 14, haut: 15, bas: 16 },
    larges:   { nom: 'Larges',   gauche: 20, droite: 20, haut: 22, bas: 23 },
};

/**
 * BORNES DES RÉGLAGES DE MISE EN PAGE, en un seul endroit — l'interface construit ses curseurs
 * d'après cette table (voir main.js#ouvrirApercuPdf) plutôt qu'avec ses propres min/max recopiés.
 * Chaque borne a une raison, pas un chiffre rond :
 *   • `interligne` — 1,5 mm est la limite sous laquelle deux chiffres de frette se touchent dans la
 *     tablature ; 3 mm est déjà la taille des éditions pour débutants.
 *   • `ecartSystemes` — en interlignes. Sous 1,6, les lignes supplémentaires d'un système mordent
 *     sur la tablature du précédent.
 *   • `echelleEnTete` — 0,6 rend le titre plus petit que le nom de l'artiste à l'échelle 1 ; au-delà
 *     de 1,5 il déborde la largeur utile sur un titre de longueur courante.
 */
export const BORNES_PDF = {
    interligne:    { min: 1.5, max: 3.0, pas: 0.05, defaut: INTERLIGNE_MM, unite: 'mm' },
    ecartSystemes: { min: 1.6, max: 6.0, pas: 0.1,  defaut: 3.2 },
    echelleEnTete: { min: 0.6, max: 1.5, pas: 0.05, defaut: 1 },
};

/**
 * Répartit les systèmes en pages.
 *
 * Un système ne se coupe JAMAIS entre deux pages : couper une portée en deux la rend illisible, et
 * la tablature correspondante se retrouverait sur la page suivante, séparée de son solfège. On
 * préfère donc une page qui finit tôt.
 */
function paginer(page, hauteurUtile, hauteurEnTete) {
    const pages = [];
    let courante = null;
    for (const sys of page.ancrages.systemes) {
        const hautDuBloc = sys.y;
        const basDuBloc = sys.y + sys.hauteur;
        if (!courante) {
            courante = { systemes: [], y0: hautDuBloc, decalageEnTete: hauteurEnTete };
        } else if (basDuBloc - courante.y0 > hauteurUtile - courante.decalageEnTete) {
            pages.push(courante);
            courante = { systemes: [], y0: hautDuBloc, decalageEnTete: 0 };
        }
        courante.systemes.push(sys);
    }
    if (courante && courante.systemes.length) pages.push(courante);
    return pages;
}

/**
 * LA MISE EN PAGE PAGINÉE, SANS ÉCRIRE DE PDF — le calcul commun à l'export et à son APERÇU.
 *
 * Extrait de `construirePdf` (juste en dessous, qui l'appelle) pour que l'aperçu à l'écran ne soit
 * pas une approximation : il montre la MÊME liste d'affichage, découpée par le MÊME paginateur, aux
 * MÊMES marges. Un aperçu recalculé de son côté aurait été un second moteur à tenir d'accord avec le
 * premier — et un aperçu qui ne dit pas exactement la vérité sur le nombre de pages ne sert à rien,
 * puisque c'est précisément la question posée (retour utilisateur : « me montrer la mise en page
 * avant d'enregistrer le PDF [...] pour optimiser le nombre de pages si besoin »).
 *
 * Aucune dépendance à jsPDF ici : l'aperçu s'affiche même si la bibliothèque n'a pas chargé.
 * @returns {{page, feuilles, format, marges, hauteurEnTete, largeurUtile, hauteurUtile}}
 */
export function preparerPdf(partition, options = {}) {
    const format = FORMATS[options.format || 'a4'] || FORMATS.a4;
    const marges = JEUX_MARGES[options.marges] || JEUX_MARGES.normales;
    const largeurUtile = format.largeur - marges.gauche - marges.droite;
    const hauteurUtile = format.hauteur - marges.haut - marges.bas;

    const page = mettreEnPage(partition, {
        S: options.interligne || INTERLIGNE_MM,
        largeurPage: largeurUtile,
        margeGauche: 9,     // place de l'accolade et du « TAB » vertical, à l'intérieur de la page
        margeDroite: 1,
        avecEnTete: true,
        yDepart: 0,
        avertirErreurs: false,   // fond translucide : couleur écran, non portable vers jsPDF
        // TAB seule (voir main.js#appliquerTabSeule) : le PDF suit le même réglage que l'écran, la
        // même liste d'affichage partagée s'en charge sans code de plus ici.
        avecPortee: options.avecPortee,
        // LES TROIS RÉGLAGES DE L'APERÇU. `mesuresParLigne` n'était pas transmis du tout jusqu'ici :
        // le PDF découpait toujours au plus serré (mode glouton), quel que soit l'affichage à
        // l'écran. Ce n'était pas un oubli sans conséquence — c'est exactement ce qui empêchait de
        // faire une fiche d'exercices de deux mesures par ligne en PDF.
        mesuresParLigne: options.mesuresParLigne || null,
        ecartSystemes: options.ecartSystemes ?? BORNES_PDF.ecartSystemes.defaut,
        echelleEnTete: options.echelleEnTete ?? BORNES_PDF.echelleEnTete.defaut,
    });

    const hauteurEnTete = page.ancrages.systemes.length ? page.ancrages.systemes[0].y : 0;
    const feuilles = paginer(page, hauteurUtile, hauteurEnTete);
    return { page, feuilles, format, marges, hauteurEnTete, largeurUtile, hauteurUtile };
}

/**
 * Fabrique le document PDF. Séparé de `exporterPdf` pour que les bancs d'essai puissent l'éprouver
 * sans déclencher de téléchargement.
 * @returns {{pdf, nbPages, nomFichier}}
 */
export function construirePdf(partition, options = {}) {
    const jsPDFcls = (globalThis.jspdf && globalThis.jspdf.jsPDF) || globalThis.jsPDF;
    if (!jsPDFcls) throw new Error('jsPDF absent : vérifiez vendor/jspdf.umd.min.js dans index.html.');

    const { page, feuilles, format, marges, hauteurEnTete } = preparerPdf(partition, options);

    const pdf = new jsPDFcls({ unit: 'mm', format: format.format, orientation: 'portrait', compress: true });
    pdf.setProperties({
        title: partition.meta.titre || 'Tablature',
        author: partition.meta.artiste || '',
        creator: 'TabHub',
        subject: 'Tablature et partition',
    });

    feuilles.forEach((feuille, iFeuille) => {
        if (iFeuille > 0) pdf.addPage();

        // L'en-tête (titre, artiste, tempo) n'appartient à aucun système : il ne va que sur la
        // première page, comme sur toute partition imprimée.
        if (iFeuille === 0 && page.enTete.fin > 0) {
            dessinerPrimitives(pdf, page.primitives.slice(page.enTete.debut, page.enTete.fin), {
                dx: marges.gauche, dy: marges.haut, palette: options.palette,
            });
        }
        const decalageY = marges.haut + (iFeuille === 0 ? hauteurEnTete : 0) - feuille.y0;
        for (const sys of feuille.systemes) {
            dessinerPrimitives(pdf, page.primitives.slice(sys.debutPrimitives, sys.finPrimitives), {
                dx: marges.gauche, dy: decalageY, palette: options.palette,
            });
        }

        // Pied de page discret : numéro seulement s'il y a plusieurs pages — sur une partition d'une
        // seule page, « 1 / 1 » n'apprend rien à personne.
        if (feuilles.length > 1) {
            pdf.setFont('times', 'normal');
            pdf.setFontSize(8.5);
            pdf.setTextColor(130, 124, 114);
            pdf.text(`${iFeuille + 1} / ${feuilles.length}`, format.largeur / 2, format.hauteur - 8, { align: 'center' });
        }
    });

    // « Titre - Artiste.pdf », comme le .json et le .mid : voir nomDuMorceau dans io/json.js, le seul
    // endroit qui décide d'un nom de fichier. Les PROPRIÉTÉS du document, elles, gardent les deux
    // champs séparés (title/author ci-dessus) — c'est la place prévue pour chacun dans un PDF, et un
    // lecteur qui affiche « Titre - Artiste » dans sa barre de titre aurait perdu la distinction.
    return { pdf, nbPages: feuilles.length, nomFichier: nomDeFichierSur(nomDuMorceau(partition.meta), '.pdf') };
}

/**
 * Construit le PDF et déclenche son téléchargement. `pdf.save()` pose un lien `download` : le
 * navigateur ouvre « Enregistrer sous », sans boîte d'impression ni onglet intermédiaire.
 */
export function exporterPdf(partition, options = {}) {
    const { pdf, nomFichier, nbPages } = construirePdf(partition, options);
    pdf.save(nomFichier);
    return { nomFichier, nbPages };
}

export { PALETTE_PDF };
