/**
 * Web stub for `expo-sqlite`.
 *
 * Metro is configured to resolve `expo-sqlite` to this file on the web target.
 * The web build uses Web Storage behind the same `LocalStore` interface, so
 * SQLite is never called there — but the real package ships a WebAssembly
 * worker, and bundling it on the web target fails with
 * "Worker chunk not found". Aliasing it away keeps that out of the bundle
 * entirely, instead of trying to patch a worker nobody runs.
 *
 * TypeScript still resolves the real module, so the native implementation is
 * typechecked against the actual typings.
 */

function unavailable(): never {
  throw new Error(
    'expo-sqlite is not available on the web target. The web build stores its cache in Web Storage.',
  );
}

export const openDatabaseAsync = unavailable;
export const openDatabaseSync = unavailable;
export const deleteDatabaseAsync = unavailable;
export const SQLiteProvider = unavailable;
export const useSQLiteContext = unavailable;
export const SQLiteOpenOptions = undefined;
export const defaultDatabaseDirectory = undefined;
