'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ListToolbar } from '@/components/ui/list-toolbar';
import {
  SortableHeader,
  compareValues,
  toggleSort,
  type SortState,
} from '@/components/ui/sortable-header';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DocumentRow,
  type DocumentRowData,
} from './document-row';
import { DocumentCard } from './document-card';
import {
  documentCategoryValues,
  DOCUMENT_CATEGORY_LABEL,
} from '../schema';

const VISIBILITY_OPTIONS = [
  { value: 'client', label: 'Client visible' },
  { value: 'internal', label: 'Internal only' },
];

export function DocumentsListClient({
  projectId,
  documents,
  allowEdit,
}: {
  projectId: string;
  documents: DocumentRowData[];
  allowEdit: boolean;
}) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState('');
  // Default sort: newest uploaded first. Mirrors the data-layer default.
  const [sort, setSort] = useState<SortState>({ key: 'uploadedAt', dir: 'desc' });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = documents.filter((d) => {
      const matchesSearch =
        q === '' ||
        d.fileName.toLowerCase().includes(q) ||
        d.originalFileName.toLowerCase().includes(q) ||
        (d.description ?? '').toLowerCase().includes(q);
      const matchesCategory =
        !categoryFilter || d.category === categoryFilter;
      const matchesVisibility =
        !visibilityFilter ||
        (visibilityFilter === 'client' && d.visibleToClient) ||
        (visibilityFilter === 'internal' && !d.visibleToClient);
      return matchesSearch && matchesCategory && matchesVisibility;
    });

    if (sort) {
      const get = (d: DocumentRowData): string | number | null => {
        switch (sort.key) {
          case 'fileName':
            return d.fileName.toLowerCase();
          case 'size':
            return d.byteSize;
          case 'uploadedAt':
            return new Date(d.uploadedAt).getTime();
          default:
            return null;
        }
      };
      rows = [...rows].sort((a, b) => {
        const cmp = compareValues(get(a), get(b));
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [documents, search, categoryFilter, visibilityFilter, sort]);

  const onSort = (key: string) => setSort((prev) => toggleSort(prev, key));

  const clientCount = documents.filter((d) => d.visibleToClient).length;
  const internalCount = documents.length - clientCount;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span>{documents.length} total</span>
        <span className="text-slate-300 hidden sm:inline">·</span>
        <Badge tone="green">{clientCount} client visible</Badge>
        <Badge tone="slate">{internalCount} internal</Badge>
        {filtered.length !== documents.length && (
          <>
            <span className="text-slate-300 hidden sm:inline">·</span>
            <span className="text-slate-500">
              {filtered.length} match current filter
            </span>
          </>
        )}
      </div>

      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by file name or description…"
        filters={[
          {
            label: 'Category',
            value: categoryFilter,
            onChange: setCategoryFilter,
            options: documentCategoryValues.map((c) => ({
              value: c,
              label: DOCUMENT_CATEGORY_LABEL[c],
            })),
          },
          {
            label: 'Visibility',
            value: visibilityFilter,
            onChange: setVisibilityFilter,
            options: VISIBILITY_OPTIONS,
          },
        ]}
        onClear={() => {
          setSearch('');
          setCategoryFilter('');
          setVisibilityFilter('');
        }}
      />

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 sm:p-12 text-center text-sm text-slate-600">
          {documents.length === 0
            ? 'No documents uploaded for this project yet.'
            : 'No documents match those filters.'}
        </div>
      ) : (
        <>
          {/* Mobile: card list. Hides at md and up. */}
          <div className="space-y-3 md:hidden">
            {filtered.map((doc) => (
              <DocumentCard
                key={doc.id}
                projectId={projectId}
                document={doc}
                allowEdit={allowEdit}
              />
            ))}
          </div>

          {/* Desktop: table. Hides below md. */}
          <div className="hidden md:block rounded-lg border border-slate-200 bg-white overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40%]">
                    <SortableHeader
                      label="File"
                      sortKey="fileName"
                      sort={sort}
                      onSort={onSort}
                    />
                  </TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>
                    <SortableHeader
                      label="Size"
                      sortKey="size"
                      sort={sort}
                      onSort={onSort}
                    />
                  </TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead>
                    <SortableHeader
                      label="Uploaded"
                      sortKey="uploadedAt"
                      sort={sort}
                      onSort={onSort}
                    />
                  </TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((doc) => (
                  <DocumentRow
                    key={doc.id}
                    projectId={projectId}
                    document={doc}
                    allowEdit={allowEdit}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
