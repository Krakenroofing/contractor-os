// Direct-to-storage upload plumbing (browser side). Counterpart of
// src/lib/storage/signed-upload.ts — see that file for the why.
//
// No 'server-only' here: this runs in the browser, PUTting the file
// straight to Supabase Storage so the bytes never pass through a Vercel
// function (and therefore never hit the ~4.5MB action body cap).

/**
 * PUT a file to a Supabase signed upload URL (token embedded in the URL).
 * Throws with a readable message on any failure so callers can surface it.
 */
export async function uploadFileToSignedUrl(
  signedUrl: string,
  file: File | Blob,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(signedUrl, {
      method: 'PUT',
      headers: {
        'content-type': file.type || 'application/octet-stream',
        'x-upsert': 'false',
      },
      body: file,
    });
  } catch {
    throw new Error(
      'The file never reached storage — check your connection and try again.',
    );
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      detail = body.message || body.error || '';
    } catch {
      /* non-JSON body */
    }
    throw new Error(
      `Storage rejected the upload (${res.status}${detail ? `: ${detail}` : ''}).`,
    );
  }
}
