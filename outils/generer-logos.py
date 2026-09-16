#!/usr/bin/env python3
"""Régénère les marques de TabHub et de HarmoHub à partir d'une seule règle de cadrage.

POURQUOI UN GÉNÉRATEUR ET NON DU SVG ÉCRIT À LA MAIN. Les deux marques existent chacune en
quatre ou cinq exemplaires — le SVG en ligne dans index.html, icons/favicon.svg, et les PNG
d'écran d'accueil — et elles doivent rester le MÊME dessin. Tenues à la main, elles divergent :
une version antérieure du favicon de TabHub dessinait cinq cordes là où la barre du haut en
montrait six, à une autre marge. Ici, un seul code les produit toutes, et tests/pwa_test.js
vérifie que le favicon trace exactement les chemins du logo en ligne.

LE CADRAGE COMMUN, ce qui rend les deux icônes harmonieuses (demande utilisateur : « fais en
sorte que la taille des icônes soient harmonieuses entre les 2 applis, et que ça soit bien calé
dans le fond sombre ») : carré de 48, rayon 10, et une boîte d'ENCRE de 32 × 30 centrée sur
(24, 24) — x de 8 à 40, y de 9 à 39. La boîte d'encre est celle que le dessin occupe vraiment
à l'écran, stroke compris : c'est la seule que l'œil voit. Les cordes de TabHub portant un
trait de 2, leurs CENTRES sont rentrés d'un pixel pour que leur encre affleure 9 et 39, comme
les barres de HarmoHub qui, sans trait, vont de 9 à 39 tout court.

CE QUI DISTINGUE LES DEUX MARQUES. Le reproche initial était qu'on allait « confondre les
logiciels avec les logos » : les deux n'étaient que des barres au dégradé d'opacité, à un quart
de tour près. Désormais TabHub porte le mot « TAB » gravé dans quatre cordes d'opacité
UNIFORME, et le dégradé d'opacité reste la signature de HarmoHub seule.

LES LETTRES SONT DES CHEMINS. Un <text> dans un logo se rend avec la police que la machine veut
bien fournir — le dessin change alors d'un poste à l'autre. On extrait donc les contours de T,
A et B de Plus Jakarta Sans ExtraBold, la police des deux applis, exactement comme
outils/generer-glyphes.py extrait les signes musicaux de Bravura.

LE DÉTOURAGE PASSE PAR UN <mask>. Un liseré peint de la couleur du fond n'est juste que sur CE
fond : posée ailleurs (barre du haut à --card-bg, icône à #0a0a0a, impression sur blanc), la
marque montrerait un halo. Le masque, lui, creuse vraiment. Il n'emploie que les contours
EXTÉRIEURS des lettres : avec les contre-formes, une corde traverserait le triangle du A et
les panses du B.

Usage :  python3 outils/generer-logos.py chemin/vers/PlusJakartaSans-ExtraBold.ttf
         (la police se récupère sur fonts.google.com/specimen/Plus+Jakarta+Sans ; elle n'est
          pas versionnée ici, seuls ses contours dérivés le sont, dans le SVG produit)
"""
import sys, os, pathlib
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.areaPen import AreaPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.misc.transform import Transform

# ---- le cadrage commun aux deux applis ---------------------------------
COTE, RAYON, FOND = 48, 10, '#0a0a0a'
ENCRE_X0, ENCRE_X1 = 8, 40        # boîte d'encre : 32 de large
ENCRE_Y0, ENCRE_Y1 = 9, 39        # boîte d'encre : 30 de haut
ACCENT = '#00e676'

# ---- TabHub : « TAB » gravé dans quatre cordes -------------------------
CORDES, EP_CORDE, OPACITE_CORDES = 4, 2, 0.62
CORDE_X0, CORDE_X1 = 9, 39        # centres ; les capuchons ronds portent l'encre à 8 et 40
CORDE_Y0, CORDE_Y1 = 10, 38       # centres de la première et de la dernière
CX_LETTRES = 17.5                 # « lettres à gauche » : voir plus bas
TAILLE_LETTRE = 8.4               # hauteur de CAPITALE, pas corps de police
LISERE = 3                        # épaisseur totale du détourage
HAUTEUR_CAP = 745.0               # OS/2 sCapHeight de Plus Jakarta Sans

INTERLIGNE = (CORDE_Y1 - CORDE_Y0) / (CORDES - 1)      # 9,333
Y_CORDES = [CORDE_Y0 + i * INTERLIGNE for i in range(CORDES)]
# Une lettre par interligne, centrée dedans. La capitale doit rester SOUS l'interligne, sinon
# deux lettres voisines se touchent : à 9,33 d'interligne, 8,4 laisse 0,93 px d'air, et le
# liseré de 3 px vient quand même mordre la corde voisine — c'est lui qui fait l'aspect gravé.
CY_LETTRES = [CORDE_Y0 + (i + 0.5) * INTERLIGNE for i in range(CORDES - 1)]

# ---- HarmoHub : quatre barres, emprise « légère » ----------------------
BARRES, ECART = 4, 2.0
LARGEUR_BARRE = ((ENCRE_X1 - ENCRE_X0) - ECART * (BARRES - 1)) / BARRES   # 6,5
OPACITES_BARRES = [0.25, 0.5, 0.75, 1.0]


# =======================================================================
#  Extraction des lettres
# =======================================================================
def _contours(trace):
    """Découpe un RecordingPen en contours : un par moveTo."""
    lots, courant = [], []
    for nom, args in trace.value:
        if nom == 'moveTo' and courant:
            lots.append(courant)
            courant = []
        courant.append((nom, args))
    if courant:
        lots.append(courant)
    return lots


def _aire(contour):
    pen = AreaPen()
    for nom, args in contour:
        getattr(pen, nom)(*args)
    return pen.value or 0.0


def chemins_lettre(police, lettre, taille_cap, cx, cy):
    """(encre, silhouette) : la lettre complète, puis ses contours EXTÉRIEURS seuls.

    La silhouette sert au masque. Avec les contre-formes, le masque laisserait passer une
    corde à travers le triangle du A et les panses du B."""
    jeu = police.getGlyphSet()
    nom_glyphe = police.getBestCmap()[ord(lettre)]

    brut = RecordingPen()
    jeu[nom_glyphe].draw(brut)

    bp = BoundsPen(jeu)
    jeu[nom_glyphe].draw(bp)
    x_min, _, x_max, _ = bp.bounds
    centre_x = (x_min + x_max) / 2      # centre du DESSIN, pas de la chasse

    s = taille_cap / HAUTEUR_CAP
    # y monte dans une police, descend dans un SVG : on renverse, et on cale le milieu de la
    # bande des capitales sur cy — ainsi les trois lettres s'alignent comme du texte composé.
    t = Transform(s, 0, 0, -s, cx - centre_x * s, cy + (HAUTEUR_CAP / 2) * s)

    def rendre(contours):
        plume = SVGPathPen(None, ntos=lambda v: f'{v:.2f}')
        transfo = TransformPen(plume, t)
        for contour in contours:
            for nom, args in contour:
                getattr(transfo, nom)(*args)
        return plume.getCommands()

    tous = _contours(brut)
    aires = [_aire(c) for c in tous]
    signe = 1 if sum(aires) > 0 else -1     # en TrueType les contre-formes tournent à l'envers
    exterieurs = [c for c, a in zip(tous, aires) if a * signe > 0]
    return rendre(tous), rendre(exterieurs)


# =======================================================================
#  Les deux marques
# =======================================================================
def _ind(texte, n):
    pad = ' ' * n
    return '\n'.join(pad + l if l.strip() else l for l in texte.split('\n'))


def marque_tabhub(police, prefixe, couleur, avec_fond):
    lettres = [chemins_lettre(police, L, TAILLE_LETTRE, CX_LETTRES, cy)
               for L, cy in zip('TAB', CY_LETTRES)]
    id_masque = f'{prefixe}-detourage'
    cordes = '\n'.join(f'<path d="M{CORDE_X0} {y:.4g}H{CORDE_X1}"/>' for y in Y_CORDES)
    silhouettes = '\n'.join(f'<path d="{sil}"/>' for _, sil in lettres)
    encres = '\n'.join(f'<path d="{enc}"/>' for enc, _ in lettres)
    fond = (f'<rect width="{COTE}" height="{COTE}" rx="{RAYON}" fill="{FOND}"/>\n'
            if avec_fond else '')
    return f'''{fond}<defs>
  <mask id="{id_masque}" maskUnits="userSpaceOnUse" x="0" y="0" width="{COTE}" height="{COTE}">
    <rect width="{COTE}" height="{COTE}" fill="#fff"/>
    <g fill="#000" stroke="#000" stroke-width="{LISERE}" stroke-linejoin="round" stroke-linecap="round">
{_ind(silhouettes, 6)}
    </g>
  </mask>
</defs>
<g mask="url(#{id_masque})" stroke="{couleur}" stroke-width="{EP_CORDE}" stroke-linecap="round" opacity="{OPACITE_CORDES}">
{_ind(cordes, 2)}
</g>
<g fill="{couleur}">
{_ind(encres, 2)}
</g>'''


def marque_harmohub(couleur, avec_fond):
    barres = []
    for i, op in enumerate(OPACITES_BARRES):
        x = ENCRE_X0 + i * (LARGEUR_BARRE + ECART)
        barres.append(f'<rect x="{x:.4g}" y="{ENCRE_Y0}" width="{LARGEUR_BARRE:.4g}" '
                      f'height="{ENCRE_Y1 - ENCRE_Y0}" rx="{LARGEUR_BARRE * 0.4:.4g}" '
                      f'opacity="{op}"/>')
    fond = (f'<rect width="{COTE}" height="{COTE}" rx="{RAYON}" fill="{FOND}"/>\n'
            if avec_fond else '')
    return fond + f'<g fill="{couleur}">\n' + _ind('\n'.join(barres), 2) + '\n</g>'


def fichier_svg(corps, entete=''):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {COTE} {COTE}"'
            f' width="{COTE}" height="{COTE}">\n'
            + (entete + '\n' if entete else '')
            + _ind(corps, 2) + '\n</svg>\n')


if __name__ == '__main__':
    if len(sys.argv) != 2 or not os.path.exists(sys.argv[1]):
        print(__doc__)
        sys.exit(1)
    police = TTFont(sys.argv[1])
    racine = pathlib.Path(__file__).resolve().parent.parent

    entete = """  <!-- ENGENDRÉ PAR outils/generer-logos.py — ne pas retoucher à la main : le même
       dessin existe en ligne dans index.html (.logo-marque), et tests/pwa_test.js vérifie que
       les deux tracent exactement les mêmes chemins. Le générateur explique le pourquoi de
       chaque choix : cadrage commun aux deux applis, lettres en chemins, détourage par masque.

       Seule différence avec la version en ligne : le fond arrondi et le vert plein au lieu de
       currentColor. Cette icône-ci doit rester lisible hors de tout contexte CSS — onglet de
       navigateur, écran d'accueil d'un téléphone. -->"""
    cible = racine / 'icons' / 'favicon.svg'
    cible.write_text(fichier_svg(marque_tabhub(police, 'th', ACCENT, True), entete))
    print('écrit :', cible)

    print('\nÀ reporter à la main dans index.html (.logo-marque), en currentColor :')
    print(_ind(marque_tabhub(police, 'logo-th', 'currentColor', False), 4))
