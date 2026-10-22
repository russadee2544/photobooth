// Colour "looks" for photos: 3D LUTs (from .cube files or built in) plus skin smoothing / skin tone,
// drawn with WebGL. Used by the phone photo studio (studio/) and by the admin page's preview.
// Plain script; exposes window.LookEngine.
//
// A LUT is kept as an "atlas" image N*N wide and N high: pixel (r + b*N, g) holds the output colour
// for input (r, g, b) on an N-step grid. .cube files and the built-in looks both end up in this form.
(function (root) {
    'use strict';

    // ---------------------------------------------------------------- LUT data
    const BUILTIN_SIZE = 33;
    const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const mix = (a, b, t) => a + (b - a) * t;
    const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
    const curve = (v, lift, gain, gamma) => clamp01(Math.pow(clamp01(lift + v * (gain - lift)), gamma));
    const sat = (r, g, b, s) => { const l = luma(r, g, b); return [l + (r - l) * s, l + (g - l) * s, l + (b - l) * s]; };
    const splitTone = (r, g, b, shadow, highlight, amount) => {
        const l = luma(r, g, b);
        const ws = (1 - l) * amount, wh = l * amount;
        return [r + shadow[0] * ws + highlight[0] * wh, g + shadow[1] * ws + highlight[1] * wh, b + shadow[2] * ws + highlight[2] * wh];
    };

    // Built-in looks: made here from simple colour maths (no third-party LUT files, free to use).
    const BUILTIN = [
        { id: 'film', name: 'Film', th: 'ฟิล์ม', fn(r, g, b) {
            [r, g, b] = sat(r, g, b, 0.85);
            [r, g, b] = splitTone(r, g, b, [-0.02, 0.03, 0.04], [0.06, 0.03, -0.04], 0.9);
            return [curve(r, 0.06, 0.97, 1.02), curve(g, 0.05, 0.96, 1.0), curve(b, 0.07, 0.92, 1.0)];
        } },
        { id: 'warm', name: 'Warm', th: 'อบอุ่น', fn(r, g, b) {
            [r, g, b] = splitTone(r, g, b, [0.03, 0.0, -0.03], [0.07, 0.03, -0.05], 1);
            [r, g, b] = sat(r, g, b, 1.08);
            return [curve(r, 0.02, 1, 0.95), curve(g, 0.01, 1, 0.97), curve(b, 0, 0.97, 1.02)];
        } },
        { id: 'soft', name: 'Soft Pastel', th: 'พาสเทล', fn(r, g, b) {
            [r, g, b] = sat(r, g, b, 0.72);
            [r, g, b] = splitTone(r, g, b, [0.02, 0.0, 0.05], [0.04, 0.02, 0.02], 1);
            return [curve(r, 0.1, 1, 0.9), curve(g, 0.09, 0.99, 0.9), curve(b, 0.11, 1, 0.9)];
        } },
        { id: 'cool', name: 'Cool', th: 'โทนเย็น', fn(r, g, b) {
            [r, g, b] = splitTone(r, g, b, [-0.02, 0.01, 0.06], [-0.03, 0.01, 0.04], 1);
            return [curve(r, 0.02, 0.97, 1.03), curve(g, 0.02, 1, 1.0), curve(b, 0.03, 1, 0.95)];
        } },
        { id: 'vivid', name: 'Vivid', th: 'สดใส', fn(r, g, b) {
            [r, g, b] = sat(r, g, b, 1.3);
            const s = (v) => clamp01(0.5 + (v - 0.5) * 1.12);
            return [s(r), s(g), s(b)];
        } },
        { id: 'vintage', name: 'Vintage', th: 'วินเทจ', fn(r, g, b) {
            const l = luma(r, g, b);
            [r, g, b] = [mix(r, l * 1.07, 0.45), mix(g, l * 0.98, 0.45), mix(b, l * 0.82, 0.45)];
            return [curve(r, 0.1, 0.95, 1.0), curve(g, 0.08, 0.92, 1.02), curve(b, 0.12, 0.85, 1.05)];
        } },
        { id: 'mono', name: 'Mono', th: 'ขาวดำ', fn(r, g, b) {
            const l = clamp01(0.5 + (luma(r, g, b) - 0.5) * 1.15);
            return [l, l, l];
        } },
        { id: 'fade', name: 'Matte', th: 'แมตต์', fn(r, g, b) {
            [r, g, b] = sat(r, g, b, 0.9);
            return [curve(r, 0.12, 0.95, 1.05), curve(g, 0.12, 0.95, 1.05), curve(b, 0.14, 0.95, 1.02)];
        } }
    ];

    // { size, data: Float32Array(size^3 * 3) } -> atlas canvas
    function atlasFromTable(size, data) {
        const canvas = document.createElement('canvas');
        canvas.width = size * size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(size * size, size);
        for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
            const i = ((b * size + g) * size + r) * 3;          // .cube order: r fastest, then g, then b
            const o = (g * size * size + b * size + r) * 4;
            img.data[o] = Math.round(clamp01(data[i]) * 255);
            img.data[o + 1] = Math.round(clamp01(data[i + 1]) * 255);
            img.data[o + 2] = Math.round(clamp01(data[i + 2]) * 255);
            img.data[o + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        return canvas;
    }

    function builtinAtlas(id) {
        const look = BUILTIN.find((l) => l.id === id);
        if (!look) return null;
        const n = BUILTIN_SIZE;
        const data = new Float32Array(n * n * n * 3);
        let i = 0;
        for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
            const out = look.fn(r / (n - 1), g / (n - 1), b / (n - 1));
            data[i++] = out[0]; data[i++] = out[1]; data[i++] = out[2];
        }
        return { size: n, atlas: atlasFromTable(n, data) };
    }

    // Adobe / Resolve .cube text -> { title, size, atlas }. Throws on files it cannot read.
    function parseCube(text) {
        let size = 0;
        let title = '';
        let min = [0, 0, 0], max = [1, 1, 1];
        const values = [];
        for (const raw of String(text).split(/\r?\n/)) {
            const line = raw.trim();
            if (!line || line.startsWith('#')) continue;
            const parts = line.split(/\s+/);
            const key = parts[0].toUpperCase();
            if (key === 'TITLE') { title = line.slice(5).trim().replace(/^"|"$/g, ''); continue; }
            if (key === 'LUT_3D_SIZE') { size = parseInt(parts[1], 10); continue; }
            if (key === 'LUT_1D_SIZE') throw new Error('lut_1d_not_supported');
            if (key === 'DOMAIN_MIN') { min = parts.slice(1, 4).map(Number); continue; }
            if (key === 'DOMAIN_MAX') { max = parts.slice(1, 4).map(Number); continue; }
            if (/^[A-Z_]+$/.test(key)) continue;                 // other keywords
            if (parts.length >= 3) values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
        }
        if (!(size >= 2 && size <= 128)) throw new Error('lut_size_invalid');
        if (values.length !== size * size * size * 3 || values.some((v) => !Number.isFinite(v))) throw new Error('lut_data_invalid');
        // Normalise a non-default domain to 0..1.
        if (min.some((v) => v !== 0) || max.some((v) => v !== 1)) {
            for (let i = 0; i < values.length; i++) values[i] = (values[i] - min[i % 3]) / ((max[i % 3] - min[i % 3]) || 1);
        }
        let table = Float32Array.from(values);
        // Big LUTs are resampled to 64 steps so the atlas fits every phone GPU (64*64 = 4096 px wide).
        if (size > 64) { table = resample(table, size, 64); size = 64; }
        return { title, size, atlas: atlasFromTable(size, table) };
    }

    function resample(table, from, to) {
        const out = new Float32Array(to * to * to * 3);
        const at = (r, g, b, c) => table[((b * from + g) * from + r) * 3 + c];
        let o = 0;
        for (let b = 0; b < to; b++) for (let g = 0; g < to; g++) for (let r = 0; r < to; r++) {
            const fr = r * (from - 1) / (to - 1), fg = g * (from - 1) / (to - 1), fb = b * (from - 1) / (to - 1);
            const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
            const r1 = Math.min(from - 1, r0 + 1), g1 = Math.min(from - 1, g0 + 1), b1 = Math.min(from - 1, b0 + 1);
            const tr = fr - r0, tg = fg - g0, tb = fb - b0;
            for (let c = 0; c < 3; c++) {
                const c00 = mix(at(r0, g0, b0, c), at(r1, g0, b0, c), tr), c10 = mix(at(r0, g1, b0, c), at(r1, g1, b0, c), tr);
                const c01 = mix(at(r0, g0, b1, c), at(r1, g0, b1, c), tr), c11 = mix(at(r0, g1, b1, c), at(r1, g1, b1, c), tr);
                out[o++] = mix(mix(c00, c10, tg), mix(c01, c11, tg), tb);
            }
        }
        return out;
    }

    // An atlas PNG published by the admin page -> { size, atlas } once it has loaded.
    function atlasFromImage(image) {
        const size = image.naturalHeight || image.height;
        if (!size || (image.naturalWidth || image.width) !== size * size) throw new Error('lut_atlas_invalid');
        return { size, atlas: image };
    }

    // ---------------------------------------------------------------- WebGL renderer
    const VERTEX = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() { v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5); gl_Position = vec4(a_pos, 0.0, 1.0); }`;

    const FRAGMENT = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_img;
uniform sampler2D u_lut;
uniform float u_lutSize;
uniform float u_lutAmount;    // 0..1
uniform float u_smooth;       // 0..1
uniform float u_bright;       // 0..1
uniform float u_tone;         // -1 (golden) .. 1 (rosy)
uniform vec2 u_texel;         // 1 / image size
uniform float u_radius;       // smoothing radius in px

// Skin likelihood from YCbCr (classic skin range Cb 77..127, Cr 133..173 out of 255), soft edged.
float skin(vec3 c) {
    float y  = dot(c, vec3(0.299, 0.587, 0.114));
    float cb = 0.5 + dot(c, vec3(-0.168736, -0.331264, 0.5));
    float cr = 0.5 + dot(c, vec3(0.5, -0.418688, -0.081312));
    float mCb = smoothstep(0.27, 0.31, cb) * (1.0 - smoothstep(0.49, 0.53, cb));
    float mCr = smoothstep(0.50, 0.54, cr) * (1.0 - smoothstep(0.67, 0.71, cr));
    float mY  = smoothstep(0.12, 0.22, y);
    return mCb * mCr * mY;
}

vec3 lut(vec3 c) {
    float n = u_lutSize;
    float b = c.b * (n - 1.0);
    float b0 = floor(b);
    float b1 = min(n - 1.0, b0 + 1.0);
    float x = (c.r * (n - 1.0) + 0.5) / (n * n);
    float y = (c.g * (n - 1.0) + 0.5) / n;
    vec3 s0 = texture2D(u_lut, vec2(x + b0 / n, y)).rgb;
    vec3 s1 = texture2D(u_lut, vec2(x + b1 / n, y)).rgb;
    return mix(s0, s1, b - b0);
}

void main() {
    vec3 c = texture2D(u_img, v_uv).rgb;
    float m = skin(c);

    if (u_smooth > 0.0 && m > 0.01) {
        // Edge-aware blur (bilateral): neighbours with a similar colour count, edges (eyes, brows, lips) stay sharp.
        vec3 acc = c;
        float wsum = 1.0;
        for (int i = 0; i < 24; i++) {
            float a = float(i) * 2.39996;                       // golden-angle spiral
            float r = sqrt((float(i) + 0.5) / 24.0) * u_radius;
            vec2 off = vec2(cos(a), sin(a)) * r * u_texel;
            vec3 s = texture2D(u_img, v_uv + off).rgb;
            vec3 d = s - c;
            float w = exp(-dot(d, d) * 140.0);
            acc += s * w;
            wsum += w;
        }
        vec3 smoothC = acc / wsum;
        c = mix(c, smoothC, m * u_smooth);
    }
    if (u_bright > 0.0) {
        vec3 lifted = 1.0 - (1.0 - c) * (1.0 - 0.22 * u_bright);   // gentle screen-style lift
        c = mix(c, lifted, m);
    }
    if (u_tone != 0.0) {
        vec3 rosy = vec3(1.03, 0.98, 1.01), golden = vec3(1.03, 1.01, 0.95);
        vec3 tint = u_tone > 0.0 ? rosy : golden;
        c = mix(c, clamp(c * tint, 0.0, 1.0), m * abs(u_tone));
    }
    if (u_lutAmount > 0.0) c = mix(c, lut(clamp(c, 0.0, 1.0)), u_lutAmount);
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

    function compile(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader');
        return shader;
    }

    // One renderer per page. render() draws `image` through the current settings into its canvas.
    function createRenderer() {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false })
            || canvas.getContext('experimental-webgl', { preserveDrawingBuffer: true });
        if (!gl) return null;
        const program = gl.createProgram();
        gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
        gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
        gl.useProgram(program);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const pos = gl.getAttribLocation(program, 'a_pos');
        gl.enableVertexAttribArray(pos);
        gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
        const u = (name) => gl.getUniformLocation(program, name);
        const loc = { img: u('u_img'), lut: u('u_lut'), size: u('u_lutSize'), amount: u('u_lutAmount'), smooth: u('u_smooth'),
            bright: u('u_bright'), tone: u('u_tone'), texel: u('u_texel'), radius: u('u_radius') };
        const makeTexture = () => {
            const t = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            return t;
        };
        const imgTex = makeTexture();
        const lutTex = makeTexture();
        const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
        let currentImage = null;
        let currentLut = null;

        return {
            canvas,
            maxSize,
            setImage(image) {
                if (image === currentImage) return;
                currentImage = image;
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, imgTex);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            },
            setLut(lutData) {
                if (lutData === currentLut) return;
                currentLut = lutData;
                if (!lutData) return;
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, lutTex);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, lutData.atlas);
            },
            // settings: { lut, amount (0..1), smooth (0..1), bright (0..1), tone (-1..1) }; width/height = output size
            render(image, settings, width, height) {
                const s = settings || {};
                canvas.width = width;
                canvas.height = height;
                gl.viewport(0, 0, width, height);
                this.setImage(image);
                this.setLut(s.lut || null);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, imgTex);
                gl.uniform1i(loc.img, 0);
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, lutTex);
                gl.uniform1i(loc.lut, 1);
                gl.uniform1f(loc.size, s.lut ? s.lut.size : 2);
                gl.uniform1f(loc.amount, s.lut ? Math.max(0, Math.min(1, s.amount ?? 1)) : 0);
                gl.uniform1f(loc.smooth, Math.max(0, Math.min(1, s.smooth || 0)));
                gl.uniform1f(loc.bright, Math.max(0, Math.min(1, s.bright || 0)));
                gl.uniform1f(loc.tone, Math.max(-1, Math.min(1, s.tone || 0)));
                gl.uniform2f(loc.texel, 1 / width, 1 / height);
                gl.uniform1f(loc.radius, Math.max(2, Math.min(width, height) * 0.012));
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
                return canvas;
            }
        };
    }

    root.LookEngine = Object.freeze({ BUILTIN, BUILTIN_SIZE, builtinAtlas, parseCube, atlasFromImage, atlasFromTable, createRenderer });
})(typeof globalThis !== 'undefined' ? globalThis : window);
