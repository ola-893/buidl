import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { contentTypeFor } from './content-type';
import { fileEntry, MAX_FILE_BYTES, MAX_FILES, MAX_SITE_BYTES, parseManifest, type FileEntry, type Manifest, type Site } from './manifest';

export async function readBuild(root: string, options: { site: Site; release: string; fallback?: string; provenance?: Manifest['provenance'] }) {
  const contents = new Map<string, Uint8Array>();
  const files: FileEntry[] = [];
  let total = 0;
  async function walk(directory: string, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      const path = prefix + entry.name;
      if (entry.isDirectory()) {
        await walk(fullPath, path + '/');
        continue;
      }
      if (!entry.isFile()) throw new Error(`Unsupported file entry: ${path}`);
      const stat = await lstat(fullPath);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES || total + stat.size > MAX_SITE_BYTES || files.length >= MAX_FILES) throw new Error(`Build limit exceeded: ${path}`);
      const bytes = await readFile(fullPath);
      const file = fileEntry(path, contentTypeFor(path), bytes);
      if (contents.has(file.path)) throw new Error(`Duplicate normalized file path: ${file.path}`);
      contents.set(file.path, bytes);
      files.push(file);
      total += bytes.length;
    }
  }
  if (!(await lstat(root)).isDirectory()) throw new Error('Build must be a directory');
  await walk(root);
  const manifest = parseManifest({ schemaVersion: 1, site: options.site, release: options.release, routing: { fallback: options.fallback ?? '' }, files, provenance: options.provenance });
  return { manifest, contents };
}
