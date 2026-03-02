/**
 * Template Processing Stage
 *
 * Processes Jinja2/Nunjucks templates, package references, and section overrides.
 * This is the most complex stage, handling:
 * - Nunjucks template rendering with custom filters (fromcsv, fromjson, tojson, lines)
 * - Package reference resolution and content injection
 * - Inheritance processing with section-aware merging
 * - Enhanced variable substitution with nested property access
 */

import * as nunjucks from 'nunjucks';
import * as path from 'path';
import { CompilerStage, CompilationContext } from '../types';
import { PrompdParser } from '../../parser';
import { SectionOverrideProcessor } from '../section-override';
import { resolvePackageFile } from '../package-resolver';
import { getLanguageAliasesForExtension } from '../language-map';
import { PrompdLoader } from '../prompd-loader';

export class TemplateProcessingStage implements CompilerStage {
  private sectionProcessor: SectionOverrideProcessor;
  private nunjucksEnv: nunjucks.Environment;

  constructor() {
    this.sectionProcessor = new SectionOverrideProcessor();

    // Configure Nunjucks to use double braces for variables (standard Jinja2/Nunjucks syntax)
    this.nunjucksEnv = new nunjucks.Environment(null, {
      autoescape: false, // Don't escape HTML - we're doing markdown
      throwOnUndefined: false, // Gracefully handle missing variables
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

    // Register custom filters
    this.registerFilters();
  }

  /**
   * Register custom Jinja2/Nunjucks filters for data transformation.
   */
  private registerFilters(): void {
    // fromcsv - Parse CSV string into array of objects
    this.nunjucksEnv.addFilter('fromcsv', (csvString: string) => {
      if (!csvString || typeof csvString !== 'string') {
        return [];
      }
      return this.parseCsv(csvString);
    });

    // fromjson - Parse JSON string into object/array.
    // If the value is already a parsed object or array (e.g. from a JSON params file),
    // pass it through unchanged instead of returning null.
    this.nunjucksEnv.addFilter('fromjson', (value: unknown) => {
      if (value === null || value === undefined) return null;
      if (typeof value !== 'string') return value; // already parsed
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    });

    // tojson - Convert object to JSON string
    this.nunjucksEnv.addFilter('tojson', (obj: unknown, indent?: number) => {
      try {
        return JSON.stringify(obj, null, indent);
      } catch {
        return '{}';
      }
    });

    // lines - Split string into array of lines
    this.nunjucksEnv.addFilter('lines', (str: string) => {
      if (!str || typeof str !== 'string') {
        return [];
      }
      return str.split(/\r?\n/);
    });

    // dedent - Remove common leading whitespace from text
    this.nunjucksEnv.addFilter('dedent', (str: string) => {
      if (!str || typeof str !== 'string') {
        return '';
      }
      const lines = str.split(/\r?\n/);
      // Find minimum indentation (ignoring empty lines)
      let minIndent = Infinity;
      for (const line of lines) {
        if (line.trim().length === 0) continue;
        const match = line.match(/^(\s*)/);
        if (match && match[1].length < minIndent) {
          minIndent = match[1].length;
        }
      }
      if (minIndent === Infinity) minIndent = 0;
      // Remove the common indent from all lines
      return lines.map(line => line.slice(minIndent)).join('\n');
    });

    // truncate - Truncate string with ellipsis
    this.nunjucksEnv.addFilter('truncate', (str: string, length: number = 80, suffix: string = '...') => {
      if (!str || typeof str !== 'string') {
        return '';
      }
      if (str.length <= length) {
        return str;
      }
      return str.slice(0, length - suffix.length) + suffix;
    });

    // codeblock - Wrap content in fenced code block
    this.nunjucksEnv.addFilter('codeblock', (str: string, language: string = '') => {
      if (!str || typeof str !== 'string') {
        return '';
      }
      return '```' + language + '\n' + str + '\n```';
    });

    // unique - Remove duplicate items from array
    this.nunjucksEnv.addFilter('unique', (arr: unknown[]) => {
      if (!Array.isArray(arr)) {
        return [];
      }
      return [...new Set(arr)];
    });

    // pluck - Extract single field from array of objects
    this.nunjucksEnv.addFilter('pluck', (arr: Record<string, unknown>[], field: string) => {
      if (!Array.isArray(arr)) {
        return [];
      }
      return arr.map(item => item?.[field]).filter(v => v !== undefined);
    });

    // where - Filter objects by field value
    this.nunjucksEnv.addFilter('where', (arr: Record<string, unknown>[], field: string, value: unknown) => {
      if (!Array.isArray(arr)) {
        return [];
      }
      return arr.filter(item => item?.[field] === value);
    });

    // groupby - Group array items by field value
    this.nunjucksEnv.addFilter('groupby', (arr: Record<string, unknown>[], field: string) => {
      if (!Array.isArray(arr)) {
        return {};
      }
      const result: Record<string, Record<string, unknown>[]> = {};
      for (const item of arr) {
        const key = String(item?.[field] ?? 'undefined');
        if (!result[key]) {
          result[key] = [];
        }
        result[key].push(item);
      }
      return result;
    });

    // shuffle - Randomize array order
    this.nunjucksEnv.addFilter('shuffle', (arr: unknown[]) => {
      if (!Array.isArray(arr)) {
        return [];
      }
      const shuffled = [...arr];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    });

    // sample - Pick random N items from array
    this.nunjucksEnv.addFilter('sample', (arr: unknown[], count: number = 1) => {
      if (!Array.isArray(arr)) {
        return [];
      }
      const shuffled = [...arr];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.slice(0, Math.min(count, shuffled.length));
    });

    // wordwrap - Wrap text at specified width
    this.nunjucksEnv.addFilter('wordwrap', (str: string, width: number = 80) => {
      if (!str || typeof str !== 'string') {
        return '';
      }
      const words = str.split(/\s+/);
      const lines: string[] = [];
      let currentLine = '';
      for (const word of words) {
        if (currentLine.length + word.length + 1 <= width) {
          currentLine += (currentLine ? ' ' : '') + word;
        } else {
          if (currentLine) lines.push(currentLine);
          currentLine = word;
        }
      }
      if (currentLine) lines.push(currentLine);
      return lines.join('\n');
    });

    // bulletlist - Convert array/lines to bullet list
    this.nunjucksEnv.addFilter('bulletlist', (input: string | unknown[]) => {
      const items = Array.isArray(input) ? input : String(input).split(/\r?\n/);
      return items.filter(item => String(item).trim()).map(item => `- ${item}`).join('\n');
    });

    // numberedlist - Convert array/lines to numbered list
    this.nunjucksEnv.addFilter('numberedlist', (input: string | unknown[]) => {
      const items = Array.isArray(input) ? input : String(input).split(/\r?\n/);
      return items.filter(item => String(item).trim()).map((item, i) => `${i + 1}. ${item}`).join('\n');
    });
  }

  /**
   * Parse CSV string into array of record objects.
   */
  private parseCsv(csvString: string): Record<string, string>[] {
    const lines = csvString.trim().split(/\r?\n/);
    if (lines.length === 0) {
      return [];
    }

    // Parse header row
    const headers = this.parseCsvLine(lines[0]);

    // Parse data rows
    const records: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // Skip empty lines

      const values = this.parseCsvLine(line);
      const record: Record<string, string> = {};

      for (let j = 0; j < headers.length; j++) {
        const header = headers[j].trim();
        const value = values[j]?.trim() ?? '';
        record[header] = value;
      }

      records.push(record);
    }

    return records;
  }

  /**
   * Parse a single CSV line, handling quoted values.
   */
  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i++;
        } else {
          // Toggle quote mode
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current);
    return result;
  }

  async process(context: CompilationContext): Promise<void> {
    if (!context.content) {
      return;
    }

    let content = context.content;

    // Step 1: Process package references with prefixes (e.g., @security/prompts/audit)
    if (context.dependencies.imports) {
      content = await this.processPackageReferences(context, content);
    }

    // Step 2: Process inheritance with section-aware override support
    if (context.dependencies.inherits) {
      content = await this.processInheritance(context, content);
    }

    // Step 3: Process standalone overrides (without inheritance)
    if (context.metadata?.override && !context.dependencies.inherits) {
      content = await this.processStandaloneOverrides(context, content);
    }

    // Step 4: Filter code blocks based on context file types
    // If context files are attached, only keep code blocks that match those file extensions
    if (context.metadata?.context) {
      content = this.filterCodeBlocksByContext(context, content);
    }

    // Step 5: Process templates with Jinja2/Nunjucks
    content = await this.processTemplate(context, content);

    context.content = content;
  }

  /**
   * Process package references (e.g., @prefix/path/to/file).
   */
  private async processPackageReferences(context: CompilationContext, content: string): Promise<string> {
    if (!context.dependencies.imports) {
      return content;
    }

    for (const [packageRef, packageInfo] of Object.entries(context.dependencies.imports)) {
      if (!packageInfo.prefix || !packageInfo.path) {
        continue;
      }

      const prefix = packageInfo.prefix;
      const packagePath = packageInfo.path;

      // Replace references like @security/prompts/audit with actual content
      // Pattern: @prefix/path/to/resource
      const pattern = new RegExp(`@${this.escapeRegex(prefix)}/([^\\s]+)`, 'g');

      // Find all matches first
      const matches: Array<{ match: string; resourcePath: string; index: number }> = [];
      let match;
      while ((match = pattern.exec(content)) !== null) {
        matches.push({
          match: match[0],
          resourcePath: match[1],
          index: match.index
        });
      }

      // Replace in reverse order to preserve indices
      for (let i = matches.length - 1; i >= 0; i--) {
        const m = matches[i];
        const replacement = await this.loadPackageResource(context, packagePath, m.resourcePath, prefix);
        content = content.substring(0, m.index) + replacement + content.substring(m.index + m.match.length);
      }
    }

    return content;
  }

  /**
   * Load a resource from a package.
   */
  private async loadPackageResource(
    context: CompilationContext,
    packagePath: string,
    resourcePath: string,
    prefix: string
  ): Promise<string> {
    try {
      const fs = context.fileSystem;
      // Try different extensions
      const possibleExtensions = ['', '.prmd', '.md', '.txt'];

      for (const ext of possibleExtensions) {
        const filePath = resolvePackageFile(packagePath, resourcePath + ext);

        if (await fs.exists(filePath)) {
          const contentData = await fs.readFile(filePath);

          // If it's a .prmd file, parse and extract content
          if (filePath.endsWith('.prmd')) {
            const parser = new PrompdParser();
            try {
              const parsed = parser.parseContent(contentData);
              // Return just the content part, not metadata
              return parsed.content || `# Content from @${prefix}/${resourcePath}`;
            } catch {
              // If parsing fails, return raw content
              return contentData;
            }
          } else {
            // For other files, return as-is
            return contentData;
          }
        }
      }

      // File not found
      if (context.verbose) {
        console.log(`Warning: Could not find @${prefix}/${resourcePath} in ${packagePath}`);
      }
      return `[Not found: @${prefix}/${resourcePath}]`;
    } catch (error) {
      if (context.verbose) {
        console.log(`Warning: Failed to load @${prefix}/${resourcePath}: ${error}`);
      }
      return `[Error loading @${prefix}/${resourcePath}]`;
    }
  }

  /**
   * Process inheritance with section-aware merging.
   */
  private async processInheritance(context: CompilationContext, content: string): Promise<string> {
    const parentPath = context.dependencies.inherits;
    if (!parentPath) {
      return content;
    }

    try {
      const fs = context.fileSystem;
      const parser = new PrompdParser();
      let parentFile: string | null = null;

      // Check if it's a direct file path
      if (parentPath.endsWith('.prmd') && await fs.exists(parentPath)) {
        parentFile = parentPath;
      } else if (await fs.exists(parentPath) && await fs.isDirectory(parentPath)) {
        // Package directory - find main .prmd file
        const files = (await fs.readdir(parentPath)).filter((f: string) => f.endsWith('.prmd'));

        if (files.length > 0) {
          // Look for main.prmd first
          const mainFile = files.find((f: string) => f === 'main.prmd');
          parentFile = fs.join(parentPath, mainFile || files[0]);
        }
      }

      if (!parentFile) {
        // Find location of 'inherits:' in source for accurate error positioning
        const location = context.findLocation(/inherits:/);
        context.addDiagnostic({
          message: `Could not find inherited file: ${parentPath}`,
          severity: 'error',
          source: 'template',
          code: 'INHERITED_FILE_NOT_FOUND',
          ...location
        });
        return content;
      }

      // Parse parent file - read content from file system
      const parentFileContent = await fs.readFile(parentFile);
      const parentData = parser.parseContent(parentFileContent);

      // Get overrides from child metadata
      const overrides = context.metadata?.override || {};

      // Process content with section-aware merging
      if (parentData.content || content) {
        if (Object.keys(overrides).length > 0) {
          // Section-aware override processing
          try {
            // Extract sections from parent and child
            const parentSections = parentData.content
              ? this.sectionProcessor.extractSections(parentData.content)
              : new Map();
            const childSections = content
              ? this.sectionProcessor.extractSections(content)
              : new Map();

            // Determine base directory for resolving override files
            const baseDir = context.fileSystem.dirname(context.sourceFile);

            // Apply overrides and merge content
            const mergedContent = await this.sectionProcessor.applyOverrides(
              parentSections,
              childSections,
              overrides,
              baseDir,
              context.verbose,
              context.fileSystem
            );

            content = mergedContent;

            if (context.verbose) {
              console.log(`✓ Applied ${Object.keys(overrides).length} section overrides from parent: ${parentPath}`);
            }
          } catch (error) {
            // Fallback to simple concatenation on error
            const errorMessage = error instanceof Error ? error.message : String(error);
            context.addWarning(`Section override processing failed, using simple inheritance: ${errorMessage}`);

            if (parentData.content) {
              content = content ? `${parentData.content}\n\n${content}` : parentData.content;
            }
          }
        } else {
          // No overrides - use simple concatenation (backward compatibility)
          if (parentData.content) {
            content = content ? `${parentData.content}\n\n${content}` : parentData.content;
          }
        }
      }

      // Merge parent parameters (child parameters override)
      if (parentData.metadata?.parameters && context.metadata) {
        for (const parentParam of parentData.metadata.parameters) {
          // Only add parent parameter if not defined in child
          const paramExists = context.metadata.parameters?.some(
            childParam => childParam.name === parentParam.name
          );

          if (!paramExists) {
            if (!context.metadata.parameters) {
              context.metadata.parameters = [];
            }
            context.metadata.parameters.push(parentParam);
          }
        }
      }

      if (context.verbose) {
        console.log(`✓ Template inherits from: ${parentPath}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      context.addWarning(`Failed to process inheritance from ${parentPath}: ${errorMessage}`);
    }

    return content;
  }

  /**
   * Process standalone overrides (without inheritance).
   */
  private async processStandaloneOverrides(context: CompilationContext, content: string): Promise<string> {
    const overrides = context.metadata?.override;
    if (!overrides) {
      return content;
    }

    if (context.verbose) {
      console.log(`Processing ${Object.keys(overrides).length} standalone section overrides...`);
    }

    try {
      // Extract sections from current content
      const currentSections = this.sectionProcessor.extractSections(content);

      // Determine base directory for resolving override files
      const baseDir = context.fileSystem.dirname(context.sourceFile);

      // Apply each override to replace sections in current content
      for (const [sectionId, overridePath] of Object.entries(overrides)) {
        if (currentSections.has(sectionId)) {
          if (overridePath === null) {
            // Remove section
            currentSections.delete(sectionId);
            if (context.verbose) {
              console.log(`  - Removing section '${sectionId}'`);
            }
          } else if (typeof overridePath === 'string') {
            // Replace section content
            try {
              const overrideContent = await this.sectionProcessor.loadOverrideContent(
                overridePath,
                baseDir,
                context.fileSystem
              );

              // Update section with override content
              const originalSection = currentSections.get(sectionId)!;
              currentSections.set(sectionId, {
                ...originalSection,
                content: overrideContent
              });

              if (context.verbose) {
                console.log(`  - Replacing section '${sectionId}' with content from ${overridePath}`);
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              context.addWarning(`Failed to apply override for section '${sectionId}': ${errorMessage}`);
            }
          }
        } else {
          context.addWarning(`Override section '${sectionId}' not found in current content`);
          if (context.verbose) {
            const available = Array.from(currentSections.keys()).sort().join(', ');
            console.log(`Warning: Override section '${sectionId}' not found. Available: ${available}`);
          }
        }
      }

      // Reconstruct content from modified sections
      const contentParts: string[] = [];
      for (const section of currentSections.values()) {
        contentParts.push(section.content);
      }

      content = contentParts.join('\n\n');

      if (context.verbose) {
        console.log(`✓ Applied standalone overrides, final content has ${currentSections.size} sections`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      context.addWarning(`Standalone override processing failed: ${errorMessage}`);
    }

    return content;
  }

  /**
   * Filter code blocks in content based on context file types.
   *
   * When context files are attached (e.g., .ts files), this method filters
   * the prompt content to only keep code blocks that match those file types.
   *
   * Example:
   * - If context contains "typescript-examples.ts", keep only ```typescript blocks
   * - Non-code content and unmatched code blocks are preserved as plain text
   *
   * @param context - The compilation context with extracted contexts
   * @param content - The markdown content to filter
   * @returns Filtered content with only matching code blocks
   */
  private filterCodeBlocksByContext(context: CompilationContext, content: string): string {
    // Extract file extensions from context metadata
    const contextExtensions = this.extractContextExtensions(context.metadata?.context);

    if (contextExtensions.size === 0) {
      // No recognizable file extensions in context, return content unchanged
      return content;
    }

    // Build set of allowed language identifiers from context extensions
    const allowedLanguages = new Set<string>();
    for (const ext of contextExtensions) {
      const languages = getLanguageAliasesForExtension(ext);
      languages.forEach(lang => allowedLanguages.add(lang.toLowerCase()));
    }

    if (allowedLanguages.size === 0) {
      // No mapped languages found, return content unchanged
      return content;
    }

    if (context.verbose) {
      console.log(`Filtering code blocks for languages: ${Array.from(allowedLanguages).join(', ')}`);
    }

    // Parse and filter code blocks
    const result = this.filterCodeBlocks(content, allowedLanguages, context.verbose);

    if (context.verbose && result.removedCount > 0) {
      console.log(`Removed ${result.removedCount} non-matching code block(s)`);
    }

    return result.content;
  }

  /**
   * Extract file extensions from context metadata.
   * Context can be a single file path string or an array of file paths.
   */
  private extractContextExtensions(contextValue: string | string[] | undefined): Set<string> {
    const extensions = new Set<string>();

    if (!contextValue) {
      return extensions;
    }

    // Normalize to array
    const contextFiles = Array.isArray(contextValue) ? contextValue : [contextValue];

    for (const filePath of contextFiles) {
      if (typeof filePath === 'string') {
        const ext = path.extname(filePath).toLowerCase();
        if (ext) {
          extensions.add(ext);
        }
      }
    }

    return extensions;
  }

  /**
   * Filter code blocks in markdown content, keeping only those with matching languages.
   *
   * @param content - Markdown content with code blocks
   * @param allowedLanguages - Set of allowed language identifiers (lowercase)
   * @param verbose - Whether to log filtering actions
   * @returns Object with filtered content and count of removed blocks
   */
  private filterCodeBlocks(
    content: string,
    allowedLanguages: Set<string>,
    verbose: boolean
  ): { content: string; removedCount: number } {
    // Regex to match fenced code blocks: ```language\n...content...\n```
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;

    let removedCount = 0;
    const filteredContent = content.replace(codeBlockRegex, (match, language, blockContent) => {
      const lang = (language || '').toLowerCase().trim();

      // If no language specified, keep the block (could be plain text/output)
      if (!lang) {
        return match;
      }

      // Check if language is in allowed set
      if (allowedLanguages.has(lang)) {
        return match; // Keep matching blocks
      }

      // Remove non-matching code blocks
      removedCount++;
      if (verbose) {
        const preview = blockContent.substring(0, 50).replace(/\n/g, '\\n');
        console.log(`  - Removing \`\`\`${lang} block: "${preview}..."`);
      }

      // Remove the entire code block (return empty string)
      return '';
    });

    // Clean up multiple consecutive blank lines that may result from removal
    const cleanedContent = filteredContent.replace(/\n{3,}/g, '\n\n');

    return { content: cleanedContent, removedCount };
  }

  /**
   * Process template with Jinja2/Nunjucks.
   * Uses a context-aware environment with PrompdLoader to support {% include %}.
   */
  private async processTemplate(context: CompilationContext, content: string): Promise<string> {
    if (!content) {
      return content;
    }

    try {
      // Create a context-aware Nunjucks environment with the PrompdLoader
      // This enables {% include "file.prmd" %} directives
      const baseDir = context.fileSystem.dirname(context.sourceFile);
      const loader = new PrompdLoader({
        fileSystem: context.fileSystem,
        baseDir: baseDir,
        verbose: context.verbose,
        maxDepth: 10
      });

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

      // Register custom filters on this environment
      this.registerFiltersOnEnv(env);

      // Security: Set timeout for template rendering (prevent DoS)
      const renderTimeout = 5000; // 5 seconds
      const renderPromise = new Promise<string>((resolve, reject) => {
        try {
          const result = env.renderString(content, context.parameters);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      let timeoutId: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<string>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Template rendering timeout')), renderTimeout);
      });

      try {
        content = await Promise.race([renderPromise, timeoutPromise]);
      } finally {
        clearTimeout(timeoutId!);
      }
    } catch (error) {
      // Report template syntax errors properly
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Try to extract line/column from Nunjucks error message
      // Format: "(unknown path) [Line X, Column Y]" or similar
      const lineMatch = errorMessage.match(/\[Line (\d+), Column (\d+)\]/i) ||
                        errorMessage.match(/line (\d+)/i);

      const line = lineMatch ? parseInt(lineMatch[1], 10) : undefined;
      const column = lineMatch && lineMatch[2] ? parseInt(lineMatch[2], 10) : undefined;

      // Add as a compilation error (not just a warning)
      context.addDiagnostic({
        message: `Template syntax error: ${errorMessage}`,
        severity: 'error',
        source: 'template',
        code: 'TEMPLATE_SYNTAX_ERROR',
        line,
        column
      });

      // Still fall back to simple substitution so user sees partial output
      // but the error is now properly reported
      content = this.enhancedSimpleSubstitution(content, context.parameters);
    }

    return content;
  }

  /**
   * Register custom filters on a Nunjucks environment.
   */
  private registerFiltersOnEnv(env: nunjucks.Environment): void {
    // Override built-in string filters to handle undefined/null safely
    // This prevents "Cannot read properties of undefined" errors when template
    // variables are undefined during validation (e.g., package creation)

    // trim - safe version
    env.addFilter('trim', (str: unknown) => {
      if (str === undefined || str === null) return '';
      return String(str).trim();
    });

    // lower - safe version
    env.addFilter('lower', (str: unknown) => {
      if (str === undefined || str === null) return '';
      return String(str).toLowerCase();
    });

    // upper - safe version
    env.addFilter('upper', (str: unknown) => {
      if (str === undefined || str === null) return '';
      return String(str).toUpperCase();
    });

    // capitalize - safe version
    env.addFilter('capitalize', (str: unknown) => {
      if (str === undefined || str === null) return '';
      const s = String(str);
      return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    });

    // title - safe version (capitalize each word)
    env.addFilter('title', (str: unknown) => {
      if (str === undefined || str === null) return '';
      return String(str).replace(/\b\w/g, c => c.toUpperCase());
    });

    // replace - safe version
    env.addFilter('replace', (str: unknown, old: string, newStr: string, count?: number) => {
      if (str === undefined || str === null) return '';
      const s = String(str);
      if (count !== undefined) {
        // Replace only 'count' occurrences
        let result = s;
        let replaced = 0;
        while (replaced < count) {
          const idx = result.indexOf(old);
          if (idx === -1) break;
          result = result.slice(0, idx) + newStr + result.slice(idx + old.length);
          replaced++;
        }
        return result;
      }
      return s.split(old).join(newStr);
    });

    // striptags - safe version (remove HTML tags)
    env.addFilter('striptags', (str: unknown) => {
      if (str === undefined || str === null) return '';
      return String(str).replace(/<[^>]*>/g, '');
    });

    // urlencode - safe version
    env.addFilter('urlencode', (str: unknown) => {
      if (str === undefined || str === null) return '';
      return encodeURIComponent(String(str));
    });

    // fromcsv - Parse CSV string into array of objects
    env.addFilter('fromcsv', (csvString: string) => {
      if (!csvString || typeof csvString !== 'string') {
        return [];
      }
      return this.parseCsv(csvString);
    });

    // fromjson - Parse JSON string into object/array.
    // If the value is already a parsed object or array (e.g. from a JSON params file),
    // pass it through unchanged instead of returning null.
    env.addFilter('fromjson', (value: unknown) => {
      if (value === null || value === undefined) return null;
      if (typeof value !== 'string') return value; // already parsed
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    });

    // tojson - Convert object to JSON string
    env.addFilter('tojson', (obj: unknown, indent?: number) => {
      try {
        return JSON.stringify(obj, null, indent);
      } catch {
        return '{}';
      }
    });

    // lines - Split string into array of lines
    env.addFilter('lines', (str: string) => {
      if (!str || typeof str !== 'string') {
        return [];
      }
      return str.split(/\r?\n/);
    });

    // dedent - Remove common leading whitespace from text
    env.addFilter('dedent', (str: string) => {
      if (!str || typeof str !== 'string') {
        return '';
      }
      const lines = str.split(/\r?\n/);
      let minIndent = Infinity;
      for (const line of lines) {
        if (line.trim().length === 0) continue;
        const match = line.match(/^(\s*)/);
        if (match && match[1].length < minIndent) {
          minIndent = match[1].length;
        }
      }
      if (minIndent === Infinity) minIndent = 0;
      return lines.map(line => line.slice(minIndent)).join('\n');
    });

    // truncate - Truncate string with ellipsis
    env.addFilter('truncate', (str: string, length: number = 80, suffix: string = '...') => {
      if (!str || typeof str !== 'string') {
        return '';
      }
      if (str.length <= length) {
        return str;
      }
      return str.slice(0, length - suffix.length) + suffix;
    });

    // codeblock - Wrap content in fenced code block
    env.addFilter('codeblock', (str: string, language: string = '') => {
      if (!str || typeof str !== 'string') {
        return '';
      }
      return '```' + language + '\n' + str + '\n```';
    });

    // unique - Remove duplicate items from array
    env.addFilter('unique', (arr: unknown[]) => {
      if (!Array.isArray(arr)) {
        return [];
      }
      return [...new Set(arr)];
    });

    // pluck - Extract single field from array of objects
    env.addFilter('pluck', (arr: Record<string, unknown>[], field: string) => {
      if (!Array.isArray(arr)) {
        return [];
      }
      return arr.map(item => item?.[field]).filter(v => v !== undefined);
    });

    // where - Filter objects by field value
    env.addFilter('where', (arr: Record<string, unknown>[], field: string, value: unknown) => {
      if (!Array.isArray(arr)) {
        return [];
      }
      return arr.filter(item => item?.[field] === value);
    });

    // groupby - Group array items by field value
    env.addFilter('groupby', (arr: Record<string, unknown>[], field: string) => {
      if (!Array.isArray(arr)) {
        return {};
      }
      const result: Record<string, Record<string, unknown>[]> = {};
      for (const item of arr) {
        const key = String(item?.[field] ?? 'undefined');
        if (!result[key]) {
          result[key] = [];
        }
        result[key].push(item);
      }
      return result;
    });

    // shuffle - Randomize array order
    env.addFilter('shuffle', (arr: unknown[]) => {
      if (!Array.isArray(arr)) {
        return [];
      }
      const shuffled = [...arr];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    });

    // sample - Pick random N items from array
    env.addFilter('sample', (arr: unknown[], count: number = 1) => {
      if (!Array.isArray(arr)) {
        return [];
      }
      const shuffled = [...arr];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.slice(0, Math.min(count, shuffled.length));
    });

    // wordwrap - Wrap text at specified width
    env.addFilter('wordwrap', (str: string, width: number = 80) => {
      if (!str || typeof str !== 'string') {
        return '';
      }
      const words = str.split(/\s+/);
      const lines: string[] = [];
      let currentLine = '';
      for (const word of words) {
        if (currentLine.length + word.length + 1 <= width) {
          currentLine += (currentLine ? ' ' : '') + word;
        } else {
          if (currentLine) lines.push(currentLine);
          currentLine = word;
        }
      }
      if (currentLine) lines.push(currentLine);
      return lines.join('\n');
    });

    // bulletlist - Convert array/lines to bullet list
    env.addFilter('bulletlist', (input: string | unknown[]) => {
      const items = Array.isArray(input) ? input : String(input).split(/\r?\n/);
      return items.filter(item => String(item).trim()).map(item => `- ${item}`).join('\n');
    });

    // numberedlist - Convert array/lines to numbered list
    env.addFilter('numberedlist', (input: string | unknown[]) => {
      const items = Array.isArray(input) ? input : String(input).split(/\r?\n/);
      return items.filter(item => String(item).trim()).map((item, i) => `${i + 1}. ${item}`).join('\n');
    });
  }

  /**
   * Enhanced simple substitution with nested property access.
   * Supports both single brace {var} and double brace {{var}} syntax for backward compatibility.
   */
  private enhancedSimpleSubstitution(content: string, parameters: Record<string, any>): string {
    // Guard against undefined/null content
    if (content === undefined || content === null) {
      return '';
    }

    // Helper function to resolve nested property path
    const resolveValue = (fullPath: string): string | null => {
      const parts = fullPath.split('.');
      let value: any = parameters[parts[0]];

      if (value === undefined || value === null) {
        return null;
      }

      try {
        for (let i = 1; i < parts.length; i++) {
          if (typeof value === 'object' && value !== null) {
            value = value[parts[i]];
          } else {
            return null;
          }
          if (value === undefined || value === null) {
            return null;
          }
        }
        return String(value);
      } catch {
        return null;
      }
    };

    // First pass: Handle double braces {{ obj.prop }} (Jinja2/Nunjucks standard)
    // Supports optional whitespace and whitespace trimming markers (-~)
    content = content.replace(/\{\{[-~]?\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*[-~]?\}\}/g, (_match, fullPath) => {
      const resolved = resolveValue(fullPath);
      return resolved !== null ? resolved : `[Missing: ${fullPath}]`;
    });

    // Second pass: Handle single braces {obj.prop} (legacy syntax)
    // Only match single braces that aren't part of {{ }} or {% %}
    content = content.replace(/(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\}(?!\})/g, (_match, fullPath) => {
      const resolved = resolveValue(fullPath);
      return resolved !== null ? resolved : `[Missing: ${fullPath}]`;
    });

    return content;
  }

  /**
   * Escape special regex characters.
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  getName(): string {
    return 'Template Processing';
  }
}
