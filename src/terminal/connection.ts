import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createPublicClient, http, recoverMessageAddress, type Address, type Hex } from 'viem';
import { address, object } from '../core/manifest';
import { assertTestnet, testnet, TESTNET_RPCS, type TestnetClient } from '../core/testnet';
import { browserRequest } from './wallet';
import { rpcUrl } from './project';
import { jsonText } from './output';

export type Connection = { version: 1; network: 'testnet'; chainId: 1952; signer: 'browser-wallet'; address: Address; wallet: string; rpcUrl: string; connectedAt: string };
export const connectionHome = () => resolve(process.env.BUIDL_HOME ?? join(homedir(), '.config', 'buidl'));
export const connectionFile = () => join(connectionHome(), 'wallet.json');
export function connectionClient(endpoint = TESTNET_RPCS[0] as string): TestnetClient {
  return createPublicClient({ chain: testnet, transport: http(rpcUrl(endpoint), { timeout: 45_000, retryCount: 0 }) });
}
export async function connectedWallet(required = false, expected?: Address): Promise<Connection | undefined> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(connectionFile(), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!raw) {
    if (required) throw new Error('Connect a wallet first: buidl wallet connect --network testnet');
    return;
  }
  const value = object(raw, ['version','network','chainId','signer','address','wallet','rpcUrl','connectedAt'], 'wallet connection');
  if (value.version !== 1 || value.network !== 'testnet' || value.chainId !== 1952 || value.signer !== 'browser-wallet' ||
      typeof value.wallet !== 'string' || typeof value.connectedAt !== 'string') throw new Error('Invalid wallet connection. Run buidl wallet connect --network testnet again.');
  const connection: Connection = { version: 1, network: 'testnet', chainId: 1952, signer: 'browser-wallet', address: address(value.address),
    wallet: value.wallet, rpcUrl: rpcUrl(value.rpcUrl), connectedAt: value.connectedAt };
  if (expected && connection.address !== address(expected)) throw new Error(`Connected wallet is ${connection.address}. Reconnect with --account ${expected} to sign as that account.`);
  return connection;
}
export async function disconnectWallet() {
  await rm(connectionFile(), { force: true });
}
export async function verifyConnectionProof(input: unknown, message: string, expiry: number, expected?: Address) {
  const value = object(input, ['address','signature','wallet'], 'wallet connection proof');
  const selected = address(value.address);
  if (expected && selected !== address(expected)) throw new Error('The selected wallet does not match the requested account.');
  if (Date.now() > expiry || typeof value.signature !== 'string' || !/^0x[\da-f]{130}$/i.test(value.signature) ||
      typeof value.wallet !== 'string' || value.wallet.length > 100) throw new Error('Invalid or expired wallet connection proof.');
  const recovered = await recoverMessageAddress({ message, signature: value.signature as Hex });
  if (address(recovered) !== selected) throw new Error('Wallet connection signature does not match the selected address.');
  return { address: selected, wallet: value.wallet };
}
export async function connectWallet(options: { rpc?: string; account?: Address; open?: boolean }) {
  const endpoint = rpcUrl(options.rpc ?? TESTNET_RPCS[0]);
  const client = connectionClient(endpoint);
  await assertTestnet(client);
  const expiry = Date.now() + 3_600_000;
  const message = `Connect this wallet to buidl CLI\nNetwork: X Layer testnet (1952)\nOrigin: http://127.0.0.1:5362\nPurpose: select the wallet for subsequent CLI commands.\nThis message authorizes no transaction or release approval.\nNonce: ${randomBytes(32).toString('hex')}\nExpires: ${new Date(expiry).toISOString()}`;
  let proof: { address: Address; wallet: string } | undefined;
  await browserRequest({ kind: 'connect', chainId: 1952, account: options.account, rpcUrl: endpoint, label: 'Connect wallet to buidl', message }, async value => {
    proof = await verifyConnectionProof(JSON.parse(value), message, expiry, options.account);
    await assertTestnet(client);
  }, options.open);
  if (!proof) throw new Error('Wallet connection was not verified.');
  const connection: Connection = { version: 1, network: 'testnet', chainId: 1952, signer: 'browser-wallet', ...proof,
    rpcUrl: endpoint, connectedAt: new Date().toISOString() };
  await mkdir(connectionHome(), { recursive: true, mode: 0o700 });
  const temp = connectionFile() + '.' + randomBytes(6).toString('hex') + '.tmp';
  await writeFile(temp, jsonText(connection) + '\n', { flag: 'wx', mode: 0o600 });
  await rename(temp, connectionFile());
  return { connection, balance: await client.getBalance({ address: connection.address }) };
}
