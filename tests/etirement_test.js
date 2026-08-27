// Banc de l'ÉTIREMENT DE DURÉE À LA SOURIS — glisser une note sur la partition pour changer combien
// de temps elle dure, sans passer par la palette ni par les raccourcis clavier.
//
// CE QU'IL PROTÈGE. Retour direct : « la longueur de la note à tenir, on ne comprend pas trop
// comment faire, je pense qu'il faut pouvoir étirer le logo au clavier... enfin, à la souris ». Le
// geste (main.js#demarrerGeste/demarrerEtirement/etendreEtirement/terminerEtirement) doit :
//   • se déclencher UNIQUEMENT sur un glisser franchement HORIZONTAL depuis une note SONNANTE — tout
//     le reste (glisser vertical/diagonal, glisser depuis le vide) reste le lasso de sélection ;
//   • n'appliquer la durée QU'AU RELÂCHEMENT (un seul memoriser(), donc un seul Ctrl+Z, quel que soit
//     le nombre de pixels parcourus) ;
//   • se brancher sur `appliquerDuree`, donc hériter GRATUITEMENT de la répartition en cascade : un
//     étirement qui ferait déborder sa mesure ne doit ni refuser, ni la laisser sous sa capacité (le
//     défaut réel trouvé en écrivant CE banc — voir `_diagnostiquerDebordement`, corrigé, et le cas L
//     de rythme_strict_test.js, qui l'éprouve directement au niveau du modèle).
//
// Émulation SOURIS (pas tactile) : c'est le geste desktop, distinct du pavé tactile (tactile_test.js).

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('étirement de durée');

(async () => {
    plan(18);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // Fixture par défaut : trois croches avec de la place libre (1,5 temps utilisés sur 4) — de
        // quoi étirer sans déborder, pour isoler le geste lui-même de la répartition en cascade.
        const preparer = () => page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [10, 11, 12].map(f => m.creerEvenement({ valeur: 8 }, [m.creerNote(0, f)]));
            ed.placerCurseur(0, 0, 0);
            ed.prevenir('document');
        });
        // Fixture qui DÉBORDE une fois la première croche étirée (voir cas L de rythme_strict_test.js
        // pour le même scénario au niveau du modèle) : quatre croches puis un silence de 2 temps, une
        // vraie note juste après celle qu'on étire — rien de contigu à absorber.
        const preparerDebordante = () => page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [
                ...[5, 7, 5, 3].map(f => m.creerEvenement({ valeur: 8 }, [m.creerNote(0, f)])),
                ...m.creerVoix(2).evenements,
            ];
            ed.placerCurseur(0, 0, 0);
            ed.prevenir('document');
        });
        const pointDeLaCase = (i) => page.evaluate((i) => {
            const svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect();
            const a = window.app.page.ancrages.evenements.find(e => e.mesure === 0 && e.evenement === i);
            return { x: b.left + ((a.xDebut + a.xFin) / 2 / window.app.page.largeur) * b.width,
                     y: b.top + ((a.yTab + 0) / window.app.page.hauteur) * b.height };
        }, i);
        const durees = () => page.evaluate(() => window.app.editeur.partition.mesures[0].voix[0].evenements.map(e => e.duree.valeur));
        const glisser = async (depuis, dx, dy = 0) => {
            await page.mouse.move(depuis.x, depuis.y);
            await page.mouse.down();
            await page.mouse.move(depuis.x + dx, depuis.y + dy, { steps: 6 });
            const resultat = { lassoVisible: await page.evaluate(() => !!document.querySelector('.lasso-selection')) };
            await page.mouse.up();
            await page.waitForTimeout(150);
            return resultat;
        };

        // --- 1. Glisser à DROITE sur une note : l'ALLONGE d'un cran --------------------------------
        await preparer();
        const p0 = await pointDeLaCase(0);
        await glisser(p0, 40);
        check((await durees())[0] === 4, '1. glisser à DROITE sur une croche l\'allonge en noire (un cran)');

        // --- 2. Glisser à GAUCHE : la RACCOURCIT (sens inverse) ------------------------------------
        await preparer();
        await glisser(await pointDeLaCase(0), -40);
        check((await durees())[0] === 16, '2. glisser à GAUCHE raccourcit en double-croche (sens inverse du n°1)');

        // --- 3. Deux crans d'un seul geste (pas cran par cran) -------------------------------------
        await preparer();
        await glisser(await pointDeLaCase(0), 80);
        check((await durees())[0] === 2, '3. 80px = deux crans d\'un coup : croche -> blanche, pas seulement noire');

        // --- 4. Un glisser énorme se BLOQUE sur la ronde, ne part pas en erreur --------------------
        await preparer();
        await glisser(await pointDeLaCase(0), 500);
        check((await durees())[0] === 1, '4. un glisser bien au-delà de l\'échelle se bloque sur la ronde (pas d\'erreur, pas d\'index hors limites)');

        // --- 5. Glisser depuis un SILENCE : rien à étirer, ne fait rien de spécial -----------------
        await preparerDebordante();
        const pSilence = await pointDeLaCase(4);
        const { lassoVisible: lassoDepuisSilence } = await glisser(pSilence, 40);
        check(lassoDepuisSilence === true, '5. un glisser horizontal depuis un SILENCE lasso comme avant (rien à étirer dans le vide)');
        check((await durees()).join(',') === '8,8,8,8,2', 'et ne change AUCUNE durée');

        // --- 6. Glisser VERTICAL sur une note : reste le lasso, pas un étirement -------------------
        await preparer();
        const { lassoVisible } = await glisser(await pointDeLaCase(0), 6, 60);
        check(lassoVisible === true, '6. glisser VERTICAL sur une note ouvre le lasso (la direction seule tranche)');
        check((await durees()).join(',') === '8,8,8', 'et ne change aucune durée');

        // --- 7. Clic simple (sans glisser franc) : ne touche à AUCUNE durée -----------------------
        await preparer();
        const p1 = await pointDeLaCase(1);
        await page.mouse.click(p1.x, p1.y);
        await page.waitForTimeout(150);
        check((await durees()).join(',') === '8,8,8', '7. un clic simple ne modifie aucune durée');
        check((await page.evaluate(() => window.app.editeur.curseur.evenement)) === 1, 'et place le curseur sur la case cliquée, comme avant ce geste');

        // --- 8. DÉBORDEMENT via le geste réel : ne refuse pas, ne sous-remplit pas la mesure -------
        // Même scénario que le cas L de rythme_strict_test.js (croche -> noire, +0,5, rien de contigu
        // à absorber) mais posé ici par un VRAI glisser souris, de bout en bout.
        await preparerDebordante();
        const mesuresAvant8 = await page.evaluate(() => window.app.editeur.partition.mesures.length);
        await glisser(await pointDeLaCase(0), 40);
        const etat8 = await page.evaluate(() => ({
            mesures: window.app.editeur.partition.mesures.length,
            contenu0: window.app.editeur.partition.mesures[0].voix[0].evenements.map(e => (e.silence || !e.notes.length) ? '_' : e.notes[0].frette),
            total0: window.app.editeur.partition.mesures[0].voix[0].evenements.reduce((t, e) => t + (4 / e.duree.valeur) * (e.duree.points ? 1.5 : 1), 0),
            total1: window.app.editeur.partition.mesures[1].voix[0].evenements.reduce((t, e) => t + (4 / e.duree.valeur) * (e.duree.points ? 1.5 : 1), 0),
        }));
        check(etat8.mesures === mesuresAvant8 + 1, '8. l\'étirement qui déborde crée UNE SEULE mesure neuve, ne refuse jamais');
        check(etat8.contenu0.join(',') === '5,7,5,3,_', 'les quatre notes ET le silence (raccourci) restent dans la mesure d\'origine');
        check(Math.abs(etat8.total0 - 4) < 1e-6, 'qui retombe pile sur sa capacité — jamais sous-remplie');
        check(Math.abs(etat8.total1 - 4) < 1e-6, 'et la mesure neuve aussi, complétée de silence');

        // --- 9. UN SEUL Ctrl+Z défait tout le geste précédent (étirement + répartition) ------------
        await page.evaluate(() => document.getElementById('zone-partition').focus());
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(150);
        const etat9 = await page.evaluate(() => ({
            mesures: window.app.editeur.partition.mesures.length,
            contenu0: window.app.editeur.partition.mesures[0].voix[0].evenements.map(e => (e.silence || !e.notes.length) ? '_' : (e.notes[0]?.frette ?? '_')),
            durees0: window.app.editeur.partition.mesures[0].voix[0].evenements.map(e => e.duree.valeur),
        }));
        check(etat9.mesures === mesuresAvant8, '9. un seul Ctrl+Z retire la mesure neuve : étirement + répartition ne comptent que pour une annulation');
        check(etat9.contenu0.join(',') === '5,7,5,3,_' && etat9.durees0.join(',') === '8,8,8,8,2',
            'et retrouve EXACTEMENT le contenu d\'avant le geste (croche d\'origine, silence de 2 temps entier)');

        // --- 10. Étirer une note NE JOUE aucun son (pas de lecture pendant l'édition) --------------
        await preparer();
        const enCoursAvant = await page.evaluate(() => window.app.lecteur.etat);
        await glisser(await pointDeLaCase(0), 40);
        const enCoursApres = await page.evaluate(() => window.app.lecteur.etat);
        check(enCoursAvant === enCoursApres, '10. étirer une note ne déclenche pas la lecture (état du lecteur inchangé)');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
