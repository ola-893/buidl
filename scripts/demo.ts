import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import solc from 'solc';
import { getAddress, toHex, type Abi, type Address, type Hex } from 'viem';
import { approvalTypedData, registryAbi, signaturesFor, siteTuple } from '../src/core/approval';
import { readBuild } from '../src/core/build';
import { compareLocal, inspectLocal, LOCAL_RPC, localAbi, localClient, localState, newRequest, outcomes, parseLocalConfig, type LocalConfig } from '../src/core/local';
import { canonical, parseManifest } from '../src/core/manifest';
import { gate, localWallet, publishLocal, waitFor } from '../src/publish';

const client = localClient();
const configPath = 'public/local-demo/config.json';
const releaseFile = (name: string) => `public/local-demo/manifest-${name}.json`;
const releaseDir = (name: string) => `demo/release-${name}`;
const load = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as unknown;
const accounts = () => localWallet('0x0000000000000000000000000000000000000001').getAddresses().then(list => list.map(getAddress));

async function compile() {
  const names = ['ReleaseRegistry', 'LocalDeweb'] as const;
  const sources = Object.fromEntries(await Promise.all(names.map(async name => [`${name}.sol`, { content: await readFile(`contracts/${name}.sol`, 'utf8') }])));
  const compiled = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources,
    settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  }))) as { errors?: { severity: string; formattedMessage: string }[]; contracts: Record<string, Record<string, { abi: Abi; evm: { bytecode: { object: string } } }>> };
  const errors = compiled.errors?.filter(error => error.severity === 'error');
  if (errors?.length) throw new Error(errors.map(error => error.formattedMessage).join('\n'));
  return (name: (typeof names)[number]) => {
    const contract = compiled.contracts[`${name}.sol`][name];
    return { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` as Hex };
  };
}

async function init(register = true) {
  if (await client.getChainId() !== 31337) throw new Error('Run Anvil on loopback with chain ID 31337.');
  const [holder, ...reviewers] = await accounts();
  if (reviewers.length < 3) throw new Error('The demo requires one local publishing account and three reviewer accounts.');
  const wallet = localWallet(holder);
  const contract = await compile();
  async function deploy(name: 'LocalDeweb' | 'ReleaseRegistry', args: unknown[] = []) {
    const receipt = await waitFor(await wallet.deployContract({ ...contract(name), args }));
    if (!receipt.contractAddress) throw new Error('Missing deployed contract address.');
    return receipt.contractAddress;
  }
  const fixture = await deploy('LocalDeweb');
  const registry = await deploy('ReleaseRegistry', [fixture, toHex(randomBytes(32))]);
  const config = parseLocalConfig({ registry, site: { chainId: 31337, processor: fixture, circuitId: '1', container: fixture } });
  if (register) {
    await waitFor(await wallet.writeContract({ address: registry, abi: registryAbi, functionName: 'setPolicy',
      args: [siteTuple(config.site), reviewers.slice(0, 3).map(a => a.toLowerCase() as Address).sort(), 2n] }));
  }
  await mkdir('public/local-demo', { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2));
  await writeFile('public/local-demo/site.json', JSON.stringify(config.site, null, 2));
  for (const name of ['a', 'b']) {
    const { manifest } = await readBuild(releaseDir(name), { site: config.site, release: `checkout-${name}`, fallback: 'index.html' });
    await writeFile(releaseFile(name), canonical(manifest) + '\n');
  }
  console.log(register ? 'Local fixture and 2-of-3 policy initialized.' : 'Local fixture initialized. Register it in the dashboard.', config.registry);
  return config;
}

async function approve(config: LocalConfig, name: string) {
  const manifest = parseManifest(await load(releaseFile(name)));
  const state = await localState(config);
  const request = await newRequest(config, manifest, Number(state.block.timestamp) + 3_600, false);
  const [holder, first, second] = await accounts();
  for (const reviewer of [first, second]) {
    request.signatures.push(await localWallet(reviewer).signTypedData(approvalTypedData(request)));
  }
  const reviewed = await signaturesFor(request, state.policy);
  await waitFor(await localWallet(holder).writeContract({ address: config.registry, abi: registryAbi, functionName: 'record',
    args: [siteTuple(config.site), approvalTypedData(request).message, reviewed.map(([, signature]) => signature)] }));
  await writeFile(`public/local-demo/evidence-${name}.json`, JSON.stringify(request, null, 2));
  console.log(`Release ${name.toUpperCase()} approved by 2 of 3 configured reviewers.`);
  return manifest;
}

async function bypass(config: LocalConfig) {
  const [holder] = await accounts();
  const manifest = parseManifest(await load(releaseFile('b')));
  const file = manifest.files.find(file => file.path === 'payment.json')!;
  const bytes = await readFile(`${releaseDir('b')}/payment.json`);
  const update = { address: config.site.container, abi: localAbi, functionName: 'putFile',
    args: [config.site.container, file.path, file.type, file.sha256, toHex(bytes)], account: getAddress(holder),
  } as const;
  const estimate = await client.estimateContractGas(update);
  await waitFor(await localWallet(holder).writeContract({ ...update, gas: estimate + 12_000n }));
  console.log('Publisher directly wrote payment.json with a matching SHA-256 on the local chain.');
}

async function verify(config: LocalConfig, name: string) {
  const manifest = parseManifest(await load(releaseFile(name)));
  const state = await localState(config);
  const inspection = await inspectLocal(config, client, state.block.number);
  const result = compareLocal(inspection, state, manifest);
  console.log(outcomes[result.outcome], `${inspection.files.filter(f => f.status === 'verified').length}/${inspection.files.length} file hashes verified.`);
  for (const change of result.changes) console.log(change.kind, change.path, change.fields.join(', '));
  return result.outcome;
}

async function main() {
  const [action = 'run', name] = process.argv.slice(2);
  if (action === 'init') {
    if (name && name !== '--unregistered') throw new Error('Use init [--unregistered].');
    return void await init(name !== '--unregistered');
  }
  const config = action === 'run' ? await init() : parseLocalConfig(await load(configPath));
  if (action === 'approve' && (name === 'a' || name === 'b')) return void await approve(config, name);
  if (action === 'bypass-b') return await bypass(config);
  if (action === 'verify' && (name === 'a' || name === 'b')) return void await verify(config, name);
  if (action !== 'run') throw new Error('Use init, run, approve a|b, bypass-b, or verify a|b.');
  const a = await approve(config, 'a');
  await publishLocal(releaseDir('a'), a, config);
  if (await verify(config, 'a') !== 'match') throw new Error('Expected A to match.');
  let rejected = false;
  try { await gate(releaseDir('b'), a, config); } catch { rejected = true; }
  if (!rejected) throw new Error('Gate accepted changed artifacts.');
  console.log('Gate rejected B under approval A.');
  await bypass(config);
  if (await verify(config, 'a') !== 'differs') throw new Error('Expected unapproved B to differ.');
  await approve(config, 'b');
  if (await verify(config, 'b') !== 'match') throw new Error('Expected approved B to match.');
}

main().catch(error => {
  console.error(`${error.message}\nLocal RPC: ${LOCAL_RPC}`);
  process.exitCode = 1;
});
