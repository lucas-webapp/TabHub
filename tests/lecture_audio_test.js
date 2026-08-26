// Banc de la LECTURE AUDIO et de la TÊTE DE LECTURE.
//
// Un banc automatique n'entend rien : il ne peut pas dire si le son est juste. Ce qu'il PEUT établir,
// c'est tout le reste — et c'est là que sont les vrais défauts de ce genre de module : le transport
// avance-t-il vraiment ? le trait suit-il la position réelle du transport, ou une minuterie parallèle
// qui dérivera ? les liaisons de prolongation sont-elles fusionnées, ou la note est-elle réattaquée
// là où la notation dit qu'elle ne doit pas l'être ? un changement de tempo réétire-t-il l'ensemble ?

const creerHarnais = require('./_harness.js');
const { ouvrirApp, taper, lireEtat } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('lecture audio');

(async () => {
    plan(19);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        await page.click('[data-action="duree4"]');
        await page.evaluate(() => document.getElementById('zone-partition').focus());
        await taper(page, ['Digit0', 'ArrowRight', 'Digit2', 'ArrowRight', 'Digit3', 'ArrowRight', 'Digit5']);

        // --- La programmation : ce qui sera réellement joué ------------------------------------------
        const programme = await page.evaluate(async () => {
            await window.app.lecteur.demarrer();
            window.app.lecteur.programmer(window.app.editeur.partition);
            return window.app.lecteur._evenements.map(e => ({ d: e.debut, l: e.duree, n: e.note, v: +e.velocite.toFixed(2) }));
        });
        exiger(programme.length === 4, 'les quatre notes saisies sont programmées');
        check(programme.map(e => e.d).join(',') === '0,1,2,3', 'elles se succèdent d\'une noire, en noires depuis le début');
        check(programme[0].n === 'E4' && programme[3].n === 'A4', 'aux hauteurs que donne l\'accordage (mi4 … la4)');

        // --- Liaison de prolongation : UNE attaque, pas deux -------------------------------------------
        await page.evaluate(() => { window.app.editeur.placerCurseur(0, 0, 0); window.app.editeur.basculerLien('tie'); });
        const avecLiaison = await page.evaluate(() => {
            window.app.lecteur.programmer(window.app.editeur.partition);
            return window.app.lecteur._evenements.map(e => ({ d: e.debut, l: e.duree, n: e.note }));
        });
        check(avecLiaison.length === 3, 'une note liée à la suivante ne produit qu\'UNE attaque, pas deux');
        check(Math.abs(avecLiaison[0].l - 2) < 1e-6, 'et elle sonne la durée des deux réunies');

        // Un hammer-on, lui, EST une attaque — plus douce, mais bien rejouée.
        await page.evaluate(() => { window.app.editeur.basculerLien('tie'); window.app.editeur.basculerLien('hammer'); });
        const avecHammer = await page.evaluate(() => {
            window.app.lecteur.programmer(window.app.editeur.partition);
            return window.app.lecteur._evenements.map(e => +e.velocite.toFixed(3));
        });
        check(avecHammer.length === 4, 'un hammer-on garde les deux attaques : ce n\'est pas une liaison de prolongation');
        check(avecHammer[1] < avecHammer[2], 'mais la note martelée sonne plus doucement que celle attaquée à la main droite');

        // --- Liaison ET nuance de hammer-on, EN PRÉSENCE D'UNE 2e VOIX -----------------------------------
        // `aplatir()` groupe ses entrées par mesure PUIS par voix : le voisin immédiat, dans le tableau
        // à plat, du DERNIER évènement de la voix 0 d'une mesure est le PREMIER évènement de la voix 1
        // de cette même mesure — pas la suite logique de la mélodie. Une recherche « next = plat[i+1] »
        // s'accrocherait donc à la mauvaise voix dès qu'une mesure en porte deux ; c'est exactement le
        // scénario qu'une régression antérieure avait manqué.
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.partition.mesures[0].voix = [
                { evenements: [
                    m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 5, { lien: 'tie' })]),
                    m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 5)]),
                    m.creerEvenement({ valeur: 2 }, [m.creerNote(0, 7, { lien: 'hammer' })]),
                    m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 9)]),
                ] },
                // Voix 1 : une seule ronde, qui occuperait la position « juste après » la voix 0 dans
                // le tableau à plat si le groupement par mesure-puis-voix n'était pas pris en compte.
                { evenements: [m.creerEvenement({ valeur: 1 }, [m.creerNote(5, 0)])] },
            ];
        });
        const avec2Voix = await page.evaluate(() => {
            window.app.lecteur.programmer(window.app.editeur.partition);
            return window.app.lecteur._evenements.map(e => ({ d: e.debut, dur: +e.duree.toFixed(2), v: +e.velocite.toFixed(2) }));
        });
        check(avec2Voix.length === 4, 'voix0 fusionne sa liaison (3 attaques) + voix1 (1 attaque) = 4, malgré la voix 2 intercalée dans le tableau à plat');
        check(Math.abs(avec2Voix[0].dur - 2) < 1e-6, 'la liaison de la voix 0 fusionne toujours ses deux évènements (2 noires), pas seulement le suivant dans LE TABLEAU');
        check(avec2Voix[2].v < avec2Voix[1].v, 'la nuance du hammer-on de la voix 0 reste correcte : note martelée plus douce que celle qui la précède DANS SA VOIX');
        check(Math.abs(avec2Voix[3].v - 0.78) < 1e-6, 'et la voix 1 (la basse) n\'hérite pas à tort de la nuance douce du hammer-on voisin dans le tableau');

        // --- Le palm mute écourte sans déplacer ---------------------------------------------------------
        await page.evaluate(() => { window.app.editeur.basculerLien('hammer'); window.app.editeur.basculerEffetEvenement('palmMute'); });
        const avecPM = await page.evaluate(() => {
            window.app.lecteur.programmer(window.app.editeur.partition);
            return window.app.lecteur._evenements.map(e => ({ d: e.debut, l: +e.duree.toFixed(3) }));
        });
        check(avecPM[0].l < 0.5 && avecPM[0].d === 0, 'le palm mute écourte la note SANS déplacer son attaque');

        // --- Le transport avance et le trait le suit ----------------------------------------------------
        await page.evaluate(() => window.app.editeur.basculerEffetEvenement('palmMute'));
        await page.click('#btn-jouer');
        await page.waitForTimeout(500);
        const p1 = await page.evaluate(() => ({ etat: window.app.lecteur.etat, pos: window.app.lecteur.position, marques: window.app.marquesLecture().length }));
        exiger(p1.etat === 'lecture', 'la lecture démarre');
        check(p1.pos > 0, 'et le transport avance');
        check(p1.marques === 2, 'la tête de lecture est dessinée (surlignage + trait)');

        // Le trait doit lire la position RÉELLE du transport. On compare donc les deux : s'ils
        // s'accordent à toute vitesse, c'est qu'il n'y a pas deux horloges.
        await page.waitForTimeout(500);
        const p2 = await page.evaluate(() => {
            const T = window.Tone;
            return { pos: window.app.lecteur.position, transport: T.Transport.ticks / T.Transport.PPQ };
        });
        check(p2.pos > p1.pos, 'la position continue de progresser');
        check(Math.abs(p2.pos - p2.transport) < 0.06, 'le trait suit l\'horloge AUDIO, pas une minuterie parallèle qui dériverait');

        // --- Pause, reprise, arrêt -------------------------------------------------------------------------
        await page.click('#btn-jouer');
        await page.waitForTimeout(250);
        const enPause = await page.evaluate(() => ({ etat: window.app.lecteur.etat, pos: window.app.lecteur.position }));
        await page.waitForTimeout(350);
        const toujoursEnPause = await page.evaluate(() => window.app.lecteur.position);
        check(enPause.etat === 'pause' && Math.abs(toujoursEnPause - enPause.pos) < 1e-6, 'la pause fige la position au lieu de continuer en sourdine');

        await page.click('#btn-stop');
        await page.waitForTimeout(200);
        const apresStop = await page.evaluate(() => ({ etat: window.app.lecteur.etat, pos: window.app.lecteur.position, marques: window.app.marquesLecture().length }));
        check(apresStop.etat === 'arret' && apresStop.pos === 0, 'l\'arrêt ramène au début du morceau');
        check(apresStop.marques === 0, 'et efface la tête de lecture');

        check(erreurs.length === 0, 'aucune erreur JavaScript pendant la lecture' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
