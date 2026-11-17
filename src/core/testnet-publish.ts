import { encodeFunctionData, sha256, toHex, type Address, type Hex } from 'viem';
import { artifactDigest, type Manifest } from './manifest';
import { storeAbi } from './tapeout';
import {
  beginTestnet, compareTestnet, requireTestnetGate, testnetAuthorityAbi, testnetOutcome, testnetSnapshot, testnetWrite,
  type TestnetClient, type TestnetConfig,
} from './testnet';

export type TestnetSend = (tx: { to: Address; data: Hex; label: string }) => Promise<void>;
export async function publishTestnet(
  config: TestnetConfig,
  staged: { manifest: Manifest; contents: ReadonlyMap<string, Uint8Array> },
  send: TestnetSend,
  client?: TestnetClient,
  options: { resume?: boolean } = {},
) {
  const first = await testnetSnapshot(config, client);
  requireTestnetGate(staged.manifest, config, first);
  if (!['complete', 'empty', 'partial'].includes(first.inspection.status) || first.inspection.fallback === undefined) {
    throw new Error('The current test fixture inventory is unavailable.');
  }
  // Keep the bytes staged in memory throughout this attempt.
  const files = staged.manifest.files.map(file => {
    const bytes = staged.contents.get(file.path);
    if (!bytes || bytes.length > 60_000 || bytes.length !== file.bytes || sha256(bytes) !== file.sha256) {
      throw new Error('Testnet upload bytes differ from the manifest or exceed 60 KB per file.');
    }
    return { file, bytes };
  });
  const resuming = options.resume && first.inProgress && first.sequence === first.approval!.commitment.approval.sequence &&
    first.publicationDigest === first.approval!.commitment.approval.manifestDigest;
  if (!resuming) await send({ ...beginTestnet(config, first), label: 'Begin approved testnet publication' });
  const attempt = resuming ? first.attempt : first.attempt + 1n;
  for (const { file, bytes } of files) {
    const existing = first.inspection.files.find(entry => entry.path === file.path);
    if (resuming && existing?.status === 'verified' && existing.sha256 === file.sha256 &&
        existing.bytes === file.bytes && existing.type === file.type) continue;
    const chunks = Math.max(1, Math.ceil(bytes.length / 12_000));
    for (let index = 0; index < chunks; index++) {
      const part = bytes.subarray(index * 12_000, (index + 1) * 12_000);
      const hex = toHex(part);
      const call = index === 0 ?
        encodeFunctionData({ abi: storeAbi, functionName: 'putFile', args: [config.fixture, file.path, file.type, file.sha256, hex] }) :
        encodeFunctionData({ abi: storeAbi, functionName: 'appendChunk', args: [config.fixture, file.path, BigInt(index), hex] });
      await send({ ...testnetWrite(config, attempt, call), label: `Upload ${file.path} · chunk ${index + 1}/${chunks}` });
    }
  }
  const paths = new Set(staged.manifest.files.map(file => file.path));
  for (const file of first.inspection.files) {
    if (!paths.has(file.path)) await send({ ...testnetWrite(config, attempt,
      encodeFunctionData({ abi: storeAbi, functionName: 'removeFile', args: [config.fixture, file.path] })), label: `Remove ${file.path}` });
  }
  if (!resuming || first.inspection.fallback !== staged.manifest.routing.fallback) await send({ ...testnetWrite(config, attempt, encodeFunctionData({ abi: storeAbi, functionName: 'setFallback',
    args: [config.fixture, staged.manifest.routing.fallback] })), label: 'Set testnet fallback route' });
  const stagedSnapshot = await testnetSnapshot(config, client);
  requireTestnetGate(staged.manifest, config, stagedSnapshot);
  const entries = stagedSnapshot.inspection.files.filter(file => file.status === 'verified' && file.sha256).map(file =>
    ({ path: file.path, bytes: file.bytes, type: file.type, sha256: file.sha256! }));
  if (stagedSnapshot.attempt !== attempt || entries.length !== staged.manifest.files.length ||
      artifactDigest({ site: staged.manifest.site, files: entries, routing: { fallback: stagedSnapshot.inspection.fallback ?? '' } }) !== artifactDigest(staged.manifest)) {
    throw new Error('The staged fixture differs. Publication stays incomplete.');
  }
  await send({ to: config.authority, data: encodeFunctionData({ abi: testnetAuthorityAbi, functionName: 'finishPublication', args: [attempt] }),
    label: 'Finish publication after byte verification' });
  const final = await testnetSnapshot(config, client);
  if (testnetOutcome(final) !== 'match' || compareTestnet(final, staged.manifest).length) throw new Error('Post-deployment approval match unavailable.');
  return final;
}
