#!/bin/sh
# Lance tous les bancs. Le serveur HTTP doit tourner (voir tests/README.md).
#
# En SÉRIE, pas en parallèle : chaque banc ouvre son propre Chromium avec du son, et une demi-douzaine
# d'entre eux à la fois asphyxient un conteneur modeste — les bancs se mettent alors à échouer par
# expiration de délai, ce qui ressemble à un défaut de l'application et n'en est pas un.
cd "$(dirname "$0")/.."
: "${NODE_PATH:=/opt/node22/lib/node_modules}"
export NODE_PATH
echecs=0
for banc in tests/*_test.js; do
    printf '\n──────── %s ────────\n' "$banc"
    node "$banc" || echecs=$((echecs + 1))
done
printf '\n════════ %d banc(s) en échec ════════\n' "$echecs"
exit $([ "$echecs" -eq 0 ] && echo 0 || echo 1)
