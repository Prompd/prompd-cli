/**
 * Git utility functions for programmatic use
 * These functions can be imported and used directly by the IDE or other tools
 */

import { spawn } from 'child_process';
import {
  validateGitFilePath,
  validateGitMessage,
  validateVersionString,
  GitSecurityError
} from './security';

export { GitSecurityError };

export interface GitCommandResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface GitFileStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'staged';
  staged: boolean;
  indexStatus: string;
  workTreeStatus: string;
}

export interface GitCommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

/**
 * Execute a git command with security validation
 * @param args Git command arguments
 * @param cwd Working directory (optional)
 * @returns Promise with command result
 */
export async function execGitCommand(
  args: string[],
  cwd?: string
): Promise<GitCommandResult> {
  // Whitelist of allowed git commands for security
  const allowedCommands = [
    'status', 'branch', 'add', 'restore', 'commit', 'log', 'init',
    'diff', 'show', 'tag', 'reset', 'rm'
  ];

  const gitCommand = args[0];
  if (!allowedCommands.includes(gitCommand)) {
    return {
      success: false,
      output: '',
      error: `Git command '${gitCommand}' not allowed`
    };
  }

  return new Promise((resolve) => {
    const gitProcess = spawn('git', args, {
      cwd: cwd || process.cwd(),
      shell: false // Important: don't use shell to prevent injection
    });

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
        resolve({ success: true, output: stdout });
      } else {
        resolve({ success: false, output: stdout, error: stderr || `Exit code ${code}` });
      }
    });

    gitProcess.on('error', (err) => {
      resolve({ success: false, output: '', error: err.message });
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      gitProcess.kill();
      resolve({ success: false, output: '', error: 'Git command timed out' });
    }, 30000);
  });
}

/**
 * Get current branch name
 */
export async function getBranch(cwd?: string): Promise<string | null> {
  const result = await execGitCommand(['branch', '--show-current'], cwd);
  if (result.success) {
    return result.output.trim() || 'HEAD';
  }
  return null;
}

/**
 * Check if directory is a git repository
 */
export async function isGitRepo(cwd?: string): Promise<boolean> {
  const result = await execGitCommand(['branch', '--show-current'], cwd);
  return result.success;
}

/**
 * Get git status for prompd files (.prmd, .pdflow)
 * @param cwd Working directory
 * @param filterPrompdOnly Only return .prmd and .pdflow files (default: true)
 */
export async function getStatus(
  cwd?: string,
  filterPrompdOnly = true
): Promise<GitFileStatus[]> {
  const result = await execGitCommand(['status', '--porcelain'], cwd);
  if (!result.success) {
    return [];
  }

  const files: GitFileStatus[] = [];
  const lines = result.output.split('\n').filter(l => l.trim());

  for (const line of lines) {
    const filePath = line.substring(3).trim();

    // Filter for prompd files if requested
    if (filterPrompdOnly && !filePath.endsWith('.prmd') && !filePath.endsWith('.pdflow')) {
      continue;
    }

    const indexStatus = line[0];
    const workTreeStatus = line[1];

    // Determine status type
    const getStatusType = (char: string): GitFileStatus['status'] => {
      switch (char) {
        case 'M': return 'modified';
        case 'A': return 'added';
        case 'D': return 'deleted';
        case '?': return 'untracked';
        default: return 'modified';
      }
    };

    // If file is staged (index has changes)
    if (indexStatus !== ' ' && indexStatus !== '?') {
      files.push({
        path: filePath,
        status: getStatusType(indexStatus),
        staged: true,
        indexStatus,
        workTreeStatus
      });
    }

    // If file has working tree changes
    if (workTreeStatus !== ' ') {
      files.push({
        path: filePath,
        status: workTreeStatus === '?' ? 'untracked' : getStatusType(workTreeStatus),
        staged: false,
        indexStatus,
        workTreeStatus
      });
    }
  }

  return files;
}

/**
 * Stage a file
 */
export async function stageFile(
  filePath: string,
  cwd?: string
): Promise<GitCommandResult> {
  try {
    const safePath = validateGitFilePath(filePath);
    return await execGitCommand(['add', safePath], cwd);
  } catch (error) {
    if (error instanceof GitSecurityError) {
      return { success: false, output: '', error: error.message };
    }
    return { success: false, output: '', error: String(error) };
  }
}

/**
 * Unstage a file
 */
export async function unstageFile(
  filePath: string,
  cwd?: string
): Promise<GitCommandResult> {
  try {
    const safePath = validateGitFilePath(filePath);
    return await execGitCommand(['restore', '--staged', safePath], cwd);
  } catch (error) {
    if (error instanceof GitSecurityError) {
      return { success: false, output: '', error: error.message };
    }
    return { success: false, output: '', error: String(error) };
  }
}

/**
 * Discard changes to a file
 */
export async function discardChanges(
  filePath: string,
  cwd?: string
): Promise<GitCommandResult> {
  try {
    const safePath = validateGitFilePath(filePath);
    return await execGitCommand(['restore', safePath], cwd);
  } catch (error) {
    if (error instanceof GitSecurityError) {
      return { success: false, output: '', error: error.message };
    }
    return { success: false, output: '', error: String(error) };
  }
}

/**
 * Commit staged changes
 */
export async function commit(
  message: string,
  cwd?: string
): Promise<GitCommandResult> {
  try {
    const safeMessage = validateGitMessage(message);
    return await execGitCommand(['commit', '-m', safeMessage], cwd);
  } catch (error) {
    if (error instanceof GitSecurityError) {
      return { success: false, output: '', error: error.message };
    }
    return { success: false, output: '', error: String(error) };
  }
}

/**
 * Get recent commits
 */
export async function getRecentCommits(
  cwd?: string,
  limit = 10
): Promise<GitCommitInfo[]> {
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const result = await execGitCommand([
    'log',
    '--oneline',
    `-n`, String(safeLimit),
    '--format=%h|%s|%an|%ar'
  ], cwd);

  if (!result.success || !result.output.trim()) {
    return [];
  }

  return result.output.trim().split('\n').map(line => {
    const [hash, message, author, date] = line.split('|');
    return { hash, message, author, date };
  });
}

/**
 * Initialize a git repository
 */
export async function initRepo(cwd?: string): Promise<GitCommandResult> {
  return await execGitCommand(['init'], cwd);
}

/**
 * Get file history
 */
export async function getFileHistory(
  filePath: string,
  cwd?: string,
  limit = 10
): Promise<GitCommitInfo[]> {
  try {
    const safePath = validateGitFilePath(filePath);
    const safeLimit = Math.min(Math.max(1, limit), 100);

    const result = await execGitCommand([
      'log',
      `--max-count=${safeLimit}`,
      '--format=%h|%s|%an|%ar',
      '--',
      safePath
    ], cwd);

    if (!result.success || !result.output.trim()) {
      return [];
    }

    return result.output.trim().split('\n').map(line => {
      const [hash, message, author, date] = line.split('|');
      return { hash, message, author, date };
    });
  } catch (error) {
    return [];
  }
}