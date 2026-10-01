// Config publique de l'app Firebase "TabHub" (projet partagé lucas-apps).
// Ces identifiants ne sont pas des secrets : l'accès aux données est protégé
// par les règles de sécurité Firestore, pas par la confidentialité de ce fichier.
//
// PROJET PARTAGÉ, PAS UN PROJET PAR APPLI. TrainHub écrit dans ce même projet avec
// un identifiant d'app différent (voir FIREBASE_APP_SLUG ci-dessous) — c'est ce que
// son propre fichier de config annonçait déjà : « voir aussi HarmoHub/TabHub, qui
// utiliseront le même projet avec un identifiant différent ». Un seul compte Google,
// une seule connexion, trois applis qui rangent leurs données côte à côte sous
// users/{uid}/apps/{slug}. Rien ne se mélange, et il n'y a qu'un jeu de règles de
// sécurité à tenir.
//
// SI TU PRÉFÈRES UN PROJET FIREBASE DÉDIÉ À HARMOHUB : remplace les six valeurs
// ci-dessous par celles de ce projet (console Firebase → Paramètres du projet →
// Tes applications → Configuration du SDK). Rien d'autre ne change dans le code.
// Attention alors : ce sera une base séparée, donc une connexion séparée, et les
// données déjà écrites dans le projet partagé ne suivront pas toutes seules.
// ⚠ À VÉRIFIER PAR TOI, dans la console Firebase (Paramètres du projet → Tes applications) :
//   - `appId` ci-dessous est celui de TrainHub, repris faute de connaître celui de l'app « TabHub » que
//     tu as créée. À ma connaissance Auth et Firestore ne s'en servent pas (il sert à Analytics et aux
//     notifications), donc ça ne bloque rien — mais remplace-le par le bon pour que chaque appli soit
//     identifiée correctement dans la console.
//   - Si « TabHub » est en fait un PROJET Firebase à part et non une appli du projet lucas-apps,
//     il faut remplacer les SIX valeurs, pas seulement appId (voir plus haut).
//   - Les RÈGLES FIRESTORE doivent autoriser le chemin users/{uid}/apps/tabhub. Si elles sont de la
//     forme « match /users/{uid}/apps/{appId} », c'est déjà bon. Si elles nomment « trainhub », il faut
//     y ajouter « tabhub » — sinon la pastille affichera « permission-denied » au survol.
//   - Le domaine qui sert TabHub doit figurer dans Authentication → Paramètres → Domaines autorisés
//     (déjà le cas s'il s'agit du même domaine que TrainHub).
var FIREBASE_CONFIG = {
    apiKey: "AIzaSyBneiQUsoaLjPr18c1dRHjpZ9xswJC6H3E",
    authDomain: "lucas-apps-479b9.firebaseapp.com",
    projectId: "lucas-apps-479b9",
    storageBucket: "lucas-apps-479b9.firebasestorage.app",
    messagingSenderId: "1000530733464",
    appId: "1:1000530733464:web:504eae847189524bada3ed"
};

// Identifiant de cette app dans la base partagée. TrainHub utilise "trainhub",
// TabHub utilisera "tabhub" : c'est ce qui sépare les données des trois applis.
var FIREBASE_APP_SLUG = "tabhub";
