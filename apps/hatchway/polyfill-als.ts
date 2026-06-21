// Next 16's server modules read `globalThis.AsyncLocalStorage` and throw
// "Invariant: AsyncLocalStorage accessed in runtime where it is not available"
// if it is unset. `next start` polyfills this from node:async_hooks during its
// bootstrap, but our custom server (run via `tsx server.ts`) does not — so Next
// modules crash the moment they load. Importing this module FIRST (before any
// Next import) installs the polyfill in time.
import { AsyncLocalStorage } from 'node:async_hooks';

const g = globalThis as unknown as { AsyncLocalStorage?: typeof AsyncLocalStorage };
g.AsyncLocalStorage ??= AsyncLocalStorage;
