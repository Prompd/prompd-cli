/**
 * Command Executor for CLI Package
 *
 * Executes whitelisted commands via Node.js child_process with security controls.
 * Used by workflow executor when running Command nodes in CLI environment.
 */

import { spawn } from 'child_process'
import { BUILTIN_COMMAND_EXECUTABLES, type CustomCommandConfig } from './workflowTypes.js'
import type { ToolCallRequest, ToolCallResult } from './workflowExecutor.js'

export interface CommandExecutionResult {
  success: boolean
  output?: string
  error?: string
  exitCode?: number
  skipped?: boolean
  reason?: string
  command?: string
}

export interface CommandExecutorOptions {
  /** Custom commands to add to whitelist (optional) */
  customCommands?: CustomCommandConfig[]

  /** Working directory for command execution */
  cwd?: string

  /** Timeout in milliseconds (default: 30000) */
  timeout?: number

  /** Environment variables to pass to command */
  env?: Record<string, string>
}

/**
 * Validates if a command is allowed to execute based on whitelist
 */
function validateCommand(
  command: string,
  customCommands: CustomCommandConfig[] = []
): { allowed: boolean; reason?: string } {
  // Parse command to get executable
  const parts = command.trim().split(/\s+/)
  if (parts.length === 0) {
    return { allowed: false, reason: 'Empty command' }
  }

  const executable = parts[0].toLowerCase()

  // Check against built-in whitelist
  const builtInCommands = BUILTIN_COMMAND_EXECUTABLES.map(cmd => cmd.executable.toLowerCase())
  const customCommandExes = customCommands.map(cmd => cmd.executable.toLowerCase())
  const allowedCommands = [...new Set([...builtInCommands, ...customCommandExes])]

  if (!allowedCommands.includes(executable)) {
    return {
      allowed: false,
      reason: `Command '${executable}' not allowed. Allowed built-in: ${builtInCommands.join(', ')}${customCommandExes.length > 0 ? `. Custom: ${customCommandExes.join(', ')}` : ''}`
    }
  }

  // Security: Prevent shell injection patterns
  const dangerousPatterns = [
    /[;&|`$()]/,  // Shell metacharacters
    /\.\.\//,     // Path traversal
    /~\//,        // Home directory expansion
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      return {
        allowed: false,
        reason: `Command contains potentially dangerous pattern: ${pattern.source}`
      }
    }
  }

  return { allowed: true }
}

/**
 * Executes a command using Node.js child_process with security controls
 */
export async function executeCommand(
  command: string,
  options: CommandExecutorOptions = {}
): Promise<CommandExecutionResult> {
  const {
    customCommands = [],
    cwd = process.cwd(),
    timeout = 30000,
    env = process.env as Record<string, string>
  } = options

  // Validate command against whitelist
  const validation = validateCommand(command, customCommands)
  if (!validation.allowed) {
    return {
      success: false,
      error: validation.reason,
      skipped: true,
      reason: validation.reason,
      command
    }
  }

  // Parse command into executable and args
  const parts = command.trim().split(/\s+/)
  const executable = parts[0]
  const args = parts.slice(1)

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let killed = false

    // Spawn process without shell (security)
    const childProcess = spawn(executable, args, {
      cwd,
      env,
      shell: false,  // CRITICAL: Prevent shell injection
      stdio: ['ignore', 'pipe', 'pipe']
    })

    // Set timeout
    const timeoutId = setTimeout(() => {
      killed = true
      childProcess.kill('SIGTERM')

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (!childProcess.killed) {
          childProcess.kill('SIGKILL')
        }
      }, 5000)
    }, timeout)

    // Collect stdout
    childProcess.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    // Collect stderr
    childProcess.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    // Handle process completion
    childProcess.on('close', (code) => {
      clearTimeout(timeoutId)

      if (killed) {
        resolve({
          success: false,
          error: `Command timed out after ${timeout}ms`,
          exitCode: -1,
          command
        })
        return
      }

      const success = code === 0
      const output = stdout.trim()
      const error = stderr.trim()

      resolve({
        success,
        output: output || undefined,
        error: error || undefined,
        exitCode: code ?? undefined,
        command
      })
    })

    // Handle spawn errors (e.g., executable not found)
    childProcess.on('error', (err) => {
      clearTimeout(timeoutId)
      resolve({
        success: false,
        error: `Failed to spawn process: ${err.message}`,
        command
      })
    })
  })
}

/**
 * Creates an onToolCall callback for workflow execution
 * This is what gets passed to executeWorkflow() in CLI commands
 */
export function createToolCallHandler(
  options: CommandExecutorOptions = {}
): (request: ToolCallRequest) => Promise<ToolCallResult> {
  return async (request: ToolCallRequest) => {
    // Handle different tool types
    switch (request.toolType) {
      case 'command': {
        // Extract command from commandConfig
        if (!request.commandConfig) {
          return {
            success: false,
            error: 'Missing command configuration'
          }
        }

        const { executable, args, cwd } = request.commandConfig
        const command = `${executable} ${args || ''}`.trim()

        if (!command || !executable) {
          return {
            success: false,
            error: 'Missing command executable'
          }
        }

        // Execute the command
        const executionResult = await executeCommand(command, {
          ...options,
          cwd: cwd || options.cwd
        })

        // Map CommandExecutionResult to ToolCallResult
        return {
          success: executionResult.success,
          result: executionResult.output || executionResult.error,
          error: executionResult.error
        }
      }

      case 'http':
      case 'mcp':
      case 'code':
      case 'function':
        // These tool types are handled by the workflow executor itself
        // Return an error to signal that the executor should handle it
        return {
          success: false,
          error: `Tool type '${request.toolType}' should be handled by workflow executor, not CLI handler`
        }

      default:
        return {
          success: false,
          error: `Unsupported tool type: ${request.toolType}`
        }
    }
  }
}
