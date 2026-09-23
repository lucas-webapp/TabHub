// Banc de L'ÉCRITURE INTELLIGENTE — poser un rythme SANS perdre la musique déjà écrite.
//
// DEUX GESTES, UN SEUL CŒUR. « Reprendre le rythme de la mesure précédente » (Alt+D) et l'aide
// rythmique posent tous deux un rythme sur une mesure qui porte peut-être déjà des notes. Ils
// passent par la même règle : LES HAUTEURS SE REPLACENT DANS L'ORDRE sur le rythme neuf.
//
// POURQUOI C'EST LA SEULE CORRESPONDANCE QUI AIT UN SENS. Chercher « la même position dans le
// temps » n'en aurait aucun : c'est précisément ce qu'on est en train de changer. La note qui sonnait
// en premier sonne toujours en premier, la deuxième en deuxième — c'est ce qu'un musicien fait à la
// main quand il recopie un passage sur un autre rythme.
//
// CE QUE ÇA CORRIGE. L'aide rythmique DÉTRUISAIT toutes les hauteurs des mesures visées. Elle le
// disait honnêtement — une boîte de dialogue prévenait —, mais cela la rendait inutilisable pour ce
// à quoi elle sert le plus : corriger le rythme d'un passage déjà écrit. On refaisait la mesure
// entière pour avoir déplacé une croche. Elle emportait aussi la SECONDE VOIX, qui n'a pourtant rien
// à voir avec le rythme de la mélodie.
//
// ET POURQUOI « REPRENDRE LE RYTHME » VAUT UNE TOUCHE À SOI SEULE : la musique de tablature RÉPÈTE
// son rythme. Un accompagnement, un riff, une basse en croches gardent la même figure sur des
// dizaines de mesures et ne changent que les notes. Le redire à chaque mesure — choisir la figure,
// la reposer, la repointer — est le travail le plus répété d'une recopie de partition.
//
// AUCUN NAVIGATEUR : tout ce qui suit est du modèle pur, chargé en module ES depuis node.

const creerHarnais = require('./_harness.js');
const { check, exiger, plan, bilan } = creerHarnais('même rythme, autres notes');

(async () => {
    plan(15);
    try {
        const { Editeur } = await import('../src/edit/commands.js');
        const { dureeEnNoires } = await import('../src/model/duration.js');

        const fig = (ed, m, v = 0) => ed.partition.mesures[m].voix[v].evenements
            .map(e => dureeEnNoires(e.duree).toFixed(2)).join(' ');
        const notes = (ed, m, v = 0) => ed.partition.mesures[m].voix[v].evenements
            .map(e => e.notes.map(n => n.frette).join('+') || (e.aRemplir ? '□' : '_')).join(' ');
        const total = (ed, m, v = 0) => ed.partition.mesures[m].voix[v].evenements
            .reduce((t, e) => t + dureeEnNoires(e.duree), 0);

        /** Mesure 0 : noire, croche, croche, noire, noire — un rythme qu'on veut répéter. */
        const modele = () => {
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null }; ed.saisirChiffre(1);
            ed.dureeCourante = { valeur: 8, points: 0, nolet: null }; ed.saisirChiffre(2); ed.saisirChiffre(3);
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null }; ed.saisirChiffre(4); ed.saisirChiffre(5);
            return ed;
        };

        // =====================================================================================
        // A. SUR UNE MESURE VIDE : le rythme arrive en cases à remplir
        // =====================================================================================
        const ed = modele();
        exiger(fig(ed, 0) === '1.00 0.50 0.50 1.00 1.00',
            `préalable : la mesure modèle porte bien « noire croche croche noire noire » (${fig(ed, 0)})`);
        ed.placerCurseur(1, 0, 0, 0);
        check(ed.reprendreRythmePrecedent() === true && fig(ed, 1) === fig(ed, 0),
            `Alt+D pose exactement le rythme de la mesure d'avant (${fig(ed, 1)})`);
        check(notes(ed, 1) === '□ □ □ □ □',
            `et les cinq cases attendent leur chiffre (${notes(ed, 1)}) : Tab saute de l'une à l'autre`);
        check(Math.abs(total(ed, 1) - 4) < 1e-9,
            `la mesure tombe juste (${total(ed, 1)}) — un geste censé faire gagner du temps n'a pas à `
            + 'produire une mesure fausse');

        // =====================================================================================
        // B. SUR UNE MESURE ÉCRITE : le rythme change, la musique reste
        // =====================================================================================
        const ed2 = modele();
        ed2.placerCurseur(1, 0, 0, 0);
        ed2.dureeCourante = { valeur: 8, points: 0, nolet: null };
        for (let i = 0; i < 5; i++) ed2.saisirChiffre(i + 1);
        ed2.placerCurseur(1, 0, 0, 0);
        const avant2 = notes(ed2, 1);
        ed2.reprendreRythmePrecedent();
        check(fig(ed2, 1) === '1.00 0.50 0.50 1.00 1.00',
            `le rythme de la mesure 2 devient celui de la mesure 1 (${fig(ed2, 1)})`);
        check(notes(ed2, 1) === '1 2 3 4 5',
            `et ses CINQ hauteurs sont toutes là, dans l'ordre où elles sonnaient (${avant2} → ${notes(ed2, 1)}) — `
            + 'c\'est le correctif : on ne refait plus la mesure entière pour avoir changé une figure');
        check(ed2.dernierBilan === null,
            'rien à signaler : autant de cases que de notes, personne ne reste sur le carreau');

        // =====================================================================================
        // C. QUAND IL Y A PLUS DE NOTES QUE DE CASES, ÇA SE DIT
        // =====================================================================================
        const ed3 = modele();
        ed3.placerCurseur(1, 0, 0, 0);
        ed3.dureeCourante = { valeur: 8, points: 0, nolet: null };
        for (let i = 0; i < 8; i++) ed3.saisirChiffre(i);
        ed3.placerCurseur(1, 0, 0, 0);
        ed3.reprendreRythmePrecedent();
        check(notes(ed3, 1) === '0 1 2 3 4',
            `les cinq premières hauteurs se replacent (${notes(ed3, 1)})`);
        check(/3 notes sans case où aller/.test(ed3.dernierBilan || ''),
            `et les trois qui n'ont plus de place sont ANNONCÉES (« ${ed3.dernierBilan} ») — comptées, `
            + 'jamais avalées');

        // =====================================================================================
        // D. LA SECONDE VOIX N'EST PLUS EMPORTÉE
        // =====================================================================================
        const ed4 = modele();
        ed4.placerCurseur(1, 0, 0, 0);
        ed4.ajouterVoix();
        ed4.curseur.voix = 1;
        ed4.dureeCourante = { valeur: 1, points: 0, nolet: null };
        ed4.saisirChiffre(9);
        ed4.placerCurseur(1, 0, 0, 0);
        exiger(ed4.partition.mesures[1].voix.length === 2, 'préalable : la mesure 2 porte bien deux voix');
        ed4.reprendreRythmePrecedent();
        check(ed4.partition.mesures[1].voix.length === 2 && notes(ed4, 1, 1).includes('9'),
            `la basse tenue de la voix 1 survit intacte (${notes(ed4, 1, 1)}) : le rythme posé est celui `
            + 'de la MÉLODIE, et une seconde voix n\'a aucune raison de disparaître avec lui');
        check(Math.abs(total(ed4, 1, 1) - 4) < 1e-9,
            `et elle totalise toujours sa mesure (${total(ed4, 1, 1)})`);

        // =====================================================================================
        // E. CE QUI APPARTIENT À LA MESURE RESTE À LA MESURE
        // =====================================================================================
        const ed5 = modele();
        ed5.placerCurseur(1, 0, 0, 0);
        ed5.definirAnnotation('Refrain');
        ed5.basculerReprise('debut');
        ed5.placerCurseur(1, 0, 0, 0);
        ed5.reprendreRythmePrecedent();
        check(ed5.partition.mesures[1].annotation === 'Refrain' && ed5.partition.mesures[1].repriseDebut === true,
            'l\'annotation de section et la barre de reprise restent : elles appartiennent à la mesure, '
            + 'pas au rythme');

        // =====================================================================================
        // F. LES DEUX REFUS, ET ILS DISENT POURQUOI
        // =====================================================================================
        const ed6 = modele();
        ed6.placerCurseur(0, 0, 0, 0);
        check(ed6.reprendreRythmePrecedent() === false && /Aucune mesure avant/.test(ed6.derniereErreur || ''),
            `sur la PREMIÈRE mesure, il n'y a rien à reprendre, et c'est dit (« ${ed6.derniereErreur} »)`);

        const ed7 = modele();
        ed7.placerCurseur(1, 0, 0, 0);
        ed7.definirSignature(3, 4);
        ed7.placerCurseur(1, 0, 0, 0);
        check(ed7.reprendreRythmePrecedent() === false && /3\/4/.test(ed7.derniereErreur || ''),
            `et un rythme de 4/4 ne se pose pas dans du 3/4 (« ${ed7.derniereErreur} ») : il y ferait `
            + 'déborder la mesure dès son arrivée');

        // =====================================================================================
        // G. UN SEUL POINT D'ANNULATION
        // =====================================================================================
        const ed8 = modele();
        ed8.placerCurseur(1, 0, 0, 0);
        ed8.dureeCourante = { valeur: 8, points: 0, nolet: null };
        for (let i = 0; i < 5; i++) ed8.saisirChiffre(i + 1);
        ed8.placerCurseur(1, 0, 0, 0);
        const avant8 = fig(ed8, 1) + ' | ' + notes(ed8, 1);
        ed8.reprendreRythmePrecedent();
        ed8.annuler();
        check(fig(ed8, 1) + ' | ' + notes(ed8, 1) === avant8,
            'un seul Ctrl+Z ramène le rythme ET les hauteurs à leur place d\'avant');

        check(true, 'toutes les vérifications se sont exécutées sans exception');
    } catch (err) {
        check(false, 'le banc s\'est arrêté sur une exception — ' + (err && err.message));
        console.error(err);
    }
    bilan();
})();
