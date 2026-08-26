// Banc de COHÉRENCE PROFESSIONNELLE : à contenu musical égal, largeur égale.
//
// Une gravure véritable n'impose PAS que TOUTES les mesures d'une partition fassent la même largeur
// — une mesure de rondes et une mesure de doubles-croches ne se lisent pas à la même vitesse, et leur
// donner la même largeur romprait justement ce que l'espacement proportionnel sert à montrer (voir
// engine/layout.js, largeurColonne). C'est ce que montre la propre référence de l'utilisateur : les
// mesures de « Jeux Interdits » n'ont pas toutes la même largeur.
//
// Ce qui EST une exigence professionnelle, et que ce banc protège : deux mesures MUSICALEMENT
// IDENTIQUES doivent occuper EXACTEMENT la même largeur, qu'elles portent ou non un changement
// d'armure/signature — sans quoi la partition paraît instable, comme si l'espacement dépendait d'autre
// chose que du contenu. Un vrai défaut, trouvé en écrivant ce banc : l'en-tête (clé, armure, signature)
// n'était pas mis à l'échelle par le facteur de justification alors que son BUDGET l'était — l'écart
// se logeait dans la marge avant la barre de mesure, qui gonflait ou se resserrait selon qu'une mesure
// portait un en-tête ou non, même à contenu par ailleurs identique.

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
            const page1 = L.mettreEnPage(p, { largeurPage: 900, S: 10 });
            const mesurer = (page) => page.ancrages.mesures.map(a => {
                const evts = page.ancrages.evenements.filter(e => e.mesure === a.index);
                const finNotes = Math.max(...evts.map(e => e.xFin));
                return { largeur: +(a.xFin - a.x).toFixed(2), ecartAvantBarre: +(a.xFin - finNotes).toFixed(2) };
            });
            const largeursPage1 = mesurer(page1);

            // Même partition mise en page sur une largeur DIFFÉRENTE (donc un facteur de
            // justification différent) : si le défaut était présent, l'écart avant barre des
            // mesures 0 et 2 (qui portent un en-tête) diffèrerait de celui des mesures 1 et 3 par un
            // montant qui grandit avec le facteur — le signe distinctif du bug.
            const page2 = L.mettreEnPage(p, { largeurPage: 870, S: 10 });
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
