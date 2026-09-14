// Banc de la RANGÉE DU HAUT sur téléphone — elle tient dans la largeur, sans défilement.
//
// CE QU'IL PROTÈGE. Retour utilisateur : « pour la rangée du haut, joue sur la largeur des boutons,
// certains sont optimisables ». Mesuré à 390px avant correction : 411px de contenu pour 360px de
// place — la rangée débordait de 51px, soit deux boutons entiers rejetés hors champ derrière une
// flèche de défilement que rien n'oblige à remarquer.
//
// LA CAUSE tenait à une variable qui parle de HAUTEUR et servait aussi de LARGEUR : `--h-bouton`
// (44px au doigt) alimente `.btn-icone { width }` et `.btn-outil { min-width }`. En hauteur, 44px
// est la bonne cible tactile — c'est l'axe où les rangées s'empilent et où le doigt manque. En
// largeur, un bouton qui ne porte qu'un « ♭ » n'en a aucun besoin, et les 44px qu'il prend, il les
// prend à ses voisins. Les correctifs ne touchent donc QUE la largeur (voir style.css, « LA RANGÉE
// DU HAUT TIENT DANS LA LARGEUR ») — d'où la vérification, ici, que les 44px de HAUT sont intacts :
// c'est la garantie que la place a été trouvée sans rien retirer à la visée au doigt.
//
// POURQUOI MESURER PLUTÔT QUE RELIRE LA CSS. Une largeur écrite dans une règle ne dit pas si la
// rangée TIENT : le résultat dépend du contenu réel (le menu Signature se dimensionne sur « 12/8»,
// son option la plus large), de la police une fois chargée, et de la flèche de défilement — qui
// coûte 26px de la largeur même qu'elle sert à compenser. Ce banc refait donc le calcul complet, sur
// la page réelle, aux largeurs des téléphones courants.
//
// LE PIÈGE DU RACCOURCI `background`. La flèche des menus déroulants est dessinée par nous (celle du
// navigateur coûte ~20px, la nôtre 9). Elle s'écrit `background-image`, JAMAIS `background` : le
// raccourci remet à leur défaut toutes les sous-propriétés qu'il ne cite pas, et emporterait la
// couleur de fond posée par `select.champ` — le menu virerait au transparent sans que rien ne le
// signale. Le même piège avait déjà coûté une itération sur la croix flottante ; il est vérifié ici.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('rangée du haut : tient dans la largeur');

/** Les largeurs logiques des téléphones courants — du plus étroit (Android) au plus large (iPhone). */
const TELEPHONES = [360, 375, 390, 414, 430];

(async () => {
    plan(21);
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    try {
        const mesurer = () => page.evaluate(() => {
            // Une passe de rafraîchissement d'abord : c'est elle qui décide de l'état des flèches
            // (voir ui/toolbar.js#brancherFleches), et elle suit normalement chaque édition.
            window.app?.rafraichirOutils?.();
            const rangee = document.querySelector('.rangee-outils-ecriture');
            const contenu = rangee.querySelector('.rangee-outils-contenu');
            const larg = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().width) : -1; };
            const haut = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().height) : -1; };
            return {
                deborde: Math.round(contenu.scrollWidth - contenu.clientWidth),
                contenu: Math.round(contenu.scrollWidth),
                flechesCachees: [...rangee.querySelectorAll('.fleche-outils')].every(f => f.classList.contains('invisible')),
                // Chaque élément de la rangée doit être ENTIÈREMENT dans la fenêtre : « ne déborde
                // pas » au sens du conteneur ne suffirait pas si un bouton dépassait par la droite.
                tousDansLEcran: [...contenu.querySelectorAll('.groupe-outils > *')]
                    .filter(e => e.getBoundingClientRect().width > 0)
                    .every(e => { const r = e.getBoundingClientRect(); return r.left >= -1 && r.right <= window.innerWidth + 1; }),
                hBemol: haut('[data-action="transposerBas"]'), lBemol: larg('[data-action="transposerBas"]'),
                hMetro: haut('#btn-metronome'), lMetro: larg('#btn-metronome'),   // désormais dans la barre du BAS, voir plus bas
                hTempo: haut('#champ-tempo'),
            };
        });

        // LE CHAMP TEMPO ET SON COMPTEUR NATIF : pas ici, mais dans tests/barre_outils_test.js.
        // Le défaut (input[type="number"] dont le compteur natif rogne la valeur : « 120 » affiché
        // « 12 ») n'EXISTE PAS dans ce banc-ci, et c'est structurel : Chromium n'alloue aucune place
        // à ce compteur dans un contexte tactile, et ce banc est tout entier tactile
        // (hasTouch/isMobile ci-dessus, sans quoi il ne mesurerait pas un téléphone). Mesuré : 42px
        // de contenu pour 42px de place ici, correctif retiré comme posé ; 56 pour 52 à la souris.
        // Un banc ne protège que ce qu'il peut voir échouer.

        // --- 1. La rangée tient, à toutes les largeurs de téléphone ---------------------------------
        for (const largeur of TELEPHONES) {
            await page.setViewportSize({ width: largeur, height: 844 });
            await page.waitForTimeout(200);
            const m = await mesurer();
            exiger(m.deborde === 0 && m.tousDansLEcran,
                `à ${largeur}px, la rangée du haut tient dans la largeur (contenu ${m.contenu}px, débordement ${m.deborde}px)`);
        }

        // --- 2. Et les flèches de défilement s'effacent : rien n'est caché derrière ------------------
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(200);
        const m390 = await mesurer();
        check(m390.flechesCachees,
            'les deux flèches de défilement s\'effacent d\'elles-mêmes, n\'ayant plus rien à faire défiler');

        // --- 3. La cible tactile est INTACTE : on n'a pris que de la largeur ------------------------
        check(m390.hBemol === 44 && m390.hMetro === 44 && m390.hTempo === 44,
            'les 44px de HAUT sont intacts partout — c\'est l\'axe où le doigt manque sa cible, jamais celui où l\'on rogne');
        // LE MÉTRONOME A QUITTÉ CETTE RANGÉE : il est reparti dans la barre du bas, réuni avec
        // Lecture/Stop et le Tempo dans le bloc de lecture (voir #bloc-lecture dans index.html). Il y
        // mesure 44px — la cible tactile pleine, puisque la place n'y manque plus — et ce banc, qui
        // ne parle que de la RANGÉE DU HAUT, n'a plus à en juger. Restent ♭ et ♯, les deux seuls
        // boutons étroits de cette rangée, dont la largeur commune reste ce qu'elle protège.
        check(m390.lBemol === 36,
            `et les boutons étroits de cette rangée (♭, ♯) tiennent leur largeur resserrée de 36px (${m390.lBemol})`);

        // --- 4. Le fond des menus déroulants survit à la flèche dessinée ----------------------------
        const menu = await page.evaluate(() => {
            const s = getComputedStyle(document.querySelector('[data-groupe="ecriture"] select.champ'));
            const transparent = (c) => c === 'transparent' || /rgba\(0,\s*0,\s*0,\s*0\)/.test(c);
            return { apparence: s.appearance, aUneFleche: s.backgroundImage.startsWith('url('), fondPlein: !transparent(s.backgroundColor) };
        });
        check(menu.aUneFleche && menu.fondPlein,
            'le menu déroulant garde son fond plein SOUS sa flèche dessinée (background-image, jamais le raccourci background)');
        check(menu.apparence === 'none', 'et c\'est bien notre flèche, pas celle du navigateur (~20px de large)');

        // --- 5. Sur grand écran, RIEN de tout cela ne s'applique -------------------------------------
        // Les règles vivent dans @media (max-width: 720px) : au-delà, le menu reprend l'apparence
        // native du système, où la place ne manque pas. Un banc qui n'éprouverait que le téléphone
        // laisserait passer une règle échappée de son media query.
        await page.setViewportSize({ width: 1320, height: 880 });
        await page.waitForTimeout(200);
        const bureau = await page.evaluate(() => {
            const s = getComputedStyle(document.querySelector('[data-groupe="ecriture"] select.champ'));
            const b = document.querySelector('[data-action="transposerBas"]').getBoundingClientRect();
            return { apparence: s.appearance, image: s.backgroundImage, largBemol: Math.round(b.width) };
        });
        check(bureau.apparence !== 'none' && bureau.image === 'none',
            'sur grand écran, le menu déroulant retrouve la flèche NATIVE du système');
        check(bureau.largBemol >= 34, 'et le bouton ♭ y garde une largeur confortable');

        // --- 6. LA BARRE EST CALÉE À GAUCHE, sur ordinateur aussi -----------------------------------
        // Retour utilisateur, capture à l'appui : « la barre d'outils n'est toujours pas calée sur la
        // gauche, il y a un vide sous la flèche undo ». Ce vide n'était pas une marge : c'était la
        // flèche de défilement MAÎTRESSE, masquée par `opacity: 0` mais toujours large de 26px, qui
        // repoussait le premier groupe. La réduction à zéro n'existait que dans le bloc téléphone, pour
        // les flèches de RANGÉE — corrigée depuis à la source (voir style.css, .fleche-outils.invisible).
        //
        // Éprouvé par la POSITION du premier groupe comparée à celle du premier bouton de la barre du
        // haut, et non par la largeur de la flèche : c'est l'alignement des deux barres qui se voit à
        // l'écran, et lui seul que le retour décrit.
        await page.setViewportSize({ width: 1320, height: 880 });
        await page.waitForTimeout(250);
        const cale = await page.evaluate(() => {
            const g = document.querySelector('.barre-outils .groupe-outils');
            const undo = document.getElementById('btn-annuler');
            const fl = document.querySelector('.fleche-outils-maitresse');
            return {
                xGroupe: Math.round(g.getBoundingClientRect().x),
                xUndo: Math.round(undo.getBoundingClientRect().x),
                flecheCachee: fl.classList.contains('invisible'),
                largeurFleche: Math.round(fl.getBoundingClientRect().width),
            };
        });
        exiger(cale.flecheCachee && cale.largeurFleche === 0,
            'la flèche de défilement masquée n\'occupe plus aucune largeur (elle en prenait 26)');
        check(Math.abs(cale.xGroupe - cale.xUndo) <= 6,
            `le premier groupe d'outils s'aligne sur le bouton Annuler de la barre du haut (${cale.xGroupe}px contre ${cale.xUndo}px)`);

        // --- 7. LES NEUF EFFETS SONT REPLIÉS, sur ordinateur aussi ----------------------------------
        // Retour utilisateur : « pour gagner de la place lorsque j'ai la barre d'outils en haut :
        // rassembler tous les effets dans un bouton ». Le repli existait, enfermé dans le bloc
        // téléphone : l'ordinateur gardait neuf boutons en ligne dans une barre qui débordait aussi.
        const effets = await page.evaluate(() => {
            const b = document.querySelector('.btn-effets-bascule');
            const g = document.querySelector('.groupe-outils[data-groupe="effet"]');
            return { bouton: b.getBoundingClientRect().width > 0, groupe: g.getBoundingClientRect().width > 0 };
        });
        exiger(effets.bouton && !effets.groupe,
            'sur ordinateur, un seul bouton « Effets » remplace les neuf boutons de geste');
        await page.click('.btn-effets-bascule');
        await page.waitForTimeout(250);
        const deplie = await page.evaluate(() => {
            const g = document.querySelector('.groupe-outils[data-groupe="effet"]');
            const r = g.getBoundingClientRect();
            return { ouvert: g.classList.contains('ouvert'), visible: r.width > 0 && r.height > 0,
                     nb: g.querySelectorAll('.btn-outil').length,
                     dansLEcran: r.left >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1 };
        });
        check(deplie.ouvert && deplie.visible && deplie.nb === 9,
            'un clic les déplie tous les neuf dans un popover');
        check(deplie.dansLEcran, 'et ce popover tient entièrement dans la fenêtre, jamais à cheval sur un bord');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);

        // --- 6. UN CADRE PLUTÔT QU'UN TITRE ---------------------------------------------------------
        // Retour utilisateur : « au lieu d'indiquer chaque section de la barre d'outil (par exemple
        // "Durée", "Mesure" etc…), ce qui prend de la place, peux-tu entourer séparément chaque
        // section avec un trait plus visible ? Je comprendrai de moi-même de quoi il s'agit ».
        // Les deux disaient la même chose ; seul le titre la faisait payer, dans la seule barre de
        // l'application qui manque de place. On mesure donc les deux moitiés de l'échange : plus un
        // titre visible, et un cadre qui se détache VRAIMENT du fond.
        await page.setViewportSize({ width: 1320, height: 880 });
        await page.waitForTimeout(250);
        const cadres = await page.evaluate(() => {
            const lum = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number); return .2126 * r + .7152 * g + .0722 * b; };
            const groupes = [...document.querySelectorAll('#barre-outils .groupe-outils')];
            const vus = groupes.filter(g => g.getBoundingClientRect().width > 0);
            return {
                titresVisibles: [...document.querySelectorAll('#barre-outils .etiquette-groupe')]
                    .filter(e => e.getBoundingClientRect().width > 0).map(e => e.textContent),
                // Le nom reste lisible POUR QUI N'Y VOIT RIEN : un cadre CSS ne s'annonce pas.
                nommes: vus.every(g => g.getAttribute('role') === 'group' && !!g.getAttribute('aria-label')),
                // Le contraste du cadre contre l'intérieur du groupe, avant/après en clair :
                // #333 sur #161616 donnait 29 de luminance contre 22, soit 7 points — invisible.
                ecart: vus.map(g => {
                    const cs = getComputedStyle(g);
                    return Math.round(lum(cs.borderTopColor) - lum(cs.backgroundColor));
                }),
                contenu: document.getElementById('barre-outils').scrollWidth,
            };
        });
        check(cadres.titresVisibles.length === 0,
            'plus aucun titre de section affiché dans la barre d\'outils — le cadre le dit à leur place');
        check(cadres.nommes,
            'mais chaque groupe garde son nom pour un lecteur d\'écran (role="group" + aria-label) : un cadre ne s\'entend pas');
        check(cadres.ecart.length >= 3 && cadres.ecart.every(e => e >= 30),
            `et ce cadre se détache franchement de l'intérieur du groupe (+${Math.min(...cadres.ecart)} de luminance, contre +7 pour l'ancien #333)`);

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
