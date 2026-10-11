// Builds the "Wanted poster" theme pack for 58 mm receipts (1, 2, 3 and 4 photos):
//   public/theme-packs/wanted/*.png|jpg   background + stickers (rendered on Windows with System.Drawing)
//   public/theme-packs/wanted-58mm.json   the four templates, installed on every kiosk by ThemePacks
// Usage: node scripts/theme-packs/build-wanted.mjs <path to the stamp png>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const outDir = join(root, 'public', 'theme-packs', 'wanted');
const stamp = process.argv[2];
if (!stamp) { console.error('usage: node scripts/theme-packs/build-wanted.mjs <stamp.png>'); process.exit(1); }
mkdirSync(outDir, { recursive: true });

const W = 384, M = 12, CW = W - 2 * M, GAP = 8, TOP = 212;
const ASSET = (name) => `/theme-packs/wanted/${name}`;

function variant(count) {
  let slots;
  if (count < 4) {
    const h = Math.round(CW * 3 / 4);                       // 4:3 landscape, full width
    slots = Array.from({ length: count }, (_, i) => ({ x: M, y: TOP + i * (h + GAP), width: CW, height: h }));
  } else {
    const w = (CW - GAP) / 2, h = Math.round(w * 4 / 3);    // 2 x 2, 3:4 portrait
    slots = [0, 1, 2, 3].map((i) => ({ x: M + (i % 2) * (w + GAP), y: TOP + Math.floor(i / 2) * (h + GAP), width: w, height: h }));
  }
  const bottom = Math.max(...slots.map((s) => s.y + s.height));
  const height = bottom + 184;                            // room under the footer for the date the kiosk prints
  const wide = count < 4;
  const layer = (id, name, url, x, y, width, height, placement, zIndex) =>
    ({ id, name, url: ASSET(url), placement, x, y, width, height, rotation: 0, zIndex, opacity: 1, visible: true });
  const artboard = [
    layer('header', 'Header · Criminal News', 'header.png', M, 12, CW, 64, 'front', 210),
    layer('title', 'WANTED', 'title.png', M, 78, CW, 72, 'front', 211),
    layer('wanted_for', 'Wanted for', 'wanted-for.png', M, 152, CW, 54, 'front', 212),
    ...slots.map((s, i) => layer(`frame_${i + 1}`, `Photo frame ${i + 1}`, wide ? 'frame-wide.png' : 'frame-tall.png',
      s.x - 2, s.y - 2, s.width + 4, s.height + 4, 'front', 220 + i)),
    layer('stamp', 'Wanted stamp', 'stamp.png', W - M - 126, TOP - 6, 124, 101, 'front', 240),
    layer('name_bar', 'Name / reward', 'name-bar.png', M, bottom + 8, CW, 36, 'front', 213),
    layer('description', 'Description', 'description.png', M, bottom + 50, CW, 50, 'front', 214),
    layer('footer', 'Footer', 'footer.png', M, bottom + 102, CW, 48, 'front', 215),
  ];
  return {
    schemaVersion: 1,
    templateId: `custom_pack_wanted_58_${count}`,
    layoutId: wide ? `${count}_4x3` : '4_3x4',
    name: `Wanted Poster · 58mm · ${count} รูป`,
    type: 'thermal58',
    orientation: 'portrait',
    enabled: true,
    isCustom: true,
    canvas: {
      width: W, height, dpi: 203, backgroundColor: '#F4E8CE',
      backgroundImage: ASSET(`paper-${count}.jpg`), backgroundFitMode: 'stretch',
      safeMargin: { top: 8, bottom: 8, left: 8, right: 8 },
      bleedMargin: { top: 0, bottom: 0, left: 0, right: 0 },
    },
    overlay: { url: '', zIndex: 100, fitMode: 'cover' },
    artboard,
    slots: slots.map((s, i) => ({ index: i + 1, ...s, rotation: 0, zIndex: i + 1, focusX: 0.5, focusY: 0.42, shape: 'rectangle' })),
    printSettings: { printTwoPerPage: false, paperSize: '58mm' },
  };
}

const templates = [1, 2, 3, 4].map(variant);
const pack = { packId: 'wanted-58mm', version: 1, name: 'Wanted Poster (58mm)', templates };
writeFileSync(join(root, 'public', 'theme-packs', 'wanted-58mm.json'), JSON.stringify(pack, null, 2) + '\n');

// Render the images (one paper background per layout height, stickers shared).
const cs = join(import.meta.dirname, 'wanted-render.cs').replace(/'/g, "''");
const out = outDir.replace(/'/g, "''");
const src = stamp.replace(/'/g, "''");
const papers = templates.map((t, i) => `[WantedTheme]::Paper('${out}', 'paper-${i + 1}.jpg', 384, ${t.canvas.height}, ${11 + i})`).join('; ');
const ps = `$ErrorActionPreference='Stop'; Add-Type -ReferencedAssemblies System.Drawing -Path '${cs}';
  [WantedTheme]::Header('${out}'); [WantedTheme]::Title('${out}'); [WantedTheme]::WantedFor('${out}');
  [WantedTheme]::Frame('${out}', 'frame-wide.png', ${CW + 4}, ${Math.round(CW * 3 / 4) + 4});
  [WantedTheme]::Frame('${out}', 'frame-tall.png', ${(CW - GAP) / 2 + 4}, ${Math.round(((CW - GAP) / 2) * 4 / 3) + 4});
  [WantedTheme]::NameBar('${out}'); [WantedTheme]::Description('${out}'); [WantedTheme]::Footer('${out}');
  [WantedTheme]::Stamp('${src}', '${out}'); ${papers}`;
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' });
console.log('theme pack written:', templates.map((t) => `${t.name} ${t.canvas.width}x${t.canvas.height}`).join(' | '));
