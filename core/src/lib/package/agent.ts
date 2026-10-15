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

/** String entries, trimmed, empties dropped (the crew policy loader trims names the same way). */
function strings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === 'string').map((s) => s.trim()).filter((s) => s.length > 0);
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

const MCP_PREFIX = 'mcp:';
const GLOB_RE = /[*?]/;
const NAMED_MCP_RE = /^mcp:([^*?/]+)\//;

function unnamedMcp(addr: string): PackageVerificationError {
  return invalid(`POLICY.yaml allows "${addr}", which can reach MCP servers it does not name; MCP access in a package must name each server (mcp:<server>/<tool> or mcp:<server>/*)`, 'POLICY.yaml');
}

/** The MCP server one tools.allow entry grants, or null when it grants none. The crew
 * matcher lets a glob cross "/" and ":", so any glob that could match "mcp:" is refused. */
function mcpServerOf(addr: string): string | null {
  const glob = addr.search(GLOB_RE);
  if (glob >= 0) {
    const literal = addr.slice(0, glob);
    if (MCP_PREFIX.startsWith(literal)) throw unnamedMcp(addr);
    if (literal.startsWith(MCP_PREFIX)) {
      const slash = addr.indexOf('/', MCP_PREFIX.length);
      const server = addr.slice(MCP_PREFIX.length, slash < 0 ? undefined : slash);
      if (GLOB_RE.test(server)) throw unnamedMcp(addr);
    }
  }
  if (!addr.startsWith(MCP_PREFIX)) return null;
  const m = NAMED_MCP_RE.exec(addr);
  if (!m) throw unnamedMcp(addr);
  return m[1];
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
    const server = mcpServerOf(addr);
    if (server !== null) mcp.push(server);
  }
  const servers = unique(mcp);
  for (const s of servers) {
    if (!reqMcp.has(s)) throw invalid(`POLICY.yaml allows MCP server "${s}", which is not listed in requires.mcp`, 'POLICY.yaml');
  }

  return { skills: skills.filter((s) => deps.has(s)), agents, mcp: servers };
}
