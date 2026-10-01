// SYNCHRO CLOUD DE TABHUB — l'ADAPTATEUR, branché sur la couche générique synchro-cloud.js (la même que
// celle de HarmoHub, copiée telle quelle : elle ne sait rien des données).
//
// CE QUI DIFFÈRE DE HARMOHUB, ET POURQUOI. HarmoHub a une BIBLIOTHÈQUE de morceaux ; TabHub n'a qu'UN
// BROUILLON, écrasé à chaque changement (voir main.js#planifierBrouillon — « un seul brouillon »). La
// synchro est donc celle de TrainHub, qui a la même structure : UN document au cloud, le plus récent
// gagne. Ce que le cloud garde, c'est la tablature EN COURS, pas l'historique de celles qu'on a faites.
//
// CE QUI EN DÉCOULE, à savoir : « Nouvelle tablature » remplace le document au cloud comme en local. La
// tablature abandonnée reste dans les SAUVEGARDES DE SECOURS de cet appareil (voir ci-dessous) et, bien
// sûr, dans les .json exportés. Le jour où l'on voudra garder toutes ses tablatures au cloud, il faudra
// une vraie bibliothèque — c'est une fonction à part entière, pas un réglage de celle-ci.
//
// L'HORLOGE DE SYNCHRO, ET POURQUOI `meta.modifieLe` NE SERT PAS. `normaliser` (model/score.js) réécrit
// `modifieLe` à l'instant présent à CHAQUE `remplacer` : restauration du brouillon au démarrage, réception
// du cloud, ouverture d'un fichier. Mesuré : après un simple rechargement, un brouillon intact depuis un
// mois portait la date d'aujourd'hui. S'y fier ferait gagner un appareil resté des semaines sans y
// toucher, qui écraserait alors le cloud de sa version périmée. L'arbitrage se fait donc sur une horloge
// À PART (`tabhub.sync.at`), qui ne bouge que pour une VRAIE modification (voir `planifier`) — ni un
// déplacement du curseur, ni un remplacement automatique.
//
// ET UN REMPLACEMENT VOLONTAIRE DOIT GAGNER : importer un .json, restaurer une sauvegarde ou ouvrir un
// MIDI charge un document que le cloud, plus récent, ferait sinon revenir à la première réception.
// `apresRemplacement` date donc l'horloge à l'instant présent : c'est la décision de l'utilisateur.
//
// CE QUI N'EST PAS SYNCHRONISÉ : les réglages (tempo d'affichage, métronome, volumes, position des
// outils…). Chaque appareil garde les siens — un téléphone et un ordinateur n'ont pas les mêmes besoins.

const CLE_BASE = 'tabhub.sync.base';
const CLE_UID = 'tabhub.sync.uid';
const CLE_AT = 'tabhub.sync.at';
const CLE_SAUVEGARDES = 'tabhub.backups.v1';
// Une tablature de 150 mesures pèse de l'ordre de 100 à 300 Ko, et le stockage local est plafonné vers
// 5 Mo : douze copies de secours pourraient à elles seules le remplir et empêcher d'écrire le brouillon
// lui-même. On borne donc en NOMBRE et en POIDS TOTAL.
const SAUVEGARDES_MAX = 8;
const SAUVEGARDES_POIDS_MAX = 2.5 * 1024 * 1024;

// ---------- petits outils ----------
const lireAt = () => { const v = Number(localStorage.getItem(CLE_AT)); return Number.isFinite(v) ? v : 0; };
// Strictement croissante : une horloge qui recule ne doit pas faire perdre la course à une modification
// pourtant plus récente.
const poserAt = (ms) => { const v = Math.max(ms, lireAt() + 1); try { localStorage.setItem(CLE_AT, String(v)); } catch (e) { /* sans gravité */ } return v; };
const fixerAt = (ms) => { try { localStorage.setItem(CLE_AT, String(ms)); } catch (e) { /* sans gravité */ } };

function compterNotes(partition) {
    let n = 0;
    for (const m of (partition && partition.mesures) || []) {
        for (const v of m.voix || []) for (const e of v.evenements || []) n += (e.notes || []).length;
    }
    return n;
}

const titreDe = (partition) => ((partition && partition.meta && partition.meta.titre) || 'Sans titre');

// Un document « vide » : aucune note, aucun titre donné. C'est l'état d'un navigateur neuf — celui qu'une
// connexion ne doit JAMAIS laisser écraser le cloud.
function estVide(partition) {
    const meta = (partition && partition.meta) || {};
    const sansTitre = !meta.titre || meta.titre === 'Sans titre';
    return compterNotes(partition) === 0 && sansTitre && !meta.artiste && !meta.sousTitre;
}

// Sérialisation à clés triées : deux documents de même contenu donnent la même chaîne.
function canonique(v) {
    if (Array.isArray(v)) return '[' + v.map(canonique).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonique(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
}
// Comparer SANS `modifieLe` : deux documents identiques au contenu près ne sont pas « différents » parce
// qu'un appareil a touché la date.
function memeContenu(a, b) {
    const sans = (p) => ({ ...p, meta: { ...(p && p.meta), modifieLe: null } });
    return canonique(sans(a)) === canonique(sans(b));
}

const lire = (cle) => { try { return localStorage.getItem(cle); } catch (e) { return null; } };
const ecrire = (cle, v) => { try { localStorage.setItem(cle, v); return true; } catch (e) { return false; } };

// ---------- sauvegardes de secours (locales à l'appareil) ----------
function lireSauvegardes() {
    try { const l = JSON.parse(lire(CLE_SAUVEGARDES)); return Array.isArray(l) ? l : []; } catch (e) { return []; }
}

// Ajoute UNE copie de secours. Rend faux si le stockage la refuse : l'appelant le DIT, plutôt que de
// laisser croire qu'une copie existe.
function ajouterSauvegarde(partition, raison) {
    if (!partition || estVide(partition)) return true;          // rien à sauver : une tablature vierge n'est pas du travail
    let liste = lireSauvegardes();
    const json = JSON.stringify(partition);
    // Pas deux fois la même : deux sauvegardes identiques à la suite n'apprennent rien.
    if (liste.length && liste[liste.length - 1].json === json) return true;
    liste.push({
        at: Date.now(), raison, titre: titreDe(partition), mesures: (partition.mesures || []).length,
        notes: compterNotes(partition), json,
    });
    // Du plus ancien au plus récent : on retire les plus anciennes d'abord, en nombre puis en poids.
    while (liste.length > SAUVEGARDES_MAX) liste.shift();
    let poids = liste.reduce((t, s) => t + s.json.length, 0);
    while (liste.length > 1 && poids > SAUVEGARDES_POIDS_MAX) poids -= liste.shift().json.length;
    return ecrire(CLE_SAUVEGARDES, JSON.stringify(liste));
}

// ---------- la fusion (PURE) ----------
// local / distant = { partition, at }. `base` = le `at` de cet appareil à sa dernière synchro, ou null.
function fusionnerTablatures(local, distant, base) {
    const sauvegardes = [];
    // Un appareil vide ne prend jamais le pas sur un cloud qui a du contenu, même s'il est plus récent :
    // un navigateur neuf crée son document à l'instant, donc il paraît « le plus récent ».
    const localVide = estVide(local.partition), distantVide = estVide(distant.partition);
    let gagnant;
    if (localVide && !distantVide) gagnant = 'distant';
    else if (distantVide && !localVide) gagnant = 'local';
    else if (distant.at > local.at) gagnant = 'distant';
    else gagnant = 'local';

    // ÉDITION CONCURRENTE : ni l'une ni l'autre des deux versions n'est celle que cet appareil avait à la
    // dernière synchro. Chacune existe seule quelque part, et celle qui perd ne doit pas disparaître.
    const concurrent = !memeContenu(local.partition, distant.partition)
        && base !== local.at && base !== distant.at && !localVide && !distantVide;
    if (concurrent) sauvegardes.push(gagnant === 'distant' ? local.partition : distant.partition);

    const fusionne = gagnant === 'distant' ? distant : local;
    return {
        fusionne,
        changeLocal: gagnant === 'distant' && !memeContenu(local.partition, distant.partition),
        // Rien à écrire quand le cloud a déjà ce contenu (voir synchro-cloud.js : pas d'écriture inutile).
        changeDistant: gagnant === 'local' && !memeContenu(local.partition, distant.partition),
        sauvegardes,
        resume: { gagnant, concurrent },
    };
}

// ---------- passage document Firestore <-> état ----------
// Le document est stocké comme une CHAÎNE JSON : Firestore refuse les tableaux imbriqués et `undefined`,
// et une partition peut en contenir (accordages, sélections…). Une chaîne ne peut pas échouer.
function versDocument(etat) {
    return {
        app: 'TabHub', schema: 1, updatedAt: etat.at,
        titre: titreDe(etat.partition), mesures: (etat.partition.mesures || []).length,
        json: JSON.stringify(etat.partition),
    };
}

function depuisDocument(doc) {
    try {
        const partition = JSON.parse(doc.json);
        if (partition && partition.meta) return { partition, at: Number(doc.updatedAt) || 0 };
    } catch (e) { console.error('Tablature illisible dans le cloud, ignorée :', e); }
    return null;
}

// ---------- démarrage ----------
export function demarrerSynchro(app) {
    if (typeof window.demarrerSynchro !== 'function') return null;     // synchro-cloud.js absent : rien à faire

    const lireEtat = () => ({ partition: app.editeur.partition, at: lireAt() });
    // Un appareil jamais synchronisé n'a pas d'horloge : on lui donne la date RÉELLE de son brouillon,
    // relevée avant que `normaliser` ne la réécrive (voir main.js#restaurerBrouillon).
    if (localStorage.getItem(CLE_AT) === null && Number.isFinite(app._modifieLeBrouillon)) fixerAt(app._modifieLeBrouillon);
    const lireBase = () => { const v = lire(CLE_BASE); return v === null ? null : Number(v); };

    // Applique une version reçue : le MÊME chemin que l'ouverture d'un fichier (arrêter la lecture, puis
    // remplacer), pas un second chemin à tenir à jour.
    function appliquerPartition(partition) {
        app.arreter();
        app.editeur.remplacer(JSON.parse(JSON.stringify(partition)));
    }

    const adaptateur = {
        slug: 'tabhub',
        lire: lireEtat,
        versDocument,
        estVide: (etat) => estVide(etat.partition),
        fusionner(local, distantDoc) {
            const distant = depuisDocument(distantDoc);
            // Un document distant illisible ne doit pas bloquer l'envoi : on le remplace par le nôtre.
            if (!distant) return { fusionne: local, changeLocal: false, sauvegardes: [], resume: {} };
            return fusionnerTablatures(local, distant, lireBase());
        },
        appliquer(etat, resume, origine) {
            appliquerPartition(etat.partition);
            fixerAt(etat.at);   // la version reçue garde SA date : la prendre pour « maintenant » la ferait repartir au cloud
            if (origine === 'reception') app.message(`Mise à jour depuis le cloud : « ${titreDe(etat.partition)} »`, 4000);
        },
        // Après CHAQUE synchro réussie : ce que valait le document, et les copies de secours des perdants.
        apresSynchro(r) {
            ecrire(CLE_BASE, String(lireAt()));
            for (const p of (r && r.sauvegardes) || []) {
                if (!ajouterSauvegarde(p, 'Version remplacée lors d\'une synchronisation')) {
                    app.message('Synchronisé, mais la copie de secours de l\'autre version n\'a pas pu être gardée (stockage plein)', 6000);
                }
            }
            if (r && r.sauvegardes && r.sauvegardes.length) app.message('Deux versions différentes existaient : l\'autre est dans « Sauvegardes de secours »', 7000);
        },
        dejaSynchronise: () => lireBase() !== null,
        surCompte(uid) {
            const precedent = lire(CLE_UID);
            if (precedent && precedent !== uid) { try { localStorage.removeItem(CLE_BASE); } catch (e) { /* sans gravité */ } }
            ecrire(CLE_UID, uid);
        },
        // Les deux côtés ont du contenu et cet appareil n'a jamais été synchronisé : on DEMANDE, au lieu de
        // laisser la date trancher. Le perdant est gardé dans les sauvegardes de secours dans tous les cas.
        async premiereConnexion(local, distantDoc) {
            const distant = depuisDocument(distantDoc);
            if (!distant || memeContenu(local.partition, distant.partition)) return;
            const plusRecent = distant.at > local.at ? 'cloud' : 'appareil';
            const decrire = (s) => `« ${titreDe(s.partition)} » — ${(s.partition.mesures || []).length} mesure(s), ${compterNotes(s.partition)} note(s)`;
            const corps = document.getElementById('corps-synchro-choix');
            const quand = (ms) => ms ? new Date(ms).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : 'date inconnue';
            corps.innerHTML = `
                <div class="version-choix${plusRecent === 'cloud' ? ' plus-recente' : ''}"><strong>Dans le cloud</strong> — ${escapeHtml(decrire(distant))}<br><small>modifiée le ${quand(distant.at)}${plusRecent === 'cloud' ? ' · la plus récente' : ''}</small></div>
                <div class="version-choix${plusRecent === 'appareil' ? ' plus-recente' : ''}"><strong>Sur cet appareil</strong> — ${escapeHtml(decrire(local))}<br><small>modifiée le ${quand(local.at)}${plusRecent === 'appareil' ? ' · la plus récente' : ''}</small></div>`;
            const choisi = (await app.choisirDans('fenetre-synchro-choix')) || plusRecent;   // fermer sans choisir = la plus récente
            if (choisi === 'cloud') {
                ajouterSauvegarde(local.partition, 'Avant remplacement par la version du cloud');
                SYNCHRO.etat.appliqueDistant = true;
                try { appliquerPartition(distant.partition); fixerAt(distant.at); } finally { SYNCHRO.etat.appliqueDistant = false; }
            } else {
                ajouterSauvegarde(distant.partition, 'Version du cloud remplacée par celle de cet appareil');
                // Cette version doit GAGNER : on date l'horloge à maintenant, c'est le choix de l'utilisateur.
                poserAt(Date.now());
            }
        },
    };

    // Le bouton Enregistrer porte la pastille (voir style.css, #btn-enregistrer::after) : la barre du haut
    // déborde déjà de 97 px à 390 px selon le commentaire d'index.html, il n'y a donc de place pour rien
    // de plus. Pas de nœud ajouté — `poserIcones` réécrit le contenu du bouton et l'effacerait.
    const btn = document.getElementById('btn-enregistrer');
    const titreBase = btn ? btn.title : '';
    const synchro = window.demarrerSynchro(adaptateur, {
        statut: null,
        surEtat(mode, libelle, connecte) {
            if (!btn) return;
            if (connecte && mode) { btn.dataset.sync = mode; btn.title = `${titreBase} — ${libelle}`; }
            else { delete btn.dataset.sync; btn.title = titreBase; }
        },
    });

    return {
        synchro,
        // Un changement du document : à appeler depuis planifierBrouillon, avec la RAISON du changement.
        // Un déplacement du curseur n'est pas une modification, et un remplacement du document
        // (restauration au démarrage, réception du cloud) n'en est pas une non plus : ni l'un ni l'autre ne
        // doit dater l'appareil ni partir au cloud.
        planifier(raison) {
            if (raison === 'curseur' || raison === 'document') return;
            poserAt(Date.now());
            if (synchro && synchro.planifierEnvoi) synchro.planifierEnvoi();
        },
        // Avant un remplacement volontaire : la tablature abandonnée part en copie de secours.
        avantRemplacement(raison) { return ajouterSauvegarde(app.editeur.partition, raison); },
        // Après : on date l'horloge à maintenant, sinon le cloud, plus récent, la ferait revenir (voir l'en-tête).
        apresRemplacement() {
            poserAt(Date.now());
            if (synchro && synchro.planifierEnvoi) synchro.planifierEnvoi();
        },
        sauvegardes: lireSauvegardes,
        ajouterSauvegarde,
        compterNotes,
    };
}

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export { fusionnerTablatures, estVide, compterNotes, memeContenu };
