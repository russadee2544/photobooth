#!/usr/bin/env node
// Creates an active redeem-mode kiosk (or rotates the credential of an existing one)
// on the linked Supabase project and prints the one-time device credential.
//
//   node scripts/create-kiosk.mjs --name "Booth 1"
//   node scripts/create-kiosk.mjs --kiosk-id <uuid>          # rotate credential
//   node scripts/create-kiosk.mjs --name "Booth 2" --workspace <uuid>
//
// Requires `npx supabase link` first. The credential is printed once to this
// terminal only; store it in the kiosk's native secure storage, never in git.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME = /^[A-Za-z0-9ก-๙ ._-]{1,120}$/;

const args = process.argv.slice(2);
const opt = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const name = opt('--name');
const kioskIdArg = opt('--kiosk-id');
const workspaceArg = opt('--workspace');

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}
if (!kioskIdArg && !name) fail('pass --name "<kiosk name>" to create, or --kiosk-id <uuid> to rotate');
if (kioskIdArg && !UUID.test(kioskIdArg)) fail('--kiosk-id must be a UUID');
if (workspaceArg && !UUID.test(workspaceArg)) fail('--workspace must be a UUID');
if (name && !NAME.test(name)) fail('--name may contain letters, digits, Thai, space . _ - (max 120)');

const dir = mkdtempSync(join(tmpdir(), 'pb-kiosk-'));
function query(sql) {
  const file = join(dir, 'q.sql');
  writeFileSync(file, sql);
  const out = execFileSync('npx', ['supabase', 'db', 'query', '--linked', '-f', file],
    { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'inherit'] });
  const json = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
  return JSON.parse(json).rows ?? [];
}

try {
  let kioskId = kioskIdArg;
  if (!kioskId) {
    let workspaceId = workspaceArg;
    if (!workspaceId) {
      const rows = query('select id from public.workspaces order by created_at limit 2;');
      if (rows.length !== 1) fail('expected exactly one workspace; pass --workspace <uuid>');
      workspaceId = rows[0].id;
    }
    const created = query(
      `insert into public.kiosks (workspace_id, name, booth_kind, operating_mode, status)
       values ('${workspaceId}', '${name}', 'receipt', 'redeem', 'active') returning id;`);
    kioskId = created[0]?.id;
    if (!kioskId) fail('kiosk was not created');
    console.log(`kiosk created: ${kioskId}`);
  }
  const [row] = query(`select * from public.provision_kiosk_device('${kioskId}');`);
  if (!row?.credential_token) fail('no credential returned (is the kiosk revoked?)');
  console.log('\nKIOSK_ID=' + row.kiosk_id);
  console.log('DEVICE_CREDENTIAL=' + row.credential_token);
  console.log('\nShown once. Put it in the kiosk native secure storage; rotating it invalidates the old one.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
