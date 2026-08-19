'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import {
  resolveTeamTaskAction,
  reopenTeamTaskAction,
  deleteTeamTaskAction,
  deleteTeamTaskReplyAction,
  editTeamTaskAction,
  editTeamTaskReplyAction,
  replyToTeamTaskAction,
  type TeamTaskActionState,
} from '../actions';
import type { TeamTaskReplyView, TeamTaskView } from '../lib/build-team-tasks';

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
            {done && <Badge tone="green">Resolved</Badge>}
          </div>
          <EditableBody
            body={task.body}
            edited={task.edited}
            muted={done}
            canEdit={canDelete}
            editAction={editTeamTaskAction.bind(null, task.id)}
          />
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
          <ReplyThread taskId={task.id} replies={task.replies} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canResolve && !done && (
            <form action={resolveAction}>
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={resolvePending}
                title="Mark resolved — moves to the archive (nothing is deleted)"
              >
                {resolvePending ? '…' : '✓ Resolve'}
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

/** Threaded replies under a note + the "Respond" composer. Replies post via
 *  the shared team-task permission (anyone who can post can respond), so a
 *  question in the inbox can get an answer instead of just open/done. */
function ReplyThread({
  taskId,
  replies,
}: {
  taskId: string;
  replies: TeamTaskReplyView[];
}) {
  const [composing, setComposing] = useState(false);
  const [state, formAction, pending] = useActionState<
    TeamTaskActionState,
    FormData
  >(replyToTeamTaskAction.bind(null, taskId), {});
  const formRef = useRef<HTMLFormElement>(null);

  // Successful post → clear + close the composer (the new reply arrives via
  // the server revalidation).
  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setComposing(false);
    }
  }, [state.ok]);

  return (
    <div className="mt-2">
      {replies.length > 0 && (
        <ul className="space-y-1.5 border-l-2 border-slate-200 pl-3">
          {replies.map((r) => (
            <ReplyRow key={r.id} reply={r} />
          ))}
        </ul>
      )}
      {composing ? (
        <form ref={formRef} action={formAction} className="mt-2 space-y-1.5">
          <textarea
            name="body"
            rows={2}
            autoFocus
            placeholder="Write a reply…"
            className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Posting…' : 'Post reply'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setComposing(false)}
            >
              Cancel
            </Button>
            {state.formError && (
              <span className="text-xs text-red-600">{state.formError}</span>
            )}
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="mt-1.5 text-xs font-medium text-blue-700 hover:underline"
        >
          ↩ Respond
        </button>
      )}
    </div>
  );
}

function ReplyRow({ reply }: { reply: TeamTaskReplyView }) {
  const [editing, setEditing] = useState(false);
  const [, deleteAction] = useActionState<TeamTaskActionState, FormData>(
    deleteTeamTaskReplyAction.bind(null, reply.id),
    {},
  );
  const [editState, editFormAction, editPending] = useActionState<
    TeamTaskActionState,
    FormData
  >(async (prev, fd) => {
    const res = await editTeamTaskReplyAction(reply.id, prev, fd);
    if (res.ok) setEditing(false);
    return res;
  }, {});

  return (
    <li className="group text-sm">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="font-medium text-slate-700">{reply.createdByName}</span>
        <span>·</span>
        <span>{relativeTime(reply.createdAtISO)}</span>
        {reply.edited && <span className="text-slate-400">(edited)</span>}
        {!editing && (
          <span className="hidden items-center gap-1 group-hover:inline-flex">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="h-5 rounded px-1 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Edit reply"
            >
              ✎
            </button>
            <form action={deleteAction}>
              <ConfirmButton
                size="sm"
                variant="ghost"
                confirmLabel="Sure?"
                pendingLabel="…"
                className="h-5 px-1 text-[11px] text-slate-400"
              >
                ✕
              </ConfirmButton>
            </form>
          </span>
        )}
      </div>
      {editing ? (
        <form action={editFormAction} className="mt-1 space-y-1.5">
          <textarea
            name="body"
            rows={2}
            autoFocus
            defaultValue={reply.body}
            className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={editPending}>
              {editPending ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            {editState.formError && (
              <span className="text-xs text-red-600">{editState.formError}</span>
            )}
          </div>
        </form>
      ) : (
        <p className="whitespace-pre-wrap break-words text-slate-800">
          {reply.body}
        </p>
      )}
    </li>
  );
}

/** The note's own body with an inline edit mode (admins any note, posters
 *  their own — enforced server-side; the pencil shows when `canEdit`). */
function EditableBody({
  body,
  edited,
  muted,
  canEdit,
  editAction,
}: {
  body: string;
  edited: boolean;
  muted: boolean;
  canEdit: boolean;
  editAction: (
    prev: TeamTaskActionState,
    fd: FormData,
  ) => Promise<TeamTaskActionState>;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<
    TeamTaskActionState,
    FormData
  >(async (prev, fd) => {
    const res = await editAction(prev, fd);
    if (res.ok) setEditing(false);
    return res;
  }, {});

  if (editing) {
    return (
      <form action={formAction} className="mt-1 space-y-1.5">
        <textarea
          name="body"
          rows={3}
          autoFocus
          defaultValue={body}
          className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
          {state.formError && (
            <span className="text-xs text-red-600">{state.formError}</span>
          )}
        </div>
      </form>
    );
  }

  if (!body) return null;
  return (
    <p
      className={`group/body mt-1 text-sm whitespace-pre-wrap break-words ${
        muted ? 'text-slate-500' : 'text-slate-900'
      }`}
    >
      {body}
      {edited && (
        <span className="ml-1.5 text-[11px] text-slate-400">(edited)</span>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="ml-1.5 rounded px-1 text-[11px] text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-600 group-hover/body:opacity-100"
          aria-label="Edit note"
        >
          ✎ Edit
        </button>
      )}
    </p>
  );
}
