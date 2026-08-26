// Banc de COHÉRENCE PROFESSIONNELLE : à SIGNATURE égale, largeur égale.
//
// REVU depuis que la largeur de mesure est devenue FIXE par capacité rythmique (voir
// engine/layout.js, LARGEUR_PAR_NOIRE) : deux mesures sont désormais à la même largeur dès que leur
// SIGNATURE l'est, contenu dense ou clairsemé n'y changeant plus rien (ce cas précis, avec des
// contenus délibérément différents, est couvert par tests/mesures_par_ligne_test.js). Ce banc-ci
// garde un angle plus étroit et toujours vrai : l'EN-TÊTE (clé, armure, signature) ne doit jamais
// fausser la marge avant la barre de mesure. Un vrai défaut, trouvé en écrivant ce banc à l'époque
// où les systèmes étaient encore justifiés par étirement : l'en-tête n'était pas mis à l'échelle par
// le facteur alors que son BUDGET l'était — l'écart se logeait dans la marge avant la barre, qui
// gonflait ou se resserrait selon qu'une mesure portait un en-tête ou non, même à contenu par
// ailleurs identique. La justification par étirement a depuis disparu (largeur fixe oblige), mais la
// garantie — la marge avant barre est une CONSTANTE, jamais affectée par l'en-tête — reste ce que ce
// banc vérifie.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('cohérence de largeur');

(async () => {
    plan(7);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        const r = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const L = await import('/src/engine/layout.js');
            const p = m.creerPartition('guitare');
            const cr = (c, f) => m.creerNote(c, f);
            const identique = () => ({ voix: [{ evenements: [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [cr(0, f)])) }] });
            p.mesures = [
                m.creerMesure({ signature: { battements: 4, unite: 4 }, armure: 0, ...identique() }),
                m.creerMesure(identique()),
                // Celle-ci change d'armure : porte un EN-TÊTE que ses voisines n'ont pas, à contenu
                // par ailleurs rigoureusement identique.
                m.creerMesure({ armure: 2, ...identique() }),
                m.creerMesure(identique()),
            ];
            // Largeur choisie large pour tenir les 4 mesures sur UNE seule ligne malgré leur
            // largeur désormais fixe (les mesures ne s'y compressent plus) : l'angle testé ici est
            // l'en-tête, pas le découpage en systèmes (déjà couvert ailleurs, voir
            // mesures_par_ligne_test.js) — une mesure qui basculerait sur une nouvelle ligne
            // redessinerait elle-même clé/armure et fausserait la comparaison.
            const page1 = L.mettreEnPage(p, { largeurPage: 1150, S: 10 });
            const mesurer = (page) => page.ancrages.mesures.map(a => {
                const evts = page.ancrages.evenements.filter(e => e.mesure === a.index);
                const finNotes = Math.max(...evts.map(e => e.xFin));
                return { largeur: +(a.xFin - a.x).toFixed(2), ecartAvantBarre: +(a.xFin - finNotes).toFixed(2) };
            });
            const largeursPage1 = mesurer(page1);

            // Même partition mise en page sur une largeur DIFFÉRENTE, mais toujours assez large pour
            // que les 4 mesures restent sur une ligne : la largeur étant fixe, ce second cas ne
            // prouve plus grand-chose de plus que le premier, mais le garder évite de perdre la
            // couverture d'un simple oubli si une notion de justification devait un jour revenir.
            const page2 = L.mettreEnPage(p, { largeurPage: 1300, S: 10 });
            const largeursPage2 = mesurer(page2);

            return { largeursPage1, largeursPage2 };
        });

        const [l1] = [r.largeursPage1];
        exiger(l1.length === 4, 'les quatre mesures sont bien posées');
        check(l1[1].largeur === l1[3].largeur, 'deux mesures SANS en-tête, au contenu identique, ont EXACTEMENT la même largeur');
        check(Math.abs(l1[0].ecartAvantBarre - l1[1].ecartAvantBarre) < 0.02, 'la marge avant la barre ne dépend pas de la présence d\'un en-tête (page large)');
        check(Math.abs(l1[2].ecartAvantBarre - l1[1].ecartAvantBarre) < 0.02, 'ni pour la mesure qui change d\'armure (page large)');

        const l2 = r.largeursPage2;
        check(l2[1].largeur === l2[3].largeur, 'la même propriété tient à une largeur de page différente (facteur d\'étirement différent)');
        check(Math.abs(l2[0].ecartAvantBarre - l2[1].ecartAvantBarre) < 0.02, 'la marge avant la barre ne dépend toujours pas de l\'en-tête, même très étiré');
        check(Math.abs(l2[2].ecartAvantBarre - l2[1].ecartAvantBarre) < 0.02, 'et la mesure à armure change de largeur, pas sa marge finale');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
