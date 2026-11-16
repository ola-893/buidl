import {
  encodeAbiParameters, keccak256, parseAbi, recoverTypedDataAddress, type Address, type Hex,
} from 'viem';
import { address, artifactDigest, digest, manifestDigest, object, parseManifest, uint, type Manifest, type Site } from './manifest';

export const registryAbi = parseAbi([
  'struct Site { address processor; uint256 circuitId; address container; }',
  'struct Policy { address holder; uint256 epoch; uint256 version; uint256 threshold; address[] reviewers; }',
  'struct ReleaseApproval { bytes32 siteKey; uint256 policyVersion; uint256 sequence; uint256 expiry; uint256 schemaVersion; bytes32 manifestDigest; bytes32 artifactDigest; bool rollback; }',
  'struct Commitment { ReleaseApproval approval; bool revoked; address[] signers; }',
  'function instanceSalt() view returns (bytes32)',
  'function authoritySource() view returns (address)',
  'function status(Site site) view returns (Policy policy, Commitment commitment, bool authorityCurrent)',
  'function seenArtifact(bytes32 siteKey, bytes32 artifactDigest) view returns (bool)',
  'function setPolicy(Site site, address[] reviewers, uint256 threshold)',
  'function record(Site site, ReleaseApproval approval, bytes[] signatures)',
  'function revoke(Site site, uint256 sequence)',
  'event PolicySet(bytes32 indexed siteKey, uint256 version, address holder, uint256 epoch, uint256 threshold, address[] reviewers)',
  'event ReleaseRecorded(bytes32 indexed siteKey, uint256 indexed sequence, bytes32 manifestDigest, bytes32 artifactDigest, uint256 policyVersion, uint256 expiry, bool rollback, address[] signers)',
  'event ReleaseRevoked(bytes32 indexed siteKey, uint256 indexed sequence)',
]);

export type ApprovalRequest = {
  manifest: Manifest; registry: Address; instanceSalt: Hex; policyVersion: number; sequence: number; expiry: number; rollback: boolean;
};
export type Evidence = ApprovalRequest & { signatures: Hex[] };
export type Policy = { holder: Address; epoch: bigint; version: bigint; threshold: bigint; reviewers: readonly Address[] };
export const siteTuple = (site: Site) => ({ processor: site.processor, circuitId: BigInt(site.circuitId), container: site.container });
export function siteKey(site: Site) {
  return keccak256(encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }],
    [BigInt(site.chainId), site.processor, BigInt(site.circuitId), site.container],
  ));
}

export function parseEvidence(value: unknown): Evidence {
  const input = object(value, ['manifest', 'registry', 'instanceSalt', 'policyVersion', 'sequence', 'expiry', 'rollback', 'signatures'], 'approval evidence');
  if (typeof input.rollback !== 'boolean') throw new Error('Invalid rollback intent');
  if (!Array.isArray(input.signatures) || input.signatures.length > 31) throw new Error('Invalid signature list');
  const signatures = input.signatures.map(signature => {
    if (typeof signature !== 'string' || !/^0x[\da-f]{130}$/i.test(signature)) throw new Error('Invalid signature bytes');
    return signature.toLowerCase() as Hex;
  });
  return {
    manifest: parseManifest(input.manifest), registry: address(input.registry), instanceSalt: digest(input.instanceSalt),
    policyVersion: uint(input.policyVersion, 1), sequence: uint(input.sequence, 1), expiry: uint(input.expiry, 1), rollback: input.rollback,
    signatures,
  };
}

export function approvalTypedData(request: ApprovalRequest) {
  return {
    domain: {
      name: 'buidl', version: '1', chainId: request.manifest.site.chainId,
      verifyingContract: request.registry, salt: request.instanceSalt,
    },
    types: {
      ReleaseApproval: [
        { name: 'siteKey', type: 'bytes32' },
        { name: 'policyVersion', type: 'uint256' },
        { name: 'sequence', type: 'uint256' },
        { name: 'expiry', type: 'uint256' },
        { name: 'schemaVersion', type: 'uint256' },
        { name: 'manifestDigest', type: 'bytes32' },
        { name: 'artifactDigest', type: 'bytes32' },
        { name: 'rollback', type: 'bool' },
      ],
    } as const,
    primaryType: 'ReleaseApproval' as const,
    message: {
      siteKey: siteKey(request.manifest.site), policyVersion: BigInt(request.policyVersion), sequence: BigInt(request.sequence),
      expiry: BigInt(request.expiry), schemaVersion: BigInt(request.manifest.schemaVersion), manifestDigest: manifestDigest(request.manifest),
      artifactDigest: artifactDigest(request.manifest), rollback: request.rollback,
    },
  };
}

export async function signaturesFor(evidence: Evidence, policy: Policy, requireThreshold = true) {
  if (BigInt(evidence.policyVersion) !== policy.version) throw new Error('Approval uses an inactive policy version.');
  const signers = new Map<Address, Hex>();
  const typedData = approvalTypedData(evidence);
  const halfOrder = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
  for (const signature of evidence.signatures) {
    if (!/^0x[\da-f]{128}(1b|1c)$/i.test(signature) || BigInt(`0x${signature.slice(66, 130)}`) > halfOrder) throw new Error('Invalid signature.');
    const signer = address(await recoverTypedDataAddress({ ...typedData, signature }));
    if (!policy.reviewers.some(reviewer => reviewer.toLowerCase() === signer) || signer === policy.holder.toLowerCase()) throw new Error('Unauthorized reviewer signature.');
    if (signers.has(signer)) throw new Error('Duplicate reviewer signature.');
    signers.set(signer, signature);
  }
  if (requireThreshold && signers.size < Number(policy.threshold)) throw new Error(`Approval threshold not met (${signers.size}/${policy.threshold}).`);
  return [...signers].sort(([a], [b]) => a < b ? -1 : 1);
}
