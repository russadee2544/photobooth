/**
 * Represents a filter configuration
 */
export interface FilterPreset {
  id: string;
  name: { en: string; th: string };
  cssFilter: string;
  applyCanvasOps?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
}

export const FILTER_PRESETS: Record<string, FilterPreset> = {
  original: {
    id: 'original',
    name: { en: 'Original', th: 'ต้นฉบับ' },
    cssFilter: 'none'
  },
  bw: {
    id: 'bw',
    name: { en: 'Black & White', th: 'ขาวดำ' },
    cssFilter: 'grayscale(100%) contrast(1.1)'
  },
  vintage: {
    id: 'vintage',
    name: { en: 'Vintage', th: 'วินเทจ' },
    cssFilter: 'sepia(0.6) contrast(1.1) brightness(0.9)'
  },
  bright: {
    id: 'bright',
    name: { en: 'Bright', th: 'สว่าง' },
    cssFilter: 'brightness(1.2) contrast(1.1)'
  },
  soft: {
    id: 'soft',
    name: { en: 'Soft', th: 'นุ่มนวล' },
    cssFilter: 'brightness(1.05) contrast(0.95) blur(0.5px)'
  },
  dramatic: {
    id: 'dramatic',
    name: { en: 'Dramatic', th: 'ดราม่า' },
    cssFilter: 'contrast(1.3) brightness(0.9) saturate(1.2)'
  }
};

/**
 * Helper to get a filter by ID
 */
export function getFilter(id: string): FilterPreset | undefined {
  return FILTER_PRESETS[id];
}

/**
 * Apply filter to entire canvas
 */
export function applyFilter(canvas: HTMLCanvasElement, filterId: string) {
  const filter = getFilter(filterId);
  if (!filter) return;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  ctx.filter = filter.cssFilter;
  
  if (filter.applyCanvasOps) {
    filter.applyCanvasOps(ctx, canvas.width, canvas.height);
  }
}
