'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ROLE_LABELS, ROLES } from '@/lib/permissions';
import {
  createInvitationAction,
  type CreateInvitationState,
} from '@/modules/invitations/actions';

const initial: CreateInvitationState = {};

export function InviteForm({ companyName }: { companyName: string }) {
  const [state, formAction, pending] = useActionState(
    createInvitationAction,
    initial,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [copied, setCopied] = useState(false);
  const err = (k: string) => state.errors?.[k]?.[0];

  useEffect(() => {
    if (state.ok && !state.formError) formRef.current?.reset();
  }, [state.ok, state.formError]);

  function copyUrl() {
    if (!state.acceptUrl) return;
    navigator.clipboard.writeText(state.acceptUrl).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  }

  return (
    <div className="space-y-4">
      <form ref={formRef} action={formAction} className="space-y-4">
        {state.formError && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {state.formError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              maxLength={200}
              placeholder="alex@kraken.example"
            />
            {err('email') && (
              <p className="text-xs text-red-600">{err('email')}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="role">Role</Label>
            <Select name="role" defaultValue="project_manager" id="role">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
            {err('role') && <p className="text-xs text-red-600">{err('role')}</p>}
          </div>
        </div>

        <p className="text-xs text-slate-500">
          The invitation will be issued for <span className="font-medium">{companyName}</span>.
          Switch the active company in the sidebar before inviting users to a different one.
        </p>

        <Button type="submit" disabled={pending}>
          {pending ? 'Generating link…' : 'Generate invite link'}
        </Button>
      </form>

      {state.ok && state.acceptUrl && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 space-y-2">
          <p className="text-sm font-medium text-emerald-800">
            Invite link ready — copy &amp; send via your preferred channel
          </p>
          <div className="flex items-stretch gap-2">
            <input
              readOnly
              value={state.acceptUrl}
              className="flex-1 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-mono text-slate-700 focus:outline-none"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button type="button" size="sm" variant="outline" onClick={copyUrl}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <p className="text-xs text-emerald-700">
            Link expires in 7 days. The recipient sets their password on
            /accept-invite, and their membership is created with the role
            you picked.
          </p>
        </div>
      )}
    </div>
  );
}
