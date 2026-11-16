import {
  createChainKernel, createRpc, parseInput, rpcOptionsFor, safeContentType, setLocale, XLAYER_MAINNET,
  type Rpc, type RpcRequest,
} from '@tapekit/kernel';
import { decodeAbiParameters, encodeFunctionData, hexToBytes, parseAbi, sha256, type Address, type ContractFunctionReturnType, type Hex } from 'viem';
import { digest, MAX_FILE_BYTES, MAX_FILES, MAX_SITE_BYTES, parseSite, parseManifest, type Artifacts, type FileEntry, type Site } from './manifest';

export const EXAMPLE_SITE = '1.2.230.tape';
export const XLAYER_EXPLORER = 'https://www.oklink.com/x-layer/evm';
export const storeAbi = parseAbi([
  'function pathCount(address container) view returns (uint256)',
  'function pathsRange(address container, uint256 from, uint256 n) view returns (string[])',
  'function fallbackPath(address container) view returns (string)',
  'function fileInfo(address container, string path) view returns (uint32 size, string contentType, bytes32 sha256Hash, uint40 updatedAt, uint256 chunkCount)',
  'function read(address container, string path) view returns (bytes)',
  'function readRange(address container, string path, uint256 offset, uint256 len) view returns (bytes)',
  'function putFile(address container, string path, string contentType, bytes32 sha256Hash, bytes data)',
  'function appendChunk(address container, string path, uint256 expectIndex, bytes data)',
  'function removeFile(address container, string path)',
  'function setFallback(address container, string path)',
]);

export type FileResult = {
  path: string;
  bytes: number;
  type: string;
  declared: Hex;
  sha256?: Hex;
  status: 'verified' | 'incomplete' | 'no-hash' | 'missing' | 'too-large' | 'unavailable';
};

export type Inspection = {
  source: 'live' | 'local' | 'fork' | 'testnet-fixture';
  name: string;
  block?: { number: string; hash: Hex; timestamp?: string };
  site?: Site;
  holder?: Address | null;
  registry?: Address;
  activation?: 'active' | 'inactive' | 'local';
  status: 'complete' | 'partial' | 'empty' | 'unavailable';
  detail?: string;
  files: FileResult[];
  artifacts?: Artifacts;
  fallback?: string;
};

export const unavailable = (source: Inspection['source'], name: string, detail: string): Inspection => ({
  source, name, status: 'unavailable', detail, files: [],
});

export function explicitXLayer(input: string) {
  if (input.length > 256) throw new Error('Site identifier is too long.');
  const id = input.trim();
  const scoped = /^xlayer:/i.test(id);
  const parsed = parseInput(scoped ? id.slice(7) : id);
  if (parsed.path) throw new Error('Enter a site identifier without a file path.');
  if (parsed.kind === 'name' && parsed.area !== 2) throw new Error('Unsupported network. X Layer names use area code 2.');
  if (parsed.kind !== 'name' && !scoped) throw new Error('Ambiguous address. Prefix X Layer addresses with xlayer:.');
  return parsed;
}

type Read = (requests: RpcRequest[]) => ReturnType<Rpc['many']>;
type Call = { data: Hex; process: (data: Hex) => unknown };
type StoreFunction = 'pathCount' | 'pathsRange' | 'fallbackPath' | 'fileInfo' | 'read' | 'readRange';

function storeCall<N extends StoreFunction>(functionName: N, args: ParametersFor<N>) {
  const data = encodeFunctionData({ abi: storeAbi, functionName, args } as Parameters<typeof encodeFunctionData<typeof storeAbi>>[0]);
  const item = storeAbi.find(item => item.name === functionName)!;
  return { data, process: (data: Hex) => (functionName === 'fileInfo' ? decodeAbiParameters(item.outputs, data) : decodeAbiParameters(item.outputs, data)[0]) as ContractFunctionReturnType<typeof storeAbi, 'view', N> };
}

type ParametersFor<N extends StoreFunction> =
  N extends 'pathsRange' ? [Address, bigint, bigint] :
  N extends 'readRange' ? [Address, string, bigint, bigint] :
  N extends 'fileInfo' | 'read' ? [Address, string] : [Address];

export async function readInventory(base: Inspection & { site: Site; registry: Address }, block: Hex, many: Read, uploading = false): Promise<Inspection> {
  const { container } = base.site;
  async function call<T>(item: { data: Hex; process: (data: Hex) => T }): Promise<T> {
    const [result] = await many([{ method: 'eth_call', params: [{ to: base.registry, data: item.data }, block] }]);
    if ((!result || !('ok' in result))) throw new Error('SiteRegistry call reverted at the pinned block.');
    return item.process(result.value as Hex);
  }
  async function batch(items: Call[]) {
    const results = await many(items.map(item => ({ method: 'eth_call', params: [{ to: base.registry, data: item.data }, block] })));
    return results.map((result, i) => 'ok' in result ? items[i].process(result.value as Hex) : null);
  }
  const [count, fallback] = await Promise.all([call(storeCall('pathCount', [container])), call(storeCall('fallbackPath', [container]))]);
  const inventory = { ...base, fallback, status: 'partial' } as Inspection;
  if (count === 0n) return { ...inventory, status: uploading ? 'partial' : 'empty', detail: uploading ? 'Deployment is in progress.' : 'The container has no registered files.' };
  if (count > BigInt(MAX_FILES)) return { ...inventory, detail: `Inventory exceeds the ${MAX_FILES}-file inspection limit.` };
  const pageSize = 100;
  const pages = await batch(Array.from({ length: Math.ceil(Number(count) / pageSize) }, (_, i) => storeCall('pathsRange', [container, BigInt(i * pageSize), BigInt(pageSize)])));
  if (pages.some(page => page === null)) throw new Error('Could not enumerate all SiteRegistry paths.');
  const paths = (pages as string[][]).flat();
  const pathSet = new Set(paths);
  if (paths.length !== Number(count) || pathSet.size !== paths.length) return { ...inventory, detail: 'Incomplete or duplicate SiteRegistry inventory.' };

  const metadata = await batch(paths.map(path => storeCall('fileInfo', [container, path])));
  const infos = metadata as Array<readonly [number, string, Hex, number, bigint] | null>;
  if (infos.reduce((size, info) => size + (info?.[0] ?? 0), 0) > MAX_SITE_BYTES) return { ...inventory, detail: 'Inventory exceeds the 32 MiB inspection limit.' };
  const verified: FileEntry[] = [];
  const range = 98_304;
  for (const [i, path] of paths.entries()) {
    const [bytes, rawType, declared] = infos[i] ?? [0, '', `0x${'0'.repeat(64)}` as Hex];
    inventory.files.push({ path, bytes, type: safeContentType(rawType), declared, status: 'unavailable' });
  }

  for (const [i, entry] of inventory.files.entries()) {
    const info = infos[i];
    if (!info) continue;
    const [bytes, rawType, declared, , chunks] = info;
    const { path } = entry;
    if (!chunks) {
      entry.status = 'missing';
      continue;
    }
    if (bytes > MAX_FILE_BYTES) {
      entry.status = 'too-large';
      continue;
    }

    const reads = bytes <= range ? [storeCall('read', [container, path])] :
      Array.from({ length: Math.ceil(bytes / range) }, (_, part) => storeCall('readRange', [container, path, BigInt(part * range), BigInt(range)]));
    const parts: Uint8Array[] = [];
    let incomplete = false;
    for (let offset = 0; offset < reads.length && !incomplete; offset += 8) {
      const segment = await batch(reads.slice(offset, offset + 8));
      for (const [i, hex] of segment.entries()) {
        const part = typeof hex === 'string' ? hexToBytes(hex as Hex) : null;
        if (!part || part.length !== Math.min(range, bytes - (offset + i) * range)) {
          incomplete = true;
          break;
        }
        parts.push(part);
      }
    }
    if (incomplete) {
      entry.status = 'incomplete';
      continue;
    }
    const content = new Uint8Array(bytes);
    parts.forEach((part, index) => content.set(part, index * range));
    entry.sha256 = sha256(content);
    entry.status = /^0x0{64}$/.test(declared) ? 'no-hash' : entry.sha256 === declared ? 'verified' : 'incomplete';
    if (entry.status === 'verified') verified.push({ path, bytes, type: rawType, sha256: entry.sha256 });
  }
  if (uploading || verified.length !== paths.length) {
    return { ...inventory, detail: uploading ? 'Deployment is in progress.' : 'Some files are missing or could not be verified.' };
  }
  try {
    const { files, routing } = parseManifest({ schemaVersion: 1, release: 'inspection', site: base.site, routing: { fallback }, files: verified });
    if (files.some(f => !pathSet.has(f.path)) || fallback !== routing.fallback) throw new Error('Registry paths must use canonical NFC');
    return { ...inventory, status: 'complete', artifacts: { site: base.site, routing, files } };
  } catch (error) {
    return { ...inventory, detail: 'Release comparison unavailable. ' + String((error as Error).message) };
  }
}

function headerRequest(block: Hex): RpcRequest {
  return {
    method: 'eth_getBlockByNumber', params: [block, false],
    normalize: (response: { number: string; hash: string; timestamp: string }) => {
      if (BigInt(response.number) !== BigInt(block)) throw new Error('Unexpected block number');
      return { number: BigInt(response.number).toString(), hash: digest(response.hash), timestamp: BigInt(response.timestamp).toString() };
    },
  };
}

export async function header(block: Hex, rpc: Rpc): Promise<NonNullable<Inspection['block']>> {
  const [result] = await rpc.many([headerRequest(block)]);
  if ((!result || !('ok' in result)) || !result.raw) throw new Error('Block header unavailable.');
  return result.raw as NonNullable<Inspection['block']>;
}

export function liveRpc(fetchImpl?: typeof fetch) {
  // Use the official RPC operator and provider independently identified by TapeKit.
  const endpoints = ['https://rpc.xlayer.tech', 'https://xlayer.drpc.org'];
  return createRpc({ ...rpcOptionsFor(XLAYER_MAINNET, endpoints), fetchImpl, shuffle: false, timeoutMs: 6_000, retries: 1 });
}

export function inspectLive(input: string, rpc = liveRpc()) {
  return inspectTapeOut(input, rpc, { source: 'live' });
}

export async function inspectTapeOut(input: string, rpc: Rpc, options: { source: 'live' } | { source: 'fork'; block: Hex }): Promise<Inspection> {
  setLocale('en');
  let base = unavailable(options.source, input.trim(), 'Verification unavailable.');
  try {
    const parsed = explicitXLayer(input);
    if (options.source === 'live' && (rpc.operatorCount < 2 || rpc.quorum !== 2)) throw new Error('Two distinct RPC operators are required.');
    const [chain] = await rpc.many([{ method: 'eth_chainId', params: [] }], { all: true });
    if ((!chain || !('ok' in chain)) || BigInt(chain.value) !== 196n) throw new Error('RPC is on the wrong chain.');
    const pin = options.source === 'fork' ? options.block : await rpc.pinBlock();
    if (options.source === 'live' && rpc.pinLag() > BigInt(XLAYER_MAINNET.maxPinLagBlocks ?? 300)) throw new Error('Stale block. RPC heads are too far apart.');
    const pinned = await header(pin, rpc);
    base = { ...base, block: pinned };
    // Both configured providers accept EIP-1898. Bind every state read to the agreed hash.
    const blockTag = { blockHash: pinned.hash, requireCanonical: true };
    const stateReads: Read = requests => rpc.many(requests.map(request => ({
      ...request,
      params: request.params.at(-1) === pin ? [...request.params.slice(0, -1), blockTag] : request.params,
    })));
    const kernel = createChainKernel({ network: XLAYER_MAINNET, rpc: { ...rpc, many: stateReads } });
    const resolved = await kernel.resolve(parsed, { block: pin, fresh: true });
    const site = resolved.circuits && resolved.tokenId && resolved.container ? parseSite({
      chainId: resolved.chainId, processor: resolved.circuits, circuitId: resolved.tokenId.toString(), container: resolved.container,
    }) : undefined;
    base = { ...base, site, name: resolved.name ?? base.name, holder: resolved.holder };
    if ((resolved.status !== 'ok' && resolved.status !== 'unpaid') || !site) {
      return { ...base, detail: resolved.status === 'store-changed' ? 'Unsupported SiteRegistry or DomainBinding implementation.' : `${kernel.statusText(resolved.status)} (${resolved.status})` };
    }
    base.activation = resolved.status === 'ok' ? 'active' : 'inactive';
    base.registry = XLAYER_MAINNET.registries[0];
    const result = await readInventory({ ...base, site, registry: base.registry, detail: undefined }, pin, stateReads);
    if ((await header(pin, rpc)).hash !== base.block?.hash) throw new Error('Pinned block changed during inspection.');
    return result;
  } catch (error) {
    return { ...base, detail: (error as Error).message || 'Could not verify the deployment.' };
  }
}
