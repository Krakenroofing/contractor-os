'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  createCategoryAction,
  renameCategoryAction,
  setCategoryArchivedAction,
} from '../actions';
import {
  CATEGORY_GROUPS,
  CATEGORY_GROUP_LABEL,
  type CategoryGroup,
} from '../categories';

export type ManagedCategory = {
  id: string;
  name: string;
  group: CategoryGroup;
  archived: boolean;
};

export function AccountingCategoriesManager({
  categories,
}: {
  categories: ManagedCategory[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newGroup, setNewGroup] = useState<CategoryGroup>('opex');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? 'Something went wrong.');
        return;
      }
      after?.();
      router.refresh();
    });
  }

  function addCategory() {
    if (newName.trim() === '') {
      setError('Enter a category name.');
      return;
    }
    run(
      () => createCategoryAction({ name: newName, group: newGroup }),
      () => setNewName(''),
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Add */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="mb-2 text-sm font-medium text-slate-700">Add a category</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1">
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Name
            </label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCategory();
                }
              }}
              placeholder="e.g. Equipment Repairs"
            />
          </div>
          <div className="space-y-1 sm:w-56">
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Group
            </label>
            <Select
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value as CategoryGroup)}
            >
              {CATEGORY_GROUPS.map((g) => (
                <option key={g} value={g}>
                  {CATEGORY_GROUP_LABEL[g]}
                </option>
              ))}
            </Select>
          </div>
          <Button type="button" onClick={addCategory} disabled={pending}>
            {pending ? 'Saving…' : 'Add category'}
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Income shows on the P&amp;L as revenue, Cost of Goods Sold as
          job costs, Operating Expense as overhead.
        </p>
      </div>

      {/* Lists by group */}
      {CATEGORY_GROUPS.map((group) => {
        const rows = categories
          .filter((c) => c.group === group)
          .sort((a, b) => {
            if (a.archived !== b.archived) return a.archived ? 1 : -1;
            return a.name.localeCompare(b.name);
          });
        return (
          <div key={group}>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">
              {CATEGORY_GROUP_LABEL[group]}
            </h3>
            {rows.length === 0 ? (
              <p className="text-xs text-slate-400">No categories yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {rows.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-2 px-3 py-2 text-sm"
                  >
                    {editingId === c.id ? (
                      <>
                        <Input
                          value={editName}
                          autoFocus
                          className="h-8 flex-1"
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              run(
                                () =>
                                  renameCategoryAction({
                                    id: c.id,
                                    name: editName,
                                  }),
                                () => setEditingId(null),
                              );
                            }
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () =>
                                renameCategoryAction({
                                  id: c.id,
                                  name: editName,
                                }),
                              () => setEditingId(null),
                            )
                          }
                        >
                          Save
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <span
                          className={`flex-1 ${
                            c.archived ? 'text-slate-400 line-through' : 'text-slate-800'
                          }`}
                        >
                          {c.name}
                          {c.archived && (
                            <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 no-underline">
                              archived
                            </span>
                          )}
                        </span>
                        {!c.archived && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => {
                              setEditingId(c.id);
                              setEditName(c.name);
                            }}
                          >
                            Rename
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            run(() =>
                              setCategoryArchivedAction({
                                id: c.id,
                                archived: !c.archived,
                              }),
                            )
                          }
                        >
                          {c.archived ? 'Restore' : 'Archive'}
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
