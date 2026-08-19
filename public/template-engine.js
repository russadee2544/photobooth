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

    function normalizeArtboard(source, canvas) {
        const list = Array.isArray(source) ? source : [];
        const width = canvas.width;
        const height = canvas.height;
        return list
            .slice(0, 32)
            .map((layer, position) => ({
                id: String(layer && layer.id || `ab_${position + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_'),
                name: String(layer && layer.name || `Layer ${position + 1}`).slice(0, 80),
                url: String(layer && layer.url || '').slice(0, 600000),
                placement: layer && layer.placement === 'back' ? 'back' : 'front',
                x: Math.round(number(layer && layer.x, Math.round(width * 0.2), -width, width * 2)),
                y: Math.round(number(layer && layer.y, Math.round(height * 0.2), -height, height * 2)),
                width: Math.round(number(layer && layer.width, Math.round(width * 0.6), 1, width * 2)),
                height: Math.round(number(layer && layer.height, Math.round(height * 0.3), 1, height * 2)),
                rotation: number(layer && layer.rotation, 0, -180, 180),
                zIndex: Math.round(number(layer && layer.zIndex, position + 1, -1000, 1000)),
                opacity: number(layer && layer.opacity, 1, 0, 1),
                visible: layer && layer.visible !== false
            }))
            .sort((a, b) => a.zIndex - b.zIndex);
    }

    function normalizeMargin(source, fallback, axisLimit) {
        const top = Math.round(number(source && source.top, fallback.top, 0, axisLimit));
        const bottom = Math.round(number(source && source.bottom, fallback.bottom, 0, axisLimit));
        const left = Math.round(number(source && source.left, fallback.left, 0, axisLimit));
        const right = Math.round(number(source && source.right, fallback.right, 0, axisLimit));
        return { top, bottom, left, right };
    }

    function parseLayout(layoutId) {
        const match = String(layoutId || '').match(/^(\d+)(?:_([a-z0-9-]+))?$/i);
        const rawRatio = match && match[2] ? match[2].toLowerCase() : '3x4';
        let ratio = '3x4';
        if (rawRatio === '16x9') ratio = '16x9';
        else if (rawRatio === '3x4' || rawRatio === '3:4' || rawRatio === '1x1') ratio = '3x4';
        return {
            count: Math.min(MAX_SLOTS, Math.max(1, match ? Number(match[1]) : 3)),
            ratio
        };
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
        const is16x9 = ratio === '16x9';

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
        const header = Math.max(28, Math.round(width * 0.095));
        const footer = Math.max(48, Math.round(width * 0.16));

        // 4 photos in standard 3:4 ratio -> arranged as 2:2 grid (ฝั่งซ้าย 2:2)
        if (count === 4 && !is16x9) {
            const colW = Math.floor((availableWidth - gap) / 2);
            const slotWidth = colW;
            const slotHeight = Math.round(slotWidth * (4 / 3));

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

        // Single column (1, 2, 3 photos, or 4_16x9 photos vertically):
        // Photos expand to fill full available paper width (width - margins) in their aspect ratio!
        const slotWidth = availableWidth;
        const slotHeight = is16x9 ? Math.round(slotWidth * (9 / 16)) : Math.round(slotWidth * (4 / 3));

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
        const header = Math.round(canvas.height * 0.045);
        const footer = Math.round(canvas.height * 0.085);
        const left = safe.left;
        const top = safe.top + header;
        const availableWidth = canvas.width - left - safe.right;
        const availableHeight = canvas.height - top - safe.bottom - footer;
        const slots = [];

        const is16x9 = ratio === '16x9';

        // Landscape canvas with 3 photos (1 large left + 2 stacked right)
        if (canvas.width > canvas.height && count === 3 && !is16x9) {
            const leftH = availableHeight;
            const leftW = Math.min(Math.floor(availableWidth * 0.58), Math.round(leftH * (3 / 4)));
            const rightH = Math.floor((availableHeight - gap) / 2);
            const rightW = Math.min(availableWidth - leftW - gap, Math.round(rightH * (3 / 4)));
            const totalW = leftW + gap + rightW;
            const xStart = left + Math.max(0, Math.floor((availableWidth - totalW) / 2));

            return [
                { index: 1, x: xStart, y: top, width: leftW, height: leftH, rotation: 0, zIndex: 1, focusX: 0.5, focusY: 0.42 },
                { index: 2, x: xStart + leftW + gap, y: top, width: rightW, height: rightH, rotation: 0, zIndex: 2, focusX: 0.5, focusY: 0.42 },
                { index: 3, x: xStart + leftW + gap, y: top + rightH + gap, width: rightW, height: rightH, rotation: 0, zIndex: 3, focusX: 0.5, focusY: 0.42 }
            ];
        }

        // 4 photos in standard 3:4 ratio (2x2 grid)
        if (count === 4 && !is16x9) {
            const colW = Math.floor((availableWidth - gap) / 2);
            let slotW = colW;
            let slotH = Math.round(slotW * (4 / 3));
            const totalGridH = (slotH * 2) + gap;
            if (totalGridH > availableHeight) {
                const maxRowH = Math.floor((availableHeight - gap) / 2);
                slotH = maxRowH;
                slotW = Math.round(slotH * (3 / 4));
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
        let slotW, slotH;
        if (is16x9) {
            slotW = Math.min(availableWidth, Math.floor(maxSlotH * (16 / 9)));
            slotH = Math.round(slotW * (9 / 16));
        } else {
            slotW = Math.min(availableWidth, Math.floor(maxSlotH * (3 / 4)));
            slotH = Math.round(slotW * (4 / 3));
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
        const template = {
            schemaVersion: VERSION,
            templateId: `tpl_${presetKey.replace(/[^a-z0-9]/g, '_')}_${layoutId}`,
            layoutId,
            name: `${typeNameMap[presetKey] || 'Photo Strip'} · ${parsed.count} ${parsed.count === 1 ? 'photo' : 'photos'}${parsed.ratio === '16x9' ? ' · 16:9' : ''}`,
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
        const stripLayouts = ['1_1x1', '2_1x1', '3_1x1', '3_16x9', '4_1x1', '4_16x9'];
        const postcardLayouts = ['1_1x1', '3_1x1', '4_1x1'];
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
                focusY: number(slot.focusY, 0.42, 0, 1)
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
            canvas,
            overlay: {
                url: String(source.overlay && source.overlay.url || ''),
                zIndex: Math.round(number(source.overlay && source.overlay.zIndex, 100, -1000, 1000))
            },
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
        createTemplate,
        createDefaultTemplates,
        normalizeTemplate,
        duplicateSlot,
        removeSlot,
        moveSlotLayer,
        validateTemplate,
        getCoverCrop
    });
})(typeof globalThis !== 'undefined' ? globalThis : window);
