// NPF-Q400 APP — correctifs de plugins, appliqués après chaque « npm install / npm ci »
// (script « postinstall » de package.json). Aucune dépendance.
//
// @capgo/background-geolocation : le plugin ne permet pas de choisir le type d'activité
// d'iOS. On ajoute l'option « activityType » (« airborne » = avion) dans
// configureLocationManager(). Le script s'arrête en erreur si le plugin a changé (repère
// introuvable) : il faut alors revoir le correctif, jamais l'ignorer.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'node_modules/@capgo/background-geolocation/ios/Sources/CapgoBackgroundGeolocationPlugin/CapgoCapacitorBackgroundGeolocationPlugin.swift');
const MARK = "// NPF-Q400 APP : type d'activité réglable";
const ANCHOR = `        manager.allowsBackgroundLocationUpdates = background
        manager.showsBackgroundLocationIndicator = background
        manager.pausesLocationUpdatesAutomatically = false
    }`;
const PATCHED = `        manager.allowsBackgroundLocationUpdates = background
        manager.showsBackgroundLocationIndicator = background
        manager.pausesLocationUpdatesAutomatically = false
        ${MARK} (« airborne » = avion).
        switch call.getString("activityType") {
        case "airborne": manager.activityType = .airborne
        case "automotiveNavigation": manager.activityType = .automotiveNavigation
        case "otherNavigation": manager.activityType = .otherNavigation
        case "fitness": manager.activityType = .fitness
        default: manager.activityType = .other
        }
    }`;

if (!existsSync(file)) {
    console.error('patch-plugins : plugin @capgo/background-geolocation absent');
    process.exit(1);
}
const src = readFileSync(file, 'utf8');
if (src.includes(MARK)) {
    console.log('patch-plugins : type d\'activité « avion » déjà en place');
} else {
    const n = src.split(ANCHOR).length - 1;
    if (n !== 1) {
        console.error(`patch-plugins : repère trouvé ${n} fois au lieu d'une — le plugin a changé, revoir le correctif`);
        process.exit(1);
    }
    writeFileSync(file, src.replace(ANCHOR, PATCHED));
    console.log('patch-plugins : type d\'activité « avion » ajouté à @capgo/background-geolocation');
}
