// Banc du RYTHME À L'IMPORT MIDI — retour utilisateur : « est-ce que tu pourrais réussir facilement
// à réussir l'import de MIDI avec les bons rythmes ? Si je t'indique si le morceau est en binaire ou
// ternaire peut-être ? »
//
// LE DÉFAUT. L'import quantifiait tout sur une grille PLATE de doubles-croches (0,25 noire), la même
// du début à la fin. Un triolet de croches occupe des TIERS de temps : il y tombait sur 0, 1/4 et
// 3/4 — double, croche, double. Mesuré avant correction sur douze croches de triolet :
// « 16 8 16 16 8 16 … », un rythme qui n'est pas celui du fichier et qu'on ne corrige pas à la main
// sans tout réécrire.
//
// LA CORRECTION, en deux parties indépendantes :
//
//   1. UNE GRILLE PAR TEMPS. Chaque temps reçoit la subdivision que ses attaques réclament — 2, 3 ou
//      4 — puis la MÊME conversion en figures que l'aide rythmique (voir model/rythme.js). Un
//      triolet s'écrit donc triolet, et un temps en triolet au milieu de croches ne contamine pas
//      ses voisins. Avec une MARGE : le triolet doit expliquer le temps deux fois mieux que la
//      meilleure lecture binaire, sans quoi deux doubles jouées un peu tard basculeraient la
//      partition en triolets.
//   2. LE RYTHME DÉCLARÉ. Un .mid ne porte AUCUNE notion de swing, seulement des positions : des
//      croches aux deux tiers du temps se lisent aussi bien en triolets écrits qu'en croches droites
//      jouées swing. DEUX PARTITIONS POUR LA MÊME MUSIQUE — c'est pourquoi on demande, et pourquoi
//      les deux réponses sont justes. La détection ne fait que PRÉ-COCHER.
//
// CE QUE CE BANC SURVEILLE EN PLUS : que les mesures somment TOUJOURS exactement leur capacité. Une
// conversion qui inventerait ou perdrait un tiers de temps produirait une mesure fausse, et c'est le
// genre d'erreur qui ne se voit qu'à la lecture, longtemps après l'import.

const fs = require('fs');
const os = require('os');
const path = require('path');
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('rythme à l\'import MIDI');

const DIVISION = 480;

/**
 * Un .mid d'une piste, écrit octet par octet depuis des notes en NOIRES.
 *
 * ÉCRIT À LA MAIN et non exporté par TabHub, pour deux raisons : on veut des positions EXACTES (des
 * tiers de temps, que l'export ne produit que sous condition), et on veut pouvoir fabriquer des cas
 * que l'export ne sait pas produire. Un banc qui ne fait qu'un aller-retour avec soi-même ne prouve
 * que la symétrie de ses propres conventions.
 */
function octetsMidi(notes) {
    const vlq = (n) => { const o = [n & 0x7f]; n >>= 7; while (n > 0) { o.unshift((n & 0x7f) | 0x80); n >>= 7; } return o; };
    const evts = [];
    for (const { debut, duree, pitch = 60 } of notes) {
        evts.push({ tic: Math.round(debut * DIVISION), oct: [0x90, pitch, 100], rang: 2 });
        evts.push({ tic: Math.round((debut + duree) * DIVISION), oct: [0x80, pitch, 0], rang: 1 });
    }
    // « off » avant « on » à tic égal : une note qui enchaîne pile sur elle-même ne doit pas être
    // éteinte par le off qui la suivrait dans les octets (même règle qu'à l'export).
    evts.sort((a, b) => a.tic - b.tic || a.rang - b.rang);
    const piste = [];
    let dernier = 0;
    for (const e of evts) { piste.push(...vlq(e.tic - dernier), ...e.oct); dernier = e.tic; }
    piste.push(0x00, 0xff, 0x2f, 0x00);
    const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const u16 = (n) => [(n >>> 8) & 255, n & 255];
    return Buffer.from([
        0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(0), ...u16(1), ...u16(DIVISION),
        0x4d, 0x54, 0x72, 0x6b, ...u32(piste.length), ...piste,
    ]);
}

const T = 1 / 3;
/** Huit croches swinguées : le temps, puis son dernier tiers. */
const SWING = [];
for (let b = 0; b < 4; b++) SWING.push({ debut: b, duree: 2 / 3 }, { debut: b + 2 / 3, duree: 1 / 3 });
/** Douze croches de triolet : trois par temps, égales. */
const TRIOLETS = Array.from({ length: 12 }, (_, i) => ({ debut: i * T, duree: T }));
/** Huit croches droites. */
const CROCHES = Array.from({ length: 8 }, (_, i) => ({ debut: i * 0.5, duree: 0.5 }));
/** Seize doubles-croches. */
const DOUBLES = Array.from({ length: 16 }, (_, i) => ({ debut: i * 0.25, duree: 0.25 }));

(async () => {
    plan(36);
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 1320, height: 900 } });
    try {
        // Le lecteur d'octets et le constructeur, appelés DIRECTEMENT : le rythme produit est ce
        // qu'on éprouve ici, l'interface vient plus bas (cas 5).
        const lire = (notes, ternaire) => page.evaluate(async ([tableau, ternaire]) => {
            const M = await import('/src/io/midi.js');
            const D = await import('/src/model/duration.js');
            const a = M.analyserMidi(new Uint8Array(tableau));
            const { partition } = M.construirePartitionDepuisMidi(a, 'guitare', null, 0, null, ternaire);
            return {
                ternaire: !!partition.meta.ternaire,
                detection: M.detecterRythme(a),
                // Une écriture compacte et lisible : « T8 » = croche de triolet, « 8. » = croche
                // pointée, « r4 » = soupir, « ~ » = liée à la suivante.
                mesures: partition.mesures.map(m => m.voix[0].evenements.map(e =>
                    (e.silence ? 'r' : '') + (e.duree.nolet ? 'T' : '') + e.duree.valeur
                    + '.'.repeat(e.duree.points) + (e.notes.some(n => n.lien === 'tie') ? '~' : '')).join(' ')),
                // L'INVARIANT : chaque mesure somme exactement sa capacité.
                sommes: partition.mesures.map(m =>
                    +m.voix[0].evenements.reduce((s, e) => s + D.dureeEnNoires(e.duree), 0).toFixed(9)),
            };
        }, [[...octetsMidi(notes)], !!ternaire]);

        // =========================================================================================
        // 1. LES TRIOLETS — le défaut principal
        // =========================================================================================
        const triolets = await lire(TRIOLETS, false);
        exiger(triolets.mesures.length >= 1, 'un fichier de triolets s\'importe bien');
        check(triolets.mesures[0] === 'T8 T8 T8 T8 T8 T8 T8 T8 T8 T8 T8 T8',
            `DOUZE CROCHES DE TRIOLET s'écrivent en douze croches de triolet (reçu « ${triolets.mesures[0]} »)`);
        check(triolets.sommes.every(s => Math.abs(s - 4) < 1e-9),
            `et la mesure somme exactement ses quatre temps (${triolets.sommes.join(', ')})`);

        // Un SEUL temps en triolet au milieu de binaire : la subdivision se décide temps par temps,
        // donc le triolet ne doit contaminer ni ce qui le précède ni ce qui le suit.
        const melange = await lire([
            { debut: 0, duree: 0.5 }, { debut: 0.5, duree: 0.5 },
            { debut: 1, duree: T }, { debut: 1 + T, duree: T }, { debut: 1 + 2 * T, duree: T },
            { debut: 2, duree: 1 }, { debut: 3, duree: 1 },
        ], false);
        check(melange.mesures[0] === '8 8 T8 T8 T8 4 4',
            `UN SEUL TEMPS EN TRIOLET au milieu de croches et de noires reste seul (reçu « ${melange.mesures[0]} »)`);

        // =========================================================================================
        // 2. LE BINAIRE N'A PAS BOUGÉ — la correction ne doit rien coûter aux cas qui marchaient
        // =========================================================================================
        const croches = await lire(CROCHES, false);
        check(croches.mesures[0] === '8 8 8 8 8 8 8 8',
            `huit croches droites restent huit croches (reçu « ${croches.mesures[0]} »)`);
        const doubles = await lire(DOUBLES, false);
        check(doubles.mesures[0] === Array(16).fill('16').join(' '),
            `seize doubles-croches restent seize doubles (reçu « ${doubles.mesures[0]} »)`);
        const pointee = await lire([{ debut: 0, duree: 0.75 }, { debut: 0.75, duree: 0.25 }, { debut: 1, duree: 3 }], false);
        check(pointee.mesures[0] === '8. 16 2.',
            `croche pointée + double + blanche pointée : conservées telles quelles (reçu « ${pointee.mesures[0]} »)`);
        const longues = await lire([{ debut: 0, duree: 2 }, { debut: 2, duree: 1 }, { debut: 3, duree: 1 }], false);
        check(longues.mesures[0] === '2 4 4', `blanche + deux noires (reçu « ${longues.mesures[0]} »)`);

        // UNE MARGE CONTRE LES FAUX TRIOLETS : quatre doubles jouées un peu tard (jeu humain) ne
        // doivent PAS basculer le temps en triolet — l'erreur la plus coûteuse des deux.
        const flottant = await lire([
            { debut: 0, duree: 0.27 }, { debut: 0.27, duree: 0.24 }, { debut: 0.51, duree: 0.27 }, { debut: 0.78, duree: 0.22 },
            { debut: 1, duree: 3 },
        ], false);
        check(!/T/.test(flottant.mesures[0]),
            `des doubles jouées un peu tard restent binaires, aucun triolet inventé (reçu « ${flottant.mesures[0]} »)`);

        // LA MARGE DU TRIOLET, éprouvée LÀ OÙ ELLE DÉCIDE — sur le choix de subdivision lui-même.
        //
        // C'EST UN BIAIS ASSUMÉ, pas une vérité sur le rythme joué. Des attaques à 0 / 0,30 / 0,60
        // sont plus proches des tiers (0 / 0,333 / 0,667) que des quarts : une règle « la plus petite
        // erreur gagne » y écrirait un triolet. On exige qu'il soit DEUX FOIS meilleur, et pas
        // seulement meilleur, parce que les deux erreurs ne coûtent pas la même chose à lire : un
        // triolet de trop amène un chiffre « 3 », un crochet de n-olet et une ligature qui change,
        // là où une double de trop ne change qu'une figure. Sur du jeu flottant, dont AUCUNE lecture
        // n'est exacte, on penche donc vers l'écriture la plus sobre.
        //
        // Ce que la marge NE fait pas, et qui n'a besoin d'aucune marge : un temps que la grille
        // binaire explique EXACTEMENT ne peut jamais devenir un triolet (son erreur est nulle, rien
        // ne peut être deux fois meilleur que zéro).
        const subdivisions = await page.evaluate(async () => {
            const R = await import('/src/model/rythme.js');
            return {
                limite: R.subdivisionPour([0, 0.30, 0.60], 0, 1),
                vraiTriolet: R.subdivisionPour([0, 1 / 3, 2 / 3], 0, 1),
                trioletFlou: R.subdivisionPour([0, 0.34, 0.68], 0, 1),
                croches: R.subdivisionPour([0, 0.5], 0, 1),
                doubles: R.subdivisionPour([0, 0.25, 0.5, 0.75], 0, 1),
            };
        });
        check(subdivisions.limite === 4,
            `un temps AMBIGU (0 / 0,30 / 0,60) reste binaire : le triolet doit être deux fois meilleur, pas seulement meilleur (reçu sub ${subdivisions.limite})`);
        check(subdivisions.vraiTriolet === 3 && subdivisions.trioletFlou === 3,
            `un triolet net ET un triolet un peu flou (0 / 0,34 / 0,68) passent tous deux (reçu ${subdivisions.vraiTriolet} et ${subdivisions.trioletFlou})`);
        check(subdivisions.croches === 2 && subdivisions.doubles === 4,
            `et deux croches prennent la grille la plus SIMPLE (2), quatre doubles celle qu'il faut (4) — reçu ${subdivisions.croches} et ${subdivisions.doubles}`);

        // =========================================================================================
        // 3. LE SWING, LU DES DEUX FAÇONS — et les deux sont justes
        // =========================================================================================
        const swingBinaire = await lire(SWING, false);
        check(swingBinaire.mesures[0] === 'T4 T8 T4 T8 T4 T8 T4 T8',
            `SWING LU BINAIRE : des triolets ÉCRITS, noire + croche de triolet par temps (reçu « ${swingBinaire.mesures[0]} »)`);
        check(!swingBinaire.ternaire, 'et aucune indication ternaire posée — l\'écriture dit déjà tout');

        const swingTernaire = await lire(SWING, true);
        check(swingTernaire.mesures[0] === '8 8 8 8 8 8 8 8',
            `SWING LU TERNAIRE : des croches DROITES, bien plus lisibles (reçu « ${swingTernaire.mesures[0]} »)`);
        check(swingTernaire.ternaire,
            'et l\'indication ternaire posée, qui dit de les jouer longue-brève');
        check(swingTernaire.sommes.every(s => Math.abs(s - 4) < 1e-9),
            `la mesure somme toujours ses quatre temps après ce redressement (${swingTernaire.sommes.join(', ')})`);

        // DÉCLARER TERNAIRE UN MORCEAU QUI NE L'EST PAS ne doit pas l'abîmer : les noires tombent sur
        // les temps, qui sont des points fixes de la transformation.
        const noiresTernaire = await lire([
            { debut: 0, duree: 1 }, { debut: 1, duree: 1 }, { debut: 2, duree: 1 }, { debut: 3, duree: 1 },
        ], true);
        check(noiresTernaire.mesures[0] === '4 4 4 4',
            `quatre noires déclarées ternaires restent quatre noires (reçu « ${noiresTernaire.mesures[0]} »)`);

        // =========================================================================================
        // 4. LA DÉTECTION — elle PROPOSE, et surtout elle ne confond pas swing et vrais triolets
        // =========================================================================================
        check(swingBinaire.detection.ternaire && swingBinaire.detection.swing === 4,
            `un fichier swingué est DÉTECTÉ comme tel (${swingBinaire.detection.swing} temps swingués)`);
        check(!croches.detection.ternaire && croches.detection.binaire === 4,
            'des croches droites sont détectées binaires');
        check(!doubles.detection.ternaire, 'des doubles-croches aussi');
        // LE CAS QUI COMPTE LE PLUS : trois notes égales par temps sont un VRAI triolet, pas du
        // swing. Le « dé-swinguer » donnerait double, double, croche — faux. La détection doit donc
        // les reconnaître et ne PAS proposer le ternaire.
        check(!triolets.detection.ternaire && triolets.detection.triolet === 4 && triolets.detection.swing === 0,
            `des triolets à trois notes ne sont PAS pris pour du swing (${triolets.detection.triolet} temps en triolets, ${triolets.detection.swing} swingués)`);
        check(!flottant.detection.ternaire, 'et du jeu un peu flottant ne déclenche pas le ternaire non plus');

        // =========================================================================================
        // 5. LA FENÊTRE D'IMPORT — la question est posée, pré-cochée, et son réglage compte
        // =========================================================================================
        const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'tabhub-import-rythme-'));
        const cheminSwing = path.join(dossier, 'swing.mid');
        fs.writeFileSync(cheminSwing, octetsMidi(SWING));

        /** Ouvre la fenêtre d'import pour ce fichier, en franchissant la zone de manche si besoin. */
        const ouvrirFenetre = async (chemin) => {
            await page.setInputFiles('#entree-fichier-midi', chemin);
            await page.waitForTimeout(400);
            if (await page.locator('#fenetre-zone-manche').isVisible()) {
                await page.click('#fenetre-zone-manche [data-choix="tout"]');
                await page.waitForTimeout(250);
            }
            return page.locator('#fenetre-choix-import-midi').isVisible();
        };

        exiger(await ouvrirFenetre(cheminSwing),
            'importer un .mid ouvre bien la fenêtre qui demande le mode ET le rythme');
        const etatSegments = () => page.evaluate(() =>
            [...document.querySelectorAll('#segments-rythme-import [data-rythme]')].map(b => ({
                rythme: b.dataset.rythme, actif: b.classList.contains('actif'), coche: b.getAttribute('aria-checked'),
            })));
        const seg = await etatSegments();
        check(seg.length === 2 && seg.map(s => s.rythme).join(',') === 'binaire,ternaire',
            'deux réponses proposées, Binaire et Ternaire (swing) — la question en a exactement deux');
        check(seg.find(s => s.rythme === 'ternaire').actif && !seg.find(s => s.rythme === 'binaire').actif,
            'et sur un fichier swingué c\'est TERNAIRE qui est pré-coché, sans rien avoir à cliquer');
        check(seg.every(s => s.coche === String(s.actif)),
            'l\'état est aussi porté par aria-checked : un groupe de radios s\'entend, pas seulement se voit');
        check(/[Ss]wing détecté sur 4 temps/.test(await page.textContent('#note-rythme-import')),
            'la fenêtre DIT sur quoi la détection s\'appuie — un « on a détecté du swing » sans chiffres ne se discute pas');

        // CONTREDIRE LA DÉTECTION : un clic sur Binaire, et c'est le triolet écrit qu'on obtient.
        await page.click('#segments-rythme-import [data-rythme="binaire"]');
        await page.waitForTimeout(100);
        const segApres = await etatSegments();
        check(segApres.find(s => s.rythme === 'binaire').actif && !segApres.find(s => s.rythme === 'ternaire').actif,
            'cliquer Binaire déplace bien la sélection — un seul des deux allumé à la fois');
        await page.click('#fenetre-choix-import-midi [data-choix="nouveau"]');
        await page.waitForTimeout(500);
        const apresBinaire = await page.evaluate(() => ({
            ternaire: !!window.app.editeur.partition.meta.ternaire,
            m1: window.app.editeur.partition.mesures[0].voix[0].evenements.map(e =>
                (e.duree.nolet ? 'T' : '') + e.duree.valeur).join(' '),
        }));
        check(!apresBinaire.ternaire && apresBinaire.m1 === 'T4 T8 T4 T8 T4 T8 T4 T8',
            `le choix est HONORÉ : Binaire écrit les triolets et ne pose pas l'indication (reçu « ${apresBinaire.m1} »)`);

        // Le même fichier, en laissant le pré-coché : des croches droites et l'indication.
        exiger(await ouvrirFenetre(cheminSwing), 'le même fichier réimporté rouvre la fenêtre');
        await page.click('#fenetre-choix-import-midi [data-choix="nouveau"]');
        await page.waitForTimeout(500);
        const apresTernaire = await page.evaluate(() => ({
            ternaire: !!window.app.editeur.partition.meta.ternaire,
            m1: window.app.editeur.partition.mesures[0].voix[0].evenements.map(e =>
                (e.duree.nolet ? 'T' : '') + e.duree.valeur).join(' '),
        }));
        check(apresTernaire.ternaire && apresTernaire.m1 === '8 8 8 8 8 8 8 8',
            `et en gardant le pré-coché : croches droites plus l'indication ternaire (reçu « ${apresTernaire.m1} »)`);
        // L'INDICATION EST GRAVÉE dans la partition qui vient d'être importée — pas seulement un
        // drapeau dans le modèle.
        check(await page.evaluate(() => {
            const pg = window.app.page;
            const y = pg.ancrages.systemes[0].yPortee;
            return pg.primitives.some(p => p.t === 'glyphe' && /chiffreNolet3/.test(p.nom || '') && p.y < y - 6);
        }), 'et elle est GRAVÉE en tête de la partition importée, chiffre de triolet compris');

        // =========================================================================================
        // 6. L'ALLER-RETOUR DE TABHUB AVEC LUI-MÊME, en ternaire : sans perte
        // =========================================================================================
        // C'est l'inverse EXACT de l'export (voir io/midi.js) : ce qu'on exporte swingué doit se
        // réimporter en croches droites plus l'indication, à la figure près.
        const allerRetour = await page.evaluate(async () => {
            const M = await import('/src/io/midi.js');
            const S = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.meta.ternaire = true;
            ed.partition.mesures[0].voix[0].evenements =
                [0, 1, 2, 3, 4, 5, 6, 7].map(() => S.creerEvenement({ valeur: 8 }, [S.creerNote(5, 5)]));
            ed.prevenir('document');
            const octets = M.genererMidi(ed.partition);
            const a = M.analyserMidi(octets);
            const { partition } = M.construirePartitionDepuisMidi(a, 'guitare', null, 0, null, true);
            return {
                detecte: M.detecterRythme(a).ternaire,
                m1: partition.mesures[0].voix[0].evenements.map(e =>
                    (e.duree.nolet ? 'T' : '') + e.duree.valeur).join(' '),
                ternaire: !!partition.meta.ternaire,
            };
        });
        check(allerRetour.detecte,
            'un .mid exporté par TabHub en ternaire est RECONNU swingué à la relecture');
        check(allerRetour.m1 === '8 8 8 8 8 8 8 8' && allerRetour.ternaire,
            `et il revient en huit croches droites plus l'indication — aller-retour sans perte (reçu « ${allerRetour.m1} »)`);

        check(erreurs.length === 0, `aucune erreur de console ni exception (${erreurs.join(' | ') || 'rien'})`);
        fs.rmSync(dossier, { recursive: true, force: true });
    } catch (e) {
        check(false, 'exception pendant la campagne : ' + (e && e.message));
    } finally {
        await fermer();
    }
    process.exit(bilan());
})();
