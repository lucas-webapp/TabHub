// Banc du NOMMAGE DES FICHIERS EXPORTÉS — la forme commune à TabHub et à HarmoHub.
//
// CE QU'IL PROTÈGE, ET POURQUOI CE N'EST PAS COSMÉTIQUE. Retour utilisateur côté HarmoHub, transposé
// ici : « les exports se font directement dans les téléchargements, puis je dois les ranger
// correctement moi-même. Je me perds rapidement dans les versions. » Le rangement automatique dans un
// dossier choisi (lot suivant) ne fonctionne que sur Chrome et Edge en version bureau. Le NOMMAGE,
// lui, marche partout : même déversés en vrac dans Téléchargements, des fichiers bien nommés se
// regroupent et se trient tout seuls. C'est donc la couche la plus importante des deux, et la seule
// qui tienne l'exigence « sur n'importe quel système ».
//
// LA FORME : « TabHub - Morceau - Type - Date Heure.ext », reprise de HarmoHub sans la réinventer —
// le module de là-bas annonce dès sa première ligne qu'il est prévu pour les deux applications, avec
// le nom de l'appli en paramètre. Ce banc éprouve les quatre décisions que cette forme porte :
//   1. L'APPLI EN TÊTE, pour que les fichiers des deux applications ne se mélangent jamais dans un
//      même dossier de téléchargement.
//   2. LE MORCEAU ENSUITE, parce que c'est par morceau qu'on se perd : toutes ses pièces (.json,
//      .pdf, .mid, .musicxml) se retrouvent côte à côte dans un explorateur trié par nom.
//   3. LE TYPE PUIS LA DATE, pour que les versions d'un même document s'empilent chronologiquement.
//   4. L'HEURE, qui n'est pas décorative : sans elle, deux exports le même jour donnent « (1) » et
//      « (2) » ajoutés par le navigateur — exactement ce qui fait perdre le fil.
//
// ET IL PROTÈGE UNE DIVERGENCE VOULUE avec HarmoHub : le repli en ASCII. HarmoHub ne le fait pas ;
// TabHub doit le faire, et c'est une mesure qui l'a établi, pas un goût — un nom non-ASCII posé dans
// l'attribut `download` d'un lien fait retomber le navigateur sur son nom par défaut, et le fichier
// arrive appelé « download ». Dans une application francophone de partitions (Étude, Prélude,
// Gymnopédie, Bourrée…) le cas est quotidien. Les vérifications correspondantes existaient déjà dans
// exports_test.js ; elles sont reprises ici, à côté de la règle qu'elles contraignent.
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('nommage des fichiers');

(async () => {
    plan(25);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        const f = async (code) => page.evaluate(async (code) => {
            const m = await import('/src/io/fichiers.js');
            const sc = await import('/src/model/score.js');
            return eval(code);
        }, code);

        // ─────────── La forme ───────────
        const forme = await f(`(() => {
            const p = sc.creerPartition('guitare');
            p.meta.titre = 'Blackbird'; p.meta.artiste = 'Beatles';
            const d = new Date(2026, 8, 18, 14, 32);
            return {
                json: m.nomExport({ morceau: m.morceauDe(p), type: m.TYPES.morceau, extension: 'json', date: d }),
                pdf: m.nomExport({ morceau: m.morceauDe(p), type: m.TYPES.partition, extension: 'pdf', date: d }),
                canonique: m.nomCanonique({ morceau: m.morceauDe(p), type: m.TYPES.morceau, extension: 'json' }),
                sansMorceau: m.nomExport({ type: 'Reglages', extension: 'json', date: d }),
            };
        })()`);
        exiger(forme.json === 'TabHub - Blackbird - Beatles - Morceau - 2026-09-18 1432.json',
            `la forme est « TabHub - Morceau - Type - Date Heure.ext » (lu : ${forme.json})`);
        check(forme.json.startsWith('TabHub - '),
            'L\'APPLI EN TÊTE : dans un dossier de téléchargement où HarmoHub dépose aussi les siens, c\'est le seul segment qui les sépare à coup sûr');
        check(forme.pdf.replace(' - Partition - 2026-09-18 1432.pdf', '') === forme.json.replace(' - Morceau - 2026-09-18 1432.json', ''),
            'LE MORCEAU AVANT LE TYPE : le .json et le .pdf d\'un même morceau partagent donc tout leur début, et se retrouvent côte à côte au tri par nom — c\'est par morceau qu\'on se perd, pas par type');
        check(forme.canonique === 'TabHub - Blackbird - Beatles - Morceau.json',
            `le nom CANONIQUE, lui, n'a pas d'horodatage : c'est le même nom, toujours, pour un morceau donné — il servira au rangement dans un dossier, où l'ancien fichier part dans \`_versions/\` au lieu de rester à côté du nouveau (lu : ${forme.canonique})`);
        check(forme.sansMorceau === 'TabHub - Reglages - 2026-09-18 1432.json',
            `un document qui ne concerne aucun morceau saute le segment plutôt que d'afficher un vide (lu : ${forme.sansMorceau})`);

        // ─────────── L'horodatage ───────────
        const tri = await f(`(() => {
            const d = (a, mo, j, h, mi) => m.horodatage(new Date(a, mo - 1, j, h, mi));
            const liste = [d(2026, 9, 18, 9, 5), d(2025, 12, 3, 23, 59), d(2026, 9, 18, 14, 32), d(2026, 1, 2, 0, 0)];
            return { liste, trie: [...liste].sort(), unique: new Set(liste).size };
        })()`);
        check(tri.trie.join(' | ') === [...tri.liste].sort().join(' | ') && tri.trie[0] === '2025-12-03 2359',
            `« aaaa-mm-jj hhmm » SE TRIE PAR ORDRE ALPHABÉTIQUE, ce que ne permet aucun format local — 18/09/2026 se classerait avant 03/12/2025 (le plus ancien lu : ${tri.trie[0]})`);
        check(!tri.liste.some(x => x.includes(':')),
            'et l\'heure s\'écrit « 1432 », sans deux-points : Windows les interdit dans un nom de fichier');
        const memeJour = await f(`(() => {
            const a = m.nomExport({ morceau: 'X', type: 'Morceau', extension: 'json', date: new Date(2026, 8, 18, 9, 5) });
            const b = m.nomExport({ morceau: 'X', type: 'Morceau', extension: 'json', date: new Date(2026, 8, 18, 17, 40) });
            return { a, b, distincts: a !== b };
        })()`);
        check(memeJour.distincts,
            'DEUX EXPORTS LE MÊME JOUR portent deux noms distincts : avec la seule date, le navigateur ajoutait « (1) » et « (2) » — précisément ce qui fait perdre le fil des versions');

        // ─────────── L'assainissement ───────────
        const propre = await f(`(() => ({
            accents: m.nettoyerSegment('Étude en la mineur'),
            ligature: m.nettoyerSegment('Cœur'),
            cedille: m.nettoyerSegment('Française'),
            interdits: m.nettoyerSegment('a/b:c*d?e"f<g>h|i'),
            controle: m.nettoyerSegment('Bal' + String.fromCharCode(7) + 'lade' + String.fromCharCode(0)),
            espaces: m.nettoyerSegment('  Trop    d espaces  '),
            pointFinal: m.nettoyerSegment('Fin du morceau...'),
            espaceFinal: m.nettoyerSegment('Titre   '),
            longueur: m.nettoyerSegment('x'.repeat(200)).length,
            vide: m.nettoyerSegment(''),
            nul: m.nettoyerSegment(null),
            horsLatin: m.nettoyerSegment('日本語'),
        }))()`);
        check(propre.accents === 'Etude en la mineur' && propre.ligature === 'Coeur' && propre.cedille === 'Francaise',
            `LE REPLI EN ASCII, la divergence voulue avec HarmoHub : mesuré caractère par caractère, un nom non-ASCII dans l'attribut \`download\` fait retomber le navigateur sur « download ». « Étude » donne « Etude » — une perte cosmétique, mais un nom qu'on reconnaît encore (lu : ${propre.accents} / ${propre.ligature} / ${propre.cedille})`);
        check(propre.interdits === 'a_b_c_d_e_f_g_h_i',
            `les neuf caractères interdits par Windows deviennent des « _ » — on s'aligne sur le plus strict des trois systèmes, parce qu'un fichier doit pouvoir voyager (lu : ${propre.interdits})`);
        check(propre.controle === 'Ballade',
            `les caractères de CONTRÔLE disparaissent : invisibles dans le nom, ils cassent l'écriture chez certains systèmes (lu : ${propre.controle})`);
        check(propre.espaces === 'Trop d espaces',
            `les espaces multiples sont réduits et les bords rognés (lu : « ${propre.espaces} »)`);
        check(propre.pointFinal === 'Fin du morceau' && propre.espaceFinal === 'Titre',
            `LES POINTS ET ESPACES EN FIN DE NOM sont retirés, et c'est la règle la plus sournoise du lot : Windows les efface SILENCIEUSEMENT à la création, si bien qu'un fichier ne porte pas le nom qu'on croit lui avoir donné (lu : « ${propre.pointFinal} » / « ${propre.espaceFinal} »)`);
        check(propre.longueur === 60,
            `la longueur d'un segment est bornée à 60 (lu : ${propre.longueur})`);
        check(propre.vide === 'tablature' && propre.nul === 'tablature' && propre.horsLatin === 'tablature',
            `et quand il ne reste RIEN — chaîne vide, \`null\`, ou une écriture hors latin entièrement retirée — un repli plutôt qu'un fichier sans nom. C'est « tablature » et non le « Sans titre » de HarmoHub : le repli de TabHub existait avant, il est éprouvé ailleurs, et deux réponses à la même question selon le chemin pris seraient pires que la différence (lu : ${propre.vide} / ${propre.nul} / ${propre.horsLatin})`);
        const sansArtiste = await f(`(() => {
            const p = sc.creerPartition('guitare');
            p.meta.titre = 'Blackbird'; p.meta.artiste = '';
            const sansTitre = sc.creerPartition('guitare');
            sansTitre.meta.titre = ''; sansTitre.meta.artiste = 'Stevie Wonder';
            const rien = sc.creerPartition('guitare'); rien.meta.titre = ''; rien.meta.artiste = '';
            const d = new Date(2026, 8, 18, 14, 32);
            return {
                titreSeul: m.nomExport({ morceau: m.morceauDe(p), type: 'Morceau', extension: 'json', date: d }),
                artisteSeul: m.nomExport({ morceau: m.morceauDe(sansTitre), type: 'Morceau', extension: 'json', date: d }),
                rien: m.nomExport({ morceau: m.morceauDe(rien), type: 'Morceau', extension: 'json', date: d }),
            };
        })()`);
        check(sansArtiste.titreSeul === 'TabHub - Blackbird - Morceau - 2026-09-18 1432.json'
              && sansArtiste.artisteSeul === 'TabHub - Stevie Wonder - Morceau - 2026-09-18 1432.json',
            `un morceau sans artiste ne produit PAS « Blackbird -  - Morceau » : le tiret orphelin donnerait un nom qui a l'air tronqué (lu : ${sansArtiste.titreSeul})`);
        check(sansArtiste.rien === 'TabHub - Morceau - 2026-09-18 1432.json',
            `\`nomExport\` SEUL saute le segment vide — c'est la règle de HarmoHub, faite pour un document qui n'appartient à aucun morceau (lu : ${sansArtiste.rien})`);

        // ─────────── Retrouver le morceau depuis le nom de fichier ───────────
        const retour = await f(`(() => {
            const nom = (mo, ty, ex, extra) => m.nomExport({ morceau: [mo, extra].filter(Boolean).join(' - '), type: ty, extension: ex, date: new Date(2026, 8, 18, 14, 32) });
            return {
                simple: m.morceauDepuisNomFichier(nom('Blackbird', 'Morceau', 'json')),
                avecTiret: m.morceauDepuisNomFichier(nom('Blackbird - Beatles', 'Partition', 'pdf')),
                section: m.morceauDepuisNomFichier(nom('Blackbird - Beatles', 'MIDI', 'mid', 'Couplet')),
                canonique: m.morceauDepuisNomFichier('TabHub - Blackbird - Beatles - Morceau.json'),
                etranger: m.morceauDepuisNomFichier('HarmoHub - Ballade - Accords - 2026-09-18 1432.pdf'),
                nImporteQuoi: m.morceauDepuisNomFichier('photo-vacances.jpg'),
            };
        })()`);
        check(retour.simple === 'Blackbird' && retour.avecTiret === 'Blackbird - Beatles',
            `le nom du morceau se relit DEPUIS LE NOM DE FICHIER, y compris quand il contient lui-même « - » — ce qui est le cas courant ici, TabHub nommant ses morceaux « Titre - Artiste » (lu : ${retour.avecTiret})`);
        check(retour.section === 'Blackbird - Beatles - Couplet',
            `un MIDI de section se rattache au morceau ET garde sa section (lu : ${retour.section})`);
        check(retour.canonique === 'Blackbird - Beatles',
            `le nom canonique, sans horodatage, se relit aussi (lu : ${retour.canonique})`);
        check(retour.etranger === null && retour.nImporteQuoi === null,
            `et ce qui n'est pas à TabHub n'est PAS réclamé : un fichier de HarmoHub dans le même dossier n'est pas un morceau de TabHub (lu : ${JSON.stringify(retour.etranger)} / ${JSON.stringify(retour.nImporteQuoi)})`);

        // ─────────── Le piège du préfixe ───────────
        const piege = await f(`(() => {
            const pEtude = m.prefixeMorceau('Etude');
            const pLive = m.prefixeMorceau('Etude - live');
            const tous = [pEtude, pLive];
            const fichiers = ['TabHub - Etude - Morceau - 2026-09-18 1432.json',
                              'TabHub - Etude - live - Morceau - 2026-09-18 1432.json'];
            return {
                aEtude: fichiers.filter(x => m.estFichierDuMorceau(x, pEtude, tous)),
                aLive: fichiers.filter(x => m.estFichierDuMorceau(x, pLive, tous)),
            };
        })()`);
        check(piege.aEtude.length === 1 && piege.aEtude[0].includes(' - Etude - Morceau'),
            `LE PIÈGE DU PRÉFIXE, et il n'est pas théorique : les fichiers d'« Étude » et ceux d'« Étude - live » commencent par la même chaîne. Un fichier qui appartient AUSSI à un morceau plus spécifique n'est jamais retenu pour le plus général — sans quoi supprimer « Étude » emporterait les fichiers de « Étude - live » (à Étude : ${piege.aEtude.length} fichier)`);
        check(piege.aLive.length === 1 && piege.aLive[0].includes(' - Etude - live - '),
            `et « Étude - live » garde bien les siens (${piege.aLive.length} fichier)`);

        // ─────────── LES CINQ ROUTES passent par là ───────────
        const routes = await page.evaluate(async () => {
            const sc = await import('/src/model/score.js');
            const j = await import('/src/io/json.js');
            const pdf = await import('/src/io/pdf.js');
            const midi = await import('/src/io/midi.js');
            const mx = await import('/src/io/musicxml.js');
            const f = await import('/src/io/fichiers.js');
            const p = sc.creerPartition('guitare');
            p.meta.titre = 'Étude'; p.meta.artiste = 'Dyens';
            p.mesures[0].annotation = 'Couplet';
            p.mesures[2].annotation = 'Refrain';
            return {
                pdf: pdf.construirePdf(p, {}).nomFichier,
                sections: midi.genererMidiSections(p).map(x => x.nom),
                // Le .json et le .musicxml téléchargent : on lit le nom que le module leur donne,
                // sans déclencher cinq téléchargements dans le banc.
                json: f.nomPour(p, 'morceau', 'json'),
                musicxml: f.nomPour(p, 'musicxml', 'musicxml'),
            };
        });
        const debut = 'TabHub - Etude - Dyens - ';
        check(routes.pdf.startsWith(debut + 'Partition - ') && routes.pdf.endsWith('.pdf'),
            `le PDF passe par la règle commune (lu : ${routes.pdf})`);
        // TITRE ET ARTISTE VIDÉS EXPRÈS : une partition neuve porte « Sans titre » par défaut, donc
        // elle n'éprouve PAS le repli — première version de cette vérification, qui lisait « Sans
        // titre » et croyait mesurer le repli.
        const sansRien = await f(`(() => {
            const p = sc.creerPartition('guitare'); p.meta.titre = ''; p.meta.artiste = '';
            return m.nomPour(p, 'morceau', 'json');
        })()`);
        check(sansRien.startsWith('TabHub - tablature - Morceau - '),
            `mais \`nomPour\`, par où passent les cinq routes, REMET le repli : un morceau sans titre est quand même un morceau, et « TabHub - Morceau - date.json » ne dirait plus qu'il s'agit d'une tablature (lu : ${sansRien})`);
        check(routes.json.startsWith(debut + 'Morceau - ') && routes.musicxml.startsWith(debut + 'MusicXML - '),
            `le .json et le .musicxml aussi (lu : ${routes.json} / ${routes.musicxml})`);
        check(routes.sections.length === 2 && routes.sections.every(n => n.startsWith(debut) && n.includes(' - MIDI - ')),
            `et le MIDI par section, qui interpolait son nom à la main : « TabHub - Titre - Artiste - Section - MIDI - date.mid » (lu : ${JSON.stringify(routes.sections)})`);

        check(erreurs.length === 0, 'aucune erreur JavaScript');
    } finally { await fermer(); }
    bilan();
})();
