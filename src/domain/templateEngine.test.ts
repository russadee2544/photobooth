import { beforeAll, describe, expect, it } from 'vitest';

type Engine = {
  GRAPHIC_SPECS: Record<string, { width: number; height: number; dpi?: number }>;
  createTemplate: (layoutId: string, type: string, overrides?: object) => any;
  createDefaultTemplates: () => any[];
  duplicateSlot: (template: any, photoIndex: number) => any;
  normalizeTemplate: (template: any) => any;
  validateTemplate: (template: any) => { valid: boolean; errors: string[]; warnings: string[]; template: any };
  pxToMm: (px: number, dpi: number) => number;
  mmToPx: (mm: number, dpi: number) => number;
  getCoverCrop: (
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
    focusX?: number,
    focusY?: number,
  ) => { x: number; y: number; width: number; height: number };
};

let engine: Engine;

beforeAll(async () => {
  // The production engine is a browser global so every kiosk page and the
  // admin editor execute exactly the same offline-capable schema rules.
  // @ts-expect-error public browser script intentionally has no TS declarations
  await import('../../public/template-engine.js');
  engine = (globalThis as unknown as { PhotoTemplateEngine: Engine }).PhotoTemplateEngine;
});

describe('PhotoTemplateEngine', () => {
  it('ships 2x6 strip, 4x6 postcard, 5x7 card, and thermal presets', () => {
    const templates = engine.createDefaultTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(12);
    expect(templates.some((item) => item.canvas.width === 600 && item.canvas.dpi === 300)).toBe(true);
    expect(templates.some((item) => item.canvas.width === 1200 && item.canvas.height === 1800 && item.canvas.dpi === 300)).toBe(true);
    expect(templates.some((item) => item.canvas.width === 1800 && item.canvas.height === 1200 && item.canvas.dpi === 300)).toBe(true);
    expect(templates.some((item) => item.canvas.width === 576 && item.type === 'thermal80' && item.canvas.dpi === 203)).toBe(true);
    expect(templates.some((item) => item.canvas.width === 384 && item.type === 'thermal58' && item.canvas.dpi === 203)).toBe(true);
    expect(templates.some((item) => item.canvas.width === 832 && item.type === 'thermal100' && item.canvas.dpi === 203)).toBe(true);
    expect(templates.some((item) => item.canvas.width === 1500 && item.type === 'photo5x7')).toBe(true);
    expect(engine.GRAPHIC_SPECS.photoStripMultiUp).toMatchObject({ width: 1200, height: 1800, dpi: 300 });
    expect(engine.GRAPHIC_SPECS.thermal80).toMatchObject({ width: 576, height: 1728, dpi: 203 });
    expect(engine.GRAPHIC_SPECS.gifLandscape).toMatchObject({ width: 960, height: 720 });
    expect(engine.GRAPHIC_SPECS.videoPortrait).toMatchObject({ width: 1080, height: 1920 });
    expect(engine.GRAPHIC_SPECS.welcomeIpad129).toMatchObject({ width: 2732, height: 2048 });
  });

  it('uses schema slots as the capture requirement', () => {
    const template = engine.createTemplate('3_1x1', '2x6');
    expect(template.slots).toHaveLength(3);
    expect(template.slots.map((slot: any) => slot.index)).toEqual([1, 2, 3]);
  });

  it('duplicates a slot with a new photo index and layer', () => {
    const template = engine.createTemplate('2_1x1', '2x6');
    const duplicate = engine.duplicateSlot(template, 1);
    expect(duplicate.slots).toHaveLength(3);
    expect(duplicate.slots[2].index).toBe(3);
    expect(duplicate.slots[2].zIndex).toBeGreaterThan(template.slots[0].zIndex);
    expect(duplicate.layoutId).toBe(template.layoutId);
  });

  it('warns when a slot crosses the print safe zone', () => {
    const template = engine.createTemplate('1_1x1', '4x6-portrait');
    template.slots[0].x = 0;
    expect(engine.validateTemplate(template).warnings[0]).toContain('safe zone');
  });

  it('normalizes bleed margin (ตัดตก) to at least 3mm on the canvas', () => {
    const template = engine.createTemplate('3_1x1', '2x6');
    const bleed = template.canvas.bleedMargin;
    expect(bleed.top).toBeGreaterThanOrEqual(engine.mmToPx(3, template.canvas.dpi));
    expect(bleed.left).toBeGreaterThanOrEqual(engine.mmToPx(3, template.canvas.dpi));
    const mm = engine.pxToMm(bleed.top, template.canvas.dpi);
    expect(mm).toBeGreaterThanOrEqual(3);
  });

  it('warns when a slot crosses the bleed edge (ตัดตก)', () => {
    const template = engine.createTemplate('1_1x1', '4x6-portrait');
    template.canvas.bleedMargin.left = template.canvas.safeMargin.left + 50;
    template.slots[0].x = template.canvas.safeMargin.left + 10;
    expect(engine.validateTemplate(template).warnings.some((w) => w.includes('bleed'))).toBe(true);
  });

  it('round-trips backgroundImage (ลวดลาย) through normalization', () => {
    const template = engine.createTemplate('1_1x1', '2x6');
    template.canvas.backgroundImage = 'data:image/png;base64,AAAA';
    const normalized = engine.normalizeTemplate(template);
    expect(normalized.canvas.backgroundImage).toBe('data:image/png;base64,AAAA');
  });

  it('normalizes artboard frame layers with position, rotation, z-index and opacity', () => {
    const template = engine.createTemplate('1_1x1', '2x6');
    template.artboard = [
      { id: 'ab_1', name: 'Frame', url: 'data:image/png;base64,BBBB', placement: 'front', x: 10, y: 20, width: 300, height: 200, rotation: 45, zIndex: 2, opacity: 0.5, visible: true },
      { id: 'ab_2', name: 'Backdrop', url: 'data:image/png;base64,CCCC', placement: 'back', x: 50, y: 60, width: 100, height: 100, rotation: 0, zIndex: 1, opacity: 1, visible: false },
    ];
    const normalized = engine.normalizeTemplate(template);
    expect(normalized.artboard).toHaveLength(2);
    expect(normalized.artboard).toMatchObject([
      { id: 'ab_2', name: 'Backdrop', zIndex: 1, visible: false, placement: 'back' },
      { id: 'ab_1', name: 'Frame', zIndex: 2, rotation: 45, opacity: 0.5, visible: true, placement: 'front' },
    ]);
    expect(normalized.artboard[0].url).toBe('data:image/png;base64,CCCC');
    expect(normalized.artboard[1].width).toBe(300);
    expect(normalized.artboard[1].height).toBe(200);
  });

  it('clamps artboard layers and warns when one is outside the canvas', () => {
    const template = engine.createTemplate('1_1x1', '2x6');
    template.artboard = [{ id: 'ab_1', name: 'Off', url: 'data:image/png;base64,DDDD', x: -999, y: 99999, width: 99999, height: -50, rotation: 999, zIndex: 1, opacity: 5, visible: true }];
    const result = engine.validateTemplate(template);
    expect(result.warnings.some((w) => w.includes('Artboard layer'))).toBe(true);
    expect(result.template.artboard[0].opacity).toBe(1);
    expect(result.template.artboard[0].rotation).toBe(180);
    expect(result.template.artboard[0].width).toBeGreaterThan(0);
  });

  it('ships an empty artboard by default', () => {
    const template = engine.createTemplate('3_1x1', '2x6');
    expect(template.artboard).toEqual([]);
  });

  it('supports 1, 2, 3 photos vertical strip, 4_1x1 in 2:2 grid, and 4_16x9 in single vertical strip', () => {
    const t1 = engine.createTemplate('1_1x1', 'thermal80');
    const t2 = engine.createTemplate('2_1x1', 'thermal80');
    const t3 = engine.createTemplate('3_1x1', 'thermal80');
    const t4_3x4 = engine.createTemplate('4_1x1', 'thermal80');
    const t4_16x9 = engine.createTemplate('4_16x9', 'thermal80');

    // 1, 2, 3 photos expand to full available width in single vertical column
    [t1, t2, t3].forEach((t) => {
      t.slots.forEach((slot: any) => {
        expect(slot.width).toBe(t.canvas.width - t.canvas.safeMargin.left - t.canvas.safeMargin.right);
        const ratio = slot.width / slot.height;
        expect(ratio).toBeCloseTo(3 / 4, 1);
      });
      for (let i = 1; i < t.slots.length; i++) {
        expect(t.slots[i].x).toBe(t.slots[0].x);
        expect(t.slots[i].y).toBeGreaterThan(t.slots[i - 1].y);
      }
    });

    // 4_1x1 (Left card): 2:2 grid with 3:4 ratio
    expect(t4_3x4.slots).toHaveLength(4);
    expect(t4_3x4.slots[0].x).toBe(t4_3x4.slots[2].x); // Col 1
    expect(t4_3x4.slots[1].x).toBe(t4_3x4.slots[3].x); // Col 2
    expect(t4_3x4.slots[0].y).toBe(t4_3x4.slots[1].y); // Row 1
    expect(t4_3x4.slots[2].y).toBe(t4_3x4.slots[3].y); // Row 2
    t4_3x4.slots.forEach((slot: any) => {
      const ratio = slot.width / slot.height;
      expect(ratio).toBeCloseTo(3 / 4, 1);
    });

    // 4_16x9 (Right card): single vertical column with 16:9 ratio
    expect(t4_16x9.slots).toHaveLength(4);
    for (let i = 1; i < t4_16x9.slots.length; i++) {
      expect(t4_16x9.slots[i].x).toBe(t4_16x9.slots[0].x);
      expect(t4_16x9.slots[i].y).toBeGreaterThan(t4_16x9.slots[i - 1].y);
    }
    t4_16x9.slots.forEach((slot: any) => {
      const ratio = slot.width / slot.height;
      expect(ratio).toBeCloseTo(16 / 9, 1);
    });
  });

  it('calculates center cover crops without stretching the source', () => {
    const crop = engine.getCoverCrop(1920, 1080, 500, 500, 0.5, 0.5);
    expect(crop.height).toBe(1080);
    expect(crop.width).toBe(1080);
    expect(crop.x).toBe(420);
  });
});
