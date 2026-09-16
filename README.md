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

Un **slide** s'écrit comme dans les éditions imprimées, sur la portée *et* sur la tablature : le
**trait oblique** entre les deux notes (c'est lui qui dit le geste, et qui le distingue d'une liaison
de tenue), un **arc** qui les groupe, et **`sl.`** en italique au-dessus. Le trait oblique seul —
l'état antérieur — n'annonçait rien : on le découvrait en le lisant.

**Les silences ne se posent pas, ils se calculent.** Un silence n'est jamais une figure qu'on aurait
écrite : c'est du temps vide, réécrit avec le moins de figures possible à chaque changement — comme
dans MuseScore ou Guitar Pro. Effacer une note rend son temps aux silences voisins, et deux silences
contigus n'existent pas s'ils peuvent n'en faire qu'un : effacer sept croches sur huit laisse trois
silences, pas sept. Les figures suivent leur **place** dans la mesure, pas seulement leur durée : un
silence ne commence que sur une position multiple de sa propre durée, si bien que trois temps à
partir du deuxième temps d'un 4/4 donnent une noire puis une blanche, jamais une blanche pointée qui
enjamberait la moitié de la mesure. Un silence qu'on a soi-même dimensionné (choisir « blanche » sur
un silence, pour y préparer une note) n'est en revanche jamais réécrit.

#### L'aide rythmique

« Des fois j'ai des difficultés à écrire la partition à cause du rythme. » L'aide rythmique — bouton
**Rythme** dans le cadre *Durée* de la barre d'outils, ou clic droit sur une mesure → **Aide
rythmique à partir d'ici…** — sépare les deux décisions qu'on prenait jusque-là d'un seul geste :
**quel rythme**, puis **quelles notes**. Le bouton ouvre l'aide sur la mesure du curseur ; le clic
droit, sur celle qu'on désigne.

On pose des barres dans une grille de **1 à 4 mesures consécutives** — un clic pose une attaque, un
glissé l'étire, un clic sur l'en-tête d'un temps en change la subdivision (triolet, double, croche).
TabHub affiche alors la **vraie écriture** en dessous : chiffres de triolet, ligatures pointée +
double, silences réécrits au plus court. C'est le moteur de gravure lui-même qui la produit, sur une
partition jetable sans tablature — donc elle ne peut pas mentir sur ce que l'insertion va écrire.

L'insertion **remplace** les mesures visées, à l'endroit choisi à la souris ou au doigt, et laisse la
**tablature vide** : les cases à choisir apparaissent en surbrillance, `Tab` saute de l'une à la
suivante, et taper une case **ne change plus la durée** de l'évènement. C'est le point qui rendait
l'exercice impossible : la durée de la palette est collante, si bien qu'un rythme imposé de six
figures ressortait en six croches plates et la mesure à −1 temps.

Les notes et les effets s'écrivent ensuite, par-dessus un rythme déjà juste.

Une mesure en doubles-croches fait seize cases : plus large que n'importe quel téléphone. Comme le
glisser sur une case y POSE une note (elle ne peut donc pas servir à faire défiler), la grille porte
**les mêmes flèches de défilement que la barre d'outils** — chacune ne s'allumant que s'il reste
vraiment quelque chose à atteindre de son côté. Rétrécir les cases n'était pas une issue : seize
cases dans 320px les ramènent à dix pixels, sous le seuil du visable.

La palette cliquable double intégralement le clavier : les deux sont construits à partir de la même
table (`src/edit/raccourcis.js`), ils ne peuvent donc pas se contredire. **Chaque bouton d'effet
montre ce que la partition va écrire** — un « H » sur sa liaison pour le hammer-on, un « P » pour le
pull-off, le signe complet du glissando pour le slide (« sl. », l'arc et le trait oblique), l'arc nu
pour la liaison de prolongation. Les
pictogrammes « gestuels » qui les précédaient (quatre flèches courbes distinguées par leur seul sens)
demandaient d'apprendre la correspondance ; celle-ci se lit.

Les **sections de la barre d'outils** (durées, mesure, écriture) ne portent plus de titre : chacune
est simplement **encadrée**, et les deux boutons repliés vivent DANS leur cadre — « Effets » avec les
figures de durée, « Repères » avec la signature et l'armure. Le cadre disait déjà « ces boutons vont ensemble » ; le titre le
répétait en coûtant sa largeur de texte, dans la seule barre de l'application qui manque de place
(152px récupérés sur ordinateur, mesurés). Le nom reste annoncé aux lecteurs d'écran (`role="group"`
+ `aria-label`) — un cadre ne s'entend pas.

### Onglets — plusieurs morceaux à la fois

Sur ordinateur, une **barre d'onglets sous la barre d'outils** garde plusieurs morceaux ouverts en
même temps, pour en comparer deux versions sans fermer l'une pour ouvrir l'autre. Le **+** en ouvre
un de plus (un morceau neuf) ; la croix en ferme un, avec le même avertissement que « Nouveau » ou
« Ouvrir » — fermer, c'est écraser. TabHub bascule d'abord sur l'onglet visé : on voit ce qu'on est
sur le point de perdre, et l'avertissement porte sur le bon document. Le dernier onglet n'a pas de
croix : il y a toujours un morceau ouvert, comme il y a toujours au moins une mesure.

**Ce qui appartient à un onglet** : la partition, le curseur, l'historique d'annulation et la bande
de boucle. **Ce qui reste commun** : la durée choisie dans la palette (un réglage de main, pas une
propriété du morceau) et le **presse-papier de mesure** — c'est précisément lui qui rend les onglets
utiles, puisqu'il permet de reporter une mesure d'une version à l'autre.

**Au clavier** : `Alt+1` … `Alt+9` va droit au n-ième onglet, `Alt+←` / `Alt+→` passe au voisin —
sans bouclage aux deux bouts, pour que marteler la touche ne fasse pas réapparaître le premier onglet
quand on croyait atteindre le dernier. `Alt+7` sur trois onglets ne fait rien plutôt que d'en viser
un au hasard. Le code de touche (`e.code`, donc `Digit1`) et non le caractère produit : sur un clavier
AZERTY la rangée des chiffres donne `& é " ' (` sans majuscule, et des caractères plus surprenants
encore avec Alt.

Le **brouillon du navigateur porte tous les onglets** : un rechargement les retrouve tous, avec celui
sur lequel on travaillait. Un brouillon écrit avant l'arrivée des onglets se relit en un seul.

**Rien de tout cela sur téléphone** ni sur un écran de moins de 720px : « cette option prend trop de
place à l'écran ». La rangée se referme alors entièrement — pas un pixel de hauteur perdu. Les
onglets déjà ouverts ne sont pas effacés pour autant : ils restent en mémoire et dans le brouillon, et
réapparaissent dès que l'écran est assez large.

### Lecture

#### Le son — un piano échantillonné, qui glisse

Les notes sont jouées par un **piano échantillonné** (Salamander, la bibliothèque publique
qu'utilise aussi HarmoHub), doublé d'un **synthétiseur de repli** qui joue tant que les 17 fichiers
n'ont pas fini d'arriver, et qui joue *toujours* hors ligne. Sans cette doublure l'application
resterait muette sur un réseau faible : le transport avancerait, le curseur suivrait, et chaque note
serait abandonnée en silence.

**Les bends et les slides ont le timbre du piano, eux aussi** (retour utilisateur : « le son du slide
fait un son analogique grave au lieu d'un son de piano »). C'était vrai, et la raison en avait l'air
solide : ni `Tone.Sampler` ni `Tone.PolySynth` n'offrent de prise sur la hauteur d'une voix déjà
attaquée, donc une note dont la hauteur bouge était jouée par un synthétiseur à part — une onde, au
milieu d'un piano. Ce raisonnement concluait trop vite. Un échantillonneur n'est rien d'autre qu'un
lecteur de buffer dont on règle la **vitesse de lecture** ; et cette vitesse, sur un
`Tone.ToneBufferSource`, est un paramètre **rampable**. TabHub joue donc lui-même l'échantillon le
plus proche et fait glisser sa vitesse : un vrai piano qui glisse. *Mesuré : la hauteur passe de 264
à 296 Hz pendant la note (attendu 294), sans que la voix synthétisée soit appelée une seule fois.*

Le prix, en toute franchise : faire varier la vitesse de lecture déplace aussi le *tempo* de
l'échantillon (c'est le glissando « à la bande »). Sur les intervalles d'un slide ou d'un bend — un
demi-ton à trois tons — l'écart va de 6 % à 19 %, inaudible comme accélération, et c'est déjà ainsi
que tout échantillonneur transpose ses notes. La voix synthétisée reste, elle, pour le cas hors
ligne : timbre plus maigre, mais un glissement qui s'entend plutôt qu'une note muette.

#### Rythme ternaire (swing)

« Est-ce qu'on peut implémenter dans la portée un système classique, qui permet de dire
croche = triolet ? » Le bouton **Ternaire** (cadre *Écriture* de la barre d'outils, auprès de la signature et de la
tonalité — ses deux voisins naturels, les trois disant ensemble comment le morceau se lit) pose la
convention du jazz, du blues
et de la variété : on **écrit des croches droites** — bien plus lisibles, et c'est tout l'intérêt —
et une indication gravée en tête de partition, `♫ = ♩♪` sous son crochet de triolet, dit qu'elles se
**jouent longue-brève**, deux tiers du temps puis un tiers. L'autre voie, un triolet gravé sur chaque
temps, est illisible sur un morceau entier et fausse le comptage à la moindre correction.

L'indication est **gravée** (têtes, hampes, ligature, crochet, chiffre « 3 »), avec les mêmes signes
que la musique en dessous : le signe n'existe pas en un caractère Unicode, aucune police de texte ne
dessine de ligature, et le PDF reçoit exactement le même tracé que l'écran.

Le ternaire s'applique à **la lecture, le métronome et l'export MIDI**, tous les trois sur la même
grille de temps — l'utilisateur compare ce qu'il entend dans TabHub à ce que joue son DAW, et deux
grilles calculées séparément finiraient par diverger. La **tête de lecture** repasse par la
transformation inverse, sans quoi l'image dériverait du son d'un sixième de temps à chaque
contretemps. Le `.json`, lui, garde l'**écriture droite** : seules les sorties sont ternarisées.

Une **mesure composée** (6/8, 9/8, 12/8) ne swingue pas : son temps s'écrit déjà en trois croches,
elle est ternaire par son chiffrage. Au milieu d'un morceau swingué elle se joue droite — exactement
ce que ferait un musicien devant la même partition.

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
repartir du début à chaque essai. C'est une préférence de SESSION, jamais sauvée avec le morceau.

**Elle colle au doigt pendant qu'on la trace, et se pose sur un temps quand on la lâche** (retour
utilisateur : « il est difficile de savoir quand je la mets en place ou non, car je ne la vois pas
apparaître sous mon doigt »). Le défaut n'était pas qu'elle ne se dessinait pas — elle se dessinait
déjà — mais qu'elle ne bougeait qu'au **franchissement d'une mesure** : entre deux barres, glisser ne
changeait rien à l'écran. L'aperçu suit maintenant le pixel, tracé directement dans le SVG en place
(quelques attributs réécrits, pas une remise en page), avec les deux bouts pleins de la vraie bande —
mesuré en capture, le halo seul est trop pâle pour se remarquer. Étirer une poignée suit le pixel de
la même façon, le bord opposé restant fixe. L'œil suit donc le pixel ; **l'oreille, elle, suit le
temps** : la boucle est posée dans l'horloge à chaque changement de plage calée, pour que déplacer la
bande *pendant* que ça joue s'entende tout de suite.

**Le calage se fait au TEMPS** — ni à la mesure entière, ni à la croche. Une borne de boucle
s'*entend* : au rebouclage, le point de reprise est un évènement rythmique, et s'il tombe une croche à
côté de la phrase on entend un faux pas à chaque tour, alors que c'est la pulsation qu'on cherchait à
installer. Affiner ne multiplie pas les bonnes réponses, mais les mauvaises. Le temps, lui, est une
position musicale dans toutes les signatures — la demi-mesure ne l'est pas (en 3/4 elle tombe au
milieu du temps 2) — et c'est déjà la notion qu'emploient la ligature et le métronome
(`uniteDeGroupement`). Mesuré à l'écran, enfin : au zoom par défaut une mesure fait 204px, donc 51px
le temps et 26px la croche, quand le repère tactile que le projet s'impose partout ailleurs est de
44px. Viser les **bords** d'une mesure redonne exactement la mesure entière.

**Dans la bande, le geste nous appartient — réclamé dès `touchstart`.** C'est le correctif qui a
demandé trois passages, et la description de l'utilisateur en donnait la clé : « j'appuie et je glisse
pour étirer la barre, et le logiciel comprend que j'ajoute une barre, **puis** que je scrolle
horizontalement ». Les deux moitiés de cette phrase sont deux défauts distincts.

Le second : deux filets existaient déjà et ne suffisaient pas. `touch-action: none` sur les `<rect>`
de la bande, que WebKit n'honore pas sur du SVG — c'était su. Et un `touchmove` non passif posé depuis
`pointerdown` — **trop tard**, et c'est ce qui manquait : `pointerdown` est émis *après* `touchstart`,
or un navigateur mobile décide de défiler dès `touchstart`, et le défilement part alors sur le thread
de composition où aucun `preventDefault` ultérieur ne l'atteint. Le seul instant où l'on peut réclamer
une séquence de toucher entière est `touchstart` lui-même. La condition compte autant que l'appel :
on ne réclame **que** dans la bande ou sur une poignée — un `preventDefault` inconditionnel
paralyserait le défilement au doigt sur toute la partition, bien pire que le défaut corrigé.

Le premier : **un pointeur annulé n'est pas un appui**. `pointercancel` est précisément ce qu'émet le
navigateur en s'emparant du geste, et souvent *avant* que le seuil de 6 px soit franchi — donc avec le
geste encore considéré comme immobile. Le même gestionnaire était branché sur `pointerup` et sur
`pointercancel` : l'annulation tombait donc dans la branche « tap immobile » et posait une boucle d'une
mesure que personne n'avait demandée, juste avant que l'écran se mette à glisser. Un geste avorté ne
laisse maintenant aucune trace ; s'il avait déjà bougé, on garde la plage qu'il avait dessinée, qui est
ce que l'utilisateur voyait.

**Au doigt, la partition vient à nous.** Dès que le doigt approche d'un bord de la zone pendant qu'on
trace ou qu'on étire la bande, la partition défile d'elle-même, **lentement** — environ 420 px/s collé
au bord, mesurés, avec une rampe au carré qui garde la majeure partie de la marge très lente. Une
première version montait à ~1270 px/s : trois à six mesures par seconde sur un téléphone, on dépassait
sa cible avant de pouvoir lever le doigt. Le navigateur ne défile pas tout seul parce qu'on le lui
**interdit** (voir ci-dessus), donc l'application doit le rendre, gouverné par le geste. Les deux axes
sont traités : au zoom par défaut sur un écran de 390 px la partition ne déborde qu'en **hauteur** et
tient une mesure par système, si bien qu'englober plusieurs mesures veut dire descendre ; dès le
zoom 12, ou avec un nombre de mesures par ligne imposé, elle déborde aussi en **largeur** et le
défilement latéral prend le relais. L'aperçu se recalcule à chaque pas : le doigt ne bouge pas, mais la
musique bouge sous lui.

**La prise des poignées fait la taille d'un doigt** — 44 × 45 px, mesurés par balayage. Un correctif
antérieur visait déjà « le minimum tactile appliqué partout ailleurs » sans le vérifier : il donnait
44 × **26**, d'où « j'ai du mal à atteindre les poignées ». Deux erreurs se cumulaient. La hauteur
était plafonnée par `geo.margeBas` (3,4 S), crue infranchissable, alors que le vrai plafond est le
système suivant, à 6,6 S — et ce creux est réellement vide (zéro primitive s'y grave, vérifié même
avec un nom d'accord et une annotation sur le système suivant, tous deux gravés dans la boîte de *leur*
système). Et la hauteur était exprimée en S, donc en fraction de la taille de portée : **un doigt ne
rétrécit pas quand on dézoome**, et la même constante donnait 44 px à un zoom et 29 à un autre. Elle
est maintenant exprimée en pixels et bornée par le creux réellement disponible — au zoom minimum, où
ce creux ne fait que 40 px, la cible n'est pas atteignable et la prise y vaut 30 px.

**Les deux poignées s'allument au survol**, et le curseur ne ment plus. `.bande-boucle` portait
`ew-resize` sur *toute* la bande, y compris là où glisser **redéfinit** la boucle au lieu d'en étirer un
bord : il annonçait partout un geste qui n'existe qu'aux deux extrémités, donc rien ne changeait quand
on arrivait enfin sur une poignée — une des raisons pour lesquelles on les cherchait sans les trouver.
Désormais la main sur le corps de la bande, `ew-resize` seulement sur une poignée, et la poignée
survolée s'élargit par son centre (l'agrandir par son coin la ferait sauter).

**Une bande fantôme apparaît au survol** tant qu'aucune boucle n'existe (« avant que je la définisse,
les utilisateurs ne sauront pas forcément qu'il est possible de placer une barre de lecture »). La
piste de saisie est invisible par nature — une couleur d'alpha nul, là seulement pour recevoir le
geste — et rien ne disait qu'on pouvait cliquer sous la tablature. Le fantôme couvre **une mesure**,
exactement ce que le clic pose, et porte un cadre en tirets plutôt que les bouts pleins d'une vraie
bande : il invite à poser, il ne prétend pas être une boucle. À la **souris seulement** (un doigt n'a
pas de survol : l'évènement n'arriverait qu'avec le contact, et le fantôme clignoterait sous le doigt
sans rien apprendre à personne), et **seulement tant qu'il n'y a pas de boucle** — une fois posée,
c'est la bande elle-même l'affordance, et proposer « clique pour poser » là où un tap **retire** la
boucle serait un mensonge. Un tap/clic sans glisser pose donc la boucle sur la mesure visée quand il
n'y en a pas, et retire celle en place quand il y en a une (le seul moyen tactile d'en annuler une).

Elle **suit les mesures qu'elle borne**, pas leurs numéros. Insérer, coller ou supprimer une mesure
avant elle — ou annuler l'un de ces gestes — la laisse sur le même passage, et son horloge se
recalcule avec. La boucle est ancrée aux `id` des deux mesures (chaque mesure en porte un, stable, que
la copie profonde de l'historique préserve) et ses numéros en sont RE-DÉRIVÉS à chaque modification du
document : un seul calcul à un seul endroit, plutôt qu'un décalage à recenser dans chaque commande
qui touche au tableau des mesures. Si la mesure de début disparaît, la boucle se resserre sur celle de
fin ; si les deux disparaissent, elle s'en va — jamais une bande qui réapparaît ailleurs que là où on
l'avait posée. Le décalage fin de chaque bord est compté **depuis son ancre**, pas depuis le début du
morceau : insérer une mesure ailleurs déplace le numéro sans toucher au décalage. C'est la même raison
qui avait fait choisir l'ancrage par `id`, poussée d'un cran — une position absolue ne voudrait plus
rien dire dès la première insertion.

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

**Pincer zoome la partition, pas la page.** Sur la partition, `Ctrl+molette`, le pincement de pavé
tactile et le pincement à deux doigts passent tous par les mêmes loupes (retour utilisateur :
« lorsque je zoome avec les doigts ou sur mon ordinateur, peux-tu modifier le zoom de la partition
uniquement ? Actuellement toute la page zoome et dézoome »). Le zoom du navigateur grossit *tout* —
barres d'outils, boutons, transport — et fait déborder l'interface quand on cherchait seulement à
mieux voir les notes ; les loupes, elles, remettent la musique en page. Trois choses le rendent juste :

- **Un seul écouteur pour le pavé tactile et la souris** : un pincement de pavé arrive comme un
  `wheel` avec `ctrlKey`, exactement comme `Ctrl+molette`. Un **seuil cumulé** (42 unités) empêche
  les dizaines de petits `wheel` d'un pincement de traverser toute l'échelle d'un geste.
- **Le pincement à deux doigts suit les pointeurs** (aucun `gesturestart` n'est portable) et
  l'interligne suit le **rapport des écarts depuis le début du geste** : refermer les doigts rend
  exactement la taille de départ, là où un calcul cran par cran dériverait. Un seul doigt ne zoome
  pas — il défile.
- **Uniquement sur la partition**, et c'est la limite qui rend la confiscation acceptable : partout
  ailleurs le zoom du navigateur reste entier. La barre d'outils, qui transforme la molette verticale
  en défilement horizontal, laisse donc passer `Ctrl+molette` au lieu de l'avaler.

Le `touch-action: pan-x pan-y` de la partition (qui **exclut** `pinch-zoom`) est délibérément **hors**
de `@media (pointer: coarse)` : `pointer` décrit le pointeur *principal*, qui sur un portable à écran
tactile est le pavé — la règle ne s'y appliquait donc pas et un pincement du doigt retombait sur le
zoom natif, mesuré. Comme `touch-action` ne gouverne que le toucher direct, la poser pour tout le
monde ne change rien sur une machine sans écran tactile.

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
  TabHub le demande à chaque import plutôt que de deviner. Deux notes de **même hauteur qui se
  chevauchent** (ce que produit tout séquenceur laissant deux notes legato se recouvrir d'un cheveu)
  ressortent bien à deux, chacune à sa place : le lecteur d'octets tient une file d'attaques ouvertes
  par hauteur, et un « note off » ne referme que la plus ancienne. Une note restée sans « note off »
  est refermée en fin de piste plutôt que jetée.

#### Le rythme d'un fichier importé

Le rythme est quantifié **temps par temps**, chaque temps recevant la subdivision que ses attaques
réclament — 2, 3 ou 4 — puis converti en figures par la **même** conversion que l'aide rythmique
(`model/rythme.js`). Un triolet s'écrit donc triolet, et un seul temps en triolet au milieu de
croches ne contamine pas ses voisins. Une grille plate de doubles-croches, comme avant, ne sait pas
écrire un tiers de temps : les douze croches d'un triolet y ressortaient en « double, croche, double »
répété — mesuré, et c'est ce que le banc `import_rythme_test.js` reproduit en neutralisant le
correctif. Le triolet doit expliquer le temps **deux fois mieux** que la meilleure lecture binaire
pour être retenu : sur du jeu flottant, dont aucune lecture n'est exacte, on penche vers l'écriture la
plus sobre.

La fenêtre d'import demande aussi **si le morceau est binaire ou ternaire**, et c'est une vraie
question : un `.mid` ne porte *aucune* notion de swing, seulement des positions. Des croches aux deux
tiers du temps se lisent aussi bien en triolets écrits (noire + croche de triolet) qu'en croches
droites jouées swing — deux partitions pour la même musique, et seul le musicien sait laquelle il veut
lire. Les deux réponses sont donc justes, et TabHub écrit ce qu'on lui dit :

| Réponse | Ce qui est écrit |
|---|---|
| **Binaire** | le rythme du fichier tel quel — ici `♩3 ♪3` par temps, le triolet gravé |
| **Ternaire (swing)** | des croches **droites**, plus l'indication `♫ = ♩♪` en tête |

La réponse est **pré-cochée par détection**, et la fenêtre dit sur quoi elle s'appuie (« swing détecté
sur 8 temps ») pour qu'on puisse la contredire en connaissance de cause. La détection distingue le
swing (une attaque aux deux tiers, aucune au premier tiers) des **vrais triolets à trois notes**, qu'il
ne faut surtout pas « dé-swinguer » : leurs trois notes égales deviendraient double, double, croche.
Se tromper ne coûte qu'un clic, jamais une partition.

Conséquence : l'aller-retour de TabHub avec lui-même est **sans perte** en ternaire — ce qu'on exporte
swingué se réimporte en croches droites plus l'indication.
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
    duration.js         durées ramenées à la noire, groupement des ligatures, lecture ternaire
    instruments.js      instruments, accordages, capodastre
    score.js            partition > mesures > évènements > notes ; format du .json ;
                          grille des temps pour la lecture ternaire (audio ET MIDI)
    rythme.js           la grille des temps et sa conversion en figures — partagée par l'aide
                          rythmique (qu'on clique) et l'import MIDI (qui la déduit)
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
  ui/                 icons.js, toolbar.js, dialogue.js (fenêtres de l'app, pas du navigateur),
                        rythme.js (aide rythmique : la grille cliquable et l'aperçu gravé),
                        onglets.js (la barre d'onglets — dessin seul, l'état vit dans main.js)
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
- **L'import MIDI fond tout dans une seule voix.** Deux lignes indépendantes qui sonnent ensemble
  deviennent une suite d'accords : séparer les voix d'un fichier source est un problème autrement
  plus dur, et TabHub n'a de toute façon qu'une voix par mesure (voir plus haut). Le rythme, lui,
  n'est plus aplati : triolets et swing sont désormais lus correctement (voir *Le rythme d'un fichier
  importé*).
- **Les triples-croches ne sont pas écrites**, ni à l'aide rythmique ni à l'import : la subdivision
  la plus fine d'un temps est la double-croche (décidé avec l'utilisateur). Un passage plus rapide
  s'approche à la double la plus proche.
- **Un glissando déplace légèrement le tempo de l'échantillon.** Bends et slides ont bien le timbre
  du piano (voir *Le son*), obtenu en faisant glisser la vitesse de lecture de l'échantillon : sur
  les intervalles concernés l'écart de vitesse va de 6 % à 19 %, inaudible comme accélération, mais
  c'est bien un glissando « à la bande » et non un ré-échantillonnage à hauteur variable. Hors ligne,
  faute d'échantillons, c'est le synthétiseur de repli qui joue ces notes.
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
