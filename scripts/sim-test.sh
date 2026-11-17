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
  # GPS : autorisation « Toujours » accordée d'avance (pas de fenêtre système), position
  # fixe au parking de Marignane au lancement.
  xcrun simctl privacy "$UDID" grant location-always "$BUNDLE_ID" > /dev/null 2>&1 \
    || xcrun simctl privacy "$UDID" grant location "$BUNDLE_ID" > /dev/null 2>&1 \
    || say "autorisation GPS d'avance : impossible"
  P0="43.4380,5.2120"
  xcrun simctl location "$UDID" set "$P0" > /dev/null 2>&1 || say "position simulée : impossible"
  CONSOLE="$OUT/console-app-$ORIENT.log"
  app_running() { xcrun simctl spawn "$UDID" launchctl list 2>/dev/null | grep -q "$BUNDLE_ID"; }
  # Lancement, vérifié : sur un Mac GitHub très chargé, « simctl launch » peut rester
  # bloqué sans ouvrir l'app (vu le 16/11, portrait de la 0.4). Si l'app ne tourne pas
  # au bout de 20 s, on la relance une fois et on le note dans le bilan.
  LAUNCH_PID=""
  for attempt in 1 2; do
    xcrun simctl launch --console-pty --terminate-running-process "$UDID" "$BUNDLE_ID" >> "$CONSOLE" 2>&1 &
    LAUNCH_PID=$!
    T0=$(date +%s)
    started=0
    for _ in $(seq 1 20); do
      if app_running; then started=1; break; fi
      sleep 1
    done
    if [ "$started" = 1 ]; then
      say "app démarrée (lancement n° $attempt, en $(( $(date +%s) - T0 )) s)"
      break
    fi
    say "app NON démarrée 20 s après le lancement n° $attempt"
    kill "$LAUNCH_PID" > /dev/null 2>&1 || true
    sleep 3
  done
  DATA=$(xcrun simctl get_app_container "$UDID" "$BUNDLE_ID" data 2>/dev/null || true)
  mkdir -p "$DATA/Documents" 2>/dev/null || true
  PHASES="$OUT/phases-$ORIENT.txt"
  : > "$PHASES"
  attendre() { while [ $(( $(date +%s) - T0 )) -lt "$1" ]; do sleep 1; done; }
  phase() { echo "$1 $(date +%s)" >> "$PHASES"; say "t+$(( $(date +%s) - T0 )) s : $2"; }
  capture() {
    local SHOT="$OUT/capture-$ORIENT-$1.png"
    xcrun simctl io "$UDID" screenshot "$SHOT" > /dev/null 2>&1 || { say "capture $1 : impossible"; return; }
    if [ "$ORIENT" = "paysage" ] && [ "${2:-app}" = "app" ]; then sips -r 90 "$SHOT" > /dev/null 2>&1 || true; fi
    sips -s format bmp --resampleWidth 200 "$SHOT" --out "$WORK/tmp.bmp" > /dev/null 2>&1
    say "capture $1 (t+$(( $(date +%s) - T0 )) s) : $(python3 "$WORK/analyse-capture.py" "$WORK/tmp.bmp")"
  }
  SEQ=0
  ordre() {
    SEQ=$((SEQ + 1))
    printf '{"seq":%s,"action":"%s"}' "$SEQ" "$1" > "$DATA/Documents/npfq400-essai.json"
    say "t+$(( $(date +%s) - T0 )) s : ordre d'essai « $1 »"
  }
  # Point à DIST mètres de LAT,LON au cap BRG (ligne droite).
  point() { python3 -c "import math,sys;la,lo=map(float,sys.argv[1].split(','));b=math.radians(float(sys.argv[2]));d=float(sys.argv[3]);print('%.6f,%.6f'%(la+d*math.cos(b)/111320,lo+d*math.sin(b)/(111320*math.cos(math.radians(la)))))" "$1" "$2" "$3"; }
  BRG=330
  route() { # route VITESSE_M_S DEPART : ligne droite au cap BRG, 200 km
    local FIN; FIN=$(point "$2" "$BRG" 200000)
    xcrun simctl location "$UDID" start --speed="$1" --interval=1 "$2" "$FIN" > "$WORK/location.log" 2>&1 \
      || say "trajet simulé impossible : $(head -1 "$WORK/location.log")"
  }

  attendre 10; capture "10s"
  attendre 25; capture "25s"
  # roulage 5 m/s (≈ 10 kt)
  attendre 30; phase roulage "roulage à 5 m/s (≈ 10 kt)"; TS=$(date +%s); route 5 "$P0"
  # décollage et vol 70 m/s (≈ 136 kt) : la trace doit démarrer ≈ 30 s plus tard
  attendre 70; P1=$(point "$P0" "$BRG" $(( 5 * ($(date +%s) - TS) ))); phase vol "vol à 70 m/s (≈ 136 kt)"; TS=$(date +%s); route 70 "$P1"
  attendre 108; ordre cadrer
  attendre 114; capture "vol-bouton-rouge"
  # arrière-plan : l'app Réglages d'iOS passe devant pendant 60 s
  attendre 120; phase arriere-plan "app en arrière-plan (Réglages d'iOS ouverts)"; xcrun simctl launch "$UDID" com.apple.Preferences > /dev/null 2>&1 || say "ouverture de Réglages impossible"
  attendre 150; capture "arriere-plan" systeme
  attendre 180; phase premier-plan "retour de l'app au premier plan"; xcrun simctl launch "$UDID" "$BUNDLE_ID" > /dev/null 2>&1 || say "retour de l'app impossible"
  attendre 188; ordre cadrer
  attendre 195; capture "retour-premier-plan"
  # ralentissement 12 m/s (≈ 23 kt) : la trace doit s'arrêter ≈ 2 min plus tard
  attendre 200; P2=$(point "$P1" "$BRG" $(( 70 * ($(date +%s) - TS) ))); phase ralenti "ralentissement à 12 m/s (≈ 23 kt)"; TS=$(date +%s); route 12 "$P2"
  attendre 350; P3=$(point "$P2" "$BRG" $(( 12 * ($(date +%s) - TS) ))); phase arret "arrêt (position fixe)"; xcrun simctl location "$UDID" set "$P3" > /dev/null 2>&1
  attendre 355; ordre afficher-derniere
  attendre 362; capture "trace-terminee"
  attendre 366; ordre reglages
  attendre 373; capture "reglages-trace"
  attendre 377; ordre fermer
  attendre 381; ordre liste
  attendre 390; capture "liste-traces"
  attendre 394; ordre fermer
  attendre 398; ordre gpx
  attendre 406; ordre exporter
  attendre 414; capture "partage-gpx"
  if app_running; then say "app toujours lancée à la fin : oui"; else say "app toujours lancée à la fin : NON (arrêt ou plantage ?)"; fi

  # GPX écrit par l'ordre « gpx » dans Documents/npfq400-gpx/
  GPX=$(ls -t "$DATA"/Documents/npfq400-gpx/*.gpx 2>/dev/null | head -1)
  if [ -n "$GPX" ]; then
    cp "$GPX" "$OUT/"
    if xmllint --noout "$GPX" 2>"$WORK/xmllint.log"; then XMLOK="XML valide"; else XMLOK="XML INVALIDE ($(head -1 "$WORK/xmllint.log"))"; fi
    say "GPX : $(basename "$GPX") · $XMLOK"
    python3 - "$GPX" "$PHASES" "$T0" <<'PY' | tee -a "$BILAN"
import sys, re, datetime
gpx, phases, t0 = sys.argv[1], sys.argv[2], int(sys.argv[3])
txt = open(gpx, encoding='utf-8').read()
times = [datetime.datetime.strptime(m, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc).timestamp()
         for m in re.findall(r'<trkpt[^>]*>.*?<time>([^<]+)</time>', txt)]
ph = {}
for line in open(phases):
    k, v = line.split(); ph[k] = int(v)
print('GPX : %d points · %d segment(s) · version 1.1 : %s · vitesse : %s · altitude : %s' % (
    len(times), txt.count('<trkseg>'), 'oui' if 'version="1.1"' in txt else 'NON',
    'oui' if 'gpxtpx:speed' in txt else 'non', 'oui' if '<ele>' in txt else 'non'))
if times:
    print('GPX : début t+%d s · fin t+%d s (phases : roulage t+%d, vol t+%d, ralenti t+%d, arrêt t+%d)' % (
        times[0] - t0, times[-1] - t0, ph.get('roulage', 0) - t0, ph.get('vol', 0) - t0, ph.get('ralenti', 0) - t0, ph.get('arret', 0) - t0))
    a, b = ph.get('arriere-plan'), ph.get('premier-plan')
    if a and b:
        n = sum(1 for t in times if a <= t <= b)
        gaps = [round(times[i + 1] - times[i]) for i in range(len(times) - 1) if a - 5 <= times[i] <= b + 5]
        print('GPX : %d points pendant les %d s en arrière-plan · plus grand écart pendant ce temps : %s s' % (n, b - a, max(gaps) if gaps else '—'))
PY
  else
    say "GPX : AUCUN fichier trouvé dans Documents/npfq400-gpx"
  fi
  kill "$LAUNCH_PID" > /dev/null 2>&1 || true
  xcrun simctl spawn "$UDID" log show --last 10m --style compact \
    --predicate 'process == "App"' > "$OUT/journal-systeme-$ORIENT.log" 2>&1 || true

  say "--- trace ($ORIENT)"
  python3 - "$CONSOLE" "$T0" <<'PY' | tee -a "$BILAN"
import sys, json
console, t0 = sys.argv[1], int(sys.argv[2]) * 1000
ev = []
for line in open(console, errors='replace'):
    i = line.find('[NPF-Q400 APP] trace ')
    if i < 0: continue
    try: ev.append(json.loads(line[i + len('[NPF-Q400 APP] trace '):].strip()))
    except Exception: pass
def rel(t): return '%+d s' % round((t - t0) / 1000)
lots = [e for e in ev if e.get('evt') == 'lot']
for e in ev:
    k = e.get('evt')
    if k in ('source-active', 'source-erreur', 'pret', 'demarrage', 'arret', 'trou', 'rattrapage', 'arriere-plan', 'premier-plan', 'gpx-ecrit', 'partage', 'erreur-sauvegarde', 'erreur-demarrage', 'reprise'):
        d = {x: y for x, y in e.items() if x not in ('evt', 't')}
        for key in ('debut', 'fin', 'de', 'a'):
            if key in d and isinstance(d[key], (int, float)): d[key] = rel(d[key])
        print('trace t%s : %s %s' % (rel(e['t']), k, json.dumps(d, ensure_ascii=False)))
print('trace : %d lots enregistrés · plus grand écart entre deux lots : %s s' % (
    len(lots), max([round((lots[i + 1]['t'] - lots[i]['t']) / 1000) for i in range(len(lots) - 1)] or ['—'])))
PY
  say "--- messages de la page ($ORIENT)"
  grep -E "\[NPF-Q400 APP\] rapport" "$CONSOLE" | tail -1 | sed 's/^.*\[NPF-Q400 APP\] rapport /rapport : /' | tee -a "$BILAN" || true
  RAPPORT=$(grep -E "\[NPF-Q400 APP\] rapport" "$CONSOLE" | tail -1 | sed 's/^.*\[NPF-Q400 APP\] rapport //')
  if [ -n "$RAPPORT" ]; then
    echo "$RAPPORT" | python3 -c '
import json, sys
r = json.load(sys.stdin)
g = r.get("gps") or {}
c = r.get("gpsControle")
print("GPS (ce que reçoit la PWA) : état %s · %s positions · options demandées %s · options envoyées au plugin %s" % (
    g.get("etat"), g.get("positions"), g.get("optionsDemandees"), g.get("optionsNatives")))
if isinstance(c, dict):
    print("contrôle GPS 14 s : %s positions · écart médian %s ms (min %s, max %s) · avec vitesse %s · avec cap %s · avec altitude %s · avec précision %s · heure en ms %s · retard heure %s ms · erreurs %s" % (
        c.get("positions"), c.get("ecartMedianMs"), c.get("ecartMinMs"), c.get("ecartMaxMs"), c.get("avecVitesse"),
        c.get("avecCap"), c.get("avecAltitude"), c.get("avecPrecision"), c.get("heureEnMs"), c.get("retardHeureMs"), c.get("erreurs")))
    print("dernière position reçue : %s" % json.dumps(c.get("derniere"), ensure_ascii=False))
else:
    print("contrôle GPS : %s" % c)
' | tee -a "$BILAN" || true
  fi
  if grep -qE "NSLocation(WhenInUse|AlwaysAndWhenInUse)UsageDescription" "$CONSOLE"; then
    say "GPS : iOS signale un texte d'autorisation de position ABSENT"
  else
    say "GPS : pas d'alerte iOS sur les textes d'autorisation de position (pendant l'utilisation / toujours)"
  fi
  ERRS=$(grep -E "ERROR MESSAGE|\[error\]|erreur JS|js.error|SyntaxError|TypeError|ReferenceError" "$CONSOLE" | sort | uniq -c | sort -rn)
  if [ -n "$ERRS" ]; then
    say "erreurs vues dans la console de l'app :"
    echo "$ERRS" | head -30 | cut -c1-300 | tee -a "$BILAN"
  else
    say "erreurs vues dans la console de l'app : aucune"
  fi
  say "lignes de console recueillies : $(wc -l < "$CONSOLE" | tr -d ' ')"
  xcrun simctl location "$UDID" clear > /dev/null 2>&1 || true
  xcrun simctl shutdown "$UDID" > /dev/null 2>&1 || true
  xcrun simctl delete "$UDID" > /dev/null 2>&1 || true
done

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { echo '```'; cat "$BILAN"; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
fi
exit 0
