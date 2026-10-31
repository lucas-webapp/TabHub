// TEST DE PRÉCISION DE LA LECTURE — mesurer, sur LA machine de celui qui entend le défaut, ce que fait vraiment le son.
//
// POURQUOI UN INSTRUMENT PLUTÔT QU'UN CORRECTIF. Retour utilisateur : « le son n'est pas du tout synchronisé avec ce qui
// est écrit [...] deux croches beaucoup plus espacées que les deux croches qui suivent », entendu sur Safari, alors que
// la tête de lecture suit la grille sans décalage. Mesuré ailleurs (Chromium, processeur ralenti jusqu'à six fois), les
// instants de départ des notes sont EXACTS : la partition est programmée en tics sur l'horloge audio, avec 100 ms de
// marge, et la page n'est plus redessinée pendant la lecture. Le défaut, s'il vient du son, ne se voit donc que sur la
// machine qui l'entend — et il y a trois suspects, que seule une mesure sépare :
//
//   1. LA PROGRAMMATION : le rappel qui déclenche une note s'exécute-t-il avant l'instant prévu ? (Safari suspend et
//      cadence ses minuteries autrement que Chrome.) → `retard`, relevé à CHAQUE note.
//   2. LE RENDU : le son devient-il audible à l'instant prévu ? Un piano échantillonné a une attaque, et les notes plus
//      graves que le plus bas échantillon (do 2) sont obtenues en le RALENTISSANT, donc avec une attaque étirée qui
//      varie d'une note à l'autre. → `attaque`, relevée sur la sortie audio elle-même.
//   3. LA SORTIE : la latence de la carte son ou du Bluetooth. Constante, donc sans effet sur les écarts entre notes,
//      mais elle décale le son par rapport à la tête de lecture. → `audio.latenceSortie`, quand le navigateur la dit.
//
// CE QUE LE TEST NE FAIT PAS : il ne change RIEN à la lecture. Il joue le morceau tel quel, avec un crochet sur le
// déclenchement des notes et une écoute de la sortie audio, retirés à la fin quoi qu'il arrive.
//
// L'ANALYSE EST UNE FONCTION PURE (`analyserReleves`), éprouvée sans navigateur sur des signaux fabriqués : c'est elle qui
// transforme « de l'énergie relevée toutes les millisecondes » en « cette note a été entendue 24 ms après l'instant prévu ».

import { aplatir } from '../model/score.js';

/** Durée maximale mesurée : au-delà, on s'arrête et on le dit (le rapport garde alors les premières secondes). */
export const SECONDES_MAX = 24;

/** En dessous de cette énergie (RMS), une note n'est pas « entendue » : trop faible pour dater son attaque. */
const ENERGIE_MIN = 0.0025;

// ---------- statistiques ----------
const moyenne = (t) => t.reduce((a, b) => a + b, 0) / t.length;
function quantile(t, q) {
    if (!t.length) return null;
    const s = [...t].sort((a, b) => a - b);
    const i = (s.length - 1) * q, bas = Math.floor(i), haut = Math.ceil(i);
    return s[bas] + (s[haut] - s[bas]) * (i - bas);
}
const ecartType = (t) => (t.length < 2 ? 0 : Math.sqrt(moyenne(t.map((x) => (x - moyenne(t)) ** 2))));
const arrondi = (x, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/**
 * Pour chaque note déclenchée, DATE son attaque sur la sortie audio.
 *
 * @param journal  [{ note, temps, appel }] — `temps` : l'instant (horloge audio, secondes) où la note doit sonner ;
 *                 `appel` : la valeur de l'horloge audio au moment où le rappel s'est exécuté.
 * @param releves  [[t, energie]] — l'énergie (RMS) de la sortie, relevée à l'horloge audio `t`, triée par `t`.
 * @returns        [{ note, temps, retard, attaque, pic }] — `retard` (ms) : de combien le rappel est en retard sur
 *                 l'instant prévu (0 s'il est à l'heure : la note part alors EXACTEMENT à `temps`) ; `attaque` (ms) :
 *                 le délai, après `temps`, où l'énergie atteint la moitié de son pic — null si la note est trop faible
 *                 pour être datée.
 */
export function analyserReleves(journal, releves) {
    return journal.map((j, i) => {
        const suivant = journal[i + 1] ? journal[i + 1].temps : Infinity;
        // La fenêtre d'une note s'arrête 4 ms avant la suivante : au-delà, on mesurerait l'attaque de l'autre.
        const fin = Math.min(j.temps + 0.15, suivant - 0.004);
        const avant = releves.filter((r) => r[0] >= j.temps - 0.012 && r[0] <= j.temps - 0.002).map((r) => r[1]);
        const fenetre = releves.filter((r) => r[0] >= j.temps - 0.002 && r[0] <= fin);
        const base = avant.length ? Math.min(...avant) : (fenetre.length ? fenetre[0][1] : 0);
        const pic = fenetre.length ? Math.max(...fenetre.map((r) => r[1])) : 0;
        let attaque = null;
        if (pic - base >= ENERGIE_MIN) {
            const seuil = base + 0.5 * (pic - base);
            const premier = fenetre.find((r) => r[1] >= seuil);
            if (premier) attaque = Math.max(0, (premier[0] - j.temps) * 1000);
        }
        return { note: j.note, temps: j.temps, retard: Math.max(0, (j.appel - j.temps) * 1000), attaque, pic };
    });
}

/**
 * Les écarts ENTENDUS entre notes consécutives, comparés aux écarts PROGRAMMÉS : c'est ce que l'oreille juge comme
 * « régulier » ou non. Une paire où l'une des deux notes n'est pas datée est ignorée, de même qu'un écart de plus d'une
 * seconde (un silence long : la question ne se pose plus).
 */
export function ecartsEntendus(mesures) {
    const devs = [];
    for (let i = 1; i < mesures.length; i++) {
        const a = mesures[i - 1], b = mesures[i];
        if (a.attaque === null || b.attaque === null) continue;
        const prevu = b.temps - a.temps;
        if (prevu > 1 || prevu <= 0.0005) continue;
        const entendu = (b.temps + b.attaque / 1000) - (a.temps + a.attaque / 1000);
        devs.push((entendu - prevu) * 1000);
    }
    return devs;
}

/** Les chiffres du rapport, à partir des notes mesurées. */
export function resumer(mesures) {
    const retards = mesures.map((m) => m.retard);
    const attaques = mesures.map((m) => m.attaque).filter((a) => a !== null);
    const devs = ecartsEntendus(mesures);
    return {
        programmation: {
            retardMoyen: arrondi(moyenne(retards)), retardMax: arrondi(Math.max(...retards)), retardP95: arrondi(quantile(retards, 0.95)),
            plusDe10: retards.filter((x) => x > 10).length, plusDe30: retards.filter((x) => x > 30).length,
        },
        attaque: {
            datees: attaques.length, mediane: arrondi(quantile(attaques, 0.5)), p10: arrondi(quantile(attaques, 0.1)), p90: arrondi(quantile(attaques, 0.9)),
            min: arrondi(attaques.length ? Math.min(...attaques) : null), max: arrondi(attaques.length ? Math.max(...attaques) : null),
        },
        ecarts: {
            paires: devs.length, ecartType: arrondi(ecartType(devs)), max: arrondi(devs.length ? Math.max(...devs.map(Math.abs)) : null),
            plusDe15: devs.filter((x) => Math.abs(x) > 15).length,
        },
    };
}

/** Le verdict, en français, de chaque mesure — et ce qu'il faut en conclure. */
export function verdicts(rapport) {
    const out = [];
    const { programmation: p, attaque: a, ecarts: e } = rapport.resume;
    const progOk = p.retardMax <= 15;
    out.push(p.retardMax <= 5
        ? `Programmation : EXACTE. Aucune note n'est partie en retard sur l'horloge audio (retard maximum ${p.retardMax} ms).`
        : progOk
            ? `Programmation : correcte (retard maximum ${p.retardMax} ms, ${p.plusDe10} note(s) au-delà de 10 ms).`
            : `Programmation : EN RETARD. ${p.plusDe10} note(s) sur ${rapport.mesure.notes} sont parties plus de 10 ms trop tard, ${p.plusDe30} plus de 30 ms (maximum ${p.retardMax} ms) : le navigateur n'a pas tenu l'horloge.`);
    if (a.datees < rapport.mesure.notes * 0.6) {
        out.push(`Attaque audible : seulement ${a.datees} note(s) sur ${rapport.mesure.notes} ont pu être datées (son trop faible ou sortie coupée) — monte le volume et recommence.`);
    } else {
        out.push(`Attaque audible : le son devient audible ${a.mediane} ms après l'instant prévu en médiane (entre ${a.p10} et ${a.p90} ms pour 80 % des notes ; de ${a.min} à ${a.max} ms).`);
    }
    if (e.paires >= 4) {
        out.push(e.ecartType <= 6
            ? `Écarts entre notes : RÉGULIERS (écart-type ${e.ecartType} ms sur ${e.paires} paires).`
            : e.ecartType <= 12
                ? `Écarts entre notes : un peu irréguliers (écart-type ${e.ecartType} ms, jusqu'à ${e.max} ms ; ${e.plusDe15} paire(s) au-delà de 15 ms).`
                : `Écarts entre notes : IRRÉGULIERS (écart-type ${e.ecartType} ms, jusqu'à ${e.max} ms ; ${e.plusDe15} paire(s) au-delà de 15 ms) — c'est audible comme une croche trop longue suivie d'une trop courte.`);
    }
    const l = rapport.audio.latenceSortie;
    out.push(l === null
        ? 'Latence de sortie : non fournie par ce navigateur (Safari ne la dit pas). Elle décale tout le son d\'un même retard, sans changer les écarts.'
        : `Latence de sortie : ${l} ms (constante : elle décale le son par rapport à la tête de lecture, sans changer les écarts).`);
    if (rapport.fil.plusLongueSuspension >= 50) {
        out.push(`Le navigateur a été suspendu jusqu'à ${rapport.fil.plusLongueSuspension} ms pendant le test (${rapport.fil.suspensionsPlusDe30} fois plus de 30 ms) : une autre page, un autre programme ou l'économie d'énergie de la machine peuvent en être la cause.`);
    }
    // LA CONCLUSION, selon ce qui est exact et ce qui ne l'est pas.
    if (progOk && e.paires >= 4 && e.ecartType > 6) {
        out.push('CONCLUSION : les notes sont envoyées à l\'heure, mais leur attaque audible varie d\'une note à l\'autre — c\'est le rendu du son (échantillon de piano, notes graves ralenties) qui rend le rythme irrégulier, pas la programmation.');
    } else if (!progOk) {
        out.push('CONCLUSION : le défaut vient de la programmation sur cette machine (rappels en retard) — la lecture doit être précalculée pour ne plus dépendre de la minuterie du navigateur.');
    } else if (e.paires >= 4) {
        out.push('CONCLUSION : à l\'écoute de la machine, la lecture est régulière. Si tu entends encore un décalage, il vient de ce qui est ÉCRIT (silences, mesure trop longue) et non du son.');
    }
    return out;
}

/** Le rapport en texte, prêt à lire ou à copier. */
export function rapportEnTexte(rapport) {
    const L = [];
    const { audio: a, morceau: m, mesure: s } = rapport;
    L.push('TEST DE PRÉCISION DE LA LECTURE — TabHub');
    L.push(`${rapport.date}`);
    L.push(`Navigateur : ${rapport.navigateur}`);
    L.push(`Audio : ${a.tauxEchantillonnage} Hz, marge d'anticipation ${a.lookAhead} ms, latence de base ${a.latenceBase ?? '?'} ms, latence de sortie ${a.latenceSortie ?? 'non fournie'}, contexte « ${a.etat} », son : ${a.source}`);
    L.push(`Morceau : « ${m.titre} », ${m.tempo} bpm (vitesse ${Math.round(m.vitesse * 100)} %), ${s.notes} notes mesurées sur ${s.secondes} s${s.tronque ? ' (arrêté à la limite)' : ''}`);
    L.push('');
    for (const v of rapport.verdicts) L.push('• ' + v);
    L.push('');
    L.push('n°  note   à (s)    retard (ms)  attaque (ms)');
    rapport.notes.slice(0, 60).forEach((n, i) => {
        L.push(`${String(i + 1).padStart(2)}  ${String(n.note).padEnd(5)}  ${String(n.temps).padStart(6)}   ${String(n.retard).padStart(8)}     ${n.attaque === null ? '    —' : String(n.attaque).padStart(5)}`);
    });
    if (rapport.notes.length > 60) L.push(`… (${rapport.notes.length - 60} notes de plus)`);
    return L.join('\n');
}

/**
 * Joue le morceau tel quel et le mesure. Rend `{ fin, arreter }` : `fin` est une promesse du rapport (ou de
 * `{ erreur }` quand le test ne peut pas se faire), `arreter()` interrompt la mesure.
 *
 * DOIT être appelé depuis un geste de l'utilisateur (le contexte audio ne démarre pas autrement — voir Lecteur#demarrer).
 */
export function mesurerLecture(lecteur, partition, { surAvancement = () => {} } = {}) {
    let interrompu = false;
    const arreter = () => { interrompu = true; };
    const fin = (async () => {
        const Tone = globalThis.Tone;
        if (!Tone) return { erreur: 'Tone.js n\'est pas chargé.' };
        if (lecteur.boucleLecture) return { erreur: 'Une boucle de lecture est active : retire-la pour mesurer le morceau entier.' };
        const notes = aplatir(partition).filter((e) => !e.ref.silence && e.ref.notes.length).length;
        if (!notes) return { erreur: 'Le morceau ne contient aucune note : écris quelques notes, puis recommence.' };

        // L'état du lecteur est SAUVÉ puis RESTITUÉ : le test joue sans décompte ni métronome (le clic polluerait la
        // mesure), à la vitesse écrite, et il ne doit laisser aucune trace de ces trois réglages.
        const sauve = { decompte: lecteur.decompteActif, metronome: lecteur.metronomeActif, vitesse: lecteur.vitesse };
        if (lecteur.etat !== 'arret') lecteur.arreter();
        await lecteur.demarrer();
        const raw = Tone.getContext().rawContext;
        const sortie = Tone.getDestination ? Tone.getDestination() : Tone.Destination;

        // Le vrai piano a-t-il fini de charger ? On l'attend un peu : sinon c'est le synthé de secours qu'on mesure.
        const debutAttente = performance.now();
        while (!lecteur.synthe.charge && performance.now() - debutAttente < 4000 && !interrompu) {
            surAvancement({ etape: 'Chargement des sons…' });
            await new Promise((r) => setTimeout(r, 150));
        }

        const synthe = lecteur.synthe;
        const original = synthe.triggerAttackRelease;
        const journal = [];
        const releves = [];
        const analyseur = raw.createAnalyser();
        analyseur.fftSize = 2048;
        const tampon = new Float32Array(2048);
        let ecoute = true;
        let plusLongueSuspension = 0, suspensionsPlusDe30 = 0;
        // Une boucle serrée, qui rend la main au navigateur à chaque tour (MessageChannel : bien plus court qu'un
        // setTimeout, plafonné à 4 ms) et relève l'énergie des 256 derniers échantillons dès que l'horloge audio avance.
        const ceder = () => new Promise((res) => { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); res(); }; c.port2.postMessage(0); });
        const boucle = (async () => {
            let dernier = -1, tPrecedent = performance.now();
            while (ecoute) {
                const maintenant = performance.now();
                const ecart = maintenant - tPrecedent; tPrecedent = maintenant;
                if (ecart > plusLongueSuspension) plusLongueSuspension = ecart;
                if (ecart > 30) suspensionsPlusDe30++;
                const t = raw.currentTime;
                if (t !== dernier) {
                    analyseur.getFloatTimeDomainData(tampon);
                    let somme = 0;
                    for (let k = tampon.length - 256; k < tampon.length; k++) somme += tampon[k] * tampon[k];
                    releves.push([t, Math.sqrt(somme / 256)]);
                    dernier = t;
                }
                await ceder();
            }
        })();

        let secondesJouees = 0, tronque = false;
        try {
            // `in` : une version plus ancienne du lecteur n'a ni décompte ni vitesse de travail — on n'invente pas la propriété.
            if ('decompteActif' in lecteur) lecteur.decompteActif = false;
            if ('metronomeActif' in lecteur) lecteur.metronomeActif = false;
            lecteur.definirVitesse?.(1);
            sortie.connect(analyseur);
            synthe.triggerAttackRelease = function (note, duree, temps, velocite) {
                journal.push({ note, temps, appel: raw.currentTime });
                return original.apply(this, arguments);
            };
            await lecteur.jouer(partition);
            const debut = performance.now();
            // Jusqu'à l'arrêt naturel de la lecture (le lecteur s'arrête seul à la fin du morceau), à la limite, ou à la demande.
            while (lecteur.etat === 'lecture' && !interrompu) {
                secondesJouees = (performance.now() - debut) / 1000;
                if (secondesJouees >= SECONDES_MAX) { tronque = true; break; }
                surAvancement({ etape: 'Mesure en cours…', secondes: secondesJouees });
                await new Promise((r) => setTimeout(r, 200));
            }
            // La dernière note a besoin de sa fenêtre d'écoute : on laisse l'horloge audio avancer d'une demi-seconde.
            await new Promise((r) => setTimeout(r, 450));
        } finally {
            synthe.triggerAttackRelease = original;
            ecoute = false;
            try { await boucle; } catch (e) { /* la boucle d'écoute ne doit pas masquer le reste */ }
            try { sortie.disconnect(analyseur); } catch (e) { /* déjà détaché */ }
            if (lecteur.etat !== 'arret') lecteur.arreter();
            if ('decompteActif' in lecteur) lecteur.decompteActif = sauve.decompte;
            if ('metronomeActif' in lecteur) lecteur.metronomeActif = sauve.metronome;
            if (sauve.vitesse !== undefined) lecteur.definirVitesse?.(sauve.vitesse);
        }

        if (!journal.length) return { erreur: 'Aucune note n\'a été déclenchée pendant la mesure (son coupé ou lecture refusée par le navigateur).' };
        journal.sort((x, y) => x.temps - y.temps);
        const t0 = journal[0].temps;
        // Les statistiques se calculent sur les valeurs BRUTES ; le rapport affiche les valeurs arrondies.
        const brutes = analyserReleves(journal, releves);
        const mesures = brutes.map((n) => ({
            note: n.note, temps: arrondi(n.temps - t0, 3), retard: arrondi(n.retard), attaque: arrondi(n.attaque), pic: arrondi(n.pic, 3),
        }));
        const rapport = {
            version: 1,
            date: new Date().toISOString(),
            navigateur: globalThis.navigator ? navigator.userAgent : '?',
            audio: {
                tauxEchantillonnage: raw.sampleRate,
                lookAhead: arrondi(Tone.getContext().lookAhead * 1000, 0),
                latenceBase: raw.baseLatency === undefined ? null : arrondi(raw.baseLatency * 1000, 0),
                latenceSortie: raw.outputLatency === undefined || raw.outputLatency === 0 ? null : arrondi(raw.outputLatency * 1000, 0),
                etat: raw.state,
                source: lecteur.synthe.charge ? 'piano échantillonné' : 'synthé de secours (les échantillons n\'ont pas chargé)',
            },
            // La vitesse de travail est forcée à 100 % pendant le test : c'est le tempo ÉCRIT qui est mesuré.
            morceau: { titre: partition.meta.titre || 'Sans titre', tempo: lecteur.tempoEcrit ?? partition.meta.tempo, vitesse: 1 },
            mesure: { notes: journal.length, secondes: arrondi(secondesJouees, 1), tronque },
            fil: { plusLongueSuspension: arrondi(plusLongueSuspension, 0), suspensionsPlusDe30 },
            notes: mesures,
            resume: resumer(brutes),
        };
        rapport.verdicts = verdicts(rapport);
        rapport.texte = rapportEnTexte(rapport);
        return rapport;
    })();
    return { fin, arreter };
}
