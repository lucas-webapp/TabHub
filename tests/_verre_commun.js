// Outils COMMUNS aux bancs du verre — le même fichier dans HarmoHub et TabHub (comme verre.js). Rien d'une appli en particulier ici :
// les gestes propres à chacune (ouvrir ses Paramètres, ajouter un accord) restent dans son banc.
//
// POURQUOI DES OUTILS À PART. Trois des contrôles du verre ne ressemblent à aucun contrôle ordinaire :
//
//   • LE RENDU ÉTEINT EST CELUI D'AVANT. On ne peut pas le vérifier en regardant des règles : il faut COMPARER. `signature()` relève, pour
//     chaque élément visible, une dizaine de propriétés CALCULÉES (fonds, ombres, flou, couleurs) ; le banc la prend une fois avec
//     verre.css retiré de la page (route interceptée : comme s'il n'existait pas) et une fois avec verre.css chargé mais verre éteint.
//     Elles doivent être identiques, élément par élément.
//
//   • LE TEXTE RESTE LISIBLE. Un fond translucide peut laisser passer ce qu'il recouvre — ou la couleur par défaut du navigateur, que
//     des dégradés opaques cachaient : sur la page Paroles, des pastilles BLANCHES au texte clair, sans une seule erreur. Aucune règle
//     ne dit « le texte est lisible » ; `contrastesFaibles()` le MESURE (couleur du texte contre le fond effectif, en empilant les fonds
//     des ancêtres). Un rapport trop bas qui n'existait pas verre éteint est une régression du verre.
//
//   • L'ATTRIBUT EST POSÉ AVANT LE PREMIER AFFICHAGE. `enregistreurAttribut` observe <html> dès la création du document et note, au moment
//     où data-glass apparaît, si <body> existe déjà. Posé après, l'appli paraîtrait un instant sans verre, puis serait repeinte.

const fs = require('fs');
const path = require('path');

/** Playwright est installé globalement dans cet environnement ; on le cherche là aussi. */
function chargerPlaywright() {
    try { return require('playwright'); } catch (e) { /* pas dans le dossier courant */ }
    for (const racine of ['/opt/node22/lib/node_modules', '/usr/lib/node_modules', '/usr/local/lib/node_modules']) {
        try { return require(path.join(racine, 'playwright')); } catch (e) { /* suivant */ }
    }
    throw new Error('playwright introuvable — npm i -g playwright && playwright install chromium');
}

/** Le bruit réseau attendu (polices, échantillons, SDK coupés exprès) : jamais une erreur de l'application. */
const BRUIT = /ERR_FAILED|fonts\.|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_TUNNEL|ERR_CERT_AUTHORITY_INVALID|tonejs|Failed to load resource|AudioContext was not allowed|net::/;

/**
 * Ouvre une page.
 *   reglages  { cle: valeur } posés dans localStorage AVANT chaque chargement (script d'initialisation : survit au rechargement)
 *   bloquer   motifs d'URL à faire échouer (verre.css retiré, verre.js absent…)
 *   tactile   contexte tactile de téléphone
 *   avant     scripts supplémentaires à injecter avant le chargement
 */
async function ouvrir(navigateur, { url, viewport = { width: 1320, height: 820 }, reglages = {}, bloquer = [], tactile = false, avant = [], prete }) {
    const contexte = await navigateur.newContext({ viewport, ...(tactile ? { hasTouch: true, isMobile: true } : {}) });
    await contexte.addInitScript((r) => { try { for (const k of Object.keys(r)) localStorage.setItem(k, r[k]); } catch (e) { /* stockage fermé */ } }, reglages);
    for (const contenu of avant) await contexte.addInitScript({ content: contenu });
    await contexte.route(/gstatic\.com|googleapis\.com|tonejs\.github\.io/, (r) => r.abort());
    for (const motif of bloquer) await contexte.route(motif, (r) => r.abort());
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if ((m.type() === 'error') && !BRUIT.test(m.text())) erreurs.push('console: ' + m.text()); });
    await page.goto(url, { waitUntil: 'load', timeout: 25000 });
    if (prete) await page.waitForFunction(prete, null, { timeout: 20000 });
    await page.waitForTimeout(900);
    return { contexte, page, erreurs };
}

/** Script d'initialisation : note ce que <body> valait au moment où data-glass est posé sur <html>. */
const enregistreurAttribut = `
(function () {
    window.__verreEnregistre = { pose: false, bodyExistait: null, paintAvant: null };
    // On observe le DOCUMENT (et son sous-arbre) : au moment où ce script s'exécute, <html> n'existe pas encore, et l'observer lui-même
    // n'est pas possible. Une mutation d'attribut sur <html> remonte quand même jusqu'ici.
    function noter() {
        if (window.__verreEnregistre.pose) return;
        var racine = document.documentElement;
        if (racine && racine.getAttribute('data-glass') === '1') {
            window.__verreEnregistre = { pose: true, bodyExistait: !!document.body, paintAvant: performance.getEntriesByType('paint').length };
        }
    }
    new MutationObserver(noter).observe(document, { attributes: true, attributeFilter: ['data-glass'], subtree: true });
    noter();
})();`;

/**
 * Relevé des propriétés calculées de chaque élément visible. `exclure` : sélecteurs dont on ignore le contenu (le réglage lui-même
 * n'existe que verre.js chargé — il fausserait la comparaison).
 */
function signature(page, exclure = []) {
    return page.evaluate((exclure) => {
        const PROPS = ['backgroundColor', 'backgroundImage', 'boxShadow', 'backdropFilter', 'color', 'borderTopColor', 'borderLeftColor', 'filter', 'opacity', 'colorScheme'];
        const sel = exclure.join(',');
        const sortie = [];
        for (const e of document.body.querySelectorAll('*')) {
            if (/^(SCRIPT|STYLE|LINK|META|TITLE)$/.test(e.tagName)) continue;
            if (sel && e.closest(sel)) continue;
            const r = e.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            const cs = getComputedStyle(e);
            if (cs.visibility === 'hidden') continue;
            const nom = e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
            sortie.push(nom + ' | ' + PROPS.map((p) => cs[p]).join(' | '));
        }
        return sortie;
    }, exclure);
}

/** Les différences entre deux relevés : { n, premieres }. Un nombre d'éléments différent est signalé tel quel. */
function comparer(a, b) {
    const diffs = [];
    if (a.length !== b.length) diffs.push(`${a.length} éléments contre ${b.length}`);
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) diffs.push(`#${i} ${a[i].split(' | ')[0]}\n        A: ${a[i].split(' | ').slice(1).join(' | ').slice(0, 170)}\n        B: ${b[i].split(' | ').slice(1).join(' | ').slice(0, 170)}`);
    return { n: diffs.length, premieres: diffs.slice(0, 4) };
}

/**
 * Les textes dont le contraste avec leur fond EFFECTIF est inférieur à `seuil` (3 : le seuil WCAG du grand texte, volontairement
 * indulgent — on cherche le texte clair sur fond clair, pas la nuance). Le fond effectif empile les couleurs de fond des ancêtres
 * sur le fond de la page ; les dégradés (background-image) ne sont pas pris en compte.
 */
function contrastesFaibles(page, seuil = 3, fondPage = null) {
    return page.evaluate(([seuil, fondPage]) => {
        const lire = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
        const sur = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
        const lum = (c) => { const t = [c.r, c.g, c.b].map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2]; };
        const cs0 = getComputedStyle(document.body);
        const base = fondPage ? lire(fondPage) : (lire(cs0.backgroundColor) && lire(cs0.backgroundColor).a === 1 ? lire(cs0.backgroundColor) : { r: 7, g: 11, b: 18, a: 1 });
        const vus = new Set(); const faibles = [];
        for (const e of document.body.querySelectorAll('*')) {
            if (/^(SCRIPT|STYLE|SVG|PATH|OPTION)$/i.test(e.tagName)) continue;
            const propre = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
            if (!propre) continue;
            const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
            const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || parseFloat(cs.fontSize) < 8 || parseFloat(cs.opacity) < 0.3) continue;
            const chaine = []; for (let n = e; n && n !== document.documentElement; n = n.parentElement) chaine.unshift(n);
            let fond = base; for (const n of chaine) { const c = lire(getComputedStyle(n).backgroundColor); if (c && c.a > 0) fond = sur(c, fond); }
            const fg = lire(cs.color); if (!fg) continue;
            const texte = sur(fg, fond);
            const l1 = lum(texte), l2 = lum(fond); const rap = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            if (rap < seuil) {
                const cle = e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/)[0] : '') + '|' + propre.slice(0, 24);
                if (!vus.has(cle)) { vus.add(cle); faibles.push({ cle, rapport: Math.round(rap * 100) / 100 }); }
            }
        }
        return faibles;
    }, [seuil, fondPage]);
}

/**
 * Les boutons visibles qui posent un DÉGRADÉ et gardent en dessous une couleur de fond non transparente. Un bouton qui ne pose qu'un
 * `background-image` laisse le navigateur fournir la couleur de dessous (gris clair, ou blanc) : cachée par des dégradés opaques,
 * elle apparaît dès qu'ils deviennent translucides — des pastilles blanches au texte clair sur la page Paroles. Sous le verre, il ne
 * doit pas y en avoir. Rend les « balise.classe » fautifs.
 */
function boutonsSousDegrade(page) {
    return page.evaluate(() => {
        const alpha = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 1; const v = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return v.length > 3 ? v[3] : 1; };
        const fautifs = [];
        for (const b of document.querySelectorAll('button')) {
            const r = b.getBoundingClientRect(); if (!r.width || !r.height) continue;
            const cs = getComputedStyle(b);
            if (/gradient/.test(cs.backgroundImage) && alpha(cs.backgroundColor) > 0) fautifs.push('button' + (typeof b.className === 'string' && b.className ? '.' + b.className.trim().split(/\s+/).join('.') : '') + ' ' + cs.backgroundColor);
        }
        return [...new Set(fautifs)];
    });
}

/**
 * Les boutons visibles dont un DÉGRADÉ contient une couleur pleine (« rgb(… ) » : le navigateur écrit « rgba(… ) » dès qu'il y a de la
 * transparence). Sous le verre, les dégradés des boutons sont translucides — c'est ce qui laisse voir l'aurore à travers eux ; un seul
 * arrêt opaque aplatit le bouton en tuile pleine, sans une erreur. Rend les « balise.classe » fautifs.
 */
function boutonsDegradeOpaque(page) {
    return page.evaluate(() => {
        const fautifs = [];
        for (const b of document.querySelectorAll('button:not(.verre-fond)')) {   // les pastilles de couleur SONT des dégradés pleins : c'est leur objet
            const r = b.getBoundingClientRect(); if (!r.width || !r.height) continue;
            const cs = getComputedStyle(b);
            if (/gradient/.test(cs.backgroundImage) && /\brgb\(/.test(cs.backgroundImage)) fautifs.push('button' + (typeof b.className === 'string' && b.className ? '.' + b.className.trim().split(/\s+/).join('.') : ''));
        }
        return [...new Set(fautifs)];
    });
}

/** Lit un fichier du dépôt (racine = le dossier au-dessus de tests/). */
function lireSource(nom) { return fs.readFileSync(path.join(__dirname, '..', nom), 'utf8'); }

module.exports = { chargerPlaywright, BRUIT, ouvrir, enregistreurAttribut, signature, comparer, contrastesFaibles, boutonsSousDegrade, boutonsDegradeOpaque, lireSource };
