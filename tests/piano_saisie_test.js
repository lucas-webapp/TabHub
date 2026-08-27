// Banc de la SAISIE DIRECTE SUR LA PORTÉE PIANO — le second jalon du chantier piano, après la mise
// en page seule (voir piano_layout_test.js).
//
// CE QU'IL PROTÈGE. Avant ce jalon, un piano affichait une portée à deux clés STRUCTURELLEMENT
// correcte mais qui ne montrait JAMAIS aucune note : chaque mesure gravait un silence de ronde fixe,
// quoi qu'on y tape (voir engine/layout.js#poserMesurePiano, avant réécriture), et taper un CHIFFRE
// au clavier — le geste central de toute la saisie guitare/basse — posait une case fantôme SANS
// hauteur réelle (`corde:0, frette:N`, hauteurDeNote -> null, silencieuse et invisible à l'écran).
// Ce banc éprouve donc ce qui remplace ça :
//   • model/instruments.js#hauteurDeCase traite désormais `frette` comme la hauteur MIDI ABSOLUE
//     pour un accordage SANS cordes (le piano) — la même paire de champs que guitare/basse, jamais
//     un troisième champ à faire courir dans tout ce qui touche une note ;
//   • theory.js#hauteurDepuisPas, l'INVERSE d'ecrireHauteur : la hauteur qu'une POSITION diatonique
//     porte dans une armure donnée — ce qu'un clic sur une ligne précise doit retrouver ;
//   • le clic direct sur la portée (main.js#cibleDepuisClicPiano/clicPartition) POSE une note à la
//     hauteur voulue, ou la RETIRE si elle y est déjà (bascule) — jamais un simple déplacement de
//     curseur suivi d'un second geste, à la différence du clic sur une case de tablature ;
//   • cliquer sur la portée de FA quand la mesure n'a encore que la mélodie AJOUTE la voix
//     d'accompagnement toute seule, sans geste séparé ;
//   • un chiffre tapé au clavier sur piano n'écrit plus rien — et le dit, au lieu de se taire.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('piano — saisie sur la portée');

(async () => {
    plan(29);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // --- Logique pure : hauteurDeCase, hauteurDepuisPas, l'intégration jusqu'au glyphe -----------
        const r = await page.evaluate(async () => {
            const instr = await import('/src/model/instruments.js');
            const theory = await import('/src/model/theory.js');
            const m = await import('/src/model/score.js');
            const L = await import('/src/engine/layout.js');
            const G = await import('/src/engine/glyphs.js');

            const accordPiano = instr.ACCORDAGES.piano[0];   // { id:'aucun', cordes: [] }
            const accordGuitare = instr.ACCORDAGES.guitare.find(a => a.id === 'standard');

            // 1. hauteurDeCase : frette = hauteur absolue SEULEMENT pour un accordage sans cordes.
            const hCasePiano = instr.hauteurDeCase(accordPiano, 0, 60, 0);
            const hCaseGuitare = instr.hauteurDeCase(accordGuitare, 0, 60, 0);   // corde 0 = 64 (Mi aigu) + 60 = 124, PAS 60

            // 2. hauteurDeNote suit (via partition.piste.accordage) — c'est elle que rendu ET audio
            //    lisent en pratique (voir engine/layout.js#poserEvenement, audio/player.js).
            const p = m.creerPartition('piano');
            const note = m.creerNote(0, 67);   // sol4
            const hauteurNote = m.hauteurDeNote(p, note);

            // 3. hauteurDepuisPas : l'INVERSE d'ecrireHauteur, sur une note DIATONIQUE (dansLArmure) —
            //    seul cas où le round-trip DOIT être exact (voir sa propre documentation).
            const ecriture = theory.ecrireHauteur(60, 0);   // do central, do majeur : diatonique par définition
            const backC4 = theory.hauteurDepuisPas(ecriture.pas, 0);
            // Fa# en Sol majeur (armure +1) : la portée montre un fa# SANS altération dessinée.
            const ecritureFaD = theory.ecrireHauteur(66, 1);
            const backFaD = theory.hauteurDepuisPas(ecritureFaD.pas, 1);

            // 4. INTÉGRATION jusqu'au glyphe : une note à une hauteur connue, rendue, puis retrouvée
            //    par sa position Y via pasDeLaPosition — exactement ce que fait un clic (voir
            //    main.js#cibleDepuisClicPiano), mais vérifié ici sans passer par la souris.
            p.mesures[0].voix[0].evenements = [m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 60)])];
            const page1 = L.mettreEnPage(p, { largeurPage: 1100, S: 8 });
            const a = page1.ancrages.evenements.find(x => x.mesure === 0 && x.voix === 0 && x.evenement === 0);
            const teteGlyphe = page1.primitives.find(pr => pr.t === 'glyphe' && pr.nom === G.teteDe(4).nom && Math.abs(pr.x - a.x) < 1);
            const clefSol = L.CLEFS.sol;
            const pasRetrouve = teteGlyphe ? L.pasDeLaPosition(teteGlyphe.y, a.yPortee, 8, clefSol) : null;
            const hauteurRetrouvee = pasRetrouve != null ? theory.hauteurDepuisPas(pasRetrouve, 0) : null;

            // 5. Transposition : AUCUNE case ni corde de repli n'existe au piano — un bogue latent
            //    (jamais atteignable avant ce chantier, faute de vraies notes piano) faisait tomber
            //    CHAQUE note en « hors du manche » (hauteurDeCase y renvoyait déjà null). Voir
            //    Editeur.transposerMorceau, la branche `!cordes.length`.
            const pT = m.creerPartition('piano');
            pT.mesures[0].voix[0].evenements = [m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 60)])];
            const ed2 = new (await import('/src/edit/commands.js')).Editeur(pT);
            const bilanT = ed2.transposerMorceau(2);
            const noteApresT = ed2.partition.mesures[0].voix[0].evenements[0].notes[0];
            const hauteurApresT = m.hauteurDeNote(ed2.partition, noteApresT);
            ed2.transposerMorceau(-2);
            const hauteurRetourT = m.hauteurDeNote(ed2.partition, ed2.partition.mesures[0].voix[0].evenements[0].notes[0]);

            return {
                hCasePiano, hCaseGuitare, hauteurNote,
                backC4, backFaD, faDAttendu: 66,
                teteGlypheTrouvee: !!teteGlyphe, hauteurRetrouvee,
                bilanT, hauteurApresT, hauteurRetourT,
            };
        });

        check(r.hCasePiano === 60, 'hauteurDeCase : sans cordes (piano), frette=60 donne bien la hauteur MIDI 60 directement');
        check(r.hCaseGuitare === 124, 'et un accordage AVEC cordes garde son calcul habituel (corde + case), inchangé');
        check(r.hauteurNote === 67, 'hauteurDeNote suit hauteurDeCase pour une note piano');
        check(r.backC4 === 60, 'hauteurDepuisPas retrouve le do central (pas -> armure 0 -> 60)');
        check(r.backFaD === r.faDAttendu, 'et un fa# diatonique d\'une armure à un dièse (Sol majeur)');
        exiger(r.teteGlypheTrouvee, 'préalable : la tête de note existe bien dans les primitives (voir la suite du banc)');
        check(r.hauteurRetrouvee === 60, 'LE CŒUR DU CLIC : la position Y de la tête, relue par pasDeLaPosition, retrouve exactement la hauteur posée (60)');
        check(r.bilanT.horsManche === 0 && r.hauteurApresT === 62,
            'transposerMorceau +2 demi-tons sur une note piano : jamais « hors du manche » (bogue latent, corrigé), hauteur exacte (62)');
        check(r.hauteurRetourT === 60, 'et l\'aller-retour (+2 puis −2) revient exactement à la hauteur de départ (60)');

        // --- Rendu : de vraies notes, plus un silence figé ----------------------------------------
        const rd = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const L = await import('/src/engine/layout.js');
            const G = await import('/src/engine/glyphs.js');
            const compter = (prims, nom) => prims.filter(p => p.t === 'glyphe' && p.nom === nom).length;

            const p = m.creerPartition('piano');
            p.mesures[0].voix[0].evenements = [m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 60), m.creerNote(0, 64)])];   // accord voix 0
            p.mesures[0].voix.push(m.creerVoix(4));
            p.mesures[0].voix[1].evenements = [m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 43)])];   // voix 1, main gauche

            const page1 = L.mettreEnPage(p, { largeurPage: 1100, S: 8 });
            const teteNoire = G.teteDe(4).nom;
            const evtsAncres = page1.ancrages.evenements.filter(a => a.mesure === 0);
            return {
                nTetes: compter(page1.primitives, teteNoire),
                // Mesures 1-3 restent VIDES (jamais touchées) : chacune garde son silence de mesure
                // entière sur les DEUX portées — 3 mesures × 2 portées = 6, PLUS la portée de fa de la
                // mesure 0 (voix 1 EXISTE mais ne compte pas comme « vide » puisqu'elle joue une noire,
                // pas un silence).
                nSilenceRonde: compter(page1.primitives, G.SILENCES[1].nom),
                nEvtsMesure0: evtsAncres.length,   // 2 : un par voix
                yPorteeVoix0: evtsAncres.find(a => a.voix === 0)?.yPortee,
                yPorteeVoix1: evtsAncres.find(a => a.voix === 1)?.yPortee,
                systemeYPorteeFa: page1.ancrages.systemes[0].yPorteeFa,
            };
        });
        check(rd.nTetes === 3, 'trois têtes de noire au total : l\'accord de 2 notes (voix 0) + la note isolée (voix 1)');
        check(rd.nSilenceRonde === 6, 'les 3 mesures encore vides gardent leur silence de mesure entière sur les DEUX portées (6), la mesure 0 n\'y contribue plus');
        check(rd.nEvtsMesure0 === 2, 'la mesure 0 ancre bien un évènement par voix (portée de sol ET de fa)');
        check(rd.yPorteeVoix0 !== rd.yPorteeVoix1, 'les deux voix ancrent des évènements sur des portées DIFFÉRENTES (sol pour la voix 0, fa pour la voix 1)');
        check(rd.yPorteeVoix1 === rd.systemeYPorteeFa, 'la voix 1 (main gauche) ancre bien sur la portée de FA du système');

        // --- L'interface : le geste complet, à la souris -------------------------------------------
        await page.evaluate(() => window.app.editeur.nouveau('piano'));
        await page.waitForTimeout(150);

        const geom = await page.evaluate(() => {
            const app = window.app;
            const boite = app.el.feuille.querySelector('svg').getBoundingClientRect();
            const sys = app.page.ancrages.systemes[0];
            const m0 = app.page.ancrages.mesures[0];
            const S = app.page.geo.S;
            const versEcran = (x, y) => ({ x: boite.left + x * (boite.width / app.page.largeur), y: boite.top + y * (boite.height / app.page.hauteur) });
            return {
                doCentral: versEcran(m0.xNotes + 15, sys.yPortee + 5 * S),   // 1re ligne suppl. sous la clé de sol
                autreHauteur: versEcran(m0.xNotes + 15, sys.yPortee + 1 * S),
                surLaFa: versEcran(m0.xNotes + 15, sys.yPorteeFa + 1 * S),
            };
        });

        exiger(await page.locator('.groupe-outils').first().isVisible(), 'préalable : la barre d\'outils est bien affichée');

        // Clic sur la clé de sol : pose une note à la voix 0, sans rien demander d'autre.
        await page.mouse.click(geom.doCentral.x, geom.doCentral.y);
        await page.waitForTimeout(150);
        const apresClicSol = await page.evaluate(() => {
            const ev = window.app.editeur.partition.mesures[0].voix[0].evenements[0];
            return { nNotes: ev.notes.length, silence: ev.silence, curseurVoix: window.app.editeur.curseur.voix };
        });
        check(apresClicSol.nNotes === 1 && !apresClicSol.silence, 'un clic sur la clé de sol pose directement une note (aucun second geste requis)');
        check(apresClicSol.curseurVoix === 0, 'et place le curseur sur la voix 0 (main droite)');

        // Reclic au MÊME endroit : bascule, retire la note.
        await page.mouse.click(geom.doCentral.x, geom.doCentral.y);
        await page.waitForTimeout(150);
        const apresBascule = await page.evaluate(() => window.app.editeur.partition.mesures[0].voix[0].evenements[0]);
        check(apresBascule.notes.length === 0 && apresBascule.silence, 'recliquer EXACTEMENT au même endroit retire la note (bascule), sans passer par Suppr');

        // Un accord : deux hauteurs différentes, même colonne.
        await page.mouse.click(geom.doCentral.x, geom.doCentral.y);
        await page.waitForTimeout(120);
        await page.mouse.click(geom.autreHauteur.x, geom.autreHauteur.y);
        await page.waitForTimeout(150);
        const apresAccord = await page.evaluate(() => window.app.editeur.partition.mesures[0].voix[0].evenements[0].notes.map(n => n.frette));
        check(apresAccord.length === 2 && new Set(apresAccord).size === 2, 'deux clics à des hauteurs différentes, même colonne, construisent un ACCORD (deux hauteurs distinctes)');

        // Clic sur la clé de fa : la mesure n'a qu'une voix -> la voix 1 apparaît TOUTE SEULE.
        exiger((await page.evaluate(() => window.app.editeur.partition.mesures[0].voix.length)) === 1, 'préalable : une seule voix avant ce clic');
        await page.mouse.click(geom.surLaFa.x, geom.surLaFa.y);
        await page.waitForTimeout(150);
        const apresClicFa = await page.evaluate(() => {
            const mm = window.app.editeur.partition.mesures[0];
            return {
                nVoix: mm.voix.length,
                notesVoix1: mm.voix[1] ? mm.voix[1].evenements[0].notes.length : 0,
                voix0Intacte: mm.voix[0].evenements[0].notes.length === 2,
            };
        });
        check(apresClicFa.nVoix === 2, 'cliquer sur la portée de FA ajoute la voix manquante toute seule, sans bouton « + Voix »');
        check(apresClicFa.notesVoix1 === 1, 'et y pose la note visée');
        check(apresClicFa.voix0Intacte, 'sans toucher à l\'accord déjà écrit à la main droite');

        // Undo : Ctrl+Z défait la DERNIÈRE hauteur posée (la voix de fa), pas tout l'accord d'un coup.
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(150);
        const apresUndo = await page.evaluate(() => window.app.editeur.partition.mesures[0].voix[1]?.evenements[0].notes.length ?? 'voix absente');
        check(apresUndo === 0 || apresUndo === 'voix absente', 'Ctrl+Z défait la dernière hauteur posée (la note de la main gauche)');

        // Un chiffre au clavier : message clair, AUCUNE note fantôme.
        await page.evaluate(() => window.app.editeur.nouveau('piano'));
        await page.waitForTimeout(150);
        await page.locator('#zone-partition').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('5');
        await page.waitForTimeout(200);
        const apresChiffre = await page.evaluate(() => window.app.editeur.partition.mesures[0].voix[0].evenements[0].notes.length);
        const messageChiffre = await page.textContent('#message');
        check(apresChiffre === 0, 'taper un chiffre au clavier sur piano n\'écrit AUCUNE note fantôme');
        check(/portée|piano/i.test(messageChiffre || ''), 'et le dit clairement au lieu de se taire');

        // Lecture audio d'une partition piano avec de vraies notes : aucune erreur.
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.partition.mesures[0].voix[0].evenements = [m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 60)])];
            ed.partition.meta.tempo = 400;
            ed.prevenir('document');
        });
        await page.click('#btn-jouer');
        await page.waitForTimeout(500);
        await page.click('#btn-stop');
        await page.waitForTimeout(150);
        check(erreurs.length === 0, 'aucune erreur JavaScript en cours de route' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));

        // --- Non-régression : le clic guitare/basse (cibleDepuisClic) reste inchangé ----------------
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 3)])];
            ed.prevenir('document');
        });
        await page.waitForTimeout(150);
        const avantClicGuitare = await page.evaluate(() => JSON.stringify(window.app.editeur.partition.mesures[0]));
        const posGuitare = await page.evaluate(() => {
            const a = window.app.page.ancrages.evenements[0];
            const boite = window.app.el.feuille.querySelector('svg').getBoundingClientRect();
            return { x: boite.left + a.x * (boite.width / window.app.page.largeur), y: boite.top + a.yPortee * (boite.height / window.app.page.hauteur) };
        });
        await page.mouse.click(posGuitare.x, posGuitare.y);
        await page.waitForTimeout(150);
        const apresClicGuitare = await page.evaluate(() => JSON.stringify(window.app.editeur.partition.mesures[0]));
        check(avantClicGuitare === apresClicGuitare, 'sur guitare, un clic sur la portée déplace SEULEMENT le curseur (aucune note posée) — le geste piano ne déteint pas sur la tablature');

        check(erreurs.length === 0, 'toujours aucune erreur JavaScript en fin de banc' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
