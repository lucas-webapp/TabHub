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
    plan(15);
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
                     typeFiltre: window.app.lecteur._filtreEtouffee?.type };
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
        check(son.aUnFiltre && son.typeFiltre === 'bandpass',
            `à travers un passe-bande (${son.typeFiltre}) centré sur le registre de la corde`);

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

        check(erreurs.length === 0, 'aucune erreur de console ni exception (' + erreurs.join(' | ') + ')');
    } catch (e) {
        check(false, 'exception pendant le banc : ' + e.message + '\n' + e.stack);
    } finally {
        await fermer();
    }
    process.exit(bilan());
})();
