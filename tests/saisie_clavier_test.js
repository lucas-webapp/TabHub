// Banc de la SAISIE AU CLAVIER — la promesse centrale de l'application : écrire une tablature aussi
// vite qu'on la lit, sans quitter le clavier.
//
// Il couvre en particulier les deux règles qui décident de cette fluidité, et qu'une première version
// avait toutes deux ratées : les cases à deux chiffres, et la prolongation de mesure par « → ».

const creerHarnais = require('./_harness.js');
const { ouvrirApp, taper, lireEtat } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('saisie clavier');

(async () => {
    plan(14);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        await page.click('[data-action="duree8"]');
        await page.evaluate(() => document.getElementById('zone-partition').focus());

        // --- Prolongation de mesure ---------------------------------------------------------------
        // « → » depuis le dernier évènement d'une mesure NON PLEINE doit l'allonger, pas sauter à la
        // mesure suivante. Sans cette règle, écrire huit croches dispersait les huit notes sur huit
        // mesures : la saisie au clavier devenait inutilisable là où elle devait briller.
        await taper(page, ['Digit0', 'ArrowRight', 'Digit3', 'ArrowRight', 'Digit5', 'ArrowRight', 'Digit7',
                           'ArrowRight', 'Digit8', 'ArrowRight', 'Digit7', 'ArrowRight', 'Digit5', 'ArrowRight', 'Digit3']);
        let e = await lireEtat(page);
        exiger(e.curseur.mesure === 0, 'huit croches restent dans la PREMIÈRE mesure');
        check(e.contenu[0].length === 8, 'la mesure contient bien huit évènements');
        check(e.contenu[0].join(' ') === '0:0 0:3 0:5 0:7 0:8 0:7 0:5 0:3', 'les huit cases sont posées dans l\'ordre tapé');
        check(e.durees[0].every(v => v === 8), 'toutes à la durée courante (croche), sans avoir à la redire');

        // Une neuvième croche ne tient plus dans un 4/4 : là, et là seulement, on change de mesure.
        await taper(page, ['ArrowRight']);
        e = await lireEtat(page);
        check(e.curseur.mesure === 1, 'une fois la mesure pleine, « → » passe à la suivante');

        // --- Cases à deux chiffres -----------------------------------------------------------------
        await taper(page, ['Digit1', 'Digit2'], 40);
        e = await lireEtat(page);
        check(e.contenu[1][0] === '0:12', 'deux chiffres tapés rapidement donnent la case 12');

        // Un enchaînement qui dépasserait le manche garde le SECOND chiffre : « 2 » puis « 7 » ne peut
        // pas vouloir dire case 27 sur une guitare, donc cela veut dire case 7.
        await taper(page, ['ArrowRight', 'Digit2', 'Digit7'], 40);
        e = await lireEtat(page);
        check(e.contenu[1][1] === '0:7', 'un enchaînement hors manche (27) retombe sur la case 7');

        // Deux chiffres ESPACÉS dans le temps sont deux saisies distinctes : la seconde écrase.
        await taper(page, ['ArrowRight', 'Digit1']);
        await page.waitForTimeout(1100);
        await taper(page, ['Digit2']);
        e = await lireEtat(page);
        check(e.contenu[1][2] === '0:2', 'deux chiffres espacés d\'une seconde ne se combinent pas');

        // --- Accords : empiler des cordes sur le même évènement -------------------------------------
        await taper(page, ['ArrowDown', 'Digit5', 'ArrowDown', 'Digit5', 'ArrowDown', 'Digit3']);
        e = await lireEtat(page);
        check(e.contenu[1][2] === '0:2+1:5+2:5+3:3', 'quatre cordes sonnent ensemble sur un seul évènement');

        // --- Effacement ------------------------------------------------------------------------------
        await taper(page, ['Delete']);
        e = await lireEtat(page);
        check(e.contenu[1][2] === '0:2+1:5+2:5', 'Suppr efface la note de la corde visée, pas l\'accord entier');

        // --- Annuler / rétablir ------------------------------------------------------------------------
        const avant = (await lireEtat(page)).contenu[1][2];
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(120);
        check((await lireEtat(page)).contenu[1][2] === '0:2+1:5+2:5+3:3', 'Ctrl+Z restitue la note effacée');
        await page.keyboard.press('Control+y');
        await page.waitForTimeout(120);
        check((await lireEtat(page)).contenu[1][2] === avant, 'Ctrl+Y la ré-efface');

        // --- Les chiffres tapés dans un CHAMP ne doivent pas écrire dans la partition ------------------
        // Sans cette garde, régler le tempo à 120 posait aussi trois notes.
        const avantTempo = await lireEtat(page);
        await page.fill('#champ-tempo', '144');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(200);
        const apresTempo = await lireEtat(page);
        check(JSON.stringify(apresTempo.contenu) === JSON.stringify(avantTempo.contenu), 'taper dans le champ Tempo n\'écrit AUCUNE note');
        check(apresTempo.tempo === 144, 'et règle bien le tempo');

        check(erreurs.length === 0, 'aucune erreur JavaScript pendant la saisie' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
