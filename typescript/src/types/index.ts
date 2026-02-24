/**
 * Code file extensions that need frontmatter protection for security.
 * These files will have prompd content frontmatter added to make them non-executable.
 * Used by: CLI packager, registry security validation, frontend file selection
 */
export const CODE_EXTENSIONS = [
  // JavaScript/TypeScript ecosystem
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  // Python
  '.py', '.pyw', '.pyi',
  // Shell/Scripts
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.psd1', '.bat', '.cmd',
  // Ruby
  '.rb', '.rake', '.gemspec',
  // Go
  '.go',
  // Rust
  '.rs',
  // C/C++
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx',
  // Java/JVM
  '.java', '.kt', '.kts', '.scala', '.groovy',
  // .NET
  '.cs', '.fs', '.vb',
  // PHP
  '.php', '.phtml',
  // Perl
  '.pl', '.pm',
  // Swift
  '.swift',
  // Lua
  '.lua',
  // R
  '.r', '.R',
  // Julia
  '.jl',
  // Elixir/Erlang
  '.ex', '.exs', '.erl',
  // Haskell
  '.hs', '.lhs',
  // Web frameworks
  '.vue', '.svelte',
  // SQL (can be dangerous with stored procedures)
  '.sql',
] as const;

/**
 * Map file extensions to content type names for frontmatter metadata.
 */
export const CONTENT_TYPES: Record<string, string> = {
  // JavaScript/TypeScript
  '.ts': 'typescript',
  '.tsx': 'typescript-react',
  '.js': 'javascript',
  '.jsx': 'javascript-react',
  '.mjs': 'javascript-module',
  '.cjs': 'javascript-commonjs',
  // Python
  '.py': 'python',
  '.pyw': 'python-windows',
  '.pyi': 'python-stub',
  // Shell
  '.sh': 'shell',
  '.bash': 'bash',
  '.zsh': 'zsh',
  '.fish': 'fish',
  '.ps1': 'powershell',
  '.psm1': 'powershell-module',
  '.psd1': 'powershell-data',
  '.bat': 'batch',
  '.cmd': 'batch',
  // Ruby
  '.rb': 'ruby',
  '.rake': 'ruby-rake',
  '.gemspec': 'ruby-gemspec',
  // Go
  '.go': 'go',
  // Rust
  '.rs': 'rust',
  // C/C++
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.h': 'c-header',
  '.hpp': 'cpp-header',
  '.hxx': 'cpp-header',
  // Java/JVM
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin-script',
  '.scala': 'scala',
  '.groovy': 'groovy',
  // .NET
  '.cs': 'csharp',
  '.fs': 'fsharp',
  '.vb': 'vb',
  // PHP
  '.php': 'php',
  '.phtml': 'php-html',
  // Perl
  '.pl': 'perl',
  '.pm': 'perl-module',
  // Swift
  '.swift': 'swift',
  // Lua
  '.lua': 'lua',
  // R
  '.r': 'r',
  '.R': 'r',
  // Julia
  '.jl': 'julia',
  // Elixir/Erlang
  '.ex': 'elixir',
  '.exs': 'elixir-script',
  '.erl': 'erlang',
  // Haskell
  '.hs': 'haskell',
  '.lhs': 'literate-haskell',
  // Web frameworks
  '.vue': 'vue',
  '.svelte': 'svelte',
  // SQL
  '.sql': 'sql',
};

/**
 * Check if a file extension requires frontmatter protection.
 */
export function needsFrontmatterProtection(filePath: string): boolean {
  const ext = filePath.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  return (CODE_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Get the content type for a file extension.
 */
export function getContentType(filePath: string): string {
  const ext = filePath.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  return CONTENT_TYPES[ext] || 'text';
}

// ── Package Type System ──────────────────────────────────────────────────────

/**
 * Package types supported by the prompd ecosystem.
 * Defined in prompd.json under the "type" field.
 */
export type PackageType = 'package' | 'workflow' | 'skill' | 'node-template';

/**
 * Maps each PackageType to its install directory name.
 * e.g., .prompd/packages/, .prompd/workflows/, .prompd/skills/, .prompd/templates/
 */
export const PACKAGE_TYPE_DIRS: Record<PackageType, string> = {
  'package': 'packages',
  'workflow': 'workflows',
  'skill': 'skills',
  'node-template': 'templates',
};

/**
 * All valid package type strings, for validation.
 */
export const VALID_PACKAGE_TYPES: readonly string[] = Object.keys(PACKAGE_TYPE_DIRS);

/**
 * Maps tool names to their native skill deployment directories.
 * Used by `prompd install --tools <tool>` to deploy skills into tool-native locations.
 */
export const TOOL_DEPLOY_DIRS: Record<string, string> = {
  'claude': '~/.claude/skills',
};

/**
 * Check if a string is a valid PackageType.
 */
export function isValidPackageType(type: string): type is PackageType {
  return VALID_PACKAGE_TYPES.includes(type);
}

/**
 * Get the install directory name for a given package type.
 * Defaults to 'packages' for unknown types.
 */
export function getInstallDirForType(type: string): string {
  return PACKAGE_TYPE_DIRS[type as PackageType] || 'packages';
}

/** Strict regex for tool names: lowercase alphanumeric and hyphens only */
const TOOL_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Resolve a tool deploy directory to an absolute path.
 * Expands ~ to the user's home directory.
 * Validates toolName against strict regex to prevent path injection.
 */
export function resolveToolDeployDir(toolName: string): string | undefined {
  if (!TOOL_NAME_REGEX.test(toolName)) return undefined;
  const dir = TOOL_DEPLOY_DIRS[toolName];
  if (!dir) return undefined;
  const os = require('os');
  return dir.replace(/^~/, os.homedir());
}

// ── Prompd File Types ────────────────────────────────────────────────────────

export interface PrompdParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  required?: boolean;
  default?: any;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  enum?: string[];
}

export interface UsingPackage {
  name: string;
  prefix?: string;
}

export interface PrompdMetadata {
  id: string;         // Machine-readable identifier (kebab-case) - REQUIRED
  name?: string;      // Human-readable display name (can have spaces)
  description?: string;
  version?: string;
  parameters?: PrompdParameter[];
  variables?: PrompdParameter[]; // For backward compatibility
  system?: string | string[];
  context?: string | string[];
  task?: string | string[];
  user?: string | string[];
  assistant?: string | string[];
  response?: string | string[];
  output?: string | string[];
  requires?: string[];
  // Advanced features for composable architecture
  using?: string | UsingPackage[] | Record<string, string>;  // Package imports
  inherits?: string;  // Parent template reference
  override?: Record<string, string | null>;  // Section overrides
}

export interface PrompdFile {
  metadata: PrompdMetadata;
  content: string;
  sections: Record<string, string>;
}

export interface CustomProvider {
  apiKey?: string;
  baseUrl: string;
  enabled: boolean;
  models: string[];
  type: string;
}

export interface RegistryConfig {
  url: string;
  api_key?: string;
  token?: string;
  username?: string;
}

export interface ProviderConfig {
  baseUrl?: string;           // Custom API endpoint (e.g., proxy, different region)
  timeout?: number;            // Provider-specific timeout override
  maxRetries?: number;         // Provider-specific retry count override
  extraHeaders?: Record<string, string>;  // Custom headers (auth, tracing, etc.)
  extraParams?: Record<string, any>;      // Provider-specific request parameters
}

export interface Config {
  apiKeys: Record<string, string>;
  defaultProvider?: string;
  defaultModel?: string;
  customProviders: Record<string, CustomProvider>;
  providerConfigs?: Record<string, ProviderConfig>; // Per-provider config overrides
  registry: {
    default?: string;
    registries: Record<string, RegistryConfig>;
  };
  scopes: Record<string, string>; // scope -> registry mapping
  namespaces?: Record<string, string>; // namespace -> registry URL mapping
  currentNamespace?: string; // active namespace
  maxRetries?: number;
  timeout?: number;
  verbose?: boolean;
}

export interface LLMResponse {
  success: boolean;
  response?: string;
  error?: string;
  content?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ValidationIssue {
  level: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  column?: number;
}

export interface ExecuteOptions {
  provider: string;
  model: string;
  apiKey?: string;
  output?: string;
  params?: Record<string, any>;
  paramFiles?: string[];
  version?: string;
  metaSystem?: string;
  metaContext?: string;
  metaUser?: string;
  verbose?: boolean;
  registryUrl?: string;
  workspaceRoot?: string;
  fileSystem?: import('../lib/compiler/file-system').IFileSystem;
}