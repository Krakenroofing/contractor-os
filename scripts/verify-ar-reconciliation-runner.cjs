// Tiny CJS bootstrap: stub `server-only` to a no-op so we can run the
// reconciliation verifier under tsx without the runtime guard tripping.
// This only affects the verification process — production code is
// unaffected because Next.js's bundler does the same stub during builds.

const Module = require('node:module');
const { resolve } = require('node:path');

const realResolve = Module._resolveFilename;
const stubPath = resolve(__dirname, 'server-only-stub.js');
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'server-only') return stubPath;
  return realResolve.call(this, request, parent, ...rest);
};

require('tsx/cjs/api').register();
require('./verify-ar-reconciliation.ts');
