import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * Detail-page back button.
 *
 * Detail pages (invoice, PO, change order, …) are global routes, so their
 * default back link points at the global list. But when the user reaches the
 * page from inside a project — every link out of the project page carries
 * `?from=project` — they expect to land back on that project, not the list.
 *
 * Pass `projectId` (and ideally `projectName`) only when that flag is set, and
 * the button returns to the project instead of the list.
 */
export function BackButton({
  listHref,
  listLabel,
  projectId,
  projectName,
}: {
  listHref: string;
  listLabel: string;
  projectId?: string | null;
  projectName?: string | null;
}) {
  const toProject = Boolean(projectId);
  return (
    <Link
      href={{ pathname: toProject ? `/projects/${projectId}` : listHref }}
    >
      <Button variant="outline" size="sm">
        ← Back to {toProject ? projectName || 'Project' : listLabel}
      </Button>
    </Link>
  );
}
