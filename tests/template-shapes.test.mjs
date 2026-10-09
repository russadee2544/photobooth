import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

await import(pathToFileURL(join(import.meta.dirname, '..', 'public', 'template-engine.js')).href);
const engine = globalThis.PhotoTemplateEngine;

// Minimal absolute-command SVG path reader: returns every point the path visits (arc end points,
// curve control and end points). Enough to prove a shape never leaves its box.
function points(d) {
  const out = [];
  const tokens = d.match(/[MLHVCAZ]|-?\d*\.?\d+/g) || [];
  let i = 0, x = 0, y = 0, cmd = '';
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[MLHVCAZ]/.test(tokens[i])) cmd = tokens[i++];
    if (cmd === 'Z') continue;
    if (cmd === 'M' || cmd === 'L') { x = num(); y = num(); out.push([x, y]); if (cmd === 'M') cmd = 'L'; }
    else if (cmd === 'H') { x = num(); out.push([x, y]); }
    else if (cmd === 'V') { y = num(); out.push([x, y]); }
    else if (cmd === 'C') { for (let k = 0; k < 3; k++) { x = num(); y = num(); out.push([x, y]); } }
    else if (cmd === 'A') { num(); num(); num(); num(); num(); x = num(); y = num(); out.push([x, y]); }
  }
  return out;
}

describe('photo frame shapes', () => {
  it('offers exactly the ten requested shapes', () => {
    expect(engine.SHAPES.map((s) => s.id).sort()).toEqual(
      ['arch', 'circle', 'diamond', 'heart', 'hexagon', 'oval', 'rectangle', 'rounded', 'stamp', 'star'].sort());
    expect(engine.SHAPES.every((s) => s.label && s.labelEn)).toBe(true);
  });

  for (const { id } of engine.SHAPES) {
    it(`${id}: a closed path that stays inside its box`, () => {
      for (const [w, h] of [[300, 400], [400, 300], [250, 250], [120, 600]]) {
        const d = engine.shapeSvgPath(id, w, h);
        expect(d.startsWith('M')).toBe(true);
        expect(d.endsWith('Z')).toBe(true);
        expect(d).not.toMatch(/NaN|Infinity/);
        for (const [px, py] of points(d)) {
          expect(px).toBeGreaterThanOrEqual(-0.02);
          expect(px).toBeLessThanOrEqual(w + 0.02);
          expect(py).toBeGreaterThanOrEqual(-0.02);
          expect(py).toBeLessThanOrEqual(h + 0.02);
        }
      }
    });
  }

  it('unknown shapes fall back to a plain rectangle', () => {
    expect(engine.shapeSvgPath('banana', 100, 50)).toBe('M0 0H100V50H0Z');
  });

  it('the stamp is perforated on all four edges and leaves room for the photo', () => {
    const stamp = engine.stampGeometry(300, 400);
    const arcs = (stamp.path.match(/A/g) || []).length;
    expect(arcs).toBeGreaterThanOrEqual(16);
    expect(stamp.inset.x).toBeGreaterThan(stamp.radius * 2);
    expect(stamp.inset.x + stamp.inset.w).toBeLessThan(300 - stamp.radius * 2);
    expect(stamp.inset.y + stamp.inset.h).toBeLessThan(400 - stamp.radius * 2);
  });

  it('matches the reference stamp: 8 notches across, 10 down on a 498x640 stamp', () => {
    const stamp = engine.stampGeometry(498, 640);
    expect(stamp.notches).toEqual({ across: 8, down: 10 });
    expect(stamp.radius).toBeCloseTo(20.4, 0);
    // first notch on the top edge is centred ~36px in, leaving a corner tooth
    expect(stamp.path.startsWith('M0 0L15.')).toBe(true);
    expect(stamp.stroke).toBeGreaterThanOrEqual(1);
  });

  it('keeps the shape through normalizeTemplate and falls back for invalid values', () => {
    const base = engine.createDefaultTemplates()[0];
    const make = (shape) => engine.normalizeTemplate({ ...base, slots: base.slots.map((slot) => ({ ...slot, shape })) });
    expect(make('heart').slots.every((slot) => slot.shape === 'heart')).toBe(true);
    expect(make('banana').slots.every((slot) => slot.shape === 'rectangle')).toBe(true);
    expect(make(undefined).slots.every((slot) => slot.shape === 'rectangle')).toBe(true);
  });
});
