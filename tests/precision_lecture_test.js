// LE TEST DE PRÉCISION DE LA LECTURE (Réglages > Précision de la lecture ; voir src/audio/precision.js).
//
// CE QU'IL PROTÈGE. Retour utilisateur : « le son n'est pas du tout synchronisé avec ce qui est écrit [...] deux croches
// beaucoup plus espacées que les deux croches qui suivent », entendu sur Safari, la tête de lecture restant juste. Les
// instants de départ sont exacts partout où on a pu mesurer ; reste à mesurer CHEZ celui qui entend. Le test de précision
// est l'instrument de cette mesure : un instrument faux est pire que pas d'instrument — il accuserait la programmation à
// tort, ou l'innocenterait. Ce banc éprouve donc d'abord le CALCUL (sans navigateur, sur des signaux fabriqués dont on
// connaît la réponse), puis le GESTE (dans le navigateur : il joue vraiment, rend tout ce qu'il a emprunté, ne touche pas
// au morceau, se laisse arrêter, se copie).
//
// CE QU'IL NE PEUT PAS ÉPROUVER : ce que mesure l'instrument sur Safari. Ici, un Chromium sans carte son.
const path = require('path');
const { pathToFileURL } = require('url');
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('test de précision de la lecture');

plan(34);

// ---------- des signaux dont on connaît la réponse ----------
// L'énergie d'une note : un bruit de fond, puis une montée linéaire de 8 ms centrée sur `delai` (donc la moitié du pic est
// atteinte EXACTEMENT à `delai`), puis une décroissance. Relevée toutes les millisecondes, comme la vraie boucle d'écoute.
function releves(notes, fin = 4) {
    const out = [];
    for (let t = 0; t < fin; t += 0.001) {
        let e = 0.0004;
        for (const n of notes) {
            const dt = (t - n.temps - n.delai / 1000) * 1000;     // ms depuis le milieu de la montée
            if (dt >= -4 && dt < 4) e = Math.max(e, 0.0004 + n.pic * (dt + 4) / 8);
            else if (dt >= 4) e = Math.max(e, 0.0004 + n.pic * Math.exp(-(dt - 4) / 90));
        }
        out.push([t, e]);
    }
    return out;
}

(async () => {
    const P = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'audio', 'precision.js')).href);

    // ===== A. LE CALCUL, SANS NAVIGATEUR ======================================================================
    {
        const notes = [{ temps: 0.5, delai: 10, pic: 0.1 }, { temps: 0.75, delai: 25, pic: 0.1 }, { temps: 1.0, delai: 40, pic: 0.08 }, { temps: 1.25, delai: 18, pic: 0.12 }];
        const journal = notes.map((n, i) => ({ note: 'C2', temps: n.temps, appel: n.temps - 0.05 }));
        const r = P.analyserReleves(journal, releves(notes));
        const erreurs = r.map((x, i) => Math.abs(x.attaque - notes[i].delai));
        check(erreurs.every((e) => e <= 2.5), `l'attaque de chaque note est datée à 2,5 ms près (écarts : ${erreurs.map((e) => e.toFixed(1)).join(', ')} ms)`);
        check(r.every((x) => x.retard === 0), 'un rappel exécuté AVANT l\'instant prévu n\'a aucun retard : la note part pile à l\'heure');
        const tard = P.analyserReleves(journal.map((j, i) => (i === 2 ? { ...j, appel: j.temps + 0.031 } : j)), releves(notes));
        check(Math.abs(tard[2].retard - 31) < 0.001 && tard[1].retard === 0, 'un rappel exécuté 31 ms APRÈS l\'instant prévu est compté pour 31 ms de retard, et seulement celui-là');
        const faible = P.analyserReleves([{ note: 'E1', temps: 0.5, appel: 0.4 }], releves([{ temps: 0.5, delai: 20, pic: 0.0008 }]));
        check(faible[0].attaque === null, 'une note trop faible pour être datée n\'est PAS datée (null) — un chiffre inventé fausserait les écarts');
        // deux notes à 50 ms : la fenêtre de la première s'arrête avant la seconde
        // la seconde est BIEN plus forte : si la fenêtre de la première débordait sur elle, c'est son attaque que la première croirait entendre
        const serre = [{ temps: 0.5, delai: 12, pic: 0.05 }, { temps: 0.55, delai: 12, pic: 0.2 }];
        const rs = P.analyserReleves(serre.map((n) => ({ note: 'A1', temps: n.temps, appel: n.temps - 0.05 })), releves(serre));
        check(rs.every((x) => Math.abs(x.attaque - 12) <= 4), `deux notes à 50 ms ne se confondent pas : chacune garde SON attaque, à 4 ms près malgré la queue de la première (${rs.map((x) => x.attaque.toFixed(1)).join(' et ')} ms)`);

        // les écarts entendus
        const regulier = [0, 1, 2, 3, 4, 5].map((i) => ({ temps: i * 0.25, attaque: 20, retard: 0 }));
        check(P.ecartsEntendus(regulier).every((d) => Math.abs(d) < 1e-6), 'des attaques toutes décalées pareil donnent des écarts entendus IDENTIQUES aux écarts prévus : un décalage constant ne change pas le rythme');
        const irregulier = [{ temps: 0, attaque: 20 }, { temps: 0.25, attaque: 20 }, { temps: 0.5, attaque: 38 }, { temps: 0.75, attaque: 20 }];
        const devs = P.ecartsEntendus(irregulier);
        check(devs.length === 3 && Math.abs(devs[1] - 18) < 1e-6 && Math.abs(devs[2] + 18) < 1e-6, `une note entendue 18 ms trop tard allonge l'écart qui la précède et raccourcit celui qui la suit (${devs.map((d) => d.toFixed(0)).join(', ')} ms)`);
        const ignorees = P.ecartsEntendus([{ temps: 0, attaque: null }, { temps: 0.25, attaque: 20 }, { temps: 0.5, attaque: 20 }, { temps: 2.5, attaque: 20 }]);
        check(ignorees.length === 1 && Math.abs(ignorees[0]) < 1e-6, 'une paire dont une note n\'est pas datée, ou séparée de plus d\'une seconde, est ignorée : il ne reste que la paire valide');

        // les verdicts : chaque conclusion doit être celle qu'on attend
        const fabriquer = (retardMax, ecartType, paires = 12, latence = null, suspension = 0) => ({
            audio: { latenceSortie: latence }, mesure: { notes: 20 }, fil: { plusLongueSuspension: suspension, suspensionsPlusDe30: 0 },
            resume: { programmation: { retardMax, plusDe10: retardMax > 10 ? 3 : 0, plusDe30: retardMax > 30 ? 2 : 0 }, attaque: { datees: 20, mediane: 24, p10: 18, p90: 38, min: 15, max: 60 }, ecarts: { paires, ecartType, max: ecartType * 2.5, plusDe15: ecartType > 6 ? 4 : 0 } },
        });
        const exacteRegulier = P.verdicts(fabriquer(2, 3)).join('\n');
        check(/Programmation : EXACTE/.test(exacteRegulier) && /RÉGULIERS/.test(exacteRegulier) && /la lecture est régulière/.test(exacteRegulier) && /ce qui est ÉCRIT/.test(exacteRegulier),
            'programmation exacte et écarts réguliers : le test conclut que le défaut vient de ce qui est ÉCRIT, pas du son');
        const rendu = P.verdicts(fabriquer(2, 14)).join('\n');
        check(/IRRÉGULIERS/.test(rendu) && /rendu du son/.test(rendu) && !/programmation sur cette machine/.test(rendu),
            'programmation exacte mais écarts irréguliers : la conclusion accuse le RENDU du son (attaque variable), pas la programmation');
        const retard = P.verdicts(fabriquer(48, 20)).join('\n');
        check(/EN RETARD/.test(retard) && /programmation sur cette machine/.test(retard) && !/rendu du son/.test(retard), 'rappels en retard : la conclusion accuse la PROGRAMMATION, et lui seule');
        check(/Safari ne la dit pas/.test(P.verdicts(fabriquer(2, 3)).join('\n')) && /Latence de sortie : 38 ms/.test(P.verdicts(fabriquer(2, 3, 12, 38)).join('\n')),
            'la latence de sortie est dite quand le navigateur la donne, et « Safari ne la dit pas » quand il ne la donne pas');
        check(/suspendu jusqu'à 120 ms/.test(P.verdicts(fabriquer(2, 3, 12, null, 120)).join('\n')), 'une longue suspension du navigateur pendant le test est signalée');
        check(!/CONCLUSION/.test(P.verdicts(fabriquer(2, 3, 2)).join('\n')), 'avec moins de quatre paires de notes, le test ne conclut PAS : trop peu pour juger');

        const gros = { date: 'd', navigateur: 'n', audio: { tauxEchantillonnage: 48000, lookAhead: 100, latenceBase: 10, latenceSortie: null, etat: 'running', source: 'piano échantillonné' }, morceau: { titre: 'T', tempo: 90, vitesse: 1 }, mesure: { notes: 80, secondes: 20, tronque: false },
            verdicts: ['v'], notes: Array.from({ length: 80 }, (_, i) => ({ note: 'C2', temps: i / 4, retard: 0, attaque: 20 })) };
        const texte = P.rapportEnTexte(gros);
        check(/TEST DE PRÉCISION DE LA LECTURE/.test(texte) && /latence de sortie non fournie/.test(texte) && /\(20 notes de plus\)/.test(texte) && texte.split('\n').length < 90, 'le rapport en texte porte son titre, dit « non fournie », et coupe à 60 notes en le disant');
    }

    // ===== B. LE GESTE, DANS LE NAVIGATEUR =======================================================================
    const { page, erreurs, fermer, contexte } = await ouvrirApp({ viewport: { width: 1320, height: 900 } });
    try {
        await contexte.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
        const injecter = (nbMesures, tempo) => page.evaluate(([nb, bpm]) => {
            const ed = window.app.editeur; const p = JSON.parse(JSON.stringify(ed.partition));
            const modele = JSON.parse(JSON.stringify(p.mesures[0])); const ev0 = modele.voix[0].evenements[0];
            p.meta.tempo = bpm;
            p.mesures = Array.from({ length: nb }, (_, m) => {
                const mes = JSON.parse(JSON.stringify(modele));
                mes.voix[0].evenements = [0, 3, 5, 7, 5, 3, 0, 2].map((f, i) => {
                    const e = JSON.parse(JSON.stringify(ev0)); e.id = `m${m}e${i}`; e.silence = false; e.duree = { valeur: 8, points: 0, nolet: null };
                    e.notes = [{ id: `m${m}n${i}`, corde: i % 4, frette: f, lien: null, bend: null, ghost: false }]; return e;
                });
                return mes;
            });
            ed.remplacer(p); ed.allerAMesure(0, 0);
        }, [nbMesures, tempo]);

        await page.evaluate(() => { window.app.remplirReglages(); window.app.ouvrirFenetre('fenetre-reglages'); });
        await page.waitForTimeout(250);
        const rubrique = await page.evaluate(() => {
            const r = [...document.querySelectorAll('#fenetre-reglages .rubrique')];
            return { derniere: r[r.length - 1].id, titre: r[r.length - 1].querySelector('h3').textContent, bouton: document.getElementById('btn-precision').textContent, champCache: document.getElementById('rapport-precision').hidden, copieCachee: document.getElementById('ligne-copie-precision').hidden };
        });
        exiger(rubrique.derniere === 'rubrique-precision' && rubrique.titre === 'Précision de la lecture', 'Réglages a une rubrique « Précision de la lecture », la dernière de la fenêtre');
        check(rubrique.bouton === 'Lancer le test' && rubrique.champCache && rubrique.copieCachee, 'au départ : un bouton « Lancer le test », et ni rapport ni bouton de copie');

        // --- un morceau vide : le test refuse, sans rien jouer
        await page.click('#btn-precision'); await page.waitForFunction(() => document.getElementById('etat-precision').textContent === 'impossible', null, { timeout: 8000 });
        const vide = await page.evaluate(() => ({ msg: document.getElementById('rapport-precision').value, etat: window.app.lecteur.etat, copie: document.getElementById('ligne-copie-precision').hidden }));
        check(/aucune note/.test(vide.msg) && vide.etat === 'arret' && vide.copie, 'sur un morceau vide : « aucune note », rien n\'est joué, et pas de bouton de copie pour un message d\'erreur');

        // --- une boucle active : le test refuse aussi
        await injecter(2, 240);
        await page.evaluate(() => { window.__boucle0 = window.app.lecteur.boucleLecture; window.app.lecteur.boucleLecture = { debut: 0, fin: 0 }; });
        await page.click('#btn-precision'); await page.waitForFunction(() => document.getElementById('etat-precision').textContent === 'impossible', null, { timeout: 8000 });
        check(/boucle/.test(await page.inputValue('#rapport-precision')), 'une boucle de lecture active : le test refuse et dit pourquoi (il mesure le morceau ENTIER)');
        await page.evaluate(() => { window.app.lecteur.boucleLecture = window.__boucle0; });

        // --- la vraie mesure : 2 mesures de croches à 240 bpm (4 s), avec décompte, métronome et vitesse RÉGLÉS au préalable
        await page.evaluate(() => { const L = window.app.lecteur; L.decompteActif = true; L.metronomeActif = true; L.definirVitesse?.(0.5); window.__vit0 = L.vitesse; window.__avant = JSON.stringify(window.app.editeur.partition); });
        await page.click('#btn-precision');
        const enCours = await page.evaluate(() => ({ bouton: document.getElementById('btn-precision').textContent }));
        check(enCours.bouton === 'Arrêter le test', 'pendant la mesure, le bouton devient « Arrêter le test »');
        await page.waitForFunction(() => document.getElementById('etat-precision').textContent === 'terminé', null, { timeout: 40000 });
        const R = await page.evaluate(() => {
            const L = window.app.lecteur; const r = window.app.dernierRapportPrecision;
            return { r: { secondes: r.mesure.secondes, notes: r.mesure.notes, retardMax: r.resume.programmation.retardMax, datees: r.resume.attaque.datees, source: r.audio.source, nbVerdicts: r.verdicts.length, tempo: r.morceau.tempo, vitesse: r.morceau.vitesse, premier: r.notes[0], suspensions: r.fil },
                texte: document.getElementById('rapport-precision').value, visible: !document.getElementById('rapport-precision').hidden, copie: !document.getElementById('ligne-copie-precision').hidden,
                etat: { decompte: L.decompteActif, metronome: L.metronomeActif, vitesse: L.vitesse === window.__vit0, lecteur: L.etat, boucle: L.boucleLecture }, partitionIntacte: JSON.stringify(window.app.editeur.partition) === window.__avant,
                crochetRetire: !String(L.synthe.triggerAttackRelease).includes('journal.push'), bouton: document.getElementById('btn-precision').textContent };
        });
        check(R.r.notes === 16, `les 16 croches du morceau ont été déclenchées et mesurées (${R.r.notes})`);
        check(R.visible && R.copie && R.bouton === 'Relancer le test', 'le rapport s\'affiche, le bouton de copie apparaît, et le bouton propose de relancer');
        check(/TEST DE PRÉCISION DE LA LECTURE/.test(R.texte) && /Programmation :/.test(R.texte) && /Attaque audible :/.test(R.texte) && /Latence de sortie :/.test(R.texte) && /n°\s+note\s+à \(s\)/.test(R.texte), 'le rapport dit la programmation, l\'attaque audible, la latence de sortie, et donne le tableau note par note');
        check(R.r.retardMax <= 40, `ici, sans charge, aucune note n'est partie en retard notable (maximum ${R.r.retardMax} ms)`);
        check(R.r.datees >= 12, `l'attaque audible a pu être datée pour la plupart des notes (${R.r.datees} sur 16) : l'écoute de la sortie fonctionne`);
        check(R.r.vitesse === 1 && R.r.tempo === 240, `le rapport dit qu'il a mesuré au tempo ÉCRIT (${R.r.tempo} bpm, vitesse ${Math.round(R.r.vitesse * 100)} %), même si la vitesse de travail était réglée à 50 %`);
        check(R.r.secondes >= 1.8 && R.r.secondes < 2.8, `et sans décompte : 8 temps à 240 bpm durent 2 s, la mesure en a pris ${R.r.secondes} — un décompte d'une mesure en aurait ajouté une de plus`);
        check(R.etat.decompte === true && R.etat.metronome === true && R.etat.vitesse === true && R.etat.lecteur === 'arret' && R.etat.boucle === null,
            `après le test, décompte, métronome et vitesse de travail sont RESTITUÉS tels qu'avant, et le lecteur est à l'arrêt (${JSON.stringify(R.etat)})`);
        check(R.partitionIntacte, 'le morceau n\'a pas bougé d\'une virgule');
        check(R.crochetRetire, 'le crochet posé sur le déclenchement des notes est RETIRÉ : la fonction d\'origine est rendue');

        // --- copier
        await page.click('#btn-precision-copier'); await page.waitForTimeout(250);
        const presse = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
        check(presse === R.texte || presse === null, presse === null ? '(presse-papiers illisible dans ce navigateur d\'essai : on ne juge que l\'absence d\'erreur)' : '« Copier le rapport » met EXACTEMENT le texte du rapport dans le presse-papiers');

        // --- l'arrêter en route : un morceau long (4 mesures à 60 bpm = 16 s), un second clic après 1,5 s
        await page.evaluate(() => { const L = window.app.lecteur; L.decompteActif = false; L.metronomeActif = false; L.definirVitesse?.(1); });
        await injecter(4, 60);
        await page.click('#btn-precision');
        // On attend que la LECTURE ait commencé (hors attente des échantillons, qui n'arrivent pas dans ce navigateur d'essai).
        await page.waitForFunction(() => /^Mesure en cours/.test(document.getElementById('etat-precision').textContent), null, { timeout: 15000 });
        await page.waitForTimeout(1600);
        const t0 = Date.now(); await page.click('#btn-precision');
        await page.waitForFunction(() => document.getElementById('etat-precision').textContent === 'terminé', null, { timeout: 8000 });
        const coupe = await page.evaluate(() => ({ notes: window.app.dernierRapportPrecision.mesure.notes, lecteur: window.app.lecteur.etat }));
        check(Date.now() - t0 < 4000 && coupe.notes > 0 && coupe.notes < 32 && coupe.lecteur === 'arret', `un second clic arrête la mesure en route (${coupe.notes} notes sur 32 mesurées, lecteur à l'arrêt, en ${Date.now() - t0} ms)`);

        // --- téléphone : le rapport tient dans la fenêtre
        await page.setViewportSize({ width: 390, height: 800 });
        await page.waitForTimeout(250);
        const tel = await page.evaluate(() => { const c = document.getElementById('rapport-precision').getBoundingClientRect(), f = document.querySelector('#fenetre-reglages .fenetre').getBoundingClientRect(); return { debord: document.documentElement.scrollWidth - innerWidth, dedans: c.left >= f.left - 1 && c.right <= f.right + 1, largeur: Math.round(c.width) }; });
        check(tel.debord <= 0 && tel.dedans, `sur téléphone (390 px) le rapport tient dans la fenêtre sans faire déborder la page (${tel.largeur} px de large)`);
        check(erreurs.length === 0, `aucune erreur JavaScript — ${erreurs.slice(0, 2).join(' | ')}`);
    } finally { await fermer(); }
    bilan();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
