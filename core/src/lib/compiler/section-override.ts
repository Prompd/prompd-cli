/**
 * Section Override Processing
 *
 * Provides complete functionality for parsing, validating, and applying
 * section-based content overrides in prompd template inheritance.
 *
 * This is a direct port of the Python CLI's SectionOverrideProcessor.
 */

import { SectionInfo } from './types';
import { ParseError, ValidationError, SecurityError } from '../errors';
import { IFileSystem } from './file-system';
import { isAbsolutePosix } from './path-utils';

export class SectionOverrideProcessor {
  /** Max override file size (DoS protection). */
  private static readonly MAX_OVERRIDE_SIZE = 10 * 1024 * 1024; // 10MB

  private headingPattern: RegExp;
  private sectionIdPattern: RegExp;

  constructor() {
    // Pattern to match markdown headings (# through ######)
    this.headingPattern = /^(#{1,6})\s+(.+)$/gm;

    // Pattern to match section ID comments (strict - only valid IDs)
    this.sectionIdPattern = /<!--\s*section-id:\s*([a-z0-9-]+)\s*-->/i;
  }

  /**
   * Pattern to detect any section-id comment (for validation)
   */
  private detectSectionIdComment(line: string): string | null {
    const match = /<!--\s*section-id:\s*(.+?)\s*-->/i.exec(line);
    return match ? match[1].trim() : null;
  }

  /**
   * Extract all sections from markdown content.
   */
  extractSections(content: string): Map<string, SectionInfo> {
    if (!content || !content.trim()) {
      return new Map();
    }

    const sections = new Map<string, SectionInfo>();
    const lines = content.split('\n');
    const encounteredSectionIds = new Set<string>();

    // Track explicit section ID comments
    const explicitSectionIds = new Map<number, string>();
    for (let i = 0; i < lines.length; i++) {
      // First check for any section-id comment (valid or invalid)
      const detectedId = this.detectSectionIdComment(lines[i]);
      if (detectedId) {
        // Validate the detected ID (will throw if invalid)
        this.validateSectionId(detectedId, i + 1);

        // Now try to match with strict pattern
        const match = this.sectionIdPattern.exec(lines[i]);
        if (match) {
          const sectionId = match[1];
          explicitSectionIds.set(i, sectionId);
        }
      }
    }

    // Find all headings and create sections
    const headingMatches: Array<{ level: number; text: string; line: number; index: number }> = [];
    let match;

    // Reset regex state
    this.headingPattern.lastIndex = 0;

    while ((match = this.headingPattern.exec(content)) !== null) {
      const headingLevel = match[1].length; // Number of # characters
      const headingText = match[2].trim();
      const headingLine = content.substring(0, match.index).split('\n').length - 1;

      headingMatches.push({
        level: headingLevel,
        text: headingText,
        line: headingLine,
        index: match.index
      });
    }

    // Process each heading to create sections
    for (let i = 0; i < headingMatches.length; i++) {
      const heading = headingMatches[i];

      // Determine section ID
      let sectionId: string | null = null;

      // Check for explicit section ID comment before this heading (within 5 lines)
      for (let lineNum = heading.line; lineNum >= Math.max(0, heading.line - 5); lineNum--) {
        if (explicitSectionIds.has(lineNum)) {
          sectionId = explicitSectionIds.get(lineNum)!;
          break;
        }
      }

      // If no explicit ID, generate from heading text
      if (!sectionId) {
        sectionId = this.generateSectionId(heading.text);
      }

      // Validate section ID
      this.validateSectionId(sectionId, heading.line + 1);

      // Check for duplicate section IDs
      if (encounteredSectionIds.has(sectionId)) {
        throw new ParseError(
          `Duplicate section ID '${sectionId}' at line ${heading.line + 1}. ` +
          `Section IDs must be unique.`
        );
      }
      encounteredSectionIds.add(sectionId);

      // Determine section content boundaries
      const sectionStart = heading.index;
      const nextHeading = headingMatches[i + 1];
      const sectionEnd = nextHeading ? nextHeading.index : content.length;

      // Extract section content
      const sectionContent = content.substring(sectionStart, sectionEnd).trim();

      sections.set(sectionId, {
        id: sectionId,
        headingText: heading.text,
        content: sectionContent,
        startLine: heading.line,
        endLine: content.substring(0, sectionEnd).split('\n').length - 1,
        headingLevel: heading.level
      });
    }

    return sections;
  }

  /**
   * Apply overrides and merge parent/child sections.
   */
  async applyOverrides(
    parentSections: Map<string, SectionInfo>,
    childSections: Map<string, SectionInfo>,
    overrides: Record<string, string | null>,
    baseDir: string,
    verbose: boolean = false,
    fileSystem?: IFileSystem
  ): Promise<string> {
    // Start with parent sections as base
    const mergedSections = new Map<string, SectionInfo>(parentSections);

    // Apply overrides
    for (const [sectionId, overridePath] of Object.entries(overrides)) {
      if (!mergedSections.has(sectionId)) {
        // Override references a section that doesn't exist in parent
        if (verbose) {
          const available = Array.from(mergedSections.keys()).sort().join(', ');
          console.log(
            `Warning: Override section '${sectionId}' not found in parent. Available: ${available}`
          );
        }
        continue;
      }

      if (overridePath === null) {
        // Remove section
        mergedSections.delete(sectionId);
        if (verbose) {
          console.log(`  - Removing section '${sectionId}'`);
        }
      } else {
        // Replace section with content from file
        try {
          const overrideContent = await this.loadOverrideContent(overridePath, baseDir, fileSystem);

          const originalSection = mergedSections.get(sectionId)!;
          mergedSections.set(sectionId, {
            ...originalSection,
            content: overrideContent
          });

          if (verbose) {
            console.log(`  - Replacing section '${sectionId}' with content from ${overridePath}`);
          }
        } catch (error) {
          throw new Error(
            `Failed to apply override for section '${sectionId}': ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }

    // Merge child sections (child overrides parent for matching IDs)
    for (const [sectionId, childSection] of childSections.entries()) {
      mergedSections.set(sectionId, childSection);

      if (verbose && parentSections.has(sectionId)) {
        console.log(`  - Child overrides parent section '${sectionId}'`);
      } else if (verbose) {
        console.log(`  - Adding child section '${sectionId}'`);
      }
    }

    // Reconstruct content from merged sections
    const contentParts: string[] = [];
    for (const section of mergedSections.values()) {
      contentParts.push(section.content);
    }

    return contentParts.join('\n\n');
  }

  /**
   * Load override content from a file.
   */
  async loadOverrideContent(overridePath: string, baseDir: string, fileSystem?: IFileSystem): Promise<string> {
    // @prompd/core always uses an injected file system (MemoryFileSystem in the
    // browser/server). The Node CLI provides NodeFileSystem.
    if (!fileSystem) {
      throw new Error('A fileSystem is required to load section override content.');
    }

    // Security: Validate and resolve path using the file system's own path style
    // (cross-platform; the in-memory FS is POSIX, NodeFileSystem is OS-native).
    const resolvedPath = this.resolveOverridePath(overridePath, baseDir, fileSystem);

    if (!(await fileSystem.exists(resolvedPath))) {
      throw new Error(`Override file not found: ${resolvedPath}`);
    }

    try {
      const content = await fileSystem.readFile(resolvedPath);
      // Security: cap override file size (DoS protection).
      if (content.length > SectionOverrideProcessor.MAX_OVERRIDE_SIZE) {
        throw new SecurityError(
          `Override file too large: ${content.length} bytes (max: ${SectionOverrideProcessor.MAX_OVERRIDE_SIZE})`
        );
      }
      return content.trim();
    } catch (error) {
      if (error instanceof SecurityError) throw error;
      throw new Error(
        `Failed to read override file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Resolve override path with security checks.
   */
  private resolveOverridePath(overridePath: string, baseDir: string, fileSystem: IFileSystem): string {
    // Security: Path traversal protection (string check, separator-agnostic).
    const cleaned = overridePath.replace(/\\/g, '/');
    if (cleaned.includes('..') && !cleaned.startsWith('./') && !cleaned.startsWith('../')) {
      throw new SecurityError(`Path traversal detected in override path: ${overridePath}`);
    }

    // Absolute paths (POSIX or Windows drive) are used as-is — the caller owns them.
    if (isAbsolutePosix(cleaned) || /^[A-Za-z]:/.test(overridePath)) {
      return overridePath;
    }

    // Resolve relative to baseDir via the file system's own path semantics.
    const resolved = fileSystem.resolve(baseDir, overridePath);

    // Security: ensure the resolved path stays within the base directory.
    const baseResolved = fileSystem.resolve(baseDir);
    const resolvedNorm = resolved.replace(/\\/g, '/');
    const baseNorm = baseResolved.replace(/\\/g, '/');
    if (!resolvedNorm.startsWith(baseNorm)) {
      throw new SecurityError(`Override path escapes base directory: ${overridePath}`);
    }

    return resolved;
  }

  /**
   * Generate a section ID from heading text (kebab-case).
   */
  private generateSectionId(headingText: string): string {
    return headingText
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '') // Remove non-alphanumeric except spaces and hyphens
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Collapse multiple hyphens
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
  }

  /**
   * Validate section ID format.
   */
  private validateSectionId(sectionId: string, lineNumber?: number): void {
    // Security: Reject IDs that might be used for code injection (check first)
    const dangerousPatterns = ['__proto__', 'constructor', 'prototype'];
    if (dangerousPatterns.some(pattern => sectionId.includes(pattern))) {
      throw new SecurityError(`Section ID contains forbidden pattern: ${sectionId}`);
    }

    // Security: Check for excessively long IDs (potential DoS)
    if (sectionId.length > 100) {
      throw new ValidationError(`Section ID too long: ${sectionId.length} characters (max: 100)`);
    }

    // Section IDs must be kebab-case (lowercase letters, numbers, hyphens)
    const validPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

    if (!validPattern.test(sectionId)) {
      const location = lineNumber ? ` at line ${lineNumber}` : '';
      throw new ValidationError(
        `Invalid section ID '${sectionId}'${location}. ` +
        `Section IDs must be kebab-case (lowercase letters, numbers, hyphens only).`
      );
    }
  }
}
