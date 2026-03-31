/**
 * TestHarness — Standard interface for prompt test frameworks.
 *
 * @prompd/cli defines this interface as the contract for test execution.
 * Any test harness (@prompd/test, third-party, etc.) implements it and
 * registers via `registerTestHarness()`. The CLI's `prompd test` command
 * delegates to whichever harness is registered.
 *
 * This avoids circular dependencies — the CLI doesn't depend on any
 * specific test framework, but any test framework can plug in.
 *
 * @example
 * ```typescript
 * import { registerTestHarness } from '@prompd/cli';
 * import { TestRunner } from '@prompd/test';
 *
 * const cli = await import('@prompd/cli');
 * registerTestHarness(new TestRunner(cli));
 * ```
 */

// --- Result types ---

export interface TestHarnessResult {
  suites: TestHarnessSuiteResult[];
  summary: TestHarnessSummary;
}

export interface TestHarnessSuiteResult {
  suite: string;
  testFilePath: string;
  results: TestHarnessTestResult[];
}

export interface TestHarnessTestResult {
  suite: string;
  testName: string;
  status: 'pass' | 'fail' | 'error' | 'skip';
  duration: number;
  assertions: TestHarnessAssertionResult[];
  output?: string;
  compiledInput?: string;
  error?: string;
}

export interface TestHarnessAssertionResult {
  evaluator: string;
  check?: string;
  status: 'pass' | 'fail' | 'error' | 'skip';
  reason?: string;
  duration: number;
}

export interface TestHarnessSummary {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  duration: number;
}

// --- Options ---

export interface TestHarnessOptions {
  evaluators?: string[];
  noLlm?: boolean;
  reporter?: string;
  failFast?: boolean;
  runAll?: boolean;
  verbose?: boolean;
  workspaceRoot?: string;
  registryUrl?: string;
  provider?: string;
  model?: string;
}

// --- Progress ---

export interface TestHarnessProgressEvent {
  type: 'suite_start' | 'test_start' | 'test_complete' | 'suite_complete' | 'assertion_complete';
  suite: string;
  testName?: string;
  testCount?: number;
  result?: TestHarnessTestResult;
  assertion?: TestHarnessAssertionResult;
}

export type TestHarnessProgressCallback = (event: TestHarnessProgressEvent) => void;

// --- Interface ---

export interface TestHarness {
  /**
   * Run tests for a target path (file or directory).
   * Returns structured results.
   */
  run(
    targetPath: string,
    options?: TestHarnessOptions,
    onProgress?: TestHarnessProgressCallback
  ): Promise<TestHarnessResult>;

  /**
   * Run tests and return formatted output string.
   * Uses the reporter specified in options (default: 'console').
   */
  runAndReport(
    targetPath: string,
    options?: TestHarnessOptions,
    onProgress?: TestHarnessProgressCallback
  ): Promise<{ output: string; exitCode: number }>;
}

// --- Registration ---

let registeredHarness: TestHarness | null = null;

/**
 * Register a test harness implementation.
 * Called by the consumer (app, standalone script) to plug in a test framework.
 */
export function registerTestHarness(harness: TestHarness): void {
  registeredHarness = harness;
}

/**
 * Get the registered test harness.
 * Throws if no harness has been registered.
 */
export function getTestHarness(): TestHarness {
  if (!registeredHarness) {
    throw new Error(
      'No test harness registered. Install a test framework (e.g., @prompd/test) ' +
      'and call registerTestHarness() before using the test command.'
    );
  }
  return registeredHarness;
}
