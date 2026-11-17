# Exact 3:00 cut and narration

Record the screen first. Each cue starts its narration at the listed final-edit time. End-of-cue pauses are estimated at 132 words per minute; adjust the reading take to fit. Wallet waits extend raw footage and are edited separately.

| Final cut | Screen action | Spoken words | Speech estimate | Result hold |
| --- | --- | --- | --- | --- |
| **00:00–00:08 · C01** | The problem | 15 | 6.8s | 1.2s |
| **00:08–00:18 · C02** | Prepared app and policy | 20 | 9.1s | 0.9s |
| **00:18–00:36 · C03** | Bind the build | 29 | 13.2s | 4.8s |
| **00:36–00:54 · C04** | Reviewer one | 30 | 13.6s | 4.4s |
| **00:54–01:12 · C05** | Reviewer two | 30 | 13.6s | 4.4s |
| **01:12–01:32 · C06** | Record approval | 33 | 15.0s | 5.0s |
| **01:32–01:54 · C07** | Gate and publish | 37 | 16.8s | 5.2s |
| **01:54–02:12 · C08** | Fresh approved match | 31 | 14.1s | 3.9s |
| **02:12–02:28 · C09** | Reject a changed build | 30 | 13.6s | 2.4s |
| **02:28–02:36 · C10** | Verify the published release again | 14 | 6.4s | 1.6s |
| **02:36–02:54 · C11** | Revoke approval | 28 | 12.7s | 5.3s |
| **02:54–03:00 · C12** | Close | 11 | 5.0s | 1.0s |

Total: **180 seconds**, **308 words**, approximately **140 seconds of speech** plus **40 seconds of holds**.

## Shot instructions

### C01 · 00:00–00:08 · The problem

**Say:** “A reviewed checkout can change after approval. How do you verify what is actually deployed?”

**Record:** Clean terminal; buidl --version. Keep a small scope label visible throughout the edit.

**Result gate:** The CLI version is visible.

**Must remain visible:** Installed CLI version 0.5.0.

**Edit:** Hold the terminal. No transaction or signing is needed here.

### C02 · 00:08–00:18 · Prepared app and policy

**Say:** “This is buidl on X Layer testnet, using labeled hosting fixtures. Setup is complete, with two separate reviewer wallets required.”

**Record:** App configuration, then policy show. Focus the threshold and reviewer addresses.

**Result gate:** The registered policy output is visible.

**Must remain visible:** Chain 1952, threshold 2, two distinct reviewers, current authority.

**Edit:** Deployment and enrollment belong in the separate setup recording. Do not imply these are actual TapeOut testnet contracts.

### C03 · 00:18–00:36 · Bind the build

**Say:** “I generate a manifest from the build. It commits to exact files, lengths, content types, and fallback routing. The approval request also binds the registry, policy, sequence, and expiry.”

**Record:** release create; release inspect; release request. Show the manifest digest and the two file entries.

**Result gate:** The manifest and approval request have both been created.

**Must remain visible:** The manifest comes from the build that will be published.

**Edit:** Trim typing and repeated JSON scrolling, keeping each real command and its result.

### C04 · 00:36–00:54 · Reviewer one

**Say:** “The first reviewer connects their wallet and signs this release request. Connection and release approval are separate signatures. The CLI recovers the signer and checks that this wallet is authorized.”

**Record:** wallet connect for reviewer one; release sign; extension EIP-712 request; verified signer output.

**Result gate:** Reviewer one's release signature is verified.

**Must remain visible:** Reviewer one's account, the release signature prompt, and the verified result.

**Edit:** Show connection briefly. Keep the release signature confirmation readable. Shorten empty extension/RPC waiting with a visible time-compressed label.

### C05 · 00:54–01:12 · Reviewer two

**Say:** “A second reviewer wallet signs the same request. The holder cannot count as a reviewer, and duplicate signatures do not satisfy the threshold. Both signatures refer to the same release.”

**Record:** Connect the second account; sign the same request into a separate evidence file.

**Result gate:** Reviewer two's release signature is verified.

**Must remain visible:** A different reviewer address and the same manifest digest.

**Edit:** Show the account change and real signature result. Do not call these independent people unless they actually are.

### C06 · 01:12–01:32 · Record approval

**Say:** “I reconnect the holder and preview the approval. The CLI validates both reviewer signatures before recording their commitment onchain. I review the estimated test token cost and confirm the transaction in my wallet.”

**Record:** Holder connection; release approve preview; release approve --execute; receipt.

**Result gate:** The holder's approval-recording transaction has a successful receipt.

**Must remain visible:** Threshold evidence, quoted cost, chain 1952 in the wallet, successful transaction hash.

**Edit:** Keep preview and receipt. Condense the connection and waiting, never the fact that confirmation was required.

### C07 · 01:32–01:54 · Gate and publish

**Say:** “The publishing gate checks this exact build against the active approval. Publishing then uploads the files through separate wallet confirmations. Before finishing, buidl reconstructs the uploaded bytes and checks their hashes and routing against the approved release.”

**Record:** release gate; release publish --execute; representative upload quote and wallet confirmation; remaining receipts; publication finish.

**Result gate:** The publishing command has completed with an approved match.

**Must remain visible:** Gate passed; real upload and finish receipts; each transaction was individually confirmed.

**Edit:** Compress multi-transaction waits. Use '5 individually confirmed testnet transactions · waits shortened' only if this run's history actually shows five successful publishing transactions. Otherwise show the actual count.

### C08 · 01:54–02:12 · Fresh approved match

**Say:** “Fresh verification now reports a match. Both file hashes are verified, the approval is current, and publication is complete. The checked block, check time, and public receipts make this result inspectable.”

**Record:** release verify, then its report and wallet history. Focus outcome, block, checkedAt, authority and file statuses.

**Result gate:** The new verification report says Matches approved release.

**Must remain visible:** Matches approved release; checked block and time; incomplete false; verified files.

**Edit:** Give the match and block at least four seconds unobstructed. No static badge is presented as perpetual proof.

### C09 · 02:12–02:28 · Reject a changed build

**Say:** “Now I change the payment recipient in a local build copy. The existing approval does not authorize those new bytes. The gate rejects the mismatch before requesting a publishing transaction.”

**Record:** Show old and changed payment.json recipients, then release gate dist-changed manifest.json and the mismatch error.

**Result gate:** The changed local build is rejected specifically for a manifest mismatch.

**Must remain visible:** The recipient difference and the exact build/manifest mismatch error.

**Edit:** Label 'Local changed build · blocked before publishing'. Do not claim deployed-file mutation or onchain attack detection from this test.

### C10 · 02:28–02:36 · Verify the published release again

**Say:** “The published release still matches. The rejected local change never replaced the approved deployment.”

**Record:** A new release verify report, with its new check time and block.

**Result gate:** A second fresh verification still reports an approved match.

**Must remain visible:** A real second verification, not a replay of C08.

**Edit:** Hold the matching outcome; retain enough context to distinguish the fresh report.

### C11 · 02:36–02:54 · Revoke approval

**Say:** “Finally, I revoke approval onchain. The files remain deployed, but fresh verification now reports revoked approval. Teams can withdraw their approval without pretending the hosted bytes have disappeared.”

**Record:** release revoke --execute; confirmation receipt; release verify returning exit code 2 with revoked outcome.

**Result gate:** Revocation is confirmed and the new verification reports revoked approval.

**Must remain visible:** Successful revoke receipt, followed by Approval revoked or expired with approvalRevoked true.

**Edit:** Shorten wallet/RPC waiting, keeping the transaction and changed verification result in order. Do not substitute an unavailable/error result for revoked.

### C12 · 02:54–03:00 · Close

**Say:** “Approve exact bytes. Gate the workflow. Verify fresh. That is buidl.”

**Record:** Hold terminal and npm install command as a small end overlay: npm install -g @ola-893/buidl@0.5.0

**Result gate:** The revoked verification report remains visible.

**Must remain visible:** The install command is readable; the final narration does not claim viewer-side access blocking.

**Edit:** Keep the final second silent. Disconnect and optional custody recovery are recorded after this cut.
