// Banc des INSTRUMENTS ET ACCORDAGES : trois instruments, des accordages prédéfinis, et le réglage
// corde par corde. Ce qui est éprouvé ici, c'est surtout la CONSÉQUENCE d'un changement d'accordage :
// une même case ne sonne plus la même note, donc la portée solfège doit changer alors que la
// tablature, elle, ne bouge pas. C'est tout le sens du modèle « corde + case », et le banc le vérifie
// plutôt que de le supposer.

const creerHarnais = require('./_harness.js');
const { ouvrirApp, taper, lireEtat } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('instruments et accordages');

const hauteurs = (page) => page.evaluate(async () => {
    const S = await import('/src/model/score.js');
    const p = window.app.editeur.partition;
    return p.mesures[0].voix[0].evenements.flatMap(e => e.notes.map(n => S.hauteurDeNote(p, n)));
});

(async () => {
    plan(16);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        await page.click('[data-action="duree8"]');
        // « ← » entre chaque corde : l'avance automatique a quitté la case dès qu'elle était
        // écrite (voir Editeur.saisirChiffre). C'est la frappe que paie un accord.
        await taper(page, ['Digit0', 'ArrowLeft', 'ArrowDown', 'Digit5', 'ArrowLeft', 'ArrowDown', 'Digit5']);
        let e = await lireEtat(page);
        exiger(e.contenu[0][0] === '0:0+1:5+2:5', 'trois cordes saisies pour servir de témoin');
        // Attention au piège classique de la guitare : les cordes sont accordées de quarte en quarte
        // SAUF entre sol et si, où l'intervalle est une tierce majeure. La case 5 de la corde de si
        // rejoint donc bien le mi aigu à vide, mais la case 5 de la corde de sol donne un do, pas un
        // si. Une première version de ce banc attendait trois fois le même mi et accusait le code.
        check(JSON.stringify(await hauteurs(page)) === '[64,64,60]', 'accordage standard : mi4, mi4 et do4 (l\'intervalle sol–si est une tierce)');

        // --- Drop D : seule la corde grave change ---------------------------------------------------
        await page.click('#btn-reglages');
        // Capodastre et corde par corde vivent maintenant sous « Options avancées » (repliée par
        // défaut, voir index.html) : l'ouvrir UNE fois suffit pour tout le reste du banc — remplir-
        // Reglages() ne reconstruit que le CONTENU de #champ-capo/#grille-cordes à chaque changement
        // d'instrument ou d'accordage, jamais le <details> lui-même, qui garde son état ouvert.
        await page.click('.repli-avance summary');
        await page.selectOption('#champ-accordage', 'dropD');
        await page.waitForTimeout(200);
        e = await lireEtat(page);
        check(e.accordage === 'dropD', 'l\'accordage Drop D est appliqué');
        check(e.cordes[5] === 38 && e.cordes[0] === 64, 'seule la corde grave descend (ré), l\'aiguë ne bouge pas');
        check(e.contenu[0][0] === '0:0+1:5+2:5', 'la TABLATURE est inchangée : une case reste une case');

        // --- Un ton plus bas : tout descend, la tablature reste identique ----------------------------
        await page.selectOption('#champ-accordage', 'tonEntier');
        await page.waitForTimeout(200);
        check(JSON.stringify(await hauteurs(page)) === '[62,62,58]', 'un ton plus bas, les mêmes cases sonnent toutes un ton plus bas');
        check((await lireEtat(page)).contenu[0][0] === '0:0+1:5+2:5', 'et la tablature, elle, n\'a toujours pas bougé');

        // --- Capodastre -------------------------------------------------------------------------------
        await page.selectOption('#champ-capo', '3');
        await page.waitForTimeout(200);
        check(JSON.stringify(await hauteurs(page)) === '[65,65,61]', 'un capodastre case 3 monte tout de trois demi-tons');
        await page.selectOption('#champ-capo', '0');

        // --- Accordage corde par corde ------------------------------------------------------------------
        await page.selectOption('#champ-accordage', 'standard');
        await page.waitForTimeout(150);
        const premierSelect = await page.$('#grille-cordes select[data-corde="5"]');
        await premierSelect.selectOption('38');
        await page.waitForTimeout(200);
        e = await lireEtat(page);
        check(e.cordes[5] === 38, 'la corde grave se règle individuellement');
        check(e.accordage === 'dropD', 'et TabHub reconnaît que cela reconstitue un Drop D, plutôt que d\'afficher « personnalisé »');

        // --- Changement d'instrument ---------------------------------------------------------------------
        await page.selectOption('#champ-instrument', 'basse4');
        await page.waitForTimeout(300);
        e = await lireEtat(page);
        check(e.instrument === 'basse4' && e.cordes.length === 4, 'le passage à la basse 4 cordes est appliqué');
        const lignesTab = await page.evaluate(() => {
            const sys = window.app.page.ancrages.systemes[0];
            return window.app.page.primitives.filter(p => p.t === 'ligne' && Math.abs(p.y1 - p.y2) < 0.01 && (p.x2 - p.x1) > 200
                && p.y1 >= sys.yTab - 0.1 && p.y1 <= sys.yTab + sys.hauteurTab + 0.1).length;
        });
        check(lignesTab === 4, 'la tablature n\'a plus que quatre lignes');
        const cordesRestantes = await page.evaluate(() => window.app.editeur.partition.mesures.flatMap(m => m.voix.flatMap(v => v.evenements).flatMap(ev => ev.notes.map(n => n.corde))));
        check(cordesRestantes.every(c => c <= 3), 'les notes posées sur des cordes disparues ont été retirées, pas laissées orphelines');

        await page.selectOption('#champ-instrument', 'basse5');
        await page.waitForTimeout(250);
        check((await lireEtat(page)).cordes.length === 5, 'et la basse 5 cordes en compte cinq');

        // L'ORDRE INTERNE DES CORDES — `cordes[0]` est la plus AIGUË. C'est de lui que dépend toute
        // numérotation affichée : un instrumentiste appelle « corde 1 » la plus fine, et une première
        // version annonçait « corde 6 » pour le mi aigu — l'inverse exact. On éprouve ici l'invariant
        // du MODÈLE, qui est la cause ; le LIBELLÉ, lui, a quitté la barre du bas (retour utilisateur :
        // « supprimer l'indication qui me dit sur quelle corde je suis positionné ») et ne subsiste
        // que sur le pavé tactile, où il est éprouvé en contexte tactile — voir tactile_test.js.
        await page.selectOption('#champ-instrument', 'guitare');
        await page.waitForTimeout(250);
        const ordre = await page.evaluate(() => window.app.editeur.partition.piste.accordage.cordes);
        check(ordre[0] === Math.max(...ordre) && ordre[ordre.length - 1] === Math.min(...ordre),
            'les cordes sont rangées de l\'AIGUË à la GRAVE — la source de toute numérotation affichée');
        check(ordre.length === 6 && ordre[0] === 64 && ordre[5] === 40,
            'et pour une guitare standard, de mi aigu (64) à mi grave (40)');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
