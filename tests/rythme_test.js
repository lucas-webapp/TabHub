// Banc de L'AIDE RYTHMIQUE — la fenêtre (voir ui/rythme.js, main.js#ouvrirAideRythme).
//
// CE QU'ELLE EST. Retour utilisateur : « insérer un séquenceur qui est juste une aide rythmique : une
// fenêtre s'ouvre, je place des barres [...] et tu me proposes l'écriture "vraie" sur une portée
// fictive ». Un ORACLE, donc : elle ne connaît ni hauteurs, ni effets, ni voix — elle produit des
// DURÉES, et « Insérer » les pose dans la partition en cases à remplir.
//
// CE QUE CE BANC PROTÈGE, par ordre d'importance :
//   1. LA GRILLE TELLE QU'ELLE A ÉTÉ REFAITE, point par point d'après les reproches de
//      l'utilisateur : une grille CONTINUE (plus de boîte par temps), une note tenue en UNE PILULE
//      arrondie (plus une file de carrés — « l'étirement des notes fait une forme bizarre »), les
//      NUMÉROS DE TEMPS sous les cases, DEUX MESURES par rangée, aucun texte d'explication au-dessus,
//      et la subdivision en un réglage GLOBAL binaire/ternaire au lieu d'un « 4 » par temps.
//   2. LES GESTES : poser, enlever, étirer par un bord, déplacer par le corps. C'est la demande
//      « me permettre d'étirer les notes, de les supprimer plus facilement ».
//   3. LA BOUCLE QUI SUIT LES MODIFICATIONS EN DIRECT, et sa tête de lecture qui AVANCE — le seul
//      contrôle qui distingue un transport qui tourne d'une fenêtre parfaitement crédible et muette.
//   4. LA PORTÉE SEULE de l'aperçu (`avecTab: false`) : une tablature n'aurait rien à dire ici,
//      toutes ses notes étant à la même hauteur (elle afficherait « 0 — 0 — 0 », du bruit). C'est ICI
//      que cette option du moteur se vérifie, par le SVG réellement rendu.
//   5. L'ENDROIT D'INSERTION, désormais CHOISI DANS LA FENÊTRE (« je dois pouvoir choisir la ou les
//      mesures dans lesquelles ces rythmes interviennent, avant de placer les notes dedans »).
//
// LA CONVERSION EN FIGURES a son propre banc, sans navigateur : tests/conversion_rythme_test.js.
// Elle n'est touchée ici que par la porte de l'interface, sur le cas que la fenêtre doit montrer
// juste — la note qui enjambe un temps ternaire vers le temps suivant.
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('aide rythmique');

(async () => {
    plan(47);
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 1320, height: 950 } });
    try {
        /** L'écriture proposée, lue dans le MODÈLE de la partition d'aperçu — la même que celle qui
         *  sera gravée, puisque c'est elle qu'on donne au moteur. */
        const ecriture = () => page.evaluate(() => {
            const parMesure = window.__rythme.evenementsParMesure(window.app._rythme.etat, { avecNotes: true });
            const NOM = { 1: 'ronde', 2: 'blanche', 4: 'noire', 8: 'croche', 16: 'double', 32: 'triple' };
            return parMesure.map(evs => evs.map(e =>
                (e.silence ? 'Ø' : (e.notes[0]?.lien === 'tie' ? 'x⌒' : 'x'))
                + ':' + (NOM[e.duree.valeur] || e.duree.valeur)
                + (e.duree.points ? '.' : '') + (e.duree.nolet ? '~3' : '')).join(' '));
        });
        const justes = () => page.evaluate(() => window.__rythme.mesuresJustes(window.app._rythme.etat));
        /** Pose une course directement dans le modèle — pour éprouver la CONVERSION sans dépendre
         *  d'un geste de souris, lequel est éprouvé à part plus bas. */
        const poserCourse = (m, a, b) => page.evaluate(([m, a, b]) => {
            window.__rythme.poserCourse(window.app._rythme.etat, m, a, b);
            window.app._rythme.grille.rafraichir();
            window.app.rafraichirApercuRythme();
        }, [m, a, b]);
        const viderGrille = () => page.evaluate(() => {
            window.app._rythme.etat.temps.forEach(t => t.cellules.fill('vide'));
            window.app._rythme.grille.rafraichir();
            window.app.rafraichirApercuRythme();
        });
        /** Le centre d'une case, en coordonnées de page. */
        const centre = async (sel) => {
            const b = await (await page.$(sel)).boundingBox();
            return [b.x + b.width / 2, b.y + b.height / 2];
        };
        const laCase = (m, i) => `.mesure-seq[data-mesure="${m}"] .case-seq[data-colonne="${i}"]`;
        /** Les pilules d'une mesure, en « départ+longueur » — la forme que l'œil voit. */
        const pilules = (m) => page.evaluate((m) => [...document.querySelectorAll(
            `.mesure-seq[data-mesure="${m}"] .note-seq`)].map(n => `${n.dataset.debut}+${
            Number(n.dataset.fin) - Number(n.dataset.debut) + 1}`), m);
        const glisser = async (de, vers) => {
            const [x1, y1] = await centre(de);
            const [x2] = await centre(vers);
            await page.mouse.move(x1, y1);
            await page.mouse.down();
            await page.mouse.move(x2, y1, { steps: 8 });
            await page.mouse.up();
            await page.waitForTimeout(160);
        };

        // Le module est chargé par la page ; on s'en donne une poignée pour lire la conversion
        // directement, plutôt que de la deviner depuis le SVG.
        await page.evaluate(() => import('./src/ui/rythme.js').then(m => { window.__rythme = m; }));
        await page.waitForTimeout(300);

        // =====================================================================================
        // 1. L'OUVERTURE — et tout ce qui a DISPARU de la fenêtre
        // =====================================================================================
        await page.evaluate(() => window.app.ouvrirAideRythme(1));
        await page.waitForTimeout(600);
        const ouverture = await page.evaluate(() => ({
            ouverte: !document.getElementById('fenetre-rythme').hidden,
            cible: document.getElementById('rythme-cible').textContent,
            depart: document.querySelector('#rythme-depart .valeur-pas')?.textContent,
            mesures: document.querySelectorAll('#grille-rythme .mesure-seq').length,
            cases: document.querySelectorAll('#grille-rythme .case-seq').length,
            numsTemps: [...document.querySelectorAll('#grille-rythme .num-temps')].map(n => n.textContent),
            apercu: !!document.querySelector('#apercu-rythme svg'),
            insererInactif: document.getElementById('btn-rythme-inserer').disabled,
            // CE QUI NE DOIT PLUS Y ÊTRE :
            texteAuDessus: !!document.querySelector('#fenetre-rythme .note-fenetre'),
            enteteDeTemps: document.querySelectorAll('#grille-rythme .entete-temps').length,
            boitesDeTemps: document.querySelectorAll('#grille-rythme .temps-rythme').length,
            subdivision: [...document.querySelectorAll('#rythme-subdivision button')]
                .map(b => b.textContent + (b.classList.contains('actif') ? '*' : '')),
        }));
        exiger(ouverture.ouverte, 'la fenêtre s\'ouvre');
        check(ouverture.mesures === 1 && ouverture.cases === 16,
            `la grille suit la signature du morceau : 1 mesure, 16 cases (${ouverture.cases})`);
        check(ouverture.numsTemps.join('') === '1234',
            `les NUMÉROS DE TEMPS sont écrits sous les cases (${ouverture.numsTemps.join(' ')}) — `
            + 'demande explicite, et ils remplacent l\'en-tête cliquable qui compartimentait la grille');
        check(ouverture.texteAuDessus === false,
            'plus aucun paragraphe d\'explication au-dessus de la grille (« je n\'ai pas besoin '
            + 'd\'avoir les indications texte au-dessus du séquenceur »)');
        check(ouverture.enteteDeTemps === 0 && ouverture.boitesDeTemps === 0,
            `plus de « 4 » au-dessus des barres, ni de boîte par temps (${ouverture.enteteDeTemps} en-têtes, `
            + `${ouverture.boitesDeTemps} boîtes) : la grille est CONTINUE`);
        check(ouverture.subdivision.join(' ') === 'Binaire* Ternaire',
            `la subdivision est un réglage GLOBAL à DEUX états (${ouverture.subdivision.join(' ')}) — `
            + 'le « 2 » a disparu parce qu\'il produisait une écriture identique au « 4 »');
        check(ouverture.depart === '2' && /mesure 2/.test(ouverture.cible),
            `le départ est pré-rempli par le geste qui a ouvert la fenêtre (mesure ${ouverture.depart}) `
            + `et la cible le rappelle (« ${ouverture.cible} »)`);
        check(ouverture.apercu, 'et l\'aperçu est déjà rendu, avant qu\'on ait posé quoi que ce soit');
        check(ouverture.insererInactif === true,
            'un rythme vide n\'a rien à insérer : le bouton le dit AVANT d\'être cliqué, plutôt que de poser des mesures de silence');

        // =====================================================================================
        // 2. LA PORTÉE SEULE — `avecTab: false`, vérifié sur le SVG rendu
        // =====================================================================================
        const apercu = await page.evaluate(() => {
            const svg = document.querySelector('#apercu-rythme svg');
            return { tab: /<text[^>]*>T<\/text>|TAB/.test(svg.outerHTML),
                     chiffres: [...svg.querySelectorAll('text')].map(t => t.textContent) };
        });
        check(apercu.tab === false,
            'l\'aperçu ne porte AUCUNE tablature : toutes ses notes étant à la même hauteur, elle n\'afficherait qu\'une colonne de zéros');
        check(!apercu.chiffres.includes('0'),
            `et aucun chiffre de case n'y est gravé (${apercu.chiffres.join(', ') || 'aucun texte'})`);

        // =====================================================================================
        // 3. UNE NOTE TENUE EST UNE PILULE — le reproche « forme bizarre »
        // =====================================================================================
        await poserCourse(0, 4, 7);
        await page.waitForTimeout(250);
        const pilule = await page.evaluate(() => {
            const n = document.querySelector('.mesure-seq[data-mesure="0"] .note-seq');
            // AUCUNE PILULE DU TOUT est un résultat à RAPPORTER, pas une exception à propager : sans
            // ce garde-fou, neutraliser le dessin des pilules faisait planter le banc sur un
            // `getBoundingClientRect` de `null`, et l'échec ne nommait plus le défaut.
            if (!n) return { nb: 0, colonnes: '(aucune pilule)', attaque: false, couvre: false,
                             rayon: '0px', pointeurs: '(aucune pilule)' };
            const cases = [...document.querySelectorAll('.mesure-seq[data-mesure="0"] .case-seq')];
            const r = n.getBoundingClientRect();
            const c4 = cases[4].getBoundingClientRect(), c7 = cases[7].getBoundingClientRect();
            return {
                nb: document.querySelectorAll('.mesure-seq[data-mesure="0"] .note-seq').length,
                colonnes: n.style.gridColumn,
                attaque: !!n.querySelector('.attaque-seq'),
                // La pilule couvre bien les quatre cases, d'un seul tenant (tolérance : ses 1px de
                // marge latérale, qui l'empêchent de toucher la case voisine).
                couvre: Math.abs(r.left - c4.left) <= 3 && Math.abs(r.right - c7.right) <= 3,
                rayon: getComputedStyle(n).borderRadius,
                // Les clics DOIVENT traverser la pilule jusqu'aux cases, qui portent la logique.
                pointeurs: getComputedStyle(n).pointerEvents,
            };
        });
        check(pilule.nb === 1 && pilule.colonnes === '5 / span 4',
            `quatre cases tenues font UNE seule pilule de quatre colonnes (${pilule.nb} forme(s), « ${pilule.colonnes} ») — `
            + 'et non quatre carrés accolés avec leurs coins, la « forme bizarre » d\'avant');
        check(pilule.couvre, 'elle couvre exactement les cases 4 à 7, sans décalage (mesuré au pixel)');
        check(pilule.attaque, 'et porte son repère d\'ATTAQUE, qui dit où la note est pincée plutôt que tenue');
        check(parseFloat(pilule.rayon) > 0, `elle est arrondie (${pilule.rayon}), comme une barre et non comme une case`);
        check(pilule.pointeurs === 'none',
            'elle est transparente aux pointeurs : ce sont les CASES en dessous qui portent les gestes — '
            + 'sans quoi cliquer une note ne toucherait aucune case');

        // Une note d'UNE case n'a pas de repère d'attaque : il n'y aurait rien à y distinguer.
        await viderGrille();
        await poserCourse(0, 2, 2);
        await page.waitForTimeout(200);
        check((await page.evaluate(() => {
            const n = document.querySelector('.mesure-seq[data-mesure="0"] .note-seq');
            return !!n && !n.querySelector('.attaque-seq') && !n.classList.contains('tenue');
        })) === true, 'une note d\'une seule case n\'affiche pas de repère d\'attaque — rien à y distinguer');

        // =====================================================================================
        // 4. LES GESTES — poser, étirer par un bord, déplacer par le corps, enlever
        // =====================================================================================
        await viderGrille();
        await page.waitForTimeout(150);

        let [x, y] = await centre(laCase(0, 2));
        await page.mouse.click(x, y);
        await page.waitForTimeout(220);
        check((await pilules(0)).join(' ') === '2+1',
            `un CLIC sur une case vide pose une note d'une case (${(await pilules(0)).join(' ')})`);

        await glisser(laCase(0, 2), laCase(0, 6));
        check((await pilules(0)).join(' ') === '2+5',
            `un GLISSER depuis son bord droit l'allonge jusqu'à la case traversée (${(await pilules(0)).join(' ')})`);

        await glisser(laCase(0, 6), laCase(0, 4));
        check((await pilules(0)).join(' ') === '2+3',
            `et le même geste vers l'arrière la RACCOURCIT (${(await pilules(0)).join(' ')}) — un étirement se reprend`);

        await glisser(laCase(0, 3), laCase(0, 8));
        check((await pilules(0)).join(' ') === '7+3',
            `un glisser depuis son CORPS la DÉPLACE dans le temps, sans la déformer (${(await pilules(0)).join(' ')})`);

        // Le déplacement est BORNÉ par la mesure, pas refusé : la note se colle au bord et y reste.
        await glisser(laCase(0, 8), laCase(0, 15));
        check((await pilules(0)).join(' ') === '13+3',
            `poussée au-delà du dernier temps, elle se colle au bord de sa mesure (${(await pilules(0)).join(' ')}) — `
            + 'bornée plutôt que refusée, on peut viser le dernier temps sans précision');

        [x, y] = await centre(laCase(0, 14));
        await page.mouse.click(x, y);
        await page.waitForTimeout(220);
        check((await pilules(0)).length === 0, 'un CLIC sur une note l\'enlève — la suppression est à un clic, comme la pose');

        // Le clic droit efface aussi : le geste qu'on essaie spontanément.
        await poserCourse(0, 1, 3);
        await page.waitForTimeout(150);
        [x, y] = await centre(laCase(0, 2));
        await page.mouse.click(x, y, { button: 'right' });
        await page.waitForTimeout(250);
        check((await pilules(0)).length === 0, 'et le clic DROIT l\'efface également, sans ouvrir le menu du navigateur');

        // =====================================================================================
        // 5. DEUX MESURES PAR RANGÉE, les suivantes en dessous
        // =====================================================================================
        await page.click('#rythme-nb-mesures button:nth-child(4)');
        await page.waitForTimeout(500);
        const quatre = await page.evaluate(() => ({
            rangees: document.querySelectorAll('.rangee-rythme').length,
            parRangee: [...document.querySelectorAll('.rangee-rythme')].map(r => r.querySelectorAll('.mesure-seq').length),
            cases: document.querySelectorAll('#grille-rythme .case-seq').length,
            boutons: document.querySelectorAll('#rythme-nb-mesures button').length,
            cible: document.getElementById('rythme-cible').textContent,
            // Les deux mesures d'une rangée font la MÊME largeur : sans quoi une case de la mesure 1
            // et son homologue de la mesure 2 ne représenteraient pas la même durée à l'œil.
            largeurs: [...document.querySelectorAll('.rangee-rythme:first-child .mesure-seq')]
                .map(m => Math.round(m.getBoundingClientRect().width)),
        }));
        check(quatre.rangees === 2 && quatre.parRangee.join(',') === '2,2',
            `quatre mesures font DEUX rangées de deux (${quatre.rangees} rangées : ${quatre.parRangee.join(', ')}) — `
            + '« 2 mesures doivent s\'enchainer horizontalement. Si j\'en ai plus, les mettre en-dessous »');
        check(quatre.cases === 64, `soixante-quatre cases en tout (${quatre.cases})`);
        check(new Set(quatre.largeurs).size === 1,
            `et les deux mesures d'une rangée font la même largeur (${quatre.largeurs.join(' / ')}px)`);
        check(quatre.boutons === 4, 'quatre mesures au plus : au-delà, la grille ne tient plus à l\'écran et l\'aide cesse d\'aider');
        // LE DÉPART EST BORNÉ PAR LA LONGUEUR, et c'est ce que montre cette mesure-ci : la fenêtre
        // avait été ouverte sur la mesure 2 d'un morceau de QUATRE mesures ; un rythme de quatre
        // mesures ne peut donc pas commencer là — il n'y aurait pas de place pour l'accueillir. Le
        // départ recule tout seul jusqu'à la seule valeur possible plutôt que d'annoncer une étendue
        // qui sort du morceau.
        check(/mesures 1 à 4/.test(quatre.cible),
            `et l'étendue annoncée suit, ramenée dans le morceau (« ${quatre.cible} »)`);
        check((await page.textContent('#rythme-depart .valeur-pas')) === '1',
            'le départ a reculé de lui-même à la mesure 1 : quatre mesures de rythme ne tiennent pas '
            + 'à partir de la mesure 2 d\'un morceau qui n\'en a que quatre');
        check((await page.evaluate(() =>
            document.querySelector('#rythme-depart button:nth-child(3)').disabled)) === true,
            'et la flèche « suivante » est ÉTEINTE, plutôt que vive et sans effet');

        // =====================================================================================
        // 6. LE DÉPART SE CHOISIT DANS LA FENÊTRE
        // =====================================================================================
        await page.click('#rythme-nb-mesures button:nth-child(1)');
        await page.waitForTimeout(300);
        const avantDepart = await page.textContent('#rythme-cible');
        await page.click('#rythme-depart button:nth-child(3)');   // la flèche « suivante »
        await page.waitForTimeout(300);
        const apresDepart = await page.evaluate(() => ({
            valeur: document.querySelector('#rythme-depart .valeur-pas').textContent,
            cible: document.getElementById('rythme-cible').textContent,
        }));
        check(apresDepart.valeur === '2' && /mesure 2/.test(apresDepart.cible),
            `la flèche avance la mesure visée (« ${avantDepart} » → « ${apresDepart.cible} ») : `
            + 'l\'endroit se corrige dans la fenêtre, il n\'est plus figé par le clic qui l\'a ouverte');
        await page.click('#rythme-depart button:nth-child(1)');
        await page.waitForTimeout(250);
        check((await page.textContent('#rythme-depart .valeur-pas')) === '1', 'et l\'autre flèche revient en arrière');

        // =====================================================================================
        // 7. BINAIRE / TERNAIRE — un réglage global, et la grille se resserre
        // =====================================================================================
        await page.click('#rythme-subdivision button[data-sub="3"]');
        await page.waitForTimeout(400);
        const ternaire = await page.evaluate(() => ({
            cases: document.querySelectorAll('.mesure-seq[data-mesure="0"] .case-seq').length,
            nums: [...document.querySelectorAll('.mesure-seq[data-mesure="0"] .num-temps')].map(n => n.textContent),
            actif: [...document.querySelectorAll('#rythme-subdivision button')]
                .filter(b => b.classList.contains('actif')).map(b => b.textContent),
            subs: window.app._rythme.etat.temps.map(t => t.sub),
        }));
        check(ternaire.cases === 12 && ternaire.subs.join('') === '3333',
            `en ternaire, chaque temps passe à TROIS cases — douze pour la mesure (${ternaire.cases}), `
            + 'et le réglage vaut pour TOUS les temps à la fois');
        check(ternaire.nums.join('') === '1234',
            `les quatre temps restent numérotés 1 à 4 (${ternaire.nums.join(' ')}) : la mesure n'a pas changé, `
            + 'seule sa division interne');
        check(ternaire.actif.join('') === 'Ternaire', 'et le bouton actif est bien « Ternaire »');

        // LA CONVERSION VUE PAR LA FENÊTRE — le cas qui enjambe. Une note du dernier tiers d'un temps
        // ternaire, tenue dans le temps suivant : sa durée n'est exprimable par aucune figure unique,
        // il faut COUPER au temps et LIER.
        await poserCourse(0, 2, 3);
        await page.waitForTimeout(300);
        const enjambe = (await ecriture())[0];
        check(/x⌒:croche~3 x:/.test(enjambe),
            `une note du 3e tiers du temps 1 tenue dans le temps 2 est COUPÉE au temps et LIÉE (${enjambe})`);
        check((await justes())[0] === true,
            'et la mesure somme toujours exactement sa capacité — c\'est l\'invariant que l\'aide ne doit jamais casser');
        await page.click('#rythme-subdivision button[data-sub="4"]');
        await page.waitForTimeout(350);

        // =====================================================================================
        // 8. LA BOUCLE QUI SUIT LES MODIFICATIONS EN DIRECT, et sa tête de lecture
        // =====================================================================================
        await poserCourse(0, 0, 1);
        await poserCourse(0, 8, 9);
        await page.waitForTimeout(200);
        await page.click('#btn-rythme-boucle');
        await page.waitForTimeout(1400);
        const enBoucle = await page.evaluate(() => ({
            bouton: document.getElementById('btn-rythme-boucle').textContent,
            presse: document.getElementById('btn-rythme-boucle').getAttribute('aria-pressed'),
            etat: window.app.lecteur.etat,
            // La boucle borne TOUTE la grille, pas une plage du morceau.
            bornes: JSON.stringify(window.app.lecteur.boucleLecture),
            tete: [...document.querySelectorAll('.tete-seq')].filter(t => !t.hidden).length,
        }));
        check(enBoucle.etat === 'lecture' && enBoucle.bouton === 'Arrêter' && enBoucle.presse === 'true',
            `« Boucler » démarre vraiment la lecture et devient « ${enBoucle.bouton} » (état : ${enBoucle.etat})`);
        check(/"debut":0/.test(enBoucle.bornes),
            `la boucle borne la grille entière (${enBoucle.bornes}), pas une plage du morceau`);
        check(enBoucle.tete === 1, 'et UNE tête de lecture est allumée, sur la mesure en cours');

        // LA TÊTE AVANCE — le seul contrôle qui distingue un transport qui tourne d'une fenêtre
        // parfaitement crédible et muette. C'est exactement le défaut qui rendait l'ancien bouton
        // « Écouter » silencieux au premier clic de la session : `arreter()` suivi de `jouer()`
        // laissait les tics à zéro, parce que la mise en place audio se faisait APRÈS l'arrêt du
        // transport (voir main.js#basculerBoucleRythme, qui prépare l'audio d'abord).
        const t1 = await page.evaluate(() => [...document.querySelectorAll('.tete-seq')]
            .filter(t => !t.hidden).map(t => t.style.gridColumn)[0]);
        await page.waitForTimeout(700);
        const t2 = await page.evaluate(() => [...document.querySelectorAll('.tete-seq')]
            .filter(t => !t.hidden).map(t => t.style.gridColumn)[0]);
        check(t1 !== t2,
            `la tête de lecture AVANCE (colonne ${t1} → ${t2}) : sans ce contrôle, un transport qui ne `
            + 'démarre pas laisserait la fenêtre parfaitement crédible');

        // MODIFIER PENDANT QUE ÇA TOURNE ne coupe pas le son : le transport est REPROGRAMMÉ.
        [x, y] = await centre(laCase(0, 12));
        await page.mouse.click(x, y);
        await page.waitForTimeout(500);
        const apresModif = await page.evaluate(() => ({
            etat: window.app.lecteur.etat,
            notes: document.querySelectorAll('.mesure-seq[data-mesure="0"] .note-seq').length,
        }));
        check(apresModif.etat === 'lecture' && apresModif.notes === 3,
            `poser une note PENDANT la boucle ne l'interrompt pas (état : ${apresModif.etat}, `
            + `${apresModif.notes} notes) — « une lecture en boucle qui suit exactement les modifications en direct »`);

        // =====================================================================================
        // 9. LA NOTE JOUÉE EST LA TONIQUE DU MORCEAU
        // =====================================================================================
        const tonique = await page.evaluate(() => {
            const P = window.app.editeur.partition;
            const cas = window.__rythme.caseDeLaTonique(P);
            const acc = P.piste.accordage;
            const midi = acc.cordes[cas.corde] + cas.frette + (P.piste.capo || 0);
            // La partition d'aperçu doit vraiment poser SES notes sur cette case.
            const p = window.app.partitionRythme();
            const notes = p.mesures[0].voix[0].evenements.filter(e => !e.silence).map(e => e.notes[0]);
            return { cas, pc: ((midi % 12) + 12) % 12,
                     posees: notes.length > 0 && notes.every(n => n.corde === cas.corde && n.frette === cas.frette),
                     accordageRepris: JSON.stringify(p.piste.accordage) === JSON.stringify(acc) };
        });
        // Le morceau de départ est en do majeur : la tonique est un do, classe de hauteur 0.
        check(tonique.pc === 0,
            `la case retenue sonne bien la TONIQUE du morceau (classe de hauteur ${tonique.pc} pour do majeur, `
            + `corde ${tonique.cas.corde} case ${tonique.cas.frette}) — et non une hauteur arbitraire`);
        check(tonique.cas.frette <= 4,
            `elle est prise en position ouverte (case ${tonique.cas.frette} ≤ 4) : une pédale se joue en bas du manche`);
        check(tonique.posees, 'et TOUTES les notes de l\'aperçu sont posées dessus');
        check(tonique.accordageRepris,
            'la partition jetable reprend l\'ACCORDAGE du morceau : sans lui, la case choisie sonnerait '
            + 'la hauteur qu\'elle aurait en accordage standard');

        // Arrêter la boucle la retire aussi du lecteur.
        await page.click('#btn-rythme-boucle');
        await page.waitForTimeout(400);
        check((await page.evaluate(() => window.app.lecteur.etat === 'arret'
            && window.app.lecteur.boucleLecture.debut === null)) === true,
            'arrêter la boucle la RETIRE du lecteur : sans ça, la prochaine lecture du morceau tournerait '
            + 'en rond sur ses premières mesures');

        // =====================================================================================
        // 10. L'INSERTION : des cases à remplir, la tablature VIDE
        // =====================================================================================
        await page.evaluate(() => { window.app.fermerFenetres(); });
        await page.waitForTimeout(250);
        await page.evaluate(() => window.app.ouvrirAideRythme(1));
        await page.waitForTimeout(400);
        await page.click('#rythme-subdivision button[data-sub="3"]');
        await page.waitForTimeout(400);
        for (const i of [0, 1, 2]) await poserCourse(0, i, i);
        await page.waitForTimeout(300);
        check((await page.evaluate(() => document.getElementById('btn-rythme-inserer').disabled)) === false,
            'dès qu\'il y a un rythme, « Insérer » devient disponible');
        await page.click('#btn-rythme-inserer');
        await page.waitForTimeout(800);
        const apresInsertion = await page.evaluate(() => ({
            fermee: document.getElementById('fenetre-rythme').hidden,
            mesure: window.app.editeur.partition.mesures[1].voix[0].evenements.map(e =>
                (e.silence ? 'Ø' : 'x') + ':' + e.duree.valeur + (e.duree.nolet ? '~3' : '') + (e.aRemplir ? '*' : '')),
            bandes: window.app.marquesARemplir().length,
            curseur: window.app.editeur.curseur.mesure,
            mesureIntacte: window.app.editeur.partition.mesures[0].voix[0].evenements.length,
        }));
        check(apresInsertion.fermee, 'la fenêtre se referme : le rythme est posé, il n\'y a plus rien à y faire');
        check(apresInsertion.mesure.slice(0, 3).join(' ') === 'Ø:8~3* Ø:8~3* Ø:8~3*',
            `le rythme est arrivé en CASES À REMPLIR, tablature vide (${apresInsertion.mesure.join(' ')})`);
        check(apresInsertion.bandes === 3, 'trois bandes de surbrillance : ce qui reste à choisir');
        check(apresInsertion.curseur === 1, 'et le curseur attend sur la première mesure insérée');
        check(apresInsertion.mesureIntacte > 0,
            'la mesure 1, hors de l\'étendue visée, n\'a pas été touchée — on remplace ce qu\'on désigne, rien d\'autre');

        // =====================================================================================
        // 11. LA TABULATION parcourt les cases à remplir
        // =====================================================================================
        await page.evaluate(() => { window.app.editeur.placerCurseur(1, 0, 2, 0); document.getElementById('zone-partition').focus(); });
        await page.waitForTimeout(200);
        await page.keyboard.press('Tab');
        await page.waitForTimeout(250);
        check((await page.evaluate(() => window.app.editeur.curseur.evenement)) === 1,
            'Tabulation saute à la case à remplir SUIVANTE — sans elle, remplir quatre mesures voudrait dire viser chaque case à la souris');

        // =====================================================================================
        // 12. LE BOUTON DE LA BARRE D'OUTILS
        // Retour utilisateur : « je ne vois pas le bouton de séquenceur pour indiquer le rythme,
        // peux-tu me dire où il est ? » — il n'existait QUE dans le menu contextuel du clic droit,
        // donc nulle part sur téléphone. Il vit désormais dans le cadre « Durée ».
        // =====================================================================================
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        const bouton = await page.evaluate(() => {
            const b = document.querySelector('[data-action="aideRythme"]');
            if (!b) return null;
            return {
                cadre: b.closest('.groupe-outils')?.dataset.groupe,
                visible: b.getBoundingClientRect().width > 0,
                mot: b.querySelector('.apercu-mot')?.textContent,
                icone: !!b.querySelector('svg'),
                avant: b.nextElementSibling?.className.includes('btn-effets-bascule'),
            };
        });
        exiger(!!bouton, 'un bouton d\'aide rythmique existe dans la barre d\'outils');
        check(bouton.cadre === 'duree' && bouton.visible,
            `il est dans le cadre « Durée », visible sans rien déplier (reçu « ${bouton.cadre} »)`);
        check(bouton.mot === 'Rythme' && bouton.icone,
            `et il porte un MOT autant qu'un dessin : « ${bouton.mot} » — un pictogramme seul serait à apprendre`);
        check(bouton.avant, 'posé juste avant « Effets » : le dernier recours des figures, avant les nuances de jeu');

        await page.evaluate(() => { window.app.editeur.placerCurseur(2, 0, 0, 0); });
        await page.waitForTimeout(150);
        await page.click('[data-action="aideRythme"]');
        await page.waitForTimeout(400);
        check(await page.locator('#fenetre-rythme').isVisible(),
            'un clic dessus ouvre la fenêtre — plus besoin de connaître le clic droit');
        check(/mesure 3/i.test(await page.textContent('#rythme-cible') || ''),
            'et elle vise la mesure du CURSEUR, celle qu\'on regarde en cliquant');

        // =====================================================================================
        // 13. LA GRILLE NE DÉBORDE PLUS — les cases s'étirent au lieu de défiler
        // L'ancienne grille gardait des cases de 26px et DÉFILAIT horizontalement, avec deux flèches,
        // parce que `touch-action: none` empêchait le doigt de la faire glisser. Les cases sont
        // maintenant des fractions de la largeur disponible : il n'y a plus rien à faire défiler,
        // donc plus de flèches à montrer.
        // =====================================================================================
        const largeur = await page.evaluate(() => {
            const g = document.getElementById('grille-rythme');
            return { deborde: g.scrollWidth - g.clientWidth,
                     fleches: g.querySelectorAll('.fleche-outils').length,
                     toucheEnDur: getComputedStyle(document.querySelector('.piste-seq')).touchAction };
        });
        check(largeur.deborde <= 1,
            `la grille ne déborde plus de son cadre (${largeur.deborde}px) : ses cases sont des fractions de la largeur`);
        check(largeur.fleches === 0, 'et elle n\'a donc plus besoin de flèches de défilement');
        check(largeur.toucheEnDur === 'none',
            'la piste garde `touch-action: none` — le GLISSER est son geste principal, sans quoi le '
            + 'navigateur le prendrait pour un défilement et la note ne s\'allongerait jamais');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
