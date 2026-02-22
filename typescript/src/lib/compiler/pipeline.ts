/**
 * Compilation pipeline orchestrator.
 *
 * Manages the execution of the 6-stage compilation pipeline, ensuring stages
 * run in order and errors are properly propagated.
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import {
  CompilationContext,
  CompilationOptions,
  CompilerStage,
  DEFAULT_SECURITY_CONFIG,
  SecurityConfig
} from './types';
import { PrompdError } from '../errors';
import { getDefaultFileSystem, IFileSystem } from './file-system';

/**
 * The main compiler pipeline orchestrator.
 */
export class CompilerPipeline {
  private stages: CompilerStage[];
  private securityConfig: SecurityConfig;

  constructor(stages?: CompilerStage[], securityConfig?: SecurityConfig) {
    this.stages = stages || [];
    this.securityConfig = securityConfig || DEFAULT_SECURITY_CONFIG;
  }

  /**
   * Register a compilation stage.
   */
  registerStage(stage: CompilerStage): void {
    this.stages.push(stage);
  }

  /**
   * Execute the compilation pipeline.
   *
   * @param source - Path to .prmd file or package reference
   * @param options - Compilation options
   * @returns Compilation context with result or errors
   */
  async execute(source: string, options: CompilationOptions = {}): Promise<CompilationContext> {
    // Set file system early (use provided or default to Node.js fs)
    const fileSystem = options.fileSystem || getDefaultFileSystem();

    // Resolve source (handles both file paths and package references)
    const sourcePath = await this.resolveSource(source, fileSystem, options.fileSystem, options.registryUrl, options.workspaceRoot);

    // Security: Validate file exists and is within allowed paths (skip if using custom FS)
    if (!options.fileSystem) {
      await this.validateSourceFile(sourcePath);
    }

    // Create compilation context
    const context = new CompilationContext(sourcePath, options);

    // Set file system
    context.fileSystem = fileSystem;

    // Run each stage in sequence
    // Continue through all stages to accumulate all errors (don't stop at first error)
    for (const stage of this.stages) {
      try {
        if (context.verbose) {
          console.log(`Running stage: ${stage.getName()}`);
        }
        await stage.process(context);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        context.addError(`${stage.getName()} failed: ${errorMessage}`);
        // Continue to next stage to find additional errors
      }
    }

    return context;
  }

  /**
   * Resolve source to file path (handles package references).
   *
   * @param source - Package reference or file path
   * @param fileSystem - File system to use for resolution
   * @param customFileSystem - Optional custom file system (used to detect in-memory mode)
   * @param registryUrl - Optional registry URL for package resolution
   * @param workspaceRoot - Optional workspace root for package cache location
   */
  private async resolveSource(source: string, fileSystem: IFileSystem, customFileSystem?: IFileSystem, registryUrl?: string, workspaceRoot?: string): Promise<string> {
    // Check if it's a package reference (starts with @)
    if (source.startsWith('@')) {
      // Import package resolver
      const { resolvePackage } = await import('./package-resolver');

      try {
        // Pass options to resolvePackage for proper package resolution
        const packagePath = await resolvePackage(source, {
          fileSystem,
          registryUrl,
          workspaceRoot
        });

        // Find the main .prmd file in the package
        const prmdFiles = await this.findPromdFiles(packagePath, fileSystem);

        if (prmdFiles.length === 0) {
          throw new Error(`No .prmd files found in package: ${source}`);
        }

        // Use the first .prmd file (or could look for main.prmd)
        return prmdFiles[0];
      } catch (error) {
        throw new PrompdError(`Failed to resolve package ${source}: ${error}`);
      }
    }

    // Regular file path
    if (customFileSystem) {
      // Custom file system (e.g., MemoryFileSystem) - don't resolve to absolute OS path
      // Virtual paths like '/main.prmd' should stay as-is
      return source;
    }

    // Disk-based file system - resolve to absolute path
    return path.resolve(source);
  }

  /**
   * Find all .prmd files in a directory.
   *
   * @param dir - Directory path
   * @param fileSystem - File system to use
   */
  private async findPromdFiles(dir: string, fileSystem: IFileSystem): Promise<string[]> {
    const files: string[] = [];

    try {
      // Use fileSystem abstraction instead of fs module
      const entries = await fileSystem.readdir(dir);

      for (const entry of entries) {
        const fullPath = fileSystem.join(dir, entry);

        if (await fileSystem.isDirectory(fullPath)) {
          // Recursively search subdirectories
          const subFiles = await this.findPromdFiles(fullPath, fileSystem);
          files.push(...subFiles);
        } else if (entry.endsWith('.prmd')) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Ignore errors (directory not accessible, etc.)
    }

    return files;
  }

  /**
   * Validate source file for security.
   */
  private async validateSourceFile(sourcePath: string): Promise<void> {
    // Security: Check file exists
    if (!await fs.pathExists(sourcePath)) {
      throw new PrompdError(`Source file not found: ${sourcePath}`);
    }

    // Security: Check file extension
    const ext = path.extname(sourcePath).toLowerCase();
    if (!this.securityConfig.allowedExtensions.includes(ext)) {
      throw new PrompdError(`File extension not allowed: ${ext}`);
    }

    // Security: Check file size
    const stats = await fs.stat(sourcePath);
    if (stats.size > this.securityConfig.maxFileSize) {
      throw new PrompdError(
        `File too large: ${stats.size} bytes (max: ${this.securityConfig.maxFileSize})`
      );
    }

    // Security: Ensure it's a regular file (not symlink, device, etc.)
    if (!stats.isFile()) {
      throw new PrompdError(`Source must be a regular file: ${sourcePath}`);
    }

    // Security: Path traversal protection - ensure resolved path is valid
    const resolvedPath = path.resolve(sourcePath);
    if (resolvedPath !== sourcePath && !sourcePath.startsWith('.')) {
      // Allow relative paths but validate they don't escape via ..
      const normalized = path.normalize(sourcePath);
      if (normalized.includes('..')) {
        throw new PrompdError(`Path traversal detected: ${sourcePath}`);
      }
    }
  }

  /**
   * Get registered stages.
   */
  getStages(): CompilerStage[] {
    return [...this.stages];
  }
}
