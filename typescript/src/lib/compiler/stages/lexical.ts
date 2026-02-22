/**
 * Lexical Analysis Stage - Parse YAML frontmatter + Markdown content.
 *
 * This stage parses the .prmd file into structured metadata and content,
 * populating the compilation context for subsequent stages.
 */

import { CompilerStage, CompilationContext } from '../types';
import { PrompdParser } from '../../parser';

export class LexicalAnalysisStage implements CompilerStage {
  private parser: PrompdParser;

  constructor() {
    this.parser = new PrompdParser();
  }

  async process(context: CompilationContext): Promise<void> {
    try {
      // Read file content from file system
      const fileContent = await context.fileSystem.readFile(context.sourceFile);

      // Store raw source for line number calculation in later stages
      context.rawSource = fileContent;

      // Parse the .prmd file content
      const prompd = this.parser.parseContent(fileContent, context.sourceFile);

      // Populate compilation context
      context.metadata = prompd.metadata;
      context.content = prompd.content;

      // Convert YAML-defined sections to markdown sections
      context.content = this.injectYamlSections(prompd.metadata, context.content);

      if (context.verbose) {
        console.log(`✓ Parsed file: ${context.sourceFile}`);
        console.log(`  - Name: ${prompd.metadata.name}`);
        console.log(`  - Version: ${prompd.metadata.version || 'N/A'}`);
        console.log(`  - Parameters: ${prompd.metadata.parameters?.length || 0}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Try to extract line number from YAML parser errors
      let line: number | undefined;
      let column: number | undefined;
      const lineMatch = errorMessage.match(/at line (\d+)(?:,? column (\d+))?/i);
      if (lineMatch) {
        line = parseInt(lineMatch[1], 10) + 1; // Add 1 for opening ---
        column = lineMatch[2] ? parseInt(lineMatch[2], 10) : 1;
      }

      context.addDiagnostic({
        message: `Lexical analysis failed: ${errorMessage}`,
        severity: 'error',
        source: 'lexical',
        line,
        column,
        code: 'PARSE_ERROR'
      });
    }
  }

  /**
   * Convert YAML-defined sections (system, user, assistant, etc.) to markdown sections.
   * These are appended to the content after any markdown-defined sections.
   */
  private injectYamlSections(metadata: any, content: string): string {
    const yamlSections: string[] = [];

    // Standard section order: system → context → task → user → assistant → response → output
    const sectionOrder = ['system', 'context', 'task', 'user', 'assistant', 'response', 'output'];

    for (const sectionName of sectionOrder) {
      const sectionValue = metadata[sectionName];

      if (sectionValue) {
        // Capitalize first letter for markdown heading
        const headingName = sectionName.charAt(0).toUpperCase() + sectionName.slice(1);

        if (Array.isArray(sectionValue)) {
          // Array of file paths - will be processed by asset extraction stage
          yamlSections.push(`# ${headingName}`);
          yamlSections.push(`[YAML section with ${sectionValue.length} file reference(s) - will be processed by asset extraction]`);
        } else if (typeof sectionValue === 'string') {
          // Direct string content or single file path
          yamlSections.push(`# ${headingName}`);
          yamlSections.push(sectionValue);
        }
      }
    }

    // Append YAML sections to existing content
    if (yamlSections.length > 0) {
      const yamlContent = yamlSections.join('\n\n');
      return content ? `${content}\n\n${yamlContent}` : yamlContent;
    }

    return content;
  }

  getName(): string {
    return 'Lexical Analysis';
  }
}
