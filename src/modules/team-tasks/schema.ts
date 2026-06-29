import { z } from 'zod';

// A team task carries free-text body and/or one or more attachments. The
// action layer requires at least one of the two to be present (a note with no
// text and no file is meaningless).
export const createTeamTaskSchema = z.object({
  body: z.string().trim().max(8000).optional().default(''),
});

export type CreateTeamTaskInput = z.infer<typeof createTeamTaskSchema>;
