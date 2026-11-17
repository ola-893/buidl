import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { formatEther, type Address, type Hex } from 'viem';
import { assertTestnet, estimateTestnet, type PlannedTx, type TestnetClient } from '../core/testnet';
import { browserTransaction, verifyTransaction, WalletRejected } from './wallet';
import { jsonText } from './output';
import { connectedWallet } from './connection';
export type JournalEntry = { plan: PlannedTx; status: 'wallet-requested' | 'submitted' | 'success' | 'reverted' | 'cancelled'; hash?: Hex; receipt?: unknown; paidWei?: string; checkedAt?: string };
export class WalletSender {
  readonly root: string;
  readonly journal: string;
  constructor(readonly client: TestnetClient, readonly account: Address, projectPath: string, readonly open = true) {
    this.root = join(dirname(resolve(projectPath)), '.buidl'); this.journal = join(this.root, 'transactions.json');
  }
  async entries(): Promise<JournalEntry[]> {
    try { return JSON.parse(await readFile(this.journal, 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; return []; }
  }
  async save(entries: JournalEntry[]) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const temp = this.journal + '.tmp';
    await writeFile(temp, jsonText(entries) + '\n', { mode: 0o600 }); await rename(temp, this.journal);
  }
  async locked<T>(run: () => Promise<T>) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const lock = join(this.root, 'transaction.lock');
    try { await mkdir(lock); } catch { throw new Error(`Another CLI operation holds ${lock}. After a hard kill, inspect wallet activity and reconcile transactions before removing the stale lock.`); }
    try {
      if ((await this.entries()).some(e => !['success', 'reverted', 'cancelled'].includes(e.status))) throw new Error('A wallet request has an uncertain outcome. Run buidl wallet reconcile --hash <wallet-transaction-hash> before another write.');
      return await run();
    } finally { await rm(lock, { recursive: true }); }
  }
  async quote(tx: { to?: Address; data: Hex; label: string; nonce?: number }) {
    const estimate = await estimateTestnet(this.account, tx.data, tx.to, this.client);
    const nonce = await this.client.getTransactionCount({ address: this.account, blockTag: 'pending' });
    if (tx.nonce !== undefined && nonce !== tx.nonce) throw new Error('Deployment nonce changed. Prepare a fresh plan.');
    return { ...estimate, label: tx.label, nonce };
  }
  send = async (tx: { to?: Address; data: Hex; label: string; nonce?: number }) => {
    await connectedWallet(true, this.account);
    const plan = await this.quote(tx);
    console.error(`\n${plan.label}\n  X Layer TESTNET 1952 · nonce ${plan.nonce}\n  Maximum gas at quote: ${formatEther(BigInt(plan.estimatedWei))} test OKB\n  Value: 0 test OKB\n`);
    await assertTestnet(this.client);
    const entries = await this.entries();
    const entry: JournalEntry = { plan, status: 'wallet-requested' }; entries.push(entry); await this.save(entries);
    let hash: Hex;
    try { hash = await browserTransaction(plan, this.client, this.open, async hash => {
      entry.hash = hash; entry.status = 'submitted'; await this.save(entries); console.error(`  Submitted ${hash}`);
    }); } catch (error) {
      if (error instanceof WalletRejected && entry.status === 'wallet-requested') entry.status = 'cancelled';
      await this.save(entries); throw error;
    }
    try { await this.confirm(entry, hash); } finally { await this.save(entries); }
  };
  async confirm(entry: JournalEntry, hash: Hex) {
    await assertTestnet(this.client);
    verifyTransaction(await this.client.getTransaction({ hash }), entry.plan);
    const receipt = await this.client.waitForTransactionReceipt({ hash, timeout: 120_000 });
    entry.hash = hash; entry.receipt = receipt; entry.status = receipt.status;
    entry.paidWei = (receipt.gasUsed * receipt.effectiveGasPrice).toString(); entry.checkedAt = new Date().toISOString();
    if (receipt.status !== 'success') throw new Error(`Transaction reverted: ${hash}`);
    console.error(`  Confirmed · block ${receipt.blockNumber} · ${formatEther(BigInt(entry.paidWei))} test OKB\n  https://www.okx.com/web3/explorer/xlayer-test/tx/${hash}`);
  }
  async reconcile(hash: Hex) {
    const entries = await this.entries();
    const entry = entries.findLast(e => !['success', 'reverted', 'cancelled'].includes(e.status));
    if (!entry) throw new Error('No uncertain CLI wallet request to reconcile.');
    try { await this.confirm(entry, hash); } finally { await this.save(entries); }
    return entry;
  }
}
