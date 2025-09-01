import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { PrompdExecutor } from '../lib/executor';
import { ConfigManager } from '../lib/config';

export function createRunCommand(): Command {
  const command = new Command('run');
  
  command
    .description('Run a .prompd file with an LLM provider')
    .argument('<file>', 'Path to the .prompd file')
    .option('--provider <provider>', 'LLM provider (openai, anthropic, ollama)')
    .option('--model <model>', 'Model name')
    .option('-p, --param <param>', 'Parameter in format key=value', (value, previous: Record<string, string>) => {
      const params = previous || {};
      const [key, val] = value.split('=', 2);
      params[key] = val;
      return params;
    }, {} as Record<string, string>)
    .option('-f, --param-file <file>', 'JSON parameter file', (value: string, previous: string[]) => {
      return (previous || []).concat([value]);
    }, [] as string[])
    .option('--api-key <key>', 'API key override')
    .option('-o, --output <file>', 'Output file path')
    .option('--format <format>', 'Output format (text, json)', 'text')
    .option('--version <version>', 'Execute a specific version (e.g., "1.2.3", "HEAD", commit hash)')
    .option('--meta-system <text>', 'Override system section (text or file path like ./file.txt)')
    .option('--meta-context <text>', 'Override context section (text or file path like ./file.txt)')
    .option('--meta-user <text>', 'Override user section (text or file path like ./file.txt)')
    .option('-v, --verbose', 'Verbose output')
    .option('--show-usage', 'Show token usage statistics')
    .action(async (file: string, options) => {
      try {
        const executor = new PrompdExecutor();
        const configManager = ConfigManager.getInstance();
        const config = await configManager.loadConfig();
        
        // Use config defaults if not specified
        const provider = options.provider || configManager.getDefaultProvider(config);
        const model = options.model || configManager.getDefaultModel(provider, config);
        
        // Validate format option
        if (options.format && !['text', 'json'].includes(options.format)) {
          console.error(chalk.red('Error: format must be "text" or "json"'));
          process.exit(1);
        }

        // Support meta alias flags with colon syntax: --meta:system|context|user
        const argv = process.argv;
        const aliasMeta: Record<string, string | undefined> = {};
        for (let i = 0; i < argv.length; i++) {
          const a = argv[i];
          if (a === '--meta:system' && i + 1 < argv.length) aliasMeta.metaSystem = argv[i + 1];
          if (a === '--meta:context' && i + 1 < argv.length) aliasMeta.metaContext = argv[i + 1];
          if (a === '--meta:user' && i + 1 < argv.length) aliasMeta.metaUser = argv[i + 1];
        }

        const executeOptions = {
          provider,
          model,
          apiKey: options.apiKey,
          output: options.output,
          format: options.format,
          params: options.param,
          paramFiles: options.paramFile,
          version: options.version,
          metaSystem: aliasMeta.metaSystem || options['metaSystem'],
          metaContext: aliasMeta.metaContext || options['metaContext'],
          metaUser: aliasMeta.metaUser || options['metaUser'],
          verbose: options.verbose
        };
        
        const response = await executor.execute(file, executeOptions);
        
        // Output result based on format
        const responseText = response.response || response.content || 'No response received';
        
        if (options.format === 'json') {
          // JSON output format
          const result: any = {
            response: responseText,
            provider,
            model,
            file: path.resolve(file)
          };
          
          if (response.usage) {
            result.usage = response.usage;
          }
          
          const jsonOutput = JSON.stringify(result, null, 2);
          
          if (options.output) {
            await fs.writeFile(options.output, jsonOutput, 'utf-8');
            console.log(chalk.green(`✓ JSON response written to ${options.output}`));
          } else {
            console.log(jsonOutput);
          }
        } else {
          // Text output format (default)
          if (options.output) {
            await fs.writeFile(options.output, responseText, 'utf-8');
            console.log(chalk.green(`✓ Response written to ${options.output}`));
          } else {
            console.log('\n' + chalk.cyan('Response:'));
            console.log('-'.repeat(50));
            console.log(responseText);
            console.log('-'.repeat(50));
          }
          
          if ((options.verbose || options.showUsage) && response.usage) {
            console.log(chalk.gray(`\nUsage: ${response.usage.promptTokens} prompt + ${response.usage.completionTokens} completion = ${response.usage.totalTokens} total tokens`));
          }
        }
        
      } catch (error) {
        console.error(chalk.red('Error executing file:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
  
  return command;
}
