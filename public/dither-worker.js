// Floyd-Steinberg dithering running inside a Web Worker.
// Receives { width, height, buffer } (Uint8ClampedArray RGBA), returns the
// dithered monochrome RGBA buffer back to the main thread.
self.onmessage = (e) => {
    const { width, height, buffer } = e.data;
    const data = new Uint8ClampedArray(buffer);
    const gray = new Float32Array(width * height);

    for (let i = 0; i < width * height; i++) {
        gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    }
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const oldVal = gray[idx];
            const newVal = oldVal < 128 ? 0 : 255;
            gray[idx] = newVal;
            const err = oldVal - newVal;
            if (x + 1 < width) gray[idx + 1] += err * 7 / 16;
            if (x - 1 >= 0 && y + 1 < height) gray[idx + width - 1] += err * 3 / 16;
            if (y + 1 < height) gray[idx + width] += err * 5 / 16;
            if (x + 1 < width && y + 1 < height) gray[idx + width + 1] += err * 1 / 16;
        }
    }
    for (let i = 0; i < width * height; i++) {
        const v = Math.max(0, Math.min(255, gray[i]));
        data[i * 4] = v;
        data[i * 4 + 1] = v;
        data[i * 4 + 2] = v;
        data[i * 4 + 3] = 255;
    }

    self.postMessage({ width, height, buffer: data.buffer }, [data.buffer]);
};
