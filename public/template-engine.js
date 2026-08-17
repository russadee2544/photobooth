(function attachPhotoTemplateEngine(root) {
    'use strict';

    const VERSION = 1;
    const MAX_SLOTS = 8;
    const GRAPHIC_SPECS = Object.freeze({
        photoStrip: Object.freeze({ width: 600, height: 1800, dpi: 300, ratio: '1:3' }),
        photoStripMultiUp: Object.freeze({ width: 1200, height: 1800, dpi: 300, ratio: '2:3', copies: 2 }),
        postcardPortrait: Object.freeze({ width: 1200, height: 1800, dpi: 300, ratio: '2:3' }),
        postcardLandscape: Object.freeze({ width: 1800, height: 1200, dpi: 300, ratio: '3:2' }),
        gifLandscape: Object.freeze({ width: 960, height: 720, ratio: '4:3' }),
        gifSquare: Object.freeze({ width: 1080, height: 1080, ratio: '1:1' }),
        videoPortrait: Object.freeze({ width: 1080, height: 1920, ratio: '9:16' }),
        videoSquare: Object.freeze({ width: 1080, height: 1080, ratio: '1:1' }),
        welcomeIpad129: Object.freeze({ width: 2732, height: 2048, ratio: '4:3' })
    });
    const CANVAS_PRESETS = Object.freeze({
        '2x6': { ...GRAPHIC_SPECS.photoStrip, printTwoPerPage: true, paperSize: '4x6' },
        '4x6-portrait': { ...GRAPHIC_SPECS.postcardPortrait, printTwoPerPage: false, paperSize: '4x6' },
        '4x6-landscape': { ...GRAPHIC_SPECS.postcardLandscape, printTwoPerPage: false, paperSize: '4x6' }
    });

    function number(value, fallback, min, max) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(max, Math.max(min, parsed));
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function parseLayout(layoutId) {
        const match = String(layoutId || '').match(/^(\d+)(?:_([a-z0-9-]+))?$/i);
        const ratio = match && ['1x1', '16x9'].includes(match[2]) ? match[2] : '1x1';
        return {
            count: Math.min(MAX_SLOTS, Math.max(1, match ? Number(match[1]) : 3)),
            ratio
        };
    }

    function makeSlots(layoutId, canvas) {
        const parsed = parseLayout(layoutId);
        const count = parsed.count;
        const safe = canvas.safeMargin;
        const gap = Math.round(canvas.width * 0.027);
        const header = Math.round(canvas.height * 0.045);
        const footer = Math.round(canvas.height * 0.085);
        const left = safe.left + gap;
        const top = safe.top + header;
        const availableWidth = canvas.width - left - safe.right - gap;
        const availableHeight = canvas.height - top - safe.bottom - footer;
        const slots = [];

        if (canvas.width > canvas.height && count === 3) {
            const primaryWidth = Math.floor(availableWidth * 0.62);
            const secondaryWidth = availableWidth - primaryWidth - gap;
            const secondaryHeight = Math.floor((availableHeight - gap) / 2);
            return [
                { index: 1, x: left, y: top, width: primaryWidth, height: availableHeight, rotation: 0, zIndex: 1, focusX: 0.5, focusY: 0.42 },
                { index: 2, x: left + primaryWidth + gap, y: top, width: secondaryWidth, height: secondaryHeight, rotation: 0, zIndex: 2, focusX: 0.5, focusY: 0.42 },
                { index: 3, x: left + primaryWidth + gap, y: top + secondaryHeight + gap, width: secondaryWidth, height: secondaryHeight, rotation: 0, zIndex: 3, focusX: 0.5, focusY: 0.42 }
            ];
        }

        if (count === 4) {
            const width = Math.floor((availableWidth - gap) / 2);
            const height = Math.floor((availableHeight - gap) / 2);
            for (let index = 0; index < count; index += 1) {
                slots.push({
                    index: index + 1,
                    x: left + (index % 2) * (width + gap),
                    y: top + Math.floor(index / 2) * (height + gap),
                    width,
                    height,
                    rotation: 0,
                    zIndex: index + 1,
                    focusX: 0.5,
                    focusY: 0.42
                });
            }
            return slots;
        }

        const height = Math.floor((availableHeight - gap * (count - 1)) / count);
        for (let index = 0; index < count; index += 1) {
            slots.push({
                index: index + 1,
                x: left,
                y: top + index * (height + gap),
                width: availableWidth,
                height,
                rotation: 0,
                zIndex: index + 1,
                focusX: 0.5,
                focusY: 0.42
            });
        }
        return slots;
    }

    function createTemplate(layoutId, type, overrides) {
        const presetKey = type === '4x6-landscape' ? '4x6-landscape' : type === '4x6-portrait' ? '4x6-portrait' : '2x6';
        const preset = CANVAS_PRESETS[presetKey];
        const canvas = {
            width: preset.width,
            height: preset.height,
            dpi: preset.dpi,
            backgroundColor: '#FFFFFF',
            safeMargin: { top: 35, bottom: 35, left: 35, right: 35 }
        };
        const parsed = parseLayout(layoutId);
        const template = {
            schemaVersion: VERSION,
            templateId: `tpl_${presetKey.replace(/[^a-z0-9]/g, '_')}_${layoutId}`,
            layoutId,
            name: `${presetKey === '2x6' ? 'Photo Strip' : 'Postcard'} · ${parsed.count} ${parsed.count === 1 ? 'photo' : 'photos'}${parsed.ratio === '16x9' ? ' · 16:9' : ''}`,
            type: presetKey === '2x6' ? '2x6' : '4x6',
            orientation: presetKey === '4x6-landscape' ? 'landscape' : 'portrait',
            enabled: true,
            canvas,
            overlay: { url: '', zIndex: 100 },
            slots: makeSlots(layoutId, canvas),
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
            ...postcardLayouts.map((layoutId) => createTemplate(layoutId, '4x6-landscape'))
        ];
    }

    function normalizeTemplate(input) {
        const source = input && typeof input === 'object' ? clone(input) : createTemplate('3_1x1', '2x6');
        const isLandscape = source.type === '4x6' && source.orientation === 'landscape';
        const fallback = CANVAS_PRESETS[source.type === '4x6' ? (isLandscape ? '4x6-landscape' : '4x6-portrait') : '2x6'];
        const width = Math.round(number(source.canvas && source.canvas.width, fallback.width, 300, 3600));
        const height = Math.round(number(source.canvas && source.canvas.height, fallback.height, 300, 3600));
        const sourceSafe = source.canvas && source.canvas.safeMargin ? source.canvas.safeMargin : {};
        const canvas = {
            width,
            height,
            dpi: Math.round(number(source.canvas && source.canvas.dpi, 300, 72, 600)),
            backgroundColor: /^#[0-9a-f]{6}$/i.test(source.canvas && source.canvas.backgroundColor) ? source.canvas.backgroundColor : '#FFFFFF',
            safeMargin: {
                top: Math.round(number(sourceSafe.top, 35, 0, height / 3)),
                bottom: Math.round(number(sourceSafe.bottom, 35, 0, height / 3)),
                left: Math.round(number(sourceSafe.left, 35, 0, width / 3)),
                right: Math.round(number(sourceSafe.right, 35, 0, width / 3))
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

        return {
            schemaVersion: VERSION,
            templateId: String(source.templateId || `tpl_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_'),
            layoutId: String(source.layoutId || `${Math.max(1, slots.length)}_1x1`),
            name: String(source.name || 'Untitled template').slice(0, 80),
            type: source.type === '4x6' ? '4x6' : '2x6',
            orientation: isLandscape ? 'landscape' : 'portrait',
            enabled: source.enabled !== false,
            canvas,
            overlay: {
                url: String(source.overlay && source.overlay.url || ''),
                zIndex: Math.round(number(source.overlay && source.overlay.zIndex, 100, -1000, 1000))
            },
            slots,
            printSettings: {
                printTwoPerPage: source.type === '2x6' ? source.printSettings?.printTwoPerPage !== false : false,
                paperSize: '4x6'
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
        value.slots.forEach((slot) => {
            if (slot.x < 0 || slot.y < 0 || slot.x + slot.width > value.canvas.width || slot.y + slot.height > value.canvas.height) {
                errors.push(`Photo slot ${slot.index} is outside the canvas.`);
            }
            if (slot.x < safe.left || slot.y < safe.top || slot.x + slot.width > value.canvas.width - safe.right || slot.y + slot.height > value.canvas.height - safe.bottom) {
                warnings.push(`Photo slot ${slot.index} crosses the safe zone.`);
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
