// Banc de la NOTE FANTÔME — une écriture, pas un effet.
//
// CE QU'IL PROTÈGE. Retour utilisateur : « peux-tu insérer les ghost notes directement dans le pavé
// tactile d'ajout de notes ? Je vais souvent l'utiliser, ça n'est pas juste un effet ». Le rendu lui
// donne raison : une note fantôme s'écrit « x » À LA PLACE du chiffre de case (voir engine/layout.js,
// `note.ghost ? 'x' : String(note.frette)`) — ce n'est pas une décoration posée sur une case, c'est
// ce qu'on écrit AU LIEU d'une case.
//
// LE DÉFAUT QUE CE BANC FIGE. `basculerGhost` ne savait que BASCULER : sur une case vide — le cas de
// très loin le plus fréquent quand on écrit au fil de l'eau — elle renvoyait `false` et ne faisait
// RIEN, pas même un message. Le bouton de la palette et la touche X étaient donc inertes tant qu'une
// note n'était pas déjà posée, ce qui condamnait la note fantôme à un geste en deux temps (poser une
// case, puis la barrer) pour un signe qui, sur le papier, s'écrit d'un seul.
//
// Éprouvé par le PAVÉ TACTILE (le geste demandé) plutôt que par l'éditeur seul : c'est le chemin
// complet — bouton, action partagée avec la palette et le clavier, commande, rendu — qui doit tenir.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('note fantôme : une écriture, pas un effet');

(async () => {
    plan(12);
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    try {
        const boutonFantome = () => page.evaluateHandle(() =>
            [...document.querySelectorAll('.rangee-gestes .btn-pave')].find(b => /Fantôme/.test(b.textContent)));
        const etatNote = () => page.evaluate(() => {
            const ed = window.app.editeur;
            const n = ed.evenementCourant().notes.find(x => x.corde === ed.curseur.corde);
            const b = [...document.querySelectorAll('.rangee-gestes .btn-pave')].find(x => /Fantôme/.test(x.textContent));
            return {
                note: n ? { frette: n.frette, ghost: !!n.ghost } : null,
                actif: b ? b.classList.contains('actif') : null,
                // Ce que la TABLATURE affiche réellement à cet endroit : le « x » gravé, ou le chiffre.
                gravé: [...document.querySelectorAll('#feuille text')].map(t => t.textContent),
            };
        });

        // --- 1. Le bouton existe, dans le pavé de SAISIE et non derrière le popover « Effets » -------
        const b = await boutonFantome();
        exiger(await b.evaluate(e => !!e), 'le pavé tactile porte un bouton de note fantôme, à côté d\'Effacer et Insérer');
        check(await b.evaluate(e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height >= 44),
            'à sa taille de cible tactile, comme ses voisins');

        // --- 2. SUR UNE CASE VIDE, il ÉCRIT — le cœur du retour utilisateur -------------------------
        const avant = await etatNote();
        exiger(avant.note === null, 'au départ, aucune note sous le curseur (case vide)');
        await b.evaluate(e => e.click());
        await page.waitForTimeout(200);
        const apres = await etatNote();
        exiger(apres.note !== null && apres.note.ghost === true,
            'un appui sur une case VIDE écrit une note fantôme (avant : rien ne se passait du tout)');
        check(apres.gravé.includes('x') && !apres.gravé.includes('0'),
            'et la tablature grave un « x », jamais le chiffre de la case qui lui sert de support');
        check(apres.actif === true, 'le bouton s\'allume : on voit que la note sous le curseur EST fantôme');

        // --- 3. Un second appui la retire : c'est bien une bascule, pas un empilement -----------------
        await b.evaluate(e => e.click());
        await page.waitForTimeout(200);
        const retire = await etatNote();
        check(retire.note !== null && retire.note.ghost === false, 'un second appui retire le fantôme');
        check(retire.actif === false, 'et le bouton s\'éteint avec lui');

        // --- 4. Taper une CASE sur un fantôme le change en note ordinaire ---------------------------
        // Trouvé en écrivant ce banc : la tablature grave « x » À LA PLACE du chiffre, si bien qu'une
        // case tapée sur une note fantôme s'écrivait dans le modèle sans RIEN changer à l'écran — le
        // 5 était là, et invisible. Donner une case, c'est donner une hauteur déterminée : l'exact
        // contraire d'un fantôme. (Le « 0 » qui sert de support au fantôme ne s'enchaîne pas non plus
        // avec le chiffre suivant — voir poserGhost, qui remet `_dernierChiffre` à zéro.)
        await page.evaluate(() => { window.app.editeur.nouveau('guitare'); });
        await page.waitForTimeout(200);
        await b.evaluate(e => e.click());
        await page.waitForTimeout(120);
        await page.evaluate(() => window.app.editeur.saisirChiffre(5));
        await page.waitForTimeout(200);
        const enchaine = await etatNote();
        check(enchaine.note !== null && enchaine.note.frette === 5 && !enchaine.note.ghost
            && enchaine.gravé.includes('5') && !enchaine.gravé.includes('x'),
            'taper une case sur un fantôme le change en note ordinaire — le chiffre s\'affiche, le « x » s\'en va');

        // --- 5. AU PIANO, un refus expliqué plutôt qu'un silence -------------------------------------
        // Il n'y a là ni corde ni case (voir model/instruments.js) : la commande passe par
        // saisirChiffre, qui sait déjà le dire. Un bouton qui ne fait rien sans expliquer pourquoi
        // est le défaut même que ce banc corrige — il ne doit pas revenir par la porte du piano.
        const piano = await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.nouveau('piano');
            ed.derniereErreur = null;
            const ok = ed.poserGhost();
            return { ok, erreur: ed.derniereErreur, notes: ed.evenementCourant().notes.length };
        });
        check(piano.ok === false, 'au piano, poser un fantôme est refusé');
        check(!!piano.erreur && piano.notes === 0, 'avec un message qui dit pourquoi, et sans rien écrire');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
