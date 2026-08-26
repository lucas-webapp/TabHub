// Moteur de rendu SVG — écran. Consomme la liste d'affichage de engine/layout.js, sans rien savoir
// de la musique : il ne connaît que des lignes, des rectangles, des chemins et du texte.
//
// C'est délibéré, et c'est ce qui rend l'export PDF fidèle : ce module et render/pdf.js sont deux
// traducteurs INTERCHANGEABLES de la même liste. Si l'un dessine une note deux pixels plus haut que
// l'autre, c'est un bug de traduction, pas une divergence de mise en page — il n'y a qu'une mise en
// page.

/**
 * Palette. Les noms sont sémantiques (« encre », « papier ») plutôt que littéraux : le même dessin
 * doit pouvoir sortir sur fond beige à l'écran et sur blanc au PDF sans qu'aucune primitive ne change.
 */
export const PALETTE = {
    papier: '#FDFBF7',
    encre: '#1B1A17',
    discret: '#8C8375',
    curseur: '#00E676',
    lecture: '#FFB300',
    selection: 'rgba(0, 230, 118, 0.16)',
};

const ech = (v) => (Math.round(v * 100) / 100);

function couleurDe(nom, palette) {
    return palette[nom] || nom || palette.encre;
}

/** Traduit une primitive en balise SVG. Une fonction par type, aucune logique musicale. */
function primitiveVersSvg(p, palette) {
    const c = couleurDe(p.couleur, palette);
    switch (p.t) {
        case 'ligne': {
            const tirets = p.pointille ? ` stroke-dasharray="${p.pointille.join(' ')}"` : '';
            return `<line x1="${ech(p.x1)}" y1="${ech(p.y1)}" x2="${ech(p.x2)}" y2="${ech(p.y2)}" stroke="${c}" stroke-width="${ech(p.ep)}" stroke-linecap="butt"${tirets}/>`;
        }
        case 'rect':
            return `<rect x="${ech(p.x)}" y="${ech(p.y)}" width="${ech(p.w)}" height="${ech(p.h)}" fill="${c}"/>`;
        case 'poly':
            return `<polygon points="${p.pts.map(([x, y]) => `${ech(x)},${ech(y)}`).join(' ')}" fill="${c}"/>`;
        case 'courbe':
            return `<path d="${p.d}" fill="none" stroke="${c}" stroke-width="${ech(p.ep)}" stroke-linecap="round"/>`;
        case 'texte': {
            const familles = { serif: "'Times New Roman', Times, serif", 'sans-serif': "'Plus Jakarta Sans', system-ui, sans-serif" };
            const it = p.italique ? ' font-style="italic"' : '';
            const ancres = { debut: 'start', milieu: 'middle', fin: 'end' };
            return `<text x="${ech(p.x)}" y="${ech(p.y)}" fill="${c}" font-family="${familles[p.police] || p.police}" font-size="${ech(p.taille)}" font-weight="${p.poids}"${it} text-anchor="${ancres[p.ancre]}">${echapper(p.s)}</text>`;
        }
        case 'glyphe': {
            // Le miroir vertical sert aux crochets de hampe descendante : le même dessin retourné,
            // plutôt qu'un second jeu de chemins à maintenir en parallèle.
            const m = p.miroirY ? ` scale(1 -1)` : '';
            const t = `translate(${ech(p.x)} ${ech(p.y)}) scale(${ech(p.echelle)})${m}`;
            return p.traits.map(tr => tr.epaisseur == null
                ? `<path d="${tr.d}" transform="${t}" fill="${c}"/>`
                : `<path d="${tr.d}" transform="${t}" fill="none" stroke="${c}" stroke-width="${tr.epaisseur}" stroke-linecap="round" stroke-linejoin="round"/>`
            ).join('');
        }
        default:
            return '';
    }
}

function echapper(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Rend une mise en page complète en SVG.
 * @param {object} page      sortie de mettreEnPage()
 * @param {object} options   { palette, fond, calques } — `calques` insère des primitives
 *                           supplémentaires SOUS la partition (surlignage de lecture, curseur).
 */
export function rendreSvg(page, options = {}) {
    const palette = { ...PALETTE, ...(options.palette || {}) };
    const fond = options.fond !== false
        ? `<rect x="0" y="0" width="${ech(page.largeur)}" height="${ech(page.hauteur)}" fill="${palette.papier}"/>` : '';
    const dessous = (options.calquesDessous || []).map(p => primitiveVersSvg(p, palette)).join('');
    const corps = page.primitives.map(p => primitiveVersSvg(p, palette)).join('');
    const dessus = (options.calquesDessus || []).map(p => primitiveVersSvg(p, palette)).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${ech(page.largeur)}" height="${ech(page.hauteur)}" viewBox="0 0 ${ech(page.largeur)} ${ech(page.hauteur)}" role="img">${fond}${dessous}${corps}${dessus}</svg>`;
}

export { primitiveVersSvg, couleurDe };
