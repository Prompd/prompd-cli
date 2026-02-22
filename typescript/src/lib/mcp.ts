// Import MCP SDK dynamically since it's an ES module.
// Use indirect import() to prevent TypeScript from converting to require() in CJS output.
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as glob from 'glob';
import { PrompdParser } from './parser';
import { PrompdExecutor } from './executor';
import { PrompdCompiler } from './compiler';
import { ConfigManager } from './config';
import { RegistryClient } from './registry';
import { WorkflowExecutor, PrompdFlowDocument, FlowParameter } from './workflow';
import { SecurityManager, MCPSecurityMiddleware } from './security';
import { PrompdFile, PrompdParameter } from '../types';

/**
 * Definitions for built-in MCP tools that wrap CLI operations.
 * These are always available regardless of what .prmd files are registered.
 */
const BUILTIN_TOOLS = [
  {
    name: 'prompd_compile',
    description: 'Compile a .prmd file or package reference using the 6-stage compilation pipeline. Returns the rendered prompt with parameters substituted and templates processed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        source: { type: 'string', description: 'Path to .prmd file or package reference (@namespace/package@version)' },
        format: { type: 'string', description: 'Output format: markdown | provider-json:openai | provider-json:anthropic', default: 'markdown' },
        parameters: { type: 'object', description: 'Key-value parameters to substitute in the prompt', additionalProperties: true },
      },
      required: ['source'],
    },
  },
  {
    name: 'prompd_run',
    description: 'Execute a .prmd prompt file with an LLM provider and return the response. Requires a configured API key for the chosen provider.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file: { type: 'string', description: 'Path to the .prmd file to execute' },
        provider: { type: 'string', description: 'LLM provider: openai, anthropic, ollama' },
        model: { type: 'string', description: 'Model name (e.g., gpt-4, claude-3-sonnet)' },
        parameters: { type: 'object', description: 'Key-value parameters for the prompt', additionalProperties: true },
      },
      required: ['file'],
    },
  },
  {
    name: 'prompd_search',
    description: 'Search the Prompd package registry for available packages matching a query.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query string' },
        limit: { type: 'number', description: 'Maximum number of results (default: 20)' },
        registry: { type: 'string', description: 'Specific registry name to search (optional)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'prompd_show',
    description: 'Show the structure, metadata, and parameters of a .prmd file. Useful for understanding what a prompt expects before calling it.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file: { type: 'string', description: 'Path to the .prmd file to inspect' },
      },
      required: ['file'],
    },
  },
  {
    name: 'prompd_list',
    description: 'List available .prmd files in a directory (defaults to current directory). Returns file names, descriptions, and parameters.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: { type: 'string', description: 'Directory to search for .prmd files (default: current directory)' },
        detailed: { type: 'boolean', description: 'Include full details for each file' },
      },
      required: [],
    },
  },
  {
    name: 'prompd_explain',
    description: 'Get detailed information about a .prmd file, .pdpkg package, or registry package (@namespace/name). Shows metadata, parameters, sections, file info, and available versions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        target: { type: 'string', description: '.prmd file path, .pdpkg package path, or registry package (@namespace/name)' },
        detailed: { type: 'boolean', description: 'Show extended details' },
        sections: { type: 'boolean', description: 'Show section content previews (for .prmd files)' },
      },
      required: ['target'],
    },
  },
  {
    name: 'prompd_validate',
    description: 'Validate a .prmd file for syntax errors, structural issues, and best practice violations. Returns errors, warnings, and info messages.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file: { type: 'string', description: 'Path to the .prmd file to validate' },
      },
      required: ['file'],
    },
  },
] as const;

export interface MCPServerConfig {
  name: string;
  version: string;
  execute?: boolean;
  provider?: string;
  model?: string;
  apiKey?: string;
  allowedTools?: string[];
  maxRequestSize?: number;
}

export class PrompdMCPServer {
  private server: any;
  private parser: PrompdParser;
  private executor?: PrompdExecutor;
  private workflowExecutor: WorkflowExecutor;
  private registeredTools: Map<string, { prompd: PrompdFile; filePath: string }>;
  private registeredWorkflows: Map<string, PrompdFlowDocument>;
  private config: MCPServerConfig;
  private mcpSdk: any;
  private securityMiddleware: MCPSecurityMiddleware;

  constructor(config: MCPServerConfig) {
    this.config = config;
    this.parser = new PrompdParser();
    this.workflowExecutor = new WorkflowExecutor();
    this.registeredTools = new Map();
    this.registeredWorkflows = new Map();
    this.securityMiddleware = new MCPSecurityMiddleware();

    // Initialize executor if execution is enabled
    if (config.execute) {
      this.executor = new PrompdExecutor();
    }
  }

  private async initializeMCP() {
    // Dynamic import of MCP SDK
    const serverModule = await dynamicImport('@modelcontextprotocol/sdk/server/index.js');
    
    // Initialize MCP server
    this.server = new serverModule.Server({
      name: this.config.name || 'prompd-mcp-server',
      version: this.config.version || '0.2.3',
    }, {
      capabilities: {
        tools: {}
      }
    });

    await this.setupHandlers();
  }

  private async setupHandlers() {
    // Dynamic import for schemas
    const typesModule = await dynamicImport('@modelcontextprotocol/sdk/types.js');

    // List available tools
    this.server.setRequestHandler(typesModule.ListToolsRequestSchema, async () => {
      const tools = [];

      // Add built-in CLI tools first
      for (const builtin of BUILTIN_TOOLS) {
        tools.push({
          name: builtin.name,
          description: builtin.description,
          inputSchema: builtin.inputSchema,
        });
      }

      // Add registered prompt tools
      for (const [name, entry] of this.registeredTools.entries()) {
        const desc = entry.prompd.metadata.description || `Execute ${name} prompt`;
        const templateNote = this.config.execute ? '' : ' Returns a fully rendered prompt for the LLM to follow as instructions.';
        tools.push({
          name,
          description: desc + templateNote,
          inputSchema: this.createInputSchema(entry.prompd)
        });
      }

      // Add registered workflow tools
      for (const [name, workflow] of this.registeredWorkflows.entries()) {
        tools.push({
          name,
          description: workflow.metadata.description || `Execute ${name} workflow`,
          inputSchema: this.createWorkflowInputSchema(workflow)
        });
      }

      return { tools };
    });

    // Execute tool
    this.server.setRequestHandler(typesModule.CallToolRequestSchema, async (request: any) => {
      // Security validation
      try {
        this.securityMiddleware.validateRequest(request);
      } catch (error) {
        throw new Error(`Security validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      const { name, arguments: args } = request.params;

      // Security: Check request size
      const requestSize = JSON.stringify(args).length;
      if (this.config.maxRequestSize && requestSize > this.config.maxRequestSize) {
        throw new Error('Request too large');
      }

      // Check if this is a built-in tool
      const builtinResult = await this.handleBuiltinTool(name, args || {});
      if (builtinResult !== null) {
        return builtinResult;
      }

      // Sanitize and validate tool name for registered tools
      let sanitizedName: string;
      try {
        sanitizedName = SecurityManager.sanitizeToolName(name);
      } catch (error) {
        throw new Error(`Invalid tool name: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Check if it's a prompt or workflow
      const isWorkflow = this.registeredWorkflows.has(sanitizedName);
      const isPrompt = this.registeredTools.has(sanitizedName);

      if (!isWorkflow && !isPrompt) {
        throw new Error(`Tool '${sanitizedName}' not found`);
      }

      // Security: Check allowed tools
      if (this.config.allowedTools && !this.config.allowedTools.includes(sanitizedName)) {
        throw new Error(`Tool '${sanitizedName}' not allowed`);
      }

      try {
        if (isWorkflow) {
          // Execute workflow
          const workflow = this.registeredWorkflows.get(sanitizedName)!;
          this.validateWorkflowParameters(workflow, args || {});

          const result = await this.workflowExecutor.executeWorkflow(workflow, args || {});

          if (result.success) {
            return {
              content: [
                {
                  type: 'text',
                  text: result.result || 'Workflow completed successfully'
                }
              ]
            };
          } else {
            return {
              content: [
                {
                  type: 'text',
                  text: `Workflow failed: ${result.error || 'Unknown error'}\nErrors: ${result.errors.map(e => `${e.nodeId}: ${e.message}`).join(', ')}`
                }
              ]
            };
          }
        } else {
          // Execute prompt
          const entry = this.registeredTools.get(sanitizedName)!;
          this.validateParameters(entry.prompd, args || {});

          if (this.config.execute && this.executor) {
            // Execute with LLM using original file path (compiler resolves includes/inheritance)
            const result = await this.executeWithLLM(entry.filePath, args || {});
            return {
              content: [
                {
                  type: 'text',
                  text: result.response || result.error || 'No response'
                }
              ]
            };
          } else {
            // Compile with full pipeline (Nunjucks, includes, inheritance)
            const renderedPrompt = await this.compilePrompt(entry.filePath, args || {});
            return {
              content: [
                {
                  type: 'text',
                  text: `[INSTRUCTIONS: Use the following rendered prompt as your guide to complete the user's request.]\n\n${renderedPrompt}`
                }
              ]
            };
          }
        }
      } catch (error) {
        throw new Error(`Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    });
  }

  /**
   * Handle built-in CLI tool calls. Returns null if the tool name doesn't match a built-in.
   */
  private async handleBuiltinTool(name: string, args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[] } | null> {
    switch (name) {
      case 'prompd_compile':
        return this.handleCompile(args);
      case 'prompd_run':
        return this.handleRun(args);
      case 'prompd_search':
        return this.handleSearch(args);
      case 'prompd_show':
        return this.handleShow(args);
      case 'prompd_list':
        return this.handleList(args);
      case 'prompd_explain':
        return this.handleExplain(args);
      case 'prompd_validate':
        return this.handleValidate(args);
      default:
        return null;
    }
  }

  private textResult(text: string): { content: { type: string; text: string }[] } {
    return { content: [{ type: 'text', text }] };
  }

  private async handleCompile(args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[] }> {
    const source = args.source as string;
    if (!source) throw new Error('source is required');

    const compiler = new PrompdCompiler();
    const result = await compiler.compile(source, {
      outputFormat: (args.format as string) || 'markdown',
      parameters: (args.parameters as Record<string, unknown>) || {},
    });

    return this.textResult(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  }

  private async handleRun(args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[] }> {
    const file = args.file as string;
    if (!file) throw new Error('file is required');

    const configManager = ConfigManager.getInstance();
    const config = await configManager.loadConfig();

    const provider = (args.provider as string) || this.config.provider || configManager.getDefaultProvider(config);
    const model = (args.model as string) || this.config.model || configManager.getDefaultModel(provider, config);

    const executor = new PrompdExecutor();
    const response = await executor.execute(file, {
      provider,
      model,
      apiKey: this.config.apiKey,
      params: (args.parameters as Record<string, string>) || {},
    });

    const responseText = response.response || response.content || 'No response received';
    const result: Record<string, unknown> = { response: responseText, provider, model };
    if (response.usage) result.usage = response.usage;

    return this.textResult(JSON.stringify(result, null, 2));
  }

  private async handleSearch(args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[] }> {
    const query = args.query as string;
    if (!query) throw new Error('query is required');

    const client = new RegistryClient(args.registry as string | undefined);
    const results = await client.search({
      query,
      limit: (args.limit as number) || 20,
    });

    if (results.packages.length === 0) {
      return this.textResult(`No packages found for: ${query}`);
    }

    const lines = [`Found ${results.packages.length} package(s) for "${query}":\n`];
    for (const pkg of results.packages) {
      lines.push(`${pkg.name} v${pkg.version}`);
      lines.push(`  ${pkg.description || 'No description'}`);
      if (pkg.author) lines.push(`  Author: ${pkg.author}`);
      lines.push('');
    }

    return this.textResult(lines.join('\n'));
  }

  private async handleShow(args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[] }> {
    const file = args.file as string;
    if (!file) throw new Error('file is required');

    const parser = new PrompdParser();
    const prompd = await parser.parseFile(file);
    const metadata = prompd.metadata;

    const lines: string[] = [];
    lines.push(`=== ${metadata.name || 'Unnamed'} ===`);
    if (metadata.version) lines.push(`Version: ${metadata.version}`);
    if (metadata.description) lines.push(`\nDescription:\n  ${metadata.description}\n`);

    const allParams = [...(metadata.parameters || []), ...(metadata.variables || [])];
    if (allParams.length > 0) {
      lines.push('Parameters:');
      for (const param of allParams) {
        const required = param.required ? ' (required)' : '';
        lines.push(`  - ${param.name} (${param.type})${required}`);
        if (param.description) lines.push(`    ${param.description}`);
        if (param.default !== undefined) lines.push(`    Default: ${JSON.stringify(param.default)}`);
        if (param.pattern) lines.push(`    Pattern: ${param.pattern}`);
        if (param.enum) lines.push(`    Enum: ${param.enum.join(', ')}`);
      }
    }

    const sectionKeys = Object.keys(prompd.sections);
    if (sectionKeys.length > 0) {
      lines.push('\nSections:');
      for (const key of sectionKeys) lines.push(`  - #${key}`);
    }

    return this.textResult(lines.join('\n'));
  }

  private async handleList(args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[] }> {
    const detailed = args.detailed as boolean;

    // When no directory specified, search both global and local cache dirs
    const explicitDir = args.directory as string | undefined;
    const searchDirs: string[] = [];
    if (explicitDir) {
      searchDirs.push(path.resolve(explicitDir));
    } else {
      const globalCache = path.join(os.homedir(), '.prompd', 'cache');
      const localCache = path.join(process.cwd(), '.prompd', 'cache');
      if (fs.existsSync(globalCache)) searchDirs.push(globalCache);
      if (fs.existsSync(localCache) && localCache !== globalCache) searchDirs.push(localCache);
      // Also search cwd if it has .prmd files directly
      searchDirs.push(process.cwd());
    }

    const files: string[] = [];
    const seen = new Set<string>();
    for (const dir of searchDirs) {
      const pattern = path.join(dir, '**/*.prmd').replace(/\\/g, '/');
      for (const f of glob.sync(pattern)) {
        const normalized = path.resolve(f);
        if (!seen.has(normalized)) {
          seen.add(normalized);
          files.push(f);
        }
      }
    }

    if (files.length === 0) {
      const searchedLabel = explicitDir ? path.resolve(explicitDir) : searchDirs.join(', ');
      return this.textResult(`No .prmd files found in ${searchedLabel}`);
    }

    const parser = new PrompdParser();
    const searchedLabel = explicitDir ? path.resolve(explicitDir) : searchDirs.join(', ');
    const lines: string[] = [`Found ${files.length} .prmd file(s) in ${searchedLabel}:\n`];

    for (const file of files) {
      try {
        const prompd = await parser.parseFile(file);
        const metadata = prompd.metadata;
        const name = metadata.name || path.basename(file, '.prmd');

        if (detailed) {
          lines.push(`${name}`);
          lines.push(`  File: ${file}`);
          if (metadata.description) lines.push(`  Description: ${metadata.description}`);
          if (metadata.version) lines.push(`  Version: ${metadata.version}`);
          if (metadata.parameters && metadata.parameters.length > 0) {
            lines.push(`  Parameters: ${metadata.parameters.map(p => p.name).join(', ')}`);
          }
          lines.push('');
        } else {
          const desc = metadata.description
            ? (metadata.description.length > 50 ? metadata.description.substring(0, 47) + '...' : metadata.description)
            : '';
          lines.push(`  ${name} - ${desc}`);
        }
      } catch {
        lines.push(`  ${path.basename(file, '.prmd')} - (parse error)`);
      }
    }

    return this.textResult(lines.join('\n'));
  }

  private async handleExplain(args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[] }> {
    const target = args.target as string;
    if (!target) throw new Error('target is required');

    const lines: string[] = [];

    if (target.endsWith('.prmd')) {
      // Explain .prmd file
      if (!await fs.pathExists(target)) throw new Error(`File not found: ${target}`);

      const parser = new PrompdParser();
      const prompd = await parser.parseFile(target);
      const stats = await fs.stat(target);

      lines.push(`File: ${path.basename(target)}`);
      lines.push(`Path: ${path.resolve(target)}\n`);
      lines.push('Metadata:');
      lines.push(`  ID: ${prompd.metadata.id}`);
      if (prompd.metadata.name) lines.push(`  Name: ${prompd.metadata.name}`);
      if (prompd.metadata.version) lines.push(`  Version: ${prompd.metadata.version}`);
      if (prompd.metadata.description) lines.push(`  Description: ${prompd.metadata.description}`);
      lines.push('');

      const params = prompd.metadata.parameters || [];
      if (params.length > 0) {
        lines.push('Parameters:');
        for (const param of params) {
          const required = param.required ? 'required' : 'optional';
          const defaultVal = param.default !== undefined ? ` (default: ${JSON.stringify(param.default)})` : '';
          lines.push(`  - ${param.name} (${param.type}) ${required}${defaultVal}`);
          if (param.description) lines.push(`    ${param.description}`);
        }
        lines.push('');
      }

      if (args.sections && Object.keys(prompd.sections).length > 0) {
        lines.push('Sections:');
        for (const section of Object.keys(prompd.sections)) lines.push(`  - ${section}`);
        lines.push('');
      }

      lines.push('File Info:');
      lines.push(`  Size: ${stats.size} bytes`);
      lines.push(`  Modified: ${stats.mtime.toISOString()}`);

    } else if (target.startsWith('@') && target.includes('/')) {
      // Explain registry package
      const client = new RegistryClient();
      const info = await client.getPackageInfo(target);
      const versions = await client.getPackageVersions(target);

      lines.push(`Package: ${target}\n`);
      if (info.description) lines.push(`${info.description}\n`);
      lines.push('Package Info:');
      lines.push(`  Name: ${info.name}`);
      if (info.version) lines.push(`  Latest Version: ${info.version}`);
      if (info.author) lines.push(`  Author: ${info.author}`);
      lines.push('');

      if (versions && versions.length > 0) {
        const sorted = versions.sort((a: string, b: string) =>
          b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' })
        );
        const display = (args.detailed as boolean) ? sorted : sorted.slice(0, 10);
        lines.push('Available Versions:');
        display.forEach((v: string, i: number) => {
          lines.push(`  ${i === 0 ? '(latest) ' : ''}${v}`);
        });
        if (!args.detailed && sorted.length > 10) {
          lines.push(`  ... and ${sorted.length - 10} more`);
        }
      }
    } else {
      throw new Error('Target must be a .prmd file or registry package (@namespace/name)');
    }

    return this.textResult(lines.join('\n'));
  }

  private async handleValidate(args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[] }> {
    const file = args.file as string;
    if (!file) throw new Error('file is required');

    const parser = new PrompdParser();
    const issues = await parser.validateFile(file);

    if (issues.length === 0) {
      return this.textResult(`${file} is valid - no issues found.`);
    }

    const errors = issues.filter(i => i.level === 'error');
    const warnings = issues.filter(i => i.level === 'warning');
    const info = issues.filter(i => i.level === 'info');

    const lines: string[] = [];
    if (errors.length > 0) {
      lines.push(`ERRORS (${errors.length}):`);
      for (const issue of errors) lines.push(`  - ${issue.message}`);
    }
    if (warnings.length > 0) {
      lines.push(`WARNINGS (${warnings.length}):`);
      for (const issue of warnings) lines.push(`  - ${issue.message}`);
    }
    if (info.length > 0) {
      lines.push(`INFO (${info.length}):`);
      for (const issue of info) lines.push(`  - ${issue.message}`);
    }

    return this.textResult(lines.join('\n'));
  }

  private createInputSchema(prompd: PrompdFile) {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    // Add prompt parameters
    const allParams = [
      ...(prompd.metadata.parameters || []),
      ...(prompd.metadata.variables || []) // Backward compatibility
    ];

    for (const param of allParams) {
      properties[param.name] = {
        type: this.mapParameterType(param.type),
        description: param.description
      };

      if (param.required) {
        required.push(param.name);
      }

      // Add constraints
      if (param.minimum !== undefined) properties[param.name].minimum = param.minimum;
      if (param.maximum !== undefined) properties[param.name].maximum = param.maximum;
      if (param.pattern) properties[param.name].pattern = param.pattern;
      if (param.enum) properties[param.name].enum = param.enum;
    }

    // Add execution options if in hybrid mode
    if (this.config.execute) {
      properties.provider = {
        type: 'string',
        description: 'LLM provider to use',
        enum: ['openai', 'anthropic', 'ollama']
      };
      properties.model = {
        type: 'string',
        description: 'Model to use for execution'
      };
      properties.execute = {
        type: 'boolean',
        description: 'Whether to execute with LLM or return template',
        default: false
      };
    }

    return {
      type: 'object',
      properties,
      required,
      additionalProperties: false
    };
  }

  private mapParameterType(type: string): string {
    switch (type) {
      case 'string': return 'string';
      case 'number': return 'number';
      case 'boolean': return 'boolean';
      case 'array': return 'array';
      case 'object': return 'object';
      default: return 'string';
    }
  }

  private validateParameters(prompd: PrompdFile, args: Record<string, any>) {
    const allParams = [
      ...(prompd.metadata.parameters || []),
      ...(prompd.metadata.variables || [])
    ];

    for (const param of allParams) {
      const value = args[param.name];

      // Check required parameters
      if (param.required && (value === undefined || value === null)) {
        throw new Error(`Required parameter missing: ${param.name}`);
      }

      if (value !== undefined) {
        // Type validation
        if (!this.validateParameterType(value, param.type)) {
          throw new Error(`Invalid type for parameter '${param.name}': expected ${param.type}`);
        }

        // Pattern validation for strings
        if (param.pattern && typeof value === 'string') {
          if (!new RegExp(param.pattern).test(value)) {
            throw new Error(`Parameter '${param.name}' does not match pattern: ${param.pattern}`);
          }
        }

        // Range validation for numbers
        if (typeof value === 'number') {
          if (param.minimum !== undefined && value < param.minimum) {
            throw new Error(`Parameter '${param.name}' below minimum: ${param.minimum}`);
          }
          if (param.maximum !== undefined && value > param.maximum) {
            throw new Error(`Parameter '${param.name}' above maximum: ${param.maximum}`);
          }
        }

        // Enum validation
        if (param.enum && !param.enum.includes(value)) {
          throw new Error(`Parameter '${param.name}' not in allowed values: ${param.enum.join(', ')}`);
        }
      }
    }
  }

  private validateParameterType(value: any, expectedType: string): boolean {
    switch (expectedType) {
      case 'string': return typeof value === 'string';
      case 'number': return typeof value === 'number';
      case 'boolean': return typeof value === 'boolean';
      case 'array': return Array.isArray(value);
      case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
      default: return true;
    }
  }

  private async compilePrompt(filePath: string, args: Record<string, unknown>): Promise<string> {
    const compiler = new PrompdCompiler();
    const result = await compiler.compile(filePath, {
      outputFormat: 'markdown',
      parameters: args,
    });
    return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  }

  private async executeWithLLM(filePath: string, args: Record<string, unknown>) {
    if (!this.executor) {
      throw new Error('Executor not initialized');
    }

    const executeOptions = {
      provider: this.config.provider || 'openai',
      model: this.config.model || 'gpt-4',
      apiKey: this.config.apiKey,
      params: SecurityManager.sanitizeParameters(args)
    };

    // Execute directly from the original file — the executor runs
    // the full compiler pipeline internally, preserving relative paths
    // for {% include %}, inherits:, context:, etc.
    return await this.executor.execute(filePath, executeOptions);
  }

  async registerTool(name: string, prompdFile: string): Promise<void> {
    try {
      // Security validation
      const sanitizedName = SecurityManager.sanitizeToolName(name);
      const validatedPath = SecurityManager.validateFilePath(prompdFile, ['.prmd']);
      
      // Validate file size
      await SecurityManager.validateFileSize(validatedPath);
      
      const prompd = await this.parser.parseFile(validatedPath);
      this.registeredTools.set(sanitizedName, { prompd, filePath: validatedPath });
    } catch (error) {
      throw new Error(`Failed to register tool '${name}': ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async registerDirectory(directory: string): Promise<void> {
    // Register .prmd files
    const prompdPattern = path.join(directory, '**/*.prmd');
    const prompdFiles = glob.sync(prompdPattern);

    for (const file of prompdFiles) {
      try {
        const prompd = await this.parser.parseFile(file);
        const toolName = prompd.metadata.name || path.basename(file, '.prmd');
        this.registeredTools.set(toolName, { prompd, filePath: file });
      } catch (error) {
        console.warn(`Skipping invalid prompd file ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Register .prmdflow files
    const workflowPattern = path.join(directory, '**/*.prmdflow');
    const workflowFiles = glob.sync(workflowPattern);

    for (const file of workflowFiles) {
      try {
        const workflow = await this.workflowExecutor.loadWorkflow(file);
        const toolName = workflow.metadata.name || path.basename(file, '.prmdflow');
        this.registeredWorkflows.set(toolName, workflow);
      } catch (error) {
        console.warn(`Skipping invalid workflow file ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  async start(): Promise<void> {
    // Initialize MCP components first
    await this.initializeMCP();
    
    // Dynamic import for transport
    const stdioModule = await dynamicImport('@modelcontextprotocol/sdk/server/stdio.js');
    const transport = new stdioModule.StdioServerTransport();
    await this.server.connect(transport);
  }

  async stop(): Promise<void> {
    // Close the server connection
    process.exit(0);
  }

  getRegisteredTools(): string[] {
    const tools = Array.from(this.registeredTools.keys());
    const workflows = Array.from(this.registeredWorkflows.keys());
    return [...tools, ...workflows];
  }

  getRegisteredPrompts(): string[] {
    return Array.from(this.registeredTools.keys());
  }

  getRegisteredWorkflows(): string[] {
    return Array.from(this.registeredWorkflows.keys());
  }

  async registerWorkflow(name: string, workflowFile: string): Promise<void> {
    try {
      // Security validation
      const sanitizedName = SecurityManager.sanitizeToolName(name);
      const validatedPath = SecurityManager.validateFilePath(workflowFile, ['.prmdflow', '.json', '.yaml', '.yml']);
      
      // Validate file size
      await SecurityManager.validateFileSize(validatedPath);
      
      const workflow = await this.workflowExecutor.loadWorkflow(validatedPath);
      
      // Validate workflow complexity and security
      SecurityManager.validateWorkflowComplexity(workflow);
      
      this.registeredWorkflows.set(sanitizedName, workflow);
    } catch (error) {
      throw new Error(`Failed to register workflow '${name}': ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private createWorkflowInputSchema(workflow: PrompdFlowDocument) {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    // Get workflow parameters
    const parameters = this.workflowExecutor.getWorkflowParameters(workflow);

    for (const param of parameters) {
      properties[param.name] = {
        type: this.mapParameterType(param.type),
        description: param.description
      };

      if (param.required) {
        required.push(param.name);
      }
    }

    return {
      type: 'object',
      properties,
      required,
      additionalProperties: false
    };
  }

  private validateWorkflowParameters(workflow: PrompdFlowDocument, args: Record<string, any>) {
    const parameters = this.workflowExecutor.getWorkflowParameters(workflow);

    for (const param of parameters) {
      const value = args[param.name];

      // Check required parameters
      if (param.required && (value === undefined || value === null)) {
        throw new Error(`Required parameter missing: ${param.name}`);
      }

      if (value !== undefined) {
        // Type validation
        if (!this.validateParameterType(value, param.type)) {
          throw new Error(`Invalid type for parameter '${param.name}': expected ${param.type}`);
        }
      }
    }
  }
}