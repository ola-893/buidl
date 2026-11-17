# buidl CLI

Install `@ola-893/buidl@0.5.0` from npm and run `buidl --help`. The CLI is an operational tool: you connect the wallets, submit each command and confirm signatures yourself.

## Wallets

```sh
buidl wallet connect --network testnet
buidl wallet show
buidl wallet disconnect
```

Connect opens `http://127.0.0.1:5362` with a temporary request token. Choose an installed EVM browser wallet and the intended account. The network button can switch or add X Layer testnet, chain 1952. Sign the displayed connection message; the CLI recovers the signer and verifies the RPC chain before saving the public profile.

Use `--account 0xADDRESS` to require a specific holder or reviewer. Every later approval signature and transaction verifies the selected account and network again. Connecting never gives the CLI a private key or permission to sign later transactions automatically.

The default profile is `~/.config/buidl/wallet.json`. Set `BUIDL_HOME` to a separate directory for a different operator profile or terminal. `wallet disconnect` removes that profile. It does not revoke extension site permissions or cancel an open extension prompt.

For an RPC connection problem, specify `--rpc https://YOUR_TESTNET_RPC`. On the pilot Mac, the guarded loopback relay can be used with `--rpc http://127.0.0.1:8552`; it forwards to the public X Layer testnet. The local signing page uses the extension's selected network RPC.

## Apps and policies

```sh
buidl app init NAME --network testnet --reviewers ADDRESS1,ADDRESS2 --threshold 2
buidl app show
buidl app deploy
buidl app deploy --execute
buidl app enroll --execute
buidl app register --execute
buidl policy show
buidl policy set --reviewers ADDRESS1,ADDRESS2 --threshold 2 --execute
```

The project lives in `buidl.json`, or the file given with `--project PATH`. Initialization defaults its holder to the connected wallet. `--owner ADDRESS` permits preparing a project before connecting. Reviewers must be distinct and cannot include the holder.

Testnet deployments use buidl's simulated circuit, file store and custody authority. They are not actual TapeOut testnet deployments. [Discovery and custody details](testnet-pilot.md) document the boundary. Enrollment transfers the circuit fixture into the authority; only its depositor can recover it while enrolled.

`app init --fixtures FILE` adopts a known fixture configuration. The CLI checks deployed runtime fingerprints, the authority binding and registry provenance before operating on it. Partial deployment plans persist so repeating `app deploy --execute` can resume the missing contract after reconciliation.

## Releases

```sh
buidl release create NAME --build DIRECTORY --out MANIFEST --fallback index.html
buidl release inspect MANIFEST
buidl release request MANIFEST --out REQUEST
buidl release sign REQUEST --out SIGNED
buidl release approve SIGNED1 SIGNED2
buidl release approve SIGNED1 SIGNED2 --execute
buidl release gate BUILD MANIFEST
buidl release publish BUILD MANIFEST --execute
buidl release verify --manifest MANIFEST --out REPORT
```

Manifest creation reads your files and works offline once the project's site identity is configured. The manifest must be outside the build directory. The fixture publisher accepts files up to 60 KB, uploaded in 12 KB chunks.

`release sign` uses the connected reviewer wallet. Its EIP-712 signature binds the chain, site, registry, policy version, sequence, expiry, manifest and artifact set. Unauthorized, duplicate or expired signatures fail validation. Signed request files merge only if they describe the same exact approval.

`release approve` previews recording after verifying the threshold. With `--execute`, the active wallet submits it to the registry. `release publish` requires the connected circuit governor, rechecks exact build bytes and approval, requests each transaction separately, verifies deployed files and routing, then closes the publication. The final verification includes the checked block and time.

Previously approved artifacts require `release request MANIFEST --out NEW_REQUEST --rollback` and fresh reviewer signatures. A request or signature from before an ownership exit, policy change or re-enrollment cannot be reused.

## Recovery and history

```sh
buidl wallet history
buidl wallet reconcile --hash HASH
buidl release status
buidl release revoke --execute
buidl app recover --execute
buidl app transfer --to NEW_OWNER --execute
```

The publisher saves `.buidl/transactions.json` next to the project, including estimates, nonces, hashes, receipts and paid gas. A normal rejection in the wallet is recorded as cancelled. An interruption with an uncertain outcome stops later writes; `wallet reconcile` validates the exact returned transaction against the original plan and records its receipt. Never submit again solely because a browser callback failed.

After a hard process kill, check wallet activity and the journal before removing a stale `.buidl/transaction.lock`. A wallet confirmation can still broadcast after the CLI exits. If it did, reconcile that hash before continuing. After reconciliation, `release publish` resumes the existing attempt and avoids uploading already verified files again.

Ownership exit and re-enrollment invalidate approval authority. Connect the new owner before enrolling. Update the reviewer policy to exclude the new owner before collecting fresh signatures; a confirmed policy change updates the project's configured owner and policy.

## Diagnostics and CI

```sh
buidl diagnostics
buidl doctor
buidl release gate ./dist ./manifest.json --project ./buidl.json --json
buidl release verify --project ./buidl.json --json
```

Interactive output is concise; `--json` and pipes retain structured values. The exit codes are 0 for success, 2 for completed verification without a match, and 1 for input, RPC or gate failures. Verification and build gates do not require wallet connection.

The operational write workflow accepts testnet 1952 only. `buidl inspect IDENTIFIER` remains a separate read-only TapeOut mainnet inspection command. Viewer or gateway integration is required to block access to unapproved apps.
