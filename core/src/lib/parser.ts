import * as yaml from 'yaml';
import { PrompdFile, PrompdMetadata, ValidationIssue } from '../types';

/**
 * Environment-agnostic .prmd parser. Pure string -> structure; no file system.
 * The Node CLI subclasses this to add fs-backed parseFile()/validateFile().
 */
export class PrompdParser {
  parseContent(content: string, _filePath?: string): PrompdFile {
    // Remove BOM if present and normalize line endings (CRLF -> LF)
    const cleanContent = content
      .replace(/^\ufeff/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    if (!cleanContent.startsWith('---\n')) {
      throw new Error('File must start with YAML frontmatter (---)');
    }

    // Find the closing --- delimiter (must be on its own line)
    // We search after the opening --- to find the first \n---\n or \n--- at end
    const afterOpening = cleanContent.slice(4); // Skip opening "---\n"
    const closingIndex = afterOpening.indexOf('\n---\n');
    const closingAtEnd = afterOpening.indexOf('\n---');

    // Determine the actual closing delimiter position
    let delimiterIndex = -1;
    if (closingIndex !== -1) {
      delimiterIndex = closingIndex;
    } else if (closingAtEnd !== -1 && afterOpening.substring(closingAtEnd) === '\n---') {
      // Handle case where --- is at the very end with no trailing newline
      delimiterIndex = closingAtEnd;
    }

    if (delimiterIndex === -1) {
      throw new Error('Invalid frontmatter format');
    }

    const yamlContent = afterOpening.substring(0, delimiterIndex);
    // +4 to skip past "\n---\n" or +4 to skip past "\n---" if at end
    const bodyStart = delimiterIndex + 4;
    const markdownContent = bodyStart < afterOpening.length ? afterOpening.substring(bodyStart) : '';

    let metadata: PrompdMetadata;
    try {
      metadata = yaml.parse(yamlContent) as PrompdMetadata;
    } catch (error) {
      throw new Error(`Failed to parse YAML frontmatter: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    
    // Validate required fields
    if (!metadata.id) {
      throw new Error('id field is required');
    }
    
    // Validate ID follows kebab-case
    const kebabCaseRegex = /^[a-z0-9-]+$/;
    if (!kebabCaseRegex.test(metadata.id)) {
      throw new Error(`id '${metadata.id}' must use kebab-case (lowercase letters, numbers, hyphens only)`);
    }

    // Extract sections from markdown content
    const sections: Record<string, string> = {};
    const sectionRegex = /^## (.+)$/gm;
    let match;
    while ((match = sectionRegex.exec(markdownContent)) !== null) {
      sections[match[1].toLowerCase()] = match[1];
    }

    return {
      metadata,
      content: markdownContent.trim(),
      sections
    };
  }

  /**
   * Parse + validate .prmd content. Pure (no file system) so it runs in the
   * browser. Returns parse errors as a single issue when content is malformed.
   */
  validateContent(content: string, _filePath?: string): ValidationIssue[] {
    let prompd: PrompdFile;
    try {
      prompd = this.parseContent(content, _filePath);
    } catch (error) {
      return [{
        level: 'error',
        message: error instanceof Error ? error.message : 'Unknown parsing error'
      }];
    }
    return this.validatePrompdFile(prompd);
  }

  protected validatePrompdFile(prompd: PrompdFile): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Validate required fields
    if (!prompd.metadata.name) {
      issues.push({
        level: 'error',
        message: 'name field is required'
      });
    }

    // Validate semantic version if present
    if (prompd.metadata.version && !this.isValidSemver(prompd.metadata.version)) {
      issues.push({
        level: 'error',
        message: `invalid semantic version: ${prompd.metadata.version}`
      });
    }

    // Validate parameter references
    const variables = new Set<string>();
    
    // Check both parameters and variables fields for backward compatibility
    const allParams = [
      ...(prompd.metadata.parameters || []),
      ...(prompd.metadata.variables || [])
    ];

    for (const param of allParams) {
      if (!param.name) {
        issues.push({
          level: 'error',
          message: 'parameter name cannot be empty'
        });
        continue;
      }
      variables.add(param.name);

      // Validate parameter type
      const validTypes = ['string', 'number', 'boolean', 'array', 'object'];
      if (!validTypes.includes(param.type)) {
        issues.push({
          level: 'error',
          message: `invalid parameter type: ${param.type}. Must be one of: ${validTypes.join(', ')}`
        });
      }

      // Validate pattern for string parameters
      if (param.pattern && param.type !== 'string') {
        issues.push({
          level: 'warning',
          message: `pattern validation only applies to string parameters: ${param.name}`
        });
      }

      // Validate minimum/maximum for number parameters
      if ((param.minimum !== undefined || param.maximum !== undefined) && param.type !== 'number') {
        issues.push({
          level: 'warning',
          message: `minimum/maximum validation only applies to number parameters: ${param.name}`
        });
      }
    }

    // Check for variable references in content
    const variableReferences = prompd.content.match(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g);
    if (variableReferences) {
      for (const ref of variableReferences) {
        const varName = ref.slice(1, -1); // Remove { and }
        if (!variables.has(varName) && varName !== 'inputs') {
          issues.push({
            level: 'error',
            message: `undefined variable referenced: ${varName}`
          });
        }
      }
    }

    return issues;
  }

  private isValidSemver(version: string): boolean {
    const semverRegex = /^(\d+)\.(\d+)\.(\d+)$/;
    return semverRegex.test(version);
  }
}