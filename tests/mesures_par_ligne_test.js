// Banc du CONTRÔLE « MESURES PAR LIGNE » + LARGEUR DE MESURE FIXE.
//
// CE QU'IL PROTÈGE. Le mode automatique (glouton, voir layout.js) remplit chaque ligne au plus
// large — pratique pour ne rien gâcher, mais un musicien qui veut une lecture RÉGULIÈRE d'un bout à
// l'autre (« toujours 4 mesures par ligne », comme un vrai carnet de tablatures) n'a aucun moyen de
// l'imposer. C'est ce que ce banc éprouve, à trois niveaux :
//   • le MOTEUR (`mettreEnPage({ mesuresParLigne })`) : le compte demandé est TOUJOURS honoré tel
//     quel, même si le système déborde la largeur utile — la page grandit alors pour l'accueillir
//     plutôt que de réduire discrètement le compte (voir mettreEnPage et `.zone-partition
//     { overflow: auto }`) : un choix explicite ne doit jamais s'effacer faute de place, justement
//     là où il sert le plus (un téléphone étroit).
//   • LA LARGEUR ELLE-MÊME (voir layout.js, LARGEUR_PAR_NOIRE) : deux mesures de MÊME signature ont
//     TOUJOURS exactement la même largeur, qu'elles soient denses (rafale de doubles-croches) ou
//     vides (un silence) — la largeur ne dépend QUE de la capacité rythmique, jamais du contenu. Un
//     changement de signature en cours de morceau donne des largeurs de note PROPORTIONNELLES aux
//     capacités respectives (3/4 fait les 3/4 d'une 4/4), jamais un rapport qui dépendrait de ce qui
//     s'y joue. Aucun système n'est plus étiré pour combler la ligne (voir l'étape 3, désormais
//     `facteur: 1` partout) : une ligne incomplète laisse du blanc à droite plutôt que de fausser
//     cette égalité.
//   • L'INTERFACE (le rang de boutons `.btn-mesures-ligne`, plus un menu déroulant) : cliquer un
//     bouton change réellement la mise en page, et le choix survit à un rechargement — c'est une
//     préférence d'AFFICHAGE, gardée en local, jamais écrite dans le .json (rouvrir le même morceau
//     ailleurs doit retomber sur « Auto »).

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('mesures par ligne');

(async () => {
    plan(29);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // --- Le moteur, hors interface : tous les cas au même endroit, une seule mise en page par cas ---
        const r = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const L = await import('/src/engine/layout.js');

            const mesureSimple = () => m.creerMesure({
                voix: [{ evenements: [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)])) }],
            });
            const mesureVide = () => m.creerMesure({ voix: [{ evenements: [m.creerEvenement({ valeur: 1 }, [])] }] });
            // Une mesure DENSE : seize doubles-croches, sur des cases à deux chiffres — qui n'a
            // désormais plus le droit d'être plus LARGE qu'une mesure simple de même signature (voir
            // le cas « contenu n'affecte plus la largeur » plus bas) : seule sa lisibilité INTERNE
            // (l'espacement relatif de ses propres colonnes, inchangé) absorbe la différence.
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
            const largeurMesure = (pg, i) => { const a = pg.ancrages.mesures[i]; return a.xFin - a.x; };

            // 1. Huit mesures simples, 4/ligne, page large : deux systèmes de 4. Chacun garde SA
            //    largeur naturelle (plus de justification, voir l'étape 3) : seule la toute première
            //    mesure du MORCEAU affiche la signature (voir besoinsDe), les deux systèmes n'ont donc
            //    pas exactement la même largeur totale — mais leurs mesures NON-première-de-système
            //    (même contenu, aucun en-tête) doivent, elles, être rigoureusement identiques.
            const page1 = L.mettreEnPage(partitionDe(8, mesureSimple), { largeurPage: 1100, S: 10, mesuresParLigne: 4 });

            // 2. Sept mesures, 4/ligne : le reliquat (3) n'est pas comblé de force jusqu'à 4.
            const page2 = L.mettreEnPage(partitionDe(7, mesureSimple), { largeurPage: 1100, S: 10, mesuresParLigne: 4 });

            // 3. MÊME largeur de page, MÊME compte demandé (6) : contenu simple et contenu dense
            //    doivent désormais se replier EXACTEMENT PAREIL — la preuve que le repli suit la seule
            //    CAPACITÉ rythmique (identique ici, 4/4 des deux côtés), plus jamais la densité réelle.
            const page3s = L.mettreEnPage(partitionDe(6, mesureSimple), { largeurPage: 1100, S: 10, mesuresParLigne: 6 });
            const page3d = L.mettreEnPage(partitionDe(6, mesureDense), { largeurPage: 1100, S: 10, mesuresParLigne: 6 });

            // 4. Une mesure ISOLÉE, aussi dense soit-elle et aussi étroite que soit la page, doit
            //    tout de même être posée — le plancher du repli est 1, jamais 0.
            const page4 = L.mettreEnPage(partitionDe(1, mesureDense), { largeurPage: 300, S: 10, mesuresParLigne: 6 });

            // 5. « Auto » (mesuresParLigne: null) : toujours glouton, calculé sur la largeur RÉELLE
            //    disponible — une page deux fois plus étroite doit accueillir moins de mesures/ligne.
            //    C'est la preuve que le compte est bien recalculé, pas figé par ce nouveau mode.
            const pageAutoLarge = L.mettreEnPage(partitionDe(8, mesureSimple), { largeurPage: 1100, S: 10, mesuresParLigne: null });
            const pageAutoEtroit = L.mettreEnPage(partitionDe(8, mesureSimple), { largeurPage: 600, S: 10, mesuresParLigne: null });

            // 6. Compte demandé trop grand pour le contenu (2 mesures, 8 demandées) : la ligne reste
            //    seule (rien à répartir), et n'est plus jamais étirée pour autant — deux mesures
            //    clairsemées gardent leur largeur naturelle, point.
            const page6 = L.mettreEnPage(partitionDe(2, mesureSimple), { largeurPage: 1100, S: 10, mesuresParLigne: 8 });

            // 7. LARGEUR FIXE PAR SIGNATURE, INDÉPENDANTE DU CONTENU : une simple, une dense, une
            //    vide, toutes à 4/4, aucune en tête de système (donc sans en-tête) → même largeur.
            const pMix = m.creerPartition('guitare');
            pMix.mesures = [mesureSimple(), mesureDense(), mesureVide(), mesureSimple()];
            const pageMix = L.mettreEnPage(pMix, { largeurPage: 1100, S: 10, mesuresParLigne: 4 });

            // 8. CHANGEMENT DE SIGNATURE EN COURS DE MORCEAU : la largeur RELATIVE doit rester
            //    cohérente avec la capacité — comparée ici via `largeurNotes` (voir l'ancrage de
            //    mesure), qui exclut l'en-tête et n'est donc jamais faussée par lui.
            const pSig = m.creerPartition('guitare');
            pSig.mesures = [mesureVide(), mesureVide()];
            pSig.mesures[1].signature = { battements: 3, unite: 4 };
            const pageSig = L.mettreEnPage(pSig, { largeurPage: 1100, S: 10, mesuresParLigne: 2 });

            // 9. Page ABSURDEMENT étroite (plus étroite qu'une seule mesure, même vide) : le compte
            //    demandé n'est PLUS JAMAIS réduit à cause de la largeur — c'est justement ce que ce
            //    réglage promet (retour utilisateur : « sur téléphone, je peux voir uniquement une
            //    mesure en horizontal... je veux définir le nombre de mesures visibles par ligne »).
            //    Une version antérieure réduisait le compte jusqu'à ce que ça tienne dans la largeur
            //    utile ; ici, ça ne tiendrait jamais (largeur utile ridicule), donc l'ancien
            //    comportement aurait posé six systèmes d'UNE seule mesure — exactement le cas d'un
            //    téléphone, là où ce réglage sert le plus. Le système déborde maintenant franchement
            //    plutôt que d'être rétréci (voir mettreEnPage : la page grandit pour l'accueillir, et
            //    `.zone-partition { overflow: auto }` la rend atteignable au défilement).
            const page9 = L.mettreEnPage(partitionDe(6, mesureSimple), { largeurPage: 60, S: 10, mesuresParLigne: 3 });

            return {
                comptes1: compteParSysteme(page1),
                largeurNonPremiere1: largeurMesure(page1, 1), largeurNonPremiere5: largeurMesure(page1, 5),
                largeurUtile: 1100 - 34 - 22,
                largeurSysteme1: largeurSysteme(page1, 0),
                ancrageSysteme1: page1.ancrages.systemes[0].xFin - page1.ancrages.systemes[0].xDebut,
                comptes2: compteParSysteme(page2),
                comptes3s: compteParSysteme(page3s), comptes3d: compteParSysteme(page3d),
                comptes4: compteParSysteme(page4),
                comptesAutoLarge: compteParSysteme(pageAutoLarge), comptesAutoEtroit: compteParSysteme(pageAutoEtroit),
                comptes6: compteParSysteme(page6), largeur6: page6.ancrages.systemes.length ? largeurSysteme(page6, 0) : 0,
                largeursMix: pageMix.ancrages.mesures.map((_, i) => largeurMesure(pageMix, i)),
                capacitesSig: pageSig.ancrages.mesures.map(a => a.capacite),
                largeursNotesSig: pageSig.ancrages.mesures.map(a => a.largeurNotes),
                comptes9: compteParSysteme(page9),
                largeurUtile9: 60 - 34 - 22,
                largeurSysteme9: page9.ancrages.systemes.length ? largeurSysteme(page9, 0) : 0,
            };
        });

        exiger(r.comptes1.length === 2, 'huit mesures simples à 4/ligne tiennent en deux systèmes');
        check(r.comptes1[0] === 4 && r.comptes1[1] === 4, 'exactement 4 mesures sur chacun des deux systèmes');
        check(Math.abs(r.largeurNonPremiere1 - r.largeurNonPremiere5) < 0.01,
            'deux mesures identiques sans en-tête (ni première de système, ni première du morceau) ont EXACTEMENT la même largeur');
        check(Math.abs(r.largeurSysteme1 - r.largeurUtile) > 1 && Math.abs(r.ancrageSysteme1 - r.largeurSysteme1) < 0.01,
            'un système qui n\'épuise pas la largeur utile (mesures fixes, non étirées) voit ses lignes de portée/TAB/réglette s\'arrêter à sa dernière mesure, pas continuer dans le vide jusqu\'au bord de la page (ce qui dessinerait une fausse mesure vide)');

        exiger(r.comptes2.length === 2, 'sept mesures à 4/ligne donnent bien deux systèmes');
        check(r.comptes2[0] === 4 && r.comptes2[1] === 3, 'le reliquat (3) n\'est pas comblé de force jusqu\'à 4');

        check(r.comptes3s.join(',') === r.comptes3d.join(','),
            'même signature (4/4) : contenu simple et contenu dense se replient à l\'IDENTIQUE, plus jamais selon la densité');
        check(r.comptes3d.reduce((a, b) => a + b, 0) === 6, 'et aucune mesure n\'est perdue dans le repli');

        exiger(r.comptes4.length === 1 && r.comptes4[0] === 1, 'une mesure isolée, aussi dense soit-elle, reste posée seule (plancher = 1, jamais 0)');

        exiger(r.comptesAutoLarge.reduce((a, b) => a + b, 0) === 8 && r.comptesAutoEtroit.reduce((a, b) => a + b, 0) === 8,
            '"Auto" ne perd aucune mesure, page large ou étroite');
        check(r.comptesAutoEtroit[0] < r.comptesAutoLarge[0],
            'et une page deux fois plus étroite accueille bien MOINS de mesures par ligne : le compte est recalculé, pas figé');

        exiger(r.comptes6.length === 1 && r.comptes6[0] === 2, 'demander 8 mesures/ligne pour deux seulement ne perd ni n\'invente de mesure');
        check(r.largeur6 < r.largeurUtile * 0.7, 'et deux mesures clairsemées ne sont plus jamais écartelées sur toute la page (aucune justification)');

        check(Math.abs(r.largeursMix[1] - r.largeursMix[2]) < 0.01 && Math.abs(r.largeursMix[2] - r.largeursMix[3]) < 0.01,
            'LARGEUR FIXE : simple, dense et vide, même signature (4/4), même largeur à l\'épaisseur de calcul flottant près');

        exiger(r.capacitesSig[0] === 4 && r.capacitesSig[1] === 3, 'la seconde mesure passe bien à 3/4 (capacité 3, contre 4)');
        check(Math.abs(r.largeursNotesSig[1] / r.largeursNotesSig[0] - 0.75) < 1e-6,
            'CHANGEMENT DE SIGNATURE : la largeur de note d\'une mesure à 3/4 fait exactement les 3/4 de celle d\'une mesure à 4/4 (même LARGEUR_PAR_NOIRE)');

        exiger(r.comptes9.join(',') === '3,3', '9. page bien plus étroite qu\'une seule mesure, 3 demandées : toujours deux systèmes de 3 (plus jamais réduit à 1 faute de place)');
        check(r.largeurSysteme9 > r.largeurUtile9, 'et le système déborde franchement la largeur utile plutôt que d\'y être rétréci (la page grandit pour l\'accueillir, voir mettreEnPage)');

        // --- L'interface : le rang de boutons (plus un menu déroulant, voir main.js#construireBoutons
        // MesuresLigne) pilote réellement le moteur, et son choix survit --------------------------
        const texteBoutons = () => page.evaluate(() =>
            [...document.querySelectorAll('.btn-mesures-ligne')].map(b => ({ texte: b.textContent, actif: b.classList.contains('actif') })));
        const cliquerBouton = (texte) => page.evaluate((texte) => {
            document.querySelectorAll('.btn-mesures-ligne').forEach(b => { if (b.textContent === texte) b.click(); });
        }, texte);

        exiger(await page.$('#groupe-mesures-ligne') !== null, 'le rang de boutons « Mesures par ligne » existe dans la barre de transport');
        const boutonsInitiaux = await texteBoutons();
        check(boutonsInitiaux.map(b => b.texte).join(',') === 'Auto,2,3,4,6,8', 'six choix proposés : Auto, 2, 3, 4, 6, 8 — plus de menu cachant ses valeurs');
        check(boutonsInitiaux.find(b => b.texte === 'Auto').actif === true, 'et « Auto » porte seul la classe actif par défaut, brouillon vierge');
        check(await page.evaluate(() => !document.getElementById('champ-zoom')), 'le curseur de zoom a disparu (redondant avec ce rang de boutons, mis en avant à sa place)');

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
        await cliquerBouton('4');
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
        check(apres.geo === 4, 'cliquer « 4 » atteint bien le moteur de mise en page (geo.mesuresParLigne)');
        check(apres.comptes.every(n => n <= 4) && apres.comptes.some(n => n === 4), 'et regroupe réellement les mesures par lignes de 4 au maximum');
        check(apres.stocke === '4', 'le choix est retenu en local (localStorage), pas seulement en mémoire');
        const boutonsApres = await texteBoutons();
        check(boutonsApres.find(b => b.texte === '4').actif === true && boutonsApres.filter(b => b.actif).length === 1,
            'et SEUL le bouton « 4 » porte désormais la classe actif (jamais deux à la fois)');

        // Un rechargement retrouve le même choix — et lui seul : c'est une préférence d'AFFICHAGE,
        // jamais écrite dans le .json de la partition.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.app && window.app.page, null, { timeout: 20000 });
        await page.waitForTimeout(200);
        const apresRechargement = await page.evaluate(() => ({
            boutonActif: document.querySelector('.btn-mesures-ligne.actif')?.textContent,
            mesuresParLigne: window.app.mesuresParLigne,
            dansLeJson: JSON.stringify(window.app.editeur.partition).includes('mesuresParLigne'),
        }));
        check(apresRechargement.boutonActif === '4' && apresRechargement.mesuresParLigne === 4, 'le choix survit au rechargement de la page');
        check(!apresRechargement.dansLeJson, 'sans jamais se glisser dans le modèle de la partition (le .json reste indépendant de l\'affichage)');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
