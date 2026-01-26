import { Command } from 'commander';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as yaml from 'yaml';

interface Manifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface PrompdFile {
  inherits?: string;
  name?: string;
  version?: string;
}

export function createDepsCommand(): Command {
  const depsCommand = new Command('deps');

  depsCommand
    .description('Analyze project dependencies')
    .argument('<target>', 'File, directory, package, or package reference to analyze')
    .option('--tree', 'Show dependency tree')
    .option('--conflicts', 'Check for version conflicts')
    .action(async (target: string, options: { tree?: boolean; conflicts?: boolean }) => {
      try {
        await analyzeDependencies(target, options.tree || false, options.conflicts || false);
      } catch (error) {
        if (error instanceof Error) {
          console.error(`ERROR: ${error.message}`);
        } else {
          console.error('ERROR: Failed to analyze dependencies');
        }
        process.exit(1);
      }
    });

  return depsCommand;
}

async function analyzeDependencies(target: string, showTree: boolean, showConflicts: boolean): Promise<void> {
  // Check if target is a package reference
  if (target.startsWith('@')) {
    await analyzePackageDeps(target, showTree, showConflicts);
    return;
  }

  // Check if it's a file or directory
  const stats = await fs.stat(target);

  if (stats.isDirectory()) {
    await analyzeProjectDeps(target, showTree, showConflicts);
    return;
  }

  if (target.endsWith('.prmd')) {
    await analyzeFileDeps(target, showTree, showConflicts);
    return;
  }

  if (target.endsWith('.pdpkg')) {
    await analyzePackageFileDeps(target, showTree, showConflicts);
    return;
  }

  throw new Error(`Unsupported target type: ${target}`);
}

async function analyzeProjectDeps(projectPath: string, showTree: boolean, showConflicts: boolean): Promise<void> {
  const manifestPath = path.join(projectPath, 'prompd.json');

  if (!await fs.pathExists(manifestPath)) {
    throw new Error(`No prompd.json found in ${projectPath}`);
  }

  const manifest: Manifest = await fs.readJSON(manifestPath);

  console.log(`Dependencies for project: ${projectPath}`);
  console.log();

  const deps = manifest.dependencies || {};
  const devDeps = manifest.devDependencies || {};

  if (Object.keys(deps).length === 0 && Object.keys(devDeps).length === 0) {
    console.log('No dependencies found');
    return;
  }

  if (Object.keys(deps).length > 0) {
    console.log('Dependencies:');
    for (const [pkg, version] of Object.entries(deps)) {
      console.log(`  ${pkg}@${version}`);
    }
    console.log();
  }

  if (Object.keys(devDeps).length > 0) {
    console.log('Dev Dependencies:');
    for (const [pkg, version] of Object.entries(devDeps)) {
      console.log(`  ${pkg}@${version}`);
    }
    console.log();
  }

  if (showTree) {
    console.log('Dependency Tree:');
    for (const [pkg, version] of Object.entries(deps)) {
      printDependencyTree(pkg, version, 0, new Set());
    }
  }

  if (showConflicts) {
    const conflicts = detectConflicts(deps, devDeps);
    if (conflicts.length > 0) {
      console.log('⚠️  Version Conflicts:');
      for (const conflict of conflicts) {
        console.log(`  ${conflict}`);
      }
    } else {
      console.log('✓ No version conflicts detected');
    }
  }
}

async function analyzeFileDeps(filePath: string, showTree: boolean, showConflicts: boolean): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8');

  // Parse YAML frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    console.log('No frontmatter found in file');
    return;
  }

  const prompd: PrompdFile = yaml.parse(frontmatterMatch[1]);

  console.log(`Dependencies for file: ${filePath}`);
  console.log();

  if (!prompd.inherits) {
    console.log('No inheritance dependencies');
    return;
  }

  console.log(`Inherits: ${prompd.inherits}`);

  if (showTree) {
    console.log('\nInheritance Chain:');
    printInheritanceChain(prompd.inherits, 0, new Set());
  }
}

async function analyzePackageFileDeps(packagePath: string, showTree: boolean, showConflicts: boolean): Promise<void> {
  console.log(`Analyzing package: ${packagePath}`);
  console.log('(Package dependency analysis not yet implemented)');
}

async function analyzePackageDeps(packageRef: string, showTree: boolean, showConflicts: boolean): Promise<void> {
  console.log(`Analyzing package reference: ${packageRef}`);
  console.log('(Registry package analysis not yet implemented)');
}

function printDependencyTree(pkg: string, version: string, depth: number, visited: Set<string>): void {
  const indent = '  '.repeat(depth);
  const key = `${pkg}@${version}`;

  if (visited.has(key)) {
    console.log(`${indent}└─ ${key} (circular)`);
    return;
  }

  visited.add(key);
  console.log(`${indent}└─ ${key}`);

  // TODO: Fetch and analyze sub-dependencies
}

function printInheritanceChain(inherits: string, depth: number, visited: Set<string>): void {
  const indent = '  '.repeat(depth);

  if (visited.has(inherits)) {
    console.log(`${indent}└─ ${inherits} (circular reference)`);
    return;
  }

  visited.add(inherits);
  console.log(`${indent}└─ ${inherits}`);

  // TODO: Fetch parent and continue chain
}

function detectConflicts(deps: Record<string, string>, devDeps: Record<string, string>): string[] {
  const conflicts: string[] = [];

  for (const [pkg, version] of Object.entries(deps)) {
    if (devDeps[pkg] && devDeps[pkg] !== version) {
      conflicts.push(`${pkg}: dependency uses ${version}, devDependency uses ${devDeps[pkg]}`);
    }
  }

  return conflicts;
}
