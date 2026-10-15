import { Command } from 'commander';
import chalk from 'chalk';
import { getStatus } from '../lib/ai/daemon';

export function createAICommand(): Command {
  const command = new Command('ai');
  command.description('Manage the on-device Prompd AI runtime');

  command.addCommand(createInstallSubcommand());
  command.addCommand(createUninstallSubcommand());
  command.addCommand(createStartSubcommand());
  command.addCommand(createStopSubcommand());
  command.addCommand(createStatusSubcommand());

  return command;
}

function createInstallSubcommand(): Command {
  const cmd = new Command('install');
  cmd
    .description('Download and install a model into the local catalog')
    .option('-m, --model <name>', 'Model to install (e.g., gemma-4-e4b-q4, prompd-prmd@0.0.1)')
    .option('-y, --yes', 'Assume yes to all prompts (headless mode)')
    .action(async (opts: { model?: string; yes?: boolean }) => {
      console.log(chalk.yellow('Phase 1 scaffolding — install not yet implemented.'));
      console.log(`  model:    ${opts.model ?? chalk.gray('(not specified)')}`);
      console.log(`  headless: ${opts.yes ? 'yes' : 'no'}`);
    });
  return cmd;
}

function createUninstallSubcommand(): Command {
  const cmd = new Command('uninstall');
  cmd
    .description('Remove a model from the catalog, or wipe the entire runtime if no --model is given')
    .option('-m, --model <name>', 'Specific model to remove (omit to wipe everything)')
    .option('-y, --yes', 'Assume yes to all prompts (headless mode)')
    .action(async (opts: { model?: string; yes?: boolean }) => {
      console.log(chalk.yellow('Phase 1 scaffolding — uninstall not yet implemented.'));
      console.log(`  model:    ${opts.model ?? chalk.gray('(wipe everything)')}`);
      console.log(`  headless: ${opts.yes ? 'yes' : 'no'}`);
    });
  return cmd;
}

function createStartSubcommand(): Command {
  const cmd = new Command('start');
  cmd
    .description('Start the local AI daemon')
    .option('-m, --model <name>', 'Model to serve (defaults to the first-installed or user-configured default)')
    .action(async (opts: { model?: string }) => {
      console.log(chalk.yellow('Phase 1 scaffolding — start not yet implemented.'));
      console.log(`  model: ${opts.model ?? chalk.gray('(default)')}`);
    });
  return cmd;
}

function createStopSubcommand(): Command {
  const cmd = new Command('stop');
  cmd
    .description('Stop the running local AI daemon')
    .action(async () => {
      console.log(chalk.yellow('Phase 1 scaffolding — stop not yet implemented.'));
    });
  return cmd;
}

function createStatusSubcommand(): Command {
  const cmd = new Command('status');
  cmd
    .description('Show daemon state and installed-models catalog')
    .action(async () => {
      const status = await getStatus();

      if (status.running) {
        console.log(chalk.green('Running'));
        console.log(`  model:   ${status.model}`);
        console.log(`  port:    ${status.port}`);
        console.log(`  pid:     ${status.pid}`);
        console.log(`  started: ${status.startedAt}`);
        console.log(`  binary:  ${status.binaryPath}`);
      } else {
        console.log(chalk.gray('Not running'));
      }

      console.log();
      console.log(chalk.bold(`Installed models (${status.installedModels.length}):`));
      if (status.installedModels.length === 0) {
        console.log(chalk.gray('  (none)'));
      } else {
        for (const m of status.installedModels) {
          const tag = m.isDefault ? chalk.cyan(' [default]') : '';
          console.log(`  ${m.name}${tag}`);
        }
      }
    });
  return cmd;
}
