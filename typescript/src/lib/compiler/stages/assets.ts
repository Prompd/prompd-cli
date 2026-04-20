/**
 * Asset Extraction Stage
 *
 * Extracts content from binary files (Excel, Word, PDF, Images) with
 * comprehensive security validation.
 *
 * Supported formats:
 * - Excel: .xlsx, .xls
 * - Word: .docx
 * - PDF: .pdf
 * - Images: .png, .jpg, .jpeg, .gif (metadata only)
 * - Text: .txt, .md, .json, .yaml, .yml
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import mammoth from 'mammoth';
import { CompilerStage, CompilationContext } from '../types';
import { SecurityError } from '../../errors';
import { getLanguageForExtension } from '../language-map';
import { excelToMarkdownSheets } from '../../excel';

// Dynamic imports for libraries with platform-specific builds
let pdfParse: any = null;
const loadPdfParse = async () => {
  if (!pdfParse) {
    pdfParse = (await import('pdf-parse')).default || (await import('pdf-parse'));
  }
  return pdfParse;
};

let sharp: any = null;
const loadSharp = async () => {
  if (!sharp) {
    try {
      sharp = (await import('sharp')).default || (await import('sharp'));
    } catch (error) {
      // Sharp not available (Node.js version issue)
      console.warn('Sharp library not available - image metadata extraction disabled');
      return null;
    }
  }
  return sharp;
};

export class AssetExtractionStage implements CompilerStage {
  private maxFileSize: number = 10 * 1024 * 1024; // 10MB
  private allowedExtensions: Set<string>;

  constructor() {
    this.allowedExtensions = new Set([
      '.xlsx', '.xls', // Excel
      '.docx', // Word
      '.pdf', // PDF
      '.png', '.jpg', '.jpeg', '.gif', // Images
      '.txt', '.md', '.markdown', // Text
      '.json', '.yaml', '.yml', '.csv', // Data
      '.sh', '.bash', '.zsh', '.fish', // Shell scripts (text extraction)
      '.py', '.js', '.ts', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', // Code files
      '.html', '.xml', '.svg', '.css', '.scss' // Markup
    ]);
  }

  async process(context: CompilationContext): Promise<void> {
    // Process YAML-defined section file references (system, user, assistant, etc.)
    // Note: 'context' is handled separately to match Python CLI behavior
    if (context.metadata) {
      await this.processYamlSectionFiles(context);
    }

    // Process context files from metadata - adds to context.contexts array
    // This is output at the TOP of the compiled result (matching Python CLI)
    if (context.metadata?.context) {
      await this.processContextFiles(context);
    }

    // Process inline file references in content: [file:./path/to/file.ext]
    if (context.content) {
      await this.processInlineFileReferences(context);
    }
  }

  /**
   * Process context files from metadata.
   * Extracts file content and adds to context.contexts array.
   * This matches the Python CLI behavior where context is output at the top.
   */
  private async processContextFiles(context: CompilationContext): Promise<void> {
    if (!context.metadata?.context) {
      return;
    }

    // Normalize to array
    const contextFiles: string[] = Array.isArray(context.metadata.context)
      ? context.metadata.context.map(f => String(f))
      : [String(context.metadata.context)];

    // Extract content from each context file and add to contexts array
    for (const ctxFileStr of contextFiles) {
      try {
        const extractedContent = await this.extractFile(context, ctxFileStr);
        if (extractedContent) {
          const fileName = path.basename(ctxFileStr);
          context.contexts.push(`## Context from ${fileName}\n\n${extractedContent}`);

          if (context.verbose) {
            console.log(`✓ Extracted context from: ${fileName}`);
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        context.addError(`Failed to extract context from ${ctxFileStr}: ${errorMessage}`);
        return; // Stop processing on extraction failure
      }
    }

    // Remove the # Context section from content since we've added to context.contexts
    if (context.content && contextFiles.length > 0) {
      if (Array.isArray(context.metadata.context)) {
        const placeholder = `[YAML section with ${context.metadata.context.length} file reference(s) - will be processed by asset extraction]`;
        context.content = context.content.replace(placeholder, '');
      } else {
        context.content = context.content.replace(String(context.metadata.context), '');
      }
      // Remove the empty # Context heading
      context.content = context.content.replace(/# Context\s*\n+/g, '');
      context.content = context.content.trim();
    }
  }

  /**
   * Process YAML-defined section file references.
   * Replaces placeholder content with extracted file content.
   */
  private async processYamlSectionFiles(context: CompilationContext): Promise<void> {
    if (!context.content || !context.metadata) {
      return;
    }

    const sectionNames: Array<keyof typeof context.metadata> = ['system', 'task', 'user', 'assistant', 'response', 'output'];

    for (const sectionName of sectionNames) {
      const sectionValue = context.metadata[sectionName];

      if (Array.isArray(sectionValue)) {
        // Array of file paths
        const extractedContents: string[] = [];

        for (const filePath of sectionValue) {
          try {
            const content = await this.extractFile(context, String(filePath));
            if (content) {
              extractedContents.push(content);
              if (context.verbose) {
                console.log(`✓ Extracted ${sectionName} content from: ${path.basename(String(filePath))}`);
              }
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            context.addError(`Failed to extract ${sectionName} file ${filePath}: ${errorMessage}`);
            return;
          }
        }

        // Replace placeholder in content
        if (extractedContents.length > 0) {
          const placeholder = `[YAML section with ${sectionValue.length} file reference(s) - will be processed by asset extraction]`;
          const replacement = extractedContents.join('\n\n');

          context.content = context.content.replace(placeholder, replacement);
        }
      } else if (typeof sectionValue === 'string' && (sectionValue.startsWith('./') || sectionValue.startsWith('../'))) {
        // Single file path (starts with relative path indicators)
        try {
          const content = await this.extractFile(context, sectionValue);
          if (content) {
            // Replace the file path with extracted content
            context.content = context.content.replace(sectionValue, content);

            if (context.verbose) {
              console.log(`✓ Extracted ${sectionName} content from: ${path.basename(sectionValue)}`);
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          context.addError(`Failed to extract ${sectionName} file ${sectionValue}: ${errorMessage}`);
          return;
        }
      }
    }
  }

  /**
   * Process inline file references in content.
   * Replaces [file:./path] placeholders with extracted content.
   */
  private async processInlineFileReferences(context: CompilationContext): Promise<void> {
    if (!context.content) {
      return;
    }

    // Find all [file:...] references
    const fileRefRegex = /\[file:([^\]]+)\]/g;
    const matches = [...context.content.matchAll(fileRefRegex)];

    if (matches.length === 0) {
      return; // No file references to process
    }

    let processedContent = context.content;

    for (const match of matches) {
      const fullMatch = match[0];
      const filePath = match[1];

      try {
        const extractedContent = await this.extractFile(context, filePath);

        if (extractedContent) {
          // Replace the placeholder with extracted content
          processedContent = processedContent.replace(fullMatch, extractedContent);

          if (context.verbose) {
            console.log(`✓ Extracted inline file: ${filePath}`);
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        context.addError(`Failed to extract inline file ${filePath}: ${errorMessage}`);
        return; // Stop processing on extraction failure
      }
    }

    context.content = processedContent;
  }

  /**
   * Extract content from a file with security validation.
   */
  private async extractFile(context: CompilationContext, filePathStr: string): Promise<string> {
    // Resolve relative paths relative to source file
    const sourceDir = context.fileSystem.dirname(context.sourceFile);
    let filePath: string;

    // Use fileSystem's resolve method for path resolution
    if (filePathStr.startsWith('./') || filePathStr.startsWith('../')) {
      // Relative path - resolve from source directory
      filePath = context.fileSystem.resolve(sourceDir, filePathStr);
    } else if (path.isAbsolute(filePathStr)) {
      // Absolute path
      filePath = filePathStr;
    } else {
      // Relative to source directory
      filePath = context.fileSystem.join(sourceDir, filePathStr);
    }

    // Security: Check file exists using fileSystem abstraction
    const exists = await Promise.resolve(context.fileSystem.exists(filePath));
    if (!exists) {
      throw new Error(`Context file not found: ${filePath}`);
    }

    // Extract based on file type
    const ext = path.extname(filePath).toLowerCase();

    try {
      switch (ext) {
        case '.xlsx':
        case '.xls':
          return await this.extractExcel(filePath);
        case '.docx':
          return await this.extractWord(filePath);
        case '.pdf':
          return await this.extractPdf(filePath);
        case '.png':
        case '.jpg':
        case '.jpeg':
        case '.gif':
          return await this.extractImageMetadata(filePath);
        default:
          // All other allowed extensions are treated as text
          return await this.extractText(context, filePath);
      }
    } catch (error) {
      throw new Error(
        `Extraction failed for ${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Security: Validate file path for path traversal and other attacks.
   */
  private async validateFilePath(filePath: string, sourceDir: string): Promise<void> {
    // Normalize path
    const normalized = path.normalize(filePath);

    // Check for null bytes (directory traversal attack)
    if (normalized.includes('\0')) {
      throw new SecurityError('Null byte detected in file path');
    }

    // Ensure resolved path doesn't escape project boundaries
    const projectRoot = process.cwd();
    if (!normalized.startsWith(sourceDir) && !normalized.startsWith(projectRoot)) {
      throw new SecurityError(`File path outside allowed directories: ${filePath}`);
    }
  }

  /**
   * Security: Validate file properties.
   */
  private async validateFile(filePath: string): Promise<void> {
    const stats = await fs.stat(filePath);

    // Security: Must be a regular file (not symlink, device, etc.)
    if (!stats.isFile()) {
      throw new SecurityError(`Path must be a regular file: ${filePath}`);
    }

    // Security: Check file size
    if (stats.size > this.maxFileSize) {
      throw new SecurityError(
        `File too large: ${stats.size} bytes (max: ${this.maxFileSize})`
      );
    }

    // Security: Check file extension
    const ext = path.extname(filePath).toLowerCase();
    if (!this.allowedExtensions.has(ext)) {
      throw new SecurityError(`File extension not allowed: ${ext}`);
    }
  }

  /**
   * Extract content from Excel files.
   */
  private async extractExcel(filePath: string): Promise<string> {
    try {
      return await excelToMarkdownSheets(filePath);
    } catch (error) {
      throw new Error(`Excel extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Extract content from Word documents.
   */
  private async extractWord(filePath: string): Promise<string> {
    try {
      const buffer = await fs.readFile(filePath);
      const result = await mammoth.extractRawText({ buffer });

      // Security: Limit output size
      const maxOutputSize = 1024 * 1024; // 1MB
      if (result.value.length > maxOutputSize) {
        return result.value.substring(0, maxOutputSize) + '\n\n[Content truncated...]';
      }

      return result.value;
    } catch (error) {
      throw new Error(`Word extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Extract content from PDF files.
   */
  private async extractPdf(filePath: string): Promise<string> {
    try {
      const buffer = await fs.readFile(filePath);

      // Load pdf-parse dynamically
      const pdf = await loadPdfParse();

      // Security: Set max pages to prevent DoS
      const data = await pdf(buffer, {
        max: 100 // Maximum 100 pages
      });

      // Security: Limit output size
      const maxOutputSize = 1024 * 1024; // 1MB
      if (data.text.length > maxOutputSize) {
        return data.text.substring(0, maxOutputSize) + '\n\n[Content truncated...]';
      }

      return data.text;
    } catch (error) {
      throw new Error(`PDF extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Extract metadata from images (OCR not implemented).
   */
  private async extractImageMetadata(filePath: string): Promise<string> {
    try {
      // Load sharp dynamically
      const sharpLib = await loadSharp();

      if (!sharpLib) {
        return `Image: ${path.basename(filePath)}\n\n*Note: Image metadata extraction requires Node.js >=20.3.0 or >=21.0.0*`;
      }

      const metadata = await sharpLib(filePath).metadata();

      const info = [
        `Image: ${path.basename(filePath)}`,
        `Format: ${metadata.format}`,
        `Dimensions: ${metadata.width}x${metadata.height}`,
        `Color Space: ${metadata.space}`,
        metadata.density ? `DPI: ${metadata.density}` : null
      ].filter(Boolean).join('\n');

      return `\`\`\`\n${info}\n\`\`\`\n\n*Note: OCR not implemented. Only metadata extracted.*`;
    } catch (error) {
      throw new Error(`Image metadata extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Extract plain text content.
   * For code files, wraps content in markdown code blocks with appropriate language identifier.
   */
  private async extractText(context: CompilationContext, filePath: string): Promise<string> {
    try {
      // Use fileSystem abstraction for text file reading (supports MemoryFileSystem)
      let content = await Promise.resolve(context.fileSystem.readFile(filePath));

      // Security: Limit output size
      const maxOutputSize = 1024 * 1024; // 1MB
      if (content.length > maxOutputSize) {
        content = content.substring(0, maxOutputSize) + '\n\n[Content truncated...]';
      }

      // Security: Remove any null bytes
      content = content.replace(/\0/g, '');

      // Get file extension and check if it's a code file that should be wrapped
      const ext = path.extname(filePath).toLowerCase();
      const language = getLanguageForExtension(ext);

      if (language) {
        // Wrap code files in markdown code blocks with language identifier
        // This enables code block filtering based on context file types
        return '```' + language + '\n' + content + '\n```';
      }

      // Return plain text for non-code files (.txt, etc.)
      return content;
    } catch (error) {
      throw new Error(`Text extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getName(): string {
    return 'Asset Extraction';
  }
}
