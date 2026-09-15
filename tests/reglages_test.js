// Banc du LOT D'OPTIMISATION DES RÉGLAGES (retour utilisateur, plusieurs points à la fois) :
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
//
// Ce banc tourne SANS tactile (voir _page.js#ouvrirApp) : le point 3 n'y est donc éprouvé que côté
// « masqué sur ordinateur » — son pendant tactile vit dans tactile_test.js, aux côtés du reste de la
// saisie au doigt, plutôt que dupliqué ici.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('réglages');

(async () => {
    plan(40);
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

        // --- 3 bis. LES NOTES SEULES, sans le nom de l'accordage -------------------------------------
        // Retour utilisateur : « les indications d'accordage : standard, drop D etc… je le sais en
        // lisant les notes ». « Drop D — D A D G » disait effectivement deux fois la même chose à qui
        // lit la seconde moitié, en occupant la largeur d'un menu déroulant sur un écran de téléphone.
        const optionsAccordage = await page.evaluate(() =>
            [...document.querySelectorAll('#champ-accordage option')].map(o => o.textContent));
        check(optionsAccordage.every(o => !/Standard|Drop|Open|DADGAD|High C|Personnalisé|—/.test(o)),
            'les accordages ne s\'annoncent plus que par leurs notes, sans nom ni tiret');
        check(new Set(optionsAccordage).size === optionsAccordage.length,
            'et restent tous distinguables les uns des autres sans ce nom (aucun doublon de notes)');

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

        // --- 6. Le brouillon local ne se pilote pas : il se fait tout seul ---------------------------
        // La rubrique « Brouillon local » (statut + « Vider le brouillon local ») a été RETIRÉE des
        // Réglages — HarmoHub n'expose rien de tel, et un réglage dont le seul pouvoir est de défaire
        // la sauvegarde automatique se paie en attention sans rien apporter. Ce qui compte désormais :
        // que la sauvegarde marche toujours SANS la moindre commande, et que la rubrique ne laisse
        // derrière elle ni balise orpheline ni code qui la cherche (un demi-retrait planterait
        // remplirReglages sur un getElementById nul, panneau vide à la clé).
        await page.evaluate(() => localStorage.removeItem('tabhub.brouillon'));
        await page.evaluate(() => window.app.editeur.definirMeta('sousTitre', 'Sonde réglages'));
        await page.waitForTimeout(900);   // débit de planifierBrouillon : 700 ms
        check((await page.evaluate(() => localStorage.getItem('tabhub.brouillon'))) !== null,
            'le brouillon local s\'écrit toujours tout seul après une modification, sans aucun réglage pour le demander');

        await page.click('[data-fermer]');
        await page.waitForTimeout(100);
        await page.click('#btn-reglages');
        await page.waitForTimeout(150);
        // UNE INDICATION, TOUJOURS AUCUNE COMMANDE. Ce banc exigeait auparavant que les Réglages ne
        // parlent PLUS DU TOUT du brouillon — statut compris. La moitié de cette exigence tenait, et
        // l'autre a été révisée : l'absence de tout message laissait sans réponse « mon travail est-il
        // gardé quelque part ? », et un panneau de réglages est l'endroit où l'on va la poser. Ce qui
        // reste interdit, et c'est là tout l'enjeu, c'est le RÉGLAGE : un interrupteur dont le seul
        // pouvoir serait d'empêcher l'appli de sauvegarder pour vous se paierait en attention à
        // chaque ouverture du panneau, sans jamais rien apporter à qui écrit de la musique.
        const brouillon = await page.evaluate(() => {
            const etat = document.getElementById('etat-brouillon');
            const fenetre = document.getElementById('fenetre-reglages');
            return {
                statut: etat ? etat.textContent : null,
                // Rien de cliquable NI de saisissable sur cette ligne : ni bouton, ni interrupteur,
                // ni champ — c'est ce qui distingue une indication d'un réglage.
                commandes: etat ? etat.closest('.ligne-champ').querySelectorAll('button, input, select').length : -1,
                vider: !!document.getElementById('btn-vider-brouillon'),
                // Le mot « brouillon » lui-même n'apparaît pas : « Enregistrement automatique » dit ce
                // que ça FAIT, là où « brouillon local » nommait une mécanique interne.
                motBrouillon: /brouillon/i.test(fenetre.textContent),
            };
        });
        check(brouillon.statut && /activé/.test(brouillon.statut) && brouillon.commandes === 0
              && !brouillon.vider && !brouillon.motBrouillon,
            `les Réglages DISENT que l'enregistrement automatique tourne (« ${brouillon.statut} ») sans offrir de le piloter : aucune commande sur la ligne, aucun bouton « vider », et pas le mot « brouillon »`);

        await page.click('[data-fermer]');
        await page.waitForTimeout(100);

        // --- 7. « MORCEAU » A QUITTÉ LES RÉGLAGES : un seul chemin pour nommer le morceau ----------
        // Retour utilisateur, après audit : titre, sous-titre et artiste y faisaient DOUBLON avec
        // l'éditeur d'en-tête de la partition — ce que l'utilisateur avait lui-même demandé
        // (« permets-moi de modifier titre / sous-titre / artiste au niveau du titre au-dessus de la
        // portée directement »). Ce banc protège les deux moitiés du ménage : la rubrique est partie,
        // ET le chemin qui reste fonctionne à la largeur d'un téléphone.
        //
        // UN COMMENTAIRE D'ÉPOQUE DÉFENDAIT LE DOUBLON, et c'est pourquoi la vérification suivante
        // existe : le champ des Réglages était, disait-il, « le SEUL moyen de nommer son morceau » sur
        // téléphone, celui de la barre du haut y étant masqué faute de place. La raison a disparu deux
        // fois — ce champ de la barre du haut a été retiré depuis (voir le point 8), et l'éditeur
        // d'en-tête répond au doigt. On le MESURE plutôt que de le supposer.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(150);
        await page.click('#btn-reglages');
        await page.waitForTimeout(250);
        const rubriques = await page.evaluate(() =>
            [...document.querySelectorAll('#fenetre-reglages h3')].map(h => h.textContent));
        check(!rubriques.includes('Morceau'),
            `les Réglages ne portent plus de rubrique « Morceau » (${rubriques.join(' / ')})`);
        check(await page.evaluate(() => !document.getElementById('champ-titre-morceau')
              && !document.getElementById('champ-sous-titre') && !document.getElementById('champ-artiste')),
            'et les trois champs ont bien DISPARU du document — pas seulement été masqués, ce qui aurait laissé deux vérités pour une valeur');
        await page.click('#fenetre-reglages [data-fermer]');
        await page.waitForTimeout(150);

        // LE CHEMIN QUI RESTE, à 390px : une frappe sur le titre gravé ouvre le panneau d'en-tête.
        const titreGrave = await page.evaluate(() => {
            const t = [...document.querySelectorAll('#feuille svg text')]
                .find(e => /Titre|Sans titre/.test(e.textContent || ''));
            if (!t) return null;
            const r = t.getBoundingClientRect();
            return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        });
        exiger(!!titreGrave, 'préalable : le titre est bien gravé sur la partition, donc visable');
        await page.mouse.click(titreGrave.x, titreGrave.y);
        await page.waitForTimeout(400);
        const enTete = await page.evaluate(() => {
            const pan = document.getElementById('panneau-en-tete');
            const dansEcran = (id) => {
                const e = document.getElementById(id);
                if (!e || e.offsetParent === null) return false;
                const r = e.getBoundingClientRect();
                return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
            };
            return {
                ouvert: pan ? !pan.hidden : false,
                champs: ['champ-en-tete-titre', 'champ-en-tete-sous-titre', 'champ-en-tete-artiste'].map(dansEcran),
            };
        });
        exiger(enTete.ouvert, 'toucher le titre ouvre le panneau d\'en-tête, à 390px comme ailleurs');
        check(enTete.champs.every(Boolean),
            'et ses TROIS champs sont entièrement dans l\'écran — pas à moitié sous le bord, là où on ne les atteindrait pas');
        await page.fill('#champ-en-tete-titre', 'Astérie');
        await page.fill('#champ-en-tete-sous-titre', 'arrangement, capo II');
        await page.waitForTimeout(400);
        const grave = await page.evaluate(() => ({
            meta: window.app.editeur.partition.meta,
            textes: [...document.querySelectorAll('#feuille text')].map(t => t.textContent),
        }));
        check(grave.meta.titre === 'Astérie' && grave.meta.sousTitre === 'arrangement, capo II',
            'ce qu\'on y saisit va bien dans le morceau (meta.titre et meta.sousTitre)');
        check(grave.textes.includes('Astérie') && grave.textes.includes('arrangement, capo II'),
            'et se grave sur la partition, le sous-titre libre sous le titre');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);

        // --- 7bis. ACCORDAGE ET CAPODASTRE : SANS OBJET AU PIANO ----------------------------------
        // Un clavier n'a ni corde à accorder ni case où poser un capodastre. La règle existait déjà
        // pour « TAB seule » et le pavé tactile ; ces deux lignes-ci y avaient échappé — trouvé en
        // mesurant ce que les Réglages montrent VRAIMENT quand l'instrument est un piano.
        await page.setViewportSize({ width: 1320, height: 880 });
        await page.waitForTimeout(200);
        const lignesInstrument = async () => {
            await page.click('#btn-reglages');
            await page.waitForTimeout(250);
            const vu = await page.evaluate(() => {
                const vis = (id) => { const e = document.getElementById(id); return e ? e.offsetParent !== null : null; };
                return { accordage: vis('ligne-accordage'), avance: vis('repli-instrument-avance'), instrument: vis('champ-instrument') };
            });
            await page.click('#fenetre-reglages [data-fermer]');
            await page.waitForTimeout(150);
            return vu;
        };
        const enGuitare = await lignesInstrument();
        exiger(enGuitare.accordage === true && enGuitare.avance === true,
            'préalable : en guitare, Accordage et les options avancées sont bien là');
        await page.evaluate(() => { window.app.editeur.definirInstrument('piano'); window.app.dessiner(); });
        await page.waitForTimeout(400);
        const auPiano = await lignesInstrument();
        check(auPiano.accordage === false && auPiano.avance === false,
            'au piano, Accordage et les options avancées (capodastre, corde par corde) sont MASQUÉS — des commandes qui ne feraient jamais rien');
        check(auPiano.instrument === true,
            'mais le choix d\'instrument reste, lui : c\'est par là qu\'on revient à la guitare');
        await page.evaluate(() => { window.app.editeur.definirInstrument('guitare'); window.app.dessiner(); });
        await page.waitForTimeout(400);
        const deRetour = await lignesInstrument();
        check(deRetour.accordage === true && deRetour.avance === true,
            'et elles REVIENNENT en repassant à la guitare — masquées selon l\'instrument, pas retirées une fois pour toutes');

        // --- 8. Le titre a QUITTÉ la barre du haut, à TOUTES les largeurs ---------------------------
        // Deux retours successifs. D'abord « enlever l'écriture SAR en haut à droite de l'appli » — ce
        // « SAR » n'était pas un libellé mais le TITRE lui-même, réduit à 49px et coupé au milieu d'un
        // mot, ce qui se lit comme un sigle sans le moindre sens : le champ avait alors disparu sur
        // téléphone seulement. Puis « on risque de se perdre pour savoir comment changer le titre [...]
        // pas dans la barre d'outils » : il quitte la barre PARTOUT, et se modifie désormais sur la
        // partition elle-même (voir tests/en_tete_test.js) ou ici, dans les Réglages.
        for (const largeur of [390, 1320]) {
            await page.setViewportSize({ width: largeur, height: 880 });
            await page.waitForTimeout(200);
            const barre = await page.evaluate(() => ({
                champ: !!document.getElementById('champ-titre'),
                texte: document.querySelector('.barre-haut').innerText.replace(/\s+/g, ' ').trim(),
            }));
            exiger(barre.champ === false && !/Ast/.test(barre.texte),
                `à ${largeur}px, la barre du haut ne porte plus le titre du morceau, ni entier ni tronqué`);
        }
        // Le titre saisi au panneau d'en-tête reste bien celui du morceau, lui.
        check((await page.evaluate(() => window.app.editeur.partition.meta.titre)) === 'Astérie',
            'et le titre saisi au panneau d\'en-tête reste celui du morceau');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }

    // --- 9. L'AIDE N'A RIEN À DIRE À UN DOIGT --------------------------------------------------
    // Cette fenêtre ne contient QUE des raccourcis CLAVIER (mesuré : 46 lignes, « 0…9 Poser une
    // case », « Espace Lecture / pause »). Sur un téléphone, c'est une fenêtre qu'on ouvre, qu'on lit
    // et qu'on referme sans avoir rien pu faire.
    // UN VRAI CONTEXTE TACTILE est indispensable ici : la règle tient à `(pointer: coarse)`, pas à la
    // largeur — une fenêtre de navigateur rétrécie sur un ordinateur garde son clavier, et doit
    // garder son aide. Sans `hasTouch`, ce banc mesurerait une souris dans une petite fenêtre et
    // passerait quoi qu'il arrive.
    const doigt = await ouvrirApp({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
    try {
        const vu = await doigt.page.evaluate(() => {
            const vis = (id) => { const e = document.getElementById(id); return e ? e.offsetParent !== null : null; };
            return { aide: vis('btn-aide'), reglages: vis('btn-reglages'), fichiers: vis('btn-fichiers'),
                     grossier: matchMedia('(pointer: coarse)').matches };
        });
        exiger(vu.grossier === true, 'préalable : ce navigateur se décrit bien comme tactile');
        check(vu.aide === false, 'au doigt, le bouton Aide n\'est plus là : ses 46 lignes de raccourcis clavier n\'ont pas de clavier à commander');
        check(vu.reglages === true && vu.fichiers === true,
            'Réglages et Fichiers, eux, restent : ce sont des commandes, pas une notice');
        check(doigt.erreurs.length === 0, 'aucune erreur JavaScript au doigt' + (doigt.erreurs.length ? ' — ' + doigt.erreurs.join(' | ') : ''));
    } finally { await doigt.fermer(); }

    // ET SUR ORDINATEUR, IL RESTE : l'autre moitié de la règle, sans laquelle « masqué au doigt »
    // pourrait vouloir dire « masqué partout » sans que rien ne le dise.
    const souris = await ouvrirApp({ viewport: { width: 1320, height: 880 } });
    try {
        check(await souris.page.evaluate(() => document.getElementById('btn-aide')?.offsetParent !== null),
            'à la souris, le bouton Aide est toujours là — c\'est bien le DOIGT qui le retire, pas la largeur');
    } finally { await souris.fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
