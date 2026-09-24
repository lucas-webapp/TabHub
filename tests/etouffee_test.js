// Banc de LA NOTE ÉTOUFFÉE et de LA MESURE ENDETTÉE QUI RESPIRE — deux retours utilisateur, capture
// d'écran à l'appui, sur la même mesure d'un morceau réel.
//
// 1. « LES GHOSTNOTES SONNENT MAL, je veux un son neutre et étouffé comme c'est le cas en guitare et
//    basse. » Elles n'avaient pas de voix : on jouait la MÊME note, simplement à 35 % de vélocité.
//    Une note fantôme devenait donc une note ordinaire jouée doucement — avec sa hauteur, donc son
//    harmonie. Or c'est exactement ce qu'une étouffée n'est PAS : la main gauche assourdit la corde,
//    le médiator la frappe quand même, il en sort un bruit sec SANS hauteur. Jouée en douceur, la
//    hauteur restait là et venait polluer l'accord qu'elle est censée ne pas toucher.
//
// 2. « L'ESPACEMENT ENTRE CROCHES EST TROP PETIT » sur la deuxième mesure. Celle-ci portait une
//    dette (« +2 ♩ » gravé en rouge au-dessus) : six temps de musique dans une mesure qui en accorde
//    quatre. La gravure les tassait dans la largeur de quatre, et pire : `repartirParTemps` range
//    chaque colonne dans SON temps et rabat tout ce qui dépasse sur le dernier, si bien que la
//    totalité du débordement s'empilait sur un seul temps. Mesuré sur la mesure de la capture : les
//    six croches recevaient 8 px chacune quand leurs voisines en avaient 30 à 40.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('note étouffée, mesure endettée');

(async () => {
    plan(20);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // ── 1. LA NOTE ÉTOUFFÉE A SA PROPRE VOIX ────────────────────────────────────────────────
        const son = await page.evaluate(async () => {
            const ed = window.app.editeur;
            ed.nouveau('basse');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 0, 0); ed.saisirChiffre(3);
            ed.placerCurseur(0, 1, 0, 0); ed.saisirChiffre(5);
            // La seconde devient une note fantôme.
            ed.placerCurseur(0, 1, 0, 0); ed.basculerGhost();
            await window.app.lecteur.demarrer();
            window.app.lecteur.programmer(ed.partition);
            const evts = window.app.lecteur._evenements.map(e => ({
                debut: e.debut, etouffee: !!e.etouffee, note: e.note, midi: e.midi,
            }));
            return { evts, aUneVoix: !!window.app.lecteur.voixEtouffee,
                     aUnFiltre: !!window.app.lecteur._filtreEtouffee,
                     bruit: window.app.lecteur.voixEtouffee?.noise?.type,
                     typeFiltre: window.app.lecteur._filtreEtouffee?.type,
                     aUnCorps: !!window.app.lecteur._corpsEtouffee,
                     oscCorps: window.app.lecteur._corpsEtouffee?.oscillator?.type };
        });

        exiger(son.evts.length === 2, `préalable : deux notes programmées (${son.evts.length})`);
        check(son.evts[0].etouffee === false && typeof son.evts[0].note === 'string',
            `la note ORDINAIRE garde sa hauteur (${son.evts[0].note})`);
        check(son.evts[1].etouffee === true && son.evts[1].note === null,
            'la note FANTÔME n\'a plus de hauteur à jouer du tout : elle part vers une autre voix, et '
            + 'son champ `note` est nul — avant, c\'était la même note à 35 % de vélocité, donc une '
            + 'hauteur bien présente qui polluait l\'harmonie qu\'elle est censée ne pas toucher');
        check(Number.isFinite(son.evts[1].midi),
            `mais elle emporte sa hauteur SOUS LE NOM \`midi\` (${son.evts[1].midi}) — elle ne sert qu'à `
            + 'placer le filtre : une étouffée sur le mi grave est un coup SOURD, la même sur la '
            + 'chanterelle est un CLIC, et c\'est la corde qui décide, comme sur l\'instrument');
        check(son.aUneVoix && son.bruit === 'pink',
            `la voix étouffée est un BRUIT rose (${son.bruit}), pas une onde : un bruit filtré n'a aucune `
            + 'fondamentale à entendre, et le rose décroît avec la fréquence comme le corps de '
            + 'l\'instrument (un bruit blanc sifflerait, il sonnerait comme un charleston)');
        check(son.aUnFiltre && son.typeFiltre === 'lowpass',
            `à travers un PASSE-BAS large (${son.typeFiltre}) dont la coupure suit la corde — et surtout `
            + 'pas un passe-bande étroit : un percussif est large bande par nature, et un Q serré en jette '
            + 'presque toute l\'énergie (c\'est ce qui rendait la première version inaudible)');
        check(son.aUnCorps && son.oscCorps === 'sine',
            `sous le bruit, le CORPS de l'instrument (${son.oscCorps}) : une sinusoïde brève et grave, `
            + 'bornée à 55–110 Hz. C\'est elle qui fait la différence entre un « chick » d\'instrument et '
            + 'un souffle — et la borner l\'empêche de ramener sur les aiguës la hauteur qu\'on vient de '
            + 'faire taire');

        // UN ACCORD D'ÉTOUFFÉES NE FAIT QU'UN SEUL COUP.
        const accord = await page.evaluate(async () => {
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            // On part de la corde 2 pour MONTER vers la 0 : `resterSurLeTemps(-1)` depuis la corde 0
            // ne mène nulle part (c'est déjà la plus aiguë) et réécrit la même case.
            ed.placerCurseur(0, 0, 2, 0); ed.saisirChiffre(0);
            ed.resterSurLeTemps(-1); ed.saisirChiffre(2);
            ed.resterSurLeTemps(-1); ed.saisirChiffre(2);
            const evt = ed.partition.mesures[0].voix[0].evenements[0];
            evt.notes.forEach(n => { n.ghost = true; });
            window.app.lecteur.programmer(ed.partition);
            const surLeTemps = window.app.lecteur._evenements.filter(e => e.debut === 0);
            return { notesDansLAccord: evt.notes.length, coups: surLeTemps.length,
                     tousEtouffes: surLeTemps.every(e => e.etouffee) };
        });
        exiger(accord.notesDansLAccord === 3, `préalable : trois cases étouffées sur le même temps (${accord.notesDansLAccord})`);
        check(accord.coups === 1 && accord.tousEtouffes,
            `un balayage de trois cordes assourdies fait UN « chick » (${accord.coups} coup), pas trois : `
            + 'c\'est même à ça qu\'on le reconnaît, et trois bruits superposés au même instant '
            + 'donneraient une bouillie bien plus forte que la note voisine');

        // L'APERÇU À LA FRAPPE dit la vérité, lui aussi.
        const apercu = await page.evaluate(async () => {
            const src = window.app.lecteur.constructor.prototype.apercu.toString();
            let leve = null;
            try { window.app.lecteur.apercu(45, 0.7, { etouffee: true }); } catch (e) { leve = e.message; }
            return { branche: /etouffee/.test(src), leve };
        });
        check(apercu.branche && apercu.leve === null,
            'taper une note fantôme rend le bruit sec qu\'elle fera à la lecture, et non la note qu\'elle '
            + `n'est pas (${apercu.leve || 'aucune exception'}) — un aperçu n'a pas d'instant programmé, `
            + 'et le filtre doit s\'accommoder de « maintenant »');

        // ── 1bis. ET ON L'ENTEND — mesuré sur la sortie VIVANTE ─────────────────────────────────
        //
        // LA VÉRIFICATION QUI MANQUAIT, et c'est toute la leçon de ce banc. La première version de
        // cette voix était juste sur le papier — bruit rose, filtre qui suit la corde, tout ce que
        // décrit un dead note — et INAUDIBLE en pratique (retour utilisateur : « on n'entend plus du
        // tout les ghostnotes »). Rendue hors ligne et mesurée : 0,002 de valeur efficace contre 0,14
        // pour une note ordinaire, 36 dB en dessous. Aucune vérification de FORME ne pouvait l'attraper,
        // puisque la forme était bonne. Seule une mesure du NIVEAU le pouvait.
        //
        // On branche donc un mètre sur la sortie réelle du lecteur, et non sur une copie de sa
        // configuration reconstruite ici : c'est ce que produit l'application qu'on veut juger.
        const niveau = await page.evaluate(async () => {
            const T = window.Tone;
            const L = window.app.lecteur;
            await L.demarrer();
            const creteDe = async (declencher, ms = 260) => {
                const m = new T.Meter({ normalRange: true, smoothing: 0 });
                T.getDestination().connect(m);
                await new Promise(r => setTimeout(r, 30));
                declencher();
                let crete = 0;
                const t0 = Date.now();
                while (Date.now() - t0 < ms) {
                    const v = m.getValue(); if (v > crete) crete = v;
                    await new Promise(r => setTimeout(r, 4));
                }
                T.getDestination().disconnect(m); m.dispose();
                return crete;
            };
            const etouffee = await creteDe(() => L.apercu(45, 0.8, { etouffee: true }));
            await new Promise(r => setTimeout(r, 200));
            const normale = await creteDe(() => L.apercu(45, 0.8));
            await new Promise(r => setTimeout(r, 200));
            const rien = await creteDe(() => {});
            return { etouffee: +etouffee.toFixed(4), normale: +normale.toFixed(4), rien: +rien.toFixed(4) };
        });
        exiger(niveau.normale > 0.05, `préalable : une note ordinaire se mesure bien (crête ${niveau.normale})`);
        check(niveau.etouffee > niveau.rien * 5 && niveau.etouffee > 0.05,
            `ON ENTEND l'étouffée : crête ${niveau.etouffee} sur la sortie vivante, contre ${niveau.rien} `
            + 'quand rien ne joue — la version précédente sortait 36 dB sous une note ordinaire, et aucune '
            + 'vérification de FORME ne pouvait l\'attraper puisque la forme était bonne');
        check(niveau.etouffee > niveau.normale * 0.5,
            `et elle FRAPPE aussi fort qu'une note (${niveau.etouffee} contre ${niveau.normale}) : c'est le `
            + 'profil d\'un percussif — il tape autant, il ne TIENT pas. Sur un riff de funk ou de basse, '
            + 'les étouffées portent le groove autant que les notes');

        // ── 2. LA MESURE ENDETTÉE RESPIRE ───────────────────────────────────────────────────────
        const gravure = await page.evaluate(async () => {
            const S = await import('/src/model/score.js');
            const { mettreEnPage } = await import('/src/engine/layout.js');
            const D = (v) => ({ valeur: v, points: 0, nolet: null });
            const ed = window.app.editeur;
            ed.nouveau('basse');
            // La mesure de la capture : ♩silence ♪silence ♪note ♩silence, puis SIX croches.
            ed.partition.mesures[1].voix[0].evenements = [
                S.creerEvenement(D(4), [], { silence: true }),
                S.creerEvenement(D(8), [], { silence: true }),
                S.creerEvenement(D(8), [S.creerNote(2, 3)]),
                S.creerEvenement(D(4), [], { silence: true }),
                ...[1, 2, 3, 2, 2, 0].map(f => S.creerEvenement(D(8), [S.creerNote(3, f)])),
            ];
            const p = mettreEnPage(ed.partition, { S: 10, largeurPage: 1400, mesuresParLigne: 4 });
            const a = p.ancrages.mesures;
            const m2 = a[1];
            const xs = [...new Set(p.primitives.filter(z => z.t === 'glyphe' && z.x > m2.x + 2 && z.x < m2.xFin
                && /tete|silence/i.test(z.nom)).map(z => Math.round(z.x - m2.x)))].sort((u, v) => u - v);
            const ecarts = []; for (let i = 1; i < xs.length; i++) ecarts.push(xs[i] - xs[i - 1]);
            return {
                dette: ed.ecartMesure(1, 0), ecrit: S.longueurMesure(ed.partition, 1),
                capacite: S.capaciteMesure(ed.partition, 1),
                largeurs: a.map(z => Math.round(z.xFin - z.x)),
                plusPetitEcart: Math.min(...ecarts), ecarts,
            };
        });

        exiger(gravure.dette === 2 && gravure.ecrit === 6 && gravure.capacite === 4,
            `préalable : la mesure porte bien six temps pour une capacité de quatre (dette ${gravure.dette} ♩)`);
        check(gravure.largeurs[1] > gravure.largeurs[2] * 1.4,
            `elle se grave PLUS LARGE que ses voisines (${gravure.largeurs[1]} px contre `
            + `${gravure.largeurs[2]}) : elle est réellement plus longue, et l'y tasser rendait `
            + 'illisible exactement la mesure qu\'on est en train de corriger');
        check(gravure.plusPetitEcart >= 20,
            `et ses six croches finales ont de quoi respirer (${gravure.plusPetitEcart} px au plus serré, `
            + `contre 8 avant) — écarts mesurés : ${gravure.ecarts.join(' ')}`);
        check(gravure.largeurs[0] !== gravure.largeurs[2] || gravure.largeurs[2] === gravure.largeurs[3],
            `les mesures JUSTES ne bougent pas entre elles (${gravure.largeurs[2]} et ${gravure.largeurs[3]} px) : `
            + 'la règle « largeur fixée par la signature, jamais par le contenu » vaut toujours pour '
            + 'elles, qui sont l\'immense majorité');

        // ── NEUTRALISATION : on regrave la même mesure à sa seule CAPACITÉ ──────────────────────
        const neutre = await page.evaluate(async () => {
            const S = await import('/src/model/score.js');
            // L'ancienne règle, rejouée à la main : la largeur venait de la capacité seule, et
            // `repartirParTemps` rabattait sur le dernier temps tout ce qui dépassait.
            const capacite = 4, nTemps = 4, unite = 1;
            const debuts = [0, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5];
            const parTemps = new Array(nTemps).fill(0);
            for (const d of debuts) parTemps[Math.min(nTemps - 1, Math.floor(d / unite))]++;
            return { capacite, surLeDernier: parTemps[nTemps - 1], repartition: parTemps };
        });
        check(neutre.surLeDernier === 6,
            `neutralisation : à la seule capacité, SIX colonnes sur dix se retrouvaient rabattues sur le `
            + `dernier temps (${neutre.repartition.join(' ')}) — ce n'était pas un espacement un peu `
            + 'juste, c\'était tout le débordement empilé sur un quart de la mesure');

        // ── NEUTRALISATION DU SON : l'ancienne construction, rejouée et mesurée ─────────────────
        const ancien = await page.evaluate(async () => {
            const T = window.Tone;
            const mesurer = async (monter) => {
                const buf = await T.Offline(() => monter(), 0.5);
                const d = buf.getChannelData(0); let s = 0;
                for (let i = 0; i < d.length; i++) s += d[i] * d[i];
                return +Math.sqrt(s / d.length).toFixed(5);
            };
            const hz = 110;
            // CE QU'ON AVAIT : bruit rose -> passe-bande Q 1,6 centré à 1,4 × la corde, puis -7 dB.
            const avant = await mesurer(() => {
                const f = new T.Filter({ type: 'bandpass', frequency: hz * 1.4, Q: 1.6 });
                const n = new T.NoiseSynth({ noise: { type: 'pink' },
                    envelope: { attack: 0.001, decay: 0.085, sustain: 0, release: 0.02 } });
                n.chain(f, new T.Volume(-7), T.getDestination());
                n.triggerAttackRelease(0.06, 0.01, 0.7);
            });
            // CE QU'ON A : passe-bas large + corps, aux niveaux figés dans player.js.
            const apres = await mesurer(() => {
                const lp = new T.Filter({ type: 'lowpass', frequency: Math.max(450, Math.min(3500, hz * 8)), Q: 0.7 });
                const n = new T.NoiseSynth({ noise: { type: 'pink' },
                    envelope: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.02 } });
                n.chain(lp, new T.Volume(0), T.getDestination());
                n.triggerAttackRelease(0.06, 0.01, 0.8);
                const c = new T.Synth({ oscillator: { type: 'sine' },
                    envelope: { attack: 0.001, decay: 0.055, sustain: 0, release: 0.02 } });
                c.chain(new T.Volume(-6), T.getDestination());
                c.triggerAttackRelease(Math.max(55, Math.min(110, hz)), 0.045, 0.01, 0.76);
            });
            return { avant, apres, gain: +(apres / avant).toFixed(1) };
        });
        check(ancien.gain > 8,
            `neutralisation : la construction précédente rendue côte à côte avec celle-ci sort ${ancien.gain}× `
            + `plus bas (${ancien.avant} contre ${ancien.apres} de valeur efficace) — le passe-bande étroit `
            + 'jetait presque toute l\'énergie du bruit, et les 7 dB de retrait finissaient le travail');

        check(erreurs.length === 0, 'aucune erreur de console ni exception (' + erreurs.join(' | ') + ')');
    } catch (e) {
        check(false, 'exception pendant le banc : ' + e.message + '\n' + e.stack);
    } finally {
        await fermer();
    }
    process.exit(bilan());
})();
