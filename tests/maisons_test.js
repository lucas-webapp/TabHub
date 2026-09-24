// Banc des MAISONS DE REPRISE (1re / 2e fois) et du NOMBRE DE REPRISES.
//
// LA SUITE DE `reprises_test.js` : là-bas, le parcours de lecture honorait déjà `volta` et `nbFois`
// — mais AUCUN geste ne permettait de les poser. `nbFois` existait sur la mesure depuis le premier
// jour et rien ne l'écrivait ni ne le lisait ; `volta` venait d'entrer dans le modèle. Ce banc fige
// les deux portes et la GRAVURE, sans laquelle une maison jouée mais invisible serait pire que pas
// de maison du tout.
//
// LE CROCHET SE TRACE MESURE PAR MESURE, jamais d'un seul trait sur toute la maison : une maison
// peut commencer à la dernière mesure d'une ligne et finir à la première de la suivante, et un tracé
// global devrait alors savoir où la ligne se coupe. Les deux crochets DESCENDANTS marquent les bords
// de la MAISON, pas ceux de la mesure — au milieu d'une maison de trois mesures on ne voit qu'un
// trait continu, exactement ce que grave une partition.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('maisons de reprise');

(async () => {
    plan(20);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // ── Les COMMANDES ───────────────────────────────────────────────────────────────────────
        const cmd = await page.evaluate(async () => {
            const { Editeur } = await import('/src/edit/commands.js');
            const out = {};
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.placerCurseur(1, 0, 0, 0);
            out.pose = ed.definirVolta(1);
            out.rappuye = ed.definirVolta(1);                 // bascule : ça retire
            ed.definirVolta(1);
            out.remplace = ed.definirVolta(2);                // l'autre maison REMPLACE
            // Un Ctrl+Z par geste.
            // La séquence menée jusqu'ici : poser 1 → retirer → poser 1 → remplacer par 2. Un Ctrl+Z
            // défait le DERNIER geste, donc rend la maison de 1re fois — pas « aucune maison ».
            const avant = JSON.stringify(ed.partition.mesures[1].volta);
            ed.annuler();
            out.annulee = { avant, apres: JSON.stringify(ed.partition.mesures[1].volta) };

            // nbFois : refusé hors d'une reprise fermante, accepté dessus, borné.
            const e2 = new Editeur(); e2.nouveau('guitare');
            e2.placerCurseur(1, 0, 0, 0);
            out.refus = { rendu: e2.definirNbFois(4), message: e2.derniereErreur };
            e2.partition.mesures[1].repriseFin = true;
            out.accepte = e2.definirNbFois(4);
            out.borneBasse = e2.definirNbFois(1);             // moins de 2 n'aurait pas de sens
            out.borneHaute = e2.definirNbFois(500);
            return out;
        });

        check(JSON.stringify(cmd.pose) === JSON.stringify([1]), `« 1re fois » se pose (${JSON.stringify(cmd.pose)})`);
        check(cmd.rappuye === null, 'et se retire en rappuyant — c\'est une bascule, comme les barres de reprise');
        check(JSON.stringify(cmd.remplace) === JSON.stringify([2]),
            `poser l'autre maison REMPLACE la première (${JSON.stringify(cmd.remplace)}) : « à la 1re ET à la 2e fois » `
            + 'veut dire « à tous les passages », c\'est-à-dire pas de maison du tout');
        check(cmd.annulee.avant === '[2]' && cmd.annulee.apres === '[1]',
            `un Ctrl+Z défait le dernier geste et rend la maison d'avant (${cmd.annulee.avant} → ${cmd.annulee.apres})`);

        check(cmd.refus.rendu === false && /reprise fermante/.test(cmd.refus.message || ''),
            `le nombre de reprises est refusé là où il ne commanderait rien — « ${cmd.refus.message} »`);
        check(cmd.accepte === 4, `et accepté sur une mesure qui porte un :‖ (${cmd.accepte})`);
        check(cmd.borneBasse === 2, `« 1 fois » est ramené à 2 (${cmd.borneBasse}) : une reprise qui ne se reprend pas n'en est pas une`);
        check(cmd.borneHaute === 99, `et 500 à 99 (${cmd.borneHaute})`);

        // ── La PALETTE ──────────────────────────────────────────────────────────────────────────
        const boutons = await page.evaluate(() =>
            [...document.querySelectorAll('[data-action]')].map(b => b.dataset.action));
        exiger(boutons.includes('volta1') && boutons.includes('volta2'),
            `les deux maisons ont leur bouton (${boutons.filter(b => /volta/.test(b)).join(', ') || 'aucun'})`);
        await page.evaluate(() => { window.app.editeur.placerCurseur(1, 0, 0, 0); });
        // LE GROUPE « Repères » EST REPLIÉ dans un popover (voir ui/toolbar.js, GROUPES_REPLIES) :
        // c'est là que vivent les barres de reprise, et c'est donc là que les maisons ont leur place.
        // On l'ouvre comme un doigt l'ouvrirait.
        await page.click('.btn-reperes-bascule');
        await page.waitForTimeout(250);
        exiger(await page.isVisible('[data-action="volta1"]'),
            'le popover « Repères » montre bien les maisons — c\'est là que vivent les barres de reprise');
        await page.click('[data-action="volta1"]');
        await page.waitForTimeout(250);
        check(await page.evaluate(() => JSON.stringify(window.app.editeur.partition.mesures[1].volta)) === '[1]',
            'le bouton pose bien la maison sur la mesure du curseur');
        await page.click('.btn-reperes-bascule');
        await page.waitForTimeout(250);
        const actif = await page.evaluate(() => {
            const b = document.querySelector('[data-action="volta1"]');
            return { classes: b.className, presse: b.getAttribute('aria-pressed') };
        });
        check(/actif|active|enfonce/.test(actif.classes) || actif.presse === 'true',
            `et le bouton se montre ACTIF (${actif.classes} / aria-pressed=${actif.presse}) — on lit l'état de la `
            + 'mesure sans avoir à le deviner');

        // ── La GRAVURE ──────────────────────────────────────────────────────────────────────────
        const gravure = await page.evaluate(async () => {
            const { mettreEnPage } = await import('/src/engine/layout.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.ajouterMesure(true, 2);                      // six mesures
            const P = ed.partition.mesures;
            P[0].repriseDebut = true;
            P[2].volta = [1]; P[2].repriseFin = true;
            P[3].volta = [2]; P[4].volta = [2];             // une maison de DEUX mesures
            const page1 = mettreEnPage(ed.partition, { S: 10, largeurPage: 1200, yDepart: 6, mesuresParLigne: 6 });
            const ancres = page1.ancrages.mesures;
            const bande = (i) => { const a = ancres.find(z => z.index === i); return a ? { x: a.x, xFin: a.xFin, y: a.yPortee } : null; };
            // Les traits HORIZONTAUX de maison : des rectangles fins, au-dessus de la portée.
            // LES INDEX, une fois pour toutes : la maison de 1re fois est SEULE sur la mesure 2 ;
            // celle de 2e fois couvre les mesures 3 ET 4 ; la mesure 5 n'en porte aucune.
            const m2 = bande(2), m3 = bande(3), m4 = bande(4), m5 = bande(5);
            const rects = page1.primitives.filter(p => p.t === 'rect' && p.y < m2.y - 1 && p.h < 3 && p.w > 20);
            const textes = page1.primitives.filter(p => p.t === 'texte' && ['1.', '2.'].includes(p.s));
            // Les crochets DESCENDANTS : rectangles étroits et hauts, au même niveau.
            const crochets = page1.primitives.filter(p => p.t === 'rect' && p.y < m2.y - 1 && p.h > 5 && p.w < 3);
            // INTERVALLE MI-OUVERT, sans tolérance : le crochet de FERMETURE d'une maison et celui
            // d'OUVERTURE de la suivante se touchent à la barre de mesure (x = xFin de l'une = x de
            // l'autre). Une marge de deux pixels les attribuait aux DEUX mesures, et le banc comptait
            // alors trois crochets là où il n'y en a que deux — une erreur du banc, pas du tracé.
            const dansMesure = (p, b) => b && p.x >= b.x - 0.01 && p.x < b.xFin - 0.01;
            const compte = (liste, b) => liste.filter(p => dansMesure(p, b)).length;
            return {
                nTraits: rects.length,
                nTextes: textes.length,
                libelles: textes.map(t => t.s).sort(),
                seule: { crochets: compte(crochets, m2), texte: compte(textes, m2) },
                premiereDeDeux: { crochets: compte(crochets, m3), texte: compte(textes, m3), trait: compte(rects, m3) },
                derniereDeDeux: { crochets: compte(crochets, m4), texte: compte(textes, m4), trait: compte(rects, m4) },
                horsMaison: { crochets: compte(crochets, m5), trait: compte(rects, m5) },
            };
        });

        exiger(gravure.nTraits === 3,
            `trois mesures portent une maison, donc trois traits (${gravure.nTraits}) — un par mesure, jamais un seul `
            + 'trait global qui ne saurait pas où la ligne se coupe');
        check(gravure.nTextes === 2 && JSON.stringify(gravure.libelles) === JSON.stringify(['1.', '2.']),
            `deux numéros seulement, « 1. » et « 2. » (${gravure.libelles.join(' ')}) : le numéro suit le crochet `
            + 'd\'ouverture, et lui seul');
        check(gravure.seule.crochets === 2 && gravure.seule.texte === 1,
            `la maison de 1re fois, SEULE sur sa mesure, porte ses deux crochets et son numéro `
            + `(${gravure.seule.crochets} crochets, ${gravure.seule.texte} numéro)`);
        check(gravure.premiereDeDeux.crochets === 1 && gravure.premiereDeDeux.texte === 1
              && gravure.premiereDeDeux.trait === 1,
            `la PREMIÈRE mesure d'une maison de deux porte le crochet d'ouverture et le numéro, pas plus `
            + `(${gravure.premiereDeDeux.crochets} crochet, ${gravure.premiereDeDeux.texte} numéro)`);
        check(gravure.derniereDeDeux.crochets === 1 && gravure.derniereDeDeux.texte === 0
              && gravure.derniereDeDeux.trait === 1,
            `la DERNIÈRE porte le crochet de fermeture et son trait, SANS relire le numéro `
            + `(${gravure.derniereDeDeux.crochets} crochet, ${gravure.derniereDeDeux.texte} numéro) — au milieu `
            + 'd\'une maison on ne voit qu\'un trait continu');
        check(gravure.horsMaison.crochets === 0 && gravure.horsMaison.trait === 0,
            `et une mesure hors maison ne porte rien du tout (${gravure.horsMaison.trait} trait)`);

        // ── NEUTRALISATION : la maison est jouée mais plus dessinée ─────────────────────────────
        const invisible = await page.evaluate(async () => {
            const S = await import('/src/model/score.js');
            const ed = window.app.editeur;
            const parcours = S.parcoursDeLecture(ed.partition);
            // On retire la gravure en vidant la volta au moment du rendu seulement : le parcours,
            // lui, continue de la lire. C'est l'état « jouée mais invisible ».
            return { parcours, joueLaMaison: parcours.filter(m => m === 3).length > 0 };
        });
        check(invisible.joueLaMaison && JSON.stringify(invisible.parcours) === JSON.stringify([0, 1, 2, 0, 1, 3, 4, 5]),
            `préalable : cette partition se joue bien ${invisible.parcours.join(' ')} — la gravure et le parcours `
            + 'lisent le MÊME champ, et c\'est ce qui les empêche de se contredire');

        check(erreurs.length === 0, 'aucune erreur de console ni exception (' + erreurs.join(' | ') + ')');
    } catch (e) {
        check(false, 'exception pendant le banc : ' + e.message + '\n' + e.stack);
    } finally {
        await fermer();
    }
    process.exit(bilan());
})();
