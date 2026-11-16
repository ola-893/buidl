import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const out = 'build-cli';
await build({
  entryPoints: ['src/cli.ts'],
  outfile: `${out}/buidl.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'eof',
});

const licenses = [
  ['TapeKit kernel', 'vendor/tapekit/LICENSE'],
  ['viem', 'node_modules/viem/LICENSE'],
  ['ox', 'node_modules/ox/LICENSE'],
  ['abitype', 'node_modules/abitype/LICENSE'],
  ['mime', 'node_modules/mime/LICENSE'],
  ['@noble/curves', 'node_modules/@noble/curves/LICENSE'],
  ['@noble/hashes', 'node_modules/@noble/hashes/LICENSE'],
  ['@scure/base', 'node_modules/@scure/base/LICENSE'],
];
const notices = await Promise.all(licenses.map(async ([name, path]) => `${name}\n\n${(await readFile(path, 'utf8')).trim()}`));
await writeFile(`${out}/NOTICES.txt`, notices.join('\n\n') + '\n');
