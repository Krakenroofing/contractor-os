import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer';
import { pdfTheme, formatMoneyForPdf, formatQty } from './theme';
import type {
  DocumentPayload,
  DocumentLine,
  DocumentTotalsRow,
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
});

function companyAddress(company: DocumentPayload['company']): string {
  return [company.addressLine1, company.city, company.state, company.postalCode]
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
  return (
    <View style={styles.headerRow}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={styles.logoBox}>
          <Text style={styles.logoText}>{initials(c.name)}</Text>
        </View>
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
            <Text style={styles.subtle}>TIN: {c.tinNumber}</Text>
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
  return (
    <View style={[styles.section, styles.twoCol]}>
      {payload.customer ? (
        <View style={styles.col}>
          <Text style={styles.sectionLabel}>Bill to</Text>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>
            {payload.customer.name}
          </Text>
          {payload.customer.contact ? (
            <Text style={styles.muted}>Attn: {payload.customer.contact}</Text>
          ) : null}
          {payload.customer.email ? (
            <Text style={styles.muted}>{payload.customer.email}</Text>
          ) : null}
          {payload.customer.phone ? (
            <Text style={styles.muted}>{payload.customer.phone}</Text>
          ) : null}
        </View>
      ) : null}
      {payload.project ? (
        <View style={styles.col}>
          <Text style={styles.sectionLabel}>Project</Text>
          {payload.project.name ? (
            <Text style={{ fontFamily: 'Helvetica-Bold' }}>
              {payload.project.name}
            </Text>
          ) : null}
          {payload.project.number ? (
            <Text style={styles.muted}>#{payload.project.number}</Text>
          ) : null}
          {payload.project.description ? (
            <Text style={styles.muted}>{payload.project.description}</Text>
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

export function DocumentPdf({ payload }: { payload: DocumentPayload }) {
  const currency = payload.company.defaultCurrency ?? 'USD';
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <HeaderBlock payload={payload} />
        <PartiesBlock payload={payload} />
        <MetaGrid payload={payload} />
        <LineItemsTable
          lines={payload.lines ?? []}
          showCostCode={Boolean(payload.showLineCostCode)}
          showMarkup={Boolean(payload.showLineMarkup)}
          currency={currency}
        />
        <TotalsBlock totals={payload.totals} currency={currency} />
        <ProseSections payload={payload} />

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
