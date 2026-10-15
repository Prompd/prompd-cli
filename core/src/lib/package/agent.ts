/* What an agent package may hold, and the rule that its manifest declares
 * everything its definition can reach. Reads only the keys that name other
 * things; full crew semantics stay in the crew loader. */
import { parse as parseYaml } from 'yaml';
import { PackageVerificationError } from './errors';
import { unscopedName, type PackageManifest } from './manifest';

export const AGENT_PACKAGE_FILES = ['AGENT.md', 'SOUL.md', 'PERSONA.md', 'POLICY.yaml'] as const;

export interface AgentRefs { skills: string[]; agents: string[]; mcp: string[] }

const decoder = new TextDecoder('utf-8', { fatal: true });

function invalid(message: string, path: string): PackageVerificationError {
  return new PackageVerificationError('MANIFEST_INVALID', message, path);
}

function text(files: ReadonlyMap<string, Uint8Array>, name: string): string {
  const b = files.get(name);
  if (!b) throw invalid(`an agent package must contain ${name}`, name);
  try { return decoder.decode(b); } catch { throw invalid(`${name} is not UTF-8 text`, name); }
}

function record(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.length > 0) : [];
}

function yamlOf(src: string, path: string): unknown {
  try { return parseYaml(src); } catch { throw invalid(`${path} is not valid YAML`, path); }
}

function frontmatter(src: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src);
  return m ? record(yamlOf(m[1], 'AGENT.md')) : {};
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}

export function checkAgentPackage(manifest: PackageManifest, files: ReadonlyMap<string, Uint8Array>): AgentRefs {
  const allowed = new Set<string>(AGENT_PACKAGE_FILES);
  for (const name of files.keys()) {
    if (!allowed.has(name)) throw invalid(`an agent package may hold only ${AGENT_PACKAGE_FILES.join(', ')}; found ${name}`, name);
  }
  for (const name of AGENT_PACKAGE_FILES) {
    if (!files.has(name)) throw invalid(`an agent package must contain ${name}`, name);
  }

  const fm = frontmatter(text(files, 'AGENT.md'));
  const policy = record(yamlOf(text(files, 'POLICY.yaml'), 'POLICY.yaml'));
  const deps = new Set(Object.keys(manifest.dependencies ?? {}).map(unscopedName));
  const reqSkills = new Set(manifest.requires?.skills ?? []);
  const reqMcp = new Set(manifest.requires?.mcp ?? []);

  if (fm.canCallAll === true) throw invalid('canCallAll cannot be used in a package; list the agents in canCall and declare them as dependencies', 'AGENT.md');

  const skills = unique(strings(policy.skills));
  for (const s of skills) {
    if (!deps.has(s) && !reqSkills.has(s)) throw invalid(`POLICY.yaml grants skill "${s}", which is neither a dependency nor listed in requires.skills`, 'POLICY.yaml');
  }

  const after: string[] = [];
  for (const trig of Array.isArray(fm.triggers) ? fm.triggers : []) {
    const t = record(trig);
    if (t.type === 'run-complete') after.push(...strings(record(t.config).after));
  }
  const agents = unique([...strings(fm.canCall), ...after]);
  for (const a of agents) {
    if (!deps.has(a)) throw invalid(`AGENT.md calls agent "${a}", which is not a dependency`, 'AGENT.md');
  }

  const mcp: string[] = [];
  for (const addr of strings(record(policy.tools).allow)) {
    const m = /^mcp:([^/]+)\//.exec(addr);
    if (m) mcp.push(m[1]);
  }
  const servers = unique(mcp);
  for (const s of servers) {
    if (!reqMcp.has(s)) throw invalid(`POLICY.yaml allows MCP server "${s}", which is not listed in requires.mcp`, 'POLICY.yaml');
  }

  return { skills: skills.filter((s) => deps.has(s)), agents, mcp: servers };
}
