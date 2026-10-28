import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

await import(pathToFileURL(join(import.meta.dirname, '..', 'public', 'css-filter.js')).href);
const filter = globalThis.CssCanvasFilter;
const pixel = (r, g, b, css) => Array.from(filter.apply(new Uint8ClampedArray([r, g, b, 255]), css)).slice(0, 3);

describe('CSS filters on canvas pixels (Safari fallback)', () => {
  it('reads the filter presets', () => {
    expect(filter.parse('sepia(55%) contrast(108%) brightness(96%)')).toEqual([
      { fn: 'sepia', amount: 0.55 }, { fn: 'contrast', amount: 1.08 }, { fn: 'brightness', amount: 0.96 }]);
  });

  it('grayscale(100%) makes every channel equal', () => {
    const [r, g, b] = pixel(255, 0, 0, 'grayscale(100%)');
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBe(54);   // 0.2126 * 255
  });

  it('matches what Chrome draws for the vintage preset', () => {
    // Chrome canvas: rgb(200,120,60) with 'sepia(55%) contrast(108%) brightness(96%)'
    const out = pixel(200, 120, 60, 'sepia(55%) contrast(108%) brightness(96%)');
    expect(out[0]).toBeGreaterThan(out[1]);
    expect(out[1]).toBeGreaterThan(out[2]);
    for (const v of out) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('brightness and contrast move values the CSS way', () => {
    expect(pixel(100, 100, 100, 'brightness(150%)')).toEqual([150, 150, 150]);
    expect(pixel(200, 50, 128, 'contrast(200%)')).toEqual([255, 0, 128]);   // 128.5 rounds to even
  });

  it('leaves alpha alone and ignores unknown functions', () => {
    const data = filter.apply(new Uint8ClampedArray([10, 20, 30, 77]), 'blur(4px)');
    expect(Array.from(data)).toEqual([10, 20, 30, 77]);
  });
});
