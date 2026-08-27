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
//   • se brancher sur `appliquerDuree`, donc hériter de son comportement du moment — REFUSE (pas de
//     mutation, un message affiché) si l'étirement ferait déborder la mesure : voir
//     Editeur._essaierNouvelleDuree et rythme_strict_test.js (cas A), au modèle plus simple, collé à
//     ce qui se fait sur les logiciels pros, auquel ce geste est revenu après un détour par la
//     répartition automatique.
//
// Émulation SOURIS (pas tactile) : c'est le geste desktop, distinct du pavé tactile (tactile_test.js).

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('étirement de durée');

(async () => {
    plan(17);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // Fixture par défaut : trois croches (1,5 temps) puis un silence de 2,5 temps — 4 temps
        // tout juste. Seule la DERNIÈRE croche (case 2) a du silence CONTIGU à absorber en grandissant
        // (une note grandit en mangeant ce qui suit IMMÉDIATEMENT, jamais plus loin derrière une autre
        // vraie note, voir Editeur._essaierNouvelleDuree) : jusqu'à 2,5 temps de plus (la blanche
        // pointée), pas au-delà (voir la fixture dédiée de 4.).
        const preparer = () => page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [
                ...[10, 11, 12].map(f => m.creerEvenement({ valeur: 8 }, [m.creerNote(0, f)])),
                ...m.creerVoix(2.5).evenements,
            ];
            ed.placerCurseur(0, 0, 0);
            ed.prevenir('document');
        });
        // Fixture PLEINE, sans la moindre place libre : quatre croches puis un silence de 2 temps —
        // 4 temps tout juste, mais la première croche n'a RIEN de contigu à absorber (la croche
        // suivante est une vraie note, pas un silence) : l'étirer doit donc être REFUSÉ.
        const preparerPleine = () => page.evaluate(async () => {
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
        // Sur la DERNIÈRE croche (case 2) : elle seule a du silence contigu à manger (voir ci-dessus).
        await preparer();
        const p0 = await pointDeLaCase(2);
        await glisser(p0, 40);
        check((await durees())[2] === 4, '1. glisser à DROITE sur une croche l\'allonge en noire (un cran)');

        // --- 2. Glisser à GAUCHE : la RACCOURCIT (sens inverse) ------------------------------------
        // Un RACCOURCISSEMENT, lui, ne dépend d'aucun silence contigu (il en libère) : la case 0 (qui
        // n'en a pas) marche tout aussi bien que la case 2.
        await preparer();
        await glisser(await pointDeLaCase(0), -40);
        check((await durees())[0] === 16, '2. glisser à GAUCHE raccourcit en double-croche (sens inverse du n°1) — jamais refusé, un raccourci libère toujours de la place');

        // --- 3. Deux crans d'un seul geste (pas cran par cran) -------------------------------------
        await preparer();
        await glisser(await pointDeLaCase(2), 80);
        check((await durees())[2] === 2, '3. 80px = deux crans d\'un coup : croche -> blanche (1,5 temps de plus, tient dans les 2,5 disponibles)');

        // --- 4. Un glisser énorme se BLOQUE sur la ronde, ne part pas en erreur --------------------
        // Fixture dédiée, avec CETTE FOIS assez de place (3,5 temps de silence après la croche) pour
        // que grandir jusqu'à la ronde (+3,5) réussisse réellement : ce cas éprouve le PLAFOND de
        // l'échelle des figures, pas la limite de place.
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [
                m.creerEvenement({ valeur: 8 }, [m.creerNote(0, 10)]),
                ...m.creerVoix(3.5).evenements,
            ];
            ed.placerCurseur(0, 0, 0);
            ed.prevenir('document');
        });
        await glisser(await pointDeLaCase(0), 500);
        check((await durees())[0] === 1, '4. un glisser bien au-delà de l\'échelle se bloque sur la ronde (pas d\'erreur, pas d\'index hors limites) — avec assez de place, ça réussit');

        // --- 5. Glisser depuis un SILENCE : rien à étirer, ne fait rien de spécial -----------------
        await preparerPleine();
        const pSilence = await pointDeLaCase(4);
        const { lassoVisible: lassoDepuisSilence } = await glisser(pSilence, 40);
        check(lassoDepuisSilence === true, '5. un glisser horizontal depuis un SILENCE lasso comme avant (rien à étirer dans le vide)');
        check((await durees()).join(',') === '8,8,8,8,2', 'et ne change AUCUNE durée');

        // --- 6. Glisser VERTICAL sur une note : reste le lasso, pas un étirement -------------------
        await preparer();
        const { lassoVisible } = await glisser(await pointDeLaCase(0), 6, 60);
        check(lassoVisible === true, '6. glisser VERTICAL sur une note ouvre le lasso (la direction seule tranche)');
        check((await durees())[0] === 8, 'et ne change aucune durée');

        // --- 7. Clic simple (sans glisser franc) : ne touche à AUCUNE durée -----------------------
        await preparer();
        const p1 = await pointDeLaCase(1);
        await page.mouse.click(p1.x, p1.y);
        await page.waitForTimeout(150);
        check((await durees())[1] === 8, '7. un clic simple ne modifie aucune durée');
        check((await page.evaluate(() => window.app.editeur.curseur.evenement)) === 1, 'et place le curseur sur la case cliquée, comme avant ce geste');

        // --- 8. DÉBORDEMENT via le geste réel : REFUSE, ne mute rien, prévient l'utilisateur -------
        // Même scénario que le cas A de rythme_strict_test.js (croche -> noire, +0,5, rien de contigu
        // à absorber) mais posé ici par un VRAI glisser souris, de bout en bout — et par un message
        // visible, pas seulement Editeur.derniereErreur en coulisse.
        await preparerPleine();
        const mesuresAvant8 = await page.evaluate(() => window.app.editeur.partition.mesures.length);
        await page.evaluate(() => { document.getElementById('message').textContent = ''; document.getElementById('message').classList.remove('visible'); });
        await glisser(await pointDeLaCase(0), 40);
        const etat8 = await page.evaluate(() => ({
            mesures: window.app.editeur.partition.mesures.length,
            durees: window.app.editeur.partition.mesures[0].voix[0].evenements.map(e => e.duree.valeur),
            messageVisible: document.getElementById('message').classList.contains('visible'),
            messageTexte: document.getElementById('message').textContent,
        }));
        check(etat8.mesures === mesuresAvant8, '8. l\'étirement qui déborderait NE CRÉE AUCUNE mesure neuve — refusé, pas réparti');
        check(etat8.durees.join(',') === '8,8,8,8,2', 'et AUCUNE durée ne change (refus complet, pas une mutation partielle)');
        check(etat8.messageVisible && etat8.messageTexte.length > 0, 'un message visible explique le refus (pas seulement une erreur muette en coulisse)');

        // --- 9. UN SEUL Ctrl+Z défait tout un étirement RÉUSSI -------------------------------------
        await preparer();
        const avant9 = await durees();
        await glisser(await pointDeLaCase(2), 40);   // croche -> noire, réussit (voir 1.)
        exiger((await durees())[2] === 4, '9. l\'étirement réussit d\'abord (préalable à l\'annulation)');
        await page.evaluate(() => document.getElementById('zone-partition').focus());
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(150);
        check((await durees()).join(',') === avant9.join(','), 'un seul Ctrl+Z restitue EXACTEMENT les durées d\'avant le geste');

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
