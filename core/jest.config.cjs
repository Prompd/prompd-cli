/**
 * Core is ESM ("type": "module"), but jest runs CJS. ts-jest compiles the TypeScript
 * source down to CommonJS for the test run, so extensionless imports and the CJS deps
 * (jszip, semver) resolve without --experimental-vm-modules gymnastics.
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          verbatimModuleSyntax: false,
          // Base tsconfig sets "types": [] (excludes all @types); re-add jest so the
          // test globals (describe/it/expect) resolve. Source needs no ambient types.
          types: ['jest'],
        },
      },
    ],
  },
};
