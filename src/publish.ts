import { mkdir, rmdir } from 'node:fs/promises';
import { createWalletClient, encodeFunctionData, getAddress, http, toHex, type Address, type Hash, type Hex } from 'viem';
import { foundry } from 'viem/chains';
import { readBuild } from './core/build';
import { approvalStatus, inspectLocal, LOCAL_RPC, localAbi, localClient, localState, type LocalConfig } from './core/local';
import { compare, manifestDigest, sameSite, type Manifest } from './core/manifest';

export function localWallet(account: Address) {
  return createWalletClient({ account: getAddress(account), chain: foundry, transport: http(LOCAL_RPC, { retryCount: 0 }) });
}

export async function waitFor(hash: Hash) {
  const receipt = await localClient().waitForTransactionReceipt({ hash, timeout: 30_000 });
  if (receipt.status !== 'success') throw new Error(`Transaction reverted: ${hash}`);
  return receipt;
}

export async function gate(directory: string, approved: Manifest, config: LocalConfig) {
  if (!sameSite(approved.site, config.site)) throw new Error('Wrong chain or site for this approval registry.');
  const staged = await readBuild(directory, { site: approved.site, release: approved.release, fallback: approved.routing.fallback, provenance: approved.provenance });
  if (manifestDigest(staged.manifest) !== manifestDigest(approved)) throw new Error('Build differs from the approved manifest.');
  const state = await localState(config);
  if (approvalStatus(staged.manifest, state) !== 'match') throw new Error('Build has no active approval for this manifest.');
  return { ...staged, state };
}

export async function publishLocal(directory: string, approved: Manifest, config: LocalConfig) {
  await mkdir('.demo', { recursive: true });
  const lock = `.demo/publish-${config.site.container}.lock`;
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Publisher is locked at ${lock}.`);
    throw error;
  }
  try {
    return await publish(directory, approved, config);
  } finally {
    await rmdir(lock);
  }
}

async function publish(directory: string, approved: Manifest, config: LocalConfig) {
  const { manifest, contents, state } = await gate(directory, approved, config);
  const client = localClient();
  const account = getAddress(state.policy.holder);
  const wallet = localWallet(account);
  const container = config.site.container;
  const contract = { address: container, abi: localAbi } as const;

  type Write = { functionName: 'setUploading'; args: [boolean] } |
    { functionName: 'putFile'; args: [Address, string, string, Hex, Hex] } |
    { functionName: 'appendChunk'; args: [Address, string, bigint, Hex] } |
    { functionName: 'removeFile' | 'setFallback'; args: [Address, string] };

  async function send(mutator: Write) {
    const data = encodeFunctionData({ abi: localAbi, ...mutator } as Parameters<typeof encodeFunctionData<typeof localAbi>>[0]);
    const tx = { account, to: container, data };
    const estimate = await client.estimateGas(tx);
    return waitFor(await wallet.sendTransaction({ ...tx, gas: estimate + 12_000n }));
  }

  const blockNumber = state.block.number;
  const count = await client.readContract({ ...contract, functionName: 'pathCount', args: [container], blockNumber });
  if (count > 2_000n) throw new Error('Existing inventory exceeds local publisher limits.');
  const paths = await client.readContract({ ...contract, functionName: 'pathsRange', args: [container, 0n, count], blockNumber });
  if (approvalStatus(manifest, await localState(config)) !== 'match') throw new Error('Approval changed before publishing.');

  const chunk = 12_000; // The fixture uses EVM storage instead of TapeOut's chunk contracts.
  const oversized = manifest.files.find(file => file.bytes > 350 * chunk);
  if (oversized) throw new Error(`File exceeds the local fixture upload limit: ${oversized.path}`);
  await send({ functionName: 'setUploading', args: [true] });
  for (const file of manifest.files) {
    const bytes = contents.get(file.path)!;
    await send({ functionName: 'putFile', args: [container, file.path, file.type, file.sha256, toHex(bytes.subarray(0, chunk))] });
    for (let start = chunk; start < bytes.length; start += chunk) {
      await send({ functionName: 'appendChunk', args: [container, file.path, BigInt(start / chunk), toHex(bytes.subarray(start, start + chunk))] });
    }
  }
  const approvedPaths = new Set(manifest.files.map(file => file.path));
  for (const path of paths) {
    if (!approvedPaths.has(path)) await send({ functionName: 'removeFile', args: [container, path] });
  }
  await send({ functionName: 'setFallback', args: [container, manifest.routing.fallback] });

  const latest = await localState(config);
  const staged = await inspectLocal(config, client, latest.block.number);
  const files = staged.files.flatMap(file => file.status === 'verified' && file.sha256 ? [{ path: file.path, bytes: file.bytes, type: file.type, sha256: file.sha256 }] : []);
  if (approvalStatus(manifest, latest) !== 'match' || staged.block?.hash !== latest.block.hash ||
      staged.fallback === undefined || files.length !== staged.files.length ||
      compare(manifest, { site: config.site, files, routing: { fallback: staged.fallback } }).length) {
    throw new Error('The staged deployment differs or approval changed. The upload is still marked incomplete.');
  }
  return send({ functionName: 'setUploading', args: [false] });
}
