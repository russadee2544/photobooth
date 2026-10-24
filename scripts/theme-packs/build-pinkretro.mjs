// Builds the "Pink Retro" theme pack from the owner's Canva strip (design 192 x 576 units, 4 photos:
// rounded rectangles and clouds), text changed to the café's name. 1, 2, 3 and 4 photo versions are
// put together from pieces of the design (see pinkretro-render.cs).
//   Inputs (exported from Canva at 1200 x 3600):
//     scripts/theme-packs/pinkretro-under-src.png   background without the photos / overlapping stickers
//     scripts/theme-packs/pinkretro-over-src.png    stickers that sit on top of the photos (transparent)
//   Outputs:
//     public/theme-packs/pinkretro/{strip,receipt}-N-{paper,over}.* (+ receipt-N-paper is the light one)
//     public/theme-packs/pinkretro-2x6.json   photo strip printers: 600 x 1800 strips, frames spread out
//     public/theme-packs/pinkretro-80mm.json  80 mm receipt printers: light paper, height follows the photos
// Usage: node scripts/theme-packs/build-pinkretro.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const outDir = join(root, 'public', 'theme-packs', 'pinkretro');
mkdirSync(outDir, { recursive: true });

const W = 192, FULL_H = 576;
const TOP = { src: [0, 70], letters: [16, 34] };            // café name, ring heart
const BOTTOM = { src: [485, 576], letters: [3, 75] };       // "Baanmai Cafe / Hello Ai-Oon" (relative)
const GLOW = [70, 485];                                      // flower and heart glows, stretched to fit

// Frames in design units (from the Canva document).
const R = (y) => ({ shape: 'rounded', x: 27.367, y, w: 137.266, h: 89.849, stroke: '#fc8fc8' });
const C = (y) => ({ shape: 'cloud', x: 19.2, y, w: 153.6, h: 108.478, stroke: '#ebc0e7' });
// Sticker pieces of the sticker layer: [srcX, srcY, srcW, srcH], placed relative to a frame's original y.
const PIECES = {
  smileHeartPearl: { box: [0, 110, 192, 135], frameY: 147.752 },  // Smile + big heart + pearl heart (cloud 2)
  blueHeart: { box: [128, 252, 64, 58], frameY: 269.591 },        // small heart (rounded 3)
  memoriesHeartStar: { box: [0, 326, 192, 176], frameY: 372.936 },// Memories + heart + star (cloud 4)
  memories: { box: [70, 326, 122, 62], frameY: 269.591 },         // Memories pill under rounded 3
  star: { box: [118, 415, 74, 87], frameY: 372.936 },             // star at a cloud's lower right
};

// Compact layouts (receipt). frames: [frame, [pieces attached to it]]; end: where the bottom band starts.
const LAYOUTS = {
  1: { frames: [[C(52), ['smileHeartPearl', 'star']]], end: 182 },
  2: { frames: [[R(44.540), []], [C(147.752), ['smileHeartPearl', 'star']]], end: 280 },
  3: { frames: [[R(44.540), []], [C(147.752), ['smileHeartPearl']], [R(269.591), ['blueHeart', 'memories']]], end: 392 },
  4: { frames: [[R(44.540), []], [C(147.752), ['smileHeartPearl']], [R(269.591), ['blueHeart']], [C(372.936), ['memoriesHeartStar']]], end: 485 },
};

// Spread a compact layout to a fixed height (photo strips are always 2x6).
function place(layout, height) {
  const compact = layout.end + (BOTTOM.src[1] - BOTTOM.src[0]);
  const extra = Math.max(0, height - compact);
  const n = layout.frames.length;
  const frames = layout.frames.map(([f, pieces], i) => {
    const dy = (extra * (i + 1)) / (n + 1);
    return { frame: { ...f, y: f.y + dy }, pieces, origY: f.y };
  });
  return { frames, end: layout.end + extra, height: Math.max(height, compact) };
}

function spec(placed) {
  const H = placed.height;
  const items = [`C,${W},${H.toFixed(2)}`];
  items.push(`B,${TOP.src[0]},${TOP.src[1]},0,${TOP.src[1]}`);
  items.push(`B,${GLOW[0]},${GLOW[1]},${TOP.src[1]},${placed.end.toFixed(2)}`);
  items.push(`B,${BOTTOM.src[0]},${BOTTOM.src[1]},${placed.end.toFixed(2)},${H.toFixed(2)}`);
  items.push(`T,${TOP.letters[0]},${TOP.letters[1]}`);
  items.push(`T,${(placed.end + BOTTOM.letters[0]).toFixed(2)},${(placed.end + BOTTOM.letters[1]).toFixed(2)}`);
  for (const { frame: f } of placed.frames) items.push(`O,${f.shape},${f.x},${f.y.toFixed(2)},${f.w},${f.h},${f.stroke}`);
  for (const { frame: f, pieces } of placed.frames) {
    for (const name of pieces) {
      const p = PIECES[name];
      const [sx, sy, sw, sh] = p.box;
      items.push(`S,${sx},${sy},${sw},${sh},${sx},${(sy - p.frameY + f.y).toFixed(2)}`);
    }
  }
  return items.join('|');
}

const engineSrc = readFileSync(join(root, 'public', 'template-engine.js'), 'utf8');
const cloud = JSON.parse(/const CLOUD = (\[.*?\]);/s.exec(engineSrc)[1]);
const cloudPath = cloud.map(([cmd, ...n]) => `${cmd} ${n.join(' ')}`).join(' ');

const q = (p) => p.replace(/'/g, "''");
const cs = q(join(import.meta.dirname, 'pinkretro-render.cs'));
const src = (n) => q(join(import.meta.dirname, n));
const out = (n) => q(join(outDir, n));
const calls = [];
const variants = [];
for (const kind of ['strip', 'receipt']) {
  for (const n of [1, 2, 3, 4]) {
    const placed = place(LAYOUTS[n], kind === 'strip' ? FULL_H : 0);
    variants.push({ kind, n, placed });
    // strip uses the dark paper, receipt the light one; both get written, one is used
    calls.push(`[PinkRetroTheme]::Variant('${src('pinkretro-under-src.png')}', '${src('pinkretro-over-src.png')}', '${spec(placed)}', '${cloudPath}', '${out(`${kind}-${n}-dark.jpg`)}', '${out(`${kind}-${n}-light.jpg`)}', '${out(`${kind}-${n}-over.png`)}')`);
  }
}
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `$ErrorActionPreference='Stop'; Add-Type -ReferencedAssemblies System.Drawing -Path '${cs}'; ${calls.join('; ')}`], { stdio: 'inherit' });

// Each variant only needs one paper: dark for strips, light for receipts.
for (const n of [1, 2, 3, 4]) {
  rmSync(join(outDir, `strip-${n}-light.jpg`), { force: true });
  rmSync(join(outDir, `receipt-${n}-dark.jpg`), { force: true });
}

const ASSET = (name) => `/theme-packs/pinkretro/${name}`;
function template({ kind, n, placed }) {
  const strip = kind === 'strip';
  const width = strip ? 600 : 576;
  const k = width / W;
  const height = Math.round(placed.height * k);
  const r = (v) => Math.round(v * k);
  return {
    schemaVersion: 1,
    templateId: strip ? `custom_pack_pinkretro_2x6_${n}` : `custom_pack_pinkretro_80_${n}`,
    layoutId: `${n}_3x2`,
    name: `Pink Retro · ${strip ? '2×6' : '80mm'} · ${n} รูป`,
    type: strip ? '2x6' : 'thermal80',
    orientation: 'portrait',
    enabled: true,
    isCustom: true,
    canvas: {
      width, height, dpi: strip ? 300 : 203, backgroundColor: strip ? '#232323' : '#FFFFFF',
      backgroundImage: ASSET(`${kind}-${n}-${strip ? 'dark' : 'light'}.jpg`), backgroundFitMode: 'stretch',
      safeMargin: { top: 0, bottom: 0, left: 0, right: 0 },
      bleedMargin: { top: 0, bottom: 0, left: 0, right: 0 },
    },
    overlay: { url: '', zIndex: 100, fitMode: 'cover' },
    artboard: [{ id: 'stickers', name: 'Stickers and frame lines', url: ASSET(`${kind}-${n}-over.png`), placement: 'front',
      x: 0, y: 0, width, height, rotation: 0, zIndex: 220, opacity: 1, visible: true }],
    slots: placed.frames.map(({ frame: f }, i) => ({ index: i + 1, x: r(f.x), y: r(f.y), width: r(f.w), height: r(f.h), rotation: 0,
      zIndex: i + 1, focusX: 0.5, focusY: 0.42, shape: f.shape })),
    printSettings: { printTwoPerPage: strip, paperSize: strip ? '2x6' : '80mm' },
  };
}

const strips = variants.filter((v) => v.kind === 'strip').map(template);
const receipts = variants.filter((v) => v.kind === 'receipt').map(template);
writeFileSync(join(root, 'public', 'theme-packs', 'pinkretro-2x6.json'),
  JSON.stringify({ packId: 'pinkretro-2x6', version: 2, name: 'Pink Retro (2x6)', templates: strips }, null, 2) + '\n');
writeFileSync(join(root, 'public', 'theme-packs', 'pinkretro-80mm.json'),
  JSON.stringify({ packId: 'pinkretro-80mm', version: 2, name: 'Pink Retro (80mm)', templates: receipts }, null, 2) + '\n');
console.log('pink retro:', [...strips, ...receipts].map((t) => `${t.name} ${t.canvas.width}x${t.canvas.height}`).join(' | '));
