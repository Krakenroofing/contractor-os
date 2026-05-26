'use client';

// Two modes share this component:
//   - mode="create" — renders the "Add location" form
//   - default (per-row) — renders the row actions (set default / archive /
//     unarchive)
//
// Combined into one client component so the locations admin page can stay
// a server component and just sprinkle these wherever needed.

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  archiveInventoryLocationAction,
  createInventoryLocationAction,
  setDefaultLocationAction,
  unarchiveInventoryLocationAction,
  type LocationActionState,
} from '../actions';

const initial: LocationActionState = {};

export function LocationsAdmin(
  props:
    | { mode: 'create' }
    | {
        location: {
          id: string;
          isDefault: boolean;
          isArchived: boolean;
        };
      },
) {
  if ('mode' in props && props.mode === 'create') {
    return <CreateForm />;
  }
  if ('location' in props) {
    return <RowActions location={props.location} />;
  }
  return null;
}

function CreateForm() {
  const [state, formAction, pending] = useActionState(
    createInventoryLocationAction,
    initial,
  );
  return (
    <form action={formAction} className="space-y-4 max-w-md">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {state.formError}
        </div>
      )}
      <div className="space-y-1.5">
        <Label>
          Name <span className="text-red-600">*</span>
        </Label>
        <Input
          name="name"
          placeholder="Main Yard, Truck 1, Job Site — 1234 Bay St"
          required
          maxLength={120}
        />
        {state.errors?.name?.[0] && (
          <p className="text-xs text-red-600">{state.errors.name[0]}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label>Notes (optional)</Label>
        <Input
          name="notes"
          placeholder="Behind the office, gated. Manager: Joe."
          maxLength={500}
        />
      </div>
      <label className="inline-flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="isDefault" />
        Make this the default location (used when a form leaves the picker
        blank)
      </label>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add location'}
        </Button>
      </div>
    </form>
  );
}

function RowActions({
  location,
}: {
  location: { id: string; isDefault: boolean; isArchived: boolean };
}) {
  const [setDefState, setDefAction, setDefPending] = useActionState(
    setDefaultLocationAction,
    initial,
  );
  const [archState, archAction, archPending] = useActionState(
    archiveInventoryLocationAction,
    initial,
  );
  const [unArchState, unArchAction, unArchPending] = useActionState(
    unarchiveInventoryLocationAction,
    initial,
  );

  return (
    <div className="flex items-center justify-end gap-2 flex-wrap">
      {(setDefState.formError || archState.formError || unArchState.formError) && (
        <p className="text-xs text-red-600 mr-2">
          {setDefState.formError ?? archState.formError ?? unArchState.formError}
        </p>
      )}
      {!location.isDefault && !location.isArchived && (
        <form action={setDefAction}>
          <input type="hidden" name="id" value={location.id} />
          <Button type="submit" size="sm" variant="outline" disabled={setDefPending}>
            Make default
          </Button>
        </form>
      )}
      {!location.isArchived ? (
        <form
          action={archAction}
          onSubmit={(e) => {
            if (
              !window.confirm(
                'Archive this location? Its movement history stays intact; new entries can no longer use it.',
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="id" value={location.id} />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={archPending || location.isDefault}
            title={
              location.isDefault
                ? 'Set another location as default before archiving this one.'
                : undefined
            }
          >
            Archive
          </Button>
        </form>
      ) : (
        <form action={unArchAction}>
          <input type="hidden" name="id" value={location.id} />
          <Button type="submit" size="sm" variant="outline" disabled={unArchPending}>
            Restore
          </Button>
        </form>
      )}
    </div>
  );
}
