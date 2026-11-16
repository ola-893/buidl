import { createWalletClient, custom, getAddress, type Address, type EIP1193Provider } from 'viem';
import { foundry, xLayer } from 'viem/chains';

export type Provider = { name: string; provider: EIP1193Provider };
const injected = window as Window & { ethereum?: EIP1193Provider; okxwallet?: EIP1193Provider };

export function watchWallets(onWallet: (wallet: Provider) => void) {
  function register(event: Event) {
    const { info, provider } = (event as CustomEvent<{ info: { name: string }; provider: EIP1193Provider }>).detail ?? {};
    if (typeof info?.name === 'string' && typeof provider?.request === 'function') onWallet({ name: info.name, provider });
  }
  window.addEventListener('eip6963:announceProvider', register);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  const provider = injected.okxwallet ?? injected.ethereum;
  if (provider) onWallet({ name: injected.okxwallet ? 'OKX Wallet' : 'Browser wallet', provider });
  return () => window.removeEventListener('eip6963:announceProvider', register);
}

export function walletClient(provider: EIP1193Provider, chainId: number, account?: Address) {
  if (!window.isSecureContext || window.top !== window.self) throw new Error('Open buidl directly in a secure, independent browser origin to use a wallet.');
  const chain = chainId === foundry.id ? foundry : xLayer;
  return createWalletClient({ account: account && getAddress(account), chain, transport: custom(provider, { retryCount: 0 }) });
}
