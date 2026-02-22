/**
 * Markdown Output Formatter
 *
 * Formats compiled prompts as human-readable markdown with optional YAML frontmatter.
 */

import * as yaml from 'yaml';
import { OutputFormatter, CompiledPrompt } from '../types';

export class MarkdownFormatter implements OutputFormatter {
  name = 'markdown';
  fileExtension = '.md';
  mimeType = 'text/markdown';

  async format(compiled: CompiledPrompt): Promise<string> {
    const output: string[] = [];

    // Add metadata as YAML frontmatter comment (only in verbose mode)
    if (compiled.verbose && compiled.metadata) {
      output.push('<!-- PROMPD METADATA');
      const cleanMetadata = this.cleanMetadataForDisplay(compiled.metadata);
      output.push(yaml.stringify(cleanMetadata));
      output.push('-->');
      output.push('');
    }

    // Add extracted contexts as sections
    if (compiled.contexts && compiled.contexts.length > 0) {
      output.push('# Extracted Context Files');
      output.push('');
      for (const ctx of compiled.contexts) {
        output.push(ctx);
        output.push('');
      }
    }

    // Add main content (clean output without extra headers by default)
    if (compiled.content) {
      if (compiled.verbose) {
        output.push('# Main Prompt Content');
        output.push('');
      }
      output.push(compiled.content);
    }

    return output.join('\n');
  }

  /**
   * Clean metadata dictionary for YAML display, converting complex objects to strings.
   */
  private cleanMetadataForDisplay(metadata: any): any {
    if (typeof metadata !== 'object' || metadata === null) {
      return metadata;
    }

    if (Array.isArray(metadata)) {
      return metadata.map(item => this.cleanMetadataForDisplay(item));
    }

    const cleaned: any = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (value === undefined) {
        continue; // Skip undefined values
      }

      // Handle enums and complex objects
      if (typeof value === 'object' && value !== null) {
        if ('value' in value) {
          // Enum object - return its string value
          cleaned[key] = value.value;
        } else if (Array.isArray(value)) {
          cleaned[key] = value.map(item => this.cleanMetadataForDisplay(item));
        } else {
          cleaned[key] = this.cleanMetadataForDisplay(value);
        }
      } else {
        cleaned[key] = value;
      }
    }

    return cleaned;
  }
}
