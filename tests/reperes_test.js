// Banc des REPÈRES, DE LA MISE EN PAGE MANUELLE ET DE L'EN-TÊTE — quatre retours d'un même passage.
//
// 1. « J'aimerais voir la tonalité du morceau à côté de l'indication de tempo au-dessus de la
//    portée. » L'armure est DÉJÀ sur la portée, en altérations à la clé — mais elle ne dit pas si le
//    morceau est en do majeur ou en la mineur : les deux n'ont aucune altération. C'est précisément
//    ce que le nom ajoute.
//
// 2. « Supprimer l'indication qui me dit sur quelle corde je suis positionné + ajouter une indication
//    Affichage pour que je comprenne que les chiffres Auto, 2, 3, 4 etc… correspondent au nombre de
//    mesures que je vois affichées à l'écran. » Six chiffres nus dans un coin de barre peuvent se lire
//    comme un zoom, un nombre de voix, une subdivision.
//
// 3. « Permets-moi de faire un retour à la ligne pour la portée [...] si je veux uniquement créer une
//    fiche d'exercices avec plusieurs petits morceaux de 2 mesures. » LE POINT QUI FAIT TOUT LE
//    TRAVAIL : le drapeau doit être honoré par les DEUX découpages, l'automatique et celui à nombre
//    fixe de mesures par ligne — sinon la fiche se recolle dès qu'on touche au réglage Affichage, un
//    réglage global écrasant en silence une intention posée mesure par mesure.
//
// 4. « Ajouter la possibilité de noter des Coda, Da Capo, etc… [...] insérées dans un seul bouton
//    avec un popover. Placer dedans également des logos de fin de mesure [...] On devrait encore
//    gagner un peu de place dans la barre d'outils. Laisser en dehors le titre des sections. »
//
// CE QUE CE BANC SURVEILLE EN PLUS du visible : qu'un repère, une barre et un retour à la ligne
// SURVIVENT à l'aller-retour .json (ce sont des champs de document, une fiche d'exercices dont les
// systèmes se recolleraient à la réouverture n'aurait aucun intérêt), et qu'un fichier réclamant un
// repère INCONNU se voie refuser plutôt que de le garder sans jamais l'afficher.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('repères, mise en page, en-tête');

(async () => {
    plan(24);
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 1320, height: 880 } });
    try {
        // --- 1. LA TONALITÉ à côté du tempo ---------------------------------------------------------
        const textesEnTete = () => page.evaluate(() =>
            [...document.querySelectorAll('#feuille text')].map(t => t.textContent));
        const t0 = await textesEnTete();
        // « C majeur », ÉCRIT — pas « CM ». La forme courte est celle de la liste déroulante de la
        // barre d'outils, où trente entrées doivent tenir dans un menu étroit (voir TONALITES dans
        // model/theory.js, et tests/tonalite_test.js qui la vérifie là-bas) ; gravée en tête de
        // partition elle n'était ni un nom de tonalité ni un chiffrage d'accord, juste une
        // abréviation de menu échappée dans la partition.
        exiger(t0.includes('= 120') && t0.includes('C majeur'),
            'l\'en-tête porte le tempo ET la tonalité, écrite en clair (« C majeur », pas « CM »)');
        check(!t0.some(x => x === 'CM'), 'et jamais la forme abrégée du menu déroulant');
        // À DROITE du tempo, pas ailleurs : « à côté de l'indication de tempo ».
        const positions = await page.evaluate(() => {
            const t = [...document.querySelectorAll('#feuille text')];
            const x = (s) => { const e = t.find(n => n.textContent === s); return e ? parseFloat(e.getAttribute('x')) : null; };
            const y = (s) => { const e = t.find(n => n.textContent === s); return e ? parseFloat(e.getAttribute('y')) : null; };
            return { xTempo: x('= 120'), xTon: x('C majeur'), yTempo: y('= 120'), yTon: y('C majeur') };
        });
        check(positions.xTon > positions.xTempo && Math.abs(positions.yTon - positions.yTempo) < 0.5,
            'sur la même ligne que lui, juste à sa droite');

        // Elle SUIT la tonalité réelle — ce n'est pas un libellé figé.
        await page.evaluate(() => window.app.editeur.definirTonalite(-3, 'mineur'));
        await page.waitForTimeout(350);
        const t1 = await textesEnTete();
        check(t1.includes('C mineur') && !t1.includes('C majeur'),
            'changer la tonalité change ce qui s\'affiche (« C mineur »), armure identique mais mode différent');

        // --- 2. LE BANDEAU DU BAS -------------------------------------------------------------------
        const bas = await page.evaluate(() => ({
            selection: document.getElementById('info-selection').textContent,
            etiquette: document.querySelector('.etiquette-affichage')?.textContent,
            visible: (document.querySelector('.etiquette-affichage')?.getBoundingClientRect().width ?? 0) > 0,
        }));
        exiger(!/Corde/.test(bas.selection),
            'le bandeau du bas ne dit plus sur quelle corde on est — le curseur le montre déjà, souligné sur la corde visée');
        check(bas.etiquette === 'Affichage' && bas.visible,
            'et une étiquette « Affichage » dit enfin de quoi parlent les chiffres Auto/2/3/4/6/8');
        // La hauteur de la note, elle, doit RESTER : c'est le seul endroit où elle se lit en clair.
        await page.evaluate(() => { const ed = window.app.editeur; ed.placerCurseur(0, 0, 0); ed.saisirChiffre(5); ed.placerCurseur(0, 0, 0); });
        await page.waitForTimeout(300);
        check(/case 5/.test(await page.evaluate(() => document.getElementById('info-selection').textContent)),
            'la case et la hauteur sonnée restent affichées — la tablature dit « case 5 », pas « la »');

        // --- 3. LE RETOUR À LA LIGNE ----------------------------------------------------------------
        const systemes = () => page.evaluate(() =>
            window.app.page.ancrages.systemes.map(s => `${s.premiereMesure + 1}-${s.derniereMesure + 1}`));
        await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            for (let i = 0; i < 4; i++) ed.ajouterMesure(true);   // 8 mesures
            window.app.mesuresParLigne = 0;
            window.app.dessiner();
        });
        await page.waitForTimeout(300);
        const avant = await systemes();
        exiger(avant.length < 4, `au départ, le découpage automatique remplit les lignes (${avant.join(', ')})`);
        await page.evaluate(() => {
            const ed = window.app.editeur;
            for (const i of [2, 4, 6]) { ed.placerCurseur(i, 0, 0); ed.basculerSautDeLigne(); }
            window.app.dessiner();
        });
        await page.waitForTimeout(300);
        exiger((await systemes()).join('|') === '1-2|3-4|5-6|7-8',
            'un retour à la ligne avant les mesures 3, 5 et 7 donne quatre systèmes de deux mesures');

        // ET LE RÉGLAGE GLOBAL NE L'ÉCRASE PAS : c'est le cœur de ce point.
        await page.evaluate(() => { window.app.mesuresParLigne = 4; window.app.dessiner(); });
        await page.waitForTimeout(300);
        exiger((await systemes()).join('|') === '1-2|3-4|5-6|7-8',
            'choisir « Affichage = 4 » ne les recolle PAS : le découpage à compte fixe honore le saut lui aussi');
        await page.evaluate(() => { window.app.mesuresParLigne = 0; window.app.dessiner(); });

        const refus = await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.placerCurseur(0, 0, 0); ed.derniereErreur = null;
            return { ok: ed.basculerSautDeLigne(), erreur: ed.derniereErreur };
        });
        check(refus.ok === false && !!refus.erreur,
            'refusé sur la première mesure, avec un message : elle commence déjà une ligne');

        // --- 4. LES REPÈRES, dans UN bouton ---------------------------------------------------------
        const barre = await page.evaluate(() => ({
            replies: [...document.querySelectorAll('.barre-outils .btn-groupe-replie')].map(b => b.textContent),
            groupesEnLigne: [...document.querySelectorAll('.barre-outils .groupe-outils')]
                .filter(g => g.getBoundingClientRect().width > 0).map(g => g.dataset.groupe || 'ecriture'),
            debordeRangeeBasse: (() => {
                const r = document.querySelector('.rangee-outils-reste .rangee-outils-contenu');
                return r ? Math.round(r.scrollWidth - r.clientWidth) : null;
            })(),
        }));
        exiger(barre.replies.join('|') === 'Effets|Repères',
            'deux groupes seulement sont repliés derrière un bouton : Effets et Repères');
        check(!barre.groupesEnLigne.includes('repere'),
            'le groupe des repères n\'occupe donc plus la barre en ligne');
        check(barre.groupesEnLigne.includes('mesure'),
            'mais le groupe Mesure reste en ligne — dont le titre de section, laissé dehors comme demandé');

        await page.click('.btn-reperes-bascule');
        await page.waitForTimeout(250);
        const popover = await page.evaluate(() => {
            const g = document.querySelector('[data-groupe="repere"]');
            const r = g.getBoundingClientRect();
            return {
                actions: [...g.querySelectorAll('.btn-outil')].map(b => b.dataset.action),
                visible: r.width > 0 && r.height > 0,
                dansLEcran: r.left >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
            };
        });
        exiger(popover.visible && popover.dansLEcran, 'le clic les déplie dans un popover qui tient dans la fenêtre');
        // LES DEUX MAISONS se sont glissées ENTRE les deux barres de reprise, et c'est leur place :
        // une maison ne se lit qu'avec la reprise qu'elle sert, et on la cherche là où on vient de
        // poser le ‖: (voir maisons_test.js).
        // LA LEVÉE SUIT LES DEUX BARRES, et pas par hasard : c'est l'une d'elles qu'il faut avoir
        // posée pour qu'une levée soit acceptée en cours de morceau. Le bouton qui ouvre la porte
        // est le voisin immédiat de celui qui la franchit (voir levee_test.js).
        check(popover.actions.join(',') === 'repriseDebut,volta1,volta2,repriseFin,barreDouble,barreFinale,levee,'
            + 'repere-segno,repere-coda,repere-daCapo,repere-dalSegno,repere-alCoda,repere-fine',
            `et il réunit les deux reprises, les deux maisons, les deux barres, la levée et les six repères `
            + `de navigation — treize marques, un seul bouton (${popover.actions.join(',')})`);
        // LE TERNAIRE N'EST PLUS ICI (retour utilisateur : « il faut sortir le bouton ternaire du
        // bouton "Repère", et le placer à un endroit plus stratégique »). Un repère se pose SUR UNE
        // MESURE et dit où aller ; le ternaire se pose sur LE MORCEAU et dit comment le lire. Il a
        // rejoint le cadre « Écriture », auprès de la signature et de la tonalité — voir
        // ternaire_test.js, qui vérifie qu'il y est bien.
        check(!popover.actions.includes('ternaire'),
            'et le rythme ternaire n\'y figure PLUS : ce n\'est pas une marque de mesure');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);

        // Posés, ils arrivent dans le document ET sur la partition.
        const poses = await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.placerCurseur(0, 0, 0); ed.definirRepere('segno');
            ed.placerCurseur(1, 0, 0); ed.definirRepere('daCapo'); ed.definirBarre('double');
            ed.placerCurseur(2, 0, 0); ed.definirRepere('fine'); ed.definirBarre('finale');
            window.app.dessiner();
            return {
                reperes: ed.partition.mesures.map(m => m.repere),
                barres: ed.partition.mesures.map(m => m.barre),
                textes: [...document.querySelectorAll('#feuille text')].map(t => t.textContent),
            };
        });
        exiger(poses.reperes.slice(0, 3).join(',') === 'segno,daCapo,fine' && poses.barres[1] === 'double' && poses.barres[2] === 'finale',
            'les repères et les barres se posent bien sur les mesures visées');
        check(poses.textes.includes('D.C.') && poses.textes.includes('Fine'),
            'les instructions se gravent en clair sur la partition (D.C., Fine)');

        // Retaper le même repère l'ENLÈVE : les six partagent un seul emplacement par mesure, sans
        // cette bascule le bouton d'un repère déjà posé n'aurait plus aucun effet.
        check((await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.placerCurseur(1, 0, 0); ed.definirRepere('daCapo');
            return ed.partition.mesures[1].repere;
        })) === null, 'et retaper le même l\'enlève, comme n\'importe quel effet de la palette');

        // LA BANDE EST RÉSERVÉE : sans elle, un Segno se dessinait par-dessus les numéros de mesure.
        const bande = await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            window.app.dessiner();
            const sans = window.app.page.ancrages.systemes[0].yPortee;
            ed.placerCurseur(0, 0, 0); ed.definirRepere('segno');
            window.app.dessiner();
            return { sans, avec: window.app.page.ancrages.systemes[0].yPortee };
        });
        exiger(bande.avec > bande.sans,
            `un système qui porte un repère écarte sa portée pour lui faire place (${Math.round(bande.sans)} -> ${Math.round(bande.avec)}px)`);

        // --- 5. TOUT CELA SURVIT À L'ALLER-RETOUR .json ---------------------------------------------
        const allerRetour = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.placerCurseur(1, 0, 0); ed.basculerSautDeLigne(); ed.definirRepere('coda'); ed.definirBarre('finale');
            const relu = m.normaliser(JSON.parse(JSON.stringify(ed.partition)));
            // Et un fichier qui réclame un repère INCONNU doit se le voir refuser, pas le garder
            // sans jamais l'afficher.
            const truque = JSON.parse(JSON.stringify(ed.partition));
            truque.mesures[1].repere = 'alDenteFortissimo';
            truque.mesures[1].barre = 'pointillee';
            const borne = m.normaliser(truque);
            return {
                saut: relu.mesures[1].sautAvant, repere: relu.mesures[1].repere, barre: relu.mesures[1].barre,
                repereInconnu: borne.mesures[1].repere, barreInconnue: borne.mesures[1].barre,
            };
        });
        exiger(allerRetour.saut === true && allerRetour.repere === 'coda' && allerRetour.barre === 'finale',
            'saut de ligne, repère et barre survivent à l\'aller-retour .json — ce sont des champs de DOCUMENT');
        check(allerRetour.repereInconnu === null && allerRetour.barreInconnue === null,
            'et un fichier qui en réclame un inconnu se le voit refuser, plutôt que de le garder invisible');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
