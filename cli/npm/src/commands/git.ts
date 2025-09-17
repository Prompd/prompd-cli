import { Command } from 'commander';
import { spawn } from 'child_process';
import { resolve } from 'path';

export function createGitCommand(): Command {
  const cmd = new Command('git');
  
  cmd.description('Git operations for .prmd files');
  
  // Add subcommand
  cmd
    .command('add <files...>')
    .description('Add .prmd files to git staging area')
    .action(async (files: string[]) => {
      for (const file of files) {
        if (!file.endsWith('.prmd')) {
          console.warn(`Warning: Skipping non-.prmd file: ${file}`);
          continue;
        }
        
        try {
          await execGitCommand(['add', file]);
          console.log(`✓ Added ${file}`);
        } catch (error) {
          console.error(`Error adding ${file}: ${error}`);
        }
      }
    });
  
  // Commit subcommand
  cmd
    .command('commit')
    .description('Commit staged .prmd files')
    .requiredOption('-m, --message <message>', 'Commit message')
    .action(async (options: any) => {
      try {
        await execGitCommand(['commit', '-m', options.message]);
        console.log(`✓ Committed with message: ${options.message}`);
      } catch (error) {
        console.error(`Error committing: ${error}`);
      }
    });
  
  // Status subcommand
  cmd
    .command('status')
    .description('Show git status for .prmd files')
    .action(async () => {
      try {
        const output = await execGitCommand(['status', '--porcelain']);
        console.log('Git status for .prmd files:');
        
        const lines = output.split('\\n').filter(line => line.includes('.prmd') && line.trim());
        let found = false;
        
        for (const line of lines) {
          found = true;
          const status = line.substring(0, 2);
          const file = line.substring(2).trim();
          
          let statusText = 'Modified';
          if (status.includes('A')) statusText = 'Added';
          else if (status.includes('D')) statusText = 'Deleted';
          else if (status.includes('??')) statusText = 'Untracked';
          
          console.log(`  ${statusText}: ${file}`);
        }
        
        if (!found) {
          console.log('  No .prmd file changes');
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
      if (!file.endsWith('.prmd')) {
        console.error(`Error: ${file} is not a .prmd file`);
        process.exit(1);
      }
      
      try {
        // Try semantic version tag first
        let versionRef = version;
        if (isValidSemver(version)) {
          const baseName = file.split('/').pop()?.replace('.prmd', '') || 'file';
          const tagName = `${baseName}-v${version}`;
          
          // Check if tag exists
          try {
            await execGitCommand(['tag', '-l', tagName]);
            versionRef = tagName;
          } catch {
            // Tag doesn't exist, use version as-is
          }
        }
        
        // Get file content at version
        const content = await execGitCommand(['show', `${versionRef}:${file}`]);
        
        // Write to file
        const fs = await import('fs');
        fs.writeFileSync(resolve(file), content, 'utf8');
        
        console.log(`✓ Checked out ${file} @ ${version}`);
      } catch (error) {
        console.error(`Error: Version '${version}' not found for ${file}`);
      }
    });
  
  // Remove subcommand
  cmd
    .command('remove <files...>')
    .description('Remove .prmd files from git tracking')
    .option('--cached', 'Remove from index but keep in working directory')
    .action(async (files: string[], options: any) => {
      for (const file of files) {
        if (!file.endsWith('.prmd')) {
          console.warn(`Warning: Skipping non-.prmd file: ${file}`);
          continue;
        }
        
        try {
          const args = options.cached ? ['rm', '--cached', file] : ['rm', file];
          await execGitCommand(args);
          
          if (options.cached) {
            console.log(`✓ Removed ${file} from git index (kept in working directory)`);
          } else {
            console.log(`✓ Removed ${file} from git tracking`);
          }
        } catch (error) {
          console.error(`Error removing ${file}: ${error}`);
        }
      }
    });
  
  return cmd;
}

// Helper function to execute git commands
function execGitCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn('git', args, { stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    
    process.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `Git command failed with code ${code}`));
      }
    });
  });
}

// Helper function to validate semantic version
function isValidSemver(version: string): boolean {
  const semverRegex = /^\\d+\\.\\d+\\.\\d+$/;
  return semverRegex.test(version);
}