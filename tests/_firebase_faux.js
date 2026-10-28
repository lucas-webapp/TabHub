// FAUX FIREBASE pour les bancs de synchro. Aucun vrai Firebase n'est joignable depuis le bac à sable de
// test, et ce n'est de toute façon pas le but : on veut éprouver NOTRE code — fusion, envoi, reprise
// après panne — pas le SDK de Google.
//
// CE QUE LE FAUX REPRODUIT, parce que c'est là que le vrai échoue :
//   - il REFUSE les valeurs `undefined` (« Unsupported field value: undefined ») ;
//   - il REFUSE les tableaux imbriqués (« Nested arrays are not supported ») ;
//   - il REFUSE un document de plus de 1 048 576 octets ;
//   - il sait couper le réseau et faire échouer lectures et écritures, à la demande.
// Un banc qui passerait avec un faux complaisant ne prouverait rien sur ces trois refus — ce sont
// justement ceux que le vrai Firestore oppose sans prévenir, chez l'utilisateur.
//
// CE QU'IL NE REPRODUIT PAS, et qu'il faut dire : les règles de sécurité Firestore, les domaines
// autorisés de l'authentification, la fenêtre Google réelle (surtout sur Safari et dans l'app du Dock),
// la latence et les coupures partielles. Tout cela ne se vérifie que sur de vrais appareils.
//
// Deux « appareils » = deux contextes de navigateur (donc deux localStorage distincts) branchés sur le
// MÊME nuage, tenu ici côté Node.

function creerNuage() {
    return {
        docs: new Map(),            // chemin -> objet JSON
        ecoutes: [],                // { page, chemin, appareil }
        ecritures: [],              // journal : { appareil, chemin, at }
        coupe: new Set(),           // appareils dont le réseau est coupé
    };
}

function copie(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

async function installer(context, nuage, { appareil, uid, nom, email, persister }) {
    // Le SDK réel est remplacé : on répond 200 à ses trois balises <script> pour ne pas laisser
    // `window.firebase` être écrasé si le réseau de test laissait passer gstatic.
    await context.route(/gstatic\.com\/firebasejs\//, (route) =>
        route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* SDK remplacé par le faux */' }));

    await context.exposeFunction('__nuageGet', async (chemin) => {
        if (nuage.coupe.has(appareil)) throw new Error('unavailable');
        return nuage.docs.has(chemin) ? { existe: true, donnees: copie(nuage.docs.get(chemin)) } : { existe: false };
    });
    await context.exposeFunction('__nuageSet', async (chemin, donnees) => {
        if (nuage.coupe.has(appareil)) throw new Error('unavailable');
        nuage.docs.set(chemin, copie(donnees));
        nuage.ecritures.push({ appareil, chemin, at: Date.now() });
        // Les AUTRES appareils reçoivent le changement, comme avec un vrai onSnapshot.
        for (const e of nuage.ecoutes) {
            if (e.chemin === chemin && e.appareil !== appareil && !nuage.coupe.has(e.appareil)) {
                e.page.evaluate(([c, d]) => window.__faux.notifier(c, d), [chemin, copie(donnees)]).catch(() => { });
            }
        }
        return true;
    });
    await context.exposeBinding('__nuageEcoute', async ({ page }, chemin) => {
        nuage.ecoutes.push({ page, chemin, appareil });
        return true;
    });

    await context.addInitScript(([cfg]) => {
        const verifier = (valeur, chemin, dansTableau) => {
            if (valeur === undefined) throw Object.assign(new Error('Unsupported field value: undefined (found in field ' + chemin + ')'), { code: 'invalid-argument' });
            if (Array.isArray(valeur)) {
                if (dansTableau) throw Object.assign(new Error('Nested arrays are not supported (' + chemin + ')'), { code: 'invalid-argument' });
                valeur.forEach((v, i) => verifier(v, chemin + '[' + i + ']', true));
            } else if (valeur && typeof valeur === 'object') {
                Object.keys(valeur).forEach(k => verifier(valeur[k], chemin + '.' + k, false));
            } else if (typeof valeur === 'function') {
                throw Object.assign(new Error('Unsupported field value: a function'), { code: 'invalid-argument' });
            }
        };
        const poids = (o) => new Blob([JSON.stringify(o)]).size;
        const faux = { ecoutes: {}, utilisateur: null, rappelAuth: null, fenetresGoogle: 0 };
        window.__faux = faux;
        faux.notifier = (chemin, donnees) => {
            (faux.ecoutes[chemin] || []).forEach(cb => cb.ok({ exists: true, data: () => JSON.parse(JSON.stringify(donnees)), metadata: { hasPendingWrites: false } }));
        };
        const ref = (chemin) => ({
            _chemin: chemin,
            collection: (c) => ({ doc: (d) => ref(chemin + '/' + c + '/' + d) }),
            get: async () => {
                const r = await window.__nuageGet(chemin);
                return { exists: r.existe, data: () => r.donnees, metadata: { hasPendingWrites: false } };
            },
            set: async (donnees) => {
                verifier(donnees, 'document', false);
                if (poids(donnees) > 1048576) throw Object.assign(new Error('Document exceeds the maximum size (1048576 bytes)'), { code: 'invalid-argument' });
                await window.__nuageSet(chemin, JSON.parse(JSON.stringify(donnees)));
            },
            onSnapshot: (ok, ko) => {
                (faux.ecoutes[chemin] = faux.ecoutes[chemin] || []).push({ ok, ko });
                window.__nuageEcoute(chemin);
                // Comme le vrai : un premier instantané arrive tout de suite.
                window.__nuageGet(chemin).then(r => { if (r.existe) ok({ exists: true, data: () => r.donnees, metadata: { hasPendingWrites: false } }); }).catch(e => ko && ko(e));
                return () => { faux.ecoutes[chemin] = (faux.ecoutes[chemin] || []).filter(x => x.ok !== ok); };
            },
        });
        const db = {
            collection: (c) => ({ doc: (d) => ref(c + '/' + d) }),
            runTransaction: async (fn) => {
                const ecritures = [];
                const tx = {
                    get: (r) => r.get(),
                    set: (r, donnees) => { ecritures.push([r, donnees]); return tx; },
                };
                const resultat = await fn(tx);
                for (const [r, donnees] of ecritures) await r.set(donnees);
                return resultat;
            },
        };
        const utilisateurDe = () => ({ uid: cfg.uid, displayName: cfg.nom, email: cfg.email });
        const auth = {
            // `persister` : comme le vrai Firebase, la session SURVIT au rechargement de la page. Optionnel,
            // parce que plusieurs bancs rechargent puis se reconnectent à la main.
            onAuthStateChanged: (cb) => {
                faux.rappelAuth = cb;
                if (cfg.persister && localStorage.getItem('__fauxSession') === '1') faux.utilisateur = utilisateurDe();
                setTimeout(() => cb(faux.utilisateur), 0);
            },
            signInWithPopup: async () => { faux.fenetresGoogle++; faux.utilisateur = utilisateurDe(); if (cfg.persister) localStorage.setItem('__fauxSession', '1'); faux.rappelAuth && faux.rappelAuth(faux.utilisateur); },
            signOut: async () => { faux.utilisateur = null; localStorage.removeItem('__fauxSession'); faux.rappelAuth && faux.rappelAuth(null); },
        };
        const authFn = () => auth; authFn.GoogleAuthProvider = function () { };
        window.firebase = { initializeApp: () => ({}), auth: authFn, firestore: () => db };
    }, [{ uid, nom: nom || 'Testeur', email: email || 'test@example.com', persister: !!persister }]);
}

module.exports = { creerNuage, installer };
