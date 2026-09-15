// Icônes de l'interface, en SVG inline.
//
// Même dessin que HarmoHub — contours de 2px, bouts arrondis, boîte 24×24 — pour que les deux
// applications se ressemblent là où elles font la même chose (annuler, lire, exporter). Inline
// plutôt qu'en police d'icônes ou en fichiers séparés : une icône devient alors un simple `currentColor`,
// qui suit la couleur du bouton dans tous ses états sans règle supplémentaire.

const D = {
    annuler: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    retablir: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    reglages: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.04.05a2 2 0 1 1-2.83 2.83l-.05-.04a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.05.04a2 2 0 1 1-2.83-2.83l.04-.05a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.04-.05a2 2 0 1 1 2.83-2.83l.05.04a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.05-.04a2 2 0 1 1 2.83 2.83l-.04.05a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
    lecture: '<path d="M6 4.5v15l13-7.5Z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6.5" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>',
    // Import/export : mêmes tracés que HarmoHub (song-import/song-export) — une flèche qui monte
    // depuis une base pour importer, qui descend vers une base pour exporter. Enregistrer garde le
    // disque, lui aussi identique à HarmoHub : c'est le SEUL des trois qui reste vert (voir
    // .btn-icone-accent dans style.css), l'action mise en avant.
    ouvrir: '<path d="M12 21V9"/><path d="m7 13 5-5 5 5"/><path d="M5 3h14"/>',
    exporter: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/>',
    enregistrer: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
    pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/>',
    nouveau: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M12 11v6"/><path d="M9 14h6"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    moins: '<path d="M5 12h14"/>',
    // « ⇥ Corriger » (redistribuer une mesure invalide, voir edit/commands.js#corrigerDebordement) :
    // deux traits verticaux — les mêmes bords de mesure que repriseDebut/repriseFin juste plus haut,
    // la mesure elle-même comme motif plutôt qu'un symbole abstrait — et une coche, la mesure remise
    // juste.
    corriger: '<path d="M5 4v16"/><path d="M19 4v16"/><path d="m9 12 2.5 2.5L16 9"/>',
    poubelle: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
    metronome: '<path d="M12 3 8 21h8L12 3Z"/><path d="m7 15 10-6"/>',
    guitare: '<path d="M11.5 3.5 15 7"/><path d="M8.5 10.5a4.5 4.5 0 1 0 5 5c.5-2 3-2.5 3-5.5s-3-3-4-3-4 1.5-4 3.5Z"/><circle cx="10.5" cy="13.5" r="1.6"/>',
    aide: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    fermer: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    chevronBas: '<path d="m6 9 6 6 6-6"/>',

    // Effets de jeu : LE BOUTON MONTRE CE QUE LA PARTITION ÉCRIT.
    //
    // Le pari précédent était l'inverse — « le geste, pas une lettre » : une flèche cabrée vers le
    // haut pour le hammer-on, la même retournée pour le pull-off, une flèche coudée pour le slide.
    // Le raisonnement (deux gestes opposés se reconnaissent comme une paire) valait sur le papier,
    // il est démenti à l'usage (retour utilisateur : « les logos des effets ne sont pas forcément
    // logiques ou adaptés, parfois on a du mal à comprendre — tu peux par exemple insérer le petit
    // H pour le hammer-on »). Deux raisons pour lesquelles il ne pouvait pas marcher :
    //
    //   1. Trois flèches courbes dans le même rang de boutons ne se distinguent que par leur sens,
    //      et le bend en est une quatrième — au premier coup d'œil, quatre fois la même icône.
    //   2. Surtout, aucune ne ressemblait à ce qui apparaît ENSUITE sur la partition. Le lien entre
    //      le bouton et son effet était à apprendre ; il devrait être à lire.
    //
    // Donc : la liaison plus la lettre, exactement la gravure de engine/layout.js#poserLiaisons. Les
    // deux pastilles aux extrémités disent en plus que l'effet relie DEUX notes — ce qui explique au
    // passage pourquoi il ne fait rien sur une note isolée.
    hammerOn: '<text x="12" y="10.8" font-family="Georgia, serif" font-size="12.5" font-weight="700" font-style="italic" text-anchor="middle" fill="currentColor" stroke="none">H</text><circle cx="6.6" cy="16.2" r="1.7" fill="currentColor" stroke="none"/><circle cx="17.4" cy="16.2" r="1.7" fill="currentColor" stroke="none"/><path d="M6.6 18.5q5.4 3.6 10.8 0" stroke-width="1.7"/>',
    pullOff: '<text x="12" y="10.8" font-family="Georgia, serif" font-size="12.5" font-weight="700" font-style="italic" text-anchor="middle" fill="currentColor" stroke="none">P</text><circle cx="6.6" cy="16.2" r="1.7" fill="currentColor" stroke="none"/><circle cx="17.4" cy="16.2" r="1.7" fill="currentColor" stroke="none"/><path d="M6.6 18.5q5.4 3.6 10.8 0" stroke-width="1.7"/>',
    // Slide : le trait oblique entre deux notes, le signe même du glissando — celui que la partition
    // trace désormais (voir poserLiaisons). Deux pastilles à hauteurs DIFFÉRENTES, là où celles du
    // hammer/pull sont à la même : c'est ce qu'un slide fait et qu'une liaison ne fait pas, changer
    // de hauteur. Pas de lettre : la partition n'en écrit pas non plus.
    slide: '<circle cx="5.8" cy="17.4" r="1.7" fill="currentColor" stroke="none"/><circle cx="18.2" cy="6.6" r="1.7" fill="currentColor" stroke="none"/><path d="M8 15.8 16 8.8" stroke-width="1.9"/>',
    // Liaison de prolongation : le même arc que celui posé sur la partition (voir arcLiaison dans
    // engine/layout.js), pas un caractère Unicode — celui-ci change de graisse et de courbure d'une
    // police à l'autre, et rendait ce bouton visuellement imprévisible.
    tie: '<path d="M4 10c4 7 12 7 16 0"/>',
    // Bend : la corde tirée, la hauteur qui monte — une flèche qui se cabre plutôt qu'un chevron
    // droit, pour ne pas se confondre avec « transposer » ailleurs dans l'appli.
    bend: '<path d="M8 19c0-9 3-11 7-13"/><path d="M11.5 4.3 15 6l-.7 3.8"/>',
    // Barres de reprise : la vraie graphie (trait épais + trait fin + deux points), pas des
    // deux-points ni des barres verticales génériques — c'est elle qui rend le bouton lisible comme
    // « reprise » plutôt que comme un simple séparateur.
    repriseDebut: '<rect x="5" y="4" width="2.6" height="16" rx=".6" fill="currentColor" stroke="none"/><path d="M11 4v16"/><circle cx="15.5" cy="10.4" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.5" cy="13.6" r="1.3" fill="currentColor" stroke="none"/>',
    repriseFin: '<rect x="16.4" y="4" width="2.6" height="16" rx=".6" fill="currentColor" stroke="none"/><path d="M13 4v16"/><circle cx="8.5" cy="10.4" r="1.3" fill="currentColor" stroke="none"/><circle cx="8.5" cy="13.6" r="1.3" fill="currentColor" stroke="none"/>',
    // Annotation de section : un « T » d'outil-texte (la convention des logiciels de dessin pour
    // « ajouter du texte »), pas une bulle de dialogue — qui aurait évoqué un commentaire ou une
    // discussion, alors qu'une annotation de section s'imprime sur la partition elle-même.
    annotation: '<path d="M5 6h14"/><path d="M12 6v14"/><path d="M9 20h6"/>',
    // AIDE RYTHMIQUE : quatre cases côte à côte, une sur deux REMPLIE — littéralement ce que le
    // bouton ouvre, et ce qu'on y fait (allumer des cases pour poser un rythme). Un pictogramme
    // abstrait aurait demandé d'apprendre la correspondance ; celui-ci se reconnaît une fois la
    // fenêtre vue.
    // QUATRE RECTANGLES SÉPARÉS, et non un cadre divisé par des traits : essayé d'abord, le cadre se
    // lisait à la taille d'un bouton comme trois barres verticales — les séparations disparaissaient
    // sous les cases pleines. Des cases détachées gardent leur grammaire « allumée / éteinte » même
    // réduites à quatre pixels de large.
    grilleRythme: '<rect x="1.6" y="5.5" width="4.2" height="13" rx=".9" fill="currentColor" stroke="none"/>'
        + '<rect x="7.2" y="5.5" width="4.2" height="13" rx=".9"/>'
        + '<rect x="12.8" y="5.5" width="4.2" height="13" rx=".9" fill="currentColor" stroke="none"/>'
        + '<rect x="18.4" y="5.5" width="4.2" height="13" rx=".9"/>',
    // --- BARRES DE FIN ET REPÈRES DE NAVIGATION (popover « Repères », voir edit/raccourcis.js) ----
    // Les deux barres reprennent la grammaire de repriseDebut/repriseFin juste au-dessus : traits
    // verticaux pleine hauteur, le trait ÉPAIS dessiné en <rect> rempli plutôt qu'en <path> épaissi
    // (un trait de 2,6 d'épaisseur aurait des bouts arrondis, une barre de mesure n'en a pas).
    barreDouble: '<path d="M9 4v16"/><path d="M15 4v16"/>',
    barreFinale: '<path d="M9 4v16"/><rect x="14" y="4" width="2.8" height="16" rx=".5" fill="currentColor" stroke="none"/>',
    // SEGNO : le même dessin que sur la partition (voir engine/layout.js#tracerSegno) — un bouton de
    // palette doit montrer ce qu'il va écrire, pas une paraphrase. S oblique, barré, deux points.
    segno: '<path d="M15.4 5.2 C8.6 3.2 8.6 10.6 12 12 C15.4 13.4 15.4 20.8 8.6 18.8" fill="none"/>'
        + '<path d="M6.9 20.2 17.1 3.8"/>'
        + '<circle cx="7.4" cy="8.3" r="1.2" fill="currentColor" stroke="none"/>'
        + '<circle cx="16.6" cy="15.7" r="1.2" fill="currentColor" stroke="none"/>',
    // CODA : cercle traversé d'une croix qui déborde de part et d'autre.
    coda: '<circle cx="12" cy="12" r="4.6"/><path d="M12 4.6v14.8"/><path d="M4.6 12h14.8"/>',
    // MIDI : le connecteur DIN 5 broches, seul symbole vraiment associé au format — les mêmes
    // flèches que ouvrir/exporter auraient prêté à confusion juste à côté d'elles. Cinq points
    // (les broches), une encoche en haut (le détrompeur du vrai connecteur) : reconnaissable sans
    // description, pour qui a déjà vu un câble MIDI.
    midi: '<circle cx="12" cy="13" r="8.4"/><path d="M8.6 6.4a5 5 0 0 1 6.8 0"/>'
        + '<circle cx="12" cy="9.3" r="1" fill="currentColor" stroke="none"/>'
        + '<circle cx="8.9" cy="12.1" r="1" fill="currentColor" stroke="none"/>'
        + '<circle cx="15.1" cy="12.1" r="1" fill="currentColor" stroke="none"/>'
        + '<circle cx="9.8" cy="16" r="1" fill="currentColor" stroke="none"/>'
        + '<circle cx="14.2" cy="16" r="1" fill="currentColor" stroke="none"/>',
};

/** Icône prête à insérer. `extra` ajoute des classes CSS au <svg>. */
export function icone(nom, extra = '') {
    const d = D[nom];
    if (!d) return '';
    return `<svg class="icone ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

// PLUS DE `NOMS_ICONES` ICI (audit) : personne ne l'importait. `D` reste la liste, et `icone(nom)`
// rend une chaîne vide pour un nom inconnu — un appel fautif ne casse donc rien à l'écran.
