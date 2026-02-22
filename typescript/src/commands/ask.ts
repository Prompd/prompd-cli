import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import { PrompdExecutor } from '../lib/executor';
import { ConfigManager } from '../lib/config';

export function createAskCommand(): Command {
  const command = new Command('ask');

  command
    .description('Send raw text to an LLM through the Prompd compilation pipeline')
    .argument('<prompt>', 'Raw prompt text to send to the LLM')
    .option('--provider <provider>', 'LLM provider (openai, anthropic, google, etc.)')
    .option('--model <model>', 'Model name')
    .option('--api-key <key>', 'API key override')
    .option('-o, --output <file>', 'Write response to a file')
    .option('--format <format>', 'Output format (text, json)', 'text')
    .option('-v, --verbose', 'Verbose output')
    .option('-u, --show-usage', 'Show token usage statistics')
    .action(async (prompt: string, options) => {
      try {
        if (options.format && !['text', 'json'].includes(options.format)) {
          console.error(chalk.red('Error: format must be "text" or "json"'));
          process.exit(1);
        }

        const configManager = ConfigManager.getInstance();
        const config = await configManager.loadConfig();
        const provider = options.provider || configManager.getDefaultProvider(config);
        const model = options.model || configManager.getDefaultModel(provider, config);

        if (options.verbose) {
          console.log(chalk.gray(`Provider: ${provider}, Model: ${model}`));
          console.log(chalk.gray(`Prompt: ${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}`));
          console.log();
        }

        const executor = new PrompdExecutor();
        const response = await executor.executeRawText(prompt, {
          provider,
          model,
          apiKey: options.apiKey,
          verbose: options.verbose
        });

        const responseText = response.response || response.content || 'No response received';

        if (options.format === 'json') {
          const result: Record<string, unknown> = {
            response: responseText,
            provider,
            model,
            prompt: prompt.substring(0, 200)
          };
          if (response.usage) result.usage = response.usage;
          const jsonOutput = JSON.stringify(result, null, 2);

          if (options.output) {
            await fs.writeFile(options.output, jsonOutput, 'utf-8');
            console.log(chalk.green(`Response written to ${options.output}`));
          } else {
            console.log(jsonOutput);
          }
        } else {
          if (options.output) {
            await fs.writeFile(options.output, responseText, 'utf-8');
            console.log(chalk.green(`Response written to ${options.output}`));
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
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return command;
}
