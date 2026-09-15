// Banc de l'AIDE RYTHMIQUE — la fenêtre (voir ui/rythme.js, main.js#ouvrirAideRythme).
//
// CE QU'ELLE EST. Retour utilisateur : « insérer un séquenceur qui est juste une aide rythmique : une
// fenêtre s'ouvre, je place des barres [...] et tu me proposes l'écriture "vraie" sur une portée
// fictive ». Un ORACLE, donc : elle ne connaît ni hauteurs, ni effets, ni voix — elle produit des
// DURÉES, et « Insérer » les pose dans la partition en cases à remplir.
//
// CE QUE CE BANC PROTÈGE, par ordre d'importance :
//   1. LA CONVERSION. Une course de cellules doit devenir la BONNE suite de figures, et chaque mesure
//      sommer EXACTEMENT sa capacité. C'est tout l'intérêt de l'outil : s'il propose une écriture
//      fausse, il est pire qu'inutile. Les cas éprouvés sont ceux qui se ratent à la main — triolet,
//      croche pointée + double, note qui enjambe deux temps de subdivisions différentes.
//   2. LA PORTÉE SEULE. L'aperçu passe par le moteur de gravure avec `avecTab: false` : une tablature
//      n'aurait rien à dire ici, toutes ses notes étant à la même hauteur (elle afficherait
//      « 0 — 0 — 0 », du bruit). C'est ICI que cette option du moteur se vérifie, par le SVG
//      réellement rendu dans la fenêtre — plutôt qu'en exposant le moteur à un banc.
//   3. L'ENDROIT D'INSERTION. Il se choisit par le geste qui ouvre la fenêtre (clic droit ou appui
//      long sur la mesure), et la fenêtre le RAPPELLE avant qu'on clique.
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('aide rythmique');

(async () => {
    plan(26);
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 1320, height: 950 } });
    try {
        const NOM = { 1: 'ronde', 2: 'blanche', 4: 'noire', 8: 'croche', 16: 'double', 32: 'triple' };
        /** L'écriture proposée, lue dans le MODÈLE de la partition d'aperçu — la même que celle qui
         *  sera gravée, puisque c'est elle qu'on donne au moteur. */
        const ecriture = () => page.evaluate(() => {
            const evs = window.app._rythme.page ? null : null;
            const parMesure = window.__rythme.evenementsParMesure(window.app._rythme.etat, { avecNotes: true });
            const NOM = { 1: 'ronde', 2: 'blanche', 4: 'noire', 8: 'croche', 16: 'double', 32: 'triple' };
            return parMesure.map(evs => evs.map(e =>
                (e.silence ? 'Ø' : (e.notes[0]?.lien === 'tie' ? 'x⌒' : 'x'))
                + ':' + (NOM[e.duree.valeur] || e.duree.valeur)
                + (e.duree.points ? '.' : '') + (e.duree.nolet ? '~3' : '')).join(' '));
        });
        const justes = () => page.evaluate(() => window.__rythme.mesuresJustes(window.app._rythme.etat));
        const poser = (iTemps, cellules) => page.evaluate(([i, c]) => {
            window.app._rythme.etat.temps[i].cellules = c;
            window.app._rythme.grille.rafraichir();
            window.app.rafraichirApercuRythme();
        }, [iTemps, cellules]);
        const sub = (iTemps, n) => page.evaluate(([i, s]) => {
            window.__rythme.changerSubdivision(window.app._rythme.etat, i, s);
            window.app._rythme.grille.reconstruire();
            window.app.rafraichirApercuRythme();
        }, [iTemps, n]);

        // Le module est chargé par la page ; on s'en donne une poignée pour lire la conversion
        // directement, plutôt que de la deviner depuis le SVG.
        await page.evaluate(() => import('./src/ui/rythme.js').then(m => { window.__rythme = m; }));
        await page.waitForTimeout(300);

        // --- 1. L'OUVERTURE, et l'endroit qu'elle annonce ----------------------------------------
        await page.evaluate(() => window.app.ouvrirAideRythme(1));
        await page.waitForTimeout(600);
        const ouverture = await page.evaluate(() => ({
            ouverte: !document.getElementById('fenetre-rythme').hidden,
            cible: document.getElementById('rythme-cible').textContent,
            mesures: document.querySelectorAll('#grille-rythme .mesure-rythme').length,
            temps: document.querySelectorAll('#grille-rythme .temps-rythme').length,
            cellules: document.querySelectorAll('#grille-rythme .cellule-rythme').length,
            apercu: !!document.querySelector('#apercu-rythme svg'),
            insererInactif: document.getElementById('btn-rythme-inserer').disabled,
        }));
        exiger(ouverture.ouverte, 'la fenêtre s\'ouvre');
        check(/mesure 2/.test(ouverture.cible),
            `elle RAPPELLE où elle écrira (« ${ouverture.cible} ») — l'endroit a été choisi par le geste qui l'a ouverte, elle n'a pas à le redemander`);
        check(ouverture.mesures === 1 && ouverture.temps === 4 && ouverture.cellules === 16,
            `la grille suit la signature du morceau : 1 mesure, 4 temps, 4 cellules chacun (${ouverture.cellules})`);
        check(ouverture.apercu, 'et l\'aperçu est déjà rendu, avant qu\'on ait posé quoi que ce soit');
        check(ouverture.insererInactif === true,
            'un rythme vide n\'a rien à insérer : le bouton le dit AVANT d\'être cliqué, plutôt que de poser des mesures de silence');

        // --- 2. LA PORTÉE SEULE — `avecTab: false`, vérifié sur le SVG rendu ---------------------
        const apercu = await page.evaluate(() => {
            const svg = document.querySelector('#apercu-rythme svg');
            return { html: svg.outerHTML.length, tab: /<text[^>]*>T<\/text>|TAB/.test(svg.outerHTML),
                     chiffres: [...svg.querySelectorAll('text')].map(t => t.textContent) };
        });
        check(apercu.tab === false,
            'l\'aperçu ne porte AUCUNE tablature : toutes ses notes étant à la même hauteur, elle n\'afficherait qu\'une colonne de zéros');
        check(!apercu.chiffres.includes('0'),
            `et aucun chiffre de case n'y est gravé (${apercu.chiffres.join(', ') || 'aucun texte'})`);

        // --- 3. LA CONVERSION — les cas qu'on rate à la main -------------------------------------
        const A = 'attaque', T = 'tenue', V = 'vide';
        await poser(0, [A, T, T, A]);
        await page.waitForTimeout(250);
        check((await ecriture())[0].startsWith('x:croche. x:double'),
            `trois cellules puis une : croche POINTÉE + double (${(await ecriture())[0]})`);
        await sub(0, 3);
        await poser(0, [A, A, A]);
        await page.waitForTimeout(250);
        check((await ecriture())[0].startsWith('x:croche~3 x:croche~3 x:croche~3'),
            `un temps en trois, trois attaques : trois croches de TRIOLET (${(await ecriture())[0]})`);
        await poser(0, [A, T, A]);
        await page.waitForTimeout(250);
        check((await ecriture())[0].startsWith('x:noire~3 x:croche~3'),
            `deux cellules puis une : noire de triolet + croche de triolet (${(await ecriture())[0]})`);
        await poser(0, [A, T, T]);
        await page.waitForTimeout(250);
        check((await ecriture())[0].startsWith('x:noire '),
            `une note sur TOUT le temps en trois : une NOIRE ordinaire, sans chiffre de triolet — un « 3 » y serait faux (${(await ecriture())[0]})`);
        // Une note qui enjambe un temps en trois et un temps en deux : sa durée n'est exprimable par
        // aucune figure. On coupe au temps et on LIE — ce qu'écrit une vraie partition.
        await sub(1, 2);
        await poser(0, [V, V, A]);
        await poser(1, [T, V]);
        await page.waitForTimeout(250);
        const enjambe = (await ecriture())[0];
        check(/x⌒:croche~3 x:croche/.test(enjambe),
            `une note à cheval sur un temps en trois et un temps en deux est COUPÉE au temps et LIÉE (${enjambe})`);
        check((await justes())[0] === true,
            'et la mesure somme toujours exactement sa capacité — c\'est l\'invariant que l\'aide ne doit jamais casser');

        // --- 4. JUSQU'À QUATRE MESURES -----------------------------------------------------------
        await page.click('#rythme-nb-mesures button:nth-child(4)');
        await page.waitForTimeout(500);
        const quatre = await page.evaluate(() => ({
            cible: document.getElementById('rythme-cible').textContent,
            mesures: document.querySelectorAll('#grille-rythme .mesure-rythme').length,
            cellules: document.querySelectorAll('#grille-rythme .cellule-rythme').length,
            boutons: document.querySelectorAll('#rythme-nb-mesures button').length,
        }));
        check(quatre.mesures === 4 && quatre.cellules === 64,
            `quatre mesures, soixante-quatre cellules (${quatre.cellules})`);
        check(/mesures 2 à 5/.test(quatre.cible), `et l'étendue annoncée suit (« ${quatre.cible} »)`);
        check(quatre.boutons === 4, 'quatre au plus : au-delà, la grille ne tient plus à l\'écran et l\'aide cesse d\'aider');
        check((await justes()).every(Boolean), 'les quatre mesures sont justes');

        // --- 5. LE TRIOLET EST À UN SEUL CLIC du défaut ------------------------------------------
        await page.click('#rythme-nb-mesures button:nth-child(1)');
        await page.waitForTimeout(400);
        const avant = await page.evaluate(() => document.querySelector('#grille-rythme .entete-temps').textContent);
        await page.click('#grille-rythme .temps-rythme:nth-child(2) .entete-temps');
        await page.waitForTimeout(300);
        const apres = await page.evaluate(() => document.querySelector('#grille-rythme .entete-temps').textContent);
        check(avant === '4' && apres === '3',
            `un temps naît en 4 et le PREMIER clic le met en 3 (${avant} → ${apres}) : le triolet est la raison d'être de cette fenêtre, il ne doit pas coûter deux clics`);

        // --- 6. L'INSERTION : des cases à remplir, la tablature VIDE -----------------------------
        for (let i = 1; i <= 3; i++) {
            await page.click(`#grille-rythme .temps-rythme:nth-child(2) .cellule-rythme:nth-child(${i})`);
            await page.waitForTimeout(120);
        }
        await page.waitForTimeout(300);
        check((await page.evaluate(() => document.getElementById('btn-rythme-inserer').disabled)) === false,
            'dès qu\'il y a un rythme, « Insérer » devient disponible');
        await page.click('#btn-rythme-inserer');
        await page.waitForTimeout(800);
        const apresInsertion = await page.evaluate(() => ({
            fermee: document.getElementById('fenetre-rythme').hidden,
            mesure: window.app.editeur.partition.mesures[1].voix[0].evenements.map(e =>
                (e.silence ? 'Ø' : 'x') + ':' + e.duree.valeur + (e.duree.nolet ? '~3' : '') + (e.aRemplir ? '*' : '')),
            bandes: window.app.marquesARemplir().length,
            curseur: window.app.editeur.curseur.mesure,
            mesureIntacte: window.app.editeur.partition.mesures[0].voix[0].evenements.length,
        }));
        check(apresInsertion.fermee, 'la fenêtre se referme : le rythme est posé, il n\'y a plus rien à y faire');
        check(apresInsertion.mesure.slice(0, 3).join(' ') === 'Ø:8~3* Ø:8~3* Ø:8~3*',
            `le rythme est arrivé en CASES À REMPLIR, tablature vide (${apresInsertion.mesure.join(' ')})`);
        check(apresInsertion.bandes === 3, 'trois bandes de surbrillance : ce qui reste à choisir');
        check(apresInsertion.curseur === 1, 'et le curseur attend sur la première mesure insérée');
        check(apresInsertion.mesureIntacte > 0,
            'la mesure 1, hors de l\'étendue visée, n\'a pas été touchée — on remplace ce qu\'on désigne, rien d\'autre');

        // --- 7. LA TABULATION parcourt les cases à remplir --------------------------------------
        await page.evaluate(() => { window.app.editeur.placerCurseur(1, 0, 2, 0); document.getElementById('zone-partition').focus(); });
        await page.waitForTimeout(200);
        await page.keyboard.press('Tab');
        await page.waitForTimeout(250);
        check((await page.evaluate(() => window.app.editeur.curseur.evenement)) === 1,
            'Tabulation saute à la case à remplir SUIVANTE — sans elle, remplir quatre mesures voudrait dire viser chaque case à la souris');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
