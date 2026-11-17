// NPF-Q400 APP — fabrique le dossier www/ (contenu web embarqué dans l'app).
//
// 1. copie à l'identique web-test/ (copie figée de NPF-Q400 TEST, jamais modifiée) ;
// 2. copie app-layer/ dans www/app-layer/ ;
// 3. ajoute UNE seule ligne dans www/index.html : le script de la couche app,
//    en tout premier dans <head>, avant les scripts de la PWA.
// web-test/ n'est jamais modifié. www/ est généré (non versionné).
import { cpSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'web-test');
const layer = join(root, 'app-layer');
const out = join(root, 'www');

const baseLine = readFileSync(join(root, 'VERSION-BASE'), 'utf8')
    .split('\n').find(l => l.startsWith('version=')) || '';
const baseVersion = baseLine.slice('version='.length).trim();
if (!/^v\d+\.\d+$/.test(baseVersion)) {
    throw new Error(`VERSION-BASE : version illisible (${baseVersion || 'vide'})`);
}

if (!existsSync(join(src, 'index.html'))) throw new Error('web-test/index.html introuvable');
rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });
cpSync(layer, join(out, 'app-layer'), { recursive: true });

const layerJs = join(out, 'app-layer', 'npf-q400-app.js');
writeFileSync(layerJs, readFileSync(layerJs, 'utf8').replace('__NPF_Q400_BASE_VERSION__', baseVersion));

const indexPath = join(out, 'index.html');
const html = readFileSync(indexPath, 'utf8');
const marker = '<meta charset="UTF-8">';
const tag = '\n    <script src="app-layer/npf-q400-app.js"></script><!-- NPF-Q400 APP : couche app (ajout de build, absente de NPF-Q400 TEST) -->'
    + '\n    <script src="app-layer/npf-q400-app-trace.js"></script><!-- NPF-Q400 APP : trace de vol (ne fait rien hors de l\'app) -->';
const at = html.indexOf(marker);
if (at < 0) throw new Error(`index.html : repère ${marker} introuvable`);
if (html.includes('app-layer/npf-q400-app.js')) throw new Error('index.html : couche app déjà présente ?');
writeFileSync(indexPath, html.slice(0, at + marker.length) + tag + html.slice(at + marker.length));

console.log(`www/ prêt : NPF-Q400 TEST ${baseVersion} + couche NPF-Q400 APP`);
