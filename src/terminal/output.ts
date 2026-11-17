import { formatEther } from 'viem';
export const jsonText = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
export function report(title: string, fields: Record<string, unknown>, json = false) {
  if (json || !process.stdout.isTTY) return console.log(jsonText({ title, ...fields }));
  console.log(`\nbuidl · ${title}\n`);
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && value.some(v => v && typeof v === 'object' && 'gasPrice' in v && 'data' in v)) {
      console.log(`  ${name}`);
      for (const p of value) console.log(`    ${p.label}\n      ${p.to ?? p.creates ?? 'New contract'} · nonce ${p.nonce ?? 'pending'}\n      Maximum gas at quote: ${formatEther(BigInt(p.estimatedWei))} test OKB`);
    } else console.log(`  ${name.padEnd(18)} ${typeof value === 'object' ? jsonText(value) : value}`);
  }
  console.log();
}
