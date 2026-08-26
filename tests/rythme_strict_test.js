// Banc du RYTHME STRICT : une mesure ne déborde JAMAIS sa capacité — ni en la modifiant, ni en y
// insérant, et si elle déborde déjà (fichier ouvert d'avant ce garde-fou), une réparation explicite
// existe pour la remettre d'aplomb sans perdre une seule note.
//
// CE QU'IL PROTÈGE, EN TROIS TEMPS — le premier avait déjà été corrigé mais n'avait encore AUCUNE
// couverture permanente ; le second corrige un vrai bug signalé (une mesure à 4/4 qui grimpait à 13
// temps sans jamais se corriger) :
//   • `appliquerDuree`/`basculerPoint`/`basculerTriolet` (voir Editeur._essaierNouvelleDuree) REFUSENT
//     tout changement qui ferait déborder la mesure — aucune mutation, un message d'erreur.
//   • `insererEvenement` (Entrée) ne glisse plus non plus de force un évènement dans une mesure déjà
//     pleine : en bout de voix, il avance dans une mesure TOUTE NEUVE (jamais une mesure suivante déjà
//     écrite, qu'il ne faut pas déranger) ; au milieu d'une voix, il refuse proprement.
//   • `corrigerDebordement` répare une mesure DÉJÀ trop pleine (donnée existante, antérieure à ce
//     garde-fou) en déplaçant l'excédent, tel quel, dans une ou plusieurs mesures neuves insérées
//     juste après.
//   • `supprimerEvenement` (Ctrl+Suppr — supprimer et DÉCALER, par opposition à Suppr/effacerNote qui
//     vide en place) complète désormais la fin de la mesure par un silence : décaler à gauche ne doit
//     jamais laisser la mesure sous sa capacité.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('rythme strict');

(async () => {
    plan(21);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        const r = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            const dureeEn = (mesure, iVoix = 0) => mesure.voix[iVoix].evenements.reduce(
                (t, e) => t + (4 / e.duree.valeur) * (e.duree.points ? 1.5 : 1), 0);

            // --- A. appliquerDuree refuse tout ce qui déborderait (régression, déjà en place) --------
            ed.nouveau('guitare');
            // Remplit la première mesure exactement à 4/4 : 4 noires.
            ed.partition.mesures[0].voix[0].evenements = [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)]));
            ed.curseur = { mesure: 0, voix: 0, evenement: 0, corde: 0 };
            const avantA = JSON.stringify(ed.partition);
            const refusA = ed.appliquerDuree(2);   // blanche : 2 noires, ne rentre pas derrière trois autres noires
            const inchangeA = JSON.stringify(ed.partition) === avantA;
            const erreurA = ed.derniereErreur;   // lu ICI — un cas suivant l'écrase (voir la note sur B)

            // --- B. insererEvenement en bout de voix, mesure pleine : avance en mesure NEUVE ---------
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)]));
            // Une SECONDE mesure, déjà écrite, existe après — elle ne doit PAS être touchée : la
            // preuve que « insérer » crée une mesure neuve plutôt que d'utiliser celle qui suit déjà.
            ed.partition.mesures[1].voix[0].evenements = [m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 9)]), ...m.creerVoix(3).evenements];
            const mesuresAvantB = ed.partition.mesures.length;
            ed.curseur = { mesure: 0, voix: 0, evenement: 3, corde: 0 };   // sur la 4e (dernière) noire
            const okB = ed.insererEvenement();
            // Tout se lit ICI, immédiatement — `ed.partition` est réutilisée par les cas suivants
            // (chacun repart d'un `nouveau()`), la lire plus tard dans un retour unique donnerait
            // l'état du DERNIER cas exécuté, pas celui de B.
            const mesuresApresB = ed.partition.mesures.length;
            const mesure0ApresB = ed.partition.mesures[0].voix[0].evenements.length;
            const curseurApresB = { ...ed.curseur };
            // La mesure déjà écrite (fret 9) a été DÉCALÉE d'un cran par la nouvelle mesure insérée
            // avant elle (voir Editeur.insererEvenement : splice à curseur.mesure + 1) — elle se
            // retrouve donc à l'index 2, pas 1.
            const notesMesure2ApresB = ed.partition.mesures[2].voix[0].evenements[0].notes[0].frette;

            // --- C. insererEvenement AU MILIEU d'une voix pleine : refuse proprement ------------------
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)]));
            ed.curseur = { mesure: 0, voix: 0, evenement: 1, corde: 0 };   // pas le dernier évènement
            const avantC = JSON.stringify(ed.partition);
            const refusC = ed.insererEvenement();
            const inchangeC = JSON.stringify(ed.partition) === avantC;

            // --- D. une durée qui, à elle seule, dépasse la capacité : refus immédiat -----------------
            ed.nouveau('guitare');
            ed.curseur = { mesure: 0, voix: 0, evenement: 0, corde: 0 };
            ed.dureeCourante = { valeur: 1, points: 0, nolet: null };   // une ronde = 4 noires
            ed.partition.mesures[0].signature = { battements: 2, unite: 4 };   // capacité 2, la ronde ne rentre nulle part
            const refusD = ed.insererEvenement();

            // --- E. corrigerDebordement : 13 temps en 4/4 (une voix), rien ne se perd -----------------
            ed.nouveau('guitare');
            const frettes13 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
            ed.partition.mesures[0].voix[0].evenements = frettes13.map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)]));
            const mesuresAvantE = ed.partition.mesures.length;
            const okE = ed.corrigerDebordement(0);
            const contenuApresE = ed.partition.mesures.map(mm => mm.voix[0].evenements.map(e => (e.silence || !e.notes.length) ? '_' : e.notes[0].frette));
            const dureesApresE = ed.partition.mesures.map(mm => dureeEn(mm));

            // --- F. corrigerDebordement, DEUX voix qui débordent de COMBIEN DE TEMPS différents -----
            // Voix 0 : six noires (6 temps, déborde de 2 → 1 mesure neuve). Voix 1 : cinq noires (5
            // temps, déborde de 1 seul → la même mesure neuve, mais avec 3 temps de silence en plus).
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [1, 2, 3, 4, 5, 6].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)]));
            ed.partition.mesures[0].voix.push({ evenements: [10, 11, 12, 13, 14].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(1, f)])) });
            const okF = ed.corrigerDebordement(0);
            const dureesApresF = ed.partition.mesures.map(mm => mm.voix.map((_, i) => dureeEn(mm, i)));

            // --- G. mesure déjà valide : rien à faire, aucune mutation --------------------------------
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)]));
            const avantG = JSON.stringify(ed.partition);
            const okG = ed.corrigerDebordement(0);
            const inchangeG = JSON.stringify(ed.partition) === avantG;

            // --- H. supprimerEvenement (Ctrl+Suppr) : décale à gauche SANS sous-remplir la mesure -----
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)]));
            ed.curseur = { mesure: 0, voix: 0, evenement: 1, corde: 0 };   // vise la case fret 2
            ed.supprimerEvenement();
            const contenuApresH = ed.partition.mesures[0].voix[0].evenements.map(e => (e.silence || !e.notes.length) ? '_' : e.notes[0].frette);
            const dureeApresH = dureeEn(ed.partition.mesures[0]);

            // --- I. insererAvant (clic droit « insérer à gauche ») : le miroir d'insererEvenement -----
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [10, 11, 12].map(f => m.creerEvenement({ valeur: 8 }, [m.creerNote(0, f)]));   // 3 croches, place libre
            ed.curseur = { mesure: 0, voix: 0, evenement: 1, corde: 0 };   // vise la case fret 11
            ed.dureeCourante = { valeur: 8, points: 0, nolet: null };
            const okI = ed.insererAvant();
            const contenuApresI = ed.partition.mesures[0].voix[0].evenements.map(e => (e.silence || !e.notes.length) ? '_' : e.notes[0].frette);
            const curseurApresI = { ...ed.curseur };

            // Même geste, mais la mesure est déjà pleine : refuse, aucune mutation.
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)]));
            ed.curseur = { mesure: 0, voix: 0, evenement: 1, corde: 0 };
            const avantJ = JSON.stringify(ed.partition);
            const refusJ = ed.insererAvant();
            const inchangeJ = JSON.stringify(ed.partition) === avantJ;

            return {
                refusA, inchangeA, erreurA,
                mesuresAvantB, mesuresApresB, okB, mesure0ApresB, curseurApresB, notesMesure2ApresB,
                refusC, inchangeC,
                refusD,
                mesuresAvantE, okE, contenuApresE, dureesApresE,
                okF, dureesApresF,
                okG, inchangeG,
                contenuApresH, dureeApresH,
                okI, contenuApresI, curseurApresI,
                refusJ, inchangeJ,
            };
        });

        exiger(r.refusA === false && r.inchangeA, 'A. appliquerDuree refuse tout changement qui ferait déborder — aucune mutation');
        check(!!r.erreurA, 'et signale une erreur exploitable (Editeur.derniereErreur)');

        exiger(r.okB === true, 'B. insererEvenement, mesure pleine, bout de voix : réussit (avance au lieu de refuser)');
        check(r.mesuresApresB === r.mesuresAvantB + 1, 'en créant UNE SEULE mesure neuve');
        check(r.mesure0ApresB === 4, 'la mesure d\'origine garde EXACTEMENT ses 4 notes, jamais une 5e en trop');
        check(r.curseurApresB.mesure === 1, 'le curseur suit dans la mesure neuve');
        check(r.notesMesure2ApresB === 9, 'et la mesure déjà écrite, décalée d\'un cran par la neuve, n\'a PAS été touchée (toujours sa propre note)');

        exiger(r.refusC === false && r.inchangeC, 'C. insererEvenement au milieu d\'une voix pleine : refuse, aucune mutation');

        check(r.refusD === false, 'D. une durée plus grande que la capacité de la mesure : refus immédiat, aucune mesure ne peut l\'absorber');

        exiger(r.okE === true, 'E. corrigerDebordement réussit sur une mesure à 13 temps en 4/4');
        check(r.dureesApresE.every(d => Math.abs(d - 4) < 1e-6), 'et CHAQUE mesure (originale et neuves) tombe exactement sur sa capacité');
        check(r.contenuApresE.flat().filter(f => f !== '_').join(',') === '1,2,3,4,5,6,7,8,9,10,11,12,13',
            'les treize notes survivent, dans l\'ordre, aucune perdue ni dupliquée');

        exiger(r.okF === true, 'F. corrigerDebordement avec deux voix qui débordent différemment réussit');
        check(r.dureesApresF.every(mesure => mesure.every(d => Math.abs(d - 4) < 1e-6)),
            'chaque voix, dans chaque mesure (originale et neuves), retombe exactement sur la capacité — la voix la moins chargée est complétée par du silence');

        check(r.okG === false && r.inchangeG, 'G. mesure déjà valide : corrigerDebordement ne fait rien (aucune mutation)');

        exiger(r.contenuApresH.join(',') === '1,3,4,_', 'H. supprimerEvenement (Ctrl+Suppr) retire la case visée et décale les suivantes vers la gauche');
        check(Math.abs(r.dureeApresH - 4) < 1e-6, 'et complète la fin par un silence : la mesure reste À SA CAPACITÉ, jamais sous-remplie');

        exiger(r.okI === true, 'I. insererAvant réussit quand il y a de la place');
        check(r.contenuApresI.join(',') === '10,_,11,12', 'et insère bien AVANT la case visée (celle-ci glisse d\'un cran vers la droite)');
        check(r.curseurApresI.evenement === 2, 'le curseur suit la case visée au départ (fret 11), pas la case neuve');
        check(r.refusJ === false && r.inchangeJ, 'et refuse proprement (aucune mutation) quand la mesure est déjà pleine');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
