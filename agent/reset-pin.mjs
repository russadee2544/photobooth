// Forgotten admin PIN: run on the kiosk's own Windows PC (via the "Reset admin PIN" shortcut).
// Reads this PC's DPAPI-protected device credential and asks the server to remove the kiosk's
// admin PIN; the next time Admin is opened the kiosk asks for a new one. Prints one JSON line.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_FILE } from './paths.mjs';
import { unprotect } from './dpapi.mjs';

const say = (result) => { console.log(JSON.stringify(result)); process.exit(result.ok ? 0 : 1); };

let config;
try { config = JSON.parse((await readFile(CONFIG_FILE, 'utf8')).replace(/^﻿/, '')); } catch { say({ ok: false, error: 'not_configured' }); }
if (!config?.kioskId || !config?.credentialDpapi) say({ ok: false, error: 'not_configured' });

let defaults = {};
try { defaults = JSON.parse(await readFile(join(import.meta.dirname, 'defaults.json'), 'utf8')); } catch { /* use config values */ }
const supabaseUrl = config.supabaseUrl || defaults.supabaseUrl;
const publishableKey = config.publishableKey || defaults.publishableKey;

let credential;
try { credential = await unprotect(config.credentialDpapi); } catch { say({ ok: false, error: 'credential_unreadable' }); }

try {
  const response = await fetch(`${supabaseUrl}/functions/v1/admin-pin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: publishableKey, 'x-kiosk-credential': credential },
    body: JSON.stringify({ operation: 'recover', kioskId: config.kioskId }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (response.ok && body.success) say({ ok: true });
  say({ ok: false, error: body.error || `http_${response.status}` });
} catch {
  say({ ok: false, error: 'network' });
}
