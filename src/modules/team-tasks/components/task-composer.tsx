'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { directUploadFiles } from '@/lib/storage/direct-upload-client';
import {
  createTeamTaskUploadUrlsAction,
  createTeamTaskAction,
} from '../actions';

// Same allow-list hint the document uploader uses; the server enforces.
const FILE_ACCEPT =
  'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,image/*,application/zip,.dwg,.dxf';

export function TaskComposer({
  placeholder = 'Add a note or task for the office to handle…',
  submitLabel = 'Post note',
  tone = 'default',
}: {
  placeholder?: string;
  submitLabel?: string;
  tone?: 'default' | 'field';
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [ok, setOk] = useState(false);

  async function submit() {
    setError(undefined);
    setOk(false);
    if (body.trim() === '' && files.length === 0) {
      setError('Write a note or attach a file (or both).');
      return;
    }
    setPending(true);
    try {
      // Push any attachments straight to storage first, then post the task
      // with the resulting path refs.
      let refs: { storagePath: string; fileName: string; mimeType: string; byteSize: number }[] = [];
      if (files.length > 0) {
        const outcome = await directUploadFiles({
          files,
          requestUrls: (reqs) => createTeamTaskUploadUrlsAction(reqs),
        });
        if (outcome.formError) {
          setError(outcome.formError);
          setPending(false);
          return;
        }
        refs = outcome.refs;
        if (outcome.failures.length > 0 && refs.length === 0) {
          setError(outcome.failures.join(' / '));
          setPending(false);
          return;
        }
      }
      const fd = new FormData();
      fd.set('body', body);
      if (refs.length > 0) fd.set('uploads', JSON.stringify(refs));
      const result = await createTeamTaskAction({}, fd);
      if (result.formError && !result.ok) {
        setError(result.formError);
      } else {
        setOk(true);
        setBody('');
        setFiles([]);
        if (fileRef.current) fileRef.current.value = '';
        formRef.current?.reset();
        if (result.formError) setError(result.formError); // partial attach failure
        router.refresh();
      }
    } catch {
      setError('Could not post — check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  const ring = tone === 'field' ? 'focus:ring-blue-500' : 'focus:ring-slate-400';

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-2"
    >
      <textarea
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={tone === 'field' ? 4 : 2}
        className={`w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 ${ring}`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 h-9 text-sm text-slate-700 cursor-pointer hover:bg-slate-50">
          📎 Attach
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={FILE_ACCEPT}
            className="sr-only"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </label>
        {tone === 'field' && (
          <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 h-9 text-sm text-slate-700 cursor-pointer hover:bg-slate-50">
            📷 Photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) =>
                setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])])
              }
            />
          </label>
        )}
        {files.length > 0 && (
          <span className="text-xs text-slate-500">
            {files.length} file{files.length === 1 ? '' : 's'} attached
          </span>
        )}
        <div className="ml-auto">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Posting…' : submitLabel}
          </Button>
        </div>
      </div>
      {files.length > 0 && (
        <ul className="text-xs text-slate-500 space-y-0.5">
          {files.map((f, i) => (
            <li key={i} className="truncate">
              • {f.name}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {ok && !error && (
        <p className="text-xs text-emerald-700">Posted. Thanks — the office will see it.</p>
      )}
    </form>
  );
}
