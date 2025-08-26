import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { PrompdMCPServer, MCPServerConfig } from '../lib/mcp';
import { ConfigManager } from '../lib/config';
import { SecurityManager } from '../lib/security';

export function createMCPCommand(): Command {
  const command = new Command('mcp');
  command.description('Model Context Protocol (MCP) server operations');

  // Start MCP server
  const startCommand = new Command('start');
  startCommand
    .description('Start MCP server to expose .prompd files as tools')
    .option('-d, --directory <dir>', 'Directory containing .prompd files', '.')
    .option('-t, --tool <name:file>', 'Register specific tool (format: name:file.prompd)', [])
    .option('--execute', 'Execute prompts with LLM (default: return templates)')
    .option('--provider <provider>', 'Default LLM provider when executing')
    .option('--model <model>', 'Default model when executing')
    .option('--api-key <key>', 'API key override')
    .option('--allowed-tools <tools>', 'Comma-separated list of allowed tool names')
    .option('--max-request-size <bytes>', 'Maximum request size in bytes', '10000')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (options) => {
      try {
        console.log(chalk.cyan('Starting Prompd MCP Server...'));
        
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

        // Register tools from directory
        if (options.directory) {
          console.log(chalk.blue(`Registering tools from: ${options.directory}`));
          await server.registerDirectory(options.directory);
        }

        // Register specific tools
        if (options.tool && options.tool.length > 0) {
          for (const toolSpec of options.tool) {
            const [name, file] = toolSpec.split(':');
            if (!name || !file) {
              console.error(chalk.red(`Invalid tool specification: ${toolSpec}. Use format 'name:file.prompd'`));
              continue;
            }
            console.log(chalk.blue(`Registering tool: ${name} -> ${file}`));
            await server.registerTool(name, file);
          }
        }

        const registeredPrompts = server.getRegisteredPrompts();
        const registeredWorkflows = server.getRegisteredWorkflows();
        const totalTools = registeredPrompts.length + registeredWorkflows.length;
        
        console.log(chalk.green(`✓ Registered ${totalTools} tools:`));
        
        if (registeredPrompts.length > 0) {
          console.log(chalk.blue('  Prompts:'));
          for (const tool of registeredPrompts) {
            console.log(chalk.gray(`    - ${tool}`));
          }
        }
        
        if (registeredWorkflows.length > 0) {
          console.log(chalk.blue('  Workflows:'));
          for (const tool of registeredWorkflows) {
            console.log(chalk.gray(`    - ${tool} (workflow)`));
          }
        }

        if (options.execute) {
          console.log(chalk.yellow(`⚡ Execution mode enabled (${serverConfig.provider}/${serverConfig.model})`));
        } else {
          console.log(chalk.blue('📝 Template mode (returning rendered prompts)'));
        }

        console.log(chalk.cyan('MCP Server ready on stdio'));
        console.log(chalk.gray('Waiting for MCP client connections...'));

        if (options.verbose) {
          console.log(chalk.gray('Server configuration:'));
          console.log(chalk.gray(JSON.stringify(serverConfig, null, 2)));
        }

        // Start server
        await server.start();

      } catch (error) {
        console.error(chalk.red('Error starting MCP server:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Add tool registration
  const addCommand = new Command('add');
  addCommand
    .description('Add a .prompd file or workflow to MCP server configuration')
    .argument('<type>', 'Type: "prompt" or "workflow"')
    .argument('<name>', 'Tool name for MCP')  
    .argument('[file]', 'Path to .prompd or .prompdflow file (optional for workflows)')
    .option('--config-file <file>', 'MCP configuration file', path.join(os.homedir(), '.prompd', 'mcp-config.json'))
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
            `./workflows/${sanitizedName}.prompdflow`,
            `./${sanitizedName}.prompdflow`,
            `./flows/${sanitizedName}.prompdflow`
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
        if (type === 'prompt' && !resolvedFile.endsWith('.prompd')) {
          console.error(chalk.red('Prompt files must have .prompd extension'));
          process.exit(1);
        }
        if (type === 'workflow' && !resolvedFile.endsWith('.prompdflow')) {
          console.error(chalk.red('Workflow files must have .prompdflow extension'));
          process.exit(1);
        }

        // Load or create config
        const configPath = options?.configFile || path.join(os.homedir(), '.prompd', 'mcp-config.json');
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
    .option('--config-file <file>', 'MCP configuration file', path.join(os.homedir(), '.prompd', 'mcp-config.json'))
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
    .option('--config-file <file>', 'MCP configuration file', path.join(os.homedir(), '.prompd', 'mcp-config.json'))
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

  // Generate Claude Desktop config
  const configCommand = new Command('config');
  configCommand
    .description('Generate Claude Desktop MCP configuration')
    .option('--config-file <file>', 'MCP configuration file', path.join(os.homedir(), '.prompd', 'mcp-config.json'))
    .option('--output <file>', 'Output file for Claude Desktop config')
    .option('--server-name <name>', 'MCP server name', 'prompd')
    .action(async (options) => {
      try {
        const configPath = options.configFile;
        
        if (!await fs.pathExists(configPath)) {
          console.error(chalk.red(`Config file not found: ${configPath}`));
          process.exit(1);
        }

        // Generate Claude Desktop MCP configuration
        const claudeConfig = {
          mcpServers: {
            [options.serverName]: {
              command: 'prompd',
              args: ['mcp', 'start'],
              env: {}
            }
          }
        };

        if (options.output) {
          await fs.writeJson(options.output, claudeConfig, { spaces: 2 });
          console.log(chalk.green(`✓ Claude Desktop config written to: ${options.output}`));
        } else {
          console.log(chalk.cyan('Claude Desktop MCP Configuration:'));
          console.log(JSON.stringify(claudeConfig, null, 2));
        }

        console.log();
        console.log(chalk.yellow('To use with Claude Desktop:'));
        console.log(chalk.gray('1. Add this configuration to your Claude Desktop settings'));
        console.log(chalk.gray('2. Restart Claude Desktop'));
        console.log(chalk.gray('3. Your .prompd files will be available as MCP tools'));

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