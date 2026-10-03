// The extension is not optional: `node e2e/run-android.ts` strips the types but
// keeps the ESM resolver, which does not guess `.ts`. Vitest does guess it, so
// this looks redundant in a test file and is not redundant here.
import { requireOneDevice } from './lib/android.ts';

const serial = requireOneDevice();
console.log(`arnes E2E: dispositivo ${serial}`);