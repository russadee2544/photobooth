// Builds the "Memory Airlines" theme pack (80 mm receipts, 1-4 photos) from the owner's Canva boarding pass
// strip, with the café's English name in place of the airline. Red prints as dots, so bands turn solid black
// (memoryreport-render.cs does the conversion and joins the pieces).
//   Input:  scripts/theme-packs/airline-src.png (Canva export without the sample photos, 1200 x 3600 = 192 x 576)
//   Output: public/theme-packs/airline/receipt-N-paper.png, public/theme-packs/airline-80mm.json
// Usage: node scripts/theme-packs/build-airline.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const outDir = join(root, 'public', 'theme-packs', 'airline');
mkdirSync(outDir, { recursive: true });

const W = 192, FULL_H = 576;
const FRAME = { x: 12.178, y: 61.897, w: 167.644, h: 120.835, gap: 4.592 };
const HEADER_END = 58, FOOTER_START = 441;                // top band and bottom band pieces of the design

// Four photos sit two by two (portrait 3:4) in the photo area; one to three photos stack.
const GRID = 4, CELL_W = (FRAME.w - FRAME.gap) / 2, CELL_H = CELL_W * 4 / 3;
function layout(n) {
  const grid = n === GRID;
  const frames = grid
    ? [0, 1, 2, 3].map((i) => ({ x: FRAME.x + (i % 2) * (CELL_W + FRAME.gap), y: FRAME.y + Math.floor(i / 2) * (CELL_H + FRAME.gap), w: CELL_W, h: CELL_H }))
    : Array.from({ length: n }, (_, i) => ({ x: FRAME.x, y: FRAME.y + i * (FRAME.h + FRAME.gap), w: FRAME.w, h: FRAME.h }));
  const area = grid ? 2 * CELL_H + FRAME.gap : n * FRAME.h + (n - 1) * FRAME.gap;
  const shift = 3 * FRAME.h + 2 * FRAME.gap - area;
  const height = FULL_H - shift;
  return { n, height, frames, file: grid ? `receipt-${n}grid-paper.png` : `receipt-${n}-paper.png`, spec: [`C,${W},${height.toFixed(3)}`, `P,0,${HEADER_END},0`,
    `P,${FOOTER_START},${FULL_H},${(FOOTER_START - shift).toFixed(3)}`].join('|') };
}

const layouts = [1, 2, 3, 4].map(layout);
const q = (p) => p.replace(/'/g, "''");
const cs = q(join(import.meta.dirname, 'memoryreport-render.cs'));
const art = join(import.meta.dirname, 'airline-ink.tmp.png');
const calls = [`[MemoryReportTheme]::Ink('${q(join(import.meta.dirname, 'airline-src.png'))}', '${q(art)}')`,
  ...layouts.map((l) => `[MemoryReportTheme]::Variant('${q(art)}', '${l.spec}', '${q(join(outDir, l.file))}')`)];
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `$ErrorActionPreference='Stop'; Add-Type -ReferencedAssemblies System.Drawing -Path '${cs}'; ${calls.join('; ')}`], { stdio: 'inherit' });
rmSync(art, { force: true });

const ASSET = (name) => `/theme-packs/airline/${name}`;
const templates = layouts.map(({ n, height, frames, file }) => {
  const width = 576, k = width / W, r = (v) => Math.round(v * k);
  return {
    schemaVersion: 1,
    templateId: `custom_pack_airline_80_${n}`,
    layoutId: n === GRID ? `${n}_3x4` : `${n}_4x3`,
    name: `Memory Airlines · 80mm · ${n} รูป`,
    type: 'thermal80',
    orientation: 'portrait',
    enabled: true,
    isCustom: true,
    canvas: {
      width, height: Math.round(height * k), dpi: 203, backgroundColor: '#FFFFFF',
      backgroundImage: ASSET(file), backgroundFitMode: 'stretch',
      safeMargin: { top: 0, bottom: 0, left: 0, right: 0 },
      bleedMargin: { top: 0, bottom: 0, left: 0, right: 0 },
    },
    overlay: { url: '', zIndex: 100, fitMode: 'cover' },
    artboard: [],
    slots: frames.map((f, i) => ({ index: i + 1, x: r(f.x), y: r(f.y), width: r(f.w), height: r(f.h), rotation: 0,
      zIndex: i + 1, focusX: 0.5, focusY: 0.42, shape: 'rectangle' })),
    printSettings: { printTwoPerPage: false, paperSize: '80mm' },
  };
});
writeFileSync(join(root, 'public', 'theme-packs', 'airline-80mm.json'),
  JSON.stringify({ packId: 'airline-80mm', version: 2, name: 'Memory Airlines (80mm)', templates }, null, 2) + '\n');
console.log('memory airlines:', templates.map((t) => `${t.name} ${t.canvas.width}x${t.canvas.height}`).join(' | '));
