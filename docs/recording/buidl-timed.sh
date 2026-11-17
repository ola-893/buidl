#!/usr/bin/env bash
# Operator-owned recording helper, separate from the installed buidl CLI.
# No unattended signing. No mainnet writes. No fake evidence.
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
MODE=${1:-help}
WORK=''
STEP='preflight'
START=0

usage() {
  cat <<'HELP'
Usage:
  bash buidl-timed.sh preview                  Show the 3:00 cue sheet; no wallet/RPC calls
  bash buidl-timed.sh setup                    Record setup separately in a NEW directory
  bash buidl-timed.sh record /absolute/run-dir  Record the core journey after successful setup
  bash buidl-timed.sh cleanup /absolute/run-dir Optional custody recovery and disconnect

Requires the adjacent cues.json and Node.js. Setup/record/cleanup require installed
buidl v0.5.0 and an interactive terminal. No version is installed automatically.
The raw take may exceed three minutes. The final edit has twelve exact time slots.
Commands wait for real wallet confirmations and receipts; pauses never replace them.
A failed/interrupted recording is not automatically resumed. Inspect the journal first.
HELP
}
fail() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }
stop_notice() {
  printf '\nStopped during %s. Inspect wallet activity and buidl wallet history before retrying.\n' "$STEP" >&2
  [[ -z "$WORK" ]] || printf 'Evidence: %s\nDo not blindly rerun record after any transaction timeout.\n' "$WORK" >&2
}
trap stop_notice ERR
trap 'stop_notice; exit 130' INT
trap 'stop_notice; exit 143' TERM

need_node() { command -v node >/dev/null || fail 'Node.js is required.'; }
need_live() {
  need_node
  command -v buidl >/dev/null || fail 'Install first: npm install -g @ola-893/buidl@0.5.0'
  [[ "$(buidl --version)" == '0.5.0' ]] || fail 'This recording plan targets exactly buidl 0.5.0.'
  [[ -t 0 && -t 1 ]] || fail 'Run setup, record and cleanup interactively in a terminal.'
}
address() { [[ "$1" =~ ^0x[0-9a-fA-F]{40}$ ]] && [[ ! "$1" =~ ^0x0{40}$ ]]; }
pause() {
  printf '\n%s\n' "$1"
  read -r -p 'Press Enter when ready; Ctrl-C stops: ' _ </dev/tty
}
run() {
  printf '\n$'; printf ' %q' "$@"; printf '\n'
  "$@"
}
capture_json() {
  local destination=$1
  shift
  printf '\n$'; printf ' %q' "$@"; printf '\n'
  "$@" > "$destination"
  cat "$destination"
}
marker() {
  # Only public timing metadata. No raw wallet messages, tokens or secrets.
  node - "$WORK/take-markers.jsonl" "$1" "$2" "$3" <<'NODE'
const fs=require('node:fs');
const [path,event,cue,elapsed]=process.argv.slice(2);
fs.appendFileSync(path,JSON.stringify({event,cue,elapsedSeconds:Number(elapsed),at:new Date().toISOString()})+'\n');
NODE
}
cue_info() {
  node - "$ROOT/cues.json" "$1" <<'NODE'
const fs=require('node:fs');const plan=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const c=plan.cues.find(c=>c.id===process.argv[3]);if(!c)throw Error('Unknown cue');
const tc=s=>`${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
console.log(`\n${c.id} · FINAL CUT ${tc(c.start)}–${tc(c.end)} · ${c.title}`);
console.log('Record the commands first. Start the narration when its result is ready, or read it later over this take.');
console.log('VOICE: '+c.voice);console.log('KEEP: '+c.mustShow);
NODE
}
shot() {
  STEP=$1
  cue_info "$STEP"
  pause 'Begin this take when your wallet, terminal and recording are ready.'
  START=$SECONDS
  marker start "$STEP" "$START"
}
hold() {
  local minimum elapsed left
  minimum=$(node - "$ROOT/cues.json" "$STEP" <<'NODE'
const fs=require('node:fs');const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8')).cues.find(c=>c.id===process.argv[3]);console.log(c.end-c.start);
NODE
)
  elapsed=$((SECONDS - START))
  left=$((minimum - elapsed))
  if ((left > 0)); then
    printf '\nHold this result on screen for %s more seconds.\n' "$left"
    sleep "$left"
  fi
  printf '\nLeave a 4-second clean handle. Narrate now if reading live; keep holding until you finish.\n'
  sleep 4
  pause 'Finish the narration and leave the result readable before moving on.'
  marker end "$STEP" "$SECONDS"
}
read_roles() {
  local values
  values=$(node - "$WORK/recording-config.json" <<'NODE'
const fs=require('node:fs');const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(c.chainId!==1952||c.kind!=='buidl-manual-recording')throw Error('Wrong recording scope');
for(const a of [c.holder,c.reviewer1,c.reviewer2])if(!/^0x[0-9a-fA-F]{40}$/.test(a)||/^0x0{40}$/.test(a))throw Error('Invalid recording address');
if(new Set([c.holder,c.reviewer1,c.reviewer2].map(a=>a.toLowerCase())).size!==3)throw Error('Distinct roles required');
console.log([c.holder,c.reviewer1,c.reviewer2].join('\n'));
NODE
)
  HOLDER=$(printf '%s\n' "$values" | sed -n '1p')
  REVIEWER1=$(printf '%s\n' "$values" | sed -n '2p')
  REVIEWER2=$(printf '%s\n' "$values" | sed -n '3p')
}
set_work() {
  [[ -n "${2:-}" && -d "$2" ]] || fail 'Give the setup run directory as the second argument.'
  WORK=$(cd -- "$2" && pwd)
  cd -- "$WORK"
  read_roles
  [[ -f buidl.json && -f setup-complete.json ]] || fail 'This directory has no completed setup.'
  node - "$HOLDER" "$REVIEWER1" "$REVIEWER2" <<'NODE'
const fs=require('node:fs');const [holder,r1,r2]=process.argv.slice(2),p=JSON.parse(fs.readFileSync('buidl.json','utf8'));
if(p.chainId!==1952||p.network!=='xlayer-testnet-fixtures'||p.owner.toLowerCase()!==holder.toLowerCase()||p.threshold!==2||p.reviewers.length!==2||![r1,r2].every(a=>p.reviewers.some(b=>b.toLowerCase()===a.toLowerCase())))throw Error('Project no longer matches this recording configuration');
NODE
}
assert_report() {
  node - "$1" "$2" <<'NODE'
const fs=require('node:fs');const [path,expected]=process.argv.slice(2);const r=JSON.parse(fs.readFileSync(path,'utf8'));
if(r.chainId!==1952||r.outcome!==expected||!r.block?.number||!r.checkedAt)throw Error('Wrong outcome, scope or missing block/time in '+path);
if(expected==='Matches approved release.'&&(!r.approvalAuthorityCurrent||r.approvalRevoked||r.publication?.incomplete||!r.files?.length||!r.files.every(f=>f.status==='verified')||r.changes?.length))throw Error('Incomplete approved match');
if(expected==='Approval revoked or expired.'&&r.approvalRevoked!==true)throw Error('Expected explicit revocation, not merely expiry or unavailable state');
console.log('Verified report: '+r.outcome+' · block '+r.block.number+' · checked '+r.checkedAt);
NODE
}
focus_report() {
  node - "$1" <<'NODE'
const fs=require('node:fs');const r=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
console.log(JSON.stringify({source:r.source,chainId:r.chainId,outcome:r.outcome,checkedAt:r.checkedAt,block:r.block,approvalAuthorityCurrent:r.approvalAuthorityCurrent,approvalRevoked:r.approvalRevoked,publication:r.publication,files:r.files},null,2));
NODE
}
verify_match() {
  run buidl release verify --manifest ./manifest.json --out "$1"
  assert_report "$1" 'Matches approved release.'
}
expected_rejection() {
  local code
  printf '\n$'; printf ' %q' "$@"; printf '\n'
  if "$@" > "$WORK/rejection.txt" 2>&1; then
    cat "$WORK/rejection.txt"; fail 'Changed build unexpectedly accepted.'
  else code=$?; fi
  cat "$WORK/rejection.txt"
  [[ "$code" -eq 1 ]] || fail "Wrong changed-build exit code: $code"
  node - "$WORK/rejection.txt" <<'NODE'
const fs=require('node:fs');const message=fs.readFileSync(process.argv[2],'utf8');
if(!message.includes('Build differs from the approved manifest. Publishing blocked.'))throw Error('Expected exact file/manifest rejection, not an RPC or wallet error');
NODE
  printf '\nExpected exact file/manifest rejection. No publishing command was run.\n'
}

case "$MODE" in
  preview)
    need_node
    node - "$ROOT/cues.json" <<'NODE'
const fs=require('node:fs');const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const tc=s=>`${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
for(const c of p.cues){console.log(`\n${c.id} ${tc(c.start)}–${tc(c.end)} ${c.title}\nVOICE: ${c.voice}\nKEEP: ${c.mustShow}`)}
console.log('\nPreview only. No buidl, wallet, RPC or transaction commands executed.');
NODE
    ;;
  setup)
    need_live
    printf '\nSeparate SETUP recording · X Layer TESTNET 1952 · labeled buidl hosting fixtures.\nReview all wallet prompts. Stop if the chain is not 1952.\n'
    read -r -p 'Funded holder address: ' HOLDER
    read -r -p 'First reviewer address: ' REVIEWER1
    read -r -p 'Second reviewer address: ' REVIEWER2
    for account in "$HOLDER" "$REVIEWER1" "$REVIEWER2"; do address "$account" || fail "Invalid address: $account"; done
    WORK=$(mktemp -d "$PWD/buidl-recording.XXXXXX")
    cd -- "$WORK"
    node - "$HOLDER" "$REVIEWER1" "$REVIEWER2" <<'NODE'
const fs=require('node:fs');const [holder,reviewer1,reviewer2]=process.argv.slice(2);
if(new Set([holder,reviewer1,reviewer2].map(a=>a.toLowerCase())).size!==3)throw Error('Three distinct test accounts required');
fs.writeFileSync('recording-config.json',JSON.stringify({kind:'buidl-manual-recording',chainId:1952,holder,reviewer1,reviewer2},null,2)+'\n',{flag:'wx'});
NODE
    mkdir dist
    cat > dist/index.html <<'HTML'
<!doctype html>
<html lang="en"><meta charset="utf-8"><title>buidl checkout</title>
<h1>Demo checkout</h1><p>Simulated payment only. No funds are transferred.</p>
<pre id="payment"></pre>
<script>fetch('./payment.json').then(r=>r.json()).then(p=>{document.getElementById('payment').textContent=JSON.stringify(p,null,2)});</script>
</html>
HTML
    cat > dist/payment.json <<'JSON'
{"network":"testnet","recipient":"0x1111111111111111111111111111111111111111","amount":"10","simulated":true}
JSON
    pause 'S01 · Connect HOLDER. This signs a connection message, not a release approval.'
    run buidl wallet connect --network testnet --account "$HOLDER"
    run buidl wallet show
    run buidl app init checkout --network testnet --reviewers "$REVIEWER1,$REVIEWER2" --threshold 2
    pause 'S02 · Preview deployment. Keep the test-token estimates readable for at least 5 seconds.'
    run buidl app deploy
    sleep 5
    pause 'S03 · Deploy fixtures. Confirm each of the two contract deployments separately.'
    run buidl app deploy --execute
    pause 'S04 · Enroll the fixture circuit into custody. Review before confirming.'
    run buidl app enroll --execute
    pause 'S05 · Register the two-reviewer policy. Review before confirming.'
    run buidl app register --execute
    capture_json setup-policy.json buidl policy show --json
    node - "$HOLDER" "$REVIEWER1" "$REVIEWER2" <<'NODE'
const fs=require('node:fs');const [holder,r1,r2]=process.argv.slice(2),r=JSON.parse(fs.readFileSync('setup-policy.json','utf8'));
if(r.currentAuthority!==true||r.policy?.threshold!=='2'||r.policy.holder.toLowerCase()!==holder.toLowerCase()||r.policy.reviewers.length!==2||![r1,r2].every(a=>r.policy.reviewers.some(b=>b.toLowerCase()===a.toLowerCase())))throw Error('Wrong current policy or role addresses');
NODE
    run buidl policy show
    run buidl doctor
    node - <<'NODE'
const fs=require('node:fs');fs.writeFileSync('setup-complete.json',JSON.stringify({chainId:1952,complete:true,at:new Date().toISOString()})+'\n',{flag:'wx'});
NODE
    printf '\nSetup ready. Record the core flow with:\n  bash %q record %q\n' "$ROOT/buidl-timed.sh" "$WORK"
    ;;
  record)
    need_live; set_work "$@"
    [[ ! -e recording-started.json ]] || fail 'Recording already started in this directory. Inspect wallet state; this helper does not auto-resume or recreate evidence.'
    node - <<'NODE'
const fs=require('node:fs');fs.writeFileSync('recording-started.json',JSON.stringify({at:new Date().toISOString()})+'\n',{flag:'wx'});
NODE
    printf '\nCore recording · 12 takes for a 3:00 FINAL EDIT. Raw time includes real signing and RPC waits.\nUse the adjacent cue sheet for narration. After every take, hold the result and press Enter yourself.\n'
    shot C01
    run buidl --version
    hold
    shot C02
    run buidl app show
    capture_json recording-policy.json buidl policy show --json
    node - "$HOLDER" "$REVIEWER1" "$REVIEWER2" <<'NODE'
const fs=require('node:fs');const [holder,r1,r2]=process.argv.slice(2),r=JSON.parse(fs.readFileSync('recording-policy.json','utf8'));
if(r.currentAuthority!==true||r.policy?.threshold!=='2'||r.policy.holder.toLowerCase()!==holder.toLowerCase()||r.policy.reviewers.length!==2||![r1,r2].every(a=>r.policy.reviewers.some(b=>b.toLowerCase()===a.toLowerCase())))throw Error('Current onchain policy no longer matches prepared roles');
NODE
    run buidl policy show
    hold
    shot C03
    run buidl release create checkout-v1 --build ./dist --out ./manifest.json --fallback index.html
    run buidl release inspect ./manifest.json
    run buidl release request ./manifest.json --out ./approval-request.json
    hold
    shot C04
    pause 'Select REVIEWER ONE in the extension. Connection and release approval are separate messages.'
    run buidl wallet connect --network testnet --account "$REVIEWER1"
    run buidl release sign ./approval-request.json --out ./reviewer1.json
    hold
    shot C05
    pause 'Select REVIEWER TWO in the extension. Sign the same release request.'
    run buidl wallet connect --network testnet --account "$REVIEWER2"
    run buidl release sign ./approval-request.json --out ./reviewer2.json
    hold
    shot C06
    pause 'Switch back to HOLDER. Keep the approval preview on screen before executing.'
    run buidl wallet connect --network testnet --account "$HOLDER"
    run buidl release approve ./reviewer1.json ./reviewer2.json
    sleep 5
    pause 'Read the approval transaction estimate and confirm only on testnet.'
    run buidl release approve ./reviewer1.json ./reviewer2.json --execute
    hold
    shot C07
    run buidl release gate ./dist ./manifest.json
    sleep 3
    pause 'Publishing needs separate confirmations for beginning the upload, both files, routing and finishing. Do not rush wallet review.'
    run buidl release publish ./dist ./manifest.json --execute
    hold
    shot C08
    verify_match ./verification.json
    run buidl wallet history
    focus_report ./verification.json
    printf '\nFocus: outcome, checked block/time, verified files and publication complete.\n'
    hold
    shot C09
    cp -R dist dist-changed
    cat > dist-changed/payment.json <<'JSON'
{"network":"testnet","recipient":"0x2222222222222222222222222222222222222222","amount":"10","simulated":true}
JSON
    run cat dist/payment.json
    run cat dist-changed/payment.json
    expected_rejection buidl release gate ./dist-changed ./manifest.json
    hold
    shot C10
    verify_match ./still-approved-verification.json
    hold
    shot C11
    pause 'This revokes the current test release. Record the successful match first. Review the revocation cost and confirm yourself.'
    run buidl release revoke --execute
    printf '\n$ buidl release verify --manifest ./manifest.json --out ./revoked-verification.json\n'
    if buidl release verify --manifest ./manifest.json --out ./revoked-verification.json; then
      fail 'Verification unexpectedly succeeded after revocation.'
    else code=$?; fi
    [[ "$code" -eq 2 ]] || fail "Wrong verification exit code after revocation: $code"
    assert_report ./revoked-verification.json 'Approval revoked or expired.'
    hold
    shot C12
    printf '\nInstall: npm install -g @ola-893/buidl@0.5.0\n'
    printf 'Final check: approved release -> local changed build blocked -> approval revoked.\n'
    hold
    node - <<'NODE'
const fs=require('node:fs');fs.writeFileSync('recording-complete.json',JSON.stringify({chainId:1952,complete:true,at:new Date().toISOString(),scope:'public-testnet fixtures; no mainnet writes'},null,2)+'\n',{flag:'wx'});
NODE
    printf '\nRecording complete. Preserve take-markers.jsonl, reports and .buidl/transactions.json.\nCustody is still enrolled; optional recovery and disconnect are outside the 3:00 cut:\n  bash %q cleanup %q\n' "$ROOT/buidl-timed.sh" "$WORK"
    ;;
  cleanup)
    need_live; set_work "$@"
    [[ -f recording-complete.json ]] || fail 'Do not run automatic cleanup after an interrupted recording. Inspect wallet activity and the journal first.'
    run buidl wallet history
    read -r -p 'Recover TESTNET circuit to its depositor? Type RECOVER; Enter leaves it enrolled: ' recovery
    if [[ "$recovery" == 'RECOVER' ]]; then
      run buidl wallet connect --network testnet --account "$HOLDER"
      run buidl app recover --execute
      run buidl app status
    fi
    run buidl wallet disconnect
    printf '\nEvidence retained in %s\n' "$WORK"
    ;;
  help|--help|-h) usage ;;
  *) usage; exit 1 ;;
esac
