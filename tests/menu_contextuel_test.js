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
    plan(12);
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
        check(textes.join('|') === 'Supprimer|Supprimer et décaler la suite|Insérer une note à gauche|Insérer une note à droite',
            'les quatre actions attendues, dans cet ordre');
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

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
