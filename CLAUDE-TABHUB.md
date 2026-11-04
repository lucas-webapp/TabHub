# TabHub — consignes de travail

Éditeur web de **tablatures et partitions** (guitare, basse, piano), HTML / JS en modules ES, **sans build ni framework**. Compagnon de HarmoHub
(`lucas-webapp/HarmoHub`) et de TrainHub. **Tout se dit et s'écrit en français** : échanges, commentaires, messages de commit, journal.
Lire d'abord `README.md` (choix techniques, nuage, pièges) et `tests/README.md` (bancs) ; ce fichier dit où en est le chantier et comment travailler.

Nom volontairement distinct de `CLAUDE.md` pour ne pas le confondre avec celui de HarmoHub : si la session ne le charge pas toute seule, **le lire en entier
au début**.

## Deux lignes de TabHub, à ne pas mélanger

| | Branche | Ce qu'elle contient |
|---|---|---|
| **Travail** (la version vivante, celle que l'utilisateur utilise : appli du Dock sur Mac / Safari) | **`claude/tabhub-travail-Claude`** | onglets, versions précédentes, nuage **par morceau** (`src/io/nuage.js`), retrouver / restaurer ses morceaux, test de précision de la lecture |
| **`main`** (gardée « pour plus tard ») | `main` | **un seul brouillon** au cloud (`synchro-cloud.js` + `src/io/synchro.js`), pilule de compte commune (`compte-cloud.js`), effet « verre » (`verre.js`, `verre.css`), test de précision |

Les deux écrivent dans **le même document** Firestore `users/{uid}/apps/tabhub` : le brouillon de `main` le *remplace* en entier, l'index de la branche de
travail y met la liste des morceaux (`docs`). Voir « Le nuage » plus bas. **On ne fusionne pas les deux lignes sans décision de l'utilisateur.**
Le verre et la pilule de compte **ne sont pas** dans la branche de travail (décision à prendre : les y porter ou non).

Dépôts dans le conteneur (éphémère, à recloner au besoin) : `/home/user/tabhub` (= `main`) ; la branche de travail s'ouvre dans un worktree à part
(`git worktree add /tmp/th_work origin/claude/tabhub-travail-Claude`). HarmoHub : `/home/user/HarmoHub`.

## Où en est le chantier

- **Livré et poussé sur la branche de travail** (dernier commit : *Retrouver ses morceaux depuis le nuage, sans réimporter de JSON*) :
  - nuage par morceau : chaque morceau a son document `tabhub__<id>`, l'index (`tabhub`) ne fait que les lister ;
  - **retrouver ses morceaux** : index vide à la connexion → les morceaux sont retrouvés seuls (une fois par séance) ; bouton « Retrouver mes morceaux » ;
    « Supprimés récemment » + Restaurer ; liste ouverte toute seule sur un appareil vide ; une page blanche n'est jamais envoyée au nuage ;
  - **test de précision de la lecture** (Réglages > « Précision de la lecture », `src/audio/precision.js`) : mesure programmation, rendu, sortie ET ce qui est
    écrit. Sur Safari de l'utilisateur : programmation exacte (0 ms de retard sur 22 notes), attaque médiane du piano 26 ms (écart-type 11,5 ms), et le « décalage » entendu venait de la **partition**
    (silence de triple-croche, mesure de 5 temps), pas du moteur audio.
- **Sur `main`, commit local NON POUSSÉ `106e495`** : garde-fou qui empêche le brouillon de `main` d'écraser un document qui porte `docs`
  (`estIndexDeMorceaux` dans `src/io/synchro.js`). Banc `synchro_cloud_test` : 109 vérifications, 6 sabotages tous détectés. **À pousser seulement si
  l'utilisateur le demande.** `origin/main` est à `50caef7`.
- **En attente de décision / non demandé** : importer plusieurs `.json` d'un coup dans le nuage (`deposer`) ; nettoyer les « Sans titre » vides que les
  anciennes versions ont laissés dans le nuage ; avancer le début des notes de leur délai d'attaque (≈ ±5 ms, jamais demandé) ; porter verre + pilule dans
  la branche de travail.
- **À faire par l'utilisateur dans GitHub** (je ne peux pas supprimer une branche distante d'ici) : supprimer `claude/verre-tabhub`,
  `claude/compte-cloud-tabhub`, `claude/verre-et-compte-tabhub` (il veut ne voir que les branches sur lesquelles on travaille).
- **Ligne de base du balayage** (branche de travail, `tests/run_all.sh`, 87 bancs) : **3 rouges déjà là avant ces travaux** et à ne pas confondre avec une
  régression : `disque` (7/8), `garde_fous_fichiers` (15/16), `rangement_fichiers` (8/9). Tout autre rouge est une régression.

## Git

- Branche de travail : **`claude/tabhub-travail-Claude`**. La session HarmoHub qui l'a menée avait pour branche désignée `claude/tabhub-app-setup-0plidk`
  (dépôt HarmoHub) : ne pas pousser ailleurs que la branche désignée par l'environnement.
- **Pousser sur `main` uniquement quand l'utilisateur le demande**, une pièce à la fois. Pas de branche en plus, pas de pull request sans demande.
- Un commit par sujet, message en français qui dit ce que ça change, terminé par les lignes d'attribution demandées par l'environnement. **Aucun nom de
  modèle ailleurs que dans ces lignes** (ni dans le code, ni dans les commentaires, ni dans les commits).
- Pas de `gh` : GitHub passe par `git` et par les outils MCP `mcp__github__*`. Push qui échoue sur une erreur réseau : réessayer 4 fois (2, 4, 8, 16 s).

## Boucle de travail

1. Lire `README.md` / `tests/README.md` et le code concerné **par plages** (`src/main.js` est très long).
2. Coder, avec des commentaires en français qui disent **POURQUOI** (et citent l'utilisateur quand c'est lui qui l'a demandé).
3. Écrire le banc, puis des **sabotages** : casser UNE ligne de la source, vérifier que le banc rougit, restaurer. Un banc qui exécute **0** vérification
   est *invalide* (pas « rouge »). Un sabotage qui survit est un contrôle manquant : le combler, puis rejouer. Le coureur est `outils/sabotage.py`
   (`python3 outils/sabotage.py config.json [préfixe…]`, config JSON : `racine`, `banc`, `minimum`, `delai`, `env`, `mutations: [[nom, fichier, ancre, remplacement]]`
   — l'ancre doit apparaître **une seule fois**).
4. Balayage complet avant de pousser sur la branche de travail : `sh tests/run_all.sh` (en série, **long**, ~30 min : le lancer en arrière-plan et ne lire que
   `grep -E "^=== |FAIL|FATAL"`). Comparer à la ligne de base ci-dessus.
5. Mettre à jour `README.md` / `tests/README.md` (ce que le banc protège, nombre de vérifications), commit, push.

Serveur : `python3 -m http.server 8945` depuis la racine (les bancs lisent `TABHUB_URL`, `http://localhost:8945` par défaut) ; `NODE_PATH=/opt/node22/lib/node_modules`.
Le serveur **meurt quand le conteneur redémarre** : le relancer (par son PID, jamais `pkill -f`, qui tue aussi le shell). Playwright et Chromium sont préinstallés,
ne rien réinstaller. Sans accès à un vrai Firebase : les bancs utilisent des faux (`tests/_firebase_factice.js` pour le moteur et la branche de travail,
`tests/_firebase_faux.js` sur `main`).

## Écrire un banc (dossier `tests/`)

- Squelette : `require('./_harness')('nom')` → `check`, `exiger`, `plan`, `bilan`. **`plan(n)` doit égaler le nombre exact de vérifications exécutées** : un banc qui
  s'arrête en route est signalé « couverture incomplète » (et c'est parfois la seule chose qui rougit : ajouter une vérification explicite).
- Navigateur : `ouvrirApp({ avant: [...] })`, `avecFauxFirebase({ uid, nom, dejaConnecte })`, `taper` (donne le focus par programme, pas par clic) dans `tests/_page.js`.
  Moteur sans navigateur : `creerBackend` / `creerFirebase` (`tests/_firebase_factice.js` : `retardInstantane`, `sansEcho`, `listages`, `echec`, `horsLigne`).
- De vrais gestes pour ce que fait l'utilisateur ; `window.app` sert à relire l'état. Un banc qui cliquait sur un élément disparu est **réécrit**, jamais supprimé.
- Ne pas écrire de vérification conditionnelle (`if (x) { check(...) }` sans `else`) : une vérification qui disparaît en silence compte comme une couverture qu'on n'a pas.
- Un banc sensible au temps dérive quand plusieurs navigateurs tournent en parallèle : tout se joue **en série**.

## Le nuage de la branche de travail (`src/io/nuage.js`)

- Index `users/{uid}/apps/tabhub` = `{ docs: { <idSur(id)>: { t, u, i, d } }, maj, meta }` ; morceau = document `users/{uid}/apps/tabhub__<idSur(id)>` = `{ id, t, u, json }`.
  `idSur` remplace tout ce qui n'est pas `[A-Za-z0-9_-]` par `-` : **l'identité d'un morceau est `data.id` / `entree.i`, jamais le nom du document**. L'id est `meta.creeLe`.
- Un morceau supprimé n'est **jamais effacé** : l'index porte `d: true`, le contenu reste. `restaurer` remet `d: false` **explicite** (une fusion Firestore ne retire pas un champ).
- Le moteur attend le **premier instantané venu du serveur** avant de décider (`indexPret`) : sans ce verrou, un démarrage lent faisait envoyer tout par-dessus des versions plus récentes.
- `retrouverVraiment` ne **lit** que les documents de morceaux et n'ajoute que les entrées **absentes** (jamais rajeunir, remplacer, ressusciter). Il coûte la lecture de *tous*
  les morceaux : d'où « une fois par séance, index vide » + bouton. Il refuse avant la réponse du nuage.
- `src/io/nuage.js` **diverge** de la copie de HarmoHub (`retrouver`, `restaurer`, `surRetrouves`) : ne pas la recopier d'un côté à l'autre sans reporter ces ajouts.
- Côté `main.js` : `partitionVierge` / `nuageConnait` filtrent ce qu'on envoie ; `surCatalogueNuage` décide d'ouvrir la liste (une fois par séance, jamais si on a écrit, jamais
  si le seul morceau du nuage est la page blanche courante).
- Fichiers partagés, à garder identiques entre dépôts quand on les touche : `compte-cloud.js`, `synchro-cloud.js` (v2), `verre.js`, `verre.css`, `tests/_verre_commun.js`
  (référence : HarmoHub, qui tient `docs/fichiers-partages.md` ; vérifier l'empreinte sha256 après copie). Ils sont sur `main`, pas sur la branche de travail.

## Pièges déjà rencontrés

- **Une page blanche n'est pas un morceau** : sans le filtre, chaque appareil / onglet neuf déposait un « Sans titre » et faisait croire qu'il y avait des morceaux à retrouver.
- **Question de première connexion (`main`)** : quand les deux côtés ont du contenu et que l'appareil n'a jamais été synchronisé, la synchro *demande* laquelle garder avant d'écrire ;
  un banc qui n'y répond pas croit que rien n'a été écrit alors que rien n'a encore été décidé.
- **Lecture de la musique** : Tone.js programme en tics sur l'horloge audio ; mesuré exact sur Safari. Avant de soupçonner le moteur, lancer le test de précision : le coupable
  était dans la partition. L'attaque des échantillons de piano est intrinsèquement de 14 à 27 ms.
- `normaliser` régénère les identifiants internes à chaque appel (l'empreinte du contenu les exclut) ; une accolade `}` en trop dans `style.css` avale en silence la règle suivante
  (`css_equilibre_test` la garde).
- Les bancs `disque`, `garde_fous_fichiers`, `rangement_fichiers` sont rouges depuis avant ces travaux : ne pas les « réparer » au passage sans en parler.

## Ce qui n'est PAS vérifié

- Le **vrai Firestore** : règles de sécurité, domaines autorisés, fenêtre Google sur Safari — les faux reproduisent les refus de *format*, pas d'*autorisation*.
- Que l'utilisateur est **connecté** dans son appli du Dock, et ce que son nuage contient réellement (il a peut-être des « Sans titre » hérités).
- Le verre sur un vrai Safari / iPhone (rendu vu seulement dans Chromium) et sa performance sur un vieux téléphone.
- Après une mise à jour poussée, l'appli du Dock peut montrer l'ancienne version : la fermer et la rouvrir (le `?v=` de `style.css` n'est pas incrémenté dans ce dépôt).

## Économie de contexte

Fichiers très longs : lire par plages (`sed -n`, `offset` / `limit`), filtrer les sorties de bancs (`grep -E "^FAIL|FATAL|^==="`), ne jamais afficher un balayage entier.
Une session par sujet, `/clear` entre deux sujets.
