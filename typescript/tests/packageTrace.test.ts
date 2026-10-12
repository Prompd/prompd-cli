/* The CLI packager traces .prmd dependencies with @prompd/core's tracer: one
 * walk for the CLI and the app. Recursive now (a dependency's dependencies are
 * found), and a ref outside the workspace is ignored as before. */
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { traceLocalPrmdDeps } from '../src/commands/package';
import { detectSecrets } from '../src/lib/validation';

describe('traceLocalPrmdDeps', () => {
  const root = path.join(os.tmpdir(), `prompd-trace-${process.pid}`);

  beforeAll(async () => {
    await fs.remove(root);
    await fs.outputFile(path.join(root, 'prompts/a.prmd'), '---\nid: a\nname: a\nversion: 1.0.0\ninherits: ./base.prmd\ncontext: ../../outside.md\n---\n{% include "./parts/intro.md" %}');
    await fs.outputFile(path.join(root, 'prompts/base.prmd'), '---\nid: base\nname: base\nversion: 1.0.0\ncontext: ../ctx/notes.md\n---\nBase.');
    await fs.outputFile(path.join(root, 'prompts/parts/intro.md'), 'Intro.');
  });

  afterAll(async () => {
    await fs.remove(root);
  });

  it('finds direct and transitive deps, existing or missing, and drops escaping refs', async () => {
    const deps = await traceLocalPrmdDeps('prompts/a.prmd', root);
    expect(deps.sort()).toEqual(['ctx/notes.md', 'prompts/base.prmd', 'prompts/parts/intro.md']);
  });

  it('accepts a Windows-style relative path', async () => {
    const deps = await traceLocalPrmdDeps('prompts\\a.prmd', root);
    expect(deps).toContain('prompts/base.prmd');
  });
});

describe('detectSecrets delegates to core', () => {
  it('keeps type, masked match and line', () => {
    expect(detectSecrets('x\nAWS_KEY=AKIAIOSFODNN7EXAMPLE')).toEqual([
      { type: 'AWS Access Key', match: 'AKIAIOSF...', line: 2 },
    ]);
  });
});
