import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { PrompdParser } from '../lib/parser';
import { RegistryClient } from '../lib/registry';

export function createExplainCommand(): Command {
  const explainCommand = new Command('explain');

  explainCommand
    .description('Detailed information about files and packages')
    .argument('<target>', '.prmd file, .pdpkg package, or registry package (@namespace/name)')
    .option('-d, --detailed', 'Show detailed information')
    .option('-s, --sections', 'Show section content previews (for .prmd files)')
    .option('-h, --history', 'Show git version history (for .prmd files)')
    .option('-r, --registry <name>', 'Specify registry for package lookup')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (target: string, options) => {
      try {
        // Determine target type
        if (target.endsWith('.prmd')) {
          await explainPrompdFile(target, options);
        } else if (target.endsWith('.pdpkg')) {
          await explainPackageFile(target, options);
        } else if (target.startsWith('@') && target.includes('/')) {
          await explainRegistryPackage(target, options);
        } else {
          console.error(chalk.red('Invalid target. Must be a .prmd file, .pdpkg package, or registry package (@namespace/name)'));
          process.exit(1);
        }
      } catch (error) {
        console.error(chalk.red(`Explain failed: ${error}`));
        if (options.verbose) {
          console.error(error);
        }
        process.exit(1);
      }
    });

  return explainCommand;
}

async function explainPrompdFile(filePath: string, options: any) {
  if (!await fs.pathExists(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const parser = new PrompdParser();
  const prompd = await parser.parseFile(filePath);
  const stats = await fs.stat(filePath);

  console.log(chalk.bold(`\n📄 ${path.basename(filePath)}`));
  console.log(chalk.dim(`   ${path.resolve(filePath)}`));
  console.log();

  // Basic metadata
  console.log(chalk.bold('Metadata:'));
  console.log(`  ID:          ${chalk.cyan(prompd.metadata.id)}`);
  if (prompd.metadata.name) {
    console.log(`  Name:        ${prompd.metadata.name}`);
  }
  if (prompd.metadata.version) {
    console.log(`  Version:     ${prompd.metadata.version}`);
  }
  if (prompd.metadata.description) {
    console.log(`  Description: ${prompd.metadata.description}`);
  }
  console.log();

  // Parameters
  const params = prompd.metadata.parameters || [];
  if (params.length > 0) {
    console.log(chalk.bold('Parameters:'));
    params.forEach(param => {
      const required = param.required ? chalk.red('required') : chalk.dim('optional');
      const defaultVal = param.default !== undefined ? chalk.dim(` (default: ${JSON.stringify(param.default)})`) : '';
      console.log(`  • ${chalk.cyan(param.name)} (${param.type}) ${required}${defaultVal}`);
      if (param.description) {
        console.log(`    ${chalk.dim(param.description)}`);
      }
    });
    console.log();
  }

  // Sections
  if (options.sections && Object.keys(prompd.sections).length > 0) {
    console.log(chalk.bold('Sections:'));
    Object.keys(prompd.sections).forEach(section => {
      console.log(`  • ${chalk.cyan(section)}`);
    });
    console.log();
  }

  // File stats
  console.log(chalk.bold('File Info:'));
  console.log(`  Size:     ${chalk.cyan(formatBytes(stats.size))}`);
  console.log(`  Modified: ${chalk.dim(stats.mtime.toLocaleString())}`);
  console.log();

  // Git history (if requested)
  if (options.history) {
    try {
      const { spawn } = await import('child_process');
      const gitLog = await new Promise<string>((resolve, reject) => {
        const child = spawn('git', ['log', '--oneline', '-5', filePath]);
        let output = '';
        child.stdout.on('data', (data) => output += data.toString());
        child.on('close', (code) => {
          if (code === 0) resolve(output);
          else reject(new Error('Git log failed'));
        });
      });

      if (gitLog.trim()) {
        console.log(chalk.bold('Recent Git History:'));
        gitLog.trim().split('\n').forEach(line => {
          console.log(`  ${chalk.dim(line)}`);
        });
        console.log();
      }
    } catch (error) {
      console.log(chalk.yellow('Git history not available'));
      console.log();
    }
  }
}

async function explainPackageFile(filePath: string, options: any) {
  if (!await fs.pathExists(filePath)) {
    throw new Error(`Package not found: ${filePath}`);
  }

  const stats = await fs.stat(filePath);

  console.log(chalk.bold(`\n📦 ${path.basename(filePath)}`));
  console.log(chalk.dim(`   ${path.resolve(filePath)}`));
  console.log();

  console.log(chalk.bold('Package Info:'));
  console.log(`  Size: ${chalk.cyan(formatBytes(stats.size))}`);
  console.log(`  Modified: ${chalk.dim(stats.mtime.toLocaleString())}`);
  console.log();

  if (options.detailed) {
    console.log(chalk.yellow('Use "prompd package validate" for detailed package inspection'));
    console.log();
  }
}

async function explainRegistryPackage(packageName: string, options: any) {
  const client = new RegistryClient(options.registry);

  console.log(chalk.dim(`Fetching package info for ${packageName}...`));
  console.log();

  const info = await client.getPackageInfo(packageName);
  const versions = await client.getPackageVersions(packageName);

  console.log(chalk.bold(`\n📦 ${packageName}`));
  console.log();

  if (info.description) {
    console.log(info.description);
    console.log();
  }

  console.log(chalk.bold('Package Info:'));
  console.log(`  Name:    ${chalk.cyan(info.name)}`);
  if (info.version) {
    console.log(`  Version: ${chalk.cyan(info.version)}`);
  }
  console.log();

  if (versions && versions.length > 0) {
    console.log(chalk.bold('Available Versions:'));
    const sortedVersions = versions.sort((a: string, b: string) => {
      return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
    });
    const displayVersions = options.detailed ? sortedVersions : sortedVersions.slice(0, 5);
    displayVersions.forEach((version: string, index: number) => {
      const isLatest = index === 0;
      const marker = isLatest ? chalk.green(' (latest)') : '';
      console.log(`  • ${chalk.cyan(version)}${marker}`);
    });
    if (!options.detailed && sortedVersions.length > 5) {
      console.log(`  ${chalk.dim(`... and ${sortedVersions.length - 5} more (use --detailed to see all)`)}`);
    }
    console.log();
  }

  if (info.author) {
    console.log(chalk.bold('Author:'));
    console.log(`  ${info.author}`);
    console.log();
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
