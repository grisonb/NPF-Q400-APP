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

const PROBE = `<script>/* sonde d'essai NPF-Q400 APP (serveur d'essai uniquement) */
(function () {
  var K = 'npfq400ProbeErrors';
  var errs = []; try { errs = JSON.parse(sessionStorage.getItem(K) || '[]'); } catch (_) {}
  var save = function () { try { sessionStorage.setItem(K, JSON.stringify(errs.slice(-50))); } catch (_) {} };
  window.addEventListener('error', function (e) {
    if (e && e.target && e.target !== window) return; /* ressource non chargée : pas une erreur JS */
    errs.push('erreur JS : ' + (e.message || '') + ' @' + (e.filename || '').split('/').pop() + ':' + (e.lineno || '')); save();
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason; errs.push('promesse rejetée : ' + String(r && (r.stack || r.message) || r).slice(0, 200)); save();
  });
  window.addEventListener('load', function () {
    setTimeout(async function () {
      var info = {};
      try {
        info.url = location.pathname + location.search;
        info.title = document.title;
        info.bootVersion = (document.querySelector('.boot-version') || {}).textContent || '';
        info.appReady = document.body.classList.contains('app-ready');
        info.mapPresent = !!document.querySelector('.leaflet-container');
        info.serviceWorkerInNavigator = 'serviceWorker' in navigator;
        info.serviceWorkerRegistrations = 'n/a';
        if (info.serviceWorkerInNavigator) {
          try { info.serviceWorkerRegistrations = (await navigator.serviceWorker.getRegistrations()).length; } catch (x) { info.serviceWorkerRegistrations = 'erreur'; }
          info.serviceWorkerControlled = !!navigator.serviceWorker.controller;
        }
        info.npfQ400App = window.NPF_Q400_APP ? JSON.parse(JSON.stringify(window.NPF_Q400_APP)) : null;
        info.htmlClassApp = document.documentElement.classList.contains('npf-q400-app');
        info.fenetreMajVisibleApresAppel = 'fonction absente';
        if (typeof window.showUpdateReminderModal === 'function') {
          var old = document.getElementById('update-reminder-modal'); if (old) old.remove();
          window.showUpdateReminderModal();
          await new Promise(function (r) { setTimeout(r, 400); });
          var el = document.getElementById('update-reminder-modal');
          info.fenetreMajVisibleApresAppel = !!(el && getComputedStyle(el).display !== 'none');
          if (el) el.remove();
        }
        var hosts = {};
        performance.getEntriesByType('resource').forEach(function (p) {
          try { var h = new URL(p.name).hostname; if (h !== '127.0.0.1') hosts[h] = 1; } catch (_) {}
        });
        info.externalHostsTried = Object.keys(hosts).sort();
      } catch (x) { errs.push('sonde : ' + x.message); }
      info.jsErrors = errs;
      fetch('/__npfq400-report', { method: 'POST', body: JSON.stringify(info) });
    }, ${WAIT_MS});
  });
})();</script>`;

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
                    data = data.toString('utf8').replace(marker, marker + PROBE);
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
                '--disable-extensions', '--window-size=1180,820',
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
const checks = [
    ['A : aucune erreur JS', a.jsErrors.length === 0],
    ['B : aucune erreur JS', b.jsErrors.length === 0],
    ['C : aucune erreur JS', c.jsErrors.length === 0],
    ['B : couche app inactive (pas de NPF_Q400_APP)', b.npfQ400App === null && !b.htmlClassApp],
    ['B : service worker enregistré et actif comme A', b.serviceWorkerInNavigator === true && a.serviceWorkerRegistrations >= 1 && b.serviceWorkerRegistrations === a.serviceWorkerRegistrations && b.serviceWorkerControlled === a.serviceWorkerControlled],
    ['B : fenêtre de mise à jour affichée comme A', b.fenetreMajVisibleApresAppel === true && a.fenetreMajVisibleApresAppel === true],
    ['B : même titre, version, démarrage et carte que A', b.title === a.title && b.bootVersion === a.bootVersion && b.appReady === a.appReady && b.mapPresent === a.mapPresent],
    ['B : mêmes serveurs extérieurs tentés que A', same(a.externalHostsTried, b.externalHostsTried)],
    ['C : couche app active', !!c.npfQ400App && c.htmlClassApp],
    ['C : service worker invisible et non enregistré', c.serviceWorkerInNavigator === false],
    ['C : fenêtre de mise à jour bloquée', c.fenetreMajVisibleApresAppel === false],
    ['C : démarrage terminé et carte présente comme A', c.appReady === a.appReady && c.mapPresent === true]
];
let ok = true;
for (const [name, pass] of checks) {
    console.log(`${pass ? 'OK   ' : 'ÉCHEC'} ${name}`);
    if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
