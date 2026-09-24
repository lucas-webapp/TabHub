// Banc de LA LEVÉE (anacrouse) — une première mesure volontairement courte.
//
// LE PROBLÈME QU'ELLE RÈGLE : d'innombrables morceaux commencent avant le premier temps. Jusqu'ici
// on n'avait que deux manières de les recopier, mauvaises toutes les deux — écrire la levée dans une
// mesure pleine et la laisser rouge et fausse pour toujours, ou la bourrer de silences devant, ce
// qui décale TOUTE la numérotation du morceau : la « mesure 12 » de l'édition imprimée qu'on recopie
// ne tombait plus sur la mesure 12 d'ici.
//
// UNE LEVÉE PORTE UNE LONGUEUR, pas un booléen. C'est ce choix qui fait tenir le reste : tout ce qui
// juge une mesure (le fond rouge, la dette gravée, l'insertion, la grille d'écriture, le métronome,
// la largeur à la gravure) passe déjà par `capaciteMesure`, et il a suffi de lui apprendre à rendre
// la levée quand il y en a une. Un drapeau `estLevee` aurait obligé chacun de ces lieux à se
// demander séparément « et combien fait-elle, alors ? ».
//
// ET ELLE PREND LA LONGUEUR DE CE QU'ON Y A ÉCRIT : on écrit ses deux notes, la mesure se signale
// incomplète (elle l'est), puis on déclare « c'est une levée ». Aucune boîte à remplir, aucun nombre
// de temps à calculer — on l'a déjà dit en l'écrivant.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('la levée (anacrouse)');

(async () => {
    plan(34);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // ── LE GESTE ────────────────────────────────────────────────────────────────────────────
        const geste = await page.evaluate(async () => {
            const { Editeur } = await import('/src/edit/commands.js');
            const S = await import('/src/model/score.js');
            const { dureeEnNoires } = await import('/src/model/duration.js');
            const ecrit = (ed, m) => ed.partition.mesures[m].voix[0].evenements
                .reduce((t, e) => t + dureeEnNoires(e.duree), 0);
            const out = {};

            // Une mesure VIDE : la déclarer n'aurait aucun sens, et l'enfermerait à une longueur
            // nulle dont on ne saurait plus sortir.
            const vide = new Editeur(); vide.nouveau('guitare');
            vide.placerCurseur(0, 0, 0, 0);
            out.surVide = { rendu: vide.basculerLevee(), message: vide.derniereErreur };

            // Le cas normal : une noire écrite dans un 4/4, puis « Levée ».
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 0, 0); ed.saisirChiffre(5);
            // CE QU'ON A SOUS LES YEUX AVANT DE DÉCLARER : une mesure qui a l'air complète, parce
            // qu'une mesure neuve naît PLEINE DE SILENCES et qu'écrire une note en remplace un. Rien
            // ne signale donc que ce début de morceau est faux — c'est justement pour ça que la levée
            // doit être un geste qu'on POSE, et non un défaut que le moteur devinerait.
            out.avant = { ecart: ed.ecartMesure(0, 0), etat: S.etatMesure(ed.partition, 0),
                          ecrit: ecrit(ed, 0), dureeTotale: S.dureeTotale(ed.partition) };
            ed.placerCurseur(0, 0, 0, 0);
            out.longueur = ed.basculerLevee();
            out.apres = {
                capacite: S.capaciteMesure(ed.partition, 0),
                ecart: ed.ecartMesure(0, 0),
                etat: S.etatMesure(ed.partition, 0),
                ecrit: ecrit(ed, 0),
                dureeTotale: S.dureeTotale(ed.partition),
            };

            // LA NUMÉROTATION : la levée n'a pas de numéro, et la mesure d'après est la 1.
            out.numeros = ed.partition.mesures.map((_, i) => S.numeroDeMesure(ed.partition, i));
            out.nbNumerotees = S.nbMesuresNumerotees(ed.partition);
            // …et le chemin inverse, celui d'« Aller à la mesure N ».
            out.indexDe1 = S.indexDeNumero(ed.partition, 1);
            out.indexDe3 = S.indexDeNumero(ed.partition, 3);
            out.indexDe99 = S.indexDeNumero(ed.partition, 99);

            // LA BASCULE SE REBASCULE, et rend les silences qu'elle avait retirés.
            ed.placerCurseur(0, 0, 0, 0);
            ed.basculerLevee();
            out.retiree = {
                levee: ed.partition.mesures[0].levee,
                capacite: S.capaciteMesure(ed.partition, 0),
                ecart: ed.ecartMesure(0, 0),
                etat: S.etatMesure(ed.partition, 0),
            };

            // AU MILIEU DU MORCEAU, refusée — sauf après une double barre ou une reprise.
            const mil = new Editeur(); mil.nouveau('guitare');
            mil.dureeCourante = { valeur: 4, points: 0, nolet: null };
            mil.placerCurseur(2, 0, 0, 0); mil.saisirChiffre(5);
            mil.placerCurseur(2, 0, 0, 0);
            out.auMilieu = { rendu: mil.basculerLevee(), message: mil.derniereErreur };
            mil.partition.mesures[1].barre = 'double';
            out.apresDoubleBarre = mil.basculerLevee();

            // LES SILENCES DE QUEUE NE COMPTENT PAS dans la longueur retenue : une levée d'une
            // croche écrite dans un 4/4 traîne trois temps et demi de silence derrière elle, et les
            // compter ferait une levée de quatre temps — c'est-à-dire une mesure ordinaire.
            const cr = new Editeur(); cr.nouveau('guitare');
            cr.dureeCourante = { valeur: 8, points: 0, nolet: null };
            cr.placerCurseur(0, 0, 0, 0); cr.saisirChiffre(5);
            cr.placerCurseur(0, 0, 0, 0);
            out.croche = cr.basculerLevee();

            // UN CTRL+Z DÉFAIT LE GESTE, silences compris.
            const un = new Editeur(); un.nouveau('guitare');
            un.dureeCourante = { valeur: 4, points: 0, nolet: null };
            un.placerCurseur(0, 0, 0, 0); un.saisirChiffre(5);
            un.placerCurseur(0, 0, 0, 0); un.basculerLevee();
            un.annuler();
            out.annulee = { levee: un.partition.mesures[0].levee, ecrit: ecrit(un, 0) };
            return out;
        });

        check(geste.surVide.rendu === false && /Écrivez d'abord/.test(geste.surVide.message || ''),
            `une mesure vide refuse la levée — « ${geste.surVide.message} » : une levée qui ne porte rien `
            + 'ne veut rien dire, et l\'enfermerait à une longueur nulle');
        exiger(geste.avant.etat === 'complete' && geste.avant.ecrit === 4 && geste.avant.dureeTotale === 16,
            `préalable : sans levée, la noire d'attaque traîne derrière elle 3 ♩ de silence que RIEN ne `
            + `signale (mesure ${geste.avant.etat}, ${geste.avant.ecrit} ♩ écrites, morceau de `
            + `${geste.avant.dureeTotale} ♩) — une mesure neuve naît pleine de silences, écrire une note en `
            + 'remplace un, et le morceau démarre donc trois temps trop tard sans un mot');
        check(geste.longueur === 1,
            `« Levée » retient la longueur de ce qui est écrit, sans rien demander (${geste.longueur} ♩)`);
        check(geste.apres.capacite === 1 && geste.apres.ecart === 0 && geste.apres.etat === 'complete',
            `et la mesure devient JUSTE : capacité ${geste.apres.capacite} ♩, écart ${geste.apres.ecart} — `
            + 'le fond rouge s\'éteint parce que la mesure est réellement complète, pas parce qu\'on a '
            + 'dit au moteur de fermer les yeux');
        check(geste.apres.ecrit === 1,
            `les silences de queue sont retirés (${geste.apres.ecrit} ♩ écrite) : les garder ferait une `
            + 'mesure de 4 temps déclarée longue de 1, donc une dette de +3 au lieu d\'une levée');
        check(geste.apres.dureeTotale === 13,
            `et le morceau dure 13 ♩ au lieu de 16 (${geste.apres.dureeTotale}) — la lecture, la tête de `
            + 'lecture et le métronome comptent tous sur cette même longueur');

        check(JSON.stringify(geste.numeros) === JSON.stringify([null, 1, 2, 3]),
            `la levée ne porte AUCUN numéro et la mesure d'après est la 1 (${JSON.stringify(geste.numeros)}) — `
            + 'c\'est la convention de la gravure, et c\'est elle qui fait que « mesure 12 » désigne ici la '
            + 'même mesure que dans l\'édition imprimée qu\'on recopie');
        check(geste.nbNumerotees === 3, `le morceau compte 3 mesures numérotées (${geste.nbNumerotees}), pas 4`);
        check(geste.indexDe1 === 1 && geste.indexDe3 === 3,
            `« Aller à la mesure 1 » ouvre le rang 1, « la 3 » le rang 3 (${geste.indexDe1}, ${geste.indexDe3}) : `
            + 'le numéro demandé est celui qui est GRAVÉ, pas le rang dans le tableau');
        check(geste.indexDe99 === null,
            'et un numéro qui n\'existe pas ne renvoie nulle part — mieux vaut ne rien faire que sauter au plus proche');

        check(geste.retiree.levee === null && geste.retiree.capacite === 4
              && geste.retiree.ecart === 0 && geste.retiree.etat === 'complete',
            `rappuyer retire la levée ET REND LES SILENCES (capacité ${geste.retiree.capacite} ♩, écart `
            + `${geste.retiree.ecart}) : sans eux la mesure redeviendrait ordinaire et rouge, et il faudrait `
            + 'un Ctrl+Z pour réparer ce qu\'une simple bascule vient de faire');

        check(geste.auMilieu.rendu === false && /double barre|reprise/.test(geste.auMilieu.message || ''),
            `au milieu du morceau la levée est refusée — « ${geste.auMilieu.message} » : là, une mesure `
            + 'courte est une mesure FAUSSE, et c\'est ce qu\'il faut dire plutôt que de la déclarer juste');
        check(geste.apresDoubleBarre === 1,
            `mais elle est acceptée juste après une double barre (${geste.apresDoubleBarre} ♩) — le début d'un `
            + 'nouveau couplet peut avoir sa propre anacrouse');

        check(geste.croche === 0.5,
            `une levée d'une croche fait bien une demi-noire (${geste.croche}), pas quatre : les silences `
            + 'qui traînent derrière ne sont pas de la musique');
        check(geste.annulee.levee === null && geste.annulee.ecrit === 4,
            `un Ctrl+Z défait tout le geste, silences rendus compris (${geste.annulee.ecrit} ♩ écrite)`);

        // ── LA GRAVURE : plus étroite, et sans numéro ───────────────────────────────────────────
        const gravure = await page.evaluate(async () => {
            const { mettreEnPage } = await import('/src/engine/layout.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 0, 0); ed.saisirChiffre(5);
            const mesurer = () => {
                const p = mettreEnPage(ed.partition, { S: 10, largeurPage: 1400, yDepart: 6, mesuresParLigne: 4 });
                const a = p.ancrages.mesures;
                // Les numéros gravés : de petits textes sans empattement, au-dessus de la portée.
                // Les chiffres de TABLATURE sont sur la TAB, bien plus bas — on les écarte par leur y.
                const yPortee = a[0].yPortee;
                const numeros = p.primitives
                    .filter(z => z.t === 'texte' && z.police === 'sans-serif' && /^[0-9]+$/.test(z.s) && z.y < yPortee)
                    .sort((u, v) => u.y - v.y || u.x - v.x).map(z => z.s);
                return { largeurs: a.map(m => Math.round(m.xFin - m.x)), numeros };
            };
            const avant = mesurer();
            ed.placerCurseur(0, 0, 0, 0); ed.basculerLevee();
            const apres = mesurer();
            return { avant, apres };
        });

        exiger(gravure.avant.largeurs.length === 4,
            `préalable : quatre mesures gravées (${gravure.avant.largeurs.join(' ')})`);
        check(gravure.apres.largeurs[0] < gravure.avant.largeurs[0],
            `la levée se grave PLUS ÉTROITE qu'elle ne l'était (${gravure.avant.largeurs[0]} → `
            + `${gravure.apres.largeurs[0]} px) : la largeur se déduit de la capacité, et la capacité vient `
            + 'de la levée — une mesure d\'un temps prend la place d\'un temps');
        check(gravure.apres.largeurs.slice(1).join(' ') === gravure.avant.largeurs.slice(1).join(' '),
            `et les mesures suivantes ne bougent pas d'un pixel (${gravure.apres.largeurs.slice(1).join(' ')})`);
        check(gravure.avant.numeros.join(' ') === '1 2 3 4' && gravure.apres.numeros.join(' ') === '1 2 3',
            `les numéros gravés passent de « ${gravure.avant.numeros.join(' ')} » à `
            + `« ${gravure.apres.numeros.join(' ')} » : la levée en perd un, et les autres se décalent pour `
            + 'que la 1 reste la première VRAIE mesure');

        // ── CE QUI NE DOIT PAS VOYAGER ──────────────────────────────────────────────────────────
        const coller = await page.evaluate(async () => {
            const { Editeur } = await import('/src/edit/commands.js');
            const S = await import('/src/model/score.js');
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 0, 0); ed.saisirChiffre(5);
            ed.placerCurseur(0, 0, 0, 0); ed.basculerLevee();
            ed.copierMesures(0, 0); ed.collerMesures(2);
            const ailleurs = { levee: ed.partition.mesures[2].levee, capacite: S.capaciteMesure(ed.partition, 2) };
            // …et l'inverse : un bloc ordinaire collé SUR la levée ne la détruit pas en silence.
            for (let t = 0; t < 4; t++) { ed.placerCurseur(3, t, 0, 0); ed.saisirChiffre(t + 1); }
            ed.copierMesures(3, 3); ed.collerMesures(0);
            return { ailleurs, surLaLevee: { levee: ed.partition.mesures[0].levee, ecart: ed.ecartMesure(0, 0) } };
        });
        check(coller.ailleurs.levee === null && coller.ailleurs.capacite === 4,
            `coller la levée ailleurs n'y emporte PAS sa longueur courte (levee=${coller.ailleurs.levee}) : `
            + 'elle dit « ici commence le morceau », c\'est une propriété de la PLACE, comme la signature — '
            + 'la laisser voyager planterait au milieu du morceau une mesure raccourcie que le geste aurait '
            + 'refusé d\'y déclarer');
        check(coller.surLaLevee.levee === 1 && coller.surLaLevee.ecart === 3,
            `et un bloc ordinaire collé SUR la levée la laisse en place, en affichant sa dette `
            + `(+${coller.surLaLevee.ecart} ♩) : rien n'est détruit en silence, et la dette se règle comme `
            + 'partout ailleurs (Alt+A, ou retirer la levée)');

        // ── LE MÉTRONOME ET LE DÉCOMPTE ─────────────────────────────────────────────────────────
        const audio = await page.evaluate(async () => {
            const { Editeur } = await import('/src/edit/commands.js');
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 0, 0); ed.saisirChiffre(5);
            ed.placerCurseur(0, 0, 0, 0); ed.basculerLevee();
            // On n'allume pas le son : on relit le CODE qui décide, à la source. Un banc qui ouvrirait
            // un contexte audio mesurerait la disponibilité du navigateur, pas la règle.
            const src = window.app.lecteur.constructor.prototype._programmerDecompte.toString();
            const met = window.app.lecteur.constructor.prototype._programmerMetronome.toString();
            return { decompteLitLaSignature: /levee > 0 \? noiresParMesure/.test(src),
                     accentSansLevee: /accent = t === 0 && s === 0 && !\(mesure\.levee > 0\)/.test(met) };
        });
        check(audio.decompteLitLaSignature,
            'le décompte d\'entrée compte la mesure PLEINE devant une levée, pas la levée : un décompte '
            + 'd\'un seul clic n\'installerait aucune pulsation, c\'est-à-dire rien de ce qu\'on lui demande');
        check(audio.accentSansLevee,
            'et le métronome n\'ACCENTUE pas dans une levée : son unique clic est le dernier temps d\'une '
            + 'mesure qui n\'a pas été écrite, et l\'accentuer ferait entendre un « un » là où il n\'y en a pas');

        // ── LE REPÈRE DE POSITION : on compte par la fin ────────────────────────────────────────
        const repere = await page.evaluate(async () => {
            const app = window.app;
            app.editeur.nouveau('guitare');
            app.editeur.dureeCourante = { valeur: 4, points: 0, nolet: null };
            app.editeur.placerCurseur(0, 0, 0, 0); app.editeur.saisirChiffre(5);
            app.editeur.placerCurseur(0, 1, 0, 0); app.editeur.saisirChiffre(7);  // deux noires
            app.editeur.placerCurseur(0, 0, 0, 0); app.editeur.basculerLevee();
            const lire = (m, e) => { app.editeur.placerCurseur(m, e, 0, 0); app.rafraichirInfos();
                                     return document.getElementById('info-position').textContent; };
            return { premiere: lire(0, 0), seconde: lire(0, 1), apres: lire(1, 0) };
        });
        check(/Levée/.test(repere.premiere) && !/Mesure/.test(repere.premiere),
            `dans la levée, la barre du bas dit « Levée » et non un numéro de mesure — « ${repere.premiere} »`);
        check(/temps 3\b/.test(repere.premiere),
            `et la première note d'une levée de deux noires en 4/4 est le TROISIÈME temps — « ${repere.premiere} » : `
            + 'c\'est ce qu\'annonce le batteur et ce qu\'écrit l\'édition imprimée ; compter « temps 1 » ici '
            + 'obligerait à refaire le calcul de tête à chaque note');
        check(/temps 4\b/.test(repere.seconde), `la seconde est le quatrième — « ${repere.seconde} »`);
        check(/Mesure 1\b/.test(repere.apres) && /temps 1\b/.test(repere.apres),
            `et la mesure d'après repart à « Mesure 1 · temps 1 » — « ${repere.apres} »`);

        // ── L'EXPORT MusicXML ───────────────────────────────────────────────────────────────────
        const xml = await page.evaluate(async () => {
            const { genererMusicXML } = await import('/src/io/musicxml.js');
            const { Editeur } = await import('/src/edit/commands.js');
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 0, 0); ed.saisirChiffre(5);
            ed.placerCurseur(0, 0, 0, 0); ed.basculerLevee();
            return genererMusicXML(ed.partition).split('\n').filter(l => l.includes('<measure')).map(l => l.trim());
        });
        check(/implicit="yes"/.test(xml[0] || ''),
            `la levée s'exporte en MusicXML avec implicit="yes" (${xml[0]}) — le mot par lequel le format dit `
            + '« cette mesure existe mais ne compte pas » ; sans lui, MuseScore ou Dorico rouvriraient le '
            + 'morceau avec une première mesure numérotée 1 et trop courte, c\'est-à-dire fausse');
        check(!/implicit/.test(xml[1] || '') && /number="1"/.test(xml[1] || ''),
            `et la suivante est la mesure 1, sans mention (${xml[1]})`);

        // ── ALLER-RETOUR PAR LE FICHIER ─────────────────────────────────────────────────────────
        const disque = await page.evaluate(async () => {
            const { Editeur } = await import('/src/edit/commands.js');
            const S = await import('/src/model/score.js');
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 0, 0); ed.saisirChiffre(5);
            ed.placerCurseur(0, 0, 0, 0); ed.basculerLevee();
            const relu = S.normaliser(JSON.parse(JSON.stringify(ed.partition)));
            const abime = S.normaliser(JSON.parse(JSON.stringify({
                ...ed.partition,
                mesures: ed.partition.mesures.map((m, i) => (i === 1 ? { ...m, levee: -3 } : m)),
            })));
            return { levee: relu.mesures[0].levee, capacite: S.capaciteMesure(relu, 0),
                     aberrante: abime.mesures[1].levee };
        });
        check(disque.levee === 1 && disque.capacite === 1,
            `la levée survit à l'aller-retour par le fichier (${disque.levee} ♩) : sans quoi le morceau `
            + 'rouvert montrerait une première mesure fausse, et il faudrait la redéclarer à chaque fois');
        check(disque.aberrante === null,
            `et une valeur aberrante laissée par un fichier abîmé est ramenée à « pas de levée » `
            + `(${disque.aberrante}) plutôt que de raccourcir une mesure d'une longueur négative`);

        // ── NEUTRALISATION : on débranche la capacité, la levée redevient fausse ────────────────
        //
        // TOUT REPOSE SUR UN SEUL POINT : `capaciteMesure` rend la levée quand il y en a une. On le
        // débranche ici — la levée reste déclarée, mais tout ce qui juge la mesure retombe sur la
        // signature. Si les chiffres ne bougeaient pas, c'est que la levée tiendrait par autre chose,
        // et ce banc ne prouverait rien de ce qu'il dit.
        const neutre = await page.evaluate(async () => {
            const S = await import('/src/model/score.js');
            const { Editeur } = await import('/src/edit/commands.js');
            const { noiresParMesure } = await import('/src/model/duration.js');
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 0, 0); ed.saisirChiffre(5);
            ed.placerCurseur(0, 0, 0, 0); ed.basculerLevee();
            const avant = { capacite: S.capaciteMesure(ed.partition, 0), ecart: ed.ecartMesure(0, 0),
                            etat: S.etatMesure(ed.partition, 0) };
            // Le débranchement : la mesure ne déclare plus sa longueur, donc `capaciteMesure` retombe
            // sur la signature. On garde tout le reste — les notes, les silences retirés, le numéro.
            const memoire = ed.partition.mesures[0].levee;
            ed.partition.mesures[0].levee = null;
            const apres = { capacite: S.capaciteMesure(ed.partition, 0), ecart: ed.ecartMesure(0, 0),
                            etat: S.etatMesure(ed.partition, 0),
                            numero: S.numeroDeMesure(ed.partition, 0) };
            ed.partition.mesures[0].levee = memoire;
            return { avant, apres, pleine: noiresParMesure({ battements: 4, unite: 4 }) };
        });
        check(neutre.avant.etat === 'complete' && neutre.apres.etat === 'incomplete',
            `neutralisation : la capacité débranchée, la levée redevient une mesure INCOMPLÈTE `
            + `(${neutre.avant.etat} → ${neutre.apres.etat}, écart ${neutre.avant.ecart} → ${neutre.apres.ecart}) — `
            + 'c\'est bien `capaciteMesure` qui porte tout, et rien d\'autre');
        check(neutre.apres.capacite === neutre.pleine && neutre.apres.numero === 1,
            `et elle récupère la capacité de la signature (${neutre.apres.capacite} ♩) en même temps que le `
            + `numéro 1 (${neutre.apres.numero}) : le même champ décide de la longueur ET de la numérotation, `
            + 'ce qui les empêche de se contredire');

        check(erreurs.length === 0, 'aucune erreur de console ni exception (' + erreurs.join(' | ') + ')');
    } catch (e) {
        check(false, 'exception pendant le banc : ' + e.message + '\n' + e.stack);
    } finally {
        await fermer();
    }
    process.exit(bilan());
})();
