import 'server-only';
import {
  getDailyReport,
  getManpowerForReport,
  listPhotosForReport,
} from '@/lib/data/daily-reports';
import { getProject } from '@/lib/data/projects';
import { getCustomer } from '@/lib/data/customers';
import { getActiveCompany } from '@/lib/active-company';
import { buildCompanyInfo } from '@/lib/exports/data/company-info';
import { getDailyReportPhotoDataUrl } from '@/lib/storage/daily-report-photos';
import {
  STATUS_LABEL,
  PHOTO_CATEGORY_LABEL,
} from '@/modules/daily-reports/schema';
import type {
  DocumentPayload,
  DocumentSection,
  DocumentMeta,
  DocumentDataTable,
  DocumentImage,
} from '@/lib/exports/types';

// PDF payload builder for daily reports.
//
// Honors all `include_*_in_export` flags on the report and the per-photo
// `visible_to_client` flag. Internal notes are never included regardless of
// any flag — the only way internal notes leak to the client export is if
// the operator manually copies the text into `client_notes`.

export async function buildDailyReportPayload(
  companyId: string,
  reportId: string,
): Promise<DocumentPayload | null> {
  const report = await getDailyReport(companyId, reportId);
  if (!report) return null;

  const company = await getActiveCompany();
  const project = await getProject(companyId, report.projectId);
  const customer = project
    ? await getCustomer(companyId, project.customerId)
    : undefined;

  const manpower = await getManpowerForReport(report.id);
  const allPhotos = await listPhotosForReport(report.id);

  // Top-of-document metadata. Weather lands here only if its export flag is
  // on; status/date/location are always shown.
  const meta: DocumentMeta[] = [
    { label: 'Report date', value: report.reportDate },
    { label: 'Status', value: STATUS_LABEL[report.status] },
  ];
  if (report.projectLocationSnapshot) {
    meta.push({ label: 'Location', value: report.projectLocationSnapshot });
  }
  if (report.preparedByName) {
    meta.push({ label: 'Prepared by', value: report.preparedByName });
  }
  if (report.foremanName) {
    meta.push({ label: 'Foreman', value: report.foremanName });
  }
  if (report.crewCompanyName) {
    meta.push({ label: 'Crew / Company', value: report.crewCompanyName });
  }
  if (report.includeWeatherInExport) {
    const tempStr = report.weatherTemperatureF
      ? `${report.weatherTemperatureF}°F`
      : null;
    const weatherParts = [
      report.weatherCondition,
      tempStr,
      report.weatherWind ? `Wind: ${report.weatherWind}` : null,
      report.weatherPrecipitation
        ? `Precip: ${report.weatherPrecipitation}`
        : null,
      report.weatherHumidity ? `Humidity: ${report.weatherHumidity}` : null,
    ].filter(Boolean);
    if (weatherParts.length > 0) {
      meta.push({ label: 'Weather', value: weatherParts.join(' · ') });
    }
  }

  // Manpower as a data table — appears only if the report has rows AND the
  // include flag is on.
  const dataTables: DocumentDataTable[] = [];
  if (report.includeManpowerInExport && manpower.length > 0) {
    const totalMen = manpower.reduce((s, m) => s + m.workerCount, 0);
    const totalHrs = manpower.reduce(
      (s, m) => s + Number(m.hours || 0),
      0,
    );
    dataTables.push({
      title: `Manpower (${totalMen} workers · ${totalHrs.toFixed(2)} hrs)`,
      columns: [
        { label: 'Company / Crew', widthPct: 28 },
        { label: 'Trade', widthPct: 22 },
        { label: '# Men', align: 'right', widthPct: 10 },
        { label: 'Hours', align: 'right', widthPct: 12 },
        { label: 'Notes', widthPct: 28 },
      ],
      rows: manpower.map((m) => [
        m.companyCrew ?? '—',
        m.trade ?? '—',
        String(m.workerCount),
        String(m.hours),
        m.notes ?? '',
      ]),
    });
  }

  // Narrative prose sections — each one is gated on its own include flag.
  // Section bodies are skipped when empty even if the include flag is on,
  // so the PDF doesn't carry "Materials delivered: —" filler.
  const sections: DocumentSection[] = [];
  const pushSection = (
    title: string,
    body: string | null | undefined,
    enabled: boolean,
  ) => {
    if (!enabled) return;
    const text = (body ?? '').trim();
    if (text.length === 0) return;
    sections.push({ title, body: text });
  };

  pushSection('Site conditions', report.siteConditions, true);
  pushSection('Work performed today', report.workPerformed, report.includeWorkInExport);
  pushSection(
    'Materials delivered',
    report.materialsDelivered,
    report.includeMaterialsInExport,
  );
  pushSection(
    'Equipment on site',
    report.equipmentOnSite,
    report.includeEquipmentInExport,
  );
  pushSection('Inspections', report.inspections, true);
  pushSection('Delays', report.delays, report.includeDelaysInExport);
  pushSection(
    'Safety incidents',
    report.safetyIncidents,
    report.includeSafetyInExport,
  );
  pushSection('Visitors on site', report.visitorsOnSite, true);
  pushSection(
    'Issues / Concerns',
    report.issuesConcerns,
    report.includeIssuesInExport,
  );
  pushSection("Tomorrow's planned work", report.tomorrowPlan, true);
  pushSection(
    'Notes for client',
    report.clientNotes,
    report.includeClientNotesInExport,
  );

  // Photos — gated on the master include flag AND per-photo visibility.
  // Failed downloads are silently skipped so a single broken blob can't
  // prevent the rest of the export from rendering.
  const imageGallery: DocumentImage[] = [];
  if (report.includePhotosInExport) {
    const visible = allPhotos.filter((p) => p.visibleToClient);
    const fetched = await Promise.all(
      visible.map(async (p) => {
        const dataUrl = await getDailyReportPhotoDataUrl(
          p.storagePath,
          p.mimeType,
        );
        if (!dataUrl) return null;
        return {
          caption: p.caption,
          category: PHOTO_CATEGORY_LABEL[p.category],
          src: dataUrl,
        };
      }),
    );
    for (const img of fetched) {
      if (img) imageGallery.push(img);
    }
  }

  return {
    type: 'daily_report',
    title: 'Daily Report',
    number: report.reportDate,
    statusLabel: STATUS_LABEL[report.status],
    company: await buildCompanyInfo(company),
    customer: customer
      ? {
          name: customer.name,
          contact: customer.primaryContactName ?? null,
          email: customer.email ?? null,
          phone: customer.phone ?? null,
        }
      : undefined,
    project: project
      ? {
          name: report.projectNameSnapshot ?? project.name,
          description: report.projectLocationSnapshot ?? null,
        }
      : undefined,
    meta,
    totals: [], // no financial totals on a daily report
    sections,
    dataTables,
    imageGallery,
    footerNote: `${company.name} · Daily Report · ${report.reportDate}`,
  };
}
