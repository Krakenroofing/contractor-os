'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  RECEIPT_STATUS_LABEL,
  receiptStatusValues,
} from '../schema';

type Option = { id: string; label: string };

export type ReceiptsFilterBarProps = {
  initial: {
    status: string;
    vendorId: string;
    projectId: string;
    dateFrom: string;
    dateTo: string;
    amountMin: string;
    amountMax: string;
  };
  vendors: Option[];
  projects: Option[];
};

// Filter bar for the receipts list. Submits via GET → the page re-renders
// server-side with the new query params. Empty fields are stripped so the
// URL doesn't grow `?status=&vendorId=&…` noise.
export function ReceiptsFilterBar(props: ReceiptsFilterBarProps) {
  const router = useRouter();
  const [status, setStatus] = useState(props.initial.status);
  const [vendorId, setVendorId] = useState(props.initial.vendorId);
  const [projectId, setProjectId] = useState(props.initial.projectId);
  const [dateFrom, setDateFrom] = useState(props.initial.dateFrom);
  const [dateTo, setDateTo] = useState(props.initial.dateTo);
  const [amountMin, setAmountMin] = useState(props.initial.amountMin);
  const [amountMax, setAmountMax] = useState(props.initial.amountMax);

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (vendorId) params.set('vendorId', vendorId);
    if (projectId) params.set('projectId', projectId);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (amountMin) params.set('amountMin', amountMin);
    if (amountMax) params.set('amountMax', amountMax);
    const qs = params.toString();
    router.push(qs ? `/banking/receipts?${qs}` : '/banking/receipts');
  }

  function clearAll() {
    setStatus('');
    setVendorId('');
    setProjectId('');
    setDateFrom('');
    setDateTo('');
    setAmountMin('');
    setAmountMax('');
    router.push('/banking/receipts');
  }

  const anyApplied = Boolean(
    status ||
      vendorId ||
      projectId ||
      dateFrom ||
      dateTo ||
      amountMin ||
      amountMax,
  );

  return (
    <form
      onSubmit={apply}
      className="rounded-md border border-slate-200 p-3 grid grid-cols-1 md:grid-cols-4 gap-3"
    >
      <div>
        <Label htmlFor="f-status">Status</Label>
        <Select
          id="f-status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All</option>
          {receiptStatusValues.map((s) => (
            <option key={s} value={s}>
              {RECEIPT_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="f-vendor">Vendor</Label>
        <Select
          id="f-vendor"
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
        >
          <option value="">All</option>
          {props.vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="f-project">Project</Label>
        <Select
          id="f-project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">All</option>
          {props.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="f-from">From</Label>
          <Input
            id="f-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="f-to">To</Label>
          <Input
            id="f-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="f-min">Min total</Label>
          <Input
            id="f-min"
            inputMode="decimal"
            value={amountMin}
            onChange={(e) => setAmountMin(e.target.value)}
            placeholder="0"
          />
        </div>
        <div>
          <Label htmlFor="f-max">Max total</Label>
          <Input
            id="f-max"
            inputMode="decimal"
            value={amountMax}
            onChange={(e) => setAmountMax(e.target.value)}
            placeholder="∞"
          />
        </div>
      </div>
      <div className="md:col-span-2 flex items-end gap-2">
        <Button type="submit">Apply</Button>
        {anyApplied && (
          <Button type="button" variant="outline" onClick={clearAll}>
            Clear
          </Button>
        )}
      </div>
    </form>
  );
}
