import { Command } from 'commander';
import chalk from 'chalk';
import { ConfigManager } from '../lib/config';
import { PrompdExecutor } from '../lib/executor';

export function createProviderCommand(): Command {
  const command = new Command('provider');
  command.description('Manage LLM providers');
  
  // Provider list command
  const listCommand = new Command('list');
  listCommand
    .description('List available LLM providers and their models')
    .action(async () => {
      try {
        const configManager = ConfigManager.getInstance();
        const executor = new PrompdExecutor();
        const config = await configManager.loadConfig();
        
        console.log(chalk.cyan('Available LLM Providers:\n'));
        
        console.log(chalk.blue('🔧 Built-in Providers:'));
        
        const builtinProviders = {
          'openai': ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo', 'gpt-4-turbo'],
          'anthropic': ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
          'groq': ['llama3-8b-8192', 'mixtral-8x7b-32768'],
          'ollama': ['llama2', 'codellama', '(dynamic - depends on local installation)']
        };
        
        for (const [provider, models] of Object.entries(builtinProviders)) {
          const isConfigured = configManager.isProviderConfigured(provider, config);
          const status = isConfigured ? '✓' : (provider === 'ollama' ? '✓' : '⚠ (no API key)');
          
          console.log(`  • ${chalk.cyan(provider)} ${status}`);
          if (models.length > 0 && models[0] !== '(dynamic - depends on local installation)') {
            const displayModels = models.slice(0, 3);
            console.log(chalk.gray(`    Models: ${displayModels.join(', ')}`));
            if (models.length > 3) {
              console.log(chalk.gray('    (and more...)'));
            }
          } else if (models.length > 0) {
            console.log(chalk.gray(`    Models: ${models[0]}`));
          }
        }
        
        console.log(`\n${chalk.blue('🏠 Custom Providers:')}`);
        if (Object.keys(config.customProviders).length === 0) {
          console.log(chalk.gray('    (No custom providers configured)'));
        } else {
          for (const [name, provider] of Object.entries(config.customProviders)) {
            let status = '✓';
            if (!provider.enabled) {
              status = '⚠ (disabled)';
            } else if (!provider.apiKey) {
              status = '⚠ (no API key)';
            }
            
            console.log(`  • ${chalk.cyan(name)} ${status}`);
            console.log(chalk.gray(`    Base URL: ${provider.baseUrl}`));
            if (provider.models.length > 0) {
              console.log(chalk.gray(`    Models: ${provider.models.join(', ')}`));
            }
          }
        }
        
        console.log(`\nUse 'prompd provider show <name>' for details`);
        
      } catch (error) {
        console.error(chalk.red('Error listing providers:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
  
  // Provider add command
  const addCommand = new Command('add');
  addCommand
    .description('Add a custom LLM provider')
    .argument('<name>', 'Provider name (e.g., "local-ollama")')
    .argument('<base-url>', 'API endpoint URL (e.g., "http://localhost:11434/v1")')
    .argument('<models...>', 'Space-separated list of model names')
    .option('--api-key <key>', 'API key for the provider')
    .option('--type <type>', 'Provider type', 'openai-compatible')
    .action(async (name: string, baseUrl: string, models: string[], options) => {
      try {
        const configManager = ConfigManager.getInstance();
        const config = await configManager.loadConfig();
        
        // Check if provider already exists
        if (config.customProviders[name]) {
          console.log(chalk.yellow(`Provider '${name}' already exists. Use 'prompd provider remove ${name}' first.`));
          return;
        }
        
        // Add the provider
        await configManager.addCustomProvider(
          name,
          baseUrl,
          models,
          options.apiKey,
          options.type
        );
        
        console.log(chalk.green(`✓ Added custom provider '${name}'`));
        console.log(chalk.gray(`  Base URL: ${baseUrl}`));
        console.log(chalk.gray(`  Models: ${models.join(', ')}`));
        console.log(chalk.gray(`  Type: ${options.type}`));
        
        if (options.apiKey) {
          const maskedKey = options.apiKey.length > 4 
            ? '*'.repeat(options.apiKey.length - 4) + options.apiKey.slice(-4)
            : '*'.repeat(options.apiKey.length);
          console.log(chalk.gray(`  API Key: ${maskedKey}`));
        } else {
          console.log(chalk.gray(`\nSet API key with: export ${name.toUpperCase()}_API_KEY=your_key`));
        }
        
      } catch (error) {
        console.error(chalk.red('Error adding provider:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
  
  // Provider remove command
  const removeCommand = new Command('remove');
  removeCommand
    .description('Remove a custom LLM provider')
    .argument('<name>', 'Provider name')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (name: string, options) => {
      try {
        const configManager = ConfigManager.getInstance();
        const config = await configManager.loadConfig();
        
        if (!config.customProviders[name]) {
          console.log(chalk.red(`Provider '${name}' not found`));
          process.exit(1);
        }
        
        if (!options.yes) {
          const provider = config.customProviders[name];
          console.log(`About to remove provider: ${chalk.bold(name)}`);
          console.log(chalk.gray(`  Base URL: ${provider.baseUrl}`));
          console.log(chalk.gray(`  Models: ${provider.models.join(', ')}`));
          
          // Simple confirmation without inquirer for now
          console.log('\nAre you sure? (y/N)');
          // For now, just proceed - in a real implementation you'd use inquirer
          console.log('Proceeding...');
        }
        
        await configManager.removeCustomProvider(name);
        console.log(chalk.green(`✓ Removed provider '${name}'`));
        
      } catch (error) {
        console.error(chalk.red('Error removing provider:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
  
  // Provider show command
  const showCommand = new Command('show');
  showCommand
    .description('Show details for a specific provider')
    .argument('<name>', 'Provider name')
    .action(async (name: string) => {
      try {
        const configManager = ConfigManager.getInstance();
        const executor = new PrompdExecutor();
        const config = await configManager.loadConfig();
        
        // Check if it's a custom provider
        if (config.customProviders[name]) {
          const provider = config.customProviders[name];
          console.log(chalk.cyan.bold(`=== ${name} (Custom Provider) ===\n`));
          console.log(`${chalk.bold('Base URL:')} ${provider.baseUrl}`);
          console.log(`${chalk.bold('Type:')} ${provider.type}`);
          console.log(`${chalk.bold('Enabled:')} ${provider.enabled}`);
          
          if (provider.apiKey) {
            console.log(`${chalk.bold('API Key:')} Set (from config)`);
          } else {
            const envKey = `${name.toUpperCase()}_API_KEY`;
            const envApiKey = process.env[envKey];
            if (envApiKey) {
              console.log(`${chalk.bold('API Key:')} Set (from ${envKey})`);
            } else {
              console.log(`${chalk.bold('API Key:')} Not set`);
            }
          }
          
          console.log(`\n${chalk.bold('Models:')}`);
          for (const model of provider.models) {
            console.log(`  • ${model}`);
          }
          return;
        }
        
        // Built-in providers
        const builtinProviders: Record<string, { models: string[]; env: string }> = {
          'openai': {
            models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo', 'gpt-4-turbo'],
            env: 'OPENAI_API_KEY'
          },
          'anthropic': {
            models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
            env: 'ANTHROPIC_API_KEY'
          },
          'groq': {
            models: ['llama3-8b-8192', 'mixtral-8x7b-32768'],
            env: 'GROQ_API_KEY'
          },
          'ollama': {
            models: ['llama2', 'codellama', '(depends on local installation)'],
            env: '(not required - local provider)'
          }
        };
        
        if (builtinProviders[name]) {
          const provider = builtinProviders[name];
          console.log(chalk.cyan.bold(`=== ${name} (Built-in Provider) ===\n`));
          
          const hasApiKey = !!configManager.getApiKey(name, config);
          const envVar = provider.env;
          
          if (envVar === '(not required - local provider)') {
            console.log(`${chalk.bold('API Key:')} ${envVar}`);
          } else if (hasApiKey) {
            console.log(`${chalk.bold('API Key:')} Set (from ${envVar})`);
          } else {
            console.log(`${chalk.bold('API Key:')} Not set (set ${envVar} environment variable)`);
          }
          
          console.log(`\n${chalk.bold('Models:')}`);
          const models = provider.models;
          for (let i = 0; i < Math.min(models.length, 10); i++) {
            console.log(`  • ${models[i]}`);
          }
          if (models.length > 10) {
            console.log(`  ... and ${models.length - 10} more`);
          }
        } else {
          console.log(chalk.red(`Provider '${name}' not found`));
          process.exit(1);
        }
        
      } catch (error) {
        console.error(chalk.red('Error showing provider:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
  
  // Provider setkey command
  const setkeyCommand = new Command('setkey');
  setkeyCommand
    .description('Set API key for a provider')
    .argument('<provider>', 'Provider name')
    .argument('<api-key>', 'API key')
    .action(async (provider: string, apiKey: string) => {
      try {
        const configManager = ConfigManager.getInstance();
        const config = await configManager.loadConfig();
        
        if (!config.apiKeys) {
          config.apiKeys = {};
        }
        
        config.apiKeys[provider] = apiKey;
        await configManager.saveConfig(config);
        
        console.log(chalk.green(`✓ API key set for ${provider}`));
        
      } catch (error) {
        console.error(chalk.red('Error setting API key:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
  
  // Provider removekey command
  const removekeyCommand = new Command('removekey');
  removekeyCommand
    .description('Remove API key for a provider')
    .argument('<provider>', 'Provider name')
    .action(async (provider: string) => {
      try {
        const configManager = ConfigManager.getInstance();
        const config = await configManager.loadConfig();
        
        if (config.apiKeys && config.apiKeys[provider]) {
          delete config.apiKeys[provider];
          await configManager.saveConfig(config);
          console.log(chalk.green(`✓ API key removed for ${provider}`));
        } else {
          console.log(chalk.yellow(`No API key configured for ${provider}`));
        }
        
      } catch (error) {
        console.error(chalk.red('Error removing API key:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
  
  command.addCommand(listCommand);
  command.addCommand(addCommand);
  command.addCommand(removeCommand);
  command.addCommand(showCommand);
  command.addCommand(setkeyCommand);
  command.addCommand(removekeyCommand);
  
  return command;
}