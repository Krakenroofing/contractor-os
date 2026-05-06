'use client';

// Two-step destructive-action button. Click once: turns into "Click again to
// confirm" with a 5-second cancel timer. Click again within the window:
// submits the form. Used for archive / delete actions where we don't want a
// modal dialog but still need an explicit confirmation step.

import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, type ButtonProps } from './button';

export interface ConfirmButtonProps extends Omit<ButtonProps, 'type' | 'onClick' | 'children'> {
  /** Default label. */
  children: React.ReactNode;
  /** Label shown after the first click. */
  confirmLabel?: React.ReactNode;
  /** Label shown while the form action is pending. */
  pendingLabel?: React.ReactNode;
  /** Confirmation window in milliseconds. After this elapses, the button reverts. */
  timeoutMs?: number;
}

export function ConfirmButton({
  children,
  confirmLabel = 'Click again to confirm',
  pendingLabel = 'Working…',
  timeoutMs = 5000,
  variant = 'destructive',
  ...rest
}: ConfirmButtonProps) {
  const { pending } = useFormStatus();
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset to disarmed state when the form action completes.
  useEffect(() => {
    if (!pending && armed) {
      // Once the form has actually been submitted (pending was true and is
      // now false), the button has done its job. But we don't want to clear
      // the armed state immediately — useFormStatus also reads `pending` for
      // the parent form, and the action might cause a redirect, in which
      // case this component unmounts. The timer below handles non-redirect
      // cases.
    }
  }, [pending, armed]);

  // Auto-disarm after timeoutMs.
  useEffect(() => {
    if (!armed) return;
    timerRef.current = setTimeout(() => setArmed(false), timeoutMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [armed, timeoutMs]);

  function onClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (!armed) {
      // First click: arm. Don't submit yet.
      e.preventDefault();
      setArmed(true);
      return;
    }
    // Second click: let the button submit the form normally.
  }

  return (
    <Button
      type="submit"
      variant={armed ? 'destructive' : variant}
      onClick={onClick}
      disabled={pending}
      aria-pressed={armed}
      {...rest}
    >
      {pending ? pendingLabel : armed ? confirmLabel : children}
    </Button>
  );
}
