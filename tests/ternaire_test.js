// Banc du RYTHME TERNAIRE (« swing ») — retour utilisateur : « est-ce qu'on peut implémenter dans la
// portée un système classique, qui permet de dire "croche=triolet", et ainsi écrire de façon
// ternaire ? Les portées classiques le font. Cette option doit être mise en place si je définis un
// rythme ternaire dans l'armure. »
//
// LA CONVENTION, et tout le sens de la fonctionnalité : on écrit des croches DROITES — lisibles, et
// c'est tout l'intérêt — et une indication en tête dit qu'elles se jouent longue-brève, deux tiers
// du temps puis un tiers. L'alternative, un triolet gravé sur chaque temps, est illisible sur un
// morceau entier et fausse le comptage à la moindre correction.
//
// CE QUE CE BANC SURVEILLE, et pourquoi c'est le point délicat de toute la fonctionnalité : le temps
// ÉCRIT cesse d'égaler le temps SONNÉ. Trois sorties doivent le savoir — l'audio, l'export MIDI, et
// la TÊTE DE LECTURE qui refait le chemin en sens inverse. Un seul des trois qui l'ignorerait donnerait
// le pire des résultats : une image qui dérive du son, ou un DAW qui ne joue pas ce qu'on entend.
//
//   1. LA GRILLE est partagée (model/score.js#grilleTernaire) par l'audio ET le MIDI. Deux grilles
//      calculées séparément finiraient par diverger sur un détail que personne ne surveille, et
//      l'utilisateur compare justement les deux : « pour que je puisse le récupérer dans un DAW ».
//   2. LES BORNES DE TEMPS SONT DES POINTS FIXES. C'est ce qui laisse valides, sans conversion, les
//      bornes de boucle, le point d'arrêt final et le découpage en mesures.
//   3. LA RÉCIPROQUE EST EXACTE. Sans elle, la tête de lecture retarderait d'un tiers de temps sur
//      chaque contretemps.
//   4. UNE MESURE COMPOSÉE NE SWINGUE PAS. Un 6/8 s'écrit déjà en trois croches par temps : il est
//      ternaire par son chiffrage. Swinguer par-dessus découperait un temps à trois en deux moitiés
//      inégales, ce qui n'a aucun sens musical.
//   5. L'INDICATION EST GRAVÉE, pas écrite en mots, et elle part dans le PDF comme le reste.
//   6. LE .JSON GARDE L'ÉCRITURE DROITE. C'est toute la convention : seules les SORTIES sont
//      ternarisées. Un modèle ternarisé à l'enregistrement se ternariserait deux fois à la relecture.

const fs = require('fs');
const os = require('os');
const path = require('path');
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('rythme ternaire');

const PPQ_MIDI = 480;   // voir io/midi.js — divisible par 3, donc les tiers de temps tombent juste

(async () => {
    plan(46);
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'tabhub-ternaire-'));
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 1320, height: 880 } });
    try {
        // =========================================================================================
        // 1. LA GRILLE — une seule, partagée, et qui sait quelles mesures swinguent
        // =========================================================================================
        const grille = (sig, n = 2) => page.evaluate(async ([sig, n]) => {
            const m = await import('/src/model/score.js');
            const p = m.creerPartition('guitare');
            p.meta.ternaire = true;
            p.mesures = [];
            for (let i = 0; i < n; i++) {
                const mes = m.creerMesure();
                if (i === 0 && sig) mes.signature = sig;
                p.mesures.push(mes);
            }
            const norm = m.normaliser(p);
            const g = m.grilleTernaire(norm);
            return {
                grille: g,
                // Un échantillon de positions : la borne de mesure, le temps, les deux croches.
                sonne: [0, 0.5, 1, 1.5, 2].map(x => m.sonneDepuisEcrit(g, x)),
            };
        }, [sig, n]);

        const g44 = await grille({ battements: 4, unite: 4 });
        exiger(Array.isArray(g44.grille) && g44.grille.length === 2,
            'grilleTernaire rend une case par mesure quand le morceau est ternaire');
        check(g44.grille[0].unite === 1 && g44.grille[1].unite === 1,
            'en 4/4 le temps vaut la noire, et la mesure swingue (unite = 1)');
        check(g44.grille[1].debut === 4,
            'les cases s\'enchaînent sur les positions écrites réelles (mesure 2 à 4 noires)');
        // LE CŒUR DU SWING : la croche sur le temps prend les DEUX TIERS, celle d'après le tiers.
        check(Math.abs(g44.sonne[1] - 2 / 3) < 1e-9,
            `la croche écrite à 0,5 sonne aux deux tiers du temps (reçu ${g44.sonne[1].toFixed(6)})`);
        check(Math.abs(g44.sonne[3] - (1 + 2 / 3)) < 1e-9,
            'la croche de contretemps du deuxième temps sonne à 1 + 2/3');
        // LES POINTS FIXES : c'est ce qui laisse valides, SANS CONVERSION, les bornes de boucle et le
        // point d'arrêt final, tous calculés en positions écrites.
        check(g44.sonne[0] === 0 && Math.abs(g44.sonne[2] - 1) < 1e-12 && Math.abs(g44.sonne[4] - 2) < 1e-12,
            'les bornes de TEMPS ne bougent pas d\'un iota : 0 reste 0, 1 reste 1, 2 reste 2');

        // --- Ce qui ne swingue PAS --------------------------------------------------------------
        const g68 = await grille({ battements: 6, unite: 8 });
        check(g68.grille.every(c => c.unite === 0),
            'une mesure COMPOSÉE (6/8) est marquée « ne swingue pas » — elle est déjà ternaire par son chiffrage');
        check(g68.sonne.every((s, i) => Math.abs(s - [0, 0.5, 1, 1.5, 2][i]) < 1e-12),
            'et ses croches sortent donc inchangées, jouées droites au milieu d\'un morceau swingué');
        const g58 = await grille({ battements: 5, unite: 8 });
        check(g58.grille.every(c => c.unite === 0),
            'une mesure en x/8 NON composée (5/8) ne swingue pas non plus : son temps EST la croche');

        const binaire = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const p = m.normaliser(m.creerPartition('guitare'));
            return { g: m.grilleTernaire(p), sonne: m.sonneDepuisEcrit(m.grilleTernaire(p), 0.5) };
        });
        check(binaire.g === null, 'un morceau BINAIRE n\'a pas de grille du tout — le mécanisme disparaît');
        check(binaire.sonne === 0.5, 'et une position y traverse les conversions sans changer');

        // --- La signature héritée, mesure par mesure --------------------------------------------
        const mixte = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const p = m.creerPartition('guitare');
            p.meta.ternaire = true;
            p.mesures = [m.creerMesure(), m.creerMesure(), m.creerMesure()];
            p.mesures[0].signature = { battements: 4, unite: 4 };
            p.mesures[1].signature = { battements: 6, unite: 8 };
            const norm = m.normaliser(p);
            const g = m.grilleTernaire(norm);
            return { unites: g.map(c => c.unite), m1: m.sonneDepuisEcrit(g, 0.5), m3: m.sonneDepuisEcrit(g, 7.5) };
        });
        check(JSON.stringify(mixte.unites) === '[1,0,0]',
            'L\'UNITÉ SE PREND MESURE PAR MESURE : un 6/8 au milieu d\'un 4/4 cesse de swinguer, et la mesure suivante en hérite');
        check(Math.abs(mixte.m1 - 2 / 3) < 1e-9 && Math.abs(mixte.m3 - 7.5) < 1e-12,
            'la mesure en 4/4 swingue, celle en 6/8 héritée non — dans le même morceau');

        // --- La réciproque ----------------------------------------------------------------------
        const aller = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const p = m.creerPartition('guitare');
            p.meta.ternaire = true;
            p.mesures = [m.creerMesure(), m.creerMesure()];
            const g = m.grilleTernaire(m.normaliser(p));
            let pire = 0, croissant = true, precedent = -1;
            for (let x = 0; x <= 8.0001; x += 1 / 16) {
                const s = m.sonneDepuisEcrit(g, x);
                pire = Math.max(pire, Math.abs(m.ecritDepuisSonne(g, s) - x));
                if (s <= precedent) croissant = false;
                precedent = s;
            }
            return { pire, croissant };
        });
        check(aller.pire < 1e-9,
            `l'aller-retour écrit -> sonné -> écrit est EXACT sur tout le morceau (pire écart ${aller.pire.toExponential(2)})`);
        check(aller.croissant,
            'et la transformation est STRICTEMENT CROISSANTE : aucune note ne peut passer derrière celle qui la précède');

        // =========================================================================================
        // 2. L'AUDIO — les notes programmées, et la tête de lecture qui refait le chemin inverse
        // =========================================================================================
        // Huit croches, pour que chaque temps porte une paire à swinguer. SUR LA CORDE GRAVE (5) et
        // non l'aiguë : une note aiguë se grave AU-DESSUS de la portée, lignes supplémentaires et
        // hampe montante comprises, et viendrait se mêler à l'indication de tête que le cas 5 compte
        // plus bas. Une note grave descend, loin de l'en-tête. Le rythme éprouvé est le même — la
        // corde ne change pas d'un tic la place d'une croche.
        const poserHuitCroches = () => page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements =
                [0, 1, 2, 3, 4, 5, 6, 7].map(() => m.creerEvenement({ valeur: 8 }, [m.creerNote(5, 5)]));
            ed.prevenir('document');
        });
        await poserHuitCroches();
        await page.waitForTimeout(200);

        // CE QUE LE TRANSPORT A REÇU, et non ce qu'on recalculerait à côté. `Tone.Transport` garde sa
        // ligne de temps d'évènements programmés, en TICS — c'est littéralement ce qui déclenchera les
        // notes. Refaire le calcul de `programmer` dans le banc éprouverait la grille (déjà éprouvée
        // au cas 1) et non le BRANCHEMENT de la grille sur l'audio, qui est le vrai sujet ici.
        //
        // `_timeline` est de l'interne à Tone.js, assumé : `exiger` ci-dessous vérifie qu'on y trouve
        // bien les huit notes attendues, si bien qu'un changement de structure rend le banc ROUGE au
        // lieu de le laisser passer sur un tableau vide.
        const ticksDe = () => page.evaluate(async () => {
            const l = window.app.lecteur;
            await l.demarrer();
            l.programmer(window.app.editeur.partition);
            const T = globalThis.Tone.Transport;
            const ligne = T._timeline && T._timeline._timeline;
            if (!Array.isArray(ligne)) return { PPQ: T.PPQ, debuts: null };
            // Les huit croches tiennent dans la PREMIÈRE mesure ; le point d'arrêt final, lui, est
            // programmé à la fin du morceau (quatre mesures), très au-delà.
            const capacite = 4 * T.PPQ;
            return { PPQ: T.PPQ, debuts: ligne.map(e => e.time).filter(t => t < capacite).sort((a, b) => a - b) };
        });

        const droit = await ticksDe();
        const PPQ = droit.PPQ;
        exiger(Array.isArray(droit.debuts) && droit.debuts.length === 8,
            `huit croches sont bien programmées sur le transport (${droit.debuts ? droit.debuts.length : 'ligne de temps introuvable'})`);
        // En binaire, huit croches à intervalles ÉGAUX d'une demi-noire.
        const attenduDroit = [0, 1, 2, 3, 4, 5, 6, 7].map(i => Math.round(i * PPQ / 2));
        check(JSON.stringify(droit.debuts) === JSON.stringify(attenduDroit),
            `BINAIRE : les huit croches tombent à intervalles égaux de ${PPQ / 2} tics`);

        await page.evaluate(() => window.app.editeur.basculerTernaire());
        await page.waitForTimeout(200);
        const swing = await ticksDe();
        // LONGUE-BRÈVE : deux tiers de temps puis un tiers, soit 2/3 et 1/3 de PPQ.
        const attenduSwing = [0, 1, 2, 3].flatMap(t => [t * PPQ, Math.round(t * PPQ + PPQ * 2 / 3)]);
        check(JSON.stringify(swing.debuts) === JSON.stringify(attenduSwing),
            `TERNAIRE : elles tombent longue-brève, ${Math.round(PPQ * 2 / 3)} puis ${Math.round(PPQ / 3)} tics (reçu ${JSON.stringify(swing.debuts)})`);
        check(swing.debuts.every(t => Number.isInteger(t)) && PPQ % 3 === 0,
            `aucun arrondi : la division du transport (${PPQ}) est divisible par 3, les tiers de temps tombent sur des tics entiers`);
        check([0, 1, 2, 3].every(t => swing.debuts.includes(t * PPQ)),
            'les croches SUR LE TEMPS n\'ont pas bougé d\'un tic — ce sont les points fixes de la grille');
        // LA DURÉE aussi, et pas seulement la place : une croche écrite vaut deux tiers de temps sur
        // le temps, un tiers entre deux. Une durée transformée « en bloc » (positionTernaire appliqué
        // à la durée au lieu de la DIFFÉRENCE de deux positions) les aurait faites toutes égales à
        // deux tiers — l'erreur est silencieuse, et c'est celle que ce cas existe pour attraper.
        //
        // CE QUI ARRIVE AU SYNTHÉ, mesuré en déclenchant les rappels que le transport a en réserve et
        // en écoutant ce que le lecteur leur fait jouer. Recalculer la durée dans le banc à partir de
        // la grille éprouverait la grille (cas 1) et laisserait passer une durée mal composée.
        const durees = await page.evaluate(async () => {
            const l = window.app.lecteur;
            const T = globalThis.Tone.Transport;
            const capacite = 4 * T.PPQ;
            const rappels = T._timeline._timeline.filter(e => e.time < capacite).sort((a, b) => a.time - b.time);
            const vues = [];
            const vrai = l.synthe.triggerAttackRelease.bind(l.synthe);
            // Muet le temps de la mesure : on veut la DURÉE demandée, pas le son.
            l.synthe.triggerAttackRelease = (note, secondes) => { vues.push(secondes); };
            try { for (const r of rappels) r.callback(0); } finally { l.synthe.triggerAttackRelease = vrai; }
            // De secondes en tics, au tempo courant : une noire vaut 60/bpm secondes.
            const parNoire = 60 / T.bpm.value;
            return vues.map(sec => Math.round((sec / parNoire) * T.PPQ));
        });
        check(JSON.stringify(durees) === JSON.stringify([0, 1, 2, 3].flatMap(() =>
            [Math.round(PPQ * 2 / 3), Math.round(PPQ / 3)])),
            `et chaque croche DURE ce qu'elle vaut à sa place : ${Math.round(PPQ * 2 / 3)} tics sur le temps, ${Math.round(PPQ / 3)} entre deux (reçu ${JSON.stringify(durees)})`);

        // ON FAIT TOURNER `_suivre`, on ne rejoue pas son calcul : c'est LUI qui doit appliquer la
        // réciproque. On pose l'horloge à une position SONNÉE, on laisse passer deux images (la boucle
        // est sur requestAnimationFrame), et on lit `lecteur.position` — exactement la valeur dont la
        // tête de lecture se sert pour se placer (voir main.js#marquesCurseur).
        const tete = await page.evaluate(async () => {
            const l = window.app.lecteur;
            const T = globalThis.Tone.Transport;
            const lire = (sonne) => new Promise((res) => {
                T.ticks = Math.round(sonne * T.PPQ);
                l.etat = 'lecture';
                l._suivre();
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    const vu = l.position;
                    l.etat = 'arret';
                    l._arreterSuivi();
                    res(vu);
                }));
            });
            return { surLeTemps: await lire(1), contretemps: await lire(1 + 2 / 3), brut: 1 + 2 / 3 };
        });
        check(Math.abs(tete.surLeTemps - 1) < 1e-6,
            `TÊTE DE LECTURE : sur le temps, l'image et le son sont au même endroit (reçu ${tete.surLeTemps})`);
        check(Math.abs(tete.contretemps - 1.5) < 1e-6,
            `et au contretemps elle se pose sur la croche ÉCRITE (1,5) là où le son est à ${tete.brut.toFixed(4)} — reçu ${tete.contretemps}`);
        check(Math.abs(tete.brut - tete.contretemps) > 0.1,
            'écart que la réciproque rattrape, et qui se verrait à l\'œil nu sans elle (un sixième de temps)');

        // --- Le départ à une position donnée ----------------------------------------------------
        // MÊME PRINCIPE : on appelle `jouer`, et on lit l'horloge qu'il a posée.
        //
        // AVEC LE DÉCOMPTE ACTIF, et c'est ce qui rend la mesure fiable : le décompte diffère le
        // départ du transport d'une mesure (voir player.js#_programmerDecompte, `start(quand)`), donc
        // les tics restent EXACTEMENT là où `jouer` les a posés le temps qu'on les lise. Sans lui,
        // l'horloge tourne déjà pendant qu'on la lit et la mesure dérive de quelques tics — un banc
        // qui passerait ou non selon la charge de la machine.
        const depart = await page.evaluate(async () => {
            const l = window.app.lecteur;
            const T = globalThis.Tone.Transport;
            const decompteAvant = l.decompteActif;
            l.decompteActif = true;
            const partir = async (depuis) => {
                l.arreter();
                await l.jouer(window.app.editeur.partition, depuis);
                const t = T.ticks;
                l.arreter();
                return t / T.PPQ;
            };
            const r = { borne: await partir(4), milieu: await partir(0.5) };
            l.decompteActif = decompteAvant;
            return r;
        });
        check(Math.abs(depart.borne - 4) < 1e-6,
            `un départ posé sur une BORNE DE MESURE ne se déplace pas — le cas courant (boucle, début de morceau) : reçu ${depart.borne}`);
        check(Math.abs(depart.milieu - 2 / 3) < 1e-6,
            `et un départ posé AILLEURS est converti, pour tomber au bon endroit du son (reçu ${depart.milieu})`);

        // --- LE MÉTRONOME SWINGUE AVEC LA MUSIQUE -----------------------------------------------
        // Sans ça, son clic de contretemps taperait au MILIEU du temps quand la musique joue aux deux
        // tiers : deux pulsations concurrentes, et le repère devient un piège. Les clics de TEMPS ne
        // bougent pas, eux — une borne de temps est un point fixe.
        //
        // SUR UN MORCEAU VIDE (aucune note) : la ligne de temps du transport ne porte alors QUE les
        // clics, sans quoi il faudrait les trier des notes sans avoir de quoi les distinguer.
        const clics = await page.evaluate(async () => {
            const l = window.app.lecteur;
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.meta.ternaire = true;
            ed.prevenir('document');
            const avant = [l.metronomeActif, l.metronomeSubdivision];
            l.metronomeActif = true;
            l.metronomeSubdivision = true;
            l.programmer(ed.partition);
            const T = globalThis.Tone.Transport;
            const uneMesure = 4 * T.PPQ;
            const t = T._timeline._timeline.map(e => e.time).filter(x => x < uneMesure).sort((a, b) => a - b);
            [l.metronomeActif, l.metronomeSubdivision] = avant;
            return { PPQ: T.PPQ, t };
        });
        exiger(clics.t.length === 8,
            `une mesure de 4/4 avec subdivision donne huit clics (reçu ${clics.t.length})`);
        check(JSON.stringify(clics.t) === JSON.stringify([0, 1, 2, 3].flatMap(
                b => [b * clics.PPQ, Math.round(b * clics.PPQ + clics.PPQ * 2 / 3)])),
            `MÉTRONOME : les clics de temps restent en place, ceux de contretemps swinguent avec la musique (reçu ${JSON.stringify(clics.t)})`);

        // =========================================================================================
        // 3. L'EXPORT MIDI — la même grille, donc le même rythme dans le DAW
        // =========================================================================================
        // Le cas du métronome ci-dessus a reparti d'un morceau vide : on repose les huit croches, que
        // la suite compare tic pour tic à ce que l'audio a programmé.
        await poserHuitCroches();
        await page.evaluate(() => { window.app.editeur.partition.meta.ternaire = true; window.app.editeur.prevenir('document'); });
        await page.waitForTimeout(200);

        const ticksMidi = () => page.evaluate(async () => {
            const midi = await import('/src/io/midi.js');
            const octets = midi.genererMidi(window.app.editeur.partition);
            const a = midi.analyserMidi(octets);
            // `analyserMidi` rend les notes avec leur position en tics, à la division du fichier.
            // `analyserMidi` rend les positions en NOIRES (voir io/midi.js) : on repasse en tics à la
            // division du fichier, l'unité dans laquelle un DAW lit ce qu'on lui donne.
            const notes = a.notes.slice().sort((x, y) => x.debutNoires - y.debutNoires);
            return {
                division: a.division,
                debuts: notes.map(n => Math.round(n.debutNoires * a.division)),
                durees: notes.map(n => Math.round((n.finNoires - n.debutNoires) * a.division)),
            };
        });
        const midiSwing = await ticksMidi();
        exiger(midiSwing.division === PPQ_MIDI, `le fichier MIDI est écrit à ${PPQ_MIDI} tics par noire`);
        exiger(midiSwing.debuts.length === 8, 'les huit croches se retrouvent dans le fichier');
        check(JSON.stringify(midiSwing.debuts) === JSON.stringify([0, 320, 480, 800, 960, 1280, 1440, 1760]),
            `EXPORT MIDI : exactement les mêmes tics que l'audio (reçu ${JSON.stringify(midiSwing.debuts)})`);
        // LES DEUX SORTIES, COMPARÉES DIRECTEMENT — la seule vérification qui dise vraiment que le DAW
        // jouera ce qu'on entend. Les divisions diffèrent (480 pour le fichier, celle du transport
        // pour l'audio) : on compare donc les positions en NOIRES, la grandeur commune.
        check(JSON.stringify(midiSwing.debuts.map(t => t / PPQ_MIDI))
              === JSON.stringify(swing.debuts.map(t => t / PPQ)),
            'LA MÊME GRILLE DES DEUX CÔTÉS : ce que l\'utilisateur entend dans TabHub est ce que jouera son DAW');

        await page.evaluate(() => window.app.editeur.basculerTernaire());
        await page.waitForTimeout(150);
        const midiDroit = await ticksMidi();
        check(JSON.stringify(midiDroit.debuts) === JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7].map(i => i * PPQ_MIDI / 2)),
            'et décocher le ternaire rend un export parfaitement droit — rien ne reste collé au fichier');

        // =========================================================================================
        // 4. LE MODÈLE — le .json garde l'écriture DROITE
        // =========================================================================================
        const modele = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.basculerTernaire();
            const brut = JSON.parse(JSON.stringify(ed.partition));
            const relu = m.normaliser(brut);
            return {
                drapeau: !!brut.meta.ternaire,
                survitAuJson: !!relu.meta.ternaire,
                // Les durées écrites, telles qu'enregistrées : que des croches (valeur 8), jamais un
                // triolet ni une durée « déjà swinguée ».
                durees: brut.mesures[0].voix[0].evenements.map(e => e.duree.valeur),
                nolets: brut.mesures[0].voix[0].evenements.map(e => e.duree.nolet),
            };
        });
        check(modele.drapeau, 'le ternaire est un champ de DOCUMENT (meta.ternaire), pas un réglage d\'application');
        check(modele.survitAuJson, 'et il survit à l\'aller-retour .json — un morceau swingué se réouvre swingué');
        check(modele.durees.every(v => v === 8),
            'LE MODÈLE RESTE DROIT : huit croches enregistrées comme des croches, c\'est toute la convention');
        check(modele.nolets.every(n => !n),
            'aucun n-olet n\'a été posé dans le modèle — sinon le ternaire s\'appliquerait DEUX fois à la relecture');

        // =========================================================================================
        // 5. L'INDICATION GRAVÉE
        // =========================================================================================
        // Les parties du signe se comptent sur le MODÈLE DE PAGE, pas sur le SVG : c'est le même jeu
        // de primitives qui part au PDF, donc les compter là éprouve les deux rendus d'un coup.
        //
        // DEUX FILTRES, ET IL EN FAUT DEUX. L'ordonnée isole l'en-tête (au-dessus du premier
        // système) ; l'ÉCHELLE isole l'indication de la musique, qui se grave à l'interligne PLEIN
        // (geo.S) là où une mention secondaire se grave à un peu plus de la moitié. Sans le second,
        // n'importe quelle note assez aiguë pour monter au-dessus de la portée se ferait compter
        // comme une partie du signe — et le banc dirait vrai pour la mauvaise raison.
        const compterSigne = () => page.evaluate(() => {
            const pg = window.app.page;
            const ySysteme = pg.ancrages.systemes[0].yPortee;
            const petit = pg.geo.S * 0.9;
            let tetes = 0, ligatures = 0, crochets = 0, nolet = 0, traits = 0;
            for (const pr of pg.primitives) {
                const y = pr.t === 'ligne' ? pr.y1 : pr.t === 'glyphe' ? pr.y : pr.t === 'poly' ? pr.pts[0][1] : null;
                if (y == null || y >= ySysteme - 6) continue;
                if (pr.t === 'glyphe' && !(pr.echelle < petit)) continue;
                if (pr.t === 'glyphe' && /teteNoire/.test(pr.nom || '')) tetes++;
                if (pr.t === 'glyphe' && /crochetCroche/.test(pr.nom || '')) crochets++;
                if (pr.t === 'glyphe' && /chiffreNolet3/.test(pr.nom || '')) nolet++;
                if (pr.t === 'poly') ligatures++;
                if (pr.t === 'ligne') traits++;
            }
            return { tetes, ligatures, crochets, nolet, traits };
        });
        const signe = await compterSigne();
        check(signe.tetes === 4,
            `L'INDICATION EST GRAVÉE : quatre têtes de note (deux croches « = » un triolet noire + croche), reçu ${signe.tetes}`);
        check(signe.ligatures === 1, 'une ligature, qui tient la paire de croches de gauche');
        check(signe.crochets === 1, 'un crochet de croche, sur la seconde note du triolet');
        check(signe.nolet === 1, 'et le chiffre « 3 » du n-olet, sans lequel un triolet ne se distingue pas de deux croches');
        check(signe.traits === 8,
            `les hampes et le crochet de n-olet sont tracés : 4 hampes + 4 segments de crochet (reçu ${signe.traits})`);

        // Décocher le ternaire retire TOUT le signe : pas un trait ne reste.
        await page.evaluate(() => window.app.editeur.basculerTernaire());
        await page.waitForTimeout(200);
        const sansSigne = await compterSigne();
        check(sansSigne.tetes === 0 && sansSigne.ligatures === 0 && sansSigne.crochets === 0
              && sansSigne.nolet === 0 && sansSigne.traits === 0,
            'et décocher le ternaire efface le signe ENTIÈREMENT — pas une tête, pas un trait ne reste en l\'air');

        // --- Dans le PDF, comme le reste de la gravure ------------------------------------------
        await page.evaluate(() => window.app.editeur.basculerTernaire());
        await page.waitForTimeout(200);
        await page.click('#btn-fichiers');
        await page.click('#popover-fichiers [data-action="pdf"]');
        await page.waitForTimeout(500);
        exiger(!(await page.evaluate(() => document.getElementById('fenetre-pdf').hidden)),
            'la fenêtre d\'aperçu PDF s\'ouvre');
        const attentePdf = page.waitForEvent('download');
        await page.click('#pdf-enregistrer');
        const tel = await attentePdf;
        const cheminPdf = path.join(dossier, 'ternaire.pdf');
        await tel.saveAs(cheminPdf);
        check(fs.existsSync(cheminPdf) && fs.readFileSync(cheminPdf).slice(0, 4).toString() === '%PDF',
            'L\'INDICATION PART DANS LE PDF : même jeu de primitives que l\'écran, aucune police à embarquer');

        check(erreurs.length === 0, `aucune erreur de console ni exception (${erreurs.join(' | ') || 'rien'})`);
    } catch (e) {
        check(false, 'exception pendant la campagne : ' + (e && e.message));
    } finally {
        await fermer();
        fs.rmSync(dossier, { recursive: true, force: true });
    }
    process.exit(bilan());
})();
