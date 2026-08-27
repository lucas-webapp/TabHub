// Banc des ANNOTATIONS DE SECTION — couplet/refrain/pont, au-dessus de la partition.
//
// CE QU'IL PROTÈGE. Retour direct : « je veux pouvoir ajouter des annotations au-dessus des
// partitions. Par exemple des sections : couplet 1, refrain, pont, etc... » Une étiquette de texte
// libre, posée sur UNE mesure précise (jamais héritée par les suivantes, à la différence d'une
// signature ou d'une armure — voir model/score.js#creerMesure) :
//   • le bouton (palette « Mesure ») ouvre une simple invite de texte, PRÉ-REMPLIE si la mesure en
//     porte déjà une ; un texte vide la retire, Annuler ne change rien ;
//   • la mise en page (engine/layout.js#mettreEnPage) ne réserve de la place au-dessus d'un système
//     QUE s'il en a réellement besoin — un système sans aucune annotation garde exactement sa
//     hauteur habituelle, une partition qui n'utilise jamais cette fonctionnalité ne paie rien pour
//     elle ;
//   • ça se sauvegarde et se recharge comme le reste du document (voir model/score.js#normaliser) —
//     à la différence d'une préférence d'affichage comme le nombre de mesures par ligne, une
//     annotation appartient à la PARTITION elle-même : rouvrir le fichier ailleurs doit la montrer.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('annotations de section');

(async () => {
    plan(21);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // --- Le moteur, hors interface : de la place réservée SEULEMENT si besoin -------------------
        const r = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const L = await import('/src/engine/layout.js');
            const mesureSimple = () => m.creerMesure({
                voix: [{ evenements: [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)])) }],
            });
            const partitionDe = (n) => { const p = m.creerPartition('guitare'); p.mesures = Array.from({ length: n }, mesureSimple); return p; };

            const pageSans = L.mettreEnPage(partitionDe(4), { largeurPage: 1100, S: 10, mesuresParLigne: 4 });

            const pAvec = partitionDe(4);
            pAvec.mesures[1].annotation = 'Refrain';
            const pageAvec = L.mettreEnPage(pAvec, { largeurPage: 1100, S: 10, mesuresParLigne: 4 });

            const texteDe = (pg, s) => pg.primitives.filter(p => p.t === 'texte' && p.s === s);

            return {
                hauteurSans: pageSans.ancrages.systemes[0].hauteur, hauteurAvec: pageAvec.ancrages.systemes[0].hauteur,
                yPorteeSans: pageSans.ancrages.systemes[0].yPortee, yPorteeAvec: pageAvec.ancrages.systemes[0].yPortee,
                aucunTexteSans: texteDe(pageSans, 'Refrain').length,
                texteAvec: texteDe(pageAvec, 'Refrain'),
                xMesure1: pageAvec.ancrages.mesures[1].x,
                hauteurPageSans: pageSans.hauteur, hauteurPageAvec: pageAvec.hauteur,
            };
        });

        check(r.aucunTexteSans === 0, 'sans aucune annotation, aucune primitive texte « Refrain » n\'est posée');
        exiger(r.texteAvec.length === 1, 'une mesure annotée pose EXACTEMENT une primitive texte pour son libellé');
        check(r.texteAvec[0].couleur === 'encre' && parseFloat(r.texteAvec[0].poids) >= 700,
            'en encre pleine et en gras — pas discret comme un numéro de mesure');
        check(Math.abs(r.texteAvec[0].x - r.xMesure1) < 5, 'positionnée à l\'aplomb du DÉBUT de la mesure qui la porte (pas centrée, pas ailleurs)');
        check(r.hauteurAvec > r.hauteurSans, 'un système avec une annotation est PLUS HAUT que le même système sans (la place est réservée)');
        check(r.yPorteeAvec > r.yPorteeSans, 'et sa portée elle-même descend d\'autant (la bande vient AU-DESSUS, pas en dessous)');
        check(r.hauteurPageAvec > r.hauteurPageSans, 'la hauteur totale de la page en tient compte aussi');

        // --- Sauvegarde/rechargement : une annotation appartient au DOCUMENT, pas à l'affichage -----
        await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures[2].annotation = 'Pont';
            ed.prevenir('document');
        });
        // Le brouillon local s'écrit en différé (voir main.js#planifierBrouillon, 700ms) : recharger
        // avant qu'il n'ait tourné relirait encore l'ÉTAT PRÉCÉDENT, pas un vrai défaut de persistance.
        await page.waitForTimeout(900);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.app && window.app.page, null, { timeout: 20000 });
        check((await page.evaluate(() => window.app.editeur.partition.mesures[2].annotation)) === 'Pont',
            'une annotation survit au rechargement (brouillon local, via normaliser)');

        // --- L'interface : le bouton palette ---------------------------------------------------------
        await page.evaluate(() => { window.app.editeur.nouveau('guitare'); window.app.editeur.prevenir('document'); });
        exiger(await page.evaluate(() => !!document.querySelector('[data-action="annotation"]')),
            'le bouton « Annotation » existe dans la palette (groupe Mesure)');
        check((await page.evaluate(() => document.querySelector('[data-action="annotation"]').classList.contains('actif'))) === false,
            'inactif par défaut (la mesure de départ n\'a aucune annotation)');

        // Le clic ouvre window.prompt() : on l'intercepte pour répondre comme le ferait un utilisateur.
        page.once('dialog', d => d.accept('Couplet 1'));
        await page.click('[data-action="annotation"]');
        await page.waitForTimeout(150);
        const apresAjout = await page.evaluate(() => ({
            annotation: window.app.editeur.partition.mesures[0].annotation,
            actif: document.querySelector('[data-action="annotation"]').classList.contains('actif'),
            svg: document.querySelector('#feuille svg').outerHTML.includes('Couplet 1'),
        }));
        check(apresAjout.annotation === 'Couplet 1', 'le clic + la saisie posent bien l\'annotation sur la mesure courante');
        check(apresAjout.actif === true, 'et le bouton devient actif (la mesure courante en porte une)');
        check(apresAjout.svg === true, 'le SVG affiche bien le texte saisi après redessin, sans action supplémentaire');

        // Rouvrir la même invite la PRÉ-REMPLIT avec le texte déjà en place ; Annuler ne change rien.
        let preRempli = null;
        page.once('dialog', d => { preRempli = d.defaultValue(); d.dismiss(); });
        await page.click('[data-action="annotation"]');
        await page.waitForTimeout(100);
        check(preRempli === 'Couplet 1', 'rouvrir l\'invite la PRÉ-REMPLIT avec l\'annotation déjà en place');
        check((await page.evaluate(() => window.app.editeur.partition.mesures[0].annotation)) === 'Couplet 1',
            'Annuler l\'invite ne modifie RIEN (ni vidé, ni changé)');

        // Un texte vide (ou blanc) RETIRE l'annotation plutôt que de la garder telle quelle.
        page.once('dialog', d => d.accept('   '));
        await page.click('[data-action="annotation"]');
        await page.waitForTimeout(150);
        const apresVidage = await page.evaluate(() => ({
            annotation: window.app.editeur.partition.mesures[0].annotation,
            actif: document.querySelector('[data-action="annotation"]').classList.contains('actif'),
        }));
        check(apresVidage.annotation === null, 'un texte vide (espaces compris) RETIRE l\'annotation');
        check(apresVidage.actif === false, 'et le bouton redevient inactif');

        // --- Ctrl+Z défait la pose d'une annotation, comme toute autre édition -----------------------
        page.once('dialog', d => d.accept('Intro'));
        await page.click('[data-action="annotation"]');
        await page.waitForTimeout(150);
        exiger((await page.evaluate(() => window.app.editeur.partition.mesures[0].annotation)) === 'Intro', 'préalable : la pose a bien réussi');
        await page.evaluate(() => document.getElementById('zone-partition').focus());
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(150);
        check((await page.evaluate(() => window.app.editeur.partition.mesures[0].annotation)) === null,
            'Ctrl+Z défait la pose d\'une annotation, comme toute autre édition');

        // --- Bornée en longueur : ne déborde pas indéfiniment sur les mesures voisines --------------
        const longueur = await page.evaluate(() => {
            window.app.editeur.definirAnnotation('x'.repeat(200));
            return window.app.editeur.partition.mesures[0].annotation.length;
        });
        check(longueur === 40, 'une annotation démesurée est tronquée (40 caractères), pas laissée à déborder indéfiniment');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
