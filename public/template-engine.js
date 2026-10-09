(function attachPhotoTemplateEngine(root) {
    'use strict';

    const VERSION = 1;
    const MAX_SLOTS = 8;
    const GRAPHIC_SPECS = Object.freeze({
        photoStrip: Object.freeze({ width: 600, height: 1800, dpi: 300, ratio: '1:3' }),
        photoStripMultiUp: Object.freeze({ width: 1200, height: 1800, dpi: 300, ratio: '2:3', copies: 2 }),
        postcardPortrait: Object.freeze({ width: 1200, height: 1800, dpi: 300, ratio: '2:3' }),
        postcardLandscape: Object.freeze({ width: 1800, height: 1200, dpi: 300, ratio: '3:2' }),
        photo5x7: Object.freeze({ width: 1500, height: 2100, dpi: 300, ratio: '5:7' }),
        thermal58: Object.freeze({ width: 384, height: 1152, dpi: 203, ratio: '1:3' }),
        thermal80: Object.freeze({ width: 576, height: 1728, dpi: 203, ratio: '1:3' }),
        thermal100: Object.freeze({ width: 832, height: 2496, dpi: 203, ratio: '1:3' }),
        gifLandscape: Object.freeze({ width: 960, height: 720, ratio: '4:3' }),
        gifSquare: Object.freeze({ width: 1080, height: 1080, ratio: '1:1' }),
        videoPortrait: Object.freeze({ width: 1080, height: 1920, ratio: '9:16' }),
        videoSquare: Object.freeze({ width: 1080, height: 1080, ratio: '1:1' }),
        welcomeIpad129: Object.freeze({ width: 2732, height: 2048, ratio: '4:3' })
    });
    const CANVAS_PRESETS = Object.freeze({
        '2x6': { ...GRAPHIC_SPECS.photoStrip, printTwoPerPage: true, paperSize: '4x6' },
        'photo2x6_single': { ...GRAPHIC_SPECS.photoStrip, printTwoPerPage: false, paperSize: '2x6' },
        'photo4x6_dual': { ...GRAPHIC_SPECS.photoStrip, printTwoPerPage: true, paperSize: '4x6' },
        '4x6-portrait': { ...GRAPHIC_SPECS.postcardPortrait, printTwoPerPage: false, paperSize: '4x6' },
        '4x6-landscape': { ...GRAPHIC_SPECS.postcardLandscape, printTwoPerPage: false, paperSize: '4x6' },
        'photo5x7': { ...GRAPHIC_SPECS.photo5x7, printTwoPerPage: false, paperSize: '5x7' },
        'thermal58': { ...GRAPHIC_SPECS.thermal58, printTwoPerPage: false, paperSize: '58mm' },
        'thermal80': { ...GRAPHIC_SPECS.thermal80, printTwoPerPage: false, paperSize: '80mm' },
        'thermal100': { ...GRAPHIC_SPECS.thermal100, printTwoPerPage: false, paperSize: '100mm' }
    });

    function number(value, fallback, min, max) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(max, Math.max(min, parsed));
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function pxToMm(px, dpi) {
        return Math.round((px * 25.4) / Math.max(1, dpi || 300) * 10) / 10;
    }

    function mmToPx(mm, dpi) {
        return Math.round((mm * Math.max(1, dpi || 300)) / 25.4);
    }

    function defaultBleed(dpi) {
        const px = Math.round((Math.max(1, dpi || 300) * 3) / 25.4);
        return { top: px, right: px, bottom: px, left: px };
    }

    // Nine-slice borders, in source-image pixels. Accepts one number for all
    // four sides. Returns null when there is no border to keep.
    function normalizeSlice(source) {
        if (source === undefined || source === null || source === '') return null;
        const uniform = typeof source === 'number' || typeof source === 'string';
        const side = (key) => Math.round(number(uniform ? source : source[key], 0, 0, 4000));
        const slice = { top: side('top'), right: side('right'), bottom: side('bottom'), left: side('left') };
        return slice.top || slice.right || slice.bottom || slice.left ? slice : null;
    }

    const TEXT_ALIGN = ['left', 'center', 'right'];

    function normalizeTextStyle(layer, height) {
        return {
            text: String(layer && layer.text || '').slice(0, 500),
            fontFamily: String(layer && layer.fontFamily || 'Prompt').replace(/["';{}<>]/g, '').slice(0, 60) || 'Prompt',
            fontWeight: Math.round(number(layer && layer.fontWeight, 600, 100, 900) / 100) * 100,
            fontSize: Math.round(number(layer && layer.fontSize, Math.max(8, Math.round(height * 0.6)), 4, 2000)),
            color: /^#[0-9a-f]{6}$/i.test(layer && layer.color) ? layer.color : '#111111',
            align: TEXT_ALIGN.includes(layer && layer.align) ? layer.align : 'center',
            lineHeight: number(layer && layer.lineHeight, 1.2, 0.8, 3),
            autoFit: !(layer && layer.autoFit === false)
        };
    }

    function normalizeArtboard(source, canvas) {
        const list = Array.isArray(source) ? source : [];
        const width = canvas.width;
        const height = canvas.height;
        return list
            .slice(0, 32)
            .map((layer, position) => {
                const layerHeight = Math.round(number(layer && layer.height, Math.round(height * 0.3), 1, height * 2));
                const base = {
                    id: String(layer && layer.id || `ab_${position + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_'),
                    name: String(layer && layer.name || `Layer ${position + 1}`).slice(0, 80),
                    type: layer && layer.type === 'text' ? 'text' : 'image',
                    url: String(layer && layer.url || '').slice(0, 600000),
                    placement: layer && layer.placement === 'back' ? 'back' : 'front',
                    x: Math.round(number(layer && layer.x, Math.round(width * 0.2), -width, width * 2)),
                    y: Math.round(number(layer && layer.y, Math.round(height * 0.2), -height, height * 2)),
                    width: Math.round(number(layer && layer.width, Math.round(width * 0.6), 1, width * 2)),
                    height: layerHeight,
                    rotation: number(layer && layer.rotation, 0, -180, 180),
                    zIndex: Math.round(number(layer && layer.zIndex, position + 1, -1000, 1000)),
                    opacity: number(layer && layer.opacity, 1, 0, 1),
                    visible: layer && layer.visible !== false
                };
                if (base.type === 'text') return { ...base, url: '', ...normalizeTextStyle(layer, layerHeight) };
                const slice = normalizeSlice(layer && layer.slice);
                return slice ? { ...base, slice } : base;
            })
            .sort((a, b) => a.zIndex - b.zIndex);
    }

    function normalizeMargin(source, fallback, axisLimit) {
        const top = Math.round(number(source && source.top, fallback.top, 0, axisLimit));
        const bottom = Math.round(number(source && source.bottom, fallback.bottom, 0, axisLimit));
        const left = Math.round(number(source && source.left, fallback.left, 0, axisLimit));
        const right = Math.round(number(source && source.right, fallback.right, 0, axisLimit));
        return { top, bottom, left, right };
    }

    function getRatioMultiplier(ratio) {
        switch (ratio) {
            case '1x1':
            case '1:1':
            case 'square':
                return 1.0;
            case '4x3':
            case '4:3':
            case 'landscape':
                return 3 / 4;
            case '16x9':
            case '16:9':
            case 'wide':
                return 9 / 16;
            case '9x16':
            case '9:16':
            case 'story':
                return 16 / 9;
            case '2x3':
            case '2:3':
            case 'film':
                return 3 / 2;
            case '3x2':
            case '3:2':
                return 2 / 3;
            case '3x4':
            case '3:4':
            case 'portrait':
            default:
                return 4 / 3;
        }
    }

    function parseLayout(layoutId) {
        const match = String(layoutId || '').match(/^(\d+)(?:_([a-z0-9:x-]+))?$/i);
        const rawRatio = match && match[2] ? match[2].toLowerCase().replace(':', 'x') : '3x4';
        let ratio = '3x4';
        if (['square', '1:1', 'sq'].includes(rawRatio)) ratio = '1x1';
        else if (['4x3', 'landscape'].includes(rawRatio)) ratio = '4x3';
        else if (['16x9', 'wide'].includes(rawRatio)) ratio = '16x9';
        else if (['9x16', 'story'].includes(rawRatio)) ratio = '9x16';
        else if (['2x3', 'film'].includes(rawRatio)) ratio = '2x3';
        else if (['3x2'].includes(rawRatio)) ratio = '3x2';
        else ratio = '3x4';
        return {
            count: Math.min(MAX_SLOTS, Math.max(1, match ? Number(match[1]) : 3)),
            ratio
        };
    }

    function isTemplateCompatibleWithPaperMode(template, paperMode) {
        if (!template || template.enabled === false) return false;

        const mode = String(paperMode || 'photo4x6_dual');
        const type = String(template.type || '');
        const canvas = template.canvas || {};
        const width = Number(canvas.width);
        const height = Number(canvas.height);
        const dpi = Number(canvas.dpi);

        // Receipt layouts are tied to the exact printer width. Photo layouts
        // and receipt layouts must never leak into each other's mode.
        if (mode === 'thermal58') return type === 'thermal58' && width === 384 && dpi === 203;
        if (mode === 'thermal80') return type === 'thermal80' && width === 576 && dpi === 203;
        if (mode === 'thermal100') return type === 'thermal100' && width === 832 && dpi === 203;

        // A 2x6 strip is photobooth-only. Dual mode imposes two identical
        // strips on one physical 4x6 sheet during composition.
        if (mode === 'photo4x6_dual' || mode === 'photo2x6_single') {
            return type === '2x6' && width === 600 && dpi === 300;
        }

        if (mode === 'photo4x6_postcard') {
            const isPortrait = width === 1200 && height === 1800;
            const isLandscape = width === 1800 && height === 1200;
            return type === '4x6' && dpi === 300 && (isPortrait || isLandscape);
        }

        if (mode === 'photo5x7') {
            return type === 'photo5x7' && width === 1500 && height === 2100 && dpi === 300;
        }

        return false;
    }

    function computeDynamicCanvas(layoutId, presetKey) {
        const parsed = parseLayout(layoutId);
        const count = parsed.count;
        const ratio = parsed.ratio;
        const preset = CANVAS_PRESETS[presetKey] || CANVAS_PRESETS['2x6'];
        const width = preset.width;
        const dpi = preset.dpi || (presetKey.startsWith('thermal') ? 203 : 300);

        // Fixed cut-sheet modes (4x6 postcard, 5x7 card) keep their standard aspect ratio/height
        const isCutSheet = ['4x6-portrait', '4x6-landscape', 'photo5x7'].includes(presetKey);

        // Aesthetic margins (left/right, gap between photos)
        const marginX = Math.max(12, Math.round(width * 0.045));
        const gap = Math.max(8, Math.round(width * 0.028));
        const availableWidth = width - (marginX * 2);

        if (isCutSheet) {
            const height = preset.height;
            const safe = {
                top: Math.round(height * 0.02),
                bottom: Math.round(height * 0.03),
                left: marginX,
                right: marginX
            };
            const canvas = { width, height, dpi, backgroundColor: '#FFFFFF', safeMargin: safe, bleedMargin: defaultBleed(dpi) };
            const slots = makeSlots(layoutId, canvas);
            return { canvas, slots };
        }

        // Dynamic paper height: length is NOT locked, it adapts to the template!
        // Dedicated Header (ส่วนหัวสำหรับ Logo/ชื่ออีเวนต์) and Footer (ส่วนท้ายสำหรับ Logo/แบรนด์/กรอบ)
        const header = Math.max(70, Math.round(width * 0.18));
        const footer = Math.max(100, Math.round(width * 0.28));

        // 4 photos arranged as 2:2 grid when layout is 4 and ratio is not 16:9 or 9:16
        if (count === 4 && ratio !== '16x9' && ratio !== '9x16') {
            const colW = Math.floor((availableWidth - gap) / 2);
            const slotWidth = colW;
            const slotHeight = Math.round(slotWidth * getRatioMultiplier(ratio));

            const totalSlotsHeight = (slotHeight * 2) + gap;
            const height = header + totalSlotsHeight + footer;

            const safe = {
                top: Math.round(header * 0.4),
                bottom: Math.round(footer * 0.4),
                left: marginX,
                right: marginX
            };

            const slots = [];
            for (let i = 0; i < 4; i++) {
                const col = i % 2;
                const row = Math.floor(i / 2);
                slots.push({
                    index: i + 1,
                    x: marginX + col * (slotWidth + gap),
                    y: header + row * (slotHeight + gap),
                    width: slotWidth,
                    height: slotHeight,
                    rotation: 0,
                    zIndex: i + 1,
                    focusX: 0.5,
                    focusY: 0.42
                });
            }

            const canvas = {
                width,
                height,
                dpi,
                backgroundColor: '#FFFFFF',
                safeMargin: safe,
                bleedMargin: defaultBleed(dpi)
            };

            return { canvas, slots };
        }

        // Single column (1, 2, 3, 4 photos vertically):
        // Photos expand to fill full available paper width (width - margins) in their chosen aspect ratio!
        const slotWidth = availableWidth;
        const slotHeight = Math.round(slotWidth * getRatioMultiplier(ratio));

        const totalSlotsHeight = (slotHeight * count) + (gap * (count - 1));
        const height = header + totalSlotsHeight + footer;

        const safe = {
            top: Math.round(header * 0.4),
            bottom: Math.round(footer * 0.4),
            left: marginX,
            right: marginX
        };

        const slots = [];
        for (let i = 0; i < count; i++) {
            slots.push({
                index: i + 1,
                x: marginX,
                y: header + i * (slotHeight + gap),
                width: slotWidth,
                height: slotHeight,
                rotation: 0,
                zIndex: i + 1,
                focusX: 0.5,
                focusY: 0.42
            });
        }

        const canvas = {
            width,
            height,
            dpi,
            backgroundColor: '#FFFFFF',
            safeMargin: safe,
            bleedMargin: defaultBleed(dpi)
        };

        return { canvas, slots };
    }

    function makeSlots(layoutId, canvas) {
        const parsed = parseLayout(layoutId);
        const count = parsed.count;
        const ratio = parsed.ratio;
        const safe = canvas.safeMargin;
        const gap = Math.max(8, Math.round(canvas.width * 0.028));
        const header = Math.max(60, Math.round(canvas.height * 0.075));
        const footer = Math.max(90, Math.round(canvas.height * 0.11));
        const left = safe.left;
        const top = safe.top + header;
        const availableWidth = canvas.width - left - safe.right;
        const availableHeight = canvas.height - top - safe.bottom - footer;
        const slots = [];
        const mult = getRatioMultiplier(ratio);

        // Landscape canvas with 3 photos (1 large left + 2 stacked right)
        if (canvas.width > canvas.height && count === 3 && ratio !== '16x9') {
            const leftH = availableHeight;
            const leftW = Math.min(Math.floor(availableWidth * 0.58), Math.round(leftH / mult));
            const rightH = Math.floor((availableHeight - gap) / 2);
            const rightW = Math.min(availableWidth - leftW - gap, Math.round(rightH / mult));
            const totalW = leftW + gap + rightW;
            const xStart = left + Math.max(0, Math.floor((availableWidth - totalW) / 2));

            return [
                { index: 1, x: xStart, y: top, width: leftW, height: leftH, rotation: 0, zIndex: 1, focusX: 0.5, focusY: 0.42 },
                { index: 2, x: xStart + leftW + gap, y: top, width: rightW, height: rightH, rotation: 0, zIndex: 2, focusX: 0.5, focusY: 0.42 },
                { index: 3, x: xStart + leftW + gap, y: top + rightH + gap, width: rightW, height: rightH, rotation: 0, zIndex: 3, focusX: 0.5, focusY: 0.42 }
            ];
        }

        // 4 photos in 2x2 grid
        if (count === 4 && ratio !== '16x9' && ratio !== '9x16') {
            const colW = Math.floor((availableWidth - gap) / 2);
            let slotW = colW;
            let slotH = Math.round(slotW * mult);
            const totalGridH = (slotH * 2) + gap;
            if (totalGridH > availableHeight) {
                const maxRowH = Math.floor((availableHeight - gap) / 2);
                slotH = maxRowH;
                slotW = Math.round(slotH / mult);
            }
            const totalGridW = (slotW * 2) + gap;
            const xStart = left + Math.max(0, Math.floor((availableWidth - totalGridW) / 2));
            const yStart = top + Math.max(0, Math.floor((availableHeight - ((slotH * 2) + gap)) / 2));

            for (let index = 0; index < 4; index += 1) {
                const col = index % 2;
                const row = Math.floor(index / 2);
                slots.push({
                    index: index + 1,
                    x: xStart + col * (slotW + gap),
                    y: yStart + row * (slotH + gap),
                    width: slotW,
                    height: slotH,
                    rotation: 0,
                    zIndex: index + 1,
                    focusX: 0.5,
                    focusY: 0.42
                });
            }
            return slots;
        }

        // Single column stacked layout (1, 2, 3, 4 photos vertically)
        const maxSlotH = Math.floor((availableHeight - gap * (count - 1)) / count);
        let slotW = Math.min(availableWidth, Math.floor(maxSlotH / mult));
        let slotH = Math.round(slotW * mult);
        if (slotH > maxSlotH) {
            slotH = maxSlotH;
            slotW = Math.min(availableWidth, Math.round(slotH / mult));
        }

        const totalH = slotH * count + gap * (count - 1);
        const yStart = top + Math.max(0, Math.floor((availableHeight - totalH) / 2));
        const xStart = left + Math.max(0, Math.floor((availableWidth - slotW) / 2));

        for (let index = 0; index < count; index += 1) {
            slots.push({
                index: index + 1,
                x: xStart,
                y: yStart + index * (slotH + gap),
                width: slotW,
                height: slotH,
                rotation: 0,
                zIndex: index + 1,
                focusX: 0.5,
                focusY: 0.42
            });
        }
        return slots;
    }

    function createTemplate(layoutId, type, overrides) {
        let presetKey = '2x6';
        if (type && CANVAS_PRESETS[type]) {
            presetKey = type;
        } else if (type === '4x6' || type === '4x6-portrait') {
            presetKey = '4x6-portrait';
        } else if (type === '4x6-landscape') {
            presetKey = '4x6-landscape';
        }
        const preset = CANVAS_PRESETS[presetKey];
        const parsed = parseLayout(layoutId);

        const { canvas, slots } = computeDynamicCanvas(layoutId, presetKey);

        let templateType = '2x6';
        if (presetKey === '4x6-landscape' || presetKey === '4x6-portrait' || presetKey === '4x6') {
            templateType = '4x6';
        } else if (presetKey.startsWith('thermal') || presetKey === 'photo5x7') {
            templateType = presetKey;
        }
        const typeNameMap = {
            '2x6': 'Photo Strip',
            '4x6-portrait': 'Postcard',
            '4x6-landscape': 'Postcard',
            'photo5x7': 'Photo Card 5x7',
            'thermal58': 'Thermal 58mm',
            'thermal80': 'Thermal 80mm',
            'thermal100': 'Thermal 100mm'
        };
        const ratioLabels = {
            '1x1': '1:1 Square',
            '3x4': '3:4 Portrait',
            '4x3': '4:3 Landscape',
            '16x9': '16:9 Wide',
            '9x16': '9:16 Story',
            '2x3': '2:3 Film',
            '3x2': '3:2 Film'
        };
        const ratioText = ratioLabels[parsed.ratio] ? ` · ${ratioLabels[parsed.ratio]}` : '';
        const template = {
            schemaVersion: VERSION,
            templateId: `tpl_${presetKey.replace(/[^a-z0-9]/g, '_')}_${layoutId.replace(/[^a-z0-9]/gi, '_')}`,
            layoutId,
            name: `${typeNameMap[presetKey] || 'Photo Strip'} · ${parsed.count} ${parsed.count === 1 ? 'photo' : 'photos'}${ratioText}`,
            type: templateType,
            orientation: presetKey === '4x6-landscape' ? 'landscape' : 'portrait',
            enabled: true,
            canvas,
            overlay: { url: '', zIndex: 100 },
            artboard: [],
            slots,
            printSettings: {
                printTwoPerPage: preset.printTwoPerPage,
                paperSize: preset.paperSize
            }
        };
        return normalizeTemplate(Object.assign(template, clone(overrides || {})));
    }

    function createDefaultTemplates() {
        const stripLayouts = [
            '1_1x1', '1_3x4', '1_4x3',
            '2_1x1', '2_3x4', '2_4x3',
            '3_1x1', '3_3x4', '3_4x3', '3_16x9',
            '4_1x1', '4_3x4', '4_16x9'
        ];
        const postcardLayouts = [
            '1_1x1', '1_3x4', '1_4x3',
            '2_1x1', '2_3x4',
            '3_1x1', '3_3x4', '3_4x3',
            '4_1x1', '4_3x4'
        ];
        return [
            ...stripLayouts.map((layoutId) => createTemplate(layoutId, '2x6')),
            ...postcardLayouts.map((layoutId) => createTemplate(layoutId, '4x6-portrait')),
            ...postcardLayouts.map((layoutId) => createTemplate(layoutId, '4x6-landscape')),
            ...stripLayouts.map((layoutId) => createTemplate(layoutId, 'thermal58')),
            ...stripLayouts.map((layoutId) => createTemplate(layoutId, 'thermal80')),
            ...stripLayouts.map((layoutId) => createTemplate(layoutId, 'thermal100')),
            ...stripLayouts.map((layoutId) => createTemplate(layoutId, 'photo5x7'))
        ];
    }

    function normalizeTemplateOverlay(overlay) {
        const value = {
            url: String(overlay && overlay.url || ''),
            zIndex: Math.round(number(overlay && overlay.zIndex, 100, -1000, 1000)),
            fitMode: ['cover', 'contain', 'stretch'].includes(overlay && overlay.fitMode) ? overlay.fitMode : 'cover'
        };
        const slice = normalizeSlice(overlay && overlay.slice);
        return slice ? { ...value, slice } : value;
    }

    // Splits an image into 3x3 patches so a frame keeps its corners at their
    // own shape on any box: corners scale evenly with the box's short side,
    // edges stretch along their length, the centre fills the rest.
    function nineSlicePatches(imageWidth, imageHeight, slice, boxWidth, boxHeight) {
        const iw = Math.max(1, imageWidth);
        const ih = Math.max(1, imageHeight);
        let sl = Math.min(slice.left, iw);
        let sr = Math.min(slice.right, iw);
        let st = Math.min(slice.top, ih);
        let sb = Math.min(slice.bottom, ih);
        if (sl + sr > iw) { const f = iw / (sl + sr); sl *= f; sr *= f; }
        if (st + sb > ih) { const f = ih / (st + sb); st *= f; sb *= f; }
        const scale = Math.min(boxWidth, boxHeight) / Math.min(iw, ih);
        let dl = sl * scale;
        let dr = sr * scale;
        let dt = st * scale;
        let db = sb * scale;
        if (dl + dr > boxWidth) { const f = boxWidth / (dl + dr); dl *= f; dr *= f; }
        if (dt + db > boxHeight) { const f = boxHeight / (dt + db); dt *= f; db *= f; }
        const sx = [0, sl, iw - sr, iw];
        const sy = [0, st, ih - sb, ih];
        const dx = [0, dl, boxWidth - dr, boxWidth];
        const dy = [0, dt, boxHeight - db, boxHeight];
        const patches = [];
        for (let row = 0; row < 3; row += 1) {
            for (let col = 0; col < 3; col += 1) {
                const patch = {
                    sx: sx[col], sy: sy[row], sw: sx[col + 1] - sx[col], sh: sy[row + 1] - sy[row],
                    dx: dx[col], dy: dy[row], dw: dx[col + 1] - dx[col], dh: dy[row + 1] - dy[row]
                };
                if (patch.sw > 0 && patch.sh > 0 && patch.dw > 0 && patch.dh > 0) patches.push(patch);
            }
        }
        return patches;
    }

    const TEXT_VARIABLES = ['event_name', 'date', 'time'];

    function resolveTextVariables(text, values) {
        return String(text || '').replace(/\{([a-z_]+)\}/g, (match, key) => {
            if (!TEXT_VARIABLES.includes(key)) return match;
            const value = values && values[key];
            return value === undefined || value === null ? '' : String(value);
        });
    }

    // Thai has no spaces between words, so wrap on word segments when the
    // runtime can find them and fall back to single characters.
    function segmentWords(text) {
        if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
            return Array.from(new Intl.Segmenter('th', { granularity: 'word' }).segment(text), (part) => part.segment);
        }
        return text.split(/(\s+)/).filter(Boolean);
    }

    function wrapText(text, measure, fontSize, maxWidth) {
        const lines = [];
        String(text).split('\n').forEach((paragraph) => {
            let line = '';
            segmentWords(paragraph).forEach((word) => {
                const candidate = line + word;
                if (!line || measure(candidate, fontSize) <= maxWidth) { line = candidate; return; }
                lines.push(line.trimEnd());
                line = word.trimStart();
            });
            lines.push(line.trimEnd());
        });
        return lines;
    }

    // Lays text out inside a box. measure(text, fontSize) returns a width in
    // the same units as the box. With autoFit the font shrinks until every
    // line fits, so a long event name never spills off the paper.
    function layoutText(text, measure, box) {
        const lineHeight = box.lineHeight || 1.2;
        let fontSize = Math.max(4, box.fontSize || 24);
        let lines = wrapText(text, measure, fontSize, box.width);
        const fits = () => lines.length * fontSize * lineHeight <= box.height + 0.5 &&
            lines.every((line) => measure(line, fontSize) <= box.width + 0.5);
        while (box.autoFit !== false && fontSize > 4 && !fits()) {
            fontSize = Math.max(4, fontSize * 0.92);
            lines = wrapText(text, measure, fontSize, box.width);
        }
        return { fontSize, lines, lineHeight: fontSize * lineHeight };
    }

    function normalizeTemplate(input) {
        const source = input && typeof input === 'object' ? clone(input) : createTemplate('3_1x1', '2x6');
        const isLandscape = source.type === '4x6' && source.orientation === 'landscape';
        let fallbackKey = '2x6';
        if (source.type === '4x6') {
            fallbackKey = isLandscape ? '4x6-landscape' : '4x6-portrait';
        } else if (CANVAS_PRESETS[source.type]) {
            fallbackKey = source.type;
        }
        const fallback = CANVAS_PRESETS[fallbackKey] || CANVAS_PRESETS['2x6'];
        const width = Math.round(number(source.canvas && source.canvas.width, fallback.width, 200, 4800));
        const height = Math.round(number(source.canvas && source.canvas.height, fallback.height, 200, 8000));
        const sourceSafe = source.canvas && source.canvas.safeMargin ? source.canvas.safeMargin : {};
        const sourceBleed = source.canvas && source.canvas.bleedMargin ? source.canvas.bleedMargin : {};
        const fallbackBleed = defaultBleed(fallback.dpi || 300);
        const canvas = {
            width,
            height,
            dpi: Math.round(number(source.canvas && source.canvas.dpi, fallback.dpi || 300, 72, 600)),
            backgroundColor: /^#[0-9a-f]{6}$/i.test(source.canvas && source.canvas.backgroundColor) ? source.canvas.backgroundColor : '#FFFFFF',
            backgroundImage: String(source.canvas && source.canvas.backgroundImage || '').slice(0, 400000),
            backgroundFitMode: ['cover', 'contain', 'stretch', 'tile'].includes(source.canvas && source.canvas.backgroundFitMode) ? source.canvas.backgroundFitMode : 'cover',
            safeMargin: {
                top: Math.round(number(sourceSafe.top, 35, 0, height / 3)),
                bottom: Math.round(number(sourceSafe.bottom, 35, 0, height / 3)),
                left: Math.round(number(sourceSafe.left, 35, 0, width / 3)),
                right: Math.round(number(sourceSafe.right, 35, 0, width / 3))
            },
            bleedMargin: {
                top: Math.round(number(sourceBleed.top, fallbackBleed.top, 0, height / 3)),
                bottom: Math.round(number(sourceBleed.bottom, fallbackBleed.bottom, 0, height / 3)),
                left: Math.round(number(sourceBleed.left, fallbackBleed.left, 0, width / 3)),
                right: Math.round(number(sourceBleed.right, fallbackBleed.right, 0, width / 3))
            }
        };
        const slots = (Array.isArray(source.slots) ? source.slots : [])
            .slice(0, MAX_SLOTS)
            .map((slot, position) => ({
                index: Math.round(number(slot.index, position + 1, 1, MAX_SLOTS)),
                x: Math.round(number(slot.x, 0, -width, width * 2)),
                y: Math.round(number(slot.y, 0, -height, height * 2)),
                width: Math.round(number(slot.width, Math.round(width * 0.8), 1, width * 2)),
                height: Math.round(number(slot.height, Math.round(height * 0.25), 1, height * 2)),
                rotation: number(slot.rotation, 0, -180, 180),
                zIndex: Math.round(number(slot.zIndex, position + 1, -1000, 1000)),
                focusX: number(slot.focusX, 0.5, 0, 1),
                focusY: number(slot.focusY, 0.42, 0, 1),
                shape: SHAPE_IDS.includes(slot.shape) ? slot.shape : 'rectangle'
            }))
            .sort((a, b) => a.index - b.index)
            .map((slot, position) => ({ ...slot, index: position + 1 }));

        let finalType = source.type || '2x6';
        if (!['2x6', '4x6', 'photo5x7', 'thermal58', 'thermal80', 'thermal100'].includes(finalType)) {
            finalType = '2x6';
        }

        return {
            schemaVersion: VERSION,
            templateId: String(source.templateId || `tpl_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_'),
            layoutId: String(source.layoutId || `${Math.max(1, slots.length)}_1x1`),
            name: String(source.name || 'Untitled template').slice(0, 80),
            type: finalType,
            orientation: isLandscape ? 'landscape' : 'portrait',
            enabled: source.enabled !== false,
            isCustom: source.isCustom === true,
            universalThemeId: source.universalThemeId ? String(source.universalThemeId) : null,
            canvas,
            overlay: normalizeTemplateOverlay(source.overlay),
            artboard: normalizeArtboard(source.artboard, canvas),
            slots,
            printSettings: {
                printTwoPerPage: source.printSettings?.printTwoPerPage ?? fallback.printTwoPerPage,
                paperSize: source.printSettings?.paperSize ?? fallback.paperSize
            }
        };
    }

    function duplicateSlot(template, photoIndex) {
        const next = normalizeTemplate(template);
        if (next.slots.length >= MAX_SLOTS) return next;
        const original = next.slots.find((slot) => slot.index === Number(photoIndex)) || next.slots[next.slots.length - 1];
        if (!original) return next;
        const offset = Math.max(12, Math.round(Math.min(next.canvas.width, next.canvas.height) * 0.015));
        next.slots.push({
            ...clone(original),
            index: next.slots.length + 1,
            x: Math.min(next.canvas.width - original.width, original.x + offset),
            y: Math.min(next.canvas.height - original.height, original.y + offset),
            zIndex: Math.max(...next.slots.map((slot) => slot.zIndex), 0) + 1
        });
        return normalizeTemplate(next);
    }

    function removeSlot(template, photoIndex) {
        const next = normalizeTemplate(template);
        if (next.slots.length <= 1) return next;
        next.slots = next.slots.filter((slot) => slot.index !== Number(photoIndex));
        return normalizeTemplate(next);
    }

    function moveSlotLayer(template, photoIndex, action) {
        const next = normalizeTemplate(template);
        const slot = next.slots.find((item) => item.index === Number(photoIndex));
        if (!slot) return next;
        const values = next.slots.map((item) => item.zIndex);
        if (action === 'front') slot.zIndex = Math.max(...values) + 1;
        if (action === 'back') slot.zIndex = Math.min(...values) - 1;
        if (action === 'forward') slot.zIndex += 1;
        if (action === 'backward') slot.zIndex -= 1;
        return normalizeTemplate(next);
    }

    function validateTemplate(template) {
        const value = normalizeTemplate(template);
        const errors = [];
        const warnings = [];
        if (!value.slots.length) errors.push('Template must contain at least one photo slot.');
        const safe = value.canvas.safeMargin;
        const bleed = value.canvas.bleedMargin;
        value.slots.forEach((slot) => {
            if (slot.x < 0 || slot.y < 0 || slot.x + slot.width > value.canvas.width || slot.y + slot.height > value.canvas.height) {
                errors.push(`Photo slot ${slot.index} is outside the canvas.`);
            }
            if (slot.x < safe.left || slot.y < safe.top || slot.x + slot.width > value.canvas.width - safe.right || slot.y + slot.height > value.canvas.height - safe.bottom) {
                warnings.push(`Photo slot ${slot.index} crosses the safe zone.`);
            }
            if (slot.x < bleed.left || slot.y < bleed.top || slot.x + slot.width > value.canvas.width - bleed.right || slot.y + slot.height > value.canvas.height - bleed.bottom) {
                warnings.push(`Photo slot ${slot.index} crosses the bleed edge (ตัดตก).`);
            }
        });
        value.artboard.forEach((layer) => {
            if (layer.x < 0 || layer.y < 0 || layer.x + layer.width > value.canvas.width || layer.y + layer.height > value.canvas.height) {
                warnings.push(`Artboard layer "${layer.name}" is outside the canvas.`);
            }
        });
        return { valid: errors.length === 0, errors, warnings, template: value };
    }

    // ---- Photo frame shapes ---------------------------------------------------------------
    // Every shape is an SVG path in a w x h box with its origin at the top-left. The same string
    // clips the photo on the kiosk canvas (new Path2D(d)) and the preview in the editor (CSS path()).
    const SHAPES = [
        { id: 'rectangle', label: 'สี่เหลี่ยมปกติ', labelEn: 'Rectangle' },
        { id: 'rounded', label: 'มุมมน', labelEn: 'Rounded' },
        { id: 'circle', label: 'วงกลม', labelEn: 'Circle' },
        { id: 'oval', label: 'วงรี', labelEn: 'Oval' },
        { id: 'heart', label: 'หัวใจ', labelEn: 'Heart' },
        { id: 'diamond', label: 'ข้าวหลามตัด', labelEn: 'Diamond' },
        { id: 'hexagon', label: 'หกเหลี่ยม', labelEn: 'Hexagon' },
        { id: 'star', label: 'ดาว', labelEn: 'Star' },
        { id: 'arch', label: 'ซุ้มประตู', labelEn: 'Arch' },
        { id: 'stamp', label: 'แสตมป์', labelEn: 'Stamp' }
    ];
    const SHAPE_IDS = SHAPES.map((shape) => shape.id);
    const fix = (value) => Math.round(value * 100) / 100;

    function ellipsePath(cx, cy, rx, ry) {
        return `M${fix(cx - rx)} ${fix(cy)}A${fix(rx)} ${fix(ry)} 0 1 0 ${fix(cx + rx)} ${fix(cy)}A${fix(rx)} ${fix(ry)} 0 1 0 ${fix(cx - rx)} ${fix(cy)}Z`;
    }

    // Closed polygon from unit-square points.
    function polygonPath(points, w, h) {
        return 'M' + points.map(([x, y]) => `${fix(x * w)} ${fix(y * h)}`).join('L') + 'Z';
    }

    // Five-point star scaled to fill the whole box.
    function starPoints() {
        const raw = [];
        for (let k = 0; k < 10; k++) {
            const angle = (-90 + k * 36) * Math.PI / 180;
            const radius = k % 2 === 0 ? 1 : 0.42;
            raw.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
        }
        const xs = raw.map((p) => p[0]);
        const ys = raw.map((p) => p[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        return raw.map(([x, y]) => [(x - minX) / (maxX - minX), (y - minY) / (maxY - minY)]);
    }

    // Heart from cubic curves in the unit square (tip at the bottom centre).
    const HEART = [
        ['M', 0.5, 1],
        ['C', 0.15, 0.74, 0, 0.53, 0, 0.32],
        ['C', 0, 0.13, 0.14, 0, 0.3, 0],
        ['C', 0.4, 0, 0.47, 0.05, 0.5, 0.13],
        ['C', 0.53, 0.05, 0.6, 0, 0.7, 0],
        ['C', 0.86, 0, 1, 0.13, 1, 0.32],
        ['C', 1, 0.53, 0.85, 0.74, 0.5, 1]
    ];

    // A real postage stamp: white paper whose four edges are perforated with semicircular
    // notches, drawn with a thin dark outline. Proportions follow the reference stamp
    // (498x640): notch radius 4.1% of the short side, one notch every ~3 radii, the same
    // pitch on every edge and the row centred so both corners of an edge keep a tooth.
    // `path` is the paper outline, `inset` the rectangle where the photo goes.
    function stampEdgeCentres(length, r, pitch) {
        let count = Math.max(1, Math.floor((length - 2 * r) / pitch) + 1);
        // Never let a corner tooth get thinner than 0.6r (it would look torn).
        while (count > 1 && (length - (count - 1) * pitch) / 2 - r < r * 0.6) count -= 1;
        const first = (length - (count - 1) * pitch) / 2;
        return Array.from({ length: count }, (_, i) => first + i * pitch);
    }

    function stampGeometry(w, h) {
        const base = Math.min(w, h);
        const r = Math.max(1.5, base * 0.041);
        const pitch = r * 2.98;
        const margin = Math.min(r * 2.6, base * 0.3);
        const notch = (x, y) => `A${fix(r)} ${fix(r)} 0 0 0 ${fix(x)} ${fix(y)}`;
        const across = stampEdgeCentres(w, r, pitch);
        const down = stampEdgeCentres(h, r, pitch);
        let d = 'M0 0';
        for (const cx of across) d += `L${fix(cx - r)} 0${notch(cx + r, 0)}`;
        d += `L${fix(w)} 0`;
        for (const cy of down) d += `L${fix(w)} ${fix(cy - r)}${notch(w, cy + r)}`;
        d += `L${fix(w)} ${fix(h)}`;
        for (const cx of across.slice().reverse()) d += `L${fix(cx + r)} ${fix(h)}${notch(cx - r, h)}`;
        d += `L0 ${fix(h)}`;
        for (const cy of down.slice().reverse()) d += `L0 ${fix(cy + r)}${notch(0, cy - r)}`;
        d += 'Z';
        return {
            path: d,
            inset: { x: margin, y: margin, w: Math.max(1, w - 2 * margin), h: Math.max(1, h - 2 * margin) },
            radius: r,
            notches: { across: across.length, down: down.length },
            stroke: Math.max(1, base * 0.004),
            strokeColor: '#111111'
        };
    }

    function shapeSvgPath(shape, w, h) {
        switch (shape) {
            case 'rounded': {
                const r = Math.min(w, h) * 0.14;
                return `M${fix(r)} 0H${fix(w - r)}A${fix(r)} ${fix(r)} 0 0 1 ${fix(w)} ${fix(r)}V${fix(h - r)}A${fix(r)} ${fix(r)} 0 0 1 ${fix(w - r)} ${fix(h)}H${fix(r)}A${fix(r)} ${fix(r)} 0 0 1 0 ${fix(h - r)}V${fix(r)}A${fix(r)} ${fix(r)} 0 0 1 ${fix(r)} 0Z`;
            }
            case 'circle': { const size = Math.min(w, h); return ellipsePath(w / 2, h / 2, size / 2, size / 2); }
            case 'oval': return ellipsePath(w / 2, h / 2, w / 2, h / 2);
            case 'heart':
                return HEART.map(([cmd, ...n]) => cmd + n.map((v, i) => fix(v * (i % 2 === 0 ? w : h))).join(' ')).join('') + 'Z';
            case 'diamond': return polygonPath([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]], w, h);
            case 'hexagon': return polygonPath([[0.5, 0], [1, 0.25], [1, 0.75], [0.5, 1], [0, 0.75], [0, 0.25]], w, h);
            case 'star': return polygonPath(starPoints(), w, h);
            case 'arch': {
                const rx = w / 2;
                const ry = Math.min(w / 2, h * 0.8);
                return `M0 ${fix(h)}V${fix(ry)}A${fix(rx)} ${fix(ry)} 0 0 1 ${fix(w)} ${fix(ry)}V${fix(h)}Z`;
            }
            case 'stamp': return stampGeometry(w, h).path;
            default: return `M0 0H${fix(w)}V${fix(h)}H0Z`;
        }
    }

    function getCoverCrop(sourceWidth, sourceHeight, targetWidth, targetHeight, focusX, focusY) {
        const imageRatio = sourceWidth / sourceHeight;
        const targetRatio = targetWidth / targetHeight;
        let width = sourceWidth;
        let height = sourceHeight;
        if (imageRatio > targetRatio) width = sourceHeight * targetRatio;
        else height = sourceWidth / targetRatio;
        const fx = number(focusX, 0.5, 0, 1);
        const fy = number(focusY, 0.42, 0, 1);
        return {
            x: Math.max(0, Math.min(sourceWidth - width, sourceWidth * fx - width / 2)),
            y: Math.max(0, Math.min(sourceHeight - height, sourceHeight * fy - height / 2)),
            width,
            height
        };
    }

    function generateCustomTemplate(config = {}) {
        const paperPreset = config.paperPreset || '2x6';
        let basePreset = CANVAS_PRESETS[paperPreset] || CANVAS_PRESETS['2x6'];
        let width = number(config.width, basePreset.width, 200, 5000);
        let height = number(config.height, basePreset.height, 200, 5000);
        let dpi = number(config.dpi, basePreset.dpi || 300, 72, 600);
        
        // safe margins
        const marginType = config.marginType || 'normal'; // 'compact', 'normal', 'wide'
        let marginPx = Math.round(width * 0.04);
        if (marginType === 'compact') marginPx = Math.round(width * 0.02);
        if (marginType === 'wide') marginPx = Math.round(width * 0.065);
        
        const safeMargin = {
            top: marginPx,
            left: marginPx,
            right: marginPx,
            bottom: marginPx
        };

        // Header & Footer space
        const hfType = config.hfType || 'normal'; // 'none', 'compact', 'normal', 'large'
        let headerPx = Math.round(height * 0.05);
        let footerPx = Math.round(height * 0.08);
        if (hfType === 'none') { headerPx = 0; footerPx = 0; }
        else if (hfType === 'compact') { headerPx = Math.round(height * 0.025); footerPx = Math.round(height * 0.04); }
        else if (hfType === 'large') { headerPx = Math.round(height * 0.08); footerPx = Math.round(height * 0.13); }

        // Gap between slots
        const gapType = config.gapType || 'normal'; // 'none', 'compact', 'normal', 'wide'
        let gap = Math.round(width * 0.03);
        if (gapType === 'none') gap = 0;
        else if (gapType === 'compact') gap = Math.round(width * 0.015);
        else if (gapType === 'wide') gap = Math.round(width * 0.055);

        const count = number(config.photoCount, 3, 1, 8);
        const ratio = config.aspectRatio || '3x4';
        const mult = getRatioMultiplier(ratio);

        const availableX = safeMargin.left;
        const availableY = safeMargin.top + headerPx;
        const availableW = Math.max(50, width - safeMargin.left - safeMargin.right);
        const availableH = Math.max(50, height - availableY - safeMargin.bottom - footerPx);

        const layoutStyle = config.layoutStyle || 'auto'; 
        const slots = [];

        if (layoutStyle === 'featured_top' && count === 3) {
            // 1 big on top, 2 small stacked below
            const topH = Math.floor((availableH - gap) * 0.58);
            const topW = Math.min(availableW, Math.round(topH / mult));
            const topX = availableX + Math.floor((availableW - topW) / 2);
            
            const btmRowH = availableH - topH - gap;
            const btmSlotW = Math.floor((availableW - gap) / 2);
            const btmSlotH = Math.min(btmRowH, Math.round(btmSlotW * mult));
            const btmActualW = Math.round(btmSlotH / mult);
            const btmTotalW = btmActualW * 2 + gap;
            const btmXStart = availableX + Math.floor((availableW - btmTotalW) / 2);
            const btmY = availableY + topH + gap + Math.floor((btmRowH - btmSlotH) / 2);

            slots.push({ index: 1, x: topX, y: availableY, width: topW, height: topH, rotation: 0, zIndex: 1, focusX: 0.5, focusY: 0.42 });
            slots.push({ index: 2, x: btmXStart, y: btmY, width: btmActualW, height: btmSlotH, rotation: 0, zIndex: 2, focusX: 0.5, focusY: 0.42 });
            slots.push({ index: 3, x: btmXStart + btmActualW + gap, y: btmY, width: btmActualW, height: btmSlotH, rotation: 0, zIndex: 3, focusX: 0.5, focusY: 0.42 });
        } else if (layoutStyle === 'grid2' || (layoutStyle === 'auto' && (count === 4 || count === 6 || count === 8) && width >= height * 0.6)) {
            // 2 Columns Grid
            const cols = 2;
            const rows = Math.ceil(count / cols);
            const maxSlotW = Math.floor((availableW - gap * (cols - 1)) / cols);
            const maxSlotH = Math.floor((availableH - gap * (rows - 1)) / rows);

            let slotW = maxSlotW;
            let slotH = Math.round(slotW * mult);
            if (slotH > maxSlotH) {
                slotH = maxSlotH;
                slotW = Math.round(slotH / mult);
            }

            const totalGridW = slotW * cols + gap * (cols - 1);
            const totalGridH = slotH * rows + gap * (rows - 1);
            const xStart = availableX + Math.max(0, Math.floor((availableW - totalGridW) / 2));
            const yStart = availableY + Math.max(0, Math.floor((availableH - totalGridH) / 2));

            for (let i = 0; i < count; i++) {
                const col = i % cols;
                const row = Math.floor(i / cols);
                slots.push({
                    index: i + 1,
                    x: xStart + col * (slotW + gap),
                    y: yStart + row * (slotH + gap),
                    width: slotW,
                    height: slotH,
                    rotation: 0,
                    zIndex: i + 1,
                    focusX: 0.5,
                    focusY: 0.42
                });
            }
        } else {
            // Single Column Vertical Strip (or horizontal row for wide landscape)
            if (width > height && count <= 4 && layoutStyle !== 'strip') {
                // Horizontal row
                const maxSlotW = Math.floor((availableW - gap * (count - 1)) / count);
                let slotH = Math.min(availableH, Math.round(maxSlotW * mult));
                let slotW = Math.round(slotH / mult);
                if (slotW > maxSlotW) {
                    slotW = maxSlotW;
                    slotH = Math.round(slotW * mult);
                }
                const totalW = slotW * count + gap * (count - 1);
                const xStart = availableX + Math.max(0, Math.floor((availableW - totalW) / 2));
                const yStart = availableY + Math.max(0, Math.floor((availableH - slotH) / 2));

                for (let i = 0; i < count; i++) {
                    slots.push({
                        index: i + 1,
                        x: xStart + i * (slotW + gap),
                        y: yStart,
                        width: slotW,
                        height: slotH,
                        rotation: 0,
                        zIndex: i + 1,
                        focusX: 0.5,
                        focusY: 0.42
                    });
                }
            } else {
                // Vertical Column Strip
                const maxSlotH = Math.floor((availableH - gap * (count - 1)) / count);
                let slotW = Math.min(availableW, Math.floor(maxSlotH / mult));
                let slotH = Math.round(slotW * mult);
                if (slotH > maxSlotH) {
                    slotH = maxSlotH;
                    slotW = Math.min(availableW, Math.round(slotH / mult));
                }
                const totalH = slotH * count + gap * (count - 1);
                const yStart = availableY + Math.max(0, Math.floor((availableH - totalH) / 2));
                const xStart = availableX + Math.max(0, Math.floor((availableW - slotW) / 2));

                for (let i = 0; i < count; i++) {
                    slots.push({
                        index: i + 1,
                        x: xStart,
                        y: yStart + i * (slotH + gap),
                        width: slotW,
                        height: slotH,
                        rotation: 0,
                        zIndex: i + 1,
                        focusX: 0.5,
                        focusY: 0.42
                    });
                }
            }
        }

        let templateType = '2x6';
        if (paperPreset === '4x6-landscape' || paperPreset === '4x6-portrait' || paperPreset === '4x6') {
            templateType = '4x6';
        } else if (paperPreset.startsWith('thermal') || paperPreset === 'photo5x7') {
            templateType = paperPreset;
        }

        const templateId = `custom_${crypto.randomUUID ? crypto.randomUUID().replace(/-/g,'').slice(0,12) : Date.now().toString(36)}`;
        const templateName = config.name || `ธีมกำหนดเอง · ${count} รูป (${ratio})`;

        const template = {
            schemaVersion: VERSION,
            templateId,
            layoutId: `${count}_${ratio}`,
            name: templateName,
            type: templateType,
            orientation: width >= height ? 'landscape' : 'portrait',
            isCustom: true,
            enabled: true,
            canvas: {
                width,
                height,
                dpi,
                backgroundColor: config.backgroundColor || '#FFFFFF',
                safeMargin,
                bleedMargin: defaultBleed(dpi)
            },
            overlay: { url: '', zIndex: 100 },
            artboard: [],
            slots,
            printSettings: {
                printTwoPerPage: basePreset.printTwoPerPage !== undefined ? basePreset.printTwoPerPage : (paperPreset === '2x6'),
                paperSize: basePreset.paperSize || (width >= 1000 && height >= 1600 ? '4x6' : 'custom')
            }
        };

        return normalizeTemplate(template);
    }

    // ------------------------------------------------------------------
    // Universal Theme v2
    // A theme stores placement *rules* instead of absolute positions: each
    // element is anchored to a region of the target layout (header, footer,
    // photo slots, ...) and sized from the paper's short side or physical mm,
    // so applying it to a strip, a postcard or a landscape card keeps the
    // design's proportions instead of stretching it.
    // ------------------------------------------------------------------
    const THEME_SCHEMA_VERSION = 2;
    const RATIO_BUCKETS = Object.freeze(['strip', 'portrait', 'square', 'landscape']);
    const ANCHOR_TARGETS = ['canvas', 'safe', 'header', 'footer', 'slots', 'slot', 'each-slot'];
    const SIZE_MODES = ['short-side', 'physical-mm', 'fit-region', 'region-width', 'stretch'];
    const PHOTO_COVER_LIMIT = 0.15;

    function getRatioBucket(width, height) {
        const ratio = Number(width) / Math.max(1, Number(height) || 1);
        if (ratio < 0.45) return 'strip';
        if (ratio < 0.9) return 'portrait';
        if (ratio <= 1.1) return 'square';
        return 'landscape';
    }

    function makeRect(x, y, width, height) {
        return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
    }

    function rotatedBounds(x, y, width, height, rotation) {
        const angle = (Number(rotation) || 0) * Math.PI / 180;
        if (!angle) return makeRect(x, y, width, height);
        const cx = x + width / 2;
        const cy = y + height / 2;
        const cos = Math.abs(Math.cos(angle));
        const sin = Math.abs(Math.sin(angle));
        const w = width * cos + height * sin;
        const h = width * sin + height * cos;
        return makeRect(cx - w / 2, cy - h / 2, w, h);
    }

    function overlapArea(a, b) {
        const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        return w > 0 && h > 0 ? w * h : 0;
    }

    function computeThemeRegions(template) {
        const source = normalizeTemplate(template);
        const { width, height, safeMargin } = source.canvas;
        const canvasRect = makeRect(0, 0, width, height);
        const safeRect = makeRect(safeMargin.left, safeMargin.top, width - safeMargin.left - safeMargin.right, height - safeMargin.top - safeMargin.bottom);
        const slotRects = source.slots.map((slot) => ({
            index: slot.index,
            rotation: slot.rotation || 0,
            rect: makeRect(slot.x, slot.y, slot.width, slot.height),
            bounds: rotatedBounds(slot.x, slot.y, slot.width, slot.height, slot.rotation)
        }));
        let slotsRect = safeRect;
        if (slotRects.length) {
            const left = Math.min(...slotRects.map((s) => s.bounds.x));
            const top = Math.min(...slotRects.map((s) => s.bounds.y));
            const right = Math.max(...slotRects.map((s) => s.bounds.x + s.bounds.width));
            const bottom = Math.max(...slotRects.map((s) => s.bounds.y + s.bounds.height));
            slotsRect = makeRect(left, top, right - left, bottom - top);
        }
        const slotsBottom = slotsRect.y + slotsRect.height;
        const safeBottom = safeRect.y + safeRect.height;
        // Header/footer are the bands between the safe edge and the photos. When
        // the photos reach into the safe margin, fall back to the paper edge.
        const header = slotsRect.y - safeRect.y >= 1
            ? makeRect(safeRect.x, safeRect.y, safeRect.width, slotsRect.y - safeRect.y)
            : makeRect(safeRect.x, 0, safeRect.width, Math.max(0, slotsRect.y));
        const footer = safeBottom - slotsBottom >= 1
            ? makeRect(safeRect.x, slotsBottom, safeRect.width, safeBottom - slotsBottom)
            : makeRect(safeRect.x, slotsBottom, safeRect.width, Math.max(0, height - slotsBottom));
        return {
            bucket: getRatioBucket(width, height),
            shortSide: Math.min(width, height),
            dpi: source.canvas.dpi,
            canvas: canvasRect,
            safe: safeRect,
            header,
            footer,
            slots: slotsRect,
            slotRects
        };
    }

    function themeWarning(code, message, elementId) {
        return elementId ? { code, message, elementId } : { code, message };
    }

    function normalizeThemeElement(source, position) {
        const el = source && typeof source === 'object' ? source : {};
        const anchor = el.anchor || {};
        const size = el.size || {};
        const to = ANCHOR_TARGETS.includes(anchor.to) ? anchor.to : 'canvas';
        const mode = SIZE_MODES.includes(size.mode) ? size.mode : 'short-side';
        return {
            id: String(el.id || `el_${position + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_'),
            name: String(el.name || `Sticker ${position + 1}`).slice(0, 80),
            url: String(el.url || '').slice(0, 600000),
            placement: el.placement === 'back' ? 'back' : 'front',
            anchor: {
                to,
                slot: to === 'slot' ? Math.round(number(anchor.slot, 1, 1, MAX_SLOTS)) : undefined,
                h: ['left', 'center', 'right'].includes(anchor.h) ? anchor.h : 'center',
                v: ['top', 'middle', 'bottom'].includes(anchor.v) ? anchor.v : 'middle',
                unit: anchor.unit === 'region' ? 'region' : 'short',
                dx: number(anchor.dx, 0, -10, 10),
                dy: number(anchor.dy, 0, -10, 10)
            },
            size: {
                mode,
                value: number(size.value, 0.3, 0.001, 1000),
                valueY: mode === 'stretch' ? number(size.valueY, 0.3, 0.001, 10) : undefined,
                max: size.max === undefined || size.max === null ? null : number(size.max, 1, 0.01, 10)
            },
            aspectRatio: number(el.aspectRatio, 1, 0.01, 100),
            rotation: number(el.rotation, 0, -180, 180),
            zIndex: Math.round(number(el.zIndex, position + 1, -1000, 1000)),
            opacity: number(el.opacity, 1, 0, 1),
            visible: el.visible !== false,
            avoidSlots: el.avoidSlots !== false,
            allowOverflow: el.allowOverflow === true,
            ...themeElementContent(el)
        };
    }

    // Image elements may carry a nine-slice border; text elements keep their
    // style with the font size as a share of the box height, so text scales
    // with the box the rules give it.
    function themeElementContent(el) {
        if (el.type === 'text') {
            const style = normalizeTextStyle(el, 100);
            delete style.fontSize;
            return { type: 'text', ...style, fontScale: number(el.fontScale, 0.6, 0.05, 5) };
        }
        const slice = normalizeSlice(el.slice);
        return slice ? { type: 'image', slice } : { type: 'image' };
    }

    function normalizeOverlayStyle(overlay) {
        const value = overlay && typeof overlay === 'object' ? overlay : {};
        const buckets = Array.isArray(value.buckets)
            ? value.buckets.filter((bucket) => RATIO_BUCKETS.includes(bucket))
            : null;
        const slice = normalizeSlice(value.slice);
        return {
            url: String(value.url || ''),
            zIndex: Math.round(number(value.zIndex, 100, -1000, 1000)),
            fitMode: ['cover', 'contain', 'stretch'].includes(value.fitMode) ? value.fitMode : 'cover',
            // A nine-slice frame fits any paper shape, so it is never limited.
            buckets: slice ? null : buckets,
            slice
        };
    }

    // Converts any stored theme (v1 relative-coordinate themes included) into
    // a normalized v2 theme. v1 sizes become short-side sizes so a sticker no
    // longer triples in size on a landscape card.
    function migrateUniversalTheme(theme) {
        if (!theme || typeof theme !== 'object' || !theme.style) {
            throw new Error('Universal Theme is invalid or missing style.');
        }
        const source = clone(theme);
        const style = source.style;
        const sourceCanvas = source.sourceCanvas || {};
        const srcW = Math.max(1, Number(sourceCanvas.width) || 600);
        const srcH = Math.max(1, Number(sourceCanvas.height) || 1800);
        const srcShort = Math.min(srcW, srcH);
        const isV2 = Number(source.schemaVersion) >= THEME_SCHEMA_VERSION;

        const rawElements = isV2
            ? (Array.isArray(style.elements) ? style.elements : [])
            : (Array.isArray(style.artboard) ? style.artboard : []).map((layer, index) => {
                const stretch = layer.scaleMode === 'stretch';
                return {
                    id: layer.id || `ut_art_${index + 1}`,
                    name: layer.name,
                    url: layer.url,
                    placement: layer.placement,
                    anchor: { to: 'canvas', h: 'left', v: 'top', unit: 'region', dx: Number(layer.relX) || 0, dy: Number(layer.relY) || 0 },
                    size: stretch
                        ? { mode: 'stretch', value: Number(layer.relWidth) || 0.3, valueY: Number(layer.relHeight) || 0.3 }
                        : { mode: 'short-side', value: ((Number(layer.relWidth) || 0.3) * srcW) / srcShort },
                    aspectRatio: layer.aspectRatio,
                    rotation: layer.rotation,
                    zIndex: layer.zIndex,
                    opacity: layer.opacity,
                    visible: layer.visible
                };
            });

        const variants = {};
        if (isV2 && style.variants && typeof style.variants === 'object') {
            RATIO_BUCKETS.forEach((bucket) => {
                const variant = style.variants[bucket];
                if (variant && typeof variant === 'object') variants[bucket] = clone(variant);
            });
        }

        const overlay = normalizeOverlayStyle(style.overlay);
        return {
            schemaVersion: THEME_SCHEMA_VERSION,
            themeId: String(source.themeId || `utheme_${Date.now().toString(36)}`),
            name: String(source.name || 'Universal Theme').slice(0, 80),
            enabled: source.enabled !== false,
            createdAt: source.createdAt || null,
            updatedAt: source.updatedAt || null,
            sourceCanvas: {
                width: srcW,
                height: srcH,
                type: sourceCanvas.type || null,
                orientation: sourceCanvas.orientation || null,
                dpi: Number(sourceCanvas.dpi) || null,
                bucket: RATIO_BUCKETS.includes(sourceCanvas.bucket) ? sourceCanvas.bucket : getRatioBucket(srcW, srcH)
            },
            style: {
                backgroundColor: /^#[0-9a-f]{6}$/i.test(style.backgroundColor) ? style.backgroundColor : '#FFFFFF',
                backgroundImage: String(style.backgroundImage || ''),
                backgroundFitMode: ['cover', 'contain', 'stretch', 'tile'].includes(style.backgroundFitMode) ? style.backgroundFitMode : 'cover',
                overlay,
                elements: rawElements.slice(0, 32).map(normalizeThemeElement),
                variants
            }
        };
    }

    function resolveThemeForBucket(theme, bucket) {
        const variant = theme.style.variants[bucket];
        if (!variant) return theme.style;
        const overrides = variant.elements && typeof variant.elements === 'object' ? variant.elements : {};
        const elements = theme.style.elements.map((el, index) => {
            const patch = overrides[el.id];
            if (!patch || typeof patch !== 'object') return el;
            return normalizeThemeElement({
                ...el,
                ...patch,
                anchor: { ...el.anchor, ...(patch.anchor || {}) },
                size: { ...el.size, ...(patch.size || {}) }
            }, index);
        });
        return {
            ...theme.style,
            backgroundColor: /^#[0-9a-f]{6}$/i.test(variant.backgroundColor) ? variant.backgroundColor : theme.style.backgroundColor,
            backgroundImage: typeof variant.backgroundImage === 'string' ? variant.backgroundImage : theme.style.backgroundImage,
            backgroundFitMode: ['cover', 'contain', 'stretch', 'tile'].includes(variant.backgroundFitMode) ? variant.backgroundFitMode : theme.style.backgroundFitMode,
            overlay: variant.overlay ? normalizeOverlayStyle({ ...theme.style.overlay, ...variant.overlay, buckets: [bucket] }) : theme.style.overlay,
            elements
        };
    }

    // A kiosk's own adjustments on top of a shared theme. Small on purpose so a new
    // version of the shared theme still applies: only what the kiosk changed is kept.
    //   { backgroundColor, backgroundImage,
    //     elements: { [id]: { visible, text, url, color, opacity, anchor: {dx, dy}, size: {value} } } }
    const OVERRIDE_ELEMENT_KEYS = ['visible', 'text', 'url', 'color', 'opacity', 'fontWeight', 'fontFamily'];

    function applyThemeOverrides(universalTheme, overrides) {
        const theme = migrateUniversalTheme(universalTheme);
        if (!overrides || typeof overrides !== 'object') return theme;
        const style = theme.style;
        if (/^#[0-9a-f]{6}$/i.test(overrides.backgroundColor)) style.backgroundColor = overrides.backgroundColor;
        if (typeof overrides.backgroundImage === 'string') style.backgroundImage = overrides.backgroundImage.slice(0, 2000000);
        const patches = overrides.elements && typeof overrides.elements === 'object' ? overrides.elements : {};
        style.elements = style.elements.map((el, index) => {
            const patch = patches[el.id];
            if (!patch || typeof patch !== 'object') return el;
            const next = { ...el };
            for (const key of OVERRIDE_ELEMENT_KEYS) {
                if (patch[key] !== undefined) next[key] = patch[key];
            }
            if (patch.anchor && typeof patch.anchor === 'object') {
                next.anchor = { ...el.anchor };
                if (Number.isFinite(patch.anchor.dx)) next.anchor.dx = patch.anchor.dx;
                if (Number.isFinite(patch.anchor.dy)) next.anchor.dy = patch.anchor.dy;
            }
            if (patch.size && Number.isFinite(patch.size.value)) next.size = { ...el.size, value: patch.size.value };
            return normalizeThemeElement(next, index);
        });
        return theme;
    }

    function sizeElement(el, region, regions) {
        const aspect = el.aspectRatio || 1;
        let width;
        let height;
        if (el.size.mode === 'stretch') {
            width = el.size.value * region.width;
            height = el.size.valueY * region.height;
        } else {
            if (el.size.mode === 'physical-mm') width = mmToPx(el.size.value, regions.dpi);
            else if (el.size.mode === 'region-width') width = el.size.value * region.width;
            else if (el.size.mode === 'fit-region') width = Math.min(region.width * el.size.value, region.height * el.size.value * aspect);
            else width = el.size.value * regions.shortSide;
            height = width / aspect;
        }
        if (el.size.max && region.width > 0 && region.height > 0) {
            const limit = Math.min(1, (region.width * el.size.max) / width, (region.height * el.size.max) / height);
            width *= limit;
            height *= limit;
        }
        return { width: Math.max(4, width), height: Math.max(4, height) };
    }

    function placeInRegion(el, region, regions, size) {
        const ux = el.anchor.unit === 'region' ? region.width : regions.shortSide;
        const uy = el.anchor.unit === 'region' ? region.height : regions.shortSide;
        let x;
        if (el.anchor.h === 'left') x = region.x;
        else if (el.anchor.h === 'right') x = region.x + region.width - size.width;
        else x = region.x + (region.width - size.width) / 2;
        let y;
        if (el.anchor.v === 'top') y = region.y;
        else if (el.anchor.v === 'bottom') y = region.y + region.height - size.height;
        else y = region.y + (region.height - size.height) / 2;
        return { x: x + el.anchor.dx * ux, y: y + el.anchor.dy * uy };
    }

    // Places an element anchored to a (possibly rotated) photo slot: lay it out
    // in the slot's own frame, then turn it with the slot around the slot centre.
    function placeOnSlot(el, slot, regions) {
        const size = sizeElement(el, slot.rect, regions);
        const local = placeInRegion(el, slot.rect, regions, size);
        let x = local.x;
        let y = local.y;
        let rotation = el.rotation;
        if (slot.rotation) {
            const angle = slot.rotation * Math.PI / 180;
            const scx = slot.rect.x + slot.rect.width / 2;
            const scy = slot.rect.y + slot.rect.height / 2;
            const ex = x + size.width / 2 - scx;
            const ey = y + size.height / 2 - scy;
            x = scx + ex * Math.cos(angle) - ey * Math.sin(angle) - size.width / 2;
            y = scy + ex * Math.sin(angle) + ey * Math.cos(angle) - size.height / 2;
            rotation = ((rotation + slot.rotation + 540) % 360) - 180;
        }
        return { ...size, x, y, rotation };
    }

    // Short-side sizing makes header/footer items larger on wide paper, where
    // the band above or below the photos can be much shorter. Shrink them,
    // keeping their shape, until they fit between the paper edge and photos.
    function fitBand(size, el, regions) {
        if (el.allowOverflow || (el.anchor.to !== 'header' && el.anchor.to !== 'footer')) return size;
        const slotsBottom = regions.slots.y + regions.slots.height;
        const bandHeight = el.anchor.to === 'header' ? regions.slots.y : regions.canvas.height - slotsBottom;
        if (bandHeight < 4) return size;
        const limit = Math.min(1, bandHeight / size.height, regions.canvas.width / size.width);
        return { width: size.width * limit, height: size.height * limit };
    }

    // Offsets are relative, so on a much shorter header or footer an element
    // can be pushed past the paper edge. Pull it back inside the paper, and
    // keep header/footer elements on their side of the photos, when it fits.
    function keepInBand(layer, anchorTo, regions) {
        const box = rotatedBounds(layer.x, layer.y, layer.width, layer.height, layer.rotation);
        const slotsBottom = regions.slots.y + regions.slots.height;
        let top = 0;
        let bottom = regions.canvas.height;
        if (anchorTo === 'header') bottom = regions.slots.y;
        if (anchorTo === 'footer') top = slotsBottom;
        let { x, y } = layer;
        if (box.width <= regions.canvas.width) {
            x += Math.max(0, -box.x) - Math.max(0, box.x + box.width - regions.canvas.width);
        }
        if (box.height <= bottom - top) {
            y += Math.max(0, top - box.y) - Math.max(0, box.y + box.height - bottom);
        }
        return { ...layer, x, y };
    }

    function photoCoverRatio(box, regions) {
        return regions.slotRects.reduce((worst, slot) => {
            const area = Math.max(1, slot.rect.width * slot.rect.height);
            return Math.max(worst, overlapArea(box, slot.bounds) / area);
        }, 0);
    }

    // Moves an element that covers a photo up into the header or down into the
    // footer, whichever is the shorter move that still fits on the paper.
    function nudgeOffPhotos(layer, regions) {
        const box = rotatedBounds(layer.x, layer.y, layer.width, layer.height, layer.rotation);
        const slotsTop = regions.slots.y;
        const slotsBottom = regions.slots.y + regions.slots.height;
        const offsetY = layer.y - box.y;
        const options = [
            slotsTop - box.height,
            slotsBottom
        ]
            .map((top) => ({ top, shift: Math.abs(top - box.y) }))
            .filter((option) => option.top >= 0 && option.top + box.height <= regions.canvas.height)
            .sort((a, b) => a.shift - b.shift);
        if (!options.length) return null;
        return { ...layer, y: options[0].top + offsetY };
    }

    function applyUniversalThemeWithReport(universalTheme, targetTemplate) {
        const theme = migrateUniversalTheme(universalTheme);
        const target = normalizeTemplate(targetTemplate);
        const regions = computeThemeRegions(target);
        const style = resolveThemeForBucket(theme, regions.bucket);
        const warnings = [];

        target.canvas.backgroundColor = style.backgroundColor;
        target.canvas.backgroundImage = style.backgroundImage;
        target.canvas.backgroundFitMode = style.backgroundFitMode;

        // A full-page frame is drawn for one paper shape. On another shape it
        // would be cropped or stretched, so it is only used where it was made
        // for (or where a variant supplies a frame for this shape).
        const overlay = style.overlay;
        const overlayFits = !overlay.buckets || overlay.buckets.includes(regions.bucket);
        target.overlay = overlay.url && overlayFits
            ? { url: overlay.url, zIndex: overlay.zIndex, fitMode: overlay.fitMode, slice: overlay.slice }
            : { url: '', zIndex: overlay.zIndex, fitMode: overlay.fitMode };
        if (overlay.url && !overlayFits) {
            warnings.push(themeWarning('overlay_skipped', `กรอบเต็มแผ่นออกแบบไว้สำหรับกระดาษทรง ${overlay.buckets.join(', ')} จึงไม่ใส่บนกระดาษทรง ${regions.bucket} (กันภาพเบี้ยว)`));
        } else if (overlay.url && !overlay.buckets && !overlay.slice && regions.bucket !== theme.sourceCanvas.bucket && overlay.fitMode !== 'contain') {
            warnings.push(themeWarning('overlay_may_distort', `กรอบเต็มแผ่นออกแบบบนกระดาษทรง ${theme.sourceCanvas.bucket} อาจถูกตัดหรือยืดบนทรง ${regions.bucket}`));
        }

        const layers = [];
        style.elements.forEach((el) => {
            if (el.type === 'image' && !el.url) return;
            if (el.type === 'text' && !el.text) return;
            if (el.anchor.to === 'each-slot' || el.anchor.to === 'slot') {
                const slots = el.anchor.to === 'each-slot'
                    ? regions.slotRects
                    : regions.slotRects.filter((slot) => slot.index === el.anchor.slot);
                if (!slots.length) {
                    warnings.push(themeWarning('slot_missing', `"${el.name}" ยึดกับรูปที่ ${el.anchor.slot} แต่ layout นี้ไม่มีรูปนั้น`, el.id));
                    return;
                }
                slots.forEach((slot) => {
                    const placed = placeOnSlot(el, slot, regions);
                    layers.push({ el, id: el.anchor.to === 'each-slot' ? `ut_${el.id}_s${slot.index}` : `ut_${el.id}`, ...placed });
                });
                return;
            }
            const region = regions[el.anchor.to];
            if (!region || region.width < 1 || region.height < 1) {
                warnings.push(themeWarning('region_empty', `"${el.name}" ยึดกับ ${el.anchor.to} แต่ layout นี้ไม่มีพื้นที่ส่วนนั้น จึงวางเทียบทั้งแผ่นแทน`, el.id));
            }
            const area = region && region.width >= 1 && region.height >= 1 ? region : regions.canvas;
            const size = fitBand(sizeElement(el, area, regions), el, regions);
            const pos = placeInRegion(el, area, regions, size);
            let layer = { el, id: `ut_${el.id}`, ...size, ...pos, rotation: el.rotation };
            if (!el.allowOverflow) layer = keepInBand(layer, el.anchor.to, regions);
            if (el.visible && el.placement === 'front' && el.avoidSlots) {
                const box = rotatedBounds(layer.x, layer.y, layer.width, layer.height, layer.rotation);
                if (photoCoverRatio(box, regions) > PHOTO_COVER_LIMIT) {
                    const moved = nudgeOffPhotos(layer, regions);
                    const movedBox = moved && rotatedBounds(moved.x, moved.y, moved.width, moved.height, moved.rotation);
                    if (moved && photoCoverRatio(movedBox, regions) <= PHOTO_COVER_LIMIT) {
                        layer = moved;
                        warnings.push(themeWarning('nudged', `เลื่อน "${el.name}" ออกจากรูปถ่ายอัตโนมัติ`, el.id));
                    } else {
                        warnings.push(themeWarning('covers_photo', `"${el.name}" ทับรูปถ่ายและไม่มีที่ว่างให้เลื่อน`, el.id));
                    }
                }
            }
            layers.push(layer);
        });

        target.artboard = layers.map((layer) => {
            const el = layer.el;
            const out = {
                id: layer.id,
                name: el.name,
                type: el.type,
                url: el.url,
                placement: el.placement,
                x: Math.round(layer.x),
                y: Math.round(layer.y),
                width: Math.round(layer.width),
                height: Math.round(layer.height),
                rotation: Math.round(layer.rotation * 10) / 10,
                zIndex: el.zIndex,
                opacity: el.opacity,
                visible: el.visible
            };
            if (el.type === 'text') {
                return {
                    ...out,
                    text: el.text, fontFamily: el.fontFamily, fontWeight: el.fontWeight, color: el.color,
                    align: el.align, lineHeight: el.lineHeight, autoFit: el.autoFit,
                    fontSize: Math.max(4, Math.round(el.fontScale * layer.height))
                };
            }
            return el.slice ? { ...out, slice: el.slice } : out;
        });

        target.isCustom = true;
        target.universalThemeId = theme.themeId;
        const baseName = target.name.replace(/^[^(]+·\s*/, '').replace(/\(.*?\)/g, '').trim() || target.layoutId;
        target.name = `${theme.name} · ${baseName}`;
        target.templateId = `custom_${theme.themeId.replace(/^utheme_/, '')}_${target.type}_${target.layoutId}_${target.orientation}`.replace(/[^a-zA-Z0-9_-]/g, '_');

        const result = normalizeTemplate(target);
        result.artboard.forEach((layer) => {
            if (layer.x < 0 || layer.y < 0 || layer.x + layer.width > result.canvas.width || layer.y + layer.height > result.canvas.height) {
                warnings.push(themeWarning('outside_canvas', `"${layer.name}" ล้นขอบกระดาษ`, layer.id));
            }
        });
        return { template: result, warnings, bucket: regions.bucket };
    }

    function applyUniversalTheme(universalTheme, targetTemplate) {
        return applyUniversalThemeWithReport(universalTheme, targetTemplate).template;
    }

    function pickAlignment(position, start, length, low, high) {
        if (length <= 0) return low;
        const relative = (position - start) / length;
        if (Math.abs(relative - 0.5) < 0.08) return 'center';
        return relative < 0.5 ? low : high;
    }

    // Reads a finished template and turns each decoration into a placement
    // rule: things in the header stay in the header, things in the footer stay
    // in the footer, and everything is sized from the paper's short side.
    // Applying the result back onto the same template reproduces it.
    function extractUniversalTheme(template, name) {
        const source = normalizeTemplate(template);
        const regions = computeThemeRegions(source);
        const themeId = `utheme_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        const themeName = (name || source.name || 'Untitled Theme')
            .replace(/·.*$/, '')
            .replace(/\(.*?\)/g, '')
            .trim() || 'Universal Theme';

        const elements = (source.artboard || []).map((layer, index) => {
            const width = Math.max(1, layer.width);
            const height = Math.max(1, layer.height);
            const cx = layer.x + width / 2;
            const cy = layer.y + height / 2;
            const box = rotatedBounds(layer.x, layer.y, width, height, layer.rotation);
            const coversPhoto = photoCoverRatio(box, regions) > PHOTO_COVER_LIMIT;
            let to = 'canvas';
            if (!coversPhoto && regions.slotRects.length) {
                if (cy < regions.slots.y && regions.header.height >= 1) to = 'header';
                else if (cy > regions.slots.y + regions.slots.height && regions.footer.height >= 1) to = 'footer';
            }
            const region = regions[to];
            const unit = to === 'canvas' ? 'region' : 'short';
            const h = pickAlignment(cx, region.x, region.width, 'left', 'right');
            const v = pickAlignment(cy, region.y, region.height, 'top', 'bottom');
            const fitsRegion = to !== 'canvas' && width <= region.width + 1 && height <= region.height + 1;
            // A decoration deliberately bleeding off the paper keeps doing so
            // instead of being pulled back in.
            const kept = keepInBand({ x: layer.x, y: layer.y, width, height, rotation: layer.rotation }, to, regions);
            const fitted = fitBand({ width, height }, { anchor: { to } }, regions);
            const allowOverflow = kept.x !== layer.x || kept.y !== layer.y || fitted.width < width - 0.5;
            const el = normalizeThemeElement({
                // A layer placed from a theme is `ut_<element id>`; keep the element id so
                // kiosk overrides (keyed by it) still match the next published version.
                id: layer.id ? String(layer.id).replace(/^(ut_)+(?!art_\d+$)/, '') || layer.id : `ut_art_${index + 1}`,
                name: layer.name || `Sticker ${index + 1}`,
                url: layer.url,
                placement: layer.placement,
                anchor: { to, h, v, unit, dx: 0, dy: 0 },
                size: { mode: 'short-side', value: width / regions.shortSide, max: fitsRegion ? 1 : null },
                aspectRatio: width / height,
                rotation: layer.rotation,
                zIndex: layer.zIndex,
                opacity: layer.opacity,
                visible: layer.visible,
                avoidSlots: !coversPhoto,
                allowOverflow,
                type: layer.type,
                slice: layer.slice,
                text: layer.text,
                fontFamily: layer.fontFamily,
                fontWeight: layer.fontWeight,
                color: layer.color,
                align: layer.align,
                lineHeight: layer.lineHeight,
                autoFit: layer.autoFit,
                fontScale: layer.type === 'text' ? layer.fontSize / height : undefined
            }, index);
            // Offsets that reproduce the exact source position from the anchor.
            const base = placeInRegion(el, region, regions, { width, height });
            const ux = unit === 'region' ? region.width : regions.shortSide;
            const uy = unit === 'region' ? region.height : regions.shortSide;
            el.anchor.dx = ux > 0 ? (layer.x - base.x) / ux : 0;
            el.anchor.dy = uy > 0 ? (layer.y - base.y) / uy : 0;
            return el;
        });

        const overlayUrl = (source.overlay && source.overlay.url) || '';
        return {
            schemaVersion: THEME_SCHEMA_VERSION,
            themeId,
            name: themeName,
            enabled: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            sourceCanvas: {
                width: source.canvas.width,
                height: source.canvas.height,
                type: source.type,
                orientation: source.orientation,
                dpi: source.canvas.dpi,
                bucket: regions.bucket
            },
            style: {
                backgroundColor: source.canvas.backgroundColor || '#FFFFFF',
                backgroundImage: source.canvas.backgroundImage || '',
                backgroundFitMode: source.canvas.backgroundFitMode || 'cover',
                overlay: normalizeOverlayStyle({
                    url: overlayUrl,
                    zIndex: (source.overlay && source.overlay.zIndex) || 100,
                    fitMode: (source.overlay && source.overlay.fitMode) || 'cover',
                    buckets: overlayUrl ? [regions.bucket] : null,
                    slice: source.overlay && source.overlay.slice
                }),
                elements,
                variants: {}
            }
        };
    }

    root.PhotoTemplateEngine = Object.freeze({
        VERSION,
        MAX_SLOTS,
        GRAPHIC_SPECS,
        CANVAS_PRESETS,
        clone,
        pxToMm,
        mmToPx,
        defaultBleed,
        parseLayout,
        isTemplateCompatibleWithPaperMode,
        createTemplate,
        createDefaultTemplates,
        generateCustomTemplate,
        normalizeTemplate,
        duplicateSlot,
        removeSlot,
        moveSlotLayer,
        validateTemplate,
        getCoverCrop,
        THEME_SCHEMA_VERSION,
        RATIO_BUCKETS,
        getRatioBucket,
        computeThemeRegions,
        migrateUniversalTheme,
        SHAPES,
        shapeSvgPath,
        stampGeometry,
        extractUniversalTheme,
        applyUniversalTheme,
        applyUniversalThemeWithReport,
        applyThemeOverrides,
        normalizeSlice,
        nineSlicePatches,
        TEXT_VARIABLES,
        resolveTextVariables,
        layoutText
    });
})(typeof globalThis !== 'undefined' ? globalThis : window);
