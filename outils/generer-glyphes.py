#!/usr/bin/env python3
"""Extrait les contours des glyphes musicaux de Bravura vers src/engine/glyphes-bravura.js.

POURQUOI EXTRAIRE PLUTÔT QU'EMBARQUER LA POLICE. Bravura est la police de référence SMuFL, dessinée
par Steinberg et publiée sous licence SIL OFL 1.1 — donc librement utilisable. Restait à choisir
COMMENT s'en servir. Trois raisons ont fait préférer l'extraction des contours à l'embarquement du
fichier de police :

  1. jsPDF ne sait embarquer que des polices TrueType. Bravura est une OpenType/CFF : il faudrait la
     convertir, donc la modifier — ce que le nom de police réservé décourage — et ajouter une chaîne
     d'outillage à un projet qui n'en a aucune.
  2. Une police se charge de façon ASYNCHRONE. Tant qu'elle n'est pas arrivée, la partition s'affiche
     avec des carrés blancs ou une police de repli, puis saute. Des contours embarqués dans le module
     sont là dès la première image.
  3. La police complète pèse 889 ko pour les 57 signes utilisés ici. Les contours extraits en pèsent
     une petite fraction, et ne partent pas non plus dans chaque PDF exporté.

L'architecture de TabHub y gagne au passage : les contours arrivent dans le MÊME format que le reste
(chemins M/L/C/Z en unités d'interligne), donc les deux moteurs de rendu — SVG et jsPDF — n'ont
strictement rien à apprendre. Le dessin devient officiel sans qu'aucune ligne de rendu ne change.

CONVENTION SMuFL : 1 cadratin = 4 interlignes, et l'origine de chaque glyphe est son point d'ancrage
musical (le centre de la spirale pour la clé de sol, la ligne de la note pour une tête). C'est
exactement ce dont le moteur de mise en page a besoin. Seul l'axe y est inversé — une police compte
vers le haut, un SVG vers le bas.

Usage :  python3 outils/generer-glyphes.py chemin/vers/Bravura.otf
"""
import sys, os
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
from fontTools.pens.boundsPen import BoundsPen

# --- Ce qu'on extrait, et comment on cale son origine ------------------------------------------
# 'centrer'  : l'origine est ramenée au milieu horizontal du glyphe (têtes de note, chiffres, points)
#              — le moteur de mise en page pose ces signes par leur centre.
# 'origine'  : l'ancrage de la police est conservé tel quel (clés, altérations, silences, crochets)
#              — c'est déjà le point musical utile.
GLYPHES = [
    # clé                       codepoint  ancrage
    ('cleSol',                  0xE050, 'origine'),
    ('cleSol8vb',               0xE052, 'origine'),
    ('cleFa',                   0xE062, 'origine'),
    ('cleFa8vb',                0xE064, 'origine'),
    ('cleTab6',                 0xE06D, 'origine'),
    ('cleTab4',                 0xE06E, 'origine'),

    ('teteRonde',               0xE0A2, 'centrer'),
    ('teteBlanche',             0xE0A3, 'centrer'),
    ('teteNoire',               0xE0A4, 'centrer'),
    ('teteCroix',               0xE0A9, 'centrer'),

    ('alterationBemol',         0xE260, 'origine'),
    ('alterationBecarre',       0xE261, 'origine'),
    ('alterationDiese',         0xE262, 'origine'),
    ('alterationDoubleDiese',   0xE263, 'origine'),
    ('alterationDoubleBemol',   0xE264, 'origine'),

    ('silenceRonde',            0xE4E3, 'origine'),
    ('silenceBlanche',          0xE4E4, 'origine'),
    ('silenceNoire',            0xE4E5, 'origine'),
    ('silenceCroche',           0xE4E6, 'origine'),
    ('silenceDouble',           0xE4E7, 'origine'),
    ('silenceTriple',           0xE4E8, 'origine'),

    # Bravura fournit un crochet DISTINCT pour hampe montante et descendante — ce ne sont pas des
    # miroirs l'un de l'autre, contrairement à ce qu'une version dessinée à la main supposait.
    ('crochetCrocheHaut',       0xE240, 'origine'),
    ('crochetCrocheBas',        0xE241, 'origine'),
    ('crochetDoubleHaut',       0xE242, 'origine'),
    ('crochetDoubleBas',        0xE243, 'origine'),
    ('crochetTripleHaut',       0xE244, 'origine'),
    ('crochetTripleBas',        0xE245, 'origine'),

    ('point',                   0xE1E7, 'centrer'),
    ('pointsReprise',           0xE044, 'origine'),
    ('accentDessus',            0xE4A0, 'centrer'),
    ('accentDessous',           0xE4A1, 'centrer'),
    ('staccatoDessus',          0xE4A2, 'centrer'),
    ('noireTempo',              0xECA5, 'origine'),
]
GLYPHES += [(f'chiffre{i}', 0xE080 + i, 'centrer') for i in range(10)]
GLYPHES += [(f'chiffreNolet{i}', 0xE880 + i, 'centrer') for i in range(10)]


class CheminPen(BasePen):
    """Pen minimal : ne produit que M, L, C et Z, en absolu.

    BasePen convertit d'office les courbes quadratiques en cubiques, si bien que le vocabulaire de
    sortie reste celui — volontairement minuscule — que les deux moteurs de rendu de TabHub savent
    lire. Rien à apprendre côté rendu, quelle que soit la police d'origine.
    """
    def __init__(self, glyphSet, echelle, dx, dy, decimales=4):
        super().__init__(glyphSet)
        self.parties, self.k, self.dx, self.dy, self.n = [], echelle, dx, dy, decimales

    def _p(self, pt):
        # y inversé : une police compte vers le haut, un SVG vers le bas.
        x = (pt[0] * self.k) + self.dx
        y = -(pt[1] * self.k) + self.dy
        return f'{round(x, self.n):g} {round(y, self.n):g}'

    def _moveTo(self, pt):   self.parties.append('M ' + self._p(pt))
    def _lineTo(self, pt):   self.parties.append('L ' + self._p(pt))
    def _curveToOne(self, p1, p2, p3): self.parties.append(f'C {self._p(p1)} {self._p(p2)} {self._p(p3)}')
    def _closePath(self):    self.parties.append('Z')
    def _endPath(self):      self.parties.append('Z')

    def chemin(self):        return ' '.join(self.parties)


def extraire(chemin_police):
    police = TTFont(chemin_police)
    upem = police['head'].unitsPerEm
    echelle = 4.0 / upem                 # SMuFL : 1 cadratin = 4 interlignes
    cmap = police.getBestCmap()
    jeu = police.getGlyphSet()

    nom_police = next((str(r) for r in police['name'].names if r.nameID == 1 and r.platformID == 3), 'Bravura')
    version = next((str(r) for r in police['name'].names if r.nameID == 5 and r.platformID == 3), '?')

    sortie, absents = {}, []
    for nom, cp, ancrage in GLYPHES:
        gnom = cmap.get(cp)
        if gnom is None:
            absents.append((nom, cp))
            continue
        bp = BoundsPen(jeu)
        jeu[gnom].draw(bp)
        if bp.bounds is None:
            absents.append((nom, cp))
            continue
        x0, y0, x1, y1 = [v * echelle for v in bp.bounds]
        dx = -(x0 + x1) / 2 if ancrage == 'centrer' else 0.0
        pen = CheminPen(jeu, echelle, dx, 0.0)
        jeu[gnom].draw(pen)
        sortie[nom] = {
            'd': pen.chemin(),
            # Boîte englobante en interlignes, y déjà inversé (donc haut < bas). Le moteur de mise en
            # page s'en sert pour MESURER au lieu de deviner : la largeur à réserver devant une
            # altération, la place d'une clé. Une table de largeurs écrite à la main dériverait du
            # dessin réel à la première retouche.
            'boite': [round(x0 + dx, 4), round(-y1, 4), round(x1 + dx, 4), round(-y0, 4)],
        }
    return sortie, absents, nom_police, version, len(GLYPHES)


def ecrire(sortie, nom_police, version, destination):
    lignes = [
        '// FICHIER GÉNÉRÉ — ne pas modifier à la main.',
        '// Produit par outils/generer-glyphes.py ; relancer cet outil pour le régénérer.',
        '//',
        f'// Contours extraits de {nom_police} {version}, la police de référence SMuFL',
        '// © Steinberg Media Technologies GmbH, sous licence SIL Open Font License 1.1',
        '// (texte intégral dans vendor/OFL-Bravura.txt). Nom de police réservé : « Bravura » — ce',
        '// fichier ne redistribue pas une police, mais des contours dérivés, et ne porte pas ce nom.',
        '//',
        '// UNITÉS : interlignes de portée, y vers le bas (comme en SVG). L\'origine de chaque glyphe',
        '// est son point d\'ancrage musical au sens SMuFL — pour une clé de sol, le centre de sa',
        '// spirale, à poser sur la ligne de sol ; pour une tête de note, le centre de la tête.',
        '// `boite` donne la boîte englobante [gauche, haut, droite, bas], pour mesurer plutôt que deviner.',
        '',
        'export const GLYPHES_BRAVURA = {',
    ]
    for nom, g in sortie.items():
        lignes.append(f"    {nom}: {{ d: '{g['d']}', boite: [{', '.join(str(v) for v in g['boite'])}] }},")
    lignes += ['};', '']
    with open(destination, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lignes))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__.strip().splitlines()[-1]); sys.exit(2)
    racine = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dest = os.path.join(racine, 'src', 'engine', 'glyphes-bravura.js')
    sortie, absents, nom, version, demandes = extraire(sys.argv[1])
    ecrire(sortie, nom, version, dest)
    print(f'{len(sortie)}/{demandes} glyphes extraits de {nom} {version} → {os.path.relpath(dest, racine)}')
    print(f'{os.path.getsize(dest) / 1024:.1f} ko (police complète : {os.path.getsize(sys.argv[1]) / 1024:.0f} ko)')
    if absents:
        print('ABSENTS :', absents)
        sys.exit(1)
