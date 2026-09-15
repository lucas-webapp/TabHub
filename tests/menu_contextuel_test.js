// Banc du MENU CONTEXTUEL (clic droit sur une note).
//
// CE QU'IL PROTÈGE : le CÂBLAGE entre le clic droit et les commandes de l'éditeur — le menu s'ouvre
// au bon endroit, sur la bonne case (même ciblage que le clic gauche, voir main.js#cibleDepuisClic),
// propose les bonnes actions, et se ferme proprement (clic ailleurs, Échap, ou après un choix) sans
// jamais laisser le menu natif du navigateur apparaître. La LOGIQUE des commandes elles-mêmes
// (insererAvant, supprimerEvenement…) est déjà éprouvée par rythme_strict_test.js ; ce banc-ci ne la
// reproduit pas, il vérifie seulement que le clic droit les déclenche correctement.
//
// TROIS NOIRES SEULEMENT dans une mesure à 4/4 (jamais quatre) : la mesure garde ainsi un temps de
// place LIBRE tout du long, condition nécessaire pour que « Insérer » puisse réellement réussir (une
// mesure exactement pleine refuserait toute insertion — voir rythme_strict_test.js — et ce banc
// porte sur le câblage du clic droit, pas sur cette limite déjà éprouvée ailleurs).

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('menu contextuel');

(async () => {
    plan(14);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [5, 6, 7].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)]));
            ed.prevenir('document');
        });
        await page.waitForTimeout(150);

        /** Point client (écran) au centre de la case d'indice `i` de la mesure 0 — sur la portée, pas
         *  la TAB, pour ne pas interférer avec la détection de corde par la hauteur du clic. */
        const pointDeLaCase = async (i) => page.evaluate((i) => {
            const svg = document.querySelector('#feuille svg');
            const boite = svg.getBoundingClientRect();
            const a = window.app.page.ancrages.evenements.find(e => e.mesure === 0 && e.evenement === i);
            const xSvg = (a.xDebut + a.xFin) / 2;
            const ySvg = a.yPortee;
            return {
                x: boite.left + (xSvg / window.app.page.largeur) * boite.width,
                y: boite.top + (ySvg / window.app.page.hauteur) * boite.height,
            };
        }, i);
        const contenu = () => page.evaluate(() => window.app.editeur.partition.mesures[0].voix[0].evenements.map(
            e => (e.silence || !e.notes.length) ? '_' : e.notes[0].frette));

        // --- Ouverture : bonnes actions, bon positionnement -----------------------------------------
        let p = await pointDeLaCase(1);   // la case fret 6
        await page.mouse.click(p.x, p.y, { button: 'right' });
        await page.waitForTimeout(80);
        const menu = page.locator('#menu-contextuel');
        exiger(await menu.isVisible(), 'le clic droit ouvre le menu contextuel');
        const textes = await menu.locator('button').allTextContents();
        // TROIS FAMILLES, dans cet ordre, chacune ajoutée par un retour utilisateur sans jamais
        // déplacer les précédentes : les quatre premières portent sur la NOTE (le clic droit
        // d'origine), les trois suivantes sur la MESURE (« ajoute des options pour ajouter une mesure
        // avant ou après »), et « Copier cette mesure » ouvre la dernière (« permets-moi de
        // copier/coller une mesure complète avec clic droit »). Voir main.js#ouvrirMenuContextuel.
        //
        // « Coller » n'y figure PAS ici : le presse-papier est vide à l'ouverture du banc, et une
        // entrée qu'on ne peut pas utiliser n'apprend rien — elle apparaît plus bas, une fois copié.
        //
        // « AIDE RYTHMIQUE À PARTIR D'ICI… » s'est ajoutée depuis, entre le saut de ligne et la copie
        // (retour utilisateur : « je dois pouvoir choisir où l'insérer [...] le placer à la souris ou
        // au doigt »). C'est ce menu qui donne l'endroit : il s'ouvre déjà SUR la mesure visée, donc
        // le geste qui appelle la fenêtre choisit aussi où elle écrira — voir main.js#ouvrirAideRythme.
        check(textes.join('|') === 'Supprimer|Supprimer et décaler la suite|Insérer une note à gauche|Insérer une note à droite'
            + '|Ajouter une mesure avant|Ajouter une mesure après|Supprimer cette mesure'
            + '|Commencer une nouvelle ligne ici|Aide rythmique à partir d\'ici…|Copier cette mesure',
            'les dix actions attendues, dans cet ordre, et aucun « Coller » tant que rien n\'est copié');
        const boiteMenu = await menu.boundingBox();
        check(Math.abs(boiteMenu.x - p.x) < 20 && Math.abs(boiteMenu.y - p.y) < 20, 'le menu s\'ouvre AU POINT du clic, pas ailleurs');

        // --- Échap ferme sans rien changer ----------------------------------------------------------
        const avant = await page.evaluate(() => JSON.stringify(window.app.editeur.partition));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(80);
        check(!(await menu.isVisible()), 'Échap referme le menu');
        check((await page.evaluate(() => JSON.stringify(window.app.editeur.partition))) === avant, 'sans la moindre mutation');

        // --- Clic ailleurs ferme sans rien changer ---------------------------------------------------
        p = await pointDeLaCase(1);
        await page.mouse.click(p.x, p.y, { button: 'right' });
        await page.waitForTimeout(80);
        await page.mouse.click(20, 20);   // un point hors du menu
        await page.waitForTimeout(80);
        check(!(await menu.isVisible()), 'un clic ailleurs referme aussi le menu');

        // --- « Supprimer » : effacerNote (en place, silence, aucun décalage) -------------------------
        p = await pointDeLaCase(1);
        await page.mouse.click(p.x, p.y, { button: 'right' });
        await page.waitForTimeout(80);
        await menu.locator('button', { hasText: 'Supprimer' }).first().click();
        await page.waitForTimeout(80);
        exiger(!(await menu.isVisible()), 'choisir une action referme le menu');
        check((await contenu()).join(',') === '5,_,7', '« Supprimer » vide la case EN PLACE, rien ne se décale (toujours trois cases)');

        // --- « Insérer une note à gauche » sur la case fret 7 (dernière, indice 2) ------------------
        p = await pointDeLaCase(2);
        await page.mouse.click(p.x, p.y, { button: 'right' });
        await page.waitForTimeout(80);
        await menu.locator('button', { hasText: 'Insérer une note à gauche' }).click();
        await page.waitForTimeout(80);
        const c1 = await contenu();
        check(c1.length === 4 && c1[2] === '_' && c1[3] === 7, '« Insérer une note à gauche » intercale une case juste AVANT celle visée (fret 7 décalé d\'un cran)');

        // --- « Supprimer et décaler la suite » sur la toute première case (fret 5) -------------------
        p = await pointDeLaCase(0);
        await page.mouse.click(p.x, p.y, { button: 'right' });
        await page.waitForTimeout(80);
        await menu.locator('button', { hasText: 'Supprimer et décaler la suite' }).click();
        await page.waitForTimeout(80);
        const c2 = await contenu();
        check(c2.filter(f => f !== '_').join(',') === '7', '« Supprimer et décaler » retire fret 5 et décale tout le reste — seul fret 7 reste, en une seule note');

        exiger(await page.evaluate(() => document.getElementById('menu-contextuel').getAttribute('role')) === 'menu',
            'le menu porte bien un rôle ARIA de menu');

        // --- Le trait de séparation entre groupes se VOIT vraiment ----------------------------------
        // `--border` (#333 sur #161616, --card-bg) se distingue bien contre du texte ou une carte,
        // mais un trait qui flotte SEUL, sans rien d'autre à proximité, y devenait quasi invisible sur
        // un vrai téléphone (retour utilisateur, capture à l'appui) : deux « lignes vides » à la place
        // des séparateurs. `--btn-neutral-border-hover`, nettement plus clair, doit être en place.
        p = await pointDeLaCase(0);
        await page.mouse.click(p.x, p.y, { button: 'right' });
        await page.waitForTimeout(80);
        const couleurSeparateur = await page.evaluate(() =>
            getComputedStyle(document.querySelector('#menu-contextuel .separateur')).borderTopColor);
        check(couleurSeparateur === 'rgb(74, 74, 74)', 'le séparateur du menu contextuel utilise une couleur assez contrastée pour se voir (pas --border, trop proche du fond)');

        // --- LE LIBELLÉ DU RETOUR À LA LIGNE DIT L'ÉTAT COURANT -------------------------------------
        // « Commencer une nouvelle ligne ici » quand il n'y a pas de saut, « Ne plus commencer… »
        // quand il y en a un. Sans cela, l'entrée ne se lirait qu'en la touchant pour voir — et un
        // saut déjà posé n'aurait aucun moyen de se signaler. Éprouvé EN DERNIER, avec sa propre
        // cible dans la mesure 2 : posé au milieu du banc, il coupait l'enchaînement des vérifications
        // de position, qui ont besoin du menu resté ouvert au même point.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
        await page.evaluate(() => { const ed = window.app.editeur; ed.placerCurseur(1, 0, 0); ed.basculerSautDeLigne(); window.app.dessiner(); });
        await page.waitForTimeout(250);
        const pM2 = await page.evaluate(() => {
            const svg = document.querySelector('#feuille svg');
            const b = svg.getBoundingClientRect();
            const a = window.app.page.ancrages.mesures.find(x => x.index === 1);
            return {
                x: b.left + ((a.x + a.xFin) / 2 / window.app.page.largeur) * b.width,
                y: b.top + (a.yPortee / window.app.page.hauteur) * b.height,
            };
        });
        await page.mouse.click(pM2.x, pM2.y, { button: 'right' });
        await page.waitForTimeout(200);
        check((await menu.locator('button').allTextContents()).includes('Ne plus commencer une ligne ici'),
            'sur une mesure qui porte déjà un saut, l\'entrée propose de le RETIRER plutôt que de le reposer');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
