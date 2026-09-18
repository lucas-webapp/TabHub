// Banc des FICHIERS DU DISQUE — inventorier, reprendre, supprimer.
//
// POURQUOI CE PANNEAU LIT LE DOSSIER ET NON L'APPLICATION. TabHub n'a pas de bibliothèque : il a des
// onglets et un brouillon. Un morceau exporté il y a trois mois n'existe plus nulle part DANS
// l'application — mais son fichier est toujours là. Un panneau qui lirait l'état de l'appli ne
// montrerait donc jamais celui qu'on cherche, et c'est précisément celui-là qu'on cherche.
//
// ET C'EST CE QUI REND LA SUPPRESSION SÛRE. On n'efface pas « le morceau Étude » : on efface une
// LISTE DE FICHIERS, lue sur le disque et AFFICHÉE avant qu'on demande quoi que ce soit. La règle de
// préfixe protège du cas « Étude » contre « Étude - live » — mais la sûreté ne vient pas d'elle, elle
// vient de ce que la liste est sous les yeux.
//
// LE REGROUPEMENT SE FAIT SUR LE NOM DE FICHIER, jamais sur le contenu : un PDF n'a aucun contenu
// interrogeable, et un .json renommé à la main doit quand même rester avec ses frères. C'est le
// défaut que le banc de HarmoHub avait trouvé chez lui.
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('fichiers du disque');

const PREPARER = `(async () => {
    const opfs = await navigator.storage.getDirectory();
    try { await opfs.removeEntry('EssaiDisque', { recursive: true }); } catch (e) {}
    const racine = await opfs.getDirectoryHandle('EssaiDisque', { create: true });
    window.__racineEssai = racine;
    window.showDirectoryPicker = async () => racine;
    const f = await import('/src/io/fichiers.js');
    await f.choisirDossier();
    const sc = await import('/src/model/score.js');
    // TROIS MORCEAUX, dont deux au nom PIÉGEUX : « Etude » et « Etude - live ».
    for (const [titre, n] of [['Etude', 3], ['Etude - live', 2], ['Prelude', 1]]) {
        const p = sc.creerPartition('guitare');
        p.meta.titre = titre; p.meta.artiste = '';
        for (let i = 0; i < n; i++) {
            p.meta.tempo = 100 + i;
            p.meta.modifieLe = new Date().toISOString();
            await f.ecrireMorceau(p, { racine, forcer: true });
            await new Promise(r => setTimeout(r, 1050));
        }
        // Un PDF et un MIDI pour « Etude », qui n'ont aucun contenu interrogeable.
        if (titre === 'Etude') {
            await f.enregistrerFichier('%PDF-1.4 faux', { nom: f.nomPour(p, 'partition', 'pdf'), dossier: 'pdf', racine });
            await f.enregistrerFichier('MThd faux', { nom: f.nomPour(p, 'midi', 'mid'), dossier: 'midi', racine });
        }
    }
    return true;
})`;

(async () => {
    plan(14);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        await page.evaluate((p) => eval(p)(), PREPARER);

        // ─────────── L'inventaire ───────────
        const inventaire = await page.evaluate(async () => {
            const f = await import('/src/io/fichiers.js');
            const m = await f.morceauxSurDisque(window.__racineEssai);
            return m.map(x => ({ nom: x.nom, total: x.fichiers.length,
                                 archives: x.fichiers.filter(y => y.archive).length, json: x.aUnJson,
                                 dossiers: [...new Set(x.fichiers.map(y => y.dossier))].sort() }));
        });
        const etude = inventaire.find(x => x.nom === 'Etude');
        const live = inventaire.find(x => x.nom === 'Etude - live');
        exiger(!!etude && !!live, `les trois morceaux du dossier sont retrouvés (lu : ${inventaire.map(x => x.nom).join(', ')})`);
        check(etude.total === 5 && etude.archives === 2,
            `« Etude » : son .json, ses deux archives, son PDF et son MIDI — cinq fichiers rattachés au même morceau par leur NOM (lu : ${etude.total}, dont ${etude.archives} archives)`);
        check(etude.dossiers.join(' | ') === 'MIDI | Morceaux | Morceaux/_versions | PDF',
            `et ils sont trouvés dans TOUS les sous-dossiers, \`_versions/\` compris (lu : ${etude.dossiers.join(', ')})`);
        check(live.total === 2 && live.archives === 1,
            `« Etude - live » garde les SIENS, et n'a pas récupéré ceux d'« Etude » (lu : ${live.total})`);
        check(etude.json === true,
            'un morceau qui a un .json peut être rouvert');

        // ─────────── Le piège du préfixe, sur les vrais fichiers ───────────
        const piege = await page.evaluate(async () => {
            const f = await import('/src/io/fichiers.js');
            const tous = (await f.morceauxSurDisque(window.__racineEssai)).map(x => x.nom);
            const aEtude = await f.fichiersDuMorceau(window.__racineEssai, 'Etude', tous);
            const aLive = await f.fichiersDuMorceau(window.__racineEssai, 'Etude - live', tous);
            return { etude: aEtude.map(x => x.nom), live: aLive.map(x => x.nom) };
        });
        check(piege.etude.length === 5 && !piege.etude.some(n => n.includes(' - live - ')),
            `LE PIÈGE DU PRÉFIXE : « Etude » et « Etude - live » commencent par la même chaîne, et sans précaution supprimer le premier emporterait les fichiers du second. Aucun fichier de « live » dans la liste d'« Etude » (${piege.etude.length} fichiers)`);
        check(piege.live.length === 2 && piege.live.every(n => n.includes(' - live - ') || n.includes(' - live.')),
            `et réciproquement (${piege.live.length} fichiers)`);

        // ─────────── Le panneau ───────────
        await page.evaluate(() => window.app.ouvrirFichiersDuDisque());
        await page.waitForTimeout(600);
        const panneau = await page.evaluate(() => {
            const v = document.getElementById('fenetre-disque');
            const blocs = [...v.querySelectorAll('.disque-morceau')];
            return {
                ouvert: !v.hidden,
                note: document.getElementById('note-disque').textContent,
                noms: blocs.map(b => b.querySelector('.disque-nom').textContent),
                fichiersMontres: blocs.map(b => b.querySelectorAll('.disque-fichiers div').length),
                boutons: blocs[0] ? [...blocs[0].querySelectorAll('button')].map(x => x.textContent.trim()) : [],
            };
        });
        exiger(panneau.ouvert && panneau.noms.length === 3, `le panneau s'ouvre et liste les trois morceaux (lu : ${panneau.noms.join(', ')})`);
        check(/EssaiDisque/.test(panneau.note) && /3 morceaux/.test(panneau.note),
            `il nomme le dossier lu et ce qu'il y a trouvé (lu : « ${panneau.note} »)`);
        // HUIT : « Prelude » 1 (un seul enregistrement, donc aucune archive), « Etude - live » 2,
        // « Etude » 5. J'avais écrit 9 de tête — le banc a corrigé mon addition, pas le code.
        check(panneau.fichiersMontres.reduce((a, b) => a + b, 0) === 8,
            `LA LISTE EXACTE EST AFFICHÉE, chemin par chemin, avant qu'on demande quoi que ce soit — c'est de là que vient la sûreté, pas de la règle de préfixe (lu : ${panneau.fichiersMontres.join(' + ')})`);
        check(panneau.boutons.includes('Ouvrir') && panneau.boutons.includes('Supprimer…'),
            `chaque morceau porte ses deux gestes (lu : ${JSON.stringify(panneau.boutons)})`);

        // ─────────── Reprendre du disque ───────────
        const repris = await page.evaluate(async () => {
            const app = window.app;
            const avant = app.onglets.length;
            const bloc = [...document.querySelectorAll('.disque-morceau')].find(b => b.querySelector('.disque-nom').textContent === 'Prelude');
            [...bloc.querySelectorAll('button')].find(x => x.textContent.trim() === 'Ouvrir').click();
            await new Promise(r => setTimeout(r, 500));
            return { avant, apres: app.onglets.length, titre: app.editeur.partition.meta.titre };
        });
        check(repris.apres === repris.avant + 1 && repris.titre === 'Prelude',
            `REPRENDRE DU DISQUE ouvre le morceau dans un NOUVEL onglet — il n'existait plus nulle part dans l'application, et le reprendre ne doit rien remplacer (lu : ${repris.avant} → ${repris.apres}, « ${repris.titre} »)`);

        // ─────────── Supprimer ───────────
        const supprime = await page.evaluate(async () => {
            const app = window.app;
            await app.ouvrirFichiersDuDisque();
            await new Promise(r => setTimeout(r, 400));
            const bloc = [...document.querySelectorAll('.disque-morceau')].find(b => b.querySelector('.disque-nom').textContent === 'Etude');
            [...bloc.querySelectorAll('button')].find(x => /Supprimer/.test(x.textContent)).click();
            // On attend la fenêtre de confirmation et on lit ce qu'elle montre.
            let v = null;
            for (let i = 0; i < 40 && !v; i++) {
                await new Promise(r => setTimeout(r, 50));
                v = [...document.querySelectorAll('.voile')].find(x => !x.hidden && /Supprimer \d+ fichier/.test(x.textContent));
            }
            const texte = v ? v.textContent : '';
            if (v) [...v.querySelectorAll('button')].find(x => x.textContent.trim() === 'Supprimer').click();
            await new Promise(r => setTimeout(r, 600));
            const f = await import('/src/io/fichiers.js');
            const restants = await f.morceauxSurDisque(window.__racineEssai);
            return { texte, restants: restants.map(x => ({ nom: x.nom, n: x.fichiers.length })) };
        });
        check(/Morceaux\/TabHub - Etude - Morceau\.json/.test(supprime.texte) && /définitivement/.test(supprime.texte),
            'la confirmation MONTRE les chemins exacts et dit que c\'est définitif');
        check(/n'est pas touché/.test(supprime.texte),
            'et elle précise que le morceau OUVERT dans TabHub, lui, n\'est pas touché — effacer un fichier n\'est pas fermer un onglet');
        const resteLive = supprime.restants.find(x => x.nom === 'Etude - live');
        check(!supprime.restants.some(x => x.nom === 'Etude') && resteLive && resteLive.n === 2,
            `les cinq fichiers d'« Etude » sont partis, et « Etude - live » a gardé SES DEUX — le piège du préfixe, éprouvé sur une vraie suppression (restants : ${JSON.stringify(supprime.restants)})`);

        check(erreurs.length === 0, `aucune erreur JavaScript${erreurs.length ? ' — ' + erreurs.join(' | ') : ''}`);
    } finally { await fermer(); }
    bilan();
})();
