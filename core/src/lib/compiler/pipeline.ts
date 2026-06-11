/**
 * Compilation pipeline orchestrator.
 *
 * Manages the execution of the 6-stage compilation pipeline, ensuring stages
 * run in order and errors are properly propagated.
 */

import {
  CompilationContext,
  CompilationOptions,
  CompilerStage,
  DEFAULT_SECURITY_CONFIG,
  SecurityConfig,
  IPackageResolver
} from './types';
import { PrompdError } from '../errors';
import { IFileSystem } from './file-system';
import { parsePackageReferenceWithPath, resolvePackageFile } from './package-ref';
import { isPrompdFile } from './path-utils';

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
    // @prompd/core requires an injected file system (MemoryFileSystem in the
    // browser/server). The Node CLI supplies NodeFileSystem.
    const fileSystem = options.fileSystem;
    if (!fileSystem) {
      throw new PrompdError('A fileSystem must be provided to the compiler (e.g. MemoryFileSystem).');
    }

    // Resolve source (handles both file paths and package references)
    const sourcePath = await this.resolveSource(source, fileSystem, options.packageResolver, options.registryUrl, options.workspaceRoot);

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
  private async resolveSource(source: string, fileSystem: IFileSystem, packageResolver?: IPackageResolver, registryUrl?: string, workspaceRoot?: string): Promise<string> {
    // Check if it's a package reference (starts with @)
    if (source.startsWith('@')) {
      if (!packageResolver) {
        throw new PrompdError(
          `Package resolution is unavailable in this environment: ${source}. ` +
          `Compile via the backend, or provide a packageResolver in the compilation options.`
        );
      }

      try {
        // Check if the reference includes a specific file path
        const { filePath } = parsePackageReferenceWithPath(source);

        // resolvePackage handles stripping the file path internally
        const packagePath = await packageResolver.resolvePackage(source, {
          fileSystem,
          registryUrl,
          workspaceRoot
        });

        // If a specific file was requested, resolve it within the package
        if (filePath) {
          return resolvePackageFile(packagePath, filePath);
        }

        // No specific file — find the main .prmd file in the package
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

    // Regular path: with a virtual/in-memory file system, paths like
    // '/main.prmd' stay as-is (no disk resolution).
    return source;
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
        } else if (isPrompdFile(entry)) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Ignore errors (directory not accessible, etc.)
    }

    return files;
  }

  /**
   * Get registered stages.
   */
  getStages(): CompilerStage[] {
    return [...this.stages];
  }
}
