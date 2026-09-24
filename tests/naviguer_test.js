// Banc de LA NAVIGATION — aller à une mesure, et en ajouter plusieurs d'un coup.
//
// LES DEUX DÉFAUTS QU'IL FIGE.
//
//   1. `allerAMesure` existait dans le modèle depuis toujours, et n'était joignable par AUCUN geste.
//      Le clavier a « mesure précédente / suivante » et « début / fin du morceau », rien entre les
//      deux : sur un morceau de cent mesures, atteindre la 47e se faisait en faisant défiler à la
//      souris, ou en pressant Ctrl+→ quarante-six fois.
//
//   2. Alt+M ajoutait UNE mesure. Préparer un morceau de soixante-quatre en demandait soixante.
//
// LE NUMÉRO DE PAGE EST LA PORTE : on clique sur « Mesure 12 / 64 », le seul endroit qui dise
// toujours où l'on est, donc le premier où l'on cherche à aller ailleurs. Ctrl+G fait la même chose
// au clavier.
//
// CE QUE LA SAISIE COUVRE DÉJÀ, et qu'on ne refait pas ici : le morceau grandit tout seul quand on
// écrit au-delà de la dernière mesure (voir avance_auto_test.js). « Ajouter N mesures » sert à celui
// qui SAIT que son morceau en fait 64 et veut les voir tout de suite, pour s'y repérer et y sauter.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('naviguer');

(async () => {
    plan(16);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // ── Partie MODÈLE ───────────────────────────────────────────────────────────────────────
        const modele = await page.evaluate(async () => {
            const { Editeur } = await import('/src/edit/commands.js');
            const out = {};

            // (a) N mesures d'un coup, et UN SEUL point d'annulation.
            const ed = new Editeur(); ed.nouveau('guitare');
            const avant = ed.partition.mesures.length;
            const etapesAvant = ed.passe.length;
            ed.placerCurseur(avant - 1, 0, 0, 0);
            const posees = ed.ajouterMesure(true, 60);
            out.enUnCoup = { avant, apres: ed.partition.mesures.length, posees,
                             etapes: ed.passe.length - etapesAvant };
            ed.annuler();
            out.apresAnnulation = ed.partition.mesures.length;

            // (b) Elles se posent APRÈS la mesure courante, et le curseur va sur la première neuve.
            const ed2 = new Editeur(); ed2.nouveau('guitare');
            ed2.dureeCourante = { valeur: 4, points: 0, nolet: null };
            ed2.placerCurseur(1, 0, 0, 0);
            for (let i = 0; i < 4; i++) ed2.saisirChiffre(i + 1);
            ed2.placerCurseur(1, 0, 0, 0);
            ed2.ajouterMesure(true, 3);
            out.apres = {
                curseur: ed2.curseur.mesure,
                // La mesure ÉCRITE est restée à sa place, les neuves se sont glissées derrière elle.
                ecriteEncoreEn1: ed2.partition.mesures[1].voix[0].evenements
                    .filter(e => !e.silence && e.notes.length).length,
                videsSuivantes: [2, 3, 4].map(i => ed2.partition.mesures[i].voix[0].evenements
                    .every(e => e.silence || !e.notes.length)),
            };

            // (c) Un compte absurde est borné plutôt que refusé, et « 0 » vaut « une ».
            const ed3 = new Editeur(); ed3.nouveau('guitare');
            const n3 = ed3.partition.mesures.length;
            out.zero = ed3.ajouterMesure(true, 0);
            out.apresZero = ed3.partition.mesures.length - n3;

            // (d) allerAMesure BORNE : 200 sur un morceau de 24 veut dire « la fin ».
            const ed4 = new Editeur(); ed4.nouveau('guitare');
            ed4.ajouterMesure(true, 20);
            const total = ed4.partition.mesures.length;
            ed4.allerAMesure(199);
            out.borneHaute = { total, mesure: ed4.curseur.mesure };
            ed4.allerAMesure(-5);
            out.borneBasse = ed4.curseur.mesure;
            return out;
        });

        check(modele.enUnCoup.posees === 60 && modele.enUnCoup.apres === modele.enUnCoup.avant + 60,
            `soixante mesures en un geste (${modele.enUnCoup.avant} → ${modele.enUnCoup.apres}) — il en fallait `
            + 'soixante appuis sur Alt+M');
        check(modele.enUnCoup.etapes === 1,
            `et UN SEUL point d'annulation (${modele.enUnCoup.etapes}) : soixante Ctrl+Z pour défaire un `
            + 'geste fait en une fois seraient absurdes');
        check(modele.apresAnnulation === modele.enUnCoup.avant,
            `un Ctrl+Z les retire toutes (${modele.apresAnnulation} mesures)`);

        exiger(modele.apres.curseur === 2, `le curseur se pose sur la première mesure neuve (m${modele.apres.curseur})`);
        check(modele.apres.ecriteEncoreEn1 === 4,
            `la mesure écrite reste à sa place, intacte (${modele.apres.ecriteEncoreEn1} notes) — les neuves se `
            + 'glissent derrière elle');
        check(modele.apres.videsSuivantes.every(Boolean),
            'et les trois neuves sont bien vides');

        check(modele.zero === 1 && modele.apresZero === 1,
            `« 0 » vaut « une » (${modele.apresZero} ajoutée) plutôt que de ne rien faire en silence`);

        check(modele.borneHaute.mesure === modele.borneHaute.total - 1,
            `aller à la mesure 200 sur un morceau de ${modele.borneHaute.total} mène à la dernière `
            + `(m${modele.borneHaute.mesure}) : hors bornes veut dire « la fin », pas « refusé »`);

        // …ET PAR LA PORTE QU'ON EMPRUNTE VRAIMENT, pas seulement par la méthode du modèle. La
        // boîte « Aller à une mesure » traduit un NUMÉRO GRAVÉ en rang dans le tableau (les deux
        // diffèrent dès qu'il y a une levée, voir levee_test.js), et cette traduction-là pouvait
        // parfaitement borner autrement que `allerAMesure` sans que ce banc s'en aperçoive : il
        // n'était jamais passé par elle.
        const total12 = await page.evaluate(() => {
            window.app.editeur.nouveau('guitare');
            window.app.editeur.ajouterMesure(true, 8);                // douze mesures
            return window.app.editeur.partition.mesures.length;
        });
        // Le champ arrive PRÉ-REMPLI : on le vide avant de taper, sans quoi `type()` écrit à la suite.
        const allerParLaBoite = async (valeur) => {
            await page.evaluate(() => { window.app.allerAUneMesure(); });
            await page.waitForTimeout(250);
            await page.evaluate(() => { document.querySelector('.dialogue-champ').value = ''; });
            await page.keyboard.type(String(valeur));
            await page.keyboard.press('Enter');
            await page.waitForTimeout(250);
            return page.evaluate(() => window.app.editeur.curseur.mesure);
        };
        const parLaBoite = { total: total12, loin: await allerParLaBoite(200), sept: await allerParLaBoite(7) };
        check(parLaBoite.loin === parLaBoite.total - 1,
            `la BOÎTE elle-même borne pareil : 200 sur ${parLaBoite.total} mesures mène à la dernière `
            + `(rang ${parLaBoite.loin}) — la même règle des deux côtés de la porte`);
        check(parLaBoite.sept === 6,
            `et « 7 » ouvre bien la mesure gravée 7 (rang ${parLaBoite.sept})`);
        check(modele.borneBasse === 0, `et un numéro négatif mène à la première (m${modele.borneBasse})`);

        // ── Partie INTERFACE ────────────────────────────────────────────────────────────────────
        const preparer = () => page.evaluate(() => {
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.placerCurseur(ed.partition.mesures.length - 1, 0, 0, 0);
            ed.ajouterMesure(true, 20);
            ed.placerCurseur(0, 0, 0, 0);
            window.app.el.zone.focus();
        });
        const lirePosition = () => page.evaluate(() => document.getElementById('info-position').textContent);
        const champDialogue = () => page.$('.voile:not([hidden]) input');

        await preparer();
        await page.waitForTimeout(200);
        exiger(/Mesure 1 \/ 24/.test(await lirePosition()),
            `préalable : le morceau fait 24 mesures et on est sur la 1re (« ${await lirePosition()} »)`);

        // Le repère de position est un BOUTON : il se clique, et il s'annonce comme une commande.
        const estBouton = await page.evaluate(() => {
            const el = document.getElementById('info-position');
            return { balise: el.tagName, titre: el.getAttribute('title') || '' };
        });
        check(estBouton.balise === 'BUTTON', `le repère de position est un <button> (${estBouton.balise}) — il se tabule et s'annonce`);
        check(/Ctrl\+G/.test(estBouton.titre), `et son infobulle nomme le raccourci (« ${estBouton.titre} »)`);

        await page.click('#info-position');
        await page.waitForTimeout(300);
        const champ = await champDialogue();
        exiger(!!champ, 'cliquer dessus ouvre la demande « Aller à une mesure »');
        await champ.fill('14');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        check(/Mesure 14 \/ 24/.test(await lirePosition()),
            `on arrive à la mesure 14 (« ${await lirePosition()} »)`);

        // Ctrl+G fait la même chose, sans la souris.
        await page.keyboard.press('Control+g');
        await page.waitForTimeout(300);
        const champ2 = await champDialogue();
        exiger(!!champ2, 'Ctrl+G ouvre la même demande');
        await champ2.fill('3');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        check(/Mesure 3 \/ 24/.test(await lirePosition()),
            `et y mène aussi (« ${await lirePosition()} »)`);

        // ANNULER la demande ne bouge rien.
        await page.keyboard.press('Control+g');
        await page.waitForTimeout(300);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        check(/Mesure 3 \/ 24/.test(await lirePosition()),
            `renoncer à la demande laisse le curseur où il était (« ${await lirePosition()} »)`);

        // ── NEUTRALISATION : la commande existe, mais plus aucun geste n'y mène ─────────────────
        const injoignable = await page.evaluate(() => {
            const el = document.getElementById('info-position');
            const clone = el.cloneNode(true);          // le clone n'a AUCUN écouteur
            el.replaceWith(clone);
            return { aEncoreLaMethode: typeof window.app.editeur.allerAMesure === 'function' };
        });
        await page.click('#info-position');
        await page.waitForTimeout(300);
        check(injoignable.aEncoreLaMethode && !(await champDialogue()),
            'NEUTRALISÉ (écouteur retiré) : `allerAMesure` est toujours là dans le modèle, et plus rien '
            + 'ne l\'atteint — c\'est exactement l\'état d\'avant ce lot');

        check(erreurs.length === 0, 'aucune erreur de console ni exception (' + erreurs.join(' | ') + ')');
    } catch (e) {
        check(false, 'exception pendant le banc : ' + e.message + '\n' + e.stack);
    } finally {
        await fermer();
    }
    process.exit(bilan());
})();
