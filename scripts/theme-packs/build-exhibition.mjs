// Builds the "Exhibition ticket" theme pack for 58 mm receipts (1, 2, 3 and 4 photos), after the
// owner's Canva ticket design: black stub with EXHIBITION + barcode on top, photos on the ticket body,
// the cafe name at the bottom.
//   public/theme-packs/exhibition/*.png|jpg   background + stickers (rendered on Windows with System.Drawing)
//   public/theme-packs/exhibition-58mm.json   the four templates, installed on every kiosk by ThemePacks
// Usage: node scripts/theme-packs/build-exhibition.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const outDir = join(root, 'public', 'theme-packs', 'exhibition');
mkdirSync(outDir, { recursive: true });

const W = 384, M = 16, CW = W - 2 * M, GAP = 10, STUB_H = 144, TOP = STUB_H + 22;
const ASSET = (name) => `/theme-packs/exhibition/${name}`;

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
  const height = bottom + 92;                               // footer + room for the date the kiosk prints
  const layer = (id, name, url, x, y, width, h, zIndex) =>
    ({ id, name, url: ASSET(url), placement: 'front', x, y, width, height: h, rotation: 0, zIndex, opacity: 1, visible: true });
  return {
    schemaVersion: 1,
    templateId: `custom_pack_exhibition_58_${count}`,
    layoutId: count < 4 ? `${count}_4x3` : '4_3x4',
    name: `Exhibition Ticket · 58mm · ${count} รูป`,
    type: 'thermal58',
    orientation: 'portrait',
    enabled: true,
    isCustom: true,
    canvas: {
      width: W, height, dpi: 203, backgroundColor: '#FFFFFF',
      backgroundImage: ASSET(`paper-${count}.jpg`), backgroundFitMode: 'stretch',
      safeMargin: { top: 8, bottom: 8, left: 8, right: 8 },
      bleedMargin: { top: 0, bottom: 0, left: 0, right: 0 },
    },
    overlay: { url: '', zIndex: 100, fitMode: 'cover' },
    artboard: [
      layer('stub', 'Ticket stub · EXHIBITION', 'stub.png', 0, 0, W, STUB_H, 210),
      layer('footer', 'Footer · BAANMAI AI OON', 'footer.png', M, bottom + 16, CW, 40, 211),
    ],
    slots: slots.map((s, i) => ({ index: i + 1, ...s, rotation: 0, zIndex: i + 1, focusX: 0.5, focusY: 0.42, shape: 'rectangle' })),
    printSettings: { printTwoPerPage: false, paperSize: '58mm' },
  };
}

const templates = [1, 2, 3, 4].map(variant);
const pack = { packId: 'exhibition-58mm', version: 1, name: 'Exhibition Ticket (58mm)', templates };
writeFileSync(join(root, 'public', 'theme-packs', 'exhibition-58mm.json'), JSON.stringify(pack, null, 2) + '\n');

const cs = join(import.meta.dirname, 'exhibition-render.cs').replace(/'/g, "''");
const out = outDir.replace(/'/g, "''");
const papers = templates.map((t, i) => `[ExhibitionTheme]::Paper('${out}', 'paper-${i + 1}.jpg', ${W}, ${t.canvas.height})`).join('; ');
const ps = `$ErrorActionPreference='Stop'; Add-Type -ReferencedAssemblies System.Drawing -Path '${cs}';
  [ExhibitionTheme]::Stub('${out}', ${W}, ${STUB_H}, 14); [ExhibitionTheme]::Footer('${out}', ${CW}, 40); ${papers}`;
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' });
console.log('theme pack written:', templates.map((t) => `${t.name} ${t.canvas.width}x${t.canvas.height}`).join(' | '));
