#!/usr/bin/env bash
# Render every mockup scene to design/screens/NN_<id>.png using headless Chrome.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
N=$(node -e "console.log(require('./mockups/shots.js').SHOTS.length)")
ONLY="${1:-}"
for ((i=0; i<N; i++)); do
  if [[ -n "$ONLY" && " $ONLY " != *" $i "* ]]; then continue; fi
  id=$(node -e "console.log(require('./mockups/shots.js').SHOTS[$i].id)")
  out=$(printf "screens/%02d_%s.png" $((i+1)) "$id")
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1920,1167 --virtual-time-budget=3000 --screenshot="$PWD/$out.raw.png" \
    "file://$PWD/mockups/index.html?shot=$i&capture=1" >/dev/null 2>&1
  ffmpeg -loglevel error -y -i "$out.raw.png" -vf "crop=1920:1080:0:0" "$out" && rm -f "$out.raw.png"
  echo "$out"
done
