import { DEFAULT_KIOSK_CONFIG, type KioskConfig } from './domain/models';

const CONFIG_KEY = 'pb_kiosk_config_v1';

export function loadKioskConfig(): KioskConfig {
  try {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (!stored) return DEFAULT_KIOSK_CONFIG;
    const value = JSON.parse(stored) as Partial<KioskConfig>;
    if (
      typeof value.kioskId !== 'string' ||
      (value.mode !== 'event' && value.mode !== 'redeem') ||
      value.boothKind !== 'receipt' ||
      !Array.isArray(value.layouts) ||
      !Array.isArray(value.frames)
    ) {
      return DEFAULT_KIOSK_CONFIG;
    }
    return { ...DEFAULT_KIOSK_CONFIG, ...value } as KioskConfig;
  } catch {
    return DEFAULT_KIOSK_CONFIG;
  }
}

export function saveKioskConfig(config: KioskConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}
