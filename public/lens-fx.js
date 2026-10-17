// Live "lens" effects for the capture page: the camera video is drawn through a WebGL shader
// (fisheye, mirror, glitch ...) so customers see the effect before they press the shutter, and
// the photo is taken from the same canvas. Plain script; exposes window.LensFx.
// Lens names/ids live in shared.js (LENS_PRESETS) so the admin page can list them too.
(function (root) {
    'use strict';

    const MODES = ['normal', 'fisheye', 'wide', 'bulge', 'pinch', 'mirror', 'kaleido', 'film', 'tiltshift', 'glitch', 'halftone', 'pixel'];

    const VERTEX = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

    const FRAGMENT = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_mode;
uniform float u_time;
uniform vec2 u_size;                // output size in px

vec2 fold(vec2 q) {                 // mirror-repeat so warped lookups never smear the edge
    vec2 f = abs(mod(q, 2.0));
    return mix(f, 2.0 - f, step(1.0, f));
}
vec3 tex(vec2 uv) { return texture2D(u_tex, fold(uv)).rgb; }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
    vec2 uv = v_uv;
    vec2 asp = vec2(u_size.x / u_size.y, 1.0);
    vec2 p = (uv - 0.5) * 2.0;      // -1..1
    vec2 pa = p * asp;              // aspect-correct, for round effects
    float r2 = dot(p, p);
    vec3 col;
    int mode = int(u_mode + 0.5);

    if (mode == 1) {                // fisheye: strong barrel, round vignette
        vec2 q = p * (1.0 + 1.1 * r2) / 1.55;
        col = tex(q * 0.5 + 0.5);
        col *= 1.0 - 0.55 * smoothstep(0.7, 1.9, r2);
    } else if (mode == 2) {         // wide angle: gentle barrel
        vec2 q = p * (1.0 + 0.32 * r2) / 1.12;
        col = tex(q * 0.5 + 0.5);
    } else if (mode == 3) {         // bulge: magnify the middle
        float d = length(pa) / 0.95;
        float k = d < 1.0 ? 1.0 - 0.6 * (1.0 - d * d) : 1.0;
        col = tex((p * k) * 0.5 + 0.5);
    } else if (mode == 4) {         // pinch: squeeze the middle
        float d = length(pa) / 0.95;
        float k = d < 1.0 ? 1.0 + 0.45 * (1.0 - d * d) : 1.0;
        col = tex((p * k) * 0.5 + 0.5);
    } else if (mode == 5) {         // mirror: left half reflected onto the right
        col = tex(vec2(0.5 - abs(uv.x - 0.5), uv.y));
    } else if (mode == 6) {         // kaleidoscope: 6 mirrored wedges, slowly turning
        float a = atan(pa.y, pa.x) + u_time * 0.15;
        float seg = 6.2831853 / 6.0;
        a = abs(mod(a, seg) - seg * 0.5);
        vec2 q = vec2(cos(a), sin(a)) * length(pa) * 0.8;
        col = tex(q / asp * 0.5 + 0.5);
    } else if (mode == 7) {         // film: warm, faded, grain, vignette, light leak on the left
        col = tex(uv);
        col = mix(vec3(luma(col)), col, 0.85) * vec3(1.06, 1.0, 0.9) + 0.03;
        col += vec3(0.55, 0.18, 0.05) * pow(max(0.0, 1.0 - uv.x * 3.2), 2.0) * 0.8;
        col *= 1.0 - 0.45 * smoothstep(0.35, 1.5, r2);
        col += (rnd(uv * u_size + u_time) - 0.5) * 0.09;
    } else if (mode == 8) {         // tilt-shift: sharp band across the middle, blurred above/below
        float band = smoothstep(0.12, 0.55, abs(p.y));
        vec3 acc = vec3(0.0);
        for (int i = -4; i <= 4; i++) acc += tex(uv + vec2(0.0, float(i)) * band * 0.006);
        for (int i = -4; i <= 4; i++) acc += tex(uv + vec2(float(i), 0.0) * band * 0.006);
        col = acc / 18.0;
        col = mix(vec3(luma(col)), col, 1.3);
    } else if (mode == 9) {         // glitch: RGB split + jittering slices
        float slice = floor(uv.y * 24.0);
        float jitter = (rnd(vec2(slice, floor(u_time * 6.0))) - 0.5) * 0.05 * step(0.8, rnd(vec2(slice * 3.1, floor(u_time * 6.0))));
        vec2 o = vec2(jitter + 0.012, 0.0);
        col = vec3(tex(uv + o).r, tex(uv + vec2(jitter, 0.0)).g, tex(uv - o).b);
        col *= 0.92 + 0.08 * sin(uv.y * u_size.y * 1.6);
    } else if (mode == 10) {        // halftone: black dots on white, prints crisp on the receipt
        float cell = u_size.y / 70.0;
        vec2 px = uv * u_size;
        mat2 rot = mat2(0.7071, -0.7071, 0.7071, 0.7071);
        vec2 g = rot * px / cell;
        vec2 f = fract(g) - 0.5;
        vec2 center = (floor(g) + 0.5);
        vec2 src = (mat2(0.7071, 0.7071, -0.7071, 0.7071) * (center * cell)) / u_size;
        float l = luma(tex(src));
        float dotR = sqrt(1.0 - l) * 0.62;
        float m = 1.0 - smoothstep(dotR - 0.08, dotR + 0.08, length(f));
        col = vec3(1.0 - m);
    } else if (mode == 11) {        // pixel: 64 columns of big square pixels
        float n = 64.0;
        vec2 cells = vec2(n, floor(n * u_size.y / u_size.x));
        col = tex((floor(uv * cells) + 0.5) / cells);
        col = floor(col * 6.0 + 0.5) / 6.0;
    } else {
        col = tex(uv);
    }
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

    function compile(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader');
        return shader;
    }

    // Draws `video` through the current lens onto `canvas`. Returns null when WebGL is missing.
    function create(video, canvas) {
        const gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false })
            || canvas.getContext('experimental-webgl');
        if (!gl) return null;
        let program;
        try {
            program = gl.createProgram();
            gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
            gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link');
        } catch (error) {
            console.warn('Lens effects unavailable:', error);
            return null;
        }
        gl.useProgram(program);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const pos = gl.getAttribLocation(program, 'a_pos');
        gl.enableVertexAttribArray(pos);
        gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        const uMode = gl.getUniformLocation(program, 'u_mode');
        const uTime = gl.getUniformLocation(program, 'u_time');
        const uSize = gl.getUniformLocation(program, 'u_size');

        let mode = 0;
        let raf = 0;
        let maxEdge = 960;
        const t0 = performance.now();

        function fit(edge) {
            const vw = video.videoWidth, vh = video.videoHeight;
            if (!vw || !vh) return false;
            const scale = Math.min(1, edge / Math.max(vw, vh));
            const w = Math.max(2, Math.round(vw * scale)), h = Math.max(2, Math.round(vh * scale));
            if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
            return true;
        }
        function render() {
            if (!fit(maxEdge) || video.readyState < 2) return false;
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
            gl.uniform1f(uMode, mode);
            gl.uniform1f(uTime, (performance.now() - t0) / 1000);
            gl.uniform2f(uSize, canvas.width, canvas.height);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            return true;
        }
        function loop() { render(); raf = requestAnimationFrame(loop); }

        return {
            setLens(id) { const i = MODES.indexOf(id); mode = i < 0 ? 0 : i; },
            get lens() { return MODES[mode]; },
            start() { if (!raf) loop(); },
            stop() { cancelAnimationFrame(raf); raf = 0; },
            // Render one frame at capture size and hand the canvas back (valid until the next frame).
            frameForCapture(edge) {
                const before = maxEdge;
                maxEdge = edge || 1280;
                const ok = render();
                maxEdge = before;
                return ok ? canvas : null;
            },
            render
        };
    }

    root.LensFx = Object.freeze({ MODES, create });
})(typeof globalThis !== 'undefined' ? globalThis : window);
