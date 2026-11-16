import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { createPublicClient, createWalletClient, custom, encodeFunctionData, getAddress, http, parseAbi, toHex, type Address, type Hex } from 'viem';
import { approvalTypedData, registryAbi, signaturesFor, siteTuple } from '../src/core/approval';
import { readBuild } from '../src/core/build';
import { manifestDigest } from '../src/core/manifest';
import {
  assertTestnet, beginTestnet, fixtureAbi, parseTestnetConfig, planTestnet, planTestnetAuthority, requireTestnetGate, testnet, testnetAuthorityAbi,
  testnetOutcome, testnetRequest, testnetSite, testnetSnapshot, testnetWrite, type TestnetClient,
} from '../src/core/testnet';
import { storeAbi } from '../src/core/tapeout';
import { publishTestnet } from '../src/core/testnet-publish';

test('testnet fixtures exercise custody, approvals, publishing and fail-closed controls', { timeout: 120_000 }, async t => {
  const port = 8547;
  const endpoint = `http://127.0.0.1:${port}`;
  const anvil = spawn('anvil', ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '1952', '--silent'], { stdio: 'ignore' });
  t.after(() => { anvil.kill('SIGTERM'); });
  anvil.on('error', error => { throw error; });
  const client = createPublicClient({ chain: testnet, transport: http(endpoint, { retryCount: 0 }) });
  async function raw(method: string, params: unknown[]) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const json = await response.json() as { result: unknown; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    return json.result;
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if (await client.getChainId() === 1952) break; } catch { /* Wait for this disposable node. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await assertTestnet(client);
  const accounts = await raw('eth_accounts', []) as Address[];
  const [holder, r1, r2, r3, buyer, outsider] = accounts;
  const wallet = (account: Address) => createWalletClient({ account: getAddress(account), chain: testnet, transport: http(endpoint) });
  async function send(to: Address | undefined, data: Hex, account = holder, nonce?: number) {
    const gas = await client.estimateGas({ account, to, data });
    const hash = await wallet(account).sendTransaction({ to, data, nonce, gas: gas + gas / 5n + 10_000n });
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success');
    return receipt;
  }
  const plan = await planTestnet(holder, client);
  await send(plan.transactions[0].to, plan.transactions[0].data, holder, plan.transactions[0].nonce);
  const resumed = await planTestnetAuthority(holder, plan.config.fixture, client);
  assert.deepEqual(resumed.config, plan.config);
  assert.equal(resumed.transactions.length, 1);
  await assert.rejects(planTestnetAuthority(outsider, plan.config.fixture, client), /recognized simulated circuit/);
  await send(resumed.transactions[0].to, resumed.transactions[0].data, holder, resumed.transactions[0].nonce);
  const { config } = plan;
  assert.equal((await testnetSnapshot(config, client)).approval, undefined);
  const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const enrollData = encodeFunctionData({ abi: fixtureAbi, functionName: 'safeTransferFrom',
    args: [holder, config.authority, 1n, salt] });
  await assert.rejects(client.estimateGas({ account: outsider, to: config.fixture, data: enrollData }));
  await send(config.fixture, enrollData);
  const enrolled = await testnetSnapshot(config, client);
  const registry = enrolled.registry;
  const site = testnetSite(config);
  const reviewers = [r1, r2, r3].map(value => value.toLowerCase() as Address).sort();
  const register = encodeFunctionData({ abi: registryAbi, functionName: 'setPolicy', args: [siteTuple(site), reviewers, 2n] });
  await assert.rejects(client.estimateGas({ account: outsider, to: registry, data: register }));
  await send(registry, register);
  const staged = await readBuild('demo/release-a', { site, release: 'a', fallback: 'index.html' });
  const stagedB = await readBuild('demo/release-b', { site, release: 'b', fallback: 'index.html' });
  let snapshot = await testnetSnapshot(config, client);
  assert.throws(() => requireTestnetGate(staged.manifest, config, snapshot));
  const request = await testnetRequest(staged.manifest, config, snapshot, false, client);
  request.signatures = await Promise.all([r1, r2].map(account => wallet(account).signTypedData(approvalTypedData(request))));
  const typed = approvalTypedData(request).message;
  const record = (signatures: Hex[]) => encodeFunctionData({ abi: registryAbi, functionName: 'record', args: [siteTuple(site), typed, signatures] });
  for (const signatures of [[request.signatures[0]], [request.signatures[0], request.signatures[0]]]) {
    await assert.rejects(client.estimateGas({ account: holder, to: registry, data: record(signatures) }));
  }
  const signed = (await signaturesFor(request, snapshot.approval!.policy)).map(([, signature]) => signature);
  await send(registry, record(signed));
  snapshot = await testnetSnapshot(config, client);
  requireTestnetGate(staged.manifest, config, snapshot);
  assert.throws(() => requireTestnetGate(stagedB.manifest, config, snapshot));
  const sender = async (tx: { to: Address; data: Hex; label: string }) => { await send(tx.to, tx.data); };
  const completed = await publishTestnet(config, staged, sender, client);
  assert.equal(testnetOutcome(completed), 'match');

  await assert.rejects(client.estimateGas({ account: holder, to: registry, data: record(signed) }));
  await sender({ ...beginTestnet(config, completed), label: 'interrupt' });
  const interrupted = await testnetSnapshot(config, client);
  assert.equal(testnetOutcome(interrupted), 'unavailable');
  assert.equal(interrupted.inspection.status, 'partial');
  assert.equal(testnetOutcome(await publishTestnet(config, staged, sender, client)), 'match');

  snapshot = await testnetSnapshot(config, client);
  await sender({ ...beginTestnet(config, snapshot), label: 'controlled mutation' });
  const started = await testnetSnapshot(config, client);
  const changed = stagedB.manifest.files.find(file => file.path === 'payment.json')!;
  const changedCall = encodeFunctionData({ abi: storeAbi, functionName: 'putFile',
    args: [config.fixture, changed.path, changed.type, changed.sha256, toHex(stagedB.contents.get(changed.path)!)] });
  await sender({ ...testnetWrite(config, started.attempt, changedCall), label: 'changed payment file' });
  await sender({ to: config.authority, data: encodeFunctionData({ abi: testnetAuthorityAbi, functionName: 'finishPublication',
    args: [started.attempt] }), label: 'finish altered upload' });
  const changedState = await testnetSnapshot(config, client);
  assert.ok(changedState.inspection.files.every(file => file.status === 'verified'));
  assert.equal(testnetOutcome(changedState), 'differs');
  const revoke = encodeFunctionData({ abi: registryAbi, functionName: 'revoke', args: [siteTuple(site), 1n] });
  await assert.rejects(client.estimateGas({ account: outsider, to: registry, data: revoke }));
  await send(registry, revoke);
  assert.equal(testnetOutcome(await testnetSnapshot(config, client)), 'revoked');

  const recover = encodeFunctionData({ abi: testnetAuthorityAbi, functionName: 'returnCircuit' });
  await assert.rejects(client.estimateGas({ account: outsider, to: config.authority, data: recover }));
  await send(config.authority, recover);
  const recovered = await testnetSnapshot(config, client);
  assert.equal(recovered.inspection.holder?.toLowerCase(), holder.toLowerCase());
  assert.equal(recovered.approval?.authorityCurrent, false);
  await send(config.fixture, encodeFunctionData({ abi: fixtureAbi, functionName: 'transfer', args: [buyer] }));
  await send(config.fixture, encodeFunctionData({ abi: fixtureAbi, functionName: 'safeTransferFrom',
    args: [buyer, config.authority, 1n, '0x'] }), buyer);
  const reEnrolled = await testnetSnapshot(config, client);
  assert.equal(testnetOutcome(reEnrolled), 'none');
  await send(registry, register, buyer);
  const newPolicy = await testnetSnapshot(config, client);
  assert.equal(newPolicy.approval?.policy.version, 2n);
  await assert.rejects(client.estimateGas({ account: buyer, to: registry, data: record(signed) }));
  await assert.rejects(testnetRequest(staged.manifest, config, newPolicy, false, client), /Explicitly enable rollback/);
  const rollback = await testnetRequest(staged.manifest, config, newPolicy, true, client);
  rollback.signatures = await Promise.all([r1, r2].map(account => wallet(account).signTypedData(approvalTypedData(rollback))));
  const rollbackSigned = await signaturesFor(rollback, newPolicy.approval!.policy);
  await send(registry, encodeFunctionData({ abi: registryAbi, functionName: 'record', args: [siteTuple(site), approvalTypedData(rollback).message,
    rollbackSigned.map(([, signature]) => signature)] }), buyer);
  const buyerSender = async (tx: { to: Address; data: Hex; label: string }) => { await send(tx.to, tx.data, buyer); };
  assert.equal(testnetOutcome(await publishTestnet(config, staged, buyerSender, client)), 'match');
  await send(config.authority, recover, buyer);
  assert.equal((await testnetSnapshot(config, client)).inspection.holder?.toLowerCase(), buyer.toLowerCase());

  const fakeMainnet = createPublicClient({ chain: testnet, transport: custom({ async request() { return '0xc4'; } }) }) as unknown as TestnetClient;
  await assert.rejects(assertTestnet(fakeMainnet), /requires X Layer testnet/);
  assert.throws(() => parseTestnetConfig({ ...config, chainId: 196 }), /1952/);
  await raw('anvil_setChainId', [196]);
  await assert.rejects(client.estimateGas({ account: holder, data: plan.transactions[0].data }));
  await assert.rejects(client.estimateGas({ account: holder, data: plan.transactions[1].data }));
  console.log('TESTNET FIXTURE REHEARSAL PASS · 1952 lifecycle tested locally · mainnet rejected.');
});
