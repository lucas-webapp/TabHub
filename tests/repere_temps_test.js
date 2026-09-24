// Banc du REPÈRE DE TEMPS — savoir sur quel temps on est, sans le compter soi-même.
//
// LE DÉFAUT QU'IL FIGE, dans les mots de l'utilisateur : « la saisie consistera majoritairement des
// modifications des longueurs de notes et silences, SANS TOUJOURS SAVOIR SUR QUEL TEMPS JE SUIS. »
//
// MESURÉ AVANT CORRECTIF. La barre du bas disait « Mesure 3 / 12 », la corde, la hauteur, la dette —
// et JAMAIS le temps. Une réglette numérotée existe bel et bien, mais seulement dans la fenêtre
// d'aide rythmique : sur la partition elle-même, rien ne numérote les temps. Elle ne disait pas non
// plus la FIGURE sous le curseur — seulement celle que la palette propose d'écrire, qui en diffère
// constamment quand on corrige un rythme (c'est même à ça qu'on corrige).
//
// LE TEMPS SUIT LA SIGNATURE, PAS LA NOIRE, et c'est le point qui fait tout. En 6/8 un temps vaut
// une noire pointée : compter en noires y donnerait « 1, 1½, 2, 2½ » là où le musicien compte
// « 1, 2 ». L'unité est celle des ligatures et de la grille d'écriture (uniteDeGroupement) — une
// seule idée de « temps » dans toute l'application, jamais deux.
//
// Émulation NAVIGATEUR : c'est un texte d'interface qu'on éprouve, tel qu'il s'affiche.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('repère de temps');

(async () => {
    plan(14);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        /** Le repère affiché pour chaque évènement d'une mesure, tel qu'on le lit à l'écran. */
        const parcourir = (prepare, n) => page.evaluate(([prepare, n]) => {
            const app = window.app, ed = app.editeur;
            // eslint-disable-next-line no-new-func
            new Function('ed', prepare)(ed);
            const vus = [];
            for (let i = 0; i < n; i++) {
                ed.placerCurseur(0, i, 0, 0);
                app.rafraichirInfos();
                vus.push((app.el.position.textContent.split(' · ')[1] || '').trim());
            }
            return vus;
        }, [prepare, n]);

        const croches = `ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 8, points: 0, nolet: null };
            for (let i = 0; i < 8; i++) ed.saisirChiffre(i + 1);`;
        const vus = await parcourir(croches, 8);
        exiger(vus[0] === 'temps 1', `le premier évènement est sur le temps 1 (« ${vus[0]} »)`);
        check(JSON.stringify(vus) === JSON.stringify(
            ['temps 1', 'temps 1½', 'temps 2', 'temps 2½', 'temps 3', 'temps 3½', 'temps 4', 'temps 4½']),
            `huit croches en 4/4 se comptent « 1, 1½, 2, 2½… » (${vus.join(' | ')})`);

        // 6/8 : LE TEMPS EST LA NOIRE POINTÉE. C'est ici que compter en noires se verrait.
        const sixHuit = `ed.nouveau('guitare');
            ed.placerCurseur(0, 0, 0, 0);
            ed.definirSignature(6, 8);
            ed.dureeCourante = { valeur: 8, points: 0, nolet: null };
            for (let i = 0; i < 6; i++) ed.saisirChiffre(i + 1);`;
        const six = await parcourir(sixHuit, 6);
        check(JSON.stringify(six) === JSON.stringify(
            ['temps 1', 'temps 1⅓', 'temps 1⅔', 'temps 2', 'temps 2⅓', 'temps 2⅔']),
            `en 6/8, DEUX temps de trois croches — « 1, 1⅓, 1⅔, 2… » et non « 1, 1½, 2, 2½… » (${six.join(' | ')})`);

        // LE DÉCALAGE DANS UN SILENCE compte : c'est là qu'on a le plus besoin qu'on nous le dise.
        const decale = await page.evaluate(() => {
            const app = window.app, ed = app.editeur;
            ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 0, 0); ed.saisirChiffre(3);
            const lire = () => { app.rafraichirInfos(); return (app.el.position.textContent.split(' · ')[1] || '').trim(); };
            ed.placerCurseur(0, 1, 0, 0, 0);     // début du 2e temps
            const sans = lire();
            ed.placerCurseur(0, 1, 0, 0, 0.5);   // son MILIEU, visé dans le silence
            return { sans, avec: lire() };
        });
        check(decale.sans === 'temps 2', `viser le début du silence dit « temps 2 » (« ${decale.sans} »)`);
        check(decale.avec === 'temps 2½',
            `viser son milieu dit « temps 2½ » (« ${decale.avec} ») — le décalage change le temps désigné`);

        // UNE MESURE ENDETTÉE CONTINUE DE COMPTER : taire le temps 5 au moment où la mesure déborde
        // serait taire l'information la plus utile.
        const endettee = await page.evaluate(() => {
            const app = window.app, ed = app.editeur;
            ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            for (let i = 0; i < 4; i++) ed.saisirChiffre(i + 1);
            ed.placerCurseur(0, 0, 0, 0); ed.insererEvenement();
            ed.placerCurseur(0, 4, 0, 0);
            app.rafraichirInfos();
            return { pos: app.el.position.textContent, det: app.el.selection.textContent };
        });
        check(/temps 5/.test(endettee.pos), `une mesure endettée a bien un « temps 5 » en 4/4 (« ${endettee.pos} »)`);
        check(/trop pleine/.test(endettee.det), 'et la dette se lit toujours à côté');

        // LA FIGURE SOUS LE CURSEUR, nommée — l'autre moitié de « où suis-je ».
        const figures = await page.evaluate(() => {
            const app = window.app, ed = app.editeur;
            ed.nouveau('guitare');
            const lire = () => { app.rafraichirInfos(); return app.el.selection.textContent.split(' · ')[0]; };
            const out = {};
            ed.dureeCourante = { valeur: 8, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 0, 0); ed.saisirChiffre(3);
            ed.placerCurseur(0, 0, 0, 0); out.croche = lire();
            ed.basculerPoint(); out.pointee = lire();
            ed.basculerPoint(); ed.basculerTriolet(); out.triolet = lire();
            // La PALETTE dit autre chose : c'est justement la distinction qu'on veut.
            ed.dureeCourante = { valeur: 1, points: 0, nolet: null };
            out.paletteSurRonde = { palette: ed.dureeCourante.valeur, barre: lire() };
            return out;
        });
        check(figures.croche === 'croche', `la figure écrite est nommée (« ${figures.croche} »)`);
        check(figures.pointee === 'croche pointée', `le point est dit (« ${figures.pointee} »)`);
        check(figures.triolet === 'croche de triolet', `le triolet aussi (« ${figures.triolet} »)`);
        check(figures.paletteSurRonde.barre === 'croche de triolet',
            `et la barre dit ce qu'il Y A, pas ce que la palette propose d'écrire (palette sur la ronde, `
            + `barre : « ${figures.paletteSurRonde.barre} »)`);

        // ── NEUTRALISATION ──────────────────────────────────────────────────────────────────────
        // (1) On compte en NOIRES au lieu de compter en temps. En 4/4 rien ne bouge — c'est
        //     précisément pour ça qu'un banc en 4/4 seul n'aurait rien prouvé. En 6/8, tout change.
        const enNoires = await page.evaluate(async () => {
            const app = window.app, ed = app.editeur;
            const { nomDeFraction } = await import('/src/model/duration.js');
            const S = await import('/src/model/score.js');
            ed.nouveau('guitare');
            ed.placerCurseur(0, 0, 0, 0);
            ed.definirSignature(6, 8);
            ed.dureeCourante = { valeur: 8, points: 0, nolet: null };
            for (let i = 0; i < 6; i++) ed.saisirChiffre(i + 1);
            const vrai = app.tempsDuCurseur.bind(app);
            app.tempsDuCurseur = function () {
                const c = this.editeur.curseur;
                const pos = S.positionDansMesure(this.editeur.partition.mesures[c.mesure], c.evenement, c.voix);
                const i = Math.floor(pos + 1e-9);
                return `temps ${i + 1}${nomDeFraction(pos - i)}`;      // l'unité est la NOIRE
            };
            const vus = [];
            for (let i = 0; i < 6; i++) { ed.placerCurseur(0, i, 0, 0); app.rafraichirInfos(); vus.push((app.el.position.textContent.split(' · ')[1] || '').trim()); }
            app.tempsDuCurseur = vrai;
            return vus;
        });
        check(enNoires[1] === 'temps 1½' && enNoires[3] === 'temps 2½',
            `NEUTRALISÉ (compté en noires) : le 6/8 se lit « ${enNoires.join(' | ')} » — quatre temps et demi `
            + 'là où le musicien en compte deux');

        // (2) On ignore le décalage : viser le milieu d'un silence redit le temps du début.
        const sansDecalage = await page.evaluate(() => {
            const app = window.app, ed = app.editeur;
            ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 0, 0); ed.saisirChiffre(3);
            const vrai = app.tempsDuCurseur.bind(app);
            app.tempsDuCurseur = function () { const c = this.editeur.curseur; const d = c.decalage; c.decalage = 0; const r = vrai(); c.decalage = d; return r; };
            ed.placerCurseur(0, 1, 0, 0, 0.5);
            app.rafraichirInfos();
            const vu = (app.el.position.textContent.split(' · ')[1] || '').trim();
            app.tempsDuCurseur = vrai;
            return vu;
        });
        check(sansDecalage === 'temps 2',
            `NEUTRALISÉ (décalage ignoré) : le milieu du silence redit « ${sansDecalage} » — le repère ne distingue `
            + 'plus les deux endroits qu\'on peut viser dans un même silence');

        check(erreurs.length === 0, 'aucune erreur de console ni exception (' + erreurs.join(' | ') + ')');
    } catch (e) {
        check(false, 'exception pendant le banc : ' + e.message + '\n' + e.stack);
    } finally {
        await fermer();
    }
    process.exit(bilan());
})();
