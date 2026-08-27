// Banc du PIANO — mise en page grand-portée (clé de sol + clé de fa), PREMIER JALON du chantier.
//
// CE QUE CE BANC PROTÈGE. Ce jalon ne pose QUE la mise en page : aucune note ne s'affiche encore
// (la saisie directement sur la portée, et les deux voix, viennent ensuite — voir la tâche « Piano »
// du suivi). Ce qui doit déjà tenir, structurellement :
//   • mettreEnPage AIGUILLE vers un chemin dédié (mettreEnPagePiano) dès que l'instrument porte
//     `clef: 'grandPortee'`, sans jamais retomber dans les ~800 lignes pensées pour guitare/basse ;
//   • DEUX portées, la clé de fa TOUJOURS sous la clé de sol, reliées par UNE accolade ;
//   • clé, armure ET chiffrage se répètent sur les DEUX portées indépendamment (ce n'est jamais
//     partagé), à chaque début de système ou lors d'un changement — exactement la règle déjà
//     éprouvée pour guitare/basse (besoinsDe), reprise ici sous besoinsDePiano ;
//   • barres de mesure ET barres de reprise traversent les DEUX portées d'un seul trait — jamais deux
//     marques indépendantes comme le sont portée et TAB pour guitare/basse ;
//   • une mesure vide (aucune note, à ce stade TOUJOURS) se grave avec un silence de RONDE sur
//     chacune des deux portées, quel que soit son chiffrage réel ;
//   • le reste de l'application qui lit `ancrages.systemes` sans savoir qu'un piano n'a pas de TAB
//     (la bande de boucle, notamment — voir `yBas`, le champ générique qui les réconcilie) ne
//     casse pas silencieusement (coordonnées NaN) quand la partition courante est un piano.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('piano — mise en page');

(async () => {
    plan(28);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // --- Moteur, hors interface : tout au même endroit, comme mesures_par_ligne_test.js ---------
        const r = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const L = await import('/src/engine/layout.js');
            const G = await import('/src/engine/glyphs.js');

            const compter = (prims, nom) => prims.filter(p => p.t === 'glyphe' && p.nom === nom).length;

            const sortie = {};

            // --- Cas 1 : le brouillon piano par défaut (4 mesures vides, 4/4, un seul système). -----
            try {
                const p1 = m.creerPartition('piano');
                const page1 = L.mettreEnPage(p1, { largeurPage: 1100, S: 8 });
                const sys0 = page1.ancrages.systemes[0];
                const mesures1 = page1.ancrages.mesures;
                const accoladeOk = page1.primitives.some(p =>
                    p.t === 'ligne' && Math.abs(p.x1 - sys0.xDebut) < 0.01 && Math.abs(p.x2 - sys0.xDebut) < 0.01
                    && Math.abs(p.y1 - sys0.yPortee) < 0.01 && Math.abs(p.y2 - sys0.yBas) < 0.01);
                sortie.cas1 = {
                    ok: true,
                    grandPortee: page1.geo.grandPortee === true,
                    ordreStaves: sys0.yPortee < sys0.yPorteeFa,
                    yBasExact: Math.abs(sys0.yBas - (sys0.yPorteeFa + page1.geo.hauteurPortee)) < 0.001,
                    nCleSol: compter(page1.primitives, G.CLE_SOL.nom),
                    nCleFa: compter(page1.primitives, G.CLE_FA.nom),
                    nSilenceRonde: compter(page1.primitives, G.SILENCES[1].nom),
                    accoladeOk,
                    nMesures: mesures1.length,
                    contigu: mesures1.every((a, i) => i === 0 || Math.abs(a.x - mesures1[i - 1].xFin) < 0.01),
                    placeNotes: mesures1.every(a => a.xNotes >= a.x - 0.001 && a.xFin > a.xNotes - 0.001),
                };
            } catch (e) {
                sortie.cas1 = { ok: false, err: e.stack || String(e) };
            }

            // --- Cas 2 : 12 mesures à 4/ligne (3 systèmes), 3/4 au départ, armure +2 (Ré M.) à la
            // mesure 3 (index 2), reprise ouvrante à la mesure 5 (index 4) et fermante à la mesure 8
            // (index 7) — de quoi éprouver ensemble découpage, répétition d'en-tête et reprises. ------
            try {
                const p2 = m.creerPartition('piano');
                p2.mesures = [];
                for (let i = 0; i < 12; i++) {
                    p2.mesures.push(m.creerMesure({
                        signature: i === 0 ? { battements: 3, unite: 4 } : null,
                        armure: i === 2 ? 2 : null,
                        repriseDebut: i === 4,
                        repriseFin: i === 7,
                    }));
                }
                const page2 = L.mettreEnPage(p2, { largeurPage: 1100, S: 8, mesuresParLigne: 4 });
                const systemes = page2.ancrages.systemes;
                const mesures2 = page2.ancrages.mesures;
                const barreComplete = (iMesure) => {
                    const a = mesures2[iMesure];
                    const sys = systemes[a.systeme];
                    return page2.primitives.some(p => p.t === 'ligne'
                        && Math.abs(p.x1 - a.xFin) < 0.01 && Math.abs(p.x2 - a.xFin) < 0.01
                        && Math.abs(p.y1 - sys.yPortee) < 0.01 && Math.abs(p.y2 - sys.yBas) < 0.01);
                };
                sortie.cas2 = {
                    ok: true,
                    nSystemes: systemes.length,
                    yCroissant: systemes.every((s, i) => i === 0 || s.y > systemes[i - 1].y),
                    nCleSol: compter(page2.primitives, G.CLE_SOL.nom),
                    nCleFa: compter(page2.primitives, G.CLE_FA.nom),
                    nDiese: compter(page2.primitives, G.DIESE.nom),
                    nPoint: compter(page2.primitives, G.POINT.nom),
                    nSilenceRonde: compter(page2.primitives, G.SILENCES[1].nom),
                    barreMesure0: barreComplete(0),
                    barreMesure9: barreComplete(9),
                };
            } catch (e) {
                sortie.cas2 = { ok: false, err: e.stack || String(e) };
            }

            // --- Cas 3 : basculer un morceau guitare AVEC notes vers piano (Editeur réel). ----------
            try {
                const Ed = await import('/src/edit/commands.js');
                const pg = m.creerPartition('guitare');
                pg.mesures[0].voix[0].evenements[0].notes.push(m.creerNote(0, 3));
                const ed = new Ed.Editeur(pg);
                ed.definirInstrument('piano');
                const pagePiano = L.mettreEnPage(ed.partition, { largeurPage: 1100, S: 8 });
                sortie.cas3 = {
                    ok: true,
                    instrument: ed.partition.piste.instrument,
                    notesRestantes: ed.partition.mesures[0].voix[0].evenements[0].notes.length,
                    largeurFinie: Number.isFinite(pagePiano.largeur) && pagePiano.largeur > 0,
                    hauteurFinie: Number.isFinite(pagePiano.hauteur) && pagePiano.hauteur > 0,
                };
            } catch (e) {
                sortie.cas3 = { ok: false, err: e.stack || String(e) };
            }

            // --- Cas 4 : export PDF (sans déclencher le téléchargement — construirePdf seul). -------
            try {
                const { construirePdf } = await import('/src/io/pdf.js');
                const p4 = m.creerPartition('piano');
                const { nbPages } = construirePdf(p4);
                sortie.cas4 = { ok: true, nbPages };
            } catch (e) {
                sortie.cas4 = { ok: false, err: e.stack || String(e) };
            }

            return sortie;
        });

        // --- 1. Cas 1 : brouillon par défaut --------------------------------------------------------
        exiger(r.cas1.ok, 'cas 1 (brouillon piano) se met en page sans exception' + (r.cas1.ok ? '' : ' — ' + r.cas1.err));
        if (r.cas1.ok) {
            check(r.cas1.grandPortee, 'mettreEnPage aiguille vers le chemin grand-portée (geo.grandPortee)');
            check(r.cas1.ordreStaves, 'la portée de fa est bien SOUS la portée de sol');
            check(r.cas1.yBasExact, '`yBas` (générique, lu par la bande de boucle) vaut exactement le bas de la portée de fa');
            check(r.cas1.nCleSol === 1 && r.cas1.nCleFa === 1, 'les DEUX clés Bravura sont posées, chacune une fois (un seul système)');
            check(r.cas1.nSilenceRonde === r.cas1.nMesures * 2, 'un silence de RONDE par portée et par mesure vide (jamais le découpage réel en figures)');
            check(r.cas1.accoladeOk, 'une accolade relie les deux portées, du haut de la portée de sol au bas de celle de fa');
            check(r.cas1.contigu, 'les mesures se suivent sans blanc ni chevauchement');
            check(r.cas1.placeNotes, 'chaque mesure réserve une zone de notes après son en-tête (xNotes entre x et xFin)');
        }

        // --- 2. Cas 2 : plusieurs systèmes, armure, reprises ----------------------------------------
        exiger(r.cas2.ok, 'cas 2 (12 mesures, armure, reprises) se met en page sans exception' + (r.cas2.ok ? '' : ' — ' + r.cas2.err));
        if (r.cas2.ok) {
            exiger(r.cas2.nSystemes === 3, '12 mesures à 4/ligne donnent bien 3 systèmes');
            check(r.cas2.yCroissant, 'les systèmes s\'empilent strictement (jamais de chevauchement vertical)');
            check(r.cas2.nCleSol === 3 && r.cas2.nCleFa === 3, 'la clé se répète UNE fois par système, sur les DEUX portées (3 systèmes = 3 + 3)');
            check(r.cas2.nDiese === 12, 'armure à 2 dièses, montrée 3 fois (mesure du changement + 2 débuts de système), sur les DEUX portées : 3 × 2 × 2 = 12');
            check(r.cas2.nPoint === 8, 'reprise ouvrante ET fermante, 4 points chacune (2 par portée) : 8 au total');
            check(r.cas2.nSilenceRonde === 12 * 2, 'un silence de ronde par portée, sur les 12 mesures');
            check(r.cas2.barreMesure0, 'la barre de mesure ordinaire traverse les DEUX portées d\'un seul trait (système 1)');
            check(r.cas2.barreMesure9, 'et pareil dans un système différent (système 3), pas seulement le premier');
        }

        // --- 3. Cas 3 : basculer un morceau existant vers piano -------------------------------------
        exiger(r.cas3.ok, 'cas 3 (guitare → piano via definirInstrument) ne lève pas d\'exception' + (r.cas3.ok ? '' : ' — ' + r.cas3.err));
        if (r.cas3.ok) {
            check(r.cas3.instrument === 'piano', 'l\'instrument de la piste passe bien à piano');
            check(r.cas3.notesRestantes === 0, 'les notes existantes (hors de portée sans corde ni case) sont retirées, pas laissées orphelines');
            check(r.cas3.largeurFinie && r.cas3.hauteurFinie, 'la partition ainsi convertie se remet en page avec des dimensions finies');
        }

        // --- 4. Cas 4 : export PDF ne casse pas non plus --------------------------------------------
        exiger(r.cas4.ok, 'construirePdf accepte une partition piano sans exception' + (r.cas4.ok ? '' : ' — ' + r.cas4.err));
        if (r.cas4.ok) check(r.cas4.nbPages >= 1, 'et produit au moins une page');

        // --- Interface : Piano sélectionnable dans les Réglages, et la bande de boucle survit -------
        // remplirReglages() ne peuple le <select> QUE quand la fenêtre s'ouvre (voir main.js#btn-
        // reglages) : le lire avant ce clic donnerait un <select> vide et ferait échouer le banc pour
        // une mauvaise raison.
        await page.click('#btn-reglages');
        await page.waitForTimeout(100);
        const optionPiano = await page.evaluate(() => {
            const opt = [...document.getElementById('champ-instrument').options].find(o => o.value === 'piano');
            return opt ? opt.textContent : null;
        });
        check(optionPiano === 'Piano', '« Piano » apparaît dans la liste déroulante des instruments (Réglages)');

        const apresBascule = await page.evaluate(() => {
            document.getElementById('champ-instrument').value = 'piano';
            document.getElementById('champ-instrument').dispatchEvent(new Event('change'));
            return {
                instrument: window.app.editeur.partition.piste.instrument,
                grandPortee: !!window.app.page?.geo?.grandPortee,
            };
        });
        check(apresBascule.instrument === 'piano' && apresBascule.grandPortee, 'choisir « Piano » dans les Réglages bascule réellement l\'instrument et redessine en grand-portée');

        const marques = await page.evaluate(() => window.app.marquesBoucle());
        check(Array.isArray(marques) && marques.length > 0 && marques.every(mk => Number.isFinite(mk.y) && Number.isFinite(mk.h)),
            'la bande de boucle (sous la grille) reste calculable pour un piano — jamais de coordonnée NaN faute de TAB');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
