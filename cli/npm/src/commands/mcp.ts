import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as glob from 'glob';
import { PrompdMCPServer, MCPServerConfig } from '../lib/mcp';
import { ConfigManager } from '../lib/config';
import { SecurityManager } from '../lib/security';

/**
 * Discover .prmd and .pdflow files from installed packages.
 * Scans both local project cache (./.prompd/cache/) and global cache (~/.prompd/cache/).
 * TODO: When cache/ is renamed to packages/, update these paths.
 */
async function discoverInstalledPackages(): Promise<{ prompts: string[]; workflows: string[] }> {
  const homeDir = os.homedir();
  const cacheDirs = [
    path.join(homeDir, '.prompd', 'cache'),
    path.join(process.cwd(), '.prompd', 'cache'),
  ];

  const prompts: string[] = [];
  const workflows: string[] = [];
  const seen = new Set<string>();

  for (const cacheDir of cacheDirs) {
    if (!await fs.pathExists(cacheDir)) continue;

    const prmdFiles = glob.sync(path.join(cacheDir, '**/*.prmd').replace(/\\/g, '/'));
    for (const f of prmdFiles) {
      const resolved = path.resolve(f);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        prompts.push(resolved);
      }
    }

    const flowFiles = [
      ...glob.sync(path.join(cacheDir, '**/*.prmdflow').replace(/\\/g, '/')),
      ...glob.sync(path.join(cacheDir, '**/*.pdflow').replace(/\\/g, '/')),
    ];
    for (const f of flowFiles) {
      const resolved = path.resolve(f);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        workflows.push(resolved);
      }
    }
  }

  return { prompts, workflows };
}

/**
 * Discover .prmd files registered in ~/.prmd/mcp-config.json
 */
async function discoverConfiguredTools(): Promise<{ name: string; file: string; type: string }[]> {
  const configPath = path.join(os.homedir(), '.prmd', 'mcp-config.json');
  if (!await fs.pathExists(configPath)) return [];

  try {
    const config = await fs.readJson(configPath);
    if (!config.tools) return [];
    return Object.entries(config.tools).map(([name, tool]: [string, any]) => ({
      name,
      file: tool.file,
      type: tool.type || 'prompt',
    }));
  } catch {
    return [];
  }
}

export function createMCPCommand(): Command {
  const command = new Command('mcp');
  command.description('Model Context Protocol (MCP) server operations');

  // Start MCP server
  const startCommand = new Command('start');
  startCommand
    .description('Start MCP server to expose .prmd files as tools')
    .option('-d, --directory <dir>', 'Directory containing .prmd files')
    .option('-t, --tool <name:file>', 'Register specific tool (format: name:file.prmd)', [])
    .option('--no-auto-discover', 'Disable auto-discovery of installed packages')
    .option('--execute', 'Execute prompts with LLM (default: return templates)')
    .option('--provider <provider>', 'Default LLM provider when executing')
    .option('--model <model>', 'Default model when executing')
    .option('--api-key <key>', 'API key override')
    .option('--allowed-tools <tools>', 'Comma-separated list of allowed tool names')
    .option('--max-request-size <bytes>', 'Maximum request size in bytes', '10000')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (options) => {
      try {
        console.error(chalk.cyan('Starting Prompd MCP Server...'));

        // Load configuration
        const configManager = ConfigManager.getInstance();
        const config = await configManager.loadConfig();

        // Prepare server config
        const serverConfig: MCPServerConfig = {
          name: 'prompd-mcp-server',
          version: '0.2.3',
          execute: options.execute,
          provider: options.provider || config.defaultProvider,
          model: options.model || config.defaultModel,
          apiKey: options.apiKey,
          allowedTools: options.allowedTools ? options.allowedTools.split(',').map((t: string) => t.trim()) : undefined,
          maxRequestSize: parseInt(options.maxRequestSize)
        };

        // Create and configure server
        const server = new PrompdMCPServer(serverConfig);

        // Auto-discover installed packages (unless --no-auto-discover)
        if (options.autoDiscover !== false) {
          console.error(chalk.blue('Auto-discovering installed packages...'));
          const { prompts, workflows } = await discoverInstalledPackages();
          for (const file of prompts) {
            try {
              const toolName = path.basename(file, '.prmd');
              await server.registerTool(toolName, file);
            } catch (err) {
              console.error(chalk.yellow(`Skipping ${file}: ${err instanceof Error ? err.message : err}`));
            }
          }
          for (const file of workflows) {
            try {
              const ext = path.extname(file);
              const toolName = path.basename(file, ext);
              await server.registerWorkflow(toolName, file);
            } catch (err) {
              console.error(chalk.yellow(`Skipping ${file}: ${err instanceof Error ? err.message : err}`));
            }
          }

          // Also load tools from mcp-config.json
          const configuredTools = await discoverConfiguredTools();
          for (const tool of configuredTools) {
            try {
              if (tool.type === 'workflow') {
                await server.registerWorkflow(tool.name, tool.file);
              } else {
                await server.registerTool(tool.name, tool.file);
              }
            } catch (err) {
              console.error(chalk.yellow(`Skipping configured tool ${tool.name}: ${err instanceof Error ? err.message : err}`));
            }
          }
        }

        // Register tools from explicit directory
        if (options.directory) {
          console.error(chalk.blue(`Registering tools from: ${options.directory}`));
          await server.registerDirectory(options.directory);
        }

        // Register specific tools
        if (options.tool && options.tool.length > 0) {
          for (const toolSpec of options.tool) {
            const [name, file] = toolSpec.split(':');
            if (!name || !file) {
              console.error(chalk.red(`Invalid tool specification: ${toolSpec}. Use format 'name:file.prmd'`));
              continue;
            }
            console.error(chalk.blue(`Registering tool: ${name} -> ${file}`));
            await server.registerTool(name, file);
          }
        }

        const registeredPrompts = server.getRegisteredPrompts();
        const registeredWorkflows = server.getRegisteredWorkflows();
        const totalTools = registeredPrompts.length + registeredWorkflows.length;

        console.error(chalk.green(`Registered ${totalTools} tools:`));

        if (registeredPrompts.length > 0) {
          console.error(chalk.blue('  Prompts:'));
          for (const tool of registeredPrompts) {
            console.error(chalk.gray(`    - ${tool}`));
          }
        }

        if (registeredWorkflows.length > 0) {
          console.error(chalk.blue('  Workflows:'));
          for (const tool of registeredWorkflows) {
            console.error(chalk.gray(`    - ${tool} (workflow)`));
          }
        }

        if (options.execute) {
          console.error(chalk.yellow(`Execution mode enabled (${serverConfig.provider}/${serverConfig.model})`));
        } else {
          console.error(chalk.blue('Template mode (returning rendered prompts)'));
        }

        console.error(chalk.cyan('MCP Server ready on stdio'));
        console.error(chalk.gray('Waiting for MCP client connections...'));

        if (options.verbose) {
          console.error(chalk.gray('Server configuration:'));
          console.error(chalk.gray(JSON.stringify(serverConfig, null, 2)));
        }

        // Start server (stdio — stdout is reserved for MCP protocol)
        await server.start();

      } catch (error) {
        console.error(chalk.red('Error starting MCP server:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Add tool registration
  const addCommand = new Command('add');
  addCommand
    .description('Add a .prmd file or workflow to MCP server configuration')
    .argument('<type>', 'Type: "prompt" or "workflow"')
    .argument('<name>', 'Tool name for MCP')  
    .argument('[file]', 'Path to .prmd or .prmdflow file (optional for workflows)')
    .option('--config-file <file>', 'MCP configuration file', path.join(os.homedir(), '.prmd', 'mcp-config.json'))
    .action(async (type: string, name: string, file?: string, options?: any) => {
      if (type !== 'prompt' && type !== 'workflow') {
        console.error(chalk.red('Error: type must be "prompt" or "workflow"'));
        process.exit(1);
      }
      try {
        let resolvedFile = file;
        
        // Security: Sanitize name first
        const sanitizedName = SecurityManager.sanitizeToolName(name);
        
        // Handle workflow discovery if no file specified
        if (type === 'workflow' && !file) {
          // Look for a workflow with this name in common locations
          const searchPaths = [
            `./workflows/${sanitizedName}.prmdflow`,
            `./${sanitizedName}.prmdflow`,
            `./flows/${sanitizedName}.prmdflow`
          ];
          
          for (const searchPath of searchPaths) {
            if (await fs.pathExists(searchPath)) {
              resolvedFile = searchPath;
              break;
            }
          }
          
          if (!resolvedFile) {
            console.error(chalk.red(`Workflow file not found. Tried: ${searchPaths.join(', ')}`));
            console.log(chalk.yellow('Specify file path explicitly or ensure workflow exists in ./workflows/, ./flows/, or current directory'));
            process.exit(1);
          }
        }

        // Validate file exists
        if (!resolvedFile || !await fs.pathExists(resolvedFile)) {
          console.error(chalk.red(`File not found: ${resolvedFile}`));
          process.exit(1);
        }

        // Validate file type matches
        if (type === 'prompt' && !resolvedFile.endsWith('.prmd')) {
          console.error(chalk.red('Prompt files must have .prmd extension'));
          process.exit(1);
        }
        if (type === 'workflow' && !resolvedFile.endsWith('.prmdflow')) {
          console.error(chalk.red('Workflow files must have .prmdflow extension'));
          process.exit(1);
        }

        // Load or create config
        const configPath = options?.configFile || path.join(os.homedir(), '.prmd', 'mcp-config.json');
        await fs.ensureDir(path.dirname(configPath));
        
        let mcpConfig: any = {};
        if (await fs.pathExists(configPath)) {
          mcpConfig = await fs.readJson(configPath);
        }

        if (!mcpConfig.tools) {
          mcpConfig.tools = {};
        }

        // Add tool with sanitized name
        mcpConfig.tools[sanitizedName] = {
          type,
          file: path.resolve(resolvedFile),
          added: new Date().toISOString()
        };

        // Save config
        await fs.writeJson(configPath, mcpConfig, { spaces: 2 });

        console.log(chalk.green(`✓ Added ${type} '${sanitizedName}' -> ${resolvedFile}`));
        console.log(chalk.gray(`Config saved to: ${configPath}`));

      } catch (error) {
        console.error(chalk.red(`Error adding ${type}:`), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Remove tool
  const removeCommand = new Command('remove');
  removeCommand
    .description('Remove a tool from MCP server configuration')
    .argument('<name>', 'Tool name to remove')
    .option('--config-file <file>', 'MCP configuration file', path.join(os.homedir(), '.prmd', 'mcp-config.json'))
    .action(async (name: string, options) => {
      try {
        const configPath = options.configFile;
        
        if (!await fs.pathExists(configPath)) {
          console.error(chalk.red(`Config file not found: ${configPath}`));
          process.exit(1);
        }

        const mcpConfig = await fs.readJson(configPath);
        
        if (!mcpConfig.tools || !mcpConfig.tools[name]) {
          console.error(chalk.red(`Tool '${name}' not found in configuration`));
          process.exit(1);
        }

        delete mcpConfig.tools[name];
        await fs.writeJson(configPath, mcpConfig, { spaces: 2 });

        console.log(chalk.green(`✓ Removed tool '${name}'`));

      } catch (error) {
        console.error(chalk.red('Error removing tool:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // List registered tools
  const listCommand = new Command('list');
  listCommand
    .description('List configured MCP tools')
    .option('--config-file <file>', 'MCP configuration file', path.join(os.homedir(), '.prmd', 'mcp-config.json'))
    .action(async (options) => {
      try {
        const configPath = options.configFile;
        
        if (!await fs.pathExists(configPath)) {
          console.log(chalk.yellow('No MCP configuration found'));
          console.log(chalk.gray(`Expected at: ${configPath}`));
          return;
        }

        const mcpConfig = await fs.readJson(configPath);
        
        if (!mcpConfig.tools || Object.keys(mcpConfig.tools).length === 0) {
          console.log(chalk.yellow('No tools configured'));
          return;
        }

        console.log(chalk.cyan('Configured MCP Tools:'));
        console.log();

        for (const [name, toolConfig] of Object.entries(mcpConfig.tools)) {
          const config = toolConfig as any;
          const exists = await fs.pathExists(config.file);
          const status = exists ? chalk.green('✓') : chalk.red('✗');
          
          console.log(`${status} ${chalk.bold(name)}`);
          console.log(`    File: ${config.file}`);
          console.log(`    Added: ${config.added || 'Unknown'}`);
          console.log();
        }

      } catch (error) {
        console.error(chalk.red('Error listing tools:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Generate MCP client configuration
  const configCommand = new Command('config');
  configCommand
    .description('Generate MCP configuration for Claude Desktop, OpenClaw, or other MCP clients')
    .option('--config-file <file>', 'MCP configuration file', path.join(os.homedir(), '.prmd', 'mcp-config.json'))
    .option('--output <file>', 'Output file for generated config')
    .option('--server-name <name>', 'MCP server name', 'prompd')
    .option('--format <format>', 'Config format: claude-desktop, openclaw', 'claude-desktop')
    .option('--execute', 'Include --execute flag in server args')
    .option('--provider <provider>', 'Include --provider in server args')
    .option('--model <model>', 'Include --model in server args')
    .action(async (options) => {
      try {
        // Build server args
        const serverArgs = ['mcp', 'start'];
        if (options.execute) serverArgs.push('--execute');
        if (options.provider) serverArgs.push('--provider', options.provider);
        if (options.model) serverArgs.push('--model', options.model);

        let generatedConfig: Record<string, unknown>;
        let instructions: string[];

        switch (options.format) {
          case 'openclaw': {
            // OpenClaw uses standard MCP server config format
            generatedConfig = {
              mcpServers: {
                [options.serverName]: {
                  command: 'npx',
                  args: ['-y', '@prompd/cli', ...serverArgs],
                  env: {}
                }
              }
            };
            instructions = [
              'To use with OpenClaw:',
              '1. Add this to your OpenClaw MCP server configuration',
              '2. Restart OpenClaw or reload MCP servers',
              '3. Prompd prompts and workflows will be available as tools',
              '',
              'Alternatively, add directly to your OpenClaw config:',
              `   openclaw mcp add ${options.serverName} --command "npx" --args "-y @prompd/cli ${serverArgs.join(' ')}"`,
            ];
            break;
          }
          case 'claude-desktop':
          default: {
            generatedConfig = {
              mcpServers: {
                [options.serverName]: {
                  command: 'npx',
                  args: ['-y', '@prompd/cli', ...serverArgs],
                  env: {}
                }
              }
            };
            instructions = [
              'To use with Claude Desktop:',
              '1. Add this configuration to your Claude Desktop settings',
              '2. Restart Claude Desktop',
              '3. Your .prmd files will be available as MCP tools',
            ];
            break;
          }
        }

        if (options.output) {
          await fs.writeJson(options.output, generatedConfig, { spaces: 2 });
          console.log(chalk.green(`Config written to: ${options.output}`));
        } else {
          console.log(chalk.cyan(`MCP Configuration (${options.format}):`));
          console.log(JSON.stringify(generatedConfig, null, 2));
        }

        console.log();
        for (const line of instructions) {
          if (line === '') {
            console.log();
          } else if (line.startsWith('To use')) {
            console.log(chalk.yellow(line));
          } else {
            console.log(chalk.gray(line));
          }
        }

      } catch (error) {
        console.error(chalk.red('Error generating config:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Add subcommands
  command.addCommand(startCommand);
  command.addCommand(addCommand);
  command.addCommand(removeCommand);
  command.addCommand(listCommand);
  command.addCommand(configCommand);

  return command;
}