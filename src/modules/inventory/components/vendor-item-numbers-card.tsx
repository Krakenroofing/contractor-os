'use client';

// Suppliers' own item numbers for one product (roadmap P4): ABC's 12345,
// Gulfeagle's GE-778 … all resolve to this catalog item, so PO pickers and
// the PDF matcher find it by the number on the vendor's paperwork.

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  addVendorItemNumberAction,
  deleteVendorItemNumberAction,
} from '../vendor-number-actions';

export type VendorNumberRow = {
  id: string;
  vendorName: string;
  number: string;
  description: string | null;
};

export function VendorItemNumbersCard({
  itemId,
  rows,
  vendors,
  canEdit,
}: {
  itemId: string;
  rows: VendorNumberRow[];
  vendors: Array<{ id: string; name: string }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [vendorId, setVendorId] = useState('');
  const [number, setNumber] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [takenBy, setTakenBy] = useState<string | null>(null);

  function add(move = false) {
    setError(null);
    start(async () => {
      const res = await addVendorItemNumberAction({
        itemId,
        vendorId,
        number,
        description: description || undefined,
        move,
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not save.');
        setTakenBy(res.takenByItemId ?? null);
        return;
      }
      setNumber('');
      setDescription('');
      setTakenBy(null);
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      await deleteVendorItemNumberAction({ id, itemId });
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vendor item numbers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {rows.length === 0 ? (
          <p className="text-slate-500">
            No vendor numbers yet. Add the number each supplier uses for this
            product — PO product pickers then list it first for that vendor
            and find it by their number.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-1.5">
                <span>
                  <span className="text-slate-500">{r.vendorName}</span>{' '}
                  <span className="font-mono">#{r.number}</span>
                  {r.description ? (
                    <span className="ml-2 text-xs text-slate-400">{r.description}</span>
                  ) : null}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(r.id)}
                    className="text-xs text-slate-400 hover:text-red-600"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_10rem_1fr_auto]">
              <select
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                className="h-10 rounded-md border border-slate-300 bg-white px-2 text-sm"
              >
                <option value="">— Vendor —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <Input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="Their item #"
                maxLength={80}
              />
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Their description (optional)"
                maxLength={300}
              />
              <Button
                type="button"
                disabled={pending || !vendorId || !number.trim()}
                onClick={() => add(false)}
              >
                Add
              </Button>
            </div>
            {error && (
              <p className="text-xs text-red-600">
                {error}{' '}
                {takenBy && (
                  <>
                    <Link
                      href={{ pathname: `/inventory/${takenBy}` }}
                      className="underline"
                    >
                      See that product
                    </Link>{' '}
                    or{' '}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => add(true)}
                    >
                      move the number to this product
                    </button>
                    .
                  </>
                )}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
