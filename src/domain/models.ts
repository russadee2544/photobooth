export type BoothMode = 'event' | 'redeem';
export type BoothKind = 'receipt';
export type Locale = 'th' | 'en';
export type FilterId = 'color' | 'mono';

export interface ReceiptPackage {
  id: string;
  name: string;
  priceThb: number;
  copiesPerSet: 2;
}

export interface LayoutPreset {
  id: string;
  nameTh: string;
  nameEn: string;
  slots: 1 | 2 | 3 | 4;
  enabled: boolean;
}

export interface FramePreset {
  id: string;
  nameTh: string;
  nameEn: string;
  enabled: boolean;
  accent: string;
}

export interface KioskConfig {
  kioskId: string;
  kioskName: string;
  boothKind: BoothKind;
  mode: BoothMode;
  locale: Locale;
  package: ReceiptPackage;
  layouts: LayoutPreset[];
  frames: FramePreset[];
  idleTimeoutMs: number;
  idleWarningMs: number;
}

export interface RedeemClaim {
  claimId: string;
  codeHint: string;
  kioskId: string;
  packageId: string;
  claimedAt: string;
}

export interface CapturedPhoto {
  id: string;
  dataUrl: string;
  capturedAt: string;
}

export interface PrintJob {
  id: string;
  copiesRequested: 2;
  copiesCompleted: 0 | 1 | 2;
  status: 'queued' | 'printing' | 'completed' | 'ambiguous' | 'failed';
  error?: string;
}

export const DEFAULT_KIOSK_CONFIG: KioskConfig = {
  kioskId: 'local-kiosk',
  kioskName: 'MEMORIES 01',
  boothKind: 'receipt',
  mode: 'event',
  locale: 'th',
  package: {
    id: 'receipt-basic',
    name: 'Receipt Booth — 1 Set',
    priceThb: 10,
    copiesPerSet: 2,
  },
  layouts: [
    { id: 'single', nameTh: 'รูปเดี่ยว', nameEn: 'Single', slots: 1, enabled: true },
    { id: 'double', nameTh: 'สองรูป', nameEn: 'Double', slots: 2, enabled: true },
    { id: 'quad', nameTh: 'สี่รูป', nameEn: 'Four shots', slots: 4, enabled: true },
  ],
  frames: [
    { id: 'clean', nameTh: 'คลีน', nameEn: 'Clean', enabled: true, accent: '#f2efe8' },
    { id: 'midnight', nameTh: 'มิดไนต์', nameEn: 'Midnight', enabled: true, accent: '#171714' },
    { id: 'tomato', nameTh: 'โทเมโท', nameEn: 'Tomato', enabled: true, accent: '#e24a35' },
  ],
  idleTimeoutMs: 120_000,
  idleWarningMs: 30_000,
};
