// Banc de TENUE EN CHARGE : le coût d'un redessin ne doit pas dépendre de la longueur du morceau.
//
// CE QU'IL PROTÈGE, ET POURQUOI IL EXISTE. La première version redessinait la partition ENTIÈRE à
// chaque frappe : 408 ms sur 150 mesures, avec un SVG de 4,4 Mo. Écrire dans une telle partition
// était devenu impossible — et rien ne le signalait, parce que tous les autres bancs travaillent sur
// quatre mesures, où le défaut ne se voit pas.
//
// Deux mesures l'ont corrigé, toutes deux dans le moteur de rendu, sans toucher au modèle ni à la
// mise en page : une bibliothèque de glyphes (chaque dessin décrit une fois, référencé ensuite) et le
// dessin des SEULS systèmes visibles. Ce banc vérifie la propriété qui en résulte, et qui est la
// seule qui compte : le coût est plat. Il compare donc un morceau court à un morceau vingt fois plus
// long, plutôt que de fixer un seuil en millisecondes — un seuil dirait surtout à quel point la
// machine du jour est rapide.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('tenue en charge');

/** Remplit la partition de `n` mesures denses et chronomètre le redessin. */
const mesurer = (page, n) => page.evaluate(async (n) => {
    const m = await import('/src/model/score.js');
    const ed = window.app.editeur;
    ed.partition.mesures = Array.from({ length: n }, () => m.creerMesure({
        voix: [{ evenements: Array.from({ length: 8 }, (_, i) => m.creerEvenement({ valeur: 8 },
            [m.creerNote(0, i), m.creerNote(1, (i * 3) % 12), m.creerNote(4, i % 5)])) }],
    }));
    ed.prevenir('document');
    window.app.dessiner();                                   // une passe à blanc : on ne mesure pas le premier appel
    const t0 = performance.now();
    for (let k = 0; k < 12; k++) window.app.dessiner();
    const ms = (performance.now() - t0) / 12;
    return {
        mesures: n,
        primitives: window.app.page.primitives.length,
        systemes: window.app.page.ancrages.systemes.length,
        dessines: window.app.systemesVisibles().length,
        octetsSvg: document.getElementById('feuille').innerHTML.length,
        ms,
    };
}, n);

(async () => {
    plan(10);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // COMPARER DEUX MORCEAUX QUI DÉBORDENT TOUS DEUX DE L'ÉCRAN. Une première version de ce banc
        // opposait 8 mesures à 200 : le morceau court tenait entièrement dans la fenêtre, donc il
        // dessinait 2 systèmes là où le long en dessinait 6 — le plafond du visible. Le banc criait à
        // la régression alors qu'il constatait le fonctionnement voulu. La propriété à éprouver n'est
        // pas « les deux dessinent autant », c'est « au-delà d'un écran, le coût cesse de monter ».
        const court = await mesurer(page, 6);
        const moyen = await mesurer(page, 60);
        const long = await mesurer(page, 400);

        exiger(long.primitives > moyen.primitives * 5, 'le morceau long produit bien beaucoup plus de primitives');
        check(court.dessines === court.systemes, `un morceau plus court qu'un écran est dessiné en entier (${court.systemes} systèmes)`);

        // LA propriété : au-delà d'un écran, ce qui est confié au navigateur cesse de croître.
        check(long.dessines === moyen.dessines,
            `le nombre de systèmes dessinés est plafonné (${moyen.dessines} pour ${moyen.systemes} systèmes, ${long.dessines} pour ${long.systemes})`);
        check(long.dessines < long.systemes / 8, 'la grande majorité des systèmes n\'entre jamais dans le document');
        check(long.octetsSvg < moyen.octetsSvg * 1.25,
            `le SVG cesse de gonfler avec le morceau (${Math.round(moyen.octetsSvg / 1024)} ko → ${Math.round(long.octetsSvg / 1024)} ko pour 7 fois plus de mesures)`);

        // Le redessin d'un morceau 7 fois plus long doit rester du même ordre. La marge laisse la
        // place au surcoût réel — la mise en page, elle, reste complète — sans laisser repasser le
        // comportement d'avant, où 150 mesures coûtaient dix fois 20 mesures.
        const facteur = long.ms / Math.max(moyen.ms, 1);
        check(facteur < 2, `le redessin reste du même ordre de grandeur (×${facteur.toFixed(2)} pour 7 fois plus de mesures)`);

        // La mise en page COMPLÈTE, elle, est recalculée à chaque fois — c'est voulu, et c'est ce qui
        // rend impossible un écran désaccordé du modèle. Le banc vérifie qu'on n'a pas sacrifié cette
        // garantie pour gagner du temps.
        const complet = await page.evaluate(() => ({
            systemes: window.app.page.ancrages.systemes.length,
            evenements: window.app.page.ancrages.evenements.length,
        }));
        check(complet.systemes === long.systemes, 'la mise en page couvre TOUJOURS la partition entière');
        check(complet.evenements === 400 * 8, 'et ancre chacun des évènements, y compris hors écran');

        // Le défilement doit découvrir de nouveaux systèmes, pas du vide.
        await page.evaluate(() => { const z = document.getElementById('zone-partition'); z.scrollTop = z.scrollHeight / 2; });
        await page.waitForTimeout(300);
        const apresDefilement = await page.evaluate(() => {
            const vis = window.app.systemesVisibles();
            return { premier: vis[0]?.index ?? -1, nb: vis.length, noeuds: document.querySelectorAll('#feuille svg use').length };
        });
        check(apresDefilement.premier > 5 && apresDefilement.nb > 0,
            `après défilement, ce sont les systèmes du milieu qui sont dessinés (à partir du n°${apresDefilement.premier})`);
        check(apresDefilement.noeuds > 20, 'et ils portent bien des glyphes, pas une page vide');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
