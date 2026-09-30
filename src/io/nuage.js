// SYNCHRO AVEC FIREBASE — le même fichier dans HarmoHub et TabHub (et dans l'esprit de TrainHub).
//
// CE QUE ÇA FAIT, en une phrase : chaque morceau est recopié dans le nuage de l'utilisateur dès qu'il
// change, et revient tout seul sur ses autres appareils. On n'y pense plus.
//
// CE QUI EST REPRIS DE TRAINHUB, parce que ça marche : connexion Google par fenêtre surgissante,
// Firestore en SDK « compat » 10.13.2, chemin `users/{uid}/apps/{slug}`, envoi différé de 1,5 s,
// pastille d'état, avertissement à la fermeture pendant un envoi, sauvegardes de secours locales avant
// tout remplacement, repli silencieux en mode local si Firebase est injoignable.
//
// CE QUI EST DIFFÉRENT, et pourquoi :
//
//   • UN DOCUMENT FIRESTORE PAR MORCEAU, plus un petit index. TrainHub range tout l'état dans UN
//     document, et son propre code note que Firestore refuse au-delà de 1 Mo. Une bibliothèque de
//     partitions ou de grilles d'accords y arrive vite ; un morceau seul, jamais. Bénéfice
//     secondaire : deux appareils qui modifient deux morceaux différents ne se marchent plus dessus.
//     Tous les documents restent des FRÈRES dans la collection `apps` (`tabhub`, `tabhub__<id>`…) :
//     aucune sous-collection, donc la règle de sécurité qui couvre déjà `apps/{appId}` les couvre.
//
//   • LE CONTENU EST UNE CHAÎNE JSON. Firestore refuse les tableaux imbriqués, les `undefined` et
//     certains noms de champs ; une partition en contient. Une chaîne traverse tout sans rien
//     demander au modèle de données.
//
//   • AUCUNE PERTE SILENCIEUSE. TrainHub remplace l'état entier par le plus récent. Ici, on compare
//     morceau par morceau à ce qui a été synchronisé la dernière fois (une empreinte, pas une
//     horloge) : si les deux côtés ont changé, le plus récent gagne ET l'autre est conservé comme
//     une copie « (conflit) » — rien n'est jamais écrasé sans laisser de trace. Supprimer un morceau
//     laisse son contenu dans le nuage (seul l'index le marque supprimé), et une suppression de
//     masse, presque toujours un accident, est refusée.
//
// L'APPLICATION FOURNIT UN ADAPTATEUR (voir `creer`) : comment lister ses morceaux, en lire un, en
// écrire un. Ce fichier ne sait rien de ce qu'est une partition ou une grille d'accords.

(function (global) {
    'use strict';

    var DELAI_ENVOI_MS = 1500;
    var TAILLE_MAX_DOC = 900 * 1024;      // Firestore refuse 1 Mio ; on garde de la marge pour l'enveloppe
    var SECOURS_MAX = 12;
    var SECOURS_OCTETS_MAX = 1500 * 1024;  // localStorage plafonne vers 5 Mo pour TOUTE l'application
    var REESSAIS_MS = [5000, 15000, 60000, 300000];

    /** Empreinte rapide (FNV-1a 32 bits) : sert à savoir « ce morceau a-t-il changé depuis la
     *  dernière synchro », jamais à se protéger de quoi que ce soit. */
    function empreinteTexte(texte) {
        var h = 0x811c9dc5;
        for (var i = 0; i < texte.length; i++) {
            h ^= texte.charCodeAt(i);
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        return h.toString(36) + ':' + texte.length;
    }

    /** Identifiant sûr comme nom de document Firestore (pas de « / », pas de nom réservé). */
    function idSur(id) {
        return String(id).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 120) || 'sans-id';
    }

    function creer(options) {
        var slug = options.slug;
        var adaptateur = options.adaptateur;
        var stockage = options.stockage || global.localStorage;
        var fb = options.firebase || global.firebase;
        var maintenant = options.maintenant || function () { return Date.now(); };
        // Réglables pour les bancs : attendre 1,5 s à chaque vérification les rendrait interminables.
        var delaiEnvoi = options.delaiEnvoi != null ? options.delaiEnvoi : DELAI_ENVOI_MS;
        var reessais = options.reessais || REESSAIS_MS;
        var CLE_ETAT = 'nuage.' + slug + '.etat';
        var CLE_SECOURS = 'nuage.' + slug + '.secours';

        var app = null, auth = null, db = null;
        var utilisateur = null;
        var refIndex = null;
        var desabonner = null;
        var index = { docs: {}, meta: null };     // dernier index connu du nuage
        var etatLocal = lireEtatLocal();          // { uid, docs: {id: {base, h, sale}}, supprimes: {id: ts} }
        var minuterie = null;
        var minuterieReessai = null;
        var nbEchecs = 0;
        var file = Promise.resolve();
        var etatAffiche = null;
        var dernierMessage = '';
        var arrete = false;
        // L'INDEX FAIT-IL AUTORITÉ ? Faux tant que le premier instantané VENU DU SERVEUR n'est pas là.
        // Sans ce verrou, un rapprochement lancé avant lui croit le nuage vide et envoie tout par-dessus
        // des versions plus récentes qu'il n'a jamais vues — et le même piège guette hors ligne, où
        // Firestore répond par un instantané « du cache » qui n'a jamais rien contenu.
        var indexPret = false;
        var alerte = '';
        var copieCreee = false;
        var toucheLocal = false;          // ce cycle a modifié des morceaux de CET appareil

        // ---------- état local (ce qui a été synchronisé la dernière fois) --------------------------

        function lireEtatLocal() {
            try {
                var brut = JSON.parse(stockage.getItem(CLE_ETAT));
                if (brut && typeof brut === 'object') {
                    brut.docs = brut.docs || {};
                    brut.supprimes = brut.supprimes || {};
                    return brut;
                }
            } catch (e) { /* illisible : on repart de zéro, ce qui re-synchronise tout */ }
            return { uid: null, docs: {}, supprimes: {} };
        }

        function ecrireEtatLocal() {
            try { stockage.setItem(CLE_ETAT, JSON.stringify(etatLocal)); } catch (e) { /* quota : sans gravité */ }
        }

        // ---------- sauvegardes de secours -----------------------------------------------------------

        function lireSecours() {
            try { return JSON.parse(stockage.getItem(CLE_SECOURS)) || []; } catch (e) { return []; }
        }

        /** Garde ce qui va être remplacé ou retiré. Le nuage n'y est pour rien : c'est le filet de
         *  l'appareil, celui qui permet de tout récupérer même si la synchro se trompe. */
        function secours(raison, id, titre, texteJson) {
            try {
                var liste = lireSecours();
                liste.push({ a: maintenant(), raison: raison, id: id, titre: titre || '', json: texteJson });
                while (liste.length > SECOURS_MAX) liste.shift();
                var total = function () { return liste.reduce(function (s, e) { return s + (e.json ? e.json.length : 0); }, 0); };
                while (liste.length > 1 && total() > SECOURS_OCTETS_MAX) liste.shift();
                stockage.setItem(CLE_SECOURS, JSON.stringify(liste));
            } catch (e) { console.error('Sauvegarde de secours impossible', e); }
        }

        // ---------- état affiché ---------------------------------------------------------------------

        function afficher(mode, message) {
            etatAffiche = mode;
            dernierMessage = message || '';
            if (options.surEtat) options.surEtat(mode, dernierMessage);
        }

        function expliquer(e) {
            var code = e && e.code ? String(e.code) : '';
            if (code.indexOf('permission-denied') >= 0) {
                return 'Firestore refuse l\'accès : les règles de sécurité ne couvrent pas ce document (voir le README).';
            }
            if (code.indexOf('unavailable') >= 0 || code.indexOf('network') >= 0) return 'Hors ligne — la synchro reprendra d\'elle-même.';
            if (code.indexOf('resource-exhausted') >= 0) return 'Quota Firestore atteint pour aujourd\'hui.';
            return (e && e.message) ? e.message : 'erreur inconnue';
        }

        // ---------- lecture / écriture du nuage ------------------------------------------------------

        function refDoc(id) { return db.collection('users').doc(utilisateur.uid).collection('apps').doc(slug + '__' + idSur(id)); }

        function lireDoc(id) {
            return refDoc(id).get().then(function (snap) {
                if (!snap.exists) return null;
                var d = snap.data();
                return d && typeof d.json === 'string' ? d : null;
            });
        }

        function entreeIndex(id) { return index.docs ? index.docs[idSur(id)] : undefined; }

        function empreinteDe(donnees) {
            var texte = adaptateur.empreinte ? adaptateur.empreinte(donnees) : JSON.stringify(donnees);
            return empreinteTexte(texte);
        }

        /** Envoie un morceau ET son entrée d'index dans UN lot : l'index ne désigne jamais un document
         *  absent, même si la connexion tombe au milieu. */
        function envoyer(id, titre, donnees, sansEtat) {
            var json = JSON.stringify(donnees);
            if (json.length > TAILLE_MAX_DOC) {
                return Promise.reject({ code: 'nuage/trop-gros', message: '« ' + titre + ' » pèse ' + Math.round(json.length / 1024) + ' Ko : trop gros pour le nuage (900 Ko maximum).' });
            }
            var ancien = entreeIndex(id);
            var u = maintenant();
            if (ancien && ancien.u >= u) u = ancien.u + 1;   // strictement croissant, même si l'horloge recule
            var h = empreinteDe(donnees);
            // `d: false` EXPLICITE : un `set` avec fusion est profond et ne retire pas un champ absent.
            // Sans lui, un morceau supprimé puis modifié à nouveau garderait son drapeau de suppression
            // dans l'index et resterait invisible partout.
            var entree = {}; entree[idSur(id)] = { t: titre || '', u: u, i: String(id), d: false };
            var lot = db.batch();
            lot.set(refDoc(id), { id: String(id), t: titre || '', u: u, json: json });
            lot.set(refIndex, { docs: entree, maj: u }, { merge: true });
            return lot.commit().then(function () {
                // `sansEtat` : un DÉPÔT (sauvegarde importée) concerne un morceau que cet appareil n'a pas.
                // L'inscrire comme « déjà synchronisé ici » le ferait passer, à l'application qui supprime
                // par disparition, pour un morceau disparu.
                if (!sansEtat) {
                    etatLocal.docs[id] = { base: u, h: h, sale: null };
                    delete etatLocal.supprimes[id];
                    ecrireEtatLocal();
                }
                if (!index.docs) index.docs = {};
                index.docs[idSur(id)] = { t: titre || '', u: u, i: String(id), d: false };
                prevenirCatalogue();
            });
        }

        /** Marque un morceau supprimé dans l'index. Le contenu RESTE dans son document : une erreur de
         *  suppression se rattrape depuis la console Firebase. */
        function marquerSupprime(id, titre) {
            var ancien = entreeIndex(id);
            var u = maintenant();
            if (ancien && ancien.u >= u) u = ancien.u + 1;
            var entree = {}; entree[idSur(id)] = { t: titre || (ancien && ancien.t) || '', u: u, d: true, i: String(id) };
            return refIndex.set({ docs: entree, maj: u }, { merge: true }).then(function () {
                delete etatLocal.docs[id];
                delete etatLocal.supprimes[id];
                ecrireEtatLocal();
                if (!index.docs) index.docs = {};
                index.docs[idSur(id)] = entree[idSur(id)];
                prevenirCatalogue();
            });
        }

        function prevenirCatalogue() { if (options.surCatalogue) options.surCatalogue(catalogue()); }

        function catalogue() {
            var liste = [];
            var docs = index.docs || {};
            Object.keys(docs).forEach(function (k) {
                var e = docs[k];
                liste.push({ id: e.i || k, titre: e.t || '', maj: e.u || 0, supprime: !!e.d });
            });
            liste.sort(function (a, b) { return b.maj - a.maj; });
            return liste;
        }

        // ---------- le rapprochement (le cœur) ------------------------------------------------------

        // UNE SEULE TÂCHE À LA FOIS. C'est aussi ce qui rend inutile tout suivi des envois « en vol » : un
        // instantané déclenché par notre propre écriture fait enfiler un rapprochement qui ne démarre
        // qu'une fois l'envoi ACQUITTÉ et l'état local à jour — il ne peut donc pas prendre notre
        // propre envoi pour une modification venue d'ailleurs.
        function enfiler(tache) {
            var suite = file.then(tache, tache);
            file = suite.catch(function () { /* l'erreur est déjà traitée par la tâche */ });
            return suite;
        }

        /** Compare l'état local et l'index du nuage, morceau par morceau, et fait ce qu'il faut. */
        function rapprocher() {
            if (!utilisateur || !refIndex || arrete || !indexPret) return Promise.resolve();
            return enfiler(function () { return rapprocherVraiment(); });
        }

        function rapprocherVraiment() {
            var locaux = adaptateur.lister();
            var parId = {};
            locaux.forEach(function (l) { parId[l.id] = l; });
            var taches = [];
            var aEnvoyer = 0;

            locaux.forEach(function (l) {
                var id = l.id;
                var rec = etatLocal.docs[id];
                var h = empreinteDe(l.donnees);
                var sale = !rec || rec.h !== h;
                var r = entreeIndex(id);
                if (adaptateur.occupe && adaptateur.occupe(id)) return; // en cours de modification : on y reviendra

                if (sale) {
                    if (rec && !rec.sale) { rec.sale = maintenant(); ecrireEtatLocal(); }
                }

                if (r && r.d) {                                      // supprimé dans le nuage
                    if (sale) taches.push(function () { aEnvoyer++; return envoyer(id, l.titre, l.donnees); });  // modifié ici depuis : on le garde
                    else taches.push(function () { return retirerLocal(id, l, 'Supprimé depuis un autre appareil'); });
                    return;
                }
                if (!r) { taches.push(function () { aEnvoyer++; return envoyer(id, l.titre, l.donnees); }); return; }

                var distantChange = !rec || rec.base !== r.u;
                if (!distantChange) {
                    if (sale) taches.push(function () { aEnvoyer++; return envoyer(id, l.titre, l.donnees); });
                    return;
                }
                // Le nuage a une version que cet appareil n'a pas vue.
                taches.push(function () { return reconcilierDistant(id, l, rec, sale, r); });
            });

            // Morceaux que le nuage a et que cet appareil n'a pas.
            Object.keys(index.docs || {}).forEach(function (k) {
                var r = index.docs[k];
                var id = r.i || k;
                if (parId[id] || r.d) return;
                if (etatLocal.supprimes[id]) return;
                if (!adaptateur.miroirComplet) return;    // TabHub : on les LISTE, on ne les ouvre pas d'office
                taches.push(function () { return tirerDistant(id, r); });
            });

            if (adaptateur.metaAppliquer && index.meta) {
                try { adaptateur.metaAppliquer(index.meta); } catch (e) { console.error('Méta illisible', e); }
            }

            // Suppressions locales notées hors ligne.
            Object.keys(etatLocal.supprimes).forEach(function (id) {
                taches.push(function () { return marquerSupprime(id, ''); });
            });

            if (!taches.length) { finirSynchro(); return Promise.resolve(); }
            afficher('syncing');
            // En séquence : un morceau à la fois, pour ne pas saturer et pour garder un ordre lisible.
            // UN MORCEAU QUI NE PEUT PAS PARTIR (trop gros) NE DOIT PAS BLOQUER LES AUTRES : son échec est
            // définitif, il se dit dans l'alerte, et la file continue. Toute autre erreur est réseau ou
            // droits — elle interrompt, et un nouvel essai est programmé.
            return taches.reduce(function (p, t) {
                return p.then(t).catch(function (e) {
                    if (e && e.code === 'nuage/trop-gros') { alerte = e.message; return; }
                    throw e;
                });
            }, Promise.resolve()).then(function () {
                nbEchecs = 0;
                finirSynchro();
            }, function (e) {
                console.error('Synchro interrompue', e);
                afficher('error', expliquer(e));
                programmerReessai();
            });
        }

        function finirSynchro() {
            // L'application rafraîchit son interface UNE fois par lot, pas à chaque morceau reçu (HarmoHub
            // en reçoit parfois des dizaines à la première connexion).
            if (toucheLocal) {
                toucheLocal = false;
                if (adaptateur.apres) { try { adaptateur.apres(); } catch (e) { console.error(e); } }
            }
            envoyerMeta();
            if (alerte) afficher('error', alerte);
            else afficher('synced');
            if (copieCreee) { copieCreee = false; changement(); }   // une copie de conflit est à envoyer
        }

        function retirerLocal(id, l, raison) {
            secours(raison, id, l.titre, JSON.stringify(l.donnees));
            adaptateur.retirer(id);
            toucheLocal = true;
            delete etatLocal.docs[id];
            ecrireEtatLocal();
            return Promise.resolve();
        }

        function tirerDistant(id, r) {
            return lireDoc(id).then(function (d) {
                if (!d) return;
                appliquer(id, JSON.parse(d.json), r.u, r.t);
            });
        }

        function appliquer(id, donnees, u, titre) {
            adaptateur.ecrire(id, donnees, titre);
            toucheLocal = true;
            var relu = adaptateur.lire(id);
            etatLocal.docs[id] = { base: u, h: empreinteDe(relu === undefined || relu === null ? donnees : relu), sale: null };
            ecrireEtatLocal();
        }

        function reconcilierDistant(id, l, rec, sale, r) {
            return lireDoc(id).then(function (d) {
                if (!d) return envoyer(id, l.titre, l.donnees);       // l'index mentait : le document manque
                var distant = JSON.parse(d.json);
                var hDistant = empreinteDe(distant);
                if (rec && !sale) {                                    // rien de neuf ici : on prend le nuage
                    secours('Avant remplacement par la version d\'un autre appareil', id, l.titre, JSON.stringify(l.donnees));
                    appliquer(id, distant, r.u, r.t);
                    return;
                }
                if (hDistant === empreinteDe(l.donnees)) {             // les deux côtés sont déjà identiques
                    etatLocal.docs[id] = { base: r.u, h: hDistant, sale: null };
                    ecrireEtatLocal();
                    return;
                }
                // CONFLIT : les deux ont changé. Le plus récent gagne, l'autre est gardé en copie.
                // Jamais synchronisé ici (`rec` absent) : on ne sait pas QUI est le plus récent, et une
                // horloge ne le dira pas. Le nuage fait foi, la version locale est gardée en copie.
                // L'heure de la dernière modification locale : celle que l'application a notée elle-même
                // si elle le sait (`maj`), sinon celle à laquelle la synchro a REMARQUÉ le changement —
                // moins juste si l'appli était fermée entre-temps, d'où la préférence.
                var quandLocal = (adaptateur.maj && adaptateur.maj(l.donnees)) || (rec && rec.sale) || maintenant();
                var localGagne = !!rec && quandLocal >= r.u;
                var perdant = localGagne ? distant : l.donnees;
                var copie = adaptateur.nouvelleCopie ? adaptateur.nouvelleCopie(perdant, ' (conflit ' + formaterHeure(localGagne ? r.u : quandLocal) + ')') : null;
                secours('Conflit : version ' + (localGagne ? 'du nuage' : 'de cet appareil') + ' mise de côté', id, l.titre, JSON.stringify(perdant));
                if (copie) {
                    adaptateur.ecrire(copie.id, copie.donnees, copie.titre);
                    toucheLocal = true;
                    copieCreee = true;
                }
                if (localGagne) return envoyer(id, l.titre, l.donnees);
                appliquer(id, distant, r.u, r.t);
                return null;
            });
        }

        function formaterHeure(ts) {
            var d = new Date(ts);
            function z(n) { return (n < 10 ? '0' : '') + n; }
            return z(d.getDate()) + '/' + z(d.getMonth() + 1) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
        }

        function envoyerMeta() {
            if (!adaptateur.metaLire || !refIndex) return;
            try {
                var meta = adaptateur.metaLire();
                var h = empreinteTexte(JSON.stringify(meta));
                if (etatLocal.metaH === h) return;
                refIndex.set({ meta: meta }, { merge: true }).then(function () {
                    etatLocal.metaH = h; ecrireEtatLocal();
                }, function () { /* sans gravité : réessayé à la prochaine synchro */ });
            } catch (e) { /* méta illisible : ignorée */ }
        }

        // ---------- déclencheurs --------------------------------------------------------------------

        /** L'application dit « quelque chose a changé ». On regarde (un peu plus tard) quoi. */
        function changement() {
            if (!utilisateur || arrete) return;
            alerte = '';
            afficher('syncing');
            if (minuterie) clearTimeout(minuterie);
            minuterie = setTimeout(function () { minuterie = null; detecterSuppressions(); rapprocher(); }, delaiEnvoi);
        }

        /** Un morceau connu de la synchro qui n'existe plus ici a été supprimé ici — SI l'application
         *  supprime par disparition de la liste (HarmoHub). Une disparition massive est refusée : c'est
         *  presque toujours un stockage vidé ou un bogue, presque jamais une intention. */
        function detecterSuppressions() {
            if (!adaptateur.suppressionParDisparition) return;
            var presents = {};
            adaptateur.lister().forEach(function (l) { presents[l.id] = true; });
            var connus = Object.keys(etatLocal.docs);
            var disparus = connus.filter(function (id) { return !presents[id]; });
            if (!disparus.length) return;
            if (disparus.length >= 3 && disparus.length * 2 >= connus.length) {
                console.error('Synchro : ' + disparus.length + ' morceaux sur ' + connus.length + ' ont disparu d\'un coup — suppression refusée.');
                alerte = 'Suppression massive refusée (' + disparus.length + ' morceaux ont disparu d\'un coup). Rien n\'a été supprimé dans le nuage.';
                // On les oublie localement : ils reviendront depuis le nuage au prochain rapprochement.
                disparus.forEach(function (id) { delete etatLocal.docs[id]; });
                ecrireEtatLocal();
                return;
            }
            disparus.forEach(function (id) { etatLocal.supprimes[id] = maintenant(); });
            ecrireEtatLocal();
        }

        function programmerReessai() {
            if (minuterieReessai) clearTimeout(minuterieReessai);
            var delai = reessais[Math.min(nbEchecs, reessais.length - 1)];
            nbEchecs++;
            minuterieReessai = setTimeout(function () { minuterieReessai = null; rapprocher(); }, delai);
        }

        function surAuth(user) {
            utilisateur = user;
            if (desabonner) { desabonner(); desabonner = null; }
            if (minuterie) { clearTimeout(minuterie); minuterie = null; }
            if (options.surCompte) options.surCompte(user);
            indexPret = false;
            if (!user) { refIndex = null; afficher(null); return; }
            if (etatLocal.uid && etatLocal.uid !== user.uid) {
                // Un AUTRE compte sur cet appareil : ce qui a été synchronisé n'a rien à voir avec lui.
                etatLocal = { uid: user.uid, docs: {}, supprimes: {} };
            }
            etatLocal.uid = user.uid;
            ecrireEtatLocal();
            refIndex = db.collection('users').doc(user.uid).collection('apps').doc(slug);
            afficher('syncing');
            desabonner = refIndex.onSnapshot(function (snap) {
                if (snap.metadata && snap.metadata.hasPendingWrites) return;
                if (snap.metadata && snap.metadata.fromCache) {
                    // Pas le nuage : la mémoire de cet appareil (ou son absence). On ne décide de rien.
                    afficher('hors-ligne', 'Hors ligne — tes modifications partiront au retour du réseau.');
                    return;
                }
                indexPret = true;
                var d = snap.exists ? snap.data() : null;
                index = { docs: (d && d.docs) || {}, meta: (d && d.meta) || null };
                prevenirCatalogue();
                rapprocher();
            }, function (e) {
                console.error('Écoute du nuage interrompue', e);
                afficher('error', expliquer(e));
            });
        }

        // ---------- API -----------------------------------------------------------------------------

        var api = {
            demarrer: function () {
                if (!fb || !options.config) { console.warn('Firebase indisponible : mode local uniquement.'); return false; }
                try {
                    app = fb.apps && fb.apps.length ? fb.app() : fb.initializeApp(options.config);
                    auth = fb.auth();
                    db = fb.firestore();
                    auth.onAuthStateChanged(surAuth);
                    return true;
                } catch (e) {
                    console.error('Initialisation Firebase impossible', e);
                    return false;
                }
            },
            connecter: function () {
                if (!auth) return Promise.reject(new Error('Firebase indisponible'));
                return auth.signInWithPopup(new fb.auth.GoogleAuthProvider());
            },
            deconnecter: function () { return auth ? auth.signOut() : Promise.resolve(); },
            changement: changement,
            rapprocher: rapprocher,
            /** Suppression VOULUE d'un morceau (bouton « Supprimer du nuage »). */
            supprimer: function (id, titre) {
                if (!utilisateur) { etatLocal.supprimes[id] = maintenant(); ecrireEtatLocal(); return Promise.resolve(); }
                return marquerSupprime(id, titre).catch(function (e) { afficher('error', expliquer(e)); throw e; });
            },
            catalogue: catalogue,
            /** Récupère un morceau du nuage et le donne à l'adaptateur (TabHub : l'ouvre dans un onglet). */
            ouvrirDistant: function (id) {
                if (!utilisateur) return Promise.reject(new Error('Non connecté'));
                return lireDoc(id).then(function (d) {
                    if (!d) throw new Error('Ce morceau n\'existe plus dans le nuage.');
                    var r = entreeIndex(id) || {};
                    appliquer(id, JSON.parse(d.json), r.u || d.u, r.t || d.t);
                });
            },
            /** Tout ce que le nuage contient, pour la sauvegarde de secours sur disque. */
            toutLeNuage: function () {
                if (!utilisateur) return Promise.reject(new Error('Non connecté'));
                var vivants = catalogue().filter(function (e) { return !e.supprime; });
                return Promise.all(vivants.map(function (e) {
                    return lireDoc(e.id).then(function (d) { return d ? { id: e.id, titre: e.titre, donnees: JSON.parse(d.json) } : null; });
                })).then(function (liste) { return liste.filter(Boolean); });
            },
            /** Pose un morceau dans le nuage SANS qu'il existe ici (import d'une sauvegarde de secours). */
            deposer: function (id, titre, donnees) {
                if (!utilisateur) return Promise.reject(new Error('Non connecté'));
                return enfiler(function () { return envoyer(id, titre, donnees, true); });
            },
            /** Le contenu d'un morceau du nuage, ou null. */
            lireDistant: function (id) {
                if (!utilisateur) return Promise.reject(new Error('Non connecté'));
                return lireDoc(id).then(function (d) { return d ? JSON.parse(d.json) : null; });
            },
            /** Ce morceau-ci est-il, à l'instant, identique à ce que le nuage contient ? C'est ce qui permet
             *  de ne plus avertir « travail non exporté » quand il est déjà en sécurité ailleurs. */
            estSynchro: function (id) {
                if (!utilisateur || !indexPret) return false;
                var l = adaptateur.lire(id);
                var rec = etatLocal.docs[id];
                return l !== undefined && l !== null && !!rec && rec.h === empreinteDe(l);
            },
            toutEstSynchro: function () {
                if (!utilisateur || !indexPret) return false;
                return adaptateur.lister().every(function (l) {
                    var rec = etatLocal.docs[l.id];
                    return !!rec && rec.h === empreinteDe(l.donnees);
                });
            },
            enAttente: function () { return etatAffiche === 'syncing' || etatAffiche === 'error'; },
            etat: function () { return { mode: etatAffiche, message: dernierMessage, connecte: !!utilisateur, utilisateur: utilisateur }; },
            secours: lireSecours,
            /** Pour les bancs : l'état de rapprochement tel que le moteur le voit. */
            _diagnostic: function () { return { etatLocal: etatLocal, index: index }; },
            arreter: function () { arrete = true; if (desabonner) desabonner(); if (minuterie) clearTimeout(minuterie); if (minuterieReessai) clearTimeout(minuterieReessai); },
        };
        return api;
    }

    global.Nuage = { creer: creer, empreinteTexte: empreinteTexte, idSur: idSur };
})(typeof window !== 'undefined' ? window : globalThis);
