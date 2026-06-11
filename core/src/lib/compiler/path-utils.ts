/**
 * Minimal POSIX path helpers so @prompd/core needs no Node 'path' import.
 * The in-memory/virtual file system uses POSIX-style paths throughout.
 */

export function normalizePosix(p: string): string {
  const isAbs = p.startsWith('/');
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!isAbs) out.push('..');
    } else {
      out.push(seg);
    }
  }
  const joined = out.join('/');
  return isAbs ? '/' + joined : (joined || '.');
}

export function joinPosix(...segments: string[]): string {
  const filtered = segments.filter((s) => s && s.length > 0);
  if (filtered.length === 0) return '.';
  return normalizePosix(filtered.join('/'));
}

/** POSIX-style resolve relative to a base (absolute segments win). */
export function resolvePosix(base: string, p: string): string {
  if (p.startsWith('/')) return normalizePosix(p);
  return joinPosix(base, p);
}

export function dirnamePosix(p: string): string {
  const norm = p.replace(/\/+$/, '');
  const idx = norm.lastIndexOf('/');
  if (idx === -1) return '.';
  if (idx === 0) return '/';
  return norm.slice(0, idx);
}

export function basenamePosix(p: string): string {
  const norm = p.replace(/\/+$/, '');
  const idx = norm.lastIndexOf('/');
  return idx === -1 ? norm : norm.slice(idx + 1);
}

export function isAbsolutePosix(p: string): boolean {
  return p.startsWith('/');
}

/** Return the extension including the dot (e.g. ".prmd"), or "" if none. */
export function extname(p: string): string {
  const base = basenamePosix(p);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot);
}

/**
 * Prompd source file extensions. A .prmd is just markdown (.md) with YAML
 * frontmatter, so both are treated as first-class prompt sources.
 */
export const PROMPD_EXTENSIONS = ['.prmd', '.md'] as const;

/** True if the path is a Prompd source file (.prmd or .md). */
export function isPrompdFile(p: string): boolean {
  const lower = p.toLowerCase();
  return lower.endsWith('.prmd') || lower.endsWith('.md');
}
