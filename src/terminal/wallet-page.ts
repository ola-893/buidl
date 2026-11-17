export const walletPage = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>buidl · Wallet</title>
<style>
body{background:#10121b;color:#eef0fa;font:16px system-ui;margin:5vh auto;max-width:760px;padding:24px}
h1{font-size:36px}small{color:#bbb}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#1c2030;padding:20px;border-radius:10px}
button,select{font:inherit;padding:12px 18px;margin:8px 8px 8px 0;border-radius:8px}
button{background:#b4f458;border:0;cursor:pointer}button:disabled{opacity:.5;cursor:default}#network{background:#282d41;color:#eef0fa}
#status{color:#dcf6b8}details{margin:20px 0}
</style></head><body>
<small>buidl CLI · X Layer TESTNET 1952</small>
<h1 id="label">Wallet</h1><p id="explanation">Review the request, then confirm in your wallet.</p>
<pre id="summary"></pre><select id="wallet" aria-label="Wallet"></select>
<button id="review" disabled>Review in wallet</button><button id="network">Switch to X Layer testnet</button>
<p id="status" role="status"></p><details><summary>Exact request</summary><pre id="detail"></pre></details>
<script>
const token=location.hash.slice(1),providers=[],select=document.querySelector('#wallet'),button=document.querySelector('#review'),status=document.querySelector('#status');
let request,started=false;
function add(provider,name){
  if(providers.some(p=>p.provider===provider))return;
  providers.push({provider,name});const o=document.createElement('option');o.value=providers.length-1;o.textContent=name;select.append(o);
  if(name===localStorage.getItem('buidl.cli.wallet'))select.value=o.value;
}
addEventListener('eip6963:announceProvider',e=>add(e.detail.provider,e.detail.info.name));
dispatchEvent(new Event('eip6963:requestProvider'));
setTimeout(()=>{if(!providers.length&&window.ethereum)add(window.ethereum,'Browser wallet')},300);
async function api(path,body){
  const r=await fetch(path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const j=await r.json();if(!r.ok)throw Error(j.error);return j;
}
const fee=wei=>{const n=BigInt(wei);return (n/1000000000000000000n)+'.'+(n%1000000000000000000n).toString().padStart(18,'0')};
api('/request').then(r=>{
  request=r;button.disabled=false;document.querySelector('#label').textContent=r.label;
  document.querySelector('#detail').textContent=JSON.stringify(r,null,2);
  const lines=['Network: X Layer TESTNET (1952)','Account: '+(r.account||'Choose the account in your wallet')];
  if(r.kind==='connect'){
    lines.push('Gas fee: none','Sign a connection message. Each later approval or transaction has its own wallet confirmation.');
    document.querySelector('#explanation').textContent='Choose your wallet, connect the account, then sign the connection message.';
    button.textContent='Connect wallet';
  }else if(r.kind==='signature')lines.push('Gas fee: none','Manifest: '+r.typedData.message.manifestDigest);
  else lines.push('Destination: '+(r.plan.to||'New fixture contract'),'Nonce: '+r.plan.nonce,'Value: 0 test OKB','Maximum gas at quote: '+fee(r.plan.estimatedWei)+' test OKB');
  document.querySelector('#summary').textContent=lines.join('\\n');
  if(r.complete){button.disabled=true;status.textContent='Already verified. Return to the terminal.'}
}).catch(e=>status.textContent=e.message);
document.querySelector('#network').onclick=async()=>{
  try{
    const p=providers[Number(select.value)]?.provider;if(!p)throw Error('Choose an installed wallet.');
    try{await p.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x7a0'}]})}
    catch(e){if(e.code!==4902)throw e;await p.request({method:'wallet_addEthereumChain',params:[{chainId:'0x7a0',chainName:'X Layer testnet',nativeCurrency:{name:'Test OKB',symbol:'OKB',decimals:18},rpcUrls:[request?.rpcUrl||'https://testrpc.xlayer.tech/terigon'],blockExplorerUrls:['https://www.okx.com/web3/explorer/xlayer-test']}]});await p.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x7a0'}]})}
    status.textContent='X Layer testnet selected. Continue with the wallet request.';
  }catch(e){status.textContent=e.message}
};
button.onclick=async()=>{
  if(started||!request)return;button.disabled=true;
  try{
    const selected=providers[Number(select.value)],p=selected?.provider;if(!p)throw Error('Choose an installed wallet.');
    localStorage.setItem('buidl.cli.wallet',selected.name);
    const accounts=await p.request({method:'eth_requestAccounts'}),account=accounts[0];
    if(!account)throw Error('The wallet did not provide an account.');
    if(BigInt(await p.request({method:'eth_chainId'}))!==1952n)throw Error('Select X Layer testnet (1952) using the network button, then retry. Mainnet is rejected.');
    if(request.account&&account.toLowerCase()!==request.account.toLowerCase())throw Error('Select the requested wallet account.');
    started=true;status.textContent='Review the open wallet request.';let value;
    if(request.kind==='connect'){
      const message='0x'+Array.from(new TextEncoder().encode(request.message),b=>b.toString(16).padStart(2,'0')).join('');
      const signature=await p.request({method:'personal_sign',params:[message,account]});
      value=JSON.stringify({address:account,signature,wallet:selected.name});
    }else if(request.kind==='signature')value=await p.request({method:'eth_signTypedData_v4',params:[request.account,JSON.stringify(request.typedData)]});
    else{
      const nonce=await p.request({method:'eth_getTransactionCount',params:[request.account,'pending']});
      if(BigInt(nonce)!==BigInt(request.plan.nonce))throw Error('Nonce changed. Return to the terminal for a fresh plan.');
      value=await p.request({method:'eth_sendTransaction',params:[request.transaction]});
    }
    status.textContent=request.kind==='transaction'?'Submitted '+value+'. Verifying in the terminal…':'Verifying signature…';
    await api('/result',{value});status.textContent='Verified. Return to the terminal.';
  }catch(e){
    status.textContent=e.message;
    if(e.code===4001&&started){await api('/reject',{}).catch(()=>{});status.textContent='Rejected in wallet. No transaction was submitted. Return to the terminal.'}
    else if(!started)button.disabled=false;
    else status.textContent+=' Check wallet activity before restarting the command.';
  }
};
</script></body></html>`;
