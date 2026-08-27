// Banc des FLÈCHES DE DÉFILEMENT de la barre d'outils — et de la molette qui défile à l'horizontale.
//
// CE QU'IL PROTÈGE. Retour direct : « les boutons de la barre d'outils dépassent à droite de l'écran
// (sur ordinateur et sur téléphone). A corriger. » La barre (#barre-outils) débordait déjà avec
// `overflow-x: auto` AVANT ce correctif — ce n'était donc pas une largeur mal calculée (voir
// coherence_largeur_test.js pour ce genre de bug, déjà réglé ailleurs) mais une pure DÉCOUVRABILITÉ :
// rien ne montrait qu'il y avait plus à voir, et une souris ordinaire ne molette que verticalement.
// Deux flèches collantes (voir ui/toolbar.js#flecheDefilement) + un relais molette verticale ->
// horizontale règlent ça :
//   • les flèches ne se montrent que s'il reste RÉELLEMENT quelque chose à atteindre de leur côté ;
//   • un clic sur une flèche fait défiler la barre dans le bon sens ;
//   • une molette verticale franche fait défiler la barre à l'horizontale (un geste déjà horizontal,
//     pavé tactile compris, reste intouché — voir la condition |deltaY| <= |deltaX| dans le code).

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('barre d\'outils : défilement');

(async () => {
    plan(9);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        const etat = () => page.evaluate(() => {
            const hote = document.getElementById('barre-outils');
            return {
                deborde: hote.scrollWidth > hote.clientWidth + 1,
                scrollLeft: hote.scrollLeft,
                gaucheInvisible: hote.querySelector('.fleche-outils-gauche').classList.contains('invisible'),
                droiteInvisible: hote.querySelector('.fleche-outils-droite').classList.contains('invisible'),
            };
        });

        const avant = await etat();
        exiger(avant.deborde, 'à la largeur d\'essai, la barre déborde bien — condition du reste de ce banc');
        check(avant.gaucheInvisible === true, 'tout à gauche au départ : la flèche GAUCHE est invisible (rien à atteindre de ce côté)');
        check(avant.droiteInvisible === false, 'et la flèche DROITE, elle, se montre (il reste du contenu à droite)');

        // --- Un clic sur la flèche droite fait défiler la barre ------------------------------------
        await page.click('.fleche-outils-droite');
        await page.waitForTimeout(400); // scrollBy({ behavior: 'smooth' })
        const apresClic = await etat();
        check(apresClic.scrollLeft > avant.scrollLeft, 'un clic sur la flèche droite avance bien le défilement');

        // --- Aller jusqu'au bout : la flèche droite s'efface, la gauche apparaît -------------------
        await page.evaluate(() => { const h = document.getElementById('barre-outils'); h.scrollLeft = h.scrollWidth; });
        await page.waitForTimeout(100);
        const auBout = await etat();
        check(auBout.droiteInvisible === true, 'tout à droite : la flèche DROITE s\'efface (plus rien à atteindre de ce côté)');
        check(auBout.gaucheInvisible === false, 'et la flèche GAUCHE apparaît (il y a de nouveau quelque chose à atteindre en arrière)');

        // --- La flèche gauche ramène vers le début -------------------------------------------------
        await page.click('.fleche-outils-gauche');
        await page.waitForTimeout(400);
        const apresGauche = await etat();
        check(apresGauche.scrollLeft < auBout.scrollLeft, 'un clic sur la flèche gauche recule bien le défilement');

        // --- Molette verticale franche -> défilement HORIZONTAL de la barre ------------------------
        await page.evaluate(() => { document.getElementById('barre-outils').scrollLeft = 0; });
        const box = await page.evaluate(() => {
            const r = document.getElementById('barre-outils').getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        await page.mouse.move(box.x, box.y);
        await page.mouse.wheel(0, 200); // deltaY franc, deltaX nul
        await page.waitForTimeout(150);
        const apresMolette = await page.evaluate(() => document.getElementById('barre-outils').scrollLeft);
        check(apresMolette > 0, 'une molette verticale franche fait défiler la barre à l\'HORIZONTALE (le relais, sans quoi une molette ordinaire n\'y ferait rien)');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
