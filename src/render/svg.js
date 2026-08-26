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
            // LES MÊMES FAMILLES QUE LE PDF. jsPDF ne dispose que des quatorze polices de base du
            // format PDF, dont Times et Helvetica ; l'écran doit demander exactement celles-là, sinon
            // le même chiffre de case sort en Plus Jakarta Sans à l'écran et en Helvetica au PDF —
            // largeurs différentes, donc masque de ligne mal dimensionné et césures qui se déplacent.
            // La police de l'INTERFACE (Plus Jakarta Sans, héritée de HarmoHub) reste celle du
            // châssis : elle n'entre pas dans la partition, qui est un document, pas une interface.
            const familles = { serif: "'Times New Roman', Times, serif", 'sans-serif': "Helvetica, Arial, sans-serif" };
            const it = p.italique ? ' font-style="italic"' : '';
            const ancres = { debut: 'start', milieu: 'middle', fin: 'end' };
            return `<text x="${ech(p.x)}" y="${ech(p.y)}" fill="${c}" font-family="${familles[p.police] || p.police}" font-size="${ech(p.taille)}" font-weight="${p.poids}"${it} text-anchor="${ancres[p.ancre]}">${echapper(p.s)}</text>`;
        }
        case 'glyphe': {
            const t = `translate(${ech(p.x)} ${ech(p.y)}) scale(${ech(p.echelle)})`;
            // Chemin court : le glyphe est décrit UNE fois dans le <defs> et référencé ici. Le
            // chemin long (dessin inline) ne sert qu'aux glyphes sans nom — il n'y en a plus, mais
            // il évite qu'un futur glyphe calculé ne disparaisse silencieusement du rendu.
            if (p.nom) return `<use href="#g-${p.nom}" transform="${t}" color="${c}"/>`;
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
 * Bibliothèque de glyphes : chaque dessin employé, décrit UNE seule fois.
 *
 * POURQUOI. Un contour Bravura pèse plusieurs centaines de caractères, et une partition de cent
 * cinquante mesures en pose plusieurs milliers. Écrit en clair à chaque occurrence — ce que faisait
 * une première version — le SVG d'une telle partition atteignait 4,4 Mo, et le seul fait de le
 * confier au navigateur coûtait 243 ms. À chaque frappe au clavier. Décrits une fois puis
 * référencés par <use>, les mêmes glyphes tiennent en quelques dizaines de kilo-octets.
 *
 * `fill="currentColor"` avec `color` posé sur le <use> : c'est ce qui permet au MÊME dessin de
 * sortir en encre ou en gris discret selon l'endroit, sans le dupliquer par couleur.
 */
function bibliothequeGlyphes(primitives, calques) {
    const vus = new Map();
    for (const liste of [primitives, ...calques]) {
        for (const p of liste) {
            if (p.t === 'glyphe' && p.nom && !vus.has(p.nom)) vus.set(p.nom, p.traits);
        }
    }
    if (!vus.size) return '';
    const contenu = [...vus].map(([nom, traits]) => {
        const corps = traits.map(tr => tr.epaisseur == null
            ? `<path d="${tr.d}" fill="currentColor"/>`
            : `<path d="${tr.d}" fill="none" stroke="currentColor" stroke-width="${tr.epaisseur}" stroke-linecap="round" stroke-linejoin="round"/>`
        ).join('');
        return `<g id="g-${nom}">${corps}</g>`;
    }).join('');
    return `<defs>${contenu}</defs>`;
}

/**
 * Rend une mise en page complète en SVG.
 * @param {object} page      sortie de mettreEnPage()
 * @param {object} options   { palette, fond, calques, systemesVisibles }
 *   `calques` insère des primitives supplémentaires SOUS la partition (lecture, curseur).
 *   `systemesVisibles` restreint le dessin à ces systèmes — la partition garde sa taille complète
 *   (donc le défilement reste juste), mais seuls les systèmes donnés deviennent des nœuds. À
 *   l'export PDF on ne passe rien : tout doit être dessiné.
 */
export function rendreSvg(page, options = {}) {
    const palette = { ...PALETTE, ...(options.palette || {}) };
    const dessousP = options.calquesDessous || [];
    const dessusP = options.calquesDessus || [];
    const fond = options.fond !== false
        ? `<rect x="0" y="0" width="${ech(page.largeur)}" height="${ech(page.hauteur)}" fill="${palette.papier}"/>` : '';

    // Les systèmes retenus donnent des PLAGES d'index dans la liste d'affichage — les mêmes que
    // celles dont se sert la pagination du PDF. L'en-tête du morceau (titre, tempo) précède le
    // premier système : il n'appartient à aucun, et n'est donc joint que s'il est lui-même visible.
    let corpsPrimitives = page.primitives;
    if (options.systemesVisibles) {
        const parts = [];
        const premier = options.systemesVisibles[0];
        if (premier && premier.index === 0 && page.enTete) parts.push(page.primitives.slice(page.enTete.debut, page.enTete.fin));
        for (const s of options.systemesVisibles) parts.push(page.primitives.slice(s.debutPrimitives, s.finPrimitives));
        corpsPrimitives = parts.flat();
    }

    const defs = bibliothequeGlyphes(corpsPrimitives, [dessousP, dessusP]);
    const dessous = dessousP.map(p => primitiveVersSvg(p, palette)).join('');
    const corps = corpsPrimitives.map(p => primitiveVersSvg(p, palette)).join('');
    const dessus = dessusP.map(p => primitiveVersSvg(p, palette)).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${ech(page.largeur)}" height="${ech(page.hauteur)}" viewBox="0 0 ${ech(page.largeur)} ${ech(page.hauteur)}" role="img">${defs}${fond}${dessous}${corps}${dessus}</svg>`;
}

export { primitiveVersSvg, couleurDe };
