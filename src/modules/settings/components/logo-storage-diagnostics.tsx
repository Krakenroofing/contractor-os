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

    // 4. Direct download — this is what the PDF renderer uses
    try {
      const { data, error } = await adminClient.storage
        .from(COMPANY_LOGOS_BUCKET)
        .download(logoPath);
      if (error) {
        checks.push({
          label: 'Logo file downloads (used by PDF export)',
          pass: false,
          detail: `Storage returned: "${error.message}". Likely the "${COMPANY_LOGOS_BUCKET}" bucket does not exist in production Supabase, or the service role key does not have access to it.`,
        });
      } else if (!data) {
        checks.push({
          label: 'Logo file downloads (used by PDF export)',
          pass: false,
          detail: 'Storage returned no data and no error. Treat as a broken upload — re-upload the logo from Settings.',
        });
      } else {
        const bytes = (await data.arrayBuffer()).byteLength;
        checks.push({
          label: 'Logo file downloads (used by PDF export)',
          pass: true,
          detail: `Downloaded ${bytes.toLocaleString()} bytes. The PDF export path will embed this logo on the next invoice / proposal / PO / CO download.`,
        });
      }
    } catch (err) {
      checks.push({
        label: 'Logo file downloads (used by PDF export)',
        pass: false,
        detail: `Threw: ${err instanceof Error ? err.message : String(err)}`,
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
