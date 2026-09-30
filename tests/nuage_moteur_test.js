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
//   • un contenu que Firestore refuserait tel quel (tableaux imbriqués) : il voyage en chaîne JSON.
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
    const fb = creerFirebase(backend, { uid: options.uid || 'u1' });
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
    plan(67);

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

    bilan();
})();
