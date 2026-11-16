import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Blocks, Check, ChevronDown, CircleAlert, CircleHelp, Clipboard,
  CodeXml, FileCode2, FileJson, FolderOpen, GitCompareArrows, Globe2, History, Layers3, Link2, LoaderCircle,
  Menu, RefreshCw, Search, ShieldCheck, Upload, Wallet, X,
} from 'lucide-react';
import { type Address, type Hex } from 'viem';
import { foundry } from 'viem/chains';
import { approvalTypedData, parseEvidence, registryAbi, signaturesFor, siteTuple, type Evidence } from '../core/approval';
import { assertCurrentEvidence, compareLocal, inspectLocal, localClient, localHistory, localState, newRequest, outcomes, parseLocalConfig, type LocalConfig, type LocalState } from '../core/local';
import { address, compare, fileEntry, manifestDigest, MAX_FILE_BYTES, MAX_FILES, MAX_SITE_BYTES, parseManifest, sameSite, type Change, type Manifest } from '../core/manifest';
import { EXAMPLE_SITE, inspectLive, unavailable, XLAYER_EXPLORER, type FileResult, type Inspection } from '../core/tapeout';
import { walletClient, watchWallets, type Provider } from './wallet';
import { contentTypeFor } from '../core/content-type';
import paymentA from '../../demo/release-a/payment.json?raw';
import paymentB from '../../demo/release-b/payment.json?raw';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/dm-sans/wght.css';
import './style.css';

const sections = [
  { label: 'Inspection', icon: Search }, { label: 'Releases', icon: Layers3 },
  { label: 'Approvals', icon: ShieldCheck }, { label: 'Evidence', icon: History },
] as const;
type Section = typeof sections[number]['label'];
type HistoryLog = Awaited<ReturnType<typeof localHistory>>[number];
const short = (value: string, width = 8) => value.length > 2 * width + 2 ? value.slice(0, width) + '…' + value.slice(-width + 2) : value;
const formatBytes = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
const numeric = new Intl.NumberFormat('en');
const localDemoAvailable = import.meta.env.DEV && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
const statusName: Record<FileResult['status'], string> = { verified: 'Verified', incomplete: 'Incomplete', 'no-hash': 'No declared hash', missing: 'Missing', 'too-large': 'Too large', unavailable: 'Unavailable' };
const errorText = (error: unknown) => (error as { shortMessage?: string; message?: string })?.shortMessage || (error as Error)?.message || 'Operation failed.';

function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error('Local demo files are unavailable. Run npm run demo -- init.');
  return response.json();
}

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'purple' }) {
  return <span className={`badge ${tone}`}><span className="dot" />{children}</span>;
}

function CopyValue({ value, label, explorer }: { value?: string | null; label: string; explorer?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_400);
    } catch { setCopied(false); }
  }
  return <div className="datum"><span>{label}</span><div>
    {explorer && value ? <a className="mono" title={value} href={explorer} target="_blank" rel="noreferrer">{short(value, 10)} <ArrowUpRight size={13} /></a> :
      <code title={value ?? ''}>{value ? short(value, 10) : '—'}</code>}
    {value && <button type="button" className="icon-button copy" aria-label={`Copy ${label}`} title={copied ? 'Copied' : 'Copy'} onClick={copy}>{copied ? <Check size={14} /> : <Clipboard size={14} />}</button>}
  </div></div>;
}

function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [close]);
  return <div className="overlay" onClick={close}><section role="dialog" aria-modal="true" aria-label={title} className="modal" onClick={event => event.stopPropagation()}>
    <div className="card-head"><h2>{title}</h2><button className="icon-button" autoFocus onClick={close} aria-label="Close dialog"><X size={19} /></button></div>
    {children}
  </section></div>;
}

const demoText = new Map([paymentA, paymentB].map(text => [fileEntry('payment.json', 'application/json', new TextEncoder().encode(text)).sha256, text]));

function Diff({ changes, local = false }: { changes: readonly Change[]; local?: boolean }) {
  function display(value: Change['approved']) {
    if (typeof value === 'string') return value || '(empty)';
    if (!value) return '(absent)';
    const matchingBytes = local && value.path === 'payment.json' ? demoText.get(value.sha256) : undefined;
    return matchingBytes ? matchingBytes + '\nSHA-256 ' + value.sha256 : JSON.stringify(value, null, 2);
  }
  return changes.length > 0 && <div className="diff">{changes.map(change => <details key={change.kind + change.path}>
    <summary><Badge tone="amber">{change.kind}</Badge><code>{change.path}</code><small>{change.fields.join(', ')}</small></summary>
    <div className="diff-values"><div><b>Approved</b><pre>{display(change.approved)}</pre></div>
      <div><b>Deployed</b><pre>{display(change.deployed)}</pre></div></div>
  </details>)}</div>;
}

function Inventory({ inspection }: { inspection: Inspection }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<FileResult>();
  const [showAll, setShowAll] = useState(false);
  const files = inspection.files.filter(file => file.path.toLowerCase().includes(query.toLowerCase()));
  const visible = showAll ? files : files.slice(0, 8);
  return <section className="card inventory">
    <div className="card-head responsive-head"><div><h2>File inventory <span className="count">{inspection.files.length}</span></h2>
      <p>File sizes and SHA-256 digests at the pinned block.</p></div>
      <label className="filter"><Search size={16} /><input aria-label="Filter files" placeholder="Filter files…" value={query} onChange={e => { setQuery(e.target.value); setShowAll(false); }} /></label>
    </div>
    <div className="table-scroll"><table><thead><tr><th>File path</th><th>Size</th><th>SHA-256</th><th>Integrity</th><th aria-label="Details" /></tr></thead>
    <tbody>{visible.map(file => <tr key={file.path} onClick={() => setSelected(file)}>
      <td><div className="file-name"><FileCode2 size={17} /><button onClick={event => { event.stopPropagation(); setSelected(file); }} title={file.path}>{file.path}</button></div></td>
      <td className="muted">{formatBytes(file.bytes)}</td><td><code>{file.sha256 ? short(file.sha256) : '—'}</code></td>
      <td><Badge tone={file.status === 'verified' ? 'green' : 'amber'}>{statusName[file.status]}</Badge></td><td><ArrowUpRight size={15} /></td>
    </tr>)}</tbody></table></div>
    {!visible.length && <p className="empty">{query ? 'No files match the filter.' : 'No file inventory available.'}</p>}
    {files.length > 8 && <div className="table-footer">Showing {visible.length} of {files.length} files <button className="button small" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : 'Show all files'}</button></div>}
    {selected && <Modal title="File integrity" close={() => setSelected(undefined)}><div className="modal-body stack">
      <p className="break"><FileCode2 size={16} /> {selected.path}</p><Badge tone={selected.status === 'verified' ? 'green' : 'amber'}>{statusName[selected.status]}</Badge>
      <CopyValue value={selected.sha256} label="Computed SHA-256" /><CopyValue value={selected.declared} label="Declared SHA-256" />
      <CopyValue value={selected.type} label="Content type" /><CopyValue value={String(selected.bytes)} label="Bytes" />
    </div></Modal>}
  </section>;
}

function App() {
  const [section, setSection] = useState<Section>('Inspection');
  const [mobileNav, setMobileNav] = useState(false);
  const [mode, setMode] = useState<'live' | 'local'>('live');
  const [input, setInput] = useState(EXAMPLE_SITE);
  const [inspection, setInspection] = useState<Inspection>();
  const [config, setConfig] = useState<LocalConfig>();
  const [state, setState] = useState<LocalState>();
  const [history, setHistory] = useState<HistoryLog[]>([]);
  const [manifest, setManifest] = useState<Manifest>();
  const [evidence, setEvidence] = useState<Evidence>();
  const [reviewed, setReviewed] = useState<Address[]>([]);
  const [busy, setBusy] = useState('');
  const running = useRef(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [wallet, setWallet] = useState<(Provider & { account: Address })>();
  const [walletDialog, setWalletDialog] = useState(false);
  const [help, setHelp] = useState(false);
  const [releaseName, setReleaseName] = useState('v1.0.0');
  const [fallback, setFallback] = useState('');
  const [rollback, setRollback] = useState(false);
  const [reviewersInput, setReviewersInput] = useState('');
  const [threshold, setThreshold] = useState(2);

  useEffect(() => watchWallets(provider => setProviders(list => list.some(p => p.provider === provider.provider) ? list : [...list, provider])), []);
  useEffect(() => { void inspect(EXAMPLE_SITE); }, []);
  useEffect(() => {
    if (!wallet) return;
    function onAccounts(accounts: Address[]) {
      if (!accounts.some(account => account.toLowerCase() === wallet?.account)) setWallet(undefined);
    }
    wallet.provider.on?.('accountsChanged', onAccounts);
    return () => { wallet.provider.removeListener?.('accountsChanged', onAccounts); };
  }, [wallet]);

  async function run(action: string, work: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(action);
    setNotice(undefined);
    try { await work(); }
    catch (error) { setNotice({ text: errorText(error), error: true }); }
    finally { running.current = false; setBusy(''); }
  }

  async function inspect(identifier: string) {
    await run('inspect', async () => {
      setMode('live');
      setState(undefined);
      setHistory([]);
      setInspection(undefined);
      setInspection(await inspectLive(identifier));
    });
  }

  async function refreshLocal(trusted: LocalConfig) {
    setState(undefined);
    try {
      const next = await localState(trusted);
      const [deployment, logs] = await Promise.all([inspectLocal(trusted, undefined, next.block.number), localHistory(trusted, undefined, next.block.number)]);
      setState(next);
      setHistory(logs);
      setInspection(deployment);
    } catch (error) {
      setHistory([]);
      setInspection(unavailable('local', 'Payment demo', errorText(error)));
    }
  }

  async function loadLocal() {
    await run('local', async () => {
      if (!localDemoAvailable) throw new Error('The controlled demo runs on loopback with Anvil.');
      const next = parseLocalConfig(await fetchJson('/local-demo/config.json'));
      await refreshLocal(next);
      setConfig(next);
      setMode('local');
      setSection('Inspection');
    });
  }

  function useManifest(next: Manifest) {
    setManifest(next);
    setEvidence(undefined);
    setReviewed([]);
  }

  async function importManifest(file?: File) {
    if (!file) return;
    await run('import', async () => {
      if (file.size > 4 * 1024 * 1024) throw new Error('Manifest file is too large.');
      useManifest(parseManifest(JSON.parse(await file.text())));
      setNotice({ text: 'Release manifest loaded.' });
    });
  }

  async function generate(files: FileList | null) {
    if (!files?.length) return;
    await run('generate', async () => {
      if (!inspection?.site) throw new Error('Resolve a site before creating a manifest.');
      const selected = Array.from(files);
      if (selected.length > MAX_FILES || selected.some(file => file.size > MAX_FILE_BYTES) || selected.reduce((sum, file) => sum + file.size, 0) > MAX_SITE_BYTES) throw new Error('Build directory exceeds the manifest limits.');
      const entries = [];
      for (const file of selected) {
        const path = file.webkitRelativePath.split('/').slice(1).join('/') || file.name;
        entries.push(fileEntry(path, contentTypeFor(path), new Uint8Array(await file.arrayBuffer())));
      }
      useManifest(parseManifest({ schemaVersion: 1, site: inspection.site, release: releaseName, routing: { fallback }, files: entries }));
      setNotice({ text: 'Release manifest created.' });
    });
  }

  async function switchChain(provider: Provider, account?: Address) {
    const chainId = mode === 'local' ? 31337 : 196;
    const client = walletClient(provider.provider, chainId, account);
    if (await client.getChainId() !== chainId) {
      try { await client.switchChain({ id: chainId }); }
      catch (error) {
        const failure = error as { code?: number; cause?: { code?: number; cause?: { code?: number } } };
        if (![failure.code, failure.cause?.code, failure.cause?.cause?.code].includes(4902)) throw error;
        await client.addChain({ chain: mode === 'local' ? foundry : client.chain });
        await client.switchChain({ id: chainId });
      }
    }
    if (await client.getChainId() !== chainId) throw new Error('Wallet is connected to the wrong network.');
    return client;
  }

  async function connect(provider: Provider) {
    await run('wallet', async () => {
      const client = walletClient(provider.provider, mode === 'local' ? 31337 : 196);
      const [account] = await client.requestAddresses();
      if (!account) throw new Error('Wallet did not provide an account.');
      await switchChain(provider, account);
      setWallet({ ...provider, account: address(account) });
      setWalletDialog(false);
    });
  }

  const local = mode === 'local' ? config : undefined;
  const comparison = local && state && inspection ? compareLocal(inspection, state, manifest) : undefined;
  const compatible = inspection?.artifacts && manifest && sameSite(inspection.artifacts.site, manifest.site);
  const previewDiff = mode === 'live' && compatible && manifest && inspection?.artifacts ? compare(manifest, inspection.artifacts) : undefined;
  const verified = inspection?.files.filter(f => f.status === 'verified').length ?? 0;
  const complete = inspection?.status === 'complete';
  const explorer = mode === 'live' ? XLAYER_EXPLORER : undefined;
  const loadedRelease = evidence && manifest && manifestDigest(evidence.manifest) === manifestDigest(manifest);
  const recorded = state?.commitment.approval.sequence;
  const requestClosed = !!(evidence && recorded && recorded >= BigInt(evidence.sequence));
  const recordedPolicy = history.find(log => log.eventName === 'PolicySet' && log.args.version === state?.commitment.approval.policyVersion);
  const reviewerCount = recordedPolicy?.eventName === 'PolicySet' ? recordedPolicy.args.reviewers?.length : undefined;

  function requireLocal() {
    if (!local) throw new Error('Start the local demo to use the approval registry.');
    return local;
  }

  async function requestApproval() {
    await run('request', async () => {
      if (!manifest) throw new Error('Create or import a manifest first.');
      const local = requireLocal();
      const state = await localState(local);
      const next = await newRequest(local, manifest, Number(state.block.timestamp) + 86_400, rollback);
      setEvidence(next);
      setReviewed([]);
      setNotice({ text: `Release #${next.sequence} is ready for reviewer signatures.` });
    });
  }

  async function importEvidence(file?: File) {
    if (!file) return;
    await run('evidence', async () => {
      const local = requireLocal();
      if (file.size > 4 * 1024 * 1024) throw new Error('Evidence file is too large.');
      const imported = parseEvidence(JSON.parse(await file.text()));
      const sameRequest = evidence && evidence.registry === imported.registry && evidence.instanceSalt === imported.instanceSalt &&
        evidence.policyVersion === imported.policyVersion && evidence.sequence === imported.sequence && evidence.expiry === imported.expiry &&
        evidence.rollback === imported.rollback && manifestDigest(evidence.manifest) === manifestDigest(imported.manifest);
      const next = sameRequest ? { ...imported, signatures: [...new Set([...evidence.signatures, ...imported.signatures])] } : imported;
      const state = await localState(local);
      assertCurrentEvidence(local, next, state);
      const signatures = await signaturesFor(next, state.policy, false);
      setEvidence(next);
      setManifest(next.manifest);
      setReviewed(signatures.map(([account]) => account));
      setNotice({ text: 'Approval request loaded.' });
    });
  }

  async function signOrRecord(record: boolean) {
    await run(record ? 'record' : 'sign', async () => {
      const local = requireLocal();
      if (!wallet || !evidence) throw new Error('Connect a wallet and load an approval request.');
      const state = await localState(local);
      assertCurrentEvidence(local, evidence, state);
      const client = await switchChain(wallet, wallet.account);
      if (!(await client.getAddresses()).some(account => address(account) === wallet.account)) throw new Error('Connect the active wallet account again.');
      const typed = approvalTypedData(evidence);
      if (record) {
        const signatures = await signaturesFor(evidence, state.policy);
        const hash = await client.writeContract({ account: wallet.account, address: local.registry, abi: registryAbi, functionName: 'record',
          args: [siteTuple(local.site), typed.message, signatures.map(([, signature]) => signature)] });
        const receipt = await localClient().waitForTransactionReceipt({ hash, timeout: 30_000 });
        if (receipt.status !== 'success') throw new Error('Recording the release reverted.');
        await refreshLocal(local);
        setNotice({ text: 'Release approval recorded on Anvil.' });
        return;
      }
      if (!state.policy.reviewers.some(reviewer => address(reviewer) === wallet.account)) throw new Error('Connected wallet is outside the active reviewer policy.');
      if (reviewed.includes(wallet.account)) throw new Error('This reviewer has already signed.');
      const signature = await client.signTypedData({ account: wallet.account, ...typed });
      const next = { ...evidence, signatures: [...evidence.signatures, signature] };
      const signers = await signaturesFor(next, state.policy, false);
      setEvidence(next);
      setReviewed(signers.map(([account]) => account));
      setNotice({ text: 'Reviewer signature added.' });
    });
  }

  async function mutatePolicy(revoke: boolean) {
    await run(revoke ? 'revoke' : 'policy', async () => {
      const local = requireLocal();
      if (!wallet || !inspection?.holder || address(inspection.holder) !== wallet.account) throw new Error('Connect the current publishing holder.');
      const client = await switchChain(wallet, wallet.account);
      const common = { account: wallet.account, address: local.registry, abi: registryAbi } as const;
      let tx: Hex;
      if (revoke) {
        if (!recorded) throw new Error('No release to revoke.');
        tx = await client.writeContract({ ...common, functionName: 'revoke', args: [siteTuple(local.site), recorded] });
      } else {
        const reviewers = reviewersInput.split(/[\s,]+/).filter(Boolean).map(address).sort();
        if (reviewers.length > 31 || new Set(reviewers).size !== reviewers.length || reviewers.includes(wallet.account) || !Number.isSafeInteger(threshold) || threshold < 1 || threshold > reviewers.length) throw new Error('Provide unique independent reviewers and a valid threshold.');
        tx = await client.writeContract({ ...common, functionName: 'setPolicy', args: [siteTuple(local.site), reviewers, BigInt(threshold)] });
      }
      if ((await localClient().waitForTransactionReceipt({ hash: tx, timeout: 30_000 })).status !== 'success') throw new Error('Policy transaction reverted.');
      await refreshLocal(local);
      if (!revoke) { setEvidence(undefined); setReviewed([]); }
      setNotice({ text: revoke ? 'Current release revoked.' : 'New policy version recorded.' });
    });
  }

  function nav(next: Section) { setSection(next); setMobileNav(false); }

  return <div className="shell">
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
      <button className="brand" onClick={() => nav('Inspection')} aria-label="buidl home"><span className="mark"><Blocks size={23} strokeWidth={2.25} /></span><span>buidl<span className="brand-period">.</span></span></button>
      <div className="workspace"><span className="workspace-icon"><Layers3 size={17} /></span><div><b>Release Control</b><small>DeWEB workspace</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>{sections.map(({ label, icon: Icon }) => <button key={label} onClick={() => nav(label)} className={section === label ? 'nav active' : 'nav'} aria-current={section === label ? 'page' : undefined}><Icon size={18} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-bottom">
        {localDemoAvailable && <button className="nav dev-nav" disabled={!!busy} onClick={() => mode === 'local' ? void inspect(input) : void loadLocal()}><CodeXml size={17} />{mode === 'local' ? 'Back to mainnet' : 'Local demo'}</button>}
        <button className="nav" onClick={() => setHelp(true)}><CircleHelp size={17} /> How it works</button>
        <div className="sidebar-network"><span className="network-glyph">X</span><div><b>{mode === 'live' ? 'X Layer' : 'Anvil'}</b><small>{mode === 'live' ? 'Mainnet · Chain 196' : 'Local · Chain 31337'}</small></div></div>
      </div>
    </aside>
    <div className="stage">
      <header className="topbar">
        <button className="icon-button mobile-menu" onClick={() => setMobileNav(!mobileNav)} aria-label="Toggle navigation"><Menu size={22} /></button>
        <div className="breadcrumb"><span>Workspace</span><span>/</span><strong>{section}</strong></div>
        <div className="header-actions"><Badge tone={mode === 'live' ? 'green' : 'amber'}>{mode === 'live' ? 'X Layer mainnet' : 'Local Anvil'}</Badge>
          <button className="button wallet-button" onClick={() => setWalletDialog(true)}><Wallet size={16} />{wallet ? short(wallet.account, 7) : 'Connect wallet'}{wallet && <ChevronDown size={13} />}</button>
        </div>
      </header>
      <main className="content">
        {notice && <div role={notice.error ? 'alert' : 'status'} className={`notice ${notice.error ? 'error' : ''}`}>{notice.error ? <CircleAlert size={18} /> : <Check size={18} />}<span>{notice.text}</span><button className="icon-button" onClick={() => setNotice(undefined)} aria-label="Dismiss message"><X size={15} /></button></div>}

        {section === 'Inspection' && <>
          <div className="page-head"><div><div className="eyebrow"><Activity size={15} /> ONCHAIN VERIFICATION</div><h1>Deployment inspection</h1><p>Resolve a DeWEB site, verify its files, and check which release is approved.</p></div>
            {inspection?.site && <button className="button export-button" onClick={() => download('buidl-inspection.json', inspection)}><ArrowDownToLine size={16} /> Export inspection</button>}
          </div>
          <section className="inspect-card">
            <div className="inspect-icon"><Globe2 size={22} /></div>
            <div className="inspect-content"><h2>{mode === 'live' ? 'Inspect a DeWEB site' : 'Inspect the payment demo'}</h2><p>{mode === 'live' ? 'Enter an X Layer tape name or a scoped container address.' : 'Read the controlled deployment and approval registry on your local chain.'}</p>
              <form className="search-row" onSubmit={(event: FormEvent) => { event.preventDefault(); if (local) void run('inspect', () => refreshLocal(local)); else void inspect(input); }}>
                <label className="site-input"><Search size={19} /><input aria-label="DeWEB identifier" value={local ? 'Payment demo · Anvil' : input} readOnly={!!local} onChange={e => setInput(e.target.value)} placeholder="e.g. 1.2.230.tape" required /></label>
                <button className="button primary" disabled={!!busy}>{busy === 'inspect' || busy === 'local' ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}{busy === 'inspect' ? 'Inspecting…' : local ? 'Refresh deployment' : 'Inspect site'}</button>
              </form>
              {!local && <button className="example" onClick={() => { setInput(EXAMPLE_SITE); void inspect(EXAMPLE_SITE); }} disabled={!!busy}>Try the live example <code>{EXAMPLE_SITE}</code><ArrowUpRight size={13} /></button>}
              {local && <button className="example" disabled={!!busy} onClick={() => nav('Releases')}>Load a demo release <ArrowRight size={14} /></button>}
            </div>
          </section>
          <div className="section-title"><h2>Deployment overview</h2>{inspection?.block && <span className="pinned"><span className="dot" /> Pinned snapshot</span>}</div>
          <div className="stats">
            <section className="card stat"><div className="stat-label"><span className="stat-icon"><ShieldCheck size={19} /></span> Content integrity</div><strong>{complete ? 'Verified' : inspection ? inspection.status === 'partial' ? 'Incomplete' : inspection.status === 'empty' ? 'No files' : 'Unavailable' : 'Checking…'}</strong><span>{inspection?.files.length ? `${verified} of ${inspection.files.length} files verified` : 'SHA-256 byte verification'}</span></section>
            <section className="card stat"><div className="stat-label"><span className="stat-icon blue"><Link2 size={19} /></span> Pinned block</div><strong>{inspection?.block ? numeric.format(Number(inspection.block.number)) : '—'}</strong><span>{mode === 'live' ? 'Two independent RPC operators' : 'Anvil loopback RPC'}</span></section>
            <section className="card stat"><div className="stat-label"><span className="stat-icon gold"><GitCompareArrows size={19} /></span> Release approval</div><strong className="approval-stat">{comparison?.outcome === 'match' ? 'Release matches' : comparison?.outcome === 'differs' ? 'Deployment differs' : comparison?.outcome === 'revoked' ? 'Revoked or expired' : (comparison?.outcome === 'unavailable' || (local && !state && inspection?.status === 'unavailable')) ? 'Verification unavailable' : mode === 'live' ? 'Registry unavailable' : 'No qualifying approval'}</strong><span>{mode === 'live' ? 'Read-only mainnet inspection' : 'Independent reviewer policy'}</span></section>
          </div>
          {inspection?.detail && <div className="notice error"><CircleAlert size={18} /> <span>{inspection.detail}</span></div>}
          {inspection?.site && <section className="card identity"><div className="card-head responsive-head"><div><div className="identity-title"><span className="identity-icon"><Globe2 size={17} /></span><h2>{inspection.name}</h2></div><p>Resolved deployment identity</p></div><Badge tone={inspection.activation === 'active' ? 'green' : 'neutral'}>{inspection.activation === 'active' ? 'Activated on DeWEB' : inspection.activation === 'inactive' ? 'Name inactive' : inspection.activation === 'local' ? 'Controlled local site' : 'Activation unavailable'}</Badge></div>
            <div className="identity-grid">
              <CopyValue label="Container" value={inspection.site.container} explorer={explorer && `${explorer}/address/${inspection.site.container}`} />
              <CopyValue label="Processor" value={inspection.site.processor} explorer={explorer && `${explorer}/address/${inspection.site.processor}`} />
              <CopyValue label="Circuit ID" value={inspection.site.circuitId} />
              <CopyValue label="Holder" value={inspection.holder} explorer={explorer && inspection.holder ? `${explorer}/address/${inspection.holder}` : undefined} />
              <CopyValue label="Block hash" value={inspection.block?.hash} explorer={explorer && inspection.block ? `${explorer}/block/${inspection.block.number}` : undefined} />
              <CopyValue label="Fallback path" value={inspection.fallback || '(none)'} />
            </div>
          </section>}
          {inspection && <Inventory key={inspection.name} inspection={inspection} />}
          {comparison && <section className="card content-card"><h2>{outcomes[comparison.outcome]}</h2>
            <p>{manifest ? manifest.release : 'Load the current approved manifest to compare the deployment.'}</p><Diff changes={comparison.changes} local /></section>}
          {previewDiff && <section className="card content-card"><h2>{previewDiff.length ? 'Deployment differs from imported manifest.' : 'Deployment matches imported artifacts.'}</h2><p>Artifact comparison only. Approval verification requires a configured registry.</p><Diff changes={previewDiff} /></section>}
        </>}

        {section === 'Releases' && <>
          <div className="page-head"><div><div className="eyebrow"><Layers3 size={15} /> RELEASE MANAGEMENT</div><h1>Release manifests</h1><p>Commit to the bytes, paths, and routing rules for a production build.</p></div></div>
          <div className="work-grid"><section className="card content-card stack"><h2>Build a manifest</h2><p>Select the output directory of an existing production build.</p>
            <label className="field">Release identifier<input value={releaseName} onChange={e => setReleaseName(e.target.value)} /></label>
            <label className="field">Fallback path<input placeholder="Optional, e.g. index.html" value={fallback} onChange={e => setFallback(e.target.value)} /></label>
            <label className="button primary upload"><FolderOpen size={17} /> Select build folder<input type="file" multiple {...{ webkitdirectory: '' }} disabled={!!busy} onChange={e => { void generate(e.currentTarget.files); e.currentTarget.value = ''; }} /></label>
          </section><section className="card content-card stack"><h2>Import a manifest</h2><p>Use the JSON generated with the buidl CLI or shared by a teammate.</p>
            <label className="button upload"><Upload size={17} /> Import JSON<input type="file" accept=".json,application/json" onChange={e => { void importManifest(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} /></label>
            {local && <div className="actions">{['a', 'b'].map(name => <button key={name} className="button" onClick={() => void run('import', async () => useManifest(parseManifest(await fetchJson(`/local-demo/manifest-${name}.json`))))}>Load demo {name.toUpperCase()}</button>)}</div>}
          </section></div>
          {manifest && <section className="card content-card stack"><div className="row"><div><h2>{manifest.release}</h2><p>{manifest.files.length} files · schema {manifest.schemaVersion} · chain {manifest.site.chainId}</p></div><Badge tone="purple">Manifest loaded</Badge></div>
            <CopyValue label="Manifest digest" value={manifestDigest(manifest)} /><CopyValue label="Container" value={manifest.site.container} />
            <div className="actions"><button className="button" onClick={() => download(`${manifest.release}.json`, manifest)}><ArrowDownToLine size={16} /> Download manifest</button><button className="button primary" onClick={() => nav('Approvals')}>Continue to approvals <ArrowRight size={16} /></button></div>
          </section>}
          <section className="card content-card stack"><h2>Publish an approved build</h2><p>{local ? 'The local CLI checks the exact build against the active registry commitment, then uploads the staged bytes.' : 'Live X Layer is read-only here. TapeOut holders can publish through the SiteRegistry workflow documented in the integration guide.'}</p>
            {local && <pre className="command">npm run buidl -- publish-local &lt;build-dir&gt; &lt;manifest.json&gt; public/local-demo/config.json</pre>}
          </section>
        </>}

        {section === 'Approvals' && <>
          <div className="page-head"><div><div className="eyebrow"><ShieldCheck size={15} /> INDEPENDENT REVIEW</div><h1>Release approvals</h1><p>Collect typed reviewer signatures for a specific release.</p></div></div>
          {!local && <section className="card content-card stack"><h2>Approval registry on Anvil</h2><p>Start the controlled local demo for policy onboarding, wallet signing, and release commitments.</p>{localDemoAvailable && <button className="button" onClick={() => void loadLocal()}>Open local demo <ArrowRight size={16} /></button>}</section>}
          {local && <>
            <div className="work-grid"><section className="card content-card stack"><div className="row"><h2>Approval policy</h2><Badge tone={state?.authorityCurrent ? 'green' : 'amber'}>{state?.authorityCurrent ? `Version ${state.policy.version}` : 'Onboarding needed'}</Badge></div>
              <p>{state?.policy.reviewers.length ? `${state.policy.threshold} of ${state.policy.reviewers.length} configured reviewers` : 'Configure independent reviewer addresses with the holder wallet.'}</p>
              {state?.policy.reviewers.map(reviewer => <CopyValue key={reviewer} label="Reviewer" value={reviewer} />)}
              <details><summary>Set or rotate policy</summary><div className="stack"><label className="field">Reviewer addresses<textarea value={reviewersInput} onChange={e => setReviewersInput(e.target.value)} placeholder="One address per line" /></label><label className="field">Threshold<input type="number" min={1} max={31} value={threshold} onChange={e => setThreshold(Number(e.target.value))} /></label>
                <p>Creating a new version invalidates the previous release commitment.</p><button className="button" disabled={!!busy || !wallet} onClick={() => void mutatePolicy(false)}>Record policy version</button></div></details>
            </section>
            <section className="card content-card stack"><h2>Approval request</h2><p>{manifest ? `Selected manifest · ${manifest.release}` : 'Create or import a release manifest first.'}</p><label className="checkbox"><input type="checkbox" checked={rollback} onChange={e => setRollback(e.target.checked)} /> Explicit rollback</label>
              <div className="actions"><button className="button primary" disabled={!manifest || !!busy} onClick={() => void requestApproval()}>Create request</button><label className="button upload"><Upload size={16} /> Import request<input type="file" accept=".json" onChange={e => { void importEvidence(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} /></label></div>
              {loadedRelease && evidence && <div className="request-box"><strong>Release #{evidence.sequence} · {reviewed.length} signature{reviewed.length === 1 ? '' : 's'}</strong><small>Expires {new Date(evidence.expiry * 1_000).toLocaleString()}</small>
                <div className="actions"><button className="button" onClick={() => download(`approval-${evidence.sequence}.json`, evidence)}><ArrowDownToLine size={16} /> Export request</button><button className="button" disabled={!wallet || !!busy || requestClosed} onClick={() => void signOrRecord(false)}><Wallet size={16} /> Sign approval</button><button className="button primary" disabled={!wallet || !!busy || requestClosed || reviewed.length < Number(state?.policy.threshold ?? 1n)} onClick={() => void signOrRecord(true)}>Record approval</button></div>
              </div>}
            </section></div>
            {!!recorded && <section className="card content-card stack"><h2>Current commitment</h2><p>Release #{String(recorded)} · {state?.commitment.revoked ? 'Revoked' : `Approved by ${state?.commitment.signers.length} of ${reviewerCount ?? '—'} configured reviewers at recording`}</p><CopyValue label="Manifest digest" value={state?.commitment.approval.manifestDigest} />
              {state?.commitment.signers.map(signer => <CopyValue key={signer} label="Signer" value={signer} />)}
              <button className="button danger" disabled={!!busy || !wallet || state?.commitment.revoked} onClick={() => void mutatePolicy(true)}>Revoke current release</button>
            </section>}
          </>}
        </>}

        {section === 'Evidence' && <>
          <div className="page-head"><div><div className="eyebrow"><History size={15} /> RELEASE EVIDENCE</div><h1>Evidence &amp; history</h1><p>Review approval commitments, reviewer addresses, and deployment snapshots.</p></div>
            {local && <button className="button" disabled={!!busy} onClick={() => void run('refresh', () => refreshLocal(local))}><RefreshCw size={16} /> Refresh evidence</button>}</div>
          <section className="card content-card stack"><div className="row"><h2>Deployment evidence</h2><Badge tone={complete ? 'green' : 'neutral'}>{complete ? 'Content verified' : 'Verification pending'}</Badge></div>
            <p>{inspection?.name || 'Inspect a deployment to capture a snapshot.'} · No security audit attached.</p>
            {comparison && <><h3>{outcomes[comparison.outcome]}</h3><Diff changes={comparison.changes} local /></>}
            {inspection?.site && <button className="button" onClick={() => download('buidl-inspection.json', inspection)}><ArrowDownToLine size={16} /> Download inspection</button>}
          </section>
          <section className="card content-card stack"><h2>Registry history</h2><p>{local ? 'Transactions on your controlled local chain.' : 'No buidl registry is deployed for live X Layer inspection.'}</p>
            {local && <CopyValue label="Approval registry" value={local.registry} />}
            {history.map(log => <details className="event" key={log.transactionHash + String(log.logIndex)}><summary><strong>{log.eventName === 'PolicySet' ? 'Policy updated' : log.eventName === 'ReleaseRecorded' ? `Release #${log.args.sequence} recorded` : `Release #${log.args.sequence} revoked`}</strong> <small>Block {String(log.blockNumber)}</small></summary>
              <CopyValue label="Transaction" value={log.transactionHash} /><pre>{JSON.stringify(log.args, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2)}</pre></details>)}
          </section>
        </>}
        <footer><span><Blocks size={15} /> buidl</span><span>Content integrity and independent release approval</span></footer>
      </main>
    </div>
    {walletDialog && <Modal title="Connect wallet" close={() => setWalletDialog(false)}><div className="modal-body stack">
      <p>{mode === 'live' ? 'X Layer mainnet · Chain 196' : 'Local Anvil · Chain 31337'}</p>
      {wallet && <div className="stack"><CopyValue label="Connected account" value={wallet.account} /><button className="button" onClick={() => { setWallet(undefined); setWalletDialog(false); }}>Disconnect</button></div>}
      {providers.length ? providers.map((provider, i) => <button key={i} className="button provider" disabled={!!busy} onClick={() => void connect(provider)}><Wallet size={16} />{provider.name}<ArrowRight size={16} /></button>) : <p>No browser wallet was found. Open buidl directly in a browser with an injected wallet such as OKX Wallet.</p>}
      {notice?.error && <p role="alert">{notice.text}</p>}
    </div></Modal>}
    {help && <Modal title="How buidl works" close={() => setHelp(false)}><div className="modal-body stack">
      <p>Inspection resolves a site through TapeOut, reads its files at a pinned block, and verifies their SHA-256 digests.</p>
      <p>A release matches when the verified files and routing equal the manifest held by the current approval commitment. The approval policy requires independent reviewers.</p>
      <p>Publishing wallets can bypass the release gate. A fresh inspection can show the resulting difference. No security audit attached.</p>
      <a href="https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-10.md" target="_blank" rel="noreferrer">Read the DeWEB specification <ArrowUpRight size={14} /></a>
    </div></Modal>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
