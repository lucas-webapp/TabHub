// Banc du COPIER/COLLER D'UNE MESURE (retour utilisateur : « permets-moi de copier/coller une mesure
// complète avec clic droit, et de l'insérer là où je le souhaite »).
//
// CE QU'IL PROTÈGE VRAIMENT. Dupliquer une mesure est la partie facile ; ce banc existe pour les deux
// pièges qui ne se voient qu'à l'usage, et tous deux SILENCIEUSEMENT :
//
//   1. LES CORDES. Une mesure de guitare collée dans une basse porte des notes sur des cordes qui
//      n'existent pas. Elles ne s'afficheraient nulle part (aucune ligne pour les recevoir) tout en
//      restant dans le document — et en sonnant. Elles sont écartées, et leur nombre ANNONCÉ : une
//      copie amputée qu'on croit fidèle est pire qu'un refus.
//
//   2. LA SIGNATURE. Une mesure de 4 temps collée au milieu d'un passage en 3/4 doit garder SA
//      signature, sinon sa somme ne correspond plus à sa capacité. Mais la poser telle quelle la
//      propagerait à TOUTE LA SUITE du morceau (signatureEffective remonte à la dernière mesure qui
//      en fixe une) : coller une mesure au milieu d'un morceau en changerait donc la fin. Le banc
//      vérifie que le changement reste LOCAL, mesure par mesure, sur toute la longueur.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('copier/coller une mesure');

(async () => {
    plan(16);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // --- 1. Le clic droit propose bien les trois entrées, et les collages seulement s'il y a
        //     quelque chose à coller ------------------------------------------------------------------
        const pointMesure = (i) => page.evaluate((i) => {
            const svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect();
            const a = window.app.page.ancrages.mesures.find(x => x.index === i);
            return {
                x: b.left + ((a.x + a.xFin) / 2 / window.app.page.largeur) * b.width,
                y: b.top + (a.yTab / window.app.page.hauteur) * b.height,
            };
        }, i);
        const entreesMenu = () => page.evaluate(() =>
            [...document.querySelectorAll('#menu-contextuel button')].map(b => b.textContent));

        await page.evaluate(() => { window.app.editeur.presseMesures = null; });
        let p = await pointMesure(0);
        await page.mouse.click(p.x, p.y, { button: 'right' });
        await page.waitForTimeout(250);
        const sansCopie = await entreesMenu();
        exiger(sansCopie.includes('Copier cette mesure'), 'le clic droit propose « Copier cette mesure »');
        check(!sansCopie.some(t => /Coller/.test(t)),
            'et AUCUN « Coller » tant que rien n\'est copié — une entrée grise n\'apprendrait qu\'une chose : qu\'elle ne sert pas');

        await page.click('#menu-contextuel button:has-text("Copier cette mesure")');
        await page.waitForTimeout(200);
        p = await pointMesure(0);
        await page.mouse.click(p.x, p.y, { button: 'right' });
        await page.waitForTimeout(250);
        const avecCopie = await entreesMenu();
        // TROIS COLLAGES, et non plus deux : « ici (remplace) » a rejoint les deux insertions, et il
        // est le DÉFAUT (Ctrl+V). On recopie sur des mesures qui existent déjà, vides et en attente ;
        // y insérer laisse derrière autant de mesures vides qu'on en a collé, à supprimer une à une.
        check(avecCopie.includes('Coller la mesure ici (remplace)')
            && avecCopie.includes('Coller la mesure avant (en insérant)')
            && avecCopie.includes('Coller la mesure après (en insérant)'),
            `une fois une mesure copiée, les trois collages apparaissent — remplacer, avant, après `
            + `(${avecCopie.filter(t => /Coller/.test(t)).join(' | ')})`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);

        // --- 2. Le collage duplique vraiment le contenu, et n'écrase rien ----------------------------
        const r = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [3, 5, 7, 9].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)]));
            ed.partition.mesures[1].voix[0].evenements = [m.creerEvenement({ valeur: 1 }, [m.creerNote(0, 12)])];
            ed.curseur = { mesure: 0, voix: 0, evenement: 0, corde: 0 };
            const avant = ed.partition.mesures.length;
            ed.copierMesures();
            const bilan = ed.collerMesures(ed.curseur.mesure + 1, { inserer: true });
            const lire = (i) => ed.partition.mesures[i].voix[0].evenements.map(e => e.notes[0] ? e.notes[0].frette : '_').join(',');
            return { avant, apres: ed.partition.mesures.length, bilan,
                     m0: lire(0), m1: lire(1), m2: lire(2), curseur: ed.curseur.mesure };
        });
        exiger(r.apres === r.avant + 1 && r.m1 === '3,5,7,9',
            'coller après insère UNE mesure, copie fidèle de l\'originale');
        check(r.m0 === '3,5,7,9', 'l\'originale est intacte');
        check(r.m2 === '12', 'et ce qui suivait a simplement glissé d\'un cran — rien d\'écrasé');
        check(r.curseur === 1, 'le curseur se pose sur la mesure collée, prêt à y travailler');
        check(r.bilan.abandonnees === 0, 'aucune note écartée entre deux guitares, évidemment');

        // Annuler doit rendre le morceau tel qu'il était : coller est UNE action d'historique.
        const annule = await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.annuler();
            return ed.partition.mesures.length;
        });
        check(annule === r.avant, 'et Ctrl+Z retire la mesure collée d\'un seul coup');

        // --- 3. PIÈGE DES CORDES : guitare -> basse ---------------------------------------------------
        const cordes = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            // Un accord sur la corde 0 (existe partout) ET la corde 5 (la 6e — absente d'une basse 4).
            ed.partition.mesures[0].voix[0].evenements = [m.creerEvenement({ valeur: 1 }, [m.creerNote(0, 3), m.creerNote(5, 3)])];
            ed.curseur = { mesure: 0, voix: 0, evenement: 0, corde: 0 };
            ed.copierMesures();
            ed.definirInstrument('basse4');
            const bilan = ed.collerMesures(ed.curseur.mesure + 1, { inserer: true });
            const collee = ed.partition.mesures[ed.curseur.mesure].voix[0].evenements[0];
            return { abandonnees: bilan.abandonnees, cordes: collee.notes.map(n => n.corde), silence: !!collee.silence };
        });
        exiger(cordes.abandonnees === 1 && cordes.cordes.join(',') === '0',
            'collée dans une basse 4 cordes, la note posée sur la 6e corde est ÉCARTÉE, pas gardée en douce');
        check(cordes.silence === false, 'et l\'évènement reste une note, puisqu\'il lui en reste une');

        // --- 4. PIÈGE DE LA SIGNATURE : un 4/4 collé au milieu d'un 3/4 -------------------------------
        const sig = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');                     // 4 mesures en 4/4
            ed.curseur = { mesure: 0, voix: 0, evenement: 0, corde: 0 };
            ed.copierMesures();                         // on copie une mesure EN 4/4
            ed.curseur.mesure = 1;
            ed.definirSignature(3, 4);                 // la mesure 1 et toute la suite passent en 3/4
            // L'écart à la capacité AVANT le collage, mesure par mesure. Il n'est pas nul partout :
            // `definirSignature` ne réécrit pas le contenu des mesures qu'elle reclasse (c'est le rôle
            // d'⇥ Corriger, une commande à part) — trois mesures portent donc ici 4 temps dans un
            // moule de 3. C'est un état préexistant, étranger au collage : ce qu'on vérifie, c'est que
            // le collage ne l'AGGRAVE pas et n'en crée pas de nouveau.
            const ecarts = () => ed.partition.mesures.map((mes, i) =>
                +(m.dureeEcrite(mes, 0) - m.capaciteMesure(ed.partition, i)).toFixed(6));
            const avant = ecarts();
            ed.curseur.mesure = 1;
            ed.collerMesures(ed.curseur.mesure + 1, { inserer: true });                     // le 4/4 se colle AU MILIEU du 3/4
            const lues = ed.partition.mesures.map((_, i) => {
                const s = m.signatureEffective(ed.partition, i);
                return `${s.battements}/${s.unite}`;
            });
            const apres = ecarts();
            const iCollee = ed.curseur.mesure;
            return {
                lues,
                ecartCollee: apres[iCollee],
                // Les écarts des AUTRES mesures, dans l'ordre, doivent être exactement ceux d'avant.
                autresInchanges: JSON.stringify(apres.filter((_, i) => i !== iCollee)) === JSON.stringify(avant),
            };
        });
        exiger(sig.lues[2] === '4/4', 'la mesure collée GARDE sa propre signature (4/4), sa somme en dépend');
        check(sig.lues[3] === '3/4' && sig.lues.slice(3).every(x => x === '3/4'),
            'et la suite du morceau retrouve la sienne : le changement reste LOCAL, il ne descend pas jusqu\'à la fin');
        check(sig.ecartCollee === 0,
            'la mesure collée somme exactement sa capacité — c\'est bien sa signature d\'origine qui la mesure');
        check(sig.autresInchanges,
            'et le collage ne change l\'équilibre d\'AUCUNE autre mesure : il insère, il ne retouche rien autour');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
