/**
 * Code Generation Stage
 *
 * Generates output in the target format using registered formatters.
 */

import { CompilerStage, CompilationContext, OutputFormatter, CompiledPrompt } from '../types';
import { MarkdownFormatter } from '../formatters/markdown';
import { OpenAIFormatter } from '../formatters/openai';
import { AnthropicFormatter } from '../formatters/anthropic';

export class CodeGenerationStage implements CompilerStage {
  private formatters: Map<string, OutputFormatter>;

  constructor(formatters?: Map<string, OutputFormatter>) {
    this.formatters = formatters || new Map();

    // Register default formatters
    this.registerFormatter(new MarkdownFormatter());
    this.registerFormatter(new OpenAIFormatter());
    this.registerFormatter(new AnthropicFormatter());
  }

  /**
   * Register a new output formatter.
   */
  registerFormatter(formatter: OutputFormatter): void {
    this.formatters.set(formatter.name, formatter);
  }

  async process(context: CompilationContext): Promise<void> {
    let formatName = context.outputFormat;

    // Handle legacy format names
    if (formatName.startsWith('to-')) {
      formatName = formatName.substring(3);
    }

    // Handle provider-json shorthand
    if (formatName === 'provider-json') {
      formatName = 'provider-json:openai'; // Default to OpenAI
    }

    const formatter = this.formatters.get(formatName);
    if (!formatter) {
      context.addError(`Unknown output format: ${formatName}`);
      return;
    }

    try {
      const compiled: CompiledPrompt = {
        metadata: context.metadata,
        content: context.content,
        contexts: context.contexts,
        parameters: context.parameters,
        verbose: context.verbose
      };

      context.compiledResult = await formatter.format(compiled);

      if (context.verbose) {
        console.log(`✓ Generated output in format: ${formatName}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      context.addError(`Code generation failed: ${errorMessage}`);
    }
  }

  getName(): string {
    return 'Code Generation';
  }
}
