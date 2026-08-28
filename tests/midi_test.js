// Banc de l'EXPORT/IMPORT MIDI — le format d'échange qu'aucun séquenceur, DAW ou logiciel de
// notation ne pouvait jusqu'ici recevoir ni fournir à TabHub.
//
// CE QU'IL PROTÈGE. Le modèle raisonne déjà en hauteurs MIDI (voir model/theory.js) : la partie
// difficile — faire correspondre corde/case à une hauteur réelle — est déjà résolue ailleurs dans
// l'application (audio, transposition). Ce banc éprouve donc surtout ce qui est VRAIMENT nouveau :
//   • l'ALLER-RETOUR musical (pas structurel — le doigté corde/case peut légitimement changer, la
//     MUSIQUE non) : hauteurs, accords, liaisons de prolongation, y compris À CHEVAL sur une barre
//     de mesure (jamais tronquée, même sur plusieurs mesures pleines) ;
//   • le REPLI sur une position de manche — la même règle que transposerMorceau — et l'ABANDON
//     explicite, compté, d'une hauteur qu'aucune corde n'atteint (jamais une case inventée) ;
//   • la lecture d'un VRAI fichier MIDI extérieur (RUNNING STATUS compris, la convention qu'utilisent
//     la plupart des séquenceurs et que genererMidi, lui, n'a pas besoin d'écrire) ;
//   • le geste complet à l'écran : un clic télécharge un .mid, en réimporter un reconstruit une
//     partition jouable, un fichier corrompu prévient au lieu de planter ;
//   • L'EXPORT PAR SECTION (comme HarmoHub, retour utilisateur) : un morceau à plusieurs parties
//     (voir model/score.js#sectionsDe, d'après les annotations) propose un fichier unique — avec un
//     REPÈRE par section, même alors — ou un fichier PAR section, chacune sur SA PROPRE timeline à 0 ;
//   • L'IMPORT À LA SUITE (même retour utilisateur) : un .mid peut REMPLACER le morceau en cours,
//     comme avant, ou s'y AJOUTER comme une nouvelle partie annotée, sans toucher à ce qui existe.

const fs = require('fs');
const os = require('os');
const path = require('path');
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('MIDI');

(async () => {
    plan(59);
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'tabhub-midi-'));
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // --- Le moteur, hors interface : tout ce qui ne demande ni téléchargement ni DOM -------------
        const r = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const midi = await import('/src/io/midi.js');
            const notesDe = (p) => m.aplatir(p).filter(e => !e.ref.silence).reduce((t, e) => t + e.ref.notes.length, 0);

            // 1. Aller-retour : hauteurs, accord, liaison à travers la barre de mesure ----------------
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            const m0 = m.creerMesure({ signature: { battements: 4, unite: 4 }, armure: 0, mode: 'majeur' });
            m0.voix[0].evenements = [
                m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 0)]),
                m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 2)]),
                m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 3), m.creerNote(1, 0)]),   // accord
                m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 0, { lien: 'tie' })]),      // liée à la mesure suivante
            ];
            const m1 = m.creerMesure({});
            m1.voix[0].evenements = [m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 0)])];
            ed.partition.mesures = [m0, m1];
            ed.partition.meta.tempo = 100;
            ed.partition.meta.titre = 'Banc MIDI';
            ed.prevenir('document');

            const hauteursDe = (p) => m.aplatir(p).filter(e => !e.ref.silence)
                .map(e => e.ref.notes.map(n => m.hauteurDeNote(p, n)).sort((a, b) => a - b).join('+'));
            const avantHauteurs = hauteursDe(ed.partition);
            const octets = midi.genererMidi(ed.partition);
            const analyse = midi.analyserMidi(octets);
            const { partition: reimportee } = midi.construirePartitionDepuisMidi(analyse, 'guitare', ed.partition.piste.accordage, 0);

            // 2. Note tenue sur TROIS mesures pleines (12 noires, 4/4) : jamais tronquée -------------
            const rLongue = midi.construirePartitionDepuisMidi({
                division: 480, tempo: 120, titre: null,
                signatures: [{ noires: 0, battements: 4, unite: 4 }],
                notes: [{ pitch: 64, debutNoires: 0, finNoires: 12 }],
            }, 'guitare');
            const dureeLongue = m.aplatir(rLongue.partition).filter(e => !e.ref.silence).reduce((t, e) => t + e.duree, 0);

            // 3. Hauteur hors du manche (basse4 standard, Mi1..Sol2) : abandonnée, comptée -----------
            const rHaute = midi.construirePartitionDepuisMidi({
                division: 480, tempo: 120, titre: null,
                signatures: [{ noires: 0, battements: 4, unite: 4 }],
                notes: [{ pitch: 108, debutNoires: 0, finNoires: 1 }],
            }, 'basse4');   // accordage par défaut (standard) : peu importe ici, seule la portée du manche compte

            // 4. Même hauteur, deux instruments -> deux doigtés (l'accordage est bien respecté) ------
            const analysePetite = {
                division: 480, tempo: 120, titre: null,
                signatures: [{ noires: 0, battements: 4, unite: 4 }],
                notes: [{ pitch: 43, debutNoires: 0, finNoires: 1 }],
            };
            const noteDe = (p) => p.mesures[0].voix[0].evenements.find(e => e.notes.length)?.notes[0];
            const fretGuitare = noteDe(midi.construirePartitionDepuisMidi(analysePetite, 'guitare').partition);
            const fretBasse = noteDe(midi.construirePartitionDepuisMidi(analysePetite, 'basse4').partition);

            // 5. Octets illisibles -> message clair, pas une exception qui remonte n'importe comment --
            let erreurClaire = null;
            try { midi.analyserMidi(new Uint8Array([1, 2, 3, 4])); } catch (e) { erreurClaire = e.message; }

            // 6. RUNNING STATUS, à la main (la convention de la plupart des vrais fichiers MIDI,
            // que genererMidi lui-même n'utilise pas) : deux notes, la seconde SANS octet de statut --
            const MThd = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
            const evts = [
                0x00, 0x90, 60, 100,
                0x00, 64, 100,            // running status : pas de 0x90 ici
                0x87, 0x40, 60, 0,        // delta 960 (VLQ) : note-off do
                0x00, 64, 0,              // running status : note-off mi
                0x00, 0xff, 0x2f, 0x00,
            ];
            const MTrk = [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, evts.length, ...evts];
            const analyseRS = midi.analyserMidi(new Uint8Array([...MThd, ...MTrk]));

            return {
                enteteOK: [...octets.slice(0, 4)].map(o => String.fromCharCode(o)).join('') === 'MThd',
                hauteursEgales: JSON.stringify(avantHauteurs) === JSON.stringify(hauteursDe(reimportee)),
                titreOK: reimportee.meta.titre === 'Banc MIDI', tempoOK: reimportee.meta.tempo === 100,
                dureeLongue, nbMesuresLongue: rLongue.partition.mesures.length,
                abandonneesHaute: rHaute.abandonnees, notesHaute: notesDe(rHaute.partition),
                fretGuitare, fretBasse,
                erreurClaire,
                nbNotesRS: analyseRS.notes.length,
                pitchesRS: analyseRS.notes.map(n => n.pitch).sort(),
                dureesRS: analyseRS.notes.map(n => n.finNoires - n.debutNoires),
            };
        });

        check(r.enteteOK, 'genererMidi écrit bien un en-tête « MThd » valide');
        exiger(r.hauteursEgales, 'ALLER-RETOUR MUSICAL : hauteurs, accord et liaison (même à travers la barre de mesure) reviennent identiques');
        check(r.titreOK, 'le titre survit (méta-évènement de nom de piste)');
        check(r.tempoOK, 'le tempo survit (méta-évènement de tempo)');
        check(r.dureeLongue === 12, 'une note tenue sur 12 noires (3 mesures pleines) n\'est JAMAIS tronquée');
        check(r.nbMesuresLongue === 3, 'et occupe bien exactement 3 mesures, pas plus, pas moins');
        check(r.abandonneesHaute === 1 && r.notesHaute === 0, 'une hauteur hors du manche est abandonnée et COMPTÉE, jamais placée n\'importe où');
        check(r.fretGuitare.corde !== r.fretBasse.corde || r.fretGuitare.frette !== r.fretBasse.frette,
            'la même hauteur MIDI se doigte différemment selon l\'instrument visé (l\'accordage est bien pris en compte)');
        check(/illisible|MIDI/i.test(r.erreurClaire || ''), 'des octets qui ne sont pas un fichier MIDI affichent un message clair, pas une exception muette');
        check(r.nbNotesRS === 2 && JSON.stringify(r.pitchesRS) === '[60,64]', 'le RUNNING STATUS (deux notes, la seconde sans octet de statut répété) se lit correctement');
        check(r.dureesRS.every(d => Math.abs(d - 2) < 1e-9), 'et les durées (delta-tics codés en VLQ) sont exactes');

        // --- Cohérence de doigté par ZONE DE MANCHE (guitare/basse), hors interface ------------------
        const rz = await page.evaluate(async () => {
            const instr = await import('/src/model/instruments.js');
            const midi = await import('/src/io/midi.js');
            const accord = instr.ACCORDAGES.guitare.find(a => a.id === 'standard');   // [64,59,55,50,45,40]
            const analyseDe = (pitches) => ({
                notes: pitches.map(p => ({ pitch: p, debutNoires: 0, finNoires: 1 })),
                signatures: [{ noires: 0, battements: 4, unite: 4 }], tempo: 120, titre: null,
            });

            // pitch 64 : jouable sur les SIX cordes (fret0 corde0 ... fret24 corde5) -> une zone
            // candidate sur toute la largeur du manche. pitch 40 : atteignable SEULEMENT à vide sur
            // la corde grave -> isolée en zone [0,5]. 20/95 : hors de portée (absMin=40, absMax=88).
            const zTropGraveAigu = midi.analyserZonesManche(analyseDe([20, 95, 40, 64]), 'guitare', accord, 0);
            const zToutHorsPortee = midi.analyserZonesManche(analyseDe([10, 20, 100]), 'guitare', accord, 0);
            const zUneSeule = midi.analyserZonesManche(analyseDe([40]), 'guitare', accord, 0);

            const noteDe = (res) => res.partition.mesures[0].voix[0].evenements[0].notes[0];
            const sansZone = noteDe(midi.construirePartitionDepuisMidi(analyseDe([64]), 'guitare', accord, 0, null));
            const avecZone = noteDe(midi.construirePartitionDepuisMidi(analyseDe([64]), 'guitare', accord, 0, { debut: 15, fin: 20 }));
            const contrainte = midi.construirePartitionDepuisMidi(analyseDe([40]), 'guitare', accord, 0, { debut: 15, fin: 20 });

            return {
                totalNotes: zTropGraveAigu.totalNotes, tropGraves: zTropGraveAigu.tropGraves, tropAigues: zTropGraveAigu.tropAigues,
                zonesReachable: zTropGraveAigu.zones.map(z => z.reachable),
                nZonesHorsPortee: zToutHorsPortee.zones.length,
                nZonesUneSeule: zUneSeule.zones.length, zoneUnique: zUneSeule.zones[0],
                sansZone: { corde: sansZone.corde, frette: sansZone.frette },
                avecZone: { corde: avecZone.corde, frette: avecZone.frette },
                abandonneeParZone: contrainte.abandonnees,
                notesPlaceesParZone: contrainte.partition.mesures[0].voix[0].evenements[0].notes.length,
            };
        });

        check(rz.totalNotes === 4 && rz.tropGraves === 1 && rz.tropAigues === 1,
            'analyserZonesManche compte juste les notes hors de portée de l\'instrument (une trop grave, une trop aiguë)');
        check(rz.zonesReachable.length === 5 && rz.zonesReachable[0] === 2,
            'les 5 tranches du manche sont candidates dès qu\'une hauteur s\'y joue sur une corde ou une autre, celle du sillet cumulant les deux notes qui s\'y jouent');
        check(rz.nZonesHorsPortee === 0, 'quand AUCUNE note du fichier n\'entre dans la portée de l\'instrument, aucune zone n\'est proposée (rien à choisir)');
        check(rz.nZonesUneSeule === 1 && rz.zoneUnique.debut === 0 && rz.zoneUnique.fin === 5,
            'une note isolée à une seule position (corde grave à vide) ne rend qu\'UNE seule zone pertinente');
        exiger(rz.sansZone.corde === 0 && rz.sansZone.frette === 0, 'sans zone, la case la plus BASSE gagne, quelle que soit la corde (comportement historique)');
        exiger(rz.avecZone.corde === 4 && rz.avecZone.frette === 19,
            'LE CŒUR DU CÂBLAGE : avec la zone case15-case20, seule la corde qui y tombe (ici la 5e, case 19) est choisie — jamais la case la plus basse hors zone');
        check(rz.abandonneeParZone === 1 && rz.notesPlaceesParZone === 0,
            'une note hors de la zone CHOISIE (mais atteignable ailleurs sur le manche) est abandonnée, comme une note vraiment hors de portée');

        // --- Sections : découpage, extrait décalé à 0, liaison coupée à la borne, repères -----------
        const rs = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const midi = await import('/src/io/midi.js');
            const sortie = {};

            const sansAnnotation = m.creerPartition('guitare');
            sansAnnotation.mesures = Array.from({ length: 4 }, () => m.creerMesure());
            sortie.uneSeuleSection = m.sectionsDe(sansAnnotation).length;

            const p = m.creerPartition('guitare');
            p.mesures = Array.from({ length: 8 }, () => m.creerMesure());
            p.mesures[3].annotation = 'Refrain';   // intro (0-2) SANS titre, puis Refrain (3-7)
            const sections = m.sectionsDe(p);
            sortie.decoupage = sections.map(s => ({ titre: s.titre, debut: s.debut, fin: s.fin }));

            // Une note dans la 2e section, décodée seule : doit démarrer à noires=0 (pas 12, sa
            // position dans le morceau ENTIER) — c'est toute la promesse d'« une timeline à 0 ».
            const pNote = m.creerPartition('guitare');
            const mA = m.creerMesure({ voix: [{ evenements: [m.creerEvenement({ valeur: 1 }, [m.creerNote(0, 1)])] }] });
            const mB = m.creerMesure({ annotation: 'Refrain', voix: [{ evenements: [m.creerEvenement({ valeur: 1 }, [m.creerNote(0, 5)])] }] });
            pNote.mesures = [mA, mB];
            const secNote = m.sectionsDe(pNote);
            const octetsExtrait = midi.genererMidi(pNote, { debut: secNote[1].debut, fin: secNote[1].fin });
            sortie.extraitDebutA0 = midi.analyserMidi(octetsExtrait).notes[0]?.debutNoires;

            // Liaison qui franchirait la borne de section : coupée nette (1 noire), jamais fusionnée
            // avec la note de la section suivante qui n'existe pas dans ce fichier-là.
            const pTie = m.creerPartition('guitare');
            const nLiee = m.creerNote(0, 3); nLiee.lien = 'tie';
            const mC = m.creerMesure({ voix: [{ evenements: [m.creerEvenement({ valeur: 4 }, [nLiee])] }] });
            const mD = m.creerMesure({ annotation: 'Pont', voix: [{ evenements: [m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 3)])] }] });
            pTie.mesures = [mC, mD];
            const secTie = m.sectionsDe(pTie);
            const octetsCoupes = midi.genererMidi(pTie, { debut: secTie[0].debut, fin: secTie[0].fin });
            const noteCoupee = midi.analyserMidi(octetsCoupes).notes[0];
            sortie.dureeCoupeeALaBorne = noteCoupee ? (noteCoupee.finNoires - noteCoupee.debutNoires) : null;

            // Un fichier PAR section : indépendantes, chacune décodée dès noires=0.
            const fichiers = midi.genererMidiSections(p);
            sortie.nFichiers = fichiers.length;
            sortie.titresFichiers = fichiers.map(f => f.titre);
            sortie.nomsDistincts = new Set(fichiers.map(f => f.nom)).size === fichiers.length;

            // Fichier UNIQUE : des repères MIDI (0x06) marquent chaque section, même sans fichier
            // séparé — le texte brut suffit à les retrouver dans les octets pour cette sonde.
            const marqueurs = sections.map((s, i) => ({ tic: Math.round(m.positionDebutMesure(p, s.debut) * 480), titre: s.titre || `Partie ${i + 1}` }));
            const octetsUnique = midi.genererMidi(p, { marqueurs });
            const texteUnique = String.fromCharCode(...octetsUnique);
            sortie.repereePartie1 = texteUnique.includes('Partie 1');
            sortie.repereRefrain = texteUnique.includes('Refrain');

            return sortie;
        });

        check(rs.uneSeuleSection === 1, 'un morceau sans annotation ne forme qu\'UNE section (aucun découpage possible)');
        check(JSON.stringify(rs.decoupage) === JSON.stringify([{ titre: '', debut: 0, fin: 2 }, { titre: 'Refrain', debut: 3, fin: 7 }]),
            'une intro SANS titre (avant la première annotation) forme sa propre section, jamais absorbée dans la suivante');
        check(rs.extraitDebutA0 === 0, 'une section exportée seule démarre bien sa PROPRE timeline à 0, comme HarmoHub — pas à sa position dans le morceau entier');
        check(rs.dureeCoupeeALaBorne === 1, 'une liaison qui franchirait la borne de la section est coupée NETTE (1 noire), jamais fusionnée avec une note d\'une autre section absente du fichier');
        check(rs.nFichiers === 2 && JSON.stringify(rs.titresFichiers) === '["Partie 1","Refrain"]',
            'genererMidiSections donne un fichier par section, celle sans titre repliée sur « Partie 1 » (comme HarmoHub)');
        check(rs.nomsDistincts, 'et chaque fichier porte un nom de téléchargement distinct');
        check(rs.repereePartie1 && rs.repereRefrain, 'le fichier UNIQUE porte lui aussi un repère par section (même sans avoir demandé un fichier par section)');

        // --- L'interface : un clic télécharge, un fichier réimporté rejoue --------------------------

        // Aux points d'import déjà existants ci-dessous (pas eux-mêmes le sujet du test), la fenêtre
        // de ZONE DE MANCHE (nouvelle, guitare/basse — voir plus bas pour ses tests DÉDIÉS) peut
        // désormais s'intercaler avant celle du mode d'import : on la traverse ici via « Manche
        // entier » (le comportement d'avant cette fonctionnalité), pour ne pas changer ce que ces
        // vérifications-là éprouvent réellement.
        const passerZoneSiPresente = async () => {
            await page.waitForTimeout(150);
            if (await page.locator('#fenetre-zone-manche').isVisible()) {
                await page.click('#fenetre-zone-manche [data-choix="tout"]');
                await page.waitForTimeout(150);
            }
        };

        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.meta.titre = 'Export MIDI test';
            ed.partition.mesures[0].voix[0].evenements = [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)]));
            ed.prevenir('document');
        });

        exiger(await page.evaluate(() =>
            !!document.querySelector('#popover-fichiers [data-action="midi-exporter"]') && !!document.querySelector('#popover-fichiers [data-action="midi-ouvrir"]')),
            'les deux actions MIDI (import/export) sont bien dans le popover Fichiers');

        const attenteMidi = page.waitForEvent('download');
        // « Exporter en MIDI » vit désormais dans le popover Fichiers (retour utilisateur : icônes
        // MIDI peu claires, prises isolément — voir main.js#basculerPopoverFichiers), plus un bouton
        // à part dans l'en-tête : deux clics au lieu d'un.
        await page.click('#btn-fichiers');
        await page.click('#popover-fichiers [data-action="midi-exporter"]');
        const telMidi = await attenteMidi;
        const cheminMidi = path.join(dossier, 'temoin.mid');
        await telMidi.saveAs(cheminMidi);
        exiger(fs.existsSync(cheminMidi), 'le clic sur « Exporter en MIDI » télécharge bien un fichier');
        check(/\.mid$/.test(telMidi.suggestedFilename()), 'le fichier porte l\'extension .mid');
        check(telMidi.suggestedFilename().startsWith('Export MIDI test'), 'et il est nommé d\'après le titre du morceau');
        check(fs.readFileSync(cheminMidi).slice(0, 4).toString() === 'MThd', 'le fichier écrit sur disque commence bien par « MThd »');

        // Même INSTRUMENT qu'à l'export (guitare) : au delà de ce banc, changer d'instrument avant de
        // réimporter changerait aussi l'accordage, et rien ne garantit alors qu'une note haute sur une
        // corde de guitare reste atteignable sur une basse — ce n'est pas ce que ce cas éprouve (voir
        // plus haut le cas dédié « la même hauteur MIDI se doigte différemment selon l'instrument »).
        await page.evaluate(() => window.app.editeur.nouveau('guitare'));
        await page.waitForTimeout(150);
        await page.setInputFiles('#entree-fichier-midi', cheminMidi);
        await page.waitForTimeout(300);
        await passerZoneSiPresente();
        exiger(await page.locator('#fenetre-choix-import-midi').isVisible(), 'importer un .mid demande TOUJOURS s\'il remplace le morceau ou s\'y ajoute — jamais deviné en silence');

        // « Nouveau morceau » : remplace, comme le faisait l'ancien import direct.
        await page.click('#fenetre-choix-import-midi [data-choix="nouveau"]');
        await page.waitForTimeout(200);
        const apresImport = await page.evaluate(() => window.app.editeur.partition.mesures[0].voix[0].evenements.filter(e => e.notes.length).length);
        check(apresImport === 4, '« Nouveau morceau » reconstruit bien les 4 notes jouées, à la place de l\'existant');

        // « Annuler » (croix) : rien ne change, comme si le fichier n'avait jamais été choisi.
        const avantAnnulerImport = await page.evaluate(() => JSON.stringify(window.app.editeur.partition.mesures));
        await page.setInputFiles('#entree-fichier-midi', cheminMidi);
        await page.waitForTimeout(200);
        await passerZoneSiPresente();
        await page.click('#fenetre-choix-import-midi [data-fermer]');
        await page.waitForTimeout(200);
        check(!(await page.locator('#fenetre-choix-import-midi').isVisible()), 'Annuler referme la fenêtre de choix');
        check((await page.evaluate(() => JSON.stringify(window.app.editeur.partition.mesures))) === avantAnnulerImport, 'et laisse le morceau en cours parfaitement intact');

        // « À la suite » : le morceau EXISTANT (deux mesures témoins) garde ses notes, le fichier
        // importé s'ajoute APRÈS, sa première mesure portant une annotation dérivée du nom du fichier.
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures = [
                m.creerMesure({ voix: [{ evenements: [m.creerEvenement({ valeur: 1 }, [m.creerNote(0, 9)])] }] }),
                m.creerMesure({ voix: [{ evenements: [m.creerEvenement({ valeur: 1 }, [m.creerNote(0, 9)])] }] }),
            ];
            ed.prevenir('document');
        });
        const avantSuite = await page.evaluate(() => JSON.stringify(window.app.editeur.partition.mesures.map(mm => mm.voix[0].evenements[0].notes[0]?.frette)));
        await page.setInputFiles('#entree-fichier-midi', cheminMidi);
        await page.waitForTimeout(200);
        await passerZoneSiPresente();
        await page.click('#fenetre-choix-import-midi [data-choix="suite"]');
        await page.waitForTimeout(300);
        const apresSuite = await page.evaluate(() => ({
            nMesures: window.app.editeur.partition.mesures.length,
            debutIntact: JSON.stringify(window.app.editeur.partition.mesures.slice(0, 2).map(mm => mm.voix[0].evenements[0].notes[0]?.frette)),
            annotationNouvellePartie: (window.app.editeur.partition.mesures[2]?.annotation || '').length > 0,
            notesAjoutees: window.app.editeur.partition.mesures.slice(2).some(mm => mm.voix.some(v => v.evenements.some(e => e.notes.length))),
        }));
        check(apresSuite.debutIntact === avantSuite, '« À la suite » laisse les DEUX mesures déjà là parfaitement intactes');
        check(apresSuite.nMesures > 2, 'et de nouvelles mesures arrivent bien après');
        check(apresSuite.annotationNouvellePartie, 'la première mesure ajoutée porte une annotation (le nom du fichier), pour repérer où commence la nouvelle partie');
        check(apresSuite.notesAjoutees, 'et le contenu du fichier importé s\'y retrouve bien joué');

        // --- Cohérence de doigté par ZONE DE MANCHE : le geste complet à l'écran ----------------------
        // Un fichier à deux notes délibérément écartées : le pitch d'une corde à vide jouable PARTOUT
        // sur le manche (une corde différente par zone), et un pitch isolé, atteignable SEULEMENT en
        // zone [0,5] — de quoi forcer plusieurs zones candidates ET un contraste net une fois une zone
        // choisie (voir le bloc « hors interface » plus haut pour les mêmes cas en pur, déjà vérifiés).
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures = [
                m.creerMesure({ voix: [{ evenements: [m.creerEvenement({ valeur: 1 }, [m.creerNote(0, 0)])] }] }),   // pitch 64
                m.creerMesure({ voix: [{ evenements: [m.creerEvenement({ valeur: 1 }, [m.creerNote(5, 0)])] }] }),   // pitch 40
            ];
            ed.prevenir('document');
        });
        const attenteZone = page.waitForEvent('download');
        await page.click('#btn-fichiers');
        await page.click('#popover-fichiers [data-action="midi-exporter"]');
        const telZone = await attenteZone;
        const cheminZone = path.join(dossier, 'zone.mid');
        await telZone.saveAs(cheminZone);

        await page.evaluate(() => window.app.editeur.nouveau('guitare'));
        await page.setInputFiles('#entree-fichier-midi', cheminZone);
        await page.waitForTimeout(300);
        exiger(await page.locator('#fenetre-zone-manche').isVisible(), 'plusieurs zones pertinentes : la fenêtre de zone de manche apparaît AVANT celle du mode d\'import');
        check((await page.locator('#liste-zones-manche [data-choix]').count()) === 5, 'une zone candidate par tranche de 5 cases sur un manche de 24 cases (sillet-5, 5-10, 10-15, 15-20, 20-24)');
        check(!(await page.locator('#avertissement-zone-manche').isVisible()), 'aucun avertissement quand toutes les notes du fichier sont dans la portée de l\'instrument');

        await page.click('#fenetre-zone-manche [data-choix="15-20"]');
        await page.waitForTimeout(150);
        exiger(await page.locator('#fenetre-choix-import-midi').isVisible(), 'la zone choisie, la fenêtre du mode d\'import (nouveau/à la suite) prend le relais');
        await page.click('#fenetre-choix-import-midi [data-choix="nouveau"]');
        await page.waitForTimeout(200);
        const apresZoneChoisie = await page.evaluate(() => {
            const ms = window.app.editeur.partition.mesures;
            return {
                notePlacee: ms[0]?.voix[0].evenements[0].notes[0],
                secondeAbandonnee: !ms[1] || ms[1].voix[0].evenements.every(e => !e.notes.length),
            };
        });
        check(apresZoneChoisie.notePlacee?.corde === 4 && apresZoneChoisie.notePlacee?.frette === 19,
            'la note jouable partout est bien contrainte à LA zone choisie (case 15-20), pas à la case la plus basse du manche entier');
        check(apresZoneChoisie.secondeAbandonnee, 'et la note isolée hors de cette zone est abandonnée — cause : la zone choisie, pas l\'instrument');

        // « Manche entier » : reproduit le comportement d'avant cette fonctionnalité, sans contrainte.
        await page.evaluate(() => window.app.editeur.nouveau('guitare'));
        await page.setInputFiles('#entree-fichier-midi', cheminZone);
        await page.waitForTimeout(300);
        await page.click('#fenetre-zone-manche [data-choix="tout"]');
        await page.waitForTimeout(150);
        await page.click('#fenetre-choix-import-midi [data-choix="nouveau"]');
        await page.waitForTimeout(200);
        const apresMancheEntier = await page.evaluate(() => window.app.editeur.partition.mesures.map(mm => mm.voix[0].evenements[0].notes[0]));
        check(apresMancheEntier[0]?.corde === 0 && apresMancheEntier[0]?.frette === 0 && apresMancheEntier[1]?.corde === 5 && apresMancheEntier[1]?.frette === 0,
            '« Manche entier » replace bien les DEUX notes à leur case la plus basse, comme avant cette fonctionnalité');

        // Annuler (croix) sur la fenêtre de ZONE : import abandonné dans son ENSEMBLE, morceau intact.
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures = [m.creerMesure({ voix: [{ evenements: [m.creerEvenement({ valeur: 1 }, [m.creerNote(2, 5)])] }] })];
            ed.prevenir('document');
        });
        const avantAnnulerZone = await page.evaluate(() => JSON.stringify(window.app.editeur.partition.mesures));
        await page.setInputFiles('#entree-fichier-midi', cheminZone);
        await page.waitForTimeout(300);
        await page.click('#fenetre-zone-manche [data-fermer]');
        await page.waitForTimeout(200);
        check(!(await page.locator('#fenetre-zone-manche').isVisible()) && !(await page.locator('#fenetre-choix-import-midi').isVisible()),
            'annuler à l\'étape de la zone referme tout, sans passer par le choix du mode d\'import');
        check((await page.evaluate(() => JSON.stringify(window.app.editeur.partition.mesures))) === avantAnnulerZone, 'et laisse le morceau en cours parfaitement intact');

        // Une seule zone pertinente (une seule note, isolée) : la fenêtre de zone est SAUTÉE.
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures = [m.creerMesure({ voix: [{ evenements: [m.creerEvenement({ valeur: 1 }, [m.creerNote(5, 0)])] }] })];   // pitch 40, isolée
            ed.prevenir('document');
        });
        const attenteSeule = page.waitForEvent('download');
        await page.click('#btn-fichiers');
        await page.click('#popover-fichiers [data-action="midi-exporter"]');
        const telSeule = await attenteSeule;
        const cheminSeule = path.join(dossier, 'zone-unique.mid');
        await telSeule.saveAs(cheminSeule);

        await page.evaluate(() => window.app.editeur.nouveau('guitare'));
        await page.setInputFiles('#entree-fichier-midi', cheminSeule);
        await page.waitForTimeout(300);
        check(!(await page.locator('#fenetre-zone-manche').isVisible()), 'une seule zone pertinente : rien à choisir, la fenêtre de zone est SAUTÉE');
        exiger(await page.locator('#fenetre-choix-import-midi').isVisible(), 'et l\'import passe directement au choix du mode d\'import');
        await page.click('#fenetre-choix-import-midi [data-choix="nouveau"]');
        await page.waitForTimeout(150);

        // Piano : pas de manche, donc jamais de fenêtre de zone, quel que soit le fichier.
        await page.evaluate(() => window.app.editeur.nouveau('piano'));
        await page.setInputFiles('#entree-fichier-midi', cheminZone);
        await page.waitForTimeout(300);
        check(!(await page.locator('#fenetre-zone-manche').isVisible()), 'au piano (pas de manche), la fenêtre de zone n\'apparaît JAMAIS, même pour un fichier qui la déclencherait ailleurs');
        exiger(await page.locator('#fenetre-choix-import-midi').isVisible(), 'et l\'import passe directement au choix du mode d\'import');
        await page.click('#fenetre-choix-import-midi [data-fermer]');
        await page.waitForTimeout(150);

        // --- Export MIDI : proposé seulement à partir de deux sections, jamais sur un morceau simple --
        exiger(!(await page.locator('#fenetre-choix-export-midi').isVisible()), 'préalable : la fenêtre de choix export n\'est pas déjà ouverte');
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures = Array.from({ length: 4 }, () => m.creerMesure({ voix: [{ evenements: [m.creerEvenement({ valeur: 1 }, [m.creerNote(0, 1)])] }] }));
            ed.prevenir('document');
        });
        const attenteDirecte = page.waitForEvent('download');
        await page.click('#btn-fichiers');
        await page.click('#popover-fichiers [data-action="midi-exporter"]');
        await attenteDirecte;
        check(!(await page.locator('#fenetre-choix-export-midi').isVisible()), 'un morceau à UNE seule section (aucune annotation) exporte directement, sans rien demander');

        // Deux sections : la fenêtre apparaît, et « Un fichier par partie » télécharge bien DEUX fichiers.
        await page.evaluate(async () => {
            const ed = window.app.editeur;
            ed.partition.mesures[2].annotation = 'Refrain';
            ed.prevenir('document');
        });
        await page.click('#btn-fichiers');
        await page.click('#popover-fichiers [data-action="midi-exporter"]');
        await page.waitForTimeout(200);
        exiger(await page.locator('#fenetre-choix-export-midi').isVisible(), 'deux sections proposent bien le choix « un seul fichier / un fichier par partie »');
        const telechargementsPartie = [];
        const surTelechargement = (d) => telechargementsPartie.push(d.suggestedFilename());
        page.on('download', surTelechargement);
        await page.click('#fenetre-choix-export-midi [data-choix="partie"]');
        await page.waitForTimeout(900);
        page.off('download', surTelechargement);
        check(telechargementsPartie.length === 2 && telechargementsPartie.every(n => /\.mid$/.test(n)),
            '« Un fichier par partie » télécharge bien un .mid PAR section (deux ici), pas un seul');
        check(!(await page.locator('#fenetre-choix-export-midi').isVisible()), 'et la fenêtre se referme d\'elle-même une fois le choix fait');

        // --- Un fichier .mid corrompu prévient, ne casse rien -----------------------------------------
        const avantCorrompu = await page.evaluate(() => window.app.editeur.partition.meta.titre);
        const cheminAbime = path.join(dossier, 'abime.mid');
        fs.writeFileSync(cheminAbime, 'ceci n\'est pas un fichier MIDI');
        await page.setInputFiles('#entree-fichier-midi', cheminAbime);
        await page.waitForTimeout(300);
        const messageAbime = await page.textContent('#message');
        check(/illisible|MIDI/i.test(messageAbime || ''), 'un .mid corrompu affiche un message clair au lieu de planter');
        check((await page.evaluate(() => window.app.editeur.partition.meta.titre)) === avantCorrompu, 'et laisse la partition en cours intacte');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally {
        await fermer();
        fs.rmSync(dossier, { recursive: true, force: true });
    }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
