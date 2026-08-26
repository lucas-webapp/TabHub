# TabHub

Éditeur web de **tablatures et partitions** pour guitare et basse : saisie au clavier, double portée
solfège + TAB synchronisées, lecture audio avec tête de lecture, export PDF vectoriel et fichiers
`.json`.

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

### Des glyphes musicaux en chemins Bézier, pas une police

Une police SMuFL (Bravura) pèse 500 ko à vendorer, doit être ré-embarquée en base64 dans chaque PDF,
et se pose par du texte — donc jamais au centième d'interligne près, alors qu'une clé de sol mal
centrée sur sa ligne est immédiatement fausse à l'œil. Les quelques signes nécessaires sont donc
dessinés en Bézier, en unités d'interligne. La clé de sol est bâtie sur une **spirale logarithmique
paramétrique** : son centre tombe exactement sur la ligne de sol, par construction.

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

### Instruments et accordages

Guitare 6 cordes, basse 4 cordes, basse 5 cordes. Accordage standard par instrument, accordages
alternatifs prédéfinis (Drop D, demi-ton plus bas, un ton plus bas, Drop C, Open G, DADGAD, Drop A,
do aigu…), réglage **corde par corde**, et capodastre. Un accordage réglé à la main qui reconstitue un
prédéfini est reconnu comme tel.

### Fichiers

- **Enregistrer** télécharge un `.json` indenté, qui est le modèle tel quel — lisible et modifiable à
  la main.
- **Ouvrir** relit un `.json`. Tout champ y est borné à la relecture : un fichier abîmé s'ouvre
  réparé plutôt que de faire planter le rendu.
- **Exporter PDF** écrit un PDF A4 vectoriel, paginé sans jamais couper un système en deux.
- Un **brouillon** est conservé dans le navigateur : un rechargement accidentel ne coûte rien.

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
    glyphs.js           clés, altérations, silences, têtes, crochets en Bézier
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
- **Un synthétiseur simple**, pas un échantillon de guitare — un son d'échantillons pèserait plusieurs
  mégaoctets à vendorer.
- **Pas d'import Guitar Pro** (`.gp5`, `.gpx`) ni de MusicXML.
- **Bends approximatifs** : l'amplitude est notée et le PDF l'affiche, mais la lecture ne courbe pas
  encore la hauteur.

---

## Licence des bibliothèques tierces

`vendor/tone.min.js` et `vendor/jspdf.umd.min.js` sont sous licence MIT, vendorés depuis HarmoHub.
