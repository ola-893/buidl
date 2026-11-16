import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { readBuild } from './core/build';
import { outcomes } from './core/local';
import { address, manifestDigest, parseManifest } from './core/manifest';
import { parseTestnetConfig, planTestnet, requireTestnetGate, testnetOutcome, testnetSnapshot } from './core/testnet';

const load = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as unknown;
export async function testnetCli(command: string, args: string[]) {
  if (command === 'plan-testnet-fixtures') {
    const { values, positionals } = parseArgs({ args, allowPositionals: true,
      options: { 'chain-id': { type: 'string' }, out: { type: 'string' } } });
    if (values['chain-id'] !== '1952') throw new Error('Explicit --chain-id 1952 is required. Mainnet is rejected.');
    if (positionals.length !== 1 || !values.out) throw new Error('Use plan-testnet-fixtures <owner> --chain-id 1952 --out <plan.json>');
    const plan = await planTestnet(address(positionals[0]));
    await writeFile(values.out, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ kind: 'testnet-fixtures', chainId: 1952, config: plan.config,
      balanceWei: plan.balanceWei, estimatedTestTokenWei: plan.maximumAtQuotedGasPriceWei }, null, 2));
    return true;
  }
  if (command === 'verify-testnet-fixtures' && args.length === 1) {
    const config = parseTestnetConfig(await load(args[0]));
    const snapshot = await testnetSnapshot(config);
    const outcome = testnetOutcome(snapshot);
    console.log(JSON.stringify({ source: 'testnet-fixtures', chainId: 1952, outcome: outcomes[outcome], snapshot },
      (_, value) => typeof value === 'bigint' ? value.toString() : value, 2));
    if (outcome !== 'match') process.exitCode = 2;
    return true;
  }
  if (command === 'gate-testnet-fixtures' && args.length === 3) {
    const manifest = parseManifest(await load(args[1]));
    const config = parseTestnetConfig(await load(args[2]));
    const staged = await readBuild(args[0], { site: manifest.site, release: manifest.release,
      fallback: manifest.routing.fallback, provenance: manifest.provenance });
    if (manifestDigest(staged.manifest) !== manifestDigest(manifest)) throw new Error('The build differs from the approved testnet manifest.');
    requireTestnetGate(manifest, config, await testnetSnapshot(config));
    console.log('Testnet fixture gate passed.', manifestDigest(manifest));
    return true;
  }
  return false;
}
