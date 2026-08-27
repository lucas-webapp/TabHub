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
    poubelle: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
    metronome: '<path d="M12 3 8 21h8L12 3Z"/><path d="m7 15 10-6"/>',
    guitare: '<path d="M11.5 3.5 15 7"/><path d="M8.5 10.5a4.5 4.5 0 1 0 5 5c.5-2 3-2.5 3-5.5s-3-3-4-3-4 1.5-4 3.5Z"/><circle cx="10.5" cy="13.5" r="1.6"/>',
    aide: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    fermer: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    chevronBas: '<path d="m6 9 6 6 6-6"/>',

    // Effets de jeu — le GESTE, pas une lettre. La partition imprime encore « H »/« P » en toutes
    // lettres (convention de gravure établie, voir engine/layout.js) ; le bouton, lui, montre le
    // geste en un coup d'œil, plus vite reconnaissable qu'une lettre au milieu d'un rang de boutons.
    // hammerOn et pullOff sont le MIROIR vertical l'un de l'autre — cohérent avec le fait que ce
    // sont deux gestes opposés (frapper vers le haut / tirer vers le bas), ce qui les rend
    // reconnaissables comme une PAIRE plutôt que comme deux pictogrammes sans rapport.
    hammerOn: '<path d="M4 18c4-9 12-11 15-9"/><path d="M15.5 6.5 19 9l-1 4.2"/>',
    pullOff: '<path d="M4 6c4 9 12 11 15 9"/><path d="M15.5 17.5 19 15l-1-4.2"/>',
    slide: '<path d="M6 18 17 7"/><path d="M11 7h6v6"/>',
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

export const NOMS_ICONES = Object.keys(D);
