import { Button } from '@/components/ui/button';
import type { DocumentType } from '@/lib/exports/types';

// Drop-in pair of "Download PDF" / "Download Excel" buttons. Plain anchors
// hitting the export route — no client JS needed, the browser handles the
// download via Content-Disposition. Same component is reused across every
// document detail page so the buttons stay visually consistent.

export function DocumentDownloadButtons({
  type,
  id,
}: {
  type: DocumentType;
  id: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <a href={`/api/exports/${type}/${id}/pdf`} target="_blank" rel="noopener">
        <Button size="sm" variant="outline">
          Download PDF
        </Button>
      </a>
      <a href={`/api/exports/${type}/${id}/xlsx`}>
        <Button size="sm" variant="outline">
          Download Excel
        </Button>
      </a>
    </div>
  );
}
