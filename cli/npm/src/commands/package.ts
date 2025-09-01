import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as yaml from 'js-yaml';
import archiver from 'archiver';

interface PDProjMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
  settings?: { [key: string]: any };
  exclusions?: PDProjExclusions;
}

interface PDProjExclusions {
  directories?: string[];
  patterns?: string[];
}

interface PackageManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  type: string;
  files?: { [key: string]: any };
}

export function createPackageCommand(): Command {
  const command = new Command('package');
  command.description('Package management commands');

  // Create subcommand
  const createCommand = new Command('create');
  createCommand
    .description('Create a .pdpkg package from a .pdproj file or directory')
    .argument('<source>', 'Source .pdproj file or directory')
    .argument('[output]', 'Output .pdpkg file path (optional)')
    .option('--name <name>', 'Package name (overrides .pdproj)')
    .option('--version <version>', 'Package version (overrides .pdproj)')
    .option('--description <description>', 'Package description (overrides .pdproj)')
    .option('--author <author>', 'Package author (overrides .pdproj)')
    .action(async (source: string, output?: string, options?: any) => {
      try {
        const sourcePath = path.resolve(source);
        
        // Check if source exists
        if (!await fs.pathExists(sourcePath)) {
          console.error(chalk.red(`❌ Source not found: ${sourcePath}`));
          process.exit(1);
        }

        // Check if source is a .pdproj file
        if (sourcePath.endsWith('.pdproj')) {
          await packageFromPdproj(sourcePath);
        } else {
          // Directory mode - requires manual parameters
          if (!options?.name || !options?.version || !options?.description) {
            console.error(chalk.red('❌ Directory packaging requires --name, --version, and --description options'));
            process.exit(1);
          }
          await packageFromDirectory(sourcePath, output, options);
        }

      } catch (error: any) {
        console.error(chalk.red(`❌ Package creation failed: ${error.message}`));
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

        // Only accept .pdpkg files - packages are archives, not individual .prompd files
        if (!fullPath.endsWith('.pdpkg')) {
          console.error(chalk.red('❌ Invalid package format!'));
          console.error(chalk.gray(`   File: ${path.basename(filePath)}`));
          console.error(chalk.gray('   Expected: .pdpkg archive file'));
          console.error(chalk.gray('   Note: .prompd files are individual prompts, not packages'));
          console.error(chalk.gray('   Use \'prompd validate\' to validate individual .prompd files'));
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

async function packageFromPdproj(pdprojPath: string): Promise<void> {
  // Read and parse .pdproj file
  const pdprojContent = await fs.readFile(pdprojPath, 'utf-8');
  let metadata: PDProjMetadata;
  
  try {
    metadata = yaml.load(pdprojContent) as PDProjMetadata;
  } catch (error: any) {
    throw new Error(`Failed to parse .pdproj file: ${error.message}`);
  }

  // Validate required fields
  if (!metadata.name || !metadata.version || !metadata.description) {
    throw new Error('.pdproj file must contain name, version, and description');
  }

  // Source directory is parent of .pdproj file
  const sourceDir = path.dirname(pdprojPath);
  
  // Generate output path
  const outputName = metadata.name.toLowerCase().replace(/\s+/g, '-');
  const outputPath = path.join(sourceDir, `${outputName}-v${metadata.version}.pdpkg`);

  // Create manifest
  const manifest: PackageManifest = {
    name: metadata.name,
    version: metadata.version,
    description: metadata.description,
    author: metadata.author,
    type: 'package'
  };

  // Create package
  await createPackage(sourceDir, outputPath, manifest, metadata.exclusions || {});

  console.log(chalk.green('✓ Package created successfully!'));
  console.log(chalk.cyan(`   Package: ${outputPath}`));
  
  // Get file size
  try {
    const stats = await fs.stat(outputPath);
    const sizeKB = (stats.size / 1024).toFixed(1);
    console.log(chalk.gray(`   Size: ${sizeKB} KB`));
  } catch (error) {
    // Ignore stat errors
  }
}

async function packageFromDirectory(
  sourceDir: string, 
  outputPath?: string, 
  options: any = {}
): Promise<void> {
  const { name, version, description, author } = options;

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
    type: 'package'
  };

  // Create package with default exclusions
  const exclusions: PDProjExclusions = {
    directories: ['.git', '.prompd', 'node_modules', '__pycache__'],
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
  exclusions: PDProjExclusions
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));

    archive.pipe(output);

    // Add manifest.json
    const manifestContent = JSON.stringify(manifest, null, 2);
    archive.append(manifestContent, { name: 'manifest.json' });

    // Walk source directory and add files
    const walkDir = (dir: string, relativePath: string = '') => {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const itemPath = path.join(dir, item);
        const itemRelPath = path.join(relativePath, item);
        const stat = fs.statSync(itemPath);

        if (shouldExclude(itemRelPath, stat.isDirectory(), exclusions)) {
          continue;
        }

        if (stat.isDirectory()) {
          walkDir(itemPath, itemRelPath);
        } else {
          // Use forward slashes in zip paths
          const zipPath = itemRelPath.replace(/\\/g, '/');
          archive.file(itemPath, { name: zipPath });
        }
      }
    };

    walkDir(sourceDir);
    archive.finalize();
  });
}

function shouldExclude(relPath: string, isDirectory: boolean, exclusions: PDProjExclusions): boolean {
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
  
  // Check for manifest.json
  let manifestFound = false;
  for (const entry of entries) {
    if (entry.entryName === 'manifest.json') {
      manifestFound = true;
      
      // Read and validate manifest
      const manifestContent = entry.getData().toString('utf8');
      let manifest: PackageManifest;
      
      try {
        manifest = JSON.parse(manifestContent);
      } catch (error: any) {
        throw new Error(`Invalid manifest.json: ${error.message}`);
      }

      // Validate required fields
      if (!manifest.name) {
        throw new Error("Missing 'name' in manifest.json");
      }
      if (!manifest.version) {
        throw new Error("Missing 'version' in manifest.json");
      }
      if (!manifest.description) {
        throw new Error("Missing 'description' in manifest.json");
      }

      break;
    }
  }

  if (!manifestFound) {
    throw new Error('Missing manifest.json in package');
  }
}