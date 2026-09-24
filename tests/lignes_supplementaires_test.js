// Banc des LIGNES SUPPLÉMENTAIRES — et du filet qui empêche une hauteur aberrante de figer la page.
//
// CE QU'IL PROTÈGE. Les deux boucles de engine/layout.js#poserLignesSupplementaires comptent en
// INTERLIGNES depuis la portée : une note posée très loin en réclame autant qu'il y a d'interlignes
// pour l'atteindre. Pour de la musique, c'est borné par la nature des choses — cinq lignes pour le
// mi 6 d'une guitare en case 24. Pour un DOCUMENT ABÎMÉ, ça ne l'est pas : une case lue comme du
// texte (`frette: '7'` au lieu de 7) suffit à faire de la hauteur MIDI une concaténation, et la note
// part à des centaines de milliers d'interlignes.
//
// MESURÉ avant ce filet, sur une seule note dont la hauteur avait dérivé, dans un morceau de QUATRE
// mesures : 188 710 éléments <line>, 23 Mo de SVG, la page figée 3,9 s à chaque redessin — et le coût
// DOUBLANT à chaque note ajoutée (1,4 s, puis 2,4, puis 4,0, puis 7,1). L'application était
// inutilisable, sans le moindre message : le symptôme ne disait rien de sa cause.
//
// CE QUE LE FILET NE FAIT PAS. Il ne corrige pas la note et ne la cache pas : elle reste écrite,
// visible et éditable — simplement sans son échelle de lignes au-delà du plafond, ce qui la signale
// au moins aussi bien qu'un empilement illisible. Une note fausse doit se voir et se corriger, jamais
// bloquer l'application.
//
// ET LA GRAVURE ORDINAIRE NE BOUGE PAS : les premières vérifications l'épinglent, sans quoi ce banc
// couvrirait un plafond qui aurait pu être posé n'importe où, y compris là où il mangerait des lignes
// dont la musique a besoin.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('lignes supplémentaires');

(async () => {
    plan(7);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        const r = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const L = await import('/src/engine/layout.js');

            /** Compte les <line> courtes (les lignes supplémentaires) d'une page mise en page. */
            const poser = (note) => {
                const p = m.creerPartition('guitare');
                p.mesures = [m.creerMesure({ voix: [{ evenements: [m.creerEvenement({ valeur: 1 }, [note])] }] })];
                const debut = Date.now();
                const pg = L.mettreEnPage(p, { largeurPage: 1100, S: 10, mesuresParLigne: 4 });
                const ms = Date.now() - debut;
                // Une ligne supplémentaire est HORIZONTALE et COURTE : les lignes de portée et de
                // TAB courent sur toute la mesure, les barres de mesure sont verticales. Les deux
                // conditions ensemble, jamais la largeur seule — mesuré, la largeur seule comptait
                // aussi les trois barres de mesure verticales, et le banc partait de 3 au lieu de 0.
                const courtes = pg.primitives.filter(e => e.t === 'ligne'
                    && Math.abs(e.y2 - e.y1) < 1e-6 && Math.abs(e.x2 - e.x1) < 3 * 10);
                return { n: courtes.length, ms, total: pg.primitives.length };
            };

            return {
                // Sol 4 (corde 0, case 3) : dans la portée, aucune ligne supplémentaire.
                dansLaPortee: poser(m.creerNote(0, 3)),
                // Mi 6 : la note la plus aiguë d'une guitare standard — quelques lignes, pas zéro.
                trèsAigu: poser(m.creerNote(0, 24)),
                // LA CASE LUE COMME DU TEXTE : exactement le document abîmé décrit plus haut.
                abimee: poser(m.creerNote(0, '7')),
            };
        });

        check(r.dansLaPortee.n === 0,
            `une note DANS la portée n'a aucune ligne supplémentaire (${r.dansLaPortee.n})`);
        check(r.trèsAigu.n >= 1 && r.trèsAigu.n <= 12,
            `la note la plus aiguë d'une guitare en reçoit ce qu'il faut, sans plafonner (${r.trèsAigu.n}) : `
            + 'le filet ne mange rien de ce dont la gravure a besoin');

        exiger(r.abimee.n != null, 'la mise en page d\'un document abîmé aboutit, au lieu de tourner sans fin');
        check(r.abimee.n <= 12,
            `une hauteur aberrante est plafonnée à douze lignes (${r.abimee.n}) — il s'en dessinait 188 710`);
        check(r.abimee.total < 500,
            `la page entière reste de taille normale (${r.abimee.total} éléments) : c'est le nombre d'ÉLÉMENTS `
            + 'qui figeait le navigateur, pas le calcul lui-même');
        check(r.abimee.ms < 1000,
            `et la mise en page prend un temps ordinaire (${r.abimee.ms} ms, contre près de 4 000 de redessin avant le filet)`);

        check(erreurs.length === 0, `aucune erreur de console pendant le banc (${erreurs.length})`);
    } catch (e) {
        check(false, 'le banc s\'est terminé sans exception : ' + e.message);
    } finally {
        await fermer();
        process.exit(bilan());
    }
})();
