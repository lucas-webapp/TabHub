// Banc du RETOUR SONORE À LA SAISIE — entendre ce qu'on écrit, et réentendre la mesure d'une touche.
//
// LES DEUX FAÇONS DE TRAVAILLER, et ce banc sert la seconde. (1) On recopie une partition et on
// compare à l'oreille : l'oreille arrive à la fin. (2) On a une mélodie EN TÊTE — et là l'oreille est
// le seul juge, à chaque note. Dans les mots de l'utilisateur : « il y a beaucoup d'erreurs sur le
// rythme et les notes inscrites en premier lieu ».
//
// LE DÉFAUT QU'IL FIGE, et c'était une RÉGRESSION, pas un manque. Le retour sonore existait : la
// commande écrivait la note, l'interface relisait `noteCourante()` au moment de l'annonce et la
// faisait sonner. Puis l'avance automatique est arrivée, le curseur a quitté la case AVANT
// l'annonce, `noteCourante()` s'est mis à rendre la case SUIVANTE — vide — donc `null`. Mesuré :
// avance ÉTEINTE, la note sonne ; avance ALLUMÉE (le défaut), ZÉRO note sonne. Le mécanisme était
// intact et ne servait plus à rien.
//
// Le même piège avait déjà frappé le bouton « ✕ » (note fantôme), réparé à l'époque en suspendant
// l'avance autour de l'appel. On ne le répare pas une troisième fois en relisant ailleurs : la
// commande DIT ce qu'elle a écrit (`derniereNoteSaisie`), comme elle dit déjà sa dette et son bilan,
// et l'interface n'a plus rien à deviner.
//
// ET LA MESURE SE RÉENTEND D'UNE TOUCHE. `Espace` repart toujours du début du morceau — c'est voulu,
// et c'est juste pour écouter. Mais on retouche la mesure 17 et on veut la réentendre ELLE, vingt
// fois. Le seul moyen était de poser une boucle à la souris sur une bande étroite : on quittait le
// clavier à chaque essai. Alt+Espace boucle la mesure du curseur, et un second appui la retire.
//
// AUCUN SON N'EST VÉRIFIÉ ICI, et c'est assumé : on ne peut pas écouter un banc. Ce qu'on éprouve
// est que l'APPEL part, avec la bonne hauteur — le reste (Tone.js, le contexte audio) est éprouvé
// par lecture_audio_test.js.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('retour sonore à la saisie');

(async () => {
    plan(14);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        /** Écrit une case et rend les hauteurs MIDI que l'application a demandé de faire sonner. */
        const ecrireEtEcouter = (frette, avanceAuto) => page.evaluate(([frette, avanceAuto]) => {
            const app = window.app, ed = app.editeur;
            ed.nouveau('guitare');
            ed.avanceAuto = avanceAuto;
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 0, 0);
            const entendues = [];
            const vrai = app.lecteur.apercu.bind(app.lecteur);
            app.lecteur.apercu = function (midi) { entendues.push(midi); return vrai(midi); };
            ed.saisirChiffre(frette);
            app.lecteur.apercu = vrai;
            return { entendues, curseur: { ...ed.curseur } };
        }, [frette, avanceAuto]);

        const on = await ecrireEtEcouter(5, true);
        exiger(on.entendues.length === 1,
            `avance automatique ALLUMÉE : la note sonne (${on.entendues.length} aperçu(s)) — c'est exactement ce qui `
            + 'ne se produisait plus');
        check(on.entendues[0] === 69,
            `et c'est la BONNE hauteur : case 5 sur la corde de mi aigu = la 69 (mesuré ${on.entendues[0]})`);
        check(on.curseur.evenement === 1,
            `le curseur a bien avancé (e${on.curseur.evenement}) : c'est LUI qui cassait la relecture de noteCourante()`);

        const off = await ecrireEtEcouter(5, false);
        check(off.entendues.length === 1 && off.entendues[0] === 69,
            `avance ÉTEINTE : même note, même hauteur (${JSON.stringify(off.entendues)}) — le réglage ne change rien `
            + 'au retour sonore, il ne l\'a jamais dû');

        // LE CANAL EST CONSOMMÉ : une note ne sonne pas deux fois parce qu'un autre geste passe.
        const deuxFois = await page.evaluate(() => {
            const app = window.app, ed = app.editeur;
            ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 0, 0);
            const entendues = [];
            const vrai = app.lecteur.apercu.bind(app.lecteur);
            app.lecteur.apercu = function (midi) { entendues.push(midi); return vrai(midi); };
            ed.saisirChiffre(5);
            ed.deplacerEvenement(1);          // un geste de curseur, qui prévient lui aussi
            ed.appliquerDuree(8);             // une édition, qui prévient aussi
            app.lecteur.apercu = vrai;
            return entendues;
        });
        check(deuxFois.length === 1,
            `la note ne sonne qu'UNE fois (${deuxFois.length}) : le canal est vidé dès qu'il est lu`);

        // UN ACCORD FAIT SONNER CHAQUE NOTE qu'on lui ajoute, et pas la première à chaque fois.
        const accord = await page.evaluate(() => {
            const app = window.app, ed = app.editeur;
            ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            const entendues = [];
            const vrai = app.lecteur.apercu.bind(app.lecteur);
            app.lecteur.apercu = function (midi) { entendues.push(midi); return vrai(midi); };
            ed.placerCurseur(0, 0, 4, 0); ed.saisirChiffre(2);
            ed.deplacerEvenement(-1); ed.deplacerCorde(1); ed.saisirChiffre(2);
            app.lecteur.apercu = vrai;
            return entendues;
        });
        check(accord.length === 2 && accord[0] !== accord[1],
            `chaque note d'un accord sonne, et sonne SA hauteur (${JSON.stringify(accord)})`);

        // ── La mesure se réentend d'une touche ──────────────────────────────────────────────────
        const etatBoucle = () => page.evaluate(() => ({
            boucle: window.app.lecteur.boucleLecture ? { ...window.app.lecteur.boucleLecture } : null,
            etat: window.app.lecteur.etat,
        }));
        await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            for (let m = 0; m < 3; m++) { ed.placerCurseur(m, 0, 0, 0); for (let i = 0; i < 4; i++) ed.saisirChiffre(i + 1); }
            ed.placerCurseur(2, 0, 0, 0);
            window.app.el.zone.focus();
        });
        await page.waitForTimeout(120);
        check((await etatBoucle()).boucle === null, 'au repos, aucune boucle');

        await page.keyboard.press('Alt+ ');
        await page.waitForTimeout(400);
        const apresAlt = await etatBoucle();
        exiger(apresAlt.boucle && apresAlt.boucle.debut === 2 && apresAlt.boucle.fin === 2,
            `Alt+Espace boucle la mesure DU CURSEUR, elle seule (${JSON.stringify(apresAlt.boucle)})`);
        check(apresAlt.etat === 'lecture', `et lance la lecture (${apresAlt.etat}) — on n'a pas à presser Espace ensuite`);

        // UN SECOND APPUI DÉFAIT : la même touche fait et défait.
        await page.keyboard.press('Alt+ ');
        await page.waitForTimeout(400);
        const apresSecond = await etatBoucle();
        check(apresSecond.boucle === null, 'un second Alt+Espace retire la boucle');
        check(apresSecond.etat !== 'lecture', `et arrête la lecture (${apresSecond.etat})`);

        // ET LA BOUCLE SE DÉFAIT D'UN Ctrl+Z, comme tout le reste (voir etapeBoucle).
        await page.evaluate(() => { window.app.editeur.placerCurseur(1, 0, 0, 0); });
        await page.keyboard.press('Alt+ ');
        await page.waitForTimeout(400);
        const surUn = await etatBoucle();
        exiger(surUn.boucle && surUn.boucle.debut === 1, `préalable : la boucle est sur la mesure 2 (${JSON.stringify(surUn.boucle)})`);
        await page.evaluate(() => { window.app.arreter(); window.app.editeur.annuler(); });
        await page.waitForTimeout(250);
        check((await etatBoucle()).boucle === null, 'un Ctrl+Z la retire — poser une boucle reste une étape comme une autre');

        // ── NEUTRALISATION ──────────────────────────────────────────────────────────────────────
        // On rebranche l'ancienne relecture : l'interface redemande la note AU CURSEUR au lieu de
        // lire ce que la commande a dit avoir écrit. Le curseur a bougé, elle ne trouve rien.
        const ancienne = await page.evaluate(() => {
            const app = window.app, ed = app.editeur;
            ed.nouveau('guitare');
            ed.avanceAuto = true;
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 0, 0);
            const entendues = [];
            const vrai = app.lecteur.apercu.bind(app.lecteur);
            app.lecteur.apercu = function (midi) { entendues.push(midi); return vrai(midi); };
            // Le canal est neutralisé : la commande n'a plus rien à dire, l'interface doit relire.
            Object.defineProperty(ed, 'derniereNoteSaisie', { configurable: true, get: () => null, set: () => {} });
            ed.saisirChiffre(5);
            const relu = ed.noteCourante();
            Object.defineProperty(ed, 'derniereNoteSaisie', { configurable: true, value: null, writable: true });
            app.lecteur.apercu = vrai;
            return { entendues, reluAuCurseur: relu };
        });
        check(ancienne.entendues.length === 0 && ancienne.reluAuCurseur === null,
            'NEUTRALISÉ (canal coupé, ancienne relecture) : plus rien ne sonne, et noteCourante() rend bien `null` — '
            + 'le curseur a déjà quitté la case écrite');

        check(erreurs.length === 0, 'aucune erreur de console ni exception (' + erreurs.join(' | ') + ')');
    } catch (e) {
        check(false, 'exception pendant le banc : ' + e.message + '\n' + e.stack);
    } finally {
        await fermer();
    }
    process.exit(bilan());
})();
