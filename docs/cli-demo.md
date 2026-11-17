# buidl CLI

The CLI is buidl's primary distribution and demo surface. It generates release manifests, collects separate reviewer approvals, gates publishing and checks deployed bytes. The dashboard and public verification links remain useful companions.

The workflow takes inspiration from [Remora's CLI](https://github.com/ola-893/Remora/tree/codex/near-hackathon/packages/cli): terminal commands own the lifecycle, browser wallets approve signatures, and portable evidence makes the run independently inspectable. This implementation uses buidl's existing release registry and publisher; it does not include Remora code.

## Install from this checkout

Use Node.js 22.13+; install Foundry's `anvil` for the disposable demo.

```sh
npm ci
npm pack
npm install -g ./buidl-0.4.0.tgz
buidl --version
buidl --help
```

Version 0.4.0 is prepared in this branch. The public v0.3.0 download does not contain these commands. No new npm or GitHub release is implied by building this checkout. The packed CLI includes its wallet page, fixture bytecode and demo; it runs outside the repository without Vite, React, source files or a running dashboard.

## One-command demo

```sh
buidl demo --out ./demo-evidence
```

This starts its own disposable local Anvil, uses its test accounts, prints twelve `PASS` checks, saves public-style receipts and snapshots, and stops Anvil. It covers registration, separate reviewer signatures, threshold rejection, approved publishing, changed-file detection despite valid hashes, interrupted uploads and resumption, revocation, ownership invalidation and circuit recovery. It uses simulated contracts and local accounts; it sends no public testnet or mainnet transactions.

For a short recording, explain the question: “Does the deployed app still match what the team approved?” Run the command, point out the valid-hash mismatch and the failed ownership reuse, then open `demo-evidence/results.json`. The evidence labels the local network explicitly. Actual public testnet receipts belong in a separate segment.

## Actual X Layer testnet

Only chain **1952** is accepted. The reviewed TapeOut mainnet contract addresses have no testnet code, so these commands explicitly use buidl's fixtures. They do not demonstrate an actual TapeOut testnet deployment. See [discovery and custody details](testnet-pilot.md).

```sh
buidl testnet init --owner 0xHOLDER --reviewers 0xREVIEWER1,0xREVIEWER2
buidl testnet doctor
buidl testnet deploy
buidl testnet deploy --broadcast --wallet
buidl testnet enroll --broadcast --wallet
buidl testnet policy --broadcast --wallet
```

Replace the address placeholders. `doctor` verifies the RPC chain, balance, nonce and configured contract runtime. A fresh project writes `buidl.json`. To use already deployed fixtures, add `--fixtures fixture-config.json` to `init`. To use the guarded loopback RPC relay, add `--rpc http://127.0.0.1:8552`; it forwards to the actual public testnet, while the disposable demo uses its own isolated node.

All writes default to previews. `--broadcast --wallet` opens a small, temporary wallet review page on `127.0.0.1:5362`. Reusing this local origin avoids reconnecting the extension for every transaction. Only one CLI wallet request can run at a time. The terminal prints each estimated test OKB gas maximum before signing. The page displays the account, chain, destination, nonce and exact payload; choose your wallet and click **Review in wallet**, then confirm in the extension. The CLI verifies the returned signature or transaction against its original request. It never accepts a private key. The estimate is gas limit × quoted gas price; the wallet presents the final network fee.

```sh
buidl testnet manifest ./build --release checkout-a --out ./manifest.json
buidl testnet request ./manifest.json --out ./request.json
buidl testnet sign ./request.json --reviewer 0xREVIEWER1 --out ./reviewer1.json --wallet
buidl testnet sign ./request.json --reviewer 0xREVIEWER2 --out ./reviewer2.json --wallet
buidl testnet approve ./reviewer1.json ./reviewer2.json
buidl testnet approve ./reviewer1.json ./reviewer2.json --broadcast --wallet
buidl testnet gate ./build ./manifest.json
buidl testnet publish ./build ./manifest.json --broadcast --wallet
buidl testnet verify --manifest ./manifest.json --out ./verification.json
```

Switch to the named reviewer for each signature and back to the holder for publishing. Separate signed files merge only when they describe exactly the same request. The holder cannot count as a reviewer. Previously approved artifacts require a new `request --rollback` and fresh reviewer signatures.

The manifest must stay outside the build directory. The publisher stages all bytes, rechecks their hashes, verifies the onchain files before finishing, and reconstructs the final release at a checked block. A successful `verify` exits 0. A completed check without an approved match exits 2; input, network and gate failures exit 1. `--json` produces structured output; piped stdout uses JSON automatically.

## Resume and lifecycle controls

```sh
buidl testnet interrupt --broadcast --wallet
buidl testnet verify
buidl testnet publish ./build ./manifest.json --broadcast --wallet
buidl testnet revoke --broadcast --wallet
buidl testnet recover --broadcast --wallet
buidl testnet transfer --to 0xNEWOWNER --broadcast --wallet
buidl testnet enroll --from 0xNEWOWNER --broadcast --wallet
buidl testnet verify
buidl testnet recover --from 0xNEWOWNER --broadcast --wallet
```

A new owner needs test OKB for transactions. Set a new reviewer policy excluding that owner before requesting new approvals. Re-enrollment advances authority history; old signatures cannot be reused.

`publish` resumes a matching in-progress attempt and skips files only when fresh onchain byte verification matches their exact manifest hash, size and type. Incomplete or changed files are rewritten deterministically. It does not mark an interrupted release as verified. After an interrupted deployment, repeat `deploy`; the saved deployment plan permits resuming the missing authority without redeploying the fixture. If the nonce changed before the first deployment, inspect the saved plan before replacing it.

The CLI saves transaction plans, hashes, complete receipts, blocks and paid gas costs in `.buidl/transactions.json` next to the project. If signing or broadcasting has an uncertain outcome, further writes stop. Check wallet activity and reconcile the exact hash:

```sh
buidl testnet reconcile --hash 0xTRANSACTIONHASH
```

After a hard process kill, inspect that journal and the wallet before removing `.buidl/transaction.lock`. No automatic resubmission happens. If a request was rejected before receiving any hash, retain the journal and confirm cancellation in the wallet before using a new project; no onchain receipt can prove a still-open wallet request was cancelled.

For a controlled mismatch demonstration, generate a second manifest from a build with a different `payment.json`, then run `buidl testnet mutate <changed-build> <changed-manifest> --broadcast --wallet`. This fixture-only operation intentionally bypasses the normal artifact gate while keeping a valid file hash. Fresh verification must report divergence. It is distinct from the normal gated publisher.

## CI

Use the project's checked testnet configuration and an explicit RPC if necessary:

```sh
buidl testnet gate ./dist ./release-manifest.json --project ./buidl.json --json
buidl testnet verify --project ./buidl.json --json
```

The gate controls workflows that invoke it. Blocking users from opening an unauthorized release still requires integration with the serving viewer or gateway.

## Recorded public fixture pilot

The actual holder and two reviewer wallets completed approval → CLI publishing → fresh verification on X Layer testnet 1952. [Verification evidence](testnet/results/cli-approved-release.json) records **Matches approved release** at block **46452266**, checked **2026-11-17 10:25:09 UTC**. [Final public receipt](https://www.okx.com/web3/explorer/xlayer-test/tx/0x2aa40ef20a4b93ab2b4cad85bfcb1d3bcddef574cfd8356caa04c0b29c824db9) · [All CLI receipts and estimates](testnet/cli-transactions.json).

From the checkout, perform a new read rather than relying on the saved result:

```sh
npm run buidl -- testnet verify --project docs/testnet/cli-project.json --manifest docs/testnet/manifest-a.json --json
```

On this Mac, append `--rpc http://127.0.0.1:8552` while the guarded public-testnet relay is running if the direct RPC is unavailable. Approval expiry, revocation, ownership and content can change the fresh result. This public pilot uses buidl fixtures. The adverse lifecycle scenarios remain separately labeled local tests.
