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
//     partition jouable, un fichier corrompu prévient au lieu de planter.

const fs = require('fs');
const os = require('os');
const path = require('path');
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('MIDI');

(async () => {
    plan(20);
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

        // --- L'interface : un clic télécharge, un fichier réimporté rejoue --------------------------
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.meta.titre = 'Export MIDI test';
            ed.partition.mesures[0].voix[0].evenements = [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)]));
            ed.prevenir('document');
        });

        exiger(await page.evaluate(() => !!document.getElementById('btn-midi-exporter') && !!document.getElementById('btn-midi-ouvrir')),
            'les deux boutons MIDI (import/export) sont posés dans l\'en-tête');

        const attenteMidi = page.waitForEvent('download');
        await page.click('#btn-midi-exporter');
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
        await page.waitForTimeout(400);
        const apresImport = await page.evaluate(() => window.app.editeur.partition.mesures[0].voix[0].evenements.filter(e => e.notes.length).length);
        check(apresImport === 4, 'réimporter ce même fichier .mid reconstruit bien les 4 notes jouées');

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
