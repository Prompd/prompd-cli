/**
 * Compile Command
 *
 * Compiles a .prmd file or package reference using the 6-stage compilation pipeline.
 * Supports multiple output formats: markdown, OpenAI JSON, Anthropic JSON.
 */

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrompdCompiler } from '../lib/compiler';

export function createCompileCommand(): Command {
  const cmd = new Command('compile');

  cmd
    .description('Compile a .prmd file or package reference with full template processing')
    .argument('<source>', '.prmd file path or package reference (@namespace/package@version)')
    .option('--to <format>', 'Output format: markdown | provider-json:openai | provider-json:anthropic', 'markdown')
    .option('--to-markdown', 'Shorthand for --to markdown')
    .option('--to-provider-json <provider>', 'Shorthand for --to provider-json:<provider>')
    .option('-p, --param <key=value>', 'Parameter in format key=value', collectParams, {})
    .option('-f, --params-file <file>', 'JSON parameter file')
    .option('-o, --output <file>', 'Output file path')
    .option('-v, --verbose', 'Verbose output with compilation details', false)
    .action(async (source: string, options: any) => {
      try {
        // Collect parameters from different sources
        let parameters: Record<string, any> = {};

        // Load from parameter file if provided
        if (options.paramsFile) {
          try {
            const fileContent = readFileSync(resolve(options.paramsFile), 'utf8');
            const fileParams = JSON.parse(fileContent);
            parameters = { ...parameters, ...fileParams };
          } catch (error) {
            console.error(`Error loading parameter file: ${error}`);
            process.exit(1);
          }
        }

        // Merge command line parameters (CLI takes precedence)
        parameters = { ...parameters, ...options.param };

        // Determine output format
        let outputFormat = options.to;

        if (options.toMarkdown) {
          outputFormat = 'markdown';
        } else if (options.toProviderJson) {
          outputFormat = `provider-json:${options.toProviderJson}`;
        }

        // Create compiler instance
        const compiler = new PrompdCompiler();

        if (options.verbose) {
          console.log(`Compiling: ${source}`);
          console.log(`Output format: ${outputFormat}`);
          console.log(`Parameters: ${Object.keys(parameters).length} parameter(s)`);
          console.log('');
        }

        // Compile with the 6-stage pipeline
        const result = await compiler.compile(source, {
          outputFormat,
          parameters,
          outputFile: options.output,
          verbose: options.verbose
        });

        // Output result (if not written to file)
        if (!options.output) {
          console.log('Compiled Content:');
          console.log('-'.repeat(70));
          console.log(result);
          console.log('-'.repeat(70));
        } else {
          console.log(`✓ Compiled content written to ${options.output}`);
        }
      } catch (error) {
        console.error(`Compilation error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  return cmd;
}

/**
 * Collect parameters from CLI arguments.
 */
function collectParams(value: string, previous: Record<string, any>): Record<string, any> {
  const [key, val] = value.split('=', 2);

  if (!val) {
    throw new Error(`Invalid parameter format: ${value}. Use key=value format.`);
  }

  // Try to parse as JSON for complex values
  let parsedValue: any = val;
  try {
    parsedValue = JSON.parse(val);
  } catch {
    // Not JSON, use as string
    parsedValue = val;
  }

  return { ...previous, [key]: parsedValue };
}
