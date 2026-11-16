import { isAddress, sha256, toHex, type Address, type Hex } from 'viem';

export const SCHEMA = 1;
export const MAX_FILE_BYTES = 8_400_000;
export const MAX_FILES = 2_000;
export const MAX_SITE_BYTES = 32 * 1024 * 1024;
export type Site = { chainId: number; processor: Address; circuitId: string; container: Address };
export type FileEntry = { path: string; bytes: number; type: string; sha256: Hex };
export type Artifacts = { site: Site; routing: { fallback: string }; files: FileEntry[] };
export type Manifest = Artifacts & { schemaVersion: 1; release: string; provenance?: { commit?: string; build?: string } };
export type Change = { path: string; kind: 'added' | 'removed' | 'modified' | 'routing'; fields: string[]; approved?: FileEntry | string; deployed?: FileEntry | string };

export function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

export function address(value: unknown): Address {
  if (typeof value !== 'string' || !isAddress(value, { strict: false }) || /^0x0{40}$/i.test(value)) throw new Error('Invalid address');
  return value.toLowerCase() as Address;
}

export function digest(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value)) throw new Error('Invalid digest');
  return value.toLowerCase() as Hex;
}

export function uint(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid integer');
  return value === 0 ? 0 : value;
}

export function parseSite(value: unknown): Site {
  const site = object(value, ['chainId', 'processor', 'circuitId', 'container'], 'site');
  const chainId = uint(site.chainId, 1);
  if (chainId !== 196 && chainId !== 31337) throw new Error('Unsupported site chain');
  const { circuitId } = site;
  if (typeof circuitId !== 'string' || !/^[1-9][0-9]{0,18}$/.test(circuitId) || BigInt(circuitId) > 10n ** 18n) throw new Error('Invalid circuit ID');
  return { chainId, processor: address(site.processor), circuitId, container: address(site.container) };
}

export function pathName(value: unknown): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f\\%?#]/u.test(value) || !value.isWellFormed()) throw new Error('Unsafe file path');
  const path = value.normalize('NFC');
  if (path.split('/').some(part => !part || part === '.' || part === '..') || new TextEncoder().encode(path).length > 1024) throw new Error(`Unsafe file path: ${path}`);
  return path;
}

function fileType(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100 || !/^[a-z\d_.+-]+\/[a-z\d_.+-]+(?:[a-z\d_.+\/;= -]*)$/i.test(value)) throw new Error('Invalid content type');
  return value;
}

export function fileEntry(path: unknown, type: unknown, bytes: Uint8Array): FileEntry {
  return { path: pathName(path), bytes: uint(bytes.length, 0, MAX_FILE_BYTES), type: fileType(type), sha256: sha256(bytes) };
}

const order = (a: FileEntry, b: FileEntry) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

export function parseManifest(value: unknown): Manifest {
  const input = object(value, ['schemaVersion', 'site', 'release', 'routing', 'files', 'provenance'], 'manifest');
  const { release, files } = input;
  if (input.schemaVersion !== SCHEMA) throw new Error('Unsupported manifest schema');
  if (typeof release !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(release)) throw new Error('Invalid release identifier');
  if (!Array.isArray(files) || !files.length || files.length > MAX_FILES) throw new Error('Invalid file inventory size');
  const inventory = files.map(value => {
    const file = object(value, ['path', 'bytes', 'type', 'sha256'], 'file entry');
    return { path: pathName(file.path), bytes: uint(file.bytes, 0, MAX_FILE_BYTES), type: fileType(file.type), sha256: digest(file.sha256) };
  }).sort(order);
  const paths = new Set(inventory.map(f => f.path));
  if (paths.size !== inventory.length) throw new Error('Duplicate normalized file path');
  for (const { path } of inventory) {
    let slash = path.indexOf('/');
    while (slash !== -1) {
      if (paths.has(path.slice(0, slash))) throw new Error('Path cannot be both a file and a directory');
      slash = path.indexOf('/', slash + 1);
    }
  }
  if (inventory.reduce((sum, file) => sum + file.bytes, 0) > MAX_SITE_BYTES) throw new Error('Inventory exceeds 32 MiB');
  const routing = object(input.routing, ['fallback'], 'routing');
  const fallback = routing.fallback === '' ? '' : pathName(routing.fallback);
  if (fallback && !paths.has(fallback)) throw new Error('Fallback points to a missing file');
  const result: Manifest = { schemaVersion: SCHEMA, site: parseSite(input.site), release, routing: { fallback }, files: inventory };
  if (input.provenance !== undefined) {
    const provenance = object(input.provenance, ['commit', 'build'], 'provenance');
    if (provenance.commit !== undefined && (typeof provenance.commit !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(provenance.commit))) throw new Error('Invalid source commit');
    if (provenance.build !== undefined && (typeof provenance.build !== 'string' || !provenance.build.isWellFormed() || provenance.build.length > 500)) throw new Error('Invalid build provenance');
    result.provenance = {};
    if (typeof provenance.commit === 'string') result.provenance.commit = provenance.commit.toLowerCase();
    if (typeof provenance.build === 'string') result.provenance.build = provenance.build;
  }
  return result;
}

export const canonical = (manifest: Manifest) => JSON.stringify(parseManifest(manifest));
export const manifestDigest = (manifest: Manifest) => sha256(toHex(canonical(manifest)));
export function artifactDigest(artifacts: Artifacts): Hex {
  const { schemaVersion, site, routing, files } = parseManifest({
    schemaVersion: SCHEMA, release: 'artifacts', site: artifacts.site, routing: artifacts.routing, files: artifacts.files,
  });
  return sha256(toHex(JSON.stringify({ schemaVersion, site, routing, files })));
}

export const sameSite = (a: Site, b: Site) => JSON.stringify(parseSite(a)) === JSON.stringify(parseSite(b));

export function compare(approved: Artifacts, deployed: Artifacts): Change[] {
  if (!sameSite(approved.site, deployed.site)) throw new Error('Manifest is for a different chain or site');
  const before = new Map(approved.files.map(f => [f.path, f]));
  const after = new Map(deployed.files.map(f => [f.path, f]));
  const changes: Change[] = [];
  const fields = ['sha256', 'bytes', 'type'] as const;
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const a = before.get(path);
    const b = after.get(path);
    if (!a) changes.push({ path, kind: 'added', fields: [], deployed: b });
    else if (!b) changes.push({ path, kind: 'removed', fields: [], approved: a });
    else {
      const changed = fields.filter(field => a[field] !== b[field]);
      if (changed.length) changes.push({ path, kind: 'modified', fields: changed, approved: a, deployed: b });
    }
  }
  if (approved.routing.fallback !== deployed.routing.fallback) changes.push({ path: 'Fallback route', kind: 'routing', fields: ['fallback'], approved: approved.routing.fallback, deployed: deployed.routing.fallback });
  return changes;
}
