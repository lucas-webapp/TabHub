// Banc de L'AVANCE AUTOMATIQUE — une frappe par note, au lieu de deux.
//
// CE QU'IL MESURE. Écrire huit croches demandait SEIZE frappes : un chiffre, une flèche, un chiffre,
// une flèche. C'est le geste le plus répété de toute l'application, payé le double. Il en demande
// huit. MuseScore et Dorico avancent de la même façon, et c'est ce qui fait qu'on y écrit au fil de
// la pensée plutôt qu'en remplissant un formulaire.
//
// LE PIÈGE QU'IL A FALLU MESURER POUR LE VOIR. L'ancienne règle des cases à deux chiffres était
// « le second chiffre complète le premier s'il arrive dans les 950 ms ». Elle tenait tant que le
// curseur ne bougeait pas tout seul. Avec l'avance, huit croches tapées à la vitesse normale d'un
// humain — bien en deçà de 950 ms d'écart — s'enchaînaient TOUTES sur la même case : mesuré, huit
// frappes donnaient UNE note. Aucun délai ne peut distinguer « 1 puis 2 = case 12 » de « 1 puis 2 =
// deux notes » quand le curseur avance entre les deux. C'est la POSITION qui tranche : le chiffre
// complète la case précédente seulement si le curseur y est resté.
//
// CE QUE ÇA COÛTE, honnêtement : un accord et une case à deux chiffres paient une frappe de retour
// (« ← »), là où chaque note isolée en gagne une. À la guitare les notes isolées dominent largement,
// et qui écrit surtout des accords peut éteindre l'avance dans les réglages.
//
// ON N'A PAS TENTÉ DE DEVINER. Une version envisagée revenait toute seule sur la note quand on
// changeait de corde juste après l'avoir écrite — « ça ne peut être qu'un accord ». C'est faux : une
// mélodie qui saute d'une corde à l'autre est tout aussi courante, et un geste qui devine se trompe
// la moitié du temps. Mieux vaut une règle qu'on apprend en une fois.
//
// AUCUN NAVIGATEUR : tout ce qui suit est du modèle pur, chargé en module ES depuis node.

const creerHarnais = require('./_harness.js');
const { check, exiger, plan, bilan } = creerHarnais('avance automatique');

(async () => {
    plan(21);
    try {
        const { Editeur } = await import('../src/edit/commands.js');
        const { dureeEnNoires } = await import('../src/model/duration.js');

        const neuf = (avance = true) => {
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.avanceAuto = avance;
            ed.dureeCourante = { valeur: 8, points: 0, nolet: null };
            return ed;
        };
        const cases = (ed, m = 0, v = 0) => ed.partition.mesures[m].voix[v].evenements
            .map(e => e.notes.map(n => `${n.corde}:${n.frette}`).join('+') || '_').join(' ');
        const pos = (ed) => `m${ed.curseur.mesure}/e${ed.curseur.evenement}/c${ed.curseur.corde}`;

        // =====================================================================================
        // A. HUIT FRAPPES POUR HUIT CROCHES
        // =====================================================================================
        const ed = neuf();
        for (let i = 0; i < 8; i++) ed.saisirChiffre(i);
        check(cases(ed) === '0:0 0:1 0:2 0:3 0:4 0:5 0:6 0:7',
            `huit frappes donnent huit notes distinctes, dans l'ordre tapé (${cases(ed)}) — c'était `
            + 'seize frappes, et sans l\'avance ces huit-là s\'enchaînaient toutes sur la même case');
        check(ed.partition.mesures[0].voix[0].evenements.every(e => Math.abs(dureeEnNoires(e.duree) - 0.5) < 1e-9),
            'toutes à la durée courante, sans avoir à la redire une seule fois');
        check(ed.curseur.mesure === 1 && ed.curseur.evenement === 0,
            `et la mesure pleine, l'avance franchit la barre (${pos(ed)}) : on continue d'écrire `
            + 'sans lever les doigts');

        // =====================================================================================
        // B. LES CASES À DEUX CHIFFRES : ON REVIENT DESSUS
        // =====================================================================================
        const ed2 = neuf();
        ed2.saisirChiffre(1);
        ed2.deplacerEvenement(-1);
        ed2.saisirChiffre(2);
        check(cases(ed2).startsWith('0:12'),
            `« 1 », « ← », « 2 » donne la case 12 (${cases(ed2)})`);

        const ed3 = neuf();
        ed3.saisirChiffre(1);
        ed3.saisirChiffre(2);
        check(cases(ed3).startsWith('0:1 0:2'),
            `et SANS le retour, deux chiffres font deux notes (${cases(ed3)}) : c'est la contrepartie `
            + 'exacte de la règle, et le cas le plus fréquent des deux');

        const ed4 = neuf();
        ed4.saisirChiffre(2);
        ed4.deplacerEvenement(-1);
        ed4.saisirChiffre(7);
        check(cases(ed4).startsWith('0:7'),
            `un enchaînement hors manche (27 sur une guitare) retombe sur la case 7 (${cases(ed4)})`);

        // =====================================================================================
        // C. L'ACCORD PAIE UNE FRAPPE DE RETOUR, ET UNE SEULE
        // =====================================================================================
        const ed5 = neuf();
        ed5.saisirChiffre(3);
        ed5.deplacerEvenement(-1); ed5.deplacerCorde(1); ed5.saisirChiffre(2);
        ed5.deplacerEvenement(-1); ed5.deplacerCorde(1); ed5.saisirChiffre(0);
        check(cases(ed5).startsWith('0:3+1:2+2:0'),
            `trois cordes sur le même évènement (${cases(ed5)}) — un « ← » par corde, la seule frappe `
            + 'que l\'accord paie');

        // =====================================================================================
        // D. LE MORCEAU GRANDIT SOUS LA FRAPPE — ET AUCUNE NOTE N'EST AVALÉE
        //
        // CETTE SECTION DISAIT LE CONTRAIRE, et c'est elle qui avait tort. Elle figeait la règle
        // « une frappe de saisie ne crée jamais de mesure », au motif qu'une dernière note ne devait
        // pas laisser derrière elle une mesure vide que personne n'a demandée. Le motif est réel ; ce
        // qu'il coûtait ne l'était pas moins : on RECOPIE une partition sans savoir combien de
        // mesures elle fait, on tape simplement — et arrivées au bout, les frappes se mettaient à
        // réécrire la même case en silence. Mesuré avant correctif sur un morceau neuf de 4 mesures :
        // 24 frappes donnaient 16 notes, la seizième case réécrite HUIT FOIS, sans un mot.
        //
        // Le nouveau compte : une mesure vide de trop se voit et s'efface en un geste ; huit notes
        // avalées ne se voient pas du tout. Et « → » créait déjà cette mesure depuis toujours — la
        // saisie ne fait que rejoindre la navigation.
        // =====================================================================================
        const ed6 = neuf();
        ed6.dureeCourante = { valeur: 1, points: 0, nolet: null };   // une ronde par mesure
        const avant6 = ed6.partition.mesures.length;
        const frappes6 = avant6 + 3;
        for (let i = 0; i < frappes6; i++) ed6.saisirChiffre(3);
        const ecrites6 = ed6.partition.mesures
            .flatMap(m => m.voix[0].evenements).filter(e => !e.silence && e.notes.length).length;
        check(ecrites6 === frappes6,
            `${frappes6} frappes d'affilée écrivent ${ecrites6} note(s) — aucune n'est avalée `
            + `(avant correctif : ${avant6}, les suivantes réécrivaient la dernière case)`);
        check(ed6.partition.mesures.length === frappes6 + 1,
            `le morceau a grandi de ${avant6} à ${ed6.partition.mesures.length} mesures, sans qu'on l'ait demandé `
            + 'ni interrompu la frappe');
        check(ed6.curseur.mesure === frappes6,
            `le curseur est sorti dans la mesure neuve (${pos(ed6)}), prêt pour la note suivante`);
        // LE PRIX, assumé et vérifié : la dernière mesure est vide. On le fige pour qu'il reste
        // DÉLIBÉRÉ — une seule, jamais deux, et rien d'autre derrière.
        const derniere6 = ed6.partition.mesures[ed6.partition.mesures.length - 1];
        check(derniere6.voix[0].evenements.every(e => e.silence || !e.notes.length),
            'le prix assumé : une mesure vide au bout, et une seule');
        const ed7 = neuf();
        ed7.allerAMesure(ed7.partition.mesures.length - 1, -1);
        const avant7 = ed7.partition.mesures.length;
        ed7.deplacerEvenement(1);
        check(ed7.partition.mesures.length === avant7 + 1,
            '« → » explicite garde le même droit — les deux gestes suivent désormais la même règle');
        // ET UN SEUL Ctrl+Z défait la note ET la mesure qu'elle a fait naître : `memoriser` court
        // AVANT l'écriture, donc avant l'avance. Sans cela, la correction aurait échangé une perte
        // silencieuse contre deux annulations pour un seul geste.
        const edUndo = neuf();
        edUndo.dureeCourante = { valeur: 1, points: 0, nolet: null };
        // La BORNE EST PRISE D'ABORD : depuis que la saisie fait grandir le morceau, relire
        // `mesures.length` à chaque tour donnerait une boucle sans fin. (Écrit tel quel une
        // première fois — le banc a tourné jusqu'à ce qu'on le tue.)
        const nMesures = edUndo.partition.mesures.length;
        for (let i = 0; i < nMesures; i++) edUndo.saisirChiffre(3);
        const avantUndo = edUndo.partition.mesures.length;
        edUndo.saisirChiffre(5);                                        // la note qui ouvre une mesure
        check(edUndo.partition.mesures.length === avantUndo + 1,
            `préalable : la note a bien ouvert une mesure (${avantUndo} → ${edUndo.partition.mesures.length})`);
        edUndo.annuler();
        check(edUndo.partition.mesures.length === avantUndo,
            `un seul Ctrl+Z défait la note ET sa mesure (${edUndo.partition.mesures.length} mesures)`);

        // =====================================================================================
        // E. UN SEUL POINT D'ANNULATION PAR CASE
        // =====================================================================================
        const ed8 = neuf();
        ed8.saisirChiffre(3);
        ed8.saisirChiffre(5);
        const avant8 = cases(ed8);
        ed8.annuler();
        check(cases(ed8).startsWith('0:3 _') && avant8.startsWith('0:3 0:5'),
            `un seul Ctrl+Z retire la dernière case, pas son avance (${cases(ed8)}) — l'avance passe par `
            + 'un chemin qui ne mémorise rien, précisément pour ça');

        // =====================================================================================
        // F. ÉTEINTE, TOUT REDEVIENT COMME AVANT
        // =====================================================================================
        const ed9 = neuf(false);
        ed9.saisirChiffre(1);
        check(ed9.curseur.evenement === 0, 'avance éteinte : le curseur ne bouge pas');
        ed9.saisirChiffre(2);
        check(cases(ed9).startsWith('0:12'),
            `et les deux chiffres se combinent sur place, sans retour (${cases(ed9)}) : la règle de `
            + 'position sert les deux modes sans se dédoubler');
        const ed10 = neuf(false);
        for (let i = 0; i < 4; i++) { if (i) ed10.deplacerEvenement(1); ed10.saisirChiffre(i); }
        check(cases(ed10).startsWith('0:0 0:1 0:2 0:3'),
            'et l\'ancienne façon d\'écrire — chiffre, flèche, chiffre, flèche — donne exactement le même résultat');

        // =====================================================================================
        // G. LES COMMANDES QUI S'APPUIENT SUR saisirChiffre NE DOIVENT PAS AVANCER
        // =====================================================================================
        // TROUVÉ PAR UN BANC, au premier essai : `poserGhost` écrit sa note de support par
        // `saisirChiffre(0)`, puis relit `noteCourante()` pour la marquer fantôme. Avec l'avance,
        // cette relecture désignait déjà la case SUIVANTE — le bouton « ✕ » ne faisait plus rien.
        const ed11 = neuf();
        ed11.poserGhost();
        const e0 = ed11.partition.mesures[0].voix[0].evenements[0];
        check(e0.notes.length === 1 && e0.notes[0].ghost === true,
            'le bouton « ✕ » pose bien une note fantôme, malgré l\'avance');
        check(ed11.curseur.evenement === 0,
            `et n'avance PAS (${pos(ed11)}) : c'est une bascule, le second appui la retire, il faut `
            + 'être resté dessus');
        ed11.poserGhost();
        check(ed11.partition.mesures[0].voix[0].evenements[0].notes[0].ghost === false,
            'ce second appui la retire bien');

        check(true, 'toutes les vérifications se sont exécutées sans exception');
    } catch (err) {
        check(false, 'le banc s\'est arrêté sur une exception — ' + (err && err.message));
        console.error(err);
    }
    bilan();
})();
