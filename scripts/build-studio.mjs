// Packs the phone photo studio as its own static site (for Vercel, GitHub Pages or any web host):
//   dist-studio/index.html, studio.js, look-engine.js, template-engine.js
// The site must sit at the root of its domain (the page loads /look-engine.js etc.).
// The kiosk's admin page then gets that address under "สตูดิโอแต่งรูปบนมือถือ".
// Usage: node scripts/build-studio.mjs
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const out = join(root, 'dist-studio');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const html = readFileSync(join(root, 'studio', 'index.html'), 'utf8')
  .replace('<script src="/studio/studio.js"></script>', '<script src="/studio.js"></script>');
writeFileSync(join(out, 'index.html'), html);
copyFileSync(join(root, 'public', 'studio', 'studio.js'), join(out, 'studio.js'));
copyFileSync(join(root, 'public', 'look-engine.js'), join(out, 'look-engine.js'));
copyFileSync(join(root, 'public', 'template-engine.js'), join(out, 'template-engine.js'));
// Every path is the same page (the session id travels in the #hash); no caching of the page itself.
writeFileSync(join(out, 'vercel.json'), JSON.stringify({
  headers: [{ source: '/(.*)', headers: [{ key: 'Cache-Control', value: 'no-cache' }] }],
}, null, 2) + '\n');
console.log('studio site written to', out);
