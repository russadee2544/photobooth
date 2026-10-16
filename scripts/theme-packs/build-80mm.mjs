// Makes the 80 mm versions of the receipt theme packs from their 58 mm packs.
// 80 mm heads print 576 dots across (58 mm: 384), so every position and size scales by 1.5.
// The sticker PNGs are drawn 3x the 58 mm size and the paper backgrounds 2x, so the same
// images stay sharp at 80 mm; nothing has to be re-rendered.
// Usage: node scripts/theme-packs/build-80mm.mjs   (run again after rebuilding a 58 mm pack)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', '..', 'public', 'theme-packs');
const K = 576 / 384;
const scale = (v) => Math.round(v * K);
const box = (o) => ({ ...o, x: scale(o.x), y: scale(o.y), width: scale(o.width), height: scale(o.height) });

for (const name of ['wanted', 'exhibition', 'boarding']) {
  const pack = JSON.parse(readFileSync(join(dir, `${name}-58mm.json`), 'utf8'));
  const templates = pack.templates.map((t) => ({
    ...t,
    templateId: t.templateId.replace('_58_', '_80_'),
    name: t.name.replace('58mm', '80mm'),
    type: 'thermal80',
    canvas: {
      ...t.canvas,
      width: 576,
      height: scale(t.canvas.height),
      safeMargin: Object.fromEntries(Object.entries(t.canvas.safeMargin).map(([k, v]) => [k, scale(v)])),
    },
    artboard: t.artboard.map(box),
    slots: t.slots.map(box),
    printSettings: { ...t.printSettings, paperSize: '80mm' },
  }));
  const out = { packId: `${name}-80mm`, version: pack.version, name: pack.name.replace('58mm', '80mm'), templates };
  writeFileSync(join(dir, `${name}-80mm.json`), JSON.stringify(out, null, 2) + '\n');
  console.log(`${name}-80mm:`, templates.map((t) => `${t.slots.length} รูป ${t.canvas.width}x${t.canvas.height}`).join(' | '));
}
