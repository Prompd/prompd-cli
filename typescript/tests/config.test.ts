// Mock fs-extra before importing ConfigManager
const mockPathExists = jest.fn();
const mockReadFile = jest.fn();
const mockWriteFile = jest.fn();
const mockEnsureDir = jest.fn();

jest.mock('fs-extra', () => ({
  pathExists: mockPathExists,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  ensureDir: mockEnsureDir
}));

import { ConfigManager } from '../src/lib/config';

const mockFs = {
  pathExists: mockPathExists,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  ensureDir: mockEnsureDir
};

describe('ConfigManager', () => {
  let configManager: ConfigManager;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset singleton
    (ConfigManager as any).instance = null;
    configManager = ConfigManager.getInstance();

    // Mock environment variables
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.PROMPD_DEFAULT_PROVIDER = 'openai';
    process.env.PROMPD_DEFAULT_MODEL = 'gpt-4';
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.PROMPD_DEFAULT_PROVIDER;
    delete process.env.PROMPD_DEFAULT_MODEL;
  });

  describe('loadConfig', () => {
    it('should load config with environment variables', async () => {
      mockFs.pathExists.mockResolvedValue(false);

      const config = await configManager.loadConfig();

      expect(config.apiKeys.openai).toBe('test-openai-key');
      expect(config.apiKeys.anthropic).toBe('test-anthropic-key');
      expect(config.defaultProvider).toBe('openai');
      expect(config.defaultModel).toBe('gpt-4');
    });

    it('should load config from file when available', async () => {
      const configContent = `
apiKeys:
  openai: file-openai-key
customProviders:
  local:
    baseUrl: http://localhost:8080
    models: [model1, model2]
    enabled: true
`;

      mockFs.pathExists.mockImplementation(async (path: string) => {
        return path.includes('config.yaml');
      });
      mockFs.readFile.mockResolvedValue(configContent);

      const config = await configManager.loadConfig();

      expect(config.apiKeys.openai).toBe('test-openai-key'); // Env overrides file
      expect(config.customProviders.local).toBeDefined();
      expect(config.customProviders.local.baseUrl).toBe('http://localhost:8080');
    });

    it('should handle missing config files gracefully', async () => {
      mockFs.pathExists.mockResolvedValue(false);

      const config = await configManager.loadConfig();

      expect(config).toBeDefined();
      expect(config.apiKeys).toBeDefined();
      expect(config.customProviders).toBeDefined();
    });
  });

  describe('getApiKey', () => {
    it('should return API key from config', async () => {
      mockFs.pathExists.mockResolvedValue(false);
      const config = await configManager.loadConfig();

      const apiKey = configManager.getApiKey('openai', config);
      expect(apiKey).toBe('test-openai-key');
    });

    it('should return undefined for unknown provider', async () => {
      mockFs.pathExists.mockResolvedValue(false);
      const config = await configManager.loadConfig();

      const apiKey = configManager.getApiKey('unknown-provider', config);
      expect(apiKey).toBeUndefined();
    });
  });

  describe('isProviderConfigured', () => {
    it('should return true for configured providers', async () => {
      mockFs.pathExists.mockResolvedValue(false);
      const config = await configManager.loadConfig();

      expect(configManager.isProviderConfigured('openai', config)).toBe(true);
      expect(configManager.isProviderConfigured('ollama', config)).toBe(true); // Local provider
    });

    it('should return false for unconfigured providers', async () => {
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      // Reset singleton to force reload
      (ConfigManager as any).instance = null;
      configManager = ConfigManager.getInstance();
      mockFs.pathExists.mockResolvedValue(false);
      const config = await configManager.loadConfig();

      expect(configManager.isProviderConfigured('openai', config)).toBe(false);
    });
  });

  describe('addCustomProvider', () => {
    it('should add custom provider and save config', async () => {
      mockFs.pathExists.mockResolvedValue(false);
      mockFs.ensureDir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await configManager.addCustomProvider(
        'test-provider',
        'http://localhost:8080',
        ['model1', 'model2'],
        'test-api-key'
      );

      expect(mockFs.writeFile).toHaveBeenCalled();
    });
  });

  describe('removeCustomProvider', () => {
    it('should remove existing custom provider', async () => {
      // First load a config with a custom provider
      const configContent = `
customProviders:
  test-provider:
    baseUrl: http://localhost:8080
    models: [model1]
    enabled: true
`;
      mockFs.pathExists.mockResolvedValue(true);
      mockFs.readFile.mockResolvedValue(configContent);
      mockFs.ensureDir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await configManager.removeCustomProvider('test-provider');

      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it('should throw error for non-existent provider', async () => {
      mockFs.pathExists.mockResolvedValue(false);

      await expect(configManager.removeCustomProvider('non-existent')).rejects.toThrow("Provider 'non-existent' not found");
    });
  });
});
