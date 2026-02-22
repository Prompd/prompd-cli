/**
 * Test Helper Utilities
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';
import { CompilationContext, CompilationOptions } from '../../src/lib/compiler/types';
import { MemoryFileSystem } from '../../src/lib/compiler/file-system';

/**
 * Create a temporary test file.
 */
export async function createTempFile(filename: string, content: string): Promise<string> {
  const tempDir = path.join(os.tmpdir(), 'prompd-tests', Date.now().toString());
  await fs.ensureDir(tempDir);

  const filePath = path.join(tempDir, filename);
  await fs.writeFile(filePath, content, 'utf-8');

  return filePath;
}

/**
 * Create multiple temp files in the same directory.
 */
export async function createTempFiles(files: Record<string, string>): Promise<string> {
  const tempDir = path.join(os.tmpdir(), 'prompd-tests', Date.now().toString());
  await fs.ensureDir(tempDir);

  for (const [filename, content] of Object.entries(files)) {
    const filePath = path.join(tempDir, filename);
    await fs.writeFile(filePath, content, 'utf-8');
  }

  return tempDir;
}

/**
 * Clean up temp directory.
 */
export async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.remove(dir);
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create a mock compilation context with in-memory file system.
 */
export function createMockContext(
  sourceFile: string,
  options: Partial<CompilationOptions> & { fileContent?: string; files?: Record<string, string> } = {}
): CompilationContext {
  const { fileContent, files, ...compilationOptions } = options;

  const context = new CompilationContext(sourceFile, {
    outputFormat: 'markdown',
    parameters: {},
    verbose: false,
    ...compilationOptions
  });

  // Create in-memory file system
  const memoryFiles: Record<string, string> = files || {};

  // If fileContent is provided, add the source file
  if (fileContent) {
    memoryFiles[sourceFile] = fileContent;
  }

  // Set up the file system
  context.fileSystem = new MemoryFileSystem(memoryFiles);

  return context;
}

/**
 * Wait for a promise with timeout.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
}
