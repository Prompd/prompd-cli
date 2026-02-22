/**
 * Security utilities for Prompd CLI
 * Implements least privilege and security boundaries
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import { validateRegistryUrl, SecurityError as ValidationSecurityError } from './validation';

export class SecurityManager {
  static initialize(): void {
    // Initialize security settings if needed
    console.log('Security Manager initialized');
  }

  private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  private static readonly MAX_WORKFLOW_NODES = 1000;
  private static readonly ALLOWED_TEMP_DIR = process.cwd();
  private static readonly BLOCKED_PATHS = ['..', '~', '/etc', '/usr', '/var', 'C:\\Windows', 'C:\\Program Files'];

  /**
   * Validates and sanitizes file paths to prevent directory traversal
   */
  static validateFilePath(filePath: string, allowedExtensions: string[] = []): string {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Invalid file path');
    }

    // Check for directory traversal attempts BEFORE resolving
    if (filePath.includes('..')) {
      throw new Error('Directory traversal detected in file path');
    }

    // Normalize and resolve path
    const normalized = path.normalize(path.resolve(filePath));

    // Check for blocked paths
    for (const blockedPath of this.BLOCKED_PATHS) {
      if (normalized.toLowerCase().includes(blockedPath.toLowerCase())) {
        throw new Error(`Access denied: Path contains blocked directory: ${blockedPath}`);
      }
    }

    // Validate extension if specified
    if (allowedExtensions.length > 0) {
      const ext = path.extname(normalized).toLowerCase();
      if (!allowedExtensions.includes(ext)) {
        throw new Error(`Invalid file extension. Allowed: ${allowedExtensions.join(', ')}`);
      }
    }

    return normalized;
  }

  /**
   * Sanitizes tool/workflow names to prevent injection
   */
  static sanitizeToolName(name: string): string {
    if (!name || typeof name !== 'string') {
      throw new Error('Tool name is required');
    }

    // Only allow alphanumeric, hyphens, underscores
    const sanitized = name.replace(/[^a-zA-Z0-9\-_]/g, '');
    
    if (sanitized.length === 0) {
      throw new Error('Tool name must contain valid characters (a-z, A-Z, 0-9, -, _)');
    }

    if (sanitized.length > 64) {
      throw new Error('Tool name too long (max 64 characters)');
    }

    return sanitized;
  }

  /**
   * Creates a secure temporary file path
   */
  static createSecureTempPath(prefix: string = 'prompd', extension: string = '.tmp'): string {
    const sanitizedPrefix = this.sanitizeToolName(prefix);
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2);
    const filename = `${sanitizedPrefix}-${timestamp}-${random}${extension}`;
    
    return path.join(this.ALLOWED_TEMP_DIR, 'temp', filename);
  }

  /**
   * Validates file size before processing
   */
  static async validateFileSize(filePath: string): Promise<void> {
    try {
      const stats = await fs.stat(filePath);
      if (stats.size > this.MAX_FILE_SIZE) {
        throw new Error(`File too large: ${Math.round(stats.size / 1024 / 1024)}MB (max: ${this.MAX_FILE_SIZE / 1024 / 1024}MB)`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('File too large')) {
        throw error;
      }
      throw new Error(`Cannot access file: ${filePath}`);
    }
  }

  /**
   * Validates workflow complexity to prevent DoS
   */
  static validateWorkflowComplexity(workflow: any): void {
    if (!workflow || typeof workflow !== 'object') {
      throw new Error('Invalid workflow format');
    }

    // Check node count
    if (workflow.nodes && workflow.nodes.length > this.MAX_WORKFLOW_NODES) {
      throw new Error(`Workflow too complex: ${workflow.nodes.length} nodes (max: ${this.MAX_WORKFLOW_NODES})`);
    }

    // Check for potentially dangerous node types
    if (workflow.nodes) {
      for (const node of workflow.nodes) {
        if (node.type === 'transformer' && node.data?.config?.transformationType === 'javascript') {
          throw new Error('JavaScript transformation nodes are disabled for security');
        }
        
        // Block external API calls without explicit permission
        if (node.type === 'api' && !this.isAllowedApiEndpoint(node.data?.config?.endpoint)) {
          throw new Error(`API endpoint not allowed: ${node.data?.config?.endpoint}`);
        }
      }
    }
  }

  /**
   * Validates API endpoints (whitelist approach)
   */
  private static isAllowedApiEndpoint(endpoint: string): boolean {
    if (!endpoint) return false;
    
    // Only allow HTTPS endpoints
    if (!endpoint.startsWith('https://')) {
      return false;
    }

    // Simple whitelist - in production this would be configurable
    const allowedDomains = [
      'api.openai.com',
      'api.anthropic.com',
      'localhost' // For development
    ];

    try {
      const url = new URL(endpoint);
      return allowedDomains.some(domain => 
        url.hostname === domain || url.hostname.endsWith(`.${domain}`)
      );
    } catch {
      return false;
    }
  }

  /**
   * Sanitizes user input parameters
   */
  static sanitizeParameters(params: Record<string, any>, maxDepth: number = 3): Record<string, any> {
    if (!params || typeof params !== 'object') {
      return {};
    }

    const sanitized: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(params)) {
      // Validate key
      const cleanKey = this.sanitizeParameterKey(key);
      
      // Sanitize value based on type
      if (typeof value === 'string') {
        sanitized[cleanKey] = this.sanitizeStringValue(value);
      } else if (typeof value === 'number') {
        sanitized[cleanKey] = this.sanitizeNumberValue(value);
      } else if (typeof value === 'boolean') {
        sanitized[cleanKey] = Boolean(value);
      } else if (Array.isArray(value)) {
        sanitized[cleanKey] = this.sanitizeArrayValue(value, maxDepth - 1);
      } else if (typeof value === 'object' && value !== null && maxDepth > 0) {
        sanitized[cleanKey] = this.sanitizeParameters(value, maxDepth - 1);
      }
      // Drop functions, undefined, symbols, etc.
    }

    return sanitized;
  }

  private static sanitizeParameterKey(key: string): string {
    if (typeof key !== 'string') {
      throw new Error('Parameter key must be string');
    }
    
    // Remove potentially dangerous characters
    const sanitized = key.replace(/[^a-zA-Z0-9_]/g, '_');
    
    if (sanitized.length === 0 || sanitized.length > 128) {
      throw new Error('Invalid parameter key length');
    }
    
    return sanitized;
  }

  private static sanitizeStringValue(value: string): string {
    if (typeof value !== 'string') {
      return '';
    }
    
    // Limit string length to prevent memory exhaustion
    if (value.length > 10000) {
      throw new Error('Parameter value too long (max 10000 characters)');
    }
    
    // Remove null bytes and control characters (except common whitespace)
    return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  private static sanitizeNumberValue(value: number): number {
    if (typeof value !== 'number' || !isFinite(value)) {
      throw new Error('Invalid number value');
    }
    
    // Prevent extreme values
    if (Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw new Error('Number value out of safe range');
    }
    
    return value;
  }

  private static sanitizeArrayValue(value: any[], maxDepth: number): any[] {
    if (!Array.isArray(value)) {
      return [];
    }
    
    // Limit array size
    if (value.length > 1000) {
      throw new Error('Array too large (max 1000 items)');
    }
    
    if (maxDepth <= 0) {
      return []; // Prevent deep nesting
    }
    
    return value.slice(0, 100).map(item => {
      if (typeof item === 'string') {
        return this.sanitizeStringValue(item);
      } else if (typeof item === 'number') {
        return this.sanitizeNumberValue(item);
      } else if (typeof item === 'boolean') {
        return Boolean(item);
      } else if (typeof item === 'object' && item !== null) {
        return this.sanitizeParameters(item, maxDepth - 1);
      }
      return item;
    });
  }

  /**
   * Creates a secure execution environment
   */
  static async createSecureExecutionContext(): Promise<{
    tempDir: string;
    cleanup: () => Promise<void>;
  }> {
    const tempDir = path.join(this.ALLOWED_TEMP_DIR, 'temp', `execution-${Date.now()}-${Math.random().toString(36)}`);

    await fs.ensureDir(tempDir);

    // Set restrictive permissions if on Unix-like system
    try {
      await fs.chmod(tempDir, 0o700); // Owner read/write/execute only
    } catch {
      // Windows doesn't support chmod, ignore
    }

    const cleanup = async () => {
      try {
        await fs.remove(tempDir);
      } catch (error) {
        console.warn(`Failed to cleanup temp directory: ${tempDir}`, error);
      }
    };

    return { tempDir, cleanup };
  }

  /**
   * Validates registry URL for security
   * Only HTTPS allowed except for localhost
   */
  static validateRegistryUrl(url: string): boolean {
    return validateRegistryUrl(url);
  }

  /**
   * Scans content for potential secrets
   * Returns true if secrets detected
   */
  static async scanForSecrets(content: string): Promise<{
    hasSecrets: boolean;
    secrets: Array<{ type: string; line: number }>;
  }> {
    const { detectSecrets } = await import('./validation');
    const detected = detectSecrets(content);

    return {
      hasSecrets: detected.length > 0,
      secrets: detected.map(s => ({ type: s.type, line: s.line }))
    };
  }

  /**
   * Scans a file for potential secrets before packaging/publishing
   */
  static async scanFileForSecrets(filePath: string): Promise<{
    hasSecrets: boolean;
    secrets: Array<{ type: string; line: number }>;
  }> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return this.scanForSecrets(content);
    } catch (error) {
      // If we can't read the file, assume no secrets (might be binary)
      return { hasSecrets: false, secrets: [] };
    }
  }

  /**
   * Sanitizes environment variables (clear sensitive data after reading)
   */
  static sanitizeEnvironment(): void {
    // Clear any temporary sensitive environment variables
    const sensitiveVars = [
      'TEMP_API_KEY',
      'TEMP_TOKEN',
      'TEMP_PASSWORD'
    ];

    sensitiveVars.forEach(varName => {
      if (process.env[varName]) {
        delete process.env[varName];
      }
    });
  }
}

/**
 * Git-specific security validation functions
 * Ported from Python CLI security.py
 */
export class GitSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitSecurityError';
  }
}

/**
 * Validates file paths specifically for Git operations.
 * Prevents command injection and path traversal attacks.
 */
export function validateGitFilePath(filePath: string): string {
  if (!filePath || typeof filePath !== 'string') {
    throw new GitSecurityError('File path is required');
  }

  // Normalize the path
  const normalized = path.normalize(filePath);

  // Check for path traversal attempts
  const dangerousPatterns = ['..', '~', '$'];
  for (const pattern of dangerousPatterns) {
    if (normalized.includes(pattern)) {
      throw new GitSecurityError(`Potentially dangerous path component '${pattern}' found in: ${normalized}`);
    }
  }

  // Prevent command injection through filenames
  const dangerousChars = [';', '&', '|', '`', '$', '(', ')', '<', '>', '"', "'"];
  for (const char of dangerousChars) {
    if (normalized.includes(char)) {
      throw new GitSecurityError(`Potentially dangerous character '${char}' in filename: ${normalized}`);
    }
  }

  // Check for absolute paths outside current directory
  if (path.isAbsolute(normalized)) {
    const cwd = process.cwd();
    const resolved = path.resolve(normalized);
    if (!resolved.startsWith(cwd)) {
      throw new GitSecurityError(`Absolute path outside current directory not allowed: ${resolved}`);
    }
  }

  return normalized;
}

/**
 * Validates Git commit messages for safety.
 * Prevents command injection in commit messages.
 */
export function validateGitMessage(message: string): string {
  if (!message || !message.trim()) {
    throw new GitSecurityError('Commit message cannot be empty');
  }

  // Check message length (Git has practical limits)
  if (message.length > 2000) {
    throw new GitSecurityError('Commit message too long (max 2000 characters)');
  }

  // Check for command injection attempts in commit message
  const dangerousPatterns = ['$(', '`', '${', '#!/', '&>', '|>', '<(', '>('];
  for (const pattern of dangerousPatterns) {
    if (message.includes(pattern)) {
      throw new GitSecurityError(`Potentially dangerous pattern '${pattern}' in commit message`);
    }
  }

  return message.trim();
}

/**
 * Validates semantic version strings.
 */
export function validateVersionString(version: string): string {
  if (!version || typeof version !== 'string') {
    throw new GitSecurityError('Version string is required');
  }

  // Semantic version pattern (major.minor.patch with optional pre-release/build)
  const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

  if (!versionPattern.test(version)) {
    throw new GitSecurityError(`Invalid semantic version format: ${version}`);
  }

  // Check for reasonable version numbers
  const parts = version.split('.', 3);
  for (let i = 0; i < 3; i++) {
    const num = parseInt(parts[i], 10);
    if (num < 0 || num > 999) {
      throw new GitSecurityError(`Version component out of range (0-999): ${num}`);
    }
  }

  return version;
}

/**
 * Security middleware for MCP requests
 */
export class MCPSecurityMiddleware {
  private static readonly MAX_REQUEST_SIZE = 100 * 1024; // 100KB
  private static readonly RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
  private static readonly RATE_LIMIT_MAX_REQUESTS = 100;
  
  private requestCounts = new Map<string, { count: number; resetTime: number }>();

  /**
   * Validates incoming MCP request
   */
  validateRequest(request: any, clientId: string = 'default'): void {
    // Size validation
    const requestSize = JSON.stringify(request).length;
    if (requestSize > MCPSecurityMiddleware.MAX_REQUEST_SIZE) {
      throw new Error(`Request too large: ${requestSize} bytes (max: ${MCPSecurityMiddleware.MAX_REQUEST_SIZE})`);
    }

    // Rate limiting
    this.enforceRateLimit(clientId);

    // Parameter validation
    if (request.params?.arguments) {
      request.params.arguments = SecurityManager.sanitizeParameters(request.params.arguments);
    }
  }

  private enforceRateLimit(clientId: string): void {
    const now = Date.now();
    const clientData = this.requestCounts.get(clientId);

    if (!clientData || now > clientData.resetTime) {
      // Reset or initialize
      this.requestCounts.set(clientId, {
        count: 1,
        resetTime: now + MCPSecurityMiddleware.RATE_LIMIT_WINDOW
      });
      return;
    }

    if (clientData.count >= MCPSecurityMiddleware.RATE_LIMIT_MAX_REQUESTS) {
      throw new Error(`Rate limit exceeded. Try again in ${Math.ceil((clientData.resetTime - now) / 1000)} seconds`);
    }

    clientData.count++;
  }

  /**
   * Cleans up old rate limit data
   */
  cleanup(): void {
    const now = Date.now();
    for (const [clientId, data] of this.requestCounts.entries()) {
      if (now > data.resetTime) {
        this.requestCounts.delete(clientId);
      }
    }
  }
}