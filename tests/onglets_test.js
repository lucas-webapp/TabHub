// Banc des ONGLETS — plusieurs morceaux ouverts à la fois.
//
// POURQUOI (retour utilisateur) : « permets-moi de travailler sur plusieurs onglets en même temps
// (comme sur GuitarPro), cela me permettra de comparer des versions par exemple. Je pense que les
// onglets doivent être placés sous la barre d'outils. Sur téléphone, ne pas mettre cette option qui
// prend trop de place à l'écran. »
//
// CE QUE CE BANC PROTÈGE, par ordre d'importance :
//
//   1. L'ÉTANCHÉITÉ. Deux morceaux ouverts ne doivent PAS se mélanger : partition, curseur,
//      historique d'annulation et bande de boucle appartiennent chacun à son onglet. C'est le seul
//      risque qui rendrait la fonctionnalité pire qu'absente — croire qu'on compare deux versions
//      alors qu'on en édite une seule.
//   2. CE QUI RESTE COMMUN, et c'est aussi un choix : la durée de la palette (un réglage de main) et
//      le PRESSE-PAPIER de mesure (c'est précisément ce qui rend les onglets utiles — copier une
//      mesure ici, la coller là).
//   3. LE BROUILLON PORTE TOUS LES ONGLETS. Rouvrir l'application avec un seul des trois morceaux
//      serait une perte silencieuse, exactement ce que le brouillon existe pour éviter. Et il doit
//      savoir relire un brouillon d'AVANT les onglets, qui est une partition nue.
//   4. LE GARDE-FOU VISE LE BON DOCUMENT. Fermer un onglet, c'est écraser un morceau : la même
//      question que « Nouveau » ou « Ouvrir ». Elle doit porter sur l'onglet qu'on ferme, pas sur
//      celui qu'on regarde — d'où la bascule préalable, vérifiée ici.
//   5. RIEN AU DOIGT NI SUR PETIT ÉCRAN.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('onglets');

(async () => {
    plan(38);
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 1320, height: 900 } });
    try {
        const noms = () => page.evaluate(() => [...document.querySelectorAll('#barre-onglets .onglet')].map(o =>
            (o.classList.contains('actif') ? '*' : '') + o.querySelector('.onglet-nom').textContent));
        const vu = () => page.evaluate(() => {
            const ed = window.app.editeur;
            return {
                titre: ed.partition.meta.titre,
                mesures: ed.partition.mesures.length,
                curseur: ed.curseur.mesure,
                peutAnnuler: ed.peutAnnuler(),
                instrument: ed.piste ? null : ed.partition.piste.instrument,
                boucle: window.app.lecteur.boucleLecture,
                dureeCourante: ed.dureeCourante.valeur,
                presse: !!ed.presseMesures,
                actif: window.app.ongletActif,
                nOnglets: window.app.onglets.length,
            };
        });

        // =========================================================================================
        // 1. LA BARRE EXISTE, SOUS LA BARRE D'OUTILS
        // =========================================================================================
        const place = await page.evaluate(() => {
            const b = document.getElementById('barre-onglets');
            if (!b) return null;
            const outils = document.getElementById('barre-outils').getBoundingClientRect();
            const zone = document.getElementById('zone-partition').getBoundingClientRect();
            const r = b.getBoundingClientRect();
            return { visible: r.height > 0, sousLesOutils: r.top >= outils.bottom - 1, surLaZone: r.bottom <= zone.top + 1 };
        });
        exiger(!!place && place.visible, 'la barre d\'onglets est affichée sur un écran d\'ordinateur');
        check(place.sousLesOutils && place.surLaZone,
            'et elle est bien SOUS la barre d\'outils, au-dessus de la partition — là où elle a été demandée');
        check((await noms()).length === 1 && (await noms())[0] === '*Sans titre',
            'un seul onglet au départ, actif, intitulé du titre du morceau');
        check(!(await page.evaluate(() => !!document.querySelector('#barre-onglets .onglet-fermer'))),
            'PAS de croix sur l\'onglet unique : il y a toujours un morceau ouvert, comme il y a toujours une mesure');
        check(await page.evaluate(() => !!document.getElementById('btn-nouvel-onglet')),
            'et un bouton « + » pour en ouvrir un de plus');

        // =========================================================================================
        // 2. L'ÉTANCHÉITÉ — le cœur du sujet
        // =========================================================================================
        await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.definirMeta('titre', 'Version A');
            ed.ajouterMesure(true); ed.ajouterMesure(true);       // 6 mesures
            ed.appliquerDuree(2);                                  // blanche : réglage de MAIN
            ed.placerCurseur(3, 0, 0, 0); ed.saisirChiffre(9);
            ed.placerCurseur(1, 0, 0, 0); ed.copierMesures();      // presse-papier : COMMUN
            window.app.lecteur.definirBoucle(ed.partition, 1, 2);  // boucle : par onglet
        });
        await page.waitForTimeout(250);
        const a1 = await vu();
        exiger(a1.mesures === 6 && a1.titre === 'Version A' && a1.boucle && a1.presse,
            'préalable : « Version A » à six mesures, une boucle posée, une mesure au presse-papier');

        await page.click('#btn-nouvel-onglet');
        await page.waitForTimeout(350);
        const b1 = await vu();
        check(b1.nOnglets === 2 && b1.actif === 1, '« + » ouvre un second onglet et s\'y place');
        check(b1.mesures === 4 && b1.titre === 'Sans titre',
            `le nouvel onglet porte un morceau NEUF — quatre mesures, sans titre (reçu ${b1.mesures} mesures, « ${b1.titre} »)`);
        check(!b1.peutAnnuler, 'avec son PROPRE historique, vide : Ctrl+Z n\'y défait pas ce qu\'on a fait dans l\'autre');
        check(b1.boucle === null, 'et sans la boucle de l\'autre morceau, qui désignait des mesures qui n\'existent pas ici');
        // CE QUI SUIT, LUI, DOIT AVOIR SUIVI.
        check(b1.dureeCourante === 2,
            'la DURÉE choisie suit, elle : c\'est un réglage de main, pas une propriété du morceau');
        check(b1.presse, 'et le presse-papier de mesure aussi — c\'est ce qui permet de reporter une mesure d\'un onglet à l\'autre');

        // Écrire dans B ne doit RIEN changer à A.
        await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.definirMeta('titre', 'Version B');
            ed.placerCurseur(0, 0, 0, 0); ed.appliquerDuree(4); ed.saisirChiffre(3);
        });
        await page.waitForTimeout(250);
        check(JSON.stringify(await noms()) === JSON.stringify(['Version A', '*Version B']),
            `les deux intitulés suivent leur titre respectif (reçu ${JSON.stringify(await noms())})`);

        await page.click('#barre-onglets .onglet:nth-child(1) .onglet-nom');
        await page.waitForTimeout(350);
        const a2 = await vu();
        check(a2.actif === 0 && a2.titre === 'Version A', 'un clic sur le premier onglet y revient');
        check(a2.mesures === 6, `et son morceau est intact : six mesures (reçu ${a2.mesures})`);
        check(a2.boucle && a2.boucle.debut === 1 && a2.boucle.fin === 2,
            'sa bande de boucle est revenue avec lui, sur les mêmes mesures');
        check(a2.peutAnnuler, 'son historique aussi : ce qu\'on y avait fait reste annulable');
        const noteA = await page.evaluate(() => {
            const ev = window.app.editeur.partition.mesures[3].voix[0].evenements;
            return ev.some(e => e.notes.some(n => n.frette === 9));
        });
        check(noteA, 'la case 9 posée en mesure 4 de A est toujours là — rien ne s\'est mélangé');
        const pasDeB = await page.evaluate(() => {
            const ev = window.app.editeur.partition.mesures[0].voix[0].evenements;
            return !ev.some(e => e.notes.some(n => n.frette === 3));
        });
        check(pasDeB, 'et la case 3 écrite dans B n\'a PAS atterri dans A');

        // ANNULER DANS A ne doit pas toucher B : les deux piles sont séparées.
        await page.evaluate(() => { window.app.editeur.annuler(); window.app.editeur.annuler(); });
        await page.waitForTimeout(250);
        await page.click('#barre-onglets .onglet:nth-child(2) .onglet-nom');
        await page.waitForTimeout(350);
        const b2 = await vu();
        check(b2.titre === 'Version B' && b2.mesures === 4,
            'annuler deux fois dans A laisse B exactement où il était');

        // =========================================================================================
        // 3. LA LECTURE S'ARRÊTE EN CHANGEANT D'ONGLET
        // =========================================================================================
        // Le transport est programmé depuis le morceau qu'on QUITTE : le laisser courir ferait
        // entendre l'ancien pendant qu'on regarde le nouveau.
        const lecture = await page.evaluate(async () => {
            const l = window.app.lecteur;
            await l.jouer(window.app.editeur.partition, 0);
            const avant = l.etat;
            window.app.activerOnglet(0);
            await new Promise(r => setTimeout(r, 200));
            return { avant, apres: l.etat };
        });
        check(lecture.avant === 'lecture' && lecture.apres === 'arret',
            `changer d'onglet arrête la lecture (${lecture.avant} -> ${lecture.apres})`);

        // =========================================================================================
        // 4. LE BROUILLON PORTE TOUS LES ONGLETS
        // =========================================================================================
        await page.waitForTimeout(900);
        const brouillon = await page.evaluate(() => {
            const b = JSON.parse(localStorage.getItem('tabhub.brouillon'));
            return { v: b.v, actif: b.actif, titres: (b.onglets || []).map(p => p.meta.titre) };
        });
        check(brouillon.v === 2 && brouillon.titres.length === 2,
            `le brouillon porte les DEUX morceaux, pas seulement celui qu'on regarde (${JSON.stringify(brouillon.titres)})`);
        check(brouillon.actif === 0, 'et retient lequel était actif');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.app && window.app.page, null, { timeout: 20000 });
        await page.waitForTimeout(400);
        const apresRechargement = await noms();
        check(apresRechargement.length === 2 && apresRechargement[0].startsWith('*'),
            `un rechargement retrouve les deux onglets, le bon actif (${JSON.stringify(apresRechargement)})`);
        check((await vu()).mesures === 6, 'avec le contenu du morceau actif, intact');

        // UN BROUILLON D'AVANT LES ONGLETS — une partition NUE — doit se relire sans rien perdre.
        const ancien = await page.evaluate(async () => {
            const S = await import('/src/model/score.js');
            const p = S.creerPartition('guitare');
            p.meta.titre = 'Brouillon ancien format';
            localStorage.setItem('tabhub.brouillon', JSON.stringify(p));   // format v1 : la partition seule
            return true;
        });
        exiger(ancien, 'préalable : un brouillon au format d\'avant les onglets est écrit');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.app && window.app.page, null, { timeout: 20000 });
        await page.waitForTimeout(400);
        const v1 = await noms();
        check(v1.length === 1 && v1[0] === '*Brouillon ancien format',
            `un brouillon d'avant les onglets se relit en UN onglet, titre conservé (reçu ${JSON.stringify(v1)})`);

        // =========================================================================================
        // 5. FERMER — le garde-fou porte sur l'onglet qu'on ferme
        // =========================================================================================
        await page.evaluate(() => window.app.editeur.definirMeta('titre', 'Gardée'));
        await page.click('#btn-nouvel-onglet'); await page.waitForTimeout(300);
        await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.definirMeta('titre', 'À fermer');
            ed.appliquerDuree(4); ed.saisirChiffre(7);   // du travail non exporté : il y a à perdre
        });
        await page.click('#btn-nouvel-onglet'); await page.waitForTimeout(300);
        await page.evaluate(() => window.app.editeur.definirMeta('titre', 'Troisième'));
        await page.waitForTimeout(250);
        exiger((await noms()).length === 3, 'préalable : trois onglets, le troisième actif');

        // On ferme celui du MILIEU alors qu'on regarde le troisième.
        await page.click('#barre-onglets .onglet:nth-child(2) .onglet-fermer');
        await page.waitForTimeout(450);
        const garde = await page.evaluate(() => {
            const v = [...document.querySelectorAll('.voile')].find(x => !x.hidden);
            return v ? { titre: v.querySelector('h2')?.textContent || '', actif: window.app.ongletActif } : null;
        });
        exiger(!!garde, 'fermer un onglet qui porte du travail non exporté pose bien la question');
        check(/À fermer/.test(garde.titre),
            `et la question nomme l'onglet QU'ON FERME, pas celui qu'on regardait (« ${garde.titre} »)`);
        check(garde.actif === 1,
            'on a d\'ailleurs basculé dessus : on voit ce qu\'on est sur le point de perdre');
        await page.evaluate(() => [...document.querySelectorAll('.voile')].find(x => !x.hidden).querySelector('[data-choix="annuler"]').click());
        await page.waitForTimeout(350);
        check((await noms()).length === 3 && (await noms())[1].startsWith('*'),
            'Annuler ne ferme rien, et laisse l\'onglet visé sous les yeux');

        await page.click('#barre-onglets .onglet:nth-child(2) .onglet-fermer');
        await page.waitForTimeout(450);
        await page.evaluate(() => [...document.querySelectorAll('.voile')].find(x => !x.hidden).querySelector('[data-choix="sans"]').click());
        await page.waitForTimeout(400);
        const apresFermeture = await noms();
        check(apresFermeture.length === 2 && apresFermeture.join(',') === '*Gardée,Troisième',
            `« Continuer sans exporter » ferme l'onglet et retombe sur son VOISIN DE GAUCHE (reçu ${JSON.stringify(apresFermeture)})`);

        check(erreurs.length === 0, `aucune erreur de console ni exception (${erreurs.join(' | ') || 'rien'})`);
    } catch (e) {
        check(false, 'exception pendant la campagne : ' + (e && e.message));
    } finally { await fermer(); }

    // =========================================================================================
    // 6. RIEN AU DOIGT NI SUR PETIT ÉCRAN
    // =========================================================================================
    // « Sur téléphone, ne pas mettre cette option qui prend trop de place à l'écran. » DEUX
    // conditions, pas seulement la largeur : une tablette au doigt peut être large, et viser une
    // croix de 12px n'y est pas un geste de doigt.
    for (const [nom, vp, touch] of [['téléphone', { width: 390, height: 780 }, true],
                                    ['fenêtre étroite (souris)', { width: 640, height: 800 }, false]]) {
        const { page, fermer: f2 } = await ouvrirApp({ viewport: vp, hasTouch: touch, isMobile: touch });
        try {
            const h = await page.evaluate(() => {
                const b = document.getElementById('barre-onglets');
                return { hauteur: b.getBoundingClientRect().height, display: getComputedStyle(b).display,
                         // La rangée de grille doit se refermer : sinon la barre coûterait sa hauteur
                         // pour rien, exactement ce qu'on voulait éviter.
                         zoneHaut: document.getElementById('zone-partition').getBoundingClientRect().top,
                         outilsBas: document.getElementById('barre-outils').getBoundingClientRect().bottom };
            });
            check(h.display === 'none' && h.hauteur === 0,
                `sur ${nom}, la barre d'onglets n'est pas affichée du tout`);
            check(h.zoneHaut <= h.outilsBas + 1,
                `et sa rangée de grille se referme : la partition remonte contre la barre d'outils (${Math.round(h.zoneHaut - h.outilsBas)}px d'écart)`);
        } finally { await f2(); }
    }
    process.exit(bilan());
})();
