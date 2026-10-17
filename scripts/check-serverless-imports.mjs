import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

process.env.VERCEL = '1';
const importBuilt = (name) => import(pathToFileURL(resolve('.vercel-build', name)).href);
const [healthModule, aircraftModule] = await Promise.all([
  importBuilt('api/health.js'),
  importBuilt('api/aircraft.js'),
]);

assert.equal(typeof healthModule.default, 'function', 'health entrypoint should export an Express handler');
assert.equal(typeof aircraftModule.default, 'function', 'aircraft entrypoint should export an Express handler');
const registeredRoutes = (handler) => handler._router.stack
  .filter((layer) => layer.route)
  .map((layer) => layer.route.path);
assert.ok(registeredRoutes(healthModule.default).includes('/api/health'), 'compiled app should register the health route');
assert.ok(registeredRoutes(aircraftModule.default).includes('/api/aircraft'), 'compiled app should register the aircraft route');

console.log('Serverless Node ESM imports and route registration checks passed.');
