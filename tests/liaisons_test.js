// Banc des LIAISONS QUI FRANCHISSENT UNE BARRE DE MESURE.
//
// CE QU'IL PROTÈGE. Une note liée à la première note de la mesure suivante — écriture ordinaire, et
// souvent la seule juste — s'ENTENDAIT correctement mais ne se VOYAIT pas : `poserLiaisons` travaille
// sur les poses d'UNE mesure et s'arrête à `length - 1`. Mesuré : une liaison interne rendait 2
// primitives de courbe, une liaison par-dessus la barre en rendait 0. Le séquenceur rythmique sait
// désormais écrire ce cas couramment, ce qui rendait le trou visible tous les jours.
//
// ET SURTOUT LE PIÈGE QUI A COÛTÉ UNE PREMIÈRE VERSION, qui est la raison d'être de ce banc. Cette
// version-là posait les arcs dans une passe finale, APRÈS tous les systèmes. Elle les émettait
// vraiment — je les ai comptés dans `page.primitives` et le compte était juste — et pourtant AUCUN
// n'arrivait à l'écran. Les deux rendus ne dessinent pas le tableau entier : ils le DÉCOUPENT par
// système (`ancrages.systemes[].debutPrimitives/finPrimitives`, voir render/svg.js et io/pdf.js),
// pour ne peindre que les lignes visibles et pour paginer. Tout ce qui est ajouté après la dernière
// tranche n'appartient à aucune et disparaît. Compter les primitives du tableau ne prouvait donc
// RIEN. Chaque vérification ci-dessous compte ce que les tranches contiennent, jamais le tableau.
//
// AUCUN NAVIGATEUR : tout ce qui suit est du modèle et du moteur purs, chargés en module ES.

const creerHarnais = require('./_harness.js');
const { check, exiger, plan, bilan } = creerHarnais('liaisons entre mesures');

(async () => {
    plan(16);
    try {
        const S = await import('../src/model/score.js');
        const { mettreEnPage } = await import('../src/engine/layout.js');

        const ev = (valeur, frette, lien, corde = 2) => S.creerEvenement(
            { valeur, points: 0, nolet: null },
            [S.creerNote(corde, frette, lien ? { lien } : {})], {});
        const partition = (mesures, instrument = 'guitare') => {
            const p = S.creerPartition(instrument);
            p.mesures = mesures.map(evs => S.creerMesure({ voix: [{ evenements: evs }] }));
            p.mesures[0].signature = { battements: 4, unite: 4 };
            return S.normaliser(p);
        };

        /** CE QUE LES RENDUS DESSINENT VRAIMENT : la concaténation des tranches de système, et non
         *  `page.primitives`. Voir l'en-tête — c'est toute la leçon de ce banc. */
        const rendu = (p, opts = {}) => {
            const page = mettreEnPage(p, {
                S: 10, largeurPage: 1200, yDepart: 4, mesuresParLigne: 0, avertirErreurs: false, ...opts,
            });
            const tranches = page.ancrages.systemes.map(s => page.primitives.slice(s.debutPrimitives, s.finPrimitives));
            const vues = tranches.flat();
            return {
                page,
                systemes: page.ancrages.systemes,
                arcsDuTableau: page.primitives.filter(x => x.t === 'courbe').length,
                arcs: vues.filter(x => x.t === 'courbe'),
                arcsParSysteme: tranches.map(t => t.filter(x => x.t === 'courbe').length),
                etiquettes: vues.filter(x => x.t === 'texte' && ['H', 'P', 'sl.'].includes(x.s)).map(x => x.s),
                tetes: vues.filter(x => x.t === 'glyphe' && /^tete/.test(x.nom || '')),
                barres: vues.filter(x => x.t === 'ligne' && Math.abs(x.x1 - x.x2) < 0.01),
            };
        };

        // =====================================================================================
        // A. LE CAS DE RÉFÉRENCE — une liaison DANS une mesure, qui marchait déjà
        // =====================================================================================
        const interne = rendu(partition([[ev(2, 5, 'tie'), ev(2, 5, false)]]));
        exiger(interne.arcs.length === 2,
            `préalable : une liaison interne trace DEUX arcs, un par surface (${interne.arcs.length})`);
        check(interne.arcsDuTableau === interne.arcs.length,
            'et tous ses arcs vivent DANS une tranche de système — ce qui est vrai de tout ce que le '
            + 'moteur posait avant, et que la suite ne doit pas cesser d\'être');

        // =====================================================================================
        // B. LA LIAISON PAR-DESSUS LA BARRE, LES DEUX MESURES SUR LA MÊME LIGNE
        // Un seul arc par surface, qui enjambe la barre.
        // =====================================================================================
        const aCheval = partition([
            [ev(2, 5, false), ev(2, 7, 'tie')],
            [ev(2, 7, false), ev(2, 5, false)],
        ]);
        const meme = rendu(aCheval, { mesuresParLigne: 2 });
        check(meme.arcs.length === 2,
            `une liaison par-dessus la barre trace DEUX arcs (${meme.arcs.length}) — elle n'en traçait `
            + 'AUCUN, le son étant juste et le signe absent');
        check(meme.arcsDuTableau === 2 && meme.arcsParSysteme.join(',') === '2',
            `et ils sont DANS la tranche du système (${meme.arcsParSysteme.join(', ')} sur `
            + `${meme.arcsDuTableau} au tableau) : une passe posée après tous les systèmes les émettait `
            + 'bien et n\'en dessinait aucun');
        exiger(meme.systemes.length === 1, 'préalable : les deux mesures sont bien sur une seule ligne');

        // L'ARC ENJAMBE VRAIMENT LA BARRE : il part de la note de la mesure 1 et arrive à celle de la
        // mesure 2, donc il traverse le trait vertical qui les sépare.
        // LE GARDE-FOU N'EST PAS DÉCORATIF : sans lui, ce contrôle LANÇAIT une exception dès qu'il
        // n'y avait aucun arc — et c'est exactement l'état que les neutralisations produisent, donc
        // le banc s'arrêtait là au lieu de rapporter les dix vérifications suivantes. Un banc doit
        // rendre un échec NOMMÉ, jamais une pile d'appels.
        const bornes = (arc) => {
            const n = (arc?.d || '').match(/-?[\d.]+/g)?.map(Number) || [];
            return n.length >= 4 ? { x1: n[0], x2: n[n.length - 2] } : null;
        };
        const surPortee = meme.arcs.map(bornes).filter(Boolean).sort((a, b) => a.x1 - b.x1)[0];
        const xBarres = meme.barres.map(b => b.x1).sort((a, b) => a - b);
        const barreEntre = !!surPortee && xBarres.some(x => x > surPortee.x1 && x < surPortee.x2);
        check(barreEntre,
            surPortee
                ? `l'arc traverse bien une barre de mesure : il court de ${Math.round(surPortee.x1)} à `
                  + `${Math.round(surPortee.x2)}, et une barre passe entre les deux`
                : 'l\'arc traverse bien une barre de mesure — AUCUN arc tracé, rien à mesurer');

        // =====================================================================================
        // C. LE SAUT DE LIGNE — deux demi-arcs, chacun dans SON système
        // Un arc unique traverserait la page de part en part, ce qu'aucune édition ne fait.
        // =====================================================================================
        const coupe = rendu(aCheval, { mesuresParLigne: 1 });
        exiger(coupe.systemes.length === 2, `préalable : une mesure par ligne fait deux systèmes (${coupe.systemes.length})`);
        check(coupe.arcs.length === 4,
            `coupée par un saut de ligne, la liaison devient QUATRE demi-arcs (${coupe.arcs.length}) — `
            + 'deux par surface, un départ et une arrivée');
        check(coupe.arcsParSysteme.join(',') === '2,2',
            `et chaque moitié est dans SA tranche (${coupe.arcsParSysteme.join(' puis ')}) : le départ `
            + 'avec la ligne qui part, l\'arrivée avec celle qui arrive — sinon une page imprimée ou '
            + 'un écran qui ne montre qu\'une ligne en perdrait la moitié');

        // Chaque demi-arc reste DANS son système : jamais dans la marge, jamais par-dessus la clé.
        const debordent = coupe.systemes.flatMap((sys, i) => {
            const t = coupe.page.primitives.slice(sys.debutPrimitives, sys.finPrimitives)
                .filter(x => x.t === 'courbe').map(bornes);
            return t.filter(a => a.x1 < sys.xDebut - 1 || a.x2 > sys.xFin + 1).map(a => `système ${i}`);
        });
        check(debordent.length === 0,
            'aucun demi-arc ne sort des bornes de son système'
            + (debordent.length ? ` — ${debordent.join(', ')}` : ''));

        // =====================================================================================
        // D. LES GARDE-FOUS — ce qui ne doit RIEN tracer
        // =====================================================================================
        const autreCorde = rendu(partition([
            [ev(2, 5, false), ev(2, 7, 'tie', 2)],
            [ev(2, 7, false, 3), ev(2, 5, false)],
        ]), { mesuresParLigne: 2 });
        check(autreCorde.arcs.length === 0,
            `une liaison dont la note suivante est sur une AUTRE corde ne trace rien `
            + `(${autreCorde.arcs.length}) — c'est l'appariement par corde, le même qu'à l'intérieur `
            + 'd\'une mesure');

        const sansSuite = rendu(partition([[ev(2, 5, false), ev(2, 7, 'tie')]]), {});
        check(sansSuite.arcs.length === 0,
            `une liaison sur la DERNIÈRE note du morceau ne trace rien (${sansSuite.arcs.length}) : `
            + 'il n\'y a pas de seconde note à relier');

        const nonLiee = rendu(partition([
            [ev(2, 5, false), ev(2, 7, false)],
            [ev(2, 7, false), ev(2, 5, false)],
        ]), { mesuresParLigne: 2 });
        check(nonLiee.arcs.length === 0,
            `deux mesures sans aucune liaison ne tracent aucun arc (${nonLiee.arcs.length}) — le `
            + 'report ne fabrique pas de signe là où le modèle n\'en demande pas');

        // =====================================================================================
        // E. LES ÉTIQUETTES — chaque surface porte les siennes, et une seule fois
        // « H »/« P » sont une notation de TABLATURE ; « sl. » est une indication de jeu.
        // =====================================================================================
        const hammer = partition([
            [ev(2, 5, false), ev(2, 7, 'hammer')],
            [ev(2, 9, false), ev(2, 5, false)],
        ]);
        const hMeme = rendu(hammer, { mesuresParLigne: 2 });
        check(hMeme.etiquettes.join(',') === 'H',
            `un hammer-on par-dessus la barre écrit UN seul « H », sur la tablature `
            + `(${hMeme.etiquettes.join(', ') || 'aucune'}) — jamais au-dessus de la portée, où TabHub `
            + 'n\'en met nulle part ailleurs');
        const hCoupe = rendu(hammer, { mesuresParLigne: 1 });
        check(hCoupe.etiquettes.join(',') === 'H',
            `et coupé par un saut de ligne il n'en écrit pas DEUX (${hCoupe.etiquettes.join(', ')}) : `
            + 'l\'étiquette va au DÉPART, la répéter en début de ligne se lirait comme un second geste');

        const slide = rendu(partition([
            [ev(2, 5, false), ev(2, 7, 'slide')],
            [ev(2, 9, false), ev(2, 5, false)],
        ]), { mesuresParLigne: 1 });
        check(slide.etiquettes.filter(x => x === 'sl.').length === 2,
            `un slide coupé par un saut de ligne écrit « sl. » sur CHAQUE surface `
            + `(${slide.etiquettes.join(', ')}) — portée et tablature, une fois chacune`);

        // =====================================================================================
        // F. LE PIANO PASSE PAR LE MÊME REPORT, sans tablature
        // =====================================================================================
        const auPiano = S.creerPartition('piano');
        auPiano.mesures = [
            S.creerMesure({ voix: [{ evenements: [
                S.creerEvenement({ valeur: 2 }, [S.creerNote(0, 0, { hauteurVoulue: 60 })], {}),
                S.creerEvenement({ valeur: 2 }, [S.creerNote(0, 0, { hauteurVoulue: 60, lien: 'tie' })], {}),
            ] }] }),
            S.creerMesure({ voix: [{ evenements: [
                S.creerEvenement({ valeur: 2 }, [S.creerNote(0, 0, { hauteurVoulue: 60 })], {}),
                S.creerEvenement({ valeur: 2 }, [S.creerNote(0, 0, { hauteurVoulue: 60 })], {}),
            ] }] }),
        ];
        auPiano.mesures[0].signature = { battements: 4, unite: 4 };
        const piano = rendu(S.normaliser(auPiano), { mesuresParLigne: 2 });
        check(piano.arcs.length === 1 && piano.arcsDuTableau === 1,
            `au piano, la liaison par-dessus la barre trace UN arc — un grand-portée n'a pas de `
            + `tablature — et il est dans la tranche du système (${piano.arcs.length} vu, `
            + `${piano.arcsDuTableau} au tableau)`);

        check(true, 'toutes les vérifications se sont exécutées sans exception');
    } catch (err) {
        check(false, 'le banc s\'est arrêté sur une exception — ' + (err && err.message));
        console.error(err);
    }
    bilan();
})();
