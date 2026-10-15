import { checkAgentPackage, AGENT_PACKAGE_FILES } from '../src/lib/package/agent';
import { PackageVerificationError } from '../src/lib/package/errors';
import type { PackageManifest } from '../src/lib/package/manifest';

const t = (s: string) => new TextEncoder().encode(s);

function agentFiles(opts: { agentFm?: string; policy?: string; extra?: Record<string, string> } = {}): Map<string, Uint8Array> {
  const m = new Map<string, Uint8Array>([
    ['AGENT.md', t(`---\nname: reviewer\n${opts.agentFm ?? ''}---\nReview pull requests.\n`)],
    ['SOUL.md', t('Careful.')],
    ['PERSONA.md', t('A reviewer.')],
    ['POLICY.yaml', t(opts.policy ?? 'defaultPermission: ask\n')],
  ]);
  for (const [k, v] of Object.entries(opts.extra ?? {})) m.set(k, t(v));
  return m;
}

const manifest = (over: Partial<PackageManifest> = {}): PackageManifest => ({ name: '@acme/reviewer', version: '1.0.0', type: 'agent', ...over });

function codeOf(f: () => unknown): string {
  try { f(); return 'ok'; } catch (e) { return e instanceof PackageVerificationError ? `${e.code}:${e.path ?? ''}` : `other: ${String(e)}`; }
}

describe('checkAgentPackage', () => {
  it('accepts the four definition files with nothing referenced', () => {
    expect(checkAgentPackage(manifest(), agentFiles())).toEqual({ skills: [], agents: [], mcp: [] });
    expect([...AGENT_PACKAGE_FILES]).toEqual(['AGENT.md', 'SOUL.md', 'PERSONA.md', 'POLICY.yaml']);
  });

  it('refuses an extra file and a missing one', () => {
    expect(codeOf(() => checkAgentPackage(manifest(), agentFiles({ extra: { 'settings.json': '{}' } })))).toBe('MANIFEST_INVALID:settings.json');
    const missing = agentFiles();
    missing.delete('SOUL.md');
    expect(codeOf(() => checkAgentPackage(manifest(), missing))).toBe('MANIFEST_INVALID:SOUL.md');
  });

  it('returns declared skill, agent and MCP references', () => {
    const refs = checkAgentPackage(
      manifest({
        dependencies: { '@acme/pr-review-skill': '^1.2.0', '@acme/test-writer': '^2.0.0' },
        requires: { mcp: ['github'], skills: ['writing-plans'] },
      }),
      agentFiles({
        agentFm: 'canCall: [test-writer]\n',
        policy: 'skills: [pr-review-skill, writing-plans]\ntools:\n  allow: ["mcp:github/*", "fs:read_file"]\n',
      }),
    );
    expect(refs).toEqual({ skills: ['pr-review-skill'], agents: ['test-writer'], mcp: ['github'] });
  });

  it('counts run-complete trigger targets as agent references', () => {
    const refs = checkAgentPackage(
      manifest({ dependencies: { '@acme/builder': '1.0.0' } }),
      agentFiles({ agentFm: 'triggers:\n  - type: run-complete\n    config:\n      after: [builder]\n' }),
    );
    expect(refs.agents).toEqual(['builder']);
  });

  it.each([
    ['an undeclared skill', { policy: 'skills: [secret-skill]\n' }],
    ['an undeclared agent', { agentFm: 'canCall: [helper]\n' }],
    ['an undeclared MCP server', { policy: 'tools:\n  allow: ["mcp:jira/search"]\n' }],
    ['canCallAll', { agentFm: 'canCallAll: true\n' }],
  ])('refuses %s', (_label, files) => {
    expect(codeOf(() => checkAgentPackage(manifest(), agentFiles(files)))).toMatch(/^MANIFEST_INVALID:/);
  });

  it('refuses unparseable POLICY.yaml', () => {
    expect(codeOf(() => checkAgentPackage(manifest(), agentFiles({ policy: 'skills: [unclosed\n' })))).toBe('MANIFEST_INVALID:POLICY.yaml');
  });
});
