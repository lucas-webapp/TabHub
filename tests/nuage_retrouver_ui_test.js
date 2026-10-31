// RETROUVER SES MORCEAUX — le geste, dans un vrai navigateur, sur un Firebase en mémoire (voir nuage_retrouver_test.js pour le
// moteur sans navigateur).
//
// CE QU'IL PROTÈGE. Retour utilisateur : « permets-moi de retrouver mes morceaux quoi qu'il arrive, vu qu'ils seront tous
// enregistrés dans le Firestore. Pour l'instant, je suis obligé de réimporter des JSON ». Trois situations où il fallait aller
// chercher ses fichiers, et ce que l'application doit faire désormais :
//   • APPAREIL VIDE (navigateur neuf, données effacées, autre machine) : une page blanche ne dit pas que des morceaux attendent
//     dans le nuage — la liste s'ouvre d'elle-même, UNE fois, et seulement si rien n'est encore écrit ;
//   • INDEX PERDU : les morceaux sont dans le nuage mais la liste est vide — ils sont retrouvés SEULS, et on le dit ;
//   • SUPPRIMÉ PAR ERREUR : « Supprimés récemment » les rend, d'un clic, au lieu de la console Firebase.
const path = require('path');
const { pathToFileURL } = require('url');
const creerHarnais = require('./_harness.js');
const { ouvrirApp, avecFauxFirebase, taper } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('retrouver ses morceaux (interface)');

plan(34);

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const UID = 'u1';
const cle = (id) => id.replace(/[^A-Za-z0-9_-]/g, '-');

(async () => {
    const S = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'model', 'score.js')).href);
    /** Un morceau tel que le moteur le range : { id, t, u, json }, et son entrée d'index. */
    function morceau(id, titre, u, supprime = false) {
        const p = S.creerPartition('guitare'); p.meta.titre = titre; p.meta.creeLe = id;
        return { doc: { id, t: titre, u, json: JSON.stringify(p) }, entree: { t: titre, u, i: id, d: supprime } };
    }
    /** Un script à injecter AVANT le chargement : le nuage contient déjà ces morceaux (`avecIndex: false` : leur index a disparu). */
    function peupler(liste, { avecIndex = true } = {}) {
        const docs = {}; const index = {};
        for (const m of liste) { docs[`users/${UID}/apps/tabhub__${cle(m.doc.id)}`] = m.doc; index[cle(m.doc.id)] = m.entree; }
        if (avecIndex) docs[`users/${UID}/apps/tabhub`] = { docs: index, maj: Math.max(...liste.map((m) => m.entree.u)) };
        return `Object.assign(window.__backend.docs, ${JSON.stringify(docs)});`;
    }
    const connecte = (extra = {}) => avecFauxFirebase({ uid: UID, nom: 'Testeur', dejaConnecte: true, ...extra });
    const trois = () => [morceau('2026-01-01T00:00:00.000Z', 'Premier riff', Date.now() - 3000), morceau('2026-01-02T00:00:00.000Z', 'Deuxième riff', Date.now() - 2000), morceau('2026-01-03T00:00:00.000Z', 'Troisième riff', Date.now() - 1000)];
    const etat = (page) => page.evaluate(() => ({
        ouverte: !document.getElementById('fenetre-nuage').hidden, accueil: !document.getElementById('nuage-accueil').hidden,
        titres: [...document.querySelectorAll('#nuage-liste .nuage-ligne-titre')].map((e) => e.textContent),
        nombre: document.getElementById('nuage-nombre').textContent,
        corbeille: [...document.querySelectorAll('#nuage-corbeille .nuage-ligne-titre')].map((e) => e.textContent),
        corbeilleVisible: !document.getElementById('nuage-corbeille-titre').hidden,
        message: document.getElementById('message').textContent, onglets: window.app.onglets.length,
    }));

    // ===== 1. APPAREIL VIDE, NUAGE PLEIN : LA LISTE S'OUVRE TOUTE SEULE ===============================================
    {
        const A = await ouvrirApp({ avant: [...connecte(), peupler(trois())] });
        try {
            await A.page.waitForFunction(() => !document.getElementById('fenetre-nuage').hidden, null, { timeout: 8000 }).catch(() => {});
            const e = await etat(A.page);
            exiger(e.ouverte, 'appareil vide, trois morceaux dans le nuage : la fenêtre du nuage s\'ouvre TOUTE SEULE');
            check(e.accueil, 'avec un mot d\'accueil : « tes morceaux t\'attendent dans le nuage »');
            check(e.titres.join() === 'Troisième riff,Deuxième riff,Premier riff' && e.nombre === '(3)', `la liste les montre, du plus récent au plus ancien, avec leur nombre (${e.nombre})`);
            check(e.onglets === 1, 'sans en ouvrir un seul d\'office : on choisit');
            // en ouvrir un
            await A.page.evaluate(() => [...document.querySelectorAll('#nuage-liste .nuage-ligne')].find((l) => l.textContent.includes('Deuxième riff')).querySelector('button').click());
            await A.page.waitForFunction(() => window.app.onglets.length === 2, null, { timeout: 5000 }).catch(() => {});
            const o = await A.page.evaluate(() => ({ n: window.app.onglets.length, titre: window.app.editeur.partition.meta.titre, fermee: document.getElementById('fenetre-nuage').hidden }));
            check(o.n === 2 && o.titre === 'Deuxième riff' && o.fermee, 'un clic sur « Ouvrir » ouvre le morceau dans un onglet et referme la fenêtre : plus aucun fichier à importer');
            // rouverte à la main : plus de mot d'accueil
            await A.page.evaluate(() => window.app.ouvrirNuage());
            check(!(await etat(A.page)).accueil, 'rouverte à la main plus tard, la fenêtre ne refait pas le mot d\'accueil');
            check(A.erreurs.length === 0, `aucune erreur JavaScript — ${A.erreurs.slice(0, 2).join(' | ')}`);
        } finally { await A.fermer(); }
    }

    // ===== 1b. ON A FERMÉ LA LISTE : UN NOUVEAU MORCEAU ARRIVE DE L'AUTRE APPAREIL, ELLE NE REVIENT PAS ========================
    {
        const A = await ouvrirApp({ avant: [...connecte(), peupler(trois())] });
        try {
            await A.page.waitForFunction(() => !document.getElementById('fenetre-nuage').hidden, null, { timeout: 8000 }).catch(() => {});
            await A.page.evaluate(() => window.app.fermerFenetres());
            const quatrieme = morceau('2026-01-04T00:00:00.000Z', 'Quatrième riff', Date.now() + 500);
            await A.page.evaluate((m) => {
                window.__backend.docs['users/u1/apps/tabhub__2026-01-04T00-00-00-000Z'] = m.doc;
                window.__backend.docs['users/u1/apps/tabhub'].docs['2026-01-04T00-00-00-000Z'] = m.entree;
                window.__backend.notifier('users/u1/apps/tabhub');
            }, quatrieme);
            await attendre(700);
            const e = await etat(A.page);
            check(!e.ouverte && e.titres.length === 4, `un morceau arrive d'un autre appareil pendant que la liste est fermée : elle est à jour (${e.titres.length}) mais ne se rouvre pas toute seule`);
        } finally { await A.fermer(); }
    }

    // ===== 1c. LE SEUL MORCEAU DU NUAGE EST CETTE PAGE BLANCHE ELLE-MÊME (anciennes versions) : RIEN À PROPOSER ===========
    {
        const A = await ouvrirApp({ avant: [...avecFauxFirebase({ uid: UID, nom: 'Testeur' })] });
        try {
            await A.page.evaluate(() => {
                const p = window.app.editeur.partition;
                const c = p.meta.creeLe.replace(/[^A-Za-z0-9_-]/g, '-');
                window.__backend.docs['users/u1/apps/tabhub__' + c] = { id: p.meta.creeLe, t: 'Sans titre', u: 1000, json: JSON.stringify(p) };
                window.__backend.docs['users/u1/apps/tabhub'] = { docs: { [c]: { t: 'Sans titre', u: 1000, i: p.meta.creeLe, d: false } }, maj: 1000 };
            });
            await A.page.click('#btn-nuage');
            await A.page.waitForFunction(() => document.getElementById('btn-nuage').dataset.point === 'synced', null, { timeout: 6000 }).catch(() => {});
            await attendre(900);
            const e = await etat(A.page);
            check(!e.ouverte && e.nombre === '(1)', `un « Sans titre » déposé par une ancienne version, et c'est CETTE page : la fenêtre ne s'ouvre pas pour si peu (${e.nombre})`);
        } finally { await A.fermer(); }
    }

    // ===== 2. ON A DÉJÀ COMMENCÉ À ÉCRIRE : ON N'INTERROMPT PAS ====================================================
    {
        // L'instantané du nuage arrive en retard : le temps d'écrire une note.
        const A = await ouvrirApp({ avant: [...connecte(), peupler(trois()), 'window.__backend.retardInstantane = 1800;'] });
        try {
            await taper(A.page, ['5']);
            await attendre(3200);
            const e = await etat(A.page);
            check(!e.ouverte, 'une note déjà écrite quand le nuage répond : la fenêtre ne s\'ouvre PAS (on n\'interrompt pas quelqu\'un qui travaille)');
            check(e.titres.length === 4 && e.titres.includes('Premier riff') && e.titres.includes('Sans titre'), `…mais la liste est prête : les trois anciens + le morceau en cours, devenu non vide (${e.titres.join(', ')})`);
        } finally { await A.fermer(); }
    }

    // ===== 3. L'INDEX A DISPARU : LES MORCEAUX SONT RETROUVÉS SEULS ====================================================
    {
        const A = await ouvrirApp({ avant: [...connecte(), peupler(trois(), { avecIndex: false })] });
        try {
            await A.page.waitForFunction(() => document.querySelectorAll('#nuage-liste .nuage-ligne').length === 3, null, { timeout: 8000 }).catch(() => {});
            const e = await etat(A.page);
            check(e.titres.length === 3 && e.ouverte, 'index perdu, morceaux intacts : les trois sont retrouvés SEULS et la liste s\'ouvre dessus — plus de JSON à réimporter');
            check(/3 morceaux retrouvés dans ton nuage/.test(e.message), `et l'application le DIT (« ${e.message} »)`);
            const dansLeNuage = await A.page.evaluate(() => Object.keys(window.__backend.docs['users/u1/apps/tabhub'].docs).length);
            check(dansLeNuage >= 3, 'l\'index du nuage est remis en ordre : il ne faudra pas recommencer sur le prochain appareil');
        } finally { await A.fermer(); }
    }

    // ===== 4. SUPPRIMÉ PAR ERREUR : « SUPPRIMÉS RÉCEMMENT » ===============================================================
    {
        const liste = [...trois().slice(0, 2), morceau('2026-01-09T00:00:00.000Z', 'Supprimé par erreur', Date.now() - 500, true)];
        const A = await ouvrirApp({ avant: [...connecte(), peupler(liste)] });
        try {
            await A.page.waitForFunction(() => !document.getElementById('fenetre-nuage').hidden, null, { timeout: 8000 }).catch(() => {});
            let e = await etat(A.page);
            check(e.titres.length === 2 && !e.titres.includes('Supprimé par erreur'), 'un morceau supprimé n\'est pas dans la liste principale');
            check(e.corbeilleVisible && e.corbeille.join() === 'Supprimé par erreur', 'mais il est dans « Supprimés récemment »');
            await A.page.evaluate(() => document.querySelector('#nuage-corbeille .nuage-ligne button').click());
            await A.page.waitForFunction(() => window.app.editeur.partition.meta.titre === 'Supprimé par erreur', null, { timeout: 6000 }).catch(() => {});
            const r = await A.page.evaluate(() => ({ fermee: document.getElementById('fenetre-nuage').hidden, titre: window.app.editeur.partition.meta.titre, n: window.app.onglets.length, d: window.__backend.docs['users/u1/apps/tabhub'].docs['2026-01-09T00-00-00-000Z'].d, msg: document.getElementById('message').textContent }));
            check(r.titre === 'Supprimé par erreur' && r.d === false && /restauré/.test(r.msg), `« Restaurer » le rend à la liste ET le rouvre (index : d = ${r.d}, message : « ${r.msg} »)`);
            check(r.fermee, 'et la fenêtre se referme sur le morceau rouvert (on ne reste pas devant la liste)');
            await A.page.evaluate(() => window.app.ouvrirNuage());
            e = await etat(A.page);
            check(!e.corbeille.length && !e.corbeilleVisible && e.titres.includes('Supprimé par erreur'), 'et la corbeille se vide : il est maintenant dans la liste principale');
        } finally { await A.fermer(); }
    }

    // ===== 5. SUPPRIMER DEPUIS L'APPLICATION, PUIS RESTAURER =====================================================
    {
        const A = await ouvrirApp({ avant: [...connecte(), peupler(trois())] });
        try {
            await A.page.waitForFunction(() => !document.getElementById('fenetre-nuage').hidden, null, { timeout: 8000 }).catch(() => {});
            await A.page.evaluate(() => [...document.querySelectorAll('#nuage-liste .nuage-ligne')].find((l) => l.textContent.includes('Premier riff')).querySelectorAll('button')[1].click());
            await A.page.waitForSelector('#fenetre-dialogue:not([hidden])', { timeout: 4000 });
            const texte = await A.page.evaluate(() => document.getElementById('fenetre-dialogue').innerText);
            check(/Supprimés récemment/.test(texte) && !/console Firebase/.test(texte), 'la confirmation de suppression renvoie à « Supprimés récemment » et plus à la console Firebase');
            await A.page.evaluate(() => [...document.querySelectorAll('#fenetre-dialogue .dialogue-actions button')].find((b) => b.textContent.trim() === 'Supprimer').click());
            await A.page.waitForFunction(() => document.querySelectorAll('#nuage-corbeille .nuage-ligne').length === 1, null, { timeout: 5000 }).catch(() => {});
            let e = await etat(A.page);
            check(e.corbeille.join() === 'Premier riff' && e.titres.length === 2 && e.nombre === '(2)', 'supprimé : le morceau passe dans « Supprimés récemment » et le compte tombe à 2');
            await A.page.evaluate(() => document.querySelector('#nuage-corbeille .nuage-ligne button').click());
            await A.page.waitForFunction(() => window.app.editeur.partition.meta.titre === 'Premier riff', null, { timeout: 6000 }).catch(() => {});
            check(await A.page.evaluate(() => window.app.editeur.partition.meta.titre) === 'Premier riff', 'et restauré aussitôt, sans rien perdre');
        } finally { await A.fermer(); }
    }

    // ===== 6. « RETROUVER MES MORCEAUX » À LA DEMANDE ===================================================================
    {
        const liste = trois();
        // l'index n'en nomme que deux : le troisième est dans le nuage, invisible
        const A = await ouvrirApp({ avant: [...connecte(), peupler(liste), `delete window.__backend.docs['users/u1/apps/tabhub'].docs['${cle(liste[2].doc.id)}'];`] });
        try {
            await attendre(900);
            await A.page.evaluate(() => window.app.ouvrirNuage());
            let e = await etat(A.page);
            check(e.titres.length === 2 && !e.titres.includes('Troisième riff'), 'un morceau manque à la liste (le nuage l\'a, l\'index ne le nomme plus)');
            await A.page.click('#nuage-retrouver');
            await A.page.waitForFunction(() => document.querySelectorAll('#nuage-liste .nuage-ligne').length === 3, null, { timeout: 5000 }).catch(() => {});
            e = await etat(A.page);
            check(e.titres.includes('Troisième riff') && /1 morceau retrouvé/.test(e.message), `« Retrouver mes morceaux » le remet dans la liste, et le dit (« ${e.message} »)`);
            check(await A.page.evaluate(() => { const b = document.getElementById('nuage-retrouver'); return !b.disabled && /Retrouver mes morceaux/.test(b.textContent); }),
                'une fois la recherche finie, le bouton redevient « Retrouver mes morceaux » et se laisse cliquer à nouveau');
            await A.page.click('#nuage-retrouver'); await attendre(500);
            check(/liste est complète/.test((await etat(A.page)).message), 'une seconde recherche dit que la liste est complète');
        } finally { await A.fermer(); }
    }

    // ===== 7. SANS CONNEXION ===========================================================================================
    {
        const A = await ouvrirApp({ avant: [...avecFauxFirebase({ uid: UID, nom: 'Testeur' }), peupler(trois())] });
        try {
            await attendre(600);
            await A.page.evaluate(() => window.app.ouvrirNuage());
            await A.page.click('#nuage-retrouver'); await attendre(300);
            const e = await etat(A.page);
            check(/Connecte-toi/.test(e.message) && e.titres.length === 0 && !e.corbeilleVisible, 'pas connecté : rien n\'est listé, et « Retrouver » dit de se connecter d\'abord (elle ne plante pas, ne propose rien de faux)');
            check(!e.accueil, 'et la fenêtre ne s\'est pas ouverte d\'elle-même : elle n\'a rien à proposer sans compte');
        } finally { await A.fermer(); }
    }

    // ===== 8. TÉLÉPHONE ================================================================================================
    {
        const liste = [...trois(), morceau('2026-01-09T00:00:00.000Z', 'Supprimé par erreur', Date.now() - 500, true)];
        const A = await ouvrirApp({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, avant: [...connecte(), peupler(liste)] });
        try {
            await A.page.waitForFunction(() => !document.getElementById('fenetre-nuage').hidden, null, { timeout: 8000 }).catch(() => {});
            const g = await A.page.evaluate(() => {
                const f = document.querySelector('#fenetre-nuage .fenetre').getBoundingClientRect();
                const bs = [...document.querySelectorAll('#fenetre-nuage .nuage-ligne button, #nuage-retrouver')].map((b) => b.getBoundingClientRect());
                return { debord: document.documentElement.scrollWidth - innerWidth, dedans: bs.every((r) => r.left >= f.left - 1 && r.right <= f.right + 1), hmin: Math.round(Math.min(...bs.map((r) => r.height))), n: bs.length };
            });
            check(g.debord <= 0 && g.dedans && g.n >= 8, `sur téléphone (390 px) : la fenêtre ne déborde pas et tous ses boutons restent dedans (${g.n} boutons)`);
            check(g.hmin >= 32, `et les boutons se visent au doigt (le plus bas : ${g.hmin} px)`);
            check(A.erreurs.length === 0, `aucune erreur JavaScript — ${A.erreurs.slice(0, 2).join(' | ')}`);
        } finally { await A.fermer(); }
    }
    // ===== 9. UNE PAGE BLANCHE N'EST PAS UN MORCEAU ======================================================================
    {
        const A = await ouvrirApp({ avant: [...connecte()] });
        try {
            await A.page.waitForFunction(() => document.getElementById('btn-nuage').dataset.point === 'synced', null, { timeout: 6000 }).catch(() => {});
            await attendre(900);
            const morceauxDuNuage = () => A.page.evaluate(() => Object.keys(window.__backend.docs).filter((c) => c.indexOf('__') >= 0));
            check((await morceauxDuNuage()).length === 0, 'connecté sur une page blanche : RIEN n\'est déposé dans le nuage (plus de « Sans titre » à chaque ouverture)');
            await A.page.click('.en-tete-titre'); await attendre(250);          // le titre se saisit dans le panneau d'en-tête, sur la feuille
            await A.page.fill('#champ-en-tete-titre', 'Mon idée');
            await A.page.waitForFunction(() => Object.keys(window.__backend.docs).some((c) => c.indexOf('__') >= 0), null, { timeout: 6000 }).catch(() => {});
            check((await morceauxDuNuage()).length === 1, 'un titre donné, même sans note : le morceau part (il y a quelque chose à garder)');
            await A.page.fill('#champ-en-tete-titre', '');
            await A.page.waitForFunction(() => { const c = Object.keys(window.__backend.docs).find((k) => k.indexOf('__') >= 0); return c && JSON.parse(window.__backend.docs[c].json).meta.titre === ''; }, null, { timeout: 6000 }).catch(() => {});
            const titreNuage = await A.page.evaluate(() => { const c = Object.keys(window.__backend.docs).find((k) => k.indexOf('__') >= 0); return JSON.parse(window.__backend.docs[c].json).meta.titre; });
            check(titreNuage === '', 'et si l\'on EFface ensuite ce que le nuage connaît déjà, le nuage le sait aussi (il ne garde pas l\'ancien titre)');
        } finally { await A.fermer(); }
    }
    bilan();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
