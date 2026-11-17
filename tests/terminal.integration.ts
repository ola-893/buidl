import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { chromium } from '@playwright/test';

test('bundled CLI browser signer completes release lifecycle and rejects mainnet', {timeout:120_000}, async t=>{
  const root=await mkdtemp(join(tmpdir(),'buidl-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const endpoint='http://127.0.0.1:8551';
  const node=spawn('anvil',['--host','127.0.0.1','--port','8551','--chain-id','1952','--silent'],{stdio:'ignore'});t.after(()=>node.kill('SIGTERM'));
  async function rpc(method:string,params:unknown[]=[]){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const j=await r.json() as any;if(j.error)throw Error(j.error.message);return j.result}
  for(let i=0;i<50;i++){try{if(await rpc('eth_chainId')==='0x7a0')break}catch{}await new Promise(r=>setTimeout(r,100))}
  const [owner,r1,r2,buyer]=await rpc('eth_accounts');
  const browser=await chromium.launch({headless:true,channel:process.env.BUIDL_BROWSER==='chrome'?'chrome':undefined});t.after(()=>browser.close());
  const project=join(root,'buidl.json'),cli=resolve('build-cli/buidl.mjs');
  async function command(args:string[], signer=owner, expected=0){
    const context=await browser.newContext();
    await context.exposeBinding('__buidlTestRpc',(_source,method,params)=>rpc(method,params));
    await context.addInitScript({content:`window.ethereum={request:async function(input){if(input.method==='eth_requestAccounts'||input.method==='eth_accounts')return [${JSON.stringify(signer)}];return window.__buidlTestRpc(input.method,input.params||[]);}};`});
    const child=spawn(process.execPath,[cli,'testnet',...args,'--project',project,'--json','--no-open'],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',pending=Promise.resolve(),failure:unknown;const seen=new Set<string>();
    child.stdout.on('data',b=>{stdout+=b});
    child.stderr.on('data',b=>{stderr+=b;for(const m of stderr.matchAll(/http:\/\/127\.0\.0\.1:\d+\/#([a-f0-9]{64})/g)){
      if(seen.has(m[0]))continue;seen.add(m[0]);const url=m[0];pending=pending.then(async()=>{const page=await context.newPage();await page.goto(url);await page.locator('#summary').filter({hasText:'Account:'}).waitFor();await page.locator('#wallet option').first().waitFor({state:'attached'});await page.locator('#review').click();try{await page.locator('#status').filter({hasText:'Verified. Return to the terminal.'}).waitFor({timeout:15000});}catch(e){throw Error('Wallet page: '+await page.locator('#status').textContent()+'\n'+stderr)}await page.close()}).catch(e=>{failure=e;child.kill('SIGTERM')});
    }});
    const code=await new Promise<number|null>(r=>child.once('close',r));await pending;await context.close();if(failure)throw failure;assert.equal(code,expected,stderr);return stdout.trim()?JSON.parse(stdout):{error:stderr};
  }
  await command(['init','--owner',owner,'--reviewers',`${r1},${r2}`,'--rpc',endpoint]);
  await command(['deploy','--broadcast','--wallet']);
  await command(['enroll','--broadcast','--wallet']);
  await command(['policy','--broadcast','--wallet']);
  const ma=join(root,'a.json'),mb=join(root,'b.json'),request=join(root,'request.json'),s1=join(root,'r1.json'),s2=join(root,'r2.json');
  await command(['manifest',resolve('demo/release-a'),'--release','a','--out',ma]);
  await command(['manifest',resolve('demo/release-b'),'--release','b','--out',mb]);
  await command(['gate',resolve('demo/release-a'),ma],owner,1);
  await command(['request',ma,'--out',request]);
  await command(['sign',request,'--reviewer',r1,'--out',s1,'--wallet'],r1);
  await command(['sign',request,'--reviewer',r2,'--out',s2,'--wallet'],r2);
  await command(['approve',s1,s2,'--broadcast','--wallet']);
  await command(['publish',resolve('demo/release-a'),ma,'--broadcast','--wallet']);
  assert.equal((await command(['verify','--manifest',ma])).outcome,'Matches approved release.');
  await command(['interrupt','--broadcast','--wallet']);
  await command(['verify'],owner,2);
  await command(['publish',resolve('demo/release-a'),ma,'--broadcast','--wallet']);
  await command(['mutate',resolve('demo/release-b'),mb,'--broadcast','--wallet']);
  assert.equal((await command(['verify'],owner,2)).outcome,'Deployment differs from approved release.');
  await command(['revoke','--broadcast','--wallet']);
  await command(['verify'],owner,2);
  await command(['recover','--broadcast','--wallet']);
  await command(['transfer','--to',buyer,'--broadcast','--wallet']);
  await command(['enroll','--from',buyer,'--broadcast','--wallet'],buyer);
  assert.equal((await command(['status'])).recordedSigners.length,2); // Historical signatures stay visible; authority is no longer current.
  await command(['verify'],buyer,2);
  await command(['recover','--from',buyer,'--broadcast','--wallet'],buyer);
  const ledger=JSON.parse(await readFile(join(root,'.buidl','transactions.json'),'utf8'));
  assert.ok(ledger.length>15&&ledger.every((e:any)=>e.status==='success'&&e.receipt));
  await rpc('anvil_setChainId',[196]);
  await command(['publish',resolve('demo/release-a'),ma,'--broadcast','--wallet'],owner,1);
});
