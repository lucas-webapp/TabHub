// Banc de l'ESPACEMENT PROPORTIONNEL — « écart égal, largeur égale », partout dans la mesure.
//
// CE QU'IL PROTÈGE. Retour utilisateur, capture à l'appui, sur une ligne de basse en 4/4 à ♩=90 :
// « quand je lis ce début de partition, les deux premières doubles croches sont beaucoup plus
// rapides que celles d'après ». Le SON était juste — les positions programmées tombaient exactement
// sur 0, 0,25, 0,5, 1, 1,5… Ce qui mentait, c'était la GRAVURE, et la tête de lecture avec elle.
//
// DEUX DÉFAUTS DISTINCTS, tous deux dans le partage de la largeur d'une mesure :
//
//   1. UN PLANCHER QUI ÉCRASAIT LES BRÈVES (engine/layout.js#largeurColonne). La largeur d'une
//      colonne valait `max(proportionnelle, 3,2 S)`. Ce plancher est atteint dès que l'écart descend
//      sous 3,2/3,9 = 0,82 noire : TOUTES les figures plus brèves qu'une noire pointée recevaient
//      donc la MÊME largeur. MESURÉ à S=10, sur un temps de deux doubles-croches et une croche :
//      16,7 px chacune, quand la croche dure le double. Le plancher ne protégeait d'ailleurs rien —
//      `repartirParTemps` rescale ensuite pour tenir dans le budget du temps, donc un plancher absolu
//      y est systématiquement ramené à l'échelle. Son seul effet réel était d'égaliser.
//
//   2. UNE FIGURE À CHEVAL SUR DEUX TEMPS N'ÉTAIT PAYÉE QUE PAR LE PREMIER (repartirParTemps). Un
//      soupir de noire posé sur la seconde moitié du 3e temps était entièrement financé par ce
//      3e temps, tandis que le 4e payait à lui seul le peu qui restait après lui.
//
// CE QUE ÇA DONNAIT À L'ŒIL. La tête de lecture interpole À L'INTÉRIEUR de chaque colonne (voir
// main.js#lieuDeLaPosition) : à largeur égale et durée inégale, elle traverse la même distance à des
// vitesses différentes. MESURÉ sur la mesure du retour, à ♩=90 et S=10 — 90 px/s sur les deux
// doubles-croches, 45 sur les soupirs de croche qui suivent (exactement la moitié, et exactement la
// phrase du retour), puis 84, 25 et 135 px/s sur la fin. Six vitesses dans une mesure qui ne change
// pas de tempo. Après correction : 67 px/s, d'un bout à l'autre.
//
// LES DEUX EXIGENCES TIENNENT ENSEMBLE, et c'est ce que ce banc vérifie en même temps : chaque TEMPS
// garde exactement largeurNotes/nTemps (la grille de la réglette reste rigoureusement régulière) ET
// chaque colonne reçoit une part exactement proportionnelle à sa durée. Les colonnes PAVENT la
// mesure : distribuer chaque temps entre les colonnes qui le CHEVAUCHENT donne les deux à la fois.
//
// DEUX NEUTRALISATIONS en fin de banc, une par défaut : sans elles, rien ne prouverait que ces
// vérifications mesurent bien ce que ces deux fonctions gouvernent.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('espacement proportionnel');

(async () => {
    plan(20);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // --- Outils de mesure, hors interface ------------------------------------------------------
        const mesurer = (nom, evs, signature) => page.evaluate(async ({ evs, signature }) => {
            const m = await import('/src/model/score.js');
            const L = await import('/src/engine/layout.js');
            const D = await import('/src/model/duration.js');   // dureeEnNoires vit LÀ, pas dans score.js
            const faire = (e) => {
                const duree = { valeur: e.v, points: e.pts || 0 };
                if (e.sil) { const x = m.creerEvenement(duree, []); x.silence = true; return x; }
                return m.creerEvenement(duree, [m.creerNote(2, e.fr == null ? 4 : e.fr)]);
            };
            const p = m.creerPartition('basse');
            const mes = m.creerMesure({ voix: [{ evenements: evs.map(faire) }] });
            if (signature) mes.signature = signature;
            p.mesures = [mes, m.creerMesure({ voix: [{ evenements: [] }] })];
            const pg = L.mettreEnPage(p, { largeurPage: 1200, S: 10, mesuresParLigne: 2 });
            const anc = pg.ancrages.evenements.filter(z => z.mesure === 0 && z.voix === 0);
            const mesAnc = pg.ancrages.mesures.find(z => z.index === 0);
            let t = 0;
            const cols = anc.map(z => {
                const d = D.dureeEnNoires(z.ref.duree);
                const r = { debut: t, duree: d, largeur: +(z.xFin - z.xDebut).toFixed(4),
                            xDebut: +z.xDebut.toFixed(4), xFin: +z.xFin.toFixed(4) };
                r.pxParNoire = +(r.largeur / d).toFixed(3);
                t += d;
                return r;
            });
            return { cols, totalEcrit: t, largeurMesure: +(mesAnc.xFin - mesAnc.x).toFixed(2) };
        }, { evs, signature });

        const N = (v, fr, pts) => ({ v, fr, pts });
        const S = (v, pts) => ({ v, sil: true, pts });

        // La mesure EXACTE du retour utilisateur : deux doubles-croches, deux soupirs de croche, un
        // quart de soupir, trois doubles-croches, un soupir, un demi-soupir.
        const duRetour = [N(16, 4), N(16, 4), S(8), S(8), S(16), N(16, 2), N(16, 4), N(16, 4), S(4), S(8)];

        // --- 1. LA MESURE DU RETOUR : une seule vitesse d'un bout à l'autre ------------------------
        const r = await mesurer('retour', duRetour);
        if (!exiger(r.cols.length === 10 && Math.abs(r.totalEcrit - 4) < 1e-9,
            `préalable : la mesure du retour est bien écrite (${r.cols.length} figures, ${r.totalEcrit} noires)`)) {
            throw new Error('mesure mal construite');
        }
        const vitesses = r.cols.map(c => c.pxParNoire);
        const vMin = Math.min(...vitesses), vMax = Math.max(...vitesses);
        check(vMax - vMin < 0.01,
            `toutes les figures occupent le même champ PAR NOIRE (${vMin} à ${vMax} px/♩) — donc une tête `
            + `de lecture à vitesse constante. Elles allaient de 25 à 135 px/s avant correction`);
        const doubles = r.cols[0], soupirCroche = r.cols[2];
        check(Math.abs(soupirCroche.largeur - 2 * doubles.largeur) < 0.01,
            `le soupir de croche fait exactement DEUX fois la largeur d'une double-croche `
            + `(${soupirCroche.largeur} contre ${doubles.largeur} px) — les deux recevaient 16,7 px chacun`);
        const soupirNoire = r.cols[8];
        check(Math.abs(soupirNoire.largeur - 4 * doubles.largeur) < 0.01,
            `et le soupir de noire exactement QUATRE fois (${soupirNoire.largeur} px), alors qu'il est à `
            + 'cheval sur deux temps — le temps qu\'il traverse le paie aussi');

        // --- 2. LA GRILLE DES TEMPS RESTE RIGOUREUSEMENT RÉGULIÈRE --------------------------------
        // C'est l'autre moitié du contrat (voir repere_temps_test.js) : la réglette pose ses
        // graduations sur ces colonnes, un temps est un temps, sa largeur ne varie jamais.
        const bornesTemps = [];
        for (const t of [0, 1, 2, 3, 4]) {
            const c = r.cols.find(z => t >= z.debut - 1e-9 && t < z.debut + z.duree - 1e-9);
            bornesTemps.push(c ? c.xDebut + (c.xFin - c.xDebut) * ((t - c.debut) / c.duree)
                               : r.cols[r.cols.length - 1].xFin);
        }
        const ecarts = bornesTemps.slice(1).map((v, i) => +(v - bornesTemps[i]).toFixed(3));
        check(Math.max(...ecarts) - Math.min(...ecarts) < 0.01,
            `les quatre temps de la mesure tombent à intervalles ÉGAUX (${ecarts.join(', ')} px) — `
            + 'ils faisaient 45, 45, 36,4 quand une figure était à cheval');

        // --- 3. LA MESURE GARDE SA LARGEUR, fixée par la signature --------------------------------
        const temoin = await mesurer('témoin', [N(4), N(4), N(4), N(4)]);
        check(Math.abs(r.largeurMesure - temoin.largeurMesure) < 0.01,
            `la mesure du retour est EXACTEMENT aussi large qu'une mesure de quatre noires `
            + `(${r.largeurMesure} px) : le partage a changé, jamais le budget (voir LARGEUR_PAR_NOIRE)`);

        // --- 4. LE MÉLANGE LE PLUS SIMPLE : deux doubles et une croche sur UN temps ----------------
        const mel = await mesurer('mélange', [N(16), N(16), N(8), N(4), N(4), N(4)]);
        if (exiger(mel.cols.length === 6, 'préalable : le mélange est bien écrit')) {
            check(Math.abs(mel.cols[2].largeur - 2 * mel.cols[0].largeur) < 0.01,
                `1:1:2 sur le temps (${mel.cols[0].largeur}, ${mel.cols[1].largeur}, ${mel.cols[2].largeur} px) — `
                + 'les trois recevaient 16,7 px');
            check(Math.abs(mel.cols[3].largeur - 4 * mel.cols[0].largeur) < 0.01,
                `et la noire quatre fois la double-croche (${mel.cols[3].largeur} px)`);
        }

        // --- 5. LES CAS QUI NE DOIVENT PAS AVOIR BOUGÉ --------------------------------------------
        const reguliers = {
            'seize doubles-croches': Array.from({ length: 16 }, () => N(16)),
            'huit croches': Array.from({ length: 8 }, () => N(8)),
            'une ronde seule': [N(1)],
            'blanche puis croches': [N(2), N(8), N(8), N(8), N(8)],
        };
        for (const [nom, evs] of Object.entries(reguliers)) {
            const x = await mesurer(nom, evs);
            const v = x.cols.map(c => c.pxParNoire);
            check(Math.max(...v) - Math.min(...v) < 0.01 && Math.abs(v[0] - 50) < 0.01,
                `${nom} : 50 px par noire, sans exception (${[...new Set(v)].join(', ')})`);
        }
        const troisQuarts = await mesurer('3/4', [N(4), N(8), N(8), N(4)], { battements: 3, unite: 4 });
        const v34 = troisQuarts.cols.map(c => c.pxParNoire);
        check(Math.max(...v34) - Math.min(...v34) < 0.01,
            `en 3/4 aussi, une seule vitesse (${[...new Set(v34)].join(', ')} px/♩)`);
        const sixHuit = await mesurer('6/8', [N(8), N(8), N(8), N(4, 4, 1)], { battements: 6, unite: 8 });
        const v68 = sixHuit.cols.map(c => c.pxParNoire);
        check(Math.max(...v68) - Math.min(...v68) < 0.01,
            `et en 6/8, où le TEMPS est la noire pointée (${[...new Set(v68)].join(', ')} px/♩)`);

        // --- 6. LE SUPPLÉMENT MATÉRIEL SURVIT, ET RESTE LOCAL -------------------------------------
        // « 12 » réclame plus de champ qu'un « 4 » : c'était l'intention du plancher d'origine, et
        // elle doit tenir — mais SANS déborder sur les temps voisins.
        const deuxChiffres = await mesurer('deux chiffres', [N(16, 12), N(16, 4), N(16, 4), N(16, 4), N(4), N(4), N(4)]);
        if (exiger(deuxChiffres.cols.length === 7, 'préalable : la mesure à deux chiffres est bien écrite')) {
            check(deuxChiffres.cols[0].largeur > deuxChiffres.cols[1].largeur * 1.2,
                `la case « 12 » garde le champ de plus qu'elle réclame (${deuxChiffres.cols[0].largeur} contre `
                + `${deuxChiffres.cols[1].largeur} px pour ses voisines)`);
            const noires = deuxChiffres.cols.slice(4).map(c => c.pxParNoire);
            check(Math.max(...noires) - Math.min(...noires) < 0.01 && Math.abs(noires[0] - 50) < 0.01,
                `et les temps SUIVANTS n'en savent rien (${[...new Set(noires)].join(', ')} px/♩) : `
                + 'le supplément ne déforme que son propre voisinage');
        }

        // --- 7. NEUTRALISATIONS -------------------------------------------------------------------
        const sabotages = await page.evaluate(async ({ evs }) => {
            const m = await import('/src/model/score.js');
            const L = await import('/src/engine/layout.js');
            const D = await import('/src/model/duration.js');   // dureeEnNoires vit LÀ, pas dans score.js
            const faire = (e) => {
                const duree = { valeur: e.v, points: e.pts || 0 };
                if (e.sil) { const x = m.creerEvenement(duree, []); x.silence = true; return x; }
                return m.creerEvenement(duree, [m.creerNote(2, e.fr == null ? 4 : e.fr)]);
            };
            // On rejoue les DEUX anciens calculs, à la main, sur les mêmes colonnes — la mise en page
            // réelle n'est pas touchée : on compare deux partages de la MÊME largeur de mesure.
            const gaps = [];
            let t = 0;
            for (const e of evs) {
                const d = D.dureeEnNoires(faire(e).duree);
                gaps.push({ debut: t, gap: d }); t += d;
            }
            const S = 10, largeurNotes = 4 * 5 * S, unite = 1, nTemps = 4;
            // (a) ANCIEN PLANCHER : max(proportionnelle, 3,2 S) au lieu de la seule proportionnelle
            const avecPlancher = gaps.map(c => ({ ...c, largeur: Math.max(3.9 * S * c.gap, 3.2 * S) }));
            // (b) ANCIEN PARTAGE : chaque colonne rangée dans le SEUL temps où elle attaque
            const partageParAttaque = (cols) => {
                const groupes = Array.from({ length: nTemps }, () => []);
                for (const c of cols) groupes[Math.min(nTemps - 1, Math.floor(c.debut + 1e-9))].push(c);
                const budgets = new Array(nTemps).fill(largeurNotes / nTemps);
                let iPortant = -1;
                for (let i = 0; i < nTemps; i++) {
                    if (groupes[i].length) iPortant = i;
                    else if (iPortant !== -1) { budgets[iPortant] += budgets[i]; budgets[i] = 0; }
                }
                for (let i = 0; i < nTemps; i++) {
                    if (!groupes[i].length) continue;
                    const brut = groupes[i].reduce((s, c) => s + c.largeur, 0);
                    groupes[i].forEach(c => { c.largeur *= budgets[i] / brut; });
                }
                return cols;
            };
            const ancien = partageParAttaque(avecPlancher.map(c => ({ ...c })));
            // (c) le plancher SEUL réparé, l'ancien partage conservé : isole le 2e défaut
            const proportionnelSeul = partageParAttaque(gaps.map(c => ({ ...c, largeur: 3.9 * S * c.gap })));
            const vitesse = (cols) => cols.map(c => +(c.largeur / c.gap).toFixed(2));
            return { ancien: vitesse(ancien), proportionnelSeul: vitesse(proportionnelSeul) };
        }, { evs: duRetour });

        const vAnc = sabotages.ancien;
        check(Math.max(...vAnc) - Math.min(...vAnc) > 10,
            `NEUTRALISATION 1 : avec l'ancien plancher ET l'ancien partage, la mesure du retour retrouve `
            + `ses vitesses multiples (${[...new Set(vAnc)].join(', ')} px/♩) — le banc mesure bien ce que `
            + 'largeurColonne et repartirParTemps gouvernent');
        check(Math.abs(vAnc[0] - vAnc[2] * 2) < 0.5,
            `et la double-croche y va exactement DEUX fois plus vite que le soupir de croche qui suit `
            + `(${vAnc[0]} contre ${vAnc[2]} px/♩) : c'est mot pour mot le retour utilisateur`);
        const vProp = sabotages.proportionnelSeul;
        check(Math.max(...vProp) - Math.min(...vProp) > 1,
            `NEUTRALISATION 2 : le plancher retiré mais l'ancien partage gardé, la figure à cheval `
            + `déséquilibre encore la mesure (${[...new Set(vProp)].join(', ')} px/♩) — les deux correctifs `
            + 'sont nécessaires, aucun ne couvre l\'autre');

        check(erreurs.length === 0, `aucune erreur de console pendant le banc (${erreurs.length})`);
    } catch (e) {
        check(false, 'le banc s\'est terminé sans exception : ' + e.message);
    } finally {
        await fermer();
        process.exit(bilan());
    }
})();
