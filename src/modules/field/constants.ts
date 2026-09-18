/**
 * Sentinel the field clock's job picker emits for "Service / leak call" —
 * the crew is on a service call whose job doesn't exist yet (the office
 * creates it when posting the work order). The punch action translates it
 * into is_service_call = true with project_id = null.
 *
 * Lives outside actions.ts because 'use server' modules may only export
 * async functions.
 */
export const SERVICE_CALL_VALUE = '__service_call__';

/**
 * Sentinel for "New job (not in the list)" — the crew types the job's
 * name/address and punches onto it. The punch stores pending_job_name;
 * the office later creates/links the real project, which back-fills
 * project_id on the punches and posted hours.
 */
export const NEW_JOB_VALUE = '__new_job__';
