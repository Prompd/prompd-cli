/**
 * Model List Updater - Fetches latest model lists from providers
 * Keeps our hardcoded model lists current with provider APIs
 */

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextLength?: number;
  inputCost?: number;  // per 1M tokens
  outputCost?: number; // per 1M tokens
  deprecated?: boolean;
  description?: string;
}

export interface ProviderModels {
  provider: string;
  models: ModelInfo[];
  lastUpdated: string;
}

/**
 * Current model lists based on latest provider APIs
 * Updated: January 2025
 */
export const CURRENT_MODELS: Record<string, ProviderModels> = {
  openai: {
    provider: 'openai',
    lastUpdated: '2025-01-25',
    models: [
      // GPT-4 Models (Latest)
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'openai',
        contextLength: 128000,
        inputCost: 2.50,
        outputCost: 10.00,
        description: 'Latest GPT-4 with vision and optimized performance'
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        provider: 'openai',
        contextLength: 128000,
        inputCost: 0.15,
        outputCost: 0.60,
        description: 'Faster, cost-effective GPT-4 variant'
      },
      {
        id: 'gpt-4-turbo',
        name: 'GPT-4 Turbo',
        provider: 'openai',
        contextLength: 128000,
        inputCost: 10.00,
        outputCost: 30.00,
        description: 'Enhanced GPT-4 with improved reasoning'
      },
      {
        id: 'gpt-4',
        name: 'GPT-4',
        provider: 'openai',
        contextLength: 8192,
        inputCost: 30.00,
        outputCost: 60.00,
        description: 'Original GPT-4 model'
      },
      
      // GPT-3.5 Models
      {
        id: 'gpt-3.5-turbo',
        name: 'GPT-3.5 Turbo',
        provider: 'openai',
        contextLength: 16384,
        inputCost: 0.50,
        outputCost: 1.50,
        description: 'Fast and efficient model for most tasks'
      },
      
      // Embedding Models
      {
        id: 'text-embedding-3-large',
        name: 'Text Embedding 3 Large',
        provider: 'openai',
        contextLength: 8192,
        inputCost: 0.13,
        outputCost: 0,
        description: 'Most capable embedding model'
      },
      {
        id: 'text-embedding-3-small',
        name: 'Text Embedding 3 Small',
        provider: 'openai',
        contextLength: 8192,
        inputCost: 0.02,
        outputCost: 0,
        description: 'Efficient embedding model'
      }
    ]
  },
  
  anthropic: {
    provider: 'anthropic',
    lastUpdated: '2025-01-25',
    models: [
      // Claude 3.5 Models (Latest)
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        provider: 'anthropic',
        contextLength: 200000,
        inputCost: 3.00,
        outputCost: 15.00,
        description: 'Most intelligent model with improved coding and reasoning'
      },
      {
        id: 'claude-3-5-haiku-20241022', 
        name: 'Claude 3.5 Haiku',
        provider: 'anthropic',
        contextLength: 200000,
        inputCost: 0.80,
        outputCost: 4.00,
        description: 'Fast and cost-effective for everyday tasks'
      },
      
      // Claude 3 Models
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        provider: 'anthropic', 
        contextLength: 200000,
        inputCost: 15.00,
        outputCost: 75.00,
        description: 'Most powerful model for complex tasks'
      },
      {
        id: 'claude-3-sonnet-20240229',
        name: 'Claude 3 Sonnet',
        provider: 'anthropic',
        contextLength: 200000,
        inputCost: 3.00,
        outputCost: 15.00,
        description: 'Balanced performance and cost'
      },
      {
        id: 'claude-3-haiku-20240307',
        name: 'Claude 3 Haiku',
        provider: 'anthropic',
        contextLength: 200000,
        inputCost: 0.25,
        outputCost: 1.25,
        description: 'Fastest model for simple tasks'
      }
    ]
  },
  
  google: {
    provider: 'google',
    lastUpdated: '2025-01-25', 
    models: [
      {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        provider: 'google',
        contextLength: 2000000,
        inputCost: 1.25,
        outputCost: 5.00,
        description: 'Latest Gemini with massive context window'
      },
      {
        id: 'gemini-1.5-flash',
        name: 'Gemini 1.5 Flash',
        provider: 'google',
        contextLength: 1000000,
        inputCost: 0.075,
        outputCost: 0.30,
        description: 'Fast and efficient multimodal model'
      },
      {
        id: 'gemini-pro',
        name: 'Gemini Pro',
        provider: 'google',
        contextLength: 32000,
        inputCost: 0.50,
        outputCost: 1.50,
        description: 'General purpose model'
      }
    ]
  },

  ollama: {
    provider: 'ollama',
    lastUpdated: '2025-01-25',
    models: [
      {
        id: 'llama3.2',
        name: 'Llama 3.2',
        provider: 'ollama',
        description: 'Latest Llama model from Meta'
      },
      {
        id: 'llama3.1',
        name: 'Llama 3.1',
        provider: 'ollama',
        description: 'Llama 3.1 with improved capabilities'
      },
      {
        id: 'mistral',
        name: 'Mistral 7B',
        provider: 'ollama',
        description: 'Efficient open-source model'
      },
      {
        id: 'codellama',
        name: 'Code Llama',
        provider: 'ollama',
        description: 'Specialized for code generation'
      },
      {
        id: 'phi3',
        name: 'Phi-3',
        provider: 'ollama',
        description: 'Microsoft\'s small but capable model'
      }
    ]
  }
};

/**
 * Get models for a specific provider
 */
export function getModelsForProvider(provider: string): ModelInfo[] {
  const providerData = CURRENT_MODELS[provider.toLowerCase()];
  return providerData ? providerData.models : [];
}

/**
 * Get all available models across providers
 */
export function getAllModels(): ModelInfo[] {
  return Object.values(CURRENT_MODELS).flatMap(p => p.models);
}

/**
 * Get recommended models for different use cases
 */
export function getRecommendedModels() {
  return {
    'fastest': [
      'gpt-4o-mini',
      'claude-3-5-haiku-20241022', 
      'gemini-1.5-flash'
    ],
    'balanced': [
      'gpt-4o',
      'claude-3-5-sonnet-20241022',
      'gemini-1.5-pro'
    ],
    'most-capable': [
      'gpt-4-turbo',
      'claude-3-opus-20240229',
      'gemini-1.5-pro'
    ],
    'cost-effective': [
      'gpt-3.5-turbo',
      'claude-3-haiku-20240307',
      'gemini-1.5-flash'
    ],
    'coding': [
      'gpt-4o',
      'claude-3-5-sonnet-20241022',
      'codellama'
    ]
  };
}

/**
 * Validate if a model ID is currently supported
 */
export function isValidModel(modelId: string, provider?: string): boolean {
  const allModels = getAllModels();
  
  if (provider) {
    return allModels.some(m => m.id === modelId && m.provider === provider.toLowerCase());
  }
  
  return allModels.some(m => m.id === modelId);
}

/**
 * Get model information by ID
 */
export function getModelInfo(modelId: string): ModelInfo | null {
  const allModels = getAllModels();
  return allModels.find(m => m.id === modelId) || null;
}