# TabHub

Éditeur web de **tablatures et partitions** pour guitare, basse et **piano** : saisie au clavier
(guitare/basse) ou directement sur la portée (piano), double portée solfège + TAB synchronisées (ou
grand-portée à deux clés pour le piano), lecture audio avec tête de lecture, boucle de lecture pour
retravailler un passage, export PDF vectoriel, fichiers `.json` et **MIDI** (import et export).

Application compagnon de [HarmoHub](https://github.com/lucas-webapp/HarmoHub), dont elle reprend
l'architecture et le vocabulaire visuel.

---

## Démarrer

Aucune installation, aucune compilation. Il suffit de servir le dossier en HTTP :

```sh
python3 -m http.server 8945
# puis http://localhost:8945/index.html
```

Un serveur est nécessaire (et non un simple double-clic sur `index.html`) parce que le code est
découpé en modules ES, que les navigateurs refusent de charger depuis `file://`.

---

## Choix techniques, et pourquoi

### Pas de framework, pas de compilation — comme HarmoHub

HarmoHub est du JavaScript natif, sans `package.json`, sans bundler, avec ses bibliothèques
vendorées en local. La consigne était de conserver une cohérence d'architecture ; introduire
React + TypeScript + Vite l'aurait rompue de la façon la plus profonde qui soit — plus aucun
composant partageable, deux façons de construire, deux façons de déployer.

TabHub reste donc en JavaScript natif et se sert du seul mécanisme de modularité que le navigateur
offre sans outillage : les **modules ES**. C'est le point où TabHub s'écarte volontairement de son
aîné, dont le `script.js` unique atteint 17 000 lignes — une dette que son propre dépôt documente.
Le coût est nul (aucune étape de compilation), le gain est un code découpé en unités qu'on peut lire
et éprouver séparément.

### Un moteur de gravure sur mesure, plutôt que VexFlow ou AlphaTab

- **AlphaTab** est conçu pour AFFICHER des fichiers Guitar Pro, pas pour être le moteur d'un éditeur :
  son modèle est en lecture seule dans les faits, et il pèse plus d'un mégaoctet.
- **VexFlow** grave très bien une portée classique, mais la tablature y est un greffon, et surtout il
  ne donne pas la main sur ce dont un éditeur a le plus besoin : savoir OÙ chaque note a été posée,
  pour y placer un curseur, y accrocher une tête de lecture, et savoir sur quoi on vient de cliquer.
- Ni l'un ni l'autre ne sait produire un PDF vectoriel : il faudrait rastériser leur sortie.

Le moteur de TabHub produit une **liste d'affichage** — des primitives géométriques neutres — que
deux traducteurs consomment : SVG pour l'écran, jsPDF pour l'impression. La mise en page n'est donc
écrite qu'UNE fois, et **le PDF est exactement ce qu'on voit à l'écran**, en vectoriel.

### Les signes musicaux viennent de Bravura, la police de référence SMuFL

Clés, altérations, silences, têtes de note, crochets, chiffres de mesure et clé de tablature sont les
dessins officiels de **Bravura** (Steinberg), police de référence du standard SMuFL, publiée sous
**licence SIL Open Font License 1.1** — donc librement utilisable, y compris dans un produit
distribué.

Ils ne sont pas embarqués comme police mais **extraits en chemins vectoriels** par
`outils/generer-glyphes.py`, qui produit `src/engine/glyphes-bravura.js`. Trois raisons :

1. **jsPDF ne sait embarquer que du TrueType.** Bravura est une OpenType/CFF : l'embarquer
   demanderait de la convertir — donc de la modifier, ce que son nom de police réservé décourage — et
   d'ajouter une chaîne d'outillage à un projet qui n'en a aucune.
2. **Une police se charge de façon asynchrone.** Tant qu'elle n'est pas arrivée, la partition
   s'affiche en carrés blancs puis saute. Des contours dans le module sont là dès la première image.
3. **889 ko de police pour 53 signes**, repartant dans chaque PDF exporté. Extraits : 53 ko.

L'architecture y gagne : les contours arrivent dans le **même format que le reste** (chemins M/L/C/Z
en unités d'interligne), donc les deux moteurs de rendu n'ont rien eu à apprendre. Le dessin est
devenu officiel sans qu'une seule ligne de rendu ne change.

Un banc d'essai vérifie que **tout** chemin posé provient bien de l'extraction : un signe redessiné à
la main s'y verrait immédiatement.

### Le coût d'un redessin ne dépend pas de la longueur du morceau

L'éditeur remet en page la partition **entière** à chaque frappe : c'est ce qui rend structurellement
impossible un écran désaccordé du modèle. Sur 150 mesures cette mise en page coûte 14 ms — ce n'est
pas elle le problème. Confier au navigateur les 17 000 éléments qui en sortent, en revanche, coûtait
243 ms, à chaque touche. Deux mesures, toutes deux dans le moteur de rendu :

- une **bibliothèque de glyphes** : chaque dessin décrit une fois dans un `<defs>`, référencé ensuite
  par `<use>` — le SVG passe de 4,4 Mo à 1,8 Mo ;
- le **dessin des seuls systèmes visibles** : le nombre de nœuds cesse de suivre la longueur du morceau.

| Mesures | Avant | Après |
|---|---|---|
| 20 | 63 ms | 39 ms |
| 60 | 218 ms | 40 ms |
| 150 | 408 ms | 46 ms |
| 400 | — | 55 ms |

`performance_test.js` verrouille la propriété qui compte : au-delà d'un écran, le coût cesse de monter.

### Tone.js pour l'audio

Repris de HarmoHub, même version vendorée. La partition est programmée d'avance et **en tics
musicaux**, pas en secondes : une position en tics ne dépend pas du tempo, donc tirer le curseur de
BPM pendant la lecture réétire tout, sans rien reprogrammer. La tête de lecture lit la position réelle
du transport audio — elle ne peut pas dériver de ce qu'on entend.

### jsPDF, sans `window.print()`

Repris de HarmoHub, même version vendorée. La boîte d'impression du navigateur dépend d'un pilote PDF
système qui peut manquer, impose deux clics de plus et repagine selon les réglages de l'imprimante.
Un clic sur « Exporter PDF » écrit le fichier et ouvre directement « Enregistrer sous ».

---

## Utilisation

### Saisie

La saisie se fait **exclusivement sur la tablature** ; la portée solfège s'en déduit — hauteurs,
orthographe des altérations selon l'armure, hampes, ligatures, lignes supplémentaires.

| Touche | Effet |
|---|---|
| `0` … `9` | Poser une case. Deux chiffres tapés rapidement = cases 10 à 24 |
| `←` `→` | Évènement précédent / suivant. À droite, prolonge la mesure tant qu'elle n'est pas pleine |
| `↑` `↓` | Changer de corde |
| `Ctrl`+`←` `→` | Mesure précédente / suivante |
| `Origine` / `Fin` | Début / fin de mesure (avec `Ctrl` : du morceau) |
| `⌫` / `Suppr` | Effacer la note |
| `Entrée` | Insérer un évènement |
| `Ctrl`+`↑` `↓` | Monter / descendre la note d'une case |
| `+` / `-` | Durée plus longue / plus courte |
| `.` | Note pointée · `Alt`+`3` triolet · `R` silence |
| `H` `P` `S` `T` | Hammer-on, pull-off, slide, liaison de prolongation |
| `M` `B` `X` `A` | Palm mute, bend, note fantôme, accent |
| `Alt`+`M` | Ajouter une mesure |
| `Espace` | Lecture / pause, **depuis le curseur** |
| `Échap` | Arrêter |
| `Ctrl`+`Z` / `Ctrl`+`Y` | Annuler / rétablir |
| `Ctrl`+`S` `O` `P` | Enregistrer `.json`, ouvrir, exporter PDF |
| `?` | Aide-mémoire des raccourcis |

La palette cliquable double intégralement le clavier : les deux sont construits à partir de la même
table (`src/edit/raccourcis.js`), ils ne peuvent donc pas se contredire.

### Lecture

Un **métronome** optionnel (deux boutons du transport) suit la signature en vigueur — binaire ou
ternaire, jamais un simple clic uniforme — avec une option « croche » pour une subdivision en plus.

Une **boucle de lecture** se définit en glissant (souris ou doigt) sur la fine bande sous la
tablature de chaque système : la zone se rejoue indéfiniment, pour retravailler un passage sans
repartir du début à chaque essai. Un tap/clic sans glisser sur la bande retire la boucle en place.
C'est une préférence de SESSION, jamais sauvée avec le morceau.

Le **tempo** se règle au champ numérique du transport, ou au bouton **TAP** juste à côté : cliquer
plusieurs fois au rythme voulu le règle sans avoir à connaître ni taper une valeur précise.

Deux **volumes** indépendants (Réglages > Son) : général (agit sur tout ce qui sonne) et métronome
seul (relatif au premier) — 0 à 100, avec lecture immédiate.

### Instruments et accordages

Guitare 6 cordes, basse 4 cordes, basse 5 cordes. Accordage standard par instrument, accordages
alternatifs prédéfinis (Drop D, Eb Standard, D Standard, Drop C, Open G, DADGAD, Drop A, High C…),
en **notation anglo-saxonne** (E A D G B E, pas Mi La Ré Sol Si Mi — plus simple à lire). Réglage
**corde par corde** et **capodastre** existent toujours, repliés sous « Options avancées » : ce sont
des réglages de cas précis, pas d'usage courant. Un accordage réglé à la main qui reconstitue un
prédéfini est reconnu comme tel.

**Piano** : ni corde ni case, donc ni accordage ni capodastre — la partition se grave en grand-portée
(clé de sol et clé de fa, chacune sa propre armure et son propre chiffrage, reliées par une accolade).
Basculer un morceau existant vers piano vide ses notes (elles n'ont plus de corde où vivre) sans
toucher au rythme ni aux mesures.

**Saisie directement sur la portée** (pas de manche, donc pas de chiffre à taper) : cliquer sur une
ligne ou un interligne y pose la hauteur correspondante — accidentelle comprise selon l'armure en
vigueur — ou la retire si elle y est déjà (bascule, comme rejouer la même touche). Un clic sur la clé
de sol écrit à la voix 0 (main droite), un clic sur la clé de fa à la voix 1 (main gauche) — cette
dernière ajoutée toute seule au premier clic si la mesure n'avait encore que la mélodie. Plusieurs
hauteurs cliquées au même instant construisent un accord.

### Fichiers

Nouveau, Ouvrir, Exporter, PDF et MIDI vivent groupés derrière un seul bouton **Fichiers** (barre du
haut) plutôt qu'en icônes séparées — six pictogrammes à deviner un par un s'est révélé peu clair à
l'usage, un menu à libellés en toutes lettres ne laisse rien à deviner. **Enregistrer** reste seul,
à part : c'est le geste le plus fréquent (persistance locale immédiate, pas un téléchargement), il
garde donc son propre bouton vert toujours visible plutôt que de se noyer dans le menu.

- **Enregistrer** range le morceau dans le navigateur (`localStorage`) — aucun téléchargement,
  seulement le geste le plus fréquent rendu instantané (aussi `Ctrl+S`).
- **Exporter** télécharge, lui, un `.json` indenté qui est le modèle tel quel — lisible et modifiable
  à la main ; c'est le fichier à archiver ou à faire circuler.
- **Ouvrir** relit un `.json`. Tout champ y est borné à la relecture : un fichier abîmé s'ouvre
  réparé plutôt que de faire planter le rendu.
- **Exporter PDF** écrit un PDF A4 vectoriel, paginé sans jamais couper un système en deux.
- **Exporter en MIDI** écrit un `.mid` (format 0) lisible par n'importe quel séquenceur, DAW ou
  logiciel de notation — le modèle raisonnant déjà en hauteurs MIDI (voir `model/theory.js`), il n'y
  avait qu'à écrire cette correspondance dans le format standard. Un morceau qui a plusieurs
  **sections** (les annotations « Couplet »/« Refrain »…, voir plus haut) propose, comme HarmoHub, un
  seul fichier — avec un REPÈRE MIDI par section même alors — ou un fichier PAR section, chacune sur
  sa propre timeline à 0, pour les retravailler indépendamment dans un DAW.
- **Importer un fichier MIDI** relit un `.mid` dans l'instrument/accordage/capodastre en place : une
  note hors de portée du manche est abandonnée (jamais une case inventée), et le résultat est compté
  dans le message de fin d'import. Vient-il REMPLACER le morceau en cours, ou s'AJOUTER à sa suite
  comme une nouvelle section (annotée d'après le nom du fichier, sans toucher à ce qui existe déjà) ?
  TabHub le demande à chaque import plutôt que de deviner.
- Un **brouillon** est conservé dans le navigateur : un rechargement accidentel ne coûte rien. Son
  état (présent ou non) et un bouton pour l'effacer vivent dans Réglages > Fichiers — jamais un
  gestionnaire multi-fichiers, TabHub n'en a qu'un à la fois.

---

## Organisation du code

```
index.html            châssis de l'application ; charge les modules ES
style.css             tokens de HarmoHub + thème « papier » de la zone de travail
vendor/               Tone.js et jsPDF, vendorés (MIT), mêmes versions que HarmoHub
src/
  model/              LE MODÈLE — aucune dépendance, aucune connaissance du DOM
    theory.js           hauteurs MIDI, armures, orthographe des altérations
    duration.js         durées ramenées à la noire, groupement des ligatures
    instruments.js      instruments, accordages, capodastre
    score.js            partition > mesures > évènements > notes ; format du .json
  engine/             LA GRAVURE — modèle → liste d'affichage
    glyphes-bravura.js  GÉNÉRÉ — contours extraits de Bravura (ne pas modifier à la main)
    glyphs.js           API des glyphes + épaisseurs de trait de la gravure
    layout.js           espacement, systèmes, justification, hampes, ligatures, liaisons
  render/             LES TRADUCTEURS — liste d'affichage → sortie
    svg.js              écran
    pdf.js              jsPDF, vectoriel
  edit/               L'ÉDITION — état modifiable, aucune touche au DOM
    commands.js         curseur, commandes, historique par instantanés
    raccourcis.js       table unique des actions (clavier + palette)
    keyboard.js         branchement du clavier
  audio/player.js     Tone.js, transport, tête de lecture
  io/                 fichiers : json.js (sauver/ouvrir), pdf.js (paginer/exporter)
  ui/                 icons.js, toolbar.js
  main.js             LE SEUL module qui touche au DOM et connaît tous les autres
outils/
  generer-glyphes.py  extrait les contours de Bravura vers src/engine/glyphes-bravura.js
tests/                bancs Playwright — voir tests/README.md
```

La règle qui tient l'ensemble : **une dépendance ne remonte jamais**. `model/` ignore `engine/`,
`engine/` ignore `render/`, et rien sous `src/` ne touche au DOM sauf `main.js`, `ui/` et `io/`.

---

## Ce que la V1 ne fait pas encore

Dit franchement, pour que la suite se décide sur des faits :

- **Une seule voix par mesure.** Le modèle prévoit la place, mais le rendu ne grave pas encore deux
  voix superposées. Sur une pièce comme *Jeux interdits*, la basse tenue et la mélodie partagent donc
  un même évènement et une même hampe, là où une édition gravée les séparerait.
- **Pas de dépliage des reprises à la lecture.** Les barres de reprise s'écrivent et s'exportent,
  mais la lecture parcourt la partition écrite, une fois.
- **Les liaisons ne franchissent pas les barres de mesure.** Une note liée à la première note de la
  mesure suivante s'entend correctement, mais l'arc n'est pas tracé : la pose des liaisons travaille
  mesure par mesure.
- **Un synthétiseur simple**, pas un échantillon de guitare — un son d'échantillons pèserait plusieurs
  mégaoctets à vendorer.
- **Pas d'import Guitar Pro** (`.gp5`, `.gpx`) ni de MusicXML.
- **Le bend est joué par un synthétiseur à part.** La hauteur se courbe bien pendant la lecture,
  amplitude comprise (`B` fait cycler ½ ton / ton entier / ton et demi), mais via un synthétiseur
  simple : ni le Sampler ni le PolySynth qui portent le reste de la partition ne savent glisser en
  hauteur en continu.
- **Piano : quelques aspérités, hors du geste central (clic pour poser/retirer une hauteur, qui
  fonctionne).** Toutes les notes d'un accord partagent le même identifiant interne (`corde: 0`, sans
  équivalent piano) : Suppr efface l'accord ENTIER plutôt qu'une seule de ses notes (cliquer de
  nouveau sur la hauteur voulue reste le moyen fiable de la retirer seule), un effet par note
  (hammer-on, bend…) ne vise que la première note d'un accord, et une liaison entre deux accords peut
  se raccorder à la mauvaise note. Ni saisie au clavier (chiffres, flèches) ni lasso de sélection —
  la souris/le doigt directement sur la portée restent le seul geste.

---

## Licences des ressources tierces

| Ressource | Licence | Emploi |
|---|---|---|
| `vendor/tone.min.js` | MIT | moteur audio, vendoré depuis HarmoHub |
| `vendor/jspdf.umd.min.js` | MIT | export PDF, vendoré depuis HarmoHub |
| Bravura (Steinberg) | **SIL OFL 1.1** — `vendor/OFL-Bravura.txt` | contours des signes musicaux, extraits dans `src/engine/glyphes-bravura.js` |

« Bravura » est un nom de police réservé au sens de l'OFL : TabHub ne redistribue pas une police,
mais des contours dérivés, et ne porte pas ce nom.

Pour régénérer les glyphes après une mise à jour de Bravura :

```sh
pip install fonttools
python3 outils/generer-glyphes.py chemin/vers/Bravura.otf
```
