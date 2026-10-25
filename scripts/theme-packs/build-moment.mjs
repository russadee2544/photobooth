// Builds "The Moment" theme pack (80 mm receipts, 1-4 photos) from the owner's Canva strip with the
// café name: portrait photos with a thin black border in a right-hand column, the café name and
// "THE MOMENT" written upwards in the left column.
//   Input:  scripts/theme-packs/moment-src.png (Canva export, 1200 x 3600 = 192 x 576 design units)
//   Output: public/theme-packs/moment/receipt-N-{paper,over}.png, public/theme-packs/moment-80mm.json
// Usage: node scripts/theme-packs/build-moment.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const outDir = join(root, 'public', 'theme-packs', 'moment');
mkdirSync(outDir, { recursive: true });

const W = 192, MARGIN = 19.2, GAP = 7.065;
const FRAME = { x: 56.368, w: 116.432, h: 174.377, stroke: 1 };
// Lettering in the export (design units): the café name (top) and "THE MOMENT" (bottom).
const NAME = { box: [25, 15, 29, 148], at: [25, 15] };
const MOMENT = { box: [15, 408, 40.5, 152], bottomGap: 576 - 560 };

function layout(n) {
  const height = MARGIN * 2 + n * FRAME.h + (n - 1) * GAP;
  const frames = Array.from({ length: n }, (_, i) => ({ x: FRAME.x, y: MARGIN + i * (FRAME.h + GAP), w: FRAME.w, h: FRAME.h }));
  // One photo leaves a short column: both words get smaller so they still fit one above the other.
  const scale = n === 1 ? 0.58 : 1;
  const [nx, ny, nw, nh] = NAME.box;
  const [mx, my, mw, mh] = MOMENT.box;
  const nameAt = n === 1 ? [38.65 - (nw * scale) / 2, ny] : NAME.at;
  const momentAt = n === 1 ? [35.25 - (mw * scale) / 2, height - MOMENT.bottomGap * scale - mh * scale - 4]
    : [mx, height - MOMENT.bottomGap - mh];
  const items = [`C,${W},${height.toFixed(3)}`,
    `T,${nx},${ny},${nw},${nh},${nameAt[0].toFixed(3)},${nameAt[1].toFixed(3)},${scale}`,
    `T,${mx},${my},${mw},${mh},${momentAt[0].toFixed(3)},${momentAt[1].toFixed(3)},${scale}`,
    ...frames.map((f) => `R,${f.x},${f.y.toFixed(3)},${f.w},${f.h},${FRAME.stroke}`)];
  return { n, height, frames, spec: items.join('|') };
}

const layouts = [1, 2, 3, 4].map(layout);
const q = (p) => p.replace(/'/g, "''");
const cs = q(join(import.meta.dirname, 'moment-render.cs'));
const src = q(join(import.meta.dirname, 'moment-src.png'));
const calls = layouts.map((l) => `[MomentTheme]::Variant('${src}', '${l.spec}', '${q(join(outDir, `receipt-${l.n}-paper.png`))}', '${q(join(outDir, `receipt-${l.n}-over.png`))}')`);
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `$ErrorActionPreference='Stop'; Add-Type -ReferencedAssemblies System.Drawing -Path '${cs}'; ${calls.join('; ')}`], { stdio: 'inherit' });

const ASSET = (name) => `/theme-packs/moment/${name}`;
const templates = layouts.map(({ n, height, frames }) => {
  const width = 576, k = width / W, h = Math.round(height * k);
  const r = (v) => Math.round(v * k);
  return {
    schemaVersion: 1,
    templateId: `custom_pack_moment_80_${n}`,
    layoutId: `${n}_2x3`,
    name: `The Moment · 80mm · ${n} รูป`,
    type: 'thermal80',
    orientation: 'portrait',
    enabled: true,
    isCustom: true,
    canvas: {
      width, height: h, dpi: 203, backgroundColor: '#FFFFFF',
      backgroundImage: ASSET(`receipt-${n}-paper.png`), backgroundFitMode: 'stretch',
      safeMargin: { top: 0, bottom: 0, left: 0, right: 0 },
      bleedMargin: { top: 0, bottom: 0, left: 0, right: 0 },
    },
    overlay: { url: '', zIndex: 100, fitMode: 'cover' },
    artboard: [{ id: 'borders', name: 'Photo borders', url: ASSET(`receipt-${n}-over.png`), placement: 'front',
      x: 0, y: 0, width, height: h, rotation: 0, zIndex: 220, opacity: 1, visible: true }],
    slots: frames.map((f, i) => ({ index: i + 1, x: r(f.x), y: r(f.y), width: r(f.w), height: r(f.h), rotation: 0,
      zIndex: i + 1, focusX: 0.5, focusY: 0.42, shape: 'rectangle' })),
    printSettings: { printTwoPerPage: false, paperSize: '80mm' },
  };
});
writeFileSync(join(root, 'public', 'theme-packs', 'moment-80mm.json'),
  JSON.stringify({ packId: 'moment-80mm', version: 1, name: 'The Moment (80mm)', templates }, null, 2) + '\n');
console.log('the moment:', templates.map((t) => `${t.name} ${t.canvas.width}x${t.canvas.height}`).join(' | '));
