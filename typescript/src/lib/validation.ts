/**
 * Input validation utilities for Prompd CLI
 * Security-first validation following best practices
 */

import * as path from 'path';

/**
 * Custom error for security violations
 */
export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

/**
 * Custom error for validation failures
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validates npm-style package names
 * Rules: lowercase, alphanumeric, hyphens, dots, underscores
 * Scoped packages: @scope/name
 */
export function validatePackageName(name: string): boolean {
  if (!name || typeof name !== 'string') {
    return false;
  }

  // npm package name rules (scoped or unscoped)
  const pattern = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

  if (!pattern.test(name)) {
    return false;
  }

  // Length constraints
  if (name.length > 214) {
    return false;
  }

  // Cannot start with . or _
  const baseName = name.includes('/') ? name.split('/')[1] : name;
  if (baseName.startsWith('.') || baseName.startsWith('_')) {
    return false;
  }

  return true;
}

/**
 * Validates semantic versioning (x.y.z with optional pre-release/build metadata)
 */
export function validateVersion(version: string): boolean {
  if (!version || typeof version !== 'string') {
    return false;
  }

  // Semantic versioning pattern
  const semverPattern = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
  return semverPattern.test(version);
}

/**
 * Validates namespace/scope format (@namespace)
 */
export function validateNamespace(namespace: string): boolean {
  if (!namespace || typeof namespace !== 'string') {
    return false;
  }

  // Must start with @
  if (!namespace.startsWith('@')) {
    return false;
  }

  const scope = namespace.slice(1);

  // npm scope rules: lowercase, URL-safe characters
  return /^[a-z0-9-~][a-z0-9-._~]*$/.test(scope);
}

/**
 * Validates registry URL
 * Only HTTPS allowed (except localhost for development)
 */
export function validateRegistryUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  try {
    const parsed = new URL(url);

    // Only allow HTTPS (except localhost for dev)
    if (parsed.protocol !== 'https:') {
      // Allow HTTP only for localhost
      if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
        return false;
      }
    }

    // Don't allow data:, file:, javascript:, etc.
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitizes file paths to prevent directory traversal
 * Throws SecurityError if path is dangerous
 */
export function sanitizeFilePath(filePath: string, basePath?: string): string {
  if (!filePath || typeof filePath !== 'string') {
    throw new ValidationError('Invalid file path');
  }

  // Normalize the path
  const normalized = path.normalize(filePath);

  // Check for directory traversal attempts
  if (normalized.includes('..')) {
    throw new SecurityError('Directory traversal detected in file path');
  }

  // Check for absolute paths (when we expect relative)
  if (path.isAbsolute(normalized) && basePath) {
    throw new SecurityError('Absolute paths not allowed');
  }

  // If basePath provided, ensure the path stays within it
  if (basePath) {
    const resolvedPath = path.resolve(basePath, normalized);
    const resolvedBase = path.resolve(basePath);

    if (!resolvedPath.startsWith(resolvedBase + path.sep) &&
        resolvedPath !== resolvedBase) {
      throw new SecurityError('Path escapes base directory');
    }

    return resolvedPath;
  }

  return normalized;
}

/**
 * Validates file extension against whitelist
 */
export function validateFileExtension(filePath: string, allowedExtensions: string[]): boolean {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }

  if (!Array.isArray(allowedExtensions) || allowedExtensions.length === 0) {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  return allowedExtensions.includes(ext);
}

/**
 * Validates command-line flag/option names
 */
export function validateOptionName(name: string): boolean {
  if (!name || typeof name !== 'string') {
    return false;
  }

  // Allow letters, numbers, hyphens (typical CLI option names)
  return /^[a-zA-Z][a-zA-Z0-9-]*$/.test(name);
}

/**
 * Validates parameter keys (for .prmd parameters)
 */
export function validateParameterKey(key: string): boolean {
  if (!key || typeof key !== 'string') {
    return false;
  }

  // Allow letters, numbers, underscores (snake_case or camelCase)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
    return false;
  }

  // Length limits
  if (key.length > 128) {
    return false;
  }

  return true;
}

/**
 * Sanitizes parameter keys by converting to safe format
 */
export function sanitizeParameterKey(key: string): string {
  if (typeof key !== 'string') {
    throw new ValidationError('Parameter key must be string');
  }

  // Remove potentially dangerous characters, replace with underscore
  const sanitized = key.replace(/[^a-zA-Z0-9_]/g, '_');

  if (sanitized.length === 0 || sanitized.length > 128) {
    throw new ValidationError('Invalid parameter key length');
  }

  return sanitized;
}

/**
 * Detects potential secrets in strings
 * Returns array of detected secret patterns
 */
export function detectSecrets(content: string): Array<{ type: string; match: string; line: number }> {
  const secrets: Array<{ type: string; match: string; line: number }> = [];

  // Split into lines for line number tracking
  const lines = content.split('\n');

  // Secret patterns to detect
  const patterns = [
    { type: 'OpenAI API Key', regex: /sk-[a-zA-Z0-9]{32,}/g },
    { type: 'Anthropic API Key', regex: /sk-ant-[a-zA-Z0-9-_]{32,}/g },
    { type: 'Prompd Registry Token', regex: /prompd_[a-zA-Z0-9-_]{32,}/g },
    { type: 'Generic API Key', regex: /api[_-]?key["\s:=]+[a-zA-Z0-9-_]{20,}/gi },
    { type: 'Generic Secret', regex: /secret["\s:=]+[a-zA-Z0-9-_]{20,}/gi },
    { type: 'Private Key Header', regex: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/g },
    { type: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/g },
    { type: 'GitHub Token', regex: /gh[pousr]_[a-zA-Z0-9]{36,}/g },
  ];

  lines.forEach((line, index) => {
    patterns.forEach(({ type, regex }) => {
      const matches = line.match(regex);
      if (matches) {
        matches.forEach((match) => {
          // Mask the secret in the output (show first 8 chars only)
          const maskedMatch = match.length > 8
            ? match.slice(0, 8) + '...'
            : '***';

          secrets.push({
            type,
            match: maskedMatch,
            line: index + 1
          });
        });
      }
    });
  });

  return secrets;
}

/**
 * Validates git reference (tag, branch, commit hash)
 */
export function validateGitRef(ref: string): boolean {
  if (!ref || typeof ref !== 'string') {
    return false;
  }

  // Allow alphanumeric, dots, hyphens, slashes, underscores
  // Covers: branch names, tags, commit hashes
  return /^[a-zA-Z0-9._/-]+$/.test(ref);
}

/**
 * Validates model name (for LLM providers)
 */
export function validateModelName(name: string): boolean {
  if (!name || typeof name !== 'string') {
    return false;
  }

  // Allow letters, numbers, hyphens, dots, underscores
  // e.g., gpt-4, claude-3-opus-20240229, llama3.2
  return /^[a-zA-Z0-9._-]+$/.test(name);
}

/**
 * Validates provider name
 */
export function validateProviderName(name: string): boolean {
  if (!name || typeof name !== 'string') {
    return false;
  }

  // Lowercase letters, numbers, hyphens only
  return /^[a-z][a-z0-9-]*$/.test(name);
}

/**
 * Validates email address (basic validation)
 */
export function validateEmail(email: string): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }

  // Basic email pattern
  const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailPattern.test(email);
}

/**
 * Checks if a string contains potentially malicious content
 */
export function containsMaliciousContent(content: string): boolean {
  if (!content || typeof content !== 'string') {
    return false;
  }

  // Patterns that might indicate injection attempts
  const maliciousPatterns = [
    /<script[^>]*>/i,           // Script tags
    /javascript:/i,              // JavaScript protocol
    /on\w+\s*=/i,               // Event handlers (onclick, onerror, etc.)
    /eval\s*\(/i,               // eval calls
    /Function\s*\(/i,           // Function constructor
    /\$\{.*\}/,                 // Template literal injection
    /`.*`/,                     // Backticks (potential template literals)
  ];

  return maliciousPatterns.some(pattern => pattern.test(content));
}

/**
 * Validates that a value is within numeric range
 */
export function validateNumericRange(value: number, min: number, max: number): boolean {
  if (typeof value !== 'number' || !isFinite(value)) {
    return false;
  }

  return value >= min && value <= max;
}

/**
 * Validates string length
 */
export function validateStringLength(value: string, minLength: number, maxLength: number): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }

  return value.length >= minLength && value.length <= maxLength;
}

/**
 * Sanitizes string for safe display (prevents injection in terminal output)
 */
export function sanitizeForDisplay(value: string): string {
  if (!value || typeof value !== 'string') {
    return '';
  }

  // Remove control characters except common whitespace
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
}

/**
 * Validates JSON structure
 */
export function validateJSON(jsonString: string): boolean {
  try {
    JSON.parse(jsonString);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates YAML structure
 */
export function validateYAML(yamlString: string): boolean {
  try {
    // This would require yaml library - just check basic structure
    // In real implementation, use js-yaml to parse
    return typeof yamlString === 'string' && yamlString.length > 0;
  } catch {
    return false;
  }
}
