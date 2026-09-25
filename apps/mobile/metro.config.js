const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the whole monorepo so shared packages hot reload with the app.
config.watchFolders = [workspaceRoot];

// Resolve dependencies from the app first, then from the hoisted workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

/**
 * The web target keeps its local cache in Web Storage, never in SQLite.
 *
 * The real package ships a WebAssembly worker that Metro cannot emit as a web
 * chunk, so it is replaced by a stub on web instead of being bundled and never
 * called. Native keeps the real module, typechecked against its typings.
 */
const sqliteStub = path.resolve(projectRoot, 'src/lib/offline/expo-sqlite.web-stub.ts');
const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && (moduleName === 'expo-sqlite' || moduleName.startsWith('expo-sqlite/'))) {
    return { type: 'sourceFile', filePath: sqliteStub };
  }

  if (platform === 'web' && (moduleName === 'wa-sqlite' || moduleName.startsWith('wa-sqlite/'))) {
    return { type: 'empty' };
  }

  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
