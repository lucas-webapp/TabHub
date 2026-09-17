// Banc de LA CONVERSION RYTHMIQUE — une grille de cellules devient une suite de FIGURES.
//
// CE QU'IL PROTÈGE, et la règle est ASYMÉTRIQUE — c'est tout le sujet :
//   • UN SILENCE n'a pas le droit de déborder d'un temps sans couvrir le suivant. C'est lui qui
//     montre la métrique, et rien d'autre : l'enjamber la cache. C'est la règle que suivent
//     MuseScore, Guitar Pro et les éditions imprimées.
//   • UNE NOTE en a le droit, et l'exerce tout le temps : `croche noire croche noire` en 4/4, la
//     syncope la plus banale du répertoire, a ses deux noires à cheval sur une barre de temps, et
//     aucune édition ne les coupe en croches liées. Une note ne se coupe donc QUE faute de figure
//     exacte (un tiers de temps tenu dans un temps binaire, par exemple) — et on coupe alors AUX
//     TEMPS, pas n'importe où.
//
// CETTE ASYMÉTRIE A COÛTÉ UNE RÉGRESSION, mesurée par le banc MIDI et figée ici (section G) : une
// première version du correctif appliquait la discipline des silences aux notes aussi, et l'import
// d'un fichier où deux notes se chevauchent rendait TROIS têtes de note pour deux écrites.
//
// LE DÉFAUT QU'IL FIGE, retour utilisateur (« théoriquement parlant, j'ai l'impression que cet outil
// est incohérent »). La conversion ne regardait que la DURÉE d'une course, jamais sa POSITION : elle
// demandait la plus longue suite de figures qui somme juste, du plus long au plus court. Trois
// symptômes, tous reproduits ci-dessous sur le motif EXACT de sa capture d'écran :
//   • un silence d'un seizième puis d'une croche sortait en UN soupir pointé, à cheval sur la barre
//     du temps 1 et du temps 2 ;
//   • un silence de cinq seizièmes depuis le dernier seizième du temps 3 sortait en « soupir puis
//     quart-de-soupir » — les bonnes figures, dans le MAUVAIS ORDRE, le soupir enjambant le temps 4 ;
//   • une demi-pause pouvait commencer sur la deuxième double-croche d'un temps.
//
// ET UN SECOND DÉFAUT, dans le dessin cette fois : quatre temps portant chacun une croche de triolet
// ne recevaient qu'UN seul « 3 » étiré sur toute la mesure. Une note isolée par des silences
// n'appartient à aucun groupe de ligature, donc la garde de poserNolets comparait `undefined` à
// `undefined` — toujours égal, la course ne se refermait jamais.
//
// LE MÊME CODE SERT À L'IMPORT MIDI (voir model/rythme.js#figuresSurGrille), donc le même défaut y
// écrivait les mêmes silences à cheval : le dernier bloc le vérifie par cette porte-là.
//
// AUCUN NAVIGATEUR : tout ce qui suit est du modèle pur, chargé en module ES depuis node.

const creerHarnais = require('./_harness.js');
const { check, exiger, plan, bilan } = creerHarnais('conversion rythmique');

const SIG = { battements: 4, unite: 4 };
const EPS = 1e-9;

(async () => {
    plan(23);
    try {
        const R = await import('../src/model/rythme.js');
        const D = await import('../src/model/duration.js');
        const { mettreEnPage } = await import('../src/engine/layout.js');

        /** Pose un motif sur la grille. Une chaîne par temps : '.' vide, 'x' attaque, '-' tenue. */
        const poser = (etat, motif) => {
            motif.forEach((chaine, iTemps) => [...chaine].forEach((ch, iCell) => {
                etat.temps[iTemps].cellules[iCell] =
                    ch === 'x' ? R.ATTAQUE : ch === '-' ? R.TENUE : R.VIDE;
            }));
            return etat;
        };

        const NOM = { 1: 'ronde', 2: 'blanche', 4: 'noire', 8: 'croche', 16: 'double', 32: 'triple' };
        /** L'écriture d'une mesure, chaque figure avec SA POSITION — c'est la position qui est en
         *  cause, la lire est donc le cœur de ce banc. */
        const ecriture = (etat, m = 0) => {
            const evs = R.evenementsParMesure(etat, { avecNotes: true })[m] || [];
            let pos = 0;
            return evs.map(e => {
                const d = D.dureeEnNoires(e.duree);
                const ligne = {
                    nom: NOM[e.duree.valeur] + '.'.repeat(e.duree.points || 0),
                    silence: !!e.silence, nolet: !!e.duree.nolet,
                    lie: e.notes?.[0]?.lien === 'tie',
                    debut: pos, duree: d,
                };
                pos += d;
                return ligne;
            });
        };
        const resume = (lignes) => lignes
            .map(l => (l.silence ? '(' : '') + l.nom + (l.nolet ? '3' : '') + (l.silence ? ')' : '') + (l.lie ? '~' : ''))
            .join(' ');

        /** LA RÈGLE DES SILENCES, vérifiable sur n'importe quelle écriture : chaque silence tient
         *  dans UN temps, ou bien part d'un temps et retombe sur un temps (il couvre alors des
         *  temps entiers). Les NOTES en sont exclues volontairement : leur enjambement est la
         *  syncope, et c'est la section G qui s'en occupe, en sens inverse.
         *  Rend la liste des silences FAUTIFS, pour que l'échec dise lequel. */
        const enjambements = (lignes, unite = 1) => lignes.filter(l => l.silence).filter(l => {
            const entier = (x) => Math.abs(x - Math.round(x)) < 1e-6;
            const dansUnTemps = Math.floor(l.debut / unite + EPS) === Math.floor((l.debut + l.duree) / unite - EPS);
            const surLesTemps = entier(l.debut / unite) && entier((l.debut + l.duree) / unite);
            return !dansUnTemps && !surLesTemps;
        });

        // =====================================================================================
        // A. LE MOTIF EXACT DE LA CAPTURE UTILISATEUR
        // Temps 1 : une double sur le 3e seizième. Temps 2 : une croche sur la 2e moitié.
        // Temps 3 : une croche pointée. Temps 4 : rien.
        // =====================================================================================
        let e = poser(R.etatInitial(1, SIG), ['..x.', '..x-', 'x--.']);
        let l = ecriture(e);

        exiger(l.length > 0, 'préalable : le motif de la capture produit bien une écriture');
        check(resume(l) === '(croche) double (double) (croche) croche croche. (double) (noire)',
            'le motif de la capture s\'écrit « soupir, double, quart-de-soupir, demi-soupir, croche, '
            + 'croche pointée, quart-de-soupir, soupir » — mesuré : ' + resume(l));

        const fautives = enjambements(l);
        check(fautives.length === 0,
            'aucun de ses quatre silences n\'enjambe un temps sans le couvrir'
            + (fautives.length ? ' — fautive(s) : ' + fautives.map(f => `${f.nom} en ${f.debut}`).join(', ') : ''));

        // Le symptôme 1, nommément : plus de soupir pointé à cheval sur les temps 1 et 2.
        check(!l.some(x => x.silence && x.nom === 'croche.'),
            'plus de soupir POINTÉ : celui qui couvrait le dernier seizième du temps 1 et la moitié '
            + 'du temps 2 est devenu un quart-de-soupir puis un demi-soupir');

        // Le symptôme 2, nommément : l'ordre de la queue.
        const queue = l.slice(-2);
        check(queue[0].nom === 'double' && queue[1].nom === 'noire',
            'et la queue est dans le BON ORDRE — quart-de-soupir (qui finit le temps 3) puis soupir '
            + '(le temps 4), et non l\'inverse : mesuré ' + queue.map(x => x.nom).join(' puis '));

        check(l.every(x => !x.silence || (x.duree, x.nom.indexOf('.') < 0)),
            'aucun silence n\'est pointé nulle part : un silence pointé n\'a de sens qu\'en mesure '
            + 'composée, où il complète le temps');

        check(R.mesuresJustes(e)[0], 'et la mesure somme EXACTEMENT sa capacité');

        // =====================================================================================
        // B. LES DEUX PIÈGES DE L'AUTRE CÔTÉ : ne pas SUR-découper
        // Le correctif coupe au temps ; s'il coupait tout au temps, une mesure vide rendrait quatre
        // soupirs et deux temps de silence deux soupirs. C'est le bloc de temps ENTIERS, traité d'un
        // coup, qui l'évite (voir figuresDeCourse, cas 4).
        // =====================================================================================
        l = ecriture(R.etatInitial(1, SIG));
        check(l.length === 1 && l[0].nom === 'ronde' && l[0].silence,
            'une mesure vide reste UNE pause, pas quatre soupirs — mesuré : ' + resume(l));

        // Une attaque sur les temps 1-2 seulement : les temps 3 et 4 doivent faire UNE demi-pause.
        e = poser(R.etatInitial(1, SIG), ['x---', '----']);
        l = ecriture(e);
        check(l.length === 2 && l[0].nom === 'blanche' && l[1].nom === 'blanche' && l[1].silence,
            'deux temps tenus puis deux temps vides donnent une blanche et UNE demi-pause — '
            + 'mesuré : ' + resume(l));

        // TROIS TEMPS DE SILENCE À PARTIR DU TEMPS 2 — le cas qui démasque une conversion aveugle.
        // Trois noires somment exactement une blanche POINTÉE, et c'est ce qu'une conversion qui ne
        // regarde que la durée propose : une figure qui enjambe la moitié de la mesure, à partir d'un
        // temps sur lequel une blanche n'a pas le droit de commencer. L'écriture juste est « soupir
        // (temps 2) puis demi-pause (temps 3-4) ». Ce contrôle manquait à une première version de ce
        // banc, et son absence laissait passer la neutralisation du correctif : toutes les autres
        // vérifications tombaient, par chance, sur des durées où les deux découpages coïncident.
        e = poser(R.etatInitial(1, SIG), ['x---']);
        l = ecriture(e);
        check(l.length === 3 && l[1].nom === 'noire' && l[1].silence
              && l[2].nom === 'blanche' && l[2].silence,
            'un temps tenu puis TROIS temps vides donnent soupir puis demi-pause, et non une '
            + 'blanche pointée à partir du temps 2 — mesuré : ' + resume(l));

        // =====================================================================================
        // C. LE TERNAIRE — le seul cas où le modèle a besoin d'un nolet
        // =====================================================================================
        e = R.etatInitial(1, SIG);
        R.changerSubdivision(e, 0, 3);
        l = ecriture(poser(e, ['x..']));
        check(l[0].nolet && l[0].nom === 'croche' && Math.abs(l[0].duree - 1 / 3) < 1e-6,
            'une seule cellule d\'un temps en trois est une croche de TRIOLET (un tiers de temps)');
        check(enjambements(l).length === 0,
            'et le reste de la mesure s\'écrit sans qu\'aucun silence n\'enjambe un temps');

        // Le temps ENTIER en trois n'est pas un triolet : trois tiers tenus font une noire.
        e = R.etatInitial(1, SIG);
        R.changerSubdivision(e, 0, 3);
        l = ecriture(poser(e, ['x--']));
        check(l[0].nom === 'noire' && !l[0].nolet,
            'trois cellules tenues d\'un temps en trois font une NOIRE, sans chiffre de triolet — '
            + 'un temps entier reste un temps');

        // La note qui enjambe un temps ternaire vers un temps binaire : aucune figure unique ne vaut
        // 1/3 + 1/4, il faut donc LIER — et c'est ce qu'écrit une vraie partition.
        e = R.etatInitial(1, SIG);
        R.changerSubdivision(e, 0, 3);
        l = ecriture(poser(e, ['..x', '-...']));
        const sonnantes = l.filter(x => !x.silence);
        check(sonnantes.length === 2 && sonnantes[0].nolet && sonnantes[0].lie
              && sonnantes[1].nom === 'double' && !sonnantes[1].nolet,
            'une note du 3e tiers du temps 1 tenue dans le temps 2 sort en croche de triolet LIÉE '
            + 'à une double-croche — mesuré : ' + resume(sonnantes));
        check(enjambements(l).length === 0,
            'et le long silence qui suit ne commence plus au milieu d\'un temps '
            + '(la demi-pause qui partait de la 2e double du temps 2)');

        // =====================================================================================
        // D. LE CHIFFRE DE TRIOLET : un par TEMPS, jamais un pour toute la mesure
        // On compte les glyphes réellement émis par le moteur de gravure.
        // =====================================================================================
        e = R.etatInitial(1, SIG);
        for (let i = 0; i < e.temps.length; i++) R.changerSubdivision(e, i, 3);
        poser(e, ['x..', 'x..', 'x..', 'x..']);
        const page = mettreEnPage(R.partitionApercu(e, 'guitare'), {
            S: 10, largeurPage: 900, avecTab: false, yDepart: 4, mesuresParLigne: 0, avertirErreurs: false,
        });
        const chiffres = (page.primitives || []).filter(p => p.t === 'glyphe' && p.nom === 'chiffreNolet3');
        check(chiffres.length === 4,
            'quatre temps portant chacun une croche de triolet reçoivent QUATRE « 3 », un par temps — '
            + 'mesuré : ' + chiffres.length);
        const xs = chiffres.map(c => Math.round(c.x)).sort((a, b) => a - b);
        check(new Set(xs).size === 4 && xs[3] - xs[0] > 40,
            'et ces quatre chiffres sont à quatre abscisses distinctes, étalées sur la mesure '
            + `(${xs.join(', ')}) — pas quatre copies au même endroit`);

        // =====================================================================================
        // E. LA MÊME RÈGLE PAR LA PORTE DE L'IMPORT MIDI (figuresSurGrille)
        // L'import ne clique pas : il déduit sa grille d'un fichier. Mais il passe par la MÊME
        // conversion, donc il portait le MÊME défaut.
        // =====================================================================================
        const mesures = [{ debut: 0, capacite: 4, signature: SIG }];
        const temps = R.grilleDesTemps(mesures);
        check(temps.length === 4 && temps.every(t => t.debutDansMesure !== undefined),
            'préalable : la grille des temps de l\'import sait où chaque temps tombe DANS SA MESURE');

        // LA SUBDIVISION SE DÉDUIT AVANT DE CONVERTIR, et l'ordre compte. `grilleDesTemps` naît en
        // `sub: 2` ; c'est `deduireSubdivisions` qui donne à chaque temps la finesse que ses attaques
        // réclament, et `callerSurGrille` qui cale ensuite les positions DESSUS. Demander 2,75 à une
        // grille restée en deux demi-temps n'a pas de sens — ce point n'existe pas sur cette grille —
        // et c'est ce que mesurait une première version de ce banc, qui échouait sur une entrée que
        // l'import ne produit jamais. On reproduit donc la vraie chaîne : des attaques en
        // seizièmes, la déduction, puis la conversion.
        R.deduireSubdivisions(temps, [0, 0.25, 0.5, 2.75]);
        check(temps[2].sub === 4,
            'préalable : un temps qui porte une attaque sur son dernier seizième est déduit en '
            + `quatre (mesuré : ${temps[2].sub})`);

        // Un silence de cinq seizièmes depuis le dernier seizième du temps 3 : le cas qui sortait
        // « soupir puis quart-de-soupir ».
        const figsSil = R.figuresSurGrille(temps, 2.75, 4, true);
        check(figsSil.length === 2 && figsSil[0].valeur === 16 && figsSil[1].valeur === 4,
            'à l\'import aussi, un silence de 2,75 à 4 s\'écrit double-croche PUIS noire — mesuré : '
            + figsSil.map(f => NOM[f.valeur]).join(' puis '));

        // Et une note sur les mêmes bornes reste fusionnée quand elle couvre des temps entiers.
        const figsNote = R.figuresSurGrille(temps, 0, 2, false);
        check(figsNote.length === 1 && figsNote[0].valeur === 2,
            'et une note qui couvre les temps 1-2 reste UNE blanche, pas deux noires liées');

        // =====================================================================================
        // F. LA RÈGLE TIENT SUR TOUT — balayage exhaustif des motifs d'un temps
        // 2^16 motifs serait long ; on prend tous les motifs des DEUX premiers temps (2^8 = 256
        // combinaisons d'attaques/vides), ce qui couvre toutes les frontières de temps qui
        // comptent, et on vérifie l'invariant sur chacun.
        // =====================================================================================
        let vus = 0, fautifs = [];
        for (let bits = 0; bits < 256; bits++) {
            const t1 = [], t2 = [];
            for (let k = 0; k < 4; k++) t1.push((bits >> k) & 1 ? 'x' : '.');
            for (let k = 0; k < 4; k++) t2.push((bits >> (k + 4)) & 1 ? 'x' : '.');
            const etat = poser(R.etatInitial(1, SIG), [t1.join(''), t2.join('')]);
            const lignes = ecriture(etat);
            vus++;
            if (enjambements(lignes).length) fautifs.push(t1.join('') + '|' + t2.join(''));
            // Un silence POINTÉ est fautif partout hors mesure composée, même quand il tient dans
            // son temps : c'est l'autre marque d'une conversion qui ne regarde que la durée.
            if (lignes.some(x => x.silence && x.nom.includes('.'))) {
                fautifs.push('silence pointé : ' + t1.join('') + '|' + t2.join(''));
            }
            if (!R.mesuresJustes(etat)[0]) fautifs.push('somme fausse : ' + t1.join('') + '|' + t2.join(''));
        }
        check(vus === 256, `préalable : les 256 motifs des deux premiers temps ont bien été essayés (${vus})`);
        check(fautifs.length === 0,
            'sur ces 256 motifs : aucun silence n\'enjambe un temps, aucun n\'est pointé, '
            + 'et chaque mesure somme juste'
            + (fautifs.length ? ` — ${fautifs.length} fautif(s), dont ${fautifs.slice(0, 3).join(' ')}` : ''));

        // Même balayage avec les deux premiers temps en TROIS (3+3 cellules = 64 motifs).
        fautifs = [];
        for (let bits = 0; bits < 64; bits++) {
            const etat = R.etatInitial(1, SIG);
            R.changerSubdivision(etat, 0, 3);
            R.changerSubdivision(etat, 1, 3);
            const t1 = [], t2 = [];
            for (let k = 0; k < 3; k++) t1.push((bits >> k) & 1 ? 'x' : '.');
            for (let k = 0; k < 3; k++) t2.push((bits >> (k + 3)) & 1 ? 'x' : '.');
            poser(etat, [t1.join(''), t2.join('')]);
            const lignes = ecriture(etat);
            if (enjambements(lignes).length) fautifs.push(t1.join('') + '|' + t2.join(''));
            if (lignes.some(x => x.silence && x.nom.includes('.'))) {
                fautifs.push('silence pointé : ' + t1.join('') + '|' + t2.join(''));
            }
            if (!R.mesuresJustes(etat)[0]) fautifs.push('somme fausse : ' + t1.join('') + '|' + t2.join(''));
        }
        check(fautifs.length === 0,
            'et sur les 64 motifs de deux temps en TROIS, les trois mêmes règles tiennent — triolets compris'
            + (fautifs.length ? ` — ${fautifs.length} fautif(s), dont ${fautifs.slice(0, 3).join(' ')}` : ''));

        // =====================================================================================
        // G. L'AUTRE SENS : UNE NOTE A LE DROIT D'ENJAMBER UN TEMPS
        // La section F vérifie qu'aucun SILENCE ne déborde. Celle-ci vérifie l'inverse pour ce qui
        // SONNE, parce que les deux règles sont différentes et qu'une première version du correctif
        // les avait confondues : elle coupait la syncope en figures liées. Le banc MIDI l'a
        // débusquée (deux notes chevauchées rendaient TROIS têtes) ; les contrôles ci-dessous la
        // tiennent depuis l'autre bout, celui de la conversion elle-même.
        // =====================================================================================

        // LA SYNCOPE CANONIQUE : une note tenue de la 2e croche du temps 1 à la 2e croche du temps 2.
        // Une noire, une seule, à cheval sur la barre du temps — ce qu'écrit toute édition imprimée.
        e = poser(R.etatInitial(1, SIG), ['..x-', '--..']);
        l = ecriture(e);
        let sonne = l.filter(x => !x.silence);
        check(sonne.length === 1 && sonne[0].nom === 'noire' && !sonne[0].lie
              && Math.abs(sonne[0].debut - 0.5) < 1e-6,
            'une note tenue de la 2e croche du temps 1 à la 2e croche du temps 2 est UNE noire à '
            + 'cheval, pas deux croches liées — mesuré : ' + resume(l));
        check(enjambements(l).length === 0,
            'et les silences qui l\'entourent obéissent quand même à LEUR règle, plus stricte');

        // Et une croche pointée qui part du dernier seizième du temps 1 : même réponse, une figure.
        l = ecriture(poser(R.etatInitial(1, SIG), ['...x', '-...']));
        sonne = l.filter(x => !x.silence);
        check(sonne.length === 1 && sonne[0].nom === 'croche' && !sonne[0].lie,
            'une note du dernier seizième du temps 1 tenue sur le 1er seizième du temps 2 reste UNE '
            + 'croche — mesuré : ' + resume(l));

        // BALAYAGE DES COURSES À CHEVAL. La section F ne posait que des attaques et des vides,
        // jamais de TENUE : aucune de ses 256 combinaisons ne faisait donc traverser un temps à une
        // seule note, et l'invariant des notes n'y était pas éprouvé du tout. Ici, toutes les
        // courses qui partent d'un seizième du temps 1 et meurent sur un seizième du temps 2.
        let coursesVues = 0;
        fautifs = [];
        for (let depart = 0; depart < 4; depart++) {
            for (let fin = 0; fin < 4; fin++) {
                const t1 = ['.', '.', '.', '.'], t2 = ['.', '.', '.', '.'];
                t1[depart] = 'x';
                for (let k = depart + 1; k < 4; k++) t1[k] = '-';
                for (let k = 0; k <= fin; k++) t2[k] = '-';
                const etat = poser(R.etatInitial(1, SIG), [t1.join(''), t2.join('')]);
                const lignes = ecriture(etat);
                const notes = lignes.filter(x => !x.silence);
                const duree = (4 - depart + fin + 1) * 0.25;
                coursesVues++;
                const motif = t1.join('') + '|' + t2.join('');
                // La course traverse toujours la barre du temps 2 par construction.
                if (Math.abs(notes.reduce((t, x) => t + x.duree, 0) - duree) > 1e-6) {
                    fautifs.push('durée fausse : ' + motif);
                }
                // Une durée qu'UNE figure exprime doit sortir en UNE figure, sans liaison.
                const uneFigure = [0.5, 0.75, 1, 1.5, 2].some(d => Math.abs(d - duree) < 1e-6);
                if (uneFigure && notes.length !== 1) {
                    fautifs.push(`${motif} : ${notes.length} figures pour une durée de ${duree}`);
                }
                // Et les silences de la même mesure gardent leur discipline.
                if (enjambements(lignes).length) fautifs.push('silence à cheval : ' + motif);
                if (!R.mesuresJustes(etat)[0]) fautifs.push('somme fausse : ' + motif);
            }
        }
        check(coursesVues === 16,
            `préalable : les 16 courses à cheval sur les temps 1-2 ont bien été essayées (${coursesVues})`);
        check(fautifs.length === 0,
            'sur ces 16 courses : une durée qu\'une figure exprime reste UNE figure non liée, les '
            + 'silences restent alignés, et chaque mesure somme juste'
            + (fautifs.length ? ` — ${fautifs.length} fautif(s), dont ${fautifs.slice(0, 3).join(' ')}` : ''));

        // LA MÊME CHOSE PAR LA PORTE DE L'IMPORT — le chemin exact de la régression.
        const figsSync = R.figuresSurGrille(temps, 0.5, 1.5, false);
        check(figsSync.length === 1 && figsSync[0].valeur === 4 && !figsSync[0].points,
            'à l\'import aussi, une note de 0,5 à 1,5 est UNE noire — mesuré : '
            + figsSync.map(f => NOM[f.valeur]).join(' puis '));

        // =====================================================================================
        // H. LES DIVISIONS SUIVENT LA SIGNATURE
        // Une version antérieure offrait 4 ou 3 partout. Mesuré : en 6/8 « 4 » donnait des cellules
        // de 0,375 noire et écrivait des TRIPLES-croches (que l'application n'écrit nulle part
        // ailleurs), et « 3 » donnait la bonne cellule mais la marquait d'un chiffre de TRIOLET
        // alors que trois croches est la division ORDINAIRE d'un temps de 6/8. En 5/8 et 7/8, le
        // temps est une croche : « 4 » ne produisait que des triples-croches.
        // =====================================================================================
        const ecrireGrille = (signature, sub) => {
            const etat = R.etatInitial(1, signature);
            R.changerSubdivisionGlobale(etat, sub);
            etat.temps.forEach(t => { t.cellules[0] = R.ATTAQUE; });
            return { etat, lignes: ecriture(etat) };
        };

        check(JSON.stringify(R.subdivisionsPour({ battements: 4, unite: 4 })) === '[4,3]'
              && JSON.stringify(R.subdivisionsPour({ battements: 6, unite: 8 })) === '[3,6]'
              && JSON.stringify(R.subdivisionsPour({ battements: 7, unite: 8 })) === '[2,3]',
            'chaque famille de mesure a SES divisions : 4/3 à la noire, 3/6 en composée, 2/3 en x/8 '
            + `irrégulier — mesuré ${JSON.stringify(R.subdivisionsPour({ battements: 6, unite: 8 }))} en 6/8`);

        const triples = [];
        const nolets = [];
        for (const signature of [{ battements: 4, unite: 4 }, { battements: 3, unite: 4 },
                                 { battements: 6, unite: 8 }, { battements: 9, unite: 8 },
                                 { battements: 12, unite: 8 }, { battements: 5, unite: 8 },
                                 { battements: 7, unite: 8 }]) {
            for (const sub of R.subdivisionsPour(signature)) {
                const { etat, lignes } = ecrireGrille(signature, sub);
                const etiquette = `${signature.battements}/${signature.unite} sub${sub}`;
                if (lignes.some(l => l.nom.startsWith('triple'))) triples.push(etiquette);
                if (!R.mesuresJustes(etat)[0]) triples.push('somme fausse : ' + etiquette);
                // En mesure COMPOSÉE, aucune figure ne doit porter de nolet : le temps y est pointé,
                // donc déjà ternaire — une croche de 6/8 n'est pas un triolet.
                const composee = signature.unite >= 8 && signature.battements % 3 === 0;
                if (composee && lignes.some(l => l.nolet)) nolets.push(etiquette);
            }
        }
        check(triples.length === 0,
            'aucune division offerte, dans aucune des sept signatures essayées, ne produit de '
            + 'TRIPLE-croche ni de mesure fausse'
            + (triples.length ? ` — fautif(s) : ${triples.join(', ')}` : ''));
        check(nolets.length === 0,
            'et en mesure COMPOSÉE (6/8, 9/8, 12/8) aucune figure ne porte de chiffre de n-olet — '
            + 'trois croches y sont la division ordinaire du temps, pas un triolet'
            + (nolets.length ? ` — fautif(s) : ${nolets.join(', ')}` : ''));

        // La croche de 6/8 s'écrit croche, et la croche de 4/4 en ternaire s'écrit triolet : c'est
        // la MÊME durée relative au temps, et deux écritures justes différentes.
        const en68 = ecrireGrille({ battements: 6, unite: 8 }, 3).lignes[0];
        const en44 = ecrireGrille({ battements: 4, unite: 4 }, 3).lignes[0];
        check(en68.nom === 'croche' && !en68.nolet && en44.nom === 'croche' && en44.nolet,
            `un tiers de temps s'écrit croche SANS nolet en 6/8 et croche AVEC nolet en 4/4 — `
            + `mesuré « ${resume([en68])} » et « ${resume([en44])} »`);

        // =====================================================================================
        // I. UNE NOTE FRANCHIT LA BARRE, ET RESSORT LIÉE
        // Les courses vivent sur l'index GLOBAL de la grille. Une version antérieure raisonnait
        // mesure par mesure : la note s'arrêtait à la barre, et une liaison par-dessus — écriture
        // ordinaire, souvent la seule juste — était indessinable.
        // =====================================================================================
        const aCheval = R.etatInitial(2, SIG);
        R.poserCourse(aCheval, R.indexDe(aCheval, 0, 14), R.indexDe(aCheval, 1, 2));
        check(JSON.stringify(R.courses(aCheval)) === '[{"debut":14,"fin":18}]',
            `une seule course couvre les deux mesures (${JSON.stringify(R.courses(aCheval))})`);
        const m0 = R.coursesDeMesure(aCheval, 0), m1 = R.coursesDeMesure(aCheval, 1);
        check(m0.length === 1 && m0[0].attaque && m0[0].continue
              && m1.length === 1 && !m1[0].attaque && !m1[0].continue,
            'le DESSIN la recoupe en deux morceaux : le premier porte l\'attaque et continue, le '
            + 'second ne porte pas d\'attaque — un morceau de continuation n\'a rien à pincer');
        const parM = R.evenementsParMesure(aCheval, { avecNotes: true });
        const derniere = parM[0][parM[0].length - 1];
        check(derniere.notes[0]?.lien === 'tie' && !derniere.silence,
            'la CONVERSION la lie : la dernière figure de la mesure 1 porte la liaison — '
            + `mesuré « ${resume(ecriture(aCheval, 0)).trim()} »`);
        check(parM.every((evs, m) => Math.abs(evs.reduce((t, e) => t + D.dureeEnNoires(e.duree), 0)
                                               - 4) < 1e-6),
            'et les deux mesures somment exactement leur capacité, la liaison ne fait rien perdre');
        // UN SILENCE, LUI, NE FRANCHIT JAMAIS LA BARRE : c'est lui qui montre la métrique, et la
        // barre est la métrique la plus forte de toutes.
        const vide2 = R.etatInitial(2, SIG);
        R.poserCourse(vide2, 0, 0);
        const silences = R.evenementsParMesure(vide2, { avecNotes: true });
        check(silences[0].length >= 2 && silences[1].length === 1 && silences[1][0].silence,
            'un silence, lui, s\'arrête à la barre : la mesure 2 vide reste UNE pause entière '
            + `(${silences[1].length} figure(s)) plutôt que d'être avalée par celle d'avant`);

        // =====================================================================================
        // J. CHANGER LA GRILLE NE JETTE PLUS LE TRAVAIL
        // Mesuré avant : trois pilules puis zéro en changeant de division, deux puis zéro en
        // passant de une à deux mesures — sans avertissement et sans annulation dans la fenêtre.
        // =====================================================================================
        const base = R.etatInitial(1, SIG);
        R.poserCourse(base, 0, 0); R.poserCourse(base, 4, 7); R.poserCourse(base, 8, 8);
        const empreinte = JSON.stringify(R.courses(base));
        check(JSON.stringify(R.courses(R.regrillerEtat(base, { nMesures: 2 }))) === empreinte,
            'passer de une à deux mesures GARDE le rythme de la première — vouloir ajouter une '
            + 'mesure ne fait plus perdre celle qu\'on avait');
        const enTrois = R.regrillerEtat(base, { sub: 3 });
        check(R.courses(enTrois).length === 3 && enTrois.temps[0].sub === 3,
            `passer en ternaire garde les TROIS notes en les requantifiant (${JSON.stringify(R.courses(enTrois))}) — `
            + 'les durées bougent, aucune note ne disparaît');
        check(JSON.stringify(R.courses(R.regrillerEtat(enTrois, { sub: 4 }))) === empreinte,
            'et l\'aller-retour binaire → ternaire → binaire retombe sur ses pieds quand les '
            + 'positions existent des deux côtés');
        // RACCOURCIR PERD CE QUI SORT, et il faut le vérifier sur une note qui SORT vraiment : une
        // première version de ce contrôle étendait `base` à quatre mesures (dont trois vides) puis
        // les rabattait à une, et mesurait donc 3 notes avant comme après — elle aurait passé même
        // sans aucun recalage. On pose donc une quatrième note DANS la mesure 4.
        const large = R.regrillerEtat(base, { nMesures: 4 });
        R.poserCourse(large, R.indexDe(large, 3, 0), R.indexDe(large, 3, 3));
        exiger(R.courses(large).length === 4, `préalable : quatre notes, dont une en mesure 4 (${R.courses(large).length})`);
        const court = R.regrillerEtat(large, { nMesures: 1 });
        check(R.courses(court).length === 3,
            `raccourcir à une mesure garde les trois notes qui rentrent et perd la quatrième `
            + `(${R.courses(court).length} restante(s)) — c'est le seul cas de perte, et il n'a pas `
            + 'd\'autre réponse : on ne garde pas ce qui n\'a plus de place');

        // =====================================================================================
        // K. L'AIDE SAIT RELIRE UNE PARTITION — l'aller-retour complet
        // Elle s'ouvrait toujours vierge : elle savait créer un rythme, jamais en corriger un.
        // =====================================================================================
        const allerRetour = (etat) => {
            const p = { mesures: R.evenementsParMesure(etat, { avecNotes: true })
                .map(evs => ({ voix: [{ evenements: evs }] })) };
            return R.etatDepuisPartition(p, 0, etat.nMesures, SIG);
        };
        const cas = [
            ['trois notes en binaire', base],
            ['une note à cheval sur la barre', aCheval],
            ['une grille vide', R.etatInitial(1, SIG)],
        ];
        const perdus = cas.filter(([, etat]) =>
            JSON.stringify(R.courses(allerRetour(etat))) !== JSON.stringify(R.courses(etat)));
        check(perdus.length === 0,
            'grille → partition → grille rend EXACTEMENT la même grille, liaison par-dessus la '
            + 'barre comprise' + (perdus.length ? ` — perdu(s) : ${perdus.map(c => c[0]).join(', ')}` : ''));
        const ternaireRelu = allerRetour(R.regrillerEtat(base, { sub: 3 }));
        check(ternaireRelu.temps[0].sub === 3,
            `et la DIVISION se déduit de ce qu'on relit (${ternaireRelu.temps[0].sub}) : un passage `
            + 'en triolets rouvre en ternaire sans qu\'on ait à le dire');

        // =====================================================================================
        // L. LES MOTIFS TOUT PRÊTS écrivent ce que leur nom annonce
        // =====================================================================================
        const motifsFautifs = [];
        let motifsVus = 0;
        for (const signature of [{ battements: 4, unite: 4 }, { battements: 6, unite: 8 },
                                 { battements: 7, unite: 8 }]) {
            for (const sub of R.subdivisionsPour(signature)) {
                for (const motif of R.motifsPour(signature, sub)) {
                    const etat = R.etatInitial(1, signature);
                    R.changerSubdivisionGlobale(etat, sub);
                    R.appliquerMotif(etat, motif.cases);
                    motifsVus++;
                    const etiquette = `${signature.battements}/${signature.unite} « ${motif.texte} »`;
                    if (!R.mesuresJustes(etat)[0]) motifsFautifs.push('somme fausse : ' + etiquette);
                    if (R.estVide(etat)) motifsFautifs.push('rien posé : ' + etiquette);
                    const l = ecriture(etat);
                    if (l.some(x => x.nom.startsWith('triple'))) motifsFautifs.push('triple-croche : ' + etiquette);
                    if (enjambements(l).length) motifsFautifs.push('silence à cheval : ' + etiquette);
                }
            }
        }
        check(motifsVus === 19, `préalable : les dix-neuf motifs des trois familles ont été essayés (${motifsVus})`);
        check(motifsFautifs.length === 0,
            'chaque motif remplit sa grille, somme juste, et n\'écrit ni triple-croche ni silence '
            + 'à cheval' + (motifsFautifs.length ? ` — ${motifsFautifs.join(' ; ')}` : ''));
        // Et il nomme juste : « Noires » en 4/4 donne quatre noires, « Croches » en 6/8 six croches.
        const e44 = R.etatInitial(1, SIG);
        R.appliquerMotif(e44, R.motifsPour(SIG, 4)[0].cases);
        const l44 = ecriture(e44);
        const e68 = R.etatInitial(1, { battements: 6, unite: 8 });
        R.appliquerMotif(e68, R.motifsPour({ battements: 6, unite: 8 }, 3)[1].cases);
        const l68 = ecriture(e68);
        check(l44.length === 4 && l44.every(x => x.nom === 'noire')
              && l68.length === 6 && l68.every(x => x.nom === 'croche'),
            `« Noires » en 4/4 donne quatre noires (${resume(l44)}) et « Croches » en 6/8 six `
            + `croches (${resume(l68)}) — le libellé dit la vérité dans les deux mesures`);

        check(true, 'toutes les vérifications se sont exécutées sans exception');
    } catch (err) {
        check(false, 'le banc s\'est arrêté sur une exception — ' + (err && err.message));
        console.error(err);
    }
    bilan();
})();
