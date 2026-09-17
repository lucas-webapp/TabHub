// Banc de la VITESSE DE TRAVAIL — jouer à 25, 50, 75 ou 100 % du tempo écrit.
//
// CE QU'IL PROTÈGE, ET C'EST UNE SEULE CHOSE EN DEUX MOITIÉS : que ralentir change ce qu'on ENTEND
// et rien de ce qui est ÉCRIT. Le défaut auquel cette fonction répond n'est pas l'absence de
// réglage — on pouvait déjà taper 60 dans le champ Tempo pour travailler un passage — mais le prix
// de ce détour : le tempo du champ est celui de la PARTITION. Il part dans le .json, dans le PDF,
// dans le MIDI, et se retrouve à l'ouverture suivante comme si le morceau était lent. D'où deux
// nombres séparés (voir audio/player.js, la vitesse de travail) et ce banc, qui vérifie des deux
// côtés de la séparation :
//
//   CE QUI SONNE — `Tone.Transport.bpm` vaut bien tempo × vitesse, et le changement s'applique même
//   en pleine lecture (Tone réétire son horloge, rien n'est reprogrammé).
//   CE QUI EST ÉCRIT — `meta.tempo`, le champ Tempo et l'export MIDI ne bougent pas d'un iota.
//
// LE PIÈGE QU'IL GARDE, nommément : `programmer()` posait `Tone.Transport.bpm` en direct, et chaque
// lancement de lecture passe par là. Une vitesse choisie avant d'appuyer sur Lecture était donc
// effacée à la première note — sans rien dire. C'est la vérification « la lecture ne remet pas la
// vitesse à 100 % » ci-dessous ; elle échoue si l'affectation directe revient un jour.
//
// ET LA PLACE DU BOUTON, mesurée, parce qu'elle a déjà changé une fois pour cette raison : le bouton
// « 100 % » pèse 46px, et la barre du bas n'a que 19px de jeu à 320px. Posé dans le bloc de lecture
// il la faisait déborder de 56px à 320, 63 à 360 et 33 à 390 (mesuré largeur par largeur). Il reste
// donc sur grand écran, et le rang de valeurs rejoint sur téléphone le popover voisin, dont le
// bouton est déjà dans la barre. Les deux moitiés sont éprouvées : le bouton et son popover à
// 1320px, l'absence de débordement ET l'accès au rang à 320/360/390.
const creerHarnais = require('./_harness.js');
const { ouvrirApp } = require('./_page.js');
const { check, exiger, plan, bilan } = creerHarnais('vitesse de travail');

(async () => {
    plan(26);

    // ───────────────────────── ORDINATEUR ─────────────────────────
    {
        const { page, erreurs, fermer } = await ouvrirApp();
        try {
            const etat = () => page.evaluate(() => {
                const v = document.getElementById('btn-vitesse');
                const l = window.app.lecteur;
                return {
                    libelle: v.textContent.trim(),
                    ralenti: v.classList.contains('ralenti'),
                    vitesse: l.vitesse,
                    tempoEcrit: l.tempoEcrit,
                    metaTempo: window.app.editeur.partition.meta.tempo,
                    champTempo: document.getElementById('champ-tempo').value,
                    bpm: globalThis.Tone?.Transport ? Tone.Transport.bpm.value : null,
                    hoteOuvert: document.getElementById('groupe-vitesse-hote').classList.contains('ouvert'),
                };
            });

            const depart = await etat();
            check(depart.libelle === '100 %' && !depart.ralenti,
                `au départ le bouton dit « 100 % » et ne s'accentue pas — 100 % est le cas de tout le monde, il doit se taire (lu : « ${depart.libelle} », ralenti ${depart.ralenti})`);
            check(depart.vitesse === 1, 'et la vitesse part bien à 100 % : elle n\'est PAS persistée, pour qu\'un rechargement ne rouvre jamais l\'appli en train de jouer lentement sans rien pour l\'expliquer');

            // — le popover —
            const visible = await page.evaluate(() => {
                const v = document.getElementById('btn-vitesse');
                const r = v.getBoundingClientRect();
                const bloc = document.getElementById('bloc-lecture').getBoundingClientRect();
                return { affiche: getComputedStyle(v).display !== 'none', w: Math.round(r.width),
                         dansLeBloc: r.left >= bloc.left - 1 && r.right <= bloc.right + 1 };
            });
            exiger(visible.affiche && visible.dansLeBloc,
                `le bouton de vitesse est visible DANS le bloc de lecture sur grand écran — c'est une commande de lecture, elle vit avec Lecture/Stop (${visible.w}px)`);
            await page.click('#btn-vitesse');
            await page.waitForTimeout(120);
            const pop = await page.evaluate(() => {
                const h = document.getElementById('groupe-vitesse-hote');
                const r = h.getBoundingClientRect();
                return {
                    ouvert: h.classList.contains('ouvert'),
                    visible: r.width > 0 && r.height > 0,
                    dansEcran: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
                    valeurs: [...h.querySelectorAll('button')].map(b => b.textContent.trim()),
                    etiquetteCachee: getComputedStyle(h.querySelector('.etiquette-popover')).display === 'none',
                };
            });
            exiger(pop.ouvert && pop.visible,
                'un clic ouvre le rang des valeurs — et il est RÉELLEMENT dessiné : c\'est le contenant qui porte `.ouvert`, parce qu\'un enfant `position: fixed` sous un parent `display: none` n\'est pas rendu du tout');
            check(pop.dansEcran, 'et le popover tombe ENTIÈREMENT dans l\'écran, pas à moitié dehors');
            check(pop.valeurs.join(' ') === '100 % 75 % 50 % 25 %',
                `quatre valeurs, du tempo écrit au plancher : un rang de boutons, jamais un menu déroulant (lu : « ${pop.valeurs.join(' ')} »)`);
            check(pop.etiquetteCachee,
                'l\'étiquette « Vitesse de lecture » ne paraît PAS ici : le bouton qui vient d\'ouvrir le popover porte déjà le pourcentage, juste au-dessus');

            // — choisir 50 % —
            await page.click('#groupe-vitesse button:nth-child(3)');
            await page.waitForTimeout(120);
            const demi = await etat();
            check(demi.vitesse === 0.5, `choisir « 50 % » pose la vitesse à 0,5 (lu : ${demi.vitesse})`);
            check(demi.bpm === 60, `et l'HORLOGE tombe à 60 bpm — c'est ce qu'on entend (lu : ${demi.bpm})`);
            check(demi.metaTempo === 120 && demi.tempoEcrit === 120,
                `mais le tempo ÉCRIT reste 120 : c'est toute la raison d'être de ce réglage (meta ${demi.metaTempo}, écrit ${demi.tempoEcrit})`);
            check(demi.champTempo === '120',
                `et le champ Tempo affiche toujours 120 — s'il avait bougé, la partition aurait changé (lu : « ${demi.champTempo} »)`);
            check(demi.libelle === '50 %' && demi.ralenti,
                `le bouton montre « 50 % » ET s'accentue : une lecture ralentie qui ne se voit pas est un piège — on rejoue un passage, on le trouve facile, et on ne comprend qu'à la scène qu'on ne l'a jamais joué au tempo (lu : « ${demi.libelle} », ralenti ${demi.ralenti})`);
            check(!demi.hoteOuvert, 'un choix fait referme le popover derrière lui, comme les autres rangs de l\'application');
            const actif = await page.evaluate(() => [...document.querySelectorAll('#groupe-vitesse button')]
                .filter(b => b.classList.contains('actif')).map(b => b.textContent.trim()));
            check(actif.length === 1 && actif[0] === '50 %',
                `et un seul bouton du rang est marqué actif, celui qu'on a choisi (lu : ${JSON.stringify(actif)})`);

            // — LE PIÈGE : la lecture ne doit pas effacer la vitesse —
            await page.click('#btn-jouer');
            await page.waitForTimeout(500);
            const enLecture = await etat();
            check(enLecture.vitesse === 0.5 && enLecture.bpm === 60,
                `LA LECTURE NE REMET PAS LA VITESSE À 100 % : \`programmer()\` repose le tempo à chaque lancement, et le posait en direct sur l'horloge — une vitesse choisie avant d'appuyer sur Lecture était effacée à la première note, sans rien dire (vitesse ${enLecture.vitesse}, horloge ${enLecture.bpm})`);
            check(enLecture.metaTempo === 120,
                'et jouer ralenti n\'écrit rien dans la partition (meta.tempo intact)');

            // — changer de vitesse EN PLEINE LECTURE —
            const avantChangement = await page.evaluate(() => window.app.lecteur.etat);
            await page.evaluate(() => { window.app.lecteur.definirVitesse(0.25); window.app.rafraichirBoutonVitesse(); });
            await page.waitForTimeout(200);
            const enCours = await etat();
            check(enCours.bpm === 30 && enCours.vitesse === 0.25,
                `on peut ralentir SANS ARRÊTER : Tone réétire son horloge, rien n'est reprogrammé — 120 × 0,25 = 30 bpm (lu : ${enCours.bpm})`);
            check(avantChangement === 'lecture' && (await page.evaluate(() => window.app.lecteur.etat)) === 'lecture',
                'et la lecture ne s\'est pas interrompue au passage : c\'est exactement la manière dont on travaille un passage en boucle');
            await page.click('#btn-stop');
            await page.waitForTimeout(150);

            // — les bornes —
            const bornes = await page.evaluate(() => {
                const l = window.app.lecteur;
                const trop = l.definirVitesse(4);
                const rien = l.definirVitesse(0);
                const nimporte = l.definirVitesse('abc');
                l.definirVitesse(1);
                return { trop, rien, nimporte };
            });
            check(bornes.trop === 1, `au-delà de 100 % la vitesse est ramenée à 1 : ce réglage existe pour RALENTIR, jouer plus vite que l'écrit se fait en écrivant le bon tempo (lu : ${bornes.trop})`);
            check(bornes.rien === 0.25, `et sous le plancher elle est ramenée à 25 % — au quart d'un tempo lent, les notes cessent de former une phrase (lu : ${bornes.rien})`);
            check(bornes.nimporte === 1, `une valeur qui n'est pas un nombre retombe à 100 % plutôt que de rendre l'horloge NaN (lu : ${bornes.nimporte})`);

            // — LE TEMPO ÉCRIT DOIT SORTIR INTACT : l'export MIDI, où il est un octet —
            const midi = await page.evaluate(() => {
                const l = window.app.lecteur;
                l.definirVitesse(0.5);
                // On lit le tempo tel que l'export le calcule, sans passer par un téléchargement :
                // c'est `meta.tempo` qui fait foi, et c'est bien ce qu'on veut prouver.
                return { meta: window.app.editeur.partition.meta.tempo, vitesse: l.vitesse, horloge: Tone.Transport.bpm.value };
            });
            check(midi.meta === 120 && midi.vitesse === 0.5 && midi.horloge === 60,
                `à 50 %, les deux nombres coexistent sans se mélanger : la partition dit 120 (c'est ce que le .json, le PDF et le MIDI exportent), l'horloge joue 60 (lu : ${midi.meta} / ${midi.horloge})`);

            check(erreurs.length === 0, 'aucune erreur JavaScript sur grand écran');
        } finally { await fermer(); }
    }

    // ───────────────────────── TÉLÉPHONE ─────────────────────────
    // TROIS LARGEURS, parce que le débordement de la barre du bas est précisément ce qui a décidé de
    // la place de cette commande : 320 (iPhone SE, le plus petit en service), 360 et 390.
    for (const largeur of [320, 360, 390]) {
        const { page, erreurs, fermer } = await ouvrirApp({ viewport: { width: largeur, height: 844 }, hasTouch: true, isMobile: true });
        try {
            const barre = await page.evaluate(() => {
                const t = document.querySelector('.transport');
                return { deborde: t.scrollWidth - t.clientWidth,
                         boutonVitesse: getComputedStyle(document.getElementById('btn-vitesse')).display };
            });
            check(barre.deborde === 0 && barre.boutonVitesse === 'none',
                `à ${largeur}px la barre du bas ne déborde PAS (${barre.deborde}px) et le bouton de vitesse n'y est pas : ses 46px auraient coûté 56 à 63px de débordement, à prendre sur Lecture/Stop — un réglage qu'on touche deux fois par séance ne se paie pas sur les deux boutons les plus visés de l'application`);

            await page.tap('#btn-mesures-ligne-bascule');
            await page.waitForTimeout(150);
            const dedans = await page.evaluate(() => {
                const h = document.getElementById('groupe-vitesse-hote');
                const g = document.getElementById('groupe-mesures-ligne');
                const r = g.getBoundingClientRect();
                const rh = h.getBoundingClientRect();
                return {
                    section: getComputedStyle(h).display !== 'none' && rh.width > 0 && rh.height > 0,
                    etiquette: h.querySelector('.etiquette-popover')?.textContent.trim(),
                    etiquetteVue: getComputedStyle(h.querySelector('.etiquette-popover')).display !== 'none',
                    dansEcran: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
                };
            });
            exiger(dedans.section,
                `à ${largeur}px le rang de vitesse est atteignable dans le popover voisin, dont le bouton est DÉJÀ dans la barre — zéro pixel de plus, même raisonnement que les loupes`);
            check(dedans.etiquetteVue && dedans.etiquette === 'Vitesse de lecture',
                `et il porte ICI une étiquette visible (« ${dedans.etiquette} ») : dans un popover qui contient déjà un zoom, « 100 75 50 25 % » se lirait comme un second zoom — le défaut même que l'étiquette « Affichage » a corrigé`);
            check(dedans.dansEcran, `et le popover entier tient dans l'écran à ${largeur}px`);

            if (largeur === 360) {
                await page.tap('#groupe-vitesse button:nth-child(3)');
                await page.waitForTimeout(150);
                const apres = await page.evaluate(() => ({
                    vitesse: window.app.lecteur.vitesse,
                    bpm: Tone.Transport.bpm.value,
                    meta: window.app.editeur.partition.meta.tempo,
                    deborde: (() => { const t = document.querySelector('.transport'); return t.scrollWidth - t.clientWidth; })(),
                }));
                check(apres.vitesse === 0.5 && apres.bpm === 60 && apres.meta === 120,
                    `et le choix marche AU DOIGT comme à la souris : 50 %, horloge à 60, partition toujours à 120 (lu : ${apres.vitesse} / ${apres.bpm} / ${apres.meta})`);
                check(apres.deborde === 0,
                    `ralentir ne fait rien apparaître dans la barre — donc rien à faire défiler, même à 360px (${apres.deborde}px)`);
            }
            check(erreurs.length === 0, `aucune erreur JavaScript à ${largeur}px`);
        } finally { await fermer(); }
    }

    bilan();
})();
