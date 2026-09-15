// Banc du RYTHME IMPOSÉ — le socle de l'aide rythmique (voir model/score.js `Évènement#aRemplir`,
// engine/layout.js `avecTab`, main.js#marquesARemplir, commands.js#saisirChiffre).
//
// CE QU'IL PROTÈGE, et la première vérification est de loin la plus importante. Retour utilisateur :
// « je dois pouvoir insérer un rythme [...] ne rien mettre dans la tablature pour que je puisse
// écrire », et « laisse en surbrillance les notes que je dois choisir dans la tablature ».
//
// LE PIÈGE QUI A DICTÉ TOUTE LA CONCEPTION. TabHub applique une « durée collante » : le premier
// chiffre tapé dans un évènement vierge le REDIMENSIONNE à la figure choisie dans la palette (voir
// commands.js, et c'est nécessaire — une mesure neuve n'est qu'un grand silence, il faut bien que
// taper une case donne une croche). Mesuré avant correctif : un rythme « croche pointée + double +
// triolet de croches + noire » inséré puis rempli case par case ressortait en SIX CROCHES PLATES, la
// mesure à un temps de moins. On croyait remplir, on écrasait — et l'aide entière n'aurait servi à
// rien.
//
// D'OÙ UN MARQUEUR, `aRemplir`, ET NON UNE RÈGLE GLOBALE : changer la règle aurait touché toute la
// saisie ordinaire. Le marqueur ne vaut que pour les évènements posés par l'aide, et il sert DEUX
// besoins avec un seul concept — ne pas redimensionner, et montrer ce qui reste à choisir. Ce banc
// éprouve les deux, plus le fait qu'ils tombent ENSEMBLE (jamais l'un sans l'autre).
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('rythme imposé');

(async () => {
    plan(12);
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 1320, height: 900 } });
    try {
        const lire = () => page.evaluate(() => window.app.editeur.partition.mesures[0].voix[0].evenements.map(e =>
            (e.silence ? 'Ø' : e.notes.map(x => x.frette).join('+'))
            + ':' + e.duree.valeur + (e.duree.points ? '.' : '') + (e.duree.nolet ? '~3' : '')
            + (e.aRemplir ? '*' : '')));
        const ecart = () => page.evaluate(() => { window.app.editeur.placerCurseur(0, 0, 0, 0); return +window.app.editeur.ecartMesure().toFixed(6); });
        const bandes = () => page.evaluate(() => window.app.marquesARemplir().length);
        /** Pose le rythme d'essai EN SILENCES MARQUÉS, palette réglée sur CROCHE — la figure qui
         *  écraserait tout si le marqueur n'était pas respecté, donc celle qui rend la panne visible. */
        const poserRythme = () => page.evaluate(() => {
            const T3 = { dans: 3, valent: 2 };
            const e = (valeur, opts = {}) => ({ duree: { valeur, points: opts.p || 0, nolet: opts.n || null },
                notes: [], silence: true, aRemplir: true });
            window.app.editeur.remplacer({
                meta: { titre: 'Rythme imposé', tempo: 120 },
                piste: { instrument: 'guitare', accordage: 'standard' },
                // croche pointée (0,75) + double (0,25) + triolet de croches (1) + noire + noire = 4 temps
                mesures: [{ signature: { battements: 4, unite: 4 }, voix: [{ evenements: [
                    e(8, { p: 1 }), e(16), e(8, { n: T3 }), e(8, { n: T3 }), e(8, { n: T3 }), e(4), e(4) ] }] }],
            });
            window.app.editeur.dureeCourante = { valeur: 8, points: 0, nolet: null };
            window.app.dessiner();
        });

        // --- 1. LE RYTHME SURVIT À SON REMPLISSAGE — la vérification centrale --------------------
        await poserRythme();
        await page.waitForTimeout(400);
        const insere = await lire();
        exiger(insere.length === 7 && insere.every(x => x.endsWith('*')),
            `préalable : sept évènements posés, tous marqués « à remplir » (${insere.join(' ')})`);
        exiger((await ecart()) === 0, 'préalable : le rythme inséré fait EXACTEMENT une mesure');
        await page.evaluate(() => {
            const ed = window.app.editeur;
            const n = ed.partition.mesures[0].voix[0].evenements.length;
            for (let i = 0; i < n; i++) { ed.placerCurseur(0, i, 2, 0); ed.saisirChiffre(5); }
        });
        await page.waitForTimeout(500);
        const rempli = await lire();
        check(rempli.join(' ') === '5:8. 5:16 5:8~3 5:8~3 5:8~3 5:4 5:4',
            `donner une case à chacun laisse le rythme INTACT : ${rempli.join(' ')}`);
        check((await ecart()) === 0,
            'et la mesure somme toujours exactement sa capacité — sans le marqueur, elle perdait un temps entier');
        check(rempli.every(x => !x.endsWith('*')),
            'tous les marqueurs sont tombés : l\'attente est satisfaite, elle n\'a plus à être décrite');

        // --- 2. LA SURBRILLANCE SUIT LE MARQUEUR, cran par cran ----------------------------------
        await poserRythme();
        await page.waitForTimeout(400);
        check((await bandes()) === 7, 'une bande de surbrillance par case à choisir (7)');
        const svgAvant = await page.evaluate(() => (document.querySelector('#feuille svg').outerHTML.match(/--a-remplir/g) || []).length);
        check(svgAvant === 7, `et elles sont RÉELLEMENT dessinées dans le SVG, pas seulement calculées (${svgAvant})`);
        await page.evaluate(() => { const ed = window.app.editeur; ed.placerCurseur(0, 2, 2, 0); ed.saisirChiffre(7); });
        await page.waitForTimeout(400);
        check((await bandes()) === 6,
            'remplir UNE case éteint SA bande, et seulement la sienne (6 restantes) — la même vérité pilote les deux, jamais l\'une sans l\'autre');
        await page.evaluate(() => {
            const ed = window.app.editeur;
            const n = ed.partition.mesures[0].voix[0].evenements.length;
            for (let i = 0; i < n; i++) { ed.placerCurseur(0, i, 2, 0); ed.saisirChiffre(5); }
        });
        await page.waitForTimeout(500);
        check((await bandes()) === 0, 'tout rempli : plus une seule bande');

        // --- 3. LA SURBRILLANCE NE SORT PAS SUR LE PDF -------------------------------------------
        // C'est une aide à l'ÉDITION, posée en calque par main.js comme le curseur — pas de la
        // gravure. Une partition imprimée n'a aucune raison de montrer un chantier, et la couleur
        // translucide ne serait de toute façon pas portable vers jsPDF (même raison que
        // `avertirErreurs: false` à l'export).
        await poserRythme();
        await page.waitForTimeout(400);
        // `page.primitives` EST la liste que le PDF consomme (voir io/pdf.js, qui repasse par le même
        // moteur) ; les calques, eux, sont remis séparément au rendu SVG (`calquesDessous`, voir
        // main.js#dessiner). La liste du moteur doit donc être vierge de toute bande.
        const dansLaGravure = await page.evaluate(() =>
            JSON.stringify(window.app.page.primitives).includes('a-remplir'));
        check(dansLaGravure === false,
            'la liste d\'affichage du moteur ne contient AUCUNE bande : le calque vit dans main.js, il ne peut pas atteindre le PDF');
        check((await page.evaluate(() => (document.querySelector('#feuille svg').outerHTML.match(/--a-remplir/g) || []).length)) > 0,
            'alors qu\'à l\'écran, au même instant, elles sont bien là — c\'est la preuve que la séparation est réelle et non une absence de bandes');

        // L'option `avecTab: false` du moteur n'est PAS éprouvée ici : elle n'existe que pour la
        // fenêtre d'aide rythmique, et c'est par elle qu'elle se vérifie — voir tests/rythme_test.js,
        // qui regarde le SVG réellement rendu dans la fenêtre. L'exposer autrement demanderait un
        // point d'entrée de test dans le code de production, qui n'a pas à en porter.

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
