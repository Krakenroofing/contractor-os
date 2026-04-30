import { Badge } from '@/components/ui/badge';
import type { projectStatusValues } from '../schema';

type Status = (typeof projectStatusValues)[number];

const tone: Record<Status, 'slate' | 'blue' | 'amber' | 'green' | 'red'> = {
  lead: 'slate',
  estimating: 'blue',
  won: 'green',
  in_progress: 'amber',
  closed: 'green',
  lost: 'red',
};

const label: Record<Status, string> = {
  lead: 'Lead',
  estimating: 'Estimating',
  won: 'Won',
  in_progress: 'In Progress',
  closed: 'Closed',
  lost: 'Lost',
};

export function ProjectStatusBadge({ status }: { status: Status }) {
  return <Badge tone={tone[status]}>{label[status]}</Badge>;
}
