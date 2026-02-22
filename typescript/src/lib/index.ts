/**
 * Prompd Library - Core exports for use in TypeScript/React applications
 *
 * This module exports the core functionality of the Prompd CLI as a library
 * that can be imported and used programmatically.
 *
 * @example
 * ```typescript
 * import { PrompdParser, ConfigManager, PrompdCompiler, MemoryFileSystem } from '@prompd/cli';
 *
 * // Parse a .prmd file
 * const parser = new PrompdParser();
 * const prompd = await parser.parseFile('./example.prmd');
 *
 * // Validate a file
 * const issues = await parser.validateFile('./example.prmd');
 *
 * // Work with configuration
 * const config = new ConfigManager();
 * const currentConfig = config.load();
 *
 * // Compile from memory (server-side)
 * const fs = new MemoryFileSystem({
 *   '/main.prmd': '...'
 * });
 * const compiler = new PrompdCompiler();
 * const result = await compiler.compile('/main.prmd', { fileSystem: fs });
 * ```
 */

// Parser exports
export { PrompdParser } from './parser';
export type {
  PrompdFile,
  PrompdMetadata,
  PrompdParameter,
  ValidationIssue,
  CustomProvider,
  RegistryConfig,
  Config,
  LLMResponse,
  ExecuteOptions
} from '../types';

// Executor exports (for programmatic LLM execution)
export { PrompdExecutor, normalizeToPrompd } from './executor';

// Provider system (canonical source — frontend re-exports from here)
export {
  KNOWN_PROVIDERS,
  createProvider,
  getProviderConfig,
  listKnownProviders,
  isKnownProvider,
  BaseProvider,
  OpenAICompatibleProvider,
  AnthropicProvider,
  GoogleGeminiProvider,
  CohereProvider
} from './providers';
export type {
  IExecutionProvider,
  ExecutionRequest,
  ExecutionResult,
  StreamChunk,
  TokenUsage,
  ModelInfo,
  ProviderConfig,
  ProviderEntry,
  GenerationMode,
  CustomProviderOptions
} from './providers';

// Config exports
export { ConfigManager } from './config';

// Security exports
export { SecurityManager } from './security';

// Validation utilities
export {
  validatePackageName,
  validateVersion,
  validateNamespace,
  validateRegistryUrl,
  sanitizeFilePath,
  detectSecrets,
  validateFileExtension,
  validateOptionName,
  validateParameterKey,
  sanitizeParameterKey,
  validateGitRef,
  validateModelName,
  validateProviderName,
  validateEmail,
  containsMaliciousContent,
  validateNumericRange,
  validateStringLength,
  sanitizeForDisplay,
  validateJSON,
  validateYAML,
  SecurityError,
  ValidationError
} from './validation';

// Compiler exports (6-stage compilation pipeline)
export {
  PrompdCompiler,
  compile,
  CompilerPipeline,
  CompilationContext,
  CompilationOptions,
  CompilationDiagnostic,
  CompilerStage,
  OutputFormatter,
  CompiledPrompt,
  SectionInfo,
  LexicalAnalysisStage,
  DependencyResolutionStage,
  SemanticAnalysisStage,
  AssetExtractionStage,
  TemplateProcessingStage,
  CodeGenerationStage,
  SectionOverrideProcessor,
  MarkdownFormatter,
  OpenAIFormatter,
  AnthropicFormatter,
  // File system abstractions
  IFileSystem,
  MemoryFileSystem,
  NodeFileSystem,
  getDefaultFileSystem
} from './compiler';

// Git utilities (for IDE integration)
export {
  execGitCommand,
  getBranch,
  isGitRepo,
  getStatus,
  stageFile,
  unstageFile,
  discardChanges,
  commit,
  getRecentCommits,
  initRepo,
  getFileHistory,
  GitSecurityError
} from './git';
export type {
  GitCommandResult,
  GitFileStatus,
  GitCommitInfo
} from './git';

// Command execution (for workflow Command nodes in CLI)
export {
  executeCommand,
  createToolCallHandler
} from './commandExecutor';
export type {
  CommandExecutionResult,
  CommandExecutorOptions
} from './commandExecutor';

// Registry client (for package installation)
export { RegistryClient } from './registry';
export type {
  RegistryClientOptions,
  PackageMetadata,
  PublishOptions,
  SearchQuery,
  SearchResult,
  InstallOptions
} from './registry';

// Package creation (programmatic API)
export { createPackageFromPrompdJson } from '../commands/package';
export type { CreatePackageResult } from '../commands/package';

// Workflow execution engine (for Electron, tray, service modes)
export {
  executeWorkflow,
  downloadTrace,
  exportTraceAsJson,
  formatTraceEntry,
  getTraceSummary
} from './workflowExecutor';
export type {
  ExecutionMode,
  ExecutionTrace,
  TraceEntry,
  ToolCallRequest,
  ToolCallResult,
  CheckpointEvent,
  UserInputRequest,
  UserInputResponse,
  PromptExecuteRequest,
  PromptExecuteResult
} from './workflowExecutor';

// Workflow parser and serialization
export {
  parseWorkflow,
  serializeWorkflow,
  createEmptyWorkflow,
  createWorkflowNode,
  getExecutionOrder
} from './workflowParser';
export type {
  ParsedWorkflow
} from './workflowParser';

// Workflow types (shared between parser and executor)
export type {
  WorkflowFile,
  WorkflowNode,
  WorkflowEdge,
  WorkflowMetadata,
  WorkflowExecutionState,
  WorkflowResult,
  WorkflowExecutionError,
  WorkflowNodeType,
  BaseNodeData,
  TriggerNodeData,
  PromptNodeData,
  ProviderNodeData,
  AgentNodeData,
  ChatAgentNodeData,
  ToolNodeData,
  ConditionNodeData,
  LoopNodeData,
  ParallelNodeData,
  TransformerNodeData,
  ApiNodeData,
  MemoryNodeData,
  OutputNodeData,
  WorkflowNodeData,
  ErrorHandlerNodeData,
  CommandNodeData,
  ClaudeCodeNodeData,
  McpToolNodeData,
  CodeNodeData
} from './workflowTypes';

// Memory backend abstraction (for dependency injection)
export type { MemoryBackend } from './memoryBackend';
export {
  InMemoryBackend,
  NoOpBackend
} from './memoryBackend';

// Version information (from package.json — single source of truth)
import pkg from '../../package.json';
export const VERSION = pkg.version;
