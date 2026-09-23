// Banc des PERTES SILENCIEUSES — un geste fait ce qu'il annonce, ou dit ce qu'il a fait d'autre.
//
// LA RÈGLE QU'IL PROTÈGE, en une phrase : rien ne disparaît sans un mot. Elle vaut pour les trois
// familles de conséquences qu'un geste peut avoir au-delà de son nom.
//
// 1. LA LIAISON ORPHELINE, et son vrai danger. Une liaison relie une note à la SUIVANTE sur la même
//    corde (`note.lien`, voir model/score.js) : une forme compacte, qui a le défaut de survivre à la
//    disparition de l'arrivée. Raccourcir la première de deux noires liées laissait un silence entre
//    les deux, et la liaison pointait vers ce silence.
//
//    Tant qu'elle y pointe, elle dort : le lecteur s'arrête faute de note à prolonger, le traceur ne
//    trouve pas de seconde note à relier. MAIS LE JOUR OÙ L'ON ÉCRIT UNE CASE DANS CE SILENCE — le
//    geste le plus naturel du monde — elle se réveille. Mesuré : une case 5 se retrouvait LIÉE à une
//    case 9, deux hauteurs différentes réunies par une liaison de PROLONGATION, sans que personne
//    l'ait demandé ni que rien ne le dise. C'est une corruption du document, silencieuse et différée.
//
// 2. CE QU'UN GESTE COÛTE quand son nom ne le dit pas. Passer de la guitare à une basse à quatre
//    cordes efface tout ce qui était écrit sur les cordes 5 et 6 : inévitable, elles n'existent plus
//    — mais fait depuis une liste déroulante de réglages, où l'on ne s'attend pas à perdre de la
//    musique. Mesuré sur un accord de six notes : quatre survivaient, deux disparaissaient, rien
//    nulle part ne le signalait. Même chose pour « retirer la seconde voix », qui emporte ce qu'elle
//    portait. `collerMesure` comptait déjà ses notes abandonnées : c'est la règle de la maison, elle
//    s'applique maintenant partout.
//
// 3. UN GESTE QUI NE PEUT PAS ABOUTIR LE DIT, plutôt que de ne rien faire. Poser une liaison sur une
//    note qui n'a pas de suivante sur sa corde serait aussitôt défait par l'invariant du point 1 :
//    le bouton semblerait mort. Il refuse et explique.
//
// AUCUN NAVIGATEUR : tout ce qui suit est du modèle pur, chargé en module ES depuis node.

const creerHarnais = require('./_harness.js');
const { check, exiger, plan, bilan } = creerHarnais('pertes silencieuses');

(async () => {
    plan(20);
    try {
        const { Editeur } = await import('../src/edit/commands.js');
        const { dureeEnNoires } = await import('../src/model/duration.js');

        const evts = (ed, m = 0, v = 0) => ed.partition.mesures[m].voix[v].evenements;
        const liens = (ed) => ed.partition.mesures
            .flatMap(m => m.voix.flatMap(v => v.evenements.flatMap(e => e.notes)))
            .filter(n => n.lien).map(n => n.lien);

        /** Deux noires liées sur la corde 0, dans une mesure de 4/4. */
        const deuxLiees = (lien = 'tie') => {
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            ed.saisirChiffre(5);
            ed.saisirChiffre(5);
            // ON REVIENT SUR LA NOTE POUR LUI POSER L'EFFET : avec l'avance automatique, le curseur a
            // quitté la note dès qu'elle était écrite. C'est le geste réel — un « ← », ou un clic.
            ed.placerCurseur(0, 0, 0, 0); ed.basculerLien(lien);
            return ed;
        };

        // =====================================================================================
        // A. LA LIAISON ORPHELINE EST RETIRÉE, ET LA RÉSURRECTION N'A PAS LIEU
        // =====================================================================================
        const ed = deuxLiees();
        exiger(liens(ed).join(',') === 'tie', 'préalable : deux noires liées, une liaison posée');
        ed.curseur.evenement = 0;
        ed.appliquerDuree(8);
        check(evts(ed)[1].silence && liens(ed).length === 0,
            'raccourcir la première note glisse un silence entre les deux : la liaison, devenue '
            + `orpheline, est retirée (${liens(ed).length} restante(s))`);
        check(ed.derniersLiensRetires === 1,
            `et le compte est tenu pour l'annoncer (${ed.derniersLiensRetires}) — la retirer sans un `
            + 'mot serait exactement la perte silencieuse qu\'on chasse');

        ed.derniersLiensRetires = 0;
        ed.curseur.evenement = 1; ed.curseur.corde = 0;
        ed.dureeCourante = { valeur: 8, points: 0, nolet: null };
        ed.saisirChiffre(9);
        check(liens(ed).length === 0,
            'et remplir ce silence ensuite ne réveille RIEN : c\'était le vrai danger — une case 5 '
            + 'se retrouvait liée à une case 9, deux hauteurs différentes réunies par une liaison de '
            + 'prolongation que personne n\'avait demandée');

        for (const lien of ['hammer', 'pull', 'slide']) {
            const e = deuxLiees(lien);
            e.curseur.evenement = 1;
            e.effacerNote();
            check(liens(e).length === 0,
                `effacer la note d'arrivée d'un ${lien} retire le ${lien} avec elle`);
        }

        // =====================================================================================
        // B. CE QUI DOIT SURVIVRE SURVIT — la liaison par-dessus la barre de mesure
        // =====================================================================================
        const ed2 = new Editeur(); ed2.nouveau('guitare');
        ed2.dureeCourante = { valeur: 1, points: 0, nolet: null };
        ed2.placerCurseur(0, 0, 0, 0); ed2.saisirChiffre(7);
        ed2.placerCurseur(1, 0, 0, 0); ed2.saisirChiffre(7);
        ed2.placerCurseur(0, 0, 0, 0);
        const poseeA = ed2.basculerLien('tie');
        check(poseeA === true && liens(ed2).join(',') === 'tie',
            'une liaison de la DERNIÈRE note d\'une mesure vers la PREMIÈRE de la suivante se pose '
            + 'et survit : la chaîne traverse les barres, comme chez le lecteur audio — c\'est ainsi '
            + 'qu\'on écrit une note tenue par-dessus la barre');
        ed2.prevenir('edition');
        check(liens(ed2).join(',') === 'tie',
            'et un second passage de l\'invariant ne la retire toujours pas (le nettoyage ne doit pas '
            + 'confondre « mesure suivante » avec « rien »)');

        // =====================================================================================
        // C. POSER UNE LIAISON SANS ARRIVÉE : refus explicite, pas un bouton mort
        // =====================================================================================
        const ed3 = new Editeur(); ed3.nouveau('guitare');
        ed3.dureeCourante = { valeur: 4, points: 0, nolet: null };
        ed3.saisirChiffre(5);          // une seule note, rien après elle
        ed3.placerCurseur(0, 0, 0, 0);
        const refus = ed3.basculerLien('tie');
        check(refus === false && /SUIVANTE/.test(ed3.derniereErreur || ''),
            `poser une liaison sans note d'arrivée refuse et explique (« ${ed3.derniereErreur} ») — `
            + 'sans ce garde-fou l\'invariant la retirerait dans la foulée, et le bouton semblerait '
            + 'mort : on le presse trois fois en cherchant ce qui cloche');
        check(liens(ed3).length === 0, 'et rien n\'est posé au passage');

        const ed3b = deuxLiees();
        ed3b.curseur.evenement = 0;
        check(ed3b.basculerLien('tie') === true && liens(ed3b).length === 0,
            'RETIRER une liaison reste toujours possible, même si la règle de pose ne s\'appliquerait '
            + 'plus : le garde-fou porte sur la pose, jamais sur le retrait');

        // =====================================================================================
        // D. ANNULER RAMÈNE LA LIAISON, EN UN SEUL COUP
        // =====================================================================================
        const ed4 = deuxLiees();
        ed4.curseur.evenement = 0;
        ed4.appliquerDuree(8);
        exiger(liens(ed4).length === 0, 'préalable : la liaison a bien été retirée');
        ed4.annuler();
        check(liens(ed4).join(',') === 'tie' && Math.abs(dureeEnNoires(evts(ed4)[0].duree) - 1) < 1e-9,
            'un seul Ctrl+Z ramène la durée ET la liaison : le nettoyage tombe dans le même point '
            + 'd\'annulation que le geste qui l\'a rendu nécessaire');

        // =====================================================================================
        // E. RESTAURER UN INSTANTANÉ LE REND TEL QUEL — l'invariant ne s'applique pas à l'annulation
        // =====================================================================================
        const ed5 = deuxLiees();
        ed5.curseur.evenement = 0;
        ed5.appliquerDuree(8);
        ed5.annuler();
        ed5.retablir();
        check(liens(ed5).length === 0 && Math.abs(dureeEnNoires(evts(ed5)[0].duree) - 0.5) < 1e-9,
            'et un aller-retour annuler/rétablir retombe exactement sur ses pieds : restaurer un '
            + 'instantané le rend TEL QUEL, sans repasser l\'invariant dessus — le nettoyer à la '
            + 'volée ferait diverger l\'état restauré de l\'instantané empilé');

        // =====================================================================================
        // F. CE QU'UN GESTE COÛTE, QUAND SON NOM NE LE DIT PAS
        // =====================================================================================
        const ed6 = new Editeur(); ed6.nouveau('guitare');
        ed6.dureeCourante = { valeur: 4, points: 0, nolet: null };
        for (let c = 0; c < 6; c++) { ed6.placerCurseur(0, 0, c, 0); ed6.saisirChiffre(3); }
        const avant6 = evts(ed6)[0].notes.length;
        exiger(avant6 === 6, `préalable : un accord de six notes, une par corde (${avant6})`);
        ed6.definirInstrument('basse4');
        const apres6 = evts(ed6)[0].notes.length;
        check(apres6 === 4,
            `passer à la basse 4 cordes retire les deux notes des cordes qui n'existent plus `
            + `(${avant6} → ${apres6})`);
        check(/2 notes/.test(ed6.dernierBilan || '') && /Ctrl\+Z/.test(ed6.dernierBilan || ''),
            `et le DIT, en nommant ce qui manque et comment le récupérer (« ${ed6.dernierBilan} ») — `
            + 'fait depuis une liste déroulante de réglages, où l\'on ne s\'attend pas à perdre de la musique');

        const ed7 = new Editeur(); ed7.nouveau('guitare');
        ed7.ajouterVoix();
        ed7.curseur.voix = 1;
        ed7.dureeCourante = { valeur: 4, points: 0, nolet: null };
        ed7.saisirChiffre(7);
        ed7.supprimerVoix();
        check(ed7.partition.mesures[0].voix.length === 1 && /1 note/.test(ed7.dernierBilan || ''),
            `retirer la seconde voix dit ce qu'elle emportait (« ${ed7.dernierBilan} ») : une fois la `
            + 'palette redessinée, plus rien à l\'écran ne rappelle qu\'elle a existé');

        const ed8 = new Editeur(); ed8.nouveau('guitare');
        ed8.ajouterVoix();
        ed8.supprimerVoix();
        check(ed8.dernierBilan === null,
            'mais une voix VIDE se retire sans un mot : un message qui se déclenche pour rien apprend '
            + 'à ignorer les messages');

        const ed9 = new Editeur(); ed9.nouveau('guitare');
        ed9.dureeCourante = { valeur: 4, points: 0, nolet: null };
        ed9.saisirChiffre(3);
        ed9.definirInstrument('basse4');
        check(ed9.dernierBilan === null,
            'et changer d\'instrument sans rien perdre non plus — la corde 1 existe sur les deux');

        // =====================================================================================
        // G. LE CAS ORDINAIRE NE PAIE RIEN
        // =====================================================================================
        const ed10 = new Editeur(); ed10.nouveau('guitare');
        ed10.dureeCourante = { valeur: 8, points: 0, nolet: null };
        for (let i = 0; i < 8; i++) ed10.saisirChiffre(i);
        check(ed10.derniersLiensRetires === 0 && ed10.dernierBilan === null && ed10.derniereErreur === null,
            'écrire huit croches d\'affilée ne déclenche aucun des trois canaux : ils ne parlent que '
            + 'quand il y a vraiment quelque chose à dire');

        check(true, 'toutes les vérifications se sont exécutées sans exception');
    } catch (err) {
        check(false, 'le banc s\'est arrêté sur une exception — ' + (err && err.message));
        console.error(err);
    }
    bilan();
})();
