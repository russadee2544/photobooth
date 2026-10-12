// Builds the "Boarding pass" theme pack for 58 mm receipts (1, 2, 3 and 4 photos), after the owner's
// Canva design: cream ticket (airline, route, passenger details) on top, navy stub with the photos below.
//   public/theme-packs/boarding/*.png|jpg   background + stickers (rendered on Windows with System.Drawing)
//   public/theme-packs/boarding-58mm.json   the four templates, installed on every kiosk by ThemePacks
// Usage: node scripts/theme-packs/build-boarding.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const outDir = join(root, 'public', 'theme-packs', 'boarding');
mkdirSync(outDir, { recursive: true });

const W = 384, M = 16, CW = W - 2 * M, GAP = 10;
const TICKET_Y = 14, TICKET_H = 212, PERF = TICKET_Y + TICKET_H + 18;   // tear line between ticket and stub
const STUB_HEADER_Y = PERF + 12, TOP = STUB_HEADER_Y + 46;
const ASSET = (name) => `/theme-packs/boarding/${name}`;

function variant(count) {
  let slots;
  if (count < 4) {
    const h = Math.round(CW * 3 / 4);
    slots = Array.from({ length: count }, (_, i) => ({ x: M, y: TOP + i * (h + GAP), width: CW, height: h }));
  } else {
    const w = (CW - GAP) / 2, h = Math.round(w * 4 / 3);
    slots = [0, 1, 2, 3].map((i) => ({ x: M + (i % 2) * (w + GAP), y: TOP + Math.floor(i / 2) * (h + GAP), width: w, height: h }));
  }
  const bottom = Math.max(...slots.map((s) => s.y + s.height));
  const height = bottom + 14 + 34 + 28;                      // barcode row + room for the date the kiosk prints
  const layer = (id, name, url, x, y, width, h, zIndex) =>
    ({ id, name, url: ASSET(url), placement: 'front', x, y, width, height: h, rotation: 0, zIndex, opacity: 1, visible: true });
  return {
    schemaVersion: 1,
    templateId: `custom_pack_boarding_58_${count}`,
    layoutId: count < 4 ? `${count}_4x3` : '4_3x4',
    name: `Boarding Pass · 58mm · ${count} รูป`,
    type: 'thermal58',
    orientation: 'portrait',
    enabled: true,
    isCustom: true,
    canvas: {
      width: W, height, dpi: 203, backgroundColor: '#1B2470',
      backgroundImage: ASSET(`paper-${count}.jpg`), backgroundFitMode: 'stretch',
      safeMargin: { top: 8, bottom: 8, left: 8, right: 8 },
      bleedMargin: { top: 0, bottom: 0, left: 0, right: 0 },
    },
    overlay: { url: '', zIndex: 100, fitMode: 'cover' },
    artboard: [
      layer('ticket', 'Ticket · route and passenger', 'ticket.png', M, TICKET_Y, CW, TICKET_H, 210),
      layer('stub_header', 'Stub · route and seat', 'stub-header.png', M, STUB_HEADER_Y, CW, 40, 211),
      layer('stub_footer', 'Stub · barcode', 'stub-footer.png', M, bottom + 14, CW, 34, 212),
    ],
    slots: slots.map((s, i) => ({ index: i + 1, ...s, rotation: 0, zIndex: i + 1, focusX: 0.5, focusY: 0.42, shape: 'rounded' })),
    printSettings: { printTwoPerPage: false, paperSize: '58mm' },
  };
}

const templates = [1, 2, 3, 4].map(variant);
const pack = { packId: 'boarding-58mm', version: 1, name: 'Boarding Pass (58mm)', templates };
writeFileSync(join(root, 'public', 'theme-packs', 'boarding-58mm.json'), JSON.stringify(pack, null, 2) + '\n');

const cs = join(import.meta.dirname, 'boarding-render.cs').replace(/'/g, "''");
const out = outDir.replace(/'/g, "''");
const papers = templates.map((t, i) => `[BoardingTheme]::Paper('${out}', 'paper-${i + 1}.jpg', ${W}, ${t.canvas.height}, ${PERF})`).join('; ');
const ps = `$ErrorActionPreference='Stop'; Add-Type -ReferencedAssemblies System.Drawing -Path '${cs}';
  [BoardingTheme]::Ticket('${out}', ${CW}, ${TICKET_H}); [BoardingTheme]::StubHeader('${out}', ${CW}, 40);
  [BoardingTheme]::StubFooter('${out}', ${CW}, 34); ${papers}`;
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' });
console.log('theme pack written:', templates.map((t) => `${t.name} ${t.canvas.width}x${t.canvas.height}`).join(' | '));
