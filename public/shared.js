/* ============================================================
   RETRO_SNAP — Shared JavaScript
   ============================================================ */

const SUPABASE_URL = 'https://zualrdvvlcoexqrbedhl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1YWxyZHZ2bGNvZXhxcmJlZGhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1MTYwMjMsImV4cCI6MjEwMDA5MjAyM30.1JgXhpQccIOxgFgvx_G7cBlnCkSiWQhEihUAd8xCyV8';
const SUPABASE_BUCKET = 'photobooth';

const Session = {
    set(key, val) {
        localStorage.setItem('pb_' + key, JSON.stringify(val));
    },
    get(key) {
        const val = localStorage.getItem('pb_' + key);
        return val ? JSON.parse(val) : null;
    },
    clear() {
        const lang = localStorage.getItem('pb_lang');
        const cam = localStorage.getItem('pb_camera_id');
        const kMode = localStorage.getItem('kiosk_mode');
        const kEvent = localStorage.getItem('kiosk_event_name');
        
        // Preserve ALL branding keys before clearing
        const brandingKeys = Object.keys(localStorage).filter(k => k.startsWith('kiosk_branding_'));
        const brandingData = {};
        brandingKeys.forEach(k => { brandingData[k] = localStorage.getItem(k); });
        
        localStorage.clear();
        
        if (lang) localStorage.setItem('pb_lang', lang);
        if (cam) localStorage.setItem('pb_camera_id', cam);
        if (kMode) localStorage.setItem('kiosk_mode', kMode);
        if (kEvent) localStorage.setItem('kiosk_event_name', kEvent);
        
        // Restore branding keys
        Object.entries(brandingData).forEach(([k, v]) => localStorage.setItem(k, v));
    }
};

const Kiosk = {
    get mode() { return localStorage.getItem('kiosk_mode') || 'normal'; },
    set mode(v) { localStorage.setItem('kiosk_mode', v); },
    get eventName() { return localStorage.getItem('kiosk_event_name') || ''; },
    set eventName(v) { localStorage.setItem('kiosk_event_name', v); }
};

['layout', 'photos', 'template', 'result', 'dithered', 'colorCloudUrl', 'ditheredCloudUrl'].forEach(key => {
    Object.defineProperty(Session, key, {
        get: function() { return this.get(key); },
        set: function(v) { this.set(key, v); }
    });
});

const i18n = {
    "en": {
        "title": "Photo Booth",
        "cam_error": "Camera Error",
        "retake_btn": "Retake",
        "btn_process": "Process",
        "proc_title": "Processing Photos",
        "proc_desc": "Applying high-quality filters...",
        "print_title": "Your photos are ready.",
        "print_desc": "Scan the QR code to save to your digital wallet.",
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
        "print_desc": "สแกน QR Code เพื่อบันทึกรูปภาพ",
        "print_color": "ภาพสีพรีเมียม",
        "print_retro": "ภาพเรโทร",
        "btn_finish": "เสร็จสิ้น",
        "btn_print": "พิมพ์ใบเสร็จ",
        "uploading": "กำลังอัปโหลด...",
        "brand": "MEMORIES",
        "home_subtitle": "ตู้ถ่ายภาพดิจิทัลระดับพรีเมียม",
        "home_start": "แตะเพื่อเริ่ม",
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
    constructor(timeoutMs, redirectUrl) {
        this.timeoutMs = timeoutMs;
        this.redirectUrl = redirectUrl;
        this.timer = null;
        this._onActivity = this.reset.bind(this);
    }
    start() {
        ['touchstart', 'click', 'mousemove', 'keydown'].forEach(evt => {
            document.addEventListener(evt, this._onActivity, { passive: true });
        });
        this.reset();
    }
    reset() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            Session.clear();
            window.location.href = this.redirectUrl;
        }, this.timeoutMs);
    }
    stop() {
        clearTimeout(this.timer);
        ['touchstart', 'click', 'mousemove', 'keydown'].forEach(evt => {
            document.removeEventListener(evt, this._onActivity);
        });
    }
}

class CameraManager {
    constructor(videoEl) {
        this.videoEl = videoEl;
        this.stream = null;
    }
    async start(deviceId = null) {
        try {
            const constraints = { video: { width: { ideal: 1920 }, height: { ideal: 1080 } } };
            if (deviceId) constraints.video.deviceId = { exact: deviceId };
            else constraints.video.facingMode = 'user';
            
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.videoEl.srcObject = this.stream;
            this.videoEl.play();
            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    }
    stop() {
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
    }
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

function composeStrip(photos, templateName, outputWidth = 600, customThemeObj = null, layoutStr = '3_1x1') {
    const photoCount = photos.length;
    const scale = outputWidth / 600;
    
    // Paper width = 80mm (8cm) = outputWidth (1200px at scale 2)
    // 1cm = 150px (at scale 2). So at scale 1, 1cm = 75px.
    // 5cm = 375px at scale 1 (750px at scale 2)
    // 2.5cm = 187.5px at scale 1 (375px at scale 2)
    let pt = 375 * scale; // padding top (5cm)
    let pb = 187.5 * scale; // padding bottom (2.5cm)
    let px = 24 * scale; // padding x (left/right)
    let ps = 16 * scale; // photo spacing
    
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
            photoHeight = photoWidth; // 1:1
        }
        totalHeight = pt + pb + (photoHeight * count) + (ps * (count - 1));
        
        for (let i = 0; i < count; i++) {
            coords.push({ x: px, y: pt + i * (photoHeight + ps) });
        }
    } else if (count === 4) {
        photoWidth = Math.round((availableWidth - ps) / 2);
        if (ratio === '16x9') {
            photoHeight = Math.round(photoWidth * (9/16));
        } else {
            photoHeight = photoWidth; // 1:1
        }
        totalHeight = pt + pb + (photoHeight * 2) + ps;

        coords.push({ x: px, y: pt }); // Top-Left
        coords.push({ x: px + photoWidth + ps, y: pt }); // Top-Right
        coords.push({ x: px, y: pt + photoHeight + ps }); // Bottom-Left
        coords.push({ x: px + photoWidth + ps, y: pt + photoHeight + ps }); // Bottom-Right
    } else {
        photoWidth = availableWidth;
        photoHeight = photoWidth;
        totalHeight = pt + pb + (photoHeight * count) + (ps * (count - 1));
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
                        const imgRatio = im.width / im.height;
                        const boxRatio = photoWidth / photoHeight;
                        let srcX = 0, srcY = 0, srcW = im.width, srcH = im.height;

                        if (imgRatio > boxRatio) {
                            srcW = im.height * boxRatio;
                            srcX = (im.width - srcW) / 2;
                        } else {
                            srcH = im.width / boxRatio;
                            srcY = (im.height - srcH) / 2;
                        }

                        // Photo
                        ctx.drawImage(im, srcX, srcY, srcW, srcH, x, y, photoWidth, photoHeight);
                        
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

// ======================== SUPABASE UPLOAD ========================
async function uploadToCloud(dataUrl, filename) {
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
}

async function logSessionToCloud(colorUrl, ditheredUrl) {
    try {
        const payload = {
            kiosk_mode: Kiosk.mode,
            event_name: Kiosk.mode === 'event' ? Kiosk.eventName : null,
            layout: Session.layout,
            color_url: colorUrl,
            dithered_url: ditheredUrl
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
    const modeStatus = Kiosk.mode === 'event' ? `EVENT (${Kiosk.eventName || 'EVENT MODE'})` : 'NORMAL';
    
    if (statusEl) {
        statusEl.textContent = `© PHOTO BOOTH • ${modeStatus}`;
    }
}

// ======================== REDEEM CODE SYSTEM ========================

// Validate a redeem code: check existence + not used today
async function validateRedeemCode(code) {
    code = code.toUpperCase().trim();
    
    // Check format: 2 letters + 4 digits
    if (!/^[A-Z]{2}\d{4}$/.test(code)) {
        return { valid: false, error: 'invalid_format' };
    }

    try {
        // Check if code exists
        const codeRes = await fetch(
            `${SUPABASE_URL}/rest/v1/redeem_codes?code=eq.${code}&select=code`,
            { headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'apikey': SUPABASE_ANON_KEY } }
        );
        const codeData = await codeRes.json();
        if (!codeData || codeData.length === 0) {
            return { valid: false, error: 'not_found' };
        }

        // Check if used today
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const usageRes = await fetch(
            `${SUPABASE_URL}/rest/v1/redeem_usage?code=eq.${code}&used_date=eq.${today}&select=id`,
            { headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'apikey': SUPABASE_ANON_KEY } }
        );
        const usageData = await usageRes.json();
        if (usageData && usageData.length > 0) {
            return { valid: false, error: 'used_today' };
        }

        return { valid: true, error: null };
    } catch (e) {
        console.error('Redeem validation error:', e);
        return { valid: false, error: 'network_error' };
    }
}

// Mark a code as used today
async function markCodeUsed(code) {
    code = code.toUpperCase().trim();
    const today = new Date().toISOString().split('T')[0];
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/redeem_usage`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'apikey': SUPABASE_ANON_KEY,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ code: code, used_date: today })
        });
        return res.ok;
    } catch (e) {
        console.error('Mark code used error:', e);
        return false;
    }
}

// Generate N redeem codes (default 50), save to Supabase
async function generateRedeemCodes(count = 50) {
    // Fetch existing codes to avoid duplicates
    let existingCodes = new Set();
    try {
        const res = await fetch(
            `${SUPABASE_URL}/rest/v1/redeem_codes?select=code`,
            { headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'apikey': SUPABASE_ANON_KEY } }
        );
        const data = await res.json();
        data.forEach(d => existingCodes.add(d.code));
    } catch (e) {
        console.error('Fetch existing codes error:', e);
    }

    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // exclude I, O to avoid confusion
    const newCodes = [];
    const batchId = 'B' + Date.now();

    while (newCodes.length < count) {
        const l1 = letters[Math.floor(Math.random() * letters.length)];
        const l2 = letters[Math.floor(Math.random() * letters.length)];
        const nums = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
        const code = l1 + l2 + nums;
        if (!existingCodes.has(code) && !newCodes.includes(code)) {
            newCodes.push(code);
        }
    }

    // Insert batch to Supabase
    const rows = newCodes.map(code => ({ code, batch_id: batchId }));
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/redeem_codes`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'apikey': SUPABASE_ANON_KEY,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(rows)
        });
        if (!res.ok) throw new Error('Insert failed: ' + res.status);
        return { success: true, codes: newCodes, batchId };
    } catch (e) {
        console.error('Generate codes error:', e);
        return { success: false, codes: [], batchId: null };
    }
}

// Fetch all codes with today's usage status
async function fetchRedeemCodes() {
    const today = new Date().toISOString().split('T')[0];
    try {
        // Fetch all codes
        const codesRes = await fetch(
            `${SUPABASE_URL}/rest/v1/redeem_codes?select=code,batch_id,created_at&order=created_at.desc`,
            { headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'apikey': SUPABASE_ANON_KEY } }
        );
        const codes = await codesRes.json();

        // Fetch today's usage
        const usageRes = await fetch(
            `${SUPABASE_URL}/rest/v1/redeem_usage?used_date=eq.${today}&select=code`,
            { headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'apikey': SUPABASE_ANON_KEY } }
        );
        const usageData = await usageRes.json();
        const usedToday = new Set(usageData.map(u => u.code));

        return codes.map(c => ({
            ...c,
            usedToday: usedToday.has(c.code)
        }));
    } catch (e) {
        console.error('Fetch redeem codes error:', e);
        return [];
    }
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

