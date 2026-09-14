// Banc des FLÈCHES DE DÉFILEMENT de la barre de transport (bas de l'écran).
//
// CE QU'IL PROTÈGE. Trouvé pendant un audit de la position des boutons, pas signalé directement :
// .transport pouvait déborder sur un téléphone étroit — le bouton « Mesures par ligne » replié (voir
// mesures_par_ligne_popover_test.js) tombant alors partiellement hors champ, en bout de barre.
// `overflow-x: auto` (voir style.css) le rend déjà ATTEIGNABLE par un défilement, mais rien ne le
// montrait — exactement le défaut déjà réparé une fois pour la barre d'outils (voir
// barre_outils_test.js), jamais étendu ici. Même remède, littéralement le même code (voir
// main.js#brancherFlechesTransport, qui reprend ui/toolbar.js#flecheOutilsSvg) : deux flèches
// collantes, cachées d'elles-mêmes quand il n'y a rien à atteindre de leur côté.
//
// 300px, ET LE SEUIL A BOUGÉ DEUX FOIS — chaque fois pour une raison différente, qu'il vaut la peine
// de garder écrite puisque le prochain changement de cette barre le déplacera encore.
//
//   1. À l'origine 390px : la barre portait Lecture/Stop, Tempo ET Métronome, et débordait sur un
//      téléphone ordinaire.
//   2. Puis 230px : Tempo et Métronome étaient partis dans la barre d'outils, et il fallait un
//      viewport plus étroit qu'aucun appareil réel pour éprouver encore le filet.
//   3. Puis 200px : les flèches, `sticky` donc EN FLUX, ajoutaient chacune ses 26px à `scrollWidth`
//      — le test de débordement se mesurait lui-même, et à 230px c'étaient ces 26px SEULS qui
//      débordaient. Corrigé (voir ui/toolbar.js#ajusterFleches), le contenu tombait à 218px utiles.
//   4. Aujourd'hui 300px : les cinq commandes de lecture sont revenues ici, réunies dans un bloc
//      encadré (voir #bloc-lecture dans index.html, et le retour utilisateur qu'il cite). Le contenu
//      utile pèse 313px. Mesuré largeur par largeur : la barre déborde jusqu'à 310px et tient à
//      partir de 315px.
//
// 300px reste plus étroit que tout téléphone en service (l'iPhone SE, le plus petit, fait 320px) :
// ce banc éprouve le FILET, pas un cas qu'on rencontrera — même logique que le filet « écran
// anormalement court » de tactile_test.js. Et il garantit en fin de course qu'à 320px, lui, tout
// tient sans rien à faire défiler.
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('barre de transport : défilement');

(async () => {
    plan(9);
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 300, height: 844 }, hasTouch: true, isMobile: true });
    try {
        const etat = () => page.evaluate(() => {
            const t = document.querySelector('.transport');
            const g = t.querySelector('.fleche-outils-gauche');
            const d = t.querySelector('.fleche-outils-droite');
            return {
                deborde: t.scrollWidth > t.clientWidth + 1,
                gaucheInvisible: g.classList.contains('invisible'),
                droiteInvisible: d.classList.contains('invisible'),
            };
        });

        const avant = await etat();
        exiger(avant.deborde, 'à 300px (plus étroit que tout téléphone en service), la barre de transport déborde bien — condition du reste de ce banc');
        check(avant.gaucheInvisible === true, 'tout à gauche au départ : la flèche GAUCHE est invisible');
        check(avant.droiteInvisible === false, 'et la flèche DROITE se montre (Mesures/ligne reste à atteindre)');

        // --- Le bouton « Mesures par ligne » replié, hors champ au départ, doit rester ATTEIGNABLE ---
        const boutonVisible = id => page.evaluate(id => {
            const r = document.getElementById(id).getBoundingClientRect();
            return r.x >= 0 && r.x + r.width <= window.innerWidth;
        }, id);
        // ATTEIGNABLE, qu'il soit déjà dans le champ ou non — et non plus « hors champ au départ ».
        // Cette condition-là a cessé d'être vraie, et c'est un progrès : les flèches masquées ne
        // gardent plus leur largeur (voir style.css, .fleche-outils.invisible), si bien que les 26px
        // rendus par la flèche gauche suffisent, à 230px, à ramener Mesures/ligne dans l'écran. Exiger
        // qu'il en soit absent reviendrait à exiger que ce gain soit annulé.
        //
        // Playwright fait défiler lui-même l'élément visé avant de cliquer : un clic qui RÉUSSIT
        // prouve donc que le bouton est vraiment atteignable, dans le champ ou après défilement —
        // c'est bien cela, et non sa position de départ, que ce banc a à garantir.
        await page.click('#btn-mesures-ligne-bascule');
        check(await page.evaluate(() => document.getElementById('btn-mesures-ligne-bascule').getAttribute('aria-expanded') === 'true'),
            'un clic Playwright (qui défile lui-même jusqu\'à la cible) atteint bien Mesures/ligne et l\'ouvre');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);

        // --- ET À 320px, LE PLUS PETIT TÉLÉPHONE EN SERVICE, PLUS RIEN À ATTEINDRE -------------------
        // La garantie qui compte vraiment pour un utilisateur : sur l'appareil le plus étroit qu'on
        // puisse encore avoir en main (iPhone SE, 320px), la barre du bas tient tout entière et les
        // deux flèches s'éteignent — aucune commande de lecture à aller chercher par un défilement.
        //
        // ELLE ÉPROUVE AUSSI LE CORRECTIF DES FLÈCHES, et c'est pour cela qu'elle vient d'un état où
        // une flèche est ALLUMÉE (la section 300px ci-dessus) et non du grand écran : à 1400px les
        // deux flèches sont déjà éteintes, donc aucune n'ajoute ses 26px à `scrollWidth`, donc
        // l'élargissement ne révélerait rien — la vérification passerait correctif retiré (constaté
        // en le neutralisant). Ici, correctif retiré, la barre annonce 26px de trop et rallume sa
        // flèche droite sur ses propres pixels.
        await page.setViewportSize({ width: 320, height: 844 });
        await page.waitForTimeout(200);
        const etroit = await etat();
        check(!etroit.deborde && etroit.gaucheInvisible && etroit.droiteInvisible,
            'à 320px — le plus petit téléphone en service — la barre tient tout entière et les deux flèches s\'éteignent');

        // --- Sur un GRAND écran, rien ne déborde : les deux flèches restent invisibles --------------
        await page.setViewportSize({ width: 1400, height: 900 });
        await page.waitForTimeout(150);
        const large = await etat();
        check(!large.deborde, 'sur un écran large, la barre de transport ne déborde pas');
        check(large.gaucheInvisible && large.droiteInvisible, 'et les deux flèches restent invisibles — rien à défiler');
        // CE QUI PRÉCÈDE N'EST PAS ACQUIS D'AVANCE : les flèches ne se rafraîchissaient QUE sur un
        // évènement `scroll`, jamais au redimensionnement. Élargir la fenêtre jusqu'à ce que la barre
        // cesse de déborder laissait donc allumée une flèche « défiler à droite » sans rien à faire
        // défiler. Le banc ne le voyait pas : le clic ci-dessus provoquait un défilement qui corrigeait
        // l'affichage au passage. Corrigé dans main.js (le gestionnaire de `resize` les rafraîchit) —
        // et vérifié ici SANS qu'aucun défilement n'intervienne entre-temps.
        check((await page.evaluate(() => {
            const t = document.querySelector('.transport');
            return Math.round(t.querySelector('.fleche-outils-droite').getBoundingClientRect().width);
        })) === 0, 'et une flèche masquée n\'occupe plus aucune largeur dans la barre');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
