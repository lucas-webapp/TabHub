// RETROUVER SES MORCEAUX QUOI QU'IL ARRIVE (src/io/nuage.js : `retrouver`, `restaurer`, et la recherche automatique).
//
// CE QU'IL PROTÈGE. Retour utilisateur : « permets-moi de retrouver mes morceaux quoi qu'il arrive, vu qu'ils seront tous
// enregistrés dans le Firestore. Pour l'instant, je suis obligé de réimporter des JSON ». Chaque morceau a son PROPRE document
// dans Firestore ; l'INDEX n'est que la liste qui les désigne. Quand l'index se perd (écrasé par une autre version de
// l'application qui écrit dans le même document, vidé, jamais créé), les morceaux sont toujours là mais la fenêtre du nuage ne
// montre plus rien — d'où les fichiers à réimporter. Le moteur doit alors les retrouver SEUL, sans jamais :
//   • réécrire un morceau (ses documents ne sont que LUS) ;
//   • rajeunir, remplacer ou ressusciter une entrée existante — y compris une suppression voulue ;
//   • coûter une lecture de toute la collection à chaque ouverture (seulement quand l'index arrive vide, ou sur demande).
// Et une suppression se défait depuis l'application (`restaurer`), au lieu de la console Firebase.
//
// Sans navigateur : deux « appareils » sur un même faux nuage, comme tests/nuage_moteur_test.js.
const creerHarnais = require('./_harness.js');
const { check, exiger, plan, bilan } = creerHarnais('retrouver ses morceaux');
const { creerBackend, creerFirebase } = require('./_firebase_factice.js');
require('../src/io/nuage.js');
const Nuage = globalThis.Nuage;

plan(34);

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
async function jusqua(cond, ms = 2500) { const fin = Date.now() + ms; while (Date.now() < fin) { if (cond()) return true; await attendre(8); } return !!cond(); }
const stockageMemoire = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };

const UID = 'u1';
const CHEMIN_INDEX = `users/${UID}/apps/tabhub`;
const chemin = (id) => `users/${UID}/apps/tabhub__${id}`;
const donnees = (id, titre) => ({ meta: { creeLe: id, titre }, mesures: [{ id: 'm' + id }] });
/** Un morceau tel que le moteur l'écrit : son document à lui. */
function poserMorceau(backend, id, titre, u = 1000) { backend.docs[chemin(id)] = { id, t: titre, u, json: JSON.stringify(donnees(id, titre)) }; }
/** Une entrée d'index. */
const entree = (id, titre, u = 1000, d = false) => ({ t: titre, u, i: id, d });

/** Un appareil TabHub : aucun morceau local (on les LISTE, on ne les ouvre pas d'office), un moteur, et ce qu'il a vu passer. */
function appareil(backend, options = {}) {
    const docs = options.docs || {};
    const vu = { catalogues: [], retrouves: [], erreurs: [] };
    const moteur = Nuage.creer({
        slug: 'tabhub', firebase: creerFirebase(backend, { uid: UID, ...(options.compte || {}) }), config: {}, stockage: stockageMemoire(),
        delaiEnvoi: 10, reessais: [25, 25, 25],
        adaptateur: {
            miroirComplet: false, suppressionParDisparition: false,
            lister: () => Object.values(docs).map((d) => ({ id: d.meta.creeLe, titre: d.meta.titre, donnees: d })),
            lire: (id) => docs[id], ecrire: (id, d) => { docs[id] = JSON.parse(JSON.stringify(d)); }, retirer: (id) => { delete docs[id]; },
            empreinte: (d) => JSON.stringify(d), nouvelleCopie: (d, suf) => ({ id: d.meta.creeLe + 'c', titre: d.meta.titre + suf, donnees: d }),
        },
        surCatalogue: (c) => vu.catalogues.push(c),
        surRetrouves: (r) => vu.retrouves.push(r),
        ...(options.moteur || {}),
    });
    moteur.demarrer();
    return { moteur, docs, vu };
}
const connecte = async (a) => { await a.moteur.connecter(); await jusqua(() => a.moteur.etat().connecte); };
const vivants = (a) => a.moteur.catalogue().filter((e) => !e.supprime);

(async () => {
    const bruit = console.error; console.error = () => {};      // les erreurs réseau simulées sont attendues
    try {
        // ===== 1. L'INDEX A DISPARU, LES MORCEAUX SONT LÀ : ILS REVIENNENT SEULS ==================================
        {
            const nuage = creerBackend();
            poserMorceau(nuage, 'a', 'Premier', 1000); poserMorceau(nuage, 'b', 'Deuxième', 2000); poserMorceau(nuage, 'c', 'Troisième', 3000);
            const A = appareil(nuage);
            await connecte(A);
            exiger(await jusqua(() => vivants(A).length === 3), 'index perdu, trois morceaux dans le nuage : la liste les montre tous les trois, sans rien importer');
            check(vivants(A).map((e) => e.titre).join() === 'Troisième,Deuxième,Premier', 'du plus récent au plus ancien, avec leurs titres');
            check(A.vu.retrouves.length === 1 && A.vu.retrouves[0].retrouves === 3, `l'interface est PRÉVENUE de ce qui a été retrouvé (${A.vu.retrouves.map((r) => r.retrouves).join()})`);
            const idx = nuage.docs[CHEMIN_INDEX];
            check(idx && Object.keys(idx.docs).length === 3 && Object.values(idx.docs).every((e) => e.d === false), 'l\'index est RECONSTRUIT dans le nuage, entrées vivantes');
            check(nuage.journal.filter((c) => c.indexOf('__') >= 0).length === 0, 'aucun document de morceau n\'a été réécrit : ils ne sont que LUS');
            check(A.docs.a === undefined, 'et rien n\'est ouvert d\'office (TabHub liste, il n\'ouvre pas cinquante onglets)');
            // un second appareil, ensuite : il n'a plus rien à retrouver, et n'y dépense pas une lecture de la collection
            const B = appareil(nuage);
            await connecte(B);
            await jusqua(() => vivants(B).length === 3);
            check(B.vu.retrouves.length === 0, 'un autre appareil, ensuite, trouve l\'index en ordre : aucune recherche à refaire');
        }

        // ===== 2. UN COMPTE NEUF : RIEN À RETROUVER, RIEN D'ÉCRIT ===========================================
        {
            const nuage = creerBackend();
            const A = appareil(nuage);
            await connecte(A); await attendre(120);
            check(vivants(A).length === 0 && A.vu.retrouves.length === 0 && nuage.ecritures === 0, 'un compte neuf : aucun morceau retrouvé, et RIEN n\'est écrit dans le nuage');
        }

        // ===== 3. L'INDEX EXISTE MAIS EN OUBLIE UN : LA RECHERCHE EST À LA DEMANDE ==============================
        {
            const nuage = creerBackend();
            poserMorceau(nuage, 'a', 'Premier'); poserMorceau(nuage, 'b', 'Deuxième'); poserMorceau(nuage, 'c', 'Troisième');
            nuage.docs[CHEMIN_INDEX] = { docs: { a: entree('a', 'Premier', 1111), b: entree('b', 'Deuxième', 2222) }, maj: 2222 };
            const A = appareil(nuage);
            await connecte(A); await attendre(120);
            check(vivants(A).length === 2 && A.vu.retrouves.length === 0, 'index non vide : PAS de lecture automatique de toute la collection (elle coûte tous les morceaux), l\'oubli reste invisible…');
            const r = await A.moteur.retrouver();
            check(r.retrouves === 1 && r.titres[0] === 'Troisième' && vivants(A).length === 3, '…jusqu\'à ce qu\'on la demande : « Retrouver mes morceaux » ajoute le morceau oublié');
            const idx = nuage.docs[CHEMIN_INDEX].docs;
            check(idx.a.u === 1111 && idx.b.u === 2222 && idx.a.t === 'Premier', 'les entrées existantes ne sont NI rajeunies NI remplacées');
            const r2 = await A.moteur.retrouver();
            check(r2.retrouves === 0, 'une seconde recherche ne trouve plus rien : elle ne duplique pas');
        }

        // ===== 4. UNE SUPPRESSION VOULUE N'EST JAMAIS RESSUSCITÉE ======================================
        {
            const nuage = creerBackend();
            poserMorceau(nuage, 'a', 'Gardé'); poserMorceau(nuage, 'z', 'Supprimé volontairement');
            nuage.docs[CHEMIN_INDEX] = { docs: { a: entree('a', 'Gardé', 1000), z: entree('z', 'Supprimé volontairement', 1500, true) }, maj: 1500 };
            const A = appareil(nuage);
            await connecte(A); await attendre(100);
            await A.moteur.retrouver();
            const z = A.moteur.catalogue().find((e) => e.id === 'z');
            check(z && z.supprime === true && vivants(A).length === 1, 'un morceau supprimé volontairement reste supprimé après la recherche : c\'est une décision, pas un oubli');
        }

        // ===== 5. RESTAURER ======================================================================
        {
            const nuage = creerBackend();
            poserMorceau(nuage, 'z', 'Par erreur', 1000);
            nuage.docs[CHEMIN_INDEX] = { docs: { z: entree('z', 'Par erreur', 1500, true) }, maj: 1500 };
            const A = appareil(nuage), B = appareil(nuage);
            await connecte(A); await connecte(B); await attendre(120);
            const avant = JSON.stringify(nuage.docs[chemin('z')]);
            await A.moteur.restaurer('z');
            const e = A.moteur.catalogue().find((x) => x.id === 'z');
            check(e && e.supprime === false && e.maj > 1500, 'restaurer rend le morceau à la liste, avec une date strictement postérieure à sa suppression');
            check(JSON.stringify(nuage.docs[chemin('z')]) === avant, 'son contenu n\'a pas bougé d\'un octet : il n\'avait jamais quitté son document');
            check(await jusqua(() => vivants(B).some((x) => x.id === 'z')), 'et l\'autre appareil le voit revenir, tout seul');
            let refus = null; try { await A.moteur.restaurer('inconnu'); } catch (err) { refus = err; }
            check(refus && /pas dans l'index/.test(refus.message), 'restaurer un morceau que l\'index ne connaît pas est refusé, et dit pourquoi');
            // supprimer puis restaurer, bout à bout : le morceau ne reste pas « supprimé » quand on le modifie ensuite
            await A.moteur.supprimer('z', 'Par erreur');
            check(A.moteur.catalogue().find((x) => x.id === 'z').supprime === true, 'supprimer puis…');
            await A.moteur.restaurer('z');
            check(A.moteur.catalogue().find((x) => x.id === 'z').supprime === false && nuage.docs[CHEMIN_INDEX].docs.z.d === false, '…restaurer : l\'index porte `d: false` EXPLICITE (une fusion ne retire pas un champ absent)');
        }

        // ===== 6. CE QUI N'EST PAS UN MORCEAU DE CETTE APPLICATION =================================
        {
            const nuage = creerBackend();
            poserMorceau(nuage, 'a', 'Le mien');
            nuage.docs[`users/${UID}/apps/harmohub__x`] = { id: 'x', t: 'Une grille d\'accords', u: 1, json: '{}' };   // une autre application
            nuage.docs[`users/${UID}/apps/tabhub__abime`] = { id: 'abime', t: 'Sans contenu', u: 1 };                   // un document sans `json`
            nuage.docs[`users/${UID}/apps/autre`] = { json: '{}' };
            const A = appareil(nuage);
            await connecte(A);
            await jusqua(() => A.vu.retrouves.length === 1);
            check(vivants(A).length === 1 && vivants(A)[0].titre === 'Le mien', 'seuls les documents de CETTE application et qui contiennent un morceau sont retrouvés (pas une grille d\'accords de HarmoHub, pas un document vide)');
        }

        // ===== 7. L'INDEX ÉTAIT UN BROUILLON D'UNE AUTRE VERSION ===============================================
        {
            // La version « brouillon unique » de TabHub écrit dans le MÊME document `tabhub` : un brouillon, pas un index.
            const nuage = creerBackend();
            poserMorceau(nuage, 'a', 'Premier'); poserMorceau(nuage, 'b', 'Deuxième');
            nuage.docs[CHEMIN_INDEX] = { app: 'TabHub', schema: 1, updatedAt: 5, titre: 'Brouillon', mesures: 4, json: '{"meta":{}}' };
            const A = appareil(nuage);
            await connecte(A);
            exiger(await jusqua(() => vivants(A).length === 2), 'le document d\'index est un BROUILLON d\'une autre version : les deux morceaux sont retrouvés quand même');
            check(nuage.docs[CHEMIN_INDEX].json === '{"meta":{}}' && nuage.docs[CHEMIN_INDEX].docs && Object.keys(nuage.docs[CHEMIN_INDEX].docs).length === 2,
                'et le brouillon n\'est pas détruit : l\'index s\'y ajoute par fusion');
        }

        // ===== 8. PANNES ===============================================================================
        {
            const nuage = creerBackend();
            poserMorceau(nuage, 'a', 'Premier');
            const A = appareil(nuage, { moteur: {} });
            await connecte(A); await jusqua(() => vivants(A).length === 1);
            nuage.echec = { code: 'unavailable', message: 'réseau' };
            let erreur = null; try { await A.moteur.retrouver(); } catch (e) { erreur = e; }
            check(!!erreur, 'réseau coupé : la recherche échoue FRANCHEMENT (elle ne prétend pas n\'avoir rien trouvé)');
            nuage.echec = null;
            check(vivants(A).length === 1, 'et l\'index déjà connu n\'est pas touché');
            // avant que le nuage n'ait répondu : la recherche refuse, plutôt que de croire l'index vide
            const nuage2 = creerBackend(); nuage2.retardInstantane = 400; poserMorceau(nuage2, 'a', 'Premier');
            const T = appareil(nuage2);
            await T.moteur.connecter(); await jusqua(() => T.moteur.etat().connecte);
            let tot = null; try { await T.moteur.retrouver(); } catch (e) { tot = e; }
            check(tot && /pas encore répondu/.test(tot.message), 'avant la réponse du nuage, « retrouver » refuse : elle ressusciterait des morceaux supprimés qu\'elle ne connaît pas encore');
            let hors = null; const D = appareil(creerBackend()); try { await D.moteur.retrouver(); } catch (e) { hors = e; }
            check(hors && /Non connecté/.test(hors.message), 'sans connexion : « Non connecté »');
        }

        // ===== 9. LA SESSION SUIVANTE : LA RECHERCHE AUTOMATIQUE REPART ===========================================
        {
            const nuage = creerBackend();
            poserMorceau(nuage, 'a', 'Premier');
            const A = appareil(nuage);
            await connecte(A); await jusqua(() => A.vu.retrouves.length === 1);
            // l'index est de nouveau perdu pendant que l'application tourne, puis on se reconnecte
            delete nuage.docs[CHEMIN_INDEX];
            await A.moteur.deconnecter(); await jusqua(() => !A.moteur.etat().connecte);
            await connecte(A);
            check(await jusqua(() => A.vu.retrouves.length === 2), 'se déconnecter puis se reconnecter relance la recherche automatique (un index perdu entre-temps est retrouvé)');
        }

        // ===== 10. L'IDENTITÉ D'UN MORCEAU RETROUVÉ EST CELLE QU'IL PORTE, PAS LE NOM DE SON DOCUMENT ==============
        {
            // Un identifiant TabHub est une date ISO ; le nom du document en est une version « sûre » (les « : » et « . » deviennent « - »).
            const nuage = creerBackend();
            const ISO = '2026-03-04T05:06:07.000Z', cle = ISO.replace(/[^A-Za-z0-9_-]/g, '-');
            nuage.docs[`users/${UID}/apps/tabhub__${cle}`] = { id: ISO, t: 'Riff daté', u: 1000, json: JSON.stringify(donnees(ISO, 'Riff daté')) };
            const A = appareil(nuage);
            await connecte(A);
            exiger(await jusqua(() => vivants(A).length === 1), 'un morceau dont l\'identifiant est une date ISO est retrouvé');
            check(vivants(A)[0].id === ISO, `et il garde SON identifiant (${vivants(A)[0].id}), pas le nom de son document`);
            check(nuage.docs[CHEMIN_INDEX].docs[cle] && nuage.docs[CHEMIN_INDEX].docs[cle].i === ISO, 'l\'entrée d\'index nomme ce même identifiant : de quoi le rouvrir');
            await A.moteur.ouvrirDistant(ISO);
            check(A.docs[ISO] && A.docs[ISO].meta.titre === 'Riff daté', 'et « Ouvrir » va bien chercher le bon document');
        }

        // ===== 11. L'ÉCHO DU SERVEUR TARDE : LA LISTE EST DÉJÀ À JOUR ==========================================
        {
            const nuage = creerBackend();
            poserMorceau(nuage, 'a', 'Premier'); poserMorceau(nuage, 'b', 'Deuxième');
            nuage.docs[CHEMIN_INDEX] = { docs: { a: entree('a', 'Premier', 1111) }, maj: 1111 };
            const A = appareil(nuage);
            await connecte(A); await jusqua(() => vivants(A).length === 1);
            nuage.sansEcho = true;                        // plus aucun instantané ne revient tant que ce drapeau est levé
            const avant = A.vu.catalogues.length;
            await A.moteur.retrouver();
            check(vivants(A).length === 2 && A.vu.catalogues.length > avant, 'une recherche réussie met la liste à jour ET prévient l\'interface, sans attendre l\'écho du serveur');
            await A.moteur.supprimer('a', 'Premier');
            const apresSuppression = A.vu.catalogues.length;
            await A.moteur.restaurer('a');
            check(vivants(A).some((e) => e.id === 'a') && A.vu.catalogues.length > apresSuppression, 'restaurer rend le morceau à la liste ET prévient l\'interface, sans attendre l\'écho non plus');
            nuage.sansEcho = false;
        }

        // ===== 12. UN INDEX VIDE QUI RESTE VIDE NE COÛTE QU'UNE LECTURE ======================================
        {
            const nuage = creerBackend();
            const A = appareil(nuage);
            await connecte(A); await attendre(80);
            const lectures = nuage.listages;
            for (let i = 0; i < 3; i++) { nuage.notifier(CHEMIN_INDEX); await attendre(40); }
            check(lectures === 1 && nuage.listages === 1, `un compte neuf : la collection est lue UNE fois par séance, pas à chaque instantané (${nuage.listages})`);
        }
    } finally { console.error = bruit; }
    bilan();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
