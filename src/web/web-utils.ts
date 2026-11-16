export const short = (value: string, width = 8) => value.length > 2 * width + 2 ? value.slice(0, width) + '…' + value.slice(-width + 2) : value;
export const formatBytes = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
export const numeric = new Intl.NumberFormat('en');
export const localDemoAvailable = import.meta.env.DEV && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
export const errorText = (error: unknown) => (error as { shortMessage?: string; message?: string })?.shortMessage || (error as Error)?.message || 'Operation failed.';

export function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, (_, entry) => typeof entry === 'bigint' ? entry.toString() : entry, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error('Local demo files are unavailable. Run npm run demo -- init.');
  return response.json();
}
