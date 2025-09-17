import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';
import { PrompdParser } from '../lib/parser';

export function createListCommand(): Command {
  const command = new Command('list');
  
  command
    .description('List available .prmd files')
    .option('-p, --path <path>', 'Directory to search for .prmd files', '.')
    .option('-d, --detailed', 'Show detailed information')
    .action(async (options) => {
      try {
        const searchPath = path.resolve(options.path);
        const pattern = path.join(searchPath, '**/*.prmd').replace(/\\/g, '/');
        const files = await glob(pattern);
        
        if (files.length === 0) {
          console.log(`No .prmd files found in ${searchPath}`);
          return;
        }
        
        console.log(chalk.cyan(`Prompd files in ${searchPath}:\n`));
        
        const parser = new PrompdParser();
        
        if (options.detailed) {
          for (const file of files) {
            try {
              const prompd = await parser.parseFile(file);
              const metadata = prompd.metadata;
              
              console.log(chalk.blue('📄 ' + (metadata.name || path.basename(file, '.prmd'))));
              console.log(chalk.gray(`   File: ${file}`));
              if (metadata.description) {
                const desc = metadata.description.length > 60 
                  ? metadata.description.substring(0, 57) + '...' 
                  : metadata.description;
                console.log(chalk.gray(`   Desc: ${desc}`));
              }
              if (metadata.version) {
                console.log(chalk.gray(`   Ver:  ${metadata.version}`));
              }
              if (metadata.parameters && metadata.parameters.length > 0) {
                const paramNames = metadata.parameters.map(p => p.name).join(', ');
                console.log(chalk.gray(`   Params: ${paramNames}`));
              }
              console.log();
            } catch (error) {
              console.log(chalk.red(`❌ ${file} (parse error)`));
              console.log();
            }
          }
        } else {
          // Simple table format
          const maxNameWidth = Math.max(20, ...files.map(f => path.basename(f, '.prmd').length));
          const maxPathWidth = Math.max(25, ...files.map(f => f.length));
          
          console.log(
            chalk.cyan('Name'.padEnd(maxNameWidth)) + ' | ' +
            chalk.cyan('File'.padEnd(maxPathWidth)) + ' | ' +
            chalk.cyan('Description')
          );
          console.log('-'.repeat(maxNameWidth + maxPathWidth + 50));
          
          for (const file of files) {
            try {
              const prompd = await parser.parseFile(file);
              const metadata = prompd.metadata;
              const name = metadata.name || path.basename(file, '.prmd');
              const desc = metadata.description 
                ? (metadata.description.length > 40 ? metadata.description.substring(0, 37) + '...' : metadata.description)
                : '';
              
              console.log(
                name.padEnd(maxNameWidth) + ' | ' +
                file.padEnd(maxPathWidth) + ' | ' +
                desc
              );
            } catch (error) {
              const name = path.basename(file, '.prmd');
              console.log(
                name.padEnd(maxNameWidth) + ' | ' +
                file.padEnd(maxPathWidth) + ' | ' +
                chalk.red('Error reading file')
              );
            }
          }
        }
        
      } catch (error) {
        console.error(chalk.red('Error listing files:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
  
  return command;
}