// Banc du POPOVER « EFFETS » — regrouper les neuf boutons de geste (hammer-on, pull-off, slide,
// liaison, bend, palm mute, note fantôme, accent, staccato) derrière un seul bouton, À TOUTES LES
// LARGEURS D'ÉCRAN.
//
// CE QU'IL PROTÈGE. Retour utilisateur : « Sur téléphone, limiter le nombre de boutons — par
// exemple un bouton « effets » qui ouvre un popover pour me montrer les effets possibles. » La barre
// d'outils défilait déjà horizontalement (voir barre_outils_test.js), mais rien n'y réduisait le
// nombre de boutons SIMULTANÉMENT visibles — neuf gestes touchés une fois de temps en temps pesaient
// aussi lourd que les figures de durée, touchées à chaque note. Ce banc éprouve :
//   • LE MÊME COMPORTEMENT PARTOUT : le groupe est replié par défaut, le bouton popover seul visible.
//     Le repli n'a d'abord existé que sur téléphone (@media max-width: 720px) ; un second retour l'a
//     étendu à l'ordinateur (« pour gagner de la place lorsque j'ai la barre d'outils en haut :
//     rassembler tous les effets dans un bouton »), où la barre débordait tout autant. Ce banc éprouve
//     donc les DEUX largeurs de la même manière — et c'est l'écart entre elles qu'il interdit
//     désormais, là où il exigeait auparavant qu'il existe ;
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
    plan(25);

    // --- Grand écran (par défaut, 1320×880) : aucun changement de comportement ------------------------
    {
        const { page, erreurs, fermer } = await ouvrirApp();
        try {
            exiger(await page.locator('.btn-effets-bascule').isVisible(),
                'sur grand écran AUSSI, le bouton « Effets » est là — le repli ne se limite plus au téléphone');
            check(!(await page.locator('[data-action="accent"]').isVisible()),
                'et les neuf boutons de geste ne s\'affichent plus en ligne : c\'est la place qu\'on voulait gagner');
            // Et il s'ouvre vraiment ici aussi : le positionnement se mesure au clic (position: fixed,
            // voir ui/toolbar.js#basculerGroupeEffets), il n'a jamais rien dû à la largeur de l'écran.
            await page.click('.btn-effets-bascule');
            await page.waitForTimeout(250);
            const deplie = await page.evaluate(() => {
                const g = document.querySelector('.groupe-outils[data-groupe="effet"]');
                const r = g.getBoundingClientRect();
                return { visible: r.width > 0 && r.height > 0, nb: g.querySelectorAll('.btn-outil').length,
                         dansLEcran: r.left >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1 };
            });
            check(deplie.visible && deplie.nb === 9 && deplie.dansLEcran,
                'un clic déplie les neuf effets dans un panneau qui tient entièrement dans la fenêtre');
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

        // --- CHAQUE BOUTON REPLIÉ DANS SON CADRE ----------------------------------------------------
        // Retour utilisateur : « le bouton "Effets" doit être inclus dans l'encadrement d'ajout de
        // notes. Pour le moment il est à part. De la même façon, le bouton "Repères" doit être inclus
        // dans l'encadrement des modifications de la portée et armure. »
        //
        // Les deux vivaient ENTRE les cadres, seuls au milieu — lisibles comme deux outils sans
        // famille, alors que chacun en a une. Depuis que les cadres ont remplacé les titres de
        // section, « entre deux » a cessé d'être une position neutre : elle dit « n'appartient à
        // rien ». On vérifie l'appartenance par le DOM (`closest`), pas par une coordonnée : c'est
        // l'appartenance elle-même qui est demandée, pas un alignement à quelques pixels.
        const cadres = await page.evaluate(() => ({
            effets: document.querySelector('.btn-effets-bascule')?.closest('.groupe-outils')?.dataset.groupe,
            reperes: document.querySelector('.btn-reperes-bascule')?.closest('.groupe-outils')?.dataset.groupe,
            orphelins: [...document.querySelectorAll('#barre-outils .btn-groupe-replie')]
                .filter(b => !b.closest('.groupe-outils')).length,
        }));
        check(cadres.effets === 'duree',
            `« Effets » vit dans le cadre où l'on choisit ce qu'on écrit (${cadres.effets}), plus entre deux cadres`);
        check(cadres.reperes === 'ecriture',
            `« Repères » vit dans le cadre de la portée et de l'armure (${cadres.reperes})`);
        check(cadres.orphelins === 0, 'et plus aucun bouton replié ne flotte hors cadre');

        // LE POPOVER, LUI, N'A PAS BOUGÉ : il est mesuré au clic depuis le bouton et posé en
        // `position: fixed` — changer le cadre qui héberge le bouton ne devait donc rien y changer,
        // et c'est ce qu'on vérifie plutôt que de le supposer.
        // 11 pour « repere » depuis que le RYTHME TERNAIRE y a rejoint les reprises, les barres et les
        // repères de navigation : comme eux, c'est une indication qui MARQUE la portée et se lit en
        // tête de partition (voir edit/raccourcis.js, action `ternaire`).
        // « repere » en porte DOUZE depuis que les maisons de 1re/2e fois l'ont rejoint (voir
        // maisons_test.js) : c'est là que vivent les barres de reprise, et c'est avec elles que les
        // maisons font sens.
        // TREIZE depuis la LEVÉE : elle ne marque pas la portée d'un signe à jouer, mais elle décide
        // de la LONGUEUR d'une mesure et de sa numérotation, comme une double barre décide d'une
        // section — même famille, même popover (voir levee_test.js).
        for (const [bouton, groupe, attendu] of [['.btn-effets-bascule', 'effet', 9], ['.btn-reperes-bascule', 'repere', 13]]) {
            await page.click(bouton);
            await page.waitForTimeout(250);
            const etat = await page.evaluate((g) => {
                const el = document.querySelector(`.groupe-outils[data-groupe="${g}"]`);
                const r = el.getBoundingClientRect();
                return { ouvert: el.classList.contains('ouvert'), nb: el.querySelectorAll('.btn-outil').length,
                         dansEcran: r.left >= -1 && r.right <= window.innerWidth + 1 && r.top >= -1 && r.bottom <= window.innerHeight + 1 };
            }, groupe);
            check(etat.ouvert && etat.nb === attendu && etat.dansEcran,
                `le popover « ${groupe} » s'ouvre toujours, ses ${etat.nb} boutons entièrement dans la fenêtre, depuis son nouveau cadre`);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(120);
        }

        check(erreurs.length === 0, 'aucune erreur JavaScript (téléphone)' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
