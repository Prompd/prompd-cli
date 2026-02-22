import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { LLMResponse, ExecuteOptions } from '../types';
import { ConfigManager } from './config';
import { PrompdCompiler } from './compiler';
import {
  createProvider,
  listKnownProviders,
  getProviderConfig,
  isKnownProvider
} from './providers';
import type { CustomProviderOptions } from './providers';
import pkg from '../../package.json';

export class PrompdExecutor {
  private configManager = ConfigManager.getInstance();

  async execute(filePath: string, options: ExecuteOptions): Promise<LLMResponse> {
    const config = await this.configManager.loadConfig();

    // Load parameters from files if specified
    let params = options.params || {};
    if (options.paramFiles) {
      for (const paramFile of options.paramFiles) {
        const fileParams = await this.loadParametersFromFile(paramFile);
        params = { ...fileParams, ...params }; // CLI params take precedence
      }
    }

    // Compile through the full 6-stage pipeline
    // Handles: parsing, parameter validation, Nunjucks templates ({% for %}, filters),
    // inheritance, context resolution, includes, section overrides, and output formatting
    const compiler = new PrompdCompiler();

    // Make params available as both {{ param_name }} and {{ workflow.param_name }}
    // The workflow. prefix is a namespace convention used in .prmd templates within workflows
    const compilationParams = { ...params, workflow: { ...params } };

    let content = await compiler.compile(filePath, {
      outputFormat: 'markdown',
      parameters: compilationParams,
      verbose: options.verbose,
      registryUrl: options.registryUrl,
      workspaceRoot: options.workspaceRoot,
      fileSystem: options.fileSystem
    });

    // Apply metadata overrides if provided (CLI --meta-system/context/user flags)
    if (options.metaSystem || options.metaContext || options.metaUser) {
      content = this.applyMetadataOverrides(
        content,
        filePath,
        options.metaSystem,
        options.metaContext,
        options.metaUser,
        options.verbose
      );
    }

    // Get API key
    const apiKey = options.apiKey || this.configManager.getApiKey(options.provider, config);
    if (!apiKey && options.provider !== 'ollama') {
      throw new Error(`API key required for provider ${options.provider}`);
    }

    if (options.verbose) {
      console.log(`Executing ${filePath} with ${options.provider}/${options.model}`);
      console.log('Parameters:', params);
      console.log('');
    }

    // Execute compiled content with LLM
    return await this.callLLM(options.provider, options.model, content, apiKey);
  }

  /**
   * Execute raw text (txt/md) by wrapping it with minimal frontmatter,
   * writing a temp .prmd file, running it through the standard pipeline,
   * then cleaning up.
   */
  async executeRawText(text: string, options: ExecuteOptions): Promise<LLMResponse> {
    const prmdContent = normalizeToPrompd();

    // Write to a temp .prmd file so the compiler can process it normally
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `prompd-raw-${Date.now()}.prmd`);

    // Pass raw text as the 'input' parameter for {{ input }} in the template
    const optionsWithInput = {
      ...options,
      params: { ...options.params, input: text }
    };

    try {
      await fs.writeFile(tmpFile, prmdContent, 'utf-8');
      return await this.execute(tmpFile, optionsWithInput);
    } finally {
      await fs.remove(tmpFile).catch(() => { /* ignore cleanup errors */ });
    }
  }

  private async loadParametersFromFile(filename: string): Promise<Record<string, string>> {
    const content = await fs.readFile(filename, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * Resolve a provider to a createProvider-compatible config.
   * Checks known providers first, then custom providers from user config.
   */
  private async resolveCustomProvider(provider: string): Promise<CustomProviderOptions | undefined> {
    // Known providers are handled natively by createProvider — no custom config needed
    if (isKnownProvider(provider)) {
      return undefined;
    }

    // Check custom providers from user config (~/.prompd/config.yaml)
    const config = await this.configManager.loadConfig();
    const custom = config.customProviders?.[provider];
    if (custom?.enabled && custom.baseUrl) {
      return {
        name: provider,
        displayName: provider,
        baseUrl: custom.baseUrl,
        models: custom.models
      };
    }

    // Check provider_configs for base URL overrides
    const providerConfig = config.providerConfigs?.[provider];
    if (providerConfig?.baseUrl) {
      return {
        name: provider,
        displayName: provider,
        baseUrl: providerConfig.baseUrl
      };
    }

    throw new Error(
      `Unknown provider: ${provider}. ` +
      `Known: ${listKnownProviders().join(', ')}. ` +
      `Custom providers can be added in ~/.prompd/config.yaml under custom_providers.`
    );
  }

  private async callLLM(providerName: string, model: string, content: string, apiKey?: string): Promise<LLMResponse> {
    const customConfig = await this.resolveCustomProvider(providerName);
    const provider = createProvider(providerName, customConfig);

    const result = await provider.execute({
      prompt: content,
      model,
      apiKey: apiKey || '',
      maxTokens: 4096,
      temperature: 0.7
    });

    if (!result.success) {
      throw new Error(result.error || 'LLM execution failed');
    }

    return {
      success: true,
      response: result.response || '',
      content: result.response || '',
      usage: result.usage ? {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens
      } : undefined
    };
  }

  getAvailableProviders(): string[] {
    return listKnownProviders();
  }

  getProviderModels(provider: string): string[] {
    const config = getProviderConfig(provider);
    if (config) {
      return config.models.map(m => m.id);
    }
    return [];
  }

  private applyMetadataOverrides(
    originalContent: string,
    filePath: string,
    metaSystem?: string,
    metaContext?: string,
    metaUser?: string,
    verbose?: boolean
  ): string {
    const lines = originalContent.split('\n');
    const result: string[] = [];
    let currentSection = '';

    for (const line of lines) {
      if (line.startsWith('## ')) {
        const sectionName = line.substring(3).trim().toLowerCase();
        currentSection = sectionName;

        // Add the header
        result.push(line);

        // Add override content if available
        let overrideContent = '';
        switch (currentSection) {
          case 'system':
            if (metaSystem) {
              overrideContent = this.resolveMetadataValue(metaSystem, filePath, verbose);
              currentSection = 'skip'; // Skip original content
            }
            break;
          case 'context':
            if (metaContext) {
              overrideContent = this.resolveMetadataValue(metaContext, filePath, verbose);
              currentSection = 'skip'; // Skip original content
            }
            break;
          case 'user':
            if (metaUser) {
              overrideContent = this.resolveMetadataValue(metaUser, filePath, verbose);
              currentSection = 'skip'; // Skip original content
            }
            break;
        }

        if (overrideContent) {
          result.push(...overrideContent.split('\n'));
        }
      } else if (currentSection === 'skip' && line.startsWith('## ')) {
        // New section found, stop skipping
        currentSection = '';
        result.push(line);
      } else if (currentSection !== 'skip') {
        // Add original line if not skipping
        result.push(line);
      }
    }

    return result.join('\n');
  }

  private resolveMetadataValue(value: string, filePath: string, verbose?: boolean): string {
    // Check if it's a file path
    if (value.startsWith('./') || value.startsWith('/') || (value.length > 1 && value[1] === ':')) {
      let resolvedPath = value;
      if (value.startsWith('./')) {
        // Relative path - resolve relative to current file
        const currentDir = path.dirname(filePath);
        resolvedPath = path.join(currentDir, value.substring(2));
      }

      try {
        const content = fs.readFileSync(resolvedPath, 'utf-8');
        if (verbose) {
          console.log(`Loaded content from ${resolvedPath}`);
        }
        return content;
      } catch (error) {
        console.error(`Error reading file '${resolvedPath}': ${error instanceof Error ? error.message : error}`);
        return value; // Return original value as fallback
      }
    }

    // Direct text content
    return value;
  }
}

/**
 * Normalize raw text into a valid .prmd format with required frontmatter.
 * The text is passed as the `input` parameter and rendered via {{ input }}.
 */
export function normalizeToPrompd(): string {
  return `---
id: prompd-ask
name: "Prompd Ask"
version: "${pkg.version}"
description: "Prompd Ask wrapping user's prompd ask"
parameters:
  - name: input
    required: true
    description: "The users input"
---

## User
{{ input }}
`;
}
