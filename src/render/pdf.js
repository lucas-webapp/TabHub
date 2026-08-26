// Moteur de rendu jsPDF — le SECOND traducteur de la liste d'affichage, jumeau de render/svg.js.
//
// TOUT SORT EN VECTORIEL. C'est la différence de fond avec l'export PDF de HarmoHub, qui rastérise sa
// grille d'accords via html2canvas : une grille est faite de blocs et de gros texte, qu'une image en
// 2× rend honorablement. Une partition est faite de traits d'un dixième de millimètre — lignes de
// portée, hampes, liaisons. Rastérisée, elle devient grise et floue à l'impression, et le fichier
// pèse dix fois plus. Ici chaque primitive devient un vrai objet PDF : net à n'importe quel zoom,
// imprimable en typographie, et le fichier tient en quelques dizaines de kilo-octets.
//
// UNITÉS : le document est créé en MILLIMÈTRES, et la mise en page a été calculée en millimètres
// (interligne d'environ 1,7 mm, la valeur des éditions gravées). Il n'y a donc aucune conversion
// d'échelle ici — seule la taille des polices repasse en points, l'unité que jsPDF impose au texte.

const MM_VERS_PT = 72 / 25.4;

/** Palette d'impression : encre noire sur papier blanc. */
export const PALETTE_PDF = {
    papier: '#FFFFFF',
    encre: '#111111',
    discret: '#7A7368',
};

function versRvb(couleur) {
    const c = couleur.replace('#', '');
    const n = c.length === 3 ? c.split('').map(x => x + x).join('') : c;
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

/**
 * Analyse un chemin M/L/C/Z absolu en segments jsPDF.
 *
 * Le vocabulaire est volontairement minuscule — quatre commandes — parce que TOUS les chemins de
 * l'application sont écrits par engine/glyphs.js, jamais importés de l'extérieur. Pas besoin d'un
 * analyseur SVG complet (arcs, coordonnées relatives, formes abrégées) : il n'y en aura jamais.
 */
export function analyserChemin(d) {
    const segments = [];
    const jetons = d.match(/[MLCZmlcz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
    let i = 0;
    const nombre = () => parseFloat(jetons[i++]);
    while (i < jetons.length) {
        const cmd = jetons[i++];
        switch (cmd) {
            case 'M': case 'm': segments.push({ op: 'm', c: [nombre(), nombre()] }); break;
            case 'L': case 'l': segments.push({ op: 'l', c: [nombre(), nombre()] }); break;
            case 'C': case 'c': segments.push({ op: 'c', c: [nombre(), nombre(), nombre(), nombre(), nombre(), nombre()] }); break;
            case 'Z': case 'z': segments.push({ op: 'h' }); break;
            default: break;   // un nombre isolé (répétition implicite) : ignoré, jamais produit ici
        }
    }
    return segments;
}

/** Applique translation et échelle aux segments d'un glyphe. */
function transformer(segments, x, y, echelle) {
    return segments.map(s => s.op === 'h' ? s : {
        op: s.op,
        c: s.c.map((v, k) => (k % 2 === 0 ? x + v * echelle : y + v * echelle)),
    });
}

/**
 * Dessine une liste de primitives dans un document jsPDF déjà positionné sur la bonne page.
 * `decalage` translate tout le bloc — c'est ainsi qu'un système se retrouve en haut de sa page.
 */
export function dessinerPrimitives(pdf, primitives, options = {}) {
    const palette = { ...PALETTE_PDF, ...(options.palette || {}) };
    const dx = options.dx || 0;
    const dy = options.dy || 0;
    const couleurDe = (nom) => versRvb(palette[nom] || nom || palette.encre);

    for (const p of primitives) {
        switch (p.t) {
            case 'ligne': {
                pdf.setDrawColor(...couleurDe(p.couleur));
                pdf.setLineWidth(p.ep);
                if (p.pointille) pdf.setLineDashPattern(p.pointille, 0);
                pdf.line(p.x1 + dx, p.y1 + dy, p.x2 + dx, p.y2 + dy);
                if (p.pointille) pdf.setLineDashPattern([], 0);
                break;
            }
            case 'rect': {
                pdf.setFillColor(...couleurDe(p.couleur));
                pdf.rect(p.x + dx, p.y + dy, p.w, p.h, 'F');
                break;
            }
            case 'poly': {
                pdf.setFillColor(...couleurDe(p.couleur));
                pdf.path([
                    { op: 'm', c: [p.pts[0][0] + dx, p.pts[0][1] + dy] },
                    ...p.pts.slice(1).map(([x, y]) => ({ op: 'l', c: [x + dx, y + dy] })),
                    { op: 'h' },
                ]).fill();
                break;
            }
            case 'courbe': {
                pdf.setDrawColor(...couleurDe(p.couleur));
                pdf.setLineWidth(p.ep);
                const segs = analyserChemin(p.d).map(s => s.op === 'h' ? s : {
                    op: s.op, c: s.c.map((v, k) => (k % 2 === 0 ? v + dx : v + dy)),
                });
                pdf.path(segs).stroke();
                break;
            }
            case 'glyphe': {
                // UN SEUL appel `path()` pour TOUS les sous-chemins d'un trait rempli : c'est la
                // condition pour que les têtes de note creuses le restent. Le remplissage PDF suit la
                // règle « non-zero » ; un contour intérieur parcouru à l'envers y creuse un trou —
                // mais seulement s'il appartient au MÊME chemin. Deux `path()` successifs
                // rempliraient chaque contour séparément, et la blanche deviendrait une noire.
                for (const trait of p.traits) {
                    const segs = transformer(analyserChemin(trait.d), p.x + dx, p.y + dy, p.echelle);
                    if (trait.epaisseur == null) {
                        pdf.setFillColor(...couleurDe(p.couleur));
                        pdf.path(segs).fill();
                    } else {
                        pdf.setDrawColor(...couleurDe(p.couleur));
                        pdf.setLineWidth(trait.epaisseur * p.echelle);
                        pdf.setLineCap('round');
                        pdf.setLineJoin('round');
                        pdf.path(segs).stroke();
                        pdf.setLineCap('butt');
                    }
                }
                break;
            }
            case 'texte': {
                const gras = parseInt(p.poids, 10) >= 600 || p.poids === 'bold';
                const style = p.italique ? (gras ? 'bolditalic' : 'italic') : (gras ? 'bold' : 'normal');
                pdf.setFont(p.police === 'serif' ? 'times' : 'helvetica', style);
                pdf.setFontSize(p.taille * MM_VERS_PT);
                pdf.setTextColor(...couleurDe(p.couleur));
                const align = { debut: 'left', milieu: 'center', fin: 'right' }[p.ancre] || 'left';
                pdf.text(String(p.s), p.x + dx, p.y + dy, { align, baseline: 'alphabetic' });
                break;
            }
            default: break;
        }
    }
}
