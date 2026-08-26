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
    ouvrir: '<path d="M4 6a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M12 11v6"/><path d="m9 14 3-3 3 3"/>',
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
};

/** Icône prête à insérer. `extra` ajoute des classes CSS au <svg>. */
export function icone(nom, extra = '') {
    const d = D[nom];
    if (!d) return '';
    return `<svg class="icone ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

export const NOMS_ICONES = Object.keys(D);
