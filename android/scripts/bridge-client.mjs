// Builds the script the Android app injects into every kiosk page. It is the Windows agent's
// own client (bridge/core.mjs clientScript) behind the fetch shim (android/web/bridge-shim.js),
// so both kiosk programs give the pages exactly the same window.PhotoboothDevice/PhotoboothPrinter.
// Per-kiosk values are filled in by the app at run time (BridgeScript.kt) in place of PLACEHOLDERS.
import { readFileSync } from 'node:fs';
import { clientScript } from '../../bridge/core.mjs';

export const PLACEHOLDERS = {
  kioskId: '@@PB_KIOSK_ID@@',
  packageId: '@@PB_PACKAGE_ID@@',
  mode: '@@PB_MODE@@',
  groups: '@@PB_GROUPS@@',
};

export function bridgeShim() {
  return readFileSync(new URL('../web/bridge-shim.js', import.meta.url), 'utf8');
}

// The kiosk-page client with JSON-quoted placeholders ("@@PB_KIOSK_ID@@", ...).
export function bridgeClientTemplate() {
  return clientScript({
    endpoint: '/__bridge/call',
    kioskId: PLACEHOLDERS.kioskId,
    packageId: PLACEHOLDERS.packageId,
    mode: PLACEHOLDERS.mode,
    groups: PLACEHOLDERS.groups,
    header: 'x-pb-bridge',
    // No self-update channel on Android yet (a new version is a new APK), so no version polling.
    statusEndpoint: '',
    reportStatus: true,
  });
}

// What BridgeScript.kt does at run time, for tests.
export function fillBridgeClient(template, { kioskId, packageId, mode, groups }) {
  return template
    .replace(JSON.stringify(PLACEHOLDERS.kioskId), () => JSON.stringify(kioskId))
    .replace(JSON.stringify(PLACEHOLDERS.packageId), () => JSON.stringify(packageId))
    .replace(JSON.stringify(PLACEHOLDERS.mode), () => JSON.stringify(mode))
    .replace(JSON.stringify(PLACEHOLDERS.groups), () => JSON.stringify(groups));
}
