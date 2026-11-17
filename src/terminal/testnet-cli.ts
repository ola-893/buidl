import { randomBytes } from 'node:crypto';
import { writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { encodeFunctionData, formatEther, isHash, toHex, zeroAddress, type Address } from 'viem';
import { approvalTypedData, parseEvidence, registryAbi, signaturesFor, siteTuple } from '../core/approval';
import { readBuild } from '../core/build';
import { outcomes } from '../core/local';
import { address, manifestDigest, parseManifest } from '../core/manifest';
import { storeAbi } from '../core/tapeout';
import { assertTestnetRequest, beginTestnet, compareTestnet, fixtureAbi, planTestnet, planTestnetAuthority, requireTestnetGate,
  testnetAuthorityAbi, testnetOutcome, testnetRequest, testnetSite, testnetSnapshot, testnetWrite, TESTNET_RPCS } from '../core/testnet';
import { publishTestnet } from '../core/testnet-publish';
import { browserSignature } from './wallet';
import { fixtures, loadJson, parseProject, projectAt, saveNew } from './project';
import { jsonText, report } from './output';
import { WalletSender } from './sender';
import { connectedWallet } from './connection';

const mkdirForPlan = (path: string) => mkdir(dirname(resolve(path)), { recursive: true });

export const testnetHelp = `buidl testnet — X Layer TESTNET 1952 · simulated DeWEB fixtures

  init --owner <address> --reviewers <a,b> [--threshold 2] [--fixtures config.json] [--rpc <url>]
  doctor | status | verify [--manifest manifest.json] [--out report.json]
  deploy [--fixture <existing-circuit>]             Plan fixture deployment; add --broadcast --wallet to sign
  enroll | policy                                 Preview transaction; add --broadcast --wallet to sign
  manifest <build-dir> --release <name> --out manifest.json [--fallback index.html]
  request <manifest.json> --out request.json [--rollback]
  sign <request.json> --reviewer <address> --out signed.json --wallet
  approve <signed.json> [more-signed.json ...]       Merge distinct reviewer signatures and preview recording
  gate <build-dir> <manifest.json>                   Check exact bytes and active approval
  publish <build-dir> <manifest.json>               Resume approved publishing with --broadcast --wallet
  interrupt                                        Leave publication visibly incomplete
  mutate <build-dir> <manifest.json>                Controlled fixture-only changed-file demonstration
  revoke | recover | transfer --to <address>        Preview custody/lifecycle transaction
  reconcile --hash <transaction-hash>               Verify an uncertain CLI wallet result

Options: --project buidl.json · --rpc <testnet-url> · --from <address> · --json · --no-open
Writes require --broadcast --wallet. Every transaction gets a cost review and a wallet confirmation.
No private keys are accepted. Mainnet is rejected. Files are written without overwriting existing evidence.`;
export async function terminalTestnet(args: string[], operator = false) {
  const executionFlag = operator ? '--execute' : '--broadcast --wallet';
  const { positionals, values: v } = parseArgs({ args, allowPositionals: true, options: {
    project: { type: 'string' }, rpc: { type: 'string' }, owner: { type: 'string' }, name: { type: 'string' }, reviewers: { type: 'string' },
    threshold: { type: 'string' }, fixtures: { type: 'string' }, fixture: { type: 'string' }, from: { type: 'string' },
    out: { type: 'string' }, release: { type: 'string' }, fallback: { type: 'string' }, reviewer: { type: 'string' },
    manifest: { type: 'string' }, to: { type: 'string' }, hash: { type: 'string' },
    broadcast: { type: 'boolean' }, wallet: { type: 'boolean' }, rollback: { type: 'boolean' },
    json: { type: 'boolean' }, help: { type: 'boolean' }, 'no-open': { type: 'boolean' },
  } });
  const [command, ...p] = positionals;
  if (!command || v.help) return console.log(testnetHelp);
  const commands = ['init','doctor','status','verify','deploy','enroll','policy','manifest','request','sign','approve','gate','publish','interrupt','mutate','revoke','recover','transfer','reconcile'];
  if (!commands.includes(command)) throw new Error(testnetHelp);
  const noArguments = ['init','doctor','status','verify','deploy','enroll','policy','interrupt','revoke','recover','transfer','reconcile'];
  if (noArguments.includes(command) && p.length) throw new Error(testnetHelp);
  const projectPath = resolve(v.project ?? 'buidl.json');
  if (command === 'init') {
    if (!v.owner || !v.reviewers || p.length) throw new Error(testnetHelp);
    const project = parseProject({ version: 1, ...(v.name ? { name: v.name } : {}), network: 'xlayer-testnet-fixtures', chainId: 1952, rpcUrl: v.rpc ?? TESTNET_RPCS[0],
      owner: v.owner, reviewers: v.reviewers.split(','), threshold: Number(v.threshold ?? 2), ...(v.fixtures ? { fixtures: await loadJson(v.fixtures) } : {}) });
    await saveNew(projectPath, project);
    return report('Testnet project created', { project: projectPath, network: 'X Layer TESTNET 1952 · buidl fixtures', owner: project.owner, next: operator ? 'buidl doctor' : 'buidl testnet doctor' }, v.json);
  }
  if (command === 'manifest') {
    if (p.length !== 1 || !v.release || !v.out) throw new Error(testnetHelp);
    const project = parseProject(await loadJson(projectPath));
    const config = fixtures(project);
    const staged = await readBuild(p[0], { site: testnetSite(config), release: v.release, fallback: v.fallback ?? 'index.html' });
    await saveNew(v.out, staged.manifest);
    return report('Release manifest created', { manifest: resolve(v.out), digest: manifestDigest(staged.manifest), files: staged.manifest.files.length }, v.json);
  }
  const { project, client } = await projectAt(projectPath, v.rpc);
  const connected = await connectedWallet(!!v.broadcast || command === 'sign');
  const account = address(v.from ?? connected?.address ?? project.owner);
  if (connected && connected.address !== account) throw new Error(`Reconnect the signing wallet with buidl wallet connect --network testnet --account ${account}`);
  const sender = new WalletSender(client, account, projectPath, !v['no-open']);
  if (command === 'reconcile') {
    if (!v.hash || !isHash(v.hash)) throw new Error('Provide --hash <wallet transaction hash>.');
    return report('Wallet result reconciled', { result: await sender.reconcile(v.hash) }, v.json);
  }
  if (command === 'deploy') {
    if (account !== project.owner) throw new Error(`Connect the configured holder ${project.owner} before deploying this app.`);
    if (project.fixtures) throw new Error('This project already has fixtures. Run status; existing deployments will not be replaced.');
    let pending: Awaited<ReturnType<typeof planTestnet>> | undefined;
    try { pending = await loadJson(projectPath + '.deployment.json') as typeof pending; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (pending && (pending.config.chainId !== 1952 || pending.transactions.some(t => t.from !== account))) throw new Error('Saved deployment belongs to a different owner or network.');
    const existingFixture = v.fixture ? address(v.fixture) : pending?.config.fixture;
    let plan;
    if (pending && await client.getCode({ address: pending.config.authority })) {
      await testnetSnapshot(pending.config, client);
      plan = { ...pending, transactions: [], maximumAtQuotedGasPriceWei: '0' };
    } else if (existingFixture && await client.getCode({ address: existingFixture })) plan = await planTestnetAuthority(account, existingFixture, client);
    else {
      plan = await planTestnet(account, client);
      if (pending && pending.config.fixture !== plan.config.fixture) throw new Error('Saved deployment nonce changed. Inspect its plan and wallet activity before replacing it.');
    }
    if (!v.broadcast) {
      if (v.out) await saveNew(v.out, plan);
      return report('Testnet fixture deployment preview', { ...plan, maximumTestOKB: formatEther(BigInt(plan.maximumAtQuotedGasPriceWei)), next: `Repeat with ${executionFlag} to review each deployment.` }, v.json);
    }
    if (!v.wallet) throw new Error('--broadcast requires --wallet.');
    await sender.locked(async () => {
      // Persist predictions before the first signing request, so a partial deployment is recoverable.
      const pendingPath = projectPath + '.deployment.json';
      await mkdirForPlan(pendingPath);
      await writeFile(pendingPath + '.tmp', jsonText(plan) + '\n', { mode: 0o600 });
      await rename(pendingPath + '.tmp', pendingPath);
      for (const tx of plan.transactions) await sender.send(tx);
      await testnetSnapshot(plan.config, client);
      const temp = projectPath + '.tmp';
      await writeFile(temp, jsonText({ ...project, fixtures: plan.config }) + '\n', { mode: 0o600 });
      await rename(temp, projectPath);
    });
    return report('Testnet fixtures deployed', { config: plan.config, next: operator ? 'buidl app enroll --execute' : 'buidl testnet enroll --broadcast --wallet' }, v.json);
  }
  if (command === 'doctor') {
    const [block, balance, nonce] = await Promise.all([client.getBlock(), client.getBalance({ address: account }), client.getTransactionCount({ address: account, blockTag: 'pending' })]);
    if (project.fixtures) await testnetSnapshot(project.fixtures, client);
    return report('Testnet checks passed', { network: 'X Layer TESTNET 1952 · simulated fixtures', block: block.number, checkedAt: new Date().toISOString(), account,
      balanceTestOKB: formatEther(balance), nextNonce: nonce, contracts: project.fixtures ? 'Recognized fixture bytecode and authority binding' : 'Not deployed',
      signing: 'Browser wallet; signatures and transactions are verified independently', receipts: sender.journal }, v.json);
  }
  const config = fixtures(project);
  const state = await testnetSnapshot(config, client);
  if (['status', 'verify'].includes(command)) {
    const manifest = v.manifest ? parseManifest(await loadJson(v.manifest)) : undefined;
    if (manifest && manifestDigest(manifest) !== state.approval?.commitment.approval.manifestDigest) throw new Error('This manifest is not the current approved commitment.');
    const outcome = testnetOutcome(state);
    const result = { source: 'buidl testnet fixtures · not actual TapeOut contracts', chainId: 1952, outcome: outcomes[outcome],
      checkedAt: new Date().toISOString(), block: state.inspection.block, owner: state.governor, circuitHolder: state.inspection.holder, registry: state.registry,
      policyVersion: state.approval?.policy.version, threshold: state.approval?.policy.threshold, reviewers: state.approval?.policy.reviewers,
      recordedSigners: state.approval?.commitment.signers, approvalAuthorityCurrent: state.approval?.authorityCurrent, approvalRevoked: state.approval?.commitment.revoked, publication: { attempt: state.attempt, incomplete: state.inProgress },
      files: state.inspection.files.map(f => ({ path: f.path, status: f.status, sha256: f.sha256 })),
      ...(manifest ? { changes: compareTestnet(state, manifest) } : {}) };
    if (v.out) await saveNew(v.out, { ...result, snapshot: state });
    report('Fresh release verification', result, v.json);
    if (command === 'verify' && outcome !== 'match') process.exitCode = 2;
    return;
  }
  if (command === 'request') {
    if (p.length !== 1 || !v.out) throw new Error(testnetHelp);
    const request = await testnetRequest(parseManifest(await loadJson(p[0])), config, state, !!v.rollback, client);
    await saveNew(v.out, request);
    return report('Approval request created', { request: resolve(v.out), digest: manifestDigest(request.manifest), sequence: request.sequence, threshold: state.approval!.policy.threshold }, v.json);
  }
  if (command === 'sign') {
    if (p.length !== 1 || !v.reviewer || !v.out || !v.wallet) throw new Error(testnetHelp);
    const request = parseEvidence(await loadJson(p[0])); assertTestnetRequest(request, config, state);
    const reviewer = address(v.reviewer);
    await connectedWallet(true, reviewer);
    if (!state.approval!.policy.reviewers.some(r => r.toLowerCase() === reviewer) || reviewer === state.approval!.policy.holder.toLowerCase()) throw new Error('Reviewer is not authorized by the current policy.');
    const existing = await signaturesFor(request, state.approval!.policy, false);
    if (existing.some(([signer]) => signer === reviewer)) throw new Error('This reviewer already signed the request.');
    const signature = await browserSignature(request, reviewer, client, !v['no-open']);
    const signed = { ...request, signatures: [...request.signatures, signature] };
    const verified = await signaturesFor(signed, state.approval!.policy, false);
    await saveNew(v.out, signed);
    return report('Reviewer signature verified', { request: resolve(v.out), signers: verified.map(([a]) => a), threshold: state.approval!.policy.threshold, gasFee: 'None' }, v.json);
  }
  const txs: { to?: Address; data: `0x${string}`; label: string }[] = [];
  let action: (() => Promise<unknown>) | undefined;
  if (command === 'approve') {
    if (!p.length) throw new Error(testnetHelp);
    const requests = await Promise.all(p.map(async path => parseEvidence(await loadJson(path))));
    const first = requests[0];
    if (requests.some(r => jsonText(approvalTypedData(r)) !== jsonText(approvalTypedData(first)))) throw new Error('Requests describe different approvals.');
    const merged = { ...first, signatures: [...new Set(requests.flatMap(r => r.signatures))] };
    assertTestnetRequest(merged, config, state);
    const signed = await signaturesFor(merged, state.approval!.policy);
    if (v.out) await saveNew(v.out, merged);
    txs.push({ to: state.registry, label: 'Record threshold approval on testnet', data: encodeFunctionData({ abi: registryAbi, functionName: 'record', args: [siteTuple(first.manifest.site), approvalTypedData(first).message, signed.map(([,s]) => s)] }) });
  } else if (['gate','publish'].includes(command)) {
    if (p.length !== 2) throw new Error(testnetHelp);
    const manifest = parseManifest(await loadJson(p[1]));
    const staged = await readBuild(p[0], { site: manifest.site, release: manifest.release, fallback: manifest.routing.fallback, provenance: manifest.provenance });
    if (manifestDigest(staged.manifest) !== manifestDigest(manifest)) throw new Error('Build differs from the approved manifest. Publishing blocked.');
    requireTestnetGate(manifest, config, state);
    if (command === 'gate') return report('Approval gate passed', { digest: manifestDigest(manifest), block: state.inspection.block, files: manifest.files.length }, v.json);
    if (account !== state.governor.toLowerCase()) throw new Error('Publishing requires the enrolled circuit governor.');
    action = () => publishTestnet(config, staged, sender.send, client, { resume: true });
    if (!v.broadcast) return report('Approved publishing ready', { digest: manifestDigest(manifest), files: manifest.files.length, resumeAttempt: state.inProgress ? state.attempt : undefined,
      next: `Repeat with ${executionFlag}. Each remaining transaction is estimated before its wallet review.` }, v.json);
  } else if (command === 'enroll') {
    if (state.inspection.holder?.toLowerCase() !== account) throw new Error('Enrollment requires the current circuit holder.');
    txs.push({ to: config.fixture, label: 'Enroll simulated circuit into test custody', data: encodeFunctionData({ abi: fixtureAbi, functionName: 'safeTransferFrom',
      args: [account, config.authority, 1n, state.registry === zeroAddress ? toHex(randomBytes(32)) : '0x'] }) });
  } else if (command === 'policy') {
    const policy = parseProject({ ...project, owner: state.governor, reviewers: v.reviewers ? v.reviewers.split(',') : project.reviewers, threshold: v.threshold ? Number(v.threshold) : project.threshold });
    txs.push({ to: state.registry, label: 'Register separate reviewer policy', data: encodeFunctionData({ abi: registryAbi, functionName: 'setPolicy', args: [siteTuple(testnetSite(config)), policy.reviewers, BigInt(policy.threshold)] }) });
  } else if (command === 'interrupt') {
    if (!state.approval?.commitment.approval.sequence) throw new Error('No release approval to interrupt.');
    txs.push({ ...beginTestnet(config, state), label: 'Begin interrupted testnet publication' });
  } else if (command === 'mutate') {
    if (p.length !== 2) throw new Error(testnetHelp);
    const manifest = parseManifest(await loadJson(p[1]));
    const staged = await readBuild(p[0], { site: manifest.site, release: manifest.release, fallback: manifest.routing.fallback, provenance: manifest.provenance });
    if (manifestDigest(staged.manifest) !== manifestDigest(manifest)) throw new Error('Mutation bytes differ from the supplied mutation manifest.');
    const payment = manifest.files.find(f => f.path === 'payment.json');
    if (!payment || payment.bytes > 60_000 || !state.approval?.authorityCurrent || manifest.site.container !== config.fixture) throw new Error('Expected payment.json for this controlled fixture.');
    action = async () => {
      const current = await testnetSnapshot(config, client);
      await sender.send({ ...beginTestnet(config, current), label: 'Begin controlled fixture mutation' });
      const attempt = current.attempt + 1n;
      await sender.send({ ...testnetWrite(config, attempt, encodeFunctionData({ abi: storeAbi, functionName: 'putFile', args: [config.fixture, payment.path, payment.type, payment.sha256, toHex(staged.contents.get(payment.path)!)] })), label: 'Write changed payment bytes with valid SHA-256' });
      await sender.send({ to: config.authority, data: encodeFunctionData({ abi: testnetAuthorityAbi, functionName: 'finishPublication', args: [attempt] }), label: 'Finish controlled fixture mutation' });
    };
    if (!v.broadcast) return report('Controlled fixture mutation preview', { path: payment.path, sha256: payment.sha256, expected: 'Valid file hash, but differs from the approved release', next: `Add ${executionFlag} to sign each testnet transaction.` }, v.json);
  } else if (command === 'revoke') {
    txs.push({ to: state.registry, label: 'Revoke current release approval', data: encodeFunctionData({ abi: registryAbi, functionName: 'revoke', args: [siteTuple(testnetSite(config)), state.approval!.commitment.approval.sequence] }) });
  } else if (command === 'recover') {
    txs.push({ to: config.authority, label: 'Recover simulated circuit to its depositor', data: encodeFunctionData({ abi: testnetAuthorityAbi, functionName: 'returnCircuit' }) });
  } else if (command === 'transfer') {
    if (!v.to) throw new Error('Provide --to <new controlled owner>. Recover the circuit before transferring.');
    txs.push({ to: config.fixture, label: `Transfer simulated circuit to ${address(v.to)}`, data: encodeFunctionData({ abi: fixtureAbi, functionName: 'transfer', args: [address(v.to)] }) });
  }
  if (!v.broadcast) {
    const plans = []; for (const tx of txs) plans.push(await sender.quote(tx));
    return report('Unsigned testnet transaction preview', { plans, next: `Repeat with ${executionFlag} to review and sign.` }, v.json);
  }
  if (!v.wallet) throw new Error('--broadcast requires --wallet.');
  await sender.locked(async () => { if (action) await action(); else for (const tx of txs) await sender.send(tx); });
  if (command === 'policy') {
    const updated = parseProject({ ...project, owner: account, reviewers: v.reviewers ? v.reviewers.split(',') : project.reviewers, threshold: v.threshold ? Number(v.threshold) : project.threshold });
    await writeFile(projectPath + '.tmp', jsonText(updated) + '\n', { mode: 0o600 });
    await rename(projectPath + '.tmp', projectPath);
  }
  const final = await testnetSnapshot(config, client);
  report('Testnet operation confirmed', { operation: command, outcome: outcomes[testnetOutcome(final)], block: final.inspection.block, receipts: sender.journal }, v.json);
}
