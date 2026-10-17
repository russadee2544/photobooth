// Builds the phone-size (1080 x 1920) version of every receipt theme pack: one big photo slot,
// used as the frame of the GIF a customer downloads from the QR code (the photos take turns in it).
//   public/theme-packs/<name>/story-*.png|jpg   paper + resized frame (rendered with System.Drawing)
//   public/theme-packs/<name>-story.json         { packId, version, template } read by buildSessionGif
// Layouts are drawn in each pack's own units (58 mm = 384 wide, Good Vibes = 576) and scaled up.
// Usage: node scripts/theme-packs/build-story.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const packs = join(root, 'public', 'theme-packs');
const OUT_W = 1080, OUT_H = 1920;
const ps = [];

function write(name, unitsW, layout) {
  const K = OUT_W / unitsW;
  const px = (v) => Math.round(v * K);
  const box = (o) => ({ ...o, x: px(o.x), y: px(o.y), width: px(o.width), height: px(o.height) });
  let z = 210;
  const template = {
    schemaVersion: 1,
    templateId: `custom_pack_${name}_story_1`,
    layoutId: '1_story',
    name: `${layout.title} · GIF 1080×1920`,
    type: 'story',
    orientation: 'portrait',
    enabled: true,
    isCustom: true,
    canvas: {
      width: OUT_W, height: OUT_H, dpi: 300, backgroundColor: layout.color,
      backgroundImage: `/theme-packs/${name}/story-paper.jpg`, backgroundFitMode: 'stretch',
      safeMargin: { top: 0, bottom: 0, left: 0, right: 0 }, bleedMargin: { top: 0, bottom: 0, left: 0, right: 0 },
    },
    overlay: { url: '', zIndex: 100, fitMode: 'cover' },
    artboard: layout.layers.map(([id, url, x, y, w, h]) => box({
      id, name: id, url: `/theme-packs/${name}/${url}`, placement: 'front', x, y, width: w, height: h,
      rotation: 0, zIndex: z++, opacity: 1, visible: true,
    })),
    slots: [box({ index: 1, ...layout.slot, rotation: 0, zIndex: 1, focusX: 0.5, focusY: 0.42, shape: layout.shape || 'rectangle' })],
  };
  writeFileSync(join(packs, `${name}-story.json`),
    JSON.stringify({ packId: `${name}-story`, version: 1, template }, null, 2) + '\n');
  console.log(`${name}-story: slot ${JSON.stringify(template.slots[0])}`);
}
const q = (p) => p.replace(/'/g, "''");
const cs = (file, cls, calls) => ps.push(`Add-Type -ReferencedAssemblies System.Drawing -Path '${q(join(import.meta.dirname, file))}'; ${calls.map((c) => `[${cls}]::${c}`).join('; ')}`);

// ---- Wanted Poster (58 mm units, 384 x 683): the photo grows into the extra height
{
  const H = 683, slot = { x: 12, y: 212, width: 360, height: 287 }, d = slot.height - 270;
  write('wanted', 384, {
    title: 'Wanted Poster', color: '#F4E8CE', slot,
    layers: [
      ['header', 'header.png', 12, 12, 360, 64], ['title', 'title.png', 12, 78, 360, 72],
      ['wanted_for', 'wanted-for.png', 12, 152, 360, 54], ['frame', 'story-frame.png', 10, 210, 364, slot.height + 4],
      ['stamp', 'stamp.png', 246, 206, 124, 101], ['name_bar', 'name-bar.png', 12, 490 + d, 360, 36],
      ['description', 'description.png', 12, 532 + d, 360, 50], ['footer', 'footer.png', 12, 584 + d, 360, 48],
    ],
  });
  const dir = q(join(packs, 'wanted'));
  cs('wanted-render.cs', 'WantedTheme', [`Paper('${dir}', 'story-paper.jpg', 384, ${H}, 21)`, `Frame('${dir}', 'story-frame.png', 364, ${slot.height + 4})`]);
}

// ---- Exhibition Ticket (384 x 683): square photo, the rest as breathing room
{
  const H = 683, top = 36, slot = { x: 16, y: 166 + top, width: 352, height: 352 };
  write('exhibition', 384, {
    title: 'Exhibition Ticket', color: '#FFFFFF', slot,
    layers: [['stub', 'stub.png', 0, 0, 384, 144], ['footer', 'footer.png', 16, slot.y + slot.height + 16, 352, 40]],
  });
  cs('exhibition-render.cs', 'ExhibitionTheme', [`Paper('${q(join(packs, 'exhibition'))}', 'story-paper.jpg', 384, ${H})`]);
}

// ---- Boarding Pass (384 x 683): taller photo in the stub
{
  const H = 683, PERF = 244, slot = { x: 16, y: 302, width: 352, height: 305 };
  write('boarding', 384, {
    title: 'Boarding Pass', color: '#1B2470', slot, shape: 'rounded',
    layers: [
      ['ticket', 'ticket.png', 16, 14, 352, 212], ['stub_header', 'stub-header.png', 16, 256, 352, 40],
      ['stub_footer', 'stub-footer.png', 16, slot.y + slot.height + 14, 352, 34],
    ],
  });
  cs('boarding-render.cs', 'BoardingTheme', [`Paper('${q(join(packs, 'boarding'))}', 'story-paper.jpg', 384, ${H}, ${PERF})`]);
}

// ---- Good Vibes (80 mm units, 576 x 1024): square cloud frame, stickers around it, title below
{
  const W = 576, H = 1024, M = 30, CW = W - 2 * M, slot = { x: M, y: 112, width: CW, height: CW };
  const s = slot, bottom = s.y + s.height;
  write('goodvibes', W, {
    title: 'Good Vibes', color: '#F23B2F', slot,
    layers: [
      ['frame', 'story-frame.png', s.x - 6, s.y - 6, s.width + 12, s.height + 12],
      ['pink_flower', 'pink-flower.png', W - M - 120, s.y - 20, 130, 130],
      ['sparkle_big', 'sparkle.png', 4, s.y + s.height * 0.42, 78, 78],
      ['sparkle_small', 'sparkle.png', 52, s.y + s.height * 0.58, 44, 44],
      ['daisy', 'daisy.png', W - M - 150, s.y + s.height * 0.7, 170, 170],
      ['hearts', 'hearts.png', 6, bottom - 108, 130, 130],
      ['title', 'title.png', M, bottom + 60, CW, 250],
    ],
  });
  const dir = q(join(packs, 'goodvibes'));
  cs('goodvibes-render.cs', 'GoodVibesTheme', [`Paper('${dir}', 'story-paper.jpg', ${W}, ${H})`, `Frame('${dir}', 'story-frame.png', ${CW + 12}, ${CW + 12})`]);
}

// Each renderer in its own PowerShell: the classes are compiled into the session.
for (const script of ps) {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; ${script}`], { stdio: 'inherit' });
}
console.log('story frames written for', OUT_W, 'x', OUT_H);
