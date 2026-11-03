// Film moods: Japanese film (soft faded tones, cool green shadows, muted reds), instant-camera prints and a
// lens-mist glow. Written for this app (no third-party LUT), and done on canvas pixels so kiosks, iPad and
// Android all get the same picture.
(function () {
    // tint values are added to r/g/b (0-1 scale): shadow fades out towards white, highlight towards black.
    // mist: light spreading from bright areas, as through a diffusion filter on the lens (strength 0-1).
    const LOOKS = {
        kyoto: { exposure: 1.03, contrast: 0.88, black: 0.06, white: 0.97, saturation: 0.92, reds: 0.8, cyan: 0.34,
            shadow: [-0.02, 0.03, 0.026], highlight: [0.038, 0.018, -0.03], vignette: 0.14, grain: 0.034 },
        tokyo: { exposure: 0.96, contrast: 1.1, black: 0.04, white: 0.95, saturation: 0.86, reds: 0.72, cyan: 0.5,
            shadow: [-0.04, 0.026, 0.06], highlight: [0.012, 0.014, -0.004], vignette: 0.26, grain: 0.05 },
        hokkaido: { exposure: 1.1, contrast: 0.82, black: 0.09, white: 0.99, saturation: 0.82, reds: 0.76, cyan: 0.44,
            shadow: [-0.018, 0.03, 0.04], highlight: [0.01, 0.014, 0.02], vignette: 0.06, grain: 0.026 },
        instant: { exposure: 1.06, contrast: 0.8, black: 0.1, white: 0.92, saturation: 0.8, reds: 0.88, cyan: 0.3,
            shadow: [-0.035, 0.045, 0.06], highlight: [0.065, 0.05, -0.025], vignette: 0.24, grain: 0.03, mist: 0.25 },
        instantvintage: { exposure: 1.0, contrast: 0.78, black: 0.12, white: 0.9, saturation: 0.55, reds: 0.95, cyan: 0.1,
            shadow: [0.045, 0.008, -0.012], highlight: [0.075, 0.035, -0.055], vignette: 0.4, grain: 0.045, mist: 0.3 },
        dreamy: { exposure: 1.02, contrast: 0.94, black: 0.03, white: 1, saturation: 0.96, reds: 1, cyan: 0,
            shadow: [0, 0, 0.008], highlight: [0.014, 0.008, -0.004], vignette: 0.05, grain: 0.014, mist: 0.9 },
    };

    const TILE = 256;
    let noise = null;

    // Repeating grain tile with a fixed seed, so a photo and its preview get the same look every time.
    function grainTile() {
        if (noise) return noise;
        noise = new Float32Array(TILE * TILE);
        let seed = 0x4d656d6f;
        const random = () => {
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        for (let i = 0; i < noise.length; i++) noise[i] = random() + random() - 1;
        return noise;
    }

    // Blurred, shrunk copy of the photo (0-1 RGB). The glow is wide and smooth, so a small copy is enough.
    function mistLayer(data, width, height) {
        const scale = Math.max(1, Math.round(Math.max(width, height) / 160));
        const sw = Math.ceil(width / scale), sh = Math.ceil(height / scale);
        const buf = new Float32Array(sw * sh * 3), count = new Float32Array(sw * sh);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4, j = Math.floor(y / scale) * sw + Math.floor(x / scale);
                buf[j * 3] += data[i]; buf[j * 3 + 1] += data[i + 1]; buf[j * 3 + 2] += data[i + 2]; count[j]++;
            }
        }
        for (let j = 0; j < count.length; j++) for (let c = 0; c < 3; c++) buf[j * 3 + c] /= count[j] * 255;
        const radius = Math.max(1, Math.round(Math.max(sw, sh) * 0.06));
        const tmp = new Float32Array(buf.length);
        const pass = (from, to, len, lines, step, lineStep) => {
            for (let line = 0; line < lines; line++) {
                for (let c = 0; c < 3; c++) {
                    for (let k = 0; k < len; k++) {
                        let sum = 0, n = 0;
                        for (let d = -radius; d <= radius; d++) {
                            const at = k + d;
                            if (at >= 0 && at < len) { sum += from[(line * lineStep + at * step) * 3 + c]; n++; }
                        }
                        to[(line * lineStep + k * step) * 3 + c] = sum / n;
                    }
                }
            }
        };
        for (let round = 0; round < 3; round++) {   // three box blurs look like one smooth gaussian
            pass(buf, tmp, sw, sh, 1, sw);
            pass(tmp, buf, sh, sw, sw, 1);
        }
        return { buf, sw, sh, scale };
    }

    function sampleMist(m, x, y, out) {
        const fx = Math.min(m.sw - 1, Math.max(0, (x + 0.5) / m.scale - 0.5));
        const fy = Math.min(m.sh - 1, Math.max(0, (y + 0.5) / m.scale - 0.5));
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const x1 = Math.min(m.sw - 1, x0 + 1), y1 = Math.min(m.sh - 1, y0 + 1);
        const tx = fx - x0, ty = fy - y0;
        for (let c = 0; c < 3; c++) {
            const a = m.buf[(y0 * m.sw + x0) * 3 + c], b = m.buf[(y0 * m.sw + x1) * 3 + c];
            const d = m.buf[(y1 * m.sw + x0) * 3 + c], e = m.buf[(y1 * m.sw + x1) * 3 + c];
            out[c] = (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty;
        }
    }

    function toneTable(look) {
        const table = new Float32Array(256);
        for (let v = 0; v < 256; v++) {
            let t = Math.min(1, (v / 255) * look.exposure);
            t = 0.5 + (t - 0.5) * look.contrast;
            table[v] = look.black + Math.max(0, Math.min(1, t)) * (look.white - look.black);
        }
        return table;
    }

    // `data` is ImageData.data (RGBA bytes); changed in place. Unknown looks leave it alone.
    function apply(data, width, height, id) {
        const look = LOOKS[id];
        if (!look) return data;
        const tone = toneTable(look);
        const tile = grainTile();
        const grainSize = Math.max(1, Math.round(width / 900));   // the same grain on a preview and a full photo
        const cx = (width - 1) / 2, cy = (height - 1) / 2;
        const corner = cx * cx + cy * cy || 1;
        const mist = look.mist ? mistLayer(data, width, height) : null;
        const glow = [0, 0, 0];
        let i = 0;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++, i += 4) {
                let r = data[i], g = data[i + 1], b = data[i + 2];
                if (mist) {
                    // Like a mist filter: bright areas bleed light softly into their surroundings (screen blend],
                    // and the whole picture softens a little. Happens before the film, as it would on the lens.
                    sampleMist(mist, x, y, glow);
                    const gl = 0.2126 * glow[0] + 0.7152 * glow[1] + 0.0722 * glow[2];
                    const t = Math.min(1, Math.max(0, (gl - 0.3) / 0.6));
                    const amount = look.mist * (0.2 + 0.8 * t * t * (3 - 2 * t));
                    const soft = look.mist * 0.18;
                    r = 255 - (255 - r) * (1 - glow[0] * amount); r += (glow[0] * 255 - r) * soft;
                    g = 255 - (255 - g) * (1 - glow[1] * amount); g += (glow[1] * 255 - g) * soft;
                    b = 255 - (255 - b) * (1 - glow[2] * amount); b += (glow[2] * 255 - b) * soft;
                    r = Math.min(255, Math.round(r)); g = Math.min(255, Math.round(g)); b = Math.min(255, Math.round(b));
                }
                r = tone[r]; g = tone[g]; b = tone[b];
                let l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                r = l + (r - l) * look.saturation;
                g = l + (g - l) * look.saturation;
                b = l + (b - l) * look.saturation;

                // Only strong reds calm down; skin sits below this and keeps its colour.
                r -= Math.max(0, r - Math.max(g, b) - 0.22) * (1 - look.reds);
                const green = Math.max(0, g - Math.max(r, b)) * look.cyan;
                b += green;
                r -= green * 0.5;

                const shadow = (1 - l) * (1 - l), highlight = l * l;
                r += look.shadow[0] * shadow + look.highlight[0] * highlight;
                g += look.shadow[1] * shadow + look.highlight[1] * highlight;
                b += look.shadow[2] * shadow + look.highlight[2] * highlight;

                const dx = x - cx, dy = y - cy, edge = (dx * dx + dy * dy) / corner;
                const fall = 1 - look.vignette * edge * edge;
                const n = tile[((Math.floor(y / grainSize) % TILE) * TILE) + (Math.floor(x / grainSize) % TILE)];
                const speck = n * look.grain * (1 - Math.abs(2 * l - 1) * 0.65);
                data[i] = (r * fall + speck) * 255;
                data[i + 1] = (g * fall + speck) * 255;
                data[i + 2] = (b * fall + speck) * 255;
            }
        }
        return data;
    }

    globalThis.FilmLooks = { apply, has: (id) => Object.hasOwn(LOOKS, id) };
})();
