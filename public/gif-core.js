// Pure GIF helpers shared by gif-worker.js and the unit tests.
// No DOM access here: callers hand in decoded RGBA frames.

export const GIF_MAX_EDGE = 640;
export const GIF_FRAME_DELAY_MS = 500;
export const GIF_MAX_BYTES = 20 * 1024 * 1024;

// Scale (width, height) down so the long edge is at most maxEdge. Never upscales.
export function fitWithin(width, height, maxEdge = GIF_MAX_EDGE) {
    if (!(width > 0) || !(height > 0)) throw new Error('invalid_dimensions');
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

// Encode frames in the given order: one GIF frame per photo, fixed delay,
// loop forever (repeat 0), no reverse pass. `gifenc` is the encoder module.
export function encodeGif(frames, gifenc, { delayMs = GIF_FRAME_DELAY_MS } = {}) {
    if (!Array.isArray(frames) || frames.length < 2) throw new Error('need_two_frames');
    const { width, height } = frames[0];
    const encoder = gifenc.GIFEncoder();
    frames.forEach((frame, index) => {
        if (frame.width !== width || frame.height !== height) throw new Error('frame_size_mismatch');
        const palette = gifenc.quantize(frame.data, 256);
        const indexed = gifenc.applyPalette(frame.data, palette);
        encoder.writeFrame(indexed, width, height, {
            palette,
            delay: delayMs,
            ...(index === 0 ? { repeat: 0 } : {}),
        });
    });
    encoder.finish();
    return encoder.bytes();
}
