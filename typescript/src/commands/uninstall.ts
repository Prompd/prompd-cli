import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

export function createUninstallCommand(): Command {
  const uninstallCommand = new Command('uninstall');

  uninstallCommand
    .description('Uninstall packages')
    .argument('<packages...>', 'Package names to uninstall')
    .option('-g, --global', 'Uninstall packages globally')
    .option('--save-dev', 'Remove from development dependencies')
    .action(async (packages: string[], options) => {
      try {
        for (const packageName of packages) {
          const location = options.global ? 'globally' : 'locally';
          console.log(chalk.dim(`Uninstalling ${packageName} ${location}...`));

          const removed = await uninstallPackage(packageName, options.global);

          if (removed) {
            console.log(chalk.green(`✓ Uninstalled ${packageName}`));
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

async function uninstallPackage(packageName: string, global: boolean): Promise<boolean> {
  const cacheDir = getCacheDir(global);
  const packageDir = path.join(cacheDir, sanitizePackageName(packageName));

  // Check if package exists
  if (!await fs.pathExists(packageDir)) {
    return false;
  }

  // Remove the package directory
  await fs.remove(packageDir);

  return true;
}

function getCacheDir(global: boolean): string {
  const homeDir = os.homedir();

  if (global) {
    return path.join(homeDir, '.prompd', 'cache', 'global');
  }
  return path.join(homeDir, '.prompd', 'cache', 'packages');
}

function sanitizePackageName(name: string): string {
  // Convert @namespace/name to namespace-name for directory
  return name.replace('@', '').replace('/', '-');
}
