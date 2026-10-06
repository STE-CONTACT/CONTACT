#!/usr/bin/env bash
# Démonstration sur Mac / Linux : ./demarrer-demo.sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null; then echo "Installez Node.js 22 ou plus récent : https://nodejs.org"; exit 1; fi
MAJ=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$MAJ" -lt 22 ]; then echo "Node.js 22 ou plus récent est nécessaire (actuel : $(node -v))"; exit 1; fi
[ -d node_modules ] || npm install || exit 1
[ -f data/sorties.db ] || npm run seed:demo
echo ""
echo "Application : http://localhost:3000"
echo "Comptes : admin / Admin@2026!  —  chef.karim, rh.leila, gardien.ali / Demo@2026!"
echo "Arrêt : Ctrl+C"
( sleep 3; (command -v open >/dev/null && open http://localhost:3000) || (command -v xdg-open >/dev/null && xdg-open http://localhost:3000) ) >/dev/null 2>&1 &
npm start
