# Bancs d'essai TabHub

**57 bancs, 1670 vérifications**, dans l'esprit de ceux de HarmoHub : chacun documente en tête CE
QU'IL PROTÈGE et pourquoi. Ils valent autant comme mémoire des décisions que comme filet de sécurité
— plusieurs d'entre eux existent parce qu'ils ont attrapé un vrai défaut, et le commentaire le
raconte.

Le tableau ci-dessous est une SÉLECTION, pas l'inventaire : `tests/*_test.js` fait foi, et chaque
fichier s'ouvre sur ce qu'il protège. On y trouve aussi bien les fondations que les retours
utilisateur devenus des cas permanents.

| Banc | Ce qu'il protège |
|---|---|
| `modele_test.js` | Théorie, durées, accordages, normalisation d'un fichier importé. **Sans navigateur.** |
| `saisie_clavier_test.js` | Cases à deux chiffres, prolongation de mesure par `→`, accords, annulation |
| `liaisons_test.js` | Les liaisons qui FRANCHISSENT une barre de mesure, sans navigateur : l'arc sur la même ligne, les deux demi-arcs au saut de ligne, et surtout le fait que chaque arc vive DANS la tranche de primitives de son système — les rendus découpent par système, et une passe finale émettait des arcs que personne ne dessinait |
| `deux_voix_test.js` | La SECONDE VOIX rendue accessible à la guitare et à la basse : le bouton « 2 voix » (Alt+V) dans le cadre Écriture, le repère `Voix 1 → 2` qui dit où l'on écrit, les deux grains du menu contextuel (cette mesure / tout le morceau) en UN seul retour en arrière, la gravure elle-même (hampes opposées, silences décalés) et le fait que ces commandes quittent la palette sous 720 px pour ne pas faire déborder la barre |
| `vitesse_test.js` | Ralentir pour travailler SANS réécrire le morceau : l'horloge vaut bien tempo × vitesse, le tempo écrit ne bouge ni dans `meta` ni dans le champ ni à l'export, la lecture ne remet pas la vitesse à 100 % (`programmer()` posait l'horloge en direct et effaçait le réglage à la première note), on peut ralentir en pleine lecture, les bornes tiennent — et la place du bouton, mesurée : présent sur grand écran, remplacé sur téléphone par un rang dans le popover voisin, faute de 46px à prendre dans la barre du bas |
| `rendu_double_portee_test.js` | Cinq lignes + six cordes, alignement des deux portées, découpage en systèmes |
| `accordages_test.js` | Trois instruments, accordages prédéfinis et personnalisés, capodastre |
| `musicxml_test.js` | L'export MusicXML, en trois familles : que c'est du XML bien formé et l'arbre annoncé (l'ORDRE des éléments, que le format impose dans `<attributes>` et `<note>` — une permutation rend le fichier invalide) ; les invariants qui ne se devinent pas (corde + case + capodastre redonne la hauteur écrite, et les `<backup>` ramènent exactement au début de la mesure) ; et ce que l'utilisateur verra vraiment — liaisons par-dessus la barre, n-olets et leur crochet, hammer-on en arc ET en technique, slides en `<glissando>` et non en `<slide>`, deux voix aux hampes opposées, reprises, repères, noms d'accords en vraies `<harmony>`, accordage, capodastre, et le bécarre d'un si naturel en fa majeur. Deux de ses vérifications portent une décision prise HORS banc, par validation contre le schéma officiel du W3C et relecture par un moteur de gravure tiers : le capodastre fondu dans l'accordage (sans quoi le fichier se contredisait d'une portée à l'autre) et les hammer-on/pull-off/bend posés sur la notation (sans quoi un lecteur les jette) |
| `nommage_fichiers_test.js` | La forme « TabHub - Morceau - Type - Date Heure.ext », reprise de HarmoHub : l'ordre des segments et ce que chacun règle, l'horodatage qui se trie tout seul et sépare deux exports du même jour, l'assainissement complet (caractères interdits, caractères de contrôle, points et espaces en FIN de nom que Windows efface en silence, longueur bornée), le repli ASCII propre à TabHub, le nom du morceau relu depuis le nom de fichier même quand il contient lui-même « - », le piège du préfixe (« Étude » contre « Étude - live ») et les cinq routes d'export qui passent toutes par là |
| `rangement_fichiers_test.js` | L'étage du HAUT : écrire dans un dossier choisi. L'arborescence créée d'un coup, les quatre routes qui écrivent chacune dans son dossier sans que le NOM change, le fichier relisible — et surtout les QUATRE PANNES, jouées pour de vrai : dossier disparu en cours de route, navigateur sans l'API, sélecteur refermé, dossier oublié. Le sélecteur système est remplacé par un dossier OPFS de même interface, donc c'est le vrai code qui est éprouvé |
| `garde_fous_fichiers_test.js` | Lire le disque avant de l'écraser : un nom CANONIQUE (un seul fichier après trois enregistrements, pas trois candidats), les états précédents poussés dans `_versions/` et datés à la SECONDE (à la minute ils s'écrasaient entre eux — onze enregistrements, une seule archive), la rotation à dix, et les deux conflits qui n'écrivent RIEN : un fichier plus récent que la version ouverte ici, et un AUTRE morceau au même titre (distingué par sa date de création) |
| `protections_fichiers_test.js` | Ce qui protège le travail quand le navigateur, lui, ne promet rien : `persist()` demandé au démarrage, le rappel de fraîcheur au-delà de cinq jours sans fichier (une fois par jour au plus, et jamais pour quelqu'un qui n'a pas travaillé depuis), le repère posé sur `visibilitychange` et non `beforeunload` — absent d'iOS — et la feuille de partage système proposée avant de télécharger à l'aveugle, en ne passant QUE `files` |
| `ouverture_decision_test.js` | Ouvrir le MÊME morceau n'est pas ouvrir un autre morceau : l'identité par date de création puis, à défaut, par TITRE (casse et espaces indifférentes, « Étude (2) » restant distinct) — sans ce repli, un fichier reçu d'ailleurs ne déclenchait aucun conflit et empilait un morceau de plus sous le même titre. La fenêtre MONTRE ce qui distingue les deux versions, et « garder les deux » ouvre un ONGLET au lieu de renommer une copie |
| `disque_test.js` | Le panneau qui lit le DOSSIER et non l'application : l'inventaire groupé par morceau d'après le NOM de fichier (un PDF n'a aucun contenu interrogeable), reprendre un morceau que TabHub ne connaît plus, et la suppression — dont la sûreté vient de ce que la liste exacte est AFFICHÉE avant de demander. La neutralisation du garde-fou de préfixe montre le désastre : supprimer « Etude » emporte les fichiers d'« Etude - live » |
| `deux_fenetres_test.js` | LA MÊME APPLICATION OUVERTE DEUX FOIS — deux vraies pages dans un même contexte, seule façon de partager `localStorage` et le dossier. Le brouillon FUSIONNE au lieu de s'écraser (et un onglet fermé ne ressuscite pas), et le garde-fou du disque est joué de bout en bout : la seconde fenêtre est arrêtée, le travail de la première reste intact, « garder les deux » pose le sien à côté, et écraser archive l'ancien |
| `exports_test.js` | Aller-retour `.json` sans perte, PDF réellement vectoriel |
| `lecture_audio_test.js` | Transport, fusion des liaisons, tête de lecture accrochée à l'horloge audio, et LE CHEMIN DE CHARGEMENT RÉUSSI du piano — échantillons servis par le banc, car le réseau bloqué ne le joue jamais |
| `effets_test.js` | Les effets, de la commande au SON : un slide fusionne ses deux notes, et sa hauteur glisse sur un échantillon de PIANO (la voix synthétisée ne servant plus que hors ligne) |
| `performance_test.js` | Le coût d'un redessin ne suit pas la longueur du morceau |
| `rythme_test.js` | Le séquenceur rythmique : grille continue, pilules, gestes (poser/étirer/déplacer/enlever), les trois ZONES d'une note (poignée / corps, en pixels) avec leurs repères de survol, le CLAVIER (focus baladeur, flèches, Maj+flèches, Suppr), deux mesures par rangée, mesure de départ, boucle en direct, tonique du morceau, motifs tout prêts, note liée par-dessus la barre remplie d'une seule frappe, réouverture sur le rythme déjà écrit, et les deux garde-fous (Boucler à vide, écrasement de notes) |
| `conversion_rythme_test.js` | La conversion cellules → FIGURES, sans navigateur : la règle d'alignement des silences, le droit qu'a une note d'enjamber un temps (la syncope), les triolets et leur « 3 » par temps, les divisions propres à chaque famille de mesure (pas de triple-croche en 6/8, pas de faux triolet en mesure composée), la liaison par-dessus la barre, la requantification qui ne jette pas le travail, l'aller-retour grille → partition → grille, les dix-neuf motifs tout prêts, et deux balayages exhaustifs (256 motifs binaires, 64 ternaires) |
| `rythme_impose_test.js` | Taper une case NE change PAS la durée d'un rythme imposé, et la surbrillance survit |
| `ternaire_test.js` | Une seule grille de temps pour l'audio, le métronome et le MIDI ; la tête de lecture repasse par la réciproque ; l'indication gravée |
| `midi_test.js` | Aller-retour `.mid`, doigté par zone de manche, export par section, notes de même hauteur chevauchées |
| `import_rythme_test.js` | Triolets et swing importés JUSTE : une grille par temps, la question binaire/ternaire, la détection qui ne confond pas swing et vrais triolets |
| `onglets_test.js` | Plusieurs morceaux ouverts : l'ÉTANCHÉITÉ des documents, ce qui reste commun (durée, presse-papier), le brouillon multi-onglets, et rien au doigt |
| `boucle_lecture_test.js` | La bande orange : geste souris/doigt, poignées, l'ancrage qui la fait suivre ses mesures, l'aperçu qui suit le PIXEL (mesuré : quatre largeurs distinctes dans UNE mesure), le fantôme qui la rend découvrable, le défilement sous un doigt immobile, la prise des poignées mesurée par balayage, et l'annulation qui la couvre sans mélanger les deux histoires |
| `zoom_ecran_test.js` | Les loupes changent la GRAVURE (pas un nombre) ; `Ctrl+molette` zoome la partition en confisquant le geste, et le laisse au navigateur partout ailleurs |
| `pwa_test.js` | L'icône d'écran d'accueil et la marque : `apple-touch-icon` carré plein cadre, PNG du manifest, et surtout le favicon qui trace EXACTEMENT les mêmes chemins que le logo de la barre du haut — lettres en chemins (pas de `<text>`), détourage par masque (pas un liseré peint du fond), cordes d'opacité uniforme, et une marge d'encre mesurée de 8 px sur les flancs / 9 px en haut et en bas. **Sans navigateur.** |
| `tactile_test.js` | Écrire au doigt (pavé, tap, appui long, glisser qui défile), le séquenceur rythmique au doigt (cases étirées plutôt que défilantes, mesures empilées, glissé qui pose une note) et le pincement à deux doigts qui zoome la partition, pas la page |

## Lancer

```sh
npm i -g playwright && playwright install chromium   # une fois
python3 -m http.server 8945                          # depuis la racine du dépôt
node tests/modele_test.js                            # un banc
tests/run_all.sh                                     # tous, en série
```

`TABHUB_URL` remplace l'adresse par défaut (`http://localhost:8945`).

Si Playwright est installé globalement, `tests/_page.js` va le chercher dans les emplacements
habituels — sinon, exportez `NODE_PATH` vers le dossier des modules globaux.

## Le harnais

`_harness.js` est repris tel quel de HarmoHub. Son apport principal est `plan(n)` : le banc déclare
combien de vérifications il doit exécuter AU MINIMUM, et le harnais signale de lui-même s'il s'est
arrêté en route. Un compteur de PASS mesure ce qui s'est exécuté, jamais ce qui aurait dû l'être —
un banc qui perd la moitié de ses vérifications paraît en meilleure santé qu'avant.

`exiger(condition, libellé)` marque une PRÉCONDITION : elle compte comme une vérification normale,
mais retient en plus que la suite a probablement été sautée, pour que le bilan le dise.

## Avant de « réparer » un banc rouge

Un banc rouge signifie l'une de deux choses OPPOSÉES : l'application est cassée, ou le banc décrit un
comportement qui a changé à la demande. Les confondre coûte cher dans les deux sens. Trois exemples
déjà rencontrés pendant l'écriture, et ce qu'ils ont donné :

- **« huit croches restent dans la première mesure » rouge** → c'était l'application. `→` sautait à la
  mesure suivante au lieu de prolonger la mesure en cours, ce qui dispersait un trait de croches sur
  huit mesures. Corrigé dans `commands.js`.
- **« ces trois cases sonnent le même mi » rouge** → c'était le BANC. Les cordes d'une guitare sont
  accordées de quarte en quarte sauf entre sol et si, où l'intervalle est une tierce. Le code avait
  raison ; l'attente du banc était fausse.
- **« la note martelée sonne plus doucement » rouge** → c'était l'application. Le champ `lien` décrit
  ce qui va vers la note SUIVANTE ; le lecteur l'appliquait à la note courante, donc atténuait celle
  qu'on venait d'attaquer plutôt que celle obtenue au marteau. Corrigé dans `player.js`.

- **« seuls les systèmes visibles sont dessinés » rouge** → c'était le BANC. Il opposait 8 mesures à
  200 ; les 8 tenaient dans la fenêtre, donc dessinaient moins de systèmes que le plafond du visible.
  La propriété à éprouver n'était pas « les deux dessinent autant » mais « au-delà d'un écran, le coût
  cesse de monter ».

Dans le doute : rejouer le banc sur le commit d'AVANT (via `git worktree`, servi sur un second port).
S'il y échoue à l'identique, ce n'est pas une régression.
