// Banc des DEUX FENÊTRES — la même application ouverte deux fois.
//
// POURQUOI CE BANC EXISTE. Tout ce que TabHub garde en dehors de la page est PARTAGÉ par toutes ses
// fenêtres : `localStorage` (le brouillon, les préférences, les repères) et le dossier de rangement
// sont communs à l'origine entière. Chaque mécanisme éprouvé ailleurs l'a été dans UNE fenêtre ; ici
// on en ouvre deux, et on regarde ce qui se passe entre elles.
//
// DEUX DANGERS, ET ILS NE SE RESSEMBLENT PAS :
//
//   LE BROUILLON S'ÉCRASE. `localStorage` n'a qu'une clé pour deux fenêtres. Chacune y écrivant
//   « ses » onglets, la dernière à écrire gagnait, et au rechargement suivant le travail de l'autre
//   avait disparu — sans un mot. C'est une perte SILENCIEUSE, exactement ce que le brouillon existe
//   pour empêcher. La parade est de FUSIONNER au lieu d'écraser (voir main.js#_fusionnerBrouillon),
//   sans jamais ressusciter un onglet qu'on a délibérément fermé.
//
//   LE FICHIER SUR LE DISQUE DIVERGE. Deux fenêtres sur le même morceau écrivent le même fichier
//   canonique. La seconde à enregistrer écraserait le travail de la première — sauf que le garde-fou
//   LIT avant d'écrire (voir io/fichiers.js#etatFichierSurDisque) et refuse. C'est LE cas qu'il vise,
//   et il n'était éprouvé que par ses pièces : ce banc le joue de bout en bout, avec deux vraies
//   pages.
const creerHarnais = require('./_harness.js');
const { ouvrirApp, chargerPlaywright, URL_BASE } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('deux fenêtres');

(async () => {
    plan(14);
    // DEUX PAGES DANS LE MÊME CONTEXTE, et c'est la seule façon de reproduire le cas : deux contextes
    // Playwright distincts ont chacun leur `localStorage` et leur origine privée, donc ne partagent
    // RIEN — le banc passerait sans rien éprouver.
    const { chromium } = chargerPlaywright();
    const navigateur = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    const contexte = await navigateur.newContext({ viewport: { width: 1320, height: 880 } });
    const erreurs = [];
    const ouvrir = async (nom) => {
        const page = await contexte.newPage();
        page.on('pageerror', e => erreurs.push(`${nom} : ${e.message}`));
        await page.goto(URL_BASE + '/index.html');
        await page.waitForFunction(() => window.app && window.app.page, { timeout: 15000 });
        return page;
    };
    try {
        const a = await ouvrir('A');
        // Fenêtre A : un morceau nommé, enregistré dans le brouillon.
        await a.evaluate(async () => {
            localStorage.clear();
            window.app.editeur.partition.meta.titre = 'Morceau de A';
            window.app.editeur.partition.meta.creeLe = '2026-01-01T00:00:00.000Z';
            window.app._connusIci.clear();
            window.app._connusIci.add('2026-01-01T00:00:00.000Z');
            window.app._ecrireBrouillon();
        });
        const b = await ouvrir('B');
        // Fenêtre B : elle a relu le brouillon de A, puis ouvre SON propre morceau à côté.
        const vueDeB = await b.evaluate(() => window.app.onglets.length);
        await b.evaluate(async () => {
            window.app.nouvelOnglet();
            window.app.editeur.partition.meta.titre = 'Morceau de B';
            window.app.editeur.partition.meta.creeLe = '2026-02-02T00:00:00.000Z';
            window.app._ecrireBrouillon();
        });
        exiger(vueDeB >= 1, 'la seconde fenêtre s\'ouvre et relit le brouillon');

        // ─────────── Le brouillon FUSIONNE au lieu d'écraser ───────────
        const apresB = await b.evaluate(() => JSON.parse(localStorage.getItem('tabhub.brouillon')).onglets.map(p => p.meta.titre));
        check(apresB.includes('Morceau de A') && apresB.includes('Morceau de B'),
            `après l'écriture de B, le brouillon porte LES DEUX morceaux (lu : ${JSON.stringify(apresB)})`);

        // A écrit à son tour : c'est le moment où l'écrasement avait lieu.
        await a.evaluate(() => { window.app.editeur.partition.meta.tempo = 111; window.app._ecrireBrouillon(); });
        const apresA = await a.evaluate(() => JSON.parse(localStorage.getItem('tabhub.brouillon')).onglets.map(p => p.meta.titre));
        check(apresA.includes('Morceau de A') && apresA.includes('Morceau de B'),
            `ET APRÈS QUE A A ÉCRIT À SON TOUR, les deux sont TOUJOURS là. C'est ici que le travail de B disparaissait : A écrivait « ses » onglets par-dessus tout, et personne ne s'en apercevait avant le rechargement suivant (lu : ${JSON.stringify(apresA)})`);
        const aJour = await a.evaluate(() => JSON.parse(localStorage.getItem('tabhub.brouillon')).onglets.find(p => p.meta.titre === 'Morceau de A').meta.tempo);
        check(aJour === 111,
            `et la version de A y est BIEN LA SIENNE, à jour — fusionner ne veut pas dire garder l'ancienne (tempo ${aJour})`);

        // ─────────── Fermer n'est pas perdre, et ce qu'on ferme ne revient pas ───────────
        const ferme = await b.evaluate(async () => {
            // B ferme SON onglet (celui de B), en gardant celui qu'il avait hérité de A.
            const i = window.app.onglets.length - 1;
            window.app._connusIci.add(window.app._cleMorceau(window.app.editeur.partition));
            window.app.onglets.splice(i, 1);
            window.app.ongletActif = 0;
            window.app._installerOnglet ? window.app._installerOnglet(0) : null;
            window.app._ecrireBrouillon();
            return JSON.parse(localStorage.getItem('tabhub.brouillon')).onglets.map(p => p.meta.titre);
        });
        check(!ferme.includes('Morceau de B'),
            `un onglet FERMÉ disparaît du brouillon (lu : ${JSON.stringify(ferme)})`);
        const pasDeRetour = await b.evaluate(() => {
            window.app._ecrireBrouillon();
            window.app._ecrireBrouillon();
            return JSON.parse(localStorage.getItem('tabhub.brouillon')).onglets.map(p => p.meta.titre);
        });
        check(!pasDeRetour.includes('Morceau de B'),
            `ET IL NE REVIENT PAS aux écritures suivantes. C'est le piège de la fusion : sans mémoire de ce qu'on a tenu, un onglet fermé serait repris pour « le morceau d'une autre fenêtre » et ressusciterait aussitôt (lu : ${JSON.stringify(pasDeRetour)})`);
        check(pasDeRetour.includes('Morceau de A'),
            'tandis que le morceau de l\'autre fenêtre, lui, est toujours là — il est toujours ouvert quelque part');

        // ─────────── Le garde-fou du disque, entre deux fenêtres ───────────
        const poser = `(async (nomRacine) => {
            const opfs = await navigator.storage.getDirectory();
            const racine = await opfs.getDirectoryHandle(nomRacine, { create: true });
            window.__racine = racine;
            window.showDirectoryPicker = async () => racine;
            const f = await import('/src/io/fichiers.js');
            await f.choisirDossier();
            return true;
        })`;
        await a.evaluate((p) => eval(p)('EssaiDeuxFenetres'), poser);
        await b.evaluate((p) => eval(p)('EssaiDeuxFenetres'), poser);

        // Les DEUX fenêtres ouvrent le même morceau — même date de création, donc même fichier.
        const memeMorceau = `(async () => {
            const ed = window.app.editeur;
            ed.partition.meta.titre = 'Partage';
            ed.partition.meta.artiste = '';
            ed.partition.meta.creeLe = '2026-03-03T00:00:00.000Z';
            ed.partition.meta.modifieLe = '2026-03-03T10:00:00.000Z';
            return true;
        })`;
        await a.evaluate((p) => eval(p)(), memeMorceau);
        await b.evaluate((p) => eval(p)(), memeMorceau);

        // A enregistre en premier : rien ne s'y oppose.
        const ecritA = await a.evaluate(async () => {
            const f = await import('/src/io/fichiers.js');
            window.app.editeur.partition.meta.tempo = 101;
            return f.ecrireMorceau(window.app.editeur.partition, { racine: window.__racine });
        });
        check(ecritA.range === true && ecritA.nom === 'TabHub - Partage - Morceau.json',
            `la première fenêtre écrit le fichier sans obstacle (lu : ${ecritA.nom})`);

        // B tente d'enregistrer le MÊME morceau : le fichier est maintenant plus récent que ce que B a.
        const tenteB = await b.evaluate(async () => {
            const f = await import('/src/io/fichiers.js');
            window.app.editeur.partition.meta.tempo = 202;
            const etat = await f.etatFichierSurDisque(window.__racine, window.app.editeur.partition);
            const r = await f.ecrireMorceau(window.app.editeur.partition, { racine: window.__racine });
            const relu = await f.lireMorceauSurDisque(window.__racine, etat.nomFichier);
            return { etat: etat.etat, conflit: r.conflit, ecrit: r.range, tempoSurDisque: relu.meta.tempo };
        });
        check(tenteB.etat === 'enAvance' && tenteB.conflit === 'enAvance' && tenteB.ecrit === false,
            `LA SECONDE FENÊTRE EST ARRÊTÉE : le fichier est plus récent que ce qu'elle a sous les yeux (lu : ${tenteB.etat})`);
        check(tenteB.tempoSurDisque === 101,
            `et le travail de la PREMIÈRE est intact sur le disque — c'est très exactement ce que le garde-fou existe pour empêcher, et le cas pour lequel il a été écrit (tempo ${tenteB.tempoSurDisque}, celui de A)`);

        // B choisit « garder les deux » : son travail part à côté, horodaté, sans écraser.
        const gardeB = await b.evaluate(async () => {
            const j = await import('/src/io/json.js');
            const f = await import('/src/io/fichiers.js');
            const r = await j.enregistrerPartition(window.app.editeur.partition, window.__racine);
            const d = await window.__racine.getDirectoryHandle('Morceaux');
            const noms = [];
            for await (const [nom, h] of d.entries()) if (h.kind === 'file') noms.push(nom);
            const relu = await f.lireMorceauSurDisque(window.__racine, 'TabHub - Partage - Morceau.json');
            return { noms: noms.sort(), canonique: relu.meta.tempo };
        });
        check(gardeB.noms.length === 2 && gardeB.noms.some(n => /Partage - Morceau - \d{4}-\d{2}-\d{2} \d{4}\.json$/.test(n)),
            `« GARDER LES DEUX » pose le travail de B À CÔTÉ, sous son nom horodaté (lu : ${JSON.stringify(gardeB.noms)})`);
        check(gardeB.canonique === 101,
            `et le fichier canonique reste celui de A — rien n'est perdu d'aucun côté (tempo ${gardeB.canonique})`);

        // B accepte enfin d'écraser : c'est un CHOIX, et l'ancien part en archive.
        const ecraseB = await b.evaluate(async () => {
            const f = await import('/src/io/fichiers.js');
            const r = await f.ecrireMorceau(window.app.editeur.partition, { racine: window.__racine, forcer: true });
            const relu = await f.lireMorceauSurDisque(window.__racine, r.nom);
            const versions = await f.listerVersions(window.__racine, 'morceaux', r.nom);
            return { tempo: relu.meta.tempo, archives: versions.length };
        });
        check(ecraseB.tempo === 202 && ecraseB.archives >= 1,
            `et quand B décide d'écraser, le travail de A part dans \`_versions/\` au lieu d'être perdu — décider d'écraser n'est pas décider de perdre (tempo ${ecraseB.tempo}, ${ecraseB.archives} archive(s))`);

        // ─────────── Le rechargement retrouve tout ───────────
        const recharge = await b.evaluate(() => JSON.parse(localStorage.getItem('tabhub.brouillon')).onglets.length);
        await a.reload({ waitUntil: 'domcontentloaded' });
        await a.waitForFunction(() => window.app && window.app.page, { timeout: 15000 });
        const apresRechargement = await a.evaluate(() => window.app.onglets.length);
        check(apresRechargement === recharge,
            `AU RECHARGEMENT, la fenêtre retrouve TOUT ce que le brouillon porte, y compris ce qui vient de l'autre fenêtre (${recharge} morceaux dans le brouillon, ${apresRechargement} onglets rouverts)`);

        check(erreurs.length === 0, `aucune erreur JavaScript${erreurs.length ? ' — ' + erreurs.join(' | ') : ''}`);
    } finally { await navigateur.close(); }
    bilan();
})();
