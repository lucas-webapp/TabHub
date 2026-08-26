// Banc des EXPORTS : le .json qui repart et revient sans rien perdre, et le PDF qui se télécharge
// directement, en vectoriel, sans boîte d'impression.
//
// L'aller-retour JSON est le banc le plus important du lot : c'est lui qui dit si un utilisateur peut
// ranger son travail et le retrouver. Une perte silencieuse à la relecture (un effet oublié, une
// reprise disparue) ne se voit qu'une fois le fichier d'origine écrasé — donc trop tard.

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const creerHarnais = require('./_harness.js');
const { ouvrirApp, taper } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('exports');

/** Fabrique une partition qui utilise TOUT ce que le format sait décrire. */
async function partitionTemoin(page) {
    await page.evaluate(async () => {
        const m = await import('/src/model/score.js');
        const ed = window.app.editeur;
        const n = (c, f, l = null, extra = {}) => m.creerNote(c, f, { lien: l, ...extra });
        ed.partition.meta = { ...ed.partition.meta, titre: 'Banc des exports', sousTitre: 'sous-titre', artiste: 'Anonyme', tempo: 138 };
        ed.partition.piste.capo = 2;
        ed.partition.mesures = [
            m.creerMesure({
                signature: { battements: 3, unite: 8 }, armure: -3, repriseDebut: true,
                voix: [{
                    evenements: [
                        m.creerEvenement({ valeur: 8 }, [n(0, 7, 'hammer'), n(1, 0), n(5, 0)]),
                        m.creerEvenement({ valeur: 8 }, [n(0, 9, 'slide')], { palmMute: true }),
                        m.creerEvenement({ valeur: 8 }, [n(0, 12, 'tie', { bend: { demiTons: 2 } })], { accent: true }),
                    ],
                }],
            }),
            m.creerMesure({
                repriseFin: true,
                // Une SECONDE voix (basse tenue) : c'est elle qu'un format d'export incomplet
                // « oublierait » le plus facilement, puisqu'elle n'apparaît que si on la cherche.
                voix: [
                    {
                        evenements: [
                            m.creerEvenement({ valeur: 8, nolet: { dans: 3, valent: 2 } }, [n(2, 5, 'pull', { ghost: true })]),
                            m.creerEvenement({ valeur: 8, nolet: { dans: 3, valent: 2 } }, [n(2, 3)]),
                            m.creerEvenement({ valeur: 8, nolet: { dans: 3, valent: 2 } }, [n(2, 2)]),
                            m.creerEvenement({ valeur: 4, points: 1 }, [], { silence: true }),
                        ],
                    },
                    { evenements: [m.creerEvenement({ valeur: 2, points: 1 }, [n(5, 2)])] },
                ],
            }),
        ];
        ed.prevenir('document');
    });
    await page.waitForTimeout(300);
}

/** Empreinte de tout ce qui doit survivre à un aller-retour. */
const empreinte = (page) => page.evaluate(() => {
    const p = window.app.editeur.partition;
    return JSON.stringify({
        meta: { t: p.meta.titre, s: p.meta.sousTitre, a: p.meta.artiste, bpm: p.meta.tempo },
        piste: { i: p.piste.instrument, c: p.piste.accordage.cordes, capo: p.piste.capo },
        mesures: p.mesures.map(m => ({
            sig: m.signature, arm: m.armure, rd: m.repriseDebut, rf: m.repriseFin,
            // TOUTES les voix, pas seulement la première — une empreinte qui ne verrait que la voix 0
            // ne remarquerait jamais qu'une seconde voix a disparu à la relecture.
            voix: m.voix.map(voix => voix.evenements.map(e => ({
                d: e.duree, s: e.silence, pm: e.palmMute, ac: e.accent,
                n: e.notes.map(x => ({ c: x.corde, f: x.frette, l: x.lien, b: x.bend, g: x.ghost })),
            }))),
        })),
    });
});

(async () => {
    plan(19);
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'tabhub-'));
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        await partitionTemoin(page);
        const avant = await empreinte(page);

        // --- Aller-retour JSON ----------------------------------------------------------------------
        // « Exporter » télécharge un fichier portable (l'ancien sens d'« Enregistrer ») ; « Enregistrer »
        // s'est spécialisé dans la persistance LOCALE (voir main.js) — un clic dessus n'ouvre aucun
        // téléchargement, ce que ce banc ne doit pas confondre avec un défaut.
        const attenteJson = page.waitForEvent('download');
        await page.click('#btn-exporter');
        const telJson = await attenteJson;
        const cheminJson = path.join(dossier, 'temoin.json');
        await telJson.saveAs(cheminJson);
        exiger(fs.existsSync(cheminJson), 'le clic sur Exporter télécharge bien un fichier');
        check(/\.json$/.test(telJson.suggestedFilename()), 'le fichier porte l\'extension .json');
        check(telJson.suggestedFilename().startsWith('Banc des exports'), 'et il est nommé d\'après le titre du morceau');

        const brut = JSON.parse(fs.readFileSync(cheminJson, 'utf8'));
        check(brut.format === 'tabhub-partition', 'le fichier se déclare au format TabHub');
        check(typeof brut.version === 'number', 'et porte un numéro de version, pour les formats à venir');
        check(fs.readFileSync(cheminJson, 'utf8').includes('\n  '), 'il est indenté : lisible et modifiable à la main');

        // On repart d'une partition vierge avant de relire, pour être sûr que la relecture reconstruit
        // vraiment tout et ne se contente pas de laisser en place ce qui était déjà là.
        await page.evaluate(() => window.app.editeur.nouveau('basse4'));
        await page.waitForTimeout(200);
        check((await empreinte(page)) !== avant, 'la partition a bien été remise à zéro avant relecture');

        await page.setInputFiles('#entree-fichier', cheminJson);
        await page.waitForTimeout(500);
        const apres = await empreinte(page);
        check(apres === avant, 'ALLER-RETOUR EXACT : tout ce qui a été écrit est relu à l\'identique');

        const detail = JSON.parse(apres).mesures;
        check(detail[0].rd === true && detail[1].rf === true, 'les barres de reprise survivent');
        check(detail[0].voix[0][0].n[0].l === 'hammer' && detail[1].voix[0][0].n[0].l === 'pull', 'hammer-on et pull-off survivent');
        check(detail[0].voix[0][2].n[0].b && detail[0].voix[0][2].n[0].b.demiTons === 2, 'le bend et son amplitude survivent');
        check(detail[1].voix[0][0].d.nolet && detail[1].voix[0][0].d.nolet.dans === 3, 'les triolets survivent');
        check(detail[0].arm === -3 && detail[0].sig.unite === 8, 'armure et signature rythmique survivent');
        check(detail[1].voix.length === 2, 'la SECONDE VOIX de la mesure 2 survit — pas seulement la mélodie');
        const basse = detail[1].voix[1][0];
        check(basse.n[0].c === 5 && basse.n[0].f === 2 && basse.d.valeur === 2 && basse.d.points === 1, 'et son contenu (corde, case, durée pointée) est exact');

        // --- Un fichier illisible ne doit pas casser l'application -----------------------------------
        const cheminAbime = path.join(dossier, 'abime.json');
        fs.writeFileSync(cheminAbime, '{ ceci n\'est pas du json');
        await page.setInputFiles('#entree-fichier', cheminAbime);
        await page.waitForTimeout(400);
        const message = await page.textContent('#message');
        check(/illisible|JSON/i.test(message || ''), 'un fichier corrompu affiche un message clair au lieu d\'une exception');
        check((await empreinte(page)) === avant, 'et la partition en cours reste intacte');

        // --- Export PDF ---------------------------------------------------------------------------------
        const attentePdf = page.waitForEvent('download');
        await page.click('#btn-pdf');
        const telPdf = await attentePdf;
        const cheminPdf = path.join(dossier, 'temoin.pdf');
        await telPdf.saveAs(cheminPdf);
        const donnees = fs.readFileSync(cheminPdf);
        exiger(donnees.slice(0, 5).toString('latin1') === '%PDF-', 'le clic sur Exporter PDF télécharge un vrai PDF');

        // TOUT DOIT ÊTRE VECTORIEL. C'est la raison d'être du double moteur de rendu : une partition
        // rastérisée devient grise à l'impression. La présence d'une seule image dans le fichier
        // signifierait qu'on est retombé sur une capture d'écran.
        check(!/\/Subtype\s*\/Image/.test(donnees.toString('latin1')), 'le PDF ne contient AUCUNE image rastérisée');
        // Extraction des flux de contenu : on découpe sur les bornes EXACTES « stream\n … \nendstream ».
        // Une première version coupait sur la sous-chaîne « stream », qui apparaît aussi dans
        // « endstream » — les flux en ressortaient tronqués d'un octet et l'inflate échouait, ce qui
        // faisait passer un PDF parfaitement valide pour vide.
        let flux = '';
        const texte = donnees.toString('latin1');
        const motif = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
        let m2;
        while ((m2 = motif.exec(texte)) !== null) {
            const corps = Buffer.from(m2[1], 'latin1');
            try { flux += zlib.inflateSync(corps).toString('latin1'); } catch (e) { flux += corps.toString('latin1'); }
        }
        exiger(flux.length > 1000, 'les flux de contenu du PDF sont lisibles');
        check(/\bc\b/.test(flux) && (flux.match(/\bc\b/g) || []).length > 40, 'il contient de vraies courbes de Bézier (les glyphes musicaux)');
        check(flux.includes('Banc des exports'), 'et du VRAI TEXTE, sélectionnable et cherchable, pas des pixels');

        check(erreurs.length === 0, 'aucune erreur JavaScript pendant les exports' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally {
        await fermer();
        fs.rmSync(dossier, { recursive: true, force: true });
    }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
