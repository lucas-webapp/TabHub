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

### La marque : un générateur, pas du SVG à la main

La marque de TabHub existe en quatre exemplaires — le SVG en ligne dans `index.html`,
`icons/favicon.svg`, et les PNG d'écran d'accueil — et elle doit rester le MÊME dessin. Tenus à la
main, ces exemplaires divergent : une version antérieure du favicon dessinait cinq cordes là où la
barre du haut en montrait six, à une autre marge. `outils/generer-logos.py` les produit donc tous
depuis une seule description, et `tests/pwa_test.js` vérifie que le favicon trace exactement les
chemins du logo en ligne.

Le dessin lui-même répond à deux reproches précis. « Je le trouve trop proche du logo HarmoHub, même
s'ils doivent être du même type. On va confondre les logiciels » : les deux marques n'étaient que des
barres au dégradé d'opacité, à un quart de tour près. TabHub porte maintenant le mot « TAB » gravé
dans quatre cordes d'opacité **uniforme**, et le dégradé d'opacité reste la signature de HarmoHub
seule. « Les 6 traits prennent trop de place, ils sont trop proches du bord de l'icône d'app en noir,
ça rend un effet pas pro » : les deux marques tiennent désormais dans la même **boîte d'encre de
32 × 30 centrée sur (24, 24)** — 8 px de marge sur les flancs, 9 px en haut et en bas, identiques
pour les deux applis. Le banc mesure ces marges sur les chemins plutôt que de les supposer.

Deux points de technique méritent d'être dits, parce qu'ils ne se voient pas dans le rendu final.
Les lettres sont des **chemins** extraits de Plus Jakarta Sans ExtraBold — la police de l'appli — et
non du `<text>` : un logo composé dans une police du système change de dessin d'une machine à
l'autre. Et leur détourage passe par un `<mask>`, pas par un liseré peint de la couleur du fond : un
liseré n'est juste que sur le fond pour lequel on l'a choisi, alors que la marque est posée tantôt
sur `--card-bg` (barre du haut), tantôt sur `#0a0a0a` (icône). Le masque n'emploie que les contours
EXTÉRIEURS des lettres — avec les contre-formes, une corde traverserait le triangle du A et les
panses du B.

---

## Utilisation

### Saisie

La saisie se fait **exclusivement sur la tablature** ; la portée solfège s'en déduit — hauteurs,
orthographe des altérations selon l'armure, hampes, ligatures, lignes supplémentaires.

#### Le temps rendu s'écrit sur la grille que la mesure impose

Chaque fois qu'un geste libère du temps — raccourcir une note, en effacer une, en supprimer une avec
`Ctrl`+`Suppr` —, ce temps doit être réécrit en figures de silence. La règle n'est pas *« la plus
longue suite de figures qui somme juste »* : c'est *« les figures qui tombent sur la grille de CE
temps-là »*, et cette grille se déduit de ce que la mesure porte déjà, temps par temps. Un temps qui
porte un triolet est en trois, un temps qui porte une triple-croche est en huit, un temps vide n'est
coupé nulle part — et les trois cohabitent dans la même mesure, ce que fait n'importe quelle
tablature de blues.

**Ce que ça corrige, et c'était mesuré sur le geste le plus banal du répertoire.** Écrire trois
croches en triolet dans un 4/4 laissait la mesure à **3,875 noires au lieu de 4**. Aucune suite de
figures binaires ne somme un tiers de temps — `figuresPour(2/3)` ne rend que 0,625 — et le reliquat,
un vingt-quatrième de temps, était abandonné **en silence** à chaque triolet écrit. Douze croches en
triolet, un temps de swing ordinaire, faisaient pire : la mesure ressortait à **4,916667 noires**,
débordante de presque un temps, avec une note sur douze qui perdait son triolet en route et sortait
en double-croche.

La conversion elle-même n'était pas fautive : elle était **aveugle**. Une durée ne se laisse écrire
qu'en fonction de la grille sur laquelle elle tombe — un tiers de temps est une croche de *triolet*,
pas une approximation de croche. Le correctif donne la grille à la conversion
(`model/rythme.js#grilleDeMesure`, `#silencesAlignes`), et réutilise le convertisseur qui existait
déjà pour l'aide rythmique et l'import MIDI plutôt que d'en écrire un second.

Effet de bord bienvenu : les silences sont désormais **alignés sur les temps** partout. Deux temps et
demi rendus depuis le milieu du temps 2 donnent « croche + blanche », jamais « blanche + croche » —
une blanche à cheval sur la moitié de la mesure, que n'écrit aucune édition.

#### Ce qui est écrit est ce qui sonne

Une mesure peut se retrouver plus longue que sa signature sans qu'aucune édition ne l'ait voulu : il
suffit de poser du 3/4 sur un 4/4 déjà écrit, et les quatre noires restent en place. La lecture
comptait alors de deux façons à la fois — les évènements à leur durée **écrite**, l'avance d'une
mesure à l'autre à la **capacité** déclarée. Mesuré : la dernière note de la mesure courait de 3,00 à
4,00 pendant que la première de la suivante démarrait à 3,00. **Un temps entier où deux notes
sonnaient ensemble**, sans que rien ne l'explique.

`score.js#longueurMesure` donne désormais une seule réponse aux deux : une mesure prend sur l'axe du
temps la place qu'elle occupe **vraiment**. Une mesure trop pleine dure plus longtemps ; une mesure
incomplète garde sa capacité, pour que le silence manquant s'entende comme un silence plutôt que
comme un empiètement. C'est le comportement de Guitar Pro, qui signale la mesure fausse mais la joue
telle qu'elle est écrite.

Dans la foulée, **poser une signature redimensionne les voix VIDES** de la mesure : une voix qui ne
porte que du silence n'a rien à protéger, et c'est le cas de qui règle sa métrique *avant* d'écrire.
Une voix qui porte des notes n'est jamais touchée — la mesure devient trop pleine, le rectangle
d'avertissement le dit, et `Alt`+`R` (« ⇥ Corriger ») répartit à la demande.

#### Aucun changement de durée n'est refusé : la mesure s'endette

Le défaut, dans les mots de l'utilisateur : *« si j'ai écrit toutes mes notes mais que l'une d'entre
elles est trop courte, je ne peux plus modifier le rythme : l'application m'indique qu'il n'y a plus
de place. Dès que je fais une erreur de saisie, je ne peux plus revenir en arrière et l'application
m'oblige à supprimer la mesure entière et à recommencer. »*

**Mesuré** sur une mesure de 4/4 portant huit croches — la chose la plus banale qu'on puisse écrire :
**32 changements de durée sur 40 étaient refusés, soit 80 %**. Seuls les raccourcissements passaient.
Sur une mesure *à moitié vide* (quatre croches puis deux noires de silence), encore **65 %** : le
silence était là, mais pas contigu, et le balayage s'arrêtait à la première note rencontrée. Effacer
d'abord la note fautive ne débloquait rien non plus. Sur une mesure ne portant qu'**une seule** note,
0 % de refus — c'est le diagnostic en un chiffre : TabHub n'était pas un éditeur, c'était un
enregistreur. Il marchait tant qu'on écrivait vers l'avant, et se fermait dès qu'on revenait dessus.

**Un allongement prend désormais deux sources de place, dans cet ordre.**

1. **Tout le silence qui suit, où qu'il soit dans la mesure.** Traverser une note pour atteindre un
   silence ne coûte rien — un silence n'est pas de la musique, c'est du temps vide. Les notes
   traversées ne sont ni mangées ni réordonnées : elles glissent vers la droite de ce que la note
   agrandie leur prend. C'est ce qui fait qu'une mesure à moitié vide ne s'endette plus jamais.
2. **Le reste décale**, et la mesure devient plus longue que sa capacité. Elle porte alors une
   **dette**, gravée sur elle — « +½ ♩ » à droite, au-dessus de la portée — et payable de deux façons.

| Règlement | Touche | Ce qu'il fait | Ce qu'il coûte |
|---|---|---|---|
| **Absorber** | `Alt`+`A` | Ce qui suit le curseur cède la place. La note agrandie garde sa durée, ce qui suit la zone reprise retrouve sa position d'origine | Une note disparaît |
| **Déverser** | `Alt`+`R` | L'excédent part dans une mesure neuve | Rien, mais le morceau gagne une mesure |

Les deux boutons n'apparaissent **que** sur une mesure qui déborde — et c'est ce qui rend le message
honnête. L'ancien renvoyait vers un « Alt+R » que le refus lui-même rendait inapplicable : le refus
garantissait que la mesure restait valide, donc que le bouton restait caché. On désignait un remède
absent de l'écran.

**Pourquoi décaler plutôt qu'absorber par défaut.** Les deux modèles existent chez les logiciels
établis. [MuseScore absorbe](https://musescore.org/en/node/6477) — la note qui s'allonge mange celles
qui suivent — et c'est la plainte qui revient le plus sur ses forums : on y perd du travail sans
l'avoir demandé, au point que le projet a ouvert une
[page dédiée à la refonte de sa saisie](https://musescore.org/en/noteinput_redesign).
[Guitar Pro décale](https://www.guitar-pro.com/docs/gp8/score/bars) et laisse la mesure devenir
fausse en la signalant en rouge, ce que sa documentation présente comme un avantage. Entre les deux,
le choix se tranche seul : **décaler ne perd rien, absorber détruit**. Le geste par défaut est celui
qui se rattrape ; l'autre reste offert, explicitement, à qui le veut.

Là où TabHub va plus loin que les deux : Guitar Pro rougit la mesure sans rien dire de plus,
MuseScore mange sans rien dire du tout. Ici la mesure **dit de combien** elle déborde et **propose
les deux issues**, dont les boutons sont à l'écran au moment où on lit le message.

**Ce n'est pas la cascade qui avait été annulée** (*« repasse au modèle plus simple, colle à ce qui
est réalisé sur les logiciels pros »*). Celle-là **créait une mesure toute seule** et restructurait
le morceau. Ici rien ne sort de la mesure sans qu'on le demande : la dette y reste, visible, jusqu'à
ce qu'on choisisse. Les bancs vérifient explicitement qu'aucune mesure n'apparaît d'elle-même.

**Effet de bord, et ce n'était pas le moindre : la palette ne ment plus.** Palette sur « blanche »,
une case tapée sur un silence de croche dans une mesure pleine : l'agrandissement échouait, l'échec
était avalé, et il s'écrivait une **croche**. Mesuré : 1,5 temps d'écart entre le bouton actif et ce
qui apparaissait sur la partition, sans le moindre message. On croyait avoir écrit une blanche.

#### Rien ne disparaît sans un mot

Une règle, trois familles de conséquences, **un seul point d'annonce**. Une commande peut arriver par
six chemins (clavier, palette, menu contextuel, étirement à la souris, pavé tactile, bouton de la
barre) ; `prevenir()` passe par un seul endroit quoi qu'il arrive, et c'est là que tout se dit — un
endroit à tenir juste plutôt que six, et aucune chance qu'un septième chemin ajouté demain l'oublie.

**La liaison orpheline, et son vrai danger.** Une liaison relie une note à la *suivante* sur la même
corde. Raccourcir la première de deux noires liées glissait un silence entre les deux, et la liaison
pointait vers ce silence. Tant qu'elle y pointe, elle dort : le lecteur s'arrête faute de note à
prolonger, le traceur ne trouve pas de seconde note à relier. **Mais le jour où l'on écrit une case
dans ce silence** — le geste le plus naturel du monde — elle se réveille. Mesuré : une case 5 se
retrouvait **liée** à une case 9, deux hauteurs différentes réunies par une liaison de *prolongation*,
sans que personne l'ait demandé ni que rien ne le dise. Une corruption du document, silencieuse et
différée.

L'invariant « aucune liaison ne pointe vers le vide » est donc tenu à chaque mutation, et la liaison
retirée est **annoncée**. Elle ne s'applique ni à l'annulation ni au rétablissement : restaurer un
instantané doit le rendre *tel quel*, sinon un aller-retour cesserait de retomber sur ses pieds. Et
poser une liaison sur une note sans suivante **refuse en l'expliquant**, plutôt que de laisser
l'invariant la retirer dans la foulée — un bouton qui semble mort, on le presse trois fois en
cherchant ce qui cloche.

**Ce qu'un geste coûte quand son nom ne le dit pas.** Passer d'une guitare à une basse à quatre
cordes efface tout ce qui était écrit sur les cordes 5 et 6 : inévitable, elles n'existent plus — mais
fait depuis une liste déroulante de réglages, où l'on ne s'attend pas à perdre de la musique. Mesuré
sur un accord de six notes : quatre survivaient, deux disparaissaient, rien nulle part ne le
signalait. Même chose pour « retirer la seconde voix », qui emporte ce qu'elle portait. Les deux
disent maintenant ce qu'ils ont pris, et rappellent que `Ctrl`+`Z` le ramène. Un geste dont le nom
*est* la destruction — « supprimer la mesure », « effacer la note » — n'a rien à déclarer.

**Et rien ne parle pour rien** : écrire huit croches d'affilée ne déclenche aucun des trois canaux.
Un message qui se déclenche sans motif apprend à ignorer les messages.

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

On choisit d'abord **où** : un pas-à-pas « ◀ 3 ▶ » désigne la mesure de départ, et une rangée de
boutons **1 / 2 / 3 / 4** la longueur — les mesures visées sont décidées avant d'y poser quoi que ce
soit. L'aide **s'ouvre sur le rythme déjà écrit** dans ces mesures, et la division se déduit de ce
qu'elle y lit : un passage en triolets rouvre en ternaire sans qu'on ait à le dire. Elle sert donc
aussi à **corriger** un rythme, pas seulement à en créer un. Tant qu'on n'a rien dessiné, viser une
autre mesure montre ce qu'elle contient ; dès qu'on a dessiné, c'est le dessin qui suit.

Une rangée de **motifs** pose un rythme entier en un clic — *Noires, Croches, Doubles,
Pointé–bref, Galop* en binaire, *Noires, Triolets, Swing* en ternaire, et d'autres en mesure
composée. Reconnaître un motif demande moins que de savoir le dessiner, et c'est la réponse la plus
directe à la difficulté de départ.

On pose ensuite les barres dans la grille : un clic pose une note d'une case, un glissé la pose
tenue, un glissé sur une **poignée** — la petite zone à chaque bout de la note — l'étire ou la
raccourcit, un glissé sur son **corps** la déplace dans le temps, un clic sur son corps ou un clic
droit l'enlève. Trois repères disent à l'avance ce qui va se passer : la note survolée s'éclaircit,
un liseré clair marque le bout qu'on va tirer, et le curseur change (⟷ pour étirer, main pour
déplacer). Un étirement qui n'aboutit pas ne fait **rien** — viser une poignée, c'est vouloir
étirer, jamais effacer.

Les bâtons sont **translucides et gradués**, une marque par case : on voit la grille au travers et la
durée se **compte** au lieu de s'estimer. Une note peut **franchir la barre de
mesure** : elle est alors dessinée en deux morceaux (le second sans repère d'attaque, les angles
droits à la barre) et **écrite liée**. Tout cela existe aussi **au clavier** : les flèches déplacent
le focus, Espace ou Entrée pose et enlève, Maj + flèches allonge et raccourcit, Suppr efface.

Une note est **une pilule arrondie** d'un seul tenant, avec un repère d'attaque à son début — pas
une file de carrés accolés. Les temps sont numérotés **sous** les cases, et séparés par un simple
trait plus franc plutôt que par un cadre chacun. La division est **globale**, et ses deux choix
**dépendent de la mesure** : *Binaire / Ternaire* là où le temps est une noire, *Croches / Doubles*
en 6/8 où le temps est déjà ternaire par nature.

**Changer la longueur ou la division ne jette plus le travail.** Le rythme est requantifié sur la
nouvelle grille : les durées peuvent bouger — une double-croche n'existe pas en ternaire — mais
aucune note ne disparaît, sauf celles qui sortent d'une grille raccourcie. Et l'insertion **demande**
avant d'écraser des mesures qui portent déjà des notes.

TabHub affiche la **vraie écriture** en dessous : chiffres de triolet, ligatures pointée + double,
silences réécrits au plus court. C'est le moteur de gravure lui-même qui la produit, sur une
partition jetable sans tablature — donc elle ne peut pas mentir sur ce que l'insertion va écrire. Le
bouton **Boucle** joue ces mesures en rond, avec la tête de lecture sur la grille, et **suit les
modifications en direct** : poser une note pendant que ça tourne la fait entendre au tour suivant,
sans rien arrêter. La hauteur jouée est la **tonique de la tonalité du morceau**, cherchée en
position ouverte dans l'accordage courant.

L'insertion **remplace** les mesures visées, à l'endroit choisi à la souris ou au doigt, et laisse la
**tablature vide** : les cases à choisir apparaissent en surbrillance, `Tab` saute de l'une à la
suivante, et taper une case **ne change plus la durée** de l'évènement. C'est le point qui rendait
l'exercice impossible : la durée de la palette est collante, si bien qu'un rythme imposé de six
figures ressortait en six croches plates et la mesure à −1 temps.

Les notes et les effets s'écrivent ensuite, par-dessus un rythme déjà juste.

**La conversion en figures suit la place, pas seulement la durée**, et la règle n'est pas la même
pour ce qui se tait et pour ce qui sonne (retour utilisateur : « théoriquement parlant, j'ai
l'impression que cet outil est incohérent »). Un **silence** ne commence que sur une position
multiple de sa propre durée, et n'est jamais pointé hors mesure composée : cinq seizièmes à partir du
dernier seizième du temps 3 s'écrivent « quart-de-soupir puis soupir », dans cet ordre, et non
l'inverse. Une **note**, elle, a le droit d'enjamber un temps : `croche noire croche noire` en 4/4 —
la syncope la plus banale du répertoire — garde ses noires entières, sans liaison. On ne coupe une
note que faute de figure exacte, et on coupe alors **aux temps** : un tiers de temps tenu dans un
temps binaire sort en croche de triolet liée à une double-croche. Le même code sert à l'import MIDI
(`model/rythme.js`), donc les deux portes écrivent pareil.

**Le chiffre de n-olet ne vient pas de la grille mais de la durée.** Une version antérieure le posait
dès que la grille était en trois : en 6/8, où le temps est une noire pointée, les trois croches d'un
temps — leur division *ordinaire* — se retrouvaient donc marquées d'un « 3 » qu'aucune édition
n'écrit. La règle est maintenant qu'une durée exprimable par une figure simple s'écrit sans n-olet,
et qu'un n-olet n'apparaît que là où aucune figure ne tombe juste. Du même coup, les divisions
offertes suivent la signature : **quatre, trois ou huit** à la noire ; **trois, six ou douze** en
mesure composée ; **deux, trois ou quatre** en 5/8 et 7/8 — diviser un temps de 6/8 en *quatre*
produisait des triples-croches là où la grille n'en promettait pas.

Les boutons portent désormais le nom de la **figure** qu'une cellule vaut — « Doubles », « Ternaire »,
« Triples » — et non plus « Binaire / Ternaire ». Deux raisons : le mot dit quelque chose d'utile
(« Doubles » apprend ce qu'on va poser, « Binaire » ne l'apprenait pas), et c'est la seule règle qui
reste vraie maintenant que chaque famille offre **trois** divisions au lieu de deux. La
**triple-croche est toujours la dernière** : elle sert les traits rapides, pas le rythme courant, et
une grille neuve ne la prend jamais — trente-deux cases pour une mesure de 4/4 seraient illisibles.

Deux mesures se suivent **horizontalement** ; au-delà, elles passent à la ligne. Sur un téléphone
elles s'**empilent** — deux fois seize cases dans 390px ramèneraient chaque colonne sous dix pixels.

La grille ne défile plus : ses colonnes sont en `1fr`, donc une mesure occupe exactement la largeur
disponible et ne sort jamais de l'écran, ce qui a permis de retirer les deux flèches de défilement
dont la version précédente avait besoin (c'est aussi le choix du séquenceur de HarmoHub, et pour la
même raison). Le prix est mesuré plutôt que supposé, et il est réel : une case fait **19,6px de large
à 390px** et 15,3px à 320px, contre 26px fixes avant — c'est la **hauteur** qui prend le relais, 44px
au doigt contre 34 sur un écran d'ordinateur. En échange, les dernières cases d'une mesure ne sont
plus inatteignables au doigt, ce qu'elles étaient : les cases portent `touch-action: none` pour que
le glissé y pose une note, donc un doigt posé dessus ne pouvait pas faire défiler la grille.

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

**Deux voix sur la même portée**, pour une basse tenue sous la mélodie — le cas de *Jeux
interdits*, où le pouce garde un mi pendant que les doigts montent. Le moteur gravait déjà la
polyphonie (hampes opposées, silences décalés, ligatures et liaisons par voix) ; ce qui manquait était
la porte d'entrée. Les anciens boutons « + Voix » / « − Voix » avaient été retirés parce qu'ils ne
disaient pas à quoi ils servaient (« je ne comprends pas les boutons voix+/voix-, à quoi cela
sert-il ? »), et c'est bien le nom qui était le défaut, pas la fonction. À leur place, dans le cadre
**Écriture** :

- un seul bouton **« 2 voix »** (`Alt+V`) qui bascule la mesure courante, et dont l'infobulle nomme
  l'usage plutôt que le mécanisme — *une basse tenue sous la mélodie, par exemple* ;
- le repère **« Voix 1 → 2 »** (`Tab`), qui n'apparaît que là où il y a deux voix et qui dit à la
  fois où l'on écrit et où l'on ira : sans lui, la même touche envoyait la note ailleurs sans que
  rien ne l'annonce ;
- deux grains dans le **menu contextuel** — *cette mesure* ou *tout le morceau* — parce qu'une pièce
  à deux voix l'est du début à la fin, et que la poser mesure par mesure sur cinquante mesures n'est
  pas une commande mais une corvée. Les deux s'annulent d'**un seul retour en arrière**.

Sous 720px, ces deux boutons quittent la palette au profit du menu contextuel : ajoutés à la barre,
ils la faisaient déborder de 151px sur un écran de 360 (mesuré). Ce report a d'ailleurs révélé que
`hidden` ne masquait rien sur les boutons d'outil — `.btn-outil { display: inline-flex }` gagnait
contre l'attribut — donc que le mécanisme de visibilité dynamique de la palette était inopérant
depuis le début.

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

**Plusieurs FENÊTRES de l'application, elles, sont un autre sujet** — et le seul endroit où deux
copies de TabHub peuvent se marcher dessus. Tout ce qui vit hors de la page est partagé par l'origine
entière : le brouillon, les préférences, le dossier de rangement.

- **Le brouillon fusionne au lieu de s'écraser.** `localStorage` n'a qu'une clé pour toutes les
  fenêtres. Chacune y écrivant « ses » onglets, la dernière à écrire gagnait, et au rechargement
  suivant le travail de l'autre avait disparu sans un mot. Avant d'écrire, TabHub relit donc ce qui
  est là et garde les morceaux qu'il n'a pas — ils appartiennent à une fenêtre encore ouverte. Et il
  ne **ressuscite** pas ce qu'on a fermé : chaque fenêtre retient les morceaux qu'elle a tenus, ce qui
  distingue « je ne l'ai pas » de « je l'ai fermé » et couvre d'une seule règle la fermeture et le
  remplacement.
- **Le fichier sur le disque est protégé par le garde-fou**, et c'est le cas pour lequel il a été
  écrit : deux fenêtres sur le même morceau visent le même fichier canonique. La seconde à enregistrer
  est arrêtée, le travail de la première reste intact, et la fenêtre comparative propose de recharger,
  de garder les deux ou d'écraser — auquel cas l'ancien part quand même dans `_versions/`.

**Rien de tout cela sur téléphone** ni sur un écran de moins de 720px : « cette option prend trop de
place à l'écran ». La rangée se referme alors entièrement — pas un pixel de hauteur perdu. Les
onglets déjà ouverts ne sont pas effacés pour autant : ils restent en mémoire et dans le brouillon, et
réapparaissent dès que l'écran est assez large.

### Lecture

#### Ralentir pour travailler — sans toucher au tempo du morceau

Le bouton **« 100 % »** du bloc de lecture joue le morceau à **100, 75, 50 ou 25 %** de son tempo
écrit. Ce n'est pas un doublon du champ *Tempo* : ce sont deux nombres qui ne servent pas à la même
chose, et les confondre est précisément le défaut qu'on répare ici.

| | ce qu'il est | où il va |
|---|---|---|
| **Tempo** | ce que dit la partition | le `.json`, le PDF, le MIDI, la prochaine ouverture |
| **Vitesse** | ce que joue le lecteur maintenant | nulle part — il ne sort pas de la session |

Baisser le champ *Tempo* de 120 à 60 pour déchiffrer un passage **réécrit le morceau** : la valeur
part dans tous les exports et se retrouve à l'ouverture suivante comme si la pièce était lente. La
vitesse, elle, ne multiplie que l'horloge (`tempo écrit × vitesse`, le seul endroit du code qui
écrive sur l'horloge de Tone.js). Tout le reste suit gratuitement : la **tête de lecture** lit des
tics convertis en noires, donc elle reste juste à n'importe quelle vitesse, et le **décompte** se
calcule en secondes au tempo courant, donc il ralentit avec la musique — un décompte se compte à la
vitesse de ce qui suit.

On peut **ralentir sans arrêter** : Tone.js réétire son horloge et rien n'est reprogrammé, donc un
passage qui tourne en boucle peut passer à 50 % pendant qu'il tourne. C'est la manière dont on
travaille.

**Le bouton se tait à 100 % et s'accentue en dessous.** Une lecture ralentie qui ne se voit pas est
un piège : on rejoue un passage, on le trouve facile, et on ne comprend qu'à la scène qu'on ne l'a
jamais joué au tempo. Pour la même raison la vitesse **n'est pas retenue d'une session à l'autre** —
un 50 % qui survivrait en silence à un rechargement rouvrirait l'application en train de jouer
lentement sans que rien ne l'explique. C'est le raisonnement déjà appliqué à la bande de boucle.

**Sur téléphone, le réglage change de place, et c'est une décision de mesure.** Le bouton pèse 46px
et la barre du bas n'a que 19px de jeu à 320px : posé dans le bloc de lecture il la faisait déborder
de 56px à 320, 63 à 360 et 33 à 390 (mesuré largeur par largeur). Les seuls pixels qu'il restait à
reprendre étaient ceux de Lecture/Stop, arbitrés une fois à la mesure — et un réglage qu'on touche
deux fois par séance ne se paie pas sur les deux boutons les plus visés de l'application. Le rang des
quatre valeurs rejoint donc le popover voisin, sous les loupes et les mesures par ligne, dont le
bouton est *déjà* dans la barre : zéro pixel de plus. C'est mot pour mot le raisonnement qui avait mis
les loupes dans ce même popover.

**25 % en plancher, 100 % en plafond.** Au quart d'un tempo déjà lent, les notes cessent de former une
phrase ; et ce réglage existe pour *ralentir* — jouer plus vite que l'écrit se fait en écrivant le bon
tempo. Le plafond tient à une seule constante, mais le garder à 100 % laisse au bouton une lecture
immédiate : il ne peut que ralentir.

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
repartir du début à chaque essai. C'est une préférence de SESSION, jamais sauvée avec le morceau —
mais elle est **annulable** (voir plus bas).

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

**Annuler et Rétablir la couvrent** (retour utilisateur : « le bouton undo/redo doit aussi concerner
la mise en place de la barre de lecture »). Cela a demandé de revoir une décision antérieure, qui
gardait délibérément la boucle hors de l'historique — et pour une raison qui tenait : l'ancrage par
`id` avait justement été choisi pour n'avoir *pas* à la porter dans l'historique. Cette raison reste
valable et n'est pas défaite : l'historique ne décale toujours rien, il restitue une photo, et les
numéros continuent de se déduire des ancres à chaque édition.

Ce qui change, c'est qu'une photo voyage avec chaque étape, **sous forme d'annexe opaque**. La bande
appartient au lecteur, pas au document, et l'éditeur n'a aucune raison de savoir ce qu'est une boucle :
deux fonctions posées de l'extérieur suffisent — l'une dit « voici mon état courant », l'autre « repose
celui-ci ». Trois conséquences :

- **un geste = une étape.** Pendant un glisser, la boucle est reposée dans le lecteur à chaque
  changement de plage calée (pour que ça s'entende tout de suite) ; sans regroupement, défaire un seul
  geste coûterait autant de Ctrl+Z qu'il a traversé de temps — mesuré : 13 au lieu de 1.
- **une bande n'est pas du travail à sauver.** L'étape existe pour l'annulation et pour elle seule :
  elle ne marque pas le document modifié, sinon la fermeture réclamerait un enregistrement pour
  quelque chose qui n'est même pas dans le fichier. Les garde-fous comptent les étapes qui ont
  vraiment touché au document.
- **annuler une édition de notes remet aussi la boucle de ce moment**, ce qui est gratuit et la seule
  réponse cohérente — l'état du document remonte avec elle. Les deux histoires s'entrelacent sans se
  mélanger.

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

Nouveau, Ouvrir, Exporter, PDF, MIDI et MusicXML vivent groupés derrière un seul bouton **Fichiers** (barre du
haut) plutôt qu'en icônes séparées — six pictogrammes à deviner un par un s'est révélé peu clair à
l'usage, un menu à libellés en toutes lettres ne laisse rien à deviner. **Enregistrer** reste seul,
à part : c'est le geste le plus fréquent (persistance locale immédiate, pas un téléchargement), il
garde donc son propre bouton vert toujours visible plutôt que de se noyer dans le menu.

- **Enregistrer** range le morceau dans le navigateur (`localStorage`) — aucun téléchargement,
  seulement le geste le plus fréquent rendu instantané (aussi `Ctrl+S`).
- **Exporter** télécharge, lui, un `.json` indenté qui est le modèle tel quel — lisible et modifiable
  à la main ; c'est le fichier à archiver ou à faire circuler.

#### Le nom des fichiers — la règle de HarmoHub, portée ici

Tous les fichiers exportés portent la forme **« TabHub - Morceau - Type - Date Heure.ext »** :

```
TabHub - Blackbird - Beatles - Morceau - 2026-09-18 1432.json
TabHub - Blackbird - Beatles - Partition - 2026-09-18 1432.pdf
TabHub - Blackbird - Beatles - Refrain - MIDI - 2026-09-18 1432.mid
```

C'est **la règle de HarmoHub**, reprise sans être réinventée : le module qui la porte là-bas annonce
dès sa première ligne qu'il est prévu pour les deux applications, avec le nom de l'appli en
paramètre. Chaque segment règle une chose précise :

- **l'appli en tête**, pour que les fichiers des deux ne se mélangent jamais dans un même dossier de
  téléchargement ;
- **le morceau ensuite**, parce que c'est par morceau qu'on se perd : toutes ses pièces se retrouvent
  côte à côte dans un explorateur trié par nom ;
- **le type puis la date**, pour que les versions d'un même document s'empilent chronologiquement ;
- **l'heure**, qui n'est pas décorative : sans elle, deux exports le même jour donnent « (1) » et
  « (2) » ajoutés par le navigateur — précisément ce qui fait perdre le fil. Les deux-points étant
  interdits sous Windows, elle s'écrit « 1432 ».

Un seul endroit décide de ce nom (`io/fichiers.js`), pour les cinq routes d'export — elles
interpolaient chacune la leur, et avaient déjà divergé une fois. L'assainissement y gagne ce qui
manquait : caractères de contrôle retirés, longueur bornée, et surtout **les points et espaces en fin
de nom supprimés**, que Windows efface silencieusement à la création — un fichier ne porte alors pas
le nom qu'on croit lui avoir donné.

**Une divergence assumée avec HarmoHub** : le repli en ASCII. « Étude » donne « Etude », parce que
tout caractère non-ASCII posé dans l'attribut `download` d'un lien fait retomber le navigateur sur son
nom par défaut — le fichier arrivait nommé « download ». Mesuré caractère par caractère ici ; HarmoHub
ne le fait pas. Un accent en moins reste un nom qu'on reconnaît.

#### Ranger les exports dans un dossier choisi

Par-dessus le nommage vient un second étage : **désigner un dossier une fois** (Réglages → Fichiers),
et les exports s'y classent par type — `Morceaux`, `PDF`, `MIDI`, `MusicXML`. L'arborescence est créée
au moment du choix, pas au premier export de chaque type : un dossier vide n'inspire pas confiance.

**Quatre dossiers et non les huit de HarmoHub**, et c'est la principale adaptation : TabHub n'a ni
bibliothèque de morceaux, ni paroles, ni export audio. Créer le classement de ce qu'on ne rangera
jamais est exactement ce que HarmoHub a fini par retirer chez lui — un dossier vide est une invitation
à y chercher quelque chose qui n'y sera pas.

**Le second étage ne remplace jamais le premier.** File System Access n'existe que sur Chrome et Edge
en version bureau : ni Safari (Mac *et* iPhone), ni Firefox, ni Chrome Android. Et même là où elle
existe, tout peut échouer — dossier débranché, permission retirée, clé USB ôtée. Dans tous ces cas
l'export **repart en téléchargement** au lieu de disparaître : un export qui ne produit rien serait
bien pire qu'un export mal rangé. La ligne de réglage reste visible sur les navigateurs sans l'API et
dit pourquoi, plutôt que de s'effacer.

**Trois pièges, relevés par HarmoHub et retrouvés ici :**

- la permission se demande **avant** le rendu du PDF, pas après : la gravure passe plusieurs secondes
  dans jsPDF et Bravura, après quoi le navigateur juge le geste expiré et n'affiche plus rien — on
  retomberait en silence dans Téléchargements alors qu'un dossier est configuré ;
- on demande à jsPDF **les octets**, pas d'enregistrer lui-même : sa méthode d'enregistrement pose son
  propre lien de téléchargement et ne rend rien, il n'y aurait donc rien à ranger ;
- le **nom** du dossier est doublé dans `localStorage`, parce que lire IndexedDB demande un `await` et
  qu'un panneau de réglages se construit d'un trait : sans ce doublon il ne pourrait pas annoncer la
  destination au moment où il s'affiche. La poignée, elle, reste dans IndexedDB — seul magasin du
  navigateur qui sache la sérialiser.

Enfin, **la destination affichée après un export vient d'un seul endroit** : « → Téléchargements »
écrit en dur dans chaque route deviendrait faux dès qu'un dossier existe, et une destination annoncée
à tort est exactement ce qui fait perdre un fichier.


#### Deux noms pour un même morceau, et un garde-fou

Jusqu'ici rien n'écrasait jamais rien : chaque export porte son horodatage, donc chaque export crée un
fichier de plus. C'est une sûreté **par accumulation**, et son prix est que rien n'est jamais
*remplacé* — dix exports d'« Étude » donnent dix fichiers sans qu'aucun soit **le** fichier d'Étude.

D'où deux noms pour un même document :

- dans le **dossier** choisi, un nom **canonique** et stable (`TabHub - Étude - Dyens - Morceau.json`).
  Toujours le même, donc toujours à la même place, et le contenu précédent part dans `_versions/` ;
- en **téléchargement**, le nom horodaté : là il n'y a ni rotation ni dossier de versions, et deux
  fichiers de même nom deviennent « (1) », « (2) ».

**Les archives sont datées à la seconde**, et c'est un défaut trouvé au banc qui l'a imposé : à la
minute, quatre enregistrements rapprochés portaient le même nom et s'écrasaient l'un l'autre. Le filet
de sécurité se vidait tout seul, en silence, exactement dans le cas où l'on en a le plus besoin — des
essais successifs en quelques minutes. Deux `Ctrl+S` d'affilée suffisaient. Dix archives sont gardées.

**Le garde-fou lit le fichier en place avant d'écrire.** S'il est plus récent que la version ouverte
ici — un autre onglet, une autre machine, une version oubliée — ou s'il appartient à un *autre*
morceau portant le même titre, **rien n'est écrit** et une fenêtre comparative s'ouvre :

| | |
|---|---|
| **Recharger depuis le disque** | reprendre la version qui est là |
| **Garder les deux** | la nôtre part sous son nom horodaté, à côté |
| **Écraser** | et l'ancien fichier part quand même dans `_versions/` |
| **Annuler** | rien n'est écrit |

Quatre issues et non trois : sans « recharger », il faudrait annuler puis rouvrir le fichier à la
main — exactement le temps qu'on cherche à faire gagner.

Deux morceaux différents peuvent porter le même titre *et* le même artiste. C'est leur **date de
création** qui les distingue, et elle voyage dans le fichier depuis le premier jour.

Enfin, **`Ctrl+S` écrit aussi le fichier** quand un dossier est configuré — sans jamais bloquer
l'enregistrement local, qui reste la vraie sauvegarde. Sans cela, « Enregistrer » et « le fichier sur
le disque » divergent en silence, et l'on croit avoir sauvegardé ce qui n'est que dans le navigateur.

- **Ouvrir** relit un `.json`. Tout champ y est borné à la relecture : un fichier abîmé s'ouvre
  réparé plutôt que de faire planter le rendu.

  **Ouvrir le *même* morceau n'est pas ouvrir un autre morceau.** Réouvrir « Étude » alors qu'« Étude »
  est déjà ouvert n'est presque jamais une demande d'écrasement : c'est qu'on ne sait plus laquelle des
  deux versions est la bonne. TabHub montre alors ce qui les distingue — date de dernière
  modification, nombre de mesures, laquelle est la plus récente — et propose **ne rien changer**,
  **garder les deux** ou **remplacer**. Deux morceaux sont « le même » s'ils partagent leur date de
  création, ou à défaut leur **titre** (casse et espaces indifférentes, mais « Étude (2) » reste
  distinct). Ce repli par le titre répare un vrai défaut : un fichier reçu d'ailleurs n'a pas la même
  date de création, aucun conflit n'était donc détecté, et l'on empilait un morceau de plus sous le
  même titre.

  **« Garder les deux » ouvre un onglet**, et c'est l'adaptation propre à TabHub : là où HarmoHub doit
  poser une copie renommée au milieu de sa bibliothèque — « Titre (import du 14/09/2025) », et deux
  imports plus tard on ne sait plus lequel est le bon — les deux versions s'ouvrent ici côte à côte et
  se comparent à l'œil. Rien n'est renommé, rien n'est enterré.
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
- **Fichiers du disque…** ouvre un panneau qui lit le **dossier**, pas ce que l'application connaît —
  et c'est toute sa raison d'être. TabHub n'a pas de bibliothèque : un morceau exporté il y a trois
  mois n'existe plus nulle part dans l'application, mais son fichier est toujours là. Le panneau le
  montre, groupé par morceau avec tous ses fichiers (`.json`, PDF, MIDI, MusicXML et archives), et
  permet de le **reprendre** — dans un nouvel onglet, pour ne rien remplacer — ou de l'**effacer**.

  « Ouvrir » reste grisé pour un morceau dont il ne reste qu'un PDF : une image ne se rouvre pas, et
  proposer le bouton quand même serait promettre ce qu'on ne peut pas tenir.

  **La suppression montre la liste exacte avant de demander**, chemin par chemin. Le regroupement se
  fait sur le **nom de fichier** et jamais sur le contenu : un PDF n'a rien d'interrogeable, et un
  `.json` renommé à la main doit quand même rester avec ses frères. Le piège n'est pas théorique —
  les fichiers d'« Étude » et ceux d'« Étude - live » commencent par la même chaîne, et sans
  précaution supprimer le premier emporterait le second. Une règle l'évite, mais la sûreté ne vient
  pas d'elle : elle vient de ce que la liste est sous les yeux.
- **Exporter en MusicXML** écrit un `.musicxml` que MuseScore, Finale, Sibelius, Dorico et Guitar
  Pro lisent tous — et c'est le seul des quatre exports qui transporte l'**écriture**. Le `.json`
  n'est relu que par TabHub, le PDF est une image, le `.mid` ne porte que des hauteurs et des durées.
  MusicXML, lui, porte la *tablature* : la corde et la case de chaque note y sont des éléments de
  première classe (`<string>`, `<fret>`), pas une astuce. C'est donc le fichier qu'on envoie à un
  professeur, à un arrangeur ou à un copiste.

  **Ce qui part** : deux portées liées (notation + tablature, avec sa clé `TAB` et ses lignes), les
  figures avec leurs points et leurs n-olets, les liaisons de prolongation *même par-dessus une barre
  de mesure*, les hammer-on / pull-off (un arc sur la portée, un `<hammer-on>` dans la tablature),
  les slides, les bends en demi-tons, les deux voix avec leurs hampes opposées, l'armure et son mode,
  les signatures y compris un changement en cours de morceau, le tempo, les reprises et leur nombre
  de fois, les barres doubles et finales, les six repères de navigation, les noms d'accords en
  **vraies `<harmony>`** (« F#m7 » devient fa-dièse septième mineure, donc transposable et jouable,
  et non une étiquette de texte), les annotations de section, les nuances, l'accent, le staccato, le
  palm mute, les notes fantômes, l'accordage corde par corde et le capodastre.


  **Les altérations viennent de la même règle que la gravure à l'écran**
  (`engine/layout.js#memoireAlterations`, exportée pour cela) : une altération vaut jusqu'à la barre,
  pour toutes les notes de même nom et même octave. C'est ce qui fait qu'un *si naturel en fa
  majeur* reçoit son bécarre — le cas qui condamne la solution naïve, puisque l'altération de cette
  note vaut zéro.

  **Ce qui ne part pas, dit franchement.** Le **swing** n'a pas d'élément standard en MusicXML 3.1
  (MuseScore le range dans son propre format) : il sort en texte au-dessus de la première mesure
  (« Swing ♫ = ♩♪ »), lisible par un humain, ignoré par la machine — les notes, elles, partent
  droites, ce qui est l'écriture juste. La **mise en page** n'est pas imposée, sauf les retours à la
  ligne demandés explicitement : le nombre de mesures par ligne de TabHub est un réglage d'écran, pas
  une propriété du morceau, et l'imposer serait dicter au lecteur une gravure qu'il sait faire mieux
  sur son format de papier.

  **Version 3.1 et non 4.0** : la 4.0 n'apporte rien dont cet export ait besoin, et 3.1 est la
  version que tout lecteur en service accepte — y compris les Finale et Sibelius d'il y a quelques
  années, qui sont précisément ceux d'un professeur à qui l'on envoie un fichier.

  **Comment on sait que ça marche.** Trois niveaux, du plus faible au plus fort, et chacun a trouvé
  quelque chose :

  1. **Le schéma officiel.** Les treize morceaux d'essai (les quatre instruments à vide, un morceau
     portant *tout*, les six repères, toutes les figures et n-olets, les quinze armures, les
     signatures irrégulières, un titre truffé de caractères hostiles, deux voix partout, un piano à
     deux mains, une mesure unique) valident contre le XSD MusicXML 3.1 du W3C.
  2. **Un moteur de gravure indépendant.** [Verovio](https://www.verovio.org/) charge et grave les
     treize fichiers sans un message, et la tablature s'y dessine juste : chaque case tombe sur sa
     corde, à 5px près pour un interligne de 315.
  3. **Un aller-retour sémantique.** Le fichier est relu par ce moteur, rendu en MIDI, et les notes
     qu'il en tire sont comparées une à une à celles de la partition d'origine : **mêmes hauteurs aux
     mêmes instants**, accord, triolet, note pointée, deux voix et capodastre compris. Aucune
     vérification de structure ne dit cela — un fichier peut être valide, bien ordonné, et décrire
     une autre musique.

  Deux vrais défauts sont sortis de là, et tous deux ont changé le code :

  - **Le capodastre est fondu dans l'accordage déclaré**, et l'élément `<capo>` n'est pas écrit. La
    lecture naïve du format voudrait l'inverse — la spécification dit que `<capo>` « décale
    l'accordage des cordes d'autant de demi-tons ». Mesuré : sur un morceau à capodastre 2, le moteur
    tirait 14 notes justes (la portée de notation, où la hauteur est écrite en clair) et 14
    exactement **deux demi-tons plus bas** (la tablature, recalculée sans honorer `<capo>`). Le
    fichier se contredisait d'une portée à l'autre, et rien ne permettait de trancher. Fondu dans
    l'accordage, corde + case donne la hauteur sonnante chez tout le monde ; l'indication part en
    texte (« Capodastre case 2 ») pour le guitariste, à qui une case 0 sous capodastre ne dit pas le
    sillet.
  - **Hammer-on, pull-off et bend vont sur la portée de notation**, avec l'arc de liaison qu'ils
    nomment — pas sur la tablature. Le moteur refuse d'attacher une articulation à un groupe de
    tablature (« Adding 'artic' to a 'tabGrp' », cinq fois sur le morceau complet) et les **jetait**
    donc : fichier valide, « H », « P » et flèche de bend perdus. La corde et la case, elles, font le
    chemin inverse et restent sur la tablature, qui les dessine.

  *Ce qui reste à faire* : l'ouvrir dans MuseScore, Finale ou Sibelius. Aucun des trois n'est
  installable ici, et un moteur tiers, même exigeant, n'est pas eux.
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

- **Deux voix par portée, pas trois.** C'est assez pour une basse tenue sous la mélodie (voir
  *Saisie*), pas pour une fugue : `MAX_VOIX = 2`. Une troisième voix demanderait de répartir les
  hampes autrement que « l'une en haut, l'autre en bas », donc de revoir la gravure, pas d'ouvrir un
  cran de plus.
- **Pas de dépliage des reprises à la lecture.** Les barres de reprise s'écrivent et s'exportent,
  mais la lecture parcourt la partition écrite, une fois.
- **Un synthétiseur simple**, pas un échantillon de guitare — un son d'échantillons pèserait plusieurs
  mégaoctets à vendorer.
- **Pas d'IMPORT Guitar Pro** (`.gp5`, `.gpx`) **ni MusicXML.** L'export MusicXML existe (voir
  *Fichiers*) ; le sens inverse est un autre travail — un fichier venu d'ailleurs peut porter dix
  portées, des instruments que TabHub ne connaît pas et une notation dont il n'écrit rien, et décider
  quoi en faire ne se règle pas par un analyseur.
- **L'import MIDI fond tout dans une seule voix.** Deux lignes indépendantes qui sonnent ensemble
  deviennent une suite d'accords : séparer les voix d'un fichier source est un problème autrement
  plus dur, et l'import ne pose jamais la seconde voix que TabHub sait pourtant graver. Le rythme, lui,
  n'est plus aplati : triolets et swing sont désormais lus correctement (voir *Le rythme d'un fichier
  importé*).
- **Aucune division plus fine que la triple-croche.** Elle s'écrit partout depuis la palette, s'offre
  comme troisième division de l'aide rythmique et se reconnaît à l'import MIDI — mais une quadruple
  s'approche à la triple la plus proche. À l'import, une grille en huit ne se retient que si elle
  explique le temps **deux fois mieux** que la meilleure grille plus grossière : une grille plus fine
  explique toujours un peu mieux, par simple arithmétique, et sans cette marge un morceau joué à la
  main ressortirait constellé de triples-croches.
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
| Plus Jakarta Sans (Tokotype) | **SIL OFL 1.1** | contours des lettres T, A, B de la marque, extraits dans `icons/favicon.svg` et `index.html` |

« Bravura » est un nom de police réservé au sens de l'OFL : TabHub ne redistribue pas une police,
mais des contours dérivés, et ne porte pas ce nom.

Même principe pour Plus Jakarta Sans : aucun fichier de police n'est versionné ici, seuls les
contours de trois lettres le sont — comme le permet l'OFL pour une œuvre dérivée.

Pour régénérer les glyphes après une mise à jour de Bravura :

```sh
pip install fonttools
python3 outils/generer-glyphes.py chemin/vers/Bravura.otf
```

Et pour régénérer les marques après une retouche du dessin :

```sh
python3 outils/generer-logos.py chemin/vers/PlusJakartaSans-ExtraBold.ttf
```

Les deux polices se récupèrent chez leurs éditeurs (Bravura chez Steinberg, Plus Jakarta Sans sur
Google Fonts) ; elles ne sont nécessaires que pour régénérer, jamais pour faire tourner l'appli.
