import 'server-only';
import ExcelJS from 'exceljs';
import type { DocumentPayload, DocumentLine } from '@/lib/exports/types';

// Single XLSX renderer that handles every doc type. Line-item docs
// (invoices, estimates) get a populated items table with live SUM formulas.
// Prose docs (proposals) get a metadata + sections sheet. Both share the
// same header / parties / totals scaffolding — adding a new doc-type means
// the payload assembler decides which subset of fields to populate.

const CURRENCY_FORMAT = '"$"#,##0.00';
const PERCENT_FORMAT = '0.00%';

export async function renderDocumentXlsx(
  payload: DocumentPayload,
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = payload.company.name;
  wb.created = new Date();

  const ws = wb.addWorksheet(capitalize(payload.type), {
    properties: { defaultColWidth: 16 },
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // Title block
  ws.mergeCells('A1:F1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `${payload.title} ${payload.number}`;
  titleCell.font = { name: 'Calibri', size: 16, bold: true };
  titleCell.alignment = { vertical: 'middle' };

  let row = 3;

  // Company / customer / project block
  const companyTinLabel =
    payload.company.tinLabel && payload.company.tinLabel.trim() !== ''
      ? payload.company.tinLabel
      : 'TIN';
  if (payload.showCompanyHeader !== false) {
    row = writeKeyValueBlock(ws, row, 'From', [
      ['Company', payload.company.name],
      ['Email', payload.company.email ?? ''],
      ['Phone', payload.company.phone ?? ''],
      ['Address', companyAddress(payload.company)],
      payload.company.licenseNumber
        ? ['License #', payload.company.licenseNumber]
        : null,
      payload.company.tinNumber
        ? [companyTinLabel, payload.company.tinNumber]
        : null,
    ]);
  }

  if (payload.customer) {
    const attentionLabel =
      payload.customer.attentionLabel &&
      payload.customer.attentionLabel.trim() !== ''
        ? payload.customer.attentionLabel
        : 'Contact';
    const customerTinLabel =
      payload.customer.tinLabel && payload.customer.tinLabel.trim() !== ''
        ? payload.customer.tinLabel
        : 'TIN';
    row = writeKeyValueBlock(ws, row, 'Bill to', [
      ['Customer', payload.customer.name],
      payload.customer.contact ? [attentionLabel, payload.customer.contact] : null,
      payload.customer.email ? ['Email', payload.customer.email] : null,
      payload.customer.phone ? ['Phone', payload.customer.phone] : null,
      payload.customer.tinNumber
        ? [customerTinLabel, payload.customer.tinNumber]
        : null,
    ]);
  }

  if (payload.project) {
    const projectLabel =
      payload.project.descriptionLabel &&
      payload.project.descriptionLabel.trim() !== ''
        ? payload.project.descriptionLabel
        : 'Project';
    row = writeKeyValueBlock(ws, row, projectLabel, [
      payload.project.name ? ['Name', payload.project.name] : null,
      payload.project.number ? ['Number', payload.project.number] : null,
      payload.project.description
        ? ['Description', payload.project.description]
        : null,
    ]);
  }

  if (payload.meta.length > 0) {
    row = writeKeyValueBlock(
      ws,
      row,
      'Document details',
      payload.meta.map((m) => [m.label, m.value] as [string, string]),
    );
  }

  // Line items + totals
  if (payload.lines && payload.lines.length > 0) {
    row = writeLineItems(
      ws,
      row,
      payload.lines,
      Boolean(payload.showLineCostCode),
      Boolean(payload.showLineMarkup),
    );
  }

  if (payload.totals.length > 0) {
    row = writeTotals(ws, row, payload.totals);
  }

  // Header note — single prose block rendered before sections
  if (payload.headerNote && payload.headerNote.trim() !== '') {
    ws.mergeCells(`A${row}:F${row}`);
    const note = ws.getCell(`A${row}`);
    note.value = payload.headerNote;
    note.alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(row).height = Math.min(120, 14 + payload.headerNote.length / 8);
    row += 2;
  }

  // Structured data tables (progress billing, account history)
  if (payload.dataTables && payload.dataTables.length > 0) {
    for (const tbl of payload.dataTables) {
      row += 1;
      const heading = ws.getCell(`A${row}`);
      heading.value = tbl.title;
      heading.font = { bold: true, size: 12 };
      row += 1;
      // Column headers
      tbl.columns.forEach((col, i) => {
        const cell = ws.getCell(row, i + 1);
        cell.value = col.label;
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF1F5F9' },
        };
        cell.alignment = { horizontal: col.align ?? 'left' };
      });
      row += 1;
      for (const r of tbl.rows) {
        r.forEach((v, i) => {
          const cell = ws.getCell(row, i + 1);
          cell.value = v;
          cell.alignment = {
            horizontal: tbl.columns[i]?.align ?? 'left',
          };
        });
        row += 1;
      }
      row += 1;
    }
  }

  // Prose sections (scope, notes, terms)
  if (payload.sections && payload.sections.length > 0) {
    row += 1;
    for (const section of payload.sections) {
      ws.mergeCells(`A${row}:F${row}`);
      const c = ws.getCell(`A${row}`);
      c.value = section.title;
      c.font = { bold: true, size: 12 };
      row += 1;
      ws.mergeCells(`A${row}:F${row}`);
      const body = ws.getCell(`A${row}`);
      body.value = section.body;
      body.alignment = { wrapText: true, vertical: 'top' };
      ws.getRow(row).height = Math.min(120, 14 + section.body.length / 8);
      row += 2;
    }
  }

  // Signature block — label + signature/date lines
  if (payload.signatureBlock) {
    row += 2;
    ws.mergeCells(`A${row}:F${row}`);
    const head = ws.getCell(`A${row}`);
    head.value = payload.signatureBlock.label;
    head.font = { bold: true, size: 12 };
    row += 2;
    ws.getCell(`A${row}`).value = 'Signature:';
    ws.getCell(`A${row}`).font = { color: { argb: 'FF64748B' } };
    ws.mergeCells(`B${row}:D${row}`);
    ws.getCell(`B${row}`).border = {
      bottom: { style: 'thin', color: { argb: 'FF1F2937' } },
    };
    ws.getCell(`E${row}`).value = 'Date:';
    ws.getCell(`E${row}`).font = { color: { argb: 'FF64748B' } };
    ws.getCell(`F${row}`).border = {
      bottom: { style: 'thin', color: { argb: 'FF1F2937' } },
    };
    row += 1;
    if (payload.signatureBlock.signerName) {
      ws.mergeCells(`B${row}:D${row}`);
      ws.getCell(`B${row}`).value = payload.signatureBlock.signerName;
      row += 1;
    }
    if (payload.signatureBlock.signerTitle) {
      ws.mergeCells(`B${row}:D${row}`);
      ws.getCell(`B${row}`).value = payload.signatureBlock.signerTitle;
      ws.getCell(`B${row}`).font = { italic: true, color: { argb: 'FF64748B' } };
      row += 1;
    }
    row += 1;
  }

  // Footer
  if (payload.footerNote && payload.footerNote.trim() !== '') {
    row += 1;
    ws.mergeCells(`A${row}:F${row}`);
    const f = ws.getCell(`A${row}`);
    f.value = payload.footerNote;
    f.font = { italic: true, color: { argb: 'FF64748B' } };
    f.alignment = { horizontal: 'center', wrapText: true };
  }

  // Reasonable column widths
  ws.getColumn(1).width = 16;
  ws.getColumn(2).width = 36;
  ws.getColumn(3).width = 12;
  ws.getColumn(4).width = 10;
  ws.getColumn(5).width = 14;
  ws.getColumn(6).width = 14;
  ws.getColumn(7).width = 16;

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

function writeKeyValueBlock(
  ws: ExcelJS.Worksheet,
  startRow: number,
  heading: string,
  pairs: Array<[string, string] | null>,
): number {
  const filtered = pairs.filter((p): p is [string, string] => p !== null);
  if (filtered.length === 0) return startRow;
  const head = ws.getCell(`A${startRow}`);
  head.value = heading;
  head.font = { bold: true, size: 11 };
  let row = startRow + 1;
  for (const [k, v] of filtered) {
    ws.getCell(`A${row}`).value = k;
    ws.getCell(`A${row}`).font = { color: { argb: 'FF64748B' } };
    ws.mergeCells(`B${row}:F${row}`);
    ws.getCell(`B${row}`).value = v;
    row += 1;
  }
  return row + 1;
}

function writeLineItems(
  ws: ExcelJS.Worksheet,
  startRow: number,
  lines: DocumentLine[],
  showCostCode: boolean,
  showMarkup: boolean,
): number {
  const heading = ws.getCell(`A${startRow}`);
  heading.value = 'Line items';
  heading.font = { bold: true, size: 12 };
  let row = startRow + 1;

  // Column layout (dynamic):
  //   [code?] | description | qty | unit | unit cost | [markup?] | line total
  const cols: { header: string; key: string; width: number }[] = [];
  if (showCostCode) cols.push({ header: 'Cost code', key: 'code', width: 12 });
  cols.push({ header: 'Description', key: 'description', width: 36 });
  cols.push({ header: 'Qty', key: 'quantity', width: 10 });
  cols.push({ header: 'Unit', key: 'unit', width: 10 });
  cols.push({ header: 'Unit cost', key: 'unitCost', width: 14 });
  if (showMarkup) cols.push({ header: 'Markup %', key: 'markup', width: 12 });
  cols.push({ header: 'Line total', key: 'lineTotal', width: 16 });

  // Header row
  cols.forEach((col, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = col.header;
    cell.font = { bold: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF1F5F9' },
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };
  });
  row += 1;

  // Body rows: live formulas where applicable. Indices below are 1-based
  // Excel column indices that depend on whether optional columns are shown.
  const qtyCol = showCostCode ? 3 : 2;
  const unitCostCol = showCostCode ? 5 : 4;
  const markupCol = showMarkup ? (showCostCode ? 6 : 5) : null;
  const totalCol = cols.length;

  const totalColLetter = colLetter(totalCol);
  const firstLineRow = row;

  for (const l of lines) {
    let c = 1;
    if (showCostCode) {
      ws.getCell(row, c++).value = l.code ?? '';
    }
    ws.getCell(row, c++).value = l.description;
    const qtyCell = ws.getCell(row, c++);
    qtyCell.value = l.quantity;
    qtyCell.numFmt = '#,##0.##';
    const unitCell = ws.getCell(row, c++);
    unitCell.value = l.unit ?? '';
    const ucCell = ws.getCell(row, c++);
    ucCell.value = l.unitCost;
    ucCell.numFmt = CURRENCY_FORMAT;

    if (markupCol) {
      const mkCell = ws.getCell(row, c++);
      // Stored as percent (0.00 = 0%) so Excel's % format reads cleanly.
      mkCell.value = (l.markupPercent ?? 0) / 100;
      mkCell.numFmt = PERCENT_FORMAT;
    }

    const totalCell = ws.getCell(row, c++);
    if (markupCol) {
      totalCell.value = {
        formula: `${colLetter(qtyCol)}${row}*${colLetter(unitCostCol)}${row}*(1+${colLetter(markupCol)}${row})`,
      };
    } else {
      totalCell.value = {
        formula: `${colLetter(qtyCol)}${row}*${colLetter(unitCostCol)}${row}`,
      };
    }
    totalCell.numFmt = CURRENCY_FORMAT;
    row += 1;
  }

  // Subtotal row using SUM over the body's line-total column.
  const lastLineRow = row - 1;
  ws.getCell(row, totalCol - 1).value = 'Subtotal';
  ws.getCell(row, totalCol - 1).font = { bold: true };
  const subtotalCell = ws.getCell(row, totalCol);
  subtotalCell.value = {
    formula: `SUM(${totalColLetter}${firstLineRow}:${totalColLetter}${lastLineRow})`,
  };
  subtotalCell.numFmt = CURRENCY_FORMAT;
  subtotalCell.font = { bold: true };
  row += 2;

  return row;
}

function writeTotals(
  ws: ExcelJS.Worksheet,
  startRow: number,
  totals: DocumentPayload['totals'],
): number {
  const heading = ws.getCell(`A${startRow}`);
  heading.value = 'Totals';
  heading.font = { bold: true, size: 12 };
  let row = startRow + 1;
  for (const t of totals) {
    const labelCell = ws.getCell(`E${row}`);
    labelCell.value = t.label;
    labelCell.alignment = { horizontal: 'right' };
    if (t.bold) labelCell.font = { bold: true };
    const valueCell = ws.getCell(`F${row}`);
    valueCell.value = t.negative ? -Math.abs(t.value) : t.value;
    valueCell.numFmt = CURRENCY_FORMAT;
    if (t.bold) valueCell.font = { bold: true };
    row += 1;
  }
  return row + 1;
}

function colLetter(col: number): string {
  let s = '';
  let n = col;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function companyAddress(c: DocumentPayload['company']): string {
  return [c.addressLine1, c.city, c.state, c.postalCode]
    .filter(Boolean)
    .join(', ');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
