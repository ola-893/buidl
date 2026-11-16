# Manifest and approval formats

## Manifest schema 1

The digest is the lowercase `0x`-prefixed SHA-256 of the UTF-8 canonical JSON bytes. Canonical JSON has no whitespace or terminal newline, uses ECMAScript JSON string escaping, and serializes object members in the following order:

| Object | Fields in serialization order |
|---|---|
| Root | `schemaVersion`, `site`, `release`, `routing`, `files`, optional `provenance` |
| Site | `chainId`, `processor`, `circuitId`, `container` |
| Routing | `fallback` |
| File | `path`, `bytes`, `type`, `sha256` |
| Provenance | optional `commit`, optional `build` |

`schemaVersion` is 1. Decimal integers use JSON numbers within JavaScript's safe range. The circuit ID is a positive canonical decimal string. Addresses and digests use lowercase hex with `0x` prefixes. File SHA-256 covers each file's raw bytes. MIME type uses the shared pinned MIME table for build folders and the declaration for deployed files. An empty fallback means no fallback is configured. A nonempty fallback must name an inventory file. TAP-10 defines the implicit `index.html` routing behavior.

Paths are case-sensitive, Unicode NFC, slash-delimited and relative. Empty, dot, and dot-dot segments, controls, lone surrogates, backslashes, literal percent escapes, queries, and fragments are rejected. Duplicate normalized paths and file/directory collisions are rejected. Paths sort by ECMAScript UTF-16 code unit order. The build directory is the publication boundary and has zero implicit file exclusions. Symlinks and special files are rejected. Exclude unwanted build files by leaving them outside the directory. The app permits 2,000 files, 8,400,000 bytes per file, and 32 MiB total. The fixture publisher uses 12,000-byte chunks and a 350-chunk ceiling because its storage costs differ from TapeOut. Browser directory selection covers the files provided by the browser. The CLI independently enumerates the directory before approval-gated publishing.

The digest covers optional provenance, which is author-supplied. Provenance does not independently establish a source/build relationship. A second digest for the same site and artifact set serializes the ordered fields `schemaVersion`, `site`, `routing`, and `files`. It is stable across release labels and provenance changes. It identifies an artifact set for rollback. A post-deployment comparison reconstructs these fields from the pinned deployment and reports path additions, removals, exact metadata and hash changes, and fallback changes.

## Approval and registry

The EIP-712 domain uses name `buidl`, version `1`, chain ID, registry address, and a random deployment salt. The message includes the site key, policy version, sequence, expiry in Unix seconds, schema version, manifest digest, artifact digest and explicit rollback flag. The site key is Keccak-256 of Solidity ABI encoding `(uint256 chainId, address processor, uint256 circuitId, address container)`. The policy identity is the registry domain plus site key. Current status is read from a configured registry at verification time. An exported request alone cannot establish that the approval is current.

- The registry has no administrator, proxy, or upgrade path. Its immutable authority source supplies the holder and ownership epoch. Users choose the trusted registry independently of any manifest uploaded by a publisher or reviewer.
- Only the current holder can onboard or rotate a site's policy or revoke the current release. Ownership epoch changes invalidate that policy until explicit re-onboarding. Each policy version invalidates previous commitments. The holder cannot also be a configured reviewer address. Distinct addresses prove control of distinct keys. The team remains responsible for assigning them independently.
- A release needs distinct authorized EOA signatures, a current policy version, an unexpired deadline, and the next sequence. Solidity enforces the threshold and recovers low-S signatures in reviewer address order. Anyone can submit a valid threshold bundle. Reviewers should avoid signing competing candidates at the same sequence because the first valid record consumes it.
- A new commitment supersedes the previous one. Repeating an artifact set requires a newly signed rollback, a higher sequence, and an explicit rollback flag. Expiry or revocation leaves the sequence consumed. It never selects an earlier commitment.
- The public event log records policy versions, release digests, recovered reviewer addresses, and revocations. Manifest and signature bundles can be retained outside the registry. Future evidence extensions can reference manifest/commitment digests and attach typed attestation references in a separate versioned envelope.
- Authority and registry lifecycle checks are implemented on Anvil. X Layer uses the TapeOut read path. Live onboarding needs an authority adapter that can attest to transfer epochs and a separately configured live registry.

The verifier distinguishes “Matches approved release,” “Deployment differs from approved release,” “No qualifying approval,” “Approval revoked or expired,” and “Verification unavailable.” It requires the complete onchain inventory and a matching pinned block for local content and approval state. Incomplete uploads, missing or unverified bytes, missing approved manifests, and unavailable RPC agreement cannot yield an approved match.
