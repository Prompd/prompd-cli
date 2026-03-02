import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as yaml from 'js-yaml';
import archiver from 'archiver';
import { createHash } from 'crypto';
import { SecurityManager } from '../lib/security';
import { PrompdCompiler, NodeFileSystem } from '../lib/compiler';
import { needsFrontmatterProtection, getContentType, isValidPackageType, VALID_PACKAGE_TYPES, PackageType } from '../types';

interface PackageExclusions {
  directories?: string[];
  patterns?: string[];
}

interface PackageManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  type?: string;
  keywords?: string[];
  tools?: string[];
  mcps?: string[];
  license?: string;
  homepage?: string;
  repository?: string;
  dependencies?: Record<string, string>;
  files?: { [key: string]: string };
}

/**
 * Shared package creation logic (used by both 'package create' and 'pack')
 */
async function handlePackageCreate(source: string, output?: string, options?: Record<string, string>): Promise<void> {
  const sourcePath = path.resolve(source);

  // Check if source exists
  if (!await fs.pathExists(sourcePath)) {
    console.error(chalk.red(`Source not found: ${sourcePath}`));
    process.exit(1);
  }

  // Check if source is a directory
  const stat = await fs.stat(sourcePath);
  if (!stat.isDirectory()) {
    console.error(chalk.red(`Source must be a directory: ${sourcePath}`));
    process.exit(1);
  }

  // Directory mode - requires manual parameters
  if (!options?.name || !options?.version || !options?.description) {
    console.error(chalk.red('Package creation requires -n/--name, -v/--pkg-version, and -d/--description options'));
    process.exit(1);
  }

  // Validate --type if provided
  if (options.type && !isValidPackageType(options.type)) {
    console.error(chalk.red(`Invalid package type: '${options.type}'`));
    console.error(chalk.dim(`Valid types: ${VALID_PACKAGE_TYPES.join(', ')}`));
    process.exit(1);
  }

  await packageFromDirectory(sourcePath, output, options);
}

export function createPackageCommand(): Command {
  const command = new Command('package');
  command.description('Package management commands');

  // Create subcommand
  const createCommand = new Command('create');
  createCommand
    .description('Create a .pdpkg package from a directory')
    .argument('<source>', 'Source directory')
    .argument('[output]', 'Output .pdpkg file path (optional)')
    .option('-n, --name <name>', 'Package name')
    .option('-v, --pkg-version <version>', 'Package version')
    .option('-d, --description <description>', 'Package description')
    .option('-a, --author <author>', 'Package author')
    .option('-t, --type <type>', 'Package type (package, workflow, skill, node-template)', 'package')
    .action(async (source: string, output?: string, options?: Record<string, string>) => {
      try {
        // Map pkgVersion to version for backwards compatibility
        if (options?.pkgVersion) {
          options.version = options.pkgVersion;
        }
        await handlePackageCreate(source, output, options);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`Package creation failed: ${message}`));
        process.exit(1);
      }
    });

  // Validate subcommand
  const validateCommand = new Command('validate');
  validateCommand
    .description('Validate a .pdpkg package archive')
    .argument('<file>', '.pdpkg package file to validate')
    .action(async (filePath: string) => {
      try {
        const fullPath = path.resolve(filePath);
        
        // Check if file exists
        if (!await fs.pathExists(fullPath)) {
          console.error(chalk.red(`❌ File not found: ${fullPath}`));
          process.exit(1);
        }

        // Only accept .pdpkg files - packages are archives, not individual .prmd files
        if (!fullPath.endsWith('.pdpkg')) {
          console.error(chalk.red('❌ Invalid package format!'));
          console.error(chalk.gray(`   File: ${path.basename(filePath)}`));
          console.error(chalk.gray('   Expected: .pdpkg archive file'));
          console.error(chalk.gray('   Note: .prmd files are individual prompts, not packages'));
          console.error(chalk.gray('   Use \'prompd validate\' to validate individual .prmd files'));
          process.exit(1);
        }

        // Validate .pdpkg file structure
        await validatePdpkgFile(fullPath);

        console.log(chalk.green(`✅ Package validation passed: ${path.basename(filePath)}`));

      } catch (error: any) {
        console.error(chalk.red(`❌ Package validation failed: ${error.message}`));
        process.exit(1);
      }
    });

  command.addCommand(createCommand);
  command.addCommand(validateCommand);

  return command;
}

async function packageFromDirectory(
  sourceDir: string,
  outputPath?: string,
  options: Record<string, string> = {}
): Promise<void> {
  const { name, version, description, author } = options;

  // Resolve package type: explicit --type flag > prompd.json type field > default 'package'
  let packageType = options.type;
  if (!packageType || packageType === 'package') {
    const prompdJsonPath = path.join(sourceDir, 'prompd.json');
    if (await fs.pathExists(prompdJsonPath)) {
      try {
        const prompdJson = await fs.readJson(prompdJsonPath);
        if (prompdJson.type && isValidPackageType(prompdJson.type)) {
          packageType = prompdJson.type;
        }
      } catch {
        // Ignore parse errors - fall through to default
      }
    }
  }
  if (!packageType) {
    packageType = 'package';
  }

  // Generate output path if not provided
  if (!outputPath) {
    outputPath = `${name.toLowerCase().replace(/\s+/g, '-')}-v${version}.pdpkg`;
  }

  // Ensure .pdpkg extension
  if (!outputPath.endsWith('.pdpkg')) {
    outputPath += '.pdpkg';
  }

  const manifest: PackageManifest = {
    name,
    version,
    description,
    author,
    type: packageType
  };

  // Create package with default exclusions
  const exclusions: PackageExclusions = {
    directories: ['.git', '.prmd', 'node_modules', '__pycache__'],
    patterns: ['*.log', '*.tmp', '*.cache', '.env*']
  };

  await createPackage(sourceDir, outputPath, manifest, exclusions);

  console.log(chalk.green('✓ Package created successfully!'));
  console.log(chalk.cyan(`   Package: ${outputPath}`));
  
  try {
    const stats = await fs.stat(outputPath);
    const sizeKB = (stats.size / 1024).toFixed(1);
    console.log(chalk.gray(`   Size: ${sizeKB} KB`));
  } catch (error) {
    // Ignore stat errors
  }
}

async function createPackage(
  sourceDir: string,
  outputPath: string,
  manifest: PackageManifest,
  exclusions: PackageExclusions
): Promise<void> {
  // First pass: scan for secrets
  const secretsFound: Array<{ file: string; type: string; line: number }> = [];

  const scanDir = async (dir: string, relativePath: string = ''): Promise<void> => {
    const items = await fs.readdir(dir);

    for (const item of items) {
      const itemPath = path.join(dir, item);
      const itemRelPath = path.join(relativePath, item);
      const stat = await fs.stat(itemPath);

      if (shouldExclude(itemRelPath, stat.isDirectory(), exclusions)) {
        continue;
      }

      if (stat.isDirectory()) {
        await scanDir(itemPath, itemRelPath);
      } else {
        // Scan text files for secrets
        const ext = path.extname(itemPath).toLowerCase();
        const textExtensions = ['.prmd', '.txt', '.json', '.yaml', '.yml', '.md', '.js', '.ts', '.py', '.sh', '.env'];

        if (textExtensions.includes(ext)) {
          const scanResult = await SecurityManager.scanFileForSecrets(itemPath);
          if (scanResult.hasSecrets) {
            scanResult.secrets.forEach(secret => {
              secretsFound.push({
                file: itemRelPath,
                type: secret.type,
                line: secret.line
              });
            });
          }
        }
      }
    }
  };

  // Scan for secrets before packaging
  await scanDir(sourceDir);

  if (secretsFound.length > 0) {
    console.error(chalk.red.bold('\n⚠️  SECURITY WARNING: Potential secrets detected!'));
    console.error(chalk.yellow('\nThe following files contain potential secrets:'));

    secretsFound.forEach(({ file, type, line }) => {
      console.error(chalk.yellow(`  • ${file}:${line} - ${type}`));
    });

    console.error(chalk.red('\n❌ Package creation blocked to prevent secret exposure.'));
    console.error(chalk.gray('Please remove secrets from these files before packaging.'));
    console.error(chalk.gray('Use environment variables or secure vaults for sensitive data.\n'));

    throw new Error('Secrets detected in package contents');
  }

  // Second pass: collect files, apply frontmatter, and compute hashes
  const fileHashes: Record<string, string> = {};
  const fileContents: Array<{ zipPath: string; content: string | Buffer }> = [];

  const collectFiles = (dir: string, relativePath: string = '') => {
    const items = fs.readdirSync(dir);

    for (const item of items) {
      const itemPath = path.join(dir, item);
      const itemRelPath = path.join(relativePath, item);
      const stat = fs.statSync(itemPath);

      if (shouldExclude(itemRelPath, stat.isDirectory(), exclusions)) {
        continue;
      }

      if (stat.isDirectory()) {
        collectFiles(itemPath, itemRelPath);
      } else {
        const zipPath = itemRelPath.replace(/\\/g, '/');

        // For code files, add frontmatter protection
        if (needsFrontmatterProtection(itemPath)) {
          const content = fs.readFileSync(itemPath, 'utf-8');
          const filename = path.basename(itemPath);
          const protectedContent = addContentFrontmatter(content, filename);
          fileHashes[zipPath] = createHash('sha256').update(protectedContent).digest('hex');
          fileContents.push({ zipPath, content: protectedContent });
        } else {
          // For non-code files, read content for hashing
          const content = fs.readFileSync(itemPath);
          fileHashes[zipPath] = createHash('sha256').update(content).digest('hex');
          fileContents.push({ zipPath, content });
        }
      }
    }
  };

  collectFiles(sourceDir);

  // Third pass: create the package with integrity hashes
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));

    archive.pipe(output);

    // Add prompd.json with integrity hashes
    const fullManifest = {
      ...manifest,
      integrity: {
        algorithm: 'sha256',
        files: fileHashes
      }
    };
    archive.append(JSON.stringify(fullManifest, null, 2), { name: 'prompd.json' });

    // Add all files to archive
    for (const { zipPath, content } of fileContents) {
      archive.append(content, { name: zipPath });
    }

    archive.finalize();
  });
}

function shouldExclude(relPath: string, isDirectory: boolean, exclusions: PackageExclusions): boolean {
  const fileName = path.basename(relPath);
  
  // Always exclude .pdproj files - they're only for packaging metadata
  if (fileName.endsWith('.pdproj')) {
    return true;
  }
  
  // Check directory exclusions
  if (isDirectory && exclusions.directories) {
    for (const excl of exclusions.directories) {
      if (fileName === excl) {
        return true;
      }
    }
  }

  // Check pattern exclusions
  if (exclusions.patterns) {
    for (const pattern of exclusions.patterns) {
      // Convert glob pattern to regex
      const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
      );
      if (regex.test(fileName)) {
        return true;
      }
    }
  }

  return false;
}


async function validatePdpkgFile(filePath: string): Promise<void> {
  // For .pdpkg files (ZIP archives), we need to check the structure
  const AdmZip = require('adm-zip');
  
  let zip: any;
  try {
    zip = new AdmZip(filePath);
  } catch (error: any) {
    throw new Error(`Failed to open ZIP file: ${error.message}`);
  }

  const entries = zip.getEntries();
  
  // SECURITY: Check for ZIP slip/directory traversal attacks
  for (const entry of entries) {
    const entryName = entry.entryName;
    const normalizedPath = path.normalize(entryName);
    
    // Check for path traversal
    if (normalizedPath.includes('..') || path.isAbsolute(entryName)) {
      throw new Error(`Security violation: Path traversal detected in ${entryName}`);
    }
  }
  
  // Check for prompd.json (or legacy manifest.json for backwards compatibility)
  let manifestFound = false;
  for (const entry of entries) {
    if (entry.entryName === 'prompd.json' || entry.entryName === 'manifest.json') {
      manifestFound = true;

      // Read and validate manifest
      const manifestContent = entry.getData().toString('utf8');
      let manifest: PackageManifest;

      try {
        manifest = JSON.parse(manifestContent);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Invalid ${entry.entryName}: ${message}`);
      }

      // Validate required fields
      if (!manifest.name) {
        throw new Error(`Missing 'name' in ${entry.entryName}`);
      }
      if (!manifest.version) {
        throw new Error(`Missing 'version' in ${entry.entryName}`);
      }
      if (!manifest.description) {
        throw new Error(`Missing 'description' in ${entry.entryName}`);
      }

      break;
    }
  }

  if (!manifestFound) {
    throw new Error('Missing prompd.json in package');
  }
}

/**
 * Creates the 'pack' command (alias for 'package create')
 * Convenient shorthand like 'npm pack'
 */
export function createPackCommand(): Command {
  const packCommand = new Command('pack');
  packCommand
    .description('Create a .pdpkg package (alias for "package create")')
    .argument('<source>', 'Source .pdproj file or directory')
    .argument('[output]', 'Output .pdpkg file path (optional)')
    .option('--name <name>', 'Package name (overrides .pdproj)')
    .option('-n, --name <name>', 'Package name (overrides .pdproj)')
    .option('--version <version>', 'Package version (overrides .pdproj)')
    .option('-V, --version <version>', 'Package version (overrides .pdproj)')
    .option('--description <description>', 'Package description (overrides .pdproj)')
    .option('-d, --description <description>', 'Package description (overrides .pdproj)')
    .option('--author <author>', 'Package author (overrides .pdproj)')
    .option('-a, --author <author>', 'Package author (overrides .pdproj)')
    .option('-t, --type <type>', 'Package type (package, workflow, skill, node-template)', 'package')
    .action(async (source: string, output?: string, options?: Record<string, string>) => {
      try {
        await handlePackageCreate(source, output, options);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`Package creation failed: ${message}`));
        process.exit(1);
      }
    });

  return packCommand;
}

/**
 * Programmatic API: Create package from prompd.json
 * Used by Electron app for modal-less package creation
 */
export interface CreatePackageResult {
  success: boolean;
  outputPath?: string;
  fileName?: string;
  size?: number;
  fileCount?: number;
  message?: string;
  error?: string;
  log?: string;  // Detailed build log for raw output display
}

/** Default file extensions that are valid for packaging */
const PACKABLE_EXTENSIONS = [
  '.prmd', '.prompd', '.pdflow',  // Prompd files
  '.md', '.txt',                   // Documentation
  '.json', '.yaml', '.yml',        // Config/data files
  '.js', '.ts', '.mjs', '.cjs',    // JavaScript/TypeScript
  '.py', '.sh', '.bash',           // Scripts
  '.csv', '.xml',                  // Data files
];

/** Directories to always exclude */
const DEFAULT_EXCLUDE_DIRS = [
  'node_modules', '.git', '.prompd', '__pycache__', '.venv', 'venv',
  'dist', 'build', 'out', '.next', '.nuxt', 'coverage', '.nyc_output',
  '.idea', '.vscode', '.vs',
];

/** Patterns to always exclude */
const DEFAULT_EXCLUDE_PATTERNS = [
  '.env', '.env.*', '*.log', '*.tmp', '*.cache', '*.lock',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.DS_Store', 'Thumbs.db', '*.pdpkg', '*.pdproj',
  'dist/**', '.prompd/**',  // Build output and installed dependencies
  'prompd.json',  // Excluded - we generate this in the archive with populated files array
];

/**
 * Check if a file path matches any of the ignore patterns
 */
function matchesIgnorePattern(filePath: string, patterns: string[]): boolean {
  const fileName = path.basename(filePath);
  const normalizedPath = filePath.replace(/\\/g, '/');

  for (const pattern of patterns) {
    // Simple glob matching
    const regexPattern = pattern
      .replace(/\./g, '\\.')           // Escape dots
      .replace(/\*\*/g, '<<<GLOBSTAR>>>')  // Placeholder for **
      .replace(/\*/g, '[^/]*')         // Single * = any chars except /
      .replace(/<<<GLOBSTAR>>>/g, '.*') // ** = any path including /
      .replace(/\?/g, '.');            // ? = single char

    const regex = new RegExp(`^${regexPattern}$|/${regexPattern}$|^${regexPattern}/|/${regexPattern}/`);

    if (regex.test(normalizedPath) || regex.test(fileName)) {
      return true;
    }

    // Also check exact match
    if (fileName === pattern || normalizedPath === pattern || normalizedPath.endsWith('/' + pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Discover all packable files in a workspace, applying ignore patterns
 */
async function discoverPackableFiles(
  workspacePath: string,
  ignorePatterns: string[] = []
): Promise<string[]> {
  const files: string[] = [];

  // Combine default and custom ignore patterns
  const allIgnorePatterns = [
    ...DEFAULT_EXCLUDE_PATTERNS,
    ...ignorePatterns
  ];

  const walkDir = async (dir: string, relativePath: string = ''): Promise<void> => {
    let items: string[];
    try {
      items = await fs.readdir(dir);
    } catch (err) {
      return; // Skip unreadable directories
    }

    for (const item of items) {
      const itemPath = path.join(dir, item);
      const itemRelPath = relativePath ? path.join(relativePath, item) : item;

      let stat;
      try {
        stat = await fs.stat(itemPath);
      } catch (err) {
        continue; // Skip unreadable files
      }

      if (stat.isDirectory()) {
        // Skip default excluded directories
        if (DEFAULT_EXCLUDE_DIRS.includes(item)) {
          continue;
        }

        // Skip directories matching ignore patterns
        if (matchesIgnorePattern(itemRelPath, allIgnorePatterns)) {
          continue;
        }

        await walkDir(itemPath, itemRelPath);
      } else {
        // Skip files matching ignore patterns
        if (matchesIgnorePattern(itemRelPath, allIgnorePatterns)) {
          continue;
        }

        // Check if file extension is packable
        const ext = path.extname(item).toLowerCase();
        if (PACKABLE_EXTENSIONS.includes(ext)) {
          // Use forward slashes for consistency
          files.push(itemRelPath.replace(/\\/g, '/'));
        }
      }
    }
  };

  await walkDir(workspacePath);

  return files.sort();
}

/**
 * Parse a single .prmd file and return all local file dependencies as
 * workspace-relative paths.  Traces:
 *   - system:, user:, task:, assistant:, response:, output: (file path values)
 *   - context: / contexts: (string or array of strings)
 *   - override: (object whose values are file paths)
 *   - inherits: (local .prmd path — excludes @scope/pkg references)
 *   - {% include "..." %} directives in the body
 *
 * Only paths starting with ./ or ../ are treated as file references.
 * Returns workspace-relative forward-slash paths.
 */
async function tracePrmdFileDependencies(
  prmdRelativePath: string,
  workspacePath: string
): Promise<string[]> {
  const deps = new Set<string>();
  const prmdDir = path.dirname(path.join(workspacePath, prmdRelativePath));

  let content: string;
  try {
    content = (await fs.readFile(path.join(workspacePath, prmdRelativePath), 'utf-8')).replace(/\r\n/g, '\n');
  } catch {
    return [];
  }

  // Parse YAML frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];

  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = (yaml.load(fmMatch[1]) as Record<string, unknown>) || {};
  } catch {
    return [];
  }

  /** Resolve a ref relative to the .prmd file and return workspace-relative path, or null if out-of-workspace or not a path ref */
  function resolve(ref: unknown): string | null {
    if (typeof ref !== 'string') return null;
    if (!ref.startsWith('./') && !ref.startsWith('../')) return null;
    const abs = path.resolve(prmdDir, ref);
    const wsRoot = path.resolve(workspacePath);
    if (!abs.startsWith(wsRoot + path.sep) && abs !== wsRoot) return null;
    return path.relative(workspacePath, abs).replace(/\\/g, '/');
  }

  // system:, user:, task:, assistant:, response:, output:
  const sectionFields = ['system', 'user', 'task', 'assistant', 'response', 'output'];
  for (const field of sectionFields) {
    const val = frontmatter[field];
    const refs = Array.isArray(val) ? val : [val];
    for (const ref of refs) {
      const r = resolve(ref);
      if (r) deps.add(r);
    }
  }

  // context: / contexts:
  const ctxVal = frontmatter['context'] ?? frontmatter['contexts'];
  const ctxRefs = Array.isArray(ctxVal) ? ctxVal : ctxVal !== undefined ? [ctxVal] : [];
  for (const ref of ctxRefs) {
    const r = resolve(ref);
    if (r) deps.add(r);
  }

  // override: { key: "path" }
  if (frontmatter['override'] && typeof frontmatter['override'] === 'object' && !Array.isArray(frontmatter['override'])) {
    for (const val of Object.values(frontmatter['override'] as Record<string, unknown>)) {
      const r = resolve(val);
      if (r) deps.add(r);
    }
  }

  // inherits: (local only — skip @scope/pkg refs)
  const inherits = frontmatter['inherits'];
  if (typeof inherits === 'string' && !inherits.startsWith('@')) {
    const r = resolve(inherits.startsWith('./') || inherits.startsWith('../') ? inherits : './' + inherits);
    if (r) deps.add(r);
  }

  // {% include "..." %} in body
  const body = content.slice(fmMatch[0].length);
  const includeRe = /\{%-?\s*include\s+["']([^"']+)["']\s*-?%\}/g;
  let m: RegExpExecArray | null;
  while ((m = includeRe.exec(body)) !== null) {
    const r = resolve(m[1].startsWith('./') || m[1].startsWith('../') ? m[1] : './' + m[1]);
    if (r) deps.add(r);
  }

  return Array.from(deps);
}

export async function createPackageFromPrompdJson(
  workspacePath: string,
  outputDir?: string
): Promise<CreatePackageResult> {
  const prompdJsonPath = path.join(workspacePath, 'prompd.json');

  // 1. Check prompd.json exists
  if (!await fs.pathExists(prompdJsonPath)) {
    return {
      success: false,
      error: 'No prompd.json found in workspace root. Create a prompd.json file first.'
    };
  }

  // 2. Parse prompd.json
  let prompdJson: any;
  try {
    prompdJson = await fs.readJson(prompdJsonPath);
  } catch (parseErr: any) {
    return {
      success: false,
      error: `Invalid prompd.json: ${parseErr.message}`
    };
  }

  // 3. Validate required fields
  if (!prompdJson.name) {
    return { success: false, error: 'prompd.json is missing required field: name' };
  }
  if (!prompdJson.version) {
    return { success: false, error: 'prompd.json is missing required field: version' };
  }
  if (!prompdJson.description || prompdJson.description.length < 10) {
    return { success: false, error: 'prompd.json description must be at least 10 characters' };
  }
  if (!prompdJson.main) {
    return { success: false, error: 'prompd.json is missing required field: main (main .prmd entry point)' };
  }

  // Validate package type if specified
  if (prompdJson.type && !isValidPackageType(prompdJson.type)) {
    return { success: false, error: `Invalid package type '${prompdJson.type}' in prompd.json. Valid types: package, workflow, skill, node-template` };
  }

  // 4. Auto-discover files if files array is empty or missing
  let filesToPackage: string[] = prompdJson.files || [];
  let autoDiscovered = false;

  if (!Array.isArray(filesToPackage) || filesToPackage.length === 0) {
    // Auto-discover packable files using ignore patterns
    const ignorePatterns = prompdJson.ignore || [];
    filesToPackage = await discoverPackableFiles(workspacePath, ignorePatterns);
    autoDiscovered = true;

    if (filesToPackage.length === 0) {
      return {
        success: false,
        error: 'No packable files found in workspace. Add .prmd, .md, .json, or other valid files.'
      };
    }
  }

  // 5. Validate main file exists
  const mainFilePath = path.join(workspacePath, prompdJson.main);
  if (!await fs.pathExists(mainFilePath)) {
    return { success: false, error: `Main file not found: ${prompdJson.main}` };
  }

  // Ensure main file is included in the files to package
  const mainFileNormalized = prompdJson.main.replace(/\\/g, '/');
  if (!filesToPackage.includes(mainFileNormalized)) {
    filesToPackage.unshift(mainFileNormalized);
  }

  // 6. Validate all files exist and scan for secrets
  const secretsFound: Array<{ file: string; type: string; line: number }> = [];
  const missingFiles: string[] = [];

  for (const filePath of filesToPackage) {
    const fullPath = path.join(workspacePath, filePath);

    // Check file exists
    if (!await fs.pathExists(fullPath)) {
      missingFiles.push(filePath);
      continue;
    }

    // Scan for secrets in text files
    const ext = path.extname(filePath).toLowerCase();
    const textExtensions = ['.prmd', '.txt', '.json', '.yaml', '.yml', '.md', '.js', '.ts', '.py', '.sh', '.env'];

    if (textExtensions.includes(ext)) {
      try {
        const scanResult = await SecurityManager.scanFileForSecrets(fullPath);
        if (scanResult.hasSecrets) {
          scanResult.secrets.forEach((secret: { type: string; line: number }) => {
            secretsFound.push({
              file: filePath,
              type: secret.type,
              line: secret.line
            });
          });
        }
      } catch (scanErr: any) {
        console.warn(`[Package] Secret scan failed for ${filePath}: ${scanErr.message}`);
      }
    }
  }

  if (missingFiles.length > 0) {
    return {
      success: false,
      error: `Missing files:\n${missingFiles.map(f => '  - ' + f).join('\n')}`
    };
  }

  if (secretsFound.length > 0) {
    const secretsList = secretsFound.map(s => `  - ${s.file}:${s.line} (${s.type})`).join('\n');
    return {
      success: false,
      error: `Secrets detected! Remove before packaging:\n${secretsList}`
    };
  }

  // 6b. Validate all .prmd files compile without errors (check inherits, parameters, etc.)
  const prmdValidationErrors: Array<{ file: string; errors: string[] }> = [];
  const compiler = new PrompdCompiler();
  const fileSystem = new NodeFileSystem();

  for (const filePath of filesToPackage) {
    if (!filePath.endsWith('.prmd')) continue;

    const fullPath = path.join(workspacePath, filePath);
    try {
      const context = await compiler.compileWithContext(fullPath, {
        outputFormat: 'markdown',
        fileSystem,
        workspaceRoot: workspacePath
      });

      // Collect errors from compilation
      const errors = context.getDiagnostics()
        .filter(d => d.severity === 'error')
        .map(d => {
          const location = d.line ? ` (line ${d.line})` : '';
          return `${d.message}${location}`;
        });

      if (errors.length > 0) {
        prmdValidationErrors.push({ file: filePath, errors });
      }
    } catch (compileErr: any) {
      prmdValidationErrors.push({
        file: filePath,
        errors: [compileErr.message || 'Compilation failed']
      });
    }
  }

  if (prmdValidationErrors.length > 0) {
    const errorList = prmdValidationErrors.map(e =>
      `  ${e.file}:\n${e.errors.map(err => `    - ${err}`).join('\n')}`
    ).join('\n');
    return {
      success: false,
      error: `Validation errors in .prmd files:\n${errorList}`
    };
  }

  // 6c. Validate all .pdflow workflow files for structural integrity and referenced files
  const workflowValidationErrors: Array<{ file: string; errors: string[] }> = [];

  for (const filePath of filesToPackage) {
    if (!filePath.endsWith('.pdflow')) continue;

    const fullPath = path.join(workspacePath, filePath);
    const errors: string[] = [];

    try {
      // Read and parse workflow file
      const workflowContent = await fs.readFile(fullPath, 'utf8');

      if (!workflowContent || workflowContent.trim() === '') {
        errors.push('Workflow file is empty');
        workflowValidationErrors.push({ file: filePath, errors });
        continue;
      }

      const workflow = JSON.parse(workflowContent);

      // Validate required top-level fields
      if (!workflow.version) {
        errors.push('Missing required field: version');
      }
      if (!workflow.metadata) {
        errors.push('Missing required field: metadata');
      } else {
        if (!workflow.metadata.id) {
          errors.push('Missing required field: metadata.id');
        }
        if (!workflow.metadata.name) {
          errors.push('Missing required field: metadata.name');
        }
      }
      if (!Array.isArray(workflow.nodes)) {
        errors.push('Missing or invalid field: nodes (must be an array)');
      } else if (workflow.nodes.length === 0) {
        errors.push('Workflow must have at least one node');
      }
      if (!Array.isArray(workflow.edges)) {
        errors.push('Missing or invalid field: edges (must be an array)');
      }

      // Extract and validate referenced files
      const referencedFiles = new Set<string>();

      if (Array.isArray(workflow.nodes)) {
        for (const node of workflow.nodes) {
          // Check prompt nodes for file references
          if (node.type === 'prompt' && node.data?.source) {
            const source = node.data.source;
            const sourceType = node.data.sourceType;

            // Only validate local file references (not package references or raw)
            if (sourceType !== 'raw' && !source.startsWith('@')) {
              referencedFiles.add(source);
            }
          }

          // Check workflow nodes for sub-workflow references
          if (node.type === 'workflow' && node.data?.workflowPath) {
            const workflowPath = node.data.workflowPath;
            if (!workflowPath.startsWith('@')) {
              referencedFiles.add(workflowPath);
            }
          }
        }
      }

      // Verify all referenced files exist
      // Resolve relative to workflow file directory (handles ../prompts/file.prmd)
      // with fallback to workspace root for backward compatibility (./prompts/file.prmd)
      const workflowDir = path.dirname(fullPath);
      for (const refFile of referencedFiles) {
        let refFullPath = path.resolve(workflowDir, refFile);
        let refFileExists = await fs.pathExists(refFullPath);

        // Fallback: try workspace root for old-format paths
        if (!refFileExists) {
          const workspaceRelativePath = path.join(workspacePath, refFile);
          if (await fs.pathExists(workspaceRelativePath)) {
            refFullPath = workspaceRelativePath;
            refFileExists = true;
          }
        }

        if (!refFileExists) {
          errors.push(`Referenced file not found: ${refFile}`);
        } else if (refFile.endsWith('.prmd')) {
          // Validate .prmd files can compile
          try {
            const context = await compiler.compileWithContext(refFullPath, {
              outputFormat: 'markdown',
              fileSystem,
              workspaceRoot: workspacePath
            });

            const compileErrors = context.getDiagnostics()
              .filter(d => d.severity === 'error')
              .map(d => {
                const location = d.line ? ` (line ${d.line})` : '';
                return `${d.message}${location}`;
              });

            if (compileErrors.length > 0) {
              errors.push(`Referenced file ${refFile} has compilation errors:\n${compileErrors.map(e => `      - ${e}`).join('\n')}`);
            }
          } catch (compileErr: any) {
            errors.push(`Referenced file ${refFile} failed to compile: ${compileErr.message}`);
          }
        } else if (refFile.endsWith('.pdflow')) {
          // Note: We don't recursively validate sub-workflows here to avoid infinite loops
          // The sub-workflow will be validated when it's encountered in filesToPackage
        }
      }

    } catch (parseErr: any) {
      if (parseErr instanceof SyntaxError) {
        errors.push(`Invalid JSON: ${parseErr.message}`);
      } else {
        errors.push(`Validation failed: ${parseErr.message || 'Unknown error'}`);
      }
    }

    if (errors.length > 0) {
      workflowValidationErrors.push({ file: filePath, errors });
    }
  }

  if (workflowValidationErrors.length > 0) {
    const errorList = workflowValidationErrors.map(e =>
      `  ${e.file}:\n${e.errors.map(err => `    - ${err}`).join('\n')}`
    ).join('\n');
    return {
      success: false,
      error: `Validation errors in .pdflow workflow files:\n${errorList}`
    };
  }

  // 6d. Trace .prmd file dependencies and verify all are present and included in package
  const depErrors: Array<{ file: string; missing: string[]; excluded: string[] }> = [];

  for (const filePath of filesToPackage) {
    if (!filePath.endsWith('.prmd')) continue;

    const deps = await tracePrmdFileDependencies(filePath, workspacePath);
    if (deps.length === 0) continue;

    const missing: string[] = [];
    const excluded: string[] = [];

    for (const dep of deps) {
      const depFullPath = path.join(workspacePath, dep);
      if (!await fs.pathExists(depFullPath)) {
        missing.push(dep);
      } else if (!filesToPackage.includes(dep)) {
        excluded.push(dep);
        // Auto-include so the package is self-contained
        filesToPackage.push(dep);
      }
    }

    if (missing.length > 0 || excluded.length > 0) {
      depErrors.push({ file: filePath, missing, excluded });
    }
  }

  if (depErrors.length > 0) {
    // Missing files are a hard error; auto-included files are warnings surfaced in the log
    const hardErrors = depErrors.filter(e => e.missing.length > 0);
    if (hardErrors.length > 0) {
      const errorList = hardErrors.map(e =>
        `  ${e.file}:\n${e.missing.map(f => `    - missing: ${f}`).join('\n')}`
      ).join('\n');
      return {
        success: false,
        error: `Missing dependency files referenced in .prmd frontmatter:\n${errorList}`
      };
    }
    // Soft warnings (auto-included) — continue, they've been added to filesToPackage
    for (const e of depErrors.filter(d => d.excluded.length > 0)) {
      console.warn(`[Package] Auto-included dependencies for ${e.file}:\n${e.excluded.map(f => `  + ${f}`).join('\n')}`);
    }
  }

  // 7. Create output directory
  const distDir = outputDir || path.join(workspacePath, 'dist');
  await fs.ensureDir(distDir);

  // 8. Generate output filename (strip namespace for scoped packages)
  const packageName = prompdJson.name.includes('/')
    ? prompdJson.name.split('/')[1]
    : prompdJson.name;
  const outputFileName = `${packageName}-v${prompdJson.version}.pdpkg`;
  const outputPath = path.join(distDir, outputFileName);

  // 9. Create manifest for package (includes files array for archive only)
  // Preserve all metadata fields from prompd.json so the registry stores them correctly
  const manifest: PackageManifest = {
    name: prompdJson.name,
    version: prompdJson.version,
    description: prompdJson.description,
    author: prompdJson.author,
    ...(prompdJson.type ? { type: prompdJson.type } : {}),
    ...(Array.isArray(prompdJson.keywords) && prompdJson.keywords.length > 0 ? { keywords: prompdJson.keywords } : {}),
    ...(Array.isArray(prompdJson.tools) && prompdJson.tools.length > 0 ? { tools: prompdJson.tools } : {}),
    ...(Array.isArray(prompdJson.mcps) && prompdJson.mcps.length > 0 ? { mcps: prompdJson.mcps } : {}),
    ...(prompdJson.license ? { license: prompdJson.license } : {}),
    ...(prompdJson.homepage ? { homepage: prompdJson.homepage } : {}),
    ...(prompdJson.repository ? { repository: prompdJson.repository } : {}),
    ...(prompdJson.dependencies ? { dependencies: prompdJson.dependencies } : {}),
  };

  // 10. Create the package
  try {
    // Instead of createPackage (which walks all files), we only include files from the array
    await createPackageFromFiles(
      workspacePath,
      outputPath,
      manifest,
      filesToPackage,
      prompdJson.main,
      prompdJson.readme,
      prompdJson.ignore  // Pass ignore patterns for archive manifest
    );

    const stats = await fs.stat(outputPath);
    const sizeKB = (stats.size / 1024).toFixed(1);

    const autoNote = autoDiscovered ? ' (auto-discovered)' : '';

    // Build detailed log for raw output display
    const logLines = [
      `Package: ${prompdJson.name}@${prompdJson.version}`,
      `Output: dist/${outputFileName}`,
      `Size: ${sizeKB} KB`,
      '',
      `Files included (${filesToPackage.length}):`,
      ...filesToPackage.map(f => `  - ${f}`)
    ];

    return {
      success: true,
      outputPath: outputPath,
      fileName: outputFileName,
      size: stats.size,
      fileCount: filesToPackage.length,
      message: `Package created: dist/${outputFileName} (${sizeKB} KB, ${filesToPackage.length} files${autoNote})`,
      log: logLines.join('\n')
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Package creation failed'
    };
  }
}

/**
 * Add prompd content frontmatter to a file for security.
 * This makes code files non-executable (frontmatter breaks parsing).
 */
function addContentFrontmatter(content: string, filename: string): string {
  const contentType = getContentType(filename);

  const frontmatter = `---
prompd_content_file: true
original_filename: ${filename}
content_type: ${contentType}
---
`;
  return frontmatter + content;
}

/**
 * Create package from specific file list (not directory walk)
 * The files array is written to the archive's prompd.json (not the filesystem)
 */
async function createPackageFromFiles(
  workspacePath: string,
  outputPath: string,
  manifest: PackageManifest,
  files: string[],
  mainFile?: string,
  readmeFile?: string,
  ignorePatterns?: string[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));

    archive.pipe(output);

    // Files array uses original paths (no transformation needed with frontmatter approach)
    const normalizedFiles = files.map(f => f.replace(/\\/g, '/'));

    // Collect file contents and compute integrity hashes
    const fileHashes: Record<string, string> = {};
    const fileContents: Array<{ zipPath: string; content: string | Buffer }> = [];

    for (const filePath of files) {
      const fullPath = path.join(workspacePath, filePath);
      const zipPath = filePath.replace(/\\/g, '/');

      // For code files, add frontmatter protection
      if (needsFrontmatterProtection(filePath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const filename = path.basename(filePath);
        const protectedContent = addContentFrontmatter(content, filename);
        // Hash the protected content (with frontmatter) - matches what's in archive
        fileHashes[zipPath] = createHash('sha256').update(protectedContent).digest('hex');
        fileContents.push({ zipPath, content: protectedContent });
      } else {
        // For non-code files, read content for hashing
        const content = fs.readFileSync(fullPath);
        fileHashes[zipPath] = createHash('sha256').update(content).digest('hex');
        fileContents.push({ zipPath, content });
      }
    }

    // Add prompd.json (inside the package) with files array and integrity hashes
    // This writes the files array to the archive only, not the filesystem
    const fullManifest = {
      ...manifest,
      main: mainFile,
      readme: readmeFile,
      files: normalizedFiles,
      integrity: {
        algorithm: 'sha256',
        files: fileHashes
      },
      ...(ignorePatterns && ignorePatterns.length > 0 ? { ignore: ignorePatterns } : {})
    };
    archive.append(JSON.stringify(fullManifest, null, 2), { name: 'prompd.json' });

    // Add all files to archive
    for (const { zipPath, content } of fileContents) {
      archive.append(content, { name: zipPath });
    }

    archive.finalize();
  });
}