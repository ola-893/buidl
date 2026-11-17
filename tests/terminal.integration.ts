import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { chromium } from '@playwright/test';

test('individual CLI commands connect wallets, sign approvals, send transactions and recover custody', {timeout:180_000}, async t=>{
  const root=await mkdtemp(join(tmpdir(),'buidl-operational-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const endpoint='http://127.0.0.1:8551';
  const node=spawn('anvil',['--host','127.0.0.1','--port','8551','--chain-id','1952','--silent'],{stdio:'ignore'});t.after(()=>node.kill('SIGTERM'));
  async function rpc(method:string,params:unknown[]=[]){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const j=await r.json() as any;if(j.error)throw Error(j.error.message);return j.result}
  for(let i=0;i<50;i++){try{if(await rpc('eth_chainId')==='0x7a0')break}catch{}await new Promise(r=>setTimeout(r,100))}
  const [owner,r1,r2,buyer]=await rpc('eth_accounts');
  const browser=await chromium.launch({headless:true,channel:process.env.BUIDL_BROWSER==='chrome'?'chrome':undefined});t.after(()=>browser.close());
  const project=join(root,'buidl.json'),cli=resolve(process.env.BUIDL_CLI_BINARY??'build-cli/buidl.mjs'),profile=join(root,'profile');
  const actions:{command:string[];exitCode:number|null;walletRequests:number}[]=[];
  async function command(args:string[],signer=owner,expected=0,mode='normal'){
    const context=await browser.newContext();
    await context.exposeBinding('__buidlTestRpc',(_source,method,params)=>rpc(method,params));
    await context.addInitScript({content:`window.ethereum={request:async function(input){if(input.method==='eth_requestAccounts'||input.method==='eth_accounts')return [${JSON.stringify(signer)}];if(input.method==='eth_chainId'&&${JSON.stringify(mode)}==='wrong-wallet-chain')return '0xc4';if(input.method==='eth_sendTransaction'&&${JSON.stringify(mode)}==='reject')throw Object.assign(new Error('User rejected'),{code:4001});return window.__buidlTestRpc(input.method,input.params||[]);}};`});
    const child=spawn(process.execPath,[cli,...args,'--project',project,'--json','--no-open'],{env:{...process.env,BUIDL_HOME:profile},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',pending=Promise.resolve(),failure:unknown;const seen=new Set<string>();
    child.stdout.on('data',b=>{stdout+=b});
    child.stderr.on('data',b=>{stderr+=b;for(const m of stderr.matchAll(/http:\/\/127\.0\.0\.1:\d+\/#([a-f0-9]{64})/g)){
      if(seen.has(m[0]))continue;seen.add(m[0]);const url=m[0];pending=pending.then(async()=>{
        const page=await context.newPage();await page.goto(url);await page.locator('#summary').filter({hasText:'Account:'}).waitFor();
        await page.locator('#wallet option').first().waitFor({state:'attached'});await page.locator('#review').click();
        if(mode==='wrong-wallet-chain'){await page.locator('#status').filter({hasText:'Mainnet is rejected'}).waitFor();child.kill('SIGTERM');await page.close();return}
        const expectedText=mode==='reject'?'Rejected in wallet.':'Verified. Return to the terminal.';
        try{await page.locator('#status').filter({hasText:expectedText}).waitFor({timeout:15000});}
        catch{throw Error('Wallet page: '+await page.locator('#status').textContent()+'\n'+stderr)}await page.close();
      }).catch(e=>{failure=e;child.kill('SIGTERM')});
    }});
    const code=await new Promise<number|null>(r=>child.once('close',r));await pending;await context.close();if(failure)throw failure;
    assert.equal(code,expected,stderr);actions.push({command:args,exitCode:code,walletRequests:seen.size});
    return stdout.trim()?JSON.parse(stdout):{error:stderr};
  }
  const connect=(signer=owner)=>command(['wallet','connect','--network','testnet','--account',signer,'--rpc',endpoint],signer);
  assert.equal((await command(['wallet','show'])).connected,false);
  await command(['doctor'],owner,2);
  await command(['wallet','connect','--network','testnet','--rpc',endpoint],owner,1,'wrong-wallet-chain');
  assert.equal((await command(['wallet','show'])).connected,false);
  await connect();
  await command(['doctor']);
  assert.equal((await command(['wallet','show'])).address,owner.toLowerCase());
  await command(['app','init','checkout','--network','testnet','--reviewers',`${r1},${r2}`]);
  assert.equal((await command(['app','show'])).name,'checkout');
  await command(['app','deploy']);
  assert.equal(await rpc('eth_getTransactionCount',[owner,'latest']),'0x0');
  await command(['app','deploy','--execute'],owner,1,'reject');
  assert.equal(await rpc('eth_getTransactionCount',[owner,'latest']),'0x0');
  await command(['app','deploy','--execute']);
  await command(['app','enroll','--execute']);
  await command(['app','register','--execute']);
  assert.equal((await command(['policy','show'])).policy.threshold,'2');
  const ma=join(root,'a.json'),request=join(root,'request.json'),s1=join(root,'r1.json'),s2=join(root,'r2.json');
  await command(['release','create','checkout-a','--build',resolve('demo/release-a'),'--out',ma]);
  assert.equal((await command(['release','inspect',ma])).release,'checkout-a');
  await command(['release','gate',resolve('demo/release-a'),ma],owner,1);
  await command(['release','request',ma,'--out',request]);
  await command(['release','sign',request,'--out',s1],owner,1);
  await connect(r1);await command(['release','sign',request,'--out',s1],r1);
  await connect(r2);await command(['release','sign',request,'--out',s2],r2);
  await connect();await command(['release','approve',s1,s2]);
  await command(['release','approve',s1,s2,'--execute']);
  await command(['release','gate',resolve('demo/release-a'),ma]);
  await command(['release','gate',resolve('demo/release-b'),ma],owner,1);
  await command(['release','publish',resolve('demo/release-a'),ma,'--execute']);
  assert.equal((await command(['release','verify','--manifest',ma])).outcome,'Matches approved release.');
  assert.ok((await command(['wallet','history'])).transactions.some((e:any)=>e.status==='cancelled'));
  await command(['release','revoke','--execute']);
  assert.equal((await command(['release','verify'],owner,2)).outcome,'Approval revoked or expired.');
  await command(['app','recover','--execute']);
  await command(['app','transfer','--to',buyer,'--execute']);
  await connect(buyer);await command(['app','enroll','--execute'],buyer);
  assert.equal((await command(['release','status'])).approvalAuthorityCurrent,false);
  await command(['release','verify'],buyer,2);
  await command(['policy','set','--reviewers',`${owner},${r2}`,'--threshold','2','--execute'],buyer);
  assert.equal((await command(['policy','show'])).policy.holder.toLowerCase(),buyer.toLowerCase());
  await command(['release','approve',s1,s2,'--execute'],buyer,1);
  await command(['app','recover','--execute'],buyer);
  const ledger=JSON.parse(await readFile(join(root,'.buidl','transactions.json'),'utf8'));
  assert.ok(ledger.filter((e:any)=>e.status==='success').length>12);
  await command(['wallet','disconnect']);assert.equal((await command(['wallet','show'])).connected,false);
  await command(['app','enroll','--execute'],buyer,1);
  await rpc('anvil_setChainId',[196]);
  await command(['wallet','connect','--network','testnet','--rpc',endpoint],owner,1);
  await command(['release','publish',resolve('demo/release-a'),ma,'--execute'],owner,1);
  assert.ok(actions.filter(a=>a.command[0]==='wallet'&&a.command[1]==='connect'&&a.exitCode===0).length>=4);
  if(process.env.BUIDL_CLI_EVIDENCE)await writeFile(process.env.BUIDL_CLI_EVIDENCE,JSON.stringify({kind:'individual-cli-command-integration',network:'Disposable local Anvil, chain 1952',actualUserWallets:false,actions,confirmedTransactions:ledger.filter((e:any)=>e.status==='success').length,passed:true},null,2)+'\n');
});

test('distributed CLI exposes operational commands and has no demo command',()=>{
  const cli=resolve(process.env.BUIDL_CLI_BINARY??'build-cli/buidl.mjs');
  const help=spawnSync(process.execPath,[cli,'--help'],{encoding:'utf8'});
  assert.equal(help.status,0);assert.match(help.stdout,/wallet connect --network testnet/);assert.match(help.stdout,/release sign REQUEST/);assert.doesNotMatch(help.stdout,/demo/);
  const removed=spawnSync(process.execPath,[cli,'demo'],{encoding:'utf8'});assert.equal(removed.status,1);assert.match(removed.stderr,/Unknown command: demo/);
  const diagnostics=spawnSync(process.execPath,[cli,'diagnostics','--json'],{encoding:'utf8'});assert.equal(diagnostics.status,0);assert.equal(JSON.parse(diagnostics.stdout).version,'0.5.0');
});
