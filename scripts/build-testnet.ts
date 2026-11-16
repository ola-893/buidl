import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { keccak256 } from 'viem';
import { compileContracts } from './contracts';

const compiled = await compileContracts('LocalDeweb', 'ReleaseRegistry', 'TestnetDeweb', 'TestnetAuthority');
await mkdir('src/core/generated', { recursive: true });
for (const name of ['TestnetDeweb', 'TestnetAuthority'] as const) {
  const contract = compiled(name);
  const path = `src/core/generated/${name}.json`;
  const expected = JSON.stringify({
    abi: contract.abi, bytecode: contract.bytecode, runtimeHash: keccak256(contract.runtime),
  }, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (await readFile(path, 'utf8') !== expected) throw new Error(`${name} source differs from its pinned testnet artifact.`);
  } else await writeFile(path, expected);
  console.log(name, keccak256(contract.runtime));
}
