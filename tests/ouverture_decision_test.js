// Banc de L'OUVERTURE D'UN FICHIER DÉJÀ CONNU — comparer les deux versions, puis décider.
//
// LE DÉFAUT. Ouvrir le MÊME morceau et ouvrir un AUTRE morceau passaient par la même porte, avec la
// même question : « ceci va écraser le morceau en cours, continuer ? ». Or réouvrir « Étude » alors
// qu'« Étude » est déjà ouvert n'est presque jamais une demande d'écrasement : c'est qu'on ne sait
// plus laquelle des deux versions est la bonne. La question à poser est « laquelle ? », pas
// « êtes-vous sûr ? » — et pour y répondre il faut VOIR ce qui les distingue.
//
// L'IDENTITÉ, EN DEUX TEMPS, et le second répare un vrai défaut relevé côté HarmoHub :
//   1. la DATE DE CRÉATION, la plus sûre — elle naît avec le document et survit aux renommages ;
//   2. le TITRE à défaut. Un fichier reçu d'ailleurs, ou reconstruit, n'a pas la même date de
//      création : sans ce repli, l'appli ne voyait AUCUN conflit et empilait un morceau de plus sous
//      le même titre. C'est la racine du « beaucoup de fois le même titre, seules les dates
//      changent ».
//
// ET « GARDER LES DEUX » EST ICI UN ONGLET, pas une copie renommée. C'est l'adaptation à TabHub :
// là où HarmoHub doit poser « Titre (import du 14/09/2025) » au milieu de sa bibliothèque — et où
// deux imports plus tard on ne sait plus lequel est le bon — les deux versions s'ouvrent côte à côte
// et se comparent à l'œil.
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('ouverture : quelle version');

(async () => {
    plan(12);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // ─────────── L'identité ───────────
        const identite = await page.evaluate(async () => {
            const sc = await import('/src/model/score.js');
            const app = window.app;
            const base = sc.creerPartition('guitare');
            base.meta.titre = 'Étude'; base.meta.creeLe = '2026-01-01T10:00:00.000Z';
            const jumeau = { ...sc.creerPartition('guitare'), meta: { ...base.meta } };
            const memeTitreAutreDate = sc.creerPartition('guitare');
            memeTitreAutreDate.meta.titre = '  étude  ';   // casse et espaces indifférentes
            memeTitreAutreDate.meta.creeLe = '2025-05-05T10:00:00.000Z';
            const numerote = sc.creerPartition('guitare');
            numerote.meta.titre = 'Étude (2)';
            numerote.meta.creeLe = '2025-05-05T10:00:00.000Z';
            const autre = sc.creerPartition('guitare');
            autre.meta.titre = 'Prélude';
            autre.meta.creeLe = '2025-05-05T10:00:00.000Z';
            return {
                creation: app.memeMorceau(base, jumeau),
                titre: app.memeMorceau(base, memeTitreAutreDate),
                numerote: app.memeMorceau(base, numerote),
                autre: app.memeMorceau(base, autre),
            };
        });
        check(identite.creation === 'creation',
            `LA DATE DE CRÉATION d'abord : elle naît avec le document et survit aux renommages (lu : ${identite.creation})`);
        check(identite.titre === 'titre',
            `LE TITRE EN REPLI, casse et espaces indifférentes — sans lui, un fichier reçu d'ailleurs (autre date de création) ne déclenchait AUCUN conflit, et l'appli empilait un morceau de plus sous le même titre (lu : ${identite.titre})`);
        check(identite.numerote === null,
            `mais « Étude (2) » reste DISTINCT : c'est un nom qu'on a choisi, pas une collision (lu : ${JSON.stringify(identite.numerote)})`);
        check(identite.autre === null, 'et deux morceaux différents ne sont pas confondus');

        // ─────────── La fenêtre montre ce qui distingue ───────────
        const prepare = `(async () => {
            const sc = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.partition.meta.titre = 'Étude';
            ed.partition.meta.creeLe = '2026-01-01T10:00:00.000Z';
            ed.partition.meta.modifieLe = '2026-02-01T10:00:00.000Z';
            const venu = sc.creerPartition('guitare');
            venu.meta.titre = 'Étude';
            venu.meta.creeLe = '2026-01-01T10:00:00.000Z';
            venu.meta.modifieLe = '2026-03-01T10:00:00.000Z';   // le FICHIER est le plus récent
            venu.mesures.push(sc.creerMesure(), sc.creerMesure());
            window.__venu = venu;
            return JSON.stringify(venu);
        })`;
        const json = await page.evaluate((p) => eval(p)(), prepare);

        const fenetre = await (async () => {
            const attente = page.waitForSelector('.voile:not([hidden]) .fenetre', { timeout: 5000 }).catch(() => null);
            page.evaluate(() => window.app.demanderVersionAOuvrir(window.app.editeur.partition, window.__venu, 'creation')
                .then(c => { window.__choix = c; }));
            await attente;
            return page.evaluate(() => {
                const v = [...document.querySelectorAll('.voile')].find(x => !x.hidden);
                if (!v) return null;
                return { titre: v.querySelector('h2,.fenetre-tete')?.textContent.trim() || '',
                         texte: v.textContent,
                         boutons: [...v.querySelectorAll('.fenetre-pied button, button[data-cle]')].map(b => b.textContent.trim()) };
            });
        })();
        exiger(!!fenetre, 'la fenêtre comparative s\'ouvre');
        check(/modifié le/.test(fenetre.texte) && /mesures/.test(fenetre.texte),
            'elle MONTRE ce qui distingue les deux versions — date de dernière modification et nombre de mesures. Demander « écraser ? » sans montrer laquelle est la plus récente oblige à deviner, et c\'est ainsi qu\'on écrase le bon fichier');
        check(/Le fichier est le plus récent/.test(fenetre.texte),
            `et elle le DIT en clair, au lieu de laisser comparer deux dates à la main (texte : « …${fenetre.texte.match(/Le fichier[^.]*\./)?.[0] || '—'} »)`);
        check(fenetre.boutons.length === 3 && fenetre.boutons.some(b => /nouvel onglet/i.test(b)),
            `TROIS ISSUES, dont « garder les deux » — qui ouvre un ONGLET plutôt que de renommer une copie au milieu de la bibliothèque, comme doit le faire HarmoHub (lu : ${JSON.stringify(fenetre.boutons)})`);

        await page.evaluate(() => {
            const v = [...document.querySelectorAll('.voile')].find(x => !x.hidden);
            [...v.querySelectorAll('button')].find(b => /nouvel onglet/i.test(b.textContent))?.click();
        });
        await page.waitForTimeout(150);
        check(await page.evaluate(() => window.__choix) === 'deuxCopies', 'et le choix remonte bien');

        // ─────────── Garder les deux : un onglet de plus, rien de renommé ───────────
        const deuxOnglets = await page.evaluate(async (json) => {
            const app = window.app;
            const avant = app.onglets.length;
            const fichier = new File([json], 'x.json', { type: 'application/json' });
            // On répond « garder les deux » à la fenêtre qui va s'ouvrir.
            const attendu = new Promise((resolve) => {
                const minuteur = setInterval(() => {
                    const v = [...document.querySelectorAll('.voile')].find(x => !x.hidden);
                    const b = v && [...v.querySelectorAll('button')].find(x => /nouvel onglet/i.test(x.textContent));
                    if (b) { clearInterval(minuteur); b.click(); resolve(); }
                }, 50);
                setTimeout(() => { clearInterval(minuteur); resolve(); }, 4000);
            });
            const fini = app.chargerFichier(fichier);
            await attendu; await fini;
            return { avant, apres: app.onglets.length, actif: app.ongletActif,
                     titre: app.editeur.partition.meta.titre,
                     mesures: app.editeur.partition.mesures.length };
        }, json);
        check(deuxOnglets.apres === deuxOnglets.avant + 1 && deuxOnglets.actif === deuxOnglets.apres - 1,
            `« GARDER LES DEUX » OUVRE UN ONGLET et s'y place (${deuxOnglets.avant} → ${deuxOnglets.apres})`);
        check(deuxOnglets.titre === 'Étude' && deuxOnglets.mesures === 6,
            `et c'est bien le FICHIER qui s'y trouve, sous son vrai nom — rien n'est renommé, rien n'est enterré (lu : « ${deuxOnglets.titre} », ${deuxOnglets.mesures} mesures)`);

        // ─────────── Ne rien changer ───────────
        const ignore = await page.evaluate(async (json) => {
            const app = window.app;
            const avant = { onglets: app.onglets.length, mesures: app.editeur.partition.mesures.length };
            const fichier = new File([json], 'x.json', { type: 'application/json' });
            const attendu = new Promise((resolve) => {
                const m = setInterval(() => {
                    const v = [...document.querySelectorAll('.voile')].find(x => !x.hidden);
                    const b = v && [...v.querySelectorAll('button')].find(x => /Ne rien changer/i.test(x.textContent));
                    if (b) { clearInterval(m); b.click(); resolve(); }
                }, 50);
                setTimeout(() => { clearInterval(m); resolve(); }, 4000);
            });
            const fini = app.chargerFichier(fichier);
            await attendu; await fini;
            return { avant, onglets: app.onglets.length, mesures: app.editeur.partition.mesures.length };
        }, json);
        check(ignore.onglets === ignore.avant.onglets && ignore.mesures === ignore.avant.mesures,
            `« NE RIEN CHANGER » ne change RIEN : ni onglet de plus, ni morceau remplacé (${ignore.avant.onglets} onglets, ${ignore.mesures} mesures, inchangés)`);

        check(erreurs.length === 0, `aucune erreur JavaScript${erreurs.length ? ' — ' + erreurs.join(' | ') : ''}`);
    } finally { await fermer(); }
    bilan();
})();
