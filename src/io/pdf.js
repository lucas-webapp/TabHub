// Export PDF : de la partition au fichier téléchargé, en un clic.
//
// SANS `window.print()`, ET C'EST LE POINT. La boîte d'impression du navigateur, avec
// « Enregistrer en PDF » comme destination, dépend d'un pilote PDF système qui peut manquer ou être
// mal réglé, impose deux clics de plus, et repagine selon les réglages de l'imprimante — pas selon
// les nôtres. Ici jsPDF écrit le fichier et le navigateur l'enregistre : le résultat est identique
// d'une machine à l'autre, et le geste est un « Enregistrer sous », rien d'autre.

import { mettreEnPage } from '../engine/layout.js';
import { dessinerPrimitives, PALETTE_PDF } from '../render/pdf.js';
import { nomDeFichierSur } from './json.js';

/**
 * Formats de page, en millimètres. La mise en page est calculée DIRECTEMENT dans cette unité — un
 * interligne de 2,1 mm, la taille des éditions pédagogiques — donc rien n'est mis à l'échelle ensuite.
 * Redimensionner après coup ferait varier l'épaisseur des traits fins avec le format de page.
 */
export const FORMATS = {
    a4: { nom: 'A4', largeur: 210, hauteur: 297, format: 'a4' },
    lettre: { nom: 'Lettre', largeur: 215.9, hauteur: 279.4, format: 'letter' },
};

export const MARGES = { gauche: 14, droite: 14, haut: 15, bas: 16 };
const INTERLIGNE_MM = 2.1;

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
 * Fabrique le document PDF. Séparé de `exporterPdf` pour que les bancs d'essai puissent l'éprouver
 * sans déclencher de téléchargement.
 * @returns {{pdf, nbPages, nomFichier}}
 */
export function construirePdf(partition, options = {}) {
    const jsPDFcls = (globalThis.jspdf && globalThis.jspdf.jsPDF) || globalThis.jsPDF;
    if (!jsPDFcls) throw new Error('jsPDF absent : vérifiez vendor/jspdf.umd.min.js dans index.html.');

    const format = FORMATS[options.format || 'a4'] || FORMATS.a4;
    const largeurUtile = format.largeur - MARGES.gauche - MARGES.droite;
    const hauteurUtile = format.hauteur - MARGES.haut - MARGES.bas;

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
    });

    const hauteurEnTete = page.ancrages.systemes.length ? page.ancrages.systemes[0].y : 0;
    const feuilles = paginer(page, hauteurUtile, hauteurEnTete);

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
                dx: MARGES.gauche, dy: MARGES.haut, palette: options.palette,
            });
        }
        const decalageY = MARGES.haut + (iFeuille === 0 ? hauteurEnTete : 0) - feuille.y0;
        for (const sys of feuille.systemes) {
            dessinerPrimitives(pdf, page.primitives.slice(sys.debutPrimitives, sys.finPrimitives), {
                dx: MARGES.gauche, dy: decalageY, palette: options.palette,
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

    return { pdf, nbPages: feuilles.length, nomFichier: nomDeFichierSur(partition.meta.titre, '.pdf') };
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
