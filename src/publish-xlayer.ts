import { encodeFunctionData, type Address, type Hex } from 'viem';
import { address, artifactDigest, manifestDigest, type Manifest } from './core/manifest';
import { authorityAbi, publicationWrites, requireXLayerGate, xLayerOutcome, type XLayerApproval } from './core/xlayer-release';
import { type Inspection } from './core/tapeout';

export type XLayerSnapshot = { inspection: Inspection; approval?: XLayerApproval };
export type XLayerTransaction = { to: Address; data: Hex };
export type XLayerSender = (tx: XLayerTransaction, governor: Address) => Promise<bigint>;

export async function publishXLayer(
  staged: { manifest: Manifest; contents: ReadonlyMap<string, Uint8Array> },
  check: () => Promise<XLayerSnapshot>,
  send: XLayerSender,
) {
  const { manifest } = staged;
  const { inspection, approval } = await check();
  const committed = requireXLayerGate(manifest, inspection, approval);
  if (inspection.activation !== 'active') throw new Error('Activate the TapeOut name before publishing.');
  if (!approval || inspection.fallback === undefined ||
      (inspection.status !== 'complete' && inspection.status !== 'empty' &&
        (inspection.status !== 'partial' || !inspection.files.length))) {
    throw new Error('The existing TapeOut inventory could not be enumerated.');
  }
  // A partial result with a full inventory is recoverable. The staged read before completion is mandatory.
  const writes = publicationWrites(manifest, staged.contents, inspection.files.map(file => file.path));
  const governor = address(approval.policy.holder);
  const to = approval.authority;
  const attempt = approval.publication.attempt + 1n;
  const start = encodeFunctionData({ abi: authorityAbi, functionName: 'beginPublication',
    args: [approval.publication.attempt, committed.sequence, committed.manifestDigest] });
  let height = await send({ to, data: start }, governor);
  for (const callData of writes) {
    const data = encodeFunctionData({ abi: authorityAbi, functionName: 'write', args: [attempt, callData] });
    height = await send({ to, data }, governor);
  }

  async function checkedAfter(block: bigint) {
    for (let retry = 0; retry < 8; retry++) {
      const current = await check();
      if (current.inspection.block && BigInt(current.inspection.block.number) >= block) return current;
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
    throw new Error('The transaction is ahead of the agreed read block. Recheck the deployment shortly.');
  }

  const stage = await checkedAfter(height);
  requireXLayerGate(manifest, stage.inspection, stage.approval);
  if (!stage.approval?.publication.inProgress || stage.approval.publication.attempt !== attempt ||
      !stage.inspection.artifacts || artifactDigest(stage.inspection.artifacts) !== artifactDigest(manifest)) {
    throw new Error('Staged TapeOut bytes or routing differ. Publication remains in progress.');
  }

  const done = encodeFunctionData({ abi: authorityAbi, functionName: 'finishPublication', args: [attempt] });
  const final = await checkedAfter(await send({ to, data: done }, governor));
  if (xLayerOutcome(final.inspection, final.approval) !== 'match' ||
      final.approval?.commitment.approval.manifestDigest !== manifestDigest(manifest)) {
    throw new Error('Publication finished, but a fresh read did not establish the approved match.');
  }
  return final;
}
