// Banc des DEUX VOIX sur une même portée — guitare et basse.
//
// CE QU'IL PROTÈGE, et il faut commencer par ce qui n'était PAS le problème : le moteur savait déjà
// graver deux voix. Hampes opposées (voix 1 en haut, voix 2 en bas), silences décalés verticalement,
// ligatures et liaisons calculées PAR voix, évitement de collision entre têtes — tout cela vivait
// dans engine/layout.js depuis le piano. Le README l'a longtemps nié, et une première analyse l'a
// cru : la vérification ci-dessous mesure donc la gravure elle-même, pour que plus personne ne s'y
// trompe.
//
// CE QUI MANQUAIT ÉTAIT LA PORTE. « + Voix »/« − Voix » avaient été retirés de la palette
// guitare/basse sur un retour sans appel — « je ne comprends pas les boutons voix+/voix-, à quoi
// cela sert-il ? » — et rien ne les remplaçait : tout le répertoire de guitare classique et
// fingerstyle (une basse tenue sous la mélodie, l'écriture de *Jeux interdits*) était gravable mais
// pas saisissable. Le retrait était justifié : deux boutons pour deux états d'une même question,
// avec un nom qui ne disait pas l'usage. D'où un seul interrupteur, qui NOMME l'usage.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('deux voix');

(async () => {
    plan(24);
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 1500, height: 950 } });
    try {
        const etat = () => page.evaluate(() => {
            const b = document.querySelector('[data-action="deuxVoix"]');
            const t = document.querySelector('[data-action="basculerVoix"]');
            return {
                nbVoix: window.app.editeur.nbVoixMesure(),
                voixCourante: window.app.editeur.curseur.voix,
                bouton: b ? { visible: b.getBoundingClientRect().width > 0, actif: b.classList.contains('actif'),
                              cadre: b.closest('.groupe-outils')?.dataset.groupe, titre: b.title } : null,
                bascule: t ? { cache: t.hidden, texte: t.textContent.trim(), titre: t.title } : null,
                voixParMesure: window.app.editeur.partition.mesures.map(m => m.voix.length),
            };
        });

        // =====================================================================================
        // 1. L'ENTRÉE EXISTE, ELLE EST NOMMÉE, ET ELLE EST AU BON ENDROIT
        // =====================================================================================
        const depart = await etat();
        exiger(!!depart.bouton, 'un interrupteur de seconde voix existe dans la palette');
        check(depart.bouton.visible && depart.bouton.cadre === 'ecriture',
            `il est visible pour la GUITARE, dans le cadre « Écriture » (reçu « ${depart.bouton.cadre} ») — `
            + 'à côté de « Ternaire », parce que ce sont deux réglages de la MANIÈRE d\'écrire');
        check(/basse tenue/.test(depart.bouton.titre),
            `et son infobulle NOMME l'usage plutôt que le mécanisme (« ${depart.bouton.titre} ») — `
            + '« voix » est du vocabulaire de logiciel, « une basse tenue sous la mélodie » est du '
            + 'vocabulaire de guitariste');
        check(depart.nbVoix === 1 && !depart.bouton.actif,
            'une mesure neuve n\'a qu\'une voix, et l\'interrupteur est éteint');
        check(depart.bascule?.cache === true,
            'le basculeur de voix est caché tant qu\'il n\'y en a qu\'une — rien à basculer');

        // =====================================================================================
        // 2. L'INTERRUPTEUR AGIT, ET DIT DANS QUELLE VOIX ON ÉCRIT
        // Aucun autre élément de l'interface ne le disait, et taper dans la mauvaise voix sans le
        // savoir est le défaut le plus coûteux d'une saisie à deux voix.
        // =====================================================================================
        await page.click('[data-action="deuxVoix"]');
        await page.waitForTimeout(350);
        const aDeux = await etat();
        check(aDeux.nbVoix === 2 && aDeux.bouton.actif,
            `un clic ajoute la seconde voix (${aDeux.nbVoix}) et l'interrupteur s'allume`);
        check(aDeux.voixCourante === 1,
            `et le curseur s'y place aussitôt (voix ${aDeux.voixCourante + 1}) : on vient de la `
            + 'demander, c\'est pour la remplir');
        check(aDeux.bascule.cache === false && /Voix 2 → 1/.test(aDeux.bascule.texte),
            `le basculeur apparaît et dit D'OÙ L'ON VIENT et où l'on va (« ${aDeux.bascule.texte} ») — `
            + 'la destination seule laisserait deviner la voix courante par soustraction');
        check(/hampes en bas/.test(aDeux.bascule.titre),
            `et son infobulle rattache la voix à ce qu'on VOIT sur la portée (« ${aDeux.bascule.titre} »)`);

        await page.click('[data-action="basculerVoix"]');
        await page.waitForTimeout(300);
        const revenu = await etat();
        check(revenu.voixCourante === 0 && /Voix 1 → 2/.test(revenu.bascule.texte),
            `le basculeur ramène à la voix 1 et se retourne (« ${revenu.bascule.texte} »)`);

        await page.click('[data-action="deuxVoix"]');
        await page.waitForTimeout(350);
        check((await etat()).nbVoix === 1,
            'un second clic retire la seconde voix — UN interrupteur pour les deux états, et non deux '
            + 'boutons dont il faut deviner lequel s\'applique');

        // =====================================================================================
        // 3. TOUT LE MORCEAU D'UN GESTE — l'entrée du menu contextuel
        // Une pièce écrite à deux voix l'est du début à la fin : la demander mesure par mesure sur
        // trente-deux mesures ferait renoncer.
        // =====================================================================================
        const clicDroit = async () => {
            const p = await page.evaluate(() => {
                const a = window.app.page.ancrages.evenements[0];
                const b = document.querySelector('#zone-partition').getBoundingClientRect();
                return { x: b.left + a.x, y: b.top + a.yPortee + 10 };
            });
            await page.mouse.click(p.x, p.y, { button: 'right' });
            await page.waitForTimeout(320);
            return page.evaluate(() => [...document.querySelectorAll('.menu-contextuel button, .menu-contextuel .item-menu')]
                .map(b => b.textContent.trim()).filter(t => /voix/i.test(t)));
        };
        const entrees = await clicDroit();
        check(entrees.join(' | ') === 'Deux voix sur cette mesure | Deux voix sur tout le morceau',
            `le menu contextuel propose LES DEUX grains, « cette mesure » et « tout le morceau » `
            + `(« ${entrees.join(' | ')} ») — et c'est le SEUL chemin sur un écran étroit, où la `
            + 'palette ne peut pas porter les boutons sans déborder');
        await page.evaluate(() => [...document.querySelectorAll('.menu-contextuel button, .menu-contextuel .item-menu')]
            .find(x => /Deux voix sur tout/.test(x.textContent))?.click());
        await page.waitForTimeout(500);
        const partout = await etat();
        check(partout.voixParMesure.every(n => n === 2),
            `toutes les mesures passent à deux voix (${partout.voixParMesure.join(', ')})`);

        // UNE SEULE ENTRÉE D'HISTORIQUE POUR TOUT : l'annulation ramène le morceau entier d'un coup.
        // Une centaine d'entrées pour un seul geste rendrait Ctrl+Z inutilisable là où on en a le
        // plus besoin.
        await page.evaluate(() => { window.app.editeur.annuler(); });
        await page.waitForTimeout(350);
        check((await etat()).voixParMesure.every(n => n === 1),
            `un seul Ctrl+Z ramène TOUT le morceau à une voix (${(await etat()).voixParMesure.join(', ')})`);

        // ET UN GESTE QUI NE CHANGE RIEN NE LAISSE PAS D'ENTRÉE : sans quoi Ctrl+Z « ne fait rien »
        // une fois de plus à chaque clic inutile.
        const sansEffet = await page.evaluate(() => {
            const ed = window.app.editeur;
            const avant = ed.passe.length;
            const n = ed.deuxVoixPartout(false);   // déjà à une voix partout
            const apres = ed.passe.length;
            return { n, avant, apres };
        });
        check(sansEffet.n === 0 && sansEffet.avant === sansEffet.apres,
            `retirer une voix qui n'existe pas ne touche à rien (${sansEffet.n} mesure(s)) et ne pousse `
            + `aucune entrée d'historique (${sansEffet.avant} → ${sansEffet.apres})`);

        // =====================================================================================
        // 4. LA GRAVURE — ce que le moteur savait déjà faire, mesuré pour de bon
        // Le motif de « Jeux interdits » : un arpège de croches à l'aigu, une basse tenue en blanche.
        // =====================================================================================
        const gravure = await page.evaluate(async () => {
            const S = await import('/src/model/score.js');
            const L = await import('/src/engine/layout.js');
            const ev = (v, notes) => S.creerEvenement({ valeur: v, points: 0, nolet: null },
                notes.map(([c, f]) => S.creerNote(c, f)), {});
            const sil = (v) => S.creerEvenement({ valeur: v, points: 0, nolet: null }, [], { silence: true });
            const p = S.creerPartition('guitare');
            // LES DEUX VOIX SE TAISENT EN MÊME TEMPS sur la seconde moitié de la mesure : c'est le
            // SEUL cas qui éprouve le décalage vertical des silences. Une première version donnait
            // un silence à la voix 1 seulement, et la voix 2 deux blanches — un seul glyphe était
            // donc émis, et le contrôle « à des ordonnées distinctes » n'avait rien à comparer.
            p.mesures = [S.creerMesure({ voix: [
                { evenements: [0, 3, 5, 7].map(f => ev(8, [[0, f]])).concat([sil(2)]) },
                { evenements: [ev(2, [[5, 0]]), sil(2)] },
            ] })];
            p.mesures[0].signature = { battements: 4, unite: 4 };
            const page = L.mettreEnPage(S.normaliser(p), {
                S: 10, largeurPage: 1000, yDepart: 4, mesuresParLigne: 0, avertirErreurs: false,
            });
            const prim = page.primitives;
            const sys = page.ancrages.systemes[0];
            // Les hampes : des traits VERTICAUX assez longs, dans la zone de la portée.
            const hampes = prim.filter(x => x.t === 'ligne' && Math.abs(x.x1 - x.x2) < 0.01
                && Math.abs(x.y2 - x.y1) > 12 && x.y1 < sys.yTab - 10 && x.x1 > sys.xDebut + 30);
            return {
                versLeHaut: hampes.filter(h => h.y2 < h.y1).length,
                versLeBas: hampes.filter(h => h.y2 > h.y1).length,
                // Les chiffres de case des DEUX voix, sur leurs cordes respectives.
                casesTab: prim.filter(x => x.t === 'texte' && /^\d+$/.test(x.s)).map(x => x.s).join(' '),
                // Les silences des deux voix ne doivent pas se superposer : ordonnées distinctes.
                silences: prim.filter(x => x.t === 'glyphe' && /^silence/.test(x.nom || ''))
                    .map(x => Math.round(x.y)),
                yPortee: Math.round(sys.yPortee),
            };
        });
        check(gravure.versLeHaut >= 4 && gravure.versLeBas >= 1,
            `les hampes de la voix 1 montent (${gravure.versLeHaut}) et celles de la voix 2 descendent `
            + `(${gravure.versLeBas}) — la convention de gravure pour deux voix sur une portée`);
        check(/0/.test(gravure.casesTab) && /7/.test(gravure.casesTab),
            `la tablature porte les cases des DEUX voix (${gravure.casesTab})`);
        check(gravure.silences.length >= 2 && new Set(gravure.silences).size === gravure.silences.length,
            `et les silences des deux voix sont à des ordonnées DISTINCTES `
            + `(${gravure.silences.join(', ')}) — sinon ils se superposeraient au milieu de la portée`);

        // =====================================================================================
        // 5. ON ÉCRIT BIEN DANS LA VOIX AFFICHÉE
        // =====================================================================================
        await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.placerCurseur(0, 0, 2, 0);
            ed.basculerDeuxVoix();          // ajoute la voix 2 et s'y place
            ed.saisirChiffre(7);
        });
        await page.waitForTimeout(300);
        const ecrit = await page.evaluate(() => {
            const v = window.app.editeur.partition.mesures[0].voix;
            return { voix1: v[0].voix ?? v[0].evenements.flatMap(e => e.notes.map(n => n.frette)),
                     voix2: v[1].evenements.flatMap(e => e.notes.map(n => n.frette)) };
        });
        check(ecrit.voix2.includes(7) && !(ecrit.voix1 || []).includes(7),
            `le chiffre tapé va dans la voix AFFICHÉE et nulle part ailleurs — voix 2 : `
            + `[${ecrit.voix2.join(', ')}], voix 1 : [${(ecrit.voix1 || []).join(', ')}]`);

        // =====================================================================================
        // 6. LA BASSE AUSSI, pas seulement la guitare
        // =====================================================================================
        await page.evaluate(() => { window.app.editeur.nouveau('basse'); window.app.dessiner(); });
        await page.waitForTimeout(400);
        const basse = await etat();
        check(basse.bouton.visible,
            'à la BASSE aussi l\'interrupteur est là : deux lignes indépendantes sur une basse à cinq '
            + 'cordes est une écriture ordinaire');

        // =====================================================================================
        // 7. LA PALETTE NE DÉBORDE PAS À CAUSE DE CES DEUX BOUTONS
        // Ils ajoutent 111px à la rangée du haut, qui passait de 358 à 469px de contenu pour 390 de
        // place. Ils quittent donc la palette sous 720px — et le menu contextuel prend le relais.
        // ET LE MÉCANISME DE MASQUAGE ÉTAIT CASSÉ : `.btn-outil` posait `display: inline-flex` sans
        // condition, si bien qu'un bouton `hidden` gardait sa largeur. Le défaut était antérieur et
        // ne se voyait pas, aucun bouton de la palette ne se masquant encore.
        // =====================================================================================
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(300);
        const auDoigt = await page.evaluate(() => {
            window.app.rafraichirOutils();
            const l = (s) => { const b = document.querySelector(s); return b ? Math.round(b.getBoundingClientRect().width) : -1; };
            const c = document.querySelector('.rangee-outils-ecriture .rangee-outils-contenu');
            return { deuxVoix: l('[data-action="deuxVoix"]'), bascule: l('[data-action="basculerVoix"]'),
                     deborde: Math.round(c.scrollWidth - c.clientWidth) };
        });
        check(auDoigt.deuxVoix === 0 && auDoigt.bascule === 0,
            `sous 720px les deux boutons de voix ne prennent AUCUNE largeur (${auDoigt.deuxVoix}px et `
            + `${auDoigt.bascule}px) — masqués pour de bon, et non masqués en apparence seulement`);
        check(auDoigt.deborde === 0,
            `et la rangée du haut ne déborde pas (${auDoigt.deborde}px) : c'est la contrepartie de `
            + 'leur départ vers le menu contextuel');
        await page.setViewportSize({ width: 1500, height: 950 });
        await page.waitForTimeout(300);
        const surGrandEcran = await page.evaluate(() => {
            window.app.rafraichirOutils();
            const b = document.querySelector('[data-action="deuxVoix"]');
            return Math.round(b.getBoundingClientRect().width);
        });
        check(surGrandEcran > 0,
            `et sur un grand écran l'interrupteur revient dans la palette (${surGrandEcran}px) — là où `
            + 'il y a la place, c\'est le chemin le plus découvrable');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
