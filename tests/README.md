# Bancs d'essai TabHub

**45 bancs, 1295 vérifications**, dans l'esprit de ceux de HarmoHub : chacun documente en tête CE
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
| `rendu_double_portee_test.js` | Cinq lignes + six cordes, alignement des deux portées, découpage en systèmes |
| `accordages_test.js` | Trois instruments, accordages prédéfinis et personnalisés, capodastre |
| `exports_test.js` | Aller-retour `.json` sans perte, PDF réellement vectoriel |
| `lecture_audio_test.js` | Transport, fusion des liaisons, tête de lecture accrochée à l'horloge audio, et LE CHEMIN DE CHARGEMENT RÉUSSI du piano — échantillons servis par le banc, car le réseau bloqué ne le joue jamais |
| `effets_test.js` | Les effets, de la commande au SON : un slide fusionne ses deux notes, et sa hauteur glisse sur un échantillon de PIANO (la voix synthétisée ne servant plus que hors ligne) |
| `performance_test.js` | Le coût d'un redessin ne suit pas la longueur du morceau |
| `rythme_test.js` | L'aide rythmique : grille, conversion en vraies figures, aperçu gravé, insertion placée |
| `rythme_impose_test.js` | Taper une case NE change PAS la durée d'un rythme imposé, et la surbrillance survit |
| `ternaire_test.js` | Une seule grille de temps pour l'audio, le métronome et le MIDI ; la tête de lecture repasse par la réciproque ; l'indication gravée |
| `midi_test.js` | Aller-retour `.mid`, doigté par zone de manche, export par section, notes de même hauteur chevauchées |
| `import_rythme_test.js` | Triolets et swing importés JUSTE : une grille par temps, la question binaire/ternaire, la détection qui ne confond pas swing et vrais triolets |
| `onglets_test.js` | Plusieurs morceaux ouverts : l'ÉTANCHÉITÉ des documents, ce qui reste commun (durée, presse-papier), le brouillon multi-onglets, et rien au doigt |
| `boucle_lecture_test.js` | La bande orange : geste souris/doigt, poignées, l'ancrage qui la fait suivre ses mesures, l'aperçu qui suit le PIXEL (mesuré : quatre largeurs distinctes dans UNE mesure), le fantôme qui la rend découvrable, le défilement sous un doigt immobile, la prise des poignées mesurée par balayage, et l'annulation qui la couvre sans mélanger les deux histoires |
| `zoom_ecran_test.js` | Les loupes changent la GRAVURE (pas un nombre) ; `Ctrl+molette` zoome la partition en confisquant le geste, et le laisse au navigateur partout ailleurs |
| `pwa_test.js` | L'icône d'écran d'accueil et la marque : `apple-touch-icon` carré plein cadre, PNG du manifest, et surtout le favicon qui trace EXACTEMENT les mêmes chemins que le logo de la barre du haut — lettres en chemins (pas de `<text>`), détourage par masque (pas un liseré peint du fond), cordes d'opacité uniforme, et une marge d'encre mesurée de 8 px sur les flancs / 9 px en haut et en bas. **Sans navigateur.** |
| `tactile_test.js` | Écrire au doigt (pavé, tap, appui long, glisser qui défile) et le pincement à deux doigts qui zoome la partition, pas la page |

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
