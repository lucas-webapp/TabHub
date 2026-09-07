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
// 230px, PAS 390 : depuis que Tempo et Métronome ont quitté cette barre pour la barre d'outils
// (retour utilisateur, voir ui/toolbar.js), .transport (Lecture/Stop, position, Mesures/ligne) ne
// déborde plus sur AUCUN téléphone réel — mesuré, elle tient jusqu'à 280px de large. Ce banc force
// donc un viewport bien plus étroit qu'aucun appareil existant pour continuer à éprouver le FILET
// lui-même (les flèches, si jamais ce mécanisme redevenait nécessaire), pas un cas qui se présentera
// un jour tel quel — même logique que le filet « écran anormalement court » de tactile_test.js.
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('barre de transport : défilement');

(async () => {
    plan(8);
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 230, height: 844 }, hasTouch: true, isMobile: true });
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
        exiger(avant.deborde, 'à 230px (délibérément plus étroit qu\'aucun téléphone réel), la barre de transport déborde bien — condition du reste de ce banc');
        check(avant.gaucheInvisible === true, 'tout à gauche au départ : la flèche GAUCHE est invisible');
        check(avant.droiteInvisible === false, 'et la flèche DROITE se montre (Mesures/ligne reste à atteindre)');

        // --- Le bouton « Mesures par ligne » replié, hors champ au départ, doit rester ATTEIGNABLE ---
        const boutonVisible = id => page.evaluate(id => {
            const r = document.getElementById(id).getBoundingClientRect();
            return r.x >= 0 && r.x + r.width <= window.innerWidth;
        }, id);
        exiger(!(await boutonVisible('btn-mesures-ligne-bascule')), 'Mesures/ligne commence bien hors champ — condition du test suivant');
        // Playwright fait défiler lui-même l'élément visé avant de cliquer : un clic qui RÉUSSIT ici
        // prouve que le bouton est vraiment atteignable, pas seulement présent dans le DOM.
        await page.click('#btn-mesures-ligne-bascule');
        check(await page.evaluate(() => document.getElementById('btn-mesures-ligne-bascule').getAttribute('aria-expanded') === 'true'),
            'un clic Playwright (qui défile lui-même jusqu\'à la cible) atteint bien Mesures/ligne et l\'ouvre');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);

        // --- Sur un GRAND écran, rien ne déborde : les deux flèches restent invisibles --------------
        await page.setViewportSize({ width: 1400, height: 900 });
        await page.waitForTimeout(150);
        const large = await etat();
        check(!large.deborde, 'sur un écran large, la barre de transport ne déborde pas');
        check(large.gaucheInvisible && large.droiteInvisible, 'et les deux flèches restent invisibles — rien à défiler');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
