import { Command } from 'commander';
import chalk from 'chalk';
import { PrompdParser } from '../lib/parser';

export function createShowCommand(): Command {
  const command = new Command('show');
  
  command
    .description('Show the structure and parameters of a .prmd file')
    .argument('<file>', 'Path to the .prmd file')
    .action(async (file: string) => {
      try {
        const parser = new PrompdParser();
        const prompd = await parser.parseFile(file);
        const metadata = prompd.metadata;
        
        console.log(chalk.cyan.bold(`=== ${metadata.name || 'Unnamed'} ===`));
        if (metadata.version) {
          console.log(chalk.gray(`Version: ${metadata.version}`));
        }
        
        if (metadata.description) {
          console.log(`\n${chalk.bold('Description:')}\n  ${metadata.description}\n`);
        }
        
        // Merge parameters and variables for backward compatibility
        const allParams = [
          ...(metadata.parameters || []),
          ...(metadata.variables || [])
        ];
        
        if (allParams.length > 0) {
          console.log(chalk.bold('Parameters:'));
          for (const param of allParams) {
            const required = param.required ? chalk.red(' (required)') : '';
            const typeStr = chalk.green(`(${param.type})`);
            console.log(`  • ${chalk.cyan(param.name)} ${typeStr}${required}`);
            
            if (param.description) {
              console.log(chalk.gray(`    ${param.description}`));
            }
            if (param.default !== undefined) {
              const defaultStr = typeof param.default === 'object' 
                ? JSON.stringify(param.default) 
                : String(param.default);
              console.log(chalk.gray(`    Default: ${defaultStr}`));
            }
            if (param.pattern) {
              console.log(chalk.gray(`    Pattern: ${param.pattern}`));
            }
            if (param.minimum !== undefined || param.maximum !== undefined) {
              const range = `${param.minimum ?? '∞'} - ${param.maximum ?? '∞'}`;
              console.log(chalk.gray(`    Range: ${range}`));
            }
          }
        }
        
        // Show content structure
        const contentInfo: string[] = [];
        if (metadata.system) contentInfo.push(`System: ${metadata.system}`);
        if (metadata.context) contentInfo.push(`Context: ${metadata.context}`);
        if (metadata.user) contentInfo.push(`User: ${metadata.user}`);
        if (metadata.response) contentInfo.push(`Response: ${metadata.response}`);
        
        if (contentInfo.length > 0) {
          console.log(`\n${chalk.bold('Content Structure:')}`);
          for (const info of contentInfo) {
            console.log(`  • ${info}`);
          }
        }
        
        // Show sections found in file
        if (Object.keys(prompd.sections).length > 0) {
          console.log(`\n${chalk.bold('Available Sections:')}`);
          for (const sectionName of Object.keys(prompd.sections)) {
            console.log(`  • #${sectionName}`);
          }
        }
        
        if (metadata.requires && metadata.requires.length > 0) {
          console.log(`\n${chalk.bold('Requirements:')} ${metadata.requires.join(', ')}`);
        }
        
      } catch (error) {
        console.error(chalk.red('Error reading file:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
  
  return command;
}