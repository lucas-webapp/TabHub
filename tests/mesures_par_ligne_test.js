// Banc du CONTRÔLE « MESURES PAR LIGNE ».
//
// CE QU'IL PROTÈGE. Le mode automatique (glouton, voir layout.js) remplit chaque ligne au plus
// large — pratique pour ne rien gâcher, mais un musicien qui veut une lecture RÉGULIÈRE d'un bout à
// l'autre (« toujours 4 mesures par ligne », comme un vrai carnet de tablatures) n'a aucun moyen de
// l'imposer. C'est ce que ce banc éprouve, à deux niveaux :
//   • le MOTEUR (`mettreEnPage({ mesuresParLigne })`) : le compte demandé est honoré tel quel tant
//     qu'il reste lisible, et cède la place — une mesure à la fois, jamais toutes d'un coup — dès
//     qu'il ne l'est plus. C'est ce dernier point qui répond à « adapter selon la signature
//     rythmique » : une ligne de mesures denses (beaucoup de notes, cases à deux chiffres) a
//     objectivement besoin de plus de place qu'une ligne de rondes, et la largeur MESURÉE de chaque
//     mesure (voir calculerColonnes) porte déjà cette information — nul besoin d'une règle séparée
//     qui lirait le chiffrage rythmique.
//   • L'INTERFACE (`#champ-mesures-ligne`) : le sélecteur change réellement la mise en page, et le
//     choix survit à un rechargement — c'est une préférence d'AFFICHAGE, gardée en local, jamais
//     écrite dans le .json (rouvrir le même morceau ailleurs doit retomber sur « Auto »).

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('mesures par ligne');

(async () => {
    plan(20);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // --- Le moteur, hors interface : tous les cas au même endroit, une seule mise en page par cas ---
        const r = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const L = await import('/src/engine/layout.js');

            const mesureSimple = () => m.creerMesure({
                voix: [{ evenements: [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)])) }],
            });
            // Une mesure DENSE : seize doubles-croches, sur des cases à deux chiffres — largement
            // plus large, à la mesure, qu'une mesure de quatre noires (voir layout.js, largeurColonne :
            // l'espacement proportionnel ET le plancher matériel des cases à deux chiffres jouent tous
            // les deux en sa faveur).
            const mesureDense = () => m.creerMesure({
                voix: [{ evenements: Array.from({ length: 16 }, (_, i) => m.creerEvenement({ valeur: 16 }, [m.creerNote(0, 10 + (i % 8))])) }],
            });
            const partitionDe = (n, fabrique) => {
                const p = m.creerPartition('guitare');
                p.mesures = Array.from({ length: n }, fabrique);
                return p;
            };
            const compteParSysteme = (pg) => {
                const parSys = new Map();
                for (const a of pg.ancrages.mesures) parSys.set(a.systeme, (parSys.get(a.systeme) || 0) + 1);
                return [...parSys.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
            };
            const largeurSysteme = (pg, iSys) => {
                const as = pg.ancrages.mesures.filter(a => a.systeme === iSys);
                return Math.max(...as.map(a => a.xFin)) - Math.min(...as.map(a => a.x));
            };

            // 1. Huit mesures simples, 4/ligne, page large : deux systèmes de 4, chacun étiré à la
            //    largeur utile (justification normale, non-dernier système).
            const page1 = L.mettreEnPage(partitionDe(8, mesureSimple), { largeurPage: 1100, S: 10, mesuresParLigne: 4 });

            // 2. Sept mesures, 4/ligne : le reliquat (3) n'est pas comblé de force jusqu'à 4.
            const page2 = L.mettreEnPage(partitionDe(7, mesureSimple), { largeurPage: 1100, S: 10, mesuresParLigne: 4 });

            // 3. MÊME largeur de page, MÊME compte demandé (6) : du contenu simple tient tel quel,
            //    du contenu dense doit se replier tout seul — la preuve que l'adaptation suit le
            //    CONTENU réellement mesuré, pas un chiffre codé en dur.
            const page3s = L.mettreEnPage(partitionDe(6, mesureSimple), { largeurPage: 1100, S: 10, mesuresParLigne: 6 });
            const page3d = L.mettreEnPage(partitionDe(6, mesureDense), { largeurPage: 1100, S: 10, mesuresParLigne: 6 });

            // 4. Une mesure ISOLÉE, aussi dense soit-elle et aussi étroite que soit la page, doit
            //    tout de même être posée — le plancher du repli est 1, jamais 0.
            const page4 = L.mettreEnPage(partitionDe(1, mesureDense), { largeurPage: 300, S: 10, mesuresParLigne: 6 });

            // 5. « Auto » (mesuresParLigne: null, ce qu'envoie l'appli pour « 0 ») garde son compte
            //    variable habituel — le glouton n'est pas affecté par ce nouveau mode.
            const pageAuto = L.mettreEnPage(partitionDe(8, mesureSimple), { largeurPage: 1100, S: 10, mesuresParLigne: null });

            // 6. Compte demandé trop grand pour le contenu (2 mesures, 8 demandées) : la ligne reste
            //    seule (rien à répartir), et le garde-fou anti-étirement démesuré (>2,5×, voir l'étape
            //    3 de layout.js) s'applique comme en mode automatique — pas de notes écartées d'un
            //    bout à l'autre de la page pour deux mesures clairsemées.
            const page6 = L.mettreEnPage(partitionDe(2, mesureSimple), { largeurPage: 1100, S: 10, mesuresParLigne: 8 });

            return {
                comptes1: compteParSysteme(page1), largeur1sys0: largeurSysteme(page1, 0), largeurUtile: 1100 - 34 - 22,
                comptes2: compteParSysteme(page2),
                comptes3s: compteParSysteme(page3s), comptes3d: compteParSysteme(page3d),
                comptes4: compteParSysteme(page4),
                comptesAuto: compteParSysteme(pageAuto),
                comptes6: compteParSysteme(page6), largeur6: page6.ancrages.systemes.length ? largeurSysteme(page6, 0) : 0,
            };
        });

        exiger(r.comptes1.length === 2, 'huit mesures simples à 4/ligne tiennent en deux systèmes');
        check(r.comptes1[0] === 4 && r.comptes1[1] === 4, 'exactement 4 mesures sur chacun des deux systèmes');
        check(Math.abs(r.largeur1sys0 - r.largeurUtile) < 1, 'un système non-dernier est étiré pour occuper toute la largeur utile');

        exiger(r.comptes2.length === 2, 'sept mesures à 4/ligne donnent bien deux systèmes');
        check(r.comptes2[0] === 4 && r.comptes2[1] === 3, 'le reliquat (3) n\'est pas comblé de force jusqu\'à 4');

        check(r.comptes3s.length === 1 && r.comptes3s[0] === 6, 'contenu simple : les 6 mesures/ligne demandées tiennent telles quelles');
        check(r.comptes3d.some(n => n < 6), 'contenu dense, MÊME largeur de page : le compte se replie tout seul pour rester lisible');
        check(r.comptes3d.reduce((a, b) => a + b, 0) === 6, 'et aucune mesure n\'est perdue dans le repli');

        exiger(r.comptes4.length === 1 && r.comptes4[0] === 1, 'une mesure isolée, aussi dense soit-elle, reste posée seule (plancher = 1, jamais 0)');

        check(r.comptesAuto[0] > 4, '"Auto" (mesuresParLigne: null) garde son compte variable, glouton, inchangé par ce mode');

        exiger(r.comptes6.length === 1 && r.comptes6[0] === 2, 'demander 8 mesures/ligne pour deux seulement ne perd ni n\'invente de mesure');
        check(r.largeur6 < r.largeurUtile * 0.7, 'et le garde-fou anti-étirement démesuré s\'applique : deux mesures clairsemées ne sont pas écartelées sur toute la page');

        // --- L'interface : le sélecteur pilote réellement le moteur, et son choix survit ------------
        const selecteur = await page.$('#champ-mesures-ligne');
        exiger(!!selecteur, 'le sélecteur « Mes./ligne » existe dans la barre de transport');
        check((await selecteur.inputValue()) === '0', 'et vaut « Auto » par défaut, brouillon vierge');

        // Huit mesures simples injectées directement, comme le fait le banc de tenue en charge —
        // de quoi observer un vrai regroupement par ligne, indépendamment de la largeur réelle de
        // la fenêtre d'essai.
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.partition.mesures = Array.from({ length: 8 }, () => m.creerMesure({
                voix: [{ evenements: [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)])) }],
            }));
            ed.prevenir('document');
        });
        await page.selectOption('#champ-mesures-ligne', '4');
        await page.waitForTimeout(150);

        const apres = await page.evaluate(() => {
            const parSys = new Map();
            for (const a of window.app.page.ancrages.mesures) parSys.set(a.systeme, (parSys.get(a.systeme) || 0) + 1);
            return {
                geo: window.app.page.geo.mesuresParLigne,
                comptes: [...parSys.values()],
                stocke: localStorage.getItem('tabhub.mesuresParLigne'),
            };
        });
        check(apres.geo === 4, 'choisir « 4 » dans le sélecteur atteint bien le moteur de mise en page (geo.mesuresParLigne)');
        check(apres.comptes.every(n => n <= 4) && apres.comptes.some(n => n === 4), 'et regroupe réellement les mesures par lignes de 4 au maximum');
        check(apres.stocke === '4', 'le choix est retenu en local (localStorage), pas seulement en mémoire');

        // Un rechargement retrouve le même choix — et lui seul : c'est une préférence d'AFFICHAGE,
        // jamais écrite dans le .json de la partition.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.app && window.app.page, null, { timeout: 20000 });
        await page.waitForTimeout(200);
        const apresRechargement = await page.evaluate(() => ({
            valeurSelecteur: document.getElementById('champ-mesures-ligne').value,
            mesuresParLigne: window.app.mesuresParLigne,
            dansLeJson: JSON.stringify(window.app.editeur.partition).includes('mesuresParLigne'),
        }));
        check(apresRechargement.valeurSelecteur === '4' && apresRechargement.mesuresParLigne === 4, 'le choix survit au rechargement de la page');
        check(!apresRechargement.dansLeJson, 'sans jamais se glisser dans le modèle de la partition (le .json reste indépendant de l\'affichage)');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
