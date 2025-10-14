import { Command } from 'commander';
import chalk from 'chalk';
import * as yaml from 'yaml';
import { ConfigManager } from '../lib/config';
import { createProviderCommand } from './provider';
import { createRegistryCommand } from './registry';

/**
 * Creates the unified config command structure
 * Matches Python CLI organization: prompd config <subcommand>
 */
export function createConfigCommand(): Command {
  const command = new Command('config');
  command.description('Manage prompd configuration');

  // Add subcommands
  command.addCommand(createShowCommand());
  command.addCommand(createRegistriesAliasCommand());
  command.addCommand(createProvidersAliasCommand());

  // Add provider and registry as subgroups under config
  const providerCommand = createProviderCommand();
  providerCommand.name('provider');
  command.addCommand(providerCommand);

  const registryCommand = createRegistryCommand();
  registryCommand.name('registry');
  command.addCommand(registryCommand);

  return command;
}

/**
 * config show - Display all configuration
 */
function createShowCommand(): Command {
  const showCommand = new Command('show');
  showCommand
    .description('Show all configuration settings')
    .action(async () => {
      try {
        const configManager = ConfigManager.getInstance();
        const config = await configManager.loadConfig();

        console.log(chalk.bold.cyan('=== Prompd Configuration ===\n'));

        // Defaults section
        console.log(chalk.bold('Defaults:'));
        console.log(`  Provider: ${config.defaultProvider || chalk.gray('not set')}`);
        console.log(`  Model: ${config.defaultModel || chalk.gray('not set')}`);
        console.log(`  Registry: ${config.registry?.default || chalk.gray('prompdhub')}`);
        console.log();

        // API Keys section
        console.log(chalk.bold('API Keys:'));
        if (Object.keys(config.apiKeys || {}).length === 0) {
          console.log(chalk.gray('  (none configured)'));
        } else {
          Object.keys(config.apiKeys || {}).forEach(provider => {
            const key = config.apiKeys![provider];
            const masked = key && key.length > 4 ? '*'.repeat(key.length - 4) + key.slice(-4) : '***';
            console.log(`  ${provider}: ${masked}`);
          });
        }
        console.log();

        // Custom Providers section
        console.log(chalk.bold('Custom Providers:'));
        if (Object.keys(config.customProviders || {}).length === 0) {
          console.log(chalk.gray('  (none configured)'));
        } else {
          Object.entries(config.customProviders || {}).forEach(([name, provider]) => {
            const enabled = provider.enabled !== false ? chalk.green('enabled') : chalk.red('disabled');
            console.log(`  ${chalk.cyan(name)} - ${enabled}`);
            console.log(`    Base URL: ${provider.baseUrl}`);
            console.log(`    Models: ${provider.models.join(', ')}`);
          });
        }
        console.log();

        // Registries section
        console.log(chalk.bold('Registries:'));
        const registries = config.registry?.registries || {};
        if (Object.keys(registries).length === 0) {
          console.log(chalk.gray('  (none configured)'));
        } else {
          Object.entries(registries).forEach(([name, registry]) => {
            const isDefault = name === config.registry?.default;
            const defaultMark = isDefault ? chalk.green(' (default)') : '';
            console.log(`  ${chalk.cyan(name)}${defaultMark}`);
            console.log(`    URL: ${registry.url || 'N/A'}`);
            console.log(`    User: ${registry.username || chalk.gray('not logged in')}`);
          });
        }
        console.log();

        // Settings section
        console.log(chalk.bold('Settings:'));
        console.log(`  Timeout: ${config.timeout || 30}s`);
        console.log(`  Max Retries: ${config.maxRetries || 3}`);
        console.log(`  Verbose: ${config.verbose ? 'yes' : 'no'}`);
        console.log();

        // Show config file location
        const configPaths = [
          require('path').join(require('os').homedir(), '.prmd', 'config.yaml'),
          require('path').join(require('os').homedir(), '.prmd', 'config.json'),
        ];

        console.log(chalk.gray(`Config file: ${configPaths[0]}`));
        console.log(chalk.gray(`Use 'prompd config provider' and 'prompd config registry' to manage settings`));

      } catch (error) {
        console.error(chalk.red('Error displaying configuration:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return showCommand;
}

/**
 * config registries - Alias for 'config registry list'
 */
function createRegistriesAliasCommand(): Command {
  const registriesCommand = new Command('registries');
  registriesCommand
    .description('List configured registries (alias for "config registry list")')
    .action(async () => {
      try {
        const configManager = ConfigManager.getInstance();
        const config = await configManager.loadConfig();
        const registries = config.registry?.registries || {};
        const defaultRegistry = config.registry?.default || 'prompdhub';

        if (Object.keys(registries).length === 0) {
          console.log(chalk.yellow('No registries configured'));
          console.log(chalk.dim("Use 'prompd config registry add' to add a registry"));
          return;
        }

        console.log(chalk.bold('Configured Registries:'));
        for (const [name, registryConfig] of Object.entries(registries)) {
          const defaultMark = name === defaultRegistry ? chalk.green(' (default)') : '';
          const url = registryConfig.url || 'N/A';
          const username = registryConfig.username || 'Not logged in';
          console.log(`  • ${chalk.cyan(name)}${defaultMark}`);
          console.log(`    URL: ${url}`);
          console.log(`    User: ${username}`);
        }
      } catch (error) {
        console.error(chalk.red('Error listing registries:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return registriesCommand;
}

/**
 * config providers - Alias for 'config provider list'
 */
function createProvidersAliasCommand(): Command {
  const providersCommand = new Command('providers');
  providersCommand
    .description('List configured providers (alias for "config provider list")')
    .action(async () => {
      try {
        const configManager = ConfigManager.getInstance();
        const config = await configManager.loadConfig();

        console.log(chalk.cyan('Available LLM Providers:\n'));

        console.log(chalk.blue('🔧 Built-in Providers:'));

        const builtinProviders: Record<string, string[]> = {
          'openai': ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo', 'gpt-4-turbo'],
          'anthropic': ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
          'groq': ['llama3-8b-8192', 'mixtral-8x7b-32768'],
          'ollama': ['llama2', 'codellama', '(dynamic - depends on local installation)']
        };

        for (const [provider, models] of Object.entries(builtinProviders)) {
          const hasKey = !!config.apiKeys?.[provider];
          const status = hasKey ? '✓' : (provider === 'ollama' ? '✓' : chalk.yellow('⚠ (no API key)'));

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
        if (Object.keys(config.customProviders || {}).length === 0) {
          console.log(chalk.gray('    (No custom providers configured)'));
        } else {
          for (const [name, provider] of Object.entries(config.customProviders || {})) {
            let status = '✓';
            if (provider.enabled === false) {
              status = chalk.yellow('⚠ (disabled)');
            } else if (!config.apiKeys?.[name]) {
              status = chalk.yellow('⚠ (no API key)');
            }

            console.log(`  • ${chalk.cyan(name)} ${status}`);
            console.log(chalk.gray(`    Base URL: ${provider.baseUrl}`));
            if (provider.models.length > 0) {
              console.log(chalk.gray(`    Models: ${provider.models.join(', ')}`));
            }
          }
        }

        console.log(`\nUse 'prompd config provider show <name>' for details`);

      } catch (error) {
        console.error(chalk.red('Error listing providers:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return providersCommand;
}
