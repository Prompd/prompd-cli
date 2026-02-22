/**
 * Custom error classes for Prompd CLI.
 */

export class PrompdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrompdError';
    Object.setPrototypeOf(this, PrompdError.prototype);
  }
}

export class ParseError extends PrompdError {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
    Object.setPrototypeOf(this, ParseError.prototype);
  }
}

export class ValidationError extends PrompdError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class CompilationError extends PrompdError {
  constructor(message: string) {
    super(message);
    this.name = 'CompilationError';
    Object.setPrototypeOf(this, CompilationError.prototype);
  }
}

export class SecurityError extends PrompdError {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
    Object.setPrototypeOf(this, SecurityError.prototype);
  }
}
