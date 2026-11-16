import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowUpRight, Blocks, Link2, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { compareCommitment, inspectLocal, localState, outcomes, parseLocalConfig, type LocalState } from '../core/local';
import { digest } from '../core/manifest';
import { unavailable, XLAYER_EXPLORER, type Inspection } from '../core/tapeout';
import { checkXLayer, type XLayerApproval } from '../core/xlayer-release';
import { Badge, CopyValue, Inventory } from './evidence-components';
import { download, errorText, fetchJson, localDemoAvailable, numeric } from './web-utils';

const recheckMs = 60_000;
type Outcome = keyof typeof outcomes;

export function verificationLink(site: string, state?: LocalState | XLayerApproval) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('verify', site);
  if (state) {
    if (site === 'local') url.searchParams.set('instance', state.instanceSalt);
    if (state.commitment.approval.sequence > 0n) url.searchParams.set('release', state.commitment.approval.manifestDigest);
  }
  return url.href;
}

type Report = {
  inspected: Inspection;
  checkedAt: string;
  outcome: Outcome;
  note?: string;
  approval?: {
    registry: string;
    manifestDigest: string;
    artifactDigest: string;
    policyVersion: string;
    sequence: string;
    expiry: string;
    signers: readonly string[];
    reviewerCount?: number;
    threshold?: number;
  };
};

async function verify(site: string, instance: string | null, release: string | null): Promise<Omit<Report, 'checkedAt'>> {
  if (site !== 'local') {
    const { inspection, approval, outcome, reason } = await checkXLayer(site);
    if (!approval) return { inspected: inspection, outcome, note: reason ?? 'No recognized buidl authority currently holds this site’s circuit.' };
    if (release && digest(release) !== approval.commitment.approval.manifestDigest) {
      return { inspected: inspection, outcome: 'none', note: 'This release is no longer the registry’s current commitment.' };
    }
    const { approval: entry, signers } = approval.commitment;
    const current = approval.authorityCurrent && approval.policy.version === entry.policyVersion;
    return {
      inspected: inspection, outcome,
      note: approval.publication.inProgress ? 'The site has an open publication attempt.' :
        inspection.activation === 'inactive' ? 'The TapeOut name is inactive at this block.' : undefined,
      approval: entry.sequence === 0n ? undefined : {
        registry: approval.registry, manifestDigest: entry.manifestDigest, artifactDigest: entry.artifactDigest,
        policyVersion: entry.policyVersion.toString(), sequence: entry.sequence.toString(),
        expiry: new Date(Number(entry.expiry) * 1000).toISOString(), signers,
        reviewerCount: current ? approval.policy.reviewers.length : undefined,
        threshold: current ? Number(approval.policy.threshold) : undefined,
      },
    };
  }
  if (!localDemoAvailable) throw new Error('This link requires the local buidl dev server and its Anvil demo.');
  const config = parseLocalConfig(await fetchJson('/local-demo/config.json'));
  const state = await localState(config);
  if (digest(instance) !== state.instanceSalt) throw new Error('This link refers to a different Anvil registry instance.');
  const requestedRelease = release === null ? undefined : digest(release);
  const inspected = await inspectLocal(config, undefined, state.block.number);
  const outcome = compareCommitment(inspected, state, requestedRelease);
  if (outcome === 'unavailable') return { inspected, outcome };

  const { approval, signers } = state.commitment;
  const superseded = requestedRelease && approval.manifestDigest !== requestedRelease;
  const policyCurrent = state.authorityCurrent && state.policy.version === approval.policyVersion;
  return {
    inspected,
    outcome,
    note: superseded ? 'This release is no longer the registry’s current commitment.' : undefined,
    approval: approval.sequence === 0n || superseded ? undefined : {
      registry: config.registry, manifestDigest: approval.manifestDigest, artifactDigest: approval.artifactDigest,
      policyVersion: approval.policyVersion.toString(), sequence: approval.sequence.toString(),
      expiry: new Date(Number(approval.expiry) * 1000).toISOString(),
      signers, reviewerCount: policyCurrent ? state.policy.reviewers.length : undefined,
      threshold: policyCurrent ? Number(state.policy.threshold) : undefined,
    },
  };
}

export function PublicVerification({ site, query }: { site: string; query: URLSearchParams }) {
  const local = site === 'local';
  const instance = query.get('instance');
  const release = query.get('release');
  const [attempt, setAttempt] = useState(0);
  const [report, setReport] = useState<Report>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      if (cancelled) return;
      setReport(undefined);
      let result: Omit<Report, 'checkedAt'>;
      try {
        result = await verify(site, instance, release);
      } catch (error) {
        result = { inspected: unavailable(local ? 'local' : 'live', site, errorText(error)), outcome: 'unavailable' };
      }
      if (cancelled) return;
      setReport({ ...result, checkedAt: new Date().toISOString() });
      timer = setTimeout(refresh, recheckMs);
    }
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [site, local, instance, release, attempt]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const inspected = report?.inspected;
  const verified = inspected?.files.filter(file => file.status === 'verified').length;
  const approval = report?.approval;
  const explorer = local ? undefined : XLAYER_EXPLORER;
  const blockLink = explorer && inspected?.block ? `${explorer}/block/${inspected.block.number}` : undefined;
  return <div className="verification-shell">
    <header className="topbar verification-topbar">
      <a className="brand" href={location.pathname}><span className="mark"><Blocks size={22} /></span><span>buidl<span className="brand-period">.</span></span></a>
      <div className="header-actions">
        <Badge tone={local ? 'amber' : 'purple'}>{local ? 'Local Anvil' : 'X Layer mainnet'}</Badge>
        <a className="button" href={location.pathname}><ArrowLeft size={15} /> Dashboard</a>
      </div>
    </header>
    <main className="content verification-content">
      <div className="page-head"><div><div className="eyebrow"><ShieldCheck size={16} /> PUBLIC VERIFICATION</div>
        <h1>{local ? 'Payment demo' : inspected?.site ? inspected.name : 'Verify a DeWEB release'}</h1>
        <p>{local ? 'Controlled loopback deployment · Chain 31337' : 'X Layer mainnet · Chain 196'}</p>
      </div><div className="actions">
        <button className="button" onClick={() => void copy()}><Link2 size={16} /> {copied ? 'Link copied' : 'Copy verification link'}</button>
        <button className="button primary" disabled={!report} onClick={() => { setReport(undefined); setAttempt(value => value + 1); }}>
          {report ? <RefreshCw size={16} /> : <LoaderCircle className="spin" size={16} />} {report ? 'Recheck now' : 'Checking…'}
        </button>
      </div></div>

      <section className="inspect-card verification-summary" aria-live="polite">
        <div className="inspect-icon"><ShieldCheck size={22} /></div>
        <div className="inspect-content">
          <h2>{report ? outcomes[report.outcome] : 'Checking deployment and approval…'}</h2>
          {report?.note && <p>{report.note}</p>}
          {inspected?.detail && <p>{inspected.detail}</p>}
          {report && <p>Checked at <time dateTime={report.checkedAt}>{new Date(report.checkedAt).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}</time>. This page rechecks while open.</p>}
        </div>
      </section>

      {report && <div className="stats">
        <section className="card stat"><div className="stat-label">Content integrity</div>
          <strong>{inspected?.status === 'complete' ? 'Verified' : inspected?.status === 'partial' ? 'Incomplete' : 'Unavailable'}</strong>
          <span>{verified ?? 0} of {inspected?.files.length ?? 0} files verified</span></section>
        <section className="card stat"><div className="stat-label">Checked block</div>
          <strong>{blockLink ? <a href={blockLink} target="_blank" rel="noreferrer">{numeric.format(BigInt(inspected!.block!.number))} <ArrowUpRight size={15} /></a> : inspected?.block ? numeric.format(BigInt(inspected.block.number)) : '—'}</strong>
          <span>{local ? 'Anvil loopback RPC' : 'Two independent RPC operators'}</span></section>
        <section className="card stat"><div className="stat-label">Reviewers</div>
          <strong>{approval?.reviewerCount ? `${approval.signers.length} of ${approval.reviewerCount}` : '—'}</strong>
          <span>{approval?.threshold ? `Policy requires ${approval.threshold}` : 'Independent release policy'}</span></section>
      </div>}

      {inspected?.site && <section className="card content-card stack">
        <div className="row"><h2>Deployment evidence</h2><button className="button small" onClick={() => download('buidl-verification.json', report)}><ArrowDownToLine size={15} /> Export check</button></div>
        <div className="verification-data">
          <CopyValue label="Container" value={inspected.site.container} explorer={explorer && `${explorer}/address/${inspected.site.container}`} />
          <CopyValue label="Processor" value={inspected.site.processor} explorer={explorer && `${explorer}/address/${inspected.site.processor}`} />
          <CopyValue label="Circuit ID" value={inspected.site.circuitId} />
          <CopyValue label="Block hash" value={inspected.block?.hash} explorer={blockLink} />
        </div>
      </section>}
      {approval && <section className="card content-card stack">
        <h2>Release #{approval.sequence} · Policy v{approval.policyVersion}</h2>
        <p>Commitment expires <time dateTime={approval.expiry}>{new Date(approval.expiry).toUTCString()}</time>.</p>
        <div className="verification-data">
          <CopyValue label="Approval registry" value={approval.registry} />
          <CopyValue label="Manifest digest" value={approval.manifestDigest} />
          <CopyValue label="Approved artifact digest" value={approval.artifactDigest} />
        </div>
        <div className="verification-data">{approval.signers.map(signer => <CopyValue key={signer} label="Reviewer" value={signer} />)}</div>
      </section>}
      {inspected && inspected.files.length > 0 && <Inventory key={inspected.name} inspection={inspected} />}
      <footer><span><Blocks size={15} /> buidl</span><span>No security audit attached.</span></footer>
    </main>
  </div>;
}
