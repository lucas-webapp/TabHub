// Banc de la TONALITÉ et de la TRANSPOSITION.
//
// DEUX EXIGENCES, UNE MÊME NOTION. Retour utilisateur :
//   « Je dois obligatoirement trancher pour définir la tonalité du morceau. Pour le moment tu me
//     proposes la relative mineure ou majeure. […] Écris les notes en notation internationale CM ou
//     Cm pour do majeur ou mineur. »
//   « Je dois pouvoir transposer la tonalité du morceau demi-ton par demi-ton. La partition + la
//     tablature doivent automatiquement se transposer. Des messages d'erreur sont possibles, par
//     exemple si des notes tombent hors du manche. Dans ce cas, ces notes doivent s'afficher en
//     couleur et je dois pouvoir les redéfinir. »
//
// CE QU'IL PROTÈGE :
//   • TRANCHER. Le modèle ne portait qu'une ARMURE (un nombre d'altérations), et l'interface la
//     nommait par sa PAIRE de relatives (« Do M / La m ») : deux tonalités différentes sous une
//     seule entrée, impossible de désigner l'une plutôt que l'autre. Un champ `mode` accompagne
//     désormais l'armure, et les trente tonalités se choisissent une à une, en notation
//     internationale.
//   • TRANSPOSER. Chaque note doit se décaler du MÊME nombre de demi-tons (c'est la seule définition
//     d'une transposition), la tablature rester jouable, et la tonalité suivre — sans quoi la
//     partition afficherait les altérations de l'ancienne.
//   • ÉCHOUER PROPREMENT. Une note qu'aucune corde ne peut jouer n'est ni perdue ni silencieusement
//     déplacée : elle est marquée, affichée en rouge, et redevient normale dès qu'on lui donne une
//     case jouable.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('tonalité et transposition');

(async () => {
    plan(22);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        const r = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const th = await import('/src/model/theory.js');
            const L = await import('/src/engine/layout.js');
            const ed = window.app.editeur;
            const out = {};

            // --- 7. LES TRENTE TONALITÉS ------------------------------------------------------
            out.nbTonalites = th.TONALITES.length;
            out.noms = th.TONALITES.map(t => t.nom);
            out.doubles = out.noms.length !== new Set(out.noms).size;
            out.exemples = [[0, 'majeur'], [0, 'mineur'], [-3, 'majeur'], [-3, 'mineur'], [2, 'mineur']]
                .map(([a, md]) => th.tonaliteDe(a, md).nom);
            // Deux relatives partagent l'armure mais PAS le nom : c'est tout l'enjeu.
            const cM = th.tonaliteDe(0, 'majeur'), aMin = th.tonaliteDe(0, 'mineur');
            out.relativesMemeArmure = cM.armure === aMin.armure;
            out.relativesNomsDistincts = cM.nom !== aMin.nom;

            // Le mode se pose, s'hérite et se retrouve.
            ed.nouveau('guitare');
            out.modeParDefaut = m.modeEffectif(ed.partition, 0);
            ed.placerCurseur(0, 0, 0);
            ed.definirTonalite(-3, 'mineur');
            out.apresChoix = { armure: ed.partition.mesures[0].armure, mode: ed.partition.mesures[0].mode };
            out.modeHerite = m.modeEffectif(ed.partition, 3);       // mesure 3 : rien de posé, hérite
            out.armureHeritee = m.armureEffective(ed.partition, 3);
            out.nomChoisi = th.tonaliteDe(m.armureEffective(ed.partition, 3), m.modeEffectif(ed.partition, 3)).nom;

            // Les altérations sont RÉELLEMENT dessinées pour l'armure choisie.
            const G = await import('/src/engine/glyphs.js');
            const pg = L.mettreEnPage(ed.partition, { largeurPage: 900, S: 10 });
            const bemols = pg.primitives.filter(p => p.t === 'glyphe' && p.traits === G.BEMOL);
            out.bemolsParSysteme = bemols.length / Math.max(1, pg.ancrages.systemes.length);

            // Un fichier ANTÉRIEUR au mode (armure seule) doit s'ouvrir sans mode fantôme.
            const ancien = JSON.parse(JSON.stringify(ed.partition));
            for (const mes of ancien.mesures) delete mes.mode;
            const migre = m.normaliser(ancien);
            out.modeApresMigration = m.modeEffectif(migre, 0);

            // --- 8. TRANSPOSER ------------------------------------------------------------------
            const poser = () => {
                ed.nouveau('guitare');
                ed.partition.mesures[0].voix[0].evenements = [
                    m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 5)]),
                    m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 7)]),
                    m.creerEvenement({ valeur: 4 }, [m.creerNote(5, 0)]),   // corde grave À VIDE : ne peut pas descendre
                    m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 22)]),
                ];
                ed.placerCurseur(0, 0, 0);
            };
            const midis = () => ed.partition.mesures[0].voix[0].evenements
                .filter(e => e.notes.length).map(e => m.hauteurDeNote(ed.partition, e.notes[0]));
            const marquees = () => ed.partition.mesures[0].voix[0].evenements
                .flatMap(e => e.notes).filter(n => n.horsManche).length;

            poser();
            const avant = midis();
            out.bilanHaut = ed.transposerMorceau(2);
            out.ecartsHaut = midis().map((x, i) => x - avant[i]);
            out.tonaliteApresHaut = th.tonaliteDe(ed.partition.mesures[0].armure, ed.partition.mesures[0].mode).nom;

            // Vers le bas, au-delà de ce que la corde grave peut donner.
            poser();
            out.bilanBas = ed.transposerMorceau(-3);
            out.marqueesBas = marquees();
            out.erreurBas = ed.derniereErreur;
            // La note marquée est-elle dessinée EN COULEUR ?
            const pgBas = L.mettreEnPage(ed.partition, { largeurPage: 900, S: 10 });
            out.chiffresEnCouleur = pgBas.primitives.filter(p => p.t === 'texte' && p.couleur === 'horsManche').length;

            // …et redéfinissable : poser une case dessus efface la marque.
            ed.placerCurseur(0, 2, 5);
            ed.saisirChiffre(3);
            out.marqueesApresCorrection = marquees();

            // Aller-retour : +5 puis -5 doit rendre EXACTEMENT le morceau de départ.
            poser();
            const depart = JSON.stringify(midis());
            ed.transposerMorceau(5);
            ed.transposerMorceau(-5);
            out.allerRetourIdentique = JSON.stringify(midis()) === depart;
            out.tonaliteAllerRetour = th.tonaliteDe(ed.partition.mesures[0].armure, ed.partition.mesures[0].mode).nom;

            // Douze demi-tons : le tour complet du cycle des quintes, orthographes les plus simples.
            ed.nouveau('guitare');
            const cycle = [];
            for (let i = 0; i < 12; i++) { ed.transposerMorceau(1); cycle.push(th.tonaliteDe(ed.partition.mesures[0].armure, ed.partition.mesures[0].mode).nom); }
            out.cycle = cycle;

            // Le mode SURVIT à la transposition : transposer un mineur donne un mineur.
            ed.nouveau('guitare');
            ed.placerCurseur(0, 0, 0);
            ed.definirTonalite(0, 'mineur');
            ed.transposerMorceau(3);
            out.tonaliteMineureTransposee = th.tonaliteDe(ed.partition.mesures[0].armure, ed.partition.mesures[0].mode).nom;

            // Une transposition de zéro ne touche à rien (et ne pose pas d'entrée d'annulation vide).
            poser();
            const avantZero = JSON.stringify(ed.partition);
            out.bilanZero = ed.transposerMorceau(0);
            out.zeroInchange = JSON.stringify(ed.partition) === avantZero;
            return out;
        });

        // --- 7. Trancher ---------------------------------------------------------------------
        exiger(r.nbTonalites === 30, `les trente tonalités sont listées (15 armures × 2 modes), ${r.nbTonalites} trouvées`);
        check(!r.doubles, 'et portent trente noms DISTINCTS — aucune paire de relatives confondue sous un même libellé');
        check(r.exemples.join(',') === 'CM,Am,E♭M,Cm,Bm',
            `en notation internationale, comme demandé : ${r.exemples.join(', ')}`);
        check(r.relativesMemeArmure && r.relativesNomsDistincts,
            'do majeur et la mineur partagent bien l\'armure (c\'est leur définition) mais se nomment différemment — le point même du correctif');
        check(r.modeParDefaut === 'majeur', 'une partition neuve part en majeur, explicitement');
        exiger(r.apresChoix.armure === -3 && r.apresChoix.mode === 'mineur', 'choisir « Cm » pose bien l\'armure ET le mode');
        check(r.modeHerite === 'mineur' && r.armureHeritee === -3, 'et les deux s\'héritent dans les mesures suivantes, comme la signature');
        check(r.nomChoisi === 'Cm', 'la tonalité en vigueur plus loin dans le morceau se relit donc « Cm »');
        check(r.bemolsParSysteme === 3, `les trois bémols de Cm sont RÉELLEMENT dessinés à la clé (${r.bemolsParSysteme} par système)`);
        check(r.modeApresMigration === 'majeur',
            'un fichier antérieur au mode (armure seule) s\'ouvre en MAJEUR — l\'interprétation d\'usage d\'une armure sans autre précision');

        // --- 8. Transposer -------------------------------------------------------------------
        exiger(r.ecartsHaut.every(e => e === 2),
            `+2 demi-tons décale TOUTES les notes d'exactement 2 demi-tons (écarts : ${r.ecartsHaut.join(', ')})`);
        check(r.bilanHaut.horsManche === 0, 'sans qu\'aucune note ne sorte du manche dans ce sens');
        check(r.tonaliteApresHaut === 'DM', 'et la tonalité suit : CM transposé de 2 demi-tons donne DM');

        exiger(r.bilanBas.horsManche === 1,
            'vers le bas, la corde grave À VIDE ne peut pas descendre : exactement une note hors du manche');
        check(r.marqueesBas === 1, 'elle est MARQUÉE dans le modèle, pas perdue ni déplacée en douce');
        check(/hors du manche/.test(r.erreurBas || ''), 'et un message le dit clairement plutôt que de laisser deviner');
        check(r.chiffresEnCouleur === 1, 'le chiffre de tablature correspondant est bien dessiné EN COULEUR');
        check(r.marqueesApresCorrection === 0, 'lui redonner une case efface la marque : la note est réellement REDÉFINISSABLE');

        check(r.allerRetourIdentique && r.tonaliteAllerRetour === 'CM',
            'aller-retour +5 puis −5 : hauteurs ET tonalité reviennent exactement au point de départ');
        check(r.cycle.join(',') === 'D♭M,DM,E♭M,EM,FM,F♯M,GM,A♭M,AM,B♭M,BM,CM',
            `douze demi-tons parcourent le cycle et reviennent à CM, dans l'orthographe la moins chargée en altérations (${r.cycle.join(' ')})`);
        check(r.tonaliteMineureTransposee === 'Cm', 'transposer un morceau MINEUR le laisse mineur (Am + 3 demi-tons = Cm)');
        check(r.bilanZero.transposees === 0 && r.zeroInchange, 'transposer de zéro ne touche à rien');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
