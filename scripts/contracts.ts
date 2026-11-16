import { mkdir, readFile, writeFile } from 'node:fs/promises';
import solc from 'solc';
import { keccak256, type Abi, type Hex } from 'viem';

type ContractName = 'ReleaseRegistry' | 'LocalDeweb' | 'TapeOutSiteAuthority';

export async function compileContracts(...names: ContractName[]) {
  const sources = Object.fromEntries(await Promise.all(names.map(async name =>
    [`${name}.sol`, { content: await readFile(`contracts/${name}.sol`, 'utf8') }],
  )));
  const compiled = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources,
    settings: {
      viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
    },
  }))) as {
    errors?: { severity: string; formattedMessage: string }[];
    contracts: Record<string, Record<string, { abi: Abi; evm: { bytecode: { object: string }; deployedBytecode: { object: string } } }>>;
  };
  const errors = compiled.errors?.filter(error => error.severity === 'error');
  if (errors?.length) throw new Error(errors.map(error => error.formattedMessage).join('\n'));
  return (name: ContractName) => {
    const { abi, evm } = compiled.contracts[`${name}.sol`][name];
    return { abi, bytecode: `0x${evm.bytecode.object}` as Hex, runtime: `0x${evm.deployedBytecode.object}` as Hex };
  };
}

if (process.argv[2] === '--write') {
  const compile = await compileContracts('ReleaseRegistry', 'TapeOutSiteAuthority');
  await mkdir('build-contracts', { recursive: true });
  for (const name of ['ReleaseRegistry', 'TapeOutSiteAuthority'] as const) {
    const artifact = compile(name);
    await writeFile(`build-contracts/${name}.json`, JSON.stringify(artifact, null, 2) + '\n');
    if (name === 'TapeOutSiteAuthority') {
      const clientArtifact = JSON.stringify({ bytecode: artifact.bytecode, runtimeHash: keccak256(artifact.runtime) }, null, 2) + '\n';
      const path = 'src/core/generated/tapeout-site-authority.json';
      if (process.argv[3] === '--update-client') await writeFile(path, clientArtifact);
      if (await readFile(path, 'utf8') !== clientArtifact) throw new Error('Authority source differs from the pinned client artifact.');
      console.log(`Authority runtime hash: ${keccak256(artifact.runtime)}`);
    }
  }
}
