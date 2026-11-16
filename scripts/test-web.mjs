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
        const guard = setTimeout(() => done(null, new Error(`${label} : pas de bilan après ${WAIT_MS + 90000} ms`)), WAIT_MS + 90000);
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
    ['C : GPS par le plugin (position ponctuelle, suivi, arrêt du suivi)', same(c.gpsPonctuel, [43.4367, 5.215]) && c.gpsSuivi && c.gpsSuivi.recues >= 2 && c.gpsSuivi.apresArret === 0 && c.npfQ400AppFin.gpsErreurs === 0],
    ['C : rapport de démarrage écrit', !!(c.npfQ400AppFin && c.npfQ400AppFin.startupReport && c.npfQ400AppFin.startupReport.carte === true)]
];
let ok = true;
for (const [name, pass] of checks) {
    console.log(`${pass ? 'OK   ' : 'ÉCHEC'} ${name}`);
    if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
