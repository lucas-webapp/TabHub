// Banc de l'HISTORIQUE DES VERSIONS — voir io/versions.js et main.js#_archiverVersion.
//
// CE QU'IL PROTÈGE. Retour utilisateur, en réponse à la proposition d'un historique : « c'est un peu
// le bazar dans HarmoHub avec les versions entre parenthèses. Je propose de pouvoir les afficher ou
// non. Au moment d'un import, me demander si je veux écraser la version précédente. »
//
// TROIS EXIGENCES, DONC, et c'est le plan de ce banc :
//   1. PAS DE BAZAR. Ce que reproche le retour, c'est l'ACCUMULATION : dans HarmoHub, réimporter une
//      sauvegarde laisse des copies nommées « Titre (import du 14/09/2025) » au milieu de la
//      bibliothèque (script.js#importLibraryFile). Ici, quatre garde-fous l'empêchent, et ce banc les
//      éprouve un par un : nombre BORNÉ, pas de DOUBLON (trois Ctrl+S d'affilée = une version), pas
//      de version d'un morceau VIDE, et les versions à part du morceau — jamais dans son nom.
//   2. AFFICHER OU NON. Un interrupteur, et qui EFFACE vraiment en s'éteignant : un interrupteur qui
//      n'aurait masqué que la liste aurait continué à consommer le quota du navigateur (partagé avec
//      le brouillon) tout en faisant croire à un effacement. Ce banc vérifie que le stockage est
//      réellement vidé, et que plus rien ne s'y écrit ensuite.
//   3. LA QUESTION À L'IMPORT. Elle ne doit se poser qu'aux IMPORTS (pas devant « Nouveau »), et
//      seulement s'il y a déjà une version à écraser — une question dont une seule réponse a du sens
//      n'est pas une question, c'est une étape de plus.
//
// ET UNE PROPRIÉTÉ QU'ON PERD FACILEMENT : revenir à une version doit ARCHIVER l'état qu'on quitte.
// Sans cela, « revenir en arrière » est un aller simple, et se tromper de ligne coûte le travail en
// cours — l'inverse exact de ce qu'un historique promet.
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('historique des versions');

(async () => {
    plan(45);
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 1320, height: 900 } });
    try {
        const versions = () => page.evaluate(() => {
            let brut = [];
            try { brut = JSON.parse(localStorage.getItem('tabhub.versions') || '[]'); } catch (e) { /* vide */ }
            return brut.map(v => ({ titre: v.titre, mesures: v.mesures, notes: v.notes, date: v.date }));
        });
        const frettes = () => page.evaluate(() =>
            window.app.editeur.partition.mesures[0].voix[0].evenements.flatMap(e => e.notes.map(n => n.frette)));
        const dialogue = () => page.evaluate(() => {
            const v = document.getElementById('fenetre-dialogue');
            if (v.hidden) return null;
            return {
                titre: v.querySelector('.dialogue-titre').textContent,
                texte: v.querySelector('.dialogue-texte').textContent,
                choix: [...v.querySelectorAll('.dialogue-actions button')].map(b => b.dataset.choix),
            };
        });
        /** Écrit une case sur le PREMIER évènement libre, pour que chaque appel ajoute VRAIMENT une
         *  note : réécrire toujours le même évènement changerait le contenu sans changer le compte,
         *  et le banc ne saurait plus distinguer deux versions. */
        const ajouterNote = async (frette) => {
            await page.evaluate((f) => {
                const ed = window.app.editeur;
                const evts = ed.partition.mesures[0].voix[0].evenements;
                const libre = evts.findIndex(e => !e.notes || e.notes.length === 0);
                ed.placerCurseur(0, 0, libre < 0 ? evts.length - 1 : libre, 0);
                ed.saisirChiffre(f);
            }, frette);
            await page.waitForTimeout(220);
        };
        const enregistrer = async () => { await page.click('#btn-enregistrer'); await page.waitForTimeout(320); };

        // --- 1. UN MORCEAU VIDE N'EST PAS UNE VERSION ---------------------------------------------
        check((await versions()).length === 0, 'au démarrage, aucune version : rien n\'a encore été fait');
        await enregistrer();
        check((await versions()).length === 0,
            'enregistrer un morceau VIDE n\'archive rien — sinon l\'historique s\'ouvrirait sur des lignes « Sans titre » à départager');

        // --- 2. UN ENREGISTREMENT DÉLIBÉRÉ pose une version ---------------------------------------
        await ajouterNote(5);
        await enregistrer();
        const v1 = await versions();
        exiger(v1.length === 1, `une note puis Enregistrer pose UNE version (${v1.length})`);
        check(v1[0].notes === 1 && v1[0].mesures === 4,
            `elle retient de quoi la reconnaître : ${v1[0].mesures} mesures, ${v1[0].notes} note`);

        // --- 3. PAS DE DOUBLON : Ctrl+S est un réflexe --------------------------------------------
        await enregistrer();
        await enregistrer();
        check((await versions()).length === 1,
            'deux enregistrements de plus sans rien changer entre deux n\'ajoutent RIEN : c\'est une version, archivée trois fois');
        await ajouterNote(7);
        await enregistrer();
        const v2 = await versions();
        check(v2.length === 2 && v2[0].notes === 2,
            `une vraie modification, elle, en pose une nouvelle (${v2.length} versions, la plus récente à ${v2[0].notes} notes)`);
        check(v2[0].date >= v2[1].date, 'la plus récente est en TÊTE de liste — l\'ordre dans lequel on la cherche');

        // --- 4. LE NOMBRE EST BORNÉ : l'accumulation a une fin ------------------------------------
        // CHAQUE ÉTAT EST TITRÉ, et c'est le titre qui sert de marqueur. Une première version de ce
        // banc comptait sur le nombre de NOTES pour distinguer les états : mesuré, il plafonne à deux
        // (la mesure se remplit, les enregistrements suivants réécrivent la même case — le contenu
        // change, le compte non), et l'assertion « les dernières survivent » passait pour les
        // mauvaises raisons. Un titre numéroté rend l'ordre d'éviction VÉRIFIABLE : on doit retrouver
        // les dix derniers, pas dix quelconques.
        for (let i = 1; i <= 12; i++) {
            await page.evaluate((n) => window.app.editeur.definirMeta('titre', 'etat-' + String(n).padStart(2, '0')), i);
            await page.waitForTimeout(160);
            await enregistrer();
        }
        const pleine = await versions();
        check(pleine.length === 10,
            `après quatorze enregistrements distincts, DIX versions sont gardées (${pleine.length}) — la plus ancienne s'efface d'elle-même, rien à nettoyer à la main`);
        const titres = pleine.map(v => v.titre);
        check(titres[0] === 'etat-12' && titres[9] === 'etat-03',
            `et ce sont les DERNIÈRES qui survivent, dans l'ordre : ${titres[0]} en tête, ${titres[9]} en queue — les deux premiers états sont bien ceux qui ont cédé la place`);

        // --- 5. LA FENÊTRE : une liste qu'on peut lire --------------------------------------------
        await page.click('#btn-fichiers'); await page.waitForTimeout(200);
        const entree = await page.evaluate(() => {
            const b = document.querySelector('#popover-fichiers [data-action="versions"]');
            return { existe: !!b, cachee: !!b?.hidden };
        });
        exiger(entree.existe && !entree.cachee, 'l\'entrée « Versions précédentes… » est dans le menu Fichiers');
        await page.click('#popover-fichiers [data-action="versions"]'); await page.waitForTimeout(400);
        const fenetre = await page.evaluate(() => {
            const lignes = [...document.querySelectorAll('#liste-versions .ligne-version')];
            return {
                ouverte: !document.getElementById('fenetre-versions').hidden,
                nb: lignes.length,
                premiere: lignes[0]?.querySelector('.version-date')?.textContent || '',
                detail: lignes[0]?.querySelector('.version-detail')?.textContent || '',
                aRevenir: !!lignes[0]?.querySelector('.btn-neutre'),
                aJeter: lignes[0]?.querySelectorAll('button').length === 2,
            };
        });
        exiger(fenetre.ouverte && fenetre.nb === 10, `la fenêtre les liste toutes les dix (${fenetre.nb})`);
        check(/récente/.test(fenetre.premiere),
            `la première est marquée comme telle (« ${fenetre.premiere} ») — sans ce repère on restaure ce qu'on a déjà sous les yeux`);
        check(/note/.test(fenetre.detail) && /mesure/.test(fenetre.detail),
            `chaque ligne dit de quoi il s'agit (« ${fenetre.detail} ») : le nombre de NOTES est ce qui distingue deux versions d'un même morceau, le nombre de mesures ne bouge presque jamais`);
        check(fenetre.aRevenir && fenetre.aJeter, 'et n\'offre que deux gestes : y revenir, ou la jeter');

        // --- 6. REVENIR À UNE VERSION archive l'état qu'on quitte --------------------------------
        const titreCourant = () => page.evaluate(() => window.app.editeur.partition.meta.titre);
        const avantRetour = await titreCourant();
        const nbAvant = (await versions()).length;
        // LE TITRE EST LE MARQUEUR (voir la section 4) : on cible la troisième ligne, et on vérifie
        // qu'on récupère EXACTEMENT son état — pas seulement « quelque chose a changé ». Comparer les
        // cases de tablature ne dirait rien ici : ces états ne diffèrent que par leur titre.
        const cible = (await versions())[2];
        exiger(!!cible && cible.titre && cible.titre !== avantRetour,
            `préalable : la version visée porte un état distinct de l'actuel (« ${cible?.titre} » contre « ${avantRetour} »)`);
        await page.click('#liste-versions .ligne-version:nth-child(3) .btn-neutre');
        await page.waitForTimeout(400);
        const garde = await dialogue();
        exiger(garde !== null && garde.choix.includes('sans'),
            'revenir à une version passe par le MÊME garde-fou que les autres remplacements : c\'en est un');
        await page.click('#fenetre-dialogue [data-choix="sans"]');
        await page.waitForTimeout(600);
        const apresRetour = await titreCourant();
        check(apresRetour === cible.titre,
            `le morceau est REVENU à l'état visé, pas à un autre : « ${avantRetour} » -> « ${apresRetour} » (attendu « ${cible.titre} »)`);
        check((await frettes()).length > 0,
            'et la musique est bien là : une version restaurée passe par normaliser, comme un .json — un état écrit par une version antérieure ne doit pas arriver amputé');
        check((await versions()).length === nbAvant,
            'et l\'état qu\'on quitte est archivé au passage — le plafond étant atteint, le compte ne monte pas, mais « revenir » n\'est pas un aller simple');
        check(await page.evaluate(() => document.getElementById('fenetre-versions').hidden),
            'la fenêtre se referme : on est revenu, il n\'y a plus rien à y choisir');

        // --- 7. JETER UNE VERSION, après confirmation --------------------------------------------
        await page.click('#btn-fichiers'); await page.waitForTimeout(200);
        await page.click('#popover-fichiers [data-action="versions"]'); await page.waitForTimeout(400);
        const nbAvantJet = (await versions()).length;
        await page.click('#liste-versions .ligne-version:nth-child(2) button:last-child');
        await page.waitForTimeout(400);
        const confirmation = await dialogue();
        exiger(confirmation !== null && confirmation.choix.includes('supprimer'),
            'jeter une version DEMANDE d\'abord : c\'est le seul geste irréversible de cette fenêtre');
        await page.click('#fenetre-dialogue [data-choix="annuler"]');
        await page.waitForTimeout(350);
        check((await versions()).length === nbAvantJet, 'annuler ne jette rien');
        await page.click('#liste-versions .ligne-version:nth-child(2) button:last-child');
        await page.waitForTimeout(400);
        await page.click('#fenetre-dialogue [data-choix="supprimer"]');
        await page.waitForTimeout(450);
        check((await versions()).length === nbAvantJet - 1,
            `confirmer la retire vraiment (${nbAvantJet} -> ${(await versions()).length})`);
        check((await page.evaluate(() => document.querySelectorAll('#liste-versions .ligne-version').length)) === nbAvantJet - 1,
            'et la liste affichée se remet à jour sans qu\'il faille rouvrir la fenêtre');
        await page.click('#fenetre-versions [data-fermer]'); await page.waitForTimeout(300);

        // --- 8. LES VERSIONS NE VOYAGENT PAS DANS LE MORCEAU -------------------------------------
        const contenu = await page.evaluate(() => JSON.stringify(window.app.editeur.partition));
        check(!/versions|"v[0-9a-z]{8}/.test(contenu),
            'aucune version n\'est écrite dans le morceau lui-même : le .json reste le morceau, pas son historique');

        // --- 8bis. LA QUESTION À L'IMPORT — la demande la plus explicite du retour ---------------
        const chemin = require('path').join(require('os').tmpdir(), 'tabhub-banc-versions.json');
        require('fs').writeFileSync(chemin, JSON.stringify({
            meta: { titre: 'Morceau importé', tempo: 100 },
            piste: { instrument: 'guitare', accordage: 'standard' },
            mesures: [{ signature: { haut: 4, bas: 4 }, voix: [{ evenements: [{ valeur: 4, points: 0, notes: [{ corde: 0, frette: 3 }] }] }] }],
        }));
        /** Ouvre le .json d'essai et rend le dialogue de VERSION, le garde-fou d'export écarté au
         *  passage (deux questions se suivent, et seule la seconde est le sujet de cette section). */
        const ouvrirLeFichier = async () => {
            await page.click('#btn-fichiers'); await page.waitForTimeout(200);
            const [selecteur] = await Promise.all([
                page.waitForEvent('filechooser'),
                page.click('#popover-fichiers [data-action="ouvrir"]'),
            ]);
            await selecteur.setFiles(chemin);
            await page.waitForTimeout(600);
            const premier = await dialogue();
            if (premier && premier.choix.includes('sans')) {
                await page.click('#fenetre-dialogue [data-choix="sans"]');
                await page.waitForTimeout(600);
            }
            return dialogue();
        };
        // On repart d'un morceau modifié mais non exporté, pour que les deux gardes aient lieu.
        await page.evaluate(() => window.app.editeur.definirMeta('titre', 'avant-import'));
        await page.waitForTimeout(200);
        const nbAvantImport = (await versions()).length;
        const qVersion = await ouvrirLeFichier();
        exiger(qVersion !== null && qVersion.titre === 'Historique des versions',
            'ouvrir un fichier POSE la question de la version, comme demandé — après le garde-fou d\'export, pas à sa place');
        check(qVersion.choix.join('/') === 'annuler/ecraser/garder',
            `et elle offre les TROIS réponses (${qVersion.choix.join(', ')}) : écraser la précédente, garder les deux, ou renoncer — ce qu'un confirm() du navigateur ne saurait pas dire`);
        check(/récente/.test(qVersion.texte) && /\d/.test(qVersion.texte),
            'le texte situe la version qu\'on s\'apprête à écraser (sa date), pour qu\'on réponde en sachant ce qu\'on perd');

        // ANNULER renonce à TOUT l'import : le morceau en cours reste.
        await page.click('#fenetre-dialogue [data-choix="annuler"]');
        await page.waitForTimeout(600);
        check((await titreCourant()) === 'avant-import' && (await versions()).length === nbAvantImport,
            'annuler ici renonce à l\'import ENTIER — ni le morceau ni l\'historique ne bougent, on n\'est pas coincé à mi-chemin');

        // ÉCRASER : l'import a lieu, et la liste ne grossit pas (le plafond est déjà atteint ici, on
        // vérifie donc surtout que la plus récente a bien CHANGÉ d'état).
        const q2 = await ouvrirLeFichier();
        exiger(q2 !== null, 'préalable : la question revient au second essai');
        await page.click('#fenetre-dialogue [data-choix="ecraser"]');
        await page.waitForTimeout(700);
        const apresEcraser = await versions();
        check((await titreCourant()) === 'Morceau importé',
            'écraser : l\'import a bien eu lieu');
        check(apresEcraser.length === nbAvantImport && apresEcraser[0].titre === 'avant-import',
            `et la version la plus récente a été REMPLACÉE par l'état qu'on quittait (${apresEcraser.length} versions, « ${apresEcraser[0].titre} » en tête) — c'est ce qui empêche la liste d'enfler à chaque import`);

        // GARDER : une version de plus, jusqu'au plafond.
        await page.evaluate(() => window.app.editeur.definirMeta('titre', 'avant-import-2'));
        await page.waitForTimeout(200);
        const q3 = await ouvrirLeFichier();
        exiger(q3 !== null, 'préalable : la question revient au troisième essai');
        await page.click('#fenetre-dialogue [data-choix="garder"]');
        await page.waitForTimeout(700);
        const apresGarder = await versions();
        check(apresGarder[0].titre === 'avant-import-2' && apresGarder[1].titre === 'avant-import',
            `garder : la nouvelle s'ajoute DEVANT l'ancienne, qui reste (« ${apresGarder[0].titre} », puis « ${apresGarder[1].titre} »)`);

        // « NOUVEAU » NE POSE PAS CETTE QUESTION : ce n'est pas un import, et la friction doit rester
        // proportionnée à ce qui a été demandé.
        await page.evaluate(() => window.app.editeur.definirMeta('titre', 'avant-nouveau'));
        await page.waitForTimeout(200);
        await page.click('#btn-fichiers'); await page.waitForTimeout(200);
        await page.click('#popover-fichiers [data-action="nouveau"]'); await page.waitForTimeout(500);
        const dNouveau = await dialogue();
        if (dNouveau && dNouveau.choix.includes('sans')) {
            await page.click('#fenetre-dialogue [data-choix="sans"]');
            await page.waitForTimeout(600);
        }
        check((await dialogue()) === null,
            '« Nouvelle tablature » n\'enchaîne PAS sur la question de version : elle n\'a été demandée qu\'aux imports');
        check((await versions())[0].titre === 'avant-nouveau',
            'mais le morceau qu\'on abandonne est archivé quand même, sans rien demander');

        // --- 9. L'INTERRUPTEUR : éteindre EFFACE, et arrête d'écrire -----------------------------
        await page.click('#btn-reglages'); await page.waitForTimeout(450);
        const etatAvant = await page.evaluate(() => ({
            texte: document.getElementById('etat-versions').textContent,
            coche: document.getElementById('champ-versions').getAttribute('aria-checked'),
        }));
        check(etatAvant.coche === 'true' && /\d/.test(etatAvant.texte),
            `Réglages > Fichiers dit où l'on en est (« ${etatAvant.texte} ») et l'historique est allumé par défaut — c'est un filet, pas un bruit qu'on subit`);
        await page.click('#champ-versions'); await page.waitForTimeout(450);
        const avertissement = await dialogue();
        exiger(avertissement !== null && avertissement.choix.includes('eteindre'),
            'l\'éteindre DEMANDE : c\'est le seul réglage de ce panneau qui détruit des données');
        check(/effac/i.test(avertissement.texte),
            'et le dit franchement plutôt que de laisser croire à un simple masquage');
        await page.click('#fenetre-dialogue [data-choix="annuler"]'); await page.waitForTimeout(400);
        check((await versions()).length > 0
              && (await page.evaluate(() => document.getElementById('champ-versions').getAttribute('aria-checked'))) === 'true',
            'annuler laisse TOUT en place — l\'interrupteur revient où il était, il ne montre pas un état qui n\'a pas eu lieu');
        await page.click('#champ-versions'); await page.waitForTimeout(450);
        await page.click('#fenetre-dialogue [data-choix="eteindre"]'); await page.waitForTimeout(500);
        check((await versions()).length === 0,
            'confirmer VIDE réellement le stockage : pas de liste masquée qui continuerait d\'occuper le quota');
        check((await page.evaluate(() => localStorage.getItem('tabhub.versionsActives'))) === '0',
            'et l\'extinction est retenue explicitement');
        await page.click('#fenetre-reglages [data-fermer]'); await page.waitForTimeout(300);
        await ajouterNote(11);
        await enregistrer();
        check((await versions()).length === 0,
            'éteint, plus rien ne s\'écrit : enregistrer n\'archive plus');
        await page.click('#btn-fichiers'); await page.waitForTimeout(250);
        check(await page.evaluate(() => !!document.querySelector('#popover-fichiers [data-action="versions"]')?.hidden),
            'et l\'entrée disparaît du menu Fichiers, plutôt que d\'y rester en grisé : un menu n\'a pas à lister ce qu\'on a décidé de ne pas avoir');
        await page.keyboard.press('Escape'); await page.waitForTimeout(250);

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
