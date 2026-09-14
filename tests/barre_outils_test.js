// Banc des FLÈCHES DE DÉFILEMENT de la barre d'outils — et de la molette qui défile à l'horizontale.
//
// CE QU'IL PROTÈGE. Retour direct : « les boutons de la barre d'outils dépassent à droite de l'écran
// (sur ordinateur et sur téléphone). A corriger. » La barre (#barre-outils) débordait déjà avec
// `overflow-x: auto` AVANT ce correctif — ce n'était donc pas une largeur mal calculée (voir
// coherence_largeur_test.js pour ce genre de bug, déjà réglé ailleurs) mais une pure DÉCOUVRABILITÉ :
// rien ne montrait qu'il y avait plus à voir, et une souris ordinaire ne molette que verticalement.
// Deux flèches collantes (voir ui/toolbar.js#flecheDefilement) + un relais molette verticale ->
// horizontale règlent ça :
//   • les flèches ne se montrent que s'il reste RÉELLEMENT quelque chose à atteindre de leur côté ;
//   • un clic sur une flèche fait défiler la barre dans le bon sens ;
//   • une molette verticale franche fait défiler la barre à l'horizontale (un geste déjà horizontal,
//     pavé tactile compris, reste intouché — voir la condition |deltaY| <= |deltaX| dans le code).

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('barre d\'outils : défilement');

(async () => {
    plan(13);
    // 900px ET NON LA LARGEUR PAR DÉFAUT (1320px) : la barre n'y déborde plus, et c'est voulu — deux
    // retours successifs ont replié ses neuf effets puis ses dix repères derrière un bouton chacun
    // (« on devrait encore gagner un peu de place dans la barre d'outils »), ce qui lui a rendu
    // quelque 200px. Le MÉCANISME de défilement, lui, reste nécessaire : une fenêtre d'ordinateur
    // à demi réduite, un instrument plus fourni, et il reprend son office. On l'éprouve donc à une
    // largeur où il a réellement quelque chose à faire, et on vérifie séparément, tout à la fin,
    // que la barre tient sans lui quand elle a la place — la promesse que ces replis ont créée.
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 900, height: 880 } });
    try {
        const etat = () => page.evaluate(() => {
            const hote = document.getElementById('barre-outils');
            return {
                deborde: hote.scrollWidth > hote.clientWidth + 1,
                scrollLeft: hote.scrollLeft,
                gaucheInvisible: hote.querySelector('.fleche-outils-maitresse.fleche-outils-gauche').classList.contains('invisible'),
                droiteInvisible: hote.querySelector('.fleche-outils-maitresse.fleche-outils-droite').classList.contains('invisible'),
            };
        });

        const avant = await etat();
        exiger(avant.deborde, 'à 900px, la barre déborde bien — condition du reste de ce banc');
        check(avant.gaucheInvisible === true, 'tout à gauche au départ : la flèche GAUCHE est invisible (rien à atteindre de ce côté)');
        check(avant.droiteInvisible === false, 'et la flèche DROITE, elle, se montre (il reste du contenu à droite)');

        // --- Un clic sur la flèche droite fait défiler la barre ------------------------------------
        // `.fleche-outils-maitresse`, jamais `.fleche-outils-droite` seul : depuis que .barre-outils
        // se scinde en deux rangées sur téléphone (voir ui/toolbar.js#creerRangee), CE sélecteur
        // seul désigne trois boutons (la paire maîtresse + une paire par rangée) — sur grand écran
        // (ce banc), seule la maîtresse compte, les deux autres restant `display:none`.
        await page.click('.fleche-outils-maitresse.fleche-outils-droite');
        await page.waitForTimeout(400); // scrollBy({ behavior: 'smooth' })
        const apresClic = await etat();
        check(apresClic.scrollLeft > avant.scrollLeft, 'un clic sur la flèche droite avance bien le défilement');

        // --- Aller jusqu'au bout : la flèche droite s'efface, la gauche apparaît -------------------
        await page.evaluate(() => { const h = document.getElementById('barre-outils'); h.scrollLeft = h.scrollWidth; });
        await page.waitForTimeout(100);
        const auBout = await etat();
        check(auBout.droiteInvisible === true, 'tout à droite : la flèche DROITE s\'efface (plus rien à atteindre de ce côté)');
        check(auBout.gaucheInvisible === false, 'et la flèche GAUCHE apparaît (il y a de nouveau quelque chose à atteindre en arrière)');

        // --- La flèche gauche ramène vers le début -------------------------------------------------
        // Même raison qu'au clic précédent : `.fleche-outils-gauche` seul est ambigu depuis la
        // scission en rangées (ui/toolbar.js#creerRangee).
        await page.click('.fleche-outils-maitresse.fleche-outils-gauche');
        await page.waitForTimeout(400);
        const apresGauche = await etat();
        check(apresGauche.scrollLeft < auBout.scrollLeft, 'un clic sur la flèche gauche recule bien le défilement');

        // --- Molette verticale franche -> défilement HORIZONTAL de la barre ------------------------
        await page.evaluate(() => { document.getElementById('barre-outils').scrollLeft = 0; });
        const box = await page.evaluate(() => {
            const r = document.getElementById('barre-outils').getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        await page.mouse.move(box.x, box.y);
        await page.mouse.wheel(0, 200); // deltaY franc, deltaX nul
        await page.waitForTimeout(150);
        const apresMolette = await page.evaluate(() => document.getElementById('barre-outils').scrollLeft);
        check(apresMolette > 0, 'une molette verticale franche fait défiler la barre à l\'HORIZONTALE (le relais, sans quoi une molette ordinaire n\'y ferait rien)');

        // --- ET SUR UN ÉCRAN LARGE, PLUS BESOIN D'ELLES ---------------------------------------------
        // La contrepartie du repli des effets et des repères : à une largeur d'ordinateur ordinaire,
        // toute la barre tient, et les deux flèches s'effacent. C'était une EXIGENCE de ce banc
        // jusqu'ici (« la barre déborde bien ») — devenue fausse par un progrès, elle se retourne
        // donc en garantie plutôt que de disparaître.
        await page.setViewportSize({ width: 1320, height: 880 });
        await page.waitForTimeout(300);
        const large = await etat();
        check(!large.deborde && large.gaucheInvisible && large.droiteInvisible,
            'à 1320px la barre tient tout entière, et les deux flèches s\'effacent — plus rien à faire défiler');

        // --- UNE FLÈCHE NE SE COMPTE PLUS ELLE-MÊME -------------------------------------------------
        // LE DÉFAUT. Les flèches sont `position: sticky` (voir .fleche-outils dans style.css) :
        // collées au bord visible, mais EN FLUX — chacune de visible ajoute donc ses 26px à
        // `scrollWidth`. Le test naïf « scrollWidth > clientWidth » se mesure alors lui-même, et cela
        // crée un état PIÈGE, observé en élargissant la fenêtre de 900 à 1320px : la flèche gauche
        // restait allumée sur RIEN, ses propres 26px portant le contenu à 1327px pour 1320px de
        // place, donc « ça déborde », donc on garde une flèche — un fil qui se tient par ses 7px.
        //
        // ÉPROUVÉ SUR UN CONTENEUR FABRIQUÉ, pas sur la vraie barre, et c'est le point délicat de ce
        // banc. Le piège ne se forme que dans une fenêtre de 25px de large : il faut que le contenu
        // TIENNE (sinon le débordement est réel) mais que contenu + 26px dépasse (sinon le navigateur
        // ramène le défilé à zéro de lui-même et le fil casse). Cette fenêtre dépend de la largeur du
        // contenu de la barre — qui vient précisément de changer, les titres de section ayant été
        // retirés (1301 -> 1149px). Un banc calé sur une largeur de fenêtre précise se serait donc
        // dé-réglé au prochain bouton ajouté ou retiré, et aurait cessé de protéger quoi que ce soit
        // en passant quand même. On appelle donc ajusterFleches sur un défileur dont on FIXE les
        // largeurs, avec les vraies flèches et la vraie CSS : la règle est éprouvée, pas une
        // coïncidence de mise en page.
        const piege = await page.evaluate(async () => {
            const { ajusterFleches } = await import('/src/ui/toolbar.js');
            const hote = document.createElement('div');
            hote.style.cssText = 'position:fixed;top:-400px;left:0;width:200px;display:flex;overflow-x:auto;';
            const fleche = (sens) => {
                const b = document.createElement('button');
                b.className = `fleche-outils fleche-outils-${sens}`;
                return b;
            };
            const g = fleche('gauche'), d = fleche('droite');
            const contenu = document.createElement('div');
            contenu.style.cssText = 'flex:none;width:180px;height:20px;';   // 180 < 200 : ça TIENT
            hote.append(g, contenu, d);
            document.body.appendChild(hote);
            // On met la barre dans l'état d'où vient le piège : les deux flèches montrées (ce qu'un
            // défilement au ras du bord produit), et le défilé poussé au bout.
            hote.scrollLeft = hote.scrollWidth;
            const avant = { scroll: hote.scrollWidth, client: hote.clientWidth, scrollLeft: Math.round(hote.scrollLeft) };
            ajusterFleches(hote, g, d);
            const apres = {
                scroll: hote.scrollWidth, client: hote.clientWidth, scrollLeft: Math.round(hote.scrollLeft),
                gaucheInvisible: g.classList.contains('invisible'),
                droiteInvisible: d.classList.contains('invisible'),
                largeurFleches: g.offsetWidth + d.offsetWidth,
            };
            hote.remove();
            return { avant, apres };
        });
        exiger(piege.avant.scroll > piege.avant.client && piege.avant.scrollLeft > 1,
            `l'état piège est bien reconstitué : ${piege.avant.scroll}px de contenu pour ${piege.avant.client}px de place, défilé à ${piege.avant.scrollLeft}px`);
        check(piege.apres.gaucheInvisible && piege.apres.droiteInvisible && piege.apres.scrollLeft === 0
              && piege.apres.largeurFleches === 0,
            '180px de contenu dans 200px de place : les deux flèches s\'éteignent et le défilé revient à zéro — les 26px d\'une flèche ne comptent plus comme du contenu à atteindre');

        // --- LE CHAMP TEMPO N'AMPUTE PLUS SA PROPRE VALEUR ------------------------------------------
        // Découvert en relisant la barre d'outils débarrassée de ses titres de section : « 120 »
        // s'affichait « 12 », le zéro coupé net. Les 4px manquants ne venaient pas des chiffres
        // (trois chiffres en 12px pèsent ~21px) mais du compteur que Chrome réserve à droite de tout
        // input[type="number"] — une largeur invisible, jamais déclarée dans la feuille de style, qui
        // prenait sa part d'un champ resserré à 54px sur un retour utilisateur antérieur (« la case
        // indiquant les BPM est légèrement trop large »).
        //
        // ICI ET PAS DANS tests/barre_haut_largeur_test.js, qui semblait sa place naturelle : ce
        // banc-là ouvre la page en tactile (hasTouch/isMobile — il mesure un téléphone), et Chromium
        // n'alloue AUCUNE place au compteur dans un contexte tactile. La vérification y passait donc
        // correctif posé comme retiré, sans rien protéger. Le défaut est un défaut de SOURIS ; il se
        // vérifie dans un banc à la souris.
        const tempo = await page.evaluate(() => {
            const i = document.getElementById('champ-tempo');
            const avant = i.value;
            const mesure = (v) => { i.value = v; return { v, contenu: i.scrollWidth, place: i.clientWidth }; };
            const r = [mesure('120'), mesure('400'), mesure('20')];
            i.value = avant;
            return r;
        });
        check(tempo.every(t => t.contenu <= t.place),
            'le champ Tempo affiche sa valeur en entier (20, 120, 400) — plus de chiffre rogné par le compteur natif ('
            + tempo.map(t => `${t.v} : ${t.contenu}/${t.place}px`).join(', ') + ')');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
