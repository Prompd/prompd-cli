import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { PrompdParser } from '../lib/parser';
import { PrompdExecutor } from '../lib/executor';

export function createCompileCommand(): Command {
  const cmd = new Command('compile');
  
  cmd
    .description('Compile a .prompd file with parameters - returns compiled prompt text')
    .argument('<file>', '.prompd file to render')
    .option('-p, --param <key=value>', 'Parameter in format key=value', collectParams, {})
    .option('--param-file <file>', 'JSON parameter file')
    .option('-o, --output <file>', 'Output file path')
    .action(async (file: string, options: any) => {
      try {
        // Parse the .prompd file
        const parser = new PrompdParser();
        const prompd = await parser.parseFile(file);
        
        // Collect parameters from different sources
        let parameters: Record<string, any> = {};
        
        // Load from parameter file if provided
        if (options.paramFile) {
          try {
            const fileContent = readFileSync(resolve(options.paramFile), 'utf8');
            const fileParams = JSON.parse(fileContent);
            parameters = { ...parameters, ...fileParams };
          } catch (error) {
            console.error(`Error loading parameter file: ${error}`);
            process.exit(1);
          }
        }
        
        // Merge command line parameters (CLI takes precedence)
        parameters = { ...parameters, ...options.param };
        
        // Simple parameter validation
        const allParams = [
          ...(prompd.metadata.parameters || []),
          ...(prompd.metadata.variables || [])
        ];
        
        for (const param of allParams) {
          if (param.required && !(param.name in parameters)) {
            console.error(`Required parameter missing: ${param.name}`);
            process.exit(1);
          }
          
          // Apply default values
          if (!(param.name in parameters) && param.default !== undefined) {
            parameters[param.name] = param.default;
          }
        }
        
        // Apply simple template processing (variable substitution)
        let renderedContent = prompd.content;
        for (const [key, value] of Object.entries(parameters)) {
          const placeholder = `{${key}}`;
          renderedContent = renderedContent.replace(new RegExp(placeholder.replace(/[{}]/g, '\\\\$&'), 'g'), String(value));
        }
        
        // Output result
        if (options.output) {
          writeFileSync(resolve(options.output), renderedContent, 'utf8');
          console.log(`✓ Rendered content written to ${options.output}`);
        } else {
          console.log('Rendered Content:');
          console.log('-'.repeat(50));
          console.log(renderedContent);
          console.log('-'.repeat(50));
        }
        
      } catch (error) {
        console.error(`Error rendering file: ${error}`);
        process.exit(1);
      }
    });
  
  return cmd;
}

function collectParams(value: string, previous: Record<string, any>) {
  const [key, val] = value.split('=', 2);
  if (!val) {
    throw new Error(`Invalid parameter format: ${value}. Use key=value format.`);
  }
  return { ...previous, [key]: val };
}
