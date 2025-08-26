import { Command } from 'commander';
import chalk from 'chalk';
import { PrompdParser } from '../lib/parser';

export function createValidateCommand(): Command {
  const command = new Command('validate');
  
  command
    .description('Validate a .prompd file syntax and structure')
    .argument('<file>', 'Path to the .prompd file')
    .option('-v, --verbose', 'Show detailed validation results')
    .option('--git', 'Include git history consistency checks')
    .option('--version-only', 'Only validate version-related aspects')
    .action(async (file: string, options) => {
      try {
        const parser = new PrompdParser();
        const issues = await parser.validateFile(file);
        
        if (issues.length === 0) {
          console.log(chalk.green(`✓ ${file} is valid`));
          process.exit(0);
        }
        
        // Group issues by level
        const errors = issues.filter(i => i.level === 'error');
        const warnings = issues.filter(i => i.level === 'warning');
        const info = issues.filter(i => i.level === 'info');
        
        if (errors.length > 0) {
          console.log(chalk.red(`ERRORS (${errors.length}):`));
          for (const issue of errors) {
            console.log(chalk.red(`  - ${issue.message}`));
          }
        }
        
        if (warnings.length > 0) {
          console.log(chalk.yellow(`WARNINGS (${warnings.length}):`));
          for (const issue of warnings) {
            console.log(chalk.yellow(`  - ${issue.message}`));
          }
        }
        
        if (info.length > 0 && options.verbose) {
          console.log(chalk.blue(`INFO (${info.length}):`));
          for (const issue of info) {
            console.log(chalk.blue(`  - ${issue.message}`));
          }
        }
        
        process.exit(errors.length > 0 ? 1 : 0);
        
      } catch (error) {
        console.error(chalk.red('Error validating file:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
  
  return command;
}