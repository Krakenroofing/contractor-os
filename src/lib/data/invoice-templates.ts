// Async data accessor for invoice templates (dual-backend: Postgres or mock store).

import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { invoiceTemplates, type InvoiceTemplate } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockInvoiceTemplates as mockList,
  getMockInvoiceTemplate as mockGet,
  createMockInvoiceTemplate as mockCreate,
} from '@/lib/mock-store';

export type CreateInvoiceTemplateInput = Omit<
  InvoiceTemplate,
  'id' | 'companyId' | 'createdAt' | 'updatedAt'
>;

export async function listInvoiceTemplates(
  companyId: string,
): Promise<InvoiceTemplate[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(invoiceTemplates)
      .where(eq(invoiceTemplates.companyId, companyId))
      .orderBy(asc(invoiceTemplates.name));
  }
  return mockList(companyId);
}

export async function getInvoiceTemplate(
  companyId: string,
  id: string,
): Promise<InvoiceTemplate | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(invoiceTemplates)
      .where(
        and(
          eq(invoiceTemplates.id, id),
          eq(invoiceTemplates.companyId, companyId),
        ),
      )
      .limit(1);
    return rows[0];
  }
  return mockGet(companyId, id);
}

export async function createInvoiceTemplate(
  companyId: string,
  input: CreateInvoiceTemplateInput,
): Promise<InvoiceTemplate> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const inserted = await db
      .insert(invoiceTemplates)
      .values({ ...input, companyId })
      .returning();
    return inserted[0];
  }
  return mockCreate(companyId, input);
}
