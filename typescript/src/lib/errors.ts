/**
 * Custom error classes for Prompd. Single source of truth lives in @prompd/core;
 * re-exported here so existing `../errors` imports keep working unchanged.
 */
export {
  PrompdError,
  ParseError,
  ValidationError,
  CompilationError,
  SecurityError
} from '@prompd/core';
