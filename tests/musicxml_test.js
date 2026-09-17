// Banc de l'EXPORT MUSICXML — la partition écrite, pour la rouvrir ailleurs.
//
// CE QU'IL PROTÈGE. MusicXML est le seul format que MuseScore, Finale, Sibelius, Dorico et Guitar Pro
// lisent tous, et le seul des quatre exports de TabHub qui transporte l'ÉCRITURE : le `.json` n'est
// relu que par TabHub, le PDF est une image, et le `.mid` ne porte que des hauteurs et des durées —
// ni corde, ni case, ni liaison, ni hammer-on, ni nom d'accord. Un export MusicXML faux est donc pire
// qu'absent : on croit avoir transmis sa partition, et le destinataire ouvre autre chose.
//
// D'où trois familles de vérifications, de la plus bête à la plus musicale.
//
//   1. C'EST DU XML, ET C'EST L'ARBRE ANNONCÉ. Bien formé (`DOMParser`, qui refuse une balise non
//      fermée ou un « & » nu — d'où l'échappement des cinq caractères), et l'ordre des éléments
//      respecté là où le format l'IMPOSE : `divisions, key, time, staves, clef, staff-details` dans
//      `<attributes>`, et `pitch, duration, tie, voice, type, dot, accidental, time-modification,
//      stem, notehead, staff, notations` dans `<note>`. Une permutation « plus lisible » rend le
//      fichier invalide, et le lecteur le refuse en bloc.
//
//   2. LES INVARIANTS QUI NE SE DEVINENT PAS. Le plus important : CORDE + CASE DOIT REDONNER LA
//      HAUTEUR. C'est la seule vérification qui attrape une inversion de la numérotation des cordes
//      — la 1 est la plus AIGUË chez TabHub comme en MusicXML, mais la `line` d'un `<staff-tuning>`
//      se compte depuis le BAS, donc les deux conventions se croisent et une erreur de sens y est
//      invisible à la lecture. Le banc recalcule, pour chaque note, `accord(corde) + case` et le
//      compare au `<pitch>` émis. Même esprit pour les `<backup>` : leur total doit ramener
//      exactement au début de la mesure, sinon les deux voix d'une mesure à 4/4 se retrouvent bout à
//      bout sur huit temps chez le lecteur, sans un mot d'avertissement.
//
//   3. CE QUE L'UTILISATEUR VERRA VRAIMENT. Les liaisons par-dessus une barre de mesure (le cas qui a
//      demandé tout le travail de reporterLiaison côté gravure), les n-olets et leur crochet, les
//      hammer-on / pull-off en liaison ET en technique, les slides en `<glissando>` (et non en
//      `<slide>`, qui est le portamento continu d'un trombone), les bends, les deux voix avec leurs
//      hampes opposées, les reprises et leur nombre de fois, les repères de navigation, les noms
//      d'accords en vraies `<harmony>`, l'accordage et le capodastre, et les altérations — décidées
//      par la MÊME mémoire de mesure que la gravure à l'écran, ce qui est précisément ce qui fait
//      qu'un si naturel en fa majeur reçoit son bécarre.
//
// SANS NAVIGATEUR POUR LE FOND, avec navigateur pour le DOM : le module est pur (il rend une chaîne),
// mais valider du XML demande un analyseur, et celui du navigateur est le plus proche de ce que fera
// le lecteur réel. Le banc ouvre donc une page, importe le module et analyse dans la page.
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('export MusicXML');

(async () => {
    plan(38);
    const { page, erreurs, fermer } = await ouvrirApp();
    try {
        // Un morceau d'essai qui porte TOUT ce que l'export prétend transmettre, construit par le
        // modèle lui-même — jamais à la main : une partition écrite à la main dans un banc finit par
        // ne plus ressembler à ce que l'application produit.
        const xml = await page.evaluate(async () => {
            const sc = await import('/src/model/score.js');
            const mx = await import('/src/io/musicxml.js');
            const p = sc.creerPartition('guitare');
            p.meta.titre = 'Essai & Cie';
            p.meta.artiste = 'Anonyme';
            p.meta.tempo = 96;
            p.piste.capo = 2;

            // M1 — accord, hammer-on, triolet de croches, nom d'accord, nuance, accent, note fantôme
            p.mesures[0].armure = -1;           // fa majeur : le si devient bémol
            p.mesures[0].mode = 'majeur';
            p.mesures[0].annotation = 'Couplet 1';
            p.mesures[0].repriseDebut = true;
            p.mesures[0].voix[0].evenements = [
                sc.creerEvenement({ valeur: 4 }, [sc.creerNote(0, 3), sc.creerNote(1, 5)], { accord: 'F#m7', accent: true }),
                sc.creerEvenement({ valeur: 8 }, [sc.creerNote(2, 7, { lien: 'hammer' })], { nuance: 'mf' }),
                sc.creerEvenement({ valeur: 8 }, [sc.creerNote(2, 9, { ghost: true })], { staccato: true }),
                sc.creerEvenement({ valeur: 8, nolet: { dans: 3, valent: 2 } }, [sc.creerNote(3, 2)]),
                sc.creerEvenement({ valeur: 8, nolet: { dans: 3, valent: 2 } }, [sc.creerNote(3, 4, { lien: 'slide' })]),
                sc.creerEvenement({ valeur: 8, nolet: { dans: 3, valent: 2 } }, [sc.creerNote(3, 5)]),
                sc.creerEvenement({ valeur: 4 }, [], { silence: true }),
            ];
            // M2 — DEUX VOIX, et une blanche liée PAR-DESSUS la barre vers M3
            p.mesures[1].voix[0].evenements = [
                sc.creerEvenement({ valeur: 2 }, [sc.creerNote(0, 5, { bend: { demiTons: 2 } })], { palmMute: true }),
                sc.creerEvenement({ valeur: 2 }, [sc.creerNote(0, 7, { lien: 'tie' })]),
            ];
            // LA SECONDE VOIX EST VOLONTAIREMENT PLUS COURTE QUE SA MESURE (une noire dans 4/4) —
            // l'état d'une mesure qu'on est en train d'écrire, et le seul montage qui ÉPROUVE le
            // calcul du `<backup>`. Avec deux voix pleines, un recul calculé sur la voix courante
            // plutôt que sur la précédente donne le même nombre, et la vérification passe sans rien
            // distinguer : neutralisation faite, banc resté vert. C'est le défaut que ce commentaire
            // garde nommé.
            p.mesures[1].voix.push(sc.creerVoix(4));
            p.mesures[1].voix[1].evenements = [sc.creerEvenement({ valeur: 4 }, [sc.creerNote(5, 0)])];
            p.mesures[1].repere = 'segno';
            // M3 — l'arrivée de la liaison, puis un changement de signature
            p.mesures[2].voix[0].evenements = [
                sc.creerEvenement({ valeur: 2 }, [sc.creerNote(0, 7)]),
                sc.creerEvenement({ valeur: 2 }, [], { silence: true }),
            ];
            p.mesures[3].signature = { battements: 6, unite: 8 };
            p.mesures[3].sautAvant = true;
            p.mesures[3].repriseFin = true;
            p.mesures[3].nbFois = 3;
            p.mesures[3].voix[0].evenements = [sc.creerEvenement({ valeur: 4, points: 1 }, [sc.creerNote(4, 3)]),
                                               sc.creerEvenement({ valeur: 4, points: 1 }, [], { silence: true })];
            p.mesures[3].voix[0].capaciteNoires = 3;
            window.__essai = p;
            return mx.genererMusicXML(p);
        });

        // ─────────── 1. C'est du XML, et c'est l'arbre annoncé ───────────
        const analyse = await page.evaluate((xml) => {
            const doc = new DOMParser().parseFromString(xml, 'application/xml');
            const erreur = doc.querySelector('parsererror');
            if (erreur) return { erreur: erreur.textContent.slice(0, 200) };
            const q = (sel) => [...doc.querySelectorAll(sel)];
            const enfants = (el) => [...el.children].map(c => c.tagName);
            const m1 = q('measure')[0];
            return {
                racine: doc.documentElement.tagName,
                version: doc.documentElement.getAttribute('version'),
                titre: doc.querySelector('work-title')?.textContent,
                compositeur: doc.querySelector('creator[type="composer"]')?.textContent,
                logiciel: doc.querySelector('software')?.textContent,
                nMesures: q('measure').length,
                ordreAttributs: enfants(doc.querySelector('attributes')),
                ordrePremiereNote: enfants(q('note')[0]),
                staves: doc.querySelector('staves')?.textContent,
                clefs: q('clef').map(c => `${c.querySelector('sign').textContent}${c.querySelector('clef-octave-change') ? c.querySelector('clef-octave-change').textContent : ''}`),
                divisions: doc.querySelector('divisions')?.textContent,
                tempo: doc.querySelector('sound[tempo]')?.getAttribute('tempo'),
                numerosMesures: q('measure').map(m => m.getAttribute('number')),
            };
        }, xml);
        exiger(!analyse.erreur, `le fichier est du XML BIEN FORMÉ — un « & » nu dans un titre suffit à le rendre illisible (« ${'Essai & Cie'} » est dans le morceau d'essai)${analyse.erreur ? ' — ' + analyse.erreur : ''}`);
        check(analyse.racine === 'score-partwise' && analyse.version === '3.1',
            `racine \`score-partwise\` en version 3.1 — la version que TOUT lecteur en service accepte, y compris les Finale et Sibelius d'il y a quelques années (lu : ${analyse.racine} ${analyse.version})`);
        check(analyse.titre === 'Essai & Cie',
            `le titre traverse l'échappement XML et revient INTACT : « ${analyse.titre} »`);
        check(analyse.compositeur === 'Anonyme' && analyse.logiciel === 'TabHub',
            `l'artiste part en \`creator type="composer"\` et le logiciel est nommé (lu : ${analyse.compositeur} / ${analyse.logiciel})`);
        check(analyse.nMesures === 4 && analyse.numerosMesures.join(',') === '1,2,3,4',
            `quatre mesures, numérotées à partir de 1 comme le veut le format (lu : ${analyse.numerosMesures.join(',')})`);
        check(analyse.ordreAttributs.join(' ') === 'divisions key time staves clef clef staff-details',
            `l'ORDRE dans \`<attributes>\` est celui que le format impose — divisions, key, time, staves, clef, staff-details. Une permutation, même plus lisible, rend le fichier invalide (lu : ${analyse.ordreAttributs.join(' ')})`);
        check(analyse.ordrePremiereNote.join(' ').startsWith('pitch duration voice type'),
            `et l'ordre dans \`<note>\` aussi : pitch, duration, (tie), voice, type… (lu : ${analyse.ordrePremiereNote.join(' ')})`);
        check(analyse.staves === '2' && analyse.clefs.join(' ') === 'G-1 TAB',
            `DEUX portées, une de notation et une de TABLATURE — c'est ce qui fait arriver la tablature telle quelle chez le destinataire. Et la clé de sol porte son \`clef-octave-change\` de -1 : sans lui, une partie de guitare se dessine entièrement sous la portée (lu : ${analyse.clefs.join(' ')})`);
        check(analyse.divisions === '480',
            `480 divisions par noire : toute durée que TabHub sait écrire y tombe sur un entier, triolet de triples-croches compris (lu : ${analyse.divisions})`);
        check(analyse.tempo === '96',
            `le tempo part en \`<sound tempo>\` — sans lui, le lecteur rejouerait le morceau à SON tempo par défaut (lu : ${analyse.tempo})`);

        // ─────────── 2. Les invariants qui ne se devinent pas ───────────
        const invariants = await page.evaluate((xml) => {
            const doc = new DOMParser().parseFromString(xml, 'application/xml');
            const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
            const midiDe = (el) => {
                const p = el.querySelector('pitch');
                if (!p) return null;
                return PC[p.querySelector('step').textContent]
                    + Number(p.querySelector('alter')?.textContent || 0)
                    + (Number(p.querySelector('octave').textContent) + 1) * 12;
            };
            // L'accordage tel que le FICHIER le déclare, indexé par numéro de corde — en appliquant
            // la conversion que fera le lecteur : `line` se compte depuis le bas, la corde 1 est la
            // plus aiguë, donc line = nCordes + 1 - corde.
            // LE CAPODASTRE COMPTE, et le format le dit explicitement : « capo […] changes the open
            // tuning of the strings specified by staff-tuning by the specified number of
            // half-steps ». Les cases se comptent donc DEPUIS le capodastre, exactement comme dans
            // TabHub (voir instruments.js#hauteurDeCase, `base + frette + capo`). Première version
            // de cette vérification : elle l'oubliait, et accusait l'export d'une erreur de deux
            // demi-tons sur TOUTES les notes — c'était le banc qui mesurait mal.
            const capo = Number(doc.querySelector('capo')?.textContent || 0);
            const tunings = [...doc.querySelectorAll('staff-tuning')];
            const n = tunings.length;
            const parCorde = new Map();
            for (const t of tunings) {
                const line = Number(t.getAttribute('line'));
                const midi = PC[t.querySelector('tuning-step').textContent]
                    + Number(t.querySelector('tuning-alter')?.textContent || 0)
                    + (Number(t.querySelector('tuning-octave').textContent) + 1) * 12;
                parCorde.set(n + 1 - line, midi);
            }
            // Chaque note de la portée de tablature : corde + case doit redonner la hauteur.
            const ecarts = [];
            for (const note of doc.querySelectorAll('note')) {
                const tech = note.querySelector('technical');
                if (!tech) continue;
                const corde = Number(tech.querySelector('string').textContent);
                const frette = Number(tech.querySelector('fret').textContent);
                const attendu = parCorde.get(corde) + capo + frette;
                const obtenu = midiDe(note);
                if (obtenu != null && obtenu !== attendu) ecarts.push(`corde ${corde} case ${frette} : ${obtenu} au lieu de ${attendu}`);
            }
            // Les `<backup>` : chaque flux d'une mesure doit totaliser la même durée.
            const bilans = [];
            for (const m of doc.querySelectorAll('measure')) {
                let position = 0, maxi = 0;
                const flux = [];
                for (const el of m.children) {
                    if (el.tagName === 'note') {
                        if (el.querySelector('chord')) continue;
                        position += Number(el.querySelector('duration').textContent);
                        maxi = Math.max(maxi, position);
                    } else if (el.tagName === 'backup') {
                        flux.push(position);
                        position -= Number(el.querySelector('duration').textContent);
                    }
                }
                flux.push(position);
                bilans.push({ mesure: m.getAttribute('number'), flux, maxi, retourAZero: flux.slice(0, -1).every((_, i) => true) });
            }
            return { nCordes: n, capo: doc.querySelector('capo')?.textContent, parCorde: [...parCorde.entries()], ecarts, bilans };
        }, xml);
        check(invariants.ecarts.length === 0,
            `CORDE + CASE REDONNE LA HAUTEUR, pour chacune des notes de tablature : c'est la seule vérification qui attrape une inversion de la numérotation des cordes, invisible à la lecture puisque la corde 1 est la plus aiguë et que la \`line\` d'un accordage se compte depuis le bas${invariants.ecarts.length ? ' — écarts : ' + invariants.ecarts.join(' ; ') : ''}`);
        check(invariants.nCordes === 6 && invariants.capo === '2',
            `l'accordage part corde par corde (${invariants.nCordes} cordes) et le CAPODASTRE est un élément du format, pas une note de bas de page (\`<capo>${invariants.capo}</capo>\`)`);
        const m2 = invariants.bilans.find(b => b.mesure === '2');
        exiger(!!m2, 'la mesure 2, celle qui porte deux voix, est bien dans le fichier');
        check(m2.flux.length === 4 && m2.flux.every(f => f === 1920),
            `LES QUATRE FLUX DE LA MESURE 2 totalisent exactement la même durée (deux voix × deux portées, 1920 = quatre noires) : un \`<backup>\` faux met les deux voix bout à bout sur huit temps chez le lecteur, sans un mot (lu : ${JSON.stringify(m2.flux)})`);
        const m4 = invariants.bilans.find(b => b.mesure === '4');
        check(m4 && m4.flux.every(f => f === 1440),
            `et la mesure à 6/8 totalise 1440, soit trois noires — la capacité suit la SIGNATURE, pas un 4/4 supposé (lu : ${JSON.stringify(m4?.flux)})`);

        // ─────────── 3. Ce que l'utilisateur verra vraiment ───────────
        const musique = await page.evaluate((xml) => {
            const doc = new DOMParser().parseFromString(xml, 'application/xml');
            const q = (sel) => [...doc.querySelectorAll(sel)];
            const mesures = q('measure');
            const notesDe = (i, staff) => [...mesures[i].querySelectorAll('note')]
                .filter(n => (n.querySelector('staff')?.textContent || '1') === String(staff));
            return {
                // n-olets
                timeMod: q('time-modification').length,
                noletDebut: q('tuplet[type="start"]').length,
                noletFin: q('tuplet[type="stop"]').length,
                noletCrochet: q('tuplet[type="start"]')[0]?.getAttribute('bracket'),
                // liaison par-dessus la barre : départ en M2, arrivée en M3
                tieDepartM2: notesDe(1, 1).some(n => n.querySelector('tie[type="start"]')),
                tieArriveeM3: notesDe(2, 1).some(n => n.querySelector('tie[type="stop"]')),
                tiedArriveeM3: notesDe(2, 1).some(n => n.querySelector('tied[type="stop"]')),
                // hammer-on : liaison sur la portée de notation, technique sur la tablature
                slurNotation: notesDe(0, 1).some(n => n.querySelector('slur[type="start"]')),
                hammerTab: notesDe(0, 2).some(n => n.querySelector('technical hammer-on[type="start"]')),
                hammerNotation: notesDe(0, 1).some(n => n.querySelector('hammer-on')),
                // slide en glissando
                glissando: q('glissando').length,
                slideElement: q('slide').length,
                // bend
                bend: q('bend bend-alter')[0]?.textContent,
                // deux voix, hampes opposées
                voixM2: [...new Set(notesDe(1, 1).map(n => n.querySelector('voice').textContent))],
                // LES NOTES SEULEMENT, pas les silences : un silence n'a pas de hampe, et le
                // compléter à la mesure en ajoute maintenant plusieurs (voir le montage).
                hampesM2: [...new Set(notesDe(1, 1).filter(n => n.querySelector('pitch')).map(n => n.querySelector('stem')?.textContent))],
                voixTabM2: [...new Set(notesDe(1, 2).map(n => n.querySelector('voice').textContent))],
                // altérations : fa majeur, la note si doit être bémol dans l'armure
                fifths: doc.querySelector('fifths')?.textContent,
                mode: doc.querySelector('mode')?.textContent,
                accidentals: q('accidental').map(a => a.textContent),
                // reprises et repères
                repriseAvant: !!doc.querySelector('barline[location="left"] repeat[direction="forward"]'),
                repriseApres: doc.querySelector('repeat[direction="backward"]')?.getAttribute('times'),
                segno: q('direction-type segno').length,
                // signature qui change en cours de morceau
                signatures: q('time').map(t => `${t.querySelector('beats').textContent}/${t.querySelector('beat-type').textContent}`),
                saut: q('print[new-system="yes"]').length,
                // noms d'accords, annotations, P.M., nuances, notes fantômes
                harmonie: (() => {
                    const h = doc.querySelector('harmony');
                    if (!h) return null;
                    return { root: h.querySelector('root-step')?.textContent, alter: h.querySelector('root-alter')?.textContent, kind: h.querySelector('kind')?.textContent };
                })(),
                nHarmonies: q('harmony').length,
                mots: q('words').map(w => w.textContent),
                nuance: q('dynamics > *').map(d => d.tagName),
                fantome: q('notehead[parentheses="yes"]').length,
                accent: q('articulations accent').length,
                staccato: q('articulations staccato').length,
                // silences
                silences: q('note rest').length,
            };
        }, xml);

        check(musique.timeMod === 6 && musique.noletDebut === 2 && musique.noletFin === 2 && musique.noletCrochet === 'yes',
            `LE TRIOLET : ses trois notes portent chacune la \`<time-modification>\` qui fixe leur durée, sur les DEUX portées (${musique.timeMod} = 3 × 2) — mais le crochet ne s'ouvre et ne se referme qu'UNE FOIS PAR PORTÉE (${musique.noletDebut} début, ${musique.noletFin} fin, soit une par portée) : un « 3 » par note serait illisible. Et il reste sur la tablature, contrairement aux accents : une tablature qui montrerait trois croches dans le temps de deux sans son « 3 » serait fausse à la lecture`);
        check(musique.tieDepartM2 && musique.tieArriveeM3 && musique.tiedArriveeM3,
            `LA LIAISON FRANCHIT LA BARRE : elle part en mesure 2 et arrive en mesure 3, avec \`<tie>\` (ce qui sonne) ET \`<tied>\` (ce qui se dessine). Beaucoup d'exports n'écrivent que le second, et le fichier se rejoue alors en notes répétées`);
        check(musique.slurNotation && musique.hammerTab && !musique.hammerNotation,
            `LE HAMMER-ON EST DEUX CHOSES à la fois, et chacune à sa place : un ARC sur la portée de notation (une seule attaque pour deux notes) et un \`<hammer-on>\` dans la \`<technical>\` de la TABLATURE, avec la corde et la case (arc ${musique.slurNotation}, technique ${musique.hammerTab}, technique sur la notation ${musique.hammerNotation})`);
        check(musique.glissando === 4 && musique.slideElement === 0,
            `LE SLIDE EST UN \`<glissando>\`, PAS UN \`<slide>\` : les deux existent dans le format, mais \`<slide>\` est le portamento continu d'un trombone, là où \`<glissando>\` passe par les hauteurs intermédiaires — un slide de guitare, précisément (${musique.glissando} glissandos, ${musique.slideElement} slides)`);
        check(musique.bend === '2',
            `le bend part en demi-tons dans \`<bend-alter>\` (lu : ${musique.bend})`);
        check(musique.voixM2.join(',') === '1,2' && musique.hampesM2.sort().join(',') === 'down,up',
            `DEUX VOIX sur la portée de notation, avec les hampes OPPOSÉES — c'est ainsi que TabHub les grave, et ce qui les rend lisibles (voix ${musique.voixM2.join(',')}, hampes ${musique.hampesM2.join(',')})`);
        check(musique.voixTabM2.join(',') === '5,6',
            `et la tablature prend les voix 5 et 6 : c'est la convention de MuseScore et de Guitar Pro, deux portées qui partageraient les mêmes numéros fusionneraient à la lecture (lu : ${musique.voixTabM2.join(',')})`);
        check(musique.fifths === '-1' && musique.mode === 'major',
            `l'armure part avec son MODE — c'est lui qui distingue deux relatives, que l'armure seule ne sait pas départager (lu : ${musique.fifths} ${musique.mode})`);
        check(musique.signatures.join(' ') === '4/4 6/8',
            `la signature CHANGE en cours de morceau, et l'export ne réécrit que ce qui change — comme une vraie gravure (lu : ${musique.signatures.join(' ')})`);
        check(musique.repriseAvant && musique.repriseApres === '3',
            `les reprises partent des DEUX côtés, avec leur nombre de fois (ouvrante ${musique.repriseAvant}, fermante ×${musique.repriseApres})`);
        check(musique.segno === 1, `le Segno part comme un vrai \`<segno>\`, pas comme du texte (lu : ${musique.segno})`);
        check(musique.saut === 1,
            `le retour à la ligne DEMANDÉ part en \`<print new-system="yes">\` — le seul élément de mise en page qu'on impose au lecteur, parce que c'est le seul que l'utilisateur a demandé explicitement (lu : ${musique.saut})`);
        check(musique.harmonie && musique.harmonie.root === 'F' && musique.harmonie.alter === '1' && musique.harmonie.kind === 'minor-seventh',
            `« F#m7 » devient une VRAIE harmonie — fa, dièse, septième mineure — et non une étiquette de texte : en \`<harmony>\` MuseScore la transpose avec le morceau et peut la réaliser (lu : ${JSON.stringify(musique.harmonie)})`);
        check(musique.nHarmonies === 1,
            `et une seule fois, sur la portée de notation : écrite deux fois (une par portée) elle s'afficherait en double (lu : ${musique.nHarmonies})`);
        check(musique.mots.includes('Couplet 1') && musique.mots.includes('P.M.'),
            `l'annotation de section et le palm mute partent en texte placé — ce que le format prévoit quand il n'a pas d'élément dédié (lu : ${JSON.stringify(musique.mots)})`);
        check(musique.nuance.join(',') === 'mf',
            `la nuance part comme un élément de \`<dynamics>\`, pas comme les deux lettres « mf » (lu : ${musique.nuance.join(',')})`);
        check(musique.fantome === 2 && musique.accent === 1 && musique.staccato === 1,
            `NOTE FANTÔME SUR LES DEUX PORTÉES, ACCENT ET STACCATO SUR UNE SEULE, et la distinction se défend : une tête entre parenthèses est la NOTE elle-même (elle se lit en tablature comme sur la portée), un accent est un SIGNE posé au-dessus — écrit une fois par portée, il s'affiche deux fois (lu : ${musique.fantome} fantômes / ${musique.accent} accent / ${musique.staccato} staccato)`);
        check(musique.silences >= 6,
            `les silences sont des \`<rest>\` explicites, y compris celui qui COMPLÈTE une mesure plus courte que sa capacité : sans lui le lecteur décale la suite du morceau (lu : ${musique.silences})`);

        // ─────────── Les altérations : la même règle qu'à l'écran ───────────
        const alterations = await page.evaluate(async () => {
            const sc = await import('/src/model/score.js');
            const mx = await import('/src/io/musicxml.js');
            const p = sc.creerPartition('guitare');
            // Fa majeur (armure -1) : le si est bémol. Un SI NATUREL y a donc besoin d'un bécarre,
            // et son altération vaut ZÉRO — le piège exact que `ecrireHauteur().accidentelle` ne
            // sait pas voir, et que la mémoire de mesure attrape.
            p.mesures[0].armure = -1;
            p.mesures[0].voix[0].evenements = [
                sc.creerEvenement({ valeur: 4 }, [sc.creerNote(1, 0)]),   // corde 2 à vide = si naturel
                sc.creerEvenement({ valeur: 4 }, [sc.creerNote(1, 0)]),   // le MÊME si : rien à redire
                sc.creerEvenement({ valeur: 4 }, [sc.creerNote(1, 1)]),   // do
                sc.creerEvenement({ valeur: 4 }, [sc.creerNote(1, 3)]),   // ré
            ];
            const doc = new DOMParser().parseFromString(mx.genererMusicXML(p), 'application/xml');
            const staff1 = [...doc.querySelectorAll('note')].filter(n => n.querySelector('staff')?.textContent === '1');
            return staff1.map(n => n.querySelector('accidental')?.textContent || '-');
        });
        check(alterations[0] === 'natural',
            `UN SI NATUREL EN FA MAJEUR REÇOIT SON BÉCARRE. C'est le cas qui condamne la solution naïve : l'altération de cette note vaut ZÉRO, donc tout export qui écrit « l'altération si elle n'est pas nulle » l'oublie en silence. L'export passe par la MÊME mémoire de mesure que la gravure à l'écran (lu : ${alterations[0]})`);
        check(alterations[1] === '-',
            `et le si SUIVANT, dans la même mesure, n'en reçoit pas un second : une altération vaut jusqu'à la barre, règle de notation vieille de trois siècles (lu : ${alterations[1]})`);

        // ─────────── L'analyse des noms d'accords ───────────
        const accords = await page.evaluate(async () => {
            const mx = await import('/src/io/musicxml.js');
            const cas = ['C', 'Am', 'G7', 'Fmaj7', 'Bbm7b5', 'D#dim7', 'Esus4', 'G/B', 'A5', 'Cwhatever'];
            return cas.map(t => {
                const a = mx.analyserAccord(t);
                return `${t}=${a ? a.lettre + (a.alter || '') + ':' + a.kind + (a.basse ? '/' + a.basse.lettre : '') : 'null'}`;
            });
        });
        check(accords.join(' ') === 'C=C:major Am=A:minor G7=G:dominant Fmaj7=F:major-seventh Bbm7b5=B-1:half-diminished D#dim7=D1:diminished-seventh Esus4=E:suspended-fourth G/B=G:major/B A5=A:power Cwhatever=C:other',
            `dix noms d'accords analysés juste, du plus banal au plus tordu — et ce qu'on ne sait pas lire n'est PAS perdu : \`kind\` vaut alors \`other\` et garde le texte d'origine, ce que le format prévoit exactement pour ce cas (lu : ${accords.join(' ')})`);

        // ─────────── Piano et basse : deux portées, mais pas les mêmes ───────────
        const autres = await page.evaluate(async () => {
            const sc = await import('/src/model/score.js');
            const mx = await import('/src/io/musicxml.js');
            const lire = (id) => {
                const p = sc.creerPartition(id);
                const doc = new DOMParser().parseFromString(mx.genererMusicXML(p), 'application/xml');
                return {
                    clefs: [...doc.querySelectorAll('clef')].map(c => c.querySelector('sign').textContent).join(','),
                    staves: doc.querySelector('staves')?.textContent || '1',
                    tab: !!doc.querySelector('staff-details'),
                    nom: doc.querySelector('part-name')?.textContent,
                };
            };
            return { piano: lire('piano'), basse: lire('basse4') };
        });
        check(autres.piano.clefs === 'G,F' && autres.piano.staves === '2' && !autres.piano.tab,
            `LE PIANO N'A PAS DE TABLATURE : ses deux portées sont les deux MAINS (clé de sol, clé de fa), pas une notation doublée d'une tablature — et il n'a donc ni accordage ni capodastre (lu : ${JSON.stringify(autres.piano)})`);
        check(autres.basse.clefs === 'F,TAB' && autres.basse.nom === 'Basse 4 cordes',
            `LA BASSE, elle, a bien sa tablature, sous une clé de FA — et son nom de partie est celui de l'instrument choisi (lu : ${JSON.stringify(autres.basse)})`);
        const lignesBasse = await page.evaluate(async () => {
            const sc = await import('/src/model/score.js');
            const mx = await import('/src/io/musicxml.js');
            const doc = new DOMParser().parseFromString(mx.genererMusicXML(sc.creerPartition('basse4')), 'application/xml');
            return doc.querySelector('staff-lines')?.textContent;
        });
        check(lignesBasse === '4',
            `et sa tablature a QUATRE lignes, pas six : le nombre de cordes vient de l'accordage réel, jamais d'un gabarit de guitare (lu : ${lignesBasse})`);

        // ─────────── Le morceau vide, et le bout par bout ───────────
        const vide = await page.evaluate(async () => {
            const sc = await import('/src/model/score.js');
            const mx = await import('/src/io/musicxml.js');
            const xml = mx.genererMusicXML(sc.creerPartition('guitare'));
            const doc = new DOMParser().parseFromString(xml, 'application/xml');
            return { erreur: !!doc.querySelector('parsererror'), mesures: doc.querySelectorAll('measure').length,
                     silences: doc.querySelectorAll('note rest').length };
        });
        check(!vide.erreur && vide.mesures === 4 && vide.silences === 8,
            `un morceau VIERGE s'exporte aussi, et ses quatre mesures vides deviennent quatre silences par portée — pas des mesures sans contenu, que certains lecteurs refusent (lu : ${vide.mesures} mesures, ${vide.silences} silences)`);

        // ─────────── Et le bouton du menu Fichiers ───────────
        await page.click('#btn-fichiers');
        await page.waitForTimeout(120);
        const entree = await page.evaluate(() => {
            const b = document.querySelector('#popover-fichiers [data-action="musicxml-exporter"]');
            if (!b) return null;
            const midi = document.querySelector('#popover-fichiers [data-action="midi-exporter"]');
            return { libelle: b.textContent.trim(), apresLeMidi: !!(midi && midi.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) };
        });
        exiger(!!entree, 'l\'export a son entrée dans le menu Fichiers — un module que rien n\'appelle n\'existe pas pour l\'utilisateur');
        check(entree.libelle.includes('MusicXML') && entree.apresLeMidi,
            `libellée avec son extension et placée SOUS le MIDI : le MIDI porte ce que le morceau sonne, MusicXML ce qu'il est écrit — c'est ce dernier qu'on envoie à un professeur ou qu'on ouvre dans MuseScore (lu : « ${entree.libelle} »)`);
        const telechargement = await (async () => {
            const attente = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
            await page.click('#popover-fichiers [data-action="musicxml-exporter"]');
            const d = await attente;
            return d ? d.suggestedFilename() : null;
        })();
        check(telechargement && telechargement.endsWith('.musicxml'),
            `et un clic télécharge vraiment un fichier nommé d'après le morceau (lu : ${telechargement})`);

        check(erreurs.length === 0, 'aucune erreur JavaScript');
    } finally { await fermer(); }
    bilan();
})();
