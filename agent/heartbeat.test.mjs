import { describe, expect, it, vi } from 'vitest';
import { createHeartbeat } from './heartbeat.mjs';
import { mapPrinterHealth } from './printer-win.mjs';

describe('heartbeat', () => {
  it('sends the snapshot and reports success', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const hb = createHeartbeat({ send, snapshot: async () => ({ version: 'v1' }) });
    expect(await hb.beat()).toBe(true);
    expect(send).toHaveBeenCalledWith({ version: 'v1' });
  });

  it('survives a server error or a thrown network error and retries on the next beat', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ error: 'device_unauthorized' })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ ok: true });
    const log = vi.fn();
    const hb = createHeartbeat({ send, snapshot: async () => ({}), log });
    expect(await hb.beat()).toBe(false);
    expect(await hb.beat()).toBe(false);
    expect(await hb.beat()).toBe(true);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('never runs two beats at once', async () => {
    let release;
    const send = vi.fn(() => new Promise((resolve) => { release = () => resolve({ ok: true }); }));
    const hb = createHeartbeat({ send, snapshot: async () => ({}) });
    const first = hb.beat();
    await new Promise((r) => setTimeout(r, 5));
    expect(await hb.beat()).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('printer health mapping', () => {
  it('maps Windows printer states', () => {
    expect(mapPrinterHealth(null)).toMatchObject({ state: 'unknown', detail: 'printer_not_found' });
    expect(mapPrinterHealth({ WorkOffline: true })).toMatchObject({ state: 'offline' });
    expect(mapPrinterHealth({ PrinterStatus: 7 })).toMatchObject({ state: 'offline' });
    expect(mapPrinterHealth({ DetectedErrorState: 4 })).toMatchObject({ state: 'error', detail: 'no_paper' });
    expect(mapPrinterHealth({ DetectedErrorState: 9 })).toMatchObject({ state: 'error', detail: 'paper_jam' });
    expect(mapPrinterHealth({ DetectedErrorState: 3, PrinterStatus: 3 })).toMatchObject({ state: 'ready', detail: 'low_paper' });
    expect(mapPrinterHealth({ PrinterStatus: 4 })).toMatchObject({ state: 'busy' });
    expect(mapPrinterHealth({ PrinterStatus: 3, DetectedErrorState: 2 })).toMatchObject({ state: 'ready', detail: '' });
  });
});
