# X Layer release pilot

The pilot uses one opened TapeOut circuit on chain 196. The [fork command](#rehearse-on-anvil) mints a fresh controlled circuit and exercises the actual TapeOut opener, DomainBinding and SiteRegistry at an X Layer mainnet fork. Its transactions and assets stay on loopback. [Captured fork evidence](xlayer-fork-evidence.json)

## Ownership and trust

The reviewed processor exposes ERC-721 `ownerOf` and `Transfer`, and its frozen implementation has no transfer nonce exposed to a smart contract. A pair of owner reads cannot detect an out-and-back transfer. Both RPC operators reverted the candidate `nonces`, `ownershipEpoch` and `transferNonce` calls for an existing token. [TAP-10](https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-10.md) · [TAP-21](https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-21.md)

Enrollment opts one circuit into `TapeOutSiteAuthority` custody. Its current NFT holder initiates ERC-721 `safeTransferFrom` to the authority. The receiver checks the exact processor, token, depositor and opened container, creates the approval registry on first enrollment, and advances the ownership epoch. The depositor governs publication and can release the circuit to another owner. Release clears the publication marker and advances the epoch. Re-enrollment advances it again, so even the original governing wallet must register a new policy and collect new signatures. The registry address, prior sequence and rollback history persist.

The public verifier derives the authorized holder address from the site and pinned constructor bytecode through the X Layer [deterministic deployment proxy](https://github.com/Arachnid/deterministic-deployment-proxy). It validates that proxy and the authority runtime at the same block as `ownerOf`, SiteRegistry data, policy and publication state. A supplied registry address or a copied runtime alone cannot establish constructor provenance. The published package pins the reviewed compiler output. `npm run build:contracts` reproduces and checks it.

Enrollment transfers the circuit NFT and its token-bound container authority. Use a newly opened, team-controlled circuit for the pilot. The controller exposes ordinary site writes and binding, and the governor can recover the circuit through `releaseTo`. General token-bound account execution is unavailable while in custody. Use the dashboard or the generated `safeTransferFrom` calldata for enrollment. Plain transfers to the authority skip the receiver and can strand the NFT. The authority and the registry have no upgrade path. TapeOut’s site and binding proxies retain their own upgrade trust and the client applies the existing TAP-10 implementation checks.

## Rehearse on Anvil

```sh
npm ci
npm run build:contracts
anvil --host 127.0.0.1 --port 8561 --chain-id 196 \
  --fork-url https://rpc.xlayer.tech --fork-block-number 76068600
```

In another terminal:

```sh
npm run test:xlayer-fork
```

The script requires an X Layer mainnet fork on the fixed loopback endpoint. It mints a new circuit with a pure REF on processor #0, which avoids transistor pre-funding. Fees used in the rehearsal come from native contract reads. Current factory bytecode also differs from the older BEM/OKB creation examples, so provisioning instructions start with an opened circuit. Fresh chain-state verification uses a single fork RPC in the rehearsal and requires two independent operators on mainnet.

## Mainnet pilot, signed by the team

1. Select an opened circuit your team controls. Confirm its TapeOut name and holder. Use the project's **Approvals** panel to deploy the derived authority, then enroll with the holder wallet. Alternatively, `buidl plan-xlayer <tape-name>` prints unsigned deployment and enrollment transactions. Wait for the checked block to include each transaction before continuing. Keep a copy of the original holder, authority and registry addresses.
2. Connect the governing wallet and register the independent reviewer policy. Import or generate the manifest, export an approval request, have reviewers sign on the same X Layer dashboard, and record the signed request. Use an active TapeOut name. If renewal is needed while the circuit is enrolled, read `DomainBinding.monthlyFee()` and have the governor call `bind(name, months)` on the authority with the exact current value.
3. Use the CLI from this checkout (`npm run buidl --`), or install a package built with `npm pack`. Install Foundry for the live publisher and use a configured governor keystore alias. Operator commands with `--broadcast` send transactions on chain 196. The initial release gate and verification are read-only.

```sh
buidl gate-xlayer '<tape-name>' ./dist ./release.json
buidl publish-xlayer '<tape-name>' ./dist ./release.json --broadcast --account '<governor-alias>'
buidl verify-xlayer '<tape-name>'
```

4. Open the dashboard’s verification link. The verifier needs an active name, a current threshold approval, an exact path, byte, MIME and fallback fingerprint, and a finished publication for that commitment. It reports the checked block and recovered reviewer addresses. To demonstrate transfer invalidation, the governor calls `releaseTo` with the intended recipient, then rechecks the link after the next pinned block includes the transfer. Re-enrollment requires a new policy and newly signed release.

The supported publisher stages the exact approved files before any transaction and checks the actual TapeOut bytes and routing before completing the publication. A failed or interrupted upload remains open. Re-running with the current approved build starts a fresh attempt and makes earlier attempts unusable. The authority restricts which site and SiteRegistry selectors it forwards and requires a current registered approval for an upload. The governing wallet can still handcraft altered calldata inside an approved attempt. Independent byte verification detects that case. Gateways enforce a result only if they integrate it.

No public deployment receipts are supplied by the fork rehearsal. The mainnet pilot requires a controlled circuit, wallet signatures and explicit authorization for the proposed transactions and fees.
