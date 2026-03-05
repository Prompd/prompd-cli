import { PrompdExecutor } from '../src/lib/executor';
import { ConfigManager } from '../src/lib/config';
import { PrompdCompiler } from '../src/lib/compiler';
import { createProvider } from '../src/lib/providers';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

// Mock ConfigManager (but NOT the compiler - we need it to read temp files)
jest.mock('../src/lib/config');

// Mock providers module to intercept LLM calls
jest.mock('../src/lib/providers', () => {
  const original = jest.requireActual('../src/lib/providers');
  return {
    ...original,
    createProvider: jest.fn()
  };
});

const mockCreateProvider = createProvider as jest.Mock;

describe('PrompdExecutor', () => {
  let executor: PrompdExecutor;
  let mockConfigManager: jest.Mocked<ConfigManager>;
  let tempDir: string;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create a temp directory with a real .prmd file
    tempDir = path.join(os.tmpdir(), 'prompd-executor-test-' + Date.now());
    await fs.ensureDir(tempDir);

    mockConfigManager = {
      loadConfig: jest.fn(),
      getApiKey: jest.fn(),
      isProviderConfigured: jest.fn(),
    } as any;

    (ConfigManager.getInstance as jest.Mock).mockReturnValue(mockConfigManager);

    executor = new PrompdExecutor();
  });

  afterEach(async () => {
    await fs.remove(tempDir).catch(() => {});
  });

  describe('execute', () => {
    it('should execute with OpenAI provider', async () => {
      // Create a real temp .prmd file
      const prmdContent = `---
id: test-prompt
name: test-prompt
version: 1.0.0
parameters:
  - name: topic
    type: string
    required: true
---

# User

Discuss the topic: {{ topic }}`;

      const testFile = path.join(tempDir, 'test.prmd');
      await fs.writeFile(testFile, prmdContent, 'utf-8');

      const mockConfig = {
        defaultProvider: 'openai',
        defaultModel: 'gpt-4',
        apiKeys: { openai: 'test-key' },
        customProviders: {},
        providerConfigs: {},
        registry: { default: 'prompdhub', registries: {} },
        scopes: {}
      };

      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.getApiKey.mockReturnValue('test-key');

      // Mock provider to return a successful response
      const mockProvider = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          response: 'Test response from OpenAI',
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
        })
      };
      mockCreateProvider.mockReturnValue(mockProvider);

      const result = await executor.execute(testFile, {
        provider: 'openai',
        model: 'gpt-4',
        params: { topic: 'AI' }
      });

      expect(result.success).toBe(true);
      expect(result.response).toBe('Test response from OpenAI');
      expect(mockCreateProvider).toHaveBeenCalledWith('openai', undefined);
      expect(mockProvider.execute).toHaveBeenCalled();
    });

    it('should compile templates with parameter substitution', async () => {
      // Create a temp .prmd file with a parameter
      const prmdContent = `---
id: test-prompt
name: test-prompt
version: 1.0.0
parameters:
  - name: topic
    type: string
    required: true
---

# User

Discuss the topic: {{ topic }}`;

      const testFile = path.join(tempDir, 'test.prmd');
      await fs.writeFile(testFile, prmdContent, 'utf-8');

      // Use the compiler directly to verify template substitution
      const compiler = new PrompdCompiler();
      const result = await compiler.compile(testFile, {
        outputFormat: 'markdown',
        parameters: { topic: 'Machine Learning' }
      });

      expect(result).toContain('Discuss the topic: Machine Learning');
    });

    it('should handle API errors gracefully', async () => {
      const prmdContent = `---
id: test-prompt
name: test-prompt
version: 1.0.0
parameters:
  - name: topic
    type: string
    required: true
---

# User

Discuss the topic: {{ topic }}`;

      const testFile = path.join(tempDir, 'test.prmd');
      await fs.writeFile(testFile, prmdContent, 'utf-8');

      const mockConfig = {
        defaultProvider: 'openai',
        defaultModel: 'gpt-4',
        apiKeys: { openai: 'test-key' },
        customProviders: {},
        providerConfigs: {},
        registry: { default: 'prompdhub', registries: {} },
        scopes: {}
      };

      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.getApiKey.mockReturnValue('test-key');

      // Mock provider to return an error response
      const mockProvider = {
        execute: jest.fn().mockResolvedValue({
          success: false,
          error: 'HTTP 401: Unauthorized'
        })
      };
      mockCreateProvider.mockReturnValue(mockProvider);

      // Executor throws when provider returns success: false
      await expect(
        executor.execute(testFile, {
          provider: 'openai',
          model: 'gpt-4',
          params: { topic: 'AI' }
        })
      ).rejects.toThrow(/401|unauthorized/i);
    });

    it('should work with Anthropic provider', async () => {
      const prmdContent = `---
id: test-prompt
name: test-prompt
version: 1.0.0
parameters:
  - name: topic
    type: string
    required: true
---

# User

Discuss the topic: {{ topic }}`;

      const testFile = path.join(tempDir, 'test.prmd');
      await fs.writeFile(testFile, prmdContent, 'utf-8');

      const mockConfig = {
        defaultProvider: 'anthropic',
        defaultModel: 'claude-3-sonnet-20240229',
        apiKeys: { anthropic: 'test-key' },
        customProviders: {},
        providerConfigs: {},
        registry: { default: 'prompdhub', registries: {} },
        scopes: {}
      };

      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.getApiKey.mockReturnValue('test-key');

      // Mock provider to return a successful response
      const mockProvider = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          response: 'Test response from Anthropic',
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
        })
      };
      mockCreateProvider.mockReturnValue(mockProvider);

      const result = await executor.execute(testFile, {
        provider: 'anthropic',
        model: 'claude-3-5-haiku-20241022',
        params: { topic: 'AI' }
      });

      expect(result.success).toBe(true);
      expect(result.response).toBe('Test response from Anthropic');
      expect(mockCreateProvider).toHaveBeenCalledWith('anthropic', undefined);
    });
  });
});
