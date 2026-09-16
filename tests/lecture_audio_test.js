// Banc de la LECTURE AUDIO et de la TÊTE DE LECTURE.
//
// Un banc automatique n'entend rien : il ne peut pas dire si le son est juste. Ce qu'il PEUT établir,
// c'est tout le reste — et c'est là que sont les vrais défauts de ce genre de module : le transport
// avance-t-il vraiment ? le trait suit-il la position réelle du transport, ou une minuterie parallèle
// qui dérivera ? les liaisons de prolongation sont-elles fusionnées, ou la note est-elle réattaquée
// là où la notation dit qu'elle ne doit pas l'être ? un changement de tempo réétire-t-il l'ensemble ?

const creerHarnais = require('./_harness.js');
const { ouvrirApp, taper, lireEtat } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('lecture audio');

(async () => {
    plan(39);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        await page.click('[data-action="duree4"]');
        await page.evaluate(() => document.getElementById('zone-partition').focus());
        await taper(page, ['Digit0', 'ArrowRight', 'Digit2', 'ArrowRight', 'Digit3', 'ArrowRight', 'Digit5']);

        // --- Le son : Sampler (piano échantillonné, comme HarmoHub) + doublure synthétisée -----------
        // Ce banc ne peut pas juger la qualité du SON — mais il peut vérifier que l'interface tient sa
        // promesse : jamais d'exception, même quand l'échantillonneur ne charge jamais (offline, hôte
        // bloqué — exactement ce qui arrive dans cet environnement d'essai, voir _page.js). C'est
        // d'ailleurs CE chemin, la doublure, que tout le reste de ce banc exerce forcément ici.
        const sonde = await page.evaluate(async () => {
            const lecteur = window.app.lecteur;
            await lecteur.demarrer();
            let jamaisLeve = true;
            try { lecteur.apercu(60); lecteur.synthe.releaseAll(); } catch (e) { jamaisLeve = false; }
            return { pret: lecteur.pret, formeCorrecte: typeof lecteur.synthe.triggerAttackRelease === 'function', jamaisLeve };
        });
        exiger(sonde.pret, 'demarrer() prépare bien le lecteur (contexte audio + synthé/échantillonneur)');
        check(sonde.formeCorrecte, 'le synthé expose triggerAttackRelease, que ce soit l\'échantillonneur ou la doublure qui réponde');
        check(sonde.jamaisLeve, 'un aperçu de note ne lève jamais, même si l\'échantillonneur n\'a pas fini de charger (ou jamais, hors ligne)');

        // --- La programmation : ce qui sera réellement joué ------------------------------------------
        const programme = await page.evaluate(async () => {
            await window.app.lecteur.demarrer();
            window.app.lecteur.programmer(window.app.editeur.partition);
            return window.app.lecteur._evenements.map(e => ({ d: e.debut, l: e.duree, n: e.note, v: +e.velocite.toFixed(2) }));
        });
        exiger(programme.length === 4, 'les quatre notes saisies sont programmées');
        check(programme.map(e => e.d).join(',') === '0,1,2,3', 'elles se succèdent d\'une noire, en noires depuis le début');
        check(programme[0].n === 'E4' && programme[3].n === 'A4', 'aux hauteurs que donne l\'accordage (mi4 … la4)');

        // --- Liaison de prolongation : UNE attaque, pas deux -------------------------------------------
        await page.evaluate(() => { window.app.editeur.placerCurseur(0, 0, 0); window.app.editeur.basculerLien('tie'); });
        const avecLiaison = await page.evaluate(() => {
            window.app.lecteur.programmer(window.app.editeur.partition);
            return window.app.lecteur._evenements.map(e => ({ d: e.debut, l: e.duree, n: e.note }));
        });
        check(avecLiaison.length === 3, 'une note liée à la suivante ne produit qu\'UNE attaque, pas deux');
        check(Math.abs(avecLiaison[0].l - 2) < 1e-6, 'et elle sonne la durée des deux réunies');

        // Un hammer-on, lui, EST une attaque — plus douce, mais bien rejouée.
        await page.evaluate(() => { window.app.editeur.basculerLien('tie'); window.app.editeur.basculerLien('hammer'); });
        const avecHammer = await page.evaluate(() => {
            window.app.lecteur.programmer(window.app.editeur.partition);
            return window.app.lecteur._evenements.map(e => +e.velocite.toFixed(3));
        });
        check(avecHammer.length === 4, 'un hammer-on garde les deux attaques : ce n\'est pas une liaison de prolongation');
        check(avecHammer[1] < avecHammer[2], 'mais la note martelée sonne plus doucement que celle attaquée à la main droite');

        // --- Liaison ET nuance de hammer-on, EN PRÉSENCE D'UNE 2e VOIX -----------------------------------
        // `aplatir()` groupe ses entrées par mesure PUIS par voix : le voisin immédiat, dans le tableau
        // à plat, du DERNIER évènement de la voix 0 d'une mesure est le PREMIER évènement de la voix 1
        // de cette même mesure — pas la suite logique de la mélodie. Une recherche « next = plat[i+1] »
        // s'accrocherait donc à la mauvaise voix dès qu'une mesure en porte deux ; c'est exactement le
        // scénario qu'une régression antérieure avait manqué.
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.partition.mesures[0].voix = [
                { evenements: [
                    m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 5, { lien: 'tie' })]),
                    m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 5)]),
                    m.creerEvenement({ valeur: 2 }, [m.creerNote(0, 7, { lien: 'hammer' })]),
                    m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 9)]),
                ] },
                // Voix 1 : une seule ronde, qui occuperait la position « juste après » la voix 0 dans
                // le tableau à plat si le groupement par mesure-puis-voix n'était pas pris en compte.
                { evenements: [m.creerEvenement({ valeur: 1 }, [m.creerNote(5, 0)])] },
            ];
        });
        const avec2Voix = await page.evaluate(() => {
            window.app.lecteur.programmer(window.app.editeur.partition);
            return window.app.lecteur._evenements.map(e => ({ d: e.debut, dur: +e.duree.toFixed(2), v: +e.velocite.toFixed(2) }));
        });
        check(avec2Voix.length === 4, 'voix0 fusionne sa liaison (3 attaques) + voix1 (1 attaque) = 4, malgré la voix 2 intercalée dans le tableau à plat');
        check(Math.abs(avec2Voix[0].dur - 2) < 1e-6, 'la liaison de la voix 0 fusionne toujours ses deux évènements (2 noires), pas seulement le suivant dans LE TABLEAU');
        check(avec2Voix[2].v < avec2Voix[1].v, 'la nuance du hammer-on de la voix 0 reste correcte : note martelée plus douce que celle qui la précède DANS SA VOIX');
        check(Math.abs(avec2Voix[3].v - 0.78) < 1e-6, 'et la voix 1 (la basse) n\'hérite pas à tort de la nuance douce du hammer-on voisin dans le tableau');

        // --- Le palm mute écourte sans déplacer ---------------------------------------------------------
        await page.evaluate(() => { window.app.editeur.basculerLien('hammer'); window.app.editeur.basculerEffetEvenement('palmMute'); });
        const avecPM = await page.evaluate(() => {
            window.app.lecteur.programmer(window.app.editeur.partition);
            return window.app.lecteur._evenements.map(e => ({ d: e.debut, l: +e.duree.toFixed(3) }));
        });
        check(avecPM[0].l < 0.5 && avecPM[0].d === 0, 'le palm mute écourte la note SANS déplacer son attaque');

        // --- Le transport avance et le trait le suit ----------------------------------------------------
        await page.evaluate(() => window.app.editeur.basculerEffetEvenement('palmMute'));
        await page.click('#btn-jouer');
        await page.waitForTimeout(500);
        const p1 = await page.evaluate(() => ({
            etat: window.app.lecteur.etat, pos: window.app.lecteur.position,
            marques: window.app.marquesLecture().length,
            couleursLecture: window.app.marquesLecture().map(m => m.couleur),
            couleursCurseur: window.app.marquesCurseur().map(m => m.couleur),
        }));
        exiger(p1.etat === 'lecture', 'la lecture démarre');
        check(p1.pos > 0, 'et le transport avance');
        // Trait + traînée (deux bandes translucides derrière lui) : voir marquesLecture dans
        // main.js — plus le bandeau de surlignage d'une version antérieure, remplacé par ce trait
        // qui parcourt toute la hauteur (portée, TAB, réglette).
        check(p1.marques === 3, 'la tête de lecture est dessinée (trait + traînée)');
        // AMBRE, jamais le vert du curseur d'édition — les deux repères coexistent à l'écran et
        // doivent rester reconnaissables l'un de l'autre (voir --lecture / --curseur dans style.css).
        // Un vrai défaut trouvé ainsi : la tête de lecture se dessinait avec les MÊMES teintes que le
        // curseur d'édition, donc invisible EN TANT QUE repère distinct (retour utilisateur : « je ne
        // vois pas comment mettre en place la barre de lecture orange »).
        check(p1.couleursLecture.every(c => c.includes('255, 152, 0') || c === 'var(--lecture)'),
            'la tête de lecture est bien ambre (var(--lecture)), pas verte');
        check(!p1.couleursLecture.some(c => p1.couleursCurseur.includes(c)),
            'et ne partage AUCUNE des couleurs du curseur d\'édition');

        // Le trait doit lire la position RÉELLE du transport. On compare donc les deux : s'ils
        // s'accordent à toute vitesse, c'est qu'il n'y a pas deux horloges.
        await page.waitForTimeout(500);
        const p2 = await page.evaluate(() => {
            const T = window.Tone;
            return { pos: window.app.lecteur.position, transport: T.Transport.ticks / T.Transport.PPQ };
        });
        check(p2.pos > p1.pos, 'la position continue de progresser');
        check(Math.abs(p2.pos - p2.transport) < 0.06, 'le trait suit l\'horloge AUDIO, pas une minuterie parallèle qui dériverait');

        // --- Pause, reprise, arrêt -------------------------------------------------------------------------
        await page.click('#btn-jouer');
        await page.waitForTimeout(250);
        const enPause = await page.evaluate(() => ({ etat: window.app.lecteur.etat, pos: window.app.lecteur.position }));
        await page.waitForTimeout(350);
        const toujoursEnPause = await page.evaluate(() => window.app.lecteur.position);
        check(enPause.etat === 'pause' && Math.abs(toujoursEnPause - enPause.pos) < 1e-6, 'la pause fige la position au lieu de continuer en sourdine');

        await page.click('#btn-stop');
        await page.waitForTimeout(200);
        const apresStop = await page.evaluate(() => ({ etat: window.app.lecteur.etat, pos: window.app.lecteur.position, marques: window.app.marquesLecture().length }));
        check(apresStop.etat === 'arret' && apresStop.pos === 0, 'l\'arrêt ramène au début du morceau');
        check(apresStop.marques === 0, 'et efface la tête de lecture');

        // --- Fin NATURELLE du morceau : le bouton doit revenir tout seul à « Lecture » ----------------
        // Un morceau très court à tempo très rapide, pour que la fin arrive vite (voir player.js#programmer,
        // le schedule de fermeture qui appelle arreter() de lui-même). C'est CE chemin — l'arrêt
        // déclenché par le LECTEUR, jamais par un clic sur #btn-jouer/#btn-stop — qui ne rafraîchissait
        // pas l'icône du bouton avant ce correctif : elle restait sur « Pause » (triangle barré) comme
        // si la lecture continuait, alors que le transport était bel et bien arrêté.
        await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            // UNE SEULE mesure (jamais les autres, restées à leur contenu antérieur dans ce banc) :
            // sans quoi la durée totale du morceau — celle qu'attend le schedule de fermeture de
            // player.js — resterait celle de plusieurs mesures à 4/4, et l'attente ci-dessous ne
            // suffirait pas à couvrir la fin réelle du morceau.
            ed.partition.mesures = [m.creerMesure({
                voix: [{ evenements: [m.creerEvenement({ valeur: 32 }, [m.creerNote(0, 3)])] }],
            })];
            ed.partition.meta.tempo = 400;   // une mesure à 4/4, ~0,6 s à ce tempo (voir dureeTotale)
            ed.prevenir('document');
        });
        await page.click('#btn-jouer');
        await page.waitForTimeout(200);   // confortablement AVANT la fin (~0,6 s), voir dureeTotale ci-dessus
        const enCours = await page.evaluate(() => ({
            etat: window.app.lecteur.etat, titreBouton: document.getElementById('btn-jouer').title,
        }));
        exiger(enCours.etat === 'lecture' && enCours.titreBouton === 'Pause (Espace)', 'la lecture (très courte) démarre bien, bouton sur « Pause »');
        await page.waitForTimeout(1800);   // confortablement APRÈS la fin, même avec la latence audio
        const apresFinNaturelle = await page.evaluate(() => ({
            etat: window.app.lecteur.etat, titreBouton: document.getElementById('btn-jouer').title,
        }));
        check(apresFinNaturelle.etat === 'arret', 'le lecteur s\'arrête bien TOUT SEUL en fin de morceau');
        check(apresFinNaturelle.titreBouton === 'Lecture (Espace)',
            'et le bouton revient au triangle « Lecture », sans qu\'il ait fallu cliquer sur #btn-jouer/#btn-stop pour ça');

        // --- CE QU'ON ENTEND SUIT CE QU'ON ÉCRIT ----------------------------------------------------
        // Retour utilisateur : « lorsque je modifie une mesure, la lecture audio n'est pas toujours à
        // jour et garde les informations précédentes. Elle doit s'adapter en temps réel aux
        // modifications, même lorsque la lecture en boucle n'est pas arrêtée. »
        //
        // LA CAUSE. `programmer` n'était appelé qu'au DÉMARRAGE (voir player.js#jouer, sous
        // `etat === 'arret'`) : la partition était traduite en évènements d'horloge une fois pour
        // toutes, et tout ce qu'on écrivait ensuite n'existait simplement pas pour l'audio.
        //
        // ET SANS INTERROMPRE LA LECTURE, ce qui est la moitié de la garantie : reprogrammer en
        // arrêtant puis relançant se serait entendu comme un hoquet à chaque note tapée. `programmer`
        // replace ses évènements à des positions ABSOLUES en tics sans toucher à l'horloge, donc le
        // transport court sans s'en apercevoir — c'est ce que vérifie `etat` à chaque étape.
        const programmes = () => page.evaluate(() => ({
            n: window.app.lecteur._evenements.length,
            notes: window.app.lecteur._evenements.map(e => e.note).join(','),
            etat: window.app.lecteur.etat,
        }));
        await page.evaluate(async () => {
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.appliquerDuree(4);
            ed.placerCurseur(0, 0, 0, 0); ed.saisirChiffre(5);
            await window.app.lecteur.jouer(ed.partition, 0);
        });
        await page.waitForTimeout(300);
        const avantEdition = await programmes();
        exiger(avantEdition.n === 1 && avantEdition.etat === 'lecture',
            `une seule note programmée au départ, lecture en cours (${avantEdition.notes})`);

        await page.evaluate(() => {
            const ed = window.app.editeur;
            ed.placerCurseur(0, 1, 0, 0); ed.saisirChiffre(9);
        });
        await page.waitForTimeout(300);
        const apresEdition = await programmes();
        check(apresEdition.n === 2 && apresEdition.etat === 'lecture',
            `une note écrite PENDANT la lecture rejoint aussitôt ce qui sonne (${apresEdition.notes}), sans arrêter la lecture`);

        // L'ANNULATION AUSSI, et c'est là que le décalage s'entendait le plus : on annule parce
        // qu'on n'a pas aimé ce qu'on venait d'entendre.
        await page.evaluate(() => window.app.editeur.annuler());
        await page.waitForTimeout(300);
        const apresAnnulation = await programmes();
        check(apresAnnulation.n === 1 && apresAnnulation.etat === 'lecture',
            `Ctrl+Z pendant la lecture retire aussi la note de ce qui sonne (${apresAnnulation.notes})`);

        // UN DÉPLACEMENT DE CURSEUR NE REPROGRAMME RIEN : il ne change rien à ce qui sonne, et
        // reprogrammer à chaque flèche serait du travail pur pendant la lecture.
        // ON COMPTE LES APPELS, en enveloppant `programmer` — première rédaction : je posais un
        // témoin sur le lecteur et vérifiais qu'il survivait, ce qu'il aurait fait dans les deux cas
        // puisque `programmer` n'y touche pas. Une vérification qui ne peut pas échouer ne protège
        // rien.
        const comptes = await page.evaluate(async () => {
            const l = window.app.lecteur;
            const vrai = l.programmer.bind(l);
            let n = 0;
            l.programmer = (p) => { n++; return vrai(p); };
            window.app.editeur.deplacerEvenement(1);
            await new Promise(r => setTimeout(r, 150));
            const apresCurseur = n;
            window.app.editeur.saisirChiffre(4);
            await new Promise(r => setTimeout(r, 150));
            const apresSaisie = n;
            l.programmer = vrai;
            return { apresCurseur, apresSaisie };
        });
        check(comptes.apresCurseur === 0 && comptes.apresSaisie > 0,
            `déplacer le curseur ne reprogramme pas (${comptes.apresCurseur} appel), écrire une case si (${comptes.apresSaisie})`);
        await page.evaluate(() => window.app.lecteur.arreter());

        check(erreurs.length === 0, 'aucune erreur JavaScript pendant la lecture' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }

    // --- LE CHEMIN DE CHARGEMENT RÉUSSI, celui que cet environnement ne joue JAMAIS ----------------
    //
    // POURQUOI CE BANC EXISTE. Les échantillons sont désormais chargés à part (Tone.ToneAudioBuffers)
    // puis l'échantillonneur est BÂTI DESSUS dans le rappel `onload` — parce que la voix glissante a
    // besoin des buffers eux-mêmes (voir player.js#_glissandoEchantillonne). Or la sortie réseau est
    // bloquée ici : `onload` ne se déclenche donc jamais, et TOUT ce banc, comme tous les autres,
    // exerce le chemin de la DOUBLURE. Une faute dans ce rappel — l'échantillonneur mal construit,
    // mal branché, jamais déclaré prêt — rendrait le piano muet ou synthétique chez l'utilisateur
    // sans qu'aucune vérification ne bronche. C'est précisément le risque qu'un déplacement de
    // chargement fait courir, et il ne se couvre pas en le supposant.
    //
    // ON SERT DONC LES 17 ÉCHANTILLONS SOI-MÊME, en interceptant les requêtes : des WAV fabriqués
    // aux bonnes hauteurs (`decodeAudioData` les accepte comme des mp3). Le chemin exécuté est le
    // VRAI, du téléchargement jusqu'au son ; seule la matière sonore est de remplacement.
    const wav = (hz, secondes = 1.2, sr = 44100) => {
        const n = Math.floor(sr * secondes);
        const data = Buffer.alloc(n * 2);
        for (let i = 0; i < n; i++) {
            const t = i / sr;
            const v = Math.exp(-t * 1.2) * 0.5 * (Math.sin(2 * Math.PI * hz * t) + 0.4 * Math.sin(2 * Math.PI * hz * 2 * t));
            data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
        }
        const h = Buffer.alloc(44);
        h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
        h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
        h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
        h.write('data', 36); h.writeUInt32LE(data.length, 40);
        return Buffer.concat([h, data]);
    };
    const BASES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    // `Ds2.mp3` côté fichier, `D#2` côté clé : c'est la convention de Salamander.
    const midiDuFichier = (nom) => {
        const g = /^([A-G])(s|#)?(-?\d+)$/.exec(nom);
        return g ? (Number(g[3]) + 1) * 12 + BASES[g[1]] + (g[2] ? 1 : 0) : null;
    };
    const piano = await ouvrirApp();
    try {
        let servis = 0;
        await piano.page.route('https://tonejs.github.io/audio/salamander/*', (route) => {
            const nom = route.request().url().split('/').pop().replace('.mp3', '');
            const midi = midiDuFichier(nom);
            if (midi === null) return route.continue();
            servis++;
            route.fulfill({ status: 200, contentType: 'audio/wav', body: wav(440 * Math.pow(2, (midi - 69) / 12)) });
        });
        const charge = await piano.page.evaluate(async () => {
            const l = window.app.lecteur;
            await l.demarrer();
            for (let i = 0; i < 100 && !l._buffersPiano?.loaded; i++) await new Promise(r => setTimeout(r, 100));
            return {
                buffers: !!l._buffersPiano?.loaded,
                // `synthe.charge` ne dit vrai que si l'échantillonneur est NÉ dans le `onload` ET se
                // déclare prêt : c'est la façade (voir demarrer) qui choisit qui joue à chaque note.
                echantillonneur: l.synthe.charge,
                unBuffer: !!l._buffersPiano?.get('C4'),
            };
        });
        exiger(charge.buffers && charge.unBuffer,
            `les 17 échantillons chargent dans un banc de buffers partagé (${servis} servis)`);
        exiger(charge.echantillonneur,
            'et l\'échantillonneur est bâti DESSUS, branché, et se déclare prêt — le rappel `onload` que le réseau bloqué ne joue jamais');

        const son = await piano.page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur, l = window.app.lecteur;
            const T = globalThis.Tone;
            const metre = new T.Meter({ normalRange: true, smoothing: 0 });
            T.Destination.connect(metre);
            let appelsSynthe = 0;
            const vrai = l.voixBend.triggerAttackRelease.bind(l.voixBend);
            l.voixBend.triggerAttackRelease = (...a) => { appelsSynthe++; return vrai(...a); };
            l.synthe.triggerAttackRelease('C3', 0.1, undefined, 0.5);   // chauffe le contexte
            await new Promise(r => setTimeout(r, 400));
            const jouer = async (evs) => {
                l.arreter(); ed.nouveau('guitare');
                ed.partition.mesures[0].voix[0].evenements = evs;
                ed.prevenir('document');
                appelsSynthe = 0;
                let crete = 0, maxSources = 0;
                await l.jouer(ed.partition, 0);
                for (let i = 0; i < 60; i++) {
                    await new Promise(r => setTimeout(r, 10));
                    crete = Math.max(crete, metre.getValue());
                    maxSources = Math.max(maxSources, l._glissandos.size);
                }
                l.arreter(); await new Promise(r => setTimeout(r, 150));
                return { crete, appelsSynthe, maxSources };
            };
            return {
                note: await jouer([m.creerEvenement({ valeur: 2 }, [m.creerNote(2, 5)]),
                                   m.creerEvenement({ valeur: 2 }, [], { silence: true })]),
                slide: await jouer([m.creerEvenement({ valeur: 8 }, [{ ...m.creerNote(2, 5), lien: 'slide' }]),
                                    m.creerEvenement({ valeur: 8 }, [m.creerNote(2, 7)]),
                                    m.creerEvenement({ valeur: 2 }, [], { silence: true }),
                                    m.creerEvenement({ valeur: 4 }, [], { silence: true })]),
            };
        });
        exiger(son.note.crete > 0.01,
            `une note ORDINAIRE sort du haut-parleur une fois le piano chargé (crête ${son.note.crete.toFixed(3)}) — c'est ce qu'un déplacement de chargement raté aurait fait taire`);
        check(son.slide.maxSources === 1 && son.slide.appelsSynthe === 0,
            'et un slide passe par l\'échantillon de piano, pas par l\'onde de repli');
        check(son.slide.crete > 0.01, `le slide échantillonné sonne (crête ${son.slide.crete.toFixed(3)})`);
        check(piano.erreurs.length === 0,
            'aucune erreur JavaScript avec le piano chargé' + (piano.erreurs.length ? ' — ' + piano.erreurs.join(' | ') : ''));
    } finally { await piano.fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
