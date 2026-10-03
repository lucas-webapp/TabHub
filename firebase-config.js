// Config publique de Firebase pour TabHub (projet partagé lucas-apps, le même que TrainHub et HarmoHub).
// Ces identifiants ne sont pas des secrets : l'accès aux données est protégé
// par les règles de sécurité Firestore, pas par la confidentialité de ce fichier.
// appId : celui de l'application web créée dans la console Firebase (Paramètres du projet > Vos
// applications), et non plus celui de TrainHub. Il ne sert ni à l'authentification ni à Firestore
// (seuls apiKey, authDomain et projectId comptent), mais il identifie CETTE app dans Firebase.
var FIREBASE_CONFIG = {
    apiKey: "AIzaSyBneiQUsoaLjPr18c1dRHjpZ9xswJC6H3E",
    authDomain: "lucas-apps-479b9.firebaseapp.com",
    projectId: "lucas-apps-479b9",
    storageBucket: "lucas-apps-479b9.firebasestorage.app",
    messagingSenderId: "1000530733464",
    appId: "1:1000530733464:web:8c70f9acc57e40ccada3ed"
};

// Identifiant de cette app dans la base partagée : chaque app écrit sous
// users/{uid}/apps/<identifiant>… sans jamais toucher à celles des autres.
var FIREBASE_APP_SLUG = "tabhub";
