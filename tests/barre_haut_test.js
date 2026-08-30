// Banc de la BARRE DU HAUT — position de Réglages/Aide selon la largeur d'écran.
//
// CE QU'IL PROTÈGE. Réglages/Aide se veulent regroupés contre le logo plutôt que mêlés à
// Annuler/Fichiers (même logique que HarmoHub, dont le bouton Paramètres se place « juste avant le
// titre, plutôt qu'au tout début de la barre du haut ») — mais accolés au logo TOUT COURT, sur un
// téléphone étroit, ils font déborder la barre hors champ (mesuré : 97px à 390px, le titre déjà
// ramené à son plancher de 120px) : exactement le bug que #60/#61 avaient réglé pour Réglages seul.
// `order` (flex, voir style.css) les laisse dans leur position naturelle du DOM (avec Annuler/
// Fichiers, à l'abri) tant qu'il n'y a pas la place, et les déplace contre le logo au-delà de 720px.
// Ce banc éprouve les DEUX régimes, et la frontière entre les deux — un défaut à ce seuil (721px)
// serait invisible à qui n'a testé qu'un téléphone OU qu'un ordinateur, jamais les deux à la fois.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('barre du haut : position Réglages/Aide');

(async () => {
    plan(9);
    const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    try {
        const etat = () => page.evaluate(() => {
            const barre = document.querySelector('.barre-haut');
            const r = id => document.getElementById(id).getBoundingClientRect();
            const rLogo = document.querySelector('.logo').getBoundingClientRect();
            const rReglages = r('btn-reglages');
            const rAide = r('btn-aide');
            const visible = (b) => b.x >= 0 && b.x + b.width <= window.innerWidth;
            return {
                deborde: barre.scrollWidth > barre.clientWidth + 1,
                reglagesVisible: visible(rReglages),
                aideVisible: visible(rAide),
                reglagesAvantLogo: rReglages.x < rLogo.x,
            };
        });

        // --- En dessous de 721px : Réglages/Aide restent dans leur position À L'ABRI (avec
        //     Annuler/Fichiers), jamais accolés au logo -----------------------------------------------
        for (const largeur of [390, 720]) {
            await page.setViewportSize({ width: largeur, height: 844 });
            await page.waitForTimeout(150);
            const e = await etat();
            exiger(!e.deborde, `à ${largeur}px, la barre du haut ne déborde PAS`);
            check(e.reglagesVisible && e.aideVisible, `à ${largeur}px, Réglages ET Aide restent entièrement visibles`);
        }

        // --- À partir de 721px : Réglages/Aide se déplacent contre le logo, sans déborder -----------
        for (const largeur of [721, 1400]) {
            await page.setViewportSize({ width: largeur, height: 844 });
            await page.waitForTimeout(150);
            const e = await etat();
            check(!e.deborde, `à ${largeur}px, la barre du haut ne déborde toujours pas`);
            check(e.reglagesVisible && e.aideVisible && e.reglagesAvantLogo,
                `à ${largeur}px, Réglages et Aide sont visibles, regroupés juste avant le logo`);
        }

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
