// Shared contracts for the document export system. Keeping all generators
// (PDF, XLSX, future DOCX/CSV/ZIP) bound to these types means a new format
// only has to know how to render a `DocumentPayload` — it never reaches into
// app data or DB code directly.

export type ExportFormat = 'pdf' | 'xlsx';
export type DocumentType = 'invoice' | 'estimate' | 'proposal' | 'daily_report';

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
  /** Template override for the TIN label, e.g. "VAT #" / "GST #". */
  tinLabel?: string | null;
  defaultCurrency: string;
  /**
   * Base64 data URL of the company logo (e.g. `data:image/png;base64,...`).
   * Built server-side by the payload builders from Supabase Storage. Renderers
   * fall back to an initials chip when this is missing.
   */
  logoDataUrl?: string | null;
}

export interface CustomerInfo {
  name: string;
  contact?: string | null;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  tinNumber?: string | null;
  /** Template override for the bill-to attention label, e.g. "Attn:" / "ATTENTION". */
  attentionLabel?: string | null;
  /** Template override for the customer TIN label (separate from company). */
  tinLabel?: string | null;
}

export interface ProjectInfo {
  name?: string | null;
  number?: string | null;
  description?: string | null;
  /** Template override for the project block heading, e.g. "Project" / "Job". */
  descriptionLabel?: string | null;
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

// Generic mini-table block used for non-financial tabular data — currently
// daily-report manpower rolls. Renderers that don't recognize the payload
// type (XLSX) can safely ignore this field.
export interface DocumentDataTableColumn {
  label: string;
  align?: 'left' | 'right';
  /** Column width as a percentage of the table width. Auto-distributed if omitted. */
  widthPct?: number;
}
export interface DocumentDataTable {
  title: string;
  columns: DocumentDataTableColumn[];
  rows: string[][];
}

// Embedded image used for daily-report photo galleries. `src` accepts what
// @react-pdf/renderer accepts: a base64 data URL string is the safest choice
// for self-contained server-rendered PDFs.
export interface DocumentImage {
  caption?: string | null;
  category?: string | null;
  src: string;
}

// Signature / approval block rendered after prose sections. Used by
// templates with `showSignature` enabled — gives the recipient a clearly
// demarcated place to sign + date the document.
export interface DocumentSignatureBlock {
  /** Headline label, e.g. "Authorized signature", "Client approval". */
  label: string;
  /** Optional pre-filled signer name (template-level default). */
  signerName?: string | null;
  /** Optional pre-filled signer title, e.g. "Project Manager". */
  signerTitle?: string | null;
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

  // Optional tabular blocks rendered between totals and sections. Used by
  // daily reports for manpower; financial docs leave it undefined.
  dataTables?: DocumentDataTable[];

  // Optional image gallery rendered at the end of the document. Used by
  // daily reports for photos with captions.
  imageGallery?: DocumentImage[];

  // When false, the top header strip (logo + company info + title) is
  // suppressed entirely. Defaults to true. Used by templates that disable
  // `showCompanyBranding` / `showHeader`.
  showCompanyHeader?: boolean;

  // Optional headline note rendered before any prose sections. Used by
  // templates with a `headerNote` set — appears top-of-document under the
  // meta grid.
  headerNote?: string | null;

  // Optional signature/approval block rendered after prose sections.
  signatureBlock?: DocumentSignatureBlock | null;

  // Footer line shown at the bottom of every PDF page. When null the page
  // footer renders only the page-number row.
  footerNote?: string | null;
}
