# X Layer testnet pilot

For current wallet, app and release operations, follow the [CLI guide](cli.md). This document records the fixture architecture, public pilot receipts and earlier dashboard workflow.

This deployment uses the explicit `?testnet=1` dashboard route, chain **1952**, and test OKB. The live network is separate from X Layer mainnet (196). Test fixture constructors reject every chain except 1952. The wallet and CLI check the network before estimates or signatures.

## Verified discovery

Both officially documented testnet RPC endpoints answered as chain 1952. At the agreed block in [discovery.json](testnet/discovery.json), the connected public account held 0.2 test OKB. The four TapeOut mainnet deployment addresses had no testnet code. The reviewed TAP-10 deployment table and TapeKit configuration supply mainnet deployments. This does not rule out undocumented testnet contracts at other addresses.

The actual MetaMask wallet initially reported Sepolia, chain 11155111. The test dashboard added the documented X Layer testnet network and observed the wallet switch to chain 1952.

MetaMask initially rejected transaction requests with error 4100 before displaying a signing screen. This matches the reported [new-network permission bug](https://github.com/MetaMask/metamask-extension/issues/47773). Disconnect only the buidl site and reconnect it while X Layer testnet is selected, then retry the cost review. Repeatedly pressing the connect button while the existing permission is present does not replace that permission.

- RPCs — `https://testrpc.xlayer.tech/terigon`, `https://xlayertestrpc.okx.com/terigon`
- Chain — 1952 (`0x7a0`)
- Currency — test OKB
- Explorer — `https://www.okx.com/web3/explorer/xlayer-test`

[Official X Layer network information](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/build-on-xlayer/network-information) · [TapeKit network configuration](https://github.com/TapeOutProtocol/TapeKit/blob/main/kernel/src/config.js)

## Fixtures and trust

`TestnetDeweb` simulates one circuit and combines an already-open container with a file store using the TapeOut read/write surface. Its NFT transfer surface is deliberately limited to the fixture holder. `TestnetAuthority` simulates circuit custody and enforces an active approval during publication. These are buidl-owned test fixtures. Their results describe the approval workflow on testnet, with separate proof of TapeOut compatibility provided by the [mainnet-fork rehearsal](xlayer-fork-evidence.json).

The independent `ReleaseRegistry` uses the same signature, threshold, replay and revocation rules as the existing local and fork tests. Enrollment creates its registry. Custody recovery and subsequent ownership changes advance an epoch. Re-enrolling the fixture invalidates the old policy and commitment, including when it returns to its original wallet.

The fixtures are unaudited and require chain 1952 in their constructors. The test route checks the actual wallet account and network again immediately before every signature and transaction. Each transaction opens a cost-review dialog and then the wallet's own signing screen. Predicted addresses depend on the displayed sender nonce. If it changes, regenerate the plan before signing.

## Run and prepare

```sh
npm ci
npm run build:testnet
npm run test:testnet
npm run dev
```

For actual wallet signing, a production preview avoids development reloads: run `npm run build`, then `npm run preview -- --port 5173 --strictPort` after stopping the dev server.

Open `http://127.0.0.1:5173/?testnet=1`, connect the holder, and select X Layer testnet. The dashboard estimates both deployments and displays a test OKB budget. The initial [unsigned plan](testnet/deployment-plan.json) includes the testnet-only creation bytecode and estimated gas. Refresh the estimate if the account nonce or gas price changes.

The CLI supports unsigned deployment planning, fresh verification and a build gate:

```sh
npm run buidl -- plan-testnet-fixtures <public-owner> --chain-id 1952 --out /tmp/testnet-plan.json
npm run buidl -- verify-testnet-fixtures ./fixture-config.json
npm run buidl -- gate-testnet-fixtures ./build ./manifest.json ./fixture-config.json
```

The configuration schema is `{kind:"testnet-fixtures",chainId:1952,fixture:"0x…",authority:"0x…"}`. All testnet commands reject a mainnet configuration or node. The plan command additionally requires the literal `--chain-id 1952`. The published CLI v0.3.0 predates these testnet commands. Run this checkout until a new release is published.

If the dashboard reloads between deployments, reconnect the holder and select **Estimate testnet deployment** again. It recognizes the existing fixture and prepares only its missing authority. The CLI equivalent adds `--fixture <existing-simulated-circuit>` to the planning command. Resuming verifies the fixture's runtime and current holder before preparing bytecode.

## Dashboard sequence

1. Review and sign the two fixture deployments. Enroll the simulated circuit with the holder wallet.
2. Register a threshold policy with separate reviewer addresses. Load sample A or a production build folder. The fixture publisher limits a file to 60 KB and accepts up to 20 files through the dashboard.
3. Export the approval request, switch to each authorized reviewer wallet, sign it, and merge their signed requests with **Import signed request**. Signature checks use actual recovered addresses. The holder address cannot count as a reviewer.
4. Record the threshold approval. Publish the staged approved bytes, approving each displayed transaction. The publisher hashes the staged files and checks the onchain content and routing before ending the upload.
5. Run **Test changed payment file** with the controlled holder to demonstrate that valid file hashes can still differ from the independently approved artifact set.
6. Run **Begin interrupted upload**. A fresh check must remain unavailable until a complete approved upload finishes. Canceling a transaction stops later upload steps. Retry the publisher to start a new attempt.
7. Revoke the current approval and verify its status. Recover the simulated circuit. Transfer it to a controlled second owner and re-enroll. The old policy and old signatures must remain unusable. Re-register and collect fresh approvals as needed.
8. Export **receipts & results** to capture the configuration, transaction hashes, blocks, gas and observed outcomes. Real wallet signing and public receipts remain separate from the disposable Anvil test suite.

The automated test suite uses local Anvil with chain ID 1952 to exercise this same fixture code. It covers registration authority, two distinct signatures, threshold and replay rejection, approved publication, changed-file detection, interrupted upload recovery, revocation, ownership change and recovery. It switches the disposable node to 196 to verify that both constructors reject mainnet.

Previously approved artifacts require an explicit rollback request and fresh reviewer signatures, including after re-enrollment. The dashboard checks the registry's artifact history before preparing a request.

## Current public signing state

The holder deployed the simulated circuit/store at `0xe97847558dded18fc6208ce47eeec7ab73c09d9d` and the custody authority at `0xe047120881026327af28e74a6ea0c046edd01568`. Enrollment created the approval registry at `0xd52A10A333D316189e87076f2c600C4De5FE08d6`. The two-reviewer policy is confirmed. Full public receipts and paid test-token costs are saved in the structured [pilot status](testnet/pilot-status.json) and [receipt directory](testnet/receipts).

Both actual reviewers signed release 1, policy 1, for manifest `0x3009cf76be7286a25b885493959403d05e27c5612467ef3058cf96a61da36524`. The [signed evidence](testnet/signed-release-1.json) recovers to the two supplied reviewer addresses. At checked block 46448187, a registry simulation accepts both signatures and rejects one signature; [results](testnet/results/reviewer-signatures.json) record this without sending an invalid transaction. The relay omits revert data, so the exact custom error is unavailable. Release 1 approval is now confirmed in [transaction 0xdd49…fa76](https://www.okx.com/web3/explorer/xlayer-test/tx/0xdd49e201805d06cfe5437edcbafb6c7cff0d1ccd9226cad8327d5dd8fe7efa76). Publication attempt 1 began in [transaction 0x050e…37a2](https://www.okx.com/web3/explorer/xlayer-test/tx/0x050e0791d60047aa271672d1eb48eda4d8ac23ad9be6252117d038f8103f37a2). The CLI resumed that attempt, confirmed both file uploads and routing, and finished publication in [transaction 0x2aa4…4db9](https://www.okx.com/web3/explorer/xlayer-test/tx/0x2aa40ef20a4b93ab2b4cad85bfcb1d3bcddef574cfd8356caa04c0b29c824db9). The [fresh CLI verification](testnet/results/cli-approved-release.json) reports **Matches approved release** at block **46452266**, checked **2026-11-17 10:25:09 UTC**. Both files verify, routing matches and the upload is complete. The [CLI transaction journal](testnet/cli-transactions.json) captures the individual estimates, receipts and costs. The [CLI workflow](cli-demo.md) is the primary demo surface.
MetaMask subsequently reported unavailable gas-price RPC reads (`-32002`) before the authority could be submitted. Chain ID 1952, the deployed fixture runtime and a gas-price read were independently checked at `https://testrpc.xlayer.tech`, listed in the [Ethereum chain registry](https://github.com/ethereum-lists/chains/blob/master/_data/chains/eip155-1952.json). The [unsigned authority plan](testnet/authority-deployment-plan.json) resumes at nonce 1. The dashboard supplies the reviewed gas price and checks the pending nonce immediately before opening the wallet.

The dashboard uses both documented `/terigon` endpoints as fallbacks for unavailable reads; this is availability fallback, not independent RPC agreement. The production build is served at the same local origin for the remaining signing steps.

If MetaMask cannot directly reach the public RPC, the optional loopback relay forwards its requests through curl. It never signs transactions. Start it with explicit chain and public signer addresses:

```sh
npm run testnet:relay -- --chain-id 1952 \
  --wallet 0xe26468ae02368a75DBDBea58F367B7313942ad26 \
  --wallet 0x679A4aBF5c35c593e0d8e6dB2Ee120dd11d8456E \
  --wallet 0x3c25aD59862531A022c96A49c067E991441240C5
```

Select `http://127.0.0.1:8552` as a custom RPC for the existing X Layer testnet network, chain 1952. This forwards to the public X Layer testnet and is distinct from local Anvil. The relay rejects unsigned sends, signed transactions for other chains, unknown signer addresses, and an upstream reporting the wrong chain. Wallet confirmation is still required for each transaction.

Open `http://127.0.0.1:5173/?testnet=1&rpc=relay` to use that relay for dashboard reads too. This option is accepted only on a loopback dashboard origin. The hosted dashboard continues to use the documented public endpoints.

Earlier attempts to submit the authority deployment failed at the direct RPC. Switching the existing wallet network to the guarded relay resolved broadcasting; the authority, enrollment and reviewer policy now have successful public receipts.

The actual reviewers are `0x679A4aBF5c35c593e0d8e6dB2Ee120dd11d8456E` and `0x3c25aD59862531A022c96A49c067E991441240C5`. Both signatures were captured through the dashboard in MetaMask on chain 1952. No mainnet transactions were sent.

Public-testnet coverage includes the actual holder and two reviewer wallets, approval recording, interrupted-session reconciliation, upload resumption and fresh approved-match verification. Changed-file mutation, revocation, ownership transfer/re-enrollment and recovery currently have disposable local test coverage; they have not been transacted with these wallets on public testnet.
