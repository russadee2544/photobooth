// One-time provisioning:  node agent/setup.mjs
// Prompts for the values printed by `node scripts/create-kiosk.mjs`, encrypts the
// device credential with DPAPI and writes agent/data/config.json (gitignored).
import { createInterface } from 'node:readline/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { protect } from './dpapi.mjs';
import { CONFIG_FILE } from './paths.mjs';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, d = '') => ((await rl.question(d ? `${q} [${d}]: ` : `${q}: `)).trim() || d);

const supabaseUrl = (await ask('Supabase URL', 'https://zualrdvvlcoexqrbedhl.supabase.co')).replace(/\/$/, '');
const publishableKey = await ask('Supabase publishable key (sb_publishable_...)');
const kioskId = await ask('Kiosk ID');
const credential = await ask('Device credential (shown once by create-kiosk)');
const packageId = await ask('Package ID (optional)');
const mode = await ask('Mode (redeem | event)', 'redeem');
const printerName = await ask('Windows printer name (blank = default printer)');
const port = Number(await ask('Local port', '8787'));
rl.close();

if (!supabaseUrl || !publishableKey || !kioskId || !credential || !['redeem', 'event'].includes(mode)) {
  console.error('Missing or invalid values; nothing written.');
  process.exit(1);
}
await mkdir(dirname(CONFIG_FILE), { recursive: true });
await writeFile(CONFIG_FILE, JSON.stringify({
  supabaseUrl, publishableKey, kioskId, packageId, mode, printerName, port,
  credentialDpapi: await protect(credential),
}, null, 2));
console.log(`Saved ${CONFIG_FILE}. Start with: npm run agent`);
