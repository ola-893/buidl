# Hackathon demo · 2 minutes 40 seconds

Prepare before recording. Run `npm ci`, `npm run dev`, and Anvil on `127.0.0.1:8545` with chain ID 31337. Run `npm run demo -- init`. Open buidl in one tab and let the live inspection complete. Use the separate disposable Anvil accounts for wallet signing. The sample displays a simulated checkout. To show it in a separate browser origin, serve `demo/release-a` with `python3 -m http.server --bind 127.0.0.1 --directory demo/release-a 8080` and open `http://127.0.0.1:8080`.

| Time | Show and say |
|---|---|
| 0:00–0:30 | Show `1.2.230.tape` on **X Layer mainnet**, its resolved container, block hash and verified `index.html`. “TapeOut tells us which bytes are on chain. A payment team also needs to know whether reviewers approved those bytes.” |
| 0:30–1:05 | Switch to **Local demo** and load manifest A in **Releases**. Show the manifest digest and the two independent signatures on the 2-of-3 policy. Use the browser to sign or run the scripted approvals below. Publish A through the CLI gate and show “Matches approved release.” |
| 1:05–1:45 | Show that the gate rejects B under approval A. Run the direct publisher bypass. Refresh **Inspection**. Both file hashes verify, but “Deployment differs from approved release.” Open the `payment.json` diff and show destination `0x1111…1111` changing to `0x2222…2222`. |
| 1:45–2:15 | Approve B under the same independent policy. Load manifest B and refresh. Show “Matches approved release” and both registry commitments in **Evidence**. |
| 2:15–2:40 | “Payment and dapp teams can use the CI gate and share release evidence. We would charge for CI and team workflow features. Direct publishing permissions can bypass the gate, and fresh verification detects the change. A viewer can enforce it after integrating buidl. No security audit attached.” |

Commands for the staged demonstration after `init`:

```sh
npm run demo -- approve a
npm run buidl -- publish-local demo/release-a public/local-demo/manifest-a.json public/local-demo/config.json
npm run buidl -- gate demo/release-b public/local-demo/manifest-a.json public/local-demo/config.json
npm run demo -- bypass-b
npm run demo -- approve b
```

The third command is expected to fail. In the browser, refresh after each deployment or approval change. To rehearse the complete sequence in a single terminal command, run `npm run demo`. The A/B mutations are transactions against the controlled local fixture. The mainnet segment is a live read of an existing third-party site.
