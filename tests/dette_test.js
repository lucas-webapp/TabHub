// Banc de LA DETTE — aucun geste de durée n'est refusé, et la mesure dit ce qu'elle doit.
//
// LE DÉFAUT QU'IL FIGE, dans les mots de l'utilisateur : « si j'ai écrit toutes mes notes mais que
// l'une d'entre elles est trop courte, je ne peux plus modifier le rythme : l'application m'indique
// qu'il n'y a plus de place dans la partition. Globalement dès que je fais une erreur de saisie, je
// ne peux plus revenir en arrière et l'application m'oblige à supprimer la mesure entière et à
// recommencer. »
//
// MESURÉ AVANT CORRECTIF, sur une mesure de 4/4 portant huit croches — la chose la plus banale
// qu'on puisse écrire : 32 changements de durée sur 40 étaient REFUSÉS, soit 80 %. Seuls les
// raccourcissements passaient. Sur une mesure à MOITIÉ VIDE (quatre croches puis deux noires de
// silence), encore 65 % de refus : le silence était là, mais pas CONTIGU, et le balayage s'arrêtait
// à la première note rencontrée. Effacer d'abord la note fautive ne débloquait rien non plus.
//
// LE MODÈLE QUI REMPLACE LE REFUS. Un allongement prend d'abord TOUT le silence qui suit, où qu'il
// soit dans la mesure (traverser une note pour atteindre un silence ne coûte rien : un silence n'est
// pas de la musique). Ce qui ne peut pas être payé ainsi DÉCALE : la mesure devient plus longue que
// sa capacité et porte une DETTE, gravée sur elle (« +½ ♩ ») et payable de deux façons — absorber
// (Alt+A : ce qui suit le curseur cède la place) ou déverser (Alt+R : l'excédent part dans une
// mesure neuve).
//
// POURQUOI DÉCALER PLUTÔT QU'ABSORBER PAR DÉFAUT. MuseScore absorbe, et c'est la plainte la plus
// constante de ses forums : on y perd du travail sans l'avoir demandé. Guitar Pro décale et signale
// la mesure fausse, ce que sa documentation présente comme un avantage. Décaler ne perd rien,
// absorber détruit : le geste par défaut est celui qui se rattrape.
//
// CE N'EST PAS LA CASCADE ANNULÉE EN SON TEMPS (« repasse au modèle plus simple, colle à ce qui est
// réalisé sur les logiciels pros ») : celle-là CRÉAIT une mesure toute seule. Ici rien ne sort de la
// mesure sans qu'on le demande, et le banc le vérifie.
//
// AUCUN NAVIGATEUR : tout ce qui suit est du modèle pur, chargé en module ES depuis node.

const creerHarnais = require('./_harness.js');
const { check, exiger, plan, bilan } = creerHarnais('la dette');

(async () => {
    plan(24);
    try {
        const { Editeur } = await import('../src/edit/commands.js');
        const { dureeEnNoires, VALEURS_FIGURES } = await import('../src/model/duration.js');
        const S = await import('../src/model/score.js');
        const { mettreEnPage } = await import('../src/engine/layout.js');

        const total = (ed, m = 0, v = 0) =>
            ed.partition.mesures[m].voix[v].evenements.reduce((t, e) => t + dureeEnNoires(e.duree), 0);
        const durees = (ed, m = 0, v = 0) =>
            ed.partition.mesures[m].voix[v].evenements.map(e => dureeEnNoires(e.duree));
        const nNotes = (ed, m = 0, v = 0) =>
            ed.partition.mesures[m].voix[v].evenements.filter(e => !e.silence && e.notes.length).length;
        const forme = (ed, m = 0, v = 0) => ed.partition.mesures[m].voix[v].evenements
            .map(e => `${dureeEnNoires(e.duree).toFixed(2)}${(e.silence || !e.notes.length) ? '_' : '♪'}`).join(' ');

        /** Une mesure de 4/4 portant `n` croches, écrite comme on l'écrit vraiment — une frappe
         *  par note, l'avance automatique se chargeant du déplacement (voir Editeur.saisirChiffre). */
        const croches = (n = 8) => {
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 8, points: 0, nolet: null };
            for (let i = 0; i < n; i++) ed.saisirChiffre(i % 10);
            ed.placerCurseur(0, 0, 0, 0);
            return ed;
        };

        // =====================================================================================
        // A. PLUS AUCUN REFUS — la mesure du défaut, refaite à l'identique
        // =====================================================================================
        const fixtures = [
            ['mesure pleine, huit croches', () => croches(8)],
            ['mesure à moitié vide, quatre croches', () => croches(4)],
        ];
        const refuses = [];
        let tentes = 0;
        for (const [nom, faire] of fixtures) {
            const modele = faire();
            const nEvts = modele.partition.mesures[0].voix[0].evenements.length;
            for (let i = 0; i < nEvts; i++) {
                const e0 = modele.partition.mesures[0].voix[0].evenements[i];
                if (e0.silence || !e0.notes.length) continue;
                for (const v of VALEURS_FIGURES) {
                    const ed = faire();
                    ed.curseur.evenement = i;
                    const actuelle = dureeEnNoires(ed.partition.mesures[0].voix[0].evenements[i].duree);
                    if (Math.abs(dureeEnNoires({ valeur: v, points: 0, nolet: null }) - actuelle) < 1e-9) continue;
                    tentes++;
                    if (!ed.appliquerDuree(v)) refuses.push(`${nom} — évt ${i} → figure ${v}`);
                }
                const ed2 = faire(); ed2.curseur.evenement = i; tentes++;
                if (!ed2.basculerPoint()) refuses.push(`${nom} — évt ${i} → pointé`);
                const ed3 = faire(); ed3.curseur.evenement = i; tentes++;
                if (!ed3.basculerTriolet()) refuses.push(`${nom} — évt ${i} → triolet`);
            }
        }
        exiger(tentes >= 50, `préalable : ${tentes} changements de durée essayés, assez pour que le compte parle`);
        check(refuses.length === 0,
            `AUCUN des ${tentes} changements de durée n'est refusé (c'était 32 sur 40 — 80 % — sur la `
            + 'seule mesure de huit croches)'
            + (refuses.length ? ` — refusé(s) : ${refuses.slice(0, 5).join(', ')}` : ''));

        // =====================================================================================
        // B. LE SILENCE EST PRIS OÙ QU'IL SOIT — la mesure à moitié vide ne s'endette pas
        // =====================================================================================
        const ed4 = croches(4);
        exiger(Math.abs(durees(ed4)[4] - 2) < 1e-9,
            'préalable : quatre croches puis deux noires de silence, non contiguës à la première note');
        ed4.curseur.evenement = 0;
        ed4.appliquerDuree(2);
        check(Math.abs(total(ed4) - 4) < 1e-9 && S.etatMesure(ed4.partition, 0) === 'complete',
            `allonger la PREMIÈRE note en blanche ne crée aucune dette (${total(ed4).toFixed(2)} noires) : `
            + 'le silence de fin de mesure est pris bien qu\'il ne soit pas contigu — trois notes le '
            + 'séparaient de la note agrandie, et elles ont simplement glissé vers la droite');
        check(nNotes(ed4) === 4,
            `et les quatre notes sont toujours là (${nNotes(ed4)}) : traverser une note pour atteindre `
            + 'un silence ne la mange pas');
        check(ed4.derniereDette === null,
            'aucune dette signalée non plus — il n\'y avait rien à signaler');

        // =====================================================================================
        // C. QUAND IL N'Y A VRAIMENT PLUS DE SILENCE : la dette, et elle se dit
        // =====================================================================================
        const ed5 = croches(8);
        ed5.curseur.evenement = 2;
        const ok5 = ed5.appliquerDuree(4);
        check(ok5 === true && Math.abs(total(ed5) - 4.5) < 1e-9,
            `sur une mesure PLEINE, la même correction passe et la mesure déborde de ½ temps `
            + `(${total(ed5).toFixed(2)} pour 4) — c'est le geste que l'utilisateur ne pouvait pas faire`);
        check(nNotes(ed5) === 8,
            `et les huit notes sont intactes (${nNotes(ed5)}) : décaler ne détruit rien`);
        check(ed5.derniereDette && ed5.derniereDette.mesure === 0 && ed5.derniereDette.evenement === 2
              && Math.abs(ed5.derniereDette.dette - 0.5) < 1e-9,
            `la dette est décrite pour qui doit la présenter : mesure, voix, évènement, montant `
            + `(${JSON.stringify(ed5.derniereDette)})`);
        check(ed5.partition.mesures.length === 4,
            `et AUCUNE mesure n'a été créée (${ed5.partition.mesures.length}) — c'est ce qui distingue `
            + 'ce modèle de la cascade automatique qui avait été annulée');

        // =====================================================================================
        // D. LE CHIFFRE EST GRAVÉ SUR LA MESURE
        // =====================================================================================
        const page = mettreEnPage(ed5.partition, { largeur: 1200 });
        const etiquettes = page.primitives.filter(p => p.t === 'texte' && /♩/.test(p.s));
        check(etiquettes.length === 1 && etiquettes[0].s === '+½ ♩',
            `la mesure porte « ${etiquettes[0]?.s} » au-dessus d'elle — le fond teinté disait qu'il y `
            + 'avait un problème, le chiffre dit lequel, et c\'est lui qui apprend s\'il faut absorber '
            + 'une croche ou trois temps');
        check(etiquettes[0].couleur === 'dette' && etiquettes[0].ancre === 'fin',
            'en rouge franc et ancrée à DROITE — le numéro de mesure et l\'annotation de section sont '
            + 'tous deux ancrés à gauche, deux étiquettes venant de bords opposés ne se rencontrent pas');
        const sansAvertissement = mettreEnPage(ed5.partition, { largeur: 1200, avertirErreurs: false });
        check(sansAvertissement.primitives.filter(p => p.t === 'texte' && /♩/.test(p.s)).length === 0,
            'et elle disparaît quand les avertissements sont coupés (le PDF) : une partition imprimée '
            + 'ne porte pas les avertissements de son éditeur');

        const edManque = new Editeur(); edManque.nouveau('guitare');
        const v0 = edManque.partition.mesures[0].voix[0];
        v0.evenements = [v0.evenements[0]];
        v0.evenements[0].duree = { valeur: 4, points: 0, nolet: null };
        const pageManque = mettreEnPage(edManque.partition, { largeur: 1200 });
        check(pageManque.primitives.some(p => p.t === 'texte' && p.s === '−3 ♩'),
            'une mesure INCOMPLÈTE porte le signe inverse (« −3 ♩ ») : le signe dit lequel des deux '
            + 'règlements s\'applique — seul « Déverser » sait combler un manque');

        // =====================================================================================
        // E. ABSORBER — le règlement destructeur, jamais automatique
        // =====================================================================================
        const ed6 = croches(8);
        ed6.curseur.evenement = 2;
        ed6.appliquerDuree(4);
        const avant6 = nNotes(ed6);
        check(ed6.absorberDette() === true && Math.abs(total(ed6) - 4) < 1e-9,
            `absorber ramène la mesure à sa capacité (${total(ed6).toFixed(2)})`);
        check(nNotes(ed6) === avant6 - 1,
            `en retirant EXACTEMENT une note (${avant6} → ${nNotes(ed6)}) : celle qui suivait le `
            + 'curseur, dont la note agrandie occupe désormais la place');
        check(Math.abs(durees(ed6)[2] - 1) < 1e-9 && Math.abs(durees(ed6)[3] - 0.5) < 1e-9,
            'la note agrandie garde sa noire et ce qui suit retrouve sa position d\'origine — c\'est '
            + 'précisément ce qui distingue l\'absorption du décalage');

        const ed7 = croches(8);
        ed7.curseur.evenement = 7;           // la DERNIÈRE : rien après elle pour absorber
        ed7.appliquerDuree(4);
        check(ed7.absorberDette() === false && /Alt\+R/.test(ed7.derniereErreur || ''),
            `sans matière après le curseur, absorber refuse et renvoie vers l'autre règlement `
            + `(« ${ed7.derniereErreur} ») — le seul refus qui reste, et il nomme une issue qui marche`);

        const ed8 = croches(8);
        check(ed8.absorberDette() === false && /ne déborde pas/.test(ed8.derniereErreur || ''),
            'sur une mesure juste, absorber ne fait rien et le dit');

        // =====================================================================================
        // F. DÉVERSER — l'autre règlement, inchangé
        // =====================================================================================
        const ed9 = croches(8);
        ed9.curseur.evenement = 2;
        ed9.appliquerDuree(4);
        const nAvant = ed9.partition.mesures.length;
        check(ed9.corrigerDebordement() === true
              && Math.abs(total(ed9, 0) - 4) < 1e-9 && Math.abs(total(ed9, 1) - 4) < 1e-9
              && ed9.partition.mesures.length === nAvant + 1,
            `déverser répartit l'excédent dans une mesure NEUVE (${nAvant} → ${ed9.partition.mesures.length}) `
            + 'et les deux mesures tombent juste');
        check(nNotes(ed9, 0) + nNotes(ed9, 1) === 8,
            `et les huit notes sont toutes là (${nNotes(ed9, 0)} + ${nNotes(ed9, 1)}) : déverser ne perd rien non plus`);

        // =====================================================================================
        // G. LA PALETTE NE MENT PLUS — le défaut silencieux
        // =====================================================================================
        const ed10 = croches(8);
        ed10.curseur.evenement = 3;
        ed10.effacerNote();
        ed10.dureeCourante = { valeur: 2, points: 0, nolet: null };   // palette sur BLANCHE
        ed10.saisirChiffre(4);
        check(Math.abs(dureeEnNoires(ed10.partition.mesures[0].voix[0].evenements[3].duree) - 2) < 1e-9,
            'palette sur « blanche », une case tapée écrit une BLANCHE — il s\'écrivait une croche, '
            + 'soit 1,5 temps d\'écart entre le bouton actif et la partition, sans le moindre message');
        check(ed10.derniereDette !== null,
            'et la mesure annonce qu\'elle déborde : ce qui était une perte silencieuse est devenu '
            + 'un fait dit');

        // =====================================================================================
        // H. ANNULER RAMÈNE TOUT, EN UN SEUL COUP
        // =====================================================================================
        const ed11 = croches(8);
        const av11 = forme(ed11);
        ed11.curseur.evenement = 2;
        ed11.appliquerDuree(4);
        ed11.annuler();
        check(forme(ed11) === av11,
            'un seul Ctrl+Z défait l\'allongement et son décalage ensemble');
        const ed12 = croches(8);
        ed12.curseur.evenement = 2;
        ed12.appliquerDuree(4);
        const apres12 = forme(ed12);
        ed12.absorberDette();
        ed12.annuler();
        check(forme(ed12) === apres12,
            'et une absorption est un point d\'annulation à elle seule : on récupère la note mangée '
            + 'sans perdre l\'allongement');

        // =====================================================================================
        // I. LES DEUX VOIX RESTENT INDÉPENDANTES
        // =====================================================================================
        const ed13 = croches(8);
        ed13.ajouterVoix();
        ed13.curseur.voix = 0; ed13.curseur.evenement = 2;
        ed13.appliquerDuree(4);
        check(Math.abs(total(ed13, 0, 1) - 4) < 1e-9,
            `la voix 1 n'a pas bougé (${total(ed13, 0, 1).toFixed(2)} noires) : une dette est une `
            + 'affaire de voix, pas de mesure');

        check(true, 'toutes les vérifications se sont exécutées sans exception');
    } catch (err) {
        check(false, 'le banc s\'est arrêté sur une exception — ' + (err && err.message));
        console.error(err);
    }
    bilan();
})();
