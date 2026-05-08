// Shared contracts for the document export system. Keeping all generators
// (PDF, XLSX, future DOCX/CSV/ZIP) bound to these types means a new format
// only has to know how to render a `DocumentPayload` — it never reaches into
// app data or DB code directly.

export type ExportFormat = 'pdf' | 'xlsx';
export type DocumentType = 'invoice' | 'estimate' | 'proposal';

export type Money = number;

export interface CompanyInfo {
  name: string;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  licenseNumber?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  tinNumber?: string | null;
  defaultCurrency: string;
}

export interface CustomerInfo {
  name: string;
  contact?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface ProjectInfo {
  name?: string | null;
  number?: string | null;
  description?: string | null;
}

export interface DocumentLine {
  code?: string | null;
  description: string;
  unit?: string | null;
  quantity: number;
  unitCost: number;
  markupPercent?: number | null;
  lineTotal: number;
}

export interface DocumentSection {
  title: string;
  body: string;
}

export interface DocumentTotalsRow {
  label: string;
  value: Money;
  bold?: boolean;
  negative?: boolean;
}

export interface DocumentMeta {
  label: string;
  value: string;
}

// One canonical shape for everything we render. The PDF and XLSX generators
// only know about this — they never reach into DB types directly.
export interface DocumentPayload {
  type: DocumentType;
  // Title shown at the top of the document, e.g. "Invoice", "Estimate".
  title: string;
  // Document number ("INV-1023"), shown alongside the title.
  number: string;
  // Optional badge ("Draft", "Sent", "Paid")
  statusLabel?: string;

  company: CompanyInfo;
  customer?: CustomerInfo;
  project?: ProjectInfo;

  // Top-of-document metadata pairs (date, due date, valid until, etc.)
  meta: DocumentMeta[];

  // Line items table. Optional — proposals typically have none.
  lines?: DocumentLine[];
  showLineCostCode?: boolean;
  showLineMarkup?: boolean;

  // Totals stack at the bottom of the line items.
  totals: DocumentTotalsRow[];

  // Free-form prose sections (scope, payment terms, qualifications, notes).
  // Order is preserved.
  sections?: DocumentSection[];

  // Footer line shown at the bottom of every PDF page.
  footerNote?: string | null;
}
