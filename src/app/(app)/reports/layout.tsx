import { ReportExportMenu } from '@/modules/reports/components/report-export-menu';

// Every /reports/* page — statements, summaries, AND their drill-downs —
// gets the same Export control (Excel .xlsx or print-to-PDF) without
// per-report wiring. New reports inherit it automatically.
export default function ReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex justify-end px-8 pt-4 print:hidden">
        <ReportExportMenu />
      </div>
      <div className="-mt-4">{children}</div>
    </div>
  );
}
