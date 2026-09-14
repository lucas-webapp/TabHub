// Banc de L'EN-TÊTE DE LA PARTITION — portée centrée, et titre modifiable là où il se lit.
//
// DEUX RETOURS UTILISATEUR, un même bloc de page.
//
// 1. « La portée doit être centrée horizontalement (attention, sur téléphone elle doit rester à
//    gauche). » La largeur des mesures est FIXÉE par leur signature (voir LARGEUR_PAR_NOIRE) et la
//    justification par étirement n'existe plus : une page plus large que sa musique laissait donc
//    tout le blanc à DROITE, portée collée à la marge gauche — la moitié droite du papier vide sur
//    la capture fournie. Ce banc mesure la symétrie du blanc, pas la présence d'une règle CSS : le
//    centrage se calcule dans le moteur (decalageDeCentrage) et dépend du contenu réel.
//
// 2. « Tout en haut dans la bande noire, je peux écrire/modifier directement le titre de la musique.
//    On risque de se perdre pour savoir comment changer le titre. Permets-moi de modifier titre /
//    sous-titre / artiste au niveau du titre au-dessus de la portée directement, pas dans la barre
//    d'outils. » Un champ de saisie sans étiquette, perdu au milieu d'une barre d'icônes, ne se
//    DONNE pas pour modifiable. Il quitte la barre ; les trois lignes gravées s'ouvrent d'un clic.
//
// LE CAS QUI FAIT TOUT LE TRAVAIL : un titre VIDE. Le bloc de titre se resserre sur ce qui existe
// (une partition sans artiste ne garde pas un blanc à sa place) — donc effacer son titre supprimerait
// le seul endroit d'où le retaper, un cul-de-sac dont on ne sortirait plus que par les Réglages,
// c'est-à-dire par le détour même que ce clic vient supprimer. D'où le fantôme « Titre », à l'écran
// SEULEMENT : ce banc vérifie les deux moitiés de cette phrase, écran ET absence au PDF.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('en-tête : portée centrée, titre modifiable');

(async () => {
    plan(21);
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 1280, height: 880 } });
    try {
        const bloc = () => page.evaluate(() => {
            const p = window.app.page;
            const sys = p.ancrages.systemes[0];
            // Le repère de tempo (« ♩ = 120 ») se pose depuis la marge gauche : il doit suivre la
            // portée, pas le bord de la page.
            const tempo = [...document.querySelectorAll('#feuille text')].find(t => /^=\s*\d+$/.test(t.textContent.trim()));
            return {
                xDebut: Math.round(sys.xDebut), xFin: Math.round(sys.xFin),
                page: Math.round(p.largeur),
                blancGauche: Math.round(sys.xDebut), blancDroite: Math.round(p.largeur - sys.xFin),
                xTempo: tempo ? Math.round(parseFloat(tempo.getAttribute('x'))) : null,
            };
        });

        // --- 1. Sur ordinateur : le bloc de musique est centré, le blanc symétrique ------------------
        const b1280 = await bloc();
        exiger(Math.abs(b1280.blancGauche - b1280.blancDroite) <= 1,
            `à 1280px, le blanc est le même des deux côtés (${b1280.blancGauche}px / ${b1280.blancDroite}px) : la portée est centrée`);
        check(b1280.blancGauche > 60, 'et il y en a vraiment, des deux côtés — la portée n\'est plus collée à la marge');
        check(b1280.xTempo !== null && b1280.xTempo > b1280.xDebut && b1280.xTempo < b1280.xDebut + 60,
            'le repère de tempo suit la portée dans son décalage, il ne reste pas au bord de la page');

        // Une fenêtre deux fois plus large : le centrage SUIT, il n'est pas une marge écrite en dur.
        await page.setViewportSize({ width: 1920, height: 880 });
        await page.waitForTimeout(250);
        const b1920 = await bloc();
        check(Math.abs(b1920.blancGauche - b1920.blancDroite) <= 1 && b1920.blancGauche > b1280.blancGauche,
            'sur une fenêtre plus large, le blanc grandit des deux côtés à la fois');
        check(b1920.xFin - b1920.xDebut === b1280.xFin - b1280.xDebut,
            'et la musique garde EXACTEMENT la même largeur : on la déplace, on ne l\'étire pas');

        // --- 2. Sur téléphone : elle reste à gauche ---------------------------------------------------
        // Éprouvé par la MEDIA QUERY (voir main.js#ecranEtroit), la même que la feuille de style.
        const { page: tel, erreurs: errTel, fermer: fermerTel } =
            await ouvrirApp({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        try {
            await tel.waitForTimeout(300);
            const bTel = await tel.evaluate(() => {
                const sys = window.app.page.ancrages.systemes[0];
                return { xDebut: Math.round(sys.xDebut), marge: Math.round(window.app.page.geo.margeGauche) };
            });
            exiger(bTel.xDebut === bTel.marge,
                'sur téléphone, la portée reste calée sur sa marge gauche — jamais centrée');
            check(errTel.length === 0, 'et sans erreur JavaScript sur ce format');
        } finally { await fermerTel(); }

        await page.setViewportSize({ width: 1280, height: 880 });
        await page.waitForTimeout(250);

        // --- 3. Le titre a QUITTÉ la barre du haut ---------------------------------------------------
        const barre = await page.evaluate(() => ({
            champ: !!document.getElementById('champ-titre'),
            texte: document.querySelector('.barre-haut').innerText.replace(/\s+/g, ' ').trim(),
        }));
        exiger(barre.champ === false, 'la barre du haut n\'a plus de champ de titre du tout');
        check(!/Sans titre/.test(barre.texte), 'et plus la moindre trace du titre du morceau dedans');

        // --- 4. Un clic sur le titre gravé ouvre les TROIS champs ------------------------------------
        await page.click('.en-tete-titre');
        await page.waitForTimeout(250);
        const ouvert = await page.evaluate(() => ({
            ouvert: !document.getElementById('panneau-en-tete').hidden,
            focus: document.activeElement?.dataset?.meta,
            champs: [...document.querySelectorAll('#panneau-en-tete [data-meta]')].map(i => i.dataset.meta),
            valeurTitre: document.getElementById('champ-en-tete-titre').value,
        }));
        exiger(ouvert.ouvert, 'un clic sur le titre gravé ouvre le panneau d\'édition, là où le titre se lit');
        check(ouvert.champs.join(',') === 'titre,sousTitre,artiste',
            'avec les TROIS champs — un sous-titre ou un artiste vide n\'a rien de gravé sur quoi cliquer');
        check(ouvert.focus === 'titre', 'le focus va au champ de la ligne touchée');
        check(ouvert.valeurTitre === 'Sans titre', 'et les champs arrivent déjà remplis depuis le morceau');

        // --- 5. Ce qu'on y tape arrive sur la partition ----------------------------------------------
        await page.fill('#champ-en-tete-titre', 'I wish');
        await page.fill('#champ-en-tete-sous-titre', 'relevé basse');
        await page.fill('#champ-en-tete-artiste', 'Stevie Wonder');
        await page.waitForTimeout(450);
        const grave = await page.evaluate(() => ({
            meta: { t: window.app.editeur.partition.meta.titre, st: window.app.editeur.partition.meta.sousTitre, a: window.app.editeur.partition.meta.artiste },
            lignes: [...document.querySelectorAll('#feuille .en-tete-champ')].map(t => t.textContent),
        }));
        exiger(grave.meta.t === 'I wish' && grave.meta.st === 'relevé basse' && grave.meta.a === 'Stevie Wonder',
            'les trois champs écrivent bien dans le morceau');
        check(grave.lignes.join(' | ') === 'I wish | relevé basse | Stevie Wonder',
            'et les trois lignes se gravent aussitôt sur la partition, dans cet ordre');

        // Cliquer une AUTRE ligne ouvre sur CETTE ligne.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await page.click('.en-tete-artiste');
        await page.waitForTimeout(250);
        check((await page.evaluate(() => document.activeElement?.dataset?.meta)) === 'artiste',
            'cliquer l\'artiste ouvre le panneau SUR l\'artiste, pas sur le titre');

        // --- 6. TITRE VIDÉ : le fantôme cliquable, seule porte de sortie du cul-de-sac ---------------
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await page.click('.en-tete-titre');
        await page.waitForTimeout(200);
        await page.fill('#champ-en-tete-titre', '');
        await page.waitForTimeout(450);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
        const fantome = await page.evaluate(() => {
            const f = document.querySelector('#feuille .en-tete-titre');
            return { texte: f?.textContent, vide: f?.classList.contains('en-tete-vide'), meta: window.app.editeur.partition.meta.titre };
        });
        exiger(fantome.texte === 'Titre' && fantome.vide === true && fantome.meta === '',
            'un titre effacé laisse un fantôme « Titre » sur la partition — le morceau, lui, n\'a plus de titre');
        await page.click('.en-tete-titre');
        await page.waitForTimeout(250);
        check((await page.evaluate(() => !document.getElementById('panneau-en-tete').hidden
            && document.activeElement?.dataset?.meta === 'titre')),
            'et ce fantôme se clique comme le vrai titre : le retaper reste à un geste');

        // --- 7. Le fantôme ne part JAMAIS au PDF -----------------------------------------------------
        // `enTeteEditable` n'est posé que par le rendu d'écran (voir main.js#dessiner) : sans lui, un
        // titre vide ne laisse aucun texte du tout, et le bloc retrouve sa hauteur exacte.
        const pdf = await page.evaluate(async () => {
            const { mettreEnPage } = await import('/src/engine/layout.js');
            const partition = JSON.parse(JSON.stringify(window.app.editeur.partition));
            partition.meta.titre = '';
            const sansOption = mettreEnPage(partition, { S: 8, largeurPage: 900 });
            const avecOption = mettreEnPage(partition, { S: 8, largeurPage: 900, enTeteEditable: true });
            const textes = (p) => p.primitives.filter(x => x.t === 'texte').map(x => x.s);
            return { pdf: textes(sansOption).includes('Titre'), ecran: textes(avecOption).includes('Titre'),
                     hauteurPdf: Math.round(sansOption.hauteur), hauteurEcran: Math.round(avecOption.hauteur) };
        });
        exiger(pdf.pdf === false && pdf.ecran === true,
            'le fantôme « Titre » n\'existe qu\'à l\'écran : le PDF d\'un morceau sans titre n\'en porte aucune trace');
        check(pdf.hauteurPdf < pdf.hauteurEcran,
            'et le bloc de titre y retrouve sa hauteur resserrée, sans la ligne que le fantôme occupait');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
