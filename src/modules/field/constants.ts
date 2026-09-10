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
