// Empty replacement for the `server-only` package — used by
// verify-ar-reconciliation-runner.cjs. Mirrors what Next.js's bundler does
// when emitting the server bundle (the real package throws unconditionally
// to flag accidental client-side imports).
module.exports = {};
