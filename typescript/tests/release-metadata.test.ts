import * as path from 'path';
import * as fs from 'fs-extra';

interface Manifest { dependencies: Record<string, string> }

const cli = fs.readJsonSync(path.join(__dirname, '..', 'package.json')) as Manifest;

describe('release metadata', () => {
  it('depends only on published packages, so the CLI installs outside this repo', () => {
    const local = Object.entries(cli.dependencies).filter(([, spec]) => /^(file|link|workspace):/.test(spec));
    expect(local).toEqual([]);
  });
});
