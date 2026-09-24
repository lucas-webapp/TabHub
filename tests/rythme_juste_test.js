// Banc du RYTHME JUSTE — une mesure somme EXACTEMENT ce qu'elle doit, triolets et triples-croches
// compris, et ce qui est écrit est ce qui sonne.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// LE DÉFAUT QU'IL FIGE (lot 0), et c'était le geste le plus banal du répertoire de guitare.
//
// Écrire TROIS CROCHES EN TRIOLET dans une mesure à 4/4 laissait la mesure à 3,875 noires au lieu
// de 4. Le temps restant était rendu par `score.js#figuresPour`, qui ne cherche que des figures
// BINAIRES — et il n'existe aucune suite d'entre elles qui somme un tiers de temps. Mesuré :
// `figuresPour(2/3)` ne rend que 0,625. La boucle abandonnait le reliquat (« reste plus court qu'une
// triple-croche ») EN SILENCE, un vingt-quatrième de temps à chaque fois.
//
// DOUZE CROCHES EN TRIOLET — un temps de swing ordinaire — faisaient pire : la mesure ressortait à
// 4,916667 noires, DÉBORDANTE de presque un temps, et la dixième note sortait en double-croche
// (0,250) au lieu d'une croche de triolet (0,333), son triolet perdu en route sans un mot.
//
// LA CAUSE N'ÉTAIT PAS LE DÉCOUPEUR, C'ÉTAIT SON AVEUGLEMENT : une durée ne se laisse écrire qu'en
// fonction de la grille sur laquelle elle tombe. Le correctif DONNE la grille à la conversion, et
// cette grille se DÉDUIT de ce que la mesure porte déjà — temps par temps (voir
// model/rythme.js#grilleDeMesure). Un temps qui porte un triolet est en trois, un temps qui porte
// une triple-croche est en huit, et les deux cohabitent dans la même mesure.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// ET LE SECOND (lot 1) : CE QUI EST ÉCRIT N'ÉTAIT PAS CE QUI SONNAIT.
//
// `aplatir` posait les évènements à leur durée ÉCRITE tout en avançant de mesure en mesure d'une
// CAPACITÉ déclarée — deux comptes différents pour le même axe du temps. Il suffisait de changer la
// signature d'un 4/4 déjà écrit pour du 3/4 : la dernière note de la mesure courait de 3,00 à 4,00
// pendant que la première de la suivante démarrait à 3,00. Un temps entier où deux notes sonnaient
// ensemble. `score.js#longueurMesure` donne désormais UNE réponse pour les deux.
//
// AUCUN NAVIGATEUR : tout ce qui suit est du modèle pur, chargé en module ES depuis node.

const creerHarnais = require('./_harness.js');
const { check, exiger, plan, bilan } = creerHarnais('rythme juste');

const SIG = { battements: 4, unite: 4 };
const T3 = { dans: 3, valent: 2 };

(async () => {
    plan(26);
    try {
        const { Editeur } = await import('../src/edit/commands.js');
        const { dureeEnNoires } = await import('../src/model/duration.js');
        const S = await import('../src/model/score.js');
        const R = await import('../src/model/rythme.js');

        const total = (ed, m = 0, v = 0) =>
            ed.partition.mesures[m].voix[v].evenements.reduce((t, e) => t + dureeEnNoires(e.duree), 0);
        const durees = (ed, m = 0, v = 0) =>
            ed.partition.mesures[m].voix[v].evenements.map(e => dureeEnNoires(e.duree));
        const notes = (ed, m = 0, v = 0) =>
            ed.partition.mesures[m].voix[v].evenements.filter(e => !e.silence && e.notes.length);
        const neuf = () => { const ed = new Editeur(); ed.nouveau('guitare'); return ed; };

        // =====================================================================================
        // A. LE TRIOLET — la reproduction exacte du défaut
        // =====================================================================================
        // LE TRIOLET SE CHOISIT AVANT D'ÉCRIRE, comme la durée : avec l'avance automatique, le
        // curseur a quitté la note dès qu'elle est posée. C'est aussi la façon dont on écrit dans
        // MuseScore et Dorico — on règle la figure, puis on la remplit.
        const ed = neuf();
        ed.dureeCourante = { valeur: 8, points: 0, nolet: { dans: 3, valent: 2 } };
        ed.saisirChiffre(1);
        ed.saisirChiffre(2);
        ed.saisirChiffre(3);

        exiger(notes(ed).length === 3 && notes(ed).every(e => e.duree.nolet),
            'préalable : trois croches de triolet sont bien écrites, chacune marquée n-olet');
        check(Math.abs(total(ed) - 4) < 1e-9,
            `un triolet de trois croches laisse la mesure à EXACTEMENT sa capacité — mesuré `
            + `${total(ed).toFixed(6)} noire(s) pour 4 (c'était 3,875000 : un huitième de temps perdu `
            + 'sans un mot à chaque triolet écrit)');
        check(S.etatMesure(ed.partition, 0) === 'complete',
            `et la mesure se déclare complète (${S.etatMesure(ed.partition, 0)}) — donc aucun `
            + 'rectangle d\'avertissement pour avoir écrit une figure parfaitement ordinaire');
        const silA = durees(ed).slice(3);
        check(silA.length === 2 && Math.abs(silA[0] - 1) < 1e-9 && Math.abs(silA[1] - 2) < 1e-9,
            `les trois temps rendus s'écrivent « noire + blanche » (${silA.map(d => d.toFixed(2)).join(' + ')}), `
            + 'alignés sur les temps — jamais une blanche pointée qui enjamberait la moitié de la mesure');

        // =====================================================================================
        // B. DOUZE CROCHES DE TRIOLET — le cas qui débordait d'un temps
        // =====================================================================================
        const ed2 = neuf();
        ed2.dureeCourante = { valeur: 8, points: 0, nolet: { dans: 3, valent: 2 } };
        for (let i = 0; i < 12; i++) { if (ed2.curseur.mesure !== 0) break; ed2.saisirChiffre(i % 10); }
        const n12 = notes(ed2);
        check(n12.length === 12,
            `douze croches de triolet tiennent bien dans la mesure (${n12.length}/12)`);
        check(n12.every(e => e.duree.nolet && Math.abs(dureeEnNoires(e.duree) - 1 / 3) < 1e-9),
            'et les DOUZE valent un tiers de temps, marquées n-olet — la dixième sortait en '
            + 'double-croche (0,250), son triolet perdu en chemin');
        check(Math.abs(total(ed2) - 4) < 1e-9,
            `la mesure somme exactement 4 noires (mesuré ${total(ed2).toFixed(6)} — c'était 4,916667, `
            + 'soit presque un temps de débordement)');

        // =====================================================================================
        // C. LA TRIPLE-CROCHE, et sa cohabitation avec le triolet
        // =====================================================================================
        const ed3 = neuf();
        ed3.dureeCourante = { valeur: 32, points: 0, nolet: null };
        for (let i = 0; i < 8; i++) ed3.saisirChiffre(i);
        check(notes(ed3).length === 8 && notes(ed3).every(e => Math.abs(dureeEnNoires(e.duree) - 0.125) < 1e-9)
              && Math.abs(total(ed3) - 4) < 1e-9,
            `huit triples-croches remplissent le premier temps et la mesure reste juste `
            + `(${total(ed3).toFixed(6)} noire(s))`);

        const ed4 = neuf();
        ed4.dureeCourante = { valeur: 4, points: 0, nolet: null };
        ed4.saisirChiffre(1);
        ed4.dureeCourante = { valeur: 32, points: 0, nolet: null };
        ed4.saisirChiffre(2);
        const apres4 = durees(ed4).slice(2);
        check(Math.abs(total(ed4) - 4) < 1e-9
              && apres4.length === 4 && Math.abs(apres4[0] - 0.125) < 1e-9 && Math.abs(apres4[1] - 0.25) < 1e-9
              && Math.abs(apres4[2] - 0.5) < 1e-9 && Math.abs(apres4[3] - 2) < 1e-9,
            'une triple-croche posée au milieu d\'un rythme binaire rend le reste en figures qui '
            + `DOUBLENT à chaque pas (${apres4.map(d => d.toFixed(3)).join(' + ')}) : chacune commence `
            + 'sur un multiple de sa propre durée, ce qu\'écrirait un copiste');

        const ed5 = neuf();
        ed5.dureeCourante = { valeur: 8, points: 0, nolet: { dans: 3, valent: 2 } };
        ed5.saisirChiffre(0);
        ed5.saisirChiffre(1);
        ed5.saisirChiffre(2);
        ed5.dureeCourante = { valeur: 32, points: 0, nolet: null };
        ed5.saisirChiffre(7);
        check(Math.abs(total(ed5) - 4) < 1e-9 && notes(ed5).length === 4,
            `un temps EN TROIS et un temps EN HUIT dans la même mesure : elle reste juste `
            + `(${total(ed5).toFixed(6)}). Chaque temps a SA grille — un 4/4 peut porter un triolet `
            + 'sur le temps 1 et des triples-croches sur le temps 2, et c\'est ce que fait le blues');

        // =====================================================================================
        // D. LA GRILLE SE DÉDUIT VRAIMENT — et le repli ne sert jamais
        // =====================================================================================
        const ev = (valeur, points = 0, nolet = null) => ({ duree: { valeur, points, nolet } });
        check(R.grilleDeMesure(SIG, [ev(8, 0, T3)], [1 / 3])[0].sub === 3
              && R.grilleDeMesure(SIG, [ev(32)], [0.125])[0].sub === 8
              && R.grilleDeMesure(SIG, [ev(16), ev(16)], [0.5])[0].sub === 4
              && R.grilleDeMesure(SIG, [], [])[0].sub === 1,
            'la grille se déduit temps par temps : 3 sous un triolet, 8 sous une triple-croche, '
            + '4 sous des doubles, 1 sur un temps qu\'aucune frontière ne coupe');

        const catalogue = [
            ['reste du temps après une croche de triolet', [ev(8, 0, T3)], 1 / 3, 2 / 3],
            ['dernier tiers après deux croches de triolet', [ev(8, 0, T3), ev(8, 0, T3)], 2 / 3, 1 / 3],
            ['les 5/6 qui suivent un triolet de DOUBLES', [ev(16, 0, T3)], 1 / 6, 5 / 6],
            ['reste du temps après une triple-croche', [ev(32)], 0.125, 0.875],
            ['fin de mesure après deux triples-croches', [ev(32), ev(32)], 0.25, 3.75],
            ['2,5 temps rendus depuis le milieu du temps 2', [ev(4), ev(8)], 1.5, 2.5],
            ['une mesure entière, vide', [], 0, 4],
        ];
        const replis = [];
        const faux = [];
        for (const [nom, evts, debut, duree] of catalogue) {
            const r = R.silencesAlignes(SIG, evts, debut, duree);
            if (r === null) { replis.push(nom); continue; }
            const s = r.reduce((t, e) => t + dureeEnNoires(e.duree), 0);
            if (Math.abs(s - duree) > 1e-9) faux.push(`${nom} (${s.toFixed(6)} pour ${duree.toFixed(6)})`);
        }
        check(replis.length === 0,
            'AUCUN des sept cas du catalogue ne retombe sur l\'ancien découpage — le repli existe '
            + 'comme filet, jamais comme chemin normal'
            + (replis.length ? ` — retombé(s) : ${replis.join(', ')}` : ''));
        check(faux.length === 0,
            'et chacun somme au millionième ce qu\'on lui a demandé'
            + (faux.length ? ` — faux : ${faux.join(', ')}` : ''));

        const cinqSixiemes = R.silencesAlignes(SIG, [ev(16, 0, T3)], 1 / 6, 5 / 6);
        check(cinqSixiemes.length === 3
              && cinqSixiemes.every(e => e.duree.nolet)
              && Math.abs(dureeEnNoires(cinqSixiemes[0].duree) - 1 / 6) < 1e-9,
            'les 5/6 d\'un temps en six s\'écrivent « double³ + croche³ + croche³ » '
            + `(${cinqSixiemes.map(e => dureeEnNoires(e.duree).toFixed(4)).join(' + ')}) — le cas que la `
            + 'conversion seule ne savait pas nommer, et que le parcours cellule par cellule attrape');

        // =====================================================================================
        // E. NEUTRALISATION — le banc mesure-t-il ce qu'il prétend mesurer ?
        // =====================================================================================
        const sansGrille = R.silencesAlignes({ battements: 4, unite: 4 }, [ev(8, 0, T3)], 1 / 3, 2 / 3);
        const ancien = S.decouperEnEvenements(2 / 3).reduce((t, e) => t + dureeEnNoires(e.duree), 0);
        check(Math.abs(ancien - 2 / 3) > 1e-6 && Math.abs(
            sansGrille.reduce((t, e) => t + dureeEnNoires(e.duree), 0) - 2 / 3) < 1e-9,
            `l'ancien découpage se trompe toujours sur ce même tiers de temps (${ancien.toFixed(6)} `
            + 'pour 0,666667) : la différence vient bien de la grille, pas d\'un hasard du banc');

        // =====================================================================================
        // F. LOT 1 — CE QUI EST ÉCRIT EST CE QUI SONNE
        // =====================================================================================
        const ed6 = neuf();
        ed6.dureeCourante = { valeur: 4, points: 0, nolet: null };
        for (let i = 0; i < 4; i++) { ed6.curseur.evenement = i; ed6.saisirChiffre(i); }
        ed6.curseur.mesure = 1; ed6.curseur.evenement = 0; ed6.saisirChiffre(9);
        ed6.curseur.mesure = 0; ed6.curseur.evenement = 0;
        ed6.definirSignature(3, 4);
        exiger(S.etatMesure(ed6.partition, 0) === 'debordante',
            'préalable : une mesure de quatre noires passée en 3/4 est bien trop pleine');
        const plat = S.aplatir(ed6.partition).filter(a => a.ref.notes.length);
        const derM0 = plat.filter(a => a.mesure === 0).slice(-1)[0];
        const preM1 = plat.find(a => a.mesure === 1);
        const chevauchement = (derM0.debut + derM0.duree) - preM1.debut;
        check(chevauchement <= 1e-9,
            `la dernière note de la mesure trop pleine finit à ${(derM0.debut + derM0.duree).toFixed(2)} `
            + `et la première de la suivante commence à ${preM1.debut.toFixed(2)} : aucun `
            + `chevauchement (c'était UN TEMPS ENTIER où deux notes sonnaient ensemble)`);
        check(Math.abs(S.longueurMesure(ed6.partition, 0) - 4) < 1e-9,
            `la mesure trop pleine prend sur l'axe du temps la place qu'elle occupe vraiment `
            + `(${S.longueurMesure(ed6.partition, 0)} noires), pas celle que sa signature annonce (3)`);

        const ed7 = neuf();
        check(Math.abs(S.longueurMesure(ed7.partition, 0) - S.capaciteMesure(ed7.partition, 0)) < 1e-9,
            'une mesure ORDINAIRE garde exactement sa capacité : la règle ne change rien au cas '
            + 'général, elle ne rattrape que la mesure fausse');

        const ed8 = neuf();
        ed8.dureeCourante = { valeur: 4, points: 0, nolet: null };
        ed8.saisirChiffre(5);
        ed8.placerCurseur(0, 0, 0, 0);
        ed8.appliquerDuree(8);          // la mesure est alors INCOMPLÈTE ? non : le temps est rendu
        check(Math.abs(S.longueurMesure(ed8.partition, 0) - 4) < 1e-9,
            'et une mesure qui ne serait PAS complète garde sa capacité — le silence manquant '
            + 's\'entend comme un silence, jamais comme un empiètement sur la mesure suivante');

        // LA SOMME EST CALCULÉE, PAS ÉCRITE EN DUR. Elle l'était (« 4 + 4 + 4 + 4 »), et ce total
        // supposait que les mesures VIDES qui suivent gardent la capacité d'avant le changement de
        // signature — ce qui était vrai tant que `definirSignature` ne redimensionnait que la mesure
        // courante, et n'était qu'un effet de bord du défaut qu'elle a depuis corrigé (voir
        // signature_test.js). Ce qu'on veut vraiment vérifier ici tient en une phrase : la mesure
        // trop pleine compte pour ce qu'elle DURE, pas pour ce que sa signature annonce.
        const longueurs = ed6.partition.mesures.map((_, i) => S.longueurMesure(ed6.partition, i));
        check(Math.abs(S.dureeTotale(ed6.partition) - longueurs.reduce((a, b) => a + b, 0)) < 1e-9
              && Math.abs(longueurs[0] - 4) < 1e-9
              && Math.abs(S.capaciteMesure(ed6.partition, 0) - 3) < 1e-9,
            `la durée totale du morceau (${S.dureeTotale(ed6.partition)} noires) est la somme des LONGUEURS `
            + `(${longueurs.join(' + ')}), et la mesure trop pleine y compte pour 4 et non pour les 3 `
            + 'que sa signature annonce — sinon la lecture s\'arrêterait avant sa dernière note');

        // =====================================================================================
        // G. CHANGER LA SIGNATURE — ce qui est vide se redimensionne, ce qui est écrit est gardé
        // =====================================================================================
        const ed9 = neuf();
        const avant9 = S.positionDebutMesure(ed9.partition, 1);
        ed9.definirSignature(2, 4);
        check(avant9 === 4 && Math.abs(S.positionDebutMesure(ed9.partition, 1) - 2) < 1e-9
              && S.etatMesure(ed9.partition, 0) === 'complete',
            `sur une mesure VIDE, poser 2/4 redimensionne son silence : la mesure suivante commence `
            + `à ${S.positionDebutMesure(ed9.partition, 1)} au lieu de ${avant9}. Une voix qui ne porte `
            + 'que du silence n\'a rien à protéger, et c\'est le cas de qui pose sa métrique AVANT d\'écrire');
        check(S.etatMesure(ed6.partition, 0) === 'debordante'
              && ed6.partition.mesures[0].voix[0].evenements.filter(e => e.notes.length).length === 4,
            'alors qu\'une voix qui porte des NOTES n\'est pas touchée : les quatre notes sont '
            + 'toujours là, la mesure est signalée trop pleine, et « ⇥ Corriger » répartit à la demande');

        // =====================================================================================
        // H. RIEN N'A BOUGÉ POUR LE CAS ORDINAIRE
        // =====================================================================================
        const ed10 = neuf();
        ed10.dureeCourante = { valeur: 8, points: 0, nolet: null };
        for (let i = 0; i < 8; i++) ed10.saisirChiffre(i);
        check(notes(ed10).length === 8 && Math.abs(total(ed10) - 4) < 1e-9,
            'huit croches ordinaires : huit notes, quatre noires — le chemin le plus fréquent de tous '
            + 'ne doit rien devoir à la grille déduite');
        const ed11 = neuf();
        ed11.dureeCourante = { valeur: 4, points: 0, nolet: null };
        ed11.saisirChiffre(3);
        ed11.placerCurseur(0, 0, 0, 0);
        ed11.appliquerDuree(2);
        check(Math.abs(total(ed11) - 4) < 1e-9 && Math.abs(durees(ed11)[0] - 2) < 1e-9,
            'allonger une noire en blanche quand le silence suit : toujours accepté, mesure toujours juste');
        const ed12 = neuf();
        ed12.dureeCourante = { valeur: 4, points: 0, nolet: null };
        for (let i = 0; i < 4; i++) ed12.saisirChiffre(i);
        ed12.placerCurseur(0, 1, 0, 0);
        ed12.supprimerEvenement();
        check(Math.abs(total(ed12) - 4) < 1e-9,
            'supprimer un évènement au milieu (Ctrl+Suppr) laisse la mesure juste');

        // =====================================================================================
        // I. L'IMPORT MIDI SAIT DÉSORMAIS ENTENDRE LA TRIPLE-CROCHE
        // =====================================================================================
        const deduit = (attaques) => R.subdivisionPour(attaques, 0, 1);
        check(deduit([0, .125, .25, .375, .5, .625, .75, .875]) === 8,
            'huit attaques régulières dans un temps se lisent comme des TRIPLES-CROCHES (grille en 8)');
        check(deduit([0, 0.25, 0.5, 0.75]) === 4 && deduit([0, 0.5]) === 2 && deduit([0, 1 / 3, 2 / 3]) === 3,
            'sans rien changer aux lectures ordinaires : doubles en 4, croches en 2, triolet en 3');
        check(deduit([0, 0.27, 0.52, 0.78]) === 4 && deduit([0.01, 0.52]) === 2,
            'et du jeu HUMAIN un peu en retard reste lu en doubles et en croches — sans la marge de '
            + 'finesse, une grille plus fine explique toujours un peu mieux, par simple arithmétique, '
            + 'et un morceau joué à la main ressortirait constellé de triples-croches');

        check(true, 'toutes les vérifications se sont exécutées sans exception');
    } catch (err) {
        check(false, 'le banc s\'est arrêté sur une exception — ' + (err && err.message));
        console.error(err);
    }
    bilan();
})();
