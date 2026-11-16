import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { encodeFunctionData, toHex } from 'viem';
import { readBuild } from './core/build';
import { manifestDigest, parseManifest } from './core/manifest';
import { outcomes } from './core/local';
import { inspectLive, liveRpc } from './core/tapeout';
import { checkXLayer, circuitAbi, requireXLayerGate, xLayerAuthoritySetup } from './core/xlayer-release';
import { publishXLayer, type XLayerSender } from './publish-xlayer';

function keystoreSender(account: string): XLayerSender {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(account)) throw new Error('Provide a Foundry keystore account name.');
  return (transaction, governor) => new Promise((resolve, reject) => {
    const child = spawn('cast', ['send', transaction.to, '--data', transaction.data, '--chain', '196',
      '--account', account, '--from', governor, '--rpc-url', 'https://rpc.xlayer.tech', '--json'],
    { stdio: ['inherit', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) return reject(new Error('The X Layer wallet command failed.'));
      try {
        const receipt = JSON.parse(stdout) as { status: string; transactionHash: string; blockNumber: string };
        if (BigInt(receipt.status) !== 1n) throw new Error(`X Layer transaction reverted: ${receipt.transactionHash}`);
        console.error(receipt.transactionHash);
        resolve(BigInt(receipt.blockNumber));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export async function xLayerCli(command: string, args: string[]) {
  const [name, directory, manifestPath, broadcast, accountFlag, account] = args;
  if (command === 'verify-xlayer' && args.length === 1) {
    const { inspection, approval, outcome, reason } = await checkXLayer(name);
    console.log(JSON.stringify({ outcome: outcomes[outcome], reason, inspection, approval }, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2));
    if (outcome !== 'match') process.exitCode = 2;
    return true;
  }
  if (command === 'plan-xlayer' && args.length === 1) {
    const rpc = liveRpc();
    const inspection = await inspectLive(name, rpc);
    if (!inspection.site || !inspection.holder || !inspection.registry || inspection.status === 'unavailable') {
      throw new Error(inspection.detail ?? 'Expected an opened TapeOut circuit.');
    }
    const { site, holder } = inspection;
    const setup = await xLayerAuthoritySetup(inspection, rpc);
    if (holder === setup.address) throw new Error('The circuit is already enrolled.');
    if (!setup.deployed) {
      // ERC-721 does not call a receiver on an address without code. Only offer enrollment after deployment is checked.
      console.log(JSON.stringify({ site, holder, authority: setup.address, deploy: setup.transaction,
        next: 'After the authority appears at a checked block, run plan-xlayer again for enrollment.' }, null, 2));
    } else {
      const salt = setup.registry ? '0x' : toHex(randomBytes(32));
      console.log(JSON.stringify({ site, holder, authority: setup.address,
        enrollment: { to: site.processor, data: encodeFunctionData({ abi: circuitAbi, functionName: 'safeTransferFrom',
          args: [holder, setup.address, BigInt(site.circuitId), salt] }) } }, null, 2));
    }
    return true;
  }
  if ((command === 'gate-xlayer' && args.length === 3) ||
      (command === 'publish-xlayer' && args.length === 6 && broadcast === '--broadcast' && accountFlag === '--account')) {
    const manifest = parseManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
    const staged = await readBuild(directory, { site: manifest.site, release: manifest.release,
      fallback: manifest.routing.fallback, provenance: manifest.provenance });
    if (manifestDigest(staged.manifest) !== manifestDigest(manifest)) throw new Error('Build differs from the approved manifest.');
    const check = () => checkXLayer(name);
    if (command === 'gate-xlayer') {
      const { inspection, approval } = await check();
      requireXLayerGate(manifest, inspection, approval);
      console.log('X Layer gate passed.', manifestDigest(manifest));
    } else {
      const result = await publishXLayer(staged, check, keystoreSender(account));
      console.log('Matches approved release.', result.inspection.block?.number, result.inspection.block?.hash);
    }
    return true;
  }
  return false;
}
