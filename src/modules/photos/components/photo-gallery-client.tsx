'use client';

// Selectable photo gallery for the per-project Photos page. Photos are
// grouped by upload date; each card carries a checkbox, and every date
// group has a "select day" toggle, so the operator can grab a day's (or
// any hand-picked set's) photos as one zip. The download itself is a
// plain form POST to /api/photos/download-selected/[projectId] — the
// browser treats the zip response as a normal file download.

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export type PhotoCard = {
  id: string;
  /** Signed preview URL, or null when the blob was unreadable. */
  url: string | null;
  category: string;
  /** YYYY-MM-DD of uploadedAt — also the grouping key. */
  date: string;
  caption: string | null;
  reportHref: string;
  downloadHref: string;
};

export function PhotoGalleryClient({
  projectId,
  cards,
}: {
  projectId: string;
  cards: PhotoCard[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const formRef = useRef<HTMLFormElement>(null);

  // Cards arrive sorted newest-first; group them by upload date preserving
  // that order.
  const groups = useMemo(() => {
    const out: { date: string; cards: PhotoCard[] }[] = [];
    for (const c of cards) {
      const last = out[out.length - 1];
      if (last && last.date === c.date) last.cards.push(c);
      else out.push({ date: c.date, cards: [c] });
    }
    return out;
  }, [cards]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setMany(ids: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function downloadSelected() {
    // Submit the hidden form — the ids travel as a JSON field and the zip
    // comes back as a regular browser download.
    formRef.current?.submit();
  }

  const allIds = useMemo(() => cards.map((c) => c.id), [cards]);
  const allSelected = selected.size === cards.length && cards.length > 0;

  return (
    <div className="space-y-6">
      {/* Hidden download form (POST → zip download, no navigation). */}
      <form
        ref={formRef}
        method="POST"
        action={`/api/photos/download-selected/${projectId}`}
        className="hidden"
      >
        <input
          type="hidden"
          name="photoIds"
          value={JSON.stringify([...selected])}
          readOnly
        />
      </form>

      {/* Selection toolbar — sticky so it stays reachable mid-scroll. */}
      <div className="sticky top-0 z-10 -mx-2 px-2 py-2 bg-white/95 backdrop-blur border-b border-slate-200 flex items-center gap-3 flex-wrap">
        <span className="text-sm text-slate-600 tabular-nums min-w-[7rem]">
          {selected.size === 0
            ? 'Select photos…'
            : `${selected.size} selected`}
        </span>
        <Button
          size="sm"
          onClick={downloadSelected}
          disabled={selected.size === 0}
        >
          Download selected{selected.size > 0 ? ` (${selected.size})` : ''}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setMany(allIds, !allSelected)}
        >
          {allSelected ? 'Clear all' : 'Select all'}
        </Button>
        {selected.size > 0 && !allSelected && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        )}
      </div>

      {groups.map((g) => {
        const groupIds = g.cards.map((c) => c.id);
        const groupAllSelected = groupIds.every((id) => selected.has(id));
        return (
          <section key={g.date} className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={groupAllSelected}
                  onChange={(e) => setMany(groupIds, e.target.checked)}
                />
                <span className="text-sm font-medium text-slate-900 tabular-nums">
                  {g.date}
                </span>
              </label>
              <span className="text-xs text-slate-500">
                {g.cards.length} photo{g.cards.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {g.cards.map((photo) => {
                const isSelected = selected.has(photo.id);
                return (
                  <div
                    key={photo.id}
                    className={`rounded-xl border bg-white overflow-hidden flex flex-col ${
                      isSelected
                        ? 'border-blue-500 ring-2 ring-blue-200'
                        : 'border-slate-200'
                    }`}
                  >
                    <div className="relative aspect-square bg-slate-100">
                      {/* Selection hit-target: generous corner pad so it's
                          tappable without opening the photo. */}
                      <label className="absolute top-0 left-0 z-10 p-2 cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-5 w-5 rounded border-slate-300 shadow bg-white/90"
                          checked={isSelected}
                          onChange={() => toggle(photo.id)}
                        />
                      </label>
                      {photo.url ? (
                        <a
                          href={photo.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photo.url}
                            alt={photo.caption ?? 'Daily report photo'}
                            className="w-full h-full object-cover"
                          />
                        </a>
                      ) : (
                        <div className="flex items-center justify-center h-full text-[10px] text-slate-400">
                          Unavailable
                        </div>
                      )}
                    </div>
                    <div className="p-2 space-y-1 text-xs flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <Badge tone="slate">{photo.category}</Badge>
                        <span className="text-slate-400 tabular-nums">
                          {photo.date}
                        </span>
                      </div>
                      {photo.caption && (
                        <p className="text-slate-700 line-clamp-2">
                          {photo.caption}
                        </p>
                      )}
                      <div className="flex items-center justify-between pt-1">
                        <Link
                          href={{ pathname: photo.reportHref }}
                          className="text-blue-600 hover:underline"
                        >
                          Report →
                        </Link>
                        <a
                          href={photo.downloadHref}
                          className="text-slate-600 hover:text-slate-900 font-medium"
                        >
                          Download
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
