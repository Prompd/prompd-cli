import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as readline from 'readline';

export function createCreateCommand(): Command {
  const createCommand = new Command('create');

  createCommand
    .description('Create a new .prmd file')
    .argument('<file>', 'Path to the .prmd file to create')
    .option('-i, --interactive', 'Interactive mode with prompts')
    .option('-n, --name <name>', 'Prompt name')
    .option('-d, --description <description>', 'Description')
    .option('-a, --author <author>', 'Author name')
    .option('-v, --version <version>', 'Version', '1.0.0')
    .action(async (file: string, options: { interactive?: boolean; name?: string; description?: string; author?: string; version: string }) => {
      try {
        // Ensure .prmd extension
        let filePath = file;
        if (!filePath.endsWith('.prmd')) {
          filePath += '.prmd';
        }

        // Check if file exists
        if (await fs.pathExists(filePath)) {
          console.error(chalk.red(`ERROR: File already exists: ${filePath}`));
          process.exit(1);
        }

        const baseName = path.basename(filePath, '.prmd');
        let name = options.name;
        let description = options.description || '';
        let author = options.author || '';
        let version = options.version;
        let parameters: any[] = [];

        // Interactive mode
        if (options.interactive) {
          console.log(chalk.blue(`Creating new ${path.basename(filePath)} interactively\n`));

          const defaultName = baseName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          name = await promptWithDefault('Prompt name', name || defaultName);
          description = await promptWithDefault('Description', description);
          author = await promptWithDefault('Author', author);
          version = await promptWithDefault('Version', version);

          if (await promptYesNo('Add parameters?', false)) {
            console.log('(Press Enter on empty name to finish)');
            while (true) {
              const paramName = await promptWithDefault('Parameter name (blank to finish)', '');
              if (!paramName) break;

              const paramType = await promptWithDefault('Parameter type [string/integer/float/boolean]', 'string');
              const paramDesc = await promptWithDefault('Parameter description', '');
              const paramRequired = await promptYesNo('Required?', false);

              parameters.push({
                name: paramName,
                type: paramType,
                description: paramDesc,
                required: paramRequired
              });
            }
          }
        } else {
          // Generate default name if not provided
          if (!name) {
            name = baseName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          }
        }

        // Generate ID from filename
        const id = baseName;

        // Create file content
        let content = `---
id: ${id}
name: ${name}
version: ${version}`;

        if (description) {
          content += `\ndescription: ${description}`;
        }

        if (author) {
          content += `\nauthor: ${author}`;
        }

        if (parameters.length > 0) {
          content += `\nparameters:`;
          for (const param of parameters) {
            content += `\n  - name: ${param.name}`;
            content += `\n    type: ${param.type}`;
            if (param.description) {
              content += `\n    description: ${param.description}`;
            }
            if (param.required) {
              content += `\n    required: true`;
            }
          }
        }

        content += `
---

# System
You are a helpful assistant.

# User
{prompt}
`;

        // Write file
        await fs.writeFile(filePath, content, 'utf-8');

        console.log(chalk.green(`✓ Created ${filePath}`));

      } catch (error) {
        console.error(chalk.red(`Failed to create file: ${error}`));
        process.exit(1);
      }
    });

  return createCommand;
}

function promptWithDefault(prompt: string, defaultValue: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    const question = defaultValue ? `${prompt} [${defaultValue}]: ` : `${prompt}: `;
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

function promptYesNo(prompt: string, defaultValue: boolean): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    const defaultStr = defaultValue ? 'Y' : 'N';
    rl.question(`${prompt} [y/N] (default: ${defaultStr}): `, (answer) => {
      rl.close();
      const input = answer.toLowerCase().trim();
      if (input === '') {
        resolve(defaultValue);
      } else {
        resolve(input === 'y' || input === 'yes');
      }
    });
  });
}
