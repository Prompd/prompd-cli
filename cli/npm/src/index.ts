#!/usr/bin/env node

import { Command } from 'commander';
import { createValidateCommand } from './commands/validate';
import { createListCommand } from './commands/list';
import { createShowCommand } from './commands/show';
import { createExecuteCommand } from './commands/execute';
import { createProviderCommand } from './commands/provider';
import { createVersionCommand } from './commands/version';
import { createMCPCommand } from './commands/mcp';
import { createRegistryCommand } from './commands/registry';

const program = new Command();

program
  .name('prompd')
  .description('CLI for structured prompt definitions')
  .version('0.2.4');

// Add all commands
program.addCommand(createValidateCommand());
program.addCommand(createListCommand());
program.addCommand(createShowCommand());
program.addCommand(createExecuteCommand());
program.addCommand(createProviderCommand());
program.addCommand(createVersionCommand());
program.addCommand(createMCPCommand());
program.addCommand(createRegistryCommand());

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
gitCommand.description('Git operations for .prompd files');

gitCommand
  .command('add')
  .description('Add .prompd files to git staging area')
  .argument('<files...>', '.prompd files to add')
  .option('-v, --verbose', 'Show git output')
  .action(async (files: string[], options) => {
    const { execSync } = await import('child_process');
    const chalk = (await import('chalk')).default;
    
    try {
      for (const file of files) {
        if (!file.endsWith('.prompd')) {
          console.log(chalk.yellow(`Skipping non-.prompd file: ${file}`));
          continue;
        }
        
        execSync(`git add "${file}"`, { stdio: options.verbose ? 'inherit' : 'pipe' });
        console.log(chalk.green(`✓ Added ${file}`));
      }
    } catch (error) {
      console.error(chalk.red('Error adding files:'), error);
      process.exit(1);
    }
  });

gitCommand
  .command('status')
  .description('Show git status for .prompd files')
  .option('-p, --path <path>', 'Check status for specific path')
  .action(async (options) => {
    const { execSync } = await import('child_process');
    const chalk = (await import('chalk')).default;
    
    try {
      const cmd = options.path 
        ? `git status --short "${options.path}"`
        : 'git status --short';
      
      const output = execSync(cmd, { encoding: 'utf-8' });
      
      if (!output.trim()) {
        console.log(chalk.green('No changes to .prompd files'));
        return;
      }
      
      // Filter for .prompd files
      const lines = output.trim().split('\n');
      const prompdChanges = lines.filter(line => line.includes('.prompd'));
      
      if (prompdChanges.length > 0) {
        console.log(chalk.bold('Git status for .prompd files:'));
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
        console.log(chalk.gray('No .prompd file changes'));
      }
      
    } catch (error) {
      const chalk = (await import('chalk')).default;
      console.error(chalk.red('Error checking status:'), error);
      process.exit(1);
    }
  });

gitCommand
  .command('commit')
  .description('Commit staged .prompd files')
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
      execSync(`git commit -m "${options.message}"`, { 
        stdio: options.verbose ? 'inherit' : 'pipe' 
      });
      console.log(chalk.green(`✓ Committed with message: ${options.message}`));
    } catch (error) {
      console.error(chalk.red('Error committing:'), error);
      process.exit(1);
    }
  });

gitCommand
  .command('checkout')
  .description('Checkout a specific version of a .prompd file')
  .argument('<file>', '.prompd file path')
  .argument('<version>', 'Version to checkout (e.g., v1.2.3, HEAD, commit hash)')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (file: string, version: string, options) => {
    const { execSync } = await import('child_process');
    const chalk = (await import('chalk')).default;
    const path = await import('path');
    
    try {
      if (!file.endsWith('.prompd')) {
        console.error(chalk.red(`Error: ${file} is not a .prompd file`));
        process.exit(1);
      }
      
      // Check if version is a semantic version (e.g., v1.2.3 or 1.2.3)
      const semverRegex = /^v?\d+\.\d+\.\d+$/;
      let versionRef = version;
      
      if (semverRegex.test(version)) {
        // Try to use a tag with the file basename
        const basename = path.basename(file, '.prompd');
        const tagName = `${basename}-v${version.replace(/^v/, '')}`;
        
        try {
          // Check if tag exists
          execSync(`git tag -l "${tagName}"`, { encoding: 'utf-8' });
          versionRef = tagName;
          if (options.verbose) {
            console.log(chalk.gray(`Using tag: ${tagName}`));
          }
        } catch {
          // Tag doesn't exist, use version as-is
          if (options.verbose) {
            console.log(chalk.gray(`Tag ${tagName} not found, using ${version}`));
          }
        }
      }
      
      // Get file content at version
      const content = execSync(`git show ${versionRef}:"${file}"`, { 
        encoding: 'utf-8' 
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
  .description('Remove .prompd files from git staging area')
  .argument('<files...>', '.prompd files to unstage')
  .option('-v, --verbose', 'Show git output')
  .action(async (files: string[], options) => {
    const { execSync } = await import('child_process');
    const chalk = (await import('chalk')).default;
    
    try {
      for (const file of files) {
        if (!file.endsWith('.prompd')) {
          console.log(chalk.yellow(`Skipping non-.prompd file: ${file}`));
          continue;
        }
        
        execSync(`git reset HEAD "${file}"`, { stdio: options.verbose ? 'inherit' : 'pipe' });
        console.log(chalk.green(`✓ Removed ${file} from staging area`));
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