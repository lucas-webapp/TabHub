// UN FAUX FIREBASE, en mémoire, assez fidèle pour éprouver la synchro sans réseau ni compte Google.
//
// CE QU'IL REPRODUIT, et pourquoi c'est ce sous-ensemble : exactement ce que src/io/nuage.js appelle —
// l'authentification Google par fenêtre, `collection().doc().collection().doc()`, `get`, `set` avec et
// sans fusion PROFONDE (le piège qui a coûté un correctif : un merge ne retire pas un champ absent),
// `onSnapshot` avec ses `metadata` (`hasPendingWrites`, `fromCache`), et `batch().set().commit()`.
//
// CE QU'IL PERMET DE PROVOQUER : un backend PARTAGÉ entre plusieurs « appareils » (chacun avec son
// propre stockage local), des pannes (`backend.echec`), le mode hors ligne (`backend.horsLigne`) et un
// compteur d'écritures, pour vérifier qu'une synchro ne s'emballe pas.
//
// Il sert sous Node (bancs du moteur) ET injecté dans une page (bancs d'intégration) : le même source,
// sans dépendance.

(function (racine) {
    'use strict';

    function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

    function fusionProfonde(cible, source) {
        Object.keys(source).forEach(function (k) {
            var v = source[k];
            if (v && typeof v === 'object' && !Array.isArray(v) && cible[k] && typeof cible[k] === 'object' && !Array.isArray(cible[k])) {
                fusionProfonde(cible[k], v);
            } else {
                cible[k] = clone(v);
            }
        });
        return cible;
    }

    function creerBackend() {
        var docs = {};            // chemin -> données
        var ecouteurs = {};       // chemin -> [fn]
        var b = {
            docs: docs,
            ecritures: 0,          // nombre de documents écrits : détecte une synchro qui s'emballe
            echec: null,           // { code, message } : toute écriture/lecture échoue
            retardInstantane: 0,   // ms avant la livraison du PREMIER instantané (réseau lent au démarrage)
            horsLigne: false,      // les instantanés arrivent « du cache », les écritures sont refusées
            journal: [],
            notifier: function (chemin) {
                (ecouteurs[chemin] || []).slice().forEach(function (fn) { fn(b.instantane(chemin)); });
            },
            instantane: function (chemin) {
                var d = docs[chemin];
                return {
                    exists: d !== undefined,
                    data: function () { return clone(d); },
                    metadata: { hasPendingWrites: false, fromCache: b.horsLigne },
                };
            },
            ecouter: function (chemin, fn, fnErr) {
                (ecouteurs[chemin] = ecouteurs[chemin] || []).push(fn);
                setTimeout(function () {
                    if (b.echec && fnErr) { fnErr(b.echec); return; }
                    fn(b.instantane(chemin));
                }, b.retardInstantane);
                return function () { ecouteurs[chemin] = (ecouteurs[chemin] || []).filter(function (x) { return x !== fn; }); };
            },
            ecrire: function (chemin, donnees, fusion) {
                if (b.echec) return Promise.reject(b.echec);
                if (b.horsLigne) return Promise.reject({ code: 'unavailable', message: 'hors ligne' });
                if (fusion && docs[chemin]) fusionProfonde(docs[chemin], donnees);
                else docs[chemin] = clone(donnees);
                b.ecritures++;
                b.journal.push(chemin);
                return Promise.resolve();
            },
        };
        return b;
    }

    function creerFirebase(backend, compte) {
        var utilisateur = null;
        var surAuth = [];
        var auth = {
            onAuthStateChanged: function (fn) {
                surAuth.push(fn);
                setTimeout(function () { fn(utilisateur); }, 0);
            },
            signInWithPopup: function () {
                utilisateur = { uid: compte.uid, displayName: compte.nom || 'Testeur', email: compte.email || 'test@example.org' };
                surAuth.forEach(function (fn) { setTimeout(function () { fn(utilisateur); }, 0); });
                return Promise.resolve({ user: utilisateur });
            },
            signOut: function () {
                utilisateur = null;
                surAuth.forEach(function (fn) { setTimeout(function () { fn(null); }, 0); });
                return Promise.resolve();
            },
            /** Pour les bancs : connecte sans passer par la fenêtre. */
            _connecter: function () { return auth.signInWithPopup(); },
        };

        function ref(chemin) {
            return {
                path: chemin,
                collection: function (n) { return coll(chemin + '/' + n); },
                get: function () {
                    if (backend.echec) return Promise.reject(backend.echec);
                    return Promise.resolve(backend.instantane(chemin));
                },
                set: function (donnees, opts) { return backend.ecrire(chemin, donnees, !!(opts && opts.merge)).then(function () { backend.notifier(chemin); }); },
                onSnapshot: function (fn, fnErr) { return backend.ecouter(chemin, fn, fnErr); },
            };
        }
        function coll(chemin) { return { doc: function (id) { return ref(chemin + '/' + id); } }; }

        var firestore = {
            collection: function (n) { return coll(n); },
            batch: function () {
                var ops = [];
                var lot = {
                    set: function (r, donnees, opts) { ops.push({ r: r, donnees: donnees, fusion: !!(opts && opts.merge) }); return lot; },
                    commit: function () {
                        if (backend.echec) return Promise.reject(backend.echec);
                        if (backend.horsLigne) return Promise.reject({ code: 'unavailable', message: 'hors ligne' });
                        ops.forEach(function (o) {
                            if (o.fusion && backend.docs[o.r.path]) fusionProfonde(backend.docs[o.r.path], o.donnees);
                            else backend.docs[o.r.path] = clone(o.donnees);
                            backend.ecritures++;
                            backend.journal.push(o.r.path);
                        });
                        ops.forEach(function (o) { backend.notifier(o.r.path); });
                        return Promise.resolve();
                    },
                };
                return lot;
            },
        };

        var fb = {
            apps: [],
            initializeApp: function () { fb.apps.push({}); return {}; },
            app: function () { return {}; },
            auth: function () { return auth; },
            firestore: function () { return firestore; },
        };
        fb.auth.GoogleAuthProvider = function () {};
        return fb;
    }

    var api = { creerBackend: creerBackend, creerFirebase: creerFirebase };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else racine.FirebaseFactice = api;
})(typeof window !== 'undefined' ? window : globalThis);
