# buidl

Does this deployed DeWEB app still match the release its reviewers approved?

buidl is a CLI for release manifests, reviewer signatures, gated publishing and fresh verification. Developers operate it through wallet, app, policy and release commands. The [web dashboard](https://ola-893.github.io/buidl/) and [public verification links](https://ola-893.github.io/buidl/?verify=1.2.230.tape) are companion inspection surfaces.

## Install and connect

Use Node.js 22.13 or newer. Install the CLI from [npm](https://www.npmjs.com/package/@ola-893/buidl):

```sh
npm install -g @ola-893/buidl@0.5.0
buidl --version
buidl --help
buidl wallet connect --network testnet
buidl wallet show
```

`wallet connect` opens a local page where you choose your browser wallet, select X Layer testnet and sign a connection message. It verifies the recovered address and saves the public connection profile. No private key is imported. Every later release signature or transaction has its own wallet confirmation.

The write workflow currently supports **X Layer testnet, chain 1952**, using explicitly labeled buidl hosting fixtures. It rejects mainnet. Live TapeOut mainnet inspection is read-only. The complete native TapeOut workflow was also tested separately on a [mainnet fork](docs/xlayer-release.md); that is a different claim from this public testnet fixture pilot.

## Register an app

Run commands individually. Replace the reviewer placeholders with two addresses that differ from the holder:

```sh
buidl app init checkout --network testnet --reviewers 0xREVIEWER1,0xREVIEWER2
buidl app show
buidl app deploy
buidl app deploy --execute
buidl app enroll --execute
buidl app register --execute
buidl policy show
buidl doctor
```

`app deploy` previews the testnet contract deployments. `--execute` opens wallet confirmations with gas estimates. Enrollment puts the fixture circuit into the authority contract's custody; the depositor can recover it with `buidl app recover --execute`. To use a deployment you already control, pass `--fixtures fixture-config.json` to `app init`.

## Approve and publish a release

Generate the manifest from your own build. Keep the manifest outside the build directory:

```sh
buidl release create checkout-v1 --build ./dist --out ./manifest.json
buidl release inspect ./manifest.json
buidl release request ./manifest.json --out ./approval-request.json
```

Each reviewer connects their own wallet and signs the same request. Reviewers can run these commands on separate machines with copies of the project and request files:

```sh
buidl wallet connect --network testnet --account 0xREVIEWER1
buidl release sign ./approval-request.json --out ./reviewer1.json
```

```sh
buidl wallet connect --network testnet --account 0xREVIEWER2
buidl release sign ./approval-request.json --out ./reviewer2.json
```

The holder reconnects, records the reviewers' approval and publishes the exact build:

```sh
buidl wallet connect --network testnet --account 0xHOLDER
buidl release approve ./reviewer1.json ./reviewer2.json
buidl release approve ./reviewer1.json ./reviewer2.json --execute
buidl release gate ./dist ./manifest.json
buidl release publish ./dist ./manifest.json --execute
buidl release verify --manifest ./manifest.json --out ./verification.json
buidl wallet history
```

These are independent operator commands. Nothing automatically creates accounts, signs approvals, funds wallets or runs the release journey. The [CLI guide](https://github.com/ola-893/buidl/blob/v0.5.0/docs/cli.md) covers configuration and recovery. The [recording guide](https://github.com/ola-893/buidl/blob/v0.5.0/docs/cli-demo.md) gives a manual command sequence for presenting your own app.

## Day-to-day operations

```sh
buidl wallet show
buidl app status
buidl policy show
buidl release status
buidl release revoke --execute
buidl app recover --execute
buidl wallet reconcile --hash 0xTRANSACTIONHASH
buidl wallet disconnect
```

Writes preview their action unless `--execute` is present. `release sign` explicitly requests a reviewer signature without a gas fee. Publishing checks the staged bytes and current approval, verifies onchain files before finishing, and performs a fresh final check. An interrupted upload stays unverified. Re-run `release publish` to resume; files are skipped only when fresh hash, size and type checks match the manifest.

The CLI records transaction estimates, hashes and receipts in `.buidl/transactions.json` next to the project. Uncertain submissions stop later writes until reconciled. Disconnect clears the saved CLI profile; reject any already-open request in the extension separately.

`--json` and piped stdout produce structured output for CI. Successful verification exits 0; a completed check without an approved match exits 2; invalid input, failed gates and unavailable dependencies exit 1.

## Read-only TapeOut inspection

```sh
buidl inspect 1.2.230.tape
```

Inspection reconstructs and hashes deployed files. It does not open the inspected app. Approval proves an artifact match; it does not establish a security audit or source-to-build reproducibility. Enforcing access to approved releases still requires integration with the viewer or gateway serving the app.

## Develop and verify

```sh
npm ci
npm run build
npm test
npm run test:testnet
npm run test:cli
npm run dev
```

The integration tests require Foundry Anvil and Playwright Chromium. Use `BUIDL_BROWSER=chrome npm run test:cli` to use installed Chrome. Test accounts and disposable nodes belong to the test harness, not the distributed CLI. `npm pack` builds an installable package containing the CLI and wallet page.

The [public fixture pilot evidence](https://github.com/ola-893/buidl/blob/v0.5.0/docs/testnet/results/cli-approved-release.json) records a real holder, two reviewer wallets, onchain approval, CLI publishing and a fresh approved match. [Custody and testnet scope](docs/testnet-pilot.md) · [Manifest and approval formats](docs/formats.md) · [Integration map](docs/integrations.md).

The app store and AI testing remain deferred. Commercial deployments should retain the vendored [TapeKit MIT notice](vendor/tapekit/LICENSE); third-party notices are included in the CLI package.
