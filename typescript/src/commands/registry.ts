import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { RegistryClient } from '../lib/registry';
import { ConfigManager } from '../lib/config';
import { VALID_PACKAGE_TYPES, TOOL_DEPLOY_DIRS, resolveToolDeployDir } from '../types';

export function createRegistryCommand(): Command {
  const command = new Command('registry');
  command.description('Manage package registries');

  // Registry list command
  const listCommand = new Command('list');
  listCommand
    .description('List all configured registries')
    .action(async () => {
      try {
        const configManager = ConfigManager.getInstance();
        const config = await configManager.loadConfig();
        const registries = config.registry.registries;
        const defaultRegistry = config.registry.default;

        if (Object.keys(registries).length === 0) {
          console.log(chalk.yellow('No registries configured'));
          console.log(chalk.dim("Use 'prompd registry add' to add a registry"));
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
        console.error(chalk.red(`Error listing registries: ${error}`));
        process.exit(1);
      }
    });

  // Registry add command
  const addCommand = new Command('add');
  addCommand
    .description('Add a new registry')
    .argument('<name>', 'Registry name')
    .argument('<url>', 'Registry URL')
    .action(async (name: string, url: string) => {
      try {
        const configManager = ConfigManager.getInstance();
        await configManager.addRegistry(name, url);
        console.log(chalk.green(`Added registry '${chalk.cyan(name)}' at ${url}`));
      } catch (error) {
        console.error(chalk.red(`Error adding registry: ${error}`));
        process.exit(1);
      }
    });

  // Registry remove command
  const removeCommand = new Command('remove');
  removeCommand
    .description('Remove a registry')
    .argument('<name>', 'Registry name')
    .option('--force', 'Force removal of default prompdhub registry')
    .action(async (name: string, options) => {
      try {
        // Warn about removing prompdhub unless forced
        if (name === 'prompdhub' && !options.force) {
          console.log(chalk.yellow('Warning:') + ' Removing the main prompdhub registry');
          console.log('Use --force to confirm, or consider setting a different default instead');
          process.exit(1);
        }

        const configManager = ConfigManager.getInstance();
        await configManager.removeRegistry(name);
        console.log(chalk.green(`Removed registry '${chalk.cyan(name)}'`));
      } catch (error) {
        console.error(chalk.red(`Error removing registry: ${error}`));
        process.exit(1);
      }
    });

  // Registry set-default command
  const setDefaultCommand = new Command('set-default');
  setDefaultCommand
    .description('Set the default registry')
    .argument('<name>', 'Registry name')
    .action(async (name: string) => {
      try {
        const configManager = ConfigManager.getInstance();
        await configManager.setDefaultRegistry(name);
        console.log(chalk.green(`Set '${chalk.cyan(name)}' as default registry`));
      } catch (error) {
        console.error(chalk.red(`Error setting default registry: ${error}`));
        process.exit(1);
      }
    });

  // Add all registry management commands
  command.addCommand(listCommand);
  command.addCommand(addCommand);
  command.addCommand(removeCommand);
  command.addCommand(setDefaultCommand);

  return command;
}

// Legacy publish command (to be integrated with main CLI)
export function createPublishCommand(): Command {
  const publishCommand = new Command('publish');
  publishCommand
    .description('Publish a package to the registry')
    .argument('[directory]', 'Directory containing project.prmdproj file', '.')
    .option('--access <access>', 'Package access level', 'public')
    .option('--tag <tag>', 'Package tag', 'latest')
    .option('--dry-run', 'Show what would be published without actually publishing')
    .option('--force', 'Force publish even if version exists')
    .option('--registry <registry>', 'Registry name to publish to')
    .action(async (directory: string, options) => {
      try {
        console.log(chalk.cyan(`📦 Publishing package from ${directory}...`));
        
        // Resolve registry
        const registryName = options.registry;
        const client = new RegistryClient(registryName);

        // Event listeners for progress
        client.on('publishStart', ({ packageDir, options }) => {
          console.log(chalk.blue(`🚀 Starting publish from ${packageDir}`));
        });
        
        client.on('publishComplete', ({ name, version, access }) => {
          console.log(chalk.green(`✅ Successfully published ${name}@${version} (${access})`));
          console.log(chalk.gray(`   Registry: ${client.registryUrl}`));
          console.log(chalk.gray(`   Install: prompd install ${name}@${version}`));
        });
        
        client.on('publishError', ({ packageDir, error }) => {
          console.error(chalk.red(`❌ Publish failed: ${error.message}`));
        });

        await client.publish(path.resolve(directory), {
          access: options.access as 'public' | 'private',
          tag: options.tag,
          dryRun: options.dryRun,
          force: options.force
        });

      } catch (error) {
        console.error(chalk.red(`Publish failed: ${error}`));
        process.exit(1);
      }
    });

  return publishCommand;
}

// Legacy search command (to be integrated with main CLI)
export function createSearchCommand(): Command {
  const searchCommand = new Command('search');
  searchCommand
    .description('Search for packages in the registry')
    .argument('<query>', 'Search query')
    .option('-l, --limit <limit>', 'Maximum number of results', '20')
    .option('-t, --type <types>', 'Filter by package type (comma-separated: package,workflow,skill,node-template)')
    .option('-r, --registry <registry>', 'Search specific registry')
    .action(async (query: string, options) => {
      try {
        const limit = parseInt(options.limit, 10);
        const registryName = options.registry;
        const client = new RegistryClient(registryName);

        // Parse and validate --type flag
        let typeFilter: string[] | undefined;
        if (options.type) {
          const parsed: string[] = options.type.split(',').map((t: string) => t.trim());
          for (const t of parsed) {
            if (!VALID_PACKAGE_TYPES.includes(t)) {
              console.error(chalk.red(`Invalid package type: '${t}'`));
              console.error(chalk.dim(`Valid types: ${VALID_PACKAGE_TYPES.join(', ')}`));
              process.exit(1);
            }
          }
          typeFilter = parsed;
        }

        const results = await client.search({
          query,
          limit,
          type: typeFilter && typeFilter.length === 1 ? typeFilter[0] : typeFilter,
        });

        if (results.packages.length === 0) {
          console.log(`No packages found for: ${chalk.cyan(query)}`);
          if (typeFilter) {
            console.log(chalk.dim(`Type filter: ${typeFilter.join(', ')}`));
          }
          if (registryName) {
            console.log(chalk.dim(`Searched in registry: ${registryName}`));
          }
          return;
        }

        const registryDisplayName = registryName || 'default registry';
        console.log(`Found ${results.packages.length} package(s) for ${chalk.cyan(query)} in ${chalk.yellow(registryDisplayName)}:`);
        console.log();

        for (const pkg of results.packages) {
          // Show type badge if present and not 'package' (the default)
          const pkgType = (pkg as { type?: string }).type;
          const typeBadge = pkgType && pkgType !== 'package'
            ? chalk.magenta(` [${pkgType}]`)
            : '';
          console.log(`${chalk.bold.cyan(pkg.name)}${typeBadge} - ${chalk.green(`v${pkg.version}`)}`);
          console.log(`  ${pkg.description || 'No description available'}`);

          if (pkg.author) {
            console.log(`  Author: ${pkg.author}`);
          }

          console.log();
        }

      } catch (error) {
        console.error(chalk.red(`Search failed: ${error}`));
        process.exit(1);
      }
    });

  return searchCommand;
}

// Legacy install command (to be integrated with main CLI)
export function createInstallCommand(): Command {
  const installCommand = new Command('install');
  installCommand
    .description('Install a package from the registry')
    .argument('<package>', 'Package name')
    .option('--version <version>', 'Specific version to install')
    .option('-g, --global', 'Install globally')
    .option('--tools <tools>', 'Deploy skill to tool-native directories (comma-separated, e.g., claude)')
    .option('--registry <registry>', 'Install from specific registry (overrides scope resolution)')
    .action(async (packageName: string, options) => {
      try {
        const configManager = ConfigManager.getInstance();

        // Resolve which registry to use
        let registryName: string;
        if (options.registry) {
          // Explicit registry override
          registryName = options.registry;
        } else {
          // Auto-resolve based on package scope
          registryName = configManager.resolveRegistryForPackage(packageName);
        }

        // Parse --tools flag
        let tools: string[] | undefined;
        if (options.tools) {
          const parsed: string[] = options.tools.split(',').map((t: string) => t.trim());
          for (const t of parsed) {
            if (!TOOL_DEPLOY_DIRS[t]) {
              console.error(chalk.red(`Unknown tool: '${t}'`));
              console.error(chalk.dim(`Supported tools: ${Object.keys(TOOL_DEPLOY_DIRS).join(', ')}`));
              process.exit(1);
            }
          }
          tools = parsed;
        }

        const client = new RegistryClient(registryName);

        console.log(`Installing package: ${chalk.cyan(packageName)}`);
        console.log(`   Registry: ${chalk.yellow(registryName)}`);
        if (options.version) {
          console.log(`   Version: ${chalk.green(options.version)}`);
        }
        if (tools) {
          console.log(`   Tools: ${chalk.magenta(tools.join(', '))}`);
        }

        await client.install(packageName, {
          version: options.version,
          global: options.global,
          tools,
        });

        console.log(chalk.green('Package installed successfully!'));

        if (tools) {
          for (const tool of tools) {
            const resolvedDir = resolveToolDeployDir(tool) || TOOL_DEPLOY_DIRS[tool];
            console.log(chalk.green(`   Deployed to ${tool}: ${resolvedDir}`));
          }
        }

      } catch (error) {
        console.error(chalk.red(`Installation failed: ${error}`));
        process.exit(1);
      }
    });

  return installCommand;
}

// Login command (to be integrated with main CLI)
export function createLoginCommand(): Command {
  const loginCommand = new Command('login');
  loginCommand
    .description('Authenticate with a Prompd registry')
    .option('-t, --token <token>', 'Use API token instead of interactive login')
    .option('-r, --registry <registry>', 'Login to specific registry')
    .action(async (options) => {
      try {
        const registryName = options.registry;
        const client = new RegistryClient(registryName);
        const actualRegistryName = registryName || 'default';

        if (options.token) {
          // Token-based login
          console.log(chalk.dim(`Authenticating with ${actualRegistryName}...`));
          const userData = await client.loginWithToken(options.token);
          
          console.log(chalk.green(`Successfully authenticated as ${userData.username}`));
          console.log(`   Registry: ${actualRegistryName} (${client.registryUrl})`);
        } else {
          // Interactive login not implemented yet
          console.log(chalk.yellow('Interactive login not yet implemented. Use --token option.'));
          process.exit(1);
        }

      } catch (error) {
        console.error(chalk.red(`Authentication failed: ${error}`));
        process.exit(1);
      }
    });

  return loginCommand;
}

// Logout command (to be integrated with main CLI)
export function createLogoutCommand(): Command {
  const logoutCommand = new Command('logout');
  logoutCommand
    .description('Clear registry authentication credentials')
    .option('-r, --registry <registry>', 'Logout from specific registry')
    .action(async (options) => {
      try {
        const registryName = options.registry;
        const client = new RegistryClient(registryName);

        await client.logout();

        const actualRegistryName = registryName || 'default';
        console.log(chalk.green(`Successfully logged out from ${actualRegistryName}`));

      } catch (error) {
        console.error(chalk.red(`Logout failed: ${error}`));
        process.exit(1);
      }
    });

  return logoutCommand;
}

// Versions command - list package versions
export function createVersionsCommand(): Command {
  const versionsCommand = new Command('versions');
  versionsCommand
    .description('List available versions of a package')
    .argument('<package>', 'Package name (@namespace/name)')
    .option('-r, --registry <registry>', 'Registry to query')
    .action(async (packageName: string, options) => {
      try {
        const client = new RegistryClient(options.registry);

        // Call registry API to get versions
        const versions = await client.getPackageVersions(packageName);

        if (!versions || versions.length === 0) {
          console.log(chalk.yellow(`No versions found for ${packageName}`));
          return;
        }

        console.log(chalk.bold(`\nVersions for ${packageName}:`));
        console.log();

        // Sort versions in descending order (newest first)
        const sortedVersions = versions.sort((a: string, b: string) => {
          return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
        });

        sortedVersions.forEach((version: string, index: number) => {
          const isLatest = index === 0;
          const marker = isLatest ? chalk.green('(latest)') : '';
          console.log(`  ${chalk.cyan(version)} ${marker}`);
        });

        console.log();
        console.log(chalk.dim(`Total: ${sortedVersions.length} version(s)`));

      } catch (error) {
        console.error(chalk.red(`Failed to fetch versions: ${error}`));
        process.exit(1);
      }
    });

  return versionsCommand;
}