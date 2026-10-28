// CSS filter functions (grayscale, sepia, saturate, brightness, contrast) applied to canvas pixels.
// Safari / iPad WebKit ignores CanvasRenderingContext2D.filter, so photos would print unfiltered;
// this applies the same math (Filter Effects spec, sRGB, clamped after each function) by hand.
(function () {
    const MATRIX = {
        grayscale: (a) => { const s = 1 - Math.min(1, a); return [
            0.2126 + 0.7874 * s, 0.7152 - 0.7152 * s, 0.0722 - 0.0722 * s,
            0.2126 - 0.2126 * s, 0.7152 + 0.2848 * s, 0.0722 - 0.0722 * s,
            0.2126 - 0.2126 * s, 0.7152 - 0.7152 * s, 0.0722 + 0.9278 * s]; },
        sepia: (a) => { const s = 1 - Math.min(1, a); return [
            0.393 + 0.607 * s, 0.769 - 0.769 * s, 0.189 - 0.189 * s,
            0.349 - 0.349 * s, 0.686 + 0.314 * s, 0.168 - 0.168 * s,
            0.272 - 0.272 * s, 0.534 - 0.534 * s, 0.131 + 0.869 * s]; },
        saturate: (s) => [
            0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
            0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
            0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
    };

    // 'sepia(55%) contrast(108%)' -> [{ fn: 'sepia', amount: 0.55 }, { fn: 'contrast', amount: 1.08 }]
    function parse(css) {
        const steps = [];
        String(css || '').replace(/([a-z-]+)\(\s*([\d.]+)(%?)\s*\)/g, (_, fn, value, pct) => {
            steps.push({ fn, amount: Number(value) / (pct ? 100 : 1) });
            return '';
        });
        return steps;
    }

    // `data` is ImageData.data (RGBA bytes); changed in place.
    function apply(data, css) {
        const steps = parse(css);
        const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
        for (let i = 0; i < data.length; i += 4) {
            let r = data[i], g = data[i + 1], b = data[i + 2];
            for (const { fn, amount } of steps) {
                if (MATRIX[fn]) {
                    const m = MATRIX[fn](amount);
                    const nr = m[0] * r + m[1] * g + m[2] * b;
                    const ng = m[3] * r + m[4] * g + m[5] * b;
                    const nb = m[6] * r + m[7] * g + m[8] * b;
                    r = clamp(nr); g = clamp(ng); b = clamp(nb);
                } else if (fn === 'brightness') {
                    r = clamp(r * amount); g = clamp(g * amount); b = clamp(b * amount);
                } else if (fn === 'contrast') {
                    r = clamp((r - 127.5) * amount + 127.5); g = clamp((g - 127.5) * amount + 127.5); b = clamp((b - 127.5) * amount + 127.5);
                }
            }
            data[i] = r; data[i + 1] = g; data[i + 2] = b;
        }
        return data;
    }

    // Does this browser apply ctx.filter? (Assigning it in Safari only adds an unused property.)
    let native = null;
    function nativeSupported() {
        if (native !== null) return native;
        try {
            const c = document.createElement('canvas');
            c.width = c.height = 1;
            const ctx = c.getContext('2d');
            ctx.filter = 'grayscale(100%)';
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, 1, 1);
            const [r, g] = ctx.getImageData(0, 0, 1, 1).data;
            native = Math.abs(r - g) < 8;
        } catch (_) {
            native = false;
        }
        return native;
    }

    globalThis.CssCanvasFilter = { parse, apply, nativeSupported };
})();
