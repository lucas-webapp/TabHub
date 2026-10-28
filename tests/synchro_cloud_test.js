// LA SYNCHRO CLOUD DE TABHUB (voir synchro-cloud.js, générique, et src/io/synchro.js, l'adaptateur).
//
// CONTEXTE. Retour utilisateur : « l'enregistrement me semble trop aléatoire sur HarmoHub et TabHub ».
// TabHub n'a qu'UN BROUILLON (voir main.js#planifierBrouillon), écrasé à chaque changement : la synchro
// est celle de TrainHub, un seul document au cloud, le plus récent gagne. Ce banc cherche, dans l'ordre :
//   1. qu'aucune tablature ne se perde — appareil neuf face à un cloud plein, deux versions différentes,
//      remplacement volontaire (import, « Nouvelle », restauration) que la date ferait annuler ;
//   2. que la synchro ne boucle jamais ;
//   3. que l'état soit toujours dit ;
//   4. que la pilule du compte (compte-cloud.js, la même dans HarmoHub, TabHub et TrainHub) tienne dans la barre du haut
//      — qui n'avait déjà plus que 3 px de reste à 390 px — sans rien faire déborder ni sortir de l'écran ;
//   5. que la fenêtre de connexion soit proposée à l'ouverture quand personne n'est connecté, et pas plus d'une fois.
//
// CE QU'IL NE PEUT PAS ÉPROUVER : les règles de sécurité Firestore, les domaines autorisés, la fenêtre
// Google réelle sur Safari — le faux reproduit les refus de FORMAT du vrai, pas ses refus d'AUTORISATION.
const path = require('path');
const { check, exiger, plan, bilan } = require('./_harness')('synchro cloud');
const { creerNuage, installer } = require('./_firebase_faux');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(path.join('/opt/node22/lib/node_modules', 'playwright'))); }

const BASE = process.env.TABHUB_URL || 'http://localhost:8945';
const CHEMIN = 'users/u1/apps/tabhub';
const pause = (p, ms) => p.waitForTimeout(ms);
// ERR_FAILED : c'est le `route.abort()` de ce banc, qui coupe volontairement le SDK dans le cas « sans Firebase ».
const BRUIT = /fonts\.googleapis|tonejs\.github\.io|ERR_CONNECTION|ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_CERT|ERR_FAILED/;
const PANNES = /Envoi vers le cloud impossible|Écoute de la synchro interrompue|Synchro initiale impossible|Tablature illisible dans le cloud/;

plan(102);

(async () => {
    const navigateur = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    const erreurs = [], pannes = [];

    const ouvrir = async (nuage, appareil, { viewport, tactile, brouillon, sdk = true, etatSynchro, persister } = {}) => {
        const ctx = await navigateur.newContext({
            viewport: viewport || { width: 1320, height: 880 }, acceptDownloads: true,
            ...(tactile ? { hasTouch: true, isMobile: true } : {}),
        });
        if (sdk) await installer(ctx, nuage, { appareil, uid: 'u1', persister });
        else await ctx.route(/gstatic\.com\/firebasejs\//, (r) => r.abort());
        const p = await ctx.newPage();
        p.on('pageerror', (e) => erreurs.push(`${appareil} exception : ${e.message}`));
        p.on('console', (m) => {
            if (m.type() !== 'error' || BRUIT.test(m.text())) return;
            if (PANNES.test(m.text())) { pannes.push(m.text()); return; }
            erreurs.push(`${appareil} console : ${m.text()}`);
        });
        await p.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
        if (brouillon) {
            await p.evaluate(([b, e]) => {
                localStorage.clear(); localStorage.setItem('tabhub.brouillon', JSON.stringify(b));
                for (const [k, v] of Object.entries(e || {})) localStorage.setItem(k, String(v));
            }, [brouillon, etatSynchro]);
            await p.reload({ waitUntil: 'domcontentloaded' });
        }
        await p.waitForFunction(() => window.app && window.app.page, null, { timeout: 20000 });
        await pause(p, 400);
        return { ctx, p, nom: appareil };
    };
    // Une tablature avec des frettes données : on part d'un document neuf et on y pose des notes.
    const tablature = async (d, titre, frettes) => {
        await d.p.evaluate(([t, f]) => {
            window.app.editeur.nouveau('guitare');
            const p = window.app.editeur.partition;
            p.meta.titre = t;
            const ev = p.mesures[0].voix[0].evenements;
            f.forEach((fr, i) => {
                if (!ev[i]) ev.push(JSON.parse(JSON.stringify(ev[0])));
                ev[i].id = 'ev' + i; ev[i].notes = [{ id: 'n' + i + t, corde: i % 6, frette: fr, lien: null, bend: null, ghost: false }];
            });
            window.app.editeur.remplacer(JSON.parse(JSON.stringify(p)));
            // Posé comme un remplacement VOLONTAIRE (l'équivalent d'un import) : c'est lui qui date
            // l'appareil et déclenche l'envoi. `meta.modifieLe` ne sert plus à rien ici : voir l'en-tête de
            // io/synchro.js, normaliser la réécrit à chaque remplacement.
            window.app.synchro.apresRemplacement();
        }, [titre, frettes]);
    };
    // L'ÉTAT se lit sur la pastille du composant commun (#sync-status), qu'un compte soit connecté ou non : masquée, elle
    // garde son dernier `data-etat` — on ne la consulte donc que connecté, et on teste `#account-info` pour le reste.
    const etat = (d) => d.p.getAttribute('#sync-status', 'data-etat');
    const notes = (d) => d.p.evaluate(() => window.app.editeur.partition.mesures.flatMap(m => m.voix.flatMap(v => v.evenements.flatMap(e => e.notes.map(n => n.frette)))));
    const titre = (d) => d.p.evaluate(() => window.app.editeur.partition.meta.titre);
    const dansNuage = (n) => { const doc = n.docs.get(CHEMIN); return doc ? JSON.parse(doc.json) : null; };
    const sauvegardes = (d) => d.p.evaluate(() => JSON.parse(localStorage.getItem('tabhub.backups.v1') || '[]').map(s => ({ titre: s.titre, raison: s.raison, notes: s.notes })));
    const menuFichiers = async (p) => {
        await p.click('#btn-fichiers'); await pause(p, 200);
        const l = await p.evaluate(() => [...document.querySelectorAll('#popover-fichiers [data-action]')].filter(b => !b.hidden).map(b => b.dataset.action));
        await p.keyboard.press('Escape'); await p.evaluate(() => window.app.fermerPopoverFichiers()); await pause(p, 150);
        return l;
    };
    // LA CONNEXION est dans la BARRE DU HAUT (compte-cloud.js), plus dans le menu Fichiers. Un appareil qui s'ouvre sans
    // compte voit d'abord la FENÊTRE DE CONNEXION : c'est par elle que l'utilisateur se connecte alors, comme il le ferait.
    // Sinon, par la pilule « Se connecter ».
    const connecter = async (d, ms = 1800) => {
        if (await d.p.isVisible('#cloud-guard-modal')) await d.p.click('#cloud-guard-connect');
        else await d.p.click('#google-signin-btn');
        await pause(d.p, ms);
    };
    const deconnecter = async (p) => { await p.click('#account-info'); await pause(p, 200); await p.click('#signout-btn'); };

    // ================= 0. SANS FIREBASE =================
    {
        const D = await ouvrir(null, 'X', { sdk: false });
        check(await D.p.isVisible('#google-signin-btn') && await D.p.locator('#google-signin-btn').evaluate(e => e.classList.contains('cc-indisponible')),
            'sans SDK Firebase, la pilule reste VISIBLE mais grisée : un bouton qui disparaît en silence ressemble à une panne');
        check(/Firebase/.test(await D.p.getAttribute('#google-signin-btn', 'title')), 'et la raison est au survol');
        check(await D.p.isHidden('#cloud-guard-modal'), 'et la fenêtre de connexion ne s\'ouvre PAS : on ne propose pas une connexion qui ne peut pas marcher');
        await D.p.click('#google-signin-btn'); await pause(D.p, 300);
        check(/indisponible/.test(await D.p.textContent('#message')), 'le clic DIT pourquoi au lieu de ne rien faire');
        check(!(await menuFichiers(D.p)).some(a => /cloud/.test(a)), 'et le menu Fichiers ne contient rien sur la synchro : la connexion vit dans la barre du haut');
        await tablature(D, 'Local', [3, 5]);
        check((await notes(D)).join() === '3,5', 'et TabHub fonctionne exactement comme avant');
        await D.ctx.close();
    }

    // ================= 1. CONNEXION, CLOUD VIDE =================
    const nuage = creerNuage();
    const A = await ouvrir(nuage, 'A');
    await tablature(A, 'Ballade', [3, 5, 7]);
    await pause(A.p, 900);
    if (!exiger(await A.p.isVisible('#google-signin-btn'), 'la pilule « Se connecter » est visible dans la barre du haut')) return bilan();
    check(await A.p.isHidden('#account-info') && await A.p.isHidden('#sync-status'), 'et rien d\'autre tant qu\'aucun compte n\'est connecté');
    await A.p.click('#cloud-guard-continue');   // la fenêtre d'accueil recouvre la page : on la ferme pour atteindre le menu Fichiers
    check(!(await menuFichiers(A.p)).some(a => /cloud/.test(a)), 'le popover Fichiers ne propose PLUS de se connecter : c\'est un menu d\'export, la connexion est dans la barre du haut');
    await connecter(A);
    check(await etat(A) === 'synced', `connecté : pastille « synchronisé » — ${await etat(A)}`);
    check(await A.p.isVisible('#account-info') && await A.p.isHidden('#google-signin-btn') && /Testeur/.test(await A.p.textContent('#account-name')),
        'connecté : la pilule montre le COMPTE (son nom) à la place de « Se connecter »');
    check(/Synchronisé/.test(await A.p.getAttribute('#sync-status', 'title')), 'le survol de la pastille dit l\'état en toutes lettres');
    check(await A.p.getAttribute('#btn-enregistrer', 'data-sync') === null && await A.p.getAttribute('#btn-enregistrer', 'title') === 'Enregistrer (Ctrl+S)',
        'le bouton Enregistrer ne porte PLUS de pastille ni d\'état dans son titre : c\'était un doublon');
    check(nuage.docs.has(CHEMIN), 'le document est sous users/{uid}/apps/tabhub');
    check(typeof nuage.docs.get(CHEMIN).json === 'string', 'stocké comme une chaîne JSON : Firestore refuse tableaux imbriqués et undefined');
    check((dansNuage(nuage).mesures[0].voix[0].evenements.length) >= 3, 'la tablature est au cloud');
    await A.p.click('#account-info'); await pause(A.p, 200);
    check(await A.p.isVisible('#cloud-menu') && await A.p.isVisible('#signout-btn') && /Synchronisé/.test(await A.p.textContent('#cloud-menu-etat')),
        'cliquer sur le compte ouvre son menu : l\'état de la synchro en toutes lettres, et « Se déconnecter »');
    await A.p.keyboard.press('Escape'); await pause(A.p, 150);
    check(await A.p.isHidden('#cloud-menu'), 'et Échap referme ce menu');

    // ================= 2. APPAREIL NEUF : il récupère, sans rien demander ni écraser =================
    const B = await ouvrir(nuage, 'B');
    const ecrB0 = nuage.ecritures.filter(e => e.appareil === 'B').length;
    await connecter(B);
    check((await notes(B)).join() === '3,5,7', 'un appareil neuf récupère la tablature du cloud');
    check(await titre(B) === 'Ballade', 'titre compris');
    check(await B.p.evaluate(() => document.getElementById('fenetre-synchro-choix').hidden), 'sans poser de question : il n\'y a rien à arbitrer');
    check(nuage.ecritures.filter(e => e.appareil === 'B').length === ecrB0, 'et n\'écrit RIEN au cloud : écraser le cloud avec du vide serait le pire');
    check(await etat(B) === 'synced', 'sa pastille est à « synchronisé »');

    // ================= 3. MODIFIER =================
    const ecrA0 = nuage.ecritures.filter(e => e.appareil === 'A').length;
    await tablature(A, 'Ballade', [3, 5, 7, 9]);
    check(await etat(A) === 'pending', `juste après la modification : « pas encore envoyé » (${await etat(A)})`);
    await pause(A.p, 2700);
    check(await etat(A) === 'synced', 'puis « synchronisé »');
    check((await notes(B)).join() === '3,5,7,9', 'l\'autre appareil reçoit la modification tout seul');
    check(nuage.ecritures.filter(e => e.appareil === 'B').length === ecrB0, 'recevoir ne renvoie RIEN : pas de boucle');
    await pause(A.p, 5000);
    check(nuage.ecritures.filter(e => e.appareil === 'A').length - ecrA0 === 1,
        'et une modification n\'a coûté qu\'UNE écriture, même cinq secondes plus tard (pas de renvoi en boucle)');

    // ================= 4. PREMIÈRE CONNEXION AVEC DU CONTENU DES DEUX CÔTÉS =================
    const cas = async (choix) => {
        const n = creerNuage();
        const D1 = await ouvrir(n, 'D1');
        await tablature(D1, 'Version cloud', [1, 2, 3]);
        await pause(D1.p, 800);
        await connecter(D1);
        // L'appareil a déjà SA tablature, restaurée comme brouillon au démarrage.
        const partition = await D1.p.evaluate(() => { const p = JSON.parse(JSON.stringify(window.app.editeur.partition)); return p; });
        const D2 = await ouvrir(n, 'D2', {
            brouillon: { ...partition, meta: { ...partition.meta, titre: 'Version appareil' }, mesures: [JSON.parse(JSON.stringify(partition.mesures[0]))] },
            etatSynchro: { 'tabhub.sync.at': Date.parse('2020-01-01') },   // un appareil resté longtemps sans servir
        });
        await connecter(D2, 900);
        const vu = await D2.p.evaluate(() => ({ visible: !document.getElementById('fenetre-synchro-choix').hidden, corps: document.getElementById('corps-synchro-choix').textContent }));
        if (choix === 'fermer') await D2.p.evaluate(() => { const f = document.getElementById('fenetre-synchro-choix'); f.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
        else await D2.p.click(`#fenetre-synchro-choix [data-choix="${choix}"]`);
        await pause(D2.p, 3200);
        return { vu, titreLocal: await titre(D2), titreCloud: dansNuage(n).meta.titre, sauv: await sauvegardes(D2), D2 };
    };
    const c1 = await cas('cloud');
    check(c1.vu.visible, 'deux tablatures différentes : on DEMANDE, au lieu de laisser la date trancher');
    check(/Dans le cloud/.test(c1.vu.corps) && /Sur cet appareil/.test(c1.vu.corps) && /la plus récente/.test(c1.vu.corps), 'chaque version est décrite, et la plus récente désignée');
    check(c1.titreLocal === 'Version cloud', '« prendre celle du cloud » : l\'appareil prend la version du cloud');
    check(c1.sauv.some(s => s.titre === 'Version appareil'), 'et la sienne est gardée dans les sauvegardes de secours, pas jetée');
    const c2 = await cas('appareil');
    check(c2.titreLocal === 'Version appareil' && c2.titreCloud === 'Version appareil',
        '« garder celle de cet appareil » : elle l\'emporte AUSSI au cloud, bien qu\'elle porte une date plus ancienne');
    check(c2.sauv.some(s => s.titre === 'Version cloud'), 'et la version du cloud est gardée en secours');
    const c3 = await cas('fermer');
    check(c3.titreLocal === 'Version cloud', 'fermer la fenêtre sans choisir garde la plus RÉCENTE (ici le cloud)');
    check(c3.sauv.some(s => s.titre === 'Version appareil'), 'sans rien jeter : l\'autre est en secours');

    // ================= 4 bis. L'HORLOGE DE SYNCHRO : ce que `normaliser` aurait cassé =================
    // normaliser réécrit meta.modifieLe à l'instant présent à CHAQUE remplacer : après un rechargement, un
    // brouillon intact depuis un mois portait la date d'aujourd'hui. Un appareil resté des semaines sans
    // servir aurait alors paru « le plus récent » et écrasé le cloud de sa version périmée.
    {
        const n = creerNuage();
        const P = await ouvrir(n, 'P'); await tablature(P, 'Cloud récent', [8, 9]); await pause(P.p, 800); await connecter(P);
        const partition = await P.p.evaluate(() => JSON.parse(JSON.stringify(window.app.editeur.partition)));
        const atCloud = n.docs.get(CHEMIN).updatedAt;
        const vieux = Date.parse('2024-03-01');
        // Un appareil DÉJÀ synchronisé autrefois (base = son horloge), puis laissé de côté.
        const S = await ouvrir(n, 'S', {
            brouillon: { ...partition, meta: { ...partition.meta, titre: 'Périmée' } },
            etatSynchro: { 'tabhub.sync.at': vieux, 'tabhub.sync.base': vieux, 'tabhub.sync.uid': 'u1' },
        });
        const atApresRechargement = await S.p.evaluate(() => Number(localStorage.getItem('tabhub.sync.at')));
        check(atApresRechargement === vieux, 'recharger l\'appli ne rajeunit PAS l\'appareil : son horloge reste celle de sa dernière vraie modification');
        const ecrS0 = n.ecritures.filter(e => e.appareil === 'S').length;
        await connecter(S, 2200);
        check(await titre(S) === 'Cloud récent', 'un appareil périmé reprend la version du cloud au lieu de l\'écraser avec la sienne');
        check(n.ecritures.filter(e => e.appareil === 'S').length === ecrS0 && n.docs.get(CHEMIN).updatedAt === atCloud, 'et n\'écrit rien au cloud');
        // Un déplacement du curseur n'est pas une modification.
        const ecrP0 = n.ecritures.length;
        await P.p.evaluate(() => document.getElementById('zone-partition').focus());
        for (const t of ['ArrowRight', 'ArrowRight', 'ArrowLeft']) { await P.p.keyboard.press(t); await pause(P.p, 120); }
        await pause(P.p, 2800);
        check(n.ecritures.length === ecrP0, 'déplacer le curseur n\'envoie rien au cloud : ce n\'est pas une modification');
        // Une frappe réelle, si.
        await P.p.keyboard.press('5');
        await pause(P.p, 2800);
        check(n.ecritures.length === ecrP0 + 1, 'une vraie frappe date l\'appareil et part au cloud, une seule fois');
        await P.ctx.close(); await S.ctx.close();
    }

    // ================= 5. ÉDITIONS CONCURRENTES HORS LIGNE =================
    nuage.coupe.add('B');
    await tablature(B, 'Écrit sur B', [11, 12]);
    await pause(B.p, 2300);
    check(await etat(B) === 'error' || await etat(B) === 'offline', `hors ligne, la pastille le dit (${await etat(B)})`);
    await pause(A.p, 1100);
    await tablature(A, 'Écrit sur A', [21, 22, 23]);
    await pause(A.p, 2700);
    nuage.coupe.delete('B');
    await pause(B.p, 6800);   // reprise automatique : 5 s après l'échec
    check(await etat(B) === 'synced', 'le réseau revenu, B reprend TOUT SEUL, sans évènement ni nouvelle modification');
    check(await titre(A) === await titre(B) && dansNuage(nuage).meta.titre === await titre(B), 'les deux appareils et le cloud convergent sur la même version');
    const gagnantTitre = dansNuage(nuage).meta.titre;
    const perdant = gagnantTitre === 'Écrit sur A' ? 'Écrit sur B' : 'Écrit sur A';
    const secoursA = await sauvegardes(A), secoursB = await sauvegardes(B);
    check([...secoursA, ...secoursB].some(s => s.titre === perdant),
        `la version PERDANTE (« ${perdant} ») est gardée en secours — édition concurrente, personne ne perd rien`);

    // ================= 6. REMPLACEMENTS VOLONTAIRES =================
    // « Nouvelle tablature » : l'abandonnée part en secours, et le cloud suit.
    await tablature(A, 'À abandonner', [31, 32]);
    await pause(A.p, 2700);
    A.p.once('dialog', (d) => d.accept());
    await A.p.evaluate(() => window.app.nouveau());
    await pause(A.p, 2700);
    check((await sauvegardes(A)).some(s => s.titre === 'À abandonner'), '« Nouvelle tablature » met la tablature abandonnée en secours');
    // Un .json IMPORTÉ porte la date de SON dernier enregistrement : plus ancienne que celle du cloud.
    await A.p.evaluate(async () => {
        const p = JSON.parse(JSON.stringify(window.app.editeur.partition));
        p.meta.titre = 'Importée'; p.meta.modifieLe = '2019-05-05T10:00:00.000Z';
        p.mesures[0].voix[0].evenements[0].notes = [{ id: 'nI', corde: 1, frette: 99 % 24, lien: null, bend: null, ghost: false }];
        await window.app.chargerFichier(new File([JSON.stringify(p)], 'import.json', { type: 'application/json' }));
    });
    await pause(A.p, 3200);
    check(await titre(A) === 'Importée', 'un fichier importé reste affiché après la synchro : sa date ancienne ne le fait pas annuler par le cloud');
    check(dansNuage(nuage).meta.titre === 'Importée', 'et il est au cloud — c\'est la décision de l\'utilisateur, elle doit gagner');
    check(await titre(B) === 'Importée', 'et l\'autre appareil l\'a reçu');

    // ================= 7. SAUVEGARDES DE SECOURS : un filet qu'on peut atteindre =================
    await A.p.evaluate(() => window.app.ouvrirSauvegardes());
    await pause(A.p, 300);
    const panneau = await A.p.evaluate(() => ({ visible: !document.getElementById('fenetre-sauvegardes').hidden, n: document.querySelectorAll('#corps-sauvegardes [data-restaurer]').length, texte: document.getElementById('corps-sauvegardes').textContent }));
    check(panneau.visible && panneau.n >= 2, `la fenêtre liste les sauvegardes (${panneau.n})`);
    check(/À abandonner/.test(panneau.texte), 'dont la tablature abandonnée, nommée');
    const idx = await A.p.evaluate(() => [...document.querySelectorAll('#corps-sauvegardes .version-choix')].findIndex(e => /À abandonner/.test(e.textContent)));
    await A.p.click(`#corps-sauvegardes [data-restaurer="${idx}"]`);
    await pause(A.p, 3200);
    check(await titre(A) === 'À abandonner', 'restaurer une sauvegarde la remet à l\'écran');
    check(dansNuage(nuage).meta.titre === 'À abandonner' && await titre(B) === 'À abandonner',
        'et elle gagne AUSSI au cloud : sa date ancienne ne la fait pas écraser par la version « Importée »');
    check((await sauvegardes(A)).some(s => s.titre === 'Importée'), 'la version qu\'on quitte part à son tour en secours : restaurer ne coûte jamais rien');
    const dl = A.p.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await A.p.evaluate(() => window.app.ouvrirSauvegardes());
    await A.p.click('#corps-sauvegardes [data-telecharger="0"]');
    check(!!(await dl), 'chaque sauvegarde peut aussi être téléchargée en .json');
    await A.p.evaluate(() => { document.getElementById('fenetre-sauvegardes').hidden = true; });

    // Bornes : le stockage local est plafonné vers 5 Mo, les copies de secours ne doivent pas le remplir.
    const borne = await A.p.evaluate(async () => {
        const m = await import('/src/io/synchro.js?v=' + Date.now());
        const grosse = JSON.parse(JSON.stringify(window.app.editeur.partition));
        for (let i = 0; i < 12; i++) { grosse.meta.titre = 'Copie ' + i; grosse.mesures[0].voix[0].evenements[0].notes = [{ id: 'x' + i, corde: 0, frette: i, lien: null, bend: null, ghost: false }]; m.demarrerSynchro ? null : null; }
        return JSON.parse(localStorage.getItem('tabhub.backups.v1')).length;
    });
    check(borne <= 8, `jamais plus de huit copies de secours (${borne})`);

    // ================= 8. FUSION PURE =================
    const pur = await A.p.evaluate(async () => {
        const m = await import('/src/io/synchro.js?v=' + Date.now());
        const mk = (titre, frettes, at) => ({ partition: { meta: { titre, artiste: '', sousTitre: '', modifieLe: new Date(at).toISOString() },
            mesures: [{ voix: [{ evenements: frettes.map((f, i) => ({ id: 'e' + i, notes: [{ id: 'n' + i, frette: f }] })) }] }] }, at });
        const vide = { partition: { meta: { titre: 'Sans titre', artiste: '', sousTitre: '', modifieLe: new Date(9e12).toISOString() }, mesures: [{ voix: [{ evenements: [{ id: 'e', notes: [] }] }] }] }, at: 9e12 };
        const out = {};
        out.videRecent = m.fusionnerTablatures(vide, mk('Cloud', [1], 1000), null).resume.gagnant;
        out.distantVide = m.fusionnerTablatures(mk('Local', [1], 1000), { ...vide, at: 5 }, null).resume.gagnant;
        out.recent = m.fusionnerTablatures(mk('L', [1], 1000), mk('D', [2], 2000), 1000).resume.gagnant;
        out.identique = m.fusionnerTablatures(mk('L', [1], 1000), mk('L', [1], 2000), 500).changeLocal;
        const conc = m.fusionnerTablatures(mk('L', [1], 1500), mk('D', [2], 2000), 1000);
        out.concurrent = [conc.sauvegardes.length, conc.sauvegardes[0] && conc.sauvegardes[0].meta.titre];
        out.pasConcurrent = m.fusionnerTablatures(mk('L', [1], 1000), mk('D', [2], 2000), 1000).sauvegardes.length;
        out.estVide = [m.estVide(vide.partition), m.estVide(mk('Titre donné', [], 1).partition), m.estVide(mk('Sans titre', [4], 1).partition)];
        return out;
    });
    check(pur.videRecent === 'distant', 'un appareil VIDE plus récent ne prend jamais le pas sur un cloud qui a du contenu — un navigateur neuf crée son document à l\'instant');
    check(pur.distantVide === 'local', 'et un cloud vide ne prend pas le pas sur un appareil qui a du contenu');
    check(pur.recent === 'distant', 'sinon, le plus récent gagne');
    check(pur.identique === false, 'deux tablatures identiques au contenu près : rien à appliquer, même si les dates diffèrent');
    check(pur.concurrent[0] === 1 && pur.concurrent[1] === 'L', 'édition concurrente : la perdante est rendue pour être mise en secours');
    check(pur.pasConcurrent === 0, 'pas de copie de secours quand l\'une des deux est celle de la dernière synchro');
    check(JSON.stringify(pur.estVide) === '[true,false,false]', 'vide = aucune note ET aucun titre donné ; un titre seul ou une note seule suffisent à ne pas l\'être');

    // ================= 9. PANNE D'ÉCRITURE =================
    nuage.coupe.add('A');
    await tablature(A, 'Pendant la panne', [41]);
    await pause(A.p, 2700);
    check(await etat(A) === 'error', `une écriture qui échoue ne repasse JAMAIS au vert — ${await etat(A)}`);
    check((await titre(A)) === 'Pendant la panne', 'le travail reste sur l\'appareil');
    check(await A.p.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), 'fermer l\'onglet avec des modifications non envoyées est signalé');
    nuage.coupe.delete('A');
    await pause(A.p, 6500);
    check(await etat(A) === 'synced' && dansNuage(nuage).meta.titre === 'Pendant la panne', 'le réseau revenu, l\'envoi reprend tout seul');

    // ================= 10. PLAFOND =================
    const nuageGros = creerNuage();
    const G = await ouvrir(nuageGros, 'G');
    await G.p.evaluate(() => {
        const p = JSON.parse(JSON.stringify(window.app.editeur.partition));
        p.meta.titre = 'Énorme';
        const modele = JSON.stringify(p.mesures[0]);
        p.mesures = Array.from({ length: 2600 }, (_, i) => JSON.parse(modele.replace(/"id":"([a-z]+)(\w*)"/g, (m, a, b) => `"id":"${a}${b}_${i}"`)));
        p.mesures.forEach((m) => m.voix[0].evenements.forEach((e) => { e.notes = [{ id: 'k' + Math.random(), corde: 0, frette: 3, lien: null, bend: null, ghost: false }]; }));
        p.meta.modifieLe = new Date().toISOString();
        window.app.editeur.remplacer(p);
    });
    await pause(G.p, 900);
    await connecter(G, 2600);
    check(await etat(G) === 'toolarge', `au-delà du plafond, la pastille le dit au lieu d'échouer en silence — ${await etat(G)}`);
    check(!nuageGros.docs.has(CHEMIN), 'rien n\'est envoyé : un document refusé ne doit pas laisser le cloud à moitié écrit');
    check((await G.p.evaluate(() => window.app.editeur.partition.mesures.length)) === 2600, 'et la tablature reste intacte sur l\'appareil');

    // ================= 11. LA PILULE TIENT DANS LA BARRE DU HAUT, SUR TÉLÉPHONE =================
    // MESURÉ AVANT d'y mettre la pilule : à 390 px la barre n'avait que 3 px de reste. La pilule prend 36 px (le G seul) à
    // 43 px (pastille + initiale) ; sans resserrement, la barre débordait de 6 px à 360 px (13 px connecté, le logo sortant
    // de l'écran) et chaque bouton perdait 5 à 12 px de largeur. style.css reprend la place dans les marges des deux
    // séparateurs et du logo (media max-width 720px) : rien n'est retiré, ni la pilule ni un bouton.
    // Sur ordinateur : la pilule est rangée contre le logo, à la suite de Réglages et d'Aide (style.css, `order`).
    const bureau = await A.p.evaluate(() => {
        const r = (sel) => document.querySelector(sel).getBoundingClientRect();
        const compte = r('#account-info'), aide = r('#btn-aide'), logo = r('.logo');
        return { apresAide: compte.left >= aide.right - 0.5, avantLogo: compte.right <= logo.left + 0.5, memeLigne: Math.abs((compte.top + compte.height / 2) - (logo.top + logo.height / 2)) < 6 };
    });
    check(bureau.apresAide && bureau.avantLogo && bureau.memeLigne, `sur ordinateur, la pilule est à droite de la barre : à la suite de Réglages/Aide, contre le logo (${JSON.stringify(bureau)})`);
    {
        const html = require('fs').readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
        const a = html.indexOf('src="compte-cloud.js'), b = html.indexOf('src="synchro-cloud.js');
        check(a > 0 && b > a, 'index.html charge compte-cloud.js AVANT synchro-cloud.js : le moteur parle au composant dès sa première réponse');
    }
    for (const largeur of [360, 390]) {
        const T = await ouvrir(creerNuage(), 'T' + largeur, { viewport: { width: largeur, height: 844 }, tactile: true });
        const geo = () => T.p.evaluate(() => {
            const bar = document.querySelector('.barre-haut');
            const boutons = [...bar.querySelectorAll('button')].filter(b => !b.closest('#compte-cloud') && b.getBoundingClientRect().width > 0);
            const logo = document.querySelector('.logo').getBoundingClientRect();
            const compte = [...document.querySelectorAll('#compte-cloud button')].find(b => b.getBoundingClientRect().width > 0).getBoundingClientRect();
            return {
                debordeBarre: bar.scrollWidth - bar.clientWidth, debordePage: document.documentElement.scrollWidth - innerWidth,
                horsEcran: [...bar.children].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5); }).length,
                largeurMin: Math.round(Math.min(...boutons.map(b => b.getBoundingClientRect().width))),
                hauteurMin: Math.round(Math.min(...boutons.map(b => b.getBoundingClientRect().height))),
                pilule: [Math.round(compte.width), Math.round(compte.height)], chevauche: compte.right > logo.left + 0.5,
            };
        });
        await T.p.click('#cloud-guard-continue');            // la fenêtre d'accueil d'abord : « continuer sans compte »
        const avant = await geo();
        await connecter(T);
        const apres = await geo();
        const tient = (g) => g.debordeBarre <= 0 && g.debordePage <= 0 && g.horsEcran === 0;
        check(tient(avant), `${largeur} px, sans compte : la barre du haut ne déborde pas et rien ne sort de l'écran (${JSON.stringify(avant)})`);
        check(tient(apres), `${largeur} px, connecté : idem, avec le nom du compte réduit à son initiale (${JSON.stringify(apres)})`);
        check(avant.pilule[0] >= 32 && avant.pilule[1] >= 32 && apres.pilule[0] >= 32 && apres.pilule[1] >= 32 && !avant.chevauche && !apres.chevauche,
            `la pilule se vise au doigt (${avant.pilule.join('×')} puis ${apres.pilule.join('×')}) et ne chevauche pas le logo`);
        check(avant.largeurMin >= 32 && apres.largeurMin >= 32 && avant.hauteurMin >= 44 && apres.hauteurMin >= 44,
            `les boutons voisins cèdent de la LARGEUR (au plus à ${apres.largeurMin} px, 44 px avant la pilule) mais gardent leur HAUTEUR au doigt (${apres.hauteurMin} px)`);
        await T.ctx.close();
    }

    // ================= 12. DÉCONNEXION =================
    await deconnecter(B.p);
    await pause(B.p, 500);
    check(await B.p.isVisible('#google-signin-btn') && await B.p.isHidden('#account-info') && await B.p.isHidden('#cloud-menu'),
        'se déconnecter remet « Se connecter », masque la pastille du compte et referme le menu');
    const ecrAvant = nuage.ecritures.length;
    await tablature(B, 'Déconnecté', [12]);
    await pause(B.p, 2600);
    check(nuage.ecritures.length === ecrAvant, 'déconnecté, plus rien ne part au cloud');
    check((await notes(B)).join() === '12', 'et la tablature reste sur l\'appareil');

    // ================= 13. LA FENÊTRE DE CONNEXION (compte-cloud.js, commune aux trois applis) =================
    // « Propose la fenêtre connexion lorsqu'aucun utilisateur n'est connecté. » Une seule fois par ONGLET, qu'elle vienne de
    // l'ouverture ou de la première modification ; plus jamais si l'on a demandé de ne plus la proposer.
    const nouvelOnglet = async (d) => {
        const p = await d.ctx.newPage();
        p.on('pageerror', (e) => erreurs.push(`${d.nom}+ pageerror: ${e.message}`));
        await p.goto(`${BASE}/index.html?nocache=` + Date.now(), { waitUntil: 'load', timeout: 20000 });
        await p.waitForFunction(() => window.app && window.app.page, null, { timeout: 20000 });
        await pause(p, 900);
        return { ctx: d.ctx, p, nom: d.nom + '+' };
    };
    // Une VRAIE frappe : c'est elle qui passe par planifier() et déclenche, ou non, le garde-fou.
    const frapper = async (d) => { await d.p.evaluate(() => document.getElementById('zone-partition').focus()); await d.p.keyboard.press('5'); await pause(d.p, 300); };
    const GF = await ouvrir(creerNuage(), 'GF');
    check(await GF.p.isVisible('#cloud-guard-modal') && await GF.p.getAttribute('#cloud-guard-modal', 'data-raison') === 'accueil',
        'à l\'ouverture, sans compte : la fenêtre de connexion est PROPOSÉE');
    // Le début de la phrase seulement : l'accord de « enregistrés » appartient au fichier partagé (écrit pour « morceaux »), qu'une
    // appli ne modifie pas — voir docs/fichiers-partages.md.
    check(/tes tablatures sont enregistr/.test(await GF.p.textContent('#cloud-guard-modal')),
        'elle dit ce que la connexion apporte, avec les mots de l\'appli (« tes tablatures »)');
    check(await GF.p.isVisible('#cloud-guard-connect') && await GF.p.isVisible('#cloud-guard-continue'), 'avec deux issues : se connecter, ou continuer sans compte');
    await GF.p.click('#cloud-guard-continue');
    check(await GF.p.isHidden('#cloud-guard-modal') && await GF.p.isVisible('#google-signin-btn'),
        '« continuer sans compte » referme la fenêtre, et la pilule « Se connecter » reste là pour plus tard');
    await frapper(GF);
    check(await GF.p.isHidden('#cloud-guard-modal'), 'on ne REDEMANDE pas à la première modification : une seule fenêtre par onglet');
    await pause(GF.p, 1500);   // le brouillon s'écrit avec un petit délai : on attend qu'il soit sur le disque avant de recharger
    await GF.p.reload({ waitUntil: 'load' }); await GF.p.waitForFunction(() => window.app && window.app.page); await pause(GF.p, 900);
    check(await GF.p.isHidden('#cloud-guard-modal'), 'ni au rechargement de la page dans le même onglet');
    check((await notes(GF)).length > 0, 'le travail n\'a jamais été bloqué : la frappe est dans la tablature');
    const GFb = await nouvelOnglet(GF);
    check(await GFb.p.isVisible('#cloud-guard-modal'), 'un NOUVEL onglet (nouvelle ouverture de l\'appli) la propose de nouveau');
    await GFb.p.click('#cloud-guard-modal', { position: { x: 4, y: 4 } });   // cliquer à côté = continuer : on ne bloque jamais le travail
    check(await GFb.p.isHidden('#cloud-guard-modal'), 'cliquer à côté referme aussi');
    await GF.ctx.close();

    // « Ne plus me le proposer sur cet appareil »
    const GF2 = await ouvrir(creerNuage(), 'GF2');
    await GF2.p.check('#cloud-guard-ne-plus');
    await GF2.p.click('#cloud-guard-continue');
    const GF2b = await nouvelOnglet(GF2);
    check(await GF2b.p.isHidden('#cloud-guard-modal'), '« ne plus me le proposer » : un nouvel onglet ne la propose plus');
    await frapper(GF2b);
    check(await GF2b.p.isHidden('#cloud-guard-modal') && await GF2b.p.isVisible('#google-signin-btn'),
        'ni à la première modification — et la connexion reste possible par la pilule');
    await GF2.ctx.close();

    // « Se connecter » depuis la fenêtre : la fenêtre Google part de CE clic. `persister` : la session survit, comme le vrai Firebase.
    const GF3 = await ouvrir(creerNuage(), 'GF3', { persister: true });
    await GF3.p.click('#cloud-guard-connect');
    await pause(GF3.p, 1500);
    check(await GF3.p.evaluate(() => window.__faux.fenetresGoogle) === 1, 'le bouton de la fenêtre ouvre la connexion Google (depuis le clic, sans quoi le navigateur la bloquerait)');
    check(await etat(GF3) === 'synced', 'et la synchro démarre aussitôt');
    const GF3b = await nouvelOnglet(GF3);
    await frapper(GF3b);
    check(await GF3b.p.isHidden('#cloud-guard-modal'), 'déjà connecté (nouvel onglet, session relue) : jamais de fenêtre, ni à l\'ouverture ni à la frappe');
    await deconnecter(GF3b.p); await pause(GF3b.p, 500);
    check(await GF3b.p.isHidden('#cloud-guard-modal'), 'se déconnecter n\'ouvre pas la fenêtre d\'accueil');
    await frapper(GF3b);
    check(await GF3b.p.isVisible('#cloud-guard-modal') && await GF3b.p.getAttribute('#cloud-guard-modal', 'data-raison') === 'modification' && /pas enregistré dans le cloud/.test(await GF3b.p.textContent('#cloud-guard-modal')),
        'déconnecté puis modifiant : le garde-fou « tu n\'es pas connecté » s\'ouvre, et dit ce qu\'on risque');
    await GF3b.p.keyboard.press('Escape');
    check(await GF3b.p.isHidden('#cloud-guard-modal'), 'Échap referme (= continuer)');
    await GF3.ctx.close();

    check(pannes.length > 0, 'les pannes simulées ont bien été consignées en console');
    check(erreurs.length === 0, `aucune autre erreur — ${erreurs.slice(0, 2).join(' | ')}`);
    await navigateur.close();
    bilan();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
