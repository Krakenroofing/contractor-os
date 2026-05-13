'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import {
  setDefaultInvoiceTemplateAction,
  type SetDefaultTemplateState,
} from '../actions';

export function SetDefaultTemplateButton({
  templateId,
  isDefault,
  size = 'sm',
}: {
  templateId: string;
  isDefault: boolean;
  size?: 'sm' | 'md';
}) {
  const bound = setDefaultInvoiceTemplateAction.bind(null, templateId);
  const [state, formAction, pending] = useActionState<
    SetDefaultTemplateState,
    FormData
  >(bound, {});

  return (
    <form action={formAction} className="inline-flex flex-col items-start gap-1">
      <Button
        type="submit"
        size={size}
        variant={isDefault ? 'ghost' : 'outline'}
        disabled={pending || isDefault}
      >
        {isDefault ? '✓ Default' : pending ? 'Saving…' : 'Make default'}
      </Button>
      {state.formError && (
        <span className="text-xs text-red-600">{state.formError}</span>
      )}
    </form>
  );
}
