// Builds the session GIF off the main thread (module worker).
// In:  { photos: string[] }  data URLs, already filtered, in capture order.
// Out: { ok: true, blob } or { ok: false, error }.
import * as gifenc from './vendor/gifenc.esm.js';
import { encodeGif, fitWithin, GIF_MAX_BYTES } from './gif-core.js';

async function decode(src) {
    const blob = await (await fetch(src)).blob();
    return createImageBitmap(blob);
}

self.onmessage = async (event) => {
    try {
        const photos = event.data?.photos;
        if (!Array.isArray(photos) || photos.length < 2) throw new Error('need_two_frames');
        if (typeof OffscreenCanvas === 'undefined') throw new Error('unsupported_browser');

        const bitmaps = [];
        for (const src of photos) bitmaps.push(await decode(src));
        // Every frame shares the first photo's fitted size; others are
        // letterboxed (contain) onto white so mixed aspect ratios never crop.
        const { width, height } = fitWithin(bitmaps[0].width, bitmaps[0].height);
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        const frames = bitmaps.map((bitmap) => {
            const scale = Math.min(width / bitmap.width, height / bitmap.height);
            const w = Math.round(bitmap.width * scale);
            const h = Math.round(bitmap.height * scale);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(bitmap, Math.round((width - w) / 2), Math.round((height - h) / 2), w, h);
            bitmap.close();
            return { width, height, data: ctx.getImageData(0, 0, width, height).data };
        });

        const bytes = encodeGif(frames, gifenc);
        if (bytes.byteLength > GIF_MAX_BYTES) throw new Error('too_large');
        self.postMessage({ ok: true, blob: new Blob([bytes], { type: 'image/gif' }) });
    } catch (error) {
        self.postMessage({ ok: false, error: String(error?.message || error) });
    }
};
