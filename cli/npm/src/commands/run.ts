import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { PrompdExecutor } from '../lib/executor';
import { ConfigManager } from '../lib/config';
import { executeWorkflow } from '../lib/workflowExecutor';
import { createToolCallHandler } from '../lib/commandExecutor';
import { parseWorkflow } from '../lib/workflowParser';
import { callLLM } from '../lib/llmClient';

export function createRunCommand(): Command {
  const command = new Command('run');

  command
    .description('Run a .prmd or .pdflow file')
    .argument('<file>', 'Path to the .prmd or .pdflow file')
    .option('--provider <provider>', 'LLM provider (openai, anthropic, ollama) - for .prmd files')
    .option('--model <model>', 'Model name - for .prmd files')
    .option('-p, --param <param>', 'Parameter in format key=value', (value, previous: Record<string, string>) => {
      const params = previous || {};
      const [key, val] = value.split('=', 2);
      params[key] = val;
      return params;
    }, {} as Record<string, string>)
    .option('-f, --param-file <file>', 'JSON parameter file', (value: string, previous: string[]) => {
      return (previous || []).concat([value]);
    }, [] as string[])
    .option('--api-key <key>', 'API key override - for .prmd files')
    .option('-o, --output <file>', 'Output file path')
    .option('--format <format>', 'Output format (text, json)', 'text')
    .option('--version <version>', 'Execute a specific version (e.g., "1.2.3", "HEAD", commit hash)')
    .option('--meta-system <text>', 'Override system section (text or file path like ./file.txt) - for .prmd files')
    .option('--meta-context <text>', 'Override context section (text or file path like ./file.txt) - for .prmd files')
    .option('--meta-user <text>', 'Override user section (text or file path like ./file.txt) - for .prmd files')
    .option('-v, --verbose', 'Verbose output')
    .option('--show-usage', 'Show token usage statistics - for .prmd files')
    .option('--headless', 'Run in headless mode (no user interaction) - for .pdflow files')
    .option('--trace', 'Enable execution trace - for .pdflow files')
    .option('--timeout <ms>', 'Command execution timeout in milliseconds - for .pdflow files', '30000')
    .action(async (file: string, options) => {
      try {
        // Check file extension to determine execution path
        const ext = path.extname(file).toLowerCase();

        // Forward .pdflow files to workflow execution
        if (ext === '.pdflow') {
          console.log(chalk.blue('ℹ Detected workflow file, forwarding to workflow executor...'));
          console.log();
          return await executeWorkflowFile(file, options);
        }

        // Continue with .prmd execution
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

/**
 * Execute a .pdflow workflow file (forwarded from 'prompd run')
 */
async function executeWorkflowFile(file: string, options: any): Promise<void> {
  // Validate file exists
  if (!await fs.pathExists(file)) {
    console.error(chalk.red(`Error: File not found: ${file}`));
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
  if (options.paramFile && options.paramFile.length > 0) {
    for (const paramFile of options.paramFile) {
      try {
        const paramFileContent = await fs.readFile(paramFile, 'utf-8');
        const fileParams = JSON.parse(paramFileContent);
        parameters = { ...fileParams, ...parameters };
      } catch (paramError) {
        console.error(chalk.red(`Error: Failed to load parameter file: ${paramFile}`));
        process.exit(1);
      }
    }
  }

  console.log(chalk.blue('▶ Executing workflow:'), chalk.cyan(path.basename(file)));
  if (Object.keys(parameters).length > 0) {
    console.log(chalk.gray('Parameters:'), JSON.stringify(parameters, null, 2));
  }
  console.log();

  // Get config for API keys
  const configManager = ConfigManager.getInstance();
  const config = await configManager.loadConfig();

  // Create tool call handler for command execution
  const toolCallHandler = createToolCallHandler({
    cwd: path.dirname(path.resolve(file)),
    timeout: parseInt(options.timeout || '30000', 10)
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
    executePrompt: async (source: string, params: Record<string, unknown>, provider?: string, model?: string) => {
      // Handle both .prmd files and raw prompt text
      try {
        // Check if source is a file path (.prmd extension)
        if (source.endsWith('.prmd') && await fs.pathExists(source)) {
          // Execute .prmd file
          const result = await prompdExecutor.execute(source, {
            provider: provider || defaultProvider,
            model: model || defaultModel,
            params: params
          });
          return result.response || result.content || '';
        } else {
          // Execute raw prompt text directly
          const selectedProvider = provider || defaultProvider;
          const selectedModel = model || defaultModel;
          // Priority: CLI params → Env vars → Config file
          const apiKey = options.apiKey || configManager.getApiKey(selectedProvider, config);

          if (!apiKey) {
            throw new Error(`No API key configured for provider: ${selectedProvider}`);
          }

          // Get provider-specific config (custom endpoints, timeouts, etc.)
          const providerConfig = configManager.getProviderConfig(selectedProvider, config);

          const result = await callLLM({
            provider: selectedProvider,
            model: selectedModel,
            apiKey,
            messages: [{ role: 'user', content: source }],
            providerConfig
          });

          if (!result.success) {
            throw new Error(result.error || 'LLM call failed');
          }

          return result.response || '';
        }
      } catch (error) {
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

    // Write output to file if requested
    if (options.output && result.output) {
      await fs.writeFile(options.output, String(result.output), 'utf-8');
      console.log(chalk.green(`\n✓ Output written to ${options.output}`));
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
}
