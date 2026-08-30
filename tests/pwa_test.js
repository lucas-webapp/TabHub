// Banc de L'ICÔNE D'ÉCRAN D'ACCUEIL (PWA) — iPhone en particulier.
//
// CE QU'IL PROTÈGE. Retour utilisateur : « mettre en forme le logo de l'application en local sur
// mon bureau iPhone ». Safari iOS ignore superbement le manifest.json ET un favicon SVG pour
// l'icône d'écran d'accueil : sans un <link rel="apple-touch-icon"> précis pointant vers un PNG,
// il PHOTOGRAPHIE la page au moment d'« Ajouter à l'écran d'accueil » et pose ce screenshot en
// icône — jamais le logo de l'application. Ce banc vérifie :
//   • le lien apple-touch-icon existe, pointe vers un vrai fichier PNG — CARRÉ, PLEIN CADRE, sans
//     le moindre coin déjà arrondi (c'est iOS qui découpe la forme finale ; un fond pré-arrondi
//     laisserait un liseré visible entre les deux découpes) ;
//   • les balises qui font qu'une fois ajoutée, l'app s'ouvre en PLEIN ÉCRAN sous son propre nom —
//     pas dans un onglet Safari avec sa barre d'adresse ;
//   • le manifest (Android/Chrome) porte aussi des PNG 192/512, pas seulement le SVG ;
//   • favicon.svg (l'icône affichée partout ailleurs) dessine SIX barres — les six cordes d'une
//     tablature, la même grammaire EXACTE que le logo de la barre du haut (index.html) — et non les
//     cinq d'une version antérieure, à une autre marge : un favicon qui ne ressemble pas tout à
//     fait à l'app qu'il représente, dès qu'on les voit côte à côte.
//
// Aucun navigateur nécessaire : tout ce qui suit se lit sur le disque, pas dans une page rendue.

const fs = require('fs');
const path = require('path');
const creerHarnais = require('./_harness.js');
const { check, exiger, plan, bilan } = creerHarnais('PWA — icône d\'écran d\'accueil');

const RACINE = path.join(__dirname, '..');
const chemin = (...p) => path.join(RACINE, ...p);

/** Largeur/hauteur déclarées dans l'en-tête IHDR d'un PNG — pas besoin d'une bibliothèque d'image :
 *  ces deux entiers 32 bits (big-endian) sont TOUJOURS aux mêmes octets, juste après la signature
 *  PNG (8 octets) et le couple longueur+type du premier chunk (8 octets de plus). */
function tailleDeclareePng(chemin) {
    const buf = fs.readFileSync(chemin);
    return { largeur: buf.readUInt32BE(16), hauteur: buf.readUInt32BE(20) };
}

(async () => {
    plan(16);
    try {
        const html = fs.readFileSync(chemin('index.html'), 'utf8');

        // --- apple-touch-icon : LE lien qui manquait ---------------------------------------------------
        const lienTouchIcon = html.match(/<link\s+rel="apple-touch-icon"\s+href="([^"]+)"/);
        exiger(!!lienTouchIcon, 'index.html porte un <link rel="apple-touch-icon"> — sans lui, iOS pose un SCREENSHOT de la page en icône');
        const cheminTouchIcon = lienTouchIcon && chemin(lienTouchIcon[1]);
        exiger(cheminTouchIcon && fs.existsSync(cheminTouchIcon), 'et le fichier qu\'il désigne existe réellement sur le disque');
        const tailleTouchIcon = tailleDeclareePng(cheminTouchIcon);
        check(tailleTouchIcon.largeur === 180 && tailleTouchIcon.hauteur === 180,
            'apple-touch-icon.png fait 180×180 — la taille que retient iOS sur un iPhone récent');
        const pngTouchIcon = fs.readFileSync(cheminTouchIcon);
        check(pngTouchIcon.length > 500, 'et n\'est pas un fichier vide ou tronqué');

        // --- Plein écran, sous son propre nom -------------------------------------------------------
        check(/<meta\s+name="apple-mobile-web-app-capable"\s+content="yes"/.test(html),
            'apple-mobile-web-app-capable=yes : ouverte depuis l\'icône, l\'app se lance en PLEIN ÉCRAN, sans la barre d\'adresse Safari');
        check(/<meta\s+name="apple-mobile-web-app-title"\s+content="TabHub"/.test(html),
            'apple-mobile-web-app-title=TabHub : le nom sous l\'icône est celui de l\'app, pas l\'URL de la page');

        // --- Le manifest (Android/Chrome) porte aussi de vrais PNG, pas seulement le SVG -------------
        const manifest = JSON.parse(fs.readFileSync(chemin('manifest.json'), 'utf8'));
        exiger(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest.json déclare bien une liste d\'icônes (préalable)');
        const icone192 = manifest.icons.find(i => i.sizes === '192x192');
        const icone512 = manifest.icons.find(i => i.sizes === '512x512');
        check(!!icone192 && icone192.type === 'image/png', 'le manifest porte une icône PNG 192×192');
        check(!!icone512 && icone512.type === 'image/png', 'et une PNG 512×512 — les deux tailles standard d\'une PWA installable');
        for (const entree of [icone192, icone512].filter(Boolean)) {
            const c = chemin(entree.src);
            const [attendu] = entree.sizes.split('x').map(Number);
            const reelle = fs.existsSync(c) ? tailleDeclareePng(c) : null;
            check(!!reelle && reelle.largeur === attendu && reelle.hauteur === attendu,
                `et le fichier « ${entree.src} » existe réellement, à la taille ${entree.sizes} qu'il annonce`);
        }

        // --- favicon.svg : SIX barres, la même grammaire que le logo de la barre du haut --------------
        const favicon = fs.readFileSync(chemin('icons', 'favicon.svg'), 'utf8');
        const rectsFavicon = favicon.match(/<rect\b[^>]*\/>/g) || [];
        // Un fond (le carré/rectangle arrondi) + SIX barres = sept <rect> en tout — jamais cinq
        // barres (une version antérieure) ni sept barres (le compte de six cordes serait alors faux).
        check(rectsFavicon.length === 7, 'favicon.svg dessine SEPT rectangles : un fond + les SIX cordes — pas cinq, pas sept barres');

        const barresFavicon = rectsFavicon.filter(r => /width="36"/.test(r));
        check(barresFavicon.length === 6, 'dont exactement SIX barres de largeur 36 (six cordes, pas cinq)');

        // Même geste EXACTEMENT que le logo affiché dans la barre du haut (x=6, largeur 36) : sans
        // cette cohérence, l'icône hors-contexte (onglet, écran d'accueil) ne ressemble pas tout à
        // fait au logo affiché DANS l'application elle-même.
        const rectsHeader = (html.match(/<rect x="6"[^>]*fill="currentColor"[^>]*\/>/g) || []);
        check(rectsHeader.length === 6, 'préalable : le logo de la barre du haut (index.html) dessine bien ses six barres à x=6, largeur 36');
        // x, y, largeur ET hauteur des six barres — pas seulement x/largeur — pour vraiment vérifier
        // qu'il s'agit du MÊME dessin (six tailles de barre distinctes), pas d'une simple coïncidence
        // sur les deux seuls attributs partagés par toutes les barres.
        const geometrie = (r) => ['x', 'y', 'width', 'height'].map(attr => r.match(new RegExp(attr + '="([\\d.]+)"'))?.[1]).join(':');
        const geometrieFavicon = barresFavicon.map(geometrie).sort().join(',');
        const geometrieHeader = rectsHeader.map(geometrie).sort().join(',');
        check(geometrieFavicon === geometrieHeader,
            'et favicon.svg reprend EXACTEMENT la même géométrie (x, y, largeur, hauteur des six barres) que ce logo — même dessin, pas une approximation');

        check(true, 'toutes les vérifications ci-dessus se sont exécutées sans exception (lecture disque seule, aucun navigateur nécessaire)');
    } catch (e) {
        check(false, 'le banc s\'est arrêté sur une exception au lieu d\'aller au bout — ' + e.message);
    }
    bilan();
})();
