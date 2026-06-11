/**
 * @prompd/core compiler — environment-agnostic assembly.
 *
 * Assembles the browser/server-safe compilation pipeline:
 *   Lexical -> Dependency -> Semantic -> Template -> CodeGeneration
 *
 * The binary AssetExtractionStage (sharp/pdf/exceljs/mammoth) is Node-only and
 * lives in @prompd/cli, which assembles the full pipeline. Package/inheritance
 * resolution is injected via IPackageResolver (also Node-only); without it, the
 * dependency stage emits a diagnostic and single-file compilation still works.
 */

import { CompilerPipeline } from './pipeline';
import {
  CompilationOptions,
  CompilationContext,
  CompilerStage,
  DEFAULT_SECURITY_CONFIG,
  SecurityConfig
} from './types';
import { CompilationError } from '../errors';
import { LexicalAnalysisStage } from './stages/lexical';
import { DependencyResolutionStage } from './stages/dependency';
import { SemanticAnalysisStage } from './stages/semantic';
import { TemplateProcessingStage } from './stages/template';
import { CodeGenerationStage } from './stages/codegen';

/**
 * Default browser/server-safe stage set (no binary asset extraction).
 */
export function createCoreStages(): CompilerStage[] {
  return [
    new LexicalAnalysisStage(),
    new DependencyResolutionStage(),
    new SemanticAnalysisStage(),
    new TemplateProcessingStage(),
    new CodeGenerationStage()
  ];
}

/**
 * High-level compiler. Defaults to the core (browser-safe) stage set; callers
 * such as @prompd/cli pass a custom stage list (adding asset extraction).
 */
export class PrompdCompiler {
  protected pipeline: CompilerPipeline;
  protected securityConfig: SecurityConfig;

  constructor(options: { stages?: CompilerStage[]; securityConfig?: SecurityConfig } = {}) {
    this.securityConfig = options.securityConfig || DEFAULT_SECURITY_CONFIG;
    this.pipeline = new CompilerPipeline(options.stages || createCoreStages(), this.securityConfig);
  }

  /**
   * Compile a .prmd source to a string. Throws CompilationError on errors.
   */
  async compile(source: string, options: CompilationOptions = {}): Promise<string> {
    const context = await this.pipeline.execute(source, options);

    if (context.hasErrors()) {
      const errorMessages = context.errors.join('\n  - ');
      throw new CompilationError(`Compilation failed:\n  - ${errorMessages}`);
    }

    const result = context.compiledResult || '';
    return typeof result === 'string' ? result : new TextDecoder().decode(result);
  }

  /**
   * Compile and return the full context (output + diagnostics, no throw).
   */
  async compileWithContext(source: string, options: CompilationOptions = {}): Promise<CompilationContext> {
    return this.pipeline.execute(source, options);
  }

  /** Access the underlying pipeline (advanced customization). */
  getPipeline(): CompilerPipeline {
    return this.pipeline;
  }
}

/**
 * Convenience function for quick single-file compilation.
 */
export async function compile(
  source: string,
  outputFormat: string = 'markdown',
  parameters: Record<string, any> = {},
  options: Omit<CompilationOptions, 'outputFormat' | 'parameters'> = {}
): Promise<string> {
  const compiler = new PrompdCompiler();
  return compiler.compile(source, { outputFormat, parameters, ...options });
}

// Re-export the building blocks.
export * from './types';
export * from './pipeline';
export * from './file-system';
export * from './package-ref';
export * from './language-map';
export * from './path-utils';
export { LexicalAnalysisStage } from './stages/lexical';
export { DependencyResolutionStage } from './stages/dependency';
export { SemanticAnalysisStage } from './stages/semantic';
export { TemplateProcessingStage } from './stages/template';
export { CodeGenerationStage } from './stages/codegen';
export { SectionOverrideProcessor } from './section-override';
export { PrompdLoader, createPrompdEnvironment } from './prompd-loader';
export { MarkdownFormatter } from './formatters/markdown';
export { OpenAIFormatter } from './formatters/openai';
export { AnthropicFormatter } from './formatters/anthropic';
