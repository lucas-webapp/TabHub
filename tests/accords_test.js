// Banc des NOMS D'ACCORDS — « A7 », « E7 »… au-dessus de la portée, à l'aplomb de chaque note.
//
// CE QU'IL PROTÈGE. Retour utilisateur (une capture d'une tablature trouvée en ligne à l'appui,
// dans le prolongement du travail sur le mode TAB seule) : le modèle qu'on cherche à suivre porte
// un nom d'accord à CHAQUE changement, souvent plusieurs fois par mesure — à la différence de
// l'annotation de section (« Couplet 1 »…, voir annotations_test.js), qui s'accroche à la MESURE
// entière et ne peut donc pas dire « l'accord change au 3e temps ». C'est pourquoi un nom d'accord
// vit sur l'ÉVÈNEMENT (voir model/score.js#creerEvenement, Évènement#accord), pas sur la mesure :
//   • le bouton (palette « Mesure ») ouvre la même invite de texte que l'annotation, mais sur
//     l'évènement COURANT — pré-remplie si celui-ci en porte déjà un ; un texte vide le retire ;
//   • la mise en page (engine/layout.js#mettreEnPage) réserve une bande au-dessus d'un système
//     SEULEMENT s'il en a réellement besoin — SOUS l'annotation de section si les deux coexistent,
//     celle-ci restant le repère le plus large ;
//   • ça se sauvegarde et se recharge comme le reste du document (voir model/score.js#normaliser,
//     une liste BLANCHE : un champ qui n'y figure pas disparaît silencieusement à la réouverture,
//     précisément le piège qu'un premier essai a fait remonter avant ce banc).

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('noms d\'accords');

(async () => {
    plan(24);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // --- Le moteur, hors interface : de la place réservée SEULEMENT si besoin, un nom par
        // ÉVÈNEMENT (pas par mesure), et une bande SOUS celle de l'annotation si les deux coexistent --
        const r = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const L = await import('/src/engine/layout.js');
            const mesureSimple = () => m.creerMesure({
                voix: [{ evenements: [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)])) }],
            });
            const partitionDe = (n) => { const p = m.creerPartition('guitare'); p.mesures = Array.from({ length: n }, mesureSimple); return p; };

            const pageSans = L.mettreEnPage(partitionDe(4), { largeurPage: 1100, S: 10, mesuresParLigne: 4 });

            // Deux évènements accordés dans la MÊME mesure : « A7 » sur le premier, « E7 » sur le
            // troisième — exactement le cas qu'une annotation de mesure ne sait pas représenter.
            const pAvec = partitionDe(4);
            pAvec.mesures[0].voix[0].evenements[0].accord = 'A7';
            pAvec.mesures[0].voix[0].evenements[2].accord = 'E7';
            const pageAvec = L.mettreEnPage(pAvec, { largeurPage: 1100, S: 10, mesuresParLigne: 4 });

            // Troisième page : accord ET annotation de section sur le même système — les deux bandes
            // doivent coexister (hauteur cumulée), pas se remplacer l'une l'autre.
            const pDeux = partitionDe(4);
            pDeux.mesures[0].voix[0].evenements[0].accord = 'B7';
            pDeux.mesures[0].annotation = 'Refrain';
            const pageDeux = L.mettreEnPage(pDeux, { largeurPage: 1100, S: 10, mesuresParLigne: 4 });

            const pageSansPortee = L.mettreEnPage(pAvec, { largeurPage: 1100, S: 10, mesuresParLigne: 4, avecPortee: false });

            const texteDe = (pg, s) => pg.primitives.filter(p => p.t === 'texte' && p.s === s);

            return {
                hauteurSans: pageSans.ancrages.systemes[0].hauteur, hauteurAvec: pageAvec.ancrages.systemes[0].hauteur,
                yPorteeSans: pageSans.ancrages.systemes[0].yPortee, yPorteeAvec: pageAvec.ancrages.systemes[0].yPortee,
                aucunTexteSans: texteDe(pageSans, 'A7').length,
                texteA7: texteDe(pageAvec, 'A7'), texteE7: texteDe(pageAvec, 'E7'),
                xEvt0: pageAvec.ancrages.evenements[0].x, xEvt2: pageAvec.ancrages.evenements[2].x,
                xMesure0: pageAvec.ancrages.mesures[0].x,
                hauteurPageSans: pageSans.hauteur, hauteurPageAvec: pageAvec.hauteur,
                hauteurDeux: pageDeux.ancrages.systemes[0].hauteur,
                nbAccordSansPortee: texteDe(pageSansPortee, 'A7').length,
            };
        });

        check(r.aucunTexteSans === 0, 'sans aucun accord, aucune primitive texte « A7 » n\'est posée');
        exiger(r.texteA7.length === 1 && r.texteE7.length === 1, 'chaque évènement accordé pose EXACTEMENT une primitive texte pour son nom');
        check(r.texteA7[0].couleur === 'encre' && parseFloat(r.texteA7[0].poids) >= 700, 'en encre pleine et en gras — pas discret comme un numéro de mesure');
        check(Math.abs(r.texteA7[0].x - r.xEvt0) < 5, 'le premier nom d\'accord est à l\'aplomb de SON évènement (le premier)');
        check(Math.abs(r.texteE7[0].x - r.xEvt2) < 5 && Math.abs(r.texteE7[0].x - r.xMesure0) > 10,
            'et le second, sur le MÊME évènement — pas celui du début de la mesure, à la différence d\'une annotation de section');
        check(r.hauteurAvec > r.hauteurSans, 'un système avec un accord est PLUS HAUT que le même système sans (la place est réservée)');
        check(r.yPorteeAvec > r.yPorteeSans, 'et sa portée elle-même descend d\'autant (la bande vient AU-DESSUS, pas en dessous)');
        check(r.hauteurPageAvec > r.hauteurPageSans, 'la hauteur totale de la page en tient compte aussi');
        check(r.hauteurDeux > r.hauteurAvec, 'accord ET annotation de section sur le même système : les DEUX bandes se cumulent, aucune n\'écrase l\'autre');
        check(r.nbAccordSansPortee === 1, 'sans portée (TAB seule) aussi : le nom d\'accord continue de se dessiner, au même endroit relatif (yPortee/yAccords ne dépendent pas du mode)');

        // --- Sauvegarde/rechargement : un accord appartient au DOCUMENT, pas à l'affichage -----------
        await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.definirAccord('Dm7');
            ed.prevenir('document');
        });
        // Le brouillon local s'écrit en différé (voir main.js#planifierBrouillon, 700ms) : recharger
        // avant qu'il n'ait tourné relirait encore l'ÉTAT PRÉCÉDENT, pas un vrai défaut de persistance.
        await page.waitForTimeout(900);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.app && window.app.page, null, { timeout: 20000 });
        check((await page.evaluate(() => window.app.editeur.evenementCourant().accord)) === 'Dm7',
            'un nom d\'accord survit au rechargement (normaliser le reconstruit — un premier essai le perdait, liste blanche oblige)');

        // --- L'interface : le bouton palette ----------------------------------------------------------
        await page.evaluate(() => { window.app.editeur.nouveau('guitare'); window.app.editeur.prevenir('document'); });
        exiger(await page.evaluate(() => !!document.querySelector('[data-action="accord"]')),
            'le bouton du nom d\'accord existe dans la palette (groupe Mesure)');
        check((await page.evaluate(() => document.querySelector('[data-action="accord"]').classList.contains('actif'))) === false,
            'inactif par défaut (l\'évènement de départ ne porte aucun accord)');

        // Le clic ouvre window.prompt() : on l'intercepte pour répondre comme le ferait un utilisateur.
        page.once('dialog', d => d.accept('A7'));
        await page.click('[data-action="accord"]');
        await page.waitForTimeout(150);
        const apresAjout = await page.evaluate(() => ({
            accord: window.app.editeur.evenementCourant().accord,
            actif: document.querySelector('[data-action="accord"]').classList.contains('actif'),
            svg: document.querySelector('#feuille svg').outerHTML.includes('A7'),
        }));
        check(apresAjout.accord === 'A7', 'le clic + la saisie posent bien le nom d\'accord sur l\'évènement courant');
        check(apresAjout.actif === true, 'et le bouton devient actif (l\'évènement courant en porte un)');
        check(apresAjout.svg === true, 'le SVG affiche bien le texte saisi après redessin, sans action supplémentaire');

        // Rouvrir la même invite la PRÉ-REMPLIT avec le texte déjà en place ; Annuler ne change rien.
        let preRempli = null;
        page.once('dialog', d => { preRempli = d.defaultValue(); d.dismiss(); });
        await page.click('[data-action="accord"]');
        await page.waitForTimeout(100);
        check(preRempli === 'A7', 'rouvrir l\'invite la PRÉ-REMPLIT avec le nom d\'accord déjà en place');
        check((await page.evaluate(() => window.app.editeur.evenementCourant().accord)) === 'A7',
            'Annuler l\'invite ne modifie RIEN (ni vidé, ni changé)');

        // Un texte vide (ou blanc) RETIRE le nom d'accord plutôt que de le garder tel quel.
        page.once('dialog', d => d.accept('   '));
        await page.click('[data-action="accord"]');
        await page.waitForTimeout(150);
        const apresVidage = await page.evaluate(() => ({
            accord: window.app.editeur.evenementCourant().accord,
            actif: document.querySelector('[data-action="accord"]').classList.contains('actif'),
        }));
        check(apresVidage.accord === null, 'un texte vide (espaces compris) RETIRE le nom d\'accord');
        check(apresVidage.actif === false, 'et le bouton redevient inactif');

        // --- Ctrl+Z défait la pose d'un nom d'accord, comme toute autre édition -----------------------
        page.once('dialog', d => d.accept('Cmaj7'));
        await page.click('[data-action="accord"]');
        await page.waitForTimeout(150);
        exiger((await page.evaluate(() => window.app.editeur.evenementCourant().accord)) === 'Cmaj7', 'préalable : la pose a bien réussi');
        await page.evaluate(() => document.getElementById('zone-partition').focus());
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(150);
        check((await page.evaluate(() => window.app.editeur.evenementCourant().accord)) === null,
            'Ctrl+Z défait la pose d\'un nom d\'accord, comme toute autre édition');

        // --- Bornée en longueur : un nom d'accord reste COURT, pas une phrase entière -----------------
        const longueur = await page.evaluate(() => {
            window.app.editeur.definirAccord('x'.repeat(50));
            return window.app.editeur.evenementCourant().accord.length;
        });
        check(longueur === 12, 'un nom d\'accord démesuré est tronqué (12 caractères) — bien plus court que les 40 d\'une annotation de section');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
