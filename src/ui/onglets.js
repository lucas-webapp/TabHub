// LA BARRE D'ONGLETS — plusieurs morceaux ouverts à la fois, sous la barre d'outils.
//
// POURQUOI (retour utilisateur) : « permets-moi de travailler sur plusieurs onglets en même temps
// (comme sur GuitarPro), cela me permettra de comparer des versions par exemple. Je pense que les
// onglets doivent être placés sous la barre d'outils. Sur téléphone, ne pas mettre cette option qui
// prend trop de place à l'écran. »
//
// CE MODULE NE TIENT AUCUN ÉTAT. Il DESSINE une liste d'intitulés et rend les clics : quel onglet est
// actif, ce que chacun contient, qui a le droit de se fermer — tout cela vit dans main.js, qui a
// l'éditeur sous la main. C'est la même discipline que ui/toolbar.js : la couche ui/ met en forme, la
// décision reste chez celui qui connaît le document.
//
// PAS SUR TÉLÉPHONE, et c'est une règle de style.css (voir .barre-onglets) plutôt qu'un test
// JavaScript : la barre disparaît sous 720px ou au doigt, et sa rangée de grille se referme d'elle-
// même (gabarit `auto` sur un élément `display: none`), exactement comme celle du pavé tactile. Un
// test dans le code aurait demandé de le rejouer à chaque redimensionnement, pour le même résultat.
//
// LES ONGLETS NON MONTRÉS NE SONT PAS PERDUS : ils restent en mémoire et dans le brouillon. Un
// utilisateur qui passerait d'un grand écran à un téléphone ne voit plus que celui sur lequel il
// travaillait, et les retrouve dès que l'écran est assez large. Rien n'est effacé en silence.

import { icone } from './icons.js';

/** Intitulé affiché d'un onglet : le titre du morceau, ou « Sans titre » comme partout ailleurs. */
export function titreOnglet(partition) {
    const t = (partition?.meta?.titre || '').trim();
    return t || 'Sans titre';
}

/**
 * (Re)dessine la barre. Appelée à chaque changement de document ou de titre — reconstruire une
 * poignée de boutons coûte moins qu'un mécanisme de mise à jour fine, et supprime la classe de
 * bogues où l'affichage et l'état finissent par ne plus dire la même chose.
 *
 * @param {HTMLElement} hote la barre elle-même.
 * @param {{titres: string[], actif: number}} etat
 * @param {{surActiver: (i:number)=>void, surFermer: (i:number)=>void, surNouveau: ()=>void}} actions
 */
export function rendreOnglets(hote, etat, actions) {
    hote.innerHTML = '';
    const { titres, actif } = etat;
    titres.forEach((titre, i) => {
        const onglet = document.createElement('div');
        onglet.className = 'onglet' + (i === actif ? ' actif' : '');
        onglet.dataset.onglet = String(i);

        const nom = document.createElement('button');
        nom.type = 'button';
        nom.className = 'onglet-nom';
        nom.textContent = titre;
        // Le titre COMPLET en infobulle : un intitulé d'onglet est tronqué par force (voir
        // .onglet-nom dans style.css), et deux versions d'un même morceau ont souvent des titres qui
        // ne se distinguent qu'à la fin.
        nom.title = titre;
        nom.setAttribute('aria-current', i === actif ? 'true' : 'false');
        nom.addEventListener('click', () => actions.surActiver(i));
        onglet.appendChild(nom);

        // LA CROIX N'APPARAÎT PAS SUR LE DERNIER ONGLET : il y a toujours un morceau ouvert, comme il
        // y a toujours au moins une mesure (voir supprimerMesure). Un bouton qui serait là sans
        // pouvoir agir apprend à cliquer dans le vide.
        if (titres.length > 1) {
            const fermer = document.createElement('button');
            fermer.type = 'button';
            fermer.className = 'onglet-fermer';
            fermer.innerHTML = icone('fermer');
            fermer.title = `Fermer « ${titre} »`;
            fermer.setAttribute('aria-label', fermer.title);
            fermer.addEventListener('click', (e) => { e.stopPropagation(); actions.surFermer(i); });
            onglet.appendChild(fermer);
        }
        hote.appendChild(onglet);
    });

    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'onglet-nouveau';
    plus.id = 'btn-nouvel-onglet';
    plus.innerHTML = icone('plus');
    plus.title = 'Ouvrir un morceau de plus dans un nouvel onglet';
    plus.setAttribute('aria-label', plus.title);
    plus.addEventListener('click', () => actions.surNouveau());
    hote.appendChild(plus);
}
