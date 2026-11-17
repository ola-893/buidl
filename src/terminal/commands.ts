import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { formatEther, type Address } from 'viem';
import { address } from '../core/manifest';
import { testnetSnapshot } from '../core/testnet';
import { connectedWallet, connectionClient, connectWallet, disconnectWallet, connectionFile } from './connection';
import { fixtures, loadJson, parseProject, projectAt } from './project';
import { terminalTestnet } from './testnet-cli';
import { report } from './output';
import { WalletSender } from './sender';

export const operationalHelp = `buidl · release approval and publishing

Wallet
  wallet connect --network testnet [--account ADDRESS] [--rpc URL]
  wallet show | disconnect
  wallet history [--project buidl.json]
  wallet reconcile --hash HASH [--project buidl.json]

Apps
  app init NAME --network testnet --reviewers A,B [--threshold 2] [--fixtures FILE]
  app show | status | deploy | enroll | register | recover
  app transfer --to ADDRESS
  policy show
  policy set [--reviewers A,B] [--threshold N]

Releases
  release create NAME --build DIR --out MANIFEST [--fallback index.html]
  release inspect MANIFEST
  release request MANIFEST --out REQUEST [--rollback]
  release sign REQUEST --out SIGNED
  release approve SIGNED [MORE_SIGNED ...]
  release gate BUILD MANIFEST
  release publish BUILD MANIFEST
  release status | verify [--manifest MANIFEST] [--out REPORT]
  release revoke

Diagnostics
  doctor                          Check RPC, balance, contracts and pending transactions
  diagnostics                     Show installed CLI and configuration paths
  inspect X_LAYER_IDENTIFIER      Read-only TapeOut content inspection

Add --execute to deploy, enroll, register, set policy, approve, publish, revoke,
recover or transfer. Without it, commands preview their action. Connect the
appropriate wallet first; every signature and transaction is confirmed there.

Common: --project buidl.json · --rpc URL · --json · --no-open · --help · --version
Wallet and write operations use X Layer testnet (1952). Mainnet is rejected.
Testnet hosting uses labeled buidl fixtures; mainnet inspection is read-only.`;

export async function operationalCli(group: string, args: string[]) {
  const { positionals, values: v } = parseArgs({ args, allowPositionals: true, options: {
    network:{type:'string'},account:{type:'string'},rpc:{type:'string'},project:{type:'string'},owner:{type:'string'},
    reviewers:{type:'string'},threshold:{type:'string'},fixtures:{type:'string'},fixture:{type:'string'},
    build:{type:'string'},out:{type:'string'},fallback:{type:'string'},manifest:{type:'string'},to:{type:'string'},hash:{type:'string'},
    execute:{type:'boolean'},rollback:{type:'boolean'},json:{type:'boolean'},help:{type:'boolean'},'no-open':{type:'boolean'},
  } });
  const [action, ...p] = positionals;
  if (v.help || !action && !['doctor'].includes(group)) return console.log(operationalHelp);
  if (v.network && v.network !== 'testnet') throw new Error('Only --network testnet (X Layer 1952) is supported for wallet and write operations. Mainnet is rejected.');
  const run = (input: string[]) => terminalTestnet(input, true);
  const projectPath = resolve(v.project ?? 'buidl.json');
  const common = ['--project',projectPath,...(v.rpc?['--rpc',v.rpc]:[]),...(v.json?['--json']:[]),...(v['no-open']?['--no-open']:[])];
  const flag = (name:string,value:string|undefined) => value === undefined ? [] : [`--${name}`,value];
  const ensureNoArgs = () => { if (p.length) throw new Error(operationalHelp); };
  const write = async (command:string, rest:string[] = []) => {
    ensureNoArgs();
    const wallet = v.execute ? await connectedWallet(true) : undefined;
    return run([command,...rest,...common,...(v.execute?['--broadcast','--wallet','--from',wallet!.address]:[])]);
  };
  if (group === 'wallet') {
    ensureNoArgs();
    if (action === 'connect') {
      if (v.network !== 'testnet') throw new Error('Choose the network explicitly: buidl wallet connect --network testnet');
      const { connection, balance } = await connectWallet({ rpc:v.rpc,account:v.account?address(v.account):undefined,open:!v['no-open'] });
      return report('Wallet connected',{network:'X Layer testnet',chainId:1952,address:connection.address,wallet:connection.wallet,balanceTestOKB:formatEther(balance),
        profile:connectionFile(),next:'buidl app init YOUR_APP --network testnet --reviewers ADDRESS1,ADDRESS2'},v.json);
    }
    if (action === 'disconnect') {
      await disconnectWallet();
      return report('Wallet disconnected',{connected:false,detail:'Saved CLI connection removed. Reject any pending request in your extension separately.'},v.json);
    }
    if (action === 'show') {
      const wallet=await connectedWallet();
      if(!wallet)return report('Wallet disconnected',{connected:false,next:'buidl wallet connect --network testnet'},v.json);
      const client=connectionClient(v.rpc??wallet.rpcUrl);
      const [chainId,balance,block]=await Promise.all([client.getChainId(),client.getBalance({address:wallet.address}),client.getBlockNumber()]);
      if(chainId!==1952)throw new Error('Configured wallet RPC is not X Layer testnet 1952.');
      return report('Connected wallet',{connected:true,address:wallet.address,wallet:wallet.wallet,network:'X Layer testnet',chainId,balanceTestOKB:formatEther(balance),
        checkedBlock:block,connectedAt:wallet.connectedAt,signing:'Browser wallet confirms each release signature and transaction'},v.json);
    }
    if(action==='history'){
      const {project,client}=await projectAt(projectPath,v.rpc);
      const sender=new WalletSender(client,project.owner,projectPath,false);
      return report('Transaction history',{transactions:(await sender.entries()).map(e=>({action:e.plan.label,status:e.status,account:e.plan.from,nonce:e.plan.nonce,hash:e.hash,paidTestOKB:e.paidWei?formatEther(BigInt(e.paidWei)):undefined})),file:sender.journal},v.json);
    }
    if(action==='reconcile')return run(['reconcile',...flag('hash',v.hash),...common]);
  }
  if (group === 'app') {
    if(action==='init'){
      if(p.length!==1||!v.reviewers||v.network!=='testnet')throw new Error('Use buidl app init NAME --network testnet --reviewers ADDRESS1,ADDRESS2');
      const wallet=await connectedWallet(!v.owner);
      const owner=address(v.owner??wallet!.address);
      return run(['init','--name',p[0],'--owner',owner,'--reviewers',v.reviewers,...flag('threshold',v.threshold),...flag('fixtures',v.fixtures),
        ...common,...(!v.rpc&&wallet?['--rpc',wallet.rpcUrl]:[])]);
    }
    ensureNoArgs();
    if(action==='show'){
      const project=parseProject(await loadJson(projectPath));
      return report('App configuration',{name:project.name,network:'X Layer testnet · simulated hosting fixtures',chainId:1952,owner:project.owner,
        reviewers:project.reviewers,threshold:project.threshold,contracts:project.fixtures,project:projectPath},v.json);
    }
    if(action==='status')return run(['status',...common]);
    if(action==='deploy')return write('deploy',flag('fixture',v.fixture));
    if(action==='enroll')return write('enroll');
    if(action==='register')return write('policy');
    if(action==='recover')return write('recover');
    if(action==='transfer')return write('transfer',flag('to',v.to));
  }
  if (group === 'policy') {
    ensureNoArgs();
    if(action==='set')return write('policy',[...flag('reviewers',v.reviewers),...flag('threshold',v.threshold)]);
    if(action==='show'){
      const {project,client}=await projectAt(projectPath,v.rpc);const state=await testnetSnapshot(fixtures(project),client);
      return report('Onchain reviewer policy',{registry:state.registry,currentAuthority:state.approval?.authorityCurrent,policy:state.approval?.policy,checkedBlock:state.inspection.block},v.json);
    }
  }
  if (group === 'release') {
    if(action==='create'){
      if(p.length!==1||!v.build||!v.out)throw new Error('Use buidl release create NAME --build DIRECTORY --out MANIFEST');
      return run(['manifest',v.build,'--release',p[0],'--out',v.out,...flag('fallback',v.fallback),...common]);
    }
    if(action==='inspect'){
      if(p.length!==1)throw new Error('Use buidl release inspect MANIFEST');
      const {parseManifest,manifestDigest}=await import('../core/manifest');const m=parseManifest(await loadJson(p[0]));
      return report('Release manifest',{release:m.release,digest:manifestDigest(m),site:m.site,routing:m.routing,files:m.files},v.json);
    }
    if(action==='request')return run(['request',...p,...flag('out',v.out),...(v.rollback?['--rollback']:[]),...common]);
    if(action==='sign'){
      const wallet=await connectedWallet(true);
      return run(['sign',...p,'--reviewer',wallet!.address,'--wallet',...flag('out',v.out),...common]);
    }
    if(action==='approve'){
      const wallet=v.execute?await connectedWallet(true):undefined;
      return run(['approve',...p,...flag('out',v.out),...common,...(v.execute?['--broadcast','--wallet','--from',wallet!.address]:[])]);
    }
    if(action==='gate'||action==='publish'){
      const wallet=v.execute?await connectedWallet(true):undefined;
      return run([action,...p,...common,...(v.execute?['--broadcast','--wallet','--from',wallet!.address]:[])]);
    }
    if(action==='status'||action==='verify')return run([action,...p,...flag('manifest',v.manifest),...flag('out',v.out),...common]);
    if(action==='revoke')return write('revoke');
  }
  if (group==='doctor'&&!positionals.length) {
    try { await loadJson(projectPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const wallet = await connectedWallet();
      if (!wallet) { process.exitCode=2; return report('Setup required',{wallet:'Not connected',app:'Not configured',next:'buidl wallet connect --network testnet'},v.json); }
      const client=connectionClient(v.rpc??wallet.rpcUrl);
      const [chainId,balance]=await Promise.all([client.getChainId(),client.getBalance({address:wallet.address})]);
      if(chainId!==1952)throw new Error('Wallet RPC must use X Layer testnet 1952.');
      return report('Wallet ready; configure an app',{address:wallet.address,chainId,balanceTestOKB:formatEther(balance),app:'Not configured',next:'buidl app init NAME --network testnet --reviewers ADDRESS1,ADDRESS2'},v.json);
    }
    return run(['doctor',...common]);
  }
  throw new Error(`Unknown ${group} command.\n${operationalHelp}`);
}
