/**
 * @prompd/core — environment-agnostic Prompd engine.
 *
 * Exports the .prmd parser, the compilation pipeline (Nunjucks templating +
 * formatters), the in-memory file system, and the injectable package-resolver
 * seam. No Node-only imports — runs in Node, the browser, and the backend.
 */

// Parser (pure parseContent + validateContent; CLI subclasses for fs access)
export { PrompdParser } from './lib/parser';

// Shared .prmd types and constants
export * from './types';

// Error classes
export * from './lib/errors';

// Compiler: PrompdCompiler, pipeline, stages, formatters, file-system,
// package-ref helpers, and compiler types (incl. IPackageResolver).
export * from './lib/compiler';

// Workflow tooling (.pdflow) — browser-safe parse/validate/types. The Node-only
// execution engine stays in @prompd/cli; everything here runs in the browser.
export * from './lib/workflowTypes';
export {
  parseWorkflow, serializeWorkflow, createEmptyWorkflow, createWorkflowNode, getExecutionOrder,
} from './lib/workflowParser';
export type { ParsedWorkflow } from './lib/workflowParser';
export { validateWorkflow, validateWorkflowQuick } from './lib/workflowValidator';
export type { ValidationResult } from './lib/workflowValidator';
