import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { readBuild } from './core/build';
import { canonical, manifestDigest, parseManifest, parseSite } from './core/manifest';
import { inspectLive } from './core/tapeout';
import { compareLocal, inspectLocal, localState, outcomes, parseLocalConfig } from './core/local';
import { gate, publishLocal } from './publish';
import { testnetCli } from './cli-testnet';
import { xLayerCli } from './cli-xlayer';
import { terminalTestnet } from './terminal/testnet-cli';
import { operationalCli, operationalHelp } from './terminal/commands';
import { connectionFile } from './terminal/connection';
import { report } from './terminal/output';
import { fileURLToPath } from 'node:url';
import packageInfo from '../package.json';

const help = operationalHelp;

const load = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as unknown;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--version' || command === '-v') return console.log(packageInfo.version);
  if (command === 'testnet') return terminalTestnet(args);
  if (['wallet','app','policy','release','doctor'].includes(command)) return operationalCli(command, args);
  if (command === 'diagnostics') return report('CLI diagnostics', { version: packageInfo.version, package: packageInfo.name, executable: process.argv[1], runtime: process.version, module: fileURLToPath(import.meta.url), walletProfile: connectionFile() }, args.includes('--json'));
  if (!command || command === '--help' || command === '-h') {
    console.log(help);
    return;
  }
  if (command === 'inspect' && args.length === 1) {
    const result = await inspectLive(args[0]);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'complete') process.exitCode = 2;
    return;
  }
  if (command === 'manifest') {
    const { positionals, values } = parseArgs({
      args, allowPositionals: true, options: {
        site: { type: 'string' }, release: { type: 'string' }, out: { type: 'string' },
        fallback: { type: 'string' }, commit: { type: 'string' }, provenance: { type: 'string' },
      },
    });
    if (positionals.length !== 1 || !values.site || !values.release || !values.out) throw new Error(help);
    const site = parseSite(await load(values.site));
    const provenance = values.commit || values.provenance ? { commit: values.commit, build: values.provenance } : undefined;
    const { manifest } = await readBuild(positionals[0], { site, release: values.release, fallback: values.fallback, provenance });
    await writeFile(values.out, canonical(manifest) + '\n', { flag: 'wx' });
    console.log(manifestDigest(manifest));
    return;
  }
  if (['gate', 'publish-local'].includes(command) && args.length === 3) {
    const [directory, manifestPath, configPath] = args;
    const manifest = parseManifest(await load(manifestPath));
    const config = parseLocalConfig(await load(configPath));
    if (command === 'gate') {
      await gate(directory, manifest, config);
      console.log('Gate passed.', manifestDigest(manifest));
    } else {
      const receipt = await publishLocal(directory, manifest, config);
      console.log('Local deployment finished.', receipt.transactionHash);
    }
    return;
  }
  if (command === 'verify-local' && args.length === 2) {
    const manifest = parseManifest(await load(args[0]));
    const config = parseLocalConfig(await load(args[1]));
    try {
      const state = await localState(config);
      const inspection = await inspectLocal(config, undefined, state.block.number);
      const result = compareLocal(inspection, state, manifest);
      console.log(JSON.stringify({ outcome: outcomes[result.outcome], block: inspection.block, detail: inspection.detail, changes: result.changes }, null, 2));
      if (result.outcome !== 'match') process.exitCode = 2;
    } catch (error) {
      console.log(JSON.stringify({ outcome: outcomes.unavailable, detail: (error as Error).message }, null, 2));
      process.exitCode = 2;
    }
    return;
  }
  if (await testnetCli(command, args)) return;
  if (await xLayerCli(command, args)) return;
  throw new Error(`Unknown command: ${command}.\n${help}`);
}

main().catch(error => {
  console.error(process.argv.includes('--json') ? JSON.stringify({ error: error.message }) : error.message);
  process.exitCode = 1;
});
