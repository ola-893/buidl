import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Blocks, RefreshCw, Wallet } from 'lucide-react';
import { encodeFunctionData, formatEther, isHash, toHex, zeroAddress, type Address, type Hex } from 'viem';
import { approvalTypedData, parseEvidence, registryAbi, signaturesFor, siteTuple, type Evidence } from '../core/approval';
import { address, fileEntry, manifestDigest, parseManifest, type Manifest } from '../core/manifest';
import { outcomes } from '../core/local';
import { storeAbi } from '../core/tapeout';
import {
  assertTestnet, assertTestnetRequest, beginTestnet, compareTestnet, estimateTestnet, fixtureAbi, parseTestnetConfig, planTestnet, planTestnetAuthority,
  requireTestnetGate, testnet, testnetAuthorityAbi, testnetClient, testnetOutcome, testnetRequest, testnetSite, testnetSnapshot,
  testnetWrite, usesTestnetRelay, type PlannedTx, type TestnetConfig, type TestnetSnapshot,
} from '../core/testnet';
import { publishTestnet } from '../core/testnet-publish';
import { Badge, CopyValue, Diff, Inventory, Modal } from './evidence-components';
import { contentTypeFor } from '../core/content-type';
import { download, errorText } from './web-utils';
import { walletClient, watchWallets, type Provider } from './wallet';
import sampleHtml from '../../demo/release-a/index.html?raw';
import paymentA from '../../demo/release-a/payment.json?raw';
import paymentB from '../../demo/release-b/payment.json?raw';

const storageKey = 'buidl.testnet.fixtures.v1';
type LedgerEntry = { at: string; chainId: 1952; label: string; status: 'submitted' | 'success' | 'reverted' | 'checked' | 'failed';
  hash?: Hex; block?: string; gasUsed?: string; paidWei?: string; detail?: string; account?: Address; receipt?: unknown };
type Pending = { plan: PlannedTx; resolve: () => void; reject: (reason: Error) => void };
const client = testnetClient();
const explorer = testnet.blockExplorers.default.url;
function stored() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as { config?: unknown; ledger?: LedgerEntry[] };
    return { config: value.config ? parseTestnetConfig(value.config) : undefined, ledger: value.ledger ?? [] };
  } catch { return { config: undefined, ledger: [] }; }
}

export function TestnetDashboard() {
  const initial = useRef(stored());
  const [config, setConfig] = useState(initial.current.config);
  const [ledger, setLedger] = useState<LedgerEntry[]>(initial.current.ledger);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState<Provider>();
  const [account, setAccount] = useState<Address>();
  const [chain, setChain] = useState<number>();
  const [balance, setBalance] = useState<bigint>();
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof planTestnet>>>();
  const [snapshot, setSnapshot] = useState<TestnetSnapshot>();
  const [checkedAt, setCheckedAt] = useState<string>();
  const [manifest, setManifest] = useState<Manifest>();
  const staged = useRef(new Map<string, Uint8Array>());
  const [evidence, setEvidence] = useState<Evidence>();
  const [rollback, setRollback] = useState(false);
  const [reviewers, setReviewers] = useState('');
  const [threshold, setThreshold] = useState(2);
  const [recipient, setRecipient] = useState('');
  const [busy, setBusy] = useState('');
  const lock = useRef(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const [pending, setPending] = useState<Pending>();
  const [signing, setSigning] = useState(false);

  useEffect(() => watchWallets(next => setProviders(list => list.some(p => p.provider === next.provider) ? list : [...list, next])), []);
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify({ config, ledger }));
  }, [config, ledger]);
  useEffect(() => {
    if (!provider) return;
    const accounts = (list: Address[]) => { setAccount(list[0] ? address(list[0]) : undefined); setPlan(undefined); };
    const network = (id: string) => { setChain(Number(BigInt(id))); setPlan(undefined); };
    provider.provider.on?.('accountsChanged', accounts);
    provider.provider.on?.('chainChanged', network);
    return () => {
      provider.provider.removeListener?.('accountsChanged', accounts);
      provider.provider.removeListener?.('chainChanged', network);
    };
  }, [provider]);

  function record(entry: Omit<LedgerEntry, 'at' | 'chainId'>) {
    setLedger(previous => [...previous, { ...entry, at: new Date().toISOString(), chainId: 1952 }]);
  }
  async function run(label: string, action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setNotice(undefined);
    try { await action(); }
    catch (error) { setNotice({ text: errorText(error), error: true }); }
    finally { lock.current = false; setBusy(''); }
  }
  async function connect(next: Provider) {
    await run('Connect wallet', async () => {
      const wallet = walletClient(next.provider, 1952);
      const [selected] = await wallet.requestAddresses();
      if (!selected) throw new Error('The wallet provided no public account.');
      const [id, funds] = await Promise.all([wallet.getChainId(), client.getBalance({ address: selected })]);
      await assertTestnet(client);
      setAccount(address(selected)); setChain(id); setBalance(funds); setProvider(next); setPlan(undefined);
      record({ label: 'Connected actual wallet', account: address(selected), status: 'checked', detail: `Wallet chain ${id}; testnet balance ${formatEther(funds)} OKB` });
    });
  }
  async function switchNetwork() {
    if (!provider) throw new Error('Connect the wallet.');
    const wallet = walletClient(provider.provider, 1952);
    try { await wallet.switchChain({ id: 1952 }); }
    catch (error) {
      const fail = error as { code?: number; cause?: { code?: number } };
      if (fail.code !== 4902 && fail.cause?.code !== 4902) throw error;
      await wallet.addChain({ chain: testnet });
      await wallet.switchChain({ id: 1952 });
    }
    setChain(await wallet.getChainId());
  }
  async function checkedWallet() {
    if (!provider || !account) throw new Error('Connect the signing wallet.');
    const wallet = walletClient(provider.provider, 1952);
    const [id, addresses] = await Promise.all([wallet.getChainId(), wallet.getAddresses(), assertTestnet(client)]);
    setChain(id);
    if (id !== 1952) throw new Error('Wrong network. Select X Layer testnet 1952 before signing.');
    if (!addresses.some(value => address(value) === account)) throw new Error('The active wallet account changed.');
    return { wallet, account };
  }
  async function refresh(next = config) {
    if (!next) return;
    setSnapshot(undefined);
    const result = await testnetSnapshot(next);
    setSnapshot(result);
    setCheckedAt(new Date().toISOString());
    record({ label: 'Fresh fixture verification', status: 'checked', block: result.inspection.block?.number, detail: outcomes[testnetOutcome(result)] });
  }
  async function propose(tx: { to?: Address; data: Hex; label: string; nonce?: number }, readyPlan?: PlannedTx) {
    const { account } = await checkedWallet();
    const estimate = readyPlan ?? await estimateTestnet(account, tx.data, tx.to);
    if (estimate.from.toLowerCase() !== account || estimate.to !== tx.to || estimate.data !== tx.data) throw new Error('The wallet or transaction changed after estimation.');
    return new Promise<void>((resolve, reject) => setPending({ plan: { ...estimate, label: tx.label, nonce: tx.nonce }, resolve, reject }));
  }
  async function signPending() {
    if (!pending || signing) return;
    setSigning(true);
    const action = pending;
    try {
      const { account } = await checkedWallet();
      const estimate = action.plan;
      const nonce = await client.getTransactionCount({ address: account, blockTag: 'pending' });
      if (estimate.nonce !== undefined && nonce !== estimate.nonce) {
        throw new Error('The account nonce changed. Rebuild the deployment plan.');
      }
      // Use the standard injected-wallet method directly. Do not retry a failed
      // eth_sendTransaction through an alternative wallet namespace.
      const hash = await provider!.provider.request({ method: 'eth_sendTransaction', params: [{
        from: account, ...(estimate.to ? { to: estimate.to } : {}), chainId: toHex(1952),
        data: estimate.data, gas: toHex(BigInt(estimate.gas)), gasPrice: toHex(BigInt(estimate.gasPrice)),
        nonce: toHex(nonce), value: '0x0',
      }] });
      if (!isHash(hash)) throw new Error('The wallet did not return a transaction hash. Check wallet activity before retrying.');
      record({ label: estimate.label, status: 'submitted', hash, account });
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
      record({ label: estimate.label, hash, account, status: receipt.status === 'success' ? 'success' : 'reverted',
        block: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), paidWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
        receipt: JSON.parse(JSON.stringify(receipt, (_, value) => typeof value === 'bigint' ? value.toString() : value)) });
      if (receipt.status !== 'success') throw new Error('Testnet transaction reverted.');
      setBalance(await client.getBalance({ address: account }));
      action.resolve();
    } catch (error) {
      const fail = error as { code?: number; cause?: { code?: number } };
      const code = fail.code ?? fail.cause?.code;
      const detail = `${errorText(error)}${code === undefined ? '' : ` (wallet code ${code})`}${code === 4100 ? ' Disconnect this site in MetaMask, then reconnect while X Layer testnet is selected.' : ''}`;
      record({ label: action.plan.label, status: 'failed', account, detail });
      action.reject(new Error(detail));
    }
    finally { setPending(undefined); setSigning(false); }
  }
  async function deploymentPlan() {
    const { account } = await checkedWallet();
    if (config && await client.getCode({ address: config.fixture })) {
      if (await client.getCode({ address: config.authority })) throw new Error('Both contracts already exist. Refresh the fixture instead.');
      setPlan(await planTestnetAuthority(account, config.fixture));
      return;
    }
    setPlan(await planTestnet(account));
  }
  async function deploy() {
    if (!plan) throw new Error('Prepare the deployment estimate first.');
    // Persist predicted addresses so a partially completed deployment can be inspected and resumed.
    setConfig(plan.config);
    for (const tx of plan.transactions) {
      const target = tx.creates;
      if (!target) throw new Error('The deployment plan is missing its predicted contract address.');
      if (await client.getCode({ address: target })) continue;
      await propose(tx, tx);
    }
    await refresh(plan.config);
  }
  function requiredConfig() {
    if (!config) throw new Error('Deploy or import the test fixture configuration.');
    return config;
  }
  async function latest() { return testnetSnapshot(requiredConfig()); }
  function candidate(name: 'a' | 'b') {
    const config = requiredConfig();
    const contents = new Map([['index.html', new TextEncoder().encode(sampleHtml)], ['payment.json', new TextEncoder().encode(name === 'a' ? paymentA : paymentB)]]);
    staged.current = contents;
    setManifest(parseManifest({ schemaVersion: 1, site: testnetSite(config), release: `testnet-checkout-${name}`,
      routing: { fallback: 'index.html' }, files: [...contents].map(([path, bytes]) => fileEntry(path, contentTypeFor(path), bytes)) }));
    setEvidence(undefined);
  }
  async function importBuild(files: FileList | null) {
    if (!files?.length) return;
    const config = requiredConfig();
    if (files.length > 20) throw new Error('The test fixture dashboard accepts up to 20 files.');
    const contents = new Map<string, Uint8Array>();
    for (const file of Array.from(files)) {
      if (file.size > 60_000) throw new Error('The fixture publisher accepts up to 60 KB per file.');
      const path = file.webkitRelativePath.split('/').slice(1).join('/') || file.name;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const entry = fileEntry(path, contentTypeFor(path), bytes);
      if (contents.has(entry.path)) throw new Error('Duplicate path.');
      contents.set(entry.path, bytes);
    }
    staged.current = contents;
    setManifest(parseManifest({ schemaVersion: 1, site: testnetSite(config), release: 'testnet-build',
      routing: { fallback: '' }, files: [...contents].map(([path, bytes]) => fileEntry(path, contentTypeFor(path), bytes)) }));
    setEvidence(undefined);
  }
  async function enroll() {
    const config = requiredConfig();
    const current = await latest();
    const { account } = await checkedWallet();
    const salt = current.registry === zeroAddress ? toHex(crypto.getRandomValues(new Uint8Array(32))) : '0x';
    await propose({ to: config.fixture, label: 'Enroll simulated circuit in test custody', data: encodeFunctionData({ abi: fixtureAbi,
      functionName: 'safeTransferFrom', args: [account, config.authority, 1n, salt] }) });
    await refresh();
  }
  async function register() {
    const config = requiredConfig();
    const state = await latest();
    const { account } = await checkedWallet();
    const list = reviewers.split(/[\s,]+/).filter(Boolean).map(address).sort();
    if (list.length > 31 || new Set(list).size !== list.length || list.includes(account) || !Number.isSafeInteger(threshold) || threshold < 1 || threshold > list.length) {
      throw new Error('Provide unique reviewer addresses separate from the holder and a valid threshold.');
    }
    if (state.registry === zeroAddress) throw new Error('Enroll the fixture first.');
    await propose({ to: state.registry, label: 'Register independent testnet reviewer policy', data: encodeFunctionData({
      abi: registryAbi, functionName: 'setPolicy', args: [siteTuple(testnetSite(config)), list, BigInt(threshold)] }) });
    setEvidence(undefined);
    await refresh();
  }
  async function createRequest() {
    if (!manifest) throw new Error('Load a build first.');
    setEvidence(await testnetRequest(manifest, requiredConfig(), await latest(), rollback));
  }
  async function importRequest(file?: File) {
    if (!file) return;
    if (file.size > 4_000_000) throw new Error('Request file too large.');
    const incoming = parseEvidence(JSON.parse(await file.text()));
    const state = await latest();
    assertTestnetRequest(incoming, requiredConfig(), state);
    const same = evidence && JSON.stringify(approvalTypedData(evidence), (_, v) => typeof v === 'bigint' ? v.toString() : v) ===
      JSON.stringify(approvalTypedData(incoming), (_, v) => typeof v === 'bigint' ? v.toString() : v);
    const combined = same ? { ...incoming, signatures: [...new Set([...evidence.signatures, ...incoming.signatures])] } : incoming;
    await signaturesFor(combined, state.approval!.policy, false);
    setEvidence(combined); setManifest(combined.manifest);
  }
  async function approve(recordApproval: boolean) {
    if (!evidence) throw new Error('Load the approval request first.');
    const state = await latest();
    assertTestnetRequest(evidence, requiredConfig(), state);
    const { wallet, account } = await checkedWallet();
    if (recordApproval) {
      const signed = await signaturesFor(evidence, state.approval!.policy);
      await propose({ to: state.registry, label: 'Record threshold approval on testnet', data: encodeFunctionData({
        abi: registryAbi, functionName: 'record', args: [siteTuple(evidence.manifest.site), approvalTypedData(evidence).message, signed.map(([, sig]) => sig)] }) });
      await refresh();
    } else {
      if (!state.approval!.policy.reviewers.some(reviewer => address(reviewer) === account)) throw new Error('Connect an authorized reviewer wallet.');
      const signature = await wallet.signTypedData({ account, ...approvalTypedData(evidence) });
      const next = { ...evidence, signatures: [...evidence.signatures, signature] };
      const signed = await signaturesFor(next, state.approval!.policy, false);
      setEvidence(next);
      record({ label: 'Reviewer typed signature verified', account, status: 'checked', detail: `${signed.length} distinct authorized signatures` });
    }
  }
  async function publish() {
    if (!manifest) throw new Error('Load the exact build.');
    await publishTestnet(requiredConfig(), { manifest, contents: staged.current }, propose);
    await refresh();
  }
  async function interruption() {
    const config = requiredConfig();
    const state = await latest();
    if (!manifest) throw new Error('Load the approved manifest.');
    requireTestnetGate(manifest, config, state);
    await propose({ ...beginTestnet(config, state), label: 'Begin and leave publication interrupted' });
    await refresh();
  }
  async function changedFile() {
    const config = requiredConfig();
    let state = await latest();
    if (!state.approval?.authorityCurrent) throw new Error('No active testnet policy.');
    if (!state.inProgress) {
      await propose({ ...beginTestnet(config, state), label: 'Open controlled changed-file experiment' });
      state = await latest();
    }
    const bytes = new TextEncoder().encode(paymentB);
    const entry = fileEntry('payment.json', 'application/json', bytes);
    const write = encodeFunctionData({ abi: storeAbi, functionName: 'putFile', args: [config.fixture, entry.path, entry.type, entry.sha256, toHex(bytes)] });
    await propose({ ...testnetWrite(config, state.attempt, write), label: 'Write changed payment destination with matching SHA-256' });
    await propose({ to: config.authority, label: 'Finish controlled mismatch attempt', data: encodeFunctionData({
      abi: testnetAuthorityAbi, functionName: 'finishPublication', args: [state.attempt] }) });
    await refresh();
  }
  async function revoke() {
    const state = await latest();
    if (!state.approval) throw new Error('No recorded release.');
    await propose({ to: state.registry, label: 'Revoke current testnet release', data: encodeFunctionData({
      abi: registryAbi, functionName: 'revoke', args: [siteTuple(testnetSite(requiredConfig())), state.approval.commitment.approval.sequence] }) });
    await refresh();
  }
  async function recover() {
    await propose({ to: requiredConfig().authority, label: 'Return simulated circuit to the depositor', data: encodeFunctionData({
      abi: testnetAuthorityAbi, functionName: 'returnCircuit' }) });
    await refresh();
  }
  async function transfer() {
    await propose({ to: requiredConfig().fixture, label: 'Transfer recovered simulated circuit to a new owner', data: encodeFunctionData({
      abi: fixtureAbi, functionName: 'transfer', args: [address(recipient)] }) });
    await refresh();
  }
  async function importConfig(file?: File) {
    if (!file) return;
    if (file.size > 5_000_000) throw new Error('Report file too large.');
    const input = JSON.parse(await file.text()) as { config?: unknown };
    const next = parseTestnetConfig(input.config ?? input);
    await refresh(next); setConfig(next);
  }

  const disabled = !!busy || chain !== 1952;
  const result = snapshot && testnetOutcome(snapshot);
  return <div className="verification-shell">
    <header className="topbar verification-topbar">
      <a className="brand" href="?testnet=1"><span className="mark"><Blocks size={22} /></span><span>buidl.</span></a>
      <Badge tone="amber">X Layer testnet · 1952 · Fixtures</Badge>
    </header>
    <main className="content verification-content">
      <div className="page-head"><div><div className="eyebrow">TESTNET RELEASE PILOT</div><h1>Test the release journey</h1><p>Simulated circuit, custody, and SiteRegistry fixtures on X Layer testnet.</p></div>
        <button className="button" onClick={() => download('buidl-testnet-report.json', { kind: 'testnet-fixture-evidence', chainId: 1952, config, ledger,
          exportedAt: new Date().toISOString(), checkedAt, snapshot })}><ArrowDownToLine size={16} /> Export receipts &amp; results</button></div>
      {notice && <div className={`notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</div>}
      <section className="card content-card stack">
        <h2>Wallet and network</h2>
        <p>{account ?? 'Connect your test wallet.'} · Wallet chain {chain ?? 'unknown'} · Testnet balance {balance === undefined ? '—' : formatEther(balance)} test OKB</p>
        <div className="actions">{providers.map((next, index) => <button key={index} className="button" disabled={!!busy} onClick={() => void connect(next)}><Wallet size={16} /> {next.name}</button>)}
          {provider && chain !== 1952 && <button className="button primary" disabled={!!busy} onClick={() => void run('Switch network', switchNetwork)}>Switch to X Layer testnet</button>}</div>
        <p>This route checks chain 1952 before estimating, signing, and sending. Both fixture constructors enforce chain 1952.</p>
        {usesTestnetRelay() && <p>Reads use the local relay to public X Layer testnet 1952. This connection is separate from the Anvil rehearsal.</p>}
      </section>
      <section className="card content-card stack">
        <h2>Deployment plan</h2><p>The fixtures stand in for TapeOut infrastructure unavailable at the reviewed testnet deployment addresses.</p>
        <div className="actions">
          <button className="button" disabled={disabled || !account} onClick={() => void run('Estimate deployment', deploymentPlan)}>Estimate testnet deployment</button>
          <label className="button upload">Import fixture config<input type="file" accept=".json" onChange={event => { const file = event.currentTarget.files?.[0]; void run('Import config', () => importConfig(file)); event.currentTarget.value = ''; }} /></label>
        </div>
        {plan && <>
          <CopyValue label="Predicted simulated circuit/store" value={plan.config.fixture} />
          <CopyValue label="Predicted custody authority" value={plan.config.authority} />
          {plan.transactions.map(tx => <p key={tx.label}>{tx.label} · gas limit {tx.gas} · {formatEther(BigInt(tx.estimatedWei))} test OKB at the quoted gas price</p>)}
          <strong>Estimated deployment budget {formatEther(BigInt(plan.maximumAtQuotedGasPriceWei))} test OKB</strong>
          <p>Each later action gets its own cost estimate before the wallet opens.</p>
          <button className="button primary" disabled={disabled || BigInt(plan.balanceWei) < BigInt(plan.maximumAtQuotedGasPriceWei)} onClick={() => void run('Deploy fixtures', deploy)}>Review and deploy test fixtures</button>
        </>}
        {config && <div className="verification-data"><CopyValue label="Simulated circuit/store" value={config.fixture} explorer={`${explorer}/address/${config.fixture}`} />
          <CopyValue label="Custody authority" value={config.authority} explorer={`${explorer}/address/${config.authority}`} /></div>}
      </section>
      {config && <>
        <section className="card content-card stack"><div className="row"><h2>Register and review</h2><button className="button" disabled={!!busy} onClick={() => void run('Refresh', () => refresh())}><RefreshCw size={16} /> Refresh fixture</button></div>
          <div className="actions"><button className="button" disabled={disabled} onClick={() => void run('Enroll circuit', enroll)}>Enroll simulated circuit</button>
            <button className="button" disabled={disabled} onClick={() => void run('Recover circuit', recover)}>Recover simulated circuit</button></div>
          {snapshot?.approval && <CopyValue label="Registry" value={snapshot.registry} explorer={`${explorer}/address/${snapshot.registry}`} />}
          <label className="field">Separate reviewer addresses<textarea value={reviewers} onChange={event => setReviewers(event.target.value)} placeholder="Two or more reviewer wallets, one per line" /></label>
          <label className="field">Approval threshold<input type="number" min={1} max={31} value={threshold} onChange={event => setThreshold(Number(event.target.value))} /></label>
          <button className="button" disabled={disabled} onClick={() => void run('Register policy', register)}>Register reviewer policy</button>
          <div className="actions"><button className="button" disabled={!!busy} onClick={() => void run('Build sample A', async () => candidate('a'))}>Load sample A</button>
            <button className="button" disabled={!!busy} onClick={() => void run('Build sample B', async () => candidate('b'))}>Load sample B</button>
            <label className="button upload">Upload build directory<input type="file" multiple {...{ webkitdirectory: '' }} onChange={event => {
              const files = event.currentTarget.files; void run('Build manifest', () => importBuild(files)); event.currentTarget.value = '';
            }} /></label></div>
          {manifest && <><p>Selected release {manifest.release} · {manifest.files.length} files</p><CopyValue label="Manifest digest" value={manifestDigest(manifest)} />
            <button className="button" onClick={() => download(`${manifest.release}.json`, manifest)}>Export manifest</button></>}
          <label><input type="checkbox" checked={rollback} disabled={!!busy} onChange={event => { setRollback(event.target.checked); setEvidence(undefined); }} /> Explicitly approve a rollback to a previously approved artifact</label>
          <div className="actions"><button className="button" disabled={!!busy || !manifest} onClick={() => void run('Prepare request', createRequest)}>Create approval request</button>
            <label className="button upload">Import signed request<input type="file" accept=".json" onChange={event => { const file = event.currentTarget.files?.[0]; void run('Import request', () => importRequest(file)); event.currentTarget.value = ''; }} /></label></div>
          {evidence && <div className="request-box"><strong>Release #{evidence.sequence} · {evidence.signatures.length} signatures{evidence.rollback ? ' · Rollback' : ''}</strong>
            <div className="actions"><button className="button" onClick={() => download('buidl-testnet-request.json', evidence)}>Export approval request</button>
              <button className="button" disabled={disabled} onClick={() => void run('Reviewer signing', () => approve(false))}>Sign as reviewer</button>
              <button className="button primary" disabled={disabled} onClick={() => void run('Record approval', () => approve(true))}>Record approval</button></div></div>}
        </section>
        <section className="card content-card stack"><h2>Publish and exercise the controls</h2>
          <div className="actions"><button className="button primary" disabled={disabled || !manifest} onClick={() => void run('Approved publishing', publish)}>Publish approved build</button>
            <button className="button" disabled={disabled} onClick={() => void run('Interrupted publication', interruption)}>Begin interrupted upload</button>
            <button className="button" disabled={disabled} onClick={() => void run('Controlled mismatch', changedFile)}>Test changed payment file</button>
            <button className="button" disabled={disabled} onClick={() => void run('Revoke approval', revoke)}>Revoke approval</button></div>
          <label className="field">New owner after recovery<input value={recipient} onChange={event => setRecipient(event.target.value)} placeholder="0x…" /></label>
          <button className="button" disabled={disabled || !recipient} onClick={() => void run('Ownership transfer', transfer)}>Transfer recovered circuit</button>
          <p>Recovery and a later enrollment invalidate the former policy and approval. Re-register a policy before signing a new release.</p>
        </section>
      </>}
      {snapshot && <section className="card content-card stack"><h2>{outcomes[result!]}</h2><p>Fixture check at block {snapshot.inspection.block?.number} · {checkedAt}</p>
        {manifest && <Diff local changes={compareTestnet(snapshot, manifest)} />}<Inventory inspection={snapshot.inspection} /></section>}
      {ledger.length > 0 && <section className="card content-card stack"><h2>Testnet receipts and results</h2>{ledger.slice().reverse().map((entry, index) => <details key={index}><summary>{entry.label} · {entry.status}</summary>
        <p>{entry.at} {entry.detail}</p>{entry.hash && <a href={`${explorer}/tx/${entry.hash}`} target="_blank" rel="noreferrer">{entry.hash}</a>}
        {entry.block && <p>Block {entry.block} · Gas {entry.gasUsed ?? '—'} · Paid {entry.paidWei ? formatEther(BigInt(entry.paidWei)) : '—'} test OKB</p>}</details>)}</section>}
      <footer><span><Blocks size={15} /> buidl</span><span>Testnet fixtures · No security audit attached.</span></footer>
    </main>
    {pending && <Modal title="Review testnet transaction" close={() => {
      if (signing) return;
      pending.reject(new Error('Transaction cancelled before signing. Any open upload remains incomplete.'));
      setPending(undefined);
    }}><div className="modal-body stack">
      <Badge tone="amber">X Layer testnet · Chain 1952</Badge><h3>{pending.plan.label}</h3>
      <CopyValue label="Sender" value={pending.plan.from} /><CopyValue label="Destination" value={pending.plan.to ?? 'New contract'} />
      <p>Value 0 test OKB · Gas limit {pending.plan.gas}</p>
      <strong>Estimated maximum at quoted gas price {formatEther(BigInt(pending.plan.estimatedWei))} test OKB</strong>
      <p>Your wallet shows the final gas quote. If you cancel, later transactions stop.</p>
      <button className="button primary" disabled={signing} onClick={() => void signPending()}>{signing ? 'Waiting for wallet or receipt…' : 'Continue in wallet'}</button>
    </div></Modal>}
  </div>;
}
