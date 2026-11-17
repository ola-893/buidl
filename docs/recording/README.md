# Three-minute buidl recording plan

**Final edit: 3:00. Setup: a separate recording. Narration: your own voice.**

Use [the timed narration](voiceover.txt) while reading, [the shot-by-shot plan](timing.md) while recording, and [the timeline CSV](timeline.csv) when editing. For sentence-level voice-to-screen cuts, use [the sync sheet](sync-cues.md) or [its CSV](sync-cues.csv). The exact source cues are in [cues.json](cues.json).

The plan follows the supplied v0.5.0 public-testnet flow. It keeps manifest creation, both reviewer wallets, approval recording, gated publication, fresh verification, local changed-build rejection and revocation in the main film. Wallet setup, contract deployment, enrollment and policy registration go in the setup recording. Optional custody recovery and disconnect happen after the film.

## Record without racing the wallet

Record the screen first, one take per cue, at the pace the wallet and network need. Then record each narration paragraph separately and put it into the matching time slot. This gives you an exact three-minute film without rushing wallet review. If you prefer to speak live, wait until the cue's required result is visible before making a success claim, and trim the silent wait afterward.

There are twelve cues. Their final edit times are fixed; the raw takes are not. Preserve at least four seconds of clean terminal output after each important result. Your delivery should average about **132 words per minute**. There are **308 words**: about **2:20 of speech** and **40 seconds of breathing room and result holds**. These are planning estimates until your own voice is recorded. Re-read a paragraph to fit its slot rather than speeding the entire voice track up.

Keep the scope line **“X Layer testnet 1952 · buidl hosting fixtures”** visible. For edited waits, use **“Wallet/RPC wait shortened”** or **“Time compressed”**. Keep the genuine signature/transaction confirmations and their outcomes. The changed-recipient section tests a local build gate; it does not mutate the deployed app.

## Optional standalone recording helper

This is a copy of your operator-controlled shell workflow with cue markers and pauses. It is not a new `buidl` command and is not included in the npm CLI. You still review and sign every request yourself.

Download or retain these two adjacent files together:

- [buidl-timed.sh](buidl-timed.sh)
- [cues.json](cues.json)

First preview the narration. This performs no wallet or network operation:

```sh
bash /absolute/path/buidl-timed.sh preview
```

Record the setup separately:

```sh
bash /absolute/path/buidl-timed.sh setup
```

Enter the funded holder and two distinct reviewer addresses. The helper creates a new `buidl-recording.XXXXXX` directory under your current directory, prepares the two files, connects the holder, previews and deploys the fixtures, enrolls the circuit and registers the threshold policy. The holder must have test OKB; reviewers only need to sign messages for this flow. The helper prints the exact next command with the new directory path.

Start the main recording with that same directory:

```sh
bash /absolute/path/buidl-timed.sh record /absolute/path/buidl-recording.ABC123
```

At each cue:

1. The helper prints the final edit time, narration and required evidence.
2. Press Enter when you are ready to record the take.
3. Run through the real wallet interactions. The commands wait for receipts.
4. The helper keeps fast results visible until the cue's minimum take length, then leaves a four-second handle. Hold longer if your narration is unfinished.
5. Press Enter yourself before the next take. Cut the cue text and Enter prompts from the final film.

The helper checks the prepared and current reviewer policy, validates a successful match, checks the exact changed-build mismatch error, requires a second fresh match, and requires explicit revoked approval afterward. An unavailable/RPC error is not accepted as a successful negative test.

No fixed sleep controls when a transaction is signed or considered successful. If a wallet interaction takes longer, the take gets longer. There is no automatic resubmission or automatic recording restart. After a transaction timeout, inspect wallet activity and `buidl wallet history`; reconcile a submitted hash before continuing through individual CLI commands. The helper intentionally refuses to restart a core take directory automatically.

After the main recording, optionally recover custody and disconnect:

```sh
bash /absolute/path/buidl-timed.sh cleanup /absolute/path/buidl-recording.ABC123
```

It asks whether to recover the fixture circuit. Custody recovery requires its own wallet confirmation. If declined, the circuit remains enrolled. Never run cleanup automatically after an interrupted recording; first inspect any open requests and uncertain transactions.

## Sync and edit

Keep `take-markers.jsonl`, `.buidl/transactions.json`, the policy export, the three verification reports and `rejection.txt`. The marker file records actual cue start/end times in the raw take; the CSV records intended positions in the final edit. They serve different purposes.

Align **C01** with **00:00**, **C04** with **00:36**, **C07** with **01:32**, **C08** with **01:54**, **C09** with **02:12**, **C11** with **02:36**, and **C12** with **02:54**. Every cue starts its narration at its listed final-cut time. Put the remaining silence at the end of that cue, over the real result. The final second is silent.

If public-network waiting cannot be shortened cleanly enough to fit a shot, use two honest views inside that slot: the real request/confirmation and the resulting receipt, with an explicit “wait shortened” label. Do not move an outcome before its transaction, synthesize a receipt, present earlier recorded evidence as a fresh run, or narrate an unverified success.

## Setup recording: suggested narration

Setup has no fixed deadline. Record these as separate clips, leaving the waiting periods silent:

| Setup clip | Narration | Pause/result to preserve |
| --- | --- | --- |
| Holder connection | “I connect the funded holder on X Layer testnet. This message selects my account; it does not approve a release.” | Show the connected address and chain. |
| Deployment preview | “The CLI previews two labeled fixture deployments and their test token costs before I sign.” | Hold estimates at least five seconds. |
| Deployment | “I confirm each deployment separately. These are testnet hosting fixtures, not actual TapeOut testnet contracts.” | Wait for both receipts. |
| Custody enrollment | “Enrollment places this fixture circuit in the approval authority's custody. The depositor can recover it later.” | Show the transfer confirmation and receipt. |
| Reviewer policy | “I register two distinct reviewer wallets, and require both signatures. The holder cannot count as a reviewer.” | Show threshold two, reviewers, current authority and registry address. |

A reasonable raw setup budget is several minutes. A reasonable core raw recording budget is ten to fifteen minutes, with extra time if the wallet or RPC is slow. Neither is a promise about network latency. Only the edited main film is fixed at 3:00.
