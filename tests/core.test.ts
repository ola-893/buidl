import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRpc, type RpcRequest } from '@tapekit/kernel';
import { decodeFunctionData, encodeFunctionResult, toHex, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { approvalTypedData, signaturesFor, type Evidence, type Policy } from '../src/core/approval';
import { readBuild } from '../src/core/build';
import { compare, fileEntry, manifestDigest, parseManifest, type Site } from '../src/core/manifest';
import { explicitXLayer, inspectLive, readInventory, storeAbi, unavailable } from '../src/core/tapeout';

const processor: Address = '0x1111111111111111111111111111111111111111';
const container: Address = '0x2222222222222222222222222222222222222222';
const other: Address = '0x3333333333333333333333333333333333333333';
const site: Site = { chainId: 196, processor, circuitId: '1', container };
const entry = (path: string, contents: string) => fileEntry(path, 'text/plain', new TextEncoder().encode(contents));
const manifest = parseManifest({
  schemaVersion: 1, site, release: 'release-a', routing: { fallback: '' },
  files: [entry('modified.txt', 'A'), entry('removed.txt', 'x'), entry('same.txt', 'y')],
});

test('canonical manifest is deterministic and rejects ambiguous or unsafe paths', async t => {
  const root = await mkdtemp(join(tmpdir(), 'buidl-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'assets/b.txt'), 'B');
  await writeFile(join(root, 'a.txt'), 'A');
  const { manifest } = await readBuild(root, { site, release: 'my-build' });
  assert.deepEqual(manifest.files.map(file => file.path), ['a.txt', 'assets/b.txt']);
  assert.equal(manifestDigest(manifest), manifestDigest({ ...manifest, files: [...manifest.files].reverse() }));
  assert.throws(() => parseManifest({ ...manifest, files: [entry('e\u0301.txt', 'x'), entry('é.txt', 'y')] }), /Duplicate/);
  assert.throws(() => entry('../escape', 'X'), /Unsafe/);
  assert.throws(() => entry('a%2fb', 'X'), /Unsafe/);
  await symlink(join(root, 'a.txt'), join(root, 'alias'));
  await assert.rejects(readBuild(root, { site, release: 'my-build' }), /Unsupported file entry/);
});

test('comparison reports added, removed, modified, and routing differences and rejects wrong identity', () => {
  const deployed = { site, routing: { fallback: 'same.txt' }, files: [entry('added.txt', 'new'), entry('modified.txt', 'B'), entry('same.txt', 'y')] };
  assert.deepEqual(compare(manifest, deployed).map(change => [change.path, change.kind]), [
    ['added.txt', 'added'], ['modified.txt', 'modified'], ['removed.txt', 'removed'], ['Fallback route', 'routing'],
  ]);
  assert.throws(() => compare(manifest, { ...deployed, site: { ...site, chainId: 31337 } }), /different chain or site/);
  assert.throws(() => compare(manifest, { ...deployed, site: { ...site, container: other } }), /different chain or site/);
  assert.throws(() => explicitXLayer('4246.0.tape'), /Unsupported network/);
  assert.throws(() => explicitXLayer(container), /Ambiguous/);
  assert.equal(explicitXLayer('xlayer:' + container).kind, 'container');
});

test('typed signatures bind the release, site, chain, verifier, policy version and sequence', async () => {
  const [a, b, c] = Array.from({ length: 3 }, () => privateKeyToAccount(generatePrivateKey()));
  const policy: Policy = { holder: processor, epoch: 1n, version: 1n, threshold: 2n, reviewers: [a.address, b.address] };
  const evidence: Evidence = { manifest, registry: other, instanceSalt: toHex(1, { size: 32 }), expiry: 2_000_000_000, rollback: false, policyVersion: 1, sequence: 1, signatures: [] };
  const data = approvalTypedData(evidence);
  const [first, second, unauthorized] = await Promise.all([a, b, c].map(account => account.signTypedData(data)));
  const signed = { ...evidence, signatures: [first, second] };
  assert.equal((await signaturesFor(signed, policy)).length, 2);
  await assert.rejects(signaturesFor({ ...signed, signatures: [first] }, policy), /threshold/);
  await assert.rejects(signaturesFor({ ...signed, signatures: [first, first] }, policy), /Duplicate/);
  await assert.rejects(signaturesFor({ ...signed, signatures: [first, unauthorized] }, policy), /Unauthorized/);
  await assert.rejects(signaturesFor({ ...signed, signatures: ['0x' as Hex] }, policy), /Invalid/);
  const replays: Partial<Evidence>[] = [
    { sequence: 2 }, { expiry: evidence.expiry + 1 }, { rollback: true }, { registry: processor },
    { instanceSalt: toHex(2, { size: 32 }) }, { manifest: { ...manifest, release: 'release-b' } },
    { manifest: { ...manifest, site: { ...site, chainId: 31337 } } }, { manifest: { ...manifest, site: { ...site, circuitId: '2' } } },
  ];
  for (const replay of replays) await assert.rejects(signaturesFor({ ...signed, ...replay }, policy), /Unauthorized/);
  await assert.rejects(signaturesFor(signed, { ...policy, version: 2n }), /inactive policy/);
});

test('RPC disagreement and unavailable quorum fail closed', async () => {
  const urls = ['https://a.example.com', 'https://b.example.org'];
  const mockRpc = (otherChain: boolean, failed = false) => createRpc({
    urls, retries: 0, shuffle: false,
    fetchImpl: async (url, init) => {
      const request = JSON.parse(String(init?.body));
      const second = String(url).includes('example.org');
      const reply = (query: { id: number }) => ({ jsonrpc: '2.0', id: query.id, result: second && otherChain ? '0x38' : '0xc4' });
      return second && failed ? new Response('', { status: 503 }) : Response.json(Array.isArray(request) ? request.map(reply) : reply(request));
    },
  });
  const conflict = await inspectLive('1.2.344.tape', mockRpc(true));
  assert.equal(conflict.status, 'unavailable');
  assert.match(conflict.detail ?? '', /differ|conflict|disagree/i);
  const missing = await inspectLive('1.2.344.tape', mockRpc(false, true));
  assert.equal(missing.status, 'unavailable');
  assert.match(missing.detail ?? '', /not enough|unavailab/i);
  assert.equal(missing.artifacts, undefined);
});

test('partial uploads, missing files, and changed bytes never yield comparable artifacts', async () => {
  const path = 'index.html';
  const one = entry(path, 'A');
  function responses(contents: string, chunks: bigint) {
    return async (requests: RpcRequest[]) => requests.map(request => {
      assert.equal(request.params[1], '0x42');
      const data = (request.params[0] as { data: Hex }).data;
      const { functionName } = decodeFunctionData({ abi: storeAbi, data });
      let value: Hex;
      switch (functionName) {
        case 'pathCount': value = encodeFunctionResult({ abi: storeAbi, functionName, result: 1n }); break;
        case 'pathsRange': value = encodeFunctionResult({ abi: storeAbi, functionName, result: [path] }); break;
        case 'fallbackPath': value = encodeFunctionResult({ abi: storeAbi, functionName, result: path }); break;
        case 'fileInfo': value = encodeFunctionResult({ abi: storeAbi, functionName, result: [1, 'text/plain', one.sha256, 0, chunks] }); break;
        case 'read': value = encodeFunctionResult({ abi: storeAbi, functionName, result: toHex(contents) }); break;
        default: throw new Error('Unexpected call');
      }
      return { ok: true as const, value };
    });
  }
  const base = () => ({ ...unavailable('local', 'test', ''), site, registry: container });
  assert.equal((await readInventory(base(), '0x42', responses('A', 1n))).status, 'complete');
  const upload = await readInventory(base(), '0x42', responses('A', 1n), true);
  assert.equal(upload.status, 'partial');
  assert.equal(upload.artifacts, undefined);
  const missing = await readInventory(base(), '0x42', responses('A', 0n));
  assert.equal(missing.files[0].status, 'missing');
  assert.equal(missing.artifacts, undefined);
  const changed = await readInventory(base(), '0x42', responses('B', 1n));
  assert.equal(changed.files[0].status, 'incomplete');
  assert.equal(changed.artifacts, undefined);
});
