import 'server-only';
import { renderToBuffer } from '@react-pdf/renderer';
import { DocumentPdf } from './document-template';
import type { DocumentPayload } from '@/lib/exports/types';

export async function renderDocumentPdf(
  payload: DocumentPayload,
): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<DocumentPdf payload={payload} />);
  return new Uint8Array(buffer);
}
