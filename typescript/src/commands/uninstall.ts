import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { PACKAGE_TYPE_DIRS, resolveToolDeployDir, TOOL_DEPLOY_DIRS } from '../types';

export function createUninstallCommand(): Command {
  const uninstallCommand = new Command('uninstall');

  uninstallCommand
    .description('Uninstall packages')
    .argument('<packages...>', 'Package names to uninstall')
    .option('-g, --global', 'Uninstall packages globally')
    .action(async (packages: string[], options) => {
      try {
        for (const packageName of packages) {
          const location = options.global ? 'globally' : 'locally';
          console.log(chalk.dim(`Uninstalling ${packageName} ${location}...`));

          const removed = await uninstallPackage(packageName, options.global);

          if (removed) {
            console.log(chalk.green(`Uninstalled ${packageName}`));
          } else {
            console.log(chalk.yellow(`Package ${packageName} not found`));
          }
        }
      } catch (error) {
        console.error(chalk.red(`Uninstall failed: ${error}`));
        process.exit(1);
      }
    });

  return uninstallCommand;
}

/**
 * Uninstall a package by searching across all type directories.
 * Also cleans up tool deployments if the package was a skill deployed to a tool.
 */
async function uninstallPackage(packageName: string, global: boolean): Promise<boolean> {
  const baseDir = global
    ? path.join(os.homedir(), '.prompd')
    : path.join(process.cwd(), '.prompd');

  let removed = false;

  // Search across all type directories (packages/, workflows/, skills/, templates/)
  for (const typeDir of Object.values(PACKAGE_TYPE_DIRS)) {
    const packageDir = path.join(baseDir, typeDir, packageName);

    if (await fs.pathExists(packageDir)) {
      // Before removing, check if this was a skill with tool deployments
      if (typeDir === 'skills') {
        await cleanupToolDeployments(packageName);
      }

      await fs.remove(packageDir);
      removed = true;
    }
  }

  // Also check legacy cache directory for backward compatibility
  const legacyCacheDir = path.join(baseDir, 'cache');
  const legacyPackageDir = path.join(legacyCacheDir, packageName);
  if (await fs.pathExists(legacyPackageDir)) {
    await fs.remove(legacyPackageDir);
    removed = true;
  }

  // Also check legacy global cache structure
  if (global) {
    const legacyGlobalDir = path.join(baseDir, 'cache', 'global', 'packages', packageName);
    if (await fs.pathExists(legacyGlobalDir)) {
      await fs.remove(legacyGlobalDir);
      removed = true;
    }
  }

  return removed;
}

/**
 * Clean up tool-native deployments for a skill package.
 * Checks each known tool's skill directory for a deployment marker (.prompd-source).
 */
async function cleanupToolDeployments(packageName: string): Promise<void> {
  for (const toolName of Object.keys(TOOL_DEPLOY_DIRS)) {
    const deployDir = resolveToolDeployDir(toolName);
    if (!deployDir) continue;

    const skillDeployDir = path.join(deployDir, packageName);
    const markerPath = path.join(skillDeployDir, '.prompd-source');

    // Only remove if the .prompd-source marker exists (confirms prompd deployed it)
    if (await fs.pathExists(markerPath)) {
      await fs.remove(skillDeployDir);
      console.log(chalk.dim(`  Cleaned up ${toolName} deployment: ${skillDeployDir}`));
    }
  }
}
