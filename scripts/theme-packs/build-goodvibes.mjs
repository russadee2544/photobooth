// Builds the "Good Vibes" theme pack for 80 mm receipts (1, 2, 3 and 4 photos), after the owner's Canva
// strip: red paper, cloud-shaped photo frames, flowers, sparkles, "GOOD VIBES" lettering.
//   public/theme-packs/goodvibes/*.png|jpg   background + stickers (rendered on Windows with System.Drawing)
//   public/theme-packs/goodvibes-80mm.json   the four templates, installed on every kiosk by ThemePacks
// Usage: node scripts/theme-packs/build-goodvibes.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const outDir = join(root, 'public', 'theme-packs', 'goodvibes');
mkdirSync(outDir, { recursive: true });

const W = 576, M = 30, CW = W - 2 * M, GAP = 22, TOP = 34, TITLE_H = 250;
const WIDE = { w: CW, h: Math.round(CW * 3 / 4) };
const TALL = { w: (CW - GAP) / 2, h: Math.round(((CW - GAP) / 2) * 4 / 3) };
const ASSET = (name) => `/theme-packs/goodvibes/${name}`;

function variant(count) {
  const wide = count < 4;
  const slots = wide
    ? Array.from({ length: count }, (_, i) => ({ x: M, y: TOP + i * (WIDE.h + GAP), width: WIDE.w, height: WIDE.h }))
    : [0, 1, 2, 3].map((i) => ({ x: M + (i % 2) * (TALL.w + GAP), y: TOP + Math.floor(i / 2) * (TALL.h + GAP), width: TALL.w, height: TALL.h }));
  const bottom = Math.max(...slots.map((s) => s.y + s.height));
  const height = bottom + 24 + TITLE_H + 44;                  // title + room for the date the kiosk prints
  const first = slots[0], last = slots[slots.length - 1];
  let z = 220;
  const layer = (id, name, url, x, y, w, h) =>
    ({ id, name, url: ASSET(url), placement: 'front', x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h), rotation: 0, zIndex: z++, opacity: 1, visible: true });
  const artboard = [
    ...slots.map((s, i) => layer(`frame_${i + 1}`, `Cloud frame ${i + 1}`, wide ? 'frame-wide.png' : 'frame-tall.png', s.x - 6, s.y - 6, s.width + 12, s.height + 12)),
    layer('pink_flower', 'Pink flower', 'pink-flower.png', W - M - 120, first.y - 20, 130, 130),
    layer('sparkle_big', 'Sparkle', 'sparkle.png', 4, first.y + first.height * 0.62, 78, 78),
    layer('sparkle_small', 'Sparkle small', 'sparkle.png', 52, first.y + first.height * 0.86, 44, 44),
    layer('daisy', 'Daisy', 'daisy.png', W - M - 150, last.y + last.height * 0.48, 170, 170),
    layer('hearts', 'Hearts', 'hearts.png', 6, last.y + last.height - 108, 130, 130),
    layer('title', 'GOOD VIBES', 'title.png', M, bottom + 24, CW, TITLE_H),
  ];
  return {
    schemaVersion: 1,
    templateId: `custom_pack_goodvibes_80_${count}`,
    layoutId: wide ? `${count}_4x3` : '4_3x4',
    name: `Good Vibes · 80mm · ${count} รูป`,
    type: 'thermal80',
    orientation: 'portrait',
    enabled: true,
    isCustom: true,
    canvas: {
      width: W, height, dpi: 203, backgroundColor: '#F23B2F',
      backgroundImage: ASSET(`paper-${count}.jpg`), backgroundFitMode: 'stretch',
      safeMargin: { top: 12, bottom: 12, left: 12, right: 12 },
      bleedMargin: { top: 0, bottom: 0, left: 0, right: 0 },
    },
    overlay: { url: '', zIndex: 100, fitMode: 'cover' },
    artboard,
    slots: slots.map((s, i) => ({ index: i + 1, ...s, rotation: 0, zIndex: i + 1, focusX: 0.5, focusY: 0.42, shape: 'rectangle' })),
    printSettings: { printTwoPerPage: false, paperSize: '80mm' },
  };
}

const templates = [1, 2, 3, 4].map(variant);
writeFileSync(join(root, 'public', 'theme-packs', 'goodvibes-80mm.json'),
  JSON.stringify({ packId: 'goodvibes-80mm', version: 1, name: 'Good Vibes (80mm)', templates }, null, 2) + '\n');

const cs = join(import.meta.dirname, 'goodvibes-render.cs').replace(/'/g, "''");
const out = outDir.replace(/'/g, "''");
const papers = templates.map((t, i) => `[GoodVibesTheme]::Paper('${out}', 'paper-${i + 1}.jpg', ${W}, ${t.canvas.height})`).join('; ');
const ps = `$ErrorActionPreference='Stop'; Add-Type -ReferencedAssemblies System.Drawing -Path '${cs}';
  [GoodVibesTheme]::Frame('${out}', 'frame-wide.png', ${WIDE.w + 12}, ${WIDE.h + 12});
  [GoodVibesTheme]::Frame('${out}', 'frame-tall.png', ${TALL.w + 12}, ${TALL.h + 12});
  [GoodVibesTheme]::Sparkle('${out}', 'sparkle.png', 80); [GoodVibesTheme]::Daisy('${out}', 'daisy.png', 170);
  [GoodVibesTheme]::PinkFlower('${out}', 'pink-flower.png', 130); [GoodVibesTheme]::Hearts('${out}', 'hearts.png', 130);
  [GoodVibesTheme]::Title('${out}', 'title.png', ${CW}, ${TITLE_H}); ${papers}`;
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' });
console.log('theme pack written:', templates.map((t) => `${t.name} ${t.canvas.width}x${t.canvas.height}`).join(' | '));
