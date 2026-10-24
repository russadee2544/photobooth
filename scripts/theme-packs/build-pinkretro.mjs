// Builds the "Pink Retro" theme pack from the owner's Canva strip (design 192 x 576 units, 4 photos:
// two rounded rectangles and two clouds), text changed to the café's name.
//   Inputs (exported from Canva at 1200 x 3600):
//     scripts/theme-packs/pinkretro-under-src.png   background without the photos / overlapping stickers
//     scripts/theme-packs/pinkretro-over-src.png    stickers that sit on top of the photos (transparent)
//   Outputs:
//     public/theme-packs/pinkretro/paper.jpg, paper-thermal.jpg, over.png
//     public/theme-packs/pinkretro-2x6.json   (photo strip printers)
//     public/theme-packs/pinkretro-80mm.json  (80 mm receipt printers, light paper)
// Usage: node scripts/theme-packs/build-pinkretro.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const outDir = join(root, 'public', 'theme-packs', 'pinkretro');
mkdirSync(outDir, { recursive: true });

const DESIGN_W = 192, DESIGN_H = 576, EXPORT_W = 1200;
// Photo frames in design units (from the Canva document).
const FRAMES = [
  { shape: 'rounded', x: 27.367, y: 44.540, w: 137.266, h: 89.849, stroke: '#fc8fc8' },
  { shape: 'cloud', x: 19.2, y: 147.752, w: 153.6, h: 108.478, stroke: '#ebc0e7' },
  { shape: 'rounded', x: 27.367, y: 269.591, w: 137.266, h: 89.849, stroke: '#fc8fc8' },
  { shape: 'cloud', x: 19.2, y: 372.936, w: 153.6, h: 108.478, stroke: '#ebc0e7' },
];
const STROKE = 2;   // design units

// The cloud as a unit-square path, the same one template-engine.js clips the photo with.
const engineSrc = readFileSync(join(root, 'public', 'template-engine.js'), 'utf8');
const cloud = JSON.parse(/const CLOUD = (\[.*?\]);/s.exec(engineSrc)[1]);
const cloudPath = cloud.map(([cmd, ...n]) => `${cmd} ${n.join(' ')}`).join(' ');

const ek = EXPORT_W / DESIGN_W;
const shapes = FRAMES.map((f) => [f.shape === 'cloud' ? 'cloud' : 'rounded', f.x * ek, f.y * ek, f.w * ek, f.h * ek, f.stroke, STROKE * ek]
  .map((v) => (typeof v === 'number' ? v.toFixed(2) : v)).join(',')).join(';');

const cs = join(import.meta.dirname, 'pinkretro-render.cs').replace(/'/g, "''");
const q = (p) => p.replace(/'/g, "''");
const src = (n) => q(join(import.meta.dirname, n));
const out = (n) => q(join(outDir, n));
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `$ErrorActionPreference='Stop'; Add-Type -ReferencedAssemblies System.Drawing -Path '${cs}';
   [PinkRetroTheme]::Paper('${src('pinkretro-under-src.png')}', '${out('paper.jpg')}');
   [PinkRetroTheme]::ThermalPaper('${src('pinkretro-under-src.png')}', '${out('paper-thermal.jpg')}');
   [PinkRetroTheme]::Over('${src('pinkretro-over-src.png')}', '${out('over.png')}', '${shapes}', '${cloudPath}')`], { stdio: 'inherit' });

const ASSET = (name) => `/theme-packs/pinkretro/${name}`;
function template({ id, name, type, width, dpi, paper, background, paperSize }) {
  const k = width / DESIGN_W;
  const height = Math.round(DESIGN_H * k);
  const r = (v) => Math.round(v * k);
  return {
    schemaVersion: 1,
    templateId: id,
    layoutId: '4_3x2',
    name,
    type,
    orientation: 'portrait',
    enabled: true,
    isCustom: true,
    canvas: {
      width, height, dpi, backgroundColor: background,
      backgroundImage: ASSET(paper), backgroundFitMode: 'stretch',
      safeMargin: { top: 0, bottom: 0, left: 0, right: 0 },
      bleedMargin: { top: 0, bottom: 0, left: 0, right: 0 },
    },
    overlay: { url: '', zIndex: 100, fitMode: 'cover' },
    artboard: [{ id: 'stickers', name: 'Stickers and frame lines', url: ASSET('over.png'), placement: 'front',
      x: 0, y: 0, width, height, rotation: 0, zIndex: 220, opacity: 1, visible: true }],
    slots: FRAMES.map((f, i) => ({ index: i + 1, x: r(f.x), y: r(f.y), width: r(f.w), height: r(f.h), rotation: 0,
      zIndex: i + 1, focusX: 0.5, focusY: 0.42, shape: f.shape })),
    printSettings: { printTwoPerPage: type === '2x6', paperSize },
  };
}

const strip = template({ id: 'custom_pack_pinkretro_2x6_4', name: 'Pink Retro · 2×6 · 4 รูป', type: '2x6', width: 600, dpi: 300,
  paper: 'paper.jpg', background: '#232323', paperSize: '2x6' });
const receipt = template({ id: 'custom_pack_pinkretro_80_4', name: 'Pink Retro · 80mm · 4 รูป', type: 'thermal80', width: 576, dpi: 203,
  paper: 'paper-thermal.jpg', background: '#FFFFFF', paperSize: '80mm' });
writeFileSync(join(root, 'public', 'theme-packs', 'pinkretro-2x6.json'),
  JSON.stringify({ packId: 'pinkretro-2x6', version: 1, name: 'Pink Retro (2x6)', templates: [strip] }, null, 2) + '\n');
writeFileSync(join(root, 'public', 'theme-packs', 'pinkretro-80mm.json'),
  JSON.stringify({ packId: 'pinkretro-80mm', version: 1, name: 'Pink Retro (80mm)', templates: [receipt] }, null, 2) + '\n');
console.log('pink retro:', `${strip.canvas.width}x${strip.canvas.height}`, `${receipt.canvas.width}x${receipt.canvas.height}`);
