// Banc du NUAGE DANS TABHUB — l'intégration, dans un vrai navigateur, sur un Firebase en mémoire.
//
// Le moteur (src/io/nuage.js) a son propre banc (nuage_moteur_test.js) : conflits, hors ligne, droits
// refusés, suppressions. Celui-ci vérifie ce qui est propre à TabHub — que le moteur est branché sur les
// BONS objets (les onglets), que les gestes de l'utilisateur produisent les bons effets, et que les
// avertissements « travail non exporté » se taisent quand le travail est déjà en sécurité.
//
// CE QU'IL PROTÈGE (retour utilisateur : « l'enregistrement me semble trop aléatoire [...] on va
// connecter tous les documents à mon Firebase ») :
//   • se connecter depuis la fenêtre « Nuage et sauvegarde » ; la pastille qui dit où ça en est ;
//   • une modification part toute seule, et le morceau est retrouvable dans la liste du nuage ;
//   • un morceau écrit sur un AUTRE appareil s'ouvre depuis la liste, et une mise à jour distante remplace
//     l'onglet concerné en gardant le curseur ;
//   • supprimer est confirmé, et ferme l'onglet ; le contenu reste dans le nuage ;
//   • LA SAUVEGARDE DE SECOURS : tout exporter en un fichier, tout importer sans rien écraser ;
//   • une fois tout dans le nuage, plus de « ce travail sera perdu » à chaque geste ; et si ça n'y est PAS,
//     l'avertissement reste ;
//   • sans Firebase (hors ligne, bloqué), l'application fonctionne exactement comme avant.

const creerHarnais = require('./_harness.js');
const { ouvrirApp, avecFauxFirebase } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('nuage dans TabHub');

const attendre = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
    plan(40);

    // ===== A. AVEC UN NUAGE ======================================================================
    const { page, erreurs, fermer } = await ouvrirApp({ avant: avecFauxFirebase() });
    try {
        const etatPastille = () => page.evaluate(() => {
            const p = document.getElementById('pastille-nuage');
            return { visible: !p.hidden, classes: [...p.classList].filter(c => c !== 'pastille-nuage'), titre: p.title };
        });
        const attendrePastille = (classe, ms = 6000) => page.waitForFunction(
            (c) => document.getElementById('pastille-nuage').classList.contains(c), classe, { timeout: ms }).then(() => true, () => false);

        // --- 1. La pastille est cachée tant qu'on n'est pas connecté ----------------------------
        let p = await etatPastille();
        check(!p.visible, 'pas connecté : aucune pastille (une application qu\'on n\'a pas reliée n\'affiche pas une pastille grise qui inquiète)');

        // --- 2. Se connecter depuis la fenêtre --------------------------------------------------
        await page.click('#btn-fichiers');
        const entree = await page.$('#popover-fichiers [data-action="nuage"]');
        exiger(!!entree, 'le menu Fichiers propose « Nuage et sauvegarde… »');
        await entree.click();
        await page.waitForSelector('#fenetre-nuage:not([hidden])');
        const avantConnexion = await page.evaluate(() => ({
            note: document.getElementById('nuage-note').textContent,
            boutonConnexion: !document.getElementById('nuage-connexion').hidden,
            boutonSortie: !document.getElementById('nuage-deconnexion').hidden,
        }));
        check(avantConnexion.boutonConnexion && !avantConnexion.boutonSortie && /Connecte-toi/.test(avantConnexion.note),
            'la fenêtre propose de se connecter, et explique pourquoi');
        await page.click('#nuage-connexion');
        check(await attendrePastille('synced'), 'connecté : la pastille passe à « synchronisé »');
        const apresConnexion = await page.evaluate(() => ({
            nom: document.getElementById('nuage-nom').textContent,
            sortie: !document.getElementById('nuage-deconnexion').hidden,
            entree: !document.getElementById('nuage-connexion').hidden,
            note: document.getElementById('nuage-note').textContent,
        }));
        check(apresConnexion.nom === 'Testeur' && apresConnexion.sortie && !apresConnexion.entree,
            'la fenêtre montre le compte et propose de se déconnecter');
        p = await etatPastille();
        check(p.visible && /tout est enregistré/.test(p.titre), 'la pastille est visible et dit que tout est enregistré');

        // Le morceau de départ (vide) est déjà envoyé : il est dans le nuage, sous son identité.
        const idDepart = await page.evaluate(() => window.app.editeur.partition.meta.creeLe);
        const cheminDoc = (id) => `users/u1/apps/tabhub__${id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
        const dansLeNuage = (id) => page.evaluate((c) => window.__backend.docs[c] ? JSON.parse(window.__backend.docs[c].json) : null, cheminDoc(id));
        check(!!(await dansLeNuage(idDepart)), 'le morceau ouvert est envoyé dès la connexion');

        // --- 3. Une modification part toute seule ---------------------------------------------------
        await page.click('#fenetre-nuage [data-fermer].btn-plein');
        await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.placerCurseur(0, 0, 0, 0);
            ed.appliquerDuree(4); ed.saisirChiffre(7);   // un NOMBRE, comme le clavier (une chaîne donnerait une hauteur concaténée)
        });
        check(await attendrePastille('syncing', 1500), 'une modification : la pastille passe à « en cours »');
        check(await attendrePastille('synced', 6000), '…puis revient à « synchronisé » toute seule');
        const envoye = await dansLeNuage(idDepart);
        check(envoye && envoye.mesures[0].voix[0].evenements[0].notes[0].frette === 7, 'et la note écrite est bien DANS le nuage (case 7)');
        const ecritures = await page.evaluate(() => window.__backend.ecritures);
        await attendre(2200);
        check((await page.evaluate(() => window.__backend.ecritures)) === ecritures, 'sans rien renvoyer ensuite (pas d\'écho, pas de boucle)');

        // Un déplacement de curseur ne réveille pas la synchro.
        await page.evaluate(() => { window.app.editeur.placerCurseur(0, 0, 1, 0); });
        await attendre(200);
        p = await etatPastille();
        check(p.classes.includes('synced'), 'déplacer le curseur ne fait pas clignoter la pastille');

        // --- 4. Un morceau écrit sur un AUTRE appareil --------------------------------------------
        const idAutre = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const autre = m.creerPartition('guitare');
            autre.meta.titre = 'Riff venu du téléphone';
            autre.meta.creeLe = '2026-01-02T03:04:05.000Z';
            const id = autre.meta.creeLe;
            const u = Date.now() + 5;
            const cle = id.replace(/[^A-Za-z0-9_-]/g, '-');
            window.__backend.docs['users/u1/apps/tabhub__' + cle] = { id, t: autre.meta.titre, u, json: JSON.stringify(autre) };
            const idx = 'users/u1/apps/tabhub';
            window.__backend.docs[idx].docs[cle] = { t: autre.meta.titre, u, i: id, d: false };
            window.__backend.notifier(idx);
            return id;
        });
        await attendre(300);
        const nAvant = await page.evaluate(() => window.app.onglets.length);
        check(nAvant === 1, 'un morceau distant ne s\'ouvre PAS d\'office (un seul onglet reste ouvert)');
        await page.click('#btn-fichiers');
        await page.click('#popover-fichiers [data-action="nuage"]');
        const liste = await page.evaluate(() => [...document.querySelectorAll('#nuage-liste .nuage-ligne-titre')].map(e => e.textContent));
        check(liste.includes('Riff venu du téléphone'), 'il apparaît dans la liste du nuage');
        await page.evaluate(() => {
            [...document.querySelectorAll('#nuage-liste .nuage-ligne')]
                .find(l => l.textContent.includes('Riff venu du téléphone')).querySelector('button').click();
        });
        await page.waitForFunction(() => window.app.onglets.length === 2, null, { timeout: 4000 }).catch(() => {});
        const ouvert = await page.evaluate(() => ({ n: window.app.onglets.length, titre: window.app.editeur.partition.meta.titre }));
        check(ouvert.n === 2 && ouvert.titre === 'Riff venu du téléphone', 'cliquer « Ouvrir » l\'ouvre dans un nouvel onglet');

        // --- 5. Une mise à jour distante remplace l'onglet, curseur conservé ---------------------------
        await page.evaluate(() => { window.app.editeur.placerCurseur(1, 0, 0, 0); });
        await page.evaluate(async (id) => {
            const m = await import('/src/model/score.js');
            const p2 = JSON.parse(window.__backend.docs['users/u1/apps/tabhub__' + id.replace(/[^A-Za-z0-9_-]/g, '-')].json);
            p2.meta.titre = 'Riff retravaillé sur le téléphone';
            const cle = id.replace(/[^A-Za-z0-9_-]/g, '-');
            const u = Date.now() + 50000;
            window.__backend.docs['users/u1/apps/tabhub__' + cle] = { id, t: p2.meta.titre, u, json: JSON.stringify(p2) };
            window.__backend.docs['users/u1/apps/tabhub'].docs[cle] = { t: p2.meta.titre, u, i: id, d: false };
            window.__backend.notifier('users/u1/apps/tabhub');
        }, idAutre);
        await page.waitForFunction(() => window.app.editeur.partition.meta.titre === 'Riff retravaillé sur le téléphone', null, { timeout: 5000 }).catch(() => {});
        const maj = await page.evaluate(() => ({ titre: window.app.editeur.partition.meta.titre, curseur: { ...window.app.editeur.curseur }, onglets: window.app.onglets.length }));
        check(maj.titre === 'Riff retravaillé sur le téléphone' && maj.onglets === 2, 'une mise à jour distante remplace le morceau ouvert, sans ouvrir un onglet de plus');
        check(maj.curseur.mesure === 1, `et le curseur reste où il était (mesure ${maj.curseur.mesure + 1}), au lieu de revenir au début`);
        await attendre(2000);
        const ecr2 = await page.evaluate(() => window.__backend.ecritures);
        await attendre(2000);
        check((await page.evaluate(() => window.__backend.ecritures)) === ecr2, 'recevoir ne renvoie rien (le morceau reçu n\'est pas pris pour une modification locale)');

        // --- 6. Les avertissements se taisent quand tout est dans le nuage ---------------------------
        // Il faut un morceau AVEC des modifications : un onglet tout juste rechargé depuis le nuage a un
        // historique vide, et `etapesDocument() === 0` court-circuite alors les garde-fous AVANT que le
        // nuage n'intervienne — le scénario ne prouverait rien.
        await page.evaluate(() => { const ed = window.app.editeur; ed.placerCurseur(0, 0, 0, 0); ed.appliquerDuree(4); ed.saisirChiffre(2); });
        await attendrePastille('syncing', 1500);
        await attendrePastille('synced', 6000);
        check(await page.evaluate(() => window.app.editeur.etapesDocument()) > 0, 'préalable : le morceau actif a des modifications (sans quoi les garde-fous ne se poseraient même pas la question)');
        const synchro = await page.evaluate(() => ({ tout: window.app.nuage.toutEstSynchro(), actif: window.app.nuageAJour() }));
        check(synchro.tout && synchro.actif, 'tout est synchronisé : le moteur le sait (toutEstSynchro, nuageAJour)');
        const sansQuestion = await page.evaluate(async () => {
            window.app.travailExporte = false;
            const r = await Promise.race([window.app.peutEcraserLeMorceau('Nouveau'), new Promise(res => setTimeout(() => res('DIALOGUE'), 500))]);
            return r;
        });
        check(sansQuestion === true, 'morceau modifié, jamais exporté, MAIS dans le nuage : plus de « ce travail sera perdu » — on continue sans poser la question');

        // --- 6 bis. La fermeture de la page : rien à perdre, rien à demander ---------------------------
        // Un évènement `beforeunload` réel, provoqué comme le fait le navigateur : c'est la fenêtre du
        // NAVIGATEUR (aucune page ne peut la personnaliser), donc seul un vrai dialogue la trahit.
        const fermeture = async (etat) => {
            return await page.evaluate((e) => {
                window.app.travailExporte = false;
                const ev = new Event('beforeunload', { cancelable: true });
                window.dispatchEvent(ev);
                return ev.defaultPrevented;
            }, etat);
        };
        check((await fermeture()) === false, 'fermer la page quand tout est dans le nuage : AUCUN avertissement du navigateur');

        // --- 7. Et quand ça N'Y EST PAS, l'avertissement reste ---------------------------------------
        const question = await page.evaluate(async () => {
            window.app.nuage.arreter();              // plus de synchro : le morceau ne sera pas à jour
            window.app.editeur.appliquerDuree(8); window.app.editeur.saisirChiffre(3);
            window.app.travailExporte = false;
            const res = await Promise.race([window.app.peutEcraserLeMorceau('Nouveau'), new Promise(r => setTimeout(() => r('DIALOGUE'), 500))]);
            return res;
        });
        check(question === 'DIALOGUE', 'morceau modifié depuis le dernier envoi : la question « travail non exporté » est POSÉE comme avant');
        await page.evaluate(() => { [...document.querySelectorAll('#fenetre-dialogue .dialogue-actions button')].find(b => /Annuler/.test(b.textContent))?.click(); });
        check((await fermeture()) === true, 'fermer la page avec une modification jamais envoyée ni exportée : l\'avertissement du navigateur est BIEN là');
        // Un envoi en échec compte aussi : la copie du nuage n'est alors pas celle qu'on croit.
        const enEchec = await page.evaluate(() => {
            window.app.travailExporte = true;      // exporté : sans nuage, on se tairait
            window.app.nuage.enAttente = () => true;
            const ev = new Event('beforeunload', { cancelable: true });
            window.dispatchEvent(ev);
            return ev.defaultPrevented;
        });
        check(enEchec === true, 'un envoi EN COURS ou en échec retient la fermeture, même pour un travail déjà exporté');
    } finally { /* la page sert encore plus bas */ }

    // ===== B. SUPPRESSION, SAUVEGARDE DE SECOURS : sur une page neuve =====================================
    await fermer();
    const B = await ouvrirApp({ avant: avecFauxFirebase() });
    try {
        const pg = B.page;
        await pg.evaluate(() => { window.app.ouvrirNuage(); });
        await pg.click('#nuage-connexion');
        await pg.waitForFunction(() => document.getElementById('pastille-nuage').classList.contains('synced'), null, { timeout: 6000 });

        // Deux autres morceaux dans le nuage, écrits « ailleurs ».
        await pg.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const poser = (titre, creeLe) => {
                const x = m.creerPartition('guitare'); x.meta.titre = titre; x.meta.creeLe = creeLe;
                const cle = creeLe.replace(/[^A-Za-z0-9_-]/g, '-'); const u = Date.now() + 7;
                window.__backend.docs['users/u1/apps/tabhub__' + cle] = { id: creeLe, t: titre, u, json: JSON.stringify(x) };
                window.__backend.docs['users/u1/apps/tabhub'].docs[cle] = { t: titre, u, i: creeLe, d: false };
            };
            poser('Morceau A', '2026-02-01T00:00:00.000Z');
            poser('Morceau B', '2026-02-02T00:00:00.000Z');
            window.__backend.notifier('users/u1/apps/tabhub');
        });
        await attendre(300);

        // --- 8. Sauvegarde de secours : tout exporter ---------------------------------------------------
        const [telechargement] = await Promise.all([
            pg.waitForEvent('download', { timeout: 5000 }).catch(() => null),
            pg.click('#nuage-tout-exporter'),
        ]);
        exiger(!!telechargement, '« Tout exporter » télécharge un fichier');
        const chemin = telechargement && await telechargement.path();
        const sauvegarde = chemin ? JSON.parse(require('fs').readFileSync(chemin, 'utf8')) : null;
        check(sauvegarde && sauvegarde.format === 'tabhub-sauvegarde' && /tabhub-sauvegarde-\d{4}-\d{2}-\d{2}\.json$/.test(telechargement.suggestedFilename()),
            'le fichier porte un nom daté et un format reconnaissable (tabhub-sauvegarde)');
        const titres = sauvegarde ? sauvegarde.morceaux.map(x => x.meta.titre).sort() : [];
        check(titres.length === 3 && titres.includes('Morceau A') && titres.includes('Morceau B'),
            `il contient TOUS les morceaux — le morceau ouvert ET ceux qui ne sont que dans le nuage (${titres.length})`);

        // --- 9. Tout importer : rien n'est écrasé ---------------------------------------------------------
        const ecrBase = await pg.evaluate(() => window.__backend.ecritures);
        const fichierIdentique = require('path').join(require('os').tmpdir(), 'tabhub-import-identique.json');
        require('fs').writeFileSync(fichierIdentique, JSON.stringify(sauvegarde));
        const [choix1] = await Promise.all([pg.waitForEvent('filechooser', { timeout: 4000 }), pg.click('#nuage-tout-importer')]);
        await choix1.setFiles(fichierIdentique);
        await attendre(600);
        const msg1 = await pg.evaluate(() => document.getElementById('message')?.textContent || document.querySelector('.message, .toast')?.textContent || '');
        check((await pg.evaluate(() => window.__backend.ecritures)) === ecrBase, 'réimporter une sauvegarde IDENTIQUE à l\'état actuel n\'écrit rien (tout est déjà à jour)');

        // Une sauvegarde où « Morceau A » a un contenu différent : il arrive à côté, l'original intact.
        const modifiee = JSON.parse(JSON.stringify(sauvegarde));
        const mA = modifiee.morceaux.find(x => x.meta.titre === 'Morceau A');
        mA.meta.tempo = 77;
        const fichierDiff = require('path').join(require('os').tmpdir(), 'tabhub-import-diff.json');
        require('fs').writeFileSync(fichierDiff, JSON.stringify(modifiee));
        const [choix2] = await Promise.all([pg.waitForEvent('filechooser', { timeout: 4000 }), pg.click('#nuage-tout-importer')]);
        await choix2.setFiles(fichierDiff);
        await pg.waitForFunction(() => Object.keys(window.__backend.docs['users/u1/apps/tabhub'].docs).length >= 4, null, { timeout: 5000 }).catch(() => {});
        const apresDiff = await pg.evaluate(() => {
            const docs = window.__backend.docs['users/u1/apps/tabhub'].docs;
            const titres = Object.values(docs).map(e => e.t);
            const origine = JSON.parse(window.__backend.docs['users/u1/apps/tabhub__2026-02-01T00-00-00-000Z'].json);
            return { titres, tempoOrigine: origine.meta.tempo };
        });
        check(apresDiff.titres.some(t => /Morceau A \(sauvegarde du /.test(t)), 'un morceau de la sauvegarde qui DIFFÈRE arrive à côté, sous un titre daté');
        check(apresDiff.tempoOrigine !== 77, 'et l\'original du nuage n\'a pas bougé');

        const fichierMauvais = require('path').join(require('os').tmpdir(), 'tabhub-import-mauvais.json');
        require('fs').writeFileSync(fichierMauvais, JSON.stringify({ format: 'autre chose' }));
        const [choix3] = await Promise.all([pg.waitForEvent('filechooser', { timeout: 4000 }), pg.click('#nuage-tout-importer')]);
        await choix3.setFiles(fichierMauvais);
        await attendre(300);
        check(await pg.evaluate(() => /pas une sauvegarde complète/.test(document.body.innerText)), 'un fichier qui n\'est pas une sauvegarde est refusé en clair, et renvoie vers Fichiers > Ouvrir');

        // --- 10. Supprimer du nuage : confirmé, et ça ferme l'onglet -----------------------------------------
        await pg.evaluate(() => {
            [...document.querySelectorAll('#nuage-liste .nuage-ligne')].find(l => l.textContent.includes('Morceau B')).querySelectorAll('button')[0].click();
        });
        await pg.waitForFunction(() => window.app.onglets.length === 2, null, { timeout: 4000 }).catch(() => {});
        await pg.evaluate(() => { window.app.ouvrirNuage(); });
        await pg.evaluate(() => {
            [...document.querySelectorAll('#nuage-liste .nuage-ligne')].find(l => l.textContent.includes('Morceau B')).querySelectorAll('button')[1].click();
        });
        await attendre(200);
        const dialogue = await pg.evaluate(() => { const d = document.getElementById('fenetre-dialogue'); return d && !d.hidden ? d.innerText : ''; });
        check(/Supprimer « Morceau B » \?/.test(dialogue) && /reste conservé/.test(dialogue), 'supprimer demande confirmation, et dit que le contenu reste dans le nuage');
        // D'abord ANNULER : rien ne doit bouger.
        await pg.evaluate(() => { [...document.querySelectorAll('#fenetre-dialogue .dialogue-actions button')].find(b => /Annuler/.test(b.textContent)).click(); });
        await attendre(400);
        check(await pg.evaluate(() => window.__backend.docs['users/u1/apps/tabhub'].docs['2026-02-02T00-00-00-000Z'].d) === false
            && await pg.evaluate(() => window.app.onglets.length) === 2,
            'annuler la suppression ne supprime RIEN (le morceau est toujours dans le nuage, son onglet toujours ouvert)');
        await pg.evaluate(() => { window.app.ouvrirNuage(); });
        await pg.evaluate(() => {
            [...document.querySelectorAll('#nuage-liste .nuage-ligne')].find(l => l.textContent.includes('Morceau B')).querySelectorAll('button')[1].click();
        });
        await attendre(200);
        await pg.evaluate(() => { [...document.querySelectorAll('#fenetre-dialogue .dialogue-actions button')].find(b => b.textContent.trim() === 'Supprimer').click(); });
        await pg.waitForFunction(() => window.__backend.docs['users/u1/apps/tabhub'].docs['2026-02-02T00-00-00-000Z'].d === true, null, { timeout: 4000 }).catch(() => {});
        const supp = await pg.evaluate(() => ({
            marque: window.__backend.docs['users/u1/apps/tabhub'].docs['2026-02-02T00-00-00-000Z'].d,
            contenuRestant: !!window.__backend.docs['users/u1/apps/tabhub__2026-02-02T00-00-00-000Z'],
        }));
        check(supp.marque === true && supp.contenuRestant, 'le morceau est marqué supprimé dans l\'index, mais son contenu reste dans le nuage');
        await pg.waitForFunction(() => window.app.onglets.length === 1, null, { timeout: 4000 }).catch(() => {});
        check(await pg.evaluate(() => window.app.onglets.length) === 1, 'et son onglet ouvert se ferme : une suppression voulue se voit partout');
        check(erreurs.length === 0 && B.erreurs.length === 0, `aucune erreur de console pendant le banc (${erreurs.length + B.erreurs.length})`);
    } finally { await B.fermer(); }

    // ===== C. SANS FIREBASE : RIEN NE CHANGE ====================================================
    const C = await ouvrirApp();
    try {
        const r = await C.page.evaluate(async () => {
            const a = window.app;
            a.ouvrirNuage();
            a.editeur.appliquerDuree(4); a.editeur.saisirChiffre(5);
            await new Promise(res => setTimeout(res, 2000));
            return {
                connecte: a.nuage ? a.nuage.etat().connecte : false,
                pastilleCachee: document.getElementById('pastille-nuage').hidden,
                note: document.getElementById('nuage-note').textContent,
                ecritureLocale: !!localStorage.getItem('tabhub.brouillon'),
                enAttente: a.nuage ? a.nuage.enAttente() : false,
            };
        });
        check(!r.connecte && r.pastilleCachee && r.ecritureLocale && !r.enAttente,
            'sans Firebase (hors ligne, bloqué) : pas de pastille, pas d\'attente, et le brouillon local s\'écrit comme avant');
        check(/indisponible/.test(r.note) || /Connecte-toi/.test(r.note), 'et la fenêtre Nuage le dit au lieu de promettre ce qu\'elle ne peut pas tenir');
        check(C.erreurs.length === 0, `aucune erreur de console sans Firebase (${C.erreurs.length})`);
    } finally { await C.fermer(); }

    bilan();
})();
