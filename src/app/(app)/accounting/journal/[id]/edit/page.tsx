import { redirect } from 'next/navigation';

// Posted journal entries are final (roadmap Priority 1): there is no
// edit-in-place. The correction path is Reverse & correct on the journal,
// which reverses the entry and opens a pre-filled new entry. Old links to
// /edit land on the entry itself.
export default async function EditJournalEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/accounting/journal?entry=${id}` as never);
}
