/**
 * Language Mapping Utilities
 *
 * Centralized file extension to programming language mappings
 * used across the compilation pipeline for:
 * - Wrapping extracted code files in markdown code blocks
 * - Filtering code blocks based on context file types
 */

/**
 * Map of file extensions to primary markdown code block language identifier.
 * Used when wrapping extracted code files in markdown code blocks.
 */
export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  // TypeScript/JavaScript
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  // Python
  '.py': 'python',
  '.pyw': 'python',
  // Go
  '.go': 'go',
  // Rust
  '.rs': 'rust',
  // Java/Kotlin
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  // C/C++
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cc': 'cpp',
  // C#
  '.cs': 'csharp',
  // Ruby
  '.rb': 'ruby',
  // PHP
  '.php': 'php',
  // Swift
  '.swift': 'swift',
  // Shell
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'zsh',
  '.fish': 'fish',
  // SQL
  '.sql': 'sql',
  // Web
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  // Data formats
  '.xml': 'xml',
  '.svg': 'xml',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.csv': 'csv',
  // Markdown
  '.md': 'markdown',
  '.mdx': 'markdown',
};

/**
 * Map of file extensions to all valid code block language identifiers.
 * Used when filtering code blocks - includes aliases (e.g., 'ts' for 'typescript').
 */
export const EXTENSION_TO_LANGUAGE_ALIASES: Record<string, string[]> = {
  // TypeScript/JavaScript
  '.ts': ['typescript', 'ts'],
  '.tsx': ['typescript', 'tsx', 'ts'],
  '.js': ['javascript', 'js'],
  '.jsx': ['javascript', 'jsx', 'js'],
  '.mjs': ['javascript', 'js'],
  '.cjs': ['javascript', 'js'],
  // Python
  '.py': ['python', 'py'],
  '.pyw': ['python', 'py'],
  // Go
  '.go': ['go', 'golang'],
  // Rust
  '.rs': ['rust', 'rs'],
  // Java/Kotlin
  '.java': ['java'],
  '.kt': ['kotlin', 'kt'],
  '.kts': ['kotlin', 'kt'],
  // C/C++
  '.c': ['c'],
  '.h': ['c', 'h'],
  '.cpp': ['cpp', 'c++', 'cxx'],
  '.hpp': ['cpp', 'c++', 'hpp'],
  '.cc': ['cpp', 'c++'],
  // C#
  '.cs': ['csharp', 'cs', 'c#'],
  // Ruby
  '.rb': ['ruby', 'rb'],
  // PHP
  '.php': ['php'],
  // Swift
  '.swift': ['swift'],
  // Shell
  '.sh': ['bash', 'sh', 'shell'],
  '.bash': ['bash', 'sh', 'shell'],
  '.zsh': ['zsh', 'sh', 'shell'],
  '.fish': ['fish'],
  // SQL
  '.sql': ['sql'],
  // Web
  '.html': ['html', 'htm'],
  '.htm': ['html', 'htm'],
  '.css': ['css'],
  '.scss': ['scss', 'sass'],
  '.sass': ['sass', 'scss'],
  '.less': ['less'],
  // Data formats
  '.json': ['json'],
  '.yaml': ['yaml', 'yml'],
  '.yml': ['yaml', 'yml'],
  '.xml': ['xml'],
  '.svg': ['xml', 'svg'],
  '.toml': ['toml'],
  '.csv': ['csv'],
  // Markdown
  '.md': ['markdown', 'md'],
  '.mdx': ['mdx', 'markdown', 'md'],
};

/**
 * Get the primary language identifier for a file extension.
 * @param ext - File extension (e.g., '.ts')
 * @returns Primary language identifier or undefined
 */
export function getLanguageForExtension(ext: string): string | undefined {
  return EXTENSION_TO_LANGUAGE[ext.toLowerCase()];
}

/**
 * Get all valid language identifiers (including aliases) for a file extension.
 * @param ext - File extension (e.g., '.ts')
 * @returns Array of language identifiers or empty array
 */
export function getLanguageAliasesForExtension(ext: string): string[] {
  return EXTENSION_TO_LANGUAGE_ALIASES[ext.toLowerCase()] || [];
}
