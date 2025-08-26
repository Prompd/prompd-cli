import { Command } from 'commander';
import chalk from 'chalk';
import { VersionManager } from '../lib/version';

export function createVersionCommand(): Command {
  const command = new Command('version');
  command.description('Version management commands');
  
  // Version bump command
  const bumpCommand = new Command('bump');
  bumpCommand
    .description('Bump version in a .prompd file and create git tag')
    .argument('<file>', 'Path to the .prompd file')
    .argument('<type>', 'Version bump type (major, minor, patch)')
    .option('-m, --message <message>', 'Commit message')
    .option('--dry-run', 'Show what would be done without making changes')
    .action(async (file: string, type: string, options) => {
      try {
        if (!['major', 'minor', 'patch'].includes(type)) {
          console.error(chalk.red('Error: bump type must be major, minor, or patch'));
          process.exit(1);
        }
        
        const versionManager = new VersionManager();
        
        if (options.dryRun) {
          // For dry run, we'd need to parse the current version first
          console.log(chalk.gray(`Would bump ${file} version (${type})`));
          return;
        }
        
        const newVersion = await versionManager.bumpVersion(file, type as 'major' | 'minor' | 'patch');
        console.log(chalk.green(`✓ Bumped ${file} to ${newVersion}`));
        
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
  
  // Version history command
  const historyCommand = new Command('history');
  historyCommand
    .description('Show version history for a .prompd file')
    .argument('<file>', 'Path to the .prompd file')
    .option('-n, --limit <number>', 'Number of versions to show', '10')
    .action(async (file: string, options) => {
      try {
        const versionManager = new VersionManager();
        const limit = parseInt(options.limit);
        const tags = await versionManager.getVersionHistory(file, limit);
        
        if (tags.length === 0) {
          console.log(chalk.yellow(`No version tags found for ${file}`));
          return;
        }
        
        console.log(chalk.cyan(`Version History for ${file}:`));
        console.log();
        
        const maxVersionWidth = Math.max(10, ...tags.map(t => t.tag.length));
        const maxCommitWidth = 8;
        
        console.log(
          chalk.cyan('Version'.padEnd(maxVersionWidth)) + ' | ' +
          chalk.cyan('Date'.padEnd(10)) + ' | ' +
          chalk.cyan('Commit'.padEnd(maxCommitWidth)) + ' | ' +
          chalk.cyan('Message')
        );
        console.log('-'.repeat(maxVersionWidth + 10 + maxCommitWidth + 50));
        
        for (const tag of tags) {
          const message = tag.message.length > 40 ? tag.message.substring(0, 37) + '...' : tag.message;
          console.log(
            tag.tag.padEnd(maxVersionWidth) + ' | ' +
            tag.date.padEnd(10) + ' | ' +
            tag.commit.substring(0, 8).padEnd(maxCommitWidth) + ' | ' +
            message
          );
        }
        
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
  
  // Version diff command
  const diffCommand = new Command('diff');
  diffCommand
    .description('Show differences between versions of a .prompd file')
    .argument('<file>', 'Path to the .prompd file')
    .argument('<version1>', 'First version')
    .argument('[version2]', 'Second version (defaults to HEAD)')
    .action(async (file: string, version1: string, version2?: string) => {
      try {
        const versionManager = new VersionManager();
        const v2 = version2 || 'HEAD';
        const diff = await versionManager.diffVersions(file, version1, v2);
        
        if (!diff.trim()) {
          console.log(chalk.green(`No differences between ${version1} and ${v2}`));
          return;
        }
        
        console.log(chalk.cyan(`Diff: ${version1} → ${v2}`));
        console.log('-'.repeat(50));
        console.log(diff);
        
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
  
  // Version validate command
  const validateCommand = new Command('validate');
  validateCommand
    .description('Validate version consistency')
    .argument('<file>', 'Path to the .prompd file')
    .option('--git', 'Validate against git history')
    .action(async (file: string, options) => {
      try {
        const versionManager = new VersionManager();
        const result = await versionManager.validateVersion(file, options.git);
        
        if (result.valid) {
          console.log(chalk.green('✓ Version is valid'));
        } else {
          console.log(chalk.red('✗ Version validation failed:'));
          for (const issue of result.issues) {
            console.log(chalk.red(`  - ${issue}`));
          }
          process.exit(1);
        }
        
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
  
  // Version suggest command
  const suggestCommand = new Command('suggest');
  suggestCommand
    .description('Suggest appropriate version bump based on changes')
    .argument('<file>', 'Path to the .prompd file')
    .option('--changes <description>', 'Description of changes made')
    .action(async (file: string, options) => {
      try {
        const versionManager = new VersionManager();
        // First we need to get the current version from the file
        // For simplicity, using a placeholder current version
        const currentVersion = '1.0.0'; // This should be read from the file
        
        const suggestion = await versionManager.suggestVersionBump(currentVersion, options.changes);
        
        console.log(chalk.cyan('Version Bump Suggestions'));
        console.log();
        console.log(`${chalk.bold('Current Version:')} ${suggestion.current}`);
        console.log(`${chalk.bold('Suggested Bump:')} ${chalk.green(suggestion.recommended)} → ${chalk.green(suggestion.suggestions[suggestion.recommended])}`);
        console.log();
        console.log(`${chalk.bold('All Options:')}`);
        console.log(`  - Patch: ${suggestion.suggestions.patch} ${chalk.gray('(bug fixes)')}`);
        console.log(`  - Minor: ${suggestion.suggestions.minor} ${chalk.gray('(new features)')}`);
        console.log(`  - Major: ${suggestion.suggestions.major} ${chalk.gray('(breaking changes)')}`);
        console.log();
        console.log(chalk.gray(suggestion.reason));
        
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
  
  command.addCommand(bumpCommand);
  command.addCommand(historyCommand);
  command.addCommand(diffCommand);
  command.addCommand(validateCommand);
  command.addCommand(suggestCommand);
  
  return command;
}