import { XLAYER_MAINNET, type Rpc } from '@tapekit/kernel';
import { concatHex, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, getCreate2Address, keccak256, parseAbi, toHex, zeroAddress, type Address, type Hex } from 'viem';
import { registryAbi, siteKey, siteTuple, type Evidence } from './approval';
import { address, artifactDigest, manifestDigest, sameSite, type Manifest, type Site } from './manifest';
import { header, inspectLive, liveRpc, storeAbi, type Inspection } from './tapeout';
import pinned from './generated/tapeout-site-authority.json';

export const CREATE2_PROXY = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
export const CREATE2_PROXY_CODE = '0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3';

export const authorityAbi = parseAbi([
  'function governor() view returns (address)',
  'function registry() view returns (address)',
  'function authority(address processor, uint256 tokenId, address container) view returns (address, uint256)',
  'function publication() view returns (uint256 attempt, uint256 sequence, bytes32 manifestDigest, bool inProgress)',
  'function beginPublication(uint256 expectedAttempt, uint256 sequence, bytes32 manifestDigest)',
  'function write(uint256 attempt, bytes callData)',
  'function finishPublication(uint256 attempt)',
  'function releaseTo(address recipient)',
  'function returnCircuit()',
  'function bind(string name, uint256 months) payable',
]);

export const circuitAbi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)',
]);

export function authorityDeployment(site: Site) {
  if (site.chainId !== XLAYER_MAINNET.chainId) throw new Error('Expected an X Layer site.');
  const salt = siteKey(site);
  const args = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [site.processor, BigInt(site.circuitId)]);
  const init = concatHex([pinned.bytecode as Hex, args]);
  return {
    address: address(getCreate2Address({ from: CREATE2_PROXY, salt, bytecode: init })),
    transaction: { to: CREATE2_PROXY as Address, data: concatHex([salt, init]) },
  };
}

async function callsAt(rpc: Rpc, hash: Hex, calls: { to: Address; data: Hex }[]) {
  const results = await rpc.many(calls.map(call => ({
    method: 'eth_call', params: [call, { blockHash: hash, requireCanonical: true }],
  })));
  return results.map(result => {
    if (!('ok' in result)) throw new Error('Approval state call reverted at the pinned block.');
    return result.value as Hex;
  });
}

export async function xLayerAuthoritySetup(inspection: Inspection, rpc: Rpc) {
  if (!inspection.site || !inspection.block || inspection.status === 'unavailable' || !inspection.registry) {
    throw new Error('Resolve an opened TapeOut site before onboarding.');
  }
  const deployment = authorityDeployment(inspection.site);
  const tag = { blockHash: inspection.block.hash, requireCanonical: true };
  const [deployerCode, authorityCode] = await rpc.many([CREATE2_PROXY, deployment.address].map(contract => ({
    method: 'eth_getCode', params: [contract, tag],
  })));
  if (!('ok' in deployerCode) || deployerCode.value.toLowerCase() !== CREATE2_PROXY_CODE || !('ok' in authorityCode)) {
    throw new Error('Unrecognized X Layer deployment proxy.');
  }
  const deployed = authorityCode.value !== '0x';
  if (deployed && keccak256(authorityCode.value as Hex) !== pinned.runtimeHash) throw new Error('Unrecognized X Layer authority runtime.');
  const registry = deployed ? decodeFunctionResult({ abi: authorityAbi, functionName: 'registry',
    data: (await callsAt(rpc, inspection.block.hash, [{ to: deployment.address,
      data: encodeFunctionData({ abi: authorityAbi, functionName: 'registry' }) }]))[0],
  }) : zeroAddress;
  return { ...deployment, deployed, registry: registry === zeroAddress ? undefined : address(registry) };
}

export async function xLayerApproval(inspection: Inspection, rpc: Rpc) {
  const { block, site, holder } = inspection;
  if (!block?.timestamp || !site || site.chainId !== 196 || !holder || inspection.status === 'unavailable' || !inspection.registry) return undefined;
  const expected = authorityDeployment(site).address;
  if (holder.toLowerCase() !== expected) return undefined;

  const { registry } = await xLayerAuthoritySetup(inspection, rpc);
  if (!registry) throw new Error('The site custody has no recognized enrollment.');

  const [publicationValue, governorValue] = await callsAt(rpc, block.hash, [
    { to: expected, data: encodeFunctionData({ abi: authorityAbi, functionName: 'publication' }) },
    { to: expected, data: encodeFunctionData({ abi: authorityAbi, functionName: 'governor' }) },
  ]);
  const governor = address(decodeFunctionResult({ abi: authorityAbi, functionName: 'governor', data: governorValue }));
  const [attempt, sequence, digest, inProgress] = decodeFunctionResult({ abi: authorityAbi, functionName: 'publication', data: publicationValue });
  const [statusValue, saltValue, sourceValue] = await callsAt(rpc, block.hash, [
    { to: registry, data: encodeFunctionData({ abi: registryAbi, functionName: 'status', args: [siteTuple(site)] }) },
    { to: registry, data: encodeFunctionData({ abi: registryAbi, functionName: 'instanceSalt' }) },
    { to: registry, data: encodeFunctionData({ abi: registryAbi, functionName: 'authoritySource' }) },
  ]);
  const [policy, commitment, authorityCurrent] = decodeFunctionResult({ abi: registryAbi, functionName: 'status', data: statusValue });
  const instanceSalt = decodeFunctionResult({ abi: registryAbi, functionName: 'instanceSalt', data: saltValue });
  if (address(decodeFunctionResult({ abi: registryAbi, functionName: 'authoritySource', data: sourceValue })) !== expected) {
    throw new Error('The registry is bound to a different authority.');
  }
  const after = await header(toHex(BigInt(block.number)), rpc);
  if (after.hash !== block.hash) throw new Error('Pinned block changed during approval verification.');
  return {
    authority: expected, registry, governor, instanceSalt, policy, commitment, authorityCurrent,
    block: { hash: block.hash, number: BigInt(block.number), timestamp: BigInt(block.timestamp) },
    publication: { attempt, sequence, manifestDigest: digest, inProgress },
  };
}

export type XLayerApproval = NonNullable<Awaited<ReturnType<typeof xLayerApproval>>>;

export function xLayerCommitmentStatus(approval: XLayerApproval, site: Site) {
  const { policy, commitment, block, authorityCurrent } = approval;
  if (!authorityCurrent || !policy.version || commitment.approval.siteKey !== siteKey(site) ||
      commitment.approval.policyVersion !== policy.version || commitment.approval.schemaVersion !== 1n ||
      commitment.signers.length < policy.threshold) return 'none';
  if (commitment.revoked || commitment.approval.expiry <= block.timestamp) return 'revoked';
  return 'active';
}

export function xLayerOutcome(inspection: Inspection, approval?: XLayerApproval): 'unavailable' | 'none' | 'revoked' | 'differs' | 'match' {
  if (!inspection.site || !approval || inspection.block?.hash !== approval.block.hash) return 'unavailable';
  const status = xLayerCommitmentStatus(approval, inspection.site);
  if (status !== 'active') return status;
  if (!inspection.artifacts || inspection.status !== 'complete' || approval.publication.inProgress) return 'unavailable';
  if (artifactDigest(inspection.artifacts) !== approval.commitment.approval.artifactDigest) return 'differs';
  return inspection.activation === 'active' &&
    approval.publication.sequence === approval.commitment.approval.sequence &&
    approval.publication.manifestDigest === approval.commitment.approval.manifestDigest ? 'match' : 'unavailable';
}

export async function checkXLayer(identifier: string, rpc = liveRpc()) {
  const inspection = await inspectLive(identifier, rpc);
  try {
    const approval = await xLayerApproval(inspection, rpc);
    return { inspection, approval, outcome: xLayerOutcome(inspection, approval) };
  } catch (error) {
    return { inspection, approval: undefined, outcome: 'unavailable' as const, reason: (error as Error).message };
  }
}

export function assertXLayerRequest(approval: XLayerApproval, site: Site, evidence: Evidence) {
  if (!sameSite(evidence.manifest.site, site) || evidence.registry !== approval.registry ||
      evidence.instanceSalt !== approval.instanceSalt || !approval.authorityCurrent ||
      BigInt(evidence.policyVersion) !== approval.policy.version ||
      BigInt(evidence.sequence) !== approval.commitment.approval.sequence + 1n ||
      BigInt(evidence.expiry) <= approval.block.timestamp) {
    throw new Error('The request is stale or belongs to another site, policy or registry.');
  }
}

export async function xLayerRequest(approval: XLayerApproval, site: Site, manifest: Manifest, rollback: boolean, rpc: Rpc): Promise<Evidence> {
  const request: Evidence = { manifest, registry: approval.registry, instanceSalt: approval.instanceSalt,
    policyVersion: Number(approval.policy.version), sequence: Number(approval.commitment.approval.sequence) + 1,
    expiry: Number(approval.block.timestamp) + 86_400, rollback, signatures: [] };
  assertXLayerRequest(approval, site, request);
  const [result] = await callsAt(rpc, approval.block.hash, [{ to: approval.registry, data: encodeFunctionData({
    abi: registryAbi, functionName: 'seenArtifact', args: [siteKey(manifest.site), artifactDigest(manifest)],
  }) }]);
  if (decodeFunctionResult({ abi: registryAbi, functionName: 'seenArtifact', data: result }) !== rollback) {
    throw new Error(rollback ? 'Rollback requires a previously approved artifact.' : 'Select rollback to re-approve a previously approved artifact.');
  }
  return request;
}

export function requireXLayerGate(manifest: Manifest, inspection: Inspection, approval?: XLayerApproval) {
  if (!approval || !inspection.site || !sameSite(manifest.site, inspection.site) ||
      inspection.block?.hash !== approval.block.hash ||
      xLayerCommitmentStatus(approval, manifest.site) !== 'active' ||
      approval.commitment.approval.manifestDigest !== manifestDigest(manifest) ||
      approval.commitment.approval.artifactDigest !== artifactDigest(manifest)) {
    throw new Error('The exact build has no active X Layer approval under the enrolled site authority.');
  }
  return approval.commitment.approval;
}

export function publicationWrites(manifest: Manifest, contents: ReadonlyMap<string, Uint8Array>, previous: readonly string[]) {
  const container = manifest.site.container;
  const calls: Hex[] = [];
  const chunkSize = 24_000;
  for (const file of manifest.files) {
    const bytes = contents.get(file.path);
    if (!bytes?.length) throw new Error(`TapeOut publication requires a nonempty file: ${file.path}`);
    calls.push(encodeFunctionData({ abi: storeAbi, functionName: 'putFile',
      args: [container, file.path, file.type, file.sha256, toHex(bytes.subarray(0, chunkSize))] }));
    for (let offset = chunkSize; offset < bytes.length; offset += chunkSize) {
      calls.push(encodeFunctionData({ abi: storeAbi, functionName: 'appendChunk',
        args: [container, file.path, BigInt(offset / chunkSize), toHex(bytes.subarray(offset, offset + chunkSize))] }));
    }
  }
  const paths = new Set(manifest.files.map(file => file.path));
  for (const path of previous) {
    if (!paths.has(path)) calls.push(encodeFunctionData({ abi: storeAbi, functionName: 'removeFile', args: [container, path] }));
  }
  calls.push(encodeFunctionData({ abi: storeAbi, functionName: 'setFallback', args: [container, manifest.routing.fallback] }));
  return calls;
}
