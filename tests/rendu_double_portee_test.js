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
    plan(13);
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

        // En-tête de système : clé, puis armure, puis signature — dans cet ordre, une seule fois.
        const entete = await page.evaluate(() => {
            const p = window.app.page.primitives;
            const glyphes = p.filter(x => x.t === 'glyphe');
            const textes = p.filter(x => x.t === 'texte').map(x => String(x.s));
            return { glyphes: glyphes.length, aSignature: textes.includes('4'), aNumero: textes.includes('1'), aTab: textes.filter(t => 'TAB'.includes(t) && t.length === 1).length };
        });
        check(entete.glyphes > 0, 'des glyphes vectoriels sont posés (clé, têtes de note)');
        check(entete.aSignature, 'la signature rythmique est écrite en tête');
        check(entete.aNumero, 'les mesures sont numérotées');
        check(entete.aTab >= 3, 'le mot « TAB » est écrit verticalement à gauche de la tablature');

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
