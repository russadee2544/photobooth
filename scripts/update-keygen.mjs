#!/usr/bin/env node
// One-time: creates the key pair that signs kiosk updates.
//   private key -> ~/.photobooth/update-signing-key.pem   (stays on the publisher's machine; BACK IT UP)
//   public key  -> agent/update-public-key.pem            (committed; every kiosk uses it to verify updates)
// Losing the private key means installed kiosks can no longer accept updates (reinstall needed);
// leaking it lets anyone push code to every kiosk. Treat it like a password.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const privatePath = join(homedir(), '.photobooth', 'update-signing-key.pem');
const publicPath = join(import.meta.dirname, '..', 'agent', 'update-public-key.pem');

if (existsSync(privatePath) || existsSync(publicPath)) {
  console.error('A signing key already exists. Delete both files first if you really want to replace it:');
  console.error(`  ${privatePath}\n  ${publicPath}\n(Replacing it requires reinstalling every kiosk.)`);
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
mkdirSync(join(homedir(), '.photobooth'), { recursive: true });
writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }));
console.log(`Private key: ${privatePath}  (back this file up somewhere safe, never commit it)`);
console.log(`Public key:  ${publicPath}  (commit this)`);
