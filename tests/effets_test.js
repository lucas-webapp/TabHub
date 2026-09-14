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
    plan(31);
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
        // LE SLIDE NE SUIT PLUS CE MODÈLE, et c'est tout l'objet du correctif : il ne produit plus
        // deux sons dont le second est adouci (comme un hammer-on), mais UN SEUL son dont la hauteur
        // glisse — le doigt ne quitte pas la corde. Voir la section « LE SLIDE GLISSE VRAIMENT » plus
        // bas, qui l'éprouve en détail ; ici on constate seulement qu'il a cessé d'être un hammer-on.
        check(r.cas.slide.length === r.temoin.length - 1,
            'un slide, lui, FUSIONNE ses deux notes en un seul son glissant — plus une arrivée adoucie');

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
        // --- LE SLIDE GLISSE VRAIMENT, il ne plaque pas deux hauteurs -------------------------------
        // Retour utilisateur : « ajouter l'effet slide, pas uniquement le hammer-on. J'écoute un slide
        // rapide d'un ton sur une double croche et c'est pas assez fluide. » Et pour cause : `slide` ne
        // servait qu'à BAISSER LA VÉLOCITÉ de la note d'arrivée — exactement comme un hammer-on. On
        // entendait donc deux hauteurs distinctes, attaque en moins, jamais un déplacement.
        //
        // Ce qu'on vérifie n'est pas « le son est fluide » (invérifiable par un banc) mais la STRUCTURE
        // qui le rend fluide : UN SEUL évènement pour les deux notes, dont la hauteur porte un palier
        // d'arrivée daté. Deux évènements, c'est deux attaques ; un seul, c'est un doigt qui se déplace.
        const slide = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [
                m.creerEvenement({ valeur: 16 }, [{ ...m.creerNote(0, 5), lien: 'slide' }]),
                m.creerEvenement({ valeur: 16 }, [m.creerNote(0, 7)]),
                ...m.decouperEnEvenements(3.5),
            ];
            window.app.lecteur.programmer(ed.partition);
            const sonnants = window.app.lecteur._evenements;
            return {
                nb: sonnants.length,
                glisse: sonnants[0].glisse,
                duree: +sonnants[0].duree.toFixed(6),
            };
        });
        exiger(slide.nb === 1,
            'deux notes liées par un slide ne produisent qu\'UN SEUL son — la note d\'arrivée n\'est plus attaquée à part');
        check(!!slide.glisse && slide.glisse.etapes.length === 1,
            'ce son porte un palier de glissement, et un seul : la hauteur bouge, elle ne saute pas');
        check(slide.glisse.etapes[0].midi - slide.glisse.midi === 2,
            'le palier vise bien un TON plus haut (case 5 -> case 7), en demi-tons et non en nom de note');
        check(Math.abs(slide.glisse.etapes[0].arriveeA - 0.25) < 1e-6,
            'et il doit être atteint PILE là où la note d\'arrivée aurait été attaquée (0,25 noire = une double-croche)');
        check(Math.abs(slide.duree - 0.5) < 1e-6,
            'le son couvre la durée des DEUX notes réunies, comme une liaison de prolongation');

        // Une CHAÎNE de slides (5 -> 7 -> 9) : un seul son à deux paliers, pas trois notes.
        const chaine = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [
                m.creerEvenement({ valeur: 8 }, [{ ...m.creerNote(0, 5), lien: 'slide' }]),
                m.creerEvenement({ valeur: 8 }, [{ ...m.creerNote(0, 7), lien: 'slide' }]),
                m.creerEvenement({ valeur: 8 }, [m.creerNote(0, 9)]),
                ...m.decouperEnEvenements(2.5),
            ];
            window.app.lecteur.programmer(ed.partition);
            const s = window.app.lecteur._evenements;
            return { nb: s.length, paliers: s[0].glisse?.etapes.map(e => e.midi - s[0].glisse.midi) };
        });
        check(chaine.nb === 1 && JSON.stringify(chaine.paliers) === '[2,4]',
            'une chaîne de slides (5 -> 7 -> 9) donne un seul son à DEUX paliers, un ton puis deux');

        // Un slide vers RIEN (dernière note du morceau) ne doit rien casser : pas de palier, son normal.
        const orphelin = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = [
                m.creerEvenement({ valeur: 4 }, [{ ...m.creerNote(0, 5), lien: 'slide' }]),
                ...m.decouperEnEvenements(3),
            ];
            window.app.lecteur.programmer(ed.partition);
            return { nb: window.app.lecteur._evenements.length, glisse: window.app.lecteur._evenements[0].glisse };
        });
        check(orphelin.nb === 1 && orphelin.glisse === null,
            'un slide qui ne mène à aucune note suivante se joue simplement, sans palier en l\'air');

        // --- LE SIGNE DU SLIDE SUR LA PARTITION -----------------------------------------------------
        // Le son glissait déjà (tout ce qui précède le prouve) ; c'est l'ÉCRITURE qui manquait, et
        // c'est elle que l'utilisateur a vue manquer : « le slide n'a pas marché sur ma partition,
        // entre le 6 et 8 de la troisième corde ». La cause était une table d'étiquettes rendant une
        // chaîne VIDE pour `slide`, suivie du même arc que pour une liaison de tenue : à l'écran,
        // « glisse du 6 au 8 » et « tiens la même note » se dessinaient à l'identique.
        // On lit la liste d'affichage, pas les pixels : c'est là que la distinction existe.
        const signe = await page.evaluate(async () => {
            const lay = await import('/src/engine/layout.js');
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur;
            const tracer = (lien, f1, f2) => {
                ed.nouveau('basse');
                ed.partition.mesures[0].voix[0].evenements = [
                    m.creerEvenement({ valeur: 4 }, [{ ...m.creerNote(2, f1), lien }]),
                    m.creerEvenement({ valeur: 4 }, [m.creerNote(2, f2)]),
                    ...m.decouperEnEvenements(2),
                ];
                const p = lay.mettreEnPage(ed.partition, { largeurPage: 1272 }).primitives;
                const ep = 0.115 * lay.GEO_DEFAUT.S;              // EPAISSEURS.glisse
                return {
                    obliques: p.filter(x => x.t === 'ligne' && Math.abs(x.ep - ep) < 1e-9)
                        .map(x => ({ dx: +(x.x2 - x.x1).toFixed(2), dy: +(x.y2 - x.y1).toFixed(2) })),
                    arcs: p.filter(x => x.t === 'courbe').length,
                    lettres: p.filter(x => x.t === 'texte' && ['H', 'P'].includes(x.s)).map(x => x.s),
                };
            };
            return { slideHaut: tracer('slide', 6, 8), slideBas: tracer('slide', 8, 6),
                     tie: tracer('tie', 6, 6), hammer: tracer('hammer', 6, 8) };
        });
        exiger(signe.slideHaut.obliques.length === 2,
            'un slide trace DEUX traits obliques — un sur la tablature, un entre les têtes de la portée');
        check(signe.slideHaut.arcs === 0 && signe.tie.arcs > 0,
            'et AUCUN arc, là où une liaison de tenue en trace : le slide ne se confond plus avec elle');
        // `every` sur un tableau VIDE rend `true` : le compte fait partie de la vérification, sans quoi
        // les deux qui suivent passeraient alors qu'aucun trait ne serait tracé — constaté en
        // neutralisant le correctif, où seul l'`exiger` ci-dessus tombait.
        check(signe.slideHaut.obliques.length === 2 && signe.slideBas.obliques.length === 2
              && signe.slideHaut.obliques.every(t => t.dy < 0) && signe.slideBas.obliques.every(t => t.dy > 0),
            'le trait monte du 6 vers le 8 et descend du 8 vers le 6 — le sens se lit sur le dessin');
        check(signe.slideHaut.obliques.length === 2
              && signe.slideHaut.obliques.every(t => t.dx > 0 && Math.abs(t.dy / t.dx) <= 1.01),
            'sa pente reste sous 45°, jamais un stub vertical confondable avec une barre de mesure');
        // Un seul « H », sur la TABLATURE : la portée, elle, dit le hammer-on par son arc de legato —
        // la lettre y serait redondante, et la gravure classique ne l'y met pas.
        check(signe.slideHaut.lettres.length === 0 && signe.hammer.lettres.join('') === 'H',
            'pas de lettre pour un slide (la gravure n\'en met pas), un « H » sur la tablature pour un hammer-on');

        // --- LES BOUTONS MONTRENT CE QUE LA PARTITION ÉCRIT -----------------------------------------
        // Retour utilisateur : « les logos des effets ne sont pas forcément logiques ou adaptés,
        // parfois on a du mal à comprendre — tu peux par exemple insérer le petit H pour le
        // hammer-on ». Les trois icônes étaient auparavant trois flèches courbes distinguées par leur
        // seul sens, et le bend en faisait une quatrième.
        const icones = await page.evaluate(async () => {
            const { icone } = await import('/src/ui/icons.js');
            const svg = (n) => icone(n);
            const lettre = (n) => (svg(n).match(/>([A-Z])<\/text>/) || [])[1] || null;
            return { h: lettre('hammerOn'), p: lettre('pullOff'), slide: lettre('slide'),
                     distincts: new Set(['hammerOn', 'pullOff', 'slide', 'tie', 'bend'].map(svg)).size };
        });
        check(icones.h === 'H' && icones.p === 'P',
            'le bouton hammer-on porte le « H » que la partition imprime, le pull-off son « P »');
        check(icones.slide === null,
            'et le slide n\'en porte aucune, comme sur la partition — c\'est son trait oblique qui le dit');
        check(icones.distincts === 5,
            'les cinq icônes de liaison (hammer, pull, slide, tenue, bend) restent cinq dessins différents');

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
