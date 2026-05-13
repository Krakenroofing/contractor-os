// Which document MIME types can be rendered inline by a browser when handed a
// signed Supabase URL. Anything not in this set falls back to "Download only"
// — DOCX / XLSX / DWG / DXF / ZIP / etc. have no native browser rendering, so
// trying to preview them just triggers a download anyway.
//
// HEIC is included even though most non-Safari browsers can't render it — the
// `view` route mints a content-typed signed URL, so Safari/macOS users get a
// real preview and other browsers fall back to download. That's strictly
// better than hiding the Preview button.
export const PREVIEWABLE_DOCUMENT_MIME = new Set<string>([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
  'text/plain',
  'text/csv',
  'application/csv',
]);

export function canPreviewInline(mime: string | null | undefined): boolean {
  if (!mime) return false;
  return PREVIEWABLE_DOCUMENT_MIME.has(mime.toLowerCase());
}
