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
// 200px, PAS 390 : depuis que Tempo et Métronome ont quitté cette barre pour la barre d'outils
// (retour utilisateur, voir ui/toolbar.js), .transport (Lecture/Stop, position, Mesures/ligne) ne
// déborde plus sur AUCUN téléphone réel. Ce banc force donc un viewport bien plus étroit qu'aucun
// appareil existant pour continuer à éprouver le FILET lui-même (les flèches, si jamais ce mécanisme
// redevenait nécessaire), pas un cas qui se présentera un jour tel quel — même logique que le filet
// « écran anormalement court » de tactile_test.js.
//
// 200 ET NON PLUS 230, et le déplacement du seuil est lui-même un gain, pas un contournement. Les
// flèches étant `sticky`, donc EN FLUX, chacune de visible ajoutait ses 26px à `scrollWidth` : le
// test de débordement se mesurait lui-même, et à 230px c'étaient ces 26px SEULS qui débordaient —
// une flèche droite allumée parce qu'il y avait une flèche droite. Mesuré depuis que le débordement
// se calcule flèches déduites (voir ui/toolbar.js#ajusterFleches) : le contenu utile pèse 218px, si
// bien qu'à 230px la barre TIENT et les deux flèches s'éteignent, tandis que le débordement réel
// commence sous 220px. Le banc éprouve donc le filet là où il y a vraiment quelque chose à
// atteindre — et garantit au passage, à 230px, qu'il ne s'allume PLUS pour rien.
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('barre de transport : défilement');

(async () => {
    plan(9);
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 200, height: 844 }, hasTouch: true, isMobile: true });
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
        exiger(avant.deborde, 'à 200px (délibérément plus étroit qu\'aucun téléphone réel), la barre de transport déborde bien — condition du reste de ce banc');
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

        // --- ET À 230px, PLUS RIEN À ATTEINDRE : l'ancienne condition devenue garantie ----------------
        // Ce banc EXIGEAIT auparavant que la barre déborde à 230px. Ce n'est plus vrai, et c'est la
        // bonne nouvelle : les 26px que la flèche droite s'ajoutait à elle-même ne comptent plus
        // (218px de contenu utile pour 230px de place — mesuré ; correctif retiré, la barre annonce
        // 244px et rallume sa flèche droite). On vérifie donc l'inverse, là même où l'ancienne
        // exigence se tenait.
        //
        // ICI, EN VENANT DE 200px, ET PAS APRÈS LE PASSAGE EN 1400px : à 1400 les deux flèches sont
        // déjà éteintes, donc aucune n'ajoute ses 26px, donc l'élargissement à 230 ne peut rien
        // révéler — la vérification passerait correctif retiré (constaté). Elle doit partir d'un état
        // où une flèche est ALLUMÉE, ce que la section 200px ci-dessus laisse derrière elle.
        await page.setViewportSize({ width: 230, height: 844 });
        await page.waitForTimeout(200);
        const etroit = await etat();
        check(!etroit.deborde && etroit.gaucheInvisible && etroit.droiteInvisible,
            'à 230px la barre tient tout entière et les deux flèches s\'éteignent — une flèche ne se compte plus elle-même');

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
