export interface PrompdParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  required?: boolean;
  default?: any;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  enum?: string[];
}

export interface PrompdMetadata {
  id: string;         // Machine-readable identifier (kebab-case) - REQUIRED
  name?: string;      // Human-readable display name (can have spaces)
  description?: string;
  version?: string;
  parameters?: PrompdParameter[];
  variables?: PrompdParameter[]; // For backward compatibility
  system?: string;
  context?: string;
  user?: string;
  response?: string;
  requires?: string[];
}

export interface PrompdFile {
  metadata: PrompdMetadata;
  content: string;
  sections: Record<string, string>;
}

export interface CustomProvider {
  apiKey?: string;
  baseUrl: string;
  enabled: boolean;
  models: string[];
  type: string;
}

export interface RegistryConfig {
  url: string;
  token?: string;
  username?: string;
}

export interface Config {
  apiKeys: Record<string, string>;
  defaultProvider?: string;
  defaultModel?: string;
  customProviders: Record<string, CustomProvider>;
  registry: {
    default?: string;
    registries: Record<string, RegistryConfig>;
  };
  scopes: Record<string, string>; // scope -> registry mapping
  namespaces?: Record<string, string>; // namespace -> registry URL mapping
  currentNamespace?: string; // active namespace
  maxRetries?: number;
  timeout?: number;
  verbose?: boolean;
}

export interface LLMResponse {
  success: boolean;
  response?: string;
  error?: string;
  content?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ValidationIssue {
  level: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  column?: number;
}

export interface ExecuteOptions {
  provider: string;
  model: string;
  apiKey?: string;
  output?: string;
  params?: Record<string, any>;
  paramFiles?: string[];
  version?: string;
  metaSystem?: string;
  metaContext?: string;
  metaUser?: string;
  verbose?: boolean;
}