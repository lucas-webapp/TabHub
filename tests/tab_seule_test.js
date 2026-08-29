// Banc du mode « TAB SEULE » — masquer la portée de notation, rythme reporté directement sur la TAB.
//
// CE QU'IL PROTÈGE. Retour utilisateur : « ajouter une option pour visualiser uniquement la portée
// de tablature, sans la partition [...] le rythme doit être visible sur la portée de la tablature
// directement » — la même convention que Guitar Pro en vue TAB seule (hampes/crochets/ligatures
// directement au-dessus des chiffres de tablature, plutôt qu'une portée devenue inutile). Ce banc
// éprouve :
//   • le MOTEUR (`mettreEnPage({ avecPortee: false })`, engine/layout.js) : la portée (5 lignes, clé)
//     disparaît ; la TAB, elle, reste identique (mêmes chiffres, mêmes hammer-on/pull-off/slide/palm
//     mute, déjà 100% relatifs à la TAB) ; les hampes rejoignent une ANCRE juste au-dessus OU en
//     dessous de la TAB, jamais une hauteur réelle qui n'existe plus ; la signature rythmique reste
//     affichée (le rythme se lit toujours par rapport à un chiffrage) ; la page RÉTRÉCIT (l'espace
//     d'une portée à 5 lignes n'est plus réservé) ;
//   • LE SENS DE CHAQUE HAMPE (retour utilisateur, capture à l'appui : « les barres doivent pouvoir
//     descendre [...] comme pour une vraie partition ») suit la MÊME règle que sur la portée — la
//     CORDE la plus éloignée du milieu du manche décide (aiguë -> bas, grave -> haut, égalité -> bas),
//     jamais un sens unique et fixe pour toute la voix — sauf à DEUX voix, où c'est encore la voix qui
//     décide (mélodie toujours en haut, basse toujours en bas), exactement comme sur la portée ;
//   • L'INTERFACE (Réglages) : un interrupteur, masqué au piano (qui n'a pas de TAB), qui bascule le
//     rendu à l'écran ET au PDF (même liste d'affichage partagée) ; c'est une préférence d'AFFICHAGE
//     comme les autres (mesuresParLigne, positionOutils…) — locale au navigateur, jamais dans le
//     .json de la partition.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('TAB seule');

(async () => {
    plan(25);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // --- Le moteur, hors interface : un cas complet (rythme varié, silence, n-olet, liaison,
        // deux voix), comparé avec et sans portée --------------------------------------------------
        const r = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const L = await import('/src/engine/layout.js');

            const p = m.creerPartition('guitare');
            const noteAvecLien = m.creerNote(0, 5);
            noteAvecLien.lien = 'hammer';
            p.mesures = [
                m.creerMesure({ voix: [
                    { evenements: [
                        m.creerEvenement({ valeur: 8 }, [noteAvecLien]),
                        m.creerEvenement({ valeur: 8 }, [m.creerNote(0, 7)]),
                        m.creerEvenement({ valeur: 4, points: 1 }, [m.creerNote(0, 8)]),
                        m.creerEvenement({ valeur: 8 }, [], { silence: true }),
                    ] },
                    { evenements: [
                        m.creerEvenement({ valeur: 4 }, [m.creerNote(4, 3)]),
                        m.creerEvenement({ valeur: 2 }, [m.creerNote(4, 5)]),
                        m.creerEvenement({ valeur: 4 }, [], { silence: true }),
                    ] },
                ] }),
                m.creerMesure({ voix: [{ evenements: [
                    m.creerEvenement({ valeur: 8, nolet: { dans: 3, valent: 2 } }, [m.creerNote(1, 3)]),
                    m.creerEvenement({ valeur: 8, nolet: { dans: 3, valent: 2 } }, [m.creerNote(1, 5)]),
                    m.creerEvenement({ valeur: 8, nolet: { dans: 3, valent: 2 } }, [m.creerNote(1, 3)]),
                    m.creerEvenement({ valeur: 2 }, [], { silence: true }),
                ] }] }),
            ];

            const S = 12;
            const pageAvec = L.mettreEnPage(p, { S, largeurPage: 900, avecPortee: true });
            const pageSans = L.mettreEnPage(p, { S, largeurPage: 900, avecPortee: false });

            const compteLignesHorizontales = (pg) => pg.primitives.filter(pr =>
                pr.t === 'ligne' && pr.y1 === pr.y2 && !pr.classe).length;
            // /^cle(Sol|Fa)/ et non /^cle/ tout court : la clé de TAB (cleTab6/cleTab4, voir
            // poserCleTab) se dessine, elle, dans LES DEUX modes — seule la clé de NOTATION disparaît.
            const compteGlyphesClef = (pg) => pg.primitives.filter(pr => pr.t === 'glyphe' && /^cle(Sol|Fa)/.test(pr.nom || '')).length;
            const lignesVerticales = (pg) => pg.primitives.filter(pr => pr.t === 'ligne' && pr.x1 === pr.x2);

            return {
                hauteurAvec: pageAvec.hauteur, hauteurSans: pageSans.hauteur,
                lignesHorizAvec: compteLignesHorizontales(pageAvec), lignesHorizSans: compteLignesHorizontales(pageSans),
                clefsAvec: compteGlyphesClef(pageAvec), clefsSans: compteGlyphesClef(pageSans),
                nbChiffresTabSans: pageSans.primitives.filter(pr => pr.t === 'texte' && pr.police === 'sans-serif' && /^\d+$/.test(pr.s)).length,
                nbChiffresTabAvec: pageAvec.primitives.filter(pr => pr.t === 'texte' && pr.police === 'sans-serif' && /^\d+$/.test(pr.s)).length,
                hammerLabelSans: pageSans.primitives.some(pr => pr.t === 'texte' && pr.s === 'H'),
                hammerLabelAvec: pageAvec.primitives.some(pr => pr.t === 'texte' && pr.s === 'H'),
                signatureSans: pageSans.primitives.some(pr => pr.t === 'glyphe' && /^chiffre\d/.test(pr.nom || '')),
                // Deux voix : les hampes verticales de la voix 0 (mélodie, sensImpose -1) doivent
                // toutes finir AU-DESSUS de yTab, celles de la voix 1 (basse tenue, sensImpose +1)
                // toutes EN DESSOUS — jamais mélangées, jamais l'une chevauchant la TAB.
                yTabSys0: pageSans.ancrages.systemes[0].yTab,
                vertSans: lignesVerticales(pageSans).map(l => ({ y1: l.y1, y2: l.y2 })),
            };
        });

        // --- Le sens de CHAQUE hampe, à une seule voix : la corde décide, pas un sens fixe -----------
        const bidir = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const L = await import('/src/engine/layout.js');
            const S = 12;

            // Des NOIRES (jamais ligaturées entre elles, voir grouperLigatures : crochets === 0) pour
            // isoler le sens de CHAQUE hampe sans l'influence d'un groupe voisin.
            const p = m.creerPartition('guitare');   // 6 cordes, index 0 = la plus aiguë
            p.mesures = [m.creerMesure({ voix: [{ evenements: [
                m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 2)]),               // corde AIGÜE seule
                m.creerEvenement({ valeur: 4 }, [m.creerNote(5, 3)]),               // corde GRAVE seule
                m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 1), m.creerNote(5, 1)]),   // extrêmes symétriques -> égalité
                m.creerEvenement({ valeur: 4 }, [], { silence: true }),             // silence : rien à faire varier
            ] }] })];
            const pg = L.mettreEnPage(p, { S, largeurPage: 900, avecPortee: false });
            const sys = pg.ancrages.systemes[0];
            const evts = pg.ancrages.evenements.filter(a => a.mesure === 0 && a.voix === 0);
            const verts = pg.primitives.filter(pr => pr.t === 'ligne' && pr.x1 === pr.x2);
            // La hampe la plus proche en x de chaque évènement (elles ne sont jamais à plus de ~1 S).
            const hampeDe = (x) => verts.reduce((meilleure, v) =>
                Math.abs(v.x1 - x) < Math.abs((meilleure?.x1 ?? Infinity) - x) ? v : meilleure, null);
            const sensDe = (v) => !v ? null : (Math.max(v.y1, v.y2) <= sys.yTab + 1 ? 'haut' : (Math.min(v.y1, v.y2) >= sys.yTab - 1 ? 'bas' : 'chevauche'));

            return {
                yTab: sys.yTab,
                sensAigue: sensDe(hampeDe(evts[0].x)),
                sensGrave: sensDe(hampeDe(evts[1].x)),
                sensEgalite: sensDe(hampeDe(evts[2].x)),
                aUneHampeSurSilence: verts.some(v => Math.abs(v.x1 - evts[3].x) < 2 * S),
            };
        });

        check(r.hauteurSans < r.hauteurAvec, 'sans portée, la page est plus BASSE (l\'espace d\'une portée à 5 lignes n\'est plus réservé)');
        exiger(r.lignesHorizAvec >= 5 + 6, 'avec portée : au moins les 5 lignes de portée + les 6 de TAB (une mesure, une voix, un système)');
        // EXACTEMENT 6 (nbCordes) : pas seulement « 5 de moins qu'avec portée » — ce test utilise des
        // notes assez aiguës/graves pour réclamer des LIGNES SUPPLÉMENTAIRES (ledger lines) avec
        // portée, qui disparaissent elles aussi sans portée (voir poserLignesSupplementaires, jamais
        // appelée hors de la section Portée) : une différence de 5 seulement serait donc restée
        // fausse même en comptant juste, si ce compte-là avait changé sans que personne s'en aperçoive.
        check(r.lignesHorizSans === 6, 'sans portée : il ne reste QUE les 6 lignes de TAB — plus une seule ligne de portée, ni la moindre ligne supplémentaire');
        exiger(r.clefsAvec >= 1, 'avec portée : la clé se dessine (préalable du test suivant)');
        check(r.clefsSans === 0, 'sans portée : plus aucune clé (elle ne dit rien sans portée à lire)');
        check(r.nbChiffresTabSans === r.nbChiffresTabAvec, 'les chiffres de TAB eux-mêmes sont identiques, avec ou sans portée — rien n\'y change');
        check(r.hammerLabelSans === true && r.hammerLabelAvec === true,
            'le hammer-on (arc + « H », déjà 100% relatif à la TAB) se dessine dans LES DEUX modes, sans changement');
        check(r.signatureSans, 'la signature rythmique reste affichée sans portée — le rythme se lit toujours par rapport à un chiffrage');

        const yTab = r.yTabSys0;
        const auDessus = r.vertSans.filter(v => Math.max(v.y1, v.y2) <= yTab + 1);
        const enDessous = r.vertSans.filter(v => Math.min(v.y1, v.y2) >= yTab - 1);
        exiger(auDessus.length > 0 && enDessous.length > 0, 'deux voix, sans portée : des hampes existent bien des DEUX côtés de la TAB');
        check(auDessus.length + enDessous.length === r.vertSans.length,
            'et CHAQUE hampe verticale reste entièrement d\'un seul côté — jamais une qui chevauche la TAB elle-même');

        exiger(bidir.sensAigue === 'bas', 'à une seule voix, une note sur la corde la plus AIGÜE pousse sa hampe vers le BAS (comme sur la portée)');
        check(bidir.sensGrave === 'haut', 'et une note sur la corde la plus GRAVE la pousse vers le HAUT — plus un sens unique et fixe pour toute la voix');
        check(bidir.sensEgalite === 'bas', 'un accord aux deux cordes extrêmes (égalité) retombe sur le BAS — même convention que sur la portée');
        check(bidir.aUneHampeSurSilence === false, 'un silence, qui ne joue aucune corde, ne porte toujours aucune hampe (comme sur la portée)');

        // --- L'interface : Réglages, visibilité par instrument, bascule, persistance -----------------
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures = [m.creerMesure({ voix: [{ evenements: [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)])) }] })];
            ed.prevenir('document');
        });
        await page.waitForTimeout(150);

        await page.click('#btn-reglages');
        await page.waitForTimeout(150);
        exiger(!(await page.evaluate(() => document.getElementById('ligne-tab-seule').hidden)), 'guitare : l\'interrupteur « TAB seule » est visible dans Réglages');
        check((await page.evaluate(() => document.getElementById('champ-tab-seule').getAttribute('aria-checked'))) === 'false', 'et éteint par défaut');

        const avantClic = await page.evaluate(() => document.querySelectorAll('#feuille svg line').length);
        await page.click('#champ-tab-seule');
        await page.waitForTimeout(150);
        check((await page.evaluate(() => document.getElementById('champ-tab-seule').getAttribute('aria-checked'))) === 'true', 'cliquer l\'interrupteur l\'allume (aria-checked)');
        check((await page.evaluate(() => window.app.tabSeule)) === true, 'et bascule réellement l\'état de l\'application');
        const apresClic = await page.evaluate(() => document.querySelectorAll('#feuille svg line').length);
        check(apresClic < avantClic, 'et le SVG affiché a RÉELLEMENT moins de lignes qu\'avant (la portée a bien disparu à l\'écran)');
        check((await page.evaluate(() => localStorage.getItem('tabhub.tabSeule'))) === '1', 'persisté en local (comme mesuresParLigne/positionOutils)');

        const dansLeJson = await page.evaluate(() => JSON.stringify(window.app.editeur.partition).includes('tabSeule'));
        check(!dansLeJson, 'et ne se glisse pas dans le modèle de la partition (le .json reste indépendant de l\'affichage)');

        await page.click('[data-fermer]');
        await page.waitForTimeout(100);

        // Un rechargement retrouve le même choix, et lui seul.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.app && window.app.page, null, { timeout: 20000 });
        await page.waitForTimeout(200);
        check((await page.evaluate(() => window.app.tabSeule)) === true, 'le choix survit au rechargement de la page');

        // Piano : le réglage n'a plus aucun sens (pas de TAB) — masqué, jamais un interrupteur mort.
        await page.evaluate(() => window.app.editeur.definirInstrument('piano'));
        await page.waitForTimeout(150);
        await page.click('#btn-reglages');
        await page.waitForTimeout(150);
        check(await page.evaluate(() => document.getElementById('ligne-tab-seule').hidden), 'au piano, l\'interrupteur « TAB seule » reste masqué (pas de TAB à en priver)');
        const hauteurPagePiano = await page.evaluate(() => window.app.page.hauteur);
        check(Number.isFinite(hauteurPagePiano) && hauteurPagePiano > 0,
            'et le piano continue de se dessiner normalement (tabSeule=true en mémoire, mais sans le moindre effet là où il n\'y a pas de TAB)');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
