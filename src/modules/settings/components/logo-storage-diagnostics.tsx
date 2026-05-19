// Owner-only diagnostic card that probes the exact code path used by the
// PDF renderer to embed a company logo. Surfaces the failure mode in plain
// English so the operator can fix it without reading Vercel function logs.
//
// Checks, in order:
//   1. Is the Supabase admin client configured? (env vars present)
//   2. Does the active company have a `logoUrl` set? (someone uploaded one)
//   3. Can we mint a signed URL? (bucket exists, key valid)
//   4. Can we actually download the bytes? (this is what the PDF needs)
//
// Each check renders a green ✓ or red × with the reason. If everything
// passes, the operator should see their logo on the next generated PDF.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getSupabaseAdminClient } from '@/lib/auth/supabase-admin';
import { buildCompanyInfo } from '@/lib/exports/data/company-info';
import {
  COMPANY_LOGOS_BUCKET,
  createSignedLogoUrl,
} from '@/lib/storage/company-logos';

type Check = {
  label: string;
  pass: boolean;
  detail: string;
};

export async function LogoStorageDiagnostics() {
  const company = await getActiveCompany();
  const checks: Check[] = [];

  // 1. Admin client / env vars
  const adminClient = getSupabaseAdminClient();
  checks.push({
    label: 'Supabase admin client configured',
    pass: Boolean(adminClient),
    detail: adminClient
      ? 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set on the server.'
      : 'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the deployment. Logos cannot be embedded in PDFs until both are set.',
  });

  // 2. Logo path on the company row
  const logoPath = company.logoUrl;
  checks.push({
    label: `Logo path stored for ${company.name}`,
    pass: Boolean(logoPath),
    detail: logoPath
      ? `companies.logo_url = "${logoPath}"`
      : 'No logo has been uploaded for this company. Go to Settings → Logo and upload one.',
  });

  // 3 + 4 only run if both prerequisites passed.
  let signedUrl: string | null = null;
  if (adminClient && logoPath) {
    try {
      signedUrl = await createSignedLogoUrl(logoPath);
      checks.push({
        label: 'Signed URL can be minted',
        pass: Boolean(signedUrl),
        detail: signedUrl
          ? 'Bucket access works for read URLs (used on settings page + on-screen branding).'
          : `Could not mint a signed URL for "${logoPath}". The "${COMPANY_LOGOS_BUCKET}" bucket may not exist in this Supabase project, or the file at that path may have been removed.`,
      });
    } catch (err) {
      checks.push({
        label: 'Signed URL can be minted',
        pass: false,
        detail: `Threw: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // 4. Direct download — primitive storage probe
    try {
      const { data, error } = await adminClient.storage
        .from(COMPANY_LOGOS_BUCKET)
        .download(logoPath);
      if (error) {
        checks.push({
          label: 'Logo file downloads from bucket',
          pass: false,
          detail: `Storage returned: "${error.message}". Likely the "${COMPANY_LOGOS_BUCKET}" bucket does not exist in production Supabase, or the service role key does not have access to it.`,
        });
      } else if (!data) {
        checks.push({
          label: 'Logo file downloads from bucket',
          pass: false,
          detail: 'Storage returned no data and no error. Treat as a broken upload — re-upload the logo from Settings.',
        });
      } else {
        const buf = Buffer.from(await data.arrayBuffer());
        const bytes = buf.byteLength;
        checks.push({
          label: 'Logo file downloads from bucket',
          pass: true,
          detail: `Downloaded ${bytes.toLocaleString()} bytes.`,
        });

        // 4b. Magic-byte sniff. The file's declared mime (from the storage
        //     path extension) is what we hand to @react-pdf, but the actual
        //     file bytes are what gets decoded. If they disagree — e.g. an
        //     SVG was uploaded with a .png filename, or an HEIC was renamed
        //     to .jpg — the browser is forgiving and renders it on screen,
        //     but @react-pdf does a strict PNG/JPEG decode and silently
        //     drops the image. This check catches that mismatch.
        const head = buf.subarray(0, Math.min(16, buf.byteLength));
        const hex = Array.from(head)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(' ');
        const ascii = head.toString('utf8', 0, Math.min(8, head.length));
        const isPng =
          head[0] === 0x89 &&
          head[1] === 0x50 &&
          head[2] === 0x4e &&
          head[3] === 0x47;
        const isJpeg =
          head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
        const looksLikeSvg = ascii.startsWith('<svg') || ascii.startsWith('<?xml');
        const isGif = ascii.startsWith('GIF8');
        const isWebp =
          head[0] === 0x52 &&
          head[1] === 0x49 &&
          head[2] === 0x46 &&
          head[3] === 0x46;

        let actualFormat: string;
        if (isPng) actualFormat = 'PNG';
        else if (isJpeg) actualFormat = 'JPEG';
        else if (looksLikeSvg) actualFormat = 'SVG (text-based)';
        else if (isGif) actualFormat = 'GIF';
        else if (isWebp) actualFormat = 'WebP / RIFF';
        else actualFormat = `Unknown (first bytes: ${hex.slice(0, 23)})`;

        const pdfReady = isPng || isJpeg;
        checks.push({
          label: 'File bytes match PNG or JPEG signature',
          pass: pdfReady,
          detail: pdfReady
            ? `Magic bytes confirm a real ${actualFormat}. @react-pdf will accept this.`
            : `Detected: ${actualFormat}. The file was stored with an extension that says PNG/JPG but the actual bytes are something else. @react-pdf does a strict decode and silently drops the image. Fix: open the original logo in any image editor (Paint, Preview, Photoshop, GIMP) and export/save as ".png" — that will produce real PNG bytes. Then re-upload from Settings → Logo.`,
        });
      }
    } catch (err) {
      checks.push({
        label: 'Logo file downloads from bucket',
        pass: false,
        detail: `Threw: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // 5. End-to-end: run the SAME function the PDF renderer calls. This
    //    catches any drift between the raw storage probe (check #4) and the
    //    buildCompanyInfo wrapper that prepares the payload for @react-pdf.
    //    If checks #1-#4 pass but this one fails, the bug is in the wrapper
    //    or downstream of it — not in storage.
    try {
      const info = await buildCompanyInfo(company);
      if (info.logoDataUrl) {
        const dataUrlBytes = info.logoDataUrl.length;
        const mimeMatch = info.logoDataUrl.match(/^data:([^;]+);base64,/);
        const mime = mimeMatch ? mimeMatch[1] : 'unknown';
        checks.push({
          label: 'PDF payload includes logo data URL',
          pass: true,
          detail: `buildCompanyInfo() returned a ${mime} data URL of ${dataUrlBytes.toLocaleString()} chars.`,
        });

        // 6. @react-pdf/renderer only embeds raster images (PNG, JPEG). SVG,
        //    WebP, GIF, and AVIF data URLs are silently dropped — the rest of
        //    the PDF renders, but no logo appears. This is the most common
        //    "everything looks fine but the logo isn't there" failure mode.
        const PDF_COMPATIBLE = new Set(['image/png', 'image/jpeg', 'image/jpg']);
        if (PDF_COMPATIBLE.has(mime)) {
          checks.push({
            label: '@react-pdf can embed this image format',
            pass: true,
            detail: `${mime} is a raster format @react-pdf supports. The next PDF you download will include the logo.`,
          });
        } else {
          checks.push({
            label: '@react-pdf can embed this image format',
            pass: false,
            detail: `${mime} is not embeddable by @react-pdf/renderer. It works on screen (browsers render it fine), which is why reports show the logo — but PDFs silently drop it. Fix: re-upload the logo as a PNG or JPEG.`,
          });
        }
      } else {
        checks.push({
          label: 'PDF payload includes logo data URL',
          pass: false,
          detail: 'buildCompanyInfo() returned null for logoDataUrl despite the raw download succeeding. Check the Vercel function logs for "[company-logos]" lines — the failure reason will be there. Likely candidates: a stale deployment is running pre-fix code, or @react-pdf is rejecting the encoded mime type.',
        });
      }
    } catch (err) {
      checks.push({
        label: 'PDF payload includes logo data URL',
        pass: false,
        detail: `buildCompanyInfo() threw: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const allPass = checks.every((c) => c.pass);
  const summaryTone = allPass
    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
    : 'bg-amber-50 border-amber-300 text-amber-900';
  const summaryMessage = allPass
    ? `Logo for ${company.name} is wired end-to-end. PDFs will include it.`
    : 'Something between Supabase Storage and the PDF renderer is broken — see the failing checks below.';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo storage</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={`rounded-md border px-3 py-2 text-sm ${summaryTone}`}>
          {summaryMessage}
        </div>

        <ul className="space-y-2">
          {checks.map((c) => (
            <li key={c.label} className="flex items-start gap-2 text-sm">
              <span
                className={
                  c.pass
                    ? 'text-emerald-700 font-semibold'
                    : 'text-red-700 font-semibold'
                }
                aria-hidden
              >
                {c.pass ? '✓' : '×'}
              </span>
              <div className="min-w-0">
                <p className="text-slate-900">{c.label}</p>
                <p className="text-xs text-slate-600 mt-0.5 break-words">
                  {c.detail}
                </p>
              </div>
            </li>
          ))}
        </ul>

        {signedUrl && (
          <div className="pt-2 border-t border-slate-100">
            <p className="text-xs text-slate-500 mb-2">
              Preview (signed URL — same one used on the Settings → Logo card):
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={signedUrl}
              alt={`${company.name} logo preview`}
              className="h-20 max-w-[180px] object-contain border border-slate-200 rounded-md bg-white p-2"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
