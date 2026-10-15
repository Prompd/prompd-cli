// src/lib/package/pack.ts
/* packPdpkg: the ONE packer. Every producer (workflow packages, CLI publish,
 * prompd package create, the CLI's in-memory publish) writes integrity through
 * here, so everything we publish is something openPdpkg accepts. */
import JSZip from 'jszip';
import { entryNameProblem } from './archive';
import { sha256Hex } from './digest';
import type { PackageIntegrity, PackageManifest } from './manifest';
import { openPdpkg } from './verify';
import { ARCHIVE_COPY, META_FILE } from './layout';

const RESERVED = new Set(['prompd.json', 'manifest.json']);
const RESERVED_LAYOUT = new Set([ARCHIVE_COPY, META_FILE].map((n) => n.toLowerCase()));
const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const encoder = new TextEncoder();

export async function computeIntegrity(files: ReadonlyMap<string, Uint8Array>): Promise<PackageIntegrity> {
  const out: Record<string, string> = {};
  for (const p of [...files.keys()].sort()) out[p] = await sha256Hex(files.get(p) as Uint8Array);
  return { algorithm: 'sha256', files: out };
}

/** `manifest.integrity`, if present, is ignored and replaced. (Not `Omit<PackageManifest, 'integrity'>`:
 * Omit over a type with an index signature erases the named keys, so the compiler would stop checking them.) */
export async function packPdpkg(
  manifest: PackageManifest,
  files: ReadonlyMap<string, Uint8Array | string>,
): Promise<Uint8Array> {
  const bytes = new Map<string, Uint8Array>();
  for (const [p, v] of files) {
    if (RESERVED_OBJECT_KEYS.has(p)) throw new Error(`Refusing package path "${p}": it is a reserved name`);
    if (RESERVED.has(p.toLowerCase())) throw new Error(`Refusing package path "${p}": it is reserved for the manifest`);
    if (RESERVED_LAYOUT.has(p.toLowerCase())) throw new Error(`Refusing package path "${p}": it is reserved for the install layout`);
    const problem = entryNameProblem(p);
    if (problem) throw new Error(`Refusing package path "${p}": ${problem}`);
    bytes.set(p, typeof v === 'string' ? encoder.encode(v) : v);
  }
  const integrity = await computeIntegrity(bytes);
  const zip = new JSZip();
  const { integrity: _ignored, ...rest } = manifest;
  void _ignored;
  zip.file('prompd.json', JSON.stringify({ ...rest, integrity }, null, 2));
  for (const p of [...bytes.keys()].sort()) zip.file(p, bytes.get(p) as Uint8Array);
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  // What we pack must be what we accept: a packer that writes an archive the
  // verifier refuses (an agent rule, a name rule) fails here, not at install.
  await openPdpkg(out);
  return out;
}
