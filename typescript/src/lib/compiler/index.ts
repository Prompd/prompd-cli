/**
 * Prompd Compiler - Node CLI entry point.
 *
 * The compilation engine (pipeline, stages, formatters, templating) lives in
 * @prompd/core. This module assembles the FULL Node pipeline (core stages plus
 * the Node-only AssetExtractionStage) and injects Node defaults (NodeFileSystem
 * + NodePackageResolver) so existing callers behave exactly as before. It also
 * re-exports @prompd/core so every existing `./compiler` import keeps working.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import {
  PrompdCompiler as CorePrompdCompiler,
  CompilerStage,
  CompilationOptions,
  CompilationContext,
  SecurityConfig,
  PrompdError,
  LexicalAnalysisStage,
  DependencyResolutionStage,
  SemanticAnalysisStage,
  TemplateProcessingStage,
  CodeGenerationStage
} from '@prompd/core';
import { AssetExtractionStage } from './stages/assets';
import { NodePackageResolver } from './node-package-resolver';
import { NodeFileSystem } from './file-system';

const nodePackageResolver = new NodePackageResolver();

/**
 * The full Node pipeline: core stages plus binary asset extraction.
 */
function createFullStages(): CompilerStage[] {
  return [
    new LexicalAnalysisStage(),
    new DependencyResolutionStage(),
    new SemanticAnalysisStage(),
    new AssetExtractionStage(),
    new TemplateProcessingStage(),
    new CodeGenerationStage()
  ];
}

/**
 * Node CLI compiler. Same public API as before (constructor takes an optional
 * SecurityConfig); adds binary asset extraction and writes outputFile to disk.
 */
export class PrompdCompiler extends CorePrompdCompiler {
  constructor(securityConfig?: SecurityConfig) {
    super({ stages: createFullStages(), securityConfig });
  }

  private withNodeDefaults(options: CompilationOptions): CompilationOptions {
    return {
      ...options,
      fileSystem: options.fileSystem || new NodeFileSystem(),
      packageResolver: options.packageResolver || nodePackageResolver
    };
  }

  async compile(source: string, options: CompilationOptions = {}): Promise<string> {
    await this.validateDiskSource(source, options);
    const opts = this.withNodeDefaults(options);
    const result = await super.compile(source, opts);

    // Preserve CLI behavior: write to outputFile when requested.
    if (opts.outputFile) {
      const outputPath = path.resolve(opts.outputFile);
      await fs.writeFile(outputPath, result, 'utf-8');
      if (opts.verbose) {
        console.log(`Compiled output written to: ${outputPath}`);
      }
    }

    return result;
  }

  async compileWithContext(source: string, options: CompilationOptions = {}): Promise<CompilationContext> {
    await this.validateDiskSource(source, options);
    return super.compileWithContext(source, this.withNodeDefaults(options));
  }

  /**
   * Node-side source validation for real disk compiles (no custom file system,
   * not a package reference): existence, allowed extension, size, regular-file,
   * and path-traversal checks. Mirrors the original pipeline preflight.
   */
  private async validateDiskSource(source: string, options: CompilationOptions): Promise<void> {
    if (options.fileSystem || source.startsWith('@')) {
      return; // custom FS (e.g. MemoryFileSystem) or package ref - not a disk path
    }

    if (!(await fs.pathExists(source))) {
      throw new PrompdError(`Source file not found: ${source}`);
    }

    const ext = path.extname(source).toLowerCase();
    if (!this.securityConfig.allowedExtensions.includes(ext)) {
      throw new PrompdError(`File extension not allowed: ${ext}`);
    }

    const stats = await fs.stat(source);
    if (stats.size > this.securityConfig.maxFileSize) {
      throw new PrompdError(`File too large: ${stats.size} bytes (max: ${this.securityConfig.maxFileSize})`);
    }
    if (!stats.isFile()) {
      throw new PrompdError(`Source must be a regular file: ${source}`);
    }

    const resolvedPath = path.resolve(source);
    if (resolvedPath !== source && !source.startsWith('.')) {
      if (path.normalize(source).includes('..')) {
        throw new PrompdError(`Path traversal detected: ${source}`);
      }
    }
  }
}

/**
 * Convenience function for quick compilation (Node, full pipeline).
 */
export async function compile(
  source: string,
  outputFormat: string = 'markdown',
  parameters: Record<string, any> = {},
  outputFile?: string
): Promise<string> {
  const compiler = new PrompdCompiler();
  return compiler.compile(source, { outputFormat, parameters, outputFile });
}

// Re-export the core engine (PrompdCompiler + compile are overridden above).
export * from '@prompd/core';

// Node-only additions / overrides.
export { NodeFileSystem, MemoryFileSystem, getDefaultFileSystem } from './file-system';
export { AssetExtractionStage } from './stages/assets';
export { NodePackageResolver } from './node-package-resolver';
export {
  findProjectRoot,
  resolvePackage,
  resolvePackageFile,
  isPackageInstalled,
  parsePackageReference,
  parsePackageReferenceWithPath,
  getLocalBaseDir,
  getGlobalBaseDir
} from './package-resolver';
