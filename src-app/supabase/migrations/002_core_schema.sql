-- =============================================================================
-- Migration: 002_core_schema.sql
-- Description: Core schema for the photobooth kiosk platform.
-- Includes tables for layouts, frames, versions, filters, events, sessions,
-- session assets, print jobs, redeem batches/codes, and audit logs.
-- =============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Layout Presets (Canonical, seeded by system)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS layout_presets (
  id TEXT PRIMARY KEY, -- e.g. classic_3, classic_4, duo, portrait, grid_4
  name TEXT NOT NULL,
  name_en TEXT NOT NULL,
  description TEXT,
  canvas_width INTEGER NOT NULL DEFAULT 576,
  canvas_height INTEGER NOT NULL,
  slots JSONB NOT NULL, -- array of {index, x, y, w, h, aspect}
  logo_area JSONB,
  photo_count INTEGER NOT NULL,
  capture_aspect TEXT NOT NULL CHECK (capture_aspect IN ('4:3', '3:4', '1:1', '16:9', '9:16')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE layout_presets IS 'Canonical layout definitions with fixed dot dimensions and slot geometries for thermal printing.';
COMMENT ON COLUMN layout_presets.id IS 'Unique identifier for the layout preset (e.g., classic_3, grid_4).';
COMMENT ON COLUMN layout_presets.canvas_width IS 'Width in thermal print dots (576 dots for standard 80mm thermal printers).';
COMMENT ON COLUMN layout_presets.canvas_height IS 'Height in thermal print dots.';
COMMENT ON COLUMN layout_presets.slots IS 'JSON array defining photo bounding boxes: [{index, x, y, w, h, aspect}].';
COMMENT ON COLUMN layout_presets.logo_area IS 'JSON object specifying optional logo/branding bounding box: {x, y, w, h}.';
COMMENT ON COLUMN layout_presets.photo_count IS 'Number of camera captures required for this layout.';
COMMENT ON COLUMN layout_presets.capture_aspect IS 'Target aspect ratio for the live camera viewfinder.';

-- ---------------------------------------------------------------------------
-- 2. Frames (Logical frame entity)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS frames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kiosk_id TEXT NOT NULL,
  layout_preset_id TEXT NOT NULL REFERENCES layout_presets(id),
  name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'th' CHECK (language IN ('th', 'en')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE frames IS 'Logical frame container for customizable graphic overlays.';
COMMENT ON COLUMN frames.owner_id IS 'Supabase auth user who owns this frame.';
COMMENT ON COLUMN frames.kiosk_id IS 'Target kiosk or installation identifier.';
COMMENT ON COLUMN frames.layout_preset_id IS 'Linked layout preset geometry.';
COMMENT ON COLUMN frames.language IS 'UI language context for frame labels and text overlay.';

-- ---------------------------------------------------------------------------
-- 3. Frame Versions (Versioning & rollback, keeps >= 5 history)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS frame_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  frame_id UUID NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  hash TEXT NOT NULL, -- SHA-256
  canvas_width INTEGER NOT NULL,
  canvas_height INTEGER NOT NULL,
  warnings TEXT[] DEFAULT '{}',
  warning_overridden BOOLEAN NOT NULL DEFAULT false,
  published_by TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (frame_id, version)
);

COMMENT ON TABLE frame_versions IS 'Immutable versions of frame artwork PNGs with hash verification and publish tracking.';
COMMENT ON COLUMN frame_versions.storage_path IS 'Path to the sanitized PNG asset in Supabase storage.';
COMMENT ON COLUMN frame_versions.hash IS 'SHA-256 checksum of the sanitized PNG image file.';
COMMENT ON COLUMN frame_versions.warnings IS 'Array of dimension/transparency warnings detected during preflight upload.';
COMMENT ON COLUMN frame_versions.warning_overridden IS 'True if the administrator explicitly overrode preflight warnings.';
COMMENT ON COLUMN frame_versions.is_active IS 'Indicates the currently active version for new sessions.';

-- ---------------------------------------------------------------------------
-- 4. Filters
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS filters (
  id TEXT PRIMARY KEY, -- original, bw, vintage, bright, soft, dramatic
  name TEXT NOT NULL,
  name_en TEXT NOT NULL,
  css_filter TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE filters IS 'Color adjustment and post-processing filter presets applied during composition.';
COMMENT ON COLUMN filters.css_filter IS 'CSS filter definition string used by canvas and UI preview pipelines.';

-- ---------------------------------------------------------------------------
-- 5. Events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kiosk_id TEXT NOT NULL,
  name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','open','closing','exporting','export_failed','verified','closed')),
  owner_email TEXT,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  exported_at TIMESTAMPTZ,
  cutoff_at TIMESTAMPTZ
);

COMMENT ON TABLE events IS 'Event configurations and lifecycle states for event_free operation mode.';
COMMENT ON COLUMN events.state IS 'State machine: draft -> open -> closing -> exporting -> verified -> closed (or export_failed).';
COMMENT ON COLUMN events.cutoff_at IS 'Immutable timestamp recorded when closing, marking cutoff for admitted sessions.';

-- ---------------------------------------------------------------------------
-- 6. Sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  kiosk_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'created' CHECK (state IN ('created','authorized','selecting','capturing','composing','print_queued','completed','cancelled','timed_out','failed','abandoned')),
  operating_mode TEXT NOT NULL CHECK (operating_mode IN ('event_free', 'paid_redeem')),
  capture_mode TEXT NOT NULL DEFAULT 'photo' CHECK (capture_mode IN ('photo', 'gif')),
  config_snapshot JSONB NOT NULL,
  layout_preset_id TEXT REFERENCES layout_presets(id),
  frame_version_id UUID REFERENCES frame_versions(id) ON DELETE SET NULL,
  filter_id TEXT REFERENCES filters(id),
  entitlement_type TEXT NOT NULL CHECK (entitlement_type IN ('redeem', 'event_free', 'operator_offline_override')),
  redeem_code TEXT,
  language TEXT NOT NULL DEFAULT 'th',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE sessions IS 'Individual photobooth customer sessions with frozen config snapshots.';
COMMENT ON COLUMN sessions.config_snapshot IS 'Immutable JSON snapshot of kiosk configuration at session authorization.';
COMMENT ON COLUMN sessions.entitlement_type IS 'Source of entitlement: voucher redeem, event mode, or operator manual override.';

-- ---------------------------------------------------------------------------
-- 7. Session Assets (final + dithered only, NO raw photos)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS session_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('final_color', 'dithered')),
  state TEXT NOT NULL DEFAULT 'local_pending' CHECK (state IN ('local_pending','upload_queued','uploaded','export_queued','exported_verified','delete_pending','deleted_verified','retry_wait','dead_letter')),
  storage_path TEXT,
  hash TEXT, -- SHA-256
  byte_size BIGINT,
  mime_type TEXT DEFAULT 'image/png',
  dither_algorithm TEXT,
  dither_version TEXT,
  retention_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE session_assets IS 'Composed output assets for download and printing. Raw capture photos are never stored in Cloud.';
COMMENT ON COLUMN session_assets.asset_type IS 'final_color: high-res composed color image; dithered: 1-bit monochrome raster image.';
COMMENT ON COLUMN session_assets.retention_expires_at IS 'Expiration timestamp after which asset is eligible for automated deletion (e.g. 24h for paid).';

-- ---------------------------------------------------------------------------
-- 8. Print Jobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS print_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','preflight','printing_copy_1','cutting_1','printing_copy_2','cutting_2','completed','blocked','retry_wait','ambiguous_needs_admin','cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  target_copies INTEGER NOT NULL DEFAULT 2,
  last_confirmed_copy INTEGER NOT NULL DEFAULT 0,
  raster_ref TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE print_jobs IS 'Hardware print queue jobs with two-copy confirmation and idempotency tracking.';
COMMENT ON COLUMN print_jobs.idempotency_key IS 'Unique key preventing duplicate print job creation on network retries.';
COMMENT ON COLUMN print_jobs.last_confirmed_copy IS 'Number of physical copies acknowledged by the printer adapter.';

-- ---------------------------------------------------------------------------
-- 9. Print Attempts (audit trail)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS print_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  print_job_id UUID NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  copy_number INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('success', 'failed', 'ambiguous', 'timeout')),
  error_message TEXT,
  printer_ack JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE print_attempts IS 'Granular audit log of hardware communication attempts per print copy.';

-- ---------------------------------------------------------------------------
-- 10. Redeem Batches
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS redeem_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kiosk_id TEXT NOT NULL,
  package_snapshot JSONB NOT NULL,
  price_thb NUMERIC(10,2) NOT NULL,
  total_codes INTEGER NOT NULL,
  printed_codes INTEGER NOT NULL DEFAULT 0,
  expiry_days INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE redeem_batches IS 'Batch records for prepaid voucher generation and printing.';
COMMENT ON COLUMN redeem_batches.package_snapshot IS 'Package configuration snapshot at batch creation time.';

-- ---------------------------------------------------------------------------
-- 11. Redeem Codes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS redeem_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES redeem_batches(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE, -- format AB1234
  state TEXT NOT NULL DEFAULT 'created' CHECK (state IN ('created','active','claimed','expired','revoked','replaced')),
  kiosk_id TEXT NOT NULL,
  package_snapshot JSONB NOT NULL,
  claimed_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  activated_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE redeem_codes IS 'Individual prepaid voucher codes with single-use lifecycle guarantees.';
COMMENT ON COLUMN redeem_codes.code IS 'Alphanumeric voucher code in format AB1234.';
COMMENT ON COLUMN redeem_codes.state IS 'Lifecycle: created -> active -> claimed (terminal: expired, revoked, replaced).';

-- ---------------------------------------------------------------------------
-- 12. Audit Logs (Append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('shared_admin', 'owner', 'device', 'system')),
  kiosk_id TEXT,
  session_id UUID,
  action TEXT NOT NULL,
  reason TEXT,
  before_state JSONB,
  after_state JSONB,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE audit_logs IS 'Append-only audit trail for administrative, security, and hardware override events.';

-- ---------------------------------------------------------------------------
-- Indexes for Performance & Query Optimization
-- ---------------------------------------------------------------------------

-- Sessions indexes
CREATE INDEX IF NOT EXISTS idx_sessions_kiosk_id ON sessions (kiosk_id);
CREATE INDEX IF NOT EXISTS idx_sessions_event_id ON sessions (event_id);
CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions (state);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions (created_at DESC);

-- Session assets indexes
CREATE INDEX IF NOT EXISTS idx_session_assets_session_id ON session_assets (session_id);
CREATE INDEX IF NOT EXISTS idx_session_assets_state ON session_assets (state);
CREATE INDEX IF NOT EXISTS idx_session_assets_retention ON session_assets (retention_expires_at) WHERE state = 'uploaded';

-- Print jobs indexes
CREATE INDEX IF NOT EXISTS idx_print_jobs_session_id ON print_jobs (session_id);
CREATE INDEX IF NOT EXISTS idx_print_jobs_state ON print_jobs (state);
CREATE INDEX IF NOT EXISTS idx_print_jobs_idempotency_key ON print_jobs (idempotency_key);

-- Print attempts index
CREATE INDEX IF NOT EXISTS idx_print_attempts_print_job_id ON print_attempts (print_job_id);

-- Redeem codes indexes
CREATE INDEX IF NOT EXISTS idx_redeem_codes_code ON redeem_codes (code);
CREATE INDEX IF NOT EXISTS idx_redeem_codes_state ON redeem_codes (state);
CREATE INDEX IF NOT EXISTS idx_redeem_codes_kiosk_id ON redeem_codes (kiosk_id);
CREATE INDEX IF NOT EXISTS idx_redeem_codes_batch_id ON redeem_codes (batch_id);

-- Redeem batches indexes
CREATE INDEX IF NOT EXISTS idx_redeem_batches_owner_id ON redeem_batches (owner_id);
CREATE INDEX IF NOT EXISTS idx_redeem_batches_kiosk_id ON redeem_batches (kiosk_id);

-- Audit logs indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_kiosk_id ON audit_logs (kiosk_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_session_id ON audit_logs (session_id);

-- Frame versions indexes
CREATE INDEX IF NOT EXISTS idx_frame_versions_frame_id ON frame_versions (frame_id);
CREATE INDEX IF NOT EXISTS idx_frame_versions_is_active ON frame_versions (frame_id, is_active);

-- Frames indexes
CREATE INDEX IF NOT EXISTS idx_frames_owner_id ON frames (owner_id);
CREATE INDEX IF NOT EXISTS idx_frames_kiosk_id ON frames (kiosk_id);
CREATE INDEX IF NOT EXISTS idx_frames_layout_preset_id ON frames (layout_preset_id);

-- Events indexes
CREATE INDEX IF NOT EXISTS idx_events_owner_id ON events (owner_id);
CREATE INDEX IF NOT EXISTS idx_events_kiosk_id ON events (kiosk_id);
CREATE INDEX IF NOT EXISTS idx_events_state ON events (state);
