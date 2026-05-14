import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from '@react-pdf/renderer';
import { pdfTheme, formatMoneyForPdf, formatQty } from './theme';
import type {
  DocumentPayload,
  DocumentLine,
  DocumentTotalsRow,
  DocumentDataTable,
  DocumentImage,
} from '@/lib/exports/types';

// One PDF template that renders any DocumentPayload. Composed from primitive
// blocks (header, meta grid, line items table, totals, prose sections, footer)
// so future doc-types reuse the same layout grammar with no extra work.

const styles = StyleSheet.create({
  page: {
    paddingTop: pdfTheme.spacing.page,
    paddingBottom: pdfTheme.spacing.page + 18,
    paddingHorizontal: pdfTheme.spacing.page,
    fontSize: pdfTheme.fontSize.md,
    fontFamily: 'Helvetica',
    color: pdfTheme.colors.text,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: pdfTheme.spacing.section,
    borderBottomWidth: 1,
    borderBottomColor: pdfTheme.colors.border,
    paddingBottom: 10,
  },
  companyName: {
    fontSize: pdfTheme.fontSize.lg,
    fontFamily: 'Helvetica-Bold',
  },
  muted: { color: pdfTheme.colors.muted, fontSize: pdfTheme.fontSize.sm },
  subtle: { color: pdfTheme.colors.subtle, fontSize: pdfTheme.fontSize.xs },
  title: {
    fontSize: pdfTheme.fontSize.title,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'right',
  },
  number: {
    fontSize: pdfTheme.fontSize.sm,
    color: pdfTheme.colors.muted,
    textAlign: 'right',
    marginTop: 2,
  },
  badge: {
    alignSelf: 'flex-end',
    marginTop: 4,
    backgroundColor: pdfTheme.colors.accent,
    color: pdfTheme.colors.accentText,
    fontSize: pdfTheme.fontSize.xs,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 3,
    textTransform: 'uppercase',
  },
  section: { marginBottom: pdfTheme.spacing.section },
  twoCol: { flexDirection: 'row', gap: 18 },
  col: { flex: 1 },
  sectionLabel: {
    fontSize: pdfTheme.fontSize.xs,
    color: pdfTheme.colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: pdfTheme.fontSize.md,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
    marginTop: 6,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: pdfTheme.spacing.section,
  },
  metaItem: {
    width: '33.33%',
    paddingRight: 8,
    marginBottom: 6,
  },
  table: { borderTopWidth: 1, borderTopColor: pdfTheme.colors.border },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: pdfTheme.colors.border,
    paddingVertical: 5,
  },
  trAlt: { backgroundColor: pdfTheme.colors.rowAlt },
  th: {
    flexDirection: 'row',
    paddingVertical: 6,
    backgroundColor: pdfTheme.colors.rowAlt,
    borderBottomWidth: 1,
    borderBottomColor: pdfTheme.colors.border,
  },
  thText: {
    fontSize: pdfTheme.fontSize.xs,
    fontFamily: 'Helvetica-Bold',
    color: pdfTheme.colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  td: { fontSize: pdfTheme.fontSize.sm, paddingHorizontal: 4 },
  alignRight: { textAlign: 'right' },
  totalsBlock: {
    marginTop: 12,
    alignSelf: 'flex-end',
    width: '50%',
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  totalsRowBold: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: pdfTheme.colors.border,
    marginTop: 2,
  },
  totalsLabel: { fontSize: pdfTheme.fontSize.sm },
  totalsValue: { fontSize: pdfTheme.fontSize.sm },
  totalsLabelBold: {
    fontSize: pdfTheme.fontSize.md,
    fontFamily: 'Helvetica-Bold',
  },
  totalsValueBold: {
    fontSize: pdfTheme.fontSize.md,
    fontFamily: 'Helvetica-Bold',
  },
  proseBody: {
    fontSize: pdfTheme.fontSize.sm,
    lineHeight: 1.5,
    color: pdfTheme.colors.text,
  },
  footer: {
    position: 'absolute',
    bottom: 18,
    left: pdfTheme.spacing.page,
    right: pdfTheme.spacing.page,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: pdfTheme.colors.border,
    paddingTop: 6,
  },
  pageNumber: {
    fontSize: pdfTheme.fontSize.xs,
    color: pdfTheme.colors.muted,
  },
  logoBox: {
    width: 42,
    height: 42,
    backgroundColor: pdfTheme.colors.accent,
    color: pdfTheme.colors.accentText,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    color: pdfTheme.colors.accentText,
    fontSize: pdfTheme.fontSize.md,
    fontFamily: 'Helvetica-Bold',
  },
  // Larger box than the initials chip so brand marks aren't crushed.
  // objectFit:'contain' preserves aspect ratio for tall or wide logos.
  logoImage: {
    width: 90,
    height: 42,
    objectFit: 'contain',
  },
  dataTableTitle: {
    fontSize: pdfTheme.fontSize.md,
    fontFamily: 'Helvetica-Bold',
    marginTop: 8,
    marginBottom: 4,
  },
  imageGallery: {
    marginTop: pdfTheme.spacing.section,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  imageCell: {
    width: '50%',
    paddingRight: 6,
    paddingBottom: 10,
  },
  imageBox: {
    borderWidth: 1,
    borderColor: pdfTheme.colors.border,
    backgroundColor: pdfTheme.colors.rowAlt,
    padding: 4,
  },
  imageEl: {
    width: '100%',
    height: 160,
    objectFit: 'cover',
  },
  imageCaption: {
    fontSize: pdfTheme.fontSize.xs,
    color: pdfTheme.colors.muted,
    marginTop: 3,
  },
});

function companyAddress(company: DocumentPayload['company']): string {
  return [company.addressLine1, company.city, company.state, company.postalCode]
    .filter(Boolean)
    .join(', ');
}

function customerAddress(
  customer: NonNullable<DocumentPayload['customer']>,
): string {
  return [customer.addressLine1, customer.city, customer.state, customer.postalCode]
    .filter(Boolean)
    .join(', ');
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function HeaderBlock({ payload }: { payload: DocumentPayload }) {
  const c = payload.company;
  const tinLabel = c.tinLabel && c.tinLabel.trim() !== '' ? c.tinLabel : 'TIN';
  return (
    <View style={styles.headerRow}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {c.logoDataUrl ? (
          // @react-pdf accepts data URLs directly for <Image src>; sized
          // generously so a reasonable logo file doesn't get crushed.
          <Image src={c.logoDataUrl} style={styles.logoImage} />
        ) : (
          <View style={styles.logoBox}>
            <Text style={styles.logoText}>{initials(c.name)}</Text>
          </View>
        )}
        <View>
          <Text style={styles.companyName}>{c.name}</Text>
          {companyAddress(c) ? (
            <Text style={styles.muted}>{companyAddress(c)}</Text>
          ) : null}
          <Text style={styles.muted}>
            {[c.email, c.phone, c.website].filter(Boolean).join(' · ')}
          </Text>
          {c.licenseNumber ? (
            <Text style={styles.subtle}>License #: {c.licenseNumber}</Text>
          ) : null}
          {c.tinNumber ? (
            <Text style={styles.subtle}>{tinLabel}: {c.tinNumber}</Text>
          ) : null}
        </View>
      </View>
      <View>
        <Text style={styles.title}>{payload.title}</Text>
        <Text style={styles.number}>{payload.number}</Text>
        {payload.statusLabel ? (
          <Text style={styles.badge}>{payload.statusLabel}</Text>
        ) : null}
      </View>
    </View>
  );
}

function PartiesBlock({ payload }: { payload: DocumentPayload }) {
  const cust = payload.customer;
  const proj = payload.project;
  const attentionLabel =
    cust?.attentionLabel && cust.attentionLabel.trim() !== ''
      ? cust.attentionLabel
      : 'Attn';
  const customerTinLabel =
    cust?.tinLabel && cust.tinLabel.trim() !== '' ? cust.tinLabel : 'TIN';
  const projectLabel =
    proj?.descriptionLabel && proj.descriptionLabel.trim() !== ''
      ? proj.descriptionLabel
      : 'Project';
  return (
    <View style={[styles.section, styles.twoCol]}>
      {cust ? (
        <View style={styles.col}>
          <Text style={styles.sectionLabel}>Bill to</Text>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>{cust.name}</Text>
          {cust.contact ? (
            <Text style={styles.muted}>{attentionLabel}: {cust.contact}</Text>
          ) : null}
          {customerAddress(cust) ? (
            <Text style={styles.muted}>{customerAddress(cust)}</Text>
          ) : null}
          {cust.email ? <Text style={styles.muted}>{cust.email}</Text> : null}
          {cust.phone ? <Text style={styles.muted}>{cust.phone}</Text> : null}
          {cust.tinNumber ? (
            <Text style={styles.subtle}>
              {customerTinLabel}: {cust.tinNumber}
            </Text>
          ) : null}
        </View>
      ) : null}
      {proj ? (
        <View style={styles.col}>
          <Text style={styles.sectionLabel}>{projectLabel}</Text>
          {proj.name ? (
            <Text style={{ fontFamily: 'Helvetica-Bold' }}>{proj.name}</Text>
          ) : null}
          {proj.number ? <Text style={styles.muted}>#{proj.number}</Text> : null}
          {proj.description ? (
            <Text style={styles.muted}>{proj.description}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function MetaGrid({ payload }: { payload: DocumentPayload }) {
  if (payload.meta.length === 0) return null;
  return (
    <View style={styles.metaRow}>
      {payload.meta.map((m, i) => (
        <View key={i} style={styles.metaItem}>
          <Text style={styles.sectionLabel}>{m.label}</Text>
          <Text>{m.value}</Text>
        </View>
      ))}
    </View>
  );
}

function LineItemsTable({
  lines,
  showCostCode,
  showMarkup,
  currency,
}: {
  lines: DocumentLine[];
  showCostCode: boolean;
  showMarkup: boolean;
  currency: string;
}) {
  if (lines.length === 0) return null;

  // Column widths (sum to 100). Tweak based on optional columns.
  const cols = (() => {
    if (showCostCode && showMarkup) {
      return { code: 12, desc: 38, qty: 8, unit: 8, unitCost: 12, mk: 8, total: 14 };
    }
    if (showCostCode) {
      return { code: 14, desc: 44, qty: 8, unit: 8, unitCost: 12, mk: 0, total: 14 };
    }
    if (showMarkup) {
      return { code: 0, desc: 50, qty: 8, unit: 8, unitCost: 12, mk: 8, total: 14 };
    }
    return { code: 0, desc: 56, qty: 8, unit: 8, unitCost: 14, mk: 0, total: 14 };
  })();

  return (
    <View style={[styles.section, styles.table]}>
      <View style={styles.th} fixed>
        {showCostCode ? <Cell w={cols.code}>Cost code</Cell> : null}
        <Cell w={cols.desc}>Description</Cell>
        <Cell w={cols.qty} align="right">
          Qty
        </Cell>
        <Cell w={cols.unit}>Unit</Cell>
        <Cell w={cols.unitCost} align="right">
          Unit cost
        </Cell>
        {showMarkup ? (
          <Cell w={cols.mk} align="right">
            Markup
          </Cell>
        ) : null}
        <Cell w={cols.total} align="right">
          Line total
        </Cell>
      </View>
      {lines.map((l, i) => (
        <View
          key={i}
          style={[styles.tr, i % 2 === 1 ? styles.trAlt : {}]}
          wrap={false}
        >
          {showCostCode ? <BodyCell w={cols.code}>{l.code ?? '—'}</BodyCell> : null}
          <BodyCell w={cols.desc}>{l.description}</BodyCell>
          <BodyCell w={cols.qty} align="right">
            {formatQty(l.quantity)}
          </BodyCell>
          <BodyCell w={cols.unit}>{l.unit ?? '—'}</BodyCell>
          <BodyCell w={cols.unitCost} align="right">
            {formatMoneyForPdf(l.unitCost, currency)}
          </BodyCell>
          {showMarkup ? (
            <BodyCell w={cols.mk} align="right">
              {Number(l.markupPercent ?? 0).toFixed(1)}%
            </BodyCell>
          ) : null}
          <BodyCell w={cols.total} align="right">
            {formatMoneyForPdf(l.lineTotal, currency)}
          </BodyCell>
        </View>
      ))}
    </View>
  );
}

function Cell({
  w,
  children,
  align = 'left',
}: {
  w: number;
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <View style={{ width: `${w}%`, paddingHorizontal: 4 }}>
      <Text
        style={[
          styles.thText,
          align === 'right' ? styles.alignRight : {},
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

function BodyCell({
  w,
  children,
  align = 'left',
}: {
  w: number;
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <View style={{ width: `${w}%`, paddingHorizontal: 4 }}>
      <Text style={[styles.td, align === 'right' ? styles.alignRight : {}]}>
        {children}
      </Text>
    </View>
  );
}

function TotalsBlock({
  totals,
  currency,
}: {
  totals: DocumentTotalsRow[];
  currency: string;
}) {
  if (totals.length === 0) return null;
  return (
    <View style={styles.totalsBlock} wrap={false}>
      {totals.map((t, i) => {
        const valueText = `${t.negative ? '(' : ''}${formatMoneyForPdf(t.value, currency)}${t.negative ? ')' : ''}`;
        return (
          <View
            key={i}
            style={t.bold ? styles.totalsRowBold : styles.totalsRow}
          >
            <Text
              style={t.bold ? styles.totalsLabelBold : styles.totalsLabel}
            >
              {t.label}
            </Text>
            <Text
              style={t.bold ? styles.totalsValueBold : styles.totalsValue}
            >
              {valueText}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function ProseSections({ payload }: { payload: DocumentPayload }) {
  if (!payload.sections || payload.sections.length === 0) return null;
  return (
    <View style={{ marginTop: pdfTheme.spacing.section }}>
      {payload.sections.map((s, i) => (
        <View key={i} wrap={false} style={{ marginBottom: 10 }}>
          <Text style={styles.sectionTitle}>{s.title}</Text>
          <Text style={styles.proseBody}>{s.body}</Text>
        </View>
      ))}
    </View>
  );
}

function HeaderNote({ note }: { note: string }) {
  return (
    <View style={{ marginBottom: pdfTheme.spacing.section }} wrap={false}>
      <Text style={styles.proseBody}>{note}</Text>
    </View>
  );
}

function SignatureBlock({ block }: { block: NonNullable<DocumentPayload['signatureBlock']> }) {
  return (
    <View
      style={{ marginTop: pdfTheme.spacing.section + 12 }}
      wrap={false}
    >
      <Text style={styles.sectionTitle}>{block.label}</Text>
      <View style={{ flexDirection: 'row', gap: 24, marginTop: 16 }}>
        <View style={{ flex: 2 }}>
          <View
            style={{
              borderBottomWidth: 1,
              borderBottomColor: pdfTheme.colors.text,
              height: 30,
              marginBottom: 4,
            }}
          />
          <Text style={styles.subtle}>Signature</Text>
          {block.signerName ? (
            <Text style={styles.muted}>{block.signerName}</Text>
          ) : null}
          {block.signerTitle ? (
            <Text style={styles.subtle}>{block.signerTitle}</Text>
          ) : null}
        </View>
        <View style={{ flex: 1 }}>
          <View
            style={{
              borderBottomWidth: 1,
              borderBottomColor: pdfTheme.colors.text,
              height: 30,
              marginBottom: 4,
            }}
          />
          <Text style={styles.subtle}>Date</Text>
        </View>
      </View>
    </View>
  );
}

function DataTables({ tables }: { tables: DocumentDataTable[] }) {
  if (tables.length === 0) return null;
  return (
    <View style={{ marginTop: pdfTheme.spacing.section }}>
      {tables.map((t, i) => {
        const cols = distributeWidths(t.columns.map((c) => c.widthPct));
        return (
          <View key={i} wrap={false} style={{ marginBottom: 10 }}>
            <Text style={styles.dataTableTitle}>{t.title}</Text>
            <View style={styles.table}>
              <View style={styles.th}>
                {t.columns.map((c, ci) => (
                  <Cell key={ci} w={cols[ci]} align={c.align ?? 'left'}>
                    {c.label}
                  </Cell>
                ))}
              </View>
              {t.rows.map((row, ri) => (
                <View
                  key={ri}
                  style={[styles.tr, ri % 2 === 1 ? styles.trAlt : {}]}
                >
                  {row.map((cell, ci) => (
                    <BodyCell
                      key={ci}
                      w={cols[ci]}
                      align={t.columns[ci]?.align ?? 'left'}
                    >
                      {cell}
                    </BodyCell>
                  ))}
                </View>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function distributeWidths(widths: (number | undefined)[]): number[] {
  // Fill in any undefined widths by splitting the remaining percentage
  // evenly across them. Sum is normalized to 100.
  const total = widths.reduce<number>((s, w) => s + (w ?? 0), 0);
  const missing = widths.filter((w) => w === undefined).length;
  const remaining = Math.max(0, 100 - total);
  const each = missing > 0 ? remaining / missing : 0;
  const distributed = widths.map((w) => (w === undefined ? each : w));
  const sum = distributed.reduce((s, w) => s + w, 0);
  // Normalize if the explicit widths don't add to 100.
  if (sum > 0 && Math.abs(sum - 100) > 0.5) {
    return distributed.map((w) => (w * 100) / sum);
  }
  return distributed;
}

function ImageGallery({ images }: { images: DocumentImage[] }) {
  if (images.length === 0) return null;
  return (
    <View style={styles.imageGallery}>
      {images.map((img, i) => (
        <View key={i} style={styles.imageCell} wrap={false}>
          <View style={styles.imageBox}>
            <Image src={img.src} style={styles.imageEl} />
            {img.caption ? (
              <Text style={styles.imageCaption}>{img.caption}</Text>
            ) : null}
            {img.category ? (
              <Text style={styles.imageCaption}>
                Category: {img.category}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export function DocumentPdf({ payload }: { payload: DocumentPayload }) {
  const currency = payload.company.defaultCurrency ?? 'USD';
  const showHeader = payload.showCompanyHeader !== false;
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {showHeader ? <HeaderBlock payload={payload} /> : null}
        <PartiesBlock payload={payload} />
        <MetaGrid payload={payload} />
        {payload.headerNote && payload.headerNote.trim() !== '' ? (
          <HeaderNote note={payload.headerNote} />
        ) : null}
        <LineItemsTable
          lines={payload.lines ?? []}
          showCostCode={Boolean(payload.showLineCostCode)}
          showMarkup={Boolean(payload.showLineMarkup)}
          currency={currency}
        />
        <TotalsBlock totals={payload.totals} currency={currency} />
        <DataTables tables={payload.dataTables ?? []} />
        <ProseSections payload={payload} />
        {payload.signatureBlock ? (
          <SignatureBlock block={payload.signatureBlock} />
        ) : null}
        <ImageGallery images={payload.imageGallery ?? []} />

        <View style={styles.footer} fixed>
          <Text style={styles.pageNumber}>
            {payload.footerNote ?? `${payload.company.name} · ${payload.title} ${payload.number}`}
          </Text>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
