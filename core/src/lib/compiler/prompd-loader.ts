/**
 * Custom Nunjucks Loader for Prompd Files
 *
 * This loader enables {% include %} directives in .prmd files with compile-aware behavior:
 * - .prmd files: Parses and returns only the body content (frontmatter stripped)
 * - Other files (.md, .txt, etc.): Returns raw content as-is
 *
 * Features:
 * - Workspace-aware path resolution (relative to source file)
 * - Circular include detection
 * - Compile-on-demand for .prmd files
 */

import * as nunjucks from 'nunjucks';
import { IFileSystem } from './file-system';
import { PrompdParser } from '../parser';
import { extname, isAbsolutePosix, isPrompdFile, PROMPD_EXTENSIONS } from './path-utils';

/**
 * Global include stack shared across all loader instances.
 * This is necessary because Nunjucks creates new loader instances for nested includes,
 * but we need to track the entire include chain to detect circular dependencies.
 *
 * The stack is keyed by a unique compilation ID to support concurrent compilations.
 */
const globalIncludeStacks = new Map<string, Set<string>>();

/**
 * Generate a unique compilation ID.
 */
let compilationCounter = 0;
function generateCompilationId(): string {
  return `compile-${++compilationCounter}-${Date.now()}`;
}

/**
 * Options for the Prompd loader.
 */
export interface PrompdLoaderOptions {
  /** File system abstraction (real FS or in-memory) */
  fileSystem: IFileSystem;
  /** Base directory for resolving relative paths */
  baseDir: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Maximum include depth to prevent infinite recursion */
  maxDepth?: number;
  /** Unique compilation ID for tracking include stack across loader instances */
  compilationId?: string;
}

/**
 * Loader result with source content and metadata.
 * Matches Nunjucks LoaderSource interface.
 */
interface LoaderResult {
  src: string;
  path: string;
  noCache: boolean;
}

/**
 * Custom Nunjucks loader that handles .prmd files specially.
 *
 * When a .prmd file is included, this loader:
 * 1. Parses the frontmatter
 * 2. Extracts only the body content
 * 3. Returns the body for inclusion
 *
 * This allows prompts to be composed from other prompts without
 * duplicating frontmatter or metadata.
 */
export class PrompdLoader extends nunjucks.Loader {
  // Required by Nunjucks loader interface - we use synchronous loading
  async = false;

  private fileSystem: IFileSystem;
  private baseDir: string;
  private verbose: boolean;
  private maxDepth: number;
  private parser: PrompdParser;
  private compilationId: string;

  constructor(options: PrompdLoaderOptions) {
    super();
    this.fileSystem = options.fileSystem;
    this.baseDir = options.baseDir;
    this.verbose = options.verbose || false;
    this.maxDepth = options.maxDepth || 10;
    this.parser = new PrompdParser();

    // Use provided compilation ID or generate a new one
    // The compilation ID links all loader instances in a single compilation
    this.compilationId = options.compilationId || generateCompilationId();

    // Initialize global stack for this compilation if needed
    if (!globalIncludeStacks.has(this.compilationId)) {
      globalIncludeStacks.set(this.compilationId, new Set());
    }
  }

  /**
   * Get the include stack for this compilation.
   */
  private getIncludeStack(): Set<string> {
    return globalIncludeStacks.get(this.compilationId) || new Set();
  }

  /**
   * Clean up the global stack after compilation is complete.
   * Should be called when the top-level compilation finishes.
   */
  static cleanupCompilation(compilationId: string): void {
    globalIncludeStacks.delete(compilationId);
  }

  /**
   * Get the source content for a template.
   * This is the main entry point called by Nunjucks.
   * Throws an error if the file is not found (required by Nunjucks interface).
   */
  getSource(name: string): LoaderResult {
    // Resolve path relative to base directory
    const resolvedPath = this.resolvePath(name);
    const includeStack = this.getIncludeStack();

    if (this.verbose) {
      console.log(`[include] Resolving: ${name} -> ${resolvedPath}`);
    }

    // Check for circular includes
    if (includeStack.has(resolvedPath)) {
      const stack = Array.from(includeStack).join(' -> ');
      throw new Error(
        `Circular include detected: ${stack} -> ${resolvedPath}`
      );
    }

    // Check max depth
    if (includeStack.size >= this.maxDepth) {
      throw new Error(
        `Maximum include depth (${this.maxDepth}) exceeded. Check for deep nesting or circular includes.`
      );
    }

    // Check if file exists
    const exists = this.fileSystem.exists(resolvedPath);
    if (typeof exists === 'object' && 'then' in exists) {
      // Async not supported in getSource - throw helpful error
      throw new Error(
        'PrompdLoader requires synchronous file system operations. Use NodeFileSystem or ensure MemoryFileSystem is pre-populated.'
      );
    }

    if (!exists) {
      // Try Prompd source extensions if none was specified (.prmd, then .md)
      if (!isPrompdFile(resolvedPath)) {
        for (const ext of PROMPD_EXTENSIONS) {
          const withExt = resolvedPath + ext;
          if (this.fileSystem.exists(withExt) === true) {
            return this.loadFile(withExt);
          }
        }
      }

      // Nunjucks expects an error to be thrown for missing files
      throw new Error(`Template not found: ${name} (resolved to ${resolvedPath})`);
    }

    return this.loadFile(resolvedPath);
  }

  /**
   * Load and process a file.
   * Note: We do NOT remove from stack after loading because Nunjucks will process
   * the returned content which may contain more includes. The stack tracks the
   * entire include chain during a single compilation.
   */
  private loadFile(filePath: string): LoaderResult {
    const includeStack = this.getIncludeStack();

    // Add to include stack - this persists for the entire compilation
    includeStack.add(filePath);

    // Read file content
    const content = this.fileSystem.readFile(filePath);
    if (typeof content === 'object' && 'then' in content) {
      throw new Error(
        'PrompdLoader requires synchronous file system operations.'
      );
    }

    // Process based on file extension
    const ext = extname(filePath).toLowerCase();
    let processedContent: string;

    if (isPrompdFile(filePath)) {
      // Parse Prompd source (.prmd or .md) and extract body only. For a .md
      // without frontmatter, processPrompdFile returns the content unchanged.
      processedContent = this.processPrompdFile(content, filePath);
    } else {
      // Return raw content for other file types
      processedContent = content;
    }

    if (this.verbose) {
      const preview = processedContent.substring(0, 50).replace(/\n/g, '\\n');
      console.log(`[include] Loaded ${ext} file: ${filePath} (${preview}...)`);
    }

    return {
      src: processedContent,
      path: filePath,
      noCache: true  // Don't cache - files may change
    };
  }

  /**
   * Process a .prmd file: parse frontmatter and return only the body.
   */
  private processPrompdFile(content: string, filePath: string): string {
    try {
      const parsed = this.parser.parseContent(content);

      if (this.verbose) {
        const paramCount = parsed.metadata?.parameters?.length || 0;
        console.log(`[include] Parsed .prmd: ${filePath} (${paramCount} params)`);
      }

      // Return just the body content (after frontmatter)
      // If no body, return empty string
      return parsed.content || '';
    } catch (error) {
      // If parsing fails, log warning and return raw content
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (this.verbose) {
        console.log(`[include] Warning: Failed to parse ${filePath}: ${errorMessage}`);
      }

      // Fall back to raw content minus frontmatter
      // Simple regex to strip frontmatter
      const withoutFrontmatter = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
      return withoutFrontmatter;
    }
  }

  /**
   * Resolve a path relative to the base directory.
   */
  private resolvePath(name: string): string {
    // Handle absolute paths
    if (isAbsolutePosix(name)) {
      return name;
    }

    // Handle relative paths (./file.prmd, ../file.prmd, file.prmd)
    return this.fileSystem.join(this.baseDir, name);
  }

  /**
   * Create a child loader for nested includes.
   * The child loader shares the compilation ID to use the same include stack.
   */
  createChildLoader(newBaseDir: string): PrompdLoader {
    return new PrompdLoader({
      fileSystem: this.fileSystem,
      baseDir: newBaseDir,
      verbose: this.verbose,
      maxDepth: this.maxDepth,
      compilationId: this.compilationId  // Share the compilation ID for cycle detection
    });
  }

  /**
   * Get the compilation ID for this loader.
   * Useful for cleanup after compilation.
   */
  getCompilationId(): string {
    return this.compilationId;
  }
}

/**
 * Create a Nunjucks environment configured with the Prompd loader.
 *
 * @param options - Loader options
 * @returns Configured Nunjucks environment
 */
export function createPrompdEnvironment(options: PrompdLoaderOptions): nunjucks.Environment {
  const loader = new PrompdLoader(options);

  const env = new nunjucks.Environment(loader, {
    autoescape: false,
    throwOnUndefined: false,
    trimBlocks: true,
    lstripBlocks: true,
    tags: {
      blockStart: '{%',
      blockEnd: '%}',
      variableStart: '{{',
      variableEnd: '}}',
      commentStart: '{#',
      commentEnd: '#}'
    }
  });

  return env;
}
