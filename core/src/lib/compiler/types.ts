/**
 * Compilation pipeline types and interfaces.
 *
 * This module defines the core types used throughout the 6-stage compilation pipeline,
 * mirroring the Python CLI's architecture for feature parity.
 */

import { PrompdMetadata } from '../../types';
import { IFileSystem } from './file-system';

/**
 * Options for resolving a package reference to a path.
 */
export interface ResolvePackageOptions {
  fileSystem?: IFileSystem;
  registryUrl?: string;
  workspaceRoot?: string;
}

/**
 * Injectable package resolver. The Node CLI provides a disk/registry-backed
 * implementation; the browser omits it (single-file compile only), in which
 * case stages that need package/inherits resolution emit a diagnostic instead
 * of importing Node-only code.
 */
export interface IPackageResolver {
  resolvePackage(packageRef: string, options: ResolvePackageOptions): Promise<string>;
}

/**
 * Stages of the compilation pipeline.
 */
export enum CompilationStage {
  LEXICAL_ANALYSIS = 'lexical_analysis',
  DEPENDENCY_RESOLUTION = 'dependency_resolution',
  SEMANTIC_ANALYSIS = 'semantic_analysis',
  ASSET_EXTRACTION = 'asset_extraction',
  TEMPLATE_PROCESSING = 'template_processing',
  CODE_GENERATION = 'code_generation'
}

/**
 * Resolved package information.
 */
export interface ResolvedPackage {
  path: string;
  prefix?: string;
}

/**
 * Structured diagnostic message with location information.
 * Used for both errors and warnings to enable IDE integration.
 */
export interface CompilationDiagnostic {
  /** The diagnostic message */
  message: string;
  /** Severity level */
  severity: 'error' | 'warning' | 'info';
  /** Source stage that generated this diagnostic */
  source?: string;
  /** Starting line number (1-indexed) */
  line?: number;
  /** Starting column number (1-indexed) */
  column?: number;
  /** Ending line number (1-indexed) */
  endLine?: number;
  /** Ending column number (1-indexed) */
  endColumn?: number;
  /** Optional error code for quick-fix identification */
  code?: string;
  /** File path if different from main source file */
  file?: string;
}

/**
 * Context passed between compilation stages.
 *
 * Accumulates data as it flows through the pipeline, collecting errors,
 * warnings, and transforming content at each stage.
 */
export class CompilationContext {
  sourceFile: string;
  metadata?: PrompdMetadata;
  content?: string;
  /** Raw source content for line number calculation */
  rawSource?: string;
  dependencies: {
    imports?: Record<string, ResolvedPackage>;
    inherits?: string;
  };
  parameters: Record<string, any>;
  contexts: string[];
  /** Legacy string errors for backward compatibility */
  errors: string[];
  /** Legacy string warnings for backward compatibility */
  warnings: string[];
  /** Structured diagnostics with location information */
  diagnostics: CompilationDiagnostic[];
  outputFormat: string;
  compiledResult?: string | Uint8Array;
  verbose: boolean;
  fileSystem!: IFileSystem; // Set by pipeline
  registryUrl?: string; // Registry URL for package resolution
  workspaceRoot?: string; // Workspace root directory for package cache
  packageResolver?: IPackageResolver; // Injected; absent in browser (single-file compile)

  constructor(sourceFile: string, options: CompilationOptions = {}) {
    this.sourceFile = sourceFile;
    this.dependencies = {};
    this.parameters = options.parameters || {};
    this.contexts = [];
    this.errors = [];
    this.warnings = [];
    this.diagnostics = [];
    this.outputFormat = options.outputFormat || 'markdown';
    this.verbose = options.verbose || false;
    this.registryUrl = options.registryUrl;
    this.workspaceRoot = options.workspaceRoot;
    this.packageResolver = options.packageResolver;
  }

  /**
   * Add an error to the compilation context (legacy string format).
   */
  addError(message: string): void {
    this.errors.push(message);
    // Also add as structured diagnostic
    this.diagnostics.push({ message, severity: 'error' });
  }

  /**
   * Add a warning to the compilation context (legacy string format).
   */
  addWarning(message: string): void {
    this.warnings.push(message);
    // Also add as structured diagnostic
    this.diagnostics.push({ message, severity: 'warning' });
  }

  /**
   * Add a structured diagnostic with location information.
   */
  addDiagnostic(diagnostic: CompilationDiagnostic): void {
    this.diagnostics.push(diagnostic);
    // Also add to legacy arrays for backward compatibility
    if (diagnostic.severity === 'error') {
      this.errors.push(diagnostic.message);
    } else if (diagnostic.severity === 'warning') {
      this.warnings.push(diagnostic.message);
    }
  }

  /**
   * Find line and column for a pattern in the raw source.
   * Returns 1-indexed line and column numbers.
   */
  findLocation(pattern: string | RegExp): { line: number; column: number; endLine: number; endColumn: number } | null {
    if (!this.rawSource) return null;

    const match = typeof pattern === 'string'
      ? this.rawSource.indexOf(pattern)
      : this.rawSource.search(pattern);

    if (match === -1) return null;

    const beforeMatch = this.rawSource.substring(0, match);
    const lines = beforeMatch.split('\n');
    const line = lines.length;
    const column = (lines[lines.length - 1]?.length || 0) + 1;

    // Calculate end position
    const matchLength = typeof pattern === 'string'
      ? pattern.length
      : (this.rawSource.match(pattern)?.[0]?.length || 0);
    const matchText = this.rawSource.substring(match, match + matchLength);
    const matchLines = matchText.split('\n');
    const endLine = line + matchLines.length - 1;
    const endColumn = matchLines.length === 1
      ? column + matchLength
      : matchLines[matchLines.length - 1].length + 1;

    return { line, column, endLine, endColumn };
  }

  /**
   * Check if compilation has errors.
   */
  hasErrors(): boolean {
    return this.errors.length > 0 || this.diagnostics.some(d => d.severity === 'error');
  }

  /**
   * Get all diagnostics (errors and warnings).
   */
  getDiagnostics(): CompilationDiagnostic[] {
    return this.diagnostics;
  }

  /**
   * Get only error diagnostics.
   */
  getErrors(): CompilationDiagnostic[] {
    return this.diagnostics.filter(d => d.severity === 'error');
  }

  /**
   * Get only warning diagnostics.
   */
  getWarnings(): CompilationDiagnostic[] {
    return this.diagnostics.filter(d => d.severity === 'warning');
  }
}

/**
 * Options for compilation.
 */
export interface CompilationOptions {
  outputFormat?: string;
  parameters?: Record<string, any>;
  outputFile?: string;
  verbose?: boolean;
  fileSystem?: IFileSystem;
  /** Injected package resolver (Node CLI provides disk/registry; browser omits). */
  packageResolver?: IPackageResolver;
  /** Registry URL for package resolution. Defaults to https://registry.prompdhub.ai in production. */
  registryUrl?: string;
  /** Root directory for workspace (for package cache location). */
  workspaceRoot?: string;
  /**
   * When true, skip required parameter validation.
   * Use this for validation/diagnostics during editing when parameters won't be provided.
   * When false (default), required parameters are validated during execution.
   */
  validateOnly?: boolean;
}

/**
 * Abstract base interface for compiler pipeline stages.
 */
export interface CompilerStage {
  /**
   * Process the compilation context through this stage.
   */
  process(context: CompilationContext): Promise<void>;

  /**
   * Get the name of this compilation stage.
   */
  getName(): string;
}

/**
 * Represents a compiled prompt ready for formatting.
 */
export interface CompiledPrompt {
  metadata?: PrompdMetadata;
  content?: string;
  contexts: string[];
  parameters: Record<string, any>;
  verbose: boolean;
}

/**
 * Protocol for output format plugins.
 */
export interface OutputFormatter {
  name: string;
  fileExtension: string;
  mimeType: string;

  /**
   * Format the compiled prompt into the target format.
   */
  format(compiled: CompiledPrompt): Promise<string>;
}

/**
 * Information about a markdown section.
 */
export interface SectionInfo {
  id: string;
  headingText: string;
  content: string;
  startLine: number;
  endLine: number;
  headingLevel: number;
}

/**
 * Security configuration for file operations.
 */
export interface SecurityConfig {
  maxFileSize: number; // Maximum file size in bytes
  allowedExtensions: string[]; // Allowed file extensions
  maxTemplateDepth: number; // Maximum template nesting depth
  templateTimeout: number; // Template rendering timeout in ms
}

/**
 * Default security configuration.
 */
export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  allowedExtensions: [
    '.prmd', '.md', '.txt', '.json', '.yaml', '.yml',
    '.xlsx', '.docx', '.pdf', '.png', '.jpg', '.jpeg', '.gif'
  ],
  maxTemplateDepth: 10,
  templateTimeout: 5000 // 5 seconds
};
