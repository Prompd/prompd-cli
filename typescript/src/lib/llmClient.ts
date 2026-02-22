/**
 * Direct LLM API client for workflow execution
 * Handles conversation-based prompts with system messages and chat history
 */

import axios, { AxiosRequestConfig } from 'axios';

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMCallOptions {
  provider: string;
  model: string;
  apiKey: string;
  systemPrompt?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  temperature?: number;
  providerConfig?: {
    baseUrl?: string;
    timeout?: number;
    extraHeaders?: Record<string, string>;
    extraParams?: Record<string, any>;
  };
}

export interface LLMCallResult {
  success: boolean;
  response?: string;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Call LLM API with conversation messages
 */
export async function callLLM(options: LLMCallOptions): Promise<LLMCallResult> {
  const {
    provider,
    model,
    apiKey,
    systemPrompt,
    messages,
    maxTokens = 4000,
    temperature = 0.7,
    providerConfig = {}
  } = options;

  try {
    switch (provider.toLowerCase()) {
      case 'openai':
        return await callOpenAI(model, apiKey, systemPrompt, messages, maxTokens, temperature, providerConfig);
      case 'anthropic':
        return await callAnthropic(model, apiKey, systemPrompt, messages, maxTokens, temperature, providerConfig);
      case 'ollama':
        return await callOllama(model, systemPrompt, messages, maxTokens, temperature, providerConfig);
      default:
        return {
          success: false,
          error: `Unsupported provider: ${provider}`
        };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function callOpenAI(
  model: string,
  apiKey: string,
  systemPrompt: string | undefined,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number,
  temperature: number,
  providerConfig: { baseUrl?: string; timeout?: number; extraHeaders?: Record<string, string>; extraParams?: Record<string, any> } = {}
): Promise<LLMCallResult> {
  // Build messages array with system message first (if provided)
  const apiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

  if (systemPrompt) {
    apiMessages.push({ role: 'system', content: systemPrompt });
  }

  apiMessages.push(...messages);

  const config: AxiosRequestConfig = {
    method: 'POST',
    url: providerConfig.baseUrl || 'https://api.openai.com/v1/chat/completions',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...providerConfig.extraHeaders
    },
    data: {
      model,
      messages: apiMessages,
      max_tokens: maxTokens,
      temperature,
      ...providerConfig.extraParams
    },
    timeout: providerConfig.timeout || 60000
  };

  try {
    const response = await axios(config);
    const data = response.data;

    if (!data.choices || data.choices.length === 0) {
      throw new Error('No response choices returned');
    }

    return {
      success: true,
      response: data.choices[0].message.content,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      } : undefined
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.error?.message || error.message;
      throw new Error(`OpenAI API error: ${message}`);
    }
    throw error;
  }
}

async function callAnthropic(
  model: string,
  apiKey: string,
  systemPrompt: string | undefined,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number,
  temperature: number,
  providerConfig: { baseUrl?: string; timeout?: number; extraHeaders?: Record<string, string>; extraParams?: Record<string, any> } = {}
): Promise<LLMCallResult> {
  const config: AxiosRequestConfig = {
    method: 'POST',
    url: providerConfig.baseUrl || 'https://api.anthropic.com/v1/messages',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...providerConfig.extraHeaders
    },
    data: {
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt || undefined,  // Anthropic uses 'system' field, not a message
      messages,
      ...providerConfig.extraParams
    },
    timeout: providerConfig.timeout || 60000
  };

  try {
    const response = await axios(config);
    const data = response.data;

    if (!data.content || data.content.length === 0) {
      throw new Error('No response content returned');
    }

    return {
      success: true,
      response: data.content[0].text,
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens
      } : undefined
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.error?.message || error.message;
      throw new Error(`Anthropic API error: ${message}`);
    }
    throw error;
  }
}

async function callOllama(
  model: string,
  systemPrompt: string | undefined,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number,
  temperature: number,
  providerConfig: { baseUrl?: string; timeout?: number; extraHeaders?: Record<string, string>; extraParams?: Record<string, any> } = {}
): Promise<LLMCallResult> {
  // Build messages array with system message first (if provided)
  const apiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

  if (systemPrompt) {
    apiMessages.push({ role: 'system', content: systemPrompt });
  }

  apiMessages.push(...messages);

  const config: AxiosRequestConfig = {
    method: 'POST',
    url: providerConfig.baseUrl || 'http://localhost:11434/api/chat',
    headers: {
      'Content-Type': 'application/json',
      ...providerConfig.extraHeaders
    },
    data: {
      model,
      messages: apiMessages,
      stream: false,
      options: {
        num_predict: maxTokens,
        temperature,
        ...providerConfig.extraParams
      }
    },
    timeout: providerConfig.timeout || 120000
  };

  try {
    const response = await axios(config);
    const data = response.data;

    if (!data.message || !data.message.content) {
      throw new Error('No response content returned');
    }

    return {
      success: true,
      response: data.message.content,
      usage: data.eval_count ? {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count,
        totalTokens: (data.prompt_eval_count || 0) + data.eval_count
      } : undefined
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.error || error.message;
      throw new Error(`Ollama API error: ${message}`);
    }
    throw error;
  }
}
