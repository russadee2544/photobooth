-- =============================================================================
-- Migration: 004_rls_policies.sql
-- Description: Row Level Security (RLS) policies for the photobooth system.
--
-- Security Strategy:
-- 1. Deny-by-default: RLS is enabled on all tables. Without explicit policies,
--    no access is granted to anon or authenticated users.
-- 2. Public Read: Layout presets and filters are publicly readable as they are
--    canonical catalog data required by kiosk clients and preview UIs.
-- 3. Tenant / Owner Isolation: Owners (authenticated via auth.users) have full
--    CRUD access to resources they own (frames, frame versions, events,
--    redeem batches, and codes).
-- 4. Kiosk & Session Scoping: Operational records (sessions, assets, print jobs,
--    audit logs) are queryable by authenticated owners whose kiosk/events match.
-- 5. Kiosk Mutation via Service Role / Edge Functions: Direct table mutations
--    from kiosks (e.g. claiming redeem codes, completing print jobs) are mediated
--    by server-side Edge Functions using custom Proof-of-Possession device auth.
-- 6. Code Validation: Public read on redeem codes is restricted exclusively to
--    'active' vouchers for validation purposes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enable RLS on ALL tables
-- ---------------------------------------------------------------------------
ALTER TABLE layout_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE frame_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE redeem_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE redeem_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Layout Presets Policies
-- Public read access: Anyone (anon and authenticated) can read presets.
-- Mutations are restricted to system / service role.
-- ---------------------------------------------------------------------------
CREATE POLICY "layout_presets_public_read"
  ON layout_presets
  FOR SELECT
  TO public
  USING (true);

-- ---------------------------------------------------------------------------
-- 3. Filters Policies
-- Public read access: Anyone (anon and authenticated) can read filters.
-- Mutations are restricted to system / service role.
-- ---------------------------------------------------------------------------
CREATE POLICY "filters_public_read"
  ON filters
  FOR SELECT
  TO public
  USING (true);

-- ---------------------------------------------------------------------------
-- 4. Frames Policies
-- Owner full CRUD where owner_id = auth.uid()
-- ---------------------------------------------------------------------------
CREATE POLICY "frames_owner_select"
  ON frames
  FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "frames_owner_insert"
  ON frames
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "frames_owner_update"
  ON frames
  FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "frames_owner_delete"
  ON frames
  FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5. Frame Versions Policies
-- Owner full CRUD via linked frame ownership.
-- Active frame versions are publicly selectable for client composition.
-- ---------------------------------------------------------------------------
CREATE POLICY "frame_versions_owner_select"
  ON frame_versions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM frames
      WHERE frames.id = frame_versions.frame_id
        AND frames.owner_id = auth.uid()
    )
  );

CREATE POLICY "frame_versions_public_active_select"
  ON frame_versions
  FOR SELECT
  TO public
  USING (is_active = true);

CREATE POLICY "frame_versions_owner_insert"
  ON frame_versions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM frames
      WHERE frames.id = frame_versions.frame_id
        AND frames.owner_id = auth.uid()
    )
  );

CREATE POLICY "frame_versions_owner_update"
  ON frame_versions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM frames
      WHERE frames.id = frame_versions.frame_id
        AND frames.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM frames
      WHERE frames.id = frame_versions.frame_id
        AND frames.owner_id = auth.uid()
    )
  );

CREATE POLICY "frame_versions_owner_delete"
  ON frame_versions
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM frames
      WHERE frames.id = frame_versions.frame_id
        AND frames.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 6. Events Policies
-- Owner full CRUD where owner_id = auth.uid()
-- ---------------------------------------------------------------------------
CREATE POLICY "events_owner_select"
  ON events
  FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "events_owner_insert"
  ON events
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "events_owner_update"
  ON events
  FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "events_owner_delete"
  ON events
  FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 7. Sessions Policies
-- Owner can read sessions associated with their events, frames, or redeem batches.
-- ---------------------------------------------------------------------------
CREATE POLICY "sessions_owner_select"
  ON sessions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = sessions.event_id
        AND events.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM frames
      WHERE frames.kiosk_id = sessions.kiosk_id
        AND frames.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM redeem_batches
      WHERE redeem_batches.kiosk_id = sessions.kiosk_id
        AND redeem_batches.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 8. Session Assets Policies
-- Owner can read session assets via ownership of the associated session context.
-- ---------------------------------------------------------------------------
CREATE POLICY "session_assets_owner_select"
  ON session_assets
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM sessions s
      LEFT JOIN events e ON s.event_id = e.id
      LEFT JOIN redeem_batches rb ON s.kiosk_id = rb.kiosk_id
      LEFT JOIN frames f ON s.kiosk_id = f.kiosk_id
      WHERE s.id = session_assets.session_id
        AND (e.owner_id = auth.uid() OR rb.owner_id = auth.uid() OR f.owner_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 9. Print Jobs Policies
-- Owner can read print jobs via ownership of the associated session context.
-- ---------------------------------------------------------------------------
CREATE POLICY "print_jobs_owner_select"
  ON print_jobs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM sessions s
      LEFT JOIN events e ON s.event_id = e.id
      LEFT JOIN redeem_batches rb ON s.kiosk_id = rb.kiosk_id
      LEFT JOIN frames f ON s.kiosk_id = f.kiosk_id
      WHERE s.id = print_jobs.session_id
        AND (e.owner_id = auth.uid() OR rb.owner_id = auth.uid() OR f.owner_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 10. Print Attempts Policies
-- Owner can read print attempts via print job session context.
-- ---------------------------------------------------------------------------
CREATE POLICY "print_attempts_owner_select"
  ON print_attempts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM print_jobs pj
      JOIN sessions s ON pj.session_id = s.id
      LEFT JOIN events e ON s.event_id = e.id
      LEFT JOIN redeem_batches rb ON s.kiosk_id = rb.kiosk_id
      LEFT JOIN frames f ON s.kiosk_id = f.kiosk_id
      WHERE pj.id = print_attempts.print_job_id
        AND (e.owner_id = auth.uid() OR rb.owner_id = auth.uid() OR f.owner_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 11. Redeem Batches Policies
-- Owner full CRUD where owner_id = auth.uid()
-- ---------------------------------------------------------------------------
CREATE POLICY "redeem_batches_owner_select"
  ON redeem_batches
  FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "redeem_batches_owner_insert"
  ON redeem_batches
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "redeem_batches_owner_update"
  ON redeem_batches
  FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "redeem_batches_owner_delete"
  ON redeem_batches
  FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 12. Redeem Codes Policies
-- Owner has full access to codes within their batches.
-- Public/Anon can validate active codes without enumerating inactive/claimed codes.
-- ---------------------------------------------------------------------------
CREATE POLICY "redeem_codes_owner_select"
  ON redeem_codes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM redeem_batches
      WHERE redeem_batches.id = redeem_codes.batch_id
        AND redeem_batches.owner_id = auth.uid()
    )
  );

CREATE POLICY "redeem_codes_public_validate"
  ON redeem_codes
  FOR SELECT
  TO public
  USING (state = 'active');

CREATE POLICY "redeem_codes_owner_insert"
  ON redeem_codes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM redeem_batches
      WHERE redeem_batches.id = redeem_codes.batch_id
        AND redeem_batches.owner_id = auth.uid()
    )
  );

CREATE POLICY "redeem_codes_owner_update"
  ON redeem_codes
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM redeem_batches
      WHERE redeem_batches.id = redeem_codes.batch_id
        AND redeem_batches.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM redeem_batches
      WHERE redeem_batches.id = redeem_codes.batch_id
        AND redeem_batches.owner_id = auth.uid()
    )
  );

CREATE POLICY "redeem_codes_owner_delete"
  ON redeem_codes
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM redeem_batches
      WHERE redeem_batches.id = redeem_codes.batch_id
        AND redeem_batches.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 13. Audit Logs Policies
-- Owner can read audit logs for their kiosks.
-- Write access is restricted to service role / security definer functions.
-- ---------------------------------------------------------------------------
CREATE POLICY "audit_logs_owner_select"
  ON audit_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.kiosk_id = audit_logs.kiosk_id
        AND events.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM frames
      WHERE frames.kiosk_id = audit_logs.kiosk_id
        AND frames.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM redeem_batches
      WHERE redeem_batches.kiosk_id = audit_logs.kiosk_id
        AND redeem_batches.owner_id = auth.uid()
    )
  );
