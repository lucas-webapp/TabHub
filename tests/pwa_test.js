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
//   • favicon.svg (l'icône affichée partout ailleurs) dessine EXACTEMENT la même marque que le
//     logo de la barre du haut (index.html) : « TAB » gravé dans quatre cordes. Un favicon qui ne
//     ressemble pas tout à fait à l'app qu'il représente se voit dès qu'on les met côte à côte
//     (onglet du navigateur contre barre du haut) ;
//   • cette marque RESTE À DISTANCE DU BORD du carré : 8 px sur les flancs, 9 px en haut et en
//     bas. Retour utilisateur sur la version d'avant, dont les six barres allaient de y=7 à y=44
//     — soit 4 px sous le bord bas : « les 6 traits prennent trop de place, ils sont trop proches
//     du bord de l'icône d'app en noir. ça rend un effet pas pro. » ;
//   • les lettres sont des CHEMINS et non du <text> : un logo posé sur une police du système
//     change de dessin d'une machine à l'autre ;
//   • le détourage des lettres passe par un <mask> et non par un liseré peint de la couleur du
//     fond : sinon la marque n'est juste que sur le fond pour lequel ce liseré a été choisi ;
//   • les cordes sont d'opacité UNIFORME : c'est le dégradé d'opacité sur des barres nues qui
//     faisait confondre cette marque avec celle de HarmoHub (« on va confondre les logiciels »).
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
    plan(21);
    try {
        const html = fs.readFileSync(chemin('index.html'), 'utf8');

        // --- apple-touch-icon : LE lien qui manquait ---------------------------------------------------
        const lienTouchIcon = html.match(/<link\s+rel="apple-touch-icon"\s+href="([^"]+)"/);
        exiger(!!lienTouchIcon, 'index.html porte un <link rel="apple-touch-icon"> — sans lui, iOS pose un SCREENSHOT de la page en icône');
        // Le href porte un ?v=… (anti-cache : le dessin de l'icône a changé, et sans version dans
        // l'URL les navigateurs resservent l'ancienne depuis leur cache). Le fichier sur le disque,
        // lui, n'a pas de query string — d'où le découpage.
        const cheminTouchIcon = lienTouchIcon && chemin(lienTouchIcon[1].split('?')[0]);
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

        // --- favicon.svg : la MÊME marque que le logo de la barre du haut ------------------------
        const favicon = fs.readFileSync(chemin('icons', 'favicon.svg'), 'utf8');

        /** L'encre d'une de ces marques : tout ce qui est tracé APRÈS le </mask>. Ce qui est dans
         *  le masque ne peint rien — ce sont les silhouettes qui creusent les cordes — et le
         *  confondre avec l'encre ferait passer un dessin décalé pour identique. */
        const encre = (svg) => {
            const apres = svg.slice(svg.indexOf('</mask>') + '</mask>'.length);
            return (apres.match(/<path\b[^>]*\bd="([^"]+)"/g) || [])
                .map(t => t.match(/\bd="([^"]+)"/)[1]);
        };

        const blocLogo = html.slice(html.indexOf('<span class="logo-marque">'),
                                    html.indexOf('</span>', html.indexOf('</svg>', html.indexOf('<span class="logo-marque">'))));
        const encreFavicon = encre(favicon);
        const encreLogo = encre(blocLogo);

        // 4 cordes + les 3 lettres du mot = 7 tracés d'encre, de part et d'autre.
        exiger(encreLogo.length === 7,
            'préalable : le logo de la barre du haut trace 7 formes d\'encre — les 4 cordes et les 3 lettres de « TAB »');
        check(encreFavicon.length === 7, 'favicon.svg en trace 7 aussi : les 4 cordes et les 3 lettres, pas une version simplifiée');
        check(encreFavicon.join('|') === encreLogo.join('|'),
            'et ce sont EXACTEMENT les mêmes tracés que le logo de la barre du haut — le même dessin au chemin près, pas une approximation');

        // --- Les lettres sont dessinées, pas composées ------------------------------------------
        // Un <text> dans un logo se rend avec la police que la machine veut bien fournir : le
        // dessin change alors d'un poste à l'autre, et d'un navigateur à l'autre.
        check(!/<text\b/.test(favicon) && !/<text\b/.test(blocLogo),
            'ni le favicon ni le logo n\'emploient <text> : les lettres sont des chemins, donc indépendantes des polices installées');

        // --- Le détourage se fait par un masque, pas par un liseré de la couleur du fond ---------
        // Un liseré peint en #161616 n'est juste que sur un fond #161616 : posée ailleurs (icône à
        // #0a0a0a, impression sur blanc), la marque montrerait un halo gris autour des lettres.
        check(/<mask\b/.test(favicon) && /<mask\b/.test(blocLogo),
            'le détourage des lettres passe par un <mask> : la marque reste juste sur n\'importe quel fond');

        // --- Cordes d'opacité uniforme : ce qui la distingue de HarmoHub -------------------------
        const opacitesCordes = [...favicon.matchAll(/<g mask="[^"]+"[^>]*\bopacity="([\d.]+)"/g)].map(m => m[1]);
        check(opacitesCordes.length === 1,
            'les cordes portent UNE seule opacité, commune (un jeu de cordes) — et non le dégradé croissant qui faisait confondre cette marque avec celle de HarmoHub');

        // --- La marque reste à distance du bord : LE retour utilisateur -------------------------
        /** Boîte englobante des points d'un tracé. Les points de contrôle des Q/C y sont comptés
         *  comme des points : ils enferment la courbe, donc la boîte obtenue est au pire trop
         *  large — jamais trop étroite. Une marge mesurée dessus est donc une marge garantie. */
        const pointsDuChemin = (d) => {
            const pts = [];
            let x = 0, y = 0;
            for (const jeton of d.match(/[MLHVCQZ][^MLHVCQZ]*/gi) || []) {
                const cmd = jeton[0].toUpperCase();
                const n = (jeton.slice(1).match(/-?\d*\.?\d+/g) || []).map(Number);
                if (cmd === 'Z') continue;
                if (cmd === 'H') { for (const v of n) { x = v; pts.push([x, y]); } continue; }
                if (cmd === 'V') { for (const v of n) { y = v; pts.push([x, y]); } continue; }
                for (let i = 0; i + 1 < n.length; i += 2) { x = n[i]; y = n[i + 1]; pts.push([x, y]); }
            }
            return pts;
        };
        // Les cordes portent un stroke de 2 : leur encre dépasse leur tracé d'un pixel de chaque
        // côté, capuchons ronds compris. On gonfle donc la boîte d'autant.
        const demiTrait = Number(favicon.match(/<g mask="[^"]+"[^>]*stroke-width="([\d.]+)"/)?.[1] ?? 0) / 2;
        exiger(demiTrait > 0, 'préalable : on a bien lu l\'épaisseur de trait des cordes, pour gonfler leur boîte d\'encre');
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const d of encreFavicon) {
            // Seules les cordes sont au trait ; les lettres sont pleines (fill) et ne se gonflent pas.
            const estCorde = /^M[\d.]+ [\d.]+H[\d.]+$/.test(d.trim());
            const g = estCorde ? demiTrait : 0;
            for (const [px, py] of pointsDuChemin(d)) {
                x0 = Math.min(x0, px - g); x1 = Math.max(x1, px + g);
                y0 = Math.min(y0, py - g); y1 = Math.max(y1, py + g);
            }
        }
        const COTE = 48;
        check(x0 >= 8 - 0.01 && COTE - x1 >= 8 - 0.01,
            `l'encre laisse au moins 8 px de marge sur les flancs du carré (mesuré : ${x0.toFixed(2)} à gauche, ${(COTE - x1).toFixed(2)} à droite)`);
        check(y0 >= 9 - 0.01 && COTE - y1 >= 9 - 0.01,
            `et au moins 9 px en haut et en bas (mesuré : ${y0.toFixed(2)} et ${(COTE - y1).toFixed(2)}) — l'ancienne marque descendait à 4 px du bord bas, d'où l'effet « pas pro »`);

        check(true, 'toutes les vérifications ci-dessus se sont exécutées sans exception (lecture disque seule, aucun navigateur nécessaire)');
    } catch (e) {
        check(false, 'le banc s\'est arrêté sur une exception au lieu d\'aller au bout — ' + e.message);
    }
    bilan();
})();
