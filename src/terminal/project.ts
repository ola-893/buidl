import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createPublicClient, http, type Address } from 'viem';
import { address, object } from '../core/manifest';
import { assertTestnet, parseTestnetConfig, testnet, TESTNET_RPCS, type TestnetConfig } from '../core/testnet';
import { jsonText } from './output';
export type Project = { version: 1; name?: string; network: 'xlayer-testnet-fixtures'; chainId: 1952; rpcUrl: string; owner: Address; reviewers: Address[]; threshold: number; fixtures?: TestnetConfig };
export const loadJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));
export async function saveNew(path: string, data: unknown) {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, jsonText(data) + '\n', { flag: 'wx', mode: 0o600 });
}
export function rpcUrl(value: unknown) {
  if (typeof value !== 'string') throw new Error('Expected a testnet RPC URL.');
  const url = new URL(value);
  if (url.username || url.password || url.hash || !['http:', 'https:'].includes(url.protocol)) throw new Error('Use an HTTP(S) RPC without URL credentials or fragments.');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Remote RPC endpoints require HTTPS.');
  return url.toString();
}
export function parseProject(input: unknown): Project {
  const p = object(input, ['version', 'name', 'network', 'chainId', 'rpcUrl', 'owner', 'reviewers', 'threshold', 'fixtures'], 'buidl project');
  if (p.version !== 1 || p.network !== 'xlayer-testnet-fixtures' || p.chainId !== 1952) throw new Error('This workflow requires X Layer testnet fixtures, chain 1952. Mainnet is rejected.');
  if (p.name !== undefined && (typeof p.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,79}$/.test(p.name))) throw new Error('App name must be 1–80 letters, numbers, spaces, dots, underscores or hyphens.');
  const owner = address(p.owner);
  if (!Array.isArray(p.reviewers)) throw new Error('Provide separate reviewer addresses.');
  const reviewers = p.reviewers.map(address).sort();
  if (new Set(reviewers).size !== reviewers.length || reviewers.includes(owner) || reviewers.length > 31 ||
      !Number.isInteger(p.threshold) || Number(p.threshold) < 1 || Number(p.threshold) > reviewers.length) throw new Error('Invalid reviewer policy: distinct reviewers must differ from the owner and meet the threshold.');
  return { version: 1, ...(p.name ? { name: p.name as string } : {}), network: 'xlayer-testnet-fixtures', chainId: 1952, rpcUrl: rpcUrl(p.rpcUrl ?? TESTNET_RPCS[0]), owner,
    reviewers, threshold: Number(p.threshold), ...(p.fixtures ? { fixtures: parseTestnetConfig(p.fixtures) } : {}) };
}
export async function projectAt(path = 'buidl.json', overrideRpc?: string) {
  const project = parseProject(await loadJson(path));
  const client = createPublicClient({ chain: testnet, transport: http(overrideRpc ? rpcUrl(overrideRpc) : project.rpcUrl, { timeout: 45_000, retryCount: 0 }) });
  await assertTestnet(client);
  return { project, client };
}
export function fixtures(project: Project) {
  if (!project.fixtures) throw new Error('No fixture deployment configured. Run buidl app deploy --execute first.');
  return project.fixtures;
}
