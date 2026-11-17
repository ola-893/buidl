import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { isHash, recoverTypedDataAddress, toHex, type Address, type Hex } from 'viem';
import { approvalTypedData, type Evidence } from '../core/approval';
import { assertTestnet, type PlannedTx, type TestnetClient } from '../core/testnet';
import { jsonText } from './output';

// A single fixed request per capability. The CLI independently verifies wallet results.
export async function startWalletSession(payload: Record<string, unknown>, verify: (value: string) => Promise<void>, timeoutMs = 600_000, port = 0) {
  const token = randomBytes(32).toString('hex');
  let resolve!: (v: string) => void, reject!: (e: Error) => void, processing = false, settled = false;
  const done = new Promise<string>((a, b) => { resolve = a; reject = b; });
  done.catch(() => {});
  const server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const send = (status: number, data: unknown, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" });
      res.end(type === 'application/json' ? jsonText(data) : String(data));
    };
    if (req.headers.host !== origin.slice(7) || req.headers.origin && req.headers.origin !== origin) return send(403, { error: 'Origin rejected.' });
    if (req.method === 'GET' && req.url === '/') return send(200, walletPage, 'text/html; charset=utf-8');
    const supplied = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return send(403, { error: 'Session required.' });
    if (req.method === 'GET' && req.url === '/request') return send(200, { ...payload, complete: settled });
    if (req.method !== 'POST' || req.url !== '/result') return send(404, { error: 'Not found.' });
    if (settled || processing) return send(409, { error: 'Request already handled.' });
    processing = true;
    try {
      let body = '';
      for await (const part of req) { body += part; if (body.length > 2048) throw new Error('Result too large.'); }
      const data = JSON.parse(body);
      if (Object.keys(data).length !== 1 || typeof data.value !== 'string') throw new Error('Expected one wallet result.');
      await verify(data.value);
      settled = true; send(200, { verified: true }); resolve(data.value);
    } catch (error) { send(400, { error: (error as Error).message }); }
    finally { processing = false; }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const timer = setTimeout(() => reject(new Error('Wallet session timed out. Inspect wallet activity and receipts before retrying.')), timeoutMs);
  const cancel = () => reject(new Error('Wallet session interrupted. Inspect wallet activity before retrying.'));
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/#${token}`, done,
    close: async () => { clearTimeout(timer); process.off('SIGINT', cancel); process.off('SIGTERM', cancel); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); } };
}
export async function browserRequest(payload: Record<string, unknown>, verify: (value: string) => Promise<void>, open = true) {
  const session = await startWalletSession(payload, verify, 600_000, 5362);
  console.error(`\nWallet review · X Layer TESTNET 1952\n${session.url}\n`);
  if (open) {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
    const child = spawn(command, [session.url], { stdio: 'ignore', detached: true });
    child.on('error', () => console.error('Open the wallet URL above in your browser.')); child.unref();
  }
  try { return await session.done; } finally { await session.close(); }
}
export async function browserSignature(evidence: Evidence, account: Address, client: TestnetClient, open = true) {
  await assertTestnet(client);
  const typed = approvalTypedData(evidence);
  const signature = await browserRequest({ kind: 'signature', chainId: 1952, account, label: 'Sign release approval',
    typedData: { ...typed, types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' }, { name: 'salt', type: 'bytes32' }], ...typed.types } } }, async value => {
    await assertTestnet(client);
    if (!/^0x[\da-f]{130}$/i.test(value) || (await recoverTypedDataAddress({ ...typed, signature: value as Hex })).toLowerCase() !== account.toLowerCase()) throw new Error('Wallet signature does not match the requested reviewer.');
  }, open);
  return signature as Hex;
}
export function verifyTransaction(tx: { chainId?: number; from: string; to: string | null; input: string; nonce: number; value: bigint; gas: bigint; gasPrice?: bigint }, plan: PlannedTx) {
  if (tx.chainId !== 1952 || tx.from.toLowerCase() !== plan.from.toLowerCase() ||
      (tx.to?.toLowerCase() ?? undefined) !== plan.to?.toLowerCase() || tx.input !== plan.data ||
      tx.nonce !== plan.nonce || tx.value !== 0n || tx.gas > BigInt(plan.gas) ||
      tx.gasPrice === undefined || tx.gasPrice > BigInt(plan.gasPrice)) throw new Error('Wallet transaction differs from the reviewed testnet plan. Inspect its hash before retrying.');
}
export async function browserTransaction(plan: PlannedTx, client: TestnetClient, open = true, onHash?: (hash: Hex) => Promise<void>) {
  await assertTestnet(client);
  const transaction = { from: plan.from, ...(plan.to ? { to: plan.to } : {}), chainId: toHex(1952), data: plan.data,
    gas: toHex(BigInt(plan.gas)), gasPrice: toHex(BigInt(plan.gasPrice)), nonce: toHex(plan.nonce!), value: '0x0' };
  return await browserRequest({ kind: 'transaction', chainId: 1952, account: plan.from, label: plan.label, plan, transaction }, async hash => {
    if (!isHash(hash)) throw new Error('Invalid transaction hash.');
    await onHash?.(hash);
    await assertTestnet(client);
    const tx = await client.getTransaction({ hash });
    verifyTransaction(tx, plan);
  }, open) as Hex;
}
const walletPage = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>buidl · CLI wallet</title>
<style>body{background:#10121b;color:#eef0fa;font:16px system-ui;margin:5vh auto;max-width:760px;padding:24px}h1{font-size:36px}small{color:#bbb}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#1c2030;padding:20px;border-radius:10px}button,select{font:inherit;padding:12px 18px;margin:8px 8px 8px 0;border-radius:8px}button{background:#b4f458;border:0;cursor:pointer}#status{color:#dcf6b8}details{margin:20px 0}</style></head>
<body><small>buidl CLI · simulated DeWEB fixtures · X Layer TESTNET 1952</small><h1 id="label">Wallet review</h1><p>The terminal controls this release. Review the request here and sign in your wallet.</p><pre id="summary"></pre><select id="wallet"></select><button id="review" disabled>Review in wallet</button><p id="status"></p><details><summary>Exact request</summary><pre id="detail"></pre></details>
<script>
const token=location.hash.slice(1),providers=[],select=document.querySelector('#wallet'),button=document.querySelector('#review'),status=document.querySelector('#status');
let request,started=false;
function add(provider,name){if(providers.some(p=>p.provider===provider))return;providers.push({provider,name});const o=document.createElement('option');o.value=providers.length-1;o.textContent=name;select.append(o);}
addEventListener('eip6963:announceProvider',e=>add(e.detail.provider,e.detail.info.name));dispatchEvent(new Event('eip6963:requestProvider'));setTimeout(()=>{if(!providers.length&&window.ethereum)add(window.ethereum,'Browser wallet')},300);
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();if(!r.ok)throw Error(j.error);return j;}
api('/request').then(r=>{request=r;button.disabled=false;document.querySelector('#label').textContent=r.label;document.querySelector('#detail').textContent=JSON.stringify(r,null,2);document.querySelector('#summary').textContent='Network: X Layer TESTNET (1952)\\nAccount: '+r.account+'\\n'+(r.kind==='signature'?'Gas fee: none\\nManifest: '+r.typedData.message.manifestDigest:'Destination: '+(r.plan.to||'New fixture contract')+'\\nNonce: '+r.plan.nonce+'\\nValue: 0 test OKB\\nMaximum at quoted gas price: '+(BigInt(r.plan.estimatedWei)/1000000000000000000n)+'.'+(BigInt(r.plan.estimatedWei)%1000000000000000000n).toString().padStart(18,'0')+' test OKB');if(r.complete){button.disabled=true;status.textContent='Already verified. Return to the terminal.'}}).catch(e=>status.textContent=e.message);
button.onclick=async()=>{if(started||!request)return;button.disabled=true;try{const p=providers[Number(select.value)]?.provider;if(!p)throw Error('No injected browser wallet found.');const accounts=await p.request({method:'eth_requestAccounts'});if(BigInt(await p.request({method:'eth_chainId'}))!==1952n)throw Error('Select X Layer TESTNET 1952 in your wallet. Mainnet is rejected.');if(accounts[0]?.toLowerCase()!==request.account.toLowerCase())throw Error('Select the requested wallet account.');started=true;status.textContent='Review the open wallet request.';let value;if(request.kind==='signature'){value=await p.request({method:'eth_signTypedData_v4',params:[request.account,JSON.stringify(request.typedData)]})}else{const nonce=await p.request({method:'eth_getTransactionCount',params:[request.account,'pending']});if(BigInt(nonce)!==BigInt(request.plan.nonce))throw Error('Nonce changed. Return to the terminal and prepare a fresh plan.');value=await p.request({method:'eth_sendTransaction',params:[request.transaction]})}status.textContent=request.kind==='transaction'?'Submitted '+value+'. Verifying in the terminal…':'Verifying signature…';await api('/result',{value});status.textContent='Verified. Return to the terminal.'}catch(e){status.textContent=e.message;if(!started)button.disabled=false;else status.textContent+=' Check wallet activity before restarting the CLI command.'}};
</script></body></html>`;
