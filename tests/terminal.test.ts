import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyConnectionProof } from '../src/terminal/connection';
import { createPublicClient, http } from 'viem';
import { startWalletSession, verifyTransaction } from '../src/terminal/wallet';
import { parseProject } from '../src/terminal/project';
import { WalletSender } from '../src/terminal/sender';
import { testnet, type PlannedTx } from '../src/core/testnet';
const a='0x1111111111111111111111111111111111111111', b='0x2222222222222222222222222222222222222222', c='0x3333333333333333333333333333333333333333';
test('testnet projects reject mainnet and invalid signer policies',()=>{
  const p={version:1,network:'xlayer-testnet-fixtures',chainId:1952,rpcUrl:'http://127.0.0.1:8552',owner:a,reviewers:[b,c],threshold:2};
  assert.equal(parseProject(p).chainId,1952);
  assert.throws(()=>parseProject({...p,chainId:196}),/Mainnet/);
  for(const reviewers of [[a,b],[b,b]])assert.throws(()=>parseProject({...p,reviewers}),/reviewer policy/);
  assert.throws(()=>parseProject({...p,rpcUrl:'http://untrusted.example'}),/HTTPS/);
});
test('wallet callbacks require the capability and reject cross-origin or changed results',async()=>{
  let verified=0;
  const s=await startWalletSession({kind:'test'},async value=>{if(value!=='expected')throw Error('Changed result');verified++});
  const url=new URL(s.url), origin=url.origin, token=url.hash.slice(1), headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
  try{
    assert.equal((await fetch(origin+'/request')).status,403);
    assert.equal((await fetch(origin+'/request',{headers:{...headers,origin:'https://attacker.example'}})).status,403);
    assert.equal((await fetch(origin+'/result',{method:'POST',headers,body:JSON.stringify({value:'changed'})})).status,400);
    assert.equal(verified,0);
    assert.equal((await fetch(origin+'/result',{method:'POST',headers,body:JSON.stringify({value:'expected'})})).status,200);
    assert.equal(await s.done,'expected');assert.equal(verified,1);
    assert.equal((await fetch(origin+'/result',{method:'POST',headers,body:JSON.stringify({value:'expected'})})).status,409);
  }finally{await s.close()}
});
test('receipt verification rejects modified transactions and unsigned chain identity',()=>{
  const plan:PlannedTx={label:'test',from:a,to:b,data:'0x1234',nonce:2,gas:'50000',gasPrice:'100',estimatedWei:'5000000'};
  const tx={chainId:1952,from:a,to:b,input:'0x1234',nonce:2,value:0n,gas:50000n,gasPrice:100n};
  verifyTransaction(tx,plan);
  for(const change of [{chainId:196},{chainId:undefined},{from:c},{to:c},{input:'0x1235'},{nonce:3},{value:1n},{gas:50001n},{gasPrice:101n}])assert.throws(()=>verifyTransaction({...tx,...change},plan),/differs/);
});
test('uncertain wallet requests block subsequent writes across CLI invocations',async()=>{
  const root=await mkdtemp(join(tmpdir(),'buidl-journal-'));
  const client=createPublicClient({chain:testnet,transport:http('http://127.0.0.1:1')});
  try{
    const s=new WalletSender(client,a,join(root,'buidl.json'),false);
    await s.save([{plan:{label:'pending',from:a,to:b,data:'0x',nonce:1,gas:'1',gasPrice:'1',estimatedWei:'1'},status:'wallet-requested'}]);
    let invoked=false;await assert.rejects(s.locked(async()=>{invoked=true}),/uncertain outcome/);assert.equal(invoked,false);
  }finally{await rm(root,{recursive:true,force:true})}
});

test('wallet connection proof binds the selected address and unique challenge',async()=>{
  const account=privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
  const message='Connect buidl CLI; testnet 1952; nonce unique-test-value';
  const proof={address:account.address,signature:await account.signMessage({message}),wallet:'Test wallet'};
  const verified=await verifyConnectionProof(proof,message,Date.now()+10000,account.address);
  assert.equal(verified.address,account.address.toLowerCase());
  await assert.rejects(verifyConnectionProof(proof,message+'changed',Date.now()+10000),/signature/);
  await assert.rejects(verifyConnectionProof(proof,message,Date.now()-1),/expired/);
  await assert.rejects(verifyConnectionProof(proof,message,Date.now()+10000,b),/requested account/);
});
test('explicit wallet rejection closes a session without accepting a result',async()=>{
  const s=await startWalletSession({kind:'transaction'},async()=>{throw Error('Must not verify a transaction')});
  const url=new URL(s.url),headers={authorization:'Bearer '+url.hash.slice(1),'content-type':'application/json'};
  try{
    assert.equal((await fetch(url.origin+'/reject',{method:'POST',headers,body:'{}'})).status,200);
    await assert.rejects(s.done,/rejected in wallet/);
    assert.equal((await fetch(url.origin+'/result',{method:'POST',headers,body:JSON.stringify({value:'anything'})})).status,409);
  }finally{await s.close()}
});
