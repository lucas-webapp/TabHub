// Banc de la RÉGLETTE TEMPORELLE : deux poids de trait, jamais la grille au seizième entière.
//
// CE QU'IL PROTÈGE. La réglette (voir engine/layout.js, poserReglette) a été reprise deux fois cette
// session sur signalement direct : d'abord parce que ses graduations ne tombaient pas en phase avec
// les notes réelles (corrigé en la faisant marcher COLONNE PAR COLONNE plutôt que sur une grille
// absolue), puis parce qu'affichER TOUTE la grille au seizième entre chaque temps et contre-temps
// était « trop lourd visuellement ». Ce banc fige ce second réglage, qui n'avait encore aucune
// couverture :
//   • TEMPS et CONTRE-TEMPS sont TOUJOURS marqués, qu'une note y attaque ou non (repère de comptage
//     stable, y compris sous une note longue qui les traverse sans qu'aucune attaque n'y tombe).
//   • Tout le reste de la grille au seizième (les instants qui ne sont ni temps, ni contre-temps, ni
//     l'attaque réelle d'une note) N'EST PLUS dessiné — c'était le trait en trop.
//   • Une attaque réelle qui tombe hors temps/contre-temps (seizième, triolet) garde malgré tout SON
//     PROPRE trait — la garantie de base de la réglette n'a pas bougé, seul le remplissage entre les
//     attaques a disparu.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('réglette');

(async () => {
    plan(8);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        const r = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const L = await import('/src/engine/layout.js');

            const ticksDe = (pg) => {
                const sys = pg.ancrages.systemes[0];
                return pg.primitives.filter(p =>
                    p.t === 'ligne' && Math.abs(p.x1 - p.x2) < 1e-6 && p.y1 > sys.yReglette + 1e-6);
            };

            // 1. CLAIRSEMÉ : une blanche (2 temps) puis deux noires. Sous l'ancien régime (toute la
            //    grille au seizième), la seule blanche aurait à elle seule posé 8 graduations ; ici,
            //    seuls temps/contre-temps comptent (rien n'attaque entre eux) : 4 temps (0,1,2,3) +
            //    4 contre-temps (0.5,1.5,2.5,3.5) + 1 barre de fermeture (posée en « temps ») = 9.
            const pClairseme = m.creerPartition('guitare');
            pClairseme.mesures = [m.creerMesure({
                voix: [{ evenements: [
                    m.creerEvenement({ valeur: 2 }, [m.creerNote(0, 0)]),
                    m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 1)]),
                    m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 2)]),
                ] }],
            })];
            const pageClairseme = L.mettreEnPage(pClairseme, { largeurPage: 1100, S: 10, reglette: true });
            const ticksClairseme = ticksDe(pageClairseme);

            // 2. DENSE : seize doubles-croches — CHAQUE seizième porte une attaque réelle, donc
            //    AUCUNE réduction n'est attendue ici : 16 attaques + 1 barre de fermeture = 17. Ce
            //    cas prouve que la garantie de base (jamais rater une note réelle) n'a pas bougé.
            const pDense = m.creerPartition('guitare');
            pDense.mesures = [m.creerMesure({
                voix: [{ evenements: Array.from({ length: 16 }, (_, i) => m.creerEvenement({ valeur: 16 }, [m.creerNote(0, i % 8)])) }],
            })];
            const pageDense = L.mettreEnPage(pDense, { largeurPage: 1100, S: 10, reglette: true });
            const ticksDense = ticksDe(pageDense);

            return {
                nClairseme: ticksClairseme.length,
                encreClairseme: ticksClairseme.filter(t => t.couleur === 'encre').length,
                discretClairseme: ticksClairseme.filter(t => t.couleur === 'discret').length,
                nDense: ticksDense.length,
                encreDense: ticksDense.filter(t => t.couleur === 'encre').length,
                discretDense: ticksDense.filter(t => t.couleur === 'discret').length,
            };
        });

        exiger(r.nClairseme === 9,
            `contenu clairsemé (blanche + 2 noires) : 9 graduations attendues (4 temps + 4 contre-temps + fermeture), ${r.nClairseme} trouvées — la grille au seizième ne doit plus combler les intervalles sans attaque`);
        check(r.encreClairseme === 5, 'dont 5 « temps » à trait fort (les 4 temps de la mesure + la barre de fermeture)');
        check(r.discretClairseme === 4, 'et 4 « contre-temps » à trait discret — pas un de plus (plus de grille au seizième résiduelle)');

        exiger(r.nDense === 17,
            `contenu dense (16 doubles-croches) : 17 graduations attendues (16 attaques réelles + fermeture), ${r.nDense} trouvées — une attaque réelle hors temps/contre-temps garde son propre trait`);
        check(r.encreDense === 5, 'dont seulement les 4 temps + la fermeture en trait fort, même à seize attaques');
        check(r.discretDense === 12, 'et les 12 autres attaques (contre-temps compris) en trait discret, aucune disparue');

        check(r.nDense > r.nClairseme, 'un contenu plus dense pose logiquement plus de graduations que le même contenu clairsemé');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
