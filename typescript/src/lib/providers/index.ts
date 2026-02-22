/**
 * Providers Module - Barrel Export
 *
 * Canonical source for LLM execution providers.
 * Frontend re-exports types from this module via @prompd/cli.
 */

// Types
export type {
  IExecutionProvider,
  ExecutionRequest,
  ExecutionResult,
  StreamChunk,
  TokenUsage,
  ModelInfo,
  ProviderConfig,
  ProviderEntry,
  GenerationMode
} from './types'

export { KNOWN_PROVIDERS } from './types'

// Base classes
export {
  BaseProvider,
  OpenAICompatibleProvider,
  AnthropicProvider,
  GoogleGeminiProvider,
  CohereProvider
} from './base'

// Factory
export {
  createProvider,
  getProviderConfig,
  listKnownProviders,
  isKnownProvider
} from './factory'

export type { CustomProviderOptions } from './factory'
