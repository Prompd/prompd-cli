import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

export function createCacheCommand(): Command {
  const cacheCommand = new Command('cache');

  cacheCommand
    .description('Package cache management');

  // List cached packages
  const listCommand = new Command('list');
  listCommand
    .description('List cached packages')
    .action(async () => {
      try {
        const cacheDir = getCacheDirectory();
        const packages = await listCachedPackages(cacheDir);

        if (packages.length === 0) {
          console.log(chalk.yellow('No cached packages found.'));
          return;
        }

        console.log(chalk.bold(`\nCached Packages (${packages.length} total):\n`));

        packages.forEach((pkg, index) => {
          console.log(`${chalk.cyan(`${index + 1}.`)} ${chalk.bold(pkg.name)}@${chalk.green(pkg.version)}`);
          if (pkg.description) {
            console.log(`   ${chalk.dim(pkg.description)}`);
          }
          console.log(`   ${chalk.dim(`Path: ${pkg.path}`)}`);
          console.log();
        });

      } catch (error) {
        console.error(chalk.red(`Failed to list cache: ${error}`));
        process.exit(1);
      }
    });

  // Clear cache
  const clearCommand = new Command('clear');
  clearCommand
    .description('Clear the package cache')
    .action(async () => {
      try {
        const cacheDir = getCacheDirectory();

        if (!await fs.pathExists(cacheDir)) {
          console.log(chalk.yellow('Cache is already empty.'));
          return;
        }

        console.log(chalk.dim('Clearing package cache...'));

        // Remove cache directory
        await fs.remove(cacheDir);

        // Recreate empty cache directory
        await fs.ensureDir(cacheDir);

        console.log(chalk.green('✓ Package cache cleared successfully.'));

      } catch (error) {
        console.error(chalk.red(`Failed to clear cache: ${error}`));
        process.exit(1);
      }
    });

  // Cache info
  const infoCommand = new Command('info');
  infoCommand
    .description('Show cache information')
    .action(async () => {
      try {
        const cacheDir = getCacheDirectory();
        const packages = await listCachedPackages(cacheDir);

        console.log(chalk.bold('\nPackage Cache Information\n'));
        console.log(`${chalk.bold('Cache Directory:')} ${chalk.cyan(cacheDir)}`);
        console.log(`${chalk.bold('Cached Packages:')} ${chalk.cyan(packages.length.toString())}`);

        if (await fs.pathExists(cacheDir)) {
          const stats = await getCacheStats(cacheDir);
          console.log(`${chalk.bold('Cache Size:')} ${chalk.cyan(formatBytes(stats.totalSize))}`);
          console.log(`${chalk.bold('Total Files:')} ${chalk.cyan(stats.fileCount.toString())}`);
        }

        console.log();

      } catch (error) {
        console.error(chalk.red(`Failed to get cache info: ${error}`));
        process.exit(1);
      }
    });

  cacheCommand.addCommand(listCommand);
  cacheCommand.addCommand(clearCommand);
  cacheCommand.addCommand(infoCommand);

  return cacheCommand;
}

// Helper functions

function getCacheDirectory(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.prompd', 'cache', 'packages');
}

interface CachedPackage {
  name: string;
  version: string;
  description?: string;
  path: string;
}

async function listCachedPackages(cacheDir: string): Promise<CachedPackage[]> {
  if (!await fs.pathExists(cacheDir)) {
    return [];
  }

  const packages: CachedPackage[] = [];

  try {
    const entries = await fs.readdir(cacheDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const packagePath = path.join(cacheDir, entry.name);
        const manifestPath = path.join(packagePath, 'manifest.json');

        if (await fs.pathExists(manifestPath)) {
          try {
            const manifest = await fs.readJson(manifestPath);
            packages.push({
              name: manifest.name || 'unknown',
              version: manifest.version || 'unknown',
              description: manifest.description,
              path: packagePath
            });
          } catch (error) {
            // Skip invalid manifest files
            console.warn(chalk.yellow(`Warning: Invalid manifest in ${entry.name}`));
          }
        }
      }
    }
  } catch (error) {
    throw new Error(`Failed to read cache directory: ${error}`);
  }

  return packages;
}

interface CacheStats {
  totalSize: number;
  fileCount: number;
}

async function getCacheStats(cacheDir: string): Promise<CacheStats> {
  let totalSize = 0;
  let fileCount = 0;

  async function calculateSize(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await calculateSize(fullPath);
      } else {
        const stats = await fs.stat(fullPath);
        totalSize += stats.size;
        fileCount++;
      }
    }
  }

  try {
    await calculateSize(cacheDir);
  } catch (error) {
    // Ignore errors, return what we have
  }

  return { totalSize, fileCount };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
