import { z } from 'zod';

// Validation for the Accounting Settings form (/settings/accounting). Separate
// from companySettingsFormSchema so the two forms own disjoint field sets and
// can't clobber each other's columns on save.

const percentString = z
  .string()
  .refine(
    (v) =>
      v.trim() !== '' &&
      !Number.isNaN(Number(v)) &&
      Number(v) >= 0 &&
      Number(v) <= 100,
    { message: 'Must be a percentage between 0 and 100' },
  );

export const accountingSettingsFormSchema = z.object({
  accountingMethod: z.enum(['accrual', 'cash']),
  fiscalYearStartMonth: z
    .string()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 12, {
      message: 'Pick a month',
    }),
  isVatActive: z.boolean(),
  vatRatePercent: percentString,
  retainageRevenueBasis: z.enum(['billed', 'accrual']),
  defaultRetainagePercent: percentString,
  // Payroll → job costs posting targets. Empty = not configured.
  laborCogsAccountId: z.string().optional().or(z.literal('')),
  laborBurdenAccountId: z.string().optional().or(z.literal('')),
  // Company-wide fallback labor cost code for clock-posted hours with no code.
  // Empty = no fallback (uncoded clocked hours stay overhead).
  defaultLaborCostCodeId: z.string().optional().or(z.literal('')),
});

export type AccountingSettingsFormParsed = z.output<
  typeof accountingSettingsFormSchema
>;
