import { Command } from 'commander';
import { ConfigManager } from '../lib/config';

export function createNamespaceCommand(): Command {
  const namespaceCommand = new Command('namespace');

  namespaceCommand
    .description('Manage package namespaces');

  // List subcommand
  const listCommand = new Command('list');
  listCommand
    .description('List all configured namespaces')
    .action(async () => {
      const config = new ConfigManager();
      const currentConfig = await config.loadConfig();

      if (!currentConfig.namespaces || Object.keys(currentConfig.namespaces).length === 0) {
        console.log('No namespaces configured');
        return;
      }

      console.log('Available namespaces:');
      for (const [namespace, registry] of Object.entries(currentConfig.namespaces)) {
        const current = namespace === currentConfig.currentNamespace ? ' (current)' : '';
        console.log(`  ${namespace} → ${registry}${current}`);
      }
    });

  // Current subcommand
  const currentCommand = new Command('current');
  currentCommand
    .description('Show current namespace')
    .action(async () => {
      const config = new ConfigManager();
      const currentConfig = await config.loadConfig();

      if (!currentConfig.currentNamespace) {
        console.log('No current namespace set');
        return;
      }

      const registry = currentConfig.namespaces?.[currentConfig.currentNamespace] || 'unknown';
      console.log(`Current namespace: ${currentConfig.currentNamespace}`);
      console.log(`Registry: ${registry}`);
    });

  // Use subcommand
  const useCommand = new Command('use');
  useCommand
    .description('Switch to a different namespace')
    .argument('<namespace>', 'Namespace to use (@namespace format)')
    .action(async (namespace: string) => {
      let ns = namespace;
      if (!ns.startsWith('@')) {
        ns = '@' + ns;
      }

      const config = new ConfigManager();
      const currentConfig = await config.loadConfig();

      if (!currentConfig.namespaces || !currentConfig.namespaces[ns]) {
        console.error(`ERROR: Namespace '${ns}' not found`);
        console.log('Use \'prompd namespace list\' to see available namespaces');
        process.exit(1);
      }

      currentConfig.currentNamespace = ns;
      await config.saveConfig(currentConfig);

      console.log(`✓ Switched to namespace: ${ns}`);
    });

  // Create subcommand
  const createCommand = new Command('create');
  createCommand
    .description('Create a new namespace')
    .argument('<namespace>', 'Namespace to create (@namespace format)')
    .option('-r, --registry <url>', 'Registry URL')
    .action(async (namespace: string, options: { registry?: string }) => {
      let ns = namespace;
      if (!ns.startsWith('@')) {
        ns = '@' + ns;
      }

      const config = new ConfigManager();
      const currentConfig = await config.loadConfig();

      // Check if namespace already exists
      if (currentConfig.namespaces && currentConfig.namespaces[ns]) {
        console.error(`ERROR: Namespace '${ns}' already exists`);
        process.exit(1);
      }

      // Determine registry URL
      let registryURL = options.registry;
      if (!registryURL) {
        if (currentConfig.registry?.default) {
          const defaultRegistry = currentConfig.registry.registries?.[currentConfig.registry.default];
          if (defaultRegistry) {
            registryURL = defaultRegistry.url;
          }
        }
        if (!registryURL) {
          registryURL = 'https://registry.prompdhub.ai';
        }
      }

      // Add namespace
      if (!currentConfig.namespaces) {
        currentConfig.namespaces = {};
      }
      currentConfig.namespaces[ns] = registryURL;

      // Set as current if it's the first namespace
      if (!currentConfig.currentNamespace) {
        currentConfig.currentNamespace = ns;
      }

      await config.saveConfig(currentConfig);

      console.log(`✓ Created namespace: ${ns}`);
      console.log(`  Registry: ${registryURL}`);
    });

  namespaceCommand.addCommand(listCommand);
  namespaceCommand.addCommand(currentCommand);
  namespaceCommand.addCommand(useCommand);
  namespaceCommand.addCommand(createCommand);

  return namespaceCommand;
}
