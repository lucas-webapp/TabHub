// Banc de L'ACCORD À LA FRAPPE — Maj+↑ / Maj+↓, « la même case, une corde plus haut ».
//
// LE DÉFAUT QU'IL FIGE, et c'est une RÉGRESSION de l'avance automatique. Taper les trois cases d'un
// accord les écrivait sur TROIS TEMPS SUCCESSIFS : on tape 2, le curseur avance, on tape 2, il
// avance encore. Pour obtenir un accord il fallait un « ← » entre chaque — mesuré : 7 frappes au
// lieu de 5 pour trois notes, 16 au lieu de 11 à six cordes — et surtout RIEN ne prévenait. On
// croyait écrire un accord, on écrivait une gamme.
//
// POURQUOI PAS ↑ TOUT SEUL. Après avoir écrit une note, « ↑ puis un chiffre » veut dire L'ACCORD
// pour un guitariste et LA NOTE SUIVANTE, sur une autre corde, pour un bassiste. Même état,
// intentions opposées : aucune règle locale ne peut trancher. Ce banc vérifie donc les DEUX — que
// Maj+↑ empile, et que ↑ seul garde son sens de toujours.
//
// POURQUOI PAS MAJ+CHIFFRE. Sur un clavier AZERTY, Maj+2 est LA FAÇON de taper un 2 (voir
// edit/keyboard.js, qui lit `e.key` sans exclure Maj — c'est ce qui rend la saisie utilisable en
// AZERTY). Le modificateur était déjà pris.
//
// Modèle PUIS navigateur : le geste se mesure en frappes, mais la touche doit vraiment arriver.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('accord à la frappe');

(async () => {
    plan(17);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        const modele = await page.evaluate(async () => {
            const { Editeur } = await import('/src/edit/commands.js');
            const neuf = () => {
                const ed = new Editeur(); ed.nouveau('guitare');
                ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
                return ed;
            };
            const forme = ed => ed.partition.mesures[0].voix[0].evenements
                .map(e => (e.silence || !e.notes.length) ? '_' : '[' + e.notes.map(n => n.corde + ':' + n.frette).join(' ') + ']')
                .join(' ');
            const out = {};

            // (a) Trois notes sur le MÊME temps, et le compte de frappes.
            const ed = neuf();
            ed.placerCurseur(0, 0, 4, 0);
            let k = 0;
            ed.saisirChiffre(2); k++;
            ed.resterSurLeTemps(-1); k++; ed.saisirChiffre(2); k++;
            ed.resterSurLeTemps(-1); k++; ed.saisirChiffre(1); k++;
            out.trois = { forme: forme(ed), frappes: k };

            // (b) Le même accord à l'ANCIENNE façon, pour que le gain soit un écart mesuré.
            const ed2 = neuf();
            ed2.placerCurseur(0, 0, 4, 0);
            let k2 = 0;
            ed2.saisirChiffre(2); k2++;
            ed2.deplacerEvenement(-1); k2++; ed2.deplacerCorde(-1); k2++; ed2.saisirChiffre(2); k2++;
            ed2.deplacerEvenement(-1); k2++; ed2.deplacerCorde(-1); k2++; ed2.saisirChiffre(1); k2++;
            out.ancienne = { forme: forme(ed2), frappes: k2 };

            // (c) Six cordes.
            const ed3 = neuf();
            ed3.placerCurseur(0, 0, 5, 0);
            let k3 = 0;
            ed3.saisirChiffre(3); k3++;
            for (let i = 0; i < 5; i++) { ed3.resterSurLeTemps(-1); k3++; ed3.saisirChiffre(i); k3++; }
            out.six = { forme: forme(ed3), frappes: k3,
                        notes: ed3.partition.mesures[0].voix[0].evenements[0].notes.length };

            // (d) ↑ SEUL garde son sens : la note suivante, sur une autre corde.
            const ed4 = neuf();
            ed4.placerCurseur(0, 0, 4, 0);
            ed4.saisirChiffre(2); ed4.deplacerCorde(-1); ed4.saisirChiffre(5);
            out.flecheSeule = forme(ed4);

            // (e) L'ANCRE FRANCHIT LA BARRE : après une ronde, le curseur est dans la mesure
            //     suivante ; Maj+↑ doit revenir sur la case écrite, pas reculer d'un cran au hasard.
            const ed5 = neuf();
            ed5.dureeCourante = { valeur: 1, points: 0, nolet: null };
            ed5.placerCurseur(0, 0, 4, 0);
            ed5.saisirChiffre(7);
            out.apresRonde = { ...ed5.curseur };
            ed5.resterSurLeTemps(-1);
            out.ancreRetrouvee = { mesure: ed5.curseur.mesure, evenement: ed5.curseur.evenement, corde: ed5.curseur.corde };
            ed5.saisirChiffre(7);
            out.parBarre = forme(ed5);

            // (f) SANS ANCRE (rien d'écrit depuis un clic), il se comporte comme ↑. On écrit d'abord
            //     quatre noires pour qu'un troisième évènement EXISTE — une mesure neuve n'en a qu'un
            //     (un silence de mesure entière), et `corrigerCurseur` ramènerait tout à l'index 0.
            const ed6 = neuf();
            for (let i = 0; i < 4; i++) ed6.saisirChiffre(i + 1);
            ed6.placerCurseur(0, 2, 4, 0);     // un clic : il efface l'ancre (voir placerCurseur)
            out.avantSansAncre = { ...ed6.curseur };
            ed6.resterSurLeTemps(-1);
            out.sansAncre = { ...ed6.curseur };

            // (g) DEUX CHIFFRES ne se combinent pas par-dessus l'accord : « 1 » sur une corde puis
            //     « 2 » sur une AUTRE font deux notes, jamais la case 12.
            const ed7 = neuf();
            ed7.placerCurseur(0, 0, 4, 0);
            ed7.saisirChiffre(1);
            ed7.resterSurLeTemps(-1);
            ed7.saisirChiffre(2);
            out.deuxChiffres = forme(ed7);

            // (h) Et la case à deux chiffres marche TOUJOURS sur la même corde.
            const ed8 = neuf();
            ed8.placerCurseur(0, 0, 4, 0);
            ed8.saisirChiffre(1);
            ed8.deplacerEvenement(-1);
            ed8.saisirChiffre(2);
            out.case12 = forme(ed8);
            return out;
        });

        exiger(modele.trois.forme.startsWith('[4:2 3:2 2:1]'),
            `trois cordes sur le MÊME évènement (${modele.trois.forme})`);
        check(modele.trois.frappes === 5, `en 5 frappes (${modele.trois.frappes})`);
        check(modele.ancienne.forme.startsWith('[4:2 3:2 2:1]') && modele.ancienne.frappes === 7,
            `l'ancienne façon donnait le même accord en ${modele.ancienne.frappes} frappes — deux de plus, `
            + 'et il fallait y penser');
        check(modele.six.notes === 6, `un accord de six cordes tient sur un seul évènement (${modele.six.notes} notes)`);
        check(modele.six.frappes === 11,
            `en ${modele.six.frappes} frappes au lieu de 16 — cinq de gagnées, une par corde ajoutée`);
        check(modele.six.forme.startsWith('[5:3 4:0 3:1 2:2 1:3 0:4]'),
            `et chaque case est sur SA corde (${modele.six.forme.split(' _')[0]})`);

        check(modele.flecheSeule.startsWith('[4:2] [3:5]'),
            `↑ SEUL garde son sens : deux temps, deux notes (${modele.flecheSeule}) — c'est le geste du `
            + 'bassiste, et il n\'a pas changé');

        check(modele.apresRonde.mesure === 1,
            `préalable : après une ronde, l'avance a franchi la barre (mesure ${modele.apresRonde.mesure})`);
        check(modele.ancreRetrouvee.mesure === 0 && modele.ancreRetrouvee.evenement === 0,
            `Maj+↑ revient sur la case ÉCRITE, à travers la barre (m${modele.ancreRetrouvee.mesure}/`
            + `e${modele.ancreRetrouvee.evenement}) — pas « un cran en arrière »`);
        check(modele.parBarre === '[4:7 3:7]',
            `et les deux notes forment bien un accord dans la mesure 1 (${modele.parBarre})`);

        exiger(modele.avantSansAncre.evenement === 2, `préalable : le clic a posé le curseur sur le 3e évènement (e${modele.avantSansAncre.evenement})`);
        check(modele.sansAncre.evenement === 2 && modele.sansAncre.corde === 3,
            `sans rien d'écrit depuis le clic, il se comporte comme ↑ : on reste sur place, une corde plus `
            + `haut (e${modele.sansAncre.evenement}/c${modele.sansAncre.corde})`);

        check(modele.deuxChiffres.startsWith('[4:1 3:2]'),
            `« 1 » puis « 2 » sur DEUX cordes font deux notes, jamais la case 12 (${modele.deuxChiffres})`);
        check(modele.case12.startsWith('[4:12]'),
            `tandis que sur la MÊME corde, la case 12 s'écrit toujours (${modele.case12})`);

        // ── La touche arrive vraiment ───────────────────────────────────────────────────────────
        const auClavier = await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 4, 0);
            window.app.el.zone.focus();
        });
        await page.keyboard.press('2');
        await page.keyboard.press('Shift+ArrowUp');
        await page.keyboard.press('2');
        await page.waitForTimeout(200);
        const vu = await page.evaluate(() => window.app.editeur.partition.mesures[0].voix[0].evenements[0]
            .notes.map(n => n.corde + ':' + n.frette).join(' '));
        check(vu === '4:2 3:2',
            `au clavier, « 2 · Maj+↑ · 2 » écrit un accord sur le premier temps (${vu})`);

        // ── NEUTRALISATION : Maj+↑ redevient un ↑ ordinaire ─────────────────────────────────────
        const sansAncrage = await page.evaluate(async () => {
            const { Editeur } = await import('/src/edit/commands.js');
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            ed.resterSurLeTemps = function (d) { return this.deplacerCorde(d); };   // l'ancrage en moins
            ed.placerCurseur(0, 0, 4, 0);
            ed.saisirChiffre(2);
            ed.resterSurLeTemps(-1);
            ed.saisirChiffre(2);
            return ed.partition.mesures[0].voix[0].evenements
                .map(e => (e.silence || !e.notes.length) ? '_' : '[' + e.notes.map(n => n.corde + ':' + n.frette).join(' ') + ']')
                .join(' ');
        });
        check(sansAncrage.startsWith('[4:2] [3:2]'),
            `NEUTRALISÉ (ancrage retiré) : les deux notes retombent sur DEUX temps (${sansAncrage}) — `
            + 'on croyait écrire un accord, on écrit une gamme');

        check(erreurs.length === 0, 'aucune erreur de console ni exception (' + erreurs.join(' | ') + ')');
    } catch (e) {
        check(false, 'exception pendant le banc : ' + e.message + '\n' + e.stack);
    } finally {
        await fermer();
    }
    process.exit(bilan());
})();
