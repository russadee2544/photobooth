import { describe, expect, it, vi } from 'vitest';
import { createPrintService, sha256Hex } from './print-pass.mjs';

const JOB = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'a'.repeat(64);
const DATA_URL = `data:image/png;base64,${Buffer.from('fake-png').toString('base64')}`;

function memoryJournal() {
  const jobs = {};
  return {
    get: (id) => jobs[id],
    set: async (id, patch) => { jobs[id] = { ...jobs[id], ...patch }; return jobs[id]; },
    unreported: () => Object.entries(jobs).filter(([, j]) => j.unreported),
    jobs,
  };
}

function setup(overrides = {}) {
  const journal = memoryJournal();
  const internal = {
    startPrint: vi.fn(async () => ({ jobId: JOB, status: 'printing', copies: 2, assetSha256: sha256Hex(DATA_URL) })),
    reportPrint: vi.fn(async (_id, result) => ({ jobId: JOB, status: result, remaining: 3 })),
    ...overrides.internal,
  };
  const printImage = overrides.printImage || vi.fn(async () => ({ spooled: true, printer: 'P' }));
  const service = createPrintService({ internal, journal, printImage });
  return { service, journal, internal, printImage };
}
const args = { sessionToken: TOKEN, jobId: JOB, dataUrl: DATA_URL, copies: 2 };

describe('printAuthorizedPass', () => {
  it('prints once and reports completed with the server remaining count', async () => {
    const { service, internal, printImage } = setup();
    expect(await service.printAuthorizedPass(args)).toEqual({ status: 'completed', remaining: 3, copiesCompleted: 2 });
    expect(printImage).toHaveBeenCalledTimes(1);
    expect(internal.reportPrint).toHaveBeenCalledWith(JOB, 'completed');
  });

  it('never re-sends a job it already printed', async () => {
    const { service, printImage, internal } = setup();
    await service.printAuthorizedPass(args);
    const again = await service.printAuthorizedPass(args);
    expect(again.status).toBe('completed');
    expect(printImage).toHaveBeenCalledTimes(1);
    expect(internal.startPrint).toHaveBeenCalledTimes(1);
  });

  it('rejects an image that differs from the reserved asset and reports failed without printing', async () => {
    const { service, internal, printImage } = setup({
      internal: { startPrint: vi.fn(async () => ({ status: 'printing', copies: 2, assetSha256: 'f'.repeat(64) })) },
    });
    expect((await service.printAuthorizedPass(args)).status).toBe('failed');
    expect(printImage).not.toHaveBeenCalled();
    expect(internal.reportPrint).toHaveBeenCalledWith(JOB, 'failed');
  });

  it('uses the server copy count, not the browser value', async () => {
    const { service, printImage } = setup();
    expect((await service.printAuthorizedPass({ ...args, copies: 9 })).status).toBe('failed');
    expect(printImage).not.toHaveBeenCalled();
  });

  it('reports failed only when nothing could have been printed', async () => {
    const err = Object.assign(new Error('printer_unavailable'), { notPrinted: true });
    const { service, internal } = setup({ printImage: vi.fn(async () => { throw err; }) });
    expect((await service.printAuthorizedPass(args)).status).toBe('failed');
    expect(internal.reportPrint).toHaveBeenCalledWith(JOB, 'failed');
  });

  it('reports ambiguous on an unconfirmed print and does not resend on retry', async () => {
    const printImage = vi.fn(async () => { throw new Error('print_unconfirmed'); });
    const { service, internal } = setup({ printImage });
    expect((await service.printAuthorizedPass(args)).status).toBe('ambiguous');
    expect(internal.reportPrint).toHaveBeenCalledWith(JOB, 'ambiguous');
    expect((await service.printAuthorizedPass(args)).status).toBe('ambiguous');
    expect(printImage).toHaveBeenCalledTimes(1);
  });

  it('keeps the result for retry when the report cannot reach the server', async () => {
    const reportPrint = vi.fn()
      .mockResolvedValueOnce({ error: 'network_error' })
      .mockResolvedValue({ jobId: JOB, status: 'completed', remaining: 1 });
    const { service, journal } = setup({ internal: { reportPrint } });
    expect((await service.printAuthorizedPass(args)).status).toBe('ambiguous');
    expect(journal.jobs[JOB].unreported).toBe('completed');
    await service.flushUnreported();
    expect(journal.jobs[JOB]).toMatchObject({ state: 'completed', remaining: 1, unreported: null });
  });

  it('does not print when start is refused', async () => {
    const { service, printImage } = setup({ internal: { startPrint: vi.fn(async () => ({ error: 'print_not_authorized' })) } });
    expect((await service.printAuthorizedPass(args)).status).toBe('failed');
    expect(printImage).not.toHaveBeenCalled();
  });

  it('rejects non-image data URLs', async () => {
    const { service } = setup();
    expect((await service.printAuthorizedPass({ ...args, dataUrl: 'data:text/html;base64,AAAA' })).status).toBe('failed');
  });
});
