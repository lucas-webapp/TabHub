// Banc de « ENREGISTRÉ » NE SE DIT QUE QUAND C'EST VRAI.
//
// LE DÉFAUT, mot pour mot (retour utilisateur) : « J'ai défini mon dossier d'export/import. Lorsque
// je clique sur enregistrer mon morceau la première fois : ok bien transféré dans le dossier. J'ai
// continué à le modifier, mais lorsque je clique sur enregistrer maintenant, rien ne s'exporte dans
// le dossier alors que j'ai le message "enregistré". Je trouve cela très bancal. »
//
// IL AVAIT RAISON, ET C'EST LE PIRE DÉFAUT POSSIBLE : un message rassurant fait fermer l'onglet en
// confiance. Deux causes, et elles se renforçaient.
//
//   1. LA CAUSE DE FOND. `enregistrer()` appelait le rangement avec `demander: false`, ce qui
//      INTERDISAIT de redemander au navigateur l'autorisation d'écrire dans le dossier. Or Chrome ne
//      garde cette autorisation qu'un temps : le premier enregistrement, juste après le choix du
//      dossier, passe ; un enregistrement plus tard tombe sur une autorisation redevenue « à
//      demander », et le rangement rend `null` sans un mot. Le drapeau s'appelait
//      `silencieuxSiPasDeDossier` et confondait deux choses : ne pas RÉCLAMER de dossier quand il
//      n'y en a pas (une question d'affichage), et ne pas OSER redemander l'accès à celui qui est
//      configuré (une question d'accès, qui n'avait aucune raison d'être — on est dans un clic,
//      le seul moment où un navigateur accepte de reposer la question).
//
//   2. CE QUI LE RENDAIT INVISIBLE. Une seule ligne annonçait le résultat :
//         this.message(resultat && resultat.range ? messageEnregistrement(...) : 'Enregistré');
//      La branche « rien n'a été écrit » disait « Enregistré », exactement comme la branche qui
//      avait réussi — et pour TOUS les motifs : pas de dossier, autorisation retirée, conflit
//      annulé. Le brouillon local, lui, était bien écrit ; le message avait donc une part de vérité,
//      et c'est ce qui le rendait si trompeur.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('« Enregistré » ne se dit que quand c\'est vrai');

(async () => {
    plan(12);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // ── 1. LE RANGEMENT DIT POURQUOI, et non plus seulement « non » ──────────────────────────
        const sansDossier = await page.evaluate(async () => {
            const F = await import('/src/io/fichiers.js');
            // On part d'une base propre : aucun dossier mémorisé.
            await F.oublierRacine();
            return F.etatRangement({ demander: false });
        });
        check(sansDossier.racine === null && ['aucunDossier', 'indisponible'].includes(sansDossier.raison),
            `sans dossier configuré, le rangement dit POURQUOI (« ${sansDossier.raison} ») — avant, il `
            + 'rendait `null` dans tous les cas, et l\'appelant ne pouvait rien en dire');

        const avecDossier = await page.evaluate(async () => {
            const F = await import('/src/io/fichiers.js');
            // Une doublure de poignée déposée là où l'application range la sienne. Elle n'a pas de
            // `queryPermission` — le chemin prévu pour l'OPFS et pour les bancs (voir
            // permissionEcriture) — donc elle se comporte comme un dossier accessible.
            await new Promise((res, rej) => {
                const r = indexedDB.open('harmohub_fichiers', 1);
                r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('racines')) r.result.createObjectStore('racines'); };
                r.onsuccess = () => { const tx = r.result.transaction('racines', 'readwrite');
                    tx.objectStore('racines').put({ name: 'Dossier d\'essai' }, 'racine:TabHub'   /* cleRacine() préfixe par NOM_APPLI, qui vaut « TabHub » */);
                    tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = () => rej(tx.error); };
                r.onerror = () => rej(r.error);
            });
            const etat = await F.etatRangement({ demander: false });
            return { raison: etat.raison, nom: etat.racine?.name || null };
        });
        check(avecDossier.raison === 'ok' && avecDossier.nom === 'Dossier d\'essai',
            `avec un dossier accessible, il rend « ok » et la poignée (${avecDossier.nom})`);

        // ── 2. ON REDEMANDE TOUJOURS L'AUTORISATION ─────────────────────────────────────────────
        const source = await page.evaluate(async () => {
            const r = await fetch('/src/main.js'); const src = await r.text();
            const i = src.indexOf('async ecrireMorceauSurDisque');
            return src.slice(i, i + 1600);
        });
        check(/etatRangement\(\{ demander: true \}\)/.test(source),
            'le chemin d\'écriture redemande TOUJOURS l\'autorisation (`demander: true`), sans condition : '
            + 'c\'est un clic, le seul moment où le navigateur accepte de reposer la question');
        // ON CHERCHE L'APPEL, PAS LA PHRASE : le commentaire juste au-dessus CITE l'ancienne forme
        // pour expliquer ce qu'elle cassait, et une recherche naïve la retrouvait donc toujours.
        check(!/preparerRangement\(\{\s*demander: !/.test(source),
            'et l\'ancien appel, qui la lui interdisait précisément là, a disparu');

        // ── 3. LE MESSAGE DIT LA VÉRITÉ, motif par motif ────────────────────────────────────────
        //
        // On remplace l'écriture sur disque par une doublure qui rend chaque issue possible, et on
        // lit ce que la barre de message annonce. C'est exactement ce que voit l'utilisateur.
        const messages = await page.evaluate(async () => {
            const app = window.app;
            const vrai = app.ecrireMorceauSurDisque.bind(app);
            const lire = async (retour) => {
                app.ecrireMorceauSurDisque = async () => retour;
                await app.enregistrer();
                return document.getElementById('message')?.textContent
                    || document.querySelector('.message, #message-appli')?.textContent || '';
            };
            const out = {
                ecrit: await lire({ range: true, nom: 'Mad Honey.json', dossier: 'morceaux',
                                    chemin: 'morceaux/Mad Honey.json', racine: 'Musique' }),
                permission: await lire({ range: false, raison: 'permission' }),
                annule: await lire({ range: false, raison: 'annule' }),
                aucunDossier: await lire({ range: false, raison: 'aucunDossier' }),
            };
            app.ecrireMorceauSurDisque = vrai;
            return out;
        });

        exiger(/Enregistr/.test(messages.ecrit), `préalable : une écriture réussie s'annonce (« ${messages.ecrit} »)`);
        check(/Musique\/morceaux/.test(messages.ecrit),
            `quand le fichier est VRAIMENT écrit, le message dit OÙ (« ${messages.ecrit} ») : la destination `
            + 'est annoncée par un seul endroit (voir io/fichiers.js#messageEnregistrement), et une '
            + 'destination annoncée à tort est exactement ce qui fait perdre un fichier');

        check(messages.permission !== 'Enregistré' && /PAS dans votre dossier/.test(messages.permission),
            `autorisation retirée : « ${messages.permission} » — et surtout PLUS « Enregistré » tout court, `
            + 'qui était le message exact du défaut signalé');
        check(/navigateur/.test(messages.permission) && /Réglages/.test(messages.permission),
            'il dit les deux choses à la fois : ce qui EST sauvé (le brouillon, la vraie sauvegarde) et '
            + 'où aller réparer ce qui ne l\'est pas');

        check(messages.annule !== 'Enregistré' && /n'a pas été touché/.test(messages.annule),
            `conflit annulé : « ${messages.annule} » — on vient justement de décider de ne pas toucher au `
            + 'fichier, l\'annoncer « Enregistré » serait dire l\'inverse du geste qu\'on a fait');
        check(messages.aucunDossier !== 'Enregistré' && /aucun dossier/.test(messages.aucunDossier),
            `aucun dossier configuré : « ${messages.aucunDossier} » — celui-là n'est pas une alerte, c'est `
            + 'l\'état normal de quelqu\'un qui n\'a rien configuré ; il doit juste être exact');

        // ── NEUTRALISATION : l'ancienne ligne, rejouée sur les mêmes issues ─────────────────────
        const ancien = await page.evaluate(() => {
            // La ligne d'avant, mot pour mot : `resultat && resultat.range ? … : 'Enregistré'`.
            const ancienMessage = (resultat) => (resultat && resultat.range) ? 'Enregistré · fichier' : 'Enregistré';
            return {
                permission: ancienMessage({ range: false, raison: 'permission' }),
                annule: ancienMessage({ range: false, raison: 'annule' }),
                aucunDossier: ancienMessage(null),
            };
        });
        check(ancien.permission === 'Enregistré' && ancien.annule === 'Enregistré' && ancien.aucunDossier === 'Enregistré',
            'neutralisation : l\'ancienne ligne rendait « Enregistré » sur les TROIS issues où rien n\'était '
            + 'écrit, mot pour mot le même message que sur une écriture réussie — aucune des trois n\'était '
            + 'distinguable, et c\'est ce qui a coûté un travail perdu');

        check(erreurs.length === 0, 'aucune erreur de console ni exception (' + erreurs.join(' | ') + ')');
    } catch (e) {
        check(false, 'exception pendant le banc : ' + e.message + '\n' + e.stack);
    } finally {
        await fermer();
    }
    process.exit(bilan());
})();
