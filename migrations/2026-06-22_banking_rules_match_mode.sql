-- Banking rules: ALL vs ANY condition matching.
--
-- Until now every rule's conditions AND-ed together (all must hit). Operators
-- want OR too — one rule covering spelling variants like "JBR" OR "J B R"
-- instead of maintaining two rules. match_mode = 'all' (default, unchanged
-- behavior) or 'any' (at least one condition hits).
--
-- Additive with a default, so existing rules keep AND semantics. Safe to run
-- before the matching deploy. Run in Supabase first.

ALTER TABLE banking_rules
  ADD COLUMN IF NOT EXISTS match_mode text NOT NULL DEFAULT 'all';
