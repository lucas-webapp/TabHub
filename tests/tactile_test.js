// Banc de la SAISIE TACTILE — écrire une tablature au téléphone.
//
// CE QU'IL PROTÈGE. Toute la saisie de TabHub repose sur le clavier : un chiffre tapé EST une case
// (voir edit/keyboard.js). Sur un téléphone, ce geste n'existe pas, et l'application était donc
// littéralement inutilisable — on pouvait lire une tablature, pas en écrire une. Quatre mécanismes
// répondent à ça, et c'est eux que ce banc éprouve :
//   • LE PAVÉ (ui/pave.js) : dix chiffres au doigt, qui passent par le MÊME `saisirChiffre` que le
//     clavier — donc les cases à deux chiffres marchent aussi au doigt. Plus Effacer/Insérer et,
//     À PART, la croix de déplacement — voir « FLOTTANTE » plus bas — pris dans la même table
//     d'actions que le clavier et la barre d'outils.
//   • LE TAP place le curseur, comme un clic.
//   • L'APPUI LONG ouvre le menu contextuel — l'équivalent tactile du clic droit, sans lequel
//     supprimer/insérer sont inatteignables au doigt.
//   • LE GLISSER ne lassote plus : il fait DÉFILER. Sans ça, la partition était impossible à
//     parcourir sur un téléphone (chaque tentative dessinait un rectangle de sélection).
//
// FLOTTANTE (retour utilisateur, capture à l'appui : « il faut sortir les flèches du pavé
// numérique [...] décaler les flèches au-dessus ») : la croix haut/gauche/droite/bas
// (#dpad-flottant) ne vit plus DANS #pave-tactile mais À CÔTÉ, par-dessus la partition (voir
// index.html .zone-conteneur, style.css .dpad-flottant). Deux retours ont ensuite cadré son fond :
// un grand panneau commun « se voit trop », mais sans AUCUN fond « on ne les voit plus assez » — le
// CONTENEUR (toute la croix, coins et centre du 3×3 compris) reste donc sans fond, seule CHAQUE
// FLÈCHE porte le sien, translucide et carré, cantonné à sa propre case. Insensible au défilement de
// la partition (elle reste au même endroit de l'écran, quoi qu'on ait fait défiler dessous).
//
// Playwright émule un vrai téléphone (`hasTouch`, viewport étroit, pointeur grossier) : les gestes
// ci-dessous partent donc réellement en `pointerType: 'touch'`, comme sur l'appareil.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('tactile');

(async () => {
    plan(32);
    // Un iPhone de taille courante, avec le tactile réellement actif — sans quoi
    // `pointerType` resterait 'mouse' et rien de ce qui suit ne serait éprouvé pour de vrai.
    const { page, erreurs, fermer } = await ouvrirApp({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
    });
    try {
        // --- Le pavé est là, tout seul, parce que l'appareil est tactile -------------------------
        const pave = page.locator('#pave-tactile');
        exiger(await pave.isVisible(), 'le pavé de saisie apparaît de lui-même sur un appareil tactile');
        check(await page.locator('#pave-tactile .btn-case').count() === 10,
            'il porte les dix chiffres de case (0 à 9)');

        // --- Écrire une case au doigt --------------------------------------------------------------
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.curseur = { mesure: 0, voix: 0, evenement: 0, corde: 0 };
            ed.prevenir('document');
        });
        await page.waitForTimeout(150);

        const caseDu = (n) => page.locator(`#pave-tactile .btn-case:has-text("${n}")`).first();
        const noteCourante = () => page.evaluate(() => {
            const e = window.app.editeur.evenementCourant();
            return (e.silence || !e.notes.length) ? null : e.notes[0].frette;
        });

        await caseDu(5).tap();
        await page.waitForTimeout(120);
        check(await noteCourante() === 5, 'taper « 5 » sur le pavé pose bien la case 5');

        // Les cases à DEUX chiffres : le pavé passe par le même saisirChiffre que le clavier, donc la
        // fenêtre de regroupement (DELAI_DEUXIEME_CHIFFRE) joue à l'identique au doigt.
        await caseDu(1).tap();
        await caseDu(2).tap();
        await page.waitForTimeout(120);
        check(await noteCourante() === 12, 'deux chiffres tapés à la suite donnent la case 12, comme au clavier');

        // --- La case posée se voit, en toutes lettres, sur le pavé lui-même ------------------------
        // Sans ce repère, rien au doigt n'indique qu'on peut dépasser 9 : le `title` qui l'explique
        // sur chaque bouton ne s'affiche qu'au survol, un geste qui n'existe pas au doigt (retour
        // utilisateur : « je ne peux pas aller au-dessus de 9 »). Vérifie que le lecteur de case
        // affiche bien « 12 » ci-dessus, pas seulement le modèle — SANS retaper ensuite (la case 12
        // sert encore de fixture à un test plus loin, voir « avant l'effacement »).
        const etatPave = () => page.evaluate(() => document.querySelector('.etat-pave').textContent);
        check((await etatPave()).includes('case 12'), 'le pavé affiche lui-même la case posée (« case 12 »), pas seulement le modèle en coulisse');

        // --- Se déplacer au doigt, depuis la croix FLOTTANTE (voir l'en-tête du banc) ---------------
        // Plus de préfixe `#pave-tactile` ici : ces boutons vivent désormais dans #dpad-flottant,
        // à part — voir le paragraphe « FLOTTANTE » ci-dessus.
        const curseur = () => page.evaluate(() => ({ ...window.app.editeur.curseur }));
        const avantDeplacement = await curseur();
        await page.locator('button[aria-label="Corde plus grave"]').tap();
        await page.waitForTimeout(120);
        const apresBas = await curseur();
        check(apresBas.corde === avantDeplacement.corde + 1, 'la flèche « bas » de la croix flottante descend bien d\'une corde');

        await page.locator('button[aria-label="Évènement suivant"]').tap();
        await page.waitForTimeout(120);
        const apresDroite = await curseur();
        check(apresDroite.evenement === apresBas.evenement + 1, 'la flèche « droite » avance bien d\'un évènement');

        // --- Effacer au doigt ------------------------------------------------------------------------
        await page.evaluate(() => { window.app.editeur.placerCurseur(0, 0, 0); });
        await page.waitForTimeout(100);
        exiger(await noteCourante() === 12, 'la case 12 est bien là avant l\'effacement');
        await page.locator('#pave-tactile button[aria-label="Effacer la note"]').first().tap();
        await page.waitForTimeout(120);
        check(await noteCourante() === null, '« Effacer » du pavé vide bien la case visée');

        // --- Le TAP sur la partition place le curseur ------------------------------------------------
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [5, 6, 7].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)]));
            ed.placerCurseur(0, 0, 0);
            ed.prevenir('document');
        });
        await page.waitForTimeout(150);

        const pointDeLaCase = (i) => page.evaluate((i) => {
            const svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect();
            const a = window.app.page.ancrages.evenements.find(e => e.mesure === 0 && e.evenement === i);
            return {
                x: b.left + ((a.xDebut + a.xFin) / 2 / window.app.page.largeur) * b.width,
                y: b.top + (a.yPortee / window.app.page.hauteur) * b.height,
            };
        }, i);

        let p = await pointDeLaCase(2);
        await page.touchscreen.tap(p.x, p.y);
        await page.waitForTimeout(200);
        check((await curseur()).evenement === 2, 'un TAP sur la partition place le curseur sur la case touchée');

        // --- L'APPUI LONG ouvre le menu contextuel ----------------------------------------------------
        // Joué en évènements de pointeur bruts : `touchscreen.tap` ne sait pas maintenir, et c'est
        // précisément la DURÉE du contact qu'on éprouve ici.
        const menu = page.locator('#menu-contextuel');
        check(!(await menu.isVisible()), 'le menu contextuel est bien fermé avant l\'appui long');

        p = await pointDeLaCase(1);
        await page.evaluate(({ x, y }) => {
            const opts = { pointerType: 'touch', clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true, isPrimary: true };
            document.getElementById('feuille').dispatchEvent(new PointerEvent('pointerdown', opts));
        }, p);
        await page.waitForTimeout(750);   // au-delà des 550 ms de l'appui long
        exiger(await menu.isVisible(), 'un APPUI LONG sur une note ouvre le menu contextuel (équivalent tactile du clic droit)');
        check((await menu.locator('button').allTextContents()).length === 7,
            'avec les sept mêmes actions qu\'au clic droit');
        // On relâche : le menu doit RESTER ouvert (le doigt levé après un appui long ne l'annule pas).
        await page.evaluate(({ x, y }) => {
            const opts = { pointerType: 'touch', clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true, isPrimary: true };
            window.dispatchEvent(new PointerEvent('pointerup', opts));
        }, p);
        await page.waitForTimeout(150);
        check(await menu.isVisible(), 'et il reste ouvert quand le doigt se lève, le temps de choisir');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);

        // --- Le GLISSER ne lassote plus : il défile -----------------------------------------------------
        // Le curseur est relevé ICI, juste avant le glisser : l'appui long ci-dessus l'a lui-même
        // déplacé sur la note visée (ouvrirMenuContextuel place le curseur, comme le clic droit), donc
        // le comparer à sa valeur d'avant le menu ne prouverait rien sur le glisser.
        const curseurAvantGlisser = await curseur();
        const depart = await pointDeLaCase(0);
        await page.evaluate(({ x, y }) => {
            const feuille = document.getElementById('feuille');
            const opts = (cx, cy) => ({ pointerType: 'touch', clientX: cx, clientY: cy, button: 0, bubbles: true, cancelable: true, isPrimary: true });
            feuille.dispatchEvent(new PointerEvent('pointerdown', opts(x, y)));
            window.dispatchEvent(new PointerEvent('pointermove', opts(x + 90, y + 40)));
        }, depart);
        await page.waitForTimeout(120);
        const pendantGlisser = await page.evaluate(() => ({
            lasso: !!document.querySelector('.lasso-selection'),
            selection: window.app.selectionNotes.size,
        }));
        check(!pendantGlisser.lasso, 'GLISSER au doigt ne dessine AUCUN rectangle de sélection — le défilement reste au navigateur');
        check(pendantGlisser.selection === 0, 'et ne sélectionne aucune note');
        await page.evaluate(({ x, y }) => {
            window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', clientX: x + 90, clientY: y + 40, button: 0, bubbles: true, cancelable: true, isPrimary: true }));
        }, depart);
        await page.waitForTimeout(120);
        const apresGlisser = await curseur();
        check(apresGlisser.evenement === curseurAvantGlisser.evenement && apresGlisser.corde === curseurAvantGlisser.corde,
            'et un glisser ne déplace pas non plus le curseur (ce n\'était pas un tap)');

        // --- Filet de sécurité : sur un écran anormalement court, tout doit rester ATTEIGNABLE --------
        // `100dvh` (voir style.css) suffit sur tout téléphone raisonnable — mais aucune taille de
        // fenêtre FIXE, ici, ne peut rejouer les conditions d'un vrai navigateur mobile (barre
        // d'adresse pas encore rétractée, webview embarquée…) où ce calcul pourrait ne pas suffire.
        // Ce banc éprouve donc le FILET (overflow-y: auto sur body, propagé au scroll de la fenêtre
        // par la règle CSS habituelle body→html), pas le calcul lui-même : sur un viewport délibérément
        // plus court que tout téléphone réel, la barre transport doit rester cliquable par un simple
        // défilement plutôt que rognée sans recours (retour utilisateur : « les boutons dépassent de
        // l'écran en bas », toujours signalé après le premier passage à 100dvh — d'où ce filet).
        // 230px, pas 300 : depuis que la croix de déplacement flotte (retour utilisateur, voir plus
        // bas) au lieu de peser sur la rangée « pave », le châssis fixe (haut+outils+pave+transport)
        // tient désormais dans 300px — il faut viser plus bas pour forcer un VRAI débordement.
        await page.setViewportSize({ width: 390, height: 230 });
        await page.waitForTimeout(150);
        exiger(await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight),
            'sur ce viewport délibérément trop court, le contenu déborde bien pour de vrai (sans quoi ce banc ne prouverait rien)');
        let atteint = false;
        try { await page.click('#btn-mesures-ligne-bascule', { timeout: 2000 }); atteint = true; } catch { /* atteint reste false */ }
        check(atteint, 'malgré le débordement, un bouton de la barre transport reste atteignable (le défilement le révèle)');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(150);

        // --- La croix flottante elle-même : présente, un fond PAR FLÈCHE (jamais commun), insensible
        // au défilement --- (voir le paragraphe « FLOTTANTE » de l'en-tête du banc). Placé ici, APRÈS
        // tout ce qui dépend encore du contenu de la partition (la case 12, les cases 5/6/7…) et AVANT
        // que le pavé ne soit replié (voir juste plus bas) : le remplacer par 30 mesures fraîches,
        // pour avoir de quoi faire défiler, ne doit gêner personne d'autre dans ce banc.
        const dpad = page.locator('#dpad-flottant');
        exiger(await dpad.isVisible(), '#dpad-flottant existe et se montre sur un appareil tactile');
        check(await dpad.locator('button').count() === 4, 'et porte EXACTEMENT ses quatre flèches (haut/gauche/droite/bas)');

        const styleDpad = await page.evaluate(() => {
            const alphaDe = (couleur) => {
                const m = couleur.match(/rgba?\(([^)]+)\)/);
                const parts = m ? m[1].split(',').map(s => parseFloat(s)) : [];
                return parts.length === 4 ? parts[3] : 1;
            };
            const cs = getComputedStyle(document.getElementById('dpad-flottant'));
            const csBouton = getComputedStyle(document.querySelector('#dpad-flottant .btn-pave'));
            return {
                alphaConteneur: alphaDe(cs.backgroundColor),
                position: cs.position,
                alphaBouton: alphaDe(csBouton.backgroundColor),
                fondCantonne: csBouton.backgroundClip === 'content-box' && parseFloat(csBouton.paddingLeft) > 0,
            };
        });
        // Trois retours successifs ont cadré ce point : un grand panneau commun « se voit trop », mais
        // sans AUCUN fond « on ne les voit plus assez », et le fond PAR bouton, une fois réintroduit,
        // « ne prend pas toute la largeur des 4 flèches » — le CONTENEUR (la croix entière, coins et
        // centre du 3×3 compris) reste donc bien sans fond (alpha 0)...
        check(styleDpad.alphaConteneur === 0, 'le conteneur de la croix n\'a lui-même toujours aucun fond — jamais un panneau commun aux quatre flèches');
        check(styleDpad.position === 'absolute', 'et elle flotte (position absolute), jamais couchée dans une rangée de la grille');
        // ...tandis que CHAQUE bouton flèche, lui, porte son propre fond, translucide (ni opaque ni
        // invisible) : « un fond translucide juste derrière les flèches » (retour utilisateur), en
        // carré (voir style.css .dpad-flottant .btn-pave), cantonné à sa propre case du 3×3.
        check(styleDpad.alphaBouton > 0 && styleDpad.alphaBouton < 1,
            'mais CHAQUE flèche porte bien son propre fond, semi-translucide — retour utilisateur explicite');
        // ...et RÉDUIT (padding + background-clip:content-box), pas étalé sur toute la case cliquable
        // de 34×34px (elle, inchangée — voir style.css) : « qui ne prend pas toute la largeur des 4
        // flèches » (retour utilisateur).
        check(styleDpad.fondCantonne, 'et ce fond ne prend PAS toute la largeur du bouton, cantonné par un padding — retour utilisateur explicite');

        // La partition, elle, garde SA PROPRE zone de défilement (#zone-partition, à l'intérieur de
        // .zone-conteneur) : la croix ne doit ni la faire défiler à sa place, ni défiler AVEC elle.
        const rectAvantDefilement = await dpad.boundingBox();
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.partition.mesures = Array.from({ length: 30 }, () => m.creerMesure({
                voix: [{ evenements: [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)])) }],
            }));
            ed.prevenir('document');
            window.app.dessiner();
        });
        await page.waitForTimeout(200);
        await page.evaluate(() => { document.getElementById('zone-partition').scrollTop = 400; });
        await page.waitForTimeout(150);
        const rectApresDefilement = await dpad.boundingBox();
        check(await page.evaluate(() => document.getElementById('zone-partition').scrollTop) === 400,
            'préalable : la partition a bien défilé (sans quoi ce cas ne prouverait rien)');
        check(rectApresDefilement.x === rectAvantDefilement.x && rectApresDefilement.y === rectAvantDefilement.y,
            'et la croix flottante, elle, RESTE AU MÊME ENDROIT de l\'écran — elle ne défile pas avec la partition');

        // --- La préférence : éteindre l'interrupteur replie le pavé, et ça survit au rechargement -----
        await page.evaluate(() => window.app.appliquerPave(false));
        await page.waitForTimeout(150);
        check(!(await pave.isVisible()), 'éteindre l\'interrupteur replie le pavé');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.app && window.app.page, null, { timeout: 20000 });
        await page.waitForTimeout(250);
        check(!(await page.locator('#pave-tactile').isVisible()),
            'et ce choix survit au rechargement : le pavé reste replié');
        // L'interrupteur, lui, se peuple à l'OUVERTURE du panneau (voir remplirReglages) — comme tous
        // les champs de ce panneau. On l'ouvre donc pour le lire, ce qui est aussi le seul moment où
        // l'utilisateur le voit (uniquement sur un appareil tactile, exactement ce que ce banc émule).
        await page.click('#btn-reglages');
        await page.waitForTimeout(200);
        check(!(await page.evaluate(() => document.getElementById('ligne-pave').hidden)),
            'sur un appareil tactile, le réglage du pavé est bien montré dans les Réglages');
        check((await page.evaluate(() => document.getElementById('champ-pave').getAttribute('aria-checked'))) === 'false',
            'et l\'interrupteur y montre bien « éteint »');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
