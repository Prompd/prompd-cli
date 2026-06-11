import { defineConfig } from 'tsup';

// @prompd/core builds to dual ESM + CJS with type declarations so it can be
// consumed by the CommonJS @prompd/cli, the ESM backend, and the Vite browser
// app alike. nunjucks + yaml stay external (consumers bundle them).
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  treeshake: true,
  external: ['nunjucks', 'yaml'],
});
