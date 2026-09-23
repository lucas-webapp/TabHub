// Banc du POINT VISÉ DANS UN SILENCE — écrire au milieu d'un silence, là où aucun évènement ne
// commence.
//
// LE DÉFAUT QU'IL FIGE, dans les mots de l'utilisateur : « si je supprime des notes, elles sont
// logiquement remplacées par des silences. Cependant, ensuite, je ne peux plus ressaisir une note au
// même endroit car le silence a pris sa place. »
//
// LA CAUSE, et elle n'était pas celle qu'on croit. Le curseur ne pouvait se poser que sur une
// FRONTIÈRE d'évènement existante (voir main.js#cibleDepuisClic, qui cherchait l'ancre contenant
// l'abscisse cliquée). Or les silences se fusionnent — c'est voulu, et c'est ce que font MuseScore et
// Guitar Pro : effacer trois croches au milieu d'une mesure laisse UN silence d'un temps, pas trois.
// Mesuré sur huit croches dont on efface les trois du milieu : les évènements démarrent à 0,00 —
// 0,50 — 1,00 — 2,00 — 2,50 — 3,00 — 3,50. Le temps 2,00 existe, le temps 1,50 n'existe plus. Il
// était devenu impossible de viser le deuxième temps de ce silence.
//
// LA RÉPONSE. Le curseur porte un DÉCALAGE en noires depuis le début de l'évènement, calé sur la
// grille que la mesure impose vraiment (la même que celle sur laquelle l'éditeur écrit ses silences,
// voir model/rythme.js#grilleDeMesure). Un temps portant un triolet se vise par tiers, un temps
// portant des triples-croches par huitièmes : on ne peut désigner que des places où une figure sait
// tomber.
//
// ET LE SILENCE N'EST SCINDÉ QU'À L'ÉCRITURE. Un clic est une NAVIGATION : il n'a pas à pousser un
// point d'annulation ni à modifier le document. On retient l'intention, on n'agit que lorsqu'elle se
// concrétise — et un Ctrl+Z ne laisse donc aucune trace de la coupure.
//
// Émulation SOURIS : c'est par le clic que le point se vise.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('viser dans un silence');

(async () => {
    plan(14);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        const etat = () => page.evaluate(async () => {
            const { dureeEnNoires } = await import('/src/model/duration.js');
            const evts = window.app.editeur.partition.mesures[0].voix[0].evenements;
            let t = 0;
            const depart = [];
            for (const e of evts) { depart.push(+t.toFixed(4)); t += dureeEnNoires(e.duree); }
            return {
                contenu: evts.map(e => (e.silence || !e.notes.length) ? '_' : e.notes.map(n => n.frette).join('+')),
                durees: evts.map(e => +dureeEnNoires(e.duree).toFixed(4)),
                depart,
                total: +t.toFixed(6),
                curseur: { ...window.app.editeur.curseur },
                etapes: window.app.editeur.passe.length,
            };
        });
        /** Un point dans l'ancre de l'évènement `i`, à la fraction `f` de sa largeur. */
        const pointDans = (i, f) => page.evaluate(([i, f]) => {
            const svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect();
            const a = window.app.page.ancrages.evenements.find(e => e.mesure === 0 && e.evenement === i && e.voix === 0);
            const x = a.xDebut + (a.xFin - a.xDebut) * f;
            return { x: b.left + (x / window.app.page.largeur) * b.width,
                     y: b.top + ((a.yTab + 0) / window.app.page.hauteur) * b.height };
        }, [i, f]);

        // --- La mesure du retour utilisateur, refaite à l'identique --------------------------------
        await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.avanceAuto = true;
            ed.dureeCourante = { valeur: 8, points: 0, nolet: null };
            for (let i = 0; i < 8; i++) ed.saisirChiffre(i);
            ed.effacerNotes([2, 3, 4].map(e => ({ mesure: 0, voix: 0, evenement: e, corde: 0 })));
            ed.placerCurseur(0, 0, 0, 0);
        });
        await page.waitForTimeout(200);
        let e = await etat();
        exiger(e.depart.join(' ') === '0 0.5 1 2 2.5 3 3.5',
            `préalable : les trois croches effacées ont fondu en silences, et plus aucun évènement ne `
            + `commence à 1,50 (départs : ${e.depart.join(' ')})`);

        // --- 1. CLIQUER DANS LA SECONDE MOITIÉ DU SILENCE VISE SON SECOND TEMPS ---------------------
        const etapesAvant = e.etapes;
        const p = await pointDans(2, 0.6);
        await page.mouse.click(p.x, p.y);
        await page.waitForTimeout(150);
        e = await etat();
        check(e.curseur.evenement === 2 && Math.abs(e.curseur.decalage - 0.5) < 1e-6,
            `un clic dans la moitié droite du silence vise un décalage d'une demi-noire `
            + `(évènement ${e.curseur.evenement}, décalage ${e.curseur.decalage}) — le point que la `
            + 'grille de la mesure place là');
        check(e.etapes === etapesAvant && e.contenu.join(' ') === '0 1 _ _ 5 6 7',
            `et le document n'a PAS bougé (${etapesAvant} → ${e.etapes} point(s) d'annulation, contenu `
            + `« ${e.contenu.join(' ')} ») : un clic est une navigation, pas une modification`);

        // --- 2. TAPER UNE CASE SCINDE LE SILENCE ET ÉCRIT AU BON ENDROIT ----------------------------
        await page.evaluate(() => document.getElementById('zone-partition').focus());
        await page.keyboard.press('Digit9');
        await page.waitForTimeout(200);
        e = await etat();
        check(e.depart.includes(1.5) && e.contenu[e.depart.indexOf(1.5)] === '9',
            `la case 9 s'écrit bien à 1,50 (départs : ${e.depart.join(' ')}, contenu : ${e.contenu.join(' ')}) — `
            + 'le temps qui n\'existait plus');
        check(Math.abs(e.total - 4) < 1e-9,
            `et la mesure totalise toujours exactement sa capacité (${e.total})`);
        check(e.durees.every(d => d > 0.24),
            `les deux moitiés du silence sont réécrites en figures propres (${e.durees.join(' ')}), `
            + 'jamais coupées à la hache en durées que rien ne sait graver');

        // --- 3. UN SEUL Ctrl+Z, ET AUCUNE TRACE DE LA COUPURE ---------------------------------------
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(200);
        e = await etat();
        check(e.depart.join(' ') === '0 0.5 1 2 2.5 3 3.5' && e.contenu.join(' ') === '0 1 _ _ 5 6 7',
            `un seul Ctrl+Z ramène le silence ENTIER (départs : ${e.depart.join(' ')}) — l'état est `
            + 'mémorisé avant la scission, sinon la coupure survivrait à l\'annulation du geste qui l\'a causée');

        // --- 4. LE BANDEAU DU CURSEUR MONTRE LE POINT VISÉ -------------------------------------------
        const p2 = await pointDans(2, 0.6);
        await page.mouse.click(p2.x, p2.y);
        await page.waitForTimeout(150);
        const bandeau = await page.evaluate(() => {
            const a = window.app.page.ancrages.evenements.find(e => e.mesure === 0 && e.evenement === 2 && e.voix === 0);
            const m = window.app.marquesCurseur();
            return { xDebutAncre: a.xDebut, xFinAncre: a.xFin, xBandeau: m[0].x, largeur: m[0].w };
        });
        check(bandeau.xBandeau > bandeau.xDebutAncre + 1,
            `le bandeau du curseur commence APRÈS le début du silence (${bandeau.xBandeau.toFixed(1)} > `
            + `${bandeau.xDebutAncre.toFixed(1)}) : on voit où l'on va écrire, plutôt que de le découvrir après`);
        check(Math.abs((bandeau.xBandeau + bandeau.largeur) - bandeau.xFinAncre) < 1,
            'et il court jusqu\'au bout du silence — la moitié qu\'on s\'apprête à occuper');

        // --- 5. CLIQUER AU DÉBUT NE CHANGE RIEN À L'ANCIEN COMPORTEMENT -----------------------------
        const p3 = await pointDans(2, 0.05);
        await page.mouse.click(p3.x, p3.y);
        await page.waitForTimeout(150);
        e = await etat();
        check(e.curseur.evenement === 2 && (e.curseur.decalage || 0) === 0,
            `un clic dans la première cellule ne pose AUCUN décalage (${e.curseur.decalage}) : le cas `
            + 'ordinaire, de loin le plus fréquent, se comporte exactement comme avant');

        // --- 6. UNE NOTE NE SE COUPE PAS ------------------------------------------------------------
        const p4 = await pointDans(0, 0.8);
        await page.mouse.click(p4.x, p4.y);
        await page.waitForTimeout(150);
        e = await etat();
        check(e.curseur.evenement === 0 && (e.curseur.decalage || 0) === 0,
            'cliquer dans la seconde moitié d\'une NOTE ne pose pas de décalage : on ne coupe pas ce qui sonne');

        // --- 7. LA GRILLE SUIT CE QUE LA MESURE PORTE : un temps en triolet se vise par tiers -------
        await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 8, points: 0, nolet: { dans: 3, valent: 2 } };
            ed.saisirChiffre(1);                       // une croche de triolet, puis le reste en silence
            ed.placerCurseur(0, 1, 0, 0);
        });
        await page.waitForTimeout(200);
        const triolet = await page.evaluate(() => {
            const a = window.app.page.ancrages.evenements.find(e => e.mesure === 0 && e.evenement === 1 && e.voix === 0);
            // Un point aux deux tiers de la largeur du silence qui suit le triolet.
            return window.app._decalageDansSilence(a, a.xDebut + (a.xFin - a.xDebut) * 0.45);
        });
        check(Math.abs(triolet - 1 / 3) < 1e-6,
            `dans le silence qui suit une croche de triolet, le point visé se cale sur un TIERS de temps `
            + `(${triolet.toFixed(6)}) et non sur une moitié : la grille se déduit de ce que la mesure porte`);

        // --- 8. En 6/8, la grille suit le temps composé ---------------------------------------------
        const compose = await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.definirSignature(6, 8);
            ed.prevenir('document');
            const a = window.app.page.ancrages.evenements.find(e => e.mesure === 0 && e.evenement === 0 && e.voix === 0);
            return window.app._decalageDansSilence(a, a.xDebut + (a.xFin - a.xDebut) * 0.55);
        });
        check(Math.abs(compose - 1.5) < 1e-6,
            `en 6/8, cliquer au milieu de la mesure vide vise le SECOND TEMPS, une noire pointée plus `
            + `loin (${compose}) — le temps y vaut 1,5 noire, pas 1`);

        const jsErreurs = erreurs.filter(m => !/Failed to load|favicon|Tone|AudioContext/i.test(m));
        check(jsErreurs.length === 0, `aucune erreur JavaScript${jsErreurs.length ? ' — ' + jsErreurs[0] : ''}`);
        check(true, 'toutes les vérifications se sont exécutées sans exception');
    } catch (err) {
        check(false, 'le banc s\'est arrêté sur une exception — ' + (err && err.message));
        console.error(err);
    }
    await fermer();
    bilan();
})();
