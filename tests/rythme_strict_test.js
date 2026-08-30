// Banc du RYTHME STRICT : une mesure ne déborde JAMAIS sa capacité — ni en la modifiant, ni en y
// insérant, et si elle déborde déjà (fichier ouvert d'avant ce garde-fou), une réparation explicite
// existe pour la remettre d'aplomb sans perdre une seule note.
//
// CE QU'IL PROTÈGE, EN PLUSIEURS TEMPS — dont un aller-retour assumé :
//   1. D'abord, le refus pur et simple : `appliquerDuree`/`basculerPoint`/`basculerTriolet` et
//      `insererEvenement`/`insererAvant` REFUSENT tout changement qui ferait déborder la mesure
//      courante — aucune mutation, un message d'erreur exploitable (Editeur.derniereErreur).
//   2. `corrigerDebordement` (Alt+R / bouton « ⇥ Corriger ») répare une mesure DÉJÀ invalide (donnée
//      existante, antérieure à ce garde-fou, ou fichier importé) en déplaçant l'excédent, tel quel,
//      dans une ou plusieurs mesures neuves juste après — ou en comblant un MANQUE sur place par un
//      silence, sans créer de mesure inutile (voir cas L, M).
//   3. Une PARENTHÈSE, ouverte puis refermée : un temps, `insererEvenement`/`insererAvant`/
//      `_essaierNouvelleDuree` ont plutôt RÉPARTI automatiquement tout dépassement au lieu de
//      refuser (retour direct : « je dois toujours pouvoir modifier comme je veux, toute la suite
//      doit se décaler »). À l'usage, ce comportement s'est révélé plus déroutant qu'utile — une
//      mesure neuve apparaissait toute seule, sans qu'on l'ait demandé — et un second retour direct
//      a demandé d'y renoncer : « repasse au modèle plus simple, colle à ce qui est réalisé sur les
//      logiciels pros », qui refusent ou signalent, mais ne restructurent jamais le morceau tout
//      seuls. Ce banc éprouve donc à nouveau le REFUS (point 1), pas la cascade.
//   • `supprimerEvenement` (Ctrl+Suppr — supprimer et DÉCALER, par opposition à Suppr/effacerNote qui
//     vide en place) complète la fin de la mesure par un silence : décaler à gauche ne doit jamais
//     laisser la mesure sous sa capacité (l'autre sens du même principe — jamais au-dessus, jamais
//     en-dessous).
//   • Un SILENCE qui déborde `corrigerDebordement` est RACCOURCI pour ne garder que ce qui tient
//     encore dans la mesure (cas K) ; une voix SOUS-remplie est comblée sur place, sans mesure neuve
//     inutile (cas L) — deux défauts réels trouvés en vérifiant l'étirement de durée à la souris.
//   • `saisirChiffre`/`saisirHauteur` (poser une case ou une hauteur) REDIMENSIONNENT en sûreté le
//     silence vierge qu'elles remplissent, plutôt que d'écraser sa durée telle quelle (cas M) — sans
//     quoi la mesure retombait sous sa capacité dès la toute première frappe sur une partition neuve,
//     silencieusement : le défaut qui rendait ensuite un silence de fin trop court pour être allongé
//     (retour utilisateur : « l'application m'empêche de modifier la durée d'un silence »), et qui,
//     répété mesure après mesure, ne laissait plus d'autre recours que tout supprimer et refaire.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('rythme strict');

(async () => {
    plan(42);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        const r = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            const dureeEn = (mesure, iVoix = 0) => mesure.voix[iVoix].evenements.reduce(
                (t, e) => t + (4 / e.duree.valeur) * (e.duree.points ? 1.5 : 1), 0);

            // --- A. appliquerDuree refuse tout ce qui déborderait -------------------------------------
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

            // --- K. un SILENCE en fin de voix qui déborde CORRIGERDEBORDEMENT est RACCOURCI -----------
            //     jamais déplacé TOUT ENTIER dans une mesure neuve, ce qui laissait la mesure d'origine
            //     SOUS sa capacité (bug trouvé en vérifiant l'étirement de durée à la souris) : ici, la
            //     mesure est rendue invalide DIRECTEMENT (hors édition en direct, qui refuserait), pour
            //     éprouver corrigerDebordement lui-même sur ce cas.
            // Quatre croches (5, 7, 5, 3) puis un silence de 2,5 temps : 4,5 temps écrits, la mesure
            // déborde de 0,5 — juste assez pour que le silence final doive être raccourci, pas déplacé.
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [
                ...[5, 7, 5, 3].map(f => m.creerEvenement({ valeur: 8 }, [m.creerNote(0, f)])),
                ...m.creerVoix(2.5).evenements,
            ];
            const mesuresAvantK = ed.partition.mesures.length;
            const okK = ed.corrigerDebordement(0);
            const contenuMesure0ApresK = ed.partition.mesures[0].voix[0].evenements.map(e => (e.silence || !e.notes.length) ? '_' : e.notes[0].frette);
            const dureeMesure0ApresK = dureeEn(ed.partition.mesures[0]);
            const dernierEvtApresK = ed.partition.mesures[0].voix[0].evenements.at(-1);
            const dureeDernierSilenceApresK = (4 / dernierEvtApresK.duree.valeur) * (dernierEvtApresK.duree.points ? 1.5 : 1);
            const mesuresApresK = ed.partition.mesures.length;
            const dureeMesure1ApresK = dureeEn(ed.partition.mesures[1]);
            const contenuMesure1ApresK = ed.partition.mesures[1].voix[0].evenements.map(e => (e.silence || !e.notes.length) ? '_' : e.notes[0].frette);

            // --- L. corrigerDebordement répare aussi une mesure SOUS-remplie, pas seulement une qui
            //     déborde — le même défaut que K, vu en négatif. Trois croches puis un silence de
            //     croche : 2 temps écrits sur 4, la voix MANQUE de 2 temps — jamais l'inverse (aucune
            //     figure ne dépasse la capacité) : `ecartMesure` est donc NÉGATIF, et le bouton doit
            //     malgré tout apparaître (voir raccourcis.js, Math.abs).
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [
                ...[5, 7, 5].map(f => m.creerEvenement({ valeur: 8 }, [m.creerNote(0, f)])),
                m.creerEvenement({ valeur: 8 }, [], { silence: true }),
            ];
            ed.curseur = { mesure: 0, voix: 0, evenement: 3, corde: 0 };
            const ecartAvantL = ed.ecartMesure();
            const boutonVisibleAvantL = Math.abs(ed.ecartMesure()) > 1e-9;
            const mesuresAvantL = ed.partition.mesures.length;
            const okL = ed.corrigerDebordement();
            const mesuresApresL = ed.partition.mesures.length;
            const contenuApresL = ed.partition.mesures[0].voix[0].evenements.map(e => (e.silence || !e.notes.length) ? '_' : e.notes[0].frette);
            const dureeApresL = dureeEn(ed.partition.mesures[0]);
            const okRappelL = ed.corrigerDebordement();   // déjà valide : ne doit RIEN refaire

            // --- M. saisirChiffre/saisirHauteur gardent la mesure À SA CAPACITÉ dès la TOUTE PREMIÈRE
            //     case tapée — jamais besoin de corrigerDebordement pour une saisie parfaitement
            //     normale. Un silence VIERGE (une mesure neuve, par exemple) n'a AUCUNE raison de déjà
            //     faire la taille de la durée courante (une mesure neuve n'est qu'UN silence couvrant
            //     TOUTE la mesure, bien plus grand qu'une croche) : sans redimensionnement sûr, taper
            //     une case écrasait `duree` telle quelle et la mesure retombait sous sa capacité dès la
            //     première frappe, sans qu'aucun `memoriser`/redistribution n'ait eu la main — trouvé en
            //     essayant d'allonger ensuite un silence de fin qui n'avait alors plus la bonne taille
            //     pour absorber quoi que ce soit (retour utilisateur : « l'application m'empêche de
            //     modifier la durée d'un silence » — et, en amont, « je dois supprimer la mesure et la
            //     refaire en entier » dès qu'une frappe s'arrêtait avant d'avoir rempli toute la mesure).
            ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 8, points: 0, nolet: null };   // croche : plus petit que la ronde de départ
            ed.saisirChiffre(5);
            const ecartApresUneFrappeM = ed.ecartMesure();

            // Le cas le plus courant de tous : quelques notes, puis on S'ARRÊTE — sans aller jusqu'au
            // bout de la mesure (« quatre croches, puis du silence pour le reste »).
            ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 8, points: 0, nolet: null };
            for (const f of [5, 7, 5, 3]) { ed.saisirChiffre(f); ed.deplacerEvenement(1); }
            const ecartApresQuatreM = ed.ecartMesure();
            const contenuApresQuatreM = ed.partition.mesures[0].voix[0].evenements.map(e => (e.silence || !e.notes.length) ? '_' : e.notes[0].frette);

            // Le silence de fin, désormais correctement dimensionné (et non plus un fragment isolé,
            // sans rien après lui à absorber), doit pouvoir être RACCOURCI sans le moindre détour par
            // Corriger — la porte de sortie qui manquait pour se rattraper d'une mesure imparfaite.
            ed.placerCurseur(0, ed.partition.mesures[0].voix[0].evenements.length - 1, 0);
            const okRaccourcirSilenceM = ed.appliquerDuree(16);   // double-croche : plus court que ce qui est déjà là
            const ecartApresRaccourciM = ed.ecartMesure();

            // Même garantie côté PIANO (saisirHauteur, l'équivalent de saisirChiffre sans corde/case).
            ed.nouveau('piano');
            ed.dureeCourante = { valeur: 8, points: 0, nolet: null };
            ed.saisirHauteur(60);   // do central
            const ecartApresHauteurM = ed.ecartMesure();

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
                mesuresAvantK, okK, contenuMesure0ApresK, dureeMesure0ApresK, dureeDernierSilenceApresK,
                mesuresApresK, dureeMesure1ApresK, contenuMesure1ApresK,
                ecartAvantL, boutonVisibleAvantL, mesuresAvantL, okL, mesuresApresL, contenuApresL, dureeApresL, okRappelL,
                ecartApresUneFrappeM, ecartApresQuatreM, contenuApresQuatreM,
                okRaccourcirSilenceM, ecartApresRaccourciM, ecartApresHauteurM,
            };
        });

        exiger(r.refusA === false && r.inchangeA, 'A. appliquerDuree refuse tout changement qui ferait déborder — aucune mutation');
        check(!!r.erreurA, 'et signale une erreur exploitable (Editeur.derniereErreur)');

        exiger(r.okB === true, 'B. insererEvenement, mesure pleine, bout de voix : réussit (avance dans une mesure neuve)');
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

        exiger(r.okK === true, 'K. corrigerDebordement sur un silence final en trop : réussit (raccourci, pas déplacé en bloc)');
        check(r.contenuMesure0ApresK.join(',') === '5,7,5,3,_', 'les quatre croches restent, le silence final reste EN PLACE (raccourci), pas déplacé tout entier');
        check(Math.abs(r.dureeMesure0ApresK - 4) < 1e-6, 'la mesure d\'origine retombe pile sur sa capacité — jamais SOUS-remplie, le bug même que ce cas protège');
        check(Math.abs(r.dureeDernierSilenceApresK - 2) < 1e-6, 'le silence final a bien été RACCOURCI (2,5 temps -> 2), pas simplement déplacé identique');
        check(r.mesuresApresK === r.mesuresAvantK + 1, 'seul le VRAI surplus (0,5 temps) part dans une mesure neuve — une seule suffit');
        check(Math.abs(r.dureeMesure1ApresK - 4) < 1e-6, 'et cette mesure neuve retombe elle aussi exactement sur sa capacité');
        check(r.contenuMesure1ApresK.every(f => f === '_'), 'entièrement du silence : aucune note n\'a été déplacée, seul l\'excédent du silence l\'a été');

        check(r.ecartAvantL < 0, 'L. une voix qui MANQUE de temps (jamais un débordement) donne un écart NÉGATIF');
        check(r.boutonVisibleAvantL === true, 'et le bouton ⇥ Corriger apparaît quand même (Math.abs de l\'écart, pas seulement un excédent)');
        exiger(r.okL === true, 'corrigerDebordement répare aussi ce manque, ne se limite plus au débordement');
        check(r.mesuresApresL === r.mesuresAvantL, 'AUCUNE mesure neuve : il y avait déjà la place, un simple silence de fin suffit');
        check(r.contenuApresL.join(',') === '5,7,5,_,_', 'les trois croches restent, complétées d\'un silence — rien perdu, rien déplacé');
        check(Math.abs(r.dureeApresL - 4) < 1e-6, 'la mesure retombe exactement sur sa capacité');
        check(r.okRappelL === false, 'un second appel ne fait plus rien : la mesure est déjà valide');

        exiger(Math.abs(r.ecartApresUneFrappeM) < 1e-6,
            'M. saisirChiffre : la mesure reste À SA CAPACITÉ dès la TOUTE PREMIÈRE case tapée sur une mesure neuve');
        check(Math.abs(r.ecartApresQuatreM) < 1e-6,
            'et reste à sa capacité même en s\'arrêtant avant la fin (quatre croches, puis plus rien)');
        check(r.contenuApresQuatreM.join(',') === '5,7,5,3,_', 'le contenu écrit est bien celui tapé, suivi d\'un silence de fin');
        exiger(r.okRaccourcirSilenceM === true,
            'et ce silence de fin, désormais correctement dimensionné, se raccourcit sans le moindre détour par ⇥ Corriger');
        check(Math.abs(r.ecartApresRaccourciM) < 1e-6, 'la mesure retombe exactement sur sa capacité après ce raccourci');
        check(Math.abs(r.ecartApresHauteurM) < 1e-6, 'et la même garantie tient au piano (saisirHauteur), dès la première note cliquée');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
