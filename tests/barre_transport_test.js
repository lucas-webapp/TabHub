// Banc des FLÈCHES DE DÉFILEMENT de la barre de transport (bas de l'écran).
//
// CE QU'IL PROTÈGE. Trouvé pendant un audit de la position des boutons, pas signalé directement :
// sur un téléphone étroit, .transport (Lecture/Stop, Tempo, Mesures/ligne, Métronome) déborde de
// 180px — les DEUX boutons Métronome tombent entièrement hors champ. `overflow-x: auto` (voir
// style.css) les rendait déjà ATTEIGNABLES par un défilement, mais rien ne le montrait — exactement
// le défaut déjà réparé une fois pour la barre d'outils (voir barre_outils_test.js), jamais étendu
// ici. Même remède, littéralement le même code (voir main.js#brancherFlechesTransport, qui reprend
// ui/toolbar.js#flecheOutilsSvg) : deux flèches collantes, cachées d'elles-mêmes quand il n'y a rien
// à atteindre de leur côté.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('barre de transport : défilement');

(async () => {
    plan(7);
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
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
        exiger(avant.deborde, 'à 390px, la barre de transport déborde bien — condition du reste de ce banc');
        check(avant.gaucheInvisible === true, 'tout à gauche au départ : la flèche GAUCHE est invisible');
        check(avant.droiteInvisible === false, 'et la flèche DROITE se montre (Métronome reste à atteindre)');

        // --- Le bouton Métronome, hors champ au départ, doit rester ATTEIGNABLE ---------------------
        const metronomeVisible = () => page.evaluate(() => {
            const r = document.getElementById('btn-metronome').getBoundingClientRect();
            return r.x >= 0 && r.x + r.width <= window.innerWidth;
        });
        exiger(!(await metronomeVisible()), 'Métronome commence bien hors champ — condition du test suivant');
        // Playwright fait défiler lui-même l'élément visé avant de cliquer : un clic qui RÉUSSIT ici
        // prouve que le bouton est vraiment atteignable, pas seulement présent dans le DOM.
        await page.click('#btn-metronome');
        check(await page.evaluate(() => document.getElementById('btn-metronome').getAttribute('aria-pressed') === 'true'),
            'un clic Playwright (qui défile lui-même jusqu\'à la cible) atteint bien Métronome et l\'active');

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
