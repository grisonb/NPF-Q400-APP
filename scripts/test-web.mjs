// NPF-Q400 APP — essais sur PC avec le Chrome de Windows (sans écran, profil temporaire).
//
// Trois pages comparées, servies en local (127.0.0.1, un port par page) :
//   A. web-test/index.html             = NPF-Q400 TEST telle quelle (référence)
//   B. www/index.html                  = page de l'app dans un navigateur normal
//   C. www/index.html?npfq400app-sim=1 = page de l'app en mode « app » simulé
//
// Réseau extérieur COUPÉ : Chrome ne résout aucun nom sauf 127.0.0.1
// (--host-resolver-rules) → aucun NAS, aucun VPS, aucun serveur extérieur.
//
// Le serveur d'essai (et lui seul) ajoute une petite sonde en tête de
// index.html : elle relève les erreurs JS puis renvoie un bilan au serveur.
// Cette sonde n'existe ni dans web-test/ ni dans www/.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.NPF_Q400_CHROME || '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
const WAIT_MS = Number(process.env.NPF_Q400_WAIT_MS || 25000);
const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json',
    '.png': 'image/png', '.zip': 'application/zip', '.txt': 'text/plain'
};

const PROBE = '<script>' + readFileSync(join(root, 'scripts/test-probe.js'), 'utf8')
    .replace(/__WAIT_MS__/g, String(WAIT_MS)) + '</script>';

function runPage(label, dir, query, profile) {
    return new Promise((resolve, reject) => {
        let chrome;
        const done = (value, error) => {
            clearTimeout(guard);
            try { chrome && chrome.kill(); } catch (_) {}
            server.close();
            error ? reject(error) : resolve(value);
        };
        const server = createServer(async (req, res) => {
            const url = new URL(req.url, 'http://x');
            if (url.pathname === '/__npfq400-step') {
                console.error(`  [${label.slice(0, 2)}] étape : ${decodeURIComponent(url.search.slice(1))}`);
                res.end('ok');
                return;
            }
            if (req.method === 'POST' && url.pathname === '/__npfq400-report') {
                let body = '';
                req.on('data', c => { body += c; });
                req.on('end', () => { res.end('ok'); done({ label, ...JSON.parse(body) }); });
                return;
            }
            try {
                const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
                const file = join(dir, path.endsWith('/') ? path + 'index.html' : path);
                if (!file.startsWith(dir)) throw new Error('hors dossier');
                await stat(file);
                let data = await readFile(file);
                if (file === join(dir, 'index.html')) {
                    const marker = '<meta charset="UTF-8">';
                    data = data.toString('utf8').replace(marker, () => marker + PROBE);
                }
                res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
                res.end(data);
            } catch (_) {
                res.writeHead(404); res.end('404');
            }
        });
        const guard = setTimeout(() => done(null, new Error(`${label} : pas de bilan après ${WAIT_MS + 240000} ms`)), WAIT_MS + 240000);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            chrome = spawn(CHROME, [
                '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                '--disable-extensions', '--disable-popup-blocking', '--window-size=1180,820',
                `--user-data-dir=C:\\Windows\\Temp\\npfq400app-essai-${profile}-${Date.now()}`,
                '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
                `http://127.0.0.1:${port}/index.html${query}`
            ], { stdio: 'ignore' });
            chrome.on('error', e => done(null, e));
        });
    });
}

const results = [];
results.push(await runPage('A. NPF-Q400 TEST d\'origine (web-test/)', join(root, 'web-test'), '', 'a'));
results.push(await runPage('B. page de l\'app, navigateur normal (www/)', join(root, 'www'), '', 'b'));
results.push(await runPage('C. page de l\'app, mode app simulé (www/)', join(root, 'www'), '?npfq400app-sim=1', 'c'));
console.log(JSON.stringify(results, null, 2));

const [a, b, c] = results;
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const appVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version.replace(/\.0$/, '');
const checks = [
    ['A : aucune erreur JS', a.jsErrors.length === 0],
    ['B : aucune erreur JS', b.jsErrors.length === 0],
    ['C : aucune erreur JS (sonde et relevé de la couche app)', c.jsErrors.length === 0 && c.npfQ400AppFin && c.npfQ400AppFin.jsErrors.length === 0],
    // B = page de l'app dans un navigateur normal : identique à A
    ['B : couche app inactive (pas de NPF_Q400_APP, pas de classes)', b.npfQ400App === null && !b.htmlClassApp && b.htmlClassInstallee === a.htmlClassInstallee],
    ['B : service worker enregistré et actif comme A', b.serviceWorkerInNavigator === true && a.serviceWorkerRegistrations >= 1 && b.serviceWorkerRegistrations === a.serviceWorkerRegistrations && b.serviceWorkerControlled === a.serviceWorkerControlled],
    ['B : fenêtre de mise à jour affichée comme A', b.fenetreMajVisibleApresAppel === true && a.fenetreMajVisibleApresAppel === true],
    ['B : même titre, version, démarrage, carte, barre du haut que A', b.title === a.title && b.bootVersion === a.bootVersion && b.appReady === a.appReady && b.mapPresent === a.mapPresent && b.barreHaut === a.barreHaut && b.boutonsHaut === a.boutonsHaut],
    ['B : bouton MAJ visible et actif comme A', b.boutonMajVisible === true && b.boutonMajClicAgit === true && a.boutonMajVisible === true && a.boutonMajClicAgit === true],
    ['B : Wake Lock du navigateur intact comme A', b.wakeLockNatifNavigateur === a.wakeLockNatifNavigateur],
    ['B : PDF VAC et terrain ouverts dans un nouvel onglet comme A (pas la visionneuse)', same(a.pdfVac, b.pdfVac) && same(a.pdfTerrain, b.pdfTerrain) && b.pdfVac.nouvelOnglet === true && b.pdfVac.visionneuse === false && b.pdfTerrain.nouvelOnglet === true && b.pdfTerrain.visionneuse === false],
    ['B : GPS du navigateur intact comme A', b.geolocNatifNavigateur === true && a.geolocNatifNavigateur === true],
    ['B : mêmes serveurs extérieurs tentés que A', same(a.externalHostsTried, b.externalHostsTried)],
    // C = page de l'app en mode app simulé
    ['C : couche app active, version ' + appVersion, !!c.npfQ400App && c.htmlClassApp && c.npfQ400App.layerVersion === appVersion],
    ['C : service worker invisible et non enregistré', c.serviceWorkerInNavigator === false],
    ['C : fenêtre de mise à jour bloquée', c.fenetreMajVisibleApresAppel === false],
    ['C : démarrage terminé et carte présente comme A', c.appReady === a.appReady && c.mapPresent === true],
    ['C : barre du haut comme la PWA installée (32 px)', c.htmlClassInstallee === true && /32px/.test(c.barreHaut)],
    ['C : bouton MAJ masqué et désactivé', c.boutonMajVisible === false && c.boutonMajClicAgit === false && c.npfQ400AppFin.majButtonClicksBlocked >= 1],
    ['C : écran allumé : demande -> keepAwake, relâche -> allowSleep', /^keepAwake \/ écran allumé$/.test(c.keepAwakeApresDemande || '') && /^allowSleep \/ veille permise$/.test(c.keepAwakeApresRelache || '') && c.keepAwakeSentinelleRelachee === true],
    ['C : VAC ouverte dans la visionneuse interne (titre, page dessinée, pas d\'onglet)', c.pdfVac.visionneuse === true && c.pdfVac.titre === 'VAC LFZZ' && c.pdfVac.pagesDessinees >= 1 && c.pdfVac.nouvelOnglet === false],
    ['C : PDF terrain ouvert dans la visionneuse interne (titre, page dessinée, pas d\'onglet)', c.pdfTerrain.visionneuse === true && c.pdfTerrain.titre === 'PDF LFZY' && c.pdfTerrain.pagesDessinees >= 1 && c.pdfTerrain.nouvelOnglet === false],
    ['C : GPS — mêmes champs que Safari (latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed + heure)', !!c.gpsP1 && c.gpsP1.cles === 'accuracy,altitude,altitudeAccuracy,heading,latitude,longitude,speed' && typeof c.gpsP1.coords.latitude === 'number' && typeof c.gpsP1.coords.longitude === 'number' && c.gpsP1.coords.accuracy === 5],
    ['C : GPS — heure en millisecondes et récente', !!c.gpsP1 && c.gpsP1.timestamp > 1e12 && c.gpsP1.ageMs >= 0 && c.gpsP1.ageMs < 3000],
    ['C : GPS — cap = route suivie (335°), pas la boussole (90°) ; vitesse 60 m/s ; altitude 300 m', !!c.gpsSuivi && c.gpsSuivi.valides.length >= 3 && c.gpsSuivi.valides.every(v => v.heading === 335 && v.speed === 60 && v.altitude === 300 && v.altitudeAccuracy === 10)],
    ['C : GPS — valeurs invalides du plugin (-1) rendues vides comme Safari', !!c.gpsSuivi && c.gpsSuivi.invalides.length >= 1 && c.gpsSuivi.invalides.every(v => v.heading === null && v.speed === null && v.altitude === null && v.altitudeAccuracy === null && typeof v.latitude === 'number')],
    ['C : GPS — haute précision envoyée au plugin pour chaque appel ; sans timeout = pas de limite', !!c.gpsOptionsPlugin && c.gpsOptionsPlugin.length === 2 && c.gpsOptionsPlugin.every(x => x.includes('"enableHighAccuracy":true')) && c.gpsOptionsPlugin[1].includes('"timeout":86400000')],
    ['C : GPS — maximumAge : dernière position rendue sans nouvel appel au plugin', !!c.gpsCache && c.gpsCache.memeHeure === true],
    ['C : GPS — suivi ≈ 1 position par seconde, plus rien après l\'arrêt', !!c.gpsSuivi && c.gpsSuivi.recues >= 5 && c.gpsSuivi.ecartMedianMs >= 900 && c.gpsSuivi.ecartMedianMs <= 1150 && c.gpsSuivi.apresArret === 0],
    ['C : GPS — contrôle de 14 s de la couche app (cadence, vitesse, cap, altitude)', !!c.gpsControle && c.gpsControle.positions >= 12 && c.gpsControle.ecartMedianMs >= 900 && c.gpsControle.ecartMedianMs <= 1150 && c.gpsControle.avecVitesse >= 1 && c.gpsControle.avecCap >= 1 && c.gpsControle.avecAltitude >= 1 && c.gpsControle.heureEnMs === true && c.gpsControle.erreurs.length === 0],
    ['C : GPS — aucune erreur GPS', !!c.gpsStats && c.gpsStats.erreurs === 0],
    // 0.5 — trace de vol
    ['B : trace inactive en navigateur normal (bouton TRACE de TEST, pas de liste, DIAG et téléchargements intacts)', !!b.traceNavigateur && b.traceNavigateur.module === false && b.traceNavigateur.sectionListe === false && b.traceNavigateur.boutonLieParTest === '1' && !/npfq400/.test(b.traceNavigateur.boutonClasses) && b.traceNavigateur.clicAncreNatif === true && b.traceNavigateur.diagSansTrace === true && same(a.traceNavigateur, b.traceNavigateur)],
    ['C : trace — module prêt, bouton gris au départ', !!c.trace && !c.trace.erreur && c.trace.etatInitial === 'prêt' && /npfq400-trace-off/.test(c.trace.boutonInitial)],
    ['C : trace — appui long : « Réglages Trace » avec les valeurs par défaut (50 kt, 30 s, 30 kt, 2 min, 2 min, 4 px, bleu foncé, 7 couleurs)', !!c.trace && c.trace.reglagesOuverts === true && same(c.trace.reglagesDefaut, [50, 30, 30, 2, 2, 4]) && c.trace.couleurChoisieDefaut === '#1e3a8a' && c.trace.paletteCouleurs === 7],
    ['C : trace — réglages modifiés mémorisés, puis « Valeurs par défaut »', !!c.trace && c.trace.reglagesApres && c.trace.reglagesApres.vitesseDemarrageKt === 60 && c.trace.reglagesApres.couleur === '#6d28d9' && c.trace.reglagesApres.epaisseur === 6 && same(c.trace.reglagesRemisDefaut, { vitesseDemarrageKt: 50, dureeDemarrageS: 30, vitesseArretKt: 30, dureeArretMin: 2, minutesAvant: 2, couleur: '#1e3a8a', epaisseur: 4 })],
    ['C : trace — le bouton n\'ouvre plus Raccourcis', !!c.trace && c.trace.raccourciTestPasLance === true],
    ['C : trace — appui court : démarrage à la main (bouton rouge), arrêt avec confirmation (bouton gris), trace vide non gardée', !!c.trace && c.trace.manuelDemarre === true && c.trace.manuelArrete === true && c.trace.traceVideSupprimee === true],
    ['C : trace — vol complet : 1 trace, début 2 min avant le passage à 50 kt, fin 2 min après le passage sous 30 kt', !!c.trace && !!c.trace.volA && c.trace.volA.une === 1 && c.trace.volA.mode === 'auto' && c.trace.volA.etat === 'terminée' && c.trace.volA.debutApresBase_s === 60 && c.trace.volA.finApresBase_s === 1445],
    ['C : trace — remise de gaz (40 kt) et écopage (75 kt) n\'arrêtent pas la trace ; trou de 45 s signalé', !!c.trace && !!c.trace.volA && c.trace.volA.points === 1341 && c.trace.volA.trous === 1 && c.trace.volA_pointsLus === 1341],
    ['C : trace — vitesse calculée quand le GPS ne la donne pas (300 points) ; route enregistrée', !!c.trace && c.trace.volA_vitesseCalculee === 300 && c.trace.volA_capRoute === 1341],
    ['C : trace — arrêt à la main en vol : pas de redémarrage avant l\'atterrissage, puis redémarrage et arrêt automatiques', !!c.trace && c.trace.volB_demarre && c.trace.volB_pasRedemarreEnVol && c.trace.volB_redemarreApresAtterrissage && c.trace.volB_arreteAuto],
    ['C : trace — mémoire bornée (tampon 2 min ≈ 160 points, ≤ 30 points en attente) et rapide (< 1 ms par point)', !!c.trace && c.trace.tamponApresRoulage <= 170 && c.trace.tamponApresRoulage >= 140 && c.trace.enAttenteMax <= 30 && c.trace.msParPoint < 1 && c.trace.msParPointVol1h < 1],
    ['C : trace — points enregistrés par lots d\'au plus 30 s', !!c.trace && !!c.trace.lotsC && c.trace.lotsC.points === c.trace.pointsTraceC && c.trace.lotsC.lots >= Math.ceil(c.trace.pointsTraceC / 30)],
    ['C : trace — trait sur la carte par morceaux (≤ 150 points), allégé, couleur et épaisseur des réglages', !!c.trace && c.trace.morceauxTrait.length >= 2 && c.trace.morceauxTrait.every(m => m.n <= 150 && m.color === '#1e3a8a' && m.weight === 4 && m.pane === 'npfQ400TracePane') && c.trace.pointsDessines < c.trace.pointsTraceC / 3],
    ['C : trace — arrêt brutal : trace retrouvée au relancement, close, avec message clair', !!c.trace && !!c.trace.repriseC && c.trace.repriseC.etat === 'retrouvée' && c.trace.repriseC.points === 3720 && /retrouvée après un arrêt brutal/.test(c.trace.messageReprise) && c.trace.enregistrementApresReprise === false],
    ['C : trace — relancement en plein vol : la trace continue et son trait est redessiné', !!c.trace && c.trace.volD_demarre && c.trace.volD_continue && c.trace.volD_traitRedessine && c.trace.volD_arrete],
    ['C : trace — GPX 1.1 valide (lat, lon, altitude, heure UTC, vitesse), un segment par trou, nom NPF-Q400_trace_AAAA-MM-JJ_HHMMZ.gpx', !!c.trace && !!c.trace.gpx && c.trace.gpx.xmlValide && c.trace.gpx.racine === 'gpx' && c.trace.gpx.version === '1.1' && c.trace.gpx.espace === 'http://www.topografix.com/GPX/1/1' && c.trace.gpx.trkpt === 1341 && c.trace.gpx.ele === 1341 && c.trace.gpx.vitesse === 1341 && c.trace.gpx.trkseg === 2 && /Z$/.test(c.trace.gpx.premiereHeure) && c.trace.gpx.nom === c.trace.gpx.nomAttendu && /^NPF-Q400_trace_\d{4}-\d{2}-\d{2}_\d{4}Z\.gpx$/.test(c.trace.gpx.nom)],
    ['C : trace — « Exporter (GPX) » passe par la fenêtre de partage', !!c.trace && c.trace.gpxPartage === c.trace.gpx.nom],
    ['C : trace — « Afficher » une trace passée ; liste (date, heure UTC, durée) avec Afficher / Exporter (GPX)', !!c.trace && !!c.trace.afficher && c.trace.afficher.pointsDessines > 50 && c.trace.liste.lignes >= 4 && /\d\d\/\d\d\/\d{4} · \d\d:\d\dZ · /.test(c.trace.liste.texte) && c.trace.liste.boutons.indexOf('Afficher') >= 0 && c.trace.liste.boutons.indexOf('Exporter (GPX)') >= 0],
    ['C : trace — lignes « Trace » dans l\'export DIAG (état, points, dernier point, trous)', !!c.trace && c.trace.diag.some(l => /^Trace : /.test(l)) && c.trace.diag.some(l => /NPF-Q400 APP — TRACE/.test(l)) && c.trace.diag.some(l => /dernier point reçu/.test(l)) && c.trace.diag.some(l => /trou de 46 s/.test(l))],
    ['C : partage iPad — DIAG, KML et CSV feu passent par la fenêtre de partage', !!c.trace && /^POINT_TEST\.kml \| contenu POINT_TEST\.kml$/.test(c.trace.partageKml || '') && /^Fichier_cibles_NEXT_TEST\.csv \| /.test(c.trace.partageCsv || '') && c.trace.partageDiag === 'NPF_DIAG_2026-11-17_10-00.txt' && c.trace.canShareDiag === true],
    ['C : rapport de démarrage écrit', !!(c.npfQ400AppFin && c.npfQ400AppFin.startupReport && c.npfQ400AppFin.startupReport.carte === true)]
];
let ok = true;
for (const [name, pass] of checks) {
    console.log(`${pass ? 'OK   ' : 'ÉCHEC'} ${name}`);
    if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
