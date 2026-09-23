// Banc de L'APERÇU D'ABSORPTION — un geste destructeur montre ce qu'il va emporter, AVANT.
//
// LE SEUL GESTE CONCERNÉ, et c'est délibéré. Depuis la dette (voir dette_test.js), un allongement ne
// se refuse plus : il DÉCALE, la mesure s'endette, et le chiffre rouge en fin de mesure le dit.
// Décaler ne perd rien — un Ctrl+Z suffit, et il n'y a donc aucune surprise à prévenir. « Absorber »
// (Alt+A) est l'autre règlement de la dette, et le seul qui DÉTRUISE : il reprend aux évènements
// suivants la place que la note agrandie occupe désormais, et leurs notes partent avec. C'est aussi
// le seul geste de l'application qui supprime des notes sans les nommer une à une — « effacer la
// note », « supprimer la mesure » disent déjà ce qu'ils font.
//
// LA PLAINTE DONT IL S'INSPIRE, côté MuseScore : on y perd du travail sans l'avoir demandé, parce que
// l'allongement absorbe ce qui suit sans rien annoncer. TabHub a déjà pris l'autre défaut (décaler
// par défaut) ; il restait à rendre l'absorption, quand on la demande, entièrement prévisible.
//
// CE QUE LE BANC TIENT :
//   1. le parcours de l'aperçu est CELUI de la commande (Editeur#matiereAbsorbee), lu par les deux ;
//   2. l'aperçu ne colore RIEN quand le geste n'aboutirait pas — refuser après avoir désigné des
//      notes serait un mensonge de plus, pas un de moins ;
//   3. le survol ET le focus clavier l'allument, le départ l'éteint ;
//   4. ce qui était coloré est exactement ce qui disparaît ;
//   5. un aperçu ne survit pas à une modification (le bouton se masque sous le pointeur : un bouton
//      masqué ne promet aucun `pointerleave`).
//
// Émulation SOURIS et CLAVIER : c'est par le survol et par le focus que l'aperçu s'allume.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('aperçu d\'absorption');

const SEL = '[data-action="absorberDette"]';

(async () => {
    plan(29);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // ── Partie MODÈLE : le parcours partagé, éprouvé sans navigateur ────────────────────────
        // (Chargée dans la page pour n'ouvrir qu'un seul Chromium — le banc est déjà en ligne.)
        const modele = await page.evaluate(async () => {
            const { Editeur } = await import('/src/edit/commands.js');
            const { dureeEnNoires } = await import('/src/model/duration.js');
            const croches = () => {
                const ed = new Editeur(); ed.nouveau('guitare');
                ed.dureeCourante = { valeur: 8, points: 0, nolet: null };
                for (let i = 0; i < 8; i++) ed.saisirChiffre(i % 10);
                ed.placerCurseur(0, 0, 0, 0);
                return ed;
            };
            const evts = ed => ed.partition.mesures[0].voix[0].evenements;
            const out = {};

            // (a) Dette d'une noire et demie : la prise doit couvrir exactement la dette.
            const ed = croches();
            ed.appliquerDuree(2);                       // la première croche devient une blanche
            out.dette = +ed.ecartMesure(0, 0).toFixed(4);
            const prise = ed.matiereAbsorbee(0, 0, 0);
            out.prise = prise && { ...prise };
            const avant = evts(ed).slice();
            const designes = avant.slice(prise.debut, prise.fin);
            const epargnes = avant.filter((_, i) => i < prise.debut || i >= prise.fin);
            ed.absorberDette(0, 0, 0);
            const apres = evts(ed);
            // L'IDENTITÉ des objets, pas leur nombre : un évènement recréé à l'identique compterait
            // pour le même si l'on ne comparait que les durées, et c'est précisément ce qu'on veut
            // distinguer — « cette note-là a disparu ».
            out.designesPartis = designes.every(e => !apres.includes(e));
            out.epargnesIntacts = epargnes.every(e => apres.includes(e));
            out.totalApres = +apres.reduce((t, e) => t + dureeEnNoires(e.duree), 0).toFixed(6);

            // (b) Prise PARTIELLE : la dernière figure n'est consommée qu'à moitié. Elle disparaît
            //     quand même — c'est la durée qui revient en silence, jamais la musique. L'aperçu
            //     doit donc la colorer ENTIÈRE.
            const ed2 = croches();
            ed2.basculerPoint();                        // 0,50 → 0,75 : dette d'un quart de noire
            out.dettePartielle = +ed2.ecartMesure(0, 0).toFixed(4);
            const p2 = ed2.matiereAbsorbee(0, 0, 0);
            out.prisePartielle = p2 && { ...p2 };
            const note2 = evts(ed2)[1];
            ed2.absorberDette(0, 0, 0);
            out.notePartiellePartie = !evts(ed2).includes(note2);
            out.silenceRendu = evts(ed2)[1] && (evts(ed2)[1].silence || !evts(ed2)[1].notes.length);

            // (c) Les deux cas où le geste n'aboutit pas : `null`, et le refus garde son message.
            const ed3 = croches();
            out.sansDette = ed3.matiereAbsorbee(0, 0, 0);
            out.refusSansDette = !ed3.absorberDette(0, 0, 0) && /ne déborde pas/.test(ed3.derniereErreur || '');
            const ed4 = croches();
            // `placerCurseur(mesure, evenement, corde, voix)` — la corde en TROISIÈME.
            ed4.placerCurseur(0, 7, 0, 0);              // sur la DERNIÈRE croche
            ed4.appliquerDuree(2);                      // qu'on allonge : plus rien derrière pour payer
            out.detteEnFin = +ed4.ecartMesure(0, 0).toFixed(4);
            out.curseurEnFin = ed4.curseur.evenement;
            out.sansMatiere = ed4.matiereAbsorbee();   // au curseur, comme le fera le bouton
            out.refusSansMatiere = !ed4.absorberDette() && /Pas assez de matière/.test(ed4.derniereErreur || '');
            return out;
        });

        check(modele.dette === 1.5, `dette de 1,5 noire après l'allongement (mesuré ${modele.dette})`);
        check(modele.prise && modele.prise.debut === 1 && modele.prise.fin === 4,
            `matiereAbsorbee désigne les évènements 1 à 3 (mesuré ${JSON.stringify(modele.prise)})`);
        check(modele.prise && Math.abs(modele.prise.pris - modele.prise.dette) < 1e-9,
            'la prise couvre exactement la dette, sans surplus ici');
        check(modele.designesPartis, 'tous les évènements désignés ont bien disparu');
        check(modele.epargnesIntacts, 'aucun évènement non désigné n\'a été touché');
        check(modele.totalApres === 4, `la mesure retombe à 4 noires (mesuré ${modele.totalApres})`);

        check(modele.dettePartielle === 0.25, `prise partielle : dette d'un quart de noire (mesuré ${modele.dettePartielle})`);
        check(modele.prisePartielle && modele.prisePartielle.debut === 1 && modele.prisePartielle.fin === 2,
            `prise partielle : un seul évènement désigné (mesuré ${JSON.stringify(modele.prisePartielle)})`);
        check(modele.prisePartielle && modele.prisePartielle.pris > modele.prisePartielle.dette + 1e-9,
            'prise partielle : on prend PLUS que la dette — le surplus revient en silence');
        check(modele.notePartiellePartie, 'prise partielle : la note désignée disparaît quand même');
        check(modele.silenceRendu, 'prise partielle : à sa place, un silence — la durée revient, pas la musique');

        check(modele.sansDette === null, 'aucune dette : matiereAbsorbee ne désigne rien');
        check(modele.refusSansDette, 'aucune dette : la commande refuse, et le dit');
        check(modele.curseurEnFin === 7, `préalable : le curseur est bien sur la dernière figure (mesuré ${modele.curseurEnFin})`);
        check(modele.sansMatiere === null,
            `pas assez de matière après le curseur : matiereAbsorbee ne désigne rien (dette ${modele.detteEnFin})`);
        check(modele.refusSansMatiere, 'pas assez de matière : la commande refuse, et renvoie vers Alt+R');

        // ── Partie INTERFACE : le survol, le focus, et ce qui est coloré ────────────────────────
        /** Écrit huit croches puis allonge la première, comme au modèle — mais dans l'application. */
        const preparerDette = () => page.evaluate(() => {
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 8, points: 0, nolet: null };
            for (let i = 0; i < 8; i++) ed.saisirChiffre(i % 10);
            ed.placerCurseur(0, 0, 0, 0);
            ed.appliquerDuree(2);
            return +ed.ecartMesure(0, 0).toFixed(4);
        });
        /** Les rectangles d'aperçu réellement présents dans le SVG, en coordonnées de partition. */
        const rectsApercu = () => page.evaluate(() =>
            [...document.querySelectorAll('#feuille svg rect[fill="var(--apercu-absorbe)"]')]
                .map(r => ({ x: +r.getAttribute('x'), w: +r.getAttribute('width') })));

        const detteUi = await preparerDette();
        exiger(detteUi === 1.5, `l'application porte la même dette de 1,5 noire (mesuré ${detteUi})`);
        check((await rectsApercu()).length === 0, 'au repos, aucun aperçu n\'est dessiné');

        const boutonVisible = await page.isVisible(SEL);
        exiger(boutonVisible, 'le bouton « Absorber » est à l\'écran dès que la mesure déborde');

        await page.hover(SEL);
        await page.waitForTimeout(120);
        const survol = await rectsApercu();
        exiger(survol.length === 3, `au survol, trois évènements sont colorés (mesuré ${survol.length})`);

        // L'aperçu couvre EXACTEMENT les ancres 1, 2, 3 — pas « trois rectangles quelque part ».
        // Un aperçu qui colorerait les bons évènements au mauvais endroit ne dirait rien de juste.
        const ancres = await page.evaluate(() => [1, 2, 3].map(k => {
            const a = window.app.page.ancrages.evenements.find(z => z.mesure === 0 && z.voix === 0 && z.evenement === k);
            return a && { x: a.xDebut, w: a.xFin - a.xDebut };
        }));
        const colle = survol.every((r, i) => ancres[i]
            && Math.abs(r.x - ancres[i].x) < 0.02 && Math.abs(r.w - ancres[i].w) < 0.02);
        check(colle, `chaque rectangle couvre l'ancre de son évènement (aperçu ${JSON.stringify(survol)} / ancres ${JSON.stringify(ancres)})`);

        // Sortir du bouton éteint l'aperçu. On vise un point NEUTRE de la page, pas un autre bouton :
        // ce qu'on éprouve ici est le départ, pas l'arrivée ailleurs.
        await page.mouse.move(5, 5);
        await page.waitForTimeout(120);
        check((await rectsApercu()).length === 0, 'en quittant le bouton, l\'aperçu s\'éteint');

        // AU CLAVIER AUSSI, et c'est là que ça compte : on presse Alt+A sans avoir la main sur le
        // bouton. Le focus doit donc allumer l'aperçu comme le survol.
        await page.focus(SEL);
        await page.waitForTimeout(120);
        check((await rectsApercu()).length === 3, 'le focus clavier allume le même aperçu');
        await page.evaluate(() => document.querySelector('[data-action="absorberDette"]').blur());
        await page.waitForTimeout(120);
        check((await rectsApercu()).length === 0, 'la perte du focus l\'éteint');

        // Un AUTRE bouton d'action ne doit rien allumer : l'aperçu appartient à ce geste-là.
        const autre = await page.evaluate(() => {
            const b = [...document.querySelectorAll('[data-action]')]
                .find(x => x.dataset.action !== 'absorberDette' && !x.hidden && x.offsetParent);
            return b ? b.dataset.action : null;
        });
        if (exiger(!!autre, 'un autre bouton d\'action est disponible pour la comparaison')) {
            await page.hover(`[data-action="${autre}"]`);
            await page.waitForTimeout(120);
            check((await rectsApercu()).length === 0, `survoler « ${autre} » n'allume aucun aperçu`);
        }

        // CE QUI ÉTAIT COLORÉ EST CE QUI DISPARAÎT. On relit l'aperçu, on clique, on compare.
        await page.hover(SEL);
        await page.waitForTimeout(120);
        const avantClic = await page.evaluate(() => {
            const ed = window.app.editeur;
            const p = ed.matiereAbsorbee(0, 0, 0);
            const evts = ed.partition.mesures[0].voix[0].evenements;
            return { frettesDesignees: evts.slice(p.debut, p.fin).map(e => e.notes.map(n => n.frette).join('')),
                     toutes: evts.map(e => (e.silence || !e.notes.length) ? '_' : e.notes.map(n => n.frette).join('')) };
        });
        await page.click(SEL);
        await page.waitForTimeout(200);
        const apresClic = await page.evaluate(() => {
            const evts = window.app.editeur.partition.mesures[0].voix[0].evenements;
            return { toutes: evts.map(e => (e.silence || !e.notes.length) ? '_' : e.notes.map(n => n.frette).join('')),
                     rects: [...document.querySelectorAll('#feuille svg rect[fill="var(--apercu-absorbe)"]')].length };
        });
        check(JSON.stringify(avantClic.frettesDesignees) === JSON.stringify(['1', '2', '3']),
            `l'aperçu désignait les frettes 1, 2, 3 (mesuré ${JSON.stringify(avantClic.frettesDesignees)})`);
        check(JSON.stringify(apresClic.toutes) === JSON.stringify(['0', '4', '5', '6', '7']),
            `après absorption il reste 0, 4, 5, 6, 7 (mesuré ${JSON.stringify(apresClic.toutes)})`);
        check(apresClic.rects === 0, 'le bouton disparu, plus aucun aperçu ne subsiste');

        // UN APERÇU NE SURVIT PAS À UNE MODIFICATION. On simule exactement ce qu'un bouton masqué
        // sous le pointeur produit : l'état reste armé faute de `pointerleave`. Une édition suivante
        // ne doit PAS rallumer une surbrillance que personne ne survole.
        await preparerDette();
        await page.evaluate(() => { window.app._apercuAction = 'absorberDette'; window.app.dessiner(); });
        await page.waitForTimeout(80);
        check((await rectsApercu()).length === 3, 'préalable : l\'état armé dessine bien l\'aperçu');
        await page.evaluate(() => { window.app.editeur.placerCurseur(0, 0, 0, 0); });
        await page.waitForTimeout(120);
        check((await rectsApercu()).length === 0, 'la moindre modification désarme l\'aperçu');

        // ── NEUTRALISATION : on désarme chaque mécanisme, on vérifie que l'échec nommé revient ──
        // (1) Le survol ne pilote plus rien.
        await preparerDette();
        await page.evaluate(() => { window.app._montrerApercuVrai = window.app.montrerApercu; window.app.montrerApercu = () => {}; });
        await page.hover(SEL);
        await page.waitForTimeout(120);
        check((await rectsApercu()).length === 0,
            'NEUTRALISÉ (survol débranché) : plus rien ne s\'allume — c\'est bien le survol qui pilote');
        await page.evaluate(() => { window.app.montrerApercu = window.app._montrerApercuVrai; });
        await page.mouse.move(5, 5);
        await page.waitForTimeout(80);

        // (2) L'aperçu recalcule son propre parcours, sans le garde-fou du refus. C'est la DÉRIVE
        //     que le partage empêche : là où la commande refuse (« pas assez de matière »), l'aperçu
        //     naïf désigne quand même des notes, et promet une destruction qui n'aura pas lieu.
        const derive = await page.evaluate(async () => {
            const { dureeEnNoires } = await import('/src/model/duration.js');
            const app = window.app, ed = app.editeur;
            ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 8, points: 0, nolet: null };
            for (let i = 0; i < 8; i++) ed.saisirChiffre(i % 10);
            // La position qui fait la DIFFÉRENCE entre les deux parcours : il reste de la matière
            // après le curseur (deux croches, une noire en tout), mais PAS ASSEZ pour la dette d'une
            // noire et demie. Le parcours partagé conclut « impossible » ; le naïf, lui, colore ce
            // qu'il a croisé avant de manquer de matière — deux notes qu'aucune absorption ne
            // prendra, puisqu'il n'y aura pas d'absorption.
            ed.placerCurseur(0, 5, 0, 0);
            ed.appliquerDuree(2);
            const compter = () => document.querySelectorAll('#feuille svg rect[fill="var(--apercu-absorbe)"]').length;
            app._apercuAction = 'absorberDette'; app.dessiner();
            const avecPartage = compter();
            // La version naïve : le parcours d'avant, qui s'arrête faute de matière sans rien conclure.
            const vrai = app.marquesApercu;
            app.marquesApercu = function () {
                const c = this.editeur.curseur;
                const voix = this.editeur.partition.mesures[c.mesure].voix[c.voix];
                const dette = this.editeur.ecartMesure(c.mesure, c.voix);
                const S = this.page.geo.S, m = [];
                let pris = 0;
                for (let k = c.evenement + 1; k < voix.evenements.length && pris < dette - 1e-9; k++) {
                    pris += dureeEnNoires(voix.evenements[k].duree);
                    const a = this.page.ancrages.evenements.find(z => z.mesure === c.mesure && z.voix === c.voix && z.evenement === k);
                    if (a) m.push({ t: 'rect', x: a.xDebut, y: a.yPortee - 1.2 * S, w: a.xFin - a.xDebut,
                                    h: (a.yBas + 1.2 * S) - (a.yPortee - 1.2 * S), couleur: 'var(--apercu-absorbe)' });
                }
                return m;
            };
            app._apercuAction = 'absorberDette'; app.dessiner();
            const sansPartage = compter();
            app.marquesApercu = vrai;
            app._apercuAction = null; app.dessiner();
            return { avecPartage, sansPartage, refus: !ed.absorberDette() };
        });
        check(derive.refus, 'préalable : dans cette position, la commande refuse bel et bien');
        check(derive.avecPartage === 0, 'geste impossible : le parcours partagé ne colore rien');
        check(derive.sansPartage === 2,
            `NEUTRALISÉ (parcours recalculé à part) : ${derive.sansPartage} évènement(s) colorés pour un geste qui va refuser — la dérive que le partage empêche`);

        // (3) Le désarmement à chaque modification ne se fait plus. On neutralise CETTE LIGNE-LÀ, en
        //     rendant l'écriture de `null` sans effet : l'application continue de tourner normalement,
        //     c'est le seul geste de nettoyage qui disparaît. Un aperçu se met alors à peindre des
        //     notes que personne ne survole, à la première mesure qui déborde ensuite.
        const stale = await page.evaluate(async () => {
            const app = window.app;
            const compter = () => document.querySelectorAll('#feuille svg rect[fill="var(--apercu-absorbe)"]').length;
            const armer = () => { app._apercuAction = 'absorberDette'; app.dessiner(); };
            const ecrire = () => {
                const ed = app.editeur;
                ed.nouveau('guitare');
                ed.dureeCourante = { valeur: 8, points: 0, nolet: null };
                for (let i = 0; i < 8; i++) ed.saisirChiffre(i % 10);
                ed.placerCurseur(0, 0, 0, 0);
                ed.appliquerDuree(2);                   // la modification qui recrée une dette
            };
            ecrire(); armer(); ecrire();
            const avecDesarmement = compter();          // l'application telle qu'elle est
            let garde = 'absorberDette';
            Object.defineProperty(app, '_apercuAction', {
                configurable: true,
                get: () => garde,
                set: (v) => { if (v !== null) garde = v; },   // le désarmement, et lui seul, ignoré
            });
            ecrire();
            const sansDesarmement = compter();
            Object.defineProperty(app, '_apercuAction', { value: null, writable: true, configurable: true });
            app.dessiner();
            return { avecDesarmement, sansDesarmement };
        });
        check(stale.avecDesarmement === 0,
            `après une modification, l'aperçu armé est éteint (mesuré ${stale.avecDesarmement} rectangle(s))`);
        check(stale.sansDesarmement === 3,
            `NEUTRALISÉ (désarmement supprimé) : ${stale.sansDesarmement} note(s) rougies sans que personne ne survole quoi que ce soit`);

        check(erreurs.length === 0, 'aucune erreur de console ni exception (' + erreurs.join(' | ') + ')');
    } catch (e) {
        check(false, 'exception pendant le banc : ' + e.message + '\n' + e.stack);
    } finally {
        await fermer();
    }
    process.exit(bilan());
})();
