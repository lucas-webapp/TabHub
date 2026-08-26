// Banc du RYTHME STRICT : une mesure ne reste JAMAIS visiblement débordée — ni en la modifiant, ni en
// y insérant — mais PLUS AUCUNE de ces opérations ne REFUSE pour autant faute de place : l'excédent
// est aussitôt réparti dans des mesures neuves, automatiquement.
//
// CE QU'IL PROTÈGE — TROIS GÉNÉRATIONS DE CE MÊME PRINCIPE :
//   1. D'abord, le refus pur et simple : `appliquerDuree`/`basculerPoint`/`basculerTriolet` et
//      `insererEvenement`/`insererAvant` refusaient tout ce qui ferait déborder la mesure courante.
//      Une mesure à 4/4 qui grimpait à 13 temps sans jamais se corriger (bug signalé) a montré que ce
//      refus bloquait l'édition en plein geste — l'utilisateur doit TOUJOURS pouvoir modifier comme il
//      veut, la suite doit se décaler en conséquence.
//   2. `corrigerDebordement` (Alt+R) est alors devenu le mécanisme de RÉPARATION : déplacer l'excédent
//      d'une mesure déjà trop pleine, tel quel, dans une ou plusieurs mesures neuves juste après.
//   3. Ce même mécanisme est maintenant ENCHAÎNÉ AUTOMATIQUEMENT par toute édition qui ferait déborder
//      la mesure courante (voir Editeur._absorberEtLocaliser, partagé par les cinq commandes
//      ci-dessus) : plus aucune ne refuse faute de place, chacune s'applique et répartit l'excédent
//      dans le MÊME geste (une seule entrée d'annulation). Le curseur suit l'évènement modifié ou
//      inséré, où qu'il ait fini — dans la mesure courante si tout tenait, dans une mesure neuve
//      sinon. Un seul cas reste un refus : une figure qui, À ELLE SEULE, dépasse la capacité d'une
//      mesure entière — aucune répartition ne peut jamais l'y faire tenir.
//   • `supprimerEvenement` (Ctrl+Suppr — supprimer et DÉCALER, par opposition à Suppr/effacerNote qui
//     vide en place) complète la fin de la mesure par un silence : décaler à gauche ne doit jamais
//     laisser la mesure sous sa capacité (l'autre sens du même principe — jamais au-dessus, jamais
//     en-dessous).

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('rythme strict');

(async () => {
    plan(34);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        const r = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            const dureeEn = (mesure, iVoix = 0) => mesure.voix[iVoix].evenements.reduce(
                (t, e) => t + (4 / e.duree.valeur) * (e.duree.points ? 1.5 : 1), 0);

            // --- A. appliquerDuree : un allongement qui déborde RÉPARTIT, ne refuse plus -------------
            ed.nouveau('guitare');
            // Remplit la première mesure exactement à 4/4 : 4 noires, aucun silence entre elles pour
            // absorber quoi que ce soit — l'allongement ci-dessous doit donc déborder intégralement.
            ed.partition.mesures[0].voix[0].evenements = [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)]));
            ed.curseur = { mesure: 0, voix: 0, evenement: 0, corde: 0 };
            const mesuresAvantA = ed.partition.mesures.length;
            const okA = ed.appliquerDuree(2);   // blanche : 2 noires — 1 de plus que la noire d'origine, rien à absorber
            const contenuMesure0ApresA = ed.partition.mesures[0].voix[0].evenements.map(e => (e.silence || !e.notes.length) ? '_' : e.notes[0].frette);
            const dureeMesure0ApresA = dureeEn(ed.partition.mesures[0]);
            const contenuMesure1ApresA = ed.partition.mesures[1].voix[0].evenements.map(e => (e.silence || !e.notes.length) ? '_' : e.notes[0].frette);
            const curseurApresA = { ...ed.curseur };

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

            // --- C. insererEvenement AU MILIEU d'une voix pleine : répartit aussi, ne refuse plus ----
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)]));
            ed.curseur = { mesure: 0, voix: 0, evenement: 1, corde: 0 };   // pas le dernier évènement (vise fret 2)
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };   // une noire, pour un calcul simple
            const okC = ed.insererEvenement();
            const contenuMesure0ApresC = ed.partition.mesures[0].voix[0].evenements.map(e => (e.silence || !e.notes.length) ? '_' : e.notes[0].frette);
            const contenuMesure1ApresC = ed.partition.mesures[1].voix[0].evenements.map(e => (e.silence || !e.notes.length) ? '_' : e.notes[0].frette);
            const curseurApresC = { ...ed.curseur };

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

            // Même geste, mais la mesure est déjà pleine : répartit désormais, ne refuse plus.
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)]));
            ed.curseur = { mesure: 0, voix: 0, evenement: 1, corde: 0 };   // vise fret 2
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            const okJ = ed.insererAvant();
            const contenuMesure0ApresJ = ed.partition.mesures[0].voix[0].evenements.map(e => (e.silence || !e.notes.length) ? '_' : e.notes[0].frette);
            const contenuMesure1ApresJ = ed.partition.mesures[1].voix[0].evenements.map(e => (e.silence || !e.notes.length) ? '_' : e.notes[0].frette);
            const curseurApresJ = { ...ed.curseur };

            // --- K. UN SEUL Ctrl+Z défait tout le geste (insertion + répartition) ---------------------
            // La mesure neuve créée par le geste J ci-dessus ne doit pas rester un « second » pas
            // d'annulation séparé : un seul memoriser() couvre les deux (voir _essaierNouvelleDuree /
            // insererEvenement / insererAvant, qui appellent _absorberEtLocaliser SANS memoriser
            // supplémentaire).
            const mesuresAvantK = ed.partition.mesures.length;
            const okK = ed.annuler();
            const mesuresApresUnSeulK = ed.partition.mesures.length;
            const contenuMesure0ApresK = ed.partition.mesures[0].voix[0].evenements.map(e => (e.silence || !e.notes.length) ? '_' : e.notes[0].frette);

            return {
                mesuresAvantA, okA, contenuMesure0ApresA, dureeMesure0ApresA, contenuMesure1ApresA, curseurApresA,
                mesuresAvantB, mesuresApresB, okB, mesure0ApresB, curseurApresB, notesMesure2ApresB,
                okC, contenuMesure0ApresC, contenuMesure1ApresC, curseurApresC,
                refusD,
                mesuresAvantE, okE, contenuApresE, dureesApresE,
                okF, dureesApresF,
                okG, inchangeG,
                contenuApresH, dureeApresH,
                okI, contenuApresI, curseurApresI,
                okJ, contenuMesure0ApresJ, contenuMesure1ApresJ, curseurApresJ,
                mesuresAvantK, okK, mesuresApresUnSeulK, contenuMesure0ApresK,
            };
        });

        exiger(r.okA === true, 'A. appliquerDuree, allongement sans place : réussit désormais (répartit au lieu de refuser)');
        check(r.contenuMesure0ApresA.join(',') === '1,2,3', 'la mesure d\'origine garde ce qui tient (fret 1 devenu blanche + frets 2, 3)');
        check(Math.abs(r.dureeMesure0ApresA - 4) < 1e-6, 'et retombe exactement sur sa capacité (2 + 1 + 1)');
        check(r.contenuMesure1ApresA[0] === 4, 'fret 4, qui ne tenait plus, se retrouve dans une mesure neuve juste après');
        check(r.curseurApresA.mesure === 0 && r.curseurApresA.evenement === 0, 'le curseur reste sur l\'évènement modifié (resté dans la mesure d\'origine)');

        exiger(r.okB === true, 'B. insererEvenement, mesure pleine, bout de voix : réussit (avance au lieu de refuser)');
        check(r.mesuresApresB === r.mesuresAvantB + 1, 'en créant UNE SEULE mesure neuve');
        check(r.mesure0ApresB === 4, 'la mesure d\'origine garde EXACTEMENT ses 4 notes, jamais une 5e en trop');
        check(r.curseurApresB.mesure === 1, 'le curseur suit dans la mesure neuve');
        check(r.notesMesure2ApresB === 9, 'et la mesure déjà écrite, décalée d\'un cran par la neuve, n\'a PAS été touchée (toujours sa propre note)');

        exiger(r.okC === true, 'C. insererEvenement AU MILIEU d\'une voix pleine : réussit aussi désormais (répartit)');
        check(r.contenuMesure0ApresC.join(',') === '1,2,_,3', 'la nouvelle case s\'intercale bien à l\'endroit visé (entre fret 2 et fret 3)');
        check(r.contenuMesure1ApresC[0] === 4, 'et fret 4, qui ne tenait plus, se retrouve dans une mesure neuve');
        check(r.curseurApresC.mesure === 0 && r.curseurApresC.evenement === 2, 'le curseur suit la case tout juste insérée');

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

        exiger(r.okJ === true, 'même geste (insererAvant), mesure déjà pleine cette fois : répartit aussi désormais, ne refuse plus');
        check(r.contenuMesure0ApresJ.join(',') === '1,_,2,3', 'la nouvelle case s\'intercale AVANT la case visée (fret 2), qui glisse d\'un cran');
        check(r.contenuMesure1ApresJ[0] === 4, 'fret 4, qui ne tenait plus, se retrouve dans une mesure neuve');
        check(r.curseurApresJ.mesure === 0 && r.curseurApresJ.evenement === 2, 'le curseur suit la case VISÉE (fret 2), pas la case neuve insérée devant elle');

        exiger(r.mesuresAvantK === 5 && r.okK === true, 'K. la mesure neuve créée par J existe bien avant l\'annulation, et Ctrl+Z réussit');
        check(r.mesuresApresUnSeulK === 4, 'UN SEUL Ctrl+Z retire la mesure neuve : insertion + répartition ne comptent que pour UNE annulation');
        check(r.contenuMesure0ApresK.join(',') === '1,2,3,4', 'et retrouve le contenu EXACT d\'avant le geste, rien de partiellement défait');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
