'use server';

// Self-link server action — let an existing signed-in user claim a
// specific employee record so the rest of the field app works for them.
//
// Why this exists: M1's invite flow stamps users.employee_id on signup,
// but anyone who signed up BEFORE that feature (notably the owner who
// bootstrapped the company) has employee_id = NULL with no UI to fix
// it. /field/profile renders a "Not linked" banner — this action is
// what backs the picker that appears alongside it.
//
// Security:
//   - Gated to owner / project_manager. Field workers must not be able
//     to re-assign their identity (that's a privilege escalation —
//     they could claim a different employee's clock-ins / reports).
//     Field users get their link via the invite flow only.
//   - The chosen employee must belong to the current active company
//     (guards cross-tenant linking).
//   - The chosen employee must not already be linked to another user
//     (the partial unique index would reject this anyway, but we
//     surface a friendly error before the DB call).

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { getDb, isDatabaseConfigured } from '@/db';
import { users } from '@/db/schema';
import { getEmployee } from '@/lib/data/employees';
import { listUsersWithEmployeeLink } from '@/lib/data/users';

export type LinkEmployeeState = {
  ok?: boolean;
  formError?: string;
};

const schema = z.object({
  employeeId: z.string().uuid('Pick an employee'),
});

export async function linkSelfToEmployeeAction(
  _prev: LinkEmployeeState,
  formData: FormData,
): Promise<LinkEmployeeState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  // Reuse invitations:create as the permission gate — only roles that
  // can invite others can also self-link. Keeps the privileged ops
  // policy in one place.
  if (!canCreate(role, 'invitations')) {
    return {
      formError:
        "You don't have permission to change employee links. Ask an owner.",
    };
  }
  if (!isDatabaseConfigured()) {
    return {
      formError:
        'Linking requires a configured database. Set DATABASE_URL.',
    };
  }

  const parsed = schema.safeParse({
    employeeId: formData.get('employeeId') ?? '',
  });
  if (!parsed.success) {
    return { formError: parsed.error.errors[0]?.message ?? 'Invalid input.' };
  }

  const companyId = await getActiveCompanyId();
  const employee = await getEmployee(companyId, parsed.data.employeeId);
  if (!employee) {
    return { formError: 'Employee not found in this company.' };
  }

  // Reject if the chosen employee is already linked to a different
  // user. This guards against the owner accidentally hijacking a field
  // worker's identity. The DB's partial unique index enforces the same
  // invariant, but we surface a friendly error before the round-trip.
  const linked = await listUsersWithEmployeeLink(companyId);
  const conflict = linked.find(
    (u) => u.employeeId === employee.id && u.id !== user.id,
  );
  if (conflict) {
    return {
      formError: `${employee.firstName} ${employee.lastName} is already linked to another login (${conflict.email}). Unlink that first to claim this employee.`,
    };
  }

  const db = getDb()!;
  await db
    .update(users)
    .set({ employeeId: employee.id, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  revalidatePath('/field');
  revalidatePath('/field/profile');
  return { ok: true };
}

export async function unlinkSelfFromEmployeeAction(
  _prev: LinkEmployeeState,
  _formData: FormData,
): Promise<LinkEmployeeState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'invitations')) {
    return {
      formError:
        "You don't have permission to change employee links. Ask an owner.",
    };
  }
  if (!isDatabaseConfigured()) {
    return {
      formError:
        'Linking requires a configured database. Set DATABASE_URL.',
    };
  }
  const db = getDb()!;
  await db
    .update(users)
    .set({ employeeId: null, updatedAt: new Date() })
    .where(eq(users.id, user.id));
  revalidatePath('/field');
  revalidatePath('/field/profile');
  return { ok: true };
}
