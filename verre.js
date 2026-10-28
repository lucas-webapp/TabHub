// L'EFFET VERRE — réglages par appareil. Le même fichier dans HarmoHub et TabHub (comme synchro-cloud.js).
//
// CE QUE C'EST. Un rendu « verre dépoli » repris de TrainHub : un fond coloré (« aurore » ou une seule teinte), des
// surfaces translucides qui floutent ce qu'elles recouvrent, un reflet clair sur le bord haut des boutons. Tout le
// dessin est dans verre.css ; ce fichier ne fait que RETENIR deux réglages et les poser en attributs sur <html> :
//
//     data-glass="1"            présent seulement quand le verre est allumé
//     data-glass-bg="aurora"    la couleur du fond (toujours posé, même verre éteint : verre.css ne s'en sert qu'allumé)
//
// POURQUOI DES ATTRIBUTS SUR <html>. Le CSS est le seul à savoir dessiner ; il lui suffit d'un sélecteur
// (`html[data-glass="1"] …`). Éteint, AUCUNE règle de verre ne s'applique : le rendu est celui d'avant, à l'identique.
//
// POURQUOI CE FICHIER SE CHARGE DANS <head>, SANS defer. Lu après le premier affichage, il ferait d'abord paraître
// l'appli sans verre, puis la repeindrait : un éclair. Chargé ici, il pose les attributs avant que le navigateur ne
// dessine quoi que ce soit. Il est volontairement minuscule et sans dépendance.
//
// PAR APPAREIL, comme sur TrainHub : un téléphone peut être en verre et l'ordinateur non (le flou coûte de la batterie
// sur un vieux téléphone). Les réglages vivent donc dans localStorage, et ne sont PAS envoyés au nuage.
//
// QUELLE APPLI ? `data-app` sur la balise <script> (`<script src="verre.js" data-app="harmohub">`) donne le préfixe des
// clés : `harmohub.glass.v1` et `harmohub.glassBg.v1`, comme `trainhub.glass.v1` côté TrainHub. Les applis d'un même
// auteur partagent souvent une origine (donc un localStorage) : sans préfixe, régler l'une changerait les autres sans
// qu'on le sache.
//
// DÉFAUT : ÉTEINT (`DEFAUT_ALLUME`), comme sur TrainHub. Un seul endroit à changer pour l'allumer d'emblée.

(function (global) {
    'use strict';

    var DEFAUT_ALLUME = false;
    var DEFAUT_FOND = 'aurora';

    /** Les couleurs de fond proposées, dans l'ordre d'affichage : [valeur de l'attribut, libellé]. */
    var FONDS = [
        ['aurora', 'Aurore'], ['blue', 'Bleu'], ['green', 'Vert'], ['violet', 'Violet'],
        ['rose', 'Rose'], ['amber', 'Ambre'], ['grey', 'Gris']
    ];

    function fondValide(v) { return FONDS.some(function (f) { return f[0] === v; }); }

    /**
     * @param {object} options
     *   app       préfixe des clés de stockage (« harmohub », « tabhub »)
     *   stockage  { getItem, setItem } — localStorage par défaut ; injectable pour les bancs
     *   racine    l'élément qui porte les attributs (document.documentElement) — { setAttribute, removeAttribute }
     */
    function creer(options) {
        var app = options.app || 'app';
        var stockage = options.stockage;
        var racine = options.racine;
        var CLE_VERRE = app + '.glass.v1';
        var CLE_FOND = app + '.glassBg.v1';
        var abonnes = [];

        function lire(cle) { try { return stockage.getItem(cle); } catch (e) { return null; } }
        function ecrire(cle, valeur) { try { stockage.setItem(cle, valeur); } catch (e) { /* navigation privée, quota : le réglage vaut pour cette séance seulement */ } }

        /** « 1 » allumé, « 0 » éteint, rien ou autre chose : le défaut. Une valeur illisible n'allume jamais rien par accident. */
        function actif() {
            var v = lire(CLE_VERRE);
            if (v === '1') return true;
            if (v === '0') return false;
            return DEFAUT_ALLUME;
        }

        function fond() {
            var v = lire(CLE_FOND);
            return fondValide(v) ? v : DEFAUT_FOND;
        }

        function prevenir() {
            abonnes.slice().forEach(function (fn) { try { fn({ actif: actif(), fond: fond() }); } catch (e) { /* un abonné ne casse pas les autres */ } });
        }

        /** Pose les attributs d'après les réglages. Appelé au chargement, puis à chaque changement. */
        function appliquer() {
            if (!racine) return;
            if (actif()) racine.setAttribute('data-glass', '1'); else racine.removeAttribute('data-glass');
            racine.setAttribute('data-glass-bg', fond());
        }

        /** Après un changement venu d'AILLEURS (un autre onglet de cet appareil) : on repose les attributs et on prévient l'interface. */
        function rafraichir() { appliquer(); prevenir(); }

        function definirActif(on) { ecrire(CLE_VERRE, on ? '1' : '0'); appliquer(); prevenir(); }

        function definirFond(v) {
            if (!fondValide(v)) return false;
            ecrire(CLE_FOND, v); appliquer(); prevenir();
            return true;
        }

        return {
            actif: actif, fond: fond, appliquer: appliquer,
            definirActif: definirActif, definirFond: definirFond, rafraichir: rafraichir,
            /** S'abonner aux changements. Rend la fonction qui se désabonne : une fenêtre qu'on reconstruit à chaque ouverture ne doit pas empiler d'abonnés. */
            surChangement: function (fn) {
                abonnes.push(fn);
                return function () { abonnes = abonnes.filter(function (a) { return a !== fn; }); };
            },
            nbAbonnes: function () { return abonnes.length; },
            FONDS: FONDS, CLES: { verre: CLE_VERRE, fond: CLE_FOND }
        };
    }

    global.VerreModule = { creer: creer, FONDS: FONDS, DEFAUT_ALLUME: DEFAUT_ALLUME, DEFAUT_FOND: DEFAUT_FOND };

    // Dans un navigateur : une instance, tout de suite, avant le premier affichage.
    if (typeof document !== 'undefined' && document.documentElement) {
        var balise = document.currentScript;
        var app = (balise && balise.getAttribute('data-app')) || 'app';
        var stock = null;
        try { stock = global.localStorage; } catch (e) { stock = null; }
        var instance = creer({ app: app, stockage: stock || { getItem: function () { return null; }, setItem: function () {} }, racine: document.documentElement });
        instance.appliquer();
        global.Verre = instance;

        /**
         * La rangée de pastilles « Couleur du fond », construite dans `hote` : un groupe de boutons radio (role="radiogroup"),
         * un par couleur de FONDS, coché d'après le réglage et recoché à chaque changement (même venu d'un autre onglet).
         * Commune aux deux applis : le dessin des pastilles est dans verre.css (.verre-fonds / .verre-fond), le même partout.
         * Le premier appel vide l'hôte : on peut reconstruire la fenêtre des réglages à chaque ouverture sans empiler de pastilles.
         */
        var seDesabonner = null;
        instance.construireFonds = function (hote, libelle) {
            if (seDesabonner) { seDesabonner(); seDesabonner = null; }
            hote.textContent = '';
            hote.classList.add('verre-fonds');
            hote.setAttribute('role', 'radiogroup');
            hote.setAttribute('aria-label', libelle || 'Couleur du fond');
            var boutons = FONDS.map(function (f) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'verre-fond';
                b.setAttribute('data-fond', f[0]);
                b.setAttribute('role', 'radio');
                b.setAttribute('title', f[1]);
                b.setAttribute('aria-label', f[1]);
                b.addEventListener('click', function () { instance.definirFond(f[0]); });
                hote.appendChild(b);
                return b;
            });
            function peindre() {
                var courant = instance.fond();
                boutons.forEach(function (b) {
                    var on = b.getAttribute('data-fond') === courant;
                    b.setAttribute('aria-checked', on ? 'true' : 'false');
                    b.classList.toggle('on', on);
                });
            }
            peindre();
            seDesabonner = instance.surChangement(peindre);
        };
        // Un réglage changé dans un AUTRE onglet de cet appareil s'applique ici aussi, sans recharger.
        try {
            global.addEventListener('storage', function (e) {
                if (e.key === instance.CLES.verre || e.key === instance.CLES.fond || e.key === null) { instance.rafraichir(); }
            });
        } catch (e) { /* pas d'évènement de stockage : sans gravité */ }
    }
})(typeof window !== 'undefined' ? window : globalThis);
