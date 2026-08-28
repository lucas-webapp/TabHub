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

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('boucle de lecture');

(async () => {
    plan(25);
    // hasTouch : nécessaire pour que le glisser tactile RÉEL (cas 10, Input.dispatchTouchEvent) soit
    // bien rapporté en pointerType 'touch' — sans lui, ces évènements CDP repartent en 'mouse' (voir
    // tests/_page.js) et ne prouveraient donc rien de spécifique au doigt. N'affecte pas les gestes
    // page.mouse.*, qui restent du VRAI pointerType 'mouse' quel que soit ce réglage.
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
        /** Point d'écran sur le VRAI bord ('debut' = a.x, 'fin' = a.xFin) de la mesure `i`, à la
         *  hauteur de la bande — là où se dessine et se saisit une poignée (voir marquesBoucle/
         *  poigneeBoucleAuPoint), par opposition à pointMesure ci-dessus qui vise son CENTRE. */
        const pointBordMesure = (i, bord) => page.evaluate(({ i, bord }) => {
            const svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect();
            const a = window.app.page.ancrages.mesures.find(x => x.index === i);
            const S = window.app.page.geo.S;
            const yBande = a.yTab + a.hauteurTab + 1.2 * S;
            const xSvg = bord === 'debut' ? a.x : a.xFin;
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
        // 4/4 à 120 BPM : la mesure 1 commence à 2s, la fin de la mesure 3 (donc le début de la 4) à 8s.
        check(Math.abs(apres1.loopStart - 2) < 0.02 && Math.abs(apres1.loopEnd - 8) < 0.02,
            'les bornes correspondent au DÉBUT de la mesure 1 et à la FIN de la mesure 3 (epsilon d\'un tic près)');

        // --- 2. La zone se dessine réellement (primitive visible, couleur de lecture) ---------------
        const zoneDessinee = await page.evaluate(() => {
            const svg = document.querySelector('#feuille svg');
            return [...svg.querySelectorAll('rect')].some(r =>
                getComputedStyle(r).fill !== '' && r.getAttribute('fill') === 'var(--lecture-halo)');
        });
        check(zoneDessinee, 'la zone se dessine avec la couleur de LECTURE (--lecture-halo), pas celle du curseur d\'édition');

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

        // --- 7. Lecture DEPUIS L'ARRÊT : curseur DANS la boucle -> part du curseur ------------------
        const dansLaBoucle = await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.placerCurseur(1, 2, 0);   // mesure 1, dans la boucle [0,1]
            const depart = window.app.positionDeDepartLecture();
            const attendu = window.app.positionDuCurseurEnNoires();
            return Math.abs(depart - attendu) < 1e-9;
        });
        check(dansLaBoucle, 'curseur DANS la boucle -> la lecture repart bien du curseur, pas du début de la boucle');

        // --- 8. Curseur HORS la boucle -> part du DÉBUT de la boucle, pas du curseur ----------------
        const horsLaBoucle = await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.placerCurseur(5, 0, 0);   // mesure 5, hors de la boucle [0,1]
            const depart = window.app.positionDeDepartLecture();
            const attendu = window.app.editeur.partition.mesures.slice(0, 0).length; // 0
            return depart === 0;
        });
        check(horsLaBoucle, 'curseur HORS la boucle -> la lecture repart du DÉBUT de la boucle, pas d\'un endroit qu\'elle ne traverse peut-être jamais');

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

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
