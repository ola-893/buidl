import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createPublicClient, createWalletClient, encodeFunctionData, http, toHex, type Address, type Hex } from 'viem';
import { approvalTypedData, registryAbi, signaturesFor, siteTuple } from '../core/approval';
import { fileEntry, parseManifest } from '../core/manifest';
import { storeAbi } from '../core/tapeout';
import { beginTestnet, fixtureAbi, planTestnet, requireTestnetGate, testnet, testnetAuthorityAbi, testnetOutcome, testnetRequest, testnetSite, testnetSnapshot, testnetWrite } from '../core/testnet';
import { publishTestnet } from '../core/testnet-publish';
import { jsonText, report } from './output';
import { saveNew } from './project';

export async function runTerminalDemo(args: string[]) {
  const { values } = parseArgs({ args, options: { out: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) return console.log('buidl demo [--out <new-evidence-directory>] [--json]\nStarts its own disposable Anvil on loopback, exercises the full fixture lifecycle, saves receipts, then stops it. No real funds or actual user wallets are used.');
  const root = resolve(values.out ?? join('.buidl', `demo-${Date.now()}`));
  await mkdir(dirname(root), { recursive: true });
  await mkdir(root, { recursive: false });
  const socket = createServer(); await new Promise<void>(r => socket.listen(0, '127.0.0.1', r));
  const port = (socket.address() as { port: number }).port; await new Promise<void>(r => socket.close(() => r()));
  let startupError: Error | undefined;
  const node = spawn('anvil', ['--host','127.0.0.1','--port',String(port),'--chain-id','1952','--silent'], { stdio: 'ignore' });
  node.on('error', error => { startupError = error; });
  const endpoint = `http://127.0.0.1:${port}`;
  const client = createPublicClient({ chain: testnet, transport: http(endpoint, { timeout: 1000, retryCount: 0 }) });
  const receipts: unknown[] = [], checks: { check: string; passed: boolean; block?: string }[] = [];
  const say = (message: string) => { if (!values.json) console.error(message); };
  async function check(name: string, condition: boolean) {
    checks.push({ check: name, passed: condition, block: String(await client.getBlockNumber({ cacheTime: 0 })) });
    if (!condition) throw new Error(`Demo failed: ${name}`); say(`  PASS  ${name}`);
  }
  try {
    let ready = false;
    for (let i=0;i<50;i++) {
      if (startupError) throw new Error('Anvil is required for the disposable demo. Install Foundry, then run buidl demo again.');
      try { ready = await client.getChainId() === 1952; if (ready) break; } catch { /* own node starting */ }
      await new Promise(r => setTimeout(r, 100));
    }
    if (!ready) throw new Error('Disposable demo node did not start.');
    say('\nbuidl · release-control demo\nLOCAL rehearsal · simulated DeWEB fixtures · disposable Anvil\nNo public testnet or mainnet transactions\n');
    const accounts = await createWalletClient({ chain: testnet, transport: http(endpoint) }).getAddresses();
    const [holder,r1,r2,buyer] = accounts;
    const wallet = (account: Address) => createWalletClient({ chain: testnet, account, transport: http(endpoint) });
    async function send(to: Address | undefined, data: Hex, account = holder) {
      const gas = await client.estimateGas({ account, to, data });
      const hash = await wallet(account).sendTransaction({ to, data, gas: gas + gas/5n + 10_000n });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Demo transaction reverted.');
      receipts.push({ account, to, data, receipt }); return receipt;
    }
    const sender = async (tx: { to: Address; data: Hex; label: string }) => { await send(tx.to, tx.data); };
    const plan = await planTestnet(holder, client); const config = plan.config;
    for (const tx of plan.transactions) await send(tx.to, tx.data);
    const site = testnetSite(config);
    await saveNew(join(root,'fixture-config.json'),config); await saveNew(join(root,'site.json'),site);
    await send(config.fixture,encodeFunctionData({abi:fixtureAbi,functionName:'safeTransferFrom',args:[holder,config.authority,1n,toHex(crypto.getRandomValues(new Uint8Array(32)))]}));
    let state = await testnetSnapshot(config,client);
    const reviewers = [r1,r2].sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));
    await send(state.registry,encodeFunctionData({abi:registryAbi,functionName:'setPolicy',args:[siteTuple(site),reviewers,2n]}));
    state = await testnetSnapshot(config,client);
    await check('Circuit enrolled; two separate reviewers registered',state.approval!.authorityCurrent && state.approval!.policy.threshold===2n);
    const contents = new Map([['index.html',new TextEncoder().encode('<!doctype html><title>buidl approved checkout</title><h1>Approved release</h1>')],['payment.json',new TextEncoder().encode('{"destination":"team-treasury"}\n')]]);
    const manifest = parseManifest({schemaVersion:1,site,release:'checkout-a',routing:{fallback:'index.html'},files:[...contents].map(([p,b])=>fileEntry(p,p.endsWith('.html')?'text/html':'application/json',b))});
    await mkdir(join(root,'build-a')); for(const [p,b] of contents) await writeFile(join(root,'build-a',p),b);
    await saveNew(join(root,'manifest-a.json'),manifest);
    let blocked=false;try{requireTestnetGate(manifest,config,state)}catch{blocked=true}
    await check('Publishing blocked before approval',blocked);
    const evidence=await testnetRequest(manifest,config,state,false,client);
    for(const reviewer of reviewers)evidence.signatures.push(await wallet(reviewer).signTypedData(approvalTypedData(evidence)));
    const signed=await signaturesFor(evidence,state.approval!.policy);
    let singleRejected=false;try{await client.estimateGas({account:holder,to:state.registry,data:encodeFunctionData({abi:registryAbi,functionName:'record',args:[siteTuple(site),approvalTypedData(evidence).message,[signed[0][1]]]})})}catch{singleRejected=true}
    await check('One signature rejected; two distinct reviewers verified',singleRejected && signed.length===2);
    await send(state.registry,encodeFunctionData({abi:registryAbi,functionName:'record',args:[siteTuple(site),approvalTypedData(evidence).message,signed.map(([,s])=>s)]}));
    await saveNew(join(root,'signed-release.json'),evidence);
    state=await publishTestnet(config,{manifest,contents},sender,client);
    await check('Approved release published; fresh bytes match',testnetOutcome(state)==='match');
    await saveNew(join(root,'approved-snapshot.json'),state);
    const approvedAttempt=state.attempt;
    await sender({...beginTestnet(config,state),label:'interrupt'});
    state=await testnetSnapshot(config,client);
    await check('Interrupted upload is unavailable',testnetOutcome(state)==='unavailable' && state.inProgress);
    state=await publishTestnet(config,{manifest,contents},sender,client,{resume:true});
    await check('Interrupted publishing resumes the existing attempt',testnetOutcome(state)==='match' && state.attempt===approvedAttempt+1n);
    const changed=new TextEncoder().encode('{"destination":"different-treasury"}\n');const file=fileEntry('payment.json','application/json',changed);
    await sender({...beginTestnet(config,state),label:'mutation'});
    const attempt=state.attempt+1n;
    await sender({...testnetWrite(config,attempt,encodeFunctionData({abi:storeAbi,functionName:'putFile',args:[config.fixture,file.path,file.type,file.sha256,toHex(changed)]})),label:'changed payment'});
    await send(config.authority,encodeFunctionData({abi:testnetAuthorityAbi,functionName:'finishPublication',args:[attempt]}));
    state=await testnetSnapshot(config,client);
    await check('Changed payment detected despite valid onchain file hashes',testnetOutcome(state)==='differs' && state.inspection.files.every(f=>f.status==='verified'));
    await saveNew(join(root,'changed-snapshot.json'),state);
    await send(state.registry,encodeFunctionData({abi:registryAbi,functionName:'revoke',args:[siteTuple(site),1n]}));
    state=await testnetSnapshot(config,client);await check('Revocation invalidates approval',testnetOutcome(state)==='revoked');
    await send(config.authority,encodeFunctionData({abi:testnetAuthorityAbi,functionName:'returnCircuit'}));
    state=await testnetSnapshot(config,client);await check('Depositor recovers circuit; ownership exit invalidates policy',state.inspection.holder?.toLowerCase()===holder.toLowerCase()&&!state.approval!.authorityCurrent);
    await send(config.fixture,encodeFunctionData({abi:fixtureAbi,functionName:'transfer',args:[buyer]}));
    await send(config.fixture,encodeFunctionData({abi:fixtureAbi,functionName:'safeTransferFrom',args:[buyer,config.authority,1n,'0x']}),buyer);
    state=await testnetSnapshot(config,client);await check('New owner enrollment cannot reuse prior approval',testnetOutcome(state)==='none'&&!state.approval!.authorityCurrent);
    let staleRejected=false;try{await client.estimateGas({account:buyer,to:state.registry,data:encodeFunctionData({abi:registryAbi,functionName:'record',args:[siteTuple(site),approvalTypedData(evidence).message,signed.map(([,s])=>s)]})})}catch{staleRejected=true}
    await check('Prior owner signatures rejected after ownership change',staleRejected);
    await send(config.authority,encodeFunctionData({abi:testnetAuthorityAbi,functionName:'returnCircuit'}),buyer);
    state=await testnetSnapshot(config,client);await check('New owner recovers circuit',state.inspection.holder?.toLowerCase()===buyer.toLowerCase());
    await saveNew(join(root,'final-snapshot.json'),state);
    const result={kind:'local-cli-fixture-rehearsal',chainId:1952,network:'Disposable local Anvil; NOT public X Layer testnet',actualTapeOutContracts:false,actualUserWallets:false,mainnetTransactionsSent:false,checkedAt:new Date().toISOString(),checks,receipts};
    await saveNew(join(root,'results.json'),result);
    report('Demo complete', { passed:checks.length,total:checks.length,network:result.network,evidence:join(root,'results.json'),next:'Use buidl testnet --help for actual testnet wallet signing.' },values.json);
  } finally {
    if (node.pid) { const exit=new Promise<void>(r=>node.once('exit',()=>r()));node.kill('SIGTERM');await exit; }
  }
}
