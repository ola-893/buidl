import { createPublicClient, http, parseAbi, toHex, type Address, type Hex } from 'viem';
import { foundry } from 'viem/chains';
import { approvalTypedData, registryAbi, siteKey, siteTuple, type Evidence } from './approval';
import { address, artifactDigest, compare, manifestDigest, object, parseSite, type Manifest, type Site } from './manifest';
import { readInventory, storeAbi, unavailable, type Inspection } from './tapeout';

export const LOCAL_RPC = 'http://127.0.0.1:8545';
export const localAbi = [...storeAbi, ...parseAbi([
  'function holder() view returns (address)',
  'function uploading() view returns (bool)',
  'function setUploading(bool active)',
  'function transfer(address next)',
])] as const;

export type LocalConfig = { registry: Address; site: Site };
export const localClient = (url = LOCAL_RPC) => createPublicClient({ chain: foundry, transport: http(url, { retryCount: 0, timeout: 8_000 }) });
export type LocalClient = ReturnType<typeof localClient>;

export function parseLocalConfig(value: unknown): LocalConfig {
  const config = object(value, ['registry', 'site'], 'local configuration');
  const site = parseSite(config.site);
  if (site.chainId !== foundry.id || site.processor !== site.container) throw new Error('Invalid controlled local site');
  return { registry: address(config.registry), site };
}

export async function inspectLocal(config: LocalConfig, client = localClient(), blockNumber?: bigint): Promise<Inspection> {
  const base = { ...unavailable('local', 'Payment demo', 'Verification unavailable.'), site: config.site, registry: config.site.container };
  try {
    if (await client.getChainId() !== foundry.id) throw new Error('Wrong network for local fixture.');
    const header = await client.getBlock({ blockNumber });
    const block = { number: header.number.toString(), hash: header.hash };
    const contract = { address: config.site.container, abi: localAbi, blockNumber: header.number };
    const [holder, uploading] = await Promise.all([
      client.readContract({ ...contract, functionName: 'holder' }),
      client.readContract({ ...contract, functionName: 'uploading' }),
    ]);
    const result = await readInventory({ ...base, block, holder, activation: 'local', detail: undefined }, toHex(header.number),
      requests => Promise.all(requests.map(async request => {
        const { to, data } = request.params[0] as { to: Address; data: Hex };
        const response = await client.call({ to, data, blockNumber: header.number });
        return { ok: true as const, value: response.data ?? '0x' };
      })), uploading);
    if ((await client.getBlock({ blockNumber: header.number })).hash !== header.hash) throw new Error('Local block changed during inspection.');
    return result;
  } catch (error) {
    return { ...base, detail: (error as Error).message };
  }
}

export async function localState(config: LocalConfig, client = localClient(), blockNumber?: bigint) {
  if (await client.getChainId() !== foundry.id) throw new Error('Wrong approval network.');
  const block = await client.getBlock({ blockNumber });
  const registry = { address: config.registry, abi: registryAbi, blockNumber: block.number };
  const [[policy, commitment, authorityCurrent], instanceSalt, authoritySource] = await Promise.all([
    client.readContract({ ...registry, functionName: 'status', args: [siteTuple(config.site)] }),
    client.readContract({ ...registry, functionName: 'instanceSalt' }),
    client.readContract({ ...registry, functionName: 'authoritySource' }),
  ]);
  if (address(authoritySource) !== config.site.container) throw new Error('Unexpected local authority contract.');
  if ((await client.getBlock({ blockNumber: block.number })).hash !== block.hash) throw new Error('Approval registry block changed during verification.');
  return { block, policy, commitment, authorityCurrent, instanceSalt };
}
export type LocalState = Awaited<ReturnType<typeof localState>>;

export async function localHistory(config: LocalConfig, client = localClient(), toBlock: bigint | 'latest' = 'latest') {
  const events = registryAbi.filter(item => item.type === 'event');
  const key = siteKey(config.site).toLowerCase();
  const logs = await client.getLogs({ address: config.registry, events, fromBlock: 0n, toBlock, strict: true });
  return logs.filter(log => log.args.siteKey?.toLowerCase() === key).reverse();
}

export async function newRequest(config: LocalConfig, manifest: Manifest, expiry: number, rollback: boolean, client = localClient()): Promise<Evidence> {
  const state = await localState(config, client);
  if (!state.authorityCurrent || !state.policy.version) throw new Error('The holder must onboard the site with an active approval policy.');
  if (siteKey(config.site) !== siteKey(manifest.site)) throw new Error('Manifest belongs to a different chain or site.');
  const seen = await client.readContract({ address: config.registry, abi: registryAbi, functionName: 'seenArtifact', args: [siteKey(config.site), artifactDigest(manifest)], blockNumber: state.block.number });
  if (seen !== rollback) throw new Error(seen ? 'This artifact was previously approved. Explicitly request a rollback.' : 'Rollback requires a previously approved artifact.');
  if (!Number.isSafeInteger(expiry) || BigInt(expiry) <= state.block.timestamp) throw new Error('Approval expiry must be in the future.');
  return { manifest, registry: config.registry, instanceSalt: state.instanceSalt, policyVersion: Number(state.policy.version),
    sequence: Number(state.commitment.approval.sequence) + 1, expiry, rollback, signatures: [] };
}

export const outcomes = {
  match: 'Matches approved release.',
  differs: 'Deployment differs from approved release.',
  none: 'No qualifying approval.',
  revoked: 'Approval revoked or expired.',
  unavailable: 'Verification unavailable.',
} as const;

export function approvalStatus(manifest: Manifest | undefined, state: LocalState) {
  const { policy, commitment, authorityCurrent, block } = state;
  if (!authorityCurrent || !policy.version || commitment.approval.policyVersion !== policy.version) return 'none';
  if (commitment.revoked || commitment.approval.expiry <= block.timestamp) return 'revoked';
  if (!manifest) return 'unavailable';
  if (commitment.approval.siteKey !== siteKey(manifest.site) ||
      commitment.approval.manifestDigest !== manifestDigest(manifest) ||
      commitment.approval.artifactDigest !== artifactDigest(manifest)) return 'none';
  return 'match';
}

export function compareLocal(inspection: Inspection, state: LocalState, manifest?: Manifest) {
  const approval = approvalStatus(manifest, state);
  if (approval === 'revoked' || approval === 'none') return { outcome: approval, changes: [] } as const;
  if (!inspection.artifacts || !manifest || inspection.block?.hash !== state.block.hash || approval === 'unavailable') return { outcome: 'unavailable', changes: [] } as const;
  const changes = compare(manifest, inspection.artifacts);
  return { outcome: changes.length ? 'differs' : 'match', changes } as const;
}

export function assertCurrentEvidence(config: LocalConfig, evidence: Evidence, state: LocalState) {
  const typed = approvalTypedData(evidence).message;
  if (evidence.registry !== config.registry || evidence.instanceSalt !== state.instanceSalt ||
      siteKey(config.site) !== typed.siteKey) throw new Error('Evidence is for another registry, chain or site.');
  if (typed.policyVersion !== state.policy.version || typed.sequence !== state.commitment.approval.sequence + 1n ||
      !state.authorityCurrent || typed.expiry <= state.block.timestamp) throw new Error('Approval request is stale, expired or unauthorized.');
}
