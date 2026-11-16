# buidl

Does this deployed DeWEB app match the exact release approved by the team?

buidl verifies X Layer DeWEB bytes against TapeOut and compares complete deployments with independently approved manifests. The local demo uses Anvil. The X Layer pilot uses the native TapeOut contracts and a site-specific authority, with a full rehearsal on an Anvil fork. Approval establishes an artifact match. Security reviews and source-to-build reproducibility are separate claims.

## Use buidl

- [Web dashboard](https://ola-893.github.io/buidl/) for inspecting a deployment and preparing a manifest.
- [Public verification](https://ola-893.github.io/buidl/?verify=1.2.230.tape) for a fresh content check without a wallet. From a resolved dashboard inspection, open **Verification link** to share a different site.
- [Installable CLI](https://github.com/ola-893/buidl/releases/tag/v0.3.0) for terminal and CI workflows. Node.js 22.13+ is required.

```sh
npm install -g https://github.com/ola-893/buidl/releases/download/v0.3.0/buidl-0.3.0.tgz
buidl inspect 1.2.230.tape
```

CLI v0.3.0 includes the X Layer pilot commands. To build the package yourself, run `npm ci` and `npm pack` from the checkout.

Public links perform fresh reads when opened, recheck while open, and display the checked block and UTC check time. A live X Layer link reports content integrity and checks current approval when the site is enrolled in a recognized authority. A loopback demo link checks the actual Anvil registry and shows its reviewer evidence and match status. It is scoped to that particular local registry instance and, when available, its current release digest.

## Run locally

Use Node.js 22.13+ and npm. The controlled release workflow also requires [Foundry Anvil](https://getfoundry.sh/anvil/).

```sh
npm ci
npm run dev
```

Open [buidl](http://127.0.0.1:5173). The default site, `1.2.230.tape`, is read from X Layer mainnet. You can also enter names such as `#1@2.230` or an address scoped as `xlayer:0x…` or `xlayer:0x…#1`. The inspector renders metadata and hashes. It never opens the inspected page.

Run the mainnet inspection in a terminal with `npm run buidl -- inspect 1.2.230.tape`. A captured result is in [live inspection evidence](docs/live-inspection.json).

For the testnet-only pilot, open [the separate testnet dashboard](http://127.0.0.1:5173/?testnet=1) and follow [the testnet runbook](docs/testnet-pilot.md). It uses labeled buidl fixtures on chain 1952 because the reviewed TapeOut deployment addresses have no testnet code. Every transaction has a cost review before wallet signing, and the fixture constructors reject mainnet. The testnet commands are available from this checkout; CLI v0.3.0 predates them.

## Run the controlled release workflow

Start a dedicated Anvil instance bound to loopback:

```sh
anvil --host 127.0.0.1 --port 8545 --chain-id 31337
```

In a second terminal:

```sh
npm run demo -- init
npm run demo -- approve a
npm run buidl -- gate demo/release-a public/local-demo/manifest-a.json public/local-demo/config.json
npm run buidl -- publish-local demo/release-a public/local-demo/manifest-a.json public/local-demo/config.json
npm run buidl -- verify-local public/local-demo/manifest-a.json public/local-demo/config.json
```

The first Anvil account publishes. Two of the next three accounts independently sign typed approval. For browser signing, open **Local demo** from the dev server and select **Releases**, then **Load demo A**. Use **Approvals** to create a request, connect the local reviewer accounts in turn, and sign. Export/import carries the request between reviewers. Once the threshold is met, any connected wallet on the local chain can record the approval. To start with an unregistered local site, use `npm run demo -- init --unregistered`, then connect the holder wallet and select **Approvals → Register app**. The scripted `approve a` command is an alternative to the browser signing steps once a policy exists. Use a disposable extension wallet profile and the test-only accounts printed by Anvil.

Run `npm run demo` for the entire scripted A → bypassed B → approved B demonstration. The [2:40 demo script](docs/demo.md) gives the browser and terminal sequence.

To generate a candidate from a directory, use **Releases → Select build folder**, or:

```sh
npm run buidl -- manifest demo/release-a --site public/local-demo/site.json \
  --release checkout-a --fallback index.html --out /tmp/buidl-manifest-a.json
```

Write the manifest outside the build directory. CI should treat the CLI's nonzero exit as a failed check. `inspect` and `verify-local` exit 2 for completed checks without a complete verification or an approved match, respectively. Command, input, and gate failures exit 1.

## Architecture

- `src/core/tapeout.ts` uses the pinned TapeKit kernel for identity, implementation checks, and multi-operator RPC. The inventory reader hashes raw bytes and uses the exact paths and routing metadata returned by SiteRegistry.
- `src/core/manifest.ts` and `src/core/build.ts` implement the canonical format, artifact staging, and comparison. See the [manifest and approval formats](docs/formats.md).
- `src/core/approval.ts` and `contracts/ReleaseRegistry.sol` verify EIP-712 signatures. The registry stores commitments and policy state onchain. Manifests and file contents stay outside the approval registry.
- `contracts/LocalDeweb.sol` is a controlled local fixture with a SiteRegistry-compatible surface and an ownership epoch. It provides explicit upload state, so a multi-transaction upload can stay visibly incomplete.
- `src/cli.ts`, `src/publish.ts`, and `src/web` expose the CLI gate, staged publisher, and React interface. Local JSON exports and registry logs provide portable evidence and chain history.

## Verification and enforcement

```sh
npm run build
npm test
npx playwright install chromium
npm run test:browser
```

The browser suite expects the disposable Anvil service running. It deploys its own fixture per run. Use `BUIDL_BROWSER=chrome npm run test:browser` with installed Chrome. It reads a real mainnet deployment and signs and submits local transactions through a controlled EIP-1193 test provider. The OKX browser-extension path follows its documented EVM interface and still needs an interactive extension check.

The supported publisher gates staged bytes before upload and verifies the staged deployment before ending the upload. Direct holder writes can bypass the publisher. A fresh post-deployment read detects divergence. Viewer-side blocking requires a viewer that integrates and enforces the result. For loopback recovery, rerun the gated publisher after the interrupted process exits. After a hard kill, remove the matching empty `.demo/publish-<container>.lock` directory once the old publisher is gone.

The hosted frontend uses GitHub Pages as its independent HTTPS origin. The [X Layer release pilot](docs/xlayer-release.md) describes the fork rehearsal and team-signed mainnet steps. Existing public sites remain inspectable, and live approval evidence requires explicit site enrollment. The [integration map](docs/integrations.md) records the verified contracts, provider constraints, and hosting options.

## Commercial use and roadmap

The initial users are payment and dapp teams with publishing wallets and separate reviewers. A proposed model is free inspection and portable public evidence, with paid CI integration, team policy administration, and release notifications. TapeOut developer channels and wallet or gateway integrations are candidate distribution channels. Teams would pay for a repeatable approval gate and incident evidence across releases. Commercial deployments should retain the vendored [TapeKit MIT notice](vendor/tapekit/LICENSE). TAP text is CC0, TapeKit code is MIT, and bundled fonts carry their SIL Open Font License notices.

Future work includes a curated DeWEB app store, independent reviewer attestations and revocation, contract evidence bound to chain/address/bytecode/proxy/configuration, authorized isolated AI exploit testing, private disclosures and reviewer-validated bounties, and enforcement integrations for directories, gateways, and wallets.
