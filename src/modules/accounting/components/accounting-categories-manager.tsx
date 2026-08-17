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
  setCategoryParentAction,
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
  /** Another category's id when this is a subaccount; null = top level. */
  parentCategoryId: string | null;
};

/** Top-level categories first (alphabetical), each followed by its
 *  subaccounts — QB-style tree order. Archived rows sink to the bottom. */
function treeRows(categories: ManagedCategory[], group: CategoryGroup) {
  const inGroup = categories.filter((c) => c.group === group);
  const byName = (a: ManagedCategory, b: ManagedCategory) => a.name.localeCompare(b.name);
  const active = inGroup.filter((c) => !c.archived);
  const tops = active.filter((c) => !c.parentCategoryId).sort(byName);
  const rows: ManagedCategory[] = [];
  for (const t of tops) {
    rows.push(t);
    rows.push(...active.filter((c) => c.parentCategoryId === t.id).sort(byName));
  }
  // Orphan subs (parent archived) still need to show somewhere.
  rows.push(...active.filter((c) => !rows.includes(c)).sort(byName));
  rows.push(...inGroup.filter((c) => c.archived).sort(byName));
  return rows;
}

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
  const [newIsSub, setNewIsSub] = useState(false);
  const [newParentId, setNewParentId] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editIsSub, setEditIsSub] = useState(false);
  const [editParentId, setEditParentId] = useState('');

  // Eligible parents = active top-level categories in a group (a subaccount
  // can't be a parent; nesting is one level, like QB's sensible limit).
  const parentOptions = (group: CategoryGroup, excludeId?: string) =>
    categories
      .filter(
        (c) =>
          c.group === group &&
          !c.archived &&
          !c.parentCategoryId &&
          c.id !== excludeId,
      )
      .sort((a, b) => a.name.localeCompare(b.name));

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
    if (newIsSub && !newParentId) {
      setError('Pick the parent account for this subaccount.');
      return;
    }
    run(
      () =>
        createCategoryAction({
          name: newName,
          group: newGroup,
          parentCategoryId: newIsSub ? newParentId : '',
        }),
      () => {
        setNewName('');
        setNewIsSub(false);
        setNewParentId('');
      },
    );
  }

  function startEdit(c: ManagedCategory) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditIsSub(!!c.parentCategoryId);
    setEditParentId(c.parentCategoryId ?? '');
  }

  function saveEdit(c: ManagedCategory) {
    if (editIsSub && !editParentId) {
      setError('Pick the parent account for this subaccount.');
      return;
    }
    const wantParent = editIsSub ? editParentId : '';
    const parentChanged = wantParent !== (c.parentCategoryId ?? '');
    const nameChanged = editName.trim() !== c.name;
    run(
      async () => {
        if (nameChanged) {
          const r = await renameCategoryAction({ id: c.id, name: editName });
          if (!r.ok) return r;
        }
        if (parentChanged) {
          const r = await setCategoryParentAction({
            id: c.id,
            parentCategoryId: wantParent,
          });
          if (!r.ok) return r;
        }
        return { ok: true as const };
      },
      () => setEditingId(null),
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
              onChange={(e) => {
                setNewGroup(e.target.value as CategoryGroup);
                setNewParentId('');
              }}
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
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={newIsSub}
              onChange={(e) => setNewIsSub(e.target.checked)}
            />
            This is a subaccount
          </label>
          {newIsSub && (
            <div className="sm:w-72">
              <Select
                value={newParentId}
                onChange={(e) => setNewParentId(e.target.value)}
              >
                <option value="">Parent account…</option>
                {parentOptions(newGroup).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Income shows on the P&amp;L as revenue, Cost of Goods Sold as
          job costs, Operating Expense as overhead. Assets, Liabilities, and
          Equity are balance-sheet categories &mdash; use them for things like
          loan payments, equipment purchases, and owner draws. Subaccounts
          nest under a parent in the same group (e.g. Insurance &rarr; Vehicle
          Insurance).
        </p>
      </div>

      {/* Lists by group */}
      {CATEGORY_GROUPS.map((group) => {
        const rows = treeRows(categories, group);
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
                    className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
                  >
                    {editingId === c.id ? (
                      <>
                        <Input
                          value={editName}
                          autoFocus
                          className="h-8 min-w-40 flex-1"
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              saveEdit(c);
                            }
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                        <label className="inline-flex shrink-0 items-center gap-1.5 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded border-slate-300"
                            checked={editIsSub}
                            onChange={(e) => setEditIsSub(e.target.checked)}
                          />
                          Subaccount
                        </label>
                        {editIsSub && (
                          <Select
                            value={editParentId}
                            onChange={(e) => setEditParentId(e.target.value)}
                            className="h-8 w-52 text-xs"
                          >
                            <option value="">Parent account…</option>
                            {parentOptions(c.group, c.id).map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </Select>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          disabled={pending}
                          onClick={() => saveEdit(c)}
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
                          } ${c.parentCategoryId ? 'pl-6' : ''}`}
                        >
                          {c.parentCategoryId && (
                            <span className="mr-1.5 text-slate-400">&#8627;</span>
                          )}
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
                            onClick={() => startEdit(c)}
                          >
                            Edit
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
