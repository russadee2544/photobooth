import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

await import(pathToFileURL(join(import.meta.dirname, '..', 'public', 'film-looks.js')).href);
const film = globalThis.FilmLooks;

function flat(width, height, r, g, b) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 200; }
  return data;
}
const channel = (data, c) => data.filter((_, i) => i % 4 === c);
const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

describe('Japanese film looks', () => {
  it('knows its looks and leaves anything else alone', () => {
    expect(['kyoto', 'tokyo', 'hokkaido', 'instant', 'instantvintage', 'dreamy'].every(film.has)).toBe(true);
    expect(film.has('constructor')).toBe(false);
    const data = flat(4, 4, 10, 20, 30);
    expect(Array.from(film.apply(data, 4, 4, 'nope'))).toEqual(Array.from(flat(4, 4, 10, 20, 30)));
  });

  it.each(['kyoto', 'tokyo', 'hokkaido', 'instant'])('%s fades the blacks and keeps shadows cool', (id) => {
    const data = film.apply(flat(64, 64, 0, 0, 0), 64, 64, id);
    expect(mean(Array.from(channel(data, 1)))).toBeGreaterThan(8);
    expect(mean(Array.from(channel(data, 2)))).toBeGreaterThan(mean(Array.from(channel(data, 0))));
  });

  it('holds whites below paper white so highlights stay soft', () => {
    const data = film.apply(flat(64, 64, 255, 255, 255), 64, 64, 'tokyo');
    expect(mean(Array.from(channel(data, 1)))).toBeLessThan(250);
  });

  it('adds grain, and the same photo always comes out the same', () => {
    const a = film.apply(flat(64, 64, 128, 128, 128), 64, 64, 'kyoto');
    const b = film.apply(flat(64, 64, 128, 128, 128), 64, 64, 'kyoto');
    expect(new Set(channel(a, 1)).size).toBeGreaterThan(5);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('calms a strong red and keeps alpha', () => {
    const data = film.apply(flat(16, 16, 230, 30, 30), 16, 16, 'tokyo');
    expect(mean(Array.from(channel(data, 0)))).toBeLessThan(210);
    expect(data[3]).toBe(200);
  });

  it('dreamy spreads light from a bright spot into the dark around it', () => {
    const size = 80, at = (x, y) => (y * size + x) * 4 + 1;
    const lamp = () => {
      const data = flat(size, size, 20, 20, 20);
      for (let y = 30; y < 50; y++) for (let x = 30; x < 50; x++) data.set([255, 255, 255], (y * size + x) * 4);
      return data;
    };
    const plain = film.apply(lamp(), size, size, 'kyoto');
    const misty = film.apply(lamp(), size, size, 'dreamy');
    expect(misty[at(26, 40)] - misty[at(5, 5)]).toBeGreaterThan(plain[at(26, 40)] - plain[at(5, 5)] + 10);
  });
});
