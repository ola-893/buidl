# Recording with the CLI

Use the actual operational commands below, one at a time. There is no bundled demo command. Prepare your funded testnet holder and two reviewer wallets, a small build directory and a clean recording terminal.

This sequence uses X Layer testnet (1952) and explicitly labeled buidl hosting fixtures. It does not deploy actual TapeOut testnet contracts. The software's adversarial integration tests run separately from the presentation.

## Holder: connect and register

```sh
npm install -g @ola-893/buidl@0.5.0
buidl --version
buidl wallet connect --network testnet
buidl wallet show
buidl app init checkout --network testnet --reviewers 0xREVIEWER1,0xREVIEWER2
buidl app deploy
buidl app deploy --execute
buidl app enroll --execute
buidl app register --execute
buidl policy show
```

Replace the address placeholders. Wallet connection signs a message without a gas fee. Deploying, enrolling and registering open separate transaction confirmations with estimates. For an existing app, initialize with its `--fixtures` configuration and inspect `app status` instead of deploying again.

## Developer: prepare the release

```sh
buidl release create checkout-v1 --build ./dist --out ./manifest.json
buidl release inspect ./manifest.json
buidl release request ./manifest.json --out ./approval-request.json
```

Explain that the manifest commits to exact files, lengths, content types and routing. The request also binds the reviewers' signatures to this registry, chain, policy, sequence and expiry.

## Reviewer one

```sh
buidl wallet connect --network testnet --account 0xREVIEWER1
buidl release sign ./approval-request.json --out ./reviewer1.json
```

## Reviewer two

```sh
buidl wallet connect --network testnet --account 0xREVIEWER2
buidl release sign ./approval-request.json --out ./reviewer2.json
```

Switch the account in your extension when asked. The CLI verifies each recovered reviewer independently. In a team, reviewers can perform these commands separately and return their signed request files.

## Holder: approve, publish and verify

```sh
buidl wallet connect --network testnet --account 0xHOLDER
buidl release approve ./reviewer1.json ./reviewer2.json
buidl release approve ./reviewer1.json ./reviewer2.json --execute
buidl release gate ./dist ./manifest.json
buidl release publish ./dist ./manifest.json --execute
buidl release verify --manifest ./manifest.json --out ./verification.json
buidl wallet history
```

Show the preview, real wallet confirmations, public receipts and checked verification block. You decide when to run each command. Keep the manifest and request exports outside the build directory.

For a changed-build gate check, edit a file in a copy of the build and run `release gate` against the approved manifest. It must fail before requesting a transaction. Changing the deployed files is a separate controlled test; a failed local gate alone does not demonstrate detection of an onchain content change.

## Optional lifecycle operations

```sh
buidl release revoke --execute
buidl release verify --manifest ./manifest.json
buidl app recover --execute
buidl wallet disconnect
```

Revocation changes the live verification result. Recovery returns custody to the depositor and invalidates the prior authority. Capture these after recording a successful approved match. Use `wallet reconcile --hash HASH` if a submitted transaction's browser response is interrupted.

The earlier [public fixture pilot](testnet/results/cli-approved-release.json) records holder/reviewer signing and a successful approved match. Its historical receipt evidence remains separate from a new run. For full operation and setup details, see [the CLI guide](cli.md).
