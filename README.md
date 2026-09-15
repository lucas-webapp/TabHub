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
| `Espace` | Lecture / pause, **depuis le début** (ou depuis la boucle, si une boucle est posée) |
| `Échap` | Arrêter |
| `Ctrl`+`Z` / `Ctrl`+`Y` | Annuler / rétablir |
| `Ctrl`+`S` `O` `P` | Enregistrer `.json`, ouvrir, exporter PDF |
| `?` | Aide-mémoire des raccourcis |

**Les silences ne se posent pas, ils se calculent.** Un silence n'est jamais une figure qu'on aurait
écrite : c'est du temps vide, réécrit avec le moins de figures possible à chaque changement — comme
dans MuseScore ou Guitar Pro. Effacer une note rend son temps aux silences voisins, et deux silences
contigus n'existent pas s'ils peuvent n'en faire qu'un : effacer sept croches sur huit laisse trois
silences, pas sept. Les figures suivent leur **place** dans la mesure, pas seulement leur durée : un
silence ne commence que sur une position multiple de sa propre durée, si bien que trois temps à
partir du deuxième temps d'un 4/4 donnent une noire puis une blanche, jamais une blanche pointée qui
enjamberait la moitié de la mesure. Un silence qu'on a soi-même dimensionné (choisir « blanche » sur
un silence, pour y préparer une note) n'est en revanche jamais réécrit.

La palette cliquable double intégralement le clavier : les deux sont construits à partir de la même
table (`src/edit/raccourcis.js`), ils ne peuvent donc pas se contredire. **Chaque bouton d'effet
montre ce que la partition va écrire** — un « H » sur sa liaison pour le hammer-on, un « P » pour le
pull-off, le trait oblique du glissando pour le slide, l'arc nu pour la liaison de prolongation. Les
pictogrammes « gestuels » qui les précédaient (quatre flèches courbes distinguées par leur seul sens)
demandaient d'apprendre la correspondance ; celle-ci se lit.

Les **sections de la barre d'outils** (durées, mesure, écriture) ne portent plus de titre : chacune
est simplement **encadrée**, et les deux boutons repliés vivent DANS leur cadre — « Effets » avec les
figures de durée, « Repères » avec la signature et l'armure. Le cadre disait déjà « ces boutons vont ensemble » ; le titre le
répétait en coûtant sa largeur de texte, dans la seule barre de l'application qui manque de place
(152px récupérés sur ordinateur, mesurés). Le nom reste annoncé aux lecteurs d'écran (`role="group"`
+ `aria-label`) — un cadre ne s'entend pas.

### Lecture

Un **métronome** optionnel (deux boutons du transport) suit la signature en vigueur — binaire ou
ternaire, jamais un simple clic uniforme — avec une option « croche » pour une subdivision en plus.

Un **décompte** d'une mesure peut précéder la lecture : le métronome bat la mesure qui vient, puis la
musique part. Sa bascule est **dans le bloc de lecture**, à côté du métronome, et pas dans les
Réglages : c'est une décision d'essai — on compte pour se lancer sur un passage difficile, pas pour
les suivants. Indépendant du métronome, et c'est le point : l'un met en place AVANT la première note,
l'autre tient la pulsation PENDANT. Le décompte suit la signature de la mesure de **départ** (trois
clics en 3/4, pas quatre), et ne se rejoue pas en reprenant une pause — on repartirait au milieu
d'une phrase.

Techniquement, ce décompte est programmé sur l'**horloge audio**, et le transport simplement démarré
plus tard. L'autre voie — décaler d'une mesure tout ce qui est programmé sur le transport — aurait
obligé à retrancher ce décalage partout où une position de transport se relit (tête de lecture,
bornes de boucle, reprogrammation en direct) ; une seule de ces lectures qui l'oublierait
désynchroniserait l'image du son. Le décompte n'appartient pas au morceau : il n'a donc rien à faire
dans son échelle de temps.

Une **boucle de lecture** se définit en glissant (souris ou doigt) sur la fine bande sous la
tablature de chaque système : la zone se rejoue indéfiniment, pour retravailler un passage sans
repartir du début à chaque essai. Un tap/clic sans glisser sur la bande retire la boucle en place.
C'est une préférence de SESSION, jamais sauvée avec le morceau.

Lecture/Stop, **tempo** et **métronome** vivent ensemble dans un **bloc de lecture** encadré, au
centre de la barre du bas sur ordinateur, à gauche sur téléphone. Les cinq commandes étaient
auparavant réparties entre deux barres : tempo et métronome siégeaient dans la barre d'outils, aux
côtés de la signature et de l'armure. Le classement se défendait — les quatre décrivent « comment ce
morceau se joue » — mais il séparait ce qu'on touche EN JOUANT de ce qu'on touche EN ÉCRIVANT. La
barre d'outils y a gagné 160px, mesurés.

Le **tempo** se règle au champ numérique de ce bloc (le compteur natif du navigateur y est retiré :
à 54px de large, ses deux demi-flèches impossibles à viser rognaient le troisième chiffre — « 120 »
s'affichait « 12 »). Il se lit aussi **au-dessus de la portée**, gravé à côté de la figure de
référence, suivi du nom de la **tonalité** écrit en clair (« C majeur », pas l'abréviation « CM » de
la liste déroulante).

La lecture **suit les modifications en temps réel**, boucle comprise : écrire, effacer ou annuler
pendant que ça joue reprogramme l'horloge sans interrompre le son. La partition n'était traduite en
évènements d'horloge qu'au démarrage — on retravaillait un passage en boucle, on corrigeait une note,
et le tour suivant rejouait l'ancienne.

Deux **volumes** indépendants (Réglages > Son) : général (agit sur tout ce qui sonne) et métronome
seul (relatif au premier) — 0 à 100, avec lecture immédiate.

### Affichage de la partition

Deux commandes, sous l'étiquette **Affichage** de la barre du bas, et elles ne font pas la même chose
— c'est pourquoi les deux existent :

- les **loupes + / −** changent l'échelle **entière** (la taille de portée, de 6 à 15 px d'interligne) :
  donc la hauteur de chaque système, le nombre de lignes visibles d'un coup d'œil, et la taille des
  chiffres de tablature. Un curseur de zoom avait existé là, puis disparu comme redondant avec le
  réglage suivant ; la redondance n'était qu'à moitié vraie, et l'aperçu PDF l'a démontré sur le
  papier (la taille de portée est de loin le levier le plus fort sur une mise en page). Deux boutons
  plutôt qu'un curseur : un curseur demande de viser, deux loupes se martèlent sans regarder.
- **mesures par ligne** (Auto, 2, 3, 4, 6, 8) serre la musique **horizontalement**, à hauteur de
  portée constante : il redistribue les mesures, il ne change pas l'échelle.

Sur téléphone, les deux se replient derrière le même bouton « Affichage » — mesuré, deux loupes au
gabarit tactile réclament 88 px là où la barre en a 47 de libre. Le popover reste ouvert d'un cran au
suivant, ce qu'un bouton de barre n'aurait pas permis.

**Titre, sous-titre et artiste se modifient sur la partition**, là où ils se lisent : on touche le
titre gravé au-dessus de la portée et un panneau propose les trois champs. Un seul chemin — les
Réglages en portaient une seconde copie, retirée à l'audit. Deux champs pour une même valeur, c'est
une vérité de trop, et le chemin qui reste a été vérifié au doigt (à 390 px comme à 320 px, le
panneau et ses trois champs tiennent entièrement dans l'écran).

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

Tous les fichiers exportés portent le nom **« Titre - Artiste »** (`.json`, `.pdf`, `.mid`, et
« Titre - Artiste - Partie.mid » pour un fichier par section) : un dossier de relevés où tout
s'appelle « Sans titre.json » ne se trie pas. Un seul endroit décide de ce nom
(`io/json.js#nomDuMorceau`). Les accents y sont repliés en ASCII — « Étude » donne « Etude » —
parce que tout caractère non-ASCII posé dans l'attribut `download` d'un lien fait retomber le
navigateur sur son nom par défaut : le fichier arrivait nommé « download ». Un accent en moins reste
un nom qu'on reconnaît.
- **Ouvrir** relit un `.json`. Tout champ y est borné à la relecture : un fichier abîmé s'ouvre
  réparé plutôt que de faire planter le rendu.
- **Exporter PDF** ouvre d'abord un **aperçu de la mise en page**, et n'écrit le fichier qu'ensuite.
  Six réglages y agissent en direct, dans l'ordre de leur effet sur le nombre de pages : taille de la
  portée (de loin le plus fort — 2,1 → 1,6 mm fait passer un morceau de deux pages à une), mesures
  par ligne, espacement des portées, marges (serrées/normales/larges), format de page (A4/Lettre) et
  taille des titres. Le nombre de pages annoncé est **celui du fichier**, pas une estimation : les
  deux passent par le même `io/pdf.js#preparerPdf`, donc la même liste d'affichage et le même
  paginateur — c'est ce que permet l'architecture à deux rendus sur une liste commune. Les réglages
  sont retenus d'une fois sur l'autre, et vivent là plutôt que dans les Réglages généraux : on voit
  leur effet en même temps qu'on règle. Le PDF reste vectoriel et paginé sans jamais couper un
  système en deux.
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
- Un **brouillon** est conservé dans le navigateur : un rechargement accidentel ne coûte rien. Il ne
  se règle pas et ne se pilote pas — il n'y a rien à activer, rien à vider, comme dans HarmoHub. Un
  seul brouillon à la fois, jamais un gestionnaire multi-fichiers : Fichiers > Nouveau l'écrase,
  Fichiers > Exporter reste la sauvegarde durable. L'historique des versions (juste en dessous) garde
  en plus les dix derniers états enregistrés — mais c'est un filet de rattrapage, pas une
  bibliothèque de morceaux.

**L'historique des versions** (Fichiers > Versions précédentes…). Un état est mis de côté à chaque
**enregistrement** délibéré, et avant tout **remplacement** du morceau (Nouveau, Ouvrir, import MIDI
en remplacement, ou le retour à une autre version). Les **dix** derniers sont gardés, datés en clair
(« hier à 14:05 ») ; le plus ancien s'efface de lui-même. Ce n'est pas le brouillon : celui-ci est UN
état réécrit sans cesse, qui protège de l'accident ; une version est un état délibéré, qu'on garde
pour pouvoir y revenir. L'un protège de l'accident, l'autre du regret.

Le modèle est celui de HarmoHub, mais corrigé de ce qui y gêne. Là-bas, réimporter une sauvegarde
contenant un morceau déjà présent propose d'en garder une copie, nommée « Titre (import du
14/09/2025) », qui atterrit **dans la bibliothèque** au milieu des morceaux — deux ou trois imports
plus tard, on ne sait plus lequel est le bon. Le défaut n'est pas de garder des versions, c'est de
les mêler au travail en cours. D'où quatre règles ici : elles vivent **à part** (jamais dans le nom
du morceau), leur nombre est **borné**, un état identique au précédent n'en crée pas une deuxième
(Ctrl+S est un réflexe), et un morceau **sans aucune note** n'est pas une version.

À l'**import**, TabHub demande s'il faut *écraser la version précédente* ou *garder les deux* — c'est
ce qui empêche la liste d'enfler quand on réimporte plusieurs fois le même fichier retouché ailleurs.
La question ne se pose qu'aux imports, et seulement s'il y a déjà une version : une question dont une
seule réponse a du sens n'est pas une question, c'est une étape de plus. Revenir à une version
**archive l'état qu'on quitte** — sans quoi « revenir en arrière » serait un aller simple, et se
tromper de ligne coûterait le travail en cours.

L'historique **s'éteint** (Réglages > Fichiers), et s'éteindre **vide réellement** le stockage. Un
interrupteur qui n'aurait masqué que la liste aurait continué à consommer le quota du navigateur —
partagé avec le brouillon — tout en laissant croire à un effacement ; c'est le seul réglage de ce
panneau qui détruit des données, et le seul qui demande confirmation.

**Les garde-fous.** Puisqu'il n'y a qu'un brouillon et que Nouveau l'écrase, deux gestes peuvent
coûter un travail : remplacer le morceau en cours (Nouveau, Ouvrir, ou un import MIDI « remplacer »)
et fermer l'onglet. Les deux demandent confirmation — mais **seulement s'il y a quelque chose à
perdre** : TabHub retient si le morceau a été exporté depuis la dernière modification (déplacer le
curseur ou lancer la lecture ne compte pas comme une modification), et ne demande rien sinon. Un
avertissement qui apparaît pour rien s'apprend à cliquer sans lire, et ne protège plus le jour où il
compte.

La confirmation de remplacement offre **trois** choix — exporter puis continuer, continuer sans
exporter, annuler — parce que deux ne suffisent pas : « Annuler » et « OK » obligent à renoncer au
geste pour aller sauvegarder, puis à le refaire. C'est ce qui a rendu nécessaire un dialogue maison
(`ui/dialogue.js`) : une boîte `confirm()` du navigateur ne porte que deux boutons, aux libellés
figés et intraduisibles. Les saisies de texte (nom d'accord, annotation de section) passent par la
même fenêtre, qui a le châssis des Réglages et de l'aperçu PDF.

L'avertissement à la FERMETURE, lui, reste la boîte du navigateur, et c'est une limite assumée :
aucun navigateur moderne n'autorise à styler `beforeunload` ni à en changer le texte — la même
contrainte s'applique à HarmoHub, dont le code la documente. On choisit donc QUAND elle apparaît,
jamais à quoi elle ressemble.

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
  io/                 fichiers : json.js (sauver/ouvrir), pdf.js (paginer/exporter),
                        midi.js, versions.js (historique local, borné)
  ui/                 icons.js, toolbar.js, dialogue.js (fenêtres de l'app, pas du navigateur)
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
  mesure suivante s'entend correctement, mais son signe n'est pas tracé — ni l'arc d'une liaison ni
  le trait oblique d'un slide : la pose des liaisons travaille mesure par mesure.
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
