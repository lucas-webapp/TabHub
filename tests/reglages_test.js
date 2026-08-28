// Banc du LOT D'OPTIMISATION DES RÉGLAGES (retour utilisateur, cinq points à la fois) :
//   1. Accordage : capodastre et réglage corde par corde repliés sous « Options avancées »,
//      atteignables mais plus jamais devant les yeux par défaut — « ne sert que dans des cas très
//      spécifiques ».
//   2. Notation EADG (E, A, D, G, B, E) plutôt que les noms français (Mi, La, Ré…), partout où une
//      hauteur s'affiche — « plus simple à lire ».
//   3. Pavé tactile : plus de choix à trois branches (auto/toujours/jamais) qui « ne se comprend
//      pas » — la ligne entière disparaît sur un appareil non tactile (aucun réglage n'y aurait de
//      sens), et un simple interrupteur la remplace sur un appareil tactile (voir tactile_test.js
//      pour ce dernier cas, ÉPROUVÉ EN CONTEXTE TACTILE, ce que ce banc-ci ne fait pas).
//   4. Volumes (général + métronome), et une petite rubrique Fichiers — inspirés du panneau Son de
//      HarmoHub, mais à l'échelle de TabHub : un seul brouillon, jamais un gestionnaire multi-
//      fichiers.
//   5. Tap tempo : une seconde façon, plus physique, de régler le tempo — le simple champ
//      numérique ayant été jugé « pas très clair ».
//
// Ce banc tourne SANS tactile (voir _page.js#ouvrirApp) : le point 3 n'y est donc éprouvé que côté
// « masqué sur ordinateur » — son pendant tactile vit dans tactile_test.js, aux côtés du reste de la
// saisie au doigt, plutôt que dupliqué ici.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('réglages');

(async () => {
    plan(23);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        await page.click('#btn-reglages');
        await page.waitForTimeout(200);

        // --- 1. Le panneau porte un titre qui couvre CE QU'IL CONTIENT désormais (Son, Fichiers…),
        // pas seulement l'instrument d'origine. ------------------------------------------------------
        check((await page.textContent('#titre-reglages')).trim() === 'Réglages',
            'le panneau s\'appelle désormais simplement « Réglages » (il dépasse largement l\'instrument)');

        // --- 2. Options avancées : REPLIÉES par défaut, capodastre et corde par corde hors de vue ----
        const existeEtOuvert = await page.evaluate(() => {
            const d = document.querySelector('.repli-avance');
            return { existe: !!d, ouvert: d?.open };
        });
        exiger(existeEtOuvert.existe, 'le repli « Options avancées » existe dans la rubrique Instrument');
        check(existeEtOuvert.ouvert === false, 'et il est REPLIÉ par défaut, à la toute première ouverture');
        check(!(await page.locator('#champ-capo').isVisible()) && !(await page.locator('#grille-cordes').isVisible()),
            'capodastre et grille corde par corde sont donc hors de vue tant qu\'on ne l\'ouvre pas');

        // Le trait au-dessus de « Options avancées » doit vraiment se voir : `--border` (#333 sur
        // #161616) s'efface trop pour un trait qui flotte seul, sans texte ni carte tout proche
        // (retour utilisateur, capture à l'appui : « lignes vides » là où il y avait ce séparateur).
        check((await page.evaluate(() => getComputedStyle(document.querySelector('.repli-avance')).borderTopColor)) === 'rgb(74, 74, 74)',
            'et il utilise une couleur assez contrastée pour ça (pas --border, trop proche du fond)');

        await page.click('.repli-avance summary');
        await page.waitForTimeout(100);
        check((await page.locator('#champ-capo').isVisible()) && (await page.locator('#grille-cordes').isVisible()),
            'un clic sur « Options avancées » les rend atteignables, capodastre ET grille');

        // --- 3. Notation EADG : plus une seule lettre française (Do/Ré/Mi/Fa/Sol/La/Si) dans la
        // liste des accordages ni dans la grille corde par corde. ------------------------------------
        const lettresFrancaises = /\b(Do|Ré|Mi|Fa|Sol|La|Si)[♯♭𝄪𝄫]?\d?\b/;
        const texteAccordages = (await page.locator('#champ-accordage').innerHTML());
        check(!lettresFrancaises.test(texteAccordages), 'la liste des accordages n\'emploie plus les noms français (Do, Ré, Mi…)');
        check(texteAccordages.includes('E A D G B E'), 'et l\'accordage standard s\'y lit bien « E A D G B E »');
        const texteGrille = await page.locator('#grille-cordes').innerHTML();
        check(!lettresFrancaises.test(texteGrille) && /\bE2\b/.test(texteGrille), 'la grille corde par corde aussi : lettres anglo-saxonnes (E2, A2…), jamais Mi2/La2');

        // --- 4. Pavé tactile : sur CET appareil (souris, sans tactile — voir l'en-tête du banc), la
        // ligne entière est absente plutôt que d'exposer un réglage qui ne voudrait rien dire. --------
        check(await page.evaluate(() => document.getElementById('ligne-pave').hidden),
            'sur un appareil sans tactile, la ligne « Pavé tactile » ne s\'affiche même pas');

        // --- 5. Volumes : curseurs 0-100, avec lecture immédiate, persistés, et REJOUÉS après lecture --
        const volumesInitiaux = await page.evaluate(() => ({
            general: document.getElementById('champ-volume-general').value,
            metronome: document.getElementById('champ-volume-metronome').value,
            texteGeneral: document.getElementById('valeur-volume-general').textContent,
        }));
        check(volumesInitiaux.general === '100' && volumesInitiaux.metronome === '80',
            'volume général à 100, volume du métronome à 80 par défaut — comme HarmoHub');
        check(volumesInitiaux.texteGeneral === '100', 'et la valeur numérique affichée suit le curseur');

        await page.evaluate(() => {
            const el = document.getElementById('champ-volume-general');
            el.value = 30; el.dispatchEvent(new Event('input'));
        });
        await page.waitForTimeout(100);
        const apresVolume = await page.evaluate(() => ({
            lecteur: window.app.lecteur.volumeGeneral,
            texte: document.getElementById('valeur-volume-general').textContent,
            stocke: localStorage.getItem('tabhub.volumeGeneral'),
        }));
        check(apresVolume.lecteur === 30 && apresVolume.texte === '30' && apresVolume.stocke === '30',
            'glisser le volume général à 30 met à jour le lecteur, l\'affichage ET la persistance locale, ensemble');

        // Démarre réellement la lecture (voir metronome_test.js pour ce même geste) : c'est le moment
        // où Tone.Destination/le métronome existent VRAIMENT, pour vérifier que le réglage posé AVANT
        // ce premier départ (ci-dessus) a bien été rejoué, pas perdu. Referme d'abord les Réglages,
        // qui sinon interceptent le clic sur #btn-jouer (le voile couvre toute la fenêtre).
        await page.click('[data-fermer]');
        await page.waitForTimeout(100);
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [1, 2, 3, 4].map(f => m.creerEvenement({ valeur: 4 }, [m.creerNote(0, f)]));
        });
        await page.click('#btn-jouer');
        await page.waitForTimeout(300);
        const dBApresDepart = await page.evaluate(() => ({
            general: window.Tone.Destination.volume.value,
            pret: window.app.lecteur.pret,
        }));
        exiger(dBApresDepart.pret, 'le contexte audio a bien démarré');
        check(Math.abs(dBApresDepart.general - (-40 + (30 / 100) * 40)) < 0.5,
            'et Tone.Destination reflète bien le 30 % réglé AVANT ce tout premier départ (rien perdu)');
        await page.click('#btn-stop');

        // Repasse par les Réglages (déjà refermés ci-dessus avant #btn-jouer) : le curseur doit
        // encore montrer 30, pas être retombé sur le défaut — remplirReglages() lit
        // `this.lecteur.volumeGeneral`, jamais une constante.
        await page.click('#btn-reglages');
        await page.waitForTimeout(150);
        check((await page.evaluate(() => document.getElementById('champ-volume-general').value)) === '30',
            'et rouvrir les Réglages montre encore 30, pas un défaut oublié');

        // --- 6. Fichiers : statut honnête (aucun gestionnaire multi-fichiers, un seul brouillon) -----
        // `ed.nouveau('guitare')` plus haut a lui-même planifié un brouillon (débit 700 ms, voir
        // planifierBrouillon) : sans cette marge, le vider ici pourrait courir plus vite que lui et
        // le voir réapparaître juste après, comme si le vidage n'avait rien fait.
        await page.waitForTimeout(800);
        await page.evaluate(() => localStorage.removeItem('tabhub.brouillon'));
        await page.click('[data-fermer]');
        await page.waitForTimeout(100);
        await page.click('#btn-reglages');
        await page.waitForTimeout(150);
        const sansBrouillon = await page.evaluate(() => ({
            texte: document.getElementById('etat-brouillon').textContent,
            desactive: document.getElementById('btn-vider-brouillon').disabled,
        }));
        check(/aucun/i.test(sansBrouillon.texte) && sansBrouillon.desactive,
            'sans brouillon local, le statut le dit et le bouton pour le vider est désactivé (rien à vider)');

        // Un brouillon apparaît dès la première modification (voir planifierBrouillon, débit 700 ms).
        await page.evaluate(() => window.app.editeur.definirMeta('sousTitre', 'Sonde réglages'));
        await page.waitForTimeout(900);
        await page.click('[data-fermer]');
        await page.waitForTimeout(100);
        await page.click('#btn-reglages');
        await page.waitForTimeout(150);
        const avecBrouillon = await page.evaluate(() => ({
            texte: document.getElementById('etat-brouillon').textContent,
            desactive: document.getElementById('btn-vider-brouillon').disabled,
        }));
        check(!/aucun/i.test(avecBrouillon.texte) && !avecBrouillon.desactive,
            'et une fois enregistré, le statut change et le bouton « vider » redevient utilisable');

        page.once('dialog', d => d.accept());
        await page.click('#btn-vider-brouillon');
        await page.waitForTimeout(100);
        check((await page.evaluate(() => localStorage.getItem('tabhub.brouillon'))) === null,
            'le bouton « vider le brouillon » l\'efface réellement du stockage local');
        check((await page.evaluate(() => document.getElementById('btn-vider-brouillon').disabled)),
            'et redevient lui-même désactivé, sans qu\'il faille refermer/rouvrir pour le voir');

        // --- 7. TAP TEMPO : cliquer à un rythme régulier règle le tempo, sans rien taper -------------
        await page.click('[data-fermer]');
        await page.waitForTimeout(100);
        const tempoAvant = await page.evaluate(() => window.app.editeur.partition.meta.tempo);
        for (let i = 0; i < 5; i++) { await page.click('#btn-tap-tempo'); await page.waitForTimeout(400); }
        const apresTap = await page.evaluate(() => ({
            champ: parseInt(document.getElementById('champ-tempo').value, 10),
            meta: window.app.editeur.partition.meta.tempo,
        }));
        // 400 ms d'écart = 150 BPM visé ; une marge large (117-180) absorbe la latence de Playwright
        // (clic + minuterie, jamais un vrai métronome mécanique) sans rendre le banc fragile.
        check(apresTap.meta !== tempoAvant && apresTap.meta >= 117 && apresTap.meta <= 180,
            `5 taps à ~400 ms règlent bien le tempo autour de 150 BPM (obtenu : ${apresTap.meta})`);
        check(apresTap.champ === apresTap.meta, 'le champ numérique du tempo affiche la même valeur que le modèle');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
