import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

const endpoint = 'http://127.0.0.1:8549';
let node: ChildProcess;
let accounts: string[] = [];
async function rpc(method: string, params: unknown[] = []) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const data = await response.json() as { result?: unknown; error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

test.beforeAll(async () => {
  node = spawn('anvil', ['--host', '127.0.0.1', '--port', '8549', '--chain-id', '1952', '--silent'], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if (await rpc('eth_chainId') === '0x7a0') break; } catch { /* Wait for the isolated test node. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  accounts = await rpc('eth_accounts') as string[];
});
test.afterAll(() => { node?.kill('SIGTERM'); });

test('dashboard checks network and costs, collects separate signatures and verifies the testnet fixture journey', async ({ page }) => {
  await page.route(/https:\/\/(testrpc\.xlayer\.tech|xlayertestrpc\.okx\.com)\/terigon/, async route => {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: route.request().postData() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: await response.text() });
  });
  let sent = 0;
  await page.exposeFunction('testnetWallet', async (method: string, params: unknown[]) => {
    if (method === 'eth_sendTransaction') sent++;
    return rpc(method, params);
  });
  await page.addInitScript(({ owner }) => {
    sessionStorage.setItem('testnet-chain', '0xc4');
    const windowTest = window as unknown as Window & { testnetWallet(method: string, params: unknown[]): Promise<unknown> };
    const provider = {
      async request({ method, params = [] }: { method: string; params?: unknown[] }) {
        if (method === 'eth_chainId') return sessionStorage.getItem('testnet-chain');
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [sessionStorage.getItem('testnet-account') ?? owner];
        if (method === 'wallet_switchEthereumChain') {
          sessionStorage.setItem('testnet-chain', (params[0] as { chainId: string }).chainId);
          return null;
        }
        return windowTest.testnetWallet(method, params);
      },
    };
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { name: 'Controlled testnet wallet', uuid: 'testnet-control', rdns: 'buidl.testnet' }, provider },
    })));
  }, { owner: accounts[0] });

  await page.goto('/?testnet=1');
  await page.getByRole('button', { name: 'Controlled testnet wallet', exact: true }).click();
  await expect(page.getByText(/Wallet chain 196/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Estimate testnet deployment' })).toBeDisabled();
  expect(sent).toBe(0);
  await page.getByRole('button', { name: 'Switch to X Layer testnet' }).click();
  await expect(page.getByText(/Wallet chain 1952/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Estimate testnet deployment' }).click();
  await expect(page.getByText(/Estimated deployment budget/)).toBeVisible();
  expect(sent).toBe(0);
  await page.getByRole('button', { name: 'Review and deploy test fixtures' }).click();

  // Switching networks after estimation must still prevent a wallet send.
  await expect(page.getByRole('dialog', { name: 'Review testnet transaction' })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('testnet-chain', '0xc4'));
  await page.getByRole('button', { name: 'Continue in wallet' }).click();
  await expect(page.getByRole('alert')).toContainText('Wrong network');
  expect(sent).toBe(0);
  await page.getByRole('button', { name: 'Switch to X Layer testnet' }).click();
  await expect(page.getByText(/Wallet chain 1952/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Review and deploy test fixtures' }).click();

  async function confirm(expected: string) {
    const dialog = page.getByRole('dialog', { name: 'Review testnet transaction' });
    await expect(dialog.getByText(expected, { exact: true })).toBeVisible();
    await expect(dialog.getByText(/Estimated maximum at quoted gas price/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Continue in wallet' }).click();
  }
  await confirm('Deploy simulated DeWEB circuit and store');
  await confirm('Deploy test custody authority');
  await expect(page.getByRole('button', { name: 'Enroll simulated circuit' })).toBeEnabled();
  expect(sent).toBe(2);
  await page.getByRole('button', { name: 'Enroll simulated circuit' }).click();
  await confirm('Enroll simulated circuit in test custody');
  await expect(page.getByText('Registry', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Separate reviewer addresses' }).fill(accounts.slice(1, 4).join('\n'));
  await page.getByRole('button', { name: 'Register reviewer policy' }).click();
  await confirm('Register independent testnet reviewer policy');
  await expect(page.getByRole('button', { name: 'Load sample A' })).toBeEnabled();
  await page.getByRole('button', { name: 'Load sample A' }).click();
  await page.getByRole('button', { name: 'Create approval request', exact: true }).click();
  await expect(page.getByText('Release #1 · 0 signatures')).toBeVisible();
  async function account(index: number) {
    await page.evaluate(value => sessionStorage.setItem('testnet-account', value), accounts[index]);
    await page.getByRole('button', { name: 'Controlled testnet wallet', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign as reviewer' })).toBeEnabled();
  }
  await account(1);
  await page.getByRole('button', { name: 'Sign as reviewer' }).click();
  await expect(page.getByText('Release #1 · 1 signatures')).toBeVisible();
  await account(2);
  await page.getByRole('button', { name: 'Sign as reviewer' }).click();
  await expect(page.getByText('Release #1 · 2 signatures')).toBeVisible();
  await page.getByRole('button', { name: 'Record approval', exact: true }).click();
  await confirm('Record threshold approval on testnet');
  await expect(page.getByRole('button', { name: 'Publish approved build' })).toBeEnabled();
  await account(0);
  await page.getByRole('button', { name: 'Publish approved build' }).click();
  for (const label of ['Begin approved testnet publication', 'Upload index.html · chunk 1/1', 'Upload payment.json · chunk 1/1',
    'Set testnet fallback route', 'Finish publication after byte verification']) await confirm(label);
  await expect(page.getByRole('heading', { name: 'Matches approved release.' })).toBeVisible();

  await page.getByRole('button', { name: 'Begin interrupted upload' }).click();
  await confirm('Begin and leave publication interrupted');
  await expect(page.getByRole('heading', { name: 'Verification unavailable.' })).toBeVisible();
  await page.getByRole('button', { name: 'Test changed payment file' }).click();
  await confirm('Write changed payment destination with matching SHA-256');
  await confirm('Finish controlled mismatch attempt');
  await expect(page.getByRole('heading', { name: 'Deployment differs from approved release.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'payment.json', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Revoke approval', exact: true }).click();
  await confirm('Revoke current testnet release');
  await expect(page.getByRole('heading', { name: 'Approval revoked or expired.' })).toBeVisible();
  await page.getByRole('button', { name: 'Recover simulated circuit', exact: true }).click();
  await confirm('Return simulated circuit to the depositor');
  await expect(page.getByRole('heading', { name: 'No qualifying approval.' })).toBeVisible();
  await page.getByRole('textbox', { name: 'New owner after recovery' }).fill(accounts[4]);
  await page.getByRole('button', { name: 'Transfer recovered circuit', exact: true }).click();
  await confirm('Transfer recovered simulated circuit to a new owner');
  await expect(page.getByRole('button', { name: 'Enroll simulated circuit' })).toBeEnabled();
  await account(4);
  await page.getByRole('button', { name: 'Enroll simulated circuit', exact: true }).click();
  await confirm('Enroll simulated circuit in test custody');
  await expect(page.getByRole('heading', { name: 'No qualifying approval.' })).toBeVisible();
  // Old policy and signatures do not survive recovery and a new ownership epoch.
  await page.getByRole('button', { name: 'Sign as reviewer', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('stale testnet approval request');
  await page.getByRole('button', { name: 'Register reviewer policy' }).click();
  await confirm('Register independent testnet reviewer policy');
  await expect(page.getByRole('button', { name: 'Create approval request', exact: true })).toBeEnabled();
  await page.getByRole('checkbox', { name: /Explicitly approve a rollback/ }).check();
  await page.getByRole('button', { name: 'Create approval request', exact: true }).click();
  await expect(page.getByText('Release #2 · 0 signatures · Rollback')).toBeVisible();
  await page.getByRole('button', { name: 'Recover simulated circuit', exact: true }).click();
  await confirm('Return simulated circuit to the depositor');
  await expect(page.getByRole('heading', { name: 'No qualifying approval.' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export receipts & results' }).click();
  expect((await download).suggestedFilename()).toBe('buidl-testnet-report.json');
});
