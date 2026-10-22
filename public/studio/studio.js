// MEMORIES phone studio: opened from the photo QR. Loads the session's shots and frame layers,
// lets the customer pick a colour look (LUT) and skin smoothing, and saves or shares the result.
// Everything runs on the phone (WebGL via look-engine.js); nothing is sent back.
(function () {
    'use strict';

    const SUPABASE_URL = 'https://zualrdvvlcoexqrbedhl.supabase.co';
    const BUCKET_URL = `${SUPABASE_URL}/storage/v1/object/public/photobooth`;
    const PREVIEW_EDGE = 1100;       // longest side of the on-screen preview
    const EXPORT_SHOT_EDGE = 1600;   // single photos are saved at most this big

    const $ = (id) => document.getElementById(id);
    const state = {
        manifest: null, shots: [], under: null, over: null,
        looks: [], lutCache: new Map(),
        mode: 'frame', shot: 0,
        look: 'none', strength: 1, smooth: 0.35, bright: 0.25, tone: 0,
        showOriginal: false
    };
    let renderer = null;

    // ------------------------------------------------------------ loading
    function fail(title, text) {
        $('loading').hidden = true;
        $('app').hidden = true;
        $('error').hidden = false;
        if (title) $('error-title').textContent = title;
        if (text) $('error-text').textContent = text;
    }
    function loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('image ' + url));
            img.src = url;
        });
    }
    function manifestUrl() {
        const id = location.hash.slice(1).split(/[?&]/)[0];
        if (id === 'local') return 'local';                                 // dev only: bundle built by the kiosk page on this machine
        if (id === 'demo') return 'demo';                                   // try-out with any photos
        return /^[0-9a-f]{32}$/.test(id) ? `${BUCKET_URL}/studio/${id}/manifest.json` : null;
    }

    async function start() {
        renderer = window.LookEngine && LookEngine.createRenderer();
        const url = manifestUrl();
        if (!url) return fail('ไม่พบรูป', 'กรุณาสแกน QR Code ที่ตู้อีกครั้ง');
        let manifest;
        if (url === 'local') manifest = await localManifest();
        if (url === 'demo' || (url === 'local' && !manifest)) manifest = await demoManifest();
        else if (url !== 'local') try {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error(String(response.status));
            manifest = await response.json();
        } catch (_) {
            return fail('ลิงก์นี้หมดอายุแล้ว', 'รูปจะเก็บไว้ 24 ชั่วโมงหลังถ่าย ถ้าเพิ่งถ่าย ลองโหลดหน้านี้ใหม่');
        }
        if (manifest.expiresAt && Date.parse(manifest.expiresAt) < Date.now()) {
            return fail('ลิงก์นี้หมดอายุแล้ว', 'รูปจะเก็บไว้ 24 ชั่วโมงหลังถ่าย');
        }
        state.manifest = manifest;
        if (manifest.original) { $('original').href = manifest.original; $('original').hidden = false; }
        if (manifest.expiresAt) {
            const t = new Date(manifest.expiresAt);
            $('expiry').textContent = `ลิงก์ใช้ได้ถึง ${t.toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
        }

        try {
            state.shots = await Promise.all((manifest.shots || []).map(loadImage));
            if (manifest.frame) {
                [state.under, state.over] = await Promise.all([loadImage(manifest.frame.under), loadImage(manifest.frame.over)]);
            }
        } catch (_) {
            return fail('โหลดรูปไม่สำเร็จ', 'ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง');
        }
        if (!state.shots.length) return fail('ไม่พบรูป', 'กรุณาสแกน QR Code ที่ตู้อีกครั้ง');
        if (!manifest.frame) state.mode = 'shot';

        await loadLooks(manifest.looks);
        buildUi();
        $('loading').hidden = true;
        $('app').hidden = false;
        draw();
    }

    // Dev only: the kiosk's own IndexedDB bundle (same origin on localhost), shaped like a manifest.
    function localManifest() {
        if (!/^(localhost|127.0.0.1)$/.test(location.hostname)) return Promise.resolve(null);
        return new Promise((resolve) => {
            const req = indexedDB.open('photobooth', 1);
            req.onerror = () => resolve(null);
            req.onupgradeneeded = () => req.result.createObjectStore('kv');
            req.onsuccess = () => {
                const get = req.result.transaction('kv', 'readonly').objectStore('kv').get('studio_bundle');
                get.onerror = () => resolve(null);
                get.onsuccess = () => {
                    const b = get.result;
                    if (!b || !b.shots) return resolve(null);
                    resolve({ shots: b.shots, original: null, expiresAt: null, looks: null, localLooks: savedLocalLooks(),
                        frame: b.frame ? { width: b.frame.width, height: b.frame.height, under: b.frame.under, over: b.frame.over, slots: b.frame.slots } : null });
                };
            };
        });
    }

    // Looks the admin page saved in this browser (same site only), shaped like the published looks.json.
    function savedLocalLooks() {
        try {
            const saved = JSON.parse(localStorage.getItem('kiosk_studio_looks') || 'null');
            if (!saved || !Array.isArray(saved.looks)) return null;
            return { looks: saved.looks.filter((l) => l.enabled !== false)
                .map((l) => ({ id: l.id, name: l.name, builtin: !!l.builtin, strength: l.strength ?? 1, atlas: l.builtin ? null : l.atlas })),
                defaults: saved.defaults };
        } catch (_) { return null; }
    }

    // Try-out: the photos come from the person's own device (nothing is uploaded).
    function demoManifest() {
        $('loading').hidden = true;
        $('demo').hidden = false;
        return new Promise((resolve) => {
            const done = (shots) => {
                $('demo').hidden = true;
                $('loading').hidden = false;
                resolve({ shots, original: null, expiresAt: null, looks: null, frame: null, localLooks: savedLocalLooks() });
            };
            $('demo-files').onchange = (e) => {
                const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/')).slice(0, 4);
                if (files.length) done(files.map((f) => URL.createObjectURL(f)));
            };
            $('demo-sample').onclick = () => done([samplePhoto(0), samplePhoto(1)]);
        });
    }
    function samplePhoto(i) {
        const c = document.createElement('canvas');
        c.width = 1200; c.height = 900;
        const g = c.getContext('2d');
        const sky = g.createLinearGradient(0, 0, 0, 900);
        sky.addColorStop(0, ['#8fb5d6', '#d6b48f'][i % 2]); sky.addColorStop(1, '#3a332d');
        g.fillStyle = sky; g.fillRect(0, 0, 1200, 900);
        g.fillStyle = '#d9a383'; g.beginPath(); g.ellipse(600, 400, 180, 230, 0, 0, Math.PI * 2); g.fill();
        const d = g.getImageData(0, 0, 1200, 900);
        for (let k = 0; k < d.data.length; k += 4) { const n = (Math.random() - 0.5) * 34; d.data[k] += n; d.data[k + 1] += n; d.data[k + 2] += n; }
        g.putImageData(d, 0, 0);
        g.fillStyle = '#2b211c'; g.beginPath(); g.ellipse(600, 230, 200, 100, 0, Math.PI, 0); g.fill();
        g.fillStyle = '#222'; g.beginPath(); g.ellipse(535, 360, 22, 13, 0, 0, Math.PI * 2); g.ellipse(665, 360, 22, 13, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#a5444a'; g.beginPath(); g.ellipse(600, 505, 55, 16, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#ece7df'; g.fillRect(360, 660, 480, 240);
        return c.toDataURL('image/jpeg', 0.92);
    }

    async function loadLooks(url) {
        let doc = null;
        if (!url && state.manifest && state.manifest.localLooks) doc = state.manifest.localLooks;
        if (url) {
            try { doc = await (await fetch(url, { cache: 'no-cache' })).json(); } catch (_) { doc = null; }
        }
        const builtins = window.LookEngine ? LookEngine.BUILTIN : [];
        const list = doc && Array.isArray(doc.looks) ? doc.looks
            : builtins.map((l) => ({ id: l.id, name: l.th, builtin: true, strength: 1 }));
        state.looks = [{ id: 'none', name: 'ธรรมดา', strength: 1 }].concat(list.filter((l) => l.id !== 'none'));
        const d = (doc && doc.defaults) || {};
        state.look = state.looks.some((l) => l.id === d.look) ? d.look : 'none';
        if (typeof d.smooth === 'number') state.smooth = d.smooth;
        if (typeof d.bright === 'number') state.bright = d.bright;
        if (typeof d.tone === 'number') state.tone = d.tone;
        state.strength = (state.looks.find((l) => l.id === state.look) || {}).strength ?? 1;
    }

    async function lutFor(id) {
        if (id === 'none') return null;
        if (state.lutCache.has(id)) return state.lutCache.get(id);
        const look = state.looks.find((l) => l.id === id);
        let lut = null;
        try {
            if (look && look.builtin) lut = LookEngine.builtinAtlas(id);
            else if (look && look.atlas) lut = LookEngine.atlasFromImage(await loadImage(look.atlas));
        } catch (e) { console.warn('look unavailable', id, e); }
        state.lutCache.set(id, lut);
        return lut;
    }

    // ------------------------------------------------------------ drawing
    function settings(lut) {
        if (state.showOriginal) return { lut: null, amount: 0, smooth: 0, bright: 0, tone: 0 };
        return { lut, amount: state.strength, smooth: state.smooth, bright: state.bright, tone: state.tone };
    }

    // One shot through the look, at a size good for `targetW x targetH` (cover). Returns a canvas (copy).
    function processed(image, look, targetW, targetH) {
        const iw = image.naturalWidth, ih = image.naturalHeight;
        const need = Math.max(targetW / iw, targetH / ih);
        const k = Math.min(1, need * 1.1, (renderer ? renderer.maxSize : 4096) / Math.max(iw, ih));
        const w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
        const out = document.createElement('canvas');
        out.width = w; out.height = h;
        const ctx = out.getContext('2d');
        if (renderer) ctx.drawImage(renderer.render(image, look, w, h), 0, 0);
        else ctx.drawImage(image, 0, 0, w, h);
        return out;
    }

    function slotPath(slot, w, h) {
        const engine = window.PhotoTemplateEngine;
        if (!engine || !slot.shape || slot.shape === 'rectangle') return null;
        if (slot.shape === 'stamp') return new Path2D(engine.stampGeometry(w, h).path);
        return new Path2D(engine.shapeSvgPath(slot.shape, w, h));
    }

    // Same placement as the kiosk's print (drawTemplateUnit): cover crop around the slot's focus point.
    function composeFrame(look, scale) {
        const f = state.manifest.frame;
        const W = Math.round(f.width * scale), H = Math.round(f.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(state.under, 0, 0, W, H);
        const engine = window.PhotoTemplateEngine;
        f.slots.slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0)).forEach((slot) => {
            const image = state.shots[(slot.index - 1) % state.shots.length];
            const w = slot.width * scale, h = slot.height * scale;
            const src = processed(image, look, w, h);
            ctx.save();
            ctx.translate(slot.x * scale + w / 2, slot.y * scale + h / 2);
            ctx.rotate(((slot.rotation || 0) * Math.PI) / 180);
            const path = slotPath(slot, w, h);
            if (path) { ctx.translate(-w / 2, -h / 2); ctx.clip(path); ctx.translate(w / 2, h / 2); }
            else { ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.clip(); }
            const crop = engine ? engine.getCoverCrop(src.width, src.height, w, h, slot.focusX, slot.focusY)
                : { x: 0, y: 0, width: src.width, height: src.height };
            ctx.drawImage(src, crop.x, crop.y, crop.width, crop.height, -w / 2, -h / 2, w, h);
            ctx.restore();
        });
        ctx.drawImage(state.over, 0, 0, W, H);
        return canvas;
    }

    function composeShot(look, maxEdge) {
        const image = state.shots[state.shot];
        const k = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
        return processed(image, look, image.naturalWidth * k, image.naturalHeight * k);
    }

    let drawToken = 0;
    async function draw() {
        const token = ++drawToken;
        const lut = await lutFor(state.look);
        if (token !== drawToken) return;
        const look = settings(lut);
        let out;
        if (state.mode === 'frame') {
            const f = state.manifest.frame;
            out = composeFrame(look, Math.min(1, PREVIEW_EDGE / Math.max(f.width, f.height)));
        } else {
            out = composeShot(look, PREVIEW_EDGE);
        }
        const preview = $('preview');
        preview.width = out.width; preview.height = out.height;
        preview.getContext('2d').drawImage(out, 0, 0);
    }
    let pending = 0;
    // A short timer rather than requestAnimationFrame: slider drags coalesce, and it still runs in a background tab.
    function redraw() { clearTimeout(pending); pending = setTimeout(() => draw(), 16); }

    async function exportBlob() {
        const look = settings(await lutFor(state.look));
        const canvas = state.mode === 'frame' ? composeFrame(look, 1) : composeShot(look, EXPORT_SHOT_EDGE);
        return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    }
    function fileName() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `memories_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.jpg`;
    }

    // ------------------------------------------------------------ UI
    function toast(text) {
        const el = $('toast');
        el.textContent = text;
        el.classList.add('show');
        clearTimeout(toast.t);
        toast.t = setTimeout(() => el.classList.remove('show'), 2200);
    }

    function buildUi() {
        // mode
        const modeEl = $('mode');
        if (!state.manifest.frame) modeEl.hidden = true;
        modeEl.querySelectorAll('button').forEach((b) => {
            b.classList.toggle('on', b.dataset.mode === state.mode);
            b.onclick = () => {
                state.mode = b.dataset.mode;
                modeEl.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
                $('shots').classList.toggle('show', state.mode === 'shot' && state.shots.length > 1);
                redraw();
            };
        });
        // shots
        const shotsEl = $('shots');
        state.shots.forEach((img, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = i === state.shot ? 'on' : '';
            const t = document.createElement('img');
            t.src = img.src;
            t.alt = `รูปที่ ${i + 1}`;
            b.appendChild(t);
            b.onclick = () => {
                state.shot = i;
                shotsEl.querySelectorAll('button').forEach((x, k) => x.classList.toggle('on', k === i));
                redraw();
            };
            shotsEl.appendChild(b);
        });
        shotsEl.classList.toggle('show', state.mode === 'shot' && state.shots.length > 1);

        // looks: thumbnails of the first shot through each look
        const looksEl = $('looks');
        state.looks.forEach((l) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'look' + (l.id === state.look ? ' on' : '');
            b.innerHTML = '<div class="thumb"></div><div class="name"></div>';
            b.querySelector('.name').textContent = l.name;
            b.onclick = () => selectLook(l.id);
            looksEl.appendChild(b);
            lutFor(l.id).then((lut) => {
                const thumb = processed(state.shots[0], { lut, amount: l.strength ?? 1, smooth: 0, bright: 0, tone: 0 }, 160, 160);
                b.querySelector('.thumb').appendChild(thumb);
            });
        });
        $('look-name').textContent = (state.looks.find((l) => l.id === state.look) || {}).name || '';

        // sliders
        const bind = (id, key, scale) => {
            const input = $(id), out = $(id + '-out');
            input.value = Math.round(state[key] * scale);
            out.textContent = input.value;
            input.oninput = () => { state[key] = Number(input.value) / scale; out.textContent = input.value; redraw(); };
        };
        bind('strength', 'strength', 100);
        bind('smooth', 'smooth', 100);
        bind('bright', 'bright', 100);
        bind('tone', 'tone', 100);
        $('strength-row').style.opacity = state.look === 'none' ? 0.4 : 1;

        // hold to compare with the original
        const stage = $('stage');
        const showOriginal = (on) => {
            if (state.showOriginal === on) return;
            state.showOriginal = on;
            stage.classList.toggle('showing-original', on);
            redraw();
        };
        stage.addEventListener('pointerdown', () => showOriginal(true));
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => stage.addEventListener(t, () => showOriginal(false)));
        stage.addEventListener('contextmenu', (e) => e.preventDefault());

        $('save').onclick = () => save(false);
        $('share').onclick = () => save(true);
        if (!navigator.share) $('share').hidden = true;
    }

    function selectLook(id) {
        state.look = id;
        const look = state.looks.find((l) => l.id === id) || {};
        state.strength = look.strength ?? 1;
        $('strength').value = Math.round(state.strength * 100);
        $('strength-out').textContent = $('strength').value;
        $('strength-row').style.opacity = id === 'none' ? 0.4 : 1;
        $('look-name').textContent = look.name || '';
        document.querySelectorAll('.look').forEach((b, i) => b.classList.toggle('on', state.looks[i].id === id));
        redraw();
    }

    async function save(share) {
        const buttons = [$('save'), $('share')];
        buttons.forEach((b) => { b.disabled = true; });
        try {
            const blob = await exportBlob();
            if (!blob) throw new Error('export');
            const file = new File([blob], fileName(), { type: 'image/jpeg' });
            // Phones: the share sheet has "Save image" (iPhone) / Photos / LINE / Instagram.
            if (navigator.canShare && navigator.canShare({ files: [file] }) && (share || /iPhone|iPad|Android/i.test(navigator.userAgent))) {
                try { await navigator.share({ files: [file], title: 'MEMORIES' }); return; }
                catch (e) { if (e && e.name === 'AbortError') return; }
            }
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = file.name;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
            toast('บันทึกรูปแล้ว');
        } catch (e) {
            console.error(e);
            toast('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง');
        } finally {
            buttons.forEach((b) => { b.disabled = false; });
        }
    }

    start();
})();
