import assert from 'node:assert/strict';
import { test } from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, type Hex } from 'viem';
import { forwardTestnet } from '../scripts/testnet-relay';

// A public, disposable Anvil account. No actual wallet key is used here.
const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
test('RPC relay rejects wrong-chain signatures and signers before broadcasting', async () => {
  const broadcasts: unknown[][] = [];
  const upstream = async (method: string, params: unknown[]) => {
    if (method === 'eth_chainId') return '0x7a0';
    broadcasts.push(params); return keccak256(params[0] as Hex);
  };
  const signed = async (chainId: number) => account.signTransaction({ chainId, nonce: 1, gas: 21_000n,
    gasPrice: 20_000_001n, to: account.address, value: 0n });
  for (const chain of [1, 196, 31337]) {
    await assert.rejects(forwardTestnet({ method: 'eth_sendRawTransaction', params: [await signed(chain)] }, upstream, [account.address]), /1952/);
  }
  const valid = await signed(1952);
  await assert.rejects(forwardTestnet({ method: 'eth_sendRawTransaction', params: [valid] }, upstream, []), /signer/);
  await assert.rejects(forwardTestnet({ method: 'eth_sendRawTransaction', params: [valid] }, async () => '0xc4', [account.address]), /not X Layer testnet/);
  await assert.rejects(forwardTestnet({ method: 'eth_sendTransaction', params: [] }, upstream, [account.address]), /wallet-signed/);
  assert.equal(broadcasts.length, 0);
  await assert.rejects(forwardTestnet({ method: 'eth_sendRawTransaction', params: [valid] }, async method => method === 'eth_chainId' ? '0x7a0' : '0xwrong', [account.address]), /different transaction hash/);
  assert.equal(await forwardTestnet({ method: 'eth_sendRawTransaction', params: [valid] }, upstream, [account.address]), keccak256(valid));
  assert.deepEqual(broadcasts, [[valid]]);
});
