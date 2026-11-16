import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { toHex, type Address } from 'viem';
import { approvalTypedData, parseEvidence, registryAbi, signaturesFor, siteTuple } from '../src/core/approval';
import { LOCAL_RPC, localAbi, localClient, localState, newRequest, parseLocalConfig } from '../src/core/local';
import { parseManifest } from '../src/core/manifest';
import { EXAMPLE_SITE } from '../src/core/tapeout';
import { localWallet, waitFor } from '../src/publish';

const cli = (...args: string[]) => execFileSync('npm', ['run', '--silent', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const configPath = 'public/local-demo/config.json';
const aPath = 'public/local-demo/manifest-a.json';
const bPath = 'public/local-demo/manifest-b.json';
const buildA = 'demo/release-a';
const buildB = 'demo/release-b';
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as unknown;

async function chooseWallet(page: Page, account: Address) {
  await page.evaluate(value => window.sessionStorage.setItem('test-wallet-account', value), account);
  await page.locator('.wallet-button').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Controlled test wallet' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('inspect a real X Layer deployment through the browser', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: EXAMPLE_SITE })).toBeVisible({ timeout: 55_000 });
  await expect(page.getByText('1 of 1 files verified')).toBeVisible();
  await expect(page.getByText('Activated on DeWEB')).toBeVisible();
  await page.getByRole('button', { name: 'index.html', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'File integrity' })).toContainText('Computed SHA-256');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('textbox', { name: 'DeWEB identifier' }).fill('4246.0.tape');
  await page.getByRole('button', { name: 'Inspect site' }).click();
  await expect(page.getByText(/Unsupported network/)).toBeVisible();
});

test('approve A, publish the exact bytes, detect B, approve B and invalidate stale commitments', async ({ page }) => {
  cli('demo', '--', 'init');
  const config = parseLocalConfig(json(configPath));
  const client = localClient();
  const [holder, reviewer1, reviewer2, , stranger] = await localWallet(config.site.container).getAddresses();
  const common = { address: config.registry, abi: registryAbi } as const;
  const tuple = siteTuple(config.site);
  const a = parseManifest(json(aPath));

  await expect(client.simulateContract({ ...common, account: stranger, functionName: 'setPolicy', args: [tuple, [reviewer1], 1n] })).rejects.toThrow();
  await expect(client.simulateContract({ ...common, account: holder, functionName: 'setPolicy', args: [{ ...tuple, circuitId: 2n }, [reviewer1], 1n] })).rejects.toThrow();
  expect(() => cli('buidl', '--', 'gate', buildA, aPath, configPath)).toThrow(/no active approval/i);

  await page.exposeFunction('testWalletRpc', async (method: string, params: unknown[]) => {
    const response = await fetch(LOCAL_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const data = await response.json() as { error?: { message: string }; result?: unknown };
    if (data.error) throw new Error(data.error.message);
    return data.result;
  });
  await page.addInitScript(() => {
    let chain = '0xc4';
    const testWindow = window as unknown as Window & { testWalletRpc(method: string, params: unknown[]): Promise<unknown> };
    const provider = { async request({ method, params = [] }: { method: string; params?: unknown[] }) {
      if (method === 'eth_chainId') return chain;
      if (method === 'wallet_switchEthereumChain') {
        chain = (params[0] as { chainId: string }).chainId;
        return null;
      }
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [sessionStorage.getItem('test-wallet-account')];
      return testWindow.testWalletRpc(method, params);
    } };
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { name: 'Controlled test wallet', uuid: '1234', rdns: 'test.buidl' }, provider },
    })));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Local demo', exact: true }).click();
  await expect(page.getByText('Controlled local site')).toBeVisible();
  await page.getByRole('button', { name: 'Releases', exact: true }).click();
  await page.locator('input[type=file][accept]').setInputFiles(aPath);
  await expect(page.getByText('Release manifest loaded.')).toBeVisible();
  await page.getByRole('button', { name: 'Continue to approvals' }).click();
  await page.getByRole('button', { name: 'Create request' }).click();
  await expect(page.getByText('Release #1 · 0 signatures')).toBeVisible();

  const state = await localState(config);
  const unsigned = await newRequest(config, a, Number(state.block.timestamp) + 3600, false);
  const typed = approvalTypedData(unsigned);
  const [first, foreign] = await Promise.all([reviewer1, stranger].map(reviewer => localWallet(reviewer).signTypedData(typed)));
  for (const signatures of [[first], [first, first], [first, foreign]]) {
    await expect(client.simulateContract({ ...common, account: holder, functionName: 'record', args: [tuple, typed.message, signatures] })).rejects.toThrow();
  }

  await chooseWallet(page, reviewer1);
  await page.getByRole('button', { name: 'Sign approval', exact: true }).click();
  await expect(page.getByText('Release #1 · 1 signature')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record approval' })).toBeDisabled();
  await chooseWallet(page, reviewer2);
  await page.getByRole('button', { name: 'Sign approval', exact: true }).click();
  await expect(page.getByText('Release #1 · 2 signatures')).toBeVisible();
  await page.getByRole('button', { name: 'Record approval', exact: true }).click();
  await expect(page.getByText('Release approval recorded on Anvil.')).toBeVisible();

  expect(cli('buidl', '--', 'gate', buildA, aPath, configPath)).toContain('Gate passed.');
  expect(() => cli('buidl', '--', 'gate', buildB, aPath, configPath)).toThrow(/Build differs/i);
  cli('buidl', '--', 'publish-local', buildA, aPath, configPath);

  async function inspect(expected: string) {
    await page.getByRole('button', { name: 'Inspection', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh deployment' }).click();
    await expect(page.getByRole('heading', { name: expected, exact: true })).toBeVisible();
  }
  await inspect('Matches approved release.');
  cli('demo', '--', 'bypass-b');
  await inspect('Deployment differs from approved release.');
  await expect(page.getByText('2 of 2 files verified')).toBeVisible();
  await page.locator('.diff summary').click();
  await expect(page.locator('.diff')).toContainText('payment.json');
  await expect(page.locator('.diff')).toContainText('0x1111111111111111111111111111111111111111');
  await expect(page.locator('.diff')).toContainText('0x2222222222222222222222222222222222222222');
  try {
    cli('buidl', '--', 'verify-local', aPath, configPath);
    throw new Error('CLI verified an unapproved deployment');
  } catch (error) {
    expect(error).toMatchObject({ status: 2, stdout: expect.stringMatching(/Deployment differs/) });
  }

  cli('demo', '--', 'approve', 'b');
  await page.getByRole('button', { name: 'Releases', exact: true }).click();
  await page.getByRole('button', { name: 'Load demo B', exact: true }).click();
  await inspect('Matches approved release.');
  await page.getByRole('button', { name: 'Evidence', exact: true }).click();
  await expect(page.getByText('Release #2 recorded')).toBeVisible();
  await expect(page.getByText('Release #1 recorded')).toBeVisible();

  const evidenceB = parseEvidence(json('public/local-demo/evidence-b.json'));
  const commitmentB = (await localState(config)).commitment.approval;
  const record = (request: typeof evidenceB, who = holder) => client.simulateContract({
    ...common, account: who, functionName: 'record',
    args: [tuple, approvalTypedData(request).message, request.signatures],
  });
  await expect(record(evidenceB)).rejects.toThrow();
  await expect(newRequest(config, a, Number(state.block.timestamp) + 3600, false)).rejects.toThrow(/explicitly request a rollback/i);
  const rollback = await newRequest(config, a, Number(state.block.timestamp) + 3600, true);
  expect(rollback.sequence).toBe(3);
  const { policy } = await localState(config);
  rollback.signatures = await Promise.all([reviewer1, reviewer2].map(reviewer => localWallet(reviewer).signTypedData(approvalTypedData(rollback))));
  rollback.signatures = (await signaturesFor(rollback, policy)).map(([, signature]) => signature);

  const fixture = { address: config.site.container, abi: localAbi } as const;
  const wallet = localWallet(holder);
  await waitFor(await wallet.writeContract({ ...fixture, functionName: 'setUploading', args: [true] }));
  await inspect('Verification unavailable.');
  await waitFor(await wallet.writeContract({ ...fixture, functionName: 'setUploading', args: [false] }));
  await expect(client.simulateContract({ ...common, account: stranger, functionName: 'revoke', args: [tuple, 2n] })).rejects.toThrow();
  await chooseWallet(page, holder);
  await page.getByRole('button', { name: 'Approvals', exact: true }).click();
  await page.getByRole('button', { name: 'Revoke current release' }).click();
  await expect(page.getByText('Current release revoked.')).toBeVisible();
  await inspect('Approval revoked or expired.');
  expect((await localState(config)).commitment.approval).toEqual(commitmentB);

  await waitFor(await wallet.writeContract({ ...common, functionName: 'record', args: [tuple, approvalTypedData(rollback).message, rollback.signatures] }));
  expect((await localState(config)).commitment.approval.rollback).toBe(true);
  expect(cli('buidl', '--', 'gate', buildA, aPath, configPath)).toContain('Gate passed.');

  await waitFor(await wallet.writeContract({ ...fixture, functionName: 'transfer', args: [stranger] }));
  expect((await localState(config)).authorityCurrent).toBe(false);
  await waitFor(await localWallet(stranger).writeContract({ ...fixture, functionName: 'transfer', args: [holder] }));
  expect((await localState(config)).authorityCurrent).toBe(false);
  await waitFor(await wallet.writeContract({ ...common, functionName: 'setPolicy', args: [tuple, [...policy.reviewers].sort(), policy.threshold] }));
  const rotated = await localState(config);
  expect(rotated.policy.version).toBe(2n);
  expect(rotated.commitment.approval.policyVersion).toBe(1n);
  expect(() => cli('buidl', '--', 'gate', buildA, aPath, configPath)).toThrow(/no active approval/i);
  await expect(record({ ...rollback, sequence: 4, policyVersion: 2, instanceSalt: toHex(123, { size: 32 }) })).rejects.toThrow();
});
