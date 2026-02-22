/**
 * Section Override Processing
 *
 * Provides complete functionality for parsing, validating, and applying
 * section-based content overrides in prompd template inheritance.
 *
 * This is a direct port of the Python CLI's SectionOverrideProcessor.
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import { SectionInfo } from './types';
import { ParseError, ValidationError, SecurityError } from '../errors';
import { IFileSystem } from './file-system';

export class SectionOverrideProcessor {
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
    // Security: Validate and resolve path
    const resolvedPath = this.resolveOverridePath(overridePath, baseDir);

    // If using custom file system, use it directly
    if (fileSystem) {
      if (! await fileSystem.exists(resolvedPath)) {
        throw new Error(`Override file not found: ${resolvedPath}`);
      }

      try {
        const content = await fileSystem.readFile(resolvedPath);
        return content.trim();
      } catch (error) {
        throw new Error(
          `Failed to read override file: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Otherwise use Node.js fs (default behavior)
    // Security: Check file exists
    if (!await fs.pathExists(resolvedPath)) {
      throw new Error(`Override file not found: ${resolvedPath}`);
    }

    // Security: Check it's a regular file
    const stats = await fs.stat(resolvedPath);
    if (!stats.isFile()) {
      throw new SecurityError(`Override path must be a regular file: ${resolvedPath}`);
    }

    // Security: Check file size (max 10MB)
    const maxFileSize = 10 * 1024 * 1024;
    if (stats.size > maxFileSize) {
      throw new SecurityError(`Override file too large: ${stats.size} bytes (max: ${maxFileSize})`);
    }

    // Load content
    try {
      const content = await fs.readFile(resolvedPath, 'utf-8');
      return content.trim();
    } catch (error) {
      throw new Error(
        `Failed to read override file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Resolve override path with security checks.
   */
  private resolveOverridePath(overridePath: string, baseDir: string): string {
    // Security: Path traversal protection
    const normalized = path.normalize(overridePath);

    // Security: Detect path traversal attempts
    if (normalized.includes('..') && !overridePath.startsWith('./') && !overridePath.startsWith('../')) {
      throw new SecurityError(`Path traversal detected in override path: ${overridePath}`);
    }

    // Security: Reject absolute paths unless they're in safe locations
    if (path.isAbsolute(normalized)) {
      // Allow absolute paths only within the project or home directory
      const projectRoot = process.cwd();
      const homeDir = require('os').homedir();

      if (!normalized.startsWith(projectRoot) && !normalized.startsWith(homeDir)) {
        throw new SecurityError(`Absolute paths outside project not allowed: ${overridePath}`);
      }

      return normalized;
    }

    // Resolve relative path from base directory
    const resolved = path.resolve(baseDir, normalized);

    // Security: Ensure resolved path doesn't escape base directory
    if (!resolved.startsWith(baseDir) && !resolved.startsWith(process.cwd())) {
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
