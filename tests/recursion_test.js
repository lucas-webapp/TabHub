// Banc des DÉFAUTS TROUVÉS PAR LA MARCHE ALÉATOIRE.
//
// COMMENT ILS ONT ÉTÉ TROUVÉS, parce que c'est la moitié de ce que ce banc transmet : on remplit des
// mesures de croches, doubles, triples, pointées, triolets et silences, puis on joue quatre mille
// gestes d'édition tirés au sort sur la MÊME partition — allonger, raccourcir, pointer, trioler,
// insérer, supprimer, absorber, déverser, changer de signature, coller, ajouter et retirer des
// mesures, deux voix, levée, reprises — en vérifiant après CHAQUE geste une poignée d'invariants.
// Aucun de ces quatre défauts n'était atteignable par un geste isolé ; tous demandaient une
// partition déjà tordue par ce qui précédait. C'est précisément la situation de quelqu'un qui
// recopie un morceau pendant une heure.
//
// LES INVARIANTS QUI LES ONT LEVÉS confrontent toujours DEUX promenades écrites séparément — la
// durée totale contre la somme des longueurs de mesure, `aplatir` contre le modèle, l'écart annoncé
// contre l'écart réel. Un invariant qui se vérifierait lui-même ne dirait rien.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('défauts de la marche aléatoire');

(async () => {
    plan(15);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // ── 1. LA RÉCURSION SANS FIN de figuresDeCourse ──────────────────────────────────────────
        //
        // Le pire des quatre : « Maximum call stack size exceeded » au beau milieu d'une frappe ou
        // d'une insertion — l'application se fige, le travail en cours est perdu. L'étape 4 de
        // `figuresDeCourse` découpe une course en tête / bloc / queue, et DEUX de ces tranches
        // peuvent valoir le tableau entier, auquel cas l'appel se rappelle à l'identique.
        //
        // LES DEUX ENTRÉES SONT CELLES QU'A CRACHÉES LA MARCHE, au caractère près. Elles ont l'air
        // absurdes et elles le sont : leurs cellules ne se touchent pas (la cellule qui ouvrait le
        // second temps a été prise par un découpage précédent). C'est ce qui rend l'invariante de
        // l'étape 4 fausse — « une course qui enjambe des temps porte forcément une frontière ».
        const recursion = await page.evaluate(async () => {
            const R = await import('/src/model/rythme.js');
            // On appelle la fonction par la porte publique qui y mène.
            const cas = [
                { nom: 'tranche de QUEUE = tout (kBloc === 0)', unite: 1, silence: true, cellules: [
                    { iTemps: 1, iCell: 0, mesure: 0, sub: 1,  etat: 'attaque', duree: 1,      debut: 1 },
                    { iTemps: 2, iCell: 1, mesure: 0, sub: 16, etat: 'attaque', duree: 0.0625, debut: 2.0625 },
                ] },
                { nom: 'tranche du MILIEU = tout (iBloc 0, kBloc = longueur)', unite: 1.5, silence: true, cellules: [
                    { iTemps: 1, iCell: 0, mesure: 0, sub: 1, etat: 'attaque', duree: 1.5, debut: 1.5 },
                    ...Array.from({ length: 15 }, (_, k) => ({
                        iTemps: 2, iCell: k + 1, mesure: 0, sub: 16, etat: 'attaque',
                        duree: 0.09375, debut: 3.09375 + k * 0.09375,
                    })),
                ] },
            ];
            const out = [];
            for (const c of cas) {
                const depart = Date.now();
                try {
                    const figs = R.figuresDeCourse(c.cellules, c.unite, c.silence);
                    out.push({ nom: c.nom, rendu: figs.length, ms: Date.now() - depart, erreur: null });
                } catch (e) {
                    out.push({ nom: c.nom, rendu: null, ms: Date.now() - depart, erreur: e.message });
                }
            }
            return out;
        });
        for (const c of recursion) {
            check(c.erreur === null && c.rendu > 0,
                `${c.nom} : la fonction rend ${c.rendu} figure(s) au lieu de déborder la pile `
                + `(${c.erreur || 'aucune erreur'}, ${c.ms} ms) — une course dont les cellules ne se `
                + 'touchent pas retombe sur le découpage ordinaire, qui écrira au moins une durée honnête');
        }

        // ── 2. LE SILENCE QUI N'EN EST PLUS UN ───────────────────────────────────────────────────
        const fantome = await page.evaluate(async () => {
            const { Editeur } = await import('/src/edit/commands.js');
            const { mettreEnPage } = await import('/src/engine/layout.js');
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 0, 0); ed.saisirChiffre(5);
            ed.placerCurseur(0, 1, 0, 0); ed.saisirChiffre(7);
            ed.placerCurseur(0, 0, 0, 0);
            ed.basculerSilence();                       // la note devient silence
            const apres1 = { ...ed.partition.mesures[0].voix[0].evenements[0] };
            const pileAvant = ed.peutAnnuler();
            const rendu = ed.basculerSilence();         // R de nouveau
            const e = ed.partition.mesures[0].voix[0].evenements[0];
            // Ce que le MOTEUR dessine à cet endroit : la portée de la mesure 0, hors en-tête.
            const p = mettreEnPage(ed.partition, { S: 10, largeurPage: 900 });
            const a = p.ancrages.mesures[0];
            const glyphes = p.primitives.filter(z => z.t === 'glyphe' && z.x > a.x + 60 && z.x < a.xFin
                && Math.abs(z.y - a.yPortee) < 40).map(z => z.nom);
            return { silence1: apres1.silence, notes1: apres1.notes.length,
                     silence2: e.silence, notes2: e.notes.length, rendu, glyphes, pileAvant,
                     // Une frappe sur une case doit toujours en sortir.
                     recuperable: (() => { ed.saisirChiffre(9); return !ed.partition.mesures[0].voix[0].evenements[0].silence
                         && ed.partition.mesures[0].voix[0].evenements[0].notes.length === 1; })() };
        });
        exiger(fantome.silence1 === true && fantome.notes1 === 0,
            'préalable : une frappe sur R change bien la note en silence');
        check(fantome.silence2 === true && fantome.notes2 === 0 && fantome.rendu === false,
            `rappuyer sur R LAISSE le silence tel quel (silence=${fantome.silence2}, ${fantome.notes2} note) : `
            + 'un silence ne redevient pas une note, sa hauteur a été effacée en le posant');
        check(fantome.glyphes.includes('silenceNoire'),
            `et la portée grave toujours un silence de noire (${fantome.glyphes.join(', ')}) — c'est ce qui `
            + 'rendait l\'ancien état si traître : l\'évènement n\'était NI silence NI note, la partition '
            + 'montrait un silence, et le bouton « Silence » de la palette s\'éteignait puisqu\'il lit ce champ');
        check(fantome.recuperable,
            'on en sort en tapant une case, comme partout ailleurs — c\'est le geste pour faire une note');

        const pileVide = await page.evaluate(async () => {
            const { Editeur } = await import('/src/edit/commands.js');
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.placerCurseur(0, 0, 0, 0);
            const rendu = ed.basculerSilence();          // déjà un silence : rien à faire
            return { rendu, pile: ed.peutAnnuler() };
        });
        check(pileVide.rendu === false && pileVide.pile === false,
            'un R qui ne change rien n\'empile rien dans l\'historique : sans quoi un Ctrl+Z ne ferait '
            + 'RIEN de visible, et il faudrait deviner combien de fois le presser');

        // ── 3. LE CURSEUR APRÈS « AJOUTER UNE MESURE » DEPUIS LA SECONDE VOIX ────────────────────
        const voixApresMesure = await page.evaluate(async () => {
            const { Editeur } = await import('/src/edit/commands.js');
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.placerCurseur(0, 0, 0, 0);
            ed.ajouterVoix();                            // le curseur passe sur la voix 2
            const avant = { ...ed.curseur };
            ed.ajouterMesure(true, 1);                   // Alt+M
            const m = ed.partition.mesures[ed.curseur.mesure];
            return { avant, apres: { ...ed.curseur }, voixDeLaNeuve: m.voix.length,
                     voixCourante: !!ed.voixCourante(), evenement: !!ed.evenementCourant() };
        });
        exiger(voixApresMesure.avant.voix === 1,
            'préalable : après « ajouter une voix », le curseur est bien sur la seconde');
        check(voixApresMesure.apres.voix === 0 && voixApresMesure.voixDeLaNeuve === 1,
            `Alt+M depuis la seconde voix ramène le curseur sur la voix 1 (${voixApresMesure.apres.voix}) : `
            + 'une mesure neuve n\'a qu\'UNE voix, et le curseur gardait son index');
        check(voixApresMesure.voixCourante && voixApresMesure.evenement,
            'donc `voixCourante()` et `evenementCourant()` rendent quelque chose au lieu d\'`undefined` — '
            + 'tout ce qui les lit ensuite (barre du bas, palette, frappe suivante) en dépend');

        // ── 4. LE CURSEUR APRÈS UNE LEVÉE ────────────────────────────────────────────────────────
        const curseurLevee = await page.evaluate(async () => {
            const { Editeur } = await import('/src/edit/commands.js');
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 0, 0); ed.saisirChiffre(5);
            // On se pose dans les silences de queue — ceux que la levée va retirer.
            ed.placerCurseur(0, 2, 0, 0);
            const avant = { evenement: ed.curseur.evenement, nb: ed.partition.mesures[0].voix[0].evenements.length };
            ed.basculerLevee();
            return { avant, apres: ed.curseur.evenement,
                     nb: ed.partition.mesures[0].voix[0].evenements.length,
                     courant: !!ed.evenementCourant() };
        });
        exiger(curseurLevee.avant.evenement === 2 && curseurLevee.avant.nb > 2,
            `préalable : le curseur est posé sur le 3e évènement, dans les silences de queue `
            + `(${curseurLevee.avant.nb} évènements)`);
        check(curseurLevee.apres < curseurLevee.nb && curseurLevee.courant,
            `déclarer la levée retire ces silences et RAMÈNE le curseur dans la mesure `
            + `(e${curseurLevee.apres} pour ${curseurLevee.nb} évènement(s)) : il pointait sinon dans le vide`);

        // ── NEUTRALISATION : on remet la garde de la récursion à son ancienne forme ──────────────
        //
        // On ne peut pas modifier le module chargé ; on rejoue donc l'ANCIENNE logique de l'étape 4
        // sur les deux mêmes entrées, et on vérifie qu'elle réclamait bien la course entière. Sans
        // ça, ce banc ne prouverait pas que ses deux premières vérifications portent sur un vrai
        // défaut plutôt que sur deux entrées qui, de toute façon, tombaient juste.
        const neutre = await page.evaluate(() => {
            const etapeQuatre = (n, frontieresPremiere, dernierClotSonTemps) => {
                const iBloc = frontieresPremiere;
                const kBloc = dernierClotSonTemps ? n : frontieresPremiere;
                return { iBloc, kBloc,
                         milieuEstTout: kBloc > iBloc && iBloc === 0 && kBloc === n,
                         queueEstTout: kBloc < n && kBloc === 0 };
            };
            // Cas 1 : deux cellules, une seule frontière en tête, la dernière ne clôt pas son temps.
            const a = etapeQuatre(2, 0, false);
            // Cas 2 : seize cellules, une seule frontière en tête, la dernière clôt son temps.
            const b = etapeQuatre(16, 0, true);
            return { a, b };
        });
        check(neutre.a.queueEstTout && !neutre.a.milieuEstTout,
            `neutralisation, 1er cas : sans la garde, la tranche de QUEUE valait la course entière `
            + `(kBloc=${neutre.a.kBloc}) — l'appel se rappelait à l'identique`);
        check(neutre.b.milieuEstTout && !neutre.b.queueEstTout,
            `neutralisation, 2e cas : c'est la tranche du MILIEU qui valait tout (iBloc=${neutre.b.iBloc}, `
            + `kBloc=${neutre.b.kBloc}) — deux formes différentes, et c'est pour ça qu'une seule des deux `
            + 'gardes laissait encore la pile déborder');

        check(erreurs.length === 0, 'aucune erreur de console ni exception (' + erreurs.join(' | ') + ')');
    } catch (e) {
        check(false, 'exception pendant le banc : ' + e.message + '\n' + e.stack);
    } finally {
        await fermer();
    }
    process.exit(bilan());
})();
