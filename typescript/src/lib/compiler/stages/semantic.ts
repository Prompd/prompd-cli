/**
 * Semantic Analysis Stage - Validate parameters and references.
 *
 * This stage validates the semantic correctness of the prompt, checks required
 * parameters, applies default values, and validates parameter types.
 */

import { CompilerStage, CompilationContext } from '../types';

export class SemanticAnalysisStage implements CompilerStage {
  async process(context: CompilationContext): Promise<void> {
    if (!context.metadata) {
      return;
    }

    // Validate required metadata fields
    this.validateRequiredMetadata(context);

    // Merge default parameter values and validate required parameters
    if (context.metadata.parameters) {
      // Only validate required parameters if we're in execution mode (parameters were explicitly provided).
      // When editing/validating a file (no parameters passed), we shouldn't warn about
      // required parameters since they'll be provided at execution time.
      // A prompt definition file declaring required parameters is perfectly valid.
      const isExecutionMode = Object.keys(context.parameters).length > 0;

      for (const param of context.metadata.parameters) {
        // Add default value if parameter not provided
        if (!(param.name in context.parameters) && param.default !== undefined) {
          context.parameters[param.name] = param.default;

          if (context.verbose) {
            console.log(`✓ Using default value for '${param.name}': ${param.default}`);
          }
        }

        // Validate required parameters - only when executing (parameters were provided)
        // Skip this check when just validating a definition file
        if (isExecutionMode && param.required && !(param.name in context.parameters)) {
          context.addWarning(`Required parameter '${param.name}' not provided`);
        }

        // Type validation for provided parameters
        if (param.name in context.parameters) {
          const value = context.parameters[param.name];
          const isValid = this.validateParameterType(value, param.type);

          if (!isValid) {
            context.addWarning(
              `Parameter '${param.name}' has incorrect type. Expected: ${param.type}, got: ${typeof value}`
            );
          }
        }

        // Pattern validation for string parameters
        if (param.pattern && param.name in context.parameters) {
          const value = String(context.parameters[param.name]);
          const regex = new RegExp(param.pattern);

          if (!regex.test(value)) {
            context.addWarning(
              `Parameter '${param.name}' does not match pattern: ${param.pattern}`
            );
          }
        }

        // Range validation for number parameters
        if (param.type === 'number' && param.name in context.parameters) {
          const value = Number(context.parameters[param.name]);

          if (param.minimum !== undefined && value < param.minimum) {
            context.addWarning(
              `Parameter '${param.name}' is below minimum value: ${param.minimum}`
            );
          }

          if (param.maximum !== undefined && value > param.maximum) {
            context.addWarning(
              `Parameter '${param.name}' exceeds maximum value: ${param.maximum}`
            );
          }
        }
      }
    }

    if (context.verbose && context.parameters) {
      const paramCount = Object.keys(context.parameters).length;
      console.log(`✓ Validated ${paramCount} parameter(s)`);
    }
  }

  /**
   * Validate parameter type.
   */
  private validateParameterType(value: any, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
      case 'integer':
      case 'float':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      default:
        return true; // Unknown type, allow it
    }
  }

  /**
   * Validate required metadata fields (id, name, version).
   */
  private validateRequiredMetadata(context: CompilationContext): void {
    const metadata = context.metadata;
    if (!metadata) return;

    // Validate 'id' field
    if (!metadata.id) {
      const location = context.findLocation(/^---/m);
      context.addDiagnostic({
        message: "Required field 'id' is missing. Add a unique identifier for this prompt.",
        severity: 'error',
        source: 'semantic',
        code: 'MISSING_ID',
        line: location?.line ? location.line + 1 : 2,
        column: 1
      });
    } else if (typeof metadata.id === 'string') {
      // Validate kebab-case format
      if (!/^[a-z0-9-]+$/.test(metadata.id)) {
        const location = context.findLocation(/^\s*id:/m);
        context.addDiagnostic({
          message: `ID '${metadata.id}' should use kebab-case format (lowercase letters, numbers, hyphens only).`,
          severity: 'warning',
          source: 'semantic',
          code: 'INVALID_ID_FORMAT',
          ...location
        });
      }
    }

    // Validate 'name' field
    if (!metadata.name) {
      const location = context.findLocation(/^---/m);
      context.addDiagnostic({
        message: "Required field 'name' is missing. Add a display name for this prompt.",
        severity: 'error',
        source: 'semantic',
        code: 'MISSING_NAME',
        line: location?.line ? location.line + 1 : 2,
        column: 1
      });
    }

    // Validate 'version' field
    if (!metadata.version) {
      const location = context.findLocation(/^---/m);
      context.addDiagnostic({
        message: "Required field 'version' is missing. Add a semantic version (e.g., 1.0.0).",
        severity: 'error',
        source: 'semantic',
        code: 'MISSING_VERSION',
        line: location?.line ? location.line + 1 : 2,
        column: 1
      });
    } else if (typeof metadata.version === 'string') {
      // Validate semantic version format
      if (!/^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/.test(metadata.version)) {
        const location = context.findLocation(/^\s*version:/m);
        context.addDiagnostic({
          message: `Invalid semantic version '${metadata.version}'. Use format: MAJOR.MINOR.PATCH (e.g., 1.0.0)`,
          severity: 'error',
          source: 'semantic',
          code: 'INVALID_VERSION',
          ...location
        });
      }
    }
  }

  getName(): string {
    return 'Semantic Analysis';
  }
}
