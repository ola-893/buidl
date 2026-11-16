import { useState } from 'react';
import { ArrowDownToLine, RefreshCw, Upload, Wallet } from 'lucide-react';
import { encodeFunctionData, createPublicClient, http, toHex, type Address, type Hex } from 'viem';
import { xLayer } from 'viem/chains';
import { approvalTypedData, parseEvidence, registryAbi, signaturesFor, siteTuple, type Evidence } from '../core/approval';
import { address, manifestDigest, type Manifest } from '../core/manifest';
import { liveRpc, type Inspection } from '../core/tapeout';
import { assertXLayerRequest, authorityAbi, authorityDeployment, checkXLayer, circuitAbi, xLayerAuthoritySetup, xLayerRequest, type XLayerApproval } from '../core/xlayer-release';
import { CopyValue, Modal } from './evidence-components';
import { download, errorText } from './web-utils';
import { type walletClient } from './wallet';

type Props = {
  inspection?: Inspection;
  approval?: XLayerApproval;
  manifest?: Manifest;
  account?: Address;
  connect: () => void;
  openWallet: () => Promise<ReturnType<typeof walletClient>>;
  refresh: () => Promise<void>;
};

const publicClient = createPublicClient({ chain: xLayer, transport: http('https://rpc.xlayer.tech') });

export function XLayerApprovals({ inspection, approval, manifest, account, connect, openWallet, refresh }: Props) {
  const [reviewers, setReviewers] = useState('');
  const [threshold, setThreshold] = useState(2);
  const [rollback, setRollback] = useState(false);
  const [request, setRequest] = useState<Evidence>();
  const [busy, setBusy] = useState(false);
  const [custodyAction, setCustodyAction] = useState<'enroll' | 'return'>();
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const site = inspection?.site;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNotice(undefined);
    try { await action(); }
    catch (error) { setNotice({ text: errorText(error), error: true }); }
    finally { setBusy(false); }
  }

  async function fresh() {
    if (!inspection?.name) throw new Error('Inspect the TapeOut site first.');
    const rpc = liveRpc();
    const view = await checkXLayer(inspection.name, rpc);
    if (!view.inspection.site || !view.inspection.block || view.inspection.status === 'unavailable') {
      throw new Error(view.inspection.detail ?? 'The current TapeOut snapshot is unavailable.');
    }
    return { ...view, site: view.inspection.site, rpc };
  }

  async function send(to: Address, data: Hex) {
    if (!account) throw new Error('Connect the signing wallet.');
    const wallet = await openWallet();
    if (!(await wallet.getAddresses()).some(active => address(active) === account)) throw new Error('Connect the active wallet again.');
    const hash = await wallet.sendTransaction({ account, chain: xLayer, to, data });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== 'success') throw new Error(`X Layer transaction reverted: ${hash}`);
    setNotice({ text: `Confirmed on X Layer · ${hash}` });
    await refresh();
  }

  function enroll(deploy: boolean) {
    return run(async () => {
      const view = await fresh();
      if (!account || view.inspection.holder?.toLowerCase() !== account) throw new Error('Use the current circuit holder wallet.');
      const setup = await xLayerAuthoritySetup(view.inspection, view.rpc);
      if (deploy) {
        if (setup.deployed) { setNotice({ text: 'Authority deployed. The holder can enroll the circuit.' }); return; }
        await send(setup.transaction.to, setup.transaction.data);
      } else {
        if (!setup.deployed) throw new Error('Deploy the site authority and wait for it to appear in the checked block.');
        const salt = setup.registry ? '0x' : toHex(crypto.getRandomValues(new Uint8Array(32)));
        const data = encodeFunctionData({ abi: circuitAbi, functionName: 'safeTransferFrom',
          args: [account, setup.address, BigInt(view.site.circuitId), salt] });
        await send(view.site.processor, data);
      }
    });
  }

  function returnCircuit() {
    return run(async () => {
      if (!site || !approval || account !== approval.governor || authorityDeployment(site).address !== approval.authority) {
        throw new Error('Connect the governing wallet to return this circuit.');
      }
      // The contract checks live custody itself. Withdrawal does not depend on fresh SiteRegistry reads.
      await send(approval.authority, encodeFunctionData({ abi: authorityAbi, functionName: 'returnCircuit' }));
    });
  }

  function setPolicy() {
    return run(async () => {
      const view = await fresh();
      if (!view.approval || !account) throw new Error('Enroll the circuit and connect the governing wallet.');
      const list = reviewers.split(/[\s,]+/).filter(Boolean).map(address).sort();
      if (list.length > 31 || new Set(list).size !== list.length || list.includes(account) ||
          !Number.isInteger(threshold) || threshold < 1 || threshold > list.length) throw new Error('Enter distinct independent reviewers and a valid threshold.');
      const data = encodeFunctionData({ abi: registryAbi, functionName: 'setPolicy', args: [siteTuple(view.site), list, BigInt(threshold)] });
      await send(view.approval.registry, data);
    });
  }

  function prepare() {
    return run(async () => {
      if (!manifest) throw new Error('Create or import the release manifest.');
      const view = await fresh();
      if (!view.approval) throw new Error('The site needs an enrolled X Layer approval authority.');
      setRequest(await xLayerRequest(view.approval, view.site, manifest, rollback, view.rpc));
    });
  }

  function load(file?: File) {
    if (!file) return;
    void run(async () => {
      if (file.size > 4 * 1024 * 1024) throw new Error('Approval request file is too large.');
      const candidate = parseEvidence(JSON.parse(await file.text()));
      const view = await fresh();
      if (!view.approval) throw new Error('No enrolled authority found.');
      assertXLayerRequest(view.approval, view.site, candidate);
      const same = request && request.sequence === candidate.sequence && request.policyVersion === candidate.policyVersion &&
        request.expiry === candidate.expiry && request.rollback === candidate.rollback &&
        request.instanceSalt === candidate.instanceSalt && request.registry === candidate.registry &&
        manifestDigest(request.manifest) === manifestDigest(candidate.manifest);
      candidate.signatures = same ? [...new Set([...request.signatures, ...candidate.signatures])] : candidate.signatures;
      await signaturesFor(candidate, view.approval.policy, false);
      setRequest(candidate);
    });
  }

  function sign(record: boolean) {
    return run(async () => {
      if (!request || !account) throw new Error('Connect the signing wallet and load the request.');
      const view = await fresh();
      if (!view.approval) throw new Error('No enrolled authority found.');
      assertXLayerRequest(view.approval, view.site, request);
      const typed = approvalTypedData(request);
      if (record) {
        const signatureList = (await signaturesFor(request, view.approval.policy)).map(([, signature]) => signature);
        const data = encodeFunctionData({ abi: registryAbi, functionName: 'record', args: [siteTuple(view.site), typed.message, signatureList] });
        await send(view.approval.registry, data);
        setRequest(undefined);
      } else {
        if (!view.approval.policy.reviewers.some(reviewer => address(reviewer) === account)) throw new Error('The wallet is outside the current reviewer policy.');
        const wallet = await openWallet();
        if (!(await wallet.getAddresses()).some(active => address(active) === account)) throw new Error('Connect the active wallet again.');
        const signature = await wallet.signTypedData({ account, ...typed });
        const next = { ...request, signatures: [...request.signatures, signature] };
        await signaturesFor(next, view.approval.policy, false);
        setRequest(next);
      }
    });
  }

  return <section className="card content-card stack">
    <h2>X Layer release approvals</h2>
    {!site && <p>Inspect the TapeOut name of the app you want to register or review.</p>}
    {site && <CopyValue label="Site container" value={site.container} />}
    {site && !approval && <>
      <p>For an opened, controlled site, deploy its authority and use the holder wallet to enroll the circuit NFT. The authority holds the circuit until the governing wallet releases it.</p>
      <div className="actions">
        <button className="button" disabled={busy || !account} onClick={() => void enroll(true)}>Deploy authority</button>
        <button className="button" disabled={busy || !account} onClick={() => setCustodyAction('enroll')}>Enroll circuit</button>
      </div>
    </>}
    {site && approval && <>
      <CopyValue label="Approval registry" value={approval.registry} />
      <CopyValue label="Governing wallet" value={approval.governor} />
      <CopyValue label="Custody authority" value={approval.authority} />
      <button className="button" disabled={busy || account !== approval.governor} onClick={() => setCustodyAction('return')}>Return circuit</button>
      <details><summary>{approval.authorityCurrent ? 'Update reviewer policy' : 'Set reviewer policy'}</summary>
        <label className="field">Reviewer addresses<textarea value={reviewers} onChange={event => setReviewers(event.target.value)} placeholder="One address per line" /></label>
        <label className="field">Threshold<input type="number" min={1} max={31} value={threshold} onChange={event => setThreshold(Number(event.target.value))} /></label>
        <button className="button" disabled={busy || !account} onClick={() => void setPolicy()}>Register policy</button>
      </details>
      <div className="actions">
        <button className="button primary" disabled={busy || !manifest || !approval.authorityCurrent} onClick={() => void prepare()}>Create approval request</button>
        <label className="button upload"><Upload size={16} /> Import signed request<input type="file" accept=".json" disabled={busy} onChange={event => { load(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /></label>
        <label className="checkbox"><input type="checkbox" checked={rollback} onChange={event => setRollback(event.target.checked)} /> Explicit rollback</label>
      </div>
      {request && <div className="request-box">
        <strong>{request.manifest.release} · Release #{request.sequence} · {request.signatures.length} signatures</strong>
        <CopyValue label="Manifest digest" value={manifestDigest(request.manifest)} />
        <div className="actions">
          <button className="button" onClick={() => download('buidl-xlayer-approval.json', request)}><ArrowDownToLine size={16} /> Export request</button>
          <button className="button" disabled={busy || !account} onClick={() => void sign(false)}><Wallet size={16} /> Sign approval</button>
          <button className="button primary" disabled={busy || !account || request.signatures.length < Number(approval.policy.threshold)} onClick={() => void sign(true)}>Record approval</button>
        </div>
      </div>}
    </>}
    <div className="actions">
      {!account && <button className="button" onClick={connect}><Wallet size={16} /> Connect holder or reviewer</button>}
      <button className="button" disabled={busy || !site} onClick={() => void run(refresh)}><RefreshCw size={16} /> Refresh from X Layer</button>
    </div>
    {custodyAction && <Modal title={custodyAction === 'enroll' ? 'Enroll this circuit?' : 'Return this circuit?'} close={() => setCustodyAction(undefined)}>
      <div className="modal-body stack">
        <CopyValue label="Circuit ID" value={site?.circuitId} />
        <CopyValue label="Governing wallet" value={account} />
        {custodyAction === 'enroll' ? <p>Enrollment transfers the circuit NFT and control of its TapeOut container into the site authority. Use a dedicated pilot circuit. General container execution becomes unavailable until you return the circuit.</p>
          : <p>The circuit returns to the governing wallet. Its approval policy and open publication attempt become invalid.</p>}
        <div className="actions">
          <button className="button" onClick={() => setCustodyAction(undefined)}>Cancel</button>
          <button className="button primary" onClick={() => {
            const action = custodyAction;
            setCustodyAction(undefined);
            if (action === 'enroll') void enroll(false);
            else void returnCircuit();
          }}>{custodyAction === 'enroll' ? 'Continue to enrollment' : 'Continue to return'}</button>
        </div>
      </div>
    </Modal>}
    {notice && <div className={`notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</div>}
  </section>;
}
