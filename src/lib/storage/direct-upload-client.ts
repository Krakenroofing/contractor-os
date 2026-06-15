// Browser-side orchestration for direct-to-storage uploads:
//   1. Downscale images (optional — photos shrink ~10x, uploads get fast)
//   2. Ask the module's server action for signed upload URLs
//   3. PUT each file straight to Supabase Storage (bypasses the ~4.5MB
//      Vercel action body cap entirely)
//   4. Hand back path refs for the module's finalize action to verify +
//      record
//
// Files are PUT sequentially — predictable on the spotty cell connections
// the field crew actually has, and the storage API sees steady load.

import { downscalePhotoForUpload } from '@/lib/images/downscale-photo';
import { uploadFileToSignedUrl } from '@/lib/storage/upload-to-signed-url';

export type UploadUrlRequest = {
  fileName: string;
  mimeType: string;
  byteSize: number;
};

export type UploadUrlGrant = {
  fileName: string;
  storagePath?: string;
  signedUrl?: string;
  error?: string;
};

export type UploadUrlResponse = {
  formError?: string;
  uploads?: UploadUrlGrant[];
};

/** What the finalize action receives, JSON-encoded under `uploads`. The
 *  server re-stats the blob — byteSize/mimeType here are display hints. */
export type DirectUploadedRef = {
  storagePath: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
};

export type DirectUploadOutcome = {
  /** Successfully uploaded blobs, ready for the finalize action. */
  refs: DirectUploadedRef[];
  /** Per-file failure messages ("name: reason"). */
  failures: string[];
  /** Whole-batch error (no permission / storage unconfigured). */
  formError?: string;
};

export async function directUploadFiles(opts: {
  files: File[];
  /** The module's create-upload-URLs server action. */
  requestUrls: (requests: UploadUrlRequest[]) => Promise<UploadUrlResponse>;
  /** Downscale image files before upload (default true). */
  downscaleImages?: boolean;
}): Promise<DirectUploadOutcome> {
  const downscale = opts.downscaleImages !== false;
  const prepared: File[] = [];
  for (const f of opts.files) {
    prepared.push(downscale ? await downscalePhotoForUpload(f) : f);
  }

  let response: UploadUrlResponse;
  try {
    response = await opts.requestUrls(
      prepared.map((f) => ({
        fileName: f.name,
        mimeType: f.type || 'application/octet-stream',
        byteSize: f.size,
      })),
    );
  } catch {
    return {
      refs: [],
      failures: [],
      formError:
        'Could not start the upload — check your connection and try again.',
    };
  }
  if (response.formError) {
    return { refs: [], failures: [], formError: response.formError };
  }

  const refs: DirectUploadedRef[] = [];
  const failures: string[] = [];
  for (let i = 0; i < prepared.length; i++) {
    const file = prepared[i];
    const grant = response.uploads?.[i];
    if (!grant || grant.error || !grant.signedUrl || !grant.storagePath) {
      failures.push(`${file.name}: ${grant?.error ?? 'no upload URL issued.'}`);
      continue;
    }
    try {
      await uploadFileToSignedUrl(grant.signedUrl, file);
      refs.push({
        storagePath: grant.storagePath,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        byteSize: file.size,
      });
    } catch (err) {
      failures.push(
        `${file.name}: ${err instanceof Error ? err.message : 'upload failed.'}`,
      );
    }
  }
  return { refs, failures };
}
