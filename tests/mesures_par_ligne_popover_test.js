// Banc du POPOVER « MESURES PAR LIGNE » (barre de transport) — même remède que le popover Effets
// (voir effets_popover_test.js) appliqué à un second groupe de boutons, pour la même raison.
//
// CE QU'IL PROTÈGE. Retour utilisateur (capture à l'appui) : « la barre de transport est trop
// tassée ». Cette rangée porte déjà Lecture/Stop, Tempo, TAP et Métronome — les six boutons toujours
// visibles de « Mesures par ligne » (voir mesures_par_ligne_test.js pour le CONTRÔLE lui-même,
// éprouvé là séparément) pesaient plus qu'aucun autre groupe de la barre. Ce banc éprouve :
//   • RIEN NE CHANGE sur grand écran : le bouton popover reste invisible, les six boutons s'affichent
//     en ligne exactement comme avant (voir main.js#construireBoutonsMesuresLigne) ;
//   • sur un écran étroit (@media max-width: 720px, voir style.css), c'est l'inverse : le groupe est
//     replié par défaut, le bouton popover est seul visible — et montre lui-même la valeur active
//     (« Auto », un chiffre…), jamais un libellé figé, pour que l'état reste lisible popover fermé ;
//   • l'ouvrir montre les SIX boutons, toujours un rang cliquable d'un geste — jamais un menu
//     déroulant caché derrière ce bouton (contrainte de conception explicite, voir index.html) — dans
//     un panneau `position: fixed` qui ne déborde pas l'écran ;
//   • CAS PARTICULIER trouvé en écrivant ce correctif, propre à CE popover : son bouton vit tout en
//     bas de l'écran (barre de transport), contrairement à Fichiers ou Effets qui ont de la place en
//     dessous — le panneau doit alors s'ouvrir AU-DESSUS du bouton plutôt que de le chevaucher (voir
//     main.js#_positionnerPanneau, la branche « manque de place en dessous ») : un bouton recouvert
//     par son propre popover serait à la fois illisible et impossible à retoucher pour refermer ;
//   • choisir une valeur l'applique VRAIMENT (même chemin que le rang de boutons en ligne), la
//     persiste en local, met à jour le bouton replié, ET referme le popover derrière elle ;
//   • le popover se referme au clic ailleurs, à Échap, ou en rappuyant sur le bouton lui-même.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('popover Mesures par ligne');

(async () => {
    plan(22);

    // --- Grand écran (par défaut, 1320×880) : aucun changement de comportement ------------------------
    {
        const { page, erreurs, fermer } = await ouvrirApp();
        try {
            check(!(await page.locator('#btn-mesures-ligne-bascule').isVisible()), 'sur grand écran, le bouton popover reste invisible');
            check(await page.locator('.btn-mesures-ligne').first().isVisible(), 'et les six boutons s\'affichent toujours en ligne, comme avant cette fonctionnalité');
            check(erreurs.length === 0, 'aucune erreur JavaScript (grand écran)');
        } finally { await fermer(); }
    }

    // --- Téléphone (390×844, tactile) : le popover prend le relais ------------------------------------
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    try {
        exiger(await page.locator('#btn-mesures-ligne-bascule').isVisible(), 'sur téléphone, le bouton popover apparaît');
        check(!(await page.locator('.btn-mesures-ligne').first().isVisible()), 'et les six boutons, eux, sont repliés (invisibles tant que le popover n\'est pas ouvert)');
        check((await page.textContent('#btn-mesures-ligne-bascule')).trim() === 'Auto',
            'le bouton replié montre déjà la valeur active (« Auto » par défaut) — pas besoin d\'ouvrir pour la connaître');

        // --- Ouvrir le popover ------------------------------------------------------------------------
        await page.click('#btn-mesures-ligne-bascule');
        await page.waitForTimeout(100);
        exiger(await page.locator('.btn-mesures-ligne').first().isVisible(), 'un clic ouvre le popover : les boutons redeviennent visibles');
        const textesBoutons = await page.locator('#groupe-mesures-ligne .btn-mesures-ligne').allTextContents();
        check(textesBoutons.join(',') === 'Auto,2,3,4,6,8', 'les SIX mêmes valeurs qu\'en ligne, toujours un rang de boutons — jamais un menu déroulant');
        check(await page.locator('#btn-mesures-ligne-bascule').getAttribute('aria-expanded') === 'true', 'aria-expanded reflète l\'ouverture, pour un lecteur d\'écran');

        const boites = await page.evaluate(() => {
            const p = document.getElementById('groupe-mesures-ligne').getBoundingClientRect();
            const b = document.getElementById('btn-mesures-ligne-bascule').getBoundingClientRect();
            return { panneau: { left: p.left, top: p.top, right: p.right, bottom: p.bottom }, bouton: { top: b.top, bottom: b.bottom } };
        });
        check(boites.panneau.left >= 0 && boites.panneau.top >= 0 && boites.panneau.right <= 390 && boites.panneau.bottom <= 844,
            'le panneau reste entièrement DANS l\'écran (jamais à moitié hors champ, même près d\'un bord)');
        // CAS PARTICULIER de ce popover (voir l'en-tête du banc) : le bouton vit tout en bas de
        // l'écran, sans place en dessous — le panneau doit se replier AU-DESSUS plutôt que de
        // chevaucher le bouton qui l'a ouvert (sans quoi le rappuyer pour refermer serait impossible).
        check(boites.panneau.bottom <= boites.bouton.top + 1,
            'et s\'ouvre AU-DESSUS du bouton (pas assez de place en dessous, tout en bas de l\'écran) — sans le chevaucher');

        // --- Choisir une valeur : appliquée pour de vrai, ET le popover se referme tout seul ----------
        const avant = await page.evaluate(() => window.app.mesuresParLigne);
        await page.locator('#groupe-mesures-ligne .btn-mesures-ligne', { hasText: '4' }).click();
        await page.waitForTimeout(100);
        const apres = await page.evaluate(() => ({
            mesuresParLigne: window.app.mesuresParLigne,
            stocke: localStorage.getItem('tabhub.mesuresParLigne'),
        }));
        check(avant !== 4 && apres.mesuresParLigne === 4, 'choisir « 4 » dans le popover l\'applique VRAIMENT (même chemin que le rang de boutons en ligne)');
        check(apres.stocke === '4', 'et la persiste en local, exactement comme depuis le rang en ligne');
        check(!(await page.locator('.btn-mesures-ligne').first().isVisible()), 'referme le popover derrière lui — pas besoin de le fermer à la main après chaque choix');
        check(await page.locator('#btn-mesures-ligne-bascule').getAttribute('aria-expanded') === 'false', 'aria-expanded retombe à false à la fermeture');
        check((await page.textContent('#btn-mesures-ligne-bascule')).trim() === '4', 'et le bouton replié affiche désormais « 4 » — l\'état reste lisible sans rouvrir');

        // --- Rouvrir / refermer en rappuyant sur le bouton lui-même -------------------------------------
        // C'EST le geste qui échouait avant le correctif de positionnement ci-dessus (le popover,
        // rabattu vers le haut par le simple bornage à l'écran, chevauchait le bouton et interceptait
        // le second tap) : ce test échouerait par expiration de délai si la régression revenait.
        await page.click('#btn-mesures-ligne-bascule');
        await page.waitForTimeout(100);
        exiger(await page.locator('.btn-mesures-ligne').first().isVisible(), 'rouvre bien le popover');
        await page.click('#btn-mesures-ligne-bascule');
        await page.waitForTimeout(100);
        check(!(await page.locator('.btn-mesures-ligne').first().isVisible()), 'rappuyer sur le bouton pendant qu\'il est ouvert le referme (une vraie BASCULE, pas seulement une ouverture)');

        // --- Clic ailleurs sur la page : referme aussi -------------------------------------------------
        await page.click('#btn-mesures-ligne-bascule');
        await page.waitForTimeout(100);
        await page.click('#zone-partition', { position: { x: 10, y: 10 } });
        await page.waitForTimeout(100);
        check(!(await page.locator('.btn-mesures-ligne').first().isVisible()), 'un clic ailleurs sur la page referme le popover');

        // --- Échap : referme aussi -----------------------------------------------------------------------
        await page.click('#btn-mesures-ligne-bascule');
        await page.waitForTimeout(100);
        exiger(await page.locator('.btn-mesures-ligne').first().isVisible(), 'préalable : rouvert avant le test Échap');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
        check(!(await page.locator('.btn-mesures-ligne').first().isVisible()), 'Échap referme aussi le popover');

        check(erreurs.length === 0, 'aucune erreur JavaScript (téléphone)' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
