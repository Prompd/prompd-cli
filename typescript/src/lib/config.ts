import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import { Config, CustomProvider } from '../types';

export class ConfigManager {
  private static instance: ConfigManager;
  public config: Config | null = null;

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  async loadConfig(): Promise<Config> {
    if (this.config) {
      return this.config;
    }

    const config: Config = {
      apiKeys: {},
      customProviders: {},
      providerConfigs: {},
      registry: {
        registries: {}
      },
      scopes: {},
      maxRetries: 3,
      timeout: 30,
      verbose: false
    };

    // Try to load from config files in order of precedence
    const configPaths = this.getConfigPaths();
    
    for (const configPath of configPaths) {
      if (await fs.pathExists(configPath)) {
        try {
          const fileContent = await fs.readFile(configPath, 'utf-8');
          const fileConfig = yaml.parse(fileContent, { strict: true, maxAliasCount: 64 });

          // Validate parsed config is a plain object (not a string, array, null, etc.)
          if (!fileConfig || typeof fileConfig !== 'object' || Array.isArray(fileConfig)) {
            console.warn(`Warning: Config file ${configPath} did not parse to a valid object, skipping.`);
            continue;
          }

          // Convert snake_case keys from YAML to camelCase for TypeScript
          if (fileConfig.api_keys) {
            fileConfig.apiKeys = fileConfig.api_keys;
            delete fileConfig.api_keys;
          }
          if (fileConfig.default_provider) {
            fileConfig.defaultProvider = fileConfig.default_provider;
            delete fileConfig.default_provider;
          }
          if (fileConfig.default_model) {
            fileConfig.defaultModel = fileConfig.default_model;
            delete fileConfig.default_model;
          }
          if (fileConfig.custom_providers) {
            fileConfig.customProviders = fileConfig.custom_providers;
            delete fileConfig.custom_providers;
          }
          if (fileConfig.max_retries) {
            fileConfig.maxRetries = fileConfig.max_retries;
            delete fileConfig.max_retries;
          }
          if (fileConfig.current_namespace) {
            fileConfig.currentNamespace = fileConfig.current_namespace;
            delete fileConfig.current_namespace;
          }
          if (fileConfig.provider_configs) {
            fileConfig.providerConfigs = fileConfig.provider_configs;
            delete fileConfig.provider_configs;
          }
          if (fileConfig.disabled_providers) {
            fileConfig.disabledProviders = fileConfig.disabled_providers;
            delete fileConfig.disabled_providers;
          }

          Object.assign(config, fileConfig);
          break;
        } catch (error) {
          console.warn(`Warning: Error loading config from ${configPath}:`, error);
        }
      }
    }

    // Override with environment variables
    this.loadEnvironmentVariables(config);

    // Ensure default registries and migrate legacy config
    this.ensureDefaultRegistries(config);
    this.migrateLegacyConfig(config);

    this.config = config;
    return config;
  }

  async saveConfig(config: Config): Promise<void> {
    const configPaths = this.getConfigPaths();
    
    // Try to save to the first path that can be created
    for (const configPath of configPaths) {
      try {
        await fs.ensureDir(path.dirname(configPath));
        const yamlContent = yaml.stringify(config);
        await fs.writeFile(configPath, yamlContent, 'utf-8');

        // Restrict file permissions to owner read/write only (config may contain tokens)
        try {
          await fs.chmod(configPath, 0o600);
        } catch {
          // chmod may fail on some platforms (e.g., Windows); non-fatal
        }

        console.log(`Config saved to: ${configPath}`);
        this.config = config;
        return;
      } catch (error) {
        // Try next path
        continue;
      }
    }
    
    throw new Error('Could not write config to any of the expected paths');
  }

  private getConfigPaths(): string[] {
    const paths: string[] = [];
    const home = os.homedir();
    
    // 1. User home directory (PRIORITY - matches Python CLI)
    paths.push(path.join(home, '.prompd', 'config.yaml'));
    paths.push(path.join(home, '.prompd', 'config.json'));
    
    // 2. Platform-specific config directory
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA;
      if (appData) {
        paths.push(path.join(appData, 'prompd', 'config.yaml'));
      }
    } else {
      paths.push(path.join(home, '.config', 'prompd', 'config.yaml'));
    }
    
    // 3. Current directory (LAST RESORT)
    const cwd = process.cwd();
    paths.push(path.join(cwd, '.prompd', 'config.yaml'));
    paths.push(path.join(cwd, '.prompd', 'config.json'));
    
    return paths;
  }

  private loadEnvironmentVariables(config: Config): void {
    // API keys from environment
    const apiKeyEnvs = [
      { provider: 'openai', env: 'OPENAI_API_KEY' },
      { provider: 'anthropic', env: 'ANTHROPIC_API_KEY' },
      { provider: 'groq', env: 'GROQ_API_KEY' }
    ];

    for (const { provider, env } of apiKeyEnvs) {
      const key = process.env[env];
      if (key) {
        config.apiKeys[provider] = key;
      }
    }
    
    // Default provider and model
    if (process.env.PROMPD_DEFAULT_PROVIDER) {
      config.defaultProvider = process.env.PROMPD_DEFAULT_PROVIDER;
    }
    if (process.env.PROMPD_DEFAULT_MODEL) {
      config.defaultModel = process.env.PROMPD_DEFAULT_MODEL;
    }
    
    // Verbose flag
    if (process.env.PROMPD_VERBOSE === 'true') {
      config.verbose = true;
    }
  }

  getApiKey(provider: string, config?: Config): string | undefined {
    const cfg = config || this.config;
    if (!cfg) return undefined;

    // Priority order (CLI params are handled separately in command files):
    // 1. Env vars (already merged into cfg.apiKeys via loadEnvironmentVariables)
    // 2. Config file API keys
    // 3. Custom provider API keys

    // Check apiKeys (contains both env vars and config file keys, env vars take precedence)
    if (cfg.apiKeys[provider]) {
      return cfg.apiKeys[provider];
    }

    // Fallback to custom providers
    if (cfg.customProviders[provider]?.apiKey) {
      return cfg.customProviders[provider].apiKey;
    }

    return undefined;
  }

  private getApiKeyFromEnv(provider: string): string | undefined {
    switch (provider) {
      case 'openai':
        return process.env.OPENAI_API_KEY;
      case 'anthropic':
        return process.env.ANTHROPIC_API_KEY;
      case 'groq':
        return process.env.GROQ_API_KEY;
      default:
        // Try generic pattern: PROVIDER_API_KEY
        const envKey = `${provider.toUpperCase()}_API_KEY`;
        return process.env[envKey];
    }
  }

  getDefaultProvider(config?: Config): string {
    const cfg = config || this.config;
    return cfg?.defaultProvider || 'openai';
  }

  getDefaultModel(provider: string, config?: Config): string {
    const cfg = config || this.config;
    if (cfg?.defaultModel) {
      return cfg.defaultModel;
    }

    // Provider-specific defaults
    switch (provider) {
      case 'openai':
        return 'gpt-4o-mini';
      case 'anthropic':
        return 'claude-3-5-haiku-20241022';
      case 'groq':
        return 'llama3-8b-8192';
      default:
        return 'default';
    }
  }

  getProviderConfig(provider: string, config?: Config): Record<string, any> {
    const cfg = config || this.config;
    if (!cfg?.providerConfigs) return {};

    return cfg.providerConfigs[provider] || {};
  }

  isProviderConfigured(provider: string, config?: Config): boolean {
    const cfg = config || this.config;
    if (!cfg) return false;

    switch (provider) {
      case 'ollama':
        return true; // Local provider doesn't need API key
      default:
        return !!this.getApiKey(provider, cfg);
    }
  }

  listConfiguredProviders(config?: Config): string[] {
    const cfg = config || this.config;
    if (!cfg) return [];

    const providers: string[] = [];
    
    // Built-in providers
    const builtinProviders = ['openai', 'anthropic', 'groq', 'ollama'];
    for (const provider of builtinProviders) {
      if (this.isProviderConfigured(provider, cfg)) {
        providers.push(provider);
      }
    }
    
    // Custom providers
    for (const [name, customProvider] of Object.entries(cfg.customProviders)) {
      if (customProvider.enabled && customProvider.apiKey) {
        providers.push(name);
      }
    }
    
    return providers;
  }

  async addCustomProvider(
    name: string,
    baseUrl: string,
    models: string[],
    apiKey?: string,
    providerType = 'openai-compatible'
  ): Promise<void> {
    const config = await this.loadConfig();
    
    config.customProviders[name] = {
      baseUrl,
      models,
      apiKey,
      type: providerType,
      enabled: true
    };
    
    await this.saveConfig(config);
  }

  async removeCustomProvider(name: string): Promise<void> {
    const config = await this.loadConfig();
    
    if (!config.customProviders[name]) {
      throw new Error(`Provider '${name}' not found`);
    }
    
    delete config.customProviders[name];
    await this.saveConfig(config);
  }

  // Multi-Registry Methods

  private ensureDefaultRegistries(config: Config): void {
    // Always ensure prompdhub is available (unless explicitly removed)
    if (!config.registry.registries.prmdhub) {
      config.registry.registries.prmdhub = {
        url: 'https://registry.prmdhub.ai',
        token: undefined,
        username: undefined
      };
    }

    // Set prompdhub as default if no default is set
    if (!config.registry.default) {
      config.registry.default = 'prompdhub';
    }
  }

  private migrateLegacyConfig(config: Config): void {
    // Check for legacy prompd token in api_keys and migrate
    if (config.apiKeys.prmd) {
      const legacyToken = config.apiKeys.prmd;
      
      // Move to registry structure if prompdhub doesn't have a token
      if (!config.registry.registries.prmdhub?.token) {
        config.registry.registries.prmdhub = {
          ...config.registry.registries.prmdhub,
          token: legacyToken
        };
      }
      
      // Remove from api_keys
      delete config.apiKeys.prmd;
    }
  }

  resolveRegistryForPackage(packageName: string, config?: Config): string {
    const cfg = config || this.config;
    if (!cfg) return 'prompdhub';

    // Extract scope from package name (@scope/package)
    if (packageName.startsWith('@') && packageName.includes('/')) {
      const scope = packageName.split('/')[0]; // @company
      
      // Check if scope has a configured registry
      if (cfg.scopes[scope] && cfg.registry.registries[cfg.scopes[scope]]) {
        return cfg.scopes[scope];
      }
    }

    // Fallback to default registry
    return cfg.registry.default || 'prompdhub';
  }

  async addScopeMapping(scope: string, registryName: string): Promise<void> {
    const config = await this.loadConfig();
    
    if (!scope.startsWith('@')) {
      scope = `@${scope}`;
    }
    
    if (!config.registry.registries[registryName]) {
      throw new Error(`Registry '${registryName}' not found in configuration`);
    }
    
    config.scopes[scope] = registryName;
    await this.saveConfig(config);
  }

  async removeScopeMapping(scope: string): Promise<void> {
    const config = await this.loadConfig();
    
    if (!scope.startsWith('@')) {
      scope = `@${scope}`;
    }
    
    if (config.scopes[scope]) {
      delete config.scopes[scope];
      await this.saveConfig(config);
    }
  }

  async addRegistry(name: string, url: string): Promise<void> {
    const config = await this.loadConfig();
    
    config.registry.registries[name] = {
      url,
      token: undefined,
      username: undefined
    };
    
    // Set as default if it's the first registry
    if (!config.registry.default) {
      config.registry.default = name;
    }
    
    await this.saveConfig(config);
  }

  async removeRegistry(name: string): Promise<void> {
    const config = await this.loadConfig();
    
    if (!config.registry.registries[name]) {
      throw new Error(`Registry '${name}' not found`);
    }
    
    delete config.registry.registries[name];
    
    // Update default if we removed the default registry
    if (config.registry.default === name) {
      const remaining = Object.keys(config.registry.registries);
      config.registry.default = remaining.length > 0 ? remaining[0] : undefined;
    }
    
    await this.saveConfig(config);
  }

  async setDefaultRegistry(name: string): Promise<void> {
    const config = await this.loadConfig();
    
    if (!config.registry.registries[name]) {
      throw new Error(`Registry '${name}' not found`);
    }
    
    config.registry.default = name;
    await this.saveConfig(config);
  }

  getRegistryToken(registryName: string, config?: Config): string | undefined {
    const cfg = config || this.config;
    if (!cfg || !cfg.registry.registries[registryName]) {
      return undefined;
    }
    
    return cfg.registry.registries[registryName].api_key || cfg.registry.registries[registryName].token;
  }

  async setRegistryToken(registryName: string, token: string, username?: string): Promise<void> {
    const config = await this.loadConfig();
    
    if (!config.registry.registries[registryName]) {
      throw new Error(`Registry '${registryName}' not found`);
    }
    
    config.registry.registries[registryName].token = token;
    if (username) {
      config.registry.registries[registryName].username = username;
    }
    
    await this.saveConfig(config);
  }
}