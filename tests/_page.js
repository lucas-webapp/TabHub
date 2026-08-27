// Ouverture de l'application pour les bancs Playwright.
//
// Un seul endroit sait comment démarrer le navigateur, vider le brouillon local et attendre que
// l'application soit réellement prête. Chaque banc qui referait ces trois gestes à sa façon finirait
// par attendre un peu moins que le voisin, et par devenir intermittent — la pire espèce de banc.

const path = require('path');

/** Playwright est installé globalement dans cet environnement ; on le cherche là aussi. */
function chargerPlaywright() {
    try { return require('playwright'); } catch (e) { /* pas dans le dossier courant */ }
    for (const racine of ['/opt/node22/lib/node_modules', '/usr/lib/node_modules', '/usr/local/lib/node_modules']) {
        try { return require(path.join(racine, 'playwright')); } catch (e) { /* suivant */ }
    }
    throw new Error('playwright introuvable — npm i -g playwright && playwright install chromium');
}

const URL_BASE = process.env.TABHUB_URL || 'http://localhost:8945';

/**
 * Ouvre l'application dans un onglet neuf, brouillon local vidé.
 * @returns {{navigateur, page, erreurs, fermer}} `erreurs` collecte tout ce qui a été signalé par la
 *   console ou lancé sans être rattrapé : un banc qui passe alors que la page hurle en console ne
 *   prouve pas grand-chose.
 */
async function ouvrirApp(options = {}) {
    const { chromium } = chargerPlaywright();
    const navigateur = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    // `hasTouch`/`isMobile` : ce qui fait qu'un banc éprouve VRAIMENT le tactile plutôt qu'une souris
    // dans une petite fenêtre. Sans `hasTouch`, les gestes partent en `pointerType: 'mouse'` et
    // `(pointer: coarse)` reste faux — les deux conditions exactes dont dépend toute l'interface
    // tactile (voir main.js#demarrerGeste et appareilTactile). Absents par défaut : les autres bancs
    // décrivent un ordinateur, et doivent continuer à le faire.
    const contexte = await navigateur.newContext({
        viewport: options.viewport || { width: 1320, height: 880 },
        acceptDownloads: true,
        ...(options.hasTouch ? { hasTouch: true } : {}),
        ...(options.isMobile ? { isMobile: true } : {}),
    });
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('exception : ' + e.message));
    page.on('console', m => {
        // Les polices Google et les échantillons de piano (Sampler, voir audio/player.js) sont chargés
        // depuis le réseau : hors ligne, ou dans cet environnement d'essai dont la politique de sortie
        // réseau bloque certains hôtes externes, leur échec est ATTENDU et sans effet — une feuille de
        // style de repli pour les polices, une doublure synthétisée pour le piano (voir onerror sur le
        // Sampler, qui l'absorbe déjà côté application ; c'est le NAVIGATEUR qui journalise malgré
        // tout l'échec réseau lui-même en console, hors de portée de ce onerror applicatif).
        if (m.type() === 'error' && !/fonts\.googleapis|tonejs\.github\.io|ERR_CONNECTION|ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_CERT_AUTHORITY_INVALID/.test(m.text())) {
            erreurs.push('console : ' + m.text());
        }
    });

    await page.goto(URL_BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.app && window.app.page, null, { timeout: 20000 });
    await page.waitForTimeout(250);

    return { navigateur, contexte, page, erreurs, fermer: () => navigateur.close() };
}

/**
 * Tape une suite de touches dans la partition, avec de quoi laisser l'application respirer.
 *
 * Le focus est donné PAR PROGRAMME, jamais par un clic : Playwright clique au centre de l'élément, et
 * le centre de la zone de partition tombe en plein sur la feuille — donc sur une vraie mesure, ce qui
 * déplaçait le curseur avant même la première touche. Un banc doit donner le focus, pas simuler un
 * geste qui a ses propres effets.
 */
async function taper(page, touches, pause = 30) {
    await page.evaluate(() => document.getElementById('zone-partition').focus());
    for (const t of touches) {
        await page.keyboard.press(t);
        await page.waitForTimeout(pause);
    }
    await page.waitForTimeout(120);
}

/** État de l'éditeur, lisible depuis le banc. */
function lireEtat(page) {
    return page.evaluate(() => {
        const ed = window.app.editeur;
        const p = ed.partition;
        return {
            mesures: p.mesures.length,
            curseur: { ...ed.curseur },
            tempo: p.meta.tempo,
            titre: p.meta.titre,
            instrument: p.piste.instrument,
            cordes: p.piste.accordage.cordes.slice(),
            accordage: p.piste.accordage.id,
            // `contenu`/`durees` lisent la voix 0 (la mélodie) — celle que tous les bancs antérieurs
            // aux voix connaissent déjà. `toutesVoix` donne le détail complet, voix par voix, pour
            // les bancs qui portent spécifiquement sur la seconde voix.
            contenu: p.mesures.map(m => m.voix[0].evenements.map(e =>
                (e.silence || !e.notes.length) ? '_' : e.notes.map(n => n.corde + ':' + n.frette).join('+'))),
            durees: p.mesures.map(m => m.voix[0].evenements.map(e => e.duree.valeur)),
            nbVoix: p.mesures.map(m => m.voix.length),
            toutesVoix: p.mesures.map(m => m.voix.map(v => v.evenements.map(e =>
                (e.silence || !e.notes.length) ? '_' : e.notes.map(n => n.corde + ':' + n.frette).join('+')))),
            systemes: window.app.page.ancrages.systemes.length,
            primitives: window.app.page.primitives.length,
            etatLecture: window.app.lecteur.etat,
        };
    });
}

module.exports = { ouvrirApp, taper, lireEtat, URL_BASE, chargerPlaywright };
