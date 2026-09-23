// Banc des DIALOGUES MAISON et des GARDE-FOUS — voir src/ui/dialogue.js et
// main.js#peutEcraserLeMorceau.
//
// DEUX RETOURS UTILISATEUR, une seule mécanique. « Amélioration du visuel des pop-ups : comme sur
// HarmoHub. Aujourd'hui elles ne sont pas stylées » et « mise en place de pop-ups à la fermeture pour
// demander la sauvegarde ou pour confirmer la fermeture ». Les deux tiennent au même manque : trois
// boîtes NATIVES du navigateur subsistaient (deux `window.prompt`, un `confirm`), et une boîte native
// ne peut porter que deux boutons aux libellés figés — donc pas les trois choix qu'un garde-fou
// honnête doit offrir.
//
// CE QUE CE BANC PROTÈGE, et dans cet ordre de gravité :
//   1. AUCUNE boîte native ne doit plus s'ouvrir. On piège `window.prompt` et `window.confirm` : s'ils
//      sont appelés, le compteur le dit. C'est la seule façon de le vérifier — une boîte native ne
//      laisse aucune trace dans le DOM.
//   2. Taper des CHIFFRES dans un champ de dialogue ne doit pas écrire de cases sur la partition
//      derrière. L'application écoute `keydown` sur `document` et y lit les chiffres comme des frettes
//      (voir edit/keyboard.js). DEUX mécanismes indépendants l'empêchent aujourd'hui — la garde
//      `dansUnChamp` de keyboard.js, et l'écoute en capture du dialogue — et cette vérification ne
//      distingue pas lequel opère : c'est le RÉSULTAT qu'elle protège. Mesuré en neutralisant la
//      capture : la garde seule suffit déjà, donc la vérification passe dans les deux cas. Elle vaut
//      quand même, parce que le jour où l'un des deux mécanismes disparaît, elle est le seul endroit
//      qui s'en apercevra.
//   3. Le garde-fou ne se déclenche QUE s'il y a quelque chose à perdre. Un avertissement qui
//      apparaît pour rien s'apprend à cliquer sans lire, et ne protège plus le jour où il compte.
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('dialogues maison et garde-fous');

(async () => {
    plan(20);
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 1320, height: 900 } });
    try {
        // LES PIÈGES, posés avant tout le reste. Ils REMPLACENT les fonctions natives : si un chemin
        // les appelle encore, le banc le sait, et la page ne se bloque pas sur une boîte modale que
        // Playwright devrait aller fermer.
        await page.evaluate(() => {
            window.__natif = [];
            window.prompt = (m) => { window.__natif.push('prompt:' + m); return 'piégé'; };
            window.confirm = (m) => { window.__natif.push('confirm:' + m); return true; };
        });
        const dialogue = () => page.evaluate(() => {
            const v = document.getElementById('fenetre-dialogue');
            return {
                ouvert: !v.hidden,
                titre: v.querySelector('.dialogue-titre').textContent,
                texte: v.querySelector('.dialogue-texte').textContent,
                champVisible: !v.querySelector('.dialogue-ligne-champ').hidden,
                focusChamp: document.activeElement === v.querySelector('.dialogue-champ'),
                boutons: [...v.querySelectorAll('.dialogue-actions button')].map(b => ({ t: b.textContent, c: b.className })),
            };
        });
        const natifs = () => page.evaluate(() => window.__natif);

        // --- 1. L'ANNOTATION DE SECTION : une saisie, maison -----------------------------------------
        await page.evaluate(() => { const ed = window.app.editeur; ed.placerCurseur(0, 0, 0, 0); ed.saisirChiffre(5); ed.placerCurseur(0, 0, 0, 0); });
        await page.waitForTimeout(200);
        await page.click('[data-action="annotation"]');
        await page.waitForTimeout(300);
        const d1 = await dialogue();
        exiger(d1.ouvert && d1.champVisible,
            'l\'annotation de section ouvre une fenêtre MAISON avec un champ de saisie');
        check(d1.titre === 'Annotation de section' && /vide pour la retirer/i.test(d1.texte),
            `elle porte un titre et une phrase d'explication (« ${d1.titre} »), là où prompt() n'avait qu'une ligne`);
        check(d1.focusChamp, 'et le curseur de frappe y est déjà : on vient écrire, pas chercher où cliquer');
        check(d1.boutons.map(b => b.t).join('/') === 'Annuler/Valider',
            `deux boutons NOMMÉS en français (${d1.boutons.map(b => b.t).join(', ')}), pas « OK/Cancel » imposés par le navigateur`);

        // LE PIÈGE DES CHIFFRES. « Couplet 7 » contient un 7 : sans l'écoute en capture du dialogue,
        // la partition derrière recevrait une case 7 en même temps.
        const notesAvant = await page.evaluate(() =>
            JSON.stringify(window.app.editeur.mesureCourante().voix[0].evenements.map(e => e.notes.map(n => n.frette))));
        await page.keyboard.type('Couplet 7');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        const apres = await page.evaluate(() => ({
            annotation: window.app.editeur.partition.mesures[0].annotation,
            notes: JSON.stringify(window.app.editeur.mesureCourante().voix[0].evenements.map(e => e.notes.map(n => n.frette))),
            ferme: document.getElementById('fenetre-dialogue').hidden,
        }));
        check(apres.annotation === 'Couplet 7' && apres.ferme,
            'Entrée valide la saisie et referme la fenêtre');
        check(apres.notes === notesAvant,
            `et le « 7 » de « Couplet 7 » n'a PAS écrit de case 7 sur la partition derrière (${apres.notes})`);

        // Échap annule : la valeur précédente reste.
        await page.click('[data-action="annotation"]');
        await page.waitForTimeout(250);
        await page.keyboard.type('à jeter');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
        check(await page.evaluate(() => window.app.editeur.partition.mesures[0].annotation === 'Couplet 7'
              && document.getElementById('fenetre-dialogue').hidden),
            'Échap referme sans rien changer — la valeur d\'avant reste en place');

        // Une saisie VIDE retire l'annotation : c'est la distinction vide/annulé, celle de prompt(),
        // dont les appelants dépendent.
        await page.click('[data-action="annotation"]');
        await page.waitForTimeout(250);
        await page.evaluate(() => { document.querySelector('.dialogue-champ').value = ''; });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(250);
        check(!(await page.evaluate(() => window.app.editeur.partition.mesures[0].annotation)),
            'valider un champ VIDE retire l\'annotation, là où annuler l\'aurait gardée — vide et annulé restent deux réponses différentes');

        // --- 2. LE NOM D'ACCORD : la même mécanique, sur l'évènement --------------------------------
        await page.click('[data-action="accord"]');
        await page.waitForTimeout(250);
        const d2 = await dialogue();
        check(d2.ouvert && d2.titre === 'Nom d\'accord' && d2.champVisible,
            'le nom d\'accord ouvre la même fenêtre, sur l\'évènement plutôt que la mesure');
        await page.keyboard.type('A7');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(250);
        const accord = await page.evaluate(() => ({
            accord: window.app.editeur.evenementCourant().accord,
            notes: JSON.stringify(window.app.editeur.mesureCourante().voix[0].evenements.map(e => e.notes.map(n => n.frette))),
        }));
        check(accord.accord === 'A7' && accord.notes === notesAvant,
            `« A7 » s'écrit comme accord, et son 7 ne devient pas une case (${accord.notes})`);

        // --- 3. LE GARDE-FOU : rien à perdre, rien à demander ---------------------------------------
        // On exporte d'abord pour repartir d'un état « mis à l'abri », puis on vérifie que « Nouveau »
        // passe sans rien demander.
        const att = page.waitForEvent('download');
        await page.click('#btn-fichiers');
        await page.click('#popover-fichiers [data-action="exporter-json"]');
        await att;
        await page.waitForTimeout(250);
        await page.click('#btn-fichiers');
        await page.click('#popover-fichiers [data-action="nouveau"]');
        await page.waitForTimeout(300);
        check(await page.evaluate(() => document.getElementById('fenetre-dialogue').hidden),
            'juste après un export, « Nouveau » ne demande rien : il n\'y a rien à perdre');

        // --- 4. LE GARDE-FOU : une modification, et il apparaît -------------------------------------
        await page.evaluate(() => { const ed = window.app.editeur; ed.placerCurseur(0, 0, 0, 0); ed.saisirChiffre(9); ed.placerCurseur(0, 0, 0, 0); });
        await page.waitForTimeout(250);
        await page.click('#btn-fichiers');
        await page.click('#popover-fichiers [data-action="nouveau"]');
        await page.waitForTimeout(300);
        const g = await dialogue();
        exiger(g.ouvert && !g.champVisible, 'une modification non exportée fait apparaître le garde-fou avant « Nouveau »');
        check(g.boutons.length === 3
              && g.boutons[0].c.includes('btn-neutre') && g.boutons[1].c.includes('btn-danger') && g.boutons[2].c.includes('btn-plein'),
            `TROIS choix nommés, hiérarchisés à l'œil (${g.boutons.map(b => b.t).join(' · ')}) — ce qu'aucun confirm() natif ne sait porter`);

        // Annuler garde le travail : c'est la garantie qui compte.
        await page.click('#fenetre-dialogue [data-choix="annuler"]');
        await page.waitForTimeout(250);
        check(await page.evaluate(() => window.app.editeur.evenementCourant().notes.some(n => n.frette === 9)),
            '« Annuler » laisse la tablature intacte, note comprise');

        // « Exporter puis continuer » fait les DEUX : le fichier part, et le morceau neuf arrive.
        await page.click('#btn-fichiers');
        await page.click('#popover-fichiers [data-action="nouveau"]');
        await page.waitForTimeout(300);
        const att2 = page.waitForEvent('download');
        await page.click('#fenetre-dialogue [data-choix="exporter"]');
        const tel = await att2;
        await page.waitForTimeout(300);
        check(/\.json$/.test(tel.suggestedFilename())
              && await page.evaluate(() => !window.app.editeur.evenementCourant().notes.length),
            `« Exporter puis continuer » télécharge le .json (${tel.suggestedFilename()}) ET repart d'une tablature vierge`);

        // --- 5. L'AVERTISSEMENT À LA FERMETURE ------------------------------------------------------
        // La boîte de `beforeunload` appartient au navigateur (aucun bouton maison n'y est permis) :
        // ce qui se vérifie ici, c'est que l'application la RÉCLAME — et seulement quand il le faut.
        const sonderFermeture = () => page.evaluate(() => {
            const e = new Event('beforeunload', { cancelable: true });
            window.dispatchEvent(e);
            return e.defaultPrevented;
        });
        check((await sonderFermeture()) === false,
            'sur une tablature vierge, fermer l\'onglet ne demande aucune confirmation');
        await page.evaluate(() => { const ed = window.app.editeur; ed.placerCurseur(0, 0, 0, 0); ed.saisirChiffre(4); ed.placerCurseur(0, 0, 0, 0); });
        await page.waitForTimeout(250);
        check((await sonderFermeture()) === true,
            'une modification non exportée, et la fermeture demande confirmation');
        const att3 = page.waitForEvent('download');
        await page.click('#btn-fichiers');
        await page.click('#popover-fichiers [data-action="exporter-json"]');
        await att3;
        await page.waitForTimeout(250);
        check((await sonderFermeture()) === false,
            'une fois exportée, elle ne la demande plus — un avertissement systématique s\'apprendrait à ignorer');

        // --- 6. AUCUNE BOÎTE NATIVE, SUR AUCUN DE CES CHEMINS ---------------------------------------
        const restes = await natifs();
        check(restes.length === 0,
            `aucune boîte native du navigateur n'a été ouverte de tout ce banc${restes.length ? ' — appelées : ' + restes.join(' | ') : ''}`);

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
