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
    plan(48);
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
                    lettres: p.filter(x => x.t === 'texte' && ['H', 'P', 'sl.'].includes(x.s)).map(x => x.s),
                };
            };
            return { slideHaut: tracer('slide', 6, 8), slideBas: tracer('slide', 8, 6),
                     tie: tracer('tie', 6, 6), hammer: tracer('hammer', 6, 8) };
        });
        exiger(signe.slideHaut.obliques.length === 2,
            'un slide trace DEUX traits obliques — un sur la tablature, un entre les têtes de la portée');
        // DEUX ARCS, un par portée — l'arc est REVENU avec la notation de l'image, et sans rouvrir
        // l'ambiguïté qui l'avait fait retirer : le trait oblique EXISTE désormais (les deux, vérifiés
        // juste au-dessus), et c'est lui qui distingue le slide d'une liaison de tenue. L'arc ne fait
        // plus que grouper les deux notes, et « sl. » nomme le geste. Un slide porte donc les TROIS
        // signes, une liaison de tenue le seul arc — plus aucune confusion possible dans les deux sens.
        check(signe.slideHaut.arcs === 2 && signe.slideHaut.obliques.length === 2,
            `un slide porte arc ET trait oblique, sur les deux portées (${signe.slideHaut.arcs} arcs, ${signe.slideHaut.obliques.length} obliques)`);
        check(signe.tie.arcs > 0 && signe.tie.obliques.length === 0 && signe.tie.lettres.length === 0,
            'une liaison de tenue, elle, n\'a QUE son arc : ni trait oblique ni « sl. »');
        // ET LE SLIDE DESCENDANT porte le même signe : le sens se lit sur l'obliquité du trait, pas
        // sur la présence ou l'absence de quelque chose.
        check(signe.slideBas.arcs === 2 && signe.slideBas.lettres.join('') === 'sl.sl.',
            'un slide DESCENDANT porte exactement les mêmes arcs et les mêmes « sl. »');
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
        // LE SLIDE PORTE « sl. » DEPUIS, et c'est un RETOUR EN ARRIÈRE assumé sur ce banc : il
        // vérifiait qu'un slide ne portait AUCUNE lettre, « comme la gravure ». L'utilisateur a
        // apporté l'image d'une édition imprimée qui en porte une (« peux-tu modifier sa notation
        // comme sur l'image ? C'est plus clair ») — arc au-dessus des deux notes, et « sl. » en
        // italique au-dessus de l'arc, sur la portée COMME sur la tablature. C'est la convention la
        // plus répandue, et elle lève l'ambiguïté que le trait oblique seul laissait : rien
        // n'annonçait le geste avant de le lire.
        // DEUX « sl. », un par portée — comme l'image en montre un au-dessus de la portée et un
        // au-dessus de la tablature. Le hammer-on, lui, n'écrit son « H » que sur la TABLATURE : sur
        // la portée, son arc de legato le dit déjà, et la gravure classique n'y met pas la lettre.
        check(signe.slideHaut.lettres.join('') === 'sl.sl.' && signe.hammer.lettres.join('') === 'H',
            `« sl. » sur LES DEUX portées pour un slide, un seul « H » (celui de la TAB) pour un hammer-on (reçu « ${signe.slideHaut.lettres.join('')} » et « ${signe.hammer.lettres.join('')} »)`);

        // --- LES BOUTONS MONTRENT CE QUE LA PARTITION ÉCRIT -----------------------------------------
        // Retour utilisateur : « les logos des effets ne sont pas forcément logiques ou adaptés,
        // parfois on a du mal à comprendre — tu peux par exemple insérer le petit H pour le
        // hammer-on ». Les trois icônes étaient auparavant trois flèches courbes distinguées par leur
        // seul sens, et le bend en faisait une quatrième.
        const icones = await page.evaluate(async () => {
            const { icone } = await import('/src/ui/icons.js');
            const svg = (n) => icone(n);
            // Trois caractères possibles (« sl. »), plus seulement une majuscule isolée.
            const lettre = (n) => (svg(n).match(/>([A-Za-z.]{1,4})<\/text>/) || [])[1] || null;
            return { h: lettre('hammerOn'), p: lettre('pullOff'), slide: lettre('slide'),
                     distincts: new Set(['hammerOn', 'pullOff', 'slide', 'tie', 'bend'].map(svg)).size };
        });
        check(icones.h === 'H' && icones.p === 'P',
            'le bouton hammer-on porte le « H » que la partition imprime, le pull-off son « P »');
        check(icones.slide === 'sl.',
            `et le bouton du slide porte « sl. », comme la partition (reçu « ${icones.slide} »)`);
        check(icones.distincts === 5,
            'les cinq icônes de liaison (hammer, pull, slide, tenue, bend) restent cinq dessins différents');

        // --- LE SON DU SLIDE S'ENTEND VRAIMENT --------------------------------------------------
        // LE DÉFAUT (retour utilisateur : « le son des slides ne fonctionne pas : son inaudible,
        // testé sur plusieurs configurations — slide montant et descendant, en croches et
        // doubles-croches »). Tout ce qui précède prouvait que le glissando était bien PROGRAMMÉ ;
        // rien ne vérifiait qu'il s'ENTENDAIT.
        //
        // LA CAUSE, trouvée en mesurant la sortie audio réelle : la voix du slide portait une
        // enveloppe de DOUBLURE (sustain 0,14) — celle d'un son qui n'a qu'à donner une hauteur nette
        // à l'attaque. Or le glissement se produit vers la FIN de la note (voir _jouerSlide,
        // PART_GLISSEE) : la hauteur glissait pendant que le son s'était déjà éteint à 14 %, et il ne
        // restait à entendre que l'attaque, sur la note de DÉPART. Mesuré avant correction : au moment
        // du glissement, il restait 16 % de la crête — soit exactement le niveau de traîne d'une note
        // ordinaire au même instant, donc rien de distinguable. Après : 50 %.
        //
        // CE QU'ON MESURE ICI EST LA SORTIE AUDIO, pas la programmation : un Tone.Meter branché sur la
        // destination, échantillonné pendant la lecture. C'est la seule façon de répondre à « je
        // n'entends rien » — la liste d'évènements, elle, avait toujours l'air juste.
        const audio = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur, l = window.app.lecteur;
            await l.demarrer();
            const Tone = globalThis.Tone;
            const metre = new Tone.Meter({ normalRange: true, smoothing: 0 });
            Tone.Destination.connect(metre);
            // Chauffer le contexte : la toute première note d'un contexte audio neuf peut se perdre,
            // et la mesure porterait alors sur un silence qui n'a rien à voir avec le sujet.
            l.synthe.triggerAttackRelease('C3', 0.1, undefined, 0.5);
            await new Promise(r => setTimeout(r, 400));

            const profil = async (evenements) => {
                l.arreter();
                ed.nouveau('guitare');
                ed.partition.mesures[0].voix[0].evenements = evenements;
                ed.prevenir('document');
                const echant = [];
                await l.jouer(ed.partition, 0);
                const t0 = performance.now();
                for (let i = 0; i < 70; i++) {
                    await new Promise(r => setTimeout(r, 10));
                    echant.push({ ms: performance.now() - t0, v: metre.getValue() });
                }
                l.arreter();
                await new Promise(r => setTimeout(r, 150));
                const dans = (a, b) => Math.max(...echant.filter(e => e.ms >= a && e.ms < b).map(e => e.v), 0);
                const crete = Math.max(...echant.map(e => e.v), 0);
                // Le slide dure deux croches (500 ms à 120 BPM) : son glissement arrive dans le
                // dernier quart, vers 380-520 ms.
                return { crete, partAuGlissement: crete > 0 ? dans(380, 520) / crete : 0 };
            };
            const slide = (v1, v2, f1, f2) => [
                m.creerEvenement({ valeur: v1 }, [{ ...m.creerNote(2, f1), lien: 'slide' }]),
                m.creerEvenement({ valeur: v2 }, [m.creerNote(2, f2)]),
                m.creerEvenement({ valeur: 2 }, [], { silence: true }),
                m.creerEvenement({ valeur: 4 }, [], { silence: true }),
            ];
            return {
                note: await profil([m.creerEvenement({ valeur: 2 }, [m.creerNote(2, 5)]),
                                    m.creerEvenement({ valeur: 2 }, [], { silence: true })]),
                monte: await profil(slide(8, 8, 5, 7)),
                descend: await profil(slide(8, 8, 7, 5)),
            };
        });
        exiger(audio.note.crete > 0.01,
            `préalable : une note ordinaire sort bien du haut-parleur (crête ${audio.note.crete.toFixed(3)})`);
        check(audio.monte.crete > 0.01 && audio.descend.crete > 0.01,
            `un slide sonne, montant comme descendant (crêtes ${audio.monte.crete.toFixed(3)} et ${audio.descend.crete.toFixed(3)})`);
        // LE CŒUR DU CORRECTIF : il reste du son LÀ OÙ LA HAUTEUR GLISSE. Le seuil est posé au-dessus
        // de ce que laisse une note ordinaire au même instant (mesuré : 15 %) — sans quoi la
        // vérification passerait sur la simple traîne d'un son éteint, ce qui était exactement l'état
        // d'avant.
        check(audio.monte.partAuGlissement > 0.3,
            `et il reste du son au moment du glissement : ${Math.round(100 * audio.monte.partAuGlissement)} % de la crête (16 % avant correction, indiscernable d'une traîne)`);
        check(audio.descend.partAuGlissement > 0.3,
            `idem pour un slide descendant : ${Math.round(100 * audio.descend.partAuGlissement)} %`);

        // --- LE TIMBRE DU GLISSANDO : DU PIANO, PAS UNE ONDE --------------------------------------
        // Retour utilisateur, après une première correction qui n'avait traité que le niveau : « le son
        // du slide fait toujours un son analogique grave au lieu d'un son de piano. Peux-tu corriger
        // correctement stp ? » Et c'était exact : la note glissée s'entendait enfin, mais c'était une
        // onde triangulaire filtrée au milieu d'un piano échantillonné.
        //
        // LE CORRECTIF (voir player.js#_glissandoEchantillonne) : on joue soi-même l'échantillon de
        // piano le plus proche dans un `Tone.ToneBufferSource` et on fait GLISSER sa vitesse de
        // lecture — `playbackRate` étant un paramètre rampable, là où ni Sampler ni PolySynth
        // n'offrent de prise sur la hauteur d'une voix déjà attaquée.
        //
        // LES ÉCHANTILLONS SALAMANDER NE SE CHARGENT PAS DANS CET ENVIRONNEMENT (sortie réseau
        // bloquée, voir _page.js). On fabrique donc 17 buffers AUX MÊMES HAUTEURS et on les substitue
        // à `_buffersPiano` : le chemin de code éprouvé est le VRAI, seule la matière sonore est de
        // remplacement. Ce que ce banc ne peut donc PAS affirmer, c'est que le timbre est beau ; ce
        // qu'il affirme, et c'est le défaut signalé, c'est que la voix SYNTHÉTISÉE n'est plus celle
        // qui joue, et que la hauteur glisse bien sur l'échantillon.
        const timbre = await page.evaluate(async () => {
            const m = await import('/src/model/score.js');
            const ed = window.app.editeur, l = window.app.lecteur;
            await l.demarrer();
            const T = globalThis.Tone;
            const BASES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
            const midiDuNom = (n) => {
                const g = /^([A-G])(#|b)?(-?\d+)$/.exec(n);
                return (Number(g[3]) + 1) * 12 + BASES[g[1]] + (g[2] === '#' ? 1 : 0);
            };
            const NOMS = ['C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4',
                          'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6'];
            const sr = T.context.sampleRate;
            const urls = {};
            for (const n of NOMS) {
                const f0 = 440 * Math.pow(2, (midiDuNom(n) - 69) / 12);
                const b = T.context.createBuffer(1, Math.floor(sr * 3), sr), d = b.getChannelData(0);
                for (let i = 0; i < d.length; i++) {
                    const t = i / sr;
                    d[i] = (0.35 + 0.65 * Math.exp(-t * 0.8)) * 0.45 * Math.sin(2 * Math.PI * f0 * t);
                }
                urls[n] = new T.ToneAudioBuffer(b);
            }
            const faux = new T.ToneAudioBuffers({ urls });

            // L'ESPION EST SUR LA VOIX SYNTHÉTISÉE : c'est elle qu'on ne veut plus entendre quand les
            // échantillons sont là. Compter les glissandos ne suffirait pas — les deux voix pourraient
            // très bien sonner ENSEMBLE, et le son « analogique » serait toujours au rendez-vous.
            let appelsSynthe = 0;
            const vrai = l.voixBend.triggerAttackRelease.bind(l.voixBend);
            l.voixBend.triggerAttackRelease = (...a) => { appelsSynthe++; return vrai(...a); };

            const analyseur = T.context.createAnalyser();
            analyseur.fftSize = 8192;
            T.Destination.connect(analyseur);
            const metre = new T.Meter({ normalRange: true, smoothing: 0 });
            T.Destination.connect(metre);
            const spectre = new Float32Array(analyseur.frequencyBinCount);
            const picHz = () => {
                analyseur.getFloatFrequencyData(spectre);
                let i0 = 0;
                for (let i = 1; i < spectre.length; i++) if (spectre[i] > spectre[i0]) i0 = i;
                return Math.round(i0 * sr / analyseur.fftSize);
            };
            l.synthe.triggerAttackRelease('C3', 0.1, undefined, 0.5);   // chauffe (voir plus haut)
            await new Promise(r => setTimeout(r, 400));

            const morceau = () => [
                m.creerEvenement({ valeur: 8 }, [{ ...m.creerNote(2, 5), lien: 'slide' }]),
                m.creerEvenement({ valeur: 8 }, [m.creerNote(2, 7)]),
                m.creerEvenement({ valeur: 2 }, [], { silence: true }),
                m.creerEvenement({ valeur: 4 }, [], { silence: true }),
            ];
            const profil = async () => {
                l.arreter();
                ed.nouveau('guitare');
                ed.partition.mesures[0].voix[0].evenements = morceau();
                ed.prevenir('document');
                appelsSynthe = 0;
                const ech = [];
                let maxSources = 0;
                await l.jouer(ed.partition, 0);
                const t0 = performance.now();
                for (let i = 0; i < 70; i++) {
                    await new Promise(r => setTimeout(r, 10));
                    ech.push({ ms: performance.now() - t0, v: metre.getValue(), hz: picHz() });
                    maxSources = Math.max(maxSources, l._glissandos ? l._glissandos.size : 0);
                }
                l.arreter();
                await new Promise(r => setTimeout(r, 200));
                const crete = Math.max(...ech.map(e => e.v), 0);
                const hzVers = (a, b) => {
                    const f = ech.filter(e => e.ms >= a && e.ms < b && e.v > crete * 0.2);
                    return f.length ? f[Math.floor(f.length / 2)].hz : null;
                };
                return { crete, appelsSynthe, maxSources, hzDebut: hzVers(60, 200), hzFin: hzVers(420, 520) };
            };

            const reels = l._buffersPiano;
            l._buffersPiano = faux;
            const avec = await profil();
            l._buffersPiano = reels;              // non chargés ici : on retombe sur le repli
            const sans = await profil();

            // STOP COUPE LE GLISSANDO. Un lecteur de buffer n'est pas une voix qu'on relâche : sans le
            // registre `_glissandos` et `_taireGlissandos`, il finirait tout seul dans le silence.
            l._buffersPiano = faux;
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = morceau();
            ed.prevenir('document');
            await l.jouer(ed.partition, 0);
            await new Promise(r => setTimeout(r, 120));
            const pendant = l._glissandos.size;
            l.arreter();
            const apresStop = l._glissandos.size;
            await new Promise(r => setTimeout(r, 250));
            const niveauApresStop = metre.getValue();

            // ET RIEN NE FUIT : chaque lecteur se jette QUAND SA NOTE FINIT, sans attendre un Stop.
            //
            // LA LECTURE SE POURSUIT PENDANT LA MESURE, et c'est tout le point. Une première version
            // de cette vérification jouait huit slides en appelant `arreter()` entre chaque, puis
            // constatait un registre vide : elle passait avec le rangement neutralisé, parce que
            // c'était `_taireGlissandos` (appelé par Stop) qui vidait le registre — elle mesurait une
            // grandeur que le mécanisme éprouvé ne gouverne pas. Ici le slide finit SEUL au milieu du
            // morceau, transport toujours en marche : seul le rappel `onended` peut avoir rangé.
            ed.nouveau('guitare');
            ed.partition.mesures[0].voix[0].evenements = morceau();
            ed.prevenir('document');
            await l.jouer(ed.partition, 0);
            await new Promise(r => setTimeout(r, 150));
            const registrePendant = l._glissandos.size;
            // 1,2 s : le slide (2 croches = 500 ms) et sa queue (350 ms) sont finis depuis longtemps,
            // la mesure (4 temps = 2 s à 120 BPM) court encore.
            await new Promise(r => setTimeout(r, 1050));
            const enLecture = l.etat;
            const registreApresLaNote = l._glissandos.size;
            l.arreter();

            l._buffersPiano = reels;
            l.voixBend.triggerAttackRelease = vrai;
            // Corde 2 (sol3, midi 55) : case 5 = midi 60, case 7 = midi 62.
            return { avec, sans, stop: { pendant, apresStop, niveauApresStop },
                fuite: { registrePendant, registreApresLaNote, enLecture },
                attendu: { debut: Math.round(440 * Math.pow(2, (60 - 69) / 12)),
                           fin: Math.round(440 * Math.pow(2, (62 - 69) / 12)) } };
        });

        exiger(timbre.avec.appelsSynthe === 0,
            'échantillons chargés : la voix SYNTHÉTISÉE ne joue plus AUCUNE note glissée — c\'est le défaut signalé, littéralement');
        exiger(timbre.avec.maxSources === 1,
            `et c'est un lecteur d'échantillon de piano qui joue à sa place (${timbre.avec.maxSources} source en vol)`);
        check(timbre.avec.crete > 0.01,
            `le slide échantillonné sort bien du haut-parleur (crête ${timbre.avec.crete.toFixed(3)})`);
        // LA HAUTEUR GLISSE VRAIMENT, mesurée par analyse de spectre. Sans la rampe de `playbackRate`,
        // on lirait deux fois la même fréquence : un échantillon transposé une fois pour toutes.
        exiger(timbre.avec.hzDebut !== null && timbre.avec.hzFin !== null
            && timbre.avec.hzFin - timbre.avec.hzDebut > 15,
            `la hauteur monte pendant la note : ${timbre.avec.hzDebut} -> ${timbre.avec.hzFin} Hz (attendu ${timbre.attendu.debut} -> ${timbre.attendu.fin})`);
        check(Math.abs(timbre.avec.hzFin - timbre.attendu.fin) < 12,
            'et elle arrive à la BONNE hauteur : le taux de lecture est calculé par rapport à l\'échantillon choisi, pas à la note');

        // LE REPLI RESTE INTACT, et cette vérification compte autant que les précédentes : sans
        // échantillons (hors ligne, réseau lent) un bend doit s'entendre quand même. Une correction
        // qui aurait simplement remplacé une voix par l'autre rendrait l'application muette sur les
        // notes glissées dès que le réseau manque — ce qui est le cas de cet environnement même.
        exiger(timbre.sans.appelsSynthe === 1,
            'sans échantillons, la voix synthétisée reprend le relais : jamais de note glissée muette hors ligne');
        check(timbre.sans.maxSources === 0 && timbre.sans.crete > 0.01,
            `et elle sonne seule, sans lecteur d'échantillon (crête ${timbre.sans.crete.toFixed(3)})`);

        exiger(timbre.stop.pendant === 1 && timbre.stop.apresStop === 0,
            'Stop coupe le glissando en vol au lieu de le laisser finir seul dans le silence');
        check(timbre.stop.niveauApresStop < 0.01,
            `et le silence est réel après Stop (niveau ${timbre.stop.niveauApresStop.toFixed(4)})`);
        exiger(timbre.fuite.enLecture === 'lecture',
            'préalable de la vérification suivante : le transport tourne TOUJOURS — sans quoi ce serait Stop qui aurait rangé, pas la fin de la note');
        check(timbre.fuite.registrePendant === 1 && timbre.fuite.registreApresLaNote === 0,
            `le lecteur se jette quand SA note finit, sans attendre un Stop (${timbre.fuite.registrePendant} en vol, puis ${timbre.fuite.registreApresLaNote} en pleine lecture)`);

        check(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' — ' + erreurs.join(' | ') : ''));
    } finally { await fermer(); }
    bilan();
})().catch(err => { console.error(err); process.exit(1); });
