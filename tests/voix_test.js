// Banc des VOIX : une mesure peut porter une mélodie ET une basse tenue, chacune son propre rythme.
//
// Ce que ce banc protège, au-delà du modèle et du rendu (déjà éprouvés ailleurs) : le GESTE
// d'édition — ajouter une 2e voix, y basculer, y saisir, la retirer — et sa réflexion fidèle dans la
// palette (un bouton qui n'a plus de sens doit se cacher, pas rester affiché sans effet).

const creerHarnais = require('./_harness.js');
const { ouvrirApp, taper, lireEtat } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('voix');

(async () => {
    plan(19);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // --- État initial : une seule voix, palette cohérente ----------------------------------------
        let e = await lireEtat(page);
        exiger(e.nbVoix[0] === 1, 'une mesure neuve n\'a qu\'une voix');
        const visible = (sel) => page.$eval(sel, b => !b.hidden).catch(() => false);
        check(await visible('[data-action="ajouterVoix"]'), '« + Voix » est visible tant qu\'il n\'y a qu\'une voix');
        check(!(await visible('[data-action="supprimerVoix"]')), '« − Voix » ne l\'est pas encore');
        check(!(await visible('[data-action="basculerVoix"]')), 'ni « voix suivante »');

        // --- Ajouter une 2e voix, y saisir une basse tenue -------------------------------------------
        await page.click('[data-action="duree8"]');
        await page.evaluate(() => document.getElementById('zone-partition').focus());
        await taper(page, ['Digit3', 'ArrowRight', 'Digit5', 'ArrowRight', 'Digit7', 'ArrowRight', 'Digit8']);
        await page.click('[data-action="ajouterVoix"]');
        await page.waitForTimeout(150);
        e = await lireEtat(page);
        check(e.nbVoix[0] === 2, '« + Voix » porte la mesure à deux voix');
        check(e.curseur.voix === 1, 'et bascule aussitôt la saisie sur la voix neuve, pour la remplir');

        await page.click('[data-action="duree2"]');
        await taper(page, ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Digit0']);
        e = await lireEtat(page);
        check(e.toutesVoix[0][0][0] === '0:3', 'la mélodie (voix 0) est intacte : la saisie en voix 1 ne l\'a pas modifiée');
        check(e.toutesVoix[0][1][0] === '5:0', 'la basse (voix 1) porte bien sa propre note, sur sa propre corde');
        check(await visible('[data-action="supprimerVoix"]'), '« − Voix » apparaît maintenant que la mesure en a deux');
        check(await visible('[data-action="basculerVoix"]'), 'ainsi que « voix suivante »');
        check(!(await visible('[data-action="ajouterVoix"]')), 'et « + Voix » s\'efface : deux voix est le maximum de la V1');

        // --- Basculer (Tab) revient à la mélodie, y compris pour la SAISIE au clavier ----------------
        // Curseur placé EXPLICITEMENT (mesure, évènement, corde, voix) plutôt qu'en enchaînant des
        // flèches depuis un état hérité : la corde utilisée pour poser la basse (corde 5) resterait
        // sinon celle du curseur après la bascule, et un chiffre tapé « à l'aveugle » ajouterait une
        // note de PLUS sur cette corde-là au lieu de corriger la note de mélodie visée.
        await page.evaluate(() => window.app.editeur.placerCurseur(0, 0, 0, 0));
        await page.waitForTimeout(120);
        e = await lireEtat(page);
        check(e.curseur.voix === 0, 'le curseur se replace bien sur la voix 0');
        await page.click('[data-action="duree8"]');
        await page.keyboard.press('Digit9');
        e = await lireEtat(page);
        check(e.toutesVoix[0][0][0] === '0:9', 'la saisie sur la voix 0 modifie bien la mélodie, pas la basse');
        check(e.toutesVoix[0][1][0] === '5:0', 'et la basse reste inchangée');

        // --- Aller-retour curseur : sortir d'une mesure à 2 voix vers une mesure à 1 voix --------------
        // La voix 1 (basse) ne porte qu'une blanche (2 noires sur les 4 de la mesure) : avec la durée
        // courante encore réglée sur la croche, « → » la PROLONGERAIT au lieu de franchir la mesure
        // (c'est la règle voulue — voir edit/commands.js). On choisit ici une ronde comme durée
        // courante, plus large que ce qu'il reste dans la mesure, pour forcer le franchissement et
        // éprouver PRÉCISÉMENT ce que ce banc vise : le repli sur la voix 0 de la mesure suivante.
        await page.evaluate(() => window.app.editeur.placerCurseur(0, 0, 0, 1));
        await page.click('[data-action="duree1"]');
        await page.waitForTimeout(120);
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(120);
        e = await lireEtat(page);
        check(e.curseur.mesure === 1 && e.curseur.voix === 0, 'sortir d\'une mesure à 2 voix retombe sur la voix 0 de la suivante');

        // --- Supprimer la voix ------------------------------------------------------------------------
        await page.evaluate(() => window.app.editeur.placerCurseur(0, 0, 0, 0));
        await page.click('[data-action="supprimerVoix"]');
        await page.waitForTimeout(150);
        e = await lireEtat(page);
        check(e.nbVoix[0] === 1, '« − Voix » retire la voix d\'accompagnement');
        check(e.toutesVoix[0][0][0] === '0:9', 'la mélodie n\'est pas touchée par la suppression de l\'autre voix');
        check(await visible('[data-action="ajouterVoix"]'), '« + Voix » redevient visible');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
