import * as path from 'path';
import * as fs from 'fs-extra';

interface Manifest { version: string; dependencies: Record<string, string> }

const repoRoot = path.join(__dirname, '..', '..');
const cli = fs.readJsonSync(path.join(repoRoot, 'typescript', 'package.json')) as Manifest;
const shortName = fs.readJsonSync(path.join(repoRoot, 'prompd', 'package.json')) as Manifest;

describe('release metadata', () => {
  it('depends only on published packages, so the CLI installs outside this repo', () => {
    const local = Object.entries(cli.dependencies).filter(([, spec]) => /^(file|link|workspace):/.test(spec));
    expect(local).toEqual([]);
  });

  it('pins the prompd package to the exact CLI version of the same release', () => {
    expect(shortName.version).toBe(cli.version);
    expect(shortName.dependencies).toEqual({ '@prompd/cli': cli.version });
  });
});
