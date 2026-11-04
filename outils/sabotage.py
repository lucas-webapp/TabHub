#!/usr/bin/env python3
# Coureur de SABOTAGES : casse UNE ligne de la source, rejoue le banc, exige du rouge. Un banc qui n'exécute aucune
# vérification est INVALIDE (≠ rouge). Les fichiers touchés sont toujours restaurés.
# Usage : python3 outils/sabotage.py config.json [préfixe de mutation…]
# config.json : { "racine": "/chemin/du/depot", "banc": "tests/xxx_test.js", "minimum": <vérifications attendues>, "delai": <s>,
#                 "env": { "TABHUB_URL": "http://localhost:8945" },
#                 "mutations": [ ["nom", "fichier/relatif.js", "ancre (UNE seule occurrence)", "remplacement"] ] }
# Le serveur HTTP doit tourner. Lancer en arrière-plan (un banc de navigateur dure plusieurs minutes) et lire le journal.
import io, os, re, subprocess, sys, json
CONFIG = json.load(open(sys.argv[1], encoding='utf-8'))
racine, banc = CONFIG['racine'], CONFIG['banc']
env = dict(os.environ); env['NODE_PATH'] = env.get('NODE_PATH', '/opt/node22/lib/node_modules'); env.update(CONFIG.get('env', {}))
cache = {}
def lire(f):
    if f not in cache: cache[f] = io.open(os.path.join(racine, f), encoding='utf-8').read()
    return cache[f]
def ecrire(f, c): io.open(os.path.join(racine, f), 'w', encoding='utf-8').write(c)
def lancer():
    r = subprocess.run(['node', banc], capture_output=True, text=True, env=env, cwd=CONFIG.get('cwd', racine), timeout=CONFIG.get('delai', 900))
    out = r.stdout + r.stderr
    m = re.findall(r'=== .*?(\d+) PASS / (\d+) FAIL', out)
    return (int(m[-1][0]), int(m[-1][1]), out) if m else (0, 0, out)
filtre = sys.argv[2:]
res = []
try:
    p0, f0, so = lancer()
    print('référence : %d PASS / %d FAIL' % (p0, f0), flush=True)
    if p0 < CONFIG['minimum'] or f0:
        print('RÉFÉRENCE INVALIDE'); print('\n'.join(l for l in so.splitlines() if l.startswith('FAIL'))[:1500]); sys.exit(2)
    for nom, fichier, ancre, remplace in CONFIG['mutations']:
        if filtre and not any(nom.startswith(x) for x in filtre): continue
        src = lire(fichier); n = src.count(ancre)
        if n != 1:
            res.append((nom, 'ANCRE x%d' % n)); print('%-62s ANCRE x%d' % (nom, n), flush=True); continue
        ecrire(fichier, src.replace(ancre, remplace))
        try: p, f, out = lancer()
        finally: ecrire(fichier, src)
        etat = 'INVALIDE (0 contrôle)' if p + f == 0 else ('ATTRAPÉE (%d FAIL)' % f if f else 'SURVIVANTE')
        res.append((nom, etat)); print('%-62s %s' % (nom, etat), flush=True)
        for t in [l[7:140] for l in out.splitlines() if l.startswith('FAIL - ')][:2]: print('      ↳', t, flush=True)
finally:
    for f, c in cache.items(): ecrire(f, c)
print('survivantes :', [n for n, e in res if not e.startswith('ATTRAPÉE')])
