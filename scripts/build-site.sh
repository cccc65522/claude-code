#!/usr/bin/env bash
# Assemble the GitHub Pages site (the content of the gh-pages branch) into OUTDIR.
#
#   复习本 (review-app)        site root
#   格算, 弈, 造物              sheet/, xiangqi/, physics/   (static apps: runtime files only)
#   方块小镇, 门道              voxel-world/, logic-lab/     (Vite apps: npm run build)
#
# Usage: scripts/build-site.sh OUTDIR
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
out=${1:?usage: scripts/build-site.sh OUTDIR}

rm -rf "$out"
mkdir -p "$out"

# A static app runs straight from its folder; leave out tests, scripts and package files.
copy_static() {
  local src=$root/$1 dest=$2
  mkdir -p "$dest"
  cp "$src/index.html" "$src/manifest.webmanifest" "$src/sw.js" "$dest/"
  cp -r "$src/css" "$src/js" "$src/icons" "$dest/"
}

copy_static review-app "$out"
for app in sheet xiangqi physics; do
  copy_static "$app" "$out/$app"
done

for app in voxel-world logic-lab; do
  (cd "$root/$app" && npm ci --no-audit --no-fund && npm run build)
  cp -r "$root/$app/dist" "$out/$app"
done

# Serve the files as they are (no Jekyll processing).
touch "$out/.nojekyll"
echo "Site assembled in $out"
