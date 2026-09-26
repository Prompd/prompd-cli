/**
 * Shared Prompd types and constants.
 *
 * Single source of truth now lives in @prompd/core; re-exported here so the many
 * `../types` / `../../types` imports across the CLI keep working unchanged.
 *
 * resolveToolDeployDir() stays here because it is Node-only (os.homedir()) and
 * must not live in the browser-safe core.
 */
export * from '@prompd/core';

import { TOOL_DEPLOY_DIRS } from '@prompd/core';

/** Strict regex for tool names: lowercase alphanumeric and hyphens only */
const TOOL_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Resolve a tool deploy directory to an absolute path.
 * Expands ~ to the user's home directory.
 * Validates toolName against strict regex to prevent path injection.
 */
export function resolveToolDeployDir(toolName: string): string | undefined {
  if (!TOOL_NAME_REGEX.test(toolName)) return undefined;
  const dir = TOOL_DEPLOY_DIRS[toolName];
  if (!dir) return undefined;
  const os = require('os');
  return dir.replace(/^~/, os.homedir());
}
