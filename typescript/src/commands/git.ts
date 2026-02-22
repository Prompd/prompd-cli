import { Command } from 'commander';
import { spawn } from 'child_process';
import { resolve } from 'path';
import {
  validateGitFilePath,
  validateGitMessage,
  validateVersionString,
  GitSecurityError
} from '../lib/security';

export function createGitCommand(): Command {
  const cmd = new Command('git');

  cmd.description('Git operations for .prmd files');

  // Add subcommand
  cmd
    .command('add <files...>')
    .description('Add .prmd files to git staging area')
    .action(async (files: string[]) => {
      for (const file of files) {
        if (!file.endsWith('.prmd') && !file.endsWith('.pdflow')) {
          console.warn(`Warning: Skipping non-prompd file: ${file}`);
          continue;
        }

        try {
          const safePath = validateGitFilePath(file);
          await execGitCommand(['add', safePath]);
          console.log(`Added ${safePath}`);
        } catch (error) {
          if (error instanceof GitSecurityError) {
            console.error(`Security error: ${error.message}`);
          } else {
            console.error(`Error adding ${file}: ${error}`);
          }
        }
      }
    });

  // Commit subcommand
  cmd
    .command('commit')
    .description('Commit staged .prmd files')
    .requiredOption('-m, --message <message>', 'Commit message')
    .option('--auto-add', 'Automatically add modified .prmd files before committing')
    .action(async (options: { message: string; autoAdd?: boolean }) => {
      try {
        // Auto-add .prmd files if requested
        if (options.autoAdd) {
          const statusOutput = await execGitCommand(['status', '--porcelain']);
          const lines = statusOutput.split('\n').filter(line => line.trim());

          for (const line of lines) {
            // Check for modified but not staged files (space + M in first two chars)
            if (line.length >= 3 && line[0] === ' ' && line[1] === 'M') {
              const filePath = line.substring(3).trim();
              if (filePath.endsWith('.prmd') || filePath.endsWith('.pdflow')) {
                try {
                  const safePath = validateGitFilePath(filePath);
                  await execGitCommand(['add', safePath]);
                  console.log(`Auto-staging: ${safePath}`);
                } catch (secError) {
                  if (secError instanceof GitSecurityError) {
                    console.warn(`Security warning: Skipping unsafe file path: ${secError.message}`);
                  }
                }
              }
            }
          }
        }

        // Validate and commit
        const safeMessage = validateGitMessage(options.message);
        await execGitCommand(['commit', '-m', safeMessage]);
        console.log(`Committed with message: ${safeMessage}`);
      } catch (error) {
        if (error instanceof GitSecurityError) {
          console.error(`Security error: ${error.message}`);
        } else if (error instanceof Error && error.message.includes('nothing to commit')) {
          console.log('Nothing to commit');
        } else {
          console.error(`Error committing: ${error}`);
        }
      }
    });

  // Status subcommand
  cmd
    .command('status')
    .description('Show git status for .prmd files')
    .action(async () => {
      try {
        const output = await execGitCommand(['status', '--porcelain']);
        console.log('Git status for prompd files:');

        const lines = output.split('\n').filter(line =>
          (line.includes('.prmd') || line.includes('.pdflow')) && line.trim()
        );
        let found = false;

        for (const line of lines) {
          found = true;
          const status = line.substring(0, 2);
          const file = line.substring(3).trim();

          let statusText = 'Modified';
          if (status.includes('A')) statusText = 'Added';
          else if (status.includes('D')) statusText = 'Deleted';
          else if (status === '??') statusText = 'Untracked';
          else if (status[0] === 'M') statusText = 'Staged';
          else if (status[1] === 'M') statusText = 'Modified';

          console.log(`  ${statusText}: ${file}`);
        }

        if (!found) {
          console.log('  No prompd file changes');
        }
      } catch (error) {
        console.error(`Error checking git status: ${error}`);
      }
    });

  // Checkout subcommand
  cmd
    .command('checkout <file> <version>')
    .description('Checkout a specific version of a .prmd file')
    .action(async (file: string, version: string) => {
      if (!file.endsWith('.prmd') && !file.endsWith('.pdflow')) {
        console.error(`Error: ${file} is not a prompd file`);
        process.exit(1);
      }

      try {
        // Validate inputs
        const safeFile = validateGitFilePath(file);
        let safeVersion = version;

        // Validate version if it looks like semver
        if (version.match(/^\d+\.\d+\.\d+/)) {
          safeVersion = validateVersionString(version);
        }

        // Try semantic version tag first
        let versionRef = safeVersion;
        if (isValidSemver(safeVersion)) {
          const baseName = safeFile.split('/').pop()?.replace('.prmd', '').replace('.pdflow', '') || 'file';
          const tagName = `${baseName}-v${safeVersion}`;

          // Check if tag exists
          try {
            const tags = await execGitCommand(['tag', '-l', tagName]);
            if (tags.trim()) {
              versionRef = tagName;
            }
          } catch {
            // Tag doesn't exist, use version as-is
          }
        }

        // Get file content at version
        const content = await execGitCommand(['show', `${versionRef}:${safeFile}`]);

        // Write to file
        const fs = await import('fs');
        fs.writeFileSync(resolve(safeFile), content, 'utf8');

        console.log(`Checked out ${safeFile} @ ${version}`);
      } catch (error) {
        if (error instanceof GitSecurityError) {
          console.error(`Security error: ${error.message}`);
        } else {
          console.error(`Error: Version '${version}' not found for ${file}`);
        }
      }
    });

  // Remove subcommand
  cmd
    .command('remove <files...>')
    .description('Remove .prmd files from git tracking')
    .option('--cached', 'Remove from index but keep in working directory')
    .action(async (files: string[], options: { cached?: boolean }) => {
      for (const file of files) {
        if (!file.endsWith('.prmd') && !file.endsWith('.pdflow')) {
          console.warn(`Warning: Skipping non-prompd file: ${file}`);
          continue;
        }

        try {
          const safePath = validateGitFilePath(file);
          const args = options.cached ? ['rm', '--cached', safePath] : ['rm', safePath];
          await execGitCommand(args);

          if (options.cached) {
            console.log(`Removed ${safePath} from git index (kept in working directory)`);
          } else {
            console.log(`Removed ${safePath} from git tracking`);
          }
        } catch (error) {
          if (error instanceof GitSecurityError) {
            console.error(`Security error: ${error.message}`);
          } else {
            console.error(`Error removing ${file}: ${error}`);
          }
        }
      }
    });

  // Log subcommand - show version history for a file
  cmd
    .command('log <file>')
    .description('Show version history for a .prmd file')
    .option('-n, --limit <count>', 'Limit number of commits', '10')
    .action(async (file: string, options: { limit: string }) => {
      if (!file.endsWith('.prmd') && !file.endsWith('.pdflow')) {
        console.error(`Error: ${file} is not a prompd file`);
        process.exit(1);
      }

      try {
        const safePath = validateGitFilePath(file);
        const limit = Math.min(parseInt(options.limit, 10) || 10, 100);

        const output = await execGitCommand([
          'log',
          `--max-count=${limit}`,
          '--format=%h | %ad | %an | %s',
          '--date=short',
          '--',
          safePath
        ]);

        if (!output.trim()) {
          console.log(`No commits found for ${safePath}`);
          return;
        }

        console.log(`Version history for ${safePath}:`);
        console.log('----------------------------------------');
        const lines = output.trim().split('\n');
        for (const line of lines) {
          console.log(`  ${line}`);
        }
      } catch (error) {
        if (error instanceof GitSecurityError) {
          console.error(`Security error: ${error.message}`);
        } else {
          console.error(`Error getting log: ${error}`);
        }
      }
    });

  return cmd;
}

// Helper function to execute git commands securely
function execGitCommand(args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const gitProcess = spawn('git', args, { stdio: 'pipe' });
    let stdout = '';
    let stderr = '';

    gitProcess.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    gitProcess.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    gitProcess.on('close', (code) => {
      if (code === 0) {
        resolvePromise(stdout);
      } else {
        reject(new Error(stderr || `Git command failed with code ${code}`));
      }
    });

    gitProcess.on('error', (err) => {
      reject(new Error(`Failed to spawn git: ${err.message}`));
    });
  });
}

// Helper function to validate semantic version
function isValidSemver(version: string): boolean {
  const semverRegex = /^\d+\.\d+\.\d+$/;
  return semverRegex.test(version);
}