// Banc du VERRE dans TabHub — l'effet « verre dépoli » de TrainHub, dans un vrai navigateur.
//
// CE QU'IL PROTÈGE. Retour utilisateur : « un affichage de type verre comme sur TrainHub, très joli, je veux le retrouver sur toutes les
// applis. Il doit rester gérable en paramètres ». Un rendu se vérifie d'abord à l'œil — ce banc ne remplace pas l'œil — mais cinq choses
// ne se voient PAS à l'œil et se dégradent en silence :
//
//   1. ÉTEINT, RIEN NE CHANGE. Si verre.css fuit d'une seule règle hors de `html[data-glass="1"]`, l'appli de tous ceux qui n'ont pas
//      allumé le verre change d'aspect sans prévenir. On compare donc le rendu CALCULÉ de chaque élément visible, verre.css retiré de la
//      page contre verre.css chargé mais éteint : identique, élément par élément (accueil, Réglages, menu Fichiers, aide, saisie).
//   2. LE PAPIER RESTE CLAIR. La partition est la seule zone claire de TabHub, par choix : on lit une tablature comme du papier. Le verre
//      habille ce qui l'entoure, jamais la feuille.
//   3. LE TEXTE RESTE LISIBLE. Des fonds translucides laissent passer ce qu'ils recouvrent — y compris la couleur par défaut du navigateur,
//      que des dégradés opaques cachaient (sur la page Paroles de HarmoHub : des pastilles BLANCHES au texte clair, sans une erreur).
//      Le contraste texte/fond est MESURÉ, verre éteint puis allumé.
//   4. L'ATTRIBUT EST POSÉ AVANT LE PREMIER AFFICHAGE : sinon l'appli paraît un instant sans verre, puis est repeinte.
//   5. LE REPLI. Sans flou (vieux navigateur) ou avec « moins de transparence », tout redevient opaque : chaque surface doit passer par
//      UNE variable (--glass-filter), jamais par un flou écrit en dur qu'aucun repli n'atteindrait.
//
// Et ce que l'utilisateur manie : l'interrupteur et la couleur du fond, dans Réglages > Apparence — retenus par appareil, à jour quand
// le réglage change ailleurs, à la taille du doigt sur téléphone, et sans effet de bord sur la barre du haut.
const creerHarnais = require('./_harness.js');
const { check, exiger, plan, bilan } = creerHarnais('verre dans TabHub');
const V = require('./_verre_commun.js');
const { chromium } = V.chargerPlaywright();

const BASE = process.env.TABHUB_URL || 'http://localhost:8945';
const PRETE = () => !!(window.app && window.app.page);
const VERRE = { 'tabhub.glass.v1': '1' };
const SEED = () => { const ed = window.app.editeur; for (const n of [0, 3, 5, 7, 5, 3, 0, 2]) { ed.appliquerDuree(4); ed.saisirChiffre(n); } ed.placerCurseur(0, 0, 0, 0); };
async function ouvrirTH(nav, o = {}) {
    const A = await V.ouvrir(nav, { url: BASE + '/index.html?nocache=' + Date.now(), prete: PRETE, ...o });
    // Une partition qui contient quelque chose : on veut juger le verre sur une vraie page, pas sur une feuille vide.
    await A.page.evaluate(SEED); await A.page.waitForTimeout(300);
    return A;
}

// Le réglage lui-même n'existe que verre.js chargé : on l'écarte de la comparaison « éteint = avant ».
const EXCLURE = ['#rubrique-apparence'];

const ETATS = {
    accueil: async () => {},
    reglages: async (p) => { await p.evaluate(() => { window.app.remplirReglages(); window.app.ouvrirFenetre('fenetre-reglages'); }); await p.waitForTimeout(300); },
    fichiers: async (p) => { await p.click('#btn-fichiers'); await p.waitForTimeout(300); },
    aide: async (p) => { await p.evaluate(() => { window.app.remplirAide(); window.app.ouvrirFenetre('fenetre-aide'); }); await p.waitForTimeout(300); },
    saisie: async (p) => { await p.click('#info-position'); await p.waitForTimeout(400); },
};
async function fermerTout(p) { await p.keyboard.press('Escape'); await p.waitForTimeout(120); await p.evaluate(() => window.app.fermerFenetres()); await p.waitForTimeout(150); }

(async () => {
    plan(54);
    const nav = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    try {
        // ===== 0. LES FICHIERS ET LEUR ORDRE (statique) ==========================================================================
        {
            const html = V.lireSource('index.html');
            const tete = html.slice(0, html.indexOf('</head>'));
            const balise = (tete.match(/<script[^>]*src="verre\.js[^"]*"[^>]*>/) || [''])[0];
            check(!!balise && !/\b(defer|async)\b|type="module"/.test(balise) && /data-app="tabhub"/.test(balise),
                'index.html : verre.js se charge dans <head>, sans defer ni async ni module (sinon l\'attribut arrive après le premier affichage) et dit de quelle appli il est');
            check(/href="verre\.css[^"]*"/.test(tete) && /href="verre-surfaces\.css[^"]*"/.test(tete), 'index.html : verre.css (commun) et verre-surfaces.css (propre à l\'appli) sont chargés');
        }
        const surfaces = V.lireSource('verre-surfaces.css');
        const commun = V.lireSource('verre.css');
        const flousEnDur = (surfaces.match(/backdrop-filter\s*:[^;]+;/g) || []).filter((d) => !/var\(--glass-filter\)/.test(d));
        check(flousEnDur.length === 0 && !/blur\(/.test(surfaces),
            `chaque flou de verre-surfaces.css passe par var(--glass-filter) — un flou écrit en dur échapperait au repli (${flousEnDur.length} en dur)`);
        check((commun.match(/--glass-filter:\s*none/g) || []).length >= 2 && /@supports not/.test(commun) && /prefers-reduced-transparency/.test(commun),
            'le repli coupe le flou à deux endroits : navigateur sans backdrop-filter, et « moins de transparence » demandé par l\'appareil');
        const horsVerre = commun.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((b) => b.split('{')[0].trim()).filter((sel) => sel && !/^@/.test(sel) && !/html\[data-glass/.test(sel) && !/^:where\(html\[data-glass/.test(sel) && !/\.verre-/.test(sel));
        check(horsVerre.length === 0, `verre.css : toute règle est sous html[data-glass="1"] — sauf le dessin du réglage lui-même (.verre-*) ; hors de là : ${JSON.stringify(horsVerre.slice(0, 3))}`);
        const horsVerre2 = surfaces.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '').split('}').map((b) => b.split('{')[0].trim()).filter((sel) => sel && !/html\[data-glass/.test(sel));
        check(horsVerre2.length === 0, `verre-surfaces.css : AUCUNE règle hors de html[data-glass="1"] (verre éteint, rien ne s'applique) ; hors de là : ${JSON.stringify(horsVerre2.slice(0, 3))}`);

        // ===== 1. L'ATTRIBUT AVANT LE PREMIER AFFICHAGE ============================================================================
        {
            const A = await ouvrirTH(nav, { reglages: VERRE, avant: [V.enregistreurAttribut] });
            const e = await A.page.evaluate(() => window.__verreEnregistre);
            check(e.pose === true && e.bodyExistait === false && e.paintAvant === 0,
                `data-glass est posé avant que <body> n'existe et avant tout affichage (body ${e.bodyExistait ? 'déjà là' : 'absent'}, ${e.paintAvant} peinture)`);
            check(await A.page.evaluate(() => document.documentElement.getAttribute('data-glass-bg')) === 'aurora', 'et data-glass-bg avec lui (« aurora » par défaut)');
            await A.contexte.close();
        }

        // ===== 2. ÉTEINT = LE RENDU D'AVANT, ÉLÉMENT PAR ÉLÉMENT ====================================================================
        {
            const sans = await ouvrirTH(nav, { bloquer: [/verre\.css/, /verre-surfaces\.css/, /verre\.js/] });
            const avec = await ouvrirTH(nav, {});
            for (const [nom, aller] of Object.entries(ETATS)) {
                await aller(sans.page); await aller(avec.page);
                const a = await V.signature(sans.page, EXCLURE), b = await V.signature(avec.page, EXCLURE);
                const d = V.comparer(a, b);
                check(d.n === 0, `éteint, l'état « ${nom} » est IDENTIQUE à celui sans verre.css (${a.length} éléments relevés${d.n ? ', ' + d.n + ' écarts : ' + d.premieres.join(' / ') : ''})`);
                await fermerTout(sans.page); await fermerTout(avec.page);
            }
            check(await avec.page.evaluate(() => document.documentElement.hasAttribute('data-glass')) === false, 'et aucun attribut data-glass sur <html> quand le verre est éteint');
            check(sans.erreurs.length === 0 && avec.erreurs.length === 0, `aucune erreur JavaScript (${sans.erreurs.length + avec.erreurs.length}) ${sans.erreurs.concat(avec.erreurs).slice(0, 2).join(' | ')}`);
            await sans.contexte.close(); await avec.contexte.close();
        }

        // ===== 3. ALLUMÉ : LE FLOU VA OÙ IL DOIT, ET NULLE PART AILLEURS ===============================================================
        {
            const A = await ouvrirTH(nav, { reglages: VERRE });
            const p = A.page;
            const flou = (sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return 'ABSENT'; return getComputedStyle(e).backdropFilter; }, sel);
            const barres = {};
            for (const s of ['.barre-haut', '.barre-outils', '.transport']) barres[s] = await flou(s);
            check(Object.values(barres).every((v) => /blur\(24px\)/.test(v)), `les trois barres floutent (24 px) : ${JSON.stringify(barres)}`);
            await ETATS.reglages(p);
            check(/blur\(24px\)/.test(await flou('#fenetre-reglages .fenetre')), 'la fenêtre Réglages floute ce qu\'elle recouvre');
            const fen = await p.evaluate(() => { const e = document.querySelector('#fenetre-reglages .fenetre'); const cs = getComputedStyle(e); return { img: cs.backgroundImage, couleur: cs.backgroundColor }; });
            check(/gradient/.test(fen.img) && /rgba\(7, 11, 18, 0\.6\)/.test(fen.couleur), 'les fenêtres ont une sous-couche sombre sous leur teinte (sans elle, la feuille blanche derrière les grisonne)');
            // Les champs sont des creux légers ; les listes déroulantes restent OPAQUES (une liste translucide se lit mal).
            const champs = await p.evaluate(() => {
                const alpha = (c) => { const m = c.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number); return m.length > 3 ? m[3] : 1; };
                const i = getComputedStyle(document.querySelector('input.champ')).backgroundColor, s = document.querySelector('select.champ');
                return { champ: alpha(i), couleur: i, liste: alpha(getComputedStyle(s).backgroundColor) };
            });
            check(champs.couleur === 'rgba(0, 0, 0, 0.22)' && champs.liste === 1, `les champs de saisie sont des creux légers, plus sombres que la page (${champs.couleur}) mais les listes déroulantes restent opaques (${champs.liste})`);
            await fermerTout(p);
            // Le liseré clair du bord haut des boutons (la signature de TrainHub) : sur les familles nommées, pas sur les icônes nues.
            const reflets = await p.evaluate(() => {
                const lisere = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).boxShadow : 'ABSENT'; };
                return { outil: lisere('.btn-outil:not(.actif)'), transport: lisere('.btn-transport'), nue: lisere('.btn-icone:not(.actif):not(.btn-icone-accent)') };
            });
            check(/inset/.test(reflets.outil) && /inset/.test(reflets.transport) && /255, 255, 255, 0\.22\) 0px 1px 0px/.test(reflets.outil), `les boutons ont le reflet clair du bord haut (${reflets.outil.slice(0, 60)}…)`);
            check(reflets.nue === 'none', `mais pas les icônes nues de la barre, qui n'ont pas de cadre (${reflets.nue})`);
            await ETATS.fichiers(p);
            check(/blur\(24px\)/.test(await flou('#popover-fichiers')), 'le menu Fichiers aussi');
            await fermerTout(p);
            const sens = await p.evaluate(() => { const o = {}; for (const s of ['.btn-outil', '.groupe-outils', '.feuille', '.zone-partition', '.feuille svg']) { const e = document.querySelector(s); o[s] = e ? getComputedStyle(e).backdropFilter : 'ABSENT'; } return o; });
            check(Object.entries(sens).every(([s, v]) => v === 'none' || v === 'ABSENT'), `JAMAIS de flou par bouton, par groupe ni sur la feuille : ${JSON.stringify(sens)}`);
            check(/linear-gradient/.test(await p.evaluate(() => getComputedStyle(document.body).backgroundImage)), 'le fond de la page est le dégradé « aurore »');
            const aire = await p.evaluate(() => getComputedStyle(document.querySelector('.zone-partition')).backgroundColor);
            check(aire === 'rgba(0, 0, 0, 0)', `le fond autour de la feuille est transparent (${aire}) : l'aurore doit paraître de chaque côté du papier`);
            // LE PAPIER
            const papier = await p.evaluate(() => { const f = document.querySelector('.feuille'); const cs = getComputedStyle(f); return { fond: cs.backgroundColor, bord: cs.borderTopColor, ombre: cs.boxShadow }; });
            const B = await ouvrirTH(nav, {});
            const papierOff = await B.page.evaluate(() => { const f = document.querySelector('.feuille'); const cs = getComputedStyle(f); return { fond: cs.backgroundColor, bord: cs.borderTopColor, ombre: cs.boxShadow }; });
            check(papier.fond === 'rgb(253, 251, 247)' && JSON.stringify(papier) === JSON.stringify(papierOff), `le PAPIER reste ${papier.fond}, avec son bord et son ombre : exactement comme verre éteint (la feuille n'est jamais en verre)`);
            const cartes = await p.evaluate(() => { const c = getComputedStyle(document.querySelector('.groupe-outils')).backgroundColor; const m = c.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number); return m.length > 3 ? m[3] : 1; });
            check(cartes > 0 && cartes < 0.2, `les groupes d'outils sont TRANSLUCIDES (opacité ${cartes}) : c'est ce qui laisse voir l'aurore`);
            // LE REPLI
            await p.evaluate(() => document.documentElement.style.setProperty('--glass-filter', 'none'));
            const apres = await p.evaluate(() => ['.barre-haut', '.barre-outils', '.transport'].map((s) => getComputedStyle(document.querySelector(s)).backdropFilter));
            check(apres.every((v) => v === 'none'), `repli : --glass-filter à « none » coupe le flou de toutes les surfaces (${apres.join(', ')})`);
            check(A.erreurs.length === 0, `aucune erreur JavaScript (${A.erreurs.length}) ${A.erreurs.slice(0, 2).join(' | ')}`);
            await A.contexte.close(); await B.contexte.close();
        }

        // ===== 4. LE TEXTE RESTE LISIBLE ===========================================================================================
        {
            const off = await ouvrirTH(nav, {});
            const on = await ouvrirTH(nav, { reglages: VERRE });
            const nouveaux = [], pleins = new Set(), sousDegrade = new Set(), opaques = new Set();
            // Hors compte-cloud.js : la pilule, son menu et sa fenêtre sont un composant COMMUN aux trois applis, qui dessine ses propres fonds
            // (opaques, calculés par color-mix — que le navigateur rend en « color(srgb …) », pas en rgb) et ne dépend pas du verre.
            const relever = () => on.page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width && r.height && !b.closest('#compte-cloud, .cc-menu, .cc-voile'); }).map((b) => ({ n: b.className || b.id, c: getComputedStyle(b).backgroundColor })).filter((x) => { const m = x.c.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number); return (m.length > 3 ? m[3] : 1) === 1; }).map((x) => x.n + ' ' + x.c));
            for (const [nom, aller] of Object.entries(ETATS)) {
                await aller(off.page); await aller(on.page);
                for (const x of await relever()) pleins.add(nom + ': ' + x);
                for (const x of await V.boutonsSousDegrade(on.page)) sousDegrade.add(nom + ': ' + x);
                for (const x of await V.boutonsDegradeOpaque(on.page)) opaques.add(nom + ': ' + x);
                const a = await V.contrastesFaibles(off.page), b = await V.contrastesFaibles(on.page);
                for (const f of b) if (!a.some((g) => g.cle === f.cle)) nouveaux.push(`${nom}: ${f.cle} (${f.rapport})`);
                await fermerTout(off.page); await fermerTout(on.page);
            }
            check(pleins.size === 0, `aucun bouton ne garde un fond plein sous le verre, dans aucun des cinq états : tous laissent passer l'aurore (${pleins.size}${pleins.size ? ' : ' + [...pleins].slice(0, 3).join(' ; ') : ''})`);
            check(opaques.size === 0, `ni aucun dégradé de bouton qui finisse sur une couleur pleine — un bouton moitié verre, moitié tuile ardoise (${opaques.size}${opaques.size ? ' : ' + [...opaques].slice(0, 3).join(' ; ') : ''})`);
            check(sousDegrade.size === 0, `et aucun bouton à dégradé ne garde une couleur de fond dessous : le gris du navigateur traverserait le dégradé (${sousDegrade.size}${sousDegrade.size ? ' : ' + [...sousDegrade].slice(0, 3).join(' ; ') : ''})`);
            check(nouveaux.length === 0, `aucun texte devenu illisible par le verre sur cinq états (${nouveaux.length} nouveaux contrastes < 3:1${nouveaux.length ? ' : ' + nouveaux.slice(0, 4).join(' ; ') : ''})`);
            check(await on.page.evaluate(() => getComputedStyle(document.documentElement).colorScheme) === 'dark', 'et le document se dit sombre (color-scheme: dark) : barres de défilement et champs natifs restent sombres');
            await off.contexte.close(); await on.contexte.close();
        }

        // ===== 5. LE RÉGLAGE : Réglages > Apparence ===================================================================================
        {
            const A = await ouvrirTH(nav, {});
            const p = A.page;
            await ETATS.reglages(p);
            const g = await p.evaluate(() => ({
                titre: document.querySelector('#rubrique-apparence h3').textContent, visible: !document.getElementById('rubrique-apparence').hidden,
                interrupteur: document.getElementById('champ-verre').getAttribute('aria-checked'),
                pastilles: [...document.querySelectorAll('#champ-fonds .verre-fond')].map((b) => b.dataset.fond),
                etiquettees: [...document.querySelectorAll('#champ-fonds .verre-fond')].every((b) => b.getAttribute('aria-label') && b.getAttribute('role') === 'radio'),
                cochees: document.querySelectorAll('#champ-fonds .verre-fond[aria-checked="true"]').length,
                estompe: document.getElementById('ligne-fonds').dataset.verre, opacite: getComputedStyle(document.getElementById('champ-fonds')).opacity,
                rondes: [...document.querySelectorAll('#champ-fonds .verre-fond')].every((b) => { const r = b.getBoundingClientRect(); return Math.abs(r.width - r.height) < 1 && r.width <= 48; }),
            }));
            exiger(g.visible && g.titre === 'Apparence', 'Réglages a une rubrique « Apparence »');
            check(g.interrupteur === 'false' && g.estompe === 'off', 'verre éteint par défaut : l\'interrupteur est à l\'arrêt, les pastilles de couleur estompées (elles ne changent rien tant qu\'il est éteint)');
            check(g.pastilles.join() === 'aurora,blue,green,violet,rose,amber,grey' && g.cochees === 1 && g.etiquettees, 'sept pastilles de couleur, une seule cochée, chacune un bouton radio nommé (lecteur d\'écran)');
            check(g.rondes && +g.opacite < 0.6, `les pastilles sont des ronds de 48 px au plus (la règle générique des boutons les élargirait) et verre éteint elles s'estompent (opacité ${g.opacite})`);
            await p.click('#champ-verre'); await p.waitForTimeout(150);
            const allume = await p.evaluate(() => ({ attr: document.documentElement.getAttribute('data-glass'), stocke: localStorage.getItem('tabhub.glass.v1'), coche: document.getElementById('champ-verre').getAttribute('aria-checked'), estompe: document.getElementById('ligne-fonds').dataset.verre, fond: getComputedStyle(document.body).backgroundImage }));
            check(allume.attr === '1' && allume.stocke === '1' && allume.coche === 'true' && allume.estompe === 'on' && /gradient/.test(allume.fond), 'cliquer l\'interrupteur allume le verre tout de suite (rien à recharger), le retient, et rend leur éclat aux pastilles');
            await p.click('#champ-fonds [data-fond="violet"]'); await p.waitForTimeout(150);
            const violet = await p.evaluate(() => ({ attr: document.documentElement.getAttribute('data-glass-bg'), stocke: localStorage.getItem('tabhub.glassBg.v1'), coche: document.querySelector('#champ-fonds [aria-checked="true"]').dataset.fond, bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() }));
            check(violet.attr === 'violet' && violet.stocke === 'violet' && violet.coche === 'violet' && /^hsl\(266/.test(violet.bg), `choisir « violet » change le fond (--bg = ${violet.bg}), le retient, et coche la bonne pastille`);
            const n1 = await p.evaluate(() => window.Verre.nbAbonnes());
            for (let i = 0; i < 4; i++) { await p.evaluate(() => { window.app.fermerFenetres(); window.app.remplirReglages(); window.app.ouvrirFenetre('fenetre-reglages'); }); }
            const n2 = await p.evaluate(() => ({ abonnes: window.Verre.nbAbonnes(), pastilles: document.querySelectorAll('#champ-fonds .verre-fond').length }));
            check(n2.abonnes === n1 && n2.pastilles === 7, `rouvrir quatre fois la fenêtre n'empile ni abonnés (${n1} → ${n2.abonnes}) ni pastilles (${n2.pastilles})`);
            await p.evaluate(() => { localStorage.setItem('tabhub.glassBg.v1', 'rose'); window.dispatchEvent(new StorageEvent('storage', { key: 'tabhub.glassBg.v1', newValue: 'rose' })); });
            await p.waitForTimeout(100);
            const rose = await p.evaluate(() => ({ attr: document.documentElement.getAttribute('data-glass-bg'), coche: document.querySelector('#champ-fonds [aria-checked="true"]').dataset.fond }));
            check(rose.attr === 'rose' && rose.coche === 'rose', 'un réglage changé dans un autre onglet de l\'appareil s\'applique ici et recoche la pastille, sans recharger');
            await p.evaluate(() => { localStorage.setItem('tabhub.glass.v1', '0'); window.dispatchEvent(new StorageEvent('storage', { key: 'tabhub.glass.v1', newValue: '0' })); });
            await p.waitForTimeout(100);
            const eteint = await p.evaluate(() => ({ attr: document.documentElement.hasAttribute('data-glass'), coche: document.getElementById('champ-verre').getAttribute('aria-checked'), ligne: document.getElementById('ligne-fonds').dataset.verre }));
            check(!eteint.attr && eteint.coche === 'false' && eteint.ligne === 'off', 'et l\'interrupteur suit lui aussi (éteint ailleurs, éteint ici, pastilles estompées) — la fenêtre ne ment pas sur l\'état');
            await p.evaluate(() => { localStorage.setItem('tabhub.glass.v1', '1'); window.dispatchEvent(new StorageEvent('storage', { key: 'tabhub.glass.v1', newValue: '1' })); });
            await p.waitForTimeout(100);
            await p.reload({ waitUntil: 'load' }); await p.waitForFunction(PRETE); await p.waitForTimeout(500);
            const apres = await p.evaluate(() => ({ glass: document.documentElement.getAttribute('data-glass'), bg: document.documentElement.getAttribute('data-glass-bg') }));
            check(apres.glass === '1' && apres.bg === 'rose', 'rechargé : le verre est toujours allumé, dans la même couleur');
            await ETATS.reglages(p);
            await p.click('#champ-verre'); await p.waitForTimeout(150);
            check(await p.evaluate(() => !document.documentElement.hasAttribute('data-glass') && localStorage.getItem('tabhub.glass.v1') === '0'), 'l\'éteindre retire l\'attribut : on retrouve le rendu d\'avant');
            check(A.erreurs.length === 0, `aucune erreur JavaScript pendant le réglage (${A.erreurs.length}) ${A.erreurs.slice(0, 2).join(' | ')}`);
            await A.contexte.close();
        }

        // ===== 6. SANS verre.js : pas de commande qui ne ferait rien ====================================================================
        {
            const A = await ouvrirTH(nav, { bloquer: [/verre\.js/] });
            await ETATS.reglages(A.page);
            const r = await A.page.evaluate(() => ({ rubrique: document.getElementById('rubrique-apparence').hidden, verre: typeof window.Verre }));
            check(r.rubrique && r.verre === 'undefined', 'verre.js absent : la rubrique « Apparence » se masque (pas d\'interrupteur qui ne ferait rien)');
            check(A.erreurs.length === 0, `et aucune erreur JavaScript (${A.erreurs.length}) ${A.erreurs.slice(0, 2).join(' | ')}`);
            await A.contexte.close();
        }

        // ===== 7. TÉLÉPHONE ===========================================================================================================
        {
            for (const largeur of [390, 320]) {
                const mesure = (p) => p.evaluate(() => ({ debord: document.documentElement.scrollWidth - document.documentElement.clientWidth, barre: (() => { const b = document.querySelector('.barre-haut'); return b.scrollWidth - b.clientWidth; })() }));
                const off = await ouvrirTH(nav, { viewport: { width: largeur, height: 800 }, tactile: true });
                const on = await ouvrirTH(nav, { viewport: { width: largeur, height: 800 }, tactile: true, reglages: VERRE });
                const a = await mesure(off.page), b = await mesure(on.page);
                check(b.debord <= a.debord && b.barre <= a.barre, `téléphone ${largeur}px : le verre ne fait déborder ni la page (${b.debord}px, ${a.debord}px éteint) ni la barre du haut (${b.barre}px, ${a.barre}px éteint)`);
                await ETATS.reglages(on.page);
                const t = await on.page.evaluate(() => [...document.querySelectorAll('#champ-fonds .verre-fond')].map((e) => { const r = e.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)); }));
                check(t.length === 7 && Math.min(...t) >= 38, `les pastilles de couleur sont assez grandes pour le doigt (${Math.min(...t)} px au minimum sur ${largeur}px)`);
                const hors = await on.page.evaluate(() => [...document.querySelectorAll('#champ-fonds .verre-fond')].some((e) => { const r = e.getBoundingClientRect(); return r.right > innerWidth + 0.5 || r.left < -0.5; }));
                check(!hors, `et aucune ne sort de l'écran à ${largeur}px`);
                await off.contexte.close(); await on.contexte.close();
            }
        }
    } finally { await nav.close(); }
    bilan();
})().catch((e) => { console.error(e); process.exit(1); });
