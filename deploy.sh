#!/bin/zsh
# Lädt den aktuellen Stand nach GitHub (Repo marcokland-web/umschlag, GitHub Pages).
# Aufruf: ./deploy.sh "Kurze Beschreibung der Änderung"
set -e
cd "${0:A:h}"

# 1. Syntaxcheck des Inline-Skripts
node -e '
const h=require("fs").readFileSync("ynab.html","utf8");
const code=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join("\n");
try{new Function(code)}catch(e){console.error("Syntaxfehler in ynab.html:",e.message);process.exit(1)}'

# 2. index.html ist die Startseite von GitHub Pages und immer eine Kopie von ynab.html
cp ynab.html index.html

# 3. Commit + Push (nur wenn sich etwas geändert hat)
git add -A
if git diff --cached --quiet; then
  echo "Keine Änderungen – nichts hochzuladen."
  exit 0
fi
BUILD=$(grep -o "const BUILD='[^']*'" ynab.html | cut -d"'" -f2)
git commit -q -m "${1:-Update} (Build $BUILD)"
git pull -q --rebase origin main
git push -q origin main
echo "Hochgeladen: Build $BUILD → https://marcokland-web.github.io/umschlag/"
