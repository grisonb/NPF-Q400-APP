// NPF-Q400 APP — icône de l'app = icône de la PWA (manifest : icons/icon-512x512.png).
// Agrandie à 1024 x 1024 (bicubique) et sans transparence (exigence Apple) :
// les coins transparents sont remplis avec la couleur du bord de l'icône.
// Usage : node scripts/make-icon.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'web-test/manifest.json'), 'utf8'));
const entry = manifest.icons.find(i => i.sizes === '512x512' && (i.purpose || 'any') === 'any');
if (!entry) throw new Error('manifest : icône 512x512 « any » introuvable');
const src = PNG.sync.read(readFileSync(join(root, 'web-test', entry.src)));
const S = 1024;
const out = new PNG({ width: S, height: S, colorType: 2 });

// Couleur de fond = moyenne des pixels opaques du bord intérieur (bande à 12 px du bord, hors coins).
let bg = [0, 0, 0], n = 0;
for (let i = 80; i < src.width - 80; i++) {
    for (const [x, y] of [[i, 12], [i, src.height - 13], [12, i], [src.width - 13, i]]) {
        const k = (y * src.width + x) * 4;
        if (src.data[k + 3] > 250) { bg[0] += src.data[k]; bg[1] += src.data[k + 1]; bg[2] += src.data[k + 2]; n++; }
    }
}
bg = bg.map(v => Math.round(v / Math.max(1, n)));

const cubic = t => { const a = -0.5, x = Math.abs(t);
    return x <= 1 ? (a + 2) * x ** 3 - (a + 3) * x ** 2 + 1 : x < 2 ? a * x ** 3 - 5 * a * x ** 2 + 8 * a * x - 4 * a : 0; };
const px = (x, y, c) => src.data[((Math.min(src.height - 1, Math.max(0, y)) * src.width) + Math.min(src.width - 1, Math.max(0, x))) * 4 + c];
const scale = src.width / S;
for (let y = 0; y < S; y++) {
    const sy = (y + 0.5) * scale - 0.5, y0 = Math.floor(sy);
    for (let x = 0; x < S; x++) {
        const sx = (x + 0.5) * scale - 0.5, x0 = Math.floor(sx);
        const acc = [0, 0, 0, 0]; let wsum = 0;
        for (let j = -1; j <= 2; j++) for (let i = -1; i <= 2; i++) {
            const w = cubic(sx - (x0 + i)) * cubic(sy - (y0 + j));
            const a = px(x0 + i, y0 + j, 3) / 255;
            acc[0] += w * px(x0 + i, y0 + j, 0) * a; acc[1] += w * px(x0 + i, y0 + j, 1) * a;
            acc[2] += w * px(x0 + i, y0 + j, 2) * a; acc[3] += w * a; wsum += w;
        }
        const alpha = Math.min(1, Math.max(0, acc[3] / wsum));
        const k = (y * S + x) * 3;
        for (let c = 0; c < 3; c++) {
            const col = acc[3] > 1e-6 ? acc[c] / acc[3] : bg[c];
            out.data[k + c] = Math.round(Math.min(255, Math.max(0, col * alpha + bg[c] * (1 - alpha))));
        }
    }
}
// pngjs attend 4 octets par pixel en entrée même en sortie RGB : on reconstruit.
const rgba = Buffer.alloc(S * S * 4);
for (let p = 0; p < S * S; p++) { rgba[p * 4] = out.data[p * 3]; rgba[p * 4 + 1] = out.data[p * 3 + 1]; rgba[p * 4 + 2] = out.data[p * 3 + 2]; rgba[p * 4 + 3] = 255; }
const png = new PNG({ width: S, height: S });
rgba.copy(png.data);
const dest = join(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
writeFileSync(dest, PNG.sync.write(png, { colorType: 2 }));
console.log(`icône écrite : ${dest} (source ${entry.src}, fond rgb(${bg.join(',')}))`);
