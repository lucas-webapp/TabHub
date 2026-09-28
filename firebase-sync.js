// Synchro cloud générique (Firebase / Google), partagée avec HarmoHub et TrainHub.
//
// Volontairement écrite SANS toucher à src/main.js et au reste de src/ : plutôt que
// d'aller accrocher un appel de synchro à chaque endroit du code qui touche au
// localStorage (nombreux, éparpillés, et ce fichier ne doit rien savoir du
// fonctionnement interne de l'appli), on observe le localStorage lui-même. Toute clé
// que l'appli sait déjà lire à son démarrage est donc couverte automatiquement, y
// compris les clés futures.
//
// Un changement distant se traduit par un rechargement de la page plutôt qu'un
// re-rendu ciblé : plus lourd, mais sûr, car ni ce fichier ni le reste de l'appli
// n'ont à connaître les fonctions de rendu internes.
(function () {
    "use strict";

    if (typeof firebase === "undefined" || typeof FIREBASE_CONFIG === "undefined" || typeof FIREBASE_APP_SLUG === "undefined") {
        console.warn("Firebase indisponible : mode local uniquement.");
        return;
    }

    var IGNORE_PREFIX = "__fbsync_";
    var META_KEY = IGNORE_PREFIX + "meta_" + FIREBASE_APP_SLUG;
    var PUSH_DEBOUNCE_MS = 1500;

    firebase.initializeApp(FIREBASE_CONFIG);
    var auth = firebase.auth();
    var db = firebase.firestore();

    var currentUser = null;
    var docRef = null;
    var unsubscribeSnapshot = null;
    var pushTimer = null;
    var applyingRemote = false;

    var origSetItem = localStorage.setItem.bind(localStorage);
    var origRemoveItem = localStorage.removeItem.bind(localStorage);

    function getMeta() {
        try { return JSON.parse(origGetMeta()) || { updatedAt: 0 }; }
        catch (e) { return { updatedAt: 0 }; }
    }
    function origGetMeta() { return localStorage.getItem(META_KEY); }
    function setMetaUpdatedAt(ts) {
        try { origSetItem(META_KEY, JSON.stringify({ updatedAt: ts })); } catch (e) {}
    }

    function snapshotStorage() {
        var data = {};
        for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            if (key.indexOf(IGNORE_PREFIX) === 0) continue;
            data[key] = localStorage.getItem(key);
        }
        return data;
    }

    function applyStorage(data) {
        applyingRemote = true;
        try {
            var existingKeys = [];
            for (var i = 0; i < localStorage.length; i++) existingKeys.push(localStorage.key(i));
            existingKeys.forEach(function (k) {
                if (k.indexOf(IGNORE_PREFIX) === 0) return;
                if (!(k in data)) origRemoveItem(k);
            });
            Object.keys(data).forEach(function (k) {
                origSetItem(k, data[k]);
            });
        } finally {
            applyingRemote = false;
        }
    }

    localStorage.setItem = function (key, value) {
        origSetItem(key, value);
        if (!applyingRemote && key.indexOf(IGNORE_PREFIX) !== 0) schedulePush();
    };
    localStorage.removeItem = function (key) {
        origRemoveItem(key);
        if (!applyingRemote && key.indexOf(IGNORE_PREFIX) !== 0) schedulePush();
    };

    function schedulePush() {
        setMetaUpdatedAt(Date.now());
        setSyncStatus("syncing");
        if (!currentUser || !docRef) return;
        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = setTimeout(pushToCloud, PUSH_DEBOUNCE_MS);
    }

    function pushToCloud() {
        if (!currentUser || !docRef) return;
        var meta = getMeta();
        docRef.set({ data: snapshotStorage(), updatedAt: meta.updatedAt || Date.now() }).then(function () {
            setSyncStatus("synced");
        }).catch(function (e) {
            console.error("Envoi vers le cloud impossible", e);
            setSyncStatus("error");
        });
    }

    function isRemoteNewer(remote) {
        var localMeta = getMeta();
        return !!remote && typeof remote.updatedAt === "number" && remote.updatedAt > (localMeta.updatedAt || 0);
    }

    function adoptRemote(remote) {
        applyStorage(remote.data || {});
        setMetaUpdatedAt(remote.updatedAt);
    }

    function attachSnapshotListener() {
        unsubscribeSnapshot = docRef.onSnapshot(function (snap) {
            if (!snap.exists || snap.metadata.hasPendingWrites) return;
            var remote = snap.data();
            if (!isRemoteNewer(remote)) {
                setSyncStatus("synced");
                return;
            }
            adoptRemote(remote);
            setSyncStatus("synced");
            window.location.reload();
        }, function (e) {
            console.error("Écoute de la synchro interrompue", e);
            setSyncStatus("error");
        });
    }

    function pushCurrentAsSeed() {
        var meta = getMeta();
        return docRef.set({ data: snapshotStorage(), updatedAt: meta.updatedAt || Date.now() }).then(function () {
            setSyncStatus("synced");
            attachSnapshotListener();
        });
    }

    function onAuthChanged(user) {
        currentUser = user;
        updateAuthUI(user);
        if (unsubscribeSnapshot) {
            unsubscribeSnapshot();
            unsubscribeSnapshot = null;
        }
        if (!user) {
            docRef = null;
            setSyncStatus(null);
            return;
        }
        docRef = db.collection("users").doc(user.uid).collection("apps").doc(FIREBASE_APP_SLUG);
        setSyncStatus("syncing");
        docRef.get().then(function (snap) {
            var remote = snap.exists ? snap.data() : null;
            var localMeta = getMeta();
            var neverSyncedOnThisDevice = !localMeta.updatedAt;

            // Premier lien de CET appareil avec un compte qui a déjà des données en ligne :
            // deux historiques locaux non suivis peuvent diverger, donc on demande plutôt que
            // d'en écraser un silencieusement (au lieu de la comparaison d'horodatage habituelle).
            if (remote && neverSyncedOnThisDevice) {
                var remoteDate = new Date(remote.updatedAt).toLocaleString("fr-FR");
                var keepCloud = window.confirm(
                    "Des données existent déjà en ligne pour ce compte (dernière synchro : " + remoteDate + ").\n\n" +
                    "OK = utiliser la version EN LIGNE sur cet appareil (remplace les données locales de cet appareil).\n" +
                    "Annuler = garder les données de CET APPAREIL et les envoyer en ligne (remplace la version en ligne)."
                );
                if (keepCloud) {
                    adoptRemote(remote);
                    attachSnapshotListener();
                    setSyncStatus("synced");
                    window.location.reload();
                    return null;
                }
                setMetaUpdatedAt(Date.now());
                return pushCurrentAsSeed();
            }

            if (isRemoteNewer(remote)) {
                adoptRemote(remote);
                attachSnapshotListener();
                setSyncStatus("synced");
                window.location.reload();
                return null;
            }

            return pushCurrentAsSeed();
        }).catch(function (e) {
            console.error("Synchro initiale impossible", e);
            setSyncStatus("error");
            attachSnapshotListener();
        });
    }

    var $btn = document.getElementById("google-signin-btn");

    function setSyncStatus(mode) {
        if (!$btn) return;
        $btn.classList.remove("sync-synced", "sync-syncing", "sync-error");
        if (mode) $btn.classList.add("sync-" + mode);
        var titles = {
            synced: "Synchronisé",
            syncing: "Synchronisation en cours…",
            error: "Erreur de synchronisation (dernière version conservée en local)"
        };
        if (currentUser) {
            $btn.title = (currentUser.displayName || currentUser.email || "Connecté") + " — " + (titles[mode] || "hors ligne") + " (cliquer pour se déconnecter)";
        } else {
            $btn.title = "Se connecter avec Google pour synchroniser tes données";
        }
    }

    function updateAuthUI(user) {
        setSyncStatus(user ? "syncing" : null);
    }

    if ($btn) {
        $btn.addEventListener("click", function () {
            if (currentUser) {
                if (window.confirm("Connecté en tant que " + (currentUser.displayName || currentUser.email) + ".\nSe déconnecter ?")) {
                    auth.signOut();
                }
                return;
            }
            var provider = new firebase.auth.GoogleAuthProvider();
            auth.signInWithPopup(provider).catch(function (e) {
                console.error("Connexion impossible", e);
                window.alert("Connexion impossible : " + (e && e.message ? e.message : "erreur inconnue"));
            });
        });
    }

    auth.onAuthStateChanged(onAuthChanged);
})();
