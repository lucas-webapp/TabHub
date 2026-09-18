// Banc du RANGEMENT DES FICHIERS — écrire dans un dossier choisi plutôt que dans Téléchargements.
//
// CE QU'IL PROTÈGE. C'est l'étage du HAUT (voir io/fichiers.js et nommage_fichiers_test.js pour
// celui du bas). Il ne remplace jamais le nommage : il se pose dessus, là où le navigateur le
// permet — Chrome et Edge en version bureau, et nulle part ailleurs.
//
// D'OÙ LA FORME DE CE BANC : il éprouve surtout les ÉCHECS. Un rangement qui marche quand tout va
// bien mais perd le fichier quand le dossier est débranché serait pire que pas de rangement du tout,
// parce qu'on ne s'en aperçoit qu'en cherchant le fichier plus tard. Quatre cas de panne sont donc
// joués pour de vrai : dossier disparu en cours de route, navigateur sans l'API, sélecteur refusé,
// et dossier oublié.
//
// LE SÉLECTEUR SYSTÈME EST REMPLACÉ PAR UN DOSSIER OPFS de même interface — c'est la méthode de
// HarmoHub, et elle est juste : `showDirectoryPicker` ouvre une fenêtre du système d'exploitation
// qu'aucun banc ne peut piloter, mais l'origine privée du navigateur (OPFS) expose EXACTEMENT les
// mêmes objets (`getDirectoryHandle`, `getFileHandle`, `createWritable`, `entries`). Ce qui est
// éprouvé est donc le vrai code, pas une doublure.
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('rangement des fichiers');

// Pose un faux sélecteur : il rend un dossier OPFS au lieu d'ouvrir la fenêtre du système.
const POSER_OPFS = `(async (nomRacine) => {
    const opfs = await navigator.storage.getDirectory();
    try { await opfs.removeEntry(nomRacine, { recursive: true }); } catch (e) { /* pas encore là */ }
    const racine = await opfs.getDirectoryHandle(nomRacine, { create: true });
    window.__racineEssai = racine;
    window.showDirectoryPicker = async () => window.__racineEssai;
    return racine.name;
})`;

// Liste récursive du dossier d'essai, pour constater ce qui a VRAIMENT été écrit.
const LIRE_ARBRE = `(async () => {
    const parcourir = async (dossier, prefixe) => {
        const sortie = [];
        for await (const [nom, h] of dossier.entries()) {
            if (h.kind === 'directory') sortie.push(...await parcourir(h, prefixe + nom + '/'));
            else sortie.push(prefixe + nom);
        }
        return sortie;
    };
    return (await parcourir(window.__racineEssai, '')).sort();
})`;

(async () => {
    plan(22);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // ─────────── Sans dossier : le repli, et il est ANNONCÉ ───────────
        const avant = await page.evaluate(async () => {
            const f = await import('/src/io/fichiers.js');
            window.app.rafraichirDossierRangement();
            return {
                nom: f.nomRacineAffiche(),
                etat: document.getElementById('etat-dossier').textContent,
                note: document.getElementById('note-dossier').textContent,
                message: f.messageEnregistrement({ range: false, nom: 'x.json' }, 'Exporté'),
            };
        });
        check(avant.nom === '' && avant.etat === 'Téléchargements',
            `sans dossier configuré, les Réglages disent « Téléchargements » plutôt que rien (lu : « ${avant.etat} »)`);
        check(avant.note.includes('rangeront par type'),
            'et la ligne EXPLIQUE ce qu\'un dossier apporterait, au lieu de laisser un bouton nu');
        check(avant.message === 'Exporté → dossier Téléchargements',
            `la destination est annoncée par UN SEUL endroit : « → Téléchargements » écrit en dur dans chaque route deviendrait faux dès qu'un dossier existe, et une destination annoncée à tort est exactement ce qui fait perdre un fichier (lu : « ${avant.message} »)`);

        // ─────────── Choisir un dossier ───────────
        const choisi = await page.evaluate(async ({ poser }) => {
            const nom = await eval(poser)('EssaiTabHub');
            const f = await import('/src/io/fichiers.js');
            const racine = await f.choisirDossier();
            return { nom, racineNom: racine ? racine.name : null, memorise: f.nomRacineAffiche() };
        }, { poser: POSER_OPFS });
        exiger(choisi.racineNom === 'EssaiTabHub',
            `le sélecteur rend un dossier, et il est retenu (lu : ${choisi.racineNom})`);
        check(choisi.memorise === 'EssaiTabHub',
            `son NOM est doublé dans localStorage : lire IndexedDB demande un \`await\`, or un panneau de réglages se construit d'un trait et doit annoncer la destination au moment où il s'affiche (lu : « ${choisi.memorise} »)`);

        const arbre = await page.evaluate((lire) => eval(lire)(), LIRE_ARBRE);
        const dossiers = await page.evaluate(async () => {
            const racine = window.__racineEssai;
            const vus = [];
            for await (const [nom, h] of racine.entries()) if (h.kind === 'directory') vus.push(nom);
            return vus.sort();
        });
        check(dossiers.join(',') === 'MIDI,Morceaux,MusicXML,PDF',
            `L'ARBORESCENCE EST CRÉÉE TOUT DE SUITE, pas au premier export de chaque type : un dossier vide n'inspire pas confiance, et voir les quatre sous-dossiers apparaître dit ce que l'appli va faire (lu : ${dossiers.join(', ')})`);
        check(!dossiers.includes('Bibliotheque') && !dossiers.includes('Audio') && !dossiers.includes('Texte'),
            'QUATRE dossiers et non les huit de HarmoHub : TabHub n\'a ni bibliothèque, ni paroles, ni export audio, et créer le classement de ce qu\'on ne rangera jamais est exactement ce que HarmoHub a fini par retirer chez lui');
        check(arbre.length === 0, `et ils sont vides tant qu'on n'a rien exporté (lu : ${arbre.length} fichier)`);

        // ─────────── Les quatre routes écrivent au bon endroit ───────────
        const ecrits = await page.evaluate(async () => {
            const sc = await import('/src/model/score.js');
            const j = await import('/src/io/json.js');
            const midi = await import('/src/io/midi.js');
            const mx = await import('/src/io/musicxml.js');
            const p = sc.creerPartition('guitare');
            p.meta.titre = 'Étude'; p.meta.artiste = 'Dyens';
            return {
                json: await j.enregistrerPartition(p),
                midi: await midi.exporterMidi(p),
                musicxml: await mx.exporterMusicXML(p),
            };
        });
        const apres = await page.evaluate((lire) => eval(lire)(), LIRE_ARBRE);
        check(ecrits.json.range === true && ecrits.json.dossier === 'Morceaux',
            `le .json est RANGÉ, et dans « Morceaux » (lu : ${JSON.stringify({ range: ecrits.json.range, dossier: ecrits.json.dossier })})`);
        check(apres.some(x => x.startsWith('Morceaux/TabHub - Etude - Dyens - Morceau - '))
              && apres.some(x => x.startsWith('MIDI/TabHub - Etude - Dyens - MIDI - '))
              && apres.some(x => x.startsWith('MusicXML/TabHub - Etude - Dyens - MusicXML - ')),
            `chaque type dans son dossier, et LE NOM NE CHANGE PAS pour autant : c'est lui qui relie les pièces d'un même morceau, et lui seul voyage sur les téléphones qui n'ont pas cette couche (lu : ${JSON.stringify(apres)})`);
        check(ecrits.midi.range && ecrits.musicxml.range, 'le MIDI et le MusicXML aussi');

        const relu = await page.evaluate(async () => {
            const d = await window.__racineEssai.getDirectoryHandle('Morceaux');
            for await (const [nom, h] of d.entries()) {
                const texte = await (await h.getFile()).text();
                return { nom, taille: texte.length, lisible: JSON.parse(texte).format === 'tabhub-partition' };
            }
            return null;
        });
        check(relu && relu.lisible,
            `et le fichier écrit est RELISIBLE — un rangement qui écrirait des octets vides passerait toutes les vérifications de nom (${relu ? relu.taille + ' caractères' : 'rien'})`);

        const message = await page.evaluate(async () => {
            const f = await import('/src/io/fichiers.js');
            return f.messageEnregistrement({ range: true, dossier: 'Morceaux', racine: 'EssaiTabHub' }, 'Exporté');
        });
        check(message === 'Exporté → EssaiTabHub/Morceaux',
            `et la destination annoncée est la VRAIE (lu : « ${message} »)`);

        // ─────────── LE PDF : la permission AVANT le rendu ───────────
        // Pas une vérification de séquence à l'exécution — une lecture du code, parce que c'est
        // l'ordre des instructions qui décide, et qu'il se perd au premier remaniement.
        const ordre = await page.evaluate(async () => {
            const src = await (await fetch('/src/main.js')).text();
            const i = src.indexOf('async enregistrerPdf()');
            const bloc = src.slice(i, i + 1200);
            return {
                permissionAvant: bloc.indexOf('preparerRangement') < bloc.indexOf('exporterPdf'),
                lesDeux: bloc.includes('preparerRangement') && bloc.includes('exporterPdf'),
            };
        });
        check(ordre.lesDeux && ordre.permissionAvant,
            'LA PERMISSION SE DEMANDE AVANT LE RENDU DU PDF : la gravure passe plusieurs secondes dans jsPDF et Bravura, après quoi le navigateur juge le geste expiré et n\'affiche plus aucune demande — on retomberait en silence dans Téléchargements alors qu\'un dossier est configuré');
        const pdfSansSave = await page.evaluate(async () => {
            const src = await (await fetch('/src/io/pdf.js')).text();
            return { blob: src.includes("pdf.output('blob')"), save: /pdf\.save\(/.test(src) };
        });
        check(pdfSansSave.blob && !pdfSansSave.save,
            '`pdf.output(\'blob\')` et non `pdf.save()` : `save` pose lui-même un lien de téléchargement et ne rend JAMAIS les octets — il n\'y aurait donc rien à ranger');

        // AUCUNE ERREUR JUSQU'ICI — mesuré AVANT les pannes volontaires, qui en produiront une par
        // construction. Ne vérifier qu'à la fin aurait obligé à tout tolérer en bloc, et un banc qui
        // ignore la console ne prouve plus rien.
        check(erreurs.length === 0, `aucune erreur JavaScript sur le chemin normal${erreurs.length ? ' — ' + erreurs.join(' | ') : ''}`);
        const erreursAvantPannes = erreurs.length;

        // ─────────── LES PANNES ───────────
        const disparu = await page.evaluate(async () => {
            // Le dossier est effacé sous les pieds de l'appli — clé USB retirée, dossier supprimé.
            const opfs = await navigator.storage.getDirectory();
            await opfs.removeEntry('EssaiTabHub', { recursive: true });
            const sc = await import('/src/model/score.js');
            const j = await import('/src/io/json.js');
            const p = sc.creerPartition('guitare');
            p.meta.titre = 'Perdu';
            const r = await j.enregistrerPartition(p);
            return { range: r.range, nom: r.nom };
        });
        check(disparu.range === false && disparu.nom.startsWith('TabHub - Perdu - Morceau - '),
            `DOSSIER DISPARU EN COURS DE ROUTE : l'export REPART en téléchargement au lieu de lever. Un export qui ne produit rien serait bien pire qu'un export mal rangé — et c'est le cas qu'on ne découvre qu'en cherchant le fichier trois jours plus tard (lu : rangé=${disparu.range}, ${disparu.nom})`);

        const sansApi = await page.evaluate(async () => {
            const vrai = window.showDirectoryPicker;
            delete window.showDirectoryPicker;
            const f = await import('/src/io/fichiers.js');
            const dispo = f.rangementDisponible();
            const racine = await f.preparerRangement({ demander: true });
            const choix = await f.choisirDossier();
            window.app.rafraichirDossierRangement();
            const etat = document.getElementById('etat-dossier').textContent;
            const note = document.getElementById('note-dossier').textContent;
            const bouton = document.getElementById('btn-dossier-choisir').disabled;
            window.showDirectoryPicker = vrai;
            return { dispo, racine, choix, etat, note, bouton };
        });
        check(sansApi.dispo === false && sansApi.racine === null && sansApi.choix === null,
            'NAVIGATEUR SANS L\'API : rien ne lève, tout rend `null` — Safari, Firefox, iPhone et Android passent par là, et c\'est beaucoup de monde');
        check(sansApi.etat === 'Indisponible' && sansApi.bouton === true,
            `les Réglages le DISENT et grisent le bouton, au lieu de faire disparaître la ligne : une commande absente sans explication se cherche longtemps (lu : « ${sansApi.etat} »)`);
        check(sansApi.note.includes('Safari') && sansApi.note.includes('Téléchargements'),
            `et la note nomme les navigateurs concernés ET rappelle que le nommage, lui, continue de faire son travail (lu : « ${sansApi.note.slice(0, 60)}… »)`);

        const refus = await page.evaluate(async () => {
            const vrai = window.showDirectoryPicker;
            window.showDirectoryPicker = async () => { const e = new Error('annulé'); e.name = 'AbortError'; throw e; };
            const f = await import('/src/io/fichiers.js');
            const choix = await f.choisirDossier();
            window.showDirectoryPicker = vrai;
            return choix;
        });
        check(refus === null,
            'SÉLECTEUR REFERMÉ SANS CHOISIR : `AbortError` rend `null` sans bruit — ce n\'est pas une panne, c\'est quelqu\'un qui a changé d\'avis');

        const oubli = await page.evaluate(async () => {
            const f = await import('/src/io/fichiers.js');
            await f.oublierRacine();
            window.app.rafraichirDossierRangement();
            return { nom: f.nomRacineAffiche(), racine: await f.preparerRangement({ demander: false }),
                     etat: document.getElementById('etat-dossier').textContent };
        });
        check(oubli.nom === '' && oubli.racine === null && oubli.etat === 'Téléchargements',
            `OUBLIER LE DOSSIER le retire des deux mémoires à la fois — IndexedDB pour la poignée, localStorage pour le nom — et l'appli revient au téléchargement (lu : ${JSON.stringify(oubli)})`);

        // ET LA SEULE ERREUR DE TOUT LE BANC EST CELLE QU'ON A PROVOQUÉE — le repli l'ANNONCE en
        // console plutôt que de se taire, ce qui est le bon comportement : un fichier qui part dans
        // Téléchargements alors qu'un dossier est configuré doit laisser une trace, sans quoi le
        // diagnostic se fait à l'aveugle. La vérification est NOMINATIVE : tolérer les erreurs en
        // bloc aurait laissé passer n'importe quoi d'autre.
        const nouvelles = erreurs.slice(erreursAvantPannes);
        check(nouvelles.length === 1 && /Rangement impossible, repli sur le téléchargement/.test(nouvelles[0]),
            `une seule erreur en console, celle du repli qu'on a provoqué (lu : ${nouvelles.length} — ${nouvelles.join(' | ') || 'aucune'})`);
    } finally { await fermer(); }
    bilan();
})();
