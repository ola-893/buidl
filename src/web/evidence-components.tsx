import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUpRight, Check, Clipboard, FileCode2, Search, X } from 'lucide-react';
import { fileEntry, type Change } from '../core/manifest';
import { type FileResult, type Inspection } from '../core/tapeout';
import { formatBytes, short } from './web-utils';
import paymentA from '../../demo/release-a/payment.json?raw';
import paymentB from '../../demo/release-b/payment.json?raw';

const statusName: Record<FileResult['status'], string> = { verified: 'Verified', incomplete: 'Incomplete', 'no-hash': 'No declared hash', missing: 'Missing', 'too-large': 'Too large', unavailable: 'Unavailable' };

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'purple' }) {
  return <span className={`badge ${tone}`}><span className="dot" />{children}</span>;
}

export function CopyValue({ value, label, explorer }: { value?: string | null; label: string; explorer?: string }) {
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

export function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
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

export function Diff({ changes, local = false }: { changes: readonly Change[]; local?: boolean }) {
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

export function Inventory({ inspection }: { inspection: Inspection }) {
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
