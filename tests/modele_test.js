// Banc du MODÈLE, sans navigateur. Théorie musicale, durées, accordages, normalisation d'un fichier.
//
// Ces règles-là sont vérifiables sans DOM et sans audio : les éprouver en Node prend une demi-seconde
// au lieu de trente, et surtout ça les tient séparées des aléas du rendu. Un banc de rendu rouge dit
// « l'affichage a changé » ; celui-ci dit « la musique est fausse », ce qui n'est pas le même problème.

const creerHarnais = require('./_harness.js');
const { check, exiger, plan, bilan } = creerHarnais('modèle');

(async () => {
    plan(34);
    const T = await import('../src/model/theory.js');
    const D = await import('../src/model/duration.js');
    const I = await import('../src/model/instruments.js');
    const S = await import('../src/model/score.js');

    // --- Orthographe des hauteurs selon l'armure ---------------------------------------------
    // Le cœur du passage tablature → solfège : une case donne une TOUCHE, l'armure en donne le NOM.
    const en = (midi, arm) => { const e = T.ecrireHauteur(midi, arm); return e.lettre + (e.alteration > 0 ? '#'.repeat(e.alteration) : 'b'.repeat(-e.alteration)) + e.octave; };
    check(en(64, 0) === 'E4', 'midi 64 en do majeur s\'écrit mi4');
    check(en(63, 0) === 'D#4', 'midi 63 sans armure s\'écrit ré♯ (défaut aux dièses)');
    check(en(63, -2) === 'Eb4', 'midi 63 en si♭ majeur s\'écrit mi♭ — l\'armure décide, pas le hasard');
    check(en(61, 3) === 'C#4', 'midi 61 en la majeur s\'écrit do♯ : la note est DANS la gamme');
    check(T.ecrireHauteur(61, 3).accidentelle === 0, 'et ne porte donc PAS d\'altération accidentelle');
    check(T.ecrireHauteur(61, 0).accidentelle === 1, 'alors qu\'en do majeur elle en porte une');
    check(T.ecrireHauteur(59, 0).pas === 27 && T.ecrireHauteur(60, 0).pas === 28, 'positions diatoniques consécutives si3 → do4');
    check(T.nomVersMidi('E2') === 40 && T.nomVersMidi('Bb1') === 34, 'lecture d\'un nom de note vers un numéro MIDI');
    check(Math.abs(T.midiVersFrequence(69) - 440) < 1e-9, 'la3 = 440 Hz');

    // --- Durées ---------------------------------------------------------------------------------
    check(D.dureeEnNoires({ valeur: 4 }) === 1, 'une noire vaut une noire');
    check(D.dureeEnNoires({ valeur: 2, points: 1 }) === 3, 'une blanche pointée vaut trois noires');
    check(Math.abs(D.dureeEnNoires({ valeur: 8, nolet: { dans: 3, valent: 2 } }) - 1 / 3) < 1e-12, 'une croche de triolet vaut un tiers de noire');
    check(D.noiresParMesure({ battements: 6, unite: 8 }) === 3, 'une mesure à 6/8 vaut trois noires');
    check(D.uniteDeGroupement({ battements: 6, unite: 8 }) === 1.5, '6/8 se ligature à la noire pointée — sinon on lirait du 3/4');
    check(D.uniteDeGroupement({ battements: 4, unite: 4 }) === 1, '4/4 se ligature à la noire');

    // --- Instruments et accordages ---------------------------------------------------------------
    check(I.accordageParDefaut('guitare').cordes.length === 6, 'la guitare a six cordes');
    check(I.accordageParDefaut('basse5').cordes.length === 5, 'la basse 5 en a cinq');
    check(I.libelleAccordage(I.accordageParDefaut('guitare').cordes) === 'Mi La Ré Sol Si Mi', 'accordage énoncé du grave à l\'aigu, comme un instrumentiste');
    check(I.accordagePredefini('guitare', 'dropD').cordes[5] === 38, 'le drop D descend la corde grave à ré');
    check(I.hauteurDeCase(I.accordageParDefaut('guitare'), 5, 5) === 45, 'case 5 de la corde grave = la2');
    check(I.hauteurDeCase(I.accordageParDefaut('guitare'), 5, 5, 2) === 47, 'un capodastre case 2 monte tout de deux demi-tons');

    // --- Partition et héritage --------------------------------------------------------------------
    const p = S.creerPartition('guitare');
    p.mesures[0].signature = { battements: 3, unite: 8 };
    check(S.signatureEffective(p, 2).battements === 3, 'une mesure sans signature hérite de la précédente');
    check(S.capaciteMesure(p, 0) === 1.5, 'capacité d\'une mesure à 3/8 : une noire et demie');
    p.mesures[0].voix[0].evenements = [S.creerEvenement({ valeur: 8 }, [S.creerNote(0, 7)]), S.creerEvenement({ valeur: 8 }, [S.creerNote(0, 5)]), S.creerEvenement({ valeur: 8 }, [S.creerNote(0, 3)])];
    check(S.etatMesure(p, 0) === 'complete', 'trois croches remplissent exactement une mesure à 3/8');

    // --- Voix : basse tenue sous une mélodie qui bouge ----------------------------------------------
    check(S.nbVoixMesure(p.mesures[0]) === 1, 'une mesure neuve n\'a qu\'une voix');
    p.mesures[0].voix.push(S.creerVoix(S.capaciteMesure(p, 0)));
    check(S.nbVoixMesure(p.mesures[0]) === 2, 'une 2e voix s\'ajoute sans toucher à la première');
    check(S.dureeEcrite(p.mesures[0], 0) === 1.5 && S.dureeEcrite(p.mesures[0], 1) === 1.5, 'la voix neuve est dimensionnée à la capacité de LA mesure, pas à une noire fixe');
    p.mesures[0].voix[1].evenements = [S.creerEvenement({ valeur: 4, points: 1 }, [S.creerNote(5, 0)])];
    const plat = S.aplatir(p);
    const m0 = plat.filter(e => e.mesure === 0);
    check(m0.some(e => e.voix === 0) && m0.some(e => e.voix === 1), 'aplatir() restitue les DEUX voix de la mesure');
    check(m0.filter(e => e.voix === 1)[0].debut === 0, 'les deux voix partagent la même origine temporelle');

    // --- Découpage d'une durée en évènements standard (silence ou note) -----------------------------
    check(S.decouperEnEvenements(5).map(e => e.duree.valeur).join('+') === '1+4', 'une durée de 5 noires se décompose en ronde + noire');
    check(S.decouperEnEvenements(1.5)[0].duree.points === 1, 'une durée de 1,5 noire tient dans UNE noire pointée');

    // --- Normalisation d'un fichier hostile -------------------------------------------------------
    // Un .json ouvert par l'utilisateur est une entrée non fiable au même titre qu'une saisie.
    const abime = S.normaliser({ mesures: [{ evenements: [{ duree: { valeur: 0 }, notes: [{ corde: 99, frette: 999 }, { corde: 99, frette: 3 }] }] }] });
    check(S.nbVoixMesure(abime.mesures[0]) === 1, 'un fichier antérieur aux voix (evenements à plat) migre en une seule voix');
    const n0 = abime.mesures[0].voix[0].evenements[0];
    check(n0.duree.valeur === 4, 'une durée nulle est ramenée à la noire — sinon la lecture boucle sur du vide');
    check(n0.notes[0].corde <= 5 && n0.notes[0].frette <= 24, 'corde et case hors bornes sont ramenées dans le manche');
    check(n0.notes.length === 1, 'deux notes sur la MÊME corde : physiquement impossible, la seconde est écartée');

    bilan();
})().catch(err => { console.error(err); process.exit(1); });
