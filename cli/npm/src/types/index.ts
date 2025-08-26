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
  name: string;
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

export interface Config {
  apiKeys: Record<string, string>;
  defaultProvider?: string;
  defaultModel?: string;
  customProviders: Record<string, CustomProvider>;
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
  verbose?: boolean;
}