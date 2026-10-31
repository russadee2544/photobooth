// Builds the "Slow Days" theme pack (80 mm receipts, 1-4 photos) from the owner's Canva strip with the
// café name: landscape photos inside a house on a striped background, doodles over the photos.
//   Inputs (Canva exports without the sample photos, 1200 x 3600 = 192 x 576 design units):
//     scripts/theme-packs/slowdays-doodles-src.png   with all the doodles
//     scripts/theme-packs/slowdays-clean-src.png     without the doodles lower down the house
//   Output: public/theme-packs/slowdays/receipt-N-{paper,over}.png, public/theme-packs/slowdays-80mm.json
// Usage: node scripts/theme-packs/build-slowdays.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const outDir = join(root, 'public', 'theme-packs', 'slowdays');
mkdirSync(outDir, { recursive: true });

const W = 192, FULL_H = 576;
const FRAME = { x: 30.082, y: 169.504, w: 131.837, h: 97.92, pitch: 118.496, stroke: 0.8 };
const FOOT = FULL_H - (FRAME.y + 3 * FRAME.h + 2 * (FRAME.pitch - FRAME.h));   // photos' end to the page end
const HEADER_END = 165, HOUSE_END = 538.606;                                   // the house stretches between these
const HOUSE_FOOT = FULL_H - HOUSE_END;
const PILL = [88, 132, 70, 21.5];

// Doodles: [srcX, srcY, srcW, srcH] in the design.
const D = {
  ringTop: [60, 150, 60, 45], starLeft: [18, 212, 26, 19], bow: [0, 232, 70, 92],
  starRight: [145, 256, 24, 24], starMid: [120, 277, 24, 24],
  starLow: [33, 375, 24, 22], ringRight: [143, 368, 40, 34],
  bigStar: [136, 428, 56, 66], ringCorner: [0, 480, 34, 50], ringFoot: [60, 522, 36, 32], starFoot: [122, 514, 22, 22],
};
const upper = ['ringTop', 'starLeft', 'bow'];
const second = ['starRight', 'starMid'];
const third = ['starLow', 'ringRight'];
const foot = ['bigStar', 'ringCorner', 'ringFoot', 'starFoot'];

function layout(n) {
  const height = FRAME.y + n * FRAME.h + (n - 1) * (FRAME.pitch - FRAME.h) + FOOT;
  const shift = height - FULL_H;
  const frames = Array.from({ length: n }, (_, i) => FRAME.y + i * FRAME.pitch);
  const place = (name, dy) => {
    const [x, y, w, h] = D[name];
    return `S,${x},${y},${w},${h},${x},${(y + dy).toFixed(3)}`;
  };
  // One photo: the corner ring would run into the bow, so it stays out.
  const stickers = [...upper.map((d) => place(d, 0)),
    ...(n >= 2 ? second.map((d) => place(d, 0)) : []),
    ...(n >= 3 ? third.map((d) => place(d, 0)) : []),
    ...(n >= 4 ? third.map((d) => place(d, FRAME.pitch)) : []),
    ...foot.filter((d) => n > 1 || d !== 'ringCorner').map((d) => place(d, shift))];
  const b = height - HOUSE_FOOT;
  const house = [96, 19.2, 131.733, 49.67, 131.733, 29.585, 164.16, 29.585, 164.16, 77.33, 184.953, 95.05,
    178.877, 95.05, 178.877, b.toFixed(3), 13.123, b.toFixed(3), 13.123, 95.05, 7.047, 95.05];
  const spec = [`C,${W},${height.toFixed(3)},${HEADER_END},${b.toFixed(3)},${HOUSE_END}`,
    `H,${house.join(',')}`,
    ...frames.map((y) => `R,${FRAME.x},${y.toFixed(3)},${FRAME.w},${FRAME.h},${FRAME.stroke}`),
    ...stickers].join('|');
  return { n, height, frames, spec };
}

const layouts = [1, 2, 3, 4].map(layout);
const q = (p) => p.replace(/'/g, "''");
const here = (name) => q(join(import.meta.dirname, name));
const paperArt = here('slowdays-paper.tmp.png'), doodleArt = here('slowdays-doodles.tmp.png');
const calls = [`[SlowDaysTheme]::Paper('${here('slowdays-clean-src.png')}', '${paperArt}', ${PILL.join(', ')})`,
  `[SlowDaysTheme]::Doodles('${here('slowdays-doodles-src.png')}', '${here('slowdays-clean-src.png')}', '${doodleArt}')`,
  ...layouts.map((l) => `[SlowDaysTheme]::Variant('${paperArt}', '${doodleArt}', '${l.spec}', '${q(join(outDir, `receipt-${l.n}-paper.png`))}', '${q(join(outDir, `receipt-${l.n}-over.png`))}')`)];
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `$ErrorActionPreference='Stop'; Add-Type -ReferencedAssemblies System.Drawing -Path '${here('slowdays-render.cs')}'; ${calls.join('; ')}`], { stdio: 'inherit' });
rmSync(join(import.meta.dirname, 'slowdays-paper.tmp.png'), { force: true });
rmSync(join(import.meta.dirname, 'slowdays-doodles.tmp.png'), { force: true });

const ASSET = (name) => `/theme-packs/slowdays/${name}`;
const templates = layouts.map(({ n, height, frames }) => {
  const width = 576, k = width / W, h = Math.round(height * k);
  const r = (v) => Math.round(v * k);
  return {
    schemaVersion: 1,
    templateId: `custom_pack_slowdays_80_${n}`,
    layoutId: `${n}_4x3`,
    name: `Slow Days · 80mm · ${n} รูป`,
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
    artboard: [{ id: 'doodles', name: 'Doodles and photo borders', url: ASSET(`receipt-${n}-over.png`), placement: 'front',
      x: 0, y: 0, width, height: h, rotation: 0, zIndex: 220, opacity: 1, visible: true }],
    slots: frames.map((y, i) => ({ index: i + 1, x: r(FRAME.x), y: r(y), width: r(FRAME.w), height: r(FRAME.h), rotation: 0,
      zIndex: i + 1, focusX: 0.5, focusY: 0.42, shape: 'rectangle' })),
    printSettings: { printTwoPerPage: false, paperSize: '80mm' },
  };
});
writeFileSync(join(root, 'public', 'theme-packs', 'slowdays-80mm.json'),
  JSON.stringify({ packId: 'slowdays-80mm', version: 1, name: 'Slow Days (80mm)', templates }, null, 2) + '\n');
console.log('slow days:', templates.map((t) => `${t.name} ${t.canvas.width}x${t.canvas.height}`).join(' | '));
