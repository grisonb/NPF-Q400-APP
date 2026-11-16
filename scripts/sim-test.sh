#!/bin/bash
# NPF-Q400 APP — essai dans le simulateur iPad (Mac GitHub, sans signature).
#
# Usage : scripts/sim-test.sh <dossier-du-code-de-l-app> <dossier-de-sortie> <étiquette>
#
# 1. fabrique l'app pour le simulateur (Debug : Capacitor recopie alors la console
#    JS et les erreurs JS de la page dans la sortie de l'app) ;
# 2. choisit le simulateur d'iPad le plus proche de l'iPad 9e génération ;
# 3. pour chaque orientation (paysage, portrait) : simulateur neuf, app installée,
#    lancée, captures d'écran à 10 s, 25 s et 40 s, journal de l'app ;
# 4. écrit un bilan (bilan.txt + résumé GitHub).
#
# Orientation : simctl ne sait pas tourner le simulateur. La COPIE de l'app
# installée pour l'essai n'accepte qu'une orientation (Info.plist modifié dans
# la copie seulement) : l'app s'affiche alors dans cette orientation. Les
# captures de paysage sont ensuite remises à l'endroit.
set -uo pipefail

SRC="$(cd "$1" && pwd)"
OUT="$2"
LABEL="$3"
BUNDLE_ID="com.grisonb.npfq400app"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
BILAN="$OUT/bilan.txt"
WORK="${RUNNER_TEMP:-/tmp}/npfq400-sim-$LABEL"   # fichiers de travail, hors artefact
rm -rf "$WORK"; mkdir -p "$WORK"
: > "$BILAN"
say() { echo "$*" | tee -a "$BILAN"; }

say "NPF-Q400 APP — essai simulateur — $LABEL"
say "code : $(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo inconnu)"
say "Mac : $(sw_vers -productVersion) — $(xcodebuild -version | head -1)"

# ------------------------------------------------------------------ fabrication
cd "$SRC"
npm ci --no-audit --no-fund > "$OUT/npm-ci.log" 2>&1 || { say "ÉCHEC npm ci"; exit 1; }
node scripts/build-www.mjs | tee -a "$BILAN"
npx cap sync ios > "$OUT/cap-sync.log" 2>&1 || { say "ÉCHEC cap sync"; exit 1; }
DD="$WORK/DerivedData"
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$DD" CODE_SIGNING_ALLOWED=NO build > "$OUT/xcodebuild-simulateur.log" 2>&1
if ! grep -q "\*\* BUILD SUCCEEDED \*\*" "$OUT/xcodebuild-simulateur.log"; then
  grep -E "error:" "$OUT/xcodebuild-simulateur.log" | head -20 | tee -a "$BILAN"
  say "ÉCHEC fabrication simulateur"
  exit 1
fi
APP="$DD/Build/Products/Debug-iphonesimulator/App.app"
say "fabrication simulateur : OK ($(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Info.plist"))"

# ------------------------------------------------------------- choix de l'iPad
RUNTIMES_JSON="$OUT/runtimes.json"
xcrun simctl list runtimes -j > "$RUNTIMES_JSON"
RUNTIME_ID=$(jq -r '[.runtimes[] | select(.platform == "iOS" and .isAvailable)] | sort_by(.version | split(".") | map(tonumber)) | last | .identifier' "$RUNTIMES_JSON")
RUNTIME_NAME=$(jq -r --arg id "$RUNTIME_ID" '.runtimes[] | select(.identifier == $id) | .name' "$RUNTIMES_JSON")
jq -r --arg id "$RUNTIME_ID" '.runtimes[] | select(.identifier == $id) | .supportedDeviceTypes[] | select(.productFamily == "iPad") | .name' "$RUNTIMES_JSON" > "$OUT/ipads-disponibles.txt"
DEVICE_NAME=""
for wanted in "iPad (9th generation)" "iPad (10th generation)" "iPad (A16)" "iPad Air 11-inch (M2)" "iPad Air 11-inch (M3)" "iPad Air (5th generation)"; do
  if grep -qxF "$wanted" "$OUT/ipads-disponibles.txt"; then DEVICE_NAME="$wanted"; break; fi
done
[ -n "$DEVICE_NAME" ] || DEVICE_NAME=$(grep -v "Pro\|mini" "$OUT/ipads-disponibles.txt" | head -1)
[ -n "$DEVICE_NAME" ] || DEVICE_NAME=$(head -1 "$OUT/ipads-disponibles.txt")
DEVICE_TYPE=$(jq -r --arg id "$RUNTIME_ID" --arg n "$DEVICE_NAME" '.runtimes[] | select(.identifier == $id) | .supportedDeviceTypes[] | select(.name == $n) | .identifier' "$RUNTIMES_JSON")
say "système du simulateur : $RUNTIME_NAME"
say "iPad choisi : $DEVICE_NAME (le plus proche de l'iPad 9e génération parmi : $(paste -sd ',' "$OUT/ipads-disponibles.txt"))"

# -------------------------------------------- analyse d'une capture (écran blanc ?)
cat > "$WORK/analyse-capture.py" <<'PY'
import struct, sys
data = open(sys.argv[1], 'rb').read()
off = struct.unpack_from('<I', data, 10)[0]
w, h = struct.unpack_from('<ii', data, 18)
bpp = struct.unpack_from('<H', data, 28)[0] // 8
row = (w * bpp + 3) & ~3
white = dark = 0
colors = set()
for y in range(abs(h)):
    for x in range(w):
        p = off + y * row + x * bpp
        b, g, r = data[p], data[p + 1], data[p + 2]
        if r > 240 and g > 240 and b > 240: white += 1
        if r < 15 and g < 15 and b < 15: dark += 1
        colors.add((r >> 4, g >> 4, b >> 4))
n = w * abs(h)
verdict = 'ÉCRAN BLANC' if white / n > 0.95 else ('ÉCRAN NOIR' if dark / n > 0.95 else 'contenu affiché')
print(f"blanc {100*white/n:.0f} % · noir {100*dark/n:.0f} % · {len(colors)} teintes · {verdict}")
PY

# ------------------------------------------------------------ essais par orientation
for ORIENT in paysage portrait; do
  say ""
  say "=== $ORIENT ==="
  UDID=$(xcrun simctl create "NPF-Q400 $ORIENT" "$DEVICE_TYPE" "$RUNTIME_ID")
  xcrun simctl boot "$UDID"
  xcrun simctl bootstatus "$UDID" -b > /dev/null 2>&1
  xcrun simctl status_bar "$UDID" override --time "9:41" --batteryState charged --batteryLevel 100 > /dev/null 2>&1 || true

  COPY="$WORK/app-$ORIENT/App.app"
  rm -rf "$(dirname "$COPY")"; mkdir -p "$(dirname "$COPY")"
  cp -R "$APP" "$COPY"
  PL="$COPY/Info.plist"
  for key in "UISupportedInterfaceOrientations" "UISupportedInterfaceOrientations~ipad"; do
    /usr/libexec/PlistBuddy -c "Delete :$key" "$PL" > /dev/null 2>&1 || true
    /usr/libexec/PlistBuddy -c "Add :$key array" "$PL"
    if [ "$ORIENT" = "paysage" ]; then
      /usr/libexec/PlistBuddy -c "Add :$key:0 string UIInterfaceOrientationLandscapeRight" "$PL"
    else
      /usr/libexec/PlistBuddy -c "Add :$key:0 string UIInterfaceOrientationPortrait" "$PL"
    fi
  done
  /usr/libexec/PlistBuddy -c "Delete :UIRequiresFullScreen" "$PL" > /dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Add :UIRequiresFullScreen bool true" "$PL"

  xcrun simctl install "$UDID" "$COPY"
  # GPS : autorisation accordée d'avance (pas de fenêtre système) et position simulée
  # (Marignane, 43.4367 N 5.2150 E). Sans le texte NSLocationWhenInUseUsageDescription
  # dans l'app, iOS refuse quand même la position.
  xcrun simctl privacy "$UDID" grant location "$BUNDLE_ID" > /dev/null 2>&1 || say "autorisation GPS d'avance : impossible"
  xcrun simctl location "$UDID" set 43.4367,5.2150 > /dev/null 2>&1 || say "position simulée : impossible"
  CONSOLE="$OUT/console-app-$ORIENT.log"
  xcrun simctl launch --console-pty --terminate-running-process "$UDID" "$BUNDLE_ID" > "$CONSOLE" 2>&1 &
  LAUNCH_PID=$!
  T0=$(date +%s)
  for at in 10 25 40; do
    while [ $(( $(date +%s) - T0 )) -lt "$at" ]; do sleep 1; done
    SHOT="$OUT/capture-$ORIENT-${at}s.png"
    xcrun simctl io "$UDID" screenshot "$SHOT" > /dev/null 2>&1
    if [ "$ORIENT" = "paysage" ]; then
      W=$(sips -g pixelWidth "$SHOT" | awk '/pixelWidth/{print $2}')
      H=$(sips -g pixelHeight "$SHOT" | awk '/pixelHeight/{print $2}')
      if [ "$H" -gt "$W" ]; then sips -r 270 "$SHOT" > /dev/null; fi
    fi
    sips -s format bmp --resampleWidth 200 "$SHOT" --out "$WORK/tmp.bmp" > /dev/null 2>&1
    say "capture ${at} s : $(python3 "$WORK/analyse-capture.py" "$WORK/tmp.bmp")"
  done
  if xcrun simctl spawn "$UDID" launchctl list 2>/dev/null | grep -q "$BUNDLE_ID"; then
    say "app toujours lancée après 40 s : oui"
  else
    say "app toujours lancée après 40 s : NON (arrêt ou plantage ?)"
  fi
  kill "$LAUNCH_PID" > /dev/null 2>&1 || true
  xcrun simctl spawn "$UDID" log show --last 3m --style compact \
    --predicate 'process == "App"' > "$OUT/journal-systeme-$ORIENT.log" 2>&1 || true

  say "--- messages de la page ($ORIENT)"
  grep -E "\[NPF-Q400 APP\] rapport" "$CONSOLE" | tail -1 | sed 's/^.*\[NPF-Q400 APP\] rapport /rapport : /' | tee -a "$BILAN" || true
  if grep -q "NSLocationWhenInUseUsageDescription" "$CONSOLE"; then
    say "GPS : iOS signale le texte d'autorisation de position ABSENT"
  else
    say "GPS : pas d'alerte iOS sur le texte d'autorisation de position"
  fi
  ERRS=$(grep -E "ERROR MESSAGE|\[error\]|erreur JS|js.error|SyntaxError|TypeError|ReferenceError" "$CONSOLE" | sort | uniq -c | sort -rn)
  if [ -n "$ERRS" ]; then
    say "erreurs vues dans la console de l'app :"
    echo "$ERRS" | head -30 | cut -c1-300 | tee -a "$BILAN"
  else
    say "erreurs vues dans la console de l'app : aucune"
  fi
  say "lignes de console recueillies : $(wc -l < "$CONSOLE" | tr -d ' ')"
  xcrun simctl shutdown "$UDID" > /dev/null 2>&1 || true
  xcrun simctl delete "$UDID" > /dev/null 2>&1 || true
done

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { echo '```'; cat "$BILAN"; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
fi
exit 0
