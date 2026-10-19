const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Find the project and the workspace root
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo so workspace packages can be bundled
config.watchFolders = [monorepoRoot];

// 2. Let Metro resolve packages in both local and workspace root node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// 3. Direct alias for workspace packages
config.resolver.extraNodeModules = {
  '@rota/contracts': path.resolve(monorepoRoot, 'packages/contracts'),
  '@rota/config': path.resolve(monorepoRoot, 'packages/config'),
};

module.exports = config;
