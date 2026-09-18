// Banc des PROTECTIONS DU TRAVAIL — stockage durable, rappel de fraîcheur, partage système.
//
// CE QU'IL PROTÈGE. Le brouillon du navigateur protège d'un rechargement accidentel. Il ne protège
// PAS d'un navigateur qui vide son stockage pour faire de la place, d'un mode privé, ni d'un
// téléphone qu'on change. Et rien ne le dit : tout marche, jusqu'au jour où plus rien n'est là.
// Ces trois mécanismes, portés de HarmoHub, s'attaquent chacun à une moitié du problème.
//
//   `persist()`        — demander au navigateur de ne PAS vider ce stockage.
//   RAPPEL DE FRAÎCHEUR — dire, au bout de cinq jours sans fichier, que le travail n'existe qu'ici.
//   FEUILLE DE PARTAGE  — sur iPhone, où rien ne range automatiquement, proposer « Enregistrer dans
//                         Fichiers » avant de télécharger à l'aveugle.
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('protections du travail');

(async () => {
    plan(15);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // ─────────── Stockage durable ───────────
        const durable = await page.evaluate(async () => {
            const f = await import('/src/io/fichiers.js');
            const vrai = navigator.storage;
            const appels = [];
            Object.defineProperty(navigator, 'storage', {
                configurable: true,
                value: { persisted: async () => { appels.push('persisted'); return false; },
                         persist: async () => { appels.push('persist'); return true; } },
            });
            const r = await f.demanderStockageDurable();
            Object.defineProperty(navigator, 'storage', { configurable: true, value: vrai });
            return { r, appels };
        });
        check(durable.r === true && durable.appels.join(',') === 'persisted,persist',
            `on DEMANDE le stockage durable, et seulement s'il ne l'est pas déjà — sans quoi le brouillon et l'historique vivent dans un stockage que le navigateur peut vider silencieusement (lu : ${durable.appels.join(', ')})`);
        const sansApi = await page.evaluate(async () => {
            const f = await import('/src/io/fichiers.js');
            const vrai = navigator.storage;
            Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
            const r = await f.demanderStockageDurable();
            Object.defineProperty(navigator, 'storage', { configurable: true, value: vrai });
            return r;
        });
        check(sansApi === false,
            'et un navigateur sans cette API rend `false` sans lever — refuser n\'est pas une panne, c\'est le cas courant');

        // ─────────── Rappel de fraîcheur ───────────
        const neuf = await page.evaluate(() => {
            localStorage.removeItem('tabhub.dernierFichier');
            localStorage.removeItem('tabhub.dernierRappelFraicheur');
            const alerte = window.app.verifierFraicheur();
            return { alerte, repere: !!localStorage.getItem('tabhub.dernierFichier') };
        });
        check(neuf.alerte === false && neuf.repere,
            'PREMIÈRE OUVERTURE : le repère est posé, et AUCUN avertissement. Quelqu\'un qui vient d\'arriver n\'a rien à mettre à l\'abri, et l\'accueillir par une alerte est le meilleur moyen de la lui faire ignorer pour toujours');

        const recent = await page.evaluate(() => {
            localStorage.setItem('tabhub.dernierFichier', String(Date.now() - 2 * 86400000));
            localStorage.removeItem('tabhub.dernierRappelFraicheur');
            return window.app.verifierFraicheur();
        });
        check(recent === false, 'DEUX JOURS : rien. En deçà de cinq, le rappel serait du bruit');

        const vieux = await page.evaluate(() => {
            localStorage.setItem('tabhub.dernierFichier', String(Date.now() - 9 * 86400000));
            localStorage.removeItem('tabhub.dernierRappelFraicheur');
            const alerte = window.app.verifierFraicheur();
            return { alerte, message: document.getElementById('message')?.textContent || '' };
        });
        check(vieux.alerte === true && /9 jours/.test(vieux.message) && /n'existe que dans ce navigateur/.test(vieux.message),
            `NEUF JOURS SANS FICHIER : l'avertissement paraît, et il DIT la vérité — le travail n'est nulle part ailleurs (lu : « ${vieux.message.slice(0, 80)}… »)`);
        check(/Exporter en \.json/.test(vieux.message),
            'et il nomme le geste qui règle le problème, au lieu de laisser chercher');

        const deuxieme = await page.evaluate(() => window.app.verifierFraicheur());
        check(deuxieme === false,
            'UN RAPPEL PAR JOUR AU PLUS : un avertissement qui revient à chaque ouverture cesse d\'être lu au bout de deux fois');

        const apresExport = await page.evaluate(() => {
            localStorage.setItem('tabhub.dernierFichier', String(Date.now() - 9 * 86400000));
            window.app.marquerFichierEcrit();
            localStorage.removeItem('tabhub.dernierRappelFraicheur');
            return { alerte: window.app.verifierFraicheur(),
                     ecart: Date.now() - Number(localStorage.getItem('tabhub.dernierFichier')) };
        });
        check(apresExport.alerte === false && apresExport.ecart < 5000,
            'et écrire un fichier remet le compteur à zéro — c\'est le seul geste qui le doit');

        // ─────────── Le repère se pose sur visibilitychange, pas sur beforeunload ───────────
        const repere = await page.evaluate(async () => {
            localStorage.removeItem('tabhub.derniereSeance');
            document.dispatchEvent(new Event('visibilitychange'));
            const enVue = localStorage.getItem('tabhub.derniereSeance');
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
            document.dispatchEvent(new Event('visibilitychange'));
            const cache = localStorage.getItem('tabhub.derniereSeance');
            delete document.visibilityState;
            const src = await (await fetch('/src/main.js')).text();
            return { enVue, cache: !!cache,
                     ecritLeBrouillon: /visibilitychange[\s\S]{0,900}_ecrireBrouillon\(\)/.test(src) };
        });
        check(repere.enVue === null && repere.cache,
            'LE REPÈRE SE POSE SUR `visibilitychange`, quand la page passe en ARRIÈRE-PLAN — et non sur `beforeunload`, qui n\'arrive PAS sur iOS : là on ne ferme pas un onglet, on passe à autre chose, et un repère posé à la seule fermeture ne le serait jamais là où il compte le plus');
        check(!repere.ecritLeBrouillon,
            'ET C\'EST UN REPÈRE, PAS LE BROUILLON. J\'avais d\'abord écrit le brouillon ici, et le banc des onglets l\'a fait tomber : un rechargement fait passer la page par `hidden`, donc l\'ancienne page écrivait son état PAR-DESSUS le brouillon que la nouvelle s\'apprêtait à relire — un brouillon d\'avant les onglets était détruit au premier rechargement, en silence');

        const vacances = await page.evaluate(() => {
            localStorage.setItem('tabhub.dernierFichier', String(Date.now() - 9 * 86400000));
            localStorage.setItem('tabhub.derniereSeance', String(Date.now() - 20 * 86400000));
            localStorage.removeItem('tabhub.dernierRappelFraicheur');
            return window.app.verifierFraicheur();
        });
        check(vacances === false,
            'ET ON N\'AVERTIT PAS QUELQU\'UN QUI N\'A PAS TRAVAILLÉ : si la dernière séance est plus ancienne que le dernier fichier, rien n\'a été écrit depuis l\'export. Cinq jours sans fichier après des vacances ne sont pas un risque');

        // ─────────── La feuille de partage ───────────
        const partage = await page.evaluate(async () => {
            const f = await import('/src/io/fichiers.js');
            const recus = [];
            navigator.canShare = (d) => !!(d && d.files && d.files.length);
            navigator.share = async (d) => { recus.push(Object.keys(d).sort().join(',')); };
            const r = await f.enregistrerFichier('abc', { nom: 'T.json', racine: null, typeMime: 'application/json' });
            return { range: r.range, recus, message: f.messageEnregistrement(r, 'Exporté') };
        });
        check(partage.range === 'partage' && partage.recus.length === 1,
            `SUR UN APPAREIL QUI SAIT PARTAGER, on propose la feuille AVANT de télécharger à l'aveugle : c'est l'iPhone, c'est-à-dire précisément l'appareil où rien ne range automatiquement — mais où « Enregistrer dans Fichiers » mène à iCloud Drive (lu : ${partage.range})`);
        check(partage.recus[0] === 'files',
            `ON NE PASSE QUE \`files\` : ajouter \`title\` ou \`text\` fait ÉCHOUER le partage sur iOS, le système refusant la combinaison au lieu de laisser tomber ce qu'il ne sait pas faire (lu : ${partage.recus[0]})`);

        const renonce = await page.evaluate(async () => {
            const f = await import('/src/io/fichiers.js');
            let telecharge = false;
            const vraiCreer = document.createElement.bind(document);
            document.createElement = (t) => { const e = vraiCreer(t); if (t === 'a') { const c = e.click.bind(e); e.click = () => { telecharge = true; c(); }; } return e; };
            navigator.canShare = () => true;
            navigator.share = async () => { const e = new Error('non'); e.name = 'AbortError'; throw e; };
            const r = await f.enregistrerFichier('abc', { nom: 'T2.json', racine: null, typeMime: 'application/json' });
            document.createElement = vraiCreer;
            return { annule: r.annule, telecharge, message: f.messageEnregistrement(r, 'Exporté') };
        });
        check(renonce.annule === true && renonce.telecharge === false,
            'RENONCER AU PARTAGE N\'EST PAS UNE PANNE, et ne doit pas déclencher un téléchargement furtif derrière : fermer la feuille sans choisir, c\'est changer d\'avis');
        check(/annulé/.test(renonce.message),
            `et le message le DIT, au lieu d'annoncer un export qui n'a pas eu lieu (lu : « ${renonce.message} »)`);

        check(erreurs.length === 0, `aucune erreur JavaScript${erreurs.length ? ' — ' + erreurs.join(' | ') : ''}`);
    } finally { await fermer(); }
    bilan();
})();
