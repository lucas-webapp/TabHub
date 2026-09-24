// Banc des TROIS GESTES QUI MANQUAIENT DE VITESSE — trouvés en comparant TabHub à MuseScore et à
// Guitar Pro sur un vrai morceau de dix mesures, chronomètre en main.
//
// LA MESURE QUI A LANCÉ CE LOT. Écrire les dix mesures coûtait 200 frappes pour 74 notes (2,70 par
// note), et les corriger 32 frappes pour dix-neuf corrections : sur ce terrain-là TabHub tient la
// comparaison sans rien devoir à personne. Un seul écart restait, et il était net — « ces huit
// doubles sont en fait des croches » coûtait QUINZE frappes (huit touches de durée et sept flèches
// pour aller de l'une à l'autre), là où une sélection et une touche suffisent ailleurs depuis
// toujours. Le lasso, lui, ne savait qu'EFFACER.
//
// CE QUE LA MESURE A AUSSI ÉCARTÉ, et c'est la moitié de ce que ce banc transmet : l'idée évidente
// de touches « aller directement à la corde N » pour tuer les 40 % de frappes passées en flèches.
// Comptée sur le même morceau, elle aurait fait gagner TROIS frappes sur deux cents — 32 notes sur
// 74 restent sur la même corde et presque tous les sauts font un seul cran. On ne l'a pas écrite.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('sélection, triolet, prolongation');

(async () => {
    plan(23);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // ── 1. UN GESTE SUR TOUTE LA SÉLECTION ──────────────────────────────────────────────────
        const lot = await page.evaluate(async () => {
            const { Editeur } = await import('/src/edit/commands.js');
            const { ACTIONS } = await import('/src/edit/raccourcis.js');
            const { dureeEnNoires } = await import('/src/model/duration.js');
            const A = (id) => ACTIONS.find(a => a.id === id);
            const out = {};

            // Huit doubles-croches, comme la cinquième mesure du morceau d'essai.
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 16, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 0, 0);
            for (let k = 0; k < 8; k++) ed.saisirChiffre(k);
            const durees = () => ed.partition.mesures[0].voix[0].evenements
                .slice(0, 8).map(e => dureeEnNoires(e.duree));
            out.avant = durees();

            // Ce que l'interface passe à l'éditeur quand le lasso a attrapé ces huit notes.
            const choisies = [];
            ed.partition.mesures[0].voix[0].evenements.slice(0, 8).forEach((e, i) =>
                e.notes.forEach(n => choisies.push({ mesure: 0, voix: 0, evenement: i, corde: n.corde })));
            const actions = { notesSelectionnees: () => choisies };

            const pileAvant = ed.passe.length;
            A('duree8').faire(ed, actions);
            out.apres = durees();
            out.pointsDAnnulation = ed.passe.length - pileAvant;
            out.bilan = ed.dernierBilan;
            out.selectionRendue = (ed.derniereSelection || []).length;
            ed.annuler();
            out.apresUndo = durees();

            // UN ACCORD : trois notes choisies, UNE seule durée à changer.
            const ac = new Editeur(); ac.nouveau('guitare');
            ac.dureeCourante = { valeur: 8, points: 0, nolet: null };
            ac.placerCurseur(0, 0, 0, 0); ac.saisirChiffre(0);
            ac.resterSurLeTemps(-1); ac.saisirChiffre(2);
            ac.resterSurLeTemps(-1); ac.saisirChiffre(2);
            const evtAccord = ac.partition.mesures[0].voix[0].evenements[0];
            const troisNotes = evtAccord.notes.map(n => ({ mesure: 0, voix: 0, evenement: 0, corde: n.corde }));
            out.accordAvant = dureeEnNoires(evtAccord.duree);
            A('duree4').faire(ac, { notesSelectionnees: () => troisNotes });
            out.accordApres = dureeEnNoires(ac.partition.mesures[0].voix[0].evenements[0].duree);

            // SANS SÉLECTION, le chemin ordinaire doit être RIGOUREUSEMENT celui d'avant.
            const seul = new Editeur(); seul.nouveau('guitare');
            seul.dureeCourante = { valeur: 16, points: 0, nolet: null };
            seul.placerCurseur(0, 0, 0, 0); seul.saisirChiffre(3);
            seul.placerCurseur(0, 0, 0, 0);
            const pileSeul = seul.passe.length;
            A('duree8').faire(seul, { notesSelectionnees: () => [] });
            out.seul = { duree: dureeEnNoires(seul.partition.mesures[0].voix[0].evenements[0].duree),
                         points: seul.passe.length - pileSeul };
            // …et même sans le pont du tout : une interface qui ne l'offre pas doit marcher pareil.
            const nu = new Editeur(); nu.nouveau('guitare');
            nu.dureeCourante = { valeur: 16, points: 0, nolet: null };
            nu.placerCurseur(0, 0, 0, 0); nu.saisirChiffre(3);
            nu.placerCurseur(0, 0, 0, 0);
            A('duree8').faire(nu, {});
            out.sansPont = dureeEnNoires(nu.partition.mesures[0].voix[0].evenements[0].duree);
            return out;
        });

        exiger(lot.avant.every(d => Math.abs(d - 0.25) < 1e-9),
            `préalable : huit doubles-croches écrites (${lot.avant.map(d => d.toFixed(2)).join(' ')})`);
        check(lot.apres.every(d => Math.abs(d - 0.5) < 1e-9),
            `UNE touche les met toutes en croches (${lot.apres.map(d => d.toFixed(2)).join(' ')}) — `
            + 'quinze frappes économisées sur ce seul geste');
        check(lot.pointsDAnnulation === 1,
            `et elles ne font qu'UN point d'annulation (${lot.pointsDAnnulation}) : huit notes modifiées `
            + 'd\'une touche ne doivent pas demander huit Ctrl+Z pour revenir en arrière');
        check(lot.apresUndo.every(d => Math.abs(d - 0.25) < 1e-9),
            'un seul Ctrl+Z les rend toutes');
        check(/8 temps/.test(lot.bilan || ''),
            `le geste dit ce qu'il a fait (« ${lot.bilan} ») : huit notes changent d'un coup, on doit `
            + 'pouvoir le lire ailleurs que dans la partition');
        check(lot.selectionRendue === 8,
            `la sélection est RECALCULÉE et rendue à l'interface (${lot.selectionRendue} notes) : les rangs `
            + 'ont bougé, et laisser la surbrillance sur les notes voisines ferait frapper à côté au '
            + 'geste suivant — l\'erreur la plus déroutante qui soit, puisqu\'on croit voir ce qu\'on a choisi');

        exiger(Math.abs(lot.accordAvant - 0.5) < 1e-9, 'préalable : un accord de trois cases sur une croche');
        check(Math.abs(lot.accordApres - 1) < 1e-9,
            `un accord ne reçoit le geste QU'UNE FOIS (${lot.accordApres} ♩, pas ${(0.5 * 8).toFixed(0)}) : `
            + 'trois cases choisies sont trois notes, mais une seule durée');

        check(Math.abs(lot.seul.duree - 0.5) < 1e-9 && lot.seul.points === 1,
            'sans sélection, le geste agit sur le curseur exactement comme avant, en un point d\'annulation');
        check(Math.abs(lot.sansPont - 0.5) < 1e-9,
            'et même quand l\'interface n\'offre aucun pont vers une sélection : le chemin ordinaire ne '
            + 'paie rien pour cette mécanique');

        // ── 2. LE TRIOLET REMODÈLE LE TEMPS ─────────────────────────────────────────────────────
        const triolet = await page.evaluate(async () => {
            const { Editeur } = await import('/src/edit/commands.js');
            const { dureeEnNoires } = await import('/src/model/duration.js');
            const lire = (ed) => ed.partition.mesures[0].voix[0].evenements.map(e => ({
                d: dureeEnNoires(e.duree), nolet: !!e.duree.nolet,
                notes: e.silence ? [] : e.notes.map(n => n.frette),
            }));
            const out = {};
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 4, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 0, 0); ed.saisirChiffre(5);
            ed.placerCurseur(0, 1, 0, 0); ed.saisirChiffre(7);
            ed.placerCurseur(0, 0, 0, 0);
            out.avant = { evts: lire(ed), ecart: ed.ecartMesure(0, 0) };
            ed.basculerTriolet();
            out.apres = { evts: lire(ed), ecart: ed.ecartMesure(0, 0), curseur: ed.curseur.evenement,
                          palette: { ...ed.dureeCourante } };
            // Deux frappes de plus, et le temps est écrit.
            ed.saisirChiffre(7); ed.saisirChiffre(8);
            out.rempli = lire(ed);
            // Rappuyer défait le triolet et rend le temps à UNE figure.
            ed.placerCurseur(0, 0, 0, 0); ed.basculerTriolet();
            out.defait = { evts: lire(ed), bilan: ed.dernierBilan };
            // Une triple-croche n'a rien de plus court : on le DIT.
            const t = new Editeur(); t.nouveau('guitare');
            t.dureeCourante = { valeur: 32, points: 0, nolet: null };
            t.placerCurseur(0, 0, 0, 0); t.saisirChiffre(5); t.placerCurseur(0, 0, 0, 0);
            out.tropCourt = { rendu: t.basculerTriolet(), message: t.derniereErreur };
            return out;
        });

        exiger(triolet.avant.evts[0].d === 1 && triolet.avant.ecart === 0,
            'préalable : une noire écrite dans une mesure juste');
        check(triolet.apres.evts.slice(0, 3).every(e => Math.abs(e.d - 1 / 3) < 1e-6 && e.nolet)
              && triolet.apres.ecart === 0,
            `« triolet » remplace la noire par TROIS croches de triolet (${triolet.apres.evts.slice(0, 3)
                .map(e => e.d.toFixed(3)).join(' ')}), et le temps ne bouge pas d'un iota (écart `
            + `${triolet.apres.ecart}) — avant, la noire devenait une noire DE TRIOLET (⅔) et le tiers `
            + 'restant tombait en silence : jamais ce qu\'on demande en pressant ce bouton');
        check(triolet.apres.evts[0].notes.join(',') === '5',
            `la note qui était là reste la PREMIÈRE du triolet (case ${triolet.apres.evts[0].notes.join(',')})`);
        check(triolet.apres.curseur === 1,
            `et le curseur se pose sur la première case VIDE (e${triolet.apres.curseur}) : rester sur la `
            + 'première écraserait à la frappe suivante la note qu\'on voulait justement garder');
        check(!!triolet.apres.palette.nolet && triolet.apres.palette.valeur === 8,
            'la palette reste sur le triolet, pour que les deux cases suivantes se tapent sans rien redemander');
        check(triolet.rempli.slice(0, 3).map(e => e.notes.join('')).join(',') === '5,7,8',
            `trois frappes en tout et le temps est écrit (${triolet.rempli.slice(0, 3)
                .map(e => e.notes.join('')).join(' ')})`);
        check(triolet.defait.evts[0].d === 1 && !triolet.defait.evts[0].nolet,
            `rappuyer défait le triolet et rend le temps à UNE noire (${triolet.defait.evts[0].d} ♩)`);
        check(/2 notes/.test(triolet.defait.bilan || ''),
            `en disant ce qu'il a détruit (« ${triolet.defait.bilan} ») : trois cases redeviennent une, `
            + 'deux notes disparaissent, et un geste qui détruit l\'annonce');
        check(triolet.tropCourt.rendu === false && /plus courte/.test(triolet.tropCourt.message || ''),
            `une triple-croche refuse, et explique (« ${triolet.tropCourt.message} ») : il n'y a pas de `
            + 'figure plus brève pour en faire trois');

        // ── 3. LA PROLONGATION ÉCRIT SA NOTE D'ARRIVÉE ──────────────────────────────────────────
        // (le cœur du geste est figé dans perte_silencieuse_test.js, section C ; ici on vérifie
        //  qu'il traverse bien la BARRE DE MESURE, ce pour quoi il existe)
        const liaison = await page.evaluate(async () => {
            const { Editeur } = await import('/src/edit/commands.js');
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 1, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 0, 0); ed.saisirChiffre(7);   // une ronde : elle remplit m1
            ed.placerCurseur(0, 0, 0, 0);
            const rendu = ed.basculerLien('tie');
            const m2 = ed.partition.mesures[1].voix[0].evenements[0];
            return { rendu, lien: ed.partition.mesures[0].voix[0].evenements[0].notes[0].lien,
                     arrivee: m2.silence ? null : m2.notes.map(n => n.corde + '/' + n.frette).join('+') };
        });
        check(liaison.rendu === true && liaison.lien === 'tie' && liaison.arrivee === '0/7',
            `une ronde tenue par-dessus la barre écrit son arrivée dans la mesure suivante `
            + `(${liaison.arrivee}) : c'est LE geste qu'on fait avec une prolongation, et il fallait `
            + 'écrire la mesure d\'après, revenir en arrière, puis lier');

        // ── NEUTRALISATION : on retire l'enveloppe, le lasso ne sait plus qu'effacer ────────────
        const neutre = await page.evaluate(async () => {
            const { Editeur } = await import('/src/edit/commands.js');
            const { dureeEnNoires } = await import('/src/model/duration.js');
            const ed = new Editeur(); ed.nouveau('guitare');
            ed.dureeCourante = { valeur: 16, points: 0, nolet: null };
            ed.placerCurseur(0, 0, 0, 0);
            for (let k = 0; k < 8; k++) ed.saisirChiffre(k);
            const choisies = [];
            ed.partition.mesures[0].voix[0].evenements.slice(0, 8).forEach((e, i) =>
                e.notes.forEach(n => choisies.push({ mesure: 0, voix: 0, evenement: i, corde: n.corde })));
            // L'ANCIEN GESTE, celui d'avant l'enveloppe : il ne connaît que le curseur. On le
            // rejoue tel quel pour montrer qu'il ne touche QU'UNE note, sélection ou pas.
            ed.placerCurseur(0, 0, 0, 0);
            ed.appliquerDuree(8);
            const d = ed.partition.mesures[0].voix[0].evenements.slice(0, 8).map(e => dureeEnNoires(e.duree));
            return { premiere: d[0], autres: d.slice(1), choisies: choisies.length };
        });
        exiger(neutre.choisies === 8, 'préalable : huit notes bien choisies');
        check(Math.abs(neutre.premiere - 0.5) < 1e-9 && neutre.autres.every(x => Math.abs(x - 0.25) < 1e-9),
            `neutralisation : la commande nue ne change QUE la note sous le curseur (${neutre.premiere} ♩ `
            + `contre ${neutre.autres.length} × ${neutre.autres[0]} ♩), sélection ou pas — c'est bien `
            + 'l\'enveloppe posée sur la déclaration de l\'action qui porte tout le gain, et rien d\'autre');

        check(erreurs.length === 0, 'aucune erreur de console ni exception (' + erreurs.join(' | ') + ')');
    } catch (e) {
        check(false, 'exception pendant le banc : ' + e.message + '\n' + e.stack);
    } finally {
        await fermer();
    }
    process.exit(bilan());
})();
