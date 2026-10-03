// Banc du NUAGE DANS TABHUB — l'intégration, dans un vrai navigateur, sur un Firebase en mémoire.
//
// Le moteur (src/io/nuage.js) a son propre banc (nuage_moteur_test.js) : conflits, hors ligne, droits
// refusés, suppressions. Celui-ci vérifie ce qui est propre à TabHub — que le moteur est branché sur les
// BONS objets (les onglets), que les gestes de l'utilisateur produisent les bons effets, et que les
// avertissements « travail non exporté » se taisent quand le travail est déjà en sécurité.
//
// CE QU'IL PROTÈGE (retour utilisateur : « l'enregistrement me semble trop aléatoire [...] on va
// connecter tous les documents à mon Firebase ») :
//   • se connecter d'UN clic sur le bouton « Se connecter » de la barre du haut (et non plus depuis Fichiers) ;
//     ce bouton, qui montre le prénom et la pastille qui dit où ça en est ;
//   • une modification part toute seule, et le morceau est retrouvable dans la liste du nuage ;
//   • un morceau écrit sur un AUTRE appareil s'ouvre depuis la liste, et une mise à jour distante remplace
//     l'onglet concerné en gardant le curseur ;
//   • supprimer est confirmé, et ferme l'onglet ; le contenu reste dans le nuage ;
//   • LA SAUVEGARDE DE SECOURS : tout exporter en un fichier, tout importer sans rien écraser ;
//   • une fois tout dans le nuage, plus de « ce travail sera perdu » à chaque geste ; et si ça n'y est PAS,
//     l'avertissement reste ;
//   • sans Firebase (hors ligne, bloqué), l'application fonctionne exactement comme avant ;
//   • LE GARDE-FOU : à la première modification faite sans être connecté, une question — une fois par séance,
//     sans activer un bouton par mégarde, et jamais à quelqu'un qui est connecté.

const creerHarnais = require('./_harness.js');
const { ouvrirApp, avecFauxFirebase, taper } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('nuage dans TabHub');

const attendre = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
    plan(88);

    // ===== A. AVEC UN NUAGE ======================================================================
    const { page, erreurs, fermer } = await ouvrirApp({ avant: avecFauxFirebase() });
    try {
        const etatPastille = () => page.evaluate(() => {
            const b = document.getElementById('btn-nuage');
            return { visible: !b.hidden, etat: b.dataset.etat, point: b.dataset.point, classes: b.dataset.point ? [b.dataset.point] : [],
                     titre: b.title, libelle: b.querySelector('.nuage-libelle').textContent };
        });
        const attendrePastille = (point, ms = 6000) => page.waitForFunction(
            (c) => document.getElementById('btn-nuage').dataset.point === c, point, { timeout: ms }).then(() => true, () => false);

        // --- 1. Le bouton du nuage dit « Se connecter » tant qu'on n'est pas connecté ---------------
        let p = await etatPastille();
        check(p.visible && p.etat === 'deconnecte' && p.libelle === 'Se connecter' && p.point === '',
            'pas connecté : le bouton de la barre du haut dit « Se connecter », sans pastille d\'état (rien à signaler tant qu\'il n\'y a rien de relié)');

        // --- 2. Le menu Fichiers ne porte plus le nuage ; la sauvegarde de secours y reste -------------------
        await page.click('#btn-fichiers');
        const entree = await page.$('#popover-fichiers [data-action="sauvegarde"]');
        const ancienne = await page.$('#popover-fichiers [data-action="nuage"], #pastille-nuage, #btn-fichiers .pastille-nuage');
        exiger(!!entree && !ancienne, 'le menu Fichiers ne porte plus le nuage (ni entrée « Nuage », ni pastille) mais « Sauvegarde de secours… »');
        await entree.click();
        await page.waitForSelector('#fenetre-nuage:not([hidden])');
        const avantConnexion = await page.evaluate(() => ({
            note: document.getElementById('nuage-note').textContent,
            boutonConnexion: !document.getElementById('nuage-connexion').hidden,
            boutonSortie: !document.getElementById('nuage-deconnexion').hidden,
        }));
        check(avantConnexion.boutonConnexion && !avantConnexion.boutonSortie && /Connecte-toi/.test(avantConnexion.note),
            'la fenêtre propose de se connecter, et explique pourquoi');
        await page.click('#fenetre-nuage [data-fermer].btn-plein');
        // UN SEUL CLIC : déconnecté, le bouton ouvre Google tout de suite, sans fenêtre intermédiaire.
        await page.click('#btn-nuage');
        check(await attendrePastille('synced'), 'un clic sur « Se connecter » ouvre Google, et connecté la pastille passe à « synchronisé »');
        check(await page.evaluate(() => document.getElementById('fenetre-nuage').hidden), 'sans passer par une fenêtre : un seul clic suffit');
        p = await etatPastille();
        check(p.etat === 'connecte' && p.libelle === 'Testeur', 'le bouton montre alors le prénom');
        await page.click('#btn-nuage');          // connecté : le clic ouvre la fenêtre du compte
        await page.waitForSelector('#fenetre-nuage:not([hidden])');
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
        await page.click('#btn-nuage');
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
        await pg.waitForFunction(() => document.getElementById('btn-nuage').dataset.point === 'synced', null, { timeout: 6000 });

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
                bouton: document.getElementById('btn-nuage').dataset.etat + '/' + document.getElementById('btn-nuage').querySelector('.nuage-libelle').textContent,
                dialogue: !document.getElementById('fenetre-dialogue').hidden,
                note: document.getElementById('nuage-note').textContent,
                connexionProposee: !document.getElementById('nuage-connexion').hidden,
                ecritureLocale: !!localStorage.getItem('tabhub.brouillon'),
                enAttente: a.nuage ? a.nuage.enAttente() : false,
            };
        });
        check(!r.connecte && r.bouton === 'indisponible/Hors ligne' && r.ecritureLocale && !r.enAttente,
            'sans Firebase (hors ligne, bloqué) : le bouton dit « Hors ligne », pas d\'attente, et le brouillon local s\'écrit comme avant');
        check(r.dialogue === false, 'et AUCUNE question « tu n\'es pas connecté » malgré une modification : proposer de se connecter quand c\'est impossible n\'aurait aucun sens');
        check(/indisponible/.test(r.note) && !r.connexionProposee, 'et la fenêtre Nuage le dit, sans proposer un bouton « Se connecter » qui ne pourrait pas marcher');
        check(C.erreurs.length === 0, `aucune erreur de console sans Firebase (${C.erreurs.length})`);
    } finally { await C.fermer(); }

    // ===== D. LE GARDE-FOU « TU TRAVAILLES SANS ÊTRE CONNECTÉ », DANS UN VRAI NAVIGATEUR ===========
    // Retour utilisateur : « je veux un garde-fou pour me demander une confirmation si je commence à
    // travailler alors que je ne suis pas connecté ». Le moteur décide QUAND (nuage_moteur_test.js) ; ici on
    // éprouve ce que l'utilisateur voit et touche : la question, le clavier, les deux boutons, la fenêtre Google.
    const lireDialogue = (pg) => pg.evaluate(() => {
        const d = document.getElementById('fenetre-dialogue');
        return {
            ouvert: !d.hidden,
            titre: d.querySelector('.dialogue-titre').textContent,
            boutons: [...d.querySelectorAll('.dialogue-actions button')].map(b => b.textContent.trim()),
            focusSurBouton: !!(document.activeElement && document.activeElement.closest('.dialogue-actions')),
            focusDansLaFenetre: d.contains(document.activeElement),
        };
    });
    const dialogueOuvert = (pg, ms = 1500) => pg.waitForFunction(() => !document.getElementById('fenetre-dialogue').hidden, null, { timeout: ms }).then(() => true, () => false);
    const sansDialogue = async (pg, ms = 500) => { await attendre(ms); return await pg.evaluate(() => document.getElementById('fenetre-dialogue').hidden); };
    const repondu = (pg) => pg.evaluate(() => window.app.nuage._diagnostic().garde.repondu);
    const nbQuestions = (pg) => pg.evaluate(() => window.__questions || 0);
    // Compte les questions posées, sans rien changer à ce que l'utilisateur voit.
    const compterQuestions = (pg) => pg.evaluate(() => {
        window.__questions = 0;
        const observer = new MutationObserver(() => {
            const d = document.getElementById('fenetre-dialogue');
            if (!d.hidden && !window.__ouvert) { window.__questions++; window.__ouvert = true; }
            if (d.hidden) window.__ouvert = false;
        });
        observer.observe(document.getElementById('fenetre-dialogue'), { attributes: true, attributeFilter: ['hidden'] });
    });
    // Note l'évènement en cours au moment où la fenêtre Google est demandée : `window.event` n'existe QUE pendant
    // la distribution d'un évènement. Une demande faite après une attente (promesse, minuterie) le trouve vide —
    // et c'est exactement ce que Safari refuse d'ouvrir.
    const espionnerGoogle = (pg) => pg.evaluate(() => {
        const auth = window.firebase.auth();
        const origine = auth.signInWithPopup;
        window.__googleDemande = [];
        auth.signInWithPopup = function () { window.__googleDemande.push(window.event ? window.event.type : null); return origine.apply(this, arguments); };
    });

    // --- D1. Ouvrir, regarder, écouter : ce n'est pas travailler --------------------------------------------------
    {
        const D = await ouvrirApp({ avant: avecFauxFirebase() });
        try {
            const pg = D.page;
            await compterQuestions(pg);
            await attendre(700);
            check(await sansDialogue(pg, 100), 'ouvrir l\'application sans rien toucher : aucune question (celui qui vient seulement lire ou écouter n\'est pas interrompu)');
            await pg.keyboard.press('ArrowRight'); await pg.keyboard.press('ArrowLeft');
            await pg.evaluate(() => window.app.nouvelOnglet());
            check(await sansDialogue(pg, 500), 'déplacer le curseur, ouvrir un nouvel onglet : aucune question — ce n\'est pas encore travailler');

            // --- D2. La première vraie modification pose la question -------------------------------------
            await taper(pg, ['7']);
            exiger(await dialogueOuvert(pg), 'la première modification (une case de tablature écrite) pose la question');
            let d = await lireDialogue(pg);
            check(d.titre === 'Tu n\'es pas connecté' && d.boutons.join('|') === 'Continuer sans me connecter|Me connecter avec Google',
                `elle dit « ${d.titre} » et propose deux choix : ${d.boutons.join(' / ')}`);
            check((await pg.evaluate(() => window.app.editeur.etapesDocument())) > 0, 'et la modification qui l\'a déclenchée est bien appliquée (la question ne la bloque pas, ni ne la perd)');
            check(d.focusDansLaFenetre && !d.focusSurBouton,
                'le focus est dans la fenêtre mais SUR AUCUN BOUTON : la frappe suivante (Entrée, espace) ne peut pas activer un choix avant qu\'on ait lu');
            await pg.keyboard.press('Enter'); await pg.keyboard.press('Space'); await attendre(250);
            check((await lireDialogue(pg)).ouvert && (await pg.evaluate(() => window.firebase.auth()._appelsConnexion)) === 0,
                'Entrée puis espace pendant que la question est à l\'écran ne répondent à rien : elle reste ouverte, aucune connexion lancée');

            // --- D3. Échap vaut « continuer » : la question ne revient pas ----------------------------------
            await pg.keyboard.press('Escape');
            check(await sansDialogue(pg, 150), 'Échap referme la question');
            check((await repondu(pg)) === true, 'et vaut « continuer sans me connecter »');
            check(await pg.evaluate(() => document.activeElement && document.activeElement.id === 'zone-partition'), 'le focus revient à la partition : on continue de taper là où on était');
            await taper(pg, ['ArrowRight', '8']);
            check(await sansDialogue(pg, 500) && (await nbQuestions(pg)) === 1, 'les modifications suivantes ne posent plus la question (une seule pour toute la séance)');
        } finally { await D.fermer(); }
    }

    // --- D4. « Me connecter avec Google » : la fenêtre Google s'ouvre DANS le clic ---------------------------------
    {
        const D = await ouvrirApp({ avant: avecFauxFirebase({ uid: 'u1', nom: 'Lucas Martin' }) });
        try {
            const pg = D.page;
            await espionnerGoogle(pg);
            await taper(pg, ['5']);
            exiger(await dialogueOuvert(pg), 'préalable : la question est posée');
            await pg.click('#fenetre-dialogue [data-choix="connecter"]');
            const demandes = await pg.evaluate(() => window.__googleDemande);
            check(demandes.length === 1 && demandes[0] === 'click',
                `la fenêtre Google est demandée DANS le clic (évènement en cours : ${JSON.stringify(demandes)}) — pas après une attente, que Safari refuserait`);
            check(await pg.waitForFunction(() => document.getElementById('btn-nuage').dataset.etat === 'connecte', null, { timeout: 4000 }).then(() => true, () => false),
                'puis on est connecté : le bouton de la barre du haut montre le prénom');
            check(await sansDialogue(pg, 100), 'et la question est refermée');
            await taper(pg, ['ArrowRight', '3']);
            check(await sansDialogue(pg, 500), 'connecté, les modifications suivantes ne posent plus aucune question');
        } finally { await D.fermer(); }
    }

    // --- D5. Le bouton de la barre du haut lance Google lui aussi dans le clic ------------------------------------------
    {
        const D = await ouvrirApp({ avant: avecFauxFirebase() });
        try {
            const pg = D.page;
            await espionnerGoogle(pg);
            await pg.click('#btn-nuage');
            const demandes = await pg.evaluate(() => window.__googleDemande);
            check(demandes.length === 1 && demandes[0] === 'click', `le bouton « Se connecter » demande la fenêtre Google dans le clic (${JSON.stringify(demandes)})`);
        } finally { await D.fermer(); }
    }

    // --- D6. Google refermé sans se connecter : pas d'erreur affichée, et la question revient ---------------------
    {
        const D = await ouvrirApp({ avant: avecFauxFirebase() });
        try {
            const pg = D.page;
            await compterQuestions(pg);
            await pg.evaluate(() => { window.firebase.auth()._echecConnexion = { code: 'auth/popup-closed-by-user', message: 'Firebase: Error (auth/popup-closed-by-user).' }; });
            await taper(pg, ['4']);
            exiger(await dialogueOuvert(pg), 'préalable : la question est posée');
            await pg.click('#fenetre-dialogue [data-choix="connecter"]');
            await attendre(400);
            const msg = await pg.evaluate(() => document.getElementById('message').textContent);
            check(!/Connexion impossible|popup/.test(msg), `refermer la fenêtre Google n'est pas une erreur : aucun message (« ${msg} »)`);
            check((await pg.evaluate(() => document.getElementById('btn-nuage').dataset.etat)) === 'deconnecte', 'on reste déconnecté, et le bouton continue de proposer « Se connecter »');
            await taper(pg, ['ArrowRight', '6']);
            check(await dialogueOuvert(pg) && (await nbQuestions(pg)) === 2, 'la modification suivante REDEMANDE : il avait dit vouloir se connecter, ce n\'est pas fait');
            await pg.keyboard.press('Escape');
        } finally { await D.fermer(); }
    }

    // --- D7. Fenêtre bloquée par le navigateur : on le dit, et comment s'en sortir -------------------------------
    {
        const D = await ouvrirApp({ avant: avecFauxFirebase() });
        try {
            const pg = D.page;
            await pg.evaluate(() => { window.firebase.auth()._echecConnexion = { code: 'auth/popup-blocked', message: 'bloqué' }; });
            await pg.click('#btn-nuage');
            await attendre(300);
            const msg = await pg.evaluate(() => document.getElementById('message').textContent);
            check(/bloqué la fenêtre de connexion/.test(msg) && /autorise/.test(msg), `fenêtre bloquée : le message dit pourquoi et quoi faire (« ${msg} »)`);
        } finally { await D.fermer(); }
    }

    // --- D8. Connecté AILLEURS pendant que la question est à l'écran : elle disparaît d'elle-même ---------------------
    {
        const D = await ouvrirApp({ avant: avecFauxFirebase({ uid: 'u1', nom: 'Lucas Martin' }) });
        try {
            const pg = D.page;
            await compterQuestions(pg);
            await taper(pg, ['2']);
            exiger(await dialogueOuvert(pg), 'préalable : la question est posée');
            await pg.evaluate(() => window.firebase.auth()._connecter());   // un autre onglet vient de se connecter
            check(await pg.waitForFunction(() => document.getElementById('fenetre-dialogue').hidden, null, { timeout: 3000 }).then(() => true, () => false),
                'connecté depuis un autre onglet pendant que la question est à l\'écran : elle se referme toute seule (elle n\'a plus d\'objet)');
            await pg.evaluate(() => window.app.nuage.deconnecter());
            await attendre(300);
            await taper(pg, ['ArrowRight', '1']);
            check(await dialogueOuvert(pg) && (await nbQuestions(pg)) === 2, 'puis déconnecté : la modification suivante redemande (la fermeture automatique n\'a pas compté comme une réponse)');
            await pg.keyboard.press('Escape');
        } finally { await D.fermer(); }
    }

    // --- D9. Un clic à côté vaut « continuer » ---------------------------------------------------------------------
    {
        const D = await ouvrirApp({ avant: avecFauxFirebase() });
        try {
            const pg = D.page;
            await taper(pg, ['9']);
            exiger(await dialogueOuvert(pg), 'préalable : la question est posée');
            await pg.evaluate(() => { const v = document.getElementById('fenetre-dialogue'); v.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
            check(await sansDialogue(pg, 150) && (await repondu(pg)) === true, 'un clic à côté referme la question et vaut « continuer »');
        } finally { await D.fermer(); }
    }

    // --- D10. Firebase n'a pas encore répondu : on ne le sait pas, on ne demande pas ----------------------------------
    {
        // Une session est restaurée, mais Firebase met 700 ms à le dire : c'est le piège du garde-fou naïf.
        const D = await ouvrirApp({ avant: avecFauxFirebase({ uid: 'u1', nom: 'Lucas Martin', dejaConnecte: true, authApres: 2500 }) });
        try {
            const pg = D.page;
            await taper(pg, ['7']);
            exiger(await pg.evaluate(() => window.app.nuage.etat().authConnue === false), 'préalable : Firebase n\'a PAS encore répondu au moment de la modification (sans quoi ce scénario n\'éprouverait rien)');
            check(await sansDialogue(pg, 100), 'Firebase n\'a pas encore répondu : aucune question (on ne sait pas encore si l\'utilisateur est connecté)');
            await pg.waitForFunction(() => document.getElementById('btn-nuage').dataset.etat === 'connecte', null, { timeout: 4000 });
            check(await sansDialogue(pg, 400), 'il répond « connecté » (session restaurée) : la question ne vient JAMAIS — on ne demande pas de se connecter à quelqu\'un qui l\'est');
        } finally { await D.fermer(); }
    }
    {
        // Même retard, mais personne n'est connecté : la question vient, une fois la réponse connue.
        const D = await ouvrirApp({ avant: avecFauxFirebase({ uid: 'u1', nom: 'Lucas Martin', authApres: 2500 }) });
        try {
            const pg = D.page;
            await taper(pg, ['7']);
            exiger(await pg.evaluate(() => window.app.nuage.etat().authConnue === false), 'préalable : Firebase n\'a PAS encore répondu au moment de la modification');
            check(await sansDialogue(pg, 100), 'Firebase tarde, personne n\'est connecté : pas de question tant qu\'il n\'a pas répondu…');
            check(await dialogueOuvert(pg, 5000), '…elle vient dès qu\'il répond « personne », pour la modification faite entre-temps');
            await pg.keyboard.press('Escape');
        } finally { await D.fermer(); }
    }

    // --- D11. Au rechargement, le dernier compte s'affiche tout de suite (pas de « Se connecter » qui clignote) -----
    {
        // Firebase met 2,5 s à répondre : assez pour regarder le bouton AVANT sa réponse.
        const D = await ouvrirApp({ avant: avecFauxFirebase({ uid: 'u1', nom: 'Lucas Martin', dejaConnecte: true, authApres: 2500 }) });
        try {
            const pg = D.page;
            const etatBouton = () => pg.evaluate(() => { const b = document.getElementById('btn-nuage'); return { etat: b.dataset.etat, avatar: b.dataset.avatar, libelle: b.querySelector('.nuage-libelle').textContent }; });
            await pg.waitForFunction(() => document.getElementById('btn-nuage').dataset.etat === 'connecte', null, { timeout: 8000 });
            check(JSON.parse(await pg.evaluate(() => localStorage.getItem('nuage.tabhub.compte')) || 'null')?.nom === 'Lucas Martin',
                'connecté : le nom du compte est retenu dans le navigateur (un indice d\'affichage, rien d\'autre)');
            await pg.reload({ waitUntil: 'domcontentloaded' });
            await pg.waitForFunction(() => window.app && window.app.page, null, { timeout: 20000 });
            const avant = await etatBouton();
            check(avant.etat === 'inconnu' && avant.libelle === 'Lucas' && avant.avatar === 'initiale',
                `au rechargement, AVANT que Firebase ne réponde, le bouton montre déjà le dernier compte (${avant.etat} / ${avant.libelle}) au lieu d'un « Se connecter » qui clignoterait`);
            await pg.waitForFunction(() => document.getElementById('btn-nuage').dataset.etat === 'connecte', null, { timeout: 8000 });
            await pg.evaluate(() => window.app.nuage.deconnecter());
            await pg.waitForFunction(() => document.getElementById('btn-nuage').dataset.etat === 'deconnecte', null, { timeout: 4000 });
            check((await pg.evaluate(() => localStorage.getItem('nuage.tabhub.compte'))) === null, 'déconnecté : l\'indice est oublié (le bouton ne montrera plus ce nom au prochain chargement)');
        } finally { await D.fermer(); }
    }

    // --- D12. Le script du moteur n'a pas chargé : pas de bouton qui ne mène nulle part -----------------------------------
    {
        // `window.Nuage` reste indéfini quoi qu'on lui affecte : comme si nuage.js n'avait jamais été servi.
        const D = await ouvrirApp({ avant: ["Object.defineProperty(window, 'Nuage', { get() { return undefined; }, set() {} });"] });
        try {
            const pg = D.page;
            await taper(pg, ['6']);
            const r = await pg.evaluate(() => ({ cache: document.getElementById('btn-nuage').hidden, dialogue: !document.getElementById('fenetre-dialogue').hidden,
                                                 moteur: window.app.nuage, notes: window.app.editeur.etapesDocument() }));
            check(r.cache && !r.dialogue && r.moteur === null && r.notes > 0,
                'sans le moteur (script non chargé) : pas de bouton qui ne mène nulle part, aucune question, et l\'édition marche comme avant');
            check(D.erreurs.length === 0, `et aucune erreur de console (${D.erreurs.length})`);
        } finally { await D.fermer(); }
    }

    // ===== E. LE BOUTON DANS LA BARRE DU HAUT : DESSIN ET PLACE ===========================================
    // La barre du haut tenait PILE à 390px (voir style.css) : un bouton à libellé la ferait déborder, et
    // `overflow-x: auto` cacherait Réglages derrière un défilement que rien ne signale.
    {
        const mesurer = (pg) => pg.evaluate(() => {
            const barre = document.querySelector('.barre-haut'); const b = document.getElementById('btn-nuage'); const r = b.getBoundingClientRect();
            const cs = getComputedStyle(b);
            return { deborde: barre.scrollWidth - barre.clientWidth, largeur: Math.round(r.width), hauteur: Math.round(r.height),
                     libelleVisible: getComputedStyle(b.querySelector('.nuage-libelle')).display !== 'none', affichage: cs.display, rayon: parseFloat(cs.borderTopLeftRadius),
                     bordure: cs.borderTopColor, dansFichiers: !!document.querySelector('#btn-fichiers #btn-nuage, #btn-fichiers .pastille-nuage') };
        });
        const E = await ouvrirApp({ viewport: { width: 1320, height: 800 }, avant: avecFauxFirebase() });
        try {
            const pg = E.page;
            const m1 = await mesurer(pg);
            // `inline-flex` devient `flex` : un enfant direct d'une barre en flex est « blockifié ». Un bouton NU serait `block`.
            check(m1.affichage === 'flex' && m1.rayon > 100 && m1.libelleVisible,
                `sur ordinateur, le bouton est dessiné par sa règle de base (flex, arrondi) et montre son libellé (${m1.affichage}, rayon ${m1.rayon}) — une accolade en trop dans la feuille de style l'avait silencieusement fait avaler`);
            check(!m1.dansFichiers, 'et il n\'est plus dans le bouton Fichiers');
            const bordureDeconnecte = m1.bordure;
            await pg.click('#btn-nuage');
            await pg.waitForFunction(() => document.getElementById('btn-nuage').dataset.etat === 'connecte', null, { timeout: 4000 });
            await attendre(300);   // la bordure s'anime (0,12 s) : on mesure une fois posée
            const m2 = await mesurer(pg);
            check(m2.bordure !== bordureDeconnecte, `le déconnecté se voit de loin : sa bordure change une fois connecté (${bordureDeconnecte} → ${m2.bordure})`);
        } finally { await E.fermer(); }
        for (const largeur of [390, 360]) {
            const T = await ouvrirApp({ viewport: { width: largeur, height: 800 }, hasTouch: true, isMobile: true, avant: avecFauxFirebase() });
            try {
                const pg = T.page;
                const a = await mesurer(pg);
                await pg.tap('#btn-nuage');
                await pg.waitForFunction(() => document.getElementById('btn-nuage').dataset.etat === 'connecte', null, { timeout: 4000 });
                const b = await mesurer(pg);
                check(a.deborde <= 0 && b.deborde <= 0, `téléphone ${largeur}px : la barre du haut ne déborde pas, déconnecté (${a.deborde}px) comme connecté (${b.deborde}px)`);
                check(!a.libelleVisible && a.largeur >= 40 && a.hauteur >= 40, `et le bouton garde son rond, assez grand pour le doigt (${a.largeur}×${a.hauteur}px), sans libellé`);
            } finally { await T.fermer(); }
        }
    }

    bilan();
})();
