// Banc des GARDE-FOUS D'ÉCRITURE — lire le disque avant de l'écraser.
//
// LE DÉFAUT QU'ILS RÉPARENT NE RESSEMBLE PAS À UN DÉFAUT, et c'est pourquoi il a fallu le nommer :
// jusqu'ici rien n'écrasait jamais rien, chaque export portant son horodatage. C'est une sûreté PAR
// ACCUMULATION — et son prix est que rien n'est jamais REMPLACÉ : dix exports d'« Étude » donnent dix
// fichiers sans qu'aucun soit LE fichier d'Étude. C'est exactement le « je me perds rapidement dans
// les versions » qui a lancé tout le chantier côté HarmoHub.
//
// D'OÙ CE QUE CE BANC PROTÈGE, en trois temps :
//   1. UN NOM STABLE dans le dossier (« TabHub - Étude - Dyens - Morceau.json »), et l'ancien contenu
//      poussé dans `_versions/` — jamais laissé à côté du nouveau.
//   2. LES ARCHIVES DATÉES À LA SECONDE. Défaut trouvé par le banc de HarmoHub, reproduit ici : à la
//      minute, quatre enregistrements rapprochés ne laissaient qu'UNE archive, les quatre portant le
//      même nom. Le filet se vidait tout seul, en silence, exactement dans le cas où l'on en a le
//      plus besoin.
//   3. LE GARDE-FOU : avant d'écrire, on LIT. Fichier plus récent que ce qui est ouvert ici, ou
//      appartenant à un AUTRE morceau du même nom — rien n'est écrit, et la question est posée.
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('garde-fous d\'écriture');

const POSER_OPFS = `(async (nomRacine) => {
    const opfs = await navigator.storage.getDirectory();
    try { await opfs.removeEntry(nomRacine, { recursive: true }); } catch (e) {}
    const racine = await opfs.getDirectoryHandle(nomRacine, { create: true });
    window.__racineEssai = racine;
    window.showDirectoryPicker = async () => window.__racineEssai;
    const f = await import('/src/io/fichiers.js');
    await f.choisirDossier();
    return racine.name;
})`;

const LISTER = `(async (sousDossier) => {
    let d = window.__racineEssai;
    for (const nom of sousDossier.split('/')) d = await d.getDirectoryHandle(nom);
    const noms = [];
    for await (const [nom, h] of d.entries()) if (h.kind === 'file') noms.push(nom);
    return noms.sort();
})`;

(async () => {
    plan(18);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        await page.evaluate((p) => eval(p)('EssaiGardeFous'), POSER_OPFS);

        // ─────────── Le nom stable, et les archives ───────────
        const ecritures = await page.evaluate(async () => {
            const f = await import('/src/io/fichiers.js');
            const sc = await import('/src/model/score.js');
            const p = sc.creerPartition('guitare');
            p.meta.titre = 'Étude'; p.meta.artiste = 'Dyens';
            const sortie = [];
            for (let i = 0; i < 3; i++) {
                p.meta.tempo = 100 + i;                     // quelque chose change à chaque fois
                p.meta.modifieLe = new Date().toISOString();
                sortie.push(await f.ecrireMorceau(p, { racine: window.__racineEssai }));
                await new Promise(r => setTimeout(r, 1100));   // deux secondes distinctes
            }
            window.__essai = p;
            return sortie.map(r => ({ range: r.range, nom: r.nom, archive: r.archive }));
        });
        const morceaux = await page.evaluate((l) => eval(l)('Morceaux'), LISTER);
        const archives = await page.evaluate((l) => eval(l)('Morceaux/_versions'), LISTER);
        exiger(ecritures.every(r => r.range), 'les trois enregistrements passent');
        check(morceaux.length === 1 && morceaux[0] === 'TabHub - Etude - Dyens - Morceau.json',
            `UN SEUL FICHIER après trois enregistrements, et il porte le nom CANONIQUE — sans horodatage. C'est ce qui fait qu'il existe enfin LE fichier d'Étude, au lieu de trois candidats (lu : ${JSON.stringify(morceaux)})`);
        check(archives.length === 2,
            `et les deux états précédents sont dans \`_versions/\`, pas à côté du nouveau (lu : ${archives.length})`);
        check(ecritures[0].archive === null && ecritures[1].archive && ecritures[2].archive,
            'le premier enregistrement n\'archive rien (il n\'y avait rien), les suivants oui');
        check(archives.every(n => /^TabHub - Etude - Dyens - Morceau - \d{4}-\d{2}-\d{2} \d{6}\.json$/.test(n)),
            `LES ARCHIVES SONT DATÉES À LA SECONDE (six chiffres, pas quatre) : à la minute, quatre enregistrements rapprochés portaient le même nom et s'écrasaient l'un l'autre — le filet se vidait tout seul, dans le cas où l'on en a le plus besoin (lu : ${JSON.stringify(archives)})`);
        check(new Set(archives).size === archives.length,
            'et elles sont bien distinctes — c\'est là tout l\'objet de la seconde');

        // ─────────── La rotation à dix ───────────
        const rotation = await page.evaluate(async () => {
            const f = await import('/src/io/fichiers.js');
            const p = window.__essai;
            for (let i = 0; i < 11; i++) {
                p.meta.tempo = 200 + i;
                p.meta.modifieLe = new Date().toISOString();
                await f.ecrireMorceau(p, { racine: window.__racineEssai, forcer: true });
                await new Promise(r => setTimeout(r, 1050));
            }
            return f.listerVersions(window.__racineEssai, 'morceaux', 'TabHub - Etude - Dyens - Morceau.json');
        });
        check(rotation.length === 10,
            `LA ROTATION S'ARRÊTE À DIX : l'accumulation a une fin, sans rien à nettoyer à la main (lu : ${rotation.length})`);
        check(rotation[0] > rotation[rotation.length - 1],
            'et la liste est rendue de la plus RÉCENTE à la plus ancienne — le tri alphabétique des noms EST le tri chronologique, puisqu\'ils portent « aaaa-mm-jj hhmmss »');

        // ─────────── Le garde-fou : fichier plus récent ───────────
        const enAvance = await page.evaluate(async () => {
            const f = await import('/src/io/fichiers.js');
            const p = window.__essai;
            // Le disque avance : quelqu'un d'autre (un autre onglet, une autre machine) a enregistré.
            const plusRecent = { ...p, meta: { ...p.meta, modifieLe: new Date(Date.now() + 60000).toISOString(), tempo: 999 } };
            await f.ecrireMorceau(plusRecent, { racine: window.__racineEssai, forcer: true });
            const etat = await f.etatFichierSurDisque(window.__racineEssai, p);
            const tentative = await f.ecrireMorceau(p, { racine: window.__racineEssai });
            const apres = await f.lireMorceauSurDisque(window.__racineEssai, etat.nomFichier);
            return { etat: etat.etat, conflit: tentative.conflit, ecrit: tentative.range, tempoSurDisque: apres.meta.tempo };
        });
        check(enAvance.etat === 'enAvance',
            `un fichier PLUS RÉCENT que la version ouverte ici est reconnu comme tel (lu : ${enAvance.etat})`);
        check(enAvance.conflit === 'enAvance' && enAvance.ecrit === false && enAvance.tempoSurDisque === 999,
            `et RIEN N'EST ÉCRIT : le travail qu'on n'a jamais vu est toujours sur le disque (tempo ${enAvance.tempoSurDisque}, inchangé). Écraser sans demander, c'est perdre en silence ce qu'un autre onglet venait d'enregistrer`);

        // ─────────── Le garde-fou : un AUTRE morceau au même nom ───────────
        const autre = await page.evaluate(async () => {
            const f = await import('/src/io/fichiers.js');
            const sc = await import('/src/model/score.js');
            // Même titre, même artiste — mais créé un autre jour : ce n'est pas le même document.
            const jumeau = sc.creerPartition('guitare');
            jumeau.meta.titre = 'Étude'; jumeau.meta.artiste = 'Dyens';
            jumeau.meta.creeLe = new Date(Date.now() - 86400000 * 30).toISOString();
            const etat = await f.etatFichierSurDisque(window.__racineEssai, jumeau);
            const tentative = await f.ecrireMorceau(jumeau, { racine: window.__racineEssai });
            return { etat: etat.etat, conflit: tentative.conflit, ecrit: tentative.range, titreDisque: etat.disque?.titre };
        });
        check(autre.etat === 'autre' && autre.conflit === 'autre' && autre.ecrit === false,
            `DEUX MORCEAUX DIFFÉRENTS PEUVENT PORTER LE MÊME TITRE ET LE MÊME ARTISTE. C'est leur date de CRÉATION qui les distingue — elle voyage dans le fichier depuis le premier jour — et sans ce test le second écraserait le premier sans un mot (lu : ${autre.etat})`);
        check(autre.titreDisque === 'Étude',
            `et la fenêtre a de quoi MONTRER ce qu'elle va écraser, au lieu de demander à l'aveugle (titre sur le disque : « ${autre.titreDisque} »)`);

        // ─────────── Écraser, quand on le décide ───────────
        const force = await page.evaluate(async () => {
            const f = await import('/src/io/fichiers.js');
            const p = window.__essai;
            p.meta.tempo = 123;
            const r = await f.ecrireMorceau(p, { racine: window.__racineEssai, forcer: true });
            const relu = await f.lireMorceauSurDisque(window.__racineEssai, r.nom);
            return { range: r.range, archive: !!r.archive, tempo: relu.meta.tempo };
        });
        check(force.range && force.tempo === 123,
            `« Écraser » écrit bien, quand c'est un CHOIX (tempo ${force.tempo})`);
        check(force.archive,
            'et l\'ancien fichier part quand même dans `_versions/` — décider d\'écraser n\'est pas décider de perdre');

        // ─────────── Sans dossier : rien ne casse ───────────
        const sansDossier = await page.evaluate(async () => {
            const f = await import('/src/io/fichiers.js');
            const etat = await f.etatFichierSurDisque(null, window.__essai);
            const r = await f.ecrireMorceau(window.__essai, { racine: null });
            return { etat: etat.etat, ignore: r.ignore, range: r.range };
        });
        check(sansDossier.etat === 'absent' && sansDossier.ignore === true && sansDossier.range === false,
            'SANS DOSSIER CONFIGURÉ, l\'écriture de fichier ne s\'applique simplement pas — elle ne lève pas, et surtout elle ne bloque pas l\'enregistrement local, qui reste la vraie sauvegarde');

        // ─────────── Enregistrer écrit le fichier, et n'échoue jamais pour autant ───────────
        const enregistre = await page.evaluate(async () => {
            const sc = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.partition.meta.titre = 'Depuis Enregistrer';
            ed.partition.meta.artiste = '';
            await window.app.enregistrer();
            const d = await window.__racineEssai.getDirectoryHandle('Morceaux');
            const noms = [];
            for await (const [nom, h] of d.entries()) if (h.kind === 'file') noms.push(nom);
            return { noms: noms.sort(), message: document.getElementById('message')?.textContent || '' };
        });
        check(enregistre.noms.includes('TabHub - Depuis Enregistrer - Morceau.json'),
            `ENREGISTRER ÉCRIT AUSSI LE FICHIER quand un dossier est configuré : sans cela, « Enregistrer » et « le fichier sur le disque » divergent en silence, et l'on croit avoir sauvegardé ce qui n'est que dans le navigateur (lu : ${JSON.stringify(enregistre.noms)})`);
        check(/Enregistré/.test(enregistre.message),
            `et il l'annonce, avec sa destination (lu : « ${enregistre.message} »)`);

        check(erreurs.length === 0, `aucune erreur JavaScript${erreurs.length ? ' — ' + erreurs.join(' | ') : ''}`);
    } finally { await fermer(); }
    bilan();
})();
