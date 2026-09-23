// Banc du BLOC DE MESURES — copier plusieurs mesures d'un coup, et les coller PAR-DESSUS.
//
// LE DÉFAUT QU'IL FIGE, dans les mots de l'utilisateur : « à partir d'une partition existante, je
// veux pouvoir la recopier sans me poser de questions ou sans avoir besoin de recommencer des
// mesures entières. »
//
// MESURÉ AVANT CORRECTIF. Le presse-papier ne tenait QU'UNE mesure. Répéter un riff de quatre
// mesures — le geste le plus banal d'une recopie — demandait donc de RE-COPIER la source à chaque
// fois : copier la 1, coller, copier la 2, coller, copier la 3, coller, copier la 4, coller. Soit
// SEIZE interactions de menu (un clic droit + une entrée de menu par geste), sans aucun raccourci
// clavier : copier/coller n'existait qu'au clic droit. Et comme le collage INSÉRAIT, si les mesures
// cibles existaient déjà — vides, en attente, ce qui est le cas normal en recopie — il fallait
// ensuite aller supprimer les vides une à une.
//
// LES DEUX CHANGEMENTS.
//   1. LE PRESSE-PAPIER TIENT UN BLOC. Une plage se choisit au Maj+clic, comme dans toutes les
//      listes du monde ; Ctrl+C la copie, Ctrl+V la repose.
//   2. LE COLLAGE REMPLACE PAR DÉFAUT. « Insérer là où je le souhaite veut dire ajouter, pas écraser »
//      reste vrai pour une mesure qu'on glisse quelque part — les deux insertions restent au menu.
//      Mais recopier, c'est poser sur des mesures qui attendent, et insérer y laisse un doublon de
//      vides derrière.
//
// ET CE QUI EST ÉCRASÉ SE DIT. Remplacer détruit ; la règle de la maison est qu'aucune note ne
// disparaît sans un mot (voir perte_silencieuse_test.js). Le bilan le compte, comme il comptait déjà
// les notes qu'aucune corde ne pouvait recevoir.
//
// Émulation CLAVIER et SOURIS : la plage se choisit au Maj+clic, le geste passe par Ctrl+C/Ctrl+V.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('bloc de mesures');

(async () => {
    plan(24);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // ── Partie MODÈLE ───────────────────────────────────────────────────────────────────────
        const modele = await page.evaluate(async () => {
            const { Editeur } = await import('/src/edit/commands.js');
            const out = {};
            /** Un riff de `n` mesures, une note différente par temps, pour les reconnaître ensuite. */
            const riff = (n = 4) => {
                const ed = new Editeur(); ed.nouveau('guitare');
                ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
                for (let m = 0; m < n; m++) {
                    ed.placerCurseur(m, 0, 0, 0);
                    for (let i = 0; i < 4; i++) ed.saisirChiffre((m * 4 + i) % 10);
                }
                return ed;
            };
            const frettes = ed => ed.partition.mesures.map(m => m.voix[0].evenements
                .map(e => (e.silence || !e.notes.length) ? '_' : String(e.notes[0].frette)).join(''));

            const ed = riff(4);
            out.depart = frettes(ed);
            out.copie = ed.copierMesures(0, 3);
            out.nCopiees = ed.nbMesuresCopiees();
            // LE GESTE : coller les quatre à partir de la mesure 5. Le morceau n'en a pas assez —
            // il doit s'allonger, pas refuser ni tronquer.
            out.colle = ed.collerMesures(4);
            out.apres = frettes(ed);

            // REMPLACER ÉCRASE, ET LE DIT. On colle par-dessus des mesures qui portent des notes.
            const ed2 = riff(4);
            ed2.copierMesures(0, 1);                    // deux mesures : 0123 / 4567
            const r2 = ed2.collerMesures(2);            // par-dessus 8901 / 2345
            out.remplace = frettes(ed2);
            out.ecrasees = r2.ecrasees;
            out.bilanDit = ed2.dernierBilan;
            out.nMesuresApresRemplacement = ed2.partition.mesures.length;

            // INSÉRER NE DÉTRUIT RIEN, et reste disponible.
            const ed3 = riff(4);
            ed3.copierMesures(0, 1);
            const r3 = ed3.collerMesures(2, { inserer: true });
            out.insere = frettes(ed3);
            out.insereEcrase = r3.ecrasees;
            out.bilanInsertion = ed3.dernierBilan;

            // UN SEUL Ctrl+Z défait un collage de quatre mesures.
            const ed4 = riff(4);
            ed4.copierMesures(0, 3);
            ed4.collerMesures(4);
            const avantAnnulation = frettes(ed4);
            ed4.annuler();
            out.annuleDUnCoup = JSON.stringify(frettes(ed4)) === JSON.stringify(out.depart);
            out.avantAnnulation = avantAnnulation.length;

            // COPIER NE MODIFIE RIEN : pas de point d'annulation pour un geste qui ne touche à rien.
            const ed5 = riff(2);
            const etapesAvant = ed5.passe.length;
            ed5.copierMesures(0, 1);
            out.copieSansEtape = ed5.passe.length === etapesAvant;

            // LA SIGNATURE DU BLOC LE SUIT, et ne descend pas jusqu'à la fin du morceau.
            const ed6 = riff(4);
            ed6.copierMesures(0, 1);                    // deux mesures EN 4/4
            ed6.placerCurseur(2, 0, 0, 0);
            ed6.definirSignature(3, 4);                 // la suite passe en 3/4
            ed6.collerMesures(2);                       // on y colle le 4/4
            const sig = i => { const m = ed6.partition.mesures[i]; return m.signature ? `${m.signature.battements}/${m.signature.unite}` : '—'; };
            out.signatures = [0, 1, 2, 3, 4].map(sig);
            return out;
        });

        // La 5e mesure porte UN silence de mesure entière, d'où le simple « _ » : c'est la mesure
        // neuve que la saisie ouvre en arrivant au bout (voir _avancerApresSaisie).
        exiger(JSON.stringify(modele.depart.slice(0, 4)) === JSON.stringify(['0123', '4567', '8901', '2345']),
            `préalable : le riff est écrit (${JSON.stringify(modele.depart)})`);
        check(modele.copie === true && modele.nCopiees === 4,
            `le presse-papier tient QUATRE mesures d'un coup (${modele.nCopiees})`);
        check(modele.colle && modele.colle.colees === 4, `quatre mesures collées en UN geste (${JSON.stringify(modele.colle)})`);
        check(JSON.stringify(modele.apres.slice(4, 8)) === JSON.stringify(['0123', '4567', '8901', '2345']),
            `le riff est reposé à l'identique en 5-8 (${JSON.stringify(modele.apres)})`);
        check(JSON.stringify(modele.apres.slice(0, 4)) === JSON.stringify(modele.depart.slice(0, 4)),
            'et la source est intacte');
        check(modele.colle.ajoutees === 3,
            `le morceau s'est allongé de ce qu'il fallait (${modele.colle.ajoutees} mesures) plutôt que de refuser ou tronquer`);

        check(JSON.stringify(modele.remplace.slice(0, 4)) === JSON.stringify(['0123', '4567', '0123', '4567']),
            `remplacer écrit PAR-DESSUS, sans rien décaler (${JSON.stringify(modele.remplace)})`);
        check(modele.nMesuresApresRemplacement === 5,
            `et le morceau ne gagne aucune mesure (${modele.nMesuresApresRemplacement}) — c'est tout l'objet du remplacement`);
        check(modele.ecrasees === 8, `les notes écrasées sont comptées (${modele.ecrasees} — deux mesures de quatre)`);
        check(/8 notes écrasées/.test(modele.bilanDit || ''),
            `et DITES : « ${modele.bilanDit} »`);

        check(JSON.stringify(modele.insere.slice(0, 6)) === JSON.stringify(['0123', '4567', '0123', '4567', '8901', '2345']),
            `insérer reste possible et ne détruit rien (${JSON.stringify(modele.insere.slice(0, 6))})`);
        check(modele.insereEcrase === 0 && !modele.bilanInsertion,
            'une insertion n\'écrase rien, donc ne dit rien');

        check(modele.annuleDUnCoup,
            `un seul Ctrl+Z défait le collage des quatre mesures (le morceau était passé à ${modele.avantAnnulation} mesures)`);
        check(modele.copieSansEtape, 'copier ne pose AUCUN point d\'annulation — ce geste ne touche à rien');
        check(modele.signatures[2] === '4/4' && modele.signatures[4] === '3/4',
            `seule la 1re mesure du bloc déclare sa signature, et la suite retrouve la sienne (${modele.signatures.join(' ')})`);
        check(modele.signatures[3] === '—',
            'les mesures suivantes du bloc l\'héritent, au lieu de la regraver chacune');

        // ── Partie INTERFACE : Maj+clic, Ctrl+C, Ctrl+V ─────────────────────────────────────────
        const ecrire = () => page.evaluate(() => {
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            for (let m = 0; m < 4; m++) {
                ed.placerCurseur(m, 0, 0, 0);
                for (let i = 0; i < 4; i++) ed.saisirChiffre((m * 4 + i) % 10);
            }
            ed.placerCurseur(0, 0, 0, 0);
            window.app.dessiner();
        });
        /** Un point au milieu de la mesure `m`, sur la portée. */
        const pointMesure = (m) => page.evaluate((m) => {
            const a = window.app.page.ancrages.evenements.find(e => e.mesure === m && e.voix === 0);
            const b = document.querySelector('#feuille svg').getBoundingClientRect();
            return { x: b.left + a.x, y: b.top + a.yPortee + 6 };
        }, m);
        const rectsPlage = () => page.evaluate(() =>
            document.querySelectorAll('#feuille svg rect[fill="var(--mesures-choisies)"]').length);
        const frettesUi = () => page.evaluate(() => window.app.editeur.partition.mesures
            .map(m => m.voix[0].evenements.map(e => (e.silence || !e.notes.length) ? '_' : String(e.notes[0].frette)).join('')));

        await ecrire();
        await page.waitForTimeout(150);
        check((await rectsPlage()) === 0, 'au repos, aucune mesure n\'est teintée');

        const p0 = await pointMesure(0);
        await page.mouse.click(p0.x, p0.y);
        const p3 = await pointMesure(3);
        await page.keyboard.down('Shift');
        await page.mouse.click(p3.x, p3.y);
        await page.keyboard.up('Shift');
        await page.waitForTimeout(200);
        exiger((await rectsPlage()) === 4, `Maj+clic choisit les quatre mesures (${await rectsPlage()} teintées)`);

        await page.evaluate(() => window.app.el.zone.focus());
        await page.keyboard.press('Control+c');
        await page.waitForTimeout(150);
        check(await page.evaluate(() => window.app.editeur.nbMesuresCopiees()) === 4,
            'Ctrl+C copie les quatre — sans passer par le menu');

        // On va en mesure 5 (créée par le collage) : ici, on vise la dernière mesure vide.
        await page.evaluate(() => { window.app.editeur.placerCurseur(4, 0, 0, 0); });
        await page.keyboard.press('Control+v');
        await page.waitForTimeout(300);
        const apresUi = await frettesUi();
        check(JSON.stringify(apresUi.slice(4, 8)) === JSON.stringify(['0123', '4567', '8901', '2345']),
            `Ctrl+V repose le bloc entier (${JSON.stringify(apresUi)})`);
        check((await rectsPlage()) === 0,
            'et la plage s\'efface après le collage : elle désignait la source, elle ne désigne plus rien');

        // ÉCHAP ABANDONNE LA PLAGE avant d'arrêter la lecture.
        await page.mouse.click(p0.x, p0.y);
        await page.keyboard.down('Shift');
        await page.mouse.click(p3.x, p3.y);
        await page.keyboard.up('Shift');
        await page.waitForTimeout(150);
        exiger((await rectsPlage()) === 4, 'préalable : une plage est de nouveau choisie');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        check((await rectsPlage()) === 0, 'Échap abandonne la plage');

        // ── NEUTRALISATION ──────────────────────────────────────────────────────────────────────
        // (1) Le presse-papier redevient MONO-MESURE : c'est l'état d'avant, et il ramène les seize
        //     interactions. On le neutralise en tronquant le bloc copié à sa première mesure.
        const mono = await page.evaluate(async () => {
            const { Editeur } = await import('/src/edit/commands.js');
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            for (let m = 0; m < 4; m++) { ed.placerCurseur(m, 0, 0, 0); for (let i = 0; i < 4; i++) ed.saisirChiffre((m * 4 + i) % 10); }
            const vrai = ed.copierMesures.bind(ed);
            ed.copierMesures = function (a, b) { const r = vrai(a, b); this.presseMesures.mesures.length = 1; return r; };
            ed.copierMesures(0, 3);
            ed.collerMesures(4);
            return ed.partition.mesures.map(m => m.voix[0].evenements
                .map(e => (e.silence || !e.notes.length) ? '_' : String(e.notes[0].frette)).join(''));
        });
        check(mono[4] === '0123' && mono[5] !== '4567',
            `NEUTRALISÉ (presse-papier mono-mesure) : une seule mesure repose (${JSON.stringify(mono.slice(4, 7))}) — `
            + 'il faudrait re-copier la source trois fois de plus');

        // (2) Le collage REDEVIENT une insertion. Les mesures cibles existaient : elles restent
        //     derrière, vides, à supprimer une à une.
        const insereAuLieuDeRemplacer = await page.evaluate(async () => {
            const { Editeur } = await import('/src/edit/commands.js');
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            for (let m = 0; m < 2; m++) { ed.placerCurseur(m, 0, 0, 0); for (let i = 0; i < 4; i++) ed.saisirChiffre((m * 4 + i) % 10); }
            ed.copierMesures(0, 1);
            const avant = ed.partition.mesures.length;
            ed.collerMesures(2, { inserer: true });          // l'ancien comportement
            return { avant, apres: ed.partition.mesures.length,
                     vides: ed.partition.mesures.filter(m => m.voix[0].evenements.every(e => e.silence || !e.notes.length)).length };
        });
        check(insereAuLieuDeRemplacer.apres === insereAuLieuDeRemplacer.avant + 2
            && insereAuLieuDeRemplacer.vides >= 2,
            `NEUTRALISÉ (collage qui insère) : le morceau passe de ${insereAuLieuDeRemplacer.avant} à `
            + `${insereAuLieuDeRemplacer.apres} mesures et en laisse ${insereAuLieuDeRemplacer.vides} vides derrière, `
            + 'à supprimer une à une');

        check(erreurs.length === 0, 'aucune erreur de console ni exception (' + erreurs.join(' | ') + ')');
    } catch (e) {
        check(false, 'exception pendant le banc : ' + e.message + '\n' + e.stack);
    } finally {
        await fermer();
    }
    process.exit(bilan());
})();
