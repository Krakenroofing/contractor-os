-- Receipts — Phase 2.2: Approval workflow — STEP 1 of 2.
--
-- IMPORTANT: This file ONLY adds the new enum value. Postgres refuses to
-- USE a freshly-added enum value (literals, enum_range, etc.) in the same
-- transaction that ADDed it, so verification + column adds live in
-- 2026-05-16_receipts_phase2_approval_step2.sql.
--
-- Operator run path:
--   1. Supabase Dashboard → SQL Editor → New query.
--   2. Paste this file → Run. Should succeed silently (no rows returned).
--   3. THEN open the step 2 file and run that as a separate query.
--   4. THEN deploy application code.

ALTER TYPE receipt_status ADD VALUE IF NOT EXISTS 'submitted';
