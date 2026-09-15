// Banc du DÉCOMPTE AVANT LECTURE — voir audio/player.js#_programmerDecompte.
//
// CE QU'IL PROTÈGE. Retour utilisateur : « ok pour un décompte d'une mesure. Mettre une option pour
// le prendre en compte ou non au moment de la lecture. » Deux exigences, donc, et la seconde est une
// exigence de PLACE : la bascule doit être sous la main au moment de jouer, pas dans les Réglages.
//
// LE CHOIX DE CONCEPTION QUE CE BANC GARDE. Le décompte est programmé sur l'HORLOGE AUDIO, et le
// transport est simplement démarré plus tard (`Transport.start(quand)`). L'autre voie — décaler d'une
// mesure tout ce qui est programmé sur le transport — aurait obligé à retrancher ce décalage partout
// où une position de transport se relit : tête de lecture, bornes de boucle, reprogrammation en
// direct. Une seule de ces lectures qui l'oublierait désynchroniserait l'image du son. Ce banc
// éprouve donc que la carte des tics reste INTOUCHÉE : pendant le décompte, le transport est encore
// à zéro, et la musique part exactement une mesure plus tard.
//
// ET TROIS PROPRIÉTÉS QU'ON PERD FACILEMENT EN REFACTORISANT :
//   1. le décompte SONNE — quatre clics, dont un accentué — MÊME métronome éteint (ce sont deux
//      choses distinctes : l'un met en place avant, l'autre tient la pulsation pendant) ;
//   2. il suit la SIGNATURE de la mesure de départ (3 clics en 3/4, pas 4) ;
//   3. il ne se rejoue PAS en reprenant une pause — on repartirait au milieu d'une phrase.
//
// LA LARGEUR DE LA BARRE DU BAS, enfin. Le décompte est la SIXIÈME commande de cette rangée, et
// chaque ajout l'a rapprochée du débordement (mesuré et corrigé trois fois). La mesure se prend
// FLÈCHES DÉDUITES : collantes mais dans le flux, elles pèsent 26px dans `scrollWidth` dès qu'elles
// s'allument — à l'ajout du décompte, un débordement réel de 40px à 320px s'annonçait comme 66 (voir
// ui/toolbar.js#ajusterFleches, où ce piège est décrit).
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('décompte avant lecture');

(async () => {
    plan(29);
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 1320, height: 900 } });
    try {
        // LE COMPTEUR DE CLICS. `_clicMetronome` est le SEUL point d'entrée du son du métronome (le
        // décompte et le métronome de lecture y passent tous les deux) : l'envelopper est la seule
        // façon de vérifier qu'un son a été demandé — un banc ne peut pas écouter.
        await page.evaluate(() => {
            const l = window.app.lecteur;
            window.__clics = [];
            const vrai = l._clicMetronome.bind(l);
            l._clicMetronome = (accent, temps, sub) => { window.__clics.push({ accent: !!accent, sub: !!sub }); return vrai(accent, temps, sub); };
        });
        const clics = () => page.evaluate(() => window.__clics.slice());
        const raz = () => page.evaluate(() => { window.__clics = []; });
        const secondes = () => page.evaluate(() => globalThis.Tone?.Transport ? +globalThis.Tone.Transport.seconds.toFixed(2) : null);
        const etat = () => page.evaluate(() => ({
            actif: window.app.lecteur.decompteActif,
            classe: document.getElementById('btn-decompte').classList.contains('actif'),
            presse: document.getElementById('btn-decompte').getAttribute('aria-pressed'),
            lecteur: window.app.lecteur.etat,
        }));

        // --- 1. LA BASCULE EST SOUS LA MAIN, avec les commandes de lecture -------------------------
        const place = await page.evaluate(() => {
            const b = document.getElementById('btn-decompte');
            const m = document.getElementById('btn-metronome');
            return {
                existe: !!b, visible: b && b.offsetParent !== null,
                dansBlocLecture: !!b?.closest('#bloc-lecture'),
                dansReglages: !!b?.closest('#fenetre-reglages'),
                voisinDuMetronome: !!m && b?.parentElement === m.parentElement,
                aUneInfobulle: (b?.title || '').length > 10,
            };
        });
        exiger(place.existe && place.visible, 'la bascule du décompte existe et se voit');
        check(place.dansBlocLecture && !place.dansReglages,
            'elle est DANS le bloc de lecture, pas dans les Réglages — « au moment de la lecture », c\'était la demande');
        check(place.voisinDuMetronome, 'voisine du métronome, dont elle partage le son');
        check(place.aUneInfobulle, `et elle dit ce qu'elle fait (« ${place.aUneInfobulle ? 'infobulle présente' : ''} »)`);
        const d0 = await etat();
        check(d0.actif === false && d0.classe === false && d0.presse === 'false',
            'éteinte par défaut : un décompte imposé à chaque essai se ferait détester');

        // --- 2. ÉTEINTE, la musique part TOUT DE SUITE --------------------------------------------
        await raz();
        await page.click('#btn-jouer');
        await page.waitForFunction(() => Tone.Transport.seconds > 0.02, null, { timeout: 8000 });
        const sansClics = await clics();
        check(sansClics.length === 0, `aucun clic sans décompte (${sansClics.length})`);
        await page.click('#btn-stop'); await page.waitForTimeout(300);

        // --- 3. ALLUMÉE : le transport ATTEND une mesure, sans que la carte des tics bouge ---------
        await page.click('#btn-decompte'); await page.waitForTimeout(200);
        const d1 = await etat();
        check(d1.actif === true && d1.classe === true && d1.presse === 'true',
            'un clic l\'allume, et l\'état se voit (classe active + aria-pressed)');
        await raz();
        await page.click('#btn-jouer');
        await page.waitForTimeout(700);                     // 0,7 s : bien avant la fin d'une mesure à 120 bpm (2,0 s)
        const pendant = await secondes();
        const enCours = await etat();
        check(pendant === 0,
            `pendant le décompte, le transport est ENCORE À ZÉRO (${pendant}s) — la musique n'a pas commencé, et rien n'a été décalé pour autant`);
        check(enCours.lecteur === 'lecture',
            'mais l\'application se dit bien « en lecture » : on a appuyé sur Lecture, il se passe quelque chose');
        const pendantClics = await clics();
        check(pendantClics.length === 4,
            `et QUATRE clics ont été demandés pour cette mesure à 4 temps (${pendantClics.length})`);
        check(pendantClics.filter(c => c.accent).length === 1,
            'dont exactement UN accentué — le premier temps, celui sur lequel on doit tomber');
        check(pendantClics.every(c => !c.sub),
            'et aucune subdivision : un décompte compte les temps, il ne les découpe pas');
        await page.waitForFunction(() => Tone.Transport.seconds > 0.02, null, { timeout: 8000 });
        const apres = await secondes();
        check(apres > 0 && apres < 0.8,
            `la musique démarre ensuite, au tout début du morceau et non plus loin (${apres}s) : le décompte n'a mangé aucune note`);

        // --- 4. LE DÉCOMPTE SONNE MÊME MÉTRONOME ÉTEINT -------------------------------------------
        check((await page.evaluate(() => window.app.lecteur.metronomeActif)) === false,
            'préalable : le métronome de lecture est bien resté éteint pendant tout ce qui précède');
        // ...donc les quatre clics ci-dessus ne pouvaient venir QUE du décompte. C'est la vérification
        // la plus importante du banc : les deux fonctions doivent rester séparables.
        await page.click('#btn-stop'); await page.waitForTimeout(300);

        // --- 5. IL SUIT LA SIGNATURE de la mesure de départ ---------------------------------------
        await page.evaluate(() => { window.app.editeur.definirSignature(3, 4); window.app.dessiner(); });
        await page.waitForTimeout(400);
        await raz();
        const t0 = Date.now();
        await page.click('#btn-jouer');
        await page.waitForFunction(() => Tone.Transport.seconds > 0.02, null, { timeout: 8000 });
        const attente34 = Date.now() - t0;
        const clics34 = await clics();
        check(clics34.length === 3,
            `en 3/4, TROIS clics et non quatre (${clics34.length}) — un décompte à contretemps de ce qui suit ne mettrait rien en place`);
        check(attente34 > 1200 && attente34 < 2100,
            `et l'attente suit la signature : ~${attente34} ms mesurés pour les 1500 ms d'une mesure à 3 temps à 120 bpm`);
        await page.click('#btn-stop'); await page.waitForTimeout(300);
        await page.evaluate(() => { window.app.editeur.definirSignature(4, 4); window.app.dessiner(); });
        await page.waitForTimeout(300);

        // --- 6. PAS DE DÉCOMPTE EN REPRENANT UNE PAUSE --------------------------------------------
        await page.click('#btn-jouer');
        await page.waitForFunction(() => Tone.Transport.seconds > 0.1, null, { timeout: 8000 });
        await page.click('#btn-jouer'); await page.waitForTimeout(300);   // pause
        exiger((await etat()).lecteur === 'pause', 'préalable : la lecture est bien en pause');
        const avantReprise = await secondes();
        await raz();
        await page.click('#btn-jouer'); await page.waitForTimeout(500);   // reprise
        const apresReprise = await secondes();
        check((await clics()).length === 0,
            'reprendre une pause ne rejoue AUCUN clic : on repart au milieu d\'une phrase, compter quatre temps devant tromperait l\'oreille');
        check(apresReprise > avantReprise + 0.2,
            `et la musique reprend immédiatement (${avantReprise}s -> ${apresReprise}s), sans mesure d'attente`);
        await page.click('#btn-stop'); await page.waitForTimeout(300);

        // --- 7. RETENU d'une session à l'autre ----------------------------------------------------
        await page.reload(); await page.waitForTimeout(1400);
        const apresRechargement = await page.evaluate(() => ({
            actif: window.app.lecteur.decompteActif,
            classe: document.getElementById('btn-decompte').classList.contains('actif'),
        }));
        check(apresRechargement.actif === true && apresRechargement.classe === true,
            'le décompte reste allumé au rechargement, et le bouton le montre — comme le métronome');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }

    // --- 8. LA BARRE DU BAS TIENT ENCORE, à toutes les largeurs de téléphone ---------------------
    // 320px est la largeur critique : le décompte y a fait déborder la barre de 40px, corrigé en
    // resserrant le bloc sous 360px (voir style.css, @media max-width: 359px). Sans cette règle,
    // cette vérification échoue — c'est ce qu'elle garde.
    for (const largeur of [320, 360, 390, 430]) {
        const t = await ouvrirApp({ viewport: { width: largeur, height: 780 }, hasTouch: true, isMobile: true });
        try {
            const m = await t.page.evaluate(() => {
                const barre = document.querySelector('.transport');
                const fleches = [...barre.querySelectorAll('.fleche-outils')].reduce((s, f) => s + f.offsetWidth, 0);
                const d = document.getElementById('btn-decompte').getBoundingClientRect();
                const j = document.getElementById('btn-jouer').getBoundingClientRect();
                return {
                    debordement: barre.scrollWidth - fleches - barre.clientWidth,
                    decompteDansEcran: d.left >= -0.5 && d.right <= innerWidth + 0.5,
                    cibleDecompte: Math.round(Math.min(d.width, d.height)),
                    cibleJouer: Math.round(Math.min(j.width, j.height)),
                };
            });
            check(m.debordement <= 1,
                `${largeur}px : la barre du bas ne déborde pas (${m.debordement}px, flèches déduites)`);
            check(m.decompteDansEcran && m.cibleDecompte >= 34 && m.cibleJouer >= 38,
                `${largeur}px : le décompte est entièrement à l'écran et les cibles restent touchables (décompte ${m.cibleDecompte}px, Lecture ${m.cibleJouer}px)`);
        } finally { await t.fermer(); }
    }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
