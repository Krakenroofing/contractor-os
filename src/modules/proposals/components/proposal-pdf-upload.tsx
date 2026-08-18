'use client';

// Create-a-proposal-from-PDF flow, mirroring the PO upload:
//   Phase 1: drop / pick the PDF -> direct-to-storage signed upload
//            (bypasses the ~4.5MB Vercel action body cap) -> extract action
//            OCRs it and parses the proposal sections.
//   Phase 2: the standard ProposalForm, prefilled from the extraction, with
//            hidden source-file fields so the create action archives the
//            PDF into the chosen project's documents.

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { directUploadFiles } from '@/lib/storage/direct-upload-client';
import { createReceiptUploadUrlsAction } from '@/modules/receipts/actions';
import {
  extractProposalPdfAction,
  type ExtractProposalPdfState,
} from '../actions';
import {
  ProposalForm,
  type EstimateOption,
  type ProjectOption,
  type ProposalFormPrefill,
} from './proposal-form';

export function ProposalPdfUpload({
  estimates,
  projects,
  defaultNumber,
}: {
  estimates: EstimateOption[];
  projects: ProjectOption[];
  defaultNumber: string;
}) {
  const [state, setState] = useState<ExtractProposalPdfState>({});
  const [pending, setPending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onFileChosen(file: File) {
    if (pending) return;
    setPending(true);
    setState({});
    try {
      const outcome = await directUploadFiles({
        files: [file],
        requestUrls: createReceiptUploadUrlsAction,
      });
      if (outcome.formError || outcome.refs.length === 0) {
        setState({
          formError:
            outcome.formError ??
            (outcome.failures.length > 0
              ? outcome.failures.join(' / ')
              : 'Upload failed — try again.'),
        });
        return;
      }
      const fd = new FormData();
      fd.set('uploads', JSON.stringify(outcome.refs));
      setState(await extractProposalPdfAction({}, fd));
    } catch {
      setState({
        formError:
          'Upload failed — the file never reached the server. Check your connection and try again.',
      });
    } finally {
      setPending(false);
    }
  }

  if (state.extracted && state.source) {
    const e = state.extracted;
    const prefill: ProposalFormPrefill = {
      number: e.number,
      proposalDate: e.proposalDate,
      total: e.total !== null ? e.total.toFixed(2) : null,
      scopeOfWork: e.scopeOfWork,
      inclusions: e.inclusions,
      exclusions: e.exclusions,
      paymentSchedule: e.paymentSchedule,
      warrantyNotes: e.warrantyNotes,
      termsAndConditions: e.termsAndConditions,
    };
    return (
      <ProposalForm
        estimates={estimates}
        projects={projects}
        defaultNumber={defaultNumber}
        prefill={prefill}
        source={state.source}
      />
    );
  }

  return (
    <div className="space-y-4">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}
      <div
        className={`rounded-lg border-2 border-dashed px-8 py-16 text-center transition-colors ${
          dragOver ? 'border-slate-500 bg-slate-50' : 'border-slate-300'
        }`}
        onDragOver={(ev) => {
          ev.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(ev) => {
          ev.preventDefault();
          setDragOver(false);
          const file = ev.dataTransfer.files?.[0];
          if (file) void onFileChosen(file);
        }}
      >
        {pending ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">
              Reading the proposal…
            </p>
            <p className="text-xs text-slate-500">
              Uploading, scanning, and parsing the sections. This takes a few
              seconds.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-700">
              Drop the proposal PDF here
            </p>
            <p className="text-xs text-slate-500">
              The scope, inclusions, exclusions, payment schedule, warranty,
              terms, date, and total are read from the PDF into an editable
              form. PDF or photo, max 25 MB.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose file
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(ev) => {
                const file = ev.target.files?.[0];
                if (file) void onFileChosen(file);
                ev.target.value = '';
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
