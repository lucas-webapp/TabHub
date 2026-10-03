// Banc du MOTEUR DE SYNCHRO (src/io/nuage.js) — sans navigateur, deux « appareils » sur un même nuage.
//
// CE QU'IL PROTÈGE. Retour utilisateur : « l'enregistrement me semble trop aléatoire [...] on va
// connecter tous les documents à mon Firebase ». Une synchro n'a de valeur que si elle est PRÉVISIBLE :
// chaque scénario ci-dessous est un moment où une synchro naïve perd ou écrase quelque chose sans le
// dire — et c'est précisément ce qu'on n'accepte pas d'un outil qui garde le travail d'un musicien.
//
// LES SCÉNARIOS, dans l'ordre où ils font mal :
//   • premier envoi, puis un second appareil vide qui récupère tout ;
//   • une modification qui voyage — et ne RENVOIE PAS en écho (une synchro qui s'emballe coûte des
//     écritures, donc de l'argent, et masque les vrais conflits) ;
//   • un CONFLIT : les deux côtés ont changé. Le plus récent gagne, l'autre est gardé en copie ;
//   • une suppression : le contenu reste dans le nuage, l'autre appareil retire avec un secours ;
//   • une suppression de MASSE (stockage vidé, bogue) : refusée ;
//   • un morceau supprimé ailleurs puis modifié ici : il revient (le travail ne se perd pas) ;
//   • un instantané HORS LIGNE : pris pour un nuage vide, il ferait tout renvoyer par-dessus le vrai ;
//   • des droits refusés, un morceau trop gros : dits clairement, sans bloquer le reste ;
//   • un contenu que Firestore refuserait tel quel (tableaux imbriqués) : il voyage en chaîne JSON ;
//   • le GARDE-FOU « tu travailles sans être connecté » : demandé une fois par séance, jamais à quelqu'un
//     qui est connecté (ni à quelqu'un dont Firebase n'a pas encore dit s'il l'est), jamais quand le nuage
//     n'existe pas ici, et la fenêtre Google se lance DANS le geste du clic.
//
// NEUTRALISATIONS faites à la main sur la source (voir la fin du fichier pour ce qu'elles prouvent).

const creerHarnais = require('./_harness.js');
const { check, exiger, plan, bilan } = creerHarnais('moteur de synchro');
const { creerBackend, creerFirebase } = require('./_firebase_factice.js');
require('../src/io/nuage.js');
const Nuage = globalThis.Nuage;

const attendre = (ms) => new Promise(r => setTimeout(r, ms));
async function jusqua(cond, ms = 2000) {
    const fin = Date.now() + ms;
    while (Date.now() < fin) { if (cond()) return true; await attendre(8); }
    return !!cond();
}

function stockageMemoire() {
    const m = {};
    return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, _m: m };
}

/** Un appareil : ses morceaux, son stockage, son moteur — et des adaptateurs comme ceux de HarmoHub. */
function appareil(nom, backend, options = {}) {
    const docs = options.docs || {};
    const stockage = options.stockage || stockageMemoire();
    const etats = [];
    const fb = creerFirebase(backend, { uid: options.uid || 'u1', ...(options.compte || {}) });
    let compteurCopie = 0;
    const apresAppels = { n: 0 };
    const adaptateur = {
        miroirComplet: options.miroirComplet !== false,
        suppressionParDisparition: options.suppressionParDisparition !== false,
        lister: () => Object.values(docs).map(d => ({ id: d.id, titre: d.titre, donnees: d })),
        lire: (id) => docs[id],
        ecrire: (id, donnees) => { docs[id] = JSON.parse(JSON.stringify(donnees)); },
        retirer: (id) => { delete docs[id]; },
        // La date d'enregistrement ne compte pas comme une modification de contenu.
        empreinte: (d) => JSON.stringify({ ...d, savedAt: undefined }),
        maj: (d) => d.savedAt,
        nouvelleCopie: (d, suffixe) => {
            const id = d.id + '-copie' + (++compteurCopie);
            return { id, titre: d.titre + suffixe, donnees: { ...d, id, titre: d.titre + suffixe } };
        },
        occupe: options.occupe,
        apres: () => { apresAppels.n++; },
    };
    const moteur = Nuage.creer({
        slug: 'harmohub', firebase: fb, config: {}, stockage, adaptateur,
        delaiEnvoi: 10, reessais: [25, 25, 25],
        surEtat: (mode, message) => etats.push({ mode, message }),
        ...(options.moteur || {}),
    });
    return { nom, docs, stockage, etats, moteur, fb, adaptateur, backend, apresAppels };
}

const morceau = (id, contenu, savedAt = 1000) => ({ id, titre: 'Titre ' + id, contenu, savedAt });
const chemin = (uid, suffixe) => `users/${uid}/apps/harmohub${suffixe ? '__' + suffixe : ''}`;
const dernier = (a) => a.etats[a.etats.length - 1];

async function connecter(a, attendreSynchro = true) {
    a.moteur.demarrer();
    await attendre(5);
    await a.fb.auth()._connecter();
    if (attendreSynchro) await jusqua(() => dernier(a) && dernier(a).mode === 'synced', 1500);
}

(async () => {
    plan(117);

    // ===== 1. PREMIER ENVOI, PUIS UN SECOND APPAREIL VIDE ==========================================
    {
        const backend = creerBackend();
        const A = appareil('A', backend, { docs: { s1: morceau('s1', 'un'), s2: morceau('s2', 'deux'), s3: morceau('s3', 'trois') } });
        await connecter(A);
        check(dernier(A).mode === 'synced', 'premier envoi : l\'état final est « synchronisé »');
        const idx = backend.docs[chemin('u1')];
        exiger(!!idx, 'l\'index existe dans le nuage');
        check(Object.keys(idx.docs).length === 3 && Object.values(idx.docs).every(e => e.d === false && typeof e.u === 'number'),
            'l\'index liste les 3 morceaux, aucun marqué supprimé (d:false explicite)');
        const d1 = backend.docs[chemin('u1', 's1')];
        check(d1 && typeof d1.json === 'string' && JSON.parse(d1.json).contenu === 'un' && d1.donnees === undefined,
            'un morceau voyage en CHAÎNE JSON, pas en structure (Firestore refuse les tableaux imbriqués)');

        const B = appareil('B', backend);
        await connecter(B);
        check(Object.keys(B.docs).sort().join() === 's1,s2,s3' && B.docs.s2.contenu === 'deux',
            'un second appareil VIDE récupère les trois morceaux, contenu compris');
        check(JSON.stringify(B.docs.s1) === JSON.stringify(A.docs.s1), 'et à l\'identique (octet pour octet)');
        check(B.apresAppels.n === 1, `l'application est prévenue UNE fois pour tout le lot reçu (${B.apresAppels.n} appel pour 3 morceaux) — pas un rafraîchissement d'interface par morceau`);
        check(A.apresAppels.n === 0, 'et jamais pour un envoi : rien n\'a changé ici, il n\'y a rien à rafraîchir');

        // ===== 2. UNE MODIFICATION VOYAGE, SANS ÉCHO ===============================================
        A.docs.s1 = morceau('s1', 'un, modifié', 2000);
        const avant = backend.ecritures;
        A.moteur.changement();
        const arrive = await jusqua(() => B.docs.s1.contenu === 'un, modifié', 1500);
        check(arrive, 'une modification faite sur A arrive sur B toute seule');
        await attendre(150);
        const apres = backend.ecritures;
        check(apres - avant === 2, `elle coûte UN envoi (document + index = 2 écritures, ${apres - avant} constatées)`);
        await attendre(150);
        check(backend.ecritures === apres, 'et RIEN ne repart en écho : B n\'a rien renvoyé après avoir reçu');
        for (let i = 0; i < 3; i++) await A.moteur.rapprocher();
        await attendre(50);
        check(backend.ecritures === apres, 'rapprocher() à répétition ne réécrit rien (idempotent)');
        check(!A.moteur.enAttente() && !B.moteur.enAttente(), 'plus rien « en attente » une fois tout posé');

        // ===== 3. SUPPRESSION ======================================================================
        delete A.docs.s3;
        A.moteur.changement();
        const retire = await jusqua(() => !('s3' in B.docs), 1500);
        check(retire, 'un morceau supprimé sur A disparaît de B');
        const tomb = backend.docs[chemin('u1')].docs['s3'];
        check(tomb && tomb.d === true, 'l\'index le marque supprimé…');
        const contenuRestant = backend.docs[chemin('u1', 's3')];
        check(contenuRestant && JSON.parse(contenuRestant.json).contenu === 'trois',
            '…mais SON CONTENU reste dans le nuage : une erreur de suppression se rattrape');
        const sec = B.moteur.secours();
        check(sec.some(e => e.id === 's3' && /Supprimé/.test(e.raison) && JSON.parse(e.json).contenu === 'trois'),
            'et B en a gardé une copie de secours avant de le retirer');

        A.moteur.arreter(); B.moteur.arreter();
    }

    // ===== 4. CONFLIT : LE PLUS RÉCENT GAGNE, L'AUTRE EST GARDÉ ====================================
    {
        const backend = creerBackend();
        const A = appareil('A', backend, { docs: { s1: morceau('s1', 'base', 1000) } });
        await connecter(A);
        const stockB = stockageMemoire();
        const docsB = {};
        let B = appareil('B', backend, { docs: docsB, stockage: stockB });
        await connecter(B);
        check(docsB.s1 && docsB.s1.contenu === 'base', 'préalable : B a bien reçu le morceau de base');
        B.moteur.arreter();                                          // B se déconnecte (hors ligne, fermé…)
        A.docs.s1 = morceau('s1', 'version de A', 5000);
        A.moteur.changement();
        await jusqua(() => backend.docs[chemin('u1', 's1')] && JSON.parse(backend.docs[chemin('u1', 's1')].json).contenu === 'version de A');
        docsB.s1 = morceau('s1', 'version de B', 3000);              // B a modifié, AVANT A (savedAt plus ancien)
        B = appareil('B', backend, { docs: docsB, stockage: stockB });
        await connecter(B);
        await attendre(100);
        check(docsB.s1.contenu === 'version de A', 'CONFLIT, A plus récent : la version de A gagne sur B');
        const copies = Object.values(docsB).filter(d => d.id !== 's1');
        check(copies.length === 1 && copies[0].contenu === 'version de B' && /conflit/.test(copies[0].titre),
            'et la version de B n\'est PAS perdue : elle devient une copie « (conflit …) »');
        check(B.moteur.secours().some(e => /Conflit/.test(e.raison) && JSON.parse(e.json).contenu === 'version de B'),
            'avec une sauvegarde de secours en plus');
        await jusqua(() => Object.keys(backend.docs[chemin('u1')].docs).length === 2, 1500);
        check(Object.keys(backend.docs[chemin('u1')].docs).length === 2, 'la copie de conflit est elle-même envoyée dans le nuage');
        await jusqua(() => Object.keys(A.docs).length === 2, 1500);
        check(Object.keys(A.docs).length === 2, 'et arrive sur A : les deux versions sont visibles partout');
        A.moteur.arreter(); B.moteur.arreter();
    }
    {
        // L'autre sens : B modifie APRÈS A, B gagne et la version du nuage est gardée.
        const backend = creerBackend();
        const A = appareil('A', backend, { docs: { s1: morceau('s1', 'base', 1000) } });
        await connecter(A);
        const stockB = stockageMemoire(); const docsB = {};
        let B = appareil('B', backend, { docs: docsB, stockage: stockB });
        await connecter(B);
        B.moteur.arreter();
        A.docs.s1 = morceau('s1', 'version de A', 2000); A.moteur.changement();
        await jusqua(() => JSON.parse(backend.docs[chemin('u1', 's1')].json).contenu === 'version de A');
        docsB.s1 = morceau('s1', 'version de B', Date.now() + 10000);    // B, plus récent
        B = appareil('B', backend, { docs: docsB, stockage: stockB });
        await connecter(B);
        await jusqua(() => JSON.parse(backend.docs[chemin('u1', 's1')].json).contenu === 'version de B', 1500);
        check(JSON.parse(backend.docs[chemin('u1', 's1')].json).contenu === 'version de B', 'CONFLIT, B plus récent : la version de B gagne dans le nuage');
        check(Object.values(docsB).some(d => d.id !== 's1' && d.contenu === 'version de A'), 'et celle de A est gardée en copie');
        A.moteur.arreter(); B.moteur.arreter();
    }

    // ===== 5. JAMAIS SYNCHRONISÉ DES DEUX CÔTÉS : LE NUAGE FAIT FOI ================================
    {
        const backend = creerBackend();
        const A = appareil('A', backend, { docs: { s1: morceau('s1', 'du nuage', 1000) } });
        await connecter(A);
        // Horodatage LOCAL dans le futur (horloge déréglée) : ce n'est pas lui qui doit décider.
        const B = appareil('B', backend, { docs: { s1: morceau('s1', 'vieille copie locale', Date.now() + 10 * 86400000) } });
        await connecter(B);
        await attendre(100);
        check(B.docs.s1.contenu === 'du nuage', 'un morceau JAMAIS synchronisé ici mais présent dans le nuage : le nuage fait foi');
        check(Object.values(B.docs).some(d => d.id !== 's1' && d.contenu === 'vieille copie locale'),
            'et la copie locale est gardée à côté, jamais jetée');
        A.moteur.arreter(); B.moteur.arreter();
    }

    // ===== 6. SUPPRESSION DE MASSE REFUSÉE =========================================================
    {
        const backend = creerBackend();
        const docs = {};
        for (let i = 1; i <= 6; i++) docs['m' + i] = morceau('m' + i, 'contenu ' + i);
        const A = appareil('A', backend, { docs });
        await connecter(A);
        for (const k of Object.keys(docs)) delete docs[k];           // le stockage local est vidé d'un coup
        A.moteur.changement();
        await jusqua(() => dernier(A).mode === 'error', 1500);
        check(dernier(A).mode === 'error' && /massive/.test(dernier(A).message),
            'six morceaux disparus d\'un coup : refusé, et dit clairement (« suppression massive »)');
        const tombes = Object.values(backend.docs[chemin('u1')].docs).filter(e => e.d === true).length;
        check(tombes === 0, 'AUCUN morceau n\'est marqué supprimé dans le nuage');
        await jusqua(() => Object.keys(docs).length === 6, 1500);
        check(Object.keys(docs).length === 6, 'et ils REVIENNENT depuis le nuage au rapprochement suivant');
        A.moteur.arreter();
    }

    // ===== 7. SUPPRIMÉ AILLEURS, MODIFIÉ ICI : IL REVIENT ==========================================
    {
        const backend = creerBackend();
        const A = appareil('A', backend, { docs: { s1: morceau('s1', 'base'), s2: morceau('s2', 'autre') } });
        await connecter(A);
        const stockB = stockageMemoire(); const docsB = {};
        let B = appareil('B', backend, { docs: docsB, stockage: stockB });
        await connecter(B);
        B.moteur.arreter();
        delete A.docs.s1; A.moteur.changement();
        await jusqua(() => backend.docs[chemin('u1')].docs.s1.d === true, 1500);
        docsB.s1 = morceau('s1', 'travail fait pendant ce temps', 7000);   // B a retravaillé le morceau
        B = appareil('B', backend, { docs: docsB, stockage: stockB });
        await connecter(B);
        await jusqua(() => backend.docs[chemin('u1')].docs.s1.d === false, 1500);
        check(backend.docs[chemin('u1')].docs.s1.d === false, 'supprimé ailleurs mais modifié ici : le drapeau de suppression est RETIRÉ (d:false explicite)');
        check(JSON.parse(backend.docs[chemin('u1', 's1')].json).contenu === 'travail fait pendant ce temps', 'avec le contenu retravaillé');
        await jusqua(() => A.docs.s1 && A.docs.s1.contenu === 'travail fait pendant ce temps', 1500);
        check(!!A.docs.s1 && A.docs.s1.contenu === 'travail fait pendant ce temps', 'et A le retrouve : un travail n\'est jamais supprimé par un autre appareil');
        A.moteur.arreter(); B.moteur.arreter();
    }

    // ===== 8. HORS LIGNE : L'INSTANTANÉ DU CACHE N'EST PAS LE NUAGE ================================
    {
        const backend = creerBackend();
        const A = appareil('A', backend, { docs: { s1: morceau('s1', 'du nuage') } });
        await connecter(A);
        A.moteur.arreter();
        // Nouvel appareil hors ligne, avec son propre morceau : il ne doit RIEN envoyer.
        backend.horsLigne = true;
        const avant = backend.ecritures;
        const C = appareil('C', backend, { docs: { x1: morceau('x1', 'écrit dans le train') } });
        await connecter(C, false);
        await attendre(150);
        check(dernier(C).mode === 'hors-ligne', 'hors ligne : l\'état affiché le dit (« hors-ligne »), pas « synchronisé »');
        check(backend.ecritures === avant, 'et RIEN n\'est envoyé sur la foi d\'un cache qu\'on prendrait pour un nuage vide');
        check(C.docs.x1 && C.docs.x1.contenu === 'écrit dans le train', 'le travail local reste intact');
        backend.horsLigne = false;
        backend.notifier(chemin('u1'));                               // le réseau revient : le vrai index arrive
        await jusqua(() => backend.docs[chemin('u1', 'x1')] !== undefined && C.docs.s1 !== undefined, 2000);
        check(backend.docs[chemin('u1', 'x1')] !== undefined, 'au retour du réseau, ce qui a été écrit hors ligne part');
        check(C.docs.s1 && C.docs.s1.contenu === 'du nuage', 'et ce qui a été fait ailleurs arrive, sans rien écraser');
        C.moteur.arreter();
    }

    // ===== 9. DROITS REFUSÉS ET RÉESSAI ============================================================
    {
        const backend = creerBackend();
        const A = appareil('A', backend, { docs: { s1: morceau('s1', 'un') } });
        await connecter(A);
        backend.echec = { code: 'permission-denied', message: 'Missing or insufficient permissions.' };
        A.docs.s1 = morceau('s1', 'modifié');
        A.moteur.changement();
        await jusqua(() => dernier(A).mode === 'error', 1500);
        check(dernier(A).mode === 'error' && /règles/.test(dernier(A).message),
            'droits refusés : l\'erreur est EXPLIQUÉE (les règles de sécurité), pas un « erreur inconnue »');
        check(A.docs.s1.contenu === 'modifié', 'le travail local n\'est pas touché');
        check(A.moteur.enAttente(), 'et la fermeture de l\'application serait signalée (un envoi est en échec)');
        backend.echec = null;
        await jusqua(() => JSON.parse(backend.docs[chemin('u1', 's1')].json).contenu === 'modifié', 2000);
        check(JSON.parse(backend.docs[chemin('u1', 's1')].json).contenu === 'modifié', 'le réseau revient : l\'envoi est REPRIS tout seul');
        await jusqua(() => dernier(A).mode === 'synced', 1000);
        check(dernier(A).mode === 'synced', 'et l\'état repasse à « synchronisé »');
        A.moteur.arreter();
    }

    // ===== 10. UN MORCEAU TROP GROS NE BLOQUE PAS LES AUTRES =======================================
    {
        const backend = creerBackend();
        const A = appareil('A', backend, { docs: { gros: morceau('gros', 'x'.repeat(1000 * 1024)), petit: morceau('petit', 'ok') } });
        await connecter(A, false);
        await jusqua(() => backend.docs[chemin('u1', 'petit')] !== undefined, 1500);
        check(backend.docs[chemin('u1', 'petit')] !== undefined, 'un morceau trop gros (plus de 900 Ko) : les autres partent quand même');
        await jusqua(() => dernier(A).mode === 'error', 1500);
        check(dernier(A).mode === 'error' && /trop gros/.test(dernier(A).message) && /Titre gros/.test(dernier(A).message),
            'et le problème est nommé : quel morceau, et pourquoi');
        check(backend.docs[chemin('u1', 'gros')] === undefined, 'le gros n\'est pas envoyé à moitié');
        A.moteur.arreter();
    }

    // ===== 11. IDENTIFIANTS DE TABHUB (dates ISO) ET CONTENU À TABLEAUX IMBRIQUÉS ==================
    {
        const backend = creerBackend();
        const idIso = '2026-09-16T07:42:13.123Z';
        const docs = { [idIso]: { id: idIso, titre: 'Riff', contenu: [[1, 2], [3, [4, 5]]], savedAt: 1 } };
        const A = appareil('A', backend, { docs });
        await connecter(A);
        const chemins = Object.keys(backend.docs).filter(c => c !== chemin('u1'));
        check(chemins.length === 1 && !/[:.]/.test(chemins[0].split('__')[1]),
            'un identifiant en date ISO devient un nom de document valide (ni « : » ni « . »)');
        const B = appareil('B', backend);
        await connecter(B);
        check(B.docs[idIso] && JSON.stringify(B.docs[idIso].contenu) === '[[1,2],[3,[4,5]]]',
            'l\'identifiant d\'origine et des tableaux imbriqués traversent intacts');
        A.moteur.arreter(); B.moteur.arreter();
    }

    // ===== 12. CHANGER DE COMPTE ===================================================================
    {
        const backend = creerBackend();
        const stock = stockageMemoire();
        const docs = { s1: morceau('s1', 'à moi') };
        const A = appareil('A', backend, { docs, stockage: stock, uid: 'u1' });
        await connecter(A);
        A.moteur.arreter();
        const A2 = appareil('A2', backend, { docs, stockage: stock, uid: 'u2' });
        await connecter(A2);
        await jusqua(() => backend.docs[chemin('u2', 's1')] !== undefined, 1500);
        check(backend.docs[chemin('u2', 's1')] !== undefined, 'un AUTRE compte sur le même appareil repart de zéro : les morceaux lui sont envoyés, sans état hérité de l\'autre');
        check(backend.docs[chemin('u1')] !== undefined && backend.docs[chemin('u2')] !== undefined, 'chaque compte a son propre index');
        A2.moteur.arreter();
    }

    // ===== 13. MODE TABHUB : ON LISTE, ON N'OUVRE PAS D'OFFICE ====================================
    {
        const backend = creerBackend();
        const A = appareil('A', backend, { docs: { s1: morceau('s1', 'un'), s2: morceau('s2', 'deux') } });
        await connecter(A);
        const B = appareil('B', backend, { miroirComplet: false, suppressionParDisparition: false });
        await connecter(B);
        await attendre(100);
        check(Object.keys(B.docs).length === 0, 'sans miroir complet (TabHub), un appareil neuf n\'ouvre pas d\'office toute la bibliothèque');
        check(B.moteur.catalogue().map(e => e.id).sort().join() === 's1,s2', 'mais il la LISTE (catalogue)');
        await B.moteur.ouvrirDistant('s2');
        check(B.docs.s2 && B.docs.s2.contenu === 'deux', 'et en ouvre un à la demande');
        // Fermer un onglet (disparition locale) n'est PAS supprimer.
        delete B.docs.s2; B.moteur.changement(); await attendre(120);
        check(backend.docs[chemin('u1')].docs.s2.d === false, 'fermer un morceau ici ne le supprime pas du nuage');
        await B.moteur.supprimer('s2', 'Titre s2');
        check(backend.docs[chemin('u1')].docs.s2.d === true, 'seule la suppression VOULUE (bouton) le marque supprimé');
        A.moteur.arreter(); B.moteur.arreter();
    }

    // ===== 14. LE MORCEAU EN COURS DE MODIFICATION N'EST PAS REMPLACÉ SOUS LES DOIGTS =============
    {
        const backend = creerBackend();
        const A = appareil('A', backend, { docs: { s1: morceau('s1', 'base') } });
        await connecter(A);
        let occupe = true;
        const B = appareil('B', backend, { occupe: (id) => occupe && id === 's1' });
        await connecter(B);
        await attendre(100);
        check(!B.docs.s1 || B.docs.s1.contenu === 'base', 'préalable : B a le morceau (ou l\'attend)');
        A.docs.s1 = morceau('s1', 'modifié par A', 3000); A.moteur.changement();
        await jusqua(() => JSON.parse(backend.docs[chemin('u1', 's1')].json).contenu === 'modifié par A');
        await attendre(150);
        check(!B.docs.s1 || B.docs.s1.contenu !== 'modifié par A', 'un morceau que l\'on est en train de modifier n\'est pas remplacé en douce');
        occupe = false;
        B.moteur.changement();
        await jusqua(() => B.docs.s1 && B.docs.s1.contenu === 'modifié par A', 1500);
        check(B.docs.s1 && B.docs.s1.contenu === 'modifié par A', 'mais il est repris dès qu\'on lâche la main');
        A.moteur.arreter(); B.moteur.arreter();
    }

    // ===== 14 bis. L'INDEX N'EST PAS ENCORE ARRIVÉ : ON N'ENVOIE RIEN PAR-DESSUS ====================
    {
        // Le cas du DÉMARRAGE : l'appli charge ses morceaux et annonce un changement avant que le
        // nuage ait répondu. Un moteur qui se fie à son index vide croit le nuage vide et écrase une
        // version plus récente qu'il n'a jamais vue — sans conflit, sans copie.
        const backend = creerBackend();
        const A = appareil('A', backend, { docs: { s1: morceau('s1', 'base', 1000) } });
        await connecter(A);
        const stock = A.stockage; const docsA = A.docs;
        A.moteur.arreter();
        const C = appareil('C', backend);                         // un autre appareil met à jour le nuage
        await connecter(C);
        C.docs.s1 = morceau('s1', 'version récente de C', 4000); C.moteur.changement();
        await jusqua(() => JSON.parse(backend.docs[chemin('u1', 's1')].json).contenu === 'version récente de C');
        docsA.s1 = morceau('s1', 'modifié sur A hors ligne', 3000);
        backend.retardInstantane = 200;                           // réseau lent : l'index arrivera en retard
        const A2 = appareil('A2', backend, { docs: docsA, stockage: stock });
        A2.moteur.demarrer(); await attendre(5);
        await A2.fb.auth()._connecter();
        // Connecté pour de bon (la notification d'auth est différée) : sans cette attente,
        // changement() serait un no-op et le scénario ne prouverait rien.
        await jusqua(() => A2.moteur.etat().connecte, 500);
        exiger(A2.moteur.etat().connecte, 'préalable : A2 est bien connecté avant d\'annoncer le changement');
        A2.moteur.changement();                                   // annoncé AVANT l'arrivée de l'index
        await attendre(80);
        check(JSON.parse(backend.docs[chemin('u1', 's1')].json).contenu === 'version récente de C',
            'index pas encore arrivé : rien n\'est envoyé par-dessus (la version de C est intacte dans le nuage)');
        await jusqua(() => dernier(A2) && dernier(A2).mode === 'synced', 2000);
        await attendre(100);
        const tout = [JSON.parse(backend.docs[chemin('u1', 's1')].json).contenu, ...Object.values(docsA).map(d => d.contenu)];
        check(tout.includes('version récente de C') && tout.includes('modifié sur A hors ligne'),
            'et quand il arrive, le conflit est traité : AUCUNE des deux versions n\'est perdue');
        backend.retardInstantane = 0;
        A2.moteur.arreter(); C.moteur.arreter();
    }

    // ===== 14 ter. MÊME CONTENU DES DEUX CÔTÉS : PAS DE CONFLIT POUR RIEN ==========================
    {
        const backend = creerBackend();
        const A = appareil('A', backend, { docs: { s1: morceau('s1', 'identique', 1000) } });
        await connecter(A);
        const B = appareil('B', backend, { docs: { s1: morceau('s1', 'identique', 2500) } });   // jamais synchronisé, même contenu
        const avant = backend.ecritures;
        await connecter(B);
        await attendre(120);
        check(Object.keys(B.docs).length === 1 && backend.ecritures === avant,
            'jamais synchronisé ici mais IDENTIQUE au nuage : pas de copie « conflit », pas une écriture');
        A.moteur.arreter(); B.moteur.arreter();
    }

    // ===== 14 quater. LE COMPTE CHANGE : L'ÉTAT D'UN AUTRE COMPTE NE COMPTE PAS ====================
    {
        const backend = creerBackend();
        const stock = stockageMemoire(); const docs = { s1: morceau('s1', 'à moi') };
        const A = appareil('A', backend, { docs, stockage: stock, uid: 'u1' });
        await connecter(A); A.moteur.arreter();
        // Le compte u2 a déjà SON morceau s1, différent.
        const autre = appareil('Z', backend, { docs: { s1: morceau('s1', 'celui de u2') }, uid: 'u2' });
        await connecter(autre); autre.moteur.arreter();
        const A2 = appareil('A2', backend, { docs, stockage: stock, uid: 'u2' });
        await connecter(A2);
        await attendre(150);
        check(docs.s1.contenu === 'celui de u2' && Object.values(docs).some(d => d.id !== 's1' && d.contenu === 'à moi'),
            'autre compte, même identifiant : le nuage de ce compte fait foi ET mon morceau est gardé à côté (l\'état de l\'ancien compte n\'a pas servi à décider)');
        A2.moteur.arreter();
    }

    // ===== 15. SANS FIREBASE, TOUT CONTINUE EN LOCAL ===============================================
    {
        const moteur = Nuage.creer({ slug: 'harmohub', firebase: null, config: null, stockage: stockageMemoire(),
            adaptateur: { lister: () => [], lire: () => null, ecrire() {}, retirer() {} } });
        check(moteur.demarrer() === false, 'sans SDK Firebase (hors ligne, bloqué), demarrer() le dit et ne plante pas');
        check(moteur.enAttente() === false, 'et rien n\'est « en attente » : jamais de fenêtre « voulez-vous quitter » pour un nuage qu\'on n\'a pas');
        moteur.changement();   // ne doit rien faire ni planter
        check(true, 'changement() sans connexion est sans effet');
    }

    // ===== 16. EMPREINTE : L'IGNORÉ N'EST PAS UNE MODIFICATION =====================================
    {
        const backend = creerBackend();
        const A = appareil('A', backend, { docs: { s1: morceau('s1', 'un', 1000) } });
        await connecter(A);
        const avant = backend.ecritures;
        A.docs.s1.savedAt = 99999;       // seule la date d'enregistrement change
        A.moteur.changement();
        await attendre(150);
        check(backend.ecritures === avant, 'un champ que l\'adaptateur exclut de l\'empreinte (la date d\'enregistrement) ne déclenche aucun envoi');
        A.moteur.arreter();
    }

    // ===== 17. LE GARDE-FOU « TU TRAVAILLES SANS ÊTRE CONNECTÉ » ===================================
    // Retour utilisateur : « je veux un garde-fou pour me demander une confirmation si je commence à
    // travailler alors que je ne suis pas connecté ». Chaque cas ci-dessous est un moment où un garde-fou
    // naïf dérape : il demande à quelqu'un qui est déjà connecté (Firebase n'a pas encore répondu), il
    // redemande à chaque touche, ou il propose de se connecter quand c'est impossible.
    const questionneur = (reponse) => {
        const journal = { appels: 0, outils: [] };
        const confirmer = (outils) => {
            journal.appels++;
            journal.outils.push(typeof outils.connecter);
            return Promise.resolve(typeof reponse === 'function' ? reponse(outils, journal) : reponse);
        };
        return { journal, confirmer };
    };
    const avecQuestion = (backend, q, extra = {}) => appareil('G', backend, { moteur: { confirmerSansConnexion: q.confirmer }, ...extra });

    // -- 17a. « continuer sans me connecter » : une seule question par séance --------------------------
    {
        const q = questionneur('continuer');
        const A = avecQuestion(creerBackend(), q);
        A.moteur.demarrer(); await attendre(25);
        A.moteur.travail();
        check(q.journal.appels === 0, 'la question n\'est pas posée DANS le geste : la commande qui travaille va d\'abord au bout, sans fenêtre ouverte en son milieu');
        await attendre(15);
        check(q.journal.appels === 1 && q.journal.outils[0] === 'function', 'déconnecté, le nuage existe : la première modification pose la question — et lui remet `connecter`');
        for (let i = 0; i < 25; i++) A.moteur.travail();
        await attendre(25);
        check(q.journal.appels === 1, 'vingt-cinq modifications de plus après « continuer » : plus aucune question (pas une par touche)');
        A.moteur.arreter();
    }

    // -- 17b. Échap, clic à côté : c'est une réponse aussi ----------------------------------------------
    {
        const q = questionneur(null);
        const A = avecQuestion(creerBackend(), q);
        A.moteur.demarrer(); await attendre(25);
        A.moteur.travail(); await attendre(15);
        A.moteur.travail(); A.moteur.travail(); await attendre(15);
        check(q.journal.appels === 1, 'la question fermée sans choix (Échap, clic à côté) vaut « continuer » : elle ne revient pas à la touche suivante');
        A.moteur.arreter();
    }

    // -- 17c. « me connecter » : la fenêtre Google se lance dans le geste, puis le garde-fou repart de zéro
    {
        const backend = creerBackend();
        let appelsDansLeGeste = -1;
        const q = questionneur((outils) => { outils.connecter(); appelsDansLeGeste = A.fb.auth()._appelsConnexion; return 'connecter'; });
        const A = avecQuestion(backend, q);
        A.moteur.demarrer(); await attendre(25);
        A.moteur.travail(); await attendre(40);
        check(appelsDansLeGeste === 1, 'appeler `connecter` depuis la question ouvre la fenêtre Google tout de suite, de façon SYNCHRONE (rien à attendre avant : un navigateur la refuserait)');
        check(A.moteur.etat().connecte, 'et une fois Google passé, on est connecté');
        A.moteur.travail(); await attendre(20);
        check(q.journal.appels === 1, 'connecté : plus aucune question');
        await A.moteur.deconnecter(); await attendre(30);
        A.moteur.travail(); await attendre(20);
        check(q.journal.appels === 2, 'déconnecté de nouveau pendant la même séance : la modification suivante REDEMANDE (se connecter a remis le garde-fou à zéro)');
        A.moteur.arreter();
    }

    // -- 17c2. « continuer », puis on se connecte PAR LE BOUTON (pas par la question), puis on se déconnecte -----
    {
        const q = questionneur('continuer');
        const A = avecQuestion(creerBackend(), q);
        A.moteur.demarrer(); await attendre(25);
        A.moteur.travail(); await attendre(15);
        A.moteur.travail(); await attendre(15);
        check(q.journal.appels === 1, 'départ : « continuer sans me connecter », une question');
        await A.moteur.connecter(); await attendre(40);
        check(A.moteur.etat().connecte, 'puis il se connecte par le bouton de la barre du haut');
        await A.moteur.deconnecter(); await attendre(30);
        A.moteur.travail(); await attendre(20);
        check(q.journal.appels === 2, 'puis se déconnecte : la modification suivante REDEMANDE — « continuer » ne vaut que pour la période où il n\'était pas connecté');
        A.moteur.arreter();
    }

    // -- 17c3. connecté dans un AUTRE onglet pendant que la question est à l'écran -----------------------------
    {
        const q = questionneur(() => attendre(90).then(() => 'continuer'));
        const A = avecQuestion(creerBackend(), q);
        A.moteur.demarrer(); await attendre(25);
        A.moteur.travail(); await attendre(20);
        await A.fb.auth()._connecter(); await attendre(30);      // l'autre onglet vient de se connecter
        check(A.moteur.etat().connecte, 'pendant que la question est à l\'écran, un autre onglet se connecte : ici aussi');
        await attendre(120);                                      // la question se referme sur « continuer »
        await A.moteur.deconnecter(); await attendre(30);
        A.moteur.travail(); await attendre(20);
        check(q.journal.appels === 2, 'la réponse « continuer » donnée alors qu\'on était connecté ne vaut pas pour la suite : déconnecté, la prochaine modification redemande');
        A.moteur.arreter();
    }

    // -- 17c4. on se connecte DANS LE MÊME TOUR que la modification, avant que la question ne parte -------------
    {
        const q = questionneur('continuer');
        const A = avecQuestion(creerBackend(), q, { compte: { authSynchrone: true } });
        A.moteur.demarrer(); await attendre(25);
        A.moteur.travail();                       // la question est programmée…
        await A.moteur.connecter();               // …mais Firebase signale la connexion avant qu'elle ne parte
        await attendre(40);
        check(A.moteur.etat().connecte && q.journal.appels === 0, 'connecté dans le même tour que la modification : la question programmée est abandonnée, on ne demande pas de se connecter à quelqu\'un de connecté');
        A.moteur.arreter();
    }

    // -- 17d. fenêtre Google refermée sans se connecter : il avait dit vouloir le faire, ce n'est pas fait
    {
        const q = questionneur((outils) => { outils.connecter().catch(() => {}); return 'connecter'; });
        const A = avecQuestion(creerBackend(), q);
        A.fb.auth()._echecConnexion = { code: 'auth/popup-closed-by-user' };
        A.moteur.demarrer(); await attendre(25);
        A.moteur.travail(); await attendre(40);
        check(!A.moteur.etat().connecte && !A.moteur.etat().connexionEnCours, 'fenêtre Google refermée sans se connecter : toujours déconnecté, et plus de connexion « en cours »');
        A.moteur.travail(); await attendre(20);
        check(q.journal.appels === 2, '…donc la modification suivante redemande');
        A.moteur.arreter();
    }

    // -- 17e. connecté : jamais -----------------------------------------------------------------------------
    {
        const q = questionneur('continuer');
        const A = avecQuestion(creerBackend(), q, { compte: { dejaConnecte: true } });
        A.moteur.demarrer(); await attendre(25);
        for (let i = 0; i < 5; i++) A.moteur.travail();
        await attendre(25);
        check(q.journal.appels === 0, 'connecté : jamais de question');
        A.moteur.travail();
        check(A.moteur._diagnostic().garde.ouvert === false, 'et connecté, travail() ne prépare même rien (il est appelé à chaque touche : pas une promesse de plus par frappe)');
        A.moteur.arreter();
    }

    // -- 17f. le nuage n'existe pas ici : proposer de se connecter serait proposer l'impossible ----------
    {
        const q = questionneur('continuer');
        const moteur = Nuage.creer({ slug: 'harmohub', firebase: null, config: null, stockage: stockageMemoire(), confirmerSansConnexion: q.confirmer,
            adaptateur: { lister: () => [], lire: () => null, ecrire() {}, retirer() {} } });
        moteur.demarrer(); moteur.travail(); await attendre(25);
        check(q.journal.appels === 0 && moteur.etat().disponible === false,
            'Firebase bloqué ou hors ligne au chargement : aucune question (et `disponible` le dit)');
    }

    // -- 17g. on a travaillé AVANT que Firebase dise qui est connecté ---------------------------------------
    {
        const q = questionneur('continuer');
        const A = avecQuestion(creerBackend(), q, { compte: { authApres: 90 } });
        A.moteur.demarrer();
        for (let i = 0; i < 5; i++) A.moteur.travail();
        await attendre(40);
        check(q.journal.appels === 0 && A.moteur.etat().authConnue === false,
            'Firebase n\'a pas encore dit qui est connecté : on ne demande RIEN (on ne sait pas encore s\'il faut)');
        await attendre(150);
        check(q.journal.appels === 1, 'dès qu\'il répond « personne », la question est posée — une fois, pour les cinq modifications faites entre-temps');
        A.moteur.arreter();

        const q2 = questionneur('continuer');
        const B = avecQuestion(creerBackend(), q2, { compte: { authApres: 90, dejaConnecte: true } });
        B.moteur.demarrer();
        for (let i = 0; i < 5; i++) B.moteur.travail();
        await attendre(220);
        check(q2.journal.appels === 0 && B.moteur.etat().connecte,
            'même retard, mais une session est restaurée : on était connecté, la question ne vient jamais (c\'est le piège que ce cas garde)');
        B.moteur.arreter();
    }

    // -- 17h. une rafale, une question à l'écran : pas deux -------------------------------------------------
    {
        const q = questionneur(() => attendre(80).then(() => 'continuer'));
        const A = avecQuestion(creerBackend(), q);
        A.moteur.demarrer(); await attendre(25);
        for (let i = 0; i < 10; i++) A.moteur.travail();
        await attendre(20);
        for (let i = 0; i < 10; i++) A.moteur.travail();
        check(q.journal.appels === 1, 'vingt modifications pendant que la question est à l\'écran : une seule question, pas une pile de fenêtres');
        await attendre(120);
        A.moteur.travail(); await attendre(20);
        check(q.journal.appels === 1, 'et la réponse donnée plus tard vaut toujours');
        A.moteur.arreter();
    }

    // -- 17i. la fenêtre Google est ouverte : on ne pose pas une question par-dessus ----------------------
    {
        const q = questionneur('continuer');
        const A = avecQuestion(creerBackend(), q);
        A.fb.auth()._popupEnAttente = true;
        A.moteur.demarrer(); await attendre(25);
        const connexion = A.moteur.connecter();
        check(A.moteur.etat().connexionEnCours === true, 'connecter() : la connexion est « en cours » tant que la fenêtre Google est ouverte');
        A.moteur.travail(); await attendre(25);
        check(q.journal.appels === 0, 'on travaille pendant que la fenêtre Google est ouverte : aucune question par-dessus');
        A.fb.auth()._finirPopup(true); await connexion; await attendre(30);
        check(A.moteur.etat().connecte && !A.moteur.etat().connexionEnCours && q.journal.appels === 0, 'connecté, plus « en cours », et toujours aucune question');
        A.moteur.arreter();
    }

    // -- 17j. une question qui plante ne replante pas à chaque touche ---------------------------------------
    {
        const q = questionneur(() => { throw new Error('boum'); });
        const A = avecQuestion(creerBackend(), q);
        const erreurs = []; const consoleError = console.error; console.error = (...a) => erreurs.push(a.join(' '));
        try {
            A.moteur.demarrer(); await attendre(25);
            for (let i = 0; i < 6; i++) { A.moteur.travail(); await attendre(8); }
        } finally { console.error = consoleError; }
        check(q.journal.appels === 1 && erreurs.length === 1, `une question qui plante est posée UNE fois et l'erreur est dite (${q.journal.appels} appel, ${erreurs.length} message)`);
        A.moteur.arreter();
    }

    // -- 17k. sans question fournie (autre application, anciens bancs), travail() ne fait rien --------------
    {
        const A = appareil('A', creerBackend());
        A.moteur.demarrer(); await attendre(25);
        A.moteur.travail();
        check(true, 'travail() sans question fournie est sans effet et ne plante pas');
        A.moteur.arreter();
    }

    // ===== 18. CE QUE LE BOUTON MONTRE =============================================================
    // Un bouton « Se connecter » qui clignote chez quelqu'un de connecté, ou qui affiche un nom périmé,
    // est pire qu'un bouton absent. La présentation est une fonction pure du moteur : on la vérifie ici,
    // et les deux applications ne font que l'afficher.
    {
        const P = Nuage.presentation;
        const lucas = { displayName: 'Lucas Martin', email: 'lucas@exemple.fr' };
        const base = { disponible: true, authConnue: true, connexionEnCours: false, connecte: false, utilisateur: null, mode: null, message: '', compteConnu: null };
        const d = P(base);
        check(d.cle === 'deconnecte' && d.libelle === 'Se connecter' && d.action === 'connecter' && /Google/.test(d.titre) && d.avatar === 'g',
            'déconnecté : « Se connecter » avec le G de Google, et le clic lance Google tout de suite');
        const c = P({ ...base, connecte: true, utilisateur: lucas, mode: 'synced' });
        check(c.cle === 'connecte' && c.libelle === 'Lucas' && c.initiale === 'L' && c.action === 'fenetre' && c.point === 'synced' && c.avatar === 'initiale',
            'connecté : le prénom (pas « Lucas Martin » dans une barre étroite), son initiale, une pastille, et le clic ouvre la fenêtre du compte');
        check(/Lucas Martin \(lucas@exemple\.fr\)/.test(c.titre) && /tout est enregistré/.test(c.titre), 'l\'infobulle donne le nom complet, l\'adresse et l\'état');
        check(P({ ...base, connecte: true, utilisateur: lucas, mode: null }).point === 'syncing', 'connecté sans état encore : « en cours », pas une pastille vide');
        const e = P({ ...base, connecte: true, utilisateur: lucas, mode: 'error', message: 'Firestore refuse l\'accès' });
        check(e.point === 'error' && /Firestore refuse/.test(e.titre), 'une erreur de synchro se voit sur la pastille ET se lit dans l\'infobulle');
        check(P({ ...base, connecte: true, utilisateur: { email: 'lucas@gmail.com' } }).libelle === 'lucas', 'sans nom, on prend ce qui précède l\'@ de l\'adresse');
        const i = P({ ...base, authConnue: false });
        check(i.cle === 'inconnu' && i.libelle === '' && i.action !== 'connecter' && i.avatar === 'nuage', 'Firebase n\'a pas répondu et on ne connaît personne : un simple nuage, pas de « Se connecter » qui pourrait être faux');
        const ic = P({ ...base, authConnue: false, compteConnu: { nom: 'Lucas Martin' } });
        check(ic.cle === 'inconnu' && ic.libelle === 'Lucas' && ic.initiale === 'L', 'Firebase n\'a pas répondu mais on connaît le dernier compte : on le montre (pas de clignotement « Se connecter » → prénom)');
        const co = P({ ...base, authConnue: false, connexionEnCours: true });
        check(co.cle === 'connexion' && co.libelle === 'Connexion…' && co.action === 'connecter', 'fenêtre Google ouverte : « Connexion… », et un clic la rouvre si elle s\'est perdue');
        const x = P({ ...base, disponible: false, authConnue: false });
        check(x.cle === 'indisponible' && x.libelle === 'Hors ligne' && x.action === 'fenetre' && x.point === 'hors-ligne' && x.avatar === 'nuage', 'pas de nuage ici : « Hors ligne », jamais « Se connecter »');
        check(P({ ...base, disponible: false, authConnue: false, compteConnu: { nom: 'Lucas Martin' } }).libelle === 'Lucas', 'pas de nuage mais un compte connu : on garde son prénom (les modifications partiront au prochain chargement connecté)');
    }

    // ===== 19. POURQUOI LA CONNEXION ÉCHOUE, EN FRANÇAIS ============================================
    {
        const E = Nuage.expliquerConnexion;
        check(E({ code: 'auth/popup-closed-by-user' }) === '' && E({ code: 'auth/cancelled-popup-request' }) === '',
            'refermer la fenêtre Google n\'est pas une erreur : aucun message');
        check(/bloqué/.test(E({ code: 'auth/popup-blocked' })), 'fenêtre bloquée par le navigateur : on dit d\'autoriser les fenêtres surgissantes');
        check(/Authorized domains/.test(E({ code: 'auth/unauthorized-domain' })), 'domaine non autorisé : on dit OÙ le régler dans la console Firebase');
        check(/Connexion impossible : ça casse/.test(E({ code: 'auth/autre', message: 'ça casse' })) && /indisponible/.test(E(new Error('Firebase indisponible'))),
            'le reste : le message d\'origine ; et « Firebase indisponible » devient une phrase');
    }

    // ===== 20. L'INDICE DU DERNIER COMPTE ============================================================
    {
        const backend = creerBackend();
        const stock = stockageMemoire();
        const A = appareil('A', backend, { stockage: stock, compte: { dejaConnecte: true, nom: 'Lucas Martin' } });
        A.moteur.demarrer(); await attendre(25);
        check(JSON.parse(stock.getItem('nuage.harmohub.compte')).nom === 'Lucas Martin', 'connecté : le nom est retenu pour le prochain chargement');
        A.moteur.arreter();
        const B = appareil('B', backend, { stockage: stock, compte: { authApres: 120 } });   // rechargement ; Firebase est lent à répondre
        B.moteur.demarrer();
        check(B.moteur.etat().compteConnu && B.moteur.etat().compteConnu.nom === 'Lucas Martin' && B.moteur.etat().authConnue === false,
            'au rechargement, AVANT la réponse de Firebase, on connaît déjà le dernier compte');
        await attendre(220);
        check(B.moteur.etat().compteConnu === null && stock.getItem('nuage.harmohub.compte') === null,
            'Firebase répond « personne » : l\'indice est oublié (il ne peut pas mentir plus longtemps)');
        B.moteur.arreter();
    }

    // ===== 21. L'INTERFACE EST PRÉVENUE DE CE QUI LA CONCERNE =========================================
    {
        let n = 0;
        const A = appareil('A', creerBackend(), { moteur: { surAffichage: () => n++ } });
        A.fb.auth()._popupEnAttente = true;
        A.moteur.demarrer(); await attendre(25);
        const apresAuth = n;
        check(apresAuth > 0, 'Firebase répond : l\'interface est prévenue (le bouton peut passer de « inconnu » à « Se connecter »)');
        const connexion = A.moteur.connecter();
        check(n > apresAuth, 'la fenêtre Google s\'ouvre : l\'interface est prévenue (« Connexion… »)');
        const avantFin = n;
        A.fb.auth()._finirPopup(true); await connexion; await attendre(40);
        check(n > avantFin, 'connecté : l\'interface est prévenue encore');
        A.moteur.arreter();
    }

    bilan();
})();
