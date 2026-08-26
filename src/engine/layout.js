// Moteur de mise en page : partition (modèle) → LISTE D'AFFICHAGE (primitives géométriques).
//
// L'IDÉE CENTRALE : CE MODULE NE DESSINE RIEN. Il produit une liste de primitives neutres — lignes,
// chemins, textes, polygones — exprimées en coordonnées de page. Deux moteurs de rendu la consomment
// ensuite : le SVG pour l'écran (render/svg.js) et jsPDF pour l'export (render/pdf.js).
//
// C'est ce qui garantit que LE PDF EST EXACTEMENT CE QU'ON VOIT. L'approche courante — rastériser
// l'écran avec html2canvas, comme le fait HarmoHub pour sa grille d'accords — convenait à une grille
// d'accords faite de blocs et de texte ; elle donnerait ici une partition floue et un fichier lourd,
// alors qu'une partition est par nature du trait fin. En passant par une liste d'affichage, le PDF
// sort en VECTORIEL, net à n'importe quel zoom, et sans qu'aucune règle de mise en page n'ait à être
// écrite deux fois — la seule façon fiable d'éviter que les deux sorties divergent avec le temps.
//
// La liste s'accompagne d'ANCRAGES : où se trouve chaque évènement et chaque mesure à l'écran. Ils
// servent au curseur d'édition, au clic pour se positionner, et à la tête de lecture. Ce sont les
// mêmes données que celles qui ont servi à poser les notes, donc le curseur ne peut pas se décaler
// de ce qui est dessiné.

import * as G from './glyphs.js';
import { dureeEnNoires, crochetsDe, uniteDeGroupement } from '../model/duration.js';
import {
    signatureEffective, armureEffective, positionDansMesure, hauteurDeNote, nbCordes,
} from '../model/score.js';
import { ecrireHauteur, alterationsDeLArmure, NOMS_LETTRES } from '../model/theory.js';
import { INSTRUMENTS } from '../model/instruments.js';

// ---------------------------------------------------------------------------------------------
// Géométrie de référence, en interlignes de portée (`S`). Tout le reste en découle : changer `S`
// change l'échelle de la partition entière sans toucher à une seule autre valeur.
// ---------------------------------------------------------------------------------------------

export const GEO_DEFAUT = {
    S: 8,                       // interligne de la portée solfège, en px
    ratioTab: 1.42,             // interligne de la TAB, en multiples de S — plus large : il doit
                                // loger deux chiffres sans qu'ils touchent la ligne voisine
    ecartPorteeTab: 4.6,        // du bas de la portée au haut de la TAB, en S
    margeHaut: 4.2,             // au-dessus de la portée : numéros de mesure, lignes supplémentaires
    margeBas: 3.4,              // sous la TAB : P.M., doigtés
    ecartSystemes: 3.2,         // entre deux systèmes, en S
    margeGauche: 34,            // px — accolade + « TAB » vertical y logent
    margeDroite: 22,
    largeurPage: 1100,
    tailleChiffreTab: 1.42,     // hauteur du chiffre de frette, en S
};

/**
 * Descripteurs de clé. `pasRef` est la position diatonique absolue de la note portée par la ligne de
 * référence de la clé — sol4 pour la clé de sol, fa3 pour la clé de fa. Tout le placement vertical
 * d'une note en découle par une simple soustraction, sans table de correspondance.
 *
 * `transposition` traduit le fait que guitare et basse SONNENT une octave sous ce qui est écrit :
 * on écrit la hauteur MIDI + 12, on joue la hauteur MIDI. Séparer les deux est indispensable — sans
 * ça, une partition de basse se retrouverait sous six lignes supplémentaires.
 */
export const CLEFS = {
    sol: { glyphe: G.CLE_SOL, ligne: 3, pasRef: 32, transposition: 0, marqueOctave: 0 },
    sol8vb: { glyphe: G.CLE_SOL, ligne: 3, pasRef: 32, transposition: 12, marqueOctave: 1 },
    fa: { glyphe: G.CLE_FA, ligne: 1, pasRef: 24, transposition: 0, marqueOctave: 0 },
    fa8vb: { glyphe: G.CLE_FA, ligne: 1, pasRef: 24, transposition: 12, marqueOctave: 1 },
};

// Positions diatoniques des altérations à l'armure, en clé de sol. La clé de fa reprend le MÊME
// dessin deux octaves plus bas (−14 pas) : c'est exactement la règle de gravure, et l'écrire ainsi
// évite une seconde table qui pourrait diverger de la première.
const ARMURE_DIESES_SOL = [38, 35, 39, 36, 33, 37, 34];
const ARMURE_BEMOLS_SOL = [34, 37, 33, 36, 32, 35, 31];

function positionsArmure(armure, clef) {
    const decalage = clef.pasRef === 24 ? -14 : 0;
    const base = armure > 0 ? ARMURE_DIESES_SOL : ARMURE_BEMOLS_SOL;
    return base.slice(0, Math.abs(armure)).map(p => p + decalage);
}

// ---------------------------------------------------------------------------------------------
// Fabriques de primitives. Une seule forme par type, produite ici et nulle part ailleurs.
// ---------------------------------------------------------------------------------------------

const ligne = (x1, y1, x2, y2, ep, couleur = 'encre') => ({ t: 'ligne', x1, y1, x2, y2, ep, couleur });
const rect = (x, y, w, h, couleur = 'encre') => ({ t: 'rect', x, y, w, h, couleur });
const poly = (pts, couleur = 'encre') => ({ t: 'poly', pts, couleur });
const texte = (x, y, s, o = {}) => ({
    t: 'texte', x, y, s,
    taille: o.taille ?? 10, police: o.police ?? 'serif', poids: o.poids ?? 'normal',
    italique: !!o.italique, ancre: o.ancre ?? 'milieu', couleur: o.couleur ?? 'encre',
});
/** Pose un glyphe (liste de traits) à l'échelle voulue. L'échelle est TOUJOURS l'interligne courant. */
const glyphe = (traits, x, y, echelle, couleur = 'encre') => ({ t: 'glyphe', traits, x, y, echelle, couleur });
const courbe = (d, ep, couleur = 'encre') => ({ t: 'courbe', d, ep, couleur });

/**
 * Arc de liaison entre deux points. `sens` = -1 pour un arc bombé vers le haut, +1 vers le bas :
 * une liaison se place toujours du côté opposé aux hampes, sans quoi elle les coupe.
 */
function arcLiaison(x1, y1, x2, y2, sens, hauteur) {
    const dx = x2 - x1;
    const fleche = sens * Math.max(hauteur, Math.min(dx * 0.22, hauteur * 2.2));
    const cx1 = x1 + dx * 0.25, cx2 = x1 + dx * 0.75;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} C ${cx1.toFixed(2)} ${(y1 + fleche).toFixed(2)} ${cx2.toFixed(2)} ${(y2 + fleche).toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

// ---------------------------------------------------------------------------------------------
// Mesurage : combien de place demande chaque évènement, chaque mesure.
// ---------------------------------------------------------------------------------------------

/**
 * Largeur demandée par un évènement.
 *
 * Deux exigences se disputent la place, et l'espacement retenu est le MAXIMUM des deux :
 *   • PROPORTIONNELLE À LA DURÉE, mais compressée par une puissance ~0,6. La proportionnalité pure
 *     (une blanche = deux fois une noire) donne des partitions au rythme visuel absurde : quatre
 *     doubles-croches y tiennent dans le quart d'une noire, illisibles, tandis qu'une ronde ouvre un
 *     désert. La compression est la convention de gravure ; l'œil lit la DURÉE RELATIVE sans que les
 *     brèves ne s'écrasent.
 *   • UN PLANCHER matériel : la place qu'occupent réellement les altérations et les chiffres à deux
 *     chiffres de la tablature. Sans lui, « 12 » déborderait sur la note suivante.
 */
function largeurEvenement(evenement, S, geo) {
    const d = Math.max(dureeEnNoires(evenement.duree), 1 / 64);
    const proportionnelle = 3.9 * S * Math.pow(d, 0.62);

    let plancher = 3.2 * S;
    if (evenement.notes.some(n => n.frette >= 10)) plancher += 0.7 * S;
    if (evenement.duree.points > 0) plancher += 0.5 * S;
    return Math.max(proportionnelle, plancher);
}

/** Largeur de l'en-tête d'une mesure : clé, armure, signature — seulement ce qui doit y figurer. */
function largeurEnTete(besoins, armure, S) {
    let w = 0;
    if (besoins.clef) w += 3.4 * S;
    if (besoins.armure && armure !== 0) w += Math.abs(armure) * 1.05 * S + 0.6 * S;
    if (besoins.signature) w += 2.6 * S;
    if (besoins.repriseDebut) w += 1.6 * S;
    return w;
}

// ---------------------------------------------------------------------------------------------
// Altérations accidentelles : mémoire à l'échelle de la mesure
// ---------------------------------------------------------------------------------------------

/**
 * Une altération accidentelle vaut jusqu'à la fin de la MESURE, pour toutes les notes de même nom et
 * même octave. C'est une règle de notation vieille de trois siècles, et l'ignorer produit des
 * partitions bruyantes : un riff chromatique répétant la même note afficherait un dièse devant
 * chacune de ses occurrences. Cet objet retient, mesure par mesure, ce qui a déjà été annoncé.
 */
function memoireAlterations(armure) {
    const parArmure = alterationsDeLArmure(armure);
    // L'armure voyage AVEC la mémoire : l'orthographe d'une note (fa♯ ou sol♭) et la décision de
    // dessiner ou non l'altération sont deux facettes de la même règle, et les séparer en deux
    // paramètres invitait à en oublier un — ce qui donnait des partitions orthographiées en do majeur
    // quelle que soit l'armure réelle.
    const annoncees = new Map();   // pas → altération en vigueur
    return {
        armure,
        /** Faut-il dessiner une altération devant cette note ? Met la mémoire à jour au passage. */
        besoin(ecriture) {
            const enVigueur = annoncees.has(ecriture.pas)
                ? annoncees.get(ecriture.pas)
                : (parArmure[ecriture.lettre] || 0);
            if (ecriture.alteration === enVigueur) return null;
            annoncees.set(ecriture.pas, ecriture.alteration);
            return ecriture.alteration;
        },
    };
}

// ---------------------------------------------------------------------------------------------
// Mise en page principale
// ---------------------------------------------------------------------------------------------

/**
 * @param {object} partition
 * @param {object} options  { S, largeurPage, avecEnTete, couleurs… }
 * @returns {{largeur, hauteur, primitives, ancrages}}
 */
export function mettreEnPage(partition, options = {}) {
    const geo = { ...GEO_DEFAUT, ...options };
    const S = geo.S;
    const ST = S * geo.ratioTab;                        // interligne de la tablature
    const cordes = nbCordes(partition);
    const clef = CLEFS[INSTRUMENTS[partition.piste.instrument]?.clef || 'sol8vb'];

    const hauteurPortee = 4 * S;
    const hauteurTab = (cordes - 1) * ST;
    const hauteurSysteme = geo.margeHaut * S + hauteurPortee + geo.ecartPorteeTab * S + hauteurTab + geo.margeBas * S;
    const largeurUtile = geo.largeurPage - geo.margeGauche - geo.margeDroite;

    // --- 1. Mesurer chaque mesure isolément -----------------------------------------------------
    const mesures = partition.mesures.map((mesure, i) => {
        const sig = signatureEffective(partition, i);
        const arm = armureEffective(partition, i);
        const evenements = mesure.evenements.map(e => ({ ref: e, largeur: largeurEvenement(e, S, geo) }));
        const largeurNotes = evenements.reduce((t, e) => t + e.largeur, 0);
        return {
            index: i, ref: mesure, signature: sig, armure: arm, evenements,
            largeurNotes,
            // Une signature ou une armure ne se redessine que si la mesure la CHANGE (champ non nul) —
            // c'est précisément l'information que porte le `null` du modèle.
            changeSignature: !!mesure.signature,
            changeArmure: mesure.armure !== null && mesure.armure !== undefined,
        };
    });

    // --- 2. Découper en systèmes ----------------------------------------------------------------
    // Glouton : on remplit tant que ça rentre. Une mesure seule qui déborde reste seule sur sa ligne
    // plutôt que d'être coupée — une mesure coupée en deux n'a aucun sens musical.
    const systemes = [];
    let courant = null;
    for (const m of mesures) {
        const premiereDuSysteme = !courant || courant.mesures.length === 0;
        const besoins = {
            clef: premiereDuSysteme,
            armure: premiereDuSysteme || m.changeArmure,
            signature: premiereDuSysteme || m.changeSignature,
            repriseDebut: m.ref.repriseDebut,
        };
        const enTete = largeurEnTete(besoins, m.armure, S);
        const largeurTotale = enTete + m.largeurNotes + 1.4 * S;   // marge avant la barre de mesure

        if (!courant) courant = { mesures: [], largeur: 0 };
        else if (courant.largeur + largeurTotale > largeurUtile && courant.mesures.length > 0) {
            systemes.push(courant);
            courant = { mesures: [], largeur: 0 };
            // Nouveau système : la clé et l'armure se redessinent, donc la mesure est remesurée.
            const b2 = { clef: true, armure: true, signature: m.changeSignature || systemes.length === 0, repriseDebut: m.ref.repriseDebut };
            const e2 = largeurEnTete(b2, m.armure, S);
            m.besoins = b2; m.enTete = e2; m.largeurTotale = e2 + m.largeurNotes + 1.4 * S;
            courant.mesures.push(m); courant.largeur += m.largeurTotale;
            continue;
        }
        m.besoins = besoins; m.enTete = enTete; m.largeurTotale = largeurTotale;
        courant.mesures.push(m); courant.largeur += largeurTotale;
    }
    if (courant && courant.mesures.length) systemes.push(courant);

    // Un nouveau système impose de redessiner clé/armure/signature en tête de sa PREMIÈRE mesure.
    // Le découpage glouton ci-dessus l'a fait pour les ruptures qu'il a provoquées ; reste le cas de
    // la toute première mesure de chaque système restant.
    systemes.forEach(sys => {
        const m = sys.mesures[0];
        if (!m.besoins.clef) {
            m.besoins = { ...m.besoins, clef: true, armure: true, signature: true };
            m.enTete = largeurEnTete(m.besoins, m.armure, S);
            m.largeurTotale = m.enTete + m.largeurNotes + 1.4 * S;
            sys.largeur = sys.mesures.reduce((t, x) => t + x.largeurTotale, 0);
        }
    });

    // --- 3. Justifier ---------------------------------------------------------------------------
    // Chaque système est étiré pour occuper toute la largeur, comme sur une partition gravée. Le
    // DERNIER échappe à la règle s'il faudrait l'étirer de plus de moitié : une mesure isolée tirée
    // sur toute la page donne des notes perdues à trois centimètres l'une de l'autre.
    systemes.forEach((sys, i) => {
        const facteur = largeurUtile / sys.largeur;
        const dernier = i === systemes.length - 1;
        sys.facteur = (dernier && facteur > 1.5) ? 1 : facteur;
    });

    // --- 4. Poser ------------------------------------------------------------------------------
    const primitives = [];
    const ancrages = { evenements: [], mesures: [], systemes: [] };
    let y = geo.yDepart ?? 0;
    if (geo.avecEnTete !== false) y = poserEnTete(primitives, partition, geo, y);

    systemes.forEach((sys, iSys) => {
        const yPortee = y + geo.margeHaut * S;
        const yTab = yPortee + hauteurPortee + geo.ecartPorteeTab * S;
        const xDebut = geo.margeGauche;
        const xFin = geo.largeurPage - geo.margeDroite;

        poserLignesSysteme(primitives, xDebut, xFin, yPortee, yTab, S, ST, cordes);
        poserAccolade(primitives, xDebut, yPortee, yTab + hauteurTab, S);
        poserMotTab(primitives, xDebut, yTab, ST, cordes);

        let x = xDebut;
        sys.mesures.forEach((m, iDansSys) => {
            const largeurMesure = m.largeurTotale * sys.facteur;
            const finMesure = x + largeurMesure;
            x = poserMesure(primitives, ancrages, partition, m, {
                x, largeurMesure, facteur: sys.facteur, finMesure,
                yPortee, yTab, S, ST, cordes, clef, geo, iSys,
                premiereDuSysteme: iDansSys === 0,
            });
        });

        ancrages.systemes.push({ index: iSys, y, hauteur: hauteurSysteme, yPortee, yTab, xDebut, xFin, hauteurTab });
        y += hauteurSysteme + geo.ecartSystemes * S;
    });

    return {
        largeur: geo.largeurPage,
        hauteur: Math.max(y - geo.ecartSystemes * S, hauteurSysteme),
        primitives, ancrages,
        geo: { ...geo, S, ST, cordes, hauteurPortee, hauteurTab, hauteurSysteme, clef },
    };
}

// ---------------------------------------------------------------------------------------------
// En-tête du morceau
// ---------------------------------------------------------------------------------------------

/**
 * Titre, sous-titre, artiste centrés, puis l'indication de tempo à gauche.
 *
 * Les trois lignes de titre sont facultatives et le bloc se resserre quand elles manquent : une
 * partition sans artiste ne doit pas garder un blanc à sa place. Renvoie l'ordonnée où le premier
 * système peut commencer.
 */
function poserEnTete(out, partition, geo, y) {
    const S = geo.S;
    const centre = geo.largeurPage / 2;
    const meta = partition.meta || {};
    let yy = y + S * 2.6;

    if (meta.titre) {
        out.push(texte(centre, yy + S * 2.1, meta.titre, { taille: S * 3.1, police: 'serif', poids: '700' }));
        yy += S * 3.6;
    }
    if (meta.sousTitre) {
        out.push(texte(centre, yy + S * 1.1, meta.sousTitre, { taille: S * 1.6, police: 'serif', poids: '500' }));
        yy += S * 2.1;
    }
    if (meta.artiste) {
        out.push(texte(centre, yy + S * 1.15, meta.artiste, { taille: S * 1.75, police: 'serif', poids: '700' }));
        yy += S * 2.3;
    }

    // Indication de tempo : la FIGURE de note plutôt que le mot « noire ». C'est la notation
    // universelle, lisible sans traduction, et elle dit du même coup quelle figure vaut le battement.
    if (meta.tempo) {
        // ATTENTION À L'ÉCHELLE : l'argument d'échelle d'un glyphe est déjà une TAILLE D'INTERLIGNE en
        // pixels, pas un facteur. Une première version y passait `S * 0.62 * 1.6`, donc un interligne
        // huit fois trop grand — la noire du tempo sortait plus haute que le titre.
        const ech = S * 1.0;                  // la figure du tempo, à la taille d'une note de portée
        const xt = geo.margeGauche + S * 0.7;
        const yt = yy + S * 2.4;
        out.push(glyphe(G.TETE_NOIRE, xt, yt, ech));
        out.push(ligne(xt + 0.62 * ech, yt, xt + 0.62 * ech, yt - 3.4 * ech, G.EPAISSEURS.hampe * ech));
        out.push(texte(xt + S * 1.5, yt + S * 0.3, `= ${Math.round(meta.tempo)}`, {
            taille: S * 1.7, police: 'serif', poids: '700', ancre: 'debut',
        }));
        yy += S * 3.2;
    }
    return yy + S * 0.4;
}

// ---------------------------------------------------------------------------------------------
// Éléments de système
// ---------------------------------------------------------------------------------------------

function poserLignesSysteme(out, x1, x2, yPortee, yTab, S, ST, cordes) {
    for (let i = 0; i < 5; i++) out.push(ligne(x1, yPortee + i * S, x2, yPortee + i * S, G.EPAISSEURS.ligneePortee * S));
    for (let i = 0; i < cordes; i++) out.push(ligne(x1, yTab + i * ST, x2, yTab + i * ST, G.EPAISSEURS.ligneePortee * S));
}

/** Accolade droite reliant portée et tablature : elle dit qu'on lit les deux ENSEMBLE. */
function poserAccolade(out, x, yHaut, yBas, S) {
    const e = 0.42 * S, d = 0.55 * S;
    out.push(rect(x - d - e, yHaut, e, yBas - yHaut));
    out.push(rect(x - d - e, yHaut, d + e, 0.36 * S));
    out.push(rect(x - d - e, yBas - 0.36 * S, d + e, 0.36 * S));
    out.push(ligne(x, yHaut, x, yBas, G.EPAISSEURS.barreMesure * S));
}

/** « TAB » écrit verticalement à gauche de la tablature, comme sur toute tablature gravée. */
function poserMotTab(out, x, yTab, ST, cordes) {
    const hauteur = (cordes - 1) * ST;
    const taille = Math.min(ST * 0.95, hauteur / 3.4);
    'TAB'.split('').forEach((lettre, i) => {
        out.push(texte(x + 1.15 * taille, yTab + hauteur / 2 + (i - 1) * taille * 1.06 + taille * 0.36, lettre, {
            taille, police: 'serif', poids: '700', ancre: 'milieu',
        }));
    });
}

// ---------------------------------------------------------------------------------------------
// Une mesure
// ---------------------------------------------------------------------------------------------

function poserMesure(out, ancrages, partition, m, ctx) {
    const { yPortee, yTab, S, ST, cordes, clef, geo, facteur } = ctx;
    const hauteurTab = (cordes - 1) * ST;
    let x = ctx.x;
    const xDebutMesure = x;

    // Barre de reprise ouvrante — épaisse puis fine, puis les deux points.
    if (m.ref.repriseDebut) {
        out.push(rect(x, yPortee, G.EPAISSEURS.barreEpaisse * S, 4 * S));
        out.push(rect(x, yTab, G.EPAISSEURS.barreEpaisse * S, hauteurTab));
        const xf = x + G.EPAISSEURS.barreEpaisse * S + 0.32 * S;
        out.push(ligne(xf, yPortee, xf, yPortee + 4 * S, G.EPAISSEURS.barreMesure * S));
        out.push(ligne(xf, yTab, xf, yTab + hauteurTab, G.EPAISSEURS.barreMesure * S));
        const xp = xf + 0.55 * S;
        out.push(glyphe(G.POINT, xp, yPortee + 1.5 * S, S));
        out.push(glyphe(G.POINT, xp, yPortee + 2.5 * S, S));
        x = xp + 0.9 * S;
    }

    // Clé
    if (m.besoins.clef) {
        const yLigne = yPortee + clef.ligne * S;
        out.push(glyphe(clef.glyphe, x + 1.5 * S, yLigne, S));
        if (clef.marqueOctave) {
            out.push(texte(x + 1.5 * S, yPortee + 4 * S + G.OCTAVE_BASSE_Y * S * 0.5, '8', { taille: S * 1.15, police: 'serif', poids: '600' }));
        }
        x += 3.4 * S;
    }

    // Armure
    if (m.besoins.armure && m.armure !== 0) {
        const glypheAlt = m.armure > 0 ? G.ALTERATIONS['1'] : G.ALTERATIONS['-1'];
        positionsArmure(m.armure, clef).forEach(pas => {
            out.push(glyphe(glypheAlt, x + 0.5 * S, yDeLaPosition(pas, yPortee, S, clef), S));
            x += 1.05 * S;
        });
        x += 0.6 * S;
    }

    // Signature rythmique : deux chiffres empilés, centrés sur les 2e et 4e interlignes.
    if (m.besoins.signature) {
        const taille = S * 2.35;
        out.push(texte(x + 1.15 * S, yPortee + 2 * S - 0.06 * S, String(m.signature.battements), { taille, police: 'serif', poids: '700' }));
        out.push(texte(x + 1.15 * S, yPortee + 4 * S - 0.06 * S, String(m.signature.unite), { taille, police: 'serif', poids: '700' }));
        x += 2.6 * S;
    }

    // Numéro de mesure, au-dessus de la portée, à l'aplomb du début de la mesure.
    out.push(texte(x + 0.2 * S, yPortee - 1.6 * S, String(m.index + 1), {
        taille: S * 1.05, police: 'sans-serif', poids: '600', ancre: 'debut', couleur: 'discret',
    }));

    // --- Les évènements, EN TROIS PASSES --------------------------------------------------------
    // L'ordre compte, et une première version l'avait manqué : elle dessinait la hampe de chaque note
    // au moment de poser sa tête, PUIS décidait des ligatures — qui imposent au groupe entier un sens
    // commun. Les notes dont le sens changeait se retrouvaient avec DEUX hampes, l'une vers le haut
    // héritée de la première passe, l'autre vers le bas rejoignant la ligature. Le sens d'une hampe
    // n'est pas une propriété de la note : c'est une décision du GROUPE, et elle doit donc être prise
    // avant qu'aucune hampe ne soit tracée.
    //   1. les têtes, altérations, lignes supplémentaires, et toute la tablature ;
    //   2. les groupes de ligature et le sens de hampe commun à chacun ;
    //   3. les hampes, crochets, ligatures et n-olets.
    const memoire = memoireAlterations(m.armure);
    const poses = [];
    for (const e of m.evenements) {
        const largeur = e.largeur * facteur;
        const xNote = x + largeur * 0.42;
        poses.push(poserEvenement(out, partition, e.ref, {
            x: xNote, xDebut: x, largeur, yPortee, yTab, S, ST, cordes, clef, memoire, geo,
        }));
        ancrages.evenements.push({
            mesure: m.index, evenement: m.evenements.indexOf(e), ref: e.ref,
            x: xNote, xDebut: x, xFin: x + largeur, yPortee, yTab, hauteurTab,
        });
        x += largeur;
    }

    const groupes = grouperLigatures(poses, m.signature);
    poserHampes(out, poses, groupes, S);
    poserNolets(out, poses, S);
    poserLiaisons(out, poses, S, ST);

    // Barre de fin de mesure
    const xBarre = ctx.finMesure;
    if (m.ref.repriseFin) {
        const xp = xBarre - 1.5 * S;
        out.push(glyphe(G.POINT, xp, yPortee + 1.5 * S, S));
        out.push(glyphe(G.POINT, xp, yPortee + 2.5 * S, S));
        const xf = xBarre - 0.75 * S;
        out.push(ligne(xf, yPortee, xf, yPortee + 4 * S, G.EPAISSEURS.barreMesure * S));
        out.push(ligne(xf, yTab, xf, yTab + hauteurTab, G.EPAISSEURS.barreMesure * S));
        out.push(rect(xBarre - G.EPAISSEURS.barreEpaisse * S - 0.1 * S, yPortee, G.EPAISSEURS.barreEpaisse * S, 4 * S));
        out.push(rect(xBarre - G.EPAISSEURS.barreEpaisse * S - 0.1 * S, yTab, G.EPAISSEURS.barreEpaisse * S, hauteurTab));
    } else {
        out.push(ligne(xBarre, yPortee, xBarre, yPortee + 4 * S, G.EPAISSEURS.barreMesure * S));
        out.push(ligne(xBarre, yTab, xBarre, yTab + hauteurTab, G.EPAISSEURS.barreMesure * S));
    }

    ancrages.mesures.push({
        index: m.index, x: xDebutMesure, xFin: xBarre, yPortee, yTab, hauteurTab, systeme: ctx.iSys,
    });
    return xBarre;
}

/** Ordonnée d'une position diatonique sur la portée. Une position = un demi-interligne. */
function yDeLaPosition(pas, yPortee, S, clef) {
    return yPortee + clef.ligne * S - (pas - clef.pasRef) * (S / 2);
}

// ---------------------------------------------------------------------------------------------
// Un évènement : les chiffres de la tablature, et leur reflet sur la portée
// ---------------------------------------------------------------------------------------------

function poserEvenement(out, partition, evenement, ctx) {
    const { x, yPortee, yTab, S, ST, cordes, clef, memoire, geo } = ctx;
    const crochets = crochetsDe(evenement.duree.valeur);
    const estSilence = evenement.silence || evenement.notes.length === 0;

    const pose = {
        ref: evenement, x, crochets, estSilence,
        notes: [], yHampe: null, sensHampe: 1, yTeteExtreme: null,
    };

    if (estSilence) {
        out.push(glyphe(G.SILENCES[evenement.duree.valeur] || G.SILENCES[4], x, yPortee + 2 * S, S));
        if (evenement.duree.points) {
            for (let i = 0; i < evenement.duree.points; i++) out.push(glyphe(G.POINT, x + (1.0 + i * 0.45) * S, yPortee + 1.5 * S, S));
        }
        return pose;
    }

    // --- Tablature : le chiffre de case, posé SUR sa ligne, qu'il interrompt ---------------------
    const tailleChiffre = geo.tailleChiffreTab * S;
    for (const note of evenement.notes) {
        const yLigne = yTab + note.corde * ST;
        const libelle = note.ghost ? 'x' : String(note.frette);
        // Le masque : la ligne de corde s'arrête de part et d'autre du chiffre. C'est ce qui rend une
        // tablature lisible — un « 0 » barré d'un trait horizontal se lit comme un « ø ».
        const demiLargeur = tailleChiffre * (0.32 + 0.19 * libelle.length);
        out.push(rect(x - demiLargeur, yLigne - tailleChiffre * 0.5, demiLargeur * 2, tailleChiffre, 'papier'));
        out.push(texte(x, yLigne + tailleChiffre * 0.35, libelle, {
            taille: tailleChiffre, police: 'sans-serif', poids: '600', ancre: 'milieu',
        }));
        if (note.bend) {
            out.push(texte(x + 0.9 * S, yLigne - tailleChiffre * 0.75, note.bend.demiTons >= 2 ? 'full' : '½', {
                taille: S * 0.95, police: 'sans-serif', poids: '600', ancre: 'debut', couleur: 'discret',
            }));
        }
        pose.notes.push({ note, yTab: ligneTab(note, yTab, ST), demiLargeurTab: demiLargeur });
    }

    // --- Portée : les mêmes notes, converties en hauteurs puis en positions ----------------------
    const ecritures = [];
    for (const note of evenement.notes) {
        const midi = hauteurDeNote(partition, note);
        if (midi == null) continue;
        const e = ecrireHauteur(midi + clef.transposition, memoire.armure);
        ecritures.push({ note, midi, ecriture: e, y: yDeLaPosition(e.pas, yPortee, S, clef) });
    }
    if (!ecritures.length) return pose;

    ecritures.sort((a, b) => a.ecriture.pas - b.ecriture.pas);
    // SENS DE HAMPE : c'est la note la plus ÉLOIGNÉE de la ligne médiane qui décide, pas la moyenne
    // des hauteurs. La règle de gravure vise à garder la hampe dans la portée : sur un accord large,
    // la moyenne se laisse tirer par les notes du milieu et sort la hampe du mauvais côté, alors que
    // l'extrême, elle, dit exactement de quel côté il y a de la place. Égalité → hampe vers le bas.
    const pasMedian = clef.pasRef + (clef.ligne - 2) * 2;
    const ecartHaut = ecritures[ecritures.length - 1].ecriture.pas - pasMedian;
    const ecartBas = pasMedian - ecritures[0].ecriture.pas;
    pose.sensHampe = ecartHaut >= ecartBas ? 1 : -1;
    pose.pasMedian = pasMedian;

    const teteGlyphe = evenement.duree.valeur === 1 ? G.TETE_RONDE
        : evenement.duree.valeur === 2 ? G.TETE_BLANCHE : G.TETE_NOIRE;

    let yMin = Infinity, yMax = -Infinity;
    for (const e of ecritures) {
        // Lignes supplémentaires : au-dessus et en dessous de la portée, de demi-interligne en
        // demi-interligne, seulement sur les LIGNES (positions paires depuis la référence).
        poserLignesSupplementaires(out, x, e.y, yPortee, S);

        const alt = memoire.besoin(e.ecriture);
        if (alt !== null) {
            out.push(glyphe(G.ALTERATIONS[String(alt)], x - (G.LARGEUR_ALTERATION[String(alt)] + 0.35) * S, e.y, S));
        }
        out.push(glyphe(e.note.ghost ? G.TETE_CROIX : teteGlyphe, x, e.y, S));
        if (evenement.duree.points) {
            // Un point posé sur une LIGNE se décale d'un demi-interligne vers le haut : sinon il
            // disparaît dans le trait.
            const surLigne = Math.round((e.y - yPortee) / (S / 2)) % 2 === 0;
            for (let i = 0; i < evenement.duree.points; i++) {
                out.push(glyphe(G.POINT, x + (0.95 + i * 0.42) * S, e.y - (surLigne ? S / 2 : 0), S));
            }
        }
        yMin = Math.min(yMin, e.y); yMax = Math.max(yMax, e.y);
        pose.notes.find(n => n.note === e.note).yPortee = e.y;
    }

    pose.yHaut = yMin; pose.yBas = yMax;
    pose.teteGlyphe = teteGlyphe;
    return pose;
}

function ligneTab(note, yTab, ST) {
    return yTab + note.corde * ST;
}

function poserLignesSupplementaires(out, x, y, yPortee, S) {
    const ep = G.EPAISSEURS.ligneSupplementaire * S;
    const larg = 0.95 * S;
    if (y < yPortee - 0.1) {
        for (let yy = yPortee - S; yy >= y - 0.1; yy -= S) out.push(ligne(x - larg, yy, x + larg, yy, ep));
    } else if (y > yPortee + 4 * S + 0.1) {
        for (let yy = yPortee + 5 * S; yy <= y + 0.1; yy += S) out.push(ligne(x - larg, yy, x + larg, yy, ep));
    }
}

// ---------------------------------------------------------------------------------------------
// Hampes, crochets, ligatures et n-olets — la passe qui suit les têtes de note
// ---------------------------------------------------------------------------------------------

const LONGUEUR_HAMPE = 3.4;   // en interlignes, longueur nominale d'une hampe

/**
 * Répartit les évènements en groupes de ligature.
 *
 * Le découpage suit l'UNITÉ DE TEMPS de la mesure (voir duration.uniteDeGroupement) : c'est ce qui
 * fait qu'une mesure à 6/8 se lit en deux groupes de trois croches et non en trois paires — donc
 * qu'elle ne se confond pas avec du 3/4. Une ligature n'est pas une décoration : c'est ce qui donne
 * la pulsation à voir, sans avoir à compter.
 *
 * Un silence ou une note d'au moins une noire ferme le groupe en cours : on ne ligature pas
 * par-dessus un silence.
 */
export function grouperLigatures(poses, signature) {
    const unite = uniteDeGroupement(signature);
    const groupes = [];
    let courant = [];
    let t = 0;
    for (const p of poses) {
        const d = dureeEnNoires(p.ref.duree);
        const numeroTemps = Math.floor(t / unite + 1e-9);
        const ligaturable = p.crochets > 0 && !p.estSilence;
        if (!ligaturable || (courant.length && courant[0].temps !== numeroTemps)) {
            if (courant.length > 1) groupes.push(courant.map(x => x.p));
            courant = [];
        }
        if (ligaturable) courant.push({ p, temps: numeroTemps });
        t += d;
    }
    if (courant.length > 1) groupes.push(courant.map(x => x.p));
    return groupes;
}

/** Ordonnée du bout d'une hampe isolée, du côté `sens`. */
function boutDeHampe(p, sens, S) {
    return sens < 0 ? p.yHaut - LONGUEUR_HAMPE * S : p.yBas + LONGUEUR_HAMPE * S;
}

/**
 * Trace toutes les hampes : celles des notes isolées (avec leur crochet), puis celles des groupes
 * ligaturés (qui rejoignent une ligne de ligature commune).
 */
function poserHampes(out, poses, groupes, S) {
    const enGroupe = new Set(groupes.flat());

    // --- Notes isolées ---------------------------------------------------------------------------
    for (const p of poses) {
        if (p.estSilence || enGroupe.has(p) || p.ref.duree.valeur < 2) continue;
        const sens = p.sensHampe;
        const xh = p.x + (sens < 0 ? 0.62 * S : -0.62 * S);
        const attache = sens < 0 ? p.yBas : p.yHaut;
        const bout = boutDeHampe(p, sens, S);
        out.push(ligne(xh, attache, xh, bout, G.EPAISSEURS.hampe * S));
        p.xHampe = xh; p.yHampe = bout;
        if (p.crochets > 0) {
            // Hampe descendante : le crochet est exactement le miroir vertical de celui d'une hampe
            // montante — un seul dessin à maintenir, retourné à la pose.
            out.push({ ...glyphe(G.crochet(p.crochets), xh, bout, S), miroirY: sens > 0 });
        }
    }

    // --- Groupes ligaturés -------------------------------------------------------------------------
    for (const g of groupes) {
        // Sens commun au groupe : une ligature ne peut pas pointer des deux côtés. On additionne les
        // ÉCARTS à la ligne médiane plutôt que de compter les voix, pour qu'une note très aiguë pèse
        // dans la décision à proportion de ce qu'elle dépasse.
        const poids = g.reduce((t, p) => t + (p.sensHampe > 0 ? 1 : -1) * (1 + Math.abs(p.yBas - p.yHaut) / (4 * S)), 0);
        const sens = poids >= 0 ? 1 : -1;
        for (const p of g) p.sensHampe = sens;

        const xh = (p) => p.x + (sens < 0 ? 0.62 * S : -0.62 * S);
        const premier = g[0], dernier = g[g.length - 1];
        const yIdeal = (p) => boutDeHampe(p, sens, S);

        // Ligne de ligature : une droite passant au-delà de TOUTES les hampes idéales du groupe, dont
        // la pente suit la courbe mélodique mais reste bornée — une ligature trop pentue se lit mal et
        // rend les hampes intérieures difformes.
        const largeur = xh(dernier) - xh(premier);
        const penteBrute = largeur ? (yIdeal(dernier) - yIdeal(premier)) / largeur : 0;
        const pente = Math.max(-0.26, Math.min(0.26, penteBrute));
        const yEn = (xx, origine) => origine + pente * (xx - xh(premier));
        // On cale l'origine pour qu'aucune hampe ne soit plus courte que le minimum acceptable.
        let origine = yIdeal(premier);
        for (const p of g) {
            const y = yEn(xh(p), origine);
            const manque = sens < 0 ? y - yIdeal(p) : yIdeal(p) - y;
            if (manque > 0) origine += sens < 0 ? -manque : manque;
        }

        for (const p of g) {
            const x = xh(p);
            const yb = yEn(x, origine);
            out.push(ligne(x, sens < 0 ? p.yBas : p.yHaut, x, yb, G.EPAISSEURS.hampe * S));
            p.xHampe = x; p.yHampe = yb;
        }

        const ep = G.EPAISSEURS.ligature * S;
        // Niveau 1 = la ligature principale, continue sur tout le groupe. Niveaux 2 et 3 = les
        // ligatures secondaires (doubles, triples croches), tracées seulement sur les PLAGES de notes
        // assez brèves — une double isolée au milieu de croches reçoit un moignon, orienté vers
        // l'intérieur du groupe comme le veut la gravure.
        for (let niveau = 1; niveau <= 3; niveau++) {
            const decalage = (niveau - 1) * (ep + 0.26 * S) * (sens < 0 ? 1 : -1);
            let debut = null;
            for (let i = 0; i <= g.length; i++) {
                const assez = i < g.length && g[i].crochets >= niveau;
                if (assez && debut === null) debut = i;
                if (!assez && debut !== null) {
                    const a = g[debut], b = g[i - 1];
                    let xa = a.xHampe, xb = b.xHampe;
                    if (debut === i - 1) {
                        const versDroite = debut === 0;
                        xa = a.xHampe + (versDroite ? 0 : -1.05 * S);
                        xb = a.xHampe + (versDroite ? 1.05 * S : 0);
                    }
                    const ya = yEn(xa, origine) + decalage, yb = yEn(xb, origine) + decalage;
                    const h = sens < 0 ? ep : -ep;
                    out.push(poly([[xa, ya], [xb, yb], [xb, yb + h], [xa, ya + h]]));
                    debut = null;
                }
            }
        }
    }
}

/**
 * Crochet et chiffre des divisions irrégulières (« 3 » d'un triolet).
 *
 * Sans ce chiffre, trois croches en triolet sont IMPOSSIBLES à distinguer de trois croches
 * ordinaires : le dessin des notes est identique, seule la durée change. C'est le seul cas de la
 * notation où l'information rythmique ne tient pas dans la forme des notes.
 */
function poserNolets(out, poses, S) {
    let i = 0;
    while (i < poses.length) {
        const nolet = poses[i].ref.duree.nolet;
        if (!nolet) { i++; continue; }
        let j = i;
        while (j + 1 < poses.length) {
            const suivant = poses[j + 1].ref.duree.nolet;
            if (!suivant || suivant.dans !== nolet.dans || suivant.valent !== nolet.valent) break;
            j++;
        }
        const groupe = poses.slice(i, j + 1);
        const sens = groupe[0].sensHampe;
        // Au-dessus si les hampes montent, en dessous sinon : le chiffre se pose du côté des hampes,
        // à leur extrémité, où il ne croise ni tête ni ligne supplémentaire.
        const y = sens < 0
            ? Math.min(...groupe.map(p => p.yHampe ?? p.yHaut)) - 0.95 * S
            : Math.max(...groupe.map(p => p.yHampe ?? p.yBas)) + 1.5 * S;
        const xa = groupe[0].x, xb = groupe[groupe.length - 1].x;
        out.push(texte((xa + xb) / 2, y + 0.35 * S, String(nolet.dans), {
            taille: S * 1.25, police: 'serif', poids: '600', italique: true,
        }));
        // Le crochet n'est tracé que si le groupe n'est pas déjà tenu par une ligature : celle-ci
        // délimite déjà le n-olet à l'œil, un crochet par-dessus ferait redondance.
        const ligature = groupe.every(p => p.crochets > 0) && groupe.length > 1;
        if (!ligature && groupe.length > 1) {
            const patte = sens < 0 ? 0.55 * S : -0.55 * S;
            const marge = 1.1 * S;
            out.push(ligne(xa, y + patte, xa, y, G.EPAISSEURS.liaison * S));
            out.push(ligne(xa, y, (xa + xb) / 2 - marge, y, G.EPAISSEURS.liaison * S));
            out.push(ligne((xa + xb) / 2 + marge, y, xb, y, G.EPAISSEURS.liaison * S));
            out.push(ligne(xb, y, xb, y + patte, G.EPAISSEURS.liaison * S));
        }
        i = j + 1;
    }
}

// ---------------------------------------------------------------------------------------------
// Liaisons, hammer-on / pull-off / slides, palm mute
// ---------------------------------------------------------------------------------------------

function poserLiaisons(out, poses, S, ST) {
    for (let i = 0; i < poses.length - 1; i++) {
        const a = poses[i], b = poses[i + 1];
        for (const na of a.notes) {
            if (!na.note.lien) continue;
            const nb = b.notes.find(n => n.note.corde === na.note.corde);
            if (!nb) continue;

            // Sur la tablature : l'arc relie les deux chiffres, en passant SOUS eux.
            const x1 = a.x + na.demiLargeurTab, x2 = b.x - nb.demiLargeurTab;
            const yT = na.yTab + ST * 0.42;
            out.push(courbe(arcLiaison(x1, yT, x2, nb.yTab + ST * 0.42, 1, 0.34 * S), G.EPAISSEURS.liaison * S));
            const etiquette = { hammer: 'H', pull: 'P', slide: '', tie: '' }[na.note.lien];
            if (etiquette) {
                out.push(texte((x1 + x2) / 2, na.yTab - ST * 0.42, etiquette, {
                    taille: S * 1.1, police: 'serif', poids: '700', italique: true,
                }));
            }
            // Sur la portée : l'arc se place du côté opposé aux hampes.
            if (na.yPortee != null && nb.yPortee != null) {
                const sens = a.sensHampe < 0 ? 1 : -1;
                out.push(courbe(arcLiaison(a.x + 0.66 * S, na.yPortee + sens * 0.55 * S, b.x - 0.66 * S, nb.yPortee + sens * 0.55 * S, sens, 0.38 * S), G.EPAISSEURS.liaison * S));
            }
        }
    }

    // Palm mute : « P.M. » suivi d'un trait pointillé au-dessus de la tablature, sur toute la plage
    // d'évènements consécutifs qui le portent — un P.M. par note serait illisible.
    let debut = null;
    for (let i = 0; i <= poses.length; i++) {
        const actif = i < poses.length && poses[i].ref.palmMute;
        if (actif && debut === null) debut = i;
        if (!actif && debut !== null) {
            const a = poses[debut], b = poses[i - 1];
            const yPM = Math.min(...poses.slice(debut, i).map(p => p.notes.length ? Math.min(...p.notes.map(n => n.yTab)) : Infinity)) - ST * 0.85;
            out.push(texte(a.x - 0.4 * S, yPM, 'P.M.', { taille: S * 1.05, police: 'serif', italique: true, poids: '600', ancre: 'debut' }));
            if (b.x > a.x + 2 * S) out.push({ ...ligne(a.x + 2.4 * S, yPM - S * 0.3, b.x + 0.6 * S, yPM - S * 0.3, G.EPAISSEURS.liaison * S), pointille: [2.2, 2.2] });
            debut = null;
        }
    }
}
