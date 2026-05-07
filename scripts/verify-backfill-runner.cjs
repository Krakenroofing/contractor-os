const Module = require('node:module');
const { resolve } = require('node:path');

const realResolve = Module._resolveFilename;
const stubPath = resolve(__dirname, 'server-only-stub.js');
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'server-only') return stubPath;
  return realResolve.call(this, request, parent, ...rest);
};

require('tsx/cjs/api').register();
require('./verify-backfill.ts');
