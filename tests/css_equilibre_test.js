// Banc de l'ÉQUILIBRE DES FEUILLES DE STYLE — sans navigateur.
//
// POURQUOI. Une accolade « } » en trop dans un fichier CSS ne produit AUCUNE erreur : le navigateur la lit
// comme le début d'une règle invalide, dont le « sélecteur » absorbe ce qui suit jusqu'à la prochaine
// accolade ouvrante — et la règle suivante, entière, disparaît. Rien en console, rien à l'écran sauf un
// style manquant. Cela s'est produit ici : un `}` en trop, glissé dans un ancien remaniement, restait
// inoffensif tant qu'il était la dernière ligne du fichier ; la première règle ajoutée derrière lui (le
// bouton du nuage) a été avalée, et seul un contrôle de style CALCULÉ l'a révélée. Ce banc garde la classe
// de défaut entière, pour toute règle future, sans rien savoir de ce que la règle devait dessiner.
//
// CE QU'IL VÉRIFIE : en ignorant commentaires et chaînes, aucune accolade fermante sans ouvrante, et
// autant d'ouvrantes que de fermantes à la fin de chaque feuille.

const fs = require('fs');
const path = require('path');
const creerHarnais = require('./_harness.js');
const { check, plan, bilan } = creerHarnais('équilibre des feuilles de style');

const RACINE = path.join(__dirname, '..');

/** Les accolades « } » en trop (numéros de ligne) et la profondeur restante en fin de fichier. */
function equilibre(css) {
    const sansCommentaires = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    const sansChaines = sansCommentaires.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (m) => ' '.repeat(m.length));
    let profondeur = 0, ligne = 1;
    const enTrop = [];
    for (const c of sansChaines) {
        if (c === '\n') ligne++;
        else if (c === '{') profondeur++;
        else if (c === '}') { profondeur--; if (profondeur < 0) { enTrop.push(ligne); profondeur = 0; } }
    }
    return { enTrop, profondeur };
}

const feuilles = fs.readdirSync(RACINE).filter(f => f.endsWith('.css'));
plan(feuilles.length + 2);
check(feuilles.length > 0, `des feuilles de style à vérifier (${feuilles.join(', ')})`);
for (const f of feuilles) {
    const { enTrop, profondeur } = equilibre(fs.readFileSync(path.join(RACINE, f), 'utf8'));
    check(enTrop.length === 0 && profondeur === 0,
        enTrop.length || profondeur
            ? `${f} : accolade « } » en trop aux lignes ${enTrop.join(', ') || '—'}, profondeur finale ${profondeur} — la règle qui SUIT une accolade en trop est avalée sans un message`
            : `${f} : accolades équilibrées`);
}

// Le contrôle lui-même doit savoir échouer : une feuille avec une accolade en trop, et une sans fermeture.
{
    const trop = equilibre('.a { color: red; }\n}\n.b { color: blue; }\n');
    const manque = equilibre('.a { color: red;\n.b { color: blue; }\n');
    const propre = equilibre('/* } { */ .a { content: "}"; }\n@media (x) { .b { color: blue; } }\n');
    // Ce plan est déjà couvert par plan() ci-dessus : on compte ces trois cas en un seul contrôle.
    check(trop.enTrop.join() === '2' && manque.profondeur === 1 && propre.enTrop.length === 0 && propre.profondeur === 0,
        'le détecteur voit l\'accolade en trop (ligne 2) et l\'accolade manquante, et ne se laisse pas tromper par un « } » dans un commentaire ou une chaîne');
}
bilan();
