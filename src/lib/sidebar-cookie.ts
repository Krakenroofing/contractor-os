/**
 * Name of the cookie holding the office sidebar's collapsed preference
 * ('1' = collapsed). Lives in its own plain module because both the server
 * layout (which reads it) and the client shell (which writes it) need it —
 * a const exported from a 'use client' module comes back as a client
 * reference on the server, not the string.
 */
export const SIDEBAR_COOKIE = 'cos_sidebar_collapsed';
