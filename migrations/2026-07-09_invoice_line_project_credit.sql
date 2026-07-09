-- Project Credit line flag on invoice line items.
--
-- A "project credit" is a negative invoice line (like the existing credit /
-- deduction lines) that reduces the TAXABLE subtotal before VAT — so VAT is
-- charged only on the net. It differs from a plain deduction in one way: a
-- project credit also reduces the PROJECT's contract value (a downward
-- contract adjustment, netted into the change-order totals). This flag marks
-- those lines so the totals block can itemise them under the subtotal and the
-- contract-totals recompute can net them out of the project's contract value.
--
-- Additive, defaulted false → safe to run before the matching deploy.

ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS is_project_credit boolean NOT NULL DEFAULT false;
