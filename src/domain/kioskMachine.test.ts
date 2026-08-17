import { describe, expect, it } from 'vitest';
import { DEFAULT_KIOSK_CONFIG, type CapturedPhoto, type PrintJob } from './models';
import { INITIAL_KIOSK_STATE, kioskReducer } from './kioskMachine';

const photo = (id: string): CapturedPhoto => ({
  id,
  dataUrl: `data:image/jpeg;base64,${id}`,
  capturedAt: '2026-08-11T00:00:00.000Z',
});

describe('kioskReducer', () => {
  it('starts event mode at layout selection', () => {
    const state = kioskReducer(INITIAL_KIOSK_STATE, {
      type: 'START',
      config: DEFAULT_KIOSK_CONFIG,
    });
    expect(state.step).toBe('layout');
  });

  it('requires a redeem claim before layout in redeem mode', () => {
    const config = { ...DEFAULT_KIOSK_CONFIG, mode: 'redeem' as const };
    const redeem = kioskReducer(INITIAL_KIOSK_STATE, { type: 'START', config });
    expect(redeem.step).toBe('redeem');

    const layoutAttempt = kioskReducer(redeem, {
      type: 'SELECT_LAYOUT',
      layout: config.layouts[0],
    });
    expect(layoutAttempt).toBe(redeem);
  });

  it('moves to customization only after all layout shots are captured', () => {
    const layout = DEFAULT_KIOSK_CONFIG.layouts[1];
    let state = kioskReducer(INITIAL_KIOSK_STATE, {
      type: 'START',
      config: DEFAULT_KIOSK_CONFIG,
    });
    state = kioskReducer(state, { type: 'SELECT_LAYOUT', layout });
    state = kioskReducer(state, { type: 'ADD_PHOTO', photo: photo('one') });
    expect(state.step).toBe('capture');
    state = kioskReducer(state, { type: 'ADD_PHOTO', photo: photo('two') });
    expect(state.step).toBe('customize');
  });

  it('allows unlimited full retakes before print confirmation', () => {
    const layout = DEFAULT_KIOSK_CONFIG.layouts[0];
    let state = kioskReducer(INITIAL_KIOSK_STATE, {
      type: 'START',
      config: DEFAULT_KIOSK_CONFIG,
    });
    state = kioskReducer(state, { type: 'SELECT_LAYOUT', layout });
    state = kioskReducer(state, { type: 'ADD_PHOTO', photo: photo('one') });

    for (let round = 0; round < 20; round += 1) {
      state = kioskReducer(state, { type: 'RETAKE_ALL' });
      expect(state.step).toBe('capture');
      state = kioskReducer(state, { type: 'ADD_PHOTO', photo: photo(String(round)) });
      expect(state.step).toBe('customize');
    }
  });

  it('tracks exactly two print copies per set', () => {
    const job: PrintJob = {
      id: 'job-1',
      copiesRequested: 2,
      copiesCompleted: 0,
      status: 'queued',
    };
    const ready = {
      ...INITIAL_KIOSK_STATE,
      step: 'review' as const,
      layout: DEFAULT_KIOSK_CONFIG.layouts[0],
      frame: DEFAULT_KIOSK_CONFIG.frames[0],
      photos: [photo('one')],
    };
    let state = kioskReducer(ready, { type: 'CONFIRM_PRINT', job });
    state = kioskReducer(state, { type: 'PRINT_PROGRESS', copiesCompleted: 1 });
    expect(state.printJob?.copiesCompleted).toBe(1);
    state = kioskReducer(state, { type: 'PRINT_COMPLETED' });
    expect(state.step).toBe('complete');
    expect(state.printJob?.copiesCompleted).toBe(2);
  });
});
