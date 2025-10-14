import { Command } from 'commander';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as readline from 'readline';

interface InitOptions {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
}

export function createInitCommand(): Command {
  const initCommand = new Command('init');

  initCommand
    .description('Initialize a new Prompd project with manifest.json')
    .argument('[path]', 'Project directory (default: current directory)', '.')
    .option('--name <name>', 'Project name (default: directory name)')
    .option('--version <version>', 'Initial version (default: 1.0.0)')
    .option('--description <description>', 'Project description')
    .option('--author <author>', 'Project author')
    .action(async (projectPath: string, options: InitOptions) => {
      try {
        await initProject(projectPath, options);
      } catch (error) {
        if (error instanceof Error) {
          console.error(`ERROR: Failed to initialize project: ${error.message}`);
        } else {
          console.error('ERROR: Failed to initialize project');
        }
        process.exit(1);
      }
    });

  return initCommand;
}

async function initProject(projectPath: string, options: InitOptions): Promise<void> {
  // Resolve absolute path
  const absPath = path.resolve(projectPath);

  // Create directory if it doesn't exist
  if (!await fs.pathExists(absPath)) {
    await fs.mkdirs(absPath);
    console.log(`✓ Created directory: ${absPath}`);
  }

  // Check if manifest.json already exists
  const manifestPath = path.join(absPath, 'manifest.json');
  if (await fs.pathExists(manifestPath)) {
    console.log(`Warning: manifest.json already exists in ${absPath}`);
    const shouldOverwrite = await promptYesNo('Overwrite? (y/N): ');
    if (!shouldOverwrite) {
      console.log('Aborted');
      return;
    }
  }

  // Generate smart defaults
  let name = options.name;
  if (!name) {
    name = path.basename(absPath);
    name = name.toLowerCase();
    name = name.replace(/\s+/g, '-');
    name = name.replace(/_/g, '-');
  }

  const version = options.version || '1.0.0';
  const description = options.description || `Prompd project: ${name}`;
  const author = options.author || 'unknown';

  // Create manifest data
  const manifest = {
    name,
    version,
    description,
    author,
    files: [
      '*.prmd',
      '*.md',
      'templates/',
      'docs/',
      'examples/'
    ],
    ignore: [
      '*.log',
      '*.tmp',
      '.env*'
    ],
    dependencies: {},
    devDependencies: {}
  };

  // Write manifest.json
  await fs.writeJSON(manifestPath, manifest, { spaces: 2 });
  console.log('✓ Created manifest.json');
  console.log(`✓ Initialized Prompd project: ${name}`);

  // Create a sample .prmd file if none exists
  const prmdFiles = await fs.readdir(absPath);
  const hasPrmd = prmdFiles.some(f => f.endsWith('.prmd'));

  if (!hasPrmd) {
    const samplePath = path.join(absPath, 'example.prmd');
    const sampleContent = `---
id: ${name}-example
name: ${name} Example
version: ${version}
description: Example prompt for ${name}
parameters:
  - name: name
    type: string
    required: true
    description: Name to greet
---

# System
You are a helpful assistant.

# User
Hello {name}! Welcome to ${name}.

This is an example .prmd file to get you started.

## Usage
\`\`\`bash
prompd run example.prmd --provider openai --model gpt-4o -p name="World"
\`\`\`
`;

    await fs.writeFile(samplePath, sampleContent, 'utf-8');
    console.log('✓ Created example.prmd');
  }

  // Print success message
  console.log('\nProject initialized!');
  console.log(`  Directory: ${absPath}`);
  console.log(`  Name: ${name}`);
  console.log(`  Version: ${version}`);
  console.log('\nNext steps:');
  if (absPath !== process.cwd()) {
    console.log(`  cd ${path.basename(absPath)}`);
  }
  console.log('  prompd validate example.prmd');
  console.log(`  prompd pack . -o ${name}-${version}.pdpkg`);
}

function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}
