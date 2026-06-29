'use client';

import { useActionState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import {
  resolveTeamTaskAction,
  reopenTeamTaskAction,
  deleteTeamTaskAction,
  type TeamTaskActionState,
} from '../actions';
import type { TeamTaskView } from '../lib/build-team-tasks';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function fileGlyph(mime: string): string {
  if (mime.startsWith('image/')) return '🖼️';
  if (mime === 'application/pdf') return '📄';
  if (mime.includes('sheet') || mime.includes('excel') || mime === 'text/csv')
    return '📊';
  if (mime.includes('word')) return '📝';
  return '📎';
}

export function TaskItem({
  task,
  canResolve,
  canDelete,
}: {
  task: TeamTaskView;
  canResolve: boolean;
  canDelete: boolean;
}) {
  const [, resolveAction, resolvePending] = useActionState<TeamTaskActionState, FormData>(
    resolveTeamTaskAction.bind(null, task.id),
    {},
  );
  const [, reopenAction] = useActionState<TeamTaskActionState, FormData>(
    reopenTeamTaskAction.bind(null, task.id),
    {},
  );
  const [, deleteAction] = useActionState<TeamTaskActionState, FormData>(
    deleteTeamTaskAction.bind(null, task.id),
    {},
  );

  const done = task.status === 'done';
  const imageAttachments = task.attachments.filter((a) =>
    a.mimeType.startsWith('image/'),
  );
  const fileAttachments = task.attachments.filter(
    (a) => !a.mimeType.startsWith('image/'),
  );

  return (
    <li
      className={`rounded-md border px-3 py-2.5 ${
        done ? 'border-slate-200 bg-slate-50/60' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="font-medium text-slate-700">{task.createdByName}</span>
            <span>·</span>
            <span>{relativeTime(task.createdAtISO)}</span>
            {done && <Badge tone="green">Done</Badge>}
          </div>
          {task.body && (
            <p
              className={`mt-1 text-sm whitespace-pre-wrap break-words ${
                done ? 'text-slate-500' : 'text-slate-900'
              }`}
            >
              {task.body}
            </p>
          )}
          {task.attachments.length > 0 && (
            <div className="mt-1.5 space-y-1.5">
              {/* Image attachments render as thumbnails — click opens the
                  full-size image inline (no forced download). */}
              {imageAttachments.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {imageAttachments.map((a) => (
                    <li key={a.id}>
                      <a
                        href={`/dashboard/tasks/${task.id}/attachments/${a.id}/download?view=1`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={a.fileName}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/dashboard/tasks/${task.id}/attachments/${a.id}/download?view=1`}
                          alt={a.fileName}
                          loading="lazy"
                          className="h-20 w-20 rounded border border-slate-200 object-cover hover:opacity-90"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {/* Non-image attachments keep the download chip. */}
              {fileAttachments.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {fileAttachments.map((a) => (
                    <li key={a.id}>
                      <a
                        href={`/dashboard/tasks/${task.id}/attachments/${a.id}/download`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                        title={a.fileName}
                      >
                        <span aria-hidden>{fileGlyph(a.mimeType)}</span>
                        <span className="max-w-[12rem] truncate">{a.fileName}</span>
                        {a.byteSize > 0 && (
                          <span className="text-slate-400">{formatBytes(a.byteSize)}</span>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {done && task.resolvedByName && (
            <p className="mt-1 text-[11px] text-slate-400">
              Resolved by {task.resolvedByName}
              {task.resolvedAtISO ? ` · ${relativeTime(task.resolvedAtISO)}` : ''}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canResolve && !done && (
            <form action={resolveAction}>
              <Button type="submit" size="sm" variant="outline" disabled={resolvePending}>
                {resolvePending ? '…' : '✓ Done'}
              </Button>
            </form>
          )}
          {canResolve && done && (
            <form action={reopenAction}>
              <Button type="submit" size="sm" variant="outline">
                Reopen
              </Button>
            </form>
          )}
          {canDelete && (
            <form action={deleteAction}>
              <ConfirmButton
                size="sm"
                variant="ghost"
                confirmLabel="Sure?"
                pendingLabel="…"
              >
                ✕
              </ConfirmButton>
            </form>
          )}
        </div>
      </div>
    </li>
  );
}
