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
    plan(13);
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
                hMetro: haut('#btn-metronome'), lMetro: larg('#btn-metronome'),
                hTempo: haut('#champ-tempo'),
            };
        });

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
        check(m390.lBemol === 36 && m390.lMetro === 36,
            'et les boutons étroits (♭, ♯, métronomes) partagent une seule et même largeur de 36px');

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

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
