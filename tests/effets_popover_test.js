// Banc du POPOVER « EFFETS » — regrouper les neuf boutons de geste (hammer-on, pull-off, slide,
// liaison, bend, palm mute, note fantôme, accent, staccato) derrière un seul bouton sur téléphone.
//
// CE QU'IL PROTÈGE. Retour utilisateur : « Sur téléphone, limiter le nombre de boutons — par
// exemple un bouton « effets » qui ouvre un popover pour me montrer les effets possibles. » La barre
// d'outils défilait déjà horizontalement (voir barre_outils_test.js), mais rien n'y réduisait le
// nombre de boutons SIMULTANÉMENT visibles — neuf gestes touchés une fois de temps en temps pesaient
// aussi lourd que les figures de durée, touchées à chaque note. Ce banc éprouve :
//   • RIEN NE CHANGE sur grand écran : le bouton popover reste invisible, le groupe Effets s'affiche
//     en ligne exactement comme avant (voir ui/toolbar.js#construireBarreOutils) ;
//   • sur un écran étroit (@media max-width: 720px, voir style.css), c'est l'inverse : le groupe est
//     replié par défaut, le bouton popover est seul visible ;
//   • l'ouvrir montre les neuf boutons, dans un panneau `position: fixed` qui ne déborde pas l'écran
//     (même mécanisme que le menu contextuel, voir main.js#ouvrirMenuContextuel) ;
//   • choisir un effet l'applique VRAIMENT (même chemin que n'importe quel bouton de la palette) et
//     referme le popover derrière lui — sur un téléphone, revenir le fermer à la main serait lassant ;
//   • le bouton résume l'état actif de son groupe replié (un effet déjà posé sur la note courante se
//     voit sans avoir à rouvrir le popover) ;
//   • le popover se referme au clic ailleurs, à Échap, ou en rappuyant sur le bouton lui-même.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('popover Effets');

(async () => {
    plan(19);

    // --- Grand écran (par défaut, 1320×880) : aucun changement de comportement ------------------------
    {
        const { page, erreurs, fermer } = await ouvrirApp();
        try {
            check(!(await page.locator('.btn-effets-bascule').isVisible()), 'sur grand écran, le bouton popover « Effets » reste invisible');
            check(await page.locator('[data-action="accent"]').isVisible(), 'et les boutons d\'effet s\'affichent toujours en ligne, comme avant cette fonctionnalité');
            check(erreurs.length === 0, 'aucune erreur JavaScript (grand écran)');
        } finally { await fermer(); }
    }

    // --- Téléphone (390×844, tactile) : le popover prend le relais ------------------------------------
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    try {
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 3)])];
            ed.curseur = { mesure: 0, voix: 0, evenement: 0, corde: 0 };
            ed.prevenir('document');
        });
        await page.waitForTimeout(150);

        exiger(await page.locator('.btn-effets-bascule').isVisible(), 'sur téléphone, le bouton popover « Effets » apparaît');
        check(!(await page.locator('[data-action="accent"]').isVisible()), 'et les neuf boutons d\'effet, eux, sont repliés (invisibles tant que le popover n\'est pas ouvert)');

        // --- Ouvrir le popover ------------------------------------------------------------------------
        await page.click('.btn-effets-bascule');
        await page.waitForTimeout(100);
        exiger(await page.locator('[data-action="accent"]').isVisible(), 'un clic sur « Effets » ouvre le popover : les boutons redeviennent visibles');
        check((await page.locator('.groupe-outils[data-groupe="effet"] .btn-outil').count()) === 9, 'les neuf boutons d\'effet s\'y trouvent tous');
        check(await page.locator('.btn-effets-bascule').getAttribute('aria-expanded') === 'true', 'aria-expanded reflète l\'ouverture, pour un lecteur d\'écran');

        const boite = await page.evaluate(() => {
            const r = document.querySelector('.groupe-outils[data-groupe="effet"]').getBoundingClientRect();
            return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        });
        check(boite.left >= 0 && boite.top >= 0 && boite.right <= 390 && boite.bottom <= 844,
            'le panneau reste entièrement DANS l\'écran (jamais à moitié hors champ, même près d\'un bord)');

        // --- Choisir un effet : appliqué pour de vrai, ET le popover se referme tout seul -------------
        // « accent » porte sur l'ÉVÈNEMENT (tout l'accord), pas sur une note individuelle — voir
        // edit/raccourcis.js : `actif: ed => ed.evenementCourant().accent`.
        const accentAvant = await page.evaluate(() => window.app.editeur.mesureCourante().voix[0].evenements[0].accent);
        await page.click('[data-action="accent"]');
        await page.waitForTimeout(100);
        const accentApres = await page.evaluate(() => window.app.editeur.mesureCourante().voix[0].evenements[0].accent);
        check(!accentAvant && accentApres, 'choisir « Accent » dans le popover l\'applique VRAIMENT à la note courante (même chemin que n\'importe quel bouton de la palette)');
        check(!(await page.locator('[data-action="accent"]').isVisible()), 'et referme le popover derrière lui — pas besoin de le fermer à la main après chaque effet');
        check(await page.locator('.btn-effets-bascule').getAttribute('aria-expanded') === 'false', 'aria-expanded retombe à false à la fermeture');

        // --- Le bouton résume l'état actif de son groupe replié -----------------------------------------
        check(await page.locator('.btn-effets-bascule').evaluate(b => b.classList.contains('actif')),
            'le bouton « Effets » se montre lui-même ACTIF quand la note courante porte déjà un effet du groupe — sans avoir à rouvrir le popover pour le savoir');

        // --- Rouvrir / refermer en rappuyant sur le bouton lui-même -------------------------------------
        await page.click('.btn-effets-bascule');
        await page.waitForTimeout(100);
        exiger(await page.locator('[data-action="accent"]').isVisible(), 'rouvre bien le popover');
        await page.click('.btn-effets-bascule');
        await page.waitForTimeout(100);
        check(!(await page.locator('[data-action="accent"]').isVisible()), 'rappuyer sur « Effets » pendant qu\'il est ouvert le referme (une vraie BASCULE, pas seulement une ouverture)');

        // --- Clic ailleurs sur la page : referme aussi -------------------------------------------------
        await page.click('.btn-effets-bascule');
        await page.waitForTimeout(100);
        await page.click('#zone-partition', { position: { x: 10, y: 10 } });
        await page.waitForTimeout(100);
        check(!(await page.locator('[data-action="accent"]').isVisible()), 'un clic ailleurs sur la page referme le popover');

        // --- Échap : referme aussi -----------------------------------------------------------------------
        await page.click('.btn-effets-bascule');
        await page.waitForTimeout(100);
        exiger(await page.locator('[data-action="accent"]').isVisible(), 'préalable : rouvert avant le test Échap');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
        check(!(await page.locator('[data-action="accent"]').isVisible()), 'Échap referme aussi le popover');

        check(erreurs.length === 0, 'aucune erreur JavaScript (téléphone)' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
