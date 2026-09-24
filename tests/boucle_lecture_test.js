// Banc de la BOUCLE DE LECTURE — bande translucide sous la TAB, glissée pour rejouer une zone en boucle.
//
// CE QU'IL PROTÈGE. Retour direct : « je veux le même principe que sur HarmoHub, une barre orange
// translucide horizontale sous la grille, qui permet de définir une zone où la lecture doit se lire en
// boucle. Cette barre peut être étirée au nombre de mesures voulu avec la souris ou le doigt. » Repris
// de HarmoHub (loopRange/setLoopRange), déplacé sous la TAB plutôt que sur les numéros de mesure —
// l'espace que la réglette occupait avant son retrait, resté vide depuis :
//   • une bande INVISIBLE (mais bien là, voir touch-action) existe sous chaque système, même sans
//     aucune boucle active — c'est elle qui reçoit le geste de départ ;
//   • glisser dedans (souris OU doigt réel, pas seulement des évènements synthétiques) définit une
//     zone [mesureDebut, mesureFin], peu importe le sens du glisser ;
//   • Tone.Transport.loop (natif) rejoue RÉELLEMENT cette zone, avec l'epsilon d'un tic qui évite le
//     piège documenté de Tone (jamais un évènement pile sur loopStart) ;
//   • un tap/clic SANS glisser retire une boucle déjà posée ; un morceau neuf en repart sans elle
//     (c'est un état de SESSION, jamais sauvé — voir Lecteur.boucleLecture) ;
//   • rien de tout ça ne doit gêner le lasso, l'étirement de durée ou le simple clic ailleurs sur la
//     partition (voir demarrerGeste, qui teste la bande AVANT tout le reste).
//
// AJOUTÉ (retour utilisateur, HarmoHub cité en modèle) : « c'est trop proche du bord en bas et sur
// les côtés [...] il faut ajouter des poignées comme sur HarmoHub ». Deux défauts distincts, un seul
// et même geste responsable — glisser N'IMPORTE OÙ dans la bande redéfinissait TOUTE la zone depuis
// ce point, sans jamais permettre de retoucher un seul bord :
//   • le trait plein collait pile aux bords de mesure, sans le moindre ajour (voir marquesBoucle,
//     MARGE_BOUCLE_LATERALE/VERTICALE) — cosmétique seulement, la zone de saisie reste, elle, sur
//     les bords RÉELS ;
//   • deux POIGNÉES (voir LARGEUR_POIGNEE_BOUCLE/PRISE_POIGNEE_BOUCLE/poigneeBoucleAuPoint) se
//     dessinent sur les VRAIS bords globaux de la zone et s'attrapent avec une marge bien plus large
//     que ce qu'elles montrent — glisser L'UNE d'elles étire ce bord SEUL, l'autre restant fixe.
//
// AJOUTÉ (retour utilisateur : « sur téléphone, je ne peux pas placer la bande orange ou l'étirer
// comme je veux avec le doigt ») : la zone de saisie elle-même — bande ET poignées — reste bien trop
// ÉTROITE au doigt (voir basBandeBoucle/prisePoigneeBoucle) : 1,4 S de haut (guère plus de 12 px à
// l'interligne par défaut), là où .btn-outil/.btn-transport visent déjà 40-44 px au doigt ailleurs
// dans l'appli. Elle double au moins de hauteur, et sa prise horizontale plus que double, dès que
// `pointer: coarse` (voir appareilTactile) — SANS jamais épaissir le trait VISUEL, qui reste centré
// dans cette zone agrandie à la même épaisseur qu'à la souris : ce que l'œil voit ne change pas, ce
// que le doigt peut manquer, si.
//
// AJOUTÉ (retour utilisateur : « la lecture devrait se lancer toujours depuis le début, sauf si j'ai
// mis en place une barre orange ») : Editeur.positionDeDepartLecture repartait auparavant du CURSEUR
// dès l'arrêt, la boucle ne servant de filet que si le curseur restait EN DEHORS d'elle. Le curseur
// n'intervient plus DU TOUT dans cette décision : sans boucle, la lecture repart TOUJOURS du tout
// début du morceau — avec une boucle, TOUJOURS du début de la boucle, où que soit le curseur.
//
// AJOUTÉ (retour utilisateur : « je n'arrive pas à définir la barre de lecture orange (boucle) sous
// la grille, car mon téléphone croit veut faire bouger l'écran lorsque j'essaye de la placer ou de
// l'étirer ») : `touch-action: none` (voir style.css, .bande-boucle) n'était posé QUE sur la piste
// invisible de fond — le HALO visible et les DEUX POIGNÉES, qui se dessinent PAR-DESSUS elle dès
// qu'une boucle existe (voir marquesBoucle), n'avaient jamais leur propre classe et restaient donc
// des rectangles ORDINAIRES pour le navigateur. Exactement ce que le doigt touche en premier pour
// « placer » (retoucher une boucle déjà là) ou « étirer » (saisir une poignée) — la piste invisible
// dessous, elle, n'était plus jamais atteinte une fois une boucle posée. Voir le cas 18 plus bas.
//
// AJOUTÉ, ce correctif-là ne suffisant TOUJOURS PAS (même retour, capture à l'appui : « lorsque je
// place la boucle orange de gauche à droite, l'écran se décale ENCORE au lieu de comprendre qu'il faut
// uniquement placer la barre orange » — la boucle restait figée sur sa mesure de départ, signe d'un
// geste volé en cours de route) : `touch-action` ne pouvait pas porter seul, pour deux raisons qui se
// cumulent et dont AUCUNE ne se voit sur un banc Chromium — WebKit (le moteur de l'iPhone d'où vient
// ce retour) n'honore pas `touch-action` posé sur un <rect> SVG, et `preventDefault()` sur un
// `pointerdown` ne couvre PAS le défilement (spécification Pointer Events). D'où un filet indépendant
// du moteur : un `touchmove` NON PASSIF refusé le temps du glisser, et LUI SEUL (voir
// main.js#_bloquerDefilementPendantGeste) — cas 19 plus bas, qui mesure les deux bornes.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('boucle de lecture');

(async () => {
    plan(135);

    // --- 0. À LA SOURIS D'ABORD (page à part, sans hasTouch) : la mesure de référence pour le
    // comparatif tactile juste après — cette page ne sert qu'à ça, fermée aussitôt. -----------------
    const refSouris = await (async () => {
        const { page, erreurs, fermer } = await ouvrirApp();
        try {
            await page.evaluate(async () => {
                const m = await import('/src/model/score.js');
                const ed = window.app.editeur;
                ed.nouveau('guitare');
                ed.partition.mesures = Array.from({ length: 4 }, () => m.creerMesure({
                    voix: [{ evenements: [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)])) }],
                }));
                // prevenir('document') D'ABORD : il efface lui-même toute boucle en cours (voir
                // surChangementEditeur, « un morceau neuf ne doit jamais hériter de la boucle du
                // précédent ») — la poser APRÈS, comme ici, est le seul ordre qui la garde en place.
                ed.prevenir('document');
                window.app.lecteur.definirBoucle(ed.partition, 0, 1);
                window.app.dessiner();
            });
            await page.waitForTimeout(150);
            const geo = await page.evaluate(() => {
                const svg = document.querySelector('#feuille svg');
                return {
                    bandeH: +svg.querySelector('rect.bande-boucle').getAttribute('height'),
                    haloH: +[...svg.querySelectorAll('rect')].find(r => r.getAttribute('fill') === 'var(--lecture-halo)').getAttribute('height'),
                };
            });
            check(erreurs.length === 0, 'aucune erreur JavaScript (page de référence, à la souris)');
            return geo;
        } finally { await fermer(); }
    })();

    // hasTouch : nécessaire pour que le glisser tactile RÉEL (cas 10, Input.dispatchTouchEvent) soit
    // bien rapporté en pointerType 'touch' — sans lui, ces évènements CDP repartent en 'mouse' (voir
    // tests/_page.js) et ne prouveraient donc rien de spécifique au doigt. N'affecte pas les gestes
    // page.mouse.*, qui restent du VRAI pointerType 'mouse' quel que soit ce réglage. C'est aussi ce
    // qui fait passer `pointer: coarse` (voir appareilTactile) à vrai pour TOUTE cette page, y
    // compris les gestes page.mouse.* de ce banc : la zone de saisie AGRANDIE (voir l'en-tête) est
    // donc bien celle exercée dans tout ce qui suit, comparée à refSouris ci-dessus.
    const { page, erreurs, fermer } = await ouvrirApp({ hasTouch: true });
    try {
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures = Array.from({ length: 8 }, (_, i) => m.creerMesure({
                voix: [{ evenements: [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f + i)])) }],
            }));
            ed.partition.mesures[0].signature = { battements: 4, unite: 4 };
            ed.partition.mesures[0].armure = 0;
            ed.partition.mesures[0].mode = 'majeur';
            window.app.mesuresParLigne = 4;
            ed.prevenir('document');
        });
        await page.waitForTimeout(150);

        // --- État de départ : la bande existe, invisible, aucune boucle -----------------------------
        const depart = await page.evaluate(() => {
            const svg = document.querySelector('#feuille svg');
            return {
                bandes: svg.querySelectorAll('rect.bande-boucle').length,
                boucleLecture: window.app.lecteur.boucleLecture,
                loop: window.Tone.Transport.loop,
            };
        });
        exiger(depart.bandes >= 1, 'au moins une bande de boucle existe dans le SVG dès le départ (une par système)');
        check(depart.boucleLecture === null && depart.loop === false, 'aucune boucle par défaut — la lecture joue tout droit');

        // --- Point d'écran au milieu d'une mesure, dans la bande de boucle --------------------------
        const pointMesure = (i) => page.evaluate((i) => {
            const svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect();
            const a = window.app.page.ancrages.mesures.find(x => x.index === i);
            const S = window.app.page.geo.S;
            const yBande = a.yTab + a.hauteurTab + 1.2 * S;
            return {
                x: b.left + ((a.x + a.xFin) / 2 / window.app.page.largeur) * b.width,
                y: b.top + (yBande / window.app.page.hauteur) * b.height,
            };
        }, i);
        /** Point d'écran à une FRACTION donnée de la largeur de la mesure `i`, à la hauteur de la
         *  bande — pour viser autre chose que le centre (voir le calage au temps). */
        const pointDansMesure = (i, fraction) => page.evaluate(({ i, fraction }) => {
            const svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect();
            const a = window.app.page.ancrages.mesures.find(x => x.index === i);
            const S = window.app.page.geo.S;
            const yBande = a.yTab + a.hauteurTab + 1.2 * S;
            return {
                x: b.left + ((a.x + (a.xFin - a.x) * fraction) / window.app.page.largeur) * b.width,
                y: b.top + (yBande / window.app.page.hauteur) * b.height,
            };
        }, { i, fraction });
        /** Point d'écran sur le VRAI bord ('debut' = a.x, 'fin' = a.xFin) de la mesure `i`, à la
         *  hauteur de la bande — là où se dessine et se saisit une poignée (voir marquesBoucle/
         *  poigneeBoucleAuPoint), par opposition à pointMesure ci-dessus qui vise son CENTRE. */
        // LE POINT VISÉ EST CELUI OÙ LA POIGNÉE EST DESSINÉE, lu sur le SVG — pas un bord de mesure
        // recalculé ici. Une version antérieure prenait `a.x`/`a.xFin`, ce qui n'a jamais été le même
        // point : la bande se borne aux BORNES FINES (player.js#bornesBoucle), et le bord de mesure
        // d'un début de système inclut en plus la clef et le chiffrage (69 px d'écart mesurés à S=9).
        // Un banc qui vise ailleurs que l'utilisateur ne prouve rien de ce que l'utilisateur fait.
        const pointBordMesure = (i, bord) => page.evaluate(({ i, bord }) => {
            const svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect();
            const a = window.app.page.ancrages.mesures.find(x => x.index === i);
            const S = window.app.page.geo.S;
            const yBande = a.yTab + a.hauteurTab + 1.2 * S;
            const dessinee = svg.querySelector(bord === 'debut' ? '.poignee-debut' : '.poignee-fin');
            const xSvg = dessinee
                ? +dessinee.getAttribute('x') + (+dessinee.getAttribute('width')) / 2
                : (bord === 'debut' ? a.x : a.xFin);   // repli : aucune boucle posée, donc aucune poignée
            return {
                x: b.left + (xSvg / window.app.page.largeur) * b.width,
                y: b.top + (yBande / window.app.page.hauteur) * b.height,
            };
        }, { i, bord });

        const glisserSouris = async (depuis, vers) => {
            await page.mouse.move(depuis.x, depuis.y);
            await page.mouse.down();
            await page.mouse.move((depuis.x + vers.x) / 2, depuis.y, { steps: 4 });
            await page.mouse.move(vers.x, vers.y, { steps: 6 });
            await page.mouse.up();
            await page.waitForTimeout(150);
        };

        // --- 1. Glisser de la mesure 1 à la mesure 3 (souris) ---------------------------------------
        await glisserSouris(await pointMesure(1), await pointMesure(3));
        const apres1 = await page.evaluate(() => ({
            boucle: window.app.lecteur.boucleLecture,
            loop: window.Tone.Transport.loop,
            loopStart: Tone.Time(Tone.Transport.loopStart).toSeconds(),
            loopEnd: Tone.Time(Tone.Transport.loopEnd).toSeconds(),
        }));
        exiger(apres1.boucle && apres1.boucle.debut === 1 && apres1.boucle.fin === 3, 'glisser de la mesure 1 à la mesure 3 définit bien [1, 3]');
        check(apres1.loop === true, 'et Tone.Transport.loop passe à vrai');
        // LE CALAGE SE FAIT AU TEMPS, plus à la mesure entière (retour utilisateur : « elle pourra
        // effectivement se poser à une demi-mesure près en fonction de la position où je la
        // relâche », puis le choix du TEMPS plutôt que de la demi-mesure ou de la croche — voir
        // main.js#callerAuTemps). `pointMesure` vise le CENTRE d'une mesure : partir du milieu de la
        // mesure 1 pour finir au milieu de la mesure 3 borne donc du temps 3 de l'une au temps 3 de
        // l'autre, soit 3s -> 7s à 120 BPM, et non plus 2s -> 8s.
        //
        // CETTE VÉRIFICATION A CHANGÉ DE VALEUR ATTENDUE, ce qui mérite d'être dit : elle encodait
        // « une mesure entière quoi qu'on vise », c'est-à-dire exactement ce que l'utilisateur
        // demandait de changer. Le cas des mesures entières n'a pas disparu pour autant — il est
        // vérifié juste en dessous, en glissant d'un BORD à l'autre.
        check(Math.abs(apres1.loopStart - 3) < 0.02 && Math.abs(apres1.loopEnd - 7) < 0.02,
            `viser le milieu des mesures borne au TEMPS le plus proche : 3s -> 7s (mesuré ${apres1.loopStart.toFixed(2)} -> ${apres1.loopEnd.toFixed(2)})`);
        check(apres1.boucle.debutDansMesure === 2 && apres1.boucle.finDansMesure === 2,
            'et le modèle le dit en clair : deux noires depuis le début de chacune des deux mesures d\'ancrage');

        // LES MESURES ENTIÈRES RESTENT ATTEIGNABLES, et c'est ce qui rend le calage fin acceptable :
        // viser les bords donne exactement ce que l'ancienne version donnait de toute façon.
        await page.evaluate(() => { window.app.lecteur.retirerBoucle(); window.app.dessiner(); });
        await page.waitForTimeout(120);
        await glisserSouris(await pointDansMesure(1, 0.02), await pointDansMesure(3, 0.99));
        const entieres = await page.evaluate(() => ({
            boucle: window.app.lecteur.boucleLecture,
            loopStart: Tone.Time(Tone.Transport.loopStart).toSeconds(),
            loopEnd: Tone.Time(Tone.Transport.loopEnd).toSeconds(),
        }));
        check(Math.abs(entieres.loopStart - 2) < 0.02 && Math.abs(entieres.loopEnd - 8) < 0.02,
            `glisser d'un BORD à l'autre redonne les mesures entières : 2s -> 8s (mesuré ${entieres.loopStart.toFixed(2)} -> ${entieres.loopEnd.toFixed(2)})`);

        // --- 2. La zone se dessine réellement (primitive visible, couleur de lecture) ---------------
        const zoneDessinee = await page.evaluate(() => {
            const svg = document.querySelector('#feuille svg');
            return [...svg.querySelectorAll('rect')].some(r =>
                getComputedStyle(r).fill !== '' && r.getAttribute('fill') === 'var(--lecture-halo)');
        });
        check(zoneDessinee, 'la zone se dessine avec la couleur de LECTURE (--lecture-halo), pas celle du curseur d\'édition');

        // --- 2b. AU DOIGT (cette page, hasTouch), LA ZONE DE SAISIE EST NETTEMENT PLUS HAUTE QU'À LA
        // SOURIS (refSouris ci-dessus) — mais le trait VISUEL, lui, garde l'épaisseur d'origine -------
        const geoTactile = await page.evaluate(() => {
            const svg = document.querySelector('#feuille svg');
            return {
                bandeH: +svg.querySelector('rect.bande-boucle').getAttribute('height'),
                haloH: +[...svg.querySelectorAll('rect')].find(r => r.getAttribute('fill') === 'var(--lecture-halo)').getAttribute('height'),
            };
        });
        check(geoTactile.bandeH > refSouris.bandeH * 1.5,
            `au doigt, la zone de SAISIE est nettement plus haute qu'à la souris (${geoTactile.bandeH.toFixed(1)} px contre ${refSouris.bandeH.toFixed(1)} px)`);
        check(Math.abs(geoTactile.haloH - refSouris.haloH) < 0.5,
            'mais le trait VISUEL garde exactement la même épaisseur, souris ou doigt — seule la prise change, jamais ce que l\'œil voit');

        // --- 3. Glisser en SENS INVERSE (5 -> 2) normalise quand même en [2, 5] ---------------------
        await glisserSouris(await pointMesure(5), await pointMesure(2));
        const apres3 = await page.evaluate(() => window.app.lecteur.boucleLecture);
        check(apres3.debut === 2 && apres3.fin === 5, 'glisser à l\'ENVERS (5 -> 2) redonne quand même [2, 5], jamais [5, 2]');

        // --- 4. Un clic SANS glisser, sur la bande, retire la boucle --------------------------------
        await page.mouse.click((await pointMesure(3)).x, (await pointMesure(3)).y);
        await page.waitForTimeout(150);
        const apres4 = await page.evaluate(() => ({ boucle: window.app.lecteur.boucleLecture, loop: window.Tone.Transport.loop }));
        check(apres4.boucle === null, 'un tap/clic SANS glisser sur la bande retire la boucle');
        check(apres4.loop === false, 'et Tone.Transport.loop repasse à faux');

        // --- 5. Un morceau NEUF repart sans boucle --------------------------------------------------
        await page.evaluate(() => { window.app.lecteur.definirBoucle(window.app.editeur.partition, 1, 2); });
        exiger((await page.evaluate(() => window.app.lecteur.boucleLecture)) !== null, 'préalable : la boucle est bien posée avant le nouveau morceau');
        await page.evaluate(() => { window.app.editeur.nouveau('guitare'); });
        check((await page.evaluate(() => window.app.lecteur.boucleLecture)) === null, 'ed.nouveau() efface la boucle du morceau précédent');

        // --- 6. La boucle SURVIT à une pause/un arrêt (état de session, pas lié à la lecture) -------
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.partition.mesures = Array.from({ length: 8 }, () => m.creerMesure({
                voix: [{ evenements: [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)])) }],
            }));
            ed.prevenir('document');
            window.app.lecteur.definirBoucle(ed.partition, 0, 1);
        });
        await page.click('#btn-jouer');
        await page.waitForTimeout(200);
        await page.click('#btn-stop');
        check((await page.evaluate(() => window.app.lecteur.boucleLecture)) !== null, 'la boucle reste posée après un Stop (rien à voir avec l\'état de lecture)');

        // --- 7. Lecture DEPUIS L'ARRÊT, boucle active : TOUJOURS le début de la BOUCLE, curseur DEDANS
        const dansLaBoucle = await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.placerCurseur(1, 2, 0);   // mesure 1, DANS la boucle [0,1] — mais ne doit plus compter
            const depart = window.app.positionDeDepartLecture();
            const debutBoucle = window.app.editeur.partition.mesures.slice(0, 0).length; // mesure 0 -> 0 noire
            return depart === debutBoucle;
        });
        check(dansLaBoucle, 'curseur DANS la boucle -> la lecture repart bien du DÉBUT DE LA BOUCLE, plus du curseur (retour utilisateur)');

        // --- 8. ... et TOUJOURS pareil, curseur DEHORS -----------------------------------------------
        const horsLaBoucle = await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.placerCurseur(5, 0, 0);   // mesure 5, hors de la boucle [0,1]
            const depart = window.app.positionDeDepartLecture();
            return depart === 0;
        });
        check(horsLaBoucle, 'curseur HORS la boucle -> la lecture repart du DÉBUT DE LA BOUCLE tout pareil, jamais d\'un endroit qu\'elle ne traverse peut-être jamais');

        // --- 8bis. SANS AUCUNE boucle : TOUJOURS le tout début du morceau, jamais le curseur ---------
        // C'est le cœur du retour utilisateur : avant ce correctif, la lecture repartait du curseur
        // par défaut — retoucher la mesure 6 puis lancer la lecture rejouait depuis la mesure 6, pas
        // depuis le début, sans qu'aucune boucle ne l'ait demandé.
        const sansBoucleDuTout = await page.evaluate(() => {
            window.app.lecteur.retirerBoucle();
            const ed = window.app.editeur;
            ed.placerCurseur(2, 1, 0);   // mesure 2 — loin du début, aucune boucle en jeu
            const depart = window.app.positionDeDepartLecture();
            const curseur = window.app.positionDuCurseurEnNoires();
            return { depart, curseurNonNul: curseur > 0 };
        });
        exiger(sansBoucleDuTout.curseurNonNul, 'préalable : le curseur est bien loin du début (sans quoi ce cas ne prouverait rien)');
        check(sansBoucleDuTout.depart === 0, 'et SANS aucune boucle, la lecture repart du tout DÉBUT DU MORCEAU — jamais du curseur, quelle que soit sa position');

        // --- 9. Un geste qui commence AILLEURS que dans la bande garde son comportement normal ------
        // (non-régression : la bande de boucle est testée EN PREMIER dans demarrerGeste — elle ne
        // doit pourtant jamais confisquer un clic destiné à placer le curseur sur une note.)
        await page.evaluate(() => { window.app.lecteur.retirerBoucle(); });
        const pointNote = await page.evaluate(() => {
            const svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect();
            const a = window.app.page.ancrages.evenements.find(e => e.mesure === 2 && e.evenement === 1);
            return { x: b.left + (a.x / window.app.page.largeur) * b.width, y: b.top + (a.yTab / window.app.page.hauteur) * b.height };
        });
        await page.mouse.click(pointNote.x, pointNote.y);
        await page.waitForTimeout(100);
        const curseurApresClicNote = await page.evaluate(() => ({ mesure: window.app.editeur.curseur.mesure, evenement: window.app.editeur.curseur.evenement, boucle: window.app.lecteur.boucleLecture }));
        check(curseurApresClicNote.mesure === 2 && curseurApresClicNote.evenement === 1, 'un clic sur une NOTE (hors bande) place toujours le curseur normalement');
        check(curseurApresClicNote.boucle === null, 'et ne définit évidemment aucune boucle');

        // --- 10. LA BANDE COUPE LE DÉFILEMENT TACTILE NATIF À LA RACINE (touch-action) ---------------
        // `Input.dispatchTouchEvent` (CDP) ne suffit pas à éprouver ceci de façon fiable : en tête
        // headless, Chromium annule la séquence synthétique dès le premier mouvement (pointercancel),
        // qu'un touch-action l'y autorise ou non — un train de faux positifs, pas une preuve. Ce que
        // ce banc peut vérifier de façon STABLE, et qui couvre les deux moitiés du mécanisme :
        //   • la valeur CALCULÉE de touch-action sur l'élément RÉELLEMENT touché à cet endroit (la
        //     partie déclarative, celle qui gouvernerait un vrai doigt sur un vrai appareil) ;
        //   • qu'une séquence de VRAIS évènements PointerEvent en pointerType 'touch' (construits et
        //     livrés directement, sans passer par la reconnaissance de geste du compositeur — donc
        //     sans le faux problème ci-dessus) traverse bien tout le code du geste jusqu'au bout.
        const toucheAction = await page.evaluate((p) => getComputedStyle(document.elementFromPoint(p.x, p.y)).touchAction,
            await pointMesure(0));
        check(toucheAction === 'none', 'l\'élément sous le doigt, au point de départ, calcule bien touch-action: none');

        const resultatTactile = await page.evaluate(async ({ p1, p2 }) => {
            const feuille = document.getElementById('feuille');
            const envoyer = (type, x, y) => feuille.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true, pointerId: 77, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: y,
            }));
            envoyer('pointerdown', p1.x, p1.y);
            for (let k = 1; k <= 5; k++) envoyer('pointermove', p1.x + (p2.x - p1.x) * (k / 5), p1.y);
            envoyer('pointerup', p2.x, p2.y);
            return window.app.lecteur.boucleLecture;
        }, { p1: await pointMesure(0), p2: await pointMesure(2) });
        exiger(resultatTactile && resultatTactile.debut === 0 && resultatTactile.fin === 2,
            'un glisser en pointerType \'touch\' (bas -> haut -> relâché) traverse tout le geste et définit bien [0, 2]');

        // --- 11. POIGNÉES : étirer un SEUL bord, l'autre restant FIXE (retour utilisateur, HarmoHub
        // cité en modèle : « il faut ajouter des poignées ») -----------------------------------------
        await page.evaluate(() => { window.app.lecteur.definirBoucle(window.app.editeur.partition, 2, 4); window.app.dessiner(); });
        await page.waitForTimeout(100);

        await glisserSouris(await pointBordMesure(4, 'fin'), await pointMesure(6));
        const apres11 = await page.evaluate(() => window.app.lecteur.boucleLecture);
        check(apres11.debut === 2 && apres11.fin === 6, 'glisser la poignée DROITE étire la boucle par la FIN seulement (début inchangé)');

        await glisserSouris(await pointBordMesure(2, 'debut'), await pointMesure(0));
        const apres12 = await page.evaluate(() => window.app.lecteur.boucleLecture);
        check(apres12.debut === 0 && apres12.fin === 6, 'et la poignée GAUCHE étire par le DÉBUT seulement (fin inchangée)');

        // --- 12. Une poignée poussée au-delà du bord fixe BUTE dessus, sans jamais inverser les deux --
        await glisserSouris(await pointBordMesure(0, 'debut'), await pointMesure(7));
        const apres13 = await page.evaluate(() => window.app.lecteur.boucleLecture);
        check(apres13.debut === 6 && apres13.fin === 6,
            'la poignée GAUCHE poussée AU-DELÀ du bord droit (fixe) bute dessus (même choix que HarmoHub, voir onLoopRangeMove)');

        // --- 13. Un tap SANS glisser, PILE sur une poignée, NE SUPPRIME PAS la boucle — à la
        // différence d'un tap sur le CORPS de la bande (cas 4 plus haut) : saisir précisément un bord
        // n'est jamais le geste de « je veux l'annuler » -------------------------------------------
        await page.evaluate(() => { window.app.lecteur.definirBoucle(window.app.editeur.partition, 1, 3); window.app.dessiner(); });
        await page.waitForTimeout(100);
        const pPoignee = await pointBordMesure(1, 'debut');
        await page.mouse.click(pPoignee.x, pPoignee.y);
        await page.waitForTimeout(100);
        const apres14 = await page.evaluate(() => window.app.lecteur.boucleLecture);
        check(apres14 !== null && apres14.debut === 1 && apres14.fin === 3,
            'un tap SANS glisser pile sur une poignée laisse la boucle intacte, contrairement à un tap sur le corps de la bande');

        // --- 14. Exactement deux poignées se dessinent pour une boucle qui tient sur un seul système --
        const compteHandles = await page.evaluate(() => {
            const svg = document.querySelector('#feuille svg');
            return [...svg.querySelectorAll('rect')].filter(r => r.getAttribute('fill') === 'var(--lecture)').length;
        });
        check(compteHandles === 2, 'et il y en a bien exactement DEUX (un bord de chaque côté), ni plus ni moins');

        // --- 15. MARGE D'AFFICHAGE : le halo ne touche plus pile les bords de mesure (retour
        // utilisateur : « c'est trop proche du bord [...] sur les côtés ») ---------------------------
        const marges = await page.evaluate(() => {
            const svg = document.querySelector('#feuille svg');
            const halo = [...svg.querySelectorAll('rect')].find(r => r.getAttribute('fill') === 'var(--lecture-halo)');
            const boucle = window.app.lecteur.boucleLecture;
            const touche = window.app.page.ancrages.mesures.filter(a => a.index >= boucle.debut && a.index <= boucle.fin);
            const x1 = Math.min(...touche.map(a => a.x));
            const x2 = Math.max(...touche.map(a => a.xFin));
            return { margeGauche: +halo.getAttribute('x') - x1, margeDroite: x2 - (+halo.getAttribute('x') + +halo.getAttribute('width')) };
        });
        check(marges.margeGauche > 1 && marges.margeDroite > 1,
            'le halo affiché est bien EN RETRAIT des bords réels de mesure, des deux côtés — plus de trait collé pile dessus');

        // --- 16. Un point trop bas pour l'ANCIENNE bande (souris, 1,4 S de haut) place bien la
        // boucle avec la NOUVELLE (retour utilisateur : « je ne peux pas placer la bande orange... ») --
        await page.evaluate(() => { window.app.lecteur.retirerBoucle(); window.app.dessiner(); });
        const pointBas = await page.evaluate((i) => {
            const svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect();
            const a = window.app.page.ancrages.mesures.find(x => x.index === i);
            const S = window.app.page.geo.S;
            // 2,6 S sous la TAB : au-delà de l'ancienne borne basse (1,9 S, --  jamais atteignable à
            // la souris), toujours en-deçà de la nouvelle (3,3 S, voir BAS_BANDE_BOUCLE_TACTILE).
            const y = a.yTab + a.hauteurTab + 2.6 * S;
            return {
                x: b.left + ((a.x + a.xFin) / 2 / window.app.page.largeur) * b.width,
                y: b.top + (y / window.app.page.hauteur) * b.height,
            };
        }, 2);
        await glisserSouris(pointBas, await pointMesure(4));
        const apres16 = await page.evaluate(() => window.app.lecteur.boucleLecture);
        check(apres16 !== null && apres16.debut === 2 && apres16.fin === 4,
            'un point 2,6 S sous la TAB (hors de portée d\'une bande à la souris, 1,4 S de haut) place bien la boucle au doigt : la zone de saisie a vraiment grandi, pas seulement sur le papier');

        // --- 17. Une poignée saisie avec un écart trop grand pour l'ANCIENNE prise (1,1 S) s'attrape
        // bien avec la NOUVELLE (2,4 S) -----------------------------------------------------------
        await page.evaluate(() => { window.app.lecteur.definirBoucle(window.app.editeur.partition, 2, 5); window.app.dessiner(); });
        await page.waitForTimeout(100);
        const pointLoin = await page.evaluate(() => {
            const svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect();
            const a = window.app.page.ancrages.mesures.find(x => x.index === 2);
            const S = window.app.page.geo.S;
            const yBande = a.yTab + a.hauteurTab + 1.2 * S;
            // 1,8 S à gauche du VRAI bord : hors de portée d'une souris (prise 1,1 S), toujours
            // en-deçà de la nouvelle prise au doigt (2,4 S, voir PRISE_POIGNEE_BOUCLE_TACTILE).
            return {
                x: b.left + ((a.x - 1.8 * S) / window.app.page.largeur) * b.width,
                y: b.top + (yBande / window.app.page.hauteur) * b.height,
            };
        });
        await glisserSouris(pointLoin, await pointMesure(0));
        const apres17 = await page.evaluate(() => window.app.lecteur.boucleLecture);
        check(apres17 !== null && apres17.debut === 0 && apres17.fin === 5,
            'saisir la poignée gauche 1,8 S à côté de son vrai bord (hors de portée d\'une souris) l\'attrape bien au doigt — étire le début SEULEMENT, la fin (5) reste inchangée');

        // --- 18. TOUCH-ACTION SUR LE HALO ET LES POIGNÉES, UNE FOIS LA BOUCLE POSÉE (retour
        // utilisateur : « je n'arrive pas à définir la barre de lecture orange [...] mon téléphone
        // croit veut faire bouger l'écran lorsque j'essaye de la placer ou de l'étirer ») — le cas 10
        // plus haut ne vérifiait touch-action QUE sur la piste INVISIBLE, SANS boucle active :
        // exactement le point aveugle qui laissait passer ce bogue. Halo et poignées se dessinent
        // PAR-DESSUS cette piste UNE FOIS une boucle posée (voir marquesBoucle) — c'est donc EUX, pas
        // elle, que le doigt touche en premier dès qu'il y a quelque chose à ajuster. La boucle [0, 5]
        // posée par le cas 17 est encore en place ici.
        //
        // Le CENTRE RÉEL de chaque rectangle RENDU, jamais une approximation géométrique indépendante
        // (celle de pointMesure/pointBordMesure, pensée pour un DÉMARRAGE de glisser — l'app tolère
        // volontairement une large prise autour d'une poignée, voir poigneeBoucleAuPoint) :
        // elementFromPoint, lui, est un test pile au pixel sur un rectangle fin — sans cette marge
        // d'erreur, repéré en pratique : pointMesure(3), pourtant « au milieu » de la mesure,
        // retombait sur la piste invisible SOUS le halo (sa propre zone de saisie tactile est plus
        // HAUTE que le mince halo qu'elle centre), un premier essai qui ne prouvait donc rien de plus
        // que le cas 10.
        const toucheActionDe = (fill) => page.evaluate((fill) => {
            const svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect();
            const r = [...svg.querySelectorAll('rect')].find(r => r.getAttribute('fill') === fill);
            const cx = +r.getAttribute('x') + (+r.getAttribute('width')) / 2;
            const cy = +r.getAttribute('y') + (+r.getAttribute('height')) / 2;
            const x = b.left + (cx / window.app.page.largeur) * b.width;
            const y = b.top + (cy / window.app.page.hauteur) * b.height;
            return getComputedStyle(document.elementFromPoint(x, y)).touchAction;
        }, fill);

        check(await toucheActionDe('var(--lecture-halo)') === 'none',
            'le HALO visible de la boucle calcule bien touch-action: none, pas seulement la piste invisible dessous');
        check(await toucheActionDe('var(--lecture)') === 'none',
            'et la POIGNÉE elle-même — ce que le doigt vise PRÉCISÉMENT pour étirer — calcule aussi touch-action: none');

        // --- 19. LE DÉFILEMENT NATIF EST REFUSÉ PENDANT LE GLISSER — ET SEULEMENT PENDANT LUI -------
        // (retour utilisateur, capture à l'appui, APRÈS le correctif du cas 18 : « lorsque je place la
        // boucle orange de gauche à droite, l'écran se décale ENCORE au lieu de comprendre qu'il faut
        // uniquement placer la barre orange ».) Le cas 18 ne prouve que la moitié DÉCLARATIVE du
        // mécanisme (touch-action), et cette moitié-là ne tient pas partout : WebKit — le moteur de
        // l'iPhone d'où vient ce retour — n'honore pas `touch-action` posé sur un <rect> SVG, et
        // `preventDefault()` sur un `pointerdown` ne couvre PAS le défilement (spécification Pointer
        // Events). D'où le filet vérifié ici : voir main.js#_bloquerDefilementPendantGeste.
        //
        // « ET SEULEMENT PENDANT LUI » compte autant que le reste : un `touchmove` refusé en
        // permanence rendrait la partition impossible à parcourir au doigt — exactement ce que
        // demarrerGesteTactile préserve ailleurs. Les deux bornes sont donc mesurées, pas seulement
        // celle du milieu.
        const defilement = await page.evaluate(({ p1, p2 }) => {
            const feuille = document.getElementById('feuille');
            const envoyer = (type, x, y) => feuille.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true, pointerId: 91, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: y,
            }));
            const defilementRefuse = () => {
                const ev = new TouchEvent('touchmove', { bubbles: true, cancelable: true });
                window.dispatchEvent(ev);
                return ev.defaultPrevented;
            };
            const avant = defilementRefuse();
            envoyer('pointerdown', p1.x, p1.y);
            const pendant = defilementRefuse();
            envoyer('pointermove', p2.x, p2.y);
            envoyer('pointerup', p2.x, p2.y);
            const apres = defilementRefuse();
            return { avant, pendant, apres };
        }, { p1: await pointMesure(0), p2: await pointMesure(2) });
        check(defilement.pendant === true,
            'pendant un glisser de boucle, un touchmove est REFUSÉ (preventDefault) — le navigateur ne peut plus s\'emparer du geste pour défiler, quel que soit son support de touch-action sur du SVG');
        check(defilement.avant === false && defilement.apres === false,
            'et hors de ce geste — avant comme après — le touchmove repasse librement : le défilement au doigt de la partition reste entier');

        // --- LA BANDE SE DESSINE PENDANT QU'ON LA TRACE ---------------------------------------------
        // Retour utilisateur : « la barre de lecture orange doit se dessiner pendant que je suis en
        // train de la définir. Pour le moment, elle apparaît lorsque j'ai arrêté de cliquer. »
        //
        // CE QUI L'EN EMPÊCHAIT était réel, pas de la paresse : `dessiner()` remplace le contenu de la
        // feuille, ce qui détruit l'élément SVG portant la capture IMPLICITE du pointeur — le
        // navigateur cessait alors de livrer la suite du geste (plus aucun pointermove ni pointerup).
        // La réponse n'est pas de redessiner moins mais de capturer le pointeur sur un élément que le
        // rendu ne touche jamais : #zone-partition (voir main.js#_capturerPointeur).
        //
        // On mesure donc l'état AVANT le relâchement — le seul moment où l'ancienne version ne montrait
        // rien — et on vérifie qu'un geste de plusieurs étapes livre bien TOUTES ses étapes.
        await page.evaluate(() => { window.app.lecteur.retirerBoucle(); window.app.dessiner(); });
        await page.waitForTimeout(150);
        const d0 = await pointMesure(0);
        const d2 = await pointMesure(2);
        await page.mouse.move(d0.x, d0.y);
        await page.mouse.down();
        await page.mouse.move(d0.x + 24, d0.y, { steps: 3 });
        const enCours1 = await page.evaluate(() => window.app.lecteur.boucleLecture);
        await page.mouse.move(d2.x, d2.y, { steps: 8 });
        const enCours2 = await page.evaluate(() => ({
            boucle: window.app.lecteur.boucleLecture,
            // La bande orange est-elle RÉELLEMENT dessinée à cet instant, pas seulement enregistrée ?
            halos: document.querySelectorAll('#feuille rect.bande-boucle').length,
        }));
        await page.mouse.up();
        await page.waitForTimeout(150);
        exiger(enCours1 && enCours1.debut === 0 && enCours1.fin === 0,
            'dès les premiers pixels parcourus, la boucle existe déjà — avant tout relâchement');
        exiger(enCours2.boucle && enCours2.boucle.debut === 0 && enCours2.boucle.fin === 2,
            'et elle SUIT le geste jusqu\'à la mesure 3 : la capture du pointeur survit aux redessins');
        check(enCours2.halos > 0, 'la bande orange est bel et bien tracée à l\'écran pendant le glisser');
        check((await page.evaluate(() => window.app.lecteur.boucleLecture.fin)) === 2,
            'et le relâchement ne fait que confirmer ce qu\'on voyait déjà');

        // PLUS DE LÉGENDE (« Boucle : mesures 1 à 3 ») : la barre orange le dit elle-même désormais.
        check(!/Boucle/.test(await page.evaluate(() => document.body.innerText)),
            'aucune légende « Boucle : mesures … » ne s\'affiche plus nulle part — la bande suffit');

        // --- MODIFIER PENDANT QUE ÇA TOURNE ---------------------------------------------------------
        // Retour utilisateur : « elle doit s'adapter en temps réel aux modifications, même lorsque la
        // lecture en boucle n'est pas arrêtée ». C'est le cas où le décalage se sentait le plus : on
        // retravaille un passage en l'entendant tourner, on corrige une note, et le tour suivant
        // rejouait encore l'ancienne (voir player.js#reprogrammerSiEnCours).
        //
        // ET LES BORNES DE LA BOUCLE SE REPOSENT. `Transport.cancel()` ne les touche pas, mais elles
        // sont calculées en tics depuis des NUMÉROS de mesure : ajouter une mesure AVANT la boucle
        // déplace ce qu'elle doit encadrer, et garder les anciens tics ferait boucler à côté.
        const enBoucle = await page.evaluate(async () => {
            const ed = window.app.editeur, l = window.app.lecteur;
            ed.nouveau('guitare');
            for (let i = 0; i < 4; i++) ed.ajouterMesure(true);
            ed.appliquerDuree(4);
            ed.placerCurseur(2, 0, 0, 0); ed.saisirChiffre(5);
            await l.jouer(ed.partition, 0);
            l.definirBoucle(ed.partition, 2, 3);
            await new Promise(r => setTimeout(r, 200));
            const avant = { n: l._evenements.length, debut: String(Tone.Transport.loopStart), etat: l.etat };
            // Une note DANS la boucle
            ed.placerCurseur(2, 1, 0, 0); ed.saisirChiffre(9);
            await new Promise(r => setTimeout(r, 200));
            const apresNote = { n: l._evenements.length, etat: l.etat, loop: Tone.Transport.loop };
            // UNE SIGNATURE CHANGÉE AVANT LA BOUCLE : les bornes, elles, sont en TICS, calculées
            // depuis des numéros de mesure — une mesure qui passe de 4/4 à 2/4 raccourcit tout ce
            // qui la suit, donc la boucle doit se recalculer ou elle boucle à côté.
            ed.placerCurseur(0, 0, 0, 0); ed.definirSignature(2, 4);
            await new Promise(r => setTimeout(r, 250));
            const apresSignature = { debut: String(Tone.Transport.loopStart), etat: l.etat, loop: Tone.Transport.loop };
            l.arreter();
            return { avant, apresNote, apresSignature };
        });
        exiger(enBoucle.avant.n === 1 && enBoucle.avant.etat === 'lecture',
            'une note programmée, boucle posée sur les mesures 3-4, lecture en cours');
        check(enBoucle.apresNote.n === 2 && enBoucle.apresNote.etat === 'lecture' && enBoucle.apresNote.loop,
            'une note écrite DANS la boucle pendant qu\'elle tourne rejoint aussitôt ce qui sonne — sans couper la lecture ni la boucle');
        check(enBoucle.apresSignature.debut !== enBoucle.avant.debut && enBoucle.apresSignature.loop && enBoucle.apresSignature.etat === 'lecture',
            `raccourcir une mesure AVANT la boucle recalcule ses bornes (${enBoucle.avant.debut} -> ${enBoucle.apresSignature.debut}), au lieu de boucler à côté`);
        // --- LA BANDE SUIT SES MESURES, PAS LEURS NUMÉROS -------------------------------------------
        // LE DÉFAUT, longtemps signalé et corrigé ici : la boucle se repérait par NUMÉRO de mesure.
        // Insérer une mesure avant elle laissait la bande orange sur les mêmes numéros pendant que la
        // musique glissait d'un cran dessous — on rebouclait sur un autre passage que celui qu'on
        // avait encadré, sans un mot.
        //
        // LA CORRECTION est un ancrage aux `id` des mesures (voir player.js#reancrerBoucle), pas un
        // décalage commande par commande. C'est ce que les cas ci-dessous éprouvent : on ne vérifie
        // pas « ajouterMesure décale bien de 1 », on vérifie que la boucle borne TOUJOURS LES MÊMES
        // MESURES, quel que soit le geste — y compris l'annulation, que six décalages éparpillés
        // n'auraient pas couverte.
        const idsDeLaBoucle = () => page.evaluate(() => {
            const l = window.app.lecteur, m = window.app.editeur.partition.mesures;
            if (!l.boucleLecture) return null;
            return {
                debut: l.boucleLecture.debut,
                fin: l.boucleLecture.fin,
                idDebut: m[l.boucleLecture.debut] && m[l.boucleLecture.debut].id,
                idFin: m[l.boucleLecture.fin] && m[l.boucleLecture.fin].id,
                nMesures: m.length,
            };
        });

        const ancrage = await page.evaluate(() => {
            const ed = window.app.editeur, l = window.app.lecteur;
            ed.nouveau('guitare');
            for (let i = 0; i < 6; i++) ed.ajouterMesure(true);
            // Une note repère DANS la boucle, pour pouvoir dire si la bande encadre encore la même
            // musique — un numéro identique ne prouverait rien.
            ed.placerCurseur(3, 0, 0, 0); ed.appliquerDuree(4); ed.saisirChiffre(7);
            l.definirBoucle(ed.partition, 3, 4);
            return { ids: [ed.partition.mesures[3].id, ed.partition.mesures[4].id] };
        });
        const pose = await idsDeLaBoucle();
        exiger(pose && pose.debut === 3 && pose.fin === 4 && pose.idDebut === ancrage.ids[0],
            'préalable : boucle posée sur les mesures 4-5 (index 3-4), d\'un morceau de dix mesures');

        // 1. INSERTION AVANT la boucle : les numéros avancent d'un cran, les MESURES bornées ne
        //    changent pas.
        await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.placerCurseur(0, 0, 0, 0);
            ed.ajouterMesure(false);   // insère AVANT la mesure 1
        });
        await page.waitForTimeout(150);
        const apresInsertion = await idsDeLaBoucle();
        check(apresInsertion.debut === 4 && apresInsertion.fin === 5,
            `insérer une mesure AVANT la boucle décale ses numéros (3-4 -> ${apresInsertion.debut}-${apresInsertion.fin})`);
        check(apresInsertion.idDebut === ancrage.ids[0] && apresInsertion.idFin === ancrage.ids[1],
            'et ce sont TOUJOURS LES MÊMES MESURES qu\'elle borne — la bande n\'a pas glissé sous la musique');
        check((await page.evaluate(() => {
            const m = window.app.editeur.partition.mesures[window.app.lecteur.boucleLecture.debut];
            return m.voix[0].evenements.some(e => e.notes.some(n => n.frette === 7));
        })), 'la note repère est bien encore dans la première mesure de la boucle');

        // 2. INSERTION APRÈS la boucle : rien ne doit bouger. Comparé à l'état JUSTE AVANT cette
        //    insertion, et non à des numéros écrits en dur : la vérification reste alors un signal à
        //    elle seule, au lieu de répéter l'échec du cas précédent.
        const avantApres = await idsDeLaBoucle();
        await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.placerCurseur(ed.partition.mesures.length - 1, 0, 0, 0);
            ed.ajouterMesure(true);
        });
        await page.waitForTimeout(150);
        const apresApres = await idsDeLaBoucle();
        check(apresApres.debut === avantApres.debut && apresApres.fin === avantApres.fin
              && apresApres.nMesures === avantApres.nMesures + 1,
            `insérer une mesure APRÈS la boucle ne la déplace pas d'un cran — seul ce qui précède compte (${avantApres.debut}-${avantApres.fin} -> ${apresApres.debut}-${apresApres.fin})`);

        // 3. ANNULATION : le cas qu'un décalage commande par commande aurait manqué. Ctrl+Z défait
        //    l'insertion, donc la boucle doit RETROUVER ses anciens numéros sans rien perdre.
        await page.evaluate(() => { window.app.editeur.annuler(); window.app.editeur.annuler(); });
        await page.waitForTimeout(150);
        const apresAnnulation = await idsDeLaBoucle();
        check(apresAnnulation.debut === 3 && apresAnnulation.fin === 4 && apresAnnulation.nMesures === 10,
            `annuler les deux insertions ramène la boucle sur 3-4 (reçu ${apresAnnulation.debut}-${apresAnnulation.fin})`);
        check(apresAnnulation.idDebut === ancrage.ids[0] && apresAnnulation.idFin === ancrage.ids[1],
            'et toujours les mêmes mesures : les `id` traversent la copie profonde de l\'historique');

        // 4. SUPPRESSION D'UNE MESURE AVANT la boucle : les numéros reculent, les mesures tiennent.
        await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.placerCurseur(0, 0, 0, 0);
            ed.supprimerMesure();
        });
        await page.waitForTimeout(150);
        const apresSuppression = await idsDeLaBoucle();
        check(apresSuppression.debut === 2 && apresSuppression.fin === 3
              && apresSuppression.idDebut === ancrage.ids[0],
            `supprimer une mesure avant la boucle recule ses numéros (reçu ${apresSuppression.debut}-${apresSuppression.fin}), mêmes mesures bornées`);

        // 5. SUPPRESSION D'UNE ANCRE : la boucle se resserre sur celle qui reste, jamais une bande
        //    qui réapparaît ailleurs que là où on l'avait posée.
        await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.placerCurseur(window.app.lecteur.boucleLecture.debut, 0, 0, 0);
            ed.supprimerMesure();
        });
        await page.waitForTimeout(150);
        const apresAncrePerdue = await idsDeLaBoucle();
        check(apresAncrePerdue && apresAncrePerdue.debut === apresAncrePerdue.fin
              && apresAncrePerdue.idDebut === ancrage.ids[1],
            `supprimer la mesure de DÉBUT resserre la boucle sur celle de fin, qui existe encore (reçu ${JSON.stringify([apresAncrePerdue.debut, apresAncrePerdue.fin])})`);

        // 6. LES DEUX ANCRES PERDUES : plus rien à border, la bande s'en va.
        await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.placerCurseur(window.app.lecteur.boucleLecture.debut, 0, 0, 0);
            ed.supprimerMesure();
        });
        await page.waitForTimeout(150);
        check((await idsDeLaBoucle()) === null,
            'et supprimer la dernière mesure qu\'elle bornait retire la boucle, plutôt que de la laisser pointer dans le vide');
        check((await page.evaluate(() => window.Tone && window.Tone.Transport.loop)) === false,
            'l\'horloge cesse de boucler du même coup — pas une boucle fantôme qui tournerait encore');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }

    // ============================================================================================
    // LA BANDE SOUS LE DOIGT — aperçu au pixel, calage au temps, fantôme de survol.
    //
    // CE QU'ILS PROTÈGENT (retour utilisateur) : « il est difficile de savoir quand je la mets en
    // place ou non, car je ne la vois pas apparaître sous mon doigt ou sous le clic de souris »,
    // « pareil quand je l'étire », et « avant que je la définisse, les utilisateurs ne sauront pas
    // forcément qu'il est possible de placer une barre de lecture ».
    //
    // LE DÉFAUT N'ÉTAIT PAS QUE RIEN NE SE DESSINAIT — une version antérieure dessinait bien pendant
    // le geste, et un banc plus haut le vérifie encore. C'est qu'elle ne bougeait qu'au
    // FRANCHISSEMENT D'UNE MESURE : entre deux mesures, glisser ne changeait rien à l'écran. D'où la
    // vérification centrale ci-dessous, qui ne se contente pas de compter les rectangles mais mesure
    // PLUSIEURS LARGEURS DISTINCTES À L'INTÉRIEUR D'UNE SEULE MESURE — ce que l'ancienne version ne
    // pouvait produire par construction.
    const geste = await ouvrirApp({ viewport: { width: 1320, height: 900 } });
    try {
        const p = geste.page;
        await p.evaluate(() => {
            const ed = window.app.editeur;
            while (ed.partition.mesures.length < 6) ed.ajouterMesure();
            ed.prevenir('document'); window.app.dessiner();
        });
        /** Point d'écran à une fraction de la mesure `i`, sur la bande. */
        const pt = (i, f) => p.evaluate(({ i, f }) => {
            const app = window.app, svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect();
            const a = app.page.ancrages.mesures.find(m => m.index === i);
            const S = app.page.geo.S, y = a.yTab + a.hauteurTab + 1.2 * S;
            return { x: b.left + ((a.x + (a.xFin - a.x) * f) / app.page.largeur) * b.width,
                     y: b.top + (y / app.page.hauteur) * b.height };
        }, { i, f });
        /** L'aperçu tel qu'il est RÉELLEMENT dans le SVG à cet instant. */
        const apercu = () => p.evaluate(() => {
            const g = document.querySelector('#apercu-boucle');
            if (!g) return null;
            const rects = [...g.childNodes].map(r => ({
                x: +r.getAttribute('x'), w: +r.getAttribute('width'),
                bout: r.getAttribute('class') === 'bout-apercu',
            }));
            return { classe: g.getAttribute('class'), bandes: rects.filter(r => !r.bout), bouts: rects.filter(r => r.bout).length };
        });
        const sansBoucle = async () => {
            await p.evaluate(() => { window.app.lecteur.retirerBoucle(); window.app.dessiner(); });
            await p.waitForTimeout(120);
        };

        // --- LE FANTÔME DE SURVOL ---------------------------------------------------------------
        await sansBoucle();
        const p2 = await pt(2, 0.5);
        await p.mouse.move(p2.x, p2.y);
        await p.waitForTimeout(150);
        const fantome = await apercu();
        const mes2 = await p.evaluate(() => {
            const a = window.app.page.ancrages.mesures.find(m => m.index === 2);
            return { x: a.x, w: a.xFin - a.x };
        });
        exiger(fantome && fantome.classe === 'fantome-boucle' && fantome.bandes.length === 1,
            'survoler la bande sans aucune boucle fait apparaître un fantôme — la seule chose qui dise qu\'on peut en poser une');
        check(Math.abs(fantome.bandes[0].x - mes2.x) < 1 && Math.abs(fantome.bandes[0].w - mes2.w) < 1,
            `et il couvre EXACTEMENT la mesure survolée, ni plus ni moins (${fantome.bandes[0].w.toFixed(0)}px pour ${mes2.w.toFixed(0)})`);
        check(fantome.bouts === 0,
            'sans les bouts pleins de la vraie bande : il invite à poser, il ne prétend pas être une boucle');

        // --- LE CLIC POSE LA MESURE SURVOLÉE ----------------------------------------------------
        await p.mouse.down(); await p.mouse.up();
        await p.waitForTimeout(180);
        const posee = await p.evaluate(() => window.app.lecteur.boucleLecture);
        exiger(posee && posee.debut === 2 && posee.fin === 2,
            'et cliquer pose la boucle sur CETTE mesure — ce que le fantôme montrait, exactement');
        // LE FANTÔME SE TAIT DÈS QU'UNE BOUCLE EXISTE : la bande posée est alors elle-même
        // l'affordance, et proposer « clique pour poser » là où cliquer RETIRE serait un mensonge.
        await p.mouse.move(p2.x + 4, p2.y);
        await p.waitForTimeout(150);
        const apresPose = await apercu();
        check(apresPose === null || apresPose.bandes.length === 0,
            'une boucle en place fait taire le fantôme : plus rien ne propose d\'en poser une par-dessus');

        // --- L'APERÇU SUIT LE PIXEL, DANS UNE SEULE MESURE --------------------------------------
        await sansBoucle();
        const depart = await pt(1, 0.08);
        await p.mouse.move(depart.x, depart.y);
        await p.mouse.down();
        const largeurs = [];
        for (const f of [0.3, 0.5, 0.7, 0.92]) {
            const q = await pt(1, f);
            await p.mouse.move(q.x, q.y, { steps: 2 });
            const a = await apercu();
            largeurs.push(a && a.bandes.length ? a.bandes[0].w : null);
        }
        const enCours = await apercu();
        const bandeFigee = await p.evaluate(() => document.querySelectorAll('#feuille rect.bande-boucle').length);
        await p.mouse.up();
        await p.waitForTimeout(180);

        exiger(largeurs.every(w => w !== null),
            'un aperçu est tracé à chaque étape du glisser, pas seulement au relâchement');
        exiger(new Set(largeurs.map(w => Math.round(w))).size === largeurs.length,
            `et il prend QUATRE largeurs distinctes À L'INTÉRIEUR D'UNE SEULE MESURE : ${largeurs.map(w => w.toFixed(0)).join(' -> ')}px — l'ancienne version, calée à la mesure, n'en aurait montré qu'une`);
        check(largeurs.every((w, i) => i === 0 || w > largeurs[i - 1]),
            'et il grandit dans le sens du geste, sans reculer');
        check(enCours.classe === 'apercu-boucle' && enCours.bouts === 2,
            'l\'aperçu porte les deux bouts pleins de la bande posée (mesuré en capture : le halo seul est trop pâle pour se remarquer sous le doigt)');

        // --- AU RELÂCHEMENT : l'aperçu s'efface, la vraie bande prend sa place -------------------
        const apres = await p.evaluate(() => ({
            apercu: !!document.querySelector('#apercu-boucle'),
            halos: document.querySelectorAll('#feuille rect.bande-boucle').length,
            boucle: window.app.lecteur.boucleLecture,
        }));
        exiger(apres.apercu === false && apres.halos > 0 && !!apres.boucle,
            'au relâchement l\'aperçu disparaît et la vraie bande le remplace — jamais les deux à la fois');

        // --- PAS DEUX BANDES PENDANT LE GESTE ---------------------------------------------------
        // On redéfinit par-dessus une boucle EXISTANTE : sans le masquage, l'ancienne resterait
        // gravée sous l'aperçu et on ne saurait plus laquelle on est en train de tracer.
        const d3 = await pt(3, 0.2);
        await p.mouse.move(d3.x, d3.y); await p.mouse.down();
        const q3 = await pt(4, 0.8);
        await p.mouse.move(q3.x, q3.y, { steps: 4 });
        const pendant = await p.evaluate(() => document.querySelectorAll('#feuille rect.bande-boucle:not([fill="rgba(255, 152, 0, 0)"])').length);
        const halosPendant = await p.evaluate(() => {
            // Les pistes de saisie INVISIBLES restent (une par système) ; ce qu'on compte ici, c'est
            // le halo VISIBLE et ses poignées, qui doivent avoir disparu le temps du geste.
            return [...document.querySelectorAll('#feuille rect.bande-boucle')]
                .filter(r => (r.getAttribute('fill') || '') !== 'rgba(255, 152, 0, 0)').length;
        });
        await p.mouse.up(); await p.waitForTimeout(180);
        check(halosPendant === 0,
            `pendant le geste la bande DÉJÀ POSÉE s'efface : l'aperçu est seul à l'écran (${halosPendant} halo visible, ${bandeFigee} pistes de saisie au total)`);

        // --- ÉTIRER UNE POIGNÉE SUIT AUSSI LE PIXEL ---------------------------------------------
        await p.evaluate(() => { window.app.lecteur.definirBoucle(window.app.editeur.partition, 1, 2); window.app.dessiner(); });
        await p.waitForTimeout(150);
        const poignee = await p.evaluate(() => {
            const app = window.app, svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect();
            const a = app.page.ancrages.mesures.find(m => m.index === 2);
            const S = app.page.geo.S, y = a.yTab + a.hauteurTab + 1.2 * S;
            return { x: b.left + (a.xFin / app.page.largeur) * b.width, y: b.top + (y / app.page.hauteur) * b.height };
        });
        await p.mouse.move(poignee.x, poignee.y); await p.mouse.down();
        const etires = [];
        for (const f of [0.25, 0.5, 0.75]) {
            const q = await pt(3, f);
            await p.mouse.move(q.x, q.y, { steps: 2 });
            const a = await apercu();
            etires.push(a ? a.bandes.reduce((t, r) => t + r.w, 0) : null);
        }
        await p.mouse.up(); await p.waitForTimeout(180);
        exiger(etires.every(w => w !== null) && new Set(etires.map(w => Math.round(w))).size === etires.length,
            `étirer une poignée suit AUSSI le pixel : trois largeurs distinctes dans une seule mesure (${etires.map(w => w.toFixed(0)).join(' -> ')}px)`);
        check(etires.every((w, i) => i === 0 || w > etires[i - 1]),
            'et l\'aperçu grandit dans le sens où l\'on tire, le bord opposé restant fixe');

        // --- LES BORNES FINES SURVIVENT À L'ÉDITION ---------------------------------------------
        // L'ancrage par `id` valait pour des mesures entières ; il doit valoir aussi pour un décalage
        // DANS la mesure — sans quoi le calage au temps aurait rouvert le défaut que l'ancrage avait
        // fermé (une boucle qui reste sur ses numéros pendant que la musique glisse dessous).
        await p.evaluate(() => {
            const app = window.app;
            app.lecteur.definirBoucle(app.editeur.partition, 2, 3, { debutDansMesure: 2, finDansMesure: 3 });
            app.dessiner();
        });
        const avantInsert = await p.evaluate(() => ({ ...window.app.lecteur.boucleLecture }));
        // `ajouterMesure(false)` = INSÉRER AVANT le curseur. Une première version de cette
        // vérification appelait `ajouterMesureAvant()`/`insererMesure()`, qui n'existent NI l'un NI
        // l'autre : l'insertion n'avait donc pas lieu, les décalages n'avaient aucune raison de
        // bouger, et la vérification passait par pure vacuité. D'où le préalable ci-dessous, qui
        // EXIGE d'abord que l'ancre ait bougé — sans quoi la conservation des décalages ne prouve
        // rien du tout.
        await p.evaluate(() => {
            const ed = window.app.editeur;
            ed.curseur.mesure = 0;
            ed.ajouterMesure(false);
            ed.prevenir('document');
        });
        await p.waitForTimeout(200);
        const apresInsert = await p.evaluate(() => ({
            boucle: { ...window.app.lecteur.boucleLecture },
            mesures: window.app.editeur.partition.mesures.length,
        }));
        exiger(apresInsert.boucle.debut === avantInsert.debut + 1,
            `préalable : l'insertion a bien eu lieu et l'ancre a suivi la musique (mesure ${avantInsert.debut} -> ${apresInsert.boucle.debut})`);
        check(apresInsert.boucle.debutDansMesure === avantInsert.debutDansMesure
            && apresInsert.boucle.finDansMesure === avantInsert.finDansMesure,
            `et les décalages fins sont intacts, comptés depuis leur ancre (${apresInsert.boucle.debutDansMesure} / ${apresInsert.boucle.finDansMesure})`);

        // --- LA SURBRILLANCE DES POIGNÉES, ET UN CURSEUR QUI NE MENT PLUS ----------------------
        // Retour utilisateur : « j'ai du mal à atteindre les poignées […] en plus du curseur qui
        // change, il faut mettre en surbrillance les 2 petites poignées ». Et le curseur MENTAIT :
        // `.bande-boucle` portait `ew-resize` sur TOUTE la bande, y compris là où glisser REDÉFINIT
        // la boucle au lieu d'en étirer un bord — il annonçait partout un geste qui n'existe qu'aux
        // deux extrémités, donc rien ne changeait quand on arrivait enfin sur une poignée.
        await p.evaluate(() => {
            window.app.lecteur.definirBoucle(window.app.editeur.partition, 1, 3);
            window.app.dessiner();
        });
        await p.waitForTimeout(150);
        /** Point d'écran sur un bord de mesure, à la hauteur de la bande. */
        const surBord = (i, bord) => p.evaluate(({ i, bord }) => {
            const app = window.app, svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect(), ech = b.width / app.page.largeur;
            const a = app.page.ancrages.mesures.find(m => m.index === i);
            const sys = app.page.ancrages.systemes.find(s2 => s2.index === a.systeme);
            // Même raison que pointBordMesure plus haut : on vise la poignée DESSINÉE, pas un bord de
            // mesure recalculé, qui n'est le même point ni sur un début de système ni sur une borne fine.
            const dessinee = bord === 'debut' || bord === 'fin'
                ? svg.querySelector(bord === 'debut' ? '.poignee-debut' : '.poignee-fin') : null;
            const x = dessinee
                ? +dessinee.getAttribute('x') + (+dessinee.getAttribute('width')) / 2
                : (bord === 'debut' ? a.x : (bord === 'fin' ? a.xFin : (a.x + a.xFin) / 2));
            return { x: b.left + x * ech, y: b.top + (sys.yBas + 1.2 * app.page.geo.S) * ech };
        }, { i, bord });
        const etatPoignees = () => p.evaluate(() => {
            const svg = document.querySelector('#feuille svg');
            const liste = [...svg.querySelectorAll('.poignee-boucle')];
            const allumees = liste.filter(el => el.classList.contains('poignee-survolee'));
            const sous = document.elementFromPoint(window.__mx, window.__my);
            return {
                total: liste.length,
                allumees: allumees.length,
                laquelle: allumees.map(el => (el.classList.contains('poignee-debut') ? 'debut' : 'fin')),
                // L'AGRANDISSEMENT est mesuré sur la matrice calculée, pas sur la règle CSS : une
                // transition non appliquée (propriété inconnue, transform-box absent) laisserait la
                // classe posée et la poignée inchangée — le banc passerait sans rien montrer.
                transform: allumees.length ? getComputedStyle(allumees[0]).transform : 'none',
                curseurSousLePointeur: sous ? getComputedStyle(sous).cursor : null,
            };
        });
        const viser = async (i, bord) => {
            const pt = await surBord(i, bord);
            await p.mouse.move(pt.x, pt.y);
            await p.evaluate(({ x, y }) => { window.__mx = x; window.__my = y; }, pt);
            await p.waitForTimeout(140);
            return etatPoignees();
        };

        const surDebut = await viser(1, 'debut');
        exiger(surDebut.total === 2 && surDebut.allumees === 1 && surDebut.laquelle[0] === 'debut',
            'survoler la poignée de DÉBUT l\'allume, elle seule — les deux poignées ne s\'allument jamais ensemble');
        check(surDebut.transform !== 'none' && surDebut.transform !== 'matrix(1, 0, 0, 1, 0, 0)',
            `et elle grandit vraiment à l'écran, pas seulement dans une classe (${surDebut.transform})`);
        exiger(surDebut.curseurSousLePointeur === 'ew-resize',
            'le curseur annonce l\'étirement SUR la poignée');

        const surFin = await viser(3, 'fin');
        check(surFin.allumees === 1 && surFin.laquelle[0] === 'fin',
            'la poignée de FIN s\'allume à son tour, et la première s\'éteint');

        const surCorps = await viser(2, 'milieu');
        exiger(surCorps.allumees === 0,
            'au MILIEU de la bande, aucune poignée n\'est allumée');
        check(surCorps.curseurSousLePointeur === 'pointer',
            `et le curseur y annonce autre chose que l'étirement (${surCorps.curseurSousLePointeur}) — il promettait « ew-resize » partout jusqu'ici`);

        // --- ANNULER / RÉTABLIR COUVRE LA BANDE -------------------------------------------------
        // Retour utilisateur : « le bouton undo/redo doit aussi concerner la mise en place de la
        // barre de lecture ». La boucle vit dans le LECTEUR, délibérément hors du document — elle
        // voyage donc dans l'historique comme une ANNEXE opaque, que l'éditeur ne lit jamais (voir
        // Editeur.lireAnnexe/ecrireAnnexe et main.js#brancherAnnexeHistorique).
        const remise = async () => {
            await p.evaluate(() => {
                const ed = window.app.editeur;
                ed.passe.length = 0; ed.futur.length = 0;
                window.app.lecteur.retirerBoucle();
                window.app.dessiner();
            });
            await p.waitForTimeout(140);
        };
        const histoire = () => p.evaluate(() => ({
            boucle: window.app.lecteur.boucleLecture
                ? `${window.app.lecteur.boucleLecture.debut}-${window.app.lecteur.boucleLecture.fin}` : null,
            passe: window.app.editeur.passe.length,
            futur: window.app.editeur.futur.length,
            // Les étapes qui ont VRAIMENT touché au document : c'est là-dessus que s'appuient les
            // garde-fous « travail non enregistré ».
            etapesDocument: window.app.editeur.etapesDocument(),
            loop: window.Tone ? window.Tone.Transport.loop : null,
            notes: window.app.editeur.partition.mesures[0].voix[0].evenements
                .filter(ev => ev.notes && ev.notes.length).length,
        }));
        const cliquerMesure = async (i) => {
            const pt = await surBord(i, 'milieu');
            await p.mouse.move(pt.x, pt.y);
            await p.mouse.down(); await p.mouse.up();
            await p.waitForTimeout(170);
        };
        const annuler = async () => { await p.evaluate(() => window.app.editeur.annuler()); await p.waitForTimeout(170); };

        await remise();
        await cliquerMesure(2);
        const bandePosee = await histoire();
        exiger(bandePosee.boucle === '2-2' && bandePosee.passe === 1,
            `poser la bande crée UNE étape d'annulation (${bandePosee.passe})`);
        await annuler();
        const defaite = await histoire();
        exiger(defaite.boucle === null && defaite.futur === 1,
            'Ctrl+Z retire la bande — c\'est la demande, littéralement');
        check(defaite.loop === false,
            'et l\'horloge cesse de boucler avec elle : ce n\'est pas qu\'un dessin qui disparaît');
        await p.evaluate(() => window.app.editeur.retablir());
        await p.waitForTimeout(170);
        const refaite = await histoire();
        exiger(refaite.boucle === '2-2' && refaite.loop === true,
            'et Ctrl+Y la remet exactement où elle était');

        // UNE ÉTAPE PAR GESTE, jamais une par temps franchi. Pendant un glisser la boucle est
        // reposée dans le lecteur à chaque changement de plage calée (pour que ça s'entende tout de
        // suite) : sans le regroupement, défaire un seul geste demanderait autant de Ctrl+Z qu'il a
        // traversé de temps.
        await remise();
        const depGlisse = await surBord(1, 'debut');
        await p.mouse.move(depGlisse.x, depGlisse.y);
        await p.mouse.down();
        for (const i of [2, 3, 4]) {
            const q = await surBord(i, 'milieu');
            await p.mouse.move(q.x, q.y, { steps: 4 });
        }
        await p.mouse.up();
        await p.waitForTimeout(200);
        const apresGlisse = await histoire();
        exiger(apresGlisse.passe === 1,
            `un glisser traversant quatre mesures ne coûte qu'UNE étape (${apresGlisse.passe}), pas une par temps franchi`);
        await annuler();
        check((await histoire()).boucle === null,
            'et un seul Ctrl+Z défait tout le geste');

        // UNE BANDE N'EST PAS DU TRAVAIL À SAUVER. `memoriserAnnexe` ne touche pas `modifieLe`, et
        // les garde-fous comptent `etapesDocument()` : sans cela, poser une barre orange ferait
        // réclamer un enregistrement à la fermeture pour quelque chose qui n'est même pas dans le
        // fichier.
        await remise();
        await cliquerMesure(3);
        const gardeFou = await histoire();
        exiger(gardeFou.passe === 1 && gardeFou.etapesDocument === 0,
            'la bande peuple l\'historique (1 étape) SANS compter comme une modification du document (0)');

        // LES DEUX HISTOIRES S'ENTRELACENT SANS SE MÉLANGER — le cas qui prouve que l'annexe suit
        // bien chaque étape, et pas seulement la dernière.
        await remise();
        await cliquerMesure(2);                                   // 1. poser en 2
        await p.evaluate(() => { window.app.editeur.curseur.mesure = 0; window.app.editeur.saisirChiffre(7); });
        await p.waitForTimeout(200);                              // 2. écrire une note
        await cliquerMesure(2);                                   // 3. retirer (un clic sur la bande)
        await cliquerMesure(5);                                   // 4. poser en 5
        const avantRemontee = await histoire();
        exiger(avantRemontee.boucle === '5-5' && avantRemontee.notes === 1 && avantRemontee.etapesDocument === 1,
            `préalable : boucle en 5, une note écrite, et UNE seule étape de document (${avantRemontee.etapesDocument})`);
        const remontee = [];
        for (let i = 0; i < 4; i++) { await annuler(); remontee.push(await histoire()); }
        check(remontee[0].boucle === null,
            'en remontant : défaire la pose en 5 la retire');
        check(remontee[1].boucle === '2-2',
            'défaire le retrait fait revenir celle de la mesure 2');
        exiger(remontee[2].notes === 0 && remontee[2].boucle === '2-2',
            'défaire la NOTE ne touche pas à la bande — les deux histoires ne se mélangent pas');
        check(remontee[3].boucle === null,
            'et défaire la première pose retire la bande : on est revenu au point de départ');

        check(geste.erreurs.length === 0,
            'aucune erreur JavaScript pendant les gestes' + (geste.erreurs.length ? ' — ' + geste.erreurs.join(' | ') : ''));
    } finally { await geste.fermer(); }

    // ============================================================================================
    // LA POIGNÉE SE PREND LÀ OÙ ELLE SE VOIT — et un clic manqué n'efface plus la bande.
    //
    // CE QU'ILS PROTÈGENT (retour utilisateur, capture à l'appui) : « j'ai une barre de lecture
    // orange. Mais je ne peux plus attraper de poignée sur la droite, je suis obligé de redessiner la
    // barre. En somme, je la trouve plutôt instable, souvent je la supprime sans faire exprès, où les
    // fonctions à la souris ne sont pas claires. »
    //
    // UN SEUL DÉFAUT, TROIS SYMPTÔMES. La bande était DESSINÉE d'après les bornes fines
    // (player.js#bornesBoucle, depuis qu'une boucle se cale au temps) et ATTRAPÉE d'après les seuls
    // bords de mesure — deux calculs séparés du même x. MESURÉ à S=9 sur quatre mesures de noires,
    // rayon de prise 1,1 × S = 9,9 px :
    //   • poignée de DÉBUT sur la 1re mesure : dessinée à 189,2, cherchée à 119,8 — 69,3 px d'écart,
    //     SEPT fois le rayon (le bord de mesure y inclut la clef et le chiffrage) ;
    //   • poignée de FIN d'une boucle finissant au 3e temps : dessinée à 471,8, cherchée à 574,4 —
    //     102,6 px, DIX fois le rayon.
    // Donc : poignées insaisissables, surbrillance au survol morte (elle interroge la même méthode),
    // et le clic manqué retombant sur le geste générique de la bande, qui RETIRAIT la boucle. Les
    // trois se corrigent en une seule lecture partagée (main.js#bordsBoucleDuSysteme).
    //
    // ET LA RÈGLE DU CLIC IMMOBILE SE LIT DÉSORMAIS SUR CE QU'ON VOIT (pointSurLaBoucle) : cliquer LA
    // BARRE la retire, cliquer la piste VIDE y pose la boucle. Avant, n'importe quel clic immobile
    // l'effaçait dès qu'elle existait — même à l'autre bout de la ligne, sans rien d'orange sous le
    // pointeur.
    const poign = await ouvrirApp({ viewport: { width: 1320, height: 900 } });
    try {
        const pg = poign.page;
        await pg.evaluate(() => {
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.placerCurseur(0, 0, 0, 0);
            const n = (v, f) => { ed.appliquerDuree(v); ed.saisirChiffre(f); };
            for (let m = 0; m < 4; m++) for (const f of [0, 2, 3, 5]) n(4, f);
        });
        await pg.waitForTimeout(200);

        /** Point d'écran au milieu vertical de la bande de boucle du 1er système, à l'abscisse `x`. */
        const surLaBande = (x) => pg.evaluate((x) => {
            const app = window.app;
            const boite = app.el.feuille.querySelector('svg').getBoundingClientRect();
            const sys = app.page.ancrages.systemes[0];
            const S = app.page.geo.S;
            const y = sys.yBas + (1.0 + app.basBandeDuSysteme(sys)) / 2 * S;
            return { x: boite.left + x / (app.page.largeur / boite.width),
                     y: boite.top + y / (app.page.hauteur / boite.height) };
        }, x);

        /** Pose une boucle, puis rend l'abscisse DESSINÉE de chaque poignée et ce que la PRISE y répond. */
        const poserEtSonder = (debut, fin, fines) => pg.evaluate(([d, f, fi]) => {
            const app = window.app;
            app.lecteur.definirBoucle(app.editeur.partition, d, f, fi);
            app.dessiner();
            const svg = app.el.feuille.querySelector('svg');
            const boite = svg.getBoundingClientRect();
            const bande = svg.querySelector('.bande-boucle');
            const yb = +bande.getAttribute('y') + (+bande.getAttribute('height')) / 2;
            const clientY = boite.top + yb / (app.page.hauteur / boite.height);
            const versClient = (x) => boite.left + x / (app.page.largeur / boite.width);
            const milieuDe = (sel) => {
                const e = svg.querySelector(sel);
                return e ? +e.getAttribute('x') + (+e.getAttribute('width')) / 2 : null;
            };
            const xDebut = milieuDe('.poignee-debut'), xFin = milieuDe('.poignee-fin');
            return {
                xDebut, xFin,
                priseDebut: xDebut == null ? null : app.poigneeBoucleAuPoint(versClient(xDebut), clientY),
                priseFin: xFin == null ? null : app.poigneeBoucleAuPoint(versClient(xFin), clientY),
            };
        }, [debut, fin, fines]);

        // --- A. LES DEUX POIGNÉES SE PRENNENT, MESURE ENTIÈRE COMME BORNE FINE --------------------
        const casPoignees = [
            ['1re mesure entière (clef et chiffrage compris)', 0, 0, {}],
            ['deux mesures entières', 0, 1, {}],
            ['fin au 3e temps de la 2e mesure', 0, 1, { finDansMesure: 2 }],
            ['début au 2e temps, fin au 3e', 0, 1, { debutDansMesure: 1, finDansMesure: 2 }],
        ];
        for (const [nom, d, f, fi] of casPoignees) {
            const r = await poserEtSonder(d, f, fi);
            if (!exiger(r.xDebut != null && r.xFin != null, `${nom} : les deux poignées sont dessinées`)) continue;
            check(r.priseDebut === 'debut',
                `${nom} : la poignée de DÉBUT s'attrape là où elle se voit (x=${r.xDebut.toFixed(1)}, prise « ${r.priseDebut} »)`);
            check(r.priseFin === 'fin',
                `${nom} : la poignée de FIN s'attrape là où elle se voit (x=${r.xFin.toFixed(1)}, prise « ${r.priseFin} »)`);
        }

        // --- B. LE GESTE COMPLET : ÉTIRER LA POIGNÉE DE FIN ---------------------------------------
        const avantEtirement = await poserEtSonder(0, 1, { finDansMesure: 2 });
        const pf = await surLaBande(avantEtirement.xFin);
        const cible = await surLaBande(740);
        await pg.mouse.move(pf.x, pf.y);
        const survol = await pg.evaluate(([x, y]) => window.app.poigneeBoucleAuPoint(x, y), [pf.x, pf.y]);
        check(survol === 'fin',
            `le SURVOL de la poignée de fin la reconnaît (« ${survol} ») — c'est la même méthode qui allume `
            + 'la surbrillance et change le curseur en ↔, restée muette tant que les deux x divergeaient');
        await pg.mouse.down();
        await pg.mouse.move(cible.x, cible.y, { steps: 8 });
        await pg.mouse.up();
        await pg.waitForTimeout(150);
        const apres = await pg.evaluate(() => ({ ...window.app.lecteur.boucleLecture }));
        check(apres.debut === 0 && apres.fin > 1,
            `étirer cette poignée allonge la boucle sans la redessiner (mesures ${apres.debut + 1}-${apres.fin + 1}) : `
            + 'le début n\'a pas bougé');

        // --- C. LE CLIC IMMOBILE : SUR LA BARRE IL RETIRE, À CÔTÉ IL POSE -------------------------
        await poserEtSonder(0, 1, {});
        const dedans = await surLaBande(300);
        check(await pg.evaluate(([x, y]) => window.app.pointSurLaBoucle(x, y), [dedans.x, dedans.y]),
            'préalable : ce point est bien SUR la barre orange');
        await pg.mouse.move(dedans.x, dedans.y); await pg.mouse.down(); await pg.mouse.up();
        await pg.waitForTimeout(150);
        check(await pg.evaluate(() => window.app.lecteur.boucleLecture) === null,
            'un clic immobile SUR la barre la retire — le geste se lit sur ce qu\'on voit, et reste le seul moyen tactile d\'annuler');

        await poserEtSonder(0, 0, {});
        const dehors = await surLaBande(700);
        check(!(await pg.evaluate(([x, y]) => window.app.pointSurLaBoucle(x, y), [dehors.x, dehors.y])),
            'préalable : ce point-ci est HORS de la barre');
        await pg.mouse.move(dehors.x, dehors.y); await pg.mouse.down(); await pg.mouse.up();
        await pg.waitForTimeout(150);
        const deplacee = await pg.evaluate(() => window.app.lecteur.boucleLecture && { ...window.app.lecteur.boucleLecture });
        check(deplacee && deplacee.debut > 0,
            `un clic immobile À CÔTÉ la DÉPLACE au lieu de l'effacer (mesure ${deplacee ? deplacee.debut + 1 : '—'}) — `
            + 'c\'est la moitié « souvent je la supprime sans faire exprès » du retour');

        // --- C bis. LA DERNIÈRE MESURE D'UNE LIGNE : la bande garde une largeur ------------------
        // LE DÉFAUT : la FIN d'une boucle est un instant qui tombe PILE sur la barre de mesure, et
        // `lieuDeLaPosition` répondait « c'est le début de la mesure suivante » — la lecture juste
        // pour une tête de lecture, fausse pour un bord de bande. Au MILIEU d'une ligne, l'erreur
        // passait pour un léger débord ; au BOUT, la mesure suivante ouvre le système d'APRÈS, et la
        // bande retombait à gauche de celui-ci. MESURÉ sur un téléphone (une mesure par système) :
        // x1 = x2 = 79,76 — largeur NULLE, deux poignées superposées, plus rien à attraper.
        await pg.evaluate(() => {
            window.app.mesuresParLigne = 2;   // deux mesures par ligne : la 2e finit la ligne
            window.app.dessiner();
        });
        await pg.waitForTimeout(150);
        /** Bornes de la bande sur la mesure `i`, et les repères auxquels sa FIN doit se comparer. */
        const finSur = (i) => pg.evaluate((i) => {
            const app = window.app;
            app.lecteur.definirBoucle(app.editeur.partition, i, i);
            app.dessiner();
            const a = app.page.ancrages.mesures.find(m => m.index === i);
            const sys = app.page.ancrages.systemes.find(s => s.index === a.systeme);
            const suivante = app.page.ancrages.mesures.find(m => m.index === i + 1);
            const evs = app.page.ancrages.evenements.filter(z => z.mesure === i && z.voix === 0);
            const b = app.bordsBoucleDuSysteme(sys);
            return {
                x1: b.x1, x2: b.x2, largeur: b.x2 - b.x1,
                finDerniereFigure: evs.length ? evs[evs.length - 1].xFin : null,
                barreDeMesure: a.xFin,
                debutSuivante: suivante ? suivante.x : null,
                changeDeSysteme: suivante ? suivante.systeme !== a.systeme : null,
            };
        }, i);

        // LA FIN TOMBE OÙ LA DERNIÈRE FIGURE S'ACHÈVE — c'est-à-dire là où passe la tête de lecture
        // à cet instant. Trois repères distincts existent à quelques pixels les uns des autres (fin de
        // la dernière figure, barre de mesure, début de la mesure suivante) et c'est bien le PREMIER
        // qu'il faut : les deux autres décrivent la mesure, pas la musique qui s'y termine.
        const finMilieu = await finSur(0);
        exiger(finMilieu.changeDeSysteme === false,
            'préalable : cette mesure-ci est SUIVIE sur la même ligne');
        check(Math.abs(finMilieu.x2 - finMilieu.finDerniereFigure) < 0.01,
            `au milieu d'une ligne, la fin de la bande tombe sur la fin de la dernière figure `
            + `(${finMilieu.x2.toFixed(1)}), et non sur le début de la mesure suivante `
            + `(${finMilieu.debutSuivante.toFixed(1)}) ni sur la barre (${finMilieu.barreDeMesure.toFixed(1)})`);

        const finDeLigne = await finSur(1);
        exiger(finDeLigne.changeDeSysteme === true,
            'préalable : cette mesure-là finit bien la ligne (la suivante ouvre le système d\'après)');
        check(finDeLigne.largeur > 20,
            `la bande garde une vraie largeur en bout de ligne (${finDeLigne.largeur.toFixed(1)} px de `
            + `${finDeLigne.x1.toFixed(1)} à ${finDeLigne.x2.toFixed(1)}) — elle en faisait ZÉRO tant que `
            + 'sa fin allait chercher le bord gauche de la mesure suivante, sur le système d\'après');
        check(Math.abs(finDeLigne.x2 - finDeLigne.finDerniereFigure) < 0.01,
            `et elle s'y termine au même repère qu'ailleurs (${finDeLigne.x2.toFixed(1)}), sans déborder `
            + `la barre de mesure (${finDeLigne.barreDeMesure.toFixed(1)}) : le bout de ligne n'est pas un cas à part`);
        await pg.evaluate(() => { window.app.mesuresParLigne = 0; window.app.dessiner(); });
        await pg.waitForTimeout(150);

        // --- D. NEUTRALISATION : la PRISE seule retrouve son ancien calcul ------------------------
        // Sans ce sabotage, rien ne prouverait que la section A mesure bien ce que la lecture partagée
        // gouverne : quatre cas verts pourraient décrire deux calculs restés d'accord par hasard.
        // ON NE SABOTE QUE `poigneeBoucleAuPoint`, jamais bordsBoucleDuSysteme : celui-ci sert AUSSI à
        // DESSINER, et le trafiquer déplacerait la poignée EN MÊME TEMPS que sa prise — les deux
        // resteraient d'accord et le banc ne verrait rien. C'est précisément le défaut qu'on éprouve
        // ici : DEUX lectures qui divergent, pas une lecture fausse.
        const sabote = await pg.evaluate(() => {
            const app = window.app;
            const vrai = app.poigneeBoucleAuPoint.bind(app);
            app.poigneeBoucleAuPoint = function (clientX, clientY) {
                const boucle = this.lecteur.boucleLecture;
                const dans = this._pointDansBandeBoucle(clientX, clientY);
                if (!boucle || !dans) return null;
                const touche = this.page.ancrages.mesures.filter(a =>
                    a.systeme === dans.systeme.index && a.index >= boucle.debut && a.index <= boucle.fin);
                if (!touche.length) return null;
                // L'ANCIEN CALCUL : les bords de MESURE, en ignorant les bornes fines.
                const prise = 1.1 * dans.S;
                if (touche.some(a => a.index === boucle.debut)
                    && Math.abs(dans.x - Math.min(...touche.map(a => a.x))) <= prise) return 'debut';
                if (touche.some(a => a.index === boucle.fin)
                    && Math.abs(dans.x - Math.max(...touche.map(a => a.xFin))) <= prise) return 'fin';
                return null;
            };
            app.lecteur.definirBoucle(app.editeur.partition, 0, 1, { finDansMesure: 2 });
            app.dessiner();
            const svg = app.el.feuille.querySelector('svg');
            const boite = svg.getBoundingClientRect();
            const bande = svg.querySelector('.bande-boucle');
            const yb = +bande.getAttribute('y') + (+bande.getAttribute('height')) / 2;
            const clientY = boite.top + yb / (app.page.hauteur / boite.height);
            const lis = (sel) => {
                const e = svg.querySelector(sel);
                if (!e) return { x: null, prise: null };
                const x = +e.getAttribute('x') + (+e.getAttribute('width')) / 2;
                return { x, prise: app.poigneeBoucleAuPoint(boite.left + x / (app.page.largeur / boite.width), clientY) };
            };
            const fin = lis('.poignee-fin'), debut = lis('.poignee-debut');
            app.poigneeBoucleAuPoint = vrai;
            const rendu = lis('.poignee-fin');
            return { fin, debut, rendu };
        });
        check(sabote.fin.prise === null && sabote.debut.prise === null,
            `NEUTRALISATION : avec l'ancien calcul (bords de mesure), les DEUX poignées redeviennent `
            + `insaisissables là où elles sont dessinées (début x=${sabote.debut.x && sabote.debut.x.toFixed(1)} → `
            + `« ${sabote.debut.prise} », fin x=${sabote.fin.x && sabote.fin.x.toFixed(1)} → « ${sabote.fin.prise} ») — `
            + 'la section A mesure bien la lecture partagée');
        check(sabote.rendu.prise === 'fin',
            `et la méthode rendue les reprend aussitôt (« ${sabote.rendu.prise} ») : le sabotage n'a rien laissé derrière lui`);

        check(poign.erreurs.length === 0,
            'aucune erreur JavaScript pendant les gestes de poignée'
            + (poign.erreurs.length ? ' — ' + poign.erreurs.join(' | ') : ''));
    } finally { await poign.fermer(); }

    // ============================================================================================
    // AU DOIGT : LA PARTITION VIENT À NOUS, ET LA POIGNÉE EST ATTRAPABLE.
    //
    // CE QU'ILS PROTÈGENT (retour utilisateur, téléphone) : « je peux cliquer pour ajouter la barre,
    // mais je n'arrive pas à l'étirer sur la droite : lorsque mon doigt glisse sur la droite pendant
    // que j'étire la barre, la partition doit se décaler automatiquement et progressivement pour que
    // je puisse englober plusieurs mesures », et « j'ai du mal à atteindre les poignées ».
    const tel = await ouvrirApp({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
    try {
        const t = tel.page;
        await t.evaluate(() => {
            const ed = window.app.editeur;
            while (ed.partition.mesures.length < 10) ed.ajouterMesure();
            ed.prevenir('document');
            window.app.el.zone.scrollTop = 0;
            window.app.dessiner();
        });
        await t.waitForTimeout(200);

        // --- LA PRISE D'UNE POIGNÉE FAIT BIEN LA TAILLE D'UN DOIGT ------------------------------
        // Mesurée par BALAYAGE de poigneeBoucleAuPoint, jamais déduite des constantes : c'est
        // exactement l'écart qui avait échappé au correctif précédent, lequel visait « le minimum
        // tactile appliqué partout ailleurs » et donnait en réalité 26px de haut.
        const prise = await t.evaluate(() => {
            const app = window.app;
            app.lecteur.definirBoucle(app.editeur.partition, 1, 1);
            app.dessiner();
            const svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect(), ech = b.width / app.page.largeur;
            const a = app.page.ancrages.mesures.find(m => m.index === 1);
            const liste = app.page.ancrages.systemes;
            const sys = liste.find(s => s.index === a.systeme);
            // Le centre de la poignée DESSINÉE, pas le bord de mesure : une boucle sur une mesure
            // ENTIÈRE se borne à la fin de la zone de notes, en retrait de la barre (c'est aussi là
            // que passe la tête de lecture, voir lieuDeLaPosition) — balayer depuis la barre partait
            // d'un point où il n'y a jamais eu de poignée à prendre.
            const pg = svg.querySelector('.poignee-fin');
            const xSvg = pg ? +pg.getAttribute('x') + (+pg.getAttribute('width')) / 2 : a.xFin;
            const x = b.left + xSvg * ech, y = b.top + (sys.yBas + 0.9 * app.page.geo.S) * ech;
            const dedans = (dx, dy) => app.poigneeBoucleAuPoint(x + dx, y + dy) === 'fin';
            const portee = (sx, sy) => { for (let d = 0; d < 400; d++) if (!dedans(sx * d, sy * d)) return d; return 400; };
            const j = liste.findIndex(s => s.index === sys.index);
            return {
                largeur: portee(-1, 0) + portee(1, 0),
                hauteur: portee(0, -1) + portee(0, 1),
                creux: j + 1 < liste.length ? Math.round((liste[j + 1].y - sys.yBas) * ech) : null,
                bas: portee(0, 1),
            };
        });
        exiger(prise.largeur >= 44 && prise.hauteur >= 44,
            `au doigt, la prise d'une poignée fait ${prise.largeur}×${prise.hauteur} px — le repère de 44px que le projet s'impose partout ailleurs (mesuré à 44×26 avant ce correctif)`);
        check(prise.creux === null || prise.bas < prise.creux,
            `et elle reste DANS le creux jusqu'au système suivant (${prise.bas}px vers le bas pour ${prise.creux} disponibles) : un doigt visant le système d'après ne tombe pas dans la bande du précédent`);

        // --- LA PARTITION DÉFILE SOUS UN DOIGT IMMOBILE -----------------------------------------
        // Le geste interdit volontairement le défilement natif (_bloquerDefilementPendantGeste),
        // sans quoi le doigt ferait glisser la page au lieu de tracer la bande. Ayant confisqué le
        // défilement, c'est à l'application de le rendre — d'où cette vérification.
        await t.evaluate(() => { window.app.lecteur.retirerBoucle(); window.app.el.zone.scrollTop = 0; window.app.dessiner(); });
        await t.waitForTimeout(150);
        const depart = await t.evaluate(() => {
            const app = window.app, svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect(), ech = b.width / app.page.largeur;
            const a = app.page.ancrages.mesures.find(m => m.index === 0);
            const sys = app.page.ancrages.systemes.find(s => s.index === a.systeme);
            const rz = app.el.zone.getBoundingClientRect();
            return {
                x: b.left + ((a.x + a.xFin) / 2) * ech,
                y: b.top + (sys.yBas + 1.2 * app.page.geo.S) * ech,
                bas: rz.bottom,
            };
        });
        // L'écouteur qui démarre un geste est sur #feuille ; les pointermove/up sont posés sur window
        // par le geste lui-même. Dispatcher le pointerdown sur la ZONE ne déclencherait rien (un
        // évènement ne descend pas vers les enfants) — trompeuse absence de défilement, mesurée.
        await t.evaluate(({ x, y }) => {
            const faire = (cible, type, cx, cy) => cible.dispatchEvent(new PointerEvent(type, {
                pointerId: 9, pointerType: 'touch', clientX: cx, clientY: cy,
                bubbles: true, cancelable: true, isPrimary: true,
            }));
            faire(document.getElementById('feuille'), 'pointerdown', x, y);
            window.__geste = (type, cx, cy) => faire(window, type, cx, cy);
        }, depart);
        await t.waitForTimeout(60);
        // Le doigt descend jusqu'au bord bas… puis NE BOUGE PLUS.
        await t.evaluate(({ x, bas }) => {
            window.__geste('pointermove', x + 24, bas - 90);
            window.__geste('pointermove', x + 30, bas - 12);
        }, depart);
        const etapes = [];
        for (let i = 0; i < 4; i++) {
            await t.waitForTimeout(220);
            etapes.push(await t.evaluate(() => ({
                defile: Math.round(window.app.el.zone.scrollTop),
                fin: window.app.lecteur.boucleLecture ? window.app.lecteur.boucleLecture.fin : null,
                apercu: document.querySelectorAll('#apercu-boucle rect').length,
            })));
        }
        await t.evaluate(({ x, bas }) => { window.__geste('pointerup', x + 30, bas - 12); }, depart);
        await t.waitForTimeout(200);
        const apresRelache = await t.evaluate(() => ({
            defile: Math.round(window.app.el.zone.scrollTop),
            boucle: window.app.lecteur.boucleLecture,
            apercu: !!document.querySelector('#apercu-boucle'),
        }));

        exiger(etapes[etapes.length - 1].defile > 60,
            `doigt IMMOBILE au bord bas : la partition monte à sa rencontre (${etapes.map(e => e.defile).join(' -> ')} px)`);
        check(etapes.every((e, i) => i === 0 || e.defile >= etapes[i - 1].defile),
            'et elle défile progressivement, sans reculer');
        exiger(apresRelache.boucle && apresRelache.boucle.fin >= 2,
            `la boucle finit par englober plusieurs mesures (0 -> ${apresRelache.boucle && apresRelache.boucle.fin}), ce qui était IMPOSSIBLE sur un téléphone où chaque système ne porte qu'une mesure`);
        // L'APERÇU SURVIT AUX REDESSINS que le défilement déclenche : `surDefilement` appelle
        // `dessiner()`, qui reconstruit l'innerHTML du SVG. Sans la mémoire de l'aperçu courant, la
        // bande disparaîtrait à l'instant précis où elle doit s'allonger.
        check(etapes.every(e => e.apercu > 0),
            `l'aperçu reste tracé pendant tout le défilement (${etapes.map(e => e.apercu).join(', ')} rectangles), malgré les redessins qu'il provoque`);
        check(apresRelache.apercu === false,
            'et il s\'efface au relâchement, comme après tout autre geste');

        // LE DÉFILEMENT S'ARRÊTE AVEC LE GESTE : sans cela l'animation continuerait de tourner (et
        // de faire défiler) après que le doigt a quitté l'écran.
        const avantAttente = apresRelache.defile;
        await t.waitForTimeout(500);
        const apresAttente = await t.evaluate(() => Math.round(window.app.el.zone.scrollTop));
        check(apresAttente === avantAttente,
            `et le défilement s'arrête net au relâchement (${avantAttente} px, toujours ${apresAttente} une demi-seconde plus tard)`);

        // AU MILIEU DE L'ÉCRAN, RIEN NE DÉFILE : un geste tranquille ne doit pas emballer la page.
        await t.evaluate(() => { window.app.lecteur.retirerBoucle(); window.app.el.zone.scrollTop = 200; window.app.dessiner(); });
        await t.waitForTimeout(150);
        // ON AMÈNE SOI-MÊME UN SYSTÈME AU CENTRE, plutôt que d'en chercher un qui y serait déjà :
        // les systèmes sont espacés de 238px dans une zone de 456, il n'y en a donc pas toujours un
        // à bonne distance des deux bords (mesuré — la première version de cette vérification
        // n'en trouvait aucun et s'arrêtait là).
        const milieu = await t.evaluate(() => {
            const app = window.app, zone = app.el.zone;
            const svg = document.querySelector('#feuille svg');
            const b0 = svg.getBoundingClientRect(), ech = b0.width / app.page.largeur;
            const sys = app.page.ancrages.systemes[2];
            const rz = zone.getBoundingClientRect();
            // yBas du système, ramené au centre vertical de la zone visible
            zone.scrollTop = Math.max(0, sys.yBas * ech - zone.clientHeight / 2);
            const b = svg.getBoundingClientRect();
            const a = app.page.ancrages.mesures.find(m => m.systeme === sys.index);
            const y = b.top + (sys.yBas + 1.2 * app.page.geo.S) * ech;
            return {
                x: b.left + ((a.x + a.xFin) / 2) * ech, y,
                margeHaut: Math.round(y - rz.top), margeBas: Math.round(rz.bottom - y),
            };
        });
        exiger(milieu.margeHaut > 64 && milieu.margeBas > 64,
            `préalable : le point visé est loin des deux bords (${milieu.margeHaut}px du haut, ${milieu.margeBas}px du bas — le défilement s'amorce à 64)`);
        await t.evaluate(({ x, y }) => {
            const faire = (cible, type, cx, cy) => cible.dispatchEvent(new PointerEvent(type, {
                pointerId: 11, pointerType: 'touch', clientX: cx, clientY: cy,
                bubbles: true, cancelable: true, isPrimary: true,
            }));
            faire(document.getElementById('feuille'), 'pointerdown', x, y);
            faire(window, 'pointermove', x + 40, y);
            window.__fin = () => faire(window, 'pointerup', x + 40, y);
        }, milieu);
        const avant = await t.evaluate(() => Math.round(window.app.el.zone.scrollTop));
        await t.waitForTimeout(400);
        const apres = await t.evaluate(() => Math.round(window.app.el.zone.scrollTop));
        await t.evaluate(() => window.__fin());
        await t.waitForTimeout(150);
        check(apres === avant,
            `loin des bords, rien ne défile (${avant} px, toujours ${apres} après 400 ms) : le défilement répond au BORD, pas au simple fait de glisser`);

        // --- LE TOUCHER EST RÉCLAMÉ DÈS `touchstart`, DANS LA BANDE SEULEMENT ------------------
        // Retour utilisateur, troisième passage sur le même défaut : « je ne peux pas l'étirer car
        // c'est l'écran avec la portée qui bouge et qui réagit aux mouvements de mon doigt ».
        // Deux filets existaient déjà et ne suffisaient pas : `touch-action: none` sur les <rect>
        // (non honoré par WebKit sur du SVG) et un `touchmove` non passif posé depuis `pointerdown`
        // — trop tard, `pointerdown` arrivant APRÈS `touchstart`, moment où un navigateur mobile
        // s'engage déjà sur un défilement. Le seul instant où l'on peut réclamer une séquence de
        // toucher entière est `touchstart`.
        //
        // ET LA CONDITION COMPTE AUTANT QUE LE PREVENTDEFAULT : « lorsque je suis dans la zone de la
        // bande, seule la barre orangée doit pouvoir réagir ». Réclamer inconditionnellement
        // paralyserait le défilement au doigt sur toute la partition — bien pire que le défaut.
        const toucherReclame = (pt) => t.evaluate(({ x, y }) => {
            const feuille = document.getElementById('feuille');
            const decrire = (cx, cy) => ({
                identifier: 1, target: feuille, clientX: cx, clientY: cy, pageX: cx, pageY: cy,
                screenX: cx, screenY: cy, radiusX: 8, radiusY: 8, force: 1,
            });
            const ev = new TouchEvent('touchstart', {
                bubbles: true, cancelable: true,
                touches: [new Touch(decrire(x, y))],
                targetTouches: [new Touch(decrire(x, y))],
                changedTouches: [new Touch(decrire(x, y))],
            });
            feuille.dispatchEvent(ev);
            return ev.defaultPrevented;
        }, pt);
        const ptBande = await t.evaluate(() => {
            const app = window.app, svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect(), ech = b.width / app.page.largeur;
            const a = app.page.ancrages.mesures.find(m => m.index === 0);
            const sys = app.page.ancrages.systemes.find(s => s.index === a.systeme);
            return { x: b.left + ((a.x + a.xFin) / 2) * ech, y: b.top + (sys.yBas + 1.2 * app.page.geo.S) * ech };
        });
        const ptNote = await t.evaluate(() => {
            const app = window.app, svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect(), ech = b.width / app.page.largeur;
            const a = app.page.ancrages.mesures.find(m => m.index === 0);
            return { x: b.left + ((a.x + a.xFin) / 2) * ech, y: b.top + (a.yTab + a.hauteurTab / 2) * ech };
        });
        exiger(await toucherReclame(ptBande),
            'un doigt posé DANS la bande réclame tout le geste dès `touchstart` : le navigateur n\'a plus le droit de faire défiler la portée sous le doigt');
        exiger((await toucherReclame(ptNote)) === false,
            'et un doigt posé sur la TABLATURE ne réclame rien : le défilement du morceau au doigt reste intact partout ailleurs');

        // --- UN POINTEUR ANNULÉ N'EST PAS UN APPUI ---------------------------------------------
        // « j'appuie et je glisse pour étirer la barre, et le logiciel comprend que j'ajoute une
        // barre, puis que je scrolle horizontalement. » Les deux moitiés de cette phrase, dans
        // l'ordre : `pointercancel` est précisément ce qu'émet le navigateur en s'emparant du geste,
        // souvent AVANT le seuil de 6px — donc avec `bouge` faux. L'ancienne version branchait le
        // même gestionnaire sur `pointerup` et `pointercancel` : l'annulation tombait dans la
        // branche « tap immobile » et posait une boucle d'une mesure que personne n'avait demandée.
        const geste2 = (pointerId, finir) => t.evaluate(({ x, y, pointerId, finir }) => {
            const faire = (cible, type, cx, cy) => cible.dispatchEvent(new PointerEvent(type, {
                pointerId, pointerType: 'touch', clientX: cx, clientY: cy,
                bubbles: true, cancelable: true, isPrimary: true,
            }));
            faire(document.getElementById('feuille'), 'pointerdown', x, y);
            faire(window, finir, x + 2, y);   // 2px : sous le seuil, comme dans le cas réel
            return window.app.lecteur.boucleLecture;
        }, { ...ptBande, pointerId, finir });

        await t.evaluate(() => { window.app.lecteur.retirerBoucle(); window.app.dessiner(); });
        await t.waitForTimeout(120);
        const apresAnnule = await geste2(31, 'pointercancel');
        exiger(apresAnnule === null,
            'un geste ANNULÉ par le navigateur ne laisse aucune barre derrière lui — c\'est la « barre ajoutée » dont se plaignait l\'utilisateur');
        const apresVraiTap = await geste2(32, 'pointerup');
        exiger(apresVraiTap !== null && apresVraiTap.debut === 0,
            'tandis qu\'un VRAI appui (doigt levé) pose toujours la boucle : la distinction porte sur l\'annulation, pas sur le tap');
        // Et une annulation ne RETIRE pas non plus une boucle déjà posée — l'autre moitié de la
        // branche « tap immobile », tout aussi destructrice quand elle se déclenche par accident.
        const apresAnnuleAvecBoucle = await geste2(33, 'pointercancel');
        check(apresAnnuleAvecBoucle !== null,
            'et elle ne retire pas non plus la boucle en place : un geste avorté ne décide de rien');

        // --- LE DÉFILEMENT HORIZONTAL, sous un vrai débordement en largeur ----------------------
        // Condition de l'utilisateur, reproduite : au zoom par défaut sur 390px la feuille ne
        // déborde QUE en hauteur (mesuré), mais il parle de défilement horizontal — donc sa feuille
        // déborde en largeur. Un zoom plus fort, ou un nombre de mesures par ligne imposé, y suffit
        // (mesuré : 405px de feuille pour 390 de zone dès le zoom 12). L'axe horizontal du
        // défilement n'avait jamais été éprouvé.
        const debordement = await t.evaluate(() => {
            const app = window.app, zone = app.el.zone;
            app.changerZoom(15 - app.interligne);
            app.mesuresParLigne = 4;
            app.lecteur.retirerBoucle();
            app.dessiner();
            zone.scrollLeft = 0; zone.scrollTop = 0;
            return { x: zone.scrollWidth - zone.clientWidth, y: zone.scrollHeight - zone.clientHeight };
        });
        await t.waitForTimeout(200);
        exiger(debordement.x > 200,
            `préalable : la feuille déborde vraiment en LARGEUR (${debordement.x}px), sans quoi ce cas ne prouverait rien`);
        const depart2 = await t.evaluate(() => {
            const app = window.app, svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect(), ech = b.width / app.page.largeur;
            const a = app.page.ancrages.mesures.find(m => m.index === 0);
            const sys = app.page.ancrages.systemes.find(s => s.index === a.systeme);
            const rz = app.el.zone.getBoundingClientRect();
            return {
                x: b.left + ((a.x + a.xFin) / 2) * ech,
                y: b.top + (sys.yBas + 1.2 * app.page.geo.S) * ech,
                droite: rz.right,
            };
        });
        await t.evaluate(({ x, y, droite }) => {
            const faire = (cible, type, cx, cy) => cible.dispatchEvent(new PointerEvent(type, {
                pointerId: 41, pointerType: 'touch', clientX: cx, clientY: cy,
                bubbles: true, cancelable: true, isPrimary: true,
            }));
            faire(document.getElementById('feuille'), 'pointerdown', x, y);
            faire(window, 'pointermove', x + 30, y);
            faire(window, 'pointermove', droite - 8, y);   // collé au bord DROIT, puis immobile
            window.__finH = () => faire(window, 'pointerup', droite - 8, y);
        }, depart2);
        const horiz = [];
        const t0 = Date.now();
        for (let i = 0; i < 4; i++) {
            await t.waitForTimeout(250);
            horiz.push(await t.evaluate(() => Math.round(window.app.el.zone.scrollLeft)));
        }
        const duree = (Date.now() - t0) / 1000;
        await t.evaluate(() => window.__finH());
        await t.waitForTimeout(200);
        const boucleH = await t.evaluate(() => window.app.lecteur.boucleLecture);

        exiger(horiz[horiz.length - 1] > 60,
            `doigt collé au bord DROIT : la partition défile latéralement (${horiz.join(' -> ')} px)`);
        check(horiz.every((v, i) => i === 0 || v >= horiz[i - 1]),
            'et toujours dans le même sens, sans reculer');
        check(boucleH && boucleH.fin > 0,
            `la boucle s'étend au fil du défilement horizontal (0 -> ${boucleH && boucleH.fin})`);
        // LENTEMENT, comme demandé (« la partition doit défiler lentement pour que je puisse
        // continuer à étirer »). Une première version montait à ~1270 px/s : trois à six mesures par
        // seconde sur un téléphone, on dépassait sa cible avant de pouvoir lever le doigt. Le
        // plafond ci-dessous garde ce réglage — il échouerait si l'on revenait à cette vitesse.
        const vitesse = horiz[horiz.length - 1] / duree;
        check(vitesse < 800,
            `et lentement : ${Math.round(vitesse)} px/s collé au bord (la première version en faisait ~1270, impossible à doser)`);

        check(tel.erreurs.length === 0,
            'aucune erreur JavaScript au doigt' + (tel.erreurs.length ? ' — ' + tel.erreurs.join(' | ') : ''));
    } finally { await tel.fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
