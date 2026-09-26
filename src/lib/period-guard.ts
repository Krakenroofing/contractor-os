import 'server-only';
import { periodClosedMessage } from '@/lib/data/accounting-periods';

/**
 * Run a server action's write section; if the database's closed-period
 * guard (SQLSTATE KP001) rejects it, return `onClosed(message)` instead of
 * throwing. In production Next.js replaces thrown server-action errors
 * with a generic message, so without this the user would only ever see
 * "something went wrong" instead of which period is closed.
 */
export async function guardPeriod<T>(
  fn: () => Promise<T>,
  onClosed: (message: string) => T,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = periodClosedMessage(err);
    if (msg) return onClosed(msg);
    throw err;
  }
}
