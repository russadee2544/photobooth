import { beforeAll, describe, expect, it } from 'vitest';

type Engine = {
  GRAPHIC_SPECS: Record<string, { width: number; height: number; dpi?: number }>;
  createTemplate: (layoutId: string, type: string, overrides?: object) => any;
  createDefaultTemplates: () => any[];
  duplicateSlot: (template: any, photoIndex: number) => any;
  validateTemplate: (template: any) => { valid: boolean; errors: string[]; warnings: string[] };
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
  it('ships 2x6 strip and 4x6 postcard layouts at 300 DPI', () => {
    const templates = engine.createDefaultTemplates();
    expect(templates).toHaveLength(12);
    expect(templates.some((item) => item.canvas.width === 600 && item.canvas.height === 1800)).toBe(true);
    expect(templates.some((item) => item.canvas.width === 1200 && item.canvas.height === 1800)).toBe(true);
    expect(templates.some((item) => item.canvas.width === 1800 && item.canvas.height === 1200)).toBe(true);
    expect(templates.every((item) => item.canvas.dpi === 300)).toBe(true);
    expect(engine.GRAPHIC_SPECS.photoStripMultiUp).toMatchObject({ width: 1200, height: 1800, dpi: 300 });
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

  it('calculates center cover crops without stretching the source', () => {
    const crop = engine.getCoverCrop(1920, 1080, 500, 500, 0.5, 0.5);
    expect(crop.height).toBe(1080);
    expect(crop.width).toBe(1080);
    expect(crop.x).toBe(420);
  });
});
