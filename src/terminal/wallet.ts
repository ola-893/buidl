import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { isHash, recoverTypedDataAddress, toHex, type Address, type Hex } from 'viem';
import { approvalTypedData, type Evidence } from '../core/approval';
import { assertTestnet, type PlannedTx, type TestnetClient } from '../core/testnet';
import { jsonText } from './output';
import { walletPage } from './wallet-page';

export class WalletRejected extends Error { constructor() { super('Request rejected in wallet. No transaction was submitted.'); } }

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
    if (req.method !== 'POST' || !['/result','/reject'].includes(req.url ?? '')) return send(404, { error: 'Not found.' });
    if (settled || processing) return send(409, { error: 'Request already handled.' });
    processing = true;
    try {
      let body = '';
      for await (const part of req) { body += part; if (body.length > 2048) throw new Error('Result too large.'); }
      const data = JSON.parse(body);
      if (req.url === '/reject') {
        if (!data || Object.keys(data).length !== 0) throw new Error('Invalid rejection callback.');
        settled = true; send(200, { cancelled: true }); reject(new WalletRejected()); return;
      }
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
  const session = await startWalletSession(payload, verify, 3_600_000, 5362);
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
