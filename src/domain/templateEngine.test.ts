import { beforeAll, describe, expect, it } from 'vitest';

type Engine = {
  GRAPHIC_SPECS: Record<string, { width: number; height: number; dpi?: number }>;
  createTemplate: (layoutId: string, type: string, overrides?: object) => any;
  createDefaultTemplates: () => any[];
  isTemplateCompatibleWithPaperMode: (template: any, paperMode: string) => boolean;
  generateCustomTemplate: (config?: any) => any;
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
  extractUniversalTheme: (template: any, name?: string) => any;
  applyUniversalTheme: (universalTheme: any, targetTemplate: any) => any;
  applyUniversalThemeWithReport: (universalTheme: any, targetTemplate: any) => { template: any; warnings: { code: string; elementId?: string }[]; bucket: string };
  migrateUniversalTheme: (theme: any) => any;
  computeThemeRegions: (template: any) => any;
  getRatioBucket: (width: number, height: number) => string;
  normalizeSlice: (source: any) => any;
  nineSlicePatches: (iw: number, ih: number, slice: any, bw: number, bh: number) => { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number }[];
  resolveTextVariables: (text: string, values: Record<string, string>) => string;
  layoutText: (text: string, measure: (value: string, size: number) => number, box: any) => { fontSize: number; lines: string[]; lineHeight: number };
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

  it('keeps receipt and photobooth layouts in separate paper modes', () => {
    const strip = engine.createTemplate('3_1x1', '2x6');
    const postcard = engine.createTemplate('4_3x4', '4x6-portrait');
    const receipt58 = engine.createTemplate('3_1x1', 'thermal58');
    const receipt80 = engine.createTemplate('3_1x1', 'thermal80');

    expect(engine.isTemplateCompatibleWithPaperMode(strip, 'photo4x6_dual')).toBe(true);
    expect(engine.isTemplateCompatibleWithPaperMode(strip, 'photo2x6_single')).toBe(true);
    expect(engine.isTemplateCompatibleWithPaperMode(strip, 'thermal80')).toBe(false);
    expect(engine.isTemplateCompatibleWithPaperMode(strip, 'photo4x6_postcard')).toBe(false);

    expect(engine.isTemplateCompatibleWithPaperMode(postcard, 'photo4x6_postcard')).toBe(true);
    expect(engine.isTemplateCompatibleWithPaperMode(postcard, 'photo4x6_dual')).toBe(false);
    expect(engine.isTemplateCompatibleWithPaperMode(postcard, 'thermal80')).toBe(false);

    expect(engine.isTemplateCompatibleWithPaperMode(receipt58, 'thermal58')).toBe(true);
    expect(engine.isTemplateCompatibleWithPaperMode(receipt58, 'thermal80')).toBe(false);
    expect(engine.isTemplateCompatibleWithPaperMode(receipt80, 'thermal80')).toBe(true);
    expect(engine.isTemplateCompatibleWithPaperMode(receipt80, 'photo4x6_dual')).toBe(false);
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

  it('generates custom canvas templates with specified paper, photo counts and styles', () => {
    const custom1 = engine.generateCustomTemplate({
      paperPreset: '2x6',
      photoCount: 4,
      aspectRatio: '1x1',
      layoutStyle: 'strip',
      name: 'Custom 4-Grid Strip'
    });
    expect(custom1.slots).toHaveLength(4);
    expect(custom1.canvas.width).toBe(600);
    expect(custom1.canvas.height).toBe(1800);
    expect(custom1.printSettings.printTwoPerPage).toBe(true);

    const custom2 = engine.generateCustomTemplate({
      paperPreset: '4x6-portrait',
      photoCount: 6,
      aspectRatio: '3x4',
      layoutStyle: 'grid2',
      name: 'Postcard 6 Grid'
    });
    expect(custom2.slots).toHaveLength(6);
    expect(custom2.canvas.width).toBe(1200);
    expect(custom2.canvas.height).toBe(1800);
    expect(custom2.printSettings.paperSize).toBe('4x6');

    const custom3 = engine.generateCustomTemplate({
      paperPreset: 'custom',
      width: 1500,
      height: 2000,
      dpi: 300,
      photoCount: 3,
      aspectRatio: '3x4',
      layoutStyle: 'featured_top'
    });
    expect(custom3.slots).toHaveLength(3);
    expect(custom3.canvas.width).toBe(1500);
    expect(custom3.canvas.height).toBe(2000);
    expect(custom3.slots[0].width).toBeGreaterThan(custom3.slots[1].width);
  });

  it('extracts a UniversalTheme with relative coordinates and style properties', () => {
    const template = engine.createTemplate('3_1x1', '2x6');
    template.canvas.backgroundColor = '#FFFAF0';
    template.canvas.backgroundImage = 'data:image/png;base64,BG123';
    template.canvas.backgroundFitMode = 'contain';
    template.overlay = { url: 'data:image/png;base64,OV456', zIndex: 100, fitMode: 'cover' };
    template.artboard = [
      { id: 'ab_top', name: 'Logo', url: 'data:image/png;base64,LOGO', placement: 'front', x: 60, y: 18, width: 240, height: 120, rotation: 0, zIndex: 5, opacity: 0.9, visible: true }
    ];

    const uTheme = engine.extractUniversalTheme(template, 'Vintage Warm');
    expect(uTheme.themeId).toMatch(/^utheme_/);
    expect(uTheme.name).toBe('Vintage Warm');
    expect(uTheme.style.backgroundColor).toBe('#FFFAF0');
    expect(uTheme.style.backgroundImage).toBe('data:image/png;base64,BG123');
    expect(uTheme.style.backgroundFitMode).toBe('contain');
    expect(uTheme.style.overlay.url).toBe('data:image/png;base64,OV456');
    expect(uTheme.schemaVersion).toBe(2);
    expect(uTheme.sourceCanvas.bucket).toBe('strip');
    expect(uTheme.style.overlay.buckets).toEqual(['strip']);
    expect(uTheme.style.elements).toHaveLength(1);

    // The logo sits above the photos, so it is anchored to the header and
    // sized from the paper's short side (240 / 600 = 0.4).
    const logo = uTheme.style.elements[0];
    expect(logo.anchor.to).toBe('header');
    expect(logo.size.mode).toBe('short-side');
    expect(logo.size.value).toBeCloseTo(0.4, 3);
    expect(logo.aspectRatio).toBeCloseTo(2.0, 2);
  });

  it('applies a UniversalTheme to different canvas formats (2x6 -> 4x6 & thermal)', () => {
    const sourceTemplate = engine.createTemplate('3_1x1', '2x6');
    sourceTemplate.canvas.backgroundColor = '#E6F0FA';
    sourceTemplate.artboard = [
      { id: 'ab_1', name: 'Sticker', url: 'data:image/png;base64,STICKER', placement: 'front', x: 60, y: 36, width: 300, height: 150, rotation: 10, zIndex: 2, opacity: 1, visible: true }
    ];
    const uTheme = engine.extractUniversalTheme(sourceTemplate, 'Soft Blue');

    // Apply to 4x6 Postcard (width = 1200, height = 1800)
    const targetPostcard = engine.createTemplate('4_3x4', '4x6-portrait');
    const appliedPostcard = engine.applyUniversalTheme(uTheme, targetPostcard);

    expect(appliedPostcard.canvas.backgroundColor).toBe('#E6F0FA');
    expect(appliedPostcard.isCustom).toBe(true);
    expect(appliedPostcard.universalThemeId).toBe(uTheme.themeId);
    expect(appliedPostcard.artboard).toHaveLength(1);
    // On 1200w canvas, relWidth = 0.5 -> 600px width, aspect 2.0 -> 300px height
    expect(appliedPostcard.artboard[0].width).toBe(600);
    expect(appliedPostcard.artboard[0].height).toBe(300);
    expect(appliedPostcard.artboard[0].rotation).toBe(10);
    expect(appliedPostcard.slots).toHaveLength(4); // original slots preserved

    // Apply to Thermal 80mm (width = 576)
    const targetThermal = engine.createTemplate('2_1x1', 'thermal80');
    const appliedThermal = engine.applyUniversalTheme(uTheme, targetThermal);
    expect(appliedThermal.canvas.backgroundColor).toBe('#E6F0FA');
    expect(appliedThermal.type).toBe('thermal80');
    expect(appliedThermal.artboard).toHaveLength(1);
    expect(appliedThermal.artboard[0].width).toBe(Math.round(0.5 * 576));
  });

  describe('Universal Theme v2', () => {
    const IMG = 'data:image/png;base64,AAAA';
    const PRESETS = ['2x6', '4x6-portrait', '4x6-landscape', 'photo5x7', 'thermal58', 'thermal80', 'thermal100'];

    function decorated(layoutId: string, preset: string) {
      const template = engine.createTemplate(layoutId, preset);
      const { width, height } = template.canvas;
      const slotsTop = Math.min(...template.slots.map((s: any) => s.y));
      const slotsBottom = Math.max(...template.slots.map((s: any) => s.y + s.height));
      const logoW = Math.round(width * 0.3);
      template.artboard = [
        { id: 'logo', name: 'Logo', url: IMG, placement: 'front', x: Math.round((width - logoW) / 2), y: Math.round(slotsTop / 2 - logoW / 4), width: logoW, height: Math.round(logoW / 2), rotation: 0, zIndex: 2, opacity: 1, visible: true },
        { id: 'brand', name: 'Brand', url: IMG, placement: 'front', x: width - 40 - 120, y: Math.round((slotsBottom + height) / 2 - 30), width: 120, height: 60, rotation: 0, zIndex: 3, opacity: 1, visible: true },
        { id: 'corner', name: 'Corner', url: IMG, placement: 'back', x: 0, y: 0, width: 80, height: 80, rotation: 15, zIndex: 1, opacity: 0.8, visible: true }
      ];
      return template;
    }

    function coverRatio(layer: any, template: any) {
      return Math.max(0, ...template.slots.map((slot: any) => {
        const w = Math.min(layer.x + layer.width, slot.x + slot.width) - Math.max(layer.x, slot.x);
        const h = Math.min(layer.y + layer.height, slot.y + slot.height) - Math.max(layer.y, slot.y);
        return w > 0 && h > 0 ? (w * h) / (slot.width * slot.height) : 0;
      }));
    }

    it('groups paper shapes into ratio buckets', () => {
      expect(engine.getRatioBucket(600, 1800)).toBe('strip');
      expect(engine.getRatioBucket(1200, 1800)).toBe('portrait');
      expect(engine.getRatioBucket(1500, 2100)).toBe('portrait');
      expect(engine.getRatioBucket(1080, 1080)).toBe('square');
      expect(engine.getRatioBucket(1800, 1200)).toBe('landscape');
    });

    it('finds header, footer and photo regions from the layout', () => {
      const template = engine.createTemplate('3_1x1', '2x6');
      const regions = engine.computeThemeRegions(template);
      const slotsTop = Math.min(...template.slots.map((s: any) => s.y));
      expect(regions.slots.y).toBe(slotsTop);
      expect(regions.header.y + regions.header.height).toBe(slotsTop);
      expect(regions.footer.y).toBe(regions.slots.y + regions.slots.height);
      expect(regions.slotRects).toHaveLength(3);
      expect(regions.shortSide).toBe(600);
    });

    it.each(PRESETS)('reproduces the source design exactly when applied back onto %s', (preset) => {
      const source = decorated('3_1x1', preset);
      const theme = engine.extractUniversalTheme(source, 'Round Trip');
      const applied = engine.applyUniversalTheme(theme, engine.createTemplate('3_1x1', preset));
      expect(applied.artboard).toHaveLength(3);
      for (const original of source.artboard) {
        const layer = applied.artboard.find((l: any) => l.name === original.name);
        expect(Math.abs(layer.x - original.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(layer.y - original.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(layer.width - original.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(layer.height - original.height)).toBeLessThanOrEqual(1);
        expect(layer.rotation).toBe(original.rotation);
      }
    });

    it('applies a strip theme to every default layout without distorting or covering photos', () => {
      const theme = engine.extractUniversalTheme(decorated('3_1x1', '2x6'), 'Everywhere');
      for (const target of engine.createDefaultTemplates()) {
        const { template, warnings } = engine.applyUniversalThemeWithReport(theme, target);
        expect(template.slots).toEqual(target.slots);
        const logo = template.artboard.find((l: any) => l.name === 'Logo');
        const brand = template.artboard.find((l: any) => l.name === 'Brand');
        // Stickers keep their own shape on every paper.
        expect(logo.width / logo.height).toBeCloseTo(2, 1);
        expect(brand.width / brand.height).toBeCloseTo(2, 1);
        // Header/footer decorations never sit on the photos.
        expect(coverRatio(logo, template)).toBeLessThanOrEqual(0.15);
        expect(coverRatio(brand, template)).toBeLessThanOrEqual(0.15);
        expect(warnings.filter((w) => w.code === 'covers_photo')).toEqual([]);
      }
    });

    it('keeps a logo that hangs into the top margin on the paper of a shorter header', () => {
      const source = engine.createTemplate('3_1x1', '2x6');
      source.artboard = [{ id: 'logo', name: 'Logo', url: IMG, x: 180, y: 30, width: 240, height: 60 }];
      const theme = engine.extractUniversalTheme(source, 'Top Margin');
      for (const target of engine.createDefaultTemplates()) {
        const { template, warnings } = engine.applyUniversalThemeWithReport(theme, target);
        const logo = template.artboard[0];
        expect(logo.y).toBeGreaterThanOrEqual(0);
        expect(logo.y + logo.height).toBeLessThanOrEqual(Math.min(...template.slots.map((s: any) => s.y)));
        expect(warnings.map((w) => w.code)).not.toContain('outside_canvas');
      }
    });

    it('keeps a footer logo in the footer of a landscape postcard', () => {
      const theme = engine.extractUniversalTheme(decorated('3_1x1', '2x6'), 'Footer');
      const target = engine.createTemplate('4_1x1', '4x6-landscape');
      const applied = engine.applyUniversalTheme(theme, target);
      const brand = applied.artboard.find((l: any) => l.name === 'Brand');
      const slotsBottom = Math.max(...target.slots.map((s: any) => s.y + s.height));
      expect(brand.y).toBeGreaterThanOrEqual(slotsBottom);
      expect(brand.y + brand.height).toBeLessThanOrEqual(applied.canvas.height);
    });

    it('sizes stickers from the short side so landscape paper does not blow them up', () => {
      const theme = engine.extractUniversalTheme(decorated('3_1x1', '2x6'), 'Short Side');
      const portrait = engine.applyUniversalTheme(theme, engine.createTemplate('3_1x1', '4x6-portrait'));
      const landscape = engine.applyUniversalTheme(theme, engine.createTemplate('3_1x1', '4x6-landscape'));
      const corner = (t: any) => t.artboard.find((l: any) => l.name === 'Corner');
      // Same 4x6 sheet turned sideways: same short side, same sticker size.
      expect(corner(landscape).width).toBe(corner(portrait).width);
    });

    it('migrates v1 relative themes and stops width-only scaling', () => {
      const legacy = {
        themeId: 'utheme_legacy',
        name: 'Legacy',
        sourceCanvas: { width: 600, height: 1800, type: '2x6', orientation: 'portrait' },
        style: {
          backgroundColor: '#112233',
          overlay: { url: IMG, zIndex: 100, fitMode: 'cover' },
          artboard: [{ id: 'old', name: 'Old', url: IMG, placement: 'front', relX: 0.1, relY: 0.02, relWidth: 0.5, relHeight: 0.0833, aspectRatio: 2, rotation: 0, zIndex: 1, opacity: 1, visible: true, scaleMode: 'width-relative' }]
        }
      };
      const migrated = engine.migrateUniversalTheme(legacy);
      expect(migrated.schemaVersion).toBe(2);
      expect(migrated.style.elements[0].anchor).toMatchObject({ to: 'canvas', unit: 'region', h: 'left', v: 'top' });
      // Legacy overlays keep applying everywhere (no buckets) so old frames do not vanish.
      expect(migrated.style.overlay.buckets).toBeNull();

      const postcard = engine.applyUniversalTheme(legacy, engine.createTemplate('4_3x4', '4x6-portrait'));
      expect(postcard.artboard[0].width).toBe(600);
      const landscape = engine.applyUniversalTheme(legacy, engine.createTemplate('2_1x1', '4x6-landscape'));
      expect(landscape.artboard[0].width).toBe(600); // v1 made this 900
      expect(landscape.overlay.url).toBe(IMG);
    });

    it('skips a full-page frame on a different paper shape unless a variant provides one', () => {
      const source = engine.createTemplate('3_1x1', '2x6');
      source.overlay = { url: 'data:image/png;base64,STRIPFRAME', zIndex: 100, fitMode: 'stretch' };
      const theme = engine.extractUniversalTheme(source, 'Framed');

      const strip = engine.applyUniversalThemeWithReport(theme, engine.createTemplate('3_3x4', '2x6'));
      expect(strip.template.overlay.url).toBe('data:image/png;base64,STRIPFRAME');

      const postcard = engine.applyUniversalThemeWithReport(theme, engine.createTemplate('4_3x4', '4x6-portrait'));
      expect(postcard.template.overlay.url).toBe('');
      expect(postcard.warnings.map((w) => w.code)).toContain('overlay_skipped');

      theme.style.variants = { portrait: { overlay: { url: 'data:image/png;base64,CARDFRAME' } } };
      const withVariant = engine.applyUniversalThemeWithReport(theme, engine.createTemplate('4_3x4', '4x6-portrait'));
      expect(withVariant.template.overlay.url).toBe('data:image/png;base64,CARDFRAME');
      expect(withVariant.warnings.map((w) => w.code)).not.toContain('overlay_skipped');
    });

    it('lets a ratio variant move or hide a single element', () => {
      const theme = engine.extractUniversalTheme(decorated('3_1x1', '2x6'), 'Variants');
      theme.style.variants = {
        landscape: { elements: { brand: { anchor: { h: 'left' } }, corner: { visible: false } } }
      };
      const applied = engine.applyUniversalTheme(theme, engine.createTemplate('4_1x1', '4x6-landscape'));
      const regions = engine.computeThemeRegions(applied);
      const brand = applied.artboard.find((l: any) => l.name === 'Brand');
      expect(brand.x).toBeLessThan(regions.footer.x + regions.footer.width / 2);
      expect(applied.artboard.find((l: any) => l.name === 'Corner').visible).toBe(false);
    });

    it('frames every photo slot and follows slot rotation', () => {
      const theme = engine.migrateUniversalTheme({
        schemaVersion: 2,
        themeId: 'utheme_frames',
        name: 'Polaroid',
        sourceCanvas: { width: 600, height: 1800 },
        style: {
          elements: [{ id: 'tape', name: 'Tape', url: IMG, anchor: { to: 'each-slot', h: 'center', v: 'top', unit: 'region', dy: -0.05 }, size: { mode: 'region-width', value: 0.4 }, aspectRatio: 4 }]
        }
      });
      const target = engine.createTemplate('4_1x1', '2x6');
      target.slots[1].rotation = 90;
      const applied = engine.applyUniversalTheme(theme, target);
      expect(applied.artboard).toHaveLength(target.slots.length);
      const first = applied.artboard[0];
      expect(first.width).toBe(Math.round(target.slots[0].width * 0.4));
      expect(applied.artboard[1].rotation).toBe(90);
      expect(applied.artboard[0].rotation).toBe(0);
    });

    it('nudges a sticker off the photos and reports it', () => {
      const theme = engine.migrateUniversalTheme({
        schemaVersion: 2,
        themeId: 'utheme_nudge',
        name: 'Nudge',
        sourceCanvas: { width: 600, height: 1800 },
        style: {
          elements: [{ id: 'big', name: 'Big', url: IMG, anchor: { to: 'canvas', h: 'center', v: 'top', unit: 'region', dy: 0.1 }, size: { mode: 'short-side', value: 0.9 }, aspectRatio: 4 }]
        }
      });
      const target = engine.createTemplate('3_1x1', '2x6');
      const { template, warnings } = engine.applyUniversalThemeWithReport(theme, target);
      expect(warnings.map((w) => w.code)).toContain('nudged');
      expect(coverRatio(template.artboard[0], template)).toBeLessThanOrEqual(0.15);
    });

    it('warns when an element is tied to a photo the layout does not have', () => {
      const theme = engine.migrateUniversalTheme({
        schemaVersion: 2,
        themeId: 'utheme_slot4',
        name: 'Slot 4',
        sourceCanvas: { width: 600, height: 1800 },
        style: { elements: [{ id: 'star', name: 'Star', url: IMG, anchor: { to: 'slot', slot: 4 } }] }
      });
      const { template, warnings } = engine.applyUniversalThemeWithReport(theme, engine.createTemplate('2_1x1', '2x6'));
      expect(template.artboard).toHaveLength(0);
      expect(warnings.map((w) => w.code)).toContain('slot_missing');
    });
  });

  describe('Frames and text (phase 2)', () => {
    const IMG = 'data:image/png;base64,AAAA';
    // Rough stand-in for canvas measureText: every character is half the font size wide.
    const measure = (value: string, size: number) => Array.from(value).length * size * 0.5;

    it('normalizes nine-slice borders from a number or per side', () => {
      expect(engine.normalizeSlice(20)).toEqual({ top: 20, right: 20, bottom: 20, left: 20 });
      expect(engine.normalizeSlice({ top: 10, left: 4 })).toEqual({ top: 10, right: 0, bottom: 0, left: 4 });
      expect(engine.normalizeSlice(0)).toBeNull();
      expect(engine.normalizeSlice(null)).toBeNull();
    });

    it('keeps frame corners square while edges stretch to any box', () => {
      // 300x300 frame with a 30px border drawn on a tall 600x1800 strip.
      const patches = engine.nineSlicePatches(300, 300, { top: 30, right: 30, bottom: 30, left: 30 }, 600, 1800);
      expect(patches).toHaveLength(9);
      const corner = patches[0];
      expect(corner.dw).toBeCloseTo(60, 5); // short side 600 / 300 = 2x
      expect(corner.dh).toBeCloseTo(60, 5);
      const right = Math.max(...patches.map((p) => p.dx + p.dw));
      const bottom = Math.max(...patches.map((p) => p.dy + p.dh));
      expect(right).toBeCloseTo(600, 5);
      expect(bottom).toBeCloseTo(1800, 5);
    });

    it('shrinks borders that would not fit the box', () => {
      const patches = engine.nineSlicePatches(100, 100, { top: 40, right: 40, bottom: 40, left: 40 }, 50, 400);
      const left = patches.find((p) => p.dx === 0 && p.dy === 0)!;
      expect(left.dw).toBeLessThanOrEqual(25);
    });

    it('fills text variables and leaves unknown braces alone', () => {
      expect(engine.resolveTextVariables('{event_name} · {date} · {other}', { event_name: 'งานแต่ง', date: '7 ต.ค. 2569' }))
        .toBe('งานแต่ง · 7 ต.ค. 2569 · {other}');
      expect(engine.resolveTextVariables('{time}', {})).toBe('');
    });

    it('shrinks a long Thai event name until it fits its box', () => {
      const text = 'งานแต่งงานคุณสมชายและคุณสมหญิง ณ บ้านใหม่ไออุ่น';
      const layout = engine.layoutText(text, measure, { width: 300, height: 60, fontSize: 48, lineHeight: 1.2, autoFit: true });
      expect(layout.fontSize).toBeLessThan(48);
      expect(layout.lines.length * layout.lineHeight).toBeLessThanOrEqual(60.5);
      layout.lines.forEach((line) => expect(measure(line, layout.fontSize)).toBeLessThanOrEqual(300.5));
      expect(layout.lines.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
    });

    it('stores text and nine-slice layers on templates', () => {
      const template = engine.createTemplate('3_1x1', '2x6');
      template.artboard = [
        { id: 'title', type: 'text', text: '{event_name}', x: 50, y: 20, width: 500, height: 60, fontSize: 40, color: '#ff0000', align: 'left' },
        { id: 'frame', url: IMG, slice: 24, x: 0, y: 0, width: 600, height: 300 }
      ];
      template.overlay = { url: IMG, slice: { top: 30, right: 30, bottom: 30, left: 30 } };
      const normalized = engine.normalizeTemplate(template);
      expect(normalized.artboard[0]).toMatchObject({ type: 'text', text: '{event_name}', fontSize: 40, color: '#ff0000', align: 'left', url: '' });
      expect(normalized.artboard[1]).toMatchObject({ type: 'image', slice: { top: 24, right: 24, bottom: 24, left: 24 } });
      expect(normalized.overlay.slice).toEqual({ top: 30, right: 30, bottom: 30, left: 30 });
    });

    it('shrinks a header title to fit above the photos on wide paper', () => {
      const source = engine.createTemplate('3_1x1', '2x6');
      const slotsTop = Math.min(...source.slots.map((s: any) => s.y));
      source.artboard = [{ id: 'title', name: 'Title', type: 'text', text: 'Hello', x: 40, y: 8, width: 520, height: slotsTop - 16, fontSize: 40 }];
      const theme = engine.extractUniversalTheme(source, 'Band');
      for (const target of engine.createDefaultTemplates()) {
        const applied = engine.applyUniversalTheme(theme, target);
        const title = applied.artboard[0];
        expect(title.y).toBeGreaterThanOrEqual(0);
        expect(title.y + title.height).toBeLessThanOrEqual(Math.min(...applied.slots.map((s: any) => s.y)) + 1);
        expect(title.width / title.height).toBeCloseTo(520 / (slotsTop - 16), 1);
      }
    });

    it('carries text and frames through a Universal Theme, scaling the font with its box', () => {
      const source = engine.createTemplate('3_1x1', '2x6');
      const slotsTop = Math.min(...source.slots.map((s: any) => s.y));
      source.artboard = [
        { id: 'title', name: 'Title', type: 'text', text: '{event_name}', x: 60, y: Math.round(slotsTop / 2 - 25), width: 480, height: 50, fontSize: 30, fontWeight: 700, color: '#223344' },
        { id: 'frame', name: 'Frame', url: IMG, slice: 20, x: 0, y: 0, width: 600, height: 200, placement: 'back' }
      ];
      source.overlay = { url: IMG, slice: 30 };
      const theme = engine.extractUniversalTheme(source, 'Text');
      const title = theme.style.elements.find((e: any) => e.id === 'title');
      expect(title.type).toBe('text');
      expect(title.fontScale).toBeCloseTo(0.6, 3);
      expect(theme.style.overlay.buckets).toBeNull(); // nine-slice frames fit every shape

      const roundTrip = engine.applyUniversalTheme(theme, engine.createTemplate('3_1x1', '2x6'));
      expect(roundTrip.artboard.find((l: any) => l.name === 'Title')).toMatchObject({ type: 'text', fontSize: 30, fontWeight: 700, color: '#223344' });
      expect(roundTrip.artboard.find((l: any) => l.name === 'Frame').slice).toEqual({ top: 20, right: 20, bottom: 20, left: 20 });

      const { template: card, warnings } = engine.applyUniversalThemeWithReport(theme, engine.createTemplate('4_3x4', '4x6-portrait'));
      const cardTitle = card.artboard.find((l: any) => l.name === 'Title');
      expect(cardTitle.fontSize).toBe(Math.round(0.6 * cardTitle.height));
      expect(card.overlay.url).toBe(IMG);
      expect(card.overlay.slice).toEqual({ top: 30, right: 30, bottom: 30, left: 30 });
      expect(warnings.map((w) => w.code)).not.toContain('overlay_skipped');
    });
  });
});
