// Banc de la LECTURE AUDIO et de la TÊTE DE LECTURE.
//
// Un banc automatique n'entend rien : il ne peut pas dire si le son est juste. Ce qu'il PEUT établir,
// c'est tout le reste — et c'est là que sont les vrais défauts de ce genre de module : le transport
// avance-t-il vraiment ? le trait suit-il la position réelle du transport, ou une minuterie parallèle
// qui dérivera ? les liaisons de prolongation sont-elles fusionnées, ou la note est-elle réattaquée
// là où la notation dit qu'elle ne doit pas l'être ? un changement de tempo réétire-t-il l'ensemble ?
//
// VITESSE DE LECTURE (retour utilisateur : ralentir la lecture pour mieux entendre une grille
// d'accords, SANS toucher au tempo écrit) : possible ici sans distorsion de hauteur puisque les
// notes sont SYNTHÉTISÉES par Tone.js à la demande, pas un enregistrement à étirer — ralentir
// revient à réduire Tone.Transport.bpm.value, jamais partition.meta.tempo (voir player.js
// #definirVitesseLecture/_appliquerTempoEffectif).

const creerHarnais = require('./_harness.js');
const { ouvrirApp, taper, lireEtat } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('lecture audio');

(async () => {
    plan(41);
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

        // --- Vitesse de lecture : ralentit l'HORLOGE, jamais le tempo ÉCRIT ----------------------------
        await page.evaluate(() => window.app.editeur.definirTempo(140));
        const vitesse = await page.evaluate(() => {
            const lect = window.app.lecteur;
            lect.programmer(window.app.editeur.partition);
            const bpm100 = window.Tone.Transport.bpm.value;
            lect.definirVitesseLecture(50);
            const bpm50 = window.Tone.Transport.bpm.value;
            lect.definirVitesseLecture(100);
            const bpmRetour100 = window.Tone.Transport.bpm.value;
            // Bornée 25-100 : jamais plus lent qu'un quart de la vitesse écrite, jamais accéléré
            // au-delà de ce qui est écrit (ce réglage RALENTIT, il n'accélère pas).
            lect.definirVitesseLecture(10);
            const vitesseBorneeBas = lect.vitesseLecture;
            lect.definirVitesseLecture(150);
            const vitesseBorneeHaut = lect.vitesseLecture;
            // Changer le tempo ÉCRIT pendant qu'un ralenti est actif doit repartir de CE nouveau
            // tempo, pas revenir à 100% de vitesse (les deux réglages restent indépendants).
            lect.definirVitesseLecture(50);
            window.app.editeur.definirTempo(200);
            const bpmTempoEtVitesse = window.Tone.Transport.bpm.value;
            return {
                bpm100, bpm50, bpmRetour100, vitesseBorneeBas, vitesseBorneeHaut, bpmTempoEtVitesse,
                tempoEcrit: window.app.editeur.partition.meta.tempo,
            };
        });
        check(vitesse.bpm100 === 140, 'à 100%, l\'horloge tourne exactement au tempo écrit (140)');
        check(vitesse.bpm50 === 70, 'à 50%, l\'horloge tourne deux fois plus lentement (70) — la moitié, pas une valeur approchée');
        check(vitesse.bpmRetour100 === 140, 'et remonter à 100% retrouve EXACTEMENT le tempo écrit, sans dérive cumulée');
        check(vitesse.tempoEcrit === 200, 'le tempo ÉCRIT sur la partition suit les changements voulus (definirTempo)');
        check(vitesse.vitesseBorneeBas === 25, 'la vitesse de lecture ne descend jamais sous 25% (un ralenti reste JOUABLE)');
        check(vitesse.vitesseBorneeHaut === 100, 'et ne dépasse jamais 100% : ce réglage ralentit, il n\'accélère pas au-delà de l\'écrit');
        check(vitesse.bpmTempoEtVitesse === 100, 'changer le tempo ÉCRIT pendant un ralenti à 50% repart bien de ce nouveau tempo (200 × 50% = 100), sans réinitialiser la vitesse à 100%');

        // --- Persistance : un réglage de LECTURE (comme le volume), jamais dans le .json --------------
        await page.evaluate(() => window.app.lecteur.definirVitesseLecture(100));
        await page.click('#btn-reglages');
        await page.waitForTimeout(150);
        exiger(await page.evaluate(() => !!document.getElementById('champ-vitesse-lecture')),
            'le curseur de vitesse de lecture existe dans Réglages (rubrique Son, avec les volumes)');
        await page.evaluate(() => {
            const c = document.getElementById('champ-vitesse-lecture');
            c.value = 60;
            c.dispatchEvent(new Event('input'));
        });
        await page.waitForTimeout(100);
        const persistance = await page.evaluate(() => ({
            vitesseLecteur: window.app.lecteur.vitesseLecture,
            affichee: document.getElementById('valeur-vitesse-lecture').textContent,
            localStorage: localStorage.getItem('tabhub.vitesseLecture'),
            dansLeJson: JSON.stringify(window.app.editeur.partition).includes('vitesseLecture'),
        }));
        check(persistance.vitesseLecteur === 60, 'glisser le curseur à 60 bascule réellement la vitesse de lecture');
        check(persistance.affichee === '60', 'et l\'affiche à côté du curseur, comme les volumes');
        check(persistance.localStorage === '60', 'persisté en local (comme les volumes, mesuresParLigne…)');
        check(!persistance.dansLeJson, 'et ne se glisse pas dans le modèle de la partition (le .json reste indépendant de la lecture)');
        await page.click('[data-fermer]');
        await page.waitForTimeout(100);
        await page.evaluate(() => window.app.lecteur.definirVitesseLecture(100));   // remis à 100% pour la suite du banc

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

        check(erreurs.length === 0, 'aucune erreur JavaScript pendant la lecture' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
