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
        // HUIT CROCHES, PAS UN SEUL SILENCE — la seule mesure où un allongement crée encore une dette.
        // `preparerPleine` ci-dessus n'en crée plus : son silence de fin de mesure est désormais pris
        // par l'allongement même s'il n'est pas contigu (voir Editeur._essaierNouvelleDuree), ce qui
        // est précisément le correctif. Il faut donc une mesure où il n'y a VRAIMENT rien à prendre.
        const preparerSansSilence = () => page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements =
                [5, 7, 5, 3, 5, 7, 5, 3].map(f => m.creerEvenement({ valeur: 8 }, [m.creerNote(0, f)]));
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

        // --- 8. DÉBORDEMENT via le geste réel : PASSE, décale, et le dit -------------------------
        // Le même scénario que le cas A de rythme_strict_test.js (croche -> noire, +0,5, plus un seul
        // silence à prendre dans toute la mesure) mais posé ici par un VRAI glisser souris, de bout
        // en bout — et vérifié jusqu'au message visible, pas seulement sur l'état du modèle.
        //
        // CE BLOC VÉRIFIAIT LE REFUS, il vérifie maintenant son contraire. Ce qu'il protège n'a pas
        // changé pour autant, et c'est le point : que le geste ne restructure JAMAIS le morceau tout
        // seul. Avant, la garantie tenait parce que rien ne se passait ; elle tient maintenant parce
        // que le décalage reste enfermé dans la mesure. La seconde est plus forte que la première.
        await preparerSansSilence();
        const mesuresAvant8 = await page.evaluate(() => window.app.editeur.partition.mesures.length);
        await page.evaluate(() => { document.getElementById('message').textContent = ''; document.getElementById('message').classList.remove('visible'); });
        await glisser(await pointDeLaCase(0), 40);
        const etat8 = await page.evaluate(async () => {
            const S = await import('/src/model/score.js');
            const ed = window.app.editeur;
            return {
                mesures: ed.partition.mesures.length,
                durees: ed.partition.mesures[0].voix[0].evenements.map(e => e.duree.valeur),
                notes: ed.partition.mesures[0].voix[0].evenements.filter(e => !e.silence && e.notes.length).length,
                ecart: ed.ecartMesure(0, 0),
                etat: S.etatMesure(ed.partition, 0),
                messageVisible: document.getElementById('message').classList.contains('visible'),
                messageTexte: document.getElementById('message').textContent,
                etiquette: (window.app.page.primitives.find(p => p.t === 'texte' && /♩/.test(p.s)) || {}).s,
            };
        });
        check(etat8.mesures === mesuresAvant8,
            `8. l'étirement qui déborde NE CRÉE AUCUNE mesure neuve (${etat8.mesures}) — le décalage `
            + 'reste dans la mesure, rien ne restructure le morceau sans qu\'on le demande');
        check(etat8.durees[0] === 4 && etat8.notes === 8,
            `la croche est bien devenue une noire (${etat8.durees.join(',')}) et les huit notes sont `
            + 'intactes : le geste réussit, et il ne détruit rien');
        check(Math.abs(etat8.ecart - 0.5) < 1e-6 && etat8.etat === 'debordante',
            `la mesure porte une dette d'un demi-temps (${etat8.ecart}) et se déclare débordante`);
        check(etat8.etiquette === '+½ ♩',
            `elle le GRAVE sur elle-même (« ${etat8.etiquette} ») : on n'a pas à poser le curseur `
            + 'dedans pour savoir de combien elle déborde');
        check(etat8.messageVisible && /Alt\+A/.test(etat8.messageTexte) && /Alt\+R/.test(etat8.messageTexte),
            `un message visible nomme les DEUX règlements (« ${etat8.messageTexte} ») — et cette fois `
            + 'leurs deux boutons sont vraiment à l\'écran, puisqu\'ils n\'apparaissent que sur une '
            + 'mesure qui déborde');

        // --- 8b. LE SILENCE NON CONTIGU EST PRIS : plus de dette du tout --------------------------
        // La même fixture qu'au cas 5 — quatre croches puis une blanche de SILENCE — et le même
        // geste qu'au cas 8. Trois notes séparent la case étirée du silence ; elles glissent, le
        // silence rétrécit, et la mesure reste juste. C'est le cas qui était refusé le plus souvent.
        await preparerPleine();
        await glisser(await pointDeLaCase(0), 40);
        const etat8b = await page.evaluate(async () => {
            const S = await import('/src/model/score.js');
            const ed = window.app.editeur;
            return { durees: ed.partition.mesures[0].voix[0].evenements.map(e => e.duree.valeur),
                     ecart: ed.ecartMesure(0, 0), etat: S.etatMesure(ed.partition, 0) };
        });
        check(Math.abs(etat8b.ecart) < 1e-6 && etat8b.etat === 'complete',
            `8b. avec un silence QUELQUE PART dans la mesure, le même étirement ne crée aucune dette `
            + `(${etat8b.durees.join(',')}) : le silence de fin est pris bien que trois notes l'en séparent`);

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
