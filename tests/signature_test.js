// Banc de LA SIGNATURE RYTHMIQUE — la déclarer ne rend fausse aucune mesure.
//
// LE DÉFAUT QU'IL FIGE. Déclarer la mesure est le TOUT PREMIER geste qu'on fait pour écrire une
// valse ou un 6/8 — avant d'avoir posé la moindre note. L'application y répondait en marquant fausse
// la presque totalité du morceau. Mesuré sur une partition NEUVE, en posant 3/4 sur la première
// mesure : TROIS MESURES SUR QUATRE viraient au rouge avec « +1 ♩ », vides de toute note.
//
// LA CAUSE. `definirSignature` ne redimensionnait QUE la mesure courante. Les suivantes héritent
// pourtant de la nouvelle signature (voir signatureEffective, qui remonte à la dernière mesure qui
// en fixe une), donc d'une nouvelle CAPACITÉ — mais elles gardaient les silences de l'ancienne. Une
// mesure vide de 4 temps de silence dans un 3/4 : +1 ♩, et le rouge.
//
// LES DEUX BORNES DE LA CORRECTION, toutes deux vérifiées ici :
//   — on s'arrête au PROCHAIN CHANGEMENT DÉCLARÉ, qui n'est pas régi par celui qu'on vient de poser ;
//   — on ne touche QUE LES VOIX VIDES. Une voix écrite garde son rythme et, si le compte ne tombe
//     plus juste, sa dette — que la mesure affiche et que Alt+A / Alt+R savent solder. Redécouper
//     une voix écrite serait détruire sans qu'on l'ait demandé.
//
// AUCUN NAVIGATEUR : modèle pur.

const creerHarnais = require('./_harness.js');
const { check, exiger, plan, bilan } = creerHarnais('signature rythmique');

(async () => {
    plan(16);
    try {
        const { Editeur } = await import('../src/edit/commands.js');
        const S = await import('../src/model/score.js');

        const ecarts = ed => ed.partition.mesures.map((_, i) => +ed.ecartMesure(i, 0).toFixed(4));
        const fausses = ed => ecarts(ed).filter(e => Math.abs(e) > 1e-9).length;
        const capacites = ed => ed.partition.mesures.map((_, i) => S.capaciteMesure(ed.partition, i));
        const sigs = ed => ed.partition.mesures.map((_, i) => {
            const s = S.signatureEffective(ed.partition, i);
            return `${s.battements}/${s.unite}`;
        });

        // --- A. Morceau NEUF, on déclare 3/4 : rien ne doit virer au rouge -----------------------
        const ed = new Editeur(); ed.nouveau('guitare');
        exiger(fausses(ed) === 0, `préalable : un morceau neuf n'a aucune mesure fausse (${ecarts(ed).join(' ')})`);
        ed.placerCurseur(0, 0, 0, 0);
        ed.definirSignature(3, 4);
        check(sigs(ed).every(s => s === '3/4'), `le 3/4 vaut pour tout le morceau (${sigs(ed).join(' ')})`);
        check(capacites(ed).every(c => Math.abs(c - 3) < 1e-9), `chaque mesure fait 3 temps (${capacites(ed).join(' ')})`);
        check(fausses(ed) === 0,
            `et AUCUNE ne déborde (${ecarts(ed).join(' ')}) — avant correctif : 3 sur 4, à « +1 ♩ », vides de toute note`);
        check(ed.partition.mesures.every(m => Math.abs(S.dureeEcrite(m, 0) - 3) < 1e-9),
            'les silences ont été redécoupés à la nouvelle capacité, pas seulement recomptés');

        // --- B. Un 6/8 : la mesure composée passe aussi ------------------------------------------
        const ed2 = new Editeur(); ed2.nouveau('guitare');
        ed2.placerCurseur(0, 0, 0, 0);
        ed2.definirSignature(6, 8);
        check(fausses(ed2) === 0, `6/8 sur un morceau neuf : aucune mesure fausse (${ecarts(ed2).join(' ')})`);
        check(capacites(ed2).every(c => Math.abs(c - 3) < 1e-9), `et chacune fait bien 3 noires (${capacites(ed2).join(' ')})`);

        // --- C. On s'arrête au prochain changement DÉCLARÉ ---------------------------------------
        const ed3 = new Editeur(); ed3.nouveau('guitare');
        ed3.placerCurseur(2, 0, 0, 0); ed3.definirSignature(5, 8);
        ed3.placerCurseur(0, 0, 0, 0); ed3.definirSignature(3, 4);
        check(sigs(ed3).join(' ') === '3/4 3/4 5/8 5/8',
            `le 3/4 court jusqu'au 5/8 déclaré, et pas au-delà (${sigs(ed3).join(' ')})`);
        check(fausses(ed3) === 0,
            `et les deux régions sont justes chacune dans la sienne (${ecarts(ed3).join(' ')})`);
        check(!!ed3.partition.mesures[2].signature,
            'la mesure qui déclarait sa signature la garde — elle n\'était pas régie par celle qu\'on vient de poser');

        // --- D. Une voix ÉCRITE n'est pas redécoupée ---------------------------------------------
        const ed4 = new Editeur(); ed4.nouveau('guitare');
        ed4.dureeCourante = { valeur: 4, points: 0, nolet: null };
        ed4.placerCurseur(1, 0, 0, 0);
        for (let i = 0; i < 4; i++) ed4.saisirChiffre(i + 1);
        const avant = ed4.partition.mesures[1].voix[0].evenements
            .filter(e => !e.silence && e.notes.length).map(e => e.notes[0].frette);
        ed4.placerCurseur(0, 0, 0, 0);
        ed4.definirSignature(3, 4);
        const apres = ed4.partition.mesures[1].voix[0].evenements
            .filter(e => !e.silence && e.notes.length).map(e => e.notes[0].frette);
        exiger(JSON.stringify(apres) === JSON.stringify(avant),
            `la mesure écrite garde ses notes, à l'identique (${apres.join(',')} contre ${avant.join(',')})`);
        check(Math.abs(ed4.ecartMesure(1, 0) - 1) < 1e-9,
            `elle porte une dette d'une noire (${ed4.ecartMesure(1, 0)}) : 4 temps écrits dans un 3/4, et la mesure le DIT`);
        check(ed4.ecartMesure(0, 0) === 0 && ed4.ecartMesure(2, 0) === 0,
            `tandis que les mesures VIDES autour, elles, sont justes (${ecarts(ed4).join(' ')})`);
        // Et la dette se solde pour de bon — le remède existe, contrairement à ce qu'on avait avant.
        ed4.placerCurseur(1, 0, 0, 0);
        check(ed4.corrigerDebordement(1) === true && Math.abs(ed4.ecartMesure(1, 0)) < 1e-9,
            'et Alt+R la solde : ce qui déborde part dans une mesure neuve');

        // --- E. Un seul Ctrl+Z défait tout le redimensionnement -----------------------------------
        const ed5 = new Editeur(); ed5.nouveau('guitare');
        const capAvant = capacites(ed5).join(' ');
        ed5.placerCurseur(0, 0, 0, 0);
        ed5.definirSignature(3, 4);
        ed5.annuler();
        check(capacites(ed5).join(' ') === capAvant,
            `un seul Ctrl+Z rend toutes les capacités d'origine (${capacites(ed5).join(' ')})`);
        check(fausses(ed5) === 0, 'et ne laisse aucune mesure fausse derrière lui');

        // --- NEUTRALISATION : on ne redimensionne QUE la mesure courante --------------------------
        const ed6 = new Editeur(); ed6.nouveau('guitare');
        const creerVoix = S.creerVoix;
        ed6.definirSignature = function (battements, unite) {
            this.memoriser();
            const m = this.mesureCourante();
            m.signature = { battements, unite };
            const capacite = S.capaciteMesure(this.partition, this.curseur.mesure);
            for (const voix of m.voix) {
                if (!voix.evenements.every(e => e.silence || !e.notes.length)) continue;
                voix.evenements = creerVoix(capacite).evenements;
            }
            this.corrigerCurseur();
            this.prevenir('edition');
        };
        ed6.placerCurseur(0, 0, 0, 0);
        ed6.definirSignature(3, 4);
        check(fausses(ed6) === 3,
            `NEUTRALISÉ (seule la mesure courante redimensionnée) : ${fausses(ed6)} mesures sur `
            + `${ed6.partition.mesures.length} virent au rouge (${ecarts(ed6).join(' ')}) — vides de toute note, `
            + 'au tout premier geste qu\'on fait pour écrire une valse');
    } catch (e) {
        check(false, 'exception pendant le banc : ' + e.message + '\n' + e.stack);
    }
    process.exit(bilan());
})();
