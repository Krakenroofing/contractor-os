import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listInventoryLocations } from '@/lib/data/inventory-locations';
import { LocationsAdmin } from '@/modules/inventory/components/locations-admin';

export const dynamic = 'force-dynamic';

export default async function InventoryLocationsPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'inventory')) redirect('/inventory');
  const companyId = await getActiveCompanyId();
  const locations = await listInventoryLocations(companyId, {
    includeArchived: true,
  });

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/inventory', label: 'Inventory' },
          { label: 'Stock locations' },
        ]}
      />

      <Link href="/inventory">
        <Button variant="outline" size="sm">
          ← Back to Inventory
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Stock locations
        </h1>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          Physical places where stock is held. Every receipt and adjustment is
          tagged to one. Exactly one location is the default — used when a
          form leaves the picker blank. Archive a location to hide it from
          new entries while keeping its history intact.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Current locations ({locations.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {locations.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No locations yet. Add one below — &quot;Main Yard&quot; is a
              good first one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right w-72">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {locations.map((l) => (
                  <TableRow key={l.id} className={l.archivedAt ? 'opacity-60' : ''}>
                    <TableCell className="text-slate-900">
                      <span className="font-medium">{l.name}</span>
                      {l.isDefault && (
                        <Badge tone="blue" className="ml-2">
                          Default
                        </Badge>
                      )}
                      {l.archivedAt && (
                        <Badge tone="slate" className="ml-2">
                          Archived
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-600 text-sm">
                      {l.notes ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <LocationsAdmin
                        location={{
                          id: l.id,
                          isDefault: l.isDefault,
                          isArchived: l.archivedAt !== null,
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add location</CardTitle>
        </CardHeader>
        <CardContent>
          <LocationsAdmin mode="create" />
        </CardContent>
      </Card>
    </div>
  );
}
