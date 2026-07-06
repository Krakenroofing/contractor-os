import Link from 'next/link';
import { notFound } from 'next/navigation';
import { inArray } from 'drizzle-orm';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getProject } from '@/lib/data/projects';
import { listProjectDocuments } from '@/lib/data/project-documents';
import { getDb, isDatabaseConfigured } from '@/db';
import { users } from '@/db/schema';
import { DocumentUploader } from '@/modules/project-documents/components/document-uploader';
import { DocumentsListClient } from '@/modules/project-documents/components/documents-list-client';
import type { DocumentRowData } from '@/modules/project-documents/components/document-row';
import {
  documentCategoryValues,
  type DocumentCategory,
} from '@/modules/project-documents/schema';

export const dynamic = 'force-dynamic';

export default async function ProjectDocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const { id } = await params;
  const { category: categoryParam } = await searchParams;
  const defaultCategory = documentCategoryValues.includes(
    categoryParam as DocumentCategory,
  )
    ? (categoryParam as DocumentCategory)
    : undefined;
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'documents');

  const project = await getProject(companyId, id);
  if (!project) notFound();

  const documents = await listProjectDocuments(companyId, project.id);

  // Resolve uploader display names in one query. If DB isn't configured the
  // data layer returns an empty list, so we don't get here in demo mode.
  const uploaderIds = Array.from(
    new Set(
      documents
        .map((d) => d.uploadedBy)
        .filter((v): v is string => typeof v === 'string'),
    ),
  );
  const uploaderMap = new Map<string, string>();
  if (uploaderIds.length > 0 && isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, uploaderIds));
    for (const r of rows) {
      uploaderMap.set(r.id, r.name || r.email);
    }
  }

  const rowData: DocumentRowData[] = documents.map((d) => ({
    id: d.id,
    fileName: d.fileName,
    originalFileName: d.originalFileName,
    mimeType: d.mimeType,
    byteSize: d.byteSize,
    category: d.category as DocumentCategory,
    description: d.description,
    visibleToClient: d.visibleToClient,
    uploadedAt:
      d.uploadedAt instanceof Date
        ? d.uploadedAt.toISOString()
        : String(d.uploadedAt),
    uploaderName: d.uploadedBy ? uploaderMap.get(d.uploadedBy) ?? null : null,
  }));

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-4 md:space-y-6 max-w-7xl">
      <Breadcrumbs
        items={[
          { href: '/projects', label: 'Projects' },
          { href: `/projects/${project.id}`, label: project.name },
          { label: 'Documents' },
        ]}
      />

      <div className="flex items-start justify-between flex-wrap gap-2">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-semibold text-slate-900">
            Documents
          </h1>
          <p className="text-sm text-slate-600 break-words">{project.name}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href={`/projects/${project.id}`}>
            <Button variant="outline" size="sm">
              ← Back
            </Button>
          </Link>
        </div>
      </div>

      {allowCreate && (
        <DocumentUploader
          projectId={project.id}
          defaultCategory={defaultCategory}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>All documents ({rowData.length})</CardTitle>
        </CardHeader>
        <CardContent className="px-3 sm:px-6">
          <DocumentsListClient
            projectId={project.id}
            documents={rowData}
            allowEdit={allowCreate}
          />
        </CardContent>
      </Card>
    </div>
  );
}
