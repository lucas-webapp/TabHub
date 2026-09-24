// Banc du BANDEAU DU CURSEUR — la bande verte verticale qui dit « je suis ici ».
//
// CE QU'IL PROTÈGE. Retour utilisateur, capture à l'appui : « la petite bande verte verticale pour
// savoir où je suis positionné : elle n'est pas toujours centrée avec la note ». Le « pas TOUJOURS »
// est la moitié importante du retour, et il décrit exactement le défaut : une tête de note ne se pose
// PAS au milieu de la case qu'elle occupe. La gravure la place à 42 % de sa première colonne (voir
// engine/layout.js, `xNote`) pour laisser à sa gauche la place d'une altération et à sa droite celle
// de la hampe et des ligatures. Un bandeau tendu du bord gauche au bord droit de la case héritait
// donc d'un décalage de 8 % de cette case — MESURÉ à S=10 : 1 px sur une double-croche, 2 sur une
// croche, 4 sur une noire, 8 sur une blanche, 16 sur une ronde. Invisible sur les figures brèves,
// franc sur les longues : on croit le curseur posé entre deux notes.
//
// LA RÈGLE QUE CE BANC FIXE (voir main.js#marquesCurseur) :
//   • le bandeau est CENTRÉ sur la tête, à la fraction de pixel près, quelle que soit la figure ;
//   • sa demi-largeur est la PLUS PETITE des deux distances tête↔bord, jamais la moitié de la case :
//     c'est ce qui l'empêche de mordre sur la case précédente ou de franchir la barre de mesure — la
//     dernière figure d'une mesure s'étendant, elle, jusqu'à la barre ;
//   • il GRANDIT toujours avec la durée : une ronde reste quatre fois plus large qu'une noire, sans
//     quoi le bandeau cesserait de dire « voilà le temps que cette figure occupe » ;
//   • VISER À L'INTÉRIEUR D'UN SILENCE reste l'exception, et volontairement : là le bandeau part du
//     point visé et court jusqu'au bout du silence (voir viser_silence_test.js, qui l'épingle) — il
//     ne désigne pas une figure mais un INSTANT, et le centrer n'aurait aucun sens.
//
// NEUTRALISATION (dernière section) : on redonne au bandeau ses anciennes bornes (xDebut→xFin) et on
// vérifie que le banc s'en aperçoit. Sans elle, rien ne prouverait que ces vérifications mesurent
// bien ce que `marquesCurseur` gouverne.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('bandeau du curseur');

(async () => {
    plan(16);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // Un morceau qui mélange les durées : c'est le MÉLANGE qui fait diverger les cases, une
        // figure isolée ne prouverait rien (voir lieuDeLaPosition, même piège).
        await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.placerCurseur(0, 0, 0, 0);
            const n = (valeur, frette) => { ed.appliquerDuree(valeur); ed.saisirChiffre(frette); };
            [0, 2, 3, 5].forEach(f => n(4, f));                 // mesure 1 : quatre noires
            for (let i = 0; i < 8; i++) n(8, i % 5);            // mesure 2 : huit croches
            n(2, 7); n(8, 5); n(8, 3); n(4, 0);                 // mesure 3 : blanche, 2 croches, noire
            n(1, 12);                                           // mesure 4 : une ronde
        });
        await page.waitForTimeout(250);

        /** Le bandeau et l'ancrage de la case visée, pour un évènement donné. */
        const bandeau = (mesure, evenement) => page.evaluate(([m, e]) => {
            const app = window.app;
            // placerCurseur(mesure, evenement, corde, voix) — l'ordre compte, et se trompe en silence.
            app.editeur.placerCurseur(m, e, 0, 0);
            const a = app.ancrageCurseur();
            const marques = app.marquesCurseur();
            if (!a || !marques.length) return null;
            const b = marques[0];
            return {
                figure: a.ref.duree.valeur, notes: a.ref.notes.length,
                x: b.x, w: b.w, centre: b.x + b.w / 2,
                tete: a.x, xDebut: a.xDebut, xFin: a.xFin,
            };
        }, [mesure, evenement]);

        // --- 1. CENTRÉ, SUR TOUTES LES FIGURES -----------------------------------------------------
        const cas = [
            ['noire', 0, 0], ['dernière noire de la mesure', 0, 3],
            ['croche', 1, 0], ['dernière croche de la mesure', 1, 7],
            ['blanche', 2, 0], ['ronde', 3, 0],
        ];
        const mesures = {};
        for (const [nom, m, e] of cas) {
            const b = await bandeau(m, e);
            if (!exiger(!!b, `le bandeau existe sur ${nom} (mesure ${m + 1}, évènement ${e + 1})`)) continue;
            mesures[nom] = b;
            check(Math.abs(b.centre - b.tete) < 0.01,
                `${nom} : le bandeau est centré sur la tête (centre ${b.centre.toFixed(2)} contre `
                + `tête ${b.tete.toFixed(2)}, écart ${(b.centre - b.tete).toFixed(3)} px)`);
        }

        // --- 2. JAMAIS AU-DELÀ DE SA PROPRE CASE ---------------------------------------------------
        // Le bandeau qui déborderait à gauche recouvrirait la note précédente ; à droite, il
        // franchirait la barre de mesure sur la dernière figure. Les deux désignent la mauvaise note.
        for (const [nom, b] of Object.entries(mesures)) {
            check(b.x >= b.xDebut - 0.01 && (b.x + b.w) <= b.xFin + 0.01,
                `${nom} : le bandeau tient dans sa case (${b.x.toFixed(1)}→${(b.x + b.w).toFixed(1)} `
                + `dans ${b.xDebut.toFixed(1)}→${b.xFin.toFixed(1)})`);
        }

        // --- 3. IL GRANDIT TOUJOURS AVEC LA DURÉE ---------------------------------------------------
        if (mesures['croche'] && mesures['noire'] && mesures['blanche'] && mesures['ronde']) {
            const c = mesures['croche'].w, n = mesures['noire'].w, bl = mesures['blanche'].w, r = mesures['ronde'].w;
            check(c < n && n < bl && bl < r,
                `le bandeau grandit avec la figure (croche ${c.toFixed(1)} < noire ${n.toFixed(1)} `
                + `< blanche ${bl.toFixed(1)} < ronde ${r.toFixed(1)} px) : il dit toujours le temps occupé`);
            check(Math.abs(n / c - 2) < 0.05 && Math.abs(r / n - 4) < 0.05,
                `et dans le RAPPORT des durées (noire/croche ${(n / c).toFixed(2)}, ronde/noire `
                + `${(r / n).toFixed(2)}) : centrer ne l'a pas rendu proportionnellement plus étroit`);
        }

        // --- 4. NEUTRALISATION : on remet les anciennes bornes, le banc doit s'en apercevoir ---------
        const sabotage = await page.evaluate(() => {
            const app = window.app;
            const vrai = app.marquesCurseur.bind(app);
            app.marquesCurseur = function () {
                const m = vrai();
                const a = this.ancrageCurseur();
                if (m.length && a) { m[0].x = a.xDebut; m[0].w = a.xFin - a.xDebut; }   // l'ancien calcul
                return m;
            };
            app.editeur.placerCurseur(3, 0, 0, 0);
            const a = app.ancrageCurseur(), b = app.marquesCurseur()[0];
            const ecart = (b.x + b.w / 2) - a.x;
            app.marquesCurseur = vrai;   // on repose l'original
            const c = app.marquesCurseur()[0], a2 = app.ancrageCurseur();
            return { ecartSabote: ecart, ecartRendu: (c.x + c.w / 2) - a2.x };
        });
        check(Math.abs(sabotage.ecartSabote) > 1,
            `NEUTRALISATION : avec les anciennes bornes, la ronde retrouve son décalage `
            + `(${sabotage.ecartSabote.toFixed(1)} px) — la vérification mesure bien ce que marquesCurseur gouverne`);
        check(Math.abs(sabotage.ecartRendu) < 0.01,
            `et l'original rendu recentre aussitôt (${sabotage.ecartRendu.toFixed(3)} px)`);

        check(erreurs.length === 0, `aucune erreur de console pendant le banc (${erreurs.length})`);
    } catch (e) {
        check(false, 'le banc s\'est terminé sans exception : ' + e.message);
    } finally {
        await fermer();
        process.exit(bilan());
    }
})();
