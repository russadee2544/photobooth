import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error gifenc ships no type declarations; the encoder is only passed through
import * as gifenc from 'gifenc';

type Frame = { width: number; height: number; data: Uint8ClampedArray };
type GifCore = {
  GIF_MAX_EDGE: number;
  GIF_FRAME_DELAY_MS: number;
  fitWithin: (width: number, height: number, maxEdge?: number) => { width: number; height: number };
  encodeGif: (frames: Frame[], encoder: unknown, options?: { delayMs?: number }) => Uint8Array;
};

let core: GifCore;

beforeAll(async () => {
  // @ts-expect-error public worker module intentionally has no TS declarations
  core = (await import('../../public/gif-core.js')) as GifCore;
});

function solidFrame(width: number, height: number, rgb: [number, number, number]): Frame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  }
  return { width, height, data };
}

// Minimal GIF89a walker: frame count, per-frame delay (cs), loop count and the
// first palette colour of each frame (used to check frame order).
function inspectGif(bytes: Uint8Array) {
  const u16 = (at: number) => bytes[at] | (bytes[at + 1] << 8);
  expect(String.fromCharCode(...bytes.slice(0, 6))).toBe('GIF89a');
  const width = u16(6);
  const height = u16(8);
  const flags = bytes[10];
  let pos = 13;
  let globalPalette: number[][] = [];
  if (flags & 0x80) {
    const size = 3 * (1 << ((flags & 7) + 1));
    for (let i = 0; i < size; i += 3) globalPalette.push([bytes[pos + i], bytes[pos + i + 1], bytes[pos + i + 2]]);
    pos += size;
  }
  const delays: number[] = [];
  const firstColours: number[][] = [];
  let loop: number | null = null;
  const skipSubBlocks = () => {
    while (bytes[pos] !== 0) pos += bytes[pos] + 1;
    pos += 1;
  };
  while (pos < bytes.length) {
    const marker = bytes[pos];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      const label = bytes[pos + 1];
      if (label === 0xf9) delays.push(u16(pos + 4));
      if (label === 0xff && String.fromCharCode(...bytes.slice(pos + 3, pos + 14)) === 'NETSCAPE2.0') {
        loop = u16(pos + 16);
      }
      pos += 2;
      skipSubBlocks();
    } else if (marker === 0x2c) {
      const localFlags = bytes[pos + 9];
      pos += 10;
      let palette = globalPalette;
      if (localFlags & 0x80) {
        const size = 3 * (1 << ((localFlags & 7) + 1));
        palette = [];
        for (let i = 0; i < size; i += 3) palette.push([bytes[pos + i], bytes[pos + i + 1], bytes[pos + i + 2]]);
        pos += size;
      }
      firstColours.push(palette[0]);
      pos += 1; // LZW minimum code size
      skipSubBlocks();
    } else {
      throw new Error(`unexpected GIF block 0x${marker.toString(16)}`);
    }
  }
  return { width, height, delays, loop, frames: firstColours.length, firstColours };
}

describe('gif-core', () => {
  it('fits the long edge within 640px without upscaling', () => {
    expect(core.fitWithin(1920, 1080)).toEqual({ width: 640, height: 360 });
    expect(core.fitWithin(1080, 1920)).toEqual({ width: 360, height: 640 });
    expect(core.fitWithin(400, 300)).toEqual({ width: 400, height: 300 });
    expect(() => core.fitWithin(0, 10)).toThrow('invalid_dimensions');
  });

  it.each([2, 3, 4])('encodes %i photos as that many frames in capture order', (count) => {
    const colours: [number, number, number][] = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
    const frames = colours.slice(0, count).map((rgb) => solidFrame(32, 24, rgb));
    const gif = inspectGif(core.encodeGif(frames, gifenc));
    expect(gif.frames).toBe(count);
    expect(gif.width).toBe(32);
    expect(gif.height).toBe(24);
    expect(gif.firstColours).toEqual(colours.slice(0, count));
  });

  it('uses 500ms per frame and loops forever with no reverse pass', () => {
    const frames = [solidFrame(8, 8, [10, 10, 10]), solidFrame(8, 8, [200, 200, 200])];
    const gif = inspectGif(core.encodeGif(frames, gifenc));
    expect(core.GIF_FRAME_DELAY_MS).toBe(500);
    expect(gif.delays).toEqual([50, 50]);
    expect(gif.loop).toBe(0);
    expect(gif.frames).toBe(2);
  });

  it('refuses a single photo and mismatched frame sizes', () => {
    expect(() => core.encodeGif([solidFrame(8, 8, [0, 0, 0])], gifenc)).toThrow('need_two_frames');
    expect(() => core.encodeGif([solidFrame(8, 8, [0, 0, 0]), solidFrame(9, 8, [0, 0, 0])], gifenc))
      .toThrow('frame_size_mismatch');
  });
});
