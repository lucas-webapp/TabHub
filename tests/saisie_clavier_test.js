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

        // --- UNE FRAPPE PAR NOTE : l'avance automatique -------------------------------------------
        // CE QUE CE BLOC MESURE, et c'est le geste le plus répété de toute l'application. Écrire huit
        // croches demandait SEIZE frappes : un chiffre, une flèche, un chiffre, une flèche. Il en
        // demande huit. MuseScore et Dorico avancent de la même façon, et c'est ce qui fait qu'on y
        // écrit au fil de la pensée plutôt qu'en remplissant un formulaire.
        await taper(page, ['Digit0', 'Digit3', 'Digit5', 'Digit7', 'Digit8', 'Digit7', 'Digit5', 'Digit3']);
        let e = await lireEtat(page);
        exiger(e.contenu[0].length === 8, 'huit frappes, huit évènements dans la PREMIÈRE mesure');
        check(e.contenu[0].join(' ') === '0:0 0:3 0:5 0:7 0:8 0:7 0:5 0:3', 'les huit cases sont posées dans l\'ordre tapé');
        check(e.durees[0].every(v => v === 8), 'toutes à la durée courante (croche), sans avoir à la redire');
        check(e.curseur.mesure === 1 && e.curseur.evenement === 0,
            `et la mesure pleine, l'avance franchit la barre d'elle-même (mesure ${e.curseur.mesure}) : `
            + 'on continue d\'écrire sans lever les doigts');

        // --- Cases à deux chiffres : on revient sur la case -----------------------------------------
        // LA POSITION TRANCHE CE QUE LE DÉLAI NE PEUT PAS. Tant que le curseur ne bougeait pas tout
        // seul, « deux chiffres en moins de 950 ms » suffisait à reconnaître une case à deux chiffres.
        // Avec l'avance, huit croches tapées à vitesse humaine tombent toutes dans cette fenêtre :
        // mesuré, huit frappes donnaient UNE note. Le chiffre ne complète donc la case précédente que
        // si le curseur est resté DESSUS — d'où le « ← », une frappe de plus pour les cases 10 à 24,
        // qui sont rares, contre une de moins pour toutes les autres.
        await taper(page, ['Digit1', 'ArrowLeft', 'Digit2'], 40);
        e = await lireEtat(page);
        check(e.contenu[1][0] === '0:12', '« 1 », « ← », « 2 » donne la case 12');

        // Et SANS le retour, deux chiffres sont deux notes — la contrepartie exacte de la règle.
        await taper(page, ['ArrowRight', 'Digit4', 'Digit6'], 40);
        e = await lireEtat(page);
        check(e.contenu[1][1] === '0:4' && e.contenu[1][2] === '0:6',
            `« 4 » puis « 6 » sans retour donne deux notes (${e.contenu[1][1]}, ${e.contenu[1][2]}), `
            + 'pas une case 46 ni une case 6 qui écraserait la première');

        // Un enchaînement qui dépasserait le manche garde le SECOND chiffre : « 2 » puis « 7 » ne peut
        // pas vouloir dire case 27 sur une guitare, donc cela veut dire case 7.
        await taper(page, ['Digit2', 'ArrowLeft', 'Digit7'], 40);
        e = await lireEtat(page);
        check(e.contenu[1][3] === '0:7', 'un enchaînement hors manche (27) retombe sur la case 7');

        // Deux chiffres ESPACÉS dans le temps sont deux saisies distinctes : la seconde écrase.
        await taper(page, ['ArrowRight', 'Digit1']);
        await page.waitForTimeout(1100);
        await taper(page, ['ArrowLeft', 'Digit2']);
        e = await lireEtat(page);
        check(e.contenu[1][4] === '0:2', 'deux chiffres espacés d\'une seconde ne se combinent pas, même sur place');

        // --- Accords : empiler des cordes sur le même évènement -------------------------------------
        // Le « ← » revient sur la note qu'on vient d'écrire ; c'est la frappe que l'accord paie, et
        // la seule. On n'a PAS tenté de deviner (revenir tout seul quand on change de corde juste
        // après) : une mélodie qui saute d'une corde à l'autre est tout aussi courante, et un geste
        // qui devine se trompe la moitié du temps.
        // Le premier « ← » ramène sur la case 2 qu'on vient d'écrire : le chiffre précédent a
        // avancé comme les autres, même s'il n'a pas complété de case à deux chiffres.
        await taper(page, ['ArrowLeft', 'ArrowDown', 'Digit5', 'ArrowLeft', 'ArrowDown', 'Digit5',
                           'ArrowLeft', 'ArrowDown', 'Digit3']);
        e = await lireEtat(page);
        check(e.contenu[1][4] === '0:2+1:5+2:5+3:3', 'quatre cordes sonnent ensemble sur un seul évènement');

        // --- Effacement ------------------------------------------------------------------------------
        // « ← » d'abord : le dernier chiffre de l'accord a avancé comme les autres, et Suppr efface
        // la case SOUS le curseur.
        await taper(page, ['ArrowLeft', 'Delete']);
        e = await lireEtat(page);
        check(e.contenu[1][4] === '0:2+1:5+2:5',
            `Suppr efface la note de la corde visée, pas l'accord entier (reçu « ${e.contenu[1][4]} »)`);

        // --- Annuler / rétablir ------------------------------------------------------------------------
        const avant = (await lireEtat(page)).contenu[1][4];
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(120);
        check((await lireEtat(page)).contenu[1][4] === '0:2+1:5+2:5+3:3', 'Ctrl+Z restitue la note effacée');
        await page.keyboard.press('Control+y');
        await page.waitForTimeout(120);
        check((await lireEtat(page)).contenu[1][4] === avant, 'Ctrl+Y la ré-efface');

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
