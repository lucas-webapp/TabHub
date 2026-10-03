// SYNCHRO CLOUD (Firebase) — couche GÉNÉRIQUE, commune à HarmoHub et à TabHub.
//
// Ce fichier ne sait RIEN des morceaux ni des tablatures. Il gère ce qui est identique partout :
// la connexion Google, la référence du document, l'envoi différé, l'écoute des changements venus
// d'ailleurs, la pastille d'état, et le garde-fou à la fermeture. Tout ce qui dépend des données
// est fourni par un ADAPTATEUR (voir `demarrerSynchro` ci-dessous) — HarmoHub en écrit un pour sa
// bibliothèque, TabHub en écrira un pour la sienne. Ce fichier peut donc être copié tel quel d'un
// dépôt à l'autre.
//
// D'OÙ ÇA VIENT. La mécanique est celle de TrainHub, qui fonctionne : même projet Firebase partagé,
// même chemin `users/{uid}/apps/{slug}`, même connexion par fenêtre Google, même SDK « compat »
// chargé par balises <script> (ce projet n'a aucune chaîne de build). Trois choses en plus, parce
// qu'une bibliothèque de morceaux n'est pas un état unique comme celui de TrainHub :
//   1. FUSION ET NON REMPLACEMENT. TrainHub remplace tout l'état par la version la plus récente.
//      Avec une bibliothèque modifiée depuis trois navigateurs, ça ferait perdre les modifications
//      de l'un pour garder celles de l'autre. L'adaptateur fournit donc `fusionner(local, distant)`,
//      et chaque envoi se fait dans une TRANSACTION : on relit le distant, on fusionne, on écrit.
//   2. LE PLAFOND D'UN DOCUMENT. Firestore refuse un document de plus de 1 Mio. Plutôt que d'échouer
//      sans un mot le jour où la bibliothèque y arrive, on mesure avant d'écrire et on prévient bien
//      avant (voir `TAILLE_ALERTE`).
//   3. L'ÉTAT EST TOUJOURS DIT. Retour utilisateur : « l'enregistrement me semble trop aléatoire ».
//      La pastille ne se contente pas d'une couleur : elle a un libellé précis pour chaque situation,
//      dont celle qui compte le plus — « des modifications n'ont pas encore été envoyées ».
//
// CE QUE CE FICHIER NE PEUT PAS GARANTIR, et qu'il faut savoir : il n'a été éprouvé que contre un
// Firebase SIMULÉ (voir tests/_firebase_faux.js). Les règles de sécurité Firestore, les domaines
// autorisés de l'authentification et le comportement réel de la fenêtre Google sur Safari ne se
// vérifient que sur de vrais appareils.

// Au-delà de ce poids, on prévient : Firestore plafonne un document à 1 048 576 octets, et on préfère
// être averti à 80 % que découvrir le plafond par une erreur d'écriture.
var TAILLE_ALERTE = 800 * 1024;
var TAILLE_MAX = 1000 * 1024;
var DELAI_ENVOI_MS = 1500;

// Une instance par page. Exposée pour les bancs, qui ont besoin de la piloter.
var SYNCHRO = null;

function poidsOctets(objet) {
    try { return new Blob([JSON.stringify(objet)]).size; } catch (e) { return 0; }
}

// adaptateur = {
//   slug          : identifiant de l'appli dans la base partagée (« harmohub », « tabhub »…) ;
//   lire()        : rend l'état local sérialisable ;
//   fusionner(local, distant) : rend { fusionne, changeLocal, changeDistant } — `fusionne` est l'état
//                   à écrire des deux côtés, `changeLocal` dit s'il diffère de l'état local, et
//                   `changeDistant === false` qu'il est identique à ce qui est déjà au cloud (on n'écrit pas) ;
//   appliquer(etat, resume, origine) : écrit `etat` en local ET rafraîchit l'affichage ; `origine`
//                   vaut 'reception', 'envoi' ou 'reprise' ;
//   versDocument(etat)        : transforme l'état en document Firestore VALIDE (pas de tableau
//                   imbriqué, pas de `undefined`) ;
//   apresSynchro(resultat)    : appelée après CHAQUE synchro réussie, quel qu'en soit le sens, avec le
//                   résultat de la fusion (pour ranger, par exemple, une copie de secours) ;
//   surCompte(uid)            : (optionnel) appelée à la connexion, pour repartir de zéro si le compte
//                   n'est plus celui de la dernière synchro ;
//   dejaSynchronise()         : vrai si cet appareil a déjà été synchronisé avec ce compte ;
//   premiereConnexion(local, distant) : (optionnel) rend une promesse, appelée quand cet appareil n'a
//                   JAMAIS été synchronisé ET que le cloud contient déjà quelque chose — c'est le moment
//                   de demander plutôt que de fusionner en silence ;
//   estVide(etat) : vrai si l'état ne contient rien d'utile,
// }
function demarrerSynchro(adaptateur, elements) {
    var etat = {
        firebase: null, auth: null, db: null, utilisateur: null, docRef: null,
        desabonner: null, minuteur: null, statut: null, derniereErreur: '',
        envoiEnCours: false, modifsEnAttente: false, appliqueDistant: false,
        dernierEnvoiAt: 0,
    };
    SYNCHRO = { etat: etat, adaptateur: adaptateur };

    var $statut = elements.statut;
    var $connexion = elements.connexion;
    var $compte = elements.compte;
    var $nomCompte = elements.nomCompte;
    var $deconnexion = elements.deconnexion;

    // ---------- pastille d'état ----------
    var LIBELLES = {
        synced: 'Synchronisé avec le cloud',
        syncing: 'Envoi en cours…',
        pending: 'Modifications pas encore envoyées',
        error: 'Erreur de synchronisation — la dernière version reste enregistrée sur cet appareil',
        offline: 'Hors ligne — les modifications partiront au retour du réseau',
        toolarge: 'Bibliothèque trop volumineuse pour le cloud — fais une sauvegarde sur disque'
    };

    function dire(mode, detail) {
        // Le détail du poids est CONSERVÉ d'un appel à l'autre : « synchronisé » est annoncé depuis
        // quatre endroits (envoi, réception, connexion, reprise), et l'avertissement « bibliothèque à
        // 80 % du plafond » posé par l'un était aussitôt effacé par le suivant. Le voir disparaître à
        // peine affiché reviendrait à ne jamais le voir.
        if (mode === 'synced' && detail === undefined) detail = etat.detailPoids || '';
        etat.statut = mode;
        // `surEtat` : pour une appli qui n'a PAS la place d'un élément dédié (TabHub porte sa pastille sur
        // le bouton Enregistrer). Appelé à chaque changement, avec le libellé déjà composé.
        if (elements.surEtat) {
            var lib = LIBELLES[mode] || 'Non synchronisé';
            elements.surEtat(mode, detail ? lib + ' — ' + detail : lib, !!etat.utilisateur);
        }
        if (!$statut) return;
        $statut.hidden = !etat.utilisateur;
        $statut.classList.remove('synced', 'syncing', 'pending', 'error', 'offline', 'toolarge');
        if (mode) $statut.classList.add(mode);
        var libelle = LIBELLES[mode] || 'Non synchronisé';
        $statut.title = detail ? libelle + ' — ' + detail : libelle;
        $statut.setAttribute('aria-label', $statut.title);
        $statut.dataset.etat = mode || '';
    }

    function majInterfaceCompte(user) {
        if (!$connexion) return;
        $connexion.hidden = !!user;
        if ($compte) $compte.hidden = !user;
        if ($nomCompte) $nomCompte.textContent = user ? (user.displayName || user.email || 'Connecté') : '';
        if ($compte) $compte.title = user ? 'Connecté : ' + (user.displayName || user.email || '') : '';
    }

    // ---------- garde-fou à la fermeture ----------
    // La copie locale est faite AVANT d'essayer d'envoyer (voir l'adaptateur) : fermer l'onglet ne perd
    // donc rien SUR CET appareil. Ce qui peut manquer, c'est la dernière version côté cloud — gênant si
    // on rouvre ailleurs avant que l'envoi ait abouti. On prévient dans ce cas précis, et seulement.
    // Sur iOS `beforeunload` n'est pas fiable (voir aussi `visibilitychange` ci-dessous) : c'est un filet
    // de plus, pas le seul.
    window.addEventListener('beforeunload', function (e) {
        if (!etat.utilisateur) return;
        if (!(etat.modifsEnAttente || etat.envoiEnCours || etat.statut === 'error')) return;
        // « Trop volumineux » : fermer n'y change rien et le cloud ne sera pas à jour de toute façon.
        // Avertir à CHAQUE fermeture pour quelque chose qu'on ne peut pas résoudre sur le champ serait
        // du harcèlement ; la pastille rouge, elle, reste.
        if (etat.statut === 'toolarge') return;
        e.preventDefault();
        e.returnValue = '';
        return '';
    });

    // Le signal qui arrive VRAIMENT sur iPhone et dans l'app du Dock (onglet balayé, app basculée,
    // écran verrouillé) : on tente l'envoi sans attendre le délai. Un envoi lancé au moment où la page
    // se cache n'est pas garanti d'aboutir, mais c'est la meilleure chance qu'on ait, et elle ne coûte
    // rien quand il n'y a rien à envoyer.
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden' && etat.modifsEnAttente) envoyerMaintenant();
    });

    // Le retour du réseau relance l'envoi en attente au lieu d'attendre la prochaine modification.
    window.addEventListener('online', function () { if (etat.modifsEnAttente) envoyerMaintenant(); });
    window.addEventListener('offline', function () { if (etat.utilisateur) dire('offline'); });

    // ---------- écoute des changements venus d'ailleurs ----------
    function brancherEcoute() {
        if (!etat.docRef) return;
        etat.desabonner = etat.docRef.onSnapshot(function (snap) {
            // Nos propres écritures reviennent par ici avant confirmation : les ignorer, sinon on
            // traiterait comme « venu d'ailleurs » ce qu'on vient d'envoyer.
            if (!snap.exists || (snap.metadata && snap.metadata.hasPendingWrites)) return;
            // Pas pendant qu'on a des modifications en attente : la transaction d'envoi fusionnera de
            // toute façon avec ce qui est au cloud, et appliquer d'abord ferait clignoter l'écran
            // pour rien.
            if (etat.modifsEnAttente || etat.envoiEnCours) return;
            var distant = snap.data();
            var r = adaptateur.fusionner(adaptateur.lire(), distant);
            if (r.changeLocal) {
                etat.appliqueDistant = true;
                try { adaptateur.appliquer(r.fusionne, r, 'reception'); } finally { etat.appliqueDistant = false; }
            }
            if (adaptateur.apresSynchro) adaptateur.apresSynchro(r);
            dire('synced');
        }, function (e) {
            console.error('Écoute de la synchro interrompue', e);
            etat.derniereErreur = (e && e.code) || '';
            dire('error', etat.derniereErreur);
        });
    }

    // ---------- envoi ----------
    // UNE TRANSACTION, et c'est la différence avec TrainHub : on relit le distant, on fusionne avec le
    // local, on écrit le résultat. Deux appareils qui envoient en même temps ne s'écrasent plus — le
    // second voit le travail du premier et le fusionne.
    function envoyerMaintenant() {
        if (!etat.utilisateur || !etat.docRef || !etat.db) return Promise.resolve();
        if (etat.minuteur) { clearTimeout(etat.minuteur); etat.minuteur = null; }
        if (etat.envoiEnCours) { etat.modifsEnAttente = true; return Promise.resolve(); }
        etat.envoiEnCours = true;
        // REMIS À ZÉRO ICI, AU DÉBUT — et non à la fin. L'envoi relit l'état local au moment de la
        // transaction : tout ce qui est modifié AVANT est donc couvert, et tout ce qui l'est PENDANT
        // remet le drapeau à vrai (voir planifierEnvoi), ce qui relance un envoi. Le remettre à zéro à
        // la fin effaçait au contraire les modifications arrivées pendant l'envoi ; et ne jamais le
        // remettre à zéro, comme je l'avais d'abord écrit, faisait que « il reste des modifications »
        // était TOUJOURS vrai à la fin : la synchro se renvoyait elle-même indéfiniment, une écriture
        // toutes les 1,5 s. Mesuré par un banc qui comptait les écritures — mais trop tôt : il attendait
        // 2,6 s, soit juste avant la deuxième.
        etat.modifsEnAttente = false;
        dire('syncing');
        var aApplique = null, resumeApplique = null;

        return etat.db.runTransaction(function (tx) {
            return tx.get(etat.docRef).then(function (snap) {
                var distant = snap.exists ? snap.data() : null;
                var local = adaptateur.lire();
                var r = distant ? adaptateur.fusionner(local, distant) : { fusionne: local, changeLocal: false };
                // PAS D'ÉCRITURE INUTILE. Quand la fusion rend exactement ce qui est déjà au cloud — un
                // appareil à jour qui se connecte, un appareil périmé qui reprend la version du cloud —,
                // réécrire le même document ne ferait que coûter une écriture (et de la batterie sur
                // téléphone). L'adaptateur le dit par `changeDistant === false` ; absent, on écrit, par
                // prudence.
                if (distant && r.changeDistant === false) {
                    aApplique = r.changeLocal ? r.fusionne : null;
                    resumeApplique = r;
                    return poidsOctets(distant);
                }
                var charge = adaptateur.versDocument(r.fusionne);
                var poids = poidsOctets(charge);
                if (poids > TAILLE_MAX) {
                    var e = new Error('Document trop volumineux : ' + poids + ' octets');
                    e.code = 'harmohub/trop-volumineux';
                    throw e;
                }
                tx.set(etat.docRef, charge);
                aApplique = r.changeLocal ? r.fusionne : null;
                resumeApplique = r;
                return poids;
            });
        }).then(function (poids) {
            etat.envoiEnCours = false;
            // Si quelqu'un a modifié pendant l'envoi, on n'est pas « synchronisé » : on repart.
            var reste = etat.modifsEnAttente;
            etat.dernierEnvoiAt = Date.now();
            etat.tentatives = 0;
            etat.derniereErreur = '';
            if (aApplique) {
                etat.appliqueDistant = true;
                try { adaptateur.appliquer(aApplique, resumeApplique, 'envoi'); } finally { etat.appliqueDistant = false; }
            }
            if (adaptateur.apresSynchro) adaptateur.apresSynchro(resumeApplique);
            etat.detailPoids = poids > TAILLE_ALERTE ? 'bibliothèque à ' + Math.round(poids / 10485.76) + ' % du plafond du cloud' : '';
            dire('synced');
            if (reste) planifierEnvoi();
        }).catch(function (e) {
            etat.envoiEnCours = false;
            etat.derniereErreur = (e && (e.code || e.message)) || 'erreur inconnue';
            console.error('Envoi vers le cloud impossible', e);
            // Les modifications restent « en attente » : rien ne les a fait partir, et la pastille doit
            // le dire. Un échec d'envoi qui repasse en vert serait exactement le mensonge qu'on veut
            // éviter.
            etat.modifsEnAttente = true;
            if (e && e.code === 'harmohub/trop-volumineux') { dire('toolarge'); return; } // réessayer ne le rendrait pas plus petit
            if (typeof navigator !== 'undefined' && navigator.onLine === false) dire('offline');
            else dire('error', etat.derniereErreur);
            // REPRISE AUTOMATIQUE. Sans elle, un échec passager (réseau qui flanche, onglet réveillé trop
            // tôt) laissait les modifications en attente jusqu'à la PROCHAINE modification — potentiellement
            // des heures, et c'est exactement le « trop aléatoire » signalé. Recul progressif : 5 s, 10 s,
            // 20 s… jusqu'à 5 min, pour ne pas marteler un service en difficulté. Le retour du réseau
            // (évènement `online`) passe devant ce délai.
            etat.tentatives = (etat.tentatives || 0) + 1;
            var delai = Math.min(300000, 5000 * Math.pow(2, etat.tentatives - 1));
            if (etat.minuteur) clearTimeout(etat.minuteur);
            etat.minuteur = setTimeout(envoyerMaintenant, delai);
        });
    }

    function planifierEnvoi() {
        if (etat.appliqueDistant) return; // ce qu'on vient de recevoir n'est pas à renvoyer
        if (!etat.utilisateur || !etat.docRef) return;
        etat.modifsEnAttente = true;
        dire('pending');
        if (etat.minuteur) clearTimeout(etat.minuteur);
        etat.minuteur = setTimeout(envoyerMaintenant, DELAI_ENVOI_MS);
    }

    // ---------- connexion ----------
    function surChangementUtilisateur(user) {
        etat.utilisateur = user;
        majInterfaceCompte(user);
        if (etat.desabonner) { etat.desabonner(); etat.desabonner = null; }
        if (!user) {
            etat.docRef = null;
            dire(null);
            return;
        }
        // Même chemin que TrainHub : users/{uid}/apps/{slug}. Les règles de sécurité qui le protègent
        // sont celles du projet partagé — elles ne se voient pas d'ici.
        if (adaptateur.surCompte) adaptateur.surCompte(user.uid);
        etat.docRef = etat.db.collection('users').doc(user.uid).collection('apps').doc(adaptateur.slug);
        dire('syncing');
        etat.docRef.get().then(function (snap) {
            var distant = snap.exists ? snap.data() : null;
            var local = adaptateur.lire();
            if (!distant) return envoyerMaintenant();          // cloud vide : cet appareil l'amorce
            if (adaptateur.estVide && adaptateur.estVide(local)) {
                // Appareil vierge (navigateur neuf, stockage vidé) : on récupère sans rien demander.
                // Écraser le cloud avec du vide est justement ce qu'on ne doit JAMAIS faire.
                var r0 = adaptateur.fusionner(local, distant);
                etat.appliqueDistant = true;
                try { adaptateur.appliquer(r0.fusionne, r0, 'reprise'); } finally { etat.appliqueDistant = false; }
                if (adaptateur.apresSynchro) adaptateur.apresSynchro(r0);
                return null;
            }
            if (adaptateur.premiereConnexion && !adaptateur.dejaSynchronise()) {
                // Les deux côtés ont du contenu et cet appareil n'a jamais été synchronisé : c'est
                // exactement le cas qui fabriquait des doublons. On demande, morceau par morceau.
                return adaptateur.premiereConnexion(local, distant).then(function () { return envoyerMaintenant(); });
            }
            return envoyerMaintenant();
        }).then(function () {
            if (etat.statut !== 'error' && etat.statut !== 'toolarge') dire('synced');
            brancherEcoute();
        }).catch(function (e) {
            console.error('Synchro initiale impossible', e);
            etat.derniereErreur = (e && (e.code || e.message)) || '';
            dire('error', etat.derniereErreur);
            brancherEcoute();
        });
    }

    function initialiser() {
        if (typeof firebase === 'undefined' || typeof FIREBASE_CONFIG === 'undefined') {
            // Mode local uniquement : rien ne casse, la synchro n'existe simplement pas. C'est aussi ce
            // qui se produit hors ligne au premier chargement, quand le SDK n'a pas pu être téléchargé.
            // `info` et non `warn` : ce n'est pas une anomalie. Hors ligne au premier chargement, ou SDK
            // bloqué, l'appli fonctionne exactement comme avant — seule la synchro n'existe pas. Un
            // avertissement à chaque chargement hors ligne noierait les vrais, et faisait échouer tout
            // banc qui compte les avertissements de la console.
            console.info('Firebase indisponible : mode local uniquement.');
            // La RAISON est gardée pour que le menu l'affiche : une entrée qui disparaît sans explication
            // laisse croire à une panne de l'appli (retour utilisateur : « je ne vois pas le bouton »).
            SYNCHRO.raison = typeof firebase === 'undefined'
                ? 'Le service Firebase n\'a pas pu se charger (hors ligne, ou bloqué par un bloqueur de contenu ?)'
                : 'Le fichier firebase-config.js est absent ou illisible';
            if ($connexion) $connexion.hidden = true;
            return false;
        }
        try {
            etat.firebase = firebase.initializeApp(FIREBASE_CONFIG);
            etat.auth = firebase.auth();
            etat.db = firebase.firestore();
            etat.auth.onAuthStateChanged(surChangementUtilisateur);
            return true;
        } catch (e) {
            console.error('Initialisation Firebase impossible', e);
            SYNCHRO.raison = 'Initialisation de Firebase impossible : ' + ((e && e.message) || 'erreur inconnue');
            if ($connexion) $connexion.hidden = true;
            return false;
        }
    }

    // CONNEXION ET DÉCONNEXION sont des FONCTIONS PUBLIQUES, et non des boutons câblés ici : la barre du
    // morceau est trop serrée sur téléphone pour en porter deux de plus (mesuré : ils renvoyaient les
    // boutons d'action à la ligne). Elles se déclenchent donc depuis le menu Fichier, où vivent déjà tous
    // les échanges avec l'extérieur. Les éléments restent acceptés (`elements.connexion`…) pour une
    // appli qui aurait la place : TabHub, par exemple.
    function seConnecter() {
        if (!etat.auth) return;
        var fournisseur = new firebase.auth.GoogleAuthProvider();
        etat.auth.signInWithPopup(fournisseur).catch(function (e) {
            console.error('Connexion impossible', e);
            // Annuler la fenêtre n'est pas une panne : on ne crie pas pour ça.
            if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) return;
            window.alert('Connexion impossible : ' + (e && e.message ? e.message : 'erreur inconnue'));
        });
    }
    function seDeconnecter() { if (etat.auth) etat.auth.signOut(); }
    if ($connexion) $connexion.addEventListener('click', seConnecter);
    if ($deconnexion) $deconnexion.addEventListener('click', seDeconnecter);

    SYNCHRO.planifierEnvoi = planifierEnvoi;
    SYNCHRO.envoyerMaintenant = envoyerMaintenant;
    SYNCHRO.initialiser = initialiser;
    SYNCHRO.seConnecter = seConnecter;
    SYNCHRO.seDeconnecter = seDeconnecter;
    SYNCHRO.libelleEtat = function () { return LIBELLES[etat.statut] || 'Non synchronisé'; };
    // `disponible` : le SDK a pu démarrer. C'est lui que le menu consulte pour savoir s'il doit proposer
    // de se connecter — inutile d'offrir un bouton qui ne peut rien faire.
    SYNCHRO.disponible = initialiser();
    return SYNCHRO;
}
