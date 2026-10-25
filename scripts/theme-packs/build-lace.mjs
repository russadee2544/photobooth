// Builds the "Lace" theme pack (80 mm receipts, 1-4 photos) from the owner's Canva strip with the café
// name: oval photos inside lace doilies, "TOGETHER Forever / BAANMAI AI-OON" underneath.
//   Input:  scripts/theme-packs/lace-src.png (Canva export without the sample photos, 1200 x 3600 = 192 x 576)
//   Output: public/theme-packs/lace/receipt-N-paper.png, public/theme-packs/lace-80mm.json
// Usage: node scripts/theme-packs/build-lace.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const outDir = join(root, 'public', 'theme-packs', 'lace');
mkdirSync(outDir, { recursive: true });

const W = 192;
const DOILY = { y: 25.2, h: 198.194, pad: 3 };          // lace doily (the first one in the design)
const GAP = 234.415 - (25.2 + 198.194);                 // between doilies
const OVAL = { dx: 39.118, dy: 44.768 - 25.2, w: 113.765, h: 159.058 };
const TEXT = { y0: 440, y1: 556, gapAbove: 446.382 - (234.415 + 198.194) - 6 };
const TEXT_TOP = 440;                                    // lettering starts here (solid ink below)

function layout(n) {
  const frames = Array.from({ length: n }, (_, i) => DOILY.y + i * (DOILY.h + GAP));
  const textAt = frames[n - 1] + DOILY.h + TEXT.gapAbove;
  const height = textAt + (TEXT.y1 - TEXT.y0) + 20;
  const pieces = [
    ...frames.map((y) => `P,${DOILY.y - DOILY.pad},${DOILY.y + DOILY.h + DOILY.pad},${(y - DOILY.pad).toFixed(3)}`),
    `P,${TEXT.y0},${TEXT.y1},${textAt.toFixed(3)}`,
  ];
  return { n, height, frames, spec: [`C,${W},${height.toFixed(3)}`, ...pieces].join('|') };
}

const layouts = [1, 2, 3, 4].map(layout);
const q = (p) => p.replace(/'/g, "''");
const cs = q(join(import.meta.dirname, 'lace-render.cs'));
const art = join(import.meta.dirname, 'lace-lineart.tmp.png');
const calls = [`[LaceTheme]::LineArt('${q(join(import.meta.dirname, 'lace-src.png'))}', '${q(art)}', ${TEXT_TOP})`,
  ...layouts.map((l) => `[LaceTheme]::Variant('${q(art)}', '${l.spec}', '${q(join(outDir, `receipt-${l.n}-paper.png`))}')`)];
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `$ErrorActionPreference='Stop'; Add-Type -ReferencedAssemblies System.Drawing -Path '${cs}'; ${calls.join('; ')}`], { stdio: 'inherit' });
rmSync(art, { force: true });

const ASSET = (name) => `/theme-packs/lace/${name}`;
const templates = layouts.map(({ n, height, frames }) => {
  const width = 576, k = width / W, r = (v) => Math.round(v * k);
  return {
    schemaVersion: 1,
    templateId: `custom_pack_lace_80_${n}`,
    layoutId: `${n}_3x4`,
    name: `Lace · 80mm · ${n} รูป`,
    type: 'thermal80',
    orientation: 'portrait',
    enabled: true,
    isCustom: true,
    canvas: {
      width, height: Math.round(height * k), dpi: 203, backgroundColor: '#FFFFFF',
      backgroundImage: ASSET(`receipt-${n}-paper.png`), backgroundFitMode: 'stretch',
      safeMargin: { top: 0, bottom: 0, left: 0, right: 0 },
      bleedMargin: { top: 0, bottom: 0, left: 0, right: 0 },
    },
    overlay: { url: '', zIndex: 100, fitMode: 'cover' },
    artboard: [],
    slots: frames.map((y, i) => ({ index: i + 1, x: r(OVAL.dx), y: r(y + OVAL.dy), width: r(OVAL.w), height: r(OVAL.h), rotation: 0,
      zIndex: i + 1, focusX: 0.5, focusY: 0.42, shape: 'oval' })),
    printSettings: { printTwoPerPage: false, paperSize: '80mm' },
  };
});
writeFileSync(join(root, 'public', 'theme-packs', 'lace-80mm.json'),
  JSON.stringify({ packId: 'lace-80mm', version: 1, name: 'Lace (80mm)', templates }, null, 2) + '\n');
console.log('lace:', templates.map((t) => `${t.name} ${t.canvas.width}x${t.canvas.height}`).join(' | '));
