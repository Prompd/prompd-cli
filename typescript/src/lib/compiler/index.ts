/**
 * Prompd Compiler - Main Entry Point
 *
 * The 6-stage compilation pipeline for transforming .prmd files into various output formats.
 * This is the npm CLI's complete port of the Python CLI's compiler with full feature parity.
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import { CompilerPipeline } from './pipeline';
import { CompilationOptions, CompilationContext, DEFAULT_SECURITY_CONFIG, SecurityConfig } from './types';
import { LexicalAnalysisStage } from './stages/lexical';
import { DependencyResolutionStage } from './stages/dependency';
import { SemanticAnalysisStage } from './stages/semantic';
import { AssetExtractionStage } from './stages/assets';
import { TemplateProcessingStage } from './stages/template';
import { CodeGenerationStage } from './stages/codegen';
import { PrompdError, CompilationError } from '../errors';

/**
 * High-level compiler interface.
 *
 * Provides a simple API for compiling .prmd files to various output formats.
 */
export class PrompdCompiler {
  private pipeline: CompilerPipeline;
  private securityConfig: SecurityConfig;

  constructor(securityConfig?: SecurityConfig) {
    this.securityConfig = securityConfig || DEFAULT_SECURITY_CONFIG;

    // Create pipeline with default stages
    const stages = [
      new LexicalAnalysisStage(),
      new DependencyResolutionStage(),
      new SemanticAnalysisStage(),
      new AssetExtractionStage(),
      new TemplateProcessingStage(),
      new CodeGenerationStage()
    ];

    this.pipeline = new CompilerPipeline(stages, this.securityConfig);
  }

  /**
   * Compile a .prmd file to the specified format.
   *
   * @param source - Path to .prmd file or package reference
   * @param options - Compilation options
   * @returns Compiled content as string
   */
  async compile(source: string, options: CompilationOptions = {}): Promise<string> {
    // Execute pipeline
    const context = await this.pipeline.execute(source, options);

    // Check for errors
    if (context.hasErrors()) {
      const errorMessages = context.errors.join('\n  - ');
      throw new CompilationError(`Compilation failed:\n  - ${errorMessages}`);
    }

    // Display warnings
    if (context.warnings.length > 0 && options.verbose) {
      for (const warning of context.warnings) {
        console.log(`Warning: ${warning}`);
      }
    }

    // Write to output file if specified
    if (options.outputFile && context.compiledResult) {
      const outputPath = path.resolve(options.outputFile);
      const content = typeof context.compiledResult === 'string'
        ? context.compiledResult
        : context.compiledResult.toString('utf-8');
      await fs.writeFile(outputPath, content, 'utf-8');

      if (options.verbose) {
        console.log(`✓ Compiled output written to: ${outputPath}`);
      }
    }

    const result = context.compiledResult || '';
    return typeof result === 'string' ? result : result.toString('utf-8');
  }

  /**
   * Compile with detailed context (for advanced usage).
   *
   * @param source - Path to .prmd file or package reference
   * @param options - Compilation options
   * @returns Complete compilation context with metadata
   */
  async compileWithContext(source: string, options: CompilationOptions = {}): Promise<CompilationContext> {
    return await this.pipeline.execute(source, options);
  }

  /**
   * Get the underlying pipeline (for advanced customization).
   */
  getPipeline(): CompilerPipeline {
    return this.pipeline;
  }
}

/**
 * Convenience function for quick compilation.
 */
export async function compile(
  source: string,
  outputFormat: string = 'markdown',
  parameters: Record<string, any> = {},
  outputFile?: string
): Promise<string> {
  const compiler = new PrompdCompiler();
  return await compiler.compile(source, {
    outputFormat,
    parameters,
    outputFile
  });
}

// Export all types and classes
export * from './types';
export * from './pipeline';
export * from './file-system';
export { LexicalAnalysisStage } from './stages/lexical';
export { DependencyResolutionStage } from './stages/dependency';
export { SemanticAnalysisStage } from './stages/semantic';
export { AssetExtractionStage } from './stages/assets';
export { TemplateProcessingStage } from './stages/template';
export { CodeGenerationStage } from './stages/codegen';
export { SectionOverrideProcessor } from './section-override';
export { MarkdownFormatter } from './formatters/markdown';
export { OpenAIFormatter } from './formatters/openai';
export { AnthropicFormatter } from './formatters/anthropic';
export { findProjectRoot, resolvePackage, resolvePackageFile, isPackageInstalled, parsePackageReference, getLocalBaseDir, getGlobalBaseDir } from './package-resolver';
