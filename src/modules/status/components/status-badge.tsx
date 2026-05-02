// Client-safe badge that normalizes legacy status values to the canonical
// labels and tones defined in @/lib/status-machine.

import { Badge } from '@/components/ui/badge';
import { statusDisplay, type EntityType } from '@/lib/status-machine';

export function StatusBadge({
  entityType,
  status,
  className,
}: {
  entityType: EntityType;
  status: string;
  className?: string;
}) {
  const { label, tone } = statusDisplay(entityType, status);
  return (
    <Badge tone={tone} className={className}>
      {label}
    </Badge>
  );
}
