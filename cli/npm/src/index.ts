#!/usr/bin/env node

import { Command } from 'commander';
import { spawn } from 'child_process';
import { createValidateCommand } from './commands/validate';
import { createListCommand } from './commands/list';
import { createShowCommand } from './commands/show';
import { createRunCommand } from './commands/execute';
import { createCompileCommand } from './commands/render';
import { createProviderCommand } from './commands/provider';
import { createVersionCommand } from './commands/version';
import { createGitCommand } from './commands/git';
import { createMCPCommand } from './commands/mcp';
import { createRegistryCommand, createLoginCommand, createLogoutCommand, createSearchCommand, createInstallCommand, createPublishCommand } from './commands/registry';
import { createPackageCommand } from './commands/package';

const program = new Command();

program
  .name('prompd')
  .description('CLI for structured prompt definitions')
  .version('0.3.0');

// Add all commands
program.addCommand(createValidateCommand());
program.addCommand(createListCommand());
program.addCommand(createShowCommand());
program.addCommand(createRunCommand());
program.addCommand(createCompileCommand());
program.addCommand(createPackageCommand());
program.addCommand(createProviderCommand());
program.addCommand(createVersionCommand());
program.addCommand(createGitCommand());
program.addCommand(createMCPCommand());
program.addCommand(createRegistryCommand());

// Add top-level multi-registry commands
program.addCommand(createLoginCommand());
program.addCommand(createLogoutCommand());
program.addCommand(createSearchCommand());
program.addCommand(createInstallCommand());
program.addCommand(createPublishCommand());

// Legacy providers command for backward compatibility
program
  .command('providers')
  .description('List available LLM providers and their models (deprecated: use "provider list")')
  .action(async () => {
    console.log('Note: Use "prompd provider list" for more detailed view\n');
    // This would call the provider list command
    const { createProviderCommand } = await import('./commands/provider');
    const providerCmd = createProviderCommand();
    const listCmd = providerCmd.commands.find(cmd => cmd.name() === 'list');
    if (listCmd) {
      await listCmd.parseAsync(['node', 'prompd']);
    }
  });

// Git operations (simplified versions)
const gitCommand = new Command('git');
gitCommand.description('Git operations for .prmd files');

gitCommand
  .command('add')
  .description('Add .prmd files to git staging area')
  .argument('<files...>', '.prmd files to add')
  .option('-v, --verbose', 'Show git output')
  .action(async (files: string[], options) => {
    const { spawn } = await import('child_process');
    const chalk = (await import('chalk')).default;
    const path = await import('path');
    
    try {
      for (const file of files) {
        if (!file.endsWith('.prmd')) {
          console.log(chalk.yellow(`Skipping non-.prmd file: ${file}`));
          continue;
        }
        
        // Sanitize file path and use spawn instead of execSync
        const sanitizedFile = path.normalize(file).replace(/\\/g, '/');
        if (sanitizedFile.includes('..') || sanitizedFile.startsWith('/')) {
          console.error(chalk.red(`Invalid file path: ${file}`));
          continue;
        }
        
        await new Promise((resolve, reject) => {
          const child = spawn('git', ['add', sanitizedFile], {
            stdio: options.verbose ? 'inherit' : 'pipe'
          });
          child.on('close', (code) => {
            if (code === 0) {
              console.log(chalk.green(`✓ Added ${file}`));
              resolve(undefined);
            } else {
              reject(new Error(`git add failed with code ${code}`));
            }
          });
        });
      }
    } catch (error) {
      console.error(chalk.red('Error adding files:'), error);
      process.exit(1);
    }
  });

gitCommand
  .command('status')
  .description('Show git status for .prmd files')
  .option('-p, --path <path>', 'Check status for specific path')
  .action(async (options) => {
    const { execSync } = await import('child_process');
    const chalk = (await import('chalk')).default;
    
    try {
      const { spawn } = await import('child_process');
      const path = await import('path');
      
      let args = ['status', '--short'];
      if (options.path) {
        // Sanitize path input
        const sanitizedPath = path.normalize(options.path).replace(/\\/g, '/');
        if (sanitizedPath.includes('..') || sanitizedPath.startsWith('/')) {
          console.error(chalk.red(`Invalid path: ${options.path}`));
          process.exit(1);
        }
        args.push(sanitizedPath);
      }
      
      const output = await new Promise<string>((resolve, reject) => {
        let stdout = '';
        const child = spawn('git', args, { stdio: 'pipe' });
        child.stdout?.on('data', (data) => stdout += data.toString());
        child.on('close', (code) => {
          if (code === 0) resolve(stdout);
          else reject(new Error(`git status failed with code ${code}`));
        });
      });
      
      if (!output.trim()) {
        console.log(chalk.green('No changes to .prmd files'));
        return;
      }
      
      // Filter for .prmd files
      const lines = output.trim().split('\n');
      const prompdChanges = lines.filter(line => line.includes('.prmd'));
      
      if (prompdChanges.length > 0) {
        console.log(chalk.bold('Git status for .prmd files:'));
        for (const change of prompdChanges) {
          const statusCode = change.substring(0, 2);
          const filePath = change.substring(3);
          
          let statusText = 'Modified';
          let statusColor = 'yellow';
          
          if (statusCode.includes('A')) {
            statusText = 'Added';
            statusColor = 'green';
          } else if (statusCode.includes('D')) {
            statusText = 'Deleted';
            statusColor = 'red';
          } else if (statusCode.includes('??')) {
            statusText = 'Untracked';
            statusColor = 'blue';
          }
          
          const chalkFn = (chalk as any)[statusColor];
          console.log(`  ${chalkFn(statusText.padEnd(10))} ${filePath}`);
        }
      } else {
        console.log(chalk.gray('No .prmd file changes'));
      }
      
    } catch (error) {
      const chalk = (await import('chalk')).default;
      console.error(chalk.red('Error checking status:'), error);
      process.exit(1);
    }
  });

gitCommand
  .command('commit')
  .description('Commit staged .prmd files')
  .option('-m, --message <message>', 'Commit message')
  .option('-v, --verbose', 'Show git output')
  .action(async (options) => {
    const { execSync } = await import('child_process');
    const chalk = (await import('chalk')).default;
    
    if (!options.message) {
      console.error(chalk.red('Error: commit message is required'));
      console.log('Usage: prompd git commit -m "Your commit message"');
      process.exit(1);
    }
    
    try {
      const { spawn } = await import('child_process');
      
      // Validate commit message to prevent injection
      if (options.message.includes('`') || options.message.includes('$') || options.message.includes(';')) {
        console.error(chalk.red('Error: commit message contains invalid characters'));
        process.exit(1);
      }
      
      await new Promise<void>((resolve, reject) => {
        const child = spawn('git', ['commit', '-m', options.message], {
          stdio: options.verbose ? 'inherit' : 'pipe'
        });
        child.on('close', (code) => {
          if (code === 0) {
            console.log(chalk.green(`✓ Committed with message: ${options.message}`));
            resolve();
          } else {
            reject(new Error(`git commit failed with code ${code}`));
          }
        });
      });
    } catch (error) {
      console.error(chalk.red('Error committing:'), error);
      process.exit(1);
    }
  });

gitCommand
  .command('checkout')
  .description('Checkout a specific version of a .prmd file')
  .argument('<file>', '.prmd file path')
  .argument('<version>', 'Version to checkout (e.g., v1.2.3, HEAD, commit hash)')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (file: string, version: string, options) => {
    const { execSync } = await import('child_process');
    const chalk = (await import('chalk')).default;
    const path = await import('path');
    
    try {
      if (!file.endsWith('.prmd')) {
        console.error(chalk.red(`Error: ${file} is not a .prmd file`));
        process.exit(1);
      }
      
      // Check if version is a semantic version (e.g., v1.2.3 or 1.2.3)
      const semverRegex = /^v?\d+\.\d+\.\d+$/;
      let versionRef = version;
      
      if (semverRegex.test(version)) {
        // Try to use a tag with the file basename
        const basename = path.basename(file, '.prmd');
        const tagName = `${basename}-v${version.replace(/^v/, '')}`;
        
        try {
          const { spawn } = await import('child_process');
          // Check if tag exists
          await new Promise<void>((resolve, reject) => {
            const child = spawn('git', ['tag', '-l', tagName], { stdio: 'pipe' });
            child.on('close', (code) => {
              if (code === 0) {
                versionRef = tagName;
                if (options.verbose) {
                  console.log(chalk.gray(`Using tag: ${tagName}`));
                }
                resolve();
              } else {
                if (options.verbose) {
                  console.log(chalk.gray(`Tag ${tagName} not found, using ${version}`));
                }
                resolve();
              }
            });
          });
        } catch {
          // Tag doesn't exist, use version as-is
          if (options.verbose) {
            console.log(chalk.gray(`Tag ${tagName} not found, using ${version}`));
          }
        }
      }
      
      // Sanitize inputs
      const sanitizedFile = path.normalize(file).replace(/\\/g, '/');
      if (sanitizedFile.includes('..') || sanitizedFile.startsWith('/')) {
        console.error(chalk.red(`Invalid file path: ${file}`));
        process.exit(1);
      }
      
      // Validate version reference
      if (!/^[a-zA-Z0-9._-]+$/.test(versionRef)) {
        console.error(chalk.red(`Invalid version reference: ${versionRef}`));
        process.exit(1);
      }
      
      // Get file content at version
      const content = await new Promise<string>((resolve, reject) => {
        let stdout = '';
        const child = spawn('git', ['show', `${versionRef}:${sanitizedFile}`], { stdio: 'pipe' });
        child.stdout?.on('data', (data) => stdout += data);
        child.on('close', (code) => {
          if (code === 0) resolve(stdout);
          else reject(new Error(`git show failed with code ${code}`));
        });
      });
      
      // Write content back to file
      const fs = await import('fs/promises');
      await fs.writeFile(file, content, 'utf-8');
      
      console.log(chalk.green(`✓ Checked out ${file} @ ${version}`));
      
    } catch (error: any) {
      if (error.message?.includes('pathspec')) {
        console.error(chalk.red(`Error: Version '${version}' not found for ${file}`));
      } else {
        console.error(chalk.red('Error checking out file:'), error.message || error);
      }
      process.exit(1);
    }
  });

gitCommand
  .command('remove')
  .description('Remove .prmd files from git staging area')
  .argument('<files...>', '.prmd files to unstage')
  .option('-v, --verbose', 'Show git output')
  .action(async (files: string[], options) => {
    const { spawn } = await import('child_process');
    const chalk = (await import('chalk')).default;
    const path = await import('path');
    
    try {
      for (const file of files) {
        if (!file.endsWith('.prmd')) {
          console.log(chalk.yellow(`Skipping non-.prmd file: ${file}`));
          continue;
        }
        
        // Sanitize file path
        const sanitizedFile = path.normalize(file).replace(/\\/g, '/');
        if (sanitizedFile.includes('..') || sanitizedFile.startsWith('/')) {
          console.error(chalk.red(`Invalid file path: ${file}`));
          continue;
        }
        
        await new Promise<void>((resolve, reject) => {
          const child = spawn('git', ['reset', 'HEAD', sanitizedFile], {
            stdio: options.verbose ? 'inherit' : 'pipe'
          });
          child.on('close', (code) => {
            if (code === 0) {
              console.log(chalk.green(`✓ Removed ${file} from staging area`));
              resolve();
            } else {
              reject(new Error(`git reset failed with code ${code}`));
            }
          });
        });
      }
    } catch (error) {
      console.error(chalk.red('Error removing files from staging:'), error);
      process.exit(1);
    }
  });

program.addCommand(gitCommand);

// Error handling
program.configureOutput({
  outputError: (str, write) => {
    write(str);
  }
});

// Parse arguments
if (require.main === module) {
  program.parseAsync(process.argv).catch((error) => {
    console.error('CLI Error:', error);
    process.exit(1);
  });
}

export default program;
