// Banc de la JUSTESSE DE LA LECTURE — que ce qu'on entend tombe exactement où c'est écrit.
//
// CE QU'IL PROTÈGE. Retour utilisateur, après un premier correctif de gravure : « j'ai eu le même
// problème sur plein de morceaux et dans beaucoup de conditions différentes (noires, croches...).
// Le son ne tombe jamais en rythme, il y a de petits décalages qui ne vont pas. »
//
// LE MÉCANISME. Une note programmée dans Tone est livrée au moteur audio À L'AVANCE : tant que
// l'instant demandé est encore dans le futur, le navigateur la joue à l'échantillon près. Livrée en
// retard, il la joue IMMÉDIATEMENT — donc décalée, d'une quantité qui change à chaque fois. Toute la
// justesse tient donc à une seule question : le fil principal laisse-t-il l'horloge livrer à temps ?
//
// DEUX CHOSES L'EN EMPÊCHAIENT, et elles se cumulaient :
//
//   1. LA TÊTE DE LECTURE REDESSINAIT TOUTE LA PAGE à chaque image — `mettreEnPage` + `rendreSvg` +
//      un `innerHTML` complet, soixante fois par seconde. MESURÉ sur 48 mesures : 15,5 redessins par
//      seconde à 27 ms en moyenne et jusqu'à 79 ms, soit 42 % du fil principal. Elle se déplace
//      maintenant dans son propre calque (voir main.js#poserTeteDeLecture et le `<g id="tete-lecture">`
//      que render/svg.js lui réserve) : 0,18 ms par image, 0,5 % du fil.
//
//   2. LA MARGE D'ANTICIPATION ÉTAIT DE 20 ms (player.js#demarrer), réduite pour raccourcir le temps
//      mort au lancement. MESURÉ avant correction, sur douze mesures de rythmes variés : 7 % des
//      notes livrées en retard, jusqu'à 12 ms. Elle est à 100 ms, et le temps mort au lancement n'en
//      dépend plus : `jouer` fixe l'instant de départ lui-même (DELAI_DEPART), les deux réglages
//      ayant été confondus jusque-là sans raison.
//
// CE QUE CETTE MARGE COÛTE, et pourquoi on ne peut pas l'éviter : elle EST le temps mort entre le
// clic et la première note. Tone démarre le transport à `context.now()`, c'est-à-dire
// `currentTime + lookAhead`. Un essai a voulu découpler les deux en passant un départ plus rapproché
// à `Transport.start()` : un instant antérieur à `now()` n'est pas un départ plus tôt, c'est un
// départ DANS LE PASSÉ, que Tone IGNORE — le transport restait « stopped », ses tics à zéro, pendant
// que l'application se croyait en lecture. Deux bancs l'ont attrapé (aide rythmique : une tête de
// lecture immobile sur une boucle muette ; effets : un slide sans le moindre son). D'où la
// vérification « le transport démarre vraiment » ci-dessous, qui manquait.
//
// CE QUE CE BANC MESURE, et ce qu'il évite de mesurer. Les instants DEMANDÉS sont déterministes : on
// les compare au rythme écrit au centième de milliseconde près, et c'est la vérification principale.
// L'AVANCE réelle, elle, dépend de la machine : on n'en exige un seuil que sur un morceau court qui
// ne défile pas, et on vérifie surtout les propriétés STRUCTURELLES dont elle découle (la marge, le
// délai de départ plus long que le réveil, le nombre de redessins).

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('justesse de la lecture');

/** Joue un motif et rend tout ce qu'on peut en mesurer. Une page neuve par cas : enchaîner
 *  lecture/arrêt/lecture dans la même page a ses propres pièges, sans rapport avec ce qu'on éprouve ici. */
async function jouerEtMesurer({ tempo, motif, mesures = 6, ms = 7000, lookAhead = null, teteRedessine = false }) {
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        const r = await page.evaluate(async (cfg) => {
            const app = window.app, ed = app.editeur, Tone = globalThis.Tone;
            const m = await import('/src/model/score.js');
            const note = (v, fr, nolet) => {
                const e = m.creerEvenement({ valeur: v, points: 0 }, [m.creerNote(2, fr)]);
                if (nolet) e.nolet = nolet;
                return e;
            };
            const pointee = (v, fr) => m.creerEvenement({ valeur: v, points: 1 }, [m.creerNote(2, fr)]);
            const motifs = {
                noires: () => [note(4, 5), note(4, 4), note(4, 3), note(4, 2)],
                croches: () => Array.from({ length: 8 }, (_, k) => note(8, k % 6)),
                doubles: () => Array.from({ length: 16 }, (_, k) => note(16, k % 6)),
                melange: () => [pointee(8, 5), note(16, 4), note(4, 3), note(8, 2), note(8, 5), note(4, 0)],
                triolets: () => Array.from({ length: 12 }, (_, k) => note(8, k % 6, { dans: 3, valent: 2 })),
            };
            ed.nouveau('basse');
            ed.partition.meta.tempo = cfg.tempo;
            for (let i = 0; i < cfg.mesures; i++) {
                ed.partition.mesures[i] = m.creerMesure({ voix: [{ evenements: motifs[cfg.motif]() }] });
            }
            ed.prevenir('document');
            await app.lecteur.demarrer();
            if (cfg.lookAhead != null) Tone.getContext().lookAhead = cfg.lookAhead;
            app.lecteur.decompteActif = false;
            const ctx = Tone.getContext();
            const releve = [];
            const vrai = app.lecteur.synthe.triggerAttackRelease.bind(app.lecteur.synthe);
            app.lecteur.synthe.triggerAttackRelease = function (n, d, t, v) {
                releve.push({ t, avance: t - ctx.currentTime });
                return vrai(n, d, t, v);
            };
            let dessins = 0, coutTete = 0, appelsTete = 0, pireTete = 0, iconesTransport = 0;
            const vraiD = app.dessiner.bind(app);
            app.dessiner = function () { dessins++; return vraiD(); };
            const posePropre = app.poserTeteDeLecture.bind(app);
            // ANCIEN MÉCANISME rejoué : chaque image de lecture remet toute la page en page. Le
            // verrou évite la récursion — `dessiner` repose la tête en finissant, et sans lui cet
            // appel-là relancerait un dessin.
            let dedans = false;
            const vraiT = !cfg.teteRedessine ? posePropre : () => {
                if (dedans) { posePropre(); return; }
                dedans = true;
                try { app.dessiner(); } finally { dedans = false; }
            };
            app.poserTeteDeLecture = function () {
                const a = performance.now();
                try { return vraiT(); } finally { const x = performance.now() - a; appelsTete++; coutTete += x; if (x > pireTete) pireTete = x; }
            };
            const vraiR = app.rafraichirTransport.bind(app);
            app.rafraichirTransport = function () { iconesTransport++; return vraiR(); };

            const avantDepart = ctx.currentTime;
            await app.lecteur.jouer(ed.partition, 0);
            const transportDemarre = Tone.Transport.state;
            await new Promise(r => setTimeout(r, cfg.ms));
            const svg = app.el.feuille.querySelector('svg');
            const calque = svg.querySelector('#tete-lecture');
            const enfantsSvg = [...svg.childNodes];
            const teteEnLecture = calque ? calque.childNodes.length : 0;
            // le calque doit venir APRÈS le rectangle de fond, sans quoi il est dessiné dessous —
            // présent, aux bonnes coordonnées, et rigoureusement invisible.
            const iFond = enfantsSvg.findIndex(e => e.tagName === 'rect');
            const iCalque = calque ? enfantsSvg.indexOf(calque.parentNode === svg ? calque : calque.parentNode) : -1;
            app.lecteur.arreter();
            await new Promise(r => setTimeout(r, 120));
            const teteApresArret = calque ? calque.childNodes.length : null;

            const plat = m.aplatir(ed.partition).filter(e => e.ref.notes.length);
            const spb = 60 / cfg.tempo;
            const n = Math.min(releve.length, plat.length);
            let pireEcart = 0;
            for (let i = 1; i < n; i++) {
                pireEcart = Math.max(pireEcart, Math.abs((releve[i].t - releve[0].t) - (plat[i].debut - plat[0].debut) * spb));
            }
            const av = releve.map(x => x.avance * 1000).sort((a, b) => a - b);
            return {
                notes: n, total: releve.length, transportDemarre,
                pireEcartMs: +(pireEcart * 1000).toFixed(4),
                enRetard: av.filter(a => a <= 0).length,
                avanceMinMs: av.length ? +av[0].toFixed(1) : null,
                avanceMedianeMs: av.length ? +av[Math.floor(av.length / 2)].toFixed(1) : null,
                latenceDepartMs: releve.length ? +((releve[0].t - avantDepart) * 1000).toFixed(1) : null,
                dessins, appelsTete, coutMoyenTeteMs: +(coutTete / Math.max(1, appelsTete)).toFixed(3),
                pireTeteMs: +pireTete.toFixed(2), iconesTransport,
                teteEnLecture, teteApresArret, calqueApresLeFond: iCalque > iFond && iFond >= 0,
                lookAhead: ctx.lookAhead, updateInterval: ctx.updateInterval,
            };
        }, { tempo, motif, mesures, ms, lookAhead, teteRedessine });
        return { ...r, erreurs: erreurs.length };
    } finally { await fermer(); }
}

(async () => {
    plan(20);
    try {
        // --- 1. CE QU'ON ENTEND TOMBE OÙ C'EST ÉCRIT, dans toutes les conditions citées ----------
        const cas = [
            ['noires à 90', { tempo: 90, motif: 'noires' }],
            ['croches à 120', { tempo: 120, motif: 'croches' }],
            ['doubles-croches à 140', { tempo: 140, motif: 'doubles' }],
            ['rythmes mélangés à 132', { tempo: 132, motif: 'melange' }],
            ['triolets à 100', { tempo: 100, motif: 'triolets' }],
        ];
        const mesures = {};
        for (const [nom, cfg] of cas) {
            const r = await jouerEtMesurer(cfg);
            mesures[nom] = r;
            if (!exiger(r.notes >= 8, `préalable : ${nom} — assez de notes captées (${r.notes})`)) continue;
            check(r.pireEcartMs < 1,
                `${nom} : chaque attaque tombe sur le rythme écrit à ${r.pireEcartMs} ms près — un écart `
                + 'audible commence vers 10 ms, un écart gênant vers 20');
        }

        // --- 2. AUCUNE NOTE LIVRÉE EN RETARD, sur un morceau qui tient à l'écran -----------------
        const court = mesures['croches à 120'];
        if (exiger(!!court, 'préalable : le cas « croches à 120 » a bien tourné')) {
            check(court.enRetard === 0,
                `aucune note livrée en retard (${court.enRetard} sur ${court.total}) — il y en avait 7 % `
                + 'avant correction, et une note livrée en retard est jouée immédiatement, donc décalée');
            check(court.avanceMinMs >= 20,
                `et toutes gardent une vraie marge (la plus juste : ${court.avanceMinMs} ms d'avance) — `
                + 'elle était tombée à 3 ms');
        }

        // --- 3. LES PROPRIÉTÉS STRUCTURELLES dont cette marge découle ----------------------------
        if (court) {
            check(court.lookAhead >= 0.05,
                `la marge d'anticipation vaut ${court.lookAhead} s : au-dessus du pire redessin mesuré `
                + '(79 ms au changement de système), là où 20 ms ne couvraient presque rien');
            check(court.transportDemarre === 'started',
                `LE TRANSPORT DÉMARRE VRAIMENT (état « ${court.transportDemarre} ») — un départ posé avant `
                + '`context.now()` serait silencieusement ignoré, et l\'application se croirait en lecture');
            check(court.latenceDepartMs != null && court.latenceDepartMs < 150,
                `le temps mort au lancement reste court (${court.latenceDepartMs} ms entre le clic et la `
                + 'première note) : il vaut la marge, c\'est le prix assumé d\'une lecture juste');
        }

        // --- 4. LA TÊTE DE LECTURE NE REMET PLUS LA PAGE EN PAGE --------------------------------
        if (court) {
            check(court.dessins === 0,
                `pas un seul redessin complet pendant la lecture (${court.dessins}) — il y en avait 15 par `
                + 'seconde, à 27 ms pièce');
            check(court.appelsTete > 30 && court.coutMoyenTeteMs < 2,
                `la tête bouge bien à chaque image (${court.appelsTete} fois) et coûte ${court.coutMoyenTeteMs} ms, `
                + `au pire ${court.pireTeteMs} ms`);
            check(court.iconesTransport <= 3,
                `et le bouton du transport n'est refait qu'au changement d'état (${court.iconesTransport} fois), `
                + 'pas soixante fois par seconde pour un résultat identique');
        }

        // --- 5. ELLE EST TOUJOURS DESSINÉE, ET AU BON ÉTAGE -------------------------------------
        // Le piège exact rencontré en écrivant ce correctif : posée à la racine du SVG, juste après
        // `<defs>`, elle se retrouvait SOUS le rectangle de fond, opaque. Présente, aux bonnes
        // coordonnées, et rigoureusement invisible.
        if (court) {
            check(court.teteEnLecture === 3,
                `la tête de lecture est bien tracée pendant la lecture (${court.teteEnLecture} rectangles : `
                + 'le trait et les deux bandes de traînée)');
            check(court.calqueApresLeFond === true,
                'et son calque vient APRÈS le rectangle de fond — sous la musique mais par-dessus le papier');
            check(court.teteApresArret === 0,
                `elle s'efface à l'arrêt (${court.teteApresArret} rectangle)`);
        }

        // --- 6. NEUTRALISATION : on remet la marge de 20 ms -------------------------------------
        const etroit = await jouerEtMesurer({ tempo: 120, motif: 'croches', lookAhead: 0.02 });
        check(etroit.avanceMinMs < court.avanceMinMs / 2,
            `NEUTRALISATION : marge ramenée à 20 ms, l'avance la plus juste retombe de ${court.avanceMinMs} `
            + `à ${etroit.avanceMinMs} ms — la vérification 2 mesure bien ce que cette marge gouverne`);
        check(etroit.pireEcartMs < 1,
            `et les instants DEMANDÉS restent justes (${etroit.pireEcartMs} ms) : le défaut n'a jamais été `
            + 'dans le calcul du rythme, seulement dans le moment où on le livre');

        // --- 7. NEUTRALISATION : la tête de lecture redessine à nouveau toute la page -----------
        const lourd = await jouerEtMesurer({ tempo: 120, motif: 'croches', mesures: 24, ms: 5000, teteRedessine: true });
        check(lourd.dessins > 20,
            `NEUTRALISATION : l'ancien mécanisme rejoué (la tête remet la page en page à chaque image) `
            + `refait ${lourd.dessins} redessins complets en 5 s contre 0 — la vérification 4 mesure bien `
            + 'ce que le calque de la tête a supprimé');
        check(lourd.coutMoyenTeteMs > 5,
            `et chaque image y coûte ${lourd.coutMoyenTeteMs} ms au lieu de ${court.coutMoyenTeteMs} : `
            + 'c\'est ce temps-là qui manquait à l\'horloge pour livrer les notes à l\'heure');

        check(Object.values(mesures).every(r => r.erreurs === 0),
            'aucune erreur de console pendant les lectures');
    } catch (e) {
        check(false, 'le banc s\'est terminé sans exception : ' + e.message);
    } finally {
        process.exit(bilan());
    }
})();
