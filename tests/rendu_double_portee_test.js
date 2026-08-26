// Banc du RENDU : la portée solfège et la tablature doivent montrer la MÊME musique, alignée.
//
// Il n'éprouve pas l'aspect (aucun banc ne sait dire si une clé est belle) mais les invariants
// STRUCTURELS que le moteur de gravure doit tenir : présence des deux portées, alignement vertical
// strict des deux systèmes, apparition de la clé/armure/signature au bon endroit, et découpage en
// systèmes quand la fenêtre rétrécit.

const creerHarnais = require('./_harness.js');
const { ouvrirApp, taper } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('rendu double portée');

(async () => {
    plan(16);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        const svg = await page.$('#feuille svg');
        exiger(!!svg, 'la partition est rendue en SVG');

        // Une tablature de guitare : 5 lignes de portée + 6 lignes de cordes, sur la pleine largeur.
        const lignes = await page.evaluate(() => {
            const sys = window.app.page.ancrages.systemes[0];
            const geo = window.app.page.geo;
            const horiz = window.app.page.primitives.filter(p => p.t === 'ligne' && Math.abs(p.y1 - p.y2) < 0.01 && (p.x2 - p.x1) > 200);
            return {
                portee: horiz.filter(p => p.y1 >= sys.yPortee - 0.1 && p.y1 <= sys.yPortee + 4 * geo.S + 0.1).length,
                tab: horiz.filter(p => p.y1 >= sys.yTab - 0.1 && p.y1 <= sys.yTab + sys.hauteurTab + 0.1).length,
                ecartPortee: geo.S, ecartTab: geo.ST,
            };
        });
        check(lignes.portee === 5, 'la portée solfège a cinq lignes');
        check(lignes.tab === 6, 'la tablature de guitare a six lignes');
        check(lignes.ecartTab > lignes.ecartPortee, 'la tablature est plus espacée que la portée : il y faut deux chiffres');

        // Alignement : chaque évènement occupe la MÊME abscisse sur les deux portées. C'est
        // l'invariant qui fait que les deux se lisent ensemble ; il découle du fait qu'une seule mise
        // en page les produit toutes les deux.
        await page.click('[data-action="duree8"]');
        await taper(page, ['Digit0', 'ArrowRight', 'Digit3', 'ArrowRight', 'Digit5', 'ArrowRight', 'Digit7']);
        const aligne = await page.evaluate(() => {
            const a = window.app.page.ancrages.evenements;
            return a.every(x => Number.isFinite(x.x) && x.yTab > x.yPortee) && a.length >= 4;
        });
        check(aligne, 'chaque évènement porte une seule abscisse, valable pour la portée comme pour la TAB');

        // EN-TÊTE DE SYSTÈME, ET PROVENANCE DES SIGNES. On ne se contente pas de compter des formes :
        // on vérifie que les chemins posés sont EXACTEMENT ceux extraits de Bravura. C'est ce qui
        // distingue une partition gravée d'une approximation dessinée à la main — et une version
        // antérieure de TabHub dessinait bel et bien ses propres clés, avec une clé de sol qui
        // ressemblait à une esperluette. Le banc rendrait cette régression immédiatement visible.
        const entete = await page.evaluate(async () => {
            const G = await import('/src/engine/glyphs.js');
            const { GLYPHES_BRAVURA } = await import('/src/engine/glyphes-bravura.js');
            const glyphes = window.app.page.primitives.filter(x => x.t === 'glyphe');
            const poses = new Set(glyphes.flatMap(x => x.traits.map(t => t.d)));
            const officiels = new Set(Object.values(GLYPHES_BRAVURA).map(g => g.d));
            const textes = window.app.page.primitives.filter(x => x.t === 'texte').map(x => String(x.s));
            return {
                nb: glyphes.length,
                cleSol8vb: poses.has(G.CLE_SOL_8VB[0].d),
                cleTab: poses.has(G.CLE_TAB_6[0].d),
                chiffre4: poses.has(G.CHIFFRES[4][0].d),
                teteNoire: poses.has(G.TETE_NOIRE[0].d),
                horsBravura: [...poses].filter(d => !officiels.has(d)).length,
                aNumero: textes.includes('1'),
            };
        });
        check(entete.nb > 0, 'des glyphes vectoriels sont posés');
        check(entete.horsBravura === 0, 'TOUS proviennent de l\'extraction Bravura — aucun dessin approximatif');
        check(entete.cleSol8vb, 'la clé de sol est celle de Bravura, avec son 8 d\'octave intégré');
        check(entete.cleTab, 'la clé de tablature est le glyphe SMuFL officiel, pas trois lettres empilées');
        check(entete.chiffre4, 'la signature rythmique emploie les chiffres musicaux, pas une police de texte');
        check(entete.teteNoire, 'les têtes de note aussi');
        check(entete.aNumero, 'les mesures sont numérotées');

        // Le chiffre de frette doit INTERROMPRE sa ligne de corde : un « 0 » barré se lit « ø ».
        const masques = await page.evaluate(() => window.app.page.primitives.filter(p => p.t === 'rect' && p.couleur === 'papier').length);
        check(masques >= 4, 'chaque chiffre de case masque la ligne de corde qui le traverse');

        // Découpage en systèmes : réduire la fenêtre doit produire PLUS de systèmes, jamais un
        // débordement horizontal.
        await page.evaluate(() => {
            const m = window.app.editeur;
            for (let i = 0; i < 14; i++) m.ajouterMesure();
        });
        await page.waitForTimeout(200);
        const large = await page.evaluate(() => ({ sys: window.app.page.ancrages.systemes.length, larg: window.app.page.largeur }));
        await page.setViewportSize({ width: 700, height: 880 });
        await page.waitForTimeout(400);
        const etroit = await page.evaluate(() => ({ sys: window.app.page.ancrages.systemes.length, larg: window.app.page.largeur }));
        check(etroit.larg < large.larg, 'la partition se remet en page quand la fenêtre rétrécit');
        check(etroit.sys >= large.sys, 'et se découpe en autant ou plus de systèmes');
        const debordement = await page.evaluate(() => {
            const z = document.getElementById('zone-partition');
            return z.scrollWidth - z.clientWidth;
        });
        check(debordement <= 2, 'aucun débordement horizontal : les systèmes tiennent dans la largeur');

        check(erreurs.length === 0, 'aucune erreur JavaScript pendant le rendu' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
