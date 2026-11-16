import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRpc, XLAYER_MAINNET } from '@tapekit/kernel';
import { createPublicClient, createWalletClient, encodeFunctionData, getAddress, http, parseAbi, parseEventLogs, toHex, type Abi, type Address, type Hex } from 'viem';
import { xLayer } from 'viem/chains';
import { approvalTypedData, registryAbi, signaturesFor, siteTuple, type Evidence } from '../src/core/approval';
import { readBuild } from '../src/core/build';
import { address, manifestDigest, type Site } from '../src/core/manifest';
import { inspectTapeOut, storeAbi } from '../src/core/tapeout';
import { authorityAbi, authorityDeployment, circuitAbi, requireXLayerGate, xLayerApproval, xLayerOutcome } from '../src/core/xlayer-release';
import { publishXLayer } from '../src/publish-xlayer';

const endpoint = 'http://127.0.0.1:8561';
const client = createPublicClient({ chain: xLayer, transport: http(endpoint, { timeout: 30_000 }) });
const rpc = createRpc({ urls: [endpoint], quorum: 1, strictQuorum: 1, shuffle: false, timeoutMs: 30_000 });
const { opener, registries: [store], binding } = XLAYER_MAINNET;
const processorIndex = 0n;
const processor = '0x839bdd6fa7a66416a609a735e11de5411b98574e';
const reference = '0x02839bdd6fa7a66416a609a735e11de5411b98574e00000000000000010201000002000003';
const tapeoutAbi = parseAbi(['function tapeout(bytes netlist, uint32 nIn, uint32 nOut) payable returns (uint256)',
  'function TAPEOUT_FEE() view returns (uint256)', 'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)']);
const openerAbi = parseAbi(['function FEE() view returns (uint256)', 'function open(address processor, uint256 tokenId) payable returns (address)',
  'function accountOf(address processor, uint256 tokenId) view returns (address)']);
const bindingAbi = parseAbi(['function monthlyFee() view returns (uint256)']);
const transferAbi = parseAbi(['function transferFrom(address from, address to, uint256 tokenId)']);
const operatorAbi = parseAbi(['function setOperator(address container, address operator, uint256 ttl)']);

const wallet = (account?: Address) => createWalletClient({ account: account && getAddress(account), chain: xLayer, transport: http(endpoint, { timeout: 30_000 }) });
async function forkInfo() {
  const reply = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'anvil_nodeInfo', params: [] }) });
  const { result } = await reply.json() as { result?: { forkConfig?: { forkUrl?: string; forkBlockNumber?: number } } };
  const fork = result?.forkConfig;
  if (!fork?.forkBlockNumber || !fork.forkUrl || !XLAYER_MAINNET.rpcs.includes(fork.forkUrl) || await client.getChainId() !== 196) {
    throw new Error('Expected a loopback Anvil fork of X Layer mainnet on port 8561.');
  }
  return fork.forkBlockNumber;
}

async function send(account: Address, to: Address, data: Hex, value?: bigint) {
  const tx = { account: getAddress(account), to, data, value };
  const base = await client.estimateGas(tx);
  const receipt = await client.waitForTransactionReceipt({ hash: await wallet(account).sendTransaction({ ...tx, gas: base + 25_000n }), timeout: 60_000 });
  assert.equal(receipt.status, 'success', receipt.transactionHash);
  return receipt;
}

async function main() {
  const forkFromBlock = await forkInfo();
  console.log('X Layer mainnet fork block', forkFromBlock, '· simulated transactions only');
  const [owner, first, second, third, buyer] = await wallet().getAddresses();
  assert.ok(buyer);
  const ownerAddress = getAddress(owner);
  const call = (to: Address, abi: Abi, functionName: string, args: readonly unknown[], value?: bigint, account = owner) =>
    send(account, to, encodeFunctionData({ abi, functionName, args }), value);
  // A pure REF to CPU #0, circuit #1 requires no transistor mint. The app gets a new NFT and container.
  const tapeoutFee = await client.readContract({ address: processor, abi: tapeoutAbi, functionName: 'TAPEOUT_FEE' });
  const minted = await call(processor, tapeoutAbi, 'tapeout', [reference, 2, 1], tapeoutFee);
  const [{ args: { tokenId } }] = parseEventLogs({ logs: minted.logs, abi: tapeoutAbi, eventName: 'Transfer' });
  const [container, openFee] = await Promise.all([
    client.readContract({ address: opener, abi: openerAbi, functionName: 'accountOf', args: [processor, tokenId] }),
    client.readContract({ address: opener, abi: openerAbi, functionName: 'FEE' }),
  ]);
  await call(opener, openerAbi, 'open', [processor, tokenId], openFee);
  await call(store, operatorAbi, 'setOperator', [container, buyer, 86_400n]);
  const site: Site = { chainId: 196, processor: address(processor), circuitId: tokenId.toString(), container: address(container) };
  const name = `${tokenId}.2.${processorIndex}.tape`;
  const deployment = authorityDeployment(site);
  const deployReceipt = await send(owner, deployment.transaction.to, deployment.transaction.data);
  const salt = toHex(randomBytes(32));
  const enrolled = await call(processor, circuitAbi, 'safeTransferFrom', [owner, deployment.address, tokenId, salt]);
  assert.equal(address(await client.readContract({ address: processor, abi: circuitAbi, functionName: 'ownerOf', args: [tokenId] })), deployment.address);
  const monthlyFee = await client.readContract({ address: binding, abi: bindingAbi, functionName: 'monthlyFee' });
  await call(deployment.address, authorityAbi, 'bind', [name, 1n], monthlyFee);
  console.log('Minted, opened, enrolled and activated:', name);

  async function check() {
    const { number } = await client.getBlock();
    const inspection = await inspectTapeOut(name, rpc, { source: 'fork', block: toHex(number) });
    const approval = await xLayerApproval(inspection, rpc);
    if (inspection.status === 'unavailable') throw new Error(inspection.detail);
    return { inspection, approval };
  }
  const registered = await check();
  const registry = registered.approval?.registry;
  assert.ok(registry);
  assert.equal(registered.inspection.activation, 'active');
  assert.equal(xLayerOutcome(registered.inspection, registered.approval), 'none');
  const staged = await readBuild('demo/release-a', { site, release: 'fork-checkout-a', fallback: 'index.html' });
  const { manifest } = staged;
  assert.throws(() => requireXLayerGate(manifest, registered.inspection, registered.approval));
  const reviewers = [first, second, third].map(address).sort();
  await call(registry, registryAbi, 'setPolicy', [siteTuple(site), reviewers, 2n]);
  const policy = (await check()).approval!;
  const request: Evidence = { manifest, registry, instanceSalt: policy.instanceSalt, policyVersion: 1, sequence: 1,
    expiry: Number(policy.block.timestamp) + 3_600, rollback: false, signatures: [] };
  const typed = approvalTypedData(request);
  request.signatures = await Promise.all([first, second].map(account => wallet(account).signTypedData({ account: getAddress(account), ...typed })));
  const signatures = await signaturesFor(request, policy.policy);
  const recorded = await call(registry, registryAbi, 'record', [siteTuple(site), typed.message, signatures.map(([, signature]) => signature)]);
  const approved = await check();
  assert.equal(approved.approval?.commitment.signers.length, 2);
  assert.equal(xLayerOutcome(approved.inspection, approved.approval), 'unavailable');

  const stagedB = await readBuild('demo/release-b', { site, release: 'fork-checkout-b', fallback: 'index.html' });
  assert.throws(() => requireXLayerGate(stagedB.manifest, approved.inspection, approved.approval));
  const directWrite = encodeFunctionData({ abi: storeAbi, functionName: 'putFile', args: [container, 'bad.txt', 'text/plain', toHex(0, { size: 32 }), '0x61'] });
  await assert.rejects(client.estimateGas({ account: ownerAddress, to: store, data: directWrite }));
  await assert.rejects(client.estimateGas({ account: buyer, to: store, data: directWrite }));

  const published = await publishXLayer(staged, check, async (tx, governor) => {
    assert.equal(governor, address(owner));
    const receipt = await send(owner, tx.to, tx.data);
    return receipt.blockNumber;
  });
  assert.equal(xLayerOutcome(published.inspection, published.approval), 'match');
  console.log('Approved and published; both files match at block', published.inspection.block?.number);

  const current = published.approval!;
  await call(deployment.address, authorityAbi, 'beginPublication', [current.publication.attempt, 1n, manifestDigest(manifest)]);
  const partial = await check();
  assert.equal(partial.inspection.status, 'complete');
  assert.equal(xLayerOutcome(partial.inspection, partial.approval), 'unavailable');
  const changed = stagedB.manifest.files.find(file => file.path === 'payment.json')!;
  const changedBytes = stagedB.contents.get(changed.path)!;
  const bypass = encodeFunctionData({ abi: storeAbi, functionName: 'putFile',
    args: [container, changed.path, changed.type, changed.sha256, toHex(changedBytes)] });
  await call(deployment.address, authorityAbi, 'write', [current.publication.attempt + 1n, bypass]);
  await call(deployment.address, authorityAbi, 'finishPublication', [current.publication.attempt + 1n]);
  const divergent = await check();
  assert.equal(divergent.inspection.status, 'complete');
  assert.equal(xLayerOutcome(divergent.inspection, divergent.approval), 'differs');
  console.log('Detected divergent bytes with valid TapeOut SHA-256 declarations.');

  const released = await call(deployment.address, authorityAbi, 'releaseTo', [buyer]);
  assert.equal(address(await client.readContract({ address: processor, abi: circuitAbi, functionName: 'ownerOf', args: [tokenId] })), address(buyer));
  assert.equal((await check()).approval, undefined);
  await call(processor, transferAbi, 'transferFrom', [buyer, owner, tokenId], undefined, buyer);
  const returned = await call(processor, circuitAbi, 'safeTransferFrom', [owner, deployment.address, tokenId, '0x']);
  const back = await check();
  assert.equal(back.approval?.authorityCurrent, false);
  assert.equal(xLayerOutcome(back.inspection, back.approval), 'none');
  await call(registry, registryAbi, 'setPolicy', [siteTuple(site), reviewers, 2n]);
  const rotated = await check();
  assert.equal(rotated.approval?.policy.version, 2n);
  assert.equal(xLayerOutcome(rotated.inspection, rotated.approval), 'none');
  assert.equal(rotated.approval?.governor, address(owner));
  await assert.rejects(client.estimateGas({ account: buyer, to: deployment.address,
    data: encodeFunctionData({ abi: authorityAbi, functionName: 'returnCircuit' }) }));
  const returnReceipt = await call(deployment.address, authorityAbi, 'returnCircuit', []);
  assert.equal(address(await client.readContract({ address: processor, abi: circuitAbi, functionName: 'ownerOf', args: [tokenId] })), address(owner));
  assert.equal((await check()).approval, undefined);
  console.log('The recorded depositor recovered its circuit; an unrelated wallet could not withdraw.');

  console.log(JSON.stringify({
    source: 'anvil-xlayer-fork', forkFromBlock, name, site, authority: deployment.address, registry,
    deployment: deployReceipt.transactionHash, enrollment: enrolled.transactionHash, approval: recorded.transactionHash,
    checked: published.inspection.block, verifiedFiles: published.inspection.files.map(file => file.path), directOperatorRejected: true, divergentWriteDetected: true,
    ownershipExit: released.transactionHash, reenrollment: returned.transactionHash, returnToDepositor: returnReceipt.transactionHash, previousApprovalInvalidated: true,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
