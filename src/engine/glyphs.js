// Glyphes musicaux, en chemins vectoriels purs.
//
// POURQUOI PAS UNE POLICE MUSICALE (Bravura, Petaluma…). Une police SMuFL est la solution
// « professionnelle » évidente, et elle a été écartée pour trois raisons concrètes :
//   1. Elle pèse 500 ko à vendorer, pour la douzaine de signes dont une tablature a besoin.
//   2. jsPDF ne sait embarquer une police que convertie en base64 dans le fichier PDF, ce qui gonfle
//      chaque export de plusieurs centaines de kilo-octets — pour un riff de quatre mesures.
//   3. Surtout : une police se rend par du TEXTE, et un texte ne se positionne pas au centième
//      d'interligne. Or une clé de sol MAL CENTRÉE sur sa ligne est immédiatement fausse à l'œil.
// Des chemins vectoriels règlent les trois d'un coup : ils pèsent quelques kilo-octets, se dessinent
// à l'identique en SVG et en PDF, et se positionnent au point près.
//
// SYSTÈME DE COORDONNÉES. Toutes les mesures sont en INTERLIGNES (l'écart entre deux lignes de la
// portée), avec y vers le BAS comme en SVG. Chaque glyphe a son propre point d'ancrage, choisi pour
// être ce qu'on veut aligner : le centre de la spirale pour la clé de sol (à poser sur la ligne de
// sol), le centre de la tête pour une note. Un seul nombre — la taille de l'interligne — suffit
// ensuite à passer de l'écran (px) au PDF (mm).
//
// VOCABULAIRE DES CHEMINS : uniquement M, L, C et Z, en coordonnées ABSOLUES. C'est le plus petit
// sous-ensemble qui couvre tout ce qui suit, et le seul que les deux moteurs de rendu savent
// consommer sans traduction (voir render/pdf.js, qui n'a qu'à lire ces quatre lettres).

const K = 0.5522847498307936; // constante de Bézier pour approcher un quart de cercle

/**
 * REPRÉSENTATION UNIFORME D'UN GLYPHE : une liste de TRAITS.
 *   { d, epaisseur: null }  → contour rempli (têtes de note, altérations, silences)
 *   { d, epaisseur: 0.3 }   → ligne tracée de cette épaisseur, bouts arrondis (les clés)
 * Les deux moteurs de rendu n'ont donc qu'une seule forme à savoir consommer, et une clé tracée
 * cohabite avec un dièse rempli sans cas particulier nulle part.
 */
export const rempli = (...d) => d.map(x => ({ d: x, epaisseur: null }));
export const trace = (d, epaisseur) => ({ d, epaisseur });

/** Décale un glyphe entier — sert au double bémol, qui est littéralement deux bémols côte à côte. */
export const decaler = (glyphe, dx, dy) => glyphe.map(t => ({
    ...t,
    d: t.d.replace(/(-?[\d.]+)\s+(-?[\d.]+)/g, (_, x, y) => `${(parseFloat(x) + dx).toFixed(4)} ${(parseFloat(y) + dy).toFixed(4)}`),
}));

/**
 * Spirale logarithmique en cubiques — le squelette de la clé de sol.
 *
 * POURQUOI PARAMÉTRIQUE PLUTÔT QU'À LA MAIN. Une première version dessinait la clé en Bézier écrites
 * une à une : le contour se recoupait, et la règle de remplissage « non-zero » comblait l'intérieur
 * de la spirale — la clé sortait en pâté. Une spirale calculée ne peut pas se recouper, et surtout
 * elle converge EXACTEMENT vers son centre : or ce centre EST la définition de la clé de sol (le
 * point posé sur la ligne de sol). Ce qui était le détail le plus difficile à obtenir à la main
 * devient ici vrai par construction.
 *
 * Échantillonnée tous les 45°, avec les poignées de Bézier posées le long de la tangente ANALYTIQUE
 * de la courbe : l'erreur reste sous le centième d'interligne, invisible même agrandi dix fois.
 */
export function spiraleLog(cx, cy, rDebut, rFin, angleDebut, tours, sens = -1) {
    const total = sens * tours * 2 * Math.PI;
    const b = Math.log(rFin / rDebut) / total;      // r(t) = rDebut · e^(b·t)
    const pas = Math.PI / 4;
    const n = Math.max(1, Math.ceil(Math.abs(total) / pas));
    const dt = total / n;
    const pt = (t) => {
        const r = rDebut * Math.exp(b * t), a = angleDebut + t;
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    };
    const tangente = (t) => {
        const r = rDebut * Math.exp(b * t), a = angleDebut + t, dr = b * r;
        return [dr * Math.cos(a) - r * Math.sin(a), dr * Math.sin(a) + r * Math.cos(a)];
    };
    const f = (v) => v.toFixed(4);
    let d = `M ${pt(0).map(f).join(' ')}`;
    for (let i = 0; i < n; i++) {
        const t0 = i * dt, t1 = (i + 1) * dt;
        const p0 = pt(t0), p1 = pt(t1), m0 = tangente(t0), m1 = tangente(t1);
        const c1 = [p0[0] + (m0[0] * dt) / 3, p0[1] + (m0[1] * dt) / 3];
        const c2 = [p1[0] - (m1[0] * dt) / 3, p1[1] - (m1[1] * dt) / 3];
        d += ` C ${c1.map(f).join(' ')} ${c2.map(f).join(' ')} ${p1.map(f).join(' ')}`;
    }
    return d;
}

/**
 * Ellipse tournée, en quatre cubiques.
 *
 * `sens` inverse le parcours du contour, et ce détail porte à lui seul les têtes de note CREUSES :
 * en remplissage « non-zero » — la règle par défaut du SVG comme du PDF — un contour intérieur
 * parcouru À L'ENVERS du contour extérieur annule le remplissage entre les deux, donc perce un trou.
 * L'alternative répandue (redessiner l'intérieur dans la couleur du fond) tombe dès que la note passe
 * sur un surlignage de lecture : le trou y resterait beige sur fond coloré.
 */
export function ellipseTournee(cx, cy, rx, ry, angleDeg = 0, sens = 1) {
    const a = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    const P = (x, y) => [cx + x * cos - y * sin, cy + x * sin + y * cos];
    const pts = sens > 0
        ? [[rx, 0], [0, ry], [-rx, 0], [0, -ry]]
        : [[rx, 0], [0, -ry], [-rx, 0], [0, ry]];
    const ctrl = sens > 0
        ? [[[rx, ry * K], [rx * K, ry]], [[-rx * K, ry], [-rx, ry * K]], [[-rx, -ry * K], [-rx * K, -ry]], [[rx * K, -ry], [rx, -ry * K]]]
        : [[[rx, -ry * K], [rx * K, -ry]], [[-rx * K, -ry], [-rx, -ry * K]], [[-rx, ry * K], [-rx * K, ry]], [[rx * K, ry], [rx, ry * K]]];
    let d = `M ${P(...pts[0]).map(n => n.toFixed(4)).join(' ')}`;
    for (let i = 0; i < 4; i++) {
        const c1 = P(...ctrl[i][0]), c2 = P(...ctrl[i][1]), fin = P(...pts[(i + 1) % 4]);
        d += ` C ${c1.map(n => n.toFixed(4)).join(' ')} ${c2.map(n => n.toFixed(4)).join(' ')} ${fin.map(n => n.toFixed(4)).join(' ')}`;
    }
    return d + ' Z';
}

/** Parallélogramme — les barres obliques du dièse et du bécarre, et les ligatures. */
function barreOblique(x, y, larg, haut, pente) {
    const dy = larg * pente;
    return `M ${x} ${y} L ${x + larg} ${y - dy} L ${x + larg} ${y - dy + haut} L ${x} ${y + haut} Z`;
}

// ---------------------------------------------------------------------------------------------
// Têtes de note. Ancrage : le CENTRE de la tête, à poser exactement sur sa ligne ou son interligne.
// ---------------------------------------------------------------------------------------------

/** Noire (et toute figure plus brève) : ellipse pleine inclinée à -20°, proportions d'usage. */
export const TETE_NOIRE = rempli(ellipseTournee(0, 0, 0.66, 0.48, -20));

/** Blanche : même ellipse, percée d'une ellipse intérieure parcourue en sens inverse. */
export const TETE_BLANCHE = rempli(ellipseTournee(0, 0, 0.66, 0.48, -20) + ' ' + ellipseTournee(0, 0, 0.42, 0.22, -20, -1));

/** Ronde : plus large, moins inclinée, et son trou est presque vertical — c'est ce qui la distingue
 *  d'une blanche au premier coup d'œil, bien plus que sa largeur. */
export const TETE_RONDE = rempli(ellipseTournee(0, 0, 0.84, 0.48, 0) + ' ' + ellipseTournee(0, 0, 0.42, 0.21, -62, -1));

/** Croix des notes étouffées (« ghost »/dead note), à la place de la tête. */
export const TETE_CROIX = rempli('M -0.42 -0.42 L -0.24 -0.56 L 0 -0.14 L 0.24 -0.56 L 0.42 -0.42 L 0.18 0 L 0.42 0.42 L 0.24 0.56 L 0 0.14 L -0.24 0.56 L -0.42 0.42 L -0.18 0 Z');

/** Point rythmique, posé après la tête. */
export const POINT = rempli(ellipseTournee(0, 0, 0.16, 0.16, 0));

// ---------------------------------------------------------------------------------------------
// Clés. Ancrage : (0,0) sur la LIGNE que la clé désigne — la 2e ligne depuis le bas pour sol,
// la 4e pour fa. C'est le point qu'on aligne, donc celui qui doit être l'origine du dessin.
// ---------------------------------------------------------------------------------------------

/**
 * Clé de sol, en trois traits tracés.
 *
 * Elle se lit comme un seul geste de plume, et c'est ainsi qu'elle est construite :
 *   1. LA HAMPE — de la boucle du haut, au-dessus de la portée, jusqu'au petit crochet sous la
 *      portée. Elle traverse la spirale de part en part : ce croisement est visible sur toute clé
 *      gravée, et le dessiner franchement vaut mieux que de le contourner.
 *   2. LA SPIRALE — enroulée dans le sens inverse des aiguilles d'une montre, d'un rayon large
 *      jusqu'au centre posé sur la ligne de sol.
 *   3. LA POINTE — le premier quart de tour de la spirale, redessiné plus épais, qui donne à la
 *      boucle son renflement. Une plume ne trace pas d'une épaisseur constante ; trois épaisseurs
 *      décroissantes suffisent à le suggérer sans modéliser un contour complet.
 */
const CLE_SOL_ENTREE = (-72 * Math.PI) / 180;   // angle où la hampe rejoint la spirale
const CLE_SOL_R = 1.16;                          // rayon extérieur de la boucle, en interlignes
export const CLE_SOL = [
    // 1. LA HAMPE, tracée du petit crochet du haut jusqu'à celui du bas. Elle traverse la boucle en
    //    passant LÉGÈREMENT À DROITE du centre : c'est ce croisement qui fait lire une clé de sol
    //    plutôt qu'une esperluette — une hampe tangente à la boucle, comme dans une première version,
    //    donne exactement le second.
    trace([
        'M -0.08 -3.06',
        'C -0.08 -3.68 0.44 -3.96 0.80 -3.64',
        'C 1.06 -3.40 1.04 -2.94 0.84 -2.48',
        'C 0.60 -1.92 0.36 -1.34 0.32 -0.72',
        'C 0.26 0.18 0.34 1.24 0.40 2.22',
        'C 0.46 2.92 0.20 3.34 -0.24 3.32',
        'C -0.58 3.30 -0.78 3.04 -0.70 2.78',
    ].join(' '), 0.22),
    // 2. LA BOUCLE ET SA SPIRALE, d'un seul tenant, convergeant vers le centre posé sur la ligne de sol.
    trace(spiraleLog(0, 0, CLE_SOL_R, 0.10, CLE_SOL_ENTREE, 1.42, -1), 0.20),
    // 3. LE RENFLEMENT : le tiers inférieur-gauche de la boucle repassé plus épais. Une plume charge
    //    là où elle appuie, en bas de la courbe ; trois épaisseurs suffisent à le suggérer sans
    //    modéliser un contour à largeur variable.
    trace(spiraleLog(0, 0, CLE_SOL_R * 0.99, CLE_SOL_R * 0.78, CLE_SOL_ENTREE - 1.9, 0.52, -1), 0.36),
];

/**
 * Clé de fa. Le gros crochet part de la 4e ligne et s'enroule vers le bas ; les DEUX POINTS
 * l'encadrent. Sans eux la clé ne désigne plus rien : ce sont eux qui pincent la ligne de fa, le
 * crochet ne fait que l'indiquer.
 */
export const CLE_FA = [
    trace([
        'M -1.72 2.60',
        'C -0.58 1.94 0.10 1.06 0.10 0.08',
        'C 0.10 -0.72 -0.36 -1.22 -1.06 -1.22',
        'C -1.66 -1.22 -2.06 -0.88 -2.06 -0.38',
        'C -2.06 0.06 -1.76 0.36 -1.32 0.36',
        'C -0.94 0.36 -0.68 0.10 -0.68 -0.26',
    ].join(' '), 0.34),
    ...rempli(ellipseTournee(0.86, -0.5, 0.20, 0.20, 0), ellipseTournee(0.86, 0.5, 0.20, 0.20, 0)),
];

/** Décalage vertical du petit « 8 » sous la clé : guitare et basse sonnent une octave plus bas. */
export const OCTAVE_BASSE_Y = 2.3;

// ---------------------------------------------------------------------------------------------
// Altérations. Ancrage : (0,0) au centre vertical, sur la ligne/interligne de la note visée.
// ---------------------------------------------------------------------------------------------

export const DIESE = rempli([
    // deux hampes verticales légèrement obliques
    'M -0.30 -1.06 L -0.16 -1.10 L -0.16 1.02 L -0.30 1.06 Z',
    'M 0.16 -1.20 L 0.30 -1.24 L 0.30 0.88 L 0.16 0.92 Z',
    barreOblique(-0.52, -0.16, 1.04, 0.26, 0.22),
    barreOblique(-0.52, 0.50, 1.04, 0.26, 0.22),
].join(' '));

export const BEMOL = rempli([
    'M -0.26 -1.42 L -0.10 -1.46 L -0.10 0.86 L -0.26 0.90 Z',
    'M -0.10 -0.16',
    'C 0.14 -0.44 0.42 -0.52 0.60 -0.38',
    'C 0.82 -0.20 0.76 0.16 0.44 0.50',
    'C 0.26 0.70 0.02 0.88 -0.10 0.96',
    'Z',
    'M 0.04 0.62',
    'C 0.28 0.36 0.44 0.10 0.42 -0.06',
    'C 0.40 -0.20 0.28 -0.22 0.14 -0.10',
    'C 0.08 -0.04 0.04 0.02 0.04 0.06',
    'Z',
].join(' '));

export const BECARRE = rempli([
    'M -0.28 -1.10 L -0.16 -1.14 L -0.16 0.70 L -0.28 0.74 Z',
    'M 0.16 -0.70 L 0.28 -0.74 L 0.28 1.10 L 0.16 1.14 Z',
    'M -0.28 -0.44 L 0.28 -0.60 L 0.28 -0.32 L -0.28 -0.16 Z',
    'M -0.28 0.16 L 0.28 0.00 L 0.28 0.28 L -0.28 0.44 Z',
].join(' '));

export const DOUBLE_DIESE = rempli([
    'M -0.36 -0.36 L -0.10 -0.36 L -0.10 -0.10 L 0.10 -0.10 L 0.10 -0.36 L 0.36 -0.36',
    'L 0.36 -0.10 L 0.10 -0.10 L 0.10 0.10 L 0.36 0.10 L 0.36 0.36 L 0.10 0.36',
    'L 0.10 0.10 L -0.10 0.10 L -0.10 0.36 L -0.36 0.36 L -0.36 0.10 L -0.10 0.10',
    'L -0.10 -0.10 L -0.36 -0.10 Z',
].join(' '));

export const ALTERATIONS = { '-2': [...BEMOL, ...decaler(BEMOL, 0.86, 0)], '-1': BEMOL, '0': BECARRE, '1': DIESE, '2': DOUBLE_DIESE };
/** Largeur réservée devant la tête de note, par altération — le rendu ne mesure pas les chemins. */
export const LARGEUR_ALTERATION = { '-2': 1.5, '-1': 0.95, '0': 0.75, '1': 0.95, '2': 0.85 };

// ---------------------------------------------------------------------------------------------
// Silences. Ancrage : (0,0) sur la 3e ligne de la portée (la ligne médiane), position de référence
// de tous les silences — la pause et la demi-pause s'en écartent d'un demi-interligne, dans un sens
// opposé qui est précisément ce qui les distingue.
// ---------------------------------------------------------------------------------------------

/** Pause (silence d'une ronde) : rectangle SOUS la 4e ligne, donc suspendu à celle-ci. */
export const PAUSE = rempli('M -0.62 -1.0 L 0.62 -1.0 L 0.62 -0.48 L -0.62 -0.48 Z');
/** Demi-pause : le même rectangle POSÉ sur la 3e ligne. Seule cette position les sépare. */
export const DEMI_PAUSE = rempli('M -0.62 -0.52 L 0.62 -0.52 L 0.62 0.0 L -0.62 0.0 Z');

/** Soupir (silence de noire) : le zigzag caractéristique, avec sa boucle en bas. */
export const SOUPIR = rempli([
    'M 0.10 -1.34',
    'C 0.32 -1.00 0.52 -0.72 0.30 -0.42',
    'C 0.12 -0.18 -0.16 0.00 -0.16 0.26',
    'C -0.16 0.46 0.00 0.66 0.22 0.86',
    'C 0.02 0.76 -0.44 0.62 -0.44 1.02',
    'C -0.44 1.24 -0.30 1.42 -0.12 1.54',
    'L -0.04 1.46',
    'C -0.16 1.36 -0.22 1.24 -0.22 1.14',
    'C -0.22 0.96 -0.06 0.88 0.16 0.96',
    'C 0.30 1.02 0.44 1.10 0.54 1.18',
    'L 0.62 1.10',
    'C 0.38 0.80 0.10 0.50 0.10 0.28',
    'C 0.10 0.06 0.34 -0.14 0.50 -0.34',
    'C 0.70 -0.60 0.62 -0.86 0.36 -1.20',
    'L 0.18 -1.42',
    'Z',
].join(' '));

/** Crochet + point d'un demi-soupir. `n` crochets pour les silences plus brefs (2 = quart de soupir). */
export function silenceCrochets(n) {
    const parties = [];
    // hampe oblique, du haut à droite vers le bas à gauche
    const hautY = -0.52 - (n - 1) * 0.62;
    parties.push(`M 0.30 ${hautY.toFixed(2)} L 0.44 ${hautY.toFixed(2)} L -0.02 1.34 L -0.16 1.34 Z`);
    for (let i = 0; i < n; i++) {
        const y = hautY + i * 0.62;
        parties.push(ellipseTournee(-0.16, y, 0.22, 0.19, 0));
        parties.push(`M -0.16 ${(y + 0.06).toFixed(2)} C 0.06 ${(y + 0.10).toFixed(2)} 0.24 ${(y + 0.02).toFixed(2)} 0.36 ${(y - 0.12).toFixed(2)} L 0.36 ${(y + 0.04).toFixed(2)} C 0.20 ${(y + 0.22).toFixed(2)} 0.00 ${(y + 0.28).toFixed(2)} -0.18 ${(y + 0.24).toFixed(2)} Z`);
    }
    return rempli(parties.join(' '));
}

/** Silences indexés par valeur de figure — la même clé que `duree.valeur`. */
export const SILENCES = {
    1: PAUSE,
    2: DEMI_PAUSE,
    4: SOUPIR,
    8: silenceCrochets(1),
    16: silenceCrochets(2),
    32: silenceCrochets(3),
};

// ---------------------------------------------------------------------------------------------
// Crochets de hampe (une note non ligaturée). Ancrage : l'EXTRÉMITÉ de la hampe.
// ---------------------------------------------------------------------------------------------

/**
 * Crochet d'une hampe montante, `n` crochets empilés vers le bas depuis le bout de la hampe.
 * Pour une hampe descendante, le rendu applique une symétrie verticale (voir layout) plutôt que de
 * dupliquer ce dessin : un crochet bas est exactement le miroir d'un crochet haut.
 */
export function crochet(n) {
    const parties = [];
    for (let i = 0; i < n; i++) {
        const y = i * 0.86;
        parties.push([
            `M 0 ${y.toFixed(2)}`,
            `C 0.42 ${(y + 0.36).toFixed(2)} 0.86 ${(y + 0.66).toFixed(2)} 0.86 ${(y + 1.34).toFixed(2)}`,
            `C 0.86 ${(y + 1.62).toFixed(2)} 0.76 ${(y + 1.88).toFixed(2)} 0.58 ${(y + 2.06).toFixed(2)}`,
            `L 0.48 ${(y + 1.98).toFixed(2)}`,
            `C 0.60 ${(y + 1.78).toFixed(2)} 0.64 ${(y + 1.58).toFixed(2)} 0.64 ${(y + 1.38).toFixed(2)}`,
            `C 0.64 ${(y + 0.92).toFixed(2)} 0.36 ${(y + 0.60).toFixed(2)} 0 ${(y + 0.42).toFixed(2)}`,
            'Z',
        ].join(' '));
    }
    return rempli(parties.join(' '));
}

// ---------------------------------------------------------------------------------------------
// Épaisseurs de trait normalisées, en interlignes. Regroupées ici plutôt qu'éparpillées dans le
// moteur de mise en page : ce sont les proportions de la gravure musicale, pas des choix de layout.
// ---------------------------------------------------------------------------------------------
export const EPAISSEURS = {
    ligneePortee: 0.11,
    ligneSupplementaire: 0.14,
    hampe: 0.12,
    ligature: 0.5,
    barreMesure: 0.12,
    barreEpaisse: 0.4,
    liaison: 0.09,
};
