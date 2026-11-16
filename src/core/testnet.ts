import {
  createPublicClient, defineChain, encodeDeployData, encodeFunctionData, getContractAddress, getCreateAddress,
  fallback, http, keccak256, parseAbi, toHex, zeroAddress, type Abi, type Address, type Hex, type PublicClient, type Transport,
} from 'viem';
import { registryAbi, siteKey, siteTuple, type Evidence } from './approval';
import { address, artifactDigest, compare, digest, manifestDigest, object, parseManifest, sameSite, type Manifest, type Site } from './manifest';
import { readInventory, storeAbi, unavailable, type Inspection } from './tapeout';
import { compareCommitment, type LocalState } from './local';
import fixtureArtifact from './generated/TestnetDeweb.json';
import authorityArtifact from './generated/TestnetAuthority.json';

export const TESTNET_ID = 1952;
export const TESTNET_RPCS = ['https://testrpc.xlayer.tech/terigon', 'https://xlayertestrpc.okx.com/terigon'] as const;
export const testnet = defineChain({
  id: TESTNET_ID, name: 'X Layer testnet',
  nativeCurrency: { name: 'Test OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: { default: { http: TESTNET_RPCS } },
  blockExplorers: { default: { name: 'X Layer testnet explorer', url: 'https://www.okx.com/web3/explorer/xlayer-test' } },
  testnet: true,
});
export type TestnetClient = PublicClient<Transport, typeof testnet>;
export const testnetClient = (): TestnetClient => createPublicClient({ chain: testnet,
  transport: fallback(TESTNET_RPCS.map(url => http(url, { timeout: 10_000, retryCount: 0 })), { retryCount: 0 }) });
export const fixtureAbi = [...storeAbi, ...parseAbi([
  'function holder() view returns(address)',
  'function uploading() view returns(bool)',
  'function epoch() view returns(uint256)',
  'function ownerOf(uint256 tokenId) view returns(address)',
  'function transfer(address next)',
  'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)',
])] as const;
export const testnetAuthorityAbi = parseAbi([
  'function fixture() view returns(address)', 'function registry() view returns(address)', 'function governor() view returns(address)',
  'function epoch() view returns(uint256)', 'function attempt() view returns(uint256)', 'function sequence() view returns(uint256)',
  'function manifestDigest() view returns(bytes32)', 'function inProgress() view returns(bool)',
  'function returnCircuit()', 'function beginPublication(uint256 expectedAttempt,uint256 sequence,bytes32 manifestDigest)',
  'function write(uint256 attempt,bytes callData)', 'function finishPublication(uint256 attempt)',
]);
export type TestnetConfig = { kind: 'testnet-fixtures'; chainId: 1952; fixture: Address; authority: Address };
export type PlannedTx = { label: string; from: Address; to?: Address; creates?: Address; data: Hex; nonce?: number; gas: string; gasPrice: string; estimatedWei: string };

export function parseTestnetConfig(value: unknown): TestnetConfig {
  const parsed = object(value, ['kind', 'chainId', 'fixture', 'authority'], 'testnet configuration');
  if (parsed.chainId !== TESTNET_ID || parsed.kind !== 'testnet-fixtures') throw new Error('This command requires X Layer testnet fixture configuration, chain 1952.');
  return { kind: 'testnet-fixtures', chainId: TESTNET_ID, fixture: address(parsed.fixture), authority: address(parsed.authority) };
}
export function testnetSite(config: TestnetConfig): Site {
  parseTestnetConfig(config);
  return { chainId: TESTNET_ID, processor: config.fixture, circuitId: '1', container: config.fixture };
}
export async function assertTestnet(client: TestnetClient) {
  if (await client.getChainId() !== TESTNET_ID) throw new Error('Wrong network. This operation requires X Layer testnet 1952.');
}

export async function estimateTestnet(from: Address, data: Hex, to?: Address, client = testnetClient()): Promise<PlannedTx> {
  await assertTestnet(client);
  const [gas, gasPrice] = await Promise.all([client.estimateGas({ account: from, to, data }), client.getGasPrice()]);
  const gasLimit = gas + gas / 5n + 10_000n;
  return { label: to ? 'Contract transaction' : 'Contract deployment', from, to, data,
    gas: gasLimit.toString(), gasPrice: gasPrice.toString(), estimatedWei: (gasLimit * gasPrice).toString() };
}

export async function planTestnet(owner: Address, client = testnetClient()) {
  await assertTestnet(client);
  const nonce = await client.getTransactionCount({ address: owner, blockTag: 'pending' });
  const fixture = address(getContractAddress({ from: owner, nonce: BigInt(nonce) }));
  const authority = address(getContractAddress({ from: owner, nonce: BigInt(nonce + 1) }));
  const fixtureData = encodeDeployData({ abi: fixtureArtifact.abi as Abi, bytecode: fixtureArtifact.bytecode as Hex });
  const authorityData = encodeDeployData({ abi: authorityArtifact.abi as Abi, bytecode: authorityArtifact.bytecode as Hex, args: [fixture] });
  const [first, second, balance] = await Promise.all([
    estimateTestnet(owner, fixtureData, undefined, client), estimateTestnet(owner, authorityData, undefined, client),
    client.getBalance({ address: owner }),
  ]);
  return {
    config: { kind: 'testnet-fixtures' as const, chainId: TESTNET_ID as 1952, fixture, authority },
    balanceWei: balance.toString(),
    transactions: [{ ...first, label: 'Deploy simulated DeWEB circuit and store', nonce, creates: fixture },
      { ...second, label: 'Deploy test custody authority', nonce: nonce + 1, creates: authority }],
    maximumAtQuotedGasPriceWei: (BigInt(first.estimatedWei) + BigInt(second.estimatedWei)).toString(),
  };
}

export async function planTestnetAuthority(owner: Address, fixture: Address, client = testnetClient()) {
  await assertTestnet(client);
  const block = await client.getBlockNumber();
  const [code, holder, nonce, balance] = await Promise.all([
    client.getCode({ address: fixture, blockNumber: block }),
    client.readContract({ address: fixture, abi: fixtureAbi, functionName: 'holder', blockNumber: block }),
    client.getTransactionCount({ address: owner, blockTag: 'pending' }), client.getBalance({ address: owner }),
  ]);
  if (!code || keccak256(code) !== fixtureArtifact.runtimeHash || address(holder) !== address(owner)) {
    throw new Error('Resume requires a recognized simulated circuit still held by the connected deployer.');
  }
  const authority = address(getCreateAddress({ from: owner, nonce: BigInt(nonce) }));
  const data = encodeDeployData({ abi: authorityArtifact.abi as Abi, bytecode: authorityArtifact.bytecode as Hex, args: [fixture] });
  const estimate = await estimateTestnet(owner, data, undefined, client);
  return {
    config: { kind: 'testnet-fixtures' as const, chainId: TESTNET_ID as 1952, fixture, authority },
    balanceWei: balance.toString(), transactions: [{ ...estimate, label: 'Deploy test custody authority', nonce, creates: authority }],
    maximumAtQuotedGasPriceWei: estimate.estimatedWei,
  };
}

export async function testnetSnapshot(config: TestnetConfig, client = testnetClient()) {
  await assertTestnet(client);
  const site = testnetSite(config);
  const block = await client.getBlock();
  const opts = { blockNumber: block.number } as const;
  const [fixtureCode, authorityCode] = await Promise.all([
    client.getCode({ address: config.fixture, ...opts }), client.getCode({ address: config.authority, ...opts }),
  ]);
  if (!fixtureCode || keccak256(fixtureCode) !== fixtureArtifact.runtimeHash ||
      !authorityCode || keccak256(authorityCode) !== authorityArtifact.runtimeHash) throw new Error('Unrecognized test fixture contracts.');
  const base = { address: config.authority, abi: testnetAuthorityAbi, ...opts } as const;
  const [holder, uploading, boundFixture, registry, governor, attempt, inProgress, sequence, publicationDigest] = await Promise.all([
    client.readContract({ address: config.fixture, abi: fixtureAbi, functionName: 'holder', ...opts }),
    client.readContract({ address: config.fixture, abi: fixtureAbi, functionName: 'uploading', ...opts }),
    client.readContract({ ...base, functionName: 'fixture' }), client.readContract({ ...base, functionName: 'registry' }),
    client.readContract({ ...base, functionName: 'governor' }), client.readContract({ ...base, functionName: 'attempt' }),
    client.readContract({ ...base, functionName: 'inProgress' }), client.readContract({ ...base, functionName: 'sequence' }),
    client.readContract({ ...base, functionName: 'manifestDigest' }),
  ]);
  if (address(boundFixture) !== config.fixture) throw new Error('The fixture belongs to a different authority.');
  const inspection = await readInventory({
    ...unavailable('testnet-fixture', 'Simulated testnet checkout', ''), detail: undefined, site, registry: config.fixture,
    holder, activation: 'local', block: { number: block.number.toString(), hash: block.hash, timestamp: block.timestamp.toString() },
  }, toHex(block.number), requests => Promise.all(requests.map(async request => {
    const { to, data } = request.params[0] as { to: Address; data: Hex };
    const response = await client.call({ to, data, ...opts });
    return { ok: true as const, value: response.data ?? '0x' };
  })), uploading || inProgress);
  let approval: LocalState | undefined;
  if (registry !== zeroAddress) {
    if (address(registry) !== address(getCreateAddress({ from: config.authority, nonce: 1n }))) throw new Error('Unexpected fixture registry provenance.');
    const args = { address: registry, abi: registryAbi, ...opts } as const;
    const [[policy, commitment, authorityCurrent], instanceSalt, source] = await Promise.all([
      client.readContract({ ...args, functionName: 'status', args: [siteTuple(site)] }),
      client.readContract({ ...args, functionName: 'instanceSalt' }),
      client.readContract({ ...args, functionName: 'authoritySource' }),
    ]);
    if (address(source) !== config.authority) throw new Error('Wrong test authority.');
    approval = { block, policy, commitment, authorityCurrent, instanceSalt };
  }
  if ((await client.getBlock({ blockNumber: block.number })).hash !== block.hash) throw new Error('Testnet block changed during verification.');
  return { inspection, approval, registry, governor, attempt, inProgress, sequence, publicationDigest };
}
export type TestnetSnapshot = Awaited<ReturnType<typeof testnetSnapshot>>;
export function testnetOutcome(snapshot: TestnetSnapshot) {
  if (!snapshot.approval) return 'none' as const;
  const result = compareCommitment(snapshot.inspection, snapshot.approval);
  if (result !== 'match') return result;
  return snapshot.sequence === snapshot.approval.commitment.approval.sequence &&
    snapshot.publicationDigest === snapshot.approval.commitment.approval.manifestDigest ? 'match' as const : 'unavailable' as const;
}
export function requireTestnetGate(manifest: Manifest, config: TestnetConfig, snapshot: TestnetSnapshot) {
  if (!sameSite(manifest.site, testnetSite(config)) || !snapshot.approval?.authorityCurrent ||
      snapshot.approval.policy.version === 0n ||
      snapshot.approval.commitment.approval.policyVersion !== snapshot.approval.policy.version ||
      snapshot.approval.commitment.revoked || snapshot.approval.commitment.approval.expiry <= snapshot.approval.block.timestamp ||
      snapshot.approval.commitment.approval.manifestDigest !== manifestDigest(manifest) ||
      snapshot.approval.commitment.approval.artifactDigest !== artifactDigest(manifest)) throw new Error('No active testnet approval for the exact build.');
}

export async function testnetRequest(manifest: Manifest, config: TestnetConfig, snapshot: TestnetSnapshot,
  rollback = false, client = testnetClient()): Promise<Evidence> {
  await assertTestnet(client);
  if (!snapshot.approval?.authorityCurrent || !sameSite(manifest.site, testnetSite(config))) throw new Error('Register the testnet fixture policy for this site.');
  const seen = await client.readContract({ address: snapshot.registry, abi: registryAbi, functionName: 'seenArtifact',
    args: [siteKey(manifest.site), artifactDigest(manifest)], blockNumber: snapshot.approval.block.number });
  if (seen !== rollback) throw new Error(seen ? 'This artifact was approved before. Explicitly enable rollback before requesting new signatures.' : 'A new artifact cannot be marked as a rollback.');
  return {
    manifest: parseManifest(manifest), registry: address(snapshot.registry), instanceSalt: digest(snapshot.approval.instanceSalt),
    policyVersion: Number(snapshot.approval.policy.version), sequence: Number(snapshot.approval.commitment.approval.sequence) + 1,
    expiry: Number(snapshot.approval.block.timestamp) + 86_400, rollback, signatures: [],
  };
}
export function assertTestnetRequest(request: Evidence, config: TestnetConfig, snapshot: TestnetSnapshot) {
  if (!sameSite(request.manifest.site, testnetSite(config)) || request.registry !== snapshot.registry.toLowerCase() ||
      !snapshot.approval?.authorityCurrent || request.instanceSalt !== snapshot.approval.instanceSalt ||
      BigInt(request.policyVersion) !== snapshot.approval.policy.version ||
      BigInt(request.sequence) !== snapshot.approval.commitment.approval.sequence + 1n ||
      BigInt(request.expiry) <= snapshot.approval.block.timestamp) throw new Error('Wrong site, network or stale testnet approval request.');
}

export const beginTestnet = (config: TestnetConfig, snapshot: TestnetSnapshot) => {
  const entry = snapshot.approval?.commitment.approval;
  if (!entry) throw new Error('No testnet release commitment.');
  return { to: config.authority, data: encodeFunctionData({ abi: testnetAuthorityAbi, functionName: 'beginPublication',
    args: [snapshot.attempt, entry.sequence, entry.manifestDigest] }) };
};
export const testnetWrite = (config: TestnetConfig, attempt: bigint, data: Hex) => ({
  to: config.authority, data: encodeFunctionData({ abi: testnetAuthorityAbi, functionName: 'write', args: [attempt, data] }),
});
export function compareTestnet(snapshot: TestnetSnapshot, manifest: Manifest) {
  return snapshot.inspection.artifacts ? compare(manifest, snapshot.inspection.artifacts) : [];
}
