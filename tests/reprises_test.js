// Banc des REPRISES JOUÉES — ‖: :‖ s'entend, au lieu de rester un dessin.
//
// LE DÉFAUT QU'IL FIGE. Les barres de reprise étaient DESSINÉES mais jamais JOUÉES : zéro occurrence
// de « reprise » dans audio/player.js. On écrivait ‖: :‖, la lecture passait tout droit. Or c'est
// précisément en comparant à l'oreille qu'on vérifie une recopie (« recopier des partitions
// existantes et comparer directement à l'oreille pour vérifier que ça fonctionne ») — et on comparait
// un morceau qui n'avait pas la forme de l'original. `nbFois` existait sur la mesure depuis toujours
// et RIEN ne l'écrivait ni ne le lisait : de la donnée morte.
//
// LE POINT D'ARCHITECTURE. `aplatir` continue de décrire la partition ÉCRITE : un évènement, une
// place. Y déplier les reprises créerait des évènements en double sans identité propre, que le rendu
// ne saurait plus rattacher à une position à l'écran. Le parcours, lui, ne parle que de MESURES et
// ne duplique rien : il répète un INDEX. Le lecteur programme la même note plusieurs fois, et la tête
// de lecture retraduit sa position — une seule note à l'écran, jouée deux fois.
//
// LA BOUCLE L'EMPORTE : sous une barre orange, on travaille un passage et on veut l'entendre TEL
// QU'IL EST ÉCRIT. Poser ou retirer la boucle rebascule le dépliage, et le banc le vérifie.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('reprises jouées');

(async () => {
    plan(22);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // ── Le PARCOURS, logique pure ───────────────────────────────────────────────────────────
        const parcours = await page.evaluate(async () => {
            const S = await import('/src/model/score.js');
            const mk = (n) => {
                const p = S.creerPartition('guitare');
                while (p.mesures.length < n) p.mesures.push(S.creerMesure());
                p.mesures.length = n;
                return p;
            };
            const out = {};
            out.sansRien = S.parcoursDeLecture(mk(6));
            out.aDesReprisesVide = S.aDesReprises(mk(6));

            let p = mk(6); p.mesures[0].repriseDebut = true; p.mesures[2].repriseFin = true;
            out.simple = S.parcoursDeLecture(p);
            out.aDesReprisesVrai = S.aDesReprises(p);

            p = mk(6); p.mesures[2].repriseFin = true;
            out.sansOuvrante = S.parcoursDeLecture(p);

            p = mk(6); p.mesures[1].repriseDebut = true; p.mesures[3].repriseFin = true; p.mesures[3].nbFois = 4;
            out.quatreFois = S.parcoursDeLecture(p);

            // MAISONS : ‖: 1 2 [1. 3 :‖ [2. 4 | 5 6
            p = mk(6);
            p.mesures[0].repriseDebut = true;
            p.mesures[2].volta = [1]; p.mesures[2].repriseFin = true;
            p.mesures[3].volta = [2];
            out.maisons = S.parcoursDeLecture(p);

            // Deux sections indépendantes, chacune son compteur.
            p = mk(8);
            p.mesures[0].repriseDebut = true; p.mesures[1].repriseFin = true;
            p.mesures[4].repriseDebut = true; p.mesures[6].repriseFin = true;
            out.deuxSections = S.parcoursDeLecture(p);

            // La volta arrive d'un fichier : ce qui n'est pas un entier ≥ 1 est écarté.
            const brut = S.normaliser({ mesures: [{ volta: [1, '2', 0, -3, 2.0, null] }, {}] });
            out.voltaNettoyee = brut.mesures[0].volta;
            const sansVolta = S.normaliser({ mesures: [{ volta: [] }, {}] });
            out.voltaVide = sansVolta.mesures[0].volta;
            return out;
        });

        check(JSON.stringify(parcours.sansRien) === JSON.stringify([0, 1, 2, 3, 4, 5]),
            `sans reprise, le parcours est le morceau lui-même (${parcours.sansRien.join(' ')})`);
        check(parcours.aDesReprisesVide === false && parcours.aDesReprisesVrai === true,
            'et `aDesReprises` sait distinguer les deux — c\'est ce qui fait que rien ne change pour un morceau ordinaire');
        exiger(JSON.stringify(parcours.simple) === JSON.stringify([0, 1, 2, 0, 1, 2, 3, 4, 5]),
            `‖:1 2 3:‖ 4 5 6 se joue 1 2 3 1 2 3 4 5 6 (${parcours.simple.join(' ')})`);
        check(JSON.stringify(parcours.sansOuvrante) === JSON.stringify([0, 1, 2, 0, 1, 2, 3, 4, 5]),
            `un :‖ sans ‖: renvoie AU DÉBUT du morceau, la convention de la gravure (${parcours.sansOuvrante.join(' ')})`);
        check(JSON.stringify(parcours.quatreFois) === JSON.stringify([0, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3, 4, 5]),
            `nbFois = 4 joue la section QUATRE fois en tout (${parcours.quatreFois.join(' ')}) — le champ existait `
            + 'depuis toujours et rien ne le lisait');
        check(JSON.stringify(parcours.maisons) === JSON.stringify([0, 1, 2, 0, 1, 3, 4, 5]),
            `avec maisons : la 1re fois passe par la mesure 3, la 2e la saute et va en 4 (${parcours.maisons.join(' ')})`);
        check(JSON.stringify(parcours.deuxSections) === JSON.stringify([0, 1, 0, 1, 2, 3, 4, 5, 6, 4, 5, 6, 7]),
            `deux sections comptent chacune ses tours, sans se gêner (${parcours.deuxSections.join(' ')})`);
        check(JSON.stringify(parcours.voltaNettoyee) === JSON.stringify([1, 2]),
            `une volta lue d'un fichier ne garde que des entiers ≥ 1, dédoublonnés et triés (${JSON.stringify(parcours.voltaNettoyee)})`);
        check(parcours.voltaVide === null,
            'et une liste vide devient `null` : « aucune maison » et « une maison qui ne couvre aucun passage » ne sont pas la même chose');

        // ── Le LECTEUR : la même note programmée plusieurs fois ─────────────────────────────────
        const lecteur = await page.evaluate(async () => {
            const S = await import('/src/model/score.js');
            const app = window.app, ed = app.editeur, l = app.lecteur;
            await l.demarrer().catch(() => {});
            /** ‖: 1 2 :‖ 3 — une ronde par mesure, une case différente par mesure. */
            const ecrire = () => {
                ed.nouveau('guitare');
                ed.dureeCourante = { valeur: 1, points: 0, nolet: null };
                for (let m = 0; m < 3; m++) { ed.placerCurseur(m, 0, 0, 0); ed.saisirChiffre(m + 1); }
                ed.partition.mesures[0].repriseDebut = true;
                ed.partition.mesures[1].repriseFin = true;
            };
            const out = {};
            ecrire();
            l.programmer(ed.partition);
            out.dureeEcrite = S.dureeTotale(ed.partition);
            out.dureeJouee = l.duree;
            out.passages = l._parcours ? l._parcours.passages.map(p => p.mesure) : null;
            // La conversion JOUÉ -> ÉCRIT, aux bornes de mesure.
            out.conversions = [0, 4, 8, 12, 16].map(j => +l._sonneDepuisJoue(j).toFixed(3));
            // Et son aller : partir « à la mesure 2 » vise le PREMIER passage.
            out.depart = [0, 4, 8].map(e => +l._joueDepuisSonne(e).toFixed(3));

            // SOUS UNE BOUCLE, on ne déplie plus.
            l.definirBoucle(ed.partition, 0, 1);
            l.programmer(ed.partition);
            out.sousBoucle = l._parcours;
            out.dureeSousBoucle = l.duree;
            l.retirerBoucle(ed.partition);
            l.programmer(ed.partition);
            out.apresBoucle = l._parcours ? l._parcours.passages.length : null;

            // Un morceau SANS reprise ne construit aucun parcours : rien ne change pour lui.
            ed.nouveau('guitare');
            l.programmer(ed.partition);
            out.sansReprise = l._parcours;
            return out;
        });

        check(lecteur.dureeJouee > lecteur.dureeEcrite,
            `la durée JOUÉE dépasse la durée écrite (${lecteur.dureeJouee} contre ${lecteur.dureeEcrite}) — `
            + 'sans quoi l\'arrêt de fin tomberait au milieu du deuxième passage');
        check(Math.abs(lecteur.dureeJouee - (lecteur.dureeEcrite + 8)) < 1e-6,
            `et de EXACTEMENT deux mesures de plus (${lecteur.dureeJouee - lecteur.dureeEcrite} noires)`);
        exiger(JSON.stringify(lecteur.passages) === JSON.stringify([0, 1, 0, 1, 2, 3]),
            `le lecteur tient les passages dans l'ordre (${(lecteur.passages || []).join(' ')})`);
        check(JSON.stringify(lecteur.conversions) === JSON.stringify([0, 4, 0, 4, 8]),
            `la tête de lecture REVIENT en arrière sur la reprise (joué 0,4,8,12,16 → écrit `
            + `${lecteur.conversions.join(', ')}) : une seule note à l'écran, jouée deux fois`);
        check(JSON.stringify(lecteur.depart) === JSON.stringify([0, 4, 16]),
            `partir « à la mesure N » vise le PREMIER passage (écrit 0,4,8 → joué ${lecteur.depart.join(', ')}) — `
            + 'jamais la reprise');

        check(lecteur.sousBoucle === null,
            'sous une boucle, plus de dépliage : on travaille un passage, on veut l\'entendre tel qu\'il est écrit');
        check(Math.abs(lecteur.dureeSousBoucle - lecteur.dureeEcrite) < 1e-6,
            `et la durée redevient celle de l'écrit (${lecteur.dureeSousBoucle})`);
        check(lecteur.apresBoucle === 6, `retirer la boucle redéplie (${lecteur.apresBoucle} passages)`);
        check(lecteur.sansReprise === null,
            'un morceau SANS reprise ne construit aucun parcours — rien ne change pour lui, pas même une conversion');

        // ── La lecture tourne vraiment, reprises comprises ──────────────────────────────────────
        const enVrai = await page.evaluate(async () => {
            const app = window.app, ed = app.editeur, l = app.lecteur;
            ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 1, points: 0, nolet: null };
            for (let m = 0; m < 3; m++) { ed.placerCurseur(m, 0, 0, 0); ed.saisirChiffre(m + 1); }
            ed.partition.mesures[0].repriseDebut = true;
            ed.partition.mesures[1].repriseFin = true;
            l.definirTempo(600);                       // très vite : le banc n'attend pas une minute
            await l.jouer(ed.partition, 0);
            return { etat: l.etat, duree: l.duree };
        });
        exiger(enVrai.etat === 'lecture', `la lecture démarre sur un morceau à reprises (${enVrai.etat})`);
        await page.waitForTimeout(600);
        const pendant = await page.evaluate(() => ({ position: window.app.lecteur.position, etat: window.app.lecteur.etat }));
        check(pendant.position >= 0 && pendant.position <= 12 + 1e-6,
            `et la tête de lecture reste DANS la partition écrite (${pendant.position.toFixed(2)} ≤ 12) alors que le `
            + 'transport, lui, est allé plus loin');
        await page.evaluate(() => window.app.arreter());
        await page.waitForTimeout(150);

        // ── NEUTRALISATION : on redonne au lecteur son ignorance des reprises ───────────────────
        const sansDepliage = await page.evaluate(async () => {
            const S = await import('/src/model/score.js');
            const app = window.app, ed = app.editeur, l = app.lecteur;
            ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 1, points: 0, nolet: null };
            for (let m = 0; m < 3; m++) { ed.placerCurseur(m, 0, 0, 0); ed.saisirChiffre(m + 1); }
            ed.partition.mesures[0].repriseDebut = true;
            ed.partition.mesures[1].repriseFin = true;
            const vrai = l._construireParcours.bind(l);
            l._construireParcours = () => null;        // l'état d'avant : le lecteur ne sait rien des reprises
            l.programmer(ed.partition);
            const out = { parcours: l._parcours, duree: l.duree, ecrite: S.dureeTotale(ed.partition) };
            l._construireParcours = vrai;
            return out;
        });
        check(sansDepliage.parcours === null && Math.abs(sansDepliage.duree - sansDepliage.ecrite) < 1e-6,
            `NEUTRALISÉ (dépliage retiré) : le morceau dure ${sansDepliage.duree} noires au lieu de `
            + `${sansDepliage.ecrite + 8} — la reprise est dessinée et la lecture passe tout droit, exactement `
            + 'comme avant ce lot');

        check(erreurs.length === 0, 'aucune erreur de console ni exception (' + erreurs.join(' | ') + ')');
    } catch (e) {
        check(false, 'exception pendant le banc : ' + e.message + '\n' + e.stack);
    } finally {
        await fermer();
    }
    process.exit(bilan());
})();
