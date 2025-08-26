import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { RegistryClient, createDefaultRegistryConfig, SearchQuery } from '../lib/registry';

export function createRegistryCommand(): Command {
  const command = new Command('registry');
  command.description('Package registry operations for sharing and discovering workflows');

  // Publish command
  const publishCommand = new Command('publish');
  publishCommand
    .description('Publish a package to the registry')
    .argument('[directory]', 'Directory containing project.prompdproj file', '.')
    .option('--access <access>', 'Package access level', 'public')
    .option('--tag <tag>', 'Package tag', 'latest')
    .option('--dry-run', 'Show what would be published without actually publishing')
    .option('--force', 'Force publish even if version exists')
    .option('--registry <url>', 'Registry URL override')
    .action(async (directory: string, options) => {
      try {
        console.log(chalk.cyan(`📦 Publishing package from ${directory}...`));
        
        const config = createDefaultRegistryConfig();
        if (options.registry) {
          config.registryUrl = options.registry;
        }

        const client = new RegistryClient(config);
        
        // Event listeners for progress
        client.on('publishStart', ({ packageDir, options }) => {
          console.log(chalk.blue(`🚀 Starting publish from ${packageDir}`));
        });
        
        client.on('publishComplete', ({ name, version, access }) => {
          console.log(chalk.green(`✅ Successfully published ${name}@${version} (${access})`));
          console.log(chalk.gray(`   Registry: ${config.registryUrl}`));
          console.log(chalk.gray(`   Install: prompd install ${name}@${version}`));
        });
        
        client.on('publishError', ({ packageDir, error }) => {
          console.error(chalk.red(`❌ Publish failed: ${error.message}`));
        });

        await client.publish(path.resolve(directory), {
          access: options.access as 'public' | 'private',
          tag: options.tag,
          dryRun: options.dryRun,
          force: options.force
        });

      } catch (error) {
        console.error(chalk.red('Publish failed:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Install command
  const installCommand = new Command('install');
  installCommand
    .alias('i')
    .description('Install a package from the registry')
    .argument('<package>', 'Package name (e.g., company/user-auth@1.0.0)')
    .option('-v, --version <version>', 'Specific version to install')
    .option('--save-dev', 'Save to dev dependencies')
    .option('-g, --global', 'Install globally')
    .option('--force', 'Force reinstall')
    .option('--skip-cache', 'Skip cache and download fresh')
    .option('--registry <url>', 'Registry URL override')
    .action(async (packageName: string, options) => {
      try {
        console.log(chalk.cyan(`📦 Installing ${packageName}...`));
        
        const config = createDefaultRegistryConfig();
        if (options.registry) {
          config.registryUrl = options.registry;
        }

        const client = new RegistryClient(config);
        
        // Event listeners
        client.on('installStart', ({ packageName, options }) => {
          console.log(chalk.blue(`📥 Downloading ${packageName}...`));
        });
        
        client.on('installingDependency', ({ name, version }) => {
          console.log(chalk.gray(`   Installing dependency: ${name}@${version}`));
        });
        
        client.on('installingFromCache', ({ name, version }) => {
          console.log(chalk.yellow(`📂 Using cached ${name}@${version}`));
        });
        
        client.on('installComplete', ({ name, version }) => {
          console.log(chalk.green(`✅ Successfully installed ${name}@${version}`));
        });
        
        client.on('installError', ({ packageName, error }) => {
          console.error(chalk.red(`❌ Install failed: ${error.message}`));
        });

        await client.install(packageName, {
          version: options.version,
          saveDev: options.saveDev,
          global: options.global,
          force: options.force,
          skipCache: options.skipCache
        });

      } catch (error) {
        console.error(chalk.red('Install failed:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Search command
  const searchCommand = new Command('search');
  searchCommand
    .description('Search for packages in the registry')
    .argument('<query>', 'Search query')
    .option('-c, --category <category>', 'Filter by category')
    .option('-t, --type <type>', 'Filter by type (prompt, workflow, collection)')
    .option('--tags <tags>', 'Filter by tags (comma-separated)')
    .option('--author <author>', 'Filter by author')
    .option('-l, --limit <limit>', 'Number of results', '20')
    .option('--sort <sort>', 'Sort order (relevance, downloads, updated, created)', 'relevance')
    .option('--registry <url>', 'Registry URL override')
    .action(async (query: string, options) => {
      try {
        console.log(chalk.cyan(`🔍 Searching for "${query}"...`));
        
        const config = createDefaultRegistryConfig();
        if (options.registry) {
          config.registryUrl = options.registry;
        }

        const client = new RegistryClient(config);
        
        const searchQuery: SearchQuery = {
          query,
          category: options.category,
          type: options.type as any,
          tags: options.tags ? options.tags.split(',') : undefined,
          author: options.author,
          limit: parseInt(options.limit),
          sort: options.sort as any
        };

        const results = await client.search(searchQuery);
        
        console.log(chalk.green(`\n📦 Found ${results.total} packages:`));
        console.log();

        for (const pkg of results.packages) {
          console.log(`${chalk.bold(pkg.name)} ${chalk.gray(`v${pkg.version}`)}`);
          console.log(`   ${pkg.description}`);
          console.log(`   ${chalk.blue(`@${pkg.author}`)} • ${chalk.yellow(pkg.category)} • ${pkg.downloads.toLocaleString()} downloads`);
          
          if (pkg.tags.length > 0) {
            console.log(`   ${pkg.tags.map(tag => chalk.cyan(`#${tag}`)).join(' ')}`);
          }
          
          console.log(`   ${chalk.gray(`Updated ${new Date(pkg.updatedAt).toLocaleDateString()}`)}`);
          console.log();
        }

        if (results.hasMore) {
          console.log(chalk.gray(`... and ${results.total - results.packages.length} more results`));
          console.log(chalk.gray('Use --limit to see more results'));
        }

      } catch (error) {
        console.error(chalk.red('Search failed:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Info command
  const infoCommand = new Command('info');
  infoCommand
    .description('Show package information')
    .argument('<package>', 'Package name')
    .option('-v, --version <version>', 'Specific version')
    .option('--registry <url>', 'Registry URL override')
    .action(async (packageName: string, options) => {
      try {
        const config = createDefaultRegistryConfig();
        if (options.registry) {
          config.registryUrl = options.registry;
        }

        const client = new RegistryClient(config);
        const packageInfo = await client.getPackageInfo(packageName, options.version);
        
        console.log(chalk.cyan(`📦 ${packageInfo.name}@${packageInfo.version}`));
        console.log();
        console.log(`Description: ${packageInfo.description}`);
        console.log(`Author: ${packageInfo.author}`);
        console.log(`License: ${packageInfo.license}`);
        console.log(`Type: ${packageInfo.type}`);
        console.log(`Category: ${packageInfo.category}`);
        
        if (packageInfo.keywords.length > 0) {
          console.log(`Keywords: ${packageInfo.keywords.join(', ')}`);
        }
        
        if (packageInfo.tags.length > 0) {
          console.log(`Tags: ${packageInfo.tags.map(tag => `#${tag}`).join(' ')}`);
        }
        
        console.log(`Created: ${new Date(packageInfo.createdAt).toLocaleDateString()}`);
        console.log(`Updated: ${new Date(packageInfo.updatedAt).toLocaleDateString()}`);
        
        if (packageInfo.repository) {
          console.log(`Repository: ${packageInfo.repository.url}`);
        }
        
        if (Object.keys(packageInfo.dependencies).length > 0) {
          console.log();
          console.log(chalk.bold('Dependencies:'));
          for (const [name, version] of Object.entries(packageInfo.dependencies)) {
            console.log(`  ${name}: ${version}`);
          }
        }
        
        console.log();
        console.log(chalk.gray('Install:'));
        console.log(`  prompd install ${packageInfo.name}@${packageInfo.version}`);

      } catch (error) {
        console.error(chalk.red('Failed to get package info:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Versions command
  const versionsCommand = new Command('versions');
  versionsCommand
    .description('List available versions for a package')
    .argument('<package>', 'Package name')
    .option('--registry <url>', 'Registry URL override')
    .action(async (packageName: string, options) => {
      try {
        const config = createDefaultRegistryConfig();
        if (options.registry) {
          config.registryUrl = options.registry;
        }

        const client = new RegistryClient(config);
        const versions = await client.getPackageVersions(packageName);
        
        if (versions.length === 0) {
          console.log(chalk.yellow(`No versions found for ${packageName}`));
          return;
        }
        
        console.log(chalk.cyan(`📦 Available versions for ${packageName}:`));
        console.log();
        
        // Sort versions in descending order
        const sortedVersions = versions.sort((a, b) => {
          const semver = require('semver');
          return semver.rcompare(a, b);
        });
        
        for (const version of sortedVersions) {
          console.log(`  ${version}`);
        }
        
        console.log();
        console.log(chalk.gray('Install specific version:'));
        console.log(`  prompd install ${packageName}@${sortedVersions[0]}`);

      } catch (error) {
        console.error(chalk.red('Failed to get versions:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Init command - create a new project
  const initCommand = new Command('init');
  initCommand
    .description('Initialize a new prompd project')
    .argument('[name]', 'Project name')
    .option('--type <type>', 'Project type (prompt, workflow, collection)', 'collection')
    .option('--category <category>', 'Project category', 'general')
    .option('--author <author>', 'Author name')
    .option('--license <license>', 'License', 'MIT')
    .action(async (name: string, options) => {
      try {
        const projectName = name || path.basename(process.cwd());
        const projectFile = path.join(process.cwd(), 'project.prompdproj');
        
        if (await fs.pathExists(projectFile)) {
          console.error(chalk.red('project.prompdproj already exists in this directory'));
          process.exit(1);
        }

        const author = options.author || process.env.USER || 'Unknown';
        
        const projectConfig = {
          name: projectName,
          version: '1.0.0',
          description: `A ${options.type} project`,
          author,
          license: options.license,
          keywords: [],
          dependencies: {},
          type: options.type,
          category: options.category,
          tags: [],
          files: ['**/*', '!node_modules', '!.git']
        };

        const yaml = require('yaml');
        const content = `---
${yaml.stringify(projectConfig)}---

# ${projectName}

${projectConfig.description}

## Installation

\`\`\`bash
prompd install ${projectName}
\`\`\`

## Usage

Describe how to use this ${options.type} here.
`;

        await fs.writeFile(projectFile, content);
        
        // Create basic directory structure
        if (options.type === 'collection') {
          await fs.ensureDir('prompts');
          await fs.ensureDir('workflows');
          
          // Create sample files
          await fs.writeFile('prompts/example.prompd', `---
name: "example-prompt"
description: "An example prompt"
version: "1.0.0"
parameters:
  - name: "input"
    type: "string"
    description: "Input text"
    required: true
---

Process this input: {input}
`);
        }
        
        await fs.writeFile('.prompdignore', `# Ignore files and directories
node_modules/
.git/
.DS_Store
*.log
.env
temp/
cache/
`);

        console.log(chalk.green(`✅ Initialized new ${options.type} project: ${projectName}`));
        console.log(chalk.gray(`Created project.prompdproj`));
        console.log();
        console.log(chalk.blue('Next steps:'));
        console.log('1. Edit project.prompdproj with your project details');
        console.log('2. Add your prompts and workflows');
        console.log('3. Test your project: prompd validate');
        console.log('4. Publish to registry: prompd registry publish');

      } catch (error) {
        console.error(chalk.red('Failed to initialize project:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Add subcommands
  command.addCommand(publishCommand);
  command.addCommand(installCommand);
  command.addCommand(searchCommand);
  command.addCommand(infoCommand);
  command.addCommand(versionsCommand);
  command.addCommand(initCommand);

  return command;
}