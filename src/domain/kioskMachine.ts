import type {
  CapturedPhoto,
  FilterId,
  FramePreset,
  KioskConfig,
  LayoutPreset,
  PrintJob,
  RedeemClaim,
} from './models';

export type KioskStep =
  | 'attract'
  | 'redeem'
  | 'layout'
  | 'capture'
  | 'customize'
  | 'review'
  | 'printing'
  | 'complete';

export interface KioskState {
  step: KioskStep;
  claim: RedeemClaim | null;
  layout: LayoutPreset | null;
  photos: CapturedPhoto[];
  frame: FramePreset | null;
  filter: FilterId;
  printJob: PrintJob | null;
}

export type KioskEvent =
  | { type: 'START'; config: KioskConfig }
  | { type: 'CODE_ACCEPTED'; claim: RedeemClaim }
  | { type: 'SELECT_LAYOUT'; layout: LayoutPreset }
  | { type: 'ADD_PHOTO'; photo: CapturedPhoto }
  | { type: 'RETAKE_ALL' }
  | { type: 'SELECT_FRAME'; frame: FramePreset }
  | { type: 'SELECT_FILTER'; filter: FilterId }
  | { type: 'REVIEW' }
  | { type: 'CONFIRM_PRINT'; job: PrintJob }
  | { type: 'PRINT_PROGRESS'; copiesCompleted: 0 | 1 | 2 }
  | { type: 'PRINT_COMPLETED' }
  | { type: 'PRINT_FAILED'; error: string; ambiguous: boolean }
  | { type: 'RESET' };

export const INITIAL_KIOSK_STATE: KioskState = {
  step: 'attract',
  claim: null,
  layout: null,
  photos: [],
  frame: null,
  filter: 'mono',
  printJob: null,
};

export function kioskReducer(state: KioskState, event: KioskEvent): KioskState {
  switch (event.type) {
    case 'START':
      if (state.step !== 'attract') return state;
      return {
        ...INITIAL_KIOSK_STATE,
        step: event.config.mode === 'redeem' ? 'redeem' : 'layout',
      };

    case 'CODE_ACCEPTED':
      if (state.step !== 'redeem') return state;
      return { ...state, claim: event.claim, step: 'layout' };

    case 'SELECT_LAYOUT':
      if (state.step !== 'layout' || !event.layout.enabled) return state;
      return { ...state, layout: event.layout, photos: [], step: 'capture' };

    case 'ADD_PHOTO': {
      if (state.step !== 'capture' || !state.layout) return state;
      if (state.photos.length >= state.layout.slots) return state;
      const photos = [...state.photos, event.photo];
      return {
        ...state,
        photos,
        step: photos.length === state.layout.slots ? 'customize' : 'capture',
      };
    }

    case 'RETAKE_ALL':
      if (!['customize', 'review'].includes(state.step) || !state.layout) return state;
      return { ...state, photos: [], frame: null, step: 'capture' };

    case 'SELECT_FRAME':
      if (state.step !== 'customize' || !event.frame.enabled) return state;
      return { ...state, frame: event.frame };

    case 'SELECT_FILTER':
      if (state.step !== 'customize') return state;
      return { ...state, filter: event.filter };

    case 'REVIEW':
      if (state.step !== 'customize' || !state.frame) return state;
      return { ...state, step: 'review' };

    case 'CONFIRM_PRINT':
      if (state.step !== 'review') return state;
      return { ...state, printJob: event.job, step: 'printing' };

    case 'PRINT_PROGRESS':
      if (state.step !== 'printing' || !state.printJob) return state;
      return {
        ...state,
        printJob: { ...state.printJob, status: 'printing', copiesCompleted: event.copiesCompleted },
      };

    case 'PRINT_COMPLETED':
      if (state.step !== 'printing' || !state.printJob) return state;
      return {
        ...state,
        step: 'complete',
        printJob: { ...state.printJob, status: 'completed', copiesCompleted: 2 },
      };

    case 'PRINT_FAILED':
      if (state.step !== 'printing' || !state.printJob) return state;
      return {
        ...state,
        printJob: {
          ...state.printJob,
          status: event.ambiguous ? 'ambiguous' : 'failed',
          error: event.error,
        },
      };

    case 'RESET':
      return INITIAL_KIOSK_STATE;
  }
}
