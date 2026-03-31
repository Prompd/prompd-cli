import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { executeWorkflow } from '../lib/workflowExecutor';
import { createToolCallHandler } from '../lib/commandExecutor';
import { ConfigManager } from '../lib/config';
import { parseWorkflow } from '../lib/workflowParser';
import { PrompdExecutor } from '../lib/executor';
import { callLLM } from '../lib/llmClient';

export function createWorkflowCommand(): Command {
  const command = new Command('workflow');

  command.description('Manage and execute workflow files (.pdflow)');

  // Workflow run subcommand
  command
    .command('run')
    .description('Execute a .pdflow workflow file')
    .argument('<file>', 'Path to the .pdflow file')
    .option('-p, --param <param>', 'Parameter in format key=value', (value, previous: Record<string, string>) => {
      const params = previous || {};
      const [key, val] = value.split('=', 2);
      params[key] = val;
      return params;
    }, {} as Record<string, string>)
    .option('-f, --param-file <file>', 'JSON parameter file')
    .option('--timeout <ms>', 'Command execution timeout in milliseconds', '30000')
    .option('--api-key <key>', 'API key override for LLM calls')
    .option('--headless', 'Run in headless mode (no user interaction)')
    .option('--trace', 'Enable execution trace')
    .option('-v, --verbose', 'Verbose output')
    .action(async (file: string, options) => {
      try {
        // Validate file exists and has correct extension
        if (!await fs.pathExists(file)) {
          console.error(chalk.red(`Error: File not found: ${file}`));
          process.exit(1);
        }

        const ext = path.extname(file).toLowerCase();
        if (ext !== '.pdflow') {
          console.error(chalk.red(`Error: Expected .pdflow file, got ${ext}`));
          console.error(chalk.gray(`Hint: Use 'prompd run' for .prmd files`));
          process.exit(1);
        }

        // Read and parse workflow file
        const workflowContent = await fs.readFile(file, 'utf-8');
        const workflow = parseWorkflow(workflowContent);

        // Check for parse errors
        if (workflow.errors.length > 0) {
          console.error(chalk.red('Error: Invalid workflow file'));
          workflow.errors.forEach(err => console.error(chalk.gray(`  - ${err.message}`)));
          process.exit(1);
        }

        // Merge parameters from CLI options and parameter file
        let parameters = options.param || {};
        if (options.paramFile) {
          try {
            const paramFileContent = await fs.readFile(options.paramFile, 'utf-8');
            const fileParams = JSON.parse(paramFileContent);
            parameters = { ...fileParams, ...parameters };
          } catch (paramError) {
            console.error(chalk.red(`Error: Failed to load parameter file: ${options.paramFile}`));
            process.exit(1);
          }
        }

        // Get config for API keys
        const configManager = ConfigManager.getInstance();
        const config = await configManager.loadConfig();

        console.log(chalk.blue('▶ Executing workflow:'), chalk.cyan(path.basename(file)));
        if (Object.keys(parameters).length > 0) {
          console.log(chalk.gray('Parameters:'), JSON.stringify(parameters, null, 2));
        }
        console.log();

        // Create tool call handler for command execution
        const toolCallHandler = createToolCallHandler({
          cwd: path.dirname(path.resolve(file)),
          timeout: parseInt(options.timeout, 10)
        });

        // Create executor for prompt execution
        const prompdExecutor = new PrompdExecutor();
        const defaultProvider = configManager.getDefaultProvider(config);
        const defaultModel = configManager.getDefaultModel(defaultProvider, config);

        // Execute workflow with command execution support
        const result = await executeWorkflow(workflow, parameters, {
          headless: options.headless ?? true,
          trace: options.trace ?? false,
          onToolCall: toolCallHandler,
          executePrompt: async (source: string, params: Record<string, unknown>, provider?: string, model?: string, temperature?: number, maxTokens?: number) => {
            // Handle both .prmd files and raw prompt text
            let tempFilePath: string | null = null;
            try {
              // Check if source is a file path (.prmd extension)
              if (source.endsWith('.prmd') && await fs.pathExists(source)) {
                // Execute .prmd file
                const result = await prompdExecutor.execute(source, {
                  provider: provider || defaultProvider,
                  model: model || defaultModel,
                  params: params,
                  ...(temperature !== undefined && { temperature }),
                  ...(maxTokens !== undefined && { maxTokens })
                });
                return result.response || result.content || '';
              } else if (source.startsWith('raw:')) {
                // Raw inline prompt - needs compilation for parameter substitution
                const rawText = source.substring(4);
                const uniqueId = `raw-prompt-${Date.now()}`;
                const promptContent = [
                  '---',
                  `id: ${uniqueId}`,
                  'name: "Raw Prompt"',
                  'version: 0.0.1',
                  'description: "Inline raw prompt from workflow"',
                  '---',
                  '',
                  rawText
                ].join('\n');

                // Write to temp file
                const os = await import('os');
                tempFilePath = path.join(os.tmpdir(), `${uniqueId}.prmd`);
                await fs.writeFile(tempFilePath, promptContent, 'utf-8');

                // Execute through CLI (with compilation for parameter substitution)
                const result = await prompdExecutor.execute(tempFilePath, {
                  provider: provider || defaultProvider,
                  model: model || defaultModel,
                  params: params,
                  ...(temperature !== undefined && { temperature }),
                  ...(maxTokens !== undefined && { maxTokens })
                });

                // Clean up temp file
                await fs.unlink(tempFilePath).catch(() => {});
                tempFilePath = null;

                return result.response || result.content || '';
              } else {
                // Assume it's .prmd content - write to temp file for compilation
                const uniqueId = `inline-prompt-${Date.now()}`;
                const os = await import('os');
                tempFilePath = path.join(os.tmpdir(), `${uniqueId}.prmd`);
                await fs.writeFile(tempFilePath, source, 'utf-8');

                // Execute through CLI (with compilation for parameter substitution)
                const result = await prompdExecutor.execute(tempFilePath, {
                  provider: provider || defaultProvider,
                  model: model || defaultModel,
                  params: params,
                  ...(temperature !== undefined && { temperature }),
                  ...(maxTokens !== undefined && { maxTokens })
                });

                // Clean up temp file
                await fs.unlink(tempFilePath).catch(() => {});
                tempFilePath = null;

                return result.response || result.content || '';
              }
            } catch (error) {
              // Clean up temp file on error
              if (tempFilePath) {
                await fs.unlink(tempFilePath).catch(() => {});
              }
              console.error(chalk.red('Error executing prompt:'), error instanceof Error ? error.message : error);
              throw error;
            }
          },
          onPromptExecute: async (request) => {
            // Handle agent/chat-agent node LLM calls with conversation history
            try {
              const selectedProvider = request.provider || defaultProvider;
              const selectedModel = request.model || defaultModel;
              // Priority: CLI params → Env vars → Config file
              const apiKey = options.apiKey || configManager.getApiKey(selectedProvider, config);

              if (!apiKey) {
                return {
                  success: false,
                  error: `No API key configured for provider: ${selectedProvider}`
                };
              }

              // Get provider-specific config (custom endpoints, timeouts, etc.)
              const providerConfig = configManager.getProviderConfig(selectedProvider, config);

              const result = await callLLM({
                provider: selectedProvider,
                model: selectedModel,
                apiKey,
                systemPrompt: request.prompt,
                messages: request.messages,
                providerConfig
              });

              return result;
            } catch (error) {
              return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
              };
            }
          },
          onCheckpoint: options.verbose ? async (event: any) => {
            console.log(chalk.gray(`[${event.type}]`), JSON.stringify(event.data));
            return true; // Continue execution
          } : undefined
        });

        // Display results
        console.log();
        if (result.success) {
          console.log(chalk.green('✓ Workflow completed successfully'));
          if (result.output) {
            console.log();
            console.log(chalk.cyan('Output:'));
            console.log('-'.repeat(50));
            console.log(result.output);
            console.log('-'.repeat(50));
          }
        } else if (!result.success) {
          console.error(chalk.red('✗ Workflow execution failed'));
          if (result.errors && result.errors.length > 0) {
            console.error();
            console.error(chalk.red('Errors:'));
            result.errors.forEach(err => console.error(`  - ${err.message}`));
          }
          process.exit(1);
        }

        // Show trace if requested
        if (options.trace && result.trace) {
          console.log();
          console.log(chalk.gray('Execution Trace:'));
          console.log(chalk.gray('-'.repeat(50)));
          for (const entry of result.trace.entries) {
            const timestamp = new Date(entry.timestamp).toISOString();
            console.log(chalk.gray(`[${timestamp}] ${entry.nodeId}: ${entry.type}`));
            if (options.verbose && entry.data) {
              console.log(chalk.gray(JSON.stringify(entry.data, null, 2)));
            }
          }
        }

      } catch (error) {
        console.error(chalk.red('Error executing workflow:'), error instanceof Error ? error.message : error);
        if (options.verbose && error instanceof Error && error.stack) {
          console.error(chalk.gray(error.stack));
        }
        process.exit(1);
      }
    });

  // Workflow validate subcommand (placeholder for future)
  command
    .command('validate')
    .description('Validate a .pdflow workflow file')
    .argument('<file>', 'Path to the .pdflow file')
    .action(async (file: string) => {
      console.log(chalk.yellow('Workflow validation is not yet implemented'));
      console.log(chalk.gray('Coming soon: Comprehensive workflow validation'));
    });

  return command;
}
