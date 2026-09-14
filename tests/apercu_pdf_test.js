// Banc de l'APERÇU AVANT EXPORT PDF — voir #fenetre-pdf dans index.html.
//
// CE QU'IL PROTÈGE. Retour utilisateur : « pour les exports PDF : me montrer la mise en page avant
// d'enregistrer le PDF, et me permettre d'ajuster : le nombre de mesures par ligne, l'espacement
// entre les portées (pour optimiser le nombre de pages si besoin), la taille des titres, et d'autres
// paramètres que tu trouves intéressants ».
//
// LA GARANTIE CENTRALE N'EST PAS « l'aperçu s'affiche » mais « l'aperçu DIT VRAI ». Un aperçu qui
// annonce deux pages pour un fichier qui en fait trois est pire que pas d'aperçu du tout : la
// question posée est justement le nombre de pages. Ce banc compare donc, à chaque réglage, le compte
// affiché à celui que construirePdf produit RÉELLEMENT — les deux passent par io/pdf.js#preparerPdf,
// et c'est cette identité-là qu'on éprouve, pas une ressemblance.
//
// ET QUE CHAQUE LEVIER LÈVE QUELQUE CHOSE. Six réglages dont l'un ne ferait rien seraient six
// réglages qu'on n'oserait plus toucher. `mesuresParLigne` en particulier n'était pas transmis du
// tout à l'export avant cette fenêtre : le PDF découpait toujours au plus serré, quoi qu'affiche
// l'écran — ce qui rendait impossible la fiche d'exercices de deux mesures par ligne, déjà demandée.
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('aperçu avant export PDF');

(async () => {
    plan(17);
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 1320, height: 1000 } });
    try {
        // Un morceau assez long pour tenir sur plusieurs pages : sans quoi aucun réglage ne pourrait
        // faire tomber une page, et tout ce banc ne vérifierait que des libellés.
        await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.partition.meta.titre = 'Étude en la mineur';
            ed.partition.meta.sousTitre = 'exercice de legato';
            ed.partition.meta.artiste = 'Fernando Sor';
            for (let i = 0; i < 26; i++) ed.ajouterMesure(true);
            ed.prevenir('document');
        });
        await page.waitForTimeout(300);

        // --- 1. « Exporter PDF » MONTRE avant d'enregistrer ------------------------------------------
        await page.click('#btn-fichiers');
        await page.click('#popover-fichiers [data-action="pdf"]');
        await page.waitForTimeout(500);
        const ouvert = await page.evaluate(() => ({
            visible: !document.getElementById('fenetre-pdf').hidden,
            svg: !!document.querySelector('#pdf-feuille svg'),
            // Les dimensions du SVG sont celles de la FEUILLE (210 × 297 mm pour un A4), pas celles
            // du contenu : c'est ce qui fait de l'aperçu une page et non un extrait de partition.
            largeur: document.querySelector('#pdf-feuille svg')?.getAttribute('width'),
            hauteur: document.querySelector('#pdf-feuille svg')?.getAttribute('height'),
        }));
        exiger(ouvert.visible && ouvert.svg,
            'un clic sur « Exporter PDF » ouvre l\'aperçu et y dessine une feuille, au lieu de télécharger aussitôt');
        check(ouvert.largeur === '210' && ouvert.hauteur === '297',
            `la feuille est un A4 en millimètres (${ouvert.largeur} × ${ouvert.hauteur}), pas un extrait mis à l'échelle`);

        // --- 2. LE COMPTE AFFICHÉ EST CELUI DU FICHIER ----------------------------------------------
        // La vérification qui porte tout le reste. On ne compare pas deux calculs faits ici : on
        // demande à construirePdf — le vrai chemin d'export, jsPDF compris — combien de pages il
        // écrit, et on le confronte au chiffre lu à l'écran.
        const accordent = async () => page.evaluate(async () => {
            const { construirePdf } = await import('/src/io/pdf.js');
            const vrai = construirePdf(window.app.editeur.partition, window.app._optionsPdf()).nbPages;
            const affiche = parseInt(document.getElementById('pdf-compteur').textContent.split('/')[1], 10);
            const bilan = document.getElementById('pdf-bilan').textContent;
            return { vrai, affiche, bilan, concorde: vrai === affiche && bilan.startsWith(`${vrai} page`) };
        });
        const a0 = await accordent();
        exiger(a0.concorde, `le nombre de pages annoncé est celui du fichier (${a0.affiche} affiché, ${a0.vrai} écrit — « ${a0.bilan} »)`);

        // --- 3. CHAQUE LEVIER LÈVE QUELQUE CHOSE ----------------------------------------------------
        const etat = () => page.evaluate(() => ({
            pages: parseInt(document.getElementById('pdf-compteur').textContent.split('/')[1], 10),
            portees: parseInt(document.getElementById('pdf-bilan').textContent.match(/(\d+) portée/)[1], 10),
            enTete: (() => {
                const t = [...document.querySelectorAll('#pdf-feuille text')].find(x => x.textContent === 'Étude en la mineur');
                return t ? Math.round(parseFloat(t.getAttribute('font-size')) * 100) / 100 : null;
            })(),
            // LES LIGNES DESSINÉES SUR LA PAGE COURANTE : un compte qui suit le nombre de portées
            // qui y tiennent. Plus fiable ici que le nombre de PAGES, qui ne bouge que lorsqu'un
            // réglage fait franchir un seuil — l'espacement change la place prise à tout coup, mais
            // ne fait pas nécessairement tomber une page sur un morceau donné.
            lignes: document.querySelectorAll('#pdf-feuille line').length,
            // LA MARGE EST UN `translate` SUR LE GROUPE, pas un décalage reporté sur chaque
            // primitive (voir render/svg.js#rendreSvg, option `decalage`) : les `x1` des lignes ne
            // bougent donc pas d'un jeu de marges à l'autre, et les lire ne prouverait rien. Premier
            // jet de ce banc : 9 mm « serrées » comme « larges », et c'était ma mesure qui regardait
            // à côté, pas le réglage qui ne faisait rien.
            translate: (() => {
                const g = document.querySelector('#pdf-feuille svg > g[transform]');
                const m = g && g.getAttribute('transform').match(/translate\(([-\d.]+)/);
                return m ? parseFloat(m[1]) : null;
            })(),
            // Et la LARGEUR utile, qui se resserre avec les marges : deux effets indépendants du même
            // réglage, dont aucun ne se déduit de l'autre.
            largeurSysteme: (() => {
                const l = [...document.querySelectorAll('#pdf-feuille line')];
                if (!l.length) return null;
                const x2 = Math.max(...l.map(x => parseFloat(x.getAttribute('x2'))));
                const x1 = Math.min(...l.map(x => parseFloat(x.getAttribute('x1'))));
                return Math.round((x2 - x1) * 10) / 10;
            })(),
        }));
        const regler = async (id, valeur, evt = 'input') => {
            await page.evaluate(({ id, valeur, evt }) => {
                const e = document.getElementById(id);
                e.value = valeur;
                e.dispatchEvent(new Event(evt));
            }, { id, valeur, evt });
            await page.waitForTimeout(260);
            return etat();
        };
        const base = await etat();

        const petit = await regler('pdf-interligne', '1.6');
        check(petit.pages < base.pages,
            `la taille de la portée fait tomber des pages — le levier le plus fort (${base.pages} -> ${petit.pages} pages à 1,6 mm)`);
        check((await accordent()).concorde, 'et le compte reste celui du fichier après ce réglage, pas une estimation figée');
        await regler('pdf-interligne', '2.1');

        const deux = await regler('pdf-mesures-ligne', '2', 'change');
        check(deux.portees > base.portees,
            `« 2 mesures par ligne » est bien transmis à l'export (${base.portees} -> ${deux.portees} portées) — il ne l'était pas du tout avant cette fenêtre`);
        await regler('pdf-mesures-ligne', '0', 'change');

        // L'ÉCART ENTRE DEUX PORTÉES, mesuré sur la mise en page elle-même — pas sur le nombre de
        // pages ni sur le nombre de traits dessinés. Deux jets précédents s'y sont trompés, et chacun
        // a appris quelque chose : le nombre de PAGES ne bouge que si le réglage fait franchir un
        // seuil (3 pages à 1,6 comme à 6 sur ce morceau), et le nombre de TRAITS d'une page ne bouge
        // pas davantage tant que le même nombre de portées y tient (72 dans les trois cas). La
        // grandeur que ce curseur gouverne, elle, bouge toujours : la distance d'un système au
        // suivant.
        const ecartReel = async () => page.evaluate(async () => {
            const { preparerPdf } = await import('/src/io/pdf.js');
            const s = preparerPdf(window.app.editeur.partition, window.app._optionsPdf()).page.ancrages.systemes;
            return Math.round((s[1].y - s[0].y) * 10) / 10;
        });
        const eBase = await ecartReel();
        await regler('pdf-ecart', '1.6'); const eSerre = await ecartReel();
        await regler('pdf-ecart', '6');   const eLarge = await ecartReel();
        check(eSerre < eBase && eBase < eLarge,
            `l'espacement des portées éloigne vraiment les systèmes (${eSerre} mm à 1,6 · ${eBase} à 3,2 · ${eLarge} à 6)`);
        await regler('pdf-ecart', '3.2');

        const gros = await regler('pdf-titres', '1.5');
        const menu = await regler('pdf-titres', '0.6');
        check(gros.enTete > base.enTete && menu.enTete < base.enTete,
            `la taille des titres suit le réglage (${menu.enTete} / ${base.enTete} / ${gros.enTete} px de fonte)`);
        await regler('pdf-titres', '1');

        // LES MARGES DÉPLACENT LE BLOC, et c'est bien tout ce qu'on peut leur demander ici. Mon
        // premier jet attendait AUSSI des portées plus courtes — c'était oublier que la largeur d'une
        // mesure est FIXE, fonction de sa signature et jamais de son contenu (voir engine/layout.js,
        // et tests/coherence_largeur_test.js qui en fait sa garantie). Une largeur utile plus petite
        // ne raccourcit donc pas les portées : elle change le nombre de mesures qui y tiennent, et
        // seulement quand le rétrécissement franchit une largeur de mesure entière. Mesuré : 151 mm
        // de portée dans les deux cas.
        const largeurUtile = async () => page.evaluate(async () => {
            const { preparerPdf } = await import('/src/io/pdf.js');
            return Math.round(preparerPdf(window.app.editeur.partition, window.app._optionsPdf()).largeurUtile * 10) / 10;
        });
        const margesLarges = await regler('pdf-marges', 'larges', 'change');
        const uLarges = await largeurUtile();
        const margesSerrees = await regler('pdf-marges', 'serrees', 'change');
        const uSerrees = await largeurUtile();
        check(margesLarges.translate > margesSerrees.translate && uLarges < uSerrees,
            `les marges poussent le bloc sur la feuille et réduisent la largeur utile (bord ${margesSerrees.translate} -> `
            + `${margesLarges.translate} mm, utile ${uSerrees} -> ${uLarges} mm)`);
        await regler('pdf-marges', 'normales', 'change');

        const lettre = await page.evaluate(async () => {
            const s = document.getElementById('pdf-format');
            s.value = 'lettre'; s.dispatchEvent(new Event('change'));
            await new Promise(r => setTimeout(r, 250));
            const svg = document.querySelector('#pdf-feuille svg');
            return { l: svg.getAttribute('width'), h: svg.getAttribute('height') };
        });
        check(lettre.l === '215.9' && lettre.h === '279.4',
            `le format change la feuille elle-même (Lettre : ${lettre.l} × ${lettre.h} mm)`);
        await regler('pdf-format', 'a4', 'change');

        // --- 4. NAVIGATION DANS LES PAGES -----------------------------------------------------------
        const nav = await page.evaluate(async () => {
            const prec = document.getElementById('pdf-page-prec'), suiv = document.getElementById('pdf-page-suiv');
            const lu = () => document.getElementById('pdf-compteur').textContent;
            const depart = { texte: lu(), precDesactive: prec.disabled };
            suiv.click(); await new Promise(r => setTimeout(r, 200));
            const apres = { texte: lu(), precDesactive: prec.disabled };
            // Jusqu'au bout : la flèche droite doit finir par s'éteindre, sinon elle mentirait.
            for (let i = 0; i < 12 && !suiv.disabled; i++) { suiv.click(); await new Promise(r => setTimeout(r, 120)); }
            return { depart, apres, finTexte: lu(), suivDesactive: suiv.disabled };
        });
        check(nav.depart.precDesactive && nav.depart.texte.includes('Page 1')
              && nav.apres.texte.includes('Page 2') && !nav.apres.precDesactive,
            'la flèche « page suivante » avance d\'une page, et « précédente » ne s\'allume qu\'à partir de la deuxième');
        check(nav.suivDesactive && /Page (\d+) \/ \1$/.test(nav.finTexte),
            `arrivé à la dernière page, la flèche droite s'éteint — jamais un bouton qui ne mène nulle part (${nav.finTexte})`);

        // --- 5. LES RÉGLAGES SURVIVENT À LA FERMETURE -----------------------------------------------
        // Une fenêtre de mise en page dont les choix s'oublient ferait refaire six réglages à chaque
        // session, pour un morceau qui n'a pas changé de longueur entre-temps.
        await regler('pdf-mesures-ligne', '3', 'change');
        await regler('pdf-interligne', '1.8');
        await page.click('#fenetre-pdf [data-fermer]');
        await page.waitForTimeout(200);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.app && window.app.page, null, { timeout: 20000 });
        await page.waitForTimeout(300);
        await page.click('#btn-fichiers');
        await page.click('#popover-fichiers [data-action="pdf"]');
        await page.waitForTimeout(500);
        const retenus = await page.evaluate(() => ({
            mesures: document.getElementById('pdf-mesures-ligne').value,
            interligne: document.getElementById('pdf-interligne').value,
        }));
        check(retenus.mesures === '3' && Math.abs(parseFloat(retenus.interligne) - 1.8) < 1e-9,
            `les réglages sont retenus d'une session à l'autre (${retenus.mesures} mesures/ligne, ${retenus.interligne} mm)`);

        // --- 6. « VALEURS D'ORIGINE » ---------------------------------------------------------------
        await page.click('#pdf-reinit');
        await page.waitForTimeout(400);
        const neuf = await page.evaluate(() => ({
            mesures: document.getElementById('pdf-mesures-ligne').value,
            interligne: parseFloat(document.getElementById('pdf-interligne').value),
            ecart: parseFloat(document.getElementById('pdf-ecart').value),
            titres: parseFloat(document.getElementById('pdf-titres').value),
            marges: document.getElementById('pdf-marges').value,
            format: document.getElementById('pdf-format').value,
            ouverte: !document.getElementById('fenetre-pdf').hidden,
        }));
        check(neuf.mesures === '0' && neuf.interligne === 2.1 && neuf.ecart === 3.2 && neuf.titres === 1
              && neuf.marges === 'normales' && neuf.format === 'a4' && neuf.ouverte,
            '« Valeurs d\'origine » remet les six réglages tels qu\'ils étaient avant cette fenêtre, sans la refermer');

        // --- 7. L'ENREGISTREMENT --------------------------------------------------------------------
        const attente = page.waitForEvent('download');
        await page.click('#pdf-enregistrer');
        const tel = await attente;
        // « Etude », pas « Étude » : tout caractère non-ASCII dans l'attribut `download` d'un lien
        // fait retomber le navigateur sur « download » (mesuré — voir io/json.js#nomDeFichierSur).
        check(tel.suggestedFilename() === 'Etude en la mineur - Fernando Sor.pdf',
            `le fichier porte « Titre - Artiste.pdf », accents repliés en ASCII (${tel.suggestedFilename()})`);
        await page.waitForTimeout(300);
        check(await page.evaluate(() => document.getElementById('fenetre-pdf').hidden),
            'et la fenêtre se referme d\'elle-même une fois le PDF écrit');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
