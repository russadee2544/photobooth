import type { LayoutPreset, Slot, LogoArea } from '../types';

/**
 * 576 dots is the standard thermal 80mm printer width.
 */
const PRINTER_WIDTH = 576;
const MIN_MARGIN = 10;

export const LAYOUT_PRESETS: Record<string, LayoutPreset> = {
  classic_3: {
    id: 'classic_3',
    name: { en: 'Classic 3', th: 'คลาสสิก 3' },
    canvasSize: { width: PRINTER_WIDTH, height: 1200 },
    slots: [
      { id: 'slot1', x: MIN_MARGIN, y: MIN_MARGIN, width: 556, height: 417, aspect: 4 / 3, rotation: 0 },
      { id: 'slot2', x: MIN_MARGIN, y: 437, width: 556, height: 417, aspect: 4 / 3, rotation: 0 },
      { id: 'slot3', x: MIN_MARGIN, y: 864, width: 556, height: 417, aspect: 4 / 3, rotation: 0 },
    ],
    logoArea: { x: MIN_MARGIN, y: 1291, width: 556, height: 100 },
    backgroundColor: '#ffffff'
  },
  classic_4: {
    id: 'classic_4',
    name: { en: 'Classic 4', th: 'คลาสสิก 4' },
    canvasSize: { width: PRINTER_WIDTH, height: 1400 },
    slots: [
      { id: 'slot1', x: MIN_MARGIN, y: MIN_MARGIN, width: 556, height: 320, aspect: 4 / 3, rotation: 0 },
      { id: 'slot2', x: MIN_MARGIN, y: 340, width: 556, height: 320, aspect: 4 / 3, rotation: 0 },
      { id: 'slot3', x: MIN_MARGIN, y: 670, width: 556, height: 320, aspect: 4 / 3, rotation: 0 },
      { id: 'slot4', x: MIN_MARGIN, y: 1000, width: 556, height: 320, aspect: 4 / 3, rotation: 0 },
    ],
    logoArea: { x: MIN_MARGIN, y: 1330, width: 556, height: 60 },
    backgroundColor: '#ffffff'
  },
  duo: {
    id: 'duo',
    name: { en: 'Duo', th: 'คู่' },
    canvasSize: { width: PRINTER_WIDTH, height: 900 },
    slots: [
      { id: 'slot1', x: MIN_MARGIN, y: MIN_MARGIN, width: 556, height: 417, aspect: 4 / 3, rotation: 0 },
      { id: 'slot2', x: MIN_MARGIN, y: 437, width: 556, height: 417, aspect: 4 / 3, rotation: 0 },
    ],
    logoArea: { x: MIN_MARGIN, y: 864, width: 556, height: 26 },
    backgroundColor: '#ffffff'
  },
  portrait: {
    id: 'portrait',
    name: { en: 'Portrait', th: 'แนวตั้ง' },
    canvasSize: { width: PRINTER_WIDTH, height: 900 },
    slots: [
      { id: 'slot1', x: MIN_MARGIN, y: MIN_MARGIN, width: 556, height: 741, aspect: 3 / 4, rotation: 0 },
    ],
    logoArea: { x: MIN_MARGIN, y: 761, width: 556, height: 129 },
    backgroundColor: '#ffffff'
  },
  grid_4: {
    id: 'grid_4',
    name: { en: 'Grid 4', th: 'กริด 4' },
    canvasSize: { width: PRINTER_WIDTH, height: 900 },
    slots: [
      { id: 'slot1', x: MIN_MARGIN, y: MIN_MARGIN, width: 273, height: 273, aspect: 1, rotation: 0 },
      { id: 'slot2', x: 293, y: MIN_MARGIN, width: 273, height: 273, aspect: 1, rotation: 0 },
      { id: 'slot3', x: MIN_MARGIN, y: 293, width: 273, height: 273, aspect: 1, rotation: 0 },
      { id: 'slot4', x: 293, y: 293, width: 273, height: 273, aspect: 1, rotation: 0 },
    ],
    logoArea: { x: MIN_MARGIN, y: 576, width: 556, height: 314 },
    backgroundColor: '#ffffff'
  }
};

/**
 * Helper to get a layout preset by ID
 */
export function getLayoutPreset(id: string): LayoutPreset | undefined {
  return LAYOUT_PRESETS[id];
}
