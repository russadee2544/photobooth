/* ============================================================
   RETRO_SNAP — Shared JavaScript
   ============================================================ */

const SUPABASE_URL = 'https://zualrdvvlcoexqrbedhl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1YWxyZHZ2bGNvZXhxcmJlZGhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1MTYwMjMsImV4cCI6MjEwMDA5MjAyM30.1JgXhpQccIOxgFgvx_G7cBlnCkSiWQhEihUAd8xCyV8';
const SUPABASE_BUCKET = 'photobooth';

const Session = {
    set(key, val) {
        if (typeof window !== 'undefined') {
            window['_pb_mem_' + key] = val;
        }
        try {
            localStorage.setItem('pb_' + key, JSON.stringify(val));
        } catch (e) {
            console.warn('localStorage setItem failed for pb_' + key + ':', e);
        }
    },
    get(key) {
        try {
            const val = localStorage.getItem('pb_' + key);
            if (val) return JSON.parse(val);
        } catch (e) {}
        if (typeof window !== 'undefined' && window['_pb_mem_' + key] !== undefined) {
            return window['_pb_mem_' + key];
        }
        return null;
    },
    clear() {
        if (typeof window !== 'undefined') {
            Object.keys(window).forEach(k => {
                if (k.startsWith('_pb_mem_')) delete window[k];
            });
        }
        // Session data = everything NOT prefixed kiosk_/pb_lang/pb_camera_id.
        // Preserve ALL kiosk_* (operating mode, paper, printer config, branding, custom themes)
        // so admin settings survive idle-timeouts and new sessions.
        const keep = {};
        Object.keys(localStorage).forEach(k => {
            if (k.startsWith('kiosk_') || k === 'pb_lang' || k === 'pb_camera_id') {
                keep[k] = localStorage.getItem(k);
            }
        });
        localStorage.clear();
        Object.entries(keep).forEach(([k, v]) => localStorage.setItem(k, v));
    }
};

const Kiosk = {
    get mode() {
        const stored = localStorage.getItem('kiosk_mode') || 'event';
        return stored === 'normal' ? 'redeem' : stored;
    },
    set mode(v) { localStorage.setItem('kiosk_mode', v === 'normal' ? 'redeem' : v); },
    get eventName() { return localStorage.getItem('kiosk_event_name') || ''; },
    set eventName(v) { localStorage.setItem('kiosk_event_name', v); },
    get eventKeepFinalAssets() { return localStorage.getItem('kiosk_event_keep_assets') !== 'false'; },
    set eventKeepFinalAssets(v) { localStorage.setItem('kiosk_event_keep_assets', v ? 'true' : 'false'); },
    get paperMode() { return localStorage.getItem('kiosk_paper_mode') || 'photo4x6_dual'; },
    set paperMode(v) { localStorage.setItem('kiosk_paper_mode', v); },
    get boothKind() { return localStorage.getItem('kiosk_booth_kind') || 'receipt'; },
    set boothKind(v) { localStorage.setItem('kiosk_booth_kind', v); },
    get kioskId() { return localStorage.getItem('kiosk_id') || ''; },
    set kioskId(v) { localStorage.setItem('kiosk_id', String(v || '').trim()); },
    get packageId() { return localStorage.getItem('kiosk_package_id') || ''; },
    set packageId(v) { localStorage.setItem('kiosk_package_id', String(v || '').trim()); },
    get priceThb() { return Number(localStorage.getItem('kiosk_price_thb') || '10'); },
    set priceThb(v) { localStorage.setItem('kiosk_price_thb', String(Math.max(0, Number(v) || 0))); },
    get copiesPerSet() { return 2; }
};

['sessionId', 'layout', 'templateSchemaId', 'photos', 'raw_photos', 'template', 'result', 'dithered', 'colorCloudUrl', 'ditheredCloudUrl', 'filter', 'authorization', 'printJobId', 'renderMetrics'].forEach(key => {
    Object.defineProperty(Session, key, {
        get: function() { return this.get(key); },
        set: function(v) { this.set(key, v); }
    });
});

// ============================================================
// JSON TEMPLATE CATALOG
// One schema drives layout selection, capture count, previews and printing.
// The catalog is local-first so configured events keep working offline.
// ============================================================
const TEMPLATE_CATALOG_KEY = 'kiosk_template_catalog_v1';

const TemplateCatalog = {
    load() {
        const engine = window.PhotoTemplateEngine;
        if (!engine) return [];
        let stored = [];
        try {
            stored = JSON.parse(localStorage.getItem(TEMPLATE_CATALOG_KEY) || '[]');
        } catch (error) {
            console.warn('Template catalog could not be parsed; defaults will be used.', error);
        }
        const byId = new Map();
        engine.createDefaultTemplates().forEach(template => byId.set(template.templateId, template));
        if (Array.isArray(stored)) {
            stored.forEach(template => {
                const normalized = engine.normalizeTemplate(template);
                byId.set(normalized.templateId, normalized);
            });
        }
        return Array.from(byId.values());
    },
    save(templates) {
        const engine = window.PhotoTemplateEngine;
        if (!engine) throw new Error('Template engine is unavailable.');
        const normalized = (Array.isArray(templates) ? templates : [])
            .map(template => engine.normalizeTemplate(template));
        localStorage.setItem(TEMPLATE_CATALOG_KEY, JSON.stringify(normalized));
        return normalized;
    },
    upsert(template) {
        const engine = window.PhotoTemplateEngine;
        if (!engine) throw new Error('Template engine is unavailable.');
        const value = engine.normalizeTemplate(template);
        const catalog = this.load();
        const index = catalog.findIndex(item => item.templateId === value.templateId);
        if (index >= 0) catalog[index] = value;
        else catalog.push(value);
        this.save(catalog);
        return value;
    },
    remove(templateId) {
        const remaining = this.load().filter(template => template.templateId !== templateId);
        this.save(remaining);
        return remaining;
    },
    find(templateId) {
        return this.load().find(template => template.templateId === templateId) || null;
    },
    forLayout(layoutId, paperMode = Kiosk.paperMode) {
        const templates = this.load().filter(template => template.enabled && template.layoutId === layoutId);
        if (!templates.length) return null;
        const mode = paperMode || 'photo4x6_dual';
        let matched = templates.find(template => template.type === mode);
        if (!matched) {
            if (mode === 'photo4x6_postcard') {
                matched = templates.find(template => template.type === '4x6');
            } else if (mode.startsWith('thermal') || mode === 'photo2x6_single' || mode === 'photo4x6_dual') {
                matched = templates.find(template => template.type === mode || template.type === '2x6');
            } else if (mode === 'photo5x7') {
                matched = templates.find(template => template.type === 'photo5x7' || template.type === '2x6');
            }
        }
        return matched || templates[0];
    },
    current(layoutId = Session.layout, paperMode = Kiosk.paperMode) {
        const selected = Session.templateSchemaId ? this.find(Session.templateSchemaId) : null;
        if (selected && selected.enabled) return selected;
        return this.forLayout(layoutId || '3_1x1', paperMode);
    },
    requiredShots(layoutId = Session.layout) {
        const template = this.current(layoutId);
        if (template && template.slots.length) return template.slots.length;
        const engine = window.PhotoTemplateEngine;
        return engine ? engine.parseLayout(layoutId).count : (parseInt(layoutId, 10) || 3);
    }
};

// ============================================================
// INDEXEDDB STORAGE for large payloads (photos, composed result)
// localStorage quota (~5MB) is too small for 4 base64 photos +
// the composed strip + dithered PNG. Big payloads live in IDB.
// ============================================================
const PB_DB = (() => {
    const DB_NAME = 'photobooth';
    const STORE = 'kv';
    let dbPromise = null;

    function open() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) { reject(new Error('IndexedDB not supported')); return; }
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains(STORE)) {
                    req.result.createObjectStore(STORE);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return dbPromise;
    }

    async function set(key, val) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(val, key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }

    async function get(key) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function del(key) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }

    async function clear() {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).clear();
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }

    return { set, get, del, clear };
})();

// Async variants of Session for LARGE keys (photos / composed result).
// Primary: IndexedDB. Fallback: localStorage (for older cached sessions).
const SessionAsync = {
    // Large payloads that must NOT go through localStorage (quota)
    largeKeys: ['raw_photos', 'photos', 'result', 'dithered'],
    async set(key, val) {
        window['_pb_mem_' + key] = val;
        if (this.largeKeys.includes(key)) {
            await PB_DB.set(key, val).catch(e => console.warn('IDB set failed for', key, e));
            try { localStorage.setItem('pb_' + key, JSON.stringify(val)); }
            catch (e) { /* quota exceeded - IDB is the source of truth */ }
        } else {
            Session.set(key, val);
        }
    },
    async get(key) {
        if (this.largeKeys.includes(key)) {
            try {
                const idbVal = await PB_DB.get(key);
                if (idbVal !== undefined) { window['_pb_mem_' + key] = idbVal; return idbVal; }
            } catch (e) { console.warn('IDB get failed for', key, e); }
            const lsVal = Session.get(key);
            if (lsVal) return lsVal;
            return window['_pb_mem_' + key] !== undefined ? window['_pb_mem_' + key] : null;
        }
        return Session.get(key);
    },
    async remove(key) {
        if (typeof window !== 'undefined') delete window['_pb_mem_' + key];
        await PB_DB.del(key).catch(() => {});
        try { localStorage.removeItem('pb_' + key); } catch (e) {}
    },
    async clear() {
        await PB_DB.clear().catch(() => {});
        Session.clear();
    }
};

// ============================================================
// FINAL-ASSET RETENTION
// Production assets are handed only to the native bridge method whose contract
// is device-local encrypted storage (externalUpload is always false here).
// Browser IndexedDB retention exists only behind localhost ?demo=1.
// ============================================================
function isLocalPrototypeDemo() {
    const host = String(location.hostname || '').toLowerCase();
    return (host === 'localhost' || host === '127.0.0.1') &&
        new URLSearchParams(location.search).get('demo') === '1';
}

const PB_DEMO_ARCHIVE = (() => {
    const DB_NAME = 'photobooth_demo_archive';
    const STORE = 'final_assets';
    let dbPromise = null;

    function open() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(STORE)) {
                    request.result.createObjectStore(STORE, { keyPath: 'id' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        return dbPromise;
    }

    async function put(record) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(record);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }

    async function purgeExpired(now = Date.now()) {
        const db = await open();
        return new Promise((resolve, reject) => {
            let deleted = 0;
            const tx = db.transaction(STORE, 'readwrite');
            const request = tx.objectStore(STORE).openCursor();
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) return;
                const purgeAt = new Date(cursor.value.purgeAfter || 0).getTime();
                if (purgeAt > 0 && purgeAt <= now) {
                    cursor.delete();
                    deleted += 1;
                }
                cursor.continue();
            };
            tx.oncomplete = () => resolve(deleted);
            tx.onerror = () => reject(tx.error);
        });
    }

    async function listMetadata() {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const request = tx.objectStore(STORE).getAll();
            request.onsuccess = () => resolve((request.result || []).map(record => ({
                id: record.id,
                mode: record.mode,
                eventName: record.eventName,
                state: record.state,
                createdAt: record.createdAt,
                purgeAfter: record.purgeAfter
            })));
            request.onerror = () => reject(request.error);
        });
    }

    return { put, purgeExpired, listMetadata };
})();

async function retainCurrentFinalAssets({ printJobId = null } = {}) {
    const mode = Kiosk.mode;
    if (mode === 'event' && !Kiosk.eventKeepFinalAssets) {
        adminAuditLocal('asset.retention_skipped', { mode, reason: 'event_setting_disabled' });
        return { status: 'skipped' };
    }

    const colorDataUrl = (await SessionAsync.get('result')) || Session.result;
    const printDataUrl = (await SessionAsync.get('dithered')) || Session.dithered || colorDataUrl;
    if (!colorDataUrl || !printDataUrl) return { status: 'missing_assets' };

    const now = Date.now();
    const record = {
        id: Session.sessionId || crypto.randomUUID(),
        kioskId: Kiosk.kioskId,
        printJobId,
        mode,
        eventName: mode === 'event' ? Kiosk.eventName : null,
        state: mode === 'event' ? 'pending_event_export' : 'retained_until_purge',
        createdAt: new Date(now).toISOString(),
        purgeAfter: new Date(now + (mode === 'redeem' ? 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000)).toISOString(),
        colorDataUrl,
        printDataUrl
    };

    const bridge = window.PhotoboothDevice;
    if (bridge && typeof bridge.storeFinalAssetsLocally === 'function') {
        try {
            const result = await bridge.storeFinalAssetsLocally({
                ...record,
                externalUpload: false,
                rawPhotosIncluded: false
            });
            if (result && result.success) {
                adminAuditLocal('asset.retained_locally', {
                    assetId: result.assetId || record.id,
                    mode,
                    purgeAfter: record.purgeAfter
                });
                return { status: 'retained', assetId: result.assetId || record.id };
            }
            return { status: 'unavailable', error: (result && result.error) || 'local_archive_failed' };
        } catch (e) {
            console.error('Native final-asset retention failed:', e);
            return { status: 'unavailable', error: 'local_archive_failed' };
        }
    }

    if (isLocalPrototypeDemo()) {
        await PB_DEMO_ARCHIVE.put(record);
        adminAuditLocal('demo_asset.retained', {
            assetId: record.id,
            mode,
            purgeAfter: record.purgeAfter
        });
        return { status: 'retained_demo', assetId: record.id };
    }

    adminAuditLocal('asset.retention_unavailable', { mode, reason: 'native_bridge_missing' });
    return { status: 'unavailable', error: 'native_bridge_missing' };
}

async function purgeExpiredFinalAssets() {
    const bridge = window.PhotoboothDevice;
    if (bridge && typeof bridge.purgeExpiredFinalAssets === 'function') {
        try {
            return await bridge.purgeExpiredFinalAssets({ kioskId: Kiosk.kioskId });
        } catch (e) {
            console.error('Native asset purge failed:', e);
            return { success: false, error: 'native_purge_failed' };
        }
    }
    if (isLocalPrototypeDemo()) {
        const deleted = await PB_DEMO_ARCHIVE.purgeExpired();
        return { success: true, deleted, demo: true };
    }
    return { success: false, error: 'native_bridge_missing' };
}

async function getFinalAssetRetentionStatus() {
    const bridge = window.PhotoboothDevice;
    if (bridge && typeof bridge.finalAssetRetentionStatus === 'function') {
        return bridge.finalAssetRetentionStatus({ kioskId: Kiosk.kioskId });
    }
    if (isLocalPrototypeDemo()) {
        const records = await PB_DEMO_ARCHIVE.listMetadata();
        return { success: true, records, demo: true };
    }
    return { success: false, records: [], error: 'native_bridge_missing' };
}

const i18n = {
    "en": {
        "title": "Photo Booth",
        "cam_error": "Camera Error",
        "retake_btn": "Retake",
        "btn_process": "Process",
        "proc_title": "Processing Photos",
        "proc_desc": "Applying high-quality filters...",
        "print_title": "Your photos are ready.",
        "print_desc": "Your final photo is ready for printing.",
        "print_color": "Premium Color",
        "print_retro": "Retro Edition",
        "btn_finish": "Finish",
        "btn_print": "Print Receipt",
        "uploading": "Uploading to Cloud...",
        "brand": "MEMORIES",
        "home_subtitle": "Premium digital photo booth experience.",
        "home_start": "Tap to Start",
        "btn_back": "BACK",
        "layout_title": "Choose Your Layout",
        "layout_desc": "Select a frame style that matches your mood.",
        "layout_1": "1 Frame",
        "layout_2": "2 Frames",
        "layout_3": "3 Frames",
        "layout_4": "4 Frames",
        "btn_continue": "Continue",
        "btn_cancel": "CANCEL",
        "tpl_title": "Choose Frame",
        "tpl_desc": "Select a frame style that matches your mood.",
        "tpl_light": "Classic Y2K",
        "tpl_light_sub": "Minimalist Monochrome",
        "tpl_dark": "Retro Ticket",
        "tpl_dark_sub": "Receipt Style",
        "tpl_mint": "Web Browser",
        "tpl_mint_sub": "Mac OS Window",
        "tpl_blue": "Music Player",
        "tpl_blue_sub": "Retro MP3",
        "tpl_exhibition": "Exhibition",
        "tpl_exhibition_sub": "Ticket Style"
    },
    "th": {
        "title": "โฟโต้บูธ",
        "cam_error": "กล้องมีปัญหา",
        "retake_btn": "ถ่ายใหม่",
        "btn_process": "ประมวลผล",
        "proc_title": "กำลังประมวลผลรูปภาพ",
        "proc_desc": "กำลังใส่ฟิลเตอร์คุณภาพสูง...",
        "print_title": "รูปภาพของคุณพร้อมแล้ว",
        "print_desc": "ภาพสุดท้ายพร้อมสำหรับการพิมพ์แล้ว",
        "print_color": "ภาพสีพรีเมียม",
        "print_retro": "ภาพเรโทร",
        "btn_finish": "เสร็จสิ้น",
        "btn_print": "พิมพ์ใบเสร็จ",
        "uploading": "กำลังอัปโหลด...",
        "brand": "MEMORIES",
        "home_subtitle": "ตู้ถ่ายภาพดิจิทัลระดับพรีเมียม",
        "home_start": "แตะเพื่อเริ่มต้น",
        "btn_back": "กลับ",
        "layout_title": "เลือกรูปแบบ",
        "layout_desc": "เลือกสไตล์กรอบที่เข้ากับอารมณ์ของคุณ",
        "layout_1": "1 รูป",
        "layout_2": "2 รูป",
        "layout_3": "3 รูป",
        "layout_4": "4 รูป",
        "btn_continue": "ดำเนินการต่อ",
        "btn_cancel": "ยกเลิก",
        "tpl_title": "เลือกกรอบรูป",
        "tpl_desc": "เลือกสไตล์กรอบที่เข้ากับอารมณ์ของคุณ",
        "tpl_light": "คลาสสิก Y2K",
        "tpl_light_sub": "มินิมอลขาวดำ",
        "tpl_dark": "เรโทรทิคเก็ต",
        "tpl_dark_sub": "สไตล์ใบเสร็จ",
        "tpl_mint": "เว็บเบราว์เซอร์",
        "tpl_mint_sub": "หน้าต่าง Mac OS",
        "tpl_blue": "เครื่องเล่นเพลง",
        "tpl_blue_sub": "เรโทร MP3",
        "tpl_exhibition": "นิทรรศการ",
        "tpl_exhibition_sub": "สไตล์ตั๋วงาน"
    }
};

function setLanguage(lang) {
    localStorage.setItem('pb_lang', lang);
    applyLanguage();
}

function getLanguage() {
    return localStorage.getItem('pb_lang') || 'th';
}

function applyLanguage() {
    const lang = getLanguage();
    const dict = i18n[lang] || i18n['th'];
    
    document.querySelectorAll('.lang-btn').forEach(btn => {
        if (btn.dataset.lang === lang) {
            btn.classList.add('text-gray-900', 'font-bold');
            btn.classList.remove('text-gray-400');
        } else {
            btn.classList.remove('text-gray-900', 'font-bold');
            btn.classList.add('text-gray-400');
        }
    });

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) {
            if (el.children.length > 0) {
                for (let i = 0; i < el.childNodes.length; i++) {
                    if (el.childNodes[i].nodeType === 3 && el.childNodes[i].nodeValue.trim().length > 0) {
                        el.childNodes[i].nodeValue = dict[key] + ' ';
                        break;
                    }
                }
            } else {
                el.innerText = dict[key];
            }
        }
    });
}

// Call applyLanguage on load to ensure UI starts with correct language
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        applyLanguage();
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(err => {
                console.warn('SW registration failed:', err);
            });
        }
    });
}


class IdleTimer {
    constructor(timeoutMs, redirectUrl, warningMs = 30000) {
        // Phase 1 contract: two minutes idle with a warning during the last 30 seconds.
        this.timeoutMs = Math.max(Number(timeoutMs) || 120000, 120000);
        this.warningMs = Math.min(Number(warningMs) || 30000, this.timeoutMs);
        this.redirectUrl = redirectUrl;
        this.timer = null;
        this.warningTimer = null;
        this._onActivity = this.reset.bind(this);
    }
    start() {
        ['pointerdown', 'mousemove', 'keydown'].forEach(evt => {
            document.addEventListener(evt, this._onActivity, { passive: true });
        });
        this.reset();
    }
    reset() {
        clearTimeout(this.timer);
        clearTimeout(this.warningTimer);
        this.hideWarning();
        this.warningTimer = setTimeout(() => this.showWarning(), this.timeoutMs - this.warningMs);
        this.timer = setTimeout(async () => {
            await SessionAsync.clear();
            window.location.replace(this.redirectUrl);
        }, this.timeoutMs);
    }
    showWarning() {
        let overlay = document.getElementById('pb-idle-warning');
        if (!overlay) {
            overlay = document.createElement('button');
            overlay.type = 'button';
            overlay.id = 'pb-idle-warning';
            overlay.className = 'pb-idle-warning';
            overlay.innerHTML = `
                <span class="pb-idle-warning__card">
                    <strong data-idle-title>ยังใช้งานอยู่ไหม?</strong>
                    <small data-idle-message>แตะหน้าจอเพื่อใช้งานต่อ ระบบจะล้างรูปเมื่อหมดเวลา</small>
                </span>`;
            overlay.addEventListener('click', this._onActivity);
            document.body.appendChild(overlay);
        }
        const isEnglish = getLanguage() === 'en';
        overlay.querySelector('[data-idle-title]').textContent = isEnglish ? 'Are you still there?' : 'ยังใช้งานอยู่ไหม?';
        overlay.querySelector('[data-idle-message]').textContent = isEnglish
            ? 'Tap the screen to continue. Session photos will be cleared when time runs out.'
            : 'แตะหน้าจอเพื่อใช้งานต่อ ระบบจะล้างรูปเมื่อหมดเวลา';
        overlay.classList.add('is-visible');
    }
    hideWarning() {
        const overlay = document.getElementById('pb-idle-warning');
        if (overlay) overlay.classList.remove('is-visible');
    }
    stop() {
        clearTimeout(this.timer);
        clearTimeout(this.warningTimer);
        this.hideWarning();
        ['pointerdown', 'mousemove', 'keydown'].forEach(evt => {
            document.removeEventListener(evt, this._onActivity);
        });
    }
}

// ============================================================
// ESC/POS PRINTER (WebUSB) - real printer output for thermal modes
// ============================================================
const ESC_POS = {
    // Printer dot widths per paper mode (common 58mm/80mm/100mm heads)
    dotWidth: { thermal58: 384, thermal80: 576, thermal100: 832 },
    // Max printable dots (head height) - keep conservative for roll printers
    maxHeightDots: 40000,

    // Convert a canvas (dithered B&W preferred) to a monochrome raster
    // scaled to target printer width. Returns { dotsPerLine, bytes, width, height }
    rasterize(canvas, targetWidth) {
        const srcW = canvas.width, srcH = canvas.height;
        const scale = targetWidth / srcW;
        const outW = Math.round(srcW * scale);
        const outH = Math.round(srcH * scale);
        // floor to byte boundary per line
        const paddedW = Math.ceil(outW / 8) * 8;

        const tmp = document.createElement('canvas');
        tmp.width = outW;
        tmp.height = outH;
        const ctx = tmp.getContext('2d');
        ctx.drawImage(canvas, 0, 0, outW, outH);
        const imgData = ctx.getImageData(0, 0, outW, outH);
        const d = imgData.data;

        const bytesPerLine = paddedW / 8;
        const data = new Uint8Array(outH * bytesPerLine);
        for (let y = 0; y < outH; y++) {
            for (let x = 0; x < outW; x++) {
                const lum = (d[(y * outW + x) * 4] * 0.299 +
                            d[(y * outW + x) * 4 + 1] * 0.587 +
                            d[(y * outW + x) * 4 + 2] * 0.114);
                // thermal printers burn the dot -> "dark pixel" = 0 bit
                if (lum < 128) {
                    const byteIdx = y * bytesPerLine + (x >> 3);
                    data[byteIdx] |= (0x80 >> (x & 7));
                }
            }
        }
        return { width: outW, height: outH, paddedW, bytesPerLine, data };
    },

    // Build full ESC/POS byte payload for raster bit image (GS v 0)
    buildPayload(canvas, paperMode, copies = 1) {
        const width = this.dotWidth[paperMode] || 384;
        const raster = this.rasterize(canvas, width);
        const bytesPerLine = raster.bytesPerLine;
        const xL = bytesPerLine & 0xFF, xH = (bytesPerLine >> 8) & 0xFF;
        const yL = raster.height & 0xFF, yH = (raster.height >> 8) & 0xFF;

        const header = [0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH];
        const chunk = new Uint8Array(header.length + raster.data.length);
        chunk.set(header, 0);
        chunk.set(raster.data, header.length);

        // Compose final payload: init + [raster + feed + cut] for each copy.
        // Each receipt is physically separated by the auto cutter.
        const init = [0x1B, 0x40];
        const feed = [0x1D, 0x64, 0x03];  // feed 3 dots... use GS L 3 lines
        const cut = [0x1D, 0x56, 0x41, 0x30]; // partial cut
        let totalLen = init.length + copies * (chunk.length + feed.length + cut.length);
        const out = new Uint8Array(totalLen);
        let off = 0;
        out.set(init, off); off += init.length;
        for (let i = 0; i < copies; i++) {
            out.set(chunk, off); off += chunk.length;
            out.set(feed, off); off += feed.length;
            out.set(cut, off); off += cut.length;
        }
        return out;
    }
};

const USBPrinter = {
    connected: null,
    endpoint: null,
    async connect() {
        if (this.connected) return this.connected;
        if (!('usb' in navigator)) throw new Error('WebUSB not supported');
        const device = await navigator.usb.requestDevice({ filters: [] });
        await device.open();
        // Claim first interface with a bulk OUT endpoint
        let endpoint = null;
        for (const config of device.configurations) {
            for (const iface of config.interfaces) {
                if (iface.alternate) { try { await device.selectAlternateInterface(iface.interfaceNumber, 0); } catch (e) {} }
                for (const ep of iface.endpoints) {
                    if (ep.direction === 'out' && ep.type === 'bulk') { endpoint = ep.endpointNumber; break; }
                }
                if (endpoint) { await device.claimInterface(iface.interfaceNumber); break; }
            }
            if (endpoint) break;
        }
        if (!endpoint) throw new Error('No bulk OUT endpoint found');
        this.connected = device;
        this.endpoint = endpoint;
        return device;
    },
    async send(bytes) {
        const device = this.connected || await this.connect();
        await device.transferOut(this.endpoint, bytes);
    },
    async disconnect() {
        if (this.connected) { try { await this.connected.close(); } catch (e) {} }
        this.connected = null;
        this.endpoint = null;
    }
};

// Print the dithered result to a real thermal printer via WebUSB.
// Falls back to the browser print dialog if WebUSB is unavailable/denied.
async function printViaUSB(paperMode, copies = 1) {
    if (!ESC_POS.dotWidth[paperMode]) throw new Error('Paper mode not supported by ESC/POS');
    const ditheredCanvas = await dataUrlToCanvas(Session.dithered || Session.result);
    const payload = ESC_POS.buildPayload(ditheredCanvas, paperMode, copies);
    await USBPrinter.connect();
    await USBPrinter.send(payload);
}

// Unified adapter used by the unchanged Prototype print page. The production
// Android bridge handles LAN/USB ESC/POS; WebUSB remains a desktop fallback.
// Ambiguous outcomes are returned to Admin and are never retried automatically.
async function printReceiptSet({ dataUrl, paperMode = 'thermal80', jobId }) {
    const copies = 2;
    if (!dataUrl) throw new Error('Missing printable asset');

    if (window.PhotoboothPrinter && typeof window.PhotoboothPrinter.printReceiptSet === 'function') {
        const nativeResult = await window.PhotoboothPrinter.printReceiptSet({
            jobId,
            dataUrl,
            paperMode,
            copies,
            cutEachCopy: true
        });
        if (!nativeResult || !['completed', 'ambiguous', 'failed'].includes(nativeResult.status)) {
            return { status: 'ambiguous', error: 'invalid_native_response' };
        }
        return nativeResult;
    }

    const config = JSON.parse(localStorage.getItem('kiosk_printer_config') || '{}');
    if (config.conn === 'usb' && paperMode.startsWith('thermal')) {
        try {
            await printViaUSB(paperMode, copies);
            return { status: 'completed', copiesCompleted: 2, transport: 'webusb' };
        } catch (error) {
            return { status: 'ambiguous', error: error && error.message ? error.message : 'webusb_failed' };
        }
    }

    return { status: 'simulator', copiesCompleted: 0, transport: 'simulator' };
}

function dataUrlToCanvas(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.width; c.height = img.height;
            c.getContext('2d').drawImage(img, 0, 0);
            resolve(c);
        };
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = dataUrl;
    });
}

function floydSteinbergDither(imageData) {
    const { data, width, height } = imageData;
    const gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        gray[i] = 0.299 * data[i*4] + 0.587 * data[i*4+1] + 0.114 * data[i*4+2];
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
    return imageData;
}

// Run Floyd-Steinberg dithering off the main thread via a Web Worker.
// Falls back to synchronous processing when workers are unavailable.
let ditherWorker = null;
function ditherImageData(imageData) {
    return new Promise((resolve) => {
        if (ditherWorker === null && typeof Worker !== 'undefined') {
            try {
                ditherWorker = new Worker('/dither-worker.js');
            } catch (e) { ditherWorker = false; }
        }
        if (ditherWorker) {
            const buffer = imageData.data.buffer.slice(0);
            const w = imageData.width, h = imageData.height;
            ditherWorker.onmessage = (e) => {
                resolve(new ImageData(new Uint8ClampedArray(e.data.buffer), e.data.width, e.data.height));
            };
            ditherWorker.onerror = () => { ditherWorker = false; resolve(floydSteinbergDither(imageData)); };
            ditherWorker.postMessage({ width: w, height: h, buffer }, [buffer]);
        } else {
            resolve(floydSteinbergDither(imageData));
        }
    });
}

function getCoverCrop(image, targetWidth, targetHeight, focusX = 0.5, focusY = 0.42) {
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    const imageRatio = imageWidth / imageHeight;
    const targetRatio = targetWidth / targetHeight;
    let width = imageWidth;
    let height = imageHeight;

    if (imageRatio > targetRatio) width = imageHeight * targetRatio;
    else height = imageWidth / targetRatio;

    const x = Math.max(0, Math.min(imageWidth - width, (imageWidth * focusX) - (width / 2)));
    const y = Math.max(0, Math.min(imageHeight - height, (imageHeight * focusY) - (height / 2)));
    return { x, y, width, height };
}

function composeStrip(photos, templateName, outputWidth = 600, customThemeObj = null, layoutStr = '3_1x1', layoutSize = null) {
    const photoCount = photos.length;
    const scale = outputWidth / 600;
    
    // Paper width = 80mm (8cm) = outputWidth (1200px at scale 2)
    // 1cm = 150px (at scale 2). So at scale 1, 1cm = 75px.
    // 5cm = 375px at scale 1 (750px at scale 2)
    // 2.5cm = 187.5px at scale 1 (375px at scale 2)
    let pt = 48 * scale; // compact header area
    let pb = 92 * scale; // footer / branding area
    let px = 24 * scale; // padding x (left/right)
    let ps = 16 * scale; // photo spacing

    // Admin-configured Layout Sizes (physical cm) are honored for the strip dimensions
    let forcedHeight = null;
    if (layoutSize && layoutSize.width_cm && layoutSize.height_cm) {
        const pxPerCm = outputWidth / layoutSize.width_cm;
        pt = 0.45 * pxPerCm;
        pb = 0.75 * pxPerCm;
        px = 0.32 * pxPerCm;
        ps = 0.21 * pxPerCm;
        // Thermal paper should end after its content. Only fixed photo media
        // needs to preserve the configured physical height.
        if (Kiosk.paperMode === 'photo2x6_single' || Kiosk.paperMode === 'photo5x7') {
            forcedHeight = Math.round(layoutSize.height_cm * pxPerCm);
        }
    }
    
    let bg = '#FFFFFF';
    let text = '#000000';
    let border = '#000000';

    if (customThemeObj) {
        if (customThemeObj.theme_type === 'text') {
            bg = customThemeObj.bg_color || '#FFFFFF';
            text = customThemeObj.text_color || '#000000';
        }
    } else if (templateName === 'dark') {
        bg = '#F9F9F9';
    } else if (templateName === 'mint') {
        px = 30 * scale; // a bit more padding inside window
    } else if (templateName === 'exhibition') {
        px = 30 * scale;
        ps = 20 * scale;
    }

    const availableWidth = outputWidth - px * 2;
    let photoWidth, photoHeight, totalHeight;
    let coords = [];

    let ratio = '1x1';
    let countStr = String(photoCount);
    if (layoutStr && layoutStr.includes('_')) {
        const parts = layoutStr.split('_');
        countStr = parts[0];
        ratio = parts[1];
    }
    const count = parseInt(countStr, 10) || photoCount;

    if (count === 1 || count === 2 || count === 3) {
        photoWidth = availableWidth;
        if (ratio === '16x9') {
            photoHeight = Math.round(photoWidth * (9/16));
        } else {
            photoHeight = Math.round(photoWidth * (4/3)); // 3:4
        }
        if (forcedHeight) {
            const availH = forcedHeight - pt - pb - (ps * (count - 1));
            if (photoHeight > 0 && availH / count < photoHeight) {
                photoHeight = Math.max(1, Math.floor(availH / count));
                photoWidth = ratio === '16x9' ? Math.round(photoHeight * (16/9)) : Math.round(photoHeight * (3/4));
            }
            totalHeight = forcedHeight;
        } else {
            totalHeight = pt + pb + (photoHeight * count) + (ps * (count - 1));
        }
        
        const centeredX = Math.round((outputWidth - photoWidth) / 2);
        for (let i = 0; i < count; i++) {
            coords.push({ x: centeredX, y: pt + i * (photoHeight + ps) });
        }
    } else if (count === 4) {
        photoWidth = availableWidth; // In dynamic roll, 4 photos stack full width or 2x2 grid
        if (ratio === '16x9') {
            photoHeight = Math.round(photoWidth * (9/16));
        } else {
            photoHeight = Math.round(photoWidth * (4/3)); // 3:4
        }
        if (forcedHeight) {
            const availH = forcedHeight - pt - pb - (ps * (count - 1));
            if (photoHeight > 0 && availH / count < photoHeight) {
                photoHeight = Math.max(1, Math.floor(availH / count));
                photoWidth = ratio === '16x9' ? Math.round(photoHeight * (16/9)) : Math.round(photoHeight * (3/4));
            }
            totalHeight = forcedHeight;
        } else {
            totalHeight = pt + pb + (photoHeight * count) + (ps * (count - 1));
        }

        const centeredX = Math.round((outputWidth - photoWidth) / 2);
        for (let i = 0; i < count; i++) {
            coords.push({ x: centeredX, y: pt + i * (photoHeight + ps) });
        }

        const gridX = Math.round((outputWidth - ((photoWidth * 2) + ps)) / 2);
        coords.push({ x: gridX, y: pt }); // Top-Left
        coords.push({ x: gridX + photoWidth + ps, y: pt }); // Top-Right
        coords.push({ x: gridX, y: pt + photoHeight + ps }); // Bottom-Left
        coords.push({ x: gridX + photoWidth + ps, y: pt + photoHeight + ps }); // Bottom-Right
    } else {
        photoWidth = availableWidth;
        photoHeight = photoWidth;
        if (forcedHeight) {
            const availH = forcedHeight - pt - pb - (ps * (count - 1));
            photoHeight = Math.max(1, Math.floor(availH / count));
            totalHeight = forcedHeight;
        } else {
            totalHeight = pt + pb + (photoHeight * count) + (ps * (count - 1));
        }
        for (let i = 0; i < count; i++) {
            coords.push({ x: px, y: pt + i * (photoHeight + ps) });
        }
    }

    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, outputWidth, totalHeight);

    return new Promise((resolve) => {
        let loaded = 0;
        const images = [];

        if (photos.length === 0) {
            // Draw placeholder
            ctx.fillStyle = text;
            ctx.font = `500 ${18*scale}px "Inter", "Prompt", sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('NO PHOTOS', outputWidth / 2, totalHeight / 2);
            resolve(canvas);
            return;
        }

        photos.forEach((src, i) => {
            const img = new Image();
            img.onload = () => {
                images[i] = img;
                checkLoaded();
            };
            img.onerror = () => {
                images[i] = null;
                checkLoaded();
            };
            
            function checkLoaded() {
                loaded++;
                if (loaded === photos.length) {
                    (async () => {
                    images.forEach((im, idx) => {
                        if (idx >= coords.length) return;
                        const { x, y } = coords[idx];
                        
                        if (!im) return;
                        
                        // Crop Image to fill photoWidth and photoHeight exactly (cover)
                        const crop = getCoverCrop(im, photoWidth, photoHeight);

                        // Photo
                        ctx.drawImage(im, crop.x, crop.y, crop.width, crop.height, x, y, photoWidth, photoHeight);
                        
                        // Thin inner black border around photo for graphic pop
                        ctx.strokeStyle = '#000000';
                        ctx.lineWidth = 1 * scale;
                        ctx.strokeRect(x, y, photoWidth, photoHeight);
                    });

                    // ==========================================
                    // DRAW TEMPLATE GRAPHICS
                    // ==========================================
                    
                    ctx.fillStyle = text;
                    ctx.textAlign = 'center';

                    if (templateName === 'light') {
                        // Classic Y2K text
                        ctx.font = `800 ${18*scale}px "Inter", "Prompt", sans-serif`;
                        ctx.fillText('MEMORIES', outputWidth / 2, totalHeight - pb / 2);
                        const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '.');
                        ctx.font = `500 ${10*scale}px "Inter", "Prompt", sans-serif`;
                        ctx.fillStyle = '#666666';
                        ctx.fillText(dateStr, outputWidth / 2, totalHeight - pb / 2 + 16*scale);
                        
                        // Draw a tiny black border around the whole strip
                        ctx.strokeStyle = '#000000';
                        ctx.lineWidth = 2 * scale;
                        ctx.strokeRect(0, 0, outputWidth, totalHeight);
                    } 
                    else if (templateName === 'dark') {
                        // Retro Ticket (Receipt)
                        
                        // Top Box
                        ctx.fillStyle = '#000000';
                        ctx.fillRect(px, 20*scale, availableWidth, 44*scale);
                        ctx.fillStyle = '#FFFFFF';
                        ctx.font = `800 ${22*scale}px "Inter", "Prompt", sans-serif`;
                        ctx.fillText('MEMORIES', outputWidth / 2, 20*scale + 30*scale);
                        
                        // Date above photos
                        ctx.fillStyle = '#000000';
                        ctx.font = `500 ${10*scale}px "Inter", "Prompt", sans-serif`;
                        ctx.textAlign = 'right';
                        const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
                        ctx.fillText(dateStr, outputWidth - px, 20*scale + 44*scale + 16*scale);
                        ctx.textAlign = 'left';
                        ctx.fillText('TICKET NO. 001', px, 20*scale + 44*scale + 16*scale);
                        
                        // Dashed lines
                        ctx.strokeStyle = '#000000';
                        ctx.lineWidth = 1.5 * scale;
                        ctx.setLineDash([6*scale, 6*scale]);
                        ctx.beginPath();
                        ctx.moveTo(px, totalHeight - pb + 20*scale);
                        ctx.lineTo(outputWidth - px, totalHeight - pb + 20*scale);
                        ctx.stroke();
                        ctx.setLineDash([]);
                        
                        // Barcode at bottom
                        ctx.fillStyle = '#000000';
                        for(let bx = px; bx < outputWidth - px; bx += (Math.random() * 4 + 2) * scale) {
                            ctx.fillRect(bx, totalHeight - pb + 40*scale, (Math.random() * 3 + 1)*scale, 40*scale);
                        }

                        // Outer border
                        ctx.strokeStyle = '#000000';
                        ctx.lineWidth = 2 * scale;
                        ctx.strokeRect(0, 0, outputWidth, totalHeight);
                    }
                    else if (templateName === 'mint') {
                        // Web Browser
                        
                        // Outer border (Rounded)
                        ctx.strokeStyle = '#000000';
                        ctx.lineWidth = 3 * scale;
                        if (ctx.roundRect) {
                            ctx.beginPath();
                            ctx.roundRect(10*scale, 10*scale, outputWidth - 20*scale, totalHeight - 20*scale, 10*scale);
                            ctx.stroke();
                        } else {
                            ctx.strokeRect(10*scale, 10*scale, outputWidth - 20*scale, totalHeight - 20*scale); // fallback
                        }
                        
                        // Header line
                        ctx.beginPath();
                        ctx.moveTo(10*scale, 40*scale);
                        ctx.lineTo(outputWidth - 10*scale, 40*scale);
                        ctx.stroke();
                        
                        // 3 Dots
                        const dotColors = ['#000000', '#000000', '#000000']; // Monochrome Mac dots
                        dotColors.forEach((color, i) => {
                            ctx.fillStyle = '#FFFFFF'; // White fill
                            ctx.beginPath();
                            ctx.arc(25*scale + i*16*scale, 25*scale, 4.5*scale, 0, Math.PI*2);
                            ctx.fill();
                            ctx.strokeStyle = '#000000';
                            ctx.lineWidth = 1.5 * scale;
                            ctx.stroke();
                        });
                        
                        // URL
                        ctx.fillStyle = '#000000';
                        ctx.font = `600 ${10*scale}px "Inter", "Prompt", sans-serif`;
                        ctx.textAlign = 'center';
                        ctx.fillText('memories.com', outputWidth / 2, 28*scale);
                        
                        // Footer text
                        ctx.font = `500 ${12*scale}px "Inter", "Prompt", sans-serif`;
                        ctx.fillText('captured moments.', outputWidth / 2, totalHeight - 22*scale);
                    }
                    else if (templateName === 'blue') {
                        // Music Player
                        
                        // Outer border
                        ctx.strokeStyle = '#000000';
                        ctx.lineWidth = 2 * scale;
                        ctx.strokeRect(0, 0, outputWidth, totalHeight);

                        // Header
                        ctx.fillStyle = '#000000';
                        ctx.font = `600 ${14*scale}px "Inter", "Prompt", sans-serif`;
                        ctx.textAlign = 'center';
                        ctx.fillText('NOW PLAYING', outputWidth / 2, 26*scale);
                        
                        // Footer UI
                        const footerY = totalHeight - pb + 20*scale;
                        
                        // Title
                        ctx.font = `800 ${18*scale}px "Inter", "Prompt", sans-serif`;
                        ctx.textAlign = 'left';
                        ctx.fillText('Memories', px, footerY + 16*scale);
                        ctx.font = `400 ${12*scale}px "Inter", "Prompt", sans-serif`;
                        ctx.fillStyle = '#666666';
                        ctx.fillText('You', px, footerY + 32*scale);
                        
                        // Heart icon (manual draw for perfect scaling)
                        ctx.fillStyle = '#000000';
                        const hSize = 14 * scale;
                        const hx = outputWidth - px - hSize/2;
                        const hy = footerY + 10*scale;
                        ctx.beginPath();
                        ctx.moveTo(hx, hy + hSize/4);
                        ctx.bezierCurveTo(hx, hy, hx - hSize/2, hy, hx - hSize/2, hy + hSize/4);
                        ctx.bezierCurveTo(hx - hSize/2, hy + hSize/2, hx, hy + hSize*3/4, hx, hy + hSize);
                        ctx.bezierCurveTo(hx, hy + hSize*3/4, hx + hSize/2, hy + hSize/2, hx + hSize/2, hy + hSize/4);
                        ctx.bezierCurveTo(hx + hSize/2, hy, hx, hy, hx, hy + hSize/4);
                        ctx.fill();
                        
                        // Progress bar
                        ctx.strokeStyle = '#E0E0E0';
                        ctx.lineWidth = 4 * scale;
                        ctx.lineCap = 'round';
                        ctx.beginPath();
                        ctx.moveTo(px, footerY + 50*scale);
                        ctx.lineTo(outputWidth - px, footerY + 50*scale);
                        ctx.stroke();
                        
                        ctx.strokeStyle = '#000000';
                        ctx.beginPath();
                        ctx.moveTo(px, footerY + 50*scale);
                        ctx.lineTo(px + (availableWidth * 0.3), footerY + 50*scale);
                        ctx.stroke();
                        
                        ctx.beginPath();
                        ctx.arc(px + (availableWidth * 0.3), footerY + 50*scale, 6*scale, 0, Math.PI*2);
                        ctx.fill();
                        
                        // Time text
                        ctx.fillStyle = '#000000';
                        ctx.font = `400 ${10*scale}px "Inter", "Prompt", sans-serif`;
                        ctx.textAlign = 'left';
                        ctx.fillText('0:58', px, footerY + 68*scale);
                        ctx.textAlign = 'right';
                        ctx.fillText('3:14', outputWidth - px, footerY + 68*scale);
                        
                        // Play controls (Manual drawing)
                        // Play/Pause (2 bars)
                        ctx.fillRect(outputWidth/2 - 4*scale, footerY + 52*scale, 3*scale, 14*scale);
                        ctx.fillRect(outputWidth/2 + 2*scale, footerY + 52*scale, 3*scale, 14*scale);

                        // Skip Back
                        ctx.beginPath();
                        ctx.moveTo(outputWidth/2 - 20*scale, footerY + 59*scale);
                        ctx.lineTo(outputWidth/2 - 30*scale, footerY + 52*scale);
                        ctx.lineTo(outputWidth/2 - 30*scale, footerY + 66*scale);
                        ctx.fill();
                        ctx.fillRect(outputWidth/2 - 32*scale, footerY + 52*scale, 2*scale, 14*scale);

                        // Skip Forward
                        ctx.beginPath();
                        ctx.moveTo(outputWidth/2 + 20*scale, footerY + 59*scale);
                        ctx.lineTo(outputWidth/2 + 30*scale, footerY + 52*scale);
                        ctx.lineTo(outputWidth/2 + 30*scale, footerY + 66*scale);
                        ctx.fill();
                        ctx.fillRect(outputWidth/2 + 32*scale, footerY + 52*scale, 2*scale, 14*scale);
                    }

                    
                    // ==========================================
                    // CUSTOM THEMES
                    // ==========================================
                    if (customThemeObj) {
                        if (customThemeObj.theme_type === 'text') {
                            ctx.fillStyle = text;
                            ctx.textAlign = 'center';
                            
                            // Header
                            if (customThemeObj.header_text) {
                                ctx.font = `700 ${20*scale}px "Inter", "Prompt", sans-serif`;
                                ctx.fillText(customThemeObj.header_text, outputWidth / 2, pt / 2 + 8*scale);
                            }
                            
                            // Footer
                            if (customThemeObj.footer_text) {
                                ctx.font = `600 ${16*scale}px "Inter", "Prompt", sans-serif`;
                                ctx.fillText(customThemeObj.footer_text, outputWidth / 2, totalHeight - pb / 2 + 6*scale);
                            }
                            
                            // Thin border
                            ctx.strokeStyle = '#000000';
                            ctx.lineWidth = 1 * scale;
                            ctx.strokeRect(0, 0, outputWidth, totalHeight);
                        }
                    }

                    // ==========================================
                    // THEME BRANDING (Overrides Top/Bottom text)
                    // ==========================================
                    const gBrand = JSON.parse(localStorage.getItem('kiosk_branding_' + templateName) || '{}');

                    const applyBrandingAndResolve = async () => {
                        // Helper for multiline text
                        const drawMultilineBrandingText = (ctx, text, areaX, areaY, areaWidth, areaHeight, options) => {
                            if (!text) return;
                            const { font = 'Inter', size = 24, color = '#000000', bold = false, italic = false, align = 'center', scale = 1 } = options;

                            const fontWeight = bold ? 'bold' : 'normal';
                            const fontStyle = italic ? 'italic' : 'normal';
                            const computedSize = Number(size) * scale;
                            const lineHeight = computedSize * 1.35;

                            ctx.font = `${fontStyle} ${fontWeight} ${computedSize}px "${font}", sans-serif`;
                            ctx.fillStyle = color;
                            ctx.textAlign = align;

                            const lines = text.split('\n');
                            const totalTextHeight = lines.length * lineHeight;
                            
                            let startY = areaY + (areaHeight - totalTextHeight) / 2 + (computedSize * 0.85);
                            let startX = areaX + areaWidth / 2;
                            if (align === 'left') {
                                startX = areaX + 40 * scale;
                            } else if (align === 'right') {
                                startX = areaX + areaWidth - (40 * scale);
                            }

                            lines.forEach((line, index) => {
                                ctx.fillText(line, startX, startY + (index * lineHeight));
                            });
                        };

                        // 1. Preload any needed Google Fonts
                        const fontsNeeded = new Set();
                        if (gBrand.header && gBrand.header.mode === 'text' && gBrand.header.text && gBrand.header.font) fontsNeeded.add(gBrand.header.font);
                        if (gBrand.footer && gBrand.footer.mode === 'text' && gBrand.footer.text && gBrand.footer.font) fontsNeeded.add(gBrand.footer.font);
                        
                        await Promise.all([...fontsNeeded].map(fontName => {
                            if (!fontName || fontName === 'Inter') return Promise.resolve();
                            const linkId = `gfont-${fontName}`;
                            if (!document.getElementById(linkId)) {
                                const link = document.createElement('link');
                                link.id = linkId;
                                link.rel = 'stylesheet';
                                link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:ital,wght@0,400;0,700;1,400;1,700&display=swap`;
                                document.head.appendChild(link);
                            }
                            return document.fonts.load(`16px "${fontName}"`).catch(() => {});
                        }));

                        // 2. Draw header
                        if (gBrand.header) {
                            if (gBrand.header.mode === 'text' && gBrand.header.text) {
                                ctx.fillStyle = gBrand.header.bg || bg;
                                ctx.fillRect(0, 0, outputWidth, pt - 2*scale);
                                
                                drawMultilineBrandingText(ctx, gBrand.header.text, 0, 0, outputWidth, pt - 2*scale, {
                                    font: gBrand.header.font || 'Inter',
                                    size: gBrand.header.size || 24,
                                    color: gBrand.header.color || text,
                                    bold: !!gBrand.header.bold,
                                    italic: !!gBrand.header.italic,
                                    align: gBrand.header.align || 'center',
                                    scale: scale
                                });
                            } else if (gBrand.header.mode === 'image' && gBrand.header.base64) {
                                await new Promise(res => {
                                    const himg = new Image();
                                    himg.onload = () => { ctx.drawImage(himg, 0, 0, outputWidth, pt); res(); };
                                    himg.onerror = res;
                                    himg.src = gBrand.header.base64;
                                });
                            }
                        }

                        // 3. Draw footer
                        if (gBrand.footer) {
                            if (gBrand.footer.mode === 'text' && gBrand.footer.text) {
                                ctx.fillStyle = gBrand.footer.bg || bg;
                                ctx.fillRect(0, totalHeight - pb + 2*scale, outputWidth, pb);
                                
                                drawMultilineBrandingText(ctx, gBrand.footer.text, 0, totalHeight - pb + 2*scale, outputWidth, pb, {
                                    font: gBrand.footer.font || 'Inter',
                                    size: gBrand.footer.size || 18,
                                    color: gBrand.footer.color || text,
                                    bold: !!gBrand.footer.bold,
                                    italic: !!gBrand.footer.italic,
                                    align: gBrand.footer.align || 'center',
                                    scale: scale
                                });
                            } else if (gBrand.footer.mode === 'image' && gBrand.footer.base64) {
                                await new Promise(res => {
                                    const fimg = new Image();
                                    fimg.onload = () => { ctx.drawImage(fimg, 0, totalHeight - pb, outputWidth, pb); res(); };
                                    fimg.onerror = res;
                                    fimg.src = gBrand.footer.base64;
                                });
                            }
                        }

                        resolve(canvas);
                    };

                    // For PNG Theme, we load the PNG and draw it OVER the photos
                    if (customThemeObj && customThemeObj.theme_type === 'png' && customThemeObj.png_image) {
                        const overlayImg = new Image();
                        overlayImg.onload = () => {
                            ctx.drawImage(overlayImg, 0, 0, outputWidth, totalHeight);
                            applyBrandingAndResolve();
                        };
                        overlayImg.onerror = applyBrandingAndResolve;
                        overlayImg.src = customThemeObj.png_image;
                    } else {
                        applyBrandingAndResolve();
                    }
                    })(); // end async IIFE
                }
            };
            img.onerror = () => {
                loaded++;
                if (loaded === photos.length) resolve(canvas);
            };
            img.src = src;
        });
    });
}

// ============================================================
// DUAL 2x6 STRIP ON 4x6" CANVAS (1200 x 1800 px)
// ============================================================
function composeDualStrip4x6(photos, templateName, outputWidth = 1200, customThemeObj = null, layoutStr = '4', layoutSize = null) {
    const scale = outputWidth / 1200;
    const canvasWidth = outputWidth;
    const canvasHeight = Math.round(outputWidth * (1800 / 1200));
    const stripWidth = canvasWidth / 2;

    let pt = 60 * scale;
    let pb = 50 * scale;
    let px = 18 * scale;
    let ps = 10 * scale;

    // Admin-configured Layout Sizes (physical cm per strip) drive paddings
    if (layoutSize && layoutSize.width_cm && layoutSize.height_cm) {
        const pxPerCm = stripWidth / layoutSize.width_cm;
        pt = Math.round(0.55 * pxPerCm);
        pb = Math.round(0.45 * pxPerCm);
        px = Math.round(0.12 * pxPerCm);
        ps = Math.round(0.09 * pxPerCm);
    }

    let bg = '#FFFFFF';
    let text = '#000000';

    if (customThemeObj && customThemeObj.theme_type === 'text') {
        bg = customThemeObj.bg_color || '#FFFFFF';
        text = customThemeObj.text_color || '#000000';
    } else if (templateName === 'dark') {
        bg = '#F9F9F9';
    }

    const availW = stripWidth - px * 2;
    const availH = canvasHeight - pt - pb;

    let photoCount = photos.length;
    let countStr = String(photoCount);
    if (layoutStr && layoutStr.includes('_')) {
        countStr = layoutStr.split('_')[0];
    } else if (layoutStr && layoutStr.includes('-cut')) {
        countStr = layoutStr.split('-')[0];
    }
    const count = parseInt(countStr, 10) || photoCount || 4;

    let photoWidth = availW;
    let photoHeight = Math.floor((availH - ps * (count - 1)) / count);

    let leftCoords = [];
    let rightCoords = [];

    for (let i = 0; i < count; i++) {
        const yPos = pt + i * (photoHeight + ps);
        leftCoords.push({ x: px, y: yPos });
        rightCoords.push({ x: stripWidth + px, y: yPos });
    }

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    return new Promise((resolve) => {
        let loaded = 0;
        const images = [];

        if (photos.length === 0) {
            ctx.fillStyle = text;
            ctx.font = `600 ${24*scale}px "Inter", "Prompt", sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('NO PHOTOS', canvasWidth / 2, canvasHeight / 2);
            resolve(canvas);
            return;
        }

        photos.forEach((src, i) => {
            const img = new Image();
            img.onload = () => {
                images[i] = img;
                checkLoaded();
            };
            img.onerror = () => {
                images[i] = null;
                checkLoaded();
            };

            function checkLoaded() {
                loaded++;
                if (loaded === photos.length) {
                    (async () => {
                        images.forEach((im, idx) => {
                            if (!im || idx >= count) return;

                            const crop = getCoverCrop(im, photoWidth, photoHeight);

                            // Left Strip
                            const lx = leftCoords[idx].x;
                            const ly = leftCoords[idx].y;
                            ctx.drawImage(im, crop.x, crop.y, crop.width, crop.height, lx, ly, photoWidth, photoHeight);
                            ctx.strokeStyle = '#000000';
                            ctx.lineWidth = 1.5 * scale;
                            ctx.strokeRect(lx, ly, photoWidth, photoHeight);

                            // Right Strip (Identical Dual Strip)
                            const rx = rightCoords[idx].x;
                            const ry = rightCoords[idx].y;
                            ctx.drawImage(im, crop.x, crop.y, crop.width, crop.height, rx, ry, photoWidth, photoHeight);
                            ctx.strokeRect(rx, ry, photoWidth, photoHeight);
                        });

                        // Middle Cut Line
                        ctx.strokeStyle = '#CCCCCC';
                        ctx.lineWidth = 1.5 * scale;
                        ctx.setLineDash([8 * scale, 8 * scale]);
                        ctx.beginPath();
                        ctx.moveTo(stripWidth, 0);
                        ctx.lineTo(stripWidth, canvasHeight);
                        ctx.stroke();
                        ctx.setLineDash([]);

                        // Headers & Footers on Left and Right
                        const drawStripHeaderFooter = (stripOffsetX) => {
                            ctx.fillStyle = text;
                            ctx.textAlign = 'center';

                            if (templateName === 'light') {
                                ctx.font = `800 ${16*scale}px "Inter", "Prompt", sans-serif`;
                                ctx.fillText('MEMORIES', stripOffsetX + stripWidth / 2, canvasHeight - pb / 2);
                                const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '.');
                                ctx.font = `500 ${9*scale}px "Inter", "Prompt", sans-serif`;
                                ctx.fillStyle = '#666666';
                                ctx.fillText(dateStr, stripOffsetX + stripWidth / 2, canvasHeight - pb / 2 + 14*scale);
                            } else if (templateName === 'dark') {
                                ctx.fillStyle = '#000000';
                                ctx.fillRect(stripOffsetX + px, 12*scale, availW, 36*scale);
                                ctx.fillStyle = '#FFFFFF';
                                ctx.font = `800 ${18*scale}px "Inter", "Prompt", sans-serif`;
                                ctx.fillText('MEMORIES', stripOffsetX + stripWidth / 2, 12*scale + 25*scale);
                            } else if (templateName === 'mint') {
                                ctx.font = `600 ${12*scale}px "Inter", "Prompt", sans-serif`;
                                ctx.fillText('memories.com', stripOffsetX + stripWidth / 2, 32*scale);
                                ctx.font = `500 ${10*scale}px "Inter", "Prompt", sans-serif`;
                                ctx.fillText('captured moments.', stripOffsetX + stripWidth / 2, canvasHeight - 15*scale);
                            } else if (templateName === 'blue') {
                                ctx.fillStyle = '#000000';
                                ctx.font = `600 ${12*scale}px "Inter", "Prompt", sans-serif`;
                                ctx.fillText('NOW PLAYING', stripOffsetX + stripWidth / 2, 32*scale);
                                ctx.font = `700 ${14*scale}px "Inter", "Prompt", sans-serif`;
                                ctx.fillText('Memories', stripOffsetX + stripWidth / 2, canvasHeight - 18*scale);
                            }
                        };

                        drawStripHeaderFooter(0);
                        drawStripHeaderFooter(stripWidth);

                        if (customThemeObj && customThemeObj.theme_type === 'png' && customThemeObj.png_image) {
                            const overlayImg = new Image();
                            overlayImg.onload = () => {
                                ctx.drawImage(overlayImg, 0, 0, stripWidth, canvasHeight);
                                ctx.drawImage(overlayImg, stripWidth, 0, stripWidth, canvasHeight);
                                resolve(canvas);
                            };
                            overlayImg.onerror = () => resolve(canvas);
                            overlayImg.src = customThemeObj.png_image;
                        } else {
                            resolve(canvas);
                        }
                    })();
                }
            };
            img.src = src;
        });
    });
}

function loadTemplateImage(source) {
    return new Promise((resolve) => {
        if (!source) { resolve(null); return; }
        const image = new Image();
        if (!String(source).startsWith('data:') && !String(source).startsWith('blob:')) {
            image.crossOrigin = 'anonymous';
        }
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = source;
    });
}

function drawTemplateTheme(ctx, templateName, theme, width, height) {
    const scale = width / 600;
    const name = String(templateName || 'light');
    const ink = theme && theme.text_color ? theme.text_color : '#0A0A0A';
    ctx.save();
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    
    if (theme && theme.theme_type === 'text') {
        if (theme.header_text) {
            ctx.font = `700 ${Math.max(12, 18 * scale)}px "Inter", "Prompt", sans-serif`;
            ctx.fillText(theme.header_text, width / 2, Math.max(24, 52 * scale));
        }
        if (theme.footer_text) {
            ctx.font = `600 ${Math.max(11, 15 * scale)}px "Inter", "Prompt", sans-serif`;
            ctx.fillText(theme.footer_text, width / 2, height - Math.max(18, 42 * scale));
        }
    } else if (name === 'dark') {
        // Retro Ticket / Receipt Style
        ctx.fillStyle = '#0A0A0A';
        ctx.fillRect(28 * scale, 18 * scale, width - 56 * scale, 38 * scale);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `800 ${Math.max(11, 16 * scale)}px "Inter", "Prompt", sans-serif`;
        ctx.fillText('MEMORIES · TICKET', width / 2, 42 * scale);

        // Dashed lines
        ctx.strokeStyle = '#0A0A0A';
        ctx.lineWidth = Math.max(1, 1.5 * scale);
        ctx.setLineDash([6 * scale, 4 * scale]);
        ctx.beginPath();
        ctx.moveTo(28 * scale, 64 * scale);
        ctx.lineTo(width - 28 * scale, 64 * scale);
        ctx.moveTo(28 * scale, height - 56 * scale);
        ctx.lineTo(width - 28 * scale, height - 56 * scale);
        ctx.stroke();
        ctx.setLineDash([]);

        // Footer barcode effect
        ctx.fillStyle = '#0A0A0A';
        ctx.font = `700 ${Math.max(9, 12 * scale)}px "Inter", monospace`;
        ctx.fillText('||| | |||| | || |||| | |||', width / 2, height - 36 * scale);
        ctx.font = `500 ${Math.max(8, 10 * scale)}px "Inter", sans-serif`;
        ctx.fillText('THANK YOU FOR VISITING', width / 2, height - 18 * scale);
    } else if (name === 'mint') {
        // Mac OS Web Browser Window
        // Mac traffic light dots
        const dotR = Math.max(3, 5 * scale);
        const dotY = 32 * scale;
        const startX = 36 * scale;
        
        ctx.fillStyle = '#FF5F56'; // Red
        ctx.beginPath(); ctx.arc(startX, dotY, dotR, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#FFBD2E'; // Yellow
        ctx.beginPath(); ctx.arc(startX + dotR * 2.8, dotY, dotR, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#27C93F'; // Green
        ctx.beginPath(); ctx.arc(startX + dotR * 5.6, dotY, dotR, 0, Math.PI * 2); ctx.fill();

        // Browser URL pill
        ctx.fillStyle = '#F3F4F6';
        const pillW = Math.min(220 * scale, width * 0.45);
        const pillH = 22 * scale;
        ctx.beginPath();
        ctx.roundRect((width - pillW) / 2, dotY - pillH / 2, pillW, pillH, 11 * scale);
        ctx.fill();

        ctx.fillStyle = '#374151';
        ctx.font = `600 ${Math.max(9, 11 * scale)}px "Inter", sans-serif`;
        ctx.fillText('memories.com', width / 2, dotY + 4 * scale);

        // Footer
        ctx.fillStyle = '#6B7280';
        ctx.font = `500 ${Math.max(9, 12 * scale)}px "Inter", sans-serif`;
        ctx.fillText('captured moments.', width / 2, height - 28 * scale);
    } else if (name === 'blue') {
        // Retro MP3 / Music Player
        ctx.fillStyle = '#0A0A0A';
        ctx.font = `800 ${Math.max(10, 13 * scale)}px "Inter", sans-serif`;
        ctx.fillText('▶ NOW PLAYING', width / 2, 34 * scale);

        // Progress bar
        const barW = width - 80 * scale;
        const barY = 48 * scale;
        ctx.fillStyle = '#E5E7EB';
        ctx.fillRect(40 * scale, barY, barW, 4 * scale);
        ctx.fillStyle = '#3B82F6';
        ctx.fillRect(40 * scale, barY, barW * 0.65, 4 * scale);

        // Footer
        ctx.fillStyle = '#0A0A0A';
        ctx.font = `800 ${Math.max(12, 16 * scale)}px "Inter", sans-serif`;
        ctx.fillText('MEMORIES · TRACK 01', width / 2, height - 38 * scale);
        ctx.font = `500 ${Math.max(9, 11 * scale)}px "Inter", sans-serif`;
        ctx.fillStyle = '#6B7280';
        ctx.fillText('02:45 / 03:30 · STEREO HD', width / 2, height - 20 * scale);
    } else {
        // Classic Y2K / Minimalist
        ctx.fillStyle = '#0A0A0A';
        ctx.font = `900 ${Math.max(13, 20 * scale)}px "Inter", "Prompt", sans-serif`;
        ctx.fillText('MEMORIES', width / 2, height - 48 * scale);
        ctx.font = `500 ${Math.max(9, 12 * scale)}px "Inter", monospace`;
        ctx.fillStyle = '#6B7280';
        ctx.fillText(new Date().toLocaleDateString('en-CA').replace(/-/g, '.'), width / 2, height - 26 * scale);
    }
    ctx.restore();
}

async function drawTemplateUnit(ctx, schema, images, templateName, customThemeObj, target) {
    const engine = window.PhotoTemplateEngine;
    const scaleX = target.width / schema.canvas.width;
    const scaleY = target.height / schema.canvas.height;
    const bg = customThemeObj && customThemeObj.theme_type === 'text'
        ? (customThemeObj.bg_color || schema.canvas.backgroundColor)
        : schema.canvas.backgroundColor;

    ctx.save();
    ctx.translate(target.x, target.y);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, target.width, target.height);
    if (schema.canvas && schema.canvas.backgroundImage) {
        const bgImage = await loadTemplateImage(schema.canvas.backgroundImage);
        if (bgImage) ctx.drawImage(bgImage, 0, 0, target.width, target.height);
    }

    const drawArtboardLayers = async (placement) => {
        if (!Array.isArray(schema.artboard)) return;
        for (const layer of schema.artboard.slice().sort((a, b) => a.zIndex - b.zIndex)) {
            if (!layer || layer.visible === false || !layer.url) continue;
            if ((layer.placement || 'front') !== placement) continue;
            const image = await loadTemplateImage(layer.url);
            if (!image) continue;
            const lx = layer.x * scaleX;
            const ly = layer.y * scaleY;
            const lw = layer.width * scaleX;
            const lh = layer.height * scaleY;
            ctx.save();
            ctx.globalAlpha = typeof layer.opacity === 'number' ? layer.opacity : 1;
            ctx.translate(lx + lw / 2, ly + lh / 2);
            ctx.rotate(((layer.rotation || 0) * Math.PI) / 180);
            ctx.drawImage(image, -lw / 2, -lh / 2, lw, lh);
            ctx.restore();
        }
    };

    await drawArtboardLayers('back');

    schema.slots.slice().sort((a, b) => a.zIndex - b.zIndex).forEach((slot) => {
        const image = images[slot.index - 1];
        const x = slot.x * scaleX;
        const y = slot.y * scaleY;
        const width = slot.width * scaleX;
        const height = slot.height * scaleY;
        ctx.save();
        ctx.translate(x + width / 2, y + height / 2);
        ctx.rotate((slot.rotation * Math.PI) / 180);
        ctx.beginPath();
        ctx.rect(-width / 2, -height / 2, width, height);
        ctx.clip();
        if (image) {
            const crop = engine.getCoverCrop(
                image.naturalWidth || image.width,
                image.naturalHeight || image.height,
                width,
                height,
                slot.focusX,
                slot.focusY
            );
            ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, -width / 2, -height / 2, width, height);
        } else {
            // Elegant 3:4 photo placeholder with camera icon & label
            ctx.fillStyle = '#F3F4F6';
            ctx.fillRect(-width / 2, -height / 2, width, height);
            ctx.strokeStyle = '#E5E7EB';
            ctx.lineWidth = Math.max(1, 1.5 * scaleX);
            ctx.strokeRect(-width / 2, -height / 2, width, height);

            ctx.fillStyle = '#9CA3AF';
            ctx.font = `700 ${Math.max(11, 15 * scaleX)}px "Inter", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`📸 Photo ${slot.index}`, 0, -8 * scaleX);
            ctx.font = `600 ${Math.max(9, 11 * scaleX)}px "Inter", sans-serif`;
            ctx.fillStyle = '#B0B5BF';
            ctx.fillText('3:4 Ratio', 0, 12 * scaleX);
        }
        ctx.restore();
    });

    await drawArtboardLayers('front');

    drawTemplateTheme(ctx, templateName, customThemeObj, target.width, target.height);

    const customOverlay = customThemeObj && customThemeObj.theme_type === 'png'
        ? await loadTemplateImage(customThemeObj.png_image)
        : null;
    if (customOverlay) ctx.drawImage(customOverlay, 0, 0, target.width, target.height);
    const schemaOverlay = await loadTemplateImage(schema.overlay && schema.overlay.url);
    if (schemaOverlay) ctx.drawImage(schemaOverlay, 0, 0, target.width, target.height);
    ctx.restore();
}

async function composeTemplateBySchema(photos, templateName, outputWidth, customThemeObj, schema, paperMode) {
    const engine = window.PhotoTemplateEngine;
    const normalized = engine.normalizeTemplate(schema);
    const images = await Promise.all((photos || []).map(loadTemplateImage));
    const preview = Number(outputWidth) < 1000;
    let canvasWidth;
    let canvasHeight;
    let targets;

    if (normalized.type === '2x6' && paperMode === 'photo4x6_dual' && normalized.printSettings.printTwoPerPage) {
        canvasWidth = preview ? Math.max(240, Math.round(outputWidth)) : 1200;
        canvasHeight = Math.round(canvasWidth * 1.5);
        targets = [
            { x: 0, y: 0, width: canvasWidth / 2, height: canvasHeight },
            { x: canvasWidth / 2, y: 0, width: canvasWidth / 2, height: canvasHeight }
        ];
    } else {
        canvasWidth = preview ? Math.max(220, Math.round(outputWidth)) : normalized.canvas.width;
        canvasHeight = Math.round(canvasWidth * (normalized.canvas.height / normalized.canvas.width));
        targets = [{ x: 0, y: 0, width: canvasWidth, height: canvasHeight }];
    }

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D context is unavailable.');
    for (const target of targets) {
        await drawTemplateUnit(ctx, normalized, images, templateName, customThemeObj, target);
    }
    if (targets.length === 2) {
        ctx.save();
        ctx.strokeStyle = '#B8B8B8';
        ctx.lineWidth = Math.max(1, canvasWidth / 800);
        ctx.setLineDash([canvasWidth / 120, canvasWidth / 120]);
        ctx.beginPath();
        ctx.moveTo(canvasWidth / 2, 0);
        ctx.lineTo(canvasWidth / 2, canvasHeight);
        ctx.stroke();
        ctx.restore();
    }
    return canvas;
}

async function composePhotoByMode(photos, templateName, outputWidth = 600, customThemeObj = null, layoutStr = '4', layoutSize = null) {
    const mode = Kiosk.paperMode || 'photo4x6_dual';
    const schema = TemplateCatalog.current(layoutStr, mode);
    if (window.PhotoTemplateEngine && schema) {
        return composeTemplateBySchema(photos, templateName, outputWidth, customThemeObj, schema, mode);
    }
    if (mode === 'photo4x6_dual') {
        return await composeDualStrip4x6(photos, templateName, outputWidth, customThemeObj, layoutStr, layoutSize);
    } else {
        return await composeStrip(photos, templateName, outputWidth, customThemeObj, layoutStr, layoutSize);
    }
}

// Fetch the admin-configured Layout Size (cm) for a layout string like '3_1x1' or '4'
async function fetchLayoutSizeFor(layoutStr) {
    let countStr = '4';
    if (layoutStr && layoutStr.includes('_')) countStr = layoutStr.split('_')[0];
    else if (layoutStr) countStr = String(layoutStr).split('-')[0];
    const sizes = await fetchLayoutSizes();
    const found = sizes.find(s => String(s.layout_id) === String(countStr));
    if (found && found.width_cm && found.height_cm) {
        return { width_cm: Number(found.width_cm), height_cm: Number(found.height_cm) };
    }
    return null;
}

// ======================== SUPABASE UPLOAD ========================
async function uploadToCloud(dataUrl, filename) {
    console.warn('Legacy browser upload is disabled. Use the provisioned native export queue.');
    return null;
    /* legacy implementation retained temporarily for migration reference
    // Convert data URL to blob
    const res = await fetch(dataUrl);
    const blob = await res.blob();

    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${filename}`;

    try {
        const response = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'apikey': SUPABASE_ANON_KEY,
                'Content-Type': blob.type,
                'x-upsert': 'true',
            },
            body: blob
        });

        if (!response.ok) {
            throw new Error(`Upload failed: ${response.status}`);
        }

        // Return public URL
        return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${filename}`;
    } catch (err) {
        console.error('Cloud upload error:', err);
        return null;
    }
    */
}

async function logSessionToCloud(colorUrl, ditheredUrl) {
    console.warn('Legacy browser session logging is disabled. Use the native kiosk sync queue.');
    return false;
    /* legacy implementation retained temporarily for migration reference
    try {
        const isCafeMode = Kiosk.mode !== 'event';
        const payload = {
            kiosk_mode: Kiosk.mode,
            event_name: Kiosk.mode === 'event' ? Kiosk.eventName : null,
            layout: Session.layout,
            color_url: colorUrl,
            dithered_url: ditheredUrl,
            is_cafe_mode: isCafeMode,
            // Café Mode: photos expire in 24 hours; Event Mode: no expiry (keep)
            expires_at: isCafeMode ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null
        };

        const res = await fetch(`${SUPABASE_URL}/rest/v1/kiosk_sessions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'apikey': SUPABASE_ANON_KEY,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            console.error("Supabase Analytics log error:", res.status);
        } else {
            console.log("Session logged to Supabase Analytics successfully!");
        }
    } catch (e) {
        console.error("Failed to log session:", e);
    }
    */
}

// ======================== NAVIGATION GUARD ========================
function preventBackNavigation() {
    history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', () => {
        history.pushState(null, '', window.location.href);
    });
}

// ======================== FLASH TRIGGER ========================
function triggerFlash() {
    let overlay = document.getElementById('flash-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'flash-overlay';
        overlay.className = 'flash-overlay';
        document.body.appendChild(overlay);
    }
    overlay.classList.remove('flash-active');
    void overlay.offsetWidth; // force reflow
    overlay.classList.add('flash-active');
    // Vibrate
    if (navigator.vibrate) navigator.vibrate(150);
    setTimeout(() => overlay.classList.remove('flash-active'), 500);
}

// ======================== EVENT BANNER & FOOTER STATUS ========================
function checkAndInjectEventBanner() {
    const statusEl = document.getElementById('footer-copyright-status');
    const modeStatus = Kiosk.mode === 'event' ? `EVENT (${Kiosk.eventName || 'EVENT MODE'})` : 'REDEEM';
    
    if (statusEl) {
        statusEl.textContent = `© PHOTO BOOTH • ${modeStatus}`;
    }
}

// ======================== REDEEM CODE SYSTEM ========================

// Call a Postgres RPC function through the REST API.
async function rpc(name, args = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify(args)
    });
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`RPC ${name} failed: ${res.status} ${errText}`);
    }
    return res.json();
}

// Customer redemption is a single atomic operation exposed by the native
// device bridge. The bridge keeps its credential in Android Keystore and calls
// the redeem-claim Edge Function; the browser never receives that credential.
async function claimRedeemCode(code) {
    code = String(code || '').toUpperCase().trim();
    if (!/^[A-Z]{2}\d{4}$/.test(code)) {
        return { success: false, error: 'invalid_format' };
    }

    const params = new URLSearchParams(window.location.search);
    const isLocalDemo = ['localhost', '127.0.0.1'].includes(window.location.hostname) && params.get('demo') === '1';
    if (isLocalDemo) {
        const demoCodes = demoLoadRedeemCodes();
        let matched = demoCodes.find(row => row.code === code);
        if (!matched && code === 'DE1010') {
            matched = {
                id: crypto.randomUUID(), code: 'DE1010', code_hint: 'DE••10',
                batch_id: 'demo-starter',
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                is_used: false
            };
            demoCodes.push(matched);
        }
        if (!matched) return { success: false, error: 'not_found' };
        if (matched.is_used) return { success: false, error: 'already_used' };
        if (matched.expires_at && new Date(matched.expires_at).getTime() <= Date.now()) {
            return { success: false, error: 'expired' };
        }
        matched.is_used = true;
        matched.used_at = new Date().toISOString();
        demoSaveRedeemCodes(demoCodes);
        const demoClaim = {
            claimId: crypto.randomUUID(),
            codeHint: matched.code_hint,
            kioskId: 'demo-kiosk',
            packageId: 'demo-receipt',
            claimedAt: new Date().toISOString(),
            demo: true
        };
        Session.authorization = demoClaim;
        return { success: true, claim: demoClaim };
    }

    if (!window.PhotoboothDevice || typeof window.PhotoboothDevice.claimRedeem !== 'function') {
        return { success: false, error: 'device_not_provisioned' };
    }

    try {
        const result = await window.PhotoboothDevice.claimRedeem({
            code,
            kioskId: Kiosk.kioskId,
            packageId: Kiosk.packageId,
            configVersion: Number(localStorage.getItem('kiosk_config_version') || '1')
        });
        if (!result || !result.success) {
            return { success: false, error: (result && result.error) || 'network_error' };
        }
        const claim = {
            claimId: result.claimId,
            codeHint: result.codeHint,
            kioskId: result.kioskId,
            packageId: result.packageId,
            claimedAt: result.claimedAt
        };
        Session.authorization = claim;
        return { success: true, claim };
    } catch (e) {
        console.error('Atomic redeem claim failed:', e);
        return { success: false, error: 'network_error' };
    }
}

function demoLoadRedeemCodes() {
    if (!isLocalPrototypeDemo()) return [];
    try { return JSON.parse(sessionStorage.getItem('pb_demo_redeem_codes') || '[]'); }
    catch (e) { return []; }
}

function demoSaveRedeemCodes(codes) {
    if (isLocalPrototypeDemo()) sessionStorage.setItem('pb_demo_redeem_codes', JSON.stringify(codes));
}

function demoCreateRedeemCode(existing) {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code;
    do {
        const bytes = crypto.getRandomValues(new Uint8Array(4));
        code = letters[bytes[0] % letters.length] + letters[bytes[1] % letters.length] +
            String(((bytes[2] << 8) | bytes[3]) % 10000).padStart(4, '0');
    } while (existing.has(code));
    return code;
}

async function generateRedeemCodes(count = 50, expiresDays = 30) {
    count = Math.max(1, Math.min(500, Number(count) || 50));
    expiresDays = Math.max(1, Math.min(365, Number(expiresDays) || 30));
    if (isLocalPrototypeDemo()) {
        const rows = demoLoadRedeemCodes();
        const existing = new Set(rows.map(row => row.code));
        const batchId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + expiresDays * 86400000).toISOString();
        const created = [];
        for (let i = 0; i < count; i++) {
            const code = demoCreateRedeemCode(existing);
            existing.add(code);
            const row = {
                id: crypto.randomUUID(), code, code_hint: `${code.slice(0, 2)}••${code.slice(4)}`,
                batch_id: batchId, expires_at: expiresAt, is_used: false,
                printed_at: null, created_at: new Date().toISOString()
            };
            rows.push(row);
            created.push(row);
        }
        demoSaveRedeemCodes(rows);
        adminAuditLocal('demo_redeem.batch_generated', { batchId, count, expiresAt });
        return { success: true, codes: created.map(row => row.code), batchId, expiresAt, demo: true };
    }
    const bridge = window.PhotoboothDevice;
    if (!bridge || typeof bridge.generateRedeemCodes !== 'function') {
        return { success: false, codes: [], batchId: null, error: 'device_not_provisioned' };
    }
    try {
        return await bridge.generateRedeemCodes({
            kioskId: Kiosk.kioskId, packageId: Kiosk.packageId, count, expiresDays
        });
    } catch (e) {
        console.error('Generate codes error:', e);
        return { success: false, codes: [], batchId: null, error: 'device_unavailable' };
    }
}

async function fetchRedeemCodes() {
    if (isLocalPrototypeDemo()) {
        const now = Date.now();
        return demoLoadRedeemCodes().map(row => ({
            ...row,
            isExpired: row.expires_at ? new Date(row.expires_at).getTime() <= now : false
        }));
    }
    const bridge = window.PhotoboothDevice;
    if (!bridge || typeof bridge.listRedeemCodes !== 'function') return [];
    try {
        const result = await bridge.listRedeemCodes({ kioskId: Kiosk.kioskId });
        const rows = result && Array.isArray(result.codes) ? result.codes : [];
        const now = Date.now();
        return rows.map(row => ({
            ...row,
            isExpired: row.expiresAt ? new Date(row.expiresAt).getTime() <= now : !!row.isExpired
        }));
    } catch (e) {
        console.error('Fetch redeem codes error:', e);
        return [];
    }
}

let pendingDemoRedeemPrint = null;

async function printRedeemCodeBatch(count = 10) {
    count = Math.max(1, Math.min(100, Number(count) || 10));
    if (isLocalPrototypeDemo()) {
        const available = demoLoadRedeemCodes().filter(row =>
            !row.is_used && !row.printed_at && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now())
        ).sort((a, b) => (a.priority === 'replacement' ? -1 : 0) - (b.priority === 'replacement' ? -1 : 0)).slice(0, count);
        if (!available.length) return { status: 'empty', codes: [] };
        pendingDemoRedeemPrint = { jobId: crypto.randomUUID(), ids: available.map(row => row.id) };
        return { status: 'simulator', jobId: pendingDemoRedeemPrint.jobId, codes: available.map(row => row.code) };
    }
    const bridge = window.PhotoboothPrinter;
    if (!bridge || typeof bridge.printRedeemCodes !== 'function') {
        return { status: 'unavailable', error: 'printer_bridge_missing', codes: [] };
    }
    return bridge.printRedeemCodes({ kioskId: Kiosk.kioskId, count });
}

async function resolveRedeemCodePrint(jobId, printed) {
    if (isLocalPrototypeDemo()) {
        if (!pendingDemoRedeemPrint || pendingDemoRedeemPrint.jobId !== jobId) return false;
        if (printed) {
            const rows = demoLoadRedeemCodes();
            const ids = new Set(pendingDemoRedeemPrint.ids);
            rows.forEach(row => { if (ids.has(row.id)) row.printed_at = new Date().toISOString(); });
            demoSaveRedeemCodes(rows);
        }
        adminAuditLocal('demo_redeem.print_resolved', {
            jobId, printed: !!printed, count: pendingDemoRedeemPrint.ids.length
        });
        pendingDemoRedeemPrint = null;
        return true;
    }
    const bridge = window.PhotoboothPrinter;
    if (!bridge || typeof bridge.resolveRedeemCodePrint !== 'function') return false;
    const result = await bridge.resolveRedeemCodePrint({
        jobId,
        resolution: printed ? 'confirmed_printed' : 'confirmed_not_printed'
    });
    return !!(result && result.success);
}

async function issueReplacementEntitlement(originalCode, reason) {
    originalCode = String(originalCode || '').trim().toUpperCase();
    reason = String(reason || '').trim();
    if (!/^[A-Z]{2}\d{4}$/.test(originalCode)) {
        return { success: false, error: 'invalid_original_code' };
    }
    if (reason.length < 5 || reason.length > 500) {
        return { success: false, error: 'replacement_reason_required' };
    }
    if (isLocalPrototypeDemo()) {
        const rows = demoLoadRedeemCodes();
        const original = rows.find(row => row.code === originalCode);
        if (!original) return { success: false, error: 'original_code_not_found' };
        if (!original.is_used) return { success: false, error: 'replacement_not_allowed' };
        if (original.replaced_by) return { success: false, error: 'replacement_already_issued' };
        const existing = new Set(rows.map(row => row.code));
        const code = demoCreateRedeemCode(existing);
        const replacement = {
            id: crypto.randomUUID(),
            code,
            code_hint: `${code.slice(0, 2)}••${code.slice(4)}`,
            batch_id: crypto.randomUUID(),
            expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
            is_used: false,
            printed_at: null,
            replacement_for: original.id,
            priority: 'replacement',
            created_at: new Date().toISOString()
        };
        original.replaced_by = replacement.id;
        original.state = 'replaced';
        rows.push(replacement);
        demoSaveRedeemCodes(rows);
        adminAuditLocal('demo_replacement_entitlement_issued', {
            originalId: original.id,
            replacementId: replacement.id,
            reason
        });
        return {
            success: true,
            code,
            codeHint: replacement.code_hint,
            expiresAt: replacement.expires_at,
            replacementEntitlementId: replacement.id,
            demo: true
        };
    }
    const bridge = window.PhotoboothDevice;
    if (!bridge || typeof bridge.issueReplacement !== 'function') {
        return { success: false, error: 'device_not_provisioned' };
    }
    try {
        return await bridge.issueReplacement({
            kioskId: Kiosk.kioskId,
            originalCode,
            reason
        });
    } catch (e) {
        console.error('Replacement entitlement error:', e);
        return { success: false, error: 'device_unavailable' };
    }
}

// ======================== ADMIN AUTH (native/server verified PIN) ========================
// Production never persists a PIN, PIN hash, device credentials, or an admin
// capability. The localhost fallback below uses sessionStorage for testing only.
let cachedAdminAuthUntil = 0;
let adminAuthError = '';
let demoAdminPin = null;
let demoAdminFailedCount = 0;
let demoAdminLockedUntil = 0;

function isLocalAdminDemo() {
    const host = String(location.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1';
}

if (isLocalAdminDemo()) {
    cachedAdminAuthUntil = Number(sessionStorage.getItem('pb_demo_admin_auth_until') || 0);
    demoAdminPin = sessionStorage.getItem('pb_demo_admin_pin') || '1234';
}

function setLocalAdminAuthUntil(value) {
    cachedAdminAuthUntil = Number(value) || 0;
    if (isLocalAdminDemo()) {
        if (cachedAdminAuthUntil > Date.now()) {
            sessionStorage.setItem('pb_demo_admin_auth_until', String(cachedAdminAuthUntil));
        } else {
            sessionStorage.removeItem('pb_demo_admin_auth_until');
        }
    }
}

function getAdminPin() {
    // Retained for older admin call sites; raw PINs are never cached or exposed.
    return null;
}

function getAdminAuthError() {
    return adminAuthError;
}

function isAdminAuthed() {
    return cachedAdminAuthUntil > Date.now();
}

function adminPinIsValid(pin) {
    return /^\d{4}$/.test(String(pin || '').trim());
}

function adminAuditLocal(action, details = {}) {
    try {
        const entries = JSON.parse(localStorage.getItem('kiosk_audit_log') || '[]');
        entries.push({
            id: crypto.randomUUID ? crypto.randomUUID() : `audit-${Date.now()}`,
            action,
            actor: 'shared_admin',
            kioskId: Kiosk.kioskId,
            at: new Date().toISOString(),
            details
        });
        localStorage.setItem('kiosk_audit_log', JSON.stringify(entries.slice(-500)));
    } catch (e) {
        console.warn('Unable to append local admin audit', e);
    }
}

async function adminGetPinStatus() {
    adminAuthError = '';
    if (isLocalAdminDemo()) {
        return {
            configured: !!demoAdminPin,
            authenticated: isAdminAuthed(),
            lockedUntil: demoAdminLockedUntil || null,
            demo: true
        };
    }
    const bridge = window.PhotoboothDevice;
    if (!bridge || typeof bridge.adminPinStatus !== 'function') {
        adminAuthError = 'device_not_provisioned';
        return { configured: true, authenticated: false, lockedUntil: null };
    }
    try {
        const result = await bridge.adminPinStatus({ kioskId: Kiosk.kioskId });
        if (result && result.authenticated && Number(result.expiresAt || 0) > Date.now()) {
            cachedAdminAuthUntil = Number(result.expiresAt);
        }
        return {
            configured: !!(result && result.configured),
            authenticated: isAdminAuthed(),
            lockedUntil: result && result.lockedUntil ? result.lockedUntil : null,
            mustChange: !!(result && result.mustChange)
        };
    } catch (e) {
        console.error('Admin PIN status error:', e);
        adminAuthError = 'device_unavailable';
        return { configured: true, authenticated: false, lockedUntil: null };
    }
}

async function adminEnrollPin(pin, confirmation) {
    adminAuthError = '';
    pin = String(pin || '').trim();
    confirmation = String(confirmation || '').trim();
    if (!adminPinIsValid(pin)) {
        adminAuthError = 'pin_format';
        return false;
    }
    if (pin !== confirmation) {
        adminAuthError = 'pin_mismatch';
        return false;
    }
    if (isLocalAdminDemo()) {
        if (demoAdminPin) {
            adminAuthError = 'pin_already_configured';
            return false;
        }
        demoAdminPin = pin;
        sessionStorage.setItem('pb_demo_admin_pin', demoAdminPin);
        setLocalAdminAuthUntil(Date.now() + (15 * 60 * 1000));
        adminAuditLocal('demo_admin_pin_enrolled');
        return true;
    }
    const bridge = window.PhotoboothDevice;
    if (!bridge || typeof bridge.adminEnrollPin !== 'function') {
        adminAuthError = 'device_not_provisioned';
        return false;
    }
    try {
        const result = await bridge.adminEnrollPin({ kioskId: Kiosk.kioskId, pin });
        if (result && result.success) {
            cachedAdminAuthUntil = Number(result.expiresAt || (Date.now() + (15 * 60 * 1000)));
            return true;
        }
        adminAuthError = (result && result.error) || 'pin_enroll_failed';
    } catch (e) {
        console.error('Admin PIN enrollment error:', e);
        adminAuthError = 'device_unavailable';
    }
    return false;
}

async function adminVerifyPin(pin) {
    adminAuthError = '';
    pin = String(pin || '').trim();
    if (!adminPinIsValid(pin)) {
        adminAuthError = 'pin_format';
        return false;
    }
    if (isLocalAdminDemo()) {
        if (!demoAdminPin) {
            adminAuthError = 'pin_setup_required';
            return false;
        }
        if (demoAdminLockedUntil > Date.now()) {
            adminAuthError = 'pin_locked';
            return false;
        }
        if (pin === demoAdminPin) {
            demoAdminFailedCount = 0;
            demoAdminLockedUntil = 0;
            setLocalAdminAuthUntil(Date.now() + (15 * 60 * 1000));
            adminAuditLocal('demo_admin_login_succeeded');
            return true;
        }
        demoAdminFailedCount += 1;
        if (demoAdminFailedCount >= 5) {
            const exponent = Math.min(8, demoAdminFailedCount - 5);
            demoAdminLockedUntil = Date.now() + Math.min(15 * 60 * 1000, 5000 * (2 ** exponent));
        }
        adminAuditLocal('demo_admin_login_failed', {
            failedCount: demoAdminFailedCount,
            lockedUntil: demoAdminLockedUntil || null
        });
        adminAuthError = demoAdminLockedUntil > Date.now() ? 'pin_locked' : 'pin_incorrect';
        return false;
    }
    const bridge = window.PhotoboothDevice;
    if (!bridge || typeof bridge.adminVerifyPin !== 'function') {
        adminAuthError = 'device_not_provisioned';
        return false;
    }
    try {
        const result = await bridge.adminVerifyPin({ kioskId: Kiosk.kioskId, pin });
        if (result && result.valid) {
            cachedAdminAuthUntil = Number(result.expiresAt || (Date.now() + (15 * 60 * 1000)));
            return true;
        }
        adminAuthError = (result && result.error) || 'pin_incorrect';
    } catch (e) {
        console.error('Admin PIN verify error:', e);
        adminAuthError = 'device_unavailable';
    }
    return false;
}

async function adminChangePin(currentPin, nextPin, confirmation) {
    adminAuthError = '';
    currentPin = String(currentPin || '').trim();
    nextPin = String(nextPin || '').trim();
    confirmation = String(confirmation || '').trim();
    if (!adminPinIsValid(currentPin) || !adminPinIsValid(nextPin)) {
        adminAuthError = 'pin_format';
        return false;
    }
    if (nextPin !== confirmation) {
        adminAuthError = 'pin_mismatch';
        return false;
    }
    if (currentPin === nextPin) {
        adminAuthError = 'pin_unchanged';
        return false;
    }
    if (isLocalAdminDemo()) {
        if (!(await adminVerifyPin(currentPin))) return false;
        demoAdminPin = nextPin;
        sessionStorage.setItem('pb_demo_admin_pin', demoAdminPin);
        demoAdminFailedCount = 0;
        demoAdminLockedUntil = 0;
        setLocalAdminAuthUntil(0);
        adminAuditLocal('demo_admin_pin_changed');
        return true;
    }
    const bridge = window.PhotoboothDevice;
    if (!bridge || typeof bridge.adminChangePin !== 'function') {
        adminAuthError = 'device_not_provisioned';
        return false;
    }
    try {
        const result = await bridge.adminChangePin({
            kioskId: Kiosk.kioskId,
            currentPin,
            nextPin
        });
        if (result && result.success) {
            cachedAdminAuthUntil = 0;
            return true;
        }
        adminAuthError = (result && result.error) || 'pin_change_failed';
    } catch (e) {
        console.error('Admin PIN change error:', e);
        adminAuthError = 'device_unavailable';
    }
    return false;
}

function adminLogout() {
    setLocalAdminAuthUntil(0);
    try {
        if (window.PhotoboothDevice && typeof window.PhotoboothDevice.adminLogout === 'function') {
            window.PhotoboothDevice.adminLogout({ kioskId: Kiosk.kioskId });
        }
    } catch (e) {}
}

// ======================== FILTER SYSTEM ========================

const FILTER_PRESETS = {
    original:  { name: { th: 'ต้นฉบับ',    en: 'Original' },  css: 'none' },
    bw:        { name: { th: 'ขาวดำ',      en: 'B&W' },       css: 'grayscale(100%)' },
    vintage:   { name: { th: 'วินเทจ',     en: 'Vintage' },   css: 'sepia(55%) contrast(108%) brightness(96%)' },
    bright:    { name: { th: 'สดใส',       en: 'Bright' },    css: 'brightness(115%) saturate(125%)' },
    soft:      { name: { th: 'นุ่มนวล',   en: 'Soft' },      css: 'brightness(108%) contrast(88%) saturate(85%)' },
    dramatic:  { name: { th: 'ดราม่า',    en: 'Dramatic' },  css: 'contrast(135%) saturate(130%) brightness(88%)' }
};

// Apply a CSS filter to an array of photo DataURLs via canvas (for processing)
async function applyPhotosFilter(photos, filterName) {
    const preset = FILTER_PRESETS[filterName];
    if (!preset || preset.css === 'none') return photos;

    return Promise.all(photos.map(src => new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const ctx = c.getContext('2d');
            ctx.filter = preset.css;
            ctx.drawImage(img, 0, 0);
            resolve(c.toDataURL('image/jpeg', 0.92));
        };
        img.onerror = () => resolve(src);
        img.src = src;
    })));
}

// ======================== LAYOUT SIZES (SUPABASE) ========================
async function fetchLayoutSizes() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/layout_sizes`, {
            headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'apikey': SUPABASE_ANON_KEY }
        });
        if(res.ok) return await res.json();
    } catch(e) { console.error('Fetch layout sizes error:', e); }
    return [];
}

async function updateLayoutSizes(updatesArray) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/layout_sizes`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'apikey': SUPABASE_ANON_KEY,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates,return=minimal'
            },
            body: JSON.stringify(updatesArray)
        });
        return res.ok;
    } catch(e) { console.error('Update layout sizes error:', e); return false; }
}

// ======================== PRESET THEMES BRANDING (SUPABASE DATABASE) ========================
const PRESET_THEME_IDS = ['light', 'dark', 'mint', 'blue', 'exhibition'];

async function savePresetBrandingToDB(themeName, brandingData) {
    localStorage.setItem('kiosk_branding_' + themeName, JSON.stringify(brandingData));
    try {
        const recordName = 'preset_branding_' + themeName;
        const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/custom_themes?name=eq.${recordName}`, {
            headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'apikey': SUPABASE_ANON_KEY }
        });
        const existing = checkRes.ok ? await checkRes.json() : [];

        const payload = {
            name: recordName,
            theme_type: 'preset_branding',
            header_text: JSON.stringify(brandingData)
        };

        if (existing.length > 0) {
            await fetch(`${SUPABASE_URL}/rest/v1/custom_themes?name=eq.${recordName}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                    'apikey': SUPABASE_ANON_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
        } else {
            await fetch(`${SUPABASE_URL}/rest/v1/custom_themes`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                    'apikey': SUPABASE_ANON_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
        }
        return true;
    } catch(e) {
        console.error('Save preset branding to DB error:', e);
        return false;
    }
}

async function syncPresetBrandingFromDB() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/custom_themes?theme_type=eq.preset_branding`, {
            headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'apikey': SUPABASE_ANON_KEY }
        });
        if (res.ok) {
            const list = await res.json();
            list.forEach(item => {
                if (item.name && item.name.startsWith('preset_branding_') && item.header_text) {
                    const themeName = item.name.replace('preset_branding_', '');
                    try {
                        const brandingData = JSON.parse(item.header_text);
                        localStorage.setItem('kiosk_branding_' + themeName, JSON.stringify(brandingData));
                    } catch(err) {}
                }
            });
        }
    } catch(e) {
        console.error('Sync preset branding error:', e);
    }
}

// Trigger initial sync from DB
syncPresetBrandingFromDB();

// ======================== CUSTOM THEMES (LOCAL STORAGE PER MACHINE) ========================
function getLocalCustomThemes() {
    try {
        const raw = localStorage.getItem('kiosk_local_custom_themes');
        return raw ? JSON.parse(raw) : [];
    } catch(e) { return []; }
}

function saveLocalCustomThemes(themes) {
    localStorage.setItem('kiosk_local_custom_themes', JSON.stringify(themes));
}

async function fetchCustomThemes() {
    return getLocalCustomThemes();
}

async function fetchCustomThemeById(id) {
    const list = getLocalCustomThemes();
    return list.find(t => t.id === id) || null;
}

async function insertCustomTheme(themeObj) {
    const list = getLocalCustomThemes();
    themeObj.id = 'custom_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    themeObj.created_at = new Date().toISOString();
    list.unshift(themeObj);
    saveLocalCustomThemes(list);
    return true;
}

async function removeCustomTheme(id) {
    let list = getLocalCustomThemes();
    list = list.filter(t => t.id !== id);
    saveLocalCustomThemes(list);
    return true;
}

// ======================== INIT ========================
document.addEventListener('DOMContentLoaded', () => {
    preventBackNavigation();
    applyLanguage();
    checkAndInjectEventBanner();
    syncPresetBrandingFromDB();
});
