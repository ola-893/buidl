import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { parseArgs, promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { isAddress, isHex, keccak256, parseTransaction, recoverTransactionAddress, type Address, type Hex, type TransactionSerialized } from 'viem';

const exec = promisify(execFile);
const upstreams = ['https://testrpc.xlayer.tech/terigon', 'https://testrpc.xlayer.tech', 'https://xlayertestrpc.okx.com/terigon'];
const readMethods = new Set(['eth_chainId', 'net_version', 'web3_clientVersion', 'eth_blockNumber', 'eth_getBalance',
  'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getTransactionCount', 'eth_gasPrice', 'eth_maxPriorityFeePerGas',
  'eth_feeHistory', 'eth_call', 'eth_estimateGas', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getCode',
  'eth_getLogs', 'eth_getStorageAt', 'eth_syncing']);
type Request = { id?: string | number | null; method: string; params?: unknown[] };
type Upstream = (method: string, params: unknown[]) => Promise<unknown>;

export async function forwardTestnet(request: Request, upstream: Upstream, wallets: readonly Address[]) {
  const { method, params = [] } = request;
  if (!Array.isArray(params)) throw new Error('Expected positional JSON-RPC parameters.');
  if (method === 'eth_sendRawTransaction') {
    if (params.length !== 1 || !isHex(params[0])) throw new Error('Expected one signed transaction.');
    const serializedTransaction = params[0] as TransactionSerialized;
    const transaction = parseTransaction(serializedTransaction);
    if (transaction.chainId !== 1952) throw new Error('Mainnet and other chains are rejected. Signed chain ID must be 1952.');
    const sender = await recoverTransactionAddress({ serializedTransaction });
    if (!wallets.some(value => value.toLowerCase() === sender.toLowerCase())) throw new Error('This signer is not enabled for the testnet pilot.');
    if (BigInt((await upstream('eth_chainId', [])) as string) !== 1952n) throw new Error('Upstream is not X Layer testnet.');
    const evidence = { chainId: 1952, sender, nonce: transaction.nonce, hash: keccak256(serializedTransaction) };
    console.log(JSON.stringify({ ...evidence, status: 'broadcast-requested' }));
    const result = await upstream(method, params);
    if (typeof result !== 'string' || result.toLowerCase() !== evidence.hash) throw new Error('RPC returned a different transaction hash. Check the requested hash before retrying.');
    console.log(JSON.stringify({ ...evidence, status: 'broadcast-accepted' }));
    return evidence.hash;
  }
  if (!readMethods.has(method)) throw new Error('This relay supports public reads and wallet-signed testnet transactions only.');
  if (method === 'eth_chainId' || method === 'net_version') {
    if (BigInt((await upstream('eth_chainId', [])) as string) !== 1952n) throw new Error('Upstream is not X Layer testnet.');
    return method === 'eth_chainId' ? '0x7a0' : '1952';
  }
  if (method === 'web3_clientVersion') return 'buidl/testnet-relay';
  return upstream(method, params);
}

async function publicRpc(method: string, params: unknown[]): Promise<unknown> {
  let last: unknown;
  for (const url of upstreams) {
    try {
      const { stdout } = await exec('curl', ['--max-time', '12', '--silent', '--show-error', url, '-H', 'content-type: application/json',
        '--data', JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })], { maxBuffer: 10_000_000 });
      const response = JSON.parse(stdout) as { result?: unknown; error?: { code: number; message: string } };
      if (response.error) {
        if (method === 'eth_sendRawTransaction' && /already known|^known transaction/i.test(response.error.message)) return keccak256(params[0] as Hex);
        throw new Error(response.error.message);
      }
      if (!('result' in response)) throw new Error('Invalid upstream JSON-RPC response.');
      return response.result;
    } catch (error) { last = error; }
  }
  throw last ?? new Error('Testnet RPC unavailable.');
}

async function main() {
  const { values } = parseArgs({ options: { 'chain-id': { type: 'string' }, wallet: { type: 'string', multiple: true } } });
  if (values['chain-id'] !== '1952' || !values.wallet?.length || values.wallet.some(value => !isAddress(value))) {
    throw new Error('Use --chain-id 1952 --wallet <public-signer> [--wallet <reviewer>]. Mainnet is rejected.');
  }
  const wallets = values.wallet as Address[];
  await forwardTestnet({ method: 'eth_chainId' }, publicRpc, wallets);
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'content-type');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
    if (request.method !== 'POST') { response.writeHead(405).end(); return; }
    try {
      let body = '';
      for await (const part of request) {
        body += part.toString();
        if (body.length > 2_000_000) throw new Error('RPC body too large.');
      }
      const input = JSON.parse(body) as Request | Request[];
      const entries = Array.isArray(input) ? input : [input];
      if (entries.length > 50 || entries.some(entry => !entry || typeof entry.method !== 'string')) throw new Error('Invalid RPC request.');
      const output = await Promise.all(entries.map(async entry => {
        try { return { jsonrpc: '2.0', id: entry.id ?? null, result: await forwardTestnet(entry, publicRpc, wallets) }; }
        catch (error) { return { jsonrpc: '2.0', id: entry.id ?? null, error: { code: -32000, message: (error as Error).message } }; }
      }));
      response.end(JSON.stringify(Array.isArray(input) ? output : output[0]));
    } catch (error) { response.writeHead(400).end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: (error as Error).message } })); }
  });
  server.listen(8552, '127.0.0.1', () => console.log('X Layer TESTNET relay · chain 1952 · http://127.0.0.1:8552 · wallet signatures required'));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
