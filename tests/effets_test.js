// Banc des EFFETS : chacun doit s'ENTENDRE, pas seulement se dessiner.
//
// CE QU'IL PROTÈGE, ET POURQUOI IL EXISTE. Retour utilisateur : « refais un test de tes outils pour
// être sûr qu'ils fonctionnent (bend, note tenue, accents, ghost note, staccato…) — à la lecture je
// n'entends rien ». L'audit qui a suivi a donné une réponse nette : huit effets sur neuf agissaient
// bien sur ce qui est programmé pour la lecture, et UN seul ne faisait absolument rien — le BEND,
// dessiné sur la tablature mais jamais lu par le lecteur audio. Un effet peut donc parfaitement
// paraître implémenté (icône, bascule, sauvegarde dans le .json, rendu à l'écran) sans produire le
// moindre son : c'est exactement le trou que ce banc bouche.
//
// LA MÉTHODE : jouer deux fois le MÊME extrait, une fois nu et une fois avec l'effet, et exiger que
// ce qui part vers le synthé DIFFÈRE — puis vérifier en quoi précisément (une vélocité pour un
// accent, une durée écourtée pour un staccato, deux évènements fusionnés en un pour une liaison…).
// Un banc automatique n'ENTEND rien ; mais il peut affirmer, note par note, que l'effet change
// réellement ce qui sera joué, et de la bonne manière.

const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('effets');

(async () => {
    plan(16);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        const r = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur, lect = window.app.lecteur;
            await lect.demarrer();

            // Deux noires sur la même corde : la 1re porte l'effet, la 2e sert de voisine (une
            // liaison ou un hammer-on n'ont de sens qu'avec une note d'arrivée).
            const jouer = (appliquer) => {
                ed.nouveau('guitare');
                ed.partition.mesures[0].voix[0].evenements = [
                    m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 5)]),
                    m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 7)]),
                    ...m.creerVoix(2).evenements,
                ];
                ed.placerCurseur(0, 0, 0);
                if (appliquer) appliquer(ed);
                lect.programmer(ed.partition);
                return lect._evenements.map(e => ({
                    debut: +e.debut.toFixed(4), duree: +e.duree.toFixed(4),
                    note: e.note, velocite: +e.velocite.toFixed(4),
                    bend: e.bend ? e.bend.demiTons : null,
                }));
            };

            const temoin = jouer(null);
            const cas = {
                accent:   jouer(ed => ed.basculerEffetEvenement('accent')),
                staccato: jouer(ed => ed.basculerEffetEvenement('staccato')),
                palmMute: jouer(ed => ed.basculerEffetEvenement('palmMute')),
                ghost:    jouer(ed => ed.basculerGhost()),
                tie:      jouer(ed => ed.basculerLien('tie')),
                hammer:   jouer(ed => ed.basculerLien('hammer')),
                pull:     jouer(ed => ed.basculerLien('pull')),
                slide:    jouer(ed => ed.basculerLien('slide')),
                bend:     jouer(ed => ed.definirBend(2)),
            };
            // Les trois amplitudes de bend, telles que la touche les fait circuler.
            const cycleBend = [];
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [m.creerEvenement({ valeur: 4 }, [m.creerNote(0, 5)]), ...m.creerVoix(3).evenements];
            ed.placerCurseur(0, 0, 0);
            for (let i = 0; i < 4; i++) { ed.bendSuivant(); cycleBend.push(ed.noteCourante().bend?.demiTons ?? 0); }

            // La voix dédiée au bend existe-t-elle, et sa hauteur est-elle réellement pilotable ?
            const voix = lect.voixBend;
            return {
                temoin, cas, cycleBend,
                voixBendPresente: !!voix,
                hauteurRampable: !!(voix && typeof voix.frequency?.exponentialRampToValueAtTime === 'function'),
            };
        });

        const t = JSON.stringify(r.temoin);
        const differe = (nom) => JSON.stringify(r.cas[nom]) !== t;

        // --- LE POINT CENTRAL : aucun effet ne doit être muet -----------------------------------
        const muets = Object.keys(r.cas).filter(nom => !differe(nom));
        exiger(muets.length === 0,
            `AUCUN effet n'est muet — chacun change ce qui part vers le synthé${muets.length ? ' ; muets : ' + muets.join(', ') : ''}`);

        // --- Et chacun change de la BONNE manière ------------------------------------------------
        check(r.cas.accent[0].velocite > r.temoin[0].velocite, 'un accent joue la note PLUS FORT');
        check(r.cas.ghost[0].velocite < r.temoin[0].velocite, 'une note fantôme la joue PLUS DOUCEMENT');
        check(r.cas.staccato[0].duree < r.temoin[0].duree && r.cas.staccato[0].debut === r.temoin[0].debut,
            'un staccato ÉCOURTE la note sans déplacer son attaque');
        check(r.cas.palmMute[0].duree < r.cas.staccato[0].duree,
            'un palm mute l\'écourte plus encore qu\'un staccato');
        check(r.cas.tie.length === r.temoin.length - 1 && r.cas.tie[0].duree === r.temoin[0].duree * 2,
            'une liaison de prolongation fusionne les deux notes en UNE attaque de durée double');
        check(r.cas.hammer[1].velocite < r.temoin[1].velocite && r.cas.hammer[0].velocite === r.temoin[0].velocite,
            'un hammer-on adoucit la note d\'ARRIVÉE, pas celle de départ');
        check(r.cas.pull[1].velocite < r.temoin[1].velocite, 'un pull-off aussi');
        check(r.cas.slide[1].velocite < r.temoin[1].velocite, 'un slide aussi');

        // --- Le BEND, le seul qui ne produisait RIEN --------------------------------------------
        exiger(r.cas.bend[0].bend === 2,
            'le bend voyage jusqu\'à la programmation, en demi-tons — c\'est précisément ce qui manquait');
        check(r.cas.bend[0].note === r.temoin[0].note,
            'et la note est toujours ATTAQUÉE à sa hauteur écrite (le glissement vient ensuite, voir _jouerBend)');
        exiger(r.voixBendPresente, 'une voix dédiée au bend est bien construite au démarrage de l\'audio');
        check(r.hauteurRampable,
            'et sa hauteur est réellement rampable — la seule façon, avec Tone.js, d\'entendre une hauteur qui GLISSE (ni Sampler ni PolySynth ne l\'offrent)');

        // --- Les amplitudes de bend, « difficiles à définir » avant ------------------------------
        check(r.cycleBend.join(',') === '1,2,3,0',
            'la touche fait CIRCULER l\'amplitude : ½ → full → 1½ → aucun (une seule valeur imposée auparavant)');

        check(differe('bend'), 'récapitulatif : le bend change bien la lecture, comme les huit autres');
        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
