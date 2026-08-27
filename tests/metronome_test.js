// Banc du MÉTRONOME — et de la disparition de la réglette qu'il remplace.
//
// CE QU'IL PROTÈGE. Retour direct : « la réglette est trop compliquée, tu n'arrives pas à la mettre
// en place correctement » — remplacée par un métronome pendant la lecture, repris de HarmoHub
// (icône, synthé triangle bref, deux niveaux d'intensité). Trois exigences explicites :
//   • une option pour le garder pendant la lecture (pas seulement au décompte, qu'on n'a pas ici) ;
//   • suivre les rythmes BINAIRES et TERNAIRES — pas un simple clic toutes les N secondes : une
//     mesure composée (6/8) doit cliquer par DEUX temps ternaires, jamais par six clics égaux, qui
//     se confondraient à l'oreille avec un 3/4 (voir uniteDeGroupement, la même fonction qui décide
//     où ligaturer une portée) ;
//   • une option « noire » (le temps seul) ou « croche » (une subdivision en plus, qui suit elle
//     aussi le binaire/ternaire de la mesure).

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('métronome');

(async () => {
    plan(15);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // --- La réglette a bien disparu : plus de case à cocher, plus de trace dans le DOM ---------
        check(await page.evaluate(() => !document.getElementById('champ-reglette')),
            'la case à cocher « Réglette » a disparu du transport');

        // --- Les deux boutons existent, désactivés par défaut --------------------------------------
        exiger(await page.evaluate(() => !!document.getElementById('btn-metronome') && !!document.getElementById('btn-metronome-subdivision')),
            'les deux boutons du métronome sont posés dans le transport');
        check((await page.evaluate(() => window.app.lecteur.metronomeActif)) === false, 'désactivé par défaut (préférence explicite, pas un bruit imposé)');

        // --- Le clic bascule l'état ET l'habillage visuel -------------------------------------------
        await page.click('#btn-metronome');
        const apresClic = await page.evaluate(() => ({
            actif: window.app.lecteur.metronomeActif,
            classe: document.getElementById('btn-metronome').classList.contains('actif'),
            ariaPressed: document.getElementById('btn-metronome').getAttribute('aria-pressed'),
        }));
        check(apresClic.actif === true, 'un clic active le métronome');
        check(apresClic.classe === true && apresClic.ariaPressed === 'true', 'et l\'habillage (classe + aria-pressed) suit');

        // --- La lecture démarre sans erreur, métronome actif ----------------------------------------
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)]));
        });
        await page.click('#btn-jouer');
        await page.waitForTimeout(400);
        exiger((await page.evaluate(() => window.app.lecteur.etat)) === 'lecture', 'la lecture démarre, métronome actif, sans planter');
        await page.click('#btn-stop');

        // --- BINAIRE vs TERNAIRE : le nombre de clics programmés suit la signature ------------------
        // Mesure 0 : 4/4 (4 temps binaires). Mesure 1 : 6/8 (2 temps ternaires) — et les mesures 2, 3
        // héritent de cette même signature (aucune n'en repose une), donc trois mesures à 6/8 en tout.
        const r = await page.evaluate(async () => {
            const ed = window.app.editeur;
            ed.partition.mesures[1].signature = { battements: 6, unite: 8 };
            const Tone = window.Tone;
            const compter = (subdivision) => {
                const appels = [];
                const original = Tone.Transport.schedule.bind(Tone.Transport);
                Tone.Transport.schedule = (cb, t) => { appels.push(t); return original(cb, t); };
                window.app.lecteur.metronomeSubdivision = subdivision;
                window.app.lecteur._programmerMetronome(ed.partition, Tone.Transport.PPQ);
                Tone.Transport.schedule = original;
                return appels.length;
            };
            return { sansSub: compter(false), avecSub: compter(true) };
        });
        // Sans subdivision : 4 (mesure 0, 4/4) + 2+2+2 (mesures 1-3, 6/8) = 10.
        exiger(r.sansSub === 10, 'un temps par clic, en binaire (4/4) comme en ternaire (6/8 : 2 temps, pas 6)');
        // Avec subdivision : 4/4 double chaque temps (croche = 2 par temps) -> 8 ; 6/8 le TRIPLE
        // (la croche EST déjà le tiers du temps composé) -> 6 par mesure, ×3 mesures = 18. Total 26.
        check(r.avecSub === 26, 'la subdivision double en binaire, TRIPLE en ternaire — jamais un simple x2 partout');

        // Le compte ci-dessus a posé metronomeSubdivision=true DIRECTEMENT (sans passer par le
        // bouton, pour isoler le calcul de répartition des clics) : on remet l'état ET l'habillage
        // à zéro avant d'éprouver le BOUTON lui-même, sans quoi le clic qui suit le désactiverait.
        await page.evaluate(() => { window.app.lecteur.metronomeSubdivision = false; window.app.rafraichirMetronome(); });

        // --- Le bouton de subdivision change de valeur ET d'icône (noire <-> croches) ---------------
        const avantSub = await page.evaluate(() => document.getElementById('btn-metronome-subdivision').querySelector('svg').innerHTML);
        await page.click('#btn-metronome-subdivision');
        const r2 = await page.evaluate(() => ({
            sub: window.app.lecteur.metronomeSubdivision,
            classe: document.getElementById('btn-metronome-subdivision').classList.contains('actif'),
            icone: document.getElementById('btn-metronome-subdivision').querySelector('svg').innerHTML,
        }));
        check(r2.sub === true && r2.classe === true, 'le bouton « croche » active la subdivision, habillage compris');
        check(r2.icone !== avantSub, 'et son icône change (noire seule -> deux croches reliées), pas figée');

        // --- Persistance : les deux réglages survivent au rechargement ------------------------------
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.app && window.app.page, null, { timeout: 20000 });
        const apresRechargement = await page.evaluate(() => ({
            actif: window.app.lecteur.metronomeActif,
            sub: window.app.lecteur.metronomeSubdivision,
        }));
        check(apresRechargement.actif === true, 'l\'activation du métronome survit au rechargement');
        check(apresRechargement.sub === true, 'de même pour la subdivision');

        // --- Désactivé, une lecture ne programme AUCUN clic -----------------------------------------
        const zero = await page.evaluate(async () => {
            const ed = window.app.editeur;
            window.app.lecteur.metronomeActif = false;
            const Tone = window.Tone;
            const appels = [];
            const original = Tone.Transport.schedule.bind(Tone.Transport);
            Tone.Transport.schedule = (cb, t) => { appels.push(t); return original(cb, t); };
            // programmer() n'appelle _programmerMetronome QUE si metronomeActif est vrai.
            window.app.lecteur.programmer(ed.partition);
            Tone.Transport.schedule = original;
            return appels.length;
        });
        check(zero > 0, 'désactivé, programmer() programme quand même les NOTES (le morceau, lui, continue de sonner)');
        // La vérification qui compte : aucun de ces appels n'est un clic de métronome. On le sait
        // indirectement — en comparant au compte AVEC métronome actif de plus haut (10 de plus).
        const avecMetro = await page.evaluate(async () => {
            const ed = window.app.editeur;
            window.app.lecteur.metronomeActif = true;
            const Tone = window.Tone;
            const appels = [];
            const original = Tone.Transport.schedule.bind(Tone.Transport);
            Tone.Transport.schedule = (cb, t) => { appels.push(t); return original(cb, t); };
            window.app.lecteur.programmer(ed.partition);
            Tone.Transport.schedule = original;
            return appels.length;
        });
        check(avecMetro > zero, 'et activé, programmer() ajoute bien les clics en plus des notes');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
