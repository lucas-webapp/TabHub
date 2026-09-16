// Banc du ZOOM DE LA PARTITION À L'ÉCRAN — voir main.js#changerZoom et les bornes ZOOM_MIN/ZOOM_MAX.
//
// CE QU'IL PROTÈGE. Retour utilisateur : « ok pour ajouter un zoom de la partition à l'écran. À
// placer à l'endroit idéal avec des boutons loupes + et -, pas dans les paramètres. » Un curseur de
// zoom avait existé à cet endroit, puis disparu comme REDONDANT avec « mesures par ligne » ; ce banc
// éprouve précisément ce que la redondance supposée passait sous silence — les deux commandes n'agissent
// pas sur la même chose, et ce banc le MESURE plutôt que de l'affirmer :
//   • « mesures par ligne » serre la musique horizontalement, à hauteur de portée constante ;
//   • la loupe change l'échelle ENTIÈRE, donc la hauteur de la gravure.
// D'où la vérification centrale : un cran de loupe doit changer la HAUTEUR du SVG, et un changement
// de mesures par ligne ne doit pas la changer. Un zoom qui ne déplacerait qu'un nombre dans un coin
// de l'interface passerait toutes les autres vérifications de ce banc.
//
// ET LA LARGEUR DE LA BARRE DU BAS, qui est la vraie dette de cette rangée : chaque commande ajoutée
// la rapproche du débordement (mesuré et corrigé trois fois déjà). La mesure se fait FLÈCHES DÉDUITES
// — elles sont dans le flux et comptent 26px dans `scrollWidth` dès qu'elles s'allument, si bien
// qu'une barre qui déborde de 14px s'annonce comme en débordant de 40 (voir ui/toolbar.js#ajusterFleches).
// Cette garde-là vit dans decompte_test.js : c'est le décompte qui a ajouté la sixième commande de la
// rangée, donc à son banc de veiller sur la largeur. Les loupes, elles, ne coûtent rien à la barre sur
// téléphone — elles y rejoignent le popover « Affichage », ce que la section 7 ci-dessous éprouve.
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('zoom de la partition à l\'écran');

(async () => {
    plan(39);
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 1320, height: 900 } });
    try {
        const lire = () => page.evaluate(() => {
            const svg = document.querySelector('#feuille svg');
            const m = document.getElementById('btn-zoom-moins');
            const p = document.getElementById('btn-zoom-plus');
            return {
                S: window.app.interligne,
                hauteur: svg ? Math.round(parseFloat(svg.getAttribute('height'))) : null,
                // LA HAUTEUR D'UN SYSTÈME, qui est la grandeur que la loupe gouverne — à la
                // différence de la hauteur de la PAGE, qui dépend aussi du NOMBRE de systèmes, donc
                // de « mesures par ligne ». Une première version de ce banc comparait la page et
                // affirmait que le nombre de mesures par ligne ne changeait pas la hauteur : mesuré
                // faux, et c'était l'évidence même — 4 mesures sur une ligne tiennent en un système,
                // 3 par ligne en demandent deux (271px -> 483px). L'assertion mesurait une grandeur
                // que le réglage éprouvé gouverne aussi.
                hauteurSysteme: Math.round(window.app.page?.geo?.hauteurSysteme ?? 0),
                systemes: window.app.page?.ancrages?.systemes?.length ?? 0,
                moinsInerte: m.disabled, plusInerte: p.disabled,
                titre: p.title,
                mesuresParLigne: window.app.mesuresParLigne,
            };
        });
        // Cliquer SANS attendre l'activation : un bouton au butoir est désactivé, et Playwright
        // attendrait 30 s qu'il s'active. On veut justement éprouver qu'il ne fait rien.
        const cliquer = (id) => page.evaluate((i) => document.getElementById(i).click(), id);

        // --- 1. LES DEUX LOUPES SONT LÀ, DANS LA BARRE DU BAS ET PAS DANS LES RÉGLAGES -------------
        const place = await page.evaluate(() => {
            const p = document.getElementById('btn-zoom-plus');
            const m = document.getElementById('btn-zoom-moins');
            return {
                existent: !!p && !!m,
                visibles: p.offsetParent !== null && m.offsetParent !== null,
                dansTransport: !!p.closest('.transport'),
                dansReglages: !!p.closest('#fenetre-reglages'),
                sousAffichage: !!p.closest('#groupe-mesures-ligne'),
                // L'ordre compte : réduire à gauche, agrandir à droite, comme partout ailleurs.
                moinsAvantPlus: m.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false,
            };
        });
        exiger(place.existent && place.visibles, 'les deux loupes existent et sont visibles sur grand écran');
        check(place.dansTransport && !place.dansReglages,
            'elles vivent dans la barre du bas, PAS dans les Réglages — c\'était la demande explicite');
        check(place.sousAffichage,
            'et sous l\'étiquette « Affichage », avec l\'autre commande de ce qu\'on voit à l\'écran (mesures par ligne)');
        check(place.moinsAvantPlus, 'réduire à gauche, agrandir à droite');

        // --- 2. UN CRAN CHANGE LA GRAVURE, pas seulement un nombre ---------------------------------
        const depart = await lire();
        exiger(depart.S > 0 && depart.hauteur > 0, `préalable : une partition est gravée (S=${depart.S}, ${depart.hauteur}px)`);
        await cliquer('btn-zoom-plus'); await page.waitForTimeout(250);
        const plus1 = await lire();
        check(plus1.S === depart.S + 1, `un clic sur + monte l'interligne d'exactement un cran (${depart.S} -> ${plus1.S})`);
        check(plus1.hauteur > depart.hauteur && plus1.hauteurSysteme > depart.hauteurSysteme,
            `et la GRAVURE grandit réellement — page ${depart.hauteur} -> ${plus1.hauteur}px, système ${depart.hauteurSysteme} -> ${plus1.hauteurSysteme}px : ce qu'un zoom qui ne bougerait qu'un nombre ne ferait pas`);
        await cliquer('btn-zoom-moins'); await cliquer('btn-zoom-moins'); await page.waitForTimeout(250);
        const moins1 = await lire();
        check(moins1.S === depart.S - 1 && moins1.hauteur < depart.hauteur,
            `− redescend symétriquement, gravure comprise (S=${moins1.S}, ${moins1.hauteur}px)`);

        // --- 3. LES DEUX COMMANDES D'AFFICHAGE SONT INDÉPENDANTES ----------------------------------
        // C'est le cœur du sujet : le zoom avait été retiré comme « redondant » avec ce réglage-ci.
        const avantCompte = await lire();
        await page.click('#groupe-mesures-ligne-boutons .btn-mesures-ligne:nth-child(3)');   // 3 mesures/ligne
        await page.waitForTimeout(300);
        const apresCompte = await lire();
        check(apresCompte.mesuresParLigne === 3, 'préalable : choisir « 3 mesures par ligne » a bien pris');
        check(apresCompte.S === avantCompte.S,
            'changer le nombre de mesures par ligne ne touche PAS au zoom (les deux réglages ne se confondent pas)');
        check(apresCompte.hauteurSysteme === avantCompte.hauteurSysteme,
            `et ne change pas la hauteur d'UN SYSTÈME (${apresCompte.hauteurSysteme}px) : il redistribue les mesures, il ne change pas l'échelle`);
        check(apresCompte.systemes > avantCompte.systemes,
            `ce qu'il change, c'est leur NOMBRE (${avantCompte.systemes} -> ${apresCompte.systemes} systèmes) — la page s'allonge donc (${avantCompte.hauteur} -> ${apresCompte.hauteur}px) sans qu'un seul signe ait changé de taille`);
        await cliquer('btn-zoom-plus'); await page.waitForTimeout(250);
        const zoomApres = await lire();
        check(zoomApres.mesuresParLigne === 3,
            'et réciproquement : zoomer ne défait pas le nombre de mesures par ligne choisi');

        // --- 4. BORNÉ AUX DEUX BOUTS, et le bouton le DIT avant d'être cliqué ----------------------
        for (let i = 0; i < 14; i++) await cliquer('btn-zoom-moins');
        await page.waitForTimeout(300);
        const bas = await lire();
        check(bas.moinsInerte === true, `arrivé au plancher (S=${bas.S}), la loupe − est DÉSACTIVÉE — pas vive et sans effet`);
        check(bas.plusInerte === false, 'et + reste disponible pour remonter');
        const sPlancher = bas.S;
        await cliquer('btn-zoom-moins'); await page.waitForTimeout(200);
        check((await lire()).S === sPlancher, 'cliquer la loupe désactivée ne change rien du tout');
        for (let i = 0; i < 24; i++) await cliquer('btn-zoom-plus');
        await page.waitForTimeout(300);
        const haut = await lire();
        check(haut.plusInerte === true && haut.moinsInerte === false,
            `au plafond (S=${haut.S}), c'est + qui est désactivée, − qui reste disponible`);
        check(haut.S > sPlancher + 3,
            `la course est utile, pas symbolique : ${sPlancher} -> ${haut.S} px d'interligne`);
        check(/\d+\s*\/\s*\d+/.test(haut.titre),
            `l'infobulle situe où l'on en est dans la course (« ${haut.titre} ») sans occuper de place à l'écran`);

        // --- 5. RETENU d'une session à l'autre, et BORNÉ à la relecture -----------------------------
        await page.evaluate(() => { window.app.interligne = 11; localStorage.setItem('tabhub.zoom', '11'); });
        await page.reload(); await page.waitForTimeout(1400);
        check((await lire()).S === 11, 'le zoom choisi est retrouvé au rechargement');
        await page.evaluate(() => localStorage.setItem('tabhub.zoom', '9999'));
        await page.reload(); await page.waitForTimeout(1400);
        const aberrant = await lire();
        check(aberrant.S <= 20 && aberrant.hauteur > 0,
            `une valeur aberrante laissée par une version antérieure est ramenée dans les bornes (9999 -> ${aberrant.S}), la partition reste gravée`);

        // --- 6. UNE PRÉFÉRENCE D'AFFICHAGE, jamais du contenu musical ------------------------------
        const exporte = await page.evaluate(() => JSON.stringify(window.app.editeur.partition));
        check(!/zoom|interligne/i.test(exporte),
            'le zoom ne voyage pas dans le morceau : rouvrir le fichier ailleurs ne doit pas imposer l\'échelle d\'un autre écran');

        // --- 7. CTRL+MOLETTE / PINCEMENT DE PAVÉ TACTILE : LA PARTITION, PAS LA PAGE --------------
        // Retour utilisateur : « lorsque je zoome avec les doigts ou sur mon ordinateur, peux-tu
        // modifier le zoom de la partition uniquement ? Actuellement toute la page zoome et dézoome ».
        // Voir main.js#brancherZoomGeste. LES DEUX GESTES ARRIVENT PAR LE MÊME ÉVÈNEMENT : un
        // pincement de pavé tactile est rendu comme un `wheel` avec `ctrlKey` — ce que ces
        // vérifications éprouvent donc d'un coup pour le portable et l'ordinateur de bureau.
        //
        // ON MESURE AUSSI `defaultPrevented`, et c'est la moitié qui compte : un écouteur qui
        // changerait l'interligne SANS empêcher le défaut laisserait le navigateur appliquer SON zoom
        // par-dessus — les deux zooms se cumuleraient, exactement le défaut signalé.
        const molette = (cible, deltaY, ctrl) => page.evaluate(([c, dy, k]) => {
            const el = document.querySelector(c);
            const avant = window.app.interligne;
            const ev = new WheelEvent('wheel', { deltaY: dy, ctrlKey: k, bubbles: true, cancelable: true });
            el.dispatchEvent(ev);
            return { avant, apres: window.app.interligne, empeche: ev.defaultPrevented };
        }, [cible, deltaY, ctrl]);

        await page.evaluate(() => window.app.changerZoom(9 - window.app.interligne));
        const ouvre = await molette('#zone-partition', -50, true);
        exiger(ouvre.apres > ouvre.avant,
            `ctrl+molette vers le haut agrandit la partition (${ouvre.avant} -> ${ouvre.apres})`);
        exiger(ouvre.empeche === true,
            'et le geste est CONFISQUÉ au navigateur — sans quoi son zoom de page s\'ajouterait au nôtre');
        const referme = await molette('#zone-partition', 50, true);
        check(referme.apres < referme.avant && referme.empeche,
            `ctrl+molette vers le bas réduit (${referme.avant} -> ${referme.apres})`);

        // LA MOLETTE ORDINAIRE RESTE DU DÉFILEMENT. Sans le `if (!e.ctrlKey) return`, lire son
        // morceau à la molette en changerait l'échelle à chaque tour — un défaut bien pire que celui
        // qu'on corrige.
        const simple = await molette('#zone-partition', 200, false);
        exiger(simple.apres === simple.avant && simple.empeche === false,
            'une molette SANS ctrl ne zoome pas et n\'est pas interceptée : elle fait défiler, comme partout');

        // HORS DE LA PARTITION, LE ZOOM DU NAVIGATEUR RESTE ENTIER — c'est la limite qui rend la
        // confiscation acceptable. Et c'est un piège mesuré : la barre d'outils a son propre
        // écouteur `wheel` (molette verticale -> défilement horizontal, ui/toolbar.js) qui avalait
        // AUSSI le ctrl+molette, empêchant le zoom du navigateur sans rien offrir à la place. Le
        // `if (e.ctrlKey) return` ajouté là-bas est ce que cette vérification garde.
        const ailleurs = await molette('#barre-outils', -200, true);
        check(ailleurs.apres === ailleurs.avant && ailleurs.empeche === false,
            'ctrl+molette sur la barre d\'outils : ni zoom de partition, ni geste confisqué — laissé au navigateur');

        // UN SEUIL CUMULÉ, sans quoi un pincement de pavé tactile (des dizaines de petits `wheel`)
        // traverserait toute l'échelle en un geste.
        const petits = await page.evaluate(() => {
            const zone = document.getElementById('zone-partition');
            const avant = window.app.interligne;
            for (let i = 0; i < 10; i++) {
                zone.dispatchEvent(new WheelEvent('wheel', { deltaY: -4, ctrlKey: true, bubbles: true, cancelable: true }));
            }
            return { avant, apres: window.app.interligne };
        });
        check(petits.apres === petits.avant,
            'dix micro-crans de pavé tactile sous le seuil ne bougent rien (sinon un pincement sauterait 10 crans)');

        // ET ÇA RESTE BORNÉ : martelée, la molette s'arrête aux mêmes butoirs que les loupes.
        const butoirs = await page.evaluate(() => {
            const zone = document.getElementById('zone-partition');
            const marteler = (dy) => { for (let i = 0; i < 40; i++) zone.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true })); };
            marteler(-50); const haut = window.app.interligne;
            marteler(50);  const bas = window.app.interligne;
            return { haut, bas };
        });
        check(butoirs.haut === 15 && butoirs.bas === 6,
            `la molette passe par changerZoom, donc par ses bornes (butoirs ${butoirs.bas} / ${butoirs.haut})`);

        // LA PAGE, ELLE, N'A PAS BOUGÉ — la vérification la plus littérale du retour utilisateur.
        const laPage = await page.evaluate(() => ({
            echelle: window.visualViewport ? window.visualViewport.scale : 1,
            corps: Math.round(document.body.getBoundingClientRect().width),
            fenetre: window.innerWidth,
        }));
        check(laPage.echelle === 1 && Math.abs(laPage.corps - laPage.fenetre) < 2,
            'après tous ces gestes la PAGE est intacte : même échelle, même largeur de corps que la fenêtre');

        // LE PORTABLE À ÉCRAN TACTILE, cas mesuré et corrigé. `touch-action: pan-x pan-y` sur la
        // partition (qui EXCLUT `pinch-zoom`) vivait dans @media (pointer: coarse) : or `pointer`
        // décrit le pointeur PRINCIPAL, qui sur un portable tactile est le pavé — donc la règle ne
        // s'appliquait pas et un pincement du DOIGT retombait sur le zoom natif de la page, le défaut
        // même qu'on corrige. On le mesure ICI, en fenêtre d'ORDINATEUR (le banc tactile, lui, tourne
        // en `pointer: coarse` où la règle s'appliquait déjà : il ne pouvait pas voir ce trou).
        const gestes = await page.evaluate(() => getComputedStyle(document.getElementById('zone-partition')).touchAction);
        exiger(/pan-x/.test(gestes) && /pan-y/.test(gestes) && !/pinch|auto|manipulation/.test(gestes),
            `même en fenêtre d'ordinateur, la partition interdit le pincement NATIF (touch-action: ${gestes})`);

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }

    // --- 8. SUR TÉLÉPHONE : les loupes sont dans le popover « Affichage », et ATTEIGNABLES ---------
    // Un second navigateur, VRAIMENT tactile (hasTouch/isMobile) : sans cela `(pointer: coarse)`
    // reste faux et l'interface répondrait en souris dans une petite fenêtre — on n'éprouverait rien.
    const tel = await ouvrirApp({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
    try {
        const avant = await tel.page.evaluate(() => ({
            loupeVisible: document.getElementById('btn-zoom-plus').offsetParent !== null,
            S: window.app.interligne,
        }));
        check(avant.loupeVisible === false,
            'replié : la loupe n\'occupe aucune place dans une barre où il n\'y en a plus (mesuré : deux loupes tactiles coûtent 88px pour 47 de reste)');
        await tel.page.tap('#btn-mesures-ligne-bascule');
        await tel.page.waitForTimeout(400);
        const ouvert = await tel.page.evaluate(() => {
            const g = document.getElementById('groupe-mesures-ligne');
            const r = document.getElementById('btn-zoom-plus').getBoundingClientRect();
            return {
                dansLePopover: g.contains(document.getElementById('btn-zoom-plus')),
                visible: document.getElementById('btn-zoom-plus').offsetParent !== null,
                dansEcran: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
                S: window.app.interligne,
            };
        });
        exiger(ouvert.visible && ouvert.dansLePopover,
            'une frappe sur « Affichage » les découvre : elles partagent le popover des mesures par ligne, là où vivent déjà les commandes de ce qu\'on voit');
        check(ouvert.dansEcran, 'et le popover les pose ENTIÈREMENT dans l\'écran, pas à moitié dehors');
        await tel.page.tap('#btn-zoom-plus'); await tel.page.waitForTimeout(350);
        const t1 = await tel.page.evaluate(() => ({
            S: window.app.interligne,
            ouvert: document.getElementById('groupe-mesures-ligne').classList.contains('ouvert'),
        }));
        check(t1.S === ouvert.S + 1, `une frappe zoome vraiment au doigt (${ouvert.S} -> ${t1.S})`);
        exiger(t1.ouvert === true,
            'et le popover RESTE OUVERT — on zoome par essais successifs, le refermer à chaque cran obligerait à le rouvrir autant de fois');
        await tel.page.tap('#btn-zoom-plus'); await tel.page.waitForTimeout(350);
        check((await tel.page.evaluate(() => window.app.interligne)) === t1.S + 1,
            'un second cran se martèle sans rien rouvrir');
        check(tel.erreurs.length === 0, 'aucune erreur JavaScript au doigt' + (tel.erreurs.length ? ' — ' + tel.erreurs.join(' | ') : ''));
    } finally { await tel.fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
