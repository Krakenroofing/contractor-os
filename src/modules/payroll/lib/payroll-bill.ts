// Pure double-entry lines for a QB-style payroll bill (one per employee):
//   Dr Payroll Expense        gross (incl. employee NIB)
//   Cr Deductions Payable      deductions withheld
//   Cr NIB Payable - Employee  employee NIB withheld
//   Dr NIB Expense             employer NIB (cost)
//   Cr NIB Payable - Employer  employer NIB (owed to NIB)
//   Dr Employee Reimbursements reimbursements / per diem
//   Cr Accounts Payable        NET PAY (what's paid out)
//
// Balances because net = gross − deductions − employeeNib + additions, so the
// employer-NIB expense/liability offset and the rest tie out to AP = net.

import type { JournalLineInput } from '@/lib/data/general-ledger';

export type PayrollBillAmounts = {
  gross: number;
  employeeNib: number;
  employerNib: number;
  /** reimbursements + per diem (post-NIB additions). */
  additions: number;
  deductions: number;
  net: number;
};

export type PayrollBillAccounts = {
  payrollExpense: string;
  nibExpense: string;
  nibPayableEmployee: string;
  nibPayableEmployer: string;
  reimbursementExpense: string;
  deductionsPayable: string;
  accountsPayable: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildPayrollBillLines(
  a: PayrollBillAmounts,
  acc: PayrollBillAccounts,
): JournalLineInput[] {
  const lines: JournalLineInput[] = [];
  if (a.gross > 0)
    lines.push({ accountId: acc.payrollExpense, debit: r2(a.gross), credit: 0, description: 'Payroll (gross)' });
  if (a.deductions > 0)
    lines.push({ accountId: acc.deductionsPayable, debit: 0, credit: r2(a.deductions), description: 'Deductions withheld' });
  if (a.employeeNib > 0)
    lines.push({ accountId: acc.nibPayableEmployee, debit: 0, credit: r2(a.employeeNib), description: 'NIB — employee' });
  if (a.employerNib > 0) {
    lines.push({ accountId: acc.nibExpense, debit: r2(a.employerNib), credit: 0, description: 'NIB — employer (expense)' });
    lines.push({ accountId: acc.nibPayableEmployer, debit: 0, credit: r2(a.employerNib), description: 'NIB — employer (payable)' });
  }
  if (a.additions > 0)
    lines.push({ accountId: acc.reimbursementExpense, debit: r2(a.additions), credit: 0, description: 'Reimbursements / per diem' });
  if (a.net > 0)
    lines.push({ accountId: acc.accountsPayable, debit: 0, credit: r2(a.net), description: 'Net pay payable' });
  return lines;
}
