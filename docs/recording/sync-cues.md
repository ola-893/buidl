# Voice and picture synchronization

These are **reading estimates at 132 words per minute**, not measurements of your recorded voice. Put your real narration into each fixed section first, then move the visual cuts to the words that describe them. Leave the listed silence at the end for the result.

| Time | Voice-over phrase | Picture |
| --- | --- | --- |
| 00:00.0–00:03.2 | A reviewed checkout can change after approval. | CLI version; problem stated over a clean terminal |
| 00:03.2–00:06.8 | How do you verify what is actually deployed? | CLI version; problem stated over a clean terminal |
| 00:06.8–00:08.0 | [silence] | Installed CLI version 0.5.0. |
| 00:08.0–00:13.0 | This is buidl on X Layer testnet, using labeled hosting fixtures. | Chain 1952 and explicit fixture label |
| 00:13.0–00:17.1 | Setup is complete, with two separate reviewer wallets required. | Threshold two and distinct reviewer accounts |
| 00:17.1–00:18.0 | [silence] | Chain 1952, threshold 2, two distinct reviewers, current authority. |
| 00:18.0–00:21.2 | I generate a manifest from the build. | release create and digest |
| 00:21.2–00:26.2 | It commits to exact files, lengths, content types, and fallback routing. | release inspect file entries and fallback |
| 00:26.2–00:31.2 | The approval request also binds the registry, policy, sequence, and expiry. | release request saved |
| 00:31.2–00:36.0 | [silence] | The manifest comes from the build that will be published. |
| 00:36.0–00:41.0 | The first reviewer connects their wallet and signs this release request. | First reviewer connection and account |
| 00:41.0–00:44.2 | Connection and release approval are separate signatures. | Connection versus release signature prompts |
| 00:44.2–00:49.6 | The CLI recovers the signer and checks that this wallet is authorized. | Verified authorized signer output |
| 00:49.6–00:54.0 | [silence] | Reviewer one's account, the release signature prompt, and the verified result. |
| 00:54.0–00:57.6 | A second reviewer wallet signs the same request. | Second reviewer account and same request |
| 00:57.6–01:04.5 | The holder cannot count as a reviewer, and duplicate signatures do not satisfy the threshold. | Same digest and threshold context |
| 01:04.5–01:07.6 | Both signatures refer to the same release. | Second verified signature output |
| 01:07.6–01:12.0 | [silence] | A different reviewer address and the same manifest digest. |
| 01:12.0–01:15.6 | I reconnect the holder and preview the approval. | Holder reconnection and approve preview |
| 01:15.6–01:20.6 | The CLI validates both reviewer signatures before recording their commitment onchain. | Signature threshold validated; record request |
| 01:20.6–01:27.0 | I review the estimated test token cost and confirm the transaction in my wallet. | Test OKB quote, wallet confirmation and receipt |
| 01:27.0–01:32.0 | [silence] | Threshold evidence, quoted cost, chain 1952 in the wallet, successful transaction hash. |
| 01:32.0–01:37.0 | The publishing gate checks this exact build against the active approval. | Exact-build gate passed |
| 01:37.0–01:41.1 | Publishing then uploads the files through separate wallet confirmations. | Individually confirmed uploads; waits shortened visibly |
| 01:41.1–01:48.8 | Before finishing, buidl reconstructs the uploaded bytes and checks their hashes and routing against the approved release. | Finish receipt and completed publication result |
| 01:48.8–01:54.0 | [silence] | Gate passed; real upload and finish receipts; each transaction was individually confirmed. |
| 01:54.0–01:56.7 | Fresh verification now reports a match. | Matches approved release outcome |
| 01:56.7–02:02.6 | Both file hashes are verified, the approval is current, and publication is complete. | Verified files; current approval; incomplete false |
| 02:02.6–02:08.1 | The checked block, check time, and public receipts make this result inspectable. | Checked block, checkedAt and public transaction history |
| 02:08.1–02:12.0 | [silence] | Matches approved release; checked block and time; incomplete false; verified files. |
| 02:12.0–02:17.0 | Now I change the payment recipient in a local build copy. | Original versus changed recipient in local files |
| 02:17.0–02:21.1 | The existing approval does not authorize those new bytes. | Original manifest digest stays fixed |
| 02:21.1–02:25.6 | The gate rejects the mismatch before requesting a publishing transaction. | Exact build mismatch error; no publishing transaction |
| 02:25.6–02:28.0 | [silence] | The recipient difference and the exact build/manifest mismatch error. |
| 02:28.0–02:30.3 | The published release still matches. | Fresh second match report |
| 02:30.3–02:34.4 | The rejected local change never replaced the approved deployment. | Fresh check block/time; no local changes were deployed |
| 02:34.4–02:36.0 | [silence] | A real second verification, not a replay of C08. |
| 02:36.0–02:38.3 | Finally, I revoke approval onchain. | Revocation wallet confirmation and receipt |
| 02:38.3–02:43.3 | The files remain deployed, but fresh verification now reports revoked approval. | New verification with revoked outcome |
| 02:43.3–02:48.7 | Teams can withdraw their approval without pretending the hosted bytes have disappeared. | approvalRevoked true; files still present |
| 02:48.7–02:54.0 | [silence] | Successful revoke receipt, followed by Approval revoked or expired with approvalRevoked true. |
| 02:54.0–02:55.4 | Approve exact bytes. | Terminal result, followed by readable npm install line |
| 02:55.4–02:56.7 | Gate the workflow. | Terminal result, followed by readable npm install line |
| 02:56.7–02:57.6 | Verify fresh. | Terminal result, followed by readable npm install line |
| 02:57.6–02:59.0 | That is buidl. | Terminal result, followed by readable npm install line |
| 02:59.0–03:00.0 | [silence] | The install command is readable; the final narration does not claim viewer-side access blocking. |
