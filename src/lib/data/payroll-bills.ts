import 'server-only';
import { and, eq } from 'drizzle-orm';
import { payrollBills, type PayrollBill } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export async function listPayrollBills(
  companyId: string,
  payPeriodId: string,
): Promise<PayrollBill[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return db
    .select()
    .from(payrollBills)
    .where(
      and(
        eq(payrollBills.companyId, companyId),
        eq(payrollBills.payPeriodId, payPeriodId),
      ),
    );
}

export async function deletePayrollBillsForPeriod(
  companyId: string,
  payPeriodId: string,
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb()!;
  await db
    .delete(payrollBills)
    .where(
      and(
        eq(payrollBills.companyId, companyId),
        eq(payrollBills.payPeriodId, payPeriodId),
      ),
    );
}

export type NewPayrollBillInput = {
  companyId: string;
  payPeriodId: string;
  employeeId: string;
  billDate: string;
  gross: number;
  employeeNib: number;
  employerNib: number;
  additions: number;
  deductions: number;
  net: number;
};

export async function insertPayrollBill(
  input: NewPayrollBillInput,
): Promise<PayrollBill> {
  if (!isDatabaseConfigured()) {
    throw new Error('Payroll bills require a configured database.');
  }
  const db = getDb()!;
  const [row] = await db
    .insert(payrollBills)
    .values({
      companyId: input.companyId,
      payPeriodId: input.payPeriodId,
      employeeId: input.employeeId,
      billDate: input.billDate,
      gross: input.gross.toFixed(2),
      employeeNib: input.employeeNib.toFixed(2),
      employerNib: input.employerNib.toFixed(2),
      additions: input.additions.toFixed(2),
      deductions: input.deductions.toFixed(2),
      net: input.net.toFixed(2),
    })
    .returning();
  return row;
}
