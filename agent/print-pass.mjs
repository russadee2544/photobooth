// Authorized-print state machine (docs/REDEEM_NATIVE_BRIDGE.md). Dependencies are
// injected so the rules can be tested without Windows, a printer or the network.
import { createHash } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

function decodeDataUrl(dataUrl) {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  return bytes.length && bytes.length <= MAX_IMAGE_BYTES ? { ext: match[1] === 'jpeg' ? 'jpg' : 'png', bytes } : null;
}

export function createPrintService({ internal, journal, printImage, printerName = '' }) {
  // Report a result to the server; remember it for retry if the network fails.
  async function report(jobId, result) {
    let reply;
    try { reply = await internal.reportPrint(jobId, result); } catch { reply = { error: 'network_error' }; }
    if (reply?.error) {
      await journal.set(jobId, { unreported: result });
      return null;
    }
    if (result === 'completed' && reply.status !== 'completed') {
      await journal.set(jobId, { state: 'ambiguous', unreported: null });
      return null;
    }
    await journal.set(jobId, { unreported: null,
      ...(result === 'ambiguous' ? {} : { state: result, remaining: reply.remaining ?? null }) });
    return reply;
  }

  async function flushUnreported() {
    for (const [jobId, job] of journal.unreported()) await report(jobId, job.unreported);
  }

  async function printAuthorizedPass({ sessionToken, jobId, dataUrl, copies }) {
    if (!UUID.test(jobId || '') || !/^[0-9a-f]{64}$/.test(sessionToken || '')) return { status: 'failed', error: 'invalid_request' };
    const image = decodeDataUrl(dataUrl || '');
    if (!image) return { status: 'failed', error: 'invalid_image' };

    // The same jobId is never sent to the printer twice, whatever the page asks.
    const known = journal.get(jobId);
    if (known) {
      if (known.state === 'completed') {
        return { status: 'completed', remaining: known.remaining ?? null, copiesCompleted: known.copies };
      }
      if (known.state === 'failed') return { status: 'failed' };
      return { status: 'ambiguous' };
    }

    const start = await internal.startPrint(jobId, sessionToken).catch(() => ({ error: 'network_error' }));
    if (start?.error || start?.status !== 'printing') return { status: 'failed', error: start?.error || 'start_failed' };

    // Copies and asset come from the server's reservation, never from the browser.
    if (start.assetSha256 !== sha256Hex(dataUrl) || start.copies !== copies) {
      await journal.set(jobId, { state: 'failed', copies: start.copies });
      await report(jobId, 'failed');
      return { status: 'failed', error: 'asset_mismatch' };
    }

    // Persist BEFORE touching the printer so a crash cannot cause a re-send.
    await journal.set(jobId, { state: 'printing', copies: start.copies, sha: start.assetSha256 });
    try {
      await printImage({ ...image, printerName, copies: start.copies });
    } catch (error) {
      if (error?.notPrinted) {
        await journal.set(jobId, { state: 'failed' });
        await report(jobId, 'failed');
        return { status: 'failed', error: 'printer_unavailable' };
      }
      await journal.set(jobId, { state: 'ambiguous' });
      await report(jobId, 'ambiguous');
      return { status: 'ambiguous' };
    }

    const reply = await report(jobId, 'completed');
    if (!reply) {
      await journal.set(jobId, { state: 'ambiguous', unreported: 'completed' });
      return { status: 'ambiguous' };
    }
    await journal.set(jobId, { state: 'completed', remaining: reply.remaining ?? null });
    return { status: 'completed', remaining: reply.remaining ?? null, copiesCompleted: start.copies };
  }

  return { printAuthorizedPass, flushUnreported };
}
