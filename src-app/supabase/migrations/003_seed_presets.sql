-- =============================================================================
-- Migration: 003_seed_presets.sql
-- Description: Seed canonical layout presets and image filters for 80mm thermal
-- printing (576 dots width).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Seed Layout Presets
-- ---------------------------------------------------------------------------
INSERT INTO layout_presets (
  id,
  name,
  name_en,
  description,
  canvas_width,
  canvas_height,
  slots,
  logo_area,
  photo_count,
  capture_aspect
) VALUES
(
  'classic_3',
  'คลาสสิก 3 ช็อต',
  'Classic 3-Strip',
  'สตริปภาพ 3 ช็อตแนวนอน สไตล์โฟโต้บูธยอดนิยม (576x1200 dots)',
  576,
  1200,
  '[
    {"index": 1, "x": 48, "y": 30, "w": 480, "h": 360, "aspect": "4:3"},
    {"index": 2, "x": 48, "y": 410, "w": 480, "h": 360, "aspect": "4:3"},
    {"index": 3, "x": 48, "y": 790, "w": 480, "h": 360, "aspect": "4:3"}
  ]'::jsonb,
  '{"x": 48, "y": 1160, "w": 480, "h": 30}'::jsonb,
  3,
  '4:3'
),
(
  'classic_4',
  'คลาสสิก 4 ช็อต',
  'Classic 4-Strip',
  'สตริปภาพ 4 ช็อตแนวยาว จุใจทุกโมเมนต์ (576x1400 dots)',
  576,
  1400,
  '[
    {"index": 1, "x": 88, "y": 25, "w": 400, "h": 300, "aspect": "4:3"},
    {"index": 2, "x": 88, "y": 345, "w": 400, "h": 300, "aspect": "4:3"},
    {"index": 3, "x": 88, "y": 665, "w": 400, "h": 300, "aspect": "4:3"},
    {"index": 4, "x": 88, "y": 985, "w": 400, "h": 300, "aspect": "4:3"}
  ]'::jsonb,
  '{"x": 48, "y": 1300, "w": 480, "h": 80}'::jsonb,
  4,
  '4:3'
),
(
  'duo',
  'ดูโอ้ 2 ช็อต',
  'Duo 2-Shot',
  'ภาพคู่ 2 ช็อต ขนาดกำลังดี (576x900 dots)',
  576,
  900,
  '[
    {"index": 1, "x": 48, "y": 40, "w": 480, "h": 360, "aspect": "4:3"},
    {"index": 2, "x": 48, "y": 430, "w": 480, "h": 360, "aspect": "4:3"}
  ]'::jsonb,
  '{"x": 48, "y": 810, "w": 480, "h": 60}'::jsonb,
  2,
  '4:3'
),
(
  'portrait',
  'พอร์ตเทรต 1 ช็อต',
  'Single Portrait',
  'ภาพเดี่ยวขนาดใหญ่แนวตั้ง ชัดเจนเต็มใบ (576x900 dots)',
  576,
  900,
  '[
    {"index": 1, "x": 36, "y": 50, "w": 504, "h": 672, "aspect": "3:4"}
  ]'::jsonb,
  '{"x": 36, "y": 740, "w": 504, "h": 120}'::jsonb,
  1,
  '3:4'
),
(
  'grid_4',
  'กริด 4 ช่อง (2x2)',
  'Grid 2x2',
  'ภาพสี่เหลี่ยมจัตุรัส 4 ช่อง เรียงแบบ 2x2 (576x900 dots)',
  576,
  900,
  '[
    {"index": 1, "x": 38, "y": 80, "w": 240, "h": 240, "aspect": "1:1"},
    {"index": 2, "x": 298, "y": 80, "w": 240, "h": 240, "aspect": "1:1"},
    {"index": 3, "x": 38, "y": 340, "w": 240, "h": 240, "aspect": "1:1"},
    {"index": 4, "x": 298, "y": 340, "w": 240, "h": 240, "aspect": "1:1"}
  ]'::jsonb,
  '{"x": 38, "y": 620, "w": 500, "h": 240}'::jsonb,
  4,
  '1:1'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  name_en = EXCLUDED.name_en,
  description = EXCLUDED.description,
  canvas_width = EXCLUDED.canvas_width,
  canvas_height = EXCLUDED.canvas_height,
  slots = EXCLUDED.slots,
  logo_area = EXCLUDED.logo_area,
  photo_count = EXCLUDED.photo_count,
  capture_aspect = EXCLUDED.capture_aspect;

-- ---------------------------------------------------------------------------
-- 2. Seed Filters
-- ---------------------------------------------------------------------------
INSERT INTO filters (
  id,
  name,
  name_en,
  css_filter,
  sort_order
) VALUES
(
  'original',
  'ต้นฉบับ',
  'Original',
  'none',
  1
),
(
  'bw',
  'ขาวดำ',
  'Black & White',
  'grayscale(100%) contrast(110%)',
  2
),
(
  'vintage',
  'วินเทจ',
  'Vintage',
  'sepia(40%) contrast(105%) brightness(95%)',
  3
),
(
  'bright',
  'สว่างสดใส',
  'Bright',
  'brightness(110%) contrast(105%) saturate(115%)',
  4
),
(
  'soft',
  'นุ่มละมุน',
  'Soft',
  'brightness(105%) contrast(90%) saturate(95%)',
  5
),
(
  'dramatic',
  'ดรามาติก',
  'Dramatic',
  'contrast(130%) brightness(90%) saturate(120%)',
  6
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  name_en = EXCLUDED.name_en,
  css_filter = EXCLUDED.css_filter,
  sort_order = EXCLUDED.sort_order;
