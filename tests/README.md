# Bancs d'essai TabHub

Cinq bancs, dans l'esprit de ceux de HarmoHub : chacun documente en tête CE QU'IL PROTÈGE et
pourquoi. Ils valent autant comme mémoire des décisions que comme filet de sécurité — plusieurs
d'entre eux existent parce qu'ils ont attrapé un vrai défaut, et le commentaire le raconte.

| Banc | Ce qu'il protège |
|---|---|
| `modele_test.js` | Théorie, durées, accordages, normalisation d'un fichier importé. **Sans navigateur.** |
| `saisie_clavier_test.js` | Cases à deux chiffres, prolongation de mesure par `→`, accords, annulation |
| `rendu_double_portee_test.js` | Cinq lignes + six cordes, alignement des deux portées, découpage en systèmes |
| `accordages_test.js` | Trois instruments, accordages prédéfinis et personnalisés, capodastre |
| `exports_test.js` | Aller-retour `.json` sans perte, PDF réellement vectoriel |
| `lecture_audio_test.js` | Transport, fusion des liaisons, tête de lecture accrochée à l'horloge audio |

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

Dans le doute : rejouer le banc sur le commit d'AVANT (via `git worktree`, servi sur un second port).
S'il y échoue à l'identique, ce n'est pas une régression.
