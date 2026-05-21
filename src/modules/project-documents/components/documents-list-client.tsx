'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  ColumnHeader,
  type FilterOption,
} from '@/components/ui/column-header';
import { ListToolbar } from '@/components/ui/list-toolbar';
import {
  compareValues,
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

type FilterKey = 'category' | 'visibility';

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
  const [filters, setFilters] = useState<Record<FilterKey, Set<string>>>({
    category: new Set(),
    visibility: new Set(),
  });
  const [sort, setSort] = useState<SortState>(null);

  const categoryOptions = useMemo<FilterOption[]>(() => {
    const present = new Set(documents.map((d) => d.category));
    return documentCategoryValues
      .filter((c) => present.has(c))
      .map((c) => ({ value: c, label: DOCUMENT_CATEGORY_LABEL[c] }));
  }, [documents]);

  const visibilityOptions = useMemo<FilterOption[]>(() => {
    const hasClient = documents.some((d) => d.visibleToClient);
    const hasInternal = documents.some((d) => !d.visibleToClient);
    const opts: FilterOption[] = [];
    if (hasClient) opts.push({ value: 'client', label: 'Client visible' });
    if (hasInternal) opts.push({ value: 'internal', label: 'Internal only' });
    return opts;
  }, [documents]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (set: Set<string>, value: string) =>
      set.size === 0 || set.has(value);
    let rows = documents.filter((d) => {
      const matchesSearch =
        q === '' ||
        d.fileName.toLowerCase().includes(q) ||
        d.originalFileName.toLowerCase().includes(q) ||
        (d.description ?? '').toLowerCase().includes(q);
      const visibility = d.visibleToClient ? 'client' : 'internal';
      return (
        matchesSearch &&
        matches(filters.category, d.category) &&
        matches(filters.visibility, visibility)
      );
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
  }, [documents, search, filters, sort]);

  const setFilter = (key: FilterKey) => (next: Set<string>) =>
    setFilters((prev) => ({ ...prev, [key]: next }));

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
        onClear={() => {
          setSearch('');
          setFilters({ category: new Set(), visibility: new Set() });
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
                    <ColumnHeader
                      label="File"
                      sortKey="fileName"
                      sort={sort}
                      onSortChange={setSort}
                    />
                  </TableHead>
                  <TableHead>
                    <ColumnHeader
                      label="Category"
                      sortKey="category"
                      sort={sort}
                      onSortChange={setSort}
                      filterOptions={categoryOptions}
                      filterValues={filters.category}
                      onFilterChange={setFilter('category')}
                    />
                  </TableHead>
                  <TableHead>
                    <ColumnHeader
                      label="Size"
                      sortKey="size"
                      sort={sort}
                      onSortChange={setSort}
                    />
                  </TableHead>
                  <TableHead>
                    <ColumnHeader
                      label="Visibility"
                      sortKey="visibility"
                      sort={sort}
                      onSortChange={setSort}
                      filterOptions={visibilityOptions}
                      filterValues={filters.visibility}
                      onFilterChange={setFilter('visibility')}
                    />
                  </TableHead>
                  <TableHead>
                    <ColumnHeader
                      label="Uploaded"
                      sortKey="uploadedAt"
                      sort={sort}
                      onSortChange={setSort}
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
