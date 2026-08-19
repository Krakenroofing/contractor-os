import 'server-only';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  employees,
  importedTransactions,
  bankAccounts,
  payPeriods,
  payrollBills,
  transactionMatches,
  type PayrollBill,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export type PayrollBillListRow = PayrollBill & {
  employeeName: string;
  periodStart: string;
  periodEnd: string;
  /** The bank withdrawal that settled this bill (active match), if any. */
  paidFrom: {
    transactionDate: string;
    description: string;
    accountName: string;
    bankAccountId: string;
  } | null;
};

/** All payroll bills company-wide with employee / period / settling-payment
 *  context — the bills list page. Newest bill date first. */
export async function listPayrollBillsWithDetails(
  companyId: string,
): Promise<PayrollBillListRow[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const rows = await db
    .select({
      bill: payrollBills,
      firstName: employees.firstName,
      lastName: employees.lastName,
      periodStart: payPeriods.startDate,
      periodEnd: payPeriods.endDate,
      txnDate: importedTransactions.transactionDate,
      txnDescription: importedTransactions.description,
      txnBankAccountId: importedTransactions.bankAccountId,
      txnAccountName: bankAccounts.name,
    })
    .from(payrollBills)
    .innerJoin(employees, eq(employees.id, payrollBills.employeeId))
    .innerJoin(payPeriods, eq(payPeriods.id, payrollBills.payPeriodId))
    .leftJoin(
      transactionMatches,
      and(
        eq(transactionMatches.payrollBillId, payrollBills.id),
        isNull(transactionMatches.reversedAt),
      ),
    )
    .leftJoin(
      importedTransactions,
      eq(importedTransactions.id, transactionMatches.importedTransactionId),
    )
    .leftJoin(
      bankAccounts,
      eq(bankAccounts.id, importedTransactions.bankAccountId),
    )
    .where(eq(payrollBills.companyId, companyId))
    .orderBy(desc(payrollBills.billDate), employees.firstName);
  return rows.map((r) => ({
    ...r.bill,
    employeeName: `${r.firstName} ${r.lastName}`.trim(),
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    paidFrom:
      r.txnDate && r.txnBankAccountId
        ? {
            transactionDate: r.txnDate,
            description: r.txnDescription ?? '',
            accountName: r.txnAccountName ?? 'Bank',
            bankAccountId: r.txnBankAccountId,
          }
        : null,
  }));
}

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

/** Open (unpaid) payroll bills company-wide — for the bill-payment picker. */
export async function listOpenPayrollBills(
  companyId: string,
): Promise<PayrollBill[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return db
    .select()
    .from(payrollBills)
    .where(
      and(
        eq(payrollBills.companyId, companyId),
        eq(payrollBills.status, 'open'),
      ),
    );
}

export async function getPayrollBill(
  companyId: string,
  id: string,
): Promise<PayrollBill | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(payrollBills)
    .where(and(eq(payrollBills.companyId, companyId), eq(payrollBills.id, id)))
    .limit(1);
  return rows[0];
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
